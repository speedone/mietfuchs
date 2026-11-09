// Zugang (#528, Schritt 1): Lauscht Mietfuchs nicht nur auf diesem Rechner, schützt ein Passwort den Bestand. Hier der
// Kern ohne Server, eingehängt in index.ts; Entwurf und Begründungen in
// docs/superpowers/specs/2026-11-07-anmeldung-design.md, die Regeln im Betrieb in server/src/CLAUDE.md („Anmeldung“).
//
// - **Von außen erreichbar** entscheidet die Lausch-Adresse (`reachableOf`), nie die Adresse einer Anfrage: Ein
//   Reverse-Proxy auf demselben Rechner ließe sonst jede Anfrage wie vom Rechner selbst aussehen.
// - **Zustand** in `zugang.json` im Datenordner, nie in der Datenbank: Er geht nicht ins Backup, nicht in Vorversionen
//   und nicht in den Umzug, und ein Rücksprung ändert das Passwort nicht.
// - **Stufe A** (0.17.0): Ein neuer Datenordner im Netz startet in der Einrichtung; ein Bestand ohne `zugang.json` ist im
//   Übergang und bleibt offen, mit Hinweis. Stufe B (Pflicht) folgt vor 1.0.0-rc.1.
//
// Keine Bibliothek, nur node:crypto: scrypt nach OWASP Password Storage, Sitzungen nach OWASP Session Management, die
// Bremse verlangsamt und sperrt nie (sonst sperrte ein Gerät im Netz den Vermieter aus).
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'

export type AccessMode = 'setup' | 'password' | 'off'
export type Reachable = 'local' | 'network'
export type AuthSetting = 'auto' | 'on' | 'off'
// Was gilt: `none` heißt nichts entschieden und nichts nötig (lokal ohne Datei), `transition` der Übergang der Stufe A
export type AccessView = AccessMode | 'transition' | 'none'
export type Stage = 'A' | 'B'

export type AccessFile = { version: 1, mode: AccessMode, instance: string, hash?: string, changedAt: string }

export type AccessState = {
  reachable: Reachable
  setting: AuthSetting
  mode: AccessView
  // Verlangt Mietfuchs eine Sitzung, auch von einer Anfrage ohne Proxy-Kopfzeilen?
  required: boolean
  instance: string
  hash: string | null
  // Lokal lauschend: Anfragen über einen Proxy brauchen auch in der Einrichtung eine Sitzung (nach dem Zurücksetzen eines
  // Passworts, mit Code). Ohne Code bliebe eine alte `setup`-Datei sonst eine Sperre ohne Ausweg.
  proxyStrict?: boolean
}

export const ACCESS_FILE = 'zugang.json'
export const CODE_FILE = 'einrichtungscode.txt'
export const RESET_FILE = 'passwort-zuruecksetzen'

// ---------- Erreichbarkeit und Umgebung ----------

// `local` nur bei einer Loopback-Adresse; fehlt NKA_HOST, lauscht der Server auf allen Karten
export function reachableOf(host: string | undefined): Reachable {
  const h = host?.trim().toLowerCase() ?? ''
  if (!h) return 'network'
  const v4 = h.startsWith('::ffff:') ? h.slice(7) : h
  if (net.isIPv4(v4) && v4.startsWith('127.')) return 'local'
  if (h === '::1' || h === '0:0:0:0:0:0:0:1') return 'local'
  return 'network'
}

// Ein unbekannter Wert verhindert den Start, wie bei NKA_HOST: Ein Tippfehler darf den Schutz nicht still abschalten
export function authSetting(env: NodeJS.ProcessEnv): AuthSetting | { problem: string } {
  const raw = env.NKA_AUTH?.trim() ?? ''
  const value = raw.toLowerCase()
  if (value === '' || value === 'auto') return 'auto'
  if (value === 'on' || value === 'off') return value
  return { problem: `NKA_AUTH „${raw}“ ist kein gültiger Wert. Erlaubt sind auto, on oder off (ohne Angabe gilt auto).` }
}

export const newInstance = (): string => crypto.randomBytes(3).toString('hex')

// ---------- Anfangszustand ----------

export type InitialInput = {
  reachable: Reachable
  setting: AuthSetting
  // `corrupt`: eine Datei, die sich nicht lesen lässt; sie gilt als Einrichtung (streng, nie offen)
  file: AccessFile | 'corrupt' | null
  hasStock: boolean
  stage: Stage
}

export function initialAccess({ reachable, setting, file, hasStock, stage }: InitialInput): { state: AccessState, write: AccessFile | null } {
  const exposed = reachable === 'network' || setting === 'on'
  const base = { reachable, setting }
  if (file === 'corrupt') {
    return { state: { ...base, mode: 'setup', required: exposed && setting !== 'off', instance: newInstance(), hash: null }, write: null }
  }
  if (file) {
    const required = setting !== 'off' && exposed && file.mode !== 'off'
    return { state: { ...base, mode: file.mode, required, instance: file.instance, hash: file.hash ?? null }, write: null }
  }
  if (setting === 'off' || !exposed) return { state: { ...base, mode: 'none', required: false, instance: newInstance(), hash: null }, write: null }
  // NKA_AUTH=on ist eine ausdrückliche Bitte um die Anmeldung, der Übergang gilt dann nicht
  if (hasStock && stage === 'A' && setting !== 'on') return { state: { ...base, mode: 'transition', required: false, instance: newInstance(), hash: null }, write: null }
  const write: AccessFile = { version: 1, mode: 'setup', instance: newInstance(), changedAt: new Date().toISOString() }
  return { state: { ...base, mode: 'setup', required: true, instance: write.instance, hash: null }, write }
}

// ---------- Passwort ----------

export const MIN_PASSWORD = 15
export const MAX_PASSWORD = 128

// Zeichen nach NFC, gezählt nach Codepunkten (ein Emoji ist ein Zeichen)
const characters = (text: string): string[] => [...text.normalize('NFC')]

// Nur Länge (OWASP Authentication: ohne zweiten Faktor mindestens 15), keine Regeln für Zeichenarten. Abgelehnt werden
// dazu nur ein wiederholtes Zeichen und der Name des Programms.
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string') return `Das Passwort braucht mindestens ${MIN_PASSWORD} Zeichen.`
  const chars = characters(password)
  if (chars.length < MIN_PASSWORD) return `Das Passwort braucht mindestens ${MIN_PASSWORD} Zeichen. Ein Satz aus drei, vier Wörtern lässt sich gut merken.`
  if (chars.length > MAX_PASSWORD) return `Das Passwort darf höchstens ${MAX_PASSWORD} Zeichen haben.`
  if (new Set(chars).size === 1) return 'Das Passwort besteht nur aus einem Zeichen. Bitte wählen Sie ein anderes.'
  if (password.normalize('NFC').toLowerCase().includes('mietfuchs')) return 'Das Passwort darf „Mietfuchs“ nicht enthalten.'
  return null
}

// ---------- Passwort aus der Umgebung ----------
// `NKA_PASSWORD_FILE` (Docker Secrets) geht vor `NKA_PASSWORD`; leer heißt nicht gesetzt. Aus einer Datei fallen nur
// Zeilenumbrüche am Ende und ein BOM am Anfang weg (ein Secret endet meist mit einem Umbruch, ein Windows-Editor schreibt
// ein BOM), Leerzeichen gehören zum Passwort. Übernommen wird es nur, solange nichts entschieden ist (accessServer.ts,
// `applyEnvPassword`). **Keine Meldung nennt den Wert**: Wer NKA_PASSWORD_FILE mit NKA_PASSWORD verwechselt, hat dort das
// Passwort stehen, und Pfad wie Fehlertext von Node enthielten es (Durchsicht S1).
export type EnvPasswordSource = 'NKA_PASSWORD' | 'NKA_PASSWORD_FILE'
export type EnvPassword =
  | { password: string, source: EnvPasswordSource, ignored: 'NKA_PASSWORD' | null }
  | { problem: string, source: EnvPasswordSource }

export function readEnvPassword(env: NodeJS.ProcessEnv, read: (file: string) => string): EnvPassword | null {
  const file = env.NKA_PASSWORD_FILE?.trim() ?? ''
  const plain = env.NKA_PASSWORD ?? ''
  if (file) {
    let content: string
    try {
      content = read(file)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? 'unbekannter Fehler'
      return { problem: `NKA_PASSWORD_FILE: Die angegebene Datei lässt sich nicht lesen (${code}). Erwartet wird der Pfad zu einer Datei mit dem Passwort, etwa /run/secrets/mietfuchs_passwort.`, source: 'NKA_PASSWORD_FILE' }
    }
    const password = content.replace(/^\uFEFF/, '').replace(/[\r\n]+$/, '')
    if (!password) return { problem: 'NKA_PASSWORD_FILE: Die angegebene Datei ist leer.', source: 'NKA_PASSWORD_FILE' }
    return { password, source: 'NKA_PASSWORD_FILE', ignored: plain ? 'NKA_PASSWORD' : null }
  }
  return plain ? { password: plain, source: 'NKA_PASSWORD', ignored: null } : null
}

// OWASP Password Storage: scrypt mit N = 2^17, r = 8, p = 1 (128 MiB), Salz 16 Bytes, Schlüssel 32 Bytes. Die Parameter
// stehen im gespeicherten Wert, damit eine spätere Fassung sie anheben kann.
const SCRYPT = { logN: 17, r: 8, p: 1 }
const KEY_BYTES = 32
const SALT_BYTES = 16
const MAX_MEM = 256 * 1024 * 1024

function scrypt(password: string, salt: Buffer, { logN, r, p }: { logN: number, r: number, p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password.normalize('NFC'), salt, KEY_BYTES, { N: 2 ** logN, r, p, maxmem: MAX_MEM }, (err, key) => (err ? reject(err) : resolve(key)))
  })
}

// `logN` kleiner nur in Tests (access.test.ts), die den Rundweg brauchen und nicht die Zeit
export async function hashPassword(password: string, { logN = SCRYPT.logN }: { logN?: number } = {}): Promise<string> {
  const salt = crypto.randomBytes(SALT_BYTES)
  const key = await scrypt(password, salt, { ...SCRYPT, logN })
  return ['scrypt', logN, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$')
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

// Ein verdorbener Wert ist false, nie ein Wurf: Er darf die Anmeldung nicht öffnen und den Server nicht stören
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (typeof password !== 'string' || typeof stored !== 'string') return false
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [logN, r, p] = parts.slice(1, 4).map((v) => (/^\d{1,2}$/.test(v) ? Number(v) : NaN))
  // Obergrenzen, damit eine von Hand geänderte Datei keine Berechnung über Minuten oder Gigabytes auslöst
  if (!(logN >= 10 && logN <= 20 && r >= 1 && r <= 16 && p >= 1 && p <= 4)) return false
  if (!BASE64.test(parts[4]) || !BASE64.test(parts[5])) return false
  const salt = Buffer.from(parts[4], 'base64')
  const expected = Buffer.from(parts[5], 'base64')
  if (salt.length < 8 || expected.length !== KEY_BYTES) return false
  try {
    const key = await scrypt(password, salt, { logN, r, p })
    return crypto.timingSafeEqual(key, expected)
  } catch {
    return false
  }
}

// Mit älteren Parametern gespeichert? Dann rechnet die nächste gelungene Anmeldung den Hash neu
export const needsRehash = (stored: string | null): boolean => !!stored && !stored.startsWith(`scrypt$${SCRYPT.logN}$${SCRYPT.r}$${SCRYPT.p}$`)

// Höchstens eine Berechnung zugleich: Parallele Versuche treiben einen Raspberry Pi sonst ins Speicherende (128 MiB je
// Berechnung). Wie viele warten dürfen, entscheidet die Bremse.
export function createHashQueue() {
  let tail: Promise<unknown> = Promise.resolve()
  return {
    run<T>(job: () => Promise<T>): Promise<T> {
      const result = tail.then(job, job)
      tail = result.catch(() => {})
      return result
    },
  }
}

// ---------- Einmal-Code ----------

// 31 Zeichen ohne Verwechslung (ohne 0/O, 1/I/L), 12 davon sind gut 59 Bit
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const CODE_LENGTH = 12

export function newSetupCode(): string {
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]
  return code
}

// In Vierergruppen, wie Konsole und Datei ihn zeigen
export const formatCode = (code: string): string => code.match(/.{1,4}/g)?.join('-') ?? code

// Eingabe ohne Rücksicht auf Groß und Klein, Bindestriche und Leerzeichen
export const normalizeCode = (input: unknown): string => (typeof input === 'string' ? input.toUpperCase().replace(/[^A-Z0-9]/g, '') : '')

const digest = (value: string): Buffer => crypto.createHash('sha256').update(value).digest()

// Der Fensterschlüssel (#528), zeitkonstant über SHA-256 beider Werte
export function sameKey(given: unknown, key: string | null): boolean {
  if (!key || typeof given !== 'string' || !given) return false
  return crypto.timingSafeEqual(digest(given), digest(key))
}

// Zeitkonstant über SHA-256 beider Werte, damit auch die Länge nichts verrät
export function sameCode(input: unknown, code: string | null): boolean {
  const given = normalizeCode(input)
  if (!code || !given) return false
  return crypto.timingSafeEqual(digest(given), digest(normalizeCode(code)))
}

// ---------- Dateien im Datenordner ----------

// Über Zwischendatei und Umbenennen wie secrets.json, nur für den eigenen Benutzer lesbar (0600)
function writePrivate(file: string, content: string): void {
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, content, { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(tmp, file)
  try {
    fs.chmodSync(file, 0o600)
  } catch {
    // Windows kennt keine Unix-Rechte
  }
}

const MODES: readonly string[] = ['setup', 'password', 'off']

function isAccessFile(value: unknown): value is AccessFile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  if (v.version !== 1 || typeof v.mode !== 'string' || !MODES.includes(v.mode)) return false
  if (typeof v.instance !== 'string' || !/^[0-9a-f]{6}$/.test(v.instance)) return false
  if (v.mode === 'password' && (typeof v.hash !== 'string' || !v.hash.startsWith('scrypt$'))) return false
  return v.hash === undefined || typeof v.hash === 'string'
}

export function readAccessFile(dataDir: string): { file: AccessFile | 'corrupt' | null, problem: string | null } {
  const file = path.join(dataDir, ACCESS_FILE)
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { file: null, problem: null }
    return { file: 'corrupt', problem: `${ACCESS_FILE} lässt sich nicht lesen (${(err as Error).message}). Mietfuchs verlangt deshalb die Einrichtung eines Passworts.` }
  }
  try {
    const parsed: unknown = JSON.parse(text)
    if (isAccessFile(parsed)) {
      const { version, mode, instance, hash, changedAt } = parsed
      return { file: { version, mode, instance, ...(hash !== undefined ? { hash } : {}), changedAt: typeof changedAt === 'string' ? changedAt : '' }, problem: null }
    }
  } catch {
    /* unten */
  }
  return { file: 'corrupt', problem: `${ACCESS_FILE} im Datenordner ist beschädigt. Mietfuchs verlangt deshalb die Einrichtung eines Passworts.` }
}

export function writeAccessFile(dataDir: string, file: AccessFile): void {
  writePrivate(path.join(dataDir, ACCESS_FILE), `${JSON.stringify(file, null, 2)}\n`)
}

export function writeCodeFile(dataDir: string, code: string): void {
  writePrivate(path.join(dataDir, CODE_FILE), `${formatCode(code)}\n`)
}

export function removeCodeFile(dataDir: string): void {
  fs.rmSync(path.join(dataDir, CODE_FILE), { force: true })
}

// ---------- Sitzungen ----------

const IDLE_MS = 30 * 60_000
const MAX_MS = 8 * 60 * 60_000
const MAX_SESSIONS = 50

// OWASP Session Management: 32 Zufallsbytes als Kennung, im Speicher nur ihr SHA-256. Ein Neustart meldet alle ab.
export function createSessions({ now = Date.now, idleMs = IDLE_MS, maxMs = MAX_MS, max = MAX_SESSIONS }: { now?: () => number, idleMs?: number, maxMs?: number, max?: number } = {}) {
  // Schlüssel ist der Hash als Hex, in der Reihenfolge des Anlegens
  const sessions = new Map<string, { createdAt: number, lastUsed: number }>()
  const keyOf = (token: string): string => digest(token).toString('hex')
  const alive = (s: { createdAt: number, lastUsed: number }, at: number): boolean => at - s.lastUsed < idleMs && at - s.createdAt < maxMs
  const sweep = (at: number): void => {
    for (const [key, s] of sessions) if (!alive(s, at)) sessions.delete(key)
  }
  return {
    create(): string {
      const at = now()
      sweep(at)
      while (sessions.size >= max) sessions.delete(sessions.keys().next().value as string)
      const token = crypto.randomBytes(32).toString('base64url')
      sessions.set(keyOf(token), { createdAt: at, lastUsed: at })
      return token
    },
    // Gültig, dann gilt sie ab jetzt wieder 30 Minuten
    check(token: string): boolean {
      if (!token || token.length > 100) return false
      const key = keyOf(token)
      const s = sessions.get(key)
      if (!s) return false
      const at = now()
      if (!alive(s, at)) {
        sessions.delete(key)
        return false
      }
      s.lastUsed = at
      return true
    },
    revoke(token: string): void {
      if (token) sessions.delete(keyOf(token))
    },
    revokeAll(): void {
      sessions.clear()
    },
    revokeAllExcept(token: string): void {
      const keep = token ? keyOf(token) : ''
      for (const key of [...sessions.keys()]) if (key !== keep) sessions.delete(key)
    },
    size: (): number => sessions.size,
  }
}
export type Sessions = ReturnType<typeof createSessions>

// ---------- Bremse nach Fehlversuchen ----------

export type AttemptKind = 'password' | 'code'
export type Ticket = { ok: true, key: string, kind: AttemptKind, delayMs: number }
export type Refusal = { ok: false, retryAfter: number }

const FREE_FAILURES = 4
// Höchstens 60 s statt der 15 Minuten des Entwurfs (Durchsicht): Teilen sich Geräte eine Adresse (Proxy, Docker
// Desktop), hielte ein Angreifer sonst jedes Fenster für sich. Das Raten begrenzt ohnehin die Schlange mit einer Berechnung.
const MAX_WAIT_S = 60
const ACCOUNT_WINDOW_MS = 15 * 60_000
const ACCOUNT_FAILURES = 20
const MAX_RUNNING = 2

// Die Adresse für die Bremse: IPv4 in IPv6 als IPv4, IPv6 als volle Adresse in einer Schreibweise. Nicht je /64
// (Durchsicht): Im Heimnetz teilen sich alle Geräte ein /64, und der Fernseher bremste sonst das Handy des Vermieters.
export function addressKey(address: string | undefined): string {
  const a = address?.trim().toLowerCase().split('%')[0] ?? ''
  if (!a) return 'unbekannt'
  if (a.startsWith('::ffff:') && net.isIPv4(a.slice(7))) return a.slice(7)
  if (!net.isIPv6(a)) return a
  const [head, tail = ''] = a.split('::')
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const full = a.includes('::') ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left
  return full.map((part) => Number.parseInt(part || '0', 16).toString(16)).join(':')
}

// **Verlangsamen, nie sperren** (Entwurf, „Bremse nach Fehlversuchen“): Jeder Versuch zählt als Fehlversuch, bevor
// gerechnet wird, und wird bei Erfolg zurückgenommen. Je Adresse ein laufender Versuch, insgesamt zwei; je Adresse ab
// dem fünften Versuch nach vier Fehlversuchen 1 s Wartezeit, je weiterem verdoppelt bis 60 Sekunden; für das Konto ab 20
// Fehlversuchen in 15 Minuten nur 1 s mehr je Berechnung. Code und Passwort zählen getrennt. Im Arbeitsspeicher.
export function createBrake({ now = Date.now, maxAddresses = 10_000 }: { now?: () => number, maxAddresses?: number } = {}) {
  type Entry = { failures: number, lastAt: number, running: boolean }
  let entries = new Map<string, Entry>()
  let recent: Record<AttemptKind, number[]> = { password: [], code: [] }
  let running = 0

  const entryOf = (key: string): Entry => {
    let entry = entries.get(key)
    if (entry) {
      // ans Ende, damit die zuletzt benutzte zuletzt verdrängt wird
      entries.delete(key)
    } else {
      entry = { failures: 0, lastAt: 0, running: false }
    }
    entries.set(key, entry)
    while (entries.size > maxAddresses) {
      const oldest = [...entries.entries()].find(([, e]) => !e.running)
      if (!oldest) break
      entries.delete(oldest[0])
    }
    return entry
  }
  const prune = (kind: AttemptKind, at: number): number[] => {
    const list = recent[kind].filter((t) => at - t < ACCOUNT_WINDOW_MS)
    recent[kind] = list.length > 10_000 ? list.slice(-10_000) : list
    return recent[kind]
  }
  const waitSeconds = (failures: number): number => (failures < FREE_FAILURES ? 0 : Math.min(2 ** (failures - FREE_FAILURES), MAX_WAIT_S))

  return {
    begin(address: string, kind: AttemptKind): Ticket | Refusal {
      const at = now()
      const key = `${kind}|${addressKey(address)}`
      const entry = entries.get(key)
      if (entry?.running) return { ok: false, retryAfter: 1 }
      if (entry) {
        const remaining = entry.lastAt + waitSeconds(entry.failures) * 1000 - at
        if (remaining > 0) return { ok: false, retryAfter: Math.ceil(remaining / 1000) }
      }
      if (running >= MAX_RUNNING) return { ok: false, retryAfter: 1 }
      const delayMs = prune(kind, at).length >= ACCOUNT_FAILURES ? 1000 : 0
      const booked = entryOf(key)
      booked.failures++
      booked.lastAt = at
      booked.running = true
      recent[kind].push(at)
      running++
      return { ok: true, key, kind, delayMs }
    },
    finish(ticket: Ticket, success: boolean): void {
      running = Math.max(0, running - 1)
      const entry = entries.get(ticket.key)
      if (entry) {
        entry.running = false
        if (success) entry.failures = 0
        else entry.lastAt = now()
      }
      // zurückgenommen: der gebuchte Fehlversuch zählt auch für das Konto nicht
      if (success) recent[ticket.kind].pop()
    },
    failures: (address: string, kind: AttemptKind): number => entries.get(`${kind}|${addressKey(address)}`)?.failures ?? 0,
    recentFailures: (kind: AttemptKind = 'password'): number => prune(kind, now()).length,
    size: (): number => entries.size,
    // Datei `passwort-zuruecksetzen` und Neustart: Das Zurücksetzen bleibt auch während eines Angriffs nutzbar
    reset(): void {
      entries = new Map()
      recent = { password: [], code: [] }
      running = 0
    },
  }
}
export type Brake = ReturnType<typeof createBrake>

// ---------- Vorschaltung ----------

// Vom Rechner selbst: die Adresse der Verbindung, nie eine Kopfzeile (`trust proxy` bleibt aus)
export function isLoopback(address: string | undefined): boolean {
  const a = address?.trim().toLowerCase() ?? ''
  if (!a) return false
  return reachableOf(a) === 'local'
}

type Headers = Record<string, string | string[] | undefined>
const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value)

// Kopfzeilen, die ein Reverse-Proxy setzt. Eine gefälschte macht nur strenger, nie lockerer.
const PROXY_HEADERS = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-real-ip', 'via']
export const viaProxy = (headers: Headers): boolean => PROXY_HEADERS.some((name) => headers[name] !== undefined)

// Kam die Seite über HTTPS (Proxy davor)? Dann bekommt das Cookie `Secure`. Eine gefälschte Angabe schadet nicht: Über
// HTTP verwirft der Browser ein Cookie mit `Secure`, der Fälscher meldet nur sich selbst nicht an.
export function viaHttps(headers: Headers): boolean {
  if (first(headers['x-forwarded-proto'])?.split(',')[0].trim().toLowerCase() === 'https') return true
  if (/(^|[;,\s])proto=(["']?)https\2(?=[;,\s]|$)/i.test(first(headers.forwarded) ?? '')) return true
  return (first(headers.origin) ?? '').toLowerCase().startsWith('https:')
}

export const cookieName = (instance: string): string => `mietfuchs_${instance}`

// Alle Werte eines Namens: Bei mehreren Cookies gleichen Namens (gesetzt von einem anderen Port oder einer Seite unter
// derselben Endung) zählt jeder, nicht nur der erste
export function cookieValues(header: string | undefined, name: string): string[] {
  if (!header) return []
  return header.split(';').map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`)).map((part) => part.slice(name.length + 1))
}

// Ohne Domain und ohne Max-Age: Das Cookie gehört zur Adresse von Mietfuchs und endet mit dem Browser
export const sessionCookie = (instance: string, token: string, secure: boolean): string =>
  `${cookieName(instance)}=${token}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`
export const clearedCookie = (instance: string, secure: boolean): string =>
  `${cookieName(instance)}=; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}; Max-Age=0`

export type GateRequest = {
  method: string
  // `req.path` von Express, roh (nicht entschlüsselt)
  path: string
  loopback: boolean
  viaProxy: boolean
  // gültige Sitzung (oder Fensterschlüssel)
  signedIn: boolean
  secFetchSite?: string
  origin?: string
  host?: string
  forwardedHost?: string
  // aus NKA_ALLOWED_HOSTS, klein geschrieben
  allowedHosts: string[]
}

export type GateBody = { error: string, login?: true, setup?: true }
export type GateDecision =
  | { pass: true, noStore: boolean, shortHealth: boolean }
  | { pass: false, status: 401 | 403, body: GateBody }

const READ_ONLY = new Set(['GET', 'HEAD', 'OPTIONS'])
const PROTECTED = /^\/(api|uploads|healthz)(\/|$)/
const FREE: Record<string, readonly string[]> = {
  '/api/auth': ['GET', 'HEAD'],
  '/api/auth/login': ['POST'],
  '/api/auth/setup': ['POST'],
  '/api/auth/logout': ['POST'],
  '/healthz': ['GET', 'HEAD'],
}

// Klein, ohne doppelte Schrägstriche und ohne Schrägstrich am Ende: so, wie Express 5 zuordnet (`caseSensitive: false`,
// `strict: false`). Geschützt ist ein Pfad, wenn er roh oder (bis zu dreimal) entschlüsselt so aussieht; frei nur, wenn
// er roh genau einer der freien Routen entspricht. Ein `startsWith('/api/')` gäbe `/API/backup` frei.
const normalPath = (p: string): string => p.toLowerCase().replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/'
function pathOf(raw: string): { key: string, guarded: boolean } {
  const key = normalPath(raw)
  let guarded = PROTECTED.test(key)
  let current = raw
  for (let i = 0; i < 3 && !guarded && current.includes('%'); i++) {
    try {
      current = decodeURIComponent(current)
    } catch {
      break
    }
    guarded = PROTECTED.test(normalPath(current))
  }
  return { key, guarded }
}

// Gilt die Anmeldung für diese Anfrage? Nur mit eingerichtetem oder verlangtem Passwort, nicht bei NKA_AUTH=off, im
// Übergang und bei `off`. Lokal lauschend nur für Anfragen über einen Proxy, und nur mit Passwort: Eine `setup`-Datei
// von früher (im Netz) sperrte sonst jeden Proxy aus, lokal gibt es keinen Code (Durchsicht PR 2, M1).
export const gateActive = (state: AccessState, proxied: boolean): boolean =>
  state.setting !== 'off' && (state.mode === 'setup' || state.mode === 'password') &&
  (state.required || (proxied && (state.mode === 'password' || state.proxyStrict === true)))

// Von außen erreichbar und offen (Übergang, `off`): Wenigstens fremde Seiten, die der Browser selbst als solche
// ausweist, schreiben nicht. Sec-Fetch-Site kann keine Seite fälschen, und es hängt nicht am Host.
const exposedOpen = (state: AccessState, proxied: boolean): boolean =>
  state.setting !== 'off' && (state.mode === 'transition' || state.mode === 'off') && (state.reachable === 'network' || state.setting === 'on' || proxied)

const FOREIGN = 'Änderungen nimmt Mietfuchs nur von seiner eigenen Seite an.'

function originRefusal(req: GateRequest): string | null {
  // 1. Sec-Fetch-Site setzt der Browser selbst: nur die eigene Seite (oder die Adresszeile)
  if (req.secFetchSite !== undefined) return req.secFetchSite === 'same-origin' || req.secFetchSite === 'none' ? null : FOREIGN
  // 2. sonst Origin gegen Host, den ersten X-Forwarded-Host und NKA_ALLOWED_HOSTS
  if (req.origin !== undefined) {
    if (req.origin === 'null') return FOREIGN
    let origin: URL
    try {
      origin = new URL(req.origin)
    } catch {
      return FOREIGN
    }
    if (origin.protocol !== 'http:' && origin.protocol !== 'https:') return FOREIGN
    const host = origin.host.toLowerCase()
    const forwarded = req.forwardedHost?.split(',')[0].trim().toLowerCase()
    if (host === req.host?.trim().toLowerCase() || (forwarded && host === forwarded)) return null
    const name = origin.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    const listed = req.allowedHosts.some((h) => (h.startsWith('.') ? name === h.slice(1) || name.endsWith(h) : name === h))
    return listed ? null : FOREIGN
  }
  // 3. beides fehlt: kein Browser, also kein CSRF; es entscheidet die Sitzung
  return null
}

// Die Entscheidung je Anfrage, ohne Server (eingesetzt in index.ts nach der Host-Prüfung und vor dem Lesen des Rumpfs)
export function gate(state: AccessState, req: GateRequest): GateDecision {
  const method = req.method.toUpperCase()
  const writes = !READ_ONLY.has(method)
  const { key, guarded } = pathOf(req.path)
  if (!gateActive(state, req.viaProxy)) {
    if (writes && exposedOpen(state, req.viaProxy) && (req.secFetchSite === 'cross-site' || req.secFetchSite === 'same-site')) {
      return { pass: false, status: 403, body: { error: FOREIGN } }
    }
    return { pass: true, noStore: false, shortHealth: false }
  }
  if (writes) {
    const refusal = originRefusal(req)
    if (refusal) return { pass: false, status: 403, body: { error: refusal } }
  }
  if (!guarded) {
    if (method === 'GET' || method === 'HEAD') return { pass: true, noStore: false, shortHealth: false }
  } else if (FREE[key]?.includes(method)) {
    return { pass: true, noStore: true, shortHealth: key === '/healthz' && !req.loopback && !req.signedIn }
  }
  // Beenden vom Rechner selbst: das Fenster aus dem Hauptprozess, der Umzug bei einer alten Fassung, ein Server mit einem
  // Fensterschlüssel, den niemand mehr kennt. Mehr erlaubt die Ausnahme nicht.
  if (key === '/api/quit' && method === 'POST' && req.loopback && !req.viaProxy) return { pass: true, noStore: true, shortHealth: false }
  if (req.signedIn) return { pass: true, noStore: guarded, shortHealth: false }
  return state.mode === 'setup'
    ? { pass: false, status: 401, body: { error: 'Bitte legen Sie zuerst ein Passwort für Mietfuchs fest.', setup: true } }
    : { pass: false, status: 401, body: { error: 'Bitte melden Sie sich an.', login: true } }
}

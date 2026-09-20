// API-Schlüssel externer KI-Dienste (#18). Bewusst getrennt von der db.json: Sie gehen nie an
// den Browser und nicht ins Backup-ZIP, das schnell in einer Cloud oder auf einem USB-Stick
// landet. Nach dem Wiederherstellen auf einem anderen Rechner trägt man den Schlüssel dort neu
// ein. Unter Unix ist die Datei nur für den eigenen Benutzer lesbar (0600).
//
// Je Einstellungs-Platz ein Schlüssel: `text` (Standard) und `images` (eigener Anbieter für
// Fotos und Scans). Für `text` kann der Betreiber den Schlüssel auch über die Umgebung festlegen,
// dann gilt er vor dem gespeicherten und lässt sich in der Oberfläche nicht ändern:
// - NKA_AI_API_KEY enthält den Schlüssel selbst,
// - NKA_AI_API_KEY_FILE den Pfad einer Datei mit dem Schlüssel, etwa eines Docker- oder
//   Compose-Secrets unter /run/secrets/. Die Endung _FILE folgt der Konvention offizieller
//   Docker-Images wie postgres und mysql, ebenso, dass nicht beide zugleich gesetzt sein dürfen.
// Gelesen wird die Umgebung einmal beim Start (`checkKeyEnvironment`).
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './store.js'

// Die Rohdaten aus secrets.json: je Platz ein Schlüssel, aber ungeprüft, wie sie auf der
// Platte stehen — eine von Hand verdorbene Datei (siehe Test dazu) darf den Start nicht stören.
type StoredSecrets = Record<string, unknown>

export const KEY_SLOTS = ['text', 'images']
const FILE = path.join(DATA_DIR, 'secrets.json')
const MAX_KEY_LENGTH = 4096
const KEY_ENV = 'NKA_AI_API_KEY'
const KEY_FILE_ENV = 'NKA_AI_API_KEY_FILE'

// Nur druckbares ASCII: Ein aus einer Webseite kopierter Schlüssel kann unsichtbare Zeichen
// enthalten, die node:http im Header ablehnt. Die Meldung „nicht erreichbar“ schickte den Nutzer
// dann an die falsche Stelle.
const validFormat = (key: string): boolean => key.length <= MAX_KEY_LENGTH && /^[\x21-\x7e]+$/.test(key)

let cache: StoredSecrets | null = null
let unreadable = false

function read(): StoredSecrets {
  if (cache) return cache
  try {
    cache = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    unreadable = false
  } catch (err) {
    // Gibt es die Datei nicht, gibt es eben keine Schlüssel. War sie nur vorübergehend nicht
    // lesbar (etwa durch einen Virenscanner), darf ein späteres Speichern den anderen Platz
    // nicht überschreiben: Dann merkt sich `unreadable` das, und `write` verweigert.
    unreadable = (err as NodeJS.ErrnoException).code !== 'ENOENT'
    cache = {}
    if (unreadable) cache = null
    return {}
  }
  // An dieser Stelle ist der try-Block ohne Fehler durchgelaufen (der catch-Zweig kehrt selbst
  // zurück), cache also gesetzt. TypeScript sieht das nicht, weil die Zuweisung im try-Block steht.
  return cache!
}

function write(data: StoredSecrets): void {
  if (unreadable) {
    throw Object.assign(new Error('Die Datei mit den Schlüsseln lässt sich gerade nicht lesen. Bitte später erneut versuchen.'), { status: 503 })
  }
  const tmp = `${FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(tmp, FILE)
  try {
    fs.chmodSync(FILE, 0o600)
  } catch {
    // Windows kennt keine Unix-Rechte
  }
  cache = data
}

// Schlüssel aus der Umgebung, wie ihn `envKeyState` zwischenspeichert: der Wert selbst und die
// Variable, die ihn festgelegt hat (für die Meldung, dass ein Platz über die Umgebung fixiert ist).
type EnvKeyState = { key: string, variable: string | null }

// Schlüssel aus der Umgebung als { key, variable }. Wirft mit einer Meldung für das Startprotokoll,
// die den Schlüssel selbst nie enthält.
function loadEnvKey(): EnvKeyState {
  const direct = process.env[KEY_ENV]?.trim()
  const file = process.env[KEY_FILE_ENV]?.trim()
  if (direct && file) throw new Error(`${KEY_ENV} und ${KEY_FILE_ENV} sind beide gesetzt. Bitte nur eine der beiden Variablen verwenden.`)
  if (direct) {
    if (!validFormat(direct)) throw new Error(`${KEY_ENV} hat ein ungültiges Format (Leerzeichen, Zeilenumbruch oder zu lang).`)
    return { key: direct, variable: KEY_ENV }
  }
  if (!file) return { key: '', variable: null }
  let content
  try {
    content = fs.readFileSync(file, 'utf8')
  } catch (err) {
    throw new Error(`${KEY_FILE_ENV} zeigt auf ${file}, die Datei lässt sich aber nicht lesen (${(err as NodeJS.ErrnoException).code ?? (err as NodeJS.ErrnoException).message}).`)
  }
  const key = content.trim() // Zeilenumbruch am Ende, wie ihn `echo … > datei` schreibt
  if (!key) throw new Error(`Die Datei ${file} aus ${KEY_FILE_ENV} ist leer.`)
  if (!validFormat(key)) throw new Error(`Die Datei ${file} aus ${KEY_FILE_ENV} hat ein ungültiges Format. Sie darf nur den Schlüssel enthalten, in einer Zeile.`)
  return { key, variable: KEY_FILE_ENV }
}

let envState: EnvKeyState | null = null
const envKeyState = (): EnvKeyState => (envState ??= loadEnvKey())

// Beim Start aufrufen: liefert eine Fehlermeldung, wenn die Umgebung unbrauchbar ist, sonst null
export function checkKeyEnvironment(): string | null {
  try {
    envKeyState()
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

// Name der Umgebungsvariable, die den Schlüssel dieses Platzes festlegt, sonst null
export const envVariableFor = (slot: string): string | null => (slot === 'text' ? envKeyState().variable : null)

export function getKey(slot: string): string {
  if (envVariableFor(slot)) return envKeyState().key
  const stored = read()[slot]
  return typeof stored === 'string' ? stored : ''
}

// Die letzten vier Zeichen zum Wiedererkennen, bei kurzen Schlüsseln nichts: Dort verrieten sie
// zu viel
const HINT_MIN_LENGTH = 12
const hintFor = (key: string): string => (key.length >= HINT_MIN_LENGTH ? `…${key.slice(-4)}` : '')

// Fehler mit Meldung für die Oberfläche und `status` für die Route
const fail = (status: number, message: string) => Object.assign(new Error(message), { status })

function assertChangeable(slot: string): void {
  if (!KEY_SLOTS.includes(slot)) throw fail(400, 'Unbekannter Platz für den Schlüssel.')
  const variable = envVariableFor(slot)
  if (variable) throw fail(409, `Der Schlüssel ist über die Umgebungsvariable ${variable} festgelegt.`)
}

export function setKey(slot: string, key: unknown): void {
  assertChangeable(slot)
  const value = typeof key === 'string' ? key.trim() : ''
  if (!value) throw fail(400, 'Bitte einen Schlüssel eingeben.')
  if (!validFormat(value)) throw fail(400, 'Der Schlüssel hat ein ungültiges Format.')
  write({ ...read(), [slot]: value })
}

export function deleteKey(slot: string): void {
  assertChangeable(slot)
  const { [slot]: _removed, ...rest } = read()
  write(rest)
}

// Was die Oberfläche erfahren darf: ob ein Schlüssel gesetzt ist, ein Hinweis zum
// Wiedererkennen und welche Umgebungsvariable ihn gegebenenfalls festlegt
export function keyInfo(): Record<string, { set: boolean, hint: string, fromEnv: string | null }> {
  return Object.fromEntries(
    KEY_SLOTS.map((slot) => {
      const key = getKey(slot)
      return [slot, { set: Boolean(key), hint: hintFor(key), fromEnv: envVariableFor(slot) }]
    }),
  )
}

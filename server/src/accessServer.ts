// Zugang im Server (#528, Schritt 1): Vorschaltung und Routen unter /api/auth um den Kern aus access.ts. Eingehängt in
// index.ts nach der Host-Prüfung und vor dem Vermerk „umgezogen“ und vor `express.json()`, damit ein ungeprüfter Rumpf
// nicht gelesen wird. Die Regeln stehen in server/src/CLAUDE.md („Anmeldung“).
import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import type { TLSSocket } from 'node:tls'
import {
  ACCESS_FILE, CODE_FILE, DEVICE_HEADER, DEVICE_NAME_MAX, MAX_DEVICES, MIN_PASSWORD, PAIRING_MINUTES, deviceKeyHash, matchDevice, newDeviceId, newDeviceKey, RESET_FILE, clearedCookie, cookieName, cookieValues, createBrake, createHashQueue, createSessions, formatCode,
  gate, gateActive, hashPassword, initialAccess, needsRehash, newInstance, fromThisComputer, newSetupCode, passwordProblem, readAccessFile, reachableOf, removeCodeFile,
  sameCode, sameKey, sessionCookie, verifyPassword, viaHttps, proxyHeadersPresent, isLoopback, writeAccessFile, writeCodeFile,
  channelOf, expectedProofs, type Channel, type AccessFile, type AccessMode, type AccessState, type AttemptKind, type AuthSetting, type Device, type EnvPassword, type Stage,
} from './access.ts'
import type { ProxyTrust } from './trustProxy.ts'

export type AccessOptions = {
  dataDir: string
  host: string | undefined
  setting: AuthSetting
  // NKA_ALLOWED_HOSTS, wie es dasteht
  allowedHosts: string | undefined
  runtime: string
  // Programmfenster (#528): Schlüssel dieses Starts aus NKA_WINDOW_KEY, wirksam nur im Fenster und nur über 127.0.0.1
  inWindow?: boolean
  windowKey?: string | null
  // Passwort aus NKA_PASSWORD_FILE oder NKA_PASSWORD (`readEnvPassword`), übernommen mit `applyEnvPassword` nach `start`
  envPassword?: EnvPassword | null
  stage?: Stage
  // Fingerabdruck des Zertifikats, gegen das ein Fenster seinen Beweis rechnet (#528, Schritt 2). Fehlt beim Bau oft
  // noch: Ein neues Zertifikat entsteht erst nach dem Binden (index.ts), dann setzt `useTls` es nach. `null` heißt
  // ohne HTTPS, dann gibt es keine Kopplung.
  tls?: { certSha256: string } | null
  // NKA_TRUST_PROXY (trustProxy.ts): Peers, deren Proxy-Kopfzeilen für den Kanal zählen. Fehlt = keinem vertraut.
  trustProxy?: ProxyTrust
  // Darf ein weitergereichter Ursprung mit diesem Namen einen Beweis binden? Dieselbe Regel wie die Prüfung des Hosts
  // (`originHostRefusal` in requestGuard.ts): null heißt ja, sonst der Satz dazu; fehlt = jeder Name (Durchsicht I2)
  originRefusal?: (hostname: string) => string | null
  // Version für die Antwort von `pair` (das Fenster vergleicht sie mit seiner)
  version?: string
  // Gültigkeit eines Kopplungscodes; kürzer nur im Testgriff NKA_TEST_PAIRING_SECONDS
  pairingSeconds?: number
  log?: (line: string) => void
  logError?: (line: string) => void
  now?: () => number
}

// Was die Oberfläche über den Zugang erfährt (GET /api/auth)
export type AccessInfo = {
  mode: AccessState['mode']
  required: boolean
  signedIn: boolean
  window: boolean
  // Über die Kopfzeile eines gekoppelten Fensters angemeldet; Abmelden bewirkt dort nichts
  device: boolean
  reachable: AccessState['reachable']
  envFixed: boolean
  minLength: number
  runtime: string
  codeFile?: string
  codeFileName?: string
  // Programmfenster koppeln: möglich (Passwort und HTTPS) und wie viele gekoppelt sind (die Zahl nur angemeldet)
  pairing: { available: boolean, devices: number }
}

// Die Vorabfrage der Kopplung (`GET /api/auth/pair`, #528): der Fingerabdruck des eigenen Zertifikats (öffentlich, er
// steht in jedem TLS-Handschlag), ob die Anfrage über HTTPS kam (Kanal `tls` oder `proxy`), und im Kanal `proxy` der
// Ursprung, den der vertraute Proxy weiterreicht. Sie entscheidet nie über Vertrauen; das tut das Fenster selbst.
// `problem`: Der Proxy reicht einen Ursprung weiter, dessen Name die Prüfung des Hosts nicht besteht; dann ist `origin`
// null, denn ein Beweis darauf gälte nie (Durchsicht PR 2, I2). Der Satz sagt, was bei Mietfuchs einzutragen ist.
export type PairPreflight = { app: 'mietfuchs', certSha256: string | null, secure: boolean, origin: string | null, problem?: string }

// Was die Liste der Geräte zeigt: nie den Hash des Schlüssels
export type DeviceInfo = Omit<Device, 'keyHash'> & { current: boolean }

const header = (req: Request, name: string): string | undefined => {
  const value = req.headers[name]
  return Array.isArray(value) ? value[0] : value
}
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const bodyOf = (req: Request): Record<string, unknown> => (isObject(req.body) ? req.body : {})
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const NO_PROXY: ProxyTrust = { configured: false, problems: [], trusts: async () => false }

const minutesText = (seconds: number): string => {
  if (seconds < 60) return seconds === 1 ? 'einer Sekunde' : `${seconds} Sekunden`
  const minutes = Math.ceil(seconds / 60)
  return minutes === 1 ? 'einer Minute' : `${minutes} Minuten`
}

export const browserUrlFor = (url: string, mode: AccessState['mode'], code: string | null): string =>
  mode === 'setup' && code ? `${url}/#einrichtung=${formatCode(code)}` : url

export function createAccess(options: AccessOptions) {
  const { dataDir, host, setting, runtime, inWindow = false, windowKey = null, envPassword = null, stage = 'A', version = '', log = console.log, logError = console.error, now = Date.now } = options
  const pairingMs = (options.pairingSeconds ?? PAIRING_MINUTES * 60) * 1000
  let tls = options.tls ?? null
  const trustProxy = options.trustProxy ?? NO_PROXY
  const originRefusalOf = options.originRefusal ?? (() => null)
  // Der Ursprung im Kanal `proxy`, wenn er binden darf, sonst der Grund
  const boundOrigin = (channel: Channel, origin: string | null): { origin: string | null, problem: string | null } => {
    if (channel !== 'proxy' || origin === null) return { origin: null, problem: null }
    const problem = originRefusalOf(new URL(origin).hostname)
    return problem === null ? { origin, problem: null } : { origin: null, problem }
  }
  // Kanal je Anfrage, einmal in der Vorschaltung bestimmt (dort wird ein Name aus NKA_TRUST_PROXY bei Bedarf aufgelöst)
  const channels = new WeakMap<Request, { channel: Channel, origin: string | null }>()
  const allowedHosts = (options.allowedHosts ?? '').split(',').map((h) => h.trim().toLowerCase()).filter((h) => h && h !== '*')
  const codePath = path.join(dataDir, CODE_FILE)
  const sessions = createSessions({ now })
  const brake = createBrake({ now })
  const hashes = createHashQueue()
  // Bis zum Start streng: Vorher beantwortet der Server ohnehin keine Anfrage (index.ts wartet auf `startup`)
  let state: AccessState = { reachable: reachableOf(host), setting, mode: 'setup', required: true, instance: '000000', hash: null }
  let code: string | null = null
  let failedSinceLogin = 0
  const startLines: string[] = []
  // Gekoppelte Programmfenster wie in zugang.json; `changedAt` der Datei bleibt beim Schreiben von `lastSeen` stehen
  let devices: Device[] = []
  let changedAt = ''
  // Zuletzt gesehen, im Speicher; geschrieben höchstens einmal je Stunde und Gerät
  const seenAt = new Map<string, number>()
  // Der Kopplungscode, nur im Speicher: höchstens einer zugleich, ein neuer ersetzt den alten
  let pairing: { code: string, expiresAt: number } | null = null

  // Nach einem `await` frisch gelesen: Eine zweite Anfrage kann den Zustand inzwischen geändert haben
  const modeNow = (): AccessState['mode'] => state.mode
  // Zählt jede Änderung des Zugangs (Speichern, Zurücksetzen). Eine Route merkt ihn vor dem Rechnen und prüft ihn danach:
  // Lief inzwischen ein Zurücksetzen, gilt ihr Ergebnis nicht mehr (Durchsicht PR 3, M1 bis M3)
  let generation = 0
  const changedSince = (seen: number): boolean => generation !== seen
  const exposed = (): boolean => state.reachable === 'network' || state.setting === 'on'
  const requiredFor = (mode: AccessState['mode']): boolean => state.setting !== 'off' && exposed() && (mode === 'setup' || mode === 'password')

  // Ein neuer Code für Einrichtung, Übergang und `off`: Ohne ihn setzt niemand von außen ein Passwort
  function issueCode(): void {
    code = newSetupCode()
    try {
      writeCodeFile(dataDir, code)
    } catch (err) {
      logError(`Der Einrichtungscode ließ sich nicht in ${codePath} schreiben: ${(err as Error).message}`)
    }
  }
  function dropCode(): void {
    code = null
    try {
      removeCodeFile(dataDir)
    } catch (err) {
      logError(`${CODE_FILE} ließ sich nicht löschen: ${(err as Error).message}`)
    }
  }
  const codeLine = (lead: string): string => `${lead}: ${code ? formatCode(code) : '(nicht erzeugt)'}  (auch in ${codePath})`

  // ---------- Passwort vergessen: Datei `passwort-zuruecksetzen` ----------
  // Wer den Datenordner erreicht, darf zurücksetzen. Geprüft wird nur, ob die Datei da ist, nie ihr Inhalt; beim Start,
  // vor jeder Anmeldung und Einrichtung und höchstens einmal je Sekunde bei einer Anfrage.
  const resetPath = path.join(dataDir, RESET_FILE)
  let resetCheckedAt = -Infinity
  let resetStuck = false
  // Nur eine Datei zählt: Ein Ordner dieses Namens ließe sich nicht löschen und setzte jeden Start zurück
  const resetRequested = (): boolean => {
    try {
      return fs.statSync(resetPath).isFile()
    } catch {
      return false
    }
  }
  function checkReset(throttled = false): void {
    if (throttled && now() - resetCheckedAt < 1000) return
    resetCheckedAt = now()
    if (setting === 'off' || !resetRequested()) {
      resetStuck = false
      return
    }
    if (resetStuck) return
    const file: AccessFile = { version: 1, mode: 'setup', instance: state.instance, changedAt: new Date(now()).toISOString() }
    try {
      writeAccessFile(dataDir, file)
    } catch (err) {
      logError(`Das Zurücksetzen ließ sich nicht speichern (${ACCESS_FILE}): ${(err as Error).message}`)
    }
    generation++
    state = { ...state, mode: 'setup', hash: null, required: requiredFor('setup'), proxyStrict: true }
    // Zurücksetzen heißt neu anfangen: auch gekoppelte Fenster koppeln neu
    devices = []
    changedAt = file.changedAt
    seenAt.clear()
    pairing = null
    sessions.revokeAll()
    brake.reset()
    failedSinceLogin = 0
    issueCode()
    try {
      fs.rmSync(resetPath, { force: true })
    } catch (err) {
      // Bliebe sie liegen, setzte jede Sekunde neu zurück; ein Mal reicht, bis sie verschwindet
      resetStuck = true
      logError(`${RESET_FILE} ließ sich nicht löschen: ${(err as Error).message}. Bitte entfernen Sie die Datei, sonst setzt jeder Start das Passwort erneut zurück.`)
    }
    log('Das Passwort ist zurückgesetzt, alle Geräte sind abgemeldet. Bitte legen Sie ein neues fest.')
    log(codeLine('Einrichtungscode'))
  }

  // ---------- Proxy vor einem lokal lauschenden Mietfuchs ohne Passwort ----------
  // Einmal je Start ins Protokoll, und ab dann zeigt die Oberfläche den Hinweis wie im Übergang, mit Code zum Festlegen
  let proxyNoticed = false
  function noticeProxy(): void {
    if (proxyNoticed || setting === 'off' || state.reachable !== 'local' || state.mode !== 'none') return
    proxyNoticed = true
    state = { ...state, mode: 'transition' }
    issueCode()
    log('Anfragen über einen Proxy erreichen Mietfuchs ohne Passwort. Legen Sie in der Oberfläche ein Passwort fest; mit NKA_AUTH=on verlangt Mietfuchs es auch ohne Proxy-Kopfzeilen.')
    log(codeLine('Einrichtungscode'))
  }

  // Zustand beim Start, vor dem Öffnen der Datenbank (`hasStock` danach wäre immer wahr)
  function start({ hasStock }: { hasStock: boolean }): void {
    const resetAtStart = setting !== 'off' && resetRequested()
    const read = readAccessFile(dataDir)
    if (read.problem) logError(read.problem)
    let file = read.file
    if (resetAtStart) {
      const reset: AccessFile = { version: 1, mode: 'setup', instance: file && file !== 'corrupt' ? file.instance : newInstance(), changedAt: new Date(now()).toISOString() }
      try {
        writeAccessFile(dataDir, reset)
      } catch (err) {
        logError(`Das Zurücksetzen ließ sich nicht speichern (${ACCESS_FILE}): ${(err as Error).message}`)
      }
      file = reset
      try {
        fs.rmSync(resetPath, { force: true })
      } catch (err) {
        resetStuck = true
        logError(`${RESET_FILE} ließ sich nicht löschen: ${(err as Error).message}. Bitte entfernen Sie die Datei, sonst setzt jeder Start das Passwort erneut zurück.`)
      }
    }
    const initial = initialAccess({ reachable: state.reachable, setting, file, hasStock, stage })
    state = { ...initial.state, proxyStrict: resetAtStart }
    const known = initial.write ?? (file && file !== 'corrupt' ? file : null)
    // Geräte nur mit Passwort: Eine von Hand geänderte Datei mit `off` oder `setup` ließe sie sonst bei einer späteren
    // Einrichtung wieder aufleben
    devices = known?.mode === 'password' ? known.devices ?? [] : []
    changedAt = known?.changedAt ?? ''
    if (initial.write) {
      try {
        writeAccessFile(dataDir, initial.write)
      } catch (err) {
        // Streng bleibt es trotzdem: Der Zustand im Speicher ist `setup`
        logError(`${ACCESS_FILE} ließ sich nicht schreiben: ${(err as Error).message}`)
      }
    }
    startLines.length = 0
    const open = state.mode === 'setup' || state.mode === 'transition' || state.mode === 'off'
    if (setting !== 'off' && (exposed() || resetAtStart) && open) issueCode()
    else if (fs.existsSync(codePath)) dropCode()
    if (setting === 'off') {
      if (state.reachable === 'network') startLines.push('Die Anmeldung ist über NKA_AUTH=off abgeschaltet. Mietfuchs ist im Netz ohne Passwort erreichbar.')
      return
    }
    if (resetAtStart) startLines.push('Das Passwort ist zurückgesetzt (Datei passwort-zuruecksetzen). Bitte legen Sie ein neues fest.')
    if (state.mode === 'setup' && (exposed() || resetAtStart)) {
      startLines.push(exposed() ? 'Mietfuchs ist im Netz erreichbar und noch ohne Passwort.' : 'Mietfuchs ist noch ohne Passwort.', codeLine('Einrichtungscode'))
    } else if (state.mode === 'transition') {
      startLines.push(
        'Mietfuchs ist im Netz erreichbar, aber ohne Passwort: Jedes Gerät in Ihrem Netz kann Ihre Daten sehen. Ab Version 1.0 verlangt Mietfuchs hier ein Passwort.',
        codeLine('Einrichtungscode zum Festlegen eines Passworts'),
      )
    } else if (state.mode === 'off' && exposed()) {
      startLines.push('Die Anmeldung ist ausgeschaltet. Mietfuchs ist im Netz ohne Passwort erreichbar.', codeLine('Einrichtungscode zum Einschalten'))
    }
  }

  // ---------- Passwort aus der Umgebung ----------
  // Nach `start`, vor der ersten Anfrage (index.ts wartet darauf). Legt das Passwort nur fest, solange nichts entschieden
  // ist (`setup`, Übergang, `none`), auch gleich nach einem Zurücksetzen: Ein festgelegtes Passwort und eine in der
  // Oberfläche ausgeschaltete Anmeldung bleiben (Durchsicht S3). Ist die Angabe unbrauchbar, bleibt ein Übergang nicht
  // offen, sondern wird zur Einrichtung (S2). Weder Passwort noch Wert stehen im Protokoll.
  async function applyEnvPassword(): Promise<void> {
    if (envPassword === null) return
    const { source } = envPassword
    const notes: string[] = []
    if ('ignored' in envPassword && envPassword.ignored) notes.push(`${envPassword.ignored} wird neben ${source} nicht beachtet.`)
    const skip = (reason: string): void => void startLines.push(...notes, `${source} wird nicht übernommen: ${reason}`)
    if (setting === 'off') return skip('Die Anmeldung ist über NKA_AUTH=off abgeschaltet.')
    if (state.mode === 'password') return skip(`Für Mietfuchs ist schon ein Passwort festgelegt. Ändern lässt es sich unter Einstellungen → Anmeldung; die Angabe ${source} können Sie entfernen.`)
    if (state.mode === 'off') return skip('Die Anmeldung ist in der Oberfläche ausgeschaltet. Einschalten lässt sie sich unter Einstellungen → Anmeldung mit dem Einrichtungscode.')
    const password = 'problem' in envPassword ? null : envPassword.password
    const problem = 'problem' in envPassword ? envPassword.problem : passwordProblem(password)
    if (problem !== null || password === null) {
      logError(`${'problem' in envPassword ? '' : `${source}: `}${problem} Das Passwort wird nicht übernommen.`)
      if (state.mode === 'transition') {
        try {
          save(fileOf('setup'))
        } catch (err) {
          logError(`${ACCESS_FILE} ließ sich nicht schreiben: ${(err as Error).message}`)
          state = { ...state, mode: 'setup', required: requiredFor('setup') }
        }
        if (!code) issueCode()
      }
      if (state.mode === 'setup' && exposed()) {
        startLines.length = 0
        startLines.push(...notes, `Das Passwort aus ${source} ließ sich nicht übernehmen (siehe Fehlerausgabe). Mietfuchs bleibt deshalb geschützt, bis ein Passwort festgelegt ist.`, codeLine('Einrichtungscode'))
      } else {
        startLines.push(...notes)
      }
      return
    }
    const wasReset = state.proxyStrict === true
    try {
      save(fileOf('password', await hashes.run(() => hashPassword(password))))
    } catch (err) {
      logError(`Das Passwort aus ${source} ließ sich nicht speichern (${ACCESS_FILE}): ${(err as Error).message}`)
      startLines.push(...notes)
      return
    }
    dropCode()
    sessions.revokeAll()
    // Die Zeilen von `start` sprachen von Einrichtung, Übergang oder Zurücksetzen samt Code; das gilt nicht mehr
    startLines.length = 0
    startLines.push(
      ...notes,
      `${wasReset ? `Das Passwort ist zurückgesetzt (Datei passwort-zuruecksetzen) und aus ${source} neu festgelegt.` : `Das Passwort für Mietfuchs ist aus ${source} festgelegt.`} Die Angabe gilt nur, solange kein Passwort festgelegt ist; ändern lässt es sich unter Einstellungen → Anmeldung.`,
    )
  }

  const tokensOf = (req: Request): string[] => cookieValues(header(req, 'cookie'), cookieName(state.instance))
  const hasSession = (req: Request): boolean => tokensOf(req).some((token) => sessions.check(token))
  // Das Fenster gilt als angemeldet und als „am Rechner“ (Einrichtung ohne Code): nur im Fenster, nur vom Rechner selbst
  // (127.0.0.1/::1 ohne jede Proxy-Kopfzeile, `fromThisComputer`), zeitkonstant verglichen. Über die Adresse einer
  // Netzwerkkarte ist der Schlüssel wirkungslos; von dort meldet sich ein gekoppeltes Fenster mit Geräteschlüssel über HTTPS an.
  const atWindow = (req: Request): boolean =>
    inWindow && windowKey !== null && fromThisComputer(req.socket.remoteAddress, req.headers) && sameKey(header(req, 'x-mietfuchs-window'), windowKey)
  // Ohne Eintrag (eine Route vor der Vorschaltung) zählt keine Proxy-Kopfzeile
  const channelFor = (req: Request): { channel: Channel, origin: string | null } =>
    channels.get(req) ?? channelOf({ encrypted: (req.socket as TLSSocket).encrypted === true, trustedPeer: false, headers: req.headers })
  // Ein gekoppeltes Fenster (#528, Schritt 2): Kopfzeile `X-Mietfuchs-Device`, nur über HTTPS (Kanal `tls` oder `proxy`)
  // und nur mit Passwort. Über HTTP gilt der Schlüssel nie, auch nicht mit gefälschten Proxy-Kopfzeilen.
  function deviceOf(req: Request): Device | null {
    if (channelFor(req).channel === 'plain' || state.mode !== 'password' || setting === 'off') return null
    const device = matchDevice(devices, header(req, DEVICE_HEADER))
    if (device) noteSeen(device)
    return device
  }
  const signedIn = (req: Request): boolean => atWindow(req) || hasSession(req) || deviceOf(req) !== null

  // ---------- Vorschaltung ----------
  async function middleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    checkReset(true)
    const proxied = proxyHeadersPresent(req.headers)
    // NKA_TRUST_PROXY nur bei Proxy-Kopfzeilen fragen: Eine Anfrage ohne fragt nie DNS
    const trustedPeer = proxied && await trustProxy.trusts(req.socket.remoteAddress)
    channels.set(req, channelOf({ encrypted: (req.socket as TLSSocket).encrypted === true, trustedPeer, headers: req.headers }))
    if (proxied) noticeProxy()
    const signed = signedIn(req)
    const decision = gate(state, {
      method: req.method,
      path: req.path,
      loopback: isLoopback(req.socket.remoteAddress),
      viaProxy: proxied,
      signedIn: signed,
      secFetchSite: header(req, 'sec-fetch-site'),
      origin: header(req, 'origin'),
      host: header(req, 'host'),
      forwardedHost: header(req, 'x-forwarded-host'),
      allowedHosts,
    })
    if (!decision.pass) {
      req.resume()
      res.setHeader('Cache-Control', 'no-store')
      return void res.status(decision.status).json(decision.body)
    }
    if (decision.noStore) res.setHeader('Cache-Control', 'no-store')
    res.locals.shortHealth = decision.shortHealth
    next()
  }

  // ---------- Hilfen der Routen ----------
  const secure = (req: Request): boolean => viaHttps(req.headers, (req.socket as TLSSocket).encrypted === true)
  function newSession(req: Request, res: Response): void {
    const token = sessions.create()
    res.setHeader('Set-Cookie', sessionCookie(state.instance, token, secure(req)))
  }
  // Die Kennung bleibt die des Zustands (fileOf setzt sie ein); aus der Datei übernommen, hielt CodeQL den Cookie-Namen
  // für sensibel, weil dieselbe Datei den Hash trägt (js/clear-text-storage-of-sensitive-data, Fehlalarm)
  function save(file: AccessFile): void {
    writeAccessFile(dataDir, file)
    generation++
    state = { ...state, mode: file.mode, hash: file.hash ?? null, required: requiredFor(file.mode), proxyStrict: false }
    devices = file.devices ?? []
    changedAt = file.changedAt
    if (file.mode !== 'password') pairing = null
  }
  // `fileOf` trägt die Geräte mit (vorher gingen unbekannte Felder verloren), aber nur mit Passwort: Jeder Weg weg davon
  // (ausschalten, zurücksetzen) entfernt sie (Entwurf, Abschnitt 2)
  const fileOf = (mode: AccessMode, hash?: string, list: Device[] = devices): AccessFile => ({
    version: 1, mode, instance: state.instance, ...(hash ? { hash } : {}), changedAt: new Date(now()).toISOString(),
    ...(mode === 'password' && list.length ? { devices: list } : {}),
  })
  // `lastSeen` ändert den Zugang nicht: kein `generation`, `changedAt` bleibt; ein Fehler kostet nur die Angabe
  function noteSeen(device: Device): void {
    const at = now()
    seenAt.set(device.id, at)
    const written = device.lastSeen ? Date.parse(device.lastSeen) : NaN
    if (Number.isFinite(written) && at - written < 60 * 60_000) return
    // Im Speicher auch dann, wenn das Schreiben scheitert: sonst versuchte es jede Anfrage erneut
    devices = devices.map((d) => (d.id === device.id ? { ...d, lastSeen: new Date(at).toISOString() } : d))
    try {
      writeAccessFile(dataDir, { ...fileOf('password', state.hash ?? undefined), changedAt })
    } catch (err) {
      logError(`Der letzte Kontakt eines Programmfensters ließ sich nicht speichern (${ACCESS_FILE}): ${(err as Error).message}`)
    }
  }
  // HTTPS heißt hier: eigenes Zertifikat oder ein vertrauter Proxy davor (dann nur die Bindung an den Ursprung)
  const httpsPossible = (): boolean => tls !== null || trustProxy.configured
  const pairingAvailable = (): boolean => setting !== 'off' && state.mode === 'password' && httpsPossible()
  const deviceInfo = (device: Device, current: Device | null): DeviceInfo => {
    const seen = seenAt.get(device.id)
    return { id: device.id, name: device.name, pairedAt: device.pairedAt, lastSeen: seen ? new Date(seen).toISOString() : device.lastSeen, current: device.id === current?.id }
  }
  // Der Name, wie ihn das Fenster schickt (Rechnername): 1 bis 60 Zeichen ohne Steuerzeichen, sonst ein fester
  const deviceName = (name: unknown): string => {
    // Steuer- und Formatzeichen (auch Richtungswechsel) sowie Zeilen- und Absatztrenner fallen weg
    const clean = typeof name === 'string' ? name.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '').trim() : ''
    return clean.length >= 1 && clean.length <= DEVICE_NAME_MAX ? clean : 'Programmfenster'
  }
  // Zeitkonstant über SHA-256 beider Werte, wie beim Code
  const sameProof = (given: unknown, expected: string): boolean =>
    typeof given === 'string' && crypto.timingSafeEqual(crypto.createHash('sha256').update(given).digest(), crypto.createHash('sha256').update(expected).digest())
  const tooMany = (res: Response, retryAfter: number): void => {
    res.setHeader('Retry-After', String(retryAfter))
    res.status(429).json({ error: `Zu viele Fehlversuche. Bitte versuchen Sie es in ${minutesText(retryAfter)} erneut.`, retryAfter })
  }
  const failed = (req: Request, kind: AttemptKind): void => {
    failedSinceLogin++
    const count = brake.failures(req.socket.remoteAddress ?? '', kind)
    // Zusammengefasst: die ersten fünf, danach jede Zweierpotenz, damit ein Angriff das Protokoll nicht füllt
    if (count <= 5 || (count & (count - 1)) === 0) {
      const what = kind === 'code' ? 'falscher Einrichtungscode' : kind === 'pair' ? 'falscher oder abgelaufener Kopplungscode' : 'falsches Passwort'
      log(`Anmeldung: ${what} von ${req.socket.remoteAddress ?? 'unbekannt'} (${count}. Fehlversuch dieser Adresse).`)
    }
  }

  // Ein Versuch durch die Bremse: gebucht vor dem Rechnen, zurückgenommen bei Erfolg. `null` heißt: schon beantwortet.
  async function attempt(req: Request, res: Response, kind: AttemptKind, check: () => Promise<boolean> | boolean): Promise<boolean | null> {
    const ticket = brake.begin(req.socket.remoteAddress ?? '', kind)
    if (!ticket.ok) {
      tooMany(res, ticket.retryAfter)
      return null
    }
    let ok = false
    try {
      if (ticket.delayMs) await wait(ticket.delayMs)
      ok = await check()
    } finally {
      brake.finish(ticket, ok)
    }
    if (!ok) failed(req, kind)
    return ok
  }
  const checkPassword = (password: unknown) => async (): Promise<boolean> =>
    typeof password === 'string' && state.hash !== null && hashes.run(() => verifyPassword(password, state.hash ?? ''))

  // Darf diese Anfrage das Passwort ändern oder die Anmeldung ausschalten? Mit Sitzung, oder wo die Anmeldung für sie
  // gar nicht gilt (lokal ohne Proxy); das bisherige Passwort braucht sie trotzdem.
  const mayManage = (req: Request): boolean => signedIn(req) || !gateActive(state, proxyHeadersPresent(req.headers))

  function info(req: Request): AccessInfo {
    const here = fromThisComputer(req.socket.remoteAddress, req.headers)
    const window = atWindow(req)
    const device = deviceOf(req) !== null
    return {
      mode: state.mode,
      required: gateActive(state, proxyHeadersPresent(req.headers)),
      signedIn: window || device || hasSession(req),
      window,
      device,
      reachable: state.reachable,
      envFixed: setting !== 'auto',
      minLength: MIN_PASSWORD,
      runtime,
      // Der volle Pfad nur am Rechner selbst; von außen der Name (der Datenordner nennt den Benutzer)
      ...(code ? (here || window ? { codeFile: codePath } : { codeFileName: CODE_FILE }) : {}),
      // Die Zahl der Geräte nur für wen, der sie auch verwalten darf
      pairing: { available: pairingAvailable(), devices: mayManage(req) ? devices.length : 0 },
    }
  }

  // ---------- Routen ----------
  function install(app: Express): void {
    const json = express.json({ limit: '4kb' })

    app.get('/api/auth', (req, res) => {
      checkReset()
      res.json(info(req))
    })

    app.post('/api/auth/login', json, async (req, res) => {
      checkReset()
      if (setting === 'off') return res.status(409).json({ error: 'Die Anmeldung ist über NKA_AUTH=off abgeschaltet.' })
      if (state.mode === 'setup') return res.status(401).json({ error: 'Bitte legen Sie zuerst ein Passwort für Mietfuchs fest.', setup: true })
      if (state.mode !== 'password') return res.status(409).json({ error: 'Für Mietfuchs ist kein Passwort festgelegt.' })
      const { password } = bodyOf(req)
      const seen = generation
      const ok = await attempt(req, res, 'password', checkPassword(password))
      if (ok === null) return
      if (changedSince(seen)) return res.status(401).json(modeNow() === 'setup' ? { error: 'Bitte legen Sie zuerst ein Passwort für Mietfuchs fest.', setup: true } : { error: 'Der Zugang hat sich eben geändert. Bitte melden Sie sich erneut an.', login: true })
      if (!ok) return res.status(401).json({ error: 'Das Passwort stimmt nicht.' })
      const failedAttempts = failedSinceLogin
      failedSinceLogin = 0
      // Mit älteren Parametern gespeichert: jetzt neu gerechnet, mit dem Passwort, das gerade gestimmt hat
      const checked = state.hash
      if (needsRehash(checked) && typeof password === 'string') {
        try {
          const renewed = await hashes.run(() => hashPassword(password))
          // Inzwischen geändert oder ausgeschaltet: dann nicht das alte Passwort zurückschreiben (Durchsicht PR 2, K1)
          if (modeNow() === 'password' && state.hash === checked) save(fileOf('password', renewed))
        } catch (err) {
          logError(`Der Hash des Passworts ließ sich nicht erneuern: ${(err as Error).message}`)
        }
      }
      newSession(req, res)
      res.json({ ok: true, failedAttempts })
    })

    app.post('/api/auth/setup', json, async (req, res) => {
      checkReset()
      if (setting === 'off') return res.status(409).json({ error: 'Die Anmeldung ist über NKA_AUTH=off abgeschaltet.' })
      if (state.mode === 'password') return res.status(409).json({ error: 'Ein Passwort ist schon festgelegt. Ändern lässt es sich in den Einstellungen.' })
      const body = bodyOf(req)
      const withoutPassword = body.withoutPassword === true
      const here = atWindow(req)
      if (!here && (typeof body.code !== 'string' || !body.code.trim())) {
        return res.status(403).json({ error: 'Bitte geben Sie den Einrichtungscode ein. Er steht im Protokoll von Mietfuchs und in der Datei einrichtungscode.txt im Datenordner.' })
      }
      if (!withoutPassword) {
        const problem = passwordProblem(body.password)
        if (problem) return res.status(400).json({ error: problem })
      }
      const seen = generation
      if (!here) {
        const ok = await attempt(req, res, 'code', () => sameCode(body.code, code))
        if (ok === null) return
        if (!ok) return res.status(400).json({ error: 'Der Code stimmt nicht.' })
      }
      // Zwischen Prüfung und Speichern kann eine zweite Einrichtung gelaufen sein
      if (modeNow() === 'password') return res.status(409).json({ error: 'Ein Passwort ist schon festgelegt. Ändern lässt es sich in den Einstellungen.' })
      try {
        if (withoutPassword) {
          save(fileOf('off'))
          issueCode()
          sessions.revokeAll()
          log('Die Anmeldung ist ausgeschaltet. Mietfuchs ist ohne Passwort erreichbar.')
          return res.json({ ok: true, mode: 'off' })
        }
        const hash = await hashes.run(() => hashPassword(body.password as string))
        if (changedSince(seen)) return res.status(409).json({ error: 'Der Zugang hat sich eben geändert. Bitte laden Sie die Seite neu.' })
        if (modeNow() === 'password') return res.status(409).json({ error: 'Ein Passwort ist schon festgelegt. Ändern lässt es sich in den Einstellungen.' })
        save(fileOf('password', hash))
      } catch (err) {
        logError(`Die Anmeldung ließ sich nicht speichern: ${(err as Error).message}`)
        return res.status(500).json({ error: `Die Anmeldung ließ sich nicht speichern (${ACCESS_FILE} im Datenordner).` })
      }
      dropCode()
      sessions.revokeAll()
      failedSinceLogin = 0
      newSession(req, res)
      log('Das Passwort für Mietfuchs ist festgelegt.')
      res.json({ ok: true, mode: 'password' })
    })

    app.post('/api/auth/logout', json, (req, res) => {
      for (const token of tokensOf(req)) sessions.revoke(token)
      res.setHeader('Set-Cookie', clearedCookie(state.instance, secure(req)))
      res.json({ ok: true })
    })

    // Bisheriges Passwort, dann das neue; alle anderen Sitzungen enden, die eigene wird erneuert
    async function confirmed(req: Request, res: Response): Promise<boolean> {
      if (state.mode !== 'password') {
        res.status(409).json({ error: 'Für Mietfuchs ist kein Passwort festgelegt.' })
        return false
      }
      if (!mayManage(req)) {
        res.status(401).json({ error: 'Bitte melden Sie sich an.', login: true })
        return false
      }
      if (atWindow(req)) return true
      const { current } = bodyOf(req)
      if (typeof current !== 'string' || !current) {
        res.status(400).json({ error: 'Bitte geben Sie Ihr bisheriges Passwort ein.' })
        return false
      }
      const seen = generation
      const ok = await attempt(req, res, 'password', checkPassword(current))
      if (ok === null) return false
      if (changedSince(seen)) {
        res.status(409).json({ error: 'Der Zugang hat sich eben geändert. Bitte laden Sie die Seite neu.' })
        return false
      }
      if (!ok) res.status(403).json({ error: 'Das bisherige Passwort stimmt nicht.' })
      return ok
    }
    const stale = (res: Response): void => void res.status(409).json({ error: 'Der Zugang hat sich eben geändert. Bitte laden Sie die Seite neu.' })

    app.put('/api/auth/password', json, async (req, res) => {
      const body = bodyOf(req)
      const problem = passwordProblem(body.password)
      if (state.mode === 'password' && mayManage(req) && problem) return res.status(400).json({ error: problem })
      if (!(await confirmed(req, res))) return
      const seen = generation
      try {
        const hash = await hashes.run(() => hashPassword(body.password as string))
        if (changedSince(seen)) return stale(res)
        save(fileOf('password', hash))
      } catch (err) {
        logError(`Das Passwort ließ sich nicht speichern: ${(err as Error).message}`)
        return res.status(500).json({ error: `Das Passwort ließ sich nicht speichern (${ACCESS_FILE} im Datenordner).` })
      }
      // Lief parallel ein Ausschalten, gilt das Passwort; ein Code dazu wäre ein offenes Ende (Durchsicht PR 2, K2)
      if (code) dropCode()
      // Ein offener Kopplungscode stammt aus der Zeit davor
      pairing = null
      sessions.revokeAll()
      newSession(req, res)
      log('Das Passwort für Mietfuchs ist geändert; alle anderen Geräte sind abgemeldet.')
      res.json({ ok: true })
    })

    app.post('/api/auth/off', json, async (req, res) => {
      if (setting === 'off') return res.status(409).json({ error: 'Die Anmeldung ist über NKA_AUTH=off abgeschaltet.' })
      if (!(await confirmed(req, res))) return
      try {
        save(fileOf('off'))
      } catch (err) {
        logError(`Die Anmeldung ließ sich nicht ausschalten: ${(err as Error).message}`)
        return res.status(500).json({ error: `Die Anmeldung ließ sich nicht ausschalten (${ACCESS_FILE} im Datenordner).` })
      }
      issueCode()
      sessions.revokeAll()
      res.setHeader('Set-Cookie', clearedCookie(state.instance, secure(req)))
      log(`Die Anmeldung ist ausgeschaltet. ${codeLine('Einrichtungscode zum Einschalten')}`)
      res.json({ ok: true, mode: 'off' })
    })

    app.post('/api/auth/logout-all', json, async (req, res) => {
      if (!(await confirmed(req, res))) return
      const own = tokensOf(req).find((token) => sessions.check(token))
      if (own) sessions.revokeAllExcept(own)
      else sessions.revokeAll()
      // Wer überall abmeldet, will auch keinen offenen Kopplungscode mehr; gekoppelte Fenster bleiben
      pairing = null
      log('Alle anderen Geräte sind von Mietfuchs abgemeldet.')
      res.json({ ok: true })
    })

    // ---------- Programmfenster koppeln (#528, Schritt 2) ----------
    const noPassword = (res: Response): void => void res.status(409).json({ error: setting === 'off' ? 'Die Anmeldung ist über NKA_AUTH=off abgeschaltet.' : 'Legen Sie zuerst ein Passwort fest.' })
    const notSignedIn = (res: Response): void => void res.status(401).json({ error: 'Bitte melden Sie sich an.', login: true })

    // Ein Code für das Fenster, nur im Speicher und nie im Protokoll; ein neuer ersetzt den alten
    app.post('/api/auth/pairing', json, (req, res) => {
      checkReset()
      if (setting === 'off' || state.mode !== 'password') return noPassword(res)
      if (!mayManage(req)) return notSignedIn(res)
      if (!httpsPossible()) return res.status(409).json({ error: 'Mietfuchs antwortet hier nur über HTTP. Ohne HTTPS lässt sich kein Programmfenster koppeln.' })
      pairing = { code: newSetupCode(), expiresAt: now() + pairingMs }
      res.setHeader('Cache-Control', 'no-store')
      res.json({ code: formatCode(pairing.code), expiresAt: new Date(pairing.expiresAt).toISOString() })
    })

    app.delete('/api/auth/pairing', (req, res) => {
      checkReset()
      if (!mayManage(req)) return notSignedIn(res)
      pairing = null
      res.json({ ok: true })
    })

    // Die Vorabfrage: frei wie das Koppeln, ohne Bremse (sie prüft nichts), nie zwischengespeichert
    app.get('/api/auth/pair', (req, res) => {
      checkReset()
      const { channel, origin } = channelFor(req)
      const bound = boundOrigin(channel, origin)
      const body: PairPreflight = { app: 'mietfuchs', certSha256: tls?.certSha256 ?? null, secure: channel !== 'plain', origin: bound.origin, ...(bound.problem ? { problem: bound.problem } : {}) }
      res.setHeader('Cache-Control', 'no-store')
      res.json(body)
    })

    // Frei wie login: Der Beweis über Code und Zertifikat bzw. Ursprung ist die Anmeldung. Der Code wird in derselben
    // synchronen Prüfung verbraucht, in der er stimmt; zwei gleichzeitige Versuche bekommen so höchstens ein Gerät.
    // `transport: true`: Der Fehler liegt an der Verbindung, nicht am Code (das Fenster ordnet ihn nicht dem Feld Code zu).
    app.post('/api/auth/pair', json, async (req, res) => {
      checkReset()
      const { channel, origin } = channelFor(req)
      if (channel === 'plain') {
        return res.status(400).json({
          error: proxyHeadersPresent(req.headers)
            ? 'Mietfuchs steht hinter einem Proxy, dem es nicht vertraut, oder der Proxy meldet kein HTTPS. Tragen Sie den Proxy in NKA_TRUST_PROXY ein.'
            : 'Koppeln geht nur über eine verschlüsselte Verbindung.',
          transport: true,
        })
      }
      if (setting === 'off' || state.mode !== 'password') return noPassword(res)
      const full = (): void => void res.status(409).json({ error: `Es sind schon ${MAX_DEVICES} Programmfenster gekoppelt. Entfernen Sie zuerst eines in den Einstellungen unter „Anmeldung“.` })
      if (devices.length >= MAX_DEVICES) return full()
      const { name, proof } = bodyOf(req)
      const ok = await attempt(req, res, 'pair', () => {
        const open = pairing
        if (!open || now() >= open.expiresAt) return false
        // Jeder erwartete Beweis wird verglichen, zeitkonstant, auch wenn schon einer passt
        // Ein Ursprung, dessen Name die Prüfung des Hosts nicht besteht, bindet nichts (Durchsicht I2)
        const matches = expectedProofs(open.code, channel, tls?.certSha256 ?? null, boundOrigin(channel, origin).origin).map((expected) => sameProof(proof, expected))
        if (!matches.includes(true)) return false
        pairing = null
        return true
      })
      if (ok === null) return
      // Ein Ursprung, der nicht binden kann: Das liegt am Namen, nicht am Code (sonst probierte der Nutzer endlos neue Codes).
      // Ein Beweis über den Fingerabdruck gilt trotzdem und kam oben schon durch.
      const refused = boundOrigin(channel, origin).problem
      if (!ok && refused) return res.status(400).json({ error: refused, transport: true })
      if (!ok) return res.status(400).json({ error: 'Der Code stimmt nicht oder ist abgelaufen.' })
      if (state.mode !== 'password') return noPassword(res)
      if (devices.length >= MAX_DEVICES) return full()
      const deviceKey = newDeviceKey()
      const device: Device = { id: newDeviceId(), name: deviceName(name), keyHash: deviceKeyHash(deviceKey), pairedAt: new Date(now()).toISOString(), lastSeen: null }
      try {
        save(fileOf('password', state.hash ?? undefined, [...devices, device]))
      } catch (err) {
        logError(`Das Programmfenster ließ sich nicht koppeln: ${(err as Error).message}`)
        return res.status(500).json({ error: `Das Programmfenster ließ sich nicht koppeln (${ACCESS_FILE} im Datenordner).` })
      }
      log(`Ein Programmfenster ist gekoppelt („${device.name}“).`)
      res.setHeader('Cache-Control', 'no-store')
      res.json({ id: device.id, deviceKey, version })
    })

    // Geräte gibt es nur mit Passwort; ohne antworten Liste und Entfernen wie das Koppeln
    app.get('/api/auth/devices', (req, res) => {
      checkReset()
      if (setting === 'off' || state.mode !== 'password') return noPassword(res)
      if (!mayManage(req)) return notSignedIn(res)
      const current = deviceOf(req)
      res.json({ devices: devices.map((d) => deviceInfo(d, current)) })
    })

    app.delete('/api/auth/devices/:id', (req, res) => {
      checkReset()
      if (setting === 'off' || state.mode !== 'password') return noPassword(res)
      if (!mayManage(req)) return notSignedIn(res)
      const id = String(req.params.id)
      const removed = devices.find((d) => d.id === id)
      if (!removed) return res.status(404).json({ error: 'Dieses Programmfenster ist nicht (mehr) gekoppelt.' })
      try {
        save(fileOf('password', state.hash ?? undefined, devices.filter((d) => d.id !== id)))
      } catch (err) {
        logError(`Das Programmfenster ließ sich nicht entfernen: ${(err as Error).message}`)
        return res.status(500).json({ error: `Das Programmfenster ließ sich nicht entfernen (${ACCESS_FILE} im Datenordner).` })
      }
      seenAt.delete(id)
      log(`Das Programmfenster „${removed.name}“ ist entfernt.`)
      res.json({ ok: true })
    })
  }

  // Die Adresse, die die Programmdatei beim Start im Browser öffnet: in der Einrichtung mit dem Code im Fragment, das
  // nicht an den Server und nicht in den Referer geht
  const browserUrl = (url: string): string => browserUrlFor(url, state.mode, code)

  return {
    start,
    browserUrl,
    middleware,
    install,
    startLines: (): readonly string[] => startLines,
    applyEnvPassword,
    // Das Zertifikat entsteht oft erst nach dem Bau (index.ts); ab dann lässt sich koppeln
    useTls: (next: { certSha256: string } | null): void => {
      tls = next
    },
    state: (): AccessState => state,
  }
}
export type Access = ReturnType<typeof createAccess>

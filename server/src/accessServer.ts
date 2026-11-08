// Zugang im Server (#528, Schritt 1): Vorschaltung und Routen unter /api/auth um den Kern aus access.ts. Eingehängt in
// index.ts nach der Host-Prüfung und vor dem Vermerk „umgezogen“ und vor `express.json()`, damit ein ungeprüfter Rumpf
// nicht gelesen wird. Die Regeln stehen in server/src/CLAUDE.md („Anmeldung“).
import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import {
  ACCESS_FILE, CODE_FILE, MIN_PASSWORD, RESET_FILE, clearedCookie, cookieName, cookieValues, createBrake, createHashQueue, createSessions, formatCode,
  gate, gateActive, hashPassword, initialAccess, needsRehash, newInstance, isLoopback, newSetupCode, passwordProblem, readAccessFile, reachableOf, removeCodeFile,
  sameCode, sessionCookie, verifyPassword, viaHttps, viaProxy, writeAccessFile, writeCodeFile,
  type AccessFile, type AccessMode, type AccessState, type AttemptKind, type AuthSetting, type Stage,
} from './access.ts'

export type AccessOptions = {
  dataDir: string
  host: string | undefined
  setting: AuthSetting
  // NKA_ALLOWED_HOSTS, wie es dasteht
  allowedHosts: string | undefined
  runtime: string
  stage?: Stage
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
  reachable: AccessState['reachable']
  envFixed: boolean
  minLength: number
  runtime: string
  codeFile?: string
  codeFileName?: string
}

const header = (req: Request, name: string): string | undefined => {
  const value = req.headers[name]
  return Array.isArray(value) ? value[0] : value
}
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const bodyOf = (req: Request): Record<string, unknown> => (isObject(req.body) ? req.body : {})
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const minutesText = (seconds: number): string => {
  if (seconds < 60) return seconds === 1 ? 'einer Sekunde' : `${seconds} Sekunden`
  const minutes = Math.ceil(seconds / 60)
  return minutes === 1 ? 'einer Minute' : `${minutes} Minuten`
}

export const browserUrlFor = (url: string, mode: AccessState['mode'], code: string | null): string =>
  mode === 'setup' && code ? `${url}/#einrichtung=${formatCode(code)}` : url

export function createAccess(options: AccessOptions) {
  const { dataDir, host, setting, runtime, stage = 'A', log = console.log, logError = console.error, now = Date.now } = options
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

  const tokensOf = (req: Request): string[] => cookieValues(header(req, 'cookie'), cookieName(state.instance))
  const hasSession = (req: Request): boolean => tokensOf(req).some((token) => sessions.check(token))
  // Bisher nur die Sitzung; den Fensterschlüssel prüft die Fassung mit dem Programmfenster (Aufgabe 4)
  const atWindow = (_req: Request): boolean => false
  const signedIn = (req: Request): boolean => atWindow(req) || hasSession(req)

  // ---------- Vorschaltung ----------
  function middleware(req: Request, res: Response, next: NextFunction): void {
    checkReset(true)
    const proxied = viaProxy(req.headers)
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
  const secure = (req: Request): boolean => viaHttps(req.headers)
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
  }
  const fileOf = (mode: AccessMode, hash?: string): AccessFile => ({ version: 1, mode, instance: state.instance, ...(hash ? { hash } : {}), changedAt: new Date(now()).toISOString() })
  const tooMany = (res: Response, retryAfter: number): void => {
    res.setHeader('Retry-After', String(retryAfter))
    res.status(429).json({ error: `Zu viele Fehlversuche. Bitte versuchen Sie es in ${minutesText(retryAfter)} erneut.`, retryAfter })
  }
  const failed = (req: Request, kind: AttemptKind): void => {
    failedSinceLogin++
    const count = brake.failures(req.socket.remoteAddress ?? '', kind)
    // Zusammengefasst: die ersten fünf, danach jede Zweierpotenz, damit ein Angriff das Protokoll nicht füllt
    if (count <= 5 || (count & (count - 1)) === 0) {
      log(`Anmeldung: ${kind === 'code' ? 'falscher Einrichtungscode' : 'falsches Passwort'} von ${req.socket.remoteAddress ?? 'unbekannt'} (${count}. Fehlversuch dieser Adresse).`)
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
  const mayManage = (req: Request): boolean => signedIn(req) || !gateActive(state, viaProxy(req.headers))

  function info(req: Request): AccessInfo {
    const here = isLoopback(req.socket.remoteAddress) && !viaProxy(req.headers)
    const window = atWindow(req)
    return {
      mode: state.mode,
      required: gateActive(state, viaProxy(req.headers)),
      signedIn: signedIn(req),
      window,
      reachable: state.reachable,
      envFixed: setting !== 'auto',
      minLength: MIN_PASSWORD,
      runtime,
      // Der volle Pfad nur am Rechner selbst; von außen der Name (der Datenordner nennt den Benutzer)
      ...(code ? (here || window ? { codeFile: codePath } : { codeFileName: CODE_FILE }) : {}),
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
      log('Alle anderen Geräte sind von Mietfuchs abgemeldet.')
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
    state: (): AccessState => state,
  }
}
export type Access = ReturnType<typeof createAccess>

// Das eigene Programmfenster von Mietfuchs unter Windows und macOS (#517). Electron ist hier nur das Fenster: Der
// Server läuft mit Electrons eigenem Node als utilityProcess (so empfiehlt es Electron für Hintergrundprozesse mit Node),
// ausgeliefert als eine gebündelte Datei in der app.asar, beim Entwickeln aus dem Quellcode. Er lauscht auf 127.0.0.1, und das Fenster
// zeigt seine Oberfläche. Server, Oberfläche und Datenbank wissen davon nur, dass sie keinen Browser öffnen und mit dem Fenster enden (Betriebsart desktop,
// server/src/version.ts). Eine eigene Programmdatei für den Server gibt es im Fenster nicht: eine ausführbare Datei
// weniger, die Virenscanner prüfen und die signiert wird, und rund 100 MB weniger je Architektur.
//
// Sicherheit nach der Checkliste von Electron: Die Seite läuft ohne Node in der Sandbox, die Brücke (preload.cjs)
// kennt nur das Drucken, den Zugriff aus dem Heimnetz, die Wahl des alten Ordners beim Umzug, die automatischen Updates und die Verbindung mit einem
// Mietfuchs im Heimnetz (bridgePolicy.js), Navigation und neue Fenster bleiben auf der eigenen Adresse, fremde Links öffnet der
// Standardbrowser, Berechtigungen (Kamera, Standort …) werden abgelehnt.
//
// Mit einem Mietfuchs im Heimnetz gekoppelt (#528, Schritt 2, pairing.js) startet das Fenster keinen eigenen Server: Es
// zeigt die Seite des gekoppelten über HTTPS, nimmt für dessen Host nur das gemerkte Zertifikat an und schickt den
// Geräteschlüssel nur dorthin.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import tls from 'node:tls'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, Menu, app, dialog, ipcMain, session, shell, utilityProcess } from 'electron'
import { TICK_MS, UPDATE_REPO, createUpdaterController, initialUpdaterState, shouldOfferMove, trustedUpdateKeys, updaterSource } from './updater.js'
import { loopbackUrl, selftestPlan, testCa, testGripsAllowed, testUserData } from './testGrips.js'
import { allowed } from './bridgePolicy.js'
import { DEVICE_HEADER, certSha256FromPem, issuedBy, jsonOr, pair, pinDecision, rejectedKeyReason, remoteFetch, systemTrust, versionHint } from './pairing.js'
import { readSettingsFile, writeSettingsFile, DEFAULT_PORT, SERVICE_NAME, blockedFileIn, childWebPreferences, quitDecision, rememberDataDir, frameTarget, findBlockedFile, freePort, isAppPage, isReceipt, linkTarget, navigationTarget, networkState, programFiles, serverEnv, serverModule, startFailure, startUrlIn, surfaceWindow, trustedSender, whoIsOn, chosenFolder, folderDialogProperties } from './server.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const startedAt = Date.now()
// Selbstprüfung in Prüfläufen (testGrips.js), sonst null
const selftest = selftestPlan(process.env)
// Eine Test-CA in Prüfläufen (testGrips.js, hinter beiden Schranken), die das Fenster wie eine des Systems behandelt,
// sonst null
const testCaPem = testCa(process.env)

/**
 * Die Vertrauensanker für eine Kopplung in `system` (pairing.js): der Speicher des Systems, in Prüfläufen dazu die
 * Test-CA
 * @returns {string[]}
 */
const trustAnchors = () => (testCaPem ? [...systemTrust(), testCaPem] : systemTrust())

// Electrons eigener Ordner (Zwischenspeicher, Einstellungen des Fensters) nicht unter „Mietfuchs“: Auf dem Mac heißt
// der Datenordner von Mietfuchs so (~/Library/Application Support/Mietfuchs), und beide sollen sich nie mischen. Unter
// Windows unter Local statt Roaming, sonst wanderte der Zwischenspeicher mit dem Profil (Durchsicht K11).
// In Prüfläufen ein eigener Ordner je Start (testUserData, hinter beiden Schranken): fenster.json, Protokoll und die
// Sperre gegen einen zweiten Start hängen an userData, ein laufendes echtes Fenster bleibt so unberührt.
const localAppData = process.platform === 'win32' && process.env.LOCALAPPDATA ? process.env.LOCALAPPDATA : app.getPath('appData')
app.setPath('userData', testUserData(process.env) ?? path.join(localAppData, 'mietfuchs-fenster'))

// Ab wann die Startseite sagt, dass es dauert. Abgebrochen wird nicht: Beim ersten Start einer neuen Version migriert
// der Server die Datenbank und legt vorher eine Sicherung an, bei einem großen Bestand dauert das, und ein Abbruch
// ließe den nächsten Start von vorn beginnen (Durchsicht M2).
const SLOW_START_MS = 15_000
// Wie viel Ausgabe des Servers das Fenster für Meldungen behält; die ganze steht im Protokoll.
const OUTPUT_LIMIT = 64 * 1024
// Wie lange das Beenden auf den Server wartet, bevor es ihn hart beendet. Der Server selbst wartet höchstens fünf
// Sekunden auf einen laufenden Schreibvorgang (QUIT_DRAIN_MS in server/src/index.ts).
const QUIT_TIMEOUT_MS = 8000
// Ohne Adresse läuft der Start noch, vielleicht eine Migration über einen großen Bestand; der Server beendet sich erst
// danach (Durchsicht M2). Hart beendet wird er dann erst nach zehn Minuten, sonst bräche gerade das ab, was die Regel
// schützt. Das Fenster ist dann schon zu, nur der Prozess wartet.
const START_QUIT_TIMEOUT_MS = 10 * 60_000
// Läuft beim Beenden ein Wiederherstellen oder eine Übernahme, wartet der Server bis zwei Minuten darauf
// (QUIT_RESTORE_WAIT_MS); das Fenster etwas länger
const BUSY_QUIT_TIMEOUT_MS = 150_000

/** @typedef {import('./server.js').WindowSettings} WindowSettings */
/** @typedef {import('./server.js').RemoteSettings} RemoteSettings */

// fenster.json, nur für den Benutzer lesbar (darin steht mit einer Kopplung der Geräteschlüssel, server.js)
const settingsFile = () => path.join(app.getPath('userData'), 'fenster.json')
const readSettings = () => readSettingsFile(settingsFile())
/** @param {WindowSettings} settings */
const writeSettings = (settings) => writeSettingsFile(settingsFile(), settings)

/** @type {Electron.UtilityProcess | null} */
let server = null
// Beendete Server; ein utilityProcess kennt kein `exitCode`
/** @type {WeakSet<Electron.UtilityProcess>} */
const exited = new WeakSet()
let serverOutput = ''
// Der Datenordner, einmal je Start des Servers aus der Zeile „Daten: …“ gemerkt (rememberDataDir)
/** @type {string | null} */
let serverDataDir = null
/** @type {string | null} */
let origin = null
// Die Kopplung mit einem Mietfuchs im Heimnetz (#528, Schritt 2); dann ist `origin` dessen Adresse und `server` null
/** @type {RemoteSettings | null} */
let remote = null
/** @type {BrowserWindow | null} */
let mainWindow = null
let quitting = false
// Gesetzt unmittelbar vor app.exit am Ende des Beendens (quitDecision)
let exiting = false
// Server, die das Fenster absichtlich beendet (Beenden, Neustart für den Zugriff aus dem Heimnetz): Ihr Ende ist kein
// Absturz, also weder die Meldung „unerwartet beendet“ noch das Ende des Fensters.
/** @type {WeakSet<Electron.UtilityProcess>} */
const retired = new WeakSet()
// Ein laufender Neustart; ein zweiter wartet, bis er fertig ist (Doppelklick, zweites Fenster eines Belegs).
/** @type {Promise<unknown>} */
let restarting = Promise.resolve()
// Automatische Updates (updater.js), nur im installierten Fenster unter Windows
/** @type {ReturnType<typeof createUpdaterController> | null} */
let updates = null
// Erfüllt, sobald feststeht, ob es Updates gibt (Durchsicht S1): Die Seite fragt beim Laden womöglich früher
/** @type {() => void} */
let updaterSettled = () => {}
const updaterReady = new Promise((resolve) => { updaterSettled = () => resolve(null) })

// Die Ausgabe des Servers in eine Datei, damit sich ein gescheiterter Start erklären lässt; die vorige bleibt daneben.
// Ebenso das Protokoll der Updates (updater.log).
function openLog(name = 'server') {
  const dir = path.join(app.getPath('userData'), 'protokoll')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${name}.log`)
  try {
    fs.renameSync(file, path.join(dir, `${name}.vorher.log`))
  } catch {
    // beim ersten Start gibt es noch keins
  }
  return fs.createWriteStream(file)
}

/**
 * Port wählen: der gemerkte oder 17517. Sitzt dort ein anderes Programm, nimmt das Fenster einen freien Port und merkt
 * ihn sich, damit die Adresse danach gleich bleibt. Antwortet dort Mietfuchs, ist es das eines anderen Benutzers
 * desselben Rechners (eine Waise des eigenen Fensters beendet sich selbst): Das bleibt unangetastet, und dieser Start
 * nimmt einen freien Port, ohne ihn zu merken (Durchsicht K7).
 * @param {WindowSettings} settings
 */
async function choosePort(settings) {
  const wanted = settings.port ?? DEFAULT_PORT
  let who = await whoIsOn(wanted)
  // Ein Mietfuchs mitten in einer Migration antwortet vielleicht nicht in zwei Sekunden; nicht gleich als fremd werten
  for (let i = 0; i < 3 && who === 'other'; i++) who = await whoIsOn(wanted)
  if (who === 'free') return wanted
  const port = await freePort()
  if (who === 'other') writeSettings({ ...settings, port })
  return port
}

/**
 * @param {WindowSettings} settings
 * @param {number} [fixedPort] beim Neustart der bisherige Port, damit Adresse und Entwürfe im Browser-Speicher bleiben
 * @returns {Promise<string>}
 */
async function startServer(settings, fixedPort) {
  const port = fixedPort ?? await choosePort(settings)
  // Je Start ein neuer Fensterschlüssel (#528): Damit gilt das Fenster als angemeldet, auch mit Passwort im Heimnetz
  windowKey = crypto.randomBytes(32).toString('base64url')
  const repoRoot = path.resolve(here, '..', '..')
  const { modulePath, cwd } = serverModule({ packaged: app.isPackaged, platform: process.platform, resourcesPath: process.resourcesPath, repoRoot })
  const log = openLog()
  log.write(`Fenster: Electron ${process.versions.electron}, Node ${process.versions.node}, Store ${process.windowsStore === true ? 'ja' : 'nein'}, Server ${modulePath}\n`)
  // Mit dem Hauptprozess endet auch der utilityProcess, nach einem Absturz des Fensters ebenso wie beim Abmelden unter
  // Windows; es bleibt keine Waise, die Port und Datenbank hält (scripts/desktop-check.mjs, Schritt 5). Seine
  // Standardeingabe ist immer leer, Ausgabe und Fehler gehen über Pipes ins Protokoll. Ein Konsolenfenster gibt es
  // nicht, der utilityProcess ist Electron selbst.
  const child = utilityProcess.fork(modulePath, [], {
    cwd,
    env: serverEnv(process.env, { port, network: settings.network === true, packaged: app.isPackaged, windowsStore: process.windowsStore === true, repoRoot, platform: process.platform, searchDirs: knownFolders(), windowKey }),
    stdio: 'pipe',
    serviceName: SERVICE_NAME,
  })
  server = child
  serverOutput = ''
  serverDataDir = null
  // Als Text, mit Umlauten auch über die Grenze zweier Blöcke hinweg („läuft auf“ in der Startzeile)
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  const collect = (/** @type {string} */ text) => {
    serverOutput = (serverOutput + text).slice(-OUTPUT_LIMIT)
    serverDataDir = rememberDataDir(serverDataDir, serverOutput)
    log.write(text)
  }
  child.stdout?.on('data', collect)
  child.stderr?.on('data', collect)
  let ready = false
  const slow = setTimeout(() => {
    void mainWindow?.loadURL(page('<p>Mietfuchs richtet Ihre Daten ein. Bei vielen Belegen dauert das einige Minuten.</p>'))
  }, SLOW_START_MS)
  return new Promise((resolve, reject) => {
    // Das Ende des Servers gleich hier, nicht erst nach dem Start: Dazwischen ginge sonst ein Absturz verloren
    // (Durchsicht K6). Vor dem Start scheitert der Start, danach geht das Fenster mit, aus der Oberfläche beendet
    // (Code 0) ohne Meldung.
    child.once('exit', (code) => {
      windowLog(`Server zu Ende (Code ${code})`)
      exited.add(child)
      clearTimeout(slow)
      // Nach einem Neustart läuft schon der nächste; den nicht vergessen
      if (server === child) server = null
      if (!ready) return reject(new Error(`Der Server hat sich beim Start beendet (Code ${code}).`))
      if (quitting || retired.has(child)) return
      if (code !== 0) {
        dialog.showErrorBox('Mietfuchs wurde unerwartet beendet', `${lastLines(serverOutput)}\n\nDas Protokoll liegt unter ${path.join(app.getPath('userData'), 'protokoll')}.`)
      }
      app.quit()
    })
    // Ein Fehler, nach dem V8 nicht weiterkann; `exit` folgt trotzdem und entscheidet
    child.once('error', (type, location) => {
      log.write(`Der Server ist abgestürzt: ${type} in ${location}\n`)
    })
    const onData = () => {
      const url = startUrlIn(serverOutput)
      if (!url) return
      ready = true
      clearTimeout(slow)
      child.stdout?.off('data', onData)
      resolve(url)
    }
    child.stdout?.on('data', onData)
  })
}

// Downloads, Schreibtisch und Dokumente, wie das System sie nennt, für die Suche beim Umzug der Daten (#517). Unter
// Windows liegen sie oft im OneDrive-Ordner, dessen Name sich nicht ableiten lässt.
function knownFolders() {
  /** @type {string[]} */
  const dirs = []
  for (const name of /** @type {const} */ (['downloads', 'desktop', 'documents'])) {
    try {
      dirs.push(app.getPath(name))
    } catch { /* gibt es auf diesem System nicht */ }
  }
  return dirs
}

// Ablauf des Fensters mit Zeitstempeln nach userData\protokoll\fenster.log: Schließen, Beenden, Antwort auf /api/quit,
// Ende des Servers. Synchron angehängt, damit auch ein jähes Ende die Zeilen davor nicht verliert (gefunden beim
// Installer, der Mietfuchs bei laufendem Fenster schließt, #548/#549).
/** @param {string} line */
function windowLog(line) {
  try {
    const dir = path.join(app.getPath('userData'), 'protokoll')
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(path.join(dir, 'fenster.log'), `${new Date().toISOString()} [${process.pid}] ${line}\n`)
  } catch { /* nur Auskunft */ }
}

/** @param {string} text */
const lastLines = (text) => text.trim().split('\n').slice(-12).join('\n')

// Der Start ist gescheitert. Hat ein Virenschutz eine Datei des Programms gesperrt oder entfernt, sagt die Meldung das
// und was zu tun ist (auf einem echten Rechner blockierte HP Wolf Security das Bündel); die technische Meldung steht
// klein darunter. Erst die Dateien selbst prüfen, dann die Ausgabe: Die kommt bei einem Fehler in der asar nicht immer an.
/** @param {string} title @param {unknown} err */
function showStartFailure(title, err) {
  const technical = `${err instanceof Error ? err.message : String(err)}\n\n${lastLines(serverOutput)}`
  const where = { packaged: app.isPackaged, platform: process.platform, resourcesPath: process.resourcesPath, repoRoot: path.resolve(here, '..', '..') }
  const found = findBlockedFile(programFiles(where)) ?? blockedFileIn(technical, path.dirname(process.resourcesPath), process.platform)
  const failure = startFailure({ found, technical, logDir: path.join(app.getPath('userData'), 'protokoll'), platform: process.platform })
  dialog.showMessageBoxSync({ type: failure.title ? 'warning' : 'error', title: failure.title ?? title, message: failure.message, detail: failure.detail, buttons: ['OK'] })
}

// ---------- Fensterschlüssel (#528) ----------
// Der Server erkennt das Fenster an der Kopfzeile X-Mietfuchs-Window, nur über 127.0.0.1 und nur im Fenster
// (server/src/accessServer.ts). Die Seite bekommt sie über `onBeforeSendHeaders`, nur für Anfragen an den eigenen
// Server; „Im Browser öffnen“ geht ohne Schlüssel. Abrufe des Hauptprozesses gehen über serverFetch.
/** @type {string | null} */
let windowKey = null

/** @param {string} urlPath @param {RequestInit} [init] */
function serverFetch(urlPath, init = {}) {
  const headers = { ...(/** @type {Record<string, string>} */ (init.headers ?? {})), ...(windowKey ? { 'X-Mietfuchs-Window': windowKey } : {}) }
  return fetch(`${origin}${urlPath}`, { ...init, headers })
}

// Nach jedem Setzen von `origin`. Der Filter nimmt nur den eigenen Ursprung, die Prüfung im Rückruf hält auch ein
// anderes Schema oder einen anderen Port fern und einen Ursprung, der inzwischen nicht mehr gilt; mit einem Server von
// außen (MIETFUCHS_SERVER_URL) gibt es keinen Schlüssel. Gekoppelt (#528, Schritt 2) geht statt des Fensterschlüssels
// der Geräteschlüssel mit, nur an `${origin}/*` des gekoppelten Servers, also über HTTPS.
function attachWindowKey() {
  if (!origin) return
  const own = origin
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: [`${origin}/*`] }, (details, callback) => {
    const headers = { ...details.requestHeaders }
    if (own === origin && new URL(details.url).origin === own) {
      if (remote) {
        if (remote.origin === own) headers[DEVICE_HEADER] = `${remote.deviceId}.${remote.deviceKey}`
      } else if (windowKey) headers['X-Mietfuchs-Window'] = windowKey
    }
    callback({ requestHeaders: headers })
  })
}

// Erst über die Oberfläche beenden, damit der Server seine Schreibvorgänge abschließt; unter Windows kennt ein
// Kindprozess kein SIGTERM, `kill()` beendete ihn sofort. Ohne Adresse (Fenster während des Starts geschlossen) die
// Nachricht „quit“ über `process.parentPort`; der Server startet dann zu Ende und beendet sich (server/src/index.ts).
async function stopServer() {
  const child = server
  if (!child || exited.has(child)) return
  retired.add(child)
  const gone = new Promise((resolve) => child.once('exit', resolve))
  const started = origin !== null
  let busy = false
  windowLog(`Server beenden (pid ${child.pid ?? '?'}, ${origin ? `über ${origin}/api/quit` : 'über parentPort'})`)
  if (origin) {
    const answer = await serverFetch('/api/quit', { method: 'POST', signal: AbortSignal.timeout(3000) })
      .then(async (res) => { windowLog(`/api/quit: ${res.status}`); return res.json() })
      .catch((err) => { windowLog(`/api/quit gescheitert: ${err}`); return null })
    busy = /** @type {any} */ (answer)?.busy === true
  } else child.postMessage('quit')
  // `busy`: Der Server wartet auf ein laufendes Wiederherstellen oder eine Übernahme (QUIT_RESTORE_WAIT_MS in
  // server/src/index.ts, Durchsicht Daten K2); so lange wird er nicht hart beendet
  const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), !started ? START_QUIT_TIMEOUT_MS : busy ? BUSY_QUIT_TIMEOUT_MS : QUIT_TIMEOUT_MS))
  if ((await Promise.race([gone, timeout])) !== 'timeout') {
    windowLog('Server beendet')
    return
  }
  windowLog('Server antwortet nicht, wird hart beendet')
  child.kill()
  // Beim Neustart muss der Port frei sein, bevor der nächste Server ihn bindet
  await Promise.race([gone, new Promise((resolve) => setTimeout(resolve, 2000))])
}

// Zugriff aus dem Heimnetz: Der Server lauscht dann auf allen Netzwerkkarten statt nur auf 127.0.0.1. Ändern heißt
// neu starten, mit demselben Port, damit Origin und damit Entwürfe und Einstellungen im Browser-Speicher bleiben.
// Danach lädt das Fenster die Seite neu. Scheitert der Start mit der neuen Adresse, gilt wieder die alte.
function currentNetwork() {
  const port = origin ? Number(new URL(origin).port) : DEFAULT_PORT
  return networkState(readSettings(), port, os.networkInterfaces())
}

/** @param {boolean} enabled */
async function setNetwork(enabled) {
  if (!server) throw new Error('Mietfuchs läuft hier nicht im Fenster, die Adresse lässt sich nicht ändern.')
  if (quitting) throw new Error('Mietfuchs wird beendet.')
  const before = readSettings()
  if ((before.network === true) === enabled) return currentNetwork()
  const port = Number(new URL(/** @type {string} */ (origin)).port)
  writeSettings({ ...before, network: enabled })
  await stopServer()
  // Während des Neustarts beendet (Fenster zu): keinen Server mehr starten, der Wunsch bleibt gespeichert
  if (quitting) throw new Error('Mietfuchs wird beendet.')
  try {
    await startServer({ ...before, network: enabled }, port)
  } catch (err) {
    if (quitting) throw err
    // Mit der alten Adresse weiter. Die Seite lädt dann nicht neu, damit sie den Grund am Häkchen zeigt; der Server
    // läuft unter demselben Origin wie vorher.
    writeSettings(before)
    try {
      await startServer(before, port)
    } catch {
      if (!quitting) {
        showStartFailure('Mietfuchs ließ sich nicht neu starten', err)
        quitting = true
        app.exit(1)
      }
    }
    throw err
  }
  // Erst nach der Antwort an die Seite neu laden, sonst ginge die Antwort ins Leere
  setImmediate(() => { if (mainWindow && origin && !quitting) void mainWindow.loadURL(origin) })
  return currentNetwork()
}

// ---------- Mietfuchs im Heimnetz (#528, Schritt 2) ----------
// Koppeln und Trennen laufen in derselben Reihe wie der Neustart für den Heimnetz-Schalter (`restarting`): Beide
// beenden oder starten den eigenen Server, und before-quit wartet auf sie.

/**
 * @template T
 * @param {() => Promise<T>} job
 * @returns {Promise<T>}
 */
function enqueue(job) {
  const next = restarting.then(job)
  restarting = next.catch(() => {})
  return next
}

// Ein Zertifikat des gekoppelten Hosts, das nicht das gemerkte ist, seit dem letzten Laden (für die Meldung)
let certRejected = false
// Der Versionshinweis höchstens einmal je Start
let versionChecked = false
// Höchstens eine Rückfrage zugleich (Laden scheitert oft mehrfach hintereinander)
let troubleOpen = false
// Der Fehler des letzten gescheiterten Ladens (did-fail-load), für die Selbstprüfung
/** @type {number | null} */
let lastFailCode = null

// Für den Host des gekoppelten Servers nur das gemerkte Zertifikat (pinDecision), für alle anderen die normale Prüfung
// von Chromium (-3). Ohne Kopplung keine eigene Prüfung. In `system` (hinter einem Proxy) prüft Chromium Kette und Name
// mit dem Speicher des Systems; in Prüfläufen gilt für den gekoppelten Host dazu die Test-CA (issuedBy), weil Chromium
// sie nicht kennt.
function pinCertificates() {
  session.defaultSession.setCertificateVerifyProc(remote ? (request, callback) => {
    if (remote?.trust === 'system') {
      const host = new URL(remote.origin).hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase()
      const own = request.hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase() === host
      return callback(own && testCaPem && request.errorCode !== 0 && issuedBy(request.certificate.data, testCaPem, request.hostname) ? 0 : -3)
    }
    let fingerprint = ''
    try {
      fingerprint = certSha256FromPem(request.certificate.data)
    } catch { /* kein lesbares Zertifikat: gilt für den gekoppelten Host als anderes */ }
    const decision = pinDecision(request.hostname, fingerprint, remote)
    if (decision === 'reject') certRejected = true
    callback(decision === 'accept' ? 0 : decision === 'reject' ? -2 : -3)
  } : null)
}

/** @param {RemoteSettings} pairing */
function useRemote(pairing) {
  remote = pairing
  origin = pairing.origin
  windowKey = null
  serverDataDir = null
  pinCertificates()
  attachWindowKey()
  buildMenu()
}

// Die Seite des gekoppelten Servers laden. Scheitert das, fragt `did-fail-load` (createWindow) nach dem Ausweg.
async function openRemote() {
  const win = mainWindow
  if (!win || !remote || quitting) return
  certRejected = false
  try {
    await win.loadURL(remote.origin)
  } catch (err) {
    windowLog(`Laden von ${remote?.origin} gescheitert: ${err}`)
    return
  }
  void checkRemote()
}

// Nach dem Laden: Gilt der Geräteschlüssel noch (entfernt oder Anmeldung zurückgesetzt, dann zeigte die Seite nur die
// Anmeldung), und passt die Version des Servers zu der des Fensters? Über die eigene Verbindung mit dem gemerkten
// Zertifikat (pairing.js), nicht über die Seite.
async function checkRemote() {
  const current = remote
  if (!current) return
  try {
    const auth = await remoteFetch(current, '/api/auth', { ca: trustAnchors() })
    const info = jsonOr(auth.body)
    // In `system` erst die Vorabfrage: Vertraut Mietfuchs dem Proxy gerade nicht, gilt kein Schlüssel, das Fenster ist
    // aber nicht vergessen (Integrationsdurchsicht m4)
    if (auth.status === 401 || (info?.required === true && info?.signedIn !== true)) {
      return void remoteTrouble(await rejectedKeyReason(current, { ca: trustAnchors() }))
    }
    if (versionChecked) return
    const version = jsonOr((await remoteFetch(current, '/healthz', { ca: trustAnchors() })).body)?.version
    if (typeof version !== 'string' || remote !== current) return
    versionChecked = true
    if (version !== current.version) {
      remote = { ...current, version }
      writeSettings({ ...readSettings(), remote })
    }
    const hint = versionHint(app.getVersion(), version)
    if (hint && mainWindow) void dialog.showMessageBox(mainWindow, { type: 'info', title: 'Mietfuchs im Heimnetz', message: hint, buttons: ['OK'] })
  } catch (err) {
    windowLog(`Prüfung von ${current.origin}: ${err}`)
  }
}

/**
 * Der gekoppelte Server lädt nicht: Grund und Ausweg in einer Rückfrage des Systems, weil die Seite selbst ja fehlt.
 * `untrusted`: In `system` lehnt Chromium das Zertifikat des Proxys ab (Kette, Name oder Gültigkeit).
 * @param {'unreachable' | 'cert' | 'key' | 'untrusted' | 'proxy'} reason
 */
async function remoteTrouble(reason) {
  if (troubleOpen || quitting || !remote) return
  troubleOpen = true
  // Eine Rückfrage an einem verborgenen oder abgelegten Fenster sähe niemand (macOS zeigt sie als Blatt am Fenster)
  if (mainWindow) surfaceWindow(mainWindow)
  const where = new URL(remote.origin).host
  const texts = {
    unreachable: {
      message: `Mietfuchs unter ${where} ist nicht erreichbar.`,
      detail: 'Prüfen Sie, ob der Rechner eingeschaltet ist und Mietfuchs dort läuft. „Verbindung trennen“ führt zurück zu den Daten auf diesem Rechner.',
    },
    cert: {
      message: 'Der Server zeigt ein anderes Zertifikat als beim Koppeln. Wurde Mietfuchs dort neu eingerichtet, koppeln Sie neu; sonst verbinden Sie sich nicht.',
      detail: `Adresse: ${where}. Zum neu Koppeln trennen Sie die Verbindung und verbinden sich in den Einstellungen unter „Mietfuchs im Heimnetz“ mit einem neuen Code.`,
    },
    untrusted: {
      message: `Das Zertifikat von Mietfuchs unter ${where} ist auf diesem Rechner nicht gültig.`,
      detail: 'Prüfen Sie den Proxy vor Mietfuchs, etwa Caddy, und bei einem eigenen Stammzertifikat, ob es auf diesem Rechner noch installiert ist. Verbinden Sie sich nicht, solange Sie den Grund nicht kennen.',
    },
    proxy: {
      message: `Mietfuchs unter ${where} sieht die Verbindung nicht als verschlüsselt an, weil es dem Proxy davor nicht vertraut.`,
      detail: 'Tragen Sie den Proxy bei Mietfuchs in NKA_TRUST_PROXY ein; in compose.caddy.yml steht das schon. Wurde der Proxy eben neu gestartet, versuchen Sie es in einigen Sekunden erneut. Die Kopplung bleibt bestehen, neu koppeln müssen Sie nicht.',
    },
    key: {
      message: `Mietfuchs unter ${where} kennt dieses Programmfenster nicht mehr.`,
      detail: 'Vermutlich wurde es dort in den Einstellungen unter „Anmeldung“ entfernt, oder die Anmeldung wurde zurückgesetzt. Trennen Sie die Verbindung und koppeln Sie mit einem neuen Code neu.',
    },
  }[reason]
  /** @type {Electron.MessageBoxOptions} */
  const options = { type: 'warning', title: 'Mietfuchs im Heimnetz', ...texts, buttons: ['Erneut versuchen', 'Verbindung trennen', 'Beenden'], defaultId: 0, cancelId: 2, noLink: true }
  windowLog(`Mietfuchs im Heimnetz: ${reason}`)
  let response = 2
  try {
    // In der Selbstprüfung festhalten, in welchem Zustand die Rückfrage erschiene, und sie wie bestellt beantworten
    if (selftest?.trouble != null) response = await recordTrouble(reason, selftest.trouble)
    else response = (mainWindow ? await dialog.showMessageBox(mainWindow, options) : await dialog.showMessageBox(options)).response
  } finally {
    troubleOpen = false
  }
  if (response === 0) void openRemote()
  else if (response === 1) void enqueue(disconnectRemote).catch((err) => console.error(`Trennen: ${err}`))
  else app.quit()
}

/**
 * Koppeln (Karte „Mietfuchs im Heimnetz“ der eigenen Seite): pairing.js, merken, eigenen Server beenden, die Seite des
 * gekoppelten laden. Ein Fehler kommt als Satz an die Karte zurück, und es bleibt beim eigenen Server.
 * @param {string} address
 * @param {string} code
 * @returns {Promise<{ ok: true } | import('./pairing.js').Problem>}
 */
async function connectRemote(address, code) {
  if (quitting) throw new Error('Mietfuchs wird beendet.')
  if (remote) return { problem: 'Das Fenster ist schon mit einem Mietfuchs im Heimnetz verbunden.' }
  const result = await pair({ address, code, ca: trustAnchors() })
  if ('problem' in result) return result
  if (quitting) throw new Error('Mietfuchs wird beendet.')
  writeSettings({ ...readSettings(), remote: result })
  windowLog(`Gekoppelt mit ${result.origin}`)
  await stopServer()
  useRemote(result)
  versionChecked = false
  // Erst nach der Antwort an die Seite laden, sonst ginge die Antwort ins Leere
  setImmediate(() => void openRemote())
  return { ok: true }
}

// Trennen (Karte, Menü, Rückfrage): beste Mühe, das eigene Gerät am Server zu entfernen, Kopplung vergessen, eigenen
// Server starten und dessen Seite laden. Erreicht das Fenster den Server nicht, bleibt das Gerät dort in der Liste.
async function disconnectRemote() {
  const current = remote
  if (!current) return
  await remoteFetch(current, `/api/auth/devices/${encodeURIComponent(current.deviceId)}`, { method: 'DELETE', timeoutMs: 3000, ca: trustAnchors() })
    .then((answer) => windowLog(`Gerät am Server entfernen: ${answer.status}`))
    .catch((err) => windowLog(`Gerät am Server entfernen gescheitert: ${err}`))
  const { remote: _forgotten, ...settings } = readSettings()
  writeSettings(settings)
  windowLog(`Verbindung mit ${current.origin} getrennt`)
  remote = null
  origin = null
  pinCertificates()
  buildMenu()
  if (quitting) return
  if (mainWindow) await mainWindow.loadURL(page('<p>Mietfuchs startet …</p>'))
  try {
    origin = new URL(await startServer(settings)).origin
    attachWindowKey()
  } catch (err) {
    if (quitting) return
    showStartFailure('Mietfuchs ließ sich nicht starten', err)
    quitting = true
    await stopServer()
    app.exit(1)
    return
  }
  if (mainWindow && origin && !quitting) await mainWindow.loadURL(origin)
}

/** @param {string} html */
const page = (html) => `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html lang="de"><meta charset="utf-8"><body style="font:15px system-ui,sans-serif;margin:0;display:grid;place-items:center;height:100vh;color:#333">${html}</body></html>`)}`

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 360,
    minHeight: 480,
    title: 'Mietfuchs',
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  })
  win.once('ready-to-show', () => win.show())
  // Gekoppelt (#528, Schritt 2): Lädt die Seite des Servers nicht, sagt eine Rückfrage warum und wie es weitergeht.
  // Abgebrochene Navigationen (-3, etwa eine Weiterleitung der Seite) sind kein Fehler.
  win.webContents.on('did-fail-load', (_event, errorCode, description, url, isMainFrame) => {
    if (!remote || !isMainFrame || errorCode === -3 || linkTarget(url, remote.origin) !== 'window') return
    windowLog(`did-fail-load ${errorCode} ${description}`)
    lastFailCode = errorCode
    // In `system` heißen -200 bis -299 bei Chromium: Das Zertifikat gilt nicht (net_error_list.h, ERR_CERT_*)
    const untrusted = remote.trust === 'system' && errorCode <= -200 && errorCode >= -299
    void remoteTrouble(untrusted ? 'untrusted' : certRejected ? 'cert' : 'unreachable')
  })
  win.on('close', () => windowLog('Fenster: close'))
  win.on('closed', () => {
    mainWindow = null
    app.quit()
  })
  guard(win)
  return win
}

// Was die Seite öffnen darf (siehe linkTarget). Belege öffnen in einem eigenen Fenster mit denselben Regeln, aber ohne
// Preload und damit ohne Brücke (#517, childWebPreferences), auch wenn ein Link oder eine Weiterleitung sie in ein
// Fenster mit Brücke laden wollte (navigationTarget).
/**
 * @param {BrowserWindow} win
 * @param {boolean} [bridge] hat das Fenster das Preload? Nur ein Belegfenster nicht.
 */
function guard(win, bridge = true) {
  const contents = win.webContents
  contents.setWindowOpenHandler(({ url }) => {
    if (!origin) return { action: 'deny' }
    const where = linkTarget(url, origin)
    if (where === 'external') void shell.openExternal(url)
    if (where !== 'window') return { action: 'deny' }
    return { action: 'allow', overrideBrowserWindowOptions: { width: 1000, height: 800, webPreferences: childWebPreferences(url, origin, path.join(here, 'preload.cjs'), bridge) } }
  })
  contents.on('did-create-window', (child, details) => guard(child, bridge && !(origin && isReceipt(details.url, origin))))
  const onNavigate = (/** @type {Electron.Event} */ event, /** @type {string} */ url) => {
    if (url.startsWith('data:') && !origin) return // die Seite „Mietfuchs startet …“
    const where = navigationTarget(url, origin, bridge)
    if (where === 'stay') return
    event.preventDefault()
    if (where === 'external') void shell.openExternal(url)
    if (where === 'receipt') openReceiptWindow(url)
  }
  contents.on('will-navigate', onNavigate)
  contents.on('will-redirect', onNavigate)
  // Auch eingebettete Rahmen (Belegvorschau) bleiben auf der eigenen Adresse (Durchsicht K9), nur der PDF-Betrachter
  // darf dazu (#517, frameTarget)
  contents.on('will-frame-navigate', (event) => {
    if (event.isMainFrame) return
    if (!frameTarget(event.url, origin)) event.preventDefault()
  })
}

// Ein Beleg, den ein Link ins Fenster mit Brücke laden wollte, in einem eigenen Fenster ohne Preload (#517)
/** @param {string} url */
function openReceiptWindow(url) {
  if (!origin) return
  const child = new BrowserWindow({ width: 1000, height: 800, webPreferences: childWebPreferences(url, origin, path.join(here, 'preload.cjs')) })
  guard(child, false)
  void child.loadURL(url)
}

// Dieselbe Adresse über HTTP, mit ausdrücklichem Port (https://nas wäre sonst http://nas auf Port 80)
/** @param {string} address */
const overHttp = (address) => {
  const url = new URL(address)
  return `http://${url.hostname}:${url.port || '443'}`
}

function buildMenu() {
  const mac = process.platform === 'darwin'
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [
    {
      label: 'Mietfuchs',
      submenu: [
        ...(mac ? [{ role: /** @type {const} */ ('about'), label: 'Über Mietfuchs' }, { type: /** @type {const} */ ('separator') }] : []),
        // Gekoppelt über HTTP auf demselben Port: Über HTTPS zeigte der Browser beim eigenen Zertifikat nur eine Warnung
        { label: 'Im Browser öffnen', click: () => { if (origin) void shell.openExternal(remote ? overHttp(origin) : origin) } },
        ...(remote ? [] : [{ label: 'Datenordner zeigen', click: () => { if (serverDataDir) void shell.openPath(serverDataDir) } }]),
        // Auch wenn die Seite des gekoppelten Servers nicht lädt
        ...(remote ? [{ label: 'Verbindung trennen', click: () => void enqueue(disconnectRemote).catch((err) => console.error(`Trennen: ${err}`)) }] : []),
        { type: 'separator' },
        { label: 'Drucken …', accelerator: 'CmdOrCtrl+P', click: (_item, win) => { if (win instanceof BrowserWindow) printPage(win.webContents) } },
        { type: 'separator' },
        { role: 'quit', label: 'Mietfuchs beenden' },
      ],
    },
    {
      label: 'Bearbeiten',
      submenu: [
        { role: 'undo', label: 'Rückgängig' },
        { role: 'redo', label: 'Wiederholen' },
        { type: 'separator' },
        { role: 'cut', label: 'Ausschneiden' },
        { role: 'copy', label: 'Kopieren' },
        { role: 'paste', label: 'Einfügen' },
        { role: 'selectAll', label: 'Alles auswählen' },
      ],
    },
    {
      label: 'Ansicht',
      submenu: [
        { role: 'reload', label: 'Neu laden' },
        { type: 'separator' },
        { role: 'zoomIn', label: 'Größer' },
        { role: 'zoomOut', label: 'Kleiner' },
        { role: 'resetZoom', label: 'Originalgröße' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Vollbild' },
        ...(app.isPackaged ? [] : [{ role: /** @type {const} */ ('toggleDevTools') }]),
      ],
    },
  ]
  if (mac) template.push({ role: 'windowMenu', label: 'Fenster' })
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// Drucken mit Hintergründen, sonst fehlt das Briefpapier. Papierformat und Ränder setzt die Seite selbst (@page).
/** @param {Electron.WebContents} contents */
function printPage(contents) {
  contents.print({ printBackground: true }, (success, reason) => {
    if (!success && reason !== 'Print job canceled' && reason !== 'cancelled') console.error(`Drucken: ${reason}`)
  })
}

// Selbstprüfung für die CI (nur mit CI): Startzeit, Speicher und ein PDF der ersten Seite in den genannten Ordner.
// Beendet wird von außen über /api/quit, wie aus der Oberfläche.
/** @param {BrowserWindow} win */
async function selfTest(win) {
  if (!selftest) return
  const { out } = selftest
  fs.mkdirSync(out, { recursive: true })
  // Der Server ist ein Prozess des Fensters und steht mit in den Metriken; getrennt gezählt, damit der Speicher des
  // Fensters mit dem früherer Läufe vergleichbar bleibt
  const metrics = app.getAppMetrics()
  const isServer = (/** @type {Electron.ProcessMetric} */ m) => m.serviceName === SERVICE_NAME || m.name === SERVICE_NAME
  const memory = metrics.filter((m) => !isServer(m)).reduce((sum, m) => sum + m.memory.workingSetSize, 0)
  const serverMemory = metrics.filter(isServer).reduce((sum, m) => sum + m.memory.workingSetSize, 0)
  const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true })
  fs.writeFileSync(path.join(out, 'fenster.pdf'), pdf)
  // Fragt die Seite selbst: kommt der Fensterschlüssel über onBeforeSendHeaders an (#528)?
  const access = await pageAuth(win)
  // Ob Node hier den Speicher des Systems liest (Kopplung über einen Proxy in `system`): Zahl der Zertifikate oder null
  /** @type {number | null} */
  let systemCa = null
  try {
    systemCa = tls.getCACertificates('system').length
  } catch { /* bleibt null */ }
  fs.writeFileSync(path.join(out, 'fenster.json'), `${JSON.stringify({ origin, url: win.webContents.getURL(), remote: remote?.origin ?? null, startMs: Date.now() - startedAt, electronMemoryKiB: memory, serverMemoryKiB: serverMemory, serverPid: server?.pid ?? null, electron: process.versions.electron, chrome: process.versions.chrome, access, systemCa }, null, 2)}\n`)
  await selfTestPairing(win, out)
}

// Was `/api/auth` der Seite selbst sagt: Kommt der Fenster- bzw. Geräteschlüssel über onBeforeSendHeaders an?
/** @param {BrowserWindow} win */
const pageAuth = (win) => win.webContents.executeJavaScript("fetch('/api/auth').then((r) => r.json()).catch(() => null)").catch(() => null)

/**
 * Bis das Fenster eine Seite unter `wanted` fertig geladen hat (`wanted` als Funktion, weil sich der Ursprung beim
 * Trennen erst mit dem Start des eigenen Servers ergibt)
 * @param {BrowserWindow} win
 * @param {() => string | null} wanted
 * @param {number} [timeoutMs]
 */
async function pageLoaded(win, wanted, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const target = wanted()
    if (target && !win.webContents.isLoading() && win.webContents.getURL().startsWith(`${target}/`)) return true
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return false
}

/**
 * Selbstprüfung der Kopplung (#528, scripts/desktop-check.mjs): koppeln und trennen über die Brücke der Seite, wie die
 * Karte „Mietfuchs im Heimnetz“, dann beenden. Ergebnisse in kopplung.json und trennen.json.
 * @param {BrowserWindow} win
 * @param {string} out
 */
async function selfTestPairing(win, out) {
  if (!selftest) return
  const write = (/** @type {string} */ name, /** @type {unknown} */ value) => fs.writeFileSync(path.join(out, name), `${JSON.stringify(value, null, 2)}\n`)
  if (selftest.pair && !remote) {
    const request = JSON.stringify(selftest.pair)
    const result = await win.webContents.executeJavaScript(`window.mietfuchsDesktop.remote.connect(${request})`).catch((err) => ({ error: String(err) }))
    const loaded = result?.ok === true && await pageLoaded(win, () => remote?.origin ?? null)
    const state = loaded ? await win.webContents.executeJavaScript('window.mietfuchsDesktop.remote.get()').catch((err) => ({ error: String(err) })) : null
    write('kopplung.json', { result, loaded, origin, trust: /** @type {RemoteSettings | null} */ (remote)?.trust ?? null, url: win.webContents.getURL(), serverPid: server?.pid ?? null, access: loaded ? await pageAuth(win) : null, state })
  }
  if (selftest.disconnect && remote) {
    // Nicht auf die Antwort warten: Das Trennen lädt die eigene Seite, die fragende ist dann fort
    await win.webContents.executeJavaScript('void window.mietfuchsDesktop.remote.disconnect(); true').catch(() => null)
    const loaded = await pageLoaded(win, () => (remote || !server ? null : origin))
    write('trennen.json', { loaded, origin, url: win.webContents.getURL(), remote: remote?.origin ?? null, serverPid: server?.pid ?? null, access: loaded ? await pageAuth(win) : null })
  }
  if (selftest.quit) app.quit()
}

/**
 * Die Rückfrage in der Selbstprüfung: festhalten, ob das Fenster dabei zu sehen wäre, und die bestellte Antwort geben.
 * Das Zurückholen aus dem Dock läuft auf dem Mac animiert; bis zu fünf Sekunden darauf warten.
 * @param {'unreachable' | 'cert' | 'key' | 'untrusted' | 'proxy'} reason
 * @param {number} answer
 */
async function recordTrouble(reason, answer) {
  const win = mainWindow
  const deadline = Date.now() + 5000
  while (win && (win.isMinimized() || !win.isVisible()) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100))
  if (selftest) {
    fs.mkdirSync(selftest.out, { recursive: true })
    const state = { reason, errorCode: lastFailCode, visible: win?.isVisible() ?? null, minimized: win?.isMinimized() ?? null, answer }
    fs.writeFileSync(path.join(selftest.out, 'rueckfrage.json'), `${JSON.stringify(state, null, 2)}\n`)
  }
  return answer
}

async function start() {
  windowLog(`Start, Electron ${process.versions.electron}`)
  buildMenu()
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'clipboard-sanitized-write'))
  session.defaultSession.setPermissionCheckHandler((_contents, permission) => permission === 'clipboard-sanitized-write')
  // Nur die eigene Seite darf drucken lassen (Durchsicht K9), und zwar ihr Hauptrahmen, nie ein Beleg (#517, trustedSender)
  /** @param {Electron.IpcMainInvokeEvent} event */
  const fromOwnPage = (event) => trustedSender(event.senderFrame, origin) && event.senderFrame === event.sender.mainFrame
  // Was die Seite darf, entscheidet bridgePolicy.js: lokal alles, gekoppelt nur Drucken, Updates und die Verbindung
  /** @param {Electron.IpcMainInvokeEvent} event @param {string} channel */
  const mayUse = (event, channel) => allowed(channel, { remote: remote !== null, ownPage: fromOwnPage(event) })
  /** @param {Electron.IpcMainInvokeEvent} event @param {string} channel */
  const permit = (event, channel) => {
    if (!mayUse(event, channel)) throw new Error('Nicht erlaubt.')
  }
  ipcMain.handle('mietfuchs:print', (event) => {
    if (mayUse(event, 'print')) printPage(event.sender)
  })
  // Zugriff aus dem Heimnetz, ebenso nur für die eigene Seite: Eine fremde könnte sonst den Server ins Netz stellen.
  // Gekoppelt nur `{ remote: true }`, damit die Oberfläche die Karte ausblendet, ohne den Stand dieses Rechners.
  ipcMain.handle('mietfuchs:network-get', (event) => {
    if (remote && fromOwnPage(event)) return { remote: true }
    permit(event, 'network-get')
    return currentNetwork()
  })
  // Umzug der Daten (#517): „Ordner der alten Programmdatei wählen …“. Ebenso nur für die eigene Seite; sie bekommt
  // nur den Pfad, ob dort Daten liegen, prüft der Server.
  ipcMain.handle('mietfuchs:choose-folder', async (event) => {
    permit(event, 'choose-folder')
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options = { title: 'Alte Programmdatei, ihren Ordner oder ein Backup wählen', buttonLabel: 'Wählen', properties: folderDialogProperties(process.platform) }
    return chosenFolder(owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options))
  })
  ipcMain.handle('mietfuchs:network-set', (event, enabled) => {
    permit(event, 'network-set')
    if (typeof enabled !== 'boolean') throw new Error('Erwartet wird an oder aus.')
    const next = restarting.then(() => setNetwork(enabled))
    restarting = next.catch(() => {})
    return next
  })
  // Automatische Updates (updater.js), ebenso nur für die eigene Seite: Eine fremde könnte sonst Mietfuchs neu starten.
  // Ohne Updater (Mac, Store, beim Entwickeln) ist der Stand `off`, und die Oberfläche zeigt den bisherigen Hinweis.
  const updaterState = () => updates?.state() ?? initialUpdaterState('off', app.getVersion())
  ipcMain.handle('mietfuchs:updater-get', async (event) => {
    permit(event, 'updater-get')
    await Promise.race([updaterReady, new Promise((resolve) => setTimeout(resolve, 15_000))])
    return updaterState()
  })
  // „Jetzt prüfen“ und das gerade gesetzte Häkchen; geprüft wird nur mit Zustimmung, die das Fenster selbst liest
  ipcMain.handle('mietfuchs:updater-check', async (event, force) => {
    permit(event, 'updater-check')
    return updates ? updates.check({ force: force === true }) : updaterState()
  })
  ipcMain.handle('mietfuchs:updater-later', (event) => {
    permit(event, 'updater-later')
    return updates ? updates.later() : updaterState()
  })
  ipcMain.handle('mietfuchs:updater-restart', async (event) => {
    permit(event, 'updater-restart')
    const controller = updates
    if (!controller) throw new Error('Mietfuchs aktualisiert sich hier nicht selbst.')
    // In dieselbe Reihe wie der Neustart für den Heimnetz-Schalter: before-quit wartet darauf, ein Beenden mittendrin
    // lässt den Server also erst leerlaufen (Durchsicht S3)
    const next = restarting.then(() => controller.restartNow())
    restarting = next.catch(() => {})
    await next
    return updaterState()
  })
  // Mietfuchs im Heimnetz (#528, Schritt 2): Stand für die Karte, Koppeln nur von der eigenen Seite dieses Rechners
  // (eine Seite von außen könnte das Fenster sonst auf eine andere Adresse umlenken), Trennen auch von der gekoppelten
  ipcMain.handle('mietfuchs:remote-get', (event) => {
    permit(event, 'remote-get')
    return remote ? { connected: true, origin: remote.origin, version: remote.version } : { connected: false }
  })
  ipcMain.handle('mietfuchs:remote-connect', (event, request) => {
    permit(event, 'remote-connect')
    const { address, code } = /** @type {{ address?: unknown, code?: unknown }} */ (request ?? {})
    if (typeof address !== 'string' || typeof code !== 'string' || address.length > 300 || code.length > 100) throw new Error('Erwartet werden Adresse und Code.')
    return enqueue(() => connectRemote(address, code))
  })
  ipcMain.handle('mietfuchs:remote-disconnect', async (event) => {
    permit(event, 'remote-disconnect')
    await enqueue(disconnectRemote)
  })

  // Mac: einmal anbieten, Mietfuchs nach „Programme“ zu verschieben, vor dem Start des Servers (das Verschieben startet
  // Mietfuchs neu)
  if (offerMoveToApplications()) return

  mainWindow = createWindow()
  await mainWindow.loadURL(page('<p>Mietfuchs startet …</p>'))
  // Ein Mietfuchs, der schon läuft, statt eines eigenen Servers. Heute nur für Prüfungen (die Druckprüfung startet
  // ihren Beispielbestand selbst); später der Weg zu einem Mietfuchs im Heimnetz (#528).
  // Nur beim Entwickeln und in Prüfungen: Im ausgelieferten Fenster ließe eine untergeschobene Variable sonst eine
  // fremde Seite mit der Druckbrücke laden (Durchsicht K8).
  // Ausgeliefert nur mit beiden Schranken der Testgriffe und nur auf diesen Rechner (testGrips.js)
  const external = (!app.isPackaged || testGripsAllowed(process.env)) ? loopbackUrl(process.env.MIETFUCHS_SERVER_URL) : null
  // Gekoppelt (#528, Schritt 2): kein eigener Server, die Seite des gekoppelten
  const pairing = external ? null : readSettings().remote ?? null
  if (external) origin = new URL(external).origin
  else if (pairing) useRemote(pairing)
  else try {
    origin = new URL(await startServer(readSettings())).origin
    attachWindowKey()
  } catch (err) {
    // Fenster während des Starts geschlossen: Das Beenden läuft schon, eine Meldung wäre falsch
    if (quitting) return
    showStartFailure('Mietfuchs ließ sich nicht starten', err)
    quitting = true
    await stopServer()
    app.exit(1)
    return
  }
  const win = mainWindow
  if (!win) return
  // Vor dem Laden der Seite, damit sie den Stand gleich bekommt (Durchsicht S1)
  void setupUpdater().catch((err) => console.error(`Updates: ${err}`)).finally(updaterSettled)
  if (remote && selftest?.window) {
    // Selbstprüfung: Die Rückfrage muss das Fenster auch dann zeigen, wenn es verborgen oder abgelegt ist
    if (!win.isVisible()) await new Promise((resolve) => { win.once('show', () => resolve(null)); setTimeout(resolve, 5000) })
    if (selftest.window === 'hidden') win.hide()
    else win.minimize()
  }
  if (remote) await openRemote()
  else await win.loadURL(/** @type {string} */ (origin))
  void selfTest(win).catch((err) => console.error(`Selbstprüfung: ${err}`))
}

// ---------- Automatische Updates (#517, updater.js) ----------
//
// electron-updater (fest gepinnt in desktop/package.json) mit den Releases von speedone/mietfuchs, nur im installierten
// Fenster unter Windows (`updaterSource`). Geladen wird es erst hier, auf dem Mac und im Store nie.
//
// **Keine Prüfung der Signatur** (`verifyUpdateCodeSignature: false` in desktop/package.json, `build.win`): Mietfuchs
// hat kein Zertifikat für Windows, eine Prüfung gegen einen Herausgeber gäbe es nicht. electron-builder schreibt
// deshalb keinen `publisherName` in app-update.yml, und ohne ihn prüft NsisUpdater nicht (verifySignature in
// electron-updater/out/NsisUpdater.js). Die SHA-512 aus latest.yml prüft electron-updater trotzdem, beim vollen wie
// beim Teil-Download und bei einer schon geladenen Datei (DigestTransform in builder-util-runtime/out/httpExecutor.js,
// DifferentialDownloader.js, DownloadedUpdateHelper.validateDownloadedPath). Sie stammt aus demselben Release wie der
// Installer und schützt vor beschädigten oder abgebrochenen Downloads, nicht vor einem fremden Release. Davor schützt
// die eigene Ed25519-Signatur von latest.yml (#551, updateManifest.js): Geladen wird erst, wenn ein Schlüssel aus dem
// Programm sie bestätigt, und die SHA-512, gegen die electron-updater danach prüft, gehört zu dem, was sie deckt.
async function setupUpdater() {
  const source = updaterSource({ platform: process.platform, packaged: app.isPackaged, windowsStore: process.windowsStore === true, env: process.env })
  if (source.kind === 'off' || updates) return
  const { NsisUpdater } = (await import('electron-updater')).default
  const log = openLog('updater')
  const line = (/** @type {string} */ text) => log.write(`${new Date().toISOString()} ${text}\n`)
  const updater = new NsisUpdater()
  updater.logger = { info: (m) => line(String(m)), warn: (m) => line(`Warnung: ${m}`), error: (m) => line(`Fehler: ${m}`), debug: (m) => line(String(m)) }
  // Nur in Prüfungen (CI) läuft der Updater auch ungepackt, etwa für Bildschirmfotos des Hinweises unter Linux; dann
  // fehlt app-update.yml mit dem Ordner für die Downloads
  if (!app.isPackaged) {
    const config = path.join(app.getPath('userData'), 'dev-app-update.yml')
    fs.writeFileSync(config, 'provider: generic\nupdaterCacheDirName: mietfuchs-updater-entwicklung\n')
    updater.forceDevUpdateConfig = true
    updater.updateConfigPath = config
  }
  // Erst danach die Quelle: `updateConfigPath` setzt sie zurück (AppUpdater.js). Der lokale Server der Probe kennt
  // keine Antworten mit mehreren Bereichen; GitHub bleibt bei der Voreinstellung.
  updater.setFeedURL(source.kind === 'feed' ? { provider: 'generic', url: source.url, useMultipleRangeRequest: false } : { ...UPDATE_REPO })
  line(`Updates aus ${source.kind === 'feed' ? source.url : `github.com/${UPDATE_REPO.owner}/${UPDATE_REPO.repo}`}, installiert ist ${app.getVersion()}`)
  /** @type {number | null} */
  let port = null
  updates = createUpdaterController({
    updater: /** @type {any} */ (updater),
    source: source.kind,
    current: app.getVersion(),
    // Geladen wird nur mit gültiger Signatur von latest.yml (#551, updateManifest.js)
    trustedKeys: trustedUpdateKeys({ source: source.kind, env: process.env }),
    // Die Zustimmung steht in den Einstellungen des Servers (das Häkchen „Beim Öffnen nach neuen Versionen schauen“)
    readConsent: async () => {
      if (!origin) return undefined
      // Gekoppelt aus den Einstellungen des gekoppelten Servers, über die Verbindung mit dem gemerkten Zertifikat
      if (remote) {
        const answer = await remoteFetch(remote, '/api/settings', { timeoutMs: 5000, ca: trustAnchors() })
        return answer.status === 200 ? jsonOr(answer.body)?.updateCheck : undefined
      }
      const res = await serverFetch('/api/settings', { signal: AbortSignal.timeout(5000) })
      return res.ok ? /** @type {any} */ (await res.json())?.updateCheck : undefined
    },
    // Das Ende des Servers ist kein Absturz (stopServer setzt `retired`); `quitting` bleibt, wie es ist, damit
    // before-quit danach wie immer erst den Server abwartet (Durchsicht S3)
    stopServer: async () => {
      port = origin ? Number(new URL(origin).port) : null
      await stopServer()
    },
    resumeServer: async () => {
      if (quitting) return
      // Gekoppelt gibt es keinen eigenen Server, nur die Seite neu laden
      if (remote) return void await openRemote()
      origin = new URL(await startServer(readSettings(), port ?? undefined)).origin
      attachWindowKey()
      if (mainWindow) await mainWindow.loadURL(origin)
    },
    quit: () => app.quit(),
    installerExists: () => {
      const file = /** @type {any} */ (updater).installerPath
      return typeof file === 'string' && fs.existsSync(file)
    },
    onState: (state) => {
      line(`Stand: ${JSON.stringify(state)}`)
      for (const win of BrowserWindow.getAllWindows()) {
        if (origin && isAppPage(win.webContents.getURL(), origin)) win.webContents.send('mietfuchs:updater-state', state)
      }
    },
    log: line,
  })
  await updates.tick()
  setInterval(() => void updates?.tick(), TICK_MS)
}

// Mac: Läuft Mietfuchs nicht aus „Programme“, einmal fragen, ob es dorthin soll (updater.js, shouldOfferMove). Gibt
// true zurück, wenn Mietfuchs verschoben wird und neu startet.
function offerMoveToApplications() {
  const settings = readSettings()
  const offer = shouldOfferMove({
    platform: process.platform,
    packaged: app.isPackaged,
    inApplications: process.platform === 'darwin' && app.isInApplicationsFolder(),
    declined: settings.moveDeclined === true,
    env: process.env,
  })
  if (!offer) return false
  const answer = dialog.showMessageBoxSync({
    type: 'question',
    title: 'Mietfuchs',
    message: 'Mietfuchs in den Ordner „Programme“ verschieben?',
    detail: 'Mietfuchs läuft gerade nicht aus dem Ordner „Programme“. Dort lässt es sich wie jedes Programm starten, und eine neue Version ersetzt es an derselben Stelle. Ihre Daten bleiben, wo sie sind.',
    buttons: ['Verschieben', 'Nicht verschieben'],
    defaultId: 0,
    cancelId: 1,
  })
  if (answer !== 0) {
    writeSettings({ ...settings, moveDeclined: true })
    return false
  }
  try {
    return app.moveToApplicationsFolder({
      conflictHandler: (type) => type !== 'exists' || dialog.showMessageBoxSync({
        type: 'question',
        title: 'Mietfuchs',
        message: 'Im Ordner „Programme“ liegt schon ein Mietfuchs. Durch dieses ersetzen?',
        detail: 'Das bisherige kommt in den Papierkorb. Ihre Daten bleiben, wo sie sind.',
        buttons: ['Ersetzen', 'Abbrechen'],
        defaultId: 0,
        cancelId: 1,
      }) === 0,
    })
  } catch (err) {
    dialog.showErrorBox('Mietfuchs ließ sich nicht verschieben', `${err instanceof Error ? err.message : String(err)}\n\nSie können Mietfuchs auch selbst in den Ordner „Programme“ ziehen.`)
    return false
  }
}

if (!app.requestSingleInstanceLock()) {
  // Ein Fenster je Benutzer: Der zweite Start holt das vorhandene nach vorn und endet.
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  app.on('before-quit', (event) => {
    const decision = quitDecision({ quitting, exiting })
    windowLog(`before-quit: ${decision}`)
    if (decision === 'allow') return
    // Auch ein zweites app.quit (Fenster `closed` und `window-all-closed`) hält an, bis der Server beendet ist
    event.preventDefault()
    if (decision === 'wait') return
    quitting = true
    // Erst einen laufenden Neustart abwarten (er startet nach `quitting` keinen Server mehr), dann den Server beenden.
    // Danach, mit „Beim nächsten Start“, den Installer der neuen Version still und ohne anschließenden Start; er läuft
    // weiter, wenn das Fenster zu ist (updater.js, installOnQuit).
    void restarting.then(() => stopServer()).then(() => {
      try {
        updates?.installOnQuit()
      } catch (err) {
        console.error(`Update beim Beenden: ${err}`)
      }
    }).finally(() => {
      windowLog('app.exit(0)')
      exiting = true
      app.exit(0)
    })
  })
  app.on('will-quit', () => windowLog('will-quit'))
  app.on('quit', (_event, code) => windowLog(`quit (Code ${code})`))
  process.on('exit', (code) => windowLog(`Prozess endet (Code ${code})`))
  // Fenster zu heißt Mietfuchs zu, auch auf dem Mac
  app.on('window-all-closed', () => app.quit())
  void app.whenReady().then(start)
}

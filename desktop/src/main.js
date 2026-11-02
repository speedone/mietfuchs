// Das eigene Programmfenster von Mietfuchs unter Windows und macOS (#517). Electron ist hier nur das Fenster: Der
// Server läuft mit Electrons eigenem Node als utilityProcess (so empfiehlt es Electron für Hintergrundprozesse mit Node),
// ausgeliefert als eine gebündelte Datei in der app.asar, beim Entwickeln aus dem Quellcode. Er lauscht auf 127.0.0.1, und das Fenster
// zeigt seine Oberfläche. Server, Oberfläche und Datenbank wissen davon nur, dass sie keinen Browser öffnen und mit dem Fenster enden (Betriebsart desktop,
// server/src/version.ts). Eine eigene Programmdatei für den Server gibt es im Fenster nicht: eine ausführbare Datei
// weniger, die Virenscanner prüfen und die signiert wird, und rund 100 MB weniger je Architektur.
//
// Sicherheit nach der Checkliste von Electron: Die Seite läuft ohne Node in der Sandbox, die Brücke (preload.cjs)
// kennt nur das Drucken, den Zugriff aus dem Heimnetz, die Wahl des alten Ordners beim Umzug und die automatischen Updates, Navigation und neue Fenster bleiben auf der eigenen Adresse, fremde Links öffnet der
// Standardbrowser, Berechtigungen (Kamera, Standort …) werden abgelehnt.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, Menu, app, dialog, ipcMain, session, shell, utilityProcess } from 'electron'
import { TICK_MS, UPDATE_REPO, createUpdaterController, initialUpdaterState, shouldOfferMove, updaterSource } from './updater.js'
import { DEFAULT_PORT, SERVICE_NAME, blockedFileIn, dataDirIn, findBlockedFile, freePort, linkTarget, networkState, programFiles, serverEnv, serverModule, startFailure, startUrlIn, whoIsOn, chosenFolder, folderDialogProperties } from './server.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const startedAt = Date.now()

// Electrons eigener Ordner (Zwischenspeicher, Einstellungen des Fensters) nicht unter „Mietfuchs“: Auf dem Mac heißt
// der Datenordner von Mietfuchs so (~/Library/Application Support/Mietfuchs), und beide sollen sich nie mischen. Unter
// Windows unter Local statt Roaming, sonst wanderte der Zwischenspeicher mit dem Profil (Durchsicht K11).
const localAppData = process.platform === 'win32' && process.env.LOCALAPPDATA ? process.env.LOCALAPPDATA : app.getPath('appData')
app.setPath('userData', path.join(localAppData, 'mietfuchs-fenster'))

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

/** @typedef {{ port?: number, network?: boolean, moveDeclined?: boolean }} WindowSettings */

const settingsFile = () => path.join(app.getPath('userData'), 'fenster.json')

/** @returns {WindowSettings} */
function readSettings() {
  try {
    const value = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

/** @param {WindowSettings} settings */
function writeSettings(settings) {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true })
  fs.writeFileSync(settingsFile(), `${JSON.stringify(settings, null, 2)}\n`)
}

/** @type {Electron.UtilityProcess | null} */
let server = null
// Beendete Server; ein utilityProcess kennt kein `exitCode`
/** @type {WeakSet<Electron.UtilityProcess>} */
const exited = new WeakSet()
let serverOutput = ''
/** @type {string | null} */
let origin = null
/** @type {BrowserWindow | null} */
let mainWindow = null
let quitting = false
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
    env: serverEnv(process.env, { port, network: settings.network === true, packaged: app.isPackaged, windowsStore: process.windowsStore === true, repoRoot, platform: process.platform, searchDirs: knownFolders() }),
    stdio: 'pipe',
    serviceName: SERVICE_NAME,
  })
  server = child
  serverOutput = ''
  // Als Text, mit Umlauten auch über die Grenze zweier Blöcke hinweg („läuft auf“ in der Startzeile)
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  const collect = (/** @type {string} */ text) => {
    serverOutput = (serverOutput + text).slice(-OUTPUT_LIMIT)
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
  const { message, detail } = startFailure({ found, technical, logDir: path.join(app.getPath('userData'), 'protokoll'), platform: process.platform })
  dialog.showMessageBoxSync({ type: 'error', title, message, detail, buttons: ['OK'] })
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
  if (origin) await fetch(`${origin}/api/quit`, { method: 'POST', signal: AbortSignal.timeout(3000) }).catch(() => {})
  else child.postMessage('quit')
  const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), started ? QUIT_TIMEOUT_MS : START_QUIT_TIMEOUT_MS))
  if ((await Promise.race([gone, timeout])) !== 'timeout') return
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
  win.on('closed', () => {
    mainWindow = null
    app.quit()
  })
  guard(win)
  return win
}

// Was die Seite öffnen darf (siehe linkTarget). Belege öffnen in einem eigenen Fenster mit denselben Regeln.
/** @param {BrowserWindow} win */
function guard(win) {
  const contents = win.webContents
  contents.setWindowOpenHandler(({ url }) => {
    if (!origin) return { action: 'deny' }
    const where = linkTarget(url, origin)
    if (where === 'external') void shell.openExternal(url)
    if (where !== 'window') return { action: 'deny' }
    return { action: 'allow', overrideBrowserWindowOptions: { width: 1000, height: 800, webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } } }
  })
  contents.on('did-create-window', (child) => guard(child))
  const onNavigate = (/** @type {Electron.Event} */ event, /** @type {string} */ url) => {
    if (url.startsWith('data:') && !origin) return // die Seite „Mietfuchs startet …“
    if (origin && linkTarget(url, origin) === 'window') return
    event.preventDefault()
    if (origin && linkTarget(url, origin) === 'external') void shell.openExternal(url)
  }
  contents.on('will-navigate', onNavigate)
  contents.on('will-redirect', onNavigate)
  // Auch eingebettete Rahmen (Belegvorschau) bleiben auf der eigenen Adresse (Durchsicht K9)
  contents.on('will-frame-navigate', (event) => {
    if (event.isMainFrame) return
    if (!origin || linkTarget(event.url, origin) !== 'window') event.preventDefault()
  })
}

function buildMenu() {
  const mac = process.platform === 'darwin'
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [
    {
      label: 'Mietfuchs',
      submenu: [
        ...(mac ? [{ role: /** @type {const} */ ('about'), label: 'Über Mietfuchs' }, { type: /** @type {const} */ ('separator') }] : []),
        { label: 'Im Browser öffnen', click: () => { if (origin) void shell.openExternal(origin) } },
        { label: 'Datenordner zeigen', click: () => { const dir = dataDirIn(serverOutput); if (dir) void shell.openPath(dir) } },
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
  const out = process.env.MIETFUCHS_SELFTEST_OUT
  if (!out || !process.env.CI) return
  fs.mkdirSync(out, { recursive: true })
  // Der Server ist ein Prozess des Fensters und steht mit in den Metriken; getrennt gezählt, damit der Speicher des
  // Fensters mit dem früherer Läufe vergleichbar bleibt
  const metrics = app.getAppMetrics()
  const isServer = (/** @type {Electron.ProcessMetric} */ m) => m.serviceName === SERVICE_NAME || m.name === SERVICE_NAME
  const memory = metrics.filter((m) => !isServer(m)).reduce((sum, m) => sum + m.memory.workingSetSize, 0)
  const serverMemory = metrics.filter(isServer).reduce((sum, m) => sum + m.memory.workingSetSize, 0)
  const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true })
  fs.writeFileSync(path.join(out, 'fenster.pdf'), pdf)
  fs.writeFileSync(path.join(out, 'fenster.json'), `${JSON.stringify({ origin, startMs: Date.now() - startedAt, electronMemoryKiB: memory, serverMemoryKiB: serverMemory, serverPid: server?.pid ?? null, electron: process.versions.electron, chrome: process.versions.chrome }, null, 2)}\n`)
}

async function start() {
  buildMenu()
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'clipboard-sanitized-write'))
  session.defaultSession.setPermissionCheckHandler((_contents, permission) => permission === 'clipboard-sanitized-write')
  // Nur die eigene Seite darf drucken lassen (Durchsicht K9)
  /** @param {Electron.IpcMainInvokeEvent} event */
  const fromOwnPage = (event) => Boolean(origin && event.senderFrame && linkTarget(event.senderFrame.url, origin) === 'window')
  ipcMain.handle('mietfuchs:print', (event) => {
    if (fromOwnPage(event)) printPage(event.sender)
  })
  // Zugriff aus dem Heimnetz, ebenso nur für die eigene Seite: Eine fremde könnte sonst den Server ins Netz stellen.
  ipcMain.handle('mietfuchs:network-get', (event) => {
    if (!fromOwnPage(event)) throw new Error('Nicht erlaubt.')
    return currentNetwork()
  })
  // Umzug der Daten (#517): „Ordner der alten Programmdatei wählen …“. Ebenso nur für die eigene Seite; sie bekommt
  // nur den Pfad, ob dort Daten liegen, prüft der Server.
  ipcMain.handle('mietfuchs:choose-folder', async (event) => {
    if (!fromOwnPage(event)) throw new Error('Nicht erlaubt.')
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options = { title: 'Alte Programmdatei, ihren Ordner oder ein Backup wählen', buttonLabel: 'Wählen', properties: folderDialogProperties(process.platform) }
    return chosenFolder(owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options))
  })
  ipcMain.handle('mietfuchs:network-set', (event, enabled) => {
    if (!fromOwnPage(event)) throw new Error('Nicht erlaubt.')
    if (typeof enabled !== 'boolean') throw new Error('Erwartet wird an oder aus.')
    const next = restarting.then(() => setNetwork(enabled))
    restarting = next.catch(() => {})
    return next
  })
  // Automatische Updates (updater.js), ebenso nur für die eigene Seite: Eine fremde könnte sonst Mietfuchs neu starten.
  // Ohne Updater (Mac, Store, beim Entwickeln) ist der Stand `off`, und die Oberfläche zeigt den bisherigen Hinweis.
  const updaterState = () => updates?.state() ?? initialUpdaterState('off', app.getVersion())
  ipcMain.handle('mietfuchs:updater-get', (event) => {
    if (!fromOwnPage(event)) throw new Error('Nicht erlaubt.')
    return updaterState()
  })
  // „Jetzt prüfen“ und das gerade gesetzte Häkchen; geprüft wird nur mit Zustimmung, die das Fenster selbst liest
  ipcMain.handle('mietfuchs:updater-check', async (event, force) => {
    if (!fromOwnPage(event)) throw new Error('Nicht erlaubt.')
    return updates ? updates.check({ force: force === true }) : updaterState()
  })
  ipcMain.handle('mietfuchs:updater-later', (event) => {
    if (!fromOwnPage(event)) throw new Error('Nicht erlaubt.')
    return updates ? updates.later() : updaterState()
  })
  ipcMain.handle('mietfuchs:updater-restart', async (event) => {
    if (!fromOwnPage(event)) throw new Error('Nicht erlaubt.')
    if (!updates) throw new Error('Mietfuchs aktualisiert sich hier nicht selbst.')
    await updates.restartNow()
    return updaterState()
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
  const remote = !app.isPackaged || process.env.CI ? process.env.MIETFUCHS_SERVER_URL : undefined
  if (remote) origin = new URL(remote).origin
  else try {
    origin = new URL(await startServer(readSettings())).origin
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
  await win.loadURL(origin)
  void selfTest(win).catch((err) => console.error(`Selbstprüfung: ${err}`))
  void setupUpdater().catch((err) => console.error(`Updates: ${err}`))
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
// Installer und schützt vor beschädigten oder abgebrochenen Downloads, nicht vor einem fremden Release; das schützt
// nur HTTPS zu GitHub und das Konto, das veröffentlicht.
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
    // Die Zustimmung steht in den Einstellungen des Servers (das Häkchen „Beim Öffnen nach neuen Versionen schauen“)
    readConsent: async () => {
      if (!origin) return undefined
      const res = await fetch(`${origin}/api/settings`, { signal: AbortSignal.timeout(5000) })
      return res.ok ? /** @type {any} */ (await res.json())?.updateCheck : undefined
    },
    stopServer: async () => {
      // Das Ende des Servers ist dann kein Absturz, und before-quit beendet nichts mehr
      quitting = true
      port = origin ? Number(new URL(origin).port) : null
      await restarting
      await stopServer()
    },
    resumeServer: async () => {
      quitting = false
      origin = new URL(await startServer(readSettings(), port ?? undefined)).origin
      if (mainWindow) await mainWindow.loadURL(origin)
    },
    quit: () => app.quit(),
    onState: (state) => {
      line(`Stand: ${JSON.stringify(state)}`)
      for (const win of BrowserWindow.getAllWindows()) {
        if (origin && linkTarget(win.webContents.getURL(), origin) === 'window') win.webContents.send('mietfuchs:updater-state', state)
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
    ci: Boolean(process.env.CI),
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
    if (quitting) return
    quitting = true
    event.preventDefault()
    // Erst einen laufenden Neustart abwarten (er startet nach `quitting` keinen Server mehr), dann den Server beenden.
    // Danach, mit „Beim nächsten Start“, den Installer der neuen Version still und ohne anschließenden Start; er läuft
    // weiter, wenn das Fenster zu ist (updater.js, installOnQuit).
    void restarting.then(() => stopServer()).then(() => {
      try {
        updates?.installOnQuit()
      } catch (err) {
        console.error(`Update beim Beenden: ${err}`)
      }
    }).finally(() => app.exit(0))
  })
  // Fenster zu heißt Mietfuchs zu, auch auf dem Mac
  app.on('window-all-closed', () => app.quit())
  void app.whenReady().then(start)
}

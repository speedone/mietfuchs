// Prüft das installierte Programmfenster (#517) von außen, auf dem Rechner, für den es gebaut ist (Windows, macOS):
//
//   1. Start mit den drei Angaben jedes Prüfstarts (Wegwerf-Datenordner, CI, Update-Adresse ins Leere) und der
//      Selbstprüfung des Fensters (MIETFUCHS_SELFTEST_OUT): Startzeit, Speicher, PDF der ersten Seite; die Seite im
//      Fenster trägt den Fensterschlüssel, ein Abruf von außen nicht (#528).
//   2. smoke-test.mjs gegen den Server im Fenster, Betriebsart desktop.
//   3. Ein zweiter Start holt nur das vorhandene Fenster nach vorn und endet.
//   4. Beenden aus der Oberfläche (/api/quit): Fenster und Server enden mit 0, der Port ist frei.
//   5. Absturz des Fensters (hart beendet): Der Server endet von selbst, keine Waise hält Port und Datenbank.
//   6. Umzug der Daten: Der Bestand aus 1. liegt wie bei der bisherigen Programmdatei in `data/` neben ihr im
//      Download-Ordner eines nachgestellten Benutzerordners; das Fenster findet ihn mit leerem Datenordner über die
//      Suche dieses Systems und übernimmt ihn.
//   7. Mietfuchs im Heimnetz (#528): Der Server, den das Fenster in seiner app.asar mitbringt, läuft als Gegenstelle
//      mit Passwort und HTTPS (unter Node, auf `::`). Das Fenster koppelt über die Brücke seiner Seite, wie die Karte,
//      und lädt die Seite über HTTPS mit dem Geräteschlüssel; nach einem Neustart ist es weiter verbunden, Trennen
//      startet den eigenen Server. Dazu die Kopfzeile mit dem Geräteschlüssel unter [::1] und localhost, und ein
//      anderes Zertifikat unter derselben Adresse: Das Laden scheitert (did-fail-load), die Rückfrage nennt den Grund
//      und zeigt das Fenster, auch wenn es verborgen oder abgelegt war (Selbstprüfung in main.js, testGrips.js).
//  7b. Kopplung über einen Proxy (#528): dieselbe Gegenstelle mit NKA_TRUST_PROXY hinter einem Test-Proxy wie Caddy
//      (server/testing/proxy.ts, braucht selfsigned aus server/node_modules) mit eigener Test-CA. Ohne die Test-CA
//      nennt das Fenster das Stammzertifikat und schickt keinen Beweis; mit ihr (Testgriff MIETFUCHS_TEST_CA, das
//      Fenster behandelt sie wie eine des Systems) koppelt es in `system`, lädt die Seite über den Proxy, ist nach
//      einem Neustart verbunden, und Trennen startet den eigenen Server. Dazu, ob Node den Speicher des Systems liest.
//
// Der Server läuft als utilityProcess des Fensters (desktop/src/main.js); seine PID nennt die Selbstprüfung. In 4. und
// 5. muss dieser Prozess weg sein, nicht nur der Port frei.
//
//   node scripts/desktop-check.mjs --app <Programm des Fensters> --out <Ordner>
//
// Bericht in <out>/bericht.json, Exit 0 nur, wenn alles bestanden ist.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ARCHIVE_FOLDER, extractAsarFolder } from './package-desktop.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const option = (/** @type {string} */ name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const app = option('--app')
const out = path.resolve(option('--out') ?? 'fenster-pruefung')
if (!app || !fs.existsSync(app)) {
  console.error(`Aufruf: node scripts/desktop-check.mjs --app <Programm> --out <Ordner> (${app ?? 'kein --app'} fehlt)`)
  process.exit(2)
}
fs.mkdirSync(out, { recursive: true })
const PORT = 17517
/** @type {Record<string, unknown>} */
const report = { app, platform: `${process.platform}-${process.arch}`, os: os.release() }
/** @type {string[]} */
const failures = []
const check = (/** @type {boolean} */ ok, /** @type {string} */ what) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${what}`)
  if (!ok) failures.push(what)
}
const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms))

const portFree = () => new Promise((resolve) => {
  const probe = net.createServer()
  probe.once('error', () => resolve(false))
  probe.listen(PORT, () => probe.close(() => resolve(true)))
})

// Läuft der Prozess noch? Signal 0 prüft nur, ob es ihn gibt, auch unter Windows.
const alive = (/** @type {number} */ pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return /** @type {NodeJS.ErrnoException} */ (err).code === 'EPERM'
  }
}

/** @param {() => Promise<boolean> | boolean} condition @param {number} timeoutMs */
async function until(condition, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await condition()) return true
    await sleep(250)
  }
  return false
}

// Ordner entfernen, auch wenn ein eben beendeter Prozess ihn unter Windows noch einen Moment hält
const remove = (/** @type {string} */ dir) => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })

/**
 * Ein Ergebnis der Selbstprüfung, sobald es vollständig geschrieben ist: bis `JSON.parse` gelingt, sonst `null`
 * @param {string} file
 * @param {number} timeoutMs
 * @returns {Promise<any>}
 */
async function readResult(file, timeoutMs) {
  /** @type {any} */
  let value = null
  await until(() => {
    try {
      value = JSON.parse(fs.readFileSync(file, 'utf8'))
      return true
    } catch {
      return false
    }
  }, timeoutMs)
  return value
}

/**
 * Ein Fenster starten, mit Wegwerf-Datenordner und eigenem Ordner für Electron (`MIETFUCHS_TEST_USERDATA`): Die
 * fenster.json eines echten Fensters auf diesem Rechner bleibt unberührt, und dessen Sperre gegen einen zweiten Start
 * gilt für die Prüffenster nicht. Wer denselben Ordner weitergibt, startet „dasselbe“ Fenster neu (Neustart,
 * zweiter Start).
 * @param {string} name
 * @param {NodeJS.ProcessEnv} [extra]
 * @param {string} [userData]
 */
function launch(name, extra = {}, userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-fenster-electron-'))) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-fenster-'))
  const selftest = path.join(out, name)
  // Ergebnisse eines früheren Laufs gälten sonst als die dieses Starts
  remove(selftest)
  const child = spawn(/** @type {string} */ (app), [], {
    env: { ...process.env, ...extra, CI: '1', MIETFUCHS_TESTGRIFFE: '1', MIETFUCHS_TEST_USERDATA: userData, NKA_DATA_DIR: dataDir, NKA_UPDATE_URL: 'http://127.0.0.1:9/kein-internet-im-test', MIETFUCHS_SELFTEST_OUT: selftest },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (c) => { output += c })
  child.stderr.on('data', (c) => { output += c })
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)))
  return { child, dataDir, userData, selftest, exited, output: () => output }
}

/** @param {Promise<unknown>} exited @param {number} ms */
const exitWithin = (exited, ms) => Promise.race([exited, sleep(ms).then(() => 'läuft noch')])

// ---------- 1. bis 4.: gewöhnlicher Lauf ----------
check(await portFree(), `Port ${PORT} ist vor dem Start frei`)
const t0 = Date.now()
const first = launch('lauf')
/** @type {number | null} */
let serverPid = null
const firstResult = await readResult(path.join(first.selftest, 'fenster.json'), 120_000)
check(firstResult !== null, 'Fenster gestartet, Seite geladen, Selbstprüfung geschrieben')
if (firstResult !== null) {
  const selftest = firstResult
  report.start = { ...selftest, seenAfterMs: Date.now() - t0 }
  check(selftest.origin === `http://127.0.0.1:${PORT}`, `Oberfläche unter http://127.0.0.1:${PORT}`)
  serverPid = typeof selftest.serverPid === 'number' ? selftest.serverPid : null
  check(serverPid !== null && serverPid !== first.child.pid && alive(serverPid), `Der Server läuft als eigener Prozess des Fensters (PID ${serverPid})`)
  const pdf = fs.readFileSync(path.join(first.selftest, 'fenster.pdf'))
  check(pdf.subarray(0, 5).toString() === '%PDF-', 'PDF der ersten Seite erzeugt')
  // Anmeldung (#528): Die Seite im Fenster gilt über den Fensterschlüssel als angemeldet, ein Abruf von außen ohne ihn nicht
  check(selftest.access?.window === true, 'Die Seite im Fenster trägt den Fensterschlüssel (window: true)')
  /** @type {any} */
  const outside = await fetch(`http://127.0.0.1:${PORT}/api/auth`).then((r) => r.json()).catch(() => null)
  check(outside?.window === false, 'Ein Abruf ohne Fenster trägt ihn nicht (window: false)')

  let smoke = 0
  try {
    // Mit dem Datenordner fragt smoke-test.mjs /healthz auch über HTTPS, gegen das Zertifikat dort (#528)
    execFileSync(process.execPath, [path.join(root, 'scripts', 'smoke-test.mjs'), '--url', `http://127.0.0.1:${PORT}`, '--mode', 'desktop', '--data-dir', first.dataDir], { stdio: 'inherit' })
  } catch (err) {
    smoke = /** @type {any} */ (err).status ?? 1
  }
  check(smoke === 0, 'Prüfung von außen (smoke-test.mjs, Betriebsart desktop)')

  // Derselbe Ordner für Electron wie beim ersten: Die Sperre gegen einen zweiten Start hängt an ihm
  const second = launch('zweiter-start', {}, first.userData)
  const secondCode = await exitWithin(second.exited, 20_000)
  check(secondCode === 0, `Zweiter Start endet von selbst (Code ${secondCode})`)
  check(first.child.exitCode === null, 'Das erste Fenster läuft weiter')
  remove(second.dataDir)

  await fetch(`http://127.0.0.1:${PORT}/api/quit`, { method: 'POST' }).catch(() => {})
}
const code = await exitWithin(first.exited, 30_000)
check(code === 0, `Beenden aus der Oberfläche: Fenster endet mit 0 (${code})`)
check(await until(portFree, 15_000), 'Danach ist der Port frei')
if (serverPid !== null) check(await until(() => !alive(/** @type {number} */ (serverPid)), 15_000), 'Danach läuft der Server nicht mehr')
if (code === 'läuft noch') first.child.kill()
fs.writeFileSync(path.join(out, 'lauf.log'), first.output())

// ---------- 5.: Absturz des Fensters ----------
const crash = launch('absturz')
const crashSelftest = await readResult(path.join(crash.selftest, 'fenster.json'), 120_000)
if (crashSelftest !== null) {
  // Hart, wie ein Absturz: unter Windows ohne die Möglichkeit, noch etwas zu tun
  if (process.platform === 'win32') execFileSync('taskkill', ['/F', '/PID', String(crash.child.pid)])
  else crash.child.kill('SIGKILL')
  await crash.exited
  const crashServer = typeof crashSelftest.serverPid === 'number' ? crashSelftest.serverPid : null
  check(await until(portFree, 20_000), 'Nach einem Absturz des Fensters endet der Server von selbst (Port frei)')
  check(crashServer !== null && await until(() => !alive(crashServer), 20_000), `Nach dem Absturz bleibt keine Waise (PID ${crashServer})`)
} else {
  check(false, 'Zweiter Lauf für den Absturz gestartet')
  crash.child.kill()
}
fs.writeFileSync(path.join(out, 'absturz.log'), crash.output())

// ---------- 6.: Umzug der Daten (#517) ----------
// Heimatordner, Suchorte und Port der alten Fassung kommen hinein (NKA_TEST_HOME, NKA_TEST_OLD_PORT ins Leere): Die
// Prüfung liest nie den echten Benutzerordner des Runners. Gesucht wird mit den Namen dieses Systems.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-umzug-heim-'))
const oldProgram = path.join(home, 'Downloads', 'mietfuchs-alt')
const oldData = path.join(oldProgram, 'data')
fs.mkdirSync(oldData, { recursive: true })
fs.writeFileSync(path.join(oldProgram, process.platform === 'win32' ? 'mietfuchs-win.exe' : 'mietfuchs-macos-apple-silicon'), 'Programmdatei')
fs.copyFileSync(path.join(first.dataDir, 'mietfuchs.sqlite'), path.join(oldData, 'mietfuchs.sqlite'))
fs.cpSync(path.join(first.dataDir, 'uploads'), path.join(oldData, 'uploads'), { recursive: true })
const moving = launch('umzug', { NKA_TEST_HOME: home, NKA_TEST_OLD_PORT: '9' })
if ((await readResult(path.join(moving.selftest, 'fenster.json'), 120_000)) !== null) {
  const base = `http://127.0.0.1:${PORT}`
  const offer = /** @type {any} */ (await (await fetch(`${base}/api/relocation`)).json())
  check(offer.offered === true, 'Umzug: Das Fenster ohne Bestand bietet ihn an')
  const list = /** @type {any} */ (await (await fetch(`${base}/api/relocation/candidates`)).json())
  const found = (list.candidates ?? []).find((/** @type {any} */ c) => String(c.dataDir).toLowerCase() === oldData.toLowerCase())
  check(Boolean(found), `Umzug: Die Suche findet ${oldData} (${JSON.stringify(list).slice(0, 300)})`)
  // Mit der Kennung des Fundes wie die Oberfläche; einen Pfad nimmt die Route nicht (server/src/CLAUDE.md, K11)
  const adopt = await fetch(`${base}/api/relocation/adopt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: found?.id }) })
  const adopted = /** @type {any} */ (await adopt.json())
  check(adopt.status === 200, `Umzug: übernommen (${adopt.status} ${JSON.stringify(adopted).slice(0, 300)})`)
  // Der Bestand aus 1. hat mehrere Objekte; ohne `?property=` antwortet /api/tenancies dann mit 400. Gezählt wird je Objekt.
  const properties = /** @type {any} */ (await (await fetch(`${base}/api/properties`)).json())
  let tenancyCount = 0
  for (const property of Array.isArray(properties) ? properties : []) {
    const list = /** @type {any} */ (await (await fetch(`${base}/api/tenancies?property=${encodeURIComponent(property.id)}`)).json())
    tenancyCount += Array.isArray(list) ? list.length : 0
  }
  check(tenancyCount > 0 && tenancyCount === adopted.counts?.tenancies, `Umzug: Die Mietverhältnisse sind im Fenster (${tenancyCount} von ${adopted.counts?.tenancies ?? '?'})`)
  check(fs.existsSync(path.join(oldData, 'umgezogen.json')), 'Umzug: Vermerk im alten Ordner')
  report.move = { found: found ?? null, counts: adopted.counts ?? null }
  await fetch(`${base}/api/quit`, { method: 'POST' }).catch(() => {})
  check((await exitWithin(moving.exited, 30_000)) === 0, 'Umzug: danach endet das Fenster mit 0')
} else {
  check(false, 'Umzug: Fenster mit leerem Datenordner gestartet')
  moving.child.kill()
}
fs.writeFileSync(path.join(out, 'umzug.log'), moving.output())
for (const dir of [first.dataDir, first.userData, crash.dataDir, crash.userData, moving.dataDir, moving.userData, home]) remove(dir)

// ---------- 7.: Mietfuchs im Heimnetz (#528) ----------
const CLOSED_URL = 'http://127.0.0.1:9/kein-internet-im-test'
const PASSWORD = 'ein langes Prüfpasswort'
// Die Kopplung in fenster.json im Ordner für Electron des Prüffensters (launch), nie in der des Benutzers
const pairedInSettings = (/** @type {string} */ userData) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(userData, 'fenster.json'), 'utf8')).remote ?? null
  } catch {
    return null
  }
}

/**
 * Der Server des Fensters aus seiner app.asar (Windows resources, macOS Contents/Resources), sonst der aus dem Repo
 * (ein Fenster aus den Quellen, dann braucht server/ seine Abhängigkeiten). `extracted` ist der Ordner, den diese
 * Prüfung angelegt hat und am Ende entfernt; beim Repo `null`.
 * @returns {{ module: string, extracted: string | null }}
 */
function remoteServerModule() {
  const appPath = /** @type {string} */ (app)
  const archive = [path.join(path.dirname(appPath), 'resources', 'app.asar'), path.join(path.dirname(appPath), '..', 'Resources', 'app.asar')].find((f) => fs.existsSync(f))
  if (!archive) return { module: path.join(root, 'server', 'src', 'index.ts'), extracted: null }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-gegenstelle-'))
  extractAsarFolder(archive, ARCHIVE_FOLDER, dir)
  return { module: path.join(dir, 'server', 'server.mjs'), extracted: dir }
}

// Lauscht dieser Rechner unter ::1? Dann auch die Gegenstelle auf `::` (beide Familien), sonst nur IPv4
const ipv6 = await new Promise((resolve) => {
  const probe = net.createServer()
  probe.once('error', () => resolve(false))
  probe.listen(0, '::1', () => probe.close(() => resolve(true)))
})
// Frei auf der Adresse, auf der die Gegenstelle lauscht: mit IPv6 auf `::` (beide Familien)
const remotePort = await new Promise((resolve) => {
  const probe = net.createServer()
  probe.listen(0, ipv6 ? '::' : '127.0.0.1', () => {
    const { port } = /** @type {net.AddressInfo} */ (probe.address())
    probe.close(() => resolve(port))
  })
})
const remoteBase = `http://127.0.0.1:${remotePort}`
const { module: serverModule, extracted: extractedServer } = remoteServerModule()

/**
 * Die Gegenstelle: frischer Datenordner, Passwort über den Einrichtungscode, Sitzung für Code und Geräteliste. Die drei
 * Angaben jedes Prüfstarts (Datenordner, CI, Update-Adresse ins Leere); CI hinter allem anderen.
 * @param {string} name
 * @param {NodeJS.ProcessEnv} [extra] etwa NKA_TRUST_PROXY (7b)
 */
async function startRemote(name, extra = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-gegenstelle-daten-'))
  /** @type {NodeJS.ProcessEnv} */
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('NKA_') && !key.startsWith('MIETFUCHS_')))
  const child = spawn(process.execPath, [serverModule], {
    cwd: path.dirname(serverModule),
    env: { ...env, ...extra, NKA_DATA_DIR: dataDir, NKA_PORT: String(remotePort), NKA_HOST: ipv6 ? '::' : '0.0.0.0', NKA_UPDATE_URL: CLOSED_URL, CI: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (c) => { output += c })
  child.stderr.on('data', (c) => { output += c })
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)))
  let stopped = false
  const stop = async () => {
    if (stopped) return
    stopped = true
    child.kill()
    await exitWithin(exited, 15_000)
    fs.writeFileSync(path.join(out, `${name}.log`), output)
    remove(dataDir)
  }
  /** @type {any} */
  let health = null
  await until(async () => {
    health = await fetch(`${remoteBase}/healthz`).then((r) => r.json()).catch(() => null)
    return health?.tls === true
  }, 60_000)
  const codeFile = path.join(dataDir, 'einrichtungscode.txt')
  const setup = health?.tls === true && fs.existsSync(codeFile)
    ? await fetch(`${remoteBase}/api/auth/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: fs.readFileSync(codeFile, 'utf8').trim(), password: PASSWORD }) })
    : null
  const cookie = setup?.headers.get('set-cookie')?.split(';')[0] ?? ''
  const ready = health?.tls === true && setup?.status === 200 && cookie.startsWith('mietfuchs_')
  /** @param {string} urlPath @param {RequestInit} [init] */
  const signed = (urlPath, init = {}) => fetch(`${remoteBase}${urlPath}`, { ...init, headers: { ...(/** @type {Record<string, string>} */ (init.headers ?? {})), cookie } })
  const pairingCode = async () => /** @type {any} */ (await (await signed('/api/auth/pairing', { method: 'POST' })).json())?.code ?? ''
  const devices = async () => /** @type {any} */ (await (await signed('/api/auth/devices')).json())?.devices ?? null
  return { ready, health, setupStatus: setup?.status ?? null, dataDir, pairingCode, devices, stop }
}

/**
 * Ein Fenster, das koppelt (über die Brücke seiner Seite) und auf Wunsch gleich wieder trennt, dann endet es selbst.
 * Sein Ordner für Electron (mit der Kopplung in fenster.json) bleibt für einen Neustart; `userDirs` räumt ihn am Ende.
 * @param {string} name
 * @param {string} address
 * @param {string} code
 * @param {boolean} disconnect
 * @param {NodeJS.ProcessEnv} [extra] etwa MIETFUCHS_TEST_CA (7b)
 */
async function pairWindow(name, address, code, disconnect, extra = {}) {
  const run = launch(name, { ...extra, MIETFUCHS_SELFTEST_PAIR: JSON.stringify({ address, code }), MIETFUCHS_SELFTEST_QUIT: '1', ...(disconnect ? { MIETFUCHS_SELFTEST_DISCONNECT: '1' } : {}) })
  userDirs.push(run.userData)
  const paired = await readResult(path.join(run.selftest, 'kopplung.json'), 120_000)
  const unpaired = disconnect ? await readResult(path.join(run.selftest, 'trennen.json'), 60_000) : null
  const code0 = await exitWithin(run.exited, 30_000)
  if (code0 === 'läuft noch') run.child.kill()
  fs.writeFileSync(path.join(out, `${name}.log`), run.output())
  remove(run.dataDir)
  return { paired, unpaired, code: code0, userData: run.userData }
}

const httpsOrigin = (/** @type {string} */ host) => `https://${host}:${remotePort}`
/** @type {string[]} */
const userDirs = []
/** @type {Awaited<ReturnType<typeof startRemote>> | null} */
let remote = null
/** @typedef {{ port: number, requests: Array<{ method: string, path: string }>, close(): Promise<void> }} TestProxy */
/** @type {TestProxy | null} */
let proxy = /** @type {TestProxy | null} */ (null)
try {
  remote = await startRemote('gegenstelle')
  check(remote.ready, `Kopplung: Gegenstelle mit HTTPS und Passwort (${serverModule}, tls ${remote.health?.tls}, Einrichtung ${remote.setupStatus})`)
  if (remote.ready) {
    // a) Koppeln über die Brücke, die Seite über HTTPS mit dem Geräteschlüssel
    const a = await pairWindow('kopplung', `127.0.0.1:${remotePort}`, await remote.pairingCode(), false)
    report.pairing = a.paired
    check(a.paired?.result?.ok === true, `Kopplung: über die Brücke gekoppelt (${JSON.stringify(a.paired?.result)})`)
    check(a.paired?.loaded === true && String(a.paired?.url).startsWith(`${httpsOrigin('127.0.0.1')}/`), `Kopplung: die Seite des Servers über HTTPS geladen (${a.paired?.url})`)
    check(a.paired?.access?.signedIn === true && a.paired?.access?.mode === 'password', 'Kopplung: Die Seite trägt den Geräteschlüssel (angemeldet mit Passwort am Server)')
    check(a.paired?.serverPid === null, 'Kopplung: Der eigene Server ist beendet')
    check(a.paired?.state?.connected === true && a.paired?.state?.origin === httpsOrigin('127.0.0.1'), `Kopplung: Die Karte sieht die Verbindung (${JSON.stringify(a.paired?.state)})`)
    check(a.code === 0, `Kopplung: Fenster endet mit 0 (${a.code})`)
    check(pairedInSettings(a.userData)?.origin === httpsOrigin('127.0.0.1'), 'Kopplung: in fenster.json gemerkt')
    check((await remote.devices())?.length === 1, 'Kopplung: Der Server führt das Fenster in der Geräteliste')

    // b) Neustart: weiter verbunden; Trennen über die Brücke der gekoppelten Seite startet den eigenen Server
    const again = launch('kopplung-neustart', { MIETFUCHS_SELFTEST_DISCONNECT: '1', MIETFUCHS_SELFTEST_QUIT: '1' }, a.userData)
    const started = await readResult(path.join(again.selftest, 'fenster.json'), 120_000)
    check(started?.origin === httpsOrigin('127.0.0.1') && started?.serverPid === null, `Neustart: verbunden mit ${started?.origin}, ohne eigenen Server`)
    check(started?.access?.signedIn === true, 'Neustart: Die Seite trägt den Geräteschlüssel')
    const ended = await readResult(path.join(again.selftest, 'trennen.json'), 120_000)
    check(ended?.loaded === true && ended?.origin === `http://127.0.0.1:${PORT}` && ended?.remote === null, `Trennen: zurück zur eigenen Seite (${ended?.origin})`)
    check(typeof ended?.serverPid === 'number' && ended?.access?.window === true, `Trennen: Der eigene Server läuft wieder (PID ${ended?.serverPid}, Fensterschlüssel)`)
    const againCode = await exitWithin(again.exited, 30_000)
    check(againCode === 0, `Trennen: Fenster endet mit 0 (${againCode})`)
    if (againCode === 'läuft noch') again.child.kill()
    check(await until(portFree, 15_000), 'Trennen: Danach ist der Port des eigenen Servers frei')
    fs.writeFileSync(path.join(out, 'kopplung-neustart.log'), again.output())
    remove(again.dataDir)
    check(pairedInSettings(a.userData) === null, 'Trennen: Die Kopplung ist aus fenster.json entfernt')
    check((await remote.devices())?.length === 0, 'Trennen: Das Fenster hat sich am Server entfernt')

    // c) Die Kopfzeile mit dem Geräteschlüssel unter einer IPv6-Adresse und unter einem Namen (Filter von
    // onBeforeSendHeaders auf den Ursprung)
    for (const [name, host, address] of /** @type {const} */ ([['kopplung-ipv6', '[::1]', `[::1]:${remotePort}`], ['kopplung-name', 'localhost', `localhost:${remotePort}`]])) {
      if (host === '[::1]' && !ipv6) {
        console.log('  - IPv6 übersprungen: Dieser Rechner lauscht nicht unter ::1')
        continue
      }
      const v = await pairWindow(name, address, await remote.pairingCode(), true)
      check(v.paired?.loaded === true && String(v.paired?.url).startsWith(`${httpsOrigin(host)}/`), `${host}: Seite über HTTPS geladen (${v.paired?.url ?? JSON.stringify(v.paired?.result)})`)
      check(v.paired?.access?.signedIn === true, `${host}: Die Seite trägt den Geräteschlüssel`)
      check(v.unpaired?.loaded === true && v.code === 0, `${host}: getrennt, Fenster endet mit 0 (${v.code})`)
    }

    // d) Ein anderes Zertifikat unter derselben Adresse (der Server neu eingerichtet): Das Laden scheitert, die
    // Rückfrage nennt den Grund und zeigt das Fenster, verborgen wie abgelegt
    const d = await pairWindow('kopplung-zertifikat', `127.0.0.1:${remotePort}`, await remote.pairingCode(), false)
    check(d.paired?.loaded === true && d.code === 0, 'Zertifikat: gekoppelt')
    await remote.stop()
    remote = null
    remote = await startRemote('gegenstelle-neu')
    check(remote.ready, 'Zertifikat: Gegenstelle mit neuem Zertifikat unter derselben Adresse')
    for (const [name, windowState, answer] of /** @type {const} */ ([['zertifikat-verborgen', 'hidden', 'quit'], ['zertifikat-abgelegt', 'minimized', 'disconnect']])) {
      // „Verbindung trennen“ startet den eigenen Server auf seinem Port; der muss frei sein
      await until(portFree, 15_000)
      // Mit dem Ordner für Electron des gekoppelten Fensters aus 7d, also mit dessen Kopplung
      const run = launch(name, { MIETFUCHS_SELFTEST_WINDOW: windowState, MIETFUCHS_SELFTEST_TROUBLE: answer }, d.userData)
      const trouble = await readResult(path.join(run.selftest, 'rueckfrage.json'), 120_000)
      report[name] = trouble
      check(trouble?.reason === 'cert', `${name}: Die Rückfrage nennt das andere Zertifikat (${JSON.stringify(trouble)})`)
      check(typeof trouble?.errorCode === 'number' && trouble.errorCode !== -3, `${name}: Das Laden scheitert mit did-fail-load (${trouble?.errorCode}), nicht als Abbruch`)
      check(trouble?.visible === true && trouble?.minimized === false, `${name}: Das Fenster ist zur Rückfrage zu sehen`)
      if (answer === 'disconnect') {
        // „Verbindung trennen“: zurück zum eigenen Server, beendet aus der Oberfläche
        const own = await until(async () => /** @type {any} */ (await fetch(`http://127.0.0.1:${PORT}/healthz`).then((r) => r.json()).catch(() => null))?.app === 'mietfuchs', 60_000)
        check(own, `${name}: „Verbindung trennen“ startet den eigenen Server`)
        await fetch(`http://127.0.0.1:${PORT}/api/quit`, { method: 'POST' }).catch(() => {})
        check(pairedInSettings(d.userData) === null, `${name}: Die Kopplung ist aus fenster.json entfernt`)
      }
      const code = await exitWithin(run.exited, 30_000)
      check(code === 0, `${name}: Fenster endet mit 0 (${code})`)
      if (code === 'läuft noch') run.child.kill()
      fs.writeFileSync(path.join(out, `${name}.log`), run.output())
      remove(run.dataDir)
    }
  }

  // ---------- 7b.: Kopplung über einen Proxy (#528) ----------
  await remote?.stop()
  remote = null
  await until(portFree, 15_000)
  /** @type {any} */
  let proxies = null
  try {
    // Test-CA und Test-Proxy wie in den Tests (api-kopplung-proxy.test.ts, desktop/test/pairing.test.js)
    proxies = await import(pathToFileURL(path.join(root, 'server', 'testing', 'proxy.ts')).href)
  } catch (err) {
    check(false, `Proxy: server/testing/proxy.ts lässt sich nicht laden, fehlt npm --prefix server ci? (${err})`)
  }
  if (proxies) {
    remote = await startRemote('gegenstelle-proxy', { NKA_TRUST_PROXY: '127.0.0.1,::1' })
    check(remote.ready, `Proxy: Gegenstelle mit NKA_TRUST_PROXY (tls ${remote.health?.tls}, Einrichtung ${remote.setupStatus})`)
    if (remote.ready) {
      const testCa = await proxies.createTestCa()
      const caFile = path.join(out, 'proxy-ca.pem')
      fs.writeFileSync(caFile, testCa.caCert)
      const started0 = /** @type {TestProxy} */ (await proxies.startTestProxy({ target: remoteBase, tls: testCa.leaf }))
      proxy = started0
      const viaProxy = `https://localhost:${started0.port}`

      // Ohne Test-CA: Das Zertifikat des Proxys kennt dieser Rechner nicht; Satz mit dem Stammzertifikat, kein Beweis
      const foreign = await pairWindow('proxy-fremd', viaProxy, await remote.pairingCode(), false)
      check(foreign.paired?.result?.ok !== true && /Stammzertifikat/.test(JSON.stringify(foreign.paired?.result)), `Proxy ohne Test-CA: Das Fenster nennt das Stammzertifikat (${JSON.stringify(foreign.paired?.result)})`)
      check(!started0.requests.some((r) => r.method === 'POST' && r.path === '/api/auth/pair'), 'Proxy ohne Test-CA: Am Proxy kommt kein Beweis an')
      check(pairedInSettings(foreign.userData) === null && foreign.code === 0, `Proxy ohne Test-CA: nicht gekoppelt, Fenster endet mit 0 (${foreign.code})`)

      // Mit Test-CA: Vertrauensart system, Bindung an den Ursprung
      const withCa = { MIETFUCHS_TEST_CA: caFile }
      await until(portFree, 15_000)
      const p = await pairWindow('proxy-kopplung', viaProxy, await remote.pairingCode(), false, withCa)
      report.proxyPairing = p.paired
      check(p.paired?.result?.ok === true && p.paired?.trust === 'system', `Proxy: gekoppelt in system (${JSON.stringify(p.paired?.result)}, trust ${p.paired?.trust})`)
      check(p.paired?.loaded === true && String(p.paired?.url).startsWith(`${viaProxy}/`), `Proxy: die Seite über den Proxy geladen (${p.paired?.url})`)
      check(p.paired?.access?.signedIn === true && p.paired?.access?.device === true, `Proxy: Die Seite trägt den Geräteschlüssel (${JSON.stringify(p.paired?.access)})`)
      const saved = pairedInSettings(p.userData)
      check(saved?.trust === 'system' && saved?.certSha256 === null && saved?.origin === viaProxy, `Proxy: in fenster.json als system ohne Fingerabdruck (${JSON.stringify({ trust: saved?.trust, certSha256: saved?.certSha256, origin: saved?.origin })})`)
      check(p.code === 0, `Proxy: Fenster endet mit 0 (${p.code})`)

      // Neustart: verbunden ohne eigenen Server; Trennen startet ihn
      await until(portFree, 15_000)
      const again = launch('proxy-neustart', { ...withCa, MIETFUCHS_SELFTEST_DISCONNECT: '1', MIETFUCHS_SELFTEST_QUIT: '1' }, p.userData)
      const started = await readResult(path.join(again.selftest, 'fenster.json'), 120_000)
      report.systemCa = started?.systemCa ?? null
      check(started?.origin === viaProxy && started?.serverPid === null && started?.access?.signedIn === true, `Proxy, Neustart: verbunden mit ${started?.origin}, ohne eigenen Server, angemeldet`)
      check(typeof started?.systemCa === 'number', `Proxy: Node liest den Speicher des Systems (${started?.systemCa} Zertifikate)`)
      const ended = await readResult(path.join(again.selftest, 'trennen.json'), 120_000)
      check(ended?.loaded === true && ended?.remote === null && typeof ended?.serverPid === 'number', `Proxy, Trennen: zurück zur eigenen Seite mit eigenem Server (${ended?.origin})`)
      const againCode = await exitWithin(again.exited, 30_000)
      if (againCode === 'läuft noch') again.child.kill()
      check(againCode === 0, `Proxy, Trennen: Fenster endet mit 0 (${againCode})`)
      fs.writeFileSync(path.join(out, 'proxy-neustart.log'), again.output())
      remove(again.dataDir)
      check(pairedInSettings(p.userData) === null && (await remote.devices())?.length === 0, 'Proxy, Trennen: Kopplung in fenster.json und am Server entfernt')
    }
  }
} finally {
  await /** @type {TestProxy | null} */ (proxy)?.close()
  await remote?.stop()
  for (const dir of userDirs) remove(dir)
  // Nur den Ordner, den diese Prüfung angelegt hat
  if (extractedServer) remove(extractedServer)
}

report.failures = failures
fs.writeFileSync(path.join(out, 'bericht.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(failures.length ? `\n${failures.length} Prüfung(en) fehlgeschlagen.` : '\nAlle Prüfungen bestanden.')
process.exit(failures.length ? 1 : 0)

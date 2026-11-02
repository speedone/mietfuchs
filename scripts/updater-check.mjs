// Echte Probe der automatischen Updates im Programmfenster (#517), unter Windows (x64 und ARM64) in release.yml, Job
// „Automatisches Update prüfen auf …“:
//
//   1. Die gebaute Fassung (v1) still installieren wie ein Nutzer. app-update.yml nennt speedone/mietfuchs auf GitHub
//      und keinen Herausgeber (keine Prüfung der Signatur), die Kopie des Installers für Teil-Downloads liegt da.
//   2. Eine zweite Fassung (v2, höhere Version und ein Migrationsschritt mehr, scripts/updater-probe.mjs) bietet ein
//      lokaler HTTP-Server als Quelle an (MIETFUCHS_UPDATE_FEED, gilt nur mit CI und nur auf 127.0.0.1). Er schreibt
//      jede Anfrage ins Protokoll.
//   3. Ohne Zustimmung: Fenster starten, Daten anlegen (smoke-test.mjs), über die Brücke „Jetzt prüfen“ auslösen; es
//      darf keine einzige Anfrage beim lokalen Server ankommen.
//   4. „Jetzt neu starten“: Zustimmung speichern, über die Brücke prüfen, warten bis „Version x ist bereit“ in der
//      Seitenleiste steht, den Knopf in der Oberfläche drücken. Danach muss v2 laufen (vom Installer gestartet).
//   5. „Beim nächsten Start“: v1 neu installieren, wie oben bis „bereit“, den Knopf drücken, Mietfuchs beenden
//      (/api/quit wie „Mietfuchs beenden“). Der Installer läuft still durch und startet nichts; danach v2 starten.
//   6. Nach 4. und 5.: v2 läuft mit dem Datenordner der Probe, alle Daten sind da (Objekte, Wohnungen,
//      Mietverhältnisse, Positionen, Belege), und die Sicherung vor dem Migrieren liegt daneben.
//
// Die Oberfläche bedient die Probe über das Chrome DevTools Protocol (--remote-debugging-port), also mit denselben
// Knöpfen und derselben Brücke wie ein Nutzer; einen eigenen Testgriff im Programm gibt es nicht.
//
//   node scripts/updater-check.mjs --setup <Installer v1> --feed <Ordner mit latest.yml, Installer und .blockmap von v2
//     und der .blockmap von v1> --version <v2> --step <Migrationsschritt von v2> --out <Ordner>
//
// Bericht in <out>/bericht.json, Exit 0 nur, wenn alles bestanden ist.
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { installedMatches, requestedFile } from './updater-probe.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const option = (/** @type {string} */ name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const setup = option('--setup')
const feedDir = option('--feed')
const v2 = option('--version')
const step = option('--step')
const out = path.resolve(option('--out') ?? 'update-pruefung')
if (process.platform !== 'win32' || !setup || !feedDir || !v2 || !step) {
  console.error('Aufruf unter Windows: node scripts/updater-check.mjs --setup <exe> --feed <Ordner> --version <v2> --step <Schritt> --out <Ordner>')
  process.exit(2)
}
fs.mkdirSync(out, { recursive: true })
const PORT = 17517
const BASE = `http://127.0.0.1:${PORT}`
const DEVTOOLS = 9229
const v1 = /** @type {any} */ (JSON.parse(fs.readFileSync(path.join(root, 'desktop', 'package.json'), 'utf8'))).version
const localAppData = /** @type {string} */ (process.env.LOCALAPPDATA)
const installDir = path.join(localAppData, 'Programs', 'mietfuchs')
const exe = path.join(installDir, 'Mietfuchs.exe')
const uninstaller = path.join(installDir, 'Uninstall Mietfuchs.exe')
const updaterCache = path.join(localAppData, 'mietfuchs-updater')
const windowLog = path.join(localAppData, 'mietfuchs-fenster', 'protokoll')

/** @type {Record<string, unknown>} */
const report = { platform: `${process.platform}-${process.arch}`, v1, v2, step }
/** @type {string[]} */
const failures = []
const check = (/** @type {boolean} */ ok, /** @type {string} */ what) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${what}`)
  if (!ok) failures.push(what)
  return ok
}
const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms))
/** @param {() => Promise<boolean> | boolean} condition @param {number} timeoutMs */
async function until(condition, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await Promise.resolve().then(condition).catch(() => false)) return true
    await sleep(500)
  }
  return false
}
const portFree = () => new Promise((resolve) => {
  const probe = net.createServer()
  probe.once('error', () => resolve(false))
  probe.listen(PORT, '127.0.0.1', () => probe.close(() => resolve(true)))
})
const json = async (/** @type {string} */ url, /** @type {RequestInit} */ init = {}) => /** @type {any} */ (await (await fetch(`${BASE}${url}`, { ...init, signal: AbortSignal.timeout(10_000) })).json())
const powershell = (/** @type {string} */ script) => execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim()
// Läuft noch ein Mietfuchs oder ein Installer aus dem Ordner des Updaters?
const running = () => powershell(`@(Get-Process | Where-Object { $_.ProcessName -eq 'Mietfuchs' -or ($_.Path -and $_.Path -like '*mietfuchs-updater*') -or $_.ProcessName -like 'Mietfuchs-Setup*' }).Count`) !== '0'
const versionInfo = () => {
  if (!fs.existsSync(exe)) return { file: '', product: '' }
  const [file = '', product = ''] = powershell(`$v = (Get-Item '${exe}').VersionInfo; "$($v.FileVersion)|$($v.ProductVersion)"`).split('|')
  return { file, product }
}
const installedVersion = () => { const v = versionInfo(); return v.file || v.product }
// FileVersion trägt die Version als Text, ProductVersion nur vierstellig ohne Vorabversion (Durchsicht S2)
const isInstalled = (/** @type {string} */ version) => installedMatches(versionInfo(), version)

// ---------- lokaler Server als Quelle, mit Protokoll ----------
/** @type {{ method: string, url: string, range: string | null, installationId: string | null, status: number, bytes: number }[]} */
const requests = []
const feed = http.createServer((req, res) => {
  const name = requestedFile(req.url ?? '/')
  const file = path.join(/** @type {string} */ (feedDir), path.basename(name))
  const id = req.headers['x-user-staging-id']
  const entry = { method: req.method ?? 'GET', url: req.url ?? '', range: req.headers.range ?? null, installationId: typeof id === 'string' ? id : null, status: 404, bytes: 0 }
  requests.push(entry)
  if (!name || name !== path.basename(name) || !fs.existsSync(file)) return res.writeHead(404).end()
  const size = fs.statSync(file).size
  const range = /^bytes=(\d+)-(\d*)$/.exec(entry.range ?? '')
  if (range) {
    const start = Number(range[1])
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
    entry.status = 206
    entry.bytes = end - start + 1
    res.writeHead(206, { 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': entry.bytes, 'accept-ranges': 'bytes' })
    return fs.createReadStream(file, { start, end }).pipe(res)
  }
  entry.status = 200
  entry.bytes = size
  res.writeHead(200, { 'content-length': size, 'accept-ranges': 'bytes' })
  fs.createReadStream(file).pipe(res)
})
await new Promise((resolve) => feed.listen(0, '127.0.0.1', () => resolve(null)))
const feedUrl = `http://127.0.0.1:${/** @type {net.AddressInfo} */ (feed.address()).port}/`
const requestsSince = (/** @type {number} */ from) => requests.slice(from)

// ---------- Installieren ----------
function uninstall() {
  if (fs.existsSync(uninstaller)) spawnSync(uninstaller, ['/S'], { stdio: 'inherit' })
  // Das Deinstallationsprogramm kopiert sich weg und kehrt sofort zurück
  for (let i = 0; i < 60 && fs.existsSync(exe); i++) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500)
  // Auch geladene Updates früherer Durchgänge, sonst nähme electron-updater sie aus dem Zwischenspeicher
  fs.rmSync(updaterCache, { recursive: true, force: true })
}
function installV1() {
  uninstall()
  const r = spawnSync(/** @type {string} */ (setup), ['/S'], { stdio: 'inherit' })
  check(r.status === 0 && fs.existsSync(exe), `v1 installiert (${installedVersion()})`)
}

/** @param {string} name @param {string} dataDir @param {boolean} [debug] */
function launch(name, dataDir, debug = true) {
  const child = spawn(exe, debug ? [`--remote-debugging-port=${DEVTOOLS}`] : [], {
    env: { ...process.env, CI: '1', NKA_DATA_DIR: dataDir, NKA_UPDATE_URL: 'http://127.0.0.1:9/kein-internet-im-test', MIETFUCHS_UPDATE_FEED: feedUrl, MIETFUCHS_SELFTEST_OUT: path.join(out, name) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (c) => { output += c })
  child.stderr.on('data', (c) => { output += c })
  child.once('exit', () => fs.writeFileSync(path.join(out, `${name}.log`), output))
  return child
}
const ready = () => until(async () => (await json('/healthz')).app === 'mietfuchs', 120_000)

// ---------- die Oberfläche über das DevTools-Protokoll ----------
/** @param {string} expression */
async function evaluate(expression) {
  /** @type {any[]} */
  const targets = /** @type {any} */ (await (await fetch(`http://127.0.0.1:${DEVTOOLS}/json/list`)).json())
  const target = targets.find((t) => t.type === 'page' && String(t.url).startsWith(BASE))
  if (!target) throw new Error(`keine Seite unter ${BASE}: ${JSON.stringify(targets.map((t) => t.url))}`)
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
  try {
    return await new Promise((resolve, reject) => {
      ws.onmessage = (event) => {
        const msg = JSON.parse(String(event.data))
        if (msg.id !== 1) return
        if (msg.result?.exceptionDetails) reject(new Error(JSON.stringify(msg.result.exceptionDetails).slice(0, 500)))
        else resolve(msg.result?.result?.value)
      }
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
    })
  } finally {
    ws.close()
  }
}
const updaterState = async () => /** @type {any} */ (await evaluate('window.mietfuchsDesktop.updater.get()'))
// Einen Knopf in der Seitenleiste drücken, wie ein Nutzer
/** @param {string} label */
const click = (label) => evaluate(`(() => {
  const hint = [...document.querySelectorAll('.update-hint')].find((h) => h.textContent.includes(${JSON.stringify(`Version ${v2} ist bereit`)}))
  const button = hint && [...hint.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)})
  if (!button) return false
  button.click()
  return true
})()`)

// ---------- Daten ----------
async function fingerprint() {
  /** @type {any[]} */
  const properties = await json('/api/properties')
  /** @type {Record<string, unknown>} */
  const result = { properties: properties.length }
  for (const p of properties) {
    for (const coll of ['units', 'tenancies', 'costItems']) {
      const list = await json(`/api/${coll}?property=${encodeURIComponent(p.id)}`)
      result[`${p.id}/${coll}`] = Array.isArray(list) ? list.map((x) => x.id).sort() : list
    }
  }
  /** @type {any[]} */
  const uploads = await json('/api/uploads')
  result.uploads = uploads.map((u) => u.file).sort()
  return result
}

/** @param {string} label @param {string} dataDir */
async function prepareData(label, dataDir) {
  let smoke = 0
  try {
    execFileSync(process.execPath, [path.join(root, 'scripts', 'smoke-test.mjs'), '--url', BASE, '--mode', 'desktop', '--version', v1], { stdio: 'inherit' })
  } catch (err) {
    smoke = /** @type {any} */ (err).status ?? 1
  }
  check(smoke === 0, `${label}: Daten angelegt (smoke-test.mjs)`)
  const before = await fingerprint()
  check(Number(before.properties) > 0, `${label}: ${before.properties} Objekte im Bestand von ${dataDir}`)
  return before
}

/** @param {string} label */
async function waitReady(label) {
  const from = requests.length
  await evaluate('window.mietfuchsDesktop.updater.check({ force: true })')
  const ok = await until(async () => (await updaterState()).phase === 'ready', 300_000)
  const state = await updaterState().catch(() => null)
  check(ok, `${label}: v${v2} geladen, Stand ${JSON.stringify(state)}`)
  const got = requestsSince(from)
  check(got.some((r) => requestedFile(r.url) === 'latest.yml'), `${label}: latest.yml vom lokalen Server gelesen`)
  // Keine Kennung der Installation (Durchsicht M2)
  check(got.every((r) => r.installationId === null || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(r.installationId)), `${label}: keine Kennung der Installation in den Anfragen`)
  const bytes = got.reduce((sum, r) => sum + r.bytes, 0)
  report[`${label}-download`] = { requests: got.length, bytes, full: fs.statSync(path.join(/** @type {string} */ (feedDir), `Mietfuchs-Setup-${v2}.exe`)).size }
  const hint = `[...document.querySelectorAll('.update-hint')].some((h) => h.textContent.includes(${JSON.stringify(`Version ${v2} ist bereit`)}))`
  check(await until(async () => (await evaluate(hint)) === true, 30_000), `${label}: Hinweis „Version ${v2} ist bereit“ in der Seitenleiste`)
}

/** @param {string} label @param {string} dataDir @param {Record<string, unknown>} before */
async function verifyV2(label, dataDir, before) {
  const status = await json('/api/update')
  check(status.current === v2, `${label}: Es läuft v${v2} (gemeldet ${status.current}, installiert ${installedVersion()})`)
  const after = await fingerprint()
  check(JSON.stringify(after) === JSON.stringify(before), `${label}: alle Daten da (${JSON.stringify(after).length} Zeichen Fingerabdruck)`)
  const backup = path.join(dataDir, `mietfuchs.sqlite.vor-${step}`)
  check(fs.existsSync(backup), `${label}: Sicherung vor dem Migrieren liegt vor (${path.basename(backup)})`)
}

// Die Protokolle des Fensters drehen bei jedem Start weiter; nach jedem Durchgang sichern (Durchsicht K7)
const saveLogs = (/** @type {string} */ prefix) => {
  for (const name of ['updater.log', 'updater.vorher.log', 'server.log', 'server.vorher.log']) {
    const file = path.join(windowLog, name)
    if (fs.existsSync(file)) fs.copyFileSync(file, path.join(out, `${prefix}-${name}`))
  }
}

const quit = async () => {
  await fetch(`${BASE}/api/quit`, { method: 'POST' }).catch(() => {})
  return until(async () => (await portFree()) && !running(), 60_000)
}

try {
  check(fs.existsSync(path.join(/** @type {string} */ (feedDir), 'latest.yml')), 'Quelle: latest.yml von v2 liegt bereit')

  // ---------- 1. Installieren ----------
  installV1()
  const appUpdate = fs.readFileSync(path.join(installDir, 'resources', 'app-update.yml'), 'utf8')
  report.appUpdateYml = appUpdate
  check(/provider: github/.test(appUpdate) && /owner: speedone/.test(appUpdate) && /repo: mietfuchs/.test(appUpdate), 'app-update.yml: Releases von speedone/mietfuchs')
  check(!/publisherName/.test(appUpdate), 'app-update.yml: kein Herausgeber, also keine Prüfung der Signatur')
  check(fs.existsSync(path.join(updaterCache, 'installer.exe')), 'Kopie des Installers für Teil-Downloads liegt unter mietfuchs-updater')

  // ---------- 3. Ohne Zustimmung ----------
  const dataNow = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-update-jetzt-'))
  let app = launch('jetzt-v1', dataNow)
  check(await ready(), 'Fenster v1 gestartet')
  const beforeNow = await prepareData('Jetzt', dataNow)
  check((await json('/api/settings')).updateCheck === undefined, 'Ohne Zustimmung: Häkchen nicht gesetzt')
  const silentFrom = requests.length
  check((await updaterState()).phase === 'idle', 'Ohne Zustimmung: Stand idle')
  await evaluate('window.mietfuchsDesktop.updater.check({ force: true })')
  await sleep(15_000)
  check(requestsSince(silentFrom).length === 0 && requests.length === 0, `Ohne Zustimmung: keine Anfrage an die Quelle (${requests.length} im Protokoll)`)

  // ---------- 4. „Jetzt neu starten“ ----------
  await json('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ updateCheck: 'on' }) })
  await waitReady('Jetzt')
  saveLogs('jetzt-v1-vorher')
  check(await click('Jetzt neu starten') === true, 'Jetzt: „Jetzt neu starten“ gedrückt')
  const oldGone = await until(async () => app.exitCode !== null, 60_000)
  check(oldGone, `Jetzt: v1 beendet sich (Code ${app.exitCode})`)
  // Der Installer läuft still und startet danach Mietfuchs (--force-run, über die Verknüpfung im Startmenü)
  const relaunched = await until(async () => isInstalled(v2) && (await json('/healthz')).app === 'mietfuchs', 300_000)
  check(relaunched, `Jetzt: Der Installer hat v${v2} installiert und gestartet (installiert ${installedVersion()})`)
  report.relaunch = relaunched ? await json('/api/update').catch(() => null) : null
  // Vom Installer gestartet, erbt Mietfuchs die Umgebung der Probe nicht unbedingt (Start über die Verknüpfung). Für die
  // Prüfung der Daten deshalb beenden und mit dem Datenordner der Probe starten; hat es ihn schon migriert, liegt die
  // Sicherung dort, sonst legt dieser Start sie an.
  saveLogs('jetzt-v1')
  check(await quit(), 'Jetzt: vom Installer gestartetes Mietfuchs beendet')
  app = launch('jetzt-v2', dataNow, false)
  check(await ready(), 'Jetzt: v2 mit dem Datenordner der Probe gestartet')
  await verifyV2('Jetzt', dataNow, beforeNow)
  check(await quit(), 'Jetzt: v2 beendet')

  // ---------- 5. „Beim nächsten Start“ ----------
  installV1()
  const dataLater = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-update-spaeter-'))
  app = launch('spaeter-v1', dataLater)
  check(await ready(), 'Später: Fenster v1 gestartet')
  const beforeLater = await prepareData('Später', dataLater)
  await json('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ updateCheck: 'on' }) })
  await waitReady('Später')
  check(await click('Beim nächsten Start') === true, 'Später: „Beim nächsten Start“ gedrückt')
  check(await until(async () => (await updaterState()).choice === 'later', 10_000), 'Später: Wahl gemerkt')
  check(isInstalled(v1), 'Später: Bis zum Beenden bleibt v1 installiert')
  // Mietfuchs normal beenden (wie „Mietfuchs beenden“)
  await fetch(`${BASE}/api/quit`, { method: 'POST' }).catch(() => {})
  check(await until(async () => app.exitCode !== null, 60_000), `Später: v1 beendet (Code ${app.exitCode})`)
  saveLogs('spaeter-v1')
  check(await until(async () => isInstalled(v2) && !running(), 300_000), `Später: Der Installer hat v${v2} still installiert (installiert ${installedVersion()})`)
  check(await portFree(), 'Später: Danach startet nichts von selbst')
  app = launch('spaeter-v2', dataLater, false)
  check(await ready(), 'Später: v2 gestartet')
  await verifyV2('Später', dataLater, beforeLater)
  check(await quit(), 'Später: v2 beendet')
} catch (err) {
  check(false, `Abbruch: ${err instanceof Error ? err.stack : String(err)}`)
} finally {
  report.requests = requests
  report.failures = failures
  fs.writeFileSync(path.join(out, 'bericht.json'), `${JSON.stringify(report, null, 2)}\n`)
  saveLogs('ende')
  const installerLog = path.join(os.tmpdir(), 'mietfuchs-installation.log')
  if (fs.existsSync(installerLog)) fs.copyFileSync(installerLog, path.join(out, 'mietfuchs-installation.log'))
  feed.close()
  if (running()) spawnSync('taskkill', ['/F', '/IM', 'Mietfuchs.exe'])
}
console.log(failures.length ? `\n${failures.length} Prüfung(en) fehlgeschlagen.` : '\nAlle Prüfungen bestanden.')
process.exit(failures.length ? 1 : 0)

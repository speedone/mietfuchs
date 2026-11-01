// Prüft das installierte Programmfenster (#517) von außen, auf dem Rechner, für den es gebaut ist (Windows, macOS):
//
//   1. Start mit den drei Angaben jedes Prüfstarts (Wegwerf-Datenordner, CI, Update-Adresse ins Leere) und der
//      Selbstprüfung des Fensters (MIETFUCHS_SELFTEST_OUT): Startzeit, Speicher, PDF der ersten Seite.
//   2. smoke-test.mjs gegen den Server im Fenster, Betriebsart desktop.
//   3. Ein zweiter Start holt nur das vorhandene Fenster nach vorn und endet.
//   4. Beenden aus der Oberfläche (/api/quit): Fenster und Server enden mit 0, der Port ist frei.
//   5. Absturz des Fensters (hart beendet): Der Server endet von selbst, keine Waise hält Port und Datenbank.
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
import { fileURLToPath } from 'node:url'

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

/** @param {string} name */
function launch(name) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-fenster-'))
  const selftest = path.join(out, name)
  const child = spawn(/** @type {string} */ (app), [], {
    env: { ...process.env, CI: '1', NKA_DATA_DIR: dataDir, NKA_UPDATE_URL: 'http://127.0.0.1:9/kein-internet-im-test', MIETFUCHS_SELFTEST_OUT: selftest },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (c) => { output += c })
  child.stderr.on('data', (c) => { output += c })
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)))
  return { child, dataDir, selftest, exited, output: () => output }
}

/** @param {Promise<unknown>} exited @param {number} ms */
const exitWithin = (exited, ms) => Promise.race([exited, sleep(ms).then(() => 'läuft noch')])

// ---------- 1. bis 4.: gewöhnlicher Lauf ----------
check(await portFree(), `Port ${PORT} ist vor dem Start frei`)
const t0 = Date.now()
const first = launch('lauf')
/** @type {number | null} */
let serverPid = null
const ready = await until(() => fs.existsSync(path.join(first.selftest, 'fenster.json')), 120_000)
check(ready, 'Fenster gestartet, Seite geladen, Selbstprüfung geschrieben')
if (ready) {
  const selftest = JSON.parse(fs.readFileSync(path.join(first.selftest, 'fenster.json'), 'utf8'))
  report.start = { ...selftest, seenAfterMs: Date.now() - t0 }
  check(selftest.origin === `http://127.0.0.1:${PORT}`, `Oberfläche unter http://127.0.0.1:${PORT}`)
  serverPid = typeof selftest.serverPid === 'number' ? selftest.serverPid : null
  check(serverPid !== null && serverPid !== first.child.pid && alive(serverPid), `Der Server läuft als eigener Prozess des Fensters (PID ${serverPid})`)
  const pdf = fs.readFileSync(path.join(first.selftest, 'fenster.pdf'))
  check(pdf.subarray(0, 5).toString() === '%PDF-', 'PDF der ersten Seite erzeugt')

  let smoke = 0
  try {
    execFileSync(process.execPath, [path.join(root, 'scripts', 'smoke-test.mjs'), '--url', `http://127.0.0.1:${PORT}`, '--mode', 'desktop'], { stdio: 'inherit' })
  } catch (err) {
    smoke = /** @type {any} */ (err).status ?? 1
  }
  check(smoke === 0, 'Prüfung von außen (smoke-test.mjs, Betriebsart desktop)')

  const second = launch('zweiter-start')
  const secondCode = await exitWithin(second.exited, 20_000)
  check(secondCode === 0, `Zweiter Start endet von selbst (Code ${secondCode})`)
  check(first.child.exitCode === null, 'Das erste Fenster läuft weiter')
  fs.rmSync(second.dataDir, { recursive: true, force: true })

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
if (await until(() => fs.existsSync(path.join(crash.selftest, 'fenster.json')), 120_000)) {
  // Hart, wie ein Absturz: unter Windows ohne die Möglichkeit, noch etwas zu tun
  if (process.platform === 'win32') execFileSync('taskkill', ['/F', '/PID', String(crash.child.pid)])
  else crash.child.kill('SIGKILL')
  await crash.exited
  const crashSelftest = JSON.parse(fs.readFileSync(path.join(crash.selftest, 'fenster.json'), 'utf8'))
  const crashServer = typeof crashSelftest.serverPid === 'number' ? crashSelftest.serverPid : null
  check(await until(portFree, 20_000), 'Nach einem Absturz des Fensters endet der Server von selbst (Port frei)')
  check(crashServer !== null && await until(() => !alive(crashServer), 20_000), `Nach dem Absturz bleibt keine Waise (PID ${crashServer})`)
} else {
  check(false, 'Zweiter Lauf für den Absturz gestartet')
  crash.child.kill()
}
fs.writeFileSync(path.join(out, 'absturz.log'), crash.output())
for (const dir of [first.dataDir, crash.dataDir]) fs.rmSync(dir, { recursive: true, force: true })

report.failures = failures
fs.writeFileSync(path.join(out, 'bericht.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(failures.length ? `\n${failures.length} Prüfung(en) fehlgeschlagen.` : '\nAlle Prüfungen bestanden.')
process.exit(failures.length ? 1 : 0)

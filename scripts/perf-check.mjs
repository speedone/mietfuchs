// Messung mit großem Bestand (perf-stock.mjs): Antwortzeiten des Servers, Start, Arbeitsspeicher, Größe der
// Datenbank, Backup und Wiederherstellen, ein CPU-Profil der langsamsten Route und ein Lauf durch jede Seite
// der Navigation in Chromium (1440 × 900 und 390 × 844) mit Zeiten, DOM-Knoten, Antwortgrößen, langen
// Aufgaben, typischen Aktionen und einem Foto je Seite.
//
//   node scripts/perf-check.mjs --size m --out /tmp/perf             (Bestand anlegen, dann messen)
//   node scripts/perf-check.mjs --size m --stock /tmp/perf-m --out /tmp/perf   (vorhandenen Bestand nehmen)
//   Weitere Angaben: --runs 7 (warme Aufrufe je Route), --skip-browser, --skip-build, --skip-profile, --skip-heavy
//
// Gemessen wird nie auf dem Bestand selbst, sondern auf einer Kopie je Serverstart (Wiederherstellen und
// Speichern ändern sie). Ergebnis: `<out>/<Stufe>/messung.json` und `messung.md`, Fotos und Profil daneben.
// Fotos und Profile gehören nie ins Repo.
//
// **Last**: Nur allein auf dem Rechner laufen lassen. Stufe m braucht grob 1 bis 2 GB, l ein Mehrfaches. Der Fall
// „Belegordner, alle Jahre und alle Objekte“ kann den Rechner lahmlegen (jedes Vorschaubild startet einen eigenen
// pdf.js-Worker), bis der Fix für die Belegvorschauen gemergt ist; er läuft deshalb zuletzt, `--skip-heavy` lässt ihn
// weg. Jeder Server bekommt NKA_DATA_DIR, CI=1 und NKA_UPDATE_URL
// (startPerfServer in perf-stock.mjs). Chromium einmalig: `npx playwright install chromium`.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { loadPlaywright } from './demo-stock.mjs'
import { buildStock, client, LAST_YEAR, startPerfServer } from './perf-stock.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}
const flag = (name) => process.argv.includes(`--${name}`)
const SIZE = arg('size', 'm')
const OUT_ROOT = arg('out', null)
if (!OUT_ROOT) throw new Error('Bitte mit --out <Ordner> aufrufen.')
const OUT = path.join(OUT_ROOT, SIZE)
const RUNS = Number(arg('runs', '7'))
fs.mkdirSync(OUT, { recursive: true })
const log = (t) => console.log(t)

// ---------- Hilfen ----------
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length === 0 ? 0 : s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}
const p95 = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length === 0 ? 0 : s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]
}
const round = (x) => Math.round(x * 10) / 10
/** @param {number} pid @returns {{ rssMb: number, peakMb: number }} */
function memoryOf(pid) {
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8')
    const kb = (key) => Number(new RegExp(`${key}:\\s+(\\d+)`).exec(status)?.[1] ?? 0)
    return { rssMb: round(kb('VmRSS') / 1024), peakMb: round(kb('VmHWM') / 1024) }
  } catch {
    return { rssMb: 0, peakMb: 0 }
  }
}
// Rechenzeit des Prozesses in ms (utime + stime aus /proc, Takt 100 Hz): unabhängig davon, was sonst auf dem Rechner
// läuft, anders als die Antwortzeit
/** @param {number} pid */
function cpuMsOf(pid) {
  try {
    const fields = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]?.split(' ') ?? []
    return (Number(fields[11]) + Number(fields[12])) * 10
  } catch {
    return 0
  }
}
const dirBytes = (dir) => {
  let total = 0
  let files = 0
  if (!fs.existsSync(dir)) return { bytes: 0, files: 0 }
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile()) { total += fs.statSync(path.join(dir, e.name)).size; files++ }
  }
  return { bytes: total, files }
}
const mb = (bytes) => round(bytes / 1024 / 1024)

// Eine Kopie des Bestands in einem neuen Wegwerf-Ordner
function copyStock(stockDir) {
  const parent = path.join(OUT_ROOT, 'kopien')
  fs.mkdirSync(parent, { recursive: true })
  const dir = fs.mkdtempSync(path.join(parent, `${SIZE}-`))
  fs.cpSync(stockDir, dir, { recursive: true })
  return dir
}

// ---------- Bestand ----------
let stockDir = arg('stock', null)
if (!stockDir) {
  stockDir = path.join(OUT_ROOT, `stock-${SIZE}`)
  if (!fs.existsSync(path.join(stockDir, 'perf-stock.json'))) {
    fs.rmSync(stockDir, { recursive: true, force: true })
    log(`Bestand ${SIZE} wird angelegt in ${stockDir} …`)
    await buildStock({ size: SIZE, dataDir: stockDir, log })
  }
}
/** @type {any} */
const stock = JSON.parse(fs.readFileSync(path.join(stockDir, 'perf-stock.json'), 'utf8'))
const P = stock.propertyList[0].id
const Y = LAST_YEAR
const YC = LAST_YEAR - 1
/** @type {any} */
const result = { size: SIZE, cpus: os.cpus().length, loadAtStart: os.loadavg().map(round), stock, server: {}, routes: [], writes: [], backup: {}, browser: [], actions: [], profile: null }

// ---------- Größe auf der Platte ----------
{
  const dbFile = path.join(stockDir, 'mietfuchs.sqlite')
  const tables = []
  try {
    const db = new DatabaseSync(dbFile, { readOnly: true })
    for (const row of db.prepare('SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name ORDER BY bytes DESC LIMIT 12').all()) tables.push({ name: row.name, mb: mb(Number(row.bytes)) })
    db.close()
  } catch (err) {
    tables.push({ name: `dbstat nicht verfügbar: ${err instanceof Error ? err.message : err}`, mb: 0 })
  }
  const uploads = dirBytes(path.join(stockDir, 'uploads'))
  result.disk = { databaseMb: mb(fs.statSync(dbFile).size), uploadsMb: mb(uploads.bytes), uploadFiles: uploads.files, tables }
}

// ---------- Server: Start, Routen, Speicher ----------
/** @type {[string, string, RequestInit?][]} */
const ROUTES = [
  ['Abrechnung offen', `/api/settlement/${Y}?property=${P}`],
  ['Abrechnung abgeschlossen', `/api/settlement/${YC}?property=${P}`],
  ['Verbrauch', `/api/consumption/${Y}?property=${P}`],
  ['Mietkonto', `/api/rentledger/${Y}?property=${P}`],
  ['Steuer', `/api/taxreport/${Y}?property=${P}`],
  ['Kostenliste', `/api/costItems?property=${P}`],
  ['Zähler', `/api/meters?property=${P}`],
  ['Ablesungen', `/api/readings?property=${P}`],
  ['Mietverhältnisse', `/api/tenancies?property=${P}`],
  ['Wohnungen', `/api/units?property=${P}`],
  ['Zahlungen', `/api/payments?property=${P}`],
  ['Belegliste', '/api/uploads'],
  ['Auswertungen', `/api/assessments?property=${P}`],
  ['Heizanlagen', `/api/heating-plants?property=${P}`],
  ['Verlauf alle', '/api/journal?limit=50'],
  ['Verlauf Objekt', `/api/journal?property=${P}&limit=50`],
  ['Objekte', '/api/properties'],
  ['Einstellungen', '/api/settings'],
]

async function timed(base, urlPath, init) {
  const t = performance.now()
  const res = await fetch(`${base}${urlPath}`, init)
  const body = Buffer.from(await res.arrayBuffer())
  return { ms: performance.now() - t, status: res.status, bytes: body.length, body }
}

{
  await calmMachine()
  const dir = copyStock(stockDir)
  /** @type {Awaited<ReturnType<typeof startPerfServer>> | null} */
  let server = null
  try {
    server = await startPerfServer(dir)
    result.server.startFirstMs = round(server.startMs)
    result.server.rssAfterStart = memoryOf(server.pid)
    await server.stop()
    // Gemessen wird ab dem zweiten Start: Der erste kann eine wöchentliche Sicherung anlegen (VACUUM INTO, wenn die
    // jüngste älter als sieben Tage ist, db/CLAUDE.md) und ist deshalb kein gewöhnlicher Start.
    server = await startPerfServer(dir)
    result.server.startSecondMs = round(server.startMs)
    const api = client(server.base)
    // Verlauf tief geblättert: dorthin, wo rund 80 % der Gruppen neuer sind
    const firstPage = await api.get('/api/journal?limit=1')
    const newest = firstPage[0]?.id ?? 0
    ROUTES.push(['Verlauf tief geblättert', `/api/journal?property=${P}&limit=50&before=${Math.max(1, Math.round(newest * 0.2))}`])
    ROUTES.push(['Verlauf Eintrag', `/api/journal/${newest}`])
    // Die Seite Verlauf (#318) fragt mit Sicherungspunkten; dazu die Filter und die Vorschauen von Rücksprung und Sicherung
    const yesterday = new Date(Date.now() - 86400000).toISOString()
    ROUTES.push(['Verlauf wie Seite (mit Sicherungen)', `/api/journal?limit=50&snapshots=1&property=${P}`])
    ROUTES.push(['Verlauf Suche', `/api/journal?limit=50&snapshots=1&property=${P}&q=Firma`])
    ROUTES.push(['Verlauf Suche ohne Treffer', `/api/journal?limit=50&snapshots=1&q=gibtesnicht`])
    ROUTES.push(['Verlauf Bereich Kosten', `/api/journal?limit=50&snapshots=1&property=${P}&kind=costs`])
    ROUTES.push(['Verlauf Bereich Belege', `/api/journal?limit=50&snapshots=1&property=${P}&kind=receipts`])
    ROUTES.push(['Verlauf ab gestern', `/api/journal?limit=50&snapshots=1&property=${P}&from=${encodeURIComponent(yesterday)}`])
    const json = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    ROUTES.push(['Rücksprung Vorschau neuester', `/api/journal/${newest}/revert/preview`, json({ mode: 'including' })])
    ROUTES.push(['Rücksprung Vorschau 100 zurück', `/api/journal/${Math.max(1, newest - 100)}/revert/preview`, json({ mode: 'including' })])
    ROUTES.push(['Rücksprung Vorschau 2.000 zurück', `/api/journal/${Math.max(1, newest - 2000)}/revert/preview`, json({ mode: 'including' })])
    // Die wöchentliche Sicherung, die der Aufbau beim zweiten Start angelegt hat (liegt tief in der Zeitachse)
    const priorVersion = fs.readdirSync(path.join(dir, 'vorversionen')).filter((f) => f.endsWith('.sqlite')).sort().at(-1)
    if (priorVersion) ROUTES.push(['Sicherung Vorschau', `/api/prior-versions/${encodeURIComponent(priorVersion)}/restore/preview`, json({})])
    for (const [name, urlPath, init] of ROUTES) {
      const cold = await timed(server.base, urlPath, init)
      if (cold.status >= 400) log(`  ${name}: HTTP ${cold.status} ${cold.body.toString().slice(0, 200)}`)
      const warm = []
      const cpuBefore = cpuMsOf(server.pid)
      for (let i = 0; i < RUNS; i++) warm.push((await timed(server.base, urlPath, init)).ms)
      const cpuMs = round((cpuMsOf(server.pid) - cpuBefore) / RUNS)
      const row = { name, path: urlPath, status: cold.status, coldMs: round(cold.ms), medianMs: round(median(warm)), p95Ms: round(p95(warm)), cpuMs, kb: round(cold.bytes / 1024) }
      result.routes.push(row)
      log(`  ${name.padEnd(26)} kalt ${String(row.coldMs).padStart(7)} ms  warm ${String(row.medianMs).padStart(7)} / p95 ${String(row.p95Ms).padStart(7)} ms  CPU ${row.cpuMs} ms  ${row.kb} kB`)
    }

    // Schreiben: eine Ablesung anlegen, eine Kostenposition ändern
    const meters = await api.get(`/api/meters?property=${P}`)
    const meter = meters.find((m) => m.unitId)
    const items = (await api.get(`/api/costItems?property=${P}`)).filter((c) => c.year === Y)
    /** @type {Record<string, number[]>} */
    const writes = { 'Ablesung anlegen (POST /api/readings)': [], 'Position ändern (PUT /api/costItems/:id)': [] }
    const writeCpu = cpuMsOf(server.pid)
    for (let i = 0; i < RUNS; i++) {
      const day = `${Y + 1}-01-${String(i + 2).padStart(2, '0')}`
      writes['Ablesung anlegen (POST /api/readings)'].push((await timed(server.base, `/api/readings?property=${P}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ meterId: meter.id, date: day, value: 999999 + i }),
      })).ms)
      writes['Position ändern (PUT /api/costItems/:id)'].push((await timed(server.base, `/api/costItems/${items[i % items.length].id}`, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vendor: `Messung ${i}` }),
      })).ms)
    }
    const writeCpuMs = round((cpuMsOf(server.pid) - writeCpu) / (2 * RUNS))
    for (const [name, xs] of Object.entries(writes)) result.writes.push({ name, medianMs: round(median(xs)), p95Ms: round(p95(xs)), cpuMs: writeCpuMs })
    result.server.rssAfterRoutes = memoryOf(server.pid)

    // Backup und Wiederherstellen
    const backup = await timed(server.base, '/api/backup')
    const backupFile = path.join(dir, '..', `perf-backup-${SIZE}.zip`)
    fs.writeFileSync(backupFile, backup.body)
    result.backup.backupMs = round(backup.ms)
    result.backup.backupMb = mb(backup.bytes)
    result.backup.status = backup.status
    result.server.rssAfterBackup = memoryOf(server.pid)
    const fd = new FormData()
    fd.append('file', new Blob([backup.body], { type: 'application/zip' }), 'backup.zip')
    const restore = await timed(server.base, '/api/restore', { method: 'POST', body: fd })
    result.backup.restoreMs = round(restore.ms)
    result.backup.restoreStatus = restore.status
    if (restore.status >= 400) result.backup.restoreError = restore.body.toString().slice(0, 500)
    result.server.rssAfterRestore = memoryOf(server.pid)
    const after = await timed(server.base, `/api/settlement/${Y}?property=${P}`)
    result.backup.settlementAfterRestore = after.status
    log(`  Backup ${result.backup.backupMb} MB in ${result.backup.backupMs} ms, Wiederherstellen HTTP ${restore.status} in ${result.backup.restoreMs} ms`)
    fs.rmSync(backupFile, { force: true })
  } finally {
    await server?.stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

// ---------- Profil der langsamsten Route ----------
/** @param {string} file */
function summarizeProfile(file) {
  /** @type {any} */
  const prof = JSON.parse(fs.readFileSync(file, 'utf8'))
  const byId = new Map(prof.nodes.map((n) => [n.id, n]))
  const parent = new Map()
  for (const n of prof.nodes) for (const c of n.children ?? []) parent.set(c, n.id)
  const keyOf = (n) => {
    const cf = n.callFrame
    const url = String(cf.url ?? '').replace(`file://${ROOT}/`, '')
    return `${cf.functionName || '(anonym)'} ${url ? `${url}:${cf.lineNumber + 1}` : '(intern)'}`
  }
  const self = new Map()
  const total = new Map()
  let all = 0
  for (let i = 0; i < prof.samples.length; i++) {
    const dt = (prof.timeDeltas[i] ?? 0) / 1000
    const id = prof.samples[i]
    const node = byId.get(id)
    if (!node) continue
    all += dt
    const k = keyOf(node)
    self.set(k, (self.get(k) ?? 0) + dt)
    const seen = new Set()
    for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
      const kk = keyOf(byId.get(cur))
      if (seen.has(kk)) continue
      seen.add(kk)
      total.set(kk, (total.get(kk) ?? 0) + dt)
    }
  }
  const top = (map, filter, n) => [...map.entries()].filter(([k]) => filter(k)).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, ms]) => ({ frame: k, ms: round(ms), share: round((ms / all) * 100) }))
  const ours = (k) => /(server\/src|shared)\//.test(k)
  return { totalMs: round(all), self: top(self, () => true, 20), inclusiveOurs: top(total, ours, 25) }
}

if (!flag('skip-profile')) {
  const slowest = [...result.routes].sort((a, b) => b.medianMs - a.medianMs).slice(0, 2)
  const profDir = path.join(OUT, 'profil')
  fs.rmSync(profDir, { recursive: true, force: true })
  fs.mkdirSync(profDir, { recursive: true })
  const dir = copyStock(stockDir)
  /** @type {Awaited<ReturnType<typeof startPerfServer>> | null} */
  let server = null
  try {
    // Erster Start kann die wöchentliche Sicherung anlegen; profiliert wird erst der zweite
    server = await startPerfServer(dir)
    await server.stop()
    result.profile = []
    for (const route of slowest) {
      const sub = path.join(profDir, route.name.replace(/\W+/g, '-'))
      fs.mkdirSync(sub, { recursive: true })
      server = await startPerfServer(dir, { nodeArgs: ['--cpu-prof', `--cpu-prof-dir=${sub}`, '--cpu-prof-interval=500'] })
      for (let i = 0; i < 10; i++) await timed(server.base, route.path)
      await server.stop()
      const file = fs.readdirSync(sub).find((f) => f.endsWith('.cpuprofile'))
      if (file) {
        const summary = summarizeProfile(path.join(sub, file))
        result.profile.push({ route: route.name, path: route.path, file: path.join(sub, file), ...summary })
        log(`  Profil ${route.name}: ${summary.inclusiveOurs.slice(0, 5).map((f) => `${f.frame} ${f.share} %`).join(' | ')}`)
      }
    }
  } finally {
    await server?.stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

// ---------- Browser ----------
const VIEWS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } }
const slug = (label) => label.toLowerCase().replace(/[äöüß&()]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss', '&': '', '(': '', ')': '' })[c] ?? '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// Im Fenster: lange Aufgaben, Ressourcen, laufende Abrufe und DOM-Änderungen mit der Uhr des Fensters
function instrument() {
  const w = /** @type {any} */ (globalThis)
  /** @type {{ lt: number[][], res: any[][], inflight: number, lastFetchEnd: number, lastMutation: number }} */
  const perf = { lt: [], res: [], inflight: 0, lastFetchEnd: 0, lastMutation: 0 }
  w.__perf = perf
  try { w.performance.setResourceTimingBufferSize(100000) } catch { /* alte Fenster */ }
  try {
    new w.PerformanceObserver((list) => { for (const e of list.getEntries()) perf.lt.push([e.startTime, e.duration]) }).observe({ type: 'longtask', buffered: true })
    new w.PerformanceObserver((list) => { for (const e of list.getEntries()) perf.res.push([e.startTime, e.responseEnd, e.encodedBodySize, e.decodedBodySize, e.name]) }).observe({ type: 'resource', buffered: true })
  } catch { /* ohne Beobachter */ }
  const original = w.fetch.bind(w)
  w.fetch = (...args) => {
    perf.inflight++
    return original(...args).finally(() => { perf.inflight--; perf.lastFetchEnd = w.performance.now() })
  }
  w.addEventListener('DOMContentLoaded', () => {
    new w.MutationObserver(() => { perf.lastMutation = w.performance.now() }).observe(w.document.body, { subtree: true, childList: true, characterData: true, attributes: true })
  })
}

// Wartet, bis nichts mehr lädt, rechnet oder sich ändert (600 ms Ruhe), höchstens `limit` ms
async function quiet(page, t0, limit = 300000) {
  return page.evaluate(async ({ t0, limit }) => {
    const w = /** @type {any} */ (globalThis)
    const perf = w.__perf
    const lastActivity = () => Math.max(
      t0, perf.lastFetchEnd, perf.lastMutation,
      ...perf.lt.filter(([s]) => s >= t0).map(([s, d]) => s + d),
      ...perf.res.filter(([s]) => s >= t0).map(([, end]) => end),
    )
    let capped = false
    for (;;) {
      await new Promise((r) => setTimeout(r, 100))
      const now = w.performance.now()
      if (perf.inflight === 0 && now - lastActivity() >= 600) break
      if (now - t0 > limit) { capped = true; break }
    }
    const lts = perf.lt.filter(([s]) => s >= t0)
    const res = perf.res.filter(([s]) => s >= t0)
    return {
      capped,
      doneMs: lastActivity() - t0,
      longTasks: lts.length,
      longTaskMs: lts.reduce((s, [, d]) => s + d, 0),
      longestTaskMs: lts.reduce((m, [, d]) => Math.max(m, d), 0),
      requests: res.length,
      transferKb: res.reduce((s, r) => s + r[2], 0) / 1024,
      decodedKb: res.reduce((s, r) => s + r[3], 0) / 1024,
      api: res.filter((r) => String(r[4]).includes('/api/')).map((r) => [String(r[4]).replace(/^https?:\/\/[^/]+/, ''), Math.round(r[1] - r[0]), Math.round(r[3] / 1024)]),
      dom: w.document.getElementsByTagName('*').length,
      height: w.document.documentElement.scrollHeight,
    }
  }, { t0, limit })
}

// Zeit bis Inhalt: eine andere Überschrift in `main` als vor dem Klick, kein „Wird geladen“, „Lädt …“ und kein
// Kreisel mehr. `before` ist die Überschrift vor dem Klick (beim ersten Laden leer).
async function contentAt(page, t0, before = '') {
  return page.evaluate(async ({ t0, before }) => {
    const w = /** @type {any} */ (globalThis)
    for (;;) {
      const main = w.document.querySelector('main')
      const text = main?.innerText ?? ''
      const heading = main?.querySelector('h1')?.textContent ?? ''
      if (main && heading && heading !== before && !/Wird geladen|wird geladen|Lädt die|Lädt …/.test(text) && !main.querySelector('.spinner')) return w.performance.now() - t0
      // Dieselbe Überschrift (etwa zweimal dieselbe Seite): nach einer Sekunde gilt sie
      if (heading === before && w.performance.now() - t0 > 1000 && !/Wird geladen|wird geladen|Lädt die|Lädt …/.test(text)) return w.performance.now() - t0
      if (w.performance.now() - t0 > 60000) return -1
      await new Promise((r) => w.requestAnimationFrame(r))
    }
  }, { t0, before })
}
const headingOf = (page) => page.evaluate(() => /** @type {any} */ (globalThis).document.querySelector('main h1')?.textContent ?? '')

const now = (page) => page.evaluate(() => /** @type {any} */ (globalThis).performance.now())

async function measureAction(page, name, view, action, limit = 300000, heapMb = async () => 0) {
  try {
    const t0 = await now(page)
    await action()
    const q = await quiet(page, t0, limit)
    const row = { view, name, capped: q.capped, load1: round(os.loadavg()[0]), heapMb: await heapMb().catch(() => 0), ms: round(q.doneMs), longTasks: q.longTasks, longTaskMs: round(q.longTaskMs), longestTaskMs: round(q.longestTaskMs), dom: q.dom }
    result.actions.push(row)
    log(`    Aktion ${name}: ${row.capped ? 'abgebrochen nach ' : ''}${row.ms} ms, ${row.longTasks} lange Aufgaben (${row.longTaskMs} ms, längste ${row.longestTaskMs} ms)`)
  } catch (err) {
    result.actions.push({ view, name, error: err instanceof Error ? err.message.split('\n')[0] : String(err) })
    log(`    Aktion ${name}: Fehler ${err instanceof Error ? err.message.split('\n')[0] : err}`)
    await page.keyboard.press('Escape').catch(() => {})
  }
}

// Belegordner über alle Jahre und alle Objekte: zuletzt, denn die Vorschaubilder starten je Beleg einen pdf.js-Worker,
// das belastet den ganzen Rechner (Last über 100) und kann den Tab zum Absturz bringen; alles danach wäre verfälscht.
async function heavyReceipts(page, view, heapMb) {
  const main = page.locator('main')
  const long = 600000
  const search = main.locator('input[type=search]')
  const allProps = main.getByLabel(/aller Objekte/)
  await measureAction(page, 'Belegordner: Häkchen alle Jahre', view, () => main.getByLabel(/aller Jahre/).check(), long, heapMb)
  await page.evaluate(() => /** @type {any} */ (globalThis).scrollTo(0, 0))
  await page.screenshot({ path: path.join(OUT, `${view}-belegordner-alle-jahre-oben.png`) })
  await measureAction(page, 'Belegordner: Suche „Stadtwerke“ in allen Jahren', view, () => search.fill('Stadtwerke'), long, heapMb)
  await measureAction(page, 'Belegordner: Suche leeren in allen Jahren', view, () => search.fill(''), long, heapMb)
  if (await allProps.count()) await measureAction(page, 'Belegordner: Häkchen alle Objekte', view, () => allProps.check(), long, heapMb)
  await page.evaluate(() => /** @type {any} */ (globalThis).scrollTo(0, 0))
  await page.screenshot({ path: path.join(OUT, `${view}-belegordner-alle-oben.png`) })
  const shot = path.join(OUT, `${view}-belegordner-alle.png`)
  await page.screenshot({ path: shot, fullPage: true }).catch(() => page.screenshot({ path: shot }))
}

// Wartet, bis der Rechner wieder ruhig ist (Last der letzten Minute unter 2, höchstens fünf Minuten)
async function calmMachine() {
  for (let i = 0; i < 60 && os.loadavg()[0] >= 2; i++) await new Promise((r) => setTimeout(r, 5000))
}

async function pageActions(page, id, view, heapMb) {
  const main = page.locator('main')
  const dialog = page.locator('dialog[open]').last()
  const closeDialog = async () => {
    await page.keyboard.press('Escape')
    const confirm = page.getByRole('alertdialog')
    if (await confirm.isVisible().catch(() => false)) await confirm.getByRole('button', { name: /Verwerfen/ }).click()
    await dialog.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {})
  }
  if (id === 'belegordner') {
    const search = main.locator('input[type=search]')
    await measureAction(page, 'Belegordner: Suche „Stadtwerke“', view, () => search.fill('Stadtwerke'), 600000, heapMb)
    await measureAction(page, 'Belegordner: Suche leeren', view, () => search.fill(''), 600000, heapMb)
  }
  if (id === 'verlauf') {
    await measureAction(page, 'Verlauf: Ältere Änderungen laden', view, () => main.getByRole('button', { name: 'Ältere Änderungen laden' }).click())
    await measureAction(page, 'Verlauf: Eintrag aufklappen', view, () => main.locator('details summary').first().click())
    // Der erste Eintrag, der sich Schritt für Schritt zurücknehmen lässt (Abschlüsse sind Schranken ohne Knöpfe)
    const revertable = main.locator('details').filter({ has: main.locator('button:has-text("Diese und alle späteren")') }).first()
    if (await revertable.count()) {
      await revertable.locator('summary').click()
      await measureAction(page, 'Verlauf: älteren Eintrag zurücknehmen, Vorschau bis Rückfrage', view, async () => {
        await revertable.locator('button:has-text("Diese und alle späteren")').click({ timeout: 10000 })
        await page.getByRole('alertdialog').waitFor({ timeout: 120000 })
      })
    }
    if (await page.getByRole('alertdialog').isVisible().catch(() => false)) await page.getByRole('alertdialog').getByRole('button', { name: 'Abbrechen' }).click()
    await measureAction(page, 'Verlauf: Suche „Firma“ (300 ms Pause eingeschlossen)', view, () => main.getByLabel('Suche').fill('Firma'))
    await measureAction(page, 'Verlauf: Suche leeren', view, () => main.getByLabel('Suche').fill(''))
    await measureAction(page, 'Verlauf: Bereich Kosten', view, () => main.getByLabel('Bereich').selectOption('costs'))
    await measureAction(page, 'Verlauf: alle Objekte', view, () => main.getByLabel('Objekt').selectOption({ index: 1 }))
  }
  if (id === 'kosten') {
    await measureAction(page, 'Kosten: Formular „+ Kostenposition anlegen“ öffnen', view, async () => {
      await page.getByRole('button', { name: '+ Kostenposition anlegen' }).click()
      await dialog.waitFor()
    })
    await closeDialog()
    await measureAction(page, 'Kosten: Position öffnen', view, async () => {
      await main.locator('button[title="Bearbeiten"]').first().click()
      await dialog.waitFor()
    })
    await measureAction(page, 'Kosten: Position speichern', view, async () => {
      const field = dialog.getByLabel('Beschreibung', { exact: false }).first()
      await field.fill(`${await field.inputValue()} (geprüft)`)
      await dialog.getByRole('button', { name: 'Speichern', exact: true }).click()
      await dialog.waitFor({ state: 'hidden', timeout: 30000 })
    })
    if (await dialog.isVisible().catch(() => false)) await closeDialog()
  }
  if (id === 'zaehler-staende') {
    await measureAction(page, 'Zähler: Ablesungen des ersten Zählers aufklappen', view, () => main.getByRole('button', { name: /^Ablesungen \(/ }).first().click())
    await measureAction(page, 'Zähler: Formular „+ Ablesung anlegen“ öffnen', view, async () => {
      await main.getByRole('button', { name: '+ Ablesung anlegen' }).first().click()
      await dialog.waitFor()
    })
    await closeDialog()
  }
  if (id === 'stammdaten') {
    await measureAction(page, 'Stammdaten: erstes Mietverhältnis bearbeiten öffnen', view, async () => {
      await main.getByRole('button', { name: /bearbeiten/i }).first().click()
      await dialog.waitFor()
    })
    await closeDialog()
  }
}

if (!flag('skip-browser')) {
  if (!flag('skip-build')) {
    log('Oberfläche wird gebaut …')
    const build = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' })
    if (build.status !== 0) throw new Error('npm run build ist gescheitert')
  }
  await calmMachine()
  const { chromium } = await loadPlaywright()
  const browser = await chromium.launch()
  try {
    for (const [view, viewport] of Object.entries(VIEWS)) {
      const dir = copyStock(stockDir)
      /** @type {Awaited<ReturnType<typeof startPerfServer>> | null} */
      let server = null
      try {
        server = await startPerfServer(dir)
        const base = server.base
        const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'de-DE', timezoneId: 'Europe/Berlin', colorScheme: 'light' })
        await context.addInitScript((property) => {
          try { /** @type {any} */ (globalThis).localStorage.setItem('mietfuchs.property', property) } catch { /* ohne Speicher */ }
        }, P)
        await context.addInitScript(instrument)
        const errors = []
        // Eine Seite mit Speicherangabe (CDP); stürzt der Tab ab, öffnet der Lauf eine neue und macht weiter
        const openPage = async () => {
          const p = await context.newPage()
          p.setDefaultTimeout(300000)
          p.on('dialog', (d) => { void d.accept() })
          p.on('pageerror', (err) => errors.push(err.message))
          const cdp = await context.newCDPSession(p)
          await cdp.send('Performance.enable')
          await p.goto(base)
          return { p, cdp }
        }
        let { p: page, cdp } = await openPage()
        const heapMb = async () => {
          const { metrics } = await cdp.send('Performance.getMetrics')
          return round(Number(metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? 0) / 1024 / 1024)
        }
        const firstContent = await contentAt(page, 0)
        const firstQuiet = await quiet(page, 0)
        log(`  ${view}: Start bis Inhalt ${round(firstContent)} ms, bis Ruhe ${round(firstQuiet.doneMs)} ms`)
        const isMobile = view === 'mobile'
        const navScope = async () => {
          if (!isMobile) return page.locator('nav.sidebar')
          await page.locator('button.menu-toggle').click()
          const sheet = page.locator('dialog.menu-sheet')
          await sheet.waitFor({ state: 'visible' })
          return sheet
        }
        const scope = await navScope()
        const labels = await scope.locator('.nav-group button').evaluateAll((buttons) => buttons.map((b) => {
          const icon = b.querySelector('span')?.textContent ?? ''
          return (b.textContent ?? '').replace(icon, '').trim()
        }))
        if (isMobile) await page.keyboard.press('Escape')
        for (const label of labels) {
          const id = slug(label)
          errors.length = 0
          try {
            const target = await navScope()
            const before = await headingOf(page)
            const t0 = await now(page)
            await target.locator('.nav-group button').filter({ hasText: label }).first().click()
            const contentMs = await contentAt(page, t0, before)
            const q = await quiet(page, t0)
            await page.evaluate(() => /** @type {any} */ (globalThis).scrollTo(0, 0))
            await page.screenshot({ path: path.join(OUT, `${view}-${id}-oben.png`) })
            const shot = path.join(OUT, `${view}-${id}.png`)
            await page.screenshot({ path: shot, fullPage: true }).catch(() => page.screenshot({ path: shot }))
            const row = {
              view, page: label, id, contentMs: round(contentMs), readyMs: round(Math.max(contentMs, q.doneMs)), dom: q.dom, heightPx: q.height,
              requests: q.requests, apiKb: round(q.api.reduce((s, a) => s + a[2], 0)), decodedKb: round(q.decodedKb), longTasks: q.longTasks,
              longTaskMs: round(q.longTaskMs), longestTaskMs: round(q.longestTaskMs), heapMb: await heapMb(), load1: round(os.loadavg()[0]), api: q.api, errors: [...errors], shot,
            }
            result.browser.push(row)
            log(`  ${view} ${label.padEnd(20)} Inhalt ${String(row.contentMs).padStart(7)} ms  bedienbar ${String(row.readyMs).padStart(7)} ms  DOM ${String(row.dom).padStart(6)}  ${row.apiKb} kB API  lange Aufgaben ${row.longTasks} (${row.longTaskMs} ms)  Höhe ${row.heightPx} px  Heap ${row.heapMb} MB`)
            await pageActions(page, id, view, heapMb)
          } catch (err) {
            const text = err instanceof Error ? err.message.split('\n')[0] : String(err)
            result.actions.push({ view, name: `${label}: abgebrochen`, error: text })
            log(`  ${view} ${label}: abgebrochen (${text})`)
            if (/crash/i.test(text) || page.isClosed()) {
              await page.close().catch(() => {})
              ;({ p: page, cdp } = await openPage())
              await quiet(page, 0)
            }
          }
        }
        // Zuletzt der Belegordner über alle Jahre und Objekte (siehe heavyReceipts); `--skip-heavy` lässt ihn aus
        if (!flag('skip-heavy')) try {
          const target = await navScope()
          await target.locator('.nav-group button').filter({ hasText: 'Belegordner' }).first().click()
          await quiet(page, await now(page))
          await heavyReceipts(page, view, heapMb)
        } catch (err) {
          const text = err instanceof Error ? err.message.split('\n')[0] : String(err)
          result.actions.push({ view, name: 'Belegordner alle Jahre/Objekte: abgebrochen', error: text })
          log(`  ${view} Belegordner alle Jahre/Objekte: abgebrochen (${text})`)
        }
        result.browser.push({ view, page: '(Start)', id: 'start', contentMs: round(firstContent), readyMs: round(firstQuiet.doneMs), dom: firstQuiet.dom, longTasks: firstQuiet.longTasks, longTaskMs: round(firstQuiet.longTaskMs), longestTaskMs: round(firstQuiet.longestTaskMs), apiKb: round(firstQuiet.api.reduce((s, a) => s + a[2], 0)), decodedKb: round(firstQuiet.decodedKb), requests: firstQuiet.requests, api: firstQuiet.api })
        await context.close()
      } finally {
        await server?.stop()
        fs.rmSync(dir, { recursive: true, force: true })
        await calmMachine()
      }
    }
  } finally {
    await browser.close()
  }
}

// ---------- Ergebnis ----------
result.loadAtEnd = os.loadavg().map(round)
fs.writeFileSync(path.join(OUT, 'messung.json'), JSON.stringify(result, null, 2))
const md = []
md.push(`# Messung Stufe ${SIZE}`, '', `Rechner: ${result.cpus} Kerne, Last (1/5/15 min) am Anfang ${result.loadAtStart.join(' / ')}, am Ende ${result.loadAtEnd.join(' / ')}.`, '', `Bestand: ${JSON.stringify({ ...stock, propertyList: undefined })}`, '')
md.push(`Datenbank ${result.disk.databaseMb} MB, Belege ${result.disk.uploadsMb} MB in ${result.disk.uploadFiles} Dateien. Start ${result.server.startFirstMs} ms (mit Vorversion), ${result.server.startSecondMs} ms. RSS nach Start ${result.server.rssAfterStart?.rssMb} MB, nach den Routen ${result.server.rssAfterRoutes?.rssMb} MB, Spitze ${result.server.rssAfterRestore?.peakMb} MB.`, '')
md.push('| Route | kalt ms | Median ms | p95 ms | CPU ms je Aufruf | kB |', '|---|---:|---:|---:|---:|---:|')
for (const r of result.routes) md.push(`| ${r.name} | ${r.coldMs} | ${r.medianMs} | ${r.p95Ms} | ${r.cpuMs} | ${r.kb} |`)
for (const w of result.writes) md.push(`| ${w.name} | | ${w.medianMs} | ${w.p95Ms} | ${w.cpuMs ?? ''} | |`)
md.push('', `Backup ${result.backup.backupMb} MB in ${result.backup.backupMs} ms; Wiederherstellen HTTP ${result.backup.restoreStatus} in ${result.backup.restoreMs} ms.`, '')
if (result.browser.length) {
  md.push('| Ansicht | Seite | Inhalt ms | bedienbar ms | DOM | API kB | lange Aufgaben | davon ms | längste ms | Höhe px | JS-Heap MB | Last |', '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
  for (const b of result.browser) md.push(`| ${b.view} | ${b.page} | ${b.contentMs} | ${b.readyMs} | ${b.dom} | ${b.apiKb} | ${b.longTasks} | ${b.longTaskMs} | ${b.longestTaskMs} | ${b.heightPx ?? ''} | ${b.heapMb ?? ''} | ${b.load1 ?? ''} |`)
  md.push('', '| Ansicht | Aktion | ms | lange Aufgaben | davon ms | längste ms | JS-Heap MB | Last |', '|---|---|---:|---:|---:|---:|---:|---:|')
  for (const a of result.actions) md.push(a.error ? `| ${a.view} | ${a.name} | Fehler: ${a.error} | | | | | |` : `| ${a.view} | ${a.name} | ${a.capped ? '> ' : ''}${a.ms} | ${a.longTasks} | ${a.longTaskMs} | ${a.longestTaskMs} | ${a.heapMb} | ${a.load1} |`)
}
for (const p of result.profile ?? []) {
  md.push('', `## Profil ${p.route} (${p.totalMs} ms Stichproben)`, '', '| Rahmen (inklusive, eigener Code) | ms | % |', '|---|---:|---:|')
  for (const f of p.inclusiveOurs) md.push(`| ${f.frame} | ${f.ms} | ${f.share} |`)
  md.push('', '| Rahmen (eigene Zeit) | ms | % |', '|---|---:|---:|')
  for (const f of p.self) md.push(`| ${f.frame} | ${f.ms} | ${f.share} |`)
}
fs.writeFileSync(path.join(OUT, 'messung.md'), `${md.join('\n')}\n`)
log(`Ergebnis: ${path.join(OUT, 'messung.md')}`)

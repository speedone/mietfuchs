// Der Umzug ins Programmfenster, praktisch durchgespielt mit echten alten Fassungen (#517).
//
// **Wozu, wenn es api-umzug.test.ts gibt.** Die Tests legen die alten Ordner selbst an, mit dem Code von heute. Draußen
// liegen Ordner, die alte Programmdateien geschrieben haben: eine db.json aus 0.3, eine Datenbank aus 0.9, Belege,
// Sicherungen, Reste eines Umstiegs. Hier schreibt sie jede Fassung selbst, und der Umzug von heute muss sie lesen.
//
// Je Fassung:
//   1. Die Linux-Programmdatei von den GitHub-Releases laden (mit Zeit- und Größengrenze, zwischengespeichert, nie ins
//      Repo), in einen Wegwerf-Ordner wie draußen legen: `Downloads/mietfuchs-<Fassung>/mietfuchs-linux` und daneben
//      `data/`. Ein Bestand entsteht über die API der Fassung: Backup einspielen (db.json mit Beleg), dann eine Zahlung.
//   2. Abrechnung 2024, Zahlen und Backup über die API der alten Fassung holen.
//   3. Den Server von heute als Programmfenster nachgestellt (NKA_RUNTIME=desktop) mit leerem Datenordner starten; er
//      findet den Ordner über die Suche, beendet die alte Fassung (wo sie /api/quit kennt) und übernimmt.
//   4. Prüfen: Abrechnung centgenau wie vorher in der alten Fassung und wie der Server von heute auf einer Kopie des
//      alten Ordners rechnet, Zahlen gleich, Belege mit Inhalt da, Vermerk im alten Ordner, sonst dort nichts verändert.
//   5. Eine aktuelle Fassung im umgezogenen Ordner nur lesend; die alte Fassung ändert danach noch etwas, das Fenster
//      erkennt es und übernimmt den neueren Stand auf Wunsch. Derselbe Weg über das Backup der alten Fassung.
//
// Aufruf:
//   node scripts/fenster-umzug-praxislauf.mjs                       (alle Fassungen)
//   node scripts/fenster-umzug-praxislauf.mjs --nur 0.3.1           (eine Fassung)
//   node scripts/fenster-umzug-praxislauf.mjs --cache <Ordner> --out <Ordner>
//
// Jeder Lauf bekommt Wegwerf-Ordner, CI=1 und NKA_UPDATE_URL ins Leere; HOME zeigt für alte wie neue Fassung in den
// Wegwerf-Ordner. Rückgabewert 0, wenn alles hält, sonst 1. Nur unter Linux (die alten Programmdateien sind die für
// Linux x64; Suche und Pfade unter Windows und macOS prüfen server/test/relocation.test.ts und desktop-check.mjs).

import { spawn, execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import AdmZip from '../server/node_modules/adm-zip/adm-zip.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SERVER = path.join(ROOT, 'server', 'src', 'index.ts')
const REPO = 'speedone/mietfuchs'

// Die Fassungen: 0.3.1 und 0.7.1 mit db.json (vor der Datenbank), 0.9.0 mit Datenbank und Umstieg, 0.12.0 mit
// mehreren Objekten und Zeiträumen, 0.14.1 als letzte Programmdatei vor dem Fenster.
const VERSIONS = ['0.3.1', '0.7.1', '0.9.0', '0.12.0', '0.14.1']
// Grenzen für die Downloads: die Programmdateien sind 40 bis 60 MB groß
const DOWNLOAD_MAX_BYTES = 150 * 1024 ** 2
const DOWNLOAD_TIMEOUT_MS = 180_000
const UPDATE_URL = 'http://127.0.0.1:9/kein-internet-im-praxislauf'

const args = process.argv.slice(2)
const option = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const only = option('--nur')
if (only && !VERSIONS.includes(only)) {
  console.error(`Unbekannte Fassung ${only}; bekannt sind ${VERSIONS.join(', ')}.`)
  process.exit(2)
}
const CACHE = path.resolve(option('--cache') ?? path.join(os.tmpdir(), 'mietfuchs-alte-fassungen'))
const OUT = option('--out') ? path.resolve(/** @type {string} */ (option('--out'))) : null

// ---------- Ausgabe ----------

let fehler = 0
/** @type {{ version: string, weg: string, ok: boolean, befunde: string[] }[]} */
const bericht = []
/** @type {{ version: string, weg: string, ok: boolean, befunde: string[] } | null} */
let laufend = null
const ok = (text) => console.log(`  ✓ ${text}`)
const info = (text) => console.log(`  ℹ ${text}`)
const fail = (text) => {
  fehler++
  if (laufend) {
    laufend.ok = false
    laufend.befunde.push(text)
  }
  console.log(`  ✗ ${text}`)
}
const gleich = (ist, soll, was) =>
  JSON.stringify(ist) === JSON.stringify(soll)
    ? ok(was)
    : fail(`${was}\n      erwartet: ${JSON.stringify(soll).slice(0, 600)}\n      bekommen: ${JSON.stringify(ist).slice(0, 600)}`)
const wahr = (bedingung, was) => (bedingung ? ok(was) : fail(was))

// ---------- Herunterladen ----------

async function download(version) {
  const dir = path.join(CACHE, `v${version}`)
  const binary = path.join(dir, 'mietfuchs-linux')
  if (fs.existsSync(binary)) return binary
  fs.mkdirSync(dir, { recursive: true })
  const url = `https://github.com/${REPO}/releases/download/v${version}/mietfuchs-linux.tar.gz`
  const archive = path.join(dir, 'mietfuchs-linux.tar.gz')
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS), redirect: 'follow' })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      const announced = Number(res.headers.get('content-length'))
      if (announced > DOWNLOAD_MAX_BYTES) throw new Error(`zu groß (${announced} Byte)`)
      let bytes = 0
      const limit = new Transform({
        transform(chunk, _encoding, callback) {
          bytes += chunk.length
          callback(bytes > DOWNLOAD_MAX_BYTES ? new Error(`zu groß (über ${DOWNLOAD_MAX_BYTES} Byte)`) : null, chunk)
        },
      })
      await pipeline(Readable.fromWeb(/** @type {any} */ (res.body)), limit, fs.createWriteStream(archive))
      break
    } catch (err) {
      fs.rmSync(archive, { force: true })
      if (attempt >= 3) throw new Error(`v${version} ließ sich nicht laden: ${err instanceof Error ? err.message : err}`)
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt))
    }
  }
  // Ein eigener, leerer Ordner zum Auspacken; danach nur die eine erwartete Datei übernehmen
  const unpack = fs.mkdtempSync(path.join(dir, 'auspacken-'))
  try {
    execFileSync('tar', ['-xzf', archive, '-C', unpack, '--no-same-owner'])
    const found = path.join(unpack, 'mietfuchs-linux')
    if (!fs.statSync(found).isFile()) throw new Error('mietfuchs-linux fehlt im Archiv')
    fs.renameSync(found, binary)
    fs.chmodSync(binary, 0o755)
  } finally {
    fs.rmSync(unpack, { recursive: true, force: true })
    fs.rmSync(archive, { force: true })
  }
  return binary
}

// ---------- Prozesse ----------

const freePort = () => new Promise((resolve) => {
  import('node:net').then(({ default: net }) => {
    const probe = net.createServer()
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      probe.close(() => resolve(typeof address === 'object' && address ? address.port : 0))
    })
  })
})

// Nur PATH, HOME im Wegwerf-Ordner, keine Anzeige: Eine alte Fassung ohne CI-Regel öffnete sonst einen Browser.
const cleanEnv = (home) => ({ PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, LANG: 'C.UTF-8', CI: '1', NKA_UPDATE_URL: UPDATE_URL })

async function waitForHealth(base, child, log, seconds = 90) {
  for (let i = 0; i < seconds * 5; i++) {
    if (child.exitCode !== null) throw new Error(`beendet mit Code ${child.exitCode}: ${log().slice(-800)}`)
    try {
      const report = /** @type {any} */ (await (await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(2000) })).json().catch(() => null))
      if (report?.app === 'mietfuchs' && report.status !== 'starting') return report
      // Bis 0.3 gab es kein /healthz; dann genügen die Einstellungen
      const settings = await fetch(`${base}/api/settings`, { signal: AbortSignal.timeout(2000) })
      if (!report && settings.ok) return { app: 'mietfuchs', status: 'ok' }
    } catch {
      // läuft noch nicht
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`antwortet nicht: ${log().slice(-800)}`)
}

/** Eine alte Programmdatei, wie draußen gestartet: aus ihrem Ordner, Daten in `data/` daneben. */
async function startOld(binary, dataDir, home, port) {
  const child = spawn(binary, [], {
    cwd: path.dirname(dataDir),
    env: { ...cleanEnv(home), NKA_DATA_DIR: dataDir, NKA_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (d) => { output += d })
  child.stderr.on('data', (d) => { output += d })
  const base = `http://127.0.0.1:${port}`
  await waitForHealth(base, child, () => output)
  return { child, base, log: () => output }
}

/** Der Server von heute; `desktop` stellt das Programmfenster nach. */
async function startNew(dataDir, home, env = {}) {
  const child = spawn(process.execPath, [SERVER], {
    cwd: path.join(ROOT, 'server'),
    env: { ...cleanEnv(home), NKA_DATA_DIR: dataDir, NKA_PORT: '0', NKA_HOST: '127.0.0.1', ...env, CI: '1', NKA_UPDATE_URL: UPDATE_URL },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (d) => { output += d })
  child.stderr.on('data', (d) => { output += d })
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server von heute startet nicht: ${output}`)), 60_000)
    child.stdout.on('data', () => {
      const match = output.match(/läuft auf (http:\/\/\S+)/)
      if (match) {
        clearTimeout(timer)
        resolve(match[1])
      }
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`Server von heute beendet (Code ${code}): ${output}`))
    })
  })
  return { child, base, log: () => output }
}

/** Beenden über die PID, nie über den Namen. */
async function stop(proc) {
  if (proc.child.exitCode !== null) return
  const gone = new Promise((resolve) => proc.child.once('exit', resolve))
  proc.child.kill()
  await Promise.race([gone, new Promise((resolve) => setTimeout(resolve, 5000))])
  if (proc.child.exitCode === null && proc.child.signalCode === null) proc.child.kill('SIGKILL')
}

const json = async (res) => {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return { _keinJson: text.slice(0, 300) }
  }
}
const get = async (base, url) => json(await fetch(`${base}${url}`))
const send = async (base, url, method, body) => {
  const res = await fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })
  return { status: res.status, body: await json(res) }
}
async function restore(base, zip) {
  const form = new FormData()
  form.append('file', new Blob([zip], { type: 'application/zip' }), 'mietfuchs-backup.zip')
  const res = await fetch(`${base}/api/restore`, { method: 'POST', body: form })
  return { status: res.status, body: await json(res) }
}

// ---------- Der Bestand ----------

// Zwei Wohnungen, zwei Mietverhältnisse, zwei Kostenpositionen (Fläche, Personen), eine mit Beleg, ein Kaltwasserzähler
// mit zwei Ablesungen, eine Zahlung. Im Format der db.json von 0.2/0.3, das jede spätere Fassung einliest. Beide
// Mietverhältnisse laufen das ganze Jahr: Leerstand rechnet Mietfuchs seit 0.3 anders (der Vermieter trägt ihn), und
// verglichen wird auch mit der Abrechnung der alten Fassung selbst.
const RECEIPT = Buffer.from('%PDF-1.4\n% Abfallgebühren 2024, Praxislauf des Umzugs\n%%EOF\n')
const PHOTO = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(2048)])
const stock = () => ({
  settings: { houseName: 'Haus am Weg', address: 'Weg 1, 12345 Stadt', landlordName: 'V. Vermieter', iban: 'DE02 1203 0000 0000 2020 51', paymentDeadlineDays: 30 },
  units: [
    { id: 'u1', name: 'EG', areaM2: 80, participates: true },
    { id: 'u2', name: 'OG', areaM2: 40, participates: true },
  ],
  tenancies: [
    {
      id: 't1', unitId: 'u1', tenantName: 'Müller', persons: 2, personHistory: [{ from: '2024-01-01', persons: 2 }],
      start: '2024-01-01', end: null, prepayments: [{ from: '2024-01', monthlyCents: 15000 }], prepaymentOverrides: {},
      baseRents: [{ from: '2024-01', monthlyCents: 60000 }],
    },
    {
      id: 't2', unitId: 'u2', tenantName: 'Schmidt', persons: 1, personHistory: [{ from: '2024-01-01', persons: 1 }],
      start: '2024-01-01', end: null, prepayments: [{ from: '2024-01', monthlyCents: 10000 }], prepaymentOverrides: {},
      baseRents: [{ from: '2024-01', monthlyCents: 40000 }],
    },
  ],
  costItems: [
    { id: 'c1', year: 2024, category: 'Müllabfuhr', description: 'Abfallgebühren 2024', amountCents: 120001, key: 'area', invoiceFile: 'abfall-2024.pdf' },
    { id: 'c2', year: 2024, category: 'Straßenreinigung', description: 'Straßenreinigung 2024', amountCents: 33333, key: 'persons' },
  ],
  meters: [{ id: 'm1', name: 'Küche', unitId: 'u1', type: 'kaltwasser', unit: 'm³' }],
  readings: [
    { id: 'r1', meterId: 'm1', date: '2023-12-31', value: 100 },
    { id: 'r2', meterId: 'm1', date: '2024-12-31', value: 161.5 },
  ],
  payments: [{ id: 'p1', tenancyId: 't1', date: '2024-01-05', amountCents: 75000 }],
  closedSettlements: [],
})

function stockZip() {
  const zip = new AdmZip()
  zip.addFile('db.json', Buffer.from(JSON.stringify(stock())))
  zip.addFile('uploads/abfall-2024.pdf', RECEIPT)
  zip.addFile('uploads/zaehler-kueche.jpg', PHOTO)
  return zip.toBuffer()
}

// Was eine Abrechnung ausmacht, in jeder Fassung gleich benannt: je Mieter Anteil, Vorauszahlung, Saldo und jede
// Zeile, dazu Vermieteranteil und Gesamtkosten. Anzeigetexte (Rechenweg, Hinweise) bleiben außen vor.
function settlementCore(s) {
  if (!s || !Array.isArray(s.statements)) return { _keineAbrechnung: s }
  return {
    totalCostsCents: s.totalCostsCents,
    landlordCents: s.landlord?.totalCents,
    statements: s.statements
      .map((t) => ({
        tenancyId: t.tenancyId,
        totalShareCents: t.totalShareCents,
        prepaymentCents: t.prepaymentCents,
        balanceCents: t.balanceCents,
        rows: (t.rows ?? []).map((r) => ({ costItemId: r.costItemId, shareCents: r.shareCents })).sort((a, b) => String(a.costItemId).localeCompare(String(b.costItemId))),
      }))
      .sort((a, b) => String(a.tenancyId).localeCompare(String(b.tenancyId))),
  }
}

async function numbersOf(base) {
  const lengthOf = async (url) => {
    const list = await get(base, url)
    return Array.isArray(list) ? list.length : -1
  }
  return {
    units: await lengthOf('/api/units'),
    tenancies: await lengthOf('/api/tenancies'),
    costItems: await lengthOf('/api/costItems'),
    meters: await lengthOf('/api/meters'),
    readings: await lengthOf('/api/readings'),
    payments: await lengthOf('/api/payments'),
  }
}

// Alles in einem Ordner mit Inhalt und Zeit: Der Umzug darf im alten Ordner nichts ändern außer dem Vermerk.
function fingerprint(dir) {
  /** @type {Record<string, string>} */
  const out = {}
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.isFile()) out[path.relative(dir, full)] = `${crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')}@${fs.statSync(full).mtimeMs}`
    }
  }
  walk(dir)
  return out
}
const MARKER_FILES = new Set(['umgezogen.json', 'UMGEZOGEN.txt'])
const withoutMarker = (print) => Object.fromEntries(Object.entries(print).filter(([name]) => !MARKER_FILES.has(name)))

const filesIn = (dir) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort()
  } catch {
    return []
  }
}

// ---------- Ein Lauf je Fassung ----------

async function runVersion(version, binary) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `mietfuchs-umzug-${version}-`))
  const home = path.join(work, 'home')
  const program = path.join(home, 'Downloads', `mietfuchs-${version}`)
  const oldData = path.join(program, 'data')
  fs.mkdirSync(oldData, { recursive: true })
  // Eine feste Verknüpfung statt einer Kopie, wo es geht: 50 bis 120 MB je Fassung, und die Suche sieht eine Datei
  try {
    fs.linkSync(binary, path.join(program, 'mietfuchs-linux'))
  } catch {
    fs.copyFileSync(binary, path.join(program, 'mietfuchs-linux'))
    fs.chmodSync(path.join(program, 'mietfuchs-linux'), 0o755)
  }
  const oldPort = await freePort()
  /** @type {any} */
  let old = null
  /** @type {any[]} */
  const running = []
  try {
    // 1. Bestand über die alte Fassung
    console.log(`\n▶ ${version}: Bestand anlegen`)
    laufend = { version, weg: 'Ordner', ok: true, befunde: [] }
    bericht.push(laufend)
    old = await startOld(path.join(program, 'mietfuchs-linux'), oldData, home, oldPort)
    running.push(old)
    // Bis 0.3 legte erst das erste Speichern die db.json an, und das Einspielen setzte sie voraus
    await send(old.base, '/api/settings', 'PUT', { landlordName: 'V. Vermieter' })
    const restored = await restore(old.base, stockZip())
    gleich(restored.status, 200, `${version}: Backup in der alten Fassung eingespielt`)
    const payment = await send(old.base, '/api/payments', 'POST', { tenancyId: 't2', date: '2024-04-03', amountCents: 50000 })
    wahr(payment.status === 200 || payment.status === 201, `${version}: eine Zahlung über die API der alten Fassung angelegt (${payment.status})`)
    const before = { settlement: settlementCore(await get(old.base, '/api/settlement/2024')), numbers: await numbersOf(old.base) }
    info(`${version}: ${JSON.stringify(before.numbers)}, Saldo ${before.settlement.statements?.map((s) => s.balanceCents).join(' / ')}`)
    wahr(before.settlement.statements?.length === 2, `${version}: die alte Fassung rechnet die Abrechnung 2024`)
    const backup = Buffer.from(await (await fetch(`${old.base}/api/backup`)).arrayBuffer())
    wahr(backup.length > 100, `${version}: Backup der alten Fassung geholt (${backup.length} Byte)`)
    // Wer /api/quit kennt (ab 0.7), bleibt offen: Das beendet der neue Bildschirm. Die anderen schließt der Nutzer.
    const knowsQuit = !/^0\.[0-6]\./.test(version)

    // Zum Vergleich: der Server von heute auf einer Kopie des alten Ordners, wie bei einem Update an Ort und Stelle
    const inPlace = path.join(work, 'an-ort-und-stelle')
    fs.cpSync(oldData, inPlace, { recursive: true })
    const today = await startNew(inPlace, home)
    running.push(today)
    const todaySettlement = settlementCore(await get(today.base, '/api/settlement/2024'))
    await stop(today)
    gleich(todaySettlement, before.settlement, `${version}: der Server von heute rechnet den alten Bestand wie die alte Fassung`)

    // 2. Der Umzug
    console.log(`▶ ${version}: Umzug ins Programmfenster`)
    const newData = path.join(work, 'neu')
    const desk = await startNew(newData, home, { NKA_RUNTIME: 'desktop', NKA_TEST_HOME: home, NKA_TEST_OLD_PORT: String(oldPort) })
    running.push(desk)
    gleich(await get(desk.base, '/api/relocation'), { offered: true }, `${version}: das Fenster bietet den Umzug an`)
    const offer = await get(desk.base, '/api/relocation/candidates')
    const found = offer.candidates?.find((c) => c.dataDir === oldData)
    wahr(found, `${version}: der Ordner neben der Programmdatei ist gefunden (Suche: ${offer.searched ? 'ja' : 'nein'})`)
    gleich(found?.tenancies, 2, `${version}: der Fund nennt zwei Mietverhältnisse`)
    gleich(found?.kind, version.startsWith('0.3.') || version.startsWith('0.7.') ? 'json' : 'database', `${version}: der Fund ist ${found?.kind}`)
    gleich(found?.running, true, `${version}: die alte Fassung läuft noch und ist erkannt`)
    const refused = await send(desk.base, '/api/relocation/adopt', 'POST', { dataDir: oldData })
    gleich(refused.status, 409, `${version}: solange sie läuft, wird nicht kopiert`)
    const quit = await send(desk.base, '/api/relocation/quit-old', 'POST')
    if (knowsQuit) {
      gleich(quit.body.stopped, true, `${version}: „Altes Mietfuchs beenden“ beendet sie`)
    } else {
      // Vor 0.7 kein Beenden von außen: Der Bildschirm bittet, das Fenster zu schließen; das tut hier die PID
      gleich(quit.body.stopped, false, `${version}: ohne /api/quit sagt der Bildschirm, dass sie selbst zu schließen ist`)
      await stop(old)
      const again = await get(desk.base, '/api/relocation/candidates')
      gleich(again.candidates?.find((c) => c.dataDir === oldData)?.running, false, `${version}: nach dem Schließen gilt sie als beendet`)
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
    const print = fingerprint(oldData)
    const adopted = await send(desk.base, '/api/relocation/adopt', 'POST', { dataDir: oldData })
    gleich(adopted.status, 200, `${version}: übernommen ${adopted.status === 200 ? JSON.stringify(adopted.body.counts) : JSON.stringify(adopted.body).slice(0, 400)}`)
    const moved = settlementCore(await get(desk.base, '/api/settlement/2024'))
    gleich(moved, before.settlement, `${version}: Abrechnung 2024 centgenau wie vorher in der alten Fassung`)
    gleich(moved, todaySettlement, `${version}: Abrechnung 2024 centgenau wie heute an Ort und Stelle`)
    gleich(await numbersOf(desk.base), before.numbers, `${version}: Wohnungen, Mietverhältnisse, Positionen, Zähler, Ablesungen, Zahlungen gleich`)
    gleich(filesIn(path.join(newData, 'uploads')), filesIn(path.join(oldData, 'uploads')), `${version}: alle Belege im neuen Ordner`)
    for (const [name, content] of [['abfall-2024.pdf', RECEIPT], ['zaehler-kueche.jpg', PHOTO]]) {
      const served = Buffer.from(await (await fetch(`${desk.base}/uploads/${name}`)).arrayBuffer())
      wahr(served.equals(/** @type {Buffer} */ (content)), `${version}: Beleg ${name} mit gleichem Inhalt`)
    }
    const marker = JSON.parse(fs.readFileSync(path.join(oldData, 'umgezogen.json'), 'utf8'))
    gleich(marker.movedTo, newData, `${version}: Vermerk im alten Ordner nennt den neuen Ort`)
    wahr(fs.existsSync(path.join(oldData, 'UMGEZOGEN.txt')), `${version}: UMGEZOGEN.txt liegt daneben`)
    gleich(withoutMarker(fingerprint(oldData)), print, `${version}: im alten Ordner ist sonst nichts verändert`)
    gleich(await get(desk.base, '/api/relocation'), { offered: false }, `${version}: danach kein zweites Angebot`)
    await stop(desk)

    // 3. Eine aktuelle Fassung im umgezogenen Ordner: nur lesend
    const readOnly = await startNew(oldData, home)
    running.push(readOnly)
    const health = await get(readOnly.base, '/healthz')
    gleich(health.moved?.movedTo, newData, `${version}: eine aktuelle Fassung im alten Ordner sagt, wohin die Daten umgezogen sind`)
    gleich((await send(readOnly.base, '/api/units', 'POST', { name: 'Neu', areaM2: 1, participates: true })).status, 423, `${version}: … und nimmt keine Änderung an`)
    gleich(settlementCore(await get(readOnly.base, '/api/settlement/2024')), before.settlement, `${version}: … zeigt die Daten aber an`)
    await stop(readOnly)

    // 3b. Die alte Fassung kennt den Vermerk nicht: Wer sie weiter startet, ändert dort noch etwas. Das neue Fenster
    // erkennt es und übernimmt den neueren Stand auf Wunsch noch einmal.
    const again = await startOld(path.join(program, 'mietfuchs-linux'), oldData, home, oldPort)
    running.push(again)
    const late = await send(again.base, '/api/payments', 'POST', { tenancyId: 't1', date: '2024-06-03', amountCents: 12345 })
    wahr(late.status === 200 || late.status === 201, `${version}: nach dem Umzug in der alten Fassung noch eine Zahlung angelegt`)
    await stop(again)
    const deskAgain = await startNew(newData, home, { NKA_RUNTIME: 'desktop', NKA_TEST_HOME: home, NKA_TEST_OLD_PORT: String(oldPort) })
    running.push(deskAgain)
    const told = await get(deskAgain.base, '/api/relocation')
    gleich(told.newer?.from, oldData, `${version}: das Fenster sagt, dass im alten Mietfuchs noch etwas geändert wurde`)
    gleich((await numbersOf(deskAgain.base)).payments, before.numbers.payments, `${version}: … und übernimmt es nicht von selbst`)
    const readopted = await send(deskAgain.base, '/api/relocation/readopt', 'POST')
    gleich(readopted.status, 200, `${version}: neueren Stand noch einmal übernommen`)
    gleich((await numbersOf(deskAgain.base)).payments, before.numbers.payments + 1, `${version}: die spätere Zahlung ist da`)
    wahr(fs.existsSync(path.join(newData, 'mietfuchs.sqlite.vor-restore')), `${version}: der Stand davor ist gesichert`)
    gleich(await get(deskAgain.base, '/api/relocation'), { offered: false }, `${version}: danach kein Hinweis mehr`)
    await stop(deskAgain)

    // 4. Derselbe Weg über das Backup der alten Fassung
    console.log(`▶ ${version}: Backup der alten Fassung im Fenster einspielen`)
    laufend = { version, weg: 'Backup', ok: true, befunde: [] }
    bericht.push(laufend)
    const viaBackup = await startNew(path.join(work, 'neu-backup'), path.join(work, 'leer'), { NKA_RUNTIME: 'desktop', NKA_TEST_HOME: path.join(work, 'leer') })
    running.push(viaBackup)
    gleich(await get(viaBackup.base, '/api/relocation'), { offered: true }, `${version}: ohne Fund bietet das Fenster den Bildschirm an`)
    gleich((await get(viaBackup.base, '/api/relocation/candidates')).candidates, [], `${version}: nichts gefunden, also der Weg über das Backup`)
    const fromBackup = await restore(viaBackup.base, backup)
    gleich(fromBackup.status, 200, `${version}: Backup im Fenster eingespielt`)
    gleich(settlementCore(await get(viaBackup.base, '/api/settlement/2024')), before.settlement, `${version}: Abrechnung 2024 centgenau wie vorher`)
    gleich(await numbersOf(viaBackup.base), before.numbers, `${version}: Zahlen gleich`)
    gleich(filesIn(path.join(work, 'neu-backup', 'uploads')), ['abfall-2024.pdf', 'zaehler-kueche.jpg'], `${version}: Belege aus dem Backup da`)
    gleich(await get(viaBackup.base, '/api/relocation'), { offered: false }, `${version}: danach kein Angebot mehr`)
    await stop(viaBackup)
  } catch (err) {
    fail(`${version}: abgebrochen: ${err instanceof Error ? err.stack ?? err.message : err}`)
  } finally {
    for (const proc of running) await stop(proc)
    laufend = null
    fs.rmSync(work, { recursive: true, force: true })
  }
}

// ---------- Ablauf ----------

if (process.platform !== 'linux') {
  console.error('Der Praxislauf braucht Linux: Er startet die alten Programmdateien für Linux x64.')
  process.exit(2)
}
for (const version of only ? [only] : VERSIONS) {
  let binary
  try {
    binary = await download(version)
  } catch (err) {
    laufend = { version, weg: 'Laden', ok: false, befunde: [] }
    bericht.push(laufend)
    fail(err instanceof Error ? err.message : String(err))
    laufend = null
    continue
  }
  await runVersion(version, binary)
}

console.log('\nErgebnis je Fassung:')
for (const r of bericht) console.log(`  ${r.ok ? '✓' : '✗'} ${r.version} über ${r.weg}${r.befunde.length ? `: ${r.befunde.length} Befund(e)` : ''}`)
if (OUT) {
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(path.join(OUT, 'fenster-umzug.json'), `${JSON.stringify(bericht, null, 2)}\n`)
  const lines = ['| Fassung | Weg | Ergebnis |', '|---|---|---|', ...bericht.map((r) => `| ${r.version} | ${r.weg} | ${r.ok ? 'grün' : `rot: ${r.befunde[0]?.split('\n')[0] ?? ''}`} |`)]
  fs.writeFileSync(path.join(OUT, 'fenster-umzug.md'), `${lines.join('\n')}\n`)
}
console.log(fehler === 0 ? '\nAlles hält.' : `\n${fehler} Befund(e).`)
process.exit(fehler === 0 ? 0 : 1)

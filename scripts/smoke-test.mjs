// Prüft eine laufende Mietfuchs-Instanz von außen: die fertige Programmdatei, das Docker-Image
// oder den Start aus dem Quellcode (#22). Die CI ruft es nach dem Bauen auf jedem System auf,
// lokal geht es genauso:
//
//   node scripts/smoke-test.mjs --url http://127.0.0.1:3001 --mode binary
//
// Die Instanz muss mit einem leeren Datenordner laufen (NKA_DATA_DIR), denn der Test legt Daten
// an und spielt ein Backup zurück. Ollama ersetzt ein nachgebauter Server, den das Skript selbst
// startet; Mietfuchs wird per Einstellungen dorthin gelenkt. Nichts geht ins Internet.
//
// Absichtlich ohne Abhängigkeiten: Es läuft mit dem Node, das auf dem Runner ohnehin da ist.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const argv = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : fallback
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASE = opt('url', 'http://127.0.0.1:3001').replace(/\/+$/, '')
const MODE = opt('mode', 'npm')
const VERSION = opt('version', JSON.parse(fs.readFileSync(path.join(root, 'server', 'package.json'), 'utf8')).version)
// Adresse, unter der die geprüfte Instanz das nachgebaute Ollama erreicht (bei Docker mit
// --network host ebenfalls 127.0.0.1)
const OLLAMA_HOST = opt('ollama-host', '127.0.0.1')
const TIMEOUT_SECONDS = Number(opt('timeout', '60'))
// Mit --slow-ai 320 schweigt das nachgebaute Ollama so lange, bevor es antwortet. So prüft die
// CI, dass eine Auswertung über fünf Minuten weder am Weg zu Ollama noch am Weg zum Browser
// abbricht (fetch unter Node und Bun, Firefox: jeweils 300 Sekunden ohne Antwort-Header).
const SLOW_AI_SECONDS = Number(opt('slow-ai', '0'))

let passed = 0
function ok(text) {
  passed++
  console.log(`  ✓ ${text}`)
}
function assert(condition, text, details) {
  if (!condition) throw new Error(`${text}${details === undefined ? '' : `\n    ${typeof details === 'string' ? details : JSON.stringify(details).slice(0, 400)}`}`)
  ok(text)
}

async function request(urlPath, init) {
  const res = await fetch(`${BASE}${urlPath}`, init)
  const type = res.headers.get('content-type') ?? ''
  const body = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer())
  return { status: res.status, type, body }
}
const json = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

// ---------- Nachgebautes Ollama ----------
// `delaySeconds` lässt /api/chat so lange schweigen, wie ein langsamer Rechner zum Einlesen braucht
// `closedEarly` zählt Chat-Anfragen, die Mietfuchs vor der Antwort abgebrochen hat.
function startFakeOllama() {
  const requests = []
  const control = { delaySeconds: 0, closedEarly: 0 }
  const server = http.createServer((req, res) => {
    res.on('close', () => { if (!res.writableFinished) control.closedEarly++ })
    let body = ''
    req.on('data', (d) => { body += d })
    req.on('end', () => {
      const send = (obj) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
      if (req.url === '/api/tags') return send({ models: [{ name: 'smoke:latest', size: 1000 }] })
      if (req.url === '/api/show') return send({ capabilities: ['completion', 'vision'] })
      const j = body ? JSON.parse(body) : {}
      requests.push(j) // nur Chat-Anfragen
      const props = j.format?.properties ?? {}
      const answer = props.categories
        ? { categories: Array(props.categories.minItems ?? 1).fill('Müllabfuhr') }
        : props.docType
          ? { docType: 'rechnung' }
          : { vendor: 'Prüflieferant', positions: [{ description: 'Restmüll', category: 'Müllabfuhr', amountEur: 42.5 }], totalGrossEur: 42.5 }
      // Wie Ollama: zeilenweise JSON, die letzte Zeile mit done und Grund. Die Header kommen wie
      // bei Ollama erst mit dem ersten Stück der Antwort.
      setTimeout(() => {
        if (res.destroyed) return
        res.writeHead(200, { 'content-type': 'application/x-ndjson' })
        res.write(`${JSON.stringify({ message: { role: 'assistant', content: JSON.stringify(answer) }, done: false })}\n`)
        res.end(`${JSON.stringify({ message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 100, eval_count: 20 })}\n`)
      }, props.categories ? 0 : control.delaySeconds * 1000)
    })
  })
  // Nur lokal erreichbar: Container laufen in der CI mit --network host und sehen 127.0.0.1 ebenso
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ port: server.address().port, requests, control, stop: () => server.close() }),
    ),
  )
}

const until = async (condition, ms) => {
  const end = Date.now() + ms
  while (!condition()) {
    if (Date.now() > end) return false
    await new Promise((r) => setTimeout(r, 100))
  }
  return true
}

// Wie der Browser: Auswertung als Strom (Accept: application/x-ndjson). Liefert, wann die Header
// kamen, alle Zeilen und die Gesamtdauer.
async function extractAsStream(longText, { fileName = 'strom.pdf', requestId, signal } = {}) {
  const fd = new FormData()
  fd.append('file', new Blob([Buffer.from('%PDF-1.4\n%Mietfuchs-Prüfung\n')], { type: 'application/pdf' }), fileName)
  fd.append('pdfText', longText)
  if (requestId) fd.append('requestId', requestId)
  const start = Date.now()
  const res = await fetch(`${BASE}/api/extract`, { method: 'POST', body: fd, headers: { accept: 'application/x-ndjson' }, signal })
  const headersAfterMs = Date.now() - start
  const lines = (await res.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l))
  return { status: res.status, type: res.headers.get('content-type') ?? '', headersAfterMs, lines, totalMs: Date.now() - start }
}

// Abbrechen wie im Browser: über die Kennung der Auswertung (POST /api/ai/cancel/<id>). Sie ist
// der verlässliche Weg, weil nicht jede Laufzeit das Schließen der Verbindung an Express meldet
// (Bun 1.3 tat es nicht, Bun 1.4.2 schon). Zum Vergleich schließt der Test danach nur die
// Verbindung und berichtet, ob der Server das bemerkt. Bemerkt er es nicht, ist das kein Fehler,
// weil der Browser immer auch die Kennung schickt.
async function cancelChecks(ollama, longText) {
  ollama.control.delaySeconds = 60
  try {
    let asked = ollama.requests.length
    let closed = ollama.control.closedEarly
    const requestId = crypto.randomUUID().replaceAll('-', '')
    const pending = extractAsStream(longText, { fileName: 'abbruch.pdf', requestId }).catch(() => null)
    assert(await until(() => ollama.requests.length > asked, 10000), 'Abbrechen: Auswertung läuft')
    const cancel = await request(`/api/ai/cancel/${requestId}`, { method: 'POST' })
    assert(cancel.status === 200 && (await until(() => ollama.control.closedEarly > closed, 10000)), 'Abbrechen per Kennung stoppt die Anfrage an Ollama', cancel.body)
    const uploads = (await request('/api/uploads')).body.map((u) => u.file)
    assert(!uploads.some((f) => f.endsWith('abbruch.pdf')), 'Abbrechen entfernt den gerade hochgeladenen Beleg', uploads)
    await pending

    asked = ollama.requests.length
    closed = ollama.control.closedEarly
    const controller = new AbortController()
    const dropped = extractAsStream(longText, { fileName: 'verbindung.pdf', signal: controller.signal }).catch(() => null)
    await until(() => ollama.requests.length > asked, 10000)
    controller.abort()
    await dropped
    const noticed = await until(() => ollama.control.closedEarly > closed, 5000)
    console.log(`  ℹ Nur Verbindung geschlossen: ${noticed ? 'Server bricht ab' : 'Server bemerkt es nicht, Abbruch läuft über die Kennung'}`)
  } finally {
    ollama.control.delaySeconds = 0
  }
}

// ---------- Ablauf ----------
async function waitForStart() {
  const deadline = Date.now() + TIMEOUT_SECONDS * 1000
  for (;;) {
    try {
      const r = await fetch(`${BASE}/healthz`)
      if (r.status === 200) return
    } catch {
      // läuft noch nicht
    }
    if (Date.now() > deadline) throw new Error(`Mietfuchs antwortet nach ${TIMEOUT_SECONDS} s nicht unter ${BASE}/healthz`)
    await new Promise((r) => setTimeout(r, 500))
  }
}

async function userInterface() {
  const index = await request('/')
  const html = index.body.toString('utf8')
  assert(index.status === 200 && html.includes('<div id="root">'), 'Oberfläche wird ausgeliefert', html.slice(0, 200))
  // Ein Lesezeichen oder Neuladen auf einer Unterseite muss ebenfalls die Oberfläche liefern
  const deepLink = await request('/abrechnung/2025')
  assert(deepLink.status === 200 && deepLink.body.toString('utf8').includes('<div id="root">'), 'Direktaufruf einer Unterseite liefert die Oberfläche', deepLink.status)
  // Alle Skripte der Seite und die daraus nachgeladenen Teile. Vite verweist innerhalb von
  // assets/ relativ („./pdf-….js“), den Worker aber mit vollem Pfad.
  const seen = new Set()
  const queue = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.m?js)"/g)].map((m) => m[1])
  let pdfjsFound = false
  while (queue.length) {
    const file = queue.shift()
    if (seen.has(file)) continue
    seen.add(file)
    const r = await request(`/${file}`)
    if (r.status !== 200) throw new Error(`Teil der Oberfläche fehlt: /${file} (HTTP ${r.status})`)
    const js = r.body.toString('utf8')
    if (js.includes('GlobalWorkerOptions')) pdfjsFound = true
    for (const m of js.matchAll(/assets\/[\w.-]+\.m?js/g)) queue.push(m[0])
    for (const m of js.matchAll(/["'`]\.\/([\w.-]+\.m?js)["'`]/g)) queue.push(`assets/${m[1]}`)
  }
  const worker = [...seen].some((d) => /pdf\.worker/.test(d))
  assert(worker && pdfjsFound, `${seen.size} Skriptdateien geladen, pdf.js und sein Worker sind dabei`, [...seen])
  const wasm = await request('/pdfjs/wasm/openjpeg.wasm')
  assert(wasm.status === 200 && wasm.body.subarray(0, 4).toString('hex') === '0061736d', 'pdf.js-Dekoder für Scans (WASM) wird ausgeliefert')
  const font = await request('/pdfjs/standard_fonts/FoxitDingbats.pfb')
  assert(font.status === 200 && font.body.length > 1000, 'pdf.js-Standardschriften werden ausgeliefert')
}

async function aiExtraction() {
  const ollama = await startFakeOllama()
  try {
    await request('/api/settings', json('PUT', { ollamaUrl: `http://${OLLAMA_HOST}:${ollama.port}`, ollamaModel: 'smoke:latest' }))
    const status = await request('/api/ollama/status')
    assert(status.body.ok === true && status.body.modelDetails?.[0]?.vision === true, 'Verbindung zum nachgebauten Ollama, Modell mit Bildverständnis', status.body)

    const pdf = new Blob([Buffer.from('%PDF-1.4\n%Mietfuchs-Prüfung\n')], { type: 'application/pdf' })
    const longText = 'Abfallgebührenbescheid 2025, Restmüll 120 Liter, 4-wöchentlich, Jahresgebühr 42,50 EUR. '.repeat(2)
    let fd = new FormData()
    fd.append('file', pdf, 'rechnung.pdf')
    fd.append('pdfText', longText)
    let r = await request('/api/extract', { method: 'POST', body: fd })
    let m = ollama.requests.at(-2)?.messages?.[0] // letzte Anfrage ist der Kategorien-Durchgang
    assert(r.status === 200 && r.body.extraction?.vendor === 'Prüflieferant', 'PDF mit Textebene wird ausgewertet', r.body)
    assert(m?.content?.includes('RECHNUNGSTEXT') && !m.images, 'Text geht an Ollama, ohne Bilder', m)

    fd = new FormData()
    fd.append('file', pdf, 'scan.pdf')
    fd.append('pages', new Blob([Buffer.from('JPEG-1')], { type: 'image/jpeg' }), 'seite-1.jpg')
    fd.append('pages', new Blob([Buffer.from('JPEG-2')], { type: 'image/jpeg' }), 'seite-2.jpg')
    r = await request('/api/extract', { method: 'POST', body: fd })
    m = ollama.requests.at(-2)?.messages?.[0]
    const expected = [Buffer.from('JPEG-1').toString('base64'), Buffer.from('JPEG-2').toString('base64')]
    assert(r.status === 200 && JSON.stringify(m?.images) === JSON.stringify(expected), 'Scan: Seitenbilder aus dem Browser gehen an Ollama', { status: r.status, body: r.body })

    fd = new FormData()
    fd.append('file', new Blob([Buffer.from('JPEG-Foto')], { type: 'image/jpeg' }), 'foto.jpg')
    r = await request('/api/intake', { method: 'POST', body: fd })
    assert(r.status === 200 && r.body.kind === 'rechnung', 'Handyfoto über den Schuhkarton (/api/intake)', r.body)

    let stream = await extractAsStream(longText)
    const last = stream.lines.at(-1)
    assert(stream.type.includes('application/x-ndjson') && last?.type === 'result' && last.data?.extraction?.vendor === 'Prüflieferant', 'Auswertung als Strom wie im Browser', last)
    if (SLOW_AI_SECONDS > 0) {
      console.log(`  … das nachgebaute Ollama schweigt jetzt ${SLOW_AI_SECONDS} Sekunden`)
      ollama.control.delaySeconds = SLOW_AI_SECONDS
      stream = await extractAsStream(longText)
      ollama.control.delaySeconds = 0
      assert(stream.headersAfterMs < 5000, `langsames Modell: Header kommen trotzdem sofort (nach ${stream.headersAfterMs} ms)`)
      assert(stream.lines.some((l) => l.type === 'heartbeat'), 'langsames Modell: Lebenszeichen während des Wartens', stream.lines.map((l) => l.type))
      const end = stream.lines.at(-1)
      assert(end?.type === 'result' && stream.totalMs >= SLOW_AI_SECONDS * 1000, `langsames Modell: Ergebnis nach ${Math.round(stream.totalMs / 1000)} Sekunden, kein Abbruch nach 300`, end)
    }
    await cancelChecks(ollama, longText)
  } finally {
    ollama.stop()
  }
}

async function uploadsAndSettlement() {
  const content = Buffer.from('%PDF-1.4\n%Beleg\n')
  const fd = new FormData()
  fd.append('file', new Blob([content], { type: 'application/pdf' }), 'Gebührenbescheid Müll.pdf')
  const up = await request('/api/upload', { method: 'POST', body: fd })
  assert(up.status === 200 && /Gebührenbescheid_Müll\.pdf$/.test(up.body.file), 'Beleg hochladen, Umlaute im Namen bleiben', up.body)
  const download = await request(`/uploads/${encodeURIComponent(up.body.file)}`)
  assert(download.status === 200 && Buffer.compare(download.body, content) === 0, 'Beleg ist unverändert abrufbar')

  const unit = (await request('/api/units', json('POST', { name: 'EG', areaM2: 80, participates: true }))).body
  await request('/api/tenancies', json('POST', {
    unitId: unit.id, tenantName: 'Prüfmieter', personHistory: [{ from: '2025-01-01', persons: 2 }],
    start: '2025-01-01', end: null, prepayments: [{ from: '2025-01', monthlyCents: 1000 }], prepaymentOverrides: {}, baseRents: [],
  }))
  await request('/api/costItems', json('POST', {
    year: 2025, category: 'Müllabfuhr', description: 'Restmüll', amountCents: 12000, key: 'area', invoiceFile: up.body.file,
  }))
  const settlement = (await request('/api/settlement/2025')).body
  const st = settlement.statements?.[0]
  // Eine vermietete Wohnung trägt die Kosten ganz, gezahlt sind 12 × 10 € Vorauszahlung
  assert(settlement.totalCostsCents === 12000 && st?.balanceCents === 0, 'Abrechnung rechnet (Kosten 120 €, Saldo 0 €)', { total: settlement.totalCostsCents, balance: st?.balanceCents })
  return unit
}

async function backupAndRestore(unit) {
  const backup = await request('/api/backup')
  assert(backup.status === 200 && backup.body.subarray(0, 2).toString() === 'PK', 'Backup als ZIP herunterladen')
  await request(`/api/units/${unit.id}`, { method: 'DELETE' })
  assert((await request('/api/units')).body.length === 0, 'Wohnung gelöscht, um die Wiederherstellung zu prüfen')
  const fd = new FormData()
  fd.append('file', new Blob([backup.body], { type: 'application/zip' }), 'backup.zip')
  const r = await request('/api/restore', { method: 'POST', body: fd })
  const units = (await request('/api/units')).body
  assert(r.status === 200 && units.length === 1 && units[0].id === unit.id, 'Backup wiederherstellen bringt die Daten zurück', r.body)
  const uploads = (await request('/api/uploads')).body.map((u) => u.file)
  assert(uploads.some((f) => /Gebührenbescheid_Müll\.pdf$/.test(f)), 'Belege sind nach der Wiederherstellung da', uploads)
}

async function main() {
  console.log(`Mietfuchs prüfen: ${BASE} (erwartet: Version ${VERSION}, Betriebsart ${MODE})`)
  await waitForStart()
  // Die Prüfung legt Daten an und rechnet mit festen Summen: Das geht nur mit leerem Datenordner.
  const existing = (await request('/api/units')).body
  if (Array.isArray(existing) && existing.length > 0) {
    throw new Error('Der Datenordner der geprüften Instanz ist nicht leer. Bitte mit einem leeren NKA_DATA_DIR starten.')
  }
  const health = await request('/healthz')
  assert(health.body.status === 'ok', 'Zustandsprüfung meldet ok', health.body)
  assert(health.body.version === VERSION, `Version ist ${VERSION}`, health.body.version)
  const update = await request('/api/update')
  assert(update.body.mode === MODE, `Betriebsart ist ${MODE}`, update.body)
  assert(update.body.enabled === false, 'ohne Zustimmung keine Update-Prüfung', update.body)
  await userInterface()
  await aiExtraction()
  const unit = await uploadsAndSettlement()
  await backupAndRestore(unit)
  console.log(`\nAlle ${passed} Prüfungen bestanden.`)
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}`)
  // Nicht sofort process.exit(): Unter Windows bricht Node sonst mit einer libuv-Assertion ab,
  // solange noch fetch-Verbindungen offen sind (Exit 127 statt 1). Der Zeitgeber hält den
  // Prozess nicht am Leben, beendet ihn aber, falls doch etwas hängen bleibt.
  process.exitCode = 1
  setTimeout(() => process.exit(1), 10000).unref()
})

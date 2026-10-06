// Prüft eine laufende Mietfuchs-Instanz von außen: die fertige Programmdatei, das Docker-Image
// oder den Start aus dem Quellcode (#22). Die CI ruft es nach dem Bauen auf jedem System auf,
// lokal geht es genauso:
//
//   node scripts/smoke-test.mjs --url http://127.0.0.1:3001 --mode binary
//
// `--mode` ist die erwartete Betriebsart: npm, binary, package (aus einem Linux-Paket, #25)
// oder docker. Der Test vergleicht sie mit dem, was die Instanz selbst meldet.
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
// Erwartet wird die Version aus server/package.json. Bei einem Tag-Lauf steht dort die aus dem
// Tag, etwa 0.9.0-rc.2: Jeder Prüfjob trägt sie vorher mit scripts/set-version.mjs ein, wie der
// Bau (#166). Ohne das schlüge jede Prüfung eines Release-Kandidaten fehl.
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
  // JSON oder Bytes, je nach Antwort. Was darin steht, prüfen die Zusicherungen und nicht der
  // Übersetzer, deshalb `any` statt des `unknown`, das `res.json()` liefert.
  /** @type {any} */
  const body = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer())
  return { status: res.status, type, body }
}
// Nach `listen` auf einem TCP-Port ist die Adresse immer ein AddressInfo; der Typ von `address()`
// kennt daneben noch die Zeichenkette einer Unix-Socket-Adresse und `null` vor dem Start.
const listeningPort = (server) => /** @type {import('node:net').AddressInfo} */ (server.address()).port
const json = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

// ---------- Nachgebautes Ollama ----------
// `delaySeconds` lässt /api/chat so lange schweigen, wie ein langsamer Rechner zum Einlesen braucht
// `closedEarly` zählt Chat-Anfragen, die Mietfuchs vor der Antwort abgebrochen hat.
function startFakeOllama() {
  const requests = []
  const pulled = [] // Anfragen zum Laden eines Modells (#33)
  const control = { delaySeconds: 0, closedEarly: 0 }
  const server = http.createServer((req, res) => {
    res.on('close', () => { if (!res.writableFinished) control.closedEarly++ })
    let body = ''
    req.on('data', (d) => { body += d })
    req.on('end', () => {
      const send = (obj) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
      if (req.url === '/api/tags') return send({ models: [{ name: 'smoke:latest', size: 1000 }] })
      if (req.url === '/api/show') return send({ capabilities: ['completion', 'vision'] })
      // Ein Modell laden (#33): zeilenweise Fortschritt, zuletzt „success“
      if (req.url === '/api/pull') {
        pulled.push(body ? JSON.parse(body) : {})
        res.writeHead(200, { 'content-type': 'application/x-ndjson' })
        res.write(`${JSON.stringify({ status: 'pulling manifest' })}\n`)
        res.write(`${JSON.stringify({ status: 'pulling 1a2b', total: 3_600_000_000, completed: 1_800_000_000 })}\n`)
        return res.end(`${JSON.stringify({ status: 'success' })}\n`)
      }
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
      resolve({ port: listeningPort(server), requests, pulled, control, stop: () => server.close() }),
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
/**
 * @param {string} longText
 * @param {{ fileName?: string, requestId?: string, signal?: AbortSignal }} [options]
 */
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
    await modelPull(ollama)
    await cancelChecks(ollama, longText)
  } finally {
    ollama.stop()
  }
}

// ---------- Nachgebauter OpenAI-kompatibler Dienst (#18) ----------
// Antwortet wie die Chat-Completions-Schnittstelle: /v1/models und /v1/chat/completions als
// SSE-Strom, und ohne gültigen Bearer-Schlüssel mit 401.
function startFakeOpenAi(key) {
  const requests = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (d) => { raw += d })
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {}
      requests.push({ url: req.url, body, headers: req.headers })
      const send = (status, data) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(data))
      }
      if (req.headers.authorization !== `Bearer ${key}`) return send(401, { error: { message: 'Incorrect API key provided' } })
      if (req.url === '/v1/models') return send(200, { object: 'list', data: [{ id: 'smoke-modell', object: 'model' }] })
      if (req.url !== '/v1/chat/completions') return send(404, { error: { message: 'Not found' } })
      // Den zweiten Durchgang (nur Kostenarten) erkennt man am Schema
      const answer = JSON.stringify(
        raw.includes('categories')
          ? { categories: ['Müllabfuhr'] }
          : { vendor: 'Prüfdienst', positions: [{ description: 'Restmüll 120 Liter', category: 'Müllabfuhr', amountEur: 42.5 }], totalGrossEur: 42.5 },
      )
      const event = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`)
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      event({ choices: [{ index: 0, delta: { role: 'assistant', content: answer }, finish_reason: null }] })
      event({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
      if (body.stream_options?.include_usage) event({ choices: [], usage: { prompt_tokens: 700, completion_tokens: 30 } })
      res.end('data: [DONE]\n\n')
    })
  })
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ port: listeningPort(server), requests, stop: () => server.close() })),
  )
}

// Der zweite Anbieter aus #18: Schlüssel, Modellliste und Auswertung über einen
// OpenAI-kompatiblen Dienst. Danach gilt wieder Ollama.
async function openAiExtraction() {
  const key = 'sk-smoke-1234567890'
  const service = await startFakeOpenAi(key)
  const before = (await request('/api/settings')).body.ai
  try {
    const url = `http://${OLLAMA_HOST}:${service.port}/v1`
    const slot = { provider: 'openai', preset: 'openai-compatible', url, model: 'smoke-modell', vision: null }
    let r = await request('/api/settings', json('PUT', { ai: { ...before, text: slot } }))
    assert(r.status === 200 && r.body.ai?.text?.url === url, 'OpenAI-kompatibler Dienst lässt sich einstellen', r.body?.ai?.text)

    const withoutKey = await request('/api/ai/status?slot=text')
    assert(withoutKey.body.ok === false && /Schlüssel/.test(withoutKey.body.error ?? ''), 'ohne Schlüssel eine klare Meldung', withoutKey.body)

    r = await request('/api/ai/key', json('PUT', { slot: 'text', key }))
    assert(r.status === 200 && r.body.text?.set === true && !JSON.stringify(r.body).includes(key), 'Schlüssel gespeichert, aber nie zurückgeliefert', r.body)
    const settings = await request('/api/settings')
    assert(!JSON.stringify(settings.body).includes(key), 'Schlüssel steht auch nicht in den Einstellungen')

    const status = await request('/api/ai/status?slot=text')
    assert(status.body.ok === true && status.body.models?.[0]?.name === 'smoke-modell', 'Modellliste des Dienstes', status.body)

    const fd = new FormData()
    fd.append('file', new Blob([Buffer.from('%PDF-1.4\n%Mietfuchs-Prüfung\n')], { type: 'application/pdf' }), 'openai.pdf')
    fd.append('pdfText', 'Abfallgebührenbescheid 2025, Restmüll 120 Liter, Jahresgebühr 42,50 EUR. '.repeat(2))
    r = await request('/api/extract', { method: 'POST', body: fd })
    assert(r.status === 200 && r.body.extraction?.vendor === 'Prüfdienst', 'Auswertung über den OpenAI-kompatiblen Dienst', r.body)

    const call = service.requests.find((x) => x.url === '/v1/chat/completions')
    const shape = {
      auth: call.headers.authorization === `Bearer ${key}`,
      contentLength: Boolean(call.headers['content-length']),
      chunked: call.headers['transfer-encoding'] === 'chunked',
      format: call.body.response_format?.type,
      tokens: call.body.max_tokens,
    }
    assert(shape.auth && shape.contentLength && !shape.chunked && shape.format === 'json_schema' && shape.tokens > 0,
      'Anfrage mit Bearer, Content-Length, JSON-Schema und Grenze für die Antwortlänge', shape)
  } finally {
    await request('/api/ai/key/text', { method: 'DELETE' })
    await request('/api/settings', json('PUT', { ai: before }))
    service.stop()
  }
}

// Empfehlungen und das Laden eines Modells (#33)
async function modelPull(ollama) {
  const empfehlungen = await request('/api/ai/recommendations')
  assert(empfehlungen.body.source === 'mitgeliefert' && empfehlungen.body.models?.length > 0,
    'Empfehlungen ohne Zustimmung aus der mitgelieferten Liste', empfehlungen.body)

  const res = await fetch(`${BASE}/api/ai/pull`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
    body: JSON.stringify({ model: 'smoke:latest' }),
  })
  const lines = (await res.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l))
  assert(res.status === 200 && lines.at(-1)?.type === 'result', 'Modell laden meldet Erfolg', lines.slice(-2))
  assert(lines.some((l) => l.type === 'progress' && l.total > 0), 'Fortschritt mit Größe kommt an', lines.filter((l) => l.type === 'progress').slice(0, 2))
  assert(ollama.pulled.some((p) => p.model === 'smoke:latest'), 'Ollama hat den Auftrag bekommen', ollama.pulled)
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

// Heizanlage (Heizung PR 4): anlegen; eine neue Heizposition gehört ihr von selbst, und die
// Abrechnung bleibt dieselbe.
async function heatingPlant() {
  const vorher = (await request('/api/settlement/2025')).body
  const angelegt = await request('/api/heating-plants', json('POST', { energy: 'gas', method: 'service', assignItemIds: [] }))
  assert(angelegt.status === 201 && angelegt.body.plant?.energy === 'gas', 'Heizanlage anlegen', angelegt.body)
  const posten = await request('/api/costItems', json('POST', {
    period: '2025-01', category: 'Heizung und Warmwasser', description: 'Messdienst', amountCents: 0, key: 'area',
  }))
  assert(posten.body.heatingPlantId === angelegt.body.plant.id, 'eine neue Heizposition gehört zur Anlage', posten.body)
  await request(`/api/costItems/${posten.body.id}`, { method: 'DELETE' })
  const nachher = (await request('/api/settlement/2025')).body
  assert(JSON.stringify(nachher.statements) === JSON.stringify(vorher.statements) && nachher.totalCostsCents === vorher.totalCostsCents,
    'die Abrechnung bleibt mit Heizanlage dieselbe', { vorher: vorher.totalCostsCents, nachher: nachher.totalCostsCents })
}

// CO₂ beim Messdienst (Heizung PR 6): ohne Angaben nennt die Abrechnung die Kürzung, mit Vorwegabzug
// bucht sie den CO₂-Anteil des Vermieters. Das Objekt der Prüfung rechnet im Kalenderjahr. Danach
// werden Angaben und Position wieder entfernt, damit die Prüfung der eigenen Heizperiode (PR 5)
// denselben Bestand vorfindet wie vorher.
async function co2Statement() {
  const [anlage] = (await request('/api/heating-plants')).body
  const [mieter] = (await request('/api/tenancies')).body
  const posten = await request('/api/costItems', json('POST', {
    period: '2025-01', category: 'Heizung und Warmwasser', description: 'Messdienst', amountCents: 100500, key: 'amounts', tenancyAmounts: { [mieter.id]: 100000 },
  }))
  assert(posten.body.heatingPlantId === anlage?.id, 'die Messdienstposition gehört zur Heizanlage', posten.body)
  const ohne = (await request('/api/settlement/2025')).body
  assert(ohne.notices?.some((n) => n.code === 'co2.missing'), 'ohne CO₂-Angaben nennt die Abrechnung die Kürzung', ohne.notices)
  const gespeichert = await request(`/api/heating-plants/${anlage.id}/periods/2025-01/co2`, json('PUT', {
    method: 'serviceDeducted', serviceUsersTotalCents: 100000, serviceLandlordCents: 500, serviceUnitsCount: 1,
  }))
  assert(gespeichert.status === 200 && gespeichert.body.method === 'serviceDeducted', 'CO₂-Angaben speichern', gespeichert.body)
  const mit = (await request('/api/settlement/2025')).body
  const anteil = mit.landlord?.rows?.find((r) => r.costItemId === posten.body.id)?.landlordParts?.find((p) => p.reason === 'co2Share')?.cents
  assert(anteil === 500 && mit.heating?.[0]?.co2?.booked === true, 'die Abrechnung bucht den CO₂-Anteil des Vermieters', { anteil, heating: mit.heating })
  const weg = await request(`/api/heating-plants/${anlage.id}/periods/2025-01/co2`, { method: 'DELETE' })
  assert(weg.status === 200 && weg.body.removed === true, 'CO₂-Angaben entfernen', weg.body)
  await request(`/api/costItems/${posten.body.id}`, { method: 'DELETE' })
}

// Vorrat (Heizung PR 8): Die Route gibt es, und bei einer Gasheizung lehnt sie mit einem Satz ab.
// Rechnen prüfen calc-vorrat.test.ts und api.test.ts; die Anlage der Prüfung heizt mit Gas.
async function stockRoute() {
  const [anlage] = (await request('/api/heating-plants')).body
  const antwort = await request(`/api/heating-plants/${anlage.id}/periods/2025-01/stock`, json('PUT', { stockUnit: 'l', closingQuantity: 100 }))
  assert(antwort.status === 400 && /Heizöl, Flüssiggas, Pellets, Holz und Kohle/.test(antwort.body?.error ?? ''), 'Vorrat nur bei Vorratsenergien', antwort.body)
}

// Lieferungen (Heizung PR 7): Die Gasrechnung des Jahres als Lieferung an der Heizanlage des
// Messdienstes; die Abrechnung bewertet sie (Abdeckung der Heizperiode). Das Objekt der Prüfung
// rechnet im Kalenderjahr.
async function fuelDelivery() {
  const [anlage] = (await request('/api/heating-plants')).body
  const angelegt = await request(`/api/heating-plants/${anlage.id}/deliveries`, json('POST', {
    label: 'Gas 2025', invoiceFrom: '2025-01-01', invoiceTo: '2025-12-31', amountCents: 311747, emissionsKg: 5406.17, co2CostCents: 60000,
  }))
  assert(angelegt.status === 201 && angelegt.body.usedByService === true, 'Lieferung anlegen', angelegt.body)
  const s = (await request('/api/settlement/2025')).body
  const fuel = s.heating?.[0]?.fuel
  assert(Math.abs((fuel?.coveragePermille ?? 0) - 1000) < 1e-6 && fuel.deliveries?.length === 1, 'die Abrechnung bewertet die Lieferung', s.heating)
  const orte = await request(`/api/properties/${anlage.propertyId}/degree-days`, json('PUT', { values: [{ month: '2025-01', value: 420 }] }))
  assert(orte.status === 200 && orte.body.length === 1, 'Gradtagzahlen des Orts speichern', orte.body)
}

// Nach der eigenen Heizperiode (Mai bis April): eine Angabe für die Heizperiode, die in 2025 endet,
// damit die Wiederherstellung sie mitprüfen kann.
async function co2ForBackup() {
  const [anlage] = (await request('/api/heating-plants')).body
  const [periode] = (await request(`/api/heating-plants/${anlage.id}/periods?period=2025`)).body
  const gespeichert = await request(`/api/heating-plants/${anlage.id}/periods/${periode?.period}/co2`, json('PUT', { method: 'selfAfterService' }))
  assert(gespeichert.status === 200 && gespeichert.body.method === 'selfAfterService', 'CO₂-Angaben der Heizperiode 2024/2025', gespeichert.body)
}

// Eigene Heizperiode und getrennte Heizkostenabrechnung (Heizung PR 5): Zeitraum der Heizung über die
// Vorschau, Weg d ab 05/2025 einschalten, Heizkostenabrechnung 2025/2026 mit eigener Frist lesen.
async function heatingPeriod() {
  const [anlage] = (await request('/api/heating-plants')).body
  // Jede Vorschau trägt eine Marke; der Wechsel schreibt nur mit ihr (wie beim Abrechnungszeitraum).
  const regeln = { rules: { startMonth: 5, changes: [] } }
  const zeitraum = await request(`/api/heating-plants/${anlage.id}/period/preview`, json('POST', regeln))
  assert(zeitraum.status === 200 && typeof zeitraum.body.token === 'string', 'Vorschau des Zeitraums der Heizung', zeitraum.body)
  const wechsel = await request(`/api/heating-plants/${anlage.id}/period`, json('PUT', { ...regeln, answers: { understood: true, token: zeitraum.body.token } }))
  assert(wechsel.status === 200 && wechsel.body.periodStartMonth === 5, 'Zeitraum der Heizung Mai bis April', wechsel.body)
  const vorschau = await request(`/api/heating-plants/${anlage.id}/separate/preview`, json('POST', { separate: true, month: '2025-05' }))
  assert(vorschau.status === 200 && vorschau.body.way === 'separate', 'Vorschau der getrennten Heizkostenabrechnung', vorschau.body)
  // Die Antworten aus der Vorschau: Heizanteil wie vorgeschlagen; jede Jahreskorrektur bleibt ganz bei
  // den übrigen Vorauszahlungen, die Heizkorrekturen 0 €.
  const steps = Object.fromEntries(vorschau.body.steps.map((s) => [s.tenancyId, Object.fromEntries(s.rows.map((r) => [r.from, r.heatingCents]))]))
  const totals = {}
  const overrides = {}
  for (const o of vorschau.body.overrides) {
    totals[o.tenancyId] = { ...(totals[o.tenancyId] ?? {}), [o.period]: o.cents ?? 0 }
    for (const a of o.asks) if (a.kind !== 'total') overrides[o.tenancyId] = { ...(overrides[o.tenancyId] ?? {}), [a.period]: 0 }
  }
  const ein = await request(`/api/heating-plants/${anlage.id}/separate`, json('PUT', { separate: true, month: '2025-05', answers: { understood: true, steps, totals, overrides, token: vorschau.body.token } }))
  assert(ein.status === 200 && ein.body.separateSpans?.length === 1, 'getrennte Heizkostenabrechnung eingeschaltet', ein.body)
  const heiz = await request(`/api/heating-settlement/${anlage.id}/2025-05`)
  assert(heiz.status === 200 && heiz.body.deadline === '2027-04-30' && heiz.body.scope?.kind === 'heating', 'Heizkostenabrechnung 2025/2026 mit eigener Frist', heiz.body)
}

async function backupAndRestore(unit) {
  const backup = await request('/api/backup')
  assert(backup.status === 200 && backup.body.subarray(0, 2).toString() === 'PK', 'Backup als ZIP herunterladen')
  // Die Datenbank gehört ins Archiv (#55, Aufgabe 7a). Der Name steht im ZIP im Klartext, ein
  // Auspacken braucht es dafür nicht. Geprüft wird das gerade hier und nicht nur in den Tests:
  // Der Schnappschuss entsteht mit `VACUUM INTO`, und ob das trägt, hängt am eingebauten SQLite
  // der jeweiligen Laufzeit. In der Programmdatei ist das `bun:sqlite`, und die läuft nur hier.
  assert(backup.body.includes('mietfuchs.sqlite'), 'Das Backup enthält die Datenbank')
  await request(`/api/units/${unit.id}`, { method: 'DELETE' })
  assert((await request('/api/units')).body.length === 0, 'Wohnung gelöscht, um die Wiederherstellung zu prüfen')
  const fd = new FormData()
  fd.append('file', new Blob([backup.body], { type: 'application/zip' }), 'backup.zip')
  const r = await request('/api/restore', { method: 'POST', body: fd })
  const units = (await request('/api/units')).body
  assert(r.status === 200 && units.length === 1 && units[0].id === unit.id, 'Backup wiederherstellen bringt die Daten zurück', r.body)
  const anlagen = (await request('/api/heating-plants')).body
  assert(Array.isArray(anlagen) && anlagen.length === 1, 'die Heizanlage ist nach der Wiederherstellung da', anlagen)
  assert(anlagen[0]?.periodStartMonth === 5 && anlagen[0]?.separateSpans?.length === 1, 'Heizperiode und getrennte Abrechnung sind nach der Wiederherstellung da', anlagen)
  const perioden = (await request(`/api/heating-plants/${anlagen[0].id}/periods?period=2025`)).body
  assert(perioden?.[0]?.co2?.method === 'selfAfterService', 'die CO₂-Angaben sind nach der Wiederherstellung da', perioden)
  const lieferungen = (await request(`/api/heating-plants/${anlagen[0].id}/deliveries`)).body
  assert(lieferungen?.[0]?.label === 'Gas 2025', 'die Lieferung ist nach der Wiederherstellung da', lieferungen)
  const uploads = (await request('/api/uploads')).body.map((u) => u.file)
  assert(uploads.some((f) => /Gebührenbescheid_Müll\.pdf$/.test(f)), 'Belege sind nach der Wiederherstellung da', uploads)
  // Das Wiederherstellen schließt die Datenbank, tauscht die Datei und öffnet sie neu. Ob das
  // gelingt, hängt am Betriebssystem: Unter Windows lässt sich eine offene Datei nicht ersetzen.
  const health = (await request('/healthz')).body
  assert(health?.database?.open === true, 'Die Datenbank ist nach dem Wiederherstellen wieder offen', health?.database)
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
  // Die Datenbank (#55). Sie wird beim Start geöffnet, obwohl noch keine fachlichen Daten darin
  // liegen, und genau deshalb steht sie hier: Diese Prüfung läuft auf jeder Programmdatei und in
  // den Containern von 22 Distributionen. Ob das eingebaute SQLite dort trägt, ob Bun es in die
  // Programmdatei gebündelt hat und ob die Migrationen ankommen, zeigt sich erst auf einem
  // echten System. Der Datenordner ist leer (siehe oben), die Datei also frisch angelegt und
  // die Zahl der Migrationen die volle.
  assert(health.body.database?.open === true, 'Datenbank ist geöffnet', health.body.database)
  assert(health.body.database.migrations >= 1, 'Migrationen sind angewendet', health.body.database)
  // Eine frisch angelegte Datenbank bekommt keine Sicherung vor den Migrationen, und die
  // Oberfläche darf dann auch keine nennen (#154).
  assert(health.body.database.migrated === null, 'keine Sicherung genannt (frische Datenbank)', health.body.database.migrated)
  // Der Umstieg der vorhandenen Daten (#55) läuft bei jedem Start. Der Datenordner ist leer,
  // es gibt also keine db.json und nichts zu übernehmen — und genau das muss dastehen. Ein
  // „failed“ hier hieße, dass der Umstieg auf diesem System schon am leeren Ordner scheitert.
  // Den gelungenen Umstieg prüft diese Datei nicht: Dafür müsste die Instanz mit einer
  // vorhandenen db.json neu starten, und gestartet wird sie außerhalb (siehe Bericht zu #55).
  assert(health.body.database.changeover?.state === 'none', 'kein Umstieg nötig (leerer Datenordner)', health.body.database.changeover)
  const update = await request('/api/update')
  assert(update.body.mode === MODE, `Betriebsart ist ${MODE}`, update.body)
  assert(update.body.enabled === false, 'ohne Zustimmung keine Update-Prüfung', update.body)
  await userInterface()
  await aiExtraction()
  await openAiExtraction()
  const unit = await uploadsAndSettlement()
  await heatingPlant()
  await co2Statement()
  await stockRoute()
  await fuelDelivery()
  await heatingPeriod()
  await co2ForBackup()
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

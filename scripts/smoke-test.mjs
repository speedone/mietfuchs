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
const WARTEN_SEK = Number(opt('timeout', '60'))

let schritte = 0
function ok(text) {
  schritte++
  console.log(`  ✓ ${text}`)
}
function pruefe(bedingung, text, details) {
  if (!bedingung) throw new Error(`${text}${details === undefined ? '' : `\n    ${typeof details === 'string' ? details : JSON.stringify(details).slice(0, 400)}`}`)
  ok(text)
}

async function holen(pfad, init) {
  const res = await fetch(`${BASE}${pfad}`, init)
  const typ = res.headers.get('content-type') ?? ''
  const body = typ.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer())
  return { status: res.status, typ, body }
}
const json = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

// ---------- Nachgebautes Ollama ----------
function starteOllama() {
  const anfragen = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (d) => { body += d })
    req.on('end', () => {
      const send = (obj) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
      if (req.url === '/api/tags') return send({ models: [{ name: 'smoke:latest' }] })
      const j = body ? JSON.parse(body) : {}
      anfragen.push(j)
      const props = j.format?.properties ?? {}
      if (props.categories) return send({ message: { content: JSON.stringify({ categories: Array(props.categories.minItems ?? 1).fill('Müllabfuhr') }) } })
      if (props.docType) return send({ message: { content: JSON.stringify({ docType: 'rechnung' }) } })
      send({ message: { content: JSON.stringify({ vendor: 'Prüflieferant', positions: [{ description: 'Restmüll', category: 'Müllabfuhr', amountEur: 42.5 }], totalGrossEur: 42.5 }) } })
    })
  })
  // Nur lokal erreichbar: Container laufen in der CI mit --network host und sehen 127.0.0.1 ebenso
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, anfragen, stop: () => server.close() })))
}

// ---------- Ablauf ----------
async function warteAufStart() {
  const bis = Date.now() + WARTEN_SEK * 1000
  for (;;) {
    try {
      const r = await fetch(`${BASE}/healthz`)
      if (r.status === 200) return
    } catch {
      // läuft noch nicht
    }
    if (Date.now() > bis) throw new Error(`Mietfuchs antwortet nach ${WARTEN_SEK} s nicht unter ${BASE}/healthz`)
    await new Promise((r) => setTimeout(r, 500))
  }
}

async function oberflaeche() {
  const index = await holen('/')
  const html = index.body.toString('utf8')
  pruefe(index.status === 200 && html.includes('<div id="root">'), 'Oberfläche wird ausgeliefert', html.slice(0, 200))
  // Alle Skripte der Seite und die daraus nachgeladenen Teile. Vite verweist innerhalb von
  // assets/ relativ („./pdf-….js“), den Worker aber mit vollem Pfad.
  const gesehen = new Set()
  const offen = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.m?js)"/g)].map((m) => m[1])
  let pdfjsGefunden = false
  while (offen.length) {
    const datei = offen.shift()
    if (gesehen.has(datei)) continue
    gesehen.add(datei)
    const r = await holen(`/${datei}`)
    if (r.status !== 200) throw new Error(`Teil der Oberfläche fehlt: /${datei} (HTTP ${r.status})`)
    const js = r.body.toString('utf8')
    if (js.includes('GlobalWorkerOptions')) pdfjsGefunden = true
    for (const m of js.matchAll(/assets\/[\w.-]+\.m?js/g)) offen.push(m[0])
    for (const m of js.matchAll(/["'`]\.\/([\w.-]+\.m?js)["'`]/g)) offen.push(`assets/${m[1]}`)
  }
  const worker = [...gesehen].some((d) => /pdf\.worker/.test(d))
  pruefe(worker && pdfjsGefunden, `${gesehen.size} Skriptdateien geladen, pdf.js und sein Worker sind dabei`, [...gesehen])
  const wasm = await holen('/pdfjs/wasm/openjpeg.wasm')
  pruefe(wasm.status === 200 && wasm.body.subarray(0, 4).toString('hex') === '0061736d', 'pdf.js-Dekoder für Scans (WASM) wird ausgeliefert')
  const schrift = await holen('/pdfjs/standard_fonts/FoxitDingbats.pfb')
  pruefe(schrift.status === 200 && schrift.body.length > 1000, 'pdf.js-Standardschriften werden ausgeliefert')
}

async function kiAuswertung() {
  const ollama = await starteOllama()
  try {
    await holen('/api/settings', json('PUT', { ollamaUrl: `http://${OLLAMA_HOST}:${ollama.port}`, ollamaModel: 'smoke:latest' }))
    const status = await holen('/api/ollama/status')
    pruefe(status.body.ok === true, 'Verbindung zum nachgebauten Ollama', status.body)

    const pdf = new Blob([Buffer.from('%PDF-1.4\n%Mietfuchs-Prüfung\n')], { type: 'application/pdf' })
    const langerText = 'Abfallgebührenbescheid 2025, Restmüll 120 Liter, 4-wöchentlich, Jahresgebühr 42,50 EUR. '.repeat(2)
    let fd = new FormData()
    fd.append('file', pdf, 'rechnung.pdf')
    fd.append('pdfText', langerText)
    let r = await holen('/api/extract', { method: 'POST', body: fd })
    let m = ollama.anfragen.at(-2)?.messages?.[0] // letzte Anfrage ist der Kategorien-Durchgang
    pruefe(r.status === 200 && r.body.extraction?.vendor === 'Prüflieferant', 'PDF mit Textebene wird ausgewertet', r.body)
    pruefe(m?.content?.includes('RECHNUNGSTEXT') && !m.images, 'Text geht an Ollama, ohne Bilder', m)

    fd = new FormData()
    fd.append('file', pdf, 'scan.pdf')
    fd.append('pages', new Blob([Buffer.from('JPEG-1')], { type: 'image/jpeg' }), 'seite-1.jpg')
    fd.append('pages', new Blob([Buffer.from('JPEG-2')], { type: 'image/jpeg' }), 'seite-2.jpg')
    r = await holen('/api/extract', { method: 'POST', body: fd })
    m = ollama.anfragen.at(-2)?.messages?.[0]
    const erwartet = [Buffer.from('JPEG-1').toString('base64'), Buffer.from('JPEG-2').toString('base64')]
    pruefe(r.status === 200 && JSON.stringify(m?.images) === JSON.stringify(erwartet), 'Scan: Seitenbilder aus dem Browser gehen an Ollama', { status: r.status, body: r.body })

    fd = new FormData()
    fd.append('file', new Blob([Buffer.from('JPEG-Foto')], { type: 'image/jpeg' }), 'foto.jpg')
    r = await holen('/api/intake', { method: 'POST', body: fd })
    pruefe(r.status === 200 && r.body.kind === 'rechnung', 'Handyfoto über den Schuhkarton (/api/intake)', r.body)
  } finally {
    ollama.stop()
  }
}

async function belegeUndAbrechnung() {
  const inhalt = Buffer.from('%PDF-1.4\n%Beleg\n')
  const fd = new FormData()
  fd.append('file', new Blob([inhalt], { type: 'application/pdf' }), 'Gebührenbescheid Müll.pdf')
  const up = await holen('/api/upload', { method: 'POST', body: fd })
  pruefe(up.status === 200 && /Gebührenbescheid_Müll\.pdf$/.test(up.body.file), 'Beleg hochladen, Umlaute im Namen bleiben', up.body)
  const abruf = await holen(`/uploads/${encodeURIComponent(up.body.file)}`)
  pruefe(abruf.status === 200 && Buffer.compare(abruf.body, inhalt) === 0, 'Beleg ist unverändert abrufbar')

  const unit = (await holen('/api/units', json('POST', { name: 'EG', areaM2: 80, participates: true }))).body
  await holen('/api/tenancies', json('POST', {
    unitId: unit.id, tenantName: 'Prüfmieter', personHistory: [{ from: '2025-01-01', persons: 2 }],
    start: '2025-01-01', end: null, prepayments: [{ from: '2025-01', monthlyCents: 1000 }], prepaymentOverrides: {}, baseRents: [],
  }))
  await holen('/api/costItems', json('POST', {
    year: 2025, category: 'Müllabfuhr', description: 'Restmüll', amountCents: 12000, key: 'area', invoiceFile: up.body.file,
  }))
  const abrechnung = (await holen('/api/settlement/2025')).body
  const st = abrechnung.statements?.[0]
  // Eine vermietete Wohnung trägt die Kosten ganz, gezahlt sind 12 × 10 € Vorauszahlung
  pruefe(abrechnung.totalCostsCents === 12000 && st?.balanceCents === 0, 'Abrechnung rechnet (Kosten 120 €, Saldo 0 €)', { total: abrechnung.totalCostsCents, balance: st?.balanceCents })
  return unit
}

async function backupUndWiederherstellung(unit) {
  const backup = await holen('/api/backup')
  pruefe(backup.status === 200 && backup.body.subarray(0, 2).toString() === 'PK', 'Backup als ZIP herunterladen')
  await holen(`/api/units/${unit.id}`, { method: 'DELETE' })
  pruefe((await holen('/api/units')).body.length === 0, 'Wohnung gelöscht, um die Wiederherstellung zu prüfen')
  const fd = new FormData()
  fd.append('file', new Blob([backup.body], { type: 'application/zip' }), 'backup.zip')
  const r = await holen('/api/restore', { method: 'POST', body: fd })
  const units = (await holen('/api/units')).body
  pruefe(r.status === 200 && units.length === 1 && units[0].id === unit.id, 'Backup wiederherstellen bringt die Daten zurück', r.body)
  const uploads = (await holen('/api/uploads')).body.map((u) => u.file)
  pruefe(uploads.some((f) => /Gebührenbescheid_Müll\.pdf$/.test(f)), 'Belege sind nach der Wiederherstellung da', uploads)
}

async function main() {
  console.log(`Mietfuchs prüfen: ${BASE} (erwartet: Version ${VERSION}, Betriebsart ${MODE})`)
  await warteAufStart()
  // Die Prüfung legt Daten an und rechnet mit festen Summen: Das geht nur mit leerem Datenordner.
  const vorhanden = (await holen('/api/units')).body
  if (Array.isArray(vorhanden) && vorhanden.length > 0) {
    throw new Error('Der Datenordner der geprüften Instanz ist nicht leer. Bitte mit einem leeren NKA_DATA_DIR starten.')
  }
  const health = await holen('/healthz')
  pruefe(health.body.status === 'ok', 'Zustandsprüfung meldet ok', health.body)
  pruefe(health.body.version === VERSION, `Version ist ${VERSION}`, health.body.version)
  const update = await holen('/api/update')
  pruefe(update.body.mode === MODE, `Betriebsart ist ${MODE}`, update.body)
  pruefe(update.body.enabled === false, 'ohne Zustimmung keine Update-Prüfung', update.body)
  await oberflaeche()
  await kiAuswertung()
  const unit = await belegeUndAbrechnung()
  await backupUndWiederherstellung(unit)
  console.log(`\nAlle ${schritte} Prüfungen bestanden.`)
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}`)
  // Nicht sofort process.exit(): Unter Windows bricht Node sonst mit einer libuv-Assertion ab,
  // solange noch fetch-Verbindungen offen sind (Exit 127 statt 1). Der Zeitgeber hält den
  // Prozess nicht am Leben, beendet ihn aber, falls doch etwas hängen bleibt.
  process.exitCode = 1
  setTimeout(() => process.exit(1), 10000).unref()
})

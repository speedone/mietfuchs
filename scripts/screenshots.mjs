// Die Bildschirmfotos für das README (docs/screenshots/), reproduzierbar und zu jedem Release neu
// auszuführen:
//
//   npx playwright install chromium   # einmalig, lädt den Browser für Playwright
//   npm run screenshots               # baut die Oberfläche, startet einen Server, fotografiert
//   npm run screenshots -- --skip-build   # ohne den Bau, wenn client/dist schon aktuell ist
//
// Das Skript startet einen eigenen Server aus dem Repo wie `npm start`, mit den drei Angaben, die
// zu jedem Prüfstart gehören (CLAUDE.md): einem Wegwerf-Datenordner, `CI=1` und einer
// Update-Adresse auf einem geschlossenen Port. Die KI beantwortet das nachgebaute Ollama aus
// fake-ollama.mjs, damit „Auswertung prüfen“ gezeigt werden kann; nichts geht ins Internet.
//
// **Alle Daten sind erfunden**: Objekte, Namen, Adressen, Beträge und Belege. Die Bankverbindung ist
// absichtlich keine gültige IBAN (Prüfziffer 00). Das Abrechnungsjahr ist das Vorjahr, wie es die
// Oberfläche voreinstellt; zu einem späteren Release entstehen dieselben Bilder ein Jahr weiter.
import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { INVOICES, startFakeOllama } from './fake-ollama.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : fallback
}
const OUT = path.resolve(root, opt('out', 'docs/screenshots'))
const SKIP_BUILD = argv.includes('--skip-build')
// Feste Größe, damit die Bilder von Release zu Release vergleichbar bleiben
const VIEWPORT = { width: 1440, height: 900 }
const SCALE = Number(opt('scale', '1'))

// Dasselbe Jahr wie das nachgebaute Ollama und die Voreinstellung der Oberfläche (client/src/year.tsx)
const YEAR = new Date().getFullYear() - 1
const PREV = YEAR - 1

// ---------- Playwright ----------
// Als devDependency im Wurzelpaket; der Browser selbst kommt mit `npx playwright install chromium`.
async function loadPlaywright() {
  try {
    return await import('playwright')
  } catch {
    throw new Error('Playwright fehlt. Bitte im Repo `npm install` und danach `npx playwright install chromium` ausführen.')
  }
}

// ---------- Server ----------
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer()
  s.once('error', reject)
  s.listen(0, '127.0.0.1', () => {
    const port = /** @type {net.AddressInfo} */ (s.address()).port
    s.close(() => resolve(port))
  })
})

async function startServer(dataDir, ollamaUrl) {
  const port = await freePort()
  const child = spawn(process.execPath, ['src/index.ts'], {
    cwd: path.join(root, 'server'),
    env: {
      ...process.env,
      NKA_DATA_DIR: dataDir,
      NKA_PORT: String(port),
      NKA_OLLAMA_URL: ollamaUrl,
      NKA_OLLAMA_MODEL: 'qwen3.5:4b',
      // Nach dem `...env` des Aufrufers, damit nichts davon überschrieben wird (CLAUDE.md)
      CI: '1',
      NKA_UPDATE_URL: 'http://127.0.0.1:9/',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  child.stdout.on('data', (d) => { log += d })
  child.stderr.on('data', (d) => { log += d })
  const base = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 30000
  for (;;) {
    if (child.exitCode !== null) throw new Error(`Der Server ist beim Start beendet worden:\n${log}`)
    try {
      if ((await fetch(`${base}/healthz`)).ok) break
    } catch {
      // startet noch
    }
    if (Date.now() > deadline) throw new Error(`Der Server antwortet nicht:\n${log}`)
    await new Promise((r) => setTimeout(r, 200))
  }
  const stop = () => new Promise((resolve) => {
    if (child.exitCode !== null) return resolve(undefined)
    child.once('exit', () => resolve(undefined))
    child.kill()
  })
  return { base, stop }
}

// ---------- API ----------
function client(base) {
  /** @returns {Promise<any>} */
  async function call(method, urlPath, body) {
    const init = body instanceof FormData
      ? { method, body }
      : { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }
    const res = await fetch(`${base}${urlPath}`, init)
    const text = await res.text()
    if (!res.ok) throw new Error(`${method} ${urlPath}: HTTP ${res.status} ${text.slice(0, 300)}`)
    return text ? JSON.parse(text) : null
  }
  return {
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b),
    put: (p, b) => call('PUT', p, b),
  }
}

// ---------- Erfundene Belege ----------
// Ein schlichter Rechnungsbogen, als PDF gedruckt vom selben Browser, der danach fotografiert.
const eur = (n) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const deDate = (iso) => iso.split('-').reverse().join('.')

function invoiceHtml({ vendor, vendorAddress, title, date, recipient, lines, total, note }) {
  const rows = lines.map((l, i) => `<tr><td>${i + 1}</td><td>${l.text}</td><td class="r">${eur(l.amount)} €</td></tr>`).join('')
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
    body { font: 11pt/1.45 Helvetica, Arial, sans-serif; color: #1f2937; margin: 18mm 20mm; }
    .sender { font-size: 8pt; color: #6b7280; border-bottom: 1px solid #d1d5db; padding-bottom: 2mm; }
    .logo { float: right; text-align: right; font-weight: 700; font-size: 15pt; color: #0f766e; }
    .logo small { display: block; font-weight: 400; font-size: 8.5pt; color: #6b7280; }
    .address { margin: 8mm 0 12mm; }
    h1 { font-size: 16pt; margin: 0 0 4mm; clear: both; }
    table { width: 100%; border-collapse: collapse; margin-top: 6mm; }
    th, td { text-align: left; padding: 2mm 1mm; border-bottom: 1px solid #e5e7eb; }
    th { font-size: 9pt; color: #6b7280; } .r { text-align: right; }
    tr.sum td { font-weight: 700; border-top: 2px solid #1f2937; border-bottom: none; }
    .note { margin-top: 10mm; font-size: 9.5pt; color: #374151; }
  </style></head><body>
    <div class="logo">${vendor}<small>${vendorAddress}</small></div>
    <div class="sender">${vendor} · ${vendorAddress}</div>
    <div class="address">${recipient.join('<br>')}</div>
    <h1>${title}</h1>
    <div>Datum: ${deDate(date)} · Objekt: Lindenweg 12, 12345 Musterstadt</div>
    <table><tr><th>Pos.</th><th>Leistung</th><th class="r">Betrag</th></tr>${rows}
      <tr class="sum"><td></td><td>Rechnungsbetrag</td><td class="r">${eur(total)} €</td></tr></table>
    ${note ? `<div class="note">${note}</div>` : ''}
    <div class="note">Erfundener Beispielbeleg für die Bildschirmfotos von Mietfuchs.</div>
  </body></html>`
}

const RECIPIENT = ['Herrn', 'Klaus Wegener', 'Lindenweg 12', '12345 Musterstadt']

// ---------- Der Beispielbestand ----------
async function seed(api, pdf) {
  await api.put('/api/settings', {
    landlordName: 'Klaus Wegener',
    // Erfunden und absichtlich ungültig (Prüfziffer 00), damit sie niemand für echt hält
    iban: 'DE00 1234 5678 9012 3456 78',
    paymentDeadlineDays: 30,
    updateCheck: 'off',
  })

  // Objekt 1: Mehrfamilienhaus mit Einliegerwohnung des Vermieters und Garage
  const [first] = await api.get('/api/properties')
  const haus = await api.put(`/api/properties/${first.id}`, {
    name: 'Lindenweg 12', kind: 'mfh', address: 'Lindenweg 12, 12345 Musterstadt', cableBuiltBeforeDec2021: true,
  })
  const P = haus.id
  const q = (p) => `?property=${p}`
  const unit = (body) => api.post(`/api/units${q(P)}`, { participates: true, ...body })
  const egL = await unit({ name: 'EG links', areaM2: 72, rooms: 3, floor: 'EG' })
  const egR = await unit({ name: 'EG rechts', areaM2: 58, rooms: 2, floor: 'EG' })
  const og = await unit({ name: 'OG', areaM2: 95, rooms: 4, floor: '1. OG' })
  const dg = await unit({ name: 'DG (Eigennutzung)', areaM2: 45, rooms: 2, floor: 'DG', participates: false, selfUsed: true, selfPersons: 2 })
  const garage = await unit({ name: 'Garage 1', areaM2: 0, noConnection: ['kaltwasser', 'waerme'] })

  const tenancy = (body) => api.post(`/api/tenancies${q(P)}`, { prepaymentOverrides: {}, end: null, ...body })
  const becker = await tenancy({
    unitId: egL.id, tenantName: 'Anna Becker', start: '2019-04-01', personHistory: [{ from: '2019-04-01', persons: 2 }],
    prepayments: [{ from: '2019-04', monthlyCents: 24000 }, { from: `${YEAR}-01`, monthlyCents: 28000 }],
    baseRents: [{ from: '2019-04', monthlyCents: 62000 }, { from: `${PREV}-07`, monthlyCents: 65000 }],
    email: 'anna.becker@example.org', depositCents: 186000, depositStatus: 'erhalten',
  })
  const hartmann = await tenancy({
    unitId: egR.id, tenantName: 'Jonas Hartmann', start: '2021-09-01', end: `${YEAR}-06-30`,
    personHistory: [{ from: '2021-09-01', persons: 1 }],
    prepayments: [{ from: '2021-09', monthlyCents: 22000 }], baseRents: [{ from: '2021-09', monthlyCents: 52000 }],
  })
  const schneider = await tenancy({
    unitId: egR.id, tenantName: 'Lea Schneider', start: `${YEAR}-08-01`,
    personHistory: [{ from: `${YEAR}-08-01`, persons: 2 }],
    prepayments: [{ from: `${YEAR}-08`, monthlyCents: 23000 }], baseRents: [{ from: `${YEAR}-08`, monthlyCents: 56000 }],
  })
  const yilmaz = await tenancy({
    unitId: og.id, tenantName: 'Familie Yilmaz', start: '2016-02-01',
    personHistory: [{ from: '2016-02-01', persons: 3 }, { from: `${YEAR}-03-15`, persons: 4 }],
    prepayments: [{ from: '2016-02', monthlyCents: 39000 }], baseRents: [{ from: '2016-02', monthlyCents: 89000 }],
  })
  const klein = await tenancy({
    unitId: garage.id, tenantName: 'Markus Klein', start: '2022-01-01', personHistory: [{ from: '2022-01-01', persons: 0 }],
    prepayments: [], baseRents: [{ from: '2022-01', monthlyCents: 6000 }], costModel: 'inclusive', heatingModel: 'inclusive',
  })

  // Zahlungen: alle pünktlich, nur Familie Yilmaz hat im November zu wenig überwiesen
  const pay = async (t, months, cents, short = {}) => {
    for (const m of months) {
      const amount = short[m] ?? cents
      if (amount > 0) await api.post(`/api/payments${q(P)}`, { tenancyId: t.id, date: `${YEAR}-${String(m).padStart(2, '0')}-03`, amountCents: amount })
    }
  }
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
  await pay(becker, range(1, 12), 93000)
  await pay(hartmann, range(1, 6), 74000)
  await pay(schneider, range(8, 12), 79000)
  await pay(yilmaz, range(1, 12), 128000, { 11: 103000 })
  await pay(klein, range(1, 12), 6000)

  // Zähler: Hauptwasserzähler, je Wohnung Kaltwasser und Wärme, Zwischenablesung beim Auszug
  const meter = (body) => api.post(`/api/meters${q(P)}`, body)
  const read = (m, date, value, extra = {}) => api.post(`/api/readings${q(P)}`, { meterId: m.id, date, value, ...extra })
  const haupt = await meter({ name: 'Hauptwasserzähler', unitId: null, type: 'kaltwasser', unit: 'm³', meterNumber: 'HW-20481' })
  await read(haupt, `${PREV}-12-31`, 4812)
  await read(haupt, `${YEAR}-12-31`, 4965.6)
  const wasser = [[egL, 38.2, 'KW-1101'], [egR, 31.5, 'KW-1102'], [og, 52.9, 'KW-1103'], [dg, 27.4, 'KW-1104']]
  const waerme = [[egL, 9.6, 'WMZ-201'], [egR, 7.1, 'WMZ-202'], [og, 12.8, 'WMZ-203'], [dg, 5.9, 'WMZ-204']]
  const startStand = { [egL.id]: [412.6, 88.4], [egR.id]: [301.2, 61.7], [og.id]: [655.0, 120.3], [dg.id]: [233.9, 41.2] }
  for (const [u, used, nr] of wasser) {
    const m = await meter({ name: `Kaltwasser ${u.name}`, unitId: u.id, type: 'kaltwasser', unit: 'm³', meterNumber: nr })
    const start = startStand[u.id][0]
    await read(m, `${PREV}-12-31`, start)
    if (u.id === egR.id) await read(m, `${YEAR}-06-30`, Math.round((start + 14.8) * 10) / 10, { note: 'Auszug Hartmann' })
    await read(m, `${YEAR}-12-31`, Math.round((start + used) * 10) / 10)
  }
  for (const [u, used, nr] of waerme) {
    const m = await meter({ name: `Wärme ${u.name}`, unitId: u.id, type: 'waerme', unit: 'MWh', meterNumber: nr })
    const start = startStand[u.id][1]
    await read(m, `${PREV}-12-31`, start)
    if (u.id === egR.id) await read(m, `${YEAR}-06-30`, Math.round((start + 4.2) * 10) / 10, { note: 'Auszug Hartmann' })
    await read(m, `${YEAR}-12-31`, Math.round((start + used) * 10) / 10)
  }

  // Belege hochladen: mit Objekt und Jahr, wie aus dem Belegordner
  const upload = async (name, html, property = P, year = YEAR) => {
    const fd = new FormData()
    fd.append('file', new Blob([await pdf(html)], { type: 'application/pdf' }), name)
    fd.append('propertyId', property)
    fd.append('year', String(year))
    return (await api.post('/api/upload', fd)).file
  }
  const invoice = (vendor, vendorAddress, title, date, lines, note) =>
    invoiceHtml({ vendor, vendorAddress, title, date, recipient: RECIPIENT, lines, total: lines.reduce((s, l) => s + l.amount, 0), note })

  const cost = (body) => api.post(`/api/costItems${q(P)}`, body)
  // Vorjahr, für den Kostenvergleich und als Vorlage für „Aus dem Vorjahr übernehmen“
  /** @type {[string, string, number, string, Record<string, unknown>][]} */
  const previous = [
    ['Grundsteuer', `Grundsteuer B ${PREV}`, 598.2, 'area', {}],
    ['Wasser/Abwasser', 'Frischwasser und Abwasser', 1388.5, 'meter', { meterType: 'kaltwasser' }],
    ['Müllabfuhr', 'Restmüll und Biotonne', 612.0, 'persons', {}],
    ['Sach- und Haftpflichtversicherung', 'Wohngebäude- und Haftpflichtversicherung', 1219.0, 'area', {}],
    ['Hauswart', 'Hausmeisterdienst', 1740.0, 'area', { labor35aCents: 145000 }],
    ['Gartenpflege', 'Gartenpflege Saison', 1380.0, 'area', {}],
    ['Beleuchtung/Allgemeinstrom', 'Allgemeinstrom Treppenhaus und Keller', 395.4, 'area', {}],
    ['Schornsteinfeger', 'Feuerstättenschau und Abgasmessung', 92.8, 'area', { labor35aCents: 6100 }],
    ['Heizung und Warmwasser', 'Erdgas und Wartung Heizung', 5210.0, 'meter', { meterType: 'waerme' }],
  ]
  for (const [category, description, amount, key, extra] of previous) {
    await cost({ year: PREV, category, description, amountCents: Math.round(amount * 100), key, vendor: '', ...extra })
  }

  // Das Abrechnungsjahr, die meisten Positionen mit Beleg
  const grundsteuer = await upload(`Grundsteuerbescheid ${YEAR}.pdf`, invoice('Stadt Musterstadt', 'Steueramt · Rathausplatz 1 · 12345 Musterstadt', `Grundsteuerbescheid ${YEAR}`, `${YEAR}-01-20`, [{ text: 'Grundsteuer B, Lindenweg 12', amount: 612.4 }]))
  await cost({ year: YEAR, category: 'Grundsteuer', description: `Grundsteuer B ${YEAR}`, vendor: 'Stadt Musterstadt', amountCents: 61240, key: 'area', invoiceFile: grundsteuer })
  const wasserBeleg = await upload(`Wasser ${YEAR} Stadtwerke.pdf`, invoice('Stadtwerke Musterstadt', 'Am Wasserturm 3 · 12345 Musterstadt', `Jahresrechnung Wasser ${YEAR}`, `${YEAR}-12-31`, [{ text: 'Frischwasser 319 m³', amount: 700 }, { text: 'Abwasser 319 m³', amount: 800 }]))
  await cost({ year: YEAR, category: 'Wasser/Abwasser', description: 'Frischwasser', vendor: 'Stadtwerke Musterstadt', amountCents: 70000, key: 'meter', meterType: 'kaltwasser', invoiceFile: wasserBeleg })
  await cost({ year: YEAR, category: 'Wasser/Abwasser', description: 'Abwasser', vendor: 'Stadtwerke Musterstadt', amountCents: 80000, key: 'meter', meterType: 'kaltwasser', invoiceFile: wasserBeleg })
  const muell = await upload(`Abfallgebühren ${YEAR}.pdf`, invoice('Abfallwirtschaft Musterkreis', 'Deponiestraße 9 · 12345 Musterstadt', `Gebührenbescheid Abfall ${YEAR}`, `${YEAR}-01-15`, [{ text: 'Restmüll 240 l, 14-täglich', amount: 486 }, { text: 'Biotonne 120 l', amount: 164 }]))
  await cost({ year: YEAR, category: 'Müllabfuhr', description: 'Restmüll und Biotonne', vendor: 'Abfallwirtschaft Musterkreis', amountCents: 65000, key: 'persons', invoiceFile: muell })
  const versicherung = await upload(`Versicherung ${YEAR}.pdf`, invoice('Beispiel Versicherung AG', 'Policenweg 4 · 54321 Beispielstadt', 'Beitragsrechnung', `${YEAR}-01-02`, [{ text: 'Wohngebäudeversicherung', amount: 1046 }, { text: 'Haus- und Grundbesitzerhaftpflicht', amount: 238 }]))
  await cost({ year: YEAR, category: 'Sach- und Haftpflichtversicherung', description: 'Wohngebäude- und Haftpflichtversicherung', vendor: 'Beispiel Versicherung AG', amountCents: 128400, key: 'area', invoiceFile: versicherung })
  const hauswart = await upload(`Hausmeister ${YEAR}.pdf`, invoice('Hausservice Muster', 'Werkstattweg 2 · 12345 Musterstadt', `Jahresrechnung Hausmeisterdienst ${YEAR}`, `${YEAR}-12-15`, [{ text: 'Hausmeisterdienst, 12 Monate (Arbeitskosten)', amount: 1500 }, { text: 'Material und Fahrtkosten', amount: 300 }], 'Enthaltene Arbeitskosten nach § 35a EStG: 1.500,00 €'))
  await cost({ year: YEAR, category: 'Hauswart', description: 'Hausmeisterdienst', vendor: 'Hausservice Muster', amountCents: 180000, key: 'area', labor35aCents: 150000, invoiceFile: hauswart })
  const schornstein = await upload(`Schornsteinfeger ${YEAR}.pdf`, invoice('Schornsteinfegerbetrieb Beispiel', 'Kaminweg 7 · 12345 Musterstadt', 'Rechnung', `${YEAR}-10-14`, [{ text: 'Feuerstättenschau', amount: 34.6 }, { text: 'Abgaswegeüberprüfung und Messung', amount: 60.7 }], 'Enthaltene Arbeitskosten nach § 35a EStG: 63,20 €'))
  await cost({ year: YEAR, category: 'Schornsteinfeger', description: 'Feuerstättenschau und Abgasmessung', vendor: 'Schornsteinfegerbetrieb Beispiel', amountCents: 9530, key: 'area', labor35aCents: 6320, invoiceFile: schornstein })
  const heizung = await upload(`Erdgas ${YEAR}.pdf`, invoice('Energieversorgung Musterstadt', 'Gasstraße 1 · 12345 Musterstadt', `Jahresabrechnung Erdgas ${YEAR}`, `${YEAR}-12-31`, [{ text: 'Erdgas 41.200 kWh', amount: 4380 }, { text: 'Wartung Gasbrennwertkessel', amount: 420 }]))
  await cost({ year: YEAR, category: 'Heizung und Warmwasser', description: 'Erdgas und Wartung Heizung', vendor: 'Energieversorgung Musterstadt', amountCents: 480000, key: 'meter', meterType: 'waerme', invoiceFile: heizung })
  // Ohne Beleg: aus dem Vorjahr übernommen und noch geschätzt. Die Rechnung dazu wartet im
  // Posteingang, ihre Auswertung schlägt das Verknüpfen vor.
  await cost({ year: YEAR, category: 'Gartenpflege', description: 'Gartenpflege Saison', vendor: '', amountCents: 138000, key: 'area' })
  await cost({ year: YEAR, category: 'Beleuchtung/Allgemeinstrom', description: 'Allgemeinstrom Treppenhaus und Keller', vendor: 'Stadtwerke Musterstadt', amountCents: 41890, key: 'area' })
  await cost({ year: YEAR, category: 'Sonstige Betriebskosten', description: 'Rohrreinigung Küchenstrang EG links', vendor: 'Rohrdienst Beispiel', amountCents: 18500, key: 'direct', directUnitId: egL.id })
  const dach = await upload(`Dachrinne Reparatur ${YEAR}.pdf`, invoice('Dachdeckerei Beispiel', 'Ziegelweg 5 · 12345 Musterstadt', 'Rechnung Reparatur', `${YEAR}-05-22`, [{ text: 'Dachrinne erneuert, 8 m (Arbeitskosten)', amount: 380 }, { text: 'Material', amount: 260 }]))
  await cost({ year: YEAR, category: 'Nicht umlagefähig', description: 'Reparatur Dachrinne', vendor: 'Dachdeckerei Beispiel', amountCents: 64000, key: 'area', invoiceFile: dach })

  // Posteingang: ein Beleg ohne Zuordnung und einer mit offener KI-Auswertung (Gartenpflege)
  await upload(`Strom Abschlag Dezember ${YEAR}.pdf`, invoice('Stadtwerke Musterstadt', 'Am Wasserturm 3 · 12345 Musterstadt', 'Abschlagsrechnung Allgemeinstrom', `${YEAR}-12-01`, [{ text: 'Abschlag Dezember', amount: 35 }]))
  const garten = INVOICES.GARTEN
  const gartenFd = new FormData()
  gartenFd.append('file', new Blob([await pdf(invoice(garten.vendor, 'Blumenweg 8 · 12345 Musterstadt', `Rechnung Gartenpflege ${YEAR}`, garten.invoiceDate, garten.positions.map((p) => ({ text: p.description, amount: p.amountEur }))))], { type: 'application/pdf' }), `Gärtnerei Grün ${YEAR}.pdf`)
  // Die Textebene, wie sie der Browser mitschickt; das Kennwort wählt die Antwort des nachgebauten Ollama
  gartenFd.append('pdfText', `GARTEN Gärtnerei Grün Rechnung Gartenpflege Saison ${YEAR} Rechnungsbetrag 1.450,00 EUR `.repeat(3))
  gartenFd.append('propertyId', P)
  gartenFd.append('year', String(YEAR))
  const evaluated = await api.post('/api/extract', gartenFd)
  if (!evaluated.assessment) throw new Error('Die KI-Auswertung wurde nicht gespeichert.')

  // Objekt 2: vermietete Eigentumswohnung, Kosten laut Hausgeldabrechnung der Gemeinschaft
  const etw = await api.post('/api/properties', { name: 'Kastanienallee 5, WE 7', kind: 'etw', address: 'Kastanienallee 5, 12345 Musterstadt' })
  const E = etw.id
  const we7 = await api.post(`/api/units?property=${E}`, { name: 'WE 7, 2. OG rechts', areaM2: 68, participates: true, mea: 85, rooms: 3, floor: '2. OG' })
  const wagner = await api.post(`/api/tenancies?property=${E}`, {
    unitId: we7.id, tenantName: 'Sophie Wagner', start: '2023-05-01', end: null, personHistory: [{ from: '2023-05-01', persons: 1 }],
    prepayments: [{ from: '2023-05', monthlyCents: 21000 }], prepaymentOverrides: {}, baseRents: [{ from: '2023-05', monthlyCents: 74000 }],
  })
  for (const m of range(1, 12)) {
    await api.post(`/api/payments?property=${E}`, { tenancyId: wagner.id, date: `${YEAR}-${String(m).padStart(2, '0')}-01`, amountCents: 95000 })
  }
  const hausgeld = await upload(`Hausgeldabrechnung ${YEAR} WE 7.pdf`, invoice('Hausverwaltung Beispiel GmbH', 'Verwalterstraße 10 · 12345 Musterstadt', `Hausgeldabrechnung ${YEAR}, WE 7`, `${YEAR + 1}-03-10`, [
    { text: 'Hauswart (Anteil 85/1.000)', amount: 612 }, { text: 'Gebäudeversicherung (Anteil)', amount: 297.5 },
    { text: 'Wasser/Abwasser (Anteil)', amount: 380.8 }, { text: 'Verwaltervergütung', amount: 357 }, { text: 'Zuführung Erhaltungsrücklage', amount: 765 },
  ]), E)
  const ext = (body) => api.post(`/api/costItems?property=${E}`, { year: YEAR, vendor: 'Hausverwaltung Beispiel GmbH', invoiceFile: hausgeld, ...body })
  await ext({ category: 'Hauswart', description: 'Hauswart laut Hausgeldabrechnung', amountCents: 61200, key: 'external', externalBasis: { measure: 'mea', total: 1000, totalCents: 720000 } })
  await ext({ category: 'Sach- und Haftpflichtversicherung', description: 'Gebäudeversicherung laut Hausgeldabrechnung', amountCents: 29750, key: 'external', externalBasis: { measure: 'mea', total: 1000, totalCents: 350000 } })
  await ext({ category: 'Wasser/Abwasser', description: 'Wasser und Abwasser laut Hausgeldabrechnung', amountCents: 38080, key: 'external', externalBasis: { measure: 'mea', total: 1000, totalCents: 448000 } })
  await ext({ category: 'Nicht umlagefähig', description: 'Verwaltervergütung', amountCents: 35700, key: 'area' })
  await ext({ category: 'Zuführung Erhaltungsrücklage', description: 'Zuführung Erhaltungsrücklage', amountCents: 76500, key: 'area' })
  await api.post(`/api/costItems?property=${E}`, { year: YEAR, category: 'Grundsteuer', description: `Grundsteuer ${YEAR}`, vendor: 'Stadt Musterstadt', amountCents: 21480, key: 'area' })

  return { haus: P, etw: E }
}

// ---------- Fotografieren ----------
async function shoot(browser, base) {
  const context = await browser.newContext({
    viewport: VIEWPORT, deviceScaleFactor: SCALE, colorScheme: 'light', locale: 'de-DE', timezoneId: 'Europe/Berlin',
  })
  // Helles Design fest, das erste Objekt gewählt
  await context.addInitScript(() => {
    try {
      localStorage.setItem('nka-theme', 'light')
    } catch {
      // ohne Speicher gilt das System, und das ist hier hell
    }
  })
  const page = await context.newPage()
  const problems = []
  page.on('pageerror', (err) => problems.push(`Fehler in der Seite: ${err.message}`))
  page.on('console', (msg) => { if (msg.type() === 'error') problems.push(`Konsole: ${msg.text()}`) })
  await page.goto(base)
  await page.getByRole('button', { name: 'Cockpit' }).waitFor()

  const settle = async () => {
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(400)
  }
  const go = async (label) => {
    await page.setViewportSize(VIEWPORT)
    await page.locator('nav.sidebar').getByRole('button', { name: label, exact: false }).first().click()
    await settle()
    // Der Klick rollt die Seitenleiste mit, wenn der Eintrag unten steht; das Logo gehört ins Bild
    await page.evaluate(() => {
      const win = /** @type {any} */ (globalThis)
      win.scrollTo(0, 0)
      win.document.querySelector('nav.sidebar')?.scrollTo(0, 0)
    })
  }
  // Ein Element oben ins Bild holen, mit etwas Luft darüber
  const scrollTo = async (locator, gap = 24) => {
    await locator.evaluate((el, g) => {
      const win = /** @type {any} */ (globalThis)
      win.scrollTo(0, el.getBoundingClientRect().top + win.scrollY - g)
    }, gap)
    await page.waitForTimeout(200)
  }
  // Höher als der Bildschirm, wo das Wesentliche einer Seite sonst unter dem Rand läge
  const tall = async (height) => {
    await page.setViewportSize({ width: VIEWPORT.width, height })
    await settle()
  }
  const save = async (name) => {
    // Nichts Rotes im Bild: eine Fehlermeldung der Oberfläche hält das Skript an
    const alert = page.locator('.error, [role="alert"].error')
    if (await alert.count()) throw new Error(`${name}: Fehlermeldung im Bild: ${await alert.first().innerText()}`)
    const file = path.join(OUT, `${name}.png`)
    await page.screenshot({ path: file })
    console.log(`  ✓ ${path.relative(root, file)} (${Math.round(fs.statSync(file).size / 1024)} KB)`)
  }

  await settle()
  await save('cockpit')

  await go('Abrechnung')
  // Die Abrechnung des ersten Mieters, den Rechenweg ihrer ersten Zeile aufgeklappt
  await page.locator('button.calc-toggle').first().click()
  await scrollTo(page.locator('.card', { has: page.locator('tr.calc-steps') }).first())
  await save('abrechnung')

  await go('Mietkonto')
  await save('mietkonto')

  await go('Kosten')
  await save('kosten')

  await go('Kostenvergleich')
  await save('kostenvergleich')

  // Mit Eigennutzung: Werbungskosten je Position aufgeteilt in privat und abziehbar
  await go('Steuer (Anlage V)')
  await tall(1700)
  await save('steuer')

  await go('Zähler & Stände')
  await save('zaehler')

  await go('Stammdaten')
  await save('stammdaten')

  // Posteingang, Belegabdeckung, Mappen und die Register je Kostenart
  await go('Belegordner')
  await tall(1500)
  await page.waitForFunction(() => {
    // Im Browser ausgeführt; scripts/tsconfig.json kennt die Typen des DOM nicht
    const thumbs = [.../** @type {any} */ (globalThis).document.querySelectorAll('.receipt-thumb')]
    return thumbs.length > 0 && thumbs.every((/** @type {any} */ t) => {
      const img = t.querySelector('img')
      return img ? img.complete && img.naturalWidth > 0 : t.textContent?.trim() !== '…'
    })
  }, undefined, { timeout: 30000 })
  await save('belegordner')

  // Die offene Auswertung aus dem Posteingang: Ampel je Zeile, Vorschlag zum Verknüpfen
  await go('Schnellerfassung')
  const review = page.locator('.card', { hasText: 'bitte prüfen' }).first()
  await review.waitFor()
  // Die Rechnung gehört zur Position, die schon aus dem Vorjahr dasteht: verknüpfen statt doppelt
  // anlegen, dann zeigt die Vorschau, was mit der Position geschieht
  const action = review.locator('select').filter({ has: page.locator('option[value^="link:"]') }).first()
  const link = await action.locator('option[value^="link:"]').first().getAttribute('value')
  if (!link) throw new Error('Die Auswertung bietet kein Verknüpfen an.')
  await action.selectOption(link)
  await review.getByRole('button', { name: 'Vorschau' }).click()
  await review.locator('[aria-label="Vorschau"]').waitFor()
  await tall(1000)
  await save('auswertung-pruefen')

  // Eine Anleitung je Vermietungsart aufgeklappt
  await go('Hilfe & Begriffe')
  const guide = page.locator('summary', { hasText: 'Haus mit Einliegerwohnung' }).first()
  await guide.click()
  await settle()
  await scrollTo(guide, 80)
  await save('hilfe')

  await context.close()
  if (problems.length) throw new Error(`Die Oberfläche hat Fehler gemeldet:\n${problems.join('\n')}`)
}

async function main() {
  const { chromium } = await loadPlaywright()
  if (!SKIP_BUILD) {
    console.log('Oberfläche bauen …')
    execSync('npm run build', { cwd: root, stdio: 'inherit' })
  }
  if (!fs.existsSync(path.join(root, 'client', 'dist', 'index.html'))) {
    throw new Error('client/dist fehlt. Bitte ohne --skip-build ausführen.')
  }
  fs.mkdirSync(OUT, { recursive: true })
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-screenshots-'))
  const ollama = await startFakeOllama({ sequence: ['GARTEN'] })
  /** @type {{ base: string, stop: () => Promise<unknown> } | null} */
  let server = null
  /** @type {import('playwright').Browser | null} */
  let browser = null
  try {
    server = await startServer(dataDir, ollama.url)
    browser = await chromium.launch()
    const printer = await browser.newPage()
    const pdf = async (html) => {
      await printer.setContent(html)
      return printer.pdf({ format: 'A4', printBackground: true })
    }
    console.log(`Beispielbestand anlegen (Abrechnungsjahr ${YEAR}) …`)
    await seed(client(server.base), pdf)
    await printer.close()
    console.log(`Fotografieren nach ${path.relative(root, OUT)}/ …`)
    await shoot(browser, server.base)
  } finally {
    await browser?.close()
    await server?.stop()
    ollama.stop()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : err}`)
  process.exitCode = 1
})

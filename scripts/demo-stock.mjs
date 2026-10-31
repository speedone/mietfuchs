// Der Beispielbestand der Bildschirmfotos (screenshots.mjs) und des Browserlaufs (browser-check.mjs), an
// einer Stelle, damit beide dasselbe Haus zeigen (#340). Dazu der Start eines eigenen Servers aus dem Repo
// wie `npm start`, mit den drei Angaben jedes Prüfstarts (CLAUDE.md): einem Wegwerf-Datenordner, `CI=1`
// und einer Update-Adresse auf einem geschlossenen Port. Die KI beantwortet das nachgebaute Ollama aus
// fake-ollama.mjs, damit „Auswertung prüfen“ gezeigt werden kann; nichts geht ins Internet.
//
// **Alle Daten sind erfunden**: Objekte, Namen, Adressen, Beträge und Belege. Die Bankverbindung ist die
// veröffentlichte Beispiel-IBAN (siehe unten), kein Konto einer Person. Das Abrechnungsjahr ist das Vorjahr,
// wie es die Oberfläche voreinstellt; zu einem späteren Release entstehen dieselben Bilder ein Jahr weiter.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { INVOICES, startFakeOllama } from './fake-ollama.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Dasselbe Jahr wie das nachgebaute Ollama und die Voreinstellung der Oberfläche (client/src/year.tsx)
export const YEAR = new Date().getFullYear() - 1
export const PREV = YEAR - 1

// Playwright ist devDependency im Wurzelpaket; die Browser kommen mit `npx playwright install`.
export async function loadPlaywright() {
  try {
    return await import('playwright')
  } catch {
    throw new Error('Playwright fehlt. Bitte im Repo `npm install` und danach `npx playwright install` ausführen.')
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

export async function startServer(dataDir, ollamaUrl) {
  const port = await freePort()
  const child = spawn(process.execPath, ['src/index.ts'], {
    cwd: path.join(root, 'server'),
    env: {
      ...process.env,
      NKA_DATA_DIR: dataDir,
      NKA_PORT: String(port),
      NKA_OLLAMA_URL: ollamaUrl,
      NKA_OLLAMA_MODEL: 'qwen3.5:4b',
      // Fortlaufende Kennungen (server/src/ids.ts): derselbe Bestand in jedem Lauf, auch beim Rest-Cent
      NKA_TEST_IDS: 'seq',
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
  // Ob der Server noch läuft; sonst Exit-Code, Signal und das Ende seiner Ausgabe
  const problem = () => (child.exitCode === null && child.signalCode === null
    ? null
    : `Der Server ist beendet worden (Code ${child.exitCode}, Signal ${child.signalCode}):\n${log.slice(-2000)}`)
  return { base, stop, problem }
}

// ---------- API ----------
export function client(base) {
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

export function invoiceHtml({ vendor, vendorAddress, title, date, recipient, lines, total, note }) {
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
export async function seed(api, pdf) {
  await api.put('/api/settings', {
    landlordName: 'Klaus Wegener',
    // Eine gültige IBAN, denn seit #279 lehnt der Server eine ungültige ab. Es ist die veröffentlichte
    // Beispiel-IBAN aus Spezifikationen und Bankunterlagen, kein Konto einer Person aus dem Bestand.
    iban: 'DE02 1203 0000 0000 2020 51',
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
  // #262 PR 3 (Durchsicht S4): eine nach § 82b EStDV verteilte Position, damit Browserlauf und Bildschirmfotos das Feld im
  // Kostenformular, die Spalte „verteilt“ und den Block der Zeilen 57 bis 72 sehen.
  await cost({ year: YEAR, category: 'Nicht umlagefähig', description: 'Dachsanierung', vendor: 'Dachdeckerei Beispiel', amountCents: 1200000, key: 'area', spreadYears: 3 })

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

// ---------- Belege ohne Browser ----------
// Ein schlichtes PDF mit dem Text des Rechnungsbogens, ohne Browser gebaut: Firefox und WebKit drucken in
// Playwright keine PDFs, und der Browserlauf soll mit jeder Engine allein auskommen. Eine Seite A4,
// Helvetica in WinAnsi; was die Kodierung nicht kennt, wird „?“.
/** @type {Record<string, number>} */
const WIN_ANSI = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '–': 0x96, '—': 0x97 }
/** @param {string} text */
function pdfString(text) {
  let out = ''
  for (const ch of text) {
    const code = WIN_ANSI[ch] ?? ch.codePointAt(0) ?? 63
    const byte = code < 256 ? code : 63
    if (ch === '(' || ch === ')' || ch === '\\') out += `\\${ch}`
    else if (byte < 32 || byte > 126) out += `\\${byte.toString(8).padStart(3, '0')}`
    else out += ch
  }
  return `(${out})`
}

/** @param {string} html */
export function textPdf(html) {
  // Bis nichts mehr zu entfernen ist: Ein Rest wie „<sty<style>…</style>le>“ ergäbe sonst wieder ein Tag.
  let text = html
  for (let before = ''; before !== text; ) {
    before = text
    text = text.replace(/<style[\s\S]*?<\/style>/gi, '')
  }
  const lines = text
    .replace(/<(br|\/div|\/tr|\/h1)[^>]*>/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const content = ['BT', '/F1 11 Tf', '15 TL', '56 790 Td', ...lines.slice(0, 48).map((l) => `T* ${pdfString(l)} Tj`), 'ET'].join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = objects.map((obj, i) => {
    const at = Buffer.byteLength(pdf, 'latin1')
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`
    return at
  })
  const xref = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

// ---------- Alles zusammen ----------
// Wegwerf-Ordner, nachgebautes Ollama, Server und Bestand. `pdf` macht aus einem Rechnungsbogen (HTML) die
// Bytes eines PDFs: beim Fotografieren gedruckt vom Browser, im Browserlauf mit `textPdf`.
/** @param {{ pdf: (html: string) => Promise<Uint8Array> | Uint8Array, prefix?: string }} options */
export async function startDemo({ pdf, prefix = 'mietfuchs-demo-' }) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  const ollama = await startFakeOllama({ sequence: ['GARTEN'] })
  /** @type {{ base: string, stop: () => Promise<unknown>, problem: () => string | null } | null} */
  let server = null
  const stop = async () => {
    await server?.stop()
    ollama.stop()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
  try {
    server = await startServer(dataDir, ollama.url)
    const api = client(server.base)
    const ids = await seed(api, async (html) => pdf(html))
    return { base: server.base, api, ids, stop, problem: server.problem }
  } catch (err) {
    await stop()
    throw err
  }
}

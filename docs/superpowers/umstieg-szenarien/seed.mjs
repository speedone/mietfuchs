// Bestand für das Upgrade-Szenario, eingegeben über die HTTP-API von 0.13.1 (wie die Oberfläche sendet).
// Aufruf: node seed.mjs <base-url> <out-ids.json>
import fs from 'node:fs'
import { client, textPdf, writeJson } from './lib.mjs'

const [base, outFile] = process.argv.slice(2)
const api = client(base)
const log = []
const ids = {}
async function step(name, fn, { expectFail = false } = {}) {
  try {
    const r = await fn()
    log.push({ name, ok: true, expectFail })
    if (expectFail) console.log(`!! ${name}: erwartete Ablehnung blieb aus`)
    return r
  } catch (e) {
    log.push({ name, ok: false, expectFail, error: String(e.message).slice(0, 800) })
    console.log(`${expectFail ? '(erwartet) ' : 'FEHLER '}${name}: ${String(e.message).slice(0, 400)}`)
    return undefined
  }
}
const q = (p) => `?property=${p}`
// Abschließen wie die Oberfläche: erst ohne, nach der Rückfrage mit Prüfmarke (Trotzdem abschließen)
async function closeSettlement(P, period, sentAt) {
  const url = `/api/settlement/${period}/close?property=${P}`
  const r1 = await api.raw('POST', url, { sentAt })
  if (r1.status === 201) return { asked: null }
  if (r1.status === 409 && r1.json?.errorToken) {
    const r2 = await api.raw('POST', url, { sentAt, despiteErrors: r1.json.errorToken })
    if (r2.status === 201) return { asked: (r1.json.errorNotices ?? []).map((n) => n.code) }
    throw new Error(`zweiter Versuch HTTP ${r2.status} ${r2.buf.toString().slice(0, 300)}`)
  }
  throw new Error(`HTTP ${r1.status} ${r1.buf.toString().slice(0, 500)}`)
}
const months = (a, b) => { const out = []; let [y, m] = a.split('-').map(Number); const [Y, M] = b.split('-').map(Number); while (y < Y || (y === Y && m <= M)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++ } } return out }
async function upload(name, text, propertyId, year) {
  const fd = new FormData()
  fd.append('file', new Blob([textPdf(text)], { type: 'application/pdf' }), name)
  fd.append('propertyId', propertyId)
  fd.append('year', String(year))
  return (await api.post('/api/upload', fd)).file
}

await step('Einstellungen', () => api.put('/api/settings', {
  landlordName: 'Petra Lindner', landlordAddress: 'Ahornweg 2, 34567 Beispielhausen', iban: 'DE02 1203 0000 0000 2020 51', paymentDeadlineDays: 30, updateCheck: 'off',
}))

// =====================================================================================================
// A: Mehrfamilienhaus, Kalenderjahr, 4 Wohnungen, Messdienst-Heizung mit CO₂, Betriebsstrom-Abzug
// =====================================================================================================
const [first] = await api.get('/api/properties')
const A = (await api.put(`/api/properties/${first.id}`, { name: 'Birkenstraße 8', kind: 'mfh', address: 'Birkenstraße 8, 34567 Beispielhausen', state: 'HE' })).id
ids.A = A
const unitA = (b) => api.post(`/api/units${q(A)}`, { participates: true, ...b })
const a1 = await unitA({ name: 'EG links', areaM2: 68.5, rooms: 3, floor: 'EG' })
const a2 = await unitA({ name: 'EG rechts', areaM2: 54, rooms: 2, floor: 'EG' })
const a3 = await unitA({ name: 'OG links', areaM2: 72.25, rooms: 3, floor: '1. OG' })
const a4 = await unitA({ name: 'OG rechts', areaM2: 61, rooms: 2, floor: '1. OG' })
ids.unitsA = [a1.id, a2.id, a3.id, a4.id]
const tenA = (b) => api.post(`/api/tenancies${q(A)}`, { prepaymentOverrides: {}, end: null, ...b })
const mueller = await tenA({ unitId: a1.id, tenantName: 'Familie Müller', start: '2018-03-01', personHistory: [{ from: '2018-03-01', persons: 2 }],
  prepayments: [{ from: '2018-03', monthlyCents: 21000 }, { from: '2024-01', monthlyCents: 23500 }], baseRents: [{ from: '2018-03', monthlyCents: 61000 }] })
const schulz = await tenA({ unitId: a2.id, tenantName: 'Herr Schulz', start: '2019-08-01', end: '2024-05-31', personHistory: [{ from: '2019-08-01', persons: 1 }],
  prepayments: [{ from: '2019-08', monthlyCents: 17500 }], baseRents: [{ from: '2019-08', monthlyCents: 47000 }] })
// Leerstand Juni bis August 2024
const neumann = await tenA({ unitId: a2.id, tenantName: 'Frau Neumann', start: '2024-09-01', personHistory: [{ from: '2024-09-01', persons: 1 }],
  prepayments: [{ from: '2024-09', monthlyCents: 19000 }], baseRents: [{ from: '2024-09', monthlyCents: 52000 }] })
const oeztuerk = await tenA({ unitId: a3.id, tenantName: 'Familie Öztürk', start: '2020-01-01', personHistory: [{ from: '2020-01-01', persons: 3 }, { from: '2025-02-10', persons: 4 }],
  prepayments: [{ from: '2020-01', monthlyCents: 26000 }], baseRents: [{ from: '2020-01', monthlyCents: 68000 }] })
const weber = await tenA({ unitId: a4.id, tenantName: 'Weber, Jana', start: '2022-04-01', personHistory: [{ from: '2022-04-01', persons: 2 }],
  prepayments: [{ from: '2022-04', monthlyCents: 22000 }], baseRents: [{ from: '2022-04', monthlyCents: 57000 }] })
ids.tenA = { mueller: mueller.id, schulz: schulz.id, neumann: neumann.id, oeztuerk: oeztuerk.id, weber: weber.id }

// Zähler und Ablesungen 2022-12-31 … 2025-12-31
const meterA = (b) => api.post(`/api/meters${q(A)}`, b)
const readA = (m, date, value, extra = {}) => api.post(`/api/readings${q(A)}`, { meterId: m.id, date, value, ...extra })
const hauptA = await meterA({ name: 'Hauptwasserzähler', unitId: null, type: 'kaltwasser', unit: 'm³', meterNumber: 'HW-7711' })
let hw = 10234.5
for (const y of [2022, 2023, 2024, 2025]) { await readA(hauptA, `${y}-12-31`, Math.round(hw * 10) / 10); hw += 182.7 + (y - 2022) * 3.1 }
const kwA = {}
const verbrauch = { [a1.id]: [41.3, 43.8, 40.2], [a2.id]: [28.6, 24.9, 30.1], [a3.id]: [56.2, 58.4, 66.9], [a4.id]: [38.7, 37.1, 39.8] }
for (const [u, nr, start] of [[a1, 'KW-01', 512.4], [a2, 'KW-02', 377.9], [a3, 'KW-03', 803.2], [a4, 'KW-04', 455.0]]) {
  const m = await meterA({ name: `Kaltwasser ${u.name}`, unitId: u.id, type: 'kaltwasser', unit: 'm³', meterNumber: nr })
  kwA[u.id] = m.id
  let v = start
  await readA(m, '2022-12-31', v)
  for (const [i, y] of [2023, 2024, 2025].entries()) {
    const used = verbrauch[u.id][i]
    if (u.id === a2.id && y === 2024) {
      await readA(m, '2024-05-31', Math.round((v + 11.4) * 10) / 10, { note: 'Auszug Schulz' })
      await readA(m, '2024-08-31', Math.round((v + 12.0) * 10) / 10, { note: 'Einzug Neumann' })
    }
    v += used
    await readA(m, `${y}-12-31`, Math.round(v * 10) / 10)
  }
}

// Heizanlage mit Messdienst
const plantA = await step('A: Heizanlage Messdienst', async () => (await api.post(`/api/heating-plants${q(A)}`, { energy: 'gas', method: 'service', name: 'Gaszentralheizung' })).plant)
ids.plantA = plantA?.id

const costA = (b) => api.post(`/api/costItems${q(A)}`, { vendor: '', ...b })
ids.costA = {}
const heizA = {
  2023: { total: 784560, t: { mueller: 182340, schulz: 141220, oeztuerk: 251870, weber: 196410 }, co2: 21480 },
  2024: { total: 812390, t: { mueller: 190115, schulz: 52880, neumann: 61930, oeztuerk: 262405, weber: 201377 }, co2: 19960 },
  2025: { total: 799012, t: { mueller: 186222, neumann: 152731, oeztuerk: 271118, weber: 172409 }, co2: 18431 },
}
for (const y of [2023, 2024, 2025]) {
  const P = `${y}-01`
  const k = (s) => `${s}${y}`
  ids.costA[k('grundsteuer')] = (await step(`A ${y} Grundsteuer`, () => costA({ period: P, category: 'Grundsteuer', description: `Grundsteuer B ${y}`, vendor: 'Stadt Beispielhausen', amountCents: [84312, 91277, 91277][y - 2023], key: 'area', paidOn: `${y}-02-15` })))?.id
  ids.costA[k('wasser')] = (await step(`A ${y} Wasser`, () => costA({ period: P, category: 'Wasser/Abwasser', description: 'Frisch- und Abwasser', vendor: 'Stadtwerke Beispielhausen', amountCents: [143877, 151209, 158833][y - 2023], key: 'meter', meterType: 'kaltwasser' })))?.id
  ids.costA[k('muell')] = (await step(`A ${y} Müll`, () => costA({ period: P, category: 'Müllabfuhr', description: 'Restmüll, Bio, Papier', vendor: 'Abfallzweckverband', amountCents: [61745, 64320, 66911][y - 2023], key: 'persons' })))?.id
  ids.costA[k('versicherung')] = (await step(`A ${y} Versicherung`, () => costA({ period: P, category: 'Sach- und Haftpflichtversicherung', description: 'Wohngebäude- und Haftpflichtversicherung', vendor: 'Musterversicherung AG', amountCents: [118933, 127402, 139915][y - 2023], key: 'area' })))?.id
  ids.costA[k('strom')] = (await step(`A ${y} Hausstrom`, () => costA({ period: P, category: 'Beleuchtung/Allgemeinstrom', description: 'Allgemeinstrom', vendor: 'Stadtwerke Beispielhausen', amountCents: [52381, 57902, 54417][y - 2023], key: 'area' })))?.id
  ids.costA[k('hauswart')] = (await step(`A ${y} Hauswart`, () => costA({ period: P, category: 'Hauswart', description: 'Hausmeisterdienst', vendor: 'Hausservice Kraft', amountCents: [162000, 168000, 174000][y - 2023], key: 'area', labor35aCents: [138000, 142000, 146000][y - 2023] })))?.id
  if (y === 2024) {
    // Gutschrift (negativer Betrag)
    ids.costA.gutschrift2024 = (await step('A 2024 Gutschrift Wasser', () => costA({ period: P, category: 'Wasser/Abwasser', description: 'Gutschrift Abwasser (Korrektur Vorjahr)', vendor: 'Stadtwerke Beispielhausen', amountCents: -8412, key: 'meter', meterType: 'kaltwasser' })))?.id
    ids.costA.reparatur2024 = (await step('A 2024 Reparatur', () => costA({ period: P, category: 'Nicht umlagefähig', description: 'Reparatur Haustür', vendor: 'Schreinerei Holz', amountCents: 48790, key: 'area' })))?.id
  }
  if (plantA) {
    const h = heizA[y]
    const tenancyAmounts = Object.fromEntries(Object.entries(h.t).map(([n, c]) => [ids.tenA[n], c]))
    ids.costA[k('heizung')] = (await step(`A ${y} Heizung Messdienst`, () => costA({ period: P, category: 'Heizung und Warmwasser', description: `Heizkostenabrechnung Messdienst ${y}`, vendor: 'Wärmemess GmbH', amountCents: Object.values(h.t).reduce((a, b) => a + b, 0) + h.co2, key: 'amounts', tenancyAmounts, heatingPlantId: plantA.id })))?.id
    const sum = Object.values(h.t).reduce((a, b) => a + b, 0)
    await step(`A ${y} CO₂`, () => api.put(`/api/heating-plants/${plantA.id}/periods/${P}/co2${q(A)}`, { method: 'serviceDeducted', serviceUsersTotalCents: sum, serviceLandlordCents: h.co2, serviceUnitsCount: 4 }))
    if (ids.costA[k('strom')]) {
      await step(`A ${y} Betriebsstrom-Abzug`, () => api.post(`/api/heating-plants/${plantA.id}/operating-power${q(A)}`, {
        period: P, generalItemId: ids.costA[k('strom')], billKwh: [1650, 1702, 1588][y - 2023], devices: [{ label: 'Umwälzpumpe', watts: 55, hoursPerDay: 24 }, { label: 'Brennersteuerung', watts: 12, hoursPerDay: 24 }], heatingDays: 230,
      }))
    }
  }
}
// Mieterwechsel 2025 über den Assistenten: Weber zieht zum 31.07.2025 aus, Kaya zum 01.08.2025 ein
const kaya = await step('A Mieterwechsel Weber→Kaya', () => api.post(`/api/tenancies/${weber.id}/change${q(A)}`, {
  end: '2025-07-31', readings: [{ meterId: kwA[a4.id], value: 455.0 + 38.7 + 37.1 + 23.4 }],
  newTenancy: { tenantName: 'Kaya, Deniz', persons: 1, start: '2025-08-01', prepayments: [{ from: '2025-08', monthlyCents: 20500 }], baseRents: [{ from: '2025-08', monthlyCents: 59500 }] },
}))
ids.tenA.kaya = kaya?.newTenancy?.id
// Messdienstbeträge 2025 nach dem Wechsel: Weber 7 Monate, Kaya 5
if (ids.costA.heizung2025 && ids.tenA.kaya) {
  const h = heizA[2025]
  const t = { [mueller.id]: h.t.mueller, [neumann.id]: h.t.neumann, [oeztuerk.id]: h.t.oeztuerk, [weber.id]: 101377, [ids.tenA.kaya]: 71032 }
  await step('A 2025 Heizung Einzelbeträge nach Wechsel', () => api.put(`/api/costItems/${ids.costA.heizung2025}${q(A)}`, { tenancyAmounts: t, amountCents: Object.values(t).reduce((a, b) => a + b, 0) + h.co2 }))
  await step('A 2025 CO₂ nach Wechsel', () => api.put(`/api/heating-plants/${plantA.id}/periods/2025-01/co2${q(A)}`, { method: 'serviceDeducted', serviceUsersTotalCents: Object.values(t).reduce((a, b) => a + b, 0), serviceLandlordCents: h.co2, serviceUnitsCount: 4 }))
}
// Zahlungen 2023-2025
const payA = async (tid, from, to, cents, short = {}) => {
  if (!tid) return
  for (const m of months(from, to)) {
    const amount = short[m] ?? cents
    if (amount > 0) await api.post(`/api/payments${q(A)}`, { tenancyId: tid, date: `${m}-03`, amountCents: amount })
  }
}
await step('A Zahlungen', async () => {
  await payA(mueller.id, '2023-01', '2023-12', 82000)
  await payA(mueller.id, '2024-01', '2025-12', 84500, { '2024-11': 60000, '2025-03': 0 })
  await payA(schulz.id, '2023-01', '2024-05', 64500)
  await payA(neumann.id, '2024-09', '2025-12', 71000)
  await payA(oeztuerk.id, '2023-01', '2025-12', 94000, { '2025-06': 188000, '2025-07': 0 })
  await payA(weber.id, '2023-01', '2025-07', 79000)
  await payA(ids.tenA.kaya, '2025-08', '2025-12', 80000)
  // Nachzahlung Müller aus der Abrechnung 2023
  await api.post(`/api/payments${q(A)}`, { tenancyId: mueller.id, date: '2024-06-28', amountCents: 12345, note: 'Nachzahlung NK 2023' })
})
// Abschluss 2023 (verschickt), 2024 abschließen und wieder öffnen (Verlauf)
ids.closeA2023 = await step('A 2023 abschließen', () => closeSettlement(A, '2023', '2024-05-10'))
ids.closeA2024 = await step('A 2024 abschließen', () => closeSettlement(A, '2024', '2025-04-30'))
await step('A 2024 wieder öffnen', () => api.del(`/api/settlement/2024/close${q(A)}`))

// =====================================================================================================
// B: Haus mit Wechsel des Abrechnungszeitraums (Kalenderjahr → 01.07.–30.06. ab 2025-07), aufgeteilte Rechnungen
// =====================================================================================================
const B = (await api.post('/api/properties', { name: 'Am Mühlbach 3', kind: 'mfh', address: 'Am Mühlbach 3, 34567 Beispielhausen', state: 'NI' })).id
ids.B = B
const unitB = (b) => api.post(`/api/units${q(B)}`, { participates: true, ...b })
const b1 = await unitB({ name: 'Whg. 1', areaM2: 81, rooms: 3 })
const b2 = await unitB({ name: 'Whg. 2', areaM2: 64.4, rooms: 2 })
const b3 = await unitB({ name: 'Whg. 3', areaM2: 92.6, rooms: 4 })
const tenB = (b) => api.post(`/api/tenancies${q(B)}`, { prepaymentOverrides: {}, end: null, ...b })
const tb1 = await tenB({ unitId: b1.id, tenantName: 'Hoffmann, Klaus', start: '2021-05-01', personHistory: [{ from: '2021-05-01', persons: 2 }], prepayments: [{ from: '2021-05', monthlyCents: 19500 }], baseRents: [{ from: '2021-05', monthlyCents: 64000 }] })
const tb2 = await tenB({ unitId: b2.id, tenantName: 'Lange, Mia', start: '2023-02-01', end: '2025-09-30', personHistory: [{ from: '2023-02-01', persons: 1 }], prepayments: [{ from: '2023-02', monthlyCents: 15500 }], baseRents: [{ from: '2023-02', monthlyCents: 51000 }] })
const tb3 = await tenB({ unitId: b3.id, tenantName: 'Familie Krüger', start: '2016-10-01', personHistory: [{ from: '2016-10-01', persons: 4 }], prepayments: [{ from: '2016-10', monthlyCents: 24000 }, { from: '2025-07', monthlyCents: 26000 }], baseRents: [{ from: '2016-10', monthlyCents: 79000 }] })
const tb2n = await tenB({ unitId: b2.id, tenantName: 'Brandt, Ole', start: '2025-11-01', personHistory: [{ from: '2025-11-01', persons: 2 }], prepayments: [{ from: '2025-11', monthlyCents: 17000 }], baseRents: [{ from: '2025-11', monthlyCents: 55000 }] })
ids.tenB = { hoffmann: tb1.id, lange: tb2.id, krueger: tb3.id, brandt: tb2n.id }
await step('B Zahlungen', async () => {
  for (const [t, from, to, c] of [[tb1.id, '2024-01', '2026-06', 83500], [tb2.id, '2024-01', '2025-09', 66500], [tb3.id, '2024-01', '2025-06', 103000], [tb3.id, '2025-07', '2026-06', 105000], [tb2n.id, '2025-11', '2026-06', 72000]]) {
    for (const m of months(from, to)) if (m <= '2026-10') await api.post(`/api/payments${q(B)}`, { tenancyId: t, date: `${m}-01`, amountCents: c })
  }
})
const costB = (b) => api.post(`/api/costItems${q(B)}`, { vendor: '', ...b })
ids.costB = {}
for (const y of [2024, 2025]) {
  const P = `${y}-01`
  ids.costB[`grundsteuer${y}`] = (await step(`B ${y} Grundsteuer`, () => costB({ period: P, category: 'Grundsteuer', description: `Grundsteuer ${y}`, vendor: 'Gemeinde Mühlbach', amountCents: [70213, 70213][y - 2024], key: 'area' })))?.id
  ids.costB[`muell${y}`] = (await step(`B ${y} Müll`, () => costB({ period: P, category: 'Müllabfuhr', description: 'Abfallgebühren', vendor: 'Landkreis', amountCents: [43170, 45588][y - 2024], key: 'persons' })))?.id
  ids.costB[`wasser${y}`] = (await step(`B ${y} Wasser`, () => costB({ period: P, category: 'Wasser/Abwasser', description: 'Wasser und Abwasser', vendor: 'Wasserverband', amountCents: [98741, 104229][y - 2024], key: 'persons' })))?.id
}
// Aufgeteilte Rechnungen im Kalenderjahr (Leistungszeitraum über zwei Jahre)
const split = (b) => api.post(`/api/costItems/split${q(B)}`, { vendor: '', ...b })
const vers = await step('B Split Versicherung 10/24–09/25', () => split({ period: '2024-01', category: 'Sach- und Haftpflichtversicherung', description: 'Gebäudeversicherung', vendor: 'Nordversicherung', amountCents: 138640, key: 'area', serviceFrom: '2024-10-01', serviceTo: '2025-09-30', paidOn: '2024-10-02', confirmPaidOn: true }))
ids.splitVers = vers?.map((c) => ({ id: c.id, period: c.period, amountCents: c.amountCents, description: c.description }))
const rwm = await step('B Split Rauchwarnmelder 07/24–06/25 mit §35a', () => split({ period: '2024-01', category: 'Sonstige Betriebskosten', description: 'Wartung Rauchwarnmelder', vendor: 'Brandschutz Nord', amountCents: 21777, labor35aCents: 15001, key: 'area', serviceFrom: '2024-07-01', serviceTo: '2025-06-30' }))
ids.splitRwm = rwm?.map((c) => ({ id: c.id, period: c.period, amountCents: c.amountCents }))
const garten = await step('B Split Gartenpflege 03/25–02/26', () => split({ period: '2025-01', category: 'Gartenpflege', description: 'Gartenpflege Jahresvertrag', vendor: 'Grünzeug GbR', amountCents: 186000, key: 'area', serviceFrom: '2025-03-01', serviceTo: '2026-02-28' }))
ids.splitGarten = garten?.map((c) => ({ id: c.id, period: c.period, amountCents: c.amountCents }))
const strasse = await step('B Split Straßenreinigung 04/24–03/25', () => split({ period: '2024-01', category: 'Straßenreinigung', description: 'Straßenreinigung', vendor: 'Gemeinde Mühlbach', amountCents: 9999, key: 'area', serviceFrom: '2024-04-01', serviceTo: '2025-03-31' }))
ids.splitStrasse = strasse?.map((c) => ({ id: c.id, period: c.period, amountCents: c.amountCents }))
// Einzelbeträge aufteilen: in 0.13.1 abgelehnt (#454)
await step('B Split mit Einzelbeträgen', () => split({ period: '2024-01', category: 'Wasser/Abwasser', description: 'Wasser laut Ablesedienst', amountCents: 30000, key: 'amounts', tenancyAmounts: { [tb1.id]: 10000, [tb3.id]: 20000 }, serviceFrom: '2024-07-01', serviceTo: '2025-06-30' }), { expectFail: true })
// Beleg zum Teil 2025 der Versicherung hochladen und verknüpfen (nur an diesem Teil)
const versBeleg = await step('B Beleg Versicherung hochladen', () => upload('Nordversicherung Beitragsrechnung 2024-2025.pdf', 'Nordversicherung Beitragsrechnung 01.10.2024-30.09.2025 1.386,40 EUR', B, 2024))
ids.versBeleg = versBeleg
const vers2025 = vers?.find((c) => c.period === '2025-01')
if (versBeleg && vers2025) await step('B Beleg an Versicherungsteil 2025', () => api.put(`/api/costItems/${vers2025.id}${q(B)}`, { invoiceFile: versBeleg }))
// Ein Teil berichtigt (Betrag), ein Teil gelöscht
const rwm2024 = rwm?.find((c) => c.period === '2024-01')
if (rwm2024) await step('B Rauchwarnmelder Teil 2024 berichtigt', () => api.put(`/api/costItems/${rwm2024.id}${q(B)}`, { amountCents: rwm2024.amountCents + 119 }))
const garten2026 = garten?.find((c) => c.period === '2026-01')
if (garten2026) await step('B Gartenpflege Teil 2026 gelöscht', () => api.del(`/api/costItems/${garten2026.id}${q(B)}`))
// Zwei gleiche Rechnungen ohne Leistungszeitraum (Doppelungs-Hinweis)
await step('B 2025 doppelte Position 1', () => costB({ period: '2025-01', category: 'Schornsteinfeger', description: 'Feuerstättenschau', vendor: 'Bezirksschornsteinfeger', amountCents: 8925, key: 'area' }))
await step('B 2025 doppelte Position 2', () => costB({ period: '2025-01', category: 'Schornsteinfeger', description: 'Feuerstättenschau', vendor: 'Bezirksschornsteinfeger', amountCents: 8925, key: 'area' }))

// Wechsel des Rhythmus in 0.13.1: ab 2025-07 Juli bis Juni
async function changePeriod(P, rules, label) {
  const preview = await step(`${label}: Vorschau`, () => api.post(`/api/properties/${P}/period/preview`, { rules }))
  if (!preview) return null
  fs.writeFileSync(`${outFile}.${label.replace(/\W+/g, '_')}.preview.json`, JSON.stringify(preview, null, 1))
  const groups = Object.fromEntries((preview.groups ?? []).map((g) => [g.id, g.suggested]))
  const res = await step(`${label}: anwenden`, () => api.put(`/api/properties/${P}/period`, { rules, answers: { token: preview.token, groups, understood: true } }))
  return { preview, res }
}
ids.change1 = Boolean(await changePeriod(B, { startMonth: 1, changes: ['2025-07'] }, 'B Wechsel 0.13.1'))
// Kosten im neuen Zeitraum 2025-07 (Jul 2025–Jun 2026, Jahr der Zahlung nötig)
ids.costB.grundsteuer2025_07 = (await step('B 2025/26 Grundsteuer', () => costB({ period: '2025-07', category: 'Grundsteuer', description: 'Grundsteuer 2025/2026', vendor: 'Gemeinde Mühlbach', amountCents: 70213, key: 'area', taxYear: 2025 })))?.id
ids.costB.muell2025_07 = (await step('B 2025/26 Müll', () => costB({ period: '2025-07', category: 'Müllabfuhr', description: 'Abfallgebühren', vendor: 'Landkreis', amountCents: 46021, key: 'persons', taxYear: 2026 })))?.id
await step('B Split Versicherung 10/25–09/26 nach Wechsel', () => split({ period: '2025-07', category: 'Sach- und Haftpflichtversicherung', description: 'Gebäudeversicherung', vendor: 'Nordversicherung', amountCents: 145531, key: 'area', serviceFrom: '2025-10-01', serviceTo: '2026-09-30', taxYear: 2026, paidOn: '2025-10-02', confirmPaidOn: true }))
// Gutschrift aufgeteilt erst nach dem Wechsel: Vorher blockierte sie ihn (Befund: settleOperatingPowerLinks prüft jede negative Position)
const gut = await step('B Split Gutschrift Versicherung 10/25–09/26', () => split({ period: '2025-07', category: 'Sach- und Haftpflichtversicherung', description: 'Beitragsrückerstattung Gebäudeversicherung', vendor: 'Nordversicherung', amountCents: -12345, key: 'area', serviceFrom: '2025-10-01', serviceTo: '2026-09-30', taxYear: 2026 }))
ids.splitGut = gut?.map((c) => ({ id: c.id, period: c.period, amountCents: c.amountCents }))
// Abschluss des Rumpfzeitraums 2025-01 (verschickt)
ids.closeB = await step('B Rumpf 2025-01 abschließen', () => closeSettlement(B, '2025-01', '2025-11-20'))

// =====================================================================================================
// C: Zweifamilienhaus mit eigener Heizkostenabrechnung nach HeizkostenV
// =====================================================================================================
const C = (await api.post('/api/properties', { name: 'Lerchenweg 14', kind: 'mfh', address: 'Lerchenweg 14, 34567 Beispielhausen', state: 'HE' })).id
ids.C = C
const c1 = await api.post(`/api/units${q(C)}`, { name: 'Erdgeschoss', areaM2: 95, participates: true })
const c2 = await api.post(`/api/units${q(C)}`, { name: 'Obergeschoss', areaM2: 88, participates: true })
const tc1 = await api.post(`/api/tenancies${q(C)}`, { unitId: c1.id, tenantName: 'Schröder, Eva', start: '2020-06-01', end: null, personHistory: [{ from: '2020-06-01', persons: 2 }], prepayments: [{ from: '2020-06', monthlyCents: 29000 }], prepaymentOverrides: {}, baseRents: [{ from: '2020-06', monthlyCents: 82000 }] })
const tc2 = await api.post(`/api/tenancies${q(C)}`, { unitId: c2.id, tenantName: 'Yilmaz, Can', start: '2023-01-01', end: null, personHistory: [{ from: '2023-01-01', persons: 3 }], prepayments: [{ from: '2023-01', monthlyCents: 27500 }], prepaymentOverrides: {}, baseRents: [{ from: '2023-01', monthlyCents: 76000 }] })
ids.tenC = { schroeder: tc1.id, yilmaz: tc2.id }
const plantC = await step('C: Heizanlage', async () => (await api.post(`/api/heating-plants${q(C)}`, { energy: 'gas', method: 'manual', name: 'Gastherme Keller' })).plant)
ids.plantC = plantC?.id
const gasC = await step('C 2025 Gas', () => api.post(`/api/costItems${q(C)}`, { period: '2025-01', category: 'Heizung und Warmwasser', description: 'Erdgas 2025', vendor: 'Gasversorger Süd', amountCents: 412377, key: 'area', heatingPlantId: plantC?.id }))
const wartC = await step('C 2025 Wartung', () => api.post(`/api/costItems${q(C)}`, { period: '2025-01', category: 'Heizung und Warmwasser', description: 'Wartung Therme', vendor: 'Heizungsbau Klein', amountCents: 23681, key: 'area', heatingPlantId: plantC?.id }))
let selfC
if (plantC && gasC && wartC) {
  selfC = await step('C eigene Abrechnung einrichten', () => api.put(`/api/heating-plants/${plantC.id}/self${q(C)}`, {
    period: '2025-01', heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'notApplies', hotWater: 'combined', capture: 'heatMeter', dhwHeatMeter: false, totalHeatMeter: false,
    items: [{ id: gasC.id, heatingPart: 'fuel', heatingTarget: 'both' }, { id: wartC.id, heatingPart: 'operating', heatingTarget: 'both' }],
  }))
  fs.writeFileSync(`${outFile}.selfC.json`, JSON.stringify(selfC ?? null, null, 1))
  if (selfC) {
    for (const m of selfC.created ?? []) {
      const start = m.unitId === c1.id ? 18.412 : m.unitId === c2.id ? 15.903 : 0
      const used = m.unitId === c1.id ? 9.874 : m.unitId === c2.id ? 11.226 : 0
      await step(`C Ablesung ${m.name} Anfang`, () => api.post(`/api/readings${q(C)}`, { meterId: m.id, date: '2024-12-31', value: start }))
      await step(`C Ablesung ${m.name} Ende`, () => api.post(`/api/readings${q(C)}`, { meterId: m.id, date: '2025-12-31', value: Math.round((start + used) * 1000) / 1000 }))
    }
    await step('C Wärmeerzeuger allein', () => api.put(`/api/heating-plants/${plantC.id}${q(C)}`, { heatGeneration: 'single' }))
    await step('C Warmwasser Formel', () => api.put(`/api/heating-plants/${plantC.id}/periods/2025-01/hot-water${q(C)}`, { dhwMethod: 'areaFormula' }))
    const del = await step('C Lieferung Gas', () => api.post(`/api/heating-plants/${plantC.id}/deliveries${q(C)}`, { label: 'Erdgas 2025', invoiceFrom: '2025-01-01', invoiceTo: '2025-12-31', invoiceDate: '2026-01-15', energyKwh: 38200, gasBasis: 'hs', emissionsKg: 6932, co2CostCents: 45363 }))
    fs.writeFileSync(`${outFile}.deliveryC.json`, JSON.stringify(del ?? null, null, 1))
    const delId = del?.id ?? del?.delivery?.id
    if (delId) await step('C Gas mit Lieferung verknüpfen', () => api.put(`/api/costItems/${gasC.id}${q(C)}`, { fuelDeliveryId: delId }))
    await step('C CO₂ selbst', () => api.put(`/api/heating-plants/${plantC.id}/periods/2025-01/co2${q(C)}`, { method: 'self' }))
  }
}
await step('C 2025 Grundsteuer', () => api.post(`/api/costItems${q(C)}`, { period: '2025-01', category: 'Grundsteuer', description: 'Grundsteuer 2025', amountCents: 55120, key: 'area' }))
await step('C 2025 Versicherung', () => api.post(`/api/costItems${q(C)}`, { period: '2025-01', category: 'Sach- und Haftpflichtversicherung', description: 'Gebäudeversicherung', amountCents: 88219, key: 'area' }))
await step('C Zahlungen', async () => {
  for (const m of months('2025-01', '2025-12')) {
    await api.post(`/api/payments${q(C)}`, { tenancyId: tc1.id, date: `${m}-02`, amountCents: 111000 })
    await api.post(`/api/payments${q(C)}`, { tenancyId: tc2.id, date: `${m}-04`, amountCents: 103500 })
  }
})

// =====================================================================================================
// D: Vermietete Eigentumswohnung, Kosten laut Hausgeldabrechnung
// =====================================================================================================
const D = (await api.post('/api/properties', { name: 'Parkallee 21, WE 5', kind: 'etw', address: 'Parkallee 21, 34567 Beispielhausen', state: 'BY' })).id
ids.D = D
const d1 = await api.post(`/api/units${q(D)}`, { name: 'WE 5, 2. OG', areaM2: 71.3, participates: true, mea: 92, rooms: 3, floor: '2. OG' })
const td = await api.post(`/api/tenancies${q(D)}`, { unitId: d1.id, tenantName: 'Fischer, Anna', start: '2022-09-01', end: null, personHistory: [{ from: '2022-09-01', persons: 1 }], prepayments: [{ from: '2022-09', monthlyCents: 23000 }], prepaymentOverrides: {}, baseRents: [{ from: '2022-09', monthlyCents: 79000 }], depositCents: 237000, depositStatus: 'erhalten' })
ids.tenD = td.id
await step('D Zahlungen', async () => { for (const m of months('2024-01', '2025-12')) await api.post(`/api/payments${q(D)}`, { tenancyId: td.id, date: `${m}-01`, amountCents: 102000 }) })
for (const y of [2024, 2025]) {
  const P = `${y}-01`
  const hg = await step(`D ${y} Hausgeld-Beleg`, () => upload(`Hausgeldabrechnung ${y} WE 5.pdf`, `Hausgeldabrechnung ${y} WE 5`, D, y))
  const ext = (b) => api.post(`/api/costItems${q(D)}`, { period: P, vendor: 'WEG-Verwaltung Sonne GmbH', invoiceFile: hg, ...b })
  await step(`D ${y} Hauswart`, () => ext({ category: 'Hauswart', description: 'Hauswart laut Hausgeldabrechnung', amountCents: [58420, 60117][y - 2024], key: 'external', externalBasis: { measure: 'mea', total: 1000, totalCents: [635000, 653446][y - 2024] } }))
  await step(`D ${y} Versicherung`, () => ext({ category: 'Sach- und Haftpflichtversicherung', description: 'Gebäudeversicherung laut Hausgeldabrechnung', amountCents: [31188, 33907][y - 2024], key: 'external', externalBasis: { measure: 'mea', total: 1000, totalCents: [339000, 368554][y - 2024] } }))
  await step(`D ${y} Heizung`, () => ext({ category: 'Heizung und Warmwasser', description: 'Heiz- und Warmwasserkosten laut Hausgeldabrechnung', amountCents: [104433, 99871][y - 2024], key: 'external', externalBasis: { measure: 'mea', total: 1000, totalCents: [1135141, 1085555][y - 2024] } }))
  await step(`D ${y} Verwalter`, () => ext({ category: 'Nicht umlagefähig', description: 'Verwaltervergütung', amountCents: [38080, 39270][y - 2024], key: 'area' }))
  await step(`D ${y} Rücklage`, () => ext({ category: 'Zuführung Erhaltungsrücklage', description: 'Zuführung Erhaltungsrücklage', amountCents: [82800, 82800][y - 2024], key: 'area' }))
  await step(`D ${y} Grundsteuer`, () => api.post(`/api/costItems${q(D)}`, { period: P, category: 'Grundsteuer', description: `Grundsteuer ${y}`, vendor: 'Stadt', amountCents: [24760, 26018][y - 2024], key: 'area' }))
}
ids.closeD = await step('D 2024 abschließen', () => closeSettlement(D, '2024', '2025-03-31'))

writeJson(outFile, { ids, log })
console.log(`Schritte: ${log.length}, Fehler: ${log.filter((l) => !l.ok && !l.expectFail).length}`)

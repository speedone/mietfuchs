// Brennstoffvorrat in der Abrechnung (Heizung PR 8, #97, #99; Entwurf 8.2, 12.2 R2, G-C5, N8, 12.3
// Nr. 1, 2, 10). Beispiel Heizöl: 300 m², drei Wohnungen à 100 m².
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, stockCarrySelfCents, taxReport, type ComputedSettlement } from '../src/calc.ts'
import type { StockDeliveryInput, StockPeriodInput } from '../src/fuelStock.ts'
import { snapshotOf, type Snapshot, type SnapshotCostItem, type SnapshotHeatingPlant, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { calendarYearPeriod, periodKey } from '../../shared/period.ts'
import type { Co2Statement } from '../../shared/types.ts'

const P = calendarYearPeriod(2025)
const unit = (id: string, over: Partial<SnapshotUnit> = {}): SnapshotUnit => ({ id, name: id, areaM2: 100, participates: true, ...over })
const tenancy = (id: string, unitId: string, over: Partial<SnapshotTenancy> = {}): SnapshotTenancy => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [], ...over,
})
const source = (s: Partial<SnapshotSource>): SnapshotSource => ({ units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [], ...s })
const plant = (over: Partial<SnapshotHeatingPlant> = {}): SnapshotHeatingPlant => ({
  id: 'hp', name: 'Öl', energy: 'oil', method: 'manual', source: 'building', devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', newDevicesInstall: null, units: null, ...over,
})
const co2 = (over: Partial<Co2Statement>): Co2Statement => ({
  heatingPeriodId: 'h', plantId: 'hp', period: P.key, method: 'selfAfterService', areaM2: null, serviceEmissionsKg: null, serviceAreaM2: null,
  serviceKgPerM2: null, serviceLandlordPermille: null, serviceTotalCents: null, serviceLandlordCents: null, serviceUsersTotalCents: null,
  serviceUsersTotalApprox: false, serviceUnitsCount: null, serviceCostItemId: null, serviceSelfLandlordCents: null, serviceFuelGrossCents: null,
  serviceFuelNetCents: null, reliefs: [], ...over,
})
const lieferung = (id: string, date: string, quantity: number, costCents: number | null, emissionsKg: number, co2Cents: number): StockDeliveryInput => ({
  id, label: `Lieferung vom ${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`, date, invoiceDate: date, quantity, quantityUnit: 'l', costCents, emissionsKg, co2Cents,
})
// Beispiel Heizöl (Entwurf 8.2).
const VORRAT = (over: Partial<StockPeriodInput> = {}, cost = true): StockPeriodInput => ({
  key: P.key, label: '2025', from: P.from, to: P.to, unit: 'l',
  ownOpening: { quantity: 2000, costCents: 190000, emissionsKg: 5352.6, co2Cents: 0, invoicedBefore2023: true },
  closingQuantity: 1800, closingMeasuredOn: '2025-12-31',
  deliveries: [lieferung('d1', '2025-03-15', 3000, cost ? 315000 : null, 8028.9, 52549), lieferung('d2', '2025-10-10', 2500, cost ? 250000 : null, 6690.75, 43791)],
  laterDeliveries: [], frozenClosing: null, ...over,
})
const drei = { units: ['a', 'b', 'c'].map((u) => unit(u)), tenancies: ['a', 'b', 'c'].map((u) => tenancy(`t${u}`, u)) }
const snap = (s: Partial<SnapshotSource>, p: SnapshotHeatingPlant, chain: StockPeriodInput[], statements: Co2Statement[] = []): Snapshot =>
  ({ ...snapshotOf(source(s), 2025), heatingPlants: [p], co2Statements: statements, stockChains: [{ plantId: 'hp', period: P.key, chain }] })
const codes = (r: ComputedSettlement): string[] => r.notices.map((n) => n.code)
const textOf = (r: ComputedSettlement, code: string): string =>
  r.notices.find((n) => n.code === code)?.text ?? assert.fail(`kein Hinweis ${code}, sondern: ${codes(r).join(', ')}`)
const reliefRows = (r: ComputedSettlement): [string, number][] =>
  r.statements.flatMap((st) => st.rows.filter((row) => row.kind === 'co2Relief').map((row): [string, number] => [st.tenancyId, row.shareCents]))
// Was die Mieter an Heizkosten tragen, ohne die Abzugszeilen der CO₂-Aufteilung (Ruling: Der Plan
// verglich die ganze Summe; der CO₂-Abzug ist eine eigene Zeile und gehört nicht zum Brennstoff).
const heatingCostsOf = (r: ComputedSettlement): number =>
  r.statements.reduce((a, st) => a + st.rows.filter((row) => row.kind !== 'co2Relief').reduce((b, row) => b + row.shareCents, 0), 0)
const co2ShareOf = (r: ComputedSettlement): number =>
  r.landlord.rows.flatMap((row) => row.landlordParts ?? []).filter((p) => p.reason === 'co2Share').reduce((a, p) => a + p.cents, 0)

// Der Messdienst hat aus seiner Bestandsrechnung 5.750 € Brennstoff verteilt; die Einzelbeträge der
// Mieter sind erfunden, ihre Summe stammt aus dem Beispiel.
const MESSDIENST: SnapshotCostItem = {
  id: 'hz', period: P.key, category: HEATING_CATEGORY, description: 'Heizung laut Messdienst', amountCents: 575000, key: 'amounts',
  tenancyAmounts: { ta: 230000, tb: 172500, tc: 172500 }, heatingPlantId: 'hp',
}
const service = plant({ method: 'service' })
const nichtAufgeteilt = [co2({ method: 'selfAfterService' })]

test('Messdienst ohne Aufteilung, Heizöl mit Vorrat (Entwurf 8.2, 7.6): E 15.254,91 kg → 50,8 → 80 %, C 648,10 €, L 518,48 € nach dem Anteil an den Messdienstbeträgen', () => {
  const r = computeSettlement(snap({ ...drei, costItems: [MESSDIENST] }, service, [VORRAT({}, false)], nichtAufgeteilt))
  assert.ok(!codes(r).some((c) => c.startsWith('fuel.stock')), codes(r).join(', '))
  assert.ok(!codes(r).includes('co2.service-unsplit'))
  // 518,48 € × Betrag / 5.750 €: 207,392 / 155,544 / 155,544; der Restcent geht an tb (Gleichstand, Kennung).
  assert.deepEqual(reliefRows(r), [['ta', -20739], ['tb', -15555], ['tc', -15554]])
  assert.equal(co2ShareOf(r), 51848)
  const h = r.heating?.[0] ?? assert.fail('keine Heizanlage in der Abrechnung')
  assert.deepEqual([h.co2?.kgPerM2, h.co2?.stage?.landlordPercent, h.co2?.landlordCents], [50.8, 80, 51848])
  assert.deepEqual([h.stock?.consumed.emissionsKg, h.stock?.consumed.co2Cents, h.stock?.closing.co2Cents], [15254.91, 64810, 31530])
  assert.ok(r.legalBasis.values?.some((v) => v.id === 'co2.costs-before'), 'der Stichtag des § 11 Abs. 2 Satz 2 friert mit ein')
  // Altbestand mit Rechnung 2022 hebt die Stufe ohne CO₂-Kosten (D-H6).
  assert.match(textOf(r, 'fuel.before-2023'), /5\.352,6 kg CO₂ des verbrauchten Brennstoffs stammen aus Brennstoff, der vor dem 01\.01\.2023 in Rechnung gestellt wurde/)
})

test('Messdienst ohne Aufteilung: Vorrat fehlt → fuel.stock-missing mit 3 % je Mieter statt co2.service-unsplit; geht nicht auf → fuel.stock-invalid', () => {
  const fehlt = computeSettlement(snap({ ...drei, costItems: [MESSDIENST] }, service, [VORRAT({ closingQuantity: null }, false)], nichtAufgeteilt))
  const n = fehlt.notices.find((x) => x.code === 'fuel.stock-missing') ?? assert.fail(codes(fehlt).join(', '))
  assert.deepEqual([n.level, n.subject], ['warning', { kind: 'heatingCosts', id: 'hp' }])
  assert.match(n.text, /Für die Bestandsrechnung \(Heizperiode 2025\) fehlt: der Endbestand\./)
  assert.match(n.text, /um 3 % kürzen \(§ 7 Abs\. 4 CO2KostAufG\), hier: ta \(a\) 69,00 €, tb \(b\) 51,75 € und tc \(c\) 51,75 €/)
  assert.ok(!codes(fehlt).includes('co2.service-unsplit'))
  assert.deepEqual(reliefRows(fehlt), [])
  const kaputt = computeSettlement(snap({ ...drei, costItems: [MESSDIENST] }, service, [VORRAT({ closingQuantity: 9000 }, false)], nichtAufgeteilt))
  assert.equal(kaputt.notices.find((x) => x.code === 'fuel.stock-invalid')?.level, 'error')
  assert.deepEqual(reliefRows(kaputt), [])
})

test('Wer nichts zum Vorrat erfasst hat, merkt nichts: ohne Zeile und ohne Lieferung wie vor PR 8 (co2.service-unsplit)', () => {
  const leer: StockPeriodInput = { ...VORRAT(), unit: null, ownOpening: null, closingQuantity: null, closingMeasuredOn: null, deliveries: [] }
  const r = computeSettlement(snap({ ...drei, costItems: [MESSDIENST] }, service, [leer], nichtAufgeteilt))
  assert.ok(codes(r).includes('co2.service-unsplit'))
  assert.ok(!codes(r).some((c) => c.startsWith('fuel.')))
  assert.ok(!r.legalBasis.values?.some((v) => v.id === 'co2.costs-before'))
})

test('Peilung neben dem Ende (Review Focus 1): Hinweis mit Tagen, Gradtagsanteil und Lieferung; gerechnet wie gepeilt', () => {
  const spaet = computeSettlement(snap({ ...drei, costItems: [MESSDIENST] }, service, [VORRAT({ closingMeasuredOn: '2026-01-05', laterDeliveries: [{ label: 'Lieferung vom 02.01.2026', date: '2026-01-02' }] }, false)], nichtAufgeteilt))
  const t = textOf(spaet, 'fuel.stock-date-differs')
  // 5 Tage im Januar: 5 × 170 / 31 = 27,4 ‰ (Entwurf 3.5).
  assert.match(t, /Der Tank wurde am 05\.01\.2026 gepeilt, die Heizperiode endete am 31\.12\.2025: 5 Tage, 27,4 ‰ der Gradtage dazwischen\. Mietfuchs rechnet mit dem Wert wie gepeilt\./)
  assert.match(t, /„Lieferung vom 02\.01\.2026“ ist im gepeilten Endbestand schon enthalten/)
  assert.equal(spaet.heating?.[0]?.stock?.consumed.quantity, 5700)
  const frueh = computeSettlement(snap({ ...drei, costItems: [MESSDIENST] }, service, [VORRAT({ closingMeasuredOn: '2025-12-20' }, false)], nichtAufgeteilt))
  assert.match(textOf(frueh, 'fuel.stock-date-differs'), /am 20\.12\.2025 gepeilt, die Heizperiode endet am 31\.12\.2025: 11 Tage/)
})
// ---------- Freie Schlüssel: Kosten nach Verbrauch (R2, Entwurf 8.2) ----------

const oel = plant()
const rechnung = (id: string, amountCents: number, fuelDeliveryId: string | null, over: Partial<SnapshotCostItem> = {}): SnapshotCostItem => ({
  id, period: P.key, category: HEATING_CATEGORY, description: id, amountCents, key: 'area', heatingPlantId: 'hp', heatingPart: 'fuel', fuelDeliveryId, ...over,
})
const RECHNUNGEN = [rechnung('r1', 315000, 'd1'), rechnung('r2', 250000, 'd2')]
const shareOf = (r: ComputedSettlement, tenancyId: string, itemId: string): number =>
  r.statements.find((st) => st.tenancyId === tenancyId)?.rows.find((row) => row.costItemId === itemId)?.shareCents ?? assert.fail(`keine Zeile ${itemId} bei ${tenancyId}`)
const KEY = `stock:hp:${P.key}`

test('R2: Mieter tragen 5.750 € nach Verbrauch, Übertrag „aus dem Vorrat“ +1.900 € und „im Vorrat“ −1.800 €, Gegenzeile beim Vermieter −100 €', () => {
  const r = computeSettlement(snap({ ...drei, costItems: RECHNUNGEN }, oel, [VORRAT()]))
  assert.equal(heatingCostsOf(r), 575000)
  for (const t of ['ta', 'tb', 'tc']) {
    assert.equal(shareOf(r, t, `${KEY}:in`), 63333 + (t === 'ta' ? 1 : 0))
    assert.equal(shareOf(r, t, `${KEY}:out`), -60000)
  }
  const zeile = r.statements[0]?.rows.find((row) => row.costItemId === `${KEY}:in`) ?? assert.fail('kein Übertrag')
  assert.deepEqual([zeile.kind, zeile.description, zeile.category], ['fuelCarry', 'Heizöl aus dem Vorrat', HEATING_CATEGORY])
  assert.equal(r.statements[0]?.rows.find((row) => row.costItemId === `${KEY}:out`)?.description, 'Heizöl im Vorrat')
  const gegen = r.landlord.rows.find((row) => row.costItemId === KEY) ?? assert.fail('keine Gegenzeile')
  assert.deepEqual([gegen.shareCents, gegen.landlordParts], [-10000, [{ reason: 'fuelCarry', cents: -10000 }]])
  // Σ aller Zeilen = Σ der Positionen (Entwurf 12.3 Nr. 1); die Gesamtkosten sind die Rechnungen.
  assert.equal(r.statements.reduce((a, st) => a + st.totalShareCents, 0) + r.landlord.totalCents, 565000)
  assert.equal(r.totalCostsCents, 565000)
  // CO₂ nach dem verbrauchten Brennstoff: x_t aus Rechnungen und Überträgen, L = 518,48 €.
  assert.equal(co2ShareOf(r), 51848)
  assert.deepEqual(reliefRows(r).map(([, c]) => c).reduce((a, c) => a + c, 0), -51848)
  assert.ok(!codes(r).some((c) => c === 'fuel.manual-by-delivery' || c === 'cost.possible-duplicate'))
})

test('Steuer (G-C5, N8): privat nach Bezahltem 1.883,33 €, Abrechnung mit Übertrag rund 1.916,67 €; die Steuerseite kennt den Abstand', () => {
  const s = snap({ units: [unit('a'), unit('b'), unit('c', { participates: false, selfUsed: true, selfPersons: 1 })], tenancies: [tenancy('ta', 'a'), tenancy('tb', 'b')], costItems: RECHNUNGEN }, oel, [VORRAT()])
  const r = computeSettlement(s)
  // Exakt (5.650 + 100) / 3 = 1.916,67 €; je Position gerundet, Restcent bei Gleichstand an den Vermieter (#202).
  assert.ok(Math.abs(r.selfUsedShareCents - 191666.67) < 2, String(r.selfUsedShareCents))
  const tax = taxReport(s)
  const privat = tax.expenses.items.filter((x) => x.costItemId === 'r1' || x.costItemId === 'r2').reduce((a, x) => a + x.privateCents, 0)
  assert.ok(Math.abs(privat - 188333.33) < 1, String(privat))
  assert.ok(!tax.expenses.items.some((x) => x.costItemId.startsWith('stock:')), 'Überträge sind keine Werbungskosten (12.3 Nr. 10)')
  assert.equal(tax.expenses.stockCarrySelfCents, stockCarrySelfCents(r))
  // Der Abstand ist der Eigenanteil an den Überträgen, bis auf die Rundung der Positionen.
  assert.ok(Math.abs(stockCarrySelfCents(r) - (r.selfUsedShareCents - privat)) <= 1)
})

test('Ohne Bestand: nach Lieferung wie bisher, fuel.manual-by-delivery nennt beide Folgen; ohne Vorratsenergie nichts', () => {
  const ohne = computeSettlement(snap({ ...drei, costItems: RECHNUNGEN }, oel, [VORRAT({ closingQuantity: null })]))
  const n = ohne.notices.find((x) => x.code === 'fuel.manual-by-delivery') ?? assert.fail(codes(ohne).join(', '))
  assert.equal(n.level, 'warning')
  assert.match(n.text, /fehlt: der Endbestand\. Mietfuchs verteilt die Brennstoffrechnungen deshalb, wie sie sind, nach ihrem Schlüssel\./)
  assert.match(n.text, /eine Abrechnung nach Lieferungen ist angreifbar \(BGH VIII ZR 156\/11\)/)
  assert.match(n.text, /Auch die CO₂-Einstufung beruht dann auf den gelieferten statt den verbrauchten kg \(§ 5 Abs\. 1 CO2KostAufG\)/)
  assert.equal(heatingCostsOf(ohne), 565000)
  assert.ok(!ohne.statements.some((st) => st.rows.some((row) => row.kind === 'fuelCarry')))
  // Pellets: keine CO₂-Aufteilung, also auch kein Satz zur Einstufung.
  assert.doesNotMatch(textOf(computeSettlement(snap({ ...drei, costItems: RECHNUNGEN }, plant({ energy: 'pellets' }), [VORRAT({ closingQuantity: null })])), 'fuel.manual-by-delivery'), /CO₂-Einstufung/)
  // Endbestand größer als alles: ein Fehler, verteilt wird wie geliefert.
  const kaputt = computeSettlement(snap({ ...drei, costItems: RECHNUNGEN }, oel, [VORRAT({ closingQuantity: 9000 })]))
  assert.equal(kaputt.notices.find((x) => x.code === 'fuel.stock-invalid')?.level, 'error')
  assert.equal(heatingCostsOf(kaputt), 565000)
})

test('Jahr ohne Lieferung (Review Focus 4): Verbrauch aus dem Vorrat nach dem Schlüssel der Brennstoffposition der Vorperiode; ohne jede Brennstoffposition fuel.manual-by-delivery', () => {
  const vorjahr = VORRAT()
  const jahr: StockPeriodInput = { ...VORRAT(), key: periodKey('2026-01'), label: '2026', from: '2026-01-01', to: '2026-12-31', ownOpening: null, deliveries: [], closingQuantity: 900, closingMeasuredOn: '2026-12-31' }
  const P26 = calendarYearPeriod(2026)
  const basis = snapshotOf(source({ ...drei, costItems: [] }), 2026)
  const mitVorjahr = computeSettlement({
    ...basis, heatingPlants: [oel], co2Statements: [], stockChains: [{ plantId: 'hp', period: P26.key, chain: [vorjahr, jahr] }],
    previousCostItems: [rechnung('r2', 250000, 'd2', { key: 'persons' })],
  })
  const ta = mitVorjahr.statements.find((st) => st.tenancyId === 'ta')?.rows.find((row) => row.costItemId === `stock:hp:${P26.key}:in`)
  assert.deepEqual([ta?.key, ta?.totalCents], ['persons', 180000])
  assert.equal(heatingCostsOf(mitVorjahr), 90000)
  const ohneSchluessel = computeSettlement({ ...basis, heatingPlants: [oel], co2Statements: [], stockChains: [{ plantId: 'hp', period: P26.key, chain: [vorjahr, jahr] }] })
  assert.match(textOf(ohneSchluessel, 'fuel.manual-by-delivery'), /gibt es keinen Schlüssel: In dieser Heizperiode und der vorigen steht keine Brennstoffposition/)
})

// Fester Startwert: jeder Lauf prüft dieselben Bestände.
function zufall(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

test('Invarianten (Entwurf 12.3 Nr. 1, 2, 10): Summe über die Gegenzeile, je Zeile ≤ 1 ct, Überträge nie in der Steuer', () => {
  const rnd = zufall(20261005)
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))
  for (let lauf = 0; lauf < 200; lauf++) {
    const n = int(1, 4)
    const units = Array.from({ length: n }, (_, i) => unit(`u${i}`, { areaM2: int(30, 120) }))
    if (rnd() < 0.4) units.push(unit('eigen', { participates: false, selfUsed: true, selfPersons: 1, areaM2: int(30, 120) }))
    if (rnd() < 0.4) units.push(unit('leer', { areaM2: int(30, 120) }))
    const tenancies = units.filter((u) => u.participates && u.id !== 'leer').map((u) => tenancy(`t-${u.id}`, u.id))
    const q0 = int(0, 3000)
    const deliveries = Array.from({ length: int(0, 2) }, (_, k) => {
      const q = int(500, 4000)
      return lieferung(`d${k}`, `2025-0${k + 3}-15`, q, q * int(80, 130), Math.round(q * 267.63) / 100, int(5000, 60000))
    })
    const total = q0 + deliveries.reduce((a, d) => a + (d.quantity ?? 0), 0)
    const chain = [VORRAT({ ownOpening: { quantity: q0, costCents: q0 * int(80, 120), emissionsKg: Math.round(q0 * 267.6) / 100, co2Cents: 0, invoicedBefore2023: true }, deliveries, closingQuantity: int(0, total) })]
    const items = deliveries.map((d) => rechnung(`r-${d.id}`, d.costCents ?? 0, d.id))
    const s = snap({ units, tenancies, costItems: items }, oel, chain)
    const r = computeSettlement(s)
    const fall = `Lauf ${lauf}: ${JSON.stringify({ n, q0, total })}`
    const positions = items.reduce((a, c) => a + c.amountCents, 0)
    // Nr. 1: Σ aller Zeilen = Σ der Positionen, über die Gegenzeile fuelCarry.
    assert.equal(r.statements.reduce((a, st) => a + st.totalShareCents, 0) + r.landlord.totalCents, positions, fall)
    // Nr. 2: Mieterzeilen der Überträge dürfen negativ sein; alle übrigen nicht bei positiven Kosten.
    for (const st of r.statements) for (const row of st.rows) if (row.kind !== 'fuelCarry' && row.kind !== 'co2Relief') assert.ok(row.shareCents >= 0, `${fall}: ${row.costItemId}`)
    // Nr. 10: Überträge nie in der Steuerübersicht, jede Position genau einmal.
    const tax = taxReport(s)
    assert.ok(!tax.expenses.items.some((x) => x.costItemId.startsWith('stock:')), fall)
    assert.deepEqual(tax.expenses.items.map((x) => x.costItemId).filter((id) => id.startsWith('r-')).sort(), items.map((c) => c.id).sort(), fall)
  }
})

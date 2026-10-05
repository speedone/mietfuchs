// CO₂ beim Messdienst in der Berechnung (Heizung PR 6, #97, #209; Entwurf 7, 12.2, 12.3). Die
// Beispiele A, B und C, die Rechenfehler der ersten Fassung (G-B2, G-B3), die Irrtümer der Probe
// (7.3), die benannte Lücke, eine Gutschrift im Topf und die Eigentumswohnung stehen je als Test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, taxReport, type ComputedSettlement } from '../src/calc.ts'
import { snapshotFor, snapshotOf, type Snapshot, type SnapshotCostItem, type SnapshotHeatingPlant, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { calendarPeriod, periodKey, periodOfKey } from '../../shared/period.ts'
import type { Co2Statement, LandlordPart } from '../../shared/types.ts'

const P = calendarPeriod(2025)
const unit = (id: string, over: Partial<SnapshotUnit> = {}): SnapshotUnit => ({ id, name: id, areaM2: 50, participates: true, ...over })
const own = (id: string): SnapshotUnit => unit(id, { participates: false, selfUsed: true, selfPersons: 1 })
const tenancy = (id: string, unitId: string, over: Partial<SnapshotTenancy> = {}): SnapshotTenancy => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [], ...over,
})
const messdienst = (amountCents: number, tenancyAmounts: Record<string, number>, over: Partial<SnapshotCostItem> = {}): SnapshotCostItem => ({
  id: 'hz', period: P, category: HEATING_CATEGORY, description: 'Heizung und Warmwasser laut Messdienst', amountCents, key: 'amounts', tenancyAmounts,
  heatingPlantId: 'hp', ...over,
})
const plant = (over: Partial<SnapshotHeatingPlant> = {}): SnapshotHeatingPlant => ({
  id: 'hp', name: 'Gas', energy: 'gas', method: 'service', source: 'building', devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', newDevicesInstall: null, units: null, ...over,
})
const co2 = (over: Partial<Co2Statement>): Co2Statement => ({
  heatingPeriodId: 'h', plantId: 'hp', period: P, method: 'serviceDeducted', areaM2: null, serviceEmissionsKg: null, serviceAreaM2: null,
  serviceKgPerM2: null, serviceLandlordPermille: null, serviceTotalCents: null, serviceLandlordCents: null, serviceUsersTotalCents: null,
  serviceUsersTotalApprox: false, serviceUnitsCount: null, serviceCostItemId: null, serviceSelfLandlordCents: null, serviceFuelGrossCents: null,
  serviceFuelNetCents: null, reliefs: [], ...over,
})
const source = (s: Partial<SnapshotSource>): SnapshotSource => ({
  units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [], ...s,
})
const snap = (s: Partial<SnapshotSource>, statements: Co2Statement[], plants: SnapshotHeatingPlant[] = [plant()]): Snapshot =>
  ({ ...snapshotOf(source(s), 2025), heatingPlants: plants, co2Statements: statements })
const settle = (s: Partial<SnapshotSource>, statements: Co2Statement[], plants?: SnapshotHeatingPlant[]): ComputedSettlement =>
  computeSettlement(snap(s, statements, plants))
const shareOf = (r: ComputedSettlement, tenancyId: string, itemId: string): number =>
  r.statements.find((st) => st.tenancyId === tenancyId)?.rows.find((row) => row.costItemId === itemId)?.shareCents ?? assert.fail(`keine Zeile ${itemId} bei ${tenancyId}`)
const partsOf = (r: ComputedSettlement, itemId = 'hz'): LandlordPart[] => r.landlord.rows.find((x) => x.costItemId === itemId)?.landlordParts ?? []
const codes = (r: ComputedSettlement): string[] => r.notices.map((n) => n.code)
const textOf = (r: ComputedSettlement, code: string): string =>
  r.notices.find((n) => n.code === code)?.text ?? assert.fail(`kein Hinweis ${code}, sondern: ${codes(r).join(', ')}`)
const taxOf = (s: Snapshot, itemId = 'hz') =>
  taxReport(s).expenses.items.find((x) => x.costItemId === itemId) ?? assert.fail(`${itemId} fehlt in der Steuerübersicht`)

// Beispiel A (Entwurf 7.4, Techem-Muster): abzüglich CO₂-Kosten Vermieter 87,50 € (250,00 € · 35 %),
// S = 3.845,51 €, Betrag 3.933,01 €. Die Aufteilung auf vier Nutzer ist erfunden, die Summe stammt
// aus dem Muster.
const TECHEM = { ta: 110327, tb: 95864, tc: 101485, td: 76875 }
const vier = { units: ['a', 'b', 'c', 'd'].map((u) => unit(u)), tenancies: ['a', 'b', 'c', 'd'].map((u) => tenancy(`t${u}`, u)) }
const techem = (over: Partial<Co2Statement> = {}): Co2Statement => co2({
  serviceUsersTotalCents: 384551, serviceLandlordCents: 8750, serviceUnitsCount: 4, serviceTotalCents: 25000, serviceLandlordPermille: 350, serviceKgPerM2: 46.4, ...over,
})

test('Beispiel A: Probe exakt, co2Share 87,50 €, kein Mieter gekürzt, Werbungskosten 3.933,01 €', () => {
  const s = { ...vier, costItems: [messdienst(393301, TECHEM)] }
  const r = settle(s, [techem()])
  for (const [t, c] of Object.entries(TECHEM)) assert.equal(shareOf(r, t, 'hz'), c)
  assert.deepEqual(partsOf(r), [{ reason: 'co2Share', cents: 8750 }])
  assert.ok(!codes(r).includes('co2.sum-check'))
  assert.ok(r.statements.every((st) => st.rows.every((row) => row.kind !== 'co2Relief')), 'beim Vorwegabzug keine Abzugszeile')
  const tax = taxOf(snap(s, [techem()]))
  assert.deepEqual([tax.amountCents, tax.privateCents, tax.deductibleCents], [393301, 0, 393301])
  const h = r.heating?.[0] ?? assert.fail('keine Heizanlage in der Abrechnung')
  assert.deepEqual([h.plantId, h.period, h.co2?.booked, h.co2?.deducted, h.co2?.stage?.landlordPercent, h.co2?.landlordCents], ['hp', P, true, true, 70, 8750])
  assert.ok(r.legalBasis.values?.some((v) => v.id === 'co2.stage-table'), 'die Stufentabelle friert mit ein')
})

test('Beispiel B: Eigennutzung, L_self exakt im Eigenanteil (620,69 €), co2Share 79,31 €; laut Messdienst 625,00 / 75,00 €', () => {
  const s = { units: [unit('a'), unit('b'), own('c')], tenancies: [tenancy('ta', 'a'), tenancy('tb', 'b')], costItems: [messdienst(300000, { ta: 120000, tb: 110000 }, { selfAmounts: { c: 60000 } })] }
  const st = co2({ serviceUsersTotalCents: 290000, serviceLandlordCents: 10000, serviceUnitsCount: 3 })
  const r = settle(s, [st])
  assert.deepEqual(partsOf(r), [{ reason: 'selfUse', cents: 62069 }, { reason: 'co2Share', cents: 7931 }])
  assert.equal(r.selfUsedShareCents, 62069)
  assert.equal(taxOf(snap(s, [st])).privateCents, 62069)
  assert.deepEqual([r.heating?.[0]?.co2?.selfLandlordCents, r.heating?.[0]?.co2?.selfApproximated], [2069, true])
  const laut = settle(s, [{ ...st, serviceSelfLandlordCents: 2500 }])
  assert.deepEqual(partsOf(laut), [{ reason: 'selfUse', cents: 62500 }, { reason: 'co2Share', cents: 7500 }])
})

test('Beispiel C: die Wohnung mit 600 € steht leer statt selbstgenutzt: co2Share 100 €, Rest 600 € (G-D2)', () => {
  const s = { units: [unit('a'), unit('b'), unit('c')], tenancies: [tenancy('ta', 'a'), tenancy('tb', 'b')], costItems: [messdienst(300000, { ta: 120000, tb: 110000 })] }
  const r = settle(s, [co2({ serviceUsersTotalCents: 290000, serviceLandlordCents: 10000, serviceUnitsCount: 3 })])
  assert.deepEqual(partsOf(r), [{ reason: 'co2Share', cents: 10000 }, { reason: 'amountsRest', cents: 60000 }])
})

test('G-B2: Rest 60 €, L_self 20 €, co2Share 80 € → L_self 20 €, co2Share 40 €, Rest 0 (erste Fassung: 12 / 48)', () => {
  // „Ich finde diese Zeile nicht“: S ist geschätzt, die Probe meldet nur einen Hinweis, gebucht wird.
  const s = { units: [unit('a'), own('c')], tenancies: [tenancy('ta', 'a')], costItems: [messdienst(300000, { ta: 294000 })] }
  const r = settle(s, [co2({ serviceUsersTotalCents: 290000, serviceUsersTotalApprox: true, serviceLandlordCents: 10000, serviceSelfLandlordCents: 2000, serviceUnitsCount: 2 })])
  assert.deepEqual(partsOf(r), [{ reason: 'selfUse', cents: 2000 }, { reason: 'co2Share', cents: 4000 }])
  assert.ok(codes(r).includes('co2.sum-check-approx'))
  assert.ok(!codes(r).includes('co2.sum-check'))
})

test('G-B3: Einzelbeträge bis S + NE · 2 ct, ein Cent mehr ist ein Fehler; Betrag ± 1 ct', () => {
  const knapp = settle({ ...vier, costItems: [messdienst(393301, { ...TECHEM, td: TECHEM.td + 8 })] }, [techem()])
  assert.ok(!codes(knapp).includes('co2.sum-check'))
  // Der Rest reicht um 8 ct nicht für L: `take` kappt den co2Share (Entwurf 7.4).
  assert.deepEqual(partsOf(knapp), [{ reason: 'co2Share', cents: 8742 }])
  const drueber = settle({ ...vier, costItems: [messdienst(393301, { ...TECHEM, td: TECHEM.td + 9 })] }, [techem()])
  assert.ok(codes(drueber).includes('co2.sum-check'))
  assert.deepEqual(partsOf(drueber), [{ reason: 'amountsRest', cents: 8741 }])
  assert.ok(!codes(settle({ ...vier, costItems: [messdienst(393302, TECHEM)] }, [techem()])).includes('co2.sum-check'))
  assert.ok(codes(settle({ ...vier, costItems: [messdienst(393303, TECHEM)] }, [techem()])).includes('co2.sum-check'))
})

test('Irrtümer der Probe (Entwurf 7.3): „Ja“ mit Betrag S, „Nein“ obwohl abgezogen; Leerstand spielt keine Rolle', () => {
  // „Ja“ bei Bruttobeträgen oder beim Nettobetrag der Position (#209): Betrag = S, verlangt S + L.
  const netto = settle({ ...vier, costItems: [messdienst(384551, TECHEM)] }, [techem()])
  const text = textOf(netto, 'co2.sum-check')
  assert.match(text, /Ihre Positionen ergeben 3\.845,51 €\. Mit Abzugszeile müssten es S \+ L = 3\.933,01 € sein, ohne Abzugszeile S = 3\.845,51 €\./)
  assert.match(text, /um 3 % kürzen \(§ 7 Abs\. 4 CO2KostAufG\), hier: ta \(a\) 33,10 €, tb \(b\) 28,76 €, tc \(c\) 30,45 € und td \(d\) 23,06 €/)
  assert.deepEqual(netto.notices.find((n) => n.code === 'co2.sum-check')?.subject, { kind: 'heatingCosts', id: 'hp' })
  assert.deepEqual(partsOf(netto), [])
  // „Nein“, obwohl abgezogen, Betrag brutto: Betrag = S + L, verlangt S.
  assert.ok(codes(settle({ ...vier, costItems: [messdienst(393301, TECHEM)] }, [techem({ method: 'serviceShown' })])).includes('co2.sum-check'))
  // Leerstand und fremde Einheiten: S umfasst ihre Beträge, eingetragen sind sie nicht.
  const leer = settle(
    { units: [...vier.units, unit('e')], tenancies: vier.tenancies, costItems: [messdienst(393301 + 50000, TECHEM)] },
    [techem({ serviceUsersTotalCents: 384551 + 50000, serviceUnitsCount: 5 })],
  )
  assert.ok(!codes(leer).includes('co2.sum-check'))
  assert.deepEqual(partsOf(leer), [{ reason: 'co2Share', cents: 8750 }, { reason: 'amountsRest', cents: 50000 }])
})

test('Die frühere Anleitung: CO₂-Anteil der eigenen Wohnung schon im Eigenbetrag → die Probe meldet es (Review Focus 1)', () => {
  const s = { units: [unit('a'), unit('b'), own('c')], tenancies: [tenancy('ta', 'a'), tenancy('tb', 'b')], costItems: [messdienst(300000, { ta: 120000, tb: 110000 }, { selfAmounts: { c: 62069 } })] }
  const r = settle(s, [co2({ serviceUsersTotalCents: 290000, serviceLandlordCents: 10000, serviceUnitsCount: 3 })])
  assert.match(textOf(r, 'co2.sum-check'), /Einzel- und Eigenbeträge ergeben zusammen 2\.920,69 €/)
  // Nichts doppelt privat: ohne Buchung bleibt der Eigenbetrag, wie er eingetragen ist.
  assert.equal(r.selfUsedShareCents, 62069)
})

test('Die benannte Lücke (Entwurf 7.4): „Nein“, obwohl abgezogen, und Betrag = S ist an der Probe nicht zu erkennen', () => {
  const r = settle({ ...vier, costItems: [messdienst(384551, TECHEM)] }, [techem({ method: 'serviceShown' })])
  assert.ok(!codes(r).includes('co2.sum-check'))
})

test('Gutschrift im Topf: zählt nicht zur Probe, wird verteilt wie bisher, Hinweis co2.pool-foreign-item (W9)', () => {
  const gutschrift: SnapshotCostItem = { id: 'gs', period: P, category: HEATING_CATEGORY, description: 'Gutschrift Versorger', amountCents: -4000, key: 'area', heatingPlantId: 'hp' }
  const r = settle({ ...vier, costItems: [messdienst(393301, TECHEM), gutschrift] }, [techem()])
  assert.ok(!codes(r).includes('co2.sum-check'))
  assert.deepEqual(partsOf(r), [{ reason: 'co2Share', cents: 8750 }])
  const n = r.notices.find((x) => x.code === 'co2.pool-foreign-item') ?? assert.fail('kein Hinweis zur Gutschrift')
  assert.deepEqual([n.level, n.subject], ['hint', { kind: 'costItem', id: 'gs' }])
  assert.equal(shareOf(r, 'ta', 'gs'), -1000)
})

test('Eigentumswohnung (F2/F3): Gemeinschaft mit Vorwegabzug, Betrag S + L, co2Share in den Werbungskosten', () => {
  const s = { units: [unit('w')], tenancies: [tenancy('tw', 'w')], costItems: [messdienst(123000, { tw: 120000 })] }
  const gemeinschaft = [plant({ source: 'homeowners' })]
  const st = co2({ serviceUsersTotalCents: 120000, serviceLandlordCents: 3000, serviceUnitsCount: 1 })
  const r = settle(s, [st], gemeinschaft)
  assert.equal(shareOf(r, 'tw', 'hz'), 120000)
  assert.deepEqual(partsOf(r), [{ reason: 'co2Share', cents: 3000 }])
  const tax = taxOf(snap(s, [st], gemeinschaft))
  assert.deepEqual([tax.privateCents, tax.deductibleCents], [0, 123000])
})

test('Vor 2023 gibt es keine Aufteilung, auch nicht mit Datensatz (§ 11 Abs. 2 Satz 1 CO2KostAufG)', () => {
  const alt = calendarPeriod(2022)
  const r = computeSettlement({
    ...snapshotOf(source({ ...vier, costItems: [messdienst(393301, TECHEM, { period: alt })] }), 2022),
    heatingPlants: [plant()],
    co2Statements: [techem({ period: alt })],
  })
  assert.deepEqual(partsOf(r), [{ reason: 'amountsRest', cents: 8750 }])
  assert.equal(r.heating?.[0]?.co2 ?? null, null)
})

test('Eigene Heizperiode nach Weg b (PR 5): die Teilabrechnung bucht den Vorwegabzug, die Bewertung kommt in P an', () => {
  // Objekt im Kalenderjahr, Anlage Mai bis April: Die Heizperiode 2025/2026 endet in P = 2026 (W1).
  const H = periodKey('2025-05')
  const quelle = {
    properties: [{ id: 'objekt-1', kind: 'mfh' as const, cableBuiltBeforeDec2021: null }],
    units: vier.units.map((u) => ({ ...u, propertyId: 'objekt-1' })),
    tenancies: vier.tenancies,
    costItems: [{ ...messdienst(393301, TECHEM, { period: H }), propertyId: 'objekt-1' }],
    meters: [], readings: [], payments: [], closedSettlements: [],
    heatingPlants: [{ ...plant({ periodStartMonth: 5, periodChanges: [], separateSpans: [], separateSettlement: false }), propertyId: 'objekt-1' }],
    co2Statements: [techem({ period: H })],
  }
  const zeitraum = periodOfKey({ startMonth: 1, changes: [] }, periodKey('2026-01')) ?? assert.fail('kein Zeitraum 2026')
  const r = computeSettlement(snapshotFor(quelle, 'objekt-1', zeitraum))
  assert.deepEqual(partsOf(r), [{ reason: 'co2Share', cents: 8750 }])
  assert.deepEqual(r.heating?.map((h) => [h.period, h.co2?.booked]), [['2025-05', true]])
})

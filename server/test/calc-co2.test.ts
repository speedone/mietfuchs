// CO₂ beim Messdienst in der Berechnung (Heizung PR 6, #97, #209; Entwurf 7, 12.2, 12.3). Die
// Beispiele A, B und C, die Rechenfehler der ersten Fassung (G-B2, G-B3), die Irrtümer der Probe
// (7.3), die benannte Lücke, eine Gutschrift im Topf und die Eigentumswohnung stehen je als Test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, taxReport, type ComputedSettlement } from '../src/calc.ts'
import { snapshotFor, snapshotOf, type Snapshot, type SnapshotCostItem, type SnapshotHeatingPeriodRow, type SnapshotHeatingPlant, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'
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

test('G-B2: reicht der Rest nicht, kappt take() den co2Share, L_self bleibt exakt im Eigenanteil (erste Fassung kürzte beide)', () => {
  // Drei Nutzeinheiten, Spielraum 6 ct: Die Einzelbeträge liegen 6 ct über S, die Probe besteht.
  const s = { units: [unit('a'), unit('b'), own('c')], tenancies: [tenancy('ta', 'a'), tenancy('tb', 'b')], costItems: [messdienst(300000, { ta: 120000, tb: 110006 }, { selfAmounts: { c: 60000 } })] }
  const r = settle(s, [co2({ serviceUsersTotalCents: 290000, serviceLandlordCents: 10000, serviceSelfLandlordCents: 2000, serviceUnitsCount: 3 })])
  assert.ok(!codes(r).includes('co2.sum-check'))
  assert.deepEqual(partsOf(r), [{ reason: 'selfUse', cents: 62000 }, { reason: 'co2Share', cents: 7994 }])
  assert.equal(r.selfUsedShareCents, 62000)
})

test('S geschätzt („Ich finde diese Zeile nicht“): weitet nur den Spielraum; geht die Probe nicht auf, wird nichts gebucht (Durchsicht I-2)', () => {
  // Der CO₂-Teil der eigenen Wohnung steht schon im Eigenbetrag (620,69 €), S ist aus den
  // Einzelbeträgen geschätzt: Gebucht hätte das den Anteil ein zweites Mal privat.
  const s = { units: [unit('a'), unit('b'), own('c')], tenancies: [tenancy('ta', 'a'), tenancy('tb', 'b')], costItems: [messdienst(300000, { ta: 120000, tb: 110000 }, { selfAmounts: { c: 62069 } })] }
  const r = settle(s, [co2({ serviceUsersTotalCents: 292069, serviceUsersTotalApprox: true, serviceLandlordCents: 10000, serviceUnitsCount: 3 })])
  assert.equal(r.notices.find((n) => n.code === 'co2.sum-check')?.level, 'error')
  assert.ok(!codes(r).includes('co2.sum-check-approx'))
  assert.match(textOf(r, 'co2.sum-check'), /S ist geschätzt/)
  assert.deepEqual(partsOf(r), [{ reason: 'selfUse', cents: 62069 }, { reason: 'amountsRest', cents: 7931 }])
  assert.equal(r.heating?.[0]?.co2?.booked, false)
  // Geht sie mit geschätztem S auf (leere Wohnung mit 600 €), wird gebucht, mit einem Hinweis.
  const leer = settle(
    { units: [unit('a'), unit('b'), unit('e')], tenancies: [tenancy('ta', 'a'), tenancy('tb', 'b')], costItems: [messdienst(300000, { ta: 120000, tb: 110000 })] },
    [co2({ serviceUsersTotalCents: 290000, serviceUsersTotalApprox: true, serviceLandlordCents: 10000, serviceUnitsCount: 3 })],
  )
  assert.equal(leer.notices.find((n) => n.code === 'co2.sum-check-approx')?.level, 'hint')
  assert.deepEqual(partsOf(leer), [{ reason: 'co2Share', cents: 10000 }, { reason: 'amountsRest', cents: 60000 }])
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

// ---------- Nur ausgewiesen (Entwurf 7.5) ----------

// Dieselbe Abrechnung, die Beträge je Nutzer aber brutto: S = Betrag = 3.933,01 €.
const BRUTTO = { ta: 112837, tb: 98045, tc: 103794, td: 78625 }
const KEY = `co2:hp:${P}`
const reliefRows = (r: ComputedSettlement): [string, number][] =>
  r.statements.flatMap((st) => st.rows.filter((row) => row.kind === 'co2Relief').map((row): [string, number] => [st.tenancyId, row.shareCents]))
const shownStatement = (over: Partial<Co2Statement> = {}) => techem({ method: 'serviceShown', serviceUsersTotalCents: 393301, ...over })

test('Nur ausgewiesen: eine Abzugszeile je Mieter nach seinem Anteil, zusammen 87,50 €; der Vermieter trägt sie als co2Share', () => {
  const r = settle({ ...vier, costItems: [messdienst(393301, BRUTTO)] }, [shownStatement()])
  // 87,50 € × Betrag / 3.933,01 €: 25,1035 / 21,8127 / 23,0917 / 17,4922; der Restcent geht an ta.
  assert.deepEqual(reliefRows(r), [['ta', -2511], ['tb', -2181], ['tc', -2309], ['td', -1749]])
  assert.ok(r.statements.every((st) => st.rows.filter((row) => row.kind === 'co2Relief').every((row) => row.costItemId === KEY)))
  assert.deepEqual(partsOf(r, KEY), [{ reason: 'co2Share', cents: 8750 }])
  assert.equal(r.statements.find((st) => st.tenancyId === 'ta')?.totalShareCents, 112837 - 2511)
  // Σ aller Zeilen = Σ der Positionen (Entwurf 12.3 Nr. 1).
  assert.equal(r.statements.reduce((a, st) => a + st.totalShareCents, 0) + r.landlord.totalCents, 393301)
  const zeile = r.statements[0]?.rows.find((row) => row.kind === 'co2Relief') ?? assert.fail('keine Abzugszeile')
  assert.deepEqual([zeile.description, zeile.category, zeile.basisText], ['CO₂-Kosten: Anteil des Vermieters', HEATING_CATEGORY, 'nach Ihrem Anteil an den Heizkosten'])
  assert.match(textOf(r, 'co2.reliefs-missing'), /ta \(a\) 25,11 €, tb \(b\) 21,81 €, tc \(c\) 23,09 € und td \(d\) 17,49 €/)
  const ausweis = r.heating?.[0]?.co2?.tenants.find((t) => t.tenancyId === 'ta')
  assert.deepEqual(ausweis, { tenancyId: 'ta', landlordCents: 2511, tenantCents: Math.round(((25000 - 8750) * 112837) / 393301), approximated: true })
})

test('Nur ausgewiesen: die Werte laut Messdienst gelten; zu viel heißt alle nach Anteil (co2.reliefs-invalid)', () => {
  const laut = settle({ ...vier, costItems: [messdienst(393301, BRUTTO)] }, [shownStatement({
    reliefs: [{ tenancyId: 'ta', cents: 2500 }, { tenancyId: 'tb', cents: 2200 }, { tenancyId: 'tc', cents: 2300 }, { tenancyId: 'td', cents: 1750 }],
  })])
  assert.deepEqual(reliefRows(laut), [['ta', -2500], ['tb', -2200], ['tc', -2300], ['td', -1750]])
  assert.ok(!codes(laut).includes('co2.reliefs-missing'))
  assert.equal(laut.statements[0]?.rows.find((row) => row.kind === 'co2Relief')?.basisText, 'laut Abrechnung des Messdienstes')
  const zuviel = settle({ ...vier, costItems: [messdienst(393301, BRUTTO)] }, [shownStatement({ reliefs: [{ tenancyId: 'ta', cents: 9000 }] })])
  assert.equal(zuviel.notices.find((n) => n.code === 'co2.reliefs-invalid')?.level, 'error')
  assert.deepEqual(reliefRows(zuviel), [['ta', -2511], ['tb', -2181], ['tc', -2309], ['td', -1749]])
})

test('Nur ausgewiesen mit Heizpauschale eines Mieters: nur wer eine Heizzeile hat, bekommt einen Abzug (Review Focus 3)', () => {
  const s = { units: [unit('a'), unit('b')], tenancies: [tenancy('ta', 'a'), tenancy('tb', 'b', { heatingModel: 'flatRate' })], costItems: [messdienst(300000, { ta: 200000, tb: 100000 })] }
  const r = settle(s, [co2({ method: 'serviceShown', serviceUsersTotalCents: 300000, serviceLandlordCents: 6000, serviceUnitsCount: 2 })])
  assert.deepEqual(reliefRows(r), [['ta', -4000]])
  assert.deepEqual(partsOf(r, KEY), [{ reason: 'co2Share', cents: 4000 }])
  assert.equal(r.statements.reduce((a, st) => a + st.totalShareCents, 0) + r.landlord.totalCents, 300000)
})

test('Lücke abgesichert über G und V (Entwurf 7.4): „Nein“, aber G − V = L → co2.probably-deducted', () => {
  const r = settle({ ...vier, costItems: [messdienst(384551, TECHEM)] }, [techem({ method: 'serviceShown', serviceFuelGrossCents: 354000, serviceFuelNetCents: 345250 })])
  const n = r.notices.find((x) => x.code === 'co2.probably-deducted') ?? assert.fail(`kein Hinweis: ${codes(r).join(', ')}`)
  assert.equal(n.level, 'warning')
  assert.match(n.text, /3\.540,00 €.*87,50 €.*3\.452,50 €/s)
  const ohne = settle({ ...vier, costItems: [messdienst(393301, BRUTTO)] }, [shownStatement({ serviceFuelGrossCents: 354000, serviceFuelNetCents: 354000 })])
  assert.ok(!codes(ohne).includes('co2.probably-deducted'))
})

// ---------- Hinweise (Entwurf 9.1, 10.1) ----------

const zwei = { units: [unit('a'), unit('b')], tenancies: [tenancy('ta', 'a'), tenancy('tb', 'b')] }
const gas = (amountCents = 100000) => messdienst(amountCents, { ta: 60000, tb: 40000 })
const vollstaendig = co2({ serviceUsersTotalCents: 100000, serviceLandlordCents: 500, serviceUnitsCount: 2, serviceKgPerM2: 30, serviceLandlordPermille: 400, serviceTotalCents: 1250 })

test('co2.missing: Gasheizung ohne CO₂-Angaben, 3 % je Mieter auf seine Heizzeilen, Knopf zur Heizanlage', () => {
  const r = settle({ ...zwei, costItems: [gas()] }, [])
  const n = r.notices.find((x) => x.code === 'co2.missing') ?? assert.fail(`kein Hinweis: ${codes(r).join(', ')}`)
  assert.deepEqual([n.level, n.subject, n.rule], ['warning', { kind: 'heatingCosts', id: 'hp' }, 'co2-split'])
  assert.match(n.text, /^Heizanlage „Gas“, Heizperiode 2025: Bei Gas, Heizöl, Flüssiggas und Kohle sind die CO₂-Kosten zwischen Ihnen und den Mietern aufzuteilen/)
  assert.match(n.text, /um 3 % kürzen \(§ 7 Abs\. 4 CO2KostAufG\), hier: ta \(a\) 18,00 € und tb \(b\) 12,00 €\./)
  assert.match(n.text, /Tragen Sie auf der Seite Heizkosten die CO₂-Angaben aus der Abrechnung des Messdienstes ein\./)
  assert.ok(r.legalBasis.values?.some((v) => v.id === 'co2.cut.missing'))
  // Fernwärme nur, falls der Lieferant CO₂ ausweist (R-A28); Wärmepumpe: nichts aufzuteilen.
  assert.match(textOf(settle({ ...zwei, costItems: [gas()] }, [], [plant({ energy: 'districtHeating' })]), 'co2.missing'), /Weist Ihr Wärmelieferant CO₂-Kosten aus, sind sie/)
  assert.ok(!codes(settle({ ...zwei, costItems: [gas()] }, [], [plant({ energy: 'heatPump' })])).some((c) => c.startsWith('co2.')))
  assert.equal(settle({ ...zwei, costItems: [gas()] }, [], [plant({ energy: 'other' })]).notices.find((x) => x.code === 'co2.fuel-unknown')?.subject?.id, 'hp')
  assert.match(textOf(settle({ ...zwei, costItems: [gas()] }, [], [plant({ source: 'homeowners' })]), 'co2.missing'), /aus der Abrechnung der Gemeinschaft ein\./)
  assert.match(textOf(settle({ ...zwei, costItems: [gas()] }, [], [plant({ method: 'manual' })]), 'co2.missing'), /mit einer späteren Version/)
})

test('Ohne Heizanlage: co2.fuel-unknown, im ersten Jahr co2.missing-first-year, nichts vor 2023 und nichts bei Warmmiete', () => {
  const ohne = (year: number, over: Partial<SnapshotTenancy> = {}) => computeSettlement(snapshotOf(source({
    units: [unit('a')],
    tenancies: [tenancy('ta', 'a', over)],
    costItems: [{ id: 'hz', period: calendarPeriod(year), category: HEATING_CATEGORY, description: 'Heizung', amountCents: 100000, key: 'area' }],
  }), year))
  const n = ohne(2025).notices.find((x) => x.code === 'co2.fuel-unknown') ?? assert.fail('kein Hinweis')
  assert.deepEqual([n.level, n.subject], ['hint', { kind: 'heatingPlant', id: '' }])
  assert.equal(n.text,
    'Mietfuchs weiß nicht, womit das Haus geheizt wird. Heizen Sie mit Gas, Heizöl, Flüssiggas oder Kohle oder weist Ihr Wärmelieferant CO₂-Kosten aus, ' +
    'sind die CO₂-Kosten zwischen Ihnen und den Mietern aufzuteilen (§ 5 CO2KostAufG), und die Heizkostenabrechnung muss den Anteil der Mieter, ' +
    'die Einstufung des Gebäudes und die Berechnungsgrundlagen ausweisen (§ 7 Abs. 3 CO2KostAufG). Fehlt das, darf jeder Mieter seinen Anteil ' +
    'an den Heizkosten um 3 % kürzen (§ 7 Abs. 4 CO2KostAufG), hier: ta (a) 30,00 €. Richten Sie unter Stammdaten die Heizung ein; dann sagt Mietfuchs, was zu tun ist.')
  assert.match(textOf(ohne(2023), 'co2.missing-first-year'), /^Für Abrechnungszeiträume, die am oder nach dem 01\.01\.2023 beginnen, sind die CO₂-Kosten der Heizung aufzuteilen \(§ 11 Abs\. 2 Satz 1 CO2KostAufG\); dieser Zeitraum ist der erste\. Mietfuchs weiß nicht/)
  assert.ok(!codes(ohne(2022)).some((c) => c.startsWith('co2.')))
  assert.ok(!codes(ohne(2025, { costModel: 'inclusive', heatingModel: 'inclusive' })).some((c) => c.startsWith('co2.')))
})

test('Der Messdienst hat nicht aufgeteilt (Entwurf 7.6, ohne Lieferung): co2.service-unsplit mit 3 % je Mieter', () => {
  const r = settle({ ...zwei, costItems: [gas()] }, [co2({ method: 'selfAfterService' })])
  const n = r.notices.find((x) => x.code === 'co2.service-unsplit') ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'warning')
  assert.match(n.text, /hier: ta \(a\) 18,00 € und tb \(b\) 12,00 €/)
  assert.ok(!codes(r).includes('co2.missing'))
  assert.deepEqual(partsOf(r), [])
})

test('Ausweis unvollständig (§ 7 Abs. 3): co2.incomplete nennt, was fehlt; nach gescheiterter Probe nicht ein zweites Mal', () => {
  const ohneAusweis = co2({ serviceUsersTotalCents: 100000, serviceLandlordCents: 500, serviceUnitsCount: 2 })
  const t = textOf(settle({ ...zwei, costItems: [gas(100500)] }, [ohneAusweis]), 'co2.incomplete')
  assert.match(t, /fehlen der CO₂-Ausstoß je Quadratmeter \(oder Ausstoß und Fläche\), der Anteil des Vermieters in Prozent und die CO₂-Kosten insgesamt/)
  assert.match(t, /hier: ta \(a\) 18,00 € und tb \(b\) 12,00 €/)
  assert.ok(!codes(settle({ ...zwei, costItems: [gas(100000)] }, [ohneAusweis])).includes('co2.incomplete'))
  const voll = settle({ ...zwei, costItems: [gas(100500)] }, [vollstaendig])
  assert.ok(!codes(voll).includes('co2.incomplete'))
  assert.ok(!codes(voll).includes('co2.stage-mismatch'))
})

test('Nachstufung (Entwurf 9.2): Techem 46,4 kg mit 35 % ergibt einen Hinweis, der § 8 und § 9 nennt', () => {
  const n = settle({ ...vier, costItems: [messdienst(393301, TECHEM)] }, [techem()]).notices.find((x) => x.code === 'co2.stage-mismatch') ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'hint')
  assert.match(n.text, /bei 46,4 kg CO₂ je m² und der Anteil des Vermieters bei 35 %\. Nach der Stufentabelle des CO2KostAufG gehört dieser Wert zu 70 %\./)
  assert.match(n.text, /§ 8 CO2KostAufG.*§ 9 CO2KostAufG/s)
  const passend = settle({ ...vier, costItems: [messdienst(393301, TECHEM)] }, [techem({ serviceLandlordPermille: 700, serviceTotalCents: 12500 })])
  assert.ok(!codes(passend).includes('co2.stage-mismatch'))
  // L passt nicht zu C · ‰.
  assert.match(textOf(settle({ ...vier, costItems: [messdienst(393301, TECHEM)] }, [techem({ serviceLandlordPermille: 700, serviceTotalCents: 20000 })]), 'co2.stage-mismatch'), /87,50 € sind nicht 70 % von 200,00 €/)
})

test('Warmwasser beim Messdienst (#211, Entwurf 7.7): Formel ohne bestätigten Aufwand → 15 % auf die Heizkosten im Topf', () => {
  const mit = (row: Partial<SnapshotHeatingPeriodRow>) => computeSettlement({
    ...snap({ ...zwei, costItems: [gas(100500)] }, [vollstaendig]),
    heatingPeriodRows: [{ plantId: 'hp', period: P, dhwMethod: null, dhwUnmeasurable: null, ...row }],
  })
  const r = mit({ dhwMethod: 'volumeFormula' })
  const n = r.notices.find((x) => x.code === 'heating.dhw-not-metered') ?? assert.fail('kein Hinweis')
  assert.deepEqual([n.level, n.rule, n.subject], ['warning', 'heating-dhw-split', { kind: 'heatingCosts', id: 'hp' }])
  assert.match(n.text, /um 15 % kürzen \(BGH VIII ZR 151\/20\), hier: ta \(a\) 90,00 € und tb \(b\) 60,00 €/)
  assert.ok(r.legalBasis.values?.some((v) => v.id === 'hkv.cut.not-by-consumption'))
  const keine: Partial<SnapshotHeatingPeriodRow>[] = [{ dhwMethod: 'volumeFormula', dhwUnmeasurable: true }, { dhwMethod: 'heatMeter' }, { dhwMethod: null }]
  for (const row of keine) assert.ok(!codes(mit(row)).includes('heating.dhw-not-metered'), JSON.stringify(row))
})

// ---------- Invarianten über Zufallsbestände (Entwurf 12.3 Nr. 1, 8, 9, 14) ----------

// Fester Startwert: jeder Lauf prüft dieselben Bestände.
function zufall(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
const euro = (cents: number) => `${(cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

test('Invarianten: Summe, Vorwegabzug, Abzugszeilen und Kürzungen auf die gedruckten Zeilen', () => {
  const rnd = zufall(20261005)
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))
  for (let lauf = 0; lauf < 300; lauf++) {
    const n = int(1, 4)
    const mitEigen = rnd() < 0.4
    const mitLeer = rnd() < 0.4
    const units = Array.from({ length: n }, (_, i) => unit(`u${i}`))
    const tenancies = units.map((u, i) => tenancy(`t${i}`, u.id))
    const amounts: Record<string, number> = Object.fromEntries(tenancies.map((t) => [t.id, int(10000, 200000)]))
    const eigen = mitEigen ? int(10000, 200000) : 0
    const leer = mitLeer ? int(10000, 200000) : 0
    if (mitEigen) units.push(own('eigen'))
    if (mitLeer) units.push(unit('leer'))
    const S = Object.values(amounts).reduce((a, c) => a + c, 0) + eigen + leer
    const L = int(0, Math.floor(S / 10))
    const abzug = rnd() < 0.5
    const item = messdienst(abzug ? S + L : S, amounts, mitEigen ? { selfAmounts: { eigen } } : {})
    const st = co2({ method: abzug ? 'serviceDeducted' : 'serviceShown', serviceUsersTotalCents: S, serviceLandlordCents: L, serviceUnitsCount: units.length })
    const r = settle({ units, tenancies, costItems: [item] }, [st])
    const fall = `Lauf ${lauf}: ${JSON.stringify({ n, mitEigen, mitLeer, S, L, abzug })}`
    // Nr. 1: Σ aller Zeilen = Σ der Positionen.
    assert.equal(r.statements.reduce((a, s2) => a + s2.totalShareCents, 0) + r.landlord.totalCents, item.amountCents, fall)
    assert.ok(!codes(r).includes('co2.sum-check'), `${fall}: Probe`)
    const relief = new Map(r.statements.flatMap((s2) => s2.rows.filter((row) => row.kind === 'co2Relief').map((row): [string, number] => [s2.tenancyId, -row.shareCents])))
    if (abzug) {
      // Nr. 8: kein Mieter zahlt anders als sein Einzelbetrag, nie eine Abzugszeile; L_self exakt;
      // kein negativer Rest bei bestandener Probe.
      for (const t of tenancies) assert.equal(shareOf(r, t.id, 'hz'), amounts[t.id], fall)
      assert.equal(relief.size, 0, fall)
      const parts = partsOf(r)
      const eigenExakt = eigen + (mitEigen ? (L * eigen) / S : 0)
      assert.ok(Math.abs((parts.find((p) => p.reason === 'selfUse')?.cents ?? 0) - eigenExakt) <= 1, `${fall}: L_self`)
      assert.ok((parts.find((p) => p.reason === 'amountsRest')?.cents ?? 0) >= 0, `${fall}: Rest`)
    } else {
      // Nr. 9: 0 ≤ r ≤ x; |R − L_vermietet| ≤ 0,5 ct (widerspruchsfreie Daten).
      for (const [t, c] of relief) assert.ok(c >= 0 && c <= (amounts[t] ?? 0), fall)
      const R = [...relief.values()].reduce((a, c) => a + c, 0)
      const exakt = Object.values(amounts).reduce((a, c) => a + (L * c) / S, 0)
      assert.ok(Math.abs(R - exakt) <= 0.5, `${fall}: R`)
    }
    // Nr. 14: die Kürzung je Mieter auf seine gedruckten Zeilen nach dem Abzug (co2.incomplete, denn
    // die Angaben für den Ausweis fehlen hier).
    const text = textOf(r, 'co2.incomplete')
    for (const t of tenancies) {
      const gedruckt = (amounts[t.id] ?? 0) - (relief.get(t.id) ?? 0)
      assert.ok(text.includes(`${t.id} (${t.unitId}) ${euro(Math.round((gedruckt * 3) / 100))}`), `${fall}: Kürzung ${t.id}`)
    }
  }
})

test('Vorwegabzug in der falschen Position: Kappt take() den co2Share über den Rundungsspielraum, sagt ein Hinweis es (Durchsicht M-2)', () => {
  // L steckt in der kleineren Position B; Mietfuchs nimmt ohne Wahl die größte (A), deren Rest 0 ist.
  const a = messdienst(200000, { ta: 120000, tb: 80000 }, { id: 'A', description: 'Heizung' })
  const b = messdienst(110000, { ta: 60000, tb: 40000 }, { id: 'B', description: 'Warmwasser' })
  const s = { units: [unit('a'), unit('b')], tenancies: [tenancy('ta', 'a'), tenancy('tb', 'b')], costItems: [a, b] }
  const st = co2({ serviceUsersTotalCents: 300000, serviceLandlordCents: 10000, serviceUnitsCount: 2 })
  const r = settle(s, [st])
  const n = r.notices.find((x) => x.code === 'co2.share-capped') ?? assert.fail(`kein Hinweis: ${codes(r).join(', ')}`)
  assert.deepEqual([n.level, n.subject], ['hint', { kind: 'heatingCosts', id: 'hp' }])
  assert.match(n.text, /„Heizung“/)
  assert.match(n.text, /100,00 €/)
  const gewaehlt = settle(s, [{ ...st, serviceCostItemId: 'B' }])
  assert.ok(!codes(gewaehlt).includes('co2.share-capped'))
  assert.deepEqual(partsOf(gewaehlt, 'B'), [{ reason: 'co2Share', cents: 10000 }])
})

test('Hinweise je Anlage nur, wenn jemand über ihre Heizkosten abgerechnet wird (Durchsicht M-1, M2)', () => {
  // Zwei Anlagen: hp versorgt nur die Wohnung mit Heizpauschale, hp2 die abgerechnete.
  const s = {
    units: [unit('a'), unit('b')],
    tenancies: [tenancy('ta', 'a', { heatingModel: 'flatRate' }), tenancy('tb', 'b')],
    costItems: [messdienst(100000, { ta: 100000 }), messdienst(100000, { tb: 100000 }, { id: 'hz2', heatingPlantId: 'hp2' })],
  }
  const anlagen = [plant({ units: [{ unitId: 'a', heatedAreaM2: null }] }), plant({ id: 'hp2', name: 'Gas 2', units: [{ unitId: 'b', heatedAreaM2: null }] })]
  const r = settle(s, [], anlagen)
  assert.deepEqual(r.notices.filter((n) => n.code === 'co2.missing').map((n) => n.subject?.id), ['hp2'])
  // Nur Pauschale: auch eine gescheiterte Probe und das Warmwasser nach Formel kürzt niemand.
  const nurPauschale = computeSettlement({
    ...snap({ units: [unit('a')], tenancies: [tenancy('ta', 'a', { heatingModel: 'flatRate' })], costItems: [messdienst(100000, { ta: 100000 })] },
      [co2({ serviceUsersTotalCents: 90000, serviceLandlordCents: 500, serviceUnitsCount: 1, serviceKgPerM2: 46.4, serviceLandlordPermille: 350 })]),
    heatingPeriodRows: [{ plantId: 'hp', period: P, dhwMethod: 'volumeFormula', dhwUnmeasurable: null }],
  })
  for (const code of ['co2.sum-check', 'co2.stage-mismatch', 'heating.dhw-not-metered', 'co2.missing']) {
    assert.ok(!codes(nurPauschale).includes(code), `${code}: ${codes(nurPauschale).join(', ')}`)
  }
})

test('Angaben laut Messdienst an einer Anlage mit freien Schlüsseln (etwa aus einem Archiv) bucht die Berechnung nicht (Durchsicht M-3)', () => {
  const r = settle({ ...vier, costItems: [messdienst(393301, TECHEM)] }, [techem()], [plant({ method: 'manual' })])
  assert.deepEqual(partsOf(r), [{ reason: 'amountsRest', cents: 8750 }])
  assert.equal(r.heating?.[0]?.co2 ?? null, null)
})

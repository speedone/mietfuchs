// Mieter heizt selbst (Heizung PR 19, #97): `heatingModel: 'selfSupply'` am Mietverhältnis. Der Mieter
// bezieht den Brennstoff oder die Wärme über einen eigenen Vertrag (Etagenheizung oder zentrale Heizung,
// Brennstoffvertrag beim Mieter). Was der Vermieter selbst trägt (Wartung, Betriebsstrom), bleibt umlegbar
// und wird abgerechnet wie bei `settlement` (Prüfung M2); Kürzungshinweise nach § 7 Abs. 4 CO2KostAufG und
// nach § 12 HeizkostenV gibt es dafür nicht (Prüfung M3, Gegenprüfung M3).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, taxReport, type ComputedSettlement } from '../src/calc.ts'
import { snapshotFor, snapshotOf, type SnapshotCostItem, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'
import { CALENDAR_RULES, calendarPeriod, periodKey, periodOfKey } from '../../shared/period.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { co2Source } from '../testing/co2Snapshot.ts'

const tenancy = (id: string, unitId: string, over: Partial<SnapshotTenancy> = {}): SnapshotTenancy => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null,
  prepayments: [{ from: '2020-01', monthlyCents: 10000 }], prepaymentOverrides: {}, baseRents: [], ...over,
})
const unit = (id: string, over: Partial<SnapshotUnit> = {}): SnapshotUnit => ({ id, name: id, areaM2: 50, participates: true, ...over })
const item = (year: number, over: Partial<SnapshotCostItem> = {}): SnapshotCostItem => ({
  id: 'wartung', period: calendarPeriod(year), category: HEATING_CATEGORY, description: 'Wartung der Heizung', amountCents: 30000, key: 'area', ...over,
})
const source = (s: Partial<SnapshotSource>): SnapshotSource => ({
  units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [], ...s,
})
const settle = (s: Partial<SnapshotSource>, year = 2025): ComputedSettlement => computeSettlement(snapshotOf(source(s), year))
const codes = (r: ComputedSettlement): string[] => r.notices.map((n) => n.code)
const statementOf = (r: ComputedSettlement, id: string) => r.statements.find((st) => st.tenancyId === id)
// Was eine Abrechnung an Zahlen ergibt, ohne Hinweise.
const numbers = (r: ComputedSettlement) => ({
  statements: r.statements.map((st) => ({ id: st.tenancyId, total: st.totalShareCents, balance: st.balanceCents, rows: st.rows.map((x) => [x.costItemId, x.shareCents]) })),
  landlord: r.landlord.rows.map((x) => [x.costItemId, x.shareCents, x.landlordParts]),
  notSettled: r.notSettled,
})

const ZWEI = [unit('a'), unit('b', { areaM2: 70 })]
const COLD: SnapshotCostItem = { id: 'gs', period: calendarPeriod(2025), category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 60000, key: 'area' }

test('M2: selfSupply rechnet Wartung und Betriebsstrom ab wie settlement, ohne Gegenzeile Pauschale oder Inklusivmiete', () => {
  const mit = settle({ units: ZWEI, tenancies: [tenancy('ta', 'a', { heatingModel: 'selfSupply' }), tenancy('tb', 'b')], costItems: [item(2025), COLD] })
  const ohne = settle({ units: ZWEI, tenancies: [tenancy('ta', 'a'), tenancy('tb', 'b')], costItems: [item(2025), COLD] })
  assert.deepEqual(numbers(mit), numbers(ohne))
  assert.ok(!mit.landlord.rows.some((x) => (x.landlordParts ?? []).some((p) => p.reason === 'flatRate' || p.reason === 'inclusive')))
  assert.ok(!codes(mit).includes('heating.flat-rate'), codes(mit).join(', '))
})

test('M2: kalt pauschal, Heizung selbst: die Abrechnung über Wartung bleibt und wird nicht gelöscht', () => {
  const r = settle({
    units: [unit('a')],
    tenancies: [tenancy('ta', 'a', { costModel: 'flatRate', heatingModel: 'selfSupply', flatRates: [{ from: '2020-01', monthlyCents: 8000 }] })],
    costItems: [item(2025), COLD],
  })
  assert.deepEqual(statementOf(r, 'ta')?.rows.map((x) => x.costItemId), ['wartung'])
  assert.deepEqual(r.notSettled, [])
})

test('M2: Inklusivmiete kalt und selbst geheizt: die Wartung wird abgerechnet, kalt nichts', () => {
  const r = settle({
    units: [unit('a')],
    tenancies: [tenancy('ta', 'a', { costModel: 'inclusive', heatingModel: 'selfSupply' })],
    costItems: [item(2025), COLD],
  })
  assert.deepEqual(statementOf(r, 'ta')?.rows.map((x) => x.costItemId), ['wartung'])
  assert.deepEqual(r.notSettled, [])
})

test('M2, Anlage V: selfSupply zählt weder als inklusiv noch als Pauschale', () => {
  const s = source({
    units: [unit('a')],
    tenancies: [tenancy('ta', 'a', { heatingModel: 'selfSupply', costModel: 'inclusive', baseRents: [{ from: '2020-01', monthlyCents: 50000 }] })],
    costItems: [item(2025), COLD],
  })
  const t = taxReport(snapshotOf(s, 2025))
  assert.deepEqual([t.costModels.inclusive, t.costModels.partlyInclusive, t.costModels.flatRate], [0, 1, 0], 'kalt inklusiv, Heizung nicht: teilweise inklusiv')
  const warm = taxReport(snapshotOf({ ...s, tenancies: [tenancy('ta', 'a', { heatingModel: 'selfSupply', baseRents: [{ from: '2020-01', monthlyCents: 50000 }] })] }, 2025))
  assert.deepEqual([warm.costModels.inclusive, warm.costModels.partlyInclusive, warm.costModels.flatRate], [0, 0, 0])
  assert.equal(warm.income.inclusiveRentSollCents, 0)
})

test('M3 Etagenheizung: Wartung bei selfSupply ohne Heizanlage, 2025: kein Hinweis auf 3 % nach § 7 Abs. 4, stattdessen co2.self-supply-items', () => {
  const r = settle({ units: ZWEI, tenancies: [tenancy('ta', 'a', { heatingModel: 'selfSupply' }), tenancy('tb', 'b', { heatingModel: 'selfSupply' })], costItems: [item(2025)] })
  assert.ok(!r.notices.some((n) => n.code.startsWith('co2.') && /3 %|§ 7 Abs\. 4/.test(n.text) && !/nicht in Betracht/.test(n.text)), codes(r).join(', '))
  assert.ok(!codes(r).includes('co2.fuel-unknown'), codes(r).join(', '))
  const n = r.notices.find((x) => x.code === 'co2.self-supply-items') ?? assert.fail(codes(r).join(', '))
  assert.equal(n.level, 'hint')
  assert.match(n.text, /„Wartung der Heizung“ betrifft eine Heizung, deren Brennstoff oder Wärme der Mieter selbst bezieht\. Darin stecken keine CO₂-Kosten, die Sie aufteilen müssten; eine Kürzung nach § 7 Abs\. 4 CO2KostAufG kommt dafür nicht in Betracht\./)
  assert.match(n.text, /nach § 6 Abs\. 2 CO2KostAufG in Textform verlangt; erfassen Sie seine Anzeige auf der Seite Kosten unter „CO₂-Erstattung“\./)
  assert.equal(n.rule, 'co2-self-supply')
})

test('M3: auch im ersten Jahr (2023) kein co2.missing-first-year, und keine Kürzung nach § 12 HeizkostenV', () => {
  const r = settle({ units: ZWEI, tenancies: [tenancy('ta', 'a', { heatingModel: 'selfSupply' }), tenancy('tb', 'b', { heatingModel: 'selfSupply' })], costItems: [item(2023)] }, 2023)
  for (const c of ['co2.missing-first-year', 'co2.fuel-unknown', 'heating.not-by-consumption', 'heating.may-agree-otherwise', 'heating.remote-reading', 'heating.remote-reading-missing']) {
    assert.ok(!codes(r).includes(c), `${c}: ${codes(r).join(', ')}`)
  }
  assert.ok(codes(r).includes('co2.self-supply-items'))
})

test('Gegenprobe: ohne selfSupply bleiben co2.fuel-unknown und die Kürzung nach § 12 HeizkostenV', () => {
  const r = settle({ units: ZWEI, tenancies: [tenancy('ta', 'a'), tenancy('tb', 'b')], costItems: [item(2025)] })
  assert.ok(codes(r).includes('co2.fuel-unknown'), codes(r).join(', '))
  assert.ok(codes(r).includes('heating.not-by-consumption'), codes(r).join(', '))
  assert.ok(!codes(r).includes('co2.self-supply-items'))
})

test('Gemischt: eine Wartung über einen Selbstversorger und einen Mieter der Vermieterheizung: der Hinweis bleibt, ohne Kürzung beim Selbstversorger', () => {
  const r = settle({ units: ZWEI, tenancies: [tenancy('ta', 'a', { heatingModel: 'selfSupply' }), tenancy('tb', 'b')], costItems: [item(2025)] })
  const n = r.notices.find((x) => x.code === 'co2.fuel-unknown') ?? assert.fail(codes(r).join(', '))
  assert.match(n.text, /hier: tb \(b\)/)
  assert.ok(!/ta \(a\)/.test(n.text), n.text)
  const hkv = r.notices.find((x) => x.code === 'heating.not-by-consumption') ?? assert.fail(codes(r).join(', '))
  assert.ok(!/ta \(a\)/.test(hkv.text), hkv.text)
})

test('Gemischt mit Heizanlage: wer selbst heizt und Brennstoff der Anlage trägt, bekommt den Fehler co2.self-supply-mixed und keine Kürzung', () => {
  const s = co2Source(2025, { co2CostCents: 50000 })
  const tenancies = s.tenancies.map((t) => (t.id === 'ta' ? { ...t, heatingModel: 'selfSupply' as const } : t))
  const P = periodOfKey(CALENDAR_RULES, periodKey('2025-01')) ?? assert.fail('kein Zeitraum')
  const r = computeSettlement(snapshotFor({ ...s, tenancies }, 'objekt-1', P))
  const n = r.notices.find((x) => x.code === 'co2.self-supply-mixed') ?? assert.fail(codes(r).join(', '))
  assert.equal(n.level, 'error')
  assert.match(n.text, /^Mieter A \(A\) ist in den Stammdaten auf „Mieter heizt selbst“ gestellt, trägt aber einen Anteil an „Gas“ einer Heizanlage/)
  assert.deepEqual(n.subject, { kind: 'tenancy', id: 'ta' })
  for (const x of r.notices.filter((y) => /§ 7 Abs\. 4/.test(y.text))) assert.ok(!/Mieter A \(A\) \d/.test(x.text), x.text)
  // Ohne selfSupply kein solcher Fehler.
  assert.ok(!codes(computeSettlement(snapshotFor(s, 'objekt-1', P))).includes('co2.self-supply-mixed'))
})

test('Abdeckung V27: zentrale Heizung als Anlage angelegt, Brennstoff beim Mieter: der Fehler sagt, dass dafür keine Anlage angelegt wird und wie man umstellt', () => {
  const s = co2Source(2025, { co2CostCents: 50000 })
  const tenancies = s.tenancies.map((t) => (t.id === 'ta' ? { ...t, heatingModel: 'selfSupply' as const } : t))
  const P = periodOfKey(CALENDAR_RULES, periodKey('2025-01')) ?? assert.fail('kein Zeitraum')
  const zentral = computeSettlement(snapshotFor({ ...s, tenancies }, 'objekt-1', P))
  const n = zentral.notices.find((x) => x.code === 'co2.self-supply-mixed') ?? assert.fail(codes(zentral).join(', '))
  assert.match(n.text, /Bezieht er den Brennstoff dieser zentralen Heizung über einen eigenen Vertrag, legen Sie dafür keine Heizanlage an:/)
  assert.match(n.text, /„Entfernen“/)
  assert.match(n.text, /„Wer hat den Liefervertrag für den Brennstoff\?“ „Der Mieter, der alle angeschlossenen Wohnungen gemietet hat“/)
  assert.doesNotMatch(n.text, /nehmen Sie seine Wohnung aus der Heizanlage/)
  // Etagenheizung auf Vertrag des Vermieters: Dort bleibt der Weg, die Wohnung aus der Anlage zu nehmen.
  const plants = (s.heatingPlants ?? []).map((p) => ({ ...p, supply: 'perUnit' as const }))
  const etage = computeSettlement(snapshotFor({ ...s, tenancies, heatingPlants: plants }, 'objekt-1', P))
  const e = etage.notices.find((x) => x.code === 'co2.self-supply-mixed') ?? assert.fail(codes(etage).join(', '))
  assert.match(e.text, /nehmen Sie seine Wohnung aus der Heizanlage/)
})

// Durchsicht S-2: Zentrale Heizung, Brennstoff beim Mieter. Ihr Betriebsstrom darf nicht im Allgemeinstrom stehen, den
// auch andere Mieter tragen (BGH, Urteil vom 03.06.2016, V ZR 166/15, Rn. 13).
test('S-2: zentrale Heizung beim Mieter, Allgemeinstrom auch bei anderen Mietern: Hinweis zum Betriebsstrom, färbt die Ampel nicht', () => {
  const strom: SnapshotCostItem = { id: 'strom', period: calendarPeriod(2025), category: 'Beleuchtung/Allgemeinstrom', description: 'Hausstrom', amountCents: 100000, key: 'units' }
  const wartung = item(2025, { key: 'direct', directUnitId: 'a' })
  const zentral = (kind: 'central' | 'perUnit' | undefined, over: Partial<SnapshotSource> = {}) => settle({
    units: ZWEI,
    tenancies: [tenancy('ta', 'a', { heatingModel: 'selfSupply', ...(kind ? { selfSupplyKind: kind } : {}) }), tenancy('tb', 'b')],
    costItems: [wartung, strom],
    ...over,
  })
  const r = zentral('central')
  const n = r.notices.find((x) => x.code === 'heating.self-supply-operating-power') ?? assert.fail(codes(r).join(', '))
  assert.equal(n.level, 'hint')
  assert.deepEqual(n.subject, { kind: 'tenancy', id: 'ta' })
  assert.match(n.text, /^Die Wohnung a von ta wird über eine zentrale Heizung versorgt, deren Brennstoff oder Wärme der Mieter selbst bezieht\. Läuft ihr Betriebsstrom/)
  assert.match(n.text, /„Hausstrom“/)
  assert.match(n.text, /BGH, Urteil vom 03\.06\.2016, V ZR 166\/15, Rn\. 13/)
  // Der rechtmäßige Fall steht ausdrücklich da, wie beim Hinweis „Betriebsstrom fehlt“.
  assert.match(n.text, /Hat die Heizung einen eigenen Stromvertrag mit eigenem Zähler und eigener Rechnung, oder läuft ihr Strom über den Zähler des Mieters, ist nichts falsch\. Ist der Abzug beim Allgemeinstrom erfasst, entfällt dieser Hinweis\.$/)
  // Etagenheizung oder ohne Angabe: Strom über den Zähler der Wohnung, kein Hinweis.
  assert.ok(!codes(zentral('perUnit')).includes('heating.self-supply-operating-power'))
  assert.ok(!codes(zentral(undefined)).includes('heating.self-supply-operating-power'))
  // Ein Abzug beim Allgemeinstrom ist die Antwort.
  const abzug: SnapshotCostItem = { id: 'abzug', period: calendarPeriod(2025), category: 'Beleuchtung/Allgemeinstrom', description: 'Abzug Betriebsstrom', amountCents: -8000, key: 'units', operatingPower: 'deduction' }
  assert.ok(!codes(zentral('central', { costItems: [wartung, strom, abzug] })).includes('heating.self-supply-operating-power'))
  // Trägt nur der Selbstversorger den Allgemeinstrom (er hat das ganze Haus), zahlt niemand sonst mit.
  const allein = settle({ units: [unit('a')], tenancies: [tenancy('ta', 'a', { heatingModel: 'selfSupply', selfSupplyKind: 'central' })], costItems: [wartung, strom] })
  assert.ok(!codes(allein).includes('heating.self-supply-operating-power'))
})

// Nachprüfung N-1 zu PR 19: Nur ein Abzug, der dieser Lage zuzuordnen ist, beantwortet den Hinweis. Der Abzug für die
// Heizanlage des Vermieters an einer anderen Wohnung (verknüpft mit einer Heizposition, die der Selbstversorger nicht
// trägt) lässt den Brennerstrom seiner Heizung weiter im Allgemeinstrom.
test('N-1: Abzug für eine andere Heizung schaltet den Hinweis nicht ab; verknüpft mit seiner Heizposition oder ohne Verweis schon', () => {
  const strom: SnapshotCostItem = { id: 'strom', period: calendarPeriod(2025), category: 'Beleuchtung/Allgemeinstrom', description: 'Hausstrom', amountCents: 100000, key: 'units' }
  const wartung = item(2025, { key: 'direct', directUnitId: 'a' })
  const betrieb = (id: string, over: Partial<SnapshotCostItem>): SnapshotCostItem =>
    item(2025, { id, description: `Betriebsstrom ${id}`, amountCents: 8000, heatingPart: 'operating', operatingPower: 'included', ...over })
  const abzug = (id: string, linked?: string): SnapshotCostItem => ({
    id, period: calendarPeriod(2025), category: 'Beleuchtung/Allgemeinstrom', description: `Abzug ${id}`, amountCents: -8000, key: 'units',
    operatingPower: 'deduction', operatingPowerGeneralId: 'strom', ...(linked ? { operatingPowerItemId: linked } : {}),
  })
  const mit = (extra: SnapshotCostItem[]) => codes(settle({
    units: ZWEI,
    tenancies: [tenancy('ta', 'a', { heatingModel: 'selfSupply', selfSupplyKind: 'central' }), tenancy('tb', 'b')],
    costItems: [wartung, strom, ...extra],
  })).includes('heating.self-supply-operating-power')
  // Heizung des Vermieters für Wohnung b: ihr Abzug gehört nicht zur Heizung des Selbstversorgers.
  assert.equal(mit([betrieb('fremd', { key: 'direct', directUnitId: 'b' }), abzug('ab-fremd', 'fremd')]), true)
  assert.equal(mit([betrieb('fremd', { key: 'area', participantUnitIds: ['b'] }), abzug('ab-fremd', 'fremd')]), true)
  // Mit der Heizposition des Selbstversorgers verknüpft (direkt oder über seine Teilnahme): beantwortet.
  assert.equal(mit([betrieb('eigen', { key: 'direct', directUnitId: 'a' }), abzug('ab-eigen', 'eigen')]), false)
  assert.equal(mit([betrieb('eigen', { key: 'area', participantUnitIds: ['a', 'b'] }), abzug('ab-eigen', 'eigen')]), false)
  // Ohne Verweis: beantwortet, wie bisher.
  assert.equal(mit([abzug('ab-frei')]), false)
})

test('#225: Wärmelieferant rechnet unmittelbar ab (keine Anlage, Mieter heizt selbst): die Kosten der Hausanlage tragen keinen Hinweis auf 15 % oder CO₂-Aufteilung', () => {
  const s = co2Source(2025, { co2CostCents: 50000 })
  const items: SnapshotCostItem[] = [item(2025, { id: 'station', description: 'Wartung Übergabestation' })]
  const tenancies = s.tenancies.map((t) => ({ ...t, heatingModel: 'selfSupply' as const, selfSupplyKind: 'central' as const }))
  const r = computeSettlement(snapshotOf({ ...s, heatingPlants: [], costItems: items, tenancies }, 2025))
  assert.deepEqual(codes(r), ['co2.self-supply-items'])
  const n = r.notices[0] ?? assert.fail('kein Hinweis')
  assert.match(n.text, /deren Brennstoff oder Wärme der Mieter selbst bezieht/)
})

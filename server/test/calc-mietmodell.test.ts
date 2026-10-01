// Nebenkostenmodell am Mietverhältnis (#93): Pauschale, Inklusivmiete und Warmmiete, getrennt für
// kalte Kosten und Heizung, mit Handrechnung.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, rentLedger, taxReport, type ComputedSettlement } from '../src/calc.ts'
import { snapshotOf, type SnapshotCostItem, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'

const tenancy = (id: string, unitId: string, over: Partial<SnapshotTenancy> = {}): SnapshotTenancy => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [{ from: '2025-01-01', persons: 1 }], start: '2025-01-01', end: null,
  prepayments: [{ from: '2025-01', monthlyCents: 10000 }], prepaymentOverrides: {}, baseRents: [], ...over,
})
const unit = (id: string, over: Partial<SnapshotUnit> = {}): SnapshotUnit => ({ id, name: id, areaM2: 50, participates: true, ...over })
const item = (over: Partial<SnapshotCostItem>): SnapshotCostItem => ({
  id: 'k', year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 100000, key: 'area', ...over,
})
const settle = (s: Partial<SnapshotSource>): ComputedSettlement => computeSettlement(snapshotOf({
  units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [], ...s,
}, 2025))
const statementOf = (s: ComputedSettlement, id: string) => s.statements.find((st) => st.tenancyId === id)

const HEIZUNG = 'Heizung und Warmwasser'

test('Pauschale: keine Abrechnung, der Anteil bleibt in der Basis und geht an den Vermieter', () => {
  const s = settle({
    units: [unit('a'), unit('b')],
    tenancies: [tenancy('t-a', 'a', { costModel: 'flatRate', prepayments: [], flatRates: [{ from: '2025-01', monthlyCents: 8000 }] }), tenancy('t-b', 'b')],
    costItems: [item({})],
  })
  assert.equal(statementOf(s, 't-a'), undefined, 'kein Mieter mit Pauschale bekommt eine Abrechnung')
  assert.equal(statementOf(s, 't-b')?.totalShareCents, 50000, 'der andere Mieter trägt nur seine Hälfte')
  assert.equal(s.landlord.totalCents, 50000)
  assert.equal(s.selfUsedShareCents, 0, 'der Anteil ist abziehbar und kein Eigenanteil')
  assert.deepEqual(s.notSettled, [{ tenancyId: 't-a', tenantName: 't-a', unitName: 'a', costModel: 'flatRate', heatingModel: 'settlement' }])
})

test('Gemischt: kalt pauschal, Heizung abgerechnet — die Abrechnung enthält nur die Heizung', () => {
  const s = settle({
    units: [unit('a')],
    // 50 € Heizvorauszahlung und 80 € Pauschale je Monat, in zwei Staffeln.
    tenancies: [tenancy('t-a', 'a', { costModel: 'flatRate', prepayments: [{ from: '2025-01', monthlyCents: 5000 }], flatRates: [{ from: '2025-01', monthlyCents: 8000 }] })],
    costItems: [item({ id: 'g' }), item({ id: 'h', category: HEIZUNG, description: 'Heizung laut Techem', amountCents: 80000, key: 'amounts', tenancyAmounts: { 't-a': 60000 } })],
  })
  const st = statementOf(s, 't-a')
  assert.deepEqual(st?.rows.map((r) => r.costItemId), ['h'])
  assert.equal(st?.totalShareCents, 60000)
  // Angerechnet wird nur die Heizvorauszahlung (600 €), nie die Pauschale: kein Guthaben
  // aus der Pauschale gegen die abgerechneten Heizkosten.
  assert.equal(st?.prepaymentCents, 60000)
  assert.equal(st?.balanceCents, 0)
  assert.equal(s.landlord.totalCents, 120000)
  assert.deepEqual(s.notSettled, [])
})

test('Inklusivmiete: keine Abrechnung, auch nicht für die Heizung', () => {
  const s = settle({
    units: [unit('a'), unit('eigen', { participates: false, selfUsed: true })],
    tenancies: [tenancy('t-a', 'a', { costModel: 'inclusive', heatingModel: 'inclusive', prepayments: [] })],
    costItems: [item({ category: HEIZUNG, description: 'Heizöl', key: 'area' })],
  })
  assert.equal(statementOf(s, 't-a'), undefined)
  assert.deepEqual(s.notSettled.map((n) => [n.tenancyId, n.costModel, n.heatingModel]), [['t-a', 'inclusive', 'inclusive']])
  // Zweifamilienhaus mit selbstgenutzter Wohnung: die Ausnahme des § 2, keine Warnung.
  assert.deepEqual(s.warnings, [])
})

test('Warmmiete außerhalb der Ausnahme: Warnung nach § 2 HeizkostenV, nur wenn es eine Heizposition gibt', () => {
  const ohneHeizung = settle({
    units: [unit('a'), unit('b'), unit('c')],
    tenancies: [tenancy('t-a', 'a', { heatingModel: 'flatRate', prepayments: [] })],
    costItems: [item({})],
  })
  assert.deepEqual(ohneHeizung.warnings, [])
  const mitHeizung = settle({
    units: [unit('a'), unit('b'), unit('c')],
    tenancies: [tenancy('t-a', 'a', { heatingModel: 'flatRate', prepayments: [] })],
    costItems: [item({ category: HEIZUNG, description: 'Heizung' })],
  })
  assert.equal(mitHeizung.warnings.length, 1)
  assert.match(mitHeizung.warnings[0] ?? '', /§ 2 HeizkostenV/)
  assert.match(mitHeizung.warnings[0] ?? '', /t-a/)
})

test('Ohne Angabe gilt die Abrechnung wie bisher', () => {
  const s = settle({ units: [unit('a')], tenancies: [tenancy('t-a', 'a')], costItems: [item({})] })
  assert.equal(statementOf(s, 't-a')?.totalShareCents, 100000)
  assert.deepEqual(s.notSettled, [])
})

test('Invariante (#93): Summen gehen auf, und ein Modell ändert den Eigenanteil nie', () => {
  let seed = 93
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  const pick = <T>(arr: readonly T[]): T => {
    const x = arr[Math.floor(rnd() * arr.length)]
    if (x === undefined) throw new Error('leere Auswahl')
    return x
  }
  const models = ['settlement', 'flatRate', 'inclusive'] as const
  for (let i = 0; i < 300; i++) {
    const units = Array.from({ length: 1 + Math.floor(rnd() * 4) }, (_, k) =>
      unit(`u${k}`, rnd() < 0.2 ? { participates: false, selfUsed: true } : { areaM2: Math.round(rnd() * 100) }))
    const tenancies = units.filter((u) => u.participates).map((u) =>
      tenancy(`t-${u.id}`, u.id, { costModel: pick(models), heatingModel: pick(models) }))
    const costItems = Array.from({ length: 1 + Math.floor(rnd() * 4) }, (_, k) =>
      item({ id: `c${k}`, category: pick(['Grundsteuer', HEIZUNG]), amountCents: 1 + Math.floor(rnd() * 200000), key: pick(['area', 'units'] as const) }))
    const s = settle({ units, tenancies, costItems })
    const mieter = s.statements.reduce((a, st) => a + st.totalShareCents, 0)
    assert.equal(mieter + s.landlord.totalCents, s.totalCostsCents, `Fall ${i}`)
    for (const row of s.landlord.rows) assert.ok(row.shareCents >= 0, `Fall ${i}: negativer Vermieteranteil`)
    const ohneModelle = settle({ units, tenancies: tenancies.map((t) => ({ ...t, costModel: undefined, heatingModel: undefined })), costItems })
    // Der ausgewiesene Eigenanteil ist je Position auf das begrenzt, was beim Vermieter gebucht
    // ist. Ohne Pauschale kann diese Grenze einen Cent unter dem gerundeten Eigenanteil liegen,
    // weil die Mieter aufgerundet haben; mit Pauschale wächst der Vermieteranteil, und die Grenze
    // fällt weg. Jeder Mieter rundet höchstens einen halben Cent auf, die Grenze liegt also je
    // Position höchstens (Mieter + 1) ÷ 2 Cent darunter. Ein Modell darf den Eigenanteil deshalb
    // nie senken und höchstens um diese Rundung anheben.
    const mehr = s.selfUsedShareCents - ohneModelle.selfUsedShareCents
    const rundung = costItems.length * Math.ceil((tenancies.length + 1) / 2)
    assert.ok(mehr >= 0 && mehr <= rundung, `Fall ${i}: Eigenanteil um ${mehr} Cent verschoben (Rundung höchstens ${rundung})`)
  }
})

test('Pauschale: das Mietkonto führt sie im Soll, die Abrechnung rechnet sie nie an', () => {
  const t = tenancy('t-a', 'a', { costModel: 'flatRate', prepayments: [], baseRents: [{ from: '2025-01', monthlyCents: 60000 }], flatRates: [{ from: '2025-01', monthlyCents: 8000 }] })
  const snapshot = snapshotOf({ units: [unit('a')], tenancies: [t], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [] }, 2025)
  const row = rentLedger(snapshot).rows[0]
  assert.equal(row?.flatRateYearCents, 96000)
  assert.equal(row?.prepaymentYearCents, 0)
  assert.equal(row?.sollYearCents, 60000 * 12 + 96000)
})

test('Gemischt ohne Kosten der abgerechneten Art: mit Vorauszahlung bleibt die Abrechnung, ohne verschwindet sie', () => {
  // Mit echter Heizvorauszahlung muss sie abgerechnet werden (hier: voll zurück), auch wenn im
  // Jahr keine Heizkosten erfasst sind; ohne Vorauszahlung wäre es eine leere Abrechnung.
  const mitVorauszahlung = settle({
    units: [unit('a')],
    tenancies: [tenancy('t-a', 'a', { costModel: 'flatRate' })],
    costItems: [item({})],
  })
  assert.equal(statementOf(mitVorauszahlung, 't-a')?.balanceCents, 120000)
  const ohne = settle({
    units: [unit('a')],
    tenancies: [tenancy('t-a', 'a', { costModel: 'flatRate', prepayments: [] })],
    costItems: [item({})],
  })
  assert.equal(statementOf(ohne, 't-a'), undefined)
  assert.equal(ohne.notSettled.length, 1)
})

test('§ 2 HeizkostenV: gezählt werden alle Wohnungen des Objekts, nicht nur die beteiligten', () => {
  // Drei Wohnungen, eine davon außerhalb der Abrechnungseinheit: kein Zweifamilienhaus.
  const s = settle({
    units: [unit('a'), unit('eigen', { participates: false, selfUsed: true }), unit('gewerbe', { participates: false })],
    tenancies: [tenancy('t-a', 'a', { heatingModel: 'inclusive', prepayments: [] })],
    costItems: [item({ category: HEIZUNG, description: 'Heizung' })],
  })
  assert.equal(s.warnings.length, 1)
})

test('Steuer: die Pauschale steht als eigene Zeile im Soll, und die Aufstellung geht auf', () => {
  // Befund der Integrationsdurchsicht: Das Soll enthielt die Pauschale, die Aufstellung nannte
  // aber nur Kaltmiete und Vorauszahlungen, und 960 € standen ohne Zeile in der Summe.
  const t = tenancy('t-a', 'a', { costModel: 'flatRate', prepayments: [], baseRents: [{ from: '2025-01', monthlyCents: 60000 }], flatRates: [{ from: '2025-01', monthlyCents: 8000 }] })
  const snapshot = snapshotOf({ units: [unit('a')], tenancies: [t], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [] }, 2025)
  const income = taxReport(snapshot).income
  assert.equal(income.flatRateSollCents, 96000)
  assert.equal(income.baseRentSollCents + income.prepaymentSollCents + income.flatRateSollCents, income.sollCents)
})

test('Steuer (#96): die Übersicht zählt Mietverhältnisse mit Inklusivmiete und mit Pauschale, für Zeile 24 und Zeile 20 der Anlage V', () => {
  const snapshot = snapshotOf({
    units: [unit('a'), unit('b'), unit('c')],
    tenancies: [
      tenancy('t-a', 'a', { costModel: 'inclusive', prepayments: [], baseRents: [{ from: '2025-01', monthlyCents: 70000 }] }),
      tenancy('t-b', 'b', { costModel: 'flatRate', prepayments: [], flatRates: [{ from: '2025-01', monthlyCents: 8000 }], baseRents: [{ from: '2025-01', monthlyCents: 50000 }] }),
      tenancy('t-c', 'c', { baseRents: [{ from: '2025-01', monthlyCents: 50000 }] }),
    ],
    costItems: [], meters: [], readings: [], payments: [], closedSettlements: [],
  }, 2025)
  // Ohne Heizposition im Jahr zählt nur das Modell der kalten Nebenkosten.
  assert.deepEqual(taxReport(snapshot).costModels, { tenancies: 3, inclusive: 1, partlyInclusive: 0, flatRate: 1 })
})

test('Steuer (#96): ganz inklusiv heißt kalt und warm inklusiv; eine Pauschale zählt bei kalt oder warm (Durchsicht)', () => {
  const row = (over: Partial<SnapshotTenancy>) => tenancy('t', 'a', { prepayments: [], baseRents: [{ from: '2025-01', monthlyCents: 70000 }], ...over })
  const count = (over: Partial<SnapshotTenancy>) =>
    taxReport(snapshotOf({ units: [unit('a')], tenancies: [row(over)], costItems: [item({ category: HEIZUNG, description: 'Heizung' })], meters: [], readings: [], payments: [], closedSettlements: [] }, 2025)).costModels
  assert.deepEqual(count({ costModel: 'inclusive', heatingModel: 'inclusive' }), { tenancies: 1, inclusive: 1, partlyInclusive: 0, flatRate: 0 })
  assert.deepEqual(count({ costModel: 'inclusive' }), { tenancies: 1, inclusive: 0, partlyInclusive: 1, flatRate: 0 })
  assert.deepEqual(count({ heatingModel: 'flatRate', flatRates: [{ from: '2025-01', monthlyCents: 5000 }] }), { tenancies: 1, inclusive: 0, partlyInclusive: 0, flatRate: 1 })
})

test('Steuer (#96): ohne Heizposition im Jahr zählt das Heizmodell nicht (die Mieter rechnen selbst mit dem Versorger ab)', () => {
  const t = tenancy('t', 'a', { costModel: 'inclusive', prepayments: [], baseRents: [{ from: '2025-01', monthlyCents: 70000 }] })
  const ohne = taxReport(snapshotOf({ units: [unit('a')], tenancies: [t], costItems: [item({})], meters: [], readings: [], payments: [], closedSettlements: [] }, 2025)).costModels
  assert.deepEqual(ohne, { tenancies: 1, inclusive: 1, partlyInclusive: 0, flatRate: 0 })
  const mit = taxReport(snapshotOf({ units: [unit('a')], tenancies: [t], costItems: [item({ category: HEIZUNG, description: 'Heizung' })], meters: [], readings: [], payments: [], closedSettlements: [] }, 2025)).costModels
  assert.deepEqual(mit, { tenancies: 1, inclusive: 0, partlyInclusive: 1, flatRate: 0 })
})

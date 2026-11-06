// Geschätzte Ablesung (#98): Die Kennzeichnung „geschätzt“ mit Begründung ist eine Angabe, keine andere Rechnung.
// Sie steht auf der Zähler-Seite (Hinweis) und beim Verbrauch des Mieters (Text seiner Zeile); kein Betrag ändert
// sich. Bei der eigenen Heizkostenabrechnung warnt Mietfuchs, wenn die geschätzte Fläche die Grenze des § 9a Abs. 2
// HeizkostenV überschreitet, statt still umzurechnen. Dazu der Hinweis nach § 556a Abs. 1 Satz 2 BGB: Wasser nach
// Personen oder Fläche, obwohl jede vermietete Wohnung einen Kaltwasserzähler hat.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, consumptionOverview, type ComputedSettlement } from '../src/calc.ts'
import { estimatedReadingsUsed } from '../src/readingEstimate.ts'
import { snapshotOf, type SnapshotCostItem, type SnapshotReading, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'
import { calendarPeriod } from '../../shared/period.ts'
import { RULES } from '../../shared/law/rules.ts'
import { GLOSSARY } from '../../shared/glossary.ts'
import { selfReadings, selfSnapshot } from '../testing/selfHeating.ts'
import type { Reading } from '../../shared/types.ts'

const r = (meterId: string, date: string, value: number, extra: Partial<SnapshotReading> = {}): SnapshotReading => ({ meterId, date, value, ...extra })
const year2025 = { from: '2025-01-01', to: '2025-12-31' }

test('Benutzte geschätzte Ablesungen: nur die des Zeitraums und der genannten Zähler, mit Begründung', () => {
  const rs = [
    r('m1', '2024-12-31', 10, { estimated: true, estimateReason: 'Zähler unzugänglich' }),
    r('m1', '2025-12-31', 50),
    r('m1', '2026-12-31', 90, { estimated: true, estimateReason: 'später' }),
    r('m2', '2025-12-31', 7, { estimated: true, estimateReason: 'anderer Zähler' }),
  ]
  assert.deepEqual(estimatedReadingsUsed(rs, ['m1'], year2025), [{ meterId: 'm1', date: '2024-12-31', reason: 'Zähler unzugänglich' }])
  assert.deepEqual(estimatedReadingsUsed(rs, ['m1'], { from: '2026-01-01', to: '2026-12-31' }), [{ meterId: 'm1', date: '2026-12-31', reason: 'später' }])
  assert.deepEqual(estimatedReadingsUsed(rs, [], year2025), [])
  // Ohne Kennzeichnung nichts.
  assert.deepEqual(estimatedReadingsUsed([r('m1', '2024-12-31', 1), r('m1', '2025-12-31', 2)], ['m1'], year2025), [])
})

const tenancy = (id: string, unitId: string, over: Partial<SnapshotTenancy> = {}): SnapshotTenancy => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [], ...over,
})
const unit = (id: string, over: Partial<SnapshotUnit> = {}): SnapshotUnit => ({ id, name: id.toUpperCase(), areaM2: 50, participates: true, ...over })
const water = (over: Partial<SnapshotCostItem> = {}): SnapshotCostItem => ({
  id: 'w', period: calendarPeriod(2025), category: 'Wasser/Abwasser', description: 'Wasser', amountCents: 100000, key: 'meter', meterType: 'kaltwasser', ...over,
})
const stock = (estimate: boolean, over: Partial<SnapshotSource> = {}): SnapshotSource => ({
  units: [unit('a'), unit('b')],
  tenancies: [tenancy('A', 'a'), tenancy('B', 'b')],
  costItems: [water()],
  meters: [
    { id: 'ka', name: 'Kaltwasser A', unitId: 'a', type: 'kaltwasser', unit: 'm³' },
    { id: 'kb', name: 'Kaltwasser B', unitId: 'b', type: 'kaltwasser', unit: 'm³' },
  ],
  readings: [
    r('ka', '2024-12-31', 100), r('ka', '2025-12-31', 160, estimate ? { estimated: true, estimateReason: 'Wohnung bei der Ablesung nicht zugänglich' } : {}),
    r('kb', '2024-12-31', 200), r('kb', '2025-12-31', 240),
  ],
  payments: [], closedSettlements: [],
  ...over,
})
const settle = (s: SnapshotSource): ComputedSettlement => computeSettlement(snapshotOf(s, 2025))
const rowOf = (s: ComputedSettlement, tenancyId: string, itemId = 'w') =>
  s.statements.find((st) => st.tenancyId === tenancyId)?.rows.find((x) => x.costItemId === itemId) ?? assert.fail(`keine Zeile ${tenancyId}`)

test('Zähler-Seite: Hinweis mit Datum und Begründung, Rechtsquelle wörtlich belegt; ohne Kennzeichnung nichts', () => {
  assert.deepEqual(consumptionOverview(snapshotOf(stock(false), 2025)).flatMap((z) => z.notices.map((n) => n.code)), [])
  const zeile = consumptionOverview(snapshotOf(stock(true), 2025)).find((z) => z.meterId === 'ka') ?? assert.fail('Zähler fehlt')
  const n = zeile.notices.find((x) => x.code === 'meter.reading-estimated') ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'hint')
  assert.equal(n.rule, 'meter-estimate')
  assert.deepEqual(n.subject, { kind: 'meter', id: 'ka' })
  assert.match(n.text, /„Kaltwasser A“: Der Stand vom 31\.12\.2025 ist geschätzt \(„Wohnung bei der Ablesung nicht zugänglich“\)/)
  assert.match(n.text, /rechnet mit dem geschätzten Stand wie mit einem abgelesenen/)
  assert.match(n.text, /VIII ZR 112\/14/)
  assert.ok(zeile.warnings.includes(n.text))
  // Der Verbrauch bleibt.
  assert.equal(zeile.consumption, 60)
  const regel = RULES.find((x) => x.code === 'meter-estimate') ?? assert.fail('Regel fehlt')
  assert.equal(regel.scope, 'meters', 'nur Zähler-Seite, nicht im Rechtsstand jeder Abrechnung')
  // Durchsicht M3: Das Urteil ist vom 12.11.2014 (zitiert so in BGH VIII ZR 193/14, Rn. 13).
  assert.match(regel.norm, /§ 9a HeizkostenV; BGH, Urteil vom 12\.11\.2014, VIII ZR 112\/14/)
  assert.match(GLOSSARY.meterReading.norm ?? '', /BGH, Urteil vom 12\.11\.2014, VIII ZR 112\/14/)
})

test('Abrechnung: kein Betrag ändert sich, der Mieter sieht „geschätzt“ mit Begründung bei seinem Verbrauch', () => {
  const ohne = settle(stock(false))
  const mit = settle(stock(true))
  assert.deepEqual(mit.statements.map((st) => st.rows.map((x) => x.shareCents)), ohne.statements.map((st) => st.rows.map((x) => x.shareCents)))
  assert.deepEqual(mit.landlord, ohne.landlord)
  assert.deepEqual(mit.notices, ohne.notices)
  assert.deepEqual(mit.legalBasis, ohne.legalBasis)
  const a = rowOf(mit, 'A')
  assert.equal(a.basisText, `${rowOf(ohne, 'A').basisText}; geschätzt: „Kaltwasser A“ Stand vom 31.12.2025 („Wohnung bei der Ablesung nicht zugänglich“)`)
  // Der andere Mieter hat seinen Zähler abgelesen: bei ihm nichts.
  assert.equal(rowOf(mit, 'B').basisText, rowOf(ohne, 'B').basisText)
})

test('Abrechnung: Ein geschätzter Stand des Hauptzählers steht bei jedem Mieter, dessen Anteil an ihm hängt', () => {
  const s = stock(false, {
    meters: [
      { id: 'ka', name: 'Kaltwasser A', unitId: 'a', type: 'kaltwasser', unit: 'm³' },
      { id: 'main', name: 'Hauptzähler', unitId: null, type: 'kaltwasser', unit: 'm³' },
    ],
    units: [unit('a'), unit('b', { participates: false, selfUsed: true })],
    tenancies: [tenancy('A', 'a')],
    readings: [r('ka', '2024-12-31', 100), r('ka', '2025-12-31', 160), r('main', '2024-12-31', 0), r('main', '2025-12-31', 100, { estimated: true, estimateReason: 'Schacht überflutet' })],
  })
  const mit = settle(s)
  const ohne = settle({ ...s, readings: s.readings.map((x) => ({ meterId: x.meterId, date: x.date, value: x.value })) })
  assert.equal(rowOf(mit, 'A').shareCents, rowOf(ohne, 'A').shareCents)
  assert.match(rowOf(mit, 'A').basisText ?? '', /geschätzt: „Hauptzähler“ Stand vom 31\.12\.2025 \(„Schacht überflutet“\)/)
})

// ---------- Eigene Heizkostenabrechnung: § 9a Abs. 2 ----------

// Beispiel A (testing/selfHeating.ts): A 60, B 80, C 60 m², zusammen 200 m². Der Endstand des Wärmezählers von C ist
// geschätzt: 60 von 200 m² (30 %) überschreiten 25 %.
const flagged = (meterId: string, date: string): Reading[] => selfReadings().map((x) => (x.meterId === meterId && x.date === date ? { ...x, estimated: true, estimateReason: 'Wärmezähler ausgefallen' } : x))

test('§ 9a Abs. 2: geschätzte Ablesungen über 25 % der Fläche ergeben eine Warnung mit Quote, die Beträge bleiben', () => {
  const ohne = computeSettlement(selfSnapshot())
  const mit = computeSettlement(selfSnapshot({ readings: flagged('wz-c', '2025-12-31') }))
  assert.deepEqual(mit.statements.map((st) => st.rows.map((x) => x.shareCents)), ohne.statements.map((st) => st.rows.map((x) => x.shareCents)))
  const n = mit.notices.find((x) => x.code === 'heating.reading-estimate-over-25') ?? assert.fail(`kein Hinweis: ${mit.notices.map((x) => x.code).join(', ')}`)
  assert.equal(n.level, 'warning')
  assert.equal(n.rule, 'heating-estimate')
  assert.match(n.text, /für die Heizung.*geschätzten Ablesungen bei C.*60 von 200 m² \(30 %\).*überschreitet 25 %.*ausschließlich nach Fläche.*§ 9a Abs\. 2 HeizkostenV/s)
  assert.match(n.text, /Mietfuchs rechnet weiter nach Verbrauch/)
  assert.match(n.text, /„Schätzung \(§ 9a\)“/)
  assert.ok(!mit.notices.some((x) => x.code === 'heating.estimate-over-25'), 'keine Umstellung, nur die Warnung')
  // Der Mieter sieht die Schätzung beim Verbrauch.
  const c2 = mit.statements.find((st) => st.tenancyId === 'C2')?.rows.find((x) => x.costItemId === 'wz') ?? assert.fail('keine Zeile')
  assert.match(c2.basisText ?? '', /geschätzt: „Wärme C“ Stand vom 31\.12\.2025 \(„Wärmezähler ausgefallen“\)/)
})

test('§ 9a Abs. 2: Ein geschätzter Stand außerhalb der Heizperiode zählt nicht', () => {
  const mit = computeSettlement(selfSnapshot({ readings: [...selfReadings(), { id: 'spaet', meterId: 'wz-c', date: '2027-12-31', value: 99999, estimated: true, estimateReason: 'später' }] }))
  assert.ok(!mit.notices.some((x) => x.code === 'heating.reading-estimate-over-25'))
})

// ---------- § 556a Abs. 1 Satz 2 BGB: Wasser nicht nach Verbrauch ----------

test('§ 556a: Wasser nach Personen oder Fläche, obwohl jede vermietete Wohnung einen Zähler hat, ergibt einen Hinweis', () => {
  for (const key of ['persons', 'area'] as const) {
    const s = settle(stock(false, { costItems: [water({ key, meterType: null })] }))
    const n = s.notices.find((x) => x.code === 'key.water-not-by-meter') ?? assert.fail(`kein Hinweis bei ${key}`)
    assert.equal(n.level, 'hint')
    assert.deepEqual(n.subject, { kind: 'costItem', id: 'w' })
    assert.match(n.text, /„Wasser“: Jede vermietete Wohnung hat einen abgelesenen Kaltwasserzähler/)
    assert.match(n.text, /§ 556a Abs\. 1 Satz 2 BGB/)
    assert.match(n.text, /Eine abweichende Vereinbarung im Mietvertrag geht vor; ob es sie gibt, weiß Mietfuchs nicht/)
    assert.match(n.text, /VIII ZR 188\/07/)
  }
})

test('§ 556a: kein Hinweis nach Zählern, ohne Zähler einer vermieteten Wohnung, bei anderer Kostenart', () => {
  const codes = (s: ComputedSettlement) => s.notices.map((n) => n.code)
  assert.ok(!codes(settle(stock(false))).includes('key.water-not-by-meter'))
  const ohneZaehlerB = stock(false, { costItems: [water({ key: 'persons', meterType: null })], meters: [{ id: 'ka', name: 'Kaltwasser A', unitId: 'a', type: 'kaltwasser', unit: 'm³' }] })
  assert.ok(!codes(settle(ohneZaehlerB)).includes('key.water-not-by-meter'))
  // B ohne Wasseranschluss zählt wie mit Zähler (wie der Vorschlag im Formular).
  const ohneAnschluss = { ...ohneZaehlerB, units: [unit('a'), unit('b', { noConnection: ['kaltwasser'] })] }
  assert.ok(codes(settle(ohneAnschluss)).includes('key.water-not-by-meter'))
  // Ein Zähler ohne Ablesung des Zeitraums erfasst nichts.
  const ohneAblesung = stock(false, { costItems: [water({ key: 'persons', meterType: null })], readings: [r('ka', '2024-12-31', 100), r('ka', '2025-12-31', 160)] })
  assert.ok(!codes(settle(ohneAblesung)).includes('key.water-not-by-meter'))
  assert.ok(!codes(settle(stock(false, { costItems: [water({ key: 'persons', meterType: null, category: 'Müllabfuhr' })] }))).includes('key.water-not-by-meter'))
  // Der Hinweis ändert keine Zahl.
  const mit = settle(stock(false, { costItems: [water({ key: 'persons', meterType: null })] }))
  assert.equal(mit.statements.reduce((a, st) => a + st.totalShareCents, 0), 100000)
})

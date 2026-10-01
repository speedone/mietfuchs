// Umlageschlüssel gegenüber dem Vorjahr (#141): Weicht eine Position vom Schlüssel derselben
// Kostenart im Vorjahr ab, sagt die Abrechnung es als Hinweis. Keine Zahl ändert sich.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement } from '../src/calc.ts'
import { snapshotFor, snapshotOf, type SnapshotCostItem, type SnapshotSource } from '../src/snapshot.ts'
import { GLOSSARY } from '../../shared/glossary.ts'

const item = (over: Partial<SnapshotCostItem> & Pick<SnapshotCostItem, 'id' | 'year' | 'key'>): SnapshotCostItem => ({
  category: 'Müllabfuhr', description: `Müllabfuhr ${over.year}`, amountCents: 60000, ...over,
})
const source = (costItems: SnapshotCostItem[]): SnapshotSource => ({
  units: [
    { id: 'u1', name: 'EG', areaM2: 50, participates: true },
    { id: 'u2', name: 'OG', areaM2: 70, participates: true },
  ],
  tenancies: [
    { id: 't1', unitId: 'u1', tenantName: 'Arnold', persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] },
    { id: 't2', unitId: 'u2', tenantName: 'Berger', persons: 3, personHistory: [{ from: '2020-01-01', persons: 3 }], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] },
  ],
  costItems, meters: [], readings: [], payments: [], closedSettlements: [],
})
const changed = (costItems: SnapshotCostItem[], year = 2026) =>
  computeSettlement(snapshotOf(source(costItems), year)).notices.filter((n) => n.code === 'key.changed-from-previous-year')

test('Schlüssel gewechselt: Hinweis mit Vorjahr, Lexikonbegriff und „Hier beheben“', () => {
  const found = changed([item({ id: 'alt', year: 2025, key: 'persons' }), item({ id: 'neu', year: 2026, key: 'area' })])
  assert.equal(found.length, 1)
  const n = found[0]
  assert.equal(n?.level, 'hint')
  assert.deepEqual(n?.subject, { kind: 'costItem', id: 'neu' })
  assert.ok(n?.terms?.includes('keyChange'))
  assert.match(n?.text ?? '', /2025 nach Personenzahl/)
  assert.match(n?.text ?? '', /2026 nach Wohnfläche/)
  assert.match(n?.text ?? '', /Textform/)
  assert.match(n?.text ?? '', /§ 556a Abs\. 2 BGB/)
})

test('Schlüssel gleich, mit anderen Teilnehmern: Hinweis nennt die Teilnehmer', () => {
  const found = changed([
    item({ id: 'alt', year: 2025, key: 'area' }),
    item({ id: 'neu', year: 2026, key: 'area', participantUnitIds: ['u1'] }),
  ])
  assert.equal(found.length, 1)
  assert.match(found[0]?.text ?? '', /anderen beteiligten Wohnungen/)
})

test('Kein Hinweis: gleicher Schlüssel, kein Vorjahr, nicht umlagefähig, oder Vorjahr uneinheitlich', () => {
  assert.equal(changed([item({ id: 'alt', year: 2025, key: 'persons' }), item({ id: 'neu', year: 2026, key: 'persons' })]).length, 0)
  assert.equal(changed([item({ id: 'neu', year: 2026, key: 'area' })]).length, 0)
  // Zwei Jahre zurück zählt nicht.
  assert.equal(changed([item({ id: 'alt', year: 2024, key: 'persons' }), item({ id: 'neu', year: 2026, key: 'area' })]).length, 0)
  assert.equal(changed([
    item({ id: 'alt', year: 2025, key: 'persons', category: 'Nicht umlagefähig' }),
    item({ id: 'neu', year: 2026, key: 'area', category: 'Nicht umlagefähig' }),
  ]).length, 0)
  // Entspricht die Position einer der Vorjahrespositionen, ist sie keine Änderung.
  assert.equal(changed([
    item({ id: 'a', year: 2025, key: 'persons' }),
    item({ id: 'b', year: 2025, key: 'area' }),
    item({ id: 'neu', year: 2026, key: 'area' }),
  ]).length, 0)
})

test('Keine Zahl ändert sich: dieselbe Abrechnung mit und ohne Vorjahr', () => {
  const neu = item({ id: 'neu', year: 2026, key: 'area' })
  const mit = computeSettlement(snapshotOf(source([item({ id: 'alt', year: 2025, key: 'persons' }), neu]), 2026))
  const ohne = computeSettlement(snapshotOf(source([neu]), 2026))
  assert.deepEqual(mit.statements, ohne.statements)
  assert.deepEqual(mit.landlord, ohne.landlord)
  assert.equal(mit.totalCostsCents, ohne.totalCostsCents)
  // Und ein handgebauter Schnappschuss ohne Vorjahr rechnet wie bisher, nur ohne Hinweis.
  const { previousCostItems: _weg, ...ohneFeld } = snapshotOf(source([item({ id: 'alt', year: 2025, key: 'persons' }), neu]), 2026)
  assert.deepEqual(computeSettlement(ohneFeld).statements, ohne.statements)
})

test('Lexikon: Wechsel des Umlageschlüssels nach § 556a Abs. 2 und 3 BGB', () => {
  const t = GLOSSARY.keyChange
  assert.match(t.norm, /§ 556a Abs\. 2/)
  assert.match(t.norm, /Abs\. 3/)
  assert.match(t.short, /Textform/)
  assert.match(t.short, /vor Beginn/)
  assert.match(t.short + t.needed, /Verbrauch/)
  assert.match(t.needed, /Eigentumswohnung/)
})

test('Objekte: das Vorjahr eines anderen Objekts zählt nicht (#92)', () => {
  const base = source([])
  const scoped = {
    units: base.units.map((u) => ({ ...u, propertyId: 'a' })),
    tenancies: base.tenancies,
    costItems: [
      { ...item({ id: 'b-alt', year: 2025, key: 'persons' }), propertyId: 'b' },
      { ...item({ id: 'a-neu', year: 2026, key: 'area' }), propertyId: 'a' },
    ],
    meters: [], readings: [], payments: [], closedSettlements: [],
  }
  const notices = computeSettlement(snapshotFor(scoped, 'a', 2026)).notices
  assert.equal(notices.filter((n) => n.code === 'key.changed-from-previous-year').length, 0)
  const sameHouse = { ...scoped, costItems: scoped.costItems.map((c) => ({ ...c, propertyId: 'a' })) }
  assert.equal(computeSettlement(snapshotFor(sameHouse, 'a', 2026)).notices.filter((n) => n.code === 'key.changed-from-previous-year').length, 1)
})

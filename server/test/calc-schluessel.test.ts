// Umlageschlüssel gegenüber dem Vorjahr (#141): Weicht eine Position vom Schlüssel derselben
// Kostenart im Vorjahr ab, sagt die Abrechnung es als Hinweis. Keine Zahl ändert sich.

import { calendarPeriod, calendarYearPeriod, startYearOf } from '../../shared/period.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement } from '../src/calc.ts'
import { snapshotFor, snapshotOf, type SnapshotCostItem, type SnapshotSource } from '../src/snapshot.ts'
import { GLOSSARY } from '../../shared/glossary.ts'

const item = (over: Partial<SnapshotCostItem> & Pick<SnapshotCostItem, 'id' | 'period' | 'key'>): SnapshotCostItem => ({
  category: 'Müllabfuhr', description: `Müllabfuhr ${startYearOf(over.period)}`, amountCents: 60000, ...over,
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
  const found = changed([item({ id: 'alt', period: calendarPeriod(2025), key: 'persons' }), item({ id: 'neu', period: calendarPeriod(2026), key: 'area' })])
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
    item({ id: 'alt', period: calendarPeriod(2025), key: 'area' }),
    item({ id: 'neu', period: calendarPeriod(2026), key: 'area', participantUnitIds: ['u1'] }),
  ])
  assert.equal(found.length, 1)
  assert.match(found[0]?.text ?? '', /anderen beteiligten Wohnungen/)
})

test('Kein Hinweis: gleicher Schlüssel, kein Vorjahr, nicht umlagefähig, oder Vorjahr uneinheitlich', () => {
  assert.equal(changed([item({ id: 'alt', period: calendarPeriod(2025), key: 'persons' }), item({ id: 'neu', period: calendarPeriod(2026), key: 'persons' })]).length, 0)
  assert.equal(changed([item({ id: 'neu', period: calendarPeriod(2026), key: 'area' })]).length, 0)
  // Zwei Jahre zurück zählt nicht.
  assert.equal(changed([item({ id: 'alt', period: calendarPeriod(2024), key: 'persons' }), item({ id: 'neu', period: calendarPeriod(2026), key: 'area' })]).length, 0)
  assert.equal(changed([
    item({ id: 'alt', period: calendarPeriod(2025), key: 'persons', category: 'Nicht umlagefähig' }),
    item({ id: 'neu', period: calendarPeriod(2026), key: 'area', category: 'Nicht umlagefähig' }),
  ]).length, 0)
  // Entspricht die Position einer der Vorjahrespositionen, ist sie keine Änderung.
  assert.equal(changed([
    item({ id: 'a', period: calendarPeriod(2025), key: 'persons' }),
    item({ id: 'b', period: calendarPeriod(2025), key: 'area' }),
    item({ id: 'neu', period: calendarPeriod(2026), key: 'area' }),
  ]).length, 0)
})

test('Keine Zahl ändert sich: dieselbe Abrechnung mit und ohne Vorjahr', () => {
  const neu = item({ id: 'neu', period: calendarPeriod(2026), key: 'area' })
  const mit = computeSettlement(snapshotOf(source([item({ id: 'alt', period: calendarPeriod(2025), key: 'persons' }), neu]), 2026))
  const ohne = computeSettlement(snapshotOf(source([neu]), 2026))
  assert.deepEqual(mit.statements, ohne.statements)
  assert.deepEqual(mit.landlord, ohne.landlord)
  assert.equal(mit.totalCostsCents, ohne.totalCostsCents)
  // Und ein handgebauter Schnappschuss ohne Vorjahr rechnet wie bisher, nur ohne Hinweis.
  const { previousCostItems: _weg, ...ohneFeld } = snapshotOf(source([item({ id: 'alt', period: calendarPeriod(2025), key: 'persons' }), neu]), 2026)
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
      { ...item({ id: 'b-alt', period: calendarPeriod(2025), key: 'persons' }), propertyId: 'b' },
      { ...item({ id: 'a-neu', period: calendarPeriod(2026), key: 'area' }), propertyId: 'a' },
    ],
    meters: [], readings: [], payments: [], closedSettlements: [],
  }
  const notices = computeSettlement(snapshotFor(scoped, 'a', calendarYearPeriod(2026))).notices
  assert.equal(notices.filter((n) => n.code === 'key.changed-from-previous-year').length, 0)
  const sameHouse = { ...scoped, costItems: scoped.costItems.map((c) => ({ ...c, propertyId: 'a' })) }
  assert.equal(computeSettlement(snapshotFor(sameHouse, 'a', calendarYearPeriod(2026))).notices.filter((n) => n.code === 'key.changed-from-previous-year').length, 1)
})

test('Durchsicht: Teilnehmer, die heute alle Wohnungen sind, gelten als alle (Wohnung inzwischen weg)', () => {
  // Im Vorjahr nur u1 und u2 von drei Wohnungen; die dritte gibt es nicht mehr. Der Vorschlag
  // speichert dann „alle“, und das ist derselbe Schlüssel.
  const found = changed([
    item({ id: 'alt', period: calendarPeriod(2025), key: 'area', participantUnitIds: ['u1', 'u2'] }),
    item({ id: 'neu', period: calendarPeriod(2026), key: 'area', participantUnitIds: null }),
  ])
  assert.equal(found.length, 0)
})

// ---------- Durchsicht (2) ----------

test('Durchsicht: bei „Sonstige Betriebskosten“ zählt nur dieselbe Beschreibung (Hebeanlage → Dachrinne)', () => {
  const hebe = item({ id: 'hebe', period: calendarPeriod(2025), key: 'direct', directUnitId: 'u1', category: 'Sonstige Betriebskosten', description: 'Wartung Hebeanlage 2025' })
  // Eine neue, andere Position derselben breiten Kostenart ist kein Wechsel des Schlüssels.
  assert.equal(changed([hebe, item({ id: 'rinne', period: calendarPeriod(2026), key: 'area', category: 'Sonstige Betriebskosten', description: 'Reinigung Dachrinne' })]).length, 0)
  // Dieselbe Position mit neuer Jahreszahl schon.
  const found = changed([hebe, item({ id: 'hebe-neu', period: calendarPeriod(2026), key: 'area', category: 'Sonstige Betriebskosten', description: 'Wartung  hebeanlage 2026' })])
  assert.equal(found.length, 1)
  assert.deepEqual(found[0]?.subject, { kind: 'costItem', id: 'hebe-neu' })
})

test('Durchsicht: mehrere Positionen einer Kostenart im Vorjahr, verglichen wird mit der gleichnamigen', () => {
  const items = [
    item({ id: 'w', period: calendarPeriod(2025), key: 'persons', category: 'Wasser/Abwasser', description: 'Frischwasser' }),
    item({ id: 'n', period: calendarPeriod(2025), key: 'area', category: 'Wasser/Abwasser', description: 'Niederschlag' }),
  ]
  // „Frischwasser“ jetzt nach Fläche: Wechsel, obwohl „Niederschlag“ im Vorjahr nach Fläche lief.
  assert.equal(changed([...items, item({ id: 'w26', period: calendarPeriod(2026), key: 'area', category: 'Wasser/Abwasser', description: 'Frischwasser' })]).length, 1)
})

test('Durchsicht (Recht): § 556a Abs. 3 nur ohne andere Vereinbarung und mit Rückfall bei unbilligem Maßstab', () => {
  const text = changed([item({ id: 'alt', period: calendarPeriod(2025), key: 'persons' }), item({ id: 'neu', period: calendarPeriod(2026), key: 'area' })])[0]?.text ?? ''
  assert.match(text, /nichts anderes vereinbart/)
  assert.match(text, /billigem Ermessen/)
})

test('Durchsicht (Recht): bei Heizung und Warmwasser gilt § 6 Abs. 4 HeizkostenV', () => {
  const heiz = (id: string, year: number, key: 'area' | 'meter') =>
    item({ id, period: calendarPeriod(year), key, category: 'Heizung und Warmwasser', description: 'Heizung', ...(key === 'meter' ? { meterType: 'waerme' as const } : {}) })
  const text = changed([heiz('alt', 2025, 'area'), heiz('neu', 2026, 'meter')])[0]?.text ?? ''
  assert.match(text, /§ 6 Abs\. 4 HeizkostenV/)
  assert.match(text, /Beginn eines Abrechnungszeitraums/)
  assert.doesNotMatch(text, /§ 556a Abs\. 2/)
})

test('Durchsicht (Recht): das Lexikon sagt „bleibt es bei den Personen“ und nennt den Rückfall nach Abs. 3', () => {
  const t = GLOSSARY.keyChange
  assert.match(t.example, /bleibt es bei den Personen/)
  assert.doesNotMatch(t.example, /für dieses Jahr/)
  assert.match(t.needed, /billigem Ermessen/)
  assert.match(t.needed, /HeizkostenV/)
})

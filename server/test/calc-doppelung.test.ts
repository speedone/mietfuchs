// Sicherheitsnetz in der Abrechnung (Zusammenspiel #141 und #170): Stehen zwei Positionen derselben
// Kostenart im Jahr, von denen eine keinen Beleg hat, ist es oft dieselbe Rechnung zweimal, einmal
// als Übernahme aus dem Vorjahr mit Schätzbetrag und einmal aus dem Beleg. Die Abrechnung sagt es
// als Hinweis; verteilt wird wie erfasst, keine Zahl ändert sich.

import { calendarPeriod, startYearOf } from '../../shared/period.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, NOTICE_KINDS } from '../src/calc.ts'
import { snapshotOf, type SnapshotCostItem, type SnapshotSource } from '../src/snapshot.ts'
import { GLOSSARY } from '../../shared/glossary.ts'

const item = (over: Partial<SnapshotCostItem> & Pick<SnapshotCostItem, 'id' | 'period'>): SnapshotCostItem => ({
  category: 'Grundsteuer', description: `Grundsteuer ${startYearOf(over.period)}`, amountCents: 60000, key: 'area', ...over,
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
const settle = (costItems: SnapshotCostItem[]) => computeSettlement(snapshotOf(source(costItems), 2026))
const dupes = (costItems: SnapshotCostItem[]) => settle(costItems).notices.filter((n) => n.code === 'cost.possible-duplicate')

test('Übernommen und dann aus dem Beleg erfasst: Hinweis mit beiden Positionen und Beträgen, „Hier beheben“ an der ohne Beleg', () => {
  const found = dupes([
    item({ id: 'vj', period: calendarPeriod(2025) }),
    item({ id: 'schaetzung', period: calendarPeriod(2026), amountCents: 61000 }),
    item({ id: 'echt', period: calendarPeriod(2026), description: 'Abgabenbescheid Stadt', amountCents: 61240, vendor: 'Stadt', invoiceFile: 'gs.pdf' }),
  ])
  assert.equal(found.length, 1)
  const n = found[0]
  assert.equal(n?.level, 'hint')
  assert.deepEqual(n?.subject, { kind: 'costItem', id: 'schaetzung' })
  assert.match(n?.text ?? '', /„Grundsteuer 2026“ \(610,00 €, ohne Beleg\)/)
  assert.match(n?.text ?? '', /„Abgabenbescheid Stadt“ \(612,40 €\)/)
  assert.match(n?.text ?? '', /zweimal/)
  for (const t of n?.terms ?? []) assert.ok(t in GLOSSARY, `Begriff ${t} fehlt im Lexikon`)
  assert.ok((NOTICE_KINDS['cost.possible-duplicate']?.terms.length ?? 0) > 0)
})

test('Kein Hinweis: beide mit Beleg, Gliederung wie im Vorjahr, breite Kostenart mit verschiedenen Rechnungen', () => {
  assert.equal(dupes([
    item({ id: 'a', period: calendarPeriod(2026), invoiceFile: 'a.pdf' }),
    item({ id: 'b', period: calendarPeriod(2026), description: 'Nachzahlung', invoiceFile: 'b.pdf' }),
  ]).length, 0)
  assert.equal(dupes([
    item({ id: 'r1', period: calendarPeriod(2025), category: 'Müllabfuhr', description: 'Restmüll 2025' }),
    item({ id: 'b1', period: calendarPeriod(2025), category: 'Müllabfuhr', description: 'Biomüll 2025' }),
    item({ id: 'r2', period: calendarPeriod(2026), category: 'Müllabfuhr', description: 'Restmüll 2026' }),
    item({ id: 'b2', period: calendarPeriod(2026), category: 'Müllabfuhr', description: 'Biomüll 2026' }),
  ]).length, 0)
  assert.equal(dupes([
    item({ id: 's1', period: calendarPeriod(2026), category: 'Sonstige Betriebskosten', description: 'Wartung Hebeanlage' }),
    item({ id: 's2', period: calendarPeriod(2026), category: 'Sonstige Betriebskosten', description: 'Reinigung Dachrinne' }),
  ]).length, 0)
})

test('Keine Zahl ändert sich: dieselbe Verteilung mit und ohne den Hinweis', () => {
  const items = [item({ id: 'schaetzung', period: calendarPeriod(2026), amountCents: 61000 }), item({ id: 'echt', period: calendarPeriod(2026), description: 'Bescheid', amountCents: 61240, invoiceFile: 'gs.pdf' })]
  const withHint = settle(items)
  const without = settle(items.map((i) => ({ ...i, invoiceFile: 'x.pdf' })))
  assert.equal(withHint.notices.some((n) => n.code === 'cost.possible-duplicate'), true)
  assert.equal(without.notices.some((n) => n.code === 'cost.possible-duplicate'), false)
  assert.deepEqual(withHint.statements, without.statements)
  assert.equal(withHint.totalCostsCents, without.totalCostsCents)
})

test('L2: bei drei Positionen heißt es nicht „beide“', () => {
  const found = dupes([
    item({ id: 'a', period: calendarPeriod(2026), amountCents: 61000 }),
    item({ id: 'b', period: calendarPeriod(2026), description: 'Bescheid', amountCents: 61240, invoiceFile: 'gs.pdf' }),
    item({ id: 'c', period: calendarPeriod(2026), description: 'Nachtrag', amountCents: 1000 }),
  ])
  assert.equal(found.length, 1)
  const text = found[0]?.text ?? ''
  assert.doesNotMatch(text, /beide/)
  assert.match(text, /„Grundsteuer 2026“ \(610,00 €, ohne Beleg\), „Bescheid“ \(612,40 €\) und „Nachtrag“ \(10,00 €, ohne Beleg\) stehen 2026 alle unter „Grundsteuer“/)
})

test('M1 Integrationsdurchsicht: der Rat führt nicht zum bloßen Zuordnen, das den Hinweis verstummen ließe', () => {
  // Wer der Schätzung nur den Beleg zuordnet, lässt den Hinweis verschwinden (er verlangt eine
  // Position ohne Beleg), die Summe bleibt aber doppelt. Der Rat muss deshalb zum Löschen führen.
  const items = [
    item({ id: 'schaetzung', period: calendarPeriod(2026), amountCents: 150000 }),
    item({ id: 'echt', period: calendarPeriod(2026), description: 'Bescheid', amountCents: 150000, invoiceFile: 'gs.pdf' }),
  ]
  const text = dupes(items)[0]?.text ?? ''
  assert.doesNotMatch(text, /Beleg zuordnen/)
  assert.match(text, /eine der beiden Positionen löschen/)
  // Der Mechanismus, gegen den der Rat schützt: bloßes Zuordnen bringt den Hinweis zum Schweigen.
  const zugeordnet = items.map((i) => ({ ...i, invoiceFile: 'gs.pdf' }))
  assert.equal(dupes(zugeordnet).length, 0)
  assert.equal(settle(zugeordnet).totalCostsCents, 300000)
})

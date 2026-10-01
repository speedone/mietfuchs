// Zuführung zur Erhaltungsrücklage (#143): nicht umlagefähig und in der Steuerübersicht nicht
// unter den Werbungskosten. BFH, Urteil vom 14.01.2025, IX R 19/24: Zahlungen in die
// Erhaltungsrücklage sind erst Werbungskosten, wenn und soweit die Gemeinschaft sie für
// Erhaltungsmaßnahmen verausgabt.
//
// Nachgestellt wie im Issue: Eigentumswohnung, Hausgeld 900 € Rücklage neben 3.921 € übrigen
// Werbungskosten. Vorher standen 4.821 € als Werbungskosten da.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, RESERVE_CATEGORY, taxReport } from '../src/calc.ts'
import { snapshotOf, type SnapshotCostItem, type SnapshotSource } from '../src/snapshot.ts'

const item = (over: Partial<SnapshotCostItem>): SnapshotCostItem => ({
  id: 'k', year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 100000, key: 'area', ...over,
})
const source = (costItems: SnapshotCostItem[]): SnapshotSource => ({
  units: [{ id: 'w', name: 'Wohnung', areaM2: 70, participates: true }],
  tenancies: [{
    id: 't', unitId: 'w', tenantName: 'Mieter', persons: 1, personHistory: [{ from: '2025-01-01', persons: 1 }], start: '2025-01-01', end: null,
    prepayments: [{ from: '2025-01', monthlyCents: 10000 }], prepaymentOverrides: {}, baseRents: [{ from: '2025-01', monthlyCents: 70000 }],
  }],
  costItems, meters: [], readings: [], payments: [], closedSettlements: [],
})
const ruecklage = item({ id: 'r', category: RESERVE_CATEGORY, description: 'Zuführung Erhaltungsrücklage 2025', amountCents: 90000, key: 'external' })
const uebrige = item({ id: 'g', category: 'Grundsteuer', amountCents: 392100 })

test('Rücklage: nicht unter den Werbungskosten, sondern gesondert ausgewiesen (#143)', () => {
  const r = taxReport(snapshotOf(source([uebrige, ruecklage]), 2025))
  assert.equal(r.expenses.totalCents, 392100, 'Werbungskosten ohne die Rücklage')
  assert.equal(r.reserveContributionCents, 90000)
  assert.ok(!r.expenses.groups.some((g) => g.categories.some((c) => c.category === RESERVE_CATEGORY)))
  assert.equal(r.surplusSollCents, r.income.sollCents - 392100)
})

test('Rücklage: nicht umlagefähig, die Abrechnung trägt sie ganz beim Vermieter (#143)', () => {
  const s = computeSettlement(snapshotOf(source([ruecklage]), 2025))
  assert.equal(s.statements[0]?.totalShareCents ?? 0, 0)
  assert.equal(s.landlord.totalCents, 90000)
  assert.equal(s.selfUsedShareCents, 0)
  assert.deepEqual(s.warnings, [], 'keine Warnung zur fehlenden Basis, wie bei „Nicht umlagefähig“')
})

test('Rücklage: „Nicht umlagefähig“ mit Rücklage in der Beschreibung wird als Verdacht gemeldet (#143)', () => {
  const verdacht = item({ id: 'v', category: 'Nicht umlagefähig', description: 'Instandhaltungsrücklage lt. Hausgeldabrechnung', amountCents: 90000 })
  const reparatur = item({ id: 'x', category: 'Nicht umlagefähig', description: 'Reparatur Dachrinne', amountCents: 44000 })
  const r = taxReport(snapshotOf(source([verdacht, reparatur]), 2025))
  assert.deepEqual(r.reserveSuspects, [{ costItemId: 'v', description: 'Instandhaltungsrücklage lt. Hausgeldabrechnung', amountCents: 90000 }])
  // Gerechnet wird weiter wie erfasst: Der Hinweis rät, die Zahl ändert erst die Kostenart.
  assert.equal(r.expenses.totalCents, 134000)
})

test('Rücklage: ohne die Kostenart ist der Bericht unverändert (#143)', () => {
  const r = taxReport(snapshotOf(source([uebrige]), 2025))
  assert.equal(r.reserveContributionCents, 0)
  assert.deepEqual(r.reserveSuspects, [])
  assert.equal(r.expenses.totalCents, 392100)
})

test('Rücklage: eine Entnahme aus der Rücklage ist keine Zuführung (#143, Durchsicht)', () => {
  const entnahme = item({ id: 'e', category: 'Nicht umlagefähig', description: 'Entnahme aus der Erhaltungsrücklage für das Dach', amountCents: 50000 })
  const bezahlt = item({ id: 'b', category: 'Nicht umlagefähig', description: 'Fassade, bezahlt aus der Rücklage', amountCents: 30000 })
  const zufuehrung = item({ id: 'z', category: 'Nicht umlagefähig', description: 'Zuführung zur Rücklage', amountCents: 90000 })
  const r = taxReport(snapshotOf(source([entnahme, bezahlt, zufuehrung]), 2025))
  assert.deepEqual(r.reserveSuspects.map((x) => x.costItemId), ['z'])
})

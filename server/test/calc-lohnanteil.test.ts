// §35a-Lohnanteil (#148): Abrechnung und Steuerübersicht wenden dieselbe Gültigkeitsregel an.
// Die Abrechnung bescheinigt einen Lohnanteil nur zwischen 0 und dem Rechnungsbetrag und warnt
// sonst (`labor35a.invalid`); die Steuerübersicht zählte ihn roh mit.

import { calendarPeriod } from '../../shared/period.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, taxReport, validLabor35aCents } from '../src/calc.ts'
import { snapshotOf, type SnapshotCostItem, type SnapshotSource } from '../src/snapshot.ts'

const item = (id: string, amountCents: number, labor35aCents: number): SnapshotCostItem => ({
  id, period: calendarPeriod(2025), category: 'Gartenpflege', description: id, amountCents, labor35aCents, key: 'area',
})
const source = (costItems: SnapshotCostItem[]): SnapshotSource => ({
  units: [{ id: 'w', name: 'Wohnung', areaM2: 70, participates: true }],
  tenancies: [{
    id: 't', unitId: 'w', tenantName: 'Mieter', persons: 1, personHistory: [{ from: '2025-01-01', persons: 1 }], start: '2025-01-01', end: null,
    prepayments: [], prepaymentOverrides: {}, baseRents: [],
  }],
  costItems, meters: [], readings: [], payments: [], closedSettlements: [],
})

test('Lohnanteil: ungültige zählen weder in der Abrechnung noch in der Steuerübersicht (#148)', () => {
  const items = [
    item('gültig', 100000, 80000),
    item('über dem Betrag', 100000, 150000),
    item('negativ', 100000, -5000),
    item('an einer Gutschrift', -10000, 2000),
  ]
  const snapshot = snapshotOf(source(items), 2025)
  const s = computeSettlement(snapshot)
  assert.equal(s.statements[0]?.total35aCents, 80000)
  assert.equal(s.notices.filter((n) => n.code === 'labor35a.invalid').length, 3)
  const r = taxReport(snapshot)
  assert.equal(r.expenses.labor35aCents, 80000, 'nur der gültige Lohnanteil')
  assert.equal(r.expenses.labor35aCents, s.statements.reduce((a, st) => a + st.total35aCents, 0))
})

test('Lohnanteil: die Regel einmal formuliert (#148)', () => {
  assert.equal(validLabor35aCents({ amountCents: 100000, labor35aCents: 100000 }), 100000)
  assert.equal(validLabor35aCents({ amountCents: 100000, labor35aCents: 0 }), 0)
  assert.equal(validLabor35aCents({ amountCents: 100000 }), 0)
  assert.equal(validLabor35aCents({ amountCents: 100000, labor35aCents: 100001 }), null)
  assert.equal(validLabor35aCents({ amountCents: 100000, labor35aCents: -1 }), null)
  assert.equal(validLabor35aCents({ amountCents: -10000, labor35aCents: 2000 }), null)
  assert.equal(validLabor35aCents({ amountCents: -10000, labor35aCents: 0 }), 0)
})

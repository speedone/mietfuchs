// Monatliche Verbrauchsinformation (Heizung PR 22, § 6a Abs. 1 Nr. 2, Abs. 2 HeizkostenV).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addMonths, monthBounds, monthName, monthRanges, monthsBetween } from '../../shared/monthlyInfo.ts'

test('Monate: Name, Grenzen, Spannen, Abstand', () => {
  assert.equal(monthName('2025-11'), 'November 2025')
  assert.deepEqual(monthBounds('2024-02'), { from: '2024-02-01', to: '2024-02-29' })
  assert.deepEqual(monthBounds('2025-02'), { from: '2025-02-01', to: '2025-02-28' })
  assert.deepEqual(monthBounds('2025-12'), { from: '2025-12-01', to: '2025-12-31' })
  assert.deepEqual(monthsBetween('2025-11-15', '2026-02-01'), ['2025-11', '2025-12', '2026-01', '2026-02'])
  assert.deepEqual(monthsBetween('2025-11-15', '2025-11-20'), ['2025-11'])
  assert.equal(addMonths('2025-01', -1), '2024-12')
  assert.equal(addMonths('2025-11', -12), '2024-11')
  assert.equal(addMonths('2025-12', 1), '2026-01')
  assert.equal(monthRanges(['2025-01', '2025-02', '2025-03', '2025-05']), 'Januar bis März 2025, Mai 2025')
  assert.equal(monthRanges(['2024-11', '2024-12', '2025-01']), 'November 2024 bis Januar 2025')
  assert.equal(monthRanges(['2025-03', '2025-01', '2025-02', '2025-02']), 'Januar bis März 2025')
  assert.equal(monthRanges([]), '')
})

// Abgeschlossene Jahre gegen die heutige Berechnung (#56, Teil 1). Der eingefrorene Stand bleibt,
// wie er ist; Mietfuchs sagt nur, wenn die heutige Rechnung für einen Mieter etwas anderes ergibt,
// und in welche Richtung.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareWithFrozen } from '../src/settlementDiff.ts'

const statement = (tenancyId: string, balanceCents: number) => ({ tenancyId, tenantName: tenancyId, unitName: 'EG', balanceCents })

test('Gleiche Salden: keine Abweichung', () => {
  const r = compareWithFrozen({ statements: [statement('t', 6667)] }, { statements: [statement('t', 6667)] }, 2025, '2026-10-01')
  assert.deepEqual(r, { comparable: true, deviations: [], deadline: '2026-12-31', deadlinePassed: false })
})

test('Mehr Guthaben heute: zugunsten des Mieters; weniger: zugunsten des Vermieters', () => {
  const r = compareWithFrozen(
    { statements: [statement('a', 6667), statement('b', -1000)] },
    { statements: [statement('a', 8000), statement('b', -2500)] },
    2025, '2027-01-02',
  )
  assert.deepEqual(r.deviations.map((d) => [d.tenancyId, d.differenceCents, d.direction]), [['a', 1333, 'tenant'], ['b', -1500, 'landlord']])
  assert.equal(r.deadlinePassed, true)
})

test('Ein Mietverhältnis, das nur auf einer Seite steht, ist ebenfalls eine Abweichung', () => {
  const r = compareWithFrozen({ statements: [statement('a', 0)] }, { statements: [statement('a', 0), statement('neu', -500)] }, 2025, '2026-01-01')
  assert.deepEqual(r.deviations.map((d) => [d.tenancyId, d.frozenBalanceCents, d.currentBalanceCents, d.direction]), [['neu', null, -500, 'landlord']])
})

test('Ein eingefrorener Stand, der sich nicht lesen lässt, ist nicht vergleichbar statt „keine Abweichung“', () => {
  for (const kaputt of [null, 'Text', {}, { statements: 'nein' }, { statements: [{ tenancyId: 1 }] }]) {
    const r = compareWithFrozen(kaputt, { statements: [statement('a', 0)] }, 2025, '2026-01-01')
    assert.equal(r.comparable, false, JSON.stringify(kaputt))
    assert.deepEqual(r.deviations, [])
  }
})

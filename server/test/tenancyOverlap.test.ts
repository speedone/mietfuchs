// Überschneidende Mietverhältnisse einer Wohnung (#204): die eine Regel, wann sich zwei Zeiträume
// überschneiden, in shared/tenancyOverlap.ts. Server (Hinweis der Abrechnung) und Oberfläche
// (Rückfrage in den Stammdaten) fragen dieselbe Funktion.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { commonPeriod, overlapsOf, tenancyOverlaps } from '../../shared/tenancyOverlap.ts'

const t = (id: string, unitId: string, start: string, end: string | null) => ({ id, unitId, start, end })

test('Gemeinsamer Zeitraum: inklusive Grenzen, ein gemeinsamer Tag genügt', () => {
  assert.deepEqual(commonPeriod({ start: '2025-01-01', end: '2025-09-30' }, { start: '2025-09-01', end: null }), { from: '2025-09-01', to: '2025-09-30' })
  // Auszug am 30.09., Einzug am 30.09.: ein gemeinsamer Tag
  assert.deepEqual(commonPeriod({ start: '2025-01-01', end: '2025-09-30' }, { start: '2025-09-30', end: null }), { from: '2025-09-30', to: '2025-09-30' })
  // Lückenlos: Auszug am 30.09., Einzug am 01.10. — keine Überschneidung
  assert.equal(commonPeriod({ start: '2025-01-01', end: '2025-09-30' }, { start: '2025-10-01', end: null }), null)
  // Beide offen: gemeinsam ab dem späteren Einzug, offen
  assert.deepEqual(commonPeriod({ start: '2020-01-01', end: null }, { start: '2024-03-01', end: null }), { from: '2024-03-01', to: null })
  // Reihenfolge der Argumente egal
  assert.deepEqual(commonPeriod({ start: '2025-09-01', end: null }, { start: '2025-01-01', end: '2025-09-30' }), { from: '2025-09-01', to: '2025-09-30' })
})

test('Paare je Wohnung: nur dieselbe Wohnung, früheres Mietverhältnis zuerst, jedes Paar einmal', () => {
  const list = [
    t('y', 'A', '2025-09-01', null),
    t('x', 'A', '2023-01-01', '2025-09-30'),
    t('z', 'B', '2025-01-01', null), // andere Wohnung, gleicher Zeitraum
    t('w', 'A', '2020-01-01', '2022-12-31'), // lückenlos vor x
  ]
  const found = tenancyOverlaps(list)
  assert.equal(found.length, 1)
  assert.equal(found[0]?.first.id, 'x')
  assert.equal(found[0]?.second.id, 'y')
  assert.equal(found[0]?.from, '2025-09-01')
  assert.equal(found[0]?.to, '2025-09-30')
})

test('Kandidat aus dem Formular: ohne Kennung, mit Kennung gegen sich selbst nicht', () => {
  const list = [t('x', 'A', '2023-01-01', '2025-09-30'), t('z', 'B', '2025-01-01', null)]
  const neu = overlapsOf({ unitId: 'A', start: '2025-09-01', end: null }, list)
  assert.deepEqual(neu.map((o) => [o.other.id, o.from, o.to]), [['x', '2025-09-01', '2025-09-30']])
  // Beim Bearbeiten zählt das Mietverhältnis selbst nicht
  assert.deepEqual(overlapsOf({ id: 'x', unitId: 'A', start: '2023-01-01', end: '2025-12-31' }, list), [])
  // Andere Wohnung: keine Überschneidung
  assert.deepEqual(overlapsOf({ unitId: 'C', start: '2025-01-01', end: null }, list), [])
})

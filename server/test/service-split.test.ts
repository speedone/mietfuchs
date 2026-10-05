// Aufteilen einer kalten Rechnung nach Tagen (#208, Entwurf 3.4). Reine Funktion; das Schreiben
// prüft db-aufteilen.test.ts.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { baseDescription, splitByService } from '../src/serviceSplit.ts'
import type { PeriodRules } from '../../shared/types.ts'

const MAI: PeriodRules = { startMonth: 5, changes: [] }
const WECHSEL: PeriodRules = { startMonth: 1, changes: ['2025-05'] }

test('Grundsteuer 2025 über 480 € bei Mai bis April: 157,81 € und 322,19 € (Entwurf 3.4)', () => {
  const parts = splitByService(MAI, { id: 'g', description: 'Grundsteuer 2025', amountCents: 48000, serviceFrom: '2025-01-01', serviceTo: '2025-12-31' })
  assert.deepEqual(parts.map((p) => [p.period.key, p.days, p.amountCents, p.description]), [
    ['2024-05', 120, 15781, 'Grundsteuer 2025 (anteilig 01.01.–30.04.2025)'],
    ['2025-05', 245, 32219, 'Grundsteuer 2025 (anteilig 01.05.–31.12.2025)'],
  ])
})

test('Nach einem Wechsel heißt derselbe Rumpf 2025-01 (F18)', () => {
  const parts = splitByService(WECHSEL, { id: 'g', description: 'Grundsteuer 2025', amountCents: 48000, serviceFrom: '2025-01-01', serviceTo: '2025-12-31' })
  assert.deepEqual(parts.map((p) => [p.period.key, p.amountCents]), [['2025-01', 15781], ['2025-05', 32219]])
})

test('Summe exakt, §35a im selben Verhältnis, Restcent nach der Kennung', () => {
  const parts = splitByService(MAI, { id: 'h', description: 'Hauswart', amountCents: 100000, labor35aCents: 60000, serviceFrom: '2025-03-01', serviceTo: '2025-06-30' })
  // März und April: 61 Tage, Mai und Juni: 61 Tage, also je die Hälfte.
  assert.deepEqual(parts.map((p) => [p.amountCents, p.labor35aCents]), [[50000, 30000], [50000, 30000]])
  const drei = splitByService(MAI, { id: 'x', description: 'X', amountCents: 100, serviceFrom: '2025-04-30', serviceTo: '2025-05-01' })
  assert.deepEqual(drei.map((p) => p.amountCents), [50, 50])
  assert.equal(drei.reduce((a, p) => a + p.amountCents, 0), 100)
})

test('Eine Gutschrift bleibt in jedem Teil negativ, die Summe stimmt (Review Focus 2)', () => {
  const parts = splitByService(MAI, { id: 'gs', description: 'Gutschrift Versicherung', amountCents: -10001, serviceFrom: '2025-01-01', serviceTo: '2025-12-31' })
  assert.ok(parts.every((p) => p.amountCents < 0), 'jeder Teil negativ')
  assert.equal(parts.reduce((a, p) => a + p.amountCents, 0), -10001)
  assert.ok(parts.every((p) => p.labor35aCents === null), 'kein §35a an einer Gutschrift')
})

test('Ein Leistungszeitraum in einem einzigen Zeitraum ergibt einen Teil ohne Zusatz', () => {
  const parts = splitByService(MAI, { id: 'w', description: 'Wasser', amountCents: 9000, serviceFrom: '2025-05-01', serviceTo: '2026-04-30' })
  assert.deepEqual(parts.map((p) => [p.period.key, p.amountCents, p.description]), [['2025-05', 9000, 'Wasser']])
})

test('Ein zweites Aufteilen hängt keinen zweiten Zusatz an', () => {
  assert.equal(baseDescription('Grundsteuer 2025 (anteilig 01.01.–30.04.2025)'), 'Grundsteuer 2025')
  assert.equal(baseDescription('Grundsteuer 2025'), 'Grundsteuer 2025')
})

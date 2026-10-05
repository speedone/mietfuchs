// Gradtage (#208, Entwurf 3.5): Die Tabelle steht im Rechtsregister (`hkv.degree-days`), die
// Rechnung über Tage und Vereinigungen in shared/degreeDays.ts. Geprüft wird an den Zahlen des
// Entwurfs (3.2, 3.7, 12.2) und an Schaltjahren.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { degreeDayPermille, unionDays, unionOf, yearDaysFrom } from '../../shared/degreeDays.ts'
import { hkvDegreeDays } from '../../shared/law/heizkostenv.ts'
import { onlyVersion } from '../../shared/law/register.ts'

const table = onlyVersion(hkvDegreeDays).value
const pm = (from: string, to: string): number => degreeDayPermille([{ from, to }], table)
const close = (actual: number, expected: number, what: string): void =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${what}: ${actual} statt ${expected}`)

test('Gradtage: ein Jahr hat 1.000 Promille, auch über den Jahreswechsel und im Schaltjahr', () => {
  close(pm('2025-01-01', '2025-12-31'), 1000, 'Kalenderjahr 2025')
  close(pm('2024-03-01', '2025-02-28'), 1000, 'März 2024 bis Februar 2025 (Entwurf C5)')
  close(pm('2028-01-01', '2028-12-31'), 1000, 'Schaltjahr 2028')
  close(pm('2024-01-01', '2025-01-31'), 1170, 'dreizehn Monate liegen über 1.000')
})

test('Gradtage: die Zahlen des Entwurfs (3.2, 3.7)', () => {
  close(pm('2025-01-01', '2025-04-30'), 530, 'Winter-Rumpf Januar bis April')
  close(pm('2025-01-01', '2025-02-28'), 320, 'Januar und Februar')
  close(pm('2025-03-01', '2025-04-30'), 210, 'März und April')
  close(pm('2025-05-01', '2025-08-31'), 80, 'Sommer-Rumpf Mai bis August')
  assert.equal(pm('2025-03-15', '2025-12-31').toFixed(2), '621.29')
  assert.equal(pm('2025-05-01', '2026-03-14').toFixed(2), '848.71')
})

test('Gradtage: Tageswerte, der 29. Februar und der Sommer', () => {
  close(pm('2025-10-01', '2025-10-01'), 80 / 31, 'ein Oktobertag ist 80/31 (ista)')
  close(pm('2028-02-29', '2028-02-29'), 150 / 29, 'der 29.02. im Schaltjahr ist 150/29')
  close(pm('2028-02-01', '2028-02-29'), 150, 'der ganze Februar bleibt 150')
  close(pm('2025-07-15', '2025-07-15'), 40 / 92, 'ein Sommertag ist 40/92')
})

test('Gradtage: die Vereinigung zählt Überschneidungen einmal und fasst Angrenzendes zusammen', () => {
  const ranges = [{ from: '2025-03-01', to: '2025-04-30' }, { from: '2025-01-01', to: '2025-02-28' }, { from: '2025-02-01', to: '2025-03-31' }]
  assert.deepEqual(unionOf(ranges), [{ from: '2025-01-01', to: '2025-04-30' }])
  close(degreeDayPermille(ranges, table), 530, 'Januar bis April einmal')
  assert.equal(unionDays([{ from: '2025-01-01', to: '2025-02-28' }, { from: '2025-03-01', to: '2025-04-30' }]), 120)
  assert.deepEqual(unionOf([{ from: '2025-01-01', to: '2025-01-31' }, { from: '2025-03-01', to: '2025-03-31' }]),
    [{ from: '2025-01-01', to: '2025-01-31' }, { from: '2025-03-01', to: '2025-03-31' }], 'eine Lücke bleibt eine Lücke')
  assert.equal(degreeDayPermille([], table), 0)
})

test('Tage der zwölf Monate ab einem Beginn: 365, über einen 29. Februar 366', () => {
  assert.equal(yearDaysFrom('2025-01-01'), 365)
  assert.equal(yearDaysFrom('2028-01-01'), 366)
  assert.equal(yearDaysFrom('2027-05-01'), 366)
  assert.equal(yearDaysFrom('2028-05-01'), 365)
})

test('Register: hkv.degree-days nennt § 9b Abs. 2, gilt nach dem Beginn des Zeitraums und hat zwölf Monate', () => {
  assert.equal(hkvDegreeDays.timing, 'periodStart')
  assert.match(hkvDegreeDays.norm, /§ 9b Abs\. 2 HeizkostenV/)
  const months = [...Object.keys(table.months), ...table.summerMonths].sort()
  assert.deepEqual(months, ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'])
  const sum = Object.values(table.months).reduce((a, n) => a + n, 0) + table.summer
  assert.equal(sum, 1000)
})

// Gemerkte Zwischenwerte der Berechnung (#651, Schritt 2): Sie dürfen nie etwas anderes ergeben
// als die Rechnung ohne Merken.
//
// Gemerkt wird nur, was sich nicht mehr ändern kann: Datumstexte (der Wert hängt nur am Text) und
// eingefrorene Staffeln (der Bestand aus `readStock` ist tief eingefroren). Eine Staffel, die nicht
// eingefroren ist, etwa im Formular des Mietverhältnisses, wird bei jedem Aufruf neu sortiert;
// sonst lieferte eine nachträglich geänderte Staffel die alte Rate.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { overlapDays, rateAtMonth, rateInMonth, type MonthlySchedule } from '../../shared/monthRate.ts'

test('Gemerkt: eine veränderte, nicht eingefrorene Staffel ergibt die neue Rate', () => {
  const schedule: MonthlySchedule[] = [{ from: '2024-01', monthlyCents: 15000 }]
  assert.equal(rateAtMonth(schedule, '2024-06'), 15000)
  schedule.push({ from: '2024-05', monthlyCents: 18000 })
  assert.equal(rateAtMonth(schedule, '2024-06'), 18000)
  const first = schedule[0]
  if (!first) return assert.fail('die Staffel ist leer')
  first.monthlyCents = 1
  assert.equal(rateAtMonth(schedule, '2024-04'), 1)
})

test('Gemerkt: eine eingefrorene Staffel ergibt dieselben Raten wie eine offene, in jeder Reihenfolge', () => {
  const entries: MonthlySchedule[] = [
    { from: '2025-03', monthlyCents: 21000 },
    { from: '2024-01', monthlyCents: 15000 },
    { from: '2024-07', monthlyCents: 18000 },
  ]
  const frozen = Object.freeze(entries.map((e) => Object.freeze({ ...e })))
  const t = { start: '2024-01-15', end: '2025-05-20' }
  for (let y = 2023; y <= 2026; y++) {
    for (let m = 1; m <= 12; m++) {
      const month = `${y}-${String(m).padStart(2, '0')}`
      assert.equal(rateAtMonth(frozen, month), rateAtMonth(entries.slice(), month), month)
      assert.equal(rateInMonth(frozen, t, month), rateInMonth(entries.slice(), t, month), month)
    }
  }
})

test('Gemerkt: Tagesüberlappung über Monats-, Jahres- und Schaltjahrgrenzen wie ohne Merken', () => {
  const days = (a: string, b: string): number => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86400000) + 1
  const cases: [string, string, string, string | null][] = [
    ['2024-02-01', '2024-02-29', '2024-01-15', null],
    ['2023-12-31', '2024-01-01', '2023-12-31', '2024-01-01'],
    ['2024-03-01', '2024-03-31', '2024-03-15', '2024-03-15'],
  ]
  for (let round = 0; round < 3; round++) {
    for (const [aS, aE, bS, bE] of cases) {
      const from = aS > bS ? aS : bS
      const to = bE === null || aE < bE ? aE : bE
      assert.equal(overlapDays(aS, aE, bS, bE), to < from ? 0 : days(from, to), `${aS}..${aE} / ${bS}..${bE}`)
    }
  }
  assert.equal(overlapDays('2024-05-01', '2024-04-30', '2024-01-01', null), 0)
})

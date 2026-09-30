// Kabelfernsehen (#107): Seit dem 01.07.2024 sind die Gebühren für das TV-Signal nicht mehr als
// Betriebskosten umlagefähig (Wegfall des Nebenkostenprivilegs, § 2 Nr. 15 BetrKV a. F.,
// Übergangsfrist bis 30.06.2024, nur für Anlagen vor dem 01.12.2021, § 2 Satz 2 BetrKV). Danach bleibt
// bei solchen Anlagen nur der Betriebsstrom, bei einer Gemeinschaftsantenne auch Prüfung und Einstellung.
// Mietfuchs kann das eine vom anderen nicht unterscheiden und kürzt deshalb nicht selbst; es
// warnt, und zwar abhängig vom Abrechnungsjahr.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement } from '../src/calc.ts'
import { snapshotOf, type SnapshotSource } from '../src/snapshot.ts'

const bestand = (year: number, category = 'Kabel/Antenne'): SnapshotSource => ({
  units: [{ id: 'u', name: 'EG', areaM2: 50, participates: true }],
  tenancies: [{
    id: 't', unitId: 'u', tenantName: 'Meier', persons: 1, personHistory: [], start: '2020-01-01', end: null,
    prepayments: [], prepaymentOverrides: {}, baseRents: [],
  }],
  costItems: [{ id: 'k', year, category, description: 'Kabelanschluss', amountCents: 12000, key: 'units' }],
  meters: [], readings: [], payments: [], closedSettlements: [],
})
const warningsFor = (year: number, category?: string) => computeSettlement(snapshotOf(bestand(year, category), year)).warnings

test('Kabel: bis einschließlich 2023 keine Warnung', () => {
  assert.deepEqual(warningsFor(2023), [])
})

test('Kabel: 2024 ist das TV-Signal nur bis zum 30.06. umlagefähig', () => {
  const w = warningsFor(2024)
  assert.equal(w.length, 1)
  assert.match(w[0] ?? '', /30\.06\.2024/)
  assert.match(w[0] ?? '', /Betriebsstrom|Wartung/)
})

test('Kabel: ab 2025 ist das TV-Signal nicht mehr umlagefähig', () => {
  const w = warningsFor(2025)
  assert.equal(w.length, 1)
  assert.match(w[0] ?? '', /nicht mehr umlagefähig/)
})

test('Kabel: die Zahlen bleiben, wie sie eingetragen sind', () => {
  // Mietfuchs kürzt nicht selbst: Die Position kann Betriebsstrom oder Wartung enthalten.
  const s = computeSettlement(snapshotOf(bestand(2025), 2025))
  assert.equal(s.statements[0]?.totalShareCents, 12000)
})

test('Kabel: nicht umlagefähig verbucht, gibt es nichts zu warnen', () => {
  assert.deepEqual(warningsFor(2025, 'Nicht umlagefähig'), [])
})

test('Kabel: eine Anlage ab dem 01.12.2021 war nie umlagefähig, auch 2022 und 2023 nicht (#121)', () => {
  const mit = (year: number, before: boolean | null) =>
    computeSettlement({ ...snapshotOf(bestand(year), year), property: { kind: 'mfh', cableBuiltBeforeDec2021: before } }).notices
  for (const year of [2022, 2023, 2025]) {
    const n = mit(year, false)
    assert.deepEqual(n.map((x) => x.code), ['tv-signal.new-system'], String(year))
    assert.match(n[0]?.text ?? '', /nie umlagefähig/)
    assert.equal(n[0]?.rule, 'tv-signal')
  }
  // Vor dem 01.12.2021 errichtet oder unbekannt: wie bisher.
  assert.deepEqual(mit(2023, true), [])
  assert.deepEqual(mit(2023, null), [])
  assert.deepEqual(mit(2025, true).map((x) => x.code), ['tv-signal.ended'])
})

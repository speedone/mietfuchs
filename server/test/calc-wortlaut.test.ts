// Wortlaut der Hinweise (#180): Ein- und Mehrzahl statt „Wohnung(en)“, Aufzählungen mit „und“,
// die Zählerart mit ihrer Beschriftung statt des gespeicherten Werts, und typografische
// Anführungszeichen auf beiden Seiten. Neue Abrechnungen sprechen so; eine abgeschlossene behält
// den Wortlaut, mit dem sie eingefroren wurde, denn sie liefert ihre gespeicherten Texte.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { andList, countOf, meterTypeLabel } from '../../shared/wording.ts'
import { snapshotOf, type SnapshotCostItem, type SnapshotMeter, type SnapshotReading, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'

const unit = (id: string, over: Partial<SnapshotUnit> = {}): SnapshotUnit => ({ id, name: id, areaM2: 50, participates: true, ...over })
const tenancy = (id: string, unitId: string, persons = 1): SnapshotTenancy => ({
  id, unitId, tenantName: id, persons, personHistory: [{ from: '2020-01-01', persons }], start: '2020-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [],
})
const item = (id: string, key: SnapshotCostItem['key'], over: Partial<SnapshotCostItem> = {}): SnapshotCostItem =>
  ({ id, year: 2025, category: 'Grundsteuer', description: id, amountCents: 100000, key, ...over })
const settle = (s: Partial<SnapshotSource>): ComputedSettlement => computeSettlement(snapshotOf({
  units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [], ...s,
}, 2025))
const textOf = (s: ComputedSettlement, code: string): string => {
  const n = s.notices.find((x) => x.code === code)
  if (!n) assert.fail(`kein Hinweis ${code}, sondern: ${s.notices.map((x) => x.code).join(', ')}`)
  return n.text
}

test('Helfer: Aufzählung mit „und“, Anzahl mit Ein- und Mehrzahl, Beschriftung der Zählerart', () => {
  assert.equal(andList([]), '')
  assert.equal(andList(['A']), 'A')
  assert.equal(andList(['A', 'B']), 'A und B')
  assert.equal(andList(['A', 'B', 'C']), 'A, B und C')
  assert.equal(countOf(1, 'Position', 'Positionen'), '1 Position')
  assert.equal(countOf(0, 'Position', 'Positionen'), '0 Positionen')
  assert.equal(countOf(3, 'Position', 'Positionen'), '3 Positionen')
  assert.equal(meterTypeLabel('kaltwasser'), 'Kaltwasser')
  assert.equal(meterTypeLabel('unbekannt'), 'unbekannt')
  assert.equal(meterTypeLabel(null), '—')
})

test('Fehlende Wohnfläche: eine Einheit in der Einzahl, zwei mit „und“', () => {
  const one = settle({
    units: [unit('EG', { areaM2: 80 }), unit('G', { areaM2: 0 })],
    tenancies: [tenancy('t1', 'EG'), tenancy('t2', 'G')],
    costItems: [item('Grundsteuer', 'area')],
  })
  assert.equal(textOf(one, 'basis.unit-no-area'), 'Für die Einheit G ist keine Wohnfläche hinterlegt — der Flächenschlüssel verteilt ihren Anteil auf die übrigen Wohnungen.')
  const two = settle({
    units: [unit('EG', { areaM2: 80 }), unit('OG', { areaM2: 0 }), unit('DG', { areaM2: 0 })],
    tenancies: [tenancy('t1', 'EG'), tenancy('t2', 'OG'), tenancy('t3', 'DG')],
    costItems: [item('Grundsteuer', 'area')],
  })
  assert.equal(textOf(two, 'basis.unit-no-area'), 'Für die Einheiten OG und DG ist keine Wohnfläche hinterlegt — der Flächenschlüssel verteilt ihren Anteil auf die übrigen Wohnungen.')
})

test('Selbstgenutzte Wohnung ohne Fläche oder Personen: Einzahl statt „selbstgenutzte(n) Wohnung(en)“', () => {
  const s = settle({
    units: [unit('EG', { areaM2: 80 }), unit('OG', { areaM2: 0, participates: false, selfUsed: true, selfPersons: 0 })],
    tenancies: [tenancy('t1', 'EG')],
    costItems: [item('Grundsteuer', 'area'), item('Müll', 'persons')],
  })
  assert.equal(textOf(s, 'basis.self-no-area'), 'Für die selbstgenutzte Wohnung OG ist keine Wohnfläche hinterlegt — der Flächenschlüssel verteilt nur auf die Mieter.')
  assert.equal(textOf(s, 'basis.self-no-persons'), 'Für die selbstgenutzte Wohnung OG ist keine Personenzahl hinterlegt — der Personenschlüssel verteilt nur auf die Mieter.')
  const two = settle({
    units: [unit('EG', { areaM2: 80 }), unit('OG', { areaM2: 0, participates: false, selfUsed: true }), unit('DG', { areaM2: 0, participates: false, selfUsed: true })],
    tenancies: [tenancy('t1', 'EG')],
    costItems: [item('Grundsteuer', 'area')],
  })
  assert.equal(textOf(two, 'basis.self-no-area'), 'Für die selbstgenutzten Wohnungen OG und DG ist keine Wohnfläche hinterlegt — der Flächenschlüssel verteilt nur auf die Mieter.')
})

test('Einheit ohne Fläche: Einheiten und Positionen mit „und“ aufgezählt', () => {
  const s = settle({
    units: [unit('Wohnung', { areaM2: 80 }), unit('G1', { areaM2: 0 }), unit('G2', { areaM2: 0 })],
    tenancies: [tenancy('tw', 'Wohnung', 2), tenancy('t1', 'G1', 0), tenancy('t2', 'G2', 0)],
    costItems: [item('Grundsteuer', 'area'), item('Versicherung', 'area')],
  })
  assert.match(textOf(s, 'basis.unit-zero'), /^Für G1 und G2 sind 0 m² und 0 Personen eingetragen; bei „Grundsteuer“ und „Versicherung“ tragen sie nichts/)
})

test('Wohnung ohne Zähler: die Zählerart mit Beschriftung, die Einheiten mit „und“', () => {
  const meter = (id: string, unitId: string | null): SnapshotMeter => ({ id, unitId, type: 'kaltwasser' })
  const used = (meterId: string, amount: number): SnapshotReading[] => [
    { meterId, date: '2024-12-31', value: 0 }, { meterId, date: '2025-12-31', value: amount },
  ]
  const s = settle({
    units: [unit('A'), unit('B'), unit('C')],
    tenancies: [tenancy('t-a', 'A'), tenancy('t-b', 'B'), tenancy('t-c', 'C')],
    costItems: [item('Wasser', 'meter', { category: 'Wasser/Abwasser', meterType: 'kaltwasser' })],
    meters: [meter('za', 'A')],
    readings: used('za', 30),
  })
  assert.match(textOf(s, 'meter.unit-without-meter'), /^„Wasser“: für B und C gibt es keinen abgelesenen Zähler „Kaltwasser“ — /)
})

test('Kein Verbrauch erfasst: die Zählerart mit Beschriftung', () => {
  const s = settle({
    units: [unit('A')],
    tenancies: [tenancy('t-a', 'A')],
    costItems: [item('Wasser', 'meter', { category: 'Wasser/Abwasser', meterType: 'kaltwasser' })],
  })
  assert.equal(textOf(s, 'meter.no-consumption'), '„Wasser“: kein Verbrauch für Zählertyp „Kaltwasser“ erfasst — Betrag geht an den Vermieter.')
})

test('Hinweise der Berechnung schließen kein typografisches Anführungszeichen mit einem geraden', () => {
  const s = settle({
    units: [unit('A'), unit('B', { areaM2: 0 })],
    tenancies: [tenancy('t-a', 'A'), tenancy('t-b', 'B')],
    costItems: [
      item('Kabel', 'area', { category: 'Kabelfernsehen' }),
      item('Wasser', 'meter', { category: 'Wasser/Abwasser', meterType: 'kaltwasser' }),
      item('Heizung', 'area', { category: 'Heizung und Warmwasser' }),
      item('Anteile', 'custom'),
    ],
  })
  assert.ok(s.notices.length >= 4, s.notices.map((n) => n.code).join(', '))
  for (const n of s.notices) assert.doesNotMatch(n.text, /„[^“"]*"/, `${n.code}: ${n.text}`)
})

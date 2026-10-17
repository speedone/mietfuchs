// Woraus der Vermieteranteil einer Position besteht (#142). Die Spalte „Grund“ der Abrechnung
// sagte bisher immer „Eigennutzung / Leerstand / Rundung / keine Verteilbasis“, auch wenn eine
// Pauschale oder eine Inklusivmiete die Ursache war. Jetzt zerlegt die Berechnung den Betrag in
// seine Gründe; jede Zeile hier ist von Hand nachgerechnet. Die Zahlen selbst bleiben, wie sie
// waren: Die Zerlegung beschreibt den Vermieteranteil, sie verändert ihn nicht.

import { calendarPeriod } from '../../shared/period.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { snapshotOf, type SnapshotCostItem, type SnapshotMeter, type SnapshotReading, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'
import type { LandlordPart } from '../../shared/types.ts'

const tenancy = (id: string, unitId: string, over: Partial<SnapshotTenancy> = {}): SnapshotTenancy => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [{ from: '2025-01-01', persons: 1 }], start: '2025-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [], ...over,
})
const unit = (id: string, over: Partial<SnapshotUnit> = {}): SnapshotUnit => ({ id, name: id, areaM2: 50, participates: true, ...over })
const item = (over: Partial<SnapshotCostItem> = {}): SnapshotCostItem => ({
  id: 'k', period: calendarPeriod(2025), category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 100000, key: 'area', ...over,
})
const settle = (s: Partial<SnapshotSource>): ComputedSettlement => computeSettlement(snapshotOf({
  units: [], tenancies: [], costItems: [item()], meters: [], readings: [], payments: [], closedSettlements: [], ...s,
}, 2025))
const partsOf = (s: ComputedSettlement, id = 'k'): LandlordPart[] | undefined => {
  const row = s.landlord.rows.find((r) => r.costItemId === id)
  if (!row) return assert.fail(`keine Zeile des Vermieteranteils für ${id}`)
  return row.landlordParts
}

test('Vermieteranteil: Pauschale', () => {
  const s = settle({
    units: [unit('a'), unit('b')],
    tenancies: [tenancy('t-a', 'a', { costModel: 'flatRate', flatRates: [{ from: '2025-01', monthlyCents: 8000 }] }), tenancy('t-b', 'b')],
  })
  assert.deepEqual(partsOf(s), [{ reason: 'flatRate', cents: 50000 }])
})

test('Vermieteranteil: Inklusivmiete', () => {
  const s = settle({
    units: [unit('a'), unit('b')],
    tenancies: [tenancy('t-a', 'a', { costModel: 'inclusive' }), tenancy('t-b', 'b')],
  })
  assert.deepEqual(partsOf(s), [{ reason: 'inclusive', cents: 50000 }])
})

test('Vermieteranteil: Eigennutzung', () => {
  const s = settle({
    units: [unit('a'), unit('eigen', { participates: false, selfUsed: true })],
    tenancies: [tenancy('t-a', 'a')],
  })
  assert.deepEqual(partsOf(s), [{ reason: 'selfUse', cents: 50000 }])
})

test('Vermieteranteil: Leerstand', () => {
  const s = settle({ units: [unit('a'), unit('b')], tenancies: [tenancy('t-a', 'a')] })
  assert.deepEqual(partsOf(s), [{ reason: 'vacancy', cents: 50000 }])
})

test('Vermieteranteil: nicht umlagefähig', () => {
  const s = settle({
    units: [unit('a')], tenancies: [tenancy('t-a', 'a')],
    costItems: [item({ category: 'Nicht umlagefähig', description: 'Kontoführung' })],
  })
  assert.deepEqual(partsOf(s), [{ reason: 'notAllocable', cents: 100000 }])
})

test('Vermieteranteil: keine Verteilbasis', () => {
  const s = settle({ units: [unit('a', { areaM2: 0 })], tenancies: [tenancy('t-a', 'a')] })
  assert.deepEqual(partsOf(s), [{ reason: 'noBasis', cents: 100000 }])
})

test('Vermieteranteil: Eigennutzung bekommt bei Gleichstand den Restcent, einen Rundungsrest gibt es nicht mehr (#202)', () => {
  // 1,00 € auf drei gleiche Wohnungen, eine davon selbstgenutzt: exakt je 33,33 Cent. Die drei
  // Zeilen werden gemeinsam verteilt; bei gleichem Rest geht der Cent an den Vermieter, also die
  // Mieter je 33 Cent und der Eigenanteil 34 Cent. Vorher stand der Cent als „Rundung“ daneben.
  const s = settle({
    units: [unit('a'), unit('b'), unit('eigen', { participates: false, selfUsed: true })],
    tenancies: [tenancy('t-a', 'a'), tenancy('t-b', 'b')],
    costItems: [item({ amountCents: 100 })],
  })
  assert.deepEqual(partsOf(s), [{ reason: 'selfUse', cents: 34 }])
  assert.equal(s.selfUsedShareCents, 34)
})

test('Vermieteranteil: Rest nach Einzelbeträgen', () => {
  const s = settle({
    units: [unit('a')], tenancies: [tenancy('t-a', 'a')],
    costItems: [item({ key: 'amounts', amountCents: 10000, tenancyAmounts: { 't-a': 6000 } })],
  })
  assert.deepEqual(partsOf(s), [{ reason: 'amountsRest', cents: 4000 }])
})

test('Vermieteranteil: vereinbarte Anteile unter 100 %', () => {
  const s = settle({
    units: [unit('a')], tenancies: [tenancy('t-a', 'a')],
    costItems: [item({ key: 'custom', customShares: { a: 60 } })],
  })
  assert.deepEqual(partsOf(s), [{ reason: 'customRest', cents: 40000 }])
})

test('Vermieteranteil: Wohnung außerhalb der Abrechnungseinheit', () => {
  const s = settle({
    units: [unit('a'), unit('gewerbe', { participates: false })],
    tenancies: [tenancy('t-a', 'a'), tenancy('t-g', 'gewerbe')],
    costItems: [item({ key: 'direct', directUnitId: 'gewerbe' })],
  })
  assert.deepEqual(partsOf(s), [{ reason: 'outsideUnit', cents: 100000 }])
})

test('Vermieteranteil: Rest des Hauptzählers', () => {
  const meter = (id: string, unitId: string | null): SnapshotMeter => ({ id, unitId, type: 'kaltwasser' })
  const used = (meterId: string, amount: number): SnapshotReading[] => [
    { meterId, date: '2024-12-31', value: 0 }, { meterId, date: '2025-12-31', value: amount },
  ]
  const s = settle({
    units: [unit('a'), unit('b')],
    tenancies: [tenancy('t-a', 'a', { start: '2024-01-01' }), tenancy('t-b', 'b', { start: '2024-01-01' })],
    costItems: [item({ category: 'Wasser/Abwasser', description: 'Wasser', key: 'meter', meterType: 'kaltwasser' })],
    meters: [meter('hz', null), meter('za', 'a')],
    readings: [...used('hz', 100), ...used('za', 30)],
  })
  assert.deepEqual(partsOf(s), [{ reason: 'mainMeterRest', cents: 70000 }])
})

test('Vermieteranteil: mehrere Gründe in einer Position, zusammen genau der Anteil', () => {
  // Vier gleiche Wohnungen zu je 250 €: eine mit Pauschale, eine selbstgenutzt, eine leer, eine
  // abgerechnet.
  const s = settle({
    units: [unit('a'), unit('b'), unit('leer'), unit('eigen', { participates: false, selfUsed: true })],
    tenancies: [tenancy('t-a', 'a', { costModel: 'flatRate' }), tenancy('t-b', 'b')],
  })
  assert.deepEqual(partsOf(s), [
    { reason: 'selfUse', cents: 25000 },
    { reason: 'flatRate', cents: 25000 },
    { reason: 'vacancy', cents: 25000 },
  ])
  assert.equal(s.landlord.totalCents, 75000, 'die Zahl bleibt dieselbe')
})

test('Vermieteranteil: eine Gutschrift zerlegt sich mit ihrem Vorzeichen', () => {
  const s = settle({ units: [unit('a'), unit('b')], tenancies: [tenancy('t-a', 'a')], costItems: [item({ amountCents: -10000 })] })
  assert.deepEqual(partsOf(s), [{ reason: 'vacancy', cents: -5000 }])
})

// Befunde der Durchsicht: Leerstand, Wohnungen außerhalb und der Rest des Hauptzählers getrennt.
const meter = (id: string, unitId: string | null): SnapshotMeter => ({ id, unitId, type: 'kaltwasser' })
const used = (meterId: string, amount: number): SnapshotReading[] => [
  { meterId, date: '2024-12-31', value: 0 }, { meterId, date: '2025-12-31', value: amount },
]
const water = item({ category: 'Wasser/Abwasser', description: 'Wasser', key: 'meter', meterType: 'kaltwasser' })

test('Vermieteranteil, Verbrauch: der Zähler einer Wohnung außerhalb der Abrechnungseinheit ist kein Leerstand', () => {
  const s = settle({
    units: [unit('a'), unit('gewerbe', { participates: false })],
    tenancies: [tenancy('t-a', 'a', { start: '2024-01-01' }), tenancy('t-g', 'gewerbe', { start: '2024-01-01' })],
    costItems: [water],
    meters: [meter('za', 'a'), meter('zg', 'gewerbe')],
    readings: [...used('za', 40), ...used('zg', 60)],
  })
  assert.deepEqual(partsOf(s), [{ reason: 'outsideUnit', cents: 60000 }])
})

test('Vermieteranteil, Hauptzähler: gemessener Verbrauch einer leeren Wohnung ist Leerstand, nur der ungemessene Rest gehört zum Hauptzähler', () => {
  // Hauptzähler 100 m³, A vermietet 30, B leer 20, C vermietet ohne Zähler; 1.000 € Wasser.
  const s = settle({
    units: [unit('a'), unit('b'), unit('c')],
    tenancies: [tenancy('t-a', 'a', { start: '2024-01-01' }), tenancy('t-c', 'c', { start: '2024-01-01' })],
    costItems: [water],
    meters: [meter('hz', null), meter('za', 'a'), meter('zb', 'b')],
    readings: [...used('hz', 100), ...used('za', 30), ...used('zb', 20)],
  })
  assert.deepEqual(partsOf(s), [{ reason: 'mainMeterRest', cents: 50000 }, { reason: 'vacancy', cents: 20000 }])
})

test('Vermieteranteil, vereinbarte Anteile: der verfallene Anteil einer Wohnung außerhalb ist kein „nicht vereinbarter Anteil“', () => {
  const s = settle({
    units: [unit('a'), unit('g', { participates: false })],
    tenancies: [tenancy('t-a', 'a')],
    costItems: [item({ key: 'custom', customShares: { a: 70, g: 30 } })],
  })
  assert.deepEqual(partsOf(s), [{ reason: 'outsideUnit', cents: 30000 }])
})

// Die Heizanlage in der Berechnung (Heizung PR 4). Eine Anlage ändert in dieser Version keine Zahl
// (Entwurf 11.2, A2); neu gerechnet werden nur zwei Dinge, und beide greifen erst mit Angaben, die
// es vorher nicht gab: Zähler der Anlage sind keine Hauptzähler des Hauses, und Warmwasserzähler
// zählen beim Kaltwasser mit (G-B8). Weiter unten: Fernablesbarkeit (#214) und Zweifamilienhaus (#180).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import {
  snapshotOf, type SnapshotCostItem, type SnapshotHeatingPlant, type SnapshotMeter, type SnapshotReading, type SnapshotSource,
  type SnapshotTenancy, type SnapshotUnit,
} from '../src/snapshot.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { calendarPeriod } from '../../shared/period.ts'

const unit = (id: string, over: Partial<SnapshotUnit> = {}): SnapshotUnit => ({ id, name: id, areaM2: 50, participates: true, ...over })
const tenancy = (id: string, unitId: string, over: Partial<SnapshotTenancy> = {}): SnapshotTenancy => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [], start: '2020-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [], ...over,
})
const item = (id: string, year: number, over: Partial<SnapshotCostItem>): SnapshotCostItem => ({
  id, period: calendarPeriod(year), category: 'Wasserversorgung', description: id, amountCents: 200000, key: 'area', ...over,
})
const meter = (id: string, unitId: string | null, type: SnapshotMeter['type'], over: Partial<SnapshotMeter> = {}): SnapshotMeter => ({ id, unitId, type, ...over })
// Ein Zähler über das ganze Jahr: Stand am 31.12. des Vorjahres und am 31.12.
const wholeYear = (meterId: string, y: number, from: number, to: number): SnapshotReading[] => [
  { meterId, date: `${y - 1}-12-31`, value: from },
  { meterId, date: `${y}-12-31`, value: to },
]
const source = (s: Partial<SnapshotSource>): SnapshotSource => ({
  units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [], ...s,
})
const settle = (s: Partial<SnapshotSource>, y = 2025, plants?: SnapshotHeatingPlant[]): ComputedSettlement =>
  computeSettlement({ ...snapshotOf(source(s), y), ...(plants === undefined ? {} : { heatingPlants: plants }) })
const share = (r: ComputedSettlement, tenancyId: string, itemId: string): number | undefined =>
  r.statements.find((st) => st.tenancyId === tenancyId)?.rows.find((row) => row.costItemId === itemId)?.shareCents
const plant = (over: Partial<SnapshotHeatingPlant> = {}): SnapshotHeatingPlant => ({
  id: 'hp1', method: 'manual', source: 'building', devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', units: null, ...over,
})

// ---------- Wasserschlüssel (G-B8) ----------

test('Wasser (G-B8): Warmwasserzähler zählen beim Kaltwasser mit; nur mit Warmwasserzähler gilt der Hauptzähler', () => {
  const r = settle({
    units: [unit('a'), unit('b')],
    tenancies: [tenancy('ta', 'a'), tenancy('tb', 'b')],
    meters: [meter('haus', null, 'kaltwasser'), meter('a-kalt', 'a', 'kaltwasser'), meter('a-warm', 'a', 'warmwasser'), meter('b-warm', 'b', 'warmwasser')],
    readings: [...wholeYear('haus', 2025, 0, 200), ...wholeYear('a-kalt', 2025, 0, 60), ...wholeYear('a-warm', 2025, 0, 20), ...wholeYear('b-warm', 2025, 0, 30)],
    costItems: [item('wasser', 2025, { key: 'meter', meterType: 'kaltwasser' })],
  })
  // b hat keinen Kaltwasserzähler, also ist der Hauptzähler die Basis (200 m³): a trägt 80 m³ (kalt
  // und warm), b seine 30 m³ Warmwasser, die übrigen 90 m³ bleiben beim Vermieter (#116). Vorher
  // trug a nur seine 60 m³ Kaltwasser, und die 20 m³ Warmwasser landeten beim Vermieter.
  assert.equal(share(r, 'ta', 'wasser'), 80000)
  assert.equal(share(r, 'tb', 'wasser'), 30000)
  assert.ok(r.notices.some((n) => n.code === 'meter.unit-without-meter' && n.text.includes('für b gibt es keinen abgelesenen Zähler „Kaltwasser“')))
})

test('Wasser (G-B8): ohne Hauptzähler ist die Basis kalt und warm zusammen; der Schlüssel Warmwasser nur warm', () => {
  const r = settle({
    units: [unit('a'), unit('b')],
    tenancies: [tenancy('ta', 'a'), tenancy('tb', 'b')],
    meters: [meter('a-kalt', 'a', 'kaltwasser'), meter('a-warm', 'a', 'warmwasser'), meter('b-kalt', 'b', 'kaltwasser'), meter('b-warm', 'b', 'warmwasser')],
    readings: [...wholeYear('a-kalt', 2025, 0, 60), ...wholeYear('a-warm', 2025, 0, 20), ...wholeYear('b-kalt', 2025, 0, 30), ...wholeYear('b-warm', 2025, 0, 30)],
    costItems: [
      item('wasser', 2025, { key: 'meter', meterType: 'kaltwasser' }),
      item('warm', 2025, { amountCents: 60000, key: 'meter', meterType: 'warmwasser' }),
    ],
  })
  // 80 und 60 von 140 m³: 114.285,71 und 85.714,29 Cent, der Restcent geht an den größeren Rest.
  // Vorher 60 und 30 von 90 m³: 133.333 und 66.667 Cent.
  assert.equal(share(r, 'ta', 'wasser'), 114286)
  assert.equal(share(r, 'tb', 'wasser'), 85714)
  assert.equal(share(r, 'ta', 'warm'), 24000)
  assert.equal(share(r, 'tb', 'warm'), 36000)
})

// ---------- Zähler der Anlage ----------

test('Ein Zähler der Heizanlage ist kein Hauptzähler des Hauses', () => {
  const ohne: Partial<SnapshotSource> = {
    units: [unit('a'), unit('b')],
    tenancies: [tenancy('ta', 'a'), tenancy('tb', 'b')],
    meters: [meter('a-waerme', 'a', 'waerme')],
    readings: wholeYear('a-waerme', 2025, 0, 1000),
    costItems: [item('heizung', 2025, { category: HEATING_CATEGORY, amountCents: 100000, key: 'meter', meterType: 'waerme' })],
  }
  const mit: Partial<SnapshotSource> = {
    ...ohne,
    meters: [...(ohne.meters ?? []), meter('speicher', null, 'waerme', { heatingPlantId: 'hp1', heatingRole: 'dhwHeat' })],
    readings: [...(ohne.readings ?? []), ...wholeYear('speicher', 2025, 0, 5000)],
  }
  // Als Hauptzähler gelesen, trüge a nur 1.000 von 5.000 kWh, also 200 €, und 800 € blieben beim
  // Vermieter.
  assert.equal(share(settle(mit, 2025, [plant()]), 'ta', 'heizung'), 100000)
  assert.equal(share(settle(mit, 2025, [plant()]), 'ta', 'heizung'), share(settle(ohne), 'ta', 'heizung'))
})

// ---------- Anlegen ändert keine Zahl (Entwurf 11.2, A2, 12.3 Nr. 12) ----------

test('Anlage mit Vorgaben: jede Abrechnung bleibt gleich, über das ganze Ergebnis', () => {
  for (const y of [2025, 2027]) {
    const s: Partial<SnapshotSource> = {
      units: [
        unit('a', { areaM2: 60 }), unit('b', { areaM2: 40 }),
        unit('c', { participates: false, selfUsed: true, selfPersons: 2, areaM2: 80 }),
        unit('garage', { areaM2: 0, noConnection: ['waerme'] }),
      ],
      tenancies: [
        tenancy('ta1', 'a', { end: `${y}-04-30` }),
        tenancy('ta2', 'a', { start: `${y}-06-01` }),
        tenancy('tb', 'b', { heatingModel: 'flatRate' }),
      ],
      meters: [meter('a-waerme', 'a', 'waerme'), meter('b-waerme', 'b', 'waerme'), meter('c-waerme', 'c', 'waerme')],
      readings: [...wholeYear('a-waerme', y, 0, 4000), ...wholeYear('b-waerme', y, 0, 2500), ...wholeYear('c-waerme', y, 0, 3000)],
      costItems: [
        item('verbrauch', y, { category: HEATING_CATEGORY, amountCents: 700000, key: 'meter', meterType: 'waerme' }),
        item('grund', y, { category: HEATING_CATEGORY, amountCents: 300000, key: 'area' }),
        item('messdienst', y, { category: HEATING_CATEGORY, amountCents: 50000, key: 'amounts', tenancyAmounts: { ta1: 10000, ta2: 12000, tb: 15000 } }),
        item('wartung', y, { category: HEATING_CATEGORY, amountCents: 20000, key: 'direct', directUnitId: 'a' }),
        item('grundsteuer', y, { category: 'Grundsteuer', amountCents: 90000, key: 'area' }),
      ],
    }
    const ohne = settle(s, y)
    const anlagen = [plant(), plant({ method: 'service' }), plant({ method: 'service', source: 'homeowners' }), plant({ units: [{ unitId: 'a', heatedAreaM2: null }] })]
    for (const p of anlagen) assert.deepEqual(settle(s, y, [p]), ohne, `${y}: ${JSON.stringify(p)}`)
    assert.deepEqual(settle(s, y, []), ohne, `${y}: leere Liste`)
  }
})

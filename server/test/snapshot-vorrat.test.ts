// Die Kette des Vorrats im Schnappschuss (Heizung PR 8, Entwurf 5.8, 8.2, G-A4): Vorperioden mit
// Endbestand, der eingefrorene Endbestand einer abgeschlossenen, der übernommene Anfangsbestand einer
// abgeschlossenen Folgeperiode, Lieferungen nach Lieferdatum, Beträge aus verknüpften Positionen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { frozenSettlementOf, stockChainsOf, type SnapshotCostItem, type SnapshotHeatingPeriodRow, type SnapshotHeatingPlant } from '../src/snapshot.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { CALENDAR_RULES, periodKey, periodOfKey } from '../../shared/period.ts'
import type { BillingPeriod, FuelDelivery, StockValue } from '../../shared/types.ts'

const OEL: SnapshotHeatingPlant = {
  id: 'hp', name: 'Öl', energy: 'oil', method: 'manual', source: 'building', devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', newDevicesInstall: null, units: null,
}
// Eine Zeile der Heizperiode mit den Feldern des Vorrats (die übrigen Felder braucht die Kette nicht).
const zeile = (period: string, over: Partial<SnapshotHeatingPeriodRow> = {}): SnapshotHeatingPeriodRow => ({
  plantId: 'hp', period: periodKey(period), dhwMethod: null, dhwUnmeasurable: null, stockUnit: 'l', openingQuantity: null, openingCostCents: null,
  openingEmissionsKg: null, openingCo2Cents: null, openingInvoicedBefore2023: null, closingQuantity: null, closingMeasuredOn: null, ...over,
})
const lieferung = (id: string, deliveredAt: string, over: Partial<FuelDelivery> = {}): FuelDelivery => ({
  id, plantId: 'hp', amountCents: null, label: '', invoiceDate: deliveredAt, deliveredAt, invoiceFrom: null, invoiceTo: null, unitId: null,
  quantity: 1000, quantityUnit: 'l', energyKwh: null, gasBasis: null, heatingValue: null, emissionsKg: 2676.3, co2CostCents: 17500,
  emissionFactor: null, gridFeeCents: null, bioCostCents: null, sharePermille: null, fixedCents: null, estimated: false, usedByService: true, parts: [], ...over,
})
const position = (id: string, period: string, amountCents: number, fuelDeliveryId: string): SnapshotCostItem => ({
  id, period: periodKey(period), category: HEATING_CATEGORY, description: id, amountCents, key: 'area', heatingPlantId: 'hp', heatingPart: 'fuel', fuelDeliveryId,
})
const jahr = (y: number): BillingPeriod => periodOfKey(CALENDAR_RULES, periodKey(`${y}-01`)) ?? assert.fail(`kein Zeitraum ${y}`)
const P2025 = jahr(2025)
const leer = { costItems: [] as SnapshotCostItem[], closedSettlements: [] }
const closingVon = (q: number, cents: number): StockValue => ({
  quantity: q, costCents: cents, emissionsKg: 2141.04, co2Cents: 14000,
  layers: [{ label: 'Lieferung vom 10.02.2024', date: '2024-02-10', quantity: q, costCents: cents, emissionsKg: 2141.04, co2Cents: 14000, co2Counted: true }],
})

test('Kette: die Heizperiode und davor jede mit Endbestand; die erste mit eingetragenem Anfangsbestand', () => {
  const [kette] = stockChainsOf({
    ...leer,
    heatingPeriodRows: [
      zeile('2023-01', { openingQuantity: 500, openingCostCents: 50000, closingQuantity: 1200 }),
      zeile('2024-01', { closingQuantity: 800 }),
      zeile('2025-01', { closingQuantity: 300 }),
    ],
    fuelDeliveries: [lieferung('a', '2024-02-10'), lieferung('b', '2025-11-03'), lieferung('c', '2026-01-04')],
  }, OEL, CALENDAR_RULES, [P2025])
  assert.deepEqual(kette?.chain.map((p) => [p.key, p.closingQuantity, p.deliveries.map((d) => d.id)]), [['2023-01', 1200, []], ['2024-01', 800, ['a']], ['2025-01', 300, ['b']]])
  assert.equal(kette?.chain[0]?.ownOpening?.quantity, 500)
  assert.equal(kette?.chain[2]?.deliveries[0]?.label, 'Lieferung vom 03.11.2025')
  // Eine Vorperiode ohne Endbestand beendet die Kette; dann zählt der eigene Anfangsbestand.
  const [kurz] = stockChainsOf({ ...leer, heatingPeriodRows: [zeile('2024-01'), zeile('2025-01', { openingQuantity: 800, closingQuantity: 300 })] }, OEL, CALENDAR_RULES, [P2025])
  assert.deepEqual(kurz?.chain.map((p) => p.key), ['2025-01'])
})

test('Betrag einer Lieferung: Σ der verknüpften Positionen, sonst der an der Lieferung; geschätzte fallen weg', () => {
  const [kette] = stockChainsOf({
    costItems: [position('r1', '2025-01', 120000, 'b'), position('r2', '2025-01', -5000, 'b')],
    closedSettlements: [],
    heatingPeriodRows: [zeile('2025-01', { openingQuantity: 0, closingQuantity: 0 })],
    fuelDeliveries: [lieferung('b', '2025-03-01', { amountCents: 999 }), lieferung('m', '2025-04-01', { amountCents: 70000 }), lieferung('s', '2025-05-01', { estimated: true })],
  }, OEL, CALENDAR_RULES, [P2025])
  assert.deepEqual(kette?.chain[0]?.deliveries.map((d) => [d.id, d.costCents]), [['b', 115000], ['m', 70000]])
})

test('Eingefroren (G-A4): Der Endbestand einer abgeschlossenen Vorperiode steht im Stand und beendet die Kette; wieder geöffnet zählt der lebende', () => {
  const closing = closingVon(800, 80000)
  const stand = { heating: [{ plantId: 'hp', period: '2024-01', energy: 'oil', stock: { openingSource: 'own', opening: closing, closing } }] }
  const frozen = frozenSettlementOf(stand)
  assert.deepEqual(frozen.stockClosings, { 'hp:2024-01': closing })
  // Ein eingetragener Anfangsbestand ist kein übernommener.
  assert.equal(frozen.stockOpenings, null)
  assert.equal(frozenSettlementOf({}).stockClosings, null)
  const quelle = {
    ...leer,
    heatingPeriodRows: [zeile('2023-01', { openingQuantity: 500, openingCostCents: 50000, closingQuantity: 1200 }), zeile('2024-01', { closingQuantity: 700 }), zeile('2025-01', { closingQuantity: 300 })],
  }
  const [zu] = stockChainsOf({ ...quelle, closedSettlements: [{ ...frozen, period: periodKey('2024-01') }] }, OEL, CALENDAR_RULES, [P2025])
  assert.deepEqual(zu?.chain.map((p) => p.key), ['2024-01', '2025-01'])
  assert.deepEqual(zu?.chain[0]?.frozenClosing, closing)
  // Wieder geöffnet: Der Stand ist weg, die Kette reicht bis zum eingetragenen Anfangsbestand, und
  // der Endbestand von 2024 ist der eingetragene (700 l), nicht der eingefrorene (800 l).
  const [offen] = stockChainsOf(quelle, OEL, CALENDAR_RULES, [P2025])
  assert.deepEqual(offen?.chain.map((p) => [p.key, p.frozenClosing === null, p.closingQuantity]), [['2023-01', true, 1200], ['2024-01', true, 700], ['2025-01', true, 300]])
})

test('Folgeperiode abgeschlossen (G-A4): Ihr übernommener Anfangsbestand steht als Endbestand an der Heizperiode davor', () => {
  const opening = closingVon(300, 30000)
  const stand = frozenSettlementOf({ heating: [{ plantId: 'hp', period: '2026-01', energy: 'oil', stock: { openingSource: 'previous', opening, closing: closingVon(100, 10000) } }] })
  assert.deepEqual(stand.stockOpenings, { 'hp:2026-01': opening })
  const [kette] = stockChainsOf({
    ...leer,
    closedSettlements: [{ ...stand, period: periodKey('2026-01') }],
    heatingPeriodRows: [zeile('2025-01', { openingQuantity: 500, openingCostCents: 50000, closingQuantity: 250 })],
  }, OEL, CALENDAR_RULES, [P2025])
  assert.deepEqual(kette?.chain[0]?.nextFrozenOpening, opening)
  // Die Kette der Folgeperiode endet am eingefrorenen Endbestand von 2026 bzw. hier ohne ihn.
  const [ohne] = stockChainsOf({ ...leer, heatingPeriodRows: [zeile('2025-01', { openingQuantity: 500, closingQuantity: 250 })] }, OEL, CALENDAR_RULES, [P2025])
  assert.equal(ohne?.chain[0]?.nextFrozenOpening, null)
})

test('Peilung nach dem Ende: die Lieferungen der Folgeperiode bis zur Peilung stehen dabei', () => {
  const [kette] = stockChainsOf({
    ...leer,
    heatingPeriodRows: [zeile('2025-01', { openingQuantity: 500, closingQuantity: 300, closingMeasuredOn: '2026-01-05' })],
    fuelDeliveries: [lieferung('spaet', '2026-01-02'), lieferung('noch-spaeter', '2026-01-09')],
  }, OEL, CALENDAR_RULES, [P2025])
  assert.deepEqual(kette?.chain[0]?.laterDeliveries, [{ label: 'Lieferung vom 02.01.2026', date: '2026-01-02' }])
})

test('Ohne Vorratsenergie gibt es keine Kette', () => {
  assert.deepEqual(stockChainsOf({ ...leer, heatingPeriodRows: [zeile('2025-01', { closingQuantity: 1 })] }, { ...OEL, energy: 'gas' }, CALENDAR_RULES, [P2025]), [])
})

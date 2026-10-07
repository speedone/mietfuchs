// Das Blatt „CO₂-Angaben für den Messdienst“ (Heizung PR 17, #210, Abweichung 9 des Plans).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { co2SheetOf, type Co2SheetInput } from '../src/co2Sheet.ts'
import type { FuelDelivery } from '../../shared/types.ts'

// Nur die Felder, die das Blatt liest (`Co2SheetInput` nimmt genau diese).
const plant: Co2SheetInput['plant'] = { id: 'hp', name: 'Kessel', energy: 'oil', units: null, nonResidential: false, restriction: 'none', districtEtsNew: false }
const lieferung = (over: Partial<FuelDelivery>): FuelDelivery => ({
  id: 'd', plantId: 'hp', label: 'Heizöl', invoiceDate: '2025-03-15', deliveredAt: '2025-03-15', invoiceFrom: null, invoiceTo: null, unitId: null,
  amountCents: 315000, quantity: 3000, quantityUnit: 'l', energyKwh: null, gasBasis: null, heatingValue: null, fuelGrade: null, emissionsKg: 8028.9, co2CostCents: 52549,
  emissionFactor: 0.2664, gridFeeCents: null, bioCostCents: null, sharePermille: null, fixedCents: null, estimated: false, usedByService: true, parts: [], ...over,
})
const unit = (id: string, areaM2: number, over: Partial<Co2SheetInput['units'][number]> = {}): Co2SheetInput['units'][number] => ({ id, areaM2, ...over })
const input = (over: Partial<Co2SheetInput> = {}): Co2SheetInput => ({
  propertyName: 'Haus am Park', address: 'Parkweg 1', landlordName: 'Erika Muster', plant,
  h: { key: '2025-01', from: '2025-01-01', to: '2025-12-31' },
  units: [unit('u1', 120), unit('u2', 180)],
  enteredAreaM2: null, stock: null,
  deliveries: [
    lieferung({}),
    lieferung({ id: 'd2', label: 'Heizöl Oktober', deliveredAt: '2025-10-10', invoiceDate: '2025-10-10', quantity: 2500, emissionsKg: 6690.75, co2CostCents: 43791 }),
    lieferung({ id: 'alt', deliveredAt: '2024-11-01', invoiceDate: '2024-11-01' }),
    lieferung({ id: 'fremd', plantId: 'andere' }),
  ],
  overrides: [], ...over,
})

test('Blatt: Rechnungen der Heizperiode mit den Angaben nach § 3 Abs. 1, Summen, Fläche aus den Wohnungen', () => {
  const s = co2SheetOf(input())
  assert.deepEqual(s.deliveries.map((d) => d.id), ['d', 'd2'])
  assert.deepEqual(s.totals, { emissionsKg: 14719.65, co2CostCents: 96340 })
  assert.deepEqual([s.areaM2, s.areaSource], [300, 'served'])
  assert.deepEqual(s.deliveries[0]?.findings, [])
  assert.deepEqual([s.landlordName, s.propertyName, s.plantName, s.energy, s.period.key], ['Erika Muster', 'Haus am Park', 'Kessel', 'oil', '2025-01'])
  assert.deepEqual([s.deliveries[0]?.emissionFactor, s.deliveries[0]?.amountCents, s.deliveries[0]?.quantity], [0.2664, 315000, 3000])
})

test('Blatt: ohne eingetragenen Betrag gilt die Summe der verknüpften Positionen', () => {
  const s = co2SheetOf(input({ deliveries: [lieferung({ amountCents: null })], linkedCents: { d: 314999 } }))
  assert.equal(s.deliveries[0]?.amountCents, 314999)
  assert.equal(co2SheetOf(input({ deliveries: [lieferung({ amountCents: null })] })).deliveries[0]?.amountCents, null)
})

test('Blatt: eingetragene Fläche geht vor; Hinweise der Prüfung stehen an der Rechnung', () => {
  const s = co2SheetOf(input({ enteredAreaM2: 290, deliveries: [lieferung({ co2CostCents: 44159 })] }))
  assert.deepEqual([s.areaM2, s.areaSource], [290, 'entered'])
  assert.match(s.deliveries[0]?.findings[0] ?? '', /passen nicht zu 8\.028,9 kg CO₂/)
})

test('Blatt: nur Wohnungen, die die Anlage versorgt, zählen zur Fläche; ohne Fläche „nicht bekannt“', () => {
  const nurEG = co2SheetOf(input({ plant: { ...plant, units: [{ unitId: 'u1', heatedAreaM2: null }] } }))
  assert.equal(nurEG.areaM2, 120)
  const ohne = co2SheetOf(input({ units: [unit('u1', 120, { noConnection: ['waerme'] })] }))
  assert.deepEqual([ohne.areaM2, ohne.areaSource], [null, null])
})

test('Blatt: Rechnung über einen Zeitraum, die die Heizperiode berührt, steht darin, ohne Abgrenzung', () => {
  const gas: Co2SheetInput['plant'] = { ...plant, energy: 'gas' }
  const s = co2SheetOf(input({ plant: gas, deliveries: [lieferung({ deliveredAt: null, invoiceFrom: '2024-07-01', invoiceTo: '2025-06-30', quantity: null, quantityUnit: null, energyKwh: 50000, gasBasis: 'hs', emissionsKg: 9069.73, co2CostCents: 52000 })] }))
  assert.deepEqual(s.deliveries.map((d) => [d.from, d.to, d.emissionsKg]), [['2024-07-01', '2025-06-30', 9069.73]])
  assert.deepEqual(s.totals, { emissionsKg: 9069.73, co2CostCents: 52000 })
})

test('Blatt: Vorrat und Einstufungsmerkmale werden durchgereicht', () => {
  const stock = { stockUnit: 'l' as const, openingQuantity: 2000, openingEmissionsKg: 5352.6, openingCo2Cents: 0, openingInvoicedBefore2023: true, closingQuantity: 1800, closingMeasuredOn: '2025-12-31' }
  const s = co2SheetOf(input({ stock, plant: { ...plant, nonResidential: true, restriction: 'building' } }))
  assert.deepEqual(s.stock, stock)
  assert.deepEqual([s.nonResidential, s.restriction, s.districtEtsNew], [true, 'building', false])
})

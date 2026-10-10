// Das Blatt „CO₂-Angaben für den Messdienst“ (Heizung PR 17, #210, Abweichung 9 des Plans).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { co2SheetOf, type Co2SheetInput } from '../src/co2Sheet.ts'
import type { FuelDelivery, HeatingStatement } from '../../shared/types.ts'

// Nur die Felder, die das Blatt liest (`Co2SheetInput` nimmt genau diese).
const plant: Co2SheetInput['plant'] = { id: 'hp', name: 'Kessel', energy: 'oil', method: 'service', units: null, nonResidential: false, restriction: 'none', districtEtsNew: false }
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
  overrides: [], items: [], today: '2026-10-07', ...over,
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
  const s = co2SheetOf(input({ deliveries: [lieferung({ amountCents: null })], items: [{ id: 'a', period: '2025-01', amountCents: 300000, fuelDeliveryId: 'd' }, { id: 'b', period: '2025-01', amountCents: 14999, fuelDeliveryId: 'd' }] }))
  assert.equal(s.deliveries[0]?.amountCents, 314999)
  assert.equal(co2SheetOf(input({ deliveries: [lieferung({ amountCents: null })] })).deliveries[0]?.amountCents, null)
})

// Die Befunde der Prüfung kommen aus der Abrechnung (`co2Check`, #246); hier von Hand gereicht. Dass sie dort
// so entstehen, prüfen calc-co2-plausibilitaet.test.ts und co2-sheet-runde4.test.ts über `co2SheetFor`.
const heating = (co2Check: NonNullable<HeatingStatement['co2Check']>): HeatingStatement =>
  ({ plantId: 'hp', plantName: 'Kessel', energy: 'oil', period: '2025-01' as HeatingStatement['period'], from: '2025-01-01', to: '2025-12-31', co2: null, co2Check })

test('Blatt: eingetragene Fläche geht vor; Hinweise der Prüfung stehen an der Rechnung, wie die Abrechnung sie nennt', () => {
  const s = co2SheetOf(input({ enteredAreaM2: 290, deliveries: [lieferung({ co2CostCents: 44159 })], heating: heating({ applies: true, exemption: null, findings: [{ deliveryId: 'd', texts: ['Befund der Abrechnung'] }] }) }))
  assert.deepEqual([s.areaM2, s.areaSource], [290, 'entered'])
  assert.deepEqual(s.deliveries[0]?.findings, ['Befund der Abrechnung'])
  // Ohne Ergebnis der Abrechnung prüft das Blatt nicht selbst.
  assert.deepEqual(co2SheetOf(input({ deliveries: [lieferung({ co2CostCents: 44159 })] })).deliveries[0]?.findings, [])
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
  const stock = { stockUnit: 'l' as const, openingQuantity: 2000, openingEmissionsKg: 5352.6, openingCo2Cents: 0, openingInvoicedBefore2023: true, openingAlreadySettled: null, closingQuantity: 1800, closingMeasuredOn: '2025-12-31' }
  const s = co2SheetOf(input({ stock, plant: { ...plant, nonResidential: true, restriction: 'building' } }))
  assert.deepEqual(s.stock, stock)
  assert.deepEqual([s.nonResidential, s.restriction, s.districtEtsNew], [true, 'building', false])
})

// ---------- Durchsicht Runde 1 (#246) ----------

test('G-W1: Rechnung vor 2023 zählt nur mit ihren kg; Summe 286,63 € statt 573,26 €, die Zeile sagt warum', () => {
  const zeile = (id: string, am: string) => lieferung({ id, label: `Heizöl ${am}`, deliveredAt: am, invoiceDate: am, emissionsKg: 8028.9, co2CostCents: 28663 })
  const s = co2SheetOf(input({ h: { key: '2022-05', from: '2022-05-01', to: '2023-04-30' }, deliveries: [zeile('nov', '2022-11-15'), zeile('feb', '2023-02-15')] }))
  assert.deepEqual(s.totals, { emissionsKg: 16057.8, co2CostCents: 28663 })
  assert.deepEqual(s.deliveries.map((d) => d.counted), ['kgOnly', 'full'])
  assert.match(s.deliveries[0]?.note ?? '', /Vor dem 01\.01\.2023 in Rechnung gestellt.*§ 11 Abs\. 2 Satz 2/)
  assert.equal(s.deliveries[1]?.note, null)
  assert.deepEqual(s.deliveries[0]?.findings, [], 'nicht berücksichtigt, also auch nicht geprüft')
})

test('G-W1: stornierte Rechnung und abgedeckte Schätzung zählen nicht; Summe 654,50 € statt 1.963,50 €', () => {
  const gas: Co2SheetInput['plant'] = { ...plant, energy: 'gas', method: 'manual' }
  const jahr = { deliveredAt: null, invoiceDate: '2026-01-20', invoiceFrom: '2025-01-01', invoiceTo: '2025-12-31', quantity: null, quantityUnit: null, emissionsKg: 10000, co2CostCents: 65450, amountCents: null }
  const s = co2SheetOf(input({
    plant: gas,
    deliveries: [lieferung({ ...jahr, id: 'alt', label: 'Gas alt' }), lieferung({ ...jahr, id: 'neu', label: 'Gas berichtigt' }), lieferung({ ...jahr, id: 'sch', label: 'Gas geschätzt', estimated: true, amountCents: 300000 })],
    items: [
      { id: 'p1', period: '2025-01', amountCents: 300000, fuelDeliveryId: 'alt' }, { id: 'p2', period: '2025-01', amountCents: -300000, fuelDeliveryId: 'alt' },
      { id: 'p3', period: '2025-01', amountCents: 300000, fuelDeliveryId: 'neu' },
    ],
  }))
  assert.deepEqual(s.totals, { emissionsKg: 10000, co2CostCents: 65450 })
  assert.deepEqual(s.deliveries.map((d) => [d.id, d.counted]), [['alt', 'none'], ['neu', 'full'], ['sch', 'none']])
  assert.match(s.deliveries[0]?.note ?? '', /Storniert/)
  assert.match(s.deliveries[2]?.note ?? '', /Schätzung.*abgedeckt/)
  assert.deepEqual(s.deliveries.map((d) => d.amountCents), [0, 300000, 300000])
})

test('R-W1: Fernwärme aus dem Emissionshandel mit Anschluss nach dem Stichtag: nicht geprüft, mit Grund', () => {
  const fw: Co2SheetInput['plant'] = { ...plant, energy: 'districtHeating', districtEtsNew: true }
  const d = lieferung({ deliveredAt: null, invoiceDate: '2026-01-20', invoiceFrom: '2025-01-01', invoiceTo: '2025-12-31', quantity: null, quantityUnit: null, emissionsKg: 9000, co2CostCents: 1000 })
  const s = co2SheetOf(input({ plant: fw, deliveries: [d], heating: heating({ applies: false, exemption: null, findings: [] }) }))
  assert.deepEqual(s.deliveries[0]?.findings, [])
  assert.equal(s.checked, false)
  // Ohne Ergebnis der Abrechnung (keine Position) sagt die Anlage selbst, dass das Gesetz nicht gilt.
  assert.equal(co2SheetOf(input({ plant: fw, deliveries: [d] })).checked, false)
  assert.equal(co2SheetOf(input({ plant: { ...fw, districtEtsNew: false }, deliveries: [d], heating: heating({ applies: true, exemption: null, findings: [{ deliveryId: 'd', texts: ['x'] }] }) })).deliveries[0]?.findings.length, 1)
})

test('R-K6: das Blatt trägt den Tag, an dem es erstellt wurde', () => {
  assert.equal(co2SheetOf(input()).createdOn, '2026-10-07')
})

// ---------- Durchsicht Runde 2 (#246) ----------
// Den Anfangsbestand (G-W2, O2a, O2b) prüft co2-sheet-abrechnung.test.ts über die Bestandsrechnung der Abrechnung.

test('O1: eine teilweise abgedeckte Schätzung zählt mit ihrem Faktor, bei kg und CO₂-Kosten', () => {
  const gas: Co2SheetInput['plant'] = { ...plant, energy: 'gas', method: 'manual' }
  const echt = lieferung({ id: 'h1', label: 'Gas Januar bis Juni', deliveredAt: null, invoiceDate: '2025-07-10', invoiceFrom: '2025-01-01', invoiceTo: '2025-06-30', quantity: null, quantityUnit: null, emissionsKg: 6000, co2CostCents: 39270, amountCents: null })
  const geschaetzt = lieferung({ id: 'sch', label: 'Gas geschätzt', estimated: true, deliveredAt: null, invoiceDate: null, invoiceFrom: '2025-01-01', invoiceTo: '2025-12-31', quantity: null, quantityUnit: null, emissionsKg: 10000, co2CostCents: 65450, amountCents: 300000 })
  const s = co2SheetOf(input({ plant: gas, deliveries: [echt, geschaetzt], items: [{ id: 'p', period: '2025-01', amountCents: 180000, fuelDeliveryId: 'h1' }] }))
  const f = s.deliveries[1]?.factor ?? assert.fail('keine Schätzung')
  assert.ok(f > 0 && f < 1, `Faktor ${f}`)
  assert.equal(s.deliveries[1]?.counted, 'partial')
  assert.equal(s.totals.co2CostCents, Math.round(39270 + 65450 * f))
  assert.equal(s.totals.emissionsKg, Math.round((6000 + 10000 * f) * 100) / 100)
})

test('O1: ohne Rechnungsdatum und Liefertag mit Zeitraumende vor 2023 ist offen, ob die CO₂-Kosten zählen', () => {
  const gas: Co2SheetInput['plant'] = { ...plant, energy: 'gas' }
  const ohne = (from: string, to: string) => lieferung({ deliveredAt: null, invoiceDate: null, invoiceFrom: from, invoiceTo: to, quantity: null, quantityUnit: null, emissionsKg: 10000, co2CostCents: 35700 })
  const alt = co2SheetOf(input({ plant: gas, h: { key: '2022-01', from: '2022-01-01', to: '2022-12-31' }, deliveries: [ohne('2022-01-01', '2022-12-31')] }))
  assert.equal(alt.deliveries[0]?.counted, 'kgOnly')
  assert.match(alt.deliveries[0]?.note ?? '', /Ohne Rechnungsdatum/)
  assert.deepEqual(alt.totals, { emissionsKg: 10000, co2CostCents: 0 })
  const neu = co2SheetOf(input({ plant: gas, h: { key: '2023-01', from: '2023-01-01', to: '2023-12-31' }, deliveries: [ohne('2023-01-01', '2023-12-31')] }))
  assert.deepEqual([neu.deliveries[0]?.counted, neu.totals.co2CostCents], ['full', 35700])
})


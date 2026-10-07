import { expect, test } from 'vitest'
import { hasSheet, sheetFacts, sheetHead, sheetRows } from './co2Sheet'
import { fmtEuro } from './api'
import type { Co2Sheet, Co2SheetDelivery } from './types'

const heizoel: Co2SheetDelivery = { id: 'd', label: 'Heizöl', invoiceDate: '2025-03-15', from: null, to: null, deliveredAt: '2025-03-15', quantity: 3000, quantityUnit: 'l', energyKwh: null, gasBasis: null, emissionFactor: 0.2664, emissionsKg: 8028.9, co2CostCents: 52549, amountCents: 315000, estimated: false, findings: [] }
const sheet: Co2Sheet = {
  propertyName: 'Haus am Park', address: 'Parkweg 1', landlordName: 'Erika Muster', plantName: 'Kessel', energy: 'oil',
  period: { key: '2025-01', from: '2025-01-01', to: '2025-12-31' }, areaM2: 300, areaSource: 'served', nonResidential: false, restriction: 'none', districtEtsNew: false,
  stock: null,
  deliveries: [heizoel],
  totals: { emissionsKg: 8028.9, co2CostCents: 52549 },
}

test('Kopf, Zeilen und Angaben zur Einstufung', () => {
  expect(sheetHead(sheet)).toEqual({ title: 'CO₂-Angaben für den Messdienst', lines: ['Haus am Park, Parkweg 1', 'Vermieter: Erika Muster', 'Heizanlage: Kessel (Öl)', 'Heizperiode: 01.01.2025 bis 31.12.2025'] })
  expect(sheetRows(sheet)).toEqual([
    { label: 'Heizöl', cells: ['15.03.2025', 'geliefert 15.03.2025', '3.000 l', '–', '0,2664 kg CO₂/kWh', '8.028,9 kg', fmtEuro(52549), fmtEuro(315000)] },
    { label: 'Summe', cells: ['', '', '', '', '', '8.028,9 kg', fmtEuro(52549), ''] },
  ])
  expect(sheetFacts(sheet)).toEqual([
    'Fläche für die Einstufung: 300 m² (Wohnfläche der versorgten Wohnungen)',
    'Kein Nichtwohngebäude (§ 8 CO2KostAufG); keine Beschränkung nach § 9 CO2KostAufG',
    'Angaben je Rechnung nach § 3 Abs. 1 Nr. 1 bis 4 CO2KostAufG, wie sie der Lieferant ausweist; nicht auf die Heizperiode abgegrenzt',
  ])
})

test('Gas über einen Zeitraum, geschätzte Rechnung, Vorrat, Emissionshandel und Beschränkung', () => {
  const gas: Co2Sheet = {
    ...sheet, energy: 'districtHeating', areaM2: null, areaSource: null, restriction: 'both', districtEtsNew: true,
    stock: { stockUnit: 'l', openingQuantity: 2000, openingEmissionsKg: 5352.6, openingCo2Cents: 0, openingInvoicedBefore2023: true, closingQuantity: 1800, closingMeasuredOn: '2025-12-31' },
    deliveries: [{ ...heizoel, label: 'Wärme', estimated: true, from: '2025-01-01', to: '2025-12-31', deliveredAt: null, quantity: null, quantityUnit: null, energyKwh: 50000, gasBasis: 'hs', emissionFactor: null, amountCents: null }],
  }
  expect(sheetHead(gas).lines[2]).toBe('Heizanlage: Kessel (Fernwärme)')
  expect(sheetRows(gas)[0]).toEqual({ label: 'Wärme (geschätzt)', cells: ['15.03.2025', '01.01.2025 bis 31.12.2025', '–', '50.000 kWh (Brennwert)', '–', '8.028,9 kg', fmtEuro(52549), '–'] })
  const facts = sheetFacts(gas)
  expect(facts[0]).toMatch(/nicht bekannt/)
  expect(facts[1]).toBe('Kein Nichtwohngebäude (§ 8 CO2KostAufG); Beschränkung nach § 9 Abs. 2 CO2KostAufG (Gebäude und Wärmeversorgung)')
  expect(facts[2]).toBe('Wärme aus Anlagen des Emissionshandels, erster Anschluss nach dem 01.01.2023 (§ 2 Abs. 4 Satz 2 CO2KostAufG)')
  expect(facts[3]).toBe('Vorrat: Anfangsbestand 2.000 l mit 5.352,6 kg CO₂ (vor 2023 in Rechnung gestellt, ohne CO₂-Kosten nach § 11 Abs. 2 Satz 2 CO2KostAufG); Endbestand 1.800 l am 31.12.2025')
})

test('Ein Blatt gibt es, sobald eine Rechnung die Heizperiode berührt', () => {
  const h = { from: '2025-05-01', to: '2026-04-30' }
  expect(hasSheet([], h)).toBe(false)
  expect(hasSheet([{ invoiceFrom: '2025-03-15', invoiceTo: '2026-03-14', deliveredAt: null }], h)).toBe(true)
  expect(hasSheet([{ invoiceFrom: '2024-03-15', invoiceTo: '2025-04-30', deliveredAt: null }], h)).toBe(false)
  // Beginnt in der Heizperiode und endet danach: steht auf dem Blatt, obwohl die Karte „Lieferungen“ sie erst später zeigt.
  expect(hasSheet([{ invoiceFrom: '2026-03-01', invoiceTo: '2027-02-28', deliveredAt: null }], h)).toBe(true)
  expect(hasSheet([{ invoiceFrom: null, invoiceTo: null, deliveredAt: '2026-04-30' }], h)).toBe(true)
  expect(hasSheet([{ invoiceFrom: null, invoiceTo: null, deliveredAt: null }], h)).toBe(false)
})

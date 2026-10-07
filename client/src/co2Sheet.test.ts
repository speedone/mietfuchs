import { expect, test } from 'vitest'
import { hasSheet, sheetFacts, sheetHead, sheetRows } from './co2Sheet'
import { fmtEuro } from './api'
import type { Co2Sheet, Co2SheetDelivery } from './types'

const heizoel: Co2SheetDelivery = {
  id: 'd', label: 'Heizöl', invoiceDate: '2025-03-15', from: null, to: null, deliveredAt: '2025-03-15', quantity: 3000, quantityUnit: 'l', energyKwh: null, gasBasis: null, emissionFactor: 0.2664,
  emissionsKg: 8028.9, co2CostCents: 52549, amountCents: 315000, estimated: false, counted: 'full', factor: 1, note: null, findings: [],
}
const sheet: Co2Sheet = {
  propertyName: 'Haus am Park', address: 'Parkweg 1', landlordName: 'Erika Muster', plantName: 'Kessel', energy: 'oil', createdOn: '2026-10-07', checked: true,
  period: { key: '2025-01', from: '2025-01-01', to: '2025-12-31' }, areaM2: 300, areaSource: 'served', nonResidential: false, restriction: 'none', districtEtsNew: false,
  stock: null, opening: null,
  deliveries: [heizoel],
  totals: { emissionsKg: 8028.9, co2CostCents: 52549 },
}

test('Kopf, Zeilen und Angaben zur Einstufung', () => {
  expect(sheetHead(sheet)).toEqual({ title: 'CO₂-Angaben für den Messdienst', lines: ['Haus am Park, Parkweg 1', 'Vermieter: Erika Muster', 'Heizanlage: Kessel (Öl)', 'Heizperiode: 01.01.2025 bis 31.12.2025', 'Stand: 07.10.2026'] })
  expect(sheetRows(sheet)).toEqual([
    { kind: 'delivery', label: 'Heizöl', note: null, cells: ['15.03.2025', 'geliefert 15.03.2025', '3.000 l', '–', '0,2664 kg CO₂/kWh', '8.028,9 kg', fmtEuro(52549), fmtEuro(315000)] },
    { kind: 'sum', label: 'Summe', note: null, cells: ['', '', '', '', '', '8.028,9 kg', fmtEuro(52549), ''] },
  ])
  expect(sheetFacts(sheet)).toEqual([
    'Fläche für die Einstufung: 300 m² (Summe der Wohnflächen der versorgten Wohnungen laut Vermieter)',
    'Kein Nichtwohngebäude (§ 8 CO2KostAufG); keine Beschränkung nach § 9 CO2KostAufG',
    'Angaben je Rechnung nach § 3 Abs. 1 Nr. 1 bis 4 CO2KostAufG, wie sie der Lieferant ausweist; nicht auf die Heizperiode abgegrenzt. Die Summe enthält nur, was nach dem CO2KostAufG zählt (siehe Vermerke).',
  ])
})

test('R-W2, R-K6: Kopf ohne Doppelung, ohne Namen nur die Energie; Fläche in dritter Person', () => {
  const lines = sheetHead({ ...sheet, propertyName: 'Lindenweg 12', address: 'Lindenweg 12, 12345 Musterstadt', plantName: '' }).lines
  expect(lines[0]).toBe('Lindenweg 12, 12345 Musterstadt')
  expect(lines[2]).toBe('Heizanlage: Öl')
  const facts = sheetFacts({ ...sheet, areaSource: 'entered', areaM2: 290 })
  expect(facts[0]).toBe('Fläche für die Einstufung: 290 m² (vom Vermieter angegeben)')
  expect(sheetFacts({ ...sheet, areaM2: null, areaSource: null })[0]).toBe('Fläche für die Einstufung: nicht angegeben')
  expect(sheetFacts({ ...sheet, areaSource: 'entered' }).join(' ')).not.toMatch(/Ihnen|\bSie\b|[Bb]itte/)
})

test('G-W1, G-W2: Vermerke an den Zeilen, Anfangsbestand mit CO₂-Kosten, Summe mit dem, was zählt', () => {
  const s: Co2Sheet = {
    ...sheet,
    stock: { stockUnit: 'l', openingQuantity: 1000, openingEmissionsKg: 2676.3, openingCo2Cents: 17517, openingInvoicedBefore2023: false, openingAlreadySettled: null, closingQuantity: 500, closingMeasuredOn: '2025-12-31' },
    opening: { emissionsKg: 2676.3, co2CostCents: 17517, co2Counted: true, note: null },
    deliveries: [heizoel, { ...heizoel, id: 'x', label: 'Heizöl alt', counted: 'none', note: 'Storniert: Die Kostenpositionen dieser Rechnung ergeben 0 €; sie zählt nicht.' }],
    totals: { emissionsKg: 10705.2, co2CostCents: 70066 },
  }
  const rows = sheetRows(s)
  expect(rows[0]).toEqual({ kind: 'opening', label: 'Anfangsbestand (Vorrat)', note: null, cells: ['', '', '1.000 l', '–', '–', '2.676,3 kg', fmtEuro(17517), ''] })
  expect(rows[2]?.note).toMatch(/Storniert/)
  expect(rows[2]?.label).toBe('Heizöl alt (zählt nicht)')
  expect(rows[3]).toEqual({ kind: 'sum', label: 'Summe', note: null, cells: ['', '', '', '', '', '10.705,2 kg', fmtEuro(70066), ''] })
  const ohne = sheetRows({ ...s, opening: { emissionsKg: 2676.3, co2CostCents: 0, co2Counted: false, note: 'Vor dem 01.01.2023 in Rechnung gestellt …' } })
  expect(ohne[0]?.label).toBe('Anfangsbestand (Vorrat, nur die kg zählen)')
})

test('Gas über einen Zeitraum, geschätzte Rechnung, Vorrat, Emissionshandel und Beschränkung', () => {
  const gas: Co2Sheet = {
    ...sheet, energy: 'districtHeating', areaM2: null, areaSource: null, restriction: 'both', districtEtsNew: true, checked: false,
    stock: { stockUnit: 'l', openingQuantity: 2000, openingEmissionsKg: 5352.6, openingCo2Cents: 0, openingInvoicedBefore2023: true, openingAlreadySettled: null, closingQuantity: 1800, closingMeasuredOn: '2025-12-31' },
    deliveries: [{ ...heizoel, label: 'Wärme', estimated: true, from: '2025-01-01', to: '2025-12-31', deliveredAt: null, quantity: null, quantityUnit: null, energyKwh: 50000, gasBasis: 'hs', emissionFactor: null, amountCents: null }],
  }
  expect(sheetHead(gas).lines[2]).toBe('Heizanlage: Kessel (Fernwärme)')
  expect(sheetRows(gas)[0]).toEqual({ kind: 'delivery', label: 'Wärme (geschätzt)', note: null, cells: ['15.03.2025', '01.01.2025 bis 31.12.2025', '–', '50.000 kWh (Brennwert)', '–', '8.028,9 kg', fmtEuro(52549), '–'] })
  const facts = sheetFacts(gas)
  expect(facts[0]).toBe('Fläche für die Einstufung: nicht angegeben')
  expect(facts[1]).toBe('Kein Nichtwohngebäude (§ 8 CO2KostAufG); Beschränkung nach § 9 Abs. 2 CO2KostAufG (Gebäude und Wärmeversorgung)')
  expect(facts[2]).toBe('Wärme aus Anlagen des Emissionshandels, erster Anschluss nach dem 01.01.2023 (§ 2 Abs. 4 Satz 2 CO2KostAufG): Die CO₂-Kosten werden nicht aufgeteilt, die Angaben deshalb nicht geprüft.')
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

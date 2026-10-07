import { expect, test } from 'vitest'
import { hasSheet, sheetFacts, sheetHead, sheetRows } from './co2Sheet'
import { fmtEuro } from './api'
import type { Co2Sheet, Co2SheetDelivery } from './types'

const heizoel: Co2SheetDelivery = {
  id: 'd', label: 'Heizöl', invoiceDate: '2025-03-15', from: null, to: null, deliveredAt: '2025-03-15', quantity: 3000, quantityUnit: 'l', energyKwh: null, gasBasis: null, emissionFactor: 0.2664,
  emissionsKg: 8028.9, co2CostCents: 52549, amountCents: 315000, estimated: false, counted: 'full', factor: 1, note: null, inPeriod: null, findings: [],
}
const noBilling = { closing: null, consumed: null, inPeriod: null, basis: null }
const sheet: Co2Sheet = {
  propertyName: 'Haus am Park', address: 'Parkweg 1', landlordName: 'Erika Muster', plantName: 'Kessel', energy: 'oil', createdOn: '2026-10-07', checked: true,
  period: { key: '2025-01', from: '2025-01-01', to: '2025-12-31' }, areaM2: 300, areaSource: 'served', nonResidential: false, restriction: 'none', districtEtsNew: false,
  stock: null, opening: null, billing: noBilling,
  deliveries: [heizoel],
  totals: { emissionsKg: 8028.9, co2CostCents: 52549 },
}
const FOOT = 'Angaben je Rechnung nach § 3 Abs. 1 Nr. 1 bis 4 CO2KostAufG, wie sie der Lieferant ausweist. Die Summe der Rechnungen ist nicht der CO₂-Ausstoß des Abrechnungszeitraums: Auf ihn umgerechnet (§ 5 Abs. 1 Satz 5 CO2KostAufG) und ohne den Endbestand eines Vorrats (§ 7 Abs. 1 CO2KostAufG: im Abrechnungszeitraum verursacht) sind erst die Zeilen darunter, wie die Abrechnung sie ansetzt. Nicht gezählt sind Angaben, die nach dem CO2KostAufG unberücksichtigt bleiben'

test('Kopf, Zeilen und Angaben zur Einstufung', () => {
  expect(sheetHead(sheet)).toEqual({ title: 'CO₂-Angaben für den Messdienst', lines: ['Haus am Park, Parkweg 1', 'Vermieter: Erika Muster', 'Heizanlage: Kessel (Öl)', 'Heizperiode: 01.01.2025 bis 31.12.2025', 'Stand: 07.10.2026'] })
  expect(sheetRows(sheet)).toEqual([
    { kind: 'delivery', label: 'Heizöl', note: null, sub: null, cells: ['15.03.2025', 'geliefert 15.03.2025', '3.000 l', '–', '0,2664 kg CO₂/kWh', '8.028,9 kg', fmtEuro(52549), fmtEuro(315000)] },
    { kind: 'sum', label: 'Summe der Rechnungen (nicht abgegrenzt)', note: null, sub: null, cells: ['', '', '', '', '', '8.028,9 kg', fmtEuro(52549), ''] },
  ])
  expect(sheetFacts(sheet)).toEqual([
    'Fläche für die Einstufung: 300 m² (Summe der Wohnflächen der versorgten Wohnungen laut Vermieter)',
    'Kein Nichtwohngebäude (§ 8 CO2KostAufG); keine Beschränkung nach § 9 CO2KostAufG',
    `${FOOT}.`,
  ])
})

test('S-W1 Vorrat: abzüglich Endbestand und Verbrauch wie in der Abrechnung; Einstufung laut Abrechnung', () => {
  const s: Co2Sheet = {
    ...sheet,
    stock: { stockUnit: 'l', openingQuantity: 1000, openingEmissionsKg: 2676.3, openingCo2Cents: 17517, openingInvoicedBefore2023: false, openingAlreadySettled: null, closingQuantity: 1800, closingMeasuredOn: '2025-12-31' },
    opening: { quantity: 1000, emissionsKg: 2676.3, co2CostCents: 17517, countedCents: 17517, kgCounted: true, co2Counted: true, note: null, adminNote: null },
    billing: {
      closing: { quantity: 1800, emissionsKg: 4817.34, co2Cents: 31529, measuredOn: '2025-12-31' },
      consumed: { quantity: 2200, emissionsKg: 5887.86, co2Cents: 38537 },
      inPeriod: null,
      basis: { source: 'stock', emissionsKg: 5887.86, co2Cents: 38537, kgPerM2: 19.6, areaM2: 300, landlordPermille: 200, stage: { from: 17, to: 22, landlordPercent: 20 } },
    },
    totals: { emissionsKg: 10705.2, co2CostCents: 70066 },
  }
  const rows = sheetRows(s)
  expect(rows.map((r) => r.label)).toEqual(['Anfangsbestand (Vorrat)', 'Heizöl', 'Summe der Rechnungen (nicht abgegrenzt)', 'abzüglich Endbestand am 31.12.2025 (1.800 l)', 'Verbrauch in der Heizperiode (wie in der Abrechnung)'])
  expect(rows[3]?.cells.slice(5, 7)).toEqual(['−4.817,34 kg', `−${fmtEuro(31529)}`])
  expect(rows[4]?.cells.slice(5, 7)).toEqual(['5.887,86 kg', fmtEuro(38537)])
  expect(sheetFacts(s)).toContain('Vorrat: Anfangsbestand 1.000 l mit 2.676,3 kg CO₂; Endbestand 1.800 l am 31.12.2025')
  expect(sheetFacts(s)).toContain('Einstufung laut Abrechnung: 19,6 kg CO₂ je m² Wohnfläche (300 m²), Stufe 17 bis unter 22 kg, Vermieter 20 % der CO₂-Kosten')
})

test('S-W1 Zeitraumrechnungen: je Rechnung der Teil in der Heizperiode, die Summe davon; hochgerechnet nur benannt', () => {
  const gas = { ...heizoel, label: 'Gas', from: '2024-07-01', to: '2025-06-30', deliveredAt: null, quantity: null, quantityUnit: null, emissionsKg: 10000, co2CostCents: 65450, inPeriod: { emissionsKg: 5000, co2Cents: 32725, sharePermille: 500, method: 'degreeDays' as const } }
  const s: Co2Sheet = {
    ...sheet, energy: 'gas', deliveries: [gas], totals: { emissionsKg: 10000, co2CostCents: 65450 },
    billing: { ...noBilling, inPeriod: { emissionsKg: 5000, co2Cents: 32725, coveragePermille: 1000 }, basis: { source: 'deliveries', emissionsKg: 5000, co2Cents: 32725, kgPerM2: null, areaM2: null, landlordPermille: null, stage: null } },
  }
  const rows = sheetRows(s)
  expect(rows[0]?.sub).toBe('davon in der Heizperiode: 5.000 kg, ' + fmtEuro(32725) + ' (500 ‰, nach der Gradtagszahlentabelle)')
  expect(rows.map((r) => r.label)).toEqual(['Gas', 'Summe der Rechnungen (nicht abgegrenzt)', 'davon in der Heizperiode (Abgrenzung wie in der Abrechnung)'])
  expect(rows[2]?.cells.slice(5, 7)).toEqual(['5.000 kg', fmtEuro(32725)])
  const luecke = sheetRows({ ...s, billing: { ...s.billing, inPeriod: { emissionsKg: 4500, co2Cents: 29453, coveragePermille: 900 }, basis: { source: 'deliveries', emissionsKg: 5000, co2Cents: 29453, kgPerM2: null, areaM2: null, landlordPermille: null, stage: null } } })
  expect(luecke.map((r) => r.label).slice(2)).toEqual([
    'davon in der Heizperiode (Abgrenzung wie in der Abrechnung; die Rechnungen decken 900 ‰ der Gradtage ab)',
    'Grundlage der CO₂-Aufteilung in der Abrechnung (kg hochgerechnet auf die ganze Heizperiode)',
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

test('G-W1, G-W2, S-K1: Vermerke an den Zeilen; der Anfangsbestand zeigt den Betrag laut Eintrag', () => {
  const s: Co2Sheet = {
    ...sheet,
    stock: { stockUnit: 'l', openingQuantity: 1000, openingEmissionsKg: 2676.3, openingCo2Cents: 17517, openingInvoicedBefore2023: false, openingAlreadySettled: true, closingQuantity: 500, closingMeasuredOn: '2025-12-31' },
    opening: { quantity: 1000, emissionsKg: 2676.3, co2CostCents: 17517, countedCents: 0, kgCounted: true, co2Counted: false, note: 'Schon mit einer früheren Abrechnung umgelegt …', adminNote: null },
    deliveries: [heizoel, { ...heizoel, id: 'x', label: 'Heizöl alt', counted: 'none', note: 'Storniert: Die Kostenpositionen dieser Rechnung ergeben 0 €; sie zählt nicht.' }],
    totals: { emissionsKg: 10705.2, co2CostCents: 52549 },
  }
  const rows = sheetRows(s)
  expect(rows[0]).toEqual({ kind: 'opening', label: 'Anfangsbestand (Vorrat, nur die kg zählen)', note: 'Schon mit einer früheren Abrechnung umgelegt …', sub: null, cells: ['', '', '1.000 l', '–', '–', '2.676,3 kg', fmtEuro(17517), ''] })
  expect(rows[2]?.label).toBe('Heizöl alt (zählt nicht)')
  expect(sheetFacts(s).at(-1)).toBe(`${FOOT} (siehe Vermerke).`)
  const ohneKg = sheetRows({ ...s, opening: { quantity: 1000, emissionsKg: null, co2CostCents: 17517, countedCents: 0, kgCounted: false, co2Counted: false, note: 'Nicht berücksichtigt …', adminNote: null } })
  expect(ohneKg[0]?.label).toBe('Anfangsbestand (Vorrat, zählt nicht)')
})

test('Klein (Runde 3): beim Emissionshandel mit Anschluss nach dem Stichtag keine Angaben zur Einstufung und keine Summe', () => {
  const ets: Co2Sheet = { ...sheet, energy: 'districtHeating', districtEtsNew: true, checked: false, restriction: 'both' }
  expect(sheetRows(ets).some((r) => r.kind === 'sum' || r.kind === 'billing')).toBe(false)
  const facts = sheetFacts(ets)
  expect(facts).toEqual([
    'Wärme aus Anlagen des Emissionshandels, erster Anschluss nach dem 01.01.2023 (§ 2 Abs. 4 Satz 2 CO2KostAufG): Die CO₂-Kosten werden nicht aufgeteilt, die Angaben deshalb nicht geprüft.',
    'Angaben je Rechnung, wie sie der Lieferant ausweist. Nach § 2 Abs. 4 Satz 2 CO2KostAufG werden die CO₂-Kosten dieser Wärme nicht aufgeteilt; eine Summe entfällt deshalb.',
  ])
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

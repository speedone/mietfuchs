// Rechnungsansicht einer E-Rechnung als XML-Datei (#189, PR 3): was die Ansicht und das PDF daraus zeigen.
import { expect, test } from 'vitest'
import type { EInvoice, EInvoiceView } from './types'
import { eInvoiceDocument, receiptHref } from './eInvoiceView'

const invoice = (more: Partial<EInvoice> = {}): EInvoice => ({
  syntax: 'ubl-invoice', typeCode: '380', number: 'R-42', issueDate: '2025-03-14', currency: 'EUR',
  seller: 'Haustechnik Beispiel GmbH', sellerAddress: { lines: ['Werkstraße 7'], postcode: '12345', city: 'Musterstadt', country: 'DE' },
  sellerVatId: 'DE123456789', buyer: 'Erika Mustermann', buyerAddress: null,
  periodStart: '2025-01-01', periodEnd: '2025-03-31', deliveryDate: null, dueDate: '2025-03-28', paymentTerms: 'Zahlbar ohne Abzug.',
  iban: 'DE02120300000000202051', precedingInvoice: null,
  lines: [
    { id: '1', name: 'Wartung Heizung', description: 'Jahreswartung', netCents: 12000, unitCode: 'HUR', vat: { category: 'S', rateBasisPoints: 1900 }, quantity: '1.5', unitPrice: '80.0000' },
    { id: '2', name: 'Dichtung', description: null, netCents: 500, unitCode: 'XYZ', vat: { category: 'S', rateBasisPoints: 1900 }, quantity: '1', unitPrice: null },
  ],
  charges: [{ charge: false, cents: 1000, reason: 'Rabatt', vat: { category: 'S', rateBasisPoints: 1900 } }],
  vatGroups: [{ vat: { category: 'S', rateBasisPoints: 1900 }, basisCents: 11500, taxCents: 2185 }],
  totals: { lineNet: 12500, allowances: 1000, charges: null, taxExclusive: 11500, tax: 2185, taxInclusive: 13685, prepaid: 3685, rounding: null, payable: 10000 },
  unreadable: [],
  ...more,
})
const view = (more: Partial<EInvoiceView> = {}): EInvoiceView => ({ invoice: invoice(), notes: [], refusal: null, ...more })

test('receiptHref: eine XML-Datei öffnet die Rechnungsansicht, alles andere die Datei', () => {
  expect(receiptHref('1700000000000_x rechnung.xml')).toBe('/?e-rechnung=1700000000000_x%20rechnung.xml')
  expect(receiptHref('a.XML')).toBe('/?e-rechnung=a.XML')
  expect(receiptHref('1700000000000_a&b.pdf')).toBe('/uploads/1700000000000_a%26b.pdf')
})

test('Rechnungsansicht: Kopf, Beteiligte, Positionen, Abschlag, Steuer, Summen und Zahlung', () => {
  const d = eInvoiceDocument(view())
  expect(d.title).toBe('Rechnung Nr. R-42')
  expect(d.facts).toEqual([
    ['Rechnungsart', 'Rechnung (380)'],
    ['Rechnungsnummer', 'R-42'],
    ['Rechnungsdatum', '14.03.2025'],
    ['Leistungszeitraum', '01.01.2025 bis 31.03.2025'],
    ['Währung', 'EUR'],
  ])
  expect(d.parties).toEqual([
    { role: 'Verkäufer', name: 'Haustechnik Beispiel GmbH', lines: ['Werkstraße 7', '12345 Musterstadt', 'DE', 'USt-IdNr. DE123456789'] },
    { role: 'Käufer', name: 'Erika Mustermann', lines: [] },
  ])
  expect(d.positions).toEqual([
    { nr: '1', name: 'Wartung Heizung', description: 'Jahreswartung', quantity: '1,5 Std.', unitPrice: '80,00 €', vat: '19 %', net: '120,00 €' },
    { nr: '2', name: 'Dichtung', description: null, quantity: '1 XYZ', unitPrice: '', vat: '19 %', net: '5,00 €' },
  ])
  expect(d.charges).toEqual([{ kind: 'Abschlag', reason: 'Rabatt', vat: '19 %', amount: '-10,00 €' }])
  expect(d.vat).toEqual([{ label: '19 %', basis: '115,00 €', tax: '21,85 €' }])
  expect(d.totals).toEqual([
    ['Summe der Positionen (netto)', '125,00 €'],
    ['Abschläge', '-10,00 €'],
    ['Gesamt netto', '115,00 €'],
    ['Umsatzsteuer', '21,85 €'],
    ['Gesamt brutto', '136,85 €'],
    ['Bereits gezahlt', '-36,85 €'],
    ['Zahlbetrag', '100,00 €'],
  ])
  expect(d.payment).toEqual([['Fällig am', '28.03.2025'], ['IBAN', 'DE02 1203 0000 0000 2020 51'], ['Zahlungsbedingungen', 'Zahlbar ohne Abzug.']])
})

test('Rechnungsansicht: Gutschrift, Steuerbefreiung, fremde Währung, Lieferdatum, Bezug und unbekannte Rechnungsart', () => {
  const d = eInvoiceDocument(view({
    invoice: invoice({
      syntax: 'ubl-credit-note', typeCode: '381', currency: 'CHF', periodStart: null, periodEnd: null, deliveryDate: '2025-02-01',
      precedingInvoice: { number: 'R-41', date: '2025-01-10' }, iban: null, dueDate: null, paymentTerms: null,
      vatGroups: [{ vat: { category: 'E', rateBasisPoints: 0 }, basisCents: 11500, taxCents: 0 }],
    }),
  }))
  expect(d.title).toBe('Gutschrift Nr. R-42')
  expect(d.facts).toContainEqual(['Lieferdatum', '01.02.2025'])
  expect(d.facts).toContainEqual(['Bezug auf Rechnung', 'R-41 vom 10.01.2025'])
  expect(d.vat[0].label).toBe('steuerfrei')
  expect(d.positions[0].net).toBe('120,00 CHF')
  expect(d.payment).toEqual([])
  expect(eInvoiceDocument(view({ invoice: invoice({ typeCode: '999', number: null }) })).title).toBe('Rechnung (Art 999)')
})

test('Rechnungsansicht: Grund, Hinweise und Unlesbares stehen da', () => {
  const d = eInvoiceDocument(view({ refusal: 'Abschlagsrechnungen übernimmt Mietfuchs nicht.', notes: ['Bereits gezahlt: 36,85 €.'], invoice: invoice({ unreadable: ['BT-131 Position 2'] }) }))
  expect(d.refusal).toBe('Abschlagsrechnungen übernimmt Mietfuchs nicht.')
  expect(d.notes).toEqual(['Bereits gezahlt: 36,85 €.'])
  expect(d.unreadable).toEqual(['BT-131 Position 2'])
})

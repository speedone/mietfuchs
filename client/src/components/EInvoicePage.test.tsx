// @vitest-environment jsdom
// Rechnungsansicht einer E-Rechnung als XML-Datei (#189, PR 3): Seite unter `?e-rechnung=…`.
import { afterEach, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { EInvoiceView } from '../types'
import { EInvoicePage } from './EInvoicePage'

afterEach(cleanup)

const VIEW: EInvoiceView = {
  invoice: {
    syntax: 'cii', typeCode: '380', number: '112233', issueDate: '2021-04-23', currency: 'EUR',
    seller: 'Testverkäufer', sellerAddress: { lines: ['Teststraße'], postcode: '12345', city: 'Testhausen', country: 'DE' }, sellerVatId: 'DE12345464867',
    buyer: 'Testkäufer', buyerAddress: null, periodStart: null, periodEnd: null, deliveryDate: '2020-11-23', dueDate: '2021-04-28', paymentTerms: null,
    iban: 'DE79000000001234567890', precedingInvoice: null,
    lines: [{ id: '4', name: 'Montage', description: null, netCents: 50000, unitCode: 'HUR', vat: { category: 'S', rateBasisPoints: 1900 }, quantity: '1.00', unitPrice: '500.00' }],
    charges: [], vatGroups: [{ vat: { category: 'S', rateBasisPoints: 1900 }, basisCents: 50000, taxCents: 9500 }],
    totals: { lineNet: 50000, allowances: null, charges: null, taxExclusive: 50000, tax: 9500, taxInclusive: 59500, prepaid: null, rounding: null, payable: 59500 },
    unreadable: [],
  },
  notes: [],
  refusal: null,
}

test('Rechnungsansicht: Titel, Beteiligte, Positionen und Summen stehen lesbar da, das Original als Download', async () => {
  render(<EInvoicePage file="1700000000000_xrechnung.xml" load={async () => VIEW} />)
  expect(await screen.findByRole('heading', { level: 1, name: 'Rechnung Nr. 112233' })).toBeTruthy()
  expect(screen.getByText('Testverkäufer')).toBeTruthy()
  expect(screen.getByText('USt-IdNr. DE12345464867')).toBeTruthy()
  const row = screen.getByText('Montage').closest('tr') ?? expect.fail('Zeile fehlt')
  const cell = (label: string) => row.querySelector(`td[data-label="${label}"]`)?.textContent
  expect(cell('Menge')).toBe('1 Std.')
  expect(cell('Einzelpreis')).toBe('500,00 €')
  expect(cell('Netto')).toBe('500,00 €')
  expect(screen.getByRole('rowheader', { name: 'Zahlbetrag' }).nextElementSibling?.textContent).toBe('595,00 €')
  const original = screen.getByRole('link', { name: 'Original (XML) herunterladen' })
  expect(original.getAttribute('href')).toBe('/uploads/1700000000000_xrechnung.xml')
  expect(original.hasAttribute('download')).toBe(true)
  expect(screen.queryByText(/Wird nicht in die Kosten übernommen/)).toBeNull()
})

test('Rechnungsansicht: Grund und Hinweise stehen oben, ein Ladefehler als Fehler', async () => {
  render(<EInvoicePage file="a.xml" load={async () => ({ ...VIEW, refusal: 'Abschlagsrechnungen übernimmt Mietfuchs nicht.', notes: ['Bereits gezahlt: 10,00 €.'] })} />)
  expect(await screen.findByText(/Abschlagsrechnungen übernimmt Mietfuchs nicht/)).toBeTruthy()
  expect(screen.getByText('Bereits gezahlt: 10,00 €.')).toBeTruthy()
  cleanup()
  render(<EInvoicePage file="a.xml" load={async () => { throw new Error('Dieser Beleg ist keine E-Rechnung als XML-Datei.') }} />)
  expect(await screen.findByText(/keine E-Rechnung als XML-Datei/)).toBeTruthy()
  expect(screen.getByRole('button', { name: /Drucken/ }).hasAttribute('disabled')).toBe(true)
})

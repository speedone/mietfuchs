// Seiten für eine E-Rechnung als XML-Datei (#189, PR 3): das gesetzte PDF, gelesen mit echtem pdf.js wie in der
// Oberfläche (legacy-Fassung).
import { expect, test } from 'vitest'
import { getDocument, VerbosityLevel } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { EInvoiceLine, EInvoiceView } from './types'
import { eInvoicePdf, eInvoicePdfOf } from './eInvoicePdf'
import { pageText } from './pdfIntake'

const line = (id: number, name: string): EInvoiceLine => ({
  id: String(id), name, description: null, netCents: 1000, unitCode: 'C62', vat: { category: 'S', rateBasisPoints: 1900 }, quantity: '1', unitPrice: '10.00',
})
const view = (lines: EInvoiceLine[], more: Partial<EInvoiceView> = {}): EInvoiceView => ({
  invoice: {
    syntax: 'ubl-invoice', typeCode: '380', number: 'R-42', issueDate: '2025-03-14', currency: 'EUR',
    seller: 'Haustechnik Beispiel GmbH', sellerAddress: { lines: ['Werkstraße 7'], postcode: '12345', city: 'Musterstadt', country: 'DE' }, sellerVatId: null,
    buyer: 'Erika Mustermann', buyerAddress: null, periodStart: null, periodEnd: null, deliveryDate: '2025-03-10', dueDate: null, paymentTerms: null,
    iban: null, precedingInvoice: null, lines, charges: [],
    vatGroups: [{ vat: { category: 'S', rateBasisPoints: 1900 }, basisCents: 1000 * lines.length, taxCents: 190 * lines.length }],
    totals: { lineNet: 1000 * lines.length, allowances: null, charges: null, taxExclusive: 1000 * lines.length, tax: 190 * lines.length, taxInclusive: 1190 * lines.length, prepaid: null, rounding: null, payable: 1190 * lines.length },
    unreadable: [],
  },
  notes: [],
  refusal: null,
  ...more,
})

async function textOf(bytes: Uint8Array): Promise<{ pages: number; text: string[] }> {
  const doc = await getDocument({ data: bytes, verbosity: VerbosityLevel.ERRORS }).promise
  const text: string[] = []
  for (let n = 1; n <= doc.numPages; n++) text.push(pageText((await (await doc.getPage(n)).getTextContent()).items))
  return { pages: doc.numPages, text }
}

test('E-Rechnung als PDF: Titel, Beteiligte, Positionen, Summen und der Hinweis, dass die XML-Datei gilt', async () => {
  const { pages, text } = await textOf(await eInvoicePdf(view([line(1, 'Wartung Heizung'), line(2, 'Dichtung')], { refusal: 'Abschlagsrechnungen übernimmt Mietfuchs nicht.' })))
  expect(pages).toBe(1)
  const all = text.join(' ')
  for (const s of ['Rechnung Nr. R-42', 'Haustechnik Beispiel GmbH', 'Werkstraße 7', '12345 Musterstadt', 'Wartung Heizung', 'Dichtung', 'Zahlbetrag', '23,80 €', 'Abschlagsrechnungen übernimmt Mietfuchs nicht.', 'Maßgeblich ist die XML-Datei', 'Seite 1 von 1']) {
    expect(all).toContain(s)
  }
})

test('E-Rechnung als PDF: viele Positionen gehen auf Folgeseiten, lange Bezeichnungen brechen um, fremde Zeichen scheitern nicht', async () => {
  const lines = Array.from({ length: 90 }, (_, i) => line(i + 1, i === 0 ? `Sehr lange Bezeichnung ${'Wartungsarbeiten '.repeat(20)}mit Pfeil → und Emoji 🔧` : `Position ${i + 1}`))
  const { pages, text } = await textOf(await eInvoicePdf(view(lines)))
  expect(pages).toBeGreaterThan(2)
  expect(text.join(' ')).toContain('Position 90')
  expect(text.at(-1)).toContain(`Seite ${pages} von ${pages}`)
})

test('E-Rechnung als PDF zu einem gespeicherten Beleg: die Ansicht kommt vom Server', async () => {
  const asked: string[] = []
  const bytes = await eInvoicePdfOf('1700000000000_a b.xml', async (f) => { asked.push(f); return view([line(1, 'Wartung')]) })
  expect(asked).toEqual(['1700000000000_a b.xml'])
  expect((await textOf(bytes)).text.join(' ')).toContain('Wartung')
})

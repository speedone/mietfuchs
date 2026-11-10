// Seiten und Vorschaubild einer E-Rechnung als XML-Datei (#189, PR 3): Sie kommen aus dem gesetzten PDF der
// Rechnungsansicht, nicht aus der Datei, die nur als Download ausgeliefert wird.
import { expect, test, vi } from 'vitest'

const opened: unknown[] = []
vi.mock('./pdf', () => ({
  openPdf: vi.fn(async (source: unknown) => { opened.push(source); return { doc: { numPages: 2 }, close: () => {} } }),
  renderPage: vi.fn(async (_doc: unknown, n: number) => ({ toDataURL: () => `data:image/jpeg;seite-${n}` })),
  discardPdfWorker: vi.fn(),
}))
vi.mock('./eInvoicePdf', () => ({
  isXmlReceipt: (file: string, mimeType?: string) => mimeType === 'application/xml' || /\.xml$/i.test(file),
  eInvoicePdfOf: vi.fn(async () => new Uint8Array([1, 2, 3])),
}))

const { renderInvoicePages, renderThumbnail } = await import('./pdfPreview')

test('Druckseiten: ein PDF über seine Adresse, ein Bild unmittelbar, eine XML-Datei als gesetztes PDF', async () => {
  expect(await renderInvoicePages('b.jpg')).toEqual(['/uploads/b.jpg'])
  opened.length = 0
  expect(await renderInvoicePages('1700000000000_r.xml')).toEqual(['data:image/jpeg;seite-1', 'data:image/jpeg;seite-2'])
  expect(opened).toEqual([{ data: new Uint8Array([1, 2, 3]).buffer }])
  opened.length = 0
  await renderInvoicePages('a.pdf')
  expect(opened).toEqual([{ url: '/uploads/a.pdf' }])
})

test('Vorschaubild: eine XML-Datei als gesetztes PDF, auch nach ihrer Art', async () => {
  opened.length = 0
  expect(await renderThumbnail('ohne-endung', 'application/xml')).toBe('data:image/jpeg;seite-1')
  expect(opened).toEqual([{ data: new Uint8Array([1, 2, 3]).buffer }])
  expect(await renderThumbnail('c.png', 'image/png')).toBe('/uploads/c.png')
})

// Rendert hochgeladene Belege (PDF oder Bild) als Bildseiten für den Druck.
// Browser drucken eingebettete PDFs nicht mit — daher werden die Seiten per
// pdf.js auf Canvas gerendert und als JPEG-Data-URLs in den Druck eingebettet.
import { openPdf, renderPage } from './pdf'

const cache = new Map<string, Promise<string[]>>()

export function renderInvoicePages(file: string): Promise<string[]> {
  let p = cache.get(file)
  if (!p) {
    p = doRender(file)
    p.catch(() => cache.delete(file)) // Fehlversuche nicht dauerhaft cachen
    cache.set(file, p)
  }
  return p
}

async function doRender(file: string): Promise<string[]> {
  const url = `/uploads/${encodeURIComponent(file)}`
  if (!/\.pdf$/i.test(file)) return [url] // Bilddateien direkt einbetten
  const { doc, close } = await openPdf({ url })
  const pages: string[] = []
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      pages.push((await renderPage(doc, n)).toDataURL('image/jpeg', 0.85))
    }
  } finally {
    close()
  }
  return pages
}

// Lesbarer Anzeigename eines Uploads (ohne Timestamp-Präfix, Unterstriche geglättet)
export function invoiceLabel(file: string): string {
  return file.replace(/^\d+_/, '').replace(/__+/g, ' ').replace(/_/g, ' ')
}

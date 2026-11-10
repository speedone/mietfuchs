// Rendert hochgeladene Belege (PDF, Bild oder E-Rechnung als XML-Datei) als Bildseiten für den Druck.
// Browser drucken eingebettete PDFs nicht mit - daher werden die Seiten per
// pdf.js auf Canvas gerendert und als JPEG-Data-URLs in den Druck eingebettet.
import { discardPdfWorker, openPdf, renderPage, type PdfSource } from './pdf'
import { eInvoicePdfOf, isXmlReceipt } from './eInvoicePdf'
import { createLimiter, createPreviewCache } from './previewQueue'

// Eine Warteschlange für alles, was hier Belege rendert (Vorschaubilder, Druck der Belegkopien,
// Belegmappe): höchstens zwei Dokumente zugleich offen, jedes nach dem Rendern freigegeben
// (previewQueue.ts). Der Druck braucht alle Seiten und fragt deshalb ohne Sichtbarkeit an.
// Überschreitet ein Auftrag sein Zeitlimit, scheitert er wie ein unlesbarer Beleg, sein Platz wird frei, und der
// gemeinsame Worker wird verworfen: Er hängt oder ist gestorben (Durchsicht von PR #449, K1).
const limiter = createLimiter(undefined, { onTimeout: discardPdfWorker })
// Zeitlimit je Beleg: das Vorschaubild ist eine kleine erste Seite, die Druckseiten sind alle Seiten in voller Größe.
export const THUMB_TIMEOUT_MS = 30_000
export const PAGES_TIMEOUT_MS = 180_000
// Gemerkt werden die Seiten weniger Belege (gedruckte Seiten sind groß), aber viele Vorschaubilder.
const pageCache = createPreviewCache<string[]>(limiter, 12, { timeoutMs: PAGES_TIMEOUT_MS })

// Eine E-Rechnung als XML-Datei (#189) hat keine Seiten; sie kommen aus der Rechnungsansicht, gesetzt als PDF
// (eInvoicePdf.ts). Die Datei selbst liefert der Server nur als Download.
const eInvoiceSource = async (file: string): Promise<PdfSource> => {
  const bytes = await eInvoicePdfOf(file)
  return { data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer }
}
const sourceOf = (file: string): Promise<PdfSource> =>
  isXmlReceipt(file) ? eInvoiceSource(file) : Promise.resolve({ url: `/uploads/${encodeURIComponent(file)}` })

export function renderInvoicePages(file: string, signal?: AbortSignal): Promise<string[]> {
  const url = `/uploads/${encodeURIComponent(file)}`
  if (!/\.pdf$/i.test(file) && !isXmlReceipt(file)) return Promise.resolve([url]) // Bilddateien direkt einbetten
  return pageCache.get(file, async () => doRender(await sourceOf(file)), signal)
}

async function doRender(source: PdfSource): Promise<string[]> {
  const { doc, close } = await openPdf(source)
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

// Vorschaubild für den Belegordner (#170): die erste Seite, klein gerendert. Bilder zeigt der
// Browser selbst; für sie gibt es die Adresse der Datei zurück. Gemerkt wie die Druckseiten, damit
// ein Wechsel des Filters nicht jedes PDF neu öffnet. `signal` zieht eine Anfrage zurück, die noch
// nicht dran war (das Bild ist aus dem sichtbaren Bereich gescrollt).
const thumbnails = createPreviewCache<string>(limiter, 300, { timeoutMs: THUMB_TIMEOUT_MS })
export const THUMB_EDGE = 320

export function renderThumbnail(file: string, mimeType: string, signal?: AbortSignal): Promise<string> {
  const url = `/uploads/${encodeURIComponent(file)}`
  if (mimeType.startsWith('image/')) return Promise.resolve(url)
  return thumbnails.get(file, async () => {
    const { doc, close } = await openPdf(isXmlReceipt(file, mimeType) ? await eInvoiceSource(file) : { url })
    try {
      return (await renderPage(doc, 1, { scale: 1, maxEdge: THUMB_EDGE })).toDataURL('image/jpeg', 0.7)
    } finally {
      close()
    }
  }, signal)
}

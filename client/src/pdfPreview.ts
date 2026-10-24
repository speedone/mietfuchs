// Rendert hochgeladene Belege (PDF oder Bild) als Bildseiten für den Druck.
// Browser drucken eingebettete PDFs nicht mit — daher werden die Seiten per
// pdf.js auf Canvas gerendert und als JPEG-Data-URLs in den Druck eingebettet.
import { openPdf, renderPage } from './pdf'
import { createLimiter, createPreviewCache } from './previewQueue'

// Eine Warteschlange für alles, was hier Belege rendert (Vorschaubilder, Druck der Belegkopien,
// Belegmappe): höchstens zwei Dokumente zugleich offen, jedes nach dem Rendern freigegeben
// (previewQueue.ts). Der Druck braucht alle Seiten und fragt deshalb ohne Sichtbarkeit an.
const limiter = createLimiter()
// Gemerkt werden die Seiten weniger Belege (gedruckte Seiten sind groß), aber viele Vorschaubilder.
const pageCache = createPreviewCache<string[]>(limiter, 12)

export function renderInvoicePages(file: string, signal?: AbortSignal): Promise<string[]> {
  const url = `/uploads/${encodeURIComponent(file)}`
  if (!/\.pdf$/i.test(file)) return Promise.resolve([url]) // Bilddateien direkt einbetten
  return pageCache.get(file, () => doRender(file), signal)
}

async function doRender(file: string): Promise<string[]> {
  const { doc, close } = await openPdf({ url: `/uploads/${encodeURIComponent(file)}` })
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
const thumbnails = createPreviewCache<string>(limiter, 300)
export const THUMB_EDGE = 320

export function renderThumbnail(file: string, mimeType: string, signal?: AbortSignal): Promise<string> {
  const url = `/uploads/${encodeURIComponent(file)}`
  if (mimeType.startsWith('image/')) return Promise.resolve(url)
  return thumbnails.get(file, async () => {
    const { doc, close } = await openPdf({ url })
    try {
      return (await renderPage(doc, 1, { scale: 1, maxEdge: THUMB_EDGE })).toDataURL('image/jpeg', 0.7)
    } finally {
      close()
    }
  }, signal)
}

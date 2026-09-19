// pdf.js im Browser, gemeinsam für den Druck der Belegkopien (pdfPreview.ts) und das Lesen
// eines PDFs vor dem Hochladen (pdfIntake.ts). pdf.js wird erst bei Bedarf geladen, damit der
// normale Seitenaufruf schlank bleibt.
//
// Bewusst die legacy-Fassung: Die moderne setzt die allerneuesten Browser voraus und scheitert
// schon an einem Browser vom Frühjahr 2025 („toHex is not a function“). Die legacy-Fassung
// bringt die fehlenden Funktionen selbst mit und läuft ab Chrome 125, Safari 18 und Firefox ESR.
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'

type Pdfjs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
let geladen: Promise<Pdfjs> | null = null

function loadPdfjs(): Promise<Pdfjs> {
  geladen ??= import('pdfjs-dist/legacy/build/pdf.mjs').then(
    (pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString()
      return pdfjs
    },
    (err) => {
      // Nicht dauerhaft merken: Nach einem Update fehlt einem alten Tab der Teil unter dem
      // alten Namen. Der nächste Versuch soll es erneut probieren können.
      geladen = null
      throw err
    },
  )
  return geladen
}

export type PdfSource = { url: string } | { data: ArrayBuffer }

export async function openPdf(source: PdfSource): Promise<{ doc: PDFDocumentProxy; close: () => void }> {
  const pdfjs = await loadPdfjs()
  const task = pdfjs.getDocument({
    ...source,
    // Dekoder/Ressourcen, die Vite nach /pdfjs/ kopiert (siehe vite.config.ts):
    // ohne sie bleiben JBIG2-/JPEG2000-Scans (Behörden-Bescheide) fast leer.
    wasmUrl: '/pdfjs/wasm/',
    iccUrl: '/pdfjs/iccs/',
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
  })
  try {
    return { doc: await task.promise, close: () => void task.destroy() }
  } catch (err) {
    void task.destroy()
    throw err
  }
}

// Längste Seite eines gerenderten Bildes. Skalierung 2 entspricht etwa 150 dpi bei A4; bei
// übergroßen Seiten (etwa ein Scan, dessen Seitengröße der Pixelzahl entspricht) wird kleiner
// gerendert. Sonst wüchse das Canvas über die Grenzen mancher Browser (iOS Safari um 16 MP),
// und das Vision-Modell bekäme unnötig große Bilder.
export const MAX_KANTE = 2500

export async function renderPage(doc: PDFDocumentProxy, n: number, scale = 2): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(n)
  try {
    const basis = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: Math.min(scale, MAX_KANTE / Math.max(basis.width, basis.height)) })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const canvasContext = canvas.getContext('2d')!
    await page.render({ canvas, canvasContext, viewport } as never).promise
    return canvas
  } finally {
    page.cleanup()
  }
}

// pdf.js im Browser, gemeinsam für den Druck der Belegkopien (pdfPreview.ts) und das Lesen
// eines PDFs vor dem Hochladen (pdfIntake.ts). pdf.js wird erst bei Bedarf geladen (~400 kB),
// damit der normale Seitenaufruf schlank bleibt.
import type { PDFDocumentProxy } from 'pdfjs-dist'

let geladen: Promise<typeof import('pdfjs-dist')> | null = null

function loadPdfjs() {
  geladen ??= import('pdfjs-dist').then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
    return pdfjs
  })
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

// Eine Seite auf ein Canvas rendern. Skalierung 2 entspricht etwa 150 dpi bei A4: gut lesbar,
// moderate Größe, für den Druck wie für das Vision-Modell.
export async function renderPage(doc: PDFDocumentProxy, n: number, scale = 2): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(n)
  try {
    const viewport = page.getViewport({ scale })
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

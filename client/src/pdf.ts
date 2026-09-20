// pdf.js im Browser, gemeinsam für den Druck der Belegkopien (pdfPreview.ts) und das Lesen
// eines PDFs vor dem Hochladen (pdfIntake.ts). pdf.js wird erst bei Bedarf geladen, damit der
// normale Seitenaufruf schlank bleibt.
//
// Bewusst die legacy-Fassung: Die moderne setzt die allerneuesten Browser voraus und scheitert
// schon an einem Browser vom Frühjahr 2025 („toHex is not a function“). Die legacy-Fassung
// bringt die fehlenden Funktionen selbst mit und läuft ab Chrome 125, Safari 18 und Firefox ESR.
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'

type Pdfjs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
let pdfjsPromise: Promise<Pdfjs> | null = null

function loadPdfjs(): Promise<Pdfjs> {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs').then(
    (pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString()
      return pdfjs
    },
    (err) => {
      // Nicht dauerhaft merken: Nach einem Update fehlt einem alten Tab der Teil unter dem
      // alten Namen. Der nächste Versuch soll es erneut probieren können.
      pdfjsPromise = null
      throw err
    },
  )
  return pdfjsPromise
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
// gerendert. Sonst wüchse das Canvas über die Grenzen mancher Browser (iOS Safari um 16 MP).
export const MAX_EDGE = 2500

// Für die KI-Auswertung (#35) deutlich kleiner: Jedes Bild kostet Eingabe-Token, und auf einem
// Rechner ohne Grafikkarte macht das Minuten aus. Der KI-Prüflauf hat vier Größen an denselben
// Belegen verglichen (qwen3.5:4b und gemma4:12b, je Text, Scan und Foto): Bis 1200 Bildpunkten
// bleibt die Trefferquote gleich, bei 1000 bricht sie bei beiden Modellen ein. Gegenüber den
// früheren 1684 Punkten spart 1200 rund 40 Prozent der Eingabe-Token.
export const INTAKE_EDGE = 1200

// Maßstab für eine Seite: Faktor 2, aber nie über die lange Kante hinaus.
export function pageScale(base: { width: number; height: number }, scale: number, maxEdge: number): number {
  return Math.min(scale, maxEdge / Math.max(base.width, base.height))
}

export async function renderPage(
  doc: PDFDocumentProxy,
  n: number,
  { scale = 2, maxEdge = MAX_EDGE }: { scale?: number; maxEdge?: number } = {},
): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(n)
  try {
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: pageScale(base, scale, maxEdge) })
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

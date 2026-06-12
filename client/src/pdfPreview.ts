// Rendert hochgeladene Belege (PDF oder Bild) als Bildseiten für den Druck.
// Browser drucken eingebettete PDFs nicht mit — daher werden die Seiten per
// pdf.js auf Canvas gerendert und als JPEG-Data-URLs in den Druck eingebettet.
// pdf.js wird erst bei Bedarf geladen (~400 kB), damit der normale Seitenaufruf schlank bleibt.
async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString()
  return pdfjs
}

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
  const pdfjs = await loadPdfjs()
  const task = pdfjs.getDocument({
    url,
    // Dekoder/Ressourcen, die Vite nach /pdfjs/ kopiert (siehe vite.config.ts):
    // ohne sie bleiben JBIG2-/JPEG2000-Scans (Behörden-Bescheide) fast leer.
    wasmUrl: '/pdfjs/wasm/',
    iccUrl: '/pdfjs/iccs/',
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
  })
  const doc = await task.promise
  const pages: string[] = []
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const viewport = page.getViewport({ scale: 2 }) // ~150 dpi bei A4 — gut lesbar, moderate Größe
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const canvasContext = canvas.getContext('2d')!
      await page.render({ canvas, canvasContext, viewport } as never).promise
      pages.push(canvas.toDataURL('image/jpeg', 0.85))
      page.cleanup()
    }
  } finally {
    void task.destroy()
  }
  return pages
}

// Lesbarer Anzeigename eines Uploads (ohne Timestamp-Präfix, Unterstriche geglättet)
export function invoiceLabel(file: string): string {
  return file.replace(/^\d+_/, '').replace(/__+/g, ' ').replace(/_/g, ' ')
}

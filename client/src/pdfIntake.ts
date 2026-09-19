// Ein Beleg für die KI-Auswertung vorbereiten (#21). PDFs liest der Browser selbst: Die
// Textebene geht als Feld `pdfText` mit, bei Scans ohne brauchbare Textebene zusätzlich die
// ersten Seiten als JPEG im Feld `pages`. Der Server öffnet keine PDFs mehr, deshalb braucht
// die Programmdatei kein natives Modul (server/src/extract.js).
import { openPdf, renderPage } from './pdf'

// Ab dieser Länge gilt die Textebene als brauchbar (dieselbe Schwelle wie im Server).
export const PDF_TEXT_MIN = 80
export const PDF_TEXT_MAX = 20000
// Rechnungen stehen praktisch immer vorn, und jedes Bild kostet Auswertungszeit.
export const MAX_PAGES = 4

export type PdfReader = {
  text(file: File): Promise<string>
  pages(file: File, max: number): Promise<Blob[]>
}

const alsJpeg = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((ok, fehler) =>
    canvas.toBlob((b) => (b ? ok(b) : fehler(new Error('Eine Seite ließ sich nicht als Bild speichern.'))), 'image/jpeg', 0.85),
  )

export const pdfReader: PdfReader = {
  async text(file) {
    const { doc, close } = await openPdf({ data: await file.arrayBuffer() })
    try {
      let text = ''
      for (let n = 1; n <= doc.numPages && text.length < PDF_TEXT_MAX; n++) {
        const page = await doc.getPage(n)
        const inhalt = await page.getTextContent()
        text += inhalt.items.map((i) => ('str' in i ? i.str + (i.hasEOL ? '\n' : ' ') : '')).join('') + '\n'
        page.cleanup()
      }
      return text
    } finally {
      close()
    }
  },
  async pages(file, max) {
    const { doc, close } = await openPdf({ data: await file.arrayBuffer() })
    try {
      const seiten: Blob[] = []
      for (let n = 1; n <= Math.min(doc.numPages, max); n++) seiten.push(await alsJpeg(await renderPage(doc, n)))
      return seiten
    } finally {
      close()
    }
  },
}

export async function buildUpload(file: File, reader: PdfReader = pdfReader): Promise<FormData> {
  const fd = new FormData()
  fd.append('file', file)
  if (file.type !== 'application/pdf') return fd

  let text = ''
  let seiten: Blob[] = []
  try {
    text = (await reader.text(file)).trim().slice(0, PDF_TEXT_MAX)
    if (text.length < PDF_TEXT_MIN) seiten = (await reader.pages(file, MAX_PAGES)).slice(0, MAX_PAGES)
  } catch (err) {
    throw new Error(`Das PDF ließ sich nicht öffnen: ${(err as Error).message}`)
  }
  if (text.length < PDF_TEXT_MIN && seiten.length === 0) throw new Error('Das PDF enthält keine Seiten.')

  if (text) fd.append('pdfText', text)
  seiten.forEach((s, i) => fd.append('pages', s, `seite-${i + 1}.jpg`))
  return fd
}

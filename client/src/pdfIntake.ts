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

// Ein geöffnetes PDF. Es wird nur einmal geöffnet, auch wenn Text und Seiten gebraucht werden.
export type OpenedPdf = {
  text(): Promise<string>
  pages(max: number): Promise<Blob[]>
  close(): void
}
export type PdfReader = { open(file: File): Promise<OpenedPdf> }

// Fehler, deren Text schon für Menschen formuliert ist
const readableError = (message: string) => Object.assign(new Error(message), { name: 'SeiteAlsBild' })

const toJpeg = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((ok, fail) =>
    canvas.toBlob((b) => (b ? ok(b) : fail(readableError('Eine Seite ließ sich nicht als Bild speichern.'))), 'image/jpeg', 0.85),
  )

// Textstücke einer Seite zu Fließtext: Zeilenenden bleiben, sonst ein Leerzeichen zwischen den
// Stücken, damit Spalten wie „Betrag“ und „12,50“ nicht zusammenkleben. pdf.js liefert daneben
// Markierungen ohne Text, die entfallen.
type TextPiece = { str: string; hasEOL?: boolean }
const isTextPiece = (i: unknown): i is TextPiece => typeof i === 'object' && i !== null && typeof (i as TextPiece).str === 'string'

export function pageText(items: ReadonlyArray<unknown>): string {
  return items.map((i) => (isTextPiece(i) ? i.str + (i.hasEOL ? '\n' : ' ') : '')).join('') + '\n'
}

export const pdfReader: PdfReader = {
  async open(file) {
    const { doc, close } = await openPdf({ data: await file.arrayBuffer() })
    return {
      async text() {
        let text = ''
        for (let n = 1; n <= doc.numPages && text.length < PDF_TEXT_MAX; n++) {
          const page = await doc.getPage(n)
          text += pageText((await page.getTextContent()).items)
          page.cleanup()
        }
        return text
      },
      async pages(max) {
        const pages: Blob[] = []
        for (let n = 1; n <= Math.min(doc.numPages, max); n++) pages.push(await toJpeg(await renderPage(doc, n)))
        return pages
      },
      close,
    }
  },
}

// pdf.js meldet auf Englisch und technisch. In der Warteschlange soll stehen, was los ist.
function messageFor(err: unknown): string {
  const { name, message } = err as Error
  if (name === 'PasswordException') return 'Das PDF ist mit einem Passwort geschützt. Bitte eine Fassung ohne Passwort hochladen.'
  if (name === 'InvalidPDFException') return 'Die Datei ist kein gültiges PDF oder beschädigt.'
  if (name === 'SeiteAlsBild') return message
  return `Das PDF ließ sich nicht lesen (${message ?? String(err)}).`
}

export async function buildUpload(file: File, reader: PdfReader = pdfReader): Promise<FormData> {
  const fd = new FormData()
  fd.append('file', file)
  if (file.type !== 'application/pdf') return fd

  let text = ''
  let pages: Blob[] = []
  let doc: OpenedPdf | undefined
  try {
    doc = await reader.open(file)
    text = (await doc.text()).trim().slice(0, PDF_TEXT_MAX)
    if (text.length < PDF_TEXT_MIN) pages = (await doc.pages(MAX_PAGES)).slice(0, MAX_PAGES)
  } catch (err) {
    throw new Error(messageFor(err))
  } finally {
    doc?.close()
  }
  if (text.length < PDF_TEXT_MIN && pages.length === 0) throw new Error('Das PDF enthält keine Seiten.')

  if (text) fd.append('pdfText', text)
  pages.forEach((s, i) => fd.append('pages', s, `seite-${i + 1}.jpg`))
  return fd
}

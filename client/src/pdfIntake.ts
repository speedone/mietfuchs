// Ein Beleg für die KI-Auswertung vorbereiten (#21). PDFs liest der Browser selbst: Die
// Textebene geht als Feld `pdfText` mit, bei Scans ohne brauchbare Textebene zusätzlich die
// ersten Seiten als JPEG im Feld `pages`. Der Server öffnet keine PDFs mehr, deshalb braucht
// die Programmdatei kein natives Modul (server/src/extract.ts).
import { INTAKE_EDGE, openPdf, renderPage } from './pdf'
import { isXmlFile } from './belegeView'

// Ab dieser Länge gilt die Textebene als brauchbar (dieselbe Schwelle wie im Server).
export const PDF_TEXT_MIN = 80
export const PDF_TEXT_MAX = 20000
// Rechnungen stehen praktisch immer vorn, und jedes Bild kostet Auswertungszeit.
export const MAX_PAGES = 4

// Ein geöffnetes PDF. Es wird nur einmal geöffnet, auch wenn Text und Seiten gebraucht werden.
// `pages` bekommt die lange Kante der Seitenbilder in Bildpunkten (#35).
export type OpenedPdf = {
  text(): Promise<string>
  // Das XML einer E-Rechnung im PDF (ZUGFeRD, Factur-X, #189), sonst `null`
  eInvoiceXml(): Promise<Blob | null>
  pages(max: number, edge: number): Promise<Blob[]>
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
      async eInvoiceXml() {
        const found = await eInvoiceFromAttachments(await doc.getAttachments(), (id) => doc.getAttachmentContent(id))
        return found === null ? null : new Blob([found.slice()], { type: 'application/xml' })
      },
      async pages(max, edge) {
        const pages: Blob[] = []
        // Kleiner als für den Druck: Das Modell braucht die Auflösung nicht, und jedes Bild
        // kostet Auswertungszeit (#35, siehe INTAKE_EDGE).
        for (let n = 1; n <= Math.min(doc.numPages, max); n++) pages.push(await toJpeg(await renderPage(doc, n, { maxEdge: edge })))
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

// ---------- E-Rechnung im PDF (#189) ----------

// Das XML einer E-Rechnung unter den Anhängen eines PDFs. Erkannt am Anfang des Inhalts (CII oder UBL), nicht am Namen;
// bei mehreren gilt die Reihenfolge der üblichen Namen, dann das Alphabet. Den Inhalt liefert pdf.js manchmal erst auf
// Nachfrage (`load`, `getAttachmentContent`). Größer als ein Beleg sein darf (25 MB), wird nie geschickt.
const E_INVOICE_NAMES = ['factur-x.xml', 'xrechnung.xml', 'zugferd-invoice.xml']
const E_INVOICE_MAX_BYTES = 25 * 1024 * 1024
const E_INVOICE_ROOT = /CrossIndustryInvoice|urn:oasis:names:specification:ubl:schema:xsd:(Invoice|CreditNote)-2/
type Attachment = { filename: string, content?: Uint8Array | null }

export async function eInvoiceFromAttachments(
  attachments: ReadonlyMap<string, Attachment> | null, load: (id: string) => Promise<Uint8Array | null>,
): Promise<Uint8Array | null> {
  if (!attachments) return null
  const rank = (name: string) => { const i = E_INVOICE_NAMES.indexOf(name.toLowerCase()); return i < 0 ? E_INVOICE_NAMES.length : i }
  const candidates = [...attachments].filter(([, a]) => /\.xml$/i.test(a.filename))
    .sort(([, a], [, b]) => rank(a.filename) - rank(b.filename) || (a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0))
  for (const [id, a] of candidates) {
    const content = a.content ?? await load(id)
    if (!content || content.length > E_INVOICE_MAX_BYTES) continue
    if (E_INVOICE_ROOT.test(new TextDecoder('latin1').decode(content.subarray(0, 4096)))) return content
  }
  return null
}

// Ist der Beleg eine E-Rechnung oder trägt das PDF eine? Für den Eingang ohne KI (#189): Solche Belege wertet der Server
// ohne KI aus. Eine XML-Datei wird am Anfang ihres Inhalts erkannt, ohne pdf.js.
export async function hasEInvoice(file: File, reader: PdfReader = pdfReader): Promise<boolean> {
  if (isXmlFile(file)) {
    try {
      return E_INVOICE_ROOT.test(new TextDecoder('latin1').decode(await file.slice(0, 4096).arrayBuffer()))
    } catch {
      return false
    }
  }
  if (file.type !== 'application/pdf') return false
  let doc: OpenedPdf | undefined
  try {
    doc = await reader.open(file)
    return (await doc.eInvoiceXml()) !== null
  } catch {
    return false
  } finally {
    doc?.close()
  }
}

export async function buildUpload(file: File, reader: PdfReader = pdfReader, pageEdge = INTAKE_EDGE): Promise<FormData> {
  const fd = new FormData()
  fd.append('file', file)
  if (file.type !== 'application/pdf') return fd

  let text = ''
  let xml: Blob | null = null
  let pages: Blob[] = []
  let doc: OpenedPdf | undefined
  try {
    doc = await reader.open(file)
    text = (await doc.text()).trim().slice(0, PDF_TEXT_MAX)
    // Ein PDF mit E-Rechnung (#189): Das XML liest der Server ohne KI. Ein Fehler beim Lesen der Anhänge ist nur
    // „keine E-Rechnung“, Text und Seitenbilder gehen wie bisher mit (der Server fällt bei Ablehnung auf die KI zurück).
    xml = await doc.eInvoiceXml().catch(() => null)
    if (text.length < PDF_TEXT_MIN) pages = (await doc.pages(MAX_PAGES, pageEdge)).slice(0, MAX_PAGES)
  } catch (err) {
    throw new Error(messageFor(err))
  } finally {
    doc?.close()
  }
  if (text.length < PDF_TEXT_MIN && pages.length === 0) throw new Error('Das PDF enthält keine Seiten.')

  if (xml) fd.append('eInvoiceXml', xml, 'e-rechnung.xml')
  if (text) fd.append('pdfText', text)
  pages.forEach((s, i) => fd.append('pages', s, `seite-${i + 1}.jpg`))
  return fd
}

// Die Textschicht eines gespeicherten Belegs, ohne KI (#487, Entscheidung 3B): Die Seite Kosten liest daraus nur ein
// Rechnungsdatum als Vorschlag (invoiceDateFromText). Die ersten Seiten genügen, das Datum steht im Kopf. Ein Bild hat
// keine Textschicht; was sich nicht lesen lässt, ergibt keinen Text und damit keinen Vorschlag.
export const RECEIPT_TEXT_PAGES = 2
export async function receiptText(file: string, mimeType: string): Promise<string> {
  if (mimeType !== 'application/pdf' && !/\.pdf$/i.test(file)) return ''
  const { doc, close } = await openPdf({ url: `/uploads/${encodeURIComponent(file)}` })
  try {
    let text = ''
    for (let n = 1; n <= Math.min(doc.numPages, RECEIPT_TEXT_PAGES); n++) {
      const page = await doc.getPage(n)
      text += pageText((await page.getTextContent()).items)
      page.cleanup()
    }
    return text
  } finally {
    close()
  }
}

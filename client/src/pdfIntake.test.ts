// Was der Browser vor dem Hochladen aus einem Beleg macht (#21). pdf.js ersetzt hier ein
// Leser mit festen Antworten; das echte Lesen und Rendern prüft der Durchlauf im Browser.
import { describe, expect, test, vi } from 'vitest'
import { buildUpload, eInvoiceFromAttachments, hasEInvoice, MAX_PAGES, PDF_TEXT_MAX, PDF_TEXT_MIN, type OpenedPdf, type PdfReader } from './pdfIntake'
import { INTAKE_EDGE } from './pdf'

const pdf = () => new File(['%PDF-1.4'], 'rechnung.pdf', { type: 'application/pdf' })
const photo = () => new File(['JPEG'], 'foto.jpg', { type: 'image/jpeg' })

function fakeReader(text: string, pageCount = 1, xml: string | null = null) {
  const doc: OpenedPdf = {
    text: vi.fn(async () => text),
    eInvoiceXml: vi.fn(async () => (xml === null ? null : new Blob([xml], { type: 'application/xml' }))),
    pages: vi.fn(async (max: number) =>
      Array.from({ length: Math.min(pageCount, max) }, (_, i) => new Blob([`Seite ${i + 1}`], { type: 'image/jpeg' })),
    ),
    close: vi.fn(),
  }
  const reader: PdfReader = { open: vi.fn(async () => doc) }
  return { reader, doc }
}

// Ein Leser, dessen PDF beim Öffnen oder Lesen mit einem bestimmten pdf.js-Fehler scheitert
function failingReader(name: string, message: string, failAt: 'open' | 'text' | 'pages' = 'open') {
  const error = Object.assign(new Error(message), { name })
  const doc: OpenedPdf = {
    text: vi.fn(async () => { if (failAt === 'text') throw error; return '' }),
    eInvoiceXml: vi.fn(async () => null),
    pages: vi.fn(async () => { throw error }),
    close: vi.fn(),
  }
  const reader: PdfReader = { open: vi.fn(async () => { if (failAt === 'open') throw error; return doc }) }
  return { reader, doc }
}

const fieldNames = (fd: FormData) => [...new Set([...fd.keys()])].sort()

describe('Beleg vor dem Hochladen vorbereiten', () => {
  test('ein Foto geht unverändert hoch, pdf.js wird nicht bemüht', async () => {
    const { reader } = fakeReader('egal')
    const fd = await buildUpload(photo(), reader)
    expect(fieldNames(fd)).toEqual(['file'])
    expect(reader.open).not.toHaveBeenCalled()
  })

  test('PDF mit Textebene: der Text geht mit, gerendert wird nichts', async () => {
    const text = 'Stadtwerke Musterstadt, Frischwasser 12,50 EUR. '.repeat(3)
    const { reader, doc } = fakeReader(text, 3)
    const fd = await buildUpload(pdf(), reader)
    expect(fieldNames(fd)).toEqual(['file', 'pdfText'])
    expect(fd.get('pdfText')).toBe(text.trim())
    expect(doc.pages).not.toHaveBeenCalled()
  })

  test('die eingestellte Größe der Seitenbilder wird durchgereicht (#35)', async () => {
    // Unter „Erweitert“ oder per NKA_AI_IMAGE_EDGE lässt sich die lange Kante ändern. Ohne
    // Angabe gilt der gemessene Standard.
    const { reader, doc } = fakeReader('kurz', 1)
    await buildUpload(pdf(), reader, 900)
    expect(doc.pages).toHaveBeenCalledWith(MAX_PAGES, 900)
    const ohneAngabe = fakeReader('kurz', 1)
    await buildUpload(pdf(), ohneAngabe.reader)
    expect(ohneAngabe.doc.pages).toHaveBeenCalledWith(MAX_PAGES, INTAKE_EDGE)
  })

  test('Scan: höchstens vier Seiten gehen als Bilder mit, das PDF wird nur einmal geöffnet', async () => {
    // Rechnungen stehen praktisch immer vorn, und jedes Bild kostet Auswertungszeit.
    const { reader, doc } = fakeReader('Seite 1', 6)
    const fd = await buildUpload(pdf(), reader)
    expect(reader.open).toHaveBeenCalledTimes(1)
    expect(doc.pages).toHaveBeenCalledWith(MAX_PAGES, INTAKE_EDGE)
    const pages = fd.getAll('pages') as File[]
    expect(pages).toHaveLength(4)
    expect(pages.map((s) => s.name)).toEqual(['seite-1.jpg', 'seite-2.jpg', 'seite-3.jpg', 'seite-4.jpg'])
    expect(pages.every((s) => s.type === 'image/jpeg')).toBe(true)
    expect(fd.get('pdfText')).toBe('Seite 1') // der kurze Text schadet nicht
    expect(doc.close).toHaveBeenCalledTimes(1)
  })

  test('die Schwelle für brauchbaren Text liegt bei genau 80 Zeichen, ohne Leerraum', async () => {
    expect(PDF_TEXT_MIN).toBe(80)
    const enough = await buildUpload(pdf(), fakeReader(`  ${'x'.repeat(80)}  `, 2).reader)
    expect(enough.getAll('pages')).toHaveLength(0)
    const tooShort = await buildUpload(pdf(), fakeReader('x'.repeat(79), 2).reader)
    expect(tooShort.getAll('pages')).toHaveLength(2)
  })

  test('sehr langer Text wird gekürzt, bevor er hochgeht', async () => {
    const fd = await buildUpload(pdf(), fakeReader('a'.repeat(PDF_TEXT_MAX + 5000)).reader)
    expect((fd.get('pdfText') as string).length).toBe(PDF_TEXT_MAX)
  })

  test('ein PDF ohne Seiten wird gemeldet statt leer hochgeschickt', async () => {
    await expect(buildUpload(pdf(), fakeReader('', 0).reader)).rejects.toThrow('Das PDF enthält keine Seiten.')
  })
})

describe('Meldungen, wenn ein PDF nicht lesbar ist', () => {
  test('passwortgeschützt', async () => {
    await expect(buildUpload(pdf(), failingReader('PasswordException', 'No password given').reader)).rejects.toThrow(
      'Das PDF ist mit einem Passwort geschützt. Bitte eine Fassung ohne Passwort hochladen.',
    )
  })

  test('beschädigt oder gar kein PDF', async () => {
    await expect(buildUpload(pdf(), failingReader('InvalidPDFException', 'Invalid PDF structure.').reader)).rejects.toThrow(
      'Die Datei ist kein gültiges PDF oder beschädigt.',
    )
  })

  test('eine Seite lässt sich nicht als Bild speichern', async () => {
    const { reader, doc } = failingReader('SeiteAlsBild', 'Eine Seite ließ sich nicht als Bild speichern.', 'pages')
    await expect(buildUpload(pdf(), reader)).rejects.toThrow(/^Eine Seite ließ sich nicht als Bild speichern\.$/)
    expect(doc.close).toHaveBeenCalledTimes(1) // auch im Fehlerfall wieder freigegeben
  })

  test('sonstige Fehler nennen den Grund', async () => {
    const { reader, doc } = failingReader('UnknownErrorException', 'Worker was destroyed', 'text')
    await expect(buildUpload(pdf(), reader)).rejects.toThrow('Das PDF ließ sich nicht lesen (Worker was destroyed).')
    expect(doc.close).toHaveBeenCalledTimes(1)
  })
})

// ---------- E-Rechnung im PDF (#189) ----------

const CII = '<?xml version="1.0"?><rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"/>'
const UBL = '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/>'
const bytes = (s: string) => new TextEncoder().encode(s)
const attachments = (files: Record<string, string>) => new Map(Object.entries(files).map(([name, content]) => [name, { filename: name, content: bytes(content) }]))
const loadNever = async (): Promise<Uint8Array | null> => { throw new Error('nicht nachladen') }
const text = (b: Uint8Array | null) => (b === null ? null : new TextDecoder().decode(b))

describe('E-Rechnung im PDF finden', () => {
  test('nimmt das XML einer E-Rechnung, gleich unter welchem Namen', async () => {
    expect(text(await eInvoiceFromAttachments(attachments({ 'factur-x.xml': CII }), loadNever))).toBe(CII)
    expect(text(await eInvoiceFromAttachments(attachments({ 'beliebig.XML': UBL }), loadNever))).toBe(UBL)
  })

  test('übergeht andere Anhänge und anderes XML', async () => {
    expect(await eInvoiceFromAttachments(attachments({ 'notiz.xml': '<notiz/>', 'bild.png': CII }), loadNever)).toBeNull()
    expect(await eInvoiceFromAttachments(null, loadNever)).toBeNull()
  })

  test('bei mehreren gilt factur-x.xml vor den übrigen', async () => {
    const found = await eInvoiceFromAttachments(attachments({ 'a.xml': UBL, 'factur-x.xml': CII }), loadNever)
    expect(text(found)).toBe(CII)
  })

  test('lädt den Inhalt nach, wenn pdf.js ihn nicht mitliefert', async () => {
    const load = vi.fn(async (id: string) => (id === 'zugferd-invoice.xml' ? bytes(CII) : null))
    const found = await eInvoiceFromAttachments(new Map([['zugferd-invoice.xml', { filename: 'zugferd-invoice.xml' }]]), load)
    expect(text(found)).toBe(CII)
    expect(load).toHaveBeenCalledWith('zugferd-invoice.xml')
  })

  test('schickt das XML als Feld eInvoiceXml mit, Text und Seiten wie bisher', async () => {
    const { reader } = fakeReader('x'.repeat(PDF_TEXT_MIN), 1, CII)
    const fd = await buildUpload(pdf(), reader)
    expect(fieldNames(fd)).toEqual(['eInvoiceXml', 'file', 'pdfText'])
    const xml = fd.get('eInvoiceXml')
    expect(xml instanceof Blob ? await xml.text() : null).toBe(CII)
  })

  test('ohne E-Rechnung kein Feld, und ein Fehler beim Lesen der Anhänge hält das Hochladen nicht auf', async () => {
    expect(fieldNames(await buildUpload(pdf(), fakeReader('x'.repeat(PDF_TEXT_MIN)).reader))).toEqual(['file', 'pdfText'])
    const { reader, doc } = fakeReader('x'.repeat(PDF_TEXT_MIN))
    doc.eInvoiceXml = vi.fn(async () => { throw new Error('kaputt') })
    expect(fieldNames(await buildUpload(pdf(), reader))).toEqual(['file', 'pdfText'])
  })

  test('hasEInvoice: nur ein PDF mit E-Rechnung', async () => {
    expect(await hasEInvoice(pdf(), fakeReader('x', 1, CII).reader)).toBe(true)
    expect(await hasEInvoice(pdf(), fakeReader('x').reader)).toBe(false)
    expect(await hasEInvoice(photo(), fakeReader('x', 1, CII).reader)).toBe(false)
  })

  test('hasEInvoice: eine XML-Datei am Anfang ihres Inhalts, ohne pdf.js; buildUpload schickt nur die Datei', async () => {
    const { reader } = fakeReader('x', 1, CII)
    expect(await hasEInvoice(new File([CII], 'xrechnung.xml', { type: 'text/xml' }), reader)).toBe(true)
    expect(await hasEInvoice(new File([CII], 'RECHNUNG.XML', { type: '' }), reader)).toBe(true)
    expect(await hasEInvoice(new File(['<notiz/>'], 'daten.xml', { type: 'application/xml' }), reader)).toBe(false)
    expect(reader.open).not.toHaveBeenCalled()
    expect(fieldNames(await buildUpload(new File([CII], 'xrechnung.xml', { type: 'application/xml' }), reader))).toEqual(['file'])
  })
})

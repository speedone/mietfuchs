// Was der Browser vor dem Hochladen aus einem Beleg macht (#21). pdf.js ersetzt hier ein
// Leser mit festen Antworten; das echte Lesen und Rendern prüft der Durchlauf im Browser.
import { describe, expect, test, vi } from 'vitest'
import { buildUpload, MAX_PAGES, PDF_TEXT_MAX, PDF_TEXT_MIN, type OpenedPdf, type PdfReader } from './pdfIntake'

const pdf = () => new File(['%PDF-1.4'], 'rechnung.pdf', { type: 'application/pdf' })
const photo = () => new File(['JPEG'], 'foto.jpg', { type: 'image/jpeg' })

function fakeReader(text: string, pageCount = 1) {
  const doc: OpenedPdf = {
    text: vi.fn(async () => text),
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

  test('Scan: höchstens vier Seiten gehen als Bilder mit, das PDF wird nur einmal geöffnet', async () => {
    // Rechnungen stehen praktisch immer vorn, und jedes Bild kostet Auswertungszeit.
    const { reader, doc } = fakeReader('Seite 1', 6)
    const fd = await buildUpload(pdf(), reader)
    expect(reader.open).toHaveBeenCalledTimes(1)
    expect(doc.pages).toHaveBeenCalledWith(MAX_PAGES)
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

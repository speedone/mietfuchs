// Was der Browser vor dem Hochladen aus einem Beleg macht (#21). pdf.js ersetzt hier ein
// Leser mit festen Antworten; das echte Lesen und Rendern prüft der Durchlauf im Browser.
import { describe, expect, test, vi } from 'vitest'
import { buildUpload, MAX_PAGES, PDF_TEXT_MAX, PDF_TEXT_MIN, type PdfReader } from './pdfIntake'

const pdf = () => new File(['%PDF-1.4'], 'rechnung.pdf', { type: 'application/pdf' })
const foto = () => new File(['JPEG'], 'foto.jpg', { type: 'image/jpeg' })

function leser(text: string, seitenImPdf = 1) {
  const reader: PdfReader = {
    text: vi.fn(async () => text),
    pages: vi.fn(async (_file: File, max: number) =>
      Array.from({ length: Math.min(seitenImPdf, max) }, (_, i) => new Blob([`Seite ${i + 1}`], { type: 'image/jpeg' })),
    ),
  }
  return reader
}

const felder = (fd: FormData) => [...new Set([...fd.keys()])].sort()

describe('Beleg vor dem Hochladen vorbereiten', () => {
  test('ein Foto geht unverändert hoch, pdf.js wird nicht bemüht', async () => {
    const reader = leser('egal')
    const fd = await buildUpload(foto(), reader)
    expect(felder(fd)).toEqual(['file'])
    expect(reader.text).not.toHaveBeenCalled()
    expect(reader.pages).not.toHaveBeenCalled()
  })

  test('PDF mit Textebene: der Text geht mit, gerendert wird nichts', async () => {
    const text = 'Stadtwerke Musterstadt, Frischwasser 12,50 EUR. '.repeat(3)
    const reader = leser(text, 3)
    const fd = await buildUpload(pdf(), reader)
    expect(felder(fd)).toEqual(['file', 'pdfText'])
    expect(fd.get('pdfText')).toBe(text.trim())
    expect(reader.pages).not.toHaveBeenCalled()
  })

  test('Scan: höchstens vier Seiten gehen als Bilder mit', async () => {
    // Rechnungen stehen praktisch immer vorn, und jedes Bild kostet Auswertungszeit.
    const reader = leser('Seite 1', 6)
    const fd = await buildUpload(pdf(), reader)
    expect(reader.pages).toHaveBeenCalledWith(expect.any(File), MAX_PAGES)
    const seiten = fd.getAll('pages') as File[]
    expect(seiten).toHaveLength(4)
    expect(seiten.map((s) => s.name)).toEqual(['seite-1.jpg', 'seite-2.jpg', 'seite-3.jpg', 'seite-4.jpg'])
    expect(seiten.every((s) => s.type === 'image/jpeg')).toBe(true)
    expect(fd.get('pdfText')).toBe('Seite 1') // der kurze Text schadet nicht
  })

  test('die Schwelle für brauchbaren Text liegt bei genau 80 Zeichen, ohne Leerraum', async () => {
    expect(PDF_TEXT_MIN).toBe(80)
    const genug = await buildUpload(pdf(), leser(`  ${'x'.repeat(80)}  `, 2))
    expect(genug.getAll('pages')).toHaveLength(0)
    const zuWenig = await buildUpload(pdf(), leser('x'.repeat(79), 2))
    expect(zuWenig.getAll('pages')).toHaveLength(2)
  })

  test('sehr langer Text wird gekürzt, bevor er hochgeht', async () => {
    const fd = await buildUpload(pdf(), leser('a'.repeat(PDF_TEXT_MAX + 5000)))
    expect((fd.get('pdfText') as string).length).toBe(PDF_TEXT_MAX)
  })

  test('ein kaputtes PDF ergibt eine verständliche Meldung', async () => {
    const reader: PdfReader = {
      text: async () => { throw new Error('Invalid PDF structure.') },
      pages: async () => [],
    }
    await expect(buildUpload(pdf(), reader)).rejects.toThrow('Das PDF ließ sich nicht öffnen: Invalid PDF structure.')
  })

  test('ein PDF ohne Seiten wird gemeldet statt leer hochgeschickt', async () => {
    await expect(buildUpload(pdf(), leser('', 0))).rejects.toThrow('Das PDF enthält keine Seiten.')
  })
})

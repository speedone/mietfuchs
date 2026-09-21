// Echtes pdf.js statt Leser mit festen Antworten: Liest ein im Test erzeugtes Text-PDF mit
// derselben legacy-Fassung, die die Oberfläche lädt (pdf.ts). Die CI läuft mindestens mit
// Node 24.15, dessen JavaScript-Engine älter ist als aktuelle Browser. Käme wieder die
// moderne Fassung zum Einsatz, die nur die allerneuesten Browser kennt, fiele das hier auf.
import { describe, expect, test } from 'vitest'
import { getDocument, VerbosityLevel } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { pageText } from './pdfIntake'

// Für die Textebene braucht pdf.js keine Schriftdateien. Die Warnung, dass sie fehlen, bleibt
// deshalb stumm.
const openDocument = (data: Uint8Array) => getDocument({ data, verbosity: VerbosityLevel.ERRORS })

// Minimales PDF mit einer Seite und zwei Textzeilen in der Standardschrift Helvetica
function textPdf(lines: string[]): Uint8Array {
  const content = lines.map((z, i) => `BT /F1 12 Tf 72 ${720 - i * 20} Td (${z}) Tj ET`).join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((o, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(pdf)
}

describe('Textebene mit echtem pdf.js (legacy-Fassung)', () => {
  test('liest den Text eines PDFs, Zeilen und Stücke bleiben getrennt', async () => {
    const task = openDocument(textPdf(['Abfallgebuehren 2025', 'Restmuell 42,50 EUR']))
    try {
      const page = await (await task.promise).getPage(1)
      const text = pageText((await page.getTextContent()).items)
      expect(text).toContain('Abfallgebuehren 2025')
      expect(text).toContain('Restmuell 42,50 EUR')
      expect(text).not.toContain('2025Restmuell') // die Zeilen kleben nicht aneinander
    } finally {
      await task.destroy()
    }
  })

  test('ein beschädigtes PDF meldet pdf.js als InvalidPDFException', async () => {
    // Auf diesen Namen stützt sich die deutsche Meldung in pdfIntake.ts
    const task = openDocument(new TextEncoder().encode('%PDF-1.4\nkaputt\n'))
    await expect(task.promise).rejects.toMatchObject({ name: 'InvalidPDFException' })
    await task.destroy()
  })
})

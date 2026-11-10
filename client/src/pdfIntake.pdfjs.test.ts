// Echtes pdf.js statt Leser mit festen Antworten: Liest ein im Test erzeugtes Text-PDF mit
// derselben legacy-Fassung, die die Oberfläche lädt (pdf.ts). Die CI läuft mindestens mit
// Node 24.15, dessen JavaScript-Engine älter ist als aktuelle Browser. Käme wieder die
// moderne Fassung zum Einsatz, die nur die allerneuesten Browser kennt, fiele das hier auf.
import { describe, expect, test } from 'vitest'
import { getDocument, VerbosityLevel } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { eInvoiceFromAttachments, pageText } from './pdfIntake'
import { invoiceDateFromText } from './invoiceDateText'

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

  // #487, 3B: Aus der Textebene, wie pdf.js sie liefert, liest Mietfuchs ohne KI das Rechnungsdatum (nie einen Betrag)
  test('das Rechnungsdatum aus der Textebene', async () => {
    const task = openDocument(textPdf(['Stadtwerke', 'Leistungszeitraum 01.01.2024 bis 31.12.2024', 'Rechnungsdatum: 14.02.2025', 'Betrag 480,00 EUR']))
    try {
      const page = await (await task.promise).getPage(1)
      expect(invoiceDateFromText(pageText((await page.getTextContent()).items))).toBe('2025-02-14')
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

// #189: Das XML einer E-Rechnung im PDF findet das echte pdf.js (getAttachments, getAttachmentContent). Das PDF baut
// pdf-lib wie ein Erzeuger von ZUGFeRD: Anhang im Namensbaum EmbeddedFiles und in /AF mit AFRelationship.
describe('E-Rechnung im PDF mit echtem pdf.js', () => {
  const CII = '<?xml version="1.0" encoding="UTF-8"?><rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"><rsm:ExchangedDocument/></rsm:CrossIndustryInvoice>'

  async function pdfWith(files: Record<string, string>): Promise<Uint8Array> {
    const { AFRelationship, PDFDocument } = await import('pdf-lib')
    const doc = await PDFDocument.create()
    doc.addPage([595, 842])
    for (const [name, content] of Object.entries(files)) {
      await doc.attach(new TextEncoder().encode(content), name, { mimeType: 'application/xml', afRelationship: AFRelationship.Alternative })
    }
    return doc.save()
  }

  test('findet factur-x.xml und liefert den Inhalt byte-gleich', async () => {
    const task = openDocument(await pdfWith({ 'factur-x.xml': CII }))
    try {
      const doc = await task.promise
      const found = await eInvoiceFromAttachments(await doc.getAttachments(), (id) => doc.getAttachmentContent(id))
      expect(found === null ? null : new TextDecoder().decode(found)).toBe(CII)
    } finally {
      await task.destroy()
    }
  })

  test('ein PDF ohne Anhang und eines mit fremdem XML ergeben keine E-Rechnung', async () => {
    const cases: Record<string, string>[] = [{}, { 'notiz.xml': '<notiz/>' }]
    for (const files of cases) {
      const task = openDocument(await pdfWith(files))
      try {
        const doc = await task.promise
        expect(await eInvoiceFromAttachments(await doc.getAttachments(), (id) => doc.getAttachmentContent(id))).toBeNull()
      } finally {
        await task.destroy()
      }
    }
  })
})

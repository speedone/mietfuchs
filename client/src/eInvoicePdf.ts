// Seiten für eine E-Rechnung als XML-Datei (#189, PR 3). Vorschaubild, Belegkopien der Abrechnung und Belegmappe
// brauchen Seiten; eine XML-Datei hat keine. Gesetzt wird die Rechnungsansicht (eInvoiceView.ts) als einfaches A4-PDF
// mit pdf-lib, in der Standardschrift (nur WinAnsi, `winAnsiSafe`). Danach geht es den Weg eines PDF-Belegs.
// Die Datei selbst bleibt der Beleg; jede Seite sagt das in der Fußzeile.
import type { PDFFont, PDFPage } from 'pdf-lib'
import { api } from './api'
import type { EInvoiceView } from './types'
import { eInvoiceDocument } from './eInvoiceView'
import { winAnsiSafe } from './tenantFolder'

const A4: [number, number] = [595.28, 841.89]
const MARGIN = 50
const SIZE = 9
const LINE = 12.5
const WIDTH = A4[0] - 2 * MARGIN
const FOOTER = 'Lesbare Darstellung einer E-Rechnung (XML) durch Mietfuchs. Maßgeblich ist die XML-Datei.'

// Spalten der Positionen: Nr., Bezeichnung, Menge, Einzelpreis, USt, Netto (Beträge rechtsbündig)
const COLS = [{ w: 30 }, { w: 205 }, { w: 60, right: true }, { w: 65, right: true }, { w: 60 }, { w: 75, right: true }]

// Zerlegt einen Text in Zeilen, die in die Breite passen; ein Wort länger als die Zeile wird hart geteilt.
export function wrapText(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = []
  for (const paragraph of winAnsiSafe(text).split('\n')) {
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let w = word
      while (font.widthOfTextAtSize(w, size) > width && w.length > 1) {
        let cut = w.length - 1
        while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > width) cut--
        if (line) { lines.push(line); line = '' }
        lines.push(w.slice(0, cut))
        w = w.slice(cut)
      }
      const next = line ? `${line} ${w}` : w
      if (font.widthOfTextAtSize(next, size) <= width) line = next
      else { lines.push(line); line = w }
    }
    lines.push(line)
  }
  return lines
}

export async function eInvoicePdf(view: EInvoiceView): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const d = eInvoiceDocument(view)
  const out = await PDFDocument.create()
  out.setTitle(winAnsiSafe(d.title))
  out.setCreator('Mietfuchs')
  const regular = await out.embedFont(StandardFonts.Helvetica)
  const bold = await out.embedFont(StandardFonts.HelveticaBold)
  const grey = rgb(0.35, 0.35, 0.35)

  let page: PDFPage = out.addPage(A4)
  let y = A4[1] - MARGIN
  const room = (h: number) => {
    if (y - h >= MARGIN + 20) return
    page = out.addPage(A4)
    y = A4[1] - MARGIN
  }
  const text = (t: string, x: number, opts: { font?: PDFFont; size?: number; right?: number; color?: ReturnType<typeof rgb> } = {}) => {
    const font = opts.font ?? regular
    const size = opts.size ?? SIZE
    const s = winAnsiSafe(t)
    const at = opts.right === undefined ? x : x + opts.right - font.widthOfTextAtSize(s, size)
    page.drawText(s, { x: at, y, size, font, color: opts.color })
  }
  const paragraph = (t: string, opts: { font?: PDFFont; color?: ReturnType<typeof rgb> } = {}) => {
    for (const l of wrapText(t, opts.font ?? regular, SIZE, WIDTH)) { room(LINE); text(l, MARGIN, opts); y -= LINE }
  }
  const heading = (t: string) => { y -= 6; room(LINE * 3); text(t, MARGIN, { font: bold, size: 11 }); y -= LINE + 2 }
  const pairs = (rows: [string, string][]) => {
    for (const [label, value] of rows) {
      const lines = wrapText(value, regular, SIZE, WIDTH - 150)
      room(LINE * lines.length)
      text(label, MARGIN, { color: grey })
      for (const l of lines) { text(l, MARGIN + 150); y -= LINE }
    }
  }
  // Eine Zeile einer Tabelle; jede Zelle umbricht für sich, die Zeile ist so hoch wie ihre längste Zelle
  const row = (cells: string[], cols: { w: number; right?: boolean }[], font = regular) => {
    const wrapped = cells.map((c, i) => wrapText(c, font, SIZE, cols[i].w - 6))
    const height = Math.max(...wrapped.map((w) => w.length))
    room(LINE * height)
    let x = MARGIN
    wrapped.forEach((lines, i) => {
      lines.forEach((l, n) => page.drawText(l, {
        x: cols[i].right ? x + cols[i].w - 6 - font.widthOfTextAtSize(l, SIZE) : x, y: y - n * LINE, size: SIZE, font,
      }))
      x += cols[i].w
    })
    y -= LINE * height
  }

  text(d.title, MARGIN, { font: bold, size: 16 })
  y -= 26
  if (d.refusal) paragraph(`Wird nicht in die Kosten übernommen: ${d.refusal}`, { font: bold })
  for (const n of d.notes) paragraph(`Hinweis: ${n}`)
  if (d.unreadable.length > 0) paragraph(`Nicht lesbare Angaben: ${d.unreadable.join(', ')}.`)

  heading('Rechnung')
  pairs(d.facts)
  for (const p of d.parties) {
    heading(p.role)
    paragraph(p.name || 'ohne Namen', { font: bold })
    for (const l of p.lines) paragraph(l)
  }
  heading('Positionen')
  row(['Nr.', 'Bezeichnung', 'Menge', 'Einzelpreis', 'USt', 'Netto'], COLS, bold)
  for (const p of d.positions) {
    const name = p.description && p.description !== p.name ? `${p.name}\n${p.description}` : p.name
    row([p.nr, name, p.quantity, p.unitPrice, p.vat, p.net], COLS)
  }
  if (d.charges.length > 0) {
    heading('Zu- und Abschläge')
    const cols = [{ w: 70 }, { w: 255 }, { w: 95 }, { w: 75, right: true }]
    row(['Art', 'Grund', 'USt', 'Betrag (netto)'], cols, bold)
    for (const c of d.charges) row([c.kind, c.reason, c.vat, c.amount], cols)
  }
  heading('Umsatzsteuer')
  const vatCols = [{ w: 250 }, { w: 120, right: true }, { w: 125, right: true }]
  row(['Satz', 'Grundlage', 'Steuer'], vatCols, bold)
  for (const v of d.vat) row([v.label, v.basis, v.tax], vatCols)
  heading('Summen')
  pairs(d.totals)
  if (d.payment.length > 0) {
    heading('Zahlung')
    pairs(d.payment)
  }

  const total = out.getPageCount()
  out.getPages().forEach((p, i) => {
    p.drawText(winAnsiSafe(FOOTER), { x: MARGIN, y: 28, size: 7.5, font: regular, color: grey })
    p.drawText(`Seite ${i + 1} von ${total}`, { x: A4[0] - MARGIN - 50, y: 28, size: 7.5, font: regular, color: grey })
  })
  return out.save()
}

// Das PDF zu einem gespeicherten Beleg: die Ansicht vom Server, gesetzt im Browser.
export async function eInvoicePdfOf(file: string, load: (file: string) => Promise<EInvoiceView> = (f) => api<EInvoiceView>(`/api/e-invoice/${encodeURIComponent(f)}`)): Promise<Uint8Array> {
  return eInvoicePdf(await load(file))
}

export { isXmlReceipt } from './eInvoiceXml'

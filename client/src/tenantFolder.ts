// „Belegmappe für Mieter“ (#170): eine PDF je Objekt und Jahr mit den Belegen der umgelegten
// Positionen, in der Reihenfolge der Abrechnung, mit einem Deckblatt „Position → Beleg, Seite“.
//
// Seit 01.01.2025 darf der Vermieter die Belege elektronisch bereitstellen (§ 556 Abs. 4 BGB in
// der Fassung des Vierten Bürokratieentlastungsgesetzes); diese Mappe ist genau das. Was
// hineingehört und was nur auf ausdrückliche Wahl, steht mit Quellen in
// docs/superpowers/specs/2026-10-02-belegordner-design.md.
//
// Erzeugt wird im Browser mit pdf-lib (reines JavaScript, kein natives Modul, wichtig für die
// Programmdateien, #21). Ein PDF, das pdf-lib nicht kopieren kann (verschlüsselt, beschädigt),
// kommt als gerenderte Seitenbilder hinein; dafür ist pdf.js ohnehin eingebunden.
// pdf-lib wird erst geladen, wenn jemand eine Mappe erzeugt; es ist größer als der Rest der Seite.
import type { PDFDocument, PDFFont, PDFPage } from 'pdf-lib'
import type { CostItem, Settlement, UploadInfo } from './types'
import { isNotAllocable } from './types'
import { fmtEuro } from './api'
import type { ReceiptUpload } from './receipts'

export type FolderEntryStatus =
  | 'ok' // Beleg liegt bei
  | 'none' // die Position hat keinen Beleg
  | 'missing' // verknüpft, aber die Datei fehlt im Belegordner
  | 'excluded' // Einzelbeträge anderer Mieter, nicht gewählt

export type FolderEntry = { item: CostItem; status: FolderEntryStatus; upload: UploadInfo | null }
export type FolderDocument = { upload: UploadInfo; itemIds: string[] }
export type TenantFolderPlan = { entries: FolderEntry[]; documents: FolderDocument[] }

// **Einzelbeträge je Mieter** (Schlüssel `amounts`) stammen meist aus der Abrechnung eines
// Messdienstes. Deren Beleg führt die Beträge und Verbrauchswerte jeder Wohnung, oft mit Namen.
// Das Einsichtsrecht reicht nach BGH (Urteil vom 07.02.2018, VIII ZR 189/17, Pressemitteilung
// 25/2018) bis zu den Einzelverbrauchsdaten der anderen Nutzer, und ein besonderes Interesse muss
// der Mieter dafür nicht darlegen. Es ist aber ein Recht **auf Verlangen** (§ 556 Abs. 4 Satz 1
// BGB): Eine Mappe, die jedem Mieter unaufgefordert die Daten aller anderen mitgibt, geht darüber
// hinaus, und die Datenschutz-Grundverordnung verlangt, nicht mehr personenbezogene Daten
// weiterzugeben als nötig (Art. 5 Abs. 1 lit. c, Datenminimierung). Deshalb nur auf ausdrückliche
// Wahl; Begründung im Design-Text.
//
// Dasselbe gilt, solange es keine Mappe je Mieter gibt, für jeden Beleg, der nur einen Teil der
// Mieter betrifft: eine **Direktzuordnung** (die Reparatur in einer Wohnung, oft mit dem Namen des
// Mieters auf der Rechnung) und eine Position mit **Teilnehmern** (#94). Die Mappe geht an jeden
// Mieter des Objekts, auch an die, die mit diesen Kosten nichts zu tun haben (Durchsicht).
export const isIndividualAmounts = (c: CostItem): boolean =>
  c.key === 'amounts' || c.key === 'direct' || (Array.isArray(c.participantUnitIds) && c.participantUnitIds.length > 0)

export function planTenantFolder(
  settlement: Settlement,
  items: CostItem[],
  uploads: ReceiptUpload[],
  { includeIndividual }: { includeIndividual: boolean },
): TenantFolderPlan {
  // Reihenfolge der Abrechnung: wie die Zeilen der Mieter stehen, über alle Mieter vereinigt.
  // Nur, was dort steht, ist umgelegt; der Vermieteranteil und nicht Umlagefähiges gehören in
  // die Mappe für die Steuer, nicht in diese.
  const order: string[] = []
  for (const st of settlement.statements) for (const r of st.rows) if (!order.includes(r.costItemId)) order.push(r.costItemId)
  const byId = new Map(items.map((c) => [c.id, c]))
  const byFile = new Map(uploads.map((u) => [u.file, u]))
  const entries: FolderEntry[] = []
  const documents: FolderDocument[] = []
  for (const id of order) {
    const item = byId.get(id)
    if (!item || isNotAllocable(item.category)) continue
    // Der Beleg der Position und die Belege, die über gebuchte Zeilen ihrer Auswertungen an ihr
    // hängen (Belegbuchung): Abschlag und Restrechnung gehören beide in die Mappe.
    const named = [item.invoiceFile, ...uploads.filter((u) => u.bookedItemIds?.includes(item.id)).map((u) => u.file)]
    const files = [...new Set(named.filter((f): f is string => !!f))]
    const present = files.flatMap((f) => byFile.get(f) ?? [])
    const upload = present[0] ?? null
    const status: FolderEntryStatus = files.length === 0 ? 'none' : !upload ? 'missing' : isIndividualAmounts(item) && !includeIndividual ? 'excluded' : 'ok'
    entries.push({ item, status, upload })
    if (status !== 'ok') continue
    for (const u of present) {
      const doc = documents.find((d) => d.upload.file === u.file)
      if (doc) doc.itemIds.push(item.id)
      else documents.push({ upload: u, itemIds: [item.id] })
    }
  }
  return { entries, documents }
}

// ---------- Deckblatt ----------

const A4: [number, number] = [595.28, 841.89]
const MARGIN = 50
const ROW_HEIGHT = 16
const FIRST_PAGE_ROWS = 38
const NEXT_PAGE_ROWS = 44

export function coverPageCount(entries: number): number {
  if (entries <= FIRST_PAGE_ROWS) return 1
  return 1 + Math.ceil((entries - FIRST_PAGE_ROWS) / NEXT_PAGE_ROWS)
}

export type CoverRow = { entry: FolderEntry; page: number | null; unreadable: boolean }

// Was auf dem Deckblatt bei einem Beleg steht, der sich weder übernehmen noch als Bild rendern
// ließ (HEIC, TIFF, PDF mit Öffnungspasswort, Datei nicht abrufbar). Die Mappe entsteht trotzdem.
export const UNREADABLE_TEXT = 'nicht übernehmbar, bitte gesondert beilegen'

// Die Seite, auf der der Beleg jeder Position beginnt. `pages`: Seitenzahl je Beleg;
// `unreadable`: Belege, die nicht in die Mappe kamen.
export function pageRows(plan: TenantFolderPlan, pages: Map<string, number>, unreadable: Set<string> = new Set()): CoverRow[] {
  const start = new Map<string, number>()
  let next = coverPageCount(plan.entries.length) + 1
  for (const d of plan.documents) {
    if (unreadable.has(d.upload.file)) continue
    start.set(d.upload.file, next)
    next += pages.get(d.upload.file) ?? 0
  }
  return plan.entries.map((entry) => {
    const file = entry.status === 'ok' && entry.upload ? entry.upload.file : null
    const broken = file !== null && unreadable.has(file)
    return { entry, unreadable: broken, page: file && !broken ? start.get(file) ?? null : null }
  })
}

// Die Standardschrift eines PDFs (WinAnsi) kennt Umlaute, ß, € und § , aber keine Pfeile oder
// Häkchen. Was sie nicht kennt, wird ersetzt, statt die ganze Mappe scheitern zu lassen.
const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'
export function winAnsiSafe(text: string): string {
  return text
    .replace(/→/g, '->')
    .replace(/[^\n]/gu, (ch) => {
      const code = ch.codePointAt(0) ?? 0
      return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.includes(ch) ? ch : '?'
    })
}

const STATUS_TEXT: Record<Exclude<FolderEntryStatus, 'ok'>, string> = {
  none: 'kein Beleg erfasst',
  missing: 'Datei fehlt',
  excluded: 'auf Anfrage (betrifft einzelne Mieter)',
}

function fitText(text: string, font: PDFFont, size: number, width: number): string {
  let t = winAnsiSafe(text)
  if (font.widthOfTextAtSize(t, size) <= width) return t
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > width) t = t.slice(0, -1)
  return `${t}…`
}

export type FolderSource = {
  title: string
  subtitle: string
  // Inhalt eines Belegs
  load: (u: UploadInfo) => Promise<Uint8Array>
  // Seiten eines Belegs als JPEG, wenn pdf-lib ihn nicht übernehmen kann
  rasterize: (u: UploadInfo) => Promise<Uint8Array[]>
  // Meldet einen Beleg, der nicht in die Mappe kam
  onUnreadable?: (u: UploadInfo) => void
}

type PdfLib = typeof import('pdf-lib')

async function addImagePage(out: PDFDocument, bytes: Uint8Array, kind: 'jpg' | 'png'): Promise<void> {
  const image = kind === 'png' ? await out.embedPng(bytes) : await out.embedJpg(bytes)
  const page = out.addPage(A4)
  const maxW = A4[0] - 2 * MARGIN
  const maxH = A4[1] - 2 * MARGIN
  const scale = Math.min(maxW / image.width, maxH / image.height)
  const w = image.width * scale
  const h = image.height * scale
  page.drawImage(image, { x: (A4[0] - w) / 2, y: A4[1] - MARGIN - h, width: w, height: h })
}

// Hängt einen Beleg an und gibt zurück, wie viele Seiten er belegt.
async function appendDocument(lib: PdfLib, out: PDFDocument, u: UploadInfo, source: FolderSource): Promise<number> {
  const before = out.getPageCount()
  const bytes = await source.load(u)
  try {
    if (u.mimeType === 'application/pdf') {
      // Ohne `ignoreEncryption`: Ein verschlüsseltes PDF soll scheitern und als Bild hineinkommen,
      // statt unlesbar kopiert zu werden (Durchsicht).
      const doc = await lib.PDFDocument.load(bytes)
      const pages = await out.copyPages(doc, doc.getPageIndices())
      for (const p of pages) out.addPage(p)
    } else if (u.mimeType === 'image/png') {
      await addImagePage(out, bytes, 'png')
    } else if (u.mimeType === 'image/jpeg') {
      await addImagePage(out, bytes, 'jpg')
    } else {
      throw new Error('Format nicht unmittelbar übernehmbar')
    }
  } catch {
    // Was halb hinzugefügt wurde, wieder weg, dann als Bilder
    while (out.getPageCount() > before) out.removePage(out.getPageCount() - 1)
    for (const jpeg of await source.rasterize(u)) await addImagePage(out, jpeg, 'jpg')
  }
  return out.getPageCount() - before
}

function drawCover(lib: PdfLib, pages: PDFPage[], rows: CoverRow[], fonts: { regular: PDFFont; bold: PDFFont }, source: FolderSource): void {
  const { rgb } = lib
  const { regular, bold } = fonts
  const width = A4[0] - 2 * MARGIN
  const cols = { nr: MARGIN, position: MARGIN + 24, amount: MARGIN + width - 235, beleg: MARGIN + width - 170, page: MARGIN + width - 25 }
  let index = 0
  pages.forEach((page, p) => {
    let y = A4[1] - MARGIN
    if (p === 0) {
      page.drawText(winAnsiSafe(source.title), { x: MARGIN, y: y - 18, size: 18, font: bold })
      page.drawText(winAnsiSafe(source.subtitle), { x: MARGIN, y: y - 38, size: 11, font: regular, color: rgb(0.3, 0.3, 0.3) })
      page.drawText(winAnsiSafe('Belege zu den umgelegten Kosten, in der Reihenfolge der Abrechnung (§ 556 Abs. 4 BGB).'), { x: MARGIN, y: y - 56, size: 9.5, font: regular, color: rgb(0.3, 0.3, 0.3) })
      y -= 84
    }
    const header = (yy: number) => {
      page.drawText('Nr.', { x: cols.nr, y: yy, size: 9, font: bold })
      page.drawText('Position', { x: cols.position, y: yy, size: 9, font: bold })
      page.drawText('Betrag', { x: cols.amount, y: yy, size: 9, font: bold })
      page.drawText('Beleg', { x: cols.beleg, y: yy, size: 9, font: bold })
      page.drawText('Seite', { x: cols.page, y: yy, size: 9, font: bold })
      page.drawLine({ start: { x: MARGIN, y: yy - 4 }, end: { x: MARGIN + width, y: yy - 4 }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) })
    }
    header(y)
    y -= ROW_HEIGHT + 2
    const limit = p === 0 ? FIRST_PAGE_ROWS : NEXT_PAGE_ROWS
    for (let n = 0; n < limit && index < rows.length; n++, index++) {
      const { entry, page: at, unreadable: broken } = rows[index]
      const amount = fmtEuro(entry.item.amountCents).replace(/ /g, ' ')
      page.drawText(String(index + 1), { x: cols.nr, y, size: 9, font: regular })
      page.drawText(fitText(`${entry.item.category} – ${entry.item.description}`, regular, 9, cols.amount - cols.position - 8), { x: cols.position, y, size: 9, font: regular })
      page.drawText(winAnsiSafe(amount), { x: cols.amount, y, size: 9, font: regular })
      if (broken) {
        page.drawText(fitText(UNREADABLE_TEXT, regular, 7, A4[0] - MARGIN - cols.beleg), { x: cols.beleg, y, size: 7, font: regular, color: rgb(0.6, 0.1, 0.1) })
      } else if (entry.status === 'ok' && entry.upload) {
        page.drawText(fitText(entry.upload.originalName || entry.upload.file, regular, 8, cols.page - cols.beleg - 6), { x: cols.beleg, y, size: 8, font: regular })
        page.drawText(at === null ? '' : String(at), { x: cols.page, y, size: 9, font: bold })
      } else {
        page.drawText(fitText(STATUS_TEXT[entry.status === 'ok' ? 'missing' : entry.status], regular, 8, A4[0] - MARGIN - cols.beleg), { x: cols.beleg, y, size: 8, font: regular, color: rgb(0.45, 0.3, 0) })
      }
      y -= ROW_HEIGHT
    }
  })
}

export async function buildTenantFolderPdf(plan: TenantFolderPlan, source: FolderSource): Promise<Uint8Array> {
  const lib = await import('pdf-lib')
  const { PDFDocument, StandardFonts, rgb } = lib
  // Erst die Belege, damit ihre Seitenzahlen feststehen; das Deckblatt kommt danach nach vorn.
  const body = await PDFDocument.create()
  const pages = new Map<string, number>()
  const unreadable = new Set<string>()
  for (const d of plan.documents) {
    const before = body.getPageCount()
    try {
      pages.set(d.upload.file, await appendDocument(lib, body, d.upload, source))
    } catch {
      // Weder übernehmbar noch als Bild darstellbar: Die Mappe entsteht trotzdem, das Deckblatt
      // nennt den Beleg mit dem Hinweis, ihn gesondert beizulegen (Durchsicht).
      while (body.getPageCount() > before) body.removePage(body.getPageCount() - 1)
      unreadable.add(d.upload.file)
      source.onUnreadable?.(d.upload)
    }
  }

  const out = await PDFDocument.create()
  out.setTitle(winAnsiSafe(source.title))
  out.setSubject(winAnsiSafe(source.subtitle))
  out.setCreator('Mietfuchs')
  const fonts = { regular: await out.embedFont(StandardFonts.Helvetica), bold: await out.embedFont(StandardFonts.HelveticaBold) }
  const cover = Array.from({ length: coverPageCount(plan.entries.length) }, () => out.addPage(A4))
  drawCover(lib, cover, pageRows(plan, pages, unreadable), fonts, source)
  const copied = await out.copyPages(body, body.getPageIndices())
  for (const p of copied) out.addPage(p)
  // Jede Seite trägt ihre Nummer, damit sich „Seite 7“ vom Deckblatt auch ausgedruckt findet.
  const total = out.getPageCount()
  out.getPages().forEach((page, i) => {
    const { width } = page.getSize()
    page.drawText(`Seite ${i + 1} von ${total}`, { x: width - MARGIN - 70, y: 18, size: 8, font: fonts.regular, color: rgb(0.4, 0.4, 0.4) })
  })
  return out.save()
}

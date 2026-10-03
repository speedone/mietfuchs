// Der Belegordner (#170), ohne DOM prüfbar (receipts.test.ts). Die Seite Belege.tsx rendert nur.
//
// Vorbild ist der Ordner aus Papier: ein Ordner je Objekt und Jahr, darin ein Register je
// Kostenart. Was Papier nicht kann, steht ebenfalls hier: suchen, Doppelte erkennen und zeigen,
// welche Position noch ohne Beleg ist.
//
// **Objekt und Jahr eines verknüpften Belegs ergeben sich aus seinen Positionen.** Ein Beleg, der
// an einer Position hängt, hat kein eigenes Objekt und kein eigenes Jahr; sonst gäbe es zwei
// Wahrheiten, die auseinanderlaufen, sobald jemand die Position verschiebt. Nur ein Beleg im
// Posteingang (an keiner Position) trägt sie selbst.
import type { CostItem, UploadInfo, UploadLinks } from './types'
import { CATEGORIES, matchCategory } from './types'
import { fmtEuro, parseEuro } from './api'
import { amountProblem } from './costForm'
import { sameCostCandidates } from '../../shared/duplicates.ts'

// Ein Beleg, wie GET /api/uploads ihn liefert. Die Angaben der Belegbuchung (#170) fehlen bei
// einem älteren Server und in Tests, die sie nicht brauchen.
export type ReceiptUpload = UploadInfo & Partial<UploadLinks>

export type FolderFilter = { propertyId: string | 'all'; year: number | 'all' }

export type ReceiptCard = {
  upload: ReceiptUpload
  // Alle Positionen, an denen der Beleg hängt, über Objekte und Jahre hinweg
  items: CostItem[]
  vendor: string | null
  amountCents: number
  propertyIds: string[]
  years: number[]
}

// Ein Register: eine Kostenart eines Jahres.
export type CategoryGroup = {
  key: string
  year: number
  category: string
  // Summe aller Positionen der Kostenart im Register, auch bei einer Suche
  sumCents: number
  items: CostItem[]
  cards: ReceiptCard[]
  // Positionen ohne Beleg
  missing: CostItem[]
}

export type Folder = {
  groups: CategoryGroup[]
  // Belege, die an keiner Position hängen
  unlinked: ReceiptCard[]
}

// Der Anzeigename eines Belegs: der Originalname, wie er beim Hochladen hieß.
// Zählerfotos der Schnellerfassung liegen im selben Ordner, belegen aber keine Kosten.
export const isReceipt = (c: ReceiptCard): boolean => c.upload.kind !== 'meterPhoto'

export const receiptName = (u: Pick<UploadInfo, 'originalName' | 'file'>): string => u.originalName || u.file

export function receiptCards(uploads: ReceiptUpload[], items: CostItem[]): ReceiptCard[] {
  const byFile = new Map<string, CostItem[]>()
  for (const c of items) {
    if (!c.invoiceFile) continue
    const list = byFile.get(c.invoiceFile) ?? []
    list.push(c)
    byFile.set(c.invoiceFile, list)
  }
  return uploads.map((upload) => {
    const linked = [...(byFile.get(upload.file) ?? [])]
    // Über gebuchte Zeilen der Auswertung (#170): Der zweite Beleg einer Position, etwa die
    // Restrechnung neben dem Abschlag, hängt an ihr, ohne ihr `invoiceFile` zu sein.
    for (const id of upload.bookedItemIds ?? []) {
      const c = items.find((i) => i.id === id)
      if (c && !linked.includes(c)) linked.push(c)
    }
    return {
      upload,
      items: linked,
      vendor: linked.find((c) => c.vendor)?.vendor ?? null,
      amountCents: linked.reduce((a, c) => a + c.amountCents, 0),
      propertyIds: [...new Set(linked.map((c) => c.propertyId))],
      years: [...new Set(linked.map((c) => c.year))].sort((a, b) => b - a),
    }
  })
}

const inScope = (c: CostItem, f: FolderFilter): boolean =>
  (f.propertyId === 'all' || c.propertyId === f.propertyId) && (f.year === 'all' || c.year === f.year)

// Die Reihenfolge der Register: wie die Kostenarten in der Oberfläche stehen, Unbekanntes danach.
const categoryRank = (category: string): number => {
  const i = CATEGORIES.indexOf(category)
  return i < 0 ? CATEGORIES.length : i
}

// Ein Betrag in der Suche: „128,40“, „128.40“, „128,40 €“, „1.240,00“ oder „260“. Eine
// vierstellige Zahl ohne Komma ist eher ein Jahr; sie wird trotzdem auch als Betrag versucht.
const amountOf = (query: string): number | null => (/\d/.test(query) && /^[\d.,\s€-]+$/.test(query) ? parseEuro(query.trim()) : null)

const textOf = (card: ReceiptCard): string =>
  [card.upload.originalName, card.upload.file, card.vendor ?? '', ...card.items.flatMap((c) => [c.vendor ?? '', c.description, c.category])]
    .join(' ')
    .toLowerCase()

export function matchesQuery(card: ReceiptCard, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (/^\d{4}$/.test(q) && card.years.includes(Number(q))) return true
  const cents = amountOf(q)
  if (cents !== null && (card.amountCents === cents || card.items.some((c) => c.amountCents === cents))) return true
  return textOf(card).includes(q)
}

// Dieselbe Suche für eine Position ohne Beleg.
export function itemMatchesQuery(c: CostItem, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (/^\d{4}$/.test(q) && c.year === Number(q)) return true
  const cents = amountOf(q)
  if (cents !== null && c.amountCents === cents) return true
  return [c.vendor ?? '', c.description, c.category].join(' ').toLowerCase().includes(q)
}

export function buildFolder(uploads: ReceiptUpload[], items: CostItem[], filter: FolderFilter, query: string): Folder {
  const cards = receiptCards(uploads, items)
  const cardByFile = new Map(cards.map((c) => [c.upload.file, c]))
  const cardsByItem = new Map<string, ReceiptCard[]>()
  for (const card of cards) for (const id of card.upload.bookedItemIds ?? []) cardsByItem.set(id, [...(cardsByItem.get(id) ?? []), card])
  const groups = new Map<string, CategoryGroup>()
  for (const c of items) {
    if (!inScope(c, filter)) continue
    const key = `${c.year}|${c.category}`
    let g = groups.get(key)
    if (!g) {
      g = { key, year: c.year, category: c.category, sumCents: 0, items: [], cards: [], missing: [] }
      groups.set(key, g)
    }
    g.sumCents += c.amountCents
    g.items.push(c)
    const own = c.invoiceFile ? cardByFile.get(c.invoiceFile) : undefined
    const all = [...(own ? [own] : []), ...(cardsByItem.get(c.id) ?? []).filter((x) => x !== own)]
    if (all.length === 0) {
      // Ohne Beleg, oder der verknüpfte Beleg liegt nicht mehr im Ordner: beides fehlt.
      if (itemMatchesQuery(c, query)) g.missing.push(c)
    } else {
      for (const card of all) if (!g.cards.includes(card) && matchesQuery(card, query)) g.cards.push(card)
    }
  }
  const sorted = [...groups.values()]
    .filter((g) => !query.trim() || g.cards.length > 0 || g.missing.length > 0)
    .sort((a, b) => b.year - a.year || categoryRank(a.category) - categoryRank(b.category) || a.category.localeCompare(b.category, 'de'))
  const unlinked = cards.filter((c) => c.items.length === 0 && isReceipt(c) && matchesQuery(c, query))
  return { groups: sorted, unlinked }
}

// Hinweise auf doppelte Belege. **Gleicher Inhalt** erkennt die Prüfsumme sicher, auch unter
// anderem Namen und bevor der Beleg an einer Position hängt. Gleicher Rechnungssteller, gleiche
// Summe und gleiches Jahr ist dagegen nur ein Verdacht: zwei Abschläge desselben Versorgers
// sehen genauso aus. Die frühere Regel „gleiche Dateigröße“ entfällt, denn dafür gibt es jetzt
// die Prüfsumme, und gleich groß sind auch zwei verschiedene Scans desselben Geräts.
export function duplicateHints(cards: ReceiptCard[]): Map<string, string> {
  const hints = new Map<string, string>()
  for (const card of cards) {
    const twin = cards.find((o) => o !== card && o.upload.sha256 && o.upload.sha256 === card.upload.sha256)
    if (twin) {
      hints.set(card.upload.file, `gleicher Inhalt wie „${receiptName(twin.upload)}“ — dieselbe Datei wurde doppelt hochgeladen`)
      continue
    }
    if (card.items.length === 0 || !card.vendor) continue
    const vendor = card.vendor.toLowerCase()
    const other = cards.find((o) =>
      o !== card && o.items.length > 0 && o.vendor?.toLowerCase() === vendor && o.amountCents === card.amountCents &&
      o.years.some((y) => card.years.includes(y)))
    if (other) {
      hints.set(card.upload.file, `gleicher Rechnungssteller, gleiche Summe und gleiches Jahr wie „${receiptName(other.upload)}“ — möglicherweise doppelt erfasst`)
    }
  }
  return hints
}

// ---------- Belegabdeckung (#170) ----------

export type Coverage = {
  positions: number
  covered: number
  totalCents: number
  coveredCents: number
  // Anteil der Kosten mit Beleg, abgerundet: 100 % heißt, es fehlt wirklich nichts
  percent: number
  missing: CostItem[]
}

// Je Position die Belege, die über gebuchte Zeilen an ihr hängen (#170).
export function filesByItem(uploads: readonly ReceiptUpload[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const u of uploads) for (const id of u.bookedItemIds ?? []) out.set(id, [...(out.get(id) ?? []), u.file])
  return out
}

// Welcher Anteil der erfassten Kosten durch einen Beleg gedeckt ist. Gemessen am **Betrag** und
// nicht an der Zahl der Positionen, denn ein fehlender Grundsteuerbescheid wiegt schwerer als
// eine fehlende Quittung über 4 €; die Zahl der Positionen steht daneben. Eine Gutschrift zählt
// mit ihrem Betrag, sonst höbe sie eine gleich hohe Rechnung auf, und eine Position über 0 €
// zählt gar nicht: Für sie gibt es nichts zu belegen.
//
// `present` sind die Dateien, die im Belegordner liegen. Ein Verweis auf eine Datei, die fehlt,
// deckt nichts. Ohne die Liste (Cockpit) zählt der Verweis.
export function coverage(items: CostItem[], filter: FolderFilter, present: Set<string> | null, booked: ReadonlyMap<string, readonly string[]> = new Map()): Coverage {
  const relevant = items.filter((c) => inScope(c, filter) && c.amountCents !== 0)
  // Ein Beleg, der nur über eine verknüpfte Zeile an der Position hängt, deckt sie wie ihr eigener.
  const isCovered = (c: CostItem) => [c.invoiceFile, ...(booked.get(c.id) ?? [])].some((f) => !!f && (present === null || present.has(f)))
  const covered = relevant.filter(isCovered)
  const totalCents = relevant.reduce((a, c) => a + Math.abs(c.amountCents), 0)
  const coveredCents = covered.reduce((a, c) => a + Math.abs(c.amountCents), 0)
  const percent = totalCents === 0 ? 100 : Math.floor((coveredCents / totalCents) * 100)
  return {
    positions: relevant.length,
    covered: covered.length,
    totalCents,
    coveredCents,
    percent: covered.length < relevant.length ? Math.min(percent, 99) : 100,
    missing: relevant.filter((c) => !isCovered(c)),
  }
}

// Die Zeile „Belege vollständig“ im Cockpit, für die Positionen eines Objekts und Jahres. **Nie
// rot**: Rot heißt dort, die Abrechnung lässt sich so nicht erstellen. Ein fehlender Beleg ändert
// keine Zahl; er wird erst wichtig, wenn ein Mieter Einsicht verlangt (§ 556 Abs. 4 BGB).
//
// `present`: die Dateien im Belegordner. Mit ihr zählt ein Verweis auf eine fehlende Datei wie im
// Belegordner als fehlend, und die Zeile sagt es; sonst widersprächen Cockpit und Belegordner
// einander (Durchsicht). Ohne sie (Liste nicht geladen) zählt der Verweis.
export function coverageCheck(yearItems: CostItem[], present: Set<string> | null = null, booked: ReadonlyMap<string, readonly string[]> = new Map()): { level: 'gruen' | 'gelb' | 'leer'; detail: string } {
  const cov = coverage(yearItems, { propertyId: 'all', year: 'all' }, present, booked)
  const fileGone = cov.missing.filter((c) => c.invoiceFile).length
  if (cov.positions === 0) return { level: 'leer', detail: 'Noch keine Kosten erfasst, also auch nichts zu belegen.' }
  if (cov.covered === cov.positions) {
    return { level: 'gruen', detail: `Zu allen ${cov.positions} Position(en) liegt ein Beleg vor.` }
  }
  const ohne = cov.positions - cov.covered
  return {
    level: 'gelb',
    detail: `${ohne} von ${cov.positions} Positionen ohne Beleg${fileGone > 0 ? ` (bei ${fileGone} fehlt die Datei im Belegordner)` : ''} · ${cov.percent} % der Kosten belegt. Das ändert keine Zahl der Abrechnung, aber Mieter dürfen die Belege einsehen.`,
  }
}

// ---------- Posteingang (#170) ----------
//
// „Unverknüpft“ ist ein Arbeitsschritt und kein Fehlerzustand: Ein Beleg kommt an, liegt im
// Posteingang und wird von dort einer Position zugeordnet oder per KI ausgewertet. Objekt und
// Jahr trägt er nur dort; sie sagen, wohin er gedacht ist.

const fitsPlacement = (u: UploadInfo, propertyId: string | 'all', year: number | 'all'): boolean =>
  (propertyId === 'all' || u.propertyId === null || u.propertyId === propertyId) &&
  (year === 'all' || u.year === null || u.year === year)

// Die Belege des Posteingangs für die Auswahl, und wie viele anderen Objekten oder Jahren
// zugedacht sind. Ein Beleg ohne Zuordnung steht überall, denn er wartet auf genau die.
export function inboxOf(cards: ReceiptCard[], filter: FolderFilter): { here: ReceiptCard[]; elsewhere: number } {
  const unlinked = cards.filter((c) => c.items.length === 0 && isReceipt(c))
  const here = unlinked.filter((c) => fitsPlacement(c.upload, filter.propertyId, filter.year))
  return { here, elsewhere: unlinked.length - here.length }
}

// Welche Belege des Posteingangs für eine Position in Frage kommen.
export function inboxFor(cards: ReceiptCard[], c: CostItem): ReceiptCard[] {
  return cards.filter((card) => card.items.length === 0 && isReceipt(card) && fitsPlacement(card.upload, c.propertyId, c.year))
}

// ---------- Einer Position zuordnen (Befund C) ----------

// Die Positionen, denen ein Beleg aus dem Posteingang zugeordnet werden kann, geteilt in die, die
// nach der gemeinsamen Regel (shared/duplicates.ts) zur Kostenart passen, die der Name des Belegs
// nennt, und die übrigen. Mehr als den Namen weiß der Posteingang über den Beleg nicht; erkennt er
// keine Kostenart, bleibt die Liste, wie sie ist. Die Reihenfolge der übergebenen Liste bleibt.
export function attachChoices(u: UploadInfo, candidates: readonly CostItem[]): { category: string | null; likely: CostItem[]; rest: CostItem[] } {
  // NFC: macOS liefert Dateinamen zerlegt („u“ und Trema), matchCategory sucht das „ü“.
  const name = (u.originalName || u.file).normalize('NFC').replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ')
  const category = matchCategory(name)
  const likely = candidates.filter((c) => sameCostCandidates([c], { propertyId: c.propertyId, year: c.year, category, description: name }).length > 0)
  return { category: likely.length > 0 ? category : null, likely, rest: candidates.filter((c) => !likely.includes(c)) }
}

// Bei Einzelbeträgen je Mieter und „laut Gemeinschaftsabrechnung“ hängt der Betrag an weiteren
// Angaben (Einzelbeträge, Kosten der Gemeinschaft); ihn allein zu ändern, ließe sie auseinanderlaufen.
export function amountCheckMode(item: CostItem): 'field' | 'form' {
  return item.key === 'amounts' || item.key === 'external' ? 'form' : 'field'
}

// „Betrag prüfen“ nach dem Zuordnen: Eine aus dem Vorjahr übernommene Position trägt einen
// geschätzten Betrag, der Beleg den wirklichen. Gespeichert wird nur der Betrag, mit derselben
// Prüfung wie im Formular; der Lohnanteil der Position bleibt.
export function amountCheckBody(amount: string, item: CostItem): { error: string; form?: boolean } | { body: { amountCents: number } } {
  const cents = parseEuro(amount)
  const labor = item.labor35aCents ?? 0
  // Ein Lohnanteil, der zum neuen Betrag nicht passt, lässt sich nur im Formular anpassen.
  if (cents !== null && labor > 0 && (cents < 0 || labor > cents)) {
    return { error: `Der §35a-Lohnanteil der Position (${fmtEuro(labor)}) liegt über dem neuen Betrag. Passen Sie ihn bitte im Formular an.`, form: true }
  }
  const problem = amountProblem(cents, labor, item.category)
  if (problem !== null || cents === null) return { error: problem ?? 'Bitte einen Betrag angeben.' }
  return { body: { amountCents: cents } }
}

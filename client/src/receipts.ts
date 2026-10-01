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
import type { CostItem, UploadInfo } from './types'
import { CATEGORIES } from './types'
import { parseEuro } from './api'

export type FolderFilter = { propertyId: string | 'all'; year: number | 'all' }

export type ReceiptCard = {
  upload: UploadInfo
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
export const receiptName = (u: Pick<UploadInfo, 'originalName' | 'file'>): string => u.originalName || u.file

export function receiptCards(uploads: UploadInfo[], items: CostItem[]): ReceiptCard[] {
  const byFile = new Map<string, CostItem[]>()
  for (const c of items) {
    if (!c.invoiceFile) continue
    const list = byFile.get(c.invoiceFile) ?? []
    list.push(c)
    byFile.set(c.invoiceFile, list)
  }
  return uploads.map((upload) => {
    const linked = byFile.get(upload.file) ?? []
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

export function buildFolder(uploads: UploadInfo[], items: CostItem[], filter: FolderFilter, query: string): Folder {
  const cards = receiptCards(uploads, items)
  const cardByFile = new Map(cards.map((c) => [c.upload.file, c]))
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
    const card = c.invoiceFile ? cardByFile.get(c.invoiceFile) : undefined
    if (!card) {
      // Ohne Beleg, oder der verknüpfte Beleg liegt nicht mehr im Ordner: beides fehlt.
      if (itemMatchesQuery(c, query)) g.missing.push(c)
    } else if (!g.cards.includes(card) && matchesQuery(card, query)) {
      g.cards.push(card)
    }
  }
  const sorted = [...groups.values()]
    .filter((g) => !query.trim() || g.cards.length > 0 || g.missing.length > 0)
    .sort((a, b) => b.year - a.year || categoryRank(a.category) - categoryRank(b.category) || a.category.localeCompare(b.category, 'de'))
  const unlinked = cards.filter((c) => c.items.length === 0 && matchesQuery(c, query))
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

// Welcher Anteil der erfassten Kosten durch einen Beleg gedeckt ist. Gemessen am **Betrag** und
// nicht an der Zahl der Positionen, denn ein fehlender Grundsteuerbescheid wiegt schwerer als
// eine fehlende Quittung über 4 €; die Zahl der Positionen steht daneben. Eine Gutschrift zählt
// mit ihrem Betrag, sonst höbe sie eine gleich hohe Rechnung auf, und eine Position über 0 €
// zählt gar nicht: Für sie gibt es nichts zu belegen.
//
// `present` sind die Dateien, die im Belegordner liegen. Ein Verweis auf eine Datei, die fehlt,
// deckt nichts. Ohne die Liste (Cockpit) zählt der Verweis.
export function coverage(items: CostItem[], filter: FolderFilter, present: Set<string> | null): Coverage {
  const relevant = items.filter((c) => inScope(c, filter) && c.amountCents !== 0)
  const isCovered = (c: CostItem) => !!c.invoiceFile && (present === null || present.has(c.invoiceFile))
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
export function coverageCheck(yearItems: CostItem[]): { level: 'gruen' | 'gelb' | 'leer'; detail: string } {
  const cov = coverage(yearItems, { propertyId: 'all', year: 'all' }, null)
  if (cov.positions === 0) return { level: 'leer', detail: 'Noch keine Kosten erfasst, also auch nichts zu belegen.' }
  if (cov.covered === cov.positions) {
    return { level: 'gruen', detail: `Zu allen ${cov.positions} Position(en) liegt ein Beleg vor.` }
  }
  const ohne = cov.positions - cov.covered
  return {
    level: 'gelb',
    detail: `${ohne} von ${cov.positions} Positionen ohne Beleg · ${cov.percent} % der Kosten belegt. Das ändert keine Zahl der Abrechnung, aber Mieter dürfen die Belege einsehen.`,
  }
}

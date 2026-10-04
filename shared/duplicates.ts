// Doppelte Kostenpositionen (Zusammenspiel von #141 und #170): Wann ist eine Rechnung schon
// erfasst? „Aus dem Vorjahr übernehmen“ legt eine Position mit geschätztem Betrag und ohne Beleg
// an; kommt danach die echte Rechnung über die Schnellerfassung, die KI-Auswertung der Kostenseite
// oder den Posteingang, entstünde sonst still eine zweite Position derselben Kostenart, und die
// Abrechnung verteilte dieselben Kosten zweimal. Umgekehrt ebenso: erst die Rechnung per KI, dann
// die Übernahme aus dem Vorjahr.
//
// Alle diese Wege und der Hinweis der Berechnung fragen dieselbe Regel, deshalb steht sie hier,
// wie der gemerkte Schlüssel in allocation.ts. Sie entscheidet nichts, sie findet nur Kandidaten:
// Ob es dieselbe Rechnung ist oder eine zweite, weiß nur der Vermieter.
import type { CostItem } from './types.ts'
import { BROAD_CATEGORIES } from './allocation.ts'

export type DuplicateItem = Pick<CostItem, 'id' | 'year' | 'category' | 'description'> &
  Partial<Pick<CostItem, 'propertyId' | 'vendor' | 'invoiceFile' | 'amountCents'>>

export type CostQuery = {
  propertyId?: string | null
  year: number
  category: string
  description?: string
  vendor?: string
  // Der Betrag der gesuchten Position, wenn er bekannt ist: Eine Gutschrift (negativ) ist nie
  // dieselbe Rechnung wie eine Rechnung (positiv), siehe `oppositeSign`. Fehlt er oder ist er 0,
  // zählt jede Position.
  amountCents?: number | null
  // Die Position selbst, wenn nach einer schon gespeicherten gefragt wird
  excludeId?: string
}

// Kostenarten, unter denen ganz verschiedene Rechnungen stehen. Dort zählt eine Position nur
// mit ähnlicher Beschreibung oder vom selben Rechnungssteller: Die Wartung der Hebeanlage und die
// Reinigung der Dachrinne sind beide „Sonstige Betriebskosten“ und doch zwei Rechnungen; ebenso
// Verwaltergebühr und Heizungsreparatur unter „Nicht umlagefähig“. Bei jeder anderen Kostenart
// ist eine zweite Position im selben Jahr selten gewollt und deshalb immer eine Rückfrage wert.
export const LOOSE_CATEGORIES: readonly string[] = [...BROAD_CATEGORIES, 'Nicht umlagefähig']

// Klein geschrieben, Jahreszahlen und Satzzeichen entfernt: „Grundsteuer 2025“ und „Grundsteuer
// 2026“ sind dieselbe Beschreibung, so wie die Übernahme aus dem Vorjahr die Jahreszahl ersetzt.
export function normalizedText(s: string | undefined | null): string {
  // NFC zuerst: macOS liefert Dateinamen zerlegt („u“ und Trema), das gehört zum Buchstaben.
  return (s ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/(^|[^0-9])(19|20)\d{2}(?=[^0-9]|$)/g, '$1 ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

// Gleich, oder die eine fängt mit der anderen an („Stadtwerke“ und „Stadtwerke Musterstadt
// GmbH“). Sehr kurze Angaben treffen nichts, sonst passte „a“ zu allem.
function similar(a: string | undefined | null, b: string | undefined | null): boolean {
  const x = normalizedText(a)
  const y = normalizedText(b)
  if (Math.min(x.length, y.length) < 3) return false
  return x.startsWith(y) || y.startsWith(x)
}

// Gutschrift gegen Rechnung (Befund gegen 0.10.0-rc.1): Der Hinweis der Abrechnung paarte eine
// Gutschrift mit der Rechnung derselben Kostenart und riet, die ohne Beleg zu löschen; befolgt
// zahlten die Mieter die Gutschrift nicht gutgeschrieben oder die Rechnung gar nicht. Zwei
// Gutschriften derselben Art können dagegen dieselbe sein, ebenso zwei Rechnungen.
function oppositeSign(a: number | null | undefined, b: number | null | undefined): boolean {
  return a != null && b != null && ((a < 0 && b > 0) || (a > 0 && b < 0))
}

// Die schon erfassten Positionen, die dieselbe Rechnung sein könnten: dasselbe Objekt, dasselbe
// Jahr, dieselbe Kostenart, bei einer breiten Kostenart zusätzlich ähnliche Beschreibung oder
// gleicher Rechnungssteller, und nie eine Gutschrift zu einer Rechnung oder umgekehrt. In der
// Reihenfolge der Liste.
export function sameCostCandidates<T extends DuplicateItem>(items: readonly T[], q: CostQuery): T[] {
  const loose = LOOSE_CATEGORIES.includes(q.category)
  return items.filter((i) =>
    i.id !== q.excludeId &&
    i.year === q.year &&
    i.category === q.category &&
    !oppositeSign(i.amountCents, q.amountCents) &&
    (q.propertyId == null || i.propertyId == null || i.propertyId === q.propertyId) &&
    (!loose || similar(i.description, q.description) || similar(i.vendor, q.vendor)))
}

const queryOf = (i: DuplicateItem, year = i.year): CostQuery => ({
  propertyId: i.propertyId, year, category: i.category, description: i.description, vendor: i.vendor, amountCents: i.amountCents, excludeId: i.id,
})

// Die Gruppen möglicher Doppelungen eines Jahres, für den Hinweis der Abrechnung: zwei oder mehr
// Positionen, die nach der Regel oben zusammengehören, mindestens eine davon ohne Beleg, und dazu
// (a) mindestens eine mit Beleg, also der Fall „übernommen und dann aus dem Beleg erfasst“, oder
// (b) ein Vorjahr mit Positionen dieser Art, und dieses Jahr sind es mehr. Ohne Vorjahr und ganz
// ohne Belege bleibt es still: Zwei von Hand erfasste Versicherungen sind zwei Rechnungen, und der
// Hinweis färbte die Ampel sonst dauerhaft (zweite Durchsicht). Ebenso still bleiben Restmüll und
// Biomüll, beide aus dem Vorjahr übernommen: Das ist die Gliederung des Hauses.
export function possibleDuplicates<T extends DuplicateItem>(items: readonly T[], year: number, previous: readonly DuplicateItem[] = []): T[][] {
  const own = items.filter((i) => i.year === year)
  const groupOf = new Map<string, T[]>()
  const groups: T[][] = []
  for (const i of own) {
    const linked = sameCostCandidates(own, queryOf(i)).map((c) => groupOf.get(c.id)).filter((g): g is T[] => !!g)
    const target = linked[0] ?? []
    if (!linked[0]) groups.push(target)
    // Verbindet die Position zwei bisher getrennte Gruppen, gehen sie in der ersten auf.
    for (const other of linked.slice(1)) {
      if (other === target) continue
      for (const x of other) { target.push(x); groupOf.set(x.id, target) }
      other.length = 0
    }
    target.push(i)
    groupOf.set(i.id, target)
  }
  return groups
    .filter((g) => g.length >= 2 && g.some((i) => !i.invoiceFile))
    .map((g) => own.filter((i) => g.includes(i)))
    .filter((g) => {
      if (g.some((i) => i.invoiceFile)) return true
      const before = previous.filter((p) => g.some((i) => sameCostCandidates([p], queryOf(i, year - 1)).length > 0))
      return before.length > 0 && g.length > before.length
    })
}

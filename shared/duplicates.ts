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
import type { CostItem, PeriodKey } from './types.ts'
import type { PeriodContext } from './period.ts'
import { BROAD_CATEGORIES } from './allocation.ts'

export type DuplicateItem = Pick<CostItem, 'id' | 'period' | 'category' | 'description'> &
  Partial<Pick<CostItem, 'propertyId' | 'vendor' | 'invoiceFile' | 'amountCents' | 'sourceId' | 'serviceFrom' | 'serviceTo'>>

export type CostQuery = {
  propertyId?: string | null
  // Der Abrechnungszeitraum, in dem gesucht wird (#208).
  period: PeriodKey
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

// Die schon erfassten Positionen, die dieselbe Rechnung sein könnten: dasselbe Objekt, derselbe
// Zeitraum, dieselbe Kostenart, bei einer breiten Kostenart zusätzlich ähnliche Beschreibung oder
// gleicher Rechnungssteller, und nie eine Gutschrift zu einer Rechnung oder umgekehrt. In der
// Reihenfolge der Liste.
export function sameCostCandidates<T extends DuplicateItem>(items: readonly T[], q: CostQuery): T[] {
  const loose = LOOSE_CATEGORIES.includes(q.category)
  return items.filter((i) =>
    i.id !== q.excludeId &&
    i.period === q.period &&
    i.category === q.category &&
    !oppositeSign(i.amountCents, q.amountCents) &&
    (q.propertyId == null || i.propertyId == null || i.propertyId === q.propertyId) &&
    (!loose || similar(i.description, q.description) || similar(i.vendor, q.vendor)))
}

const isCredit = (i: DuplicateItem): boolean => (i.amountCents ?? 0) < 0

// Zwei Rechnungen, deren Leistungszeiträume sich nicht überschneiden, sind zwei Rechnungen (#455, Durchsicht von PR 3,
// I3): die Versicherung von Juli bis Juni, zwei Jahre nacheinander, jede in zwei Teile geteilt. Jeder Teil trägt den
// ganzen Leistungszeitraum seiner Rechnung, der Teil im Zeitraum genügt also. Fehlt einer der beiden der
// Leistungszeitraum, bleibt es bei der Regel oben.
export function separateService(a: DuplicateItem, b: DuplicateItem): boolean {
  if (!a.serviceFrom || !a.serviceTo || !b.serviceFrom || !b.serviceTo) return false
  return a.serviceTo < b.serviceFrom || b.serviceTo < a.serviceFrom
}

// Die Rechnung, zu der eine Position gehört (#455): Die Teile einer Quelle sind eine Rechnung, jede andere Position
// ist ihre eigene.
export const invoiceOf = (i: DuplicateItem): string => (i.sourceId ? `q:${i.sourceId}` : `p:${i.id}`)
const invoiceCount = (items: readonly DuplicateItem[]): number => new Set(items.map(invoiceOf)).size
// Eine Rechnung gilt als belegt, wenn einer ihrer Teile den Beleg trägt.
const withReceipt = (items: readonly DuplicateItem[], receipted: ReadonlySet<string> = new Set()): Set<string> =>
  new Set(items.filter((i) => i.invoiceFile || (i.sourceId && receipted.has(i.sourceId))).map(invoiceOf))

// Die Quellen, von denen irgendein Teil, gleich in welchem Zeitraum, einen Beleg trägt.
export function receiptedSources(items: readonly DuplicateItem[]): Set<string> {
  return new Set(items.filter((i) => i.sourceId && i.invoiceFile).map((i) => i.sourceId as string))
}

// Eine Gruppe möglicher Doppelungen je Rechnung (#455), für den Text des Hinweises: die Teile jeder Rechnung in der
// Reihenfolge der Gruppe, und ob sie belegt ist (ein Teil trägt den Beleg).
//
// `receipted` sind die Quellen, deren Beleg in irgendeinem Zeitraum hängt (`receiptedSources`): Eine Rechnung ist belegt,
// wenn ein Teil in einem anderen Zeitraum den Beleg trägt, so zählen auch Belegabdeckung und Abzeichen.
export function invoicesOf<T extends DuplicateItem>(group: readonly T[], receipted: ReadonlySet<string> = new Set()): { parts: T[]; hasReceipt: boolean }[] {
  const out = new Map<string, { parts: T[]; hasReceipt: boolean }>()
  for (const i of group) {
    const key = invoiceOf(i)
    const inv = out.get(key) ?? { parts: [], hasReceipt: false }
    inv.parts.push(i)
    inv.hasReceipt ||= !!i.invoiceFile || (!!i.sourceId && receipted.has(i.sourceId))
    out.set(key, inv)
  }
  return [...out.values()]
}

const queryOf = (i: DuplicateItem, period: PeriodKey = i.period): CostQuery => ({
  propertyId: i.propertyId, period, category: i.category, description: i.description, vendor: i.vendor, amountCents: i.amountCents, excludeId: i.id,
})

// Die Gruppen möglicher Doppelungen eines Zeitraums, für den Hinweis der Abrechnung: zwei oder mehr
// Rechnungen (die Teile einer Quelle zählen als eine, #455), die nach der Regel oben zusammengehören,
// mindestens eine davon ohne Beleg, und dazu (a) mindestens eine mit Beleg, also der Fall „übernommen
// und dann aus dem Beleg erfasst“, oder (b) ein Vorzeitraum mit Positionen dieser Art, und in diesem
// sind es mehr. Ohne Vorzeitraum und ganz ohne Belege bleibt es still: Zwei von Hand erfasste
// Versicherungen sind zwei Rechnungen, und der Hinweis färbte die Ampel sonst dauerhaft (zweite
// Durchsicht). Ebenso still bleiben Restmüll und Biomüll, beide aus dem Vorjahr übernommen: Das ist
// die Gliederung des Hauses.
export function possibleDuplicates<T extends DuplicateItem>(items: readonly T[], at: PeriodContext, previous: readonly DuplicateItem[] = [], receipted: ReadonlySet<string> = new Set()): T[][] {
  const own = items.filter((i) => i.period === at.key)
  const groupOf = new Map<string, T[]>()
  const groups: T[][] = []
  for (const i of own) {
    // Gruppiert wird je Seite: Gutschriften für sich, alles übrige für sich. Eine Position mit 0 €
    // oder ohne Betrag passt nach `oppositeSign` zu beiden Seiten und verband sonst eine Gutschrift
    // mit einer Rechnung zu einer Gruppe (N1 der Durchsicht von #201). Sie zählt zur Seite der
    // Rechnungen, denn so steht eine aus dem Vorjahr übernommene Schätzung ohne Betrag da.
    const linked = sameCostCandidates(own, queryOf(i))
      .filter((c) => isCredit(c) === isCredit(i) && !separateService(c, i))
      .map((c) => groupOf.get(c.id)).filter((g): g is T[] => !!g)
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
  // Gezählt wird je Rechnung (#455): Die Teile einer Quelle im selben Zeitraum melden einander nicht, und eine
  // Rechnung ist belegt, wenn einer ihrer Teile den Beleg trägt. Gemeldet wird eine Gruppe mit allen ihren Positionen.
  return groups
    .filter((g) => {
      const belegt = withReceipt(g, receipted)
      return invoiceCount(g) >= 2 && g.some((i) => !belegt.has(invoiceOf(i)))
    })
    .map((g) => own.filter((i) => g.includes(i)))
    .filter((g) => {
      if (g.some((i) => i.invoiceFile || (i.sourceId && receipted.has(i.sourceId)))) return true
      const before = previous.filter((p) => g.some((i) => sameCostCandidates([p], queryOf(i, at.previous)).length > 0))
      return before.length > 0 && invoiceCount(g) > invoiceCount(before)
    })
}

// Der gemerkte Umlageschlüssel (#141). Eine neue Position übernimmt den Schlüssel, den dieselbe
// Kostenart im Vorjahr desselben Objekts hatte, und weicht eine Position davon ab, sagt die
// Berechnung es. Beide Seiten brauchen dieselbe Antwort auf die Frage „ist das derselbe
// Schlüssel?“, sonst löste der Vorschlag der Oberfläche selbst den Hinweis der Berechnung aus.
// Deshalb steht die Regel hier und nicht zweimal.
//
// Eine eigene Staffel „Schlüssel je Kostenart ab Jahr“ gibt es bewusst nicht: Die Positionen des
// Vorjahres tragen den Schlüssel schon, und ein zweites Abbild davon liefe auseinander (siehe
// docs/superpowers/specs/2026-10-02-schluessel-merken-design.md).
import type { CostItem, CostKey, ExternalMeasure, MeterType } from './types.ts'

export type AllocatedItem = Pick<CostItem, 'year' | 'category' | 'key' | 'description'> &
  Partial<Pick<CostItem, 'meterType' | 'directUnitId' | 'customShares' | 'participantUnitIds' | 'externalBasis'>>

// Der Schlüssel einer Position mit genau den Angaben, die zu ihm gehören. Ein Zählertyp, der an
// einer Flächenposition stehengeblieben ist, gehört nicht dazu. Die Kosten der Gemeinschaft
// (`totalCents`) fehlen, weil sie eine Zahl des Jahres sind; Maßstab und Summe der Anteile
// beschreiben die Anlage und kommen mit.
export type Allocation = {
  key: CostKey
  meterType: MeterType | null
  directUnitId: string | null
  customShares: Record<string, number> | null
  participantUnitIds: string[] | null
  externalBasis: { measure: ExternalMeasure, total: number } | null
}

// Bei diesen Schlüsseln wirken Teilnehmer (#94); das Formular (client/src/costForm.ts) nimmt die
// Liste von hier.
export const PARTICIPANT_KEYS: readonly CostKey[] = ['area', 'units', 'persons', 'meter', 'external', 'amounts']

// Mit `basisUnitIds` (die Wohnungen der Abrechnungseinheit heute) zählen Teilnehmer und Anteile
// nur, soweit es die Wohnung dort noch gibt, und Teilnehmer, die heute alle Wohnungen sind, heißen
// „alle“, wie beim Speichern. Sonst hielte der Vergleich eine Position, die den Schlüssel des
// Vorjahres übernommen hat, für geändert, nur weil eine Wohnung inzwischen gelöscht oder
// herausgenommen ist (Befund der Durchsicht).
export function allocationOf(item: AllocatedItem, basisUnitIds?: readonly string[]): Allocation {
  const k = item.key
  const inBasis = (id: string) => !basisUnitIds || basisUnitIds.includes(id)
  const raw = PARTICIPANT_KEYS.includes(k) ? item.participantUnitIds ?? null : null
  const kept = raw ? raw.filter(inBasis) : null
  const participantUnitIds = kept && basisUnitIds && basisUnitIds.every((id) => kept.includes(id)) ? null : kept
  const shares = k === 'custom' ? item.customShares ?? null : null
  return {
    key: k,
    meterType: k === 'meter' ? item.meterType ?? null : null,
    directUnitId: k === 'direct' ? item.directUnitId ?? null : null,
    customShares: shares ? Object.fromEntries(Object.entries(shares).filter(([id]) => inBasis(id))) : null,
    participantUnitIds,
    externalBasis: k === 'external' && item.externalBasis ? { measure: item.externalBasis.measure, total: item.externalBasis.total } : null,
  }
}

// Dieselben Wohnungen, gleich in welcher Reihenfolge; `null` heißt alle.
export const sameUnits = (a: string[] | null, b: string[] | null): boolean =>
  a === null || b === null ? a === b : a.length === b.length && a.every((x) => b.includes(x))

// Anteile in Prozent, auf Hundertstel verglichen: So viele Stellen nimmt das Formular an.
const sameShares = (a: Record<string, number> | null, b: Record<string, number> | null): boolean => {
  if (a === null || b === null) return a === b
  const ids = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...ids].every((id) => Math.round((a[id] ?? 0) * 100) === Math.round((b[id] ?? 0) * 100))
}

// Derselbe Schlüssel? Die Summe der Anteile in der Anlage zählt nicht mit: Sie ist eine Angabe
// über die Gemeinschaft und kein Verteilungsmaßstab gegenüber dem Mieter.
export function sameAllocation(a: Allocation, b: Allocation): boolean {
  return a.key === b.key &&
    a.meterType === b.meterType &&
    a.directUnitId === b.directUnitId &&
    sameShares(a.customShares, b.customShares) &&
    sameUnits(a.participantUnitIds, b.participantUnitIds) &&
    (a.externalBasis?.measure ?? null) === (b.externalBasis?.measure ?? null)
}

// Die Positionen derselben Kostenart im Vorjahr. Vorjahr heißt das Jahr davor und kein früheres:
// Dieselbe Frage stellt der Hinweis der Berechnung, und § 556a BGB fragt von Abrechnungszeitraum
// zu Abrechnungszeitraum.
export function previousYearItems<T extends AllocatedItem>(items: readonly T[], category: string, year: number): T[] {
  return items.filter((i) => i.year === year - 1 && i.category === category)
}

// Kostenarten, unter denen ganz verschiedene Rechnungen stehen (Befund der Durchsicht): Die Wartung
// der Hebeanlage und die Reinigung der Dachrinne sind beide „Sonstige Betriebskosten“, haben aber
// nichts miteinander zu tun. Dort gilt nur eine Position mit derselben Beschreibung als Vorjahr.
export const BROAD_CATEGORIES: readonly string[] = ['Sonstige Betriebskosten']

// Die Jahreszahl des Vorjahres als ganzes Wort: „Grundsteuer 2025“ wird „Grundsteuer 2026“, eine
// Rechnungsnummer 120250 bleibt. Ohne Lookbehind, das ältere Browser nicht kennen.
export function replaceYear(text: string, from: number, to: number): string {
  return text.replace(new RegExp(`(^|\\D)${from}(?=\\D|$)`, 'g'), (_m, before: string) => `${before}${to}`)
}

const normalized = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

// Die Vorjahrespositionen, mit denen eine Position verglichen wird. Gibt es im Vorjahr eine mit
// derselben Beschreibung (Jahreszahl ersetzt, ohne Groß- und Kleinschreibung), nur diese; sonst
// alle der Kostenart, außer bei einer breiten Kostenart, wo es dann keine gibt.
export function comparablePrevious<T extends AllocatedItem>(items: readonly T[], category: string, year: number, description?: string): T[] {
  const prior = previousYearItems(items, category, year)
  if (description?.trim()) {
    const wanted = normalized(description)
    const same = prior.filter((p) => normalized(replaceYear(p.description, year - 1, year)) === wanted)
    if (same.length > 0) return same
  }
  return BROAD_CATEGORIES.includes(category) ? [] : prior
}

// Der Schlüssel, den eine neue Position dieser Kostenart vorgeschlagen bekommt, oder `null`.
// Widersprechen sich die Positionen des Vorjahres, gibt es keinen Vorschlag: Welcher gemeint ist,
// weiß nur der Vermieter. Sonst gilt die zuletzt angelegte (Reihenfolge der Liste), damit eine
// geänderte Summe der Anlage mitkommt.
export function previousAllocation(items: readonly AllocatedItem[], category: string, year: number, description?: string): Allocation | null {
  const found = comparablePrevious(items, category, year, description).map((i) => allocationOf(i))
  const last = found.at(-1)
  if (!last) return null
  return found.every((a) => sameAllocation(a, last)) ? last : null
}

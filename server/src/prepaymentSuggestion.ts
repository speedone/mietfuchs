// Vorschlag nach § 560 Abs. 4 BGB im Rumpfzeitraum (#208, Entwurf 3.7).
//
// Angemessen ist eine Vorauszahlung in Höhe der voraussichtlichen Kosten, auf Grundlage der letzten
// Abrechnung; ein abstrakter Zuschlag ist unzulässig (BGH VIII ZR 294/10). Nach einem vollen
// Zeitraum sind das dessen Kosten. Nach einem Rumpf muss hochgerechnet werden, und zwar je Position
// verschieden: Vier Wintermonate Heizung auf zwölf Monate nach Tagen ergäben fast das Dreifache.
// Diese Datei rechnet je Position den Faktor vom Betrag im Rumpf zum Jahresbetrag; calc.ts
// multipliziert ihn mit dem Anteil des Mieters.
//
// - Kalte Kosten (nach 3.4 auf den Rumpf geteilt): nach Tagen.
// - Brennstoff (`heating_part = 'fuel'`) mit Leistungszeitraum, eine Verbrauchsrechnung: Σ der
//   Beträge geteilt durch den Gradtagsanteil der Vereinigung ihrer Leistungszeiträume (C5, D3).
//   Genau zwölf Monate ergeben 1.000 ‰ und damit den Jahresbetrag. Mehrere Rechnungen werden nicht
//   einzeln hochgerechnet und addiert.
// - Brennstoff ohne Leistungszeitraum ist eine Lieferung (Öl, Flüssiggas, Pellets) und kein
//   Verbrauch: dann gilt die letzte volle Periode, sonst gibt es keinen Vorschlag (B4).
// - Feste Heizpositionen (Wartung, Messdienst, Grundpreis) nach den Tagen ihres Leistungszeitraums
//   auf zwölf Monate; Positionen derselben Art über die Vereinigung ihrer Leistungszeiträume (A11,
//   D3). Ohne Leistungszeitraum die letzte volle Periode, sonst kein Vorschlag für diese Position.
//
// Fehlt für den Brennstoff ein Faktor, gibt es keinen Vorschlag (R11): Der Rest ohne Brennstoff wäre
// zu niedrig. Ist keine Heizposition als Brennstoff gekennzeichnet, ebenso (D-R5): Welche Position
// Verbrauch ist, weiß Mietfuchs dann nicht.

import { degreeDayPermille, unionDays, unionOf, yearDaysFrom, type DayRange } from '../../shared/degreeDays.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import type { DegreeDayTable } from '../../shared/law/heizkostenv.ts'
import type { BillingPeriod } from '../../shared/types.ts'
import type { SnapshotCostItem } from './snapshot.ts'

export type AnnualBasis =
  // `annualAssumed`: kalte Positionen ohne Leistungszeitraum, als Jahresbetrag genommen (M3).
  | { ok: true; factors: Map<string, number>; annualAssumed: string[] }
  | { ok: false; reason: 'unmarked' | 'delivery'; costItemId: string }

type Previous = { period: BillingPeriod; items: readonly SnapshotCostItem[] }

const rangeOf = (c: SnapshotCostItem): DayRange | null =>
  c.serviceFrom !== undefined && c.serviceTo !== undefined ? { from: c.serviceFrom, to: c.serviceTo } : null
const sum = (items: readonly SnapshotCostItem[]): number => items.reduce((a, c) => a + c.amountCents, 0)

// Positionen derselben Art (D3): gleicher Teil der Heizkosten, sonst gleiche Kostenart und
// Beschreibung, ohne Jahreszahl und ohne Groß- und Kleinschreibung („Wartung 2024“ ist im Folgejahr
// „Wartung 2025“).
const kindOf = (c: SnapshotCostItem): string =>
  c.heatingPart !== undefined ? `part:${c.heatingPart}` : `${c.category}|${c.description.replace(/\b(19|20)\d{2}\b/g, '').replace(/\s+/g, ' ').trim().toLowerCase()}`

// Faktor aus der letzten vollen Periode: deren Summe derselben Positionen, geteilt durch die jetzige.
function fromPrevious(now: readonly SnapshotCostItem[], previous: Previous | null, same: (c: SnapshotCostItem) => boolean): number | null {
  if (previous === null || previous.period.short) return null
  const before = previous.items.filter(same)
  const current = sum(now)
  if (before.length === 0 || current === 0) return null
  return sum(before) / current
}

export function annualFactors(
  period: BillingPeriod,
  items: readonly SnapshotCostItem[],
  previous: Previous | null,
  degreeDays: () => DegreeDayTable,
): AnnualBasis {
  const factors = new Map<string, number>()
  const heating = items.filter((c) => c.category === HEATING_CATEGORY)
  // Kalte Kosten (Durchsicht von #226, M3): nach den Tagen ihres Leistungszeitraums, die im Rumpf
  // liegen, gleichartige über die Vereinigung (wie D3). Eine Aprilrechnung steht für 30 Tage und
  // nicht für die 120 des Rumpfs; zwei Rechnungen derselben Art für Januar/Februar und März/April
  // zusammen für 120 Tage und nicht je für ein Jahr. Ohne Leistungszeitraum weiß Mietfuchs nicht,
  // welchen Teil des Jahres die Rechnung abdeckt, und nimmt sie als Jahresbetrag (Hinweis in calc.ts).
  const annualAssumed: string[] = []
  const coldGroups = new Map<string, { item: SnapshotCostItem; range: DayRange }[]>()
  for (const c of items) {
    if (c.category === HEATING_CATEGORY) continue
    const r = rangeOf(c)
    const own = r === null ? null : { from: r.from > period.from ? r.from : period.from, to: r.to < period.to ? r.to : period.to }
    if (own === null || own.from > own.to) {
      // Ein Leistungszeitraum ganz außerhalb ist ein Fehler der Zuordnung (`period.item-outside`);
      // auch dann gilt der Betrag als Jahresbetrag.
      factors.set(c.id, 1)
      if (r === null) annualAssumed.push(c.id)
      continue
    }
    coldGroups.set(kindOf(c), [...(coldGroups.get(kindOf(c)) ?? []), { item: c, range: own }])
  }
  for (const group of coldGroups.values()) {
    const union = unionOf(group.map((g) => g.range))
    const factor = yearDaysFrom(union[0]?.from ?? period.from) / unionDays(union)
    for (const g of group) factors.set(g.item.id, factor)
  }
  if (heating.length === 0) return { ok: true, factors, annualAssumed }

  const fuel = heating.filter((c) => c.heatingPart === 'fuel')
  const first = heating[0]
  if (fuel.length === 0) return { ok: false, reason: 'unmarked', costItemId: first?.id ?? '' }
  const ranges = fuel.map(rangeOf)
  let fuelFactor: number | null
  if (ranges.every((r): r is DayRange => r !== null)) {
    const permille = degreeDayPermille(ranges, degreeDays())
    fuelFactor = permille > 0 ? 1000 / permille : null
  } else {
    fuelFactor = fromPrevious(fuel, previous, (c) => c.category === HEATING_CATEGORY && c.heatingPart === 'fuel')
  }
  if (fuelFactor === null) {
    const delivery = fuel.find((c) => rangeOf(c) === null) ?? fuel[0]
    return { ok: false, reason: 'delivery', costItemId: delivery?.id ?? '' }
  }
  for (const c of fuel) factors.set(c.id, fuelFactor)

  const groups = new Map<string, SnapshotCostItem[]>()
  for (const c of heating) {
    if (c.heatingPart === 'fuel') continue
    groups.set(kindOf(c), [...(groups.get(kindOf(c)) ?? []), c])
  }
  for (const [kind, group] of groups) {
    const groupRanges = group.map(rangeOf)
    let factor: number
    if (groupRanges.every((r): r is DayRange => r !== null)) {
      const union = unionOf(groupRanges)
      factor = yearDaysFrom(union[0]?.from ?? period.from) / unionDays(union)
    } else {
      factor = fromPrevious(group, previous, (c) => c.category === HEATING_CATEGORY && kindOf(c) === kind) ?? 0
    }
    for (const c of group) factors.set(c.id, factor)
  }
  return { ok: true, factors, annualAssumed }
}

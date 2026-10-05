// Zu welcher Abrechnung eine Kostenposition gehört (Sichtprüfung E32, E45, E48), ohne DOM prüfbar.
//
// Eine Position trägt den Schlüssel ihres Zeitraums. Bei einer Heizanlage mit eigener Heizperiode ist
// das der Schlüssel der **Heizperiode** (Entwurf 3.0, G-A2), etwa '2024-05' für Mai 2024 bis April
// 2025. Abgerechnet wird sie im Abrechnungszeitraum des Objekts, der ihr Ende enthält (BGH VIII ZR
// 240/07), nach Weg d in einer eigenen Heizkostenabrechnung, die ebenfalls zu diesem Zeitraum gehört
// (`heatingChoices`). Wer Positionen nach `period` gruppiert, bekommt deshalb „2023-05“ und „2024-05“
// als eigene Jahre, und die Heizkosten fehlen im Jahr ihrer Abrechnung. Die Seite Kosten rechnet
// dasselbe über `itemsOfPeriod`; die übrigen Seiten fragen hier.
import { settlementKeyOf } from '../../shared/heatingPeriod.ts'
import { CALENDAR_RULES, periodContaining, periodLabel, periodOfKey } from '../../shared/period.ts'
import type { HeatingPlant, HeatingSettlementInfo, NoticeSubject, PeriodKey, PeriodRules } from './types'

export type PlantPeriods = Pick<HeatingPlant, 'id' | 'periodStartMonth' | 'periodChanges' | 'separateSpans'> & Partial<Pick<HeatingPlant, 'name'>>
type Positioned = { period: PeriodKey; heatingPlantId?: string | null }

// Die Regel selbst steht in shared/heatingPeriod.ts, weil die Berechnung sie für den Vergleich mit
// dem Vorjahr ebenso braucht.
export { settlementKeyOf }

export function itemsOfSettlement<T extends Positioned>(items: readonly T[], key: PeriodKey, objectRules: PeriodRules, plants: readonly PlantPeriods[]): T[] {
  return items.filter((c) => settlementKeyOf(c, objectRules, plants).key === key)
}

// Der Belegordner gliedert nach dem Jahr der Abrechnung (E32). Er bekommt die Positionen mit dem
// Schlüssel ihrer Abrechnung, sonst stünde die Heizrechnung Mai 2024 bis April 2025 im Ordner 2024,
// fehlte in Belegabdeckung und Belegmappe 2025 und die Abrechnung 2025 führte sie doch. Nur zum
// Ordnen und Anzeigen: Geschrieben wird eine Position nie mit diesem Schlüssel.
export function filedUnderSettlement<T extends Positioned & { propertyId: string }>(
  items: readonly T[], rulesOf: (propertyId: string) => PeriodRules, plantsOf: (propertyId: string) => readonly PlantPeriods[],
): T[] {
  return items.map((c) => {
    const { key } = settlementKeyOf(c, rulesOf(c.propertyId), plantsOf(c.propertyId))
    return key === c.period ? c : { ...c, period: key }
  })
}

export type PeriodCosts = {
  key: PeriodKey
  label: string
  totalCents: number
  // Davon in einer eigenen Heizkostenabrechnung (Weg d): Die Betriebskostenabrechnung führt sie nicht.
  separateCents: number
  byCategory: Map<string, number>
}

// Die Kosten je Abrechnungszeitraum für den Kostenvergleich (E48), in zeitlicher Reihenfolge.
export function periodCosts(items: readonly (Positioned & { category: string; amountCents: number })[], objectRules: PeriodRules, plants: readonly PlantPeriods[]): PeriodCosts[] {
  const rows = new Map<PeriodKey, PeriodCosts>()
  for (const c of items) {
    const { key, separate } = settlementKeyOf(c, objectRules, plants)
    let row = rows.get(key)
    if (!row) {
      const p = periodOfKey(objectRules, key)
      row = { key, label: p ? periodLabel(p) : key, totalCents: 0, separateCents: 0, byCategory: new Map() }
      rows.set(key, row)
    }
    row.totalCents += c.amountCents
    if (separate) row.separateCents += c.amountCents
    row.byCategory.set(c.category, (row.byCategory.get(c.category) ?? 0) + c.amountCents)
  }
  return [...rows.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

// Die Belegkopien zu einer Abrechnung, in der Reihenfolge der erfassten Positionen und ohne Doppelte:
// die Belege der Positionen, die auf dem Papier stehen. Vorher galt `period` gleich dem Zeitraum, und
// die Heizrechnung einer eigenen Heizperiode fehlte unter den Anlagen, obwohl ihre Kosten dastanden.
// Eine Position über 0 € hat keine Zeile auf dem Papier; ihr Beleg gehört trotzdem dazu, wenn sie zu
// dieser Abrechnung gehört (Durchsicht N3).
export function settledInvoiceFiles(
  s: {
    statements: readonly { rows: readonly { costItemId: string }[] }[]
    landlord: { rows: readonly { costItemId: string }[] }
    period?: { key: PeriodKey }
    scope?: { kind: string; plantId?: string } | null
  },
  items: readonly { id: string; invoiceFile?: string; amountCents?: number; period?: PeriodKey; heatingPlantId?: string | null }[],
  objectRules: PeriodRules = CALENDAR_RULES,
  plants: readonly PlantPeriods[] = [],
): string[] {
  const ids = new Set([...s.statements.flatMap((st) => st.rows), ...s.landlord.rows].map((r) => r.costItemId))
  const zeroHere = (c: (typeof items)[number]): boolean => {
    if (c.amountCents !== 0 || c.period === undefined || s.period === undefined) return false
    if (s.scope?.kind === 'heating') return c.heatingPlantId === s.scope.plantId && c.period === s.period.key
    const k = settlementKeyOf({ period: c.period, heatingPlantId: c.heatingPlantId ?? null }, objectRules, plants)
    return k.key === s.period.key && !k.separate
  }
  return [...new Set(items.filter((c) => (ids.has(c.id) || zeroHere(c)) && c.invoiceFile).map((c) => c.invoiceFile as string))]
}

// Welche Abrechnung sagt, ob die Position abgeschlossen ist (Durchsicht N2): nach Weg d die
// Heizkostenabrechnung ihrer Heizperiode, sonst die Abrechnung des Zeitraums, zu dem sie gehört.
export function closedCheckPath(item: { period: PeriodKey; heatingPlantId?: string | null }, objectRules: PeriodRules, plants: readonly PlantPeriods[]): string {
  const k = settlementKeyOf(item, objectRules, plants)
  return k.separate && item.heatingPlantId ? `/api/heating-settlement/${item.heatingPlantId}/${item.period}` : `/api/settlement/${k.key}`
}

// „Zur Abrechnung →“ an einer Heizkostenabrechnung im Cockpit (E45): Sie steht im Zeitraum, in dem
// ihre Heizperiode endet, und dort unter ihrem eigenen Reiter. Der Link wechselt in diesen Zeitraum und
// wählt sie aus; vorher führte er in den gewählten Zeitraum, in dem sie nicht wählbar war.
export function heatingRowTarget(h: Pick<HeatingSettlementInfo, 'plantId' | 'period'>, objectRules: PeriodRules): { period: PeriodKey; focus: NoticeSubject } {
  return { period: periodContaining(objectRules, h.period.to).key, focus: { kind: 'heatingSettlement', id: `${h.plantId}|${h.period.key}` } }
}

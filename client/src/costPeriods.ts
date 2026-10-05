// Zu welcher Abrechnung eine Kostenposition gehört (Sichtprüfung E32, E45, E48), ohne DOM prüfbar.
//
// Eine Position trägt den Schlüssel ihres Zeitraums. Bei einer Heizanlage mit eigener Heizperiode ist
// das der Schlüssel der **Heizperiode** (Entwurf 3.0, G-A2), etwa '2024-05' für Mai 2024 bis April
// 2025. Abgerechnet wird sie im Abrechnungszeitraum des Objekts, der ihr Ende enthält (BGH VIII ZR
// 240/07), nach Weg d in einer eigenen Heizkostenabrechnung, die ebenfalls zu diesem Zeitraum gehört
// (`heatingChoices`). Wer Positionen nach `period` gruppiert, bekommt deshalb „2023-05“ und „2024-05“
// als eigene Jahre, und die Heizkosten fehlen im Jahr ihrer Abrechnung. Die Seite Kosten rechnet
// dasselbe über `itemsOfPeriod`; die übrigen Seiten fragen hier.
import { hasOwnRhythm, plantRules, settledSeparately } from '../../shared/heatingPeriod.ts'
import { periodContaining, periodLabel, periodOfKey } from '../../shared/period.ts'
import type { HeatingPlant, HeatingSettlementInfo, NoticeSubject, PeriodKey, PeriodRules } from './types'

export type PlantPeriods = Pick<HeatingPlant, 'id' | 'periodStartMonth' | 'periodChanges' | 'separateSpans'>
type Positioned = { period: PeriodKey; heatingPlantId?: string | null }

// Der Schlüssel des Abrechnungszeitraums P und ob die Position nach Weg d in einer eigenen
// Heizkostenabrechnung steht. Ohne geladene Anlagen bleibt es beim Schlüssel der Position.
export function settlementKeyOf(item: Positioned, objectRules: PeriodRules, plants: readonly PlantPeriods[]): { key: PeriodKey; separate: boolean } {
  const plant = item.heatingPlantId ? plants.find((p) => p.id === item.heatingPlantId) : undefined
  if (!plant || !hasOwnRhythm(plant)) return { key: item.period, separate: false }
  const h = periodOfKey(plantRules(plant, objectRules), item.period)
  if (h === null) return { key: item.period, separate: false }
  return { key: periodContaining(objectRules, h.to).key, separate: settledSeparately(plant, objectRules, h) }
}

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
export function settledInvoiceFiles(
  s: { statements: readonly { rows: readonly { costItemId: string }[] }[]; landlord: { rows: readonly { costItemId: string }[] } },
  items: readonly { id: string; invoiceFile?: string }[],
): string[] {
  const ids = new Set([...s.statements.flatMap((st) => st.rows), ...s.landlord.rows].map((r) => r.costItemId))
  return [...new Set(items.filter((c) => ids.has(c.id) && c.invoiceFile).map((c) => c.invoiceFile as string))]
}

// „Zur Abrechnung →“ an einer Heizkostenabrechnung im Cockpit (E45): Sie steht im Zeitraum, in dem
// ihre Heizperiode endet, und dort unter ihrem eigenen Reiter. Der Link wechselt in diesen Zeitraum und
// wählt sie aus; vorher führte er in den gewählten Zeitraum, in dem sie nicht wählbar war.
export function heatingRowTarget(h: Pick<HeatingSettlementInfo, 'plantId' | 'period'>, objectRules: PeriodRules): { period: PeriodKey; focus: NoticeSubject } {
  return { period: periodContaining(objectRules, h.period.to).key, focus: { kind: 'heatingSettlement', id: `${h.plantId}|${h.period.key}` } }
}

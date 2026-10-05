// Eine kalte Rechnung über mehrere Abrechnungszeiträume, nach Tagen geteilt (#208, Entwurf 3.4).
//
// Mietfuchs wendet für kalte Betriebskosten das Leistungsprinzip an: Eine Rechnung gehört anteilig
// in jeden Zeitraum, in dem die Leistung erbracht wurde. Das Abflussprinzip wäre ebenfalls zulässig
// (BGH VIII ZR 49/07), wird aber nicht angeboten, denn Positionen tragen kein Zahlungsdatum. Für
// Heizung und Warmwasser gilt das nicht (VIII ZR 156/11): Sie werden nie nach Tagen geteilt.
//
// Die Restcent verteilt `largestRemainder`, der Entscheid ist die Kennung der Rechnung mit dem
// Schlüssel des Zeitraums; der §35a-Lohnanteil folgt demselben Verhältnis. Eine Gutschrift wird mit
// ihrem Betrag geteilt und behält in jedem Teil ihr Vorzeichen. Dieselbe Regel nutzen das Speichern
// (repository.ts) und der Wechsel des Rhythmus (db/periodChange.ts).

import { largestRemainder } from './calc.ts'
import { formatDayRange, periodsBetween } from '../../shared/period.ts'
import type { BillingPeriod, PeriodRules } from '../../shared/types.ts'

export type ServicePart = { period: BillingPeriod; days: number; amountCents: number; labor35aCents: number | null; description: string }

type SplitItem = { id: string; description: string; amountCents: number; labor35aCents?: number; serviceFrom: string; serviceTo: string }

const MS_DAY = 86400000
const days = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_DAY) + 1

const SUFFIX = / \(anteilig [^)]*\)$/

// Die Beschreibung ohne den Zusatz eines früheren Aufteilens.
export const baseDescription = (description: string): string => description.replace(SUFFIX, '')

// Ein Betrag auf die Tage verteilt; ein negativer mit seinem Betrag und danach mit Vorzeichen.
function byDays(total: number, weights: number[], keys: string[]): number[] {
  const sum = weights.reduce((a, w) => a + w, 0)
  const sign = total < 0 ? -1 : 1
  const abs = Math.abs(total)
  return largestRemainder(abs, weights.map((w) => (abs * w) / sum), keys).map((c) => sign * c || 0)
}

export function splitByService(rules: PeriodRules, item: SplitItem): ServicePart[] {
  const periods = periodsBetween(rules, item.serviceFrom, item.serviceTo)
  const spans = periods.map((p) => ({ from: p.from > item.serviceFrom ? p.from : item.serviceFrom, to: p.to < item.serviceTo ? p.to : item.serviceTo }))
  const weights = spans.map((s) => days(s.from, s.to))
  const keys = periods.map((p) => `${item.id}|${p.key}`)
  const amounts = byDays(item.amountCents, weights, keys)
  // §35a nur an einer Rechnung, nicht an einer Gutschrift (amountProblem in shared/costItem.ts).
  const labor = item.labor35aCents && item.amountCents > 0 ? byDays(item.labor35aCents, weights, keys) : null
  const base = baseDescription(item.description)
  return periods.map((period, i) => {
    const span = spans[i] ?? { from: period.from, to: period.to }
    return {
      period,
      days: weights[i] ?? 0,
      amountCents: amounts[i] ?? 0,
      labor35aCents: labor ? labor[i] ?? 0 : null,
      description: periods.length > 1 ? `${base} (anteilig ${formatDayRange(span.from, span.to)})` : item.description,
    }
  })
}

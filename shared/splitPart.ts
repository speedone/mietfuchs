import { HEATING_CATEGORY } from './heating.ts'
import { periodsBetween } from './period.ts'
import type { CostItem, PeriodRules } from './types.ts'

// Ein Teil einer aufgeteilten Rechnung (#208): eine kalte Position, deren Leistungszeitraum mehr
// als einen Zeitraum des Objekts berührt. Anders entsteht so eine Position nicht, denn das
// gewöhnliche Speichern lehnt sie ab; sie kommt aus dem Aufteilen beim Speichern oder dem Wechsel des
// Rhythmus, und jeder Teil trägt den ganzen Leistungszeitraum der Rechnung. In shared/, weil auch die
// Belegbuchung (bookingPlan.ts, assessment.ts) danach fragt und deren Test im Browser läuft.
export function isSplitPart(rules: PeriodRules, c: Pick<CostItem, 'category' | 'serviceFrom' | 'serviceTo'>): boolean {
  if (c.category === HEATING_CATEGORY || c.serviceFrom === undefined || c.serviceTo === undefined || c.serviceFrom > c.serviceTo) return false
  return periodsBetween(rules, c.serviceFrom, c.serviceTo).length > 1
}

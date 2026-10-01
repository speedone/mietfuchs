// Die Ampel „Zählerstände“ im Cockpit, ohne DOM prüfbar.
import type { CostItem, Meter, MeterType, Unit } from './types'
import { heatingNotByConsumption } from '../../shared/heating.ts'

// Verbrauchsangaben des Servers je Zähler (gleiche Form wie auf der Zähler-Seite)
export type MeterConsumption = { meterId: string; readingCount: number; warnings: string[] }

// Welche Zähler für die verbrauchsabhängige Umlage zählen und welchen davon Anfang oder Ende
// fehlt oder deren Stände unplausibel sind.
export function meterReadiness(
  meters: Meter[],
  consumption: MeterConsumption[],
  meterTypes: ReadonlySet<MeterType | null | undefined>,
): { relevant: Meter[], incomplete: Meter[] } {
  // Der Hauptzähler (ohne Wohnung) zählt mit (#136): Seit #116 kann er die Verteilbasis sein, und
  // fehlt dann sein Endstand, stimmt die Abrechnung nicht, obwohl alle Wohnungszähler vollständig sind.
  const relevant = meters.filter((m) => meterTypes.has(m.type))
  const incomplete = relevant.filter((m) => {
    const c = consumption.find((x) => x.meterId === m.id)
    return !c || c.readingCount < 2 || c.warnings.length > 0
  })
  return { relevant, incomplete }
}

// Positionen „Heizung und Warmwasser“ ohne Verbrauchsschlüssel (#140), außer in der Ausnahme des
// § 2 HeizkostenV. Für sie sind Ablesungen sehr wohl nötig: Die Verordnung verlangt eine
// Verteilung nach Verbrauch, sonst darf der Mieter um 15 % kürzen. Die Regel steht in
// shared/heating.ts, dieselbe wie in der Berechnung.
export function heatingWithoutConsumption(items: CostItem[], units: Unit[]): CostItem[] {
  return heatingNotByConsumption(items, units)
}

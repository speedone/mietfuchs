// Die Ampel „Zählerstände“ im Cockpit, ohne DOM prüfbar.
import type { Meter, MeterType } from './types'

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

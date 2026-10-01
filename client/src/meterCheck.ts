// Die Ampel „Zählerstände“ im Cockpit, ohne DOM prüfbar.
import type { Meter, MeterType, Notice } from './types'

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

// Positionen „Heizung und Warmwasser“, bei denen ein Mieter mangels Verbrauchsanteil kürzen darf
// (#140). Für sie sind Ablesungen sehr wohl nötig. Gelesen wird der Hinweis der Berechnung und
// nicht noch einmal die Regel angewendet: Sie hängt an Teilnehmern, Mischfällen und der Frage, was
// nach § 2 HeizkostenV als Wohnung zählt (shared/heating.ts), und zweimal hingeschrieben sagten
// Cockpit und Abrechnung irgendwann Verschiedenes. Eine Abrechnung ohne Hinweise (vor #112
// abgeschlossen) ergibt eine leere Liste.
export function heatingWithoutConsumption(settlement: { notices?: Notice[] }): string[] {
  return (settlement.notices ?? [])
    .filter((n) => n.code === 'heating.not-by-consumption' && n.subject?.kind === 'costItem')
    .map((n) => n.subject?.id ?? '')
}

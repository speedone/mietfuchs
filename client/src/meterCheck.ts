// Die Ampel „Zählerstände“ im Cockpit, ohne DOM prüfbar.
import type { Meter, MeterType, Notice } from './types'
import { andList } from '../../shared/wording.ts'

// Verbrauchsangaben des Servers je Zähler (gleiche Form wie auf der Zähler-Seite). `notices` trägt dieselben
// Meldungen wie `warnings` mit Code; ein älterer Server schickt sie nicht.
export type MeterConsumption = { meterId: string; readingCount: number; warnings: string[]; notices?: Notice[] }

// Die abgelaufene Eichfrist (Heizung PR 21) ist eine Warnung und keine Sperre: Mietfuchs rechnet mit den
// Werten, und die Stände sind vollständig. Sie macht einen Zähler deshalb nicht unvollständig, sondern hat im
// Cockpit eine eigene gelbe Zeile (Prüfung des Plans, M1).
const CALIBRATION_CODE = 'meter.calibration-overdue'
const readingProblems = (c: MeterConsumption): number =>
  c.notices ? c.notices.filter((n) => n.code !== CALIBRATION_CODE).length : c.warnings.length

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
    return !c || c.readingCount < 2 || readingProblems(c) > 0
  })
  return { relevant, incomplete }
}

// Zähler, deren Eichfrist laut Angabe des Vermieters vor einer Ablesung des Zeitraums abgelaufen ist.
export function overdueMeters(meters: Meter[], consumption: MeterConsumption[]): Meter[] {
  const ids = new Set(consumption.filter((c) => (c.notices ?? []).some((n) => n.code === CALIBRATION_CODE)).map((c) => c.meterId))
  return meters.filter((m) => ids.has(m.id))
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

// Der Text der Cockpit-Zeile „Eichfrist“ (Heizung PR 21): eine Warnung zum Prüfen, kein sicherer Fehler, denn
// eine Verlängerung im Stichprobenverfahren (§ 35 MessEV) ist am Zähler nicht zu sehen.
export function calibrationDetail(overdue: Meter[]): string {
  return `Eichfrist abgelaufen bei: ${andList(overdue.map((m) => m.name))}. Mietfuchs rechnet mit den Werten; bestreitet ein Mieter sie, müssen Sie beweisen, dass sie stimmen. ` +
    'Hat der Messdienst die Frist im Stichprobenverfahren verlängern lassen, tragen Sie das verlängerte Jahr am Zähler ein.'
}

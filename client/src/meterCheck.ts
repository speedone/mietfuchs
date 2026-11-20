// Die Ampel „Zählerstände“ im Cockpit, ohne DOM prüfbar.
import type { Meter, MeterType, Notice } from './types'
import { andList } from '../../shared/wording.ts'

// Verbrauchsangaben des Servers je Zähler (gleiche Form wie auf der Zähler-Seite). `notices` trägt dieselben
// Meldungen wie `warnings` mit Code; ein älterer Server schickt sie nicht.
// `periodCovered`: Decken Ablesungen den gewählten Zeitraum (Regel des Servers, `readingsCoverPeriod` in calc.ts)?
// `readingCount` zählt alle Ablesungen aller Jahre und sagt das ab dem zweiten Jahr nicht mehr; es gilt nur noch,
// wenn ein älterer Server das Feld nicht schickt.
// `periodGap`: die Tage ohne Ablesung, `lastReadingOn`: die jüngste Ablesung überhaupt (beides für den Satz im Cockpit).
export type MeterConsumption = { meterId: string; readingCount: number; periodCovered?: boolean; periodGap?: { from: string; to: string } | null; lastReadingOn?: string | null; warnings: string[]; notices?: Notice[] }
const uncovered = (c: MeterConsumption): boolean => (c.periodCovered === undefined ? c.readingCount < 2 : !c.periodCovered)

// Die abgelaufene Eichfrist (Heizung PR 21) ist eine Warnung und keine Sperre: Mietfuchs rechnet mit den
// Werten, und die Stände sind vollständig. Sie macht einen Zähler deshalb nicht unvollständig, sondern hat im
// Cockpit eine eigene gelbe Zeile (Prüfung des Plans, M1).
// Ob eine Meldung die Stände fraglich macht, sagt ihre Stufe (Browserprüfung 0.16.0, M1): Ein Hinweis wie die
// geschätzte Ablesung (#98) nennt nur etwas, Anfang und Ende sind da. Warnungen und Fehler zu den Ständen (negativer
// Verbrauch, zwei Ablesungen am selben Tag, Wechsel ohne Endstand) verschieben Geld zwischen Mietern und bleiben rot.
const CALIBRATION_CODE = 'meter.calibration-overdue'
const readingProblems = (c: MeterConsumption): number =>
  c.notices
    ? c.notices.filter((n) => (n.level === 'warning' || n.level === 'error') && n.code !== CALIBRATION_CODE).length
    : c.warnings.length

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
    return !c || uncovered(c) || readingProblems(c) > 0
  })
  return { relevant, incomplete }
}

// Ein Datum deutsch, aus der Zeichenkette gebaut, damit keine Zeitzone einen Tag verschiebt.
const day = (iso: string): string => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
const nextDay = (iso: string): string => new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) + 1)).toISOString().slice(0, 10)

// Der Text der roten Cockpit-Zeile „Zählerstände“: je Zähler die Tage ohne Ablesung, wenn der Server sie nennt. Liegt
// die letzte Ablesung länger zurück als der Beginn der Lücke, ist der Zähler vielleicht ausgebaut; dann nennt ein Satz,
// was die Seite Zähler dafür anbietet (den Tausch als Zählerwechsel an der Ablesung oder das Löschen des Zählers,
// mehr gibt es nicht: ein Feld „ausgebaut am“ kennt das Modell nicht).
export function incompleteDetail(incomplete: Meter[], consumption: MeterConsumption[]): string {
  const of = (m: Meter) => consumption.find((x) => x.meterId === m.id)
  const names = incomplete.map((m) => {
    const gap = of(m)?.periodGap
    return gap ? `${m.name} (ohne Ablesung vom ${day(gap.from)} bis ${day(gap.to)})` : m.name
  })
  const idle = incomplete.flatMap((m) => {
    const c = of(m)
    const last = c?.lastReadingOn
    return c?.periodGap && last && nextDay(last) < c.periodGap.from ? [`${m.name} (zuletzt abgelesen am ${day(last)})`] : []
  })
  const removed = idle.length === 0 ? '' :
    ` Schon länger nicht abgelesen: ${andList(idle)}. Wurde ein solcher Zähler getauscht, erfassen Sie die erste Ablesung des neuen Geräts als Zählerwechsel; gibt es ihn nicht mehr, können Sie ihn auf der Seite Zähler löschen, dabei werden auch seine Ablesungen gelöscht.`
  return `Anfang/Ende fehlt oder unplausibel bei: ${andList(names)}${removed ? '.' : ''}${removed}`
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

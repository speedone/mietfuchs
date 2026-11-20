// Die Ampel „Zählerstände“ im Cockpit, ohne DOM prüfbar.
import type { Meter, MeterType, Notice } from './types'
import { andList } from '../../shared/wording.ts'

// Verbrauchsangaben des Servers je Zähler (gleiche Form wie auf der Zähler-Seite). `notices` trägt dieselben
// Meldungen wie `warnings` mit Code; ein älterer Server schickt sie nicht.
// `periodCovered`: Decken Ablesungen den gewählten Zeitraum (Regel des Servers, `readingsCoverPeriod` in calc.ts)?
// `readingCount` zählt alle Ablesungen aller Jahre und sagt das ab dem zweiten Jahr nicht mehr; es gilt nur noch,
// wenn ein älterer Server das Feld nicht schickt.
// `periodGap`: die Tage ohne Ablesung; `periodSlack`: Tage am Rand, die fehlen, aber im Spielraum des Servers liegen;
// `lastReadingOn`: die jüngste Ablesung überhaupt; `longUnread`: sie liegt weiter als der Spielraum vor dem Zeitraum.
type Span = { from: string; to: string }
export type MeterConsumption = { meterId: string; readingCount: number; periodCovered?: boolean; periodGap?: Span | null; periodSlack?: Span[]; lastReadingOn?: string | null; longUnread?: boolean; warnings: string[]; notices?: Notice[] }
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
const utc = (iso: string): number => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))
const daysIn = (s: Span): number => Math.round((utc(s.to) - utc(s.from)) / 86400000) + 1

// Der Text der roten Cockpit-Zeile „Zählerstände“: je Zähler die Tage ohne Ablesung, wenn der Server sie nennt. Sagt
// der Server, dass ein Zähler schon vor dem Zeitraum länger nicht abgelesen wurde (`longUnread`), nennt ein Satz den
// Tag und den Weg für einen getauschten Zähler. **Zum Löschen rät die Zeile nie** (Durchsicht): Mit dem Zähler gingen
// seine Ablesungen, und eine offene Abrechnung früherer Jahre rechnete die Wohnung dann ohne Zähler.
export function incompleteDetail(incomplete: Meter[], consumption: MeterConsumption[]): string {
  const of = (m: Meter) => consumption.find((x) => x.meterId === m.id)
  const names = incomplete.map((m) => {
    const gap = of(m)?.periodGap
    return gap ? `${m.name} (ohne Ablesung vom ${day(gap.from)} bis ${day(gap.to)})` : m.name
  })
  const idle = incomplete.flatMap((m) => {
    const c = of(m)
    return c?.longUnread && c.lastReadingOn ? [`${m.name} (zuletzt abgelesen am ${day(c.lastReadingOn)})`] : []
  })
  const list = `Anfang/Ende fehlt oder unplausibel bei: ${andList(names)}`
  return idle.length === 0 ? list
    : `${list}. Schon länger nicht abgelesen: ${andList(idle)}. Wurde ein solcher Zähler getauscht, erfassen Sie die erste Ablesung des neuen Geräts als Zählerwechsel.`
}

// Ruhiger Zusatz der grünen Zeile: Tage am Rand des Zeitraums, die keine Ablesung deckt und die der Server hinnimmt.
// Die Abrechnung rechnet diese Tage nicht mit; wer es weiß, kann den Stand zum Stichtag nachtragen.
export function slackDetail(relevant: Meter[], consumption: MeterConsumption[]): string {
  const parts = relevant.flatMap((m) => (consumption.find((x) => x.meterId === m.id)?.periodSlack ?? []).map((s) => {
    const n = daysIn(s)
    return `${m.name} vom ${day(s.from)} bis ${day(s.to)} (${n} ${n === 1 ? 'Tag' : 'Tage'})`
  }))
  return parts.length === 0 ? '' : ` Nicht erfasst und in der Abrechnung nicht mitgerechnet: ${andList(parts)}.`
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

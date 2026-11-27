// Die Ampel „Zählerstände“ im Cockpit, ohne DOM prüfbar.
import type { CostItem, Meter, MeterType, Notice } from './types'
import { meterTypesInUse } from './cockpitChecks'
import { andList } from '../../shared/wording.ts'
import { sentences } from './noticeText'

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

// Die Zähler, die die Cockpit-Zeile „Zählerstände“ rot meldet, aus den Kostenpositionen des Zeitraums (#693): eine
// Auswahl für Cockpit und Seite Zähler. Ohne Umlage nach Verbrauch im Zeitraum (auch im laufenden Jahr, solange keine
// solche Position erfasst ist) meldet sie keinen, ebenso wenig einen Zähler einer Sparte, nach der nichts umgelegt wird.
export function reportedMeters(meters: Meter[], consumption: MeterConsumption[], periodItems: CostItem[]): Meter[] {
  return meterReadiness(meters, consumption, meterTypesInUse(periodItems)).incomplete
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
    return gap ? `${m.name} (${gapPhrase(gap)})` : m.name
  })
  const idle = incomplete.flatMap((m) => {
    const on = idleSince(of(m))
    return on ? [`${m.name} (zuletzt abgelesen am ${day(on)})`] : []
  })
  const late = incomplete.some((m) => startsLate(of(m)))
  const list = `Anfang/Ende fehlt oder unplausibel bei: ${andList(names)}`
  const more = [
    ...(idle.length > 0 ? [`Schon länger nicht abgelesen: ${andList(idle)}. Wurde ein solcher Zähler getauscht, ${REPLACED_WAY}`] : []),
    ...(late ? [LATE_WAY] : []),
  ]
  return more.length === 0 ? list : `${list}. ${more.join(' ')}`
}

// Die Teile der Zeile, die auch am Zähler stehen (#693): eine Regel für Cockpit und Seite Zähler.
const gapPhrase = (gap: Span): string => `ohne Ablesung vom ${day(gap.from)} bis ${day(gap.to)}`
const idleSince = (c: MeterConsumption | undefined): string | null => (c?.longUnread && c.lastReadingOn ? c.lastReadingOn : null)
// Liegt nach der Lücke noch eine Ablesung, fehlt nicht der Endstand, sondern der Anfang (oder ein Stück mittendrin):
// Dann nennt ein Satz das Einbaudatum, das jeder Zähler tragen kann und ab dem der Server Ablesungen verlangt.
const startsLate = (c: MeterConsumption | undefined): boolean => !!c?.periodGap && !!c.lastReadingOn && c.lastReadingOn > c.periodGap.to
const REPLACED_WAY = 'erfassen Sie die erste Ablesung des neuen Geräts als Zählerwechsel.'
const LATE_WAY = 'Wurde der Zähler erst im Zeitraum eingebaut, tragen Sie am Zähler das Einbaudatum ein.'

// Der Satz am Zähler auf der Seite Zähler (#693): dieselben Tage und Auswege wie die Cockpit-Zeile, für einen Zähler.
// Gefragt wird nur die Angabe des Servers (`periodGap`); ohne sie (gedeckt, älterer Server) steht nichts da, und die
// Zelle sagt wie bisher „zu wenig Ablesungen“. Wer vom Cockpit über „Hier beheben“ kommt, sieht so, welcher Zähler
// gemeint ist. Ob der Satz erscheint, entscheidet die Seite mit `reportedMeters`: nur an Zählern, die das Cockpit meldet.
export function gapNotice(c: MeterConsumption | undefined): string | null {
  const gap = c?.periodGap
  if (!gap) return null
  const phrase = gapPhrase(gap)
  const idle = idleSince(c)
  return [
    `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}.`,
    ...(idle ? [`Zuletzt abgelesen am ${day(idle)}. Wurde der Zähler getauscht, ${REPLACED_WAY}`] : []),
    ...(startsLate(c) ? [LATE_WAY] : []),
  ].join(' ')
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

// Die eigene Heizkostenabrechnung in der Zeile „Zählerstände“ (#721): Bei `method: 'self'` verteilt Mietfuchs die
// Heizkosten nach Ablesungen der Heizperiode, ohne dass eine Position den Schlüssel „nach Zähler“ trägt; die Zeile
// sagte „Ablesungen nicht erforderlich“. Wie bei `heatingWithoutConsumption` wird gelesen, was die Berechnung meldet
// (`heating.self-incomplete` an der Anlage), und nicht noch einmal ihre Regel angewendet: Sie kennt Stichtage,
// Zwischenablesungen, Gerätewechsel und Schätzungen nach § 9a. Genannt wird je Befund der erste Satz, der sagt, was fehlt.
// `null`: keine eigene Heizkostenabrechnung in dieser Abrechnung, oder sie verteilt nach einer Vereinbarung „nach
// Wohnfläche“ und braucht keine Ablesungen. `target`: wo eingetragen wird, die Seite Zähler bei einem fehlenden oder
// widersprüchlichen Stand, sonst die Seite Heizkosten (Werte des Ablesedienstes, Anteil nach Verbrauch, Vorrat).
type SelfStatementRef = { plantId: string; from: string; to: string; self?: { ok: boolean; agreedArea?: true; capture?: string } }
export type SelfHeatingReadings =
  | { state: 'complete'; detail: string }
  | { state: 'incomplete'; detail: string; lines: string[]; plantId: string; target: 'zaehler' | 'heizkosten' }
const READING_MISSING = /fehlt ein Stand|Endstand des alten Geräts|zwei verschiedene Stände|weniger als vorher|tragen Sie die Stände ein/
export function selfHeatingReadings(settlement: { heating?: readonly SelfStatementRef[]; notices?: Notice[] }): SelfHeatingReadings | null {
  const own = (settlement.heating ?? []).filter((h) => h.self && !h.self.agreedArea)
  const first = own[0]
  if (!first) return null
  const plantIds = new Set(own.map((h) => h.plantId))
  const open = (settlement.notices ?? []).filter((n) => n.code === 'heating.self-incomplete' && n.subject?.kind === 'heatingCosts' && plantIds.has(n.subject.id))
  const intro = 'Die Heizkosten werden nach der Heizkostenverordnung mit Ablesungen verteilt.'
  if (open.length > 0) {
    const lines = [...new Set(open.map((n) => (sentences(n.text)[0] ?? n.text).trim()))]
    const service = own.some((h) => h.self?.capture === 'serviceValues')
    const target = !service && lines.some((l) => READING_MISSING.test(l)) ? 'zaehler' : 'heizkosten'
    return { state: 'incomplete', detail: `${intro} Für die eigene Heizkostenabrechnung fehlt noch:`, lines, plantId: open[0]?.subject?.id ?? first.plantId, target }
  }
  const broken = own.find((h) => h.self && !h.self.ok)
  if (broken) {
    return { state: 'incomplete', detail: `${intro} Die eigene Heizkostenabrechnung ist noch unvollständig; was fehlt, steht auf der Seite Heizkosten.`, lines: [], plantId: broken.plantId, target: 'heizkosten' }
  }
  const spans = [...new Set(own.map((h) => `${day(h.from)} bis ${day(h.to)}`))]
  return { state: 'complete', detail: `Eigene Heizkostenabrechnung: Die Stände für die ${spans.length === 1 ? 'Heizperiode' : 'Heizperioden'} ${andList(spans)} sind vollständig.` }
}

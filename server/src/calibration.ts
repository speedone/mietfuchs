// Eichfrist der Zähler (Heizung PR 21, #98, Entwurf 3.12). Reine Rechnung ohne Speicher.
//
// Die Eichfrist endet mit dem Ende des Jahres, in dem sie rechnerisch abläuft (§ 34 Abs. 2 MessEV); das
// gespeicherte Eichjahr ist dieses Jahr. Danach darf der Zähler nicht ungeeicht verwendet werden (§ 37
// Abs. 1 MessEG). Eine Ablesung gilt in Mietfuchs zum Tagesende ihres Datums; die vom 31.12. des
// Eichjahres stammt also noch aus der Frist.
//
// Geprüft werden die Ablesungen, die der Zeitraum benutzt (`readingsUsedFor`), und nur die des Geräts
// seit dem letzten Wechsel: Das Eichjahr ist eine Angabe zum heutigen Gerät (Plan PR 21, Abweichung 6).
// Weil „nach Ablauf“ mit dem Datum nur zunimmt, genügt die jüngste benutzte Ablesung.
import { dayBefore } from '../../shared/law/register.ts'
import type { SnapshotReading } from './snapshot.ts'

type Period = { from: string; to: string }

// ISO-Daten Zeichen für Zeichen, wie compareText in calc.ts.
const byDate = (a: SnapshotReading, b: SnapshotReading): number => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)

// Die Ablesungen, aus denen der Verbrauch eines Zeitraums entsteht (wie consumptionInPeriod in calc.ts):
// jede Ablesung im Zeitraum (ab dem Vortag des Beginns, denn eine Ablesung gilt zum Tagesende), dazu die
// letzte davor, wenn am Vortag keine liegt, und die erste danach, wenn am letzten Tag keine liegt; aus
// ihnen wird der Stand an der Grenze interpoliert. Eine Ablesung davor oder danach ohne Gegenstück ergibt
// keinen Verbrauch und zählt nicht.
export function readingsUsedFor(readings: readonly SnapshotReading[], period: Period): SnapshotReading[] {
  const sorted = [...readings].sort(byDate)
  const startDay = dayBefore(period.from)
  const inside = sorted.filter((x) => x.date >= startDay && x.date <= period.to)
  const before = inside.some((x) => x.date === startDay) ? undefined : sorted.filter((x) => x.date < startDay).at(-1)
  const after = inside.some((x) => x.date === period.to) ? undefined : sorted.find((x) => x.date > period.to)
  const withPartner = (edge: SnapshotReading | undefined, others: number): SnapshotReading[] => (edge && others > 0 ? [edge] : [])
  return [
    ...withPartner(before, inside.length + (after ? 1 : 0)),
    ...inside,
    ...withPartner(after, inside.length + (before ? 1 : 0)),
  ]
}

// Stammt eine benutzte Ablesung des heutigen Geräts aus der Zeit nach dem Ende des Eichjahres? Dann die
// jüngste davon, für den Hinweis. Liegt der letzte Wechsel am letzten Tag des Zeitraums oder danach, misst
// das heutige Gerät im Zeitraum nichts: Die Ablesung des Wechsels liefert mit `oldEndValue` den Endstand des
// alten Geräts (Prüfung des Plans, K8). Sonst genügt die jüngste benutzte Ablesung: Sie stammt vom heutigen
// Gerät, und weil die Ablesungen des alten Geräts früher liegen, ist keine davon nach Ablauf, ohne dass es
// die jüngste auch ist. Eine eigene Auswahl der Ablesungen je Gerät fände also nichts zusätzlich.
export function calibrationOverdue(
  calibratedUntil: number | null | undefined,
  readings: readonly SnapshotReading[],
  period: Period,
): { lastDate: string } | null {
  if (calibratedUntil === null || calibratedUntil === undefined) return null
  const used = readingsUsedFor(readings, period)
  const lastReplacement = used.filter((x) => x.replacement === true).at(-1)
  if (lastReplacement && lastReplacement.date >= period.to) return null
  const last = used.at(-1)
  return last && last.date > `${calibratedUntil}-12-31` ? { lastDate: last.date } : null
}

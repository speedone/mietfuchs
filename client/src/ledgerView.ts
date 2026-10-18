// Was das Mietkonto über einen offenen Dezember sagt (#70).
//
// Die Entscheidungslogik steht hier ohne DOM, damit sie prüfbar bleibt (ledgerView.test.ts).
// Sie stand zuerst als Bedingung in der Seite, und die Durchsicht hat genau dort zwei Aussagen
// gefunden, die nicht stimmten. Eine ungeprüfte Bedingung in einer Komponente ist keine
// Formalie, sondern die Stelle, an der so etwas sitzt.

import type { FederalState, RentLedgerRow, RentMonth } from './types'
import { rentDueDate, rentDueRuleText } from '../../shared/deadlines.ts'
import { isHoliday, localHolidaysOf, stateName, weekdayOf } from '../../shared/holidays.ts'
import { MONTH_NAMES } from './monthText'

// **Der überraschende Dezember.** Eine Zahlung zählt zu dem Jahr, in dem sie eingegangen ist.
// Geht die Dezembermiete erst im Januar ein, bleibt der Dezember im Mietkonto offen, obwohl der
// Mieter gezahlt hat, und das Geld erscheint unter den Zahlungseingängen des Folgejahres. Das
// ist richtig gerechnet und trotzdem nicht selbsterklärend.
//
// Gezeigt wird der Satz nur, wenn der Fall vorliegen **kann**, und das ist enger, als es zuerst
// aussah:
//
//   **Nur für ein vergangenes Jahr.** Im laufenden Jahr hat der Dezember naturgemäß noch nicht
//   stattgefunden, `rentLedger` füllt aber immer alle zwölf Monate. Ohne diese Bedingung bekäme
//   jedes laufende Mietverhältnis den Hinweis ab Januar, also Monate bevor er etwas bedeutet.
//
//   **Nur wenn der Dezember überhaupt ein Soll hat und nicht gedeckt ist.** Ohne Soll gibt es
//   nichts zu erklären.
//
// Das heutige Datum wird hineingereicht und nicht hier erfragt: Sonst hinge der Test an dem Tag,
// an dem er läuft, und das ist dieselbe Regel, nach der auch die Plattform hineingereicht wird.
//
// Gelesen wird das Jahr **örtlich** und nicht in UTC. Der Nutzer sitzt in seiner Zeitzone, und
// „das laufende Jahr“ ist seines. Mit `getUTCFullYear` wäre in der Stunde nach Mitternacht am
// 1. Januar (MEZ) noch das alte Jahr gemeint, und der Hinweis bliebe für das gerade vergangene
// Jahr aus. Eine Stunde im Jahr, aber es ist derselbe Zonen-Mischfall, vor dem CLAUDE.md warnt.
export function showDecemberNote(row: RentLedgerRow, year: number, today: Date): boolean {
  if (year >= today.getFullYear()) return false
  const dezember = row.months[11]
  if (!dezember) return false
  return dezember.sollCents > 0 && dezember.status !== 'paid'
}

// Der Stand einer Zeile, wie ihn die Karte nennt (#133, zweite Browserabnahme). Ein Rückstand ist
// nur, was fällig ist (`arrearsCents`, im laufenden Jahr die Monate vor dem aktuellen). Fehlt
// danach noch Geld für das Jahr, sind das die künftigen Monate: „bisher bezahlt“, kein Rückstand.
export type RowStanding = { kind: 'arrears' | 'credit' | 'paidSoFar' | 'paid', cents: number }

export function rowStanding(row: RentLedgerRow): RowStanding {
  if (row.arrearsCents > 0) return { kind: 'arrears', cents: row.arrearsCents }
  if (row.balanceCents > 0) return { kind: 'credit', cents: row.balanceCents }
  if (row.balanceCents < 0) return { kind: 'paidSoFar', cents: -row.balanceCents }
  return { kind: 'paid', cents: 0 }
}

// Das Datum, mit dem ein Klick auf einen Monat die Zahlung vorbelegt. Ein fälliger Monat: der Erste
// des Monats. Ein noch nicht fälliger (#133): heute, denn wer ihn jetzt bucht, hat heute gezahlt,
// und für die Steuer zählt der Tag des Zuflusses (letzte Durchsicht). Örtlich, wie showDecemberNote.
export function bookingDate(year: number, mo: RentMonth, today: Date): string {
  if (mo.status !== 'notDue') return `${year}-${String(mo.month).padStart(2, '0')}-01`
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}

// Das Datum, mit dem „+ Zahlung erfassen“ vorbelegt (#142). Im laufenden Jahr heute. Ist ein
// früheres Jahr gewählt, der 31.12. dieses Jahres: Wer dort nachträgt, meint eine Zahlung dieses
// Jahres, und mit dem heutigen Datum stünde sie unbemerkt im falschen (für die Steuer zählt das
// Jahr des Zuflusses). Ein späteres Jahr beginnt mit dem 1. Januar. Örtlich, wie bookingDate.
export function newPaymentDate(year: number, today: Date): string {
  const y = today.getFullYear()
  if (year < y) return `${year}-12-31`
  if (year > y) return `${year}-01-01`
  return `${y}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}

// Der Zusatz im angebrochenen Ein- oder Auszugsmonat (#311): Das Soll ist dort nach Kalendertagen
// angesetzt, dieselbe Regel wie in der Abrechnung. Ein voller Monat hat keinen Zusatz.
export function shareText(mo: Pick<RentMonth, 'share'>): string | null {
  return mo.share ? `anteilig ${mo.share.days}/${mo.share.of} Tage` : null
}

// Bis wann die Miete des laufenden Monats zu zahlen ist, als **Auskunft** über den Karten: nach der Regel
// im Rechtsregister und den Feiertagen am Ort des Objekts (rentDueDate in shared/deadlines.ts). Kurz
// eine Zeile (`text`), die Einzelheiten zum Aufklappen (`details`): Regel, Feiertage am Ort bzw. nur
// bundesweit ohne Bundesland, ein Feiertag einzelner Gemeinden, der die Frist dort verschiebt, und die
// beiden Einschränkungen (Vertrag, Überweisungsauftrag). Über den Rückstand sagt die Auskunft nichts:
// Das Mietkonto zählt den laufenden Monat noch pauschal erst ab dem nächsten (#133); den Fälligkeitstag
// dort einzusetzen ist ein eigener Schritt. Nur im laufenden Jahr, örtlich wie showDecemberNote.
const WEEKDAYS = ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.']

export type RentDueNote = { text: string; details: string }

export function rentDueNote(year: number, today: Date, state: FederalState | null | undefined): RentDueNote | null {
  if (year !== today.getFullYear()) return null
  const month = today.getMonth() + 1
  const iso = (d: number) => `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  const due = rentDueDate(iso(1).slice(0, 7), state ?? null)
  const [, m, d] = due.split('-')
  const where = state ? `nach den Feiertagen in ${stateName(state)}` : 'nur nach den bundesweiten Feiertagen, weil beim Objekt kein Bundesland eingetragen ist'
  // Feiertage einzelner Gemeinden zählt rentDueDate nicht mit (shared/holidays.ts). Fällt einer auf einen
  // Werktag bis zum Fälligkeitstag, ist es dort ein Werktag später; das steht in den Einzelheiten, sonst
  // hielte der Vermieter in diesen Gemeinden eine pünktliche Zahlung für verspätet.
  const local = state
    ? localHolidaysOf(year, state).filter((h) => h.date >= iso(1) && h.date <= due && weekdayOf(h.date) !== 0 && weekdayOf(h.date) !== 6 && !isHoliday(h.date, state))
    : []
  const localText = local.map((h) => ` In Gemeinden, in denen am ${h.date.slice(8, 10)}.${h.date.slice(5, 7)}. ${h.name} gilt, ist es ein Werktag später.`).join('')
  return {
    text: `Miete ${MONTH_NAMES[month - 1]} fällig am ${WEEKDAYS[weekdayOf(due)]}, ${d}.${m}.${year}` + (state ? '' : ' (ohne Bundesland: nur bundesweite Feiertage)'),
    details: `${rentDueRuleText(due)}; ${where}.${localText} Das gilt, wenn der Mietvertrag nichts anderes bestimmt; bei einem sehr alten Mietverhältnis ohne vereinbarte Vorauszahlung kann die Miete erst nach Ablauf des Monats fällig sein (Art. 229 § 3 Abs. 1 Nr. 7 EGBGB). ` +
      'Rechtzeitig ist eine Überweisung, die bis zu diesem Tag in Auftrag gegeben ist; die Gutschrift kann später kommen.',
  }
}

// Ob die Auskunft überhaupt etwas zu sagen hat: nur wenn im laufenden Monat eine **volle** Monatsmiete
// geschuldet ist. Ein angebrochener Monat (#311) beginnt oder endet mitten im Monat; zieht der Mieter am
// 15. ein, ist der dritte Werktag des Monats kein Termin für ihn. Ohne Soll im Monat (das letzte
// Mietverhältnis endete im Vormonat) gibt es nichts zu zahlen. Nur im laufenden Jahr, wie rentDueNote.
export function rentDueApplies(rows: readonly RentLedgerRow[], year: number, today: Date): boolean {
  if (year !== today.getFullYear()) return false
  const month = today.getMonth() + 1
  return rows.some((r) => r.months.some((mo) => mo.month === month && mo.sollCents > 0 && !mo.share))
}

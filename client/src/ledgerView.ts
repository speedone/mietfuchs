// Was das Mietkonto über Stand, Übertrag und offene Teile sagt (#70, #133, #281).
//
// Die Entscheidungslogik steht hier ohne DOM, damit sie prüfbar bleibt (ledgerView.test.ts).
// Sie stand zuerst als Bedingung in der Seite, und die Durchsicht hat genau dort zwei Aussagen
// gefunden, die nicht stimmten. Eine ungeprüfte Bedingung in einer Komponente ist keine
// Formalie, sondern die Stelle, an der so etwas sitzt.

import type { FederalState, NotDemandable, RentLedgerCarried, RentLedgerRow, RentMonth } from './types'
import { rentDueDate, rentDueRuleText } from '../../shared/deadlines.ts'
import { isHoliday, localHolidaysOf, stateName, weekdayOf } from '../../shared/holidays.ts'
import { MONTH_NAMES } from './monthText'
import { fmtDate, fmtEuro } from './api'

// **Übertrag und Stand zum Jahresende (#281).** Das Mietkonto rechnet ab Beginn des Mietverhältnisses und verteilt
// Zahlungen nach § 366 BGB (server/src/rentAllocation.ts): der Monat laut Verwendungszweck, sonst zuerst die offenen
// Vorauszahlungen, dann Kaltmiete und Pauschale, je die ältesten zuerst (BGH VIII ZR 84/17 Rn. 56/57). Ein Rückstand
// aus dem Vorjahr steht deshalb im Januar noch da, und eine im Januar eingegangene Dezembermiete deckt den Dezember
// („bezahlt am …“). Der frühere Hinweis zum offenen Dezember (#70) beschrieb die Verteilung je Jahr und ist entfallen.
//
// Der Stand einer Zeile (#133, zweite Browserabnahme): Ein Rückstand ist nur, was fällig und einforderbar ist
// (`arrearsCents`, über alle Jahre ab Beginn). Nicht mehr einzeln einforderbare Vorauszahlungen (Abrechnungsreife,
// E5) sind kein Rückstand, sondern „über die Abrechnung“. Sonst entscheidet der Endsaldo zum 31.12.: positiv
// vorausbezahlt, negativ sind es die künftigen Monate („bisher bezahlt“), sonst ausgeglichen.
export type RowStanding = { kind: 'arrears' | 'credit' | 'paidSoFar' | 'paid' | 'viaSettlement', cents: number }

export function rowStanding(row: RentLedgerRow): RowStanding {
  if (row.arrearsCents > 0) return { kind: 'arrears', cents: row.arrearsCents }
  if (row.notDemandableCents > 0) return { kind: 'viaSettlement', cents: row.notDemandableCents }
  if (row.closingBalanceCents > 0) return { kind: 'credit', cents: row.closingBalanceCents }
  if (row.closingBalanceCents < 0) return { kind: 'paidSoFar', cents: -row.closingBalanceCents }
  return { kind: 'paid', cents: 0 }
}

// „Übertrag aus {Y−1}“ oben in der Karte, oder `null` bei 0.
export function carryText(row: Pick<RentLedgerRow, 'openingBalanceCents'>, year: number): string | null {
  const c = row.openingBalanceCents
  if (c === 0) return null
  return `Übertrag aus ${year - 1}: ${c < 0 ? `Rückstand ${fmtEuro(-c)}` : `vorausbezahlt ${fmtEuro(c)}`}`
}

// Das Zeilenende: „Stand 31.12.{Y}“ (Endsaldo), darunter getrennt der Rückstand und der nicht mehr einzeln
// einforderbare Teil, jeweils nur, wenn nicht 0. `tone` wählt die Farbe (rot nur für einen Rückstand).
export type ClosingLine = { label: string, cents: number, tone: 'red' | 'green' | 'muted' }

export function closingLines(row: Pick<RentLedgerRow, 'closingBalanceCents' | 'arrearsCents' | 'notDemandableCents'>, year: number): ClosingLine[] {
  const c = row.closingBalanceCents
  const lines: ClosingLine[] = [{ label: `Stand 31.12.${year}`, cents: c, tone: c < 0 ? (row.arrearsCents > 0 ? 'red' : 'muted') : 'green' }]
  if (row.arrearsCents !== 0) lines.push({ label: 'davon Rückstand', cents: row.arrearsCents, tone: 'red' })
  if (row.notDemandableCents !== 0) lines.push({ label: 'davon nicht mehr einzeln einforderbar', cents: row.notDemandableCents, tone: 'muted' })
  return lines
}

// Was an einem teilweise bezahlten Monat offen ist, damit die Reihenfolge der Tilgung sichtbar wird
// („offen: Vorauszahlung 0,00 €, Kaltmiete 200,00 €“). Kaltmiete und Pauschale sind eine Klasse.
export function openPartsText(mo: RentMonth): string | null {
  if (mo.status !== 'partial') return null
  const rentLabel = mo.flatRateCents > 0 && mo.baseRentCents > 0 ? 'Kaltmiete und Pauschale' : mo.flatRateCents > 0 ? 'Pauschale' : 'Kaltmiete'
  return `offen: Vorauszahlung ${fmtEuro(mo.openPrepaymentCents)}, ${rentLabel} ${fmtEuro(mo.openRentCents)}`
}

// Zum 31.12. offen, später gedeckt: ein kleiner Zusatz (nur Auskunft).
export function paidLaterText(mo: Pick<RentMonth, 'paidLaterOn'>): string | null {
  return mo.paidLaterOn ? `bezahlt am ${fmtDate(mo.paidLaterOn)}` : null
}

// Je Grund ein Satz (Entwurf E5). Nur der erste sagt „enthalten“: Rechnet die Abrechnung mehr an als gezahlt, steckt
// der Betrag nicht in ihrem Saldo, sondern ist womöglich verloren; deshalb dort die Stufe Warnung.
export type NotDemandableNote = { level: 'hint' | 'warning', text: string }

export function notDemandableNotes(list: readonly NotDemandable[]): NotDemandableNote[] {
  return list.map((n): NotDemandableNote => {
    switch (n.reason) {
      case 'inStatement':
        return { level: 'hint', text: `In der Abrechnung ${n.label} enthalten (${fmtEuro(n.cents)}): Die nicht gezahlte Vorauszahlung steckt im Saldo der Abrechnung; fordern Sie diesen, nicht die Vorauszahlung.` }
      case 'creditedAsPaid':
        return {
          level: 'warning',
          text: `Die Abrechnung ${n.label} rechnet ${fmtEuro(n.differenceCents ?? n.cents)} Vorauszahlung als gezahlt an, die nicht eingegangen sind. Einzeln verlangen lässt sich die Vorauszahlung nicht mehr. ` +
            'Ob eine berichtigte Abrechnung den Betrag noch einfordern kann, hängt an der Abrechnungsfrist (§ 556 Abs. 3 Satz 3 BGB); besprechen Sie das im Zweifel mit einer Beratung.',
        }
      case 'deadlinePassed':
        return { level: 'hint', text: `Die Abrechnungsfrist für ${n.label} ist abgelaufen. Die Vorauszahlung (${fmtEuro(n.cents)}) lässt sich nicht mehr einzeln verlangen, nur noch über die Abrechnung.` }
    }
  })
}

// Ein Ausgezogener ohne Tag im Jahr, der zum 31.12. noch schuldet (`carriedOnly`): Sein Rückstand verschwindet nicht.
export function carriedText(r: RentLedgerCarried): string {
  const rest = r.notDemandableCents > 0 ? `, dazu ${fmtEuro(r.notDemandableCents)} nicht mehr einzeln einforderbar` : ''
  return `${r.tenantName}, ausgezogen am ${fmtDate(r.end)}: offen ${fmtEuro(r.openCents)}${rest}`
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

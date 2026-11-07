// Was das Mietkonto über Stand, Übertrag und offene Teile sagt (#70, #133, #281).
//
// Die Entscheidungslogik steht hier ohne DOM, damit sie prüfbar bleibt (ledgerView.test.ts).
// Sie stand zuerst als Bedingung in der Seite, und die Durchsicht hat genau dort zwei Aussagen
// gefunden, die nicht stimmten. Eine ungeprüfte Bedingung in einer Komponente ist keine
// Formalie, sondern die Stelle, an der so etwas sitzt.

import type { FederalState, NotDemandable, RentLedgerCarried, RentLedgerRow, RentMonth } from './types'
import { stateName, weekdayOf } from '../../shared/holidays.ts'
import { dayAfter } from '../../shared/law/register.ts'
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
//
// Mit der Fälligkeit am Mietverhältnis (#334) zwei weitere: `dueAwaiting` „fällig seit {Datum}“, wenn ein Monat fällig,
// sein Eingang aber noch erwartet ist (neutral, kein Rückstand); `nothingDue` „noch nichts fällig“, wenn im Jahr bisher
// kein Monat fällig war. „bisher bezahlt“ nur, wenn mindestens ein Monat fällig war und gedeckt ist. `asOf` ist der
// Stichtag des Servers (`RentLedger.asOf`).
export type RowStanding = { kind: 'arrears' | 'credit' | 'paidSoFar' | 'paid' | 'viaSettlement' | 'dueAwaiting' | 'nothingDue', cents: number, since?: string }

// Ob ein Monat zum Stichtag fällig war: mit Auskunft des Servers ab dem Fälligkeitstag, sonst nach dem Status.
const wasDue = (mo: RentMonth, asOf: string | undefined): boolean =>
  mo.sollCents > 0 && mo.status !== 'notRecorded' && (mo.dueOn !== undefined && asOf !== undefined ? mo.dueOn <= asOf : mo.status !== 'notDue')

export function rowStanding(row: RentLedgerRow, asOf?: string): RowStanding {
  if (row.arrearsCents > 0) return { kind: 'arrears', cents: row.arrearsCents }
  if (row.notDemandableCents > 0) return { kind: 'viaSettlement', cents: row.notDemandableCents }
  const awaiting = asOf === undefined ? undefined : row.months.find((mo) => mo.status === 'notDue' && mo.sollCents > 0 && mo.dueOn !== undefined && mo.dueOn <= asOf)
  if (awaiting?.dueOn) return { kind: 'dueAwaiting', cents: awaiting.sollCents - awaiting.paidCents, since: awaiting.dueOn }
  if (row.closingBalanceCents > 0) return { kind: 'credit', cents: row.closingBalanceCents }
  if (row.closingBalanceCents < 0) {
    if (!row.months.some((mo) => wasDue(mo, asOf)) && row.openingBalanceCents >= 0) return { kind: 'nothingDue', cents: 0 }
    return { kind: 'paidSoFar', cents: -row.closingBalanceCents }
  }
  return { kind: 'paid', cents: 0 }
}

// „Übertrag aus {Y−1}“ oben in der Karte, oder `null` bei 0.
export function carryText(row: Pick<RentLedgerRow, 'openingBalanceCents'>, year: number): string | null {
  const c = row.openingBalanceCents
  if (c === 0) return null
  return `Übertrag aus ${year - 1}: ${c < 0 ? `Rückstand ${fmtEuro(-c)}` : `vorausbezahlt ${fmtEuro(c)}`}`
}

// Geführt ab (#281): Liegt der Beginn des Kontos nach dem Mietbeginn (erste erfasste Mietzahlung), sagt eine gedämpfte
// Zeile, dass frühere Monate nicht erfasst und deshalb weder Soll noch offen sind.
// Lag die erste erfasste Zahlung in den letzten Tagen des Vormonats (`ledgerStartPaidOn`), nennt die Zeile sie als Miete des
// ersten geführten Monats (Dauerauftrag zum Monatsende).
export function ledgerStartText(row: Pick<RentLedgerRow, 'ledgerStart' | 'ledgerStartPaidOn'>): string | null {
  if (!row.ledgerStart) return null
  const month = MONTH_NAMES[Number(row.ledgerStart.slice(5, 7)) - 1] ?? row.ledgerStart.slice(5, 7)
  const paidOn = row.ledgerStartPaidOn
  if (paidOn) {
    return `Mietkonto geführt ab ${month} ${row.ledgerStart.slice(0, 4)}: Die erste erfasste Mietzahlung vom ${paidOn.split('-').reverse().join('.')} gilt als Miete für ${month}; frühere Monate sind nicht erfasst. Ist sie die Miete ihres eigenen Monats, tragen Sie diesen Monat an der Zahlung als Monat laut Verwendungszweck ein.`
  }
  return `Mietkonto geführt ab ${month} ${row.ledgerStart.slice(0, 4)} (erste erfasste Mietzahlung); frühere Monate sind nicht erfasst.`
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

// ---------- Fälligkeit je Karte (#334) ----------
// Die Daten kommen vom Server (`RentMonth.dueOn`, `creditExpectedBy`, `arrearsFrom`); der Client rechnet die Fälligkeit
// nicht selbst. Eine Zeile je Karte: der älteste offene Monat rot „offen seit“, sonst der nächste noch nicht als
// Rückstand zählende Monat „fällig am“ bzw. „fällig seit …, Eingang erwartet bis …“. Die Einzelheiten zum Aufklappen.
const WEEKDAYS = ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.']
const dayMonth = (iso: string): string => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`
const fullDate = (iso: string): string => `${dayMonth(iso)}${iso.slice(0, 4)}`

export type DueLine = { text: string, tone: 'red' | 'muted' }

export function dueLine(row: Pick<RentLedgerRow, 'months'>, asOf: string | undefined): DueLine | null {
  if (asOf === undefined) return null
  const name = (mo: RentMonth): string => MONTH_NAMES[mo.month - 1] ?? String(mo.month)
  const open = row.months.find((mo) => (mo.status === 'open' || mo.status === 'partial') && mo.dueOn !== undefined)
  if (open?.dueOn) return { text: `Miete ${name(open)} offen seit ${fullDate(open.dueOn)}`, tone: 'red' }
  const next = row.months.find((mo) => mo.status === 'notDue' && mo.sollCents > 0 && mo.dueOn !== undefined)
  if (!next?.dueOn) return null
  if (asOf < next.dueOn) return { text: `Miete ${name(next)} fällig am ${WEEKDAYS[weekdayOf(next.dueOn)]}, ${fullDate(next.dueOn)}`, tone: 'muted' }
  // Ohne geprüfte Feiertage zählt der Rückstand erst ab der sicheren Grenze; dann sagt die Zeile diesen Tag.
  const expected = next.creditExpectedBy
  if (expected && next.arrearsFrom === dayAfter(expected)) return { text: `Miete ${name(next)} fällig seit ${dayMonth(next.dueOn)}, Eingang erwartet bis ${dayMonth(expected)}`, tone: 'muted' }
  return { text: `Miete ${name(next)} fällig seit ${dayMonth(next.dueOn)}, zählt als Rückstand ab ${fullDate(next.arrearsFrom ?? next.dueOn)}`, tone: 'muted' }
}

// Die Einzelheiten zur Fälligkeit (aufklappbar unter der Zeile).
// `checked`: ob die Feiertage heute amtlich gelesen sind (`holidaysCheckedOn`); sonst nennt der Text die sichere Grenze.
export function dueDetails(state: FederalState | null | undefined, checked: boolean): string {
  const where = state ? `nach den Feiertagen in ${stateName(state)}, auch denen einzelner Gemeinden` : 'ohne Bundesland am Objekt nach dem spätesten Tag aller Länder; am Ort kann sie früher sein'
  return `Fällig ist die Miete nach der Regel am Mietverhältnis, ohne Angabe zu Beginn des Monats, spätestens am dritten Werktag, der Samstag zählt nicht; ${where}. ` +
    'Das gilt, wenn der Mietvertrag nichts anderes bestimmt; eine andere Fälligkeit tragen Sie am Mietverhältnis ein. ' +
    'Rechtzeitig ist eine Überweisung, die bis zum Fälligkeitstag in Auftrag gegeben ist. Als Rückstand zählt ein Monat deshalb erst ab dem Tag nach dem spätesten erwarteten Eingang, vier Bankgeschäftstage nach dem Fälligkeitstag. ' +
    (checked ? '' : 'Solange nicht alle Feiertagsgesetze der Länder amtlich gelesen sind, rechnet Mietfuchs vorsichtig ohne Feiertage und zählt einen Monat erst ab dem Ersten des Folgemonats als Rückstand, im Einzugsmonat, bei einem festen Tag und nach Ablauf des Monats ab dem Ersten des übernächsten. ') +
    'Bei einer Lastschrift holen Sie die Miete selbst ein; rechtzeitig ist der Mieter, wenn sein Konto gedeckt ist.'
}

// Was das Monatskästchen zusätzlich sagt (Tooltip und Vorleser): der Fälligkeitstag und, nur zur Prüfung, ein Eingang
// nach dem erwarteten Tag. Ohne Farbe; ob rechtzeitig überwiesen wurde, zeigt nur der Auftrag des Mieters.
export function monthDueText(mo: Pick<RentMonth, 'dueOn' | 'paidAfterExpected'>): string | null {
  const parts: string[] = []
  if (mo.dueOn) parts.push(`fällig am ${fullDate(mo.dueOn)}`)
  if (mo.paidAfterExpected) parts.push(`eingegangen am ${fullDate(mo.paidAfterExpected)}, nach dem erwarteten Eingang; ob rechtzeitig überwiesen wurde, zeigt nur der Auftrag des Mieters`)
  return parts.length > 0 ? parts.join(' · ') : null
}

// Was das Mietkonto über einen offenen Dezember sagt (#70).
//
// Die Entscheidungslogik steht hier ohne DOM, damit sie prüfbar bleibt (ledgerView.test.ts).
// Sie stand zuerst als Bedingung in der Seite, und die Durchsicht hat genau dort zwei Aussagen
// gefunden, die nicht stimmten. Eine ungeprüfte Bedingung in einer Komponente ist keine
// Formalie, sondern die Stelle, an der so etwas sitzt.

import type { RentLedgerRow, RentMonth } from './types'

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
// „das laufende Jahr" ist seines. Mit `getUTCFullYear` wäre in der Stunde nach Mitternacht am
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

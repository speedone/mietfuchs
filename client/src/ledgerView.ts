// Was das Mietkonto über einen offenen Dezember sagt (#70).
//
// Die Entscheidungslogik steht hier ohne DOM, damit sie prüfbar bleibt (ledgerView.test.ts).
// Sie stand zuerst als Bedingung in der Seite, und die Durchsicht hat genau dort zwei Aussagen
// gefunden, die nicht stimmten. Eine ungeprüfte Bedingung in einer Komponente ist keine
// Formalie, sondern die Stelle, an der so etwas sitzt.

import type { RentLedgerRow } from './types'

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
export function showDecemberNote(row: RentLedgerRow, year: number, today: Date): boolean {
  if (year >= today.getUTCFullYear()) return false
  const dezember = row.months[11]
  if (!dezember) return false
  return dezember.sollCents > 0 && dezember.status !== 'paid'
}

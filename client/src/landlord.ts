
// Vermieter, IBAN und Zahlungsfrist am Objekt oder aus den Einstellungen (#92); die Regel steht in
// shared/landlord.ts, weil auch der Server das Anschreiben damit füllt (#415).
export { effectiveLandlord } from '../../shared/landlord.ts'

// Kopfzeile (Rücksendeangabe) und Anschrift des Mieters stehen in shared/landlord.ts, weil der Server sie ins
// Anschreiben einsetzt und mit ihm einfriert (#415).
export { footerLine, letterhead, recipientLines, returnLine } from '../../shared/landlord.ts'

// Ist der Mieter schon ausgezogen und hat keine Anschrift für den Schriftverkehr, ginge die Abrechnung an
// die alte Wohnung (#229, Durchsicht S3). Die Seite warnt dann vor dem Druck.
export function printsFormerAddress(tenancy: { end?: string | null, correspondenceAddress?: string } | null | undefined, today: string): boolean {
  return !!tenancy?.end && tenancy.end < today && !(tenancy.correspondenceAddress ?? '').trim()
}


import type { Property, Settings } from './types'

// Vermieter, Bankverbindung und Zahlungsfrist, wie sie auf Abrechnung und Steuerübersicht
// stehen (#92). Am Objekt dürfen sie abweichen, etwa beim Haus der Eltern oder einer
// Erbengemeinschaft; `null` heißt dort „die Vorgabe aus den Einstellungen gilt“. Eine leere
// Angabe ist dagegen eine Angabe und bleibt stehen.
export function effectiveLandlord(
  property: Property | null,
  settings: Pick<Settings, 'landlordName' | 'iban' | 'paymentDeadlineDays'>,
): { landlordName: string, iban: string, paymentDeadlineDays: number } {
  return {
    landlordName: property?.landlordName ?? settings.landlordName,
    iban: property?.iban ?? settings.iban,
    paymentDeadlineDays: property?.paymentDeadlineDays ?? settings.paymentDeadlineDays,
  }
}

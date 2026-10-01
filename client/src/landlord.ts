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

// Die Kopfzeile über Abrechnung und Steuerübersicht: Vermieter, Objekt und Adresse, getrennt mit
// „·“. Der Trenner steht nur zwischen Angaben, die es gibt (#142); ohne Adresse endete die Zeile
// sonst mit „Haus Birke ·“.
export function letterhead(landlordName: string | null | undefined, property: Pick<Property, 'name' | 'address'> | null | undefined): string {
  return [landlordName, property?.name, property?.address]
    .map((x) => (x ?? '').trim())
    .filter((x) => x !== '')
    .join(' · ')
}

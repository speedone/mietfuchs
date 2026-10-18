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
// Die Anschrift des Mieters auf der gedruckten Abrechnung (N5): eine abweichende Anschrift für den
// Schriftverkehr geht vor (etwa nach dem Auszug), sonst die Wohnung in der Adresse des Objekts. Ohne
// Adresse steht nur, was es gibt.
export function recipientLines(
  tenantName: string,
  unitName: string,
  tenancy: { correspondenceAddress?: string } | null | undefined,
  property: Pick<Property, 'address'> | null | undefined,
): string[] {
  const own = (tenancy?.correspondenceAddress ?? '').trim()
  if (own) return [tenantName, ...own.split(/\s*\n\s*|,\s*(?=\d{5}\b)/).filter((l) => l !== '')]
  const address = (property?.address ?? '').trim()
  return [tenantName, unitName, ...address.split(/,\s*(?=\d{5}\b)/).filter((l) => l !== '')]
}

// Ist der Mieter schon ausgezogen und hat keine Anschrift für den Schriftverkehr, ginge die Abrechnung an
// die alte Wohnung (#229, Durchsicht S3). Die Seite warnt dann vor dem Druck.
export function printsFormerAddress(tenancy: { end?: string | null, correspondenceAddress?: string } | null | undefined, today: string): boolean {
  return !!tenancy?.end && tenancy.end < today && !(tenancy.correspondenceAddress ?? '').trim()
}

// Heißt das Objekt wie der Anfang seiner Adresse („Lindenweg 12“ in „Lindenweg 12, 12345 Musterstadt“),
// steht der Name nicht noch einmal davor (UI-Durchsicht N5, #341): Die Zeile lautete sonst
// „Lindenweg 12 · Lindenweg 12, 12345 Musterstadt“.
export function letterhead(landlordName: string | null | undefined, property: Pick<Property, 'name' | 'address'> | null | undefined): string {
  const name = (property?.name ?? '').trim()
  const address = (property?.address ?? '').trim()
  const repeats = name !== '' && address.toLocaleLowerCase('de-DE').startsWith(name.toLocaleLowerCase('de-DE'))
  return [landlordName ?? '', repeats ? '' : name, address]
    .map((x) => x.trim())
    .filter((x) => x !== '')
    .join(' · ')
}

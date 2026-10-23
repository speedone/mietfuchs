// Vermieter, Bankverbindung und Zahlungsfrist, wie sie auf Abrechnung, Anschreiben und Steuerübersicht
// stehen (#92). Am Objekt dürfen sie abweichen, etwa beim Haus der Eltern oder einer
// Erbengemeinschaft; `null` heißt dort „die Vorgabe aus den Einstellungen gilt“. Eine leere
// Angabe ist dagegen eine Angabe und bleibt stehen. Hier, weil auch der Server das Anschreiben
// mit diesen Angaben füllt (#415).
import type { Property, Settings } from './types.ts'
import { formatIban } from './iban.ts'

export type EffectiveLandlord = { landlordName: string, iban: string, paymentDeadlineDays: number, landlordAddress: string, landlordContact: string }

export function effectiveLandlord(
  property: Pick<Property, 'landlordName' | 'iban' | 'paymentDeadlineDays' | 'landlordAddress' | 'landlordContact'> | null,
  settings: Pick<Settings, 'landlordName' | 'iban' | 'paymentDeadlineDays' | 'landlordAddress' | 'landlordContact'>,
): EffectiveLandlord {
  return {
    landlordName: property?.landlordName ?? settings.landlordName,
    iban: property?.iban ?? settings.iban,
    paymentDeadlineDays: property?.paymentDeadlineDays ?? settings.paymentDeadlineDays,
    // Teil 2 von #415: Anschrift und Kontakt des Vermieters, am Objekt wie die übrigen abweichend.
    landlordAddress: (property?.landlordAddress ?? settings.landlordAddress ?? '').trim(),
    landlordContact: (property?.landlordContact ?? settings.landlordContact ?? '').trim(),
  }
}

// Die Rücksendeangabe über der Anschrift (#415): mit eigener Anschrift des Vermieters „Name · Anschrift“,
// sonst wie bisher die Kopfzeile mit Objekt und dessen Adresse.
export function returnLine(landlord: Pick<EffectiveLandlord, 'landlordName' | 'landlordAddress'>, property: Pick<Property, 'name' | 'address'> | null | undefined): string {
  if (landlord.landlordAddress === '') return letterhead(landlord.landlordName, property)
  return [landlord.landlordName.trim(), landlord.landlordAddress].filter((x) => x !== '').join(' · ')
}

// Die Fußzeile des Briefs mit Kontakt und Bank (#415, Teil 2): nur, was es gibt, getrennt mit „·“.
export function footerLine(landlord: Pick<EffectiveLandlord, 'landlordName' | 'landlordAddress' | 'landlordContact' | 'iban'>): string {
  const iban = landlord.iban.trim() === '' ? '' : `IBAN ${formatIban(landlord.iban)}`
  return [landlord.landlordName.trim(), landlord.landlordAddress, landlord.landlordContact, iban].filter((x) => x !== '').join(' · ')
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

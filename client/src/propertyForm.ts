import type { Property, PropertyKind } from './types'

// Die Entscheidungslogik der Karte „Objekt“ (#92), ohne DOM prüfbar wie costForm.ts und
// unitForm.ts; die Komponente rendert nur.

export type PropertyForm = {
  name: string
  address: string
  kind: PropertyKind
  // Abweichende Angaben gelten nur mit Haken; sonst die Vorgabe aus den Einstellungen.
  own: boolean
  landlordName: string
  iban: string
  paymentDeadlineDays: string
  // Kabelanlage vor oder ab dem 01.12.2021 errichtet (#121)
  cable: CableAnswer
  // Angespannter Wohnungsmarkt mit Geltung der Verordnung (§ 5d CO2KostAufG, Heizung PR 18)
  tightMarket: TightMarketAnswer
  tightMarketFrom: string
  tightMarketTo: string
}

export type CableAnswer = 'vor' | 'nach' | 'unbekannt'
export const CABLE_LABELS: Record<CableAnswer, string> = {
  unbekannt: 'unbekannt oder keine Anlage',
  vor: 'vor dem 01.12.2021 errichtet',
  nach: 'ab dem 01.12.2021 errichtet',
}

// § 5d Abs. 1 Nr. 1 und Abs. 3 Satz 2 CO2KostAufG (Heizung PR 18): ob das Gebäude in einem Gebiet liegt, das eine
// der drei Verordnungen nach dem BGB bestimmt (Prüfung S9).
export type TightMarketAnswer = 'unbekannt' | 'ja' | 'nein'
export const TIGHT_MARKET_LABELS: Record<TightMarketAnswer, string> = {
  unbekannt: 'weiß ich nicht',
  ja: 'ja, das Gebäude liegt in einem solchen Gebiet',
  nein: 'nein',
}

export type PropertyBody = Pick<Property, 'name' | 'address' | 'kind' | 'landlordName' | 'iban' | 'paymentDeadlineDays' | 'cableBuiltBeforeDec2021' | 'tightMarket' | 'tightMarketFrom' | 'tightMarketTo'>

export const propertyToForm = (p: Property): PropertyForm => ({
  name: p.name,
  address: p.address,
  kind: p.kind,
  own: p.landlordName !== null || p.iban !== null || p.paymentDeadlineDays !== null,
  landlordName: p.landlordName ?? '',
  iban: p.iban ?? '',
  paymentDeadlineDays: p.paymentDeadlineDays === null ? '' : String(p.paymentDeadlineDays),
  cable: p.cableBuiltBeforeDec2021 === true ? 'vor' : p.cableBuiltBeforeDec2021 === false ? 'nach' : 'unbekannt',
  tightMarket: p.tightMarket === true ? 'ja' : p.tightMarket === false ? 'nein' : 'unbekannt',
  tightMarketFrom: p.tightMarketFrom ?? '',
  tightMarketTo: p.tightMarketTo ?? '',
})

// **Ein leeres Feld heißt „Vorgabe“, auch mit Haken.** Wer den Haken setzt, um nur eine andere
// IBAN einzutragen, meint mit dem leeren Vermieternamen nicht „kein Vermieter“; sonst fehlte
// der Name auf der gedruckten Abrechnung, still und auf einem Dokument für den Mieter. Die
// Unterscheidung von `null` und `''` bleibt im Datenmodell erhalten, nur diese Karte bietet
// „bewusst keine“ nicht an.
export function propertyBody(form: PropertyForm): PropertyBody | { error: string } {
  const override = (value: string): string | null => (form.own && value.trim() !== '' ? value.trim() : null)
  const deadlineText = override(form.paymentDeadlineDays)
  const deadline = deadlineText === null ? null : Number(deadlineText)
  if (deadline !== null && (!Number.isInteger(deadline) || deadline < 0)) {
    return { error: 'Die Zahlungsfrist ist eine ganze Zahl von Tagen, 0 oder mehr.' }
  }
  // Die Geltung der Verordnung nur bei „ja“ (Abweichung 4 des Plans zu Heizung PR 18).
  const yes = form.tightMarket === 'ja'
  const tightFrom = yes && form.tightMarketFrom !== '' ? form.tightMarketFrom : null
  const tightTo = yes && form.tightMarketTo !== '' ? form.tightMarketTo : null
  if (tightFrom !== null && tightTo !== null && tightFrom > tightTo) return { error: 'Der Beginn der Verordnung liegt nach dem Ende. Bitte prüfen Sie beide Tage.' }
  return {
    name: form.name,
    address: form.address,
    kind: form.kind,
    landlordName: override(form.landlordName),
    iban: override(form.iban),
    paymentDeadlineDays: deadline,
    cableBuiltBeforeDec2021: form.cable === 'vor' ? true : form.cable === 'nach' ? false : null,
    tightMarket: yes ? true : form.tightMarket === 'nein' ? false : null,
    tightMarketFrom: tightFrom,
    tightMarketTo: tightTo,
  }
}

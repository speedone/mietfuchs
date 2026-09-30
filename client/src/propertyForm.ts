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
}

export type PropertyBody = Pick<Property, 'name' | 'address' | 'kind' | 'landlordName' | 'iban' | 'paymentDeadlineDays'>

export const propertyToForm = (p: Property): PropertyForm => ({
  name: p.name,
  address: p.address,
  kind: p.kind,
  own: p.landlordName !== null || p.iban !== null || p.paymentDeadlineDays !== null,
  landlordName: p.landlordName ?? '',
  iban: p.iban ?? '',
  paymentDeadlineDays: p.paymentDeadlineDays === null ? '' : String(p.paymentDeadlineDays),
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
  return {
    name: form.name,
    address: form.address,
    kind: form.kind,
    landlordName: override(form.landlordName),
    iban: override(form.iban),
    paymentDeadlineDays: deadline,
  }
}

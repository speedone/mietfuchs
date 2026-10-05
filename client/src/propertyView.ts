import type { Property, PropertyKind } from './types'

// Was die Oberfläche über das gewählte Objekt sagt (#157), ohne DOM prüfbar. Gemeldet hat es ein
// Vermieter, der nach „Weiteres Objekt anlegen“ alle Seiten leer sah und dachte, seine Daten seien
// überschrieben: Der Wechsel geschah wortlos, und keine Seite sagte, in welchem Objekt er jetzt
// arbeitet und dass das bisherige unverändert dasteht.
//
// Wer ein Haus vermietet, sieht von alledem nichts: Alles hier gilt erst ab dem zweiten Objekt.

export const propertyName = (p: Pick<Property, 'name'>): string => p.name.trim() || 'Ohne Namen'

// Der Name im Seitenkopf jeder Seite, erst ab zwei Objekten.
export function propertyHeading(properties: Property[], property: Property | null): string | null {
  if (!property || properties.length < 2) return null
  return propertyName(property)
}

// ---------- Der Dialog „Weiteres Objekt anlegen“ ----------

export type NewPropertyForm = { name: string; kind: PropertyKind; address: string }
export const EMPTY_NEW_PROPERTY: NewPropertyForm = { name: '', kind: 'mfh', address: '' }

// Name, Art und Adresse gehen in **einem** Aufruf an den Server (POST /api/properties nimmt alle
// Felder des Objekts). Ein Anlegen mit anschließendem Ändern könnte nach dem ersten Schritt
// scheitern und hinterließe ein Objekt ohne Art und Adresse.
export function newPropertyBody(form: NewPropertyForm): NewPropertyForm | { error: string } {
  const name = form.name.trim()
  if (!name) return { error: 'Bitte geben Sie dem neuen Objekt einen Namen.' }
  return { name, kind: form.kind, address: form.address.trim() }
}

// Der Knopf sagt, dass gewechselt wird, und wohin.
export function createButtonLabel(name: string): string {
  const n = name.trim()
  return n ? `Anlegen und zu „${n}“ wechseln` : 'Anlegen und wechseln'
}

// ---------- Der Hinweis nach dem Wechsel in ein leeres Objekt ----------

// Gezeigt in einem Objekt ohne Wohnungen, wenn vorher ein anderes, noch vorhandenes Objekt gewählt
// war. `unitsFor` ist das Objekt, zu dem die geladenen Wohnungen gehören: Bis die Wohnungen des
// neuen Objekts da sind, stehen noch die des vorigen in der Oberfläche, und deren Zahl sagt nichts
// über dieses. Geschlossen wird je Objekt.
//
// `previousUnitCount` ist die Zahl der Wohnungen, die das vorige Objekt beim Wechsel hatte, `null`
// heißt unbekannt (nach dem Neuladen der Seite). „Ihre Daten … sind unverändert“ steht nur da, wo
// es Daten gab; sonst wäre der Satz eine Beruhigung ohne Grundlage.
export function emptyPropertyNotice(args: {
  properties: Property[]
  property: Property | null
  previousId: string | null
  unitsFor: string | null
  unitCount: number
  previousUnitCount: number | null
  dismissed: readonly string[]
}): { current: string; previous: Property; previousHadUnits: boolean } | null {
  const { properties, property, previousId, unitsFor, unitCount, previousUnitCount, dismissed } = args
  if (!property || properties.length < 2) return null
  if (unitsFor !== property.id || unitCount > 0) return null
  if (dismissed.includes(property.id)) return null
  const previous = properties.find((p) => p.id === previousId && p.id !== property.id)
  if (!previous) return null
  return { current: propertyName(property), previous, previousHadUnits: (previousUnitCount ?? 0) > 0 }
}

// Die leere Wohnungsliste in den Stammdaten. Bei einer Eigentumswohnung legt man nur die eigene an
// (#142, Fall 3): Die übrigen Wohnungen des Hauses gehören anderen Eigentümern, ihr Anteil an den
// Kosten steht schon in der Hausgeldabrechnung.
export function emptyUnitsText(kind: PropertyKind): string {
  if (kind === 'etw') {
    return 'Noch keine Wohnung angelegt. Legen Sie hier nur die eigene Wohnung an, nicht die übrigen Wohnungen des Hauses: Deren Anteil an den Kosten steht schon in der Hausgeldabrechnung.'
  }
  return 'Noch keine Wohnungen angelegt. Legen Sie alle Wohnungen des Hauses an — auch die selbstgenutzte.'
}

// ---------- Der Abschlussdialog der Abrechnung ----------

// `docName`: was abgeschlossen wird, wenn es nicht die Abrechnung des Zeitraums ist (Sichtprüfung
// E45: die Heizkostenabrechnung einer Heizperiode).
export function closeSettlementTitle(label: string | number, properties: Property[], property: Property | null, docName = `Abrechnung ${label}`): string {
  const name = propertyHeading(properties, property)
  return name ? `${docName} für „${name}“ abschließen?` : `${docName} abschließen?`
}

// Was die Oberfläche über das gewählte Objekt sagt (#157), ohne DOM geprüft.
import { expect, test } from 'vitest'
import type { Property } from './types'
import abrechnungSource from './pages/Abrechnung.tsx?raw'
import { closeSettlementTitle, createButtonLabel, emptyPropertyNotice, emptyUnitsText, newPropertyBody, propertyHeading } from './propertyView'

const objekt = (id: string, name: string): Property => ({
  id, name, kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null,
})
const A = objekt('objekt-1', 'Haus A')
const B = objekt('objekt-2', 'Haus B')

test('Seitenkopf: das Objekt steht erst ab zwei Objekten da', () => {
  expect(propertyHeading([A], A)).toBeNull()
  expect(propertyHeading([A, B], B)).toBe('Haus B')
  expect(propertyHeading([A, objekt('objekt-2', '  ')], objekt('objekt-2', '  '))).toBe('Ohne Namen')
  expect(propertyHeading([A, B], null)).toBeNull()
})

test('neues Objekt: der Name ist Pflicht, Art und Adresse gehen im selben Aufruf mit', () => {
  expect(newPropertyBody({ name: '  ', kind: 'etw', address: '' })).toEqual({ error: 'Bitte geben Sie dem neuen Objekt einen Namen.' })
  expect(newPropertyBody({ name: ' Gartenweg 3 ', kind: 'etw', address: ' Gartenweg 3, 12345 Musterstadt ' }))
    .toEqual({ name: 'Gartenweg 3', kind: 'etw', address: 'Gartenweg 3, 12345 Musterstadt' })
})

test('der Knopf sagt, dass gewechselt wird, und wohin', () => {
  expect(createButtonLabel('Gartenweg 3')).toBe('Anlegen und zu „Gartenweg 3“ wechseln')
  expect(createButtonLabel('  ')).toBe('Anlegen und wechseln')
})

test('Hinweis nach dem Wechsel: nur in einem Objekt ohne Wohnungen, mit dem vorigen Objekt', () => {
  const base = { properties: [A, B], property: B, previousId: 'objekt-1', unitsFor: 'objekt-2', unitCount: 0, previousUnitCount: 2, dismissed: [] as string[] }
  expect(emptyPropertyNotice(base)).toEqual({ current: 'Haus B', previous: A, previousHadUnits: true })
  // „Ihre Daten … sind unverändert“ nur, wenn dort welche standen; unbekannt (nach dem Neuladen
  // der Seite) oder leer heißt der neutrale Satz.
  expect(emptyPropertyNotice({ ...base, previousUnitCount: 0 })).toMatchObject({ previousHadUnits: false })
  expect(emptyPropertyNotice({ ...base, previousUnitCount: null })).toMatchObject({ previousHadUnits: false })
  // Sobald es Wohnungen gibt, ist der Hinweis weg.
  expect(emptyPropertyNotice({ ...base, unitCount: 1 })).toBeNull()
  // Die Wohnungen eines anderen Objekts (noch nicht neu geladen) sagen nichts über dieses.
  expect(emptyPropertyNotice({ ...base, unitsFor: 'objekt-1' })).toBeNull()
  // Geschlossen bleibt geschlossen.
  expect(emptyPropertyNotice({ ...base, dismissed: ['objekt-2'] })).toBeNull()
  // Ohne bekanntes voriges Objekt, oder wenn es inzwischen gelöscht ist, gibt es nichts zu sagen.
  expect(emptyPropertyNotice({ ...base, previousId: null })).toBeNull()
  expect(emptyPropertyNotice({ ...base, previousId: 'gelöscht' })).toBeNull()
  expect(emptyPropertyNotice({ ...base, previousId: 'objekt-2' })).toBeNull()
  // Mit nur einem Objekt gibt es kein voriges.
  expect(emptyPropertyNotice({ ...base, properties: [B] })).toBeNull()
})

test('Abschlussdialog: bei mehreren Objekten mit Objekt, bei einem wie bisher', () => {
  expect(closeSettlementTitle(2025, [A], A)).toBe('Abrechnung 2025 abschließen?')
  expect(closeSettlementTitle(2025, [A, B], B)).toBe('Abrechnung 2025 für „Haus B“ abschließen?')
})

test('die Seite Abrechnung fragt mit diesem Titel', () => {
  // Die Abrechnung bräuchte für den Knopf einen vollständigen Rechenstand; geprüft wird deshalb
  // am Quelltext, dass der Abschlussdialog den Titel von hier nimmt.
  expect(abrechnungSource).toMatch(/title: closeSettlementTitle\(label, properties, property\)/)
})

test('leere Wohnungsliste: bei einer Eigentumswohnung nur die eigene Wohnung anlegen', () => {
  expect(emptyUnitsText('mfh')).toMatch(/alle Wohnungen des Hauses/)
  const etw = emptyUnitsText('etw')
  expect(etw).not.toMatch(/alle Wohnungen des Hauses/)
  expect(etw).toMatch(/nur die eigene Wohnung/)
})

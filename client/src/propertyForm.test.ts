// Die Karte „Objekt“ (#92): Was aus dem Formular in den Rumpf von PUT /api/properties wird.
import { expect, test } from 'vitest'
import { propertyBody, propertyToForm, type PropertyForm } from './propertyForm'

const form = (over: Partial<PropertyForm>): PropertyForm => ({
  name: 'Haus', address: 'Weg 1', kind: 'mfh', own: false, landlordName: '', iban: '', paymentDeadlineDays: '', cable: 'unbekannt', ...over,
})

test('ohne Haken gilt für alle drei die Vorgabe', () => {
  expect(propertyBody(form({ landlordName: 'X', iban: 'DE9', paymentDeadlineDays: '7' })))
    .toMatchObject({ landlordName: null, iban: null, paymentDeadlineDays: null })
})

test('mit Haken gilt nur, was eingetragen ist; ein leeres Feld heißt Vorgabe', () => {
  // Wer den Haken setzt, um nur eine andere IBAN einzutragen, soll den Vermieternamen auf der
  // Abrechnung nicht verlieren.
  expect(propertyBody(form({ own: true, iban: ' DE89 3704 0044 0532 0130 00 ' })))
    .toEqual({ name: 'Haus', address: 'Weg 1', kind: 'mfh', landlordName: null, iban: 'DE89370400440532013000', paymentDeadlineDays: null, cableBuiltBeforeDec2021: null })
})

test('eine Frist, die keine ganze Zahl ab 0 ist, wird abgelehnt', () => {
  expect(propertyBody(form({ own: true, paymentDeadlineDays: '-3' }))).toEqual({ error: 'Die Zahlungsfrist ist eine ganze Zahl von Tagen, 0 oder mehr.' })
  expect(propertyBody(form({ own: true, paymentDeadlineDays: '14' }))).toMatchObject({ paymentDeadlineDays: 14 })
})

test('Kabelanlage (#121): ja, nein und unbekannt gehen als true, false und null in den Rumpf und zurück', () => {
  expect(propertyBody(form({ cable: 'vor' }))).toMatchObject({ cableBuiltBeforeDec2021: true })
  expect(propertyBody(form({ cable: 'nach' }))).toMatchObject({ cableBuiltBeforeDec2021: false })
  expect(propertyBody(form({ cable: 'unbekannt' }))).toMatchObject({ cableBuiltBeforeDec2021: null })
  const p = { id: 'o', name: 'Haus', kind: 'mfh' as const, address: '', landlordName: null, iban: null, paymentDeadlineDays: null }
  expect(propertyToForm({ ...p, cableBuiltBeforeDec2021: false }).cable).toBe('nach')
  expect(propertyToForm(p).cable).toBe('unbekannt')
})

test('IBAN (#279): eine neue ungültige wird abgelehnt, eine gültige normiert, eine gespeicherte ungültige geht unverändert mit', () => {
  expect(propertyBody(form({ own: true, iban: 'DE00 3704 0044 0532 0130 00' })))
    .toEqual({ error: expect.stringMatching(/^Die abweichende IBAN ist nicht gültig\. Die Prüfziffer stimmt nicht/) })
  expect(propertyBody(form({ own: true, iban: 'de02120300000000202051' }))).toMatchObject({ iban: 'DE02120300000000202051' })
  // Gespeichert ungültig, unverändert (auch anders geschrieben): kein Fehler, nicht umgeschrieben
  expect(propertyBody(form({ own: true, iban: 'DE00 3333', address: 'Weg 9' }), 'de003333')).toMatchObject({ iban: 'de003333', address: 'Weg 9' })
  // Ohne Haken prüft nichts, denn es gilt die Vorgabe
  expect(propertyBody(form({ own: false, iban: 'DE00' }))).toMatchObject({ iban: null })
  // Beim Öffnen: gültig in Vierergruppen, ungültig, wie sie ist
  const p = { id: 'o', name: 'Haus', kind: 'mfh' as const, address: '', landlordName: null, paymentDeadlineDays: null }
  expect(propertyToForm({ ...p, iban: 'DE89370400440532013000' }).iban).toBe('DE89 3704 0044 0532 0130 00')
  expect(propertyToForm({ ...p, iban: 'de003333' }).iban).toBe('de003333')
})

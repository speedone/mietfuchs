// Die Karte „Objekt“ (#92): Was aus dem Formular in den Rumpf von PUT /api/properties wird.
import { expect, test } from 'vitest'
import { propertyBody, propertyToForm, type PropertyForm } from './propertyForm'

const form = (over: Partial<PropertyForm>): PropertyForm => ({
  name: 'Haus', address: 'Weg 1', kind: 'mfh', own: false, landlordName: '', iban: '', paymentDeadlineDays: '', cable: 'unbekannt', tightMarket: 'unbekannt', tightMarketFrom: '', tightMarketTo: '', ...over,
})

test('ohne Haken gilt für alle drei die Vorgabe', () => {
  expect(propertyBody(form({ landlordName: 'X', iban: 'DE9', paymentDeadlineDays: '7' })))
    .toMatchObject({ landlordName: null, iban: null, paymentDeadlineDays: null })
})

test('mit Haken gilt nur, was eingetragen ist; ein leeres Feld heißt Vorgabe', () => {
  // Wer den Haken setzt, um nur eine andere IBAN einzutragen, soll den Vermieternamen auf der
  // Abrechnung nicht verlieren.
  expect(propertyBody(form({ own: true, iban: ' DE99 ' })))
    .toEqual({ name: 'Haus', address: 'Weg 1', kind: 'mfh', landlordName: null, iban: 'DE99', paymentDeadlineDays: null, cableBuiltBeforeDec2021: null, tightMarket: null, tightMarketFrom: null, tightMarketTo: null })
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

test('angespannter Wohnungsmarkt (§ 5d CO2KostAufG): ja mit Geltung, nein und unbekannt hin und zurück', () => {
  expect(propertyBody(form({ tightMarket: 'ja', tightMarketFrom: '2025-07-01', tightMarketTo: '2029-12-31' }))).toMatchObject({ tightMarket: true, tightMarketFrom: '2025-07-01', tightMarketTo: '2029-12-31' })
  expect(propertyBody(form({ tightMarket: 'ja' }))).toMatchObject({ tightMarket: true, tightMarketFrom: null, tightMarketTo: null })
  // Die Geltung gehört nur zu „ja“.
  expect(propertyBody(form({ tightMarket: 'nein', tightMarketFrom: '2025-07-01' }))).toMatchObject({ tightMarket: false, tightMarketFrom: null, tightMarketTo: null })
  expect(propertyBody(form({ tightMarket: 'unbekannt' }))).toMatchObject({ tightMarket: null })
  expect(propertyBody(form({ tightMarket: 'ja', tightMarketFrom: '2030-01-01', tightMarketTo: '2029-12-31' }))).toEqual({ error: 'Der Beginn der Verordnung liegt nach dem Ende. Bitte prüfen Sie beide Tage.' })
  const p = { id: 'o', name: 'Haus', kind: 'mfh' as const, address: '', landlordName: null, iban: null, paymentDeadlineDays: null, tightMarket: true, tightMarketFrom: null, tightMarketTo: '2029-12-31' }
  expect([propertyToForm(p).tightMarket, propertyToForm(p).tightMarketFrom, propertyToForm(p).tightMarketTo]).toEqual(['ja', '', '2029-12-31'])
  expect(propertyToForm({ ...p, tightMarket: false }).tightMarket).toBe('nein')
  expect(propertyToForm({ ...p, tightMarket: null }).tightMarket).toBe('unbekannt')
})

// Vermieter, Bankverbindung und Zahlungsfrist auf dem Ausdruck (#92): Das Objekt geht vor, und
// `null` heißt „die Vorgabe aus den Einstellungen gilt“. Eine leere Angabe am Objekt ist dagegen
// eine Angabe, etwa für ein Haus, dessen Miete bar gezahlt wird.
import { expect, test } from 'vitest'
import { effectiveLandlord, letterhead, printsFormerAddress, recipientLines } from './landlord'
import type { Property } from './types'

const vorgabe = { landlordName: 'Erika Muster', iban: 'DE01', paymentDeadlineDays: 30 }
const objekt = (abweichend: Partial<Property>): Property => ({
  id: 'o', name: 'X', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null, ...abweichend,
})

test('ohne Abweichung gilt die Vorgabe', () => {
  expect(effectiveLandlord(objekt({}), vorgabe)).toEqual(vorgabe)
  expect(effectiveLandlord(null, vorgabe)).toEqual(vorgabe)
})

test('was am Objekt steht, geht vor, auch eine leere Angabe', () => {
  expect(effectiveLandlord(objekt({ landlordName: 'Erbengemeinschaft Muster', iban: '', paymentDeadlineDays: 14 }), vorgabe))
    .toEqual({ landlordName: 'Erbengemeinschaft Muster', iban: '', paymentDeadlineDays: 14 })
})

test('Kopfzeile (#142): Trenner nur zwischen vorhandenen Angaben', () => {
  expect(letterhead('', { name: 'Haus Birke', address: '' })).toBe('Haus Birke')
  expect(letterhead('Erika Muster', { name: 'Haus Birke', address: '  ' })).toBe('Erika Muster · Haus Birke')
  expect(letterhead('Erika Muster', { name: 'Haus Birke', address: 'Birkenweg 1, 12345 Ort' })).toBe('Erika Muster · Haus Birke · Birkenweg 1, 12345 Ort')
  expect(letterhead(null, null)).toBe('')
})

test('Kopfzeile (N5, #341): ein Objektname, der schon in der Adresse steht, steht nicht doppelt da', () => {
  expect(letterhead('Erika Muster', { name: 'Lindenweg 12', address: 'Lindenweg 12, 12345 Musterstadt' })).toBe('Erika Muster · Lindenweg 12, 12345 Musterstadt')
  expect(letterhead('', { name: 'lindenweg 12', address: 'Lindenweg 12, 12345 Musterstadt' })).toBe('Lindenweg 12, 12345 Musterstadt')
  // Nur der Anfang zählt: ein anderer Name bleibt stehen.
  expect(letterhead('', { name: 'Musterstadt', address: 'Lindenweg 12, 12345 Musterstadt' })).toBe('Musterstadt · Lindenweg 12, 12345 Musterstadt')
})

test('Anschrift des Mieters (N5): abweichende Anschrift vor der Wohnung im Objekt', () => {
  expect(recipientLines('Anna Beispiel', 'EG links', {}, { address: 'Lindenweg 12, 12345 Musterstadt' }))
    .toEqual(['Anna Beispiel', 'EG links', 'Lindenweg 12', '12345 Musterstadt'])
  expect(recipientLines('Anna Beispiel', 'EG links', { correspondenceAddress: 'Birkenweg 3, 54321 Anderswo' }, { address: 'Lindenweg 12, 12345 Musterstadt' }))
    .toEqual(['Anna Beispiel', 'Birkenweg 3', '54321 Anderswo'])
  expect(recipientLines('Anna Beispiel', 'EG links', null, { address: '' })).toEqual(['Anna Beispiel', 'EG links'])
})

// #229, Durchsicht S3: Nach dem Auszug ohne eigene Anschrift ginge die Abrechnung an die alte Wohnung.
test('ausgezogen ohne Anschrift für den Schriftverkehr: die Seite warnt', () => {
  expect(printsFormerAddress({ end: '2025-06-30' }, '2026-03-01')).toBe(true)
  expect(printsFormerAddress({ end: '2025-06-30', correspondenceAddress: 'Birkenweg 3, 54321 Anderswo' }, '2026-03-01')).toBe(false)
  expect(printsFormerAddress({ end: null }, '2026-03-01')).toBe(false)
  expect(printsFormerAddress({ end: '2026-12-31' }, '2026-03-01')).toBe(false)
})

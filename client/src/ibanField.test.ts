// Ein IBAN-Feld im Formular (#279): was am Feld steht und was gespeichert wird.
import { expect, test } from 'vitest'
import { ibanChanged, ibanFieldState, ibanForSave, ibanOnBlur, ibanToInput } from './ibanField'
import { IBAN_LABELS } from '../../shared/iban.ts'

const OK = 'DE89370400440532013000'
const FALSCH = 'DE00370400440532013000'

test('leer ist immer in Ordnung und wird als leer gespeichert', () => {
  expect(ibanFieldState('  ', 'DE00 1')).toEqual({ error: null, notice: null })
  expect(ibanForSave('', OK, 'Die IBAN')).toEqual({ value: '' })
})

test('eine neue gültige wird normiert gespeichert, Leerzeichen und Kleinbuchstaben sind erlaubt', () => {
  expect(ibanFieldState('de89 3704 0044 0532 0130 00', null)).toEqual({ error: null, notice: null })
  expect(ibanForSave('de89 3704 0044 0532 0130 00', null, 'Die IBAN')).toEqual({ value: OK })
})

test('eine neue ungültige ergibt einen Fehler am Feld und wird nicht gespeichert', () => {
  expect(ibanFieldState(FALSCH, null).error).toMatch(/Prüfziffer stimmt nicht/)
  expect(ibanFieldState('DE8937', OK).error).toMatch(/22 Zeichen, eingetragen sind 6/)
  // Derselbe Satz wie beim Server (server/src/iban.ts, api.test.ts)
  expect(ibanForSave(FALSCH, OK, IBAN_LABELS.tenancy)).toEqual({ error: expect.stringMatching(/^Die IBAN des Mieters ist nicht gültig\. Die Prüfziffer.* Bitte prüfen Sie die Angabe\.$/) })
})

test('eine gespeicherte ungültige, unverändert: Hinweis statt Fehler, gespeichert wird sie, wie sie ist', () => {
  const state = ibanFieldState('DE00 1111 2222', 'de0011112222')
  expect(state.error).toBeNull()
  expect(state.notice).toMatch(/^Die gespeicherte IBAN ist vermutlich falsch eingetragen\./)
  expect(ibanForSave('DE00 1111 2222', 'de0011112222', 'Die IBAN')).toEqual({ value: 'de0011112222' })
  // Geändert, auch zu einer anderen ungültigen: dann gilt die Prüfung
  expect(ibanForSave('DE00 1111 2223', 'de0011112222', 'Die IBAN')).toHaveProperty('error')
})

test('eine gespeicherte gültige, anders geschrieben, wird normiert', () => {
  expect(ibanForSave('de89 3704 0044 0532 0130 00', 'de89 3704 0044 0532 0130 00', 'Die IBAN')).toEqual({ value: OK })
})

test('Anzeige: beim Öffnen und nach dem Verlassen in Vierergruppen, nur wenn gültig', () => {
  expect(ibanToInput(OK)).toBe('DE89 3704 0044 0532 0130 00')
  expect(ibanToInput(null)).toBe('')
  expect(ibanToInput('de00 x')).toBe('de00 x')
  expect(ibanOnBlur(' gb82west12345698765432 ')).toBe('GB82 WEST 1234 5698 7654 32')
  expect(ibanOnBlur('DE00 12')).toBe('DE00 12')
  // Bindestriche und unsichtbare Zeichen aus einer kopierten IBAN
  expect(ibanOnBlur('DE89-3704-0044-0532-0130-00\u200b')).toBe('DE89 3704 0044 0532 0130 00')
})

test('Vierergruppen sind keine ungespeicherte Änderung', () => {
  expect(ibanChanged('DE89 3704 0044 0532 0130 00', OK)).toBe(false)
  expect(ibanChanged('', null)).toBe(false)
  expect(ibanChanged('DE02120300000000202051', OK)).toBe(true)
})

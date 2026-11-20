// Die gedruckte Aufstellung zum Auszug als Brief (#228): Absender, Anschrift für den Schriftverkehr, Ort und Datum,
// Betreff mit Wohnung und Objekt, Ergebnis in einem Satz, Gruß und Unterschrift. Fester Text, nichts Rechtliches.
import { expect, test } from 'vitest'
import { DEPOSIT_SENDER_MISSING_TEXT, depositLetterView, depositSenderMissing } from './depositLetter'
import type { DepositSettlement } from './depositSettlement'

const flat = (s: string) => s.replace(/ /g, ' ')
const LANDLORD = { landlordName: 'Petra Vermieterin', landlordAddress: 'Gartenweg 3, 54321 Beispielstadt', landlordContact: 'Tel. 0123 456789', iban: 'DE02120300000000202051', paymentDeadlineDays: 30 }
const PROPERTY = { name: 'Haus Birke', address: 'Lindenweg 12, 12345 Musterstadt' }
const TENANCY = { tenantName: 'Erika Mustermann', end: '2025-12-31', correspondenceAddress: 'Neue Straße 5, 99999 Anderswo', letterSalutation: 'Sehr geehrte Frau Mustermann' }
const SETTLEMENT: DepositSettlement = {
  rows: [{ label: 'Eingang', cents: 240000, date: '2022-01-05' }],
  balanceCents: 240000, hold: { cents: 30000, note: 'Nebenkosten 2025' }, payoutCents: 210000, lastStatement: null, lastHeatingStatement: null, pending: [],
}
const view = (over: Partial<Parameters<typeof depositLetterView>[0]> = {}) =>
  depositLetterView({ tenancy: TENANCY, unitName: 'EG links', property: PROPERTY, landlord: LANDLORD, settlement: SETTLEMENT, today: '2026-01-15', ...over })

test('Briefkopf: Absender, Rücksendeangabe, Anschrift für den Schriftverkehr, Ort und Datum', () => {
  const v = view()
  expect(v.head.sender).toBe('Petra Vermieterin')
  expect(v.head.senderAddress).toBe('Gartenweg 3, 54321 Beispielstadt')
  expect(v.head.returnLine).toBe('Petra Vermieterin · Gartenweg 3, 54321 Beispielstadt')
  expect(v.head.recipient).toEqual(['Erika Mustermann', 'Neue Straße 5', '99999 Anderswo'])
  expect(v.head.info.at(-1)).toEqual({ label: null, value: 'Beispielstadt, 15.01.2026' })
})

test('ohne eigene Anschrift geht der Brief an die Adresse des Objekts', () => {
  expect(view({ tenancy: { ...TENANCY, correspondenceAddress: undefined } }).head.recipient).toEqual(['Erika Mustermann', 'Lindenweg 12', '12345 Musterstadt'])
})

test('Betreff nennt Wohnung und Objekt, der Text Mietende und Stand, Gruß und Unterschrift stehen', () => {
  const v = view()
  expect(v.subject).toBe('Kaution: Aufstellung zum Auszug\nEG links, Lindenweg 12, 12345 Musterstadt')
  expect(v.salutation).toBe('Sehr geehrte Frau Mustermann,')
  expect(v.intro).toContain('endete am 31.12.2025')
  expect(v.intro).toContain('Stand vom 15.01.2026')
  expect(v.greeting).toBe('Mit freundlichen Grüßen')
  expect(v.signature).toBe('Petra Vermieterin')
})

test('Ergebnis in einem Satz: Auszahlung mit Frage nach dem Konto, mit hinterlegter IBAN diese', () => {
  expect(flat(view().result)).toBe('Zur Auszahlung an Sie bleiben damit 2.100,00 €. Bitte teilen Sie mit, auf welches Konto der Betrag überwiesen werden soll.')
  expect(flat(view({ tenancy: { ...TENANCY, iban: 'DE89370400440532013000' } }).result))
    .toBe('Zur Auszahlung an Sie bleiben damit 2.100,00 €. Als Ihre Bankverbindung ist die IBAN DE89 3704 0044 0532 0130 00 hinterlegt; bitte teilen Sie mit, falls der Betrag auf ein anderes Konto gehen soll.')
})

test('Ergebnis ohne Auszahlung: nach dem Einbehalt nichts, ohne Stand nichts', () => {
  expect(view({ settlement: { ...SETTLEMENT, hold: { cents: 240000, note: 'Nebenkosten 2025' }, payoutCents: 0 } }).result).toBe('Nach dem Einbehalt bleibt derzeit nichts auszuzahlen.')
  expect(view({ settlement: { hold: null, payoutCents: 0 } }).result).toBe('Damit bleibt nichts auszuzahlen.')
})

test('der Brief behauptet nichts Rechtliches: keine Norm, keine Frist, keine Zahl von Monaten', () => {
  const v = view()
  const text = [v.subject, v.salutation, v.intro, v.result].join(' ')
  expect(text).not.toMatch(/§|BGB|Frist|Monat|BGH|verjähr|Anspruch/i)
})

test('ohne Vermieternamen warnt die Seite, mit Briefpapier nicht', () => {
  const v = view({ landlord: { ...LANDLORD, landlordName: ' ' } })
  expect(v.head.sender).toBe('')
  expect(v.signature).toBe('')
  expect(depositSenderMissing(v, false)).toBe(true)
  expect(depositSenderMissing(v, true)).toBe(false)
  expect(depositSenderMissing(view(), false)).toBe(false)
  expect(DEPOSIT_SENDER_MISSING_TEXT).toContain('Name des Vermieters')
})

// Der Monat laut Verwendungszweck (#693): nur, was eindeutig ein Monat der Miete ist. Die Zwecke sind Formen, wie
// Banken sie liefern (groß, ohne Umlaute, mit Zusätzen); die Fehlalarme sind die, an denen eine weite Regel scheitert.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { monthInPurpose } from '../src/bank/purposeMonth.ts'

const at = (purpose: string, bookingDate = '2026-11-03'): string | null => monthInPurpose(purpose, bookingDate)

test('Monat im Zweck: Monatsname mit und ohne Jahr, groß, abgekürzt, ohne Umlaute', () => {
  assert.equal(at('Miete November'), '2026-11')
  assert.equal(at('Miete November 2026'), '2026-11')
  assert.equal(at('MIETE NOVEMBER 2026 WHG 3 OG LINKS'), '2026-11')
  assert.equal(at('Miete Nov. 2026'), '2026-11')
  assert.equal(at('Miete Nov'), '2026-11')
  assert.equal(at('Mietzahlung fuer Oktober'), '2026-10')
  assert.equal(at('Miete März 2026', '2026-03-02'), '2026-03')
  assert.equal(at('MIETE MAERZ', '2026-03-02'), '2026-03')
  assert.equal(at('MIETE MRZ 2026', '2026-03-02'), '2026-03')
  assert.equal(at('Kaltmiete + NK Dezember 2026', '2026-12-01'), '2026-12')
  assert.equal(at('Miete/Dezember/2026', '2026-12-01'), '2026-12')
  assert.equal(at('SVWZ+Miete Mai 2026 EREF+NOTPROVIDED', '2026-05-04'), '2026-05')
})

test('Monat im Zweck: Zahlen nur als MM/JJJJ oder JJJJ-MM mit vierstelligem Jahr', () => {
  assert.equal(at('Miete 11/2026'), '2026-11')
  assert.equal(at('Miete 11.2026'), '2026-11')
  assert.equal(at('Miete 11-2026'), '2026-11')
  assert.equal(at('MIETE 1/2027 WOHNUNG 2', '2026-12-29'), '2027-01')
  assert.equal(at('Miete 2026-11'), '2026-11')
  assert.equal(at('Miete November 11/2026'), '2026-11', 'derselbe Monat zweimal ist einer')
  // Zweistelliges Jahr und bloße Zahl sind mehrdeutig (Tag/Monat, Wohnungsnummer).
  assert.equal(at('Miete 11/26'), null)
  assert.equal(at('Miete 11'), null)
  assert.equal(at('Miete 13/2026'), null)
  assert.equal(at('Miete 2026'), null)
})

test('Monat im Zweck: ohne Jahr der nächstliegende Monat um den Buchungstag, über den Jahreswechsel', () => {
  assert.equal(at('Miete Dezember', '2027-01-04'), '2026-12')
  assert.equal(at('Miete Januar', '2026-12-29'), '2027-01')
  assert.equal(at('Miete Januar', '2026-11-03'), '2026-01', 'der Rückstand vom Januar, im November nachgezahlt')
  assert.equal(at('Miete Februar', '2026-11-03'), '2026-02')
})

test('Monat im Zweck: ein Jahr weit weg vom Buchungstag ist nicht plausibel', () => {
  assert.equal(at('Miete November 2019'), null)
  assert.equal(at('Miete 11/2031'), null)
  assert.equal(at('Miete November 2025'), '2025-11')
  assert.equal(at('Miete 01/2027'), '2027-01')
})

test('Monat im Zweck: mehrere Monate ergeben keinen', () => {
  assert.equal(at('Miete Oktober und November'), null)
  assert.equal(at('Miete 10/2026 und 11/2026'), null)
  assert.equal(at('Miete Okt-Nov 2026'), null)
  assert.equal(at('Miete November 2026 Rest 10/2026'), null)
})

test('Monat im Zweck: Fehlalarme. Datum ohne Bezug zur Miete, Dauerauftrag, Kaution, Abrechnung', () => {
  assert.equal(at('Rechnung vom 03.11.'), null)
  assert.equal(at('Rechnung vom 03.11.2026'), null)
  assert.equal(at('Rechnung 4711 vom 3. November 2026'), null)
  assert.equal(at('Dauerauftrag seit Mai'), null)
  assert.equal(at('Miete Dauerauftrag seit Mai 2024'), null)
  assert.equal(at('Miete ab Januar 2027 neu'), null)
  assert.equal(at('Miete bis November'), null)
  assert.equal(at('Kaution 2. Rate November'), null)
  assert.equal(at('Kautionsrate Miete November 2026'), null)
  assert.equal(at('Nachzahlung Nebenkostenabrechnung 2025, Miete November'), null)
  assert.equal(at('Miete, Ihre Abrechnung vom November'), null)
  assert.equal(at('November 2026'), null, 'ohne das Wort Miete kein Bezug')
  assert.equal(at('Miete'), null)
  assert.equal(at(''), null)
  // Ein Tag vor oder eine Zahl nach dem Monatsnamen ist ein Datum, kein Monat.
  assert.equal(at('Miete, ueberwiesen am 3. November'), null)
  assert.equal(at('Miete 03.11.2026'), null)
  assert.equal(at('Miete November 26'), null)
  // Namen, die einen Monat nur enthalten.
  assert.equal(at('Miete Maier'), null)
  assert.equal(at('Miete Augustastr. 5'), null)
  assert.equal(at('Miete Whg Junior'), null)
})

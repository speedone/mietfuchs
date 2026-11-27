// Der Monat laut Verwendungszweck (#693): nur, was eindeutig ein Monat der Miete ist. Die Tabelle ist die der Durchsicht
// (86 Zwecke, wie Banken sie liefern: groß, ohne Umlaute, mit Zusätzen, Namen und Straßen, die wie Monate heißen).
// **Kein Zweck darf einen falschen Monat ergeben**; ein verpasster ist hingenommen und steht hier ausdrücklich als
// `missed`, damit eine spätere Lockerung der Regel ihn bewusst umstellt.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { monthInPurpose } from '../src/bank/purposeMonth.ts'

const D = '2026-11-03'
type Case = readonly [purpose: string, bookingDate: string, month: string | null]

// Erkannt: genau dieser Monat.
const FOUND: readonly Case[] = [
  ['Miete November', D, '2026-11'], ['MIETE NOVEMBER 2026', D, '2026-11'], ['SVWZ+Miete November', D, '2026-11'],
  ['EREF+NOTPROVIDED SVWZ+MIETE NOV 2026', D, '2026-11'], ['Miete 11-2026 Müller', D, '2026-11'],
  ['Miete März Str. 5', '2026-03-02', '2026-03'], ['Restmiete Oktober', D, '2026-10'], ['Miete Oktober abzgl. Minderung', D, '2026-10'],
  ['Miete Dezember', '2026-11-28', '2026-12'], ['Miete Dezember', '2027-01-04', '2026-12'], ['Miete Januar', '2026-02-10', '2026-01'],
  ['Miete Januar', '2026-12-29', '2027-01'], ['Miete Januar', '2026-12-28', '2027-01'], ['Miete Januar 2027', '2026-11-28', '2027-01'],
  ['MIETE MAERZ', '2026-03-02', '2026-03'], ['Miete Marz', '2026-03-02', '2026-03'], ['Miete 2026-11', D, '2026-11'], ['Miete 11.2026', D, '2026-11'],
  ['Miete 12/2026 12345 Berlin', D, '2026-12'], ['Miete November Whg 3', D, '2026-11'], ['Kaltmiete November + NK', D, '2026-11'],
  ['Miete Nov2026', D, '2026-11'], ['Miete Dez 2025', D, '2025-12'], ['Miete Oktober Revolution', D, '2026-10'],
  // Weitere Formen
  ['Miete Nov. 2026', D, '2026-11'], ['Mietzahlung fuer Oktober', D, '2026-10'], ['Miete für den Monat November', D, '2026-11'],
  ['Kaltmiete + NK Dezember 2026', '2026-12-01', '2026-12'], ['Miete/Dezember/2026', '2026-12-01', '2026-12'],
  ['SVWZ+Miete Mai 2026 EREF+NOTPROVIDED', '2026-05-04', '2026-05'], ['Miete August 2026', '2026-08-03', '2026-08'],
  ['MIETE 1/2027 WOHNUNG 2', '2026-12-29', '2027-01'], ['Miete 01/2027', '2026-12-29', '2027-01'], ['Miete November 2025', D, '2025-11'],
]

// Kein Vorschlag, und das ist richtig: Name, Straße, Kennziffer, Datum, Zeitraum, mehrere Monate.
const NONE: readonly (readonly [string, string])[] = [
  ['MIETE NOV 26', D], ['Miete Nov./Dez.', D], ['Miete u. NK 11/26', D], ['Miete August Schmidt', D], ['Mietkaution', D],
  ['Nachzahlung Miete Oktober', D], ['Miete Jan Müller', D], ['MIETE JAN KOWALSKI', D], ['Mieter Jan Kowalski', D],
  ['Miete August-Bebel-Str. 12', D], ['Miete Whg 3 August-Bebel-Str', D], ['Miete Juli Zeh', D], ['Miete April Meier', D],
  ['Miete Fam. Mai', D], ['Miete Jan-Mär', '2026-01-05'], ['Miete Jan/Feb', D], ['Miete Januar + Februar', D],
  ['Miete Januar', '2026-11-28'], ['MIETE NOVEM\nBER', D], ['MIETE NOVEM BER 2026', D], ['Miete 01.11.-30.11.2026', D],
  ['Miete 03.11.2026', D], ['Miete 2026-11-03', D], ['Miete 11 2026', D], ['Miete Vertrag 03/2025', D], ['Miete Kd-Nr 10/2025', D],
  ['Miete Whg 5/2026', D], ['Miete Musterstr 12-2026 Berlin', D], ['EREF+2025/03 SVWZ+Miete', D], ['MREF+M-2025-05 SVWZ+Miete', D],
  ['Miete DE02 1203 0000 2026 05', D], ['Miete seit Mai', D], ['Dauerauftrag Miete ab 01/2026', D],
  ['Miete für November, Rest Oktober folgt', D], ['Miete Monat 11', D], ['Miete Jun Wang', D], ['Miete Rudolf-Sept-Weg', D],
  ['Miete Strasse des 17. Juni 5', D], ['Miete Platz der Oktoberrevolution', D], ['Miete 1. Mai Str. 3', D], ['Miete Mai-Str. 3', D],
  ['Miete Am Maifeld', D], ['Miete Wohnung 4.2026', D], ['Miete lt. MV v. 1.4.2025', D], ['Miete Nov Rueckstand Jan', D],
  ['Miete November\nJan Mueller', D], ['Jan Mueller Miete November', D],
  // Weitere Fehlalarme: Datum ohne Bezug zur Miete, Dauerauftrag, Kaution, Abrechnung, unplausibles Jahr.
  ['Rechnung vom 03.11.', D], ['Rechnung vom 03.11.2026', D], ['Rechnung 4711 vom 3. November 2026', D], ['Dauerauftrag seit Mai', D],
  ['Miete Dauerauftrag seit Mai 2024', D], ['Miete ab Januar 2027 neu', D], ['Miete bis November', D], ['Kaution 2. Rate November', D],
  ['Kautionsrate Miete November 2026', D], ['Nachzahlung Nebenkostenabrechnung 2025, Miete November', D],
  ['Miete, Ihre Abrechnung vom November', D], ['November 2026', D], ['Miete', D], ['', D], ['Miete, ueberwiesen am 3. November', D],
  ['Miete November 26', D], ['Miete Maier', D], ['Miete Augustastr. 5', D], ['Miete Whg Junior', D], ['Miete 11/26', D], ['Miete 11', D],
  ['Miete 13/2026', D], ['Miete 2026', D], ['Miete November 2019', D], ['Miete 11/2031', D], ['Miete Oktober und November', D],
  ['Miete 10/2026 und 11/2026', D], ['Miete Okt-Nov 2026', D], ['Miete November 2026 Rest 10/2026', D], ['Miete Oktober-Str. 4', D],
  ['Miete Februar', D], ['Miete Juni', D], ['Miete Nachzahlung 2024', D], ['Nachzahlung 2024 Miete Dezember', D],
  ['Miete Dezember 2025 und Januar 2026', '2026-01-05'], ['Miete 12/2026-01/2027', '2026-12-29'],
]

// Verpasst: Ein Mensch läse den Monat, die Regel lässt ihn aus, weil dieselbe Form sonst Fehlalarme ergäbe.
const MISSED: readonly Case[] = [
  ['Miete Mai Mayer', '2026-05-04', '2026-05'], ['Miete Stellplatz 11/2026', D, '2026-11'], ['Miete Wohnung Mai', '2026-06-02', '2026-05'],
  ['MIETE NOV EMBER', D, '2026-11'], ['MIETE DEZ EMBER', '2026-12-01', '2026-12'], ['Miete Mrz.', '2026-03-02', '2026-03'],
  ['Miete Sept.', '2026-09-01', '2026-09'], ['Miete Mai Dauerauftrag seit Januar', '2026-05-04', '2026-05'],
  ['Miete November 3. OG', D, '2026-11'], ['Miete 850,00 November', D, '2026-11'], ['Miete Okt. verspaetet', D, '2026-10'],
  ['Miete Praxis Dr. Mai 11/2026', D, '2026-11'], ['Miete Rueckstand Januar', D, '2026-01'], ['MIETE 11/2026 MUELLER, JAN', D, '2026-11'],
  ['Miete 11/2026 August Schmidt', D, '2026-11'], ['Miete November 11/2026', D, '2026-11'],
]

test('Monat im Zweck: erkannt wird genau der gemeinte Monat', () => {
  for (const [purpose, date, month] of FOUND) assert.equal(monthInPurpose(purpose, date), month, `${JSON.stringify(purpose)} am ${date}`)
})

test('Monat im Zweck: kein Vorschlag bei Namen, Straßen, Kennziffern, Daten, Zeiträumen und mehreren Monaten', () => {
  for (const [purpose, date] of NONE) assert.equal(monthInPurpose(purpose, date), null, `${JSON.stringify(purpose)} am ${date}`)
})

test('Monat im Zweck: hingenommene Lücken ergeben keinen Vorschlag, nie einen anderen Monat', () => {
  for (const [purpose, date] of MISSED) assert.equal(monthInPurpose(purpose, date), null, `${JSON.stringify(purpose)} am ${date}`)
})

test('Monat im Zweck: ohne Jahr nur von zwei Monaten zurück bis einen voraus, über den Jahreswechsel', () => {
  const months = (bookingDate: string) => ['Januar', 'Februar', 'März', 'Juni', 'September', 'Oktober', 'November', 'Dezember']
    .flatMap((name) => { const m = monthInPurpose(`Miete ${name}`, bookingDate); return m === null ? [] : [m] })
  assert.deepEqual(months('2026-11-03'), ['2026-09', '2026-10', '2026-11', '2026-12'])
  assert.deepEqual(months('2026-12-28'), ['2027-01', '2026-10', '2026-11', '2026-12'])
  assert.deepEqual(months('2027-01-04'), ['2027-01', '2027-02', '2026-11', '2026-12'])
  assert.deepEqual(months('2026-02-10'), ['2026-01', '2026-02', '2026-03', '2025-12'])
})

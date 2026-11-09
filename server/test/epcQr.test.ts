// Der Inhalt des Zahlungs-QR-Codes nach EPC069-12 v3.0 (#624): Zeilen, Grenzen, Zeichen, EWR, 331 Byte.
import test from 'node:test'
import assert from 'node:assert/strict'
import { EPC_MAX_BYTES, epcBlocked, epcPayload, epcText } from '../../shared/epcQr.ts'

const DE = 'DE02 1203 0000 0000 2020 51'
const bytes = (s: string): number => new TextEncoder().encode(s).length
const lines = (p: string | null): string[] => {
  if (p === null) assert.fail('kein Inhalt erzeugt')
  return p.split('\n')
}
const base = { name: 'Max Vermieter', iban: DE, amountCents: 12345, purpose: 'Erika Mustermann, EG links, Nebenkostenabrechnung 2025' }

test('Musterinhalt Zeile für Zeile', () => {
  assert.equal(epcPayload(base), ['BCD', '002', '1', 'SCT', '', 'Max Vermieter', 'DE02120300000000202051', 'EUR123.45', '', '', 'Erika Mustermann, EG links, Nebenkostenabrechnung 2025'].join('\n'))
})

test('Betrag an den Grenzen', () => {
  assert.equal(lines(epcPayload({ ...base, amountCents: 1 }))[7], 'EUR0.01')
  assert.equal(lines(epcPayload({ ...base, amountCents: 100 }))[7], 'EUR1.00')
  assert.equal(lines(epcPayload({ ...base, amountCents: 99999999999 }))[7], 'EUR999999999.99')
  for (const amountCents of [0, -5, 100000000000, 1.5, Number.NaN]) assert.equal(epcPayload({ ...base, amountCents }), null, String(amountCents))
})

test('IBAN: normalisiert, geprüft und nur aus dem EWR', () => {
  assert.equal(lines(epcPayload({ ...base, iban: ' de02 1203 0000 0000 2020 51 ' }))[6], 'DE02120300000000202051')
  assert.equal(epcPayload({ ...base, iban: 'DE03 1203 0000 0000 2020 51' }), null)
  assert.equal(epcPayload({ ...base, iban: '' }), null)
  // gültig, aber außerhalb des EWR: ohne BIC nicht erlaubt
  assert.equal(epcPayload({ ...base, iban: 'CH93 0076 2011 6238 5295 7' }), null)
  assert.equal(epcPayload({ ...base, iban: 'GB29 NWBK 6016 1331 9268 19' }), null)
  for (const iban of ['AT61 1904 3002 3457 3201', 'NO93 8601 1117 947', 'LI21 0881 0000 2324 013A A']) {
    assert.equal(lines(epcPayload({ ...base, iban }))[6], iban.replace(/ /g, ''), iban)
  }
})

test('Name: Pflicht und höchstens 70 Zeichen', () => {
  assert.equal(epcPayload({ ...base, name: '   ' }), null)
  assert.equal(epcPayload({ ...base, name: '🏠' }), null)
  assert.equal(lines(epcPayload({ ...base, name: 'a'.repeat(80) }))[5], 'a'.repeat(70))
})

test('Zeichen: SEPA-Zeichensatz mit Umlauten', () => {
  assert.equal(epcText('Müller–Lüdenscheidt „Haus“ · é\u2014x\n\ty 🏠'), "Müller-Lüdenscheidt 'Haus' , e-x y")
  assert.equal(epcText('Straße {Ä} <Ö> Ü_ä#ö~ü'), 'Straße Ä Ö Üäöü')
})

test('Verwendungszweck: leer, gekürzt, Name vorn bleibt', () => {
  // EPC069-12 v3.0, Abschnitt 3.2: nach dem letzten belegten Element folgt kein Trenner mehr.
  const empty = epcPayload({ ...base, purpose: '' })
  assert.equal(empty, ['BCD', '002', '1', 'SCT', '', 'Max Vermieter', 'DE02120300000000202051', 'EUR123.45'].join('\n'))
  assert.equal(lines(epcPayload({ ...base, purpose: 'x'.repeat(200) }))[10], 'x'.repeat(140))
  const long = lines(epcPayload({ ...base, purpose: 'Erika Mustermann-Lüdenscheidt, 1. OG rechts, Betriebskosten 2026, darin Heiz- und Warmwasserkosten 01.05.2025–30.04.2026' }))[10] ?? ''
  assert.ok(long.startsWith('Erika Mustermann-Lüdenscheidt, 1. OG rechts'), long)
  assert.ok(long.length <= 140)
  assert.ok(long.includes('01.05.2025-30.04.2026') || long.length === 140, long)
  assert.equal(lines(epcPayload({ ...base, purpose: 'Zeile eins\nZeile zwei' }))[10], 'Zeile eins Zeile zwei')
})

test('331 Byte: Zweck zuerst gekürzt, nie ein halbes Zeichen', () => {
  const p = epcPayload({ ...base, name: 'ä'.repeat(70), purpose: 'ü'.repeat(140) })
  if (p === null) assert.fail('kein Inhalt')
  assert.ok(bytes(p) <= EPC_MAX_BYTES, String(bytes(p)))
  const l = lines(p)
  assert.equal(l[5], 'ä'.repeat(70))
  assert.match(l[10] ?? '', /^ü+$/)
  assert.ok(!p.includes('�'))
  // genau an der Grenze bleibt alles stehen
  const exact = epcPayload({ ...base, name: 'ä'.repeat(70), purpose: 'ü'.repeat(70) })
  if (exact === null) assert.fail('kein Inhalt')
  assert.equal(bytes(exact), EPC_MAX_BYTES)
  assert.equal(lines(exact)[10], 'ü'.repeat(70))
})

test('kein Zeilenumbruch am Ende', () => {
  const p = epcPayload(base)
  assert.ok(p !== null && !p.endsWith('\n'))
})

test('epcBlocked nennt den Grund, warum kein Code entsteht', () => {
  const reason = '(braucht Vermieter und gültige IBAN aus dem EWR)'
  assert.equal(epcBlocked({ landlordName: '', iban: DE }), reason)
  assert.equal(epcBlocked({ landlordName: 'Max', iban: 'CH93 0076 2011 6238 5295 7' }), reason)
  assert.equal(epcBlocked({ landlordName: 'Max', iban: '' }), reason)
  assert.equal(epcBlocked({ landlordName: 'Max', iban: DE }), null)
})

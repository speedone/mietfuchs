// Die Prüfung einer IBAN nach ISO 13616 (#279) in shared/iban.ts. Oberfläche und Server fragen
// dieselbe Funktion, deshalb steht ihr Test einmal hier.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkIban, formatIban, IBAN_LENGTHS, isValidIban, normalizeIban, sameIban } from '../../shared/iban.ts'

// Bekannte Muster-IBANs, keine echten Konten.
const GUELTIG = [
  'DE89370400440532013000',
  'DE02120300000000202051',
  'GB82WEST12345698765432',
  'FR1420041010050500013M02606',
  'NL91ABNA0417164300',
  'CH9300762011623852957',
  'AT611904300234573201',
  'NO9386011117947',
  'BE68539007547034',
]

const problemOf = (iban: string): string => {
  const check = checkIban(iban)
  if (check.ok) return assert.fail(`„${iban}“ hätte abgelehnt werden müssen.`)
  return check.problem
}

test('Gültige Muster-IBANs mehrerer Länder werden angenommen', () => {
  for (const iban of GUELTIG) assert.deepEqual(checkIban(iban), { ok: true, iban }, iban)
})

test('Leerzeichen und Kleinbuchstaben werden angenommen und normiert', () => {
  assert.deepEqual(checkIban('de89 3704 0044 0532 0130 00'), { ok: true, iban: 'DE89370400440532013000' })
  // Geschütztes Leerzeichen und Tabulator, wie sie beim Kopieren aus einem PDF mitkommen
  assert.deepEqual(checkIban(' DE89 3704\t0044 0532 0130 00 '), { ok: true, iban: 'DE89370400440532013000' })
  assert.equal(normalizeIban('gb82 west 1234 5698 7654 32'), 'GB82WEST12345698765432')
})

test('Anzeige in Vierergruppen; eine ungültige bleibt, wie sie ist', () => {
  assert.equal(formatIban('DE89370400440532013000'), 'DE89 3704 0044 0532 0130 00')
  assert.equal(formatIban('no9386011117947'), 'NO93 8601 1117 947')
  assert.equal(formatIban('DE00 3704 0044 0532 0130 00'), 'DE00 3704 0044 0532 0130 00')
})

test('Jeder einzelne Tippfehler in einer Ziffer wird erkannt', () => {
  for (const iban of GUELTIG) {
    for (let i = 2; i < iban.length; i++) {
      const ziffer = iban[i]
      if (ziffer === undefined || !/\d/.test(ziffer)) continue
      for (let d = 0; d <= 9; d++) {
        if (String(d) === ziffer) continue
        const vertippt = iban.slice(0, i) + String(d) + iban.slice(i + 1)
        assert.equal(isValidIban(vertippt), false, `${vertippt} (Stelle ${i + 1})`)
      }
    }
  }
})

test('Jeder Dreher zweier benachbarter Ziffern wird erkannt', () => {
  for (const iban of GUELTIG) {
    for (let i = 2; i < iban.length - 1; i++) {
      const a = iban[i]
      const b = iban[i + 1]
      if (a === undefined || b === undefined || a === b || !/\d/.test(a) || !/\d/.test(b)) continue
      const gedreht = iban.slice(0, i) + b + a + iban.slice(i + 2)
      assert.equal(isValidIban(gedreht), false, `${gedreht} (Stellen ${i + 1}/${i + 2})`)
    }
  }
})

test('Falsche Länge nennt die erwartete Länge', () => {
  assert.match(problemOf('DE8937040044053201300'), /DE hat 22 Zeichen, eingetragen sind 21/)
  assert.match(problemOf('DE893704004405320130000'), /DE hat 22 Zeichen, eingetragen sind 23/)
})

test('Unbekannte Länderkennung und fehlende Länderkennung', () => {
  assert.match(problemOf('XX89370400440532013000'), /„XX“ gehört zu keinem Land/)
  assert.match(problemOf('1289370400440532013000'), /Länderkennung aus zwei Buchstaben/)
})

test('Unzulässige Zeichen werden benannt', () => {
  assert.match(problemOf('DE89-3704-0044-0532-0130-00'), /unzulässige Zeichen/)
  assert.match(problemOf('DE89370400440532Ö13000'), /unzulässige Zeichen/)
})

test('Falsche Prüfziffer, auch die nie vergebenen 00, 01 und 99', () => {
  assert.match(problemOf('DE00370400440532013000'), /Prüfziffer stimmt nicht/)
  assert.match(problemOf('DE88370400440532013000'), /Prüfziffer stimmt nicht/)
  for (const p of ['00', '01', '99']) assert.match(problemOf(`DE${p}370400440532013000`), /Prüfziffer/)
  // Buchstaben an der Stelle der Prüfziffer
  assert.match(problemOf('DEAB370400440532013000'), /Prüfziffer/)
})

test('Leere Eingabe ist keine IBAN', () => {
  assert.equal(isValidIban(''), false)
  assert.equal(isValidIban('   '), false)
})

test('Die Längentabelle ist plausibel: zwei Großbuchstaben, 15 bis 34 Zeichen', () => {
  assert.ok(Object.keys(IBAN_LENGTHS).length >= 80)
  for (const [land, laenge] of Object.entries(IBAN_LENGTHS)) {
    assert.match(land, /^[A-Z]{2}$/)
    assert.ok(laenge >= 15 && laenge <= 34, `${land}: ${laenge}`)
  }
  assert.equal(IBAN_LENGTHS.DE, 22)
})

test('Dieselbe IBAN, anders geschrieben', () => {
  assert.equal(sameIban('de89 3704 0044 0532 0130 00', 'DE89370400440532013000'), true)
  assert.equal(sameIban('', null), true)
  assert.equal(sameIban(undefined, null), true)
  assert.equal(sameIban('DE89370400440532013000', 'DE02120300000000202051'), false)
})

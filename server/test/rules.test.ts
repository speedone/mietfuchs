// Regelverzeichnis (#112): Regeln mit Gültigkeit, damit eine Abrechnung nach dem Recht ihres
// Jahres rechnet und nicht nach dem von heute.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RULES, ruleCoverage, rulesFor } from '../../shared/law/rules.ts'

test('Regeln: jede hat Code, Titel, Rechtsgrundlage und Kurzfassung, jeder Code einmal', () => {
  assert.ok(RULES.length > 0)
  for (const r of RULES) {
    assert.ok(r.code && r.title && r.norm && r.summary, r.code)
    if (r.validFrom && r.validTo) assert.ok(r.validFrom <= r.validTo, r.code)
  }
  assert.equal(new Set(RULES.map((r) => r.code)).size, RULES.length)
})

test('Kabelfernsehen: 2023 voll, 2024 teilweise, ab 2025 nicht mehr', () => {
  assert.equal(ruleCoverage('tv-signal', '2023-01-01', '2023-12-31'), 'full')
  assert.equal(ruleCoverage('tv-signal', '2024-01-01', '2024-12-31'), 'partial')
  assert.equal(ruleCoverage('tv-signal', '2024-01-01', '2024-06-30'), 'full')
  assert.equal(ruleCoverage('tv-signal', '2024-07-01', '2024-12-31'), 'none')
  assert.equal(ruleCoverage('tv-signal', '2025-01-01', '2025-12-31'), 'none')
})

test('rulesFor nennt nur Regeln, deren Gültigkeit den Zeitraum berührt', () => {
  const codes = (y: number) => rulesFor(`${y}-01-01`, `${y}-12-31`).map((r) => r.code)
  assert.ok(codes(2023).includes('tv-signal'))
  assert.ok(codes(2024).includes('tv-signal'))
  assert.ok(!codes(2025).includes('tv-signal'))
  assert.ok(codes(2025).includes('heating-flat-rate'))
})

test('Unbekannter Code ist ein Programmfehler und keine stille Antwort', () => {
  assert.throws(() => ruleCoverage('gibt-es-nicht', '2025-01-01', '2025-12-31'))
})

test('§ 5a: die Regel co2-half-split gilt ab 2028, nicht 2027 (Heizung PR 18)', () => {
  assert.equal(ruleCoverage('co2-half-split', '2027-01-01', '2027-12-31'), 'none')
  assert.equal(ruleCoverage('co2-half-split', '2027-05-01', '2028-04-30'), 'partial')
  assert.equal(ruleCoverage('co2-half-split', '2028-01-01', '2028-12-31'), 'full')
  const r = RULES.find((x) => x.code === 'co2-half-split') ?? assert.fail('keine Regel')
  // Prüfung M9: die gemeinsame Wärmeversorgung gehört zur Ausnahme; K2: die Grenze beim Biobrennstoff.
  assert.match(r.summary, /beide an derselben Heizung hängen/)
  assert.match(r.summary, /höchstens für 30 % des verbrauchten Brennstoffs/)
})

test('§ 6 Abs. 2: die Regel co2-self-supply gilt ab 2023 (Heizung PR 19)', () => {
  assert.equal(ruleCoverage('co2-self-supply', '2022-01-01', '2022-12-31'), 'none')
  assert.equal(ruleCoverage('co2-self-supply', '2023-01-01', '2023-12-31'), 'full')
  const r = RULES.find((x) => x.code === 'co2-self-supply') ?? assert.fail('keine Regel')
  // Prüfung S3: § 5a erst ab 2028, Biobrennstoff ab 2029, Ausnahmen; Verrechnen nur bei vereinbarter Vorauszahlung.
  assert.match(r.summary, /ab dem 01\.01\.2028 die Hälfte der CO₂-Kosten und der Gasnetzentgelte, ab dem 01\.01\.2029 auch die Hälfte der Kosten für den Pflichtanteil an Biobrennstoff/)
  assert.match(r.summary, /außer in den Fällen von § 5a Abs\. 4 und § 5d/)
  assert.match(r.summary, /binnen 12 Monaten nach der Abrechnung seines Lieferanten in Textform/)
  assert.match(r.summary, /Ist eine Vorauszahlung vereinbart, kann der Vermieter ihn in der nächsten Betriebskostenabrechnung verrechnen; sonst zahlt er spätestens 12 Monate nach der Anzeige/)
  assert.match(r.summary, /zentrale Heizung, deren Brennstoff er selbst bezieht/)
})

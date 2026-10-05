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

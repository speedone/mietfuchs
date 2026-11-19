// Ergebnisse je Bestand merken (#651, Schritt 3): Abrechnung, Steuer und Verbrauch hängen nur am Bestand und am
// Tag. Der Bestand aus `readStock` ist eingefroren und bleibt derselbe, bis geschrieben wird; dieselbe Frage an
// denselben Bestand bekommt deshalb dieselbe Antwort, ohne neu zu rechnen.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { onStock } from '../src/stockMemo.ts'

const frozenStock = () => Object.freeze({ units: Object.freeze([]) })

test('Ergebnis je Bestand: dieselbe Frage an denselben Bestand rechnet einmal', () => {
  const stock = frozenStock()
  let runs = 0
  const first = onStock(stock, 'abrechnung:objekt-1:2025', () => { runs++; return { total: 1 } })
  const second = onStock(stock, 'abrechnung:objekt-1:2025', () => { runs++; return { total: 2 } })
  assert.equal(second, first)
  assert.equal(runs, 1)
})

test('Ergebnis je Bestand: andere Frage oder anderer Bestand rechnet neu', () => {
  const stock = frozenStock()
  let runs = 0
  onStock(stock, 'a', () => ++runs)
  onStock(stock, 'b', () => ++runs)
  onStock(frozenStock(), 'a', () => ++runs)
  assert.equal(runs, 3)
})

test('Ergebnis je Bestand: ein offener Bestand wird nie gemerkt', () => {
  // Ein Schnappschuss aus Tests oder dem Umstieg ist nicht eingefroren und kann sich ändern.
  const stock = { units: [] }
  let runs = 0
  onStock(stock, 'a', () => ++runs)
  onStock(stock, 'a', () => ++runs)
  assert.equal(runs, 2)
})

test('Ergebnis je Bestand: ein Fehler wird nicht gemerkt, das Ergebnis ist eingefroren', () => {
  const stock = frozenStock()
  assert.throws(() => onStock(stock, 'a', () => { throw new Error('kaputt') }), /kaputt/)
  const result = onStock(stock, 'a', () => ({ rows: [{ cents: 1 }] }))
  assert.equal(onStock(stock, 'a', () => ({ rows: [] })), result)
  const row = result.rows[0]
  if (!row) return assert.fail('die Zeile fehlt')
  assert.throws(() => { row.cents = 2 }, TypeError)
  assert.throws(() => { result.rows.push({ cents: 3 }) }, TypeError)
})

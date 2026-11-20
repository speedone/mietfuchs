// Ergebnisse je Bestand merken (#651, Schritt 3).
//
// Abrechnung, Steuer und Verbrauch hängen nur am Bestand und am Tag (`asOf`). Der Bestand aus `readStock` ist tief
// eingefroren und bleibt derselbe Gegenstand, bis geschrieben wird (db/stockCache.ts). Dieselbe Frage an denselben
// Bestand bekommt deshalb dieselbe Antwort, ohne neu zu rechnen: das Cockpit und die Seite „Abrechnung“ teilen die
// Abrechnung, die Steuer eines Objekts und die Übersicht aller Objekte teilen die Steuer je Objekt.
//
// **Der Schlüssel muss alles nennen, woran das Ergebnis außer dem Bestand hängt**: Objekt, Zeitraum oder Jahr und den
// Tag, mit dem gerechnet wird. Ein offener (nicht eingefrorener) Bestand, etwa ein Schnappschuss aus einem Test,
// wird nie gemerkt. Ein Fehler wird nicht gemerkt. Das Ergebnis wird tief eingefroren, weil es allen folgenden
// Anfragen gehört; wer es verändern will, kopiert.

import { deepFreeze } from './db/stockCache.ts'

const memos = new WeakMap<object, Map<string, unknown>>()
// Je Bestand begrenzt: Er lebt nur bis zum nächsten Schreiben, ein Server ohne Schreiben über Tage sammelte sonst
// je Tag, Objekt und Jahr ein Ergebnis an.
const MAX_PER_STOCK = 200

export function onStock<T>(stock: object, key: string, compute: () => T): T {
  if (!Object.isFrozen(stock)) return compute()
  let memo = memos.get(stock)
  if (!memo) memos.set(stock, (memo = new Map()))
  if (memo.has(key)) return memo.get(key) as T
  const value = deepFreeze(compute())
  if (memo.size >= MAX_PER_STOCK) memo.clear()
  memo.set(key, value)
  return value
}

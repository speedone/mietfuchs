// Ob ein gelesener Bestand noch gilt (#651).
//
// `readStock` liest alle Tabellen der Installation, bei einem großen Bestand rund 190 ms, und das
// bisher bei jeder Anfrage, die rechnet oder eine Liste zeigt. Gelesen und geschrieben wird aber
// nur durch die Schlange (createLane in open.ts), also lässt sich genau sagen, wann sich etwas
// geändert haben kann: nach einem eigenen Schreibvorgang oder wenn eine zweite Verbindung
// festgeschrieben hat (`PRAGMA data_version`: ein Test mit `besideServer` oder ein zweites Programm
// auf derselben Datei). `total_changes()` fängt dazu eigene Änderungen an `write` vorbei ab.
//
// Die Datenbank meldet dazu eine **Marke**: eine Zeichenkette, die sich bei jeder solchen Änderung
// ändert, und `null`, solange ein Schreibvorgang läuft. Während des Schreibens gibt es keinen
// gültigen Stand, denn der Vorgang sieht seine eigenen, noch nicht abgeschlossenen Änderungen.
//
// Eigenes Modul ohne Abhängigkeiten, weil open.ts die Marke anmeldet und read.ts sie abfragt, und
// keine der beiden Dateien die andere importieren soll.

export type StockMark = () => string | null

const marks = new WeakMap<object, StockMark>()

// Meldet die Marke einer Verbindung an. Nur open.ts tut das, für die Verbindung des Servers;
// eine Transaktion oder eine zweite Verbindung hat keine und wird immer frisch gelesen.
export function registerStockMark(db: object, mark: StockMark): void {
  marks.set(db, mark)
}

// Die Marke des Augenblicks, oder `null`, wenn der Bestand frisch zu lesen ist.
export function stockMarkOf(db: object): string | null {
  return marks.get(db)?.() ?? null
}

// Tief einfrieren, auch in ein schon (flach) eingefrorenes Objekt hinein; `seen` hält Kreise aus, die es im
// Bestand nicht gibt. Für den Bestand (read.ts) und die daraus gemerkten Ergebnisse (stockMemo.ts).
export function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  Object.freeze(value)
  for (const key of Object.keys(value)) deepFreeze(Reflect.get(value, key), seen)
  return value
}

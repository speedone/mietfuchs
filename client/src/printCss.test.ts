// Sichtprüfung E46: Beim Druck aller Abrechnungen (Strg+P) begann die zweite mitten auf einer Seite,
// und zwischen den Abrechnungen stand der Schatten der Karte als Linie. Geprüft wird der Quelltext
// des Stylesheets, denn jsdom kennt weder Druck noch Seitenumbrüche.
import { expect, test } from 'vitest'

// Gelesen mit node:fs; ein Import mit `?raw` ergäbe unter vitest einen leeren Text, und der Client
// hat keine Node-Typen, deshalb der Name als Ausdruck.
const fsModule = 'node:fs'
const fs = (await import(/* @vite-ignore */ fsModule)) as { readFileSync: (path: URL, encoding: 'utf8') => string }
const css = fs.readFileSync(new URL('./index.css', import.meta.url), 'utf8')
const printBlocks = [...css.matchAll(/@media print \{([\s\S]*?)\n\}/g)].map((m) => m[1] ?? '').join('\n')

test('im Druck kein Schatten der Karten und jede weitere Abrechnung auf einer neuen Seite', () => {
  expect(printBlocks).toMatch(/\.card \{[^}]*box-shadow: none/)
  expect(printBlocks).toMatch(/body:not\(\.print-one\) \.card\.statement ~ \.card\.statement \{[^}]*break-before: page/)
})

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

// S1 der Durchsicht (#346, Schritt 4): Der Druck ist immer hell, weil die dunklen Tokens nur am
// Bildschirm gelten. Zöge jemand den Block aus `@media not print` heraus, druckte das dunkle Design
// dunkel; S6 fände den Block trotzdem.
test('die dunklen Tokens gelten nur am Bildschirm', () => {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '')
  expect([...plain.matchAll(/data-theme='dark'\]\s*\{/g)].length).toBe(1)
  const notPrint = plain.match(/@media not print \{\s*:root\[data-theme='dark'\] \{([^}]*)\}\s*\}/)
  expect(notPrint, 'der dunkle Token-Block steht nicht allein in @media not print').not.toBeNull()
  expect(notPrint?.[1]).toContain('color-scheme: dark')
  expect([...plain.matchAll(/color-scheme:\s*dark/g)].length).toBe(1)
})

// S2 der Durchsicht: Überschriften bleiben im Druck bei ihrem Inhalt, kleine Blöcke werden nicht
// geteilt. Karten selbst dürfen umbrechen, eine Abrechnung ist oft länger als eine Seite.
test('im Druck keine Überschrift allein am Seitenende und keine geteilten kleinen Blöcke', () => {
  expect(printBlocks).toMatch(/h1, h2, h3, h4[^{]*\{[^}]*break-after: avoid/)
  expect(printBlocks).toMatch(/\.kpi[^{]*\{[^}]*break-inside: avoid/)
  expect(printBlocks).not.toMatch(/(^|[\s,(])\.card(?![\w.-])[^{]*\{[^}]*break-inside: avoid/)
})

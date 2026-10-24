// Durchsicht zu PR #427, S1: Die Fußzeile mit Kontakt und Bank steht im Druck unten im Brief (`position: absolute`). Ohne
// freigehaltenen Platz überdruckte sie die Unterschrift, sobald das Anschreiben über eine Seite lief (nachgemessen: Unterschrift
// 15,9 mm, Fußzeile 16,4 mm auf Seite 2). Geprüft wird das Stylesheet, denn jsdom kennt keinen Druck; die Lage selbst hat eine
// Druckprobe mit page.pdf gemessen (PR-Text).
import { expect, test } from 'vitest'

const fsModule = 'node:fs'
const fs = (await import(/* @vite-ignore */ fsModule)) as { readFileSync: (path: URL, encoding: 'utf8') => string }
const css = fs.readFileSync(new URL('./letter.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const print = [...css.matchAll(/@media print \{([\s\S]*?)\n\}/g)].map((m) => m[1] ?? '').join('\n')
const mm = (rule: RegExp, prop: string): number => {
  const block = print.match(rule)?.[1] ?? ''
  const value = block.match(new RegExp(`${prop}:\\s*([\\d.]+)mm`))?.[1]
  return value === undefined ? Number.NaN : Number(value)
}

test('S1: mit Fußzeile hält der Brieftext unten mindestens so viel Platz frei, wie die Fußzeile braucht', () => {
  const reserved = mm(/\.letter-with-footer \.letter-body \{([^}]*)\}/, 'padding-bottom')
  expect(reserved).toBeGreaterThanOrEqual(12)
  // Die Fußzeile steht am unteren Rand des Briefs, nicht frei auf der Seite.
  expect(print).toMatch(/\.letter-footer \{[^}]*position: absolute;[^}]*bottom: 0/)
})

// Druck (#415): Anschreiben und Aufstellung haben dieselben Ränder nach DIN 5008, links 25 mm, rechts 20 mm. Die Seite
// selbst hat überall 12 mm Rand (Chromium legt alle Seiten in einer Breite an, und die Falzmarken stehen im Bereich 12 bis
// 17 mm); den Rest hält im Brief der Text, in der Aufstellung die Zelle der Hülle `PrintPages` frei. Vorher begann die
// Aufstellung 12 mm von der Kante, der Brief 25 mm.
test('Anschreiben und Aufstellung: dieselben Ränder, links 25 mm und rechts 20 mm von der Blattkante', () => {
  const page = Number(css.match(/@page \{ size: A4; margin: ([\d.]+)mm; \}/)?.[1])
  expect(page).toBe(12)
  const left = mm(/\n\s*\.print-pages-cell \{([^}]*)\}/, 'padding-left')
  const right = mm(/\n\s*\.print-pages-cell \{([^}]*)\}/, 'padding-right')
  expect(page + left).toBe(25)
  expect(page + right).toBe(20)
  expect(print).toMatch(/\.letter-body \{ padding: calc\(98\.46mm - var\(--page\)\) calc\(20mm - var\(--page\)\) 0 calc\(25mm - var\(--page\)\); \}/)
  // Mit Briefpapier gelten die Ränder des Briefpapiers.
  expect(print).toMatch(/\.paper-print \.print-pages-cell \{ padding: 0 var\(--paper-right\) 0 var\(--paper-left\); \}/)
})

// Druck (#415): Der Kopf der Abrechnung und der Informationsblock sind Tabellen aus Beschriftung und Wert.
test('Informationsblock und Kopf der Abrechnung stehen im Druck zweispaltig', () => {
  expect(css).toMatch(/\.letter-info \{[^}]*display: grid;[^}]*grid-template-columns: max-content/)
  expect(css).toMatch(/\.statement-facts \{[^}]*display: grid;[^}]*grid-template-columns: max-content/)
})

test('K7: die Rücksendeangabe darf zweizeilig umbrechen und bleibt in der Vermerkzone', () => {
  const rule = print.match(/\.letter-return \{([^}]*)\}/)?.[1] ?? ''
  expect(rule).not.toMatch(/white-space: nowrap/)
  expect(rule).toMatch(/max-height: 2\.4em/)
})

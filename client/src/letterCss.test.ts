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

test('K7: die Rücksendeangabe darf zweizeilig umbrechen und bleibt in der Vermerkzone', () => {
  const rule = print.match(/\.letter-return \{([^}]*)\}/)?.[1] ?? ''
  expect(rule).not.toMatch(/white-space: nowrap/)
  expect(rule).toMatch(/max-height: 2\.4em/)
})

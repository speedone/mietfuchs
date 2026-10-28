// Die Monatskachel im Mietkonto ist für offene Monate ein Knopf, sonst ein div. Ein Knopf erbt die Schrift
// nicht (Bedienelemente haben eine eigene Zeilenhöhe), also erbt `.rent-month` die ganze Schrift, damit beide
// gleich aussehen. Geprüft am Quelltext, denn jsdom rechnet keine Stile.
import { expect, test } from 'vitest'

// Wie in printCss.test.ts: node:fs als Ausdruck, denn der Client hat keine Node-Typen.
const fsModule = 'node:fs'
const fs = (await import(/* @vite-ignore */ fsModule)) as { readFileSync: (path: URL, encoding: 'utf8') => string }
const css = fs.readFileSync(new URL('./index.css', import.meta.url), 'utf8')

test('Mietkonto: die Monatskachel erbt die ganze Schrift, auch als Knopf', () => {
  const rule = css.match(/^\.rent-month \{[^}]*\}/m)?.[0] ?? expect.fail('Regel .rent-month fehlt')
  expect(rule).toMatch(/font: inherit;/)
  // Die Kurzform setzt die Größe zurück, also steht sie vor `font-size`.
  expect(rule.indexOf('font: inherit')).toBeLessThan(rule.indexOf('font-size'))
})

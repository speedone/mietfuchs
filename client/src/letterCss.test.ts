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

// Druck in Safari (#286, nachgemessen mit WKWebView, Workflow „Druck in Safari“): WebKit wiederholt `thead` und `tfoot`
// nicht je Druckseite, kennt keine Randfelder von `@page` und nimmt die Ränder der ersten Seite für alle. Wächter, dass
// der Druck sich nicht wieder darauf stützt: Ränder kommen aus `@page` (ohne Briefpapier) bzw. aus dem Innenabstand des
// Rahmens, den `box-decoration-break: clone` je Seite wiederholt (mit Briefpapier, nur wo der Browser das kann,
// `canPagePaper`); kein Tabellenkopf oder -fuß hält einen Rand frei, und der Fußvermerk wird nie ausgeblendet.
const sources = ['./index.css', './letter.css', './fields.css', './reading-sheet.css', './tw.css']
  .map((f) => fs.readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')).join('\n')
const rules = (src: string): { selector: string, body: string }[] =>
  [...src.matchAll(/([^{}@;]+)\{([^{}]*)\}/g)].map((m) => ({ selector: (m[1] ?? '').trim(), body: m[2] ?? '' }))

test('kein Tabellenkopf oder -fuß der Hülle hält einen Rand frei', () => {
  const holders = rules(print).filter((r) => /thead|tfoot|print-pages-spacer|print-pages-follow/.test(r.selector) && /(^|;)\s*(height|min-height|padding(-top|-bottom)?)\s*:/.test(r.body))
  expect(holders.map((r) => r.selector)).toEqual([])
  // Mit Briefpapier: oben und unten der Innenabstand des Rahmens, auf jeder Druckseite wiederholt.
  const frame = rules(print).find((r) => r.selector === '.paper-print .print-pages-frame')?.body ?? ''
  expect(frame).toMatch(/padding: var\(--paper-top\) 0 var\(--paper-bottom\)/)
  expect(frame).toMatch(/(^|[\s;])box-decoration-break: clone/)
  expect(frame).toMatch(/-webkit-box-decoration-break: clone/)
})

test('der Fußvermerk steht im Fluss und wird nirgends ausgeblendet', () => {
  const hidden = rules(sources).filter((r) => /statement-footnote/.test(r.selector) && /display:\s*none/.test(r.body))
  expect(hidden.map((r) => r.selector)).toEqual([])
  // Im Druck ist der Fuß der Hülle ein Tabellenfuß: Chromium und Firefox wiederholen ihn je Seite, Safari druckt ihn
  // einmal am Ende der Aufstellung.
  expect(print).toMatch(/\.print-pages > tfoot \{ display: table-footer-group; \}/)
  // Mutationsprobe: ein ausgeblendeter Fußvermerk fiele auf.
  expect(rules('@media print { .statement-footnote { display: none !important; } }').filter((r) => /statement-footnote/.test(r.selector) && /display:\s*none/.test(r.body))).toHaveLength(1)
})

// WebKit legt die Druckseite 1,25-mal so breit an, wie die Seite in Punkt misst (`printingMinimumShrinkFactor`), und
// verkleinert dann auf die Seite: alles rund 7 % größer, ohne breiten Inhalt (nachgemessen: 4,52 statt 4,23 mm Schrift).
// Ist das Dokument im Druck so breit wie der Satzspiegel, druckt WebKit im Maßstab 1:1 wie Chromium.
test('im Druck ist das Dokument so breit wie die Seite ohne Rand', () => {
  const page = Number(css.match(/@page \{ size: A4; margin: ([\d.]+)mm; \}/)?.[1])
  const width = Number(css.match(/@media print \{ body \{ width: ([\d.]+)mm; \} \}/)?.[1])
  expect(width).toBe(210 - 2 * page)
})

// Auch Chromium auf dem Mac: Die E-Mail im Informationsblock ragte mit der Schrift des Systems 1,9 mm über den rechten
// Rand (Druck in Safari, #286). Sie bricht um, statt hinauszuragen.
test('der Informationsblock bricht lange Angaben um, statt über den Rand zu ragen', () => {
  expect(css).toMatch(/\.letter-info \{[^}]*overflow-wrap: anywhere/)
})

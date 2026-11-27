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
// Nur dort (Durchsicht K1 zu PR #443): In Chromium und Firefox machte die feste Breite die Skalierung des Druckdialogs
// wirkungslos (mit 80 % stand der Text nur auf 80 % der Breite). Erkannt wie beim Briefpapier (`canPagePaper`), aber in
// JS (`markPrintWidth`, letterDesignView.ts): Ein `@supports not (box-decoration-break: clone)` schreibt der Build um
// und nimmt die Angabe mit Präfix dazu, die WebKit kennt; dann galt die Breite nirgends (Lauf auf dem Mac).
test('im Druck ist das Dokument in WebKit so breit wie die Seite ohne Rand, sonst nicht', () => {
  const page = Number(css.match(/@page \{ size: A4; margin: ([\d.]+)mm; \}/)?.[1])
  const width = Number(css.match(/@media print \{ html\.print-fixed-width body \{ width: ([\d.]+)mm; \} \}/)?.[1])
  expect(width).toBe(210 - 2 * page)
  // Keine Breite des Dokuments außerhalb dieser Bedingung und keine Bedingung, die der Build umschreibt.
  expect([...css.matchAll(/body \{ width:/g)]).toHaveLength(1)
  expect(css).not.toMatch(/@supports[^{]*box-decoration-break/)
  const main = fs.readFileSync(new URL('./main.tsx', import.meta.url), 'utf8')
  expect(main).toMatch(/markPrintWidth\(document\.documentElement\)/)
})

// Auch Chromium auf dem Mac: Die E-Mail im Informationsblock ragte mit der Schrift des Systems 1,9 mm über den rechten
// Rand (Druck in Safari, #286). Sie bricht um, statt hinauszuragen.
test('der Informationsblock bricht lange Angaben um, statt über den Rand zu ragen', () => {
  expect(css).toMatch(/\.letter-info \{[^}]*overflow-wrap: anywhere/)
})

// Zahlungs-QR-Code (#624, Durchsicht zum Satz): Am Handy bleibt neben dem Code rund ein halbes Fenster; zwei Spalten mit
// „Verwendungszweck“ ließen dem Wert wenige Pixel, und IBAN und Zweck brachen fast je Zeichen um. Bis 640 px steht die
// Beschriftung über dem Wert wie im Ergebniskasten; der Druck bleibt zweispaltig.
test('Zahlungs-QR am Handy: Beschriftung über dem Wert', () => {
  const phone = [...css.matchAll(/@media screen and \(max-width: 640px\) \{([\s\S]*?)\n\}/g)].map((m) => m[1] ?? '').join('\n')
  expect(phone).toMatch(/\.payment-qr-facts \{[^}]*grid-template-columns: minmax\(0, 1fr\)/)
})

// #735: Kopf- und Fußzeilen des Browsers (Adresse, Datum, Seitenzahl) stehen im Seitenrand. Chromium druckt dort keine,
// wo ein Randfeld steht (nachgemessen: oben und unten je ein leeres genügt, „Seite x von y“ rechts unten bleibt), Firefox
// keine bei Rand 0 (nachgemessen; `nsPageFrame::DrawHeaderFooter` zeichnet nur, wenn die Zeile in den Rand passt). Dort
// (`print-page-edge`, letterDesignView.ts) hält body die 12 mm frei, auf jeder Druckseite, also stehen Brief und
// Aufstellung, wo sie mit Rand standen.
test('#735: leere Randfelder oben und unten, und ohne Seitenrand derselbe Abstand als Innenabstand von body', () => {
  const page = Number(css.match(/@page \{ size: A4; margin: ([\d.]+)mm; \}/)?.[1])
  expect(css).toMatch(/@page \{ @top-center \{ content: ""; \} @bottom-center \{ content: ""; \} \}/)
  const edge = rules(print).find((r) => r.selector === 'html.print-page-edge body')?.body ?? ''
  expect(Number(edge.match(/(?:^|;)\s*padding: ([\d.]+)mm/)?.[1])).toBe(page)
  expect(edge).toMatch(/(^|[\s;])box-decoration-break: clone/)
  expect(edge).toMatch(/-webkit-box-decoration-break: clone/)
  const main = fs.readFileSync(new URL('./main.tsx', import.meta.url), 'utf8')
  expect(main).toMatch(/markPageEdges\(document\)/)
})

// #691, im Druck gemessen (scripts/print-width-check.mjs, Fall `abrechnung-briefpapier`): Nach dem Anschreiben beginnt der
// Rahmen der Aufstellung eine Seite, und der Abstand zwischen den Teilen einer Karte (12 px) schob das Briefpapier dieser
// einen Seite 3,2 mm nach unten. Wächter, dass der Abstand dort null bleibt.
test('Briefpapier nach dem Anschreiben: der Rahmen der Aufstellung beginnt ohne Abstand oben', () => {
  // Auch der Rahmen der Belegkopien, der immer eine Seite beginnt (ohne Anschreiben lag er sonst weiter 3,2 mm tiefer)
  const frame = rules(print).find((r) => r.selector === '.paper-print .letter:not(.letter-top) ~ .print-pages-frame, .paper-print .print-pages-frame.print-pages-new')?.body ?? ''
  expect(frame).toMatch(/margin-top: 0(;|\s|$)/)
})

// #691, Durchsicht: Ohne Anschreiben beginnt der Rahmen an der Blattkante (er rückt um die Höhe des Kopfs zurück), und
// die Zelle hält genau diese Höhe samt dem Abstand der Karte frei; beide Angaben gehören zusammen, sonst wandert der Text.
test('Briefpapier ohne Anschreiben: der Rahmen rückt um die Höhe des Kopfs zurück, die Zelle hält sie frei', () => {
  const head = rules(print).find((r) => r.selector === '.paper-print .letter.letter-top')?.body ?? ''
  expect(head).toContain('height: calc(98.46mm - 2mm - var(--paper-top));')
  const frame = rules(print).find((r) => r.selector === '.paper-print .letter.letter-top ~ .print-pages-frame:not(.print-pages-new)')?.body ?? ''
  // Der Kopf selbst steht 12 px unter dem Anfang der Karte (Abstand ihrer Teile); der Rahmen rückt auch darum zurück, sonst
  // lag das Papier der Folgeseiten auf Seite 1 bei 3,2 bis 300,3 mm (nachgemessen)
  expect(frame).toContain('margin-top: calc(var(--paper-top) + 2mm - 98.46mm - 12px);')
  const cell = rules(print).find((r) => r.selector === '.paper-print .letter.letter-top ~ .print-pages-frame:not(.print-pages-new) > .print-pages > tbody > tr > .print-pages-cell')?.body ?? ''
  expect(cell).toContain('padding-top: calc(98.46mm - 2mm - var(--paper-top) + 24px);')
})

// #691: Das Logo auf Briefpapier steht zwischen dem Rand oben und dem Informationsblock; die Maße sind die von `logoBox`
// (letterDesignView.ts), nach denen Vorschau und Hinweis im Seitenfenster rechnen.
test('Logo auf Briefpapier: ab dem Rand oben, vor dem Informationsblock, mit den Maßen von logoBox', async () => {
  const { LOGO_BOTTOM_LIMIT_MM, LOGO_MAX_HEIGHT_MM, LOGO_TOP_MM } = await import('./letterDesignView')
  const logo = rules(print).find((r) => r.selector === '.paper-print .letter-logo')?.body ?? ''
  expect(logo).toContain(`top: max(${LOGO_TOP_MM}mm, var(--paper-top));`)
  expect(logo).toContain(`max-height: max(0mm, min(${LOGO_MAX_HEIGHT_MM}mm, calc(${LOGO_BOTTOM_LIMIT_MM}mm - max(${LOGO_TOP_MM}mm, var(--paper-top)))));`)
  // Ohne Briefpapier dieselben Ausgangsmaße
  expect(print).toMatch(new RegExp(`\\.letter-logo \\{ top: calc\\(${LOGO_TOP_MM}mm - var\\(--page\\)\\);[^}]*max-height: ${LOGO_MAX_HEIGHT_MM}mm;`))
})

// #691, Durchsicht: Ohne Anschreiben liegen auf Seite 1 das Papier der ersten Seite und das der Folgeseiten übereinander;
// sein weißer Grund deckt das untere zu, auch in einem Browser, der Hintergründe sonst weglässt.
test('Briefpapier: das Papier der ersten Seite druckt seinen Grund immer', () => {
  const paper = rules(print).find((r) => r.selector === '.letter-paper')?.body ?? ''
  expect(paper).toContain('-webkit-print-color-adjust: exact;')
  expect(paper).toContain('print-color-adjust: exact;')
  expect(paper).toContain('background: var(--card);')
})

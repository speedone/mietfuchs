// Wächter zur Sichtprüfung der Oberfläche (S1–S12): Die Gestaltung hängt an wenigen zentralen Regeln
// in index.css. Jede der Ursachen, die die Sichtprüfung gefunden hat, kam dadurch zustande, dass eine
// Seite an diesen Regeln vorbei etwas Eigenes tat. Geprüft wird der Quelltext, denn jsdom rechnet
// kein Layout und keine Farben.
import { describe, expect, test } from 'vitest'
import { NAV } from './nav'

const sources = import.meta.glob<string>(['./**/*.tsx', '!./**/*.test.tsx', '!./testing/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
})
// Gelesen mit node:fs wie in printCss.test.ts; ein Import mit `?raw` ergäbe für CSS einen leeren Text.
const fsModule = 'node:fs'
const fs = (await import(/* @vite-ignore */ fsModule)) as { readFileSync: (path: URL, encoding: 'utf8') => string }
const css = fs.readFileSync(new URL('./index.css', import.meta.url), 'utf8')

const files = Object.keys(sources)
const offenders = (pattern: RegExp) =>
  files.flatMap((file) => [...(sources[file] ?? '').matchAll(pattern)].map((m) => `${file}: ${m[0].slice(0, 120)}`))

test('der Wächter sieht die Seiten und Bausteine', () => {
  // Fände das Muster keine Dateien, wäre jeder Test hier grün, ohne etwas zu prüfen.
  expect(files).toContain('./pages/Stammdaten.tsx')
  expect(files).toContain('./components/PropertyCard.tsx')
  expect(css).toContain('--accent-text')
})

// S1: Abstände setzt die Regel für Karten, Drawer, aufklappbare Bereiche und Panels. Ein
// style={{ marginTop }} flickte das Loch an einer Stelle und ließ es an der nächsten offen.
test('S1: keine Abstände als Inline-Stil', () => {
  expect(offenders(/style=\{\{[^}]*\bmargin\w*:/g)).toEqual([])
})

// S3: Steht ein Kästchen als erstes Kind in label.field (einer Spalte), steht es über seiner
// Beschriftung. Kästchen gehören in label.checkline oder in label.field.checkline > span.
test('S3: kein Kontrollkästchen als erstes Kind von label.field', () => {
  expect(offenders(/<label className="field(?![^"]*checkline)[^"]*"[^>]*>\s*<input[^>]*type="(?:checkbox|radio)"/g)).toEqual([])
  expect(offenders(/<label className="field"[^>]*style=\{\{[^}]*flexDirection: 'row'/g)).toEqual([])
})

// S4: Jede Klasse, die eine Seite oder ein Baustein setzt, hat eine Regel im Stylesheet. Vorher
// setzten neue Bausteine 15 Klassen ohne Regel, und ihre Bereiche standen ungestaltet da.
test('S4: jede verwendete Klasse hat eine Regel in index.css', () => {
  const defined = new Set([...css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]))
  const used = new Map<string, string>()
  const add = (text: string, file: string) => {
    for (const word of text.split(/\s+/)) if (/^[a-z][\w-]*$/.test(word) && !used.has(word)) used.set(word, file)
  }
  for (const file of files) {
    const src = sources[file] ?? ''
    for (const m of src.matchAll(/className=(?:"([^"]*)"|\{([^}]*(?:\{[^}]*\}[^}]*)*)\})/g)) {
      if (m[1] !== undefined) {
        add(m[1], file)
        continue
      }
      const expr = m[2] ?? ''
      // Zeichenketten im Ausdruck; in Vorlagen nur die festen Teile außerhalb von ${…}
      // Zeichenketten, mit denen nur verglichen wird (`level === 'leer'`), sind keine Klassen.
      for (const s of expr.matchAll(/(?<![=!]==\s*)(?:'([^']*)'|"([^"]*)")(?!\s*[=!]==)/g)) add(s[1] ?? s[2] ?? '', file)
      for (const t of expr.matchAll(/`([^`]*)`/g)) add((t[1] ?? '').replace(/\$\{[^}]*\}/g, ' '), file)
    }
  }
  expect(used.size).toBeGreaterThan(100)
  const missing = [...used].filter(([c]) => !defined.has(c)).map(([c, file]) => `${c} (${file})`)
  expect(missing).toEqual([])
})

// S5: <Term id="…" /> ohne Text gibt den Titel des Begriffs aus. Hinter einem eigenen Wort
// doppelte das den Wortlaut („CO₂-Kosten CO₂-Kostenaufteilung“). Der Begriff steht als Wort im Satz.
test('S5: kein Begriff ohne eigenen Text hinter einem Wort oder in einer Überschrift', () => {
  expect(offenders(/<h[1-4][^>]*>[^<]*<Term id="[^"]+" \/>/g)).toEqual([])
  expect(offenders(/[\p{L}\p{N})}]\s+<Term id="[^"]+" \/>/gu)).toEqual([])
})

// S6: Schrift in Akzentfarbe erreicht in beiden Designs auf Karte und Akzentfläche mindestens
// 4,5:1 (WCAG 2.1 AA, Fließtext). Vorher 3,1:1 im Dunkelmodus.
describe('S6: Kontrast der Farbtöne', () => {
  const block = (selector: string) => {
    const start = css.indexOf(`${selector} {`)
    if (start < 0) throw new Error(`Block ${selector} fehlt in index.css`)
    return css.slice(start, css.indexOf('}', start))
  }
  const token = (body: string, name: string) => {
    const m = body.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))
    if (!m?.[1]) throw new Error(`--${name} fehlt`)
    return m[1]
  }
  const luminance = (hex: string) => {
    const n = parseInt(hex.slice(1), 16)
    const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
      const c = v / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
  }
  const ratio = (a: string, b: string) => {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
    return ((x ?? 0) + 0.05) / ((y ?? 0) + 0.05)
  }
  const light = block(':root')
  const dark = block(":root[data-theme='dark']")
  for (const [name, body] of [['hell', light], ['dunkel', dark]] as const) {
    test(`${name}: Akzentschrift auf Karte und Akzentfläche, Weiß auf Akzent, gedämpfte Schrift`, () => {
      expect(ratio(token(body, 'accent-text'), token(body, 'card'))).toBeGreaterThanOrEqual(4.5)
      expect(ratio(token(body, 'accent-text'), token(body, 'accent-soft'))).toBeGreaterThanOrEqual(4.5)
      expect(ratio('#ffffff', token(body, 'accent'))).toBeGreaterThanOrEqual(4.5)
      expect(ratio(token(body, 'muted'), token(body, 'card'))).toBeGreaterThanOrEqual(4.5)
      expect(ratio(token(body, 'muted'), token(body, 'bg'))).toBeGreaterThanOrEqual(4.5)
      expect(ratio(token(body, 'text'), token(body, 'accent-soft'))).toBeGreaterThanOrEqual(4.5)
    })
  }
  test('Schrift in Akzentfarbe nimmt --accent-text, nicht --accent', () => {
    expect([...css.matchAll(/(?<![-\w])color:\s*var\(--accent\)/g)].length).toBe(0)
  })
})

// S7: Rot heißt Gefahr. Ein Geisterknopf („Abbrechen“, „Ändern“) wird beim Überfahren nicht rot.
test('S7: nur ein Löschknopf wird beim Überfahren rot', () => {
  const ghostHover = css.match(/button\.btn\.ghost:hover \{([^}]*)\}/)?.[1] ?? ''
  expect(ghostHover).not.toBe('')
  expect(ghostHover).not.toContain('--red')
  expect(css).toMatch(/\.danger-ghost:hover \{[^}]*--red/)
})

// S9: Links in Akzentschrift statt Browserblau
test('S9: Links haben eine Regel', () => {
  expect(css).toMatch(/(^|\n)a \{[^}]*color: var\(--accent-text\)/)
})

// S11: Der Titel einer Seite heißt wie ihr Eintrag in der Navigation.
test('S11: Seitentitel beginnt mit dem Namen in der Navigation', () => {
  const fileOf: Record<string, string> = {
    cockpit: 'Cockpit', schnellerfassung: 'Schnellerfassung', zaehler: 'Zaehler', kosten: 'Kosten', belege: 'Belege',
    mietkonto: 'Mietkonto', heizkosten: 'Heizkosten', abrechnung: 'Abrechnung', uebersicht: 'Uebersicht', steuer: 'Steuer',
    stammdaten: 'Stammdaten', einstellungen: 'Einstellungen', hilfe: 'Hilfe',
  }
  const wrong = NAV.flatMap((g) => g.items).flatMap((item) => {
    const src = sources[`./pages/${fileOf[item.id] ?? '?'}.tsx`] ?? ''
    const m = src.match(/<PageHeader[\s\S]*?title=(?:"([^"]*)"|\{`([^`]*)`\})/)
    const title = m?.[1] ?? m?.[2] ?? ''
    return title.startsWith(item.label) ? [] : [`${item.id}: „${title}“ statt „${item.label}“`]
  })
  expect(wrong).toEqual([])
})

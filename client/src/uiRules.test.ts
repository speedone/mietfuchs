// Wächter zur Sichtprüfung der Oberfläche (S1–S12, S17 und S20 zu Tailwind): Die Gestaltung hängt an wenigen zentralen Regeln
// in index.css. Jede der Ursachen, die die Sichtprüfung gefunden hat, kam dadurch zustande, dass eine
// Seite an diesen Regeln vorbei etwas Eigenes tat. Geprüft wird der Quelltext, denn jsdom rechnet
// kein Layout und keine Farben.
import { Scanner } from '@tailwindcss/oxide'
import { compile } from 'tailwindcss'
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
const twCss = fs.readFileSync(new URL('./tw.css', import.meta.url), 'utf8')

// Tailwind (#346) mit dem Theme aus tw.css, ohne index.css und ohne die Einschränkungen der Suche
// (`@source`): Gefragt wird, welche Klassennamen Tailwind als Utility kennt.
const compileTw = (source: string) => compile(
  source.replace(/@import "\.\/index\.css"[^;]*;/, '').replace(/@source[^;]*;/g, ''),
  {
    base: '.',
    loadStylesheet: async (id) => ({
      path: id,
      base: '.',
      content: fs.readFileSync(new URL(`../node_modules/${id}`, import.meta.url), 'utf8'),
    }),
  },
)
const tailwind = await compileTw(twCss)
// Derselbe Compiler mit der Standardpalette (ohne `--color-*: initial`): Nur so lässt sich fragen,
// ob ein Wort eine Farbe der Palette wäre; im echten Theme erzeugt `bg-blue-500` nichts.
const tailwindWithPalette = await compileTw(twCss.replace(/--color-\*:\s*initial;/, ''))
/** Die Namen unter `names`, für die Tailwind eine Utility erzeugt. */
const tailwindUtilities = (names: Iterable<string>, compiler = tailwind): Set<string> => {
  const wanted = [...new Set(names)]
  const out = compiler.build(wanted)
  const produced = new Set([...out.matchAll(/\.((?:\\.|[\w-])+)/g)].map((m) => (m[1] ?? '').replace(/\\(.)/g, '$1')))
  return new Set(wanted.filter((n) => produced.has(n)))
}

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

// Durchsicht von #236: Ein Dateifeld mit `hidden` oder display: none ist per Tab nicht erreichbar.
// Es wird nur visuell versteckt (sr-only), der sichtbare Knopf zeigt den Fokus.
test('Dateifelder bleiben per Tastatur erreichbar', () => {
  expect(offenders(/<input(?=[^>]*type="file")[^>]*(?:\shidden[\s/>]|display: 'none')[^>]*>/g)).toEqual([])
})

// S4: Jede Klasse, die eine Seite oder ein Baustein setzt, hat eine Regel im Stylesheet. Vorher
// setzten neue Bausteine 15 Klassen ohne Regel, und ihre Bereiche standen ungestaltet da.
// Klassen, die nur als Haken für Tests oder Skripte dienen und bewusst keine Gestaltung haben.
const HOOK_CLASSES = new Set(['assessment-review'])

// Nur Selektoren zählen: ohne Kommentare und ohne den Inhalt der Regeln (Werte wie url(x.png)).
const cssSelectors = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)].map((m) => m[1] ?? '').join(' ')
const definedClasses = new Set([...cssSelectors.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1] ?? ''))

/** Jedes Wort, das eine Seite oder ein Baustein als Klasse setzt, mit der ersten Datei. */
const classWords = (() => {
  const used = new Map<string, string>()
  const add = (text: string, file: string) => {
    for (const word of text.split(/\s+/)) if (word !== '' && !used.has(word)) used.set(word, file)
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
  return used
})()

test('S4: jede verwendete Klasse hat eine Regel in index.css oder ist eine Utility', () => {
  for (const hook of HOOK_CLASSES) expect(definedClasses.has(hook), `${hook} hat eine Regel; dann gehört es nicht in die Ausnahmeliste`).toBe(false)
  const used = [...classWords].filter(([c]) => /^[a-z][\w-]*$/.test(c))
  expect(used.length).toBeGreaterThan(100)
  const unknown = used.filter(([c]) => !definedClasses.has(c) && !HOOK_CLASSES.has(c))
  // Seit #346 hat eine Klasse auch dann eine Regel, wenn Tailwind sie als Utility erzeugt.
  const utilities = tailwindUtilities(unknown.map(([c]) => c))
  const missing = unknown.filter(([c]) => !utilities.has(c)).map(([c, file]) => `${c} (${file})`)
  expect(missing).toEqual([])
})

// S17 (Teil Tailwind, #346): Werte kommen aus den Tokens. Eine Klasse mit beliebigem Wert
// (`p-[13px]`, `bg-[#fff]`, `w-(--x)`) oder aus der Standardpalette (`bg-blue-500`, `text-white`)
// ginge an index.css vorbei und wechselte nicht mit dem dunklen Design. Die Palette ist in tw.css
// abgeschaltet; ohne diesen Test fiele eine solche Klasse nur dadurch auf, dass sie nichts bewirkt.
const PALETTE = 'slate|gray|zinc|neutral|stone|orange|yellow|lime|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|red|green|amber'
// Geprüft wird, was Tailwind selbst findet: jedes Wort in jeder .ts- und .tsx-Datei unter src außer
// Tests (dieselben Quellen wie in tw.css), gelesen mit dem Scanner von Tailwind, nicht nur
// `className=`. Klassen stehen auch in Konstanten und Helfern (Ampel, Variantentabellen).
const twSources = import.meta.glob<string>(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
})
const twCandidates = (() => {
  const scanner = new Scanner({})
  const found = new Map<string, string>()
  for (const [file, content] of Object.entries(twSources)) {
    const extension = file.endsWith('.tsx') ? 'tsx' : 'ts'
    for (const { candidate } of scanner.getCandidatesWithPositions({ content, extension })) {
      if (!found.has(candidate)) found.set(candidate, file)
    }
  }
  return found
})()
test('S17: keine beliebigen Werte und keine Standardpalette in Klassen', () => {
  expect(Object.keys(twSources)).toContain('./notices.ts')
  expect(twCandidates.size).toBeGreaterThan(1000)
  const withFile = (names: Set<string>) => [...names].map((c) => `${c} (${twCandidates.get(c)})`)
  // Erzeugt Tailwind aus einem Wort eine Utility mit beliebigem Wert, steht sie im gebauten CSS.
  const produced = tailwindUtilities(twCandidates.keys())
  expect(withFile(new Set([...produced].filter((c) => /[[\]()]/.test(c))))).toEqual([])
  // Palette: Unsere Tokens heißen teils wie Farben der Palette (`text-red`, `bg-green-soft`);
  // verboten sind die Stufen (`-500`) und Weiß/Schwarz, und nur, wo Tailwind daraus eine Farbe machte.
  const palette = new RegExp(`(?:^|:)!?-?[a-z-]+-(?:(?:${PALETTE})-\\d{2,3}|white|black)(?:/\\d+)?!?$`)
  const paletteWords = [...twCandidates.keys()].filter((c) => palette.test(c))
  expect(withFile(tailwindUtilities(paletteWords, tailwindWithPalette))).toEqual([])
})

// S17 (Teil Farben, #346 Schritt 4): Farben stehen nur in den Token-Blöcken. Eine Regel mit
// eigenem Farbwert wechselt nicht mit dem dunklen Design und läuft an der Gestaltung vorbei; sie
// nimmt ein Token (`var(--…)`), und eine neue Farbe kommt als Token-Paar hell/dunkel. Token-Blöcke
// sind genau die Regeln mit dem Selektor `:root` oder `:root[data-theme='dark']` (auch in @media);
// `:root .x` ist keiner. Als Farbe gilt ein Hex-Wert, eine Farbfunktion (rgb, hsl, hwb, lab, lch,
// oklab, oklch, color, color-mix) und ein benannter Farbwert; Namen von Variablen zählen nicht.
// Ausnahmen stehen mit Grund in der Liste und dürfen nur weniger werden.
const COLOR_EXCEPTIONS = new Map<string, string>([
  // heute keine
])
const TOKEN_SELECTORS = new Set([':root', ":root[data-theme='dark']"])
const NAMED_COLORS = new RegExp(`(?<![-\\w])(?:${'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'.split(' ').join('|')})(?![-\\w])`, 'i')
const colorOffenders = (source: string) =>
  [...source.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap((m) => {
    const selector = (m[1] ?? '').trim().replace(/\s+/g, ' ')
    if (TOKEN_SELECTORS.has(selector)) return []
    return (m[2] ?? '').split(';').flatMap((declaration) => {
      const colon = declaration.indexOf(':')
      if (colon < 0 || declaration.slice(0, colon).trim().startsWith('--')) return []
      const value = declaration.slice(colon + 1).replace(/var\([^()]*\)/g, ' ').replace(/(['"]).*?\1/g, ' ')
      const hit = value.match(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(/) ?? value.match(NAMED_COLORS)
      return hit ? [`${selector}: ${hit[0]}`] : []
    })
  })
test('S17: keine Farbwerte außerhalb der Token-Blöcke', () => {
  // Mutationsprobe: Der Prüfer findet eingeschleuste Farben jeder Schreibweise, auch in einem
  // @media-Block und hinter `:root …`, und lässt Token-Blöcke, Variablennamen und Schriftnamen in Ruhe.
  expect(colorOffenders([
    '.x { color: #123456; }',
    '@media print { .y { background: rgba(0, 0, 0, 0.1); } }',
    ':root .w { color: white; }',
    '.v { border-color: color-mix(in srgb, var(--red) 50%, transparent); }',
    '.u { box-shadow: 0 0 0 2px oklch(0.5 0.1 200); }',
    '.t { color: var(--red); font-family: \'Segoe UI\', sans-serif; --black: 1; }',
    ':root { --z: #fff; }',
    "@media not print { :root[data-theme='dark'] { --z: black; } }",
  ].join('\n'))).toEqual(['.x: #123456', '.y: rgba(', ':root .w: white', '.v: color-mix(', '.u: oklch('])
  expect(css).toContain('--bg: #')
  const found = [...colorOffenders(css), ...colorOffenders(twCss).map((o) => `tw.css ${o}`)]
  expect(found.filter((o) => !COLOR_EXCEPTIONS.has(o))).toEqual([])
  for (const exception of COLOR_EXCEPTIONS.keys()) expect(found, `${exception} kommt nicht mehr vor; aus der Liste streichen`).toContain(exception)
})

// S17 (Teil Schatten): Tailwinds Schatten tragen feste Farben (`rgb(0 0 0 / 0.1)`) und wechselten
// nicht mit dem dunklen Design. tw.css entfernt sie; es gibt nur die Tokens `shadow-1`, `shadow-2`, `shadow-pop`.
test('S17: keine Schatten aus der Standardskala, nur die Tokens', () => {
  const standard = ['shadow', 'shadow-xs', 'shadow-sm', 'shadow-md', 'shadow-lg', 'shadow-xl', 'shadow-2xl', 'inset-shadow-sm', 'drop-shadow-md', 'text-shadow-md']
  expect([...tailwindUtilities(standard)]).toEqual([])
  for (const name of ['shadow-1', 'shadow-2', 'shadow-pop']) {
    const out = tailwind.build([name])
    // build() liefert alles bisher Erzeugte mit; geprüft wird nur die Regel dieser Klasse.
    const rule = out.match(new RegExp(`\\.${name} \\{([^}]*)\\}`))?.[1] ?? ''
    expect(rule, name).toContain(`var(--${name})`)
    expect(rule, name).not.toMatch(/rgb\(|#[0-9a-f]{3,8}\b|oklch\(/i)
  }
})

// M1 der Durchsicht (#346, Schritt 4): Kästchen und Optionsfelder bekamen `box-shadow: none`, und
// die Fokusregel der Felder setzt `outline: none`; damit war ihr Fokus unsichtbar (WCAG 2.4.7).
// Jede Regel, die bei ihnen Schatten oder Umriss auf none setzt, braucht danach eine Fokusregel,
// die beide Arten mit dem Fokusrahmen zeigt.
test('Kästchen und Optionsfelder zeigen den Fokus', () => {
  const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: (m[1] ?? '').trim(), body: m[2] ?? '' }))
  const box = (sel: string) => /checkbox|radio/.test(sel)
  const hides = rules.flatMap((r, i) => (box(r.selector) && /(?:box-shadow|outline):\s*none/.test(r.body) ? [i] : []))
  expect(hides.length).toBeGreaterThan(0)
  const focus = rules.reduce((last, r, i) => (/checkbox/.test(r.selector) && /radio/.test(r.selector) && /:focus-visible/.test(r.selector) && /box-shadow:\s*var\(--focus-ring\)/.test(r.body) ? i : last), -1)
  expect(focus, 'Fokusregel für Kästchen und Optionsfelder fehlt').toBeGreaterThan(-1)
  expect(focus, 'die Fokusregel muss nach jeder Regel stehen, die den Schatten wegnimmt').toBeGreaterThan(Math.max(...hides))
})

// S5 der Durchsicht: Am Handy und mit Finger hat jedes Bedienelement mindestens --target (44 px)
// Tippfläche. Kleine Knöpfe behalten ihr Aussehen; ihre Tippfläche wächst über ::after.
test('kleine Knöpfe haben am Handy die volle Tippfläche', () => {
  const coarse = [...css.matchAll(/@media \(pointer: coarse\), \(max-width: 640px\) \{([\s\S]*?)\n\}/g)].map((m) => m[1] ?? '').join('\n')
  for (const sel of ['.btn.small', '.drawer-x', '.notice-action']) {
    const rule = [...coarse.matchAll(/([^{}]+)::after\s*\{([^{}]*)\}/g)].find((m) => (m[1] ?? '').includes(sel))
    expect(rule, `${sel}::after fehlt am Handy`).toBeDefined()
    expect(rule?.[2]).toMatch(/var\(--target\)/)
  }
})

// S20 (#346): index.css wird nur kleiner. Eine neue Klasse dort mit dem Namen einer Utility stünde
// zweimal da, in der Schicht legacy und darüber in utilities, und die Utility gewönne still.
// Die heutigen Namensgleichheiten bleiben, weil tw.css sie aus der Suche nimmt (`@source not
// inline`); jede von ihnen steht deshalb auch dort.
const LEGACY_UTILITY_NAMES = new Set(['sr-only', 'grow', 'grow-2'])
const INDEX_CSS_MAX_LINES = 955
test('S20: keine neue Klasse und keine Animation in index.css mit einem Namen aus Tailwind, und index.css wächst nicht', () => {
  expect(definedClasses.size).toBeGreaterThan(100)
  const clashes = tailwindUtilities(definedClasses)
  expect([...clashes].filter((c) => !LEGACY_UTILITY_NAMES.has(c))).toEqual([])
  for (const name of LEGACY_UTILITY_NAMES) {
    expect(clashes.has(name), `${name} ist keine Utility mehr und gehört nicht in die Ausnahmeliste`).toBe(true)
    expect(twCss, `${name} muss in tw.css von der Suche ausgenommen sein`).toMatch(new RegExp(`@source not inline\\("[^"]*\\b${name}(?![\\w-])`))
  }
  // Animationen aus index.css dürfen nicht heißen wie eine aus dem Theme: Tailwind schriebe dessen
  // @keyframes sonst ungeschichtet dazu, und sie gälten statt der eigenen (siehe tw.css).
  const themeCss = fs.readFileSync(new URL('../node_modules/tailwindcss/theme.css', import.meta.url), 'utf8')
  const themeKeyframes = new Set([...themeCss.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]))
  expect(themeKeyframes.size).toBeGreaterThan(0)
  const ownKeyframes = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1] ?? '')
  expect(ownKeyframes.length).toBeGreaterThan(0)
  expect(ownKeyframes.filter((k) => themeKeyframes.has(k))).toEqual([])
  expect(css.trimEnd().split('\n').length, 'index.css wird nur kleiner; nach dem Kürzen die Obergrenze senken').toBeLessThanOrEqual(INDEX_CSS_MAX_LINES)
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
  // Was das dunkle Design nicht neu setzt, gilt wie hell (etwa --primary-text).
  const tokenOr = (body: string, name: string) => (body.includes(`--${name}:`) ? token(body, name) : token(light, name))
  for (const [name, body] of [['hell', light], ['dunkel', dark]] as const) {
    test(`${name}: Akzentschrift auf Karte und Akzentfläche, Weiß auf Akzent, gedämpfte Schrift`, () => {
      expect(ratio(token(body, 'accent-text'), token(body, 'card'))).toBeGreaterThanOrEqual(4.5)
      expect(ratio(token(body, 'accent-text'), token(body, 'accent-soft'))).toBeGreaterThanOrEqual(4.5)
      expect(ratio('#ffffff', token(body, 'accent'))).toBeGreaterThanOrEqual(4.5)
      expect(ratio(token(body, 'muted'), token(body, 'card'))).toBeGreaterThanOrEqual(4.5)
      expect(ratio(token(body, 'muted'), token(body, 'bg'))).toBeGreaterThanOrEqual(4.5)
      expect(ratio(token(body, 'muted'), token(body, 'chip'))).toBeGreaterThanOrEqual(4.5)
      expect(ratio(token(body, 'muted'), token(body, 'accent-soft'))).toBeGreaterThanOrEqual(4.5)
      expect(ratio(token(body, 'text'), token(body, 'accent-soft'))).toBeGreaterThanOrEqual(4.5)
    })
    // Gestaltung „Mittelweg“ (#346, Schritt 4): die Paare, die neu dazukamen.
    test(`${name}: Knöpfe, Links auf der Seite, aktiver Menüpunkt, Schrift auf Hover-Fläche`, () => {
      const t = (n: string) => tokenOr(body, n)
      for (const fill of ['primary', 'primary-hover', 'danger', 'danger-hover']) {
        expect(ratio(t('primary-text'), t(fill)), `Schrift auf --${fill}`).toBeGreaterThanOrEqual(4.5)
      }
      expect(ratio(t('accent-text'), t('bg')), 'Links auf dem Seitengrund').toBeGreaterThanOrEqual(4.5)
      expect(ratio(t('accent-text'), t('hover')), 'Links auf Hover-Fläche').toBeGreaterThanOrEqual(4.5)
      expect(ratio(t('accent-strong'), t('accent-soft')), 'aktiver Menüpunkt, Objekt-Marke').toBeGreaterThanOrEqual(4.5)
      expect(ratio(t('sidebar-text'), t('sidebar')), 'Menüpunkte').toBeGreaterThanOrEqual(4.5)
      expect(ratio(t('sidebar-text'), t('hover')), 'Menüpunkt beim Überfahren').toBeGreaterThanOrEqual(4.5)
      expect(ratio(t('muted'), t('hover')), 'Nebentext auf Hover-Fläche').toBeGreaterThanOrEqual(4.5)
      expect(ratio(t('text'), t('hover')), 'Text auf Summen- und Rechenwegzeilen').toBeGreaterThanOrEqual(4.5)
      expect(ratio(t('red'), t('red-soft')), 'Fehlermeldung').toBeGreaterThanOrEqual(4.5)
      expect(ratio(t('amber'), t('amber-soft')), 'Warnung').toBeGreaterThanOrEqual(4.5)
      expect(ratio(t('green'), t('green-soft')), 'Erfolg').toBeGreaterThanOrEqual(4.5)
      expect(ratio(t('brand-text'), t('brand')), 'Update-Knopf').toBeGreaterThanOrEqual(4.5)
    })
    // K6 der Durchsicht: Die Kontur eines Eingabefelds erreicht 3:1 (WCAG 1.4.11) gegen Karte,
    // Seitengrund und Feldgrund.
    test(`${name}: Feldrand gegen Karte, Seite und Feld`, () => {
      const t = (n: string) => tokenOr(body, n)
      for (const ground of ['card', 'bg', 'input-bg']) {
        expect(ratio(t('input-border'), t(ground)), `--input-border auf --${ground}`).toBeGreaterThanOrEqual(3)
      }
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

// #346: Der Druck ist immer hell (index.css setzt die Tokens im Druck auf hell). `dark:` gilt
// deshalb nur am Bildschirm, sonst druckte eine `dark:`-Klasse mit eigenem Wert dunkel.
test('dark: gilt nicht im Druck', () => {
  const out = tailwind.build(['dark:bg-card'])
  const rule = out.slice(out.indexOf('@layer utilities'))
  expect(rule).toContain('[data-theme=dark]')
  expect(rule).toMatch(/@media not print\s*\{\s*\.dark\\:bg-card/)
})

// S12 (Spezifikation Abschnitt 9, #346 Schritt 9): Dialoge (`<dialog>`, `showModal()`, `role="dialog"`
// und `role="alertdialog"`) nur in den Bausteinen, die dafür vorgesehen sind. Ein eigenes Overlay je Seite
// brächte je eigene Regeln für Esc, Fokus und Klick daneben. Heute: das Menüblatt am Handy, das
// Seitenfenster und die Rückfrage (die beiden ziehen mit Schritt 1 und 2 auf `<dialog>` um).
const DIALOG_FILES = new Set(['./components/MobileNav.tsx', './components/Drawer.tsx', './components/feedback.tsx'])
const dialogUses = (src: string) => [...src.matchAll(/<dialog\b|\bshowModal\s*\(|role=["'{`]+(?:alert)?dialog\b/g)].map((m) => m[0])
test('S12: Dialoge nur in den erlaubten Bausteinen', () => {
  // Probe des Prüfers: Er findet alle Schreibweisen.
  expect(dialogUses('<dialog open>…</dialog>; ref.current.showModal(); <div role="dialog"> <div role={"alertdialog"}>'))
    .toEqual(['<dialog', 'showModal(', 'role="dialog', 'role={"alertdialog'])
  for (const file of DIALOG_FILES) expect(dialogUses(sources[file] ?? ''), `${file} nutzt keinen <dialog> mehr; aus der Liste streichen`).not.toEqual([])
  expect(files.filter((file) => !DIALOG_FILES.has(file) && dialogUses(sources[file] ?? '').length > 0)).toEqual([])
})

// S22 (#346 Schritt 9): Die Navigation steht einmal, in nav.ts. Seitenleiste, Menüblatt und untere
// Leiste lesen sie von dort (navFor, bottomNav); eine zweite Liste mit Kennung und Beschriftung liefe
// auseinander, sobald eine Seite dazukommt oder umbenannt wird.
const TAB_IDS = NAV.flatMap((g) => g.items.map((i) => i.id))
// Ein Objekt mit einer Seitenkennung als `id` und einer Beschriftung oder einem Symbol, in beliebiger Reihenfolge
const navEntry = { test: (src: string) => [...src.matchAll(/\{[^{}]*\}/g)].some((m) =>
  new RegExp(`\\bid:\\s*['"](?:${TAB_IDS.join('|')})['"]`).test(m[0]) && /\b(?:label|short|icon):/.test(m[0])) }
test('S22: Navigationseinträge stehen nur in nav.ts', () => {
  expect(TAB_IDS).toContain('stammdaten')
  // Der Prüfer erkennt die Einträge in nav.ts selbst; sonst wäre er grün, ohne etwas zu finden.
  expect(navEntry.test(twSources['./nav.ts'] ?? '')).toBe(true)
  // Probe des Prüfers: auch mit der Beschriftung vorn
  expect(navEntry.test("const X = [{ label: 'Cockpit', id: 'cockpit' }]")).toBe(true)
  expect(navEntry.test("setTab({ id: 'cockpit' })")).toBe(false)
  expect(Object.keys(twSources).filter((file) => file !== './nav.ts' && navEntry.test(twSources[file] ?? ''))).toEqual([])
  // Die Bausteine der Navigation holen ihre Einträge aus nav.ts
  expect(sources['./App.tsx']).toMatch(/navFor\(/)
  expect(sources['./components/MobileNav.tsx']).toMatch(/bottomNav\(\)/)
})

// S23 (#346 Schritt 9, Spezifikation Abschnitt 5): Tabellen mit Datensätzen werden am Handy zu Karten
// (`<Table className="stacked">`), und dort steht jede Spalte als Beschriftung an ihrer Zelle
// (`data-label`). Ohne sie stünde ein Wert ohne seine Spalte da. Ausgenommen sind die Aktionen und Zeilen
// mit einer Zelle über mehrere Spalten (Summen, Belegkopf, Ablesungen), die ihre Bedeutung selbst tragen.
const STACKED_PAGES = ['./pages/Stammdaten.tsx', './pages/Zaehler.tsx', './pages/Kosten.tsx', './pages/Mietkonto.tsx']
/** Der Quelltext ohne die Tabellen, die keine Karten werden (verschachtelte Ablesungen, Zahlenraster). */
const withoutPlainTables = (src: string): string => {
  let out = ''
  let at = 0
  for (;;) {
    const start = src.indexOf('<Table', at)
    if (start < 0) return out + src.slice(at)
    const tag = src.slice(start, src.indexOf('>', start) + 1)
    if (/\bstacked\b/.test(tag)) {
      out += src.slice(at, start + tag.length)
      at = start + tag.length
      continue
    }
    let depth = 0
    let i = start
    for (;;) {
      const open = src.indexOf('<Table', i + 1)
      const close = src.indexOf('</Table>', i + 1)
      if (close < 0) return out + src.slice(at, start)
      if (open >= 0 && open < close) { depth++; i = open; continue }
      if (depth === 0) { i = close + '</Table>'.length; break }
      depth--
      i = close
    }
    out += src.slice(at, start)
    at = i
  }
}
const unlabeledCells = (src: string) => [...withoutPlainTables(src).matchAll(/<tr\b[\s\S]*?<\/tr>/g)].flatMap((row) => {
  const cells = [...row[0].matchAll(/<td\b[^>]*>/g)].map((m) => m[0])
  if (cells.some((c) => /colSpan/.test(c))) return []
  return cells.filter((c) => !/data-label=/.test(c) && !/className="[^"]*\bactions\b/.test(c)).map((c) => c.slice(0, 80))
})
test('S23: Tabellen mit Datensätzen werden am Handy zu Karten, jede Zelle mit ihrer Spalte', () => {
  // Mutationsprobe: eine Zelle ohne Beschriftung fällt auf, eine verschachtelte Tabelle ohne Karten nicht
  expect(unlabeledCells('<Table className="stacked"><tr><td data-label="A">x</td><td>y</td><td className="actions no-print" /></tr></Table>')).toEqual(['<td>'])
  expect(unlabeledCells('<Table className="stacked"><tr><td colSpan={2}><Table><tr><td>z</td></tr></Table></td></tr></Table>')).toEqual([])
  for (const file of STACKED_PAGES) {
    const src = sources[file] ?? ''
    expect(src, `${file} hat keine Tabelle mit Karten`).toMatch(/<Table className="[^"]*\bstacked\b/)
    expect(unlabeledCells(src), file).toEqual([])
  }
})

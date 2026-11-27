import { describe, expect, it } from 'vitest'
import type { LetterDesign } from '../../shared/types.ts'
import { DEFAULT_LETTER_DESIGN } from '../../shared/letterDesign.ts'
import { PAGE_EDGE_CSS, PAPER_PAGE_CSS, browserLinesNote, canPagePaper, designKey, logoBox, logoPrintNote, logoSpace, markPageEdges, markPrintWidth, pageEdges, paperVars, printDesign, printedDesign } from './letterDesignView'

const logo = { file: 'logo-0123456789abcdef.png', type: 'png' as const }
const paper = { file: 'paper-0123456789abcdef.pdf', type: 'pdf' as const }
const second = { file: 'paper-1123456789abcdef.jpg', type: 'jpg' as const }
// Was der Browser an CSS kennt: `box-decoration-break: clone` und `-moz-orient` (nur Gecko)
const engine = ({ clone, gecko = false }: { clone: boolean, gecko?: boolean }) => ({
  supports: (p: string, v: string) => (p === 'box-decoration-break' && v === 'clone' && clone) || (p === '-moz-orient' && v === 'inline' && gecko),
})
const withPaper: LetterDesign = { ...DEFAULT_LETTER_DESIGN, logo, paper, margins: { top: 30, right: 15, bottom: 30, left: 25 } }

describe('Logo und Briefpapier im Druck (#415, Teil 2b)', () => {
  it('ohne Gestaltung: nichts davon', () => {
    expect(printDesign({ installation: DEFAULT_LETTER_DESIGN, property: null }, { legacy: false, pagedPaper: true })).toEqual({ logo: null, paper: null, follow: null, margins: null, paperSkipped: false, logoSpace: null })
  })

  it('das Objekt geht vor', () => {
    const d = printDesign({ installation: withPaper, property: { ...DEFAULT_LETTER_DESIGN, logo } }, { legacy: false, pagedPaper: true })
    expect(d.logo).toEqual(logo)
    expect(d.paper).toBeNull()
    expect(d.margins).toBeNull()
  })

  it('Folgeseiten: dasselbe, ein zweites oder keines', () => {
    const inst = (paperNext: LetterDesign['paperNext']) => printDesign({ installation: { ...withPaper, paperNext, paperNextFile: paperNext === 'other' ? second : null }, property: null }, { legacy: false, pagedPaper: true })
    expect(inst('same')).toMatchObject({ paper, follow: paper, margins: withPaper.margins })
    expect(inst('other')).toMatchObject({ paper, follow: second })
    expect(inst('none')).toMatchObject({ paper, follow: null })
  })

  it('eine vor #415 abgeschlossene Abrechnung druckt wie damals, ohne Logo und Briefpapier', () => {
    expect(printDesign({ installation: withPaper, property: null }, { legacy: true, pagedPaper: true })).toEqual({ logo: null, paper: null, follow: null, margins: null, paperSkipped: false, logoSpace: null })
  })

  it('Ränder als Variablen in Millimetern, und ohne Seitenrand gedruckt', () => {
    expect(paperVars(withPaper.margins)).toEqual({ '--paper-top': '30mm', '--paper-right': '15mm', '--paper-bottom': '30mm', '--paper-left': '25mm' })
    expect(PAPER_PAGE_CSS).toMatch(/@page\s*\{\s*margin:\s*0/)
    // Briefpapier druckt nur ein Browser mit Rändern je Seite (nicht WebKit); dort braucht es keine feste Breite, die die
    // Skalierung des Druckdialogs abschalten würde (Durchsicht K1 zu PR #443).
    expect(PAPER_PAGE_CSS).not.toMatch(/width/)
    // Mit Briefpapier setzt die Seite ihre Ränder selbst; der Innenabstand von body aus der Betriebsart ohne Seitenrand
    // (Firefox, #735) entfällt dann.
    expect(PAPER_PAGE_CSS).toMatch(/html\.print-page-edge body \{ padding: 0; \}/)
  })

  // Druck in Safari (#286): WebKit nimmt die Ränder der ersten Seite für alle Seiten (auch `@page :first`) und wiederholt
  // nichts je Seite. Ein Briefpapier bis zur Blattkante und Ränder auf den Folgeseiten gehen dort nicht zusammen; der
  // Text stünde im Kopf oder Fuß des Papiers bzw. an der Blattkante. Ohne `box-decoration-break: clone` (die Ränder je
  // Seite der Aufstellung, letter.css) druckt die Seite deshalb ohne Briefpapier, wie wenn die Datei fehlte; das Logo bleibt.
  it('ein Browser ohne Ränder je Seite (Safari) druckt ohne Briefpapier, mit Logo, und sagt es', () => {
    const d = printDesign({ installation: withPaper, property: null }, { legacy: false, pagedPaper: false })
    expect(d).toEqual({ logo, paper: null, follow: null, margins: null, paperSkipped: true, logoSpace: null })
    // Ohne Briefpapier gibt es nichts zu sagen.
    expect(printDesign({ installation: { ...withPaper, paper: null }, property: null }, { legacy: false, pagedPaper: false }).paperSkipped).toBe(false)
    expect(printDesign({ installation: withPaper, property: null }, { legacy: true, pagedPaper: false }).paperSkipped).toBe(false)
  })

  // Durchsicht S2 zu #735: Die Funktion allein genügt nicht. Kennte Safari künftig `box-decoration-break: clone` ohne
  // Präfix, wiederholte es den Innenabstand aber nicht je Druckseite, stünden die Folgeseiten an der Blattkante. Verlangt
  // werden deshalb die Funktion und ausdrücklich Gecko (`-moz-orient`) oder Blink (Hersteller „Google Inc.“).
  it('Briefpapier nur mit Rändern je Seite und nur in Firefox oder Chromium, nicht in einem Safari, das die Angabe kennt', () => {
    expect(canPagePaper(engine({ clone: true, gecko: true }), '')).toBe(true)
    expect(canPagePaper(engine({ clone: true }), 'Google Inc.')).toBe(true)
    expect(canPagePaper(engine({ clone: true }), 'Apple Computer, Inc.')).toBe(false)
    expect(canPagePaper(engine({ clone: false, gecko: true }), '')).toBe(false)
    expect(canPagePaper(engine({ clone: false }), 'Google Inc.')).toBe(false)
    // Ohne CSS-Schnittstelle (jsdom, sehr alte Browser): lieber ohne Briefpapier als Text im Papier.
    expect(canPagePaper(undefined, 'Google Inc.')).toBe(false)
  })

  // Durchsicht K1 zu PR #443: die feste Breite des Dokuments im Druck (letter.css) nur, wo Ränder je Seite fehlen.
  it('die feste Druckbreite gilt nur in einem Browser ohne Ränder je Seite (WebKit)', () => {
    const root = { classList: { on: new Set<string>(), toggle(name: string, on: boolean) { if (on) this.on.add(name); else this.on.delete(name) } } }
    markPrintWidth(root, { supports: () => false }, 'Apple Computer, Inc.')
    expect([...root.classList.on]).toEqual(['print-fixed-width'])
    markPrintWidth(root, engine({ clone: true }), 'Google Inc.')
    expect([...root.classList.on]).toEqual([])
    // Ein Safari, das `box-decoration-break: clone` ohne Präfix kennt, bleibt bei der festen Breite (Durchsicht S2 zu #735)
    markPrintWidth(root, engine({ clone: true }), 'Apple Computer, Inc.')
    expect([...root.classList.on]).toEqual(['print-fixed-width'])
  })

  it('gedruckt wird erst, was geladen ist; fehlt eine Datei, ohne sie und mit Absender (Durchsicht M2)', () => {
    const planned = printDesign({ installation: { ...withPaper, paperNext: 'other', paperNextFile: second }, property: null }, { legacy: false, pagedPaper: true })
    // Noch nichts geladen: nichts davon, und „Drucken“ wartet.
    expect(printedDesign(planned, null)).toEqual({ logo: null, paper: null, follow: null, margins: null, ready: false, failed: [] })
    const loaded = { key: designKey(planned), logo: 'L', paper: 'P', follow: 'F', failed: [] }
    expect(printedDesign(planned, loaded)).toEqual({ logo: 'L', paper: 'P', follow: 'F', margins: withPaper.margins, ready: true, failed: [] })
    // Das Briefpapier fehlt: ohne Briefpapier, also mit Seitenrand, Absender und Fußzeile; das Logo bleibt.
    const broken = { ...loaded, paper: null, follow: null, failed: ['Briefpapier'] }
    expect(printedDesign(planned, broken)).toEqual({ logo: 'L', paper: null, follow: null, margins: null, ready: true, failed: ['Briefpapier'] })
    // Ein Stand für andere Dateien zählt nicht.
    expect(printedDesign(planned, { ...loaded, key: 'anders' }).ready).toBe(false)
  })
})

// #735: Kopf- und Fußzeilen des Browsers (Adresse, Datum, „Seite x von y“) stehen im Seitenrand. Nachgemessen (PDF aus
// dem echten Druck): Chromium druckt sie nicht, wo im Rand ein Randfeld von `@page` steht, Firefox nicht bei Rand 0;
// Firefox kennt keine Randfelder. WebKit kann keinen Rand je Seite (`canPagePaper`) und behält Rand und Zeilen.
describe('Kopf- und Fußzeilen des Browsers (#735)', () => {
  const firefox = engine({ clone: true, gecko: true })
  const blink = engine({ clone: true })
  it('Randfelder in Chromium ab 131, Rand 0 nur in Firefox, sonst bleibt es beim Browser', () => {
    expect(pageEdges(blink, true, 'Google Inc.')).toBe('margin-boxes')
    expect(pageEdges(firefox, false, '')).toBe('page-edge')
    // Ein Firefox, das künftig Randfelder kennt, bleibt beim nachgemessenen Rand 0 (ob es dann seine Zeilen weglässt, ist offen)
    expect(pageEdges(firefox, true, '')).toBe('page-edge')
    // Chromium 130: Ränder je Seite, aber keine Randfelder; die Zeilen bleiben, das Fenster sagt es
    expect(pageEdges(blink, false, 'Google Inc.')).toBe('browser')
    // Safari heute und ein Safari, das `clone` ohne Präfix und Randfelder kennt: Rand 0 ließe Folgeseiten an der Blattkante
    expect(pageEdges(engine({ clone: false }), false, 'Apple Computer, Inc.')).toBe('browser')
    expect(pageEdges(blink, false, 'Apple Computer, Inc.')).toBe('browser')
    expect(pageEdges(blink, true, 'Apple Computer, Inc.')).toBe('browser')
    // Firefox ohne `clone` (sehr alt): kein Rand 0
    expect(pageEdges(engine({ clone: false, gecko: true }), false, '')).toBe('browser')
    expect(pageEdges(undefined, false, '')).toBe('browser')
  })

  it('nur ohne Randfelder druckt die Seite ohne Rand, mit den 12 mm als Innenabstand', () => {
    const make = () => {
      const added: { textContent: string, dataset: Record<string, string> }[] = []
      const on = new Set<string>()
      const doc = {
        documentElement: { classList: { toggle: (n: string, v: boolean) => { if (v) on.add(n); else on.delete(n) } } },
        createElement: () => ({ textContent: '', dataset: {} as Record<string, string> }),
        head: { append: (el: { textContent: string, dataset: Record<string, string> }) => { added.push(el) } },
      }
      return { doc, added, on }
    }
    const ff = make()
    markPageEdges(ff.doc, firefox, false, '')
    expect([...ff.on]).toEqual(['print-page-edge'])
    expect(ff.added.map((s) => s.textContent)).toEqual([PAGE_EDGE_CSS])
    for (const [css, rules, vendor] of [[blink, true, 'Google Inc.'], [engine({ clone: false }), false, 'Apple Computer, Inc.']] as const) {
      const other = make()
      markPageEdges(other.doc, css, rules, vendor)
      expect([...other.on]).toEqual([])
      expect(other.added).toEqual([])
    }
    // Vor dem Rand von letter.css, auch wenn dessen Stylesheet später geladen wird
    expect(PAGE_EDGE_CSS).toMatch(/@page \{ margin: 0 !important; \}/)
  })

  it('der Satz zum Druckfenster nur, wo die Zeilen bleiben, mit dem Weg in Safari', () => {
    expect(browserLinesNote('margin-boxes', 'Google Inc.')).toBeNull()
    expect(browserLinesNote('page-edge', '')).toBeNull()
    const safari = browserLinesNote('browser', 'Apple Computer, Inc.')
    expect(safari).toMatch(/Safari/)
    // Durchsicht K1: „Details einblenden“ ist für das heutige macOS nicht in einer Anleitung von Apple belegt
    expect(safari).not.toMatch(/Details einblenden/)
    expect(safari).toMatch(/im Fenster „Drucken“ unter „Safari“/)
    expect(safari).toMatch(/Sie/)
    const other = browserLinesNote('browser', 'Google Inc.')
    expect(other).not.toMatch(/Safari/)
    expect(other).toMatch(/Kopf- und Fußzeilen/)
  })
})

// #691: Das Logo stand mit Briefpapier fest ab 15 mm und überdeckte dessen Kopf (nachgemessen: 15,1 bis 34,4 mm bei einem
// Rand oben von 25 mm). Es steht jetzt im freien Bereich zwischen dem Rand oben und dem Informationsblock (50 mm).
// Durchsicht: Bleiben dafür weniger als 10 mm Höhe, druckt es gar nicht, statt zu einem Fleck zu schrumpfen (gemessen
// bei 45 mm Rand: 2,9 × 9,8 mm), und der Druck sagt es.
describe('Lage des Logos im Druck (#691)', () => {
  it('ohne Briefpapier wie bisher: ab 15 mm, höchstens 25 mm hoch', () => {
    expect(logoBox(null)).toEqual({ top: 15, maxHeight: 25 })
  })
  it('mit Briefpapier ab dem Rand oben und vor dem Informationsblock; unter 10 mm Höhe gar nicht', () => {
    expect(logoBox(10)).toEqual({ top: 15, maxHeight: 25 })
    expect(logoBox(20)).toEqual({ top: 20, maxHeight: 25 })
    expect(logoBox(25)).toEqual({ top: 25, maxHeight: 23 })
    expect(logoBox(38)).toEqual({ top: 38, maxHeight: 10 })
    expect(logoBox(39)).toEqual({ top: 39, maxHeight: 0 })
    expect(logoBox(45)).toEqual({ top: 45, maxHeight: 0 })
    expect(logoBox(70)).toEqual({ top: 70, maxHeight: 0 })
  })
  it('wie viel Platz bleibt: genug, wenig (unter 15 mm), keiner', () => {
    expect([20, 33, 34, 38, 39, 45].map(logoSpace)).toEqual([null, null, 'small', 'small', 'none', 'none'])
  })
  const withBoth: LetterDesign = { ...DEFAULT_LETTER_DESIGN, logo: { file: 'logo-0123456789abcdef.png', type: 'png' }, paper: { file: 'paper-0123456789abcdef.png', type: 'png' } }
  const planned = (top: number, pagedPaper = true) => printDesign({ installation: { ...withBoth, margins: { ...withBoth.margins, top } }, property: null }, { legacy: false, pagedPaper })
  it('ohne Platz druckt das Logo nicht (kein Fleck), und der Plan sagt warum', () => {
    expect(planned(20)).toMatchObject({ logo: withBoth.logo, logoSpace: null })
    expect(planned(36)).toMatchObject({ logo: withBoth.logo, logoSpace: 'small' })
    expect(planned(45)).toMatchObject({ logoSpace: 'none' })
    const loaded = (p: ReturnType<typeof planned>, paperLoaded = true) => printedDesign(p, { key: designKey(p), logo: 'L', paper: paperLoaded ? 'P' : null, follow: paperLoaded ? 'F' : null, failed: paperLoaded ? [] : ['Briefpapier'] })
    expect(loaded(planned(45))).toMatchObject({ logo: null, paper: 'P' })
    expect(loaded(planned(36))).toMatchObject({ logo: 'L', paper: 'P' })
    // Fehlt die Datei des Briefpapiers, druckt die Seite ohne es, und das Logo steht wie ohne Briefpapier
    expect(loaded(planned(45), false)).toMatchObject({ logo: 'L', paper: null })
    // Druckt der Browser kein Briefpapier (Safari), steht das Logo wie ohne Briefpapier
    expect(planned(45, false)).toMatchObject({ logo: withBoth.logo, logoSpace: null, paperSkipped: true })
    // Ohne Logo gibt es nichts zu sagen
    expect(printDesign({ installation: { ...withBoth, logo: null, margins: { ...withBoth.margins, top: 45 } }, property: null }, { legacy: false, pagedPaper: true }).logoSpace).toBeNull()
  })
  it('der Hinweis beim Drucken nennt Folge, Grund und den Weg zum Fenster „Logo und Briefpapier“', () => {
    expect(logoPrintNote(null)).toBeNull()
    expect(logoPrintNote('none')).toEqual({
      title: 'Logo wird nicht gedruckt',
      text: 'Zwischen dem Rand oben des Briefpapiers und dem Datum im Briefkopf ist zu wenig Platz für das Logo. Den Rand oben ändern Sie im Fenster „Logo und Briefpapier“: in den Einstellungen, für ein einzelnes Objekt auf der Seite Abrechnung unter „Mehr“.',
      // Der Satz ohne den Weg, für das Fenster „Logo und Briefpapier“ selbst (Durchsicht)
      reason: 'Zwischen dem Rand oben des Briefpapiers und dem Datum im Briefkopf ist zu wenig Platz für das Logo.',
    })
    expect(logoPrintNote('small')?.title).toBe('Logo wird kleiner gedruckt')
    expect(logoPrintNote('small')?.text).toMatch(/wenig Platz für das Logo\. Den Rand oben ändern Sie im Fenster „Logo und Briefpapier“/)
  })
})

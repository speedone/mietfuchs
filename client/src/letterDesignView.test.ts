import { describe, expect, it } from 'vitest'
import type { LetterDesign } from '../../shared/types.ts'
import { DEFAULT_LETTER_DESIGN } from '../../shared/letterDesign.ts'
import { PAGE_EDGE_CSS, PAPER_PAGE_CSS, browserLinesNote, canPagePaper, designKey, markPageEdges, markPrintWidth, pageEdges, paperVars, printDesign, printedDesign } from './letterDesignView'

const logo = { file: 'logo-0123456789abcdef.png', type: 'png' as const }
const paper = { file: 'paper-0123456789abcdef.pdf', type: 'pdf' as const }
const second = { file: 'paper-1123456789abcdef.jpg', type: 'jpg' as const }
const withPaper: LetterDesign = { ...DEFAULT_LETTER_DESIGN, logo, paper, margins: { top: 40, right: 15, bottom: 30, left: 25 } }

describe('Logo und Briefpapier im Druck (#415, Teil 2b)', () => {
  it('ohne Gestaltung: nichts davon', () => {
    expect(printDesign({ installation: DEFAULT_LETTER_DESIGN, property: null }, { legacy: false, pagedPaper: true })).toEqual({ logo: null, paper: null, follow: null, margins: null, paperSkipped: false })
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
    expect(printDesign({ installation: withPaper, property: null }, { legacy: true, pagedPaper: true })).toEqual({ logo: null, paper: null, follow: null, margins: null, paperSkipped: false })
  })

  it('Ränder als Variablen in Millimetern, und ohne Seitenrand gedruckt', () => {
    expect(paperVars(withPaper.margins)).toEqual({ '--paper-top': '40mm', '--paper-right': '15mm', '--paper-bottom': '30mm', '--paper-left': '25mm' })
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
    expect(d).toEqual({ logo, paper: null, follow: null, margins: null, paperSkipped: true })
    // Ohne Briefpapier gibt es nichts zu sagen.
    expect(printDesign({ installation: { ...withPaper, paper: null }, property: null }, { legacy: false, pagedPaper: false }).paperSkipped).toBe(false)
    expect(printDesign({ installation: withPaper, property: null }, { legacy: true, pagedPaper: false }).paperSkipped).toBe(false)
  })

  it('erkannt wird die Funktion, die die Ränder je Seite trägt, nicht der Browser', () => {
    const asks: string[] = []
    const css = (yes: boolean) => ({ supports: (p: string, v: string) => { asks.push(`${p}: ${v}`); return yes } })
    expect(canPagePaper(css(true))).toBe(true)
    expect(canPagePaper(css(false))).toBe(false)
    expect(asks).toEqual(['box-decoration-break: clone', 'box-decoration-break: clone'])
    // Ohne CSS-Schnittstelle (jsdom, sehr alte Browser): lieber ohne Briefpapier als Text im Papier.
    expect(canPagePaper(undefined)).toBe(false)
  })

  // Durchsicht K1 zu PR #443: die feste Breite des Dokuments im Druck (letter.css) nur, wo Ränder je Seite fehlen.
  it('die feste Druckbreite gilt nur in einem Browser ohne Ränder je Seite (WebKit)', () => {
    const root = { classList: { on: new Set<string>(), toggle(name: string, on: boolean) { if (on) this.on.add(name); else this.on.delete(name) } } }
    markPrintWidth(root, { supports: () => false })
    expect([...root.classList.on]).toEqual(['print-fixed-width'])
    markPrintWidth(root, { supports: () => true })
    expect([...root.classList.on]).toEqual([])
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
  const css = (yes: boolean) => ({ supports: () => yes })
  it('Randfelder (Chromium ab 131) vor Rand 0 (Firefox), sonst bleibt es beim Browser', () => {
    expect(pageEdges(css(true), true)).toBe('margin-boxes')
    expect(pageEdges(css(true), false)).toBe('page-edge')
    expect(pageEdges(css(false), false)).toBe('browser')
    expect(pageEdges(css(false), true)).toBe('margin-boxes')
    expect(pageEdges(undefined, false)).toBe('browser')
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
    markPageEdges(ff.doc, css(true), false)
    expect([...ff.on]).toEqual(['print-page-edge'])
    expect(ff.added.map((s) => s.textContent)).toEqual([PAGE_EDGE_CSS])
    for (const [support, rules] of [[true, true], [false, false]] as const) {
      const other = make()
      markPageEdges(other.doc, css(support), rules)
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
    expect(safari).toMatch(/„Details einblenden“/)
    expect(safari).toMatch(/Sie/)
    const other = browserLinesNote('browser', 'Google Inc.')
    expect(other).not.toMatch(/Safari/)
    expect(other).toMatch(/Kopf- und Fußzeilen/)
  })
})

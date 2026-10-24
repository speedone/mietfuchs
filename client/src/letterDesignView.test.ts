import { describe, expect, it } from 'vitest'
import type { LetterDesign } from '../../shared/types.ts'
import { DEFAULT_LETTER_DESIGN } from '../../shared/letterDesign.ts'
import { PAPER_PAGE_CSS, designKey, paperVars, printDesign, printedDesign } from './letterDesignView'

const logo = { file: 'logo-0123456789abcdef.png', type: 'png' as const }
const paper = { file: 'paper-0123456789abcdef.pdf', type: 'pdf' as const }
const second = { file: 'paper-1123456789abcdef.jpg', type: 'jpg' as const }
const withPaper: LetterDesign = { ...DEFAULT_LETTER_DESIGN, logo, paper, margins: { top: 40, right: 15, bottom: 30, left: 25 } }

describe('Logo und Briefpapier im Druck (#415, Teil 2b)', () => {
  it('ohne Gestaltung: nichts davon', () => {
    expect(printDesign({ installation: DEFAULT_LETTER_DESIGN, property: null }, { legacy: false })).toEqual({ logo: null, paper: null, follow: null, margins: null })
  })

  it('das Objekt geht vor', () => {
    const d = printDesign({ installation: withPaper, property: { ...DEFAULT_LETTER_DESIGN, logo } }, { legacy: false })
    expect(d.logo).toEqual(logo)
    expect(d.paper).toBeNull()
    expect(d.margins).toBeNull()
  })

  it('Folgeseiten: dasselbe, ein zweites oder keines', () => {
    const inst = (paperNext: LetterDesign['paperNext']) => printDesign({ installation: { ...withPaper, paperNext, paperNextFile: paperNext === 'other' ? second : null }, property: null }, { legacy: false })
    expect(inst('same')).toMatchObject({ paper, follow: paper, margins: withPaper.margins })
    expect(inst('other')).toMatchObject({ paper, follow: second })
    expect(inst('none')).toMatchObject({ paper, follow: null })
  })

  it('eine vor #415 abgeschlossene Abrechnung druckt wie damals, ohne Logo und Briefpapier', () => {
    expect(printDesign({ installation: withPaper, property: null }, { legacy: true })).toEqual({ logo: null, paper: null, follow: null, margins: null })
  })

  it('Ränder als Variablen in Millimetern, und ohne Seitenrand gedruckt', () => {
    expect(paperVars(withPaper.margins)).toEqual({ '--paper-top': '40mm', '--paper-right': '15mm', '--paper-bottom': '30mm', '--paper-left': '25mm' })
    expect(PAPER_PAGE_CSS).toMatch(/@page\s*\{\s*margin:\s*0/)
  })

  it('gedruckt wird erst, was geladen ist; fehlt eine Datei, ohne sie und mit Absender (Durchsicht M2)', () => {
    const planned = printDesign({ installation: { ...withPaper, paperNext: 'other', paperNextFile: second }, property: null }, { legacy: false })
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

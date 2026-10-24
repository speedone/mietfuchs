import { describe, expect, it } from 'vitest'
import type { LetterDesign } from '../../shared/types.ts'
import { DEFAULT_LETTER_DESIGN } from '../../shared/letterDesign.ts'
import { SVG_PIXELS, checkChosenFile, svgCanvasSize, designDraftValue, designPayload, designProblems, initialDesignDraft, onePageProblem, type StagedFile } from './letterDesignForm'

const logo = { file: 'logo-0123456789abcdef.png', type: 'png' as const }
const paper = { file: 'paper-0123456789abcdef.pdf', type: 'pdf' as const }
const stored: LetterDesign = { ...DEFAULT_LETTER_DESIGN, logo, paper }
const staged = (name: string): StagedFile => ({ name, size: 10, lastModified: 1, type: 'png', blob: new Blob(['x']) })

describe('Seitenfenster „Logo und Briefpapier“ (#415, Teil 2b)', () => {
  it('Entwurf aus dem Gespeicherten; am Objekt beginnt die eigene mit der Vorgabe', () => {
    const d = initialDesignDraft(stored)
    expect(d).toMatchObject({ own: true, logo: { saved: logo }, paper: { saved: paper }, margins: { top: '20', left: '25' } })
    expect(initialDesignDraft(null, stored)).toMatchObject({ own: false, logo: { saved: logo } })
  })

  it('gesendet wird je Datei behalten, entfernen oder neu, dazu die neuen Dateien', () => {
    const d = { ...initialDesignDraft(stored), logo: { staged: staged('neu.png') }, paper: null }
    const p = designPayload(d, 'installation')
    expect(p.design).toEqual({ logo: 'new', paper: 'remove', paperNextFile: 'remove', paperNext: 'same', margins: { top: 20, right: 20, bottom: 20, left: 25 } })
    expect(Object.keys(p.files)).toEqual(['logo'])
    // Am Objekt mit eigener Gestaltung: dazu `own`; zurück zur Vorgabe nur das.
    expect(designPayload(d, 'property').design.own).toBe(true)
    expect(designPayload({ ...d, own: false }, 'property')).toEqual({ design: { own: false, logo: 'keep', paper: 'keep', paperNextFile: 'keep', paperNext: 'same', margins: DEFAULT_LETTER_DESIGN.margins }, files: {} })
  })

  it('alle Meldungen auf einmal, je mit Feld', () => {
    const d = { ...initialDesignDraft(stored), paperNext: 'other' as const, margins: { top: '5', right: '20', bottom: 'x', left: '25' } }
    expect(designProblems(d).map((p) => p.field)).toEqual(['paperNextFile', 'top', 'bottom'])
    expect(designProblems({ ...d, own: false })).toEqual([])
  })

  it('eine gewählte Datei: Art am Inhalt, Größe, eine Seite', () => {
    expect(checkChosenFile('logo', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 100)).toEqual({ type: 'png' })
    expect(checkChosenFile('logo', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 3 * 1024 * 1024)).toEqual({ error: 'Die Datei ist größer als 2 MB.' })
    expect(checkChosenFile('logo', new TextEncoder().encode('%PDF-1.4'), 100)).toMatchObject({ error: expect.stringMatching(/PNG oder JPG/) })
    expect(checkChosenFile('paper', new TextEncoder().encode('%PDF-1.4'), 100)).toEqual({ type: 'pdf' })
    // Ein SVG geht nicht hinaus, sondern wird im Browser in ein PNG umgewandelt (Durchsicht S1).
    expect(checkChosenFile('logo', new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'), 100)).toEqual({ convert: 'svg' })
    expect(checkChosenFile('paper', new TextEncoder().encode('<?xml version="1.0"?><svg/>'), 100)).toEqual({ convert: 'svg' })
    expect(onePageProblem(1)).toBeNull()
    expect(onePageProblem(3)).toMatch(/3 Seiten/)
  })

  it('der Vergleich des Seitenfensters sieht eine andere Datei', () => {
    const d = initialDesignDraft(stored)
    expect(designDraftValue({ ...d, logo: { staged: staged('a.png') } })).not.toEqual(designDraftValue({ ...d, logo: { staged: staged('b.png') } }))
    expect(designDraftValue(d)).toEqual(designDraftValue(initialDesignDraft(stored)))
  })
})

describe('SVG in PNG umwandeln (Durchsicht S1)', () => {
  it('Briefpapier als A4 mit 300 dpi, Logo in der Größe des Briefkopfs mit 300 dpi, Seitenverhältnis bleibt', () => {
    expect(svgCanvasSize('paper', 210, 297)).toEqual({ width: SVG_PIXELS.paper.width, height: SVG_PIXELS.paper.height })
    expect(SVG_PIXELS.paper).toEqual({ width: 2480, height: 3508 })
    const logo = svgCanvasSize('logo', 200, 60)
    expect(logo.width / logo.height).toBeCloseTo(200 / 60, 1)
    expect(logo.width).toBeLessThanOrEqual(SVG_PIXELS.logo.width)
    expect(logo.height).toBeLessThanOrEqual(SVG_PIXELS.logo.height)
    expect(Math.max(logo.width / SVG_PIXELS.logo.width, logo.height / SVG_PIXELS.logo.height)).toBeCloseTo(1, 2)
    // Ein SVG ohne eigene Größe (der Browser meldet 0) bekommt die volle Fläche.
    expect(svgCanvasSize('logo', 0, 0)).toEqual(SVG_PIXELS.logo)
  })
})

describe('Ränder nur mit Briefpapier (Durchsicht K3)', () => {
  it('ohne Briefpapier werden die Ränder nicht geprüft, und gesendet wird ein gültiger Stand', () => {
    const d = { ...initialDesignDraft(stored), paper: null, margins: { top: '5', right: '20', bottom: 'x', left: '25' } }
    expect(designProblems(d)).toEqual([])
    expect(designPayload(d, 'installation').design.margins).toEqual(DEFAULT_LETTER_DESIGN.margins)
  })
})

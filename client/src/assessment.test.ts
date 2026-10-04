// Die Entscheidungen der Komponente „Auswertung prüfen“ (Belegbuchung, #170), ohne DOM.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AssessmentLine, AssessmentView, BookingPreview, LineCandidate, LineSuggestion } from './types'
import { bookDecisions, categoryOptions, decisionsOf, greenDecisions, initialRow, initialRows, isAssessment, isGreen, isPreview, linkChoices, previewLines, shownRow, withConfirmed, type RowDraft } from './assessment'
import { CATEGORIES } from './types'

const suggestion = (patch: Partial<LineSuggestion> = {}): LineSuggestion => ({
  fields: { description: 'Frischwasser', category: 'Wasser/Abwasser', amountCents: 70000, labor35aCents: null, key: 'persons', allocation: null, externalTotalCents: null },
  candidates: [], level: 'gruen', reasons: [], preselected: true, ...patch,
})
const line = (idx: number, patch: Partial<AssessmentLine> = {}): AssessmentLine => ({
  idx, description: 'Frischwasser', category: 'Wasser/Abwasser', categoryGuessed: false, amountCents: 70000, labor35aCents: null,
  booking: null, costItemId: null, dismissed: false, reassessed: false, state: 'open', itemDescription: null, suggestion: suggestion(), ...patch,
})
const view = (lines: AssessmentLine[]): AssessmentView => ({
  id: 'a1', file: 'w.pdf', propertyId: 'objekt-1', year: 2025, detectedYear: 2025, requestedYear: 2025, vendor: 'Stadtwerke', invoiceDate: null,
  totalGrossCents: null, amountsAdjusted: null, laborFromTotal: false, nextIdx: lines.length, createdAt: '2026-10-02T00:00:00.000Z',
  originalName: 'w.pdf', lines, open: true, sumWarning: null,
})
const KANDIDAT: LineCandidate = { id: 'wa', description: 'Wasser 2025', amountCents: 150000, invoiceFile: null, key: 'area', formOnly: false }
const PREVIEW: BookingPreview = { items: [], notices: [], errors: [], confirm: [], token: 't' }

describe('Zeilenentwurf', () => {
  it('ein vorab angehakter Vorschlag wird angelegt, sonst bleibt die Zeile offen; Beträge in deutscher Schreibweise', () => {
    expect(initialRow(line(0))).toMatchObject({ action: 'create', amount: '700,00', labor35a: '', key: 'persons' })
    expect(initialRow(line(0, { suggestion: suggestion({ preselected: false }) })).action).toBe('')
    // 0 ist eine Angabe der Rechnung und steht deshalb da, „nicht gelesen“ bleibt leer.
    expect(initialRow(line(0, { suggestion: suggestion({ fields: { ...suggestion().fields, labor35aCents: 0 } }) })).labor35a).toBe('0,00')
  })

  it('Entscheidungen: anlegen mit Cent, verknüpfen mit berichtigtem Betrag, verwerfen; lösen nur verknüpfte Zeilen', () => {
    const v = view([line(0), line(1), line(2), line(3, { state: 'linked', costItemId: 'wa', booking: 'linked', suggestion: null }), line(4, { state: 'created', costItemId: 'x', booking: 'created', suggestion: null })])
    const rows = initialRows(v)
    rows[1] = { ...rows[1], action: 'link:wa', amount: '712,40' }
    rows[2] = { ...rows[2], action: 'dismiss' }
    rows[3] = { ...rows[3], action: 'release' }
    rows[4] = { ...rows[4], action: 'release' }
    expect(decisionsOf(v, rows)).toEqual([
      { idx: 0, action: 'create', fields: { description: 'Frischwasser', category: 'Wasser/Abwasser', amountCents: 70000, labor35aCents: null, key: 'persons', allocation: null, externalTotalCents: null } },
      { idx: 1, action: 'link', costItemId: 'wa', amountCents: 71240, labor35aCents: null },
      { idx: 2, action: 'dismiss' },
      { idx: 3, action: 'release' },
    ])
  })

  it('verknüpfen nur mit Positionen, deren Betrag nicht an weiteren Angaben hängt, und nie eine Gutschrift', () => {
    const l = line(0, { suggestion: suggestion({ candidates: [KANDIDAT, { ...KANDIDAT, id: 'hg', key: 'external', formOnly: true }] }) })
    expect(linkChoices(l, initialRow(l)).map((c) => c.id)).toEqual(['wa'])
    expect(linkChoices(l, { ...initialRow(l), amount: '-50,00' })).toEqual([])
  })

  it('ein Ziel, das nicht mehr angeboten wird, steht als „offen lassen“ da und wird nicht gebucht', () => {
    const l = line(0, { suggestion: suggestion({ candidates: [KANDIDAT] }) })
    const row: RowDraft = { ...initialRow(l), action: 'link:wa' }
    expect(shownRow(l, row).action).toBe('link:wa')
    expect(shownRow(l, { ...row, amount: '-50,00' }).action).toBe('')
    expect(shownRow(line(0), row).action).toBe('')
  })

  it('eine verworfene Zeile steht als verworfen da; unverändert geht nichts an den Server, neu anlegen schon', () => {
    const dismissed = line(0, { dismissed: true, state: 'dismissed' })
    expect(initialRow(dismissed).action).toBe('dismiss')
    const v = view([dismissed, line(1, { dismissed: true, state: 'dismissed' })])
    const rows = initialRows(v)
    rows[1] = { ...rows[1], action: 'create' }
    expect(decisionsOf(v, rows).map((d) => [d.idx, d.action])).toEqual([[1, 'create']])
  })

  it('grün heißt für Zählung und Übernahme dasselbe: offen, grün und vorab angehakt', () => {
    const v = view([line(0), line(1, { suggestion: suggestion({ preselected: false }) }), line(2, { suggestion: suggestion({ level: 'gelb' }) })])
    expect(v.lines.filter(isGreen).map((l) => l.idx)).toEqual([0])
    expect(greenDecisions(v).map((d) => d.idx)).toEqual(v.lines.filter(isGreen).map((l) => l.idx))
  })

  it('Kostenart: eine Kostenart, die es in der Liste nicht gibt, steht trotzdem zur Wahl', () => {
    expect(categoryOptions('Grundsteuer')).toEqual(CATEGORIES)
    expect(categoryOptions('Hauswart (alt)')).toEqual([...CATEGORIES, 'Hauswart (alt)'])
  })

  it('bestätigte Rückfrage und „Alle grünen“', () => {
    const v = view([line(0), line(1, { suggestion: suggestion({ level: 'gelb' }) }), line(2, { suggestion: suggestion({ preselected: false }) })])
    expect(greenDecisions(v).map((d) => d.idx)).toEqual([0])
    expect(withConfirmed(decisionsOf(v, initialRows(v)), [1])).toEqual([
      expect.objectContaining({ idx: 0, action: 'create' }),
      expect.objectContaining({ idx: 1, action: 'create', despiteCandidates: true }),
    ])
  })
})

it('Vorschau in Sätzen: neu, geändert, unverändert, mit Lohnanteil', () => {
  const p: BookingPreview = {
    items: [
      { costItemId: null, lines: [0], description: 'Restmüll', category: 'Müllabfuhr', year: 2025, beforeCents: null, afterCents: 70000, beforeLabor35aCents: null, afterLabor35aCents: null },
      { costItemId: 'gp', lines: [1], description: 'Gartenpflege 2025', category: 'Gartenpflege', year: 2025, beforeCents: 150000, afterCents: 145000, beforeLabor35aCents: 100000, afterLabor35aCents: null },
      { costItemId: 'wa', lines: [2], description: 'Wasser 2025', category: 'Wasser/Abwasser', year: 2025, beforeCents: 150000, afterCents: 150000, beforeLabor35aCents: null, afterLabor35aCents: null },
    ],
    notices: [], errors: [], confirm: [], token: 't',
  }
  const lines = previewLines(p)
  // Das Jahr der neuen Position steht dabei: Es kann vom gewählten abweichen (Schlussdurchsicht, I1).
  expect(lines[0]).toMatch(/^Neu für 2025: „Restmüll“ \(Müllabfuhr\) 700,00\s€$/)
  expect(lines[1]).toMatch(/^„Gartenpflege 2025“: 1\.500,00\s€ → 1\.450,00\s€; §35a 1\.000,00\s€ → keiner$/)
  expect(lines[2]).toMatch(/^„Wasser 2025“ bleibt bei 1\.500,00\s€$/)
})

describe('Antwort der Buchung lesen, ohne sie zu behaupten', () => {
  afterEach(() => vi.unstubAllGlobals())
  const reply = (status: number, data: unknown) =>
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } }))

  it('Gestaltprüfungen: Vorschau und Auswertung werden an ihren Feldern erkannt', () => {
    expect(isPreview(PREVIEW)).toBe(true)
    expect(isPreview({ ...PREVIEW, token: 1 })).toBe(false)
    expect(isPreview({ items: [] })).toBe(false)
    expect(isPreview(null)).toBe(false)
    expect(isAssessment(view([line(0)]))).toBe(true)
    expect(isAssessment({ id: 'a1', lines: 'keine' })).toBe(false)
    expect(isAssessment(PREVIEW)).toBe(false)
  })

  it('409 mit Auswertung ist ein Widerspruch, 409 mit Vorschau veraltet, 400 mit Vorschau abgelehnt', async () => {
    reply(409, { error: 'Anders gebucht.', assessment: view([line(0)]) })
    expect(await bookDecisions('a1', [], 't')).toMatchObject({ kind: 'conflict', message: 'Anders gebucht.' })
    reply(409, { error: 'Veraltet.', preview: PREVIEW })
    expect(await bookDecisions('a1', [], 't')).toMatchObject({ kind: 'stale', message: 'Veraltet.', preview: PREVIEW })
    reply(400, { error: 'Fehlt.', preview: PREVIEW })
    expect(await bookDecisions('a1', [], 't')).toMatchObject({ kind: 'refused', message: 'Fehlt.' })
  })

  it('eine Ablehnung, deren Rumpf nicht die erwartete Gestalt hat, wird als Fehler weitergegeben', async () => {
    reply(409, { error: 'Etwas anderes.', preview: { items: 'kaputt' }, assessment: { id: 'a1' } })
    await expect(bookDecisions('a1', [], 't')).rejects.toThrow('Etwas anderes.')
    reply(200, { changed: true, assessment: { id: 'a1' }, preview: PREVIEW })
    await expect(bookDecisions('a1', [], 't')).rejects.toThrow(/unlesbar/)
  })
})

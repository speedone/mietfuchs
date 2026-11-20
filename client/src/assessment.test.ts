// Die Entscheidungen der Komponente „Auswertung prüfen“ (Belegbuchung, #170), ohne DOM.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AssessmentLine, AssessmentView, BookingPreview, LineCandidate, LineSuggestion } from './types'
import { bookDecisions, openBadgeClass, categoryOptions, decisionsOf, greenDecisions, initialRow, initialRows, isAssessment, isGreen, isPreview, linkChoices, fromSameReceipt, ampelNote, combinableLines, combineStart, combineSummary, combineFirst, combineRest, combineLabor, openCredits, sameReceiptTargets, linkAllRows, type CombineDraft, noteGroups, reasonChips, yearOptions, previewLines, shownRow, withConfirmed, type RowDraft } from './assessment'
import { CATEGORIES } from './types'
import { calendarPeriod, periodKey } from '../../shared/period.ts'

const suggestion = (patch: Partial<LineSuggestion> = {}): LineSuggestion => ({
  fields: { description: 'Frischwasser', category: 'Wasser/Abwasser', amountCents: 70000, labor35aCents: null, key: 'persons', allocation: null, externalTotalCents: null },
  candidates: [], level: 'gruen', reasons: [], preselected: true, ...patch,
})
const line = (idx: number, patch: Partial<AssessmentLine> = {}): AssessmentLine => ({
  idx, description: 'Frischwasser', category: 'Wasser/Abwasser', categoryGuessed: false, amountCents: 70000, labor35aCents: null,
  booking: null, costItemId: null, dismissed: false, reassessed: false, laborGuessed: false, state: 'open', itemDescription: null, suggestion: suggestion(), ...patch,
})
const view = (lines: AssessmentLine[]): AssessmentView => ({
  id: 'a1', file: 'w.pdf', propertyId: 'objekt-1', year: 2025, detectedYear: 2025, requestedYear: 2025, requestedPeriod: calendarPeriod(2025), vendor: 'Stadtwerke', invoiceDate: null,
  totalGrossCents: null, amountsAdjusted: null, laborFromTotal: false, source: 'ki', invoiceNumber: null, eInvoiceNotes: [], nextIdx: lines.length, createdAt: '2026-10-02T00:00:00.000Z',
  originalName: 'w.pdf', lines, open: true, sumWarning: null,
})
const KANDIDAT: LineCandidate = { id: 'wa', description: 'Wasser 2025', amountCents: 150000, invoiceFile: null, key: 'area', formOnly: false }
const PREVIEW: BookingPreview = { items: [], notices: [], errors: [], confirm: [], token: 't' }

describe('Begründungen, Notizen und Jahre der Karte (Systemprüfung)', () => {
  const PREPAID = 'Abschläge über 1.030,00\u00a0€ sind bereits bezahlt; als Kosten zählt der Gesamtbetrag von 804,86\u00a0€.'
  const placed = (p: Partial<AssessmentView>): AssessmentView => ({ ...view([]), ...p })
  const ZWEIFEL = 'Diese Rechnung korrigiert eine frühere Rechnung. Diese darf nicht zusätzlich gebucht sein.'

  it('gleichlautende Begründungen stehen einmal, in der schlechtesten Farbe; grüne und gebuchte Zeilen nennen nichts', () => {
    const v = view([
      line(0, { suggestion: suggestion({ level: 'gelb', reasons: ['Kategorie unklar', 'nur hier'] }) }),
      line(1, { suggestion: suggestion({ level: 'rot', reasons: ['Kategorie unklar', 'Betrag fehlt'] }) }),
      line(2, { suggestion: suggestion({ level: 'gruen', reasons: ['grün begründet'] }) }),
      line(3, { state: 'dismissed', dismissed: true, suggestion: suggestion({ level: 'rot', reasons: ['verworfen'] }) }),
    ])
    expect(reasonChips(v)).toEqual([
      { text: 'Kategorie unklar', level: 'rot' },
      { text: 'nur hier', level: 'gelb' },
      { text: 'Betrag fehlt', level: 'rot' },
    ])
  })

  it('eine Notiz der E-Rechnung steht im Kasten der Auswertung und nicht noch einmal je Zeile', () => {
    const v = { ...view(Array.from({ length: 14 }, (_, i) => line(i, { suggestion: suggestion({ level: 'rot', reasons: [ZWEIFEL, 'Kategorie unklar'] }) }))), eInvoiceNotes: [PREPAID, ZWEIFEL] }
    expect(reasonChips(v)).toEqual([{ text: 'Kategorie unklar', level: 'rot' }])
    expect(noteGroups(v)).toEqual({ doubts: [ZWEIFEL], info: [PREPAID] })
  })

  it('Jahr der Buchung: das gewählte und das gespeicherte Jahr stehen immer zur Wahl, aufsteigend und ohne Doppel', () => {
    expect(yearOptions(view([]))).toEqual([2023, 2024, 2025, 2026])
    // Die KI las 2023, abgelegt war der Beleg für 2025: Der Hinweis rät, das Jahr zu ändern, also muss 2025 wählbar sein.
    expect(yearOptions(placed({ year: 2023, requestedYear: 2025 }))).toEqual([2021, 2022, 2023, 2024, 2025])
    expect(yearOptions(placed({ year: 2025, requestedYear: 2019 }))).toEqual([2019, 2023, 2024, 2025, 2026])
    expect(yearOptions(placed({ requestedYear: null, requestedPeriod: null }))).toEqual([2023, 2024, 2025, 2026])
  })

  // Durchsicht: Oktober bis September, gewählt 2026 heißt Zeitraum 2025-10. Das Beginnjahr 2025 anzubieten führte in
  // den Vorzeitraum (2024-10); zur Wahl steht deshalb nur das gewählte Jahr selbst.
  it('Jahr der Buchung bei abweichendem Zeitraum: nur das gewählte Jahr, nicht das Jahr, in dem sein Zeitraum beginnt', () => {
    expect(yearOptions(placed({ year: 2023, requestedYear: 2026, requestedPeriod: periodKey('2025-10') }))).toEqual([2021, 2022, 2023, 2024, 2026])
    expect(yearOptions(placed({ year: 2022, requestedYear: null, requestedPeriod: periodKey('2025-10') }))).toEqual([2020, 2021, 2022, 2023])
  })

  it('eine Zeile, deren Grund nur im Kasten der Rechnung steht, sagt das Vorlesern an der Ampel', () => {
    const v = { ...view([
      line(0, { suggestion: suggestion({ level: 'rot', reasons: [ZWEIFEL] }) }),
      line(1, { suggestion: suggestion({ level: 'gelb', reasons: [PREPAID] }) }),
      line(2, { suggestion: suggestion({ level: 'gelb', reasons: ['Kategorie unklar'] }) }),
      line(3),
      // Der Grund der Farbe steht in den Begründungen unter der Tabelle (Gutschrift, erratene Kostenart): kein Verweis.
      line(4, { suggestion: suggestion({ level: 'rot', reasons: ['Gutschrift - bitte prüfen', PREPAID] }) }),
      line(5, { suggestion: suggestion({ level: 'gelb', reasons: [PREPAID, 'Kategorie unklar'] }) }),
      line(6, { suggestion: suggestion({ level: 'rot', reasons: ['Kategorie unklar', ZWEIFEL] }) }),
    ]), eInvoiceNotes: [PREPAID, ZWEIFEL] }
    expect(v.lines.map((l) => ampelNote(v, l))).toEqual([
      'Rot: siehe Hinweis zur Rechnung über der Tabelle', 'Gelb: siehe Hinweis zur Rechnung über der Tabelle', null, null, null, null,
      'Rot: siehe Hinweis zur Rechnung über der Tabelle',
    ])
  })
})

// Durchsicht der Systemprüfung: Der Weg „eine Rechnung, eine Position“ ist eine eigene Aktion der Karte.
describe('Alle Zeilen als eine Position', () => {
  const fields = (amountCents: number | null, category = 'Wasser/Abwasser', labor35aCents: number | null = null) => ({ ...suggestion().fields, amountCents, category, labor35aCents })
  const l = (idx: number, amountCents: number | null, patch: Partial<AssessmentLine> = {}, category = 'Wasser/Abwasser') =>
    line(idx, { amountCents, category, suggestion: suggestion({ fields: fields(amountCents, category, patch.labor35aCents ?? null) }), ...patch })
  const v = { ...view([l(0, 20000), l(1, 10387), l(2, -5000), l(3, null), l(4, 5000, { state: 'created', costItemId: 'x', suggestion: null }), l(5, 7000, { state: 'dismissed', dismissed: true })]), invoiceNumber: 'R-17' }
  const draft = (patch: Partial<CombineDraft> = {}): CombineDraft => ({ category: 'Wasser/Abwasser', description: 'Stadtwerke', labor: false, ...patch })

  it('zusammen gehen nur offene Zeilen mit Betrag über 0: keine Gutschrift, keine ungelesene, gebuchte oder verworfene', () => {
    expect(combinableLines(v).map((x) => x.idx)).toEqual([0, 1])
    expect(combinableLines(view([l(0, 20000)]))).toEqual([])
    expect(combinableLines({ ...v, propertyId: null })).toEqual([])
  })

  it('vorbelegt: die gemeinsame Kostenart, sonst keine; Beschreibung aus Rechnungssteller und Rechnungsnummer', () => {
    expect(combineStart(v)).toEqual({ category: 'Wasser/Abwasser', description: 'Stadtwerke, Rechnung R-17', labor: false })
    const mixed = view([l(0, 20000), l(1, 10387, {}, 'Müllabfuhr')])
    expect(combineStart(mixed)).toEqual({ category: '', description: 'Stadtwerke', labor: false })
    expect(combineStart({ ...mixed, vendor: null })).toEqual({ category: '', description: 'w.pdf', labor: false })
  })

  // Durchsicht 2, Punkt 1: Wer die Gutschrift liegen lässt, legt ihren Betrag zu viel um; das Fenster sagt es mit Zahlen.
  it('die Zusammenfassung nennt Position und Summe, die offene Gutschrift mit Betrag und den Rechnungsbetrag', () => {
    const invoice = { ...view([l(0, 53500), l(1, 42800), l(2, 6420), l(3, -5350)]), totalGrossCents: 97370 }
    expect(combineSummary(invoice, draft())).toEqual([
      'Es entsteht eine Position „Stadtwerke“ (Wasser/Abwasser) über 1.027,20\u00a0€ aus 3 Zeilen.',
      'Die Gutschrift über 53,50\u00a0€ bleibt offen, denn Gutschriften werden nie verrechnet. Legen Sie sie danach als eigene Position an, sonst legen Sie 53,50\u00a0€ zu viel um.',
      'Rechnungsbetrag laut Beleg: 973,70\u00a0€.',
    ])
    expect(combineSummary(v, draft())).toEqual([
      'Es entsteht eine Position „Stadtwerke“ (Wasser/Abwasser) über 303,87\u00a0€ aus 2 Zeilen.',
      'Die Gutschrift über 50,00\u00a0€ bleibt offen, denn Gutschriften werden nie verrechnet. Legen Sie sie danach als eigene Position an, sonst legen Sie 50,00\u00a0€ zu viel um.',
      '1 Zeile ohne Betrag bleibt offen.',
    ])
    expect(combineSummary(view([l(0, 20000), l(1, 10387), l(2, -5000), l(3, -1000)]), draft({ category: '' }))).toEqual([
      'Es entsteht eine Position „Stadtwerke“ über 303,87\u00a0€ aus 2 Zeilen.',
      '2 Gutschriften über zusammen 60,00\u00a0€ bleiben offen, denn Gutschriften werden nie verrechnet. Legen Sie sie danach als eigene Positionen an, sonst legen Sie 60,00\u00a0€ zu viel um.',
    ])
  })

  it('nach dem Buchen: eine offene Gutschrift neben gebuchten Zeilen nennt die Karte', () => {
    expect(openCredits(v)).toEqual({ count: 1, cents: 5000 })
    expect(openCredits(view([l(0, 20000), l(1, -5000)]))).toBeNull()
    expect(openCredits(view([l(0, 20000, { state: 'linked', costItemId: 'x', suggestion: null })]))).toBeNull()
  })

  // Durchsicht 2, Punkt 2: Ein nur vorgeschlagener Lohnanteil (`laborGuessed`) kommt nie ungesehen mit.
  it('§35a-Lohn: gelesen ist er vorausgewählt, nur vorgeschlagen nicht; ohne Zustimmung entsteht die Position ohne Lohnanteil', () => {
    const read = view([l(0, 119000, { labor35aCents: 30000 }), l(1, 23800, { labor35aCents: 0 }), l(2, 10000)])
    const guessed = view([l(0, 119000, { labor35aCents: 119000, laborGuessed: true }), l(1, 23800)])
    expect(combineLabor(read)).toEqual({ cents: 30000, guessed: false })
    expect(combineLabor(guessed)).toEqual({ cents: 119000, guessed: true })
    expect(combineLabor(v)).toBeNull()
    expect(combineStart(read).labor).toBe(true)
    expect(combineStart(guessed).labor).toBe(false)
    expect(combineSummary(read, draft({ labor: true }))[0]).toBe('Es entsteht eine Position „Stadtwerke“ (Wasser/Abwasser) über 1.528,00\u00a0€ aus 3 Zeilen, davon §35a-Lohn 300,00\u00a0€.')
    expect(combineSummary(guessed, draft())[0]).toBe('Es entsteht eine Position „Stadtwerke“ (Wasser/Abwasser) über 1.428,00\u00a0€ aus 2 Zeilen, ohne §35a-Lohnanteil.')
    // Mit Zustimmung gehen die Angaben der Zeilen an den Planer (Summenregel: Summe der gelesenen).
    expect(combineFirst(guessed, draft({ labor: true }), { key: 'area', allocation: null })[0]).toMatchObject({ fields: { labor35aCents: 119000 } })
    expect(combineRest(guessed, 'neu', draft({ labor: true }))).toEqual([{ idx: 1, action: 'link', costItemId: 'neu' }])
    // Ohne: jede Zeile ausdrücklich ohne Lohn, sonst zählte der Planer den der verknüpften Zeilen wieder dazu.
    expect(combineFirst(guessed, draft(), { key: 'area', allocation: null })[0]).toMatchObject({ fields: { labor35aCents: null } })
    expect(combineRest(read, 'neu', draft())).toEqual([{ idx: 1, action: 'link', costItemId: 'neu', labor35aCents: null }, { idx: 2, action: 'link', costItemId: 'neu', labor35aCents: null }])
  })

  it('gebucht wird in zwei Schritten: die erste Zeile anlegen, die übrigen mit ihrer Position verknüpfen', () => {
    const first = combineFirst(v, draft({ category: 'Müllabfuhr' }), { key: 'units', allocation: null })
    expect(first).toEqual([{ idx: 0, action: 'create', fields: { ...fields(20000), category: 'Müllabfuhr', description: 'Stadtwerke', key: 'units', allocation: null, externalTotalCents: null } }])
    expect(combineRest(v, 'neu', draft())).toEqual([{ idx: 1, action: 'link', costItemId: 'neu' }])
  })

  // Durchsicht 2, Punkt 4: Ist aus dieser Auswertung schon eine Position gebucht, legt die Karte keine zweite an.
  it('gibt es schon eine Position aus diesem Beleg, werden alle offenen Zeilen mit ihr verknüpft; Gutschriften nicht', () => {
    const own: LineCandidate = { ...KANDIDAT, id: 'neu', description: 'Stadtwerke', invoiceFile: 'w.pdf' }
    const other: LineCandidate = { ...own, id: 'zwei', description: 'Zweite' }
    const withOwn = (idx: number, amountCents: number | null, sameReceipt: LineCandidate[]) => line(idx, { amountCents, suggestion: suggestion({ fields: fields(amountCents), sameReceipt, preselected: false }) })
    const partial = view([l(0, 20000, { state: 'created', costItemId: 'neu', suggestion: null }), withOwn(1, 10387, [own, other]), withOwn(2, 5000, [own]), withOwn(3, -5000, [])])
    expect(sameReceiptTargets(partial).map((c) => c.id)).toEqual(['neu', 'zwei'])
    expect(sameReceiptTargets(v)).toEqual([])
    const rows = linkAllRows(partial, initialRows(partial), 'neu')
    expect([1, 2, 3].map((i) => rows[i]?.action)).toEqual(['link:neu', 'link:neu', ''])
    expect(decisionsOf(partial, rows)).toEqual([
      { idx: 1, action: 'link', costItemId: 'neu', amountCents: 10387, labor35aCents: null },
      { idx: 2, action: 'link', costItemId: 'neu', amountCents: 5000, labor35aCents: null },
    ])
    expect([1, 2].map((i) => linkAllRows(partial, initialRows(partial), 'zwei')[i]?.action)).toEqual(['link:zwei', ''])
  })
})

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

  // Systemprüfung: eine Rechnung mit vielen Zeilen als eine Position
  it('verknüpfen auch mit einer Position, die aus diesem Beleg schon gebucht ist; nie eine Gutschrift', () => {
    const eigen: LineCandidate = { ...KANDIDAT, id: 'neu', description: 'Arbeitspreis', invoiceFile: 'w.pdf' }
    const l = line(0, { suggestion: suggestion({ candidates: [KANDIDAT], sameReceipt: [eigen] }) })
    expect(linkChoices(l, initialRow(l)).map((c) => c.id)).toEqual(['wa', 'neu'])
    expect(fromSameReceipt(l, 'neu')).toBe(true)
    expect(fromSameReceipt(l, 'wa')).toBe(false)
    expect(linkChoices(l, { ...initialRow(l), amount: '-50,00' })).toEqual([])
    expect(shownRow(l, { ...initialRow(l), action: 'link:neu' }).action).toBe('link:neu')
    // Ein älterer Server nennt das Feld nicht.
    expect(linkChoices(line(0), initialRow(line(0)))).toEqual([])
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
  expect(lines[1]).toMatch(/^„Gartenpflege 2025“: 1\.500,00\s€ → 1\.450,00\s€; §35a-Lohn 1\.000,00\s€ → keiner$/)
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

// #490: „N offen“ trägt im Eingang wie auf der Seite Kosten die Farbe der schlechtesten offenen Ampel.
it('openBadgeClass: rot vor gelb vor grün, nur offene Zeilen zählen', () => {
  const line = (state: 'open' | 'created', level: 'gruen' | 'gelb' | 'rot') => ({ state, suggestion: { level } }) as never
  expect(openBadgeClass({ lines: [line('open', 'gruen'), line('open', 'gelb')] })).toBe('badge amber')
  expect(openBadgeClass({ lines: [line('open', 'gelb'), line('open', 'rot')] })).toBe('badge red')
  expect(openBadgeClass({ lines: [line('created', 'rot'), line('open', 'gruen')] })).toBe('badge green')
})

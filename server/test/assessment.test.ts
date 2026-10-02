// Reine Regeln der gespeicherten Auswertung (Belegbuchung, #170): was aus der Antwort der KI an
// Zeilen wird und in welchem Zustand eine Zeile ist.
import test from 'node:test'
import assert from 'node:assert/strict'
import { detectedYear, lineDraft, lineState, linesFromExtraction, withoutBooked, type NewLine } from '../src/assessment.ts'
import type { StoredAssessmentLine, Unit } from '../../shared/types.ts'
import type { Allocation } from '../../shared/allocation.ts'
import { costItemBody } from '../../shared/costItem.ts'

test('Zeilen aus der KI: Kostenart zugeordnet, Cent, nicht gelesener Lohnanteil bleibt null, 0 bleibt 0', () => {
  const lines = linesFromExtraction({
    vendor: 'Stadtwerke',
    positions: [
      { description: 'Frischwasser', category: 'Wasser', amountEur: 612.4, labor35aEur: null },
      { description: 'Kanalgebühr', category: 'Gebühren', amountEur: 80, labor35aEur: 0 },
      { description: 'Unlesbar', category: 'Wasser/Abwasser' },
    ],
  })
  assert.deepEqual(lines, [
    { description: 'Frischwasser', category: 'Wasser/Abwasser', categoryGuessed: false, amountCents: 61240, labor35aCents: null },
    { description: 'Kanalgebühr', category: 'Wasser/Abwasser', categoryGuessed: true, amountCents: 8000, labor35aCents: 0 },
    { description: 'Unlesbar', category: 'Wasser/Abwasser', categoryGuessed: false, amountCents: null, labor35aCents: null },
  ])
})

test('Jahr aus dem Beleg: erst der Leistungszeitraum, dann das Rechnungsdatum, sonst keines', () => {
  assert.equal(detectedYear({ periodStart: '2025-01-01', invoiceDate: '2026-02-15' }), 2025)
  assert.equal(detectedYear({ invoiceDate: '2026-02-15' }), 2026)
  assert.equal(detectedYear({}), null)
})

const stored = (patch: Partial<StoredAssessmentLine>): StoredAssessmentLine => ({
  assessmentId: 'a1', idx: 0, description: 'Frischwasser', category: 'Wasser/Abwasser', categoryGuessed: false,
  amountCents: 70000, labor35aCents: null, booking: null, costItemId: null, dismissed: false, reassessed: false, ...patch,
})

test('Zustand einer Zeile: abgeleitet aus Position, Art und Verwerfen', () => {
  assert.equal(lineState(stored({})), 'open')
  assert.equal(lineState(stored({ dismissed: true })), 'dismissed')
  assert.equal(lineState(stored({ costItemId: 'c1', booking: 'created' })), 'created')
  assert.equal(lineState(stored({ costItemId: 'c1', booking: 'linked' })), 'linked')
  // Nach dem Löschen der Position bleibt `booking` stehen, die Zeile ist trotzdem offen.
  assert.equal(lineState(stored({ costItemId: null, booking: 'linked' })), 'open')
})

test('Erneut ausgewertet: eine Zeile, die einer gebuchten gleicht, kommt nicht noch einmal', () => {
  const fresh: NewLine[] = [
    { description: 'Frischwasser', category: 'Wasser/Abwasser', categoryGuessed: false, amountCents: 70000, labor35aCents: null },
    { description: 'Abwasser', category: 'Wasser/Abwasser', categoryGuessed: false, amountCents: 80000, labor35aCents: null },
  ]
  // Die gebuchte Zeile trägt eine von Hand geänderte Beschreibung; gleich sind Betrag und Kostenart.
  const booked = [stored({ description: 'Wasser 2025 (geändert)', costItemId: 'c1', booking: 'created' })]
  assert.deepEqual(withoutBooked(fresh, booked).map((l) => l.description), ['Abwasser'])
})

// ---------- Entwurf einer KI-Zeile (bisher aiPositionBody in client/src/costForm.memory.test.ts) ----------

const UNITS3: Unit[] = ['u1', 'u2', 'u3'].map((id) => ({ id, propertyId: 'objekt-1', name: id.toUpperCase(), areaM2: 50, participates: true }))
const fieldsOf = (description: string, category: string, amountCents: number, key: Allocation['key'], allocation: Allocation | null, externalTotalCents: number | null = null) =>
  ({ description, category, amountCents, labor35aCents: null, key, allocation, externalTotalCents })
const ALLOC = (patch: Partial<Allocation>): Allocation => ({ key: 'area', meterType: null, directUnitId: null, customShares: null, participantUnitIds: null, externalBasis: null, ...patch })

test('Entwurf einer KI-Zeile: Teilnehmer, Beleg und Rechnungssteller wie bisher bei der KI-Übernahme', () => {
  const draft = lineDraft(fieldsOf('Aufzugswartung', 'Aufzug', 48000, 'area', ALLOC({ participantUnitIds: ['u1', 'u2'] })), { vendor: 'Lift GmbH', invoiceFile: 'b.pdf' }, UNITS3)
  const built = costItemBody(draft, UNITS3, 2026)
  if (!('body' in built)) return assert.fail(built.error)
  assert.deepEqual([built.body.key, built.body.participantUnitIds, built.body.amountCents, built.body.vendor, built.body.invoiceFile, built.body.year], ['area', ['u1', 'u2'], 48000, 'Lift GmbH', 'b.pdf', 2026])
})

test('Entwurf einer KI-Zeile: die Gemeinschaftsabrechnung verlangt die Kosten der Gemeinschaft', () => {
  const alloc = ALLOC({ key: 'external', externalBasis: { measure: 'mea', total: 1000 } })
  const ohne = costItemBody(lineDraft(fieldsOf('Hauswart', 'Hauswart', 12000, 'external', alloc), { vendor: 'WEG', invoiceFile: 'h.pdf' }, UNITS3), UNITS3, 2026)
  assert.match('error' in ohne ? ohne.error : '', /Gemeinschaft/)
  const mit = costItemBody(lineDraft(fieldsOf('Hauswart', 'Hauswart', 12000, 'external', alloc, 12000000), { vendor: 'WEG', invoiceFile: 'h.pdf' }, UNITS3), UNITS3, 2026)
  assert.ok('body' in mit && JSON.stringify(mit.body.externalBasis) === JSON.stringify({ measure: 'mea', total: 1000, totalCents: 12000000 }))
})

test('Entwurf einer KI-Zeile ohne Gedächtnis: nur der Schlüssel, Nebenfelder leer; 0 € ist keine Position', () => {
  const built = costItemBody(lineDraft(fieldsOf('Müll', 'Müllabfuhr', 6000, 'persons', null), { vendor: 'Stadt', invoiceFile: 'm.pdf' }, UNITS3), UNITS3, 2026)
  if (!('body' in built)) return assert.fail(built.error)
  assert.deepEqual(built.body, {
    year: 2026, category: 'Müllabfuhr', description: 'Müll', vendor: 'Stadt', amountCents: 6000, labor35aCents: undefined, key: 'persons',
    directUnitId: null, meterType: null, customShares: null, participantUnitIds: null, externalBasis: null, tenancyAmounts: null,
    selfAmounts: null, invoiceFile: 'm.pdf',
  })
  const null0 = costItemBody(lineDraft(fieldsOf('Müll', 'Müllabfuhr', 0, 'persons', null), { vendor: 'Stadt', invoiceFile: 'm.pdf' }, UNITS3), UNITS3, 2026)
  assert.match('error' in null0 ? null0.error : '', /0 €/)
})

test('Entwurf einer KI-Zeile „Nicht umlagefähig“: ein gemerkter Schlüssel wird keine Einheit für die Steuer (#163)', () => {
  // Wechselt eine Zeile mit gemerktem Schlüssel (hier nur U1 und U2, oder direkt U3) die Kostenart
  // zu „Nicht umlagefähig“, zeigt die Zeile „— trägt der Vermieter“ und keine Einheit. Gebucht
  // werden muss dann auch keine: Sonst wäre die Position für die Steuer still nur diesen Einheiten
  // zugeordnet, und ihr privater Teil verschöbe sich, ohne dass jemand es gewählt hätte.
  for (const alloc of [ALLOC({ participantUnitIds: ['u1', 'u2'] }), ALLOC({ key: 'direct', directUnitId: 'u3' })]) {
    const built = costItemBody(lineDraft(fieldsOf('Dachrinne', 'Nicht umlagefähig', 30000, alloc.key, alloc), { vendor: 'Dachdecker', invoiceFile: 'd.pdf' }, UNITS3), UNITS3, 2026)
    if (!('body' in built)) return assert.fail(built.error)
    assert.deepEqual([built.body.key, built.body.directUnitId, built.body.participantUnitIds], ['area', null, null])
  }
})

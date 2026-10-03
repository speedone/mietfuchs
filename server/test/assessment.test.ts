// Reine Regeln der gespeicherten Auswertung (Belegbuchung, #170): was aus der Antwort der KI an
// Zeilen wird und in welchem Zustand eine Zeile ist.
import test from 'node:test'
import assert from 'node:assert/strict'
import { detectedYear, lineState, linesFromExtraction, withoutBooked, type NewLine } from '../src/assessment.ts'
import type { StoredAssessmentLine } from '../../shared/types.ts'

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
  amountCents: 70000, labor35aCents: null, booking: null, costItemId: null, dismissed: false, ...patch,
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

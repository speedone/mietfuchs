// Die Antwort der Route „Buchen“ (Belegbuchung, #170) als reine Funktion: Die Route und der
// nachgebaute Server der Browser-Tests (client/src/testing/fakeBooking.ts) benutzen dieselbe,
// damit die Oberfläche nicht gegen eine Fassung geprüft wird, die es nur im Test gibt.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { AssessmentView, BookingPreview } from '../../shared/types.ts'
import { bookingResponse } from '../src/bookingPlan.ts'
import { calendarPeriod } from '../../shared/period.ts'

const PREVIEW: BookingPreview = {
  items: [], notices: [], token: 't',
  errors: [{ idx: 0, message: 'Bitte einen Betrag angeben.' }],
  confirm: [{ idx: 1, message: 'Schon erfasst?' }],
}
const VIEW: AssessmentView = {
  id: 'a1', file: 'w.pdf', propertyId: 'objekt-1', year: 2025, detectedYear: 2025, requestedPeriod: calendarPeriod(2025), vendor: null, invoiceDate: null,
  totalGrossCents: null, amountsAdjusted: null, laborFromTotal: false, nextIdx: 0, createdAt: '2026-10-02T00:00:00.000Z',
  originalName: 'w.pdf', lines: [], open: false, sumWarning: null,
}

test('Antwort der Buchung: gebucht 200 mit Stand und Vorschau', () => {
  assert.deepEqual(bookingResponse({ kind: 'done', changed: true, preview: PREVIEW }, VIEW), {
    status: 200, body: { changed: true, assessment: VIEW, preview: PREVIEW },
  })
})

test('Antwort der Buchung: abgelehnt 400 mit allen Meldungen der Vorschau, Fehler vor Rückfragen', () => {
  assert.deepEqual(bookingResponse({ kind: 'refused', preview: PREVIEW }, VIEW), {
    status: 400, body: { error: 'Bitte einen Betrag angeben. Schon erfasst?', preview: PREVIEW },
  })
})

test('Antwort der Buchung: Widerspruch 409 mit der aktuellen Auswertung, veraltet 409 mit der neuen Vorschau', () => {
  assert.deepEqual(bookingResponse({ kind: 'conflict', message: 'Anders gebucht.' }, VIEW), {
    status: 409, body: { error: 'Anders gebucht.', assessment: VIEW },
  })
  assert.deepEqual(bookingResponse({ kind: 'stale', preview: PREVIEW }, VIEW), {
    status: 409,
    body: { error: 'Seit der Vorschau hat sich der Stand geändert. Bitte prüfen Sie die neue Vorschau und buchen Sie dann.', preview: PREVIEW },
  })
})

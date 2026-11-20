// @vitest-environment jsdom
// Der Rückweg einer angelegten Zeile in „Auswertung prüfen“ (Durchsicht der Rückwege): Auf der Seite Kosten steht die
// Liste der Kostenpositionen auf derselben Seite. Dort sagt der Satz nicht „auf der Seite Kosten“, und es gibt keinen
// Knopf „Position öffnen“, der nur das Fenster ohne Löschen öffnete.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { AssessmentView, Extraction } from '../types'
import { PropertyProvider } from '../property'
import { UIProvider } from './feedback'
import AssessmentReview from './AssessmentReview'
import { fakeBooking } from '../testing/fakeBooking'

const YEAR = new Date().getFullYear() - 1
const MUELL: Extraction = { vendor: 'Abfallwirtschaft', invoiceDate: `${YEAR}-12-31`, positions: [{ description: 'Sperrmüll', category: 'Müllbeseitigung', amountEur: 80 }] } as Extraction

beforeEach(() => {
  vi.stubGlobal('fetch', async (url: string) => new Response(JSON.stringify(url.startsWith('/api/properties')
    ? [{ id: 'objekt-1', name: 'Haus', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }]
    : []), { status: 200, headers: { 'content-type': 'application/json' } }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// Eine Auswertung mit einer angelegten Zeile, gebucht mit dem echten Planer
async function created(): Promise<AssessmentView> {
  const fake = fakeBooking({ items: [], units: [] })
  const v = fake.evaluate('muell.pdf', MUELL, { year: YEAR })
  const line = v.lines[0] ?? expect.fail('keine Zeile')
  const decisions = [{ idx: line.idx, action: 'create', fields: line.suggestion?.fields ?? expect.fail('kein Vorschlag'), despiteCandidates: true }]
  const plan = await fake.handle(`/api/assessments/${v.id}/plan`, { method: 'POST', body: JSON.stringify({ decisions }) })
  const { token } = (await plan?.json()) as { token: string }
  await fake.handle(`/api/assessments/${v.id}/book`, { method: 'POST', body: JSON.stringify({ decisions, token }) })
  return fake.assessments[0] ?? expect.fail('keine Auswertung')
}

const show = (a: AssessmentView, page?: 'kosten') => render(
  <PropertyProvider><UIProvider>
    <AssessmentReview assessment={a} units={[]} onChange={() => {}} onOpenItem={() => {}} page={page} />
  </UIProvider></PropertyProvider>,
)

test('angelegte Zeile auf der Seite Kosten: der Satz nennt die Liste auf dieser Seite, ohne „Position öffnen“', async () => {
  show(await created(), 'kosten')
  expect(await screen.findByText(/Rückgängig machen Sie das in der Liste der Kostenpositionen auf dieser Seite: Löschen Sie die Position mit dem Papierkorb an ihrer Zeile \(„Kostenposition löschen“\)\./)).toBeTruthy()
  expect(screen.queryByText(/auf der Seite Kosten/)).toBeNull()
  expect(screen.queryByRole('button', { name: /Position öffnen/ })).toBeNull()
})

test('angelegte Zeile außerhalb der Seite Kosten: der Satz führt auf die Seite Kosten, mit „Position öffnen“', async () => {
  show(await created())
  expect(await screen.findByText(/Rückgängig machen Sie das auf der Seite Kosten:/)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Position öffnen (Sperrmüll)' })).toBeTruthy()
})

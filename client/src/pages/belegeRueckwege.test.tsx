// @vitest-environment jsdom
// Rückwege auf der Seite Belege: Eine fertig gebuchte Auswertung steht nach dem Seitenwechsel nicht mehr im Eingang
// (er lädt nur offene). Vom Beleg im Ordner führt „Auswertung zeigen“ zu ihr zurück, mit ihren gebuchten Zeilen; dort
// lässt sich eine verknüpfte Zeile lösen wie im Eingang. Gerechnet wird mit dem echten Planer (fakeBooking.ts).
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { CostItem, Extraction, Unit } from '../types'
import { PeriodProvider } from '../period'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Belege from './Belege'
import { fakeBooking, type FakeBooking } from '../testing/fakeBooking'
import { calendarPeriod } from '../../../shared/period.ts'

vi.setConfig({ testTimeout: 20000 })
const SLOW = { timeout: 5000 }
const UNITS: Unit[] = [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true }]
const YEAR = new Date().getFullYear() - 1
const MUELL: Extraction = {
  vendor: 'Abfallwirtschaft', invoiceDate: `${YEAR}-12-31`,
  positions: [
    { description: 'Restmüll', category: 'Müllbeseitigung', amountEur: 300 },
    { description: 'Sperrmüll', category: 'Müllbeseitigung', amountEur: 80 },
  ],
} as Extraction
const RESTMUELL: CostItem = {
  id: 'rm', propertyId: 'objekt-1', period: calendarPeriod(YEAR), category: 'Müllbeseitigung', description: 'Restmüll und Biotonne', amountCents: 28000, key: 'area', invoiceFile: 'alt.pdf',
}

let fake: FakeBooking
let sent: { url: string; method: string }[]

const post = (path: string, body: unknown) => fake.handle(path, { method: 'POST', body: JSON.stringify(body) })

// muell.pdf ausgewertet und vollständig gebucht: „Restmüll“ mit der vorhandenen Position verknüpft, „Sperrmüll“ neu angelegt
async function bookAll(): Promise<string> {
  const v = fake.evaluate('muell.pdf', MUELL, { year: YEAR })
  const [first, second] = v.lines
  if (!first || !second) expect.fail('zwei Zeilen erwartet')
  const decisions = [
    { idx: first.idx, action: 'link', costItemId: 'rm', amountCents: 30000, labor35aCents: null, despiteCandidates: true },
    { idx: second.idx, action: 'create', fields: second.suggestion?.fields ?? expect.fail('kein Vorschlag'), despiteCandidates: true },
  ]
  const plan = await post(`/api/assessments/${v.id}/plan`, { decisions })
  const preview = (await plan?.json()) as { token: string; errors: unknown[] }
  expect(preview.errors).toEqual([])
  const done = await post(`/api/assessments/${v.id}/book`, { decisions, token: preview.token })
  expect(done?.status).toBe(200)
  expect(fake.assessments[0]?.open).toBe(false)
  return v.id
}

beforeEach(() => {
  fake = fakeBooking({ items: [RESTMUELL], units: UNITS })
  sent = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
    const method = init?.method ?? 'GET'
    const path = url.split('?')[0] ?? url
    if (method !== 'GET') sent.push({ url: path, method })
    const handled = await fake.handle(url, init)
    if (handled) return handled
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'Haus', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }])
    if (path === '/api/uploads') {
      const upload = (file: string) => ({
        file, size: 4, mtime: '2026-01-01T00:00:00.000Z', originalName: file, mimeType: 'application/pdf', uploadedAt: '2026-01-01T00:00:00.000Z',
        sha256: file, propertyId: 'objekt-1', year: YEAR, invoiceDate: null, kind: 'receipt', bookedItemIds: [] as string[], bookedCents: {}, assessment: null as unknown,
      })
      return json([upload('alt.pdf'), ...fake.assessments.map((a) => ({
        ...upload(a.file),
        bookedItemIds: [...new Set(a.lines.flatMap((l) => (l.costItemId ? [l.costItemId] : [])))],
        assessment: { id: a.id, propertyId: 'objekt-1', open: a.open },
      }))])
    }
    return json(method === 'GET' ? [] : { ok: true })
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const renderOrdner = () => render(
  <PeriodProvider><PropertyProvider><UIProvider>
    <Belege view="ordner" units={UNITS} settings={null} onNavigate={() => {}} renderThumb={() => Promise.resolve('')} />
  </UIProvider></PropertyProvider></PeriodProvider>,
)

test('eine fertig gebuchte Auswertung: der Eingang zeigt sie nicht mehr, „Auswertung zeigen“ am Beleg im Ordner holt sie zurück, und eine Zeile lässt sich lösen', async () => {
  const id = await bookAll()
  renderOrdner()
  const card = await waitFor(() => document.querySelector<HTMLElement>('[data-view="ordner"] li[data-file="muell.pdf"]') ?? expect.fail('kein Beleg im Ordner'), SLOW)
  // Der Befund: nach dem Seitenwechsel steht die Auswertung nirgends
  expect(document.querySelector('[data-assessment]')).toBeNull()
  // An einer gebuchten Zeile hängt die Position nicht von Hand: gelöst wird in der Auswertung
  expect(within(card).queryByRole('button', { name: /Zuordnung lösen/ })).toBeNull()
  fireEvent.click(within(card).getByRole('button', { name: 'Auswertung zeigen (muell.pdf)' }))
  await waitFor(() => expect(document.activeElement?.getAttribute('data-assessment')).toBe(id), SLOW)
  expect(screen.getByRole('tab', { name: /Eingang/ }).getAttribute('aria-selected')).toBe('true')
  const review = within(document.activeElement as HTMLElement)
  expect(review.getByText('✓ verknüpft mit „Restmüll und Biotonne“')).toBeTruthy()
  expect(review.getByText('✓ angelegt als „Sperrmüll“')).toBeTruthy()
  // Lösen wie im Eingang: Häkchen, Vorschau, Buchen
  fireEvent.click(review.getByRole('checkbox', { name: '„Restmüll“ lösen' }))
  fireEvent.click(review.getByRole('button', { name: 'Vorschau' }))
  await review.findByLabelText('Vorschau', {}, SLOW)
  fireEvent.click(review.getByRole('button', { name: 'Buchen' }))
  await waitFor(() => expect(fake.assessments[0]?.lines.find((l) => l.description === 'Restmüll')?.state).toBe('open'), SLOW)
  await screen.findByRole('combobox', { name: 'Was geschieht mit „Restmüll“?' }, SLOW)
})

test('Karte einer Auswertung im Eingang: der Dateiname steht im Kopf neben dem Rechnungssteller', async () => {
  fake.evaluate('muell-januar.pdf', MUELL, { year: YEAR })
  fake.evaluate('muell-juli.pdf', MUELL, { year: YEAR })
  render(
    <PeriodProvider><PropertyProvider><UIProvider>
      <Belege view="eingang" units={UNITS} settings={null} onNavigate={() => {}} renderThumb={() => Promise.resolve('')} />
    </UIProvider></PropertyProvider></PeriodProvider>,
  )
  const cards = await waitFor(() => {
    const found = [...document.querySelectorAll<HTMLElement>('[data-assessment]')]
    return found.length === 2 ? found : expect.fail('zwei Auswertungen erwartet')
  }, SLOW)
  const heads = cards.map((c) => c.querySelector('[data-assessment-head]')?.textContent ?? '')
  expect(heads[0]).toContain('Abfallwirtschaft')
  expect(heads[0]).toContain('muell-januar.pdf')
  expect(heads[1]).toContain('muell-juli.pdf')
})

// Durchsicht: „Position öffnen“ an der angelegten Zeile geht über den Weg, der Objekt und Zeitraum wechselt
// (`onOpenItem` der Seite, App.tsx `openCostItem`), nicht über den bloßen Seitenwechsel; und der Satz nennt, wo gelöscht
// wird (das Fenster „Kostenposition bearbeiten“ hat kein Löschen).
test('zurückgeholte Auswertung: „Position öffnen“ an der angelegten Zeile übergibt die Position, der Satz nennt den Papierkorb in der Kostenliste', async () => {
  const id = await bookAll()
  const onOpenItem = vi.fn()
  const onNavigate = vi.fn()
  render(
    <PeriodProvider><PropertyProvider><UIProvider>
      <Belege view="ordner" units={UNITS} settings={null} onNavigate={onNavigate} onOpenItem={onOpenItem} renderThumb={() => Promise.resolve('')} />
    </UIProvider></PropertyProvider></PeriodProvider>,
  )
  const card = await waitFor(() => document.querySelector<HTMLElement>('[data-view="ordner"] li[data-file="muell.pdf"]') ?? expect.fail('kein Beleg im Ordner'), SLOW)
  fireEvent.click(within(card).getByRole('button', { name: 'Auswertung zeigen (muell.pdf)' }))
  await waitFor(() => expect(document.activeElement?.getAttribute('data-assessment')).toBe(id), SLOW)
  const review = within(document.activeElement as HTMLElement)
  expect(review.getByText(/Rückgängig machen Sie das auf der Seite Kosten: In der Liste der Kostenpositionen löschen Sie die Position mit dem Papierkorb an ihrer Zeile \(„Kostenposition löschen“\)\./)).toBeTruthy()
  fireEvent.click(review.getByRole('button', { name: 'Position öffnen (Sperrmüll)' }))
  expect(onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ description: 'Sperrmüll', period: calendarPeriod(YEAR) }))
  expect(onNavigate).not.toHaveBeenCalled()
})

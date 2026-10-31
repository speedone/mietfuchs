// @vitest-environment jsdom
// Der Beleg an seiner Auswertung im Eingang (#490, Nachdurchsicht): Löschen, Objekt und Zuordnen stehen hinter dem
// Aufklapper „Beleg einordnen oder löschen“ (am Handy war der Eingang sonst fast 6000 px lang). Wer den Beleg löscht oder
// in ein anderes Objekt verschiebt, sieht danach kein „✓ übernommen“ (S-A); Zuordnen verwirft die Vorschläge der KI
// mit Rückfrage, damit „Alle grünen übernehmen“ ihn nicht zusätzlich bucht (K1); an der Karte steht nur ein Jahr (K2).
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
const EXTRACTION: Extraction = { vendor: 'Stadtwerke', invoiceDate: `${YEAR}-12-31`, positions: [{ description: 'Frischwasser', category: 'Wasser/Abwasser', amountEur: 700 }] } as Extraction
// Eine Position ohne Beleg einer anderen Kostenart: Kandidat fürs Zuordnen, macht die Zeile aber nicht gelb
const GRUNDSTEUER: CostItem = { id: 'gs', propertyId: 'objekt-1', period: calendarPeriod(YEAR), category: 'Grundsteuer', description: 'Grundsteuer B', amountCents: 60000, key: 'area' }

let fake: FakeBooking
let files: string[]
// Belege, die nicht mehr da sind oder nicht mehr im gewählten Objekt (gelöscht, verschoben)
let gone: Set<string>
let sent: { url: string; method: string }[]

beforeEach(() => {
  fake = fakeBooking({ items: [GRUNDSTEUER], units: UNITS })
  files = []
  gone = new Set()
  sent = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
    const method = init?.method ?? 'GET'
    const path = url.split('?')[0] ?? url
    if (method !== 'GET') sent.push({ url: path, method })
    if (path === '/api/intake') {
      const file = `beleg-${files.length + 1}.pdf`
      files.push(file)
      return json({ file, kind: 'rechnung', extraction: EXTRACTION, assessment: fake.evaluate(file, EXTRACTION, { year: YEAR }) })
    }
    if (method === 'DELETE' && path.startsWith('/api/uploads/')) { gone.add(decodeURIComponent(path.slice('/api/uploads/'.length))); return json({ ok: true }) }
    if (method === 'PUT' && path.startsWith('/api/uploads/')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { propertyId?: string }
      if (body.propertyId && body.propertyId !== 'objekt-1') gone.add(decodeURIComponent(path.slice('/api/uploads/'.length)))
      return json({ ok: true })
    }
    if (path === '/api/assessments' && method === 'GET') {
      const res = await fake.handle(url, init)
      const list = res ? (await res.json()) as { file: string }[] : []
      return json(list.filter((v) => !gone.has(v.file)))
    }
    const handled = await fake.handle(url, init)
    if (handled) return handled
    if (path === '/api/properties') return json([
      { id: 'objekt-1', name: 'Haus', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null },
      { id: 'objekt-2', name: 'Garten', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null },
    ])
    if (path === '/api/uploads') {
      return json(files.filter((f) => !gone.has(f)).map((file) => ({
        file, size: 4, mtime: '2026-01-01T00:00:00.000Z', originalName: file, mimeType: 'image/jpeg', uploadedAt: '2026-01-01T00:00:00.000Z',
        sha256: file, propertyId: 'objekt-1', year: YEAR, invoiceDate: null, kind: 'receipt', bookedItemIds: [],
        assessment: { id: fake.assessments.find((a) => a.file === file)?.id ?? '', propertyId: 'objekt-1', open: true },
      })))
    }
    return json(method === 'GET' ? [] : { ok: true })
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function evaluated() {
  const { container } = render(
    <PeriodProvider><PropertyProvider><UIProvider>
      <Belege view="eingang" units={UNITS} settings={null} onNavigate={() => {}} renderThumb={() => Promise.resolve('')} />
    </UIProvider></PropertyProvider></PeriodProvider>,
  )
  const input = await waitFor(() => container.querySelector('input[aria-label="Belege und Zählerfotos auswählen"]') as HTMLInputElement ?? expect.fail('kein Dateifeld'))
  fireEvent.change(input, { target: { files: [new File(['JPEG'], 'beleg.jpg', { type: 'image/jpeg' })] } })
  await screen.findByRole('combobox', { name: 'Was geschieht mit „Frischwasser“?' }, SLOW)
  // Der Beleg selbst steht zugeklappt an der Auswertung
  const open = await screen.findByRole('button', { name: 'Beleg einordnen oder löschen' }, SLOW)
  expect(open.getAttribute('aria-expanded')).toBe('false')
  expect(screen.queryByLabelText('beleg-1.pdf einer Position zuordnen')).toBeNull()
  fireEvent.click(open)
  return within(document.querySelector('[data-assessment] li[data-file="beleg-1.pdf"]') as HTMLElement ?? expect.fail('kein Beleg an der Auswertung'))
}

test('Aufklapper: der Beleg an der Auswertung steht zugeklappt, mit nur einem Jahresfeld (dem der Buchung)', async () => {
  const card = await evaluated()
  expect(card.getByLabelText('Objekt für beleg-1.pdf')).toBeTruthy()
  expect(card.queryByLabelText('Jahr für beleg-1.pdf')).toBeNull()
  expect(screen.getAllByRole('combobox', { name: /Jahr/ }).map((s) => s.getAttribute('aria-label'))).toEqual(['Jahr der Buchung'])
  expect(screen.getByRole('button', { name: 'Einordnen schließen' }).getAttribute('aria-expanded')).toBe('true')
})

test('S-A: Löschen an der Auswertung hinterlässt kein „übernommen“', async () => {
  const card = await evaluated()
  fireEvent.click(card.getByRole('button', { name: 'Beleg beleg-1.pdf löschen' }))
  fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Löschen' }))
  await waitFor(() => expect(document.querySelector('[data-assessment]')).toBeNull(), SLOW)
  expect(screen.queryByText(/übernommen/)).toBeNull()
  expect(screen.queryByRole('button', { name: '→ Kosten ansehen' })).toBeNull()
})

test('S-A: in ein anderes Objekt verschoben, hinterlässt die Auswertung kein „übernommen“', async () => {
  const card = await evaluated()
  fireEvent.change(card.getByLabelText('Objekt für beleg-1.pdf'), { target: { value: 'objekt-2' } })
  fireEvent.click(card.getByRole('button', { name: 'Speichern (Objekt für beleg-1.pdf)' }))
  await waitFor(() => expect(document.querySelector('[data-assessment]')).toBeNull(), SLOW)
  expect(screen.queryByText(/übernommen/)).toBeNull()
  expect(screen.queryByRole('button', { name: '→ Kosten ansehen' })).toBeNull()
})

test('K1: Zuordnen fragt nach, verwirft die Vorschläge, und „Alle grünen übernehmen“ bucht den Beleg nicht', async () => {
  const card = await evaluated()
  expect(await screen.findByRole('button', { name: '✓ Alle grünen übernehmen' })).toBeTruthy()
  fireEvent.change(card.getByLabelText('beleg-1.pdf einer Position zuordnen'), { target: { value: 'gs' } })
  fireEvent.click(card.getByRole('button', { name: 'Speichern (Position für beleg-1.pdf)' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog.textContent).toMatch(/Die Vorschläge der KI zu diesem Beleg werden verworfen/)
  fireEvent.click(within(dialog).getByRole('button', { name: 'Zuordnen' }))
  await waitFor(() => expect(sent.some((r) => r.url === '/api/costItems/gs' && r.method === 'PUT')).toBe(true), SLOW)
  await waitFor(() => expect(screen.queryByRole('button', { name: '✓ Alle grünen übernehmen' })).toBeNull(), SLOW)
  expect(fake.items.filter((i) => i.category === 'Wasser/Abwasser')).toEqual([])
  expect(fake.assessments.find((a) => a.file === 'beleg-1.pdf')?.lines.map((l) => l.state)).toEqual(['dismissed'])
})

test('K1: „Abbrechen“ in der Rückfrage ordnet nichts zu, die Wahl bleibt', async () => {
  const card = await evaluated()
  fireEvent.change(card.getByLabelText('beleg-1.pdf einer Position zuordnen'), { target: { value: 'gs' } })
  fireEvent.click(card.getByRole('button', { name: 'Speichern (Position für beleg-1.pdf)' }))
  fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Abbrechen' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(sent.filter((r) => r.url === '/api/costItems/gs')).toEqual([])
  expect((card.getByLabelText('beleg-1.pdf einer Position zuordnen') as HTMLSelectElement).value).toBe('gs')
})

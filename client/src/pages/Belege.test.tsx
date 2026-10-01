// @vitest-environment jsdom
// Der Belegordner (#170): Filter nach Objekt und Jahr, Register je Kostenart, Suche. Die
// Entscheidungslogik prüft receipts.test.ts; hier geht es um das, was nur die Seite zeigt,
// vor allem darum, dass die Auswahlfelder den Wert anzeigen, nach dem tatsächlich gefiltert wird.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { CostItem, Property, UploadInfo } from '../types'
import { YearProvider } from '../year'
import { PropertyProvider } from '../property'
import Belege from './Belege'

const PROPS: Property[] = [
  { id: 'p1', name: 'Lindenstraße', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null },
  { id: 'p2', name: 'Ahornweg', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null },
] as Property[]

const YEAR = new Date().getFullYear() - 1

const up = (file: string, sha = file): UploadInfo => ({
  file, size: 2048, mtime: '2026-01-02T10:00:00.000Z', originalName: file.replace(/^\d+_/, ''), mimeType: 'application/pdf',
  uploadedAt: '2026-01-02T10:00:00.000Z', sha256: sha, propertyId: null, year: null, invoiceDate: null,
})

const ITEMS: Record<string, CostItem[]> = {
  p1: [
    { id: 'gs', propertyId: 'p1', year: YEAR, category: 'Grundsteuer', description: 'Grundsteuer B', amountCents: 60000, key: 'area', invoiceFile: '1_gs.pdf', vendor: 'Stadt' },
    { id: 'w1', propertyId: 'p1', year: YEAR, category: 'Wasser/Abwasser', description: 'Wasser', amountCents: 98000, key: 'area', invoiceFile: '2_wasser.pdf', vendor: 'Stadtwerke' },
    { id: 'w2', propertyId: 'p1', year: YEAR, category: 'Wasser/Abwasser', description: 'Abwasser', amountCents: 26000, key: 'area' },
  ],
  p2: [
    { id: 'x', propertyId: 'p2', year: YEAR, category: 'Grundsteuer', description: 'Grundsteuer Ahornweg', amountCents: 40000, key: 'area', invoiceFile: '3_ahorn.pdf' },
  ],
}

let sent: { url: string; method: string; body: unknown }[]

// Die Abrechnung des Jahres, nur mit dem, was die Belegmappe liest: die Zeilen der Mieter
const SETTLEMENT = {
  year: YEAR, statements: [{ rows: [{ costItemId: 'w1' }, { costItemId: 'gs' }, { costItemId: 'w2' }] }],
  landlord: { rows: [], totalCents: 0 },
}

beforeEach(() => {
  localStorage.clear()
  sent = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const u = new URL(url, 'http://x')
    const method = init?.method ?? 'GET'
    if (method !== 'GET') {
      const body = init?.body instanceof FormData ? Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : (v as File).name])) : JSON.parse(String(init?.body ?? '{}'))
      sent.push({ url: u.pathname, method, body })
      const answer = u.pathname === '/api/upload' ? { file: '99_nachgereicht.pdf' } : { ok: true }
      return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    let body: unknown = []
    if (u.pathname === '/api/properties') body = PROPS
    else if (u.pathname === '/api/uploads') body = [up('1_gs.pdf'), up('2_wasser.pdf'), up('3_ahorn.pdf'), up('4_lose.pdf', '1_gs.pdf')]
    else if (u.pathname === '/api/costItems') body = ITEMS[u.searchParams.get('property') ?? 'p1'] ?? []
    else if (u.pathname.startsWith('/api/settlement/')) body = SETTLEMENT
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const renderPage = () =>
  render(
    <YearProvider>
      <PropertyProvider>
        <Belege renderThumb={() => Promise.resolve('data:image/gif;base64,R0lGODlhAQABAAAAACw=')} />
      </PropertyProvider>
    </YearProvider>,
  )

const select = (label: string) => screen.getByLabelText(label) as HTMLSelectElement

test('zeigt das gewählte Objekt und Jahr, je Kostenart ein Register mit Summe', async () => {
  renderPage()
  await screen.findByText('Wasser/Abwasser')
  expect(select('Objekt').value).toBe('p1')
  expect(select('Jahr').value).toBe(String(YEAR))
  // Das Auswahlfeld zeigt, was gilt: Die angezeigte Option ist die gespeicherte.
  expect(select('Objekt').selectedOptions[0].textContent).toBe('Lindenstraße')
  const wasser = screen.getByText('Wasser/Abwasser').closest('details') as HTMLElement
  expect(within(wasser).getByText('1.240,00 €')).toBeTruthy()
  expect(within(wasser).getByText(/1 von 2 Positionen ohne Beleg/)).toBeTruthy()
  expect(within(wasser).getByText(/Abwasser · 260,00 €/)).toBeTruthy()
  expect(screen.queryByText('Grundsteuer Ahornweg', { exact: false })).toBeNull()
})

test('„alle Objekte“ zeigt auch die Belege des anderen Objekts, mit dessen Namen', async () => {
  renderPage()
  await screen.findByText('Wasser/Abwasser')
  fireEvent.change(select('Objekt'), { target: { value: 'all' } })
  expect(select('Objekt').value).toBe('all')
  await screen.findByText(/Grundsteuer Ahornweg/)
  expect(screen.getAllByText(/Ahornweg/).length).toBeGreaterThan(0)
})

test('die Suche nach einem Betrag findet die Position ohne Beleg', async () => {
  renderPage()
  await screen.findByText('Wasser/Abwasser')
  fireEvent.change(screen.getByLabelText('Suche'), { target: { value: '260,00' } })
  await waitFor(() => expect(screen.queryByText('Grundsteuer')).toBeNull())
  expect(screen.getByText(/Abwasser · 260,00 €/)).toBeTruthy()
})

test('ein inhaltsgleicher Beleg wird als doppelt benannt', async () => {
  renderPage()
  await screen.findByText('Wasser/Abwasser')
  expect(screen.getAllByText(/gleicher Inhalt wie/).length).toBe(2)
})

test('die Belegabdeckung nennt den Anteil der Kosten mit Beleg', async () => {
  renderPage()
  await screen.findByText('Wasser/Abwasser')
  // 600 + 980 von 600 + 980 + 260 Euro sind belegt
  expect(screen.getByText(/Belegabdeckung/).closest('.receipt-coverage')?.textContent).toMatch(/85 %.*1 Position ohne Beleg/)
})

test('„nachreichen“: Hochladen an der Position verknüpft den Beleg mit ihr', async () => {
  renderPage()
  await screen.findByText('Wasser/Abwasser')
  const input = screen.getByLabelText('Beleg für Abwasser hochladen') as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File(['%PDF'], 'abwasser.pdf', { type: 'application/pdf' })] } })
  await waitFor(() => expect(sent.some((r) => r.method === 'PUT')).toBe(true))
  const hoch = sent.find((r) => r.url === '/api/upload')
  expect(hoch?.body).toMatchObject({ file: 'abwasser.pdf', propertyId: 'p1', year: String(YEAR) })
  expect(sent.find((r) => r.method === 'PUT')).toEqual({ url: '/api/costItems/w2', method: 'PUT', body: { invoiceFile: '99_nachgereicht.pdf' } })
})

test('„nachreichen“: ein vorhandener, nicht zugeordneter Beleg lässt sich auswählen', async () => {
  renderPage()
  await screen.findByText('Wasser/Abwasser')
  const auswahl = screen.getByLabelText('Vorhandenen Beleg für Abwasser zuordnen') as HTMLSelectElement
  // Das Feld zeigt „— wählen —“ und speichert nichts, bis jemand wählt.
  expect(auswahl.value).toBe('')
  fireEvent.change(auswahl, { target: { value: '4_lose.pdf' } })
  await waitFor(() => expect(sent).toEqual([{ url: '/api/costItems/w2', method: 'PUT', body: { invoiceFile: '4_lose.pdf' } }]))
})

test('Posteingang: mehrere Belege auf einmal hochladen, mit Objekt und Jahr der Auswahl', async () => {
  renderPage()
  await screen.findByText('Wasser/Abwasser')
  const input = screen.getByLabelText('Belege in den Posteingang hochladen') as HTMLInputElement
  expect(input.multiple).toBe(true)
  fireEvent.change(input, { target: { files: [new File(['%PDF'], 'eins.pdf', { type: 'application/pdf' }), new File(['jpg'], 'zwei.jpg', { type: 'image/jpeg' })] } })
  await waitFor(() => expect(sent.filter((r) => r.url === '/api/upload').length).toBe(2))
  expect(sent.map((r) => r.body)).toEqual([
    { file: 'eins.pdf', propertyId: 'p1', year: String(YEAR) },
    { file: 'zwei.jpg', propertyId: 'p1', year: String(YEAR) },
  ])
})

test('Posteingang: Objekt und Jahr eines Belegs zeigen den gespeicherten Wert und lassen sich ändern', async () => {
  renderPage()
  await screen.findByText('Wasser/Abwasser')
  const objekt = screen.getByLabelText('Objekt für lose.pdf') as HTMLSelectElement
  const jahr = screen.getByLabelText('Jahr für lose.pdf') as HTMLSelectElement
  // Gespeichert ist „ohne“, und genau das steht da.
  expect(objekt.value).toBe('')
  expect(objekt.selectedOptions[0].textContent).toBe('ohne Objekt')
  expect(jahr.value).toBe('')
  fireEvent.change(objekt, { target: { value: 'p2' } })
  await waitFor(() => expect(sent).toEqual([{ url: '/api/uploads/4_lose.pdf', method: 'PUT', body: { propertyId: 'p2' } }]))
  fireEvent.change(jahr, { target: { value: String(YEAR) } })
  await waitFor(() => expect(sent[1]).toEqual({ url: '/api/uploads/4_lose.pdf', method: 'PUT', body: { year: YEAR } }))
})

test('Posteingang: einer Position zuordnen und per KI auswerten', async () => {
  const onEvaluate = vi.fn()
  render(
    <YearProvider>
      <PropertyProvider>
        <Belege renderThumb={() => Promise.resolve('')} onEvaluate={onEvaluate} />
      </PropertyProvider>
    </YearProvider>,
  )
  await screen.findByText('Wasser/Abwasser')
  const zuordnen = screen.getByLabelText('lose.pdf einer Position zuordnen') as HTMLSelectElement
  expect(zuordnen.value).toBe('')
  // Nur Positionen ohne Beleg stehen zur Wahl
  expect([...zuordnen.options].map((o) => o.value)).toEqual(['', 'w2'])
  fireEvent.change(zuordnen, { target: { value: 'w2' } })
  await waitFor(() => expect(sent).toEqual([{ url: '/api/costItems/w2', method: 'PUT', body: { invoiceFile: '4_lose.pdf' } }]))
  fireEvent.click(screen.getByRole('button', { name: 'lose.pdf per KI auswerten' }))
  expect(onEvaluate).toHaveBeenCalledWith([expect.objectContaining({ file: '4_lose.pdf' })])
})

test('Mappen: „Belege für die Steuer“ lädt das ZIP des gewählten Objekts und Jahres', async () => {
  renderPage()
  await screen.findByText('Wasser/Abwasser')
  const link = screen.getByRole('link', { name: /Belege für die Steuer/ }) as HTMLAnchorElement
  expect(link.getAttribute('href')).toBe(`/api/receipts/tax/${YEAR}?property=p1`)
})

test('Mappen: die Belegmappe für Mieter folgt der Abrechnung und nennt, was fehlt', async () => {
  const make = vi.fn(async () => undefined)
  render(
    <YearProvider>
      <PropertyProvider>
        <Belege renderThumb={() => Promise.resolve('')} makeTenantFolder={make} />
      </PropertyProvider>
    </YearProvider>,
  )
  await screen.findByText('Wasser/Abwasser')
  fireEvent.click(screen.getByText(/Belegmappe für Mieter/))
  const summary = await screen.findByText(/2 Belege zu 3 umgelegten Positionen/)
  expect(summary.textContent).toMatch(/1 Position ohne Beleg/)
  fireEvent.click(screen.getByRole('button', { name: 'PDF erstellen' }))
  await waitFor(() => expect(make).toHaveBeenCalled())
  const [plan] = make.mock.calls[0] as unknown as [{ documents: { upload: UploadInfo }[] }]
  expect(plan.documents.map((d) => d.upload.file)).toEqual(['2_wasser.pdf', '1_gs.pdf'])
})

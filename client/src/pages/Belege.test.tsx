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
  uploadedAt: '2026-01-02T10:00:00.000Z', sha256: sha,
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

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', async (url: string) => {
    const u = new URL(url, 'http://x')
    let body: unknown = []
    if (u.pathname === '/api/properties') body = PROPS
    else if (u.pathname === '/api/uploads') body = [up('1_gs.pdf'), up('2_wasser.pdf'), up('3_ahorn.pdf'), up('4_lose.pdf', '1_gs.pdf')]
    else if (u.pathname === '/api/costItems') body = ITEMS[u.searchParams.get('property') ?? 'p1'] ?? []
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

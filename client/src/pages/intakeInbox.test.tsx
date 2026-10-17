// @vitest-environment jsdom
// Belege aus dem Posteingang per KI auswerten (#170): Die Schnellerfassung übernimmt sie aus dem
// Belegordner, ohne sie ein zweites Mal hochzuladen. Der Server bekommt nur den Namen
// (`existingFile`); eine Kopie im Ordner wäre ein Doppelter, den die Prüfsumme danach meldet.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { CostItem, Extraction, Unit, UploadInfo } from '../types'
import { PeriodProvider } from '../period'
import { PropertyProvider } from '../property'
import Schnellerfassung from './Schnellerfassung'
import { fakeBooking } from '../testing/fakeBooking'

const UNITS: Unit[] = [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true }]
const IMAGE: UploadInfo = {
  file: '1767225600000_foto.jpg', size: 4, mtime: '2026-01-01T00:00:00.000Z', originalName: 'foto.jpg', mimeType: 'image/jpeg',
  uploadedAt: '2026-01-01T00:00:00.000Z', sha256: 'x', propertyId: null, year: null, invoiceDate: null, kind: 'receipt',
}
const EXTRACTION: Extraction = {
  vendor: 'Stadtwerke', invoiceDate: '2026-02-15', periodStart: '2025-01-01', periodEnd: '2025-12-31', totalGrossEur: 98,
  positions: [{ description: 'Wasser', category: 'Wasser/Abwasser', amountEur: 98 }],
} as Extraction

let intake: FormData[]
let fetched: string[]
let items: CostItem[]
let sent: { url: string; method: string; body: Record<string, unknown> }[]

beforeEach(() => {
  intake = []
  fetched = []
  items = []
  sent = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url === '/api/intake') {
      intake.push(init?.body as FormData)
      const assessment = fakeBooking({ items, units: UNITS }).evaluate(IMAGE.file, EXTRACTION, { year: 2025 })
      return json({ file: IMAGE.file, kind: 'rechnung', extraction: EXTRACTION, assessment })
    }
    if (url.startsWith('/uploads/')) {
      fetched.push(url)
      return new Response(new Blob(['JPEG'], { type: 'image/jpeg' }), { status: 200 })
    }
    const method = init?.method ?? 'GET'
    if (method !== 'GET') {
      sent.push({ url, method, body: JSON.parse(String(init?.body ?? '{}')) })
      return json({ ok: true })
    }
    return json(url.split('?')[0] === '/api/costItems' ? items : [])
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('ein Beleg aus dem Posteingang geht als Name an die Auswertung, nicht als neue Datei', async () => {
  const taken = vi.fn()
  render(
    <PeriodProvider>
      <PropertyProvider>
        <Schnellerfassung units={UNITS} settings={null} onNavigate={() => {}} handoff={[IMAGE]} onHandoffTaken={taken} />
      </PropertyProvider>
    </PeriodProvider>,
  )
  await waitFor(() => expect(intake).toHaveLength(1), { timeout: 5000 })
  const fd = intake[0]
  expect(fd.get('existingFile')).toBe(IMAGE.file)
  expect(fd.get('file')).toBeNull()
  expect(fetched).toEqual([`/uploads/${encodeURIComponent(IMAGE.file)}`])
  expect(taken).toHaveBeenCalled()
  // Ausgewertet steht der Beleg mit seinem Rechnungssteller in der Liste
  expect((await screen.findAllByText(/Stadtwerke/, {}, { timeout: 5000 })).length).toBeGreaterThan(0)
})

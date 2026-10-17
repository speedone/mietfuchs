// @vitest-environment jsdom
// Die KI-Auswertung schickt Objekt und Jahr mit (Belegbuchung, #170). Ein nicht gebuchter Beleg
// steht dann im Posteingang des richtigen Objekts statt „ohne Objekt“, und die Auswertung bekommt
// ein Jahr, wenn der Beleg keines nennt.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { Unit } from '../types'
import { PeriodProvider } from '../period'
import { PropertyProvider } from '../property'
import Kosten from './Kosten'
import Schnellerfassung from './Schnellerfassung'

const UNITS: Unit[] = [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true }]
const YEAR = new Date().getFullYear() - 1
let sent: FormData[]

beforeEach(() => {
  sent = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url === '/api/extract' || url === '/api/intake') {
      if (init?.body instanceof FormData) sent.push(init.body)
      return json({ file: 'beleg.jpg', kind: 'rechnung', extraction: { positions: [] }, assessment: null })
    }
    if (url.split('?')[0] === '/api/properties') return json([{ id: 'objekt-1', name: 'Haus', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }])
    return json([])
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function upload(container: HTMLElement) {
  const input = await waitFor(() => {
    const found = container.querySelector('input[type="file"][multiple]')
    if (!(found instanceof HTMLInputElement)) throw new Error('das Dateifeld ist noch nicht da')
    return found
  })
  fireEvent.change(input, { target: { files: [new File(['JPEG'], 'beleg.jpg', { type: 'image/jpeg' })] } })
  await waitFor(() => expect(sent).toHaveLength(1))
}

test('Kosten: die KI-Auswertung schickt Objekt und Jahr mit', async () => {
  const { container } = render(<PeriodProvider><PropertyProvider><Kosten units={UNITS} settings={null} /></PropertyProvider></PeriodProvider>)
  await upload(container)
  expect(sent[0]?.get('propertyId')).toBe('objekt-1')
  expect(sent[0]?.get('year')).toBe(String(YEAR))
})

test('Schnellerfassung: ebenso, auch für einen Beleg aus dem Posteingang', async () => {
  const { container } = render(<PeriodProvider><PropertyProvider><Schnellerfassung units={UNITS} settings={null} onNavigate={() => {}} /></PropertyProvider></PeriodProvider>)
  await upload(container)
  expect(sent[0]?.get('propertyId')).toBe('objekt-1')
  expect(sent[0]?.get('year')).toBe(String(YEAR))
})

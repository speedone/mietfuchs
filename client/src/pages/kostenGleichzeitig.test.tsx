// @vitest-environment jsdom
// Zwei Fenster bearbeiten dieselbe Kostenposition: Das Formular schickt den Stand mit, den es beim Öffnen geladen hat,
// und die Ablehnung des Servers steht im Fuß des Seitenfensters; die Eingabe bleibt stehen.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Unit } from '../types'
import { PeriodProvider } from '../period'
import { calendarPeriod } from '../../../shared/period.ts'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import { fmtEuro } from '../api'
import Kosten from './Kosten'

const UNITS: Unit[] = [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true }]
const year = new Date().getFullYear() - 1
const item = () => ({ id: 'c1', propertyId: 'objekt-1', period: calendarPeriod(year), year, category: 'Gebäudeversicherung', description: 'Versicherung', amountCents: 138000, key: 'area' })

let sent: { url: string; method: string; body: Record<string, unknown> }[]
let costItems: unknown[]
let reply: (body: Record<string, unknown>) => { status: number; body: unknown }
const answer = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  sent = []
  costItems = [item()]
  reply = () => ({ status: 200, body: { ok: true } })
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method !== 'GET') {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      sent.push({ url, method, body })
      const r = reply(body)
      return answer(r.body, r.status)
    }
    const path = url.split('?')[0]
    return answer(path === '/api/costItems' ? costItems : path === '/api/properties' ? [{ id: 'objekt-1', name: 'Haus', kind: 'mfh', address: '' }] : [], 200)
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const page = () => render(<PeriodProvider><PropertyProvider><UIProvider><Kosten units={UNITS} settings={null} /></UIProvider></PropertyProvider></PeriodProvider>)
const openEdit = async () => {
  page()
  fireEvent.click(await screen.findByRole('button', { name: 'Kostenposition bearbeiten' }))
  return waitFor(() => screen.getByLabelText(/Beschreibung/i) as HTMLInputElement)
}

test('Speichern schickt den Stand mit, den das Formular beim Öffnen geladen hat', async () => {
  const description = await openEdit()
  fireEvent.change(description, { target: { value: 'Wohngebäudeversicherung' } })
  fireEvent.click(screen.getByRole('button', { name: /^Speichern$/ }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]?.method).toBe('PUT')
  expect(sent[0]?.body).toMatchObject({ description: 'Wohngebäudeversicherung', amountCents: 138000 })
  expect(sent[0]?.body.ifUnchanged).toEqual(item())
})

test('Anlegen schickt keinen gesehenen Stand', async () => {
  costItems = []
  page()
  fireEvent.click(await screen.findByRole('button', { name: /Kostenposition anlegen/i }))
  fireEvent.change(screen.getByLabelText(/Beschreibung/i), { target: { value: 'Wasser' } })
  fireEvent.change(screen.getByLabelText(/Betrag/i), { target: { value: '100,00' } })
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/ }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]?.method).toBe('POST')
  expect('ifUnchanged' in (sent[0]?.body ?? {})).toBe(false)
})

test('Inzwischen an anderer Stelle geändert: Meldung im Fuß des Fensters mit dem, was sich geändert hat; die Eingabe bleibt', async () => {
  const server = 'Die Kostenposition „Versicherung“ wurde inzwischen an anderer Stelle geändert, etwa in einem zweiten Fenster oder auf einem anderen Gerät. Gespeichert wurde nichts.'
  const { year: _year, ...stored } = item()
  reply = () => ({ status: 409, body: { error: server, stale: true, current: { ...stored, amountCents: 150000 } } })
  const description = await openEdit()
  fireEvent.change(description, { target: { value: 'Wohngebäudeversicherung' } })
  fireEvent.click(screen.getByRole('button', { name: /^Speichern$/ }))
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain(server)
  expect(alert.textContent).toContain(`Inzwischen geändert: Betrag (jetzt ${fmtEuro(150000)}).`)
  expect(alert.textContent).toContain('Ihre Eingabe bleibt stehen')
  // Die Meldung steht im Seitenfenster, das offen bleibt, und die Eingabe ist noch da.
  expect(alert.closest('dialog')).not.toBeNull()
  expect((screen.getByLabelText(/Beschreibung/i) as HTMLInputElement).value).toBe('Wohngebäudeversicherung')
  // Ein zweiter Versuch schickt weiter den Stand vom Öffnen, auch wenn die Liste inzwischen neu geladen ist.
  costItems = [{ ...item(), amountCents: 150000 }]
  fireEvent.click(screen.getByRole('button', { name: /^Speichern$/ }))
  await waitFor(() => expect(sent).toHaveLength(2))
  expect(sent[1]?.body.ifUnchanged).toEqual(item())
})

test('Inzwischen gelöscht: der Satz des Servers steht im Fuß des Fensters', async () => {
  const gone = 'Diese Kostenposition wurde inzwischen gelöscht, etwa in einem zweiten Fenster oder auf einem anderen Gerät. Gespeichert wurde nichts.'
  reply = () => ({ status: 404, body: { error: gone } })
  await openEdit()
  fireEvent.click(screen.getByRole('button', { name: /^Speichern$/ }))
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain(gone)
  expect(alert.closest('dialog')).not.toBeNull()
})

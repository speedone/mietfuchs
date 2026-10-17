// @vitest-environment jsdom
// UI-Durchsicht H1: In der Rückfrage wirkt Enter auf den Knopf mit dem Fokus. Vorher bestätigte Enter
// immer, auch mit dem Fokus auf „Abbrechen“; nachgestellt beim Löschen einer Zahlung. Bei einer
// gefährlichen Aktion liegt der Startfokus auf „Abbrechen“, Tab bleibt im Dialog, und nach dem Schließen
// steht der Fokus wieder auf dem Knopf, der die Rückfrage geöffnet hat.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Payment, RentLedger, RentMonth, Tenancy, Unit } from '../types'
import { PeriodProvider } from '../period'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Mietkonto from './Mietkonto'

const YEAR = new Date().getFullYear() - 1
const UNITS: Unit[] = [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true }]
const TENANCIES: Tenancy[] = [{
  id: 't1', unitId: 'u1', tenantName: 'Müller', persons: 1, personHistory: [], start: `${YEAR}-01-01`, end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [{ from: `${YEAR}-01`, monthlyCents: 80000 }],
}]
const month = (m: number): RentMonth => ({ month: m, baseRentCents: 80000, prepaymentCents: 0, flatRateCents: 0, sollCents: 80000, paidCents: 80000, status: 'paid' })
const LEDGER: RentLedger = {
  year: YEAR,
  rows: [{
    tenancyId: 't1', tenantName: 'Müller', unitName: 'EG', months: Array.from({ length: 12 }, (_, i) => month(i + 1)),
    sollYearCents: 960000, baseRentYearCents: 960000, prepaymentYearCents: 0, flatRateYearCents: 0,
    paidYearCents: 960000, settlementYearCents: 0, balanceCents: 0, dueSollCents: 960000, arrearsCents: 0, openMonths: 0,
  }],
  settlementOnly: [],
  totals: { sollYearCents: 960000, paidYearCents: 960000, settlementYearCents: 0, openCents: 0 },
}
const PAYMENTS: Payment[] = [{ id: 'p1', tenancyId: 't1', date: `${YEAR}-06-15`, amountCents: 80000, kind: 'rent' }]

let sent: { url: string; method: string }[]
beforeEach(() => {
  sent = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method !== 'GET') {
      sent.push({ url, method })
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const path = url.split('?')[0] ?? url
    const responses: Record<string, unknown> = {
      '/api/properties': [{ id: 'objekt-1', name: 'A', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }],
      '/api/tenancies': TENANCIES,
      '/api/payments': PAYMENTS,
      '/api/units': UNITS,
    }
    const body = path.startsWith('/api/rentledger/') ? LEDGER : responses[path] ?? []
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const shell = () => render(<PeriodProvider><PropertyProvider><UIProvider><Mietkonto /></UIProvider></PropertyProvider></PeriodProvider>)
const focusedText = () => document.activeElement?.textContent ?? ''
const key = (k: string, shiftKey = false) => {
  const target = document.activeElement ?? document.body
  fireEvent.keyDown(target, { key: k, shiftKey })
}

test('Zahlung löschen: Startfokus auf Abbrechen, Tab bleibt im Dialog, Enter auf Abbrechen löscht nicht', async () => {
  shell()
  const trash = await screen.findByRole('button', { name: 'Zahlung löschen' })
  trash.focus()
  fireEvent.click(trash)
  await screen.findByRole('dialog', { name: 'Zahlung löschen?' })
  expect(focusedText()).toBe('Abbrechen')
  key('Tab')
  expect(focusedText()).toBe('Löschen')
  key('Tab') // Fokusfalle: vom letzten Knopf zurück auf den ersten
  expect(focusedText()).toBe('Abbrechen')
  key('Tab', true) // Shift+Tab vom ersten auf den letzten
  expect(focusedText()).toBe('Löschen')
  key('Tab', true) // Shift+Tab auf „Abbrechen“
  expect(focusedText()).toBe('Abbrechen')
  key('Enter')
  await act(async () => {})
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(sent).toEqual([])
  expect(document.activeElement).toBe(trash)
})

test('Zahlung löschen: Esc bricht ab, Enter auf „Löschen“ löscht', async () => {
  shell()
  const trash = await screen.findByRole('button', { name: 'Zahlung löschen' })
  fireEvent.click(trash)
  await screen.findByRole('dialog')
  key('Escape')
  await act(async () => {})
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(sent).toEqual([])
  fireEvent.click(trash)
  await screen.findByRole('dialog')
  key('Tab')
  expect(focusedText()).toBe('Löschen')
  key('Enter')
  await act(async () => {})
  expect(sent).toEqual([{ url: '/api/payments/p1', method: 'DELETE' }])
})

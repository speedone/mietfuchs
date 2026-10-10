// @vitest-environment jsdom
// Die Karte „Rechtswerte, die noch nicht veröffentlicht sind“ (Heizung PR 17): jeder offene Wert mit Eingabe
// und Quelle; Speichern schickt Zahl und Quelle, ein Fehler steht in der Karte.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import LawOverridesCard from './LawOverridesCard'
import type { LawOverrideSlot } from '../types'

const offen: LawOverrideSlot = { paramId: 'co2.price', title: 'CO₂-Preis je Tonne (Plausibilität)', norm: '§ 4', reason: 'Das UBA veröffentlicht …', year: 2027, yearLabel: '2027', validFrom: '2027-01-01', official: null, override: null, status: 'open' }
let sent: { url: string; method: string; body: unknown }[]
let list: LawOverrideSlot[]
beforeEach(() => {
  sent = []
  list = [offen]
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    sent.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null })
    if (method === 'PUT') list = [{ ...offen, status: 'entered', override: { paramId: 'co2.price', validFrom: '2027-01-01', value: 64.2, source: 'UBA', enteredAt: '2026-12-20' } }]
    return new Response(JSON.stringify(method === 'GET' ? list : { ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('Die Karte zeigt jeden offenen Wert mit Eingabe und Quelle', async () => {
  render(<LawOverridesCard />)
  expect(await screen.findByText('2027: noch nicht veröffentlicht')).toBeTruthy()
  expect(screen.getByLabelText(/Quelle/)).toBeTruthy()
  expect(screen.getByLabelText('Wert 2027, in € je Tonne CO₂ ohne Umsatzsteuer')).toBeTruthy()
})

test('Speichern schickt Zahl und Quelle; ohne Quelle eine Meldung und keine Anfrage', async () => {
  render(<LawOverridesCard />)
  fireEvent.change(await screen.findByLabelText('Wert 2027, in € je Tonne CO₂ ohne Umsatzsteuer'), { target: { value: '64,20' } })
  fireEvent.click(screen.getByText('Speichern'))
  expect(await screen.findByText(/Bitte nennen Sie die Quelle/)).toBeTruthy()
  expect(sent.filter((s) => s.method === 'PUT')).toEqual([])
  fireEvent.change(screen.getByLabelText('Quelle'), { target: { value: 'UBA' } })
  fireEvent.click(screen.getByText('Speichern'))
  await waitFor(() => expect(sent.find((s) => s.method === 'PUT')).toEqual({ url: '/api/law-overrides/co2.price/2027', method: 'PUT', body: { value: 64.2, source: 'UBA' } }))
  expect(await screen.findByText('2027: 64,20 €/t von Ihnen eingetragen am 20.12.2026 (Quelle: UBA)')).toBeTruthy()
  expect(screen.getByText('Eintrag entfernen')).toBeTruthy()
})

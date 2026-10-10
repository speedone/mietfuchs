// @vitest-environment jsdom
// Die Karte „Betriebsstrom“ auf der Seite Heizkosten (Heizung PR 15, #212).
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import OperatingPowerCard from './OperatingPowerCard'
import { CALENDAR_RULES, periodKey } from '../../../shared/period.ts'
import type { CostItem } from '../types'

afterEach(cleanup)

const strom: CostItem = { id: 'strom', propertyId: 'o', period: periodKey('2025-01'), category: 'Beleuchtung/Allgemeinstrom', description: 'Hausstrom 2025', amountCents: 105000, key: 'area' }
const view = { period: periodKey('2025-01'), label: '2025', from: '2025-01-01', to: '2025-12-31', closed: false }
const plant = { id: 'hp', method: 'manual' as const, energy: 'gas' as const }

test('Die Auswahl der Stromrechnung zeigt den gewählten Wert (CLAUDE.md, angezeigter = gespeicherter Wert)', () => {
  render(<OperatingPowerCard plant={plant} view={view} rules={CALENDAR_RULES} items={[strom]} onBooked={vi.fn()} />)
  const select = screen.getByLabelText(/Stromrechnung des Hauses/) as HTMLSelectElement
  expect(select.value).toBe('')
  fireEvent.change(select, { target: { value: 'strom' } })
  expect(select.value).toBe('strom')
})

// P-K1: Die Rechtsaussage der Karte trägt ihre Norm; P-W1: der Satz zum Aufbewahren.
test('Karte: Norm an der Rechtsaussage, Hinweis auf die Darlegungslast, drei Wege', () => {
  render(<OperatingPowerCard plant={plant} view={view} rules={CALENDAR_RULES} items={[strom]} onBooked={vi.fn()} />)
  expect(screen.getByText(/§ 7 Abs\. 2, § 8 Abs\. 2 HeizkostenV; BGH, Urteil vom 03\.06\.2016, V ZR 166\/15/)).toBeTruthy()
  expect(screen.getByText(/BGH, Versäumnisurteil vom 20\.02\.2008, VIII ZR 27\/07, Leitsatz 3/)).toBeTruthy()
  expect(screen.getByLabelText(/geschätzt nach Leistung und Heiztagen/)).toBeTruthy()
  expect(screen.getByLabelText(/gemessen mit Zwischenzähler/)).toBeTruthy()
  fireEvent.click(screen.getByLabelText(/Betrag selbst geschätzt/))
  expect(screen.getByText(/einen Bruchteil der Brennstoffkosten/)).toBeTruthy()
  expect(screen.getByLabelText(/Grundlage der Schätzung/)).toBeTruthy()
})

// P-W5 mit R2-W1: Bei Wärmepumpe und Stromheizung keine Hilfe, nur der Satz; er nennt den Weg für Pumpen
// und Regelung über das Kostenformular.
test('Karte bei Wärmepumpe und Stromheizung: Satz zum Brennstoff, keine Eingaben; bei Gas die Hilfe', () => {
  for (const energy of ['heatPump', 'electric'] as const) {
    const { unmount } = render(<OperatingPowerCard plant={{ ...plant, energy }} view={view} rules={CALENDAR_RULES} items={[strom]} onBooked={vi.fn()} />)
    expect(screen.getByText(/selbst verbraucht, Brennstoff und kein Betriebsstrom/)).toBeTruthy()
    expect(screen.getByText(/Umwälzpumpen oder Regelung/)).toBeTruthy()
    expect(screen.queryByLabelText(/Stromrechnung des Hauses/)).toBeNull()
    unmount()
  }
  render(<OperatingPowerCard plant={plant} view={view} rules={CALENDAR_RULES} items={[strom]} onBooked={vi.fn()} />)
  expect(screen.queryByText(/Brennstoff und kein Betriebsstrom/)).toBeNull()
})

test('Anlegen: schickt den Rumpf an die Route und meldet beim Messdienst, dass der Betrag zu melden ist', async () => {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({}), { status: 201, headers: { 'content-type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)
  const onBooked = vi.fn()
  try {
    render(<OperatingPowerCard plant={{ ...plant, method: 'service' }} view={view} rules={CALENDAR_RULES} items={[strom]} onBooked={onBooked} />)
    fireEvent.change(screen.getByLabelText(/Stromrechnung des Hauses/), { target: { value: 'strom' } })
    fireEvent.change(screen.getByLabelText(/kWh laut Stromrechnung/), { target: { value: '3.000' } })
    fireEvent.change(screen.getByLabelText(/Leistung \(W\)/), { target: { value: '45' } })
    fireEvent.change(screen.getByLabelText(/Stunden je Tag/), { target: { value: '24' } })
    fireEvent.change(screen.getByLabelText(/^Heiztage/), { target: { value: '220' } })
    const button = screen.getByRole('button', { name: /83,16\s€ als Abzug anlegen/ })
    fireEvent.click(button)
    await vi.waitFor(() => expect(onBooked).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0] ?? ['', undefined]
    expect(url).toBe('/api/heating-plants/hp/operating-power')
    expect(JSON.parse(String(init?.body))).toMatchObject({ period: '2025-01', generalItemId: 'strom', billKwh: 3000, heatingDays: 220 })
  } finally {
    vi.unstubAllGlobals()
  }
})

// Durchsicht von #252, G-W1: Die Karte zeigt, was zu Anlage und Heizperiode schon gebucht ist, und fragt bei
// einer zweiten Buchung zurück, statt still doppelt anzulegen.
test('G-W1: schon gebuchter Betriebsstrom und Abzug stehen auf der Karte; eine 409 fragt mit „Trotzdem anlegen“ zurück', async () => {
  const bs: CostItem = { id: 'bs', propertyId: 'o', period: periodKey('2025-01'), category: 'Heizung und Warmwasser', description: 'Betriebsstrom Heizung (geschätzt)', amountCents: 8316, key: 'area', heatingPlantId: 'hp', operatingPower: 'included' }
  const ab: CostItem = { ...strom, id: 'ab', description: 'Abzug Betriebsstrom Heizung (geschätzt)', amountCents: -8316, operatingPower: 'deduction', operatingPowerItemId: 'bs', operatingPowerGeneralId: 'strom' }
  const fremd: CostItem = { ...bs, id: 'fremd', heatingPlantId: 'andere', description: 'Betriebsstrom andere Anlage' }
  let calls = 0
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
    calls++
    return calls === 1
      ? new Response(JSON.stringify({ error: 'Für diese Heizperiode oder diese Stromrechnung ist schon gebucht: „Betriebsstrom Heizung (geschätzt)“.' }), { status: 409, headers: { 'content-type': 'application/json' } })
      : new Response(JSON.stringify({}), { status: 201, headers: { 'content-type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  const onBooked = vi.fn()
  try {
    render(<OperatingPowerCard plant={plant} view={view} rules={CALENDAR_RULES} items={[strom, bs, ab, fremd]} onBooked={onBooked} />)
    const gebucht = screen.getByText(/Schon gebucht/).closest('div') ?? assert_fail()
    expect(gebucht.textContent).toMatch(/Betriebsstrom Heizung \(geschätzt\)/)
    expect(gebucht.textContent).toMatch(/Abzug Betriebsstrom Heizung \(geschätzt\)/)
    expect(gebucht.textContent).not.toMatch(/andere Anlage/)
    fireEvent.change(screen.getByLabelText(/Stromrechnung des Hauses/), { target: { value: 'strom' } })
    fireEvent.click(screen.getByLabelText(/Betrag selbst geschätzt/))
    fireEvent.change(screen.getByLabelText(/geschätzter Betrag/), { target: { value: '83,16' } })
    fireEvent.change(screen.getByLabelText(/^Grundlage der Schätzung/), { target: { value: 'neuer Kessel' } })
    fireEvent.click(screen.getByRole('button', { name: /als Betriebsstrom und Abzug anlegen/ }))
    const nochmal = await screen.findByRole('button', { name: /Trotzdem anlegen/ })
    expect(screen.getByText(/ist schon gebucht/)).toBeTruthy()
    expect(onBooked).not.toHaveBeenCalled()
    fireEvent.click(nochmal)
    await vi.waitFor(() => expect(onBooked).toHaveBeenCalled())
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({ despiteExisting: true, ownCents: 8316 })
  } finally {
    vi.unstubAllGlobals()
  }
})
const assert_fail = (): never => { throw new Error('keine Liste „Schon gebucht“') }

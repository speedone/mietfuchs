// @vitest-environment jsdom
// Durchsicht von #236: Hinweise der Abrechnung nach Stufe auf- oder zugeklappt, und die Dateiauswahl
// „Beleg hochladen …“ bleibt per Tastatur erreichbar.
import { calendarPeriod, calendarYearPeriod, settlementPeriod } from '../../../shared/period.ts'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { CostItem, Settings, Settlement, Tenancy, Unit } from '../types'
import { PeriodProvider } from '../period'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Abrechnung from './Abrechnung'
import Kosten from './Kosten'
import Belege from './Belege'

vi.setConfig({ testTimeout: 20000 })
const SLOW = { timeout: 5000 }
const YEAR = new Date().getFullYear() - 1
const UNITS: Unit[] = [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true }]
const TENANCIES: Tenancy[] = [
  { id: 't1', unitId: 'u1', tenantName: 'Meier', persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] },
]
const COSTS: CostItem[] = [
  { id: 'k1', propertyId: 'objekt-1', period: calendarPeriod(YEAR), category: 'Grundsteuer', description: 'Grundsteuer A', amountCents: 50000, key: 'area' },
  { id: 'k2', propertyId: 'objekt-1', period: calendarPeriod(YEAR), category: 'Gartenpflege', description: 'Gärtnerei Grün', amountCents: 300000, labor35aCents: 150000, key: 'area' },
]
// Eine Begründung aus einer Fundstelle, die bei Warnung und Hinweis eingeklappt wird
const GROUND = 'Heizkosten gehören in die Heizperiode, in der sie verbraucht wurden (BGH VIII ZR 156/11).'
const SETTLEMENT: Settlement = {
  year: YEAR, daysInYear: 365, period: settlementPeriod(calendarYearPeriod(YEAR)), deadline: `${YEAR + 1}-12-31`, statements: [], landlord: { rows: [], totalCents: 0 }, selfUsedShareCents: 0, totalCostsCents: 50000,
  warnings: ['Text Fehler', 'Text Warnung', 'Text Hinweis'],
  notices: [
    { code: 'a', level: 'error', title: 'Titel Fehler', text: `Befund Fehler: 3 % weniger. ${GROUND} Tragen Sie Fehler ein.` },
    { code: 'b', level: 'warning', title: 'Titel Warnung', text: `Befund Warnung: 3 % weniger. ${GROUND} Tragen Sie Warnung ein.` },
    { code: 'c', level: 'hint', title: 'Titel Hinweis', text: `Befund Hinweis: 3 % weniger. ${GROUND} Tragen Sie Hinweis ein.` },
  ],
  closed: null,
}

beforeEach(() => {
  vi.stubGlobal('fetch', async (url: string) => {
    const path = url.split('?')[0] ?? url
    const responses: Record<string, unknown> = {
      '/api/properties': [{ id: 'objekt-1', name: 'A', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }],
      '/api/costItems': COSTS,
      '/api/tenancies': TENANCIES,
      [`/api/settlement/${YEAR}`]: SETTLEMENT,
    }
    return new Response(JSON.stringify(responses[path] ?? []), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const wrap = (node: ReactNode) => render(
  <PeriodProvider><PropertyProvider><UIProvider>{node}</UIProvider></PropertyProvider></PeriodProvider>,
)

// #346, Schritt 10 (M8, Durchsicht M1, S1): Befund, Kürzung und Aufforderung stehen offen da; nur die
// Begründung aus einem Urteil liegt bei Warnung und Hinweis unter „Mehr dazu“. Ein Fehler steht ganz offen (#236).
test('jeder Hinweis zeigt Stufe, Titel und Text; nur die Fundstelle liegt unter „Mehr dazu“, ein Fehler ganz offen', async () => {
  wrap(<Abrechnung settings={null} units={UNITS} tenancies={TENANCIES} reload={async () => {}} onNavigate={() => {}} />)
  await screen.findByText('Titel Fehler', {}, SLOW)
  for (const [title, level] of [['Titel Fehler', 'Fehler'], ['Titel Warnung', 'Warnung'], ['Titel Hinweis', 'Hinweis']] as const) {
    const box = screen.getByText(title).closest('.notice-item')
    if (!(box instanceof HTMLElement)) return expect.fail(`Kein Hinweis „${title}“`)
    // Die Stufe steht als Wort und als Zeichen da, nicht nur in der Farbe.
    expect(within(box).getByText(level)).toBeTruthy()
    expect(box.querySelector('[aria-hidden="true"]')?.textContent).toMatch(/[✖⚠ℹ]/)
    const shown = within(box).getByText(new RegExp(`Befund ${level}: 3 % weniger\\.`))
    expect(shown.closest('[hidden]')).toBeNull()
    expect(shown.textContent).toContain(`Tragen Sie ${level} ein.`)
    if (level === 'Fehler') {
      expect(shown.textContent).toContain('BGH VIII ZR 156/11')
      expect(within(box).queryByRole('button', { name: 'Mehr dazu' })).toBeNull()
      continue
    }
    expect(within(box).getByText(GROUND).closest('[hidden]')).toBeTruthy()
    const toggle = within(box).getByRole('button', { name: 'Mehr dazu' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(toggle.textContent).toBe('Weniger')
    expect(within(box).getByText(GROUND).closest('[hidden]')).toBeNull()
  }
})

test('„Beleg hochladen …“: das Dateifeld ist nur visuell versteckt und lässt sich fokussieren', async () => {
  wrap(<Kosten units={UNITS} settings={null} tenancies={TENANCIES} />)
  fireEvent.click(await screen.findByRole('button', { name: /Kostenposition anlegen/i }, SLOW))
  const label = await screen.findByText(/Beleg hochladen …/, {}, SLOW)
  const input = label.querySelector('input[type="file"]')
  if (!(input instanceof HTMLInputElement)) return expect.fail('Kein Dateifeld im Knopf „Beleg hochladen …“')
  expect(input.hidden).toBe(false)
  expect(input.style.display).not.toBe('none')
  expect(input.classList.contains('sr-only')).toBe(true)
  input.focus()
  expect(document.activeElement).toBe(input)
})

// N9 aus #341: Der Seitentext spricht von Mietfuchs und der KI, nicht von „dem Tool“ und nicht vom Modellnamen;
// welches Modell arbeitet, steht nur in den Einstellungen.
const LOCAL_AI: Settings = {
  houseName: '', address: '', landlordName: '', iban: '', paymentDeadlineDays: 30,
  ollamaUrl: 'http://localhost:11434', ollamaModel: 'qwen3.5:4b',
}

test('Kosten: die Karte zur KI-Auswertung nennt kein Modell', async () => {
  wrap(<Kosten units={UNITS} settings={LOCAL_AI} tenancies={TENANCIES} />)
  const card = (await screen.findByRole('heading', { name: /Beleg per KI auswerten/ }, SLOW)).closest('.card')
  if (!(card instanceof HTMLElement)) return expect.fail('Keine Karte zur KI-Auswertung')
  expect(card.textContent).not.toContain('qwen3.5:4b')
  // „auf diesem Rechner“ stimmt nicht für ein Ollama im Heimnetz (Durchsicht des Zweigs, Befund 2); den Ort nennt das Etikett
  expect(card.textContent).toContain('hochladen — die KI schlägt Kostenpositionen vor')
})

test('Belege: der Text der Ablage sagt „Mietfuchs“ und nennt kein Modell', async () => {
  wrap(<Belege view="eingang" units={UNITS} settings={LOCAL_AI} onNavigate={() => {}} />)
  await screen.findByRole('heading', { name: 'Belege' }, SLOW)
  const drop = (await screen.findByText('Rechnungen und Zählerfotos hierher ziehen', {}, SLOW)).closest('.dropzone')
  if (!(drop instanceof HTMLElement)) return expect.fail('Keine Ablage')
  expect(drop.textContent).not.toContain('Das Tool')
  expect(drop.textContent).not.toContain('qwen3.5:4b')
  expect(drop.textContent).toContain('Mietfuchs speichert jeden Beleg')
  expect(drop.textContent).toContain('Alles bleibt lokal.')
})

test('Kosten: der Lohnanteil in der Tabelle trägt seinen Begriff', async () => {
  wrap(<Kosten units={UNITS} settings={null} tenancies={TENANCIES} />)
  const row = (await screen.findByText('Gärtnerei Grün', {}, SLOW)).closest('tr')
  if (!(row instanceof HTMLElement)) return expect.fail('Keine Zeile der Gartenpflege')
  expect(row.textContent).toContain('davon §35a-Lohn: 1.500,00')
  expect(row.textContent).not.toMatch(/§35a: /)
})

test('Abrechnung: der Aufklapper zum Rechtsstand sagt, was darin steht', async () => {
  wrap(<Abrechnung settings={null} units={UNITS} tenancies={TENANCIES} reload={async () => {}} onNavigate={() => {}} />)
  const summary = await screen.findByText(/^Angewandte Regeln und Rechtswerte · /, {}, SLOW)
  expect(summary.tagName).toBe('SUMMARY')
})

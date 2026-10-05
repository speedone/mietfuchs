// @vitest-environment jsdom
// Kleinigkeiten der Abrechnungsseite aus der Abnahme (#142): was beim Mieter auf dem Papier steht
// und was beim Arbeiten verwirrt.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Settlement, Statement, Tenancy } from '../types'
import { YearProvider } from '../year'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Abrechnung from './Abrechnung'
import type { HistoryEntry } from '../settlementHistory'
import { calendarPeriod, calendarYearPeriod, settlementPeriod } from '../../../shared/period.ts'

// Die Seite rendert ganz; unter Last braucht das mehr als die voreingestellten Zeiten.
vi.setConfig({ testTimeout: 20000 })
const SLOW = { timeout: 5000 }

const YEAR = new Date().getFullYear() - 1
const TENANCIES: Tenancy[] = [{
  id: 't1', unitId: 'u1', tenantName: 'Meier', persons: 2,
  personHistory: [{ from: '2020-01-01', persons: 1 }, { from: `${YEAR}-10-01`, persons: 2 }],
  start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: { [calendarPeriod(YEAR)]: 50000 }, baseRents: [],
}]
const daysIn = (y: number) => ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365)
const bisSept = daysIn(YEAR) - 92
const STATEMENT: Statement = {
  tenancyId: 't1', unitId: 'u1', tenantName: 'Meier', unitName: 'EG', persons: 2, days: daysIn(YEAR), personDays: bisSept + 2 * 92,
  periodStart: `${YEAR}-01-01`, periodEnd: `${YEAR}-12-31`,
  rows: [{ costItemId: 'k1', category: 'Grundsteuer', description: 'Grundsteuer', totalCents: 60000, keyLabel: 'Wohnfläche', shareCents: 60000 }],
  totalShareCents: 60000, total35aCents: 0, prepaymentCents: 50000, prepaymentOverridden: true, suggestedMonthlyCents: 0, balanceCents: -10000,
}
let settlement: Settlement
let history: HistoryEntry[]

beforeEach(() => {
  settlement = {
    year: YEAR, daysInYear: daysIn(YEAR), period: settlementPeriod(calendarYearPeriod(YEAR)), deadline: `${YEAR + 1}-12-31`, statements: [STATEMENT], landlord: { rows: [], totalCents: 0 }, selfUsedShareCents: 0,
    totalCostsCents: 60000, warnings: [], notices: [], closed: null,
  }
  history = []
  vi.stubGlobal('fetch', async (url: string) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    const path = url.split('?')[0] ?? url
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'A', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }])
    if (path === `/api/settlement/${YEAR}`) return json(settlement)
    if (path === `/api/settlement/${YEAR}/history`) return json(history)
    return json([])
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const show = () => render(
  <YearProvider>
    <PropertyProvider>
      <UIProvider><Abrechnung settings={null} units={[]} tenancies={TENANCIES} reload={async () => {}} /></UIProvider>
    </PropertyProvider>
  </YearProvider>,
)

test('„(manuell angepasst)“ steht nur am Bildschirm, nicht auf dem Papier des Mieters', async () => {
  show()
  const mark = await screen.findByText(/manuell angepasst/, {}, SLOW)
  expect(mark.closest('.no-print')).not.toBeNull()
})

test('kein „Abflussprinzip“ mehr, sondern die Kosten des Abrechnungsjahres', async () => {
  show()
  await screen.findByText(`Abgerechnet werden die Kosten des Abrechnungsjahres ${YEAR}.`, { exact: false }, SLOW)
  expect(screen.queryByText(/Abflussprinzip/)).toBeNull()
})

test('Kopfzeile: wechselnde Personenzahl als Bereich mit Personentagen', async () => {
  show()
  await screen.findByText(new RegExp(`1 bis 2 Personen \\(${bisSept + 184} Personentage\\)`), {}, SLOW)
})

test('„✎ anpassen“ schließt mit Abbrechen und mit Esc', async () => {
  show()
  fireEvent.click(await screen.findByRole('button', { name: /anpassen/ }, SLOW))
  fireEvent.click(screen.getByRole('button', { name: /^Abbrechen$/ }))
  await waitFor(() => expect(screen.queryByRole('button', { name: /^Abbrechen$/ })).toBeNull(), SLOW)

  fireEvent.click(screen.getByRole('button', { name: /anpassen/ }))
  const feld = screen.getByLabelText(/Gezahlte Vorauszahlung/)
  fireEvent.keyDown(feld, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByLabelText(/Gezahlte Vorauszahlung/)).toBeNull(), SLOW)
})

test('nach dem Wiederöffnen bleibt der frühere Versand sichtbar, die Frist läuft nicht scheinbar neu', async () => {
  history = [{ id: 'h1', closedAt: `${YEAR + 1}-01-10T09:00:00.000Z`, sentAt: `${YEAR + 1}-01-12`, reopenedAt: `${YEAR + 1}-03-01T10:00:00.000Z`, settlement: {} }]
  show()
  await screen.findByText(new RegExp(`frühere Fassung der Abrechnung ${YEAR} wurde am 12\\.01\\.${YEAR + 1} versendet`), {}, SLOW)
  expect(screen.queryByText(/^Abrechnungsfrist/)).toBeNull()
})

test('Vermieteranteil: die Spalte „Grund“ nennt die tatsächlichen Gründe der Zeile', async () => {
  settlement.landlord = {
    rows: [{ costItemId: 'k2', category: 'Müllabfuhr', description: 'Müll', totalCents: 40000, keyLabel: 'Wohnfläche', shareCents: 20000, landlordParts: [{ reason: 'flatRate', cents: 20000 }] }],
    totalCents: 20000,
  }
  show()
  const zeile = (await screen.findByText('Müll', {}, SLOW)).closest('tr')
  expect(zeile?.textContent).toMatch(/Betriebskostenpauschale/)
  expect(zeile?.textContent).not.toMatch(/Eigennutzung \/ Leerstand/)
})

test('Kopfzeile ohne Adresse endet nicht mit einem Trenner', async () => {
  show()
  await screen.findByText(/manuell angepasst/, {}, SLOW)
  const kopf = document.querySelector('.card.statement > .muted')
  expect(kopf?.textContent?.trim()).toBe('A')
})

// Durchsicht von #222 (M1): Bei einem Kalenderobjekt nennt der Server die Jahreskorrektur nach
// Jahreszahl, damit ein Tab von vor dem Update sie zurücksetzen kann. Diese Seite schickt Zeiträume;
// „zurücksetzen“ muss die Korrektur des Jahres wirklich entfernen.
test('„zurücksetzen“ entfernt die Korrektur auch, wenn der Server sie nach Jahreszahl nennt (#208)', async () => {
  const puts: unknown[] = []
  const inner = globalThis.fetch
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT' && url.startsWith('/api/tenancies/')) {
      puts.push(JSON.parse(String(init.body)))
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return inner(url, init)
  })
  const mitJahr: Tenancy[] = TENANCIES.map((t) => ({ ...t, prepaymentOverrides: { [String(YEAR - 1)]: 40000, [String(YEAR)]: 50000 } }))
  render(
    <YearProvider>
      <PropertyProvider>
        <UIProvider><Abrechnung settings={null} units={[]} tenancies={mitJahr} reload={async () => {}} /></UIProvider>
      </PropertyProvider>
    </YearProvider>,
  )
  fireEvent.click(await screen.findByRole('button', { name: /^zurücksetzen$/ }, SLOW))
  await waitFor(() => expect(puts).toHaveLength(1), SLOW)
  expect(puts[0]).toEqual({ prepaymentOverrides: { [calendarPeriod(YEAR - 1)]: 40000 } })
})

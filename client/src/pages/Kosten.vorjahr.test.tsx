// @vitest-environment jsdom
// Kosten-Seite mit Vorjahr (#141): der gemerkte Schlüssel im Formular und „Aus dem Vorjahr
// übernehmen“. Geprüft wird, was gespeichert wird, und dass die Auswahl den gespeicherten Wert zeigt.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { CostItem, Unit } from '../types'
import { YearProvider } from '../year'
import { PropertyProvider } from '../property'
import Kosten from './Kosten'

const UNITS: Unit[] = [
  { id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true },
  { id: 'u2', propertyId: 'objekt-1', name: 'OG', areaM2: 60, participates: true },
]
// Die Seite öffnet im Vorjahr des Kalenderjahres (year.tsx); dessen Vorjahr ist das Vorjahr hier.
const YEAR = new Date().getFullYear() - 1
const PREV = YEAR - 1
const ITEMS: CostItem[] = [
  { id: 'a', propertyId: 'objekt-1', year: PREV, category: 'Müllabfuhr', description: `Müllabfuhr ${PREV}`, vendor: 'Stadtwerke', amountCents: 36000, key: 'units', participantUnitIds: ['u1'], invoiceFile: 'muell.pdf' },
  { id: 'b', propertyId: 'objekt-1', year: PREV, category: 'Hauswart', description: 'Hauswart laut Hausgeldabrechnung', amountCents: 48000, key: 'external', externalBasis: { measure: 'mea', total: 1000, totalCents: 4800000 } },
]

let sent: { url: string; method: string; body: Record<string, unknown> }[]

beforeEach(() => {
  sent = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method !== 'GET') {
      sent.push({ url, method, body: JSON.parse(String(init?.body ?? '{}')) })
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const responses: Record<string, unknown> = {
      '/api/properties': [{ id: 'objekt-1', name: 'Haus', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }],
      '/api/costItems': ITEMS,
    }
    return new Response(JSON.stringify(responses[url.split('?')[0] ?? url] ?? []), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const renderPage = async () => {
  render(
    <YearProvider>
      <PropertyProvider>
        <Kosten units={UNITS} settings={null} />
      </PropertyProvider>
    </YearProvider>,
  )
  // Großzügig gewartet: Unter Last (volle Testläufe parallel) kommen Objekt und Kosten später.
  await waitFor(() => expect(screen.getByRole('button', { name: new RegExp(`Aus ${PREV} übernehmen`) })).toBeTruthy(), { timeout: 5000 })
}
const select = (label: RegExp) => screen.getByLabelText(label) as HTMLSelectElement

test('neue Position: der Schlüssel des Vorjahres ist gewählt, angezeigt und gespeichert', async () => {
  await renderPage()
  fireEvent.click(screen.getByRole('button', { name: /Kostenposition manuell erfassen/i }))
  fireEvent.change(select(/Kostenart/i), { target: { value: 'Müllabfuhr' } })
  expect(select(/Umlageschlüssel/i).value).toBe('units')
  // Nur EG ist angehakt, wie im Vorjahr.
  expect((screen.getByLabelText(/^EG$/) as HTMLInputElement).checked).toBe(true)
  expect((screen.getByLabelText(/^OG$/) as HTMLInputElement).checked).toBe(false)
  fireEvent.change(screen.getByLabelText(/Beschreibung/i), { target: { value: `Müllabfuhr ${YEAR}` } })
  fireEvent.change(screen.getByLabelText(/^Betrag/i), { target: { value: '380,00' } })
  fireEvent.click(screen.getByRole('button', { name: /^Hinzufügen$/i }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]?.body).toMatchObject({ key: 'units', participantUnitIds: ['u1'], amountCents: 38000 })
})

test('anderer Schlüssel als im Vorjahr: Hinweis im Formular', async () => {
  await renderPage()
  fireEvent.click(screen.getByRole('button', { name: /Kostenposition manuell erfassen/i }))
  fireEvent.change(select(/Kostenart/i), { target: { value: 'Müllabfuhr' } })
  expect(screen.queryByText(/nicht einseitig/)).toBeNull()
  fireEvent.change(select(/Umlageschlüssel/i), { target: { value: 'area' } })
  expect(screen.getByText(new RegExp(`${PREV} wurde „Müllabfuhr“ nach Wohneinheiten verteilt`))).toBeTruthy()
})

test('Aus dem Vorjahr übernehmen: nur mit Betrag, ohne Beleg, mit Schlüssel und neuer Jahreszahl', async () => {
  await renderPage()
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`Aus ${PREV} übernehmen`) }))
  const anlegen = () => screen.getByRole('button', { name: new RegExp(`für ${YEAR} anlegen`) }) as HTMLButtonElement
  // Nichts ist vorab angehakt.
  expect(anlegen().disabled).toBe(true)
  fireEvent.change(screen.getByLabelText(`Betrag ${YEAR} für Müllabfuhr ${YEAR}`), { target: { value: '380,00' } })
  // Die Hausgeld-Zeile anhaken ohne Betrag: wird genannt und nichts angelegt.
  fireEvent.click(screen.getByLabelText('Hauswart laut Hausgeldabrechnung übernehmen'))
  expect(screen.getByText('Betrag fehlt')).toBeTruthy()
  fireEvent.click(anlegen())
  await waitFor(() => expect(screen.getByText(/Nicht übernommen: „Hauswart laut Hausgeldabrechnung“: Betrag fehlt/)).toBeTruthy())
  expect(sent).toHaveLength(0)
  // Betrag und Kosten der Gemeinschaft nachtragen, dann beide anlegen.
  fireEvent.change(screen.getByLabelText(`Betrag ${YEAR} für Hauswart laut Hausgeldabrechnung`), { target: { value: '500,00' } })
  fireEvent.change(screen.getByLabelText(`Kosten der Gemeinschaft ${YEAR} für Hauswart laut Hausgeldabrechnung`), { target: { value: '50.000,00' } })
  fireEvent.click(anlegen())
  await waitFor(() => expect(sent).toHaveLength(2))
  expect(sent[0]?.body).toMatchObject({
    year: YEAR, category: 'Müllabfuhr', description: `Müllabfuhr ${YEAR}`, vendor: 'Stadtwerke', amountCents: 38000,
    key: 'units', participantUnitIds: ['u1'], invoiceFile: null,
  })
  expect(sent[1]?.body).toMatchObject({ key: 'external', amountCents: 50000, externalBasis: { measure: 'mea', total: 1000, totalCents: 5000000 } })
  expect(sent.every((s) => s.url === '/api/costItems?property=objekt-1')).toBe(true)
})

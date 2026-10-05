// @vitest-environment jsdom
// Kosten-Seite mit Vorjahr (#141): der gemerkte Schlüssel im Formular und „Aus dem Vorjahr
// übernehmen“. Geprüft wird, was gespeichert wird, und dass die Auswahl den gespeicherten Wert zeigt.
import { calendarPeriod } from '../../../shared/period.ts'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { CostItem, Unit } from '../types'
import { YearProvider } from '../year'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Kosten from './Kosten'

const UNITS: Unit[] = [
  { id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true },
  { id: 'u2', propertyId: 'objekt-1', name: 'OG', areaM2: 60, participates: true },
]
// Die Seite öffnet im Vorjahr des Kalenderjahres (year.tsx); dessen Vorjahr ist das Vorjahr hier.
const YEAR = new Date().getFullYear() - 1
const PREV = YEAR - 1
const ITEMS: CostItem[] = [
  { id: 'a', propertyId: 'objekt-1', period: calendarPeriod(PREV), category: 'Müllabfuhr', description: `Müllabfuhr ${PREV}`, vendor: 'Stadtwerke', amountCents: 36000, key: 'units', participantUnitIds: ['u1'], invoiceFile: 'muell.pdf' },
  { id: 'b', propertyId: 'objekt-1', period: calendarPeriod(PREV), category: 'Hauswart', description: 'Hauswart laut Hausgeldabrechnung', amountCents: 48000, key: 'external', externalBasis: { measure: 'mea', total: 1000, totalCents: 4800000 } },
  // Durchsicht: schon im Jahr erfasst, vereinbarte Anteile, Direktzuordnung
  { id: 'c', propertyId: 'objekt-1', period: calendarPeriod(PREV), category: 'Grundsteuer', description: `Grundsteuer ${PREV}`, amountCents: 60000, key: 'area' },
  { id: 'c2', propertyId: 'objekt-1', period: calendarPeriod(YEAR), category: 'Grundsteuer', description: `Grundsteuer ${YEAR}`, amountCents: 61000, key: 'area' },
  { id: 'd', propertyId: 'objekt-1', period: calendarPeriod(PREV), category: 'Gartenpflege', description: 'Garten', amountCents: 30000, key: 'custom', customShares: { u1: 30, u2: 50 } },
  { id: 'e', propertyId: 'objekt-1', period: calendarPeriod(PREV), category: 'Schornsteinfeger', description: 'Kamin', amountCents: 9000, key: 'direct', directUnitId: 'u2' },
  // #163: nicht umlagefähig, für die Steuer der Wohnung OG zugeordnet
  { id: 'f', propertyId: 'objekt-1', period: calendarPeriod(PREV), category: 'Nicht umlagefähig', description: 'Therme OG', amountCents: 25000, key: 'direct', directUnitId: 'u2' },
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
        <UIProvider>
          <Kosten units={UNITS} settings={null} />
        </UIProvider>
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
    period: calendarPeriod(YEAR), category: 'Müllabfuhr', description: `Müllabfuhr ${YEAR}`, vendor: 'Stadtwerke', amountCents: 38000,
    key: 'units', participantUnitIds: ['u1'], invoiceFile: null,
  })
  expect(sent[1]?.body).toMatchObject({ key: 'external', amountCents: 50000, externalBasis: { measure: 'mea', total: 1000, totalCents: 5000000 } })
  expect(sent.every((s) => s.url === '/api/costItems?property=objekt-1')).toBe(true)
})

// ---------- Durchsicht ----------

const openCarry = async () => {
  await renderPage()
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`Aus ${PREV} übernehmen`) }))
}
const anlegenButton = () => screen.getByRole('button', { name: new RegExp(`für ${YEAR} anlegen`) }) as HTMLButtonElement

test('Durchsicht (1): ein Doppelklick legt nur einmal an', async () => {
  await openCarry()
  fireEvent.change(screen.getByLabelText(`Betrag ${YEAR} für Müllabfuhr ${YEAR}`), { target: { value: '380,00' } })
  fireEvent.click(anlegenButton())
  fireEvent.click(anlegenButton())
  await waitFor(() => expect(screen.queryByLabelText(`Betrag ${YEAR} für Müllabfuhr ${YEAR}`)).toBeNull())
  expect(sent).toHaveLength(1)
})

test('Durchsicht (1): über das Formular angelegt, dann der Knopf: nur einmal', async () => {
  await openCarry()
  fireEvent.change(screen.getByLabelText(`Betrag ${YEAR} für Müllabfuhr ${YEAR}`), { target: { value: '380,00' } })
  fireEvent.click(screen.getAllByRole('button', { name: 'Im Formular öffnen' })[0] as HTMLElement)
  fireEvent.click(screen.getByRole('button', { name: /^Hinzufügen$/i }))
  await waitFor(() => expect(sent).toHaveLength(1))
  // Die Zeile ist aus der Liste verschwunden; der Knopf legt nichts mehr an.
  await waitFor(() => expect(screen.queryByLabelText(`Betrag ${YEAR} für Müllabfuhr ${YEAR}`)).toBeNull())
  expect(anlegenButton().disabled).toBe(true)
  fireEvent.click(anlegenButton())
  await new Promise((r) => setTimeout(r, 50))
  expect(sent).toHaveLength(1)
})

test('Durchsicht (1): schon erfasst wird nicht angehakt, und angehakt wird vor dem Anlegen gefragt', async () => {
  await openCarry()
  fireEvent.change(screen.getByLabelText(`Betrag ${YEAR} für Grundsteuer ${YEAR}`), { target: { value: '620,00' } })
  const box = screen.getByLabelText(`Grundsteuer ${YEAR} übernehmen`) as HTMLInputElement
  expect(box.checked).toBe(false)
  fireEvent.click(box)
  fireEvent.click(anlegenButton())
  await waitFor(() => expect(within(screen.getByRole('dialog')).getAllByText(/schon erfasst/i).length).toBeGreaterThan(0))
  fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
  await new Promise((r) => setTimeout(r, 50))
  expect(sent).toHaveLength(0)
  fireEvent.click(anlegenButton())
  fireEvent.click(await waitFor(() => screen.getByRole('button', { name: 'Trotzdem anlegen' })))
  await waitFor(() => expect(sent).toHaveLength(1))
})

test('Durchsicht (5): vereinbarte Anteile mit Summe, Direktzuordnung mit Wohnung', async () => {
  await openCarry()
  expect(screen.getByText('EG: 30 % · OG: 50 % (zusammen 80 %)')).toBeTruthy()
  expect(screen.getByText('direkt OG')).toBeTruthy()
})

test('Durchsicht (3): ein Jahreswechsel mit Eingaben in der Liste fragt nach', async () => {
  await openCarry()
  fireEvent.change(screen.getByLabelText(`Betrag ${YEAR} für Müllabfuhr ${YEAR}`), { target: { value: '380,00' } })
  fireEvent.change(select(/Abrechnungsjahr/i), { target: { value: String(PREV) } })
  fireEvent.click(await waitFor(() => screen.getByRole('button', { name: 'Abbrechen' })))
  await new Promise((r) => setTimeout(r, 50))
  expect(select(/Abrechnungsjahr/i).value).toBe(String(YEAR))
  expect((screen.getByLabelText(`Betrag ${YEAR} für Müllabfuhr ${YEAR}`) as HTMLInputElement).value).toBe('380,00')
  fireEvent.change(select(/Abrechnungsjahr/i), { target: { value: String(PREV) } })
  fireEvent.click(await waitFor(() => screen.getByRole('button', { name: 'Jahr wechseln' })))
  await waitFor(() => expect(select(/Abrechnungsjahr/i).value).toBe(String(PREV)))
})

test('Handy: der Betrag steht gleich hinter der Kostenart, nicht erst nach dem Schlüssel', async () => {
  await openCarry()
  // Bei 360 px ist die Tabelle breiter als der Bildschirm (Table.tsx scrollt nur sie). Der Betrag
  // ist das Feld, das man ausfüllen muss; er gehört deshalb in den ersten sichtbaren Bereich.
  const table = screen.getByRole('heading', { name: new RegExp(`aus ${PREV} für ${YEAR} übernehmen`) }).parentElement?.querySelector('table')
  if (!table) return expect.fail('Tabelle der Übernahme nicht gefunden')
  const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent?.trim())
  expect(heads.slice(0, 4)).toEqual(['Übernehmen', 'Kostenart', `Betrag ${YEAR} €`, '§35a Lohn €'])
  // Die Zellen folgen den Köpfen: das Betragsfeld steht in der dritten Spalte jeder Zeile.
  const row = within(table).getByLabelText(`Betrag ${YEAR} für Müllabfuhr ${YEAR}`).closest('tr')
  const cells = [...(row?.children ?? [])]
  expect(cells.findIndex((td) => td.querySelector(`[aria-label="Betrag ${YEAR} für Müllabfuhr ${YEAR}"]`))).toBe(2)
  expect(cells.findIndex((td) => td.querySelector(`[aria-label="§35a-Lohn ${YEAR} für Müllabfuhr ${YEAR}"]`))).toBe(3)
})

test('Nicht umlagefähig mit Einheit für die Steuer: die Übernahme nennt die Einheit beim Namen (#163)', async () => {
  await openCarry()
  const row = screen.getByLabelText(`Betrag ${YEAR} für Therme OG`).closest('tr')
  if (!row) return expect.fail('Zeile der Übernahme nicht gefunden')
  expect(within(row as HTMLElement).getByText('— trägt der Vermieter · betrifft OG')).toBeTruthy()
})

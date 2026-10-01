// @vitest-environment jsdom
// Komponententest der Kosten-Seite. Er prüft die eine Eigenschaft, die reine Logiktests
// nicht sehen können: dass der angezeigte Wert eines Auswahlfelds und der gespeicherte Wert
// übereinstimmen. Genau diese Lücke war Issue #6 — das Feld zeigte „Sonstig", gespeichert
// wurde „Kaltwasser".
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Meter, Unit } from '../types'
import { YearProvider } from '../year'
import { PropertyProvider } from '../property'
import Kosten from './Kosten'

const UNITS: Unit[] = [
  { id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: false, selfUsed: true, selfPersons: 2 },
  { id: 'u2', propertyId: 'objekt-1', name: 'OG links', areaM2: 90, participates: true },
  { id: 'u3', propertyId: 'objekt-1', name: 'OG rechts', areaM2: 60, participates: true },
]

// Nur ein Zähler, und zwar „sonstig" — die Konstellation aus der Fehlermeldung.
const METERS: Meter[] = [{ id: 'm1', propertyId: 'objekt-1', name: 'Zähler EG', unitId: 'u2', type: 'sonstig', unit: 'm³' }]

let sent: { url: string; method: string; body: Record<string, unknown> }[]
let gets: string[]

beforeEach(() => {
  sent = []
  gets = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method !== 'GET') {
      sent.push({ url, method, body: JSON.parse(String(init?.body ?? '{}')) })
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    gets.push(url)
    const responses: Record<string, unknown> = {
      '/api/properties': [{ id: 'objekt-1', name: 'Haus', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }],
      '/api/costItems': [],
      '/api/meters': METERS,
      '/api/uploads': [],
    }
    return new Response(JSON.stringify(responses[url.split('?')[0] ?? url] ?? []), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const openForm = async () => {
  render(
    <YearProvider>
      <PropertyProvider>
        <Kosten units={UNITS} settings={null} />
      </PropertyProvider>
    </YearProvider>,
  )
  // Auf die geladenen Zähler warten, sonst fehlt der Verbrauchsschlüssel in der Auswahl
  await waitFor(() => expect(screen.getByRole('button', { name: /Kostenposition manuell erfassen/i })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: /Kostenposition manuell erfassen/i }))
  fireEvent.change(screen.getByLabelText(/Beschreibung/i), { target: { value: 'Wasser' } })
  fireEvent.change(screen.getByLabelText(/Betrag/i), { target: { value: '100,00' } })
}

const select = (label: RegExp) => screen.getByLabelText(label) as HTMLSelectElement

test('Zählertyp: angezeigter Wert und gespeicherter Wert stimmen überein', async () => {
  await openForm()
  // Die Zähler kommen nach der Seite (#92: erst wenn das Objekt feststeht); ohne sie fehlt der
  // Verbrauchsschlüssel in der Auswahl.
  await waitFor(() => expect([...select(/Umlageschlüssel/i).options].some((o) => o.value === 'meter')).toBe(true))
  fireEvent.change(select(/Umlageschlüssel/i), { target: { value: 'meter' } })

  const typeSelect = await waitFor(() => select(/Zählertyp/i))
  // Das Feld darf nichts vorbelegen, was in der Liste nicht steht: sichtbar ist „— wählen —".
  expect(typeSelect.value).toBe('')
  expect([...typeSelect.options].map((o) => o.value)).toEqual(['', 'sonstig'])

  // Ohne Auswahl wird nicht gespeichert, sondern nach dem Zählertyp gefragt.
  fireEvent.click(screen.getByRole('button', { name: /^Hinzufügen$/i }))
  await waitFor(() => expect(screen.getByText(/bitte einen Zählertyp wählen/i)).toBeTruthy())
  expect(sent).toHaveLength(0)

  // Nach der Auswahl wird genau der angezeigte Typ gespeichert.
  fireEvent.change(typeSelect, { target: { value: 'sonstig' } })
  expect(typeSelect.value).toBe('sonstig')
  fireEvent.click(screen.getByRole('button', { name: /^Hinzufügen$/i }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0].body).toMatchObject({ key: 'meter', meterType: 'sonstig' })
})

test('Vereinbarte Anteile: Eingabe, Hinweis auf den Vermieter-Rest und Speichern', async () => {
  await openForm()
  fireEvent.change(select(/Umlageschlüssel/i), { target: { value: 'custom' } })

  // Die selbstgenutzte Wohnung darf einen Anteil tragen, ausgenommene gäbe es hier nicht.
  fireEvent.change(await waitFor(() => screen.getByLabelText(/OG links/i)), { target: { value: '40' } })
  fireEvent.change(screen.getByLabelText(/OG rechts/i), { target: { value: '40' } })
  await waitFor(() => expect(screen.getByText(/die restlichen 20 % trägt der Vermieter/i)).toBeTruthy())

  fireEvent.click(screen.getByRole('button', { name: /^Hinzufügen$/i }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0].body).toMatchObject({ key: 'custom', customShares: { u2: 40, u3: 40 } })
})

test('Umlageschlüssel-Auswahl zeigt den gespeicherten Schlüssel auch ohne Wohnungszähler', async () => {
  // Zähler nachträglich gelöscht: „Verbrauch" wird normalerweise nicht angeboten. Die
  // bestehende Position steht aber auf „meter" — dann muss der Eintrag in der Liste bleiben.
  METERS.length = 0
  try {
    await openForm()
    const keySelect = select(/Umlageschlüssel/i)
    expect([...keySelect.options].map((o) => o.value)).not.toContain('meter')
  } finally {
    METERS.push({ id: 'm1', propertyId: 'objekt-1', name: 'Zähler EG', unitId: 'u2', type: 'sonstig', unit: 'm³' })
  }
})

test('Objekt: die Seite lädt und speichert im gewählten Objekt (#92)', async () => {
  await openForm()
  await waitFor(() => expect(gets).toContain('/api/costItems?property=objekt-1'))
  expect(gets).toContain('/api/meters?property=objekt-1')
  fireEvent.click(screen.getByRole('button', { name: /^Hinzufügen$/i }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0].url).toBe('/api/costItems?property=objekt-1')
})

test('Objekt: mit zwei Objekten lädt die Seite erst, wenn das Objekt feststeht (#92)', async () => {
  // Ohne Angabe antwortet der Server bei zwei Objekten mit 400. Ein Abruf, bevor die Objekte
  // geladen sind, ergäbe bei jedem Start eine Fehlermeldung.
  const zwei = [
    { id: 'objekt-1', name: 'A', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null },
    { id: 'objekt-2', name: 'B', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null },
  ]
  vi.stubGlobal('fetch', async (url: string) => {
    gets.push(url)
    const body = url === '/api/properties' ? zwei : []
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  render(
    <YearProvider>
      <PropertyProvider>
        <Kosten units={UNITS} settings={null} />
      </PropertyProvider>
    </YearProvider>,
  )
  await waitFor(() => expect(gets).toContain('/api/costItems?property=objekt-1'))
  expect(gets.filter((u) => u === '/api/costItems' || u === '/api/meters')).toEqual([])
})

test('Einzelbeträge (#94): je Mieter ein Feld, gespeichert wird genau das Eingetragene', async () => {
  const mieter = [
    { id: 't1', unitId: 'u2', tenantName: 'Meier', persons: 1, personHistory: [], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] },
  ]
  render(
    <YearProvider>
      <PropertyProvider>
        <Kosten units={UNITS} settings={null} tenancies={mieter} />
      </PropertyProvider>
    </YearProvider>,
  )
  await waitFor(() => expect(screen.getByRole('button', { name: /Kostenposition manuell erfassen/i })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: /Kostenposition manuell erfassen/i }))
  fireEvent.change(screen.getByLabelText(/Beschreibung/i), { target: { value: 'Heizung laut Techem' } })
  fireEvent.change(screen.getByLabelText(/^Betrag/i), { target: { value: '800,00' } })
  fireEvent.change(select(/Umlageschlüssel/i), { target: { value: 'amounts' } })
  expect(select(/Umlageschlüssel/i).value).toBe('amounts')
  fireEvent.change(screen.getByLabelText(/Meier \(OG links\)/), { target: { value: '312,40' } })
  expect(screen.getByText(/487,60 € trägt der Vermieter/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /^Hinzufügen$/i }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0].body).toMatchObject({ key: 'amounts', tenancyAmounts: { t1: 31240 }, externalBasis: null })
})

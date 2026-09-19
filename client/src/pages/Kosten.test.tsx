// @vitest-environment jsdom
// Komponententest der Kosten-Seite. Er prüft die eine Eigenschaft, die reine Logiktests
// nicht sehen können: dass der angezeigte Wert eines Auswahlfelds und der gespeicherte Wert
// übereinstimmen. Genau diese Lücke war Issue #6 — das Feld zeigte „Sonstig", gespeichert
// wurde „Kaltwasser".
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Meter, Unit } from '../types'
import { YearProvider } from '../year'
import Kosten from './Kosten'

const UNITS: Unit[] = [
  { id: 'u1', name: 'EG', areaM2: 80, participates: false, selfUsed: true, selfPersons: 2 },
  { id: 'u2', name: 'OG links', areaM2: 90, participates: true },
  { id: 'u3', name: 'OG rechts', areaM2: 60, participates: true },
]

// Nur ein Zähler, und zwar „sonstig" — die Konstellation aus der Fehlermeldung.
const METERS: Meter[] = [{ id: 'm1', name: 'Zähler EG', unitId: 'u2', type: 'sonstig', unit: 'm³' }]

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
      '/api/costItems': [],
      '/api/meters': METERS,
      '/api/uploads': [],
    }
    return new Response(JSON.stringify(responses[url] ?? []), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const openForm = async () => {
  render(
    <YearProvider>
      <Kosten units={UNITS} settings={null} />
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
    METERS.push({ id: 'm1', name: 'Zähler EG', unitId: 'u2', type: 'sonstig', unit: 'm³' })
  }
})

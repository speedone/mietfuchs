// @vitest-environment jsdom
// Die Karte „Heizung“ (Heizung PR 4). Geprüft wird, was reine Logik nicht sieht: Der angezeigte Wert
// jedes Auswahlfelds ist der gespeicherte, und das Anlegen schickt die Positionen der Vorschau mit.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AssignableHeatingItem, HeatingPlant, Unit } from '../types'
import { PropertyProvider } from '../property'
import { periodKey } from '../../../shared/period.ts'
import HeatingCard from './HeatingCard'

const UNITS: Unit[] = [
  { id: 'eg', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true },
  { id: 'og', propertyId: 'objekt-1', name: 'OG', areaM2: 70, participates: true },
]
const PLANT: HeatingPlant = {
  id: 'hp1', propertyId: 'objekt-1', name: '', energy: 'districtHeating', supply: 'central', method: 'manual', separateSettlement: null,
  devicesRemote: 'partial', devicesInstalledAfter2021: 'some', source: 'building', captureInstalledOn: null, capturedOnOct2024: null,
  warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: null, periodChanges: [], separateSpans: [], units: null, newDevicesInstall: 'single', nonResidential: false, restriction: 'none', districtEtsNew: false, endsOn: null, replacesPlantId: null,
}
const ITEM: AssignableHeatingItem = { id: 'c1', period: periodKey('2025-01'), description: 'Fernwärme 2025', amountCents: 240000 }

let plants: HeatingPlant[]
let sent: { method: string; url: string; body: Record<string, unknown> }[]
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  plants = []
  sent = []
  try { localStorage.clear() } catch { /* ohne Speicher nichts zu räumen */ }
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const path = url.split('?')[0]
    if (method !== 'GET') {
      sent.push({ method, url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> })
      return json({ plant: PLANT, assigned: 1 }, 201)
    }
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'Haus', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }])
    if (path === '/api/heating-plants') return json(plants)
    if (path === '/api/heating-plants/assignable') return json([ITEM])
    return json([])
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const renderCard = () => render(<PropertyProvider><HeatingCard units={UNITS} /></PropertyProvider>)
const valueOf = (label: RegExp): string => {
  const field = screen.getByLabelText(label)
  if (!(field instanceof HTMLSelectElement)) throw new Error(`kein Auswahlfeld: ${label}`)
  return field.value
}

test('Bearbeiten: jedes Auswahlfeld zeigt den gespeicherten Wert', async () => {
  plants = [{ ...PLANT, method: 'service' }]
  renderCard()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Ändern' })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Ändern' }))
  expect(valueOf(/Womit wird geheizt/)).toBe('districtHeating')
  expect(valueOf(/Wer erstellt Ihre Heizkostenabrechnung/)).toBe('service')
  expect(valueOf(/aus der Ferne ablesbar/)).toBe('partial')
  expect(valueOf(/nach dem 01\.12\.2021 eingebaut/)).toBe('some')
  expect(valueOf(/Wie wurden die nicht fernablesbaren Geräte eingebaut/)).toBe('single')
})

test('Einrichten: Fragen ohne Vorauswahl, und das Anlegen nimmt die Positionen der Vorschau mit', async () => {
  renderCard()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Heizung einrichten' })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Heizung einrichten' }))
  await waitFor(() => expect(screen.getByText(/Diese Heizposition kommt zur Anlage/)).toBeTruthy())
  expect(valueOf(/Womit wird geheizt/)).toBe('')
  expect(valueOf(/Wer erstellt Ihre Heizkostenabrechnung/)).toBe('')
  // Die Frage nach dem Einbau erscheint erst, wenn sie zählt (Nachprüfung von #230).
  expect(screen.queryByLabelText(/Wie wurden die nicht fernablesbaren Geräte eingebaut/)).toBeNull()
  fireEvent.change(screen.getByLabelText(/Womit wird geheizt/), { target: { value: 'gas' } })
  fireEvent.change(screen.getByLabelText(/Wer erstellt Ihre Heizkostenabrechnung/), { target: { value: 'service' } })
  fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]?.method).toBe('POST')
  expect(sent[0]?.body).toMatchObject({ energy: 'gas', method: 'service', source: 'building', units: null, assignItemIds: ['c1'] })
})

// Laienprobe B8, B9: Ohne Messdienst keine Frage nach der Fernablesung; jede Frage hat ihr „Woran erkenne ich das?“.
test('Laienprobe B8, B9: „Niemand“ fragt nicht nach Fernablesung; Hilfesätze zu Energie, Abrechnung und Wohnungen', async () => {
  plants = [PLANT]
  renderCard()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Ändern' })).toBeTruthy())
  expect(screen.queryByText(/Aus der Ferne ablesbar/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Ändern' }))
  expect(valueOf(/Wer erstellt Ihre Heizkostenabrechnung/)).toBe('manual')
  expect(screen.queryByLabelText(/aus der Ferne ablesbar/)).toBeNull()
  expect(screen.queryByLabelText(/nach dem 01\.12\.2021 eingebaut/)).toBeNull()
  expect(screen.getByText(/wählen Sie Fernwärme, auch wenn im Keller ein Kessel steht/)).toBeTruthy()
  expect(screen.getByText(/etwa von ista, Techem, Brunata, Minol oder KALO/)).toBeTruthy()
  expect(screen.getByText(/Angeschlossen ist jede Wohnung, die von dieser Heizung warm wird/)).toBeTruthy()
  fireEvent.change(screen.getByLabelText(/Wer erstellt Ihre Heizkostenabrechnung/), { target: { value: 'service' } })
  expect(screen.getByLabelText(/aus der Ferne ablesbar/)).toBeTruthy()
})

test('„+ weitere Heizanlage“ legt die zweite an und benennt die erste im selben Schritt (Heizung PR 9, Review Focus 1)', async () => {
  plants = [PLANT]
  renderCard()
  await waitFor(() => expect(screen.getByRole('button', { name: '+ weitere Heizanlage' })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: '+ weitere Heizanlage' }))
  // Keine Vorschau der Zuordnung bei der zweiten Anlage.
  await waitFor(() => expect(screen.getByLabelText('Name der neuen Heizanlage')).toBeTruthy())
  expect(screen.queryByText(/kommt zur Anlage/)).toBeNull()
  fireEvent.change(screen.getByLabelText(/Womit wird geheizt/), { target: { value: 'gas' } })
  fireEvent.change(screen.getByLabelText(/Wer erstellt Ihre Heizkostenabrechnung/), { target: { value: 'manual' } })
  fireEvent.change(screen.getByLabelText('Name der neuen Heizanlage'), { target: { value: 'Haus B' } })
  fireEvent.change(screen.getByLabelText('Name der bisherigen Heizanlage'), { target: { value: 'Zentralheizung' } })
  fireEvent.click(screen.getByRole('checkbox', { name: 'OG' }))
  fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]?.body).toMatchObject({
    name: 'Haus B', units: [{ unitId: 'og', heatedAreaM2: null }], assignItemIds: [],
    adjust: [{ id: 'hp1', name: 'Zentralheizung', units: [{ unitId: 'eg', heatedAreaM2: null }] }],
  })
})

test('Etagenheizung: „Ich habe den Vertrag“ fragt nach der Energie und legt eine Anlage je Wohnung an (Heizung PR 9)', async () => {
  renderCard()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Heizung einrichten' })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Heizung einrichten' }))
  await waitFor(() => expect(screen.getByLabelText(/Womit wird geheizt/)).toBeTruthy())
  fireEvent.change(screen.getByLabelText(/Womit wird geheizt/), { target: { value: 'perUnit' } })
  fireEvent.change(screen.getByLabelText(/Wer hat den Vertrag/), { target: { value: 'landlord' } })
  fireEvent.change(screen.getByLabelText(/Womit heizen die Etagenheizungen/), { target: { value: 'gas' } })
  expect(screen.getByText(/§ 5 Abs\. 1 Satz 2 CO2KostAufG/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]?.body).toMatchObject({ energy: 'gas', supply: 'perUnit', method: 'manual', units: null })
})

test('Kessel getauscht: Tag, Energie und Namen gehen an die Route des Tauschs (Heizung PR 9)', async () => {
  plants = [{ ...PLANT, energy: 'oil' }]
  renderCard()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Kessel getauscht' })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Kessel getauscht' }))
  fireEvent.click(screen.getByRole('button', { name: 'Tausch speichern' }))
  await waitFor(() => expect(screen.getByText('Bitte wählen Sie den Tag, an dem die neue Heizung in Betrieb ging.')).toBeTruthy())
  fireEvent.change(screen.getByLabelText('Seit wann heizt die neue Heizung?'), { target: { value: '2025-07-01' } })
  fireEvent.change(screen.getByLabelText('Womit heizt die neue Heizung?'), { target: { value: 'gas' } })
  fireEvent.change(screen.getByLabelText('Name der neuen Heizanlage'), { target: { value: 'Gastherme' } })
  fireEvent.change(screen.getByLabelText('Name der bisherigen Heizanlage'), { target: { value: 'Ölkessel' } })
  fireEvent.click(screen.getByRole('button', { name: 'Tausch speichern' }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]?.url).toBe('/api/heating-plants/hp1/replace')
  expect(sent[0]?.body).toMatchObject({ date: '2025-07-01', energy: 'gas', name: 'Gastherme', previousName: 'Ölkessel' })
})

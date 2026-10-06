// @vitest-environment jsdom
// Die Karte „Heizung“ (Heizung PR 4). Geprüft wird, was reine Logik nicht sieht: Der angezeigte Wert
// jedes Auswahlfelds ist der gespeicherte, und das Anlegen schickt die Positionen der Vorschau mit.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { AssignableHeatingItem, HeatingPlant, Unit } from '../types'
import { PropertyProvider } from '../property'
import { periodKey } from '../../../shared/period.ts'
import HeatingCard from './HeatingCard'
import { UIProvider } from './feedback'

const UNITS: Unit[] = [
  { id: 'eg', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true },
  { id: 'og', propertyId: 'objekt-1', name: 'OG', areaM2: 70, participates: true },
]
const PLANT: HeatingPlant = {
  id: 'hp1', propertyId: 'objekt-1', name: '', energy: 'districtHeating', supply: 'central', method: 'manual', separateSettlement: null,
  devicesRemote: 'partial', devicesInstalledAfter2021: 'some', source: 'building', captureInstalledOn: null, capturedOnOct2024: null,
  warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: null, periodChanges: [], separateSpans: [], units: null, newDevicesInstall: 'single', nonResidential: false, restriction: 'none', districtEtsNew: false, endsOn: null, replacesPlantId: null, buildingWith: null, takesOverStock: null, hotWater: 'combined', capture: null, areaBasisHeat: 'area', heatPumpInstalledOn: null,
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
  // Recht I3 der Durchsicht von #238: ohne Antwort auf die Frage nach dem Gebäude nichts gesendet.
  fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }))
  await waitFor(() => expect(screen.getByText(/im selben Gebäude wie eine bisherige\? Bitte wählen Sie/)).toBeTruthy())
  expect(sent).toHaveLength(0)
  expect(valueOf(/Steht die neue Heizanlage im selben Gebäude/)).toBe('')
  fireEvent.change(screen.getByLabelText(/Steht die neue Heizanlage im selben Gebäude/), { target: { value: 'hp1' } })
  fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]?.body).toMatchObject({
    name: 'Haus B', buildingWith: 'hp1', units: [{ unitId: 'og', heatedAreaM2: null }], assignItemIds: [],
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
  // Recht I5 der Durchsicht von #238: ein eigener Satz zur Auswahl der Wohnungen.
  expect(screen.getByText(/deren Therme über Ihren Gasvertrag läuft/)).toBeTruthy()
  fireEvent.click(screen.getByRole('checkbox', { name: /eigenen Gaszähler/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]?.body).toMatchObject({ energy: 'gas', supply: 'perUnit', method: 'manual', units: null })
})

test('Heizung erneuert (Kessel getauscht): Tag, Energie und Namen gehen an die Route des Tauschs (Heizung PR 9)', async () => {
  plants = [{ ...PLANT, energy: 'oil' }]
  renderCard()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Heizung erneuert (Kessel getauscht)' })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Heizung erneuert (Kessel getauscht)' }))
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

test('Öl → Öl: „Verheizt der neue Kessel den Brennstoff im Tank weiter?“ ist mit Ja vorbelegt und geht mit (Nachprüfung von #238)', async () => {
  plants = [{ ...PLANT, energy: 'oil' }]
  renderCard()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Heizung erneuert (Kessel getauscht)' })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Heizung erneuert (Kessel getauscht)' }))
  expect(screen.queryByLabelText(/Verheizt der neue Kessel/)).toBeNull()
  fireEvent.change(screen.getByLabelText('Seit wann heizt die neue Heizung?'), { target: { value: '2025-07-01' } })
  fireEvent.change(screen.getByLabelText('Womit heizt die neue Heizung?'), { target: { value: 'oil' } })
  expect(valueOf(/Verheizt der neue Kessel den Brennstoff im Tank weiter/)).toBe('yes')
  fireEvent.change(screen.getByLabelText(/Verheizt der neue Kessel/), { target: { value: 'no' } })
  fireEvent.click(screen.getByRole('button', { name: 'Tausch speichern' }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]?.body).toMatchObject({ date: '2025-07-01', energy: 'oil', takesOverStock: false })
})

test('Gebäude: Zeigt die gespeicherte Angabe auf eine stillgelegte Anlage, zeigt die Auswahl deren laufende Nachfolgerin, und gespeichert bleibt der Wert (Nachprüfung von #238)', async () => {
  const unitsOf = (...ids: string[]) => ids.map((unitId) => ({ unitId, heatedAreaM2: null }))
  plants = [
    { ...PLANT, id: 'A', name: 'Öl', energy: 'oil', units: unitsOf('eg'), endsOn: '2025-06-30' },
    { ...PLANT, id: 'A2', name: 'Fernwärme', units: unitsOf('eg'), replacesPlantId: 'A' },
    { ...PLANT, id: 'B', name: 'Haus OG', energy: 'gas', units: unitsOf('og'), buildingWith: 'A' },
  ]
  renderCard()
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Ändern' })).toHaveLength(3))
  fireEvent.click(screen.getAllByRole('button', { name: 'Ändern' })[2] as HTMLElement)
  const select = screen.getByLabelText(/Steht diese Heizanlage im selben Gebäude/)
  if (!(select instanceof HTMLSelectElement)) throw new Error('kein Auswahlfeld')
  expect(select.value).toBe('A')
  expect(select.selectedOptions[0]?.textContent).toBe('Ja, im selben Gebäude wie „Fernwärme“')
  // Die erste Anlage wird nicht nach dem Gebäude gefragt (I-C).
  cleanup()
  renderCard()
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Ändern' })).toHaveLength(3))
  fireEvent.click(screen.getAllByRole('button', { name: 'Ändern' })[1] as HTMLElement)
  expect(screen.queryByLabelText(/im selben Gebäude/)).toBeNull()
})

test('Zurück von „Nein“ auf „Ja“: erst eine Rückfrage, dass der eigene Anfangsbestand entfällt (Nachprüfung von #238, M2)', async () => {
  plants = [
    { ...PLANT, id: 'alt', name: 'Alter Kessel', energy: 'oil', endsOn: '2025-06-30' },
    { ...PLANT, id: 'neu', name: 'Neuer Kessel', energy: 'oil', method: 'manual', replacesPlantId: 'alt', takesOverStock: false },
  ]
  render(<UIProvider><PropertyProvider><HeatingCard units={UNITS} /></PropertyProvider></UIProvider>)
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Ändern' })).toHaveLength(2))
  fireEvent.click(screen.getAllByRole('button', { name: 'Ändern' })[1] as HTMLElement)
  expect(valueOf(/Verheizt der neue Kessel/)).toBe('no')
  fireEvent.change(screen.getByLabelText(/Verheizt der neue Kessel/), { target: { value: 'yes' } })
  fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }))
  const dialog = await screen.findByRole('dialog', { name: 'Brennstoff doch weiter verheizen?' })
  expect(dialog.textContent).toMatch(/eigene Anfangsbestand der neuen Heizanlage in ihrer ersten Heizperiode wird dabei entfernt/)
  fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Brennstoff doch weiter verheizen?' })).toBeNull())
  expect(sent).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Umstellen' }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]?.body).toMatchObject({ takesOverStock: true })
})

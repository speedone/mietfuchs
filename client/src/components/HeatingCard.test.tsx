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
  warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: null, periodChanges: [], separateSpans: [], units: null, newDevicesInstall: 'single', nonResidential: false, restriction: 'none', districtEtsNew: false, secondPrepaymentCoversWater: false, endsOn: null, replacesPlantId: null, buildingWith: null, takesOverStock: null, hotWater: 'combined', capture: null, areaBasisHeat: 'area', heatPumpInstalledOn: null, heatGeneration: null, heatPumpMajority: null, hcaModel: null, operatingPowerHandling: null, contracting: false, heatDeliverySince: null, previousSupply: null, switchAnnouncedOn: null, gmodg43InstalledOn: null, emergencyInstall: null, emergencyPriorDuty: null, newBuildingFirstUse: null, buildingApplicationBefore20260513: null,
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
  expect(screen.getByText(/Kommt die Wärme aus einem Wärmenetz, wählen Sie Fernwärme. Betreibt ein Lieferant den Kessel in Ihrem Haus/)).toBeTruthy()
  expect(screen.getByText(/etwa von ista, Techem, Brunata, Minol oder KALO/)).toBeTruthy()
  expect(screen.getByText(/Angeschlossen ist jede Wohnung, die von dieser Heizung warm wird/)).toBeTruthy()
  fireEvent.change(screen.getByLabelText(/Wer erstellt Ihre Heizkostenabrechnung/), { target: { value: 'service' } })
  expect(screen.getByLabelText(/aus der Ferne ablesbar/)).toBeTruthy()
})

test('„+ weitere Heizanlage“ legt die zweite an und benennt die erste im selben Schritt (Heizung PR 9, Review Focus 1)', async () => {
  plants = [PLANT]
  renderCard()
  await waitFor(() => expect(screen.getByRole('button', { name: '+ Heizanlage anlegen' })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: '+ Heizanlage anlegen' }))
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
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  await waitFor(() => expect(screen.getByText('Bitte wählen Sie den Tag, an dem die neue Heizung in Betrieb ging.')).toBeTruthy())
  fireEvent.change(screen.getByLabelText('Seit wann heizt die neue Heizung?'), { target: { value: '2025-07-01' } })
  fireEvent.change(screen.getByLabelText('Womit heizt die neue Heizung?'), { target: { value: 'gas' } })
  fireEvent.change(screen.getByLabelText('Name der neuen Heizanlage'), { target: { value: 'Gastherme' } })
  fireEvent.change(screen.getByLabelText('Name der bisherigen Heizanlage'), { target: { value: 'Ölkessel' } })
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]?.url).toBe('/api/heating-plants/hp1/replace?property=objekt-1')
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
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
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
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  const dialog = await screen.findByRole('alertdialog', { name: 'Brennstoff doch weiter verheizen?' })
  expect(dialog.textContent).toMatch(/eigene Anfangsbestand der neuen Heizanlage in ihrer ersten Heizperiode wird dabei entfernt/)
  fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog', { name: 'Brennstoff doch weiter verheizen?' })).toBeNull())
  expect(sent).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Umstellen' }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]?.body).toMatchObject({ takesOverStock: true })
})

test('Wärmepumpe erst nach dem Stichtag eingebaut: Auswahl und Einbaudatum zeigen den gespeicherten Wert (Heizung PR 10)', async () => {
  plants = [{ ...PLANT, energy: 'heatPump', method: 'service', heatPumpInstalledOn: '2025-03-01' }]
  renderCard()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Ändern' })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Ändern' }))
  expect(valueOf(/Wurde der Verbrauch der Wärmepumpe am 01\.10\.2024 schon erfasst/)).toBe('newer')
  expect((screen.getByLabelText(/Einbaudatum der Wärmepumpe/) as HTMLInputElement).value).toBe('2025-03-01')
})

test('„Ich selbst“: die Anlage entsteht bei „Niemand“, danach öffnet Schritt 7 (Heizung PR 10, Abweichung 21)', async () => {
  renderCard()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Heizung einrichten' })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Heizung einrichten' }))
  await waitFor(() => expect(screen.getByText(/Diese Heizposition kommt zur Anlage/)).toBeTruthy())
  fireEvent.change(screen.getByLabelText(/Womit wird geheizt/), { target: { value: 'gas' } })
  fireEvent.change(screen.getByLabelText(/Wer erstellt Ihre Heizkostenabrechnung/), { target: { value: 'self' } })
  expect(valueOf(/Wer erstellt Ihre Heizkostenabrechnung/)).toBe('self')
  fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Speichern' })).toBeTruthy())
  expect(sent[0]?.body).toMatchObject({ method: 'manual' })
})

// Befund M6 aus #341: Nach „Ich selbst“ und „Anlegen“ stand „Abrechnung: Niemand …“, mit „Später“ im
// Widerspruch zur Wahl. Gespeichert ist die Anlage bis zum Umstellen bewusst mit freien Schlüsseln
// (Abweichung 21); die Karte sagt das jetzt so, und Schritt 7 wie „Später“ sagen, wann die Abrechnung wechselt.
test('„Ich selbst“ und „Später“: Karte und Mitteilung sagen, dass bis zum Umstellen nach Umlageschlüsseln verteilt wird (#341, M6)', async () => {
  render(<UIProvider><PropertyProvider><HeatingCard units={UNITS} /></PropertyProvider></UIProvider>)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Heizung einrichten' })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Heizung einrichten' }))
  await waitFor(() => expect(screen.getByText(/Diese Heizposition kommt zur Anlage/)).toBeTruthy())
  fireEvent.change(screen.getByLabelText(/Womit wird geheizt/), { target: { value: 'gas' } })
  fireEvent.change(screen.getByLabelText(/Wer erstellt Ihre Heizkostenabrechnung/), { target: { value: 'self' } })
  plants = [PLANT]
  fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Speichern' })).toBeTruthy())
  expect(screen.queryByText(/Abrechnung: Niemand/)).toBeNull()
  expect(screen.getByText('Abrechnung: nach den Umlageschlüsseln der Kostenpositionen, ohne eigene Heizkostenabrechnung')).toBeTruthy()
  const until = /Die Abrechnung wechselt erst, wenn Sie das Fenster „Heizkosten selbst abrechnen“ speichern; bis dahin verteilt Mietfuchs die Heizkosten nach den Umlageschlüsseln der Kostenpositionen\./
  expect(screen.getAllByText(until).length).toBeGreaterThan(0)
  fireEvent.click(screen.getByRole('button', { name: 'Später' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull())
  // Die Mitteilung nach „Später“ sagt es noch einmal, und die Karte bietet die Einrichtung an.
  await waitFor(() => expect(screen.getAllByText(until).length).toBeGreaterThan(0))
  expect(screen.getByRole('button', { name: 'Eigene Heizkostenabrechnung einrichten' })).toBeTruthy()
})

// Heizung PR 16: Der angezeigte Wert der Auswahl „Wer versorgte vorher?“ ist der gespeicherte, und das Häkchen steht.
test('Wärmelieferung: die Auswahl „Wer versorgte vorher?“ zeigt den gespeicherten Wert', async () => {
  plants = [{ ...PLANT, energy: 'gas', contracting: true, heatDeliverySince: '2025-10-01', previousSupply: 'tenant' }]
  renderCard()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Ändern' })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Ändern' }))
  expect(valueOf(/Wer versorgte vorher/)).toBe('tenant')
  expect((screen.getByLabelText(/Ein Dritter betreibt die Heizung/) as HTMLInputElement).checked).toBe(true)
  expect((screen.getByLabelText(/Tag der Umstellung/) as HTMLInputElement).value).toBe('2025-10-01')
})

// Heizung PR 19 (#97, Prüfung M1): zentrale Heizung, Brennstoffvertrag beim Mieter. Keine Anlage; nach Rückfrage
// stehen die laufenden Mietverhältnisse auf „Mieter heizt selbst“.
test('Zentrale Heizung, Brennstoffvertrag beim Mieter: keine Anlage, nach Rückfrage selfSupply an den Mietverhältnissen', async () => {
  const mieter = (id: string, unitId: string) => ({ id, unitId, tenantName: 'Mieter A', persons: 1, personHistory: [], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] })
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const path = url.split('?')[0]
    if (method !== 'GET') {
      sent.push({ method, url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> })
      return json({ ok: true })
    }
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'Haus', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }])
    if (path === '/api/tenancies') return json([mieter('ta', 'eg'), mieter('tb', 'og')])
    return json([])
  })
  render(<PropertyProvider><UIProvider><HeatingCard units={UNITS} /></UIProvider></PropertyProvider>)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Heizung einrichten' })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Heizung einrichten' }))
  fireEvent.change(await screen.findByLabelText(/Womit wird geheizt/), { target: { value: 'oil' } })
  expect(valueOf(/Wer hat den Liefervertrag für den Brennstoff/)).toBe('landlord')
  fireEvent.change(screen.getByLabelText(/Wer hat den Liefervertrag für den Brennstoff/), { target: { value: 'tenantAll' } })
  expect(valueOf(/Wer hat den Liefervertrag für den Brennstoff/)).toBe('tenantAll')
  expect(screen.queryByLabelText(/Wer erstellt Ihre Heizkostenabrechnung/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getByText(/Die laufenden Mietverhältnisse von Mieter A werden unter Heizung auf „Mieter heizt selbst“ gestellt/)).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Umstellen' }))
  await waitFor(() => expect(sent).toHaveLength(2))
  expect(sent.map((s) => [s.method, s.url, s.body])).toEqual([
    ['PUT', '/api/tenancies/ta?property=objekt-1', { heatingModel: 'selfSupply', selfSupplyKind: 'central' }],
    ['PUT', '/api/tenancies/tb?property=objekt-1', { heatingModel: 'selfSupply', selfSupplyKind: 'central' }],
  ])
  expect(sent.some((s) => s.url.startsWith('/api/heating-plants'))).toBe(false)
})

// Nachprüfung N-3 zu PR 19: Steht ein Mietverhältnis schon ohne Art auf „Mieter heizt selbst“, trägt die Einrichtung
// die Art nach, ohne Rückfrage, denn am Modell ändert sich nichts.
test('N-3: schon „Mieter heizt selbst“ ohne Art: die Einrichtung trägt „zentrale Heizung“ nach', async () => {
  const mieter = (id: string, unitId: string) => ({ id, unitId, tenantName: 'Mieter A', persons: 1, personHistory: [], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [], heatingModel: 'selfSupply' })
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const path = url.split('?')[0]
    if (method !== 'GET') {
      sent.push({ method, url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> })
      return json({ ok: true })
    }
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'Haus', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }])
    if (path === '/api/tenancies') return json([mieter('ta', 'eg'), mieter('tb', 'og')])
    return json([])
  })
  render(<PropertyProvider><UIProvider><HeatingCard units={UNITS} /></UIProvider></PropertyProvider>)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Heizung einrichten' })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Heizung einrichten' }))
  fireEvent.change(await screen.findByLabelText(/Womit wird geheizt/), { target: { value: 'oil' } })
  fireEvent.change(screen.getByLabelText(/Wer hat den Liefervertrag für den Brennstoff/), { target: { value: 'tenantAll' } })
  fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }))
  await waitFor(() => expect(sent).toHaveLength(2))
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(sent.map((s) => [s.method, s.url, s.body])).toEqual([
    ['PUT', '/api/tenancies/ta?property=objekt-1', { selfSupplyKind: 'central' }],
    ['PUT', '/api/tenancies/tb?property=objekt-1', { selfSupplyKind: 'central' }],
  ])
})

test('#322, Durchsicht M1: „Ändern“ bei eigener Abrechnung nach umbautem Raum trägt den Rauminhalt je Wohnung ein, die Liste bleibt „alle“', async () => {
  plants = [{ ...PLANT, energy: 'gas', method: 'self', capture: 'heatMeter', areaBasisHeat: 'volume', basisValues: [{ unitId: 'eg', heatedAreaM2: null, volumeM3: 200 }] }]
  const base = globalThis.fetch
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if ((init?.method ?? 'GET') !== 'PUT') return base(url, init)
    sent.push({ method: 'PUT', url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> })
    return json(plants[0])
  })
  render(<UIProvider><PropertyProvider><HeatingCard units={[...UNITS, { id: 'garage', propertyId: 'objekt-1', name: 'Garage', areaM2: 0, participates: true }]} /></PropertyProvider></UIProvider>)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Ändern' })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Ändern' }))
  expect((screen.getByLabelText(/Umbauter Raum EG in m³/) as HTMLInputElement).value).toBe('200')
  expect(screen.queryByLabelText(/Umbauter Raum Garage/)).toBeNull()
  fireEvent.change(screen.getByLabelText(/Umbauter Raum OG in m³/), { target: { value: '175' } })
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  await waitFor(() => expect(sent.some((x) => x.method === 'PUT')).toBe(true))
  expect(sent.find((x) => x.method === 'PUT')?.body).toMatchObject({ units: null, unitValues: [{ unitId: 'eg', volumeM3: 200 }, { unitId: 'og', volumeM3: 175 }] })
})

// Systemprüfung: „Heizung einrichten →“ an einem Hinweis ohne Heizanlage (leere Kennung) und der Leerzustand der Seite
// Heizkosten führten nur an den Anfang der Stammdaten. Die Karte wird hervorgehoben, der Fokus steht auf dem Knopf.
test('Sprung ohne Heizanlage: die Karte „Heizung“ ist hervorgehoben, der Fokus steht auf „Heizung einrichten“', async () => {
  const done = vi.fn()
  render(<PropertyProvider><HeatingCard units={UNITS} focus={{ kind: 'heatingPlant', id: '' }} onFocusDone={done} /></PropertyProvider>)
  const button = await screen.findByRole('button', { name: 'Heizung einrichten' })
  await waitFor(() => expect(document.activeElement).toBe(button))
  expect(button.closest('.card')?.classList.contains('focus-target')).toBe(true)
  expect(done).toHaveBeenCalled()
})

test('ohne Sprung: die Karte „Heizung“ ist nicht hervorgehoben und nimmt keinen Fokus', async () => {
  renderCard()
  const button = await screen.findByRole('button', { name: 'Heizung einrichten' })
  expect(button.closest('.card')?.classList.contains('focus-target')).toBe(false)
  expect(document.activeElement).toBe(document.body)
})

// #720: „Ändern“ auf „Jede Wohnung hat eine eigene Heizung“ mit Vertrag beim Mieter ließ die Anlage stehen und stellte nur
// die Mietverhältnisse um; die Abrechnung meldete danach je Mietverhältnis einen Fehler.
const GAS: HeatingPlant = { ...PLANT, energy: 'gas' }
const tenant = (id: string, unitId: string, tenantName: string) => ({ id, unitId, tenantName, persons: 1, personHistory: [], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] })
function stubChange(blocked: string | null) {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const path = url.split('?')[0]
    if (method !== 'GET') {
      sent.push({ method, url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> })
      if (method === 'DELETE') plants = []
      return json({ ok: true })
    }
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'Haus', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }])
    if (path === '/api/heating-plants') return json(plants)
    if (path === '/api/heating-plants/hp1/removal') return json({ blocked })
    if (path === '/api/tenancies') return json([tenant('ta', 'eg', 'Mieter A'), tenant('tb', 'og', 'Mieter B')])
    return json([])
  })
}
async function changeToOwnHeating() {
  render(<PropertyProvider><UIProvider><HeatingCard units={UNITS} /></UIProvider></PropertyProvider>)
  fireEvent.click(await screen.findByRole('button', { name: 'Ändern' }))
  fireEvent.change(screen.getByLabelText(/Womit wird geheizt/), { target: { value: 'perUnit' } })
  fireEvent.change(screen.getByLabelText(/Wer hat den Vertrag für die Heizung in der Wohnung/), { target: { value: 'tenant' } })
}

test('#720: Ändern auf eigene Heizung je Wohnung: eine Rückfrage, dann wird die Anlage entfernt und erst danach umgestellt', async () => {
  plants = [GAS]
  stubChange(null)
  await changeToOwnHeating()
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getByText('Heizanlage entfernen?')).toBeTruthy()
  expect(dialog.textContent).toMatch(/Mietfuchs entfernt die Heizanlage\. Die Heizpositionen bleiben, wie sie sind, nur ohne Heizanlage\.Die laufenden Mietverhältnisse von Mieter A, Mieter B werden unter Heizung auf „Mieter heizt selbst“ gestellt/)
  // Vor der Antwort ist nichts geschrieben.
  expect(sent).toEqual([])
  fireEvent.click(within(dialog).getByRole('button', { name: 'Entfernen' }))
  await waitFor(() => expect(sent).toHaveLength(3))
  expect(sent.map((s) => [s.method, s.url, s.body])).toEqual([
    ['DELETE', '/api/heating-plants/hp1', {}],
    ['PUT', '/api/tenancies/ta', { heatingModel: 'selfSupply', selfSupplyKind: 'perUnit' }],
    ['PUT', '/api/tenancies/tb', { heatingModel: 'selfSupply', selfSupplyKind: 'perUnit' }],
  ])
  // Die Karte zeigt die Anlage nicht mehr.
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Ändern' })).toBeNull())
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('#720: Abbrechen der Rückfrage ändert nichts, das Fenster bleibt offen', async () => {
  plants = [GAS]
  stubChange(null)
  await changeToOwnHeating()
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  const dialog = await screen.findByRole('alertdialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(sent).toEqual([])
  expect(valueOf(/Womit wird geheizt/)).toBe('perUnit')
})

test('#720: Entfernen gesperrt: der Grund steht im Fenster, keine Rückfrage, nichts wird halb umgestellt', async () => {
  plants = [GAS]
  stubChange('An der Heizanlage hängen noch Zähler („Gaszähler“). Ordnen Sie sie auf der Seite Zähler neu zu oder löschen Sie sie; dann lässt sich die Anlage entfernen.')
  await changeToOwnHeating()
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  expect(await screen.findByText(/Mit eigener Heizung je Wohnung und Vertrag beim Mieter entfällt diese Heizanlage, sie lässt sich aber noch nicht entfernen: An der Heizanlage hängen noch Zähler \(„Gaszähler“\)\..* Es wurde nichts geändert\./)).toBeTruthy()
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(sent).toEqual([])
  expect(valueOf(/Womit wird geheizt/)).toBe('perUnit')
})

test('#720: nur eine Wohnung mit eigener Heizung: die Anlage behält die übrigen, nur das eine Mietverhältnis wird umgestellt', async () => {
  plants = [GAS]
  stubChange(null)
  await changeToOwnHeating()
  fireEvent.click(screen.getByLabelText('EG'))
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getByText('Wohnung aus der Heizanlage nehmen?')).toBeTruthy()
  expect(within(dialog).getByText(/OG hängt danach nicht mehr an der Heizanlage; für die übrigen Wohnungen bleibt sie bestehen\. Die laufenden Mietverhältnisse von Mieter B werden .* „Weitere Optionen: nur bestimmte Wohnungen beteiligen“/)).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Umstellen' }))
  await waitFor(() => expect(sent).toHaveLength(2))
  expect(sent.map((s) => [s.method, s.url, s.body])).toEqual([
    ['PUT', '/api/heating-plants/hp1', { units: [{ unitId: 'eg', heatedAreaM2: null }] }],
    ['PUT', '/api/tenancies/tb', { heatingModel: 'selfSupply', selfSupplyKind: 'perUnit' }],
  ])
})

// #721: Der erklärende Text zur Etagenheizung mit Vertrag beim Mieter stand nur in der flüchtigen Mitteilung; danach
// zeigte die Karte wieder „Optional …“ und „Heizung einrichten“.
const selfTenant = (id: string, unitId: string, over: Record<string, unknown> = {}) => ({ ...tenant(id, unitId, `Mieter ${id}`), heatingModel: 'selfSupply' as const, selfSupplyKind: 'perUnit' as const, ...over })

test('#721: alle laufenden Mietverhältnisse heizen selbst, keine Anlage: die Karte zeigt den Zustand dauerhaft, mit Lexikonbegriff und „Ändern“', async () => {
  render(<PropertyProvider><UIProvider><HeatingCard units={UNITS} tenancies={[selfTenant('ta', 'eg'), selfTenant('tb', 'og')]} /></UIProvider></PropertyProvider>)
  const note = await screen.findByText(/Die Mieter heizen selbst: Jede Wohnung hat eine eigene Heizung, und der Mieter hat den Vertrag\. Eine Heizkostenabrechnung des Hauses gibt es deshalb nicht/)
  const card = note.closest('.card') ?? document.body
  expect(card.textContent).toMatch(/Ist die Wartung der Thermen im Mietvertrag als umlegbar vereinbart, erfassen Sie sie auf der Seite Kosten unter „Heizung und Warmwasser“ mit Direktzuordnung je Wohnung/)
  // Der Lexikonbegriff zur CO₂-Erstattung und der lange Text mit Fristen, aufklappbar.
  expect(within(card as HTMLElement).getByRole('button', { name: /CO₂-Erstattung/ })).toBeTruthy()
  expect(card.querySelector('details')?.textContent).toMatch(/Fristen und Hinweispflicht.*binnen \d+ Monaten nach der Abrechnung seines Lieferanten in Textform/)
  // Kein Leerzustand daneben.
  expect(screen.queryByText(/Bekommen Sie eine Heizkostenabrechnung von einem Messdienst/)).toBeNull()
  expect(screen.queryByRole('button', { name: 'Heizung einrichten' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Ändern' }))
  expect(await screen.findByRole('dialog', { name: 'Heizung einrichten' })).toBeTruthy()
})

test('#721: heizt ein laufendes Mietverhältnis nicht selbst oder gibt es eine Anlage, bleibt die Karte, wie sie war', async () => {
  const { unmount } = render(<PropertyProvider><UIProvider><HeatingCard units={UNITS} tenancies={[selfTenant('ta', 'eg'), tenant('tb', 'og', 'Mieter B')]} /></UIProvider></PropertyProvider>)
  expect(await screen.findByRole('button', { name: 'Heizung einrichten' })).toBeTruthy()
  expect(screen.getByText(/Bekommen Sie eine Heizkostenabrechnung von einem Messdienst/)).toBeTruthy()
  expect(screen.queryByText(/Die Mieter heizen selbst/)).toBeNull()
  unmount()
  plants = [GAS]
  render(<PropertyProvider><UIProvider><HeatingCard units={UNITS} tenancies={[selfTenant('ta', 'eg'), selfTenant('tb', 'og')]} /></UIProvider></PropertyProvider>)
  // „Entfernen …“ gibt es nur an einer Anlage; „Ändern“ trägt auch der Zustand, solange die Anlagen noch laden.
  expect(await screen.findByRole('button', { name: 'Entfernen …' })).toBeTruthy()
  expect(screen.queryByText(/Die Mieter heizen selbst/)).toBeNull()
})

test('#721: Einrichten mit Vertrag beim Mieter: die Mitteilung ist kurz', async () => {
  stubChange(null)
  render(<PropertyProvider><UIProvider><HeatingCard units={UNITS} /></UIProvider></PropertyProvider>)
  fireEvent.click(await screen.findByRole('button', { name: 'Heizung einrichten' }))
  fireEvent.change(await screen.findByLabelText(/Womit wird geheizt/), { target: { value: 'perUnit' } })
  fireEvent.change(screen.getByLabelText(/Wer hat den Vertrag für die Heizung in der Wohnung/), { target: { value: 'tenant' } })
  fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }))
  await screen.findByRole('alertdialog')
  const saved = screen.getAllByText('Gespeichert. Hat jeder Mieter einen eigenen Vertrag für seine Heizung, legt Mietfuchs keine Heizanlage an.')
  expect(saved.length).toBeGreaterThan(0)
  expect(document.body.textContent).not.toMatch(/binnen \d+ Monaten nach der Abrechnung seines Lieferanten/)
})

// Durchsicht von #720 und #721: Rückfrage mit den Heizpositionen, Kesseltausch-Linie, Teilausfall, künftige
// Mietverhältnisse, Zustand „Mieter heizen selbst“ mit leerer Wohnung und der Weg zurück zur Anlage des Vermieters.
type Flow = { items?: { id: string; period: string; description: string; amountCents: number }[]; tenancies?: (Omit<ReturnType<typeof tenant>, 'end'> & { end: string | null })[]; failPut?: string }
function stubFlow(flow: Flow) {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const path = url.split('?')[0] ?? ''
    if (method !== 'GET') {
      sent.push({ method, url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> })
      if (method === 'DELETE') plants = plants.filter((p) => !url.endsWith(`/${p.id}`))
      if (flow.failPut && method === 'PUT' && path === flow.failPut) return json({ error: 'Das Mietverhältnis wurde inzwischen geändert.' }, 409)
      if (method === 'POST') return json({ plant: PLANT, assigned: 0 }, 201)
      return json({ ok: true })
    }
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'Haus', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }])
    if (path === '/api/heating-plants') return json(plants)
    if (/^\/api\/heating-plants\/[^/]+\/removal$/.test(path)) return json({ blocked: null, items: flow.items ?? [] })
    if (path === '/api/tenancies') return json(flow.tenancies ?? [tenant('ta', 'eg', 'Mieter A'), tenant('tb', 'og', 'Mieter B')])
    return json([])
  })
}

test('Durchsicht #720 M1 b: die Rückfrage nennt die offenen Heizpositionen und dass sie danach auch auf Mieter gehen, die selbst heizen', async () => {
  plants = [GAS]
  stubFlow({ items: [{ id: 'g25', period: '2025-01', description: 'Gas 2025', amountCents: 120000 }, { id: 'w25', period: '2025-01', description: 'Wartung', amountCents: 20000 }] })
  await changeToOwnHeating()
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getByText('Diese Heizpositionen der Anlage in noch offenen Abrechnungen werden danach ohne Heizanlage nach ihrem Schlüssel verteilt, also auch auf Mieter, die selbst heizen:')).toBeTruthy()
  expect(within(dialog).getAllByRole('listitem').map((li) => li.textContent?.replace(/\s/g, ' '))).toEqual(['„Gas 2025“ 1.200,00 €', '„Wartung“ 200,00 €'])
  expect(within(dialog).getByText('Brennstoffrechnungen, die Sie für diese Wohnungen nicht haben, löschen Sie danach auf der Seite Kosten.')).toBeTruthy()
})

test('Durchsicht #720 S1: die aktuelle Anlage einer Linie: Rückfrage und Mitteilung sagen, dass die ersetzte wieder heizt', async () => {
  const alt: HeatingPlant = { ...PLANT, id: 'hp0', energy: 'oil', name: 'Ölkessel', endsOn: '2025-06-30' }
  plants = [alt, { ...GAS, name: 'Gastherme', replacesPlantId: 'hp0' }]
  stubFlow({})
  render(<PropertyProvider><UIProvider><HeatingCard units={UNITS} /></UIProvider></PropertyProvider>)
  await screen.findAllByText(/Gastherme/)
  const buttons = await screen.findAllByRole('button', { name: 'Ändern' })
  fireEvent.click(buttons[buttons.length - 1] ?? document.body)
  fireEvent.change(screen.getByLabelText(/Womit wird geheizt/), { target: { value: 'perUnit' } })
  fireEvent.change(screen.getByLabelText(/Wer hat den Vertrag für die Heizung in der Wohnung/), { target: { value: 'tenant' } })
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  const dialog = await screen.findByRole('alertdialog')
  const satz = /„Ölkessel“ heizt danach wieder ab dem 01\.07\.2025, denn das Entfernen macht den Kesseltausch rückgängig\. Hat jeder Mieter auch dort seine eigene Heizung mit eigenem Vertrag, entfernen Sie danach auch „Ölkessel“ mit „Entfernen …“/
  expect(dialog.textContent).toMatch(satz)
  expect(dialog.textContent?.split('heizt danach wieder')).toHaveLength(2)
  fireEvent.click(within(dialog).getByRole('button', { name: 'Entfernen' }))
  await waitFor(() => expect(sent.map((s) => s.method)).toEqual(['DELETE', 'PUT', 'PUT']))
  expect(sent[0]?.url).toBe('/api/heating-plants/hp1')
  await waitFor(() => expect(screen.getAllByText(/^Heizanlage entfernt\./).some((n) => satz.test(n.textContent ?? ''))).toBe(true))
})

test('Durchsicht #720 S2: scheitert danach ein Mietverhältnis, sagt die Karte, dass die Anlage entfernt ist und was von Hand bleibt', async () => {
  plants = [GAS]
  stubFlow({ failPut: '/api/tenancies/tb' })
  await changeToOwnHeating()
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Entfernen' }))
  expect(await screen.findByText('Die Heizanlage ist entfernt; das Mietverhältnis von Mieter B ließ sich nicht umstellen: Das Mietverhältnis wurde inzwischen geändert. Stellen Sie es unter Stammdaten am Mietverhältnis bei „Heizung und Warmwasser“ auf „Mieter heizt selbst (eigener Vertrag für Brennstoff oder Wärme)“.')).toBeTruthy()
  expect(sent.map((s) => [s.method, s.url])).toEqual([['DELETE', '/api/heating-plants/hp1'], ['PUT', '/api/tenancies/ta'], ['PUT', '/api/tenancies/tb']])
})

test('Durchsicht #720 S3: künftige Mietverhältnisse der Wohnungen werden mit umgestellt, beendete nicht', async () => {
  plants = [GAS]
  stubFlow({ tenancies: [{ ...tenant('alt', 'eg', 'Mieter Alt'), end: '2021-12-31' }, tenant('ta', 'eg', 'Mieter A'), { ...tenant('neu', 'og', 'Mieter Neu'), start: '2099-01-01' }] })
  await changeToOwnHeating()
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog.textContent).toMatch(/Die laufenden und künftigen Mietverhältnisse von Mieter A, Mieter Neu werden unter Heizung auf „Mieter heizt selbst“ gestellt/)
  fireEvent.click(within(dialog).getByRole('button', { name: 'Entfernen' }))
  await waitFor(() => expect(sent).toHaveLength(3))
  expect(sent.slice(1).map((s) => s.url)).toEqual(['/api/tenancies/ta', '/api/tenancies/neu'])
})

test('Durchsicht #721 S8: Zustand mit leerer Wohnung nennt nur die vermieteten; „Ändern“ zur Anlage des Vermieters bietet die Abrechnung wieder an', async () => {
  const selbst = [selfTenant('ta', 'eg')]
  stubFlow({ tenancies: selbst })
  render(<PropertyProvider><UIProvider><HeatingCard units={UNITS} tenancies={selbst} /></UIProvider></PropertyProvider>)
  const note = await screen.findByText(/^In den vermieteten Wohnungen heizen die Mieter selbst: Jede Wohnung hat eine eigene Heizung/)
  expect(note.textContent).toMatch(/Ist die Wartung der Thermen im Mietvertrag als umlegbar vereinbart, erfassen Sie sie auf der Seite Kosten unter „Heizung und Warmwasser“ mit Direktzuordnung je Wohnung\./)
  fireEvent.click(screen.getByRole('button', { name: 'Ändern' }))
  fireEvent.change(await screen.findByLabelText(/Womit wird geheizt/), { target: { value: 'gas' } })
  fireEvent.change(screen.getByLabelText(/Wer erstellt Ihre Heizkostenabrechnung/), { target: { value: 'service' } })
  fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getByText('Auf „Vorauszahlung mit Abrechnung“ stellen?')).toBeTruthy()
  expect(dialog.textContent).toMatch(/Die Mietverhältnisse von Mieter ta stehen unter „Heizung und Warmwasser“ noch auf „Mieter heizt selbst \(eigener Vertrag für Brennstoff oder Wärme\)“\. Bezieht die neue Heizanlage Brennstoff oder Wärme über Ihren Vertrag/)
  fireEvent.click(within(dialog).getByRole('button', { name: 'Umstellen' }))
  await waitFor(() => expect(sent.map((s) => s.method)).toEqual(['POST', 'PUT']))
  expect(sent[1]).toEqual({ method: 'PUT', url: '/api/tenancies/ta', body: { heatingModel: null, selfSupplyKind: null } })
})

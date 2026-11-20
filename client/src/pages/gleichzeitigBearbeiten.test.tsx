// @vitest-environment jsdom
// Zwei Fenster bearbeiten denselben Datensatz (staleRecord.ts): Wohnung, Zähler und Objekt schicken beim Speichern den
// Stand mit, den ihr Formular zeigt, und zeigen die Ablehnung des Servers im Fuß des Seitenfensters. Der Server ist hier
// nachgebaut wie der echte: Er vergleicht `ifUnchanged` mit seinem Stand und lehnt bei Abweichung mit 409 ab.
//
// Zwei Dinge hält die Datei fest, die eine Durchsicht fand: Nach einer Ablehnung führt „schließen und erneut öffnen“
// wirklich zum Ziel (die Liste lädt neu), und ein Formular, dessen Liste älter ist als der Bestand (ein anderer Weg im
// selben Tab hat gespeichert, ohne die Liste nachzuladen), holt den Datensatz beim Öffnen frisch und wird nie abgelehnt.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useCallback, useState, type ReactNode } from 'react'
import type { Meter, Unit } from '../types'
import { api } from '../api'
import { PeriodProvider } from '../period'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Zaehler from './Zaehler'
import Stammdaten from './Stammdaten'

const UNIT: Unit = { id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true }
const METER: Meter = { id: 'm1', propertyId: 'objekt-1', name: 'Wasser EG', unitId: 'u1', type: 'kaltwasser', unit: 'm³' }
const PROPERTY = { id: 'objekt-1', name: 'Haus A', kind: 'mfh', address: 'Weg 1', landlordName: null, iban: null, paymentDeadlineDays: null }
const STALE = 'wurde inzwischen an anderer Stelle geändert, etwa in einem zweiten Fenster oder auf einem anderen Gerät. Gespeichert wurde nichts.'

type Row = Record<string, unknown>
// Der Bestand des nachgebauten Servers je Liste.
let stock: Record<string, Row[]>
let puts: { url: string; body: Row; status: number }[]
const mark = (x: unknown): string => JSON.stringify(Object.entries(Object(x) as Row).filter(([key, v]) => v != null && key !== 'ifUnchanged').sort())

beforeEach(() => {
  stock = { '/api/units': [{ ...UNIT }], '/api/meters': [{ ...METER }], '/api/properties': [{ ...PROPERTY }] }
  puts = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const answer = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    const path = url.split('?')[0] ?? url
    if (method === 'GET') return answer(stock[path] ?? [], 200)
    const list = path.slice(0, path.lastIndexOf('/'))
    const id = path.slice(path.lastIndexOf('/') + 1)
    const body = JSON.parse(String(init?.body ?? '{}')) as Row
    const rows = stock[list] ?? []
    const now = rows.find((r) => r.id === id)
    if (!now) return answer({ error: 'Nicht da' }, 404)
    if (body.ifUnchanged !== undefined && mark(body.ifUnchanged) !== mark(now)) {
      puts.push({ url: path, body, status: 409 })
      return answer({ error: `Der Datensatz ${STALE}`, stale: true, current: now }, 409)
    }
    const { ifUnchanged: _seen, ...changes } = body
    const next = { ...now, ...changes }
    stock[list] = rows.map((r) => (r.id === id ? next : r))
    puts.push({ url: path, body, status: 200 })
    return answer(next, 200)
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// Ein anderes Fenster (oder ein anderer Weg im selben Tab) ändert den Bestand, ohne dass diese Seite es erfährt.
const elsewhere = (list: string, changes: Row) => { stock[list] = (stock[list] ?? []).map((r) => ({ ...r, ...changes })) }

const shell = (page: ReactNode) => render(<PeriodProvider><PropertyProvider><UIProvider>{page}</UIProvider></PropertyProvider></PeriodProvider>)
// Die Stammdaten bekommen Wohnungen und `reload` von der App; hier eine kleine App, die genauso nur auf Zuruf neu lädt.
function StammdatenInApp() {
  const [units, setUnits] = useState<Unit[]>([{ ...UNIT }])
  const reload = useCallback(async () => setUnits(await api<Unit[]>('/api/units')), [])
  return <Stammdaten units={units} tenancies={[]} settings={null} reload={reload} />
}
const dialog = () => screen.getByRole('dialog')
const save = () => fireEvent.click(within(dialog()).getByRole('button', { name: /^Speichern$/i }))
const refused = async (count: number, changed: string) => {
  await waitFor(() => expect(puts).toHaveLength(count))
  expect(puts.at(-1)?.status).toBe(409)
  const alert = await within(dialog()).findByRole('alert')
  expect(alert.textContent).toContain(STALE)
  expect(alert.textContent).toContain(`Inzwischen geändert: ${changed}.`)
  expect(alert.textContent).toContain('Ihre Eingabe bleibt stehen')
}
const close = async () => {
  fireEvent.click(within(dialog()).getByRole('button', { name: /^Abbrechen$/ }))
  const ask = await screen.findByRole('alertdialog', { name: 'Änderungen verwerfen?' })
  fireEvent.click(within(ask).getByRole('button', { name: 'Verwerfen' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
}
const field = (label: RegExp) => within(dialog()).getByLabelText(label) as HTMLInputElement

test('Wohnung: Ablehnung nennt, was sich geändert hat; schließen, öffnen, speichern geht durch', async () => {
  shell(<StammdatenInApp />)
  fireEvent.click(await screen.findByRole('button', { name: /Wohnung bearbeiten/i }))
  fireEvent.change(await screen.findByLabelText(/^Name/i), { target: { value: 'Erdgeschoss' } })
  // Während das Formular offen ist, speichert ein anderes Fenster eine neue Wohnfläche.
  elsewhere('/api/units', { areaM2: 85 })
  save()
  await refused(1, 'Wohnfläche')
  expect(puts[0]?.body.ifUnchanged).toEqual(UNIT)
  expect(field(/^Name/i).value).toBe('Erdgeschoss')
  await close()
  // Wie die Meldung sagt: erneut öffnen. Das Formular zeigt den Stand von jetzt, und das Speichern geht durch.
  fireEvent.click(await screen.findByRole('button', { name: /Wohnung bearbeiten/i }))
  await waitFor(() => expect(field(/^Wohnfläche/i).value).toBe('85'))
  fireEvent.change(field(/^Name/i), { target: { value: 'Erdgeschoss' } })
  save()
  await waitFor(() => expect(puts).toHaveLength(2))
  expect(puts[1]?.status).toBe(200)
  expect(stock['/api/units']?.[0]).toMatchObject({ name: 'Erdgeschoss', areaM2: 85 })
})

test('Wohnung: Ein anderer Weg im selben Tab hat gespeichert, die Liste ist alt; das Formular holt den Stand beim Öffnen', async () => {
  shell(<StammdatenInApp />)
  await screen.findByRole('button', { name: /Wohnung bearbeiten/i })
  // Etwa „Ortsübliche Miete“ auf der Seite Steuer: schreibt an der Wohnung, die Liste der App lädt nicht neu.
  elsewhere('/api/units', { areaM2: 85, localRents: [{ from: '2025-01', monthlyCents: 90000 }] })
  fireEvent.click(screen.getByRole('button', { name: /Wohnung bearbeiten/i }))
  await waitFor(() => expect(field(/^Wohnfläche/i).value).toBe('85'))
  fireEvent.change(field(/^Name/i), { target: { value: 'Erdgeschoss' } })
  save()
  await waitFor(() => expect(puts).toHaveLength(1))
  expect(puts[0]?.status).toBe(200)
  expect(stock['/api/units']?.[0]).toMatchObject({ name: 'Erdgeschoss', areaM2: 85, localRents: [{ from: '2025-01', monthlyCents: 90000 }] })
})

test('Zähler: Ablehnung nennt, was sich geändert hat; schließen, öffnen, speichern geht durch', async () => {
  shell(<Zaehler units={[UNIT]} />)
  fireEvent.click(await screen.findByRole('button', { name: /Zähler bearbeiten/i }))
  fireEvent.change(await screen.findByLabelText(/^Name/i), { target: { value: 'Kaltwasser EG' } })
  elsewhere('/api/meters', { meterNumber: 'A-1' })
  save()
  await refused(1, 'Zählernummer')
  expect(puts[0]?.body.ifUnchanged).toEqual(METER)
  await close()
  fireEvent.click(await screen.findByRole('button', { name: /Zähler bearbeiten/i }))
  await waitFor(() => expect(field(/^Zählernummer/i).value).toBe('A-1'))
  fireEvent.change(field(/^Name/i), { target: { value: 'Kaltwasser EG' } })
  save()
  await waitFor(() => expect(puts).toHaveLength(2))
  expect(puts[1]?.status).toBe(200)
  expect(stock['/api/meters']?.[0]).toMatchObject({ name: 'Kaltwasser EG', meterNumber: 'A-1' })
})

test('Zähler: Die Liste ist alt (Zählerwechsel mit Eichjahr von anderer Stelle); das Formular holt den Stand beim Öffnen', async () => {
  shell(<Zaehler units={[UNIT]} />)
  await screen.findByRole('button', { name: /Zähler bearbeiten/i })
  elsewhere('/api/meters', { meterNumber: 'B-2' })
  fireEvent.click(screen.getByRole('button', { name: /Zähler bearbeiten/i }))
  await waitFor(() => expect(field(/^Zählernummer/i).value).toBe('B-2'))
  fireEvent.change(field(/^Name/i), { target: { value: 'Kaltwasser EG' } })
  save()
  await waitFor(() => expect(puts).toHaveLength(1))
  expect(puts[0]?.status).toBe(200)
})

const openProperty = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Bearbeiten (Objekt)' }))
  return screen.findByRole('dialog', { name: 'Objekt bearbeiten' })
}

test('Objekt: Ablehnung nennt, was sich geändert hat; schließen, öffnen, speichern geht durch', async () => {
  shell(<StammdatenInApp />)
  await openProperty()
  fireEvent.change(field(/^Bezeichnung/i), { target: { value: 'Haus am See' } })
  elsewhere('/api/properties', { address: 'Hauptstraße 1' })
  save()
  await refused(1, 'Adresse')
  expect(puts[0]?.body.ifUnchanged).toEqual(PROPERTY)
  await close()
  await openProperty()
  await waitFor(() => expect(field(/^Adresse/i).value).toBe('Hauptstraße 1'))
  fireEvent.change(field(/^Bezeichnung/i), { target: { value: 'Haus am See' } })
  save()
  await waitFor(() => expect(puts).toHaveLength(2))
  expect(puts[1]?.status).toBe(200)
  expect(stock['/api/properties']?.[0]).toMatchObject({ name: 'Haus am See', address: 'Hauptstraße 1' })
})

test('Objekt: Ein anderer Weg im selben Tab hat gespeichert (Anschreiben „mitdrucken“); das Formular holt den Stand beim Öffnen', async () => {
  shell(<StammdatenInApp />)
  await screen.findByRole('button', { name: 'Bearbeiten (Objekt)' })
  elsewhere('/api/properties', { printLetter: false, address: 'Hauptstraße 1' })
  await openProperty()
  await waitFor(() => expect(field(/^Adresse/i).value).toBe('Hauptstraße 1'))
  fireEvent.change(field(/^Bezeichnung/i), { target: { value: 'Haus am See' } })
  save()
  await waitFor(() => expect(puts).toHaveLength(1))
  expect(puts[0]?.status).toBe(200)
  expect(stock['/api/properties']?.[0]).toMatchObject({ name: 'Haus am See', printLetter: false })
})

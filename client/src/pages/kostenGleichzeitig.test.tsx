// @vitest-environment jsdom
// Zwei Fenster bearbeiten dieselbe Kostenposition: Das Formular schickt den Stand mit, den es beim Öffnen geladen hat,
// und die Ablehnung des Servers steht im Fuß des Seitenfensters; die Eingabe bleibt stehen.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Unit } from '../types'
import { PeriodProvider } from '../period'
import { calendarPeriod } from '../../../shared/period.ts'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import { fmtEuro } from '../api'
import Kosten from './Kosten'

const UNITS: Unit[] = [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true }]
const year = new Date().getFullYear() - 1
const item = () => ({ id: 'c1', propertyId: 'objekt-1', period: calendarPeriod(year), year, category: 'Gebäudeversicherung', description: 'Versicherung', amountCents: 138000, key: 'area' })

let sent: { url: string; method: string; body: Record<string, unknown> }[]
let costItems: unknown[]
let reply: (body: Record<string, unknown>) => { status: number; body: unknown }
let plants: unknown[]
// Hält den Abruf der Positionen an, bis der Test ihn freigibt (ein langsames Netz zwischen Öffnen und frischem Stand).
let hold: Promise<void> | null
let costGets: number
const answer = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  sent = []
  costItems = [item()]
  plants = []
  hold = null
  costGets = 0
  reply = () => ({ status: 200, body: { ok: true } })
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method !== 'GET') {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      sent.push({ url, method, body })
      const r = reply(body)
      return answer(r.body, r.status)
    }
    const path = url.split('?')[0]
    if (path === '/api/costItems') {
      if (hold) await hold
      costGets++
      return answer(costItems, 200)
    }
    return answer(path === '/api/heating-plants' ? plants : path === '/api/properties' ? [{ id: 'objekt-1', name: 'Haus', kind: 'mfh', address: '' }] : [], 200)
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const page = () => render(<PeriodProvider><PropertyProvider><UIProvider><Kosten units={UNITS} settings={null} /></UIProvider></PropertyProvider></PeriodProvider>)
const openEdit = async () => {
  page()
  fireEvent.click(await screen.findByRole('button', { name: 'Kostenposition bearbeiten' }))
  return waitFor(() => screen.getByLabelText(/Beschreibung/i) as HTMLInputElement)
}

test('Speichern schickt den Stand mit, den das Formular beim Öffnen geladen hat', async () => {
  const description = await openEdit()
  fireEvent.change(description, { target: { value: 'Wohngebäudeversicherung' } })
  fireEvent.click(screen.getByRole('button', { name: /^Speichern$/ }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]?.method).toBe('PUT')
  expect(sent[0]?.body).toMatchObject({ description: 'Wohngebäudeversicherung', amountCents: 138000 })
  expect(sent[0]?.body.ifUnchanged).toEqual(item())
})

test('Anlegen schickt keinen gesehenen Stand', async () => {
  costItems = []
  page()
  fireEvent.click(await screen.findByRole('button', { name: /Kostenposition anlegen/i }))
  fireEvent.change(screen.getByLabelText(/Beschreibung/i), { target: { value: 'Wasser' } })
  fireEvent.change(screen.getByLabelText(/Betrag/i), { target: { value: '100,00' } })
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/ }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]?.method).toBe('POST')
  expect('ifUnchanged' in (sent[0]?.body ?? {})).toBe(false)
})

test('Inzwischen an anderer Stelle geändert: Meldung im Fuß des Fensters mit dem, was sich geändert hat; die Eingabe bleibt', async () => {
  const server = 'Die Kostenposition „Versicherung“ wurde inzwischen an anderer Stelle geändert, etwa in einem zweiten Fenster oder auf einem anderen Gerät. Gespeichert wurde nichts.'
  const { year: _year, ...stored } = item()
  reply = () => ({ status: 409, body: { error: server, stale: true, current: { ...stored, amountCents: 150000 } } })
  const description = await openEdit()
  fireEvent.change(description, { target: { value: 'Wohngebäudeversicherung' } })
  fireEvent.click(screen.getByRole('button', { name: /^Speichern$/ }))
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain(server)
  expect(alert.textContent).toContain(`Inzwischen geändert: Betrag (jetzt ${fmtEuro(150000)}).`)
  expect(alert.textContent).toContain('Ihre Eingabe bleibt stehen')
  // Die Meldung steht im Seitenfenster, das offen bleibt, und die Eingabe ist noch da.
  expect(alert.closest('dialog')).not.toBeNull()
  expect((screen.getByLabelText(/Beschreibung/i) as HTMLInputElement).value).toBe('Wohngebäudeversicherung')
  // Ein zweiter Versuch schickt weiter den Stand vom Öffnen, auch wenn die Liste inzwischen neu geladen ist.
  costItems = [{ ...item(), amountCents: 150000 }]
  fireEvent.click(screen.getByRole('button', { name: /^Speichern$/ }))
  await waitFor(() => expect(sent).toHaveLength(2))
  expect(sent[1]?.body.ifUnchanged).toEqual(item())
})

test('Inzwischen gelöscht: der Satz des Servers steht im Fuß des Fensters', async () => {
  const gone = 'Diese Kostenposition wurde inzwischen gelöscht, etwa in einem zweiten Fenster oder auf einem anderen Gerät. Gespeichert wurde nichts.'
  reply = () => ({ status: 404, body: { error: gone } })
  await openEdit()
  fireEvent.click(screen.getByRole('button', { name: /^Speichern$/ }))
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain(gone)
  expect(alert.closest('dialog')).not.toBeNull()
})

// Die Liste der Seite ist älter als der Bestand (ein anderer Weg hat gespeichert, ohne sie nachzuladen): Das Formular
// holt die Position beim Öffnen frisch, zeigt den Stand von jetzt und schickt ihn als gesehen mit.
test('Alte Liste: das Formular zeigt beim Öffnen den Stand von jetzt und wird nicht abgelehnt', async () => {
  page()
  const edit = await screen.findByRole('button', { name: 'Kostenposition bearbeiten' })
  costItems = [{ ...item(), amountCents: 150000, vendor: 'Versicherung AG' }]
  fireEvent.click(edit)
  await waitFor(() => expect((screen.getByLabelText(/Betrag/i) as HTMLInputElement).value).toBe('1.500,00'))
  fireEvent.change(screen.getByLabelText(/Beschreibung/i), { target: { value: 'Wohngebäudeversicherung' } })
  fireEvent.click(screen.getByRole('button', { name: /^Speichern$/ }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]?.body).toMatchObject({ description: 'Wohngebäudeversicherung', amountCents: 150000 })
  expect(sent[0]?.body.ifUnchanged).toEqual({ ...item(), amountCents: 150000, vendor: 'Versicherung AG' })
})

// ---------- Der frische Stand ersetzt nur ein Formular, an dem noch niemand etwas getan hat ----------

const amount = () => (screen.getByLabelText(/Betrag/i) as HTMLInputElement).value
// Öffnet das Formular mit alter Liste und angehaltenem Abruf; `release` lässt den frischen Stand ankommen.
const openWithSlowFresh = async (fresh: unknown[]) => {
  page()
  const edit = await screen.findByRole('button', { name: 'Kostenposition bearbeiten' })
  costItems = fresh
  let release = () => {}
  hold = new Promise<void>((resolve) => { release = resolve })
  const before = costGets
  fireEvent.click(edit)
  await waitFor(() => screen.getByLabelText(/Beschreibung/i))
  return async () => {
    release()
    hold = null
    await waitFor(() => expect(costGets).toBeGreaterThan(before))
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  }
}

test('Nur ins Feld geklickt, dann kommt der frische Stand: nichts wird ersetzt, und „Abbrechen“ fragt nicht', async () => {
  const arrive = await openWithSlowFresh([{ ...item(), amountCents: 150000 }])
  // Ein Klick ins Feld setzt die Einfügemarke: Ab jetzt wird kein Wert mehr unter ihr ausgetauscht.
  fireEvent.click(screen.getByLabelText(/Betrag/i))
  await arrive()
  expect(amount()).toBe('1.380,00')
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Abbrechen$/ }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.queryByRole('alertdialog')).toBeNull()
})

test('Vor jeder Handlung ersetzt der frische Stand das Formular, und „Abbrechen“ fragt danach nicht', async () => {
  const arrive = await openWithSlowFresh([{ ...item(), amountCents: 150000 }])
  await arrive()
  await waitFor(() => expect(amount()).toBe('1.500,00'))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Abbrechen$/ }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.queryByRole('alertdialog')).toBeNull()
})

const PLANT = {
  id: 'hp1', propertyId: 'objekt-1', name: '', energy: 'gas', supply: 'central', method: 'service', separateSettlement: null,
  devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', source: 'building', captureInstalledOn: null, capturedOnOct2024: null,
  warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: null, periodChanges: [], separateSpans: [], units: null, newDevicesInstall: null,
  nonResidential: false, restriction: 'none', districtEtsNew: false, endsOn: null, replacesPlantId: null, buildingWith: null, takesOverStock: null,
  hotWater: 'combined', capture: 'heatMeter', areaBasisHeat: 'area', heatPumpInstalledOn: null,
}
const heatingItem = () => ({ ...item(), category: 'Heizung und Warmwasser', description: 'Gas', heatingPlantId: 'hp1' })

// Bei eigener Heizkostenabrechnung stellt das Formular den Schlüssel selbst um. Das ist keine Eingabe: Der frische Stand
// ersetzt es trotzdem, sonst würde im selben Tab zu Unrecht abgelehnt.
test('Ein vom Formular selbst abgeleiteter Wert zählt nicht als Eingabe: der frische Stand kommt an', async () => {
  plants = [{ ...PLANT, method: 'self' }]
  costItems = [heatingItem()]
  const arrive = await openWithSlowFresh([{ ...heatingItem(), amountCents: 150000 }])
  await waitFor(() => expect((screen.getByLabelText(/Umlageschlüssel/i) as HTMLSelectElement).value).toBe('heatingSystem'))
  await arrive()
  await waitFor(() => expect(amount()).toBe('1.500,00'))
})

// Heizperiode und Anlage liegen neben dem Formularobjekt. Wer in der Wartezeit die Anlage umstellt, behält seine Wahl
// (beide setzt der frische Stand über denselben Weg; die Auswahl der Heizperiode hat hier nur einen Eintrag).
test('In der Wartezeit die Heizanlage umgestellt: der frische Stand überschreibt sie nicht', async () => {
  plants = [{ ...PLANT, id: 'hp1', name: 'Ölkessel' }, { ...PLANT, id: 'hp2', name: 'Gastherme' }]
  costItems = [heatingItem()]
  const arrive = await openWithSlowFresh([{ ...heatingItem(), amountCents: 150000 }])
  const select = await waitFor(() => screen.getByLabelText(/^Heizanlage(?!n)/) as HTMLSelectElement)
  expect(select.value).toBe('hp1')
  fireEvent.change(select, { target: { value: 'hp2' } })
  await arrive()
  expect((screen.getByLabelText(/^Heizanlage(?!n)/) as HTMLSelectElement).value).toBe('hp2')
  expect(amount()).toBe('1.380,00')
})

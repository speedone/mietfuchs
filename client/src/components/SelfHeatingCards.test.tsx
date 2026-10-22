// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import SelfHeatingCards from './SelfHeatingCards'
import { OpenFormScope, hasOpenForm } from '../testing/openForm'
import type { HeatingDistribution, HeatingPeriodView, HeatingPlant, SelfHeatingStatement } from '../types'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const unit = (id: string, name: string, value: number) => ({
  unitId: id, unitName: name, areaM2: 60, heatAreaM2: 60, users: [],
  readings: [{ boundary: '2025-12-31', meterId: `w${id}`, meterName: `Wärme ${name}`, pot: 'heating' as const, date: '2025-12-31', value }],
  boundaries: [] as SelfHeatingStatement['units'][number]['boundaries'],
})
const statement = (units: SelfHeatingStatement['units']) => ({
  ok: true, heatPump: null, changeSplit: 'degreeDays', areaBasisHeat: 'area', hotWater: 'none', alpha: null, shares: { heating: 70, water: 70, forced: false, previous: null }, pots: [], units,
} as SelfHeatingStatement)

const SHARE_SAVE = 'Speichern (Anteil nach Verbrauch)'

test('fehlende Zwischenablesung: „nicht möglich“ erst mit Grund; beide Folgen stehen vor der Wahl (Durchsicht von #239, I3)', async () => {
  const sent: { url: string; method?: string; body: unknown }[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    sent.push({ url: String(url), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : null })
    return new Response(JSON.stringify({ unitId: 'c', date: '2025-09-30', status: 'impossible', reason: 'Wohnung nicht zugänglich' }), { status: 200 })
  })
  const c = { ...unit('c', 'C', 0), readings: [], boundaries: [{ date: '2025-09-30', kind: 'change' as const, status: 'missing' as const, offDays: 0, far: false, gap: null }] }
  const onChanged = vi.fn()
  render(<SelfHeatingCards plant={{ id: 'hp', method: 'self', energy: 'districtHeating', hotWater: 'none' } as HeatingPlant} view={{ period: '2025-01', label: '2025', distribution: null } as HeatingPeriodView} self={statement([c])} onChanged={onChanged} />)
  expect(screen.getByText(/C, Mieterwechsel zum 30\.09\.2025: keine Ablesung/)).toBeTruthy()
  expect(screen.getByText(/Nicht durchgeführt: .* um bis zu 15 % kürzen/)).toBeTruthy()
  expect(screen.getByText(/Nicht möglich: .* Nennen Sie den Grund/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Nicht möglich' }))
  expect(sent).toEqual([])
  // Ein Entwurf am Feld (#346 Schritt 7): „Speichern“ erst mit einem Grund.
  expect(screen.queryByRole('button', { name: 'Speichern (Grund)' })).toBeNull()
  fireEvent.change(screen.getByLabelText(/Warum war die Zwischenablesung nicht möglich/), { target: { value: 'Wohnung nicht zugänglich' } })
  fireEvent.click(screen.getByRole('button', { name: 'Speichern (Grund)' }))
  await waitFor(() => expect(onChanged).toHaveBeenCalled())
  expect(sent).toEqual([{ url: '/api/units/c/interim-gaps/2025-09-30', method: 'PUT', body: { status: 'impossible', reason: 'Wohnung nicht zugänglich' } }])
})

test('Ableseergebnis: gezeigt und gedruckt wird die gewählte Wohnung, nicht alle (Durchsicht von #239, I2)', () => {
  render(<SelfHeatingCards plant={{ id: 'hp', method: 'self', energy: 'districtHeating', hotWater: 'none' } as HeatingPlant} view={{ period: '2025-01', label: '2025', distribution: null } as HeatingPeriodView} self={statement([unit('a', 'A', 1111), unit('b', 'B', 2222)])} onChanged={() => undefined} />)
  expect(screen.getByText(/Wärme A: 1\.111 kWh/)).toBeTruthy()
  expect(screen.queryByText(/Wärme B: 2\.222 kWh/)).toBeNull()
  fireEvent.change(screen.getByLabelText('Wohnung'), { target: { value: 'b' } })
  expect(screen.queryByText(/Wärme A: 1\.111 kWh/)).toBeNull()
  expect(screen.getByText(/Wärme B: 2\.222 kWh/)).toBeTruthy()
  expect(screen.getByText(/Warmwasserzähler eingebaut ist \(§ 6 Abs\. 1 Satz 4\)/)).toBeTruthy()
})

test('Pflichtanteil in begonnener Heizperiode nachtragen; „Weiß ich nicht“ unter 70 % bekommt den Rat (Durchsicht von #239, C1)', async () => {
  const sent: unknown[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    sent.push(init?.body ? JSON.parse(String(init.body)) : null)
    return new Response('{}', { status: 200 })
  })
  const d: HeatingDistribution = {
    own: { heating: 50, water: null, insulationRule: 'unknown' }, effective: { heating: 50, water: null, insulationRule: 'unknown' },
    inherited: false, begun: true, first: false, forcedPercent: null,
  }
  const onChanged = vi.fn()
  render(<SelfHeatingCards plant={{ id: 'hp', method: 'self', energy: 'oil', hotWater: 'none' } as HeatingPlant} view={{ period: '2025-01', label: '2025', distribution: d } as HeatingPeriodView} self={null} onChanged={onChanged} />)
  expect(screen.getByText(/Mit 70 % liegen Sie in jedem Fall richtig/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: SHARE_SAVE })).toBeNull()
  fireEvent.change(screen.getByLabelText(/Liegt der Wärmeschutz Ihres Hauses unter dem Anforderungsniveau/), { target: { value: 'applies' } })
  // Ein „Speichern“ am Fuß der Karte statt „Pflichtanteil eintragen“ (#346 Schritt 7); der Satz darüber sagt, was es tut.
  expect(screen.getByText('Mit „Speichern“ tragen Sie den Pflichtanteil ein.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: SHARE_SAVE }))
  await waitFor(() => expect(onChanged).toHaveBeenCalled())
  expect(sent).toEqual([{ heatConsumptionPct: 70, waterConsumptionPct: null, insulationRule: 'applies', above70Agreed: false }])
})

// #376: Gesperrter Anteil (begonnene Heizperiode) und kein Pflichtanteil: Die Antwort zum Wärmeschutz ließ sich nicht
// speichern, weil für die Wärme der leere Entwurf statt des geltenden Anteils ging; das Warmwasser hatte den Rückgriff.
test('#376: in begonnener Heizperiode ohne Pflichtanteil speichert die Antwort zum Wärmeschutz mit dem geltenden Anteil', async () => {
  const sent: unknown[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    sent.push(init?.body ? JSON.parse(String(init.body)) : null)
    return new Response('{}', { status: 200 })
  })
  const d: HeatingDistribution = {
    own: { heating: 60, water: 60, insulationRule: 'unknown' }, effective: { heating: 60, water: 60, insulationRule: 'unknown' },
    inherited: false, begun: true, first: false, forcedPercent: null,
  }
  const onChanged = vi.fn()
  render(<SelfHeatingCards plant={{ id: 'hp', method: 'self', energy: 'oil', hotWater: 'combined' } as HeatingPlant} view={{ period: '2025-01', label: '2025', distribution: d } as HeatingPeriodView} self={null} onChanged={onChanged} />)
  fireEvent.change(screen.getByLabelText(/Liegt der Wärmeschutz Ihres Hauses unter dem Anforderungsniveau/), { target: { value: 'notApplies' } })
  fireEvent.click(screen.getByRole('button', { name: SHARE_SAVE }))
  await waitFor(() => expect(onChanged).toHaveBeenCalled())
  expect(screen.queryByText(/Bitte geben Sie den Anteil zwischen/)).toBeNull()
  expect(sent).toEqual([{ heatConsumptionPct: 60, waterConsumptionPct: 60, insulationRule: 'notApplies', above70Agreed: false }])
})

// Durchsicht von #406: Ohne eigene Zeile (geerbt) gilt die Vereinbarung nach § 10 der Vorperiode weiter. Das Häkchen ist bei
// gesperrtem Anteil nicht zu sehen; ging es als `false`, lehnte der Server 80 % ab oder die Vereinbarung fiel still weg.
test('#376: geerbter Anteil über 70 % mit Vereinbarung bleibt beim Speichern der Antwort vereinbart', async () => {
  const sent: unknown[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    sent.push(init?.body ? JSON.parse(String(init.body)) : null)
    return new Response('{}', { status: 200 })
  })
  const d: HeatingDistribution = {
    own: { heating: null, water: null, insulationRule: null, above70Agreed: false },
    effective: { heating: 80, water: null, insulationRule: 'unknown', above70Agreed: true },
    inherited: true, begun: true, first: false, forcedPercent: null,
  }
  const onChanged = vi.fn()
  render(<SelfHeatingCards plant={{ id: 'hp', method: 'self', energy: 'oil', hotWater: 'none' } as HeatingPlant} view={{ period: '2025-01', label: '2025', distribution: d } as HeatingPeriodView} self={null} onChanged={onChanged} />)
  fireEvent.change(screen.getByLabelText(/Liegt der Wärmeschutz Ihres Hauses unter dem Anforderungsniveau/), { target: { value: 'notApplies' } })
  fireEvent.click(screen.getByRole('button', { name: SHARE_SAVE }))
  await waitFor(() => expect(onChanged).toHaveBeenCalled())
  expect(sent).toEqual([{ heatConsumptionPct: 80, waterConsumptionPct: null, insulationRule: 'notApplies', above70Agreed: true }])
})

// Durchsicht von #406: Fehlt in begonnener Heizperiode der Anteil fürs Warmwasser (vorher kein zentrales Warmwasser),
// verlangte die Karte ihn, zeigte das Feld aber nicht. Jetzt steht das Feld da, der Anteil der Heizung bleibt gesperrt.
test('fehlender Warmwasser-Anteil lässt sich in begonnener Heizperiode nachtragen', async () => {
  const sent: unknown[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    sent.push(init?.body ? JSON.parse(String(init.body)) : null)
    return new Response('{}', { status: 200 })
  })
  const d: HeatingDistribution = {
    own: { heating: null, water: null, insulationRule: null, above70Agreed: false },
    effective: { heating: 60, water: null, insulationRule: 'notApplies' },
    inherited: true, begun: true, first: false, forcedPercent: null,
  }
  const onChanged = vi.fn()
  render(<SelfHeatingCards plant={{ id: 'hp', method: 'self', energy: 'oil', hotWater: 'combined' } as HeatingPlant} view={{ period: '2025-01', label: '2025', distribution: d } as HeatingPeriodView} self={null} onChanged={onChanged} />)
  expect(screen.queryByLabelText(/^Heizung in %/)).toBeNull()
  fireEvent.change(screen.getByLabelText(/^Warmwasser in %/), { target: { value: '50' } })
  fireEvent.click(screen.getByRole('button', { name: SHARE_SAVE }))
  await waitFor(() => expect(onChanged).toHaveBeenCalled())
  expect(sent).toEqual([{ heatConsumptionPct: 60, waterConsumptionPct: 50, insulationRule: 'notApplies', above70Agreed: false }])
})

test('Fernwärme: keine Frage zum Wärmeschutz (Durchsicht von #239, M1)', () => {
  render(<SelfHeatingCards plant={{ id: 'hp', method: 'self', energy: 'districtHeating', hotWater: 'none' } as HeatingPlant} view={{ period: '2025-01', label: '2025', distribution: null } as HeatingPeriodView} self={null} onChanged={() => undefined} />)
  expect(screen.queryByText(/Wärmeschutzverordnung/)).toBeNull()
})

test('Durchsicht #241 Runde 2, H1: Die Verteilung 2025 fragt das Warmwasser nach der Bereitung von 2025, nicht nach der heutigen der Anlage', async () => {
  const sent: unknown[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    sent.push(init?.body ? JSON.parse(String(init.body)) : null)
    return new Response('{}', { status: 200 })
  })
  const onChanged = vi.fn()
  // Die Anlage bereitet seit 2026 kein Warmwasser mehr; 2025 bereitete sie es mit.
  render(<SelfHeatingCards plant={{ id: 'hp', method: 'self', energy: 'districtHeating', hotWater: 'none' } as HeatingPlant}
    view={{ period: '2025-01', label: '2025', distribution: null, selfHotWater: 'combined' } as HeatingPeriodView} self={null} onChanged={onChanged} />)
  fireEvent.change(screen.getByLabelText(/Heizung in %/), { target: { value: '70' } })
  fireEvent.change(screen.getByLabelText(/Warmwasser in %/), { target: { value: '60' } })
  fireEvent.click(screen.getByRole('button', { name: SHARE_SAVE }))
  await waitFor(() => expect(onChanged).toHaveBeenCalled())
  expect(sent).toEqual([{ heatConsumptionPct: 70, waterConsumptionPct: 60, insulationRule: 'notApplies', above70Agreed: false }])
  cleanup()
  // Umgekehrt: 2025 ohne Warmwasser, die Anlage heute mit; kein Feld, und gespeichert wird ohne Warmwasser.
  sent.length = 0
  render(<SelfHeatingCards plant={{ id: 'hp', method: 'self', energy: 'districtHeating', hotWater: 'combined' } as HeatingPlant}
    view={{ period: '2025-01', label: '2025', distribution: null, selfHotWater: 'none' } as HeatingPeriodView} self={null} onChanged={onChanged} />)
  expect(screen.queryByLabelText(/Warmwasser in %/)).toBeNull()
  fireEvent.change(screen.getByLabelText(/Heizung in %/), { target: { value: '70' } })
  fireEvent.click(screen.getByRole('button', { name: SHARE_SAVE }))
  await waitFor(() => expect(sent).toEqual([{ heatConsumptionPct: 70, waterConsumptionPct: null, insulationRule: 'notApplies', above70Agreed: false }]))
})

// #346, Schritt 7a: ein angefangener Anteil und eine offene Begründung zählen als offenes Formular.
test('7a: Anteil und Begründung melden die Karte an, Speichern nimmt die Marke weg', async () => {
  vi.stubGlobal('fetch', async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))
  const onChanged = vi.fn()
  const c = { ...unit('c', 'C', 1000), interimGaps: [{ date: '2025-09-30', status: null, reason: null, events: [] }] } as SelfHeatingStatement['units'][number]
  render(<OpenFormScope><SelfHeatingCards plant={{ id: 'hp', method: 'self', energy: 'districtHeating', hotWater: 'none' } as HeatingPlant} view={{ period: '2025-01', label: '2025', distribution: null } as HeatingPeriodView} self={statement([c])} onChanged={onChanged} /></OpenFormScope>)
  expect(hasOpenForm()).toBe(false)
  const anteil = screen.getByLabelText(/Heizung in %/)
  fireEvent.change(anteil, { target: { value: '60' } })
  expect(hasOpenForm()).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: SHARE_SAVE }))
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
  expect(hasOpenForm()).toBe(false)
  vi.unstubAllGlobals()
})

// Durchsicht K5: Nach „Nicht möglich“ fragte jeder Seitenwechsel nach, auch ohne Eingabe, und das Feld ließ sich nicht
// schließen. Jetzt meldet sich der Grund erst mit einer Eingabe an, „Abbrechen“ schließt das Feld, und ein Fehler steht
// nur am Feld.
test('K5: Nicht möglich ohne Eingabe ist kein offenes Formular; Abbrechen schließt; ein Fehler steht einmal', async () => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'Der Grund ist zu lang.' }), { status: 400, headers: { 'content-type': 'application/json' } }))
  const c = { ...unit('c', 'C', 0), readings: [], boundaries: [{ date: '2025-09-30', kind: 'change' as const, status: 'missing' as const, offDays: 0, far: false, gap: null }] }
  render(<OpenFormScope><SelfHeatingCards plant={{ id: 'hp', method: 'self', energy: 'districtHeating', hotWater: 'none' } as HeatingPlant} view={{ period: '2025-01', label: '2025', distribution: null } as HeatingPeriodView} self={statement([c])} onChanged={() => {}} /></OpenFormScope>)
  fireEvent.click(screen.getByRole('button', { name: 'Nicht möglich' }))
  expect(hasOpenForm()).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
  expect(screen.queryByLabelText(/Warum war die Zwischenablesung nicht möglich/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Nicht möglich' }))
  fireEvent.change(screen.getByLabelText(/Warum war die Zwischenablesung nicht möglich/), { target: { value: 'x' } })
  expect(hasOpenForm()).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Speichern (Grund)' }))
  await waitFor(() => expect(screen.getAllByText(/Der Grund ist zu lang\./)).toHaveLength(1))
  vi.unstubAllGlobals()
})

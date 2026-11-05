// @vitest-environment jsdom
// Bezugszähler und verteilter Rest im Kostenformular (#98). Geprüft wird, was Logiktests nicht sehen: Jedes Auswahlfeld
// zeigt, was im Formular steht, und eine Wahl ändert genau das Formular, das gespeichert wird.
import { afterEach, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import type { Meter, Unit } from '../types'
import { EMPTY_ITEM_FORM, type ItemForm } from '../costForm'
import MeterRestFields from './MeterRestFields'

afterEach(cleanup)

const UNITS: Unit[] = [
  { id: 'eg', propertyId: 'p', name: 'EG', areaM2: 60, participates: true },
  { id: 'og', propertyId: 'p', name: 'OG', areaM2: 70, participates: true },
  { id: 'garage', propertyId: 'p', name: 'Garage', areaM2: 0, participates: true },
]
const m = (id: string, name: string, unitId: string | null, over: Partial<Meter> = {}): Meter => ({ id, propertyId: 'p', name, unitId, type: 'kaltwasser', unit: 'm³', ...over })
const METERS: Meter[] = [
  m('haupt', 'Hauptwasser', null),
  m('wg', 'WG-Zähler', null, { scope: 'common' }),
  m('garten', 'Garten', null, { scope: 'common' }),
  m('w-eg', 'Wasser EG', 'eg'), m('w-og', 'Wasser OG', 'og'),
]

let last: ItemForm
function Harness({ start }: { start: ItemForm }) {
  const [form, setForm] = useState(start)
  last = form
  return <MeterRestFields form={form} meters={METERS} units={UNITS} onChange={(f) => { last = f; setForm(f) }} />
}
const water: ItemForm = { ...EMPTY_ITEM_FORM, category: 'Wasser/Abwasser', key: 'meter', meterType: 'kaltwasser' }
const radio = (name: RegExp) => screen.getByRole('radio', { name }) as HTMLInputElement
const shown = (select: HTMLSelectElement) => select.options[select.selectedIndex]?.textContent

test('wer nichts einstellt, sieht nur die Frage, „tragen Sie“ ist gewählt, und das Formular bleibt ohne Angabe', () => {
  render(<Harness start={water} />)
  expect(radio(/^tragen Sie/).checked).toBe(true)
  expect(screen.queryByLabelText(/Bezugszähler/)).toBeNull()
  expect(last.meterRest).toBeNull()
})

test('Auswahl sichtbar gleich gespeichert: Rest nach Fläche, WG-Zähler als Bezug, Liste vorbelegt', () => {
  render(<Harness start={water} />)
  fireEvent.click(radio(/nach Fläche/))
  expect(last.meterRest?.key).toBe('area')
  expect(radio(/nach Fläche/).checked).toBe(true)
  const ref = screen.getByLabelText(/Bezugszähler/) as HTMLSelectElement
  expect(ref.value).toBe('')
  expect(shown(ref)).toBe('Hauptzähler „Hauptwasser“')
  // Beim Hauptzähler keine Liste: Es zählen alle Zähler der Wohnungen, wie bisher.
  expect(screen.queryByRole('group', { name: /Zähler hinter dem Bezugszähler/ })).toBeNull()
  fireEvent.change(ref, { target: { value: 'wg' } })
  expect(last.meterRest).toMatchObject({ referenceMeterId: 'wg', behindMeterIds: ['w-eg', 'w-og'] })
  expect(shown(screen.getByLabelText(/Bezugszähler/) as HTMLSelectElement)).toBe('„WG-Zähler“')
  const behind = within(screen.getByRole('group', { name: /Zähler hinter dem Bezugszähler/ }))
  expect((behind.getByLabelText(/Wasser EG/) as HTMLInputElement).checked).toBe(true)
  fireEvent.click(behind.getByLabelText(/Wasser EG/))
  expect(last.meterRest?.behindMeterIds).toEqual(['w-og'])
  // Der Bezug ist kein Zwischenzähler mehr.
  expect(screen.queryByLabelText(/Zwischenzähler „WG-Zähler“/)).toBeNull()
})

test('Zwischenzähler „Garten“ direkt an die Garage: sendet die Einheit, angezeigt wie gespeichert', () => {
  render(<Harness start={water} />)
  fireEvent.click(radio(/nach Einheiten/))
  const sub = screen.getByLabelText(/Zwischenzähler „Garten“/) as HTMLSelectElement
  expect(sub.value).toBe('none')
  fireEvent.change(sub, { target: { value: 'direct:garage' } })
  expect(last.meterRest?.subMeters).toEqual([{ meterId: 'garten', target: { key: 'direct', unitIds: ['garage'] } }])
  const after = screen.getByLabelText(/Zwischenzähler „Garten“/) as HTMLSelectElement
  expect(after.value).toBe('direct:garage')
  expect(shown(after)).toBe('an Garage')
})

test('„wie bisher“ mit Zwischenzähler gespeichert: angezeigt als „tragen Sie“, die Gruppe des Zwischenzählers mit ihren Häkchen', () => {
  const stored: ItemForm = { ...water, meterRest: { referenceMeterId: null, behindMeterIds: null, key: 'standard', unitIds: null, subMeters: [{ meterId: 'garten', target: { key: 'persons', unitIds: ['eg', 'og'] } }] } }
  render(<Harness start={stored} />)
  expect(radio(/^tragen Sie/).checked).toBe(true)
  const sub = screen.getByLabelText(/Zwischenzähler „Garten“/) as HTMLSelectElement
  expect(sub.value).toBe('persons')
  const group = within(screen.getByRole('group', { name: /Wohnungen für „Garten“/ }))
  expect((group.getByLabelText('EG') as HTMLInputElement).checked).toBe(true)
  expect((group.getByLabelText('Garage') as HTMLInputElement).checked).toBe(false)
  fireEvent.click(group.getByLabelText('Garage'))
  expect(last.meterRest?.subMeters).toEqual([{ meterId: 'garten', target: { key: 'persons', unitIds: ['eg', 'og', 'garage'] } }])
})

test('Zwischenzähler bei „tragen Sie“: wählbar ohne andere Antwort, der letzte entfernt heißt wieder ohne Angabe', () => {
  render(<Harness start={water} />)
  fireEvent.change(screen.getByLabelText(/Zwischenzähler „Garten“/), { target: { value: 'excluded' } })
  expect(radio(/^tragen Sie/).checked).toBe(true)
  expect(last.meterRest).toMatchObject({ key: 'standard', referenceMeterId: null, subMeters: [{ meterId: 'garten', target: 'excluded' }] })
  expect(screen.queryByLabelText(/Bezugszähler/)).toBeNull()
  fireEvent.change(screen.getByLabelText(/Zwischenzähler „Garten“/), { target: { value: 'none' } })
  expect(last.meterRest).toBeNull()
})

// Abschlussdurchsicht I2: Ein gespeicherter Schlüssel Eigenanteil (oder Vermieter) steht als eigene Antwort da, nicht als „tragen Sie“.
test('Eigenanteil gespeichert: als eigene Antwort gewählt angezeigt', () => {
  const stored: ItemForm = { ...water, meterRest: { referenceMeterId: null, behindMeterIds: null, key: 'selfUse', unitIds: null, subMeters: [{ meterId: 'garten', target: 'excluded' }] } }
  render(<Harness start={stored} />)
  expect(radio(/als Ihr Eigenanteil/).checked).toBe(true)
  expect(radio(/^tragen Sie/).checked).toBe(false)
  expect(screen.queryByRole('radio', { name: /trägt der Vermieter/ })).toBeNull()
})

test('nur auf bestimmte Wohnungen: abgehakt wird die Liste der Empfänger', () => {
  render(<Harness start={water} />)
  fireEvent.click(radio(/nach Fläche/))
  fireEvent.click(screen.getByText(/nur auf bestimmte Wohnungen/))
  const group = within(screen.getByRole('group', { name: /Empfänger des Allgemeinverbrauchs/ }))
  fireEvent.click(group.getByLabelText('Garage'))
  expect(last.meterRest?.unitIds).toEqual(['eg', 'og'])
})

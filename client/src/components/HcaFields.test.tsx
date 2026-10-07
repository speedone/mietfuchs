// @vitest-environment jsdom
// Skala und Faktor am Heizkostenverteiler (Heizung PR 12): Die Auswahl zeigt den gespeicherten Wert
// (CLAUDE.md, Kosten.test.tsx); ohne Skala steht „bitte wählen“, und das Feld zeigt den Faktor mit allen
// Nachkommastellen.
import { afterEach, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import HcaFields from './HcaFields'
import { hcaFieldsOf, type HcaFieldsForm } from '../hcaForm'

afterEach(() => cleanup())

function Probe({ start }: { start: HcaFieldsForm }) {
  const [form, setForm] = useState(start)
  return <><HcaFields form={form} onChange={setForm} /><output data-testid="stand">{JSON.stringify(form)}</output></>
}

test('Die Skala zeigt den gespeicherten Wert, der Faktor steht nur bei der Einheitsskala', () => {
  render(<Probe start={{ scale: 'product', factor: '' }} />)
  const scale = screen.getByLabelText(/Skala/) as HTMLSelectElement
  expect(scale.value).toBe('product')
  expect(screen.queryByLabelText(/Bewertungsfaktor/)).toBeNull()
  fireEvent.change(scale, { target: { value: 'unit' } })
  fireEvent.change(screen.getByLabelText(/Bewertungsfaktor/), { target: { value: '1,25' } })
  expect(screen.getByTestId('stand').textContent).toBe('{"scale":"unit","factor":"1,25"}')
})

test('Ohne Skala steht „bitte wählen“; ein gespeicherter Faktor steht mit allen Stellen da', () => {
  render(<Probe start={{ scale: '', factor: '' }} />)
  expect((screen.getByLabelText(/Skala/) as HTMLSelectElement).value).toBe('')
  cleanup()
  render(<Probe start={hcaFieldsOf({ hcaScale: 'unit', ratingFactor: 0.8125 })} />)
  expect((screen.getByLabelText(/Bewertungsfaktor/) as HTMLInputElement).value).toBe('0,8125')
})

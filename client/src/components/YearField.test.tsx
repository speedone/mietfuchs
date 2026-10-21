// @vitest-environment jsdom
// Das Jahresfeld: Textfeld mit ‹ › zum Blättern, Meldung beim Verlassen.
import { afterEach, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import YearField from './YearField'

afterEach(cleanup)

let last = ''
function Probe({ initial = '', error, required }: { initial?: string; error?: string; required?: boolean }) {
  const [value, setValue] = useState(initial)
  last = value
  return <YearField label="Geeicht bis Ende (Jahr)" value={value} onChange={setValue} today="2026-10-21" error={error} required={required} />
}

const field = () => screen.getByRole('textbox', { name: 'Geeicht bis Ende (Jahr)' }) as HTMLInputElement
const prev = () => screen.getByRole('button', { name: 'Voriges Jahr' }) as HTMLButtonElement
const next = () => screen.getByRole('button', { name: 'Nächstes Jahr' }) as HTMLButtonElement

test('Jahresfeld: Ziffernblock, getippter Text ist der Wert', () => {
  render(<Probe />)
  expect(field().inputMode).toBe('numeric')
  fireEvent.change(field(), { target: { value: '2031' } })
  expect(last).toBe('2031')
  expect(field().value).toBe('2031')
})

test('Jahresfeld: ‹ › blättern um ein Jahr, im leeren Feld ab dem Jahr von heute', () => {
  render(<Probe />)
  fireEvent.click(next())
  expect(last).toBe('2026')
  fireEvent.click(next())
  expect(last).toBe('2027')
  fireEvent.click(prev())
  fireEvent.click(prev())
  expect(last).toBe('2025')
  expect(field().value).toBe('2025')
  cleanup()
  render(<Probe />)
  fireEvent.click(prev())
  expect(last).toBe('2026')
})

test('Jahresfeld: an den Grenzen 1900 und 2100 ist der Knopf gesperrt', () => {
  render(<Probe initial="2099" />)
  expect(next().disabled).toBe(false)
  fireEvent.click(next())
  expect(last).toBe('2100')
  expect(next().disabled).toBe(true)
  expect(prev().disabled).toBe(false)
  cleanup()
  render(<Probe initial="1900" />)
  expect(prev().disabled).toBe(true)
  fireEvent.click(next())
  expect(last).toBe('1901')
})

test('Jahresfeld: ein zweistelliges Jahr wird nicht ergänzt, sondern beim Verlassen gemeldet', () => {
  render(<Probe />)
  fireEvent.change(field(), { target: { value: '28' } })
  expect(last).toBe('28')
  expect(field().hasAttribute('aria-invalid')).toBe(false)
  fireEvent.blur(field())
  expect(field().value).toBe('28')
  expect(field().getAttribute('aria-invalid')).toBe('true')
  expect(screen.getByRole('alert').textContent).toContain('Jahr vierstellig angeben')
  // Blättern ersetzt den unlesbaren Text durch das Jahr von heute, die Meldung geht
  fireEvent.click(next())
  expect(last).toBe('2026')
  expect(field().hasAttribute('aria-invalid')).toBe(false)
})

test('Jahresfeld: die Meldung der Prüfung geht vor, Pflichtfeld trägt required', () => {
  render(<Probe error="Vierstellige Jahreszahl" required />)
  expect(field().getAttribute('aria-invalid')).toBe('true')
  expect(field().required).toBe(true)
  expect(screen.getByText('Vierstellige Jahreszahl')).toBeTruthy()
})

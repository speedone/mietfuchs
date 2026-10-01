// @vitest-environment jsdom
// Ein Fachbegriff im Formular (#113): auf Antippen die Erklärung, Escape schließt. In einem
// Label darf er dem Eingabefeld die Beschriftung nicht nehmen.
import { afterEach, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import Term from './Term'

afterEach(cleanup)

test('Antippen zeigt Erklärung, Beispiel, Rechtsgrundlage und „Brauche ich das?“, Escape schließt', () => {
  render(<p><Term id="mea">Miteigentumsanteile</Term></p>)
  const trigger = screen.getByRole('button', { name: 'Miteigentumsanteile' })
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(trigger)
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByText(/85 von 1\.000 MEA/)).toBeTruthy()
  expect(screen.getByText(/§ 16 Abs\. 1 und 2 WEG/)).toBeTruthy()
  expect(screen.getByText(/Brauche ich das\?/)).toBeTruthy()
  fireEvent.keyDown(trigger, { key: 'Escape' })
  expect(screen.queryByText(/85 von 1\.000 MEA/)).toBeNull()
  fireEvent.keyDown(trigger, { key: 'Enter' })
  expect(screen.getByText(/85 von 1\.000 MEA/)).toBeTruthy()
})

test('in einem Label bleibt das Eingabefeld beschriftet, und der Klick fokussiert es nicht', () => {
  render(<label>Wert in <Term id="mea">MEA</Term><input /></label>)
  const input = screen.getByRole('textbox')
  // Die Beschriftung des Feldes enthält den Begriff; wäre der Begriff ein <button>, gehörte das
  // Label zu ihm und nicht zum Feld.
  expect(screen.getByLabelText(/Wert in/)).toBe(input)
  fireEvent.click(screen.getByRole('button', { name: 'MEA' }))
  expect(document.activeElement).not.toBe(input)
  expect(screen.getByText(/85 von 1\.000 MEA/)).toBeTruthy()
})

test('ein unbekannter Begriff stürzt nicht ab, sondern zeigt nur seinen Text', () => {
  // Eine abgeschlossene Abrechnung friert ihre Hinweise samt Begriffen ein. Wird ein Begriff
  // später umbenannt, muss die Seite dieses Jahres trotzdem erscheinen.
  // @ts-expect-error: absichtlich ein Begriff, den es nicht gibt
  render(<p><Term id="gibtEsNichtMehr" /></p>)
  expect(screen.getByText('gibtEsNichtMehr')).toBeTruthy()
})

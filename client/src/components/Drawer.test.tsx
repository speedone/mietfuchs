// @vitest-environment jsdom
// Der Drawer setzt den Fokus 60 ms nach dem Öffnen auf das erste Feld. Wurde er in der Zwischenzeit
// woanders hingesetzt (das Menüblatt am Handy, #346 Schritt 9), bleibt er dort: Vorher nahm der
// Zeitgeber ihn der Objektwahl im Blatt wieder weg, und ein Test schlug je nach Last mal fehl, mal nicht.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import Drawer from './Drawer'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const view = () => render(
  <>
    <button type="button">Draußen</button>
    <Drawer open title="Zahlung" onClose={() => {}}>
      <label>Betrag <input /></label>
    </Drawer>
  </>,
)

test('ohne anderen Fokus nimmt das erste Feld ihn nach dem Öffnen', () => {
  view()
  act(() => { vi.advanceTimersByTime(60) })
  expect(document.activeElement).toBe(screen.getByLabelText('Betrag'))
})

test('ein inzwischen woanders gesetzter Fokus bleibt, wo er ist', () => {
  view()
  const outside = screen.getByRole('button', { name: 'Draußen' })
  act(() => { outside.focus() })
  act(() => { vi.advanceTimersByTime(60) })
  expect(document.activeElement).toBe(outside)
})

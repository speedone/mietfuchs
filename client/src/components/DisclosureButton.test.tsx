// @vitest-environment jsdom
// Ein Knopf, der etwas auf- und zuklappt: Der Text nennt, was ein Klick tut, `aria-expanded` den Zustand,
// und den Pfeil davor zeichnet dieselbe Regel wie bei jedem <summary> (index.css, `.disclosure`).
import { afterEach, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import DisclosureButton from './DisclosureButton'

afterEach(cleanup)

function Probe({ controls }: { controls?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <DisclosureButton open={open} onToggle={() => setOpen((o) => !o)} closedLabel="Mehr dazu" openLabel="Weniger" controls={controls} className="btn ghost" />
      {open && <div id="teil">Inhalt</div>}
    </>
  )
}

test('der Text wechselt mit dem Zustand, aria-expanded folgt, aria-controls zeigt auf den Teil', () => {
  render(<Probe controls="teil" />)
  const knopf = screen.getByRole('button', { name: 'Mehr dazu' })
  expect(knopf.getAttribute('aria-expanded')).toBe('false')
  expect(knopf.getAttribute('aria-controls')).toBe('teil')
  expect(knopf.getAttribute('type')).toBe('button')
  fireEvent.click(knopf)
  expect(knopf.getAttribute('aria-expanded')).toBe('true')
  expect(knopf.textContent).toBe('Weniger')
  expect(screen.getByRole('button', { name: 'Weniger' })).toBe(knopf)
  expect(screen.getByText('Inhalt')).toBeTruthy()
  fireEvent.click(knopf)
  expect(knopf.getAttribute('aria-expanded')).toBe('false')
  expect(knopf.textContent).toBe('Mehr dazu')
})

test('die Klassen werden durchgereicht, der Pfeil hängt an `disclosure`, ohne aria-controls kein leeres Attribut', () => {
  render(<Probe />)
  const knopf = screen.getByRole('button', { name: 'Mehr dazu' })
  expect([...knopf.classList]).toEqual(expect.arrayContaining(['disclosure', 'btn', 'ghost']))
  expect(knopf.hasAttribute('aria-controls')).toBe(false)
})

test('describedBy setzt aria-describedby, ohne bleibt es weg', () => {
  render(<DisclosureButton open={false} onToggle={() => {}} closedLabel="A" openLabel="B" describedBy="titel" />)
  expect(screen.getByRole('button', { name: 'A' }).getAttribute('aria-describedby')).toBe('titel')
  cleanup()
  render(<DisclosureButton open={false} onToggle={() => {}} closedLabel="A" openLabel="B" />)
  expect(screen.getByRole('button', { name: 'A' }).hasAttribute('aria-describedby')).toBe(false)
})

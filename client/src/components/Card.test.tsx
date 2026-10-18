// @vitest-environment jsdom
// Der einheitliche Kartenkopf (#346 Schritt 7, UI-Durchsicht N8).
import { afterEach, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import Card from './Card'

afterEach(cleanup)

test('Karte: Titel als h2, rechts höchstens eine Aktion, darunter der Inhalt', () => {
  render(<Card title="Lieferungen" aside={<button type="button">Drucken</button>}><p>Inhalt</p></Card>)
  const heading = screen.getByRole('heading', { level: 2, name: 'Lieferungen' })
  const card = heading.closest('section')
  expect(card?.className).toBe('card')
  expect(card?.textContent).toBe('LieferungenDruckenInhalt')
})

test('Karte unter einem Abschnittstitel: h3, gestaltet wie jede Karte', () => {
  render(<Card title="Warmwasser" level={3} className="no-print"><p>x</p></Card>)
  const heading = screen.getByRole('heading', { level: 3, name: 'Warmwasser' })
  expect(heading.className).toContain('text-l')
  expect(heading.closest('section')?.className).toBe('card no-print')
})

test('Karte ohne Titel: nur der Inhalt', () => {
  render(<Card><p>nur Inhalt</p></Card>)
  expect(screen.queryByRole('heading')).toBeNull()
})

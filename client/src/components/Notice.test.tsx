// @vitest-environment jsdom
// „Mehr dazu“ eines Hinweises nennt aufgeklappt, was der nächste Klick tut („Weniger“), wie jeder Knopf zum Aufklappen.
import { afterEach, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { NoticeBox } from './Notice'

afterEach(cleanup)

test('„Mehr dazu“ wird aufgeklappt zu „Weniger“, und die Begründung erscheint', () => {
  render(<NoticeBox level="warning" title="Titel" action="Befund." more="Begründung aus BGH VIII ZR 1/23." />)
  const knopf = screen.getByRole('button', { name: 'Mehr dazu' })
  const more = screen.getByText(/Begründung aus/)
  expect(knopf.getAttribute('aria-controls')).toBe(more.id)
  expect(more.hidden).toBe(true)
  expect(knopf.classList.contains('disclosure')).toBe(true)
  fireEvent.click(knopf)
  expect(knopf.getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByRole('button', { name: 'Weniger' })).toBe(knopf)
  expect(more.hidden).toBe(false)
  fireEvent.click(knopf)
  expect(screen.getByRole('button', { name: 'Mehr dazu' })).toBe(knopf)
  expect(more.hidden).toBe(true)
})

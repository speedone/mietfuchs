// @vitest-environment jsdom
// Die Seite „Hilfe & Begriffe“ mit Anleitungen (#164): aufklappen, springen, gemeinsam suchen.
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import Hilfe from './Hilfe'
import { GUIDES } from '../../../shared/guides.ts'

afterEach(cleanup)

test('Anleitungen stehen über den Begriffen, jede aufklappbar mit den fünf Abschnitten', () => {
  render(<Hilfe onNavigate={() => {}} />)
  expect(screen.getByRole('heading', { name: 'Anleitungen' })).toBeTruthy()
  const guide = screen.getByText(GUIDES.granny.title).closest('details')
  if (!guide) throw new Error('Anleitung nicht aufklappbar')
  for (const h of ['Trifft das auf Sie zu?', 'So legen Sie es an', 'Was Mietfuchs daraus macht', 'Beispiel', 'Worauf Sie achten müssen', 'Was Mietfuchs (noch) nicht kann']) {
    expect(within(guide).getByRole('heading', { name: h })).toBeTruthy()
  }
  expect(within(guide).getByText('§ 2 HeizkostenV')).toBeTruthy()
  expect(within(guide).getByRole('link', { name: '#99' }).getAttribute('href')).toBe('https://github.com/speedone/mietfuchs/issues/99')
  // Begriffe zum Aufklappen
  fireEvent.click(within(guide).getByRole('button', { name: 'Einliegerwohnung' }))
  expect(within(guide).getByText(/Ihre Wohnung hat 120 m², die Einliegerwohnung 45 m²/)).toBeTruthy()
})

test('ein Sprung führt auf die Seite des Schritts', () => {
  const onNavigate = vi.fn()
  render(<Hilfe onNavigate={onNavigate} />)
  const guide = screen.getByText(GUIDES.garage.title).closest('details')
  if (!guide) throw new Error('Anleitung fehlt')
  fireEvent.click(within(guide).getAllByRole('button', { name: 'Zu Kosten →' })[0]!)
  expect(onNavigate).toHaveBeenCalledWith('kosten')
})

test('die Suche durchsucht Anleitungen und Begriffe gemeinsam', () => {
  render(<Hilfe onNavigate={() => {}} />)
  fireEvent.change(screen.getByLabelText(/Suchen/), { target: { value: '§ 9b' } })
  expect(screen.getByText(GUIDES.meteringService.title)).toBeTruthy()
  expect(screen.queryByText(GUIDES.granny.title)).toBeNull()
  // Kein Begriff nennt § 9b: Die Begriffe sagen das, die Anleitungen stehen trotzdem da.
  expect(screen.getByText(/Kein Begriff passt/)).toBeTruthy()
  fireEvent.change(screen.getByLabelText(/Suchen/), { target: { value: 'gibt es nicht' } })
  expect(screen.getByText(/Keine Anleitung passt/)).toBeTruthy()
})

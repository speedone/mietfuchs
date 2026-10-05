// @vitest-environment jsdom
// Die Seite „Hilfe & Begriffe“ mit Anleitungen (#164): aufklappen, springen, gemeinsam suchen.
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import Hilfe from './Hilfe'
import { GUIDES } from '../../../shared/guides.ts'
import { GLOSSARY } from '../../../shared/glossary.ts'

afterEach(cleanup)

test('Anleitungen stehen über den Begriffen, jede aufklappbar mit den fünf Abschnitten', () => {
  render(<Hilfe onNavigate={() => {}} />)
  expect(screen.getByRole('heading', { name: 'Anleitungen' })).toBeTruthy()
  const guide = screen.getByText(GUIDES.granny.title).closest('details')
  if (!guide) throw new Error('Anleitung nicht aufklappbar')
  for (const h of ['Trifft das auf Sie zu?', 'So legen Sie es an', 'Was Mietfuchs daraus macht', 'Beispiel', 'Worauf Sie achten müssen', 'Was Mietfuchs (noch) nicht kann']) {
    expect(within(guide).getByRole('heading', { name: h, level: 4 })).toBeTruthy()
  }
  // Gliederung (Durchsicht): Seite h1, Abschnitte h2, Anleitungstitel und Begriffe h3, Teile h4.
  expect(within(guide).getByRole('heading', { name: GUIDES.granny.title, level: 3 }).closest('summary')).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Begriffe', level: 2 })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Einliegerwohnung', level: 3 })).toBeTruthy()
  expect(within(guide).getByText('§ 2 HeizkostenV')).toBeTruthy()
  expect(within(guide).getByRole('link', { name: '#99' }).getAttribute('href')).toBe('https://github.com/speedone/mietfuchs/issues/99')
  // Begriffe zum Aufklappen
  fireEvent.click(within(guide).getByRole('button', { name: 'Einliegerwohnung' }))
  expect(within(guide).getByText(/Ihre Wohnung hat 120 m², die Einliegerwohnung 45 m²/)).toBeTruthy()
})

test('ein Sprung führt auf die Seite des Schritts und an den Anfang der Seite', () => {
  const onNavigate = vi.fn()
  const scrollTo = vi.fn()
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo
  render(<Hilfe onNavigate={onNavigate} />)
  const guide = screen.getByText(GUIDES.garage.title).closest('details')
  if (!guide) throw new Error('Anleitung fehlt')
  fireEvent.click(within(guide).getAllByRole('button', { name: 'Zu Kosten →' })[0]!)
  expect(onNavigate).toHaveBeenCalledWith('kosten')
  expect(scrollTo).toHaveBeenCalledWith(0, 0)
})

test('die Suche durchsucht Anleitungen und Begriffe gemeinsam', () => {
  render(<Hilfe onNavigate={() => {}} />)
  fireEvent.change(screen.getByLabelText(/Suchen/), { target: { value: '§ 9b' } })
  expect(screen.getByText(GUIDES.meteringService.title)).toBeTruthy()
  expect(screen.queryByText(GUIDES.granny.title)).toBeNull()
  // Bei einer Suche sind die Treffer aufgeklappt, sonst sähe man nicht, wo das Wort steht.
  expect(screen.getByText(GUIDES.meteringService.title).closest('details')?.open).toBe(true)
  // Seit #208 nennt der Begriff „Gradtagszahlen“ § 9b HeizkostenV; er steht neben den Anleitungen.
  expect(screen.getAllByText(GLOSSARY.degreeDays.title).length).toBeGreaterThan(0)
  fireEvent.change(screen.getByLabelText(/Suchen/), { target: { value: '' } })
  expect(screen.getByText(GUIDES.meteringService.title).closest('details')?.open).toBe(false)
  fireEvent.change(screen.getByLabelText(/Suchen/), { target: { value: 'gibt es nicht' } })
  expect(screen.getByText(/Keine Anleitung passt/)).toBeTruthy()
  // Passt kein Begriff, sagt die Seite das, die Anleitungen stehen trotzdem da.
  expect(screen.getByText(/Kein Begriff passt/)).toBeTruthy()
})

// @vitest-environment jsdom
// Die Seite „Hilfe & Begriffe“ mit Anleitungen (#164): aufklappen, springen, gemeinsam suchen.
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  // Heizung PR 12: Die offene Lücke dort ist die Vorerfassung bei gemischten Geräten (#218).
  expect(within(guide).getByRole('link', { name: '#218' }).getAttribute('href')).toBe('https://github.com/speedone/mietfuchs/issues/218')
  // Begriffe zum Aufklappen
  fireEvent.click(within(guide).getByRole('button', { name: 'Einliegerwohnung' }))
  expect(within(screen.getByRole('dialog', { name: 'Einliegerwohnung' })).getByText(/Ihre Wohnung hat 120 m², die Einliegerwohnung 45 m²/)).toBeTruthy()
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

// #346 Schritt 6: „Mehr in ‚Hilfe & Begriffe‘ →“ aus einer Erklärung führt zum Begriff, auch bei laufender Suche.
test('ein Sprung aus einer Begriffserklärung leert die Suche und setzt den Fokus auf den Begriff', async () => {
  const { rerender } = render(<Hilfe onNavigate={() => {}} />)
  fireEvent.change(screen.getByLabelText('Suchen in Anleitungen und Begriffen'), { target: { value: 'Garage' } })
  expect(document.getElementById('begriff-mea')).toBeNull()
  rerender(<Hilfe onNavigate={() => {}} focusTerm={{ id: 'mea', seq: 1 }} />)
  await waitFor(() => expect(document.activeElement?.closest('details')?.id).toBe('begriff-mea'))
  expect((screen.getByLabelText('Suchen in Anleitungen und Begriffen') as HTMLInputElement).value).toBe('')
})

// N10 aus #341: Die Begriffsliste war rund 29.000 px lang, alles aufgeklappt, ohne Buchstabenleiste.
test('Begriffe sind zugeklappt, eine Suche klappt die Treffer auf', () => {
  render(<Hilfe onNavigate={() => {}} />)
  const entry = screen.getByRole('heading', { name: GLOSSARY.mea.title, level: 3 }).closest('details')
  if (!entry) return expect.fail('Begriff nicht aufklappbar')
  expect(entry.open).toBe(false)
  expect(entry.querySelector('summary')?.textContent).toContain(GLOSSARY.mea.title)
  fireEvent.change(screen.getByLabelText(/Suchen/), { target: { value: GLOSSARY.mea.title } })
  expect(screen.getByRole('heading', { name: GLOSSARY.mea.title, level: 3 }).closest('details')?.open).toBe(true)
})

test('die Buchstabenleiste springt zum ersten Begriff des Buchstabens, Ü steht bei U', () => {
  const scrolled: string[] = []
  Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this.id) } as typeof Element.prototype.scrollIntoView
  render(<Hilfe onNavigate={() => {}} />)
  const bar = screen.getByRole('navigation', { name: 'Begriffe nach Anfangsbuchstabe' })
  const letters = within(bar).getAllByRole('button').map((b) => b.textContent)
  // Der Name nennt den Zusammenhang, der sichtbare Buchstabe steht darin (Durchsicht von N10)
  expect(within(bar).getAllByRole('button').every((b) => b.getAttribute('aria-label') === `Begriffe mit ${b.textContent}`)).toBe(true)
  expect(letters).toContain('A')
  expect(letters).not.toContain('Ü')
  expect(letters).toEqual([...letters].sort((a, b) => (a ?? '').localeCompare(b ?? '', 'de')))
  fireEvent.click(within(bar).getByRole('button', { name: 'Begriffe mit M' }))
  const first = Object.values(GLOSSARY).map((g) => g.title).filter((t) => t.startsWith('M')).sort((a, b) => a.localeCompare(b, 'de'))[0]
  expect(document.activeElement?.tagName).toBe('SUMMARY')
  expect(document.activeElement?.querySelector('h3')?.textContent).toBe(first)
  expect(scrolled.at(-1)).toBe(document.activeElement?.closest('details')?.id)
})

test('ein Sprung zu einem Begriff klappt ihn auf', async () => {
  const { rerender } = render(<Hilfe onNavigate={() => {}} />)
  rerender(<Hilfe onNavigate={() => {}} focusTerm={{ id: 'mea', seq: 1 }} />)
  await waitFor(() => expect(document.activeElement?.closest('details')?.id).toBe('begriff-mea'))
  expect((document.getElementById('begriff-mea') as HTMLDetailsElement).open).toBe(true)
  // Der Fokus liegt auf der Zeile zum Auf- und Zuklappen, nicht auf dem Kasten (Durchsicht von N10)
  expect(document.activeElement?.tagName).toBe('SUMMARY')
})

// Durchsicht der Hinweiskästen: Ein leeres Suchergebnis ist keine Warnung.
test('passt nichts zur Suche, steht das als schlichter Satz, nicht als Warnung', () => {
  render(<Hilfe onNavigate={() => {}} />)
  fireEvent.change(screen.getByLabelText(/Suchen/), { target: { value: 'gibt es nicht' } })
  expect(screen.getByText(/Keine Anleitung passt/).closest('.notice-item')).toBeNull()
  expect(screen.getByText(/Kein Begriff passt/).closest('.notice-item')).toBeNull()
})

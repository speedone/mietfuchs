// @vitest-environment jsdom
// Die Seite „Hilfe & Begriffe“ (#488): Startansicht mit Suche, Anleitungen als Kacheln in Gruppen, Themen des Lexikons;
// Anleitung und Begriffe als eigene Ansichten; der Sprung aus einer Begriffserklärung (#346).
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import Hilfe from './Hilfe'
import { GUIDES } from '../../../shared/guides.ts'
import { GLOSSARY, TERM_TOPICS } from '../../../shared/glossary.ts'
import { TERM_TOPIC_LABELS } from '../helpView'

afterEach(cleanup)

const searchBox = () => screen.getByRole('combobox', { name: /Suchen in Anleitungen und Begriffen/ }) as HTMLInputElement
const type = (value: string) => fireEvent.change(searchBox(), { target: { value } })
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const tile = (title: string) => screen.getByRole('button', { name: new RegExp(`^${escape(title)}`) })
const optionTitles = (list: HTMLElement) => within(list).getAllByRole('option').map((o) => o.querySelector('.font-strong')?.textContent)

test('Startansicht: Anleitungen als Kacheln in drei Gruppen, mit erstem Satz und Zahl der Schritte, darunter die Themen', () => {
  render(<Hilfe onNavigate={() => {}} />)
  expect(screen.getByRole('heading', { name: 'Hilfe & Begriffe', level: 1 })).toBeTruthy()
  expect(screen.getByRole('heading', { name: /^Anleitungen/, level: 2 })).toBeTruthy()
  for (const g of ['Ihr Objekt', 'Im Abrechnungsjahr', 'Heizung']) expect(screen.getByRole('heading', { name: g, level: 3 })).toBeTruthy()
  const condo = tile(GUIDES.condo.title)
  expect(condo.textContent).toContain('Sie vermieten eine Eigentumswohnung.')
  expect(condo.textContent).not.toContain('Hausgeldabrechnung und geben')
  expect(condo.textContent).toContain(`${GUIDES.condo.steps.length} Schritte`)
  // Alle Anleitungen stehen da, keine aufgeklappt
  for (const g of Object.values(GUIDES)) expect(tile(g.title)).toBeTruthy()
  expect(document.querySelector('details')).toBeNull()
  expect(screen.getByRole('heading', { name: /^Lexikon/, level: 2 })).toBeTruthy()
  for (const t of TERM_TOPICS) expect(screen.getByRole('button', { name: new RegExp(`^${escape(TERM_TOPIC_LABELS[t])} \\d+ Begriffe$`) })).toBeTruthy()
  expect(screen.getByRole('button', { name: `Alle von A bis Z ${Object.keys(GLOSSARY).length} Begriffe` })).toBeTruthy()
})

test('eine Kachel öffnet die Anleitung mit allen Abschnitten, „Zurück“ führt auf die Kachel', async () => {
  render(<Hilfe onNavigate={() => {}} />)
  fireEvent.click(tile(GUIDES.granny.title))
  const heading = await screen.findByRole('heading', { name: GUIDES.granny.title, level: 2 })
  await waitFor(() => expect(document.activeElement).toBe(heading))
  const guide = document.getElementById('anleitung-granny') ?? expect.fail('Anleitung fehlt')
  for (const h of ['Trifft das auf Sie zu?', 'So legen Sie es an', 'Was Mietfuchs daraus macht', 'Beispiel', 'Worauf Sie achten müssen', 'Was Mietfuchs (noch) nicht kann']) {
    expect(within(guide).getByRole('heading', { name: h, level: 3 })).toBeTruthy()
  }
  expect(within(guide).getByText('§ 2 HeizkostenV')).toBeTruthy()
  // Heizung PR 12: Die offene Lücke dort ist die Vorerfassung bei gemischten Geräten (#218).
  expect(within(guide).getByRole('link', { name: '#218' }).getAttribute('href')).toBe('https://github.com/speedone/mietfuchs/issues/218')
  // Begriffe zum Aufklappen
  fireEvent.click(within(guide).getByRole('button', { name: 'Einliegerwohnung' }))
  expect(within(screen.getByRole('dialog', { name: 'Einliegerwohnung' })).getByText(/Ihre Wohnung hat 120 m², die Einliegerwohnung 45 m²/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '← Zurück zu Hilfe & Begriffe' }))
  await waitFor(() => expect(document.activeElement).toBe(tile(GUIDES.granny.title)))
})

test('ein Sprung führt auf die Seite des Schritts und an den Anfang der Seite', () => {
  const onNavigate = vi.fn()
  const scrollTo = vi.fn()
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo
  render(<Hilfe onNavigate={onNavigate} />)
  fireEvent.click(tile(GUIDES.garage.title))
  const guide = document.getElementById('anleitung-garage') ?? expect.fail('Anleitung fehlt')
  fireEvent.click(within(guide).getAllByRole('button', { name: 'Zu Kosten →' })[0]!)
  expect(onNavigate).toHaveBeenCalledWith('kosten')
  expect(scrollTo).toHaveBeenCalledWith(0, 0)
})

test('die Suche zeigt beim Tippen Anleitungen und Begriffe getrennt, mit Zahl, markierter Fundstelle und Ansage', () => {
  render(<Hilfe onNavigate={() => {}} />)
  type('garage')
  const guides = screen.getByRole('listbox', { name: 'Anleitungen 2' })
  const terms = screen.getByRole('listbox', { name: 'Begriffe 2' })
  expect(optionTitles(guides)).toEqual([GUIDES.garage.title, GUIDES.properties.title])
  expect(optionTitles(terms)).toEqual([GLOSSARY.garageVat.title, GLOSSARY.noConnection.title])
  // Die Fundstelle ist markiert, auch im Ausschnitt; das Thema steht beim Begriff
  const marks = [...guides.querySelectorAll('mark')].map((m) => m.textContent)
  expect(marks.length).toBeGreaterThanOrEqual(2)
  expect(new Set(marks)).toEqual(new Set(['Garage']))
  expect(within(terms).getAllByRole('option')[0]?.textContent).toMatch(/^Steuer/)
  expect(screen.getByRole('status').textContent).toBe('2 Anleitungen und 2 Begriffe gefunden.')
  // Während der Suche keine Kacheln und keine „Häufig gesucht“
  expect(screen.queryByRole('heading', { name: 'Ihr Objekt' })).toBeNull()
  expect(screen.queryByText('Häufig gesucht:')).toBeNull()
  // Seit #208 nennt der Begriff „Gradtagszahlen“ § 9b HeizkostenV; die Suche findet ihn neben den Anleitungen.
  type('§ 9b')
  expect(optionTitles(screen.getByRole('listbox', { name: /^Anleitungen/ }))).toEqual([GUIDES.meteringService.title, GUIDES.heatingSelf.title, GUIDES.tenantChange.title])
  expect(optionTitles(screen.getByRole('listbox', { name: /^Begriffe/ }))).toContain(GLOSSARY.degreeDays.title)
})

test('Pfeiltasten wählen über beide Listen, Enter öffnet den Treffer', async () => {
  render(<Hilfe onNavigate={() => {}} />)
  type('garage')
  const box = searchBox()
  expect(box.getAttribute('aria-expanded')).toBe('true')
  const selected = () => document.getElementById(searchBox().getAttribute('aria-activedescendant') ?? '')
  expect(selected()?.textContent).toContain(GUIDES.garage.title)
  expect(selected()?.getAttribute('aria-selected')).toBe('true')
  fireEvent.keyDown(box, { key: 'ArrowDown' })
  fireEvent.keyDown(box, { key: 'ArrowDown' })
  expect(selected()?.textContent).toContain(GLOSSARY.garageVat.title)
  for (let i = 0; i < 3; i++) fireEvent.keyDown(box, { key: 'ArrowUp' })
  // Über den Anfang hinaus geht es unten weiter
  expect(selected()?.textContent).toContain(GLOSSARY.noConnection.title)
  fireEvent.keyDown(box, { key: 'ArrowUp' })
  fireEvent.keyDown(box, { key: 'Enter' })
  // Ein Begriff öffnet die Liste aller Begriffe, aufgeklappt und mit Fokus
  await waitFor(() => expect(document.activeElement?.closest('details')?.id).toBe('begriff-garageVat'))
  expect((document.getElementById('begriff-garageVat') as HTMLDetailsElement).open).toBe(true)
  // Zurück stehen die Suche und die Wahl noch da, mit dem Fokus im Suchfeld
  fireEvent.click(screen.getByRole('button', { name: '← Zurück zu Hilfe & Begriffe' }))
  await waitFor(() => expect(document.activeElement).toBe(searchBox()))
  expect(searchBox().value).toBe('garage')
  expect(selected()?.textContent).toContain(GLOSSARY.garageVat.title)
  fireEvent.keyDown(searchBox(), { key: 'ArrowUp' })
  fireEvent.keyDown(searchBox(), { key: 'Enter' })
  expect(await screen.findByRole('heading', { name: GUIDES.properties.title, level: 2 })).toBeTruthy()
})

test('ein Klick auf einen Treffer öffnet ihn, „Häufig gesucht“ füllt die Suche, Esc leert sie', async () => {
  render(<Hilfe onNavigate={() => {}} />)
  type('Mieterwechsel')
  fireEvent.keyDown(searchBox(), { key: 'Escape' })
  expect(searchBox().value).toBe('')
  expect(screen.getByText('Häufig gesucht:')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Hausgeld' }))
  expect(searchBox().value).toBe('Hausgeld')
  expect(document.activeElement).toBe(searchBox())
  fireEvent.click(within(screen.getByRole('listbox', { name: /^Anleitungen/ })).getAllByRole('option')[0]!)
  expect(await screen.findByRole('heading', { name: GUIDES.condo.title, level: 2 })).toBeTruthy()
})

test('die Taste „/“ springt in die Suche, auch aus einer Anleitung, aber nicht beim Schreiben in einem Feld', async () => {
  render(<><Hilfe onNavigate={() => {}} /><input aria-label="anderes Feld" /></>)
  fireEvent.keyDown(document.body, { key: '/' })
  expect(document.activeElement).toBe(searchBox())
  fireEvent.click(tile(GUIDES.condo.title))
  await screen.findByRole('heading', { name: GUIDES.condo.title, level: 2 })
  fireEvent.keyDown(document.body, { key: '/' })
  await waitFor(() => expect(document.activeElement).toBe(searchBox()))
  const other = screen.getByLabelText('anderes Feld')
  other.focus()
  const ev = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true })
  other.dispatchEvent(ev)
  expect(ev.defaultPrevented).toBe(false)
  expect(document.activeElement).toBe(other)
})

test('ein Thema zeigt nur seine Begriffe, zugeklappt; „Zurück“ führt auf die Kachel des Themas', async () => {
  render(<Hilfe onNavigate={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /^Eigentumswohnung \d+ Begriffe$/ }))
  const heading = await screen.findByRole('heading', { name: /^Eigentumswohnung/, level: 2 })
  await waitFor(() => expect(document.activeElement).toBe(heading))
  const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
  const expected = Object.values(GLOSSARY).filter((t) => t.topic === 'condo').map((t) => t.title).sort((a, b) => a.localeCompare(b, 'de'))
  expect(titles).toEqual(expected)
  expect(heading.textContent).toContain(`${expected.length} Begriffe`)
  const entry = screen.getByRole('heading', { name: GLOSSARY.mea.title, level: 3 }).closest('details') ?? expect.fail('Begriff nicht aufklappbar')
  expect(entry.open).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '← Zurück zu Hilfe & Begriffe' }))
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Eigentumswohnung \d+ Begriffe$/ })))
})

// #346 Schritt 6: „Mehr in ‚Hilfe & Begriffe‘ →“ aus einer Erklärung führt zum Begriff, auch bei laufender Suche und
// aus einer offenen Anleitung.
test('ein Sprung aus einer Begriffserklärung zeigt alle Begriffe, klappt ihn auf und setzt den Fokus darauf', async () => {
  const done = vi.fn()
  const { rerender } = render(<Hilfe onNavigate={() => {}} />)
  type('Garage')
  expect(document.getElementById('begriff-mea')).toBeNull()
  rerender(<Hilfe onNavigate={() => {}} focusTerm={{ id: 'mea', seq: 1 }} onFocusTermDone={done} />)
  await waitFor(() => expect(document.activeElement?.closest('details')?.id).toBe('begriff-mea'))
  expect((document.getElementById('begriff-mea') as HTMLDetailsElement).open).toBe(true)
  // Der Fokus liegt auf der Zeile zum Auf- und Zuklappen, nicht auf dem Kasten (Durchsicht von N10)
  expect(document.activeElement?.tagName).toBe('SUMMARY')
  expect(screen.getByRole('heading', { name: /^Alle Begriffe von A bis Z/, level: 2 })).toBeTruthy()
  expect(done).toHaveBeenCalledTimes(1)
  // Aus einer Anleitung heraus ebenso
  fireEvent.click(screen.getByRole('button', { name: '← Zurück zu Hilfe & Begriffe' }))
  type('')
  fireEvent.click(tile(GUIDES.condo.title))
  await screen.findByRole('heading', { name: GUIDES.condo.title, level: 2 })
  rerender(<Hilfe onNavigate={() => {}} focusTerm={{ id: 'reserveFund', seq: 2 }} onFocusTermDone={done} />)
  await waitFor(() => expect(document.activeElement?.closest('details')?.id).toBe('begriff-reserveFund'))
})

test('die Buchstabenleiste springt zum ersten Begriff des Buchstabens, Ü steht bei U', async () => {
  const scrolled: string[] = []
  Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this.id) } as typeof Element.prototype.scrollIntoView
  render(<Hilfe onNavigate={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /^Alle von A bis Z/ }))
  const bar = await screen.findByRole('navigation', { name: 'Begriffe nach Anfangsbuchstabe' })
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

// Durchsicht der Hinweiskästen: Ein leeres Suchergebnis ist keine Warnung.
test('passt nichts zur Suche, steht das als schlichter Satz mit dem Weg ins Lexikon', async () => {
  render(<Hilfe onNavigate={() => {}} />)
  type('gibt es nicht')
  const text = screen.getByText(/Nichts gefunden zu „gibt es nicht“/)
  expect(text.closest('.notice-item')).toBeNull()
  expect(searchBox().getAttribute('aria-expanded')).toBe('false')
  expect(searchBox().getAttribute('aria-activedescendant')).toBeNull()
  expect(screen.getByRole('status').textContent).toBe('Nichts gefunden.')
  fireEvent.click(within(text).getByRole('button', { name: 'Alle Begriffe von A bis Z' }))
  expect(await screen.findByRole('heading', { name: /^Alle Begriffe von A bis Z/, level: 2 })).toBeTruthy()
})

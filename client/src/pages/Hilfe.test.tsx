// @vitest-environment jsdom
// Die Seite „Hilfe & Begriffe“ (#488): Startansicht mit Suche, Anleitungen als Kacheln in Gruppen, Themen des Lexikons;
// Anleitung und Begriffe als eigene Ansichten; der Sprung aus einer Begriffserklärung (#346).
import { afterEach, expect, test, vi } from 'vitest'
import { useState, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import Hilfe from './Hilfe'
import Term, { TermHelp } from '../components/Term'
import type { TermId } from '../../../shared/glossary.ts'
import { GUIDES } from '../../../shared/guides.ts'
import { GLOSSARY, TERM_TOPICS } from '../../../shared/glossary.ts'
import { TERM_TOPIC_LABELS } from '../helpView'
import { pageLabel } from '../nav'

afterEach(cleanup)

const searchBox = () => screen.getByRole('combobox', { name: /Suchen in Anleitungen und Begriffen/ }) as HTMLInputElement
const type = (value: string) => fireEvent.change(searchBox(), { target: { value } })
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const tile = (title: string) => screen.getByRole('button', { name: new RegExp(`^${escape(title)}`) })
const optionTitles = (list: HTMLElement) => within(list).getAllByRole('option').map((o) => o.querySelector('.font-strong')?.textContent)

// Wie in der App: „Mehr in ‚Hilfe & Begriffe‘ →“ aus einer Erklärung setzt `focusTerm`, die Seite meldet den Sprung zurück.
let seq = 0
function WithHelp({ children }: { children?: ReactNode }) {
  const [focusTerm, setFocusTerm] = useState<{ id: TermId; seq: number } | null>(null)
  return (
    <TermHelp.Provider value={(id) => setFocusTerm({ id, seq: ++seq })}>
      <Hilfe onFollow={() => {}} focusTerm={focusTerm} onFocusTermDone={() => setFocusTerm(null)} />
      {children}
    </TermHelp.Provider>
  )
}

test('Startansicht: Anleitungen als Kacheln in drei Gruppen, mit erstem Satz und Zahl der Schritte, darunter die Themen', () => {
  render(<Hilfe onFollow={() => {}} />)
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

test('eine Kachel öffnet die Anleitung als eigene Ansicht mit Pfad und allen Abschnitten', async () => {
  render(<Hilfe onFollow={() => {}} />)
  fireEvent.click(tile(GUIDES.granny.title))
  const heading = await screen.findByRole('heading', { name: GUIDES.granny.title, level: 1 })
  await waitFor(() => expect(document.activeElement).toBe(heading))
  // Pfad „Hilfe & Begriffe › Anleitungen“
  const path = screen.getByRole('navigation', { name: 'Pfad' })
  expect(path.textContent).toBe('Hilfe & Begriffe›Anleitungen')
  const guide = document.getElementById('anleitung-granny') ?? expect.fail('Anleitung fehlt')
  for (const h of ['Trifft das auf Sie zu?', 'So legen Sie es an', 'Was Mietfuchs daraus macht', 'Beispiel', 'Worauf Sie achten müssen', 'Was Mietfuchs (noch) nicht kann', 'Begriffe', 'Ähnliche Anleitungen']) {
    expect(within(guide).getByRole('heading', { name: h, level: 2 })).toBeTruthy()
  }
  // „Trifft das auf Sie zu?“ steht hervorgehoben in einem Kasten mit dem Text
  const applies = within(guide).getByRole('heading', { name: 'Trifft das auf Sie zu?' }).parentElement ?? expect.fail('Kasten fehlt')
  expect(applies.textContent).toContain(GUIDES.granny.applies)
  // Schritte als nummerierte Karten, je mit dem Sprung auf ihre Seite
  const steps = within(guide).getByRole('list', { name: 'So legen Sie es an' })
  const items = within(steps).getAllByRole('listitem')
  expect(items).toHaveLength(GUIDES.granny.steps.length)
  expect(items[0]?.textContent).toMatch(/^1/)
  expect(within(items[0]!).getByRole('button', { name: 'Zu Stammdaten →' })).toBeTruthy()
  expect(within(items[6]!).getByRole('button', { name: `Zu ${pageLabel('steuer')} →` })).toBeTruthy()
  // Beispiel, Hinweise mit Rechtsgrundlage als Marke, Lücke mit Issue
  expect(within(guide).getByRole('heading', { name: 'Beispiel' }).parentElement?.textContent).toContain(GUIDES.granny.example)
  expect(within(guide).getByText('§ 2 HeizkostenV')).toBeTruthy()
  // Heizung PR 12: Die offene Lücke dort ist die Vorerfassung bei gemischten Geräten (#218).
  expect(within(guide).getByRole('link', { name: '#218' }).getAttribute('href')).toBe('https://github.com/speedone/mietfuchs/issues/218')
  // Ähnliche Anleitungen aus derselben Gruppe, ohne die offene
  const related = within(guide).getByRole('region', { name: 'Ähnliche Anleitungen' })
  const relatedTitles = within(related).getAllByRole('button').map((b) => b.querySelector('.font-strong')?.textContent)
  expect(relatedTitles.length).toBeGreaterThan(0)
  expect(relatedTitles).not.toContain(GUIDES.granny.title)
  for (const t of relatedTitles) expect(Object.values(GUIDES).find((g) => g.title === t)?.group).toBe('property')
  // „Hilfe & Begriffe“ im Pfad führt auf die Kachel
  fireEvent.click(within(path).getByRole('button', { name: 'Hilfe & Begriffe' }))
  await waitFor(() => expect(document.activeElement).toBe(tile(GUIDES.granny.title)))
})

test('ein Begriff der Anleitung ist ein Knopf und öffnet den Begriff; „Zurück“ führt auf den Knopf', async () => {
  render(<Hilfe onFollow={() => {}} />)
  fireEvent.click(tile(GUIDES.granny.title))
  const guide = await waitFor(() => document.getElementById('anleitung-granny') ?? expect.fail('Anleitung fehlt'))
  const terms = within(guide).getByRole('region', { name: 'Begriffe' })
  fireEvent.click(within(terms).getByRole('button', { name: GLOSSARY.granny.title }))
  await waitFor(() => expect(document.activeElement?.closest('details')?.id).toBe('begriff-granny'))
  expect((document.getElementById('begriff-granny') as HTMLDetailsElement).open).toBe(true)
  // Durchsicht von PR 2, K7: Der Knopf sagt, wohin er führt
  expect(screen.queryByRole('button', { name: '← Zurück zu Hilfe & Begriffe' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '← Zurück zur Anleitung' }))
  await screen.findByRole('heading', { name: GUIDES.granny.title, level: 1 })
  await waitFor(() => expect(document.activeElement?.textContent).toBe(GLOSSARY.granny.title))
})

test('die Inhaltsleiste springt zum Abschnitt und setzt den Fokus auf seine Überschrift', async () => {
  const scrolled: string[] = []
  Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this.textContent ?? '') } as typeof Element.prototype.scrollIntoView
  render(<Hilfe onFollow={() => {}} />)
  fireEvent.click(tile(GUIDES.condo.title))
  await screen.findByRole('heading', { name: GUIDES.condo.title, level: 1 })
  const toc = screen.getByRole('navigation', { name: 'Inhalt' })
  expect(within(toc).getAllByRole('button').map((b) => b.textContent)).toEqual(['So legen Sie es an', 'Was Mietfuchs daraus macht', 'Beispiel', 'Worauf Sie achten müssen', 'Was Mietfuchs (noch) nicht kann', 'Begriffe'])
  fireEvent.click(within(toc).getByRole('button', { name: 'Worauf Sie achten müssen' }))
  const target = screen.getByRole('heading', { name: 'Worauf Sie achten müssen', level: 2 })
  expect(document.activeElement).toBe(target)
  expect(scrolled.at(-1)).toBe('Worauf Sie achten müssen')
})

test('eine ähnliche Anleitung öffnet sich an derselben Stelle', async () => {
  render(<Hilfe onFollow={() => {}} />)
  fireEvent.click(tile(GUIDES.supplierInvoice.title))
  const guide = await waitFor(() => document.getElementById('anleitung-supplierInvoice') ?? expect.fail('Anleitung fehlt'))
  const related = within(guide).getByRole('region', { name: 'Ähnliche Anleitungen' })
  const first = within(related).getAllByRole('button')[0] ?? expect.fail('keine ähnliche Anleitung')
  const title = first.querySelector('.font-strong')?.textContent ?? ''
  fireEvent.click(first)
  const heading = await screen.findByRole('heading', { name: title, level: 1 })
  await waitFor(() => expect(document.activeElement).toBe(heading))
  // Durchsicht von PR 2, S3: Der Weg zurück in die vorige Anleitung steht über dem Pfad, der Fokus kommt auf die Kachel
  fireEvent.click(screen.getByRole('button', { name: `← Zurück zu ${GUIDES.supplierInvoice.title}` }))
  await screen.findByRole('heading', { name: GUIDES.supplierInvoice.title, level: 1 })
  await waitFor(() => expect(document.activeElement?.querySelector('.font-strong')?.textContent).toBe(title))
  // Aus der Startansicht geöffnet, steht kein solcher Knopf da
  expect(screen.queryByRole('button', { name: /^← Zurück zu/ })).toBeNull()
})

test('„Zu {Seite} →“ meldet Anleitung und Schritt, damit die App den Faden aufnimmt', () => {
  const onFollow = vi.fn()
  render(<Hilfe onFollow={onFollow} />)
  fireEvent.click(tile(GUIDES.garage.title))
  const guide = document.getElementById('anleitung-garage') ?? expect.fail('Anleitung fehlt')
  fireEvent.click(within(guide).getByRole('button', { name: 'Zu Kosten →' }))
  expect(onFollow).toHaveBeenCalledWith('garage', 3)
})

test('„Zurück zur Anleitung“: die App öffnet die Anleitung, der Fokus steht auf dem Schritt', async () => {
  const done = vi.fn()
  render(<Hilfe onFollow={() => {}} openGuide={{ id: 'garage', step: 3, seq: 1 }} onOpenGuideDone={done} />)
  await screen.findByRole('heading', { name: GUIDES.garage.title, level: 1 })
  const steps = screen.getByRole('list', { name: 'So legen Sie es an' })
  await waitFor(() => expect(document.activeElement).toBe(within(steps).getAllByRole('listitem')[3]))
  expect(done).toHaveBeenCalledTimes(1)
  // „Hilfe & Begriffe“ im Pfad führt zur Startansicht, auf die Kachel der Anleitung
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Pfad' })).getByRole('button', { name: 'Hilfe & Begriffe' }))
  await waitFor(() => expect(document.activeElement).toBe(tile(GUIDES.garage.title)))
})

test('die Suche zeigt beim Tippen Anleitungen und Begriffe getrennt, mit Zahl, markierter Fundstelle und Ansage', () => {
  render(<Hilfe onFollow={() => {}} />)
  type('garage')
  const guides = screen.getByRole('group', { name: 'Anleitungen 2' })
  const terms = screen.getByRole('group', { name: 'Begriffe 2' })
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
  expect(optionTitles(screen.getByRole('group', { name: /^Anleitungen/ }))).toEqual([GUIDES.meteringService.title, GUIDES.heatingSelf.title, GUIDES.tenantChange.title])
  expect(optionTitles(screen.getByRole('group', { name: /^Begriffe/ }))).toContain(GLOSSARY.degreeDays.title)
})

test('Pfeiltasten wählen über beide Gruppen, Enter öffnet den Treffer', async () => {
  render(<Hilfe onFollow={() => {}} />)
  type('garage')
  const box = searchBox()
  expect(box.getAttribute('aria-expanded')).toBe('true')
  const selected = () => document.getElementById(searchBox().getAttribute('aria-activedescendant') ?? '')
  // Durchsicht von #488, S2: Beim Tippen bleibt der Vorleser im Feld; erst die Pfeiltasten gehen in die Liste.
  expect(box.getAttribute('aria-activedescendant')).toBeNull()
  // Der erste Treffer ist trotzdem sichtbar markiert, Enter öffnete ihn
  expect(screen.getAllByRole('option')[0]?.getAttribute('aria-selected')).toBe('true')
  fireEvent.keyDown(box, { key: 'ArrowDown' })
  expect(selected()).toBe(screen.getAllByRole('option')[1])
  expect(selected()?.getAttribute('aria-selected')).toBe('true')
  fireEvent.keyDown(box, { key: 'ArrowDown' })
  expect(selected()?.textContent).toContain(GLOSSARY.garageVat.title)
  // Weitertippen verlässt die Liste wieder
  type('garag')
  expect(box.getAttribute('aria-activedescendant')).toBeNull()
  type('garage')
  fireEvent.keyDown(box, { key: 'ArrowDown' })
  fireEvent.keyDown(box, { key: 'ArrowDown' })
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
  expect(await screen.findByRole('heading', { name: GUIDES.properties.title, level: 1 })).toBeTruthy()
})

test('ein Klick auf einen Treffer öffnet ihn, „Häufig gesucht“ füllt die Suche, Esc leert sie', async () => {
  render(<Hilfe onFollow={() => {}} />)
  type('Mieterwechsel')
  fireEvent.keyDown(searchBox(), { key: 'Escape' })
  expect(searchBox().value).toBe('')
  expect(screen.getByText('Häufig gesucht:')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Hausgeld' }))
  expect(searchBox().value).toBe('Hausgeld')
  expect(document.activeElement).toBe(searchBox())
  fireEvent.click(within(screen.getByRole('group', { name: /^Anleitungen/ })).getAllByRole('option')[0]!)
  expect(await screen.findByRole('heading', { name: GUIDES.condo.title, level: 1 })).toBeTruthy()
})

test('die Taste „/“ springt in die Suche, auch aus einer Anleitung, aber nicht beim Schreiben in einem Feld', async () => {
  render(<><Hilfe onFollow={() => {}} /><input aria-label="anderes Feld" /></>)
  fireEvent.keyDown(document.body, { key: '/' })
  expect(document.activeElement).toBe(searchBox())
  fireEvent.click(tile(GUIDES.condo.title))
  await screen.findByRole('heading', { name: GUIDES.condo.title, level: 1 })
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
  render(<Hilfe onFollow={() => {}} />)
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
  const { rerender } = render(<Hilfe onFollow={() => {}} />)
  type('Garage')
  expect(document.getElementById('begriff-mea')).toBeNull()
  rerender(<Hilfe onFollow={() => {}} focusTerm={{ id: 'mea', seq: 1 }} onFocusTermDone={done} />)
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
  await screen.findByRole('heading', { name: GUIDES.condo.title, level: 1 })
  rerender(<Hilfe onFollow={() => {}} focusTerm={{ id: 'reserveFund', seq: 2 }} onFocusTermDone={done} />)
  await waitFor(() => expect(document.activeElement?.closest('details')?.id).toBe('begriff-reserveFund'))
})

test('die Buchstabenleiste springt zum ersten Begriff des Buchstabens, Ü steht bei U', async () => {
  const scrolled: string[] = []
  Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this.id) } as typeof Element.prototype.scrollIntoView
  render(<Hilfe onFollow={() => {}} />)
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
  render(<Hilfe onFollow={() => {}} />)
  type('gibt es nicht')
  const text = screen.getByText(/Nichts gefunden zu „gibt es nicht“/)
  expect(text.closest('.notice-item')).toBeNull()
  expect(searchBox().getAttribute('aria-expanded')).toBe('false')
  expect(searchBox().getAttribute('aria-activedescendant')).toBeNull()
  expect(screen.getByRole('status').textContent).toBe('Nichts gefunden.')
  fireEvent.click(within(text).getByRole('button', { name: 'Alle Begriffe von A bis Z' }))
  expect(await screen.findByRole('heading', { name: /^Alle Begriffe von A bis Z/, level: 2 })).toBeTruthy()
})

// Durchsicht von #488, S5: eine Liste mit zwei Gruppen; aria-controls zeigt nur auf Vorhandenes.
test('die Treffer stehen in einer Liste mit zwei Gruppen, jede Option benannt nach ihrem sichtbaren Text', () => {
  render(<Hilfe onFollow={() => {}} />)
  expect(searchBox().getAttribute('aria-controls')).toBeNull()
  type('Leerstand')
  const ids = (searchBox().getAttribute('aria-controls') ?? '').split(/\s+/).filter(Boolean)
  expect(ids.length).toBeGreaterThan(0)
  for (const id of ids) expect(document.getElementById(id), id).toBeTruthy()
  const lists = screen.getAllByRole('listbox')
  expect(lists).toHaveLength(1)
  const list = lists[0] ?? expect.fail('Liste fehlt')
  expect(ids).toContain(list.id)
  expect(within(list).getAllByRole('group').map((g) => g.getAttribute('aria-labelledby') && document.getElementById(g.getAttribute('aria-labelledby') ?? '')?.textContent)).toEqual([expect.stringMatching(/^Anleitungen/), expect.stringMatching(/^Begriffe/)])
  expect(within(list).getAllByRole('option').length).toBe(screen.getAllByRole('option').length)
  // Der Name ist der sichtbare Text, vorne der Titel (WCAG 2.5.3; Titel allein als Name meldet axe als Verstoß)
  const option = within(list).getAllByRole('option')[0] ?? expect.fail('Option fehlt')
  expect(within(list).getByRole('option', { name: `${GUIDES.tenantChange.title} ${GUIDES.tenantChange.applies}` })).toBe(option)
  expect(option.getAttribute('aria-labelledby')).toBeNull()
  type('gibt es nicht')
  expect(searchBox().getAttribute('aria-controls')).toBeNull()
})

// Durchsicht von #488, S3: In der offenen Erklärung eines Begriffs gehört „/“ nicht der Suche.
test('in einer offenen Begriffserklärung springt „/“ nicht in die Suche', async () => {
  render(<WithHelp><Term id="granny" /></WithHelp>)
  fireEvent.click(tile(GUIDES.condo.title))
  await waitFor(() => document.getElementById('anleitung-condo') ?? expect.fail('Anleitung fehlt'))
  fireEvent.click(screen.getByRole('button', { name: 'Einliegerwohnung' }))
  const more = within(screen.getByRole('dialog', { name: 'Einliegerwohnung' })).getByRole('link', { name: 'Mehr in „Hilfe & Begriffe“ →' })
  more.focus()
  const ev = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true })
  more.dispatchEvent(ev)
  expect(ev.defaultPrevented).toBe(false)
  await new Promise((r) => setTimeout(r, 0))
  expect(document.getElementById('anleitung-condo')).toBeTruthy()
})

// Durchsicht von #488, K3: Die App hängt die Hilfe mit dem Sprung frisch ein.
test('frisch mit einem Sprung eingehängt, steht der Fokus auf dem Begriff', async () => {
  render(<Hilfe onFollow={() => {}} focusTerm={{ id: 'mea', seq: 1 }} />)
  await waitFor(() => expect(document.activeElement?.closest('details')?.id).toBe('begriff-mea'))
  expect((document.getElementById('begriff-mea') as HTMLDetailsElement).open).toBe(true)
})

// Durchsicht von #488, K4: Wer aus einer Anleitung zu einem Begriff springt (Sprung `focusTerm` aus einer Erklärung),
// kommt mit „Zurück“ in die Anleitung, und von dort über den Pfad zur Kachel.
test('„Zurück“ nach dem Sprung aus einer Anleitung führt in diese Anleitung', async () => {
  const { rerender } = render(<Hilfe onFollow={() => {}} />)
  fireEvent.click(tile(GUIDES.granny.title))
  await screen.findByRole('heading', { name: GUIDES.granny.title, level: 1 })
  rerender(<Hilfe onFollow={() => {}} focusTerm={{ id: 'granny', seq: 1 }} />)
  await waitFor(() => expect(document.activeElement?.closest('details')?.id).toBe('begriff-granny'))
  fireEvent.click(screen.getByRole('button', { name: '← Zurück zur Anleitung' }))
  const heading = await screen.findByRole('heading', { name: GUIDES.granny.title, level: 1 })
  await waitFor(() => expect(document.activeElement).toBe(heading))
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Pfad' })).getByRole('button', { name: 'Hilfe & Begriffe' }))
  await waitFor(() => expect(document.activeElement).toBe(tile(GUIDES.granny.title)))
})

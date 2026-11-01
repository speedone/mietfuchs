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
import type { HelpStock } from '../helpSuggestions'
import type { Property, Tenancy, Unit } from '../../../shared/types.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete (HTMLElement.prototype as Partial<HTMLElement>).checkVisibility
})

// Breit oder schmal entscheidet tw.css über eine Container-Abfrage, die jsdom nicht kennt. Die Seite fragt deshalb das
// Element selbst (`checkVisibility`); der Test legt fest, was sichtbar ist.
const visibleWhen = (test: (el: HTMLElement) => boolean) => {
  HTMLElement.prototype.checkVisibility = function (this: HTMLElement) { return test(this) }
}
const wide = () => visibleWhen(() => true)
const narrow = () => visibleWhen((el) => !(el.closest('.lexicon-layout')?.getAttribute('data-pane') === 'term' && el.closest('.lexicon-list')))

const searchBox = () => screen.getByRole('combobox', { name: /Suchen in Anleitungen und Begriffen/ }) as HTMLInputElement
const type = (value: string) => fireEvent.change(searchBox(), { target: { value } })
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const tile = (title: string) => screen.getByRole('button', { name: new RegExp(`^${escape(title)}`) })
const optionTitles = (list: HTMLElement) => within(list).getAllByRole('option').map((o) => o.querySelector('.font-strong')?.textContent)
// Der offene Begriff im Lexikon: seine Überschrift trägt den Fokus
const focusedTerm = () => (document.activeElement?.tagName === 'H2' ? document.activeElement.id.replace(/^begriff-/, '') : null)
const termList = () => screen.getByRole('list', { name: 'Begriffe' })
const filter = () => screen.getByRole('group', { name: 'Thema' })
const pressed = () => within(filter()).getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent)

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
  await waitFor(() => expect(focusedTerm()).toBe('granny'))
  expect(pressed()).toEqual([`Alle ${Object.keys(GLOSSARY).length} Begriffe`])
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
  // Ein Begriff öffnet das Lexikon auf ihm, mit Fokus auf seiner Überschrift
  await waitFor(() => expect(focusedTerm()).toBe('garageVat'))
  // Zurück (Pfad) stehen die Suche und die Wahl noch da, mit dem Fokus im Suchfeld
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Pfad' })).getByRole('button', { name: 'Hilfe & Begriffe' }))
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

test('eine Themenkachel öffnet das Lexikon mit gesetztem Filter; der Pfad führt auf die Kachel', async () => {
  render(<Hilfe onFollow={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /^Eigentumswohnung \d+ Begriffe$/ }))
  const heading = await screen.findByRole('heading', { name: 'Lexikon', level: 1 })
  await waitFor(() => expect(document.activeElement).toBe(heading))
  expect(screen.getByRole('navigation', { name: 'Pfad' }).textContent).toBe('Hilfe & Begriffe›Lexikon')
  const expected = Object.values(GLOSSARY).filter((t) => t.topic === 'condo').map((t) => t.title).sort((a, b) => a.localeCompare(b, 'de'))
  expect(within(termList()).getAllByRole('button').map((b) => b.textContent)).toEqual(expected)
  expect(pressed()).toEqual([`Eigentumswohnung ${expected.length} Begriffe`])
  // Noch kein Begriff gewählt: keiner ist markiert, rechts steht der Hinweis
  expect(within(termList()).getAllByRole('button').some((b) => b.hasAttribute('aria-current'))).toBe(false)
  expect(screen.getByText('Wählen Sie einen Begriff aus der Liste.')).toBeTruthy()
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Pfad' })).getByRole('button', { name: 'Hilfe & Begriffe' }))
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Eigentumswohnung \d+ Begriffe$/ })))
})

test('der Themenfilter: Knöpfe mit Zahl, einer gedrückt; ein anderes Thema zeigt seine Begriffe und hebt die Wahl auf', async () => {
  render(<Hilfe onFollow={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /^Alle von A bis Z/ }))
  await screen.findByRole('heading', { name: 'Lexikon', level: 1 })
  const total = Object.keys(GLOSSARY).length
  const buttons = within(filter()).getAllByRole('button')
  expect(buttons.map((b) => b.textContent)).toEqual([`Alle ${total} Begriffe`, ...TERM_TOPICS.map((t) => `${TERM_TOPIC_LABELS[t]} ${Object.values(GLOSSARY).filter((x) => x.topic === t).length} Begriffe`)])
  expect(pressed()).toEqual([`Alle ${total} Begriffe`])
  expect(within(termList()).getAllByRole('button')).toHaveLength(total)
  // Die Anfangsbuchstaben trennen die Liste, Vorleser hören nur die Begriffe
  const letters = [...termList().querySelectorAll('[aria-hidden="true"]')].map((x) => x.textContent)
  expect(letters[0]).toBe('A')
  expect(letters).not.toContain('Ü')
  fireEvent.click(within(termList()).getByRole('button', { name: GLOSSARY.mea.title }))
  await waitFor(() => expect(focusedTerm()).toBe('mea'))
  expect(within(termList()).getByRole('button', { name: GLOSSARY.mea.title }).getAttribute('aria-current')).toBe('true')
  fireEvent.click(within(filter()).getByRole('button', { name: /^Heizung/ }))
  expect(pressed()).toEqual([expect.stringMatching(/^Heizung \d+ Begriffe$/)])
  expect(within(termList()).getAllByRole('button').map((b) => b.textContent)).toContain(GLOSSARY.heatCostAllocator.title)
  expect(within(termList()).queryByRole('button', { name: GLOSSARY.mea.title })).toBeNull()
  expect(document.getElementById('begriff-mea')).toBeNull()
})

test('der Begriff: Thema, Titel, Erklärung, Beispiel, „Brauche ich das?“, Rechtsgrundlage, „Kommt vor in“, verwandte Begriffe', async () => {
  render(<Hilfe onFollow={() => {}} focusTerm={{ id: 'ownShare', seq: 1 }} />)
  await waitFor(() => expect(focusedTerm()).toBe('ownShare'))
  const t = GLOSSARY.ownShare
  const article = screen.getByRole('article')
  expect(within(article).getByText(TERM_TOPIC_LABELS[t.topic])).toBeTruthy()
  expect(within(article).getByRole('heading', { name: t.title, level: 2 })).toBeTruthy()
  expect(article.textContent).toContain(t.short)
  for (const h of ['Beispiel', 'Brauche ich das?', 'Kommt vor in', 'Verwandte Begriffe']) expect(within(article).getByRole('heading', { name: h, level: 3 }), h).toBeTruthy()
  expect(within(article).getByRole('heading', { name: 'Beispiel' }).parentElement?.textContent).toContain(t.example)
  expect(within(article).getByRole('heading', { name: 'Brauche ich das?' }).parentElement?.textContent).toContain(t.needed)
  if (t.norm) expect(within(article).getByRole('heading', { name: 'Rechtsgrundlage', level: 3 }).parentElement?.textContent).toContain(t.norm)
  const uses = within(within(article).getByRole('region', { name: 'Kommt vor in' })).getAllByRole('button').map((b) => b.textContent)
  expect(uses).toEqual(Object.values(GUIDES).filter((g) => (g.terms as readonly string[]).includes('ownShare')).map((g) => g.title))
  const related = within(within(article).getByRole('region', { name: 'Verwandte Begriffe' })).getAllByRole('button')
  expect(related.length).toBeGreaterThan(0)
  expect(related.length).toBeLessThanOrEqual(8)
  for (const r of related) expect(Object.values(GLOSSARY).find((x) => x.title === r.textContent)?.topic).toBe(t.topic)
})

test('ein verwandter Begriff wechselt den Begriff, mit Fokus auf seiner Überschrift', async () => {
  render(<Hilfe onFollow={() => {}} focusTerm={{ id: 'mea', seq: 1 }} />)
  await waitFor(() => expect(focusedTerm()).toBe('mea'))
  const related = within(screen.getByRole('region', { name: 'Verwandte Begriffe' })).getAllByRole('button')[0] ?? expect.fail('kein verwandter Begriff')
  const title = related.textContent
  fireEvent.click(related)
  await waitFor(() => expect(document.activeElement?.textContent).toBe(title))
  expect(document.activeElement?.tagName).toBe('H2')
  expect(within(termList()).getByRole('button', { name: title ?? '' }).getAttribute('aria-current')).toBe('true')
})

test('„Kommt vor in“ öffnet die Anleitung; „Zurück“ führt wieder zum Begriff, auf den Knopf', async () => {
  render(<Hilfe onFollow={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /^Alle von A bis Z/ }))
  await screen.findByRole('heading', { name: 'Lexikon', level: 1 })
  fireEvent.click(within(termList()).getByRole('button', { name: GLOSSARY.ownShare.title }))
  await waitFor(() => expect(focusedTerm()).toBe('ownShare'))
  fireEvent.click(within(screen.getByRole('region', { name: 'Kommt vor in' })).getByRole('button', { name: GUIDES.granny.title }))
  const heading = await screen.findByRole('heading', { name: GUIDES.granny.title, level: 1 })
  await waitFor(() => expect(document.activeElement).toBe(heading))
  fireEvent.click(screen.getByRole('button', { name: `← Zurück zu ${GLOSSARY.ownShare.title}` }))
  await screen.findByRole('heading', { name: GLOSSARY.ownShare.title, level: 2 })
  await waitFor(() => expect(document.activeElement?.textContent).toBe(GUIDES.granny.title))
  // Der Filter und die Wahl sind dieselben wie vorher
  expect(pressed()).toEqual([`Alle ${Object.keys(GLOSSARY).length} Begriffe`])
})

// Schmal (am Handy) zeigt die Ansicht entweder die Liste oder den Begriff; tw.css blendet nach `data-pane` aus
// (geprüft in uiRules.test.ts).
test('schmale Ansicht: erst die Liste, dann der Begriff mit „← Zur Liste“ zurück auf seinen Eintrag', async () => {
  render(<Hilfe onFollow={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /^Alle von A bis Z/ }))
  await screen.findByRole('heading', { name: 'Lexikon', level: 1 })
  const layout = document.querySelector('.lexicon-layout') ?? expect.fail('Lexikon fehlt')
  expect(layout.getAttribute('data-pane')).toBe('list')
  expect(screen.queryByRole('button', { name: '← Zur Liste' })).toBeNull()
  fireEvent.click(within(termList()).getByRole('button', { name: GLOSSARY.vacancy.title }))
  await waitFor(() => expect(focusedTerm()).toBe('vacancy'))
  expect(layout.getAttribute('data-pane')).toBe('term')
  fireEvent.click(screen.getByRole('button', { name: '← Zur Liste' }))
  expect(layout.getAttribute('data-pane')).toBe('list')
  await waitFor(() => expect(document.activeElement).toBe(within(termList()).getByRole('button', { name: GLOSSARY.vacancy.title })))
  // Der Eintrag ist nicht mehr als gewählt markiert
  expect(document.activeElement?.hasAttribute('aria-current')).toBe(false)
})

// #346 Schritt 6: „Mehr in ‚Hilfe & Begriffe‘ →“ aus einer Erklärung führt zum Begriff, auch bei laufender Suche und
// aus einer offenen Anleitung.
test('ein Sprung aus einer Begriffserklärung öffnet das Lexikon unter „Alle“ auf dem Begriff, Fokus auf seiner Überschrift', async () => {
  const done = vi.fn()
  const { rerender } = render(<Hilfe onFollow={() => {}} />)
  type('Garage')
  expect(document.getElementById('begriff-mea')).toBeNull()
  rerender(<Hilfe onFollow={() => {}} focusTerm={{ id: 'mea', seq: 1 }} onFocusTermDone={done} />)
  // Das Lexikon unter „Alle“, der Begriff gewählt und offen, der Fokus auf seiner Überschrift
  await waitFor(() => expect(focusedTerm()).toBe('mea'))
  expect(screen.getByRole('heading', { name: 'Lexikon', level: 1 })).toBeTruthy()
  expect(pressed()).toEqual([`Alle ${Object.keys(GLOSSARY).length} Begriffe`])
  expect(within(termList()).getByRole('button', { name: GLOSSARY.mea.title }).getAttribute('aria-current')).toBe('true')
  expect(done).toHaveBeenCalledTimes(1)
  // Ein zweiter Sprung, während das Lexikon offen ist, unter einem Thema: wieder „Alle“ und der neue Begriff
  fireEvent.click(within(filter()).getByRole('button', { name: /^Heizung/ }))
  rerender(<Hilfe onFollow={() => {}} focusTerm={{ id: 'reserveFund', seq: 2 }} onFocusTermDone={done} />)
  await waitFor(() => expect(focusedTerm()).toBe('reserveFund'))
  expect(pressed()).toEqual([`Alle ${Object.keys(GLOSSARY).length} Begriffe`])
  // Aus einer Anleitung heraus ebenso
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Pfad' })).getByRole('button', { name: 'Hilfe & Begriffe' }))
  type('')
  fireEvent.click(tile(GUIDES.condo.title))
  await screen.findByRole('heading', { name: GUIDES.condo.title, level: 1 })
  rerender(<Hilfe onFollow={() => {}} focusTerm={{ id: 'homeownersFee', seq: 3 }} onFocusTermDone={done} />)
  await waitFor(() => expect(focusedTerm()).toBe('homeownersFee'))
  expect(screen.getByRole('button', { name: '← Zurück zur Anleitung' })).toBeTruthy()
})

// Der echte Weg aus dem Formular: Erklärung öffnen, „Mehr in ‚Hilfe & Begriffe‘ →“, landet auf dem Begriff.
test('„Mehr in ‚Hilfe & Begriffe‘ →“ aus einer Erklärung landet im Lexikon auf dem Begriff', async () => {
  render(<WithHelp><Term id="noConnection" /></WithHelp>)
  fireEvent.click(screen.getByRole('button', { name: GLOSSARY.noConnection.title }))
  fireEvent.click(within(screen.getByRole('dialog', { name: GLOSSARY.noConnection.title })).getByRole('link', { name: 'Mehr in „Hilfe & Begriffe“ →' }))
  await waitFor(() => expect(focusedTerm()).toBe('noConnection'))
  expect(screen.getByRole('heading', { name: GLOSSARY.noConnection.title, level: 2 }).closest('article')?.textContent).toContain(GLOSSARY.noConnection.short)
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
  expect(await screen.findByRole('heading', { name: 'Lexikon', level: 1 })).toBeTruthy()
  expect(pressed()).toEqual([`Alle ${Object.keys(GLOSSARY).length} Begriffe`])
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
  await waitFor(() => expect(focusedTerm()).toBe('mea'))
})

// Durchsicht von #488, K4: Wer aus einer Anleitung zu einem Begriff springt (Sprung `focusTerm` aus einer Erklärung),
// kommt mit „Zurück“ in die Anleitung, und von dort über den Pfad zur Kachel.
test('„Zurück“ nach dem Sprung aus einer Anleitung führt in diese Anleitung', async () => {
  const { rerender } = render(<Hilfe onFollow={() => {}} />)
  fireEvent.click(tile(GUIDES.granny.title))
  await screen.findByRole('heading', { name: GUIDES.granny.title, level: 1 })
  rerender(<Hilfe onFollow={() => {}} focusTerm={{ id: 'granny', seq: 1 }} />)
  await waitFor(() => expect(focusedTerm()).toBe('granny'))
  fireEvent.click(screen.getByRole('button', { name: '← Zurück zur Anleitung' }))
  const heading = await screen.findByRole('heading', { name: GUIDES.granny.title, level: 1 })
  await waitFor(() => expect(document.activeElement).toBe(heading))
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Pfad' })).getByRole('button', { name: 'Hilfe & Begriffe' }))
  await waitFor(() => expect(document.activeElement).toBe(tile(GUIDES.granny.title)))
})

// Durchsicht von #488 Teil 3, M2: Breit bleibt der Fokus nach der Wahl in der Liste auf dem Eintrag; Shift+Tab aus dem
// Begriff führte sonst auf den letzten der Liste. Der Begriff rechts wird über eine Statusmeldung angesagt.
test('breit: nach der Wahl in der Liste bleibt der Fokus auf dem Eintrag, eine Statusmeldung nennt den Begriff', async () => {
  wide()
  render(<Hilfe onFollow={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /^Alle von A bis Z/ }))
  await screen.findByRole('heading', { name: 'Lexikon', level: 1 })
  const entry = within(termList()).getByRole('button', { name: GLOSSARY.mea.title })
  entry.focus()
  fireEvent.click(entry)
  await screen.findByRole('heading', { name: GLOSSARY.mea.title, level: 2 })
  await new Promise((r) => setTimeout(r, 0))
  expect(document.activeElement).toBe(entry)
  expect(entry.getAttribute('aria-current')).toBe('true')
  expect(screen.getByRole('status').textContent).toBe(`Rechts angezeigt: ${GLOSSARY.mea.title}`)
  // Ein verwandter Begriff und ein Sprung von außen setzen den Fokus weiter auf die Überschrift
  const related = within(screen.getByRole('region', { name: 'Verwandte Begriffe' })).getAllByRole('button')[0] ?? expect.fail('kein verwandter Begriff')
  fireEvent.click(related)
  await waitFor(() => expect(document.activeElement?.tagName).toBe('H2'))
})

test('schmal: nach der Wahl in der Liste geht der Fokus auf die Überschrift des Begriffs, ohne Statusmeldung', async () => {
  narrow()
  render(<Hilfe onFollow={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /^Alle von A bis Z/ }))
  await screen.findByRole('heading', { name: 'Lexikon', level: 1 })
  fireEvent.click(within(termList()).getByRole('button', { name: GLOSSARY.mea.title }))
  await waitFor(() => expect(focusedTerm()).toBe('mea'))
  expect(screen.getByRole('status').textContent).toBe('')
})

// Die Liste ist ein Halt der Tabulatortaste: Tab führt vom gewählten Eintrag in den Begriff, Pfeiltasten bewegen in ihr.
test('die Liste: ein Halt der Tabulatortaste auf dem gewählten Eintrag, Pfeiltasten, Pos1 und Ende bewegen den Fokus', async () => {
  wide()
  render(<Hilfe onFollow={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /^Alle von A bis Z/ }))
  await screen.findByRole('heading', { name: 'Lexikon', level: 1 })
  const buttons = () => within(termList()).getAllByRole('button')
  const tabbable = () => buttons().filter((b) => b.tabIndex === 0)
  // Ohne Wahl der erste
  expect(tabbable()).toEqual([buttons()[0]])
  const entry = within(termList()).getByRole('button', { name: GLOSSARY.mea.title })
  fireEvent.click(entry)
  await screen.findByRole('heading', { name: GLOSSARY.mea.title, level: 2 })
  expect(tabbable()).toEqual([entry])
  entry.focus()
  const i = buttons().indexOf(entry)
  fireEvent.keyDown(entry, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(buttons()[i + 1])
  fireEvent.keyDown(document.activeElement ?? entry, { key: 'ArrowUp' })
  fireEvent.keyDown(document.activeElement ?? entry, { key: 'ArrowUp' })
  expect(document.activeElement).toBe(buttons()[i - 1])
  fireEvent.keyDown(document.activeElement ?? entry, { key: 'End' })
  expect(document.activeElement).toBe(buttons().at(-1))
  fireEvent.keyDown(document.activeElement ?? entry, { key: 'Home' })
  expect(document.activeElement).toBe(buttons()[0])
  // Bewegen wählt nicht
  expect(entry.getAttribute('aria-current')).toBe('true')
})

// Durchsicht S2: Wird die Ansicht schmal (Zoom 200 %), während der Fokus in der Liste steht, verschwindet die Liste.
// Der Fokus geht dann auf die Überschrift des Begriffs statt auf body.
test('wird die Ansicht schmal, während der Fokus in der Liste steht, geht er auf die Überschrift des Begriffs', async () => {
  const observers: (() => void)[] = []
  vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { observers.push(cb) } observe() {} disconnect() {} unobserve() {} })
  wide()
  render(<Hilfe onFollow={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /^Alle von A bis Z/ }))
  await screen.findByRole('heading', { name: 'Lexikon', level: 1 })
  const entry = within(termList()).getByRole('button', { name: GLOSSARY.mea.title })
  entry.focus()
  fireEvent.click(entry)
  await screen.findByRole('heading', { name: GLOSSARY.mea.title, level: 2 })
  await new Promise((r) => setTimeout(r, 0))
  expect(document.activeElement).toBe(entry)
  narrow()
  expect(observers.length).toBeGreaterThan(0)
  for (const cb of observers) cb()
  expect(focusedTerm()).toBe('mea')
})

// Durchsicht S5: Begann der Weg nicht auf der Startansicht (die Anleitung kam über „Zurück zur Anleitung“ aus der Leiste
// des Fadens), führt der Pfad des Lexikons auf die Suche.
test('Pfad aus dem Lexikon, wenn der Weg in einer Anleitung begann: Fokus auf die Suche', async () => {
  render(<Hilfe onFollow={() => {}} openGuide={{ id: 'granny', step: 0, seq: 1 }} />)
  const guide = await waitFor(() => document.getElementById('anleitung-granny') ?? expect.fail('Anleitung fehlt'))
  fireEvent.click(within(within(guide).getByRole('region', { name: 'Begriffe' })).getByRole('button', { name: GLOSSARY.granny.title }))
  await waitFor(() => expect(focusedTerm()).toBe('granny'))
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Pfad' })).getByRole('button', { name: 'Hilfe & Begriffe' }))
  await waitFor(() => expect(document.activeElement).toBe(searchBox()))
})

// „Passend zu Ihrem Bestand“ (#488, Teil 4): Ein Mehrfamilienhaus mit sechs Wohnungen und einem Mieterwechsel 2025.
const lindenweg: Property = {
  id: 'p1', name: 'Lindenweg 12', kind: 'mfh', address: 'Lindenweg 12', landlordName: null, iban: null, paymentDeadlineDays: null,
  periodRules: { startMonth: 1, changes: [] },
}
const flats: Unit[] = Array.from({ length: 6 }, (_, i) => ({ id: `w${i}`, propertyId: 'p1', name: `Wohnung ${i + 1}`, areaM2: 60, participates: true }))
const lease = (id: string, unitId: string, start: string, end: string | null): Tenancy => ({
  id, unitId, tenantName: `Mieter ${id}`, persons: 1, personHistory: [{ from: start, persons: 1 }], start, end, prepayments: [], prepaymentOverrides: {}, baseRents: [],
})
const myStock: HelpStock = {
  properties: [lindenweg], property: lindenweg, units: flats,
  tenancies: [lease('a', 'w0', '2020-01-01', '2025-06-30'), lease('b', 'w0', '2025-07-01', null), ...flats.slice(1).map((u) => lease(`t${u.id}`, u.id, '2020-01-01', null))],
  plants: [], period: { from: '2025-01-01', to: '2025-12-31', label: '2025', calendar: true },
}
const suggestionList = () => {
  const h = screen.getByRole('heading', { name: 'Passend zu Ihrem Bestand', level: 2 })
  return within(h.nextElementSibling as HTMLElement)
}

test('„Passend zu Ihrem Bestand“: Kacheln wie die Anleitungen, oben der Grund, in der Rangfolge', () => {
  render(<Hilfe onFollow={() => {}} stock={myStock} />)
  const tiles = suggestionList().getAllByRole('button')
  expect(tiles.map((b) => b.querySelector('.text-accent-strong')?.textContent)).toEqual(['Weil 2025 ein Mieterwechsel erfasst ist', 'Weil Lindenweg 12 sechs Wohnungen hat'])
  expect(tiles[0]?.textContent).toContain(GUIDES.tenantChange.title)
  expect(tiles[0]?.textContent).toContain(`${GUIDES.tenantChange.steps.length} Schritte`)
  // Der Abschnitt steht zwischen Suche und Anleitungen; die Anleitung bleibt auch in ihrer Gruppe
  const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
  expect(headings.indexOf('Passend zu Ihrem Bestand')).toBeLessThan(headings.findIndex((t) => t?.startsWith('Anleitungen')))
  expect(tile(GUIDES.tenantChange.title)).toBeTruthy()
  // Beim Suchen tritt der Abschnitt wie die übrige Startansicht zurück
  type('Garage')
  expect(screen.queryByRole('heading', { name: 'Passend zu Ihrem Bestand' })).toBeNull()
})

test('ohne Bestand oder ohne Treffer entfällt der Abschnitt ganz', () => {
  const { rerender } = render(<Hilfe onFollow={() => {}} />)
  expect(screen.queryByRole('heading', { name: 'Passend zu Ihrem Bestand' })).toBeNull()
  rerender(<Hilfe onFollow={() => {}} stock={{ ...myStock, property: null, properties: [] }} />)
  expect(screen.queryByRole('heading', { name: 'Passend zu Ihrem Bestand' })).toBeNull()
  rerender(<Hilfe onFollow={() => {}} stock={{ ...myStock, units: flats.slice(0, 1), tenancies: [lease('x', 'w0', '2020-01-01', null)] }} />)
  expect(screen.queryByRole('heading', { name: 'Passend zu Ihrem Bestand' })).toBeNull()
})

test('ein Vorschlag öffnet die Anleitung; der Pfad führt zurück auf die Kachel des Vorschlags', async () => {
  render(<Hilfe onFollow={() => {}} stock={myStock} />)
  fireEvent.click(suggestionList().getAllByRole('button')[1]!)
  const heading = await screen.findByRole('heading', { name: GUIDES.multiFamily.title, level: 1 })
  await waitFor(() => expect(document.activeElement).toBe(heading))
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Pfad' })).getByRole('button', { name: 'Hilfe & Begriffe' }))
  await waitFor(() => expect(document.activeElement).toBe(suggestionList().getAllByRole('button')[1]))
  // Über die gewöhnliche Kachel geöffnet, führt der Pfad wie bisher auf diese
  fireEvent.click(tile(GUIDES.multiFamily.title))
  await screen.findByRole('heading', { name: GUIDES.multiFamily.title, level: 1 })
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Pfad' })).getByRole('button', { name: 'Hilfe & Begriffe' }))
  await waitFor(() => expect(document.activeElement).toBe(tile(GUIDES.multiFamily.title)))
})

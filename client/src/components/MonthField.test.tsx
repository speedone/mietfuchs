// @vitest-environment jsdom
// Das Monatsfeld (#287, #346 Schritt 5): Textfeld plus Raster als Popover. Was jsdom nicht rechnet (Top-Layer,
// Lage am Auslöser, Blatt am Handy), prüft der Browserlauf.
import { afterEach, expect, test } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import MonthField from './MonthField'
import Drawer from './Drawer'
import { UIProvider } from './feedback'
import { OpenFormScope } from '../testing/openForm'
import { press } from '../testing/keys'

afterEach(cleanup)

let last = ''
function Probe({ initial = '', error, required }: { initial?: string; error?: string; required?: boolean }) {
  const [value, setValue] = useState(initial)
  last = value
  return (
    <>
      <MonthField label="Kaltmiete gültig ab" value={value} onChange={setValue} today="2025-10-15" error={error} required={required} placeholder="ab Einzug" />
      <button type="button">Danach</button>
    </>
  )
}

const field = () => screen.getByRole('textbox', { name: 'Kaltmiete gültig ab' }) as HTMLInputElement
const gridButton = () => screen.getByRole('button', { name: 'Monat im Raster wählen' })
const popover = () => document.querySelector<HTMLElement>('[popover]')
const isOpen = () => popover()?.matches(':popover-open') ?? false

test('Monatsfeld: getippter Monat wird JJJJ-MM und beim Verlassen „März 2025“', () => {
  render(<Probe />)
  fireEvent.change(field(), { target: { value: '3.2025' } })
  expect(last).toBe('2025-03')
  expect(field().value).toBe('3.2025')
  fireEvent.blur(field())
  expect(field().value).toBe('März 2025')
  fireEvent.change(field(), { target: { value: 'Mrz 27' } })
  expect(last).toBe('2027-03')
})

test('Monatsfeld: ein gespeicherter Wert MM.JJJJ steht als „März 2025“ da, leer mit Platzhalter', () => {
  render(<Probe initial="03.2025" />)
  expect(field().value).toBe('März 2025')
  cleanup()
  render(<Probe />)
  expect(field().placeholder).toBe('ab Einzug')
})

test('Monatsfeld: ein ungültiger Text wird nicht verworfen, sondern ergibt beim Verlassen einen Feldfehler', () => {
  render(<Probe />)
  fireEvent.change(field(), { target: { value: '13.2025' } })
  expect(last).toBe('13.2025')
  expect(field().hasAttribute('aria-invalid')).toBe(false)
  fireEvent.blur(field())
  expect(field().value).toBe('13.2025')
  expect(field().getAttribute('aria-invalid')).toBe('true')
  expect(screen.getByRole('alert').textContent).toContain('Monat 13 gibt es nicht')
  // die Meldung beschreibt das Feld
  expect(field().getAttribute('aria-describedby')).toBeTruthy()
  // beim Weitertippen verschwindet sie
  fireEvent.change(field(), { target: { value: '12.2025' } })
  expect(field().hasAttribute('aria-invalid')).toBe(false)
  expect(last).toBe('2025-12')
})

test('Monatsfeld: die Meldung der Prüfung geht vor, Pflichtfeld trägt required', () => {
  render(<Probe error="Monat fehlt" required />)
  expect(field().getAttribute('aria-invalid')).toBe('true')
  expect(field().required).toBe(true)
  expect(screen.getByText('Monat fehlt')).toBeTruthy()
})

test('Monatsraster: öffnet mit Fokus auf dem gewählten Monat, Jahr wird angesagt', async () => {
  render(<Probe initial="2025-03" />)
  fireEvent.click(gridButton())
  expect(isOpen()).toBe(true)
  expect(gridButton().getAttribute('aria-expanded')).toBe('true')
  const pop = popover()
  if (!pop) throw new Error('kein Popover')
  expect(document.activeElement).toBe(within(pop).getByRole('gridcell', { name: 'Mär (März 2025)' }))
  expect(within(pop).getByRole('gridcell', { name: 'Mär (März 2025)' }).getAttribute('aria-selected')).toBe('true')
  expect(within(pop).getAllByRole('gridcell')).toHaveLength(12)
  expect(within(pop).getAllByRole('row')).toHaveLength(4)
  expect(within(pop).getByText('2025').getAttribute('aria-live')).toBe('polite')
  // das Raster ist nach dem Feld benannt
  expect(within(document.body).getByRole('dialog', { name: 'Kaltmiete gültig ab' })).toBe(pop)
})

test('Monatsraster: ohne Wert das Jahr von heute, Fokus auf dem laufenden Monat', () => {
  render(<Probe />)
  fireEvent.click(gridButton())
  expect((document.activeElement as HTMLElement | null)?.textContent).toBe('Okt (Oktober 2025)')
})

test('Monatsraster: Pfeile, Pos1/Ende, Bild auf/ab, Enter wählt und gibt den Fokus zurück', async () => {
  render(<Probe initial="2025-03" />)
  gridButton().focus()
  fireEvent.click(gridButton())
  press('ArrowRight')
  expect((document.activeElement as HTMLElement | null)?.textContent).toBe('Apr (April 2025)')
  press('ArrowDown')
  expect((document.activeElement as HTMLElement | null)?.textContent).toBe('Jul (Juli 2025)')
  press('End')
  expect((document.activeElement as HTMLElement | null)?.textContent).toBe('Sep (September 2025)')
  press('Home')
  expect((document.activeElement as HTMLElement | null)?.textContent).toBe('Jul (Juli 2025)')
  press('PageDown')
  expect((document.activeElement as HTMLElement | null)?.textContent).toBe('Jul (Juli 2026)')
  expect(screen.getByText('2026')).toBeTruthy()
  press('PageUp')
  press('PageUp')
  expect((document.activeElement as HTMLElement | null)?.textContent).toBe('Jul (Juli 2024)')
  press('Enter')
  await waitFor(() => expect(last).toBe('2024-07'))
  expect(field().value).toBe('Juli 2024')
  expect(isOpen()).toBe(false)
  await waitFor(() => expect(document.activeElement).toBe(gridButton()))
  expect(gridButton().getAttribute('aria-expanded')).toBe('false')
})

test('Monatsraster: ‹ › wechseln das Jahr, ein Klick wählt', () => {
  render(<Probe initial="2025-03" />)
  fireEvent.click(gridButton())
  fireEvent.click(screen.getByRole('button', { name: 'Nächstes Jahr' }))
  fireEvent.click(screen.getByRole('gridcell', { name: 'Mai (Mai 2026)' }))
  expect(last).toBe('2026-05')
  expect(isOpen()).toBe(false)
})

test('Monatsraster: Esc schließt nur das Raster, Fokus zurück, das Seitenfenster bleibt offen', async () => {
  function InDrawer() {
    const [value, setValue] = useState('')
    return (
      <Drawer open title="Mietverhältnis" value={value} onClose={() => {}}>
        <MonthField label="Kaltmiete gültig ab" value={value} onChange={setValue} today="2025-10-15" />
      </Drawer>
    )
  }
  render(<UIProvider><OpenFormScope><InDrawer /></OpenFormScope></UIProvider>)
  const drawer = screen.getByRole('dialog', { name: 'Mietverhältnis' }) as HTMLDialogElement
  gridButton().focus()
  fireEvent.click(gridButton())
  // das Raster hängt im Seitenfenster, nicht im Label: sonst wäre es inert bzw. nähme dem Feld den Namen
  expect(drawer.contains(popover())).toBe(true)
  expect(field().closest('label')?.contains(popover())).toBe(false)
  fireEvent.click(screen.getByRole('gridcell', { name: 'Okt (Oktober 2025)' }))
  await waitFor(() => expect(document.activeElement).toBe(gridButton()))
  fireEvent.click(gridButton())
  press('Escape')
  await act(async () => {})
  expect(isOpen()).toBe(false)
  await waitFor(() => expect(document.activeElement).toBe(gridButton()))
  // Esc galt dem Raster: keine Rückfrage, das Fenster ist offen
  expect(drawer.open).toBe(true)
  expect(screen.queryByRole('alertdialog')).toBeNull()
})

test('Monatsraster: Tab am Ende schließt und geht an den Knopf zurück', async () => {
  render(<Probe initial="2025-03" />)
  gridButton().focus()
  fireEvent.click(gridButton())
  press('Tab')
  expect(isOpen()).toBe(false)
  await waitFor(() => expect(document.activeElement).toBe(gridButton()))
})

test('Monatsraster: ein zweiter Klick auf ▦ schließt', async () => {
  render(<Probe />)
  fireEvent.pointerDown(gridButton())
  fireEvent.click(gridButton())
  expect(isOpen()).toBe(true)
  fireEvent.pointerDown(gridButton())
  fireEvent.click(gridButton())
  expect(isOpen()).toBe(false)
})

// WCAG 2.5.3 (axe label-content-name-mismatch, ab axe 4.14 geprüft): Der sichtbare Text eines Monats im Raster
// steht am Anfang seines Namens, der volle Monat mit Jahr folgt unsichtbar, wie bei DraftActions.
test('Monatsraster: der Name beginnt mit dem sichtbaren Kürzel', () => {
  render(<Probe initial="2025-03" />)
  fireEvent.click(screen.getByRole('button', { name: 'Monat im Raster wählen' }))
  for (const cell of screen.getAllByRole('gridcell')) {
    const visible = [...cell.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join('').trim()
    expect(cell.getAttribute('aria-label')).toBeNull()
    expect(cell.textContent?.startsWith(visible)).toBe(true)
  }
  expect(screen.getByRole('gridcell', { name: 'Mär (März 2025)' })).toBeTruthy()
})

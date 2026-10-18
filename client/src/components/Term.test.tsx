// @vitest-environment jsdom
// Ein Fachbegriff im Formular (#113; #346 Schritt 6): auf Antippen die Erklärung als Popover, Esc schließt und gibt
// den Fokus zurück. In einem Label darf er dem Eingabefeld die Beschriftung nicht nehmen.
import { afterEach, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import Term, { TermHelp } from './Term'
import Drawer from './Drawer'
import { UIProvider } from './feedback'
import { OpenFormScope } from '../testing/openForm'
import { press } from '../testing/keys'

afterEach(cleanup)

const isOpen = (el: HTMLElement) => el.matches(':popover-open')

test('Antippen zeigt Erklärung und Beispiel als Popover, Esc schließt und gibt den Fokus zurück', async () => {
  render(<p><Term id="mea">Miteigentumsanteile</Term></p>)
  const trigger = screen.getByRole('button', { name: 'Miteigentumsanteile' })
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  trigger.focus()
  fireEvent.click(trigger)
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  const pop = screen.getByRole('dialog', { name: 'Miteigentumsanteile (MEA)' })
  expect(isOpen(pop)).toBe(true)
  expect(trigger.getAttribute('aria-controls')).toBe(pop.id)
  // höchstens zwei Absätze: Erklärung und Beispiel; Rechtsgrundlage und „Brauche ich das?“ stehen in der Hilfe
  expect(within(pop).getByText(/Der Anteil einer Eigentumswohnung am gemeinsamen Eigentum/)).toBeTruthy()
  expect(within(pop).getByText(/85 von 1\.000 MEA/)).toBeTruthy()
  expect(within(pop).queryByText(/Brauche ich das\?/)).toBeNull()
  expect(within(pop).queryByText(/Rechtsgrundlage/)).toBeNull()
  // der Fokus geht in die Erklärung, damit Vorleser sie hören
  expect(document.activeElement).toBe(pop)
  press('Escape')
  expect(isOpen(pop)).toBe(false)
  await waitFor(() => expect(document.activeElement).toBe(trigger))
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  fireEvent.keyDown(trigger, { key: 'Enter' })
  expect(isOpen(screen.getByRole('dialog', { name: 'Miteigentumsanteile (MEA)' }))).toBe(true)
})

test('in einem Label bleibt die Beschriftung der Name des Felds, und der Klick fokussiert es nicht', () => {
  render(<label>Wert in <Term id="mea">MEA</Term><input /></label>)
  const input = screen.getByRole('textbox')
  // Wäre der Begriff ein <button> oder stünde das „?“ im Text, gehörte das Label nicht mehr (nur) zum Feld.
  expect(screen.getByRole('textbox', { name: 'Wert in MEA' })).toBe(input)
  expect(screen.getByLabelText('Wert in MEA')).toBe(input)
  fireEvent.click(screen.getByRole('button', { name: 'MEA' }))
  expect(document.activeElement).not.toBe(input)
  const pop = screen.getByRole('dialog', { name: 'Miteigentumsanteile (MEA)' })
  // Die Erklärung hängt nicht im Label: Sonst gehörte ihr Text, solange sie offen ist, zum Namen des Felds.
  expect(input.closest('label')?.contains(pop)).toBe(false)
  expect(screen.getByRole('textbox', { name: 'Wert in MEA' })).toBe(input)
})

test('ein unbekannter Begriff stürzt nicht ab, sondern zeigt nur seinen Text', () => {
  // Eine abgeschlossene Abrechnung friert ihre Hinweise samt Begriffen ein. Wird ein Begriff
  // später umbenannt, muss die Seite dieses Jahres trotzdem erscheinen.
  // @ts-expect-error: absichtlich ein Begriff, den es nicht gibt
  render(<p><Term id="gibtEsNichtMehr" /></p>)
  expect(screen.getByText('gibtEsNichtMehr')).toBeTruthy()
})

test('„Mehr in ‚Hilfe & Begriffe‘ →“ springt über die App zum Begriff und schließt die Erklärung', async () => {
  const help = vi.fn()
  render(<TermHelp.Provider value={help}><p><Term id="mea">MEA</Term></p></TermHelp.Provider>)
  fireEvent.click(screen.getByRole('button', { name: 'MEA' }))
  const pop = screen.getByRole('dialog', { name: 'Miteigentumsanteile (MEA)' })
  const more = within(pop).getByRole('link', { name: 'Mehr in „Hilfe & Begriffe“ →' })
  expect(more.getAttribute('href')).toBe('#begriff-mea')
  fireEvent.click(more)
  expect(help).toHaveBeenCalledWith('mea')
  expect(isOpen(pop)).toBe(false)
  cleanup()
  // ohne App (Druck, Tests) fehlt nur der Verweis
  render(<p><Term id="mea">MEA</Term></p>)
  fireEvent.click(screen.getByRole('button', { name: 'MEA' }))
  expect(screen.queryByRole('link', { name: /Mehr in/ })).toBeNull()
})

test('ein zweiter Begriff schließt den ersten, Tab am Ende schließt und geht zum Begriff zurück', async () => {
  render(<p><Term id="mea">MEA</Term> und <Term id="granny">Einliegerwohnung</Term></p>)
  const first = screen.getByRole('button', { name: 'MEA' })
  fireEvent.click(first)
  fireEvent.click(screen.getByRole('button', { name: 'Einliegerwohnung' }))
  const pops = [...document.querySelectorAll<HTMLElement>('[popover]')]
  expect(pops.map(isOpen)).toEqual([false, true])
  cleanup()
  render(<TermHelp.Provider value={() => {}}><p><Term id="mea">MEA</Term></p></TermHelp.Provider>)
  const trigger = screen.getByRole('button', { name: 'MEA' })
  trigger.focus()
  fireEvent.click(trigger)
  // im Browser führt Tab vom Popover zum Verweis darin; von dort weiter schließt es
  screen.getByRole('link', { name: 'Mehr in „Hilfe & Begriffe“ →' }).focus()
  press('Tab')
  await waitFor(() => expect(document.activeElement).toBe(trigger))
  expect(isOpen(document.querySelector<HTMLElement>('[popover]') as HTMLElement)).toBe(false)
})

test('im Seitenfenster: die Erklärung hängt im Fenster, Esc schließt nur sie', async () => {
  function InDrawer() {
    const [value, setValue] = useState('')
    return (
      <Drawer open title="Kosten" value={value} onClose={() => {}}>
        <label>Verteilt nach <Term id="mea">MEA</Term><input value={value} onChange={(e) => setValue(e.target.value)} /></label>
      </Drawer>
    )
  }
  render(<UIProvider><OpenFormScope><InDrawer /></OpenFormScope></UIProvider>)
  const drawer = screen.getByRole('dialog', { name: 'Kosten' }) as HTMLDialogElement
  fireEvent.change(screen.getByRole('textbox', { name: 'Verteilt nach MEA' }), { target: { value: 'x' } })
  const trigger = screen.getByRole('button', { name: 'MEA' })
  trigger.focus()
  fireEvent.click(trigger)
  const pop = screen.getByRole('dialog', { name: 'Miteigentumsanteile (MEA)' })
  expect(drawer.contains(pop)).toBe(true)
  press('Escape')
  await act(async () => {})
  expect(isOpen(pop)).toBe(false)
  expect(drawer.open).toBe(true)
  // trotz Änderung keine Rückfrage: Esc galt der Erklärung
  expect(screen.queryByRole('alertdialog')).toBeNull()
  await waitFor(() => expect(document.activeElement).toBe(trigger))
})

// UI-Durchsicht H2: Im Häkchen-Label wurde die Erklärung zur Buchstabensäule. Jetzt steht sie außerhalb.
test('im Häkchen-Label: der Klick ändert das Häkchen nicht, die Erklärung steht außerhalb des Labels', () => {
  render(<label className="checkline"><input type="checkbox" /> Die Kosten der <Term id="mea">MEA</Term> zählen</label>)
  const box = screen.getByRole('checkbox', { name: 'Die Kosten der MEA zählen' }) as HTMLInputElement
  fireEvent.click(screen.getByRole('button', { name: 'MEA' }))
  expect(box.checked).toBe(false)
  const pop = screen.getByRole('dialog', { name: 'Miteigentumsanteile (MEA)' })
  expect(box.closest('label')?.contains(pop)).toBe(false)
})

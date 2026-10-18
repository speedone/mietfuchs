// @vitest-environment jsdom
// Das Seitenfenster (#346, Schritt 2): ein `<dialog>` mit `showModal()`. Schließen mit Änderungen fragt
// „Änderungen verwerfen?“ (Startfokus „Abbrechen“), ohne Änderungen schließt es sofort; Esc, ✕, Klick
// daneben und „Abbrechen“ gehen denselben Weg. Was jsdom nicht rechnet (Top-Layer, inerter Hintergrund),
// prüft der Browserlauf.
import { afterEach, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode, useEffect, useRef, useState } from 'react'
import Drawer from './Drawer'
import { UIProvider, useToast } from './feedback'
import { OpenFormScope, hasOpenForm } from '../testing/openForm'
import { press } from '../testing/keys'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

// Ein Formular wie auf den Seiten: der Stand im Zustand, das Fenster nur, solange er nicht `null` ist.
function Formular({ initial = '', onSaved, nested = false }: { initial?: string; onSaved?: () => void; nested?: boolean }) {
  const [form, setForm] = useState<{ amount: string } | null>(null)
  return (
    <>
      <button type="button" onClick={() => setForm({ amount: initial })}>Zahlung erfassen</button>
      <button type="button">Draußen</button>
      {form && (
        <Drawer open title="Zahlung erfassen" value={form} onClose={() => setForm(null)} onSubmit={() => { onSaved?.(); setForm(null) }}
          actions={<button type="button" className="btn" onClick={() => { onSaved?.(); setForm(null) }}>Speichern</button>}>
          <label>Betrag <input value={form.amount} onChange={(e) => setForm({ amount: e.target.value })} /></label>
          {nested && <Innen />}
        </Drawer>
      )}
    </>
  )
}

// Ein Dialog im Seitenfenster (etwa ein Blatt eines Bausteins): sein `close` erreicht über React auch das Fenster.
function Innen() {
  const ref = useRef<HTMLDialogElement>(null)
  const [shown, setShown] = useState(false)
  useEffect(() => { if (shown) ref.current?.showModal() }, [shown])
  return (
    <>
      <button type="button" onClick={() => setShown(true)}>Innen öffnen</button>
      <dialog ref={ref} aria-label="Innen" onClose={() => setShown(false)}>
        <button type="button" onClick={() => ref.current?.close()}>Weiter bearbeiten</button>
      </dialog>
    </>
  )
}

const shell = (ui = <Formular />) => render(<UIProvider><OpenFormScope>{ui}</OpenFormScope></UIProvider>)
const openIt = async () => {
  const trigger = screen.getByRole('button', { name: 'Zahlung erfassen' })
  trigger.focus()
  fireEvent.click(trigger)
  const drawer = await screen.findByRole('dialog', { name: 'Zahlung erfassen' })
  return { trigger, drawer: drawer as HTMLDialogElement }
}
const type = (text: string) => fireEvent.change(screen.getByLabelText('Betrag'), { target: { value: text } })
const ask = () => screen.queryByRole('alertdialog', { name: 'Änderungen verwerfen?' })

test('ein modaler <dialog> mit Titel als Überschrift; das erste Feld hat den Fokus', async () => {
  shell()
  const { drawer } = await openIt()
  expect(drawer.tagName).toBe('DIALOG')
  expect(drawer.open).toBe(true)
  expect(within(drawer).getByRole('heading', { level: 2, name: 'Zahlung erfassen' })).toBeTruthy()
  expect(document.activeElement).toBe(screen.getByLabelText('Betrag'))
  // „Abbrechen“ und der Hinweis stehen im Fuß, aus dem Baustein
  expect(within(drawer).getByRole('button', { name: 'Abbrechen' })).toBeTruthy()
  expect(drawer.textContent).toMatch(/Strg\+S speichert · Esc schließt/)
})

test('ohne Änderung schließen Esc, ✕, Abbrechen und ein Klick daneben sofort, und der Fokus geht zurück', async () => {
  shell()
  for (const how of ['esc', 'x', 'cancel', 'outside'] as const) {
    const { trigger, drawer } = await openIt()
    if (how === 'esc') press('Escape')
    if (how === 'x') fireEvent.click(within(drawer).getByRole('button', { name: 'Schließen' }))
    if (how === 'cancel') fireEvent.click(within(drawer).getByRole('button', { name: 'Abbrechen' }))
    if (how === 'outside') { fireEvent.mouseDown(drawer); fireEvent.click(drawer) }
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(ask()).toBeNull()
    expect(document.activeElement).toBe(trigger)
  }
})

test('ein Klick in den Inhalt schließt nicht, auch wenn er daneben endet', async () => {
  shell()
  const { drawer } = await openIt()
  fireEvent.click(screen.getByLabelText('Betrag'))
  fireEvent.mouseDown(screen.getByLabelText('Betrag'))
  fireEvent.click(drawer)
  await act(async () => {})
  expect(screen.getByRole('dialog', { name: 'Zahlung erfassen' })).toBeTruthy()
})

test('mit Änderung fragt Esc; Startfokus auf Abbrechen, Enter dort lässt das Fenster mit der Eingabe offen', async () => {
  shell()
  await openIt()
  type('11,11')
  press('Escape')
  const question = await screen.findByRole('alertdialog', { name: 'Änderungen verwerfen?' })
  expect(document.activeElement).toBe(within(question).getByRole('button', { name: 'Abbrechen' }))
  press('Enter')
  await waitFor(() => expect(ask()).toBeNull())
  expect((screen.getByLabelText('Betrag') as HTMLInputElement).value).toBe('11,11')
  // Der Fokus steht wieder im Fenster, wo er war
  expect(document.activeElement).toBe(screen.getByLabelText('Betrag'))
})

test('mit Änderung fragen auch ✕, Abbrechen und ein Klick daneben; Verwerfen schließt, Fokus zurück an den Auslöser', async () => {
  shell()
  for (const how of ['x', 'cancel', 'outside'] as const) {
    const { trigger, drawer } = await openIt()
    type('5')
    if (how === 'x') fireEvent.click(within(drawer).getByRole('button', { name: 'Schließen' }))
    if (how === 'cancel') fireEvent.click(within(drawer).getByRole('button', { name: 'Abbrechen' }))
    if (how === 'outside') { fireEvent.mouseDown(drawer); fireEvent.click(drawer) }
    const question = await screen.findByRole('alertdialog', { name: 'Änderungen verwerfen?' })
    expect(drawer.open).toBe(true)
    press('Tab')
    expect(document.activeElement?.textContent).toBe('Verwerfen')
    press('Enter')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(question.isConnected).toBe(false)
    expect(document.activeElement).toBe(trigger)
  }
})

test('zurückgesetzt gilt nicht als Änderung', async () => {
  shell(<Formular initial="7" />)
  await openIt()
  type('8')
  type('7')
  press('Escape')
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(ask()).toBeNull()
})

test('Esc in der Rückfrage schließt nur die Rückfrage, nicht das Fenster', async () => {
  shell()
  const { drawer } = await openIt()
  type('3')
  press('Escape')
  await screen.findByRole('alertdialog')
  press('Escape')
  await waitFor(() => expect(ask()).toBeNull())
  await act(async () => {})
  expect(drawer.open).toBe(true)
  expect(drawer.isConnected).toBe(true)
  // Ein drittes Esc fragt wieder
  screen.getByLabelText('Betrag').focus()
  press('Escape')
  expect(await screen.findByRole('alertdialog')).toBeTruthy()
})

test('ein verschachtelter Dialog schließt mit seinem close nicht das Fenster', async () => {
  shell(<Formular nested />)
  const { drawer } = await openIt()
  fireEvent.click(screen.getByRole('button', { name: 'Innen öffnen' }))
  const inner = await screen.findByRole('dialog', { name: 'Innen' }) as HTMLDialogElement
  await waitFor(() => expect(inner.open).toBe(true))
  fireEvent.click(within(inner).getByRole('button', { name: 'Weiter bearbeiten' }))
  // `close` kommt wie im Browser als eigene Aufgabe
  await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
  expect(inner.open).toBe(false)
  expect(drawer.open).toBe(true)
  expect(screen.getByRole('dialog', { name: 'Zahlung erfassen' })).toBe(drawer)
  // Auch sein cancel (Esc im inneren Dialog) nicht
  fireEvent.click(screen.getByRole('button', { name: 'Innen öffnen' }))
  await waitFor(() => expect(inner.open).toBe(true))
  within(inner).getByRole('button', { name: 'Weiter bearbeiten' }).focus()
  fireEvent(inner, new Event('cancel', { cancelable: true }))
  await act(async () => {})
  expect(drawer.open).toBe(true)
})

// Durchsicht M2: Tab lenkt der Browser (der Rest ist inert); das Fenster verhindert Tab nie selbst. Ein
// eigener Ring sperrte die Tastatur vor einem geschlossenen <details> ein.
test('Tab lenkt das Fenster nicht selbst; ein Feld hinter einem <details> ist erreichbar', async () => {
  function MitDetails() {
    return (
      <Drawer open title="Zahlung" value={null} onClose={() => {}} actions={<button type="button">Speichern</button>}>
        <label>Betrag <input /></label>
        <details><summary>Weitere Angaben</summary><label>Bezahlt am <input /></label></details>
        <label>Notiz <input /></label>
      </Drawer>
    )
  }
  render(<UIProvider><MitDetails /></UIProvider>)
  const drawer = screen.getByRole('dialog', { name: 'Zahlung' })
  const seen: string[] = []
  for (let i = 0; i < 8; i++) {
    expect(fireEvent.keyDown(document.activeElement as Element, { key: 'Tab' })).toBe(true)
    press('Tab')
    expect(drawer.contains(document.activeElement)).toBe(true)
    seen.push(document.activeElement?.textContent || (document.activeElement?.closest('label')?.textContent ?? '').trim())
  }
  expect(seen).toContain('Weitere Angaben')
  expect(seen).toContain('Notiz')
  expect(seen).toContain('Speichern')
})

test('Strg+S speichert ohne Rückfrage', async () => {
  const saved = vi.fn()
  shell(<Formular onSaved={saved} />)
  await openIt()
  type('9')
  press('s', { ctrlKey: true })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(saved).toHaveBeenCalledTimes(1)
  expect(ask()).toBeNull()
})

test('nur ein geändertes Fenster meldet sich als offenes Formular an (#356)', async () => {
  shell()
  await openIt()
  expect(hasOpenForm()).toBe(false)
  type('1')
  await waitFor(() => expect(hasOpenForm()).toBe(true))
  type('')
  await waitFor(() => expect(hasOpenForm()).toBe(false))
})

test('Vorgaben, die das Formular nach dem Öffnen selbst nachträgt, gelten nicht als Änderung', async () => {
  function Nachladend() {
    const [form, setForm] = useState<{ amount: string } | null>(null)
    useEffect(() => { if (form && form.amount === '') setForm({ amount: '850,00' }) }, [form])
    return (
      <>
        <button type="button" onClick={() => setForm({ amount: '' })}>Zahlung erfassen</button>
        {form && <Drawer open title="Zahlung erfassen" value={form} onClose={() => setForm(null)}><label>Betrag <input value={form.amount} onChange={(e) => setForm({ amount: e.target.value })} /></label></Drawer>}
      </>
    )
  }
  shell(<Nachladend />)
  await openIt()
  await waitFor(() => expect((screen.getByLabelText('Betrag') as HTMLInputElement).value).toBe('850,00'))
  press('Escape')
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(ask()).toBeNull()
})

test('ein offener Begriff nimmt Esc für sich, das Fenster bleibt', async () => {
  const closed = vi.fn()
  function MitEsc() {
    return (
      <Drawer open title="Zahlung erfassen" value={null} onClose={closed}>
        <span role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Escape') e.preventDefault() }}>Begriff</span>
      </Drawer>
    )
  }
  shell(<MitEsc />)
  const term = await screen.findByRole('button', { name: 'Begriff' })
  term.focus()
  press('Escape')
  await act(async () => {})
  expect(closed).not.toHaveBeenCalled()
  expect(ask()).toBeNull()
})

// Durchsicht S5: Esc, das ein offenes Popover im Fenster schließt (Begriff und Monatsraster ab Schritt 5 und
// 6), gilt nicht dem Fenster.
test('Esc mit offenem Popover im Fenster schließt nur das Popover', async () => {
  const closed = vi.fn()
  function MitPopover() {
    const ref = useRef<HTMLDivElement>(null)
    return (
      <Drawer open title="Zahlung" value={null} onClose={closed}>
        <button type="button" onClick={() => ref.current?.showPopover()}>Erklärung</button>
        <div ref={ref} popover="auto">Text</div>
      </Drawer>
    )
  }
  render(<UIProvider><MitPopover /></UIProvider>)
  const button = screen.getByRole('button', { name: 'Erklärung' })
  button.focus()
  fireEvent.click(button)
  press('Escape')
  await act(async () => {})
  expect(closed).not.toHaveBeenCalled()
  const popover = document.querySelector('[popover]') as HTMLElement
  expect(popover.matches(':popover-open')).toBe(false)
  // Danach gilt Esc wieder dem Fenster
  press('Escape')
  await waitFor(() => expect(closed).toHaveBeenCalledTimes(1))
})

// Durchsicht M1: Unter StrictMode baut React den Effekt einmal ab und wieder auf. Das `close` aus dem Abbau
// kommt wie im Browser als eigene Aufgabe an, wenn das Fenster schon wieder offen ist; es schloss das Fenster.
test('unter StrictMode bleibt das Fenster nach dem Öffnen offen', async () => {
  render(<StrictMode><UIProvider><OpenFormScope><Formular /></OpenFormScope></UIProvider></StrictMode>)
  const { drawer } = await openIt()
  await new Promise((r) => setTimeout(r, 20))
  expect(drawer.isConnected).toBe(true)
  expect(drawer.open).toBe(true)
  type('4')
  press('Escape')
  expect(await screen.findByRole('alertdialog', { name: 'Änderungen verwerfen?' })).toBeTruthy()
})

// Schließt der Browser das Fenster selbst (eine Rückgeste, die sich nicht abbrechen lässt), öffnet es mit
// Änderungen wieder und fragt; ohne Änderungen ist es zu.
test('vom Browser geschlossen: mit Änderung wieder offen und gefragt, ohne Änderung zu', async () => {
  shell()
  let { drawer } = await openIt()
  type('6')
  act(() => { drawer.close() })
  expect(await screen.findByRole('alertdialog', { name: 'Änderungen verwerfen?' })).toBeTruthy()
  expect(drawer.open).toBe(true)
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Verwerfen' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  ;({ drawer } = await openIt())
  act(() => { drawer.close() })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(ask()).toBeNull()
})

// Ein eingehängtes Fenster, das nur `open` wechselt (Objekt anlegen): Beim nächsten Öffnen zählt der neue
// Stand, nicht der vom letzten Mal.
test('wieder geöffnet zählt der neue Stand, nicht der vom letzten Öffnen', async () => {
  function Eingehaengt() {
    const [open, setOpen] = useState(false)
    const [round, setRound] = useState(0)
    const [form, setForm] = useState({ amount: '' })
    return (
      <>
        <button type="button" onClick={() => { setForm({ amount: round === 0 ? '' : 'Vorgabe' }); setRound(round + 1); setOpen(true) }}>Zahlung erfassen</button>
        <Drawer open={open} title="Zahlung erfassen" value={form} onClose={() => setOpen(false)}>
          <label>Betrag <input value={form.amount} onChange={(e) => setForm({ amount: e.target.value })} /></label>
        </Drawer>
      </>
    )
  }
  shell(<Eingehaengt />)
  await openIt()
  type('1')
  type('')
  press('Escape')
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await openIt()
  expect((screen.getByLabelText('Betrag') as HTMLInputElement).value).toBe('Vorgabe')
  press('Escape')
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(ask()).toBeNull()
})

// Aus #352: Der Fokus nimmt das erste Feld nach 60 ms nur, wenn er inzwischen nicht woanders hingesetzt wurde.
test('ein inzwischen woanders gesetzter Fokus bleibt, wo er ist', () => {
  vi.useFakeTimers()
  render(
    <UIProvider>
      <Drawer open title="Zahlung" value={null} onClose={() => {}}>
        <button type="button">Begriff</button>
        <label>Betrag <input /></label>
      </Drawer>
    </UIProvider>,
  )
  expect(document.activeElement).toBe(screen.getByLabelText('Betrag'))
  const other = screen.getByRole('button', { name: 'Begriff' })
  act(() => { other.focus() })
  act(() => { vi.advanceTimersByTime(60) })
  expect(document.activeElement).toBe(other)
})

test('ein erst nach dem Öffnen gezeichnetes Feld bekommt den Fokus nach 60 ms', () => {
  vi.useFakeTimers()
  function Spaet() {
    const [ready, setReady] = useState(false)
    useEffect(() => { const t = setTimeout(() => setReady(true), 10); return () => clearTimeout(t) }, [])
    return <Drawer open title="Zahlung" value={null} onClose={() => {}}>{ready && <label>Betrag <input /></label>}</Drawer>
  }
  render(<UIProvider><Spaet /></UIProvider>)
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Schließen')
  act(() => { vi.advanceTimersByTime(10) })
  act(() => { vi.advanceTimersByTime(50) })
  expect(document.activeElement).toBe(screen.getByLabelText('Betrag'))
})

test('solange es arbeitet, schließt es auf keinem Weg', async () => {
  const closed = vi.fn()
  render(<UIProvider><Drawer open busy title="Zahlung" value={null} onClose={closed}><label>Betrag <input /></label></Drawer></UIProvider>)
  const drawer = screen.getByRole('dialog', { name: 'Zahlung' })
  press('Escape')
  fireEvent.mouseDown(drawer); fireEvent.click(drawer)
  await act(async () => {})
  expect(closed).not.toHaveBeenCalled()
  expect((within(drawer).getByRole('button', { name: 'Abbrechen' }) as HTMLButtonElement).disabled).toBe(true)
})

// Durchsicht S7: Eine Mitteilung bei offenem Seitenfenster steht für Vorleser im Fenster (der Rest ist inert).
test('eine Mitteilung bei offenem Seitenfenster wird im Fenster angesagt', async () => {
  function MitMeldung() {
    const toast = useToast()
    return <Drawer open title="Zahlung" value={null} onClose={() => {}}><button type="button" onClick={() => toast('Beleg hochgeladen.')}>Hochladen</button></Drawer>
  }
  render(<UIProvider><MitMeldung /></UIProvider>)
  const drawer = screen.getByRole('dialog', { name: 'Zahlung' })
  fireEvent.click(within(drawer).getByRole('button', { name: 'Hochladen' }))
  await waitFor(() => expect(within(drawer).getByRole('status').textContent).toBe('Beleg hochgeladen.'))
})

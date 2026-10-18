// @vitest-environment jsdom
// Ein Toast räumt sich nach ein paar Sekunden selbst weg. Wird die Oberfläche vorher abgebaut,
// darf dieser Zeitgeber nicht mehr laufen: Am Ende eines Komponententests träfe er auf eine
// abgebaute Testumgebung („window is not defined“), und der ganze Lauf scheiterte, obwohl jeder
// Test grün war.
import { afterEach, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useEffect, useRef, useState } from 'react'
import { UIProvider, useConfirm, useToast } from './feedback'
import { press } from '../testing/keys'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function Trigger() {
  const toast = useToast()
  return <button onClick={() => toast('Gespeichert.')}>Speichern</button>
}

test('ein Toast verschwindet nach seiner Zeit', () => {
  vi.useFakeTimers()
  render(<UIProvider><Trigger /></UIProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  expect(screen.getByText('Gespeichert.')).toBeTruthy()
  act(() => { vi.advanceTimersByTime(3200) })
  expect(screen.queryByText('Gespeichert.')).toBeNull()
})

test('beim Abbauen läuft kein Zeitgeber eines Toasts weiter', () => {
  vi.useFakeTimers()
  const { unmount } = render(<UIProvider><Trigger /></UIProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  expect(vi.getTimerCount()).toBeGreaterThan(0)
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})

function Ask() {
  const confirm = useConfirm()
  return <button onClick={() => void confirm({ confirmLabel: 'Weiter', title: 'Rechnung aufteilen?', message: 'Zwei Teile.' })}>Fragen</button>
}

test('Laienprobe (Kleinigkeit): die Rückfrage ist ein Dialog mit Namen', async () => {
  render(<UIProvider><Ask /></UIProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Fragen' }))
  expect(await screen.findByRole('alertdialog', { name: 'Rechnung aufteilen?' })).toBeTruthy()
})

// Rückfrage zur Schätzung (Heizung PR 7, Durchsicht von #233): Abwarten ist die Vorgabe; Enter wählt es
// und der Fokus liegt darauf, nicht auf „Mit Schätzung abschließen“.
function Frage({ onAnswer }: { onAnswer: (ok: boolean) => void }) {
  const confirm = useConfirm()
  return <button onClick={() => void confirm({ title: 'Rechnung fehlt', confirmLabel: 'Mit Schätzung', cancelLabel: 'Abwarten', alternativeLabel: 'Ohne Schätzung', defaultChoice: 'cancel' }).then(onAnswer)}>Fragen</button>
}

test('Vorgabe Abbrechen: Fokus auf Abwarten, Enter bestätigt nicht', async () => {
  const answers: boolean[] = []
  render(<UIProvider><Frage onAnswer={(ok) => answers.push(ok)} /></UIProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Fragen' }))
  expect(document.activeElement?.textContent).toBe('Abwarten')
  press('Enter')
  await act(async () => {})
  expect(answers).toEqual([false])
})

// Durchsicht K1 (#341): Enter auf einem anderen bedienbaren Element im Dialog (etwa einem Begriff,
// span mit role="button") geht an dieses Element und schließt die Rückfrage nicht.
function MitBegriff({ onKey }: { onKey: () => void }) {
  const confirm = useConfirm()
  const message = <span role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onKey() }}>Begriff</span>
  return <button onClick={() => void confirm({ confirmLabel: 'Weiter', title: 'Mit Begriff', message })}>Fragen</button>
}

test('Enter auf einem Begriff in der Rückfrage erreicht den Begriff', async () => {
  const pressed: string[] = []
  render(<UIProvider><MitBegriff onKey={() => pressed.push('Begriff')} /></UIProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Fragen' }))
  const term = await screen.findByRole('button', { name: 'Begriff' })
  term.focus()
  fireEvent.keyDown(term, { key: 'Enter' })
  await act(async () => {})
  expect(pressed).toEqual(['Begriff'])
  expect(screen.getByRole('alertdialog')).toBeTruthy()
})

// #346, Schritt 1: Die Rückfrage ist ein modaler `<dialog role="alertdialog">`, benannt durch den Titel und
// beschrieben durch die Nachricht. Sie liegt im Top-Layer, auch über einem anderen modalen Dialog.
function Loeschen({ onAnswer }: { onAnswer: (ok: boolean) => void }) {
  const confirm = useConfirm()
  return <button onClick={() => void confirm({ title: 'Zahlung löschen?', message: 'Sie ist danach weg.', confirmLabel: 'Löschen', danger: true }).then(onAnswer)}>Löschen …</button>
}

test('Schritt 1: ein modaler <dialog role="alertdialog"> mit Titel und Beschreibung', async () => {
  render(<UIProvider><Loeschen onAnswer={() => {}} /></UIProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Löschen …' }))
  const ask = await screen.findByRole('alertdialog', { name: 'Zahlung löschen?' })
  expect(ask.tagName).toBe('DIALOG')
  expect((ask as HTMLDialogElement).open).toBe(true)
  expect(document.getElementById(ask.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Sie ist danach weg.')
})

test('Schritt 1: bei Gefahr Startfokus auf Abbrechen; Enter dort bricht ab, Enter auf dem Verb bestätigt', async () => {
  const answers: boolean[] = []
  render(<UIProvider><Loeschen onAnswer={(ok) => answers.push(ok)} /></UIProvider>)
  const trigger = screen.getByRole('button', { name: 'Löschen …' })
  trigger.focus()
  fireEvent.click(trigger)
  await screen.findByRole('alertdialog')
  expect(document.activeElement?.textContent).toBe('Abbrechen')
  press('Enter')
  await act(async () => {})
  expect(answers).toEqual([false])
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(document.activeElement).toBe(trigger)
  fireEvent.click(trigger)
  await screen.findByRole('alertdialog')
  press('Tab')
  expect(document.activeElement?.textContent).toBe('Löschen')
  press('Enter')
  await act(async () => {})
  expect(answers).toEqual([false, true])
})

test('Schritt 1: Tab bleibt in der Rückfrage, auch mit Umschalt', async () => {
  render(<UIProvider><button>Draußen</button><Loeschen onAnswer={() => {}} /></UIProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Löschen …' }))
  const ask = await screen.findByRole('alertdialog')
  for (let i = 0; i < 5; i++) {
    press('Tab', { shiftKey: i % 2 === 1 })
    expect(ask.contains(document.activeElement)).toBe(true)
  }
})

test('Schritt 1: ein Klick daneben bricht ab, ein Klick in den Inhalt nicht', async () => {
  const answers: boolean[] = []
  render(<UIProvider><Loeschen onAnswer={(ok) => answers.push(ok)} /></UIProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Löschen …' }))
  const ask = await screen.findByRole('alertdialog')
  // Im Inhalt beginnen und daneben loslassen (Text markieren) bricht nicht ab
  fireEvent.mouseDown(within(ask).getByText('Sie ist danach weg.'))
  fireEvent.click(ask)
  fireEvent.click(within(ask).getByText('Sie ist danach weg.'))
  await act(async () => {})
  expect(answers).toEqual([])
  // Der Hintergrund des modalen Dialogs gehört zum <dialog> selbst
  fireEvent.mouseDown(ask)
  fireEvent.click(ask)
  await act(async () => {})
  expect(answers).toEqual([false])
})

// Über einem anderen modalen Dialog (das Menüblatt am Handy, ein Seitenfenster): Esc schließt nur die
// Rückfrage, der äußere Dialog bleibt offen, und der Fokus steht wieder auf dem Auslöser darin.
function Aussen() {
  const ref = useRef<HTMLDialogElement>(null)
  const [closed, setClosed] = useState(0)
  useEffect(() => { ref.current?.showModal() }, [])
  return (
    <dialog ref={ref} aria-label="Außen" onClose={() => setClosed((n) => n + 1)}>
      <Loeschen onAnswer={() => {}} />
      <span>geschlossen {closed}</span>
    </dialog>
  )
}

test('Schritt 1: Esc in der Rückfrage über einem modalen Dialog schließt nur die Rückfrage', async () => {
  render(<UIProvider><Aussen /></UIProvider>)
  const outer = screen.getByRole('dialog', { name: 'Außen' }) as HTMLDialogElement
  const trigger = within(outer).getByRole('button', { name: 'Löschen …' })
  trigger.focus()
  fireEvent.click(trigger)
  await screen.findByRole('alertdialog')
  press('Escape')
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  await act(async () => {})
  expect(outer.open).toBe(true)
  expect(screen.getByText('geschlossen 0')).toBeTruthy()
  expect(document.activeElement).toBe(trigger)
})

// Eine zweite Rückfrage, solange die erste offen ist, beantwortet die erste mit „nein“, statt sie nie zu beantworten.
function Zweimal({ onAnswer }: { onAnswer: (which: string, ok: boolean) => void }) {
  const confirm = useConfirm()
  return <button onClick={() => {
    void confirm({ confirmLabel: 'Weiter', title: 'Erste' }).then((ok) => onAnswer('erste', ok))
    void confirm({ confirmLabel: 'Weiter', title: 'Zweite' }).then((ok) => onAnswer('zweite', ok))
  }}>Fragen</button>
}

test('Schritt 1: eine neue Rückfrage beantwortet die offene mit nein', async () => {
  const answers: string[] = []
  render(<UIProvider><Zweimal onAnswer={(w, ok) => answers.push(`${w}:${ok}`)} /></UIProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Fragen' }))
  const ask = await screen.findByRole('alertdialog', { name: 'Zweite' })
  fireEvent.click(within(ask).getByRole('button', { name: 'Weiter' }))
  await act(async () => {})
  expect(answers).toEqual(['erste:false', 'zweite:true'])
})

// Durchsicht R1: Öffnet die dritte Wahl selbst eine Rückfrage, bleibt die neue offen und wird mit ihrer
// eigenen Antwort beantwortet. Vorher schloss das `close(false)` nach `onAlternative` sie gleich wieder, und
// das verspätete `close` des Browsers (der Polyfill sendet es wie er als eigene Aufgabe) traf sie ebenso.
function Alternative({ onAnswer }: { onAnswer: (which: string, ok: boolean) => void }) {
  const confirm = useConfirm()
  return <button onClick={() => void confirm({ confirmLabel: 'Weiter',
    title: 'Erste', alternativeLabel: 'Stattdessen fragen',
    onAlternative: () => { void confirm({ title: 'Zweite', confirmLabel: 'Ja' }).then((ok) => onAnswer('zweite', ok)) },
  }).then((ok) => onAnswer('erste', ok))}>Fragen</button>
}

test('R1: eine Rückfrage aus der dritten Wahl bleibt offen und bekommt ihre eigene Antwort', async () => {
  const answers: string[] = []
  render(<UIProvider><Alternative onAnswer={(w, ok) => answers.push(`${w}:${ok}`)} /></UIProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Fragen' }))
  fireEvent.click(within(await screen.findByRole('alertdialog', { name: 'Erste' })).getByRole('button', { name: 'Stattdessen fragen' }))
  const second = await screen.findByRole('alertdialog', { name: 'Zweite' })
  // Das verspätete `close` der ersten kommt an
  await new Promise((r) => setTimeout(r, 20))
  expect((second as HTMLDialogElement).open).toBe(true)
  expect(answers).toEqual(['erste:false'])
  fireEvent.click(within(second).getByRole('button', { name: 'Ja' }))
  await act(async () => {})
  expect(answers).toEqual(['erste:false', 'zweite:true'])
})

test('Durchsicht M2: die Rückfrage lenkt Tab nicht selbst, der Browser tut es', async () => {
  render(<UIProvider><Loeschen onAnswer={() => {}} /></UIProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Löschen …' }))
  await screen.findByRole('alertdialog')
  expect(fireEvent.keyDown(document.activeElement as Element, { key: 'Tab' })).toBe(true)
})

test('ein Element in der Rückfrage, das Esc für sich nimmt (offener Begriff), lässt sie offen', async () => {
  function MitEsc() {
    const confirm = useConfirm()
    const message = <span role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Escape') e.preventDefault() }}>Begriff</span>
    return <button onClick={() => void confirm({ confirmLabel: 'Weiter', title: 'Mit Begriff', message })}>Fragen</button>
  }
  render(<UIProvider><MitEsc /></UIProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Fragen' }))
  const term = await screen.findByRole('button', { name: 'Begriff' })
  term.focus()
  press('Escape')
  await act(async () => {})
  expect(screen.getByRole('alertdialog')).toBeTruthy()
})

// Durchsicht S7: Über einem modalen Dialog ist die Leiste der Mitteilungen inert und wird nicht angesagt.
// Dieselbe Mitteilung steht deshalb für Vorleser in einer Ansage im obersten Dialog.
function MeldenInRueckfrage() {
  const confirm = useConfirm()
  const toast = useToast()
  return <button onClick={() => void confirm({ confirmLabel: 'Weiter', title: 'Frage', message: (dismiss) => <button onClick={() => toast('Gespeichert.', 'ok')} data-dismiss={String(Boolean(dismiss))}>Melden</button> })}>Fragen</button>
}

test('S7: eine Mitteilung bei offenem modalem Dialog wird im Dialog angesagt', async () => {
  render(<UIProvider><MeldenInRueckfrage /></UIProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Fragen' }))
  const ask = await screen.findByRole('alertdialog')
  fireEvent.click(within(ask).getByRole('button', { name: 'Melden' }))
  await waitFor(() => expect(within(ask).getByRole('status').textContent).toBe('Gespeichert.'))
})

test('S7: ohne offenen Dialog gibt es keine zusätzliche Ansage', async () => {
  render(<UIProvider><Trigger /></UIProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  await new Promise((r) => setTimeout(r, 150))
  expect(screen.queryByRole('status')).toBeNull()
})

// @vitest-environment jsdom
// Ein Toast räumt sich nach ein paar Sekunden selbst weg. Wird die Oberfläche vorher abgebaut,
// darf dieser Zeitgeber nicht mehr laufen: Am Ende eines Komponententests träfe er auf eine
// abgebaute Testumgebung („window is not defined“), und der ganze Lauf scheiterte, obwohl jeder
// Test grün war.
import { afterEach, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { UIProvider, useConfirm, useToast } from './feedback'

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
  return <button onClick={() => void confirm({ title: 'Rechnung aufteilen?', message: 'Zwei Teile.' })}>Fragen</button>
}

test('Laienprobe (Kleinigkeit): die Rückfrage ist ein Dialog mit Namen', async () => {
  render(<UIProvider><Ask /></UIProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Fragen' }))
  expect(await screen.findByRole('dialog', { name: 'Rechnung aufteilen?' })).toBeTruthy()
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
  fireEvent.keyDown(window, { key: 'Enter' })
  await act(async () => {})
  expect(answers).toEqual([false])
})

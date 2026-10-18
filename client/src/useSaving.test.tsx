// @vitest-environment jsdom
// Kein doppeltes Speichern (#346 Schritt 7, Durchsicht S1).
import { afterEach, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useSaving } from './useSaving'
import Drawer from './components/Drawer'

afterEach(cleanup)

function Form({ save }: { save: () => Promise<void> }) {
  const saving = useSaving()
  return (
    <Drawer open title="Neu" value={{}} onClose={() => {}} busy={saving.busy} onSubmit={() => void saving.run(save)}
      actions={<button className="btn" disabled={saving.busy} onClick={() => void saving.run(save)}>Anlegen</button>}>
      <input aria-label="Feld" />
    </Drawer>
  )
}

test('Doppelklick und Strg+S während des Speicherns: genau ein Aufruf', async () => {
  let done = () => {}
  const save = vi.fn(() => new Promise<void>((r) => { done = r }))
  render(<Form save={save} />)
  const knopf = screen.getByRole('button', { name: 'Anlegen' })
  fireEvent.click(knopf)
  fireEvent.click(knopf)
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 's', ctrlKey: true })
  expect(save).toHaveBeenCalledTimes(1)
  expect((knopf as HTMLButtonElement).disabled).toBe(true)
  await act(async () => { done() })
  expect((knopf as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(knopf)
  expect(save).toHaveBeenCalledTimes(2)
})

test('Der Drawer ruft onSubmit nicht, solange er busy ist', () => {
  const submit = vi.fn()
  render(<Drawer open title="Neu" value={{}} onClose={() => {}} busy onSubmit={submit}><input aria-label="Feld" /></Drawer>)
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 's', ctrlKey: true })
  expect(submit).not.toHaveBeenCalled()
})

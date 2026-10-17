// @vitest-environment jsdom
// useDraft und DraftActions (#309): Ändern sendet nichts, „Speichern“ sendet genau einmal, ein
// Fehler lässt den Entwurf stehen, und ein offener Entwurf zählt als offenes Formular.
import { useState } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PropertyProvider, useProperty } from './property'
import { useDraft } from './useDraft'
import DraftActions from './components/DraftActions'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function Feld({ saved, onSave, scope }: { saved: string, onSave: (v: string) => Promise<unknown>, scope?: string }) {
  const d = useDraft(saved, { scope })
  return (
    <>
      <label>Datum<input type="date" value={d.value} onChange={(e) => d.set(e.target.value)} /></label>
      <DraftActions draft={d} onSave={onSave} />
    </>
  )
}

test('ohne Änderung keine Schaltflächen; Ändern sendet nichts, Speichern genau einmal', async () => {
  const onSave = vi.fn(async () => {})
  render(<Feld saved="2025-01-12" onSave={onSave} />)
  expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull()
  fireEvent.change(screen.getByLabelText('Datum'), { target: { value: '2025-01-15' } })
  expect(onSave).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Verwerfen' })).toBeNull())
  expect(onSave.mock.calls).toEqual([['2025-01-15']])
  // Bis die Seite neu lädt, zeigt das Feld den gespeicherten Wert und nicht den alten.
  expect((screen.getByLabelText('Datum') as HTMLInputElement).value).toBe('2025-01-15')
})

test('Doppelklick speichert nur einmal, während des Speicherns sind die Schaltflächen gesperrt', async () => {
  let finish = () => {}
  const onSave = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
  render(<Feld saved="" onSave={onSave} />)
  fireEvent.change(screen.getByLabelText('Datum'), { target: { value: '2025-01-15' } })
  const knopf = screen.getByRole('button', { name: 'Speichern' })
  fireEvent.click(knopf)
  fireEvent.click(knopf)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Speichert …' })).toHaveProperty('disabled', true))
  expect(screen.getByRole('button', { name: 'Verwerfen' })).toHaveProperty('disabled', true)
  await act(async () => { finish() })
  expect(onSave).toHaveBeenCalledTimes(1)
})

test('scheitert das Speichern, bleibt der Entwurf mit dem Grund stehen', async () => {
  const onSave = vi.fn(async () => { throw new Error('Server nicht erreichbar') })
  render(<Feld saved="2025-01-12" onSave={onSave} />)
  fireEvent.change(screen.getByLabelText('Datum'), { target: { value: '2025-01-15' } })
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  expect((await screen.findByRole('alert')).textContent).toBe('Nicht gespeichert: Server nicht erreichbar')
  expect((screen.getByLabelText('Datum') as HTMLInputElement).value).toBe('2025-01-15')
  expect(screen.getByRole('button', { name: 'Speichern' })).toBeTruthy()
  // Verwerfen räumt Entwurf und Meldung.
  fireEvent.click(screen.getByRole('button', { name: 'Verwerfen' }))
  expect((screen.getByLabelText('Datum') as HTMLInputElement).value).toBe('2025-01-12')
  expect(screen.queryByRole('alert')).toBeNull()
})

test('ein neuer Stand von außen erscheint ohne Entwurf und lässt einen Entwurf stehen', () => {
  const onSave = async () => {}
  const { rerender } = render(<Feld saved="2025-01-12" onSave={onSave} />)
  rerender(<Feld saved="2025-02-01" onSave={onSave} />)
  expect((screen.getByLabelText('Datum') as HTMLInputElement).value).toBe('2025-02-01')
  fireEvent.change(screen.getByLabelText('Datum'), { target: { value: '2025-03-01' } })
  rerender(<Feld saved="2025-02-02" onSave={onSave} />)
  expect((screen.getByLabelText('Datum') as HTMLInputElement).value).toBe('2025-03-01')
  // Ein anderer Bereich verwirft ihn.
  rerender(<Feld saved="2025-02-02" onSave={onSave} scope="andere" />)
  expect((screen.getByLabelText('Datum') as HTMLInputElement).value).toBe('2025-02-02')
  expect(screen.queryByRole('button', { name: 'Verwerfen' })).toBeNull()
})

function Offen() {
  const { hasOpenForm } = useProperty()
  const [seen, setSeen] = useState<boolean | null>(null)
  return <button type="button" onClick={() => setSeen(hasOpenForm())}>offen? {String(seen)}</button>
}

test('ein offener Entwurf meldet sich als offenes Formular an, gespeichert oder verworfen nicht mehr', async () => {
  vi.stubGlobal('fetch', async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }))
  render(<PropertyProvider><Feld saved="" onSave={async () => {}} /><Offen /></PropertyProvider>)
  const frage = async () => {
    fireEvent.click(screen.getByRole('button', { name: /^offen\?/ }))
    return screen.getByRole('button', { name: /^offen\?/ }).textContent
  }
  await screen.findByLabelText('Datum')
  expect(await frage()).toBe('offen? false')
  fireEvent.change(screen.getByLabelText('Datum'), { target: { value: '2025-01-15' } })
  expect(await frage()).toBe('offen? true')
  fireEvent.click(screen.getByRole('button', { name: 'Verwerfen' }))
  expect(await frage()).toBe('offen? false')
  fireEvent.change(screen.getByLabelText('Datum'), { target: { value: '2025-01-15' } })
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull())
  expect(await frage()).toBe('offen? false')
})

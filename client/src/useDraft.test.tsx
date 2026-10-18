// @vitest-environment jsdom
// useDraft und DraftActions (#309): Ändern sendet nichts, „Speichern“ sendet genau einmal, ein
// Fehler lässt den Entwurf stehen, und ein offener Entwurf zählt als offenes Formular.
import { useState } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { PropertyProvider, useProperty } from './property'
import { keepDraft, useConfirmDiscard, useDraft } from './useDraft'
import DraftActions from './components/DraftActions'
import { UIProvider } from './components/feedback'

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

test('ein gescheitertes Speichern steht nicht neben dem Wert eines anderen scope', async () => {
  const onSave = vi.fn(async () => { throw new Error('Server sagt nein') })
  const { rerender } = render(<Feld saved="2025-01-12" onSave={onSave} scope="a" />)
  fireEvent.change(screen.getByLabelText('Datum'), { target: { value: '2025-01-15' } })
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  await screen.findByRole('alert')
  rerender(<Feld saved="2026-02-01" onSave={onSave} scope="b" />)
  expect((screen.getByLabelText('Datum') as HTMLInputElement).value).toBe('2026-02-01')
  expect(screen.queryByRole('alert')).toBeNull()
})

// WCAG 2.5.3 (Label in Name): Der Name einer Schaltfläche beginnt mit ihrem sichtbaren Text. Vorher
// überdeckte `aria-label` den Text, und „Speichert …“ hörte ein Vorleser nie.
function Benannt({ onSave }: { onSave: (v: string) => Promise<unknown> }) {
  const d = useDraft('2025-01-12')
  return (
    <>
      <label>Datum<input type="date" value={d.value} onChange={(e) => d.set(e.target.value)} /></label>
      <DraftActions draft={d} onSave={onSave} what="Versanddatum" />
    </>
  )
}

test('mit `what` beginnt der Name mit dem sichtbaren Text, auch während des Speicherns', async () => {
  let finish = () => {}
  render(<Benannt onSave={() => new Promise<void>((resolve) => { finish = resolve })} />)
  fireEvent.change(screen.getByLabelText('Datum'), { target: { value: '2025-01-15' } })
  expect(screen.getByRole('button', { name: 'Speichern (Versanddatum)' }).getAttribute('aria-label')).toBeNull()
  expect(screen.getByRole('button', { name: 'Verwerfen (Versanddatum)' }).getAttribute('aria-label')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Speichern (Versanddatum)' }))
  expect(await screen.findByRole('button', { name: 'Speichert … (Versanddatum)' })).toBeTruthy()
  await act(async () => { finish() })
})

// Durchsicht zu #333: Ein Wechsel, den die Seite selbst auslöst (der Reiter zwischen Betriebs- und
// Heizkostenabrechnung), änderte den scope und verwarf einen Entwurf ohne Rückfrage.
function MitReiter() {
  const [scope, setScope] = useState('a')
  const d = useDraft(scope === 'a' ? '2025-01-12' : '2025-02-01', { scope })
  const confirmDiscard = useConfirmDiscard()
  return (
    <>
      <label>Datum<input type="date" value={d.value} onChange={(e) => d.set(e.target.value)} /></label>
      <DraftActions draft={d} onSave={async () => {}} />
      <button type="button" onClick={async () => { if (await confirmDiscard([d])) setScope('b') }}>Reiter b</button>
      <span>scope {scope}</span>
    </>
  )
}

test('ein Wechsel des scope mit offenem Entwurf fragt nach; Abbrechen behält den Entwurf', async () => {
  render(<UIProvider><MitReiter /></UIProvider>)
  fireEvent.change(screen.getByLabelText('Datum'), { target: { value: '2025-01-15' } })
  fireEvent.click(screen.getByRole('button', { name: 'Reiter b' }))
  const dialog = await screen.findByRole('dialog')
  expect(dialog.textContent).toMatch(/Ungespeicherte Änderung verwerfen\?/)
  // Verwerfen ist gefährlich: Der Startfokus liegt auf „Abbrechen“.
  expect(document.activeElement?.textContent).toBe('Abbrechen')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.getByText('scope a')).toBeTruthy()
  expect((screen.getByLabelText('Datum') as HTMLInputElement).value).toBe('2025-01-15')
  // Verwerfen wechselt.
  fireEvent.click(screen.getByRole('button', { name: 'Reiter b' }))
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Verwerfen' }))
  await screen.findByText('scope b')
  expect((screen.getByLabelText('Datum') as HTMLInputElement).value).toBe('2025-02-01')
})

// Heizung, Karte „Ausnahmen und Vereinbarungen“: Vor dem Speichern kann eine Rückfrage kommen. Wer dort
// abbricht, hat nichts gespeichert; der Entwurf bleibt ohne Fehlermeldung stehen.
test('ergibt `onSave` keepDraft, bleibt der Entwurf ohne Meldung stehen', async () => {
  const onSave = vi.fn(async () => keepDraft)
  render(<Feld saved="2025-01-12" onSave={onSave} />)
  fireEvent.change(screen.getByLabelText('Datum'), { target: { value: '2025-01-15' } })
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Speichern' })).toHaveProperty('disabled', false))
  expect((screen.getByLabelText('Datum') as HTMLInputElement).value).toBe('2025-01-15')
  expect(screen.queryByRole('alert')).toBeNull()
})

// Karte mit einem Speichern (Spezifikation #346, Abschnitt 3): am Fuß der Karte, „Speichern“ primär,
// daneben „Ungespeicherte Änderungen“.
function Karte({ onSave }: { onSave: (v: string) => Promise<unknown> }) {
  const d = useDraft('a')
  return (
    <>
      <label>Wahl<select value={d.value} onChange={(e) => d.set(e.target.value)}><option value="a">a</option><option value="b">b</option></select></label>
      <DraftActions draft={d} onSave={onSave} layout="card" />
    </>
  )
}

test('layout="card": Fuß der Karte mit „Speichern“, „Verwerfen“ und dem Hinweis auf ungespeicherte Änderungen', async () => {
  const onSave = vi.fn(async () => {})
  const { container } = render(<Karte onSave={onSave} />)
  expect(container.querySelector('.draft-actions.border-t')).toBeNull()
  fireEvent.change(screen.getByLabelText('Wahl'), { target: { value: 'b' } })
  const foot = container.querySelector('.draft-actions.border-t')
  expect(foot).not.toBeNull()
  expect(foot?.textContent).toMatch(/Ungespeicherte Änderungen/)
  expect(screen.getByRole('button', { name: 'Speichern' }).className).not.toMatch(/secondary/)
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  await waitFor(() => expect(container.querySelector('.draft-actions.border-t')).toBeNull())
  expect(onSave.mock.calls).toEqual([['b']])
})

test('ohne Entwurf wechselt der scope ohne Rückfrage', async () => {
  render(<UIProvider><MitReiter /></UIProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Reiter b' }))
  await screen.findByText('scope b')
  expect(screen.queryByRole('dialog')).toBeNull()
})

// Durchsicht zu #309, MUSS 2: Fällt der gewählte Wert aus der Optionsliste, ist der Entwurf verworfen.
// Vorher zeigte das Feld „bitte wählen“, und „Speichern“ schickte den unsichtbaren Wert.
function Auswahl({ options, onSave }: { options: string[]; onSave: (v: string) => Promise<unknown> }) {
  const d = useDraft('', { isValid: (v) => v === '' || options.includes(v) })
  return (
    <>
      <label>Position<select value={d.value} onChange={(e) => d.set(e.target.value)}>
        <option value="">bitte wählen</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select></label>
      <DraftActions draft={d} onSave={onSave} />
    </>
  )
}

test('isValid: ein Entwurf, dessen Wert nicht mehr zur Wahl steht, ist verworfen und wird nicht gespeichert', () => {
  const onSave = vi.fn(async () => {})
  const { rerender } = render(<Auswahl options={['a', 'b']} onSave={onSave} />)
  fireEvent.change(screen.getByLabelText('Position'), { target: { value: 'b' } })
  expect(screen.getByRole('button', { name: 'Speichern' })).toBeTruthy()
  rerender(<Auswahl options={['a']} onSave={onSave} />)
  expect((screen.getByLabelText('Position') as HTMLSelectElement).value).toBe('')
  expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull()
  // Kommt der Wert zurück, lebt der alte Entwurf nicht wieder auf.
  rerender(<Auswahl options={['a', 'b']} onSave={onSave} />)
  expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull()
  expect(onSave).not.toHaveBeenCalled()
})

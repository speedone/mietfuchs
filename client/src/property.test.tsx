// @vitest-environment jsdom
// Das gewählte Objekt (#92): Auswahl, Adresse der Abrufe und der Umschalter, der bei einem
// einzigen Objekt gar nicht erscheint. Wer ein Haus vermietet, soll von den Objekten nichts sehen.
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Property } from './types'
import { chooseProperty, PropertyProvider, PropertySwitcher, useProperty, withProperty } from './property'

const objekt = (id: string, name: string): Property => ({
  id, name, kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null,
})
const A = objekt('objekt-1', 'Lindenstraße 7')
const B = objekt('objekt-2', 'Gartenweg 3')

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  try { localStorage.clear() } catch { /* ohne Speicher nichts zu räumen */ }
})

test('die gemerkte Wahl gilt, eine unbekannte fällt auf das erste Objekt zurück', () => {
  expect(chooseProperty([A, B], 'objekt-2')).toBe(B)
  expect(chooseProperty([A, B], 'gelöscht')).toBe(A)
  expect(chooseProperty([A, B], null)).toBe(A)
  expect(chooseProperty([], 'objekt-1')).toBeNull()
})

test('die Adresse eines Abrufs bekommt das Objekt angehängt, mit ? oder &', () => {
  expect(withProperty('/api/units', 'objekt-2')).toBe('/api/units?property=objekt-2')
  expect(withProperty('/api/units?x=1', 'objekt-2')).toBe('/api/units?x=1&property=objekt-2')
  expect(withProperty('/api/units', null)).toBe('/api/units')
})

test('bei einem Objekt gibt es keinen Umschalter, bei zweien schon', () => {
  const { rerender } = render(<PropertySwitcher properties={[A]} value="objekt-1" onChange={() => {}} />)
  expect(screen.queryByLabelText('Objekt wählen')).toBeNull()
  const onChange = vi.fn()
  rerender(<PropertySwitcher properties={[A, B]} value="objekt-1" onChange={onChange} />)
  fireEvent.change(screen.getByLabelText('Objekt wählen'), { target: { value: 'objekt-2' } })
  expect(onChange).toHaveBeenCalledWith('objekt-2')
})

function Zeige() {
  const { property, setPropertyId } = useProperty()
  return (
    <>
      <span data-testid="gewaehlt">{property?.name ?? 'keins'}</span>
      <button onClick={() => setPropertyId('objekt-2')}>wechseln</button>
    </>
  )
}

test('der Provider lädt die Objekte, merkt sich die Wahl und fällt nach dem Löschen zurück', async () => {
  let liste = [A, B]
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify(liste), { status: 200, headers: { 'content-type': 'application/json' } }))
  const { unmount } = render(<PropertyProvider><Zeige /></PropertyProvider>)
  await waitFor(() => expect(screen.getByTestId('gewaehlt').textContent).toBe('Lindenstraße 7'))
  fireEvent.click(screen.getByText('wechseln'))
  await waitFor(() => expect(screen.getByTestId('gewaehlt').textContent).toBe('Gartenweg 3'))
  unmount()

  // Ein neuer Tab erinnert sich an die Wahl …
  render(<PropertyProvider><Zeige /></PropertyProvider>)
  await waitFor(() => expect(screen.getByTestId('gewaehlt').textContent).toBe('Gartenweg 3'))
  cleanup()

  // … und ist das gewählte Objekt inzwischen gelöscht, gilt das erste.
  liste = [A]
  render(<PropertyProvider><Zeige /></PropertyProvider>)
  await waitFor(() => expect(screen.getByTestId('gewaehlt').textContent).toBe('Lindenstraße 7'))
})

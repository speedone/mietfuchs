// @vitest-environment jsdom
// Die Musterseite (#346 Schritt 12): alle Bausteine, ohne Anfrage an den Server, damit Bildschirmfotos und
// Browserlauf sie ohne Bestand zeigen können.
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { UIProvider } from '../components/feedback'
import Muster from './Muster'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('die Musterseite zeigt jeden Baustein und fragt den Server nicht', () => {
  const fetch = vi.fn(async () => new Response('[]', { headers: { 'content-type': 'application/json' } }))
  vi.stubGlobal('fetch', fetch)
  render(<UIProvider><Muster /></UIProvider>)
  expect(screen.getByRole('heading', { name: 'Musterseite', level: 1 })).toBeTruthy()
  for (const title of ['Knöpfe', 'Felder in Stufen', 'Seitenfenster', 'Entwurf am Feld', 'Hinweise', 'Tabelle', 'Umschalter und Leerzustand']) {
    expect(screen.getByRole('heading', { name: title, level: 2 })).toBeTruthy()
  }
  // Je Stufe ein Hinweis, die Sammelmeldung mit der Meldung am Feld
  for (const level of ['Fehler', 'Warnung', 'Hinweis']) expect(screen.getAllByText(level).length).toBeGreaterThan(0)
  expect(screen.getByText(/Bitte prüfen Sie 1 Angabe/)).toBeTruthy()
  expect(fetch).not.toHaveBeenCalled()
})

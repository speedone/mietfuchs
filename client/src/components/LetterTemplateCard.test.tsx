// @vitest-environment jsdom
// Die Vorlage des Anschreibens in den Einstellungen (#415): Vorgabe der Anpassung, eigener Text,
// „Auf Vorgabe zurücksetzen“ und die Vorschau mit Beispielwerten.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { LetterTemplates } from '../types'
import { DEFAULT_LETTER_TEXTS } from '../../../shared/letter.ts'
import { UIProvider } from './feedback'
import LetterTemplateCard from './LetterTemplateCard'

vi.setConfig({ testTimeout: 20000 })
const SLOW = { timeout: 5000 }
let puts: unknown[]
beforeEach(() => {
  puts = []
  const templates: LetterTemplates = { defaults: DEFAULT_LETTER_TEXTS, installation: { closing: 'Danke.' }, property: null, adjustDefault: 'suggestion' }
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') puts.push({ url, body: JSON.parse(String(init.body)) })
    return new Response(JSON.stringify(init?.method === 'PUT' ? { ok: true } : templates), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('Vorlage: Vorgabe der Anpassung, eigener Text, zurücksetzen und Vorschau mit Beispielwerten', async () => {
  const reload = vi.fn(async () => {})
  render(<UIProvider><LetterTemplateCard reload={reload} /></UIProvider>)
  expect(await screen.findByText(/1 von 13 Bausteinen mit eigenem Text/, {}, SLOW)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Vorlage bearbeiten' }))
  const dialog = await screen.findByRole('dialog', {}, SLOW)
  // Ohne eigenen Betrag: den gibt es nur je Mieter.
  expect(within(dialog).queryByRole('radio', { name: /Eigenen Betrag/ })).toBeNull()
  fireEvent.click(within(dialog).getByRole('radio', { name: /Keine Anpassung/ }))
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Anrede' }), { target: { value: 'Hallo {Name},' } })
  expect(dialog.textContent).toContain('Vorschau: Hallo Erika Mustermann,')
  fireEvent.click(within(within(dialog).getByRole('group', { name: 'Platzhalter für Schluss' })).getByRole('button', { name: /Auf Vorgabe zurücksetzen/ }))
  expect((within(dialog).getByRole('textbox', { name: 'Schluss' }) as HTMLTextAreaElement).value).toBe(DEFAULT_LETTER_TEXTS.closing)
  fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }))
  await waitFor(() => expect(puts).toHaveLength(1), SLOW)
  expect(puts[0]).toEqual({ url: '/api/letter-texts', body: { texts: { salutation: 'Hallo {Name},', closing: null }, adjustDefault: 'none' } })
  await waitFor(() => expect(reload).toHaveBeenCalled(), SLOW)
})

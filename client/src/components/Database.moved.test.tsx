// @vitest-environment jsdom
// Ein umgezogener Datenordner (#517): Eine aktuelle Fassung sagt auf jeder Seite, wohin die Daten umgezogen sind, und
// dass hier nur noch angesehen wird. Ohne „Verstanden“, denn jede Änderung lehnt der Server ab.
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import DatabaseNotice from './Database'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('Umgezogen: Hinweis mit neuem Ort, ohne Wegklicken', async () => {
  const message = 'Ihre Daten sind ins neue Mietfuchs umgezogen (am 1. November 2026 nach C:\\Users\\Anna\\Mietfuchs). Hier können Sie sie nur noch ansehen; ändern Sie sie bitte im neuen Mietfuchs.'
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
    app: 'mietfuchs', version: '0.15.0',
    database: { open: true, file: '/x/mietfuchs.sqlite', migrations: 0, detail: 'geöffnet', changeover: { state: 'none', message: '', notes: [] }, migrated: null },
    moved: { movedTo: 'C:\\Users\\Anna\\Mietfuchs', at: '2026-11-01T10:15:00.000Z', message },
  }), { status: 200, headers: { 'content-type': 'application/json' } }))
  render(<DatabaseNotice />)
  expect(await screen.findByRole('heading', { name: 'Nur noch zum Ansehen' })).toBeTruthy()
  expect(screen.getByText(message)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Verstanden' })).toBeNull()
})

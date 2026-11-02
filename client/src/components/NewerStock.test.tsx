// @vitest-environment jsdom
// Ergänzung 2 zum Umzug (#517): Wurde im bisherigen Mietfuchs nach dem Umzug noch etwas geändert, sagt es das neue und
// bietet an, den neueren Stand noch einmal zu übernehmen. Nie von selbst, nur nach Rückfrage.
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { UIProvider } from './feedback'
import NewerStock from './NewerStock'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('Neuerer Stand im alten Mietfuchs: Hinweis, Übernehmen nach Rückfrage, Abwinken', async () => {
  const calls: string[] = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    return new Response(JSON.stringify({ ok: true, notes: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  const reloadPage = vi.fn()
  const onDismissed = vi.fn()
  render(<UIProvider><NewerStock newer={{ from: 'C:\\Users\\Anna\\Downloads\\mietfuchs\\data', modifiedAt: '2026-11-05T09:30:00.000Z' }} reloadPage={reloadPage} onDismissed={onDismissed} /></UIProvider>)
  expect(screen.getByRole('heading', { name: 'Im bisherigen Mietfuchs wurde nach dem Umzug noch etwas geändert' })).toBeTruthy()
  expect(screen.getByText(/5\. November 2026/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Neueren Stand übernehmen …' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog.textContent).toMatch(/gesichert/)
  expect(calls).not.toContain('POST /api/relocation/readopt')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Übernehmen' }))
  await vi.waitFor(() => expect(reloadPage).toHaveBeenCalled())
  expect(calls).toContain('POST /api/relocation/readopt')
  fireEvent.click(screen.getByRole('button', { name: 'Nicht übernehmen' }))
  await vi.waitFor(() => expect(onDismissed).toHaveBeenCalled())
  expect(calls).toContain('POST /api/relocation/newer/dismiss')
})

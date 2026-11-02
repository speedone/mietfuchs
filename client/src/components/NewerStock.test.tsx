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

const NEWER = {
  from: 'C:\\Users\\Anna\\Downloads\\mietfuchs-0.12.0\\data', modifiedAt: '2026-11-05T09:30:00.000Z',
  place: { folder: 'mietfuchs-0.12.0', within: 'Downloads' as const }, running: false,
}

test('Neuerer Stand im alten Mietfuchs: Hinweis, Übernehmen nach Rückfrage, Abwinken', async () => {
  const calls: string[] = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    return new Response(JSON.stringify({ ok: true, notes: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  const reloadPage = vi.fn()
  const onDismissed = vi.fn()
  render(<UIProvider><NewerStock newer={NEWER} reloadPage={reloadPage} onDismissed={onDismissed} /></UIProvider>)
  expect(screen.getByRole('heading', { name: 'Im bisherigen Mietfuchs wurde nach dem Umzug noch etwas geändert' })).toBeTruthy()
  expect(screen.getByText(/5\. November 2026/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Neueren Stand übernehmen …' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog.textContent).toMatch(/gesichert/)
  expect(calls).not.toContain('POST /api/relocation/readopt')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Übernehmen' }))
  await vi.waitFor(() => expect(reloadPage).toHaveBeenCalledWith('newer'))
  expect(calls).toContain('POST /api/relocation/readopt')
  fireEvent.click(screen.getByRole('button', { name: 'Nicht übernehmen' }))
  await vi.waitFor(() => expect(onDismissed).toHaveBeenCalled())
  expect(calls).toContain('POST /api/relocation/newer/dismiss')
})

// Praxistest M: schon im Kasten sagen, was „Übernehmen“ ersetzt und was „Nicht übernehmen“ heißt; das alte Mietfuchs
// lässt sich wie beim ersten Umzug von hier beenden; der Ort in Worten, der Pfad nur unter „Genauer Ort“
test('Praxistest M: Ort in Worten, was ersetzt wird, „Altes Mietfuchs beenden“, was „Nicht übernehmen“ heißt', async () => {
  const calls: string[] = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    return new Response(JSON.stringify({ stopped: true }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  render(<UIProvider><NewerStock newer={{ ...NEWER, running: true }} reloadPage={vi.fn()} onDismissed={vi.fn()} /></UIProvider>)
  const box = screen.getByRole('heading', { name: 'Im bisherigen Mietfuchs wurde nach dem Umzug noch etwas geändert' }).closest('section') as HTMLElement
  expect(box.textContent).toContain('Ordner „mietfuchs-0.12.0“ in Downloads')
  expect(box.querySelector('details summary')?.textContent).toBe('Genauer Ort')
  expect(box.textContent).toMatch(/ersetzt.*was Sie hier seit dem Umzug geändert haben.*vorher gesichert/)
  expect(box.textContent).toMatch(/„Nicht übernehmen“: Sie arbeiten hier weiter/)
  fireEvent.click(within(box).getByRole('button', { name: 'Altes Mietfuchs beenden' }))
  expect(await screen.findByText('Das alte Mietfuchs ist beendet.')).toBeTruthy()
  expect(calls).toContain('POST /api/relocation/quit-old')
  expect(within(box).queryByRole('button', { name: 'Altes Mietfuchs beenden' })).toBeNull()
})

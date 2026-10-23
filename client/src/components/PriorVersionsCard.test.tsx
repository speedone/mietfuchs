// @vitest-environment jsdom
// Die Karte „Automatische Vorversionen“ (#318): Liste, Einspielen nur nach Rückfrage.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import PriorVersionsCard from './PriorVersionsCard'
import { UIProvider } from './feedback'

const VERSIONS = [
  { name: 'vorversion-2026-10-20-081500.sqlite', createdAt: '2026-10-20T08:15:00.000Z', size: 2 * 1024 * 1024 },
  { name: 'vorversion-2026-10-13-081500.sqlite', createdAt: '2026-10-13T08:15:00.000Z', size: 512 * 1024 },
]
let sent: { url: string; method: string }[]
let listed: typeof VERSIONS
let restoreAnswer: { status: number, body: unknown }
beforeEach(() => {
  sent = []
  listed = VERSIONS
  restoreAnswer = { status: 200, body: { ok: true, notes: ['Ein Beleg, auf den dieser Stand verweist, fehlt im Belegordner, weil er seither gelöscht wurde: a.pdf.'] } }
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    sent.push({ url, method })
    const answer = method === 'GET' ? { status: 200, body: listed } : restoreAnswer
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const card = () => render(<UIProvider><PriorVersionsCard /></UIProvider>)

test('Die Karte zeigt jede Vorversion mit Zeitpunkt und Größe', async () => {
  card()
  expect((await screen.findAllByText(/20\.10\.2026/)).length).toBeGreaterThan(0)
  expect(screen.getAllByText(/13\.10\.2026/).length).toBeGreaterThan(0)
  expect(screen.getByText('2,0 MB')).toBeTruthy()
  expect(screen.getByText('512 KB')).toBeTruthy()
  expect(screen.getAllByRole('button', { name: /Einspielen …/ })).toHaveLength(2)
})

test('Ohne Vorversion sagt die Karte, wann die erste entsteht', async () => {
  listed = []
  card()
  expect(await screen.findByText(/Noch keine Vorversion/)).toBeTruthy()
})

test('Einspielen fragt zuerst; „Abbrechen“ schickt nichts', async () => {
  card()
  fireEvent.click((await screen.findAllByRole('button', { name: /Einspielen …/ }))[0])
  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getByText(/gelöscht/)).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(sent.filter((s) => s.method === 'POST')).toEqual([])
})

test('Nach der Rückfrage wird eingespielt, und die Hinweise des Servers stehen da', async () => {
  card()
  fireEvent.click((await screen.findAllByRole('button', { name: /Einspielen …/ }))[1])
  fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Einspielen' }))
  expect(await screen.findByText(/fehlt im Belegordner/)).toBeTruthy()
  expect(sent.filter((s) => s.method === 'POST').map((s) => s.url)).toEqual([`/api/prior-versions/${VERSIONS[1].name}/restore`])
})

test('Lehnt der Server ab, steht die Meldung als Mitteilung da', async () => {
  restoreAnswer = { status: 400, body: { error: 'Die Datenbank in dieser Vorversion ist beschädigt.' } }
  card()
  fireEvent.click((await screen.findAllByRole('button', { name: /Einspielen …/ }))[0])
  fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Einspielen' }))
  expect(await screen.findByText(/ist beschädigt/)).toBeTruthy()
})

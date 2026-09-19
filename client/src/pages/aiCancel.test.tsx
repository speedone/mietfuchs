// @vitest-environment jsdom
// „Abbrechen“ während einer KI-Auswertung, durch die echten Seiten gespielt: Der Beleg steht
// danach grau als „abgebrochen“ da, nicht als Fehler, und der Browser bricht beim Server über
// die Kennung ab. Das ist der Weg, der auch in der Programmdatei wirkt, wo der Server das
// Schließen der Verbindung nicht bemerkt.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Unit } from '../types'
import { YearProvider } from '../year'
import Kosten from './Kosten'
import Schnellerfassung from './Schnellerfassung'

const UNITS: Unit[] = [{ id: 'u1', name: 'EG', areaM2: 80, participates: true }]

let calls: string[]

beforeEach(() => {
  calls = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push(`${method} ${url}`)
    // Die Auswertung hängt, bis der Browser abbricht, wie bei einem langsamen Modell
    if (url === '/api/extract' || url === '/api/intake') {
      return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('abgebrochen', 'AbortError'))))
    }
    const data = method === 'GET' ? [] : { ok: true }
    return Promise.resolve(new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } }))
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function uploadAndCancel(container: HTMLElement) {
  const input = container.querySelector('input[type="file"][multiple]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File(['JPEG'], 'foto.jpg', { type: 'image/jpeg' })] } })
  fireEvent.click(await screen.findByRole('button', { name: 'Abbrechen' }))
  expect(await screen.findByText('abgebrochen')).toBeTruthy()
  expect(screen.queryByText('Fehler')).toBeNull()
  await waitFor(() => expect(calls.some((c) => /^POST \/api\/ai\/cancel\/[a-f0-9]{32}$/.test(c))).toBe(true))
}

test('Kosten: „Abbrechen“ stoppt die Auswertung', async () => {
  const { container } = render(
    <YearProvider>
      <Kosten units={UNITS} settings={null} />
    </YearProvider>,
  )
  await uploadAndCancel(container)
})

test('Schnellerfassung: „Abbrechen“ stoppt die Auswertung', async () => {
  const { container } = render(
    <YearProvider>
      <Schnellerfassung units={UNITS} settings={null} onNavigate={() => {}} />
    </YearProvider>,
  )
  await uploadAndCancel(container)
})

// @vitest-environment jsdom
// „Abbrechen“ während einer KI-Auswertung, durch die echten Seiten gespielt: Der Beleg steht
// danach grau als „abgebrochen“ da, nicht als Fehler, und der Browser bricht beim Server über
// die Kennung ab. Das ist der Weg, der auch in der Programmdatei wirkt, wo der Server das
// Schließen der Verbindung nicht bemerkt.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Unit } from '../types'
import { PeriodProvider } from '../period'
import { PropertyProvider } from '../property'
import Kosten from './Kosten'
import Belege from './Belege'

const UNITS: Unit[] = [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true }]

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
    // Der Beleg ist gespeichert, bevor er ausgewertet wird
    const data = method === 'GET' ? [] : url === '/api/upload' ? { file: '1_foto.jpg' } : { ok: true }
    return Promise.resolve(new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } }))
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function uploadAndCancel(container: HTMLElement) {
  // Die Seite erscheint erst, wenn die Objekte geladen sind (#92).
  const input = await waitFor(() => {
    const found = container.querySelector('input[type="file"][multiple]')
    if (!(found instanceof HTMLInputElement)) throw new Error('das Dateifeld ist noch nicht da')
    return found
  })
  fireEvent.change(input, { target: { files: [new File(['JPEG'], 'foto.jpg', { type: 'image/jpeg' })] } })
  fireEvent.click(await screen.findByRole('button', { name: 'Abbrechen' }))
  expect(await screen.findByText('abgebrochen')).toBeTruthy()
  expect(screen.queryByText('Fehler')).toBeNull()
  // Der Beleg ging vor der Auswertung in die Ablage und nur mit seinem Namen an die KI: Ein Abbruch löscht ihn nicht.
  expect(calls.filter((c) => c === 'POST /api/upload' || c === 'POST /api/intake')).toEqual(['POST /api/upload', 'POST /api/intake'])
  expect(screen.getByText('Der Beleg ist gespeichert und steht auf der Seite Belege im Eingang unter „Ohne Position“.')).toBeTruthy()
  await waitFor(() => expect(calls.some((c) => /^POST \/api\/ai\/cancel\/[a-f0-9]{32}$/.test(c))).toBe(true))
}

test('Kosten: „Abbrechen“ stoppt die Auswertung', async () => {
  const { container } = render(
    <PeriodProvider>
      <PropertyProvider>
        <Kosten units={UNITS} settings={null} />
      </PropertyProvider>
    </PeriodProvider>,
  )
  await uploadAndCancel(container)
})

test('Eingang: „Abbrechen“ stoppt die Auswertung', async () => {
  const { container } = render(
    <PeriodProvider>
      <PropertyProvider>
        <Belege view="eingang" units={UNITS} settings={null} onNavigate={() => {}} />
      </PropertyProvider>
    </PeriodProvider>,
  )
  await uploadAndCancel(container)
})

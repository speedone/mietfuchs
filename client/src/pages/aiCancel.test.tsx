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
// Der Beleg liegt nach dem Hochladen in der Ablage (GET /api/uploads)
let stored = new Set<string>()

beforeEach(() => {
  calls = []
  stored = new Set()
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push(`${method} ${url}`)
    // Die Auswertung hängt, bis der Browser abbricht, wie bei einem langsamen Modell
    if (url === '/api/extract' || url === '/api/intake') {
      return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('abgebrochen', 'AbortError'))))
    }
    // Der Beleg ist gespeichert, bevor er ausgewertet wird
    const sentFile = init?.body instanceof FormData ? init.body.get('file') : null
    const name = `1_${sentFile instanceof File ? sentFile.name : 'beleg'}`
    if (url === '/api/upload') stored.add(name)
    const data = method !== 'GET' ? (url === '/api/upload' ? { file: name } : { ok: true })
      : url === '/api/uploads' ? [...stored].map((file) => ({ file, size: 4, mtime: '2026-01-01T00:00:00.000Z', originalName: file.slice(2), mimeType: 'image/jpeg',
        uploadedAt: '2026-01-01T00:00:00.000Z', sha256: file, propertyId: null, year: null, invoiceDate: null, kind: 'receipt' })) : []
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
  // Der Satz kommt aus dem Bestand: Er steht, sobald die Seite den Beleg dort ohne Position sieht
  expect(await screen.findByText('Der Beleg ist gespeichert und steht auf der Seite Belege im Eingang unter „Ohne Position“.')).toBeTruthy()
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

// Durchsicht: Ist der Beleg danach gelöscht, behauptet der abgebrochene Eintrag nicht weiter, er liege unter „Ohne Position“.
test('Eingang: nach dem Löschen des Belegs steht der Satz nicht mehr da', async () => {
  const { container } = render(
    <PeriodProvider>
      <PropertyProvider>
        <Belege view="eingang" units={UNITS} settings={null} onNavigate={() => {}} />
      </PropertyProvider>
    </PeriodProvider>,
  )
  await uploadAndCancel(container)
  // anderswo gelöscht (Ordner, zweiter Tab); die Seite lädt ihren Bestand mit der nächsten Antwort der Schlange neu
  stored.delete('1_foto.jpg')
  const input = container.querySelector('input[aria-label="Belege und Zählerfotos auswählen"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File(['JPEG'], 'zwei.jpg', { type: 'image/jpeg' })] } })
  fireEvent.click(await screen.findByRole('button', { name: 'Abbrechen' }))
  await waitFor(() => expect(screen.getAllByText('abgebrochen')).toHaveLength(2))
  // Der Satz steht nur noch am zweiten Eintrag, dessen Beleg in der Ablage liegt
  await waitFor(() => expect(screen.getAllByText(/steht auf der Seite Belege im Eingang unter „Ohne Position“/)).toHaveLength(1))
  const first = [...container.querySelectorAll('[data-queue-entry]')].find((x) => x.textContent?.includes('foto.jpg'))
  expect(first?.textContent).toContain('abgebrochen')
  expect(first?.textContent).not.toContain('Ohne Position')
})

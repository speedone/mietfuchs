// @vitest-environment jsdom
// Eine Rechnungsposition ohne Betrag, durch die echten Seiten gespielt. Das Schema verlangt
// einen Betrag, erzwungen wird das aber nicht immer: Lehnt ein Dienst das Schema ab, fällt
// ai/openai.ts stufenweise bis auf „nur Prompt“ zurück, und ein kleines Modell auf dem eigenen
// Rechner antwortet dann, wie es mag. Genau diese Modelle sind die Voreinstellung.
//
// Die Position muss dann mit leerem Betragsfeld dastehen, damit ein Mensch ihn eintragen kann.
// Vorher rief die Seite `p.amountEur.toLocaleString(…)` unmittelbar auf: Die ganze Auswertung
// des Belegs brach ab und wurde als Fehler angezeigt, obwohl alles andere brauchbar war.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Extraction, Unit } from '../types'
import { YearProvider } from '../year'
import Kosten from './Kosten'
import Schnellerfassung from './Schnellerfassung'

const UNITS: Unit[] = [{ id: 'u1', name: 'EG', areaM2: 80, participates: true }]

// Die zweite Position hat keinen Betrag, so wie der Server sie durchlässt (toExtraction in
// server/src/extract.ts verwirft nur, was niemand gebrauchen kann).
const EXTRACTION: Extraction = {
  vendor: 'Stadtwerke Musterstadt',
  invoiceDate: '2025-03-01',
  totalGrossEur: 42.5,
  positions: [
    { description: 'Frischwasser', category: 'Wasser/Abwasser', amountEur: 12.5 },
    { description: 'Grundgebühr', category: 'Wasser/Abwasser' },
  ],
}

beforeEach(() => {
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const answer = (data: unknown) =>
      Promise.resolve(new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } }))
    if (url === '/api/extract') return answer({ file: 'beleg.jpg', extraction: EXTRACTION })
    if (url === '/api/intake') return answer({ file: 'beleg.jpg', kind: 'rechnung', extraction: EXTRACTION })
    return answer(method === 'GET' ? [] : { ok: true })
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const upload = (container: HTMLElement) => {
  const input = container.querySelector('input[type="file"][multiple]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File(['JPEG'], 'rechnung.jpg', { type: 'image/jpeg' })] } })
}

// In der Zeile einer Position stehen vier Eingabefelder, auf beiden Seiten in derselben
// Reihenfolge: Haken, Beschreibung, Betrag, §35a-Lohn.
function amountFieldOf(description: string): HTMLInputElement {
  const row = screen.getByDisplayValue(description).closest('tr')
  if (!row) throw new Error(`Keine Zeile zu „${description}“ gefunden`)
  const inputs = [...row.querySelectorAll('input')]
  expect(inputs).toHaveLength(4)
  return inputs[2]
}

async function expectBothPositions() {
  // Der Beleg ist ausgewertet, nicht abgebrochen
  expect(await screen.findByDisplayValue('Frischwasser')).toBeTruthy()
  expect(screen.queryByText('Fehler')).toBeNull()
  // Der gelesene Betrag steht da, der fehlende bleibt leer statt die Anzeige zu sprengen
  expect(amountFieldOf('Frischwasser').value).toBe('12,50')
  expect(screen.getByDisplayValue('Grundgebühr')).toBeTruthy()
  expect(amountFieldOf('Grundgebühr').value).toBe('')
}

test('Kosten: eine Position ohne Betrag wird mit leerem Feld angezeigt', async () => {
  const { container } = render(
    <YearProvider>
      <Kosten units={UNITS} settings={null} />
    </YearProvider>,
  )
  upload(container)
  await expectBothPositions()
})

test('Schnellerfassung: eine Position ohne Betrag wird mit leerem Feld angezeigt und rot bewertet', async () => {
  const { container } = render(
    <YearProvider>
      <Schnellerfassung units={UNITS} settings={null} onNavigate={() => {}} />
    </YearProvider>,
  )
  upload(container)
  await expectBothPositions()
  // Die Ampel sagt, was zu tun ist, statt die Position stillschweigend zu verschlucken
  expect(screen.getByText('Betrag fehlt oder ist 0')).toBeTruthy()
})

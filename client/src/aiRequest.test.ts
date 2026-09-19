// @vitest-environment jsdom
// jsdom für pagehide und navigator.sendBeacon; fetch, Response und ReadableStream kommen von Node.
import { afterEach, describe, expect, test, vi } from 'vitest'
import { aiRequest, fmtElapsed, progressText, type AiProgress } from './aiRequest'

// Antwort als Strom aus Byte-Stücken. Die Stücke schneiden Zeilen absichtlich mittendurch, so
// wie ein echter Netzwerkstrom sie liefert.
function streamResponse(text: string, pieceSize = 7) {
  const bytes = new TextEncoder().encode(text)
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += pieceSize) controller.enqueue(bytes.slice(i, i + pieceSize))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'application/x-ndjson; charset=utf-8' } })
}
const ndjson = (...lines: unknown[]) => lines.map((l) => JSON.stringify(l)).join('\n') + '\n'

let requests: { url: string; init?: RequestInit }[]
function serve(response: () => Response) {
  requests = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    requests.push({ url, init })
    return response()
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('aiRequest', () => {
  test('fordert den Strom an, meldet den Fortschritt und liefert das Ergebnis', async () => {
    serve(() => streamResponse(ndjson(
      { type: 'progress', step: 'extraction', phase: 'waiting' },
      { type: 'heartbeat' },
      { type: 'progress', step: 'extraction', phase: 'writing', chars: 120 },
      { type: 'result', data: { file: 'a.pdf', extraction: { vendor: 'Stadtwerke' } } },
    )))
    const progress: AiProgress[] = []
    const result = await aiRequest<{ file: string }>('/api/extract', new FormData(), { onProgress: (p) => progress.push(p) })
    expect(result).toEqual({ file: 'a.pdf', extraction: { vendor: 'Stadtwerke' } })
    expect(progress.map((p) => `${p.step}:${p.phase}`)).toEqual(['extraction:waiting', 'extraction:writing'])
    expect(new Headers(requests[0].init?.headers).get('accept')).toBe('application/x-ndjson')
    expect(requests[0].init?.method).toBe('POST')
  })

  test('ein Fehler im Strom wird zur Fehlermeldung', async () => {
    serve(() => streamResponse(ndjson({ type: 'error', error: 'Ollama ist nicht erreichbar.', file: 'a.pdf' })))
    await expect(aiRequest('/api/extract', new FormData())).rejects.toThrow('Ollama ist nicht erreichbar.')
  })

  test('endet der Strom ohne Ergebnis, gibt es eine klare Meldung', async () => {
    serve(() => streamResponse(ndjson({ type: 'progress', step: 'extraction', phase: 'waiting' })))
    await expect(aiRequest('/api/extract', new FormData())).rejects.toThrow(/brach ab/)
  })

  // Ein Server ohne Strom (ältere Version) oder ein Fehler vor dem Start, etwa bei zu großer Datei
  test('eine gewöhnliche JSON-Antwort wird wie bisher gelesen', async () => {
    serve(() => new Response(JSON.stringify({ file: 'a.pdf' }), { status: 200, headers: { 'content-type': 'application/json' } }))
    expect(await aiRequest('/api/extract', new FormData())).toEqual({ file: 'a.pdf' })
  })

  test('ein gewöhnlicher Fehler vor dem Start nennt die Meldung des Servers', async () => {
    serve(() => new Response(JSON.stringify({ error: 'Die Datei ist größer als 25 MB.' }), { status: 400, headers: { 'content-type': 'application/json' } }))
    await expect(aiRequest('/api/extract', new FormData())).rejects.toThrow('Die Datei ist größer als 25 MB.')
  })

  test('reicht den Abbruch an fetch weiter', async () => {
    serve(() => streamResponse(ndjson({ type: 'result', data: {} })))
    const controller = new AbortController()
    await aiRequest('/api/extract', new FormData(), { signal: controller.signal })
    expect(requests[0].init?.signal).toBe(controller.signal)
  })

  test('eine Antwort, die kein JSON ist, ergibt eine klare Meldung', async () => {
    serve(() => new Response('<html>Proxy-Fehler</html>', { status: 200, headers: { 'content-type': 'text/html' } }))
    await expect(aiRequest('/api/extract', new FormData())).rejects.toThrow(/unerwartete Antwort/)
  })
})

// Dass der Browser die Verbindung schließt, kommt nicht überall beim Server an (Bun 1.3, Proxys).
// Jede Auswertung trägt deshalb eine Kennung, über die der Browser ausdrücklich abbricht.
describe('Abbrechen über die Kennung', () => {
  // wie fetch: hängt, bis das Signal abbricht
  function serveHanging() {
    requests = []
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      requests.push({ url, init })
      if (url.startsWith('/api/ai/cancel/')) return Promise.resolve(new Response('{"ok":true}', { status: 200 }))
      return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('abgebrochen', 'AbortError'))))
    })
  }
  const requestIdOf = () => (requests[0].init?.body as FormData).get('requestId') as string

  test('jede Auswertung schickt eine zufällige Kennung mit', async () => {
    serve(() => streamResponse(ndjson({ type: 'result', data: {} })))
    await aiRequest('/api/extract', new FormData())
    const first = requestIdOf()
    await aiRequest('/api/extract', new FormData())
    const second = (requests[1].init?.body as FormData).get('requestId')
    expect(first).toMatch(/^[a-f0-9]{32}$/)
    expect(second).not.toBe(first)
  })

  test('Abbrechen ruft den Abbruch beim Server auf', async () => {
    serveHanging()
    const controller = new AbortController()
    const pending = aiRequest('/api/extract', new FormData(), { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toThrow()
    const cancel = requests.find((r) => r.url.startsWith('/api/ai/cancel/'))
    expect(cancel?.url).toBe(`/api/ai/cancel/${requestIdOf()}`)
    expect(cancel?.init?.method).toBe('POST')
    expect(cancel?.init?.keepalive).toBe(true)
  })

  test('schließt jemand den Tab, geht der Abbruch per sendBeacon hinaus', async () => {
    serveHanging()
    const beacon = vi.fn(() => true)
    vi.stubGlobal('navigator', { sendBeacon: beacon })
    const controller = new AbortController()
    const pending = aiRequest('/api/extract', new FormData(), { signal: controller.signal }).catch(() => null)
    window.dispatchEvent(new Event('pagehide'))
    expect(beacon).toHaveBeenCalledWith(`/api/ai/cancel/${requestIdOf()}`)
    controller.abort()
    await pending
  })

  test('nach dem Ende einer Auswertung löst pagehide nichts mehr aus', async () => {
    serve(() => streamResponse(ndjson({ type: 'result', data: {} })))
    const beacon = vi.fn(() => true)
    vi.stubGlobal('navigator', { sendBeacon: beacon })
    await aiRequest('/api/extract', new FormData())
    window.dispatchEvent(new Event('pagehide'))
    expect(beacon).not.toHaveBeenCalled()
  })
})

describe('Fortschritt in Worten', () => {
  test('vor der ersten Meldung', () => expect(progressText(null)).toBe('Beleg wird übertragen …'))
  test('Modell liest', () => expect(progressText({ step: 'extraction', phase: 'waiting' })).toBe('Modell liest den Beleg …'))
  test('Modell schreibt, mit Zeichenzahl', () =>
    expect(progressText({ step: 'extraction', phase: 'writing', chars: 1234 })).toBe('Modell schreibt die Auswertung (1.234 Zeichen) …'))
  // Reasoning-Modelle bei OpenAI-kompatiblen Diensten denken vor der Antwort nach
  test('Modell denkt nach, mit Zeichenzahl', () =>
    expect(progressText({ step: 'extraction', phase: 'thinking', chars: 2048 })).toBe('Modell denkt nach (2.048 Zeichen) …'))
  test('Kostenarten', () => expect(progressText({ step: 'classification', phase: 'waiting' })).toBe('Kostenarten werden zugeordnet …'))
  test('Belegart', () => expect(progressText({ step: 'docType', phase: 'writing', chars: 5 })).toBe('Belegart wird erkannt …'))
  test('Zählerstand', () => expect(progressText({ step: 'meterReading', phase: 'waiting' })).toBe('Zählerstand wird gelesen …'))
})

test('verstrichene Zeit', () => {
  expect(fmtElapsed(0)).toBe('0:00')
  expect(fmtElapsed(65_400)).toBe('1:05')
  expect(fmtElapsed(12 * 60_000 + 3_000)).toBe('12:03')
})

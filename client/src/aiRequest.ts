// KI-Auswertung aus dem Browser. Die Anfrage fordert die Antwort als Strom an (siehe
// aiResponse in server/src/index.js): Die Header kommen sofort, dann Fortschritt und
// Lebenszeichen, zuletzt Ergebnis oder Fehler, je eine JSON-Zeile. So bricht Firefox eine
// minutenlange Auswertung nicht nach fünf Minuten ab, und die Oberfläche kann zeigen, dass das
// Modell arbeitet. Geprüft in client/src/aiRequest.test.ts.

export type AiStep = 'extraction' | 'classification' | 'docType' | 'meterReading'
// 'thinking': ein Reasoning-Modell denkt vor der Antwort nach (nur OpenAI-kompatible Dienste)
export type AiProgress = { step: AiStep; phase: 'waiting' | 'thinking' | 'writing'; chars?: number }

// Fortschritt beim Laden eines Modells (#33). `phase` ist der Schritt, den Ollama meldet.
export type PullProgress = { step: 'pull'; phase: string; completed?: number | null; total?: number | null }
type StreamProgress = AiProgress | PullProgress

type StreamMessage =
  | ({ type: 'progress' } & StreamProgress)
  | { type: 'heartbeat' }
  | { type: 'result'; data: unknown }
  | { type: 'error'; error: string }

const NDJSON = 'application/x-ndjson'

// Zeilen aus dem Strom. Bewusst über getReader() statt `for await`, das Safari erst seit Kurzem
// für ReadableStream kann.
async function* lines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let rest = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      rest += decoder.decode(value, { stream: true })
      let end
      while ((end = rest.indexOf('\n')) >= 0) {
        const line = rest.slice(0, end).trim()
        rest = rest.slice(end + 1)
        if (line) yield line
      }
    }
    rest = (rest + decoder.decode()).trim()
    if (rest) yield rest
  } finally {
    reader.releaseLock()
  }
}

// Kennung einer Auswertung. Bewusst über getRandomValues: crypto.randomUUID gibt es nur in
// sicheren Kontexten, also nicht, wenn Mietfuchs im Heimnetz über http://192.168.… läuft.
function newRequestId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
}

// Dass der Browser die Verbindung schließt, kommt nicht überall beim Server an (Bun 1.3, Proxys).
// Jede Auswertung trägt deshalb eine Kennung, und abgebrochen wird ausdrücklich: beim Abbrechen
// per fetch mit keepalive, beim Schließen des Tabs per sendBeacon (fetch käme dort zu spät).
export async function aiRequest<T>(
  path: string,
  body: FormData,
  { onProgress, signal }: { onProgress?: (progress: AiProgress) => void; signal?: AbortSignal } = {},
): Promise<T> {
  const requestId = newRequestId()
  body.set('requestId', requestId)
  return withCancel(requestId, signal, async () =>
    readAnswer<T>(await fetch(path, { method: 'POST', body, headers: { Accept: NDJSON }, signal }), (p) => onProgress?.(p as AiProgress)))
}

// Ein Modell über den Server laden (#33). Derselbe Strom wie bei der Auswertung, nur mit
// JSON-Rumpf. Abbrechen geht genauso über die Kennung; Ollama setzt beim nächsten Versuch dort
// fort, wo es aufgehört hat.
export async function pullModel(
  model: string,
  { slot = 'text', onProgress, signal }: { slot?: 'text' | 'images'; onProgress?: (progress: PullProgress) => void; signal?: AbortSignal } = {},
): Promise<{ model: string }> {
  const requestId = newRequestId()
  return withCancel(requestId, signal, async () =>
    readAnswer<{ model: string }>(
      await fetch('/api/ai/pull', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Accept: NDJSON },
        body: JSON.stringify({ model, slot, requestId }),
        signal,
      }),
      (p) => onProgress?.(p as PullProgress),
    ))
}

// Abbruch ausdrücklich melden: beim Abbrechen per fetch mit keepalive, beim Schließen des Tabs
// per sendBeacon (fetch käme dort zu spät).
async function withCancel<T>(requestId: string, signal: AbortSignal | undefined, run: () => Promise<T>): Promise<T> {
  const cancelUrl = `/api/ai/cancel/${requestId}`
  const onAbort = () => { void fetch(cancelUrl, { method: 'POST', keepalive: true }).catch(() => {}) }
  const onPageHide = () => { navigator.sendBeacon?.(cancelUrl) }
  signal?.addEventListener('abort', onAbort, { once: true })
  if (typeof window !== 'undefined') window.addEventListener('pagehide', onPageHide)
  try {
    return await run()
  } finally {
    signal?.removeEventListener('abort', onAbort)
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', onPageHide)
  }
}

async function readAnswer<T>(res: Response, onProgress?: (progress: StreamProgress) => void): Promise<T> {
  if (!(res.headers.get('content-type') ?? '').includes(NDJSON) || !res.body) {
    // Server ohne Strom (ältere Version) oder ein Fehler vor dem Start, etwa bei zu großer Datei
    let data: { error?: string }
    try {
      data = (await res.json()) as { error?: string }
    } catch {
      throw new Error(`Mietfuchs lieferte eine unerwartete Antwort (${res.status} ${res.statusText}).`)
    }
    if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`)
    return data as T
  }
  for await (const line of lines(res.body)) {
    const message = JSON.parse(line) as StreamMessage
    if (message.type === 'progress') {
      const { type: _type, ...progress } = message
      onProgress?.(progress as StreamProgress)
    }
    else if (message.type === 'result') return message.data as T
    else if (message.type === 'error') throw new Error(message.error)
  }
  throw new Error('Die Verbindung zu Mietfuchs brach ab, bevor die Auswertung fertig war.')
}

export function progressText(progress: AiProgress | null): string {
  if (!progress) return 'Beleg wird übertragen …'
  switch (progress.step) {
    case 'docType':
      return 'Belegart wird erkannt …'
    case 'classification':
      return 'Kostenarten werden zugeordnet …'
    case 'meterReading':
      return 'Zählerstand wird gelesen …'
    case 'extraction':
      if (progress.phase === 'writing' && progress.chars) return `Modell schreibt die Auswertung (${progress.chars.toLocaleString('de-DE')} Zeichen) …`
      if (progress.phase === 'thinking' && progress.chars) return `Modell denkt nach (${progress.chars.toLocaleString('de-DE')} Zeichen) …`
      return 'Modell liest den Beleg …'
  }
}

export function fmtElapsed(ms: number): string {
  const total = Math.floor(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

// KI-Auswertung aus dem Browser. Die Anfrage fordert die Antwort als Strom an (siehe
// aiResponse in server/src/index.js): Die Header kommen sofort, dann Fortschritt und
// Lebenszeichen, zuletzt Ergebnis oder Fehler, je eine JSON-Zeile. So bricht Firefox eine
// minutenlange Auswertung nicht nach fünf Minuten ab, und die Oberfläche kann zeigen, dass das
// Modell arbeitet. Geprüft in client/src/aiRequest.test.ts.

export type AiStep = 'extraction' | 'classification' | 'docType' | 'meterReading'
export type AiProgress = { step: AiStep; phase: 'waiting' | 'writing'; chars?: number }

type StreamMessage =
  | ({ type: 'progress' } & AiProgress)
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

export async function aiRequest<T>(
  path: string,
  body: FormData,
  { onProgress, signal }: { onProgress?: (progress: AiProgress) => void; signal?: AbortSignal } = {},
): Promise<T> {
  const res = await fetch(path, { method: 'POST', body, headers: { Accept: NDJSON }, signal })
  if (!(res.headers.get('content-type') ?? '').includes(NDJSON) || !res.body) {
    // Server ohne Strom (ältere Version) oder ein Fehler vor dem Start, etwa bei zu großer Datei
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`)
    return data as T
  }
  for await (const line of lines(res.body)) {
    const message = JSON.parse(line) as StreamMessage
    if (message.type === 'progress') onProgress?.({ step: message.step, phase: message.phase, chars: message.chars })
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
      return progress.phase === 'writing' && progress.chars
        ? `Modell schreibt die Auswertung (${progress.chars.toLocaleString('de-DE')} Zeichen) …`
        : 'Modell liest den Beleg …'
  }
}

export function fmtElapsed(ms: number): string {
  const total = Math.floor(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

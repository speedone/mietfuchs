// Anbindung an Ollama (https://github.com/ollama/ollama/blob/main/docs/api.md). Setzt die
// Schnittstelle aus ai/index.js um und liefert dazu, was es nur bei Ollama gibt: die
// installierten Modelle mit ihren Fähigkeiten und die Suche nach Ollama unter den üblichen
// Adressen.
//
// Die Funktionen bekommen die Konfiguration aus providerConfig (ai/index.js): `url`, `model`,
// `apiKey` (für Ollama hinter einem Proxy oder Ollama Cloud, sonst null) und `numCtx`.
import type { AiModel } from '../../../shared/types.ts'
import { openRequest, readLines, readText, maskSecret, type HttpResponse } from './http.ts'
import { providerError, isProviderError } from './errors.ts'

// Was ollama.ts von providerConfig (ai/index.ts) braucht
export type OllamaConfig = {
  url: string
  model: string
  apiKey: string | null
  numCtx: number | null
  preset: string
}

// Ein Bild für den Anbieter: Base64 in `data` (Ollama braucht keine Typangabe, OpenAI-kompatible
// Dienste in openai.ts schon). Dieser und die folgenden Typen beschreiben die Schnittstelle
// jedes Anbieters (siehe ai/index.ts); hier definiert, weil ollama.ts als erstes der beiden
// Provider-Module auf TypeScript umgestellt wurde, und von openai.ts wiederverwendet.
export type ProviderImage = { mimeType: string; data: string }

export type ProviderProgressEvent =
  | { phase: 'waiting' }
  | { phase: 'writing'; chars: number }
  | { phase: 'thinking'; chars: number }

// Eine sehr lose Beschreibung des in extract.js verwendeten JSON-Schemas: nur die Felder, die
// ein Anbieter tatsächlich ausliest oder umformt (toStrictSchema/stripAddedNulls in openai.ts).
export type JsonSchema = {
  type?: string | string[]
  description?: string
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
  required?: string[]
  enum?: (string | number | boolean | null)[]
  additionalProperties?: boolean
  minItems?: number
  maxItems?: number
}

export type ProviderRequest = {
  prompt: string
  images?: ProviderImage[]
  schema: JsonSchema
  timeoutMs: number
  signal?: AbortSignal
  onProgress?: (event: ProviderProgressEvent) => void
}
export type ProviderStats = { promptTokens: number | null; outputTokens: number | null; seconds: number | null; loadSeconds: number | null }
export type ProviderResult = { data: Record<string, unknown>; stats: ProviderStats }
export type Provider = {
  isRemoteModel?: (signal?: AbortSignal) => Promise<boolean>
  json: (request: ProviderRequest) => Promise<ProviderResult>
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const numberOrNull = (v: unknown): number | null => (typeof v === 'number' ? v : null)

const baseUrl = (config: OllamaConfig): string => config.url.replace(/\/+$/, '')

// Ohne Angabe nimmt Ollama bei weniger als 24 GB Grafikspeicher 4096 Token Kontext und kürzt
// längere Anfragen stillschweigend. Eine Rechnung mit 20.000 Zeichen Text braucht grob 7.000
// Token, vier Seitenbilder bei Qwen-Modellen etwa 10.000. Der Wert ist fest, denn ein anderer
// Wert als bei der vorigen Anfrage lässt Ollama das Modell neu laden. Unter „Erweitert“ (oder
// mit NKA_OLLAMA_NUM_CTX) lässt er sich ändern, etwa für Rechner mit wenig Arbeitsspeicher.
const DEFAULT_NUM_CTX = 16384
const numCtx = (config: OllamaConfig): number => config.numCtx ?? DEFAULT_NUM_CTX

// Zuerst, was jeder tun kann: Beim ersten Beleg lädt Ollama das Modell erst in den Speicher, ein
// zweiter Versuch geht deshalb oft schneller.
const timeoutMessage = (ms: number): string =>
  `Ollama hat nicht innerhalb von ${Math.round(ms / 1000)} Sekunden geantwortet. Beim ersten Beleg lädt Ollama das Modell erst in den Speicher, ein zweiter Versuch geht oft schneller. Ohne Grafikkarte ist ein großes Modell oft zu langsam, dann hilft ein kleineres Modell. Das Zeitlimit lässt sich in den Einstellungen unter „Erweitert“ erhöhen.`

type ErrorContext = { timeout: AbortSignal; signal?: AbortSignal; timeoutMs: number; base: string; connected: boolean }

// Übersetzt, was beim Verbinden oder Lesen schiefgeht, in eine verständliche Meldung. Das
// Zeitlimit hat Vorrang: Es bricht die Verbindung ab, was sonst wie ein Netzfehler aussähe.
function translateError(err: unknown, { timeout, signal, timeoutMs, base, connected }: ErrorContext): Error {
  if (timeout.aborted) return providerError(timeoutMessage(timeoutMs))
  if (signal?.aborted) {
    const cancelled = new Error('Die Auswertung wurde abgebrochen.')
    cancelled.name = 'AbortError'
    return cancelled
  }
  if (isProviderError(err)) return err
  if (!connected) {
    return providerError(`Ollama ist unter ${base} nicht erreichbar. Läuft Ollama? Die Adresse steht in den Einstellungen.`, { unreachable: true }) // nur dann lohnt die Suche unter anderen Adressen
  }
  return providerError(`Die Verbindung zu Ollama brach während der Antwort ab (${err instanceof Error ? err.message : String(err)}).`)
}

// Antwort als JSON, mit klarer Meldung statt eines rohen Absturzes, wenn Ollama entgegen der
// eigenen Dokumentation kein Objekt liefert (etwa ein bloßes `null`).
async function readJson(res: HttpResponse): Promise<Record<string, unknown>> {
  const text = await readText(res.body)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw providerError(`Ollama lieferte eine unlesbare Antwort: ${text.slice(0, 200)}`)
  }
  if (!isObject(parsed)) throw providerError(`Ollama lieferte eine unlesbare Antwort: ${text.slice(0, 200)}`)
  return parsed
}

// Die Meldung aus einer Fehlerantwort von Ollama ({ "error": "…" }), sonst der Text selbst
function errorDetail(text: string): string {
  try {
    const parsed: unknown = JSON.parse(text)
    if (isObject(parsed) && typeof parsed.error === 'string') return parsed.error
  } catch {
    // kein JSON
  }
  return text
}

type RequestOptions<T> = {
  body?: Record<string, unknown>
  timeoutMs: number
  signal?: AbortSignal
  consume: (res: HttpResponse) => Promise<T>
}

// Gemeinsamer Weg für alle Anfragen. `timeoutMs` und `signal` (Abbruch durch den Aufrufer)
// gelten für die ganze Anfrage einschließlich des Lesens der Antwort in `consume`.
async function request<T>(config: OllamaConfig, path: string, { body, timeoutMs, signal, consume }: RequestOptions<T>): Promise<T> {
  const base = baseUrl(config)
  const timeout = AbortSignal.timeout(timeoutMs)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  const context: ErrorContext = { timeout, signal, timeoutMs, base, connected: false }
  const headers: Record<string, string> = body ? { 'Content-Type': 'application/json' } : {}
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`
  let res: HttpResponse
  try {
    res = await openRequest(`${base}${path}`, {
      method: body ? 'POST' : 'GET',
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: combined,
    })
  } catch (err) {
    throw translateError(err, context)
  }
  context.connected = true
  try {
    if (!res.ok) {
      // Ein Proxy vor Ollama kann die abgelehnte Anfrage samt Kopfzeilen zurückgeben
      const detail = maskSecret(config.apiKey, errorDetail(await readText(res.body).catch(() => '')))
      const failWith = (message: string) => providerError(message, { status: res.status, detail })
      if (res.status === 401 || res.status === 403) {
        throw failWith(config.apiKey
          ? `Ollama unter ${base} lehnt den Schlüssel ab. Bitte den Schlüssel in den Einstellungen prüfen.`
          : `Ollama unter ${base} verlangt einen Schlüssel. Bitte in den Einstellungen einen eintragen.`)
      }
      if (res.status === 404 && body?.model) {
        throw failWith(config.preset === 'ollama-cloud'
          ? `Das Modell „${String(body.model)}“ gibt es bei Ollama Cloud nicht. Bitte in den Einstellungen ein anderes wählen.`
          : `Das Modell „${String(body.model)}“ ist in Ollama nicht installiert. In den Einstellungen ein installiertes Modell wählen oder es mit „ollama pull ${String(body.model)}“ laden.`)
      }
      throw failWith(`Ollama antwortet mit ${res.status}: ${detail.slice(0, 300)}`)
    }
    return await consume(res)
  } catch (err) {
    throw translateError(err, context)
  }
}

// Liest die gestreamte Chat-Antwort: zeilenweise JSON, die letzte Zeile mit `done: true`
// trägt den Grund des Endes und die Kennzahlen. `onProgress` erfährt die bisherige Länge.
async function readChatStream(
  res: HttpResponse,
  onProgress: ((event: ProviderProgressEvent) => void) | undefined,
  contextTokens: number,
  apiKey: string | null,
): Promise<{ content: string; final: Record<string, unknown> }> {
  let content = ''
  let final: Record<string, unknown> | null = null
  for await (const line of readLines(res.body)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      throw providerError(`Ollama lieferte eine unlesbare Antwort: ${maskSecret(apiKey, line).slice(0, 200)}`)
    }
    if (!isObject(parsed)) throw providerError(`Ollama lieferte eine unlesbare Antwort: ${maskSecret(apiKey, line).slice(0, 200)}`)
    const part = parsed
    if (part.error) throw providerError(`Ollama meldet einen Fehler: ${maskSecret(apiKey, part.error).slice(0, 300)}`)
    const message = isObject(part.message) ? part.message : undefined
    const piece = typeof message?.content === 'string' ? message.content : ''
    content += piece
    if (piece) onProgress?.({ phase: 'writing', chars: content.length })
    if (part.done) final = part
  }
  if (!final) throw providerError('Die Antwort von Ollama brach vorzeitig ab.')
  // Ohne Obergrenze für die Ausgabe endet eine Antwort nur am Kontextende vorzeitig
  if (final.done_reason === 'length') {
    throw providerError(`Die Antwort von Ollama wurde abgeschnitten, weil der Kontext von ${contextTokens} Token nicht reicht. In den Einstellungen unter „Erweitert“ lässt er sich vergrößern.`)
  }
  return { content, final }
}

const seconds = (ns: unknown): number | null => (typeof ns === 'number' ? Math.round(ns / 1e8) / 10 : null)

type Capabilities = { capabilities: string[] | null; remote: boolean }

// Fähigkeiten laut /api/show, etwa ['completion', 'vision']. Ältere Versionen kennen das Feld
// nicht, dann null. `remote`: Ollama reicht Anfragen an dieses Modell an einen Cloud-Dienst weiter.
// Eine Minute gemerkt: Vor jeder Auswertung fragt Mietfuchs, ob das Modell in der Cloud läuft,
// bei Bildern auch, ob es sie versteht. Ein gerade neu geladenes Modell soll trotzdem bald
// richtig erkannt werden.
const CAPABILITIES_TTL_MS = 60000
const capabilityCache = new Map<string, { at: number; value: Capabilities }>()

async function getCapabilities(config: OllamaConfig, model: string, signal?: AbortSignal): Promise<Capabilities> {
  const key = `${baseUrl(config)}|${model}`
  const cached = capabilityCache.get(key)
  if (cached && Date.now() - cached.at < CAPABILITIES_TTL_MS) return cached.value
  const info = await request(config, '/api/show', { body: { model }, timeoutMs: 10000, signal, consume: readJson })
  const capsField = info.capabilities
  const value: Capabilities = { capabilities: Array.isArray(capsField) ? (capsField as string[]) : null, remote: Boolean(info.remote_host) }
  capabilityCache.set(key, { at: Date.now(), value })
  return value
}

// Modelle, die `think: false` abgelehnt haben (je Adresse und Modell, solange der Server läuft).
// Lokal übergeht Ollama den Schalter bei Modellen ohne Nachdenken; manche Modelle bei Ollama
// Cloud lassen sich das Nachdenken aber nicht abschalten und antworten mit 400.
const thinkOffRejected = new Set<string>()
const rejectsThinkOff = (err: unknown): boolean => isProviderError(err) && err.status === 400 && /think/i.test(err.detail ?? '')

export function ollamaProvider(config: OllamaConfig): Provider {
  const { model } = config
  const thinkKey = `${baseUrl(config)}|${model}`
  return {
    // Reicht Ollama das Modell an einen Cloud-Dienst weiter (Modelle wie „…:cloud“)?
    async isRemoteModel(signal?: AbortSignal): Promise<boolean> {
      return (await getCapabilities(config, model, signal)).remote
    },

    async json({ prompt, images = [], schema, timeoutMs, signal, onProgress }: ProviderRequest): Promise<ProviderResult> {
      onProgress?.({ phase: 'waiting' })
      const message: { role: 'user'; content: string; images?: string[] } = { role: 'user', content: prompt }
      if (images.length > 0) {
        // Kennt Ollama die Fähigkeiten nicht (ältere Version), wird es versucht
        const { capabilities } = await getCapabilities(config, model, signal)
        if (capabilities && !capabilities.includes('vision')) {
          throw providerError(`Das Modell „${model}“ versteht keine Bilder. Für Fotos und gescannte PDFs in den Einstellungen ein Modell mit Bildverständnis wählen.`)
        }
        message.images = images.map((image) => image.data) // Ollama nimmt reines Base64 ohne Typangabe
      }
      const contextTokens = numCtx(config)
      const chat = (withThinkOff: boolean) => request(config, '/api/chat', {
        body: {
          model,
          messages: [message],
          stream: true,
          format: schema,
          // Neuere Modelle denken sonst erst ausführlich nach. Für das Auslesen einer Rechnung
          // bringt das wenig und kostet auf dem Prozessor Minuten. Modelle ohne diese
          // Fähigkeit übergehen den Schalter.
          ...(withThinkOff ? { think: false } : {}),
          options: { temperature: 0, num_ctx: contextTokens },
        },
        timeoutMs,
        signal,
        consume: (res: HttpResponse) => readChatStream(res, onProgress, contextTokens, config.apiKey),
      })
      let answer: { content: string; final: Record<string, unknown> }
      try {
        answer = await chat(!thinkOffRejected.has(thinkKey))
      } catch (err) {
        if (thinkOffRejected.has(thinkKey) || !rejectsThinkOff(err)) throw err
        thinkOffRejected.add(thinkKey)
        answer = await chat(false)
      }
      const { content, final } = answer
      let data: Record<string, unknown>
      try {
        const parsed: unknown = JSON.parse(content || '{}')
        if (!isObject(parsed)) throw new Error('nicht verwertbar')
        data = parsed
      } catch {
        throw providerError(`Ollama lieferte kein gültiges JSON: ${content.slice(0, 200)}`)
      }
      const stats: ProviderStats = {
        promptTokens: numberOrNull(final.prompt_eval_count),
        outputTokens: numberOrNull(final.eval_count),
        seconds: seconds(final.total_duration),
        loadSeconds: seconds(final.load_duration),
      }
      return { data, stats }
    },
  }
}

// Ein Modell laden (#33). Ollama streamt den Fortschritt: erst das Verzeichnis, dann je Schicht
// `total` und `completed` in Bytes, zuletzt `success`. Ein Abbruch ist harmlos, Ollama setzt
// beim nächsten Versuch dort fort, wo es aufgehört hat. Das Zeitlimit ist großzügig: Mehrere
// Gigabyte brauchen über eine langsame Leitung Stunden.
const PULL_TIMEOUT_MS = 6 * 60 * 60 * 1000

export type PullProgressEvent = { status: string; completed: number | null; total: number | null }

export async function pullOllamaModel(
  config: OllamaConfig,
  model: string,
  { signal, onProgress }: { signal?: AbortSignal; onProgress?: (event: PullProgressEvent) => void } = {},
): Promise<{ model: string }> {
  return request(config, '/api/pull', {
    body: { model, stream: true },
    timeoutMs: PULL_TIMEOUT_MS,
    signal,
    consume: async (res) => {
      let last: Record<string, unknown> | null = null
      for await (const line of readLines(res.body)) {
        let parsed: unknown
        try {
          parsed = JSON.parse(line)
        } catch {
          throw providerError(`Ollama lieferte eine unlesbare Antwort: ${maskSecret(config.apiKey, line).slice(0, 200)}`)
        }
        if (!isObject(parsed)) throw providerError(`Ollama lieferte eine unlesbare Antwort: ${maskSecret(config.apiKey, line).slice(0, 200)}`)
        const part = parsed
        if (part.error) throw providerError(`Ollama meldet einen Fehler: ${maskSecret(config.apiKey, part.error).slice(0, 300)}`)
        last = part
        onProgress?.({ status: typeof part.status === 'string' ? part.status : '', completed: numberOrNull(part.completed), total: numberOrNull(part.total) })
      }
      if (last?.status !== 'success') throw providerError('Der Download wurde nicht abgeschlossen. Ein neuer Versuch setzt dort an, wo er aufgehört hat.')
      return { model }
    },
  })
}

// Installierte Modelle für die Auswahl in den Einstellungen, mit Größe, Bildverständnis (null:
// unbekannt) und Cloud-Kennzeichen. Reine Embedding-Modelle können keine Rechnung lesen und
// fehlen deshalb.
export async function listOllamaModels(config: OllamaConfig): Promise<AiModel[]> {
  const info = await request(config, '/api/tags', { timeoutMs: 5000, consume: readJson })
  const modelsField = info.models
  const rawModels: unknown[] = Array.isArray(modelsField) ? modelsField : []
  const list = await Promise.all(
    rawModels.map(async (raw): Promise<AiModel | null> => {
      const m = isObject(raw) ? raw : {}
      const name = typeof m.name === 'string' ? m.name : ''
      const caps = await getCapabilities(config, name).catch((): Capabilities => ({ capabilities: null, remote: false }))
      if (caps.capabilities && !caps.capabilities.includes('completion')) return null
      return {
        name,
        sizeBytes: typeof m.size === 'number' ? m.size : null,
        vision: caps.capabilities ? caps.capabilities.includes('vision') : null,
        remote: caps.remote || Boolean(m.remote_host),
      }
    }),
  )
  return list.filter((m): m is AiModel => m !== null)
}

// Übliche Adressen für die Suche, je nach Betriebsart. Im Container: der Host
// (host.docker.internal) und der Dienst `ollama` aus dem Compose-Profil. Sonst nur dieser
// Rechner; die Docker-Namen gingen dort per DNS oder unter Windows per Broadcast ins Netz.
export function defaultCandidates(runtime: string): string[] {
  return runtime === 'docker'
    ? ['http://host.docker.internal:11434', 'http://ollama:11434']
    : ['http://localhost:11434', 'http://127.0.0.1:11434']
}

// Sucht Ollama unter anderen Adressen, wenn die eingestellte gar nicht erreichbar war. Die
// erste Adresse der Liste, die wie Ollama antwortet, gewinnt.
export async function findOllama(candidates: string[]): Promise<string | null> {
  const answers = await Promise.all(
    candidates.map(async (url) => {
      try {
        const res = await fetch(`${url}/api/version`, { signal: AbortSignal.timeout(1500) })
        if (!res.ok) return false
        const body: unknown = await res.json()
        return isObject(body) && typeof body.version === 'string'
      } catch {
        return false
      }
    }),
  )
  return candidates.find((_, i) => answers[i]) ?? null
}

// Anbindung an OpenAI-kompatible Dienste über die Chat-Completions-Schnittstelle
// (POST {url}/chat/completions). Diese Schnittstelle sprechen OpenAI, IONOS AI Model Hub,
// Mistral, LM Studio, die OpenAI-Schnittstelle von Ollama und viele weitere. Setzt die
// Schnittstelle aus ai/index.ts um.
//
// Die Dienste unterscheiden sich in Einzelheiten (nach ihrer Dokumentation, Stand September
// 2026). Die Vorlage in presets.ts belegt die bekannten vor. Lehnt ein Dienst etwas ab, probiert
// das Modul einmal die nächste Möglichkeit und merkt sich je Adresse und Modell, was
// funktioniert hat, solange der Server läuft:
// - Antwortlänge: `max_completion_tokens` oder `max_tokens`. Mietfuchs schickt immer einen
//   Wert, denn IONOS nimmt ohne Angabe nur 16 Token.
// - Temperatur 0, außer der Dienst lehnt sie ab (neuere OpenAI-Modelle nehmen nur ihren
//   Standard).
// - Strukturierte Ausgabe in Stufen: `json_schema` im strikten Modus, ohne strikten Modus,
//   `json_object` mit dem Schema im Prompt (LM Studio kennt das nicht), zuletzt nur der Prompt.
// - Kennzahlen über `stream_options.include_usage`, ohne, wenn der Dienst das Feld ablehnt.
// Fehler kommen in verschiedenen Formaten (readProviderError) und werden in Meldungen für die
// Oberfläche übersetzt. Ein Schlüssel erscheint nie in einer Meldung.

import type { AiJsonMode, AiModel, AiPreset } from '../../../shared/types.ts'
import { openRequest, readText, maskSecret, type HttpHeaders, type HttpResponse } from './http.ts'
import { presetById } from './presets.ts'
import { isExternalUrl } from './settings.ts'
import { providerError, isProviderError } from './errors.ts'
import type { JsonSchema, Provider, ProviderImage, ProviderProgressEvent, ProviderRequest, ProviderResult, ProviderStats } from './ollama.ts'

// Was openai.ts von providerConfig (ai/index.ts) braucht
export type OpenAiConfig = {
  url: string
  model: string
  apiKey: string | null
  preset: string
  jsonMode: AiJsonMode
  maxOutputTokens: number | null
  reasoningEffort: string | null
  vision: boolean | null
}

const DEFAULT_MAX_OUTPUT_TOKENS = 16384
// Obergrenze für Versuche einer Anfrage: Rückfälle bei abgelehnten Parametern und Wiederholungen
// bei Überlastung zusammen
const MAX_ATTEMPTS = 8
const RETRIES_WHEN_BUSY = 2
const MAX_RETRY_WAIT_MS = 20000

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

// ---------- Schema ----------

const typesOf = (schema: JsonSchema): string[] => (Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [])

function nullable(schema: JsonSchema): JsonSchema {
  const types = typesOf(schema)
  if (types.length === 0 || types.includes('null')) return schema
  const result: JsonSchema = { ...schema, type: [...types, 'null'] }
  if (Array.isArray(schema.enum)) result.enum = [...schema.enum, null]
  return result
}

// Der strikte Modus von OpenAI verlangt in jedem Objekt `additionalProperties: false` und alle
// Felder als Pflicht. Bisher optionale Felder dürfen deshalb null sein.
export function toStrictSchema(schema: JsonSchema): JsonSchema {
  if (!schema || typeof schema !== 'object') return schema
  const types = typesOf(schema)
  if (types.includes('object') && schema.properties) {
    const required = new Set(schema.required ?? [])
    const properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => {
        const strict = toStrictSchema(value)
        return [key, required.has(key) ? strict : nullable(strict)]
      }),
    )
    return { ...schema, properties, required: Object.keys(properties), additionalProperties: false }
  }
  if (types.includes('array') && schema.items) return { ...schema, items: toStrictSchema(schema.items) }
  return schema
}

// Entfernt die Nullwerte, die nur der strikte Modus erzwungen hat, damit das Ergebnis dem
// ursprünglichen Schema entspricht
export function stripAddedNulls(data: unknown, schema: JsonSchema | undefined): unknown {
  if (!schema || data === null || typeof data !== 'object') return data
  if (Array.isArray(data)) return schema.items ? data.map((item) => stripAddedNulls(item, schema.items)) : data
  if (!schema.properties) return data
  const required = new Set(schema.required ?? [])
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data) as [string, unknown][]) {
    const property = schema.properties[key]
    if (value === null && property && !required.has(key) && !typesOf(property).includes('null')) continue
    result[key] = property ? stripAddedNulls(value, property) : value
  }
  return result
}

const schemaInstruction = (schema: JsonSchema): string =>
  `Antworte ausschließlich mit einem JSON-Objekt nach diesem JSON-Schema, ohne weiteren Text:\n${JSON.stringify(schema)}`

// ---------- Antworten lesen ----------

// IONOS schickt errorCode teils als Zahl statt als Zeichenkette, deshalb hier wie im
// ursprünglichen JavaScript beide Formen (nur beide statt jedem beliebigen Wert wie zuvor
// `source.code ?? source.errorCode ?? null`, denn ein Fehlercode ist niemals ein Objekt oder
// eine Liste).
const isCodeLike = (v: unknown): v is string | number => typeof v === 'string' || typeof v === 'number'

export type ProviderErrorInfo = { message: string; code: string | number | null; param: string | null }

// Fehlermeldung eines Dienstes als { message, code, param }. Die Formate: OpenAI und LM Studio
// { error: { message, code, param } }, Mistral dieselben Felder oben, IONOS
// { messages: [{ errorCode, message }] }, Ollama { error: "…" }.
export function readProviderError(text: string): ProviderErrorInfo {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { message: text, code: null, param: null }
  }
  const pick = (source: Record<string, unknown>): ProviderErrorInfo => ({
    message: String(source.message ?? text),
    code: isCodeLike(source.code) ? source.code : (isCodeLike(source.errorCode) ? source.errorCode : null),
    param: typeof source.param === 'string' ? source.param : null,
  })
  const root = isObject(parsed) ? parsed : {}
  if (isObject(root.error)) return pick(root.error)
  if (typeof root.error === 'string') return { message: root.error, code: null, param: null }
  if (Array.isArray(root.messages) && isObject(root.messages[0])) return pick(root.messages[0])
  if (typeof root.message === 'string') return pick(root)
  return { message: text, code: null, param: null }
}

type StreamState = { content: string; reasoningChars: number; usage: unknown; finishReason: string | null }

// Ein Ereignis des SSE-Stroms. Liefert true bei `[DONE]`. `apiKey` nur zum Maskieren, falls ein
// Proxy vor dem Dienst eine nicht lesbare Antwort mit dem Schlüssel darin zurückgibt.
function handleEvent(block: string, state: StreamState, onProgress: ((event: ProviderProgressEvent) => void) | undefined, apiKey: string | null): boolean {
  let type = 'message'
  const data: string[] = []
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith(':')) continue // Kommentar, etwa zum Wachhalten der Verbindung
    if (line.startsWith('event:')) type = line.slice(6).trim()
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
  }
  if (data.length === 0) return false
  const text = data.join('\n')
  if (text === '[DONE]') return true
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw providerError(`Der Dienst lieferte eine unlesbare Antwort: ${maskSecret(apiKey, text).slice(0, 200)}`)
  }
  const json = isObject(parsed) ? parsed : {}
  // Fehler mitten im Strom kommen mit Status 200
  if (type === 'error' || json.error) {
    const { message, code } = readProviderError(text)
    throw providerError(message, { status: 200, code: code ?? undefined, detail: message, inStream: true })
  }
  if (json.usage) state.usage = json.usage
  const choices = Array.isArray(json.choices) ? json.choices : []
  const choice = isObject(choices[0]) ? choices[0] : undefined
  if (!choice) return false
  const delta = isObject(choice.delta) ? choice.delta : (isObject(choice.message) ? choice.message : {})
  let written = 0
  let thought = 0
  // Mistral schickt den Inhalt auch als Liste von Teilen, Denktext als Teil vom Typ „thinking“
  const contentParts: unknown[] = Array.isArray(delta.content) ? delta.content : [delta.content]
  for (const part of contentParts) {
    if (typeof part === 'string') {
      state.content += part
      written += part.length
    } else if (isObject(part) && part.type === 'text' && typeof part.text === 'string') {
      state.content += part.text
      written += part.text.length
    } else if (isObject(part) && part.type === 'thinking') {
      thought += JSON.stringify(part.thinking ?? '').length
    }
  }
  for (const key of ['reasoning', 'reasoning_content'] as const) {
    const val = delta[key]
    if (typeof val === 'string') thought += val.length
  }
  if (thought) {
    state.reasoningChars += thought
    onProgress?.({ phase: 'thinking', chars: state.reasoningChars })
  }
  if (written) onProgress?.({ phase: 'writing', chars: state.content.length })
  if (typeof choice.finish_reason === 'string') state.finishReason = choice.finish_reason
  return false
}

// Liest den Strom einer Chat-Antwort: Ereignisse getrennt durch eine Leerzeile, je Zeile
// `data: {…}`. Denktext zählt nur für den Fortschritt, nie für das Ergebnis. Die Kennzahlen
// stehen im letzten Ereignis mit `usage`, das je nach Dienst eigens nach dem Inhalt kommt.
// `apiKey` geht an handleEvent zum Maskieren durch und ist bewusst kein optionaler Parameter
// mit Vorbelegung: Eine vergessene Übergabe soll nicht stillschweigend ohne Maskierung
// durchlaufen, sondern beim Aufruf auffallen.
export async function readCompletionStream(
  body: AsyncIterable<Uint8Array>,
  apiKey: string | null,
  onProgress?: (event: ProviderProgressEvent) => void,
): Promise<StreamState> {
  const decoder = new TextDecoder()
  const state: StreamState = { content: '', reasoningChars: 0, usage: null, finishReason: null }
  const separator = /\r?\n\r?\n/
  let buffer = ''
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true })
    let match
    while ((match = separator.exec(buffer))) {
      const block = buffer.slice(0, match.index)
      buffer = buffer.slice(match.index + match[0].length)
      if (handleEvent(block, state, onProgress, apiKey)) return state
    }
  }
  buffer += decoder.decode()
  if (buffer.trim()) handleEvent(buffer, state, onProgress, apiKey)
  return state
}

// Das JSON-Objekt aus einer Antwort, auch wenn ein Modell es in einen Codeblock oder in Text
// packt (bei den Stufen ohne erzwungenes Format). Sonst undefined.
export function parseJsonContent(content: unknown): Record<string, unknown> | undefined {
  const text = String(content ?? '').trim()
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  const candidates = [fenced ? fenced[1] : text]
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1))
  for (const candidate of candidates) {
    try {
      const value: unknown = JSON.parse(candidate)
      if (isObject(value)) return value
    } catch {
      // nächster Versuch
    }
  }
  return undefined
}

// Antwort eines Dienstes, der trotz `stream: true` am Stück antwortet
function fromWholeResponse(json: unknown): StreamState {
  const root = isObject(json) ? json : {}
  const choices = Array.isArray(root.choices) ? root.choices : []
  const choice = isObject(choices[0]) ? choices[0] : {}
  const message = isObject(choice.message) ? choice.message : {}
  const content = message.content
  const text = Array.isArray(content)
    ? content.filter((p): p is Record<string, unknown> => isObject(p) && p.type === 'text').map((p) => (typeof p.text === 'string' ? p.text : '')).join('')
    : String(content ?? '')
  const reasoningRaw = message.reasoning_content ?? message.reasoning ?? ''
  const reasoning = typeof reasoningRaw === 'string' ? reasoningRaw : ''
  return {
    content: text,
    reasoningChars: reasoning.length,
    usage: root.usage ?? null,
    finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : null,
  }
}

// ---------- Anfragen ----------

const baseUrl = (config: OpenAiConfig): string => config.url.replace(/\/+$/, '')

// Name des Dienstes für Meldungen: der Name der Vorlage, beim eigenen Dienst die Adresse
function serviceName(config: OpenAiConfig): string {
  const preset = presetById(config.preset)
  return preset && preset.id !== 'openai-compatible' ? preset.label : new URL(config.url).host
}

const maskKey = (config: OpenAiConfig, text: unknown): string => maskSecret(config.apiKey, text)

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason)
    }, { once: true })
  })
}

const retryAfterMs = (headers: HttpHeaders): number | null => {
  const seconds = Number(headers['retry-after'])
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null
}

// Öffnet eine Anfrage und wirft bei einem Fehlerstatus einen ProviderError mit den Angaben des
// Dienstes. Netzfehler gehen unverändert weiter.
async function call(config: OpenAiConfig, path: string, { payload, signal, accept = 'application/json' }: { payload?: string; signal?: AbortSignal; accept?: string }): Promise<HttpResponse> {
  const headers: Record<string, string> = { Accept: accept }
  if (payload !== undefined) {
    headers['Content-Type'] = 'application/json'
    // Ausdrücklich, statt die Anfrage in Stücken (chunked) zu schicken: IONOS lässt solche
    // Anfragen nur zu zweit gleichzeitig durch
    headers['Content-Length'] = String(Buffer.byteLength(payload))
  }
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`
  const res = await openRequest(`${baseUrl(config)}${path}`, { method: payload === undefined ? 'GET' : 'POST', headers, body: payload, signal })
  if (res.ok) return res
  const text = await readText(res.body).catch(() => '')
  const { message, code, param } = readProviderError(text)
  const detail = maskKey(config, message).slice(0, 500)
  throw providerError(detail, { status: res.status, code: code ?? undefined, param: param ?? undefined, detail, retryAfter: retryAfterMs(res.headers) ?? undefined })
}

const QUOTA = /quota|credit|billing|budget|spend_limit|insufficient/i
const isBusy = (err: unknown): boolean =>
  isProviderError(err) && ((err.status === 429 && !QUOTA.test(`${err.code} ${err.detail}`)) || (err.status !== undefined && [502, 503, 529].includes(err.status)))

type TranslateContext = {
  timeout: AbortSignal
  signal?: AbortSignal
  timeoutMs: number
  connected: boolean
  images?: ProviderImage[]
  timeoutSettable?: boolean
}

// Übersetzt einen Fehler in eine Meldung für die Oberfläche. Das Zeitlimit hat Vorrang: Es
// bricht die Verbindung ab, was sonst wie ein Netzfehler aussähe.
function translateError(err: unknown, config: OpenAiConfig, { timeout, signal, timeoutMs, connected, images = [], timeoutSettable = true }: TranslateContext): Error {
  const name = serviceName(config)
  const base = baseUrl(config)
  if (timeout.aborted) {
    const hint = timeoutSettable ? ' Das Zeitlimit lässt sich in den Einstellungen unter „Erweitert“ erhöhen.' : ''
    return providerError(`${name} hat nicht innerhalb von ${Math.round(timeoutMs / 1000)} Sekunden geantwortet.${hint}`)
  }
  if (signal?.aborted) {
    const cancelled = new Error('Die Auswertung wurde abgebrochen.')
    cancelled.name = 'AbortError'
    return cancelled
  }
  if (!isProviderError(err)) {
    if (!connected) {
      return providerError(`${name} ist unter ${base} nicht erreichbar. Bitte die Adresse in den Einstellungen und die Verbindung prüfen.`, { unreachable: true })
    }
    return providerError(`Die Verbindung zu ${name} brach während der Antwort ab (${maskKey(config, err instanceof Error ? err.message : String(err))}).`)
  }
  if (err.status === undefined) return err // eigene Meldung, etwa zum Inhalt der Antwort
  const { status, detail = '', code } = err
  const model = config.model
  if (err.inStream) return providerError(`${name} meldet einen Fehler: ${maskKey(config, detail).slice(0, 500)}`)
  if (status === 401) {
    if (!config.apiKey) return providerError(`${name} verlangt einen Schlüssel. Bitte in den Einstellungen einen eintragen.`)
    const expiry = config.preset === 'ionos' ? ' IONOS-Token laufen nach der gewählten Gültigkeit ab.' : ''
    return providerError(`${name} lehnt den Schlüssel ab.${expiry} Bitte den Schlüssel in den Einstellungen prüfen.`)
  }
  if (status === 403) return providerError(`${name} verweigert den Zugriff auf das Modell „${model}“, vielleicht gehört es nicht zum gebuchten Tarif (${detail}).`)
  if (status === 404) {
    return providerError(err.param === 'model' || /model/i.test(detail)
      ? `${name} kennt das Modell „${model}“ nicht. Bitte in den Einstellungen ein anderes wählen.`
      : `Unter ${base} gibt es keine Chat-Schnittstelle. Stimmt die Adresse? Meist endet sie auf /v1.`)
  }
  if (status === 413) return providerError(`Die Anfrage ist für ${name} zu groß, etwa wegen großer Fotos oder vieler Seiten.`)
  if (status === 429) {
    return providerError(QUOTA.test(`${code} ${detail}`)
      ? `Das Guthaben oder Budget bei ${name} ist aufgebraucht (${detail}).`
      : `${name} meldet zu viele Anfragen. Bitte gleich noch einmal versuchen.`)
  }
  if (status >= 500) return providerError(`${name} ist gerade überlastet oder gestört (Status ${status}). Bitte später noch einmal versuchen.`)
  if (/maximum|too large|exceed|at most|less than or equal/i.test(detail) && /max_tokens|max_completion_tokens/.test(detail)) {
    return providerError(`Die eingestellte Länge der Antwort ist für das Modell „${model}“ zu groß. In den Einstellungen unter „Erweitert“ einen kleineren Wert eintragen. (${detail})`)
  }
  if (images.length > 0 && /image|vision|multimodal/i.test(detail)) {
    return providerError(`${name} lehnt die Bilder ab. Versteht das Modell „${model}“ Bilder? Sonst in den Einstellungen ein Modell mit Bildverständnis wählen. (${detail})`)
  }
  return providerError(`${name} lehnt die Anfrage ab: ${detail}`)
}

// ---------- Anbieter ----------

// Was je Adresse und Modell funktioniert hat, solange der Server läuft
type RequestState = { stage: number; temperature: boolean; tokenField: string; tokenFieldSwitched: boolean; streamOptions: boolean }
const learned = new Map<string, Partial<RequestState>>()

function jsonStages(config: OpenAiConfig, preset: AiPreset): string[] {
  if (config.jsonMode === 'schema') return ['strict', 'loose']
  if (config.jsonMode === 'object') return ['object']
  if (config.jsonMode === 'prompt') return ['prompt']
  return preset.jsonObject ? ['strict', 'loose', 'object', 'prompt'] : ['strict', 'loose', 'prompt']
}

const OTHER_TOKEN_FIELD: Record<string, string> = { max_tokens: 'max_completion_tokens', max_completion_tokens: 'max_tokens' }

// Passt die Anfrage an, wenn der Dienst einen Teil davon abgelehnt hat. Liefert false, wenn es
// nichts mehr anzupassen gibt.
function adjustAfterRejection(err: unknown, state: RequestState, stages: string[]): boolean {
  if (!isProviderError(err) || err.status === undefined || ![400, 422].includes(err.status)) return false
  const mentions = (name: string): boolean => err.param === name || (err.detail ?? '').includes(name)
  if (state.temperature && mentions('temperature')) {
    state.temperature = false
    return true
  }
  // „zu groß“ ist kein falscher Feldname, sondern eine Grenze des Modells
  const tooLarge = /maximum|too large|exceed|at most|less than or equal/i.test(err.detail ?? '')
  if (!state.tokenFieldSwitched && !tooLarge && mentions(state.tokenField)) {
    state.tokenField = OTHER_TOKEN_FIELD[state.tokenField]
    state.tokenFieldSwitched = true
    return true
  }
  if (state.streamOptions && mentions('stream_options')) {
    state.streamOptions = false
    return true
  }
  const aboutFormat = mentions('response_format') || /json_schema|json_object|structured|schema/i.test(err.detail ?? '')
  if (aboutFormat && state.stage < stages.length - 1) {
    state.stage += 1
    return true
  }
  return false
}

export function openaiProvider(config: OpenAiConfig): Provider {
  const preset = presetById(config.preset) ?? presetById('openai-compatible')
  // 'openai-compatible' steht immer in PRESETS (siehe presets.ts); nur für den Typprüfer.
  if (!preset) throw new Error('Interner Fehler: Es gibt keine Vorlage für OpenAI-kompatible Dienste.')
  const stages = jsonStages(config, preset)
  const memoryKey = `${baseUrl(config)}|${config.model}|${stages.join(',')}`
  const maxTokens = config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS

  function body(state: RequestState, { prompt, images, schema }: { prompt: string; images: ProviderImage[]; schema: JsonSchema }): Record<string, unknown> {
    const stage = stages[state.stage]
    const text = stage === 'object' || stage === 'prompt' ? `${prompt}\n\n${schemaInstruction(schema)}` : prompt
    const content: string | Record<string, unknown>[] = images.length > 0
      ? [{ type: 'text', text }, ...images.map((image) => ({ type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.data}` } }))]
      : text
    const request: Record<string, unknown> = { model: config.model, messages: [{ role: 'user', content }], stream: true }
    if (state.streamOptions) request.stream_options = { include_usage: true }
    request[state.tokenField] = maxTokens
    if (state.temperature) request.temperature = 0
    if (config.reasoningEffort) request.reasoning_effort = config.reasoningEffort
    if (stage === 'strict' || stage === 'loose') {
      request.response_format = {
        type: 'json_schema',
        json_schema: { name: 'mietfuchs', strict: stage === 'strict', schema: stage === 'strict' ? toStrictSchema(schema) : schema },
      }
    }
    if (stage === 'object') request.response_format = { type: 'json_object' }
    return request
  }

  return {
    async json({ prompt, images = [], schema, timeoutMs, signal, onProgress }: ProviderRequest): Promise<ProviderResult> {
      onProgress?.({ phase: 'waiting' })
      if (images.length > 0 && config.vision === false) {
        throw providerError(`Laut Einstellungen versteht das Modell „${config.model}“ keine Bilder. Für Fotos und gescannte PDFs ein Modell mit Bildverständnis wählen.`)
      }
      const started = Date.now()
      const timeout = AbortSignal.timeout(timeoutMs)
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
      const context: TranslateContext = { timeout, signal, timeoutMs, connected: false, images }
      const state: RequestState = {
        stage: 0, temperature: preset.temperature, tokenField: preset.tokenField, tokenFieldSwitched: false, streamOptions: true,
        ...learned.get(memoryKey),
      }
      let busyRetries = 0
      let result: StreamState
      for (let attempt = 1; ; attempt++) {
        try {
          const res = await call(config, '/chat/completions', { payload: JSON.stringify(body(state, { prompt, images, schema })), signal: combined, accept: 'text/event-stream' })
          context.connected = true
          const contentType = String(res.headers['content-type'] ?? '')
          result = contentType.includes('application/json')
            ? fromWholeResponse(JSON.parse(await readText(res.body)))
            : await readCompletionStream(res.body, config.apiKey, onProgress)
          break
        } catch (err) {
          if (isProviderError(err) && err.status !== undefined) context.connected = true
          const canRetry = attempt < MAX_ATTEMPTS && !combined.aborted
          if (canRetry && adjustAfterRejection(err, state, stages)) continue
          if (canRetry && isBusy(err) && busyRetries < RETRIES_WHEN_BUSY) {
            busyRetries += 1
            try {
              const retryAfter = isProviderError(err) ? err.retryAfter : undefined
              await sleep(Math.min(retryAfter ?? 2000 * busyRetries, MAX_RETRY_WAIT_MS), combined)
            } catch {
              throw translateError(err, config, context)
            }
            continue
          }
          throw translateError(err, config, context)
        }
      }
      learned.set(memoryKey, { stage: state.stage, temperature: state.temperature, tokenField: state.tokenField, tokenFieldSwitched: state.tokenFieldSwitched, streamOptions: state.streamOptions })

      const name = serviceName(config)
      if (result.finishReason === 'length') {
        throw providerError(`Die Antwort von ${name} wurde abgeschnitten, weil die Höchstlänge von ${maxTokens} Token erreicht war. In den Einstellungen unter „Erweitert“ lässt sie sich erhöhen.`)
      }
      if (result.finishReason === 'content_filter') throw providerError(`${name} hat die Antwort mit seinem Inhaltsfilter zurückgehalten.`)
      let data = parseJsonContent(result.content)
      if (data === undefined) {
        if (!result.content.trim() && result.reasoningChars > 0) {
          throw providerError(`Das Modell „${config.model}“ hat nur nachgedacht und keine Antwort geschrieben. Hilft ein anderes Modell nicht, lässt sich unter „Erweitert“ der Denkaufwand verringern, etwa mit „none“ oder „low“.`)
        }
        throw providerError(`${name} lieferte kein gültiges JSON: ${result.content.slice(0, 200)}`)
      }
      if (stages[state.stage] === 'strict') data = stripAddedNulls(data, schema) as Record<string, unknown>
      const usage = isObject(result.usage) ? result.usage : undefined
      const stats: ProviderStats = {
        promptTokens: typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : null,
        outputTokens: typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : null,
        seconds: Math.round((Date.now() - started) / 100) / 10,
        loadSeconds: null,
      }
      return { data, stats }
    },
  }
}

// Modelle des Dienstes für die Auswahl in den Einstellungen. Nur Mistral meldet, ob ein Modell
// Bilder versteht, bei den übrigen bleibt das offen (null).
export async function listOpenAiModels(config: OpenAiConfig): Promise<AiModel[]> {
  const timeout = AbortSignal.timeout(10000)
  // Für die Modellliste gilt ein festes Zeitlimit, nicht das eingestellte
  const context: TranslateContext = { timeout, signal: undefined, timeoutMs: 10000, connected: false, timeoutSettable: false }
  try {
    const res = await call(config, '/models', { signal: timeout })
    context.connected = true
    const parsed: unknown = JSON.parse(await readText(res.body))
    const root = isObject(parsed) ? parsed : {}
    const data: unknown[] = Array.isArray(root.data) ? root.data : []
    const external = isExternalUrl(config.url)
    return data
      .filter((m): m is Record<string, unknown> => isObject(m) && typeof m.id === 'string')
      .map((m) => ({
        name: m.id as string,
        sizeBytes: null,
        vision: isObject(m.capabilities) && typeof m.capabilities.vision === 'boolean' ? m.capabilities.vision : null,
        remote: external,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch (err) {
    throw translateError(err, config, context)
  }
}

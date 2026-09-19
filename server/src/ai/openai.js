// Anbindung an OpenAI-kompatible Dienste über die Chat-Completions-Schnittstelle
// (POST {url}/chat/completions). Diese Schnittstelle sprechen OpenAI, IONOS AI Model Hub,
// Mistral, LM Studio, die OpenAI-Schnittstelle von Ollama und viele weitere. Setzt die
// Schnittstelle aus ai/index.js um.
//
// Die Dienste unterscheiden sich in Einzelheiten (nach ihrer Dokumentation, Stand September
// 2026). Die Vorlage in presets.js belegt die bekannten vor. Lehnt ein Dienst etwas ab, probiert
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

import { openRequest, readText, maskSecret } from './http.js'
import { presetById } from './presets.js'
import { isExternalUrl } from './settings.js'

const DEFAULT_MAX_OUTPUT_TOKENS = 16384
// Obergrenze für Versuche einer Anfrage: Rückfälle bei abgelehnten Parametern und Wiederholungen
// bei Überlastung zusammen
const MAX_ATTEMPTS = 8
const RETRIES_WHEN_BUSY = 2
const MAX_RETRY_WAIT_MS = 20000

// Fehler mit einer Meldung für die Oberfläche. `status`, `code`, `param` und `detail` tragen,
// was der Dienst gemeldet hat.
class ProviderError extends Error {}

// ---------- Schema ----------

const typesOf = (schema) => (Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [])

function nullable(schema) {
  const types = typesOf(schema)
  if (types.length === 0 || types.includes('null')) return schema
  const result = { ...schema, type: [...types, 'null'] }
  if (Array.isArray(schema.enum)) result.enum = [...schema.enum, null]
  return result
}

// Der strikte Modus von OpenAI verlangt in jedem Objekt `additionalProperties: false` und alle
// Felder als Pflicht. Bisher optionale Felder dürfen deshalb null sein.
export function toStrictSchema(schema) {
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
export function stripAddedNulls(data, schema) {
  if (!schema || data === null || typeof data !== 'object') return data
  if (Array.isArray(data)) return schema.items ? data.map((item) => stripAddedNulls(item, schema.items)) : data
  if (!schema.properties) return data
  const required = new Set(schema.required ?? [])
  const result = {}
  for (const [key, value] of Object.entries(data)) {
    const property = schema.properties[key]
    if (value === null && property && !required.has(key) && !typesOf(property).includes('null')) continue
    result[key] = property ? stripAddedNulls(value, property) : value
  }
  return result
}

const schemaInstruction = (schema) =>
  `Antworte ausschließlich mit einem JSON-Objekt nach diesem JSON-Schema, ohne weiteren Text:\n${JSON.stringify(schema)}`

// ---------- Antworten lesen ----------

// Fehlermeldung eines Dienstes als { message, code, param }. Die Formate: OpenAI und LM Studio
// { error: { message, code, param } }, Mistral dieselben Felder oben, IONOS
// { messages: [{ errorCode, message }] }, Ollama { error: "…" }.
export function readProviderError(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { message: text, code: null, param: null }
  }
  const pick = (source) => ({ message: String(source.message ?? text), code: source.code ?? source.errorCode ?? null, param: source.param ?? null })
  if (parsed?.error && typeof parsed.error === 'object') return pick(parsed.error)
  if (typeof parsed?.error === 'string') return { message: parsed.error, code: null, param: null }
  if (Array.isArray(parsed?.messages) && parsed.messages[0]) return pick(parsed.messages[0])
  if (typeof parsed?.message === 'string') return pick(parsed)
  return { message: text, code: null, param: null }
}

// Ein Ereignis des SSE-Stroms. Liefert true bei `[DONE]`.
function handleEvent(block, state, onProgress) {
  let type = 'message'
  const data = []
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith(':')) continue // Kommentar, etwa zum Wachhalten der Verbindung
    if (line.startsWith('event:')) type = line.slice(6).trim()
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
  }
  if (data.length === 0) return false
  const text = data.join('\n')
  if (text === '[DONE]') return true
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new ProviderError(`Der Dienst lieferte eine unlesbare Antwort: ${text.slice(0, 200)}`)
  }
  // Fehler mitten im Strom kommen mit Status 200
  if (type === 'error' || json?.error) {
    const { message, code } = readProviderError(text)
    throw Object.assign(new ProviderError(message), { status: 200, code, detail: message, inStream: true })
  }
  if (json?.usage) state.usage = json.usage
  const choice = json?.choices?.[0]
  if (!choice) return false
  const delta = choice.delta ?? choice.message ?? {}
  let written = 0
  let thought = 0
  // Mistral schickt den Inhalt auch als Liste von Teilen, Denktext als Teil vom Typ „thinking“
  for (const part of Array.isArray(delta.content) ? delta.content : [delta.content]) {
    if (typeof part === 'string') {
      state.content += part
      written += part.length
    } else if (part?.type === 'text' && typeof part.text === 'string') {
      state.content += part.text
      written += part.text.length
    } else if (part?.type === 'thinking') {
      thought += JSON.stringify(part.thinking ?? '').length
    }
  }
  for (const key of ['reasoning', 'reasoning_content']) if (typeof delta[key] === 'string') thought += delta[key].length
  if (thought) {
    state.reasoningChars += thought
    onProgress?.({ phase: 'thinking', chars: state.reasoningChars })
  }
  if (written) onProgress?.({ phase: 'writing', chars: state.content.length })
  if (choice.finish_reason) state.finishReason = choice.finish_reason
  return false
}

// Liest den Strom einer Chat-Antwort: Ereignisse getrennt durch eine Leerzeile, je Zeile
// `data: {…}`. Denktext zählt nur für den Fortschritt, nie für das Ergebnis. Die Kennzahlen
// stehen im letzten Ereignis mit `usage`, das je nach Dienst eigens nach dem Inhalt kommt.
export async function readCompletionStream(body, onProgress) {
  const decoder = new TextDecoder()
  const state = { content: '', reasoningChars: 0, usage: null, finishReason: null }
  const separator = /\r?\n\r?\n/
  let buffer = ''
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true })
    let match
    while ((match = separator.exec(buffer))) {
      const block = buffer.slice(0, match.index)
      buffer = buffer.slice(match.index + match[0].length)
      if (handleEvent(block, state, onProgress)) return state
    }
  }
  buffer += decoder.decode()
  if (buffer.trim()) handleEvent(buffer, state, onProgress)
  return state
}

// Das JSON-Objekt aus einer Antwort, auch wenn ein Modell es in einen Codeblock oder in Text
// packt (bei den Stufen ohne erzwungenes Format). Sonst undefined.
export function parseJsonContent(content) {
  const text = String(content ?? '').trim()
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  const candidates = [fenced ? fenced[1] : text]
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1))
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate)
      if (value && typeof value === 'object' && !Array.isArray(value)) return value
    } catch {
      // nächster Versuch
    }
  }
  return undefined
}

// Antwort eines Dienstes, der trotz `stream: true` am Stück antwortet
function fromWholeResponse(json) {
  const choice = json.choices?.[0] ?? {}
  const content = choice.message?.content
  const text = Array.isArray(content) ? content.filter((p) => p?.type === 'text').map((p) => p.text).join('') : String(content ?? '')
  const reasoning = choice.message?.reasoning_content ?? choice.message?.reasoning ?? ''
  return { content: text, reasoningChars: reasoning.length, usage: json.usage ?? null, finishReason: choice.finish_reason ?? null }
}

// ---------- Anfragen ----------

const baseUrl = (config) => config.url.replace(/\/+$/, '')

// Name des Dienstes für Meldungen: der Name der Vorlage, beim eigenen Dienst die Adresse
function serviceName(config) {
  const preset = presetById(config.preset)
  return preset && preset.id !== 'openai-compatible' ? preset.label : new URL(config.url).host
}

const maskKey = (config, text) => maskSecret(config.apiKey, text)

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason)
    }, { once: true })
  })
}

const retryAfterMs = (headers) => {
  const seconds = Number(headers?.['retry-after'])
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null
}

// Öffnet eine Anfrage und wirft bei einem Fehlerstatus einen ProviderError mit den Angaben des
// Dienstes. Netzfehler gehen unverändert weiter.
async function call(config, path, { payload, signal, accept = 'application/json' }) {
  const headers = { Accept: accept }
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
  throw Object.assign(new ProviderError(detail), { status: res.status, code, param, detail, retryAfter: retryAfterMs(res.headers) })
}

const QUOTA = /quota|credit|billing|budget|spend_limit|insufficient/i
const isBusy = (err) =>
  err instanceof ProviderError && ((err.status === 429 && !QUOTA.test(`${err.code} ${err.detail}`)) || [502, 503, 529].includes(err.status))

// Übersetzt einen Fehler in eine Meldung für die Oberfläche. Das Zeitlimit hat Vorrang: Es
// bricht die Verbindung ab, was sonst wie ein Netzfehler aussähe.
function translateError(err, config, { timeout, signal, timeoutMs, connected, images = [], timeoutSettable = true }) {
  const name = serviceName(config)
  const base = baseUrl(config)
  if (timeout.aborted) {
    const hint = timeoutSettable ? ' Das Zeitlimit lässt sich in den Einstellungen unter „Erweitert“ erhöhen.' : ''
    return new ProviderError(`${name} hat nicht innerhalb von ${Math.round(timeoutMs / 1000)} Sekunden geantwortet.${hint}`)
  }
  if (signal?.aborted) {
    const cancelled = new Error('Die Auswertung wurde abgebrochen.')
    cancelled.name = 'AbortError'
    return cancelled
  }
  if (!(err instanceof ProviderError)) {
    if (!connected) {
      return Object.assign(new ProviderError(`${name} ist unter ${base} nicht erreichbar. Bitte die Adresse in den Einstellungen und die Verbindung prüfen.`), { unreachable: true })
    }
    return new ProviderError(`Die Verbindung zu ${name} brach während der Antwort ab (${maskKey(config, err?.message ?? err)}).`)
  }
  if (err.status === undefined) return err // eigene Meldung, etwa zum Inhalt der Antwort
  const { status, detail = '', code } = err
  const model = config.model
  if (err.inStream) return new ProviderError(`${name} meldet einen Fehler: ${maskKey(config, detail).slice(0, 500)}`)
  if (status === 401) {
    if (!config.apiKey) return new ProviderError(`${name} verlangt einen Schlüssel. Bitte in den Einstellungen einen eintragen.`)
    const expiry = config.preset === 'ionos' ? ' IONOS-Token laufen nach der gewählten Gültigkeit ab.' : ''
    return new ProviderError(`${name} lehnt den Schlüssel ab.${expiry} Bitte den Schlüssel in den Einstellungen prüfen.`)
  }
  if (status === 403) return new ProviderError(`${name} verweigert den Zugriff auf das Modell „${model}“, vielleicht gehört es nicht zum gebuchten Tarif (${detail}).`)
  if (status === 404) {
    return new ProviderError(err.param === 'model' || /model/i.test(detail)
      ? `${name} kennt das Modell „${model}“ nicht. Bitte in den Einstellungen ein anderes wählen.`
      : `Unter ${base} gibt es keine Chat-Schnittstelle. Stimmt die Adresse? Meist endet sie auf /v1.`)
  }
  if (status === 413) return new ProviderError(`Die Anfrage ist für ${name} zu groß, etwa wegen großer Fotos oder vieler Seiten.`)
  if (status === 429) {
    return new ProviderError(QUOTA.test(`${code} ${detail}`)
      ? `Das Guthaben oder Budget bei ${name} ist aufgebraucht (${detail}).`
      : `${name} meldet zu viele Anfragen. Bitte gleich noch einmal versuchen.`)
  }
  if (status >= 500) return new ProviderError(`${name} ist gerade überlastet oder gestört (Status ${status}). Bitte später noch einmal versuchen.`)
  if (/maximum|too large|exceed|at most|less than or equal/i.test(detail) && /max_tokens|max_completion_tokens/.test(detail)) {
    return new ProviderError(`Die eingestellte Länge der Antwort ist für das Modell „${model}“ zu groß. In den Einstellungen unter „Erweitert“ einen kleineren Wert eintragen. (${detail})`)
  }
  if (images.length > 0 && /image|vision|multimodal/i.test(detail)) {
    return new ProviderError(`${name} lehnt die Bilder ab. Versteht das Modell „${model}“ Bilder? Sonst in den Einstellungen ein Modell mit Bildverständnis wählen. (${detail})`)
  }
  return new ProviderError(`${name} lehnt die Anfrage ab: ${detail}`)
}

// ---------- Anbieter ----------

// Was je Adresse und Modell funktioniert hat, solange der Server läuft
const learned = new Map()

function jsonStages(config, preset) {
  if (config.jsonMode === 'schema') return ['strict', 'loose']
  if (config.jsonMode === 'object') return ['object']
  if (config.jsonMode === 'prompt') return ['prompt']
  return preset.jsonObject ? ['strict', 'loose', 'object', 'prompt'] : ['strict', 'loose', 'prompt']
}

const OTHER_TOKEN_FIELD = { max_tokens: 'max_completion_tokens', max_completion_tokens: 'max_tokens' }

// Passt die Anfrage an, wenn der Dienst einen Teil davon abgelehnt hat. Liefert false, wenn es
// nichts mehr anzupassen gibt.
function adjustAfterRejection(err, state, stages) {
  if (!(err instanceof ProviderError) || ![400, 422].includes(err.status)) return false
  const mentions = (name) => err.param === name || (err.detail ?? '').includes(name)
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

export function openaiProvider(config) {
  const preset = presetById(config.preset) ?? presetById('openai-compatible')
  const stages = jsonStages(config, preset)
  const memoryKey = `${baseUrl(config)}|${config.model}|${stages.join(',')}`
  const maxTokens = config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS

  function body(state, { prompt, images, schema }) {
    const stage = stages[state.stage]
    const text = stage === 'object' || stage === 'prompt' ? `${prompt}\n\n${schemaInstruction(schema)}` : prompt
    const content = images.length > 0
      ? [{ type: 'text', text }, ...images.map((image) => ({ type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.data}` } }))]
      : text
    const request = { model: config.model, messages: [{ role: 'user', content }], stream: true }
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
    async json({ prompt, images = [], schema, timeoutMs, signal, onProgress }) {
      onProgress?.({ phase: 'waiting' })
      if (images.length > 0 && config.vision === false) {
        throw new ProviderError(`Laut Einstellungen versteht das Modell „${config.model}“ keine Bilder. Für Fotos und gescannte PDFs ein Modell mit Bildverständnis wählen.`)
      }
      const started = Date.now()
      const timeout = AbortSignal.timeout(timeoutMs)
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
      const context = { timeout, signal, timeoutMs, connected: false, images }
      const state = {
        stage: 0, temperature: preset.temperature, tokenField: preset.tokenField, tokenFieldSwitched: false, streamOptions: true,
        ...learned.get(memoryKey),
      }
      let busyRetries = 0
      let result
      for (let attempt = 1; ; attempt++) {
        try {
          const res = await call(config, '/chat/completions', { payload: JSON.stringify(body(state, { prompt, images, schema })), signal: combined, accept: 'text/event-stream' })
          context.connected = true
          result = String(res.headers?.['content-type'] ?? '').includes('application/json')
            ? fromWholeResponse(JSON.parse(await readText(res.body)))
            : await readCompletionStream(res.body, onProgress)
          break
        } catch (err) {
          if (err instanceof ProviderError && err.status !== undefined) context.connected = true
          const canRetry = attempt < MAX_ATTEMPTS && !combined.aborted
          if (canRetry && adjustAfterRejection(err, state, stages)) continue
          if (canRetry && isBusy(err) && busyRetries < RETRIES_WHEN_BUSY) {
            busyRetries += 1
            try {
              await sleep(Math.min(err.retryAfter ?? 2000 * busyRetries, MAX_RETRY_WAIT_MS), combined)
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
        throw new ProviderError(`Die Antwort von ${name} wurde abgeschnitten, weil die Höchstlänge von ${maxTokens} Token erreicht war. In den Einstellungen unter „Erweitert“ lässt sie sich erhöhen.`)
      }
      if (result.finishReason === 'content_filter') throw new ProviderError(`${name} hat die Antwort mit seinem Inhaltsfilter zurückgehalten.`)
      let data = parseJsonContent(result.content)
      if (data === undefined) {
        if (!result.content.trim() && result.reasoningChars > 0) {
          throw new ProviderError(`Das Modell „${config.model}“ hat nur nachgedacht und keine Antwort geschrieben. Hilft ein anderes Modell nicht, lässt sich unter „Erweitert“ der Denkaufwand verringern, etwa mit „none“ oder „low“.`)
        }
        throw new ProviderError(`${name} lieferte kein gültiges JSON: ${result.content.slice(0, 200)}`)
      }
      if (stages[state.stage] === 'strict') data = stripAddedNulls(data, schema)
      const stats = {
        promptTokens: result.usage?.prompt_tokens ?? null,
        outputTokens: result.usage?.completion_tokens ?? null,
        seconds: Math.round((Date.now() - started) / 100) / 10,
        loadSeconds: null,
      }
      return { data, stats }
    },
  }
}

// Modelle des Dienstes für die Auswahl in den Einstellungen. Nur Mistral meldet, ob ein Modell
// Bilder versteht, bei den übrigen bleibt das offen (null).
export async function listOpenAiModels(config) {
  const timeout = AbortSignal.timeout(10000)
  // Für die Modellliste gilt ein festes Zeitlimit, nicht das eingestellte
  const context = { timeout, signal: null, timeoutMs: 10000, connected: false, timeoutSettable: false }
  try {
    const res = await call(config, '/models', { signal: timeout })
    context.connected = true
    const { data = [] } = JSON.parse(await readText(res.body))
    const external = isExternalUrl(config.url)
    return data
      .filter((m) => typeof m?.id === 'string')
      .map((m) => ({ name: m.id, sizeBytes: null, vision: typeof m.capabilities?.vision === 'boolean' ? m.capabilities.vision : null, remote: external }))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch (err) {
    throw translateError(err, config, context)
  }
}

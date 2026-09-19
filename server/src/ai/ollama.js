// Anbindung an Ollama (https://github.com/ollama/ollama/blob/main/docs/api.md). Setzt die
// Schnittstelle aus ai/index.js um und liefert dazu, was es nur bei Ollama gibt: die
// installierten Modelle mit ihren Fähigkeiten und die Suche nach Ollama unter den üblichen
// Adressen.

import { openRequest, readLines, readText } from './http.js'

const baseUrl = (settings) => settings.ollamaUrl.replace(/\/+$/, '')

// Ohne Angabe nimmt Ollama bei weniger als 24 GB Grafikspeicher 4096 Token Kontext und kürzt
// längere Anfragen stillschweigend. Eine Rechnung mit 20.000 Zeichen Text braucht grob 7.000
// Token, vier Seitenbilder bei Qwen-Modellen etwa 10.000. Der Wert ist fest, denn ein anderer
// Wert als bei der vorigen Anfrage lässt Ollama das Modell neu laden. NKA_OLLAMA_NUM_CTX
// ändert ihn, etwa für Rechner mit wenig Arbeitsspeicher.
const DEFAULT_NUM_CTX = 16384
function numCtx() {
  const value = Number(process.env.NKA_OLLAMA_NUM_CTX)
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_NUM_CTX
}

// Fehler mit einer Meldung, die so in der Oberfläche stehen kann
class OllamaError extends Error {}

// Zuerst, was jeder tun kann: Beim ersten Beleg lädt Ollama das Modell erst in den Speicher, ein
// zweiter Versuch geht deshalb oft schneller. Die Umgebungsvariable hilft nur bei Docker und npm.
const timeoutMessage = (ms) =>
  `Ollama hat nicht innerhalb von ${Math.round(ms / 1000)} Sekunden geantwortet. Beim ersten Beleg lädt Ollama das Modell erst in den Speicher, ein zweiter Versuch geht oft schneller. Ohne Grafikkarte ist ein großes Modell oft zu langsam, dann hilft ein kleineres Modell. Bei Docker oder dem Start aus dem Quellcode lässt sich das Zeitlimit mit NKA_AI_TIMEOUT erhöhen.`

// Übersetzt, was beim Verbinden oder Lesen schiefgeht, in eine verständliche Meldung. Das
// Zeitlimit hat Vorrang: Es bricht die Verbindung ab, was sonst wie ein Netzfehler aussähe.
function translateError(err, { timeout, signal, timeoutMs, base, connected }) {
  if (timeout.aborted) return new OllamaError(timeoutMessage(timeoutMs))
  if (signal?.aborted) {
    const cancelled = new Error('Die Auswertung wurde abgebrochen.')
    cancelled.name = 'AbortError'
    return cancelled
  }
  if (err instanceof OllamaError) return err
  if (!connected) {
    const unreachable = new OllamaError(`Ollama ist unter ${base} nicht erreichbar. Läuft Ollama? Die Adresse steht in den Einstellungen.`)
    unreachable.unreachable = true // nur dann lohnt die Suche unter anderen Adressen
    return unreachable
  }
  return new OllamaError(`Die Verbindung zu Ollama brach während der Antwort ab (${err?.message ?? err}).`)
}

const readJson = async (res) => JSON.parse(await readText(res.body))

// Gemeinsamer Weg für alle Anfragen. `timeoutMs` und `signal` (Abbruch durch den Aufrufer)
// gelten für die ganze Anfrage einschließlich des Lesens der Antwort in `consume`.
async function request(settings, path, { body, timeoutMs, signal, consume = readJson }) {
  const base = baseUrl(settings)
  const timeout = AbortSignal.timeout(timeoutMs)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  const context = { timeout, signal, timeoutMs, base, connected: false }
  let res
  try {
    res = await openRequest(`${base}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: combined,
    })
  } catch (err) {
    throw translateError(err, context)
  }
  context.connected = true
  try {
    if (!res.ok) {
      const text = await readText(res.body).catch(() => '')
      if (res.status === 404 && body?.model) {
        throw new OllamaError(`Das Modell „${body.model}“ ist in Ollama nicht installiert. In den Einstellungen ein installiertes Modell wählen oder es mit „ollama pull ${body.model}“ laden.`)
      }
      throw new OllamaError(`Ollama antwortet mit ${res.status}: ${text.slice(0, 300)}`)
    }
    return await consume(res)
  } catch (err) {
    throw translateError(err, context)
  }
}

// Liest die gestreamte Chat-Antwort: zeilenweise JSON, die letzte Zeile mit `done: true`
// trägt den Grund des Endes und die Kennzahlen. `onProgress` erfährt die bisherige Länge.
async function readChatStream(res, onProgress) {
  let content = ''
  let final = null
  for await (const line of readLines(res.body)) {
    let part
    try {
      part = JSON.parse(line)
    } catch {
      throw new OllamaError(`Ollama lieferte eine unlesbare Antwort: ${line.slice(0, 200)}`)
    }
    if (part.error) throw new OllamaError(`Ollama meldet einen Fehler: ${part.error}`)
    const piece = part.message?.content ?? ''
    content += piece
    if (piece) onProgress?.({ phase: 'writing', chars: content.length })
    if (part.done) final = part
  }
  if (!final) throw new OllamaError('Die Antwort von Ollama brach vorzeitig ab.')
  // Ohne Obergrenze für die Ausgabe endet eine Antwort nur am Kontextende vorzeitig
  if (final.done_reason === 'length') {
    throw new OllamaError(`Die Antwort von Ollama wurde abgeschnitten, weil der Kontext von ${numCtx()} Token nicht reicht. Mit NKA_OLLAMA_NUM_CTX lässt er sich vergrößern.`)
  }
  return { content, final }
}

const seconds = (ns) => (ns == null ? null : Math.round(ns / 1e8) / 10)

// Fähigkeiten laut /api/show, etwa ['completion', 'vision']. Ältere Versionen kennen das Feld
// nicht, dann null. `remote`: Ollama reicht Anfragen an dieses Modell an einen Cloud-Dienst weiter.
async function getCapabilities(settings, model, signal) {
  const info = await request(settings, '/api/show', { body: { model }, timeoutMs: 10000, signal })
  return { capabilities: Array.isArray(info.capabilities) ? info.capabilities : null, remote: Boolean(info.remote_host) }
}

export function ollamaProvider(settings) {
  const model = settings.ollamaModel
  return {
    async json({ prompt, images = [], schema, timeoutMs, signal, onProgress }) {
      onProgress?.({ phase: 'waiting' })
      const message = { role: 'user', content: prompt }
      if (images.length > 0) {
        // Kennt Ollama die Fähigkeiten nicht (ältere Version), wird es versucht
        const { capabilities } = await getCapabilities(settings, model, signal)
        if (capabilities && !capabilities.includes('vision')) {
          throw new OllamaError(`Das Modell „${model}“ versteht keine Bilder. Für Fotos und gescannte PDFs in den Einstellungen ein Modell mit Bildverständnis wählen.`)
        }
        message.images = images.map((image) => image.data) // Ollama nimmt reines Base64 ohne Typangabe
      }
      const { content, final } = await request(settings, '/api/chat', {
        body: {
          model,
          messages: [message],
          stream: true,
          format: schema,
          // Neuere Modelle denken sonst erst ausführlich nach. Für das Auslesen einer Rechnung
          // bringt das wenig und kostet auf dem Prozessor Minuten. Modelle ohne diese
          // Fähigkeit übergehen den Schalter.
          think: false,
          options: { temperature: 0, num_ctx: numCtx() },
        },
        timeoutMs,
        signal,
        consume: (res) => readChatStream(res, onProgress),
      })
      let data
      try {
        data = JSON.parse(content || '{}')
      } catch {
        throw new OllamaError(`Ollama lieferte kein gültiges JSON: ${content.slice(0, 200)}`)
      }
      const stats = {
        promptTokens: final.prompt_eval_count ?? null,
        outputTokens: final.eval_count ?? null,
        seconds: seconds(final.total_duration),
        loadSeconds: seconds(final.load_duration),
      }
      return { data, stats }
    },
  }
}

// Installierte Modelle für die Auswahl in den Einstellungen, mit Größe, Bildverständnis (null:
// unbekannt) und Cloud-Kennzeichen. Reine Embedding-Modelle können keine Rechnung lesen und
// fehlen deshalb.
export async function listOllamaModels(settings) {
  const { models = [] } = await request(settings, '/api/tags', { timeoutMs: 5000 })
  const list = await Promise.all(
    models.map(async (m) => {
      const info = await getCapabilities(settings, m.name).catch(() => ({ capabilities: null, remote: false }))
      if (info.capabilities && !info.capabilities.includes('completion')) return null
      return {
        name: m.name,
        sizeBytes: m.size ?? null,
        vision: info.capabilities ? info.capabilities.includes('vision') : null,
        remote: info.remote || Boolean(m.remote_host),
      }
    }),
  )
  return list.filter(Boolean)
}

// Übliche Adressen für die Suche, je nach Betriebsart. Im Container: der Host
// (host.docker.internal) und der Dienst `ollama` aus dem Compose-Profil. Sonst nur dieser
// Rechner; die Docker-Namen gingen dort per DNS oder unter Windows per Broadcast ins Netz.
export function defaultCandidates(runtime) {
  return runtime === 'docker'
    ? ['http://host.docker.internal:11434', 'http://ollama:11434']
    : ['http://localhost:11434', 'http://127.0.0.1:11434']
}

// Sucht Ollama unter anderen Adressen, wenn die eingestellte gar nicht erreichbar war. Die
// erste Adresse der Liste, die wie Ollama antwortet, gewinnt.
export async function findOllama(candidates) {
  const answers = await Promise.all(
    candidates.map(async (url) => {
      try {
        const res = await fetch(`${url}/api/version`, { signal: AbortSignal.timeout(1500) })
        return res.ok && typeof (await res.json()).version === 'string'
      } catch {
        return false
      }
    }),
  )
  return candidates.find((_, i) => answers[i]) ?? null
}

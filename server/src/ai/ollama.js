// Anbindung an Ollama (https://github.com/ollama/ollama/blob/main/docs/api.md). Setzt die
// Schnittstelle aus ai/index.js um und liefert dazu, was es nur bei Ollama gibt: die
// installierten Modelle mit ihren Fähigkeiten und die Suche nach Ollama unter den üblichen
// Adressen.
//
// Die Funktionen bekommen die Konfiguration aus providerConfig (ai/index.js): `url`, `model`,
// `apiKey` (für Ollama hinter einem Proxy oder Ollama Cloud, sonst null) und `numCtx`.

import { openRequest, readLines, readText, maskSecret } from './http.ts'

const baseUrl = (config) => config.url.replace(/\/+$/, '')

// Ohne Angabe nimmt Ollama bei weniger als 24 GB Grafikspeicher 4096 Token Kontext und kürzt
// längere Anfragen stillschweigend. Eine Rechnung mit 20.000 Zeichen Text braucht grob 7.000
// Token, vier Seitenbilder bei Qwen-Modellen etwa 10.000. Der Wert ist fest, denn ein anderer
// Wert als bei der vorigen Anfrage lässt Ollama das Modell neu laden. Unter „Erweitert“ (oder
// mit NKA_OLLAMA_NUM_CTX) lässt er sich ändern, etwa für Rechner mit wenig Arbeitsspeicher.
const DEFAULT_NUM_CTX = 16384
const numCtx = (config) => config.numCtx ?? DEFAULT_NUM_CTX

// Fehler mit einer Meldung, die so in der Oberfläche stehen kann. `status` und `detail` tragen
// die Antwort von Ollama, wenn es eine gab.
class OllamaError extends Error {}

// Zuerst, was jeder tun kann: Beim ersten Beleg lädt Ollama das Modell erst in den Speicher, ein
// zweiter Versuch geht deshalb oft schneller.
const timeoutMessage = (ms) =>
  `Ollama hat nicht innerhalb von ${Math.round(ms / 1000)} Sekunden geantwortet. Beim ersten Beleg lädt Ollama das Modell erst in den Speicher, ein zweiter Versuch geht oft schneller. Ohne Grafikkarte ist ein großes Modell oft zu langsam, dann hilft ein kleineres Modell. Das Zeitlimit lässt sich in den Einstellungen unter „Erweitert“ erhöhen.`

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

// Die Meldung aus einer Fehlerantwort von Ollama ({ "error": "…" }), sonst der Text selbst
function errorDetail(text) {
  try {
    const parsed = JSON.parse(text)
    if (typeof parsed.error === 'string') return parsed.error
  } catch {
    // kein JSON
  }
  return text
}

// Gemeinsamer Weg für alle Anfragen. `timeoutMs` und `signal` (Abbruch durch den Aufrufer)
// gelten für die ganze Anfrage einschließlich des Lesens der Antwort in `consume`.
async function request(config, path, { body, timeoutMs, signal, consume = readJson }) {
  const base = baseUrl(config)
  const timeout = AbortSignal.timeout(timeoutMs)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  const context = { timeout, signal, timeoutMs, base, connected: false }
  const headers = body ? { 'Content-Type': 'application/json' } : {}
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`
  let res
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
      const fail = (message) => Object.assign(new OllamaError(message), { status: res.status, detail })
      if (res.status === 401 || res.status === 403) {
        throw fail(config.apiKey
          ? `Ollama unter ${base} lehnt den Schlüssel ab. Bitte den Schlüssel in den Einstellungen prüfen.`
          : `Ollama unter ${base} verlangt einen Schlüssel. Bitte in den Einstellungen einen eintragen.`)
      }
      if (res.status === 404 && body?.model) {
        throw fail(config.preset === 'ollama-cloud'
          ? `Das Modell „${body.model}“ gibt es bei Ollama Cloud nicht. Bitte in den Einstellungen ein anderes wählen.`
          : `Das Modell „${body.model}“ ist in Ollama nicht installiert. In den Einstellungen ein installiertes Modell wählen oder es mit „ollama pull ${body.model}“ laden.`)
      }
      throw fail(`Ollama antwortet mit ${res.status}: ${detail.slice(0, 300)}`)
    }
    return await consume(res)
  } catch (err) {
    throw translateError(err, context)
  }
}

// Liest die gestreamte Chat-Antwort: zeilenweise JSON, die letzte Zeile mit `done: true`
// trägt den Grund des Endes und die Kennzahlen. `onProgress` erfährt die bisherige Länge.
async function readChatStream(res, onProgress, contextTokens, apiKey) {
  let content = ''
  let final = null
  for await (const line of readLines(res.body)) {
    let part
    try {
      part = JSON.parse(line)
    } catch {
      throw new OllamaError(`Ollama lieferte eine unlesbare Antwort: ${maskSecret(apiKey, line).slice(0, 200)}`)
    }
    if (part.error) throw new OllamaError(`Ollama meldet einen Fehler: ${maskSecret(apiKey, part.error).slice(0, 300)}`)
    const piece = part.message?.content ?? ''
    content += piece
    if (piece) onProgress?.({ phase: 'writing', chars: content.length })
    if (part.done) final = part
  }
  if (!final) throw new OllamaError('Die Antwort von Ollama brach vorzeitig ab.')
  // Ohne Obergrenze für die Ausgabe endet eine Antwort nur am Kontextende vorzeitig
  if (final.done_reason === 'length') {
    throw new OllamaError(`Die Antwort von Ollama wurde abgeschnitten, weil der Kontext von ${contextTokens} Token nicht reicht. In den Einstellungen unter „Erweitert“ lässt er sich vergrößern.`)
  }
  return { content, final }
}

const seconds = (ns) => (ns == null ? null : Math.round(ns / 1e8) / 10)

// Fähigkeiten laut /api/show, etwa ['completion', 'vision']. Ältere Versionen kennen das Feld
// nicht, dann null. `remote`: Ollama reicht Anfragen an dieses Modell an einen Cloud-Dienst weiter.
// Eine Minute gemerkt: Vor jeder Auswertung fragt Mietfuchs, ob das Modell in der Cloud läuft,
// bei Bildern auch, ob es sie versteht. Ein gerade neu geladenes Modell soll trotzdem bald
// richtig erkannt werden.
const CAPABILITIES_TTL_MS = 60000
const capabilityCache = new Map()

async function getCapabilities(config, model, signal) {
  const key = `${baseUrl(config)}|${model}`
  const cached = capabilityCache.get(key)
  if (cached && Date.now() - cached.at < CAPABILITIES_TTL_MS) return cached.value
  const info = await request(config, '/api/show', { body: { model }, timeoutMs: 10000, signal })
  const value = { capabilities: Array.isArray(info.capabilities) ? info.capabilities : null, remote: Boolean(info.remote_host) }
  capabilityCache.set(key, { at: Date.now(), value })
  return value
}

// Modelle, die `think: false` abgelehnt haben (je Adresse und Modell, solange der Server läuft).
// Lokal übergeht Ollama den Schalter bei Modellen ohne Nachdenken; manche Modelle bei Ollama
// Cloud lassen sich das Nachdenken aber nicht abschalten und antworten mit 400.
const thinkOffRejected = new Set()
const rejectsThinkOff = (err) => err instanceof OllamaError && err.status === 400 && /think/i.test(err.detail ?? '')

export function ollamaProvider(config) {
  const { model } = config
  const thinkKey = `${baseUrl(config)}|${model}`
  return {
    // Reicht Ollama das Modell an einen Cloud-Dienst weiter (Modelle wie „…:cloud“)?
    async isRemoteModel(signal) {
      return (await getCapabilities(config, model, signal)).remote
    },

    async json({ prompt, images = [], schema, timeoutMs, signal, onProgress }) {
      onProgress?.({ phase: 'waiting' })
      const message = { role: 'user', content: prompt }
      if (images.length > 0) {
        // Kennt Ollama die Fähigkeiten nicht (ältere Version), wird es versucht
        const { capabilities } = await getCapabilities(config, model, signal)
        if (capabilities && !capabilities.includes('vision')) {
          throw new OllamaError(`Das Modell „${model}“ versteht keine Bilder. Für Fotos und gescannte PDFs in den Einstellungen ein Modell mit Bildverständnis wählen.`)
        }
        message.images = images.map((image) => image.data) // Ollama nimmt reines Base64 ohne Typangabe
      }
      const contextTokens = numCtx(config)
      const chat = (withThinkOff) => request(config, '/api/chat', {
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
        consume: (res) => readChatStream(res, onProgress, contextTokens, config.apiKey),
      })
      let answer
      try {
        answer = await chat(!thinkOffRejected.has(thinkKey))
      } catch (err) {
        if (thinkOffRejected.has(thinkKey) || !rejectsThinkOff(err)) throw err
        thinkOffRejected.add(thinkKey)
        answer = await chat(false)
      }
      const { content, final } = answer
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

// Ein Modell laden (#33). Ollama streamt den Fortschritt: erst das Verzeichnis, dann je Schicht
// `total` und `completed` in Bytes, zuletzt `success`. Ein Abbruch ist harmlos, Ollama setzt
// beim nächsten Versuch dort fort, wo es aufgehört hat. Das Zeitlimit ist großzügig: Mehrere
// Gigabyte brauchen über eine langsame Leitung Stunden.
const PULL_TIMEOUT_MS = 6 * 60 * 60 * 1000

export async function pullOllamaModel(config, model, { signal, onProgress } = {}) {
  return request(config, '/api/pull', {
    body: { model, stream: true },
    timeoutMs: PULL_TIMEOUT_MS,
    signal,
    consume: async (res) => {
      let last = null
      for await (const line of readLines(res.body)) {
        let part
        try {
          part = JSON.parse(line)
        } catch {
          throw new OllamaError(`Ollama lieferte eine unlesbare Antwort: ${maskSecret(config.apiKey, line).slice(0, 200)}`)
        }
        if (part.error) throw new OllamaError(`Ollama meldet einen Fehler: ${maskSecret(config.apiKey, part.error).slice(0, 300)}`)
        last = part
        onProgress?.({ status: String(part.status ?? ''), completed: part.completed ?? null, total: part.total ?? null })
      }
      if (last?.status !== 'success') throw new OllamaError('Der Download wurde nicht abgeschlossen. Ein neuer Versuch setzt dort an, wo er aufgehört hat.')
      return { model }
    },
  })
}

// Installierte Modelle für die Auswahl in den Einstellungen, mit Größe, Bildverständnis (null:
// unbekannt) und Cloud-Kennzeichen. Reine Embedding-Modelle können keine Rechnung lesen und
// fehlen deshalb.
export async function listOllamaModels(config) {
  const { models = [] } = await request(config, '/api/tags', { timeoutMs: 5000 })
  const list = await Promise.all(
    models.map(async (m) => {
      const info = await getCapabilities(config, m.name).catch(() => ({ capabilities: null, remote: false }))
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

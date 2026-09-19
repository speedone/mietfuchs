// Anbindung an Ollama (https://github.com/ollama/ollama/blob/main/docs/api.md). Setzt die
// Schnittstelle aus ai/index.js um und liefert dazu, was es nur bei Ollama gibt: die
// installierten Modelle mit ihren Fähigkeiten und die Suche nach Ollama unter den üblichen
// Adressen.

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

// Gemeinsamer Weg für alle Anfragen. Übersetzt die häufigen Fehler in Meldungen, mit denen
// man in der Oberfläche etwas anfangen kann: Ollama läuft nicht oder unter einer anderen
// Adresse, das Modell ist nicht geladen, die Antwort dauert zu lange.
async function request(settings, path, { body, timeoutMs }) {
  const base = baseUrl(settings)
  let res
  try {
    res = await fetch(`${base}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    if (err?.name === 'TimeoutError') {
      throw new Error(`Ollama hat nicht innerhalb von ${Math.round(timeoutMs / 1000)} Sekunden geantwortet. Ohne Grafikkarte ist ein großes Modell oft zu langsam, dann hilft ein kleineres.`)
    }
    throw new Error(`Ollama ist unter ${base} nicht erreichbar. Läuft Ollama? Die Adresse steht in den Einstellungen.`)
  }
  if (res.status === 404 && body?.model) {
    throw new Error(`Das Modell „${body.model}“ ist in Ollama nicht installiert. In den Einstellungen ein installiertes Modell wählen oder es mit „ollama pull ${body.model}“ laden.`)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Ollama antwortet mit ${res.status}: ${text.slice(0, 300)}`)
  }
  return res.json()
}

// Fähigkeiten laut /api/show, etwa ['completion', 'vision']. Ältere Versionen kennen das Feld
// nicht, dann null. `remote`: Ollama reicht Anfragen an dieses Modell an einen Cloud-Dienst weiter.
async function getCapabilities(settings, model) {
  const info = await request(settings, '/api/show', { body: { model }, timeoutMs: 10000 })
  return { capabilities: Array.isArray(info.capabilities) ? info.capabilities : null, remote: Boolean(info.remote_host) }
}

export function ollamaProvider(settings) {
  const model = settings.ollamaModel
  return {
    async json({ prompt, images = [], schema, timeoutMs }) {
      const message = { role: 'user', content: prompt }
      if (images.length > 0) {
        // Kennt Ollama die Fähigkeiten nicht (ältere Version), wird es versucht
        const { capabilities } = await getCapabilities(settings, model)
        if (capabilities && !capabilities.includes('vision')) {
          throw new Error(`Das Modell „${model}“ versteht keine Bilder. Für Fotos und gescannte PDFs in den Einstellungen ein Modell mit Bildverständnis wählen.`)
        }
        message.images = images.map((image) => image.data) // Ollama nimmt reines Base64 ohne Typangabe
      }
      const data = await request(settings, '/api/chat', {
        body: {
          model,
          messages: [message],
          stream: false,
          format: schema,
          // Neuere Modelle denken sonst erst ausführlich nach. Für das Auslesen einer Rechnung
          // bringt das wenig und kostet auf dem Prozessor Minuten. Modelle ohne diese
          // Fähigkeit übergehen den Schalter.
          think: false,
          options: { temperature: 0, num_ctx: numCtx() },
        },
        timeoutMs,
      })
      return JSON.parse(data.message?.content ?? '{}')
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

// Sucht Ollama unter den üblichen Adressen, wenn die eingestellte nicht antwortet: auf diesem
// Rechner, vom Docker-Container aus auf dem Host und als Dienst `ollama` im Compose-Profil.
// Die erste Adresse der Liste, die wie Ollama antwortet, gewinnt.
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

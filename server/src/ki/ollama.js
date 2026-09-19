// Anbindung an Ollama (https://github.com/ollama/ollama/blob/main/docs/api.md). Setzt die
// Schnittstelle aus ki/index.js um und liefert dazu, was es nur bei Ollama gibt: die
// installierten Modelle mit ihren Fähigkeiten und die Suche nach Ollama unter den üblichen
// Adressen.

const basisVon = (settings) => settings.ollamaUrl.replace(/\/+$/, '')

// Gemeinsamer Weg für alle Anfragen. Übersetzt die häufigen Fehler in Meldungen, mit denen
// man in der Oberfläche etwas anfangen kann: Ollama läuft nicht oder unter einer anderen
// Adresse, das Modell ist nicht geladen, die Antwort dauert zu lange.
async function anfrage(settings, pfad, { body, timeoutMs }) {
  const base = basisVon(settings)
  let res
  try {
    res = await fetch(`${base}${pfad}`, {
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
async function faehigkeiten(settings, model) {
  const info = await anfrage(settings, '/api/show', { body: { model }, timeoutMs: 10000 })
  return { capabilities: Array.isArray(info.capabilities) ? info.capabilities : null, remote: Boolean(info.remote_host) }
}

export function ollamaAnbieter(settings) {
  const model = settings.ollamaModel
  return {
    async json({ prompt, bilder = [], schema, timeoutMs }) {
      const message = { role: 'user', content: prompt }
      if (bilder.length > 0) {
        // Kennt Ollama die Fähigkeiten nicht (ältere Version), wird es versucht
        const { capabilities } = await faehigkeiten(settings, model)
        if (capabilities && !capabilities.includes('vision')) {
          throw new Error(`Das Modell „${model}“ versteht keine Bilder. Für Fotos und gescannte PDFs in den Einstellungen ein Modell mit Bildverständnis wählen.`)
        }
        message.images = bilder.map((b) => b.data) // Ollama nimmt reines Base64 ohne Typangabe
      }
      const data = await anfrage(settings, '/api/chat', {
        body: { model, messages: [message], stream: false, format: schema, options: { temperature: 0 } },
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
  const { models = [] } = await anfrage(settings, '/api/tags', { timeoutMs: 5000 })
  const liste = await Promise.all(
    models.map(async (m) => {
      const info = await faehigkeiten(settings, m.name).catch(() => ({ capabilities: null, remote: false }))
      if (info.capabilities && !info.capabilities.includes('completion')) return null
      return {
        name: m.name,
        sizeBytes: m.size ?? null,
        vision: info.capabilities ? info.capabilities.includes('vision') : null,
        remote: info.remote || Boolean(m.remote_host),
      }
    }),
  )
  return liste.filter(Boolean)
}

// Sucht Ollama unter den üblichen Adressen, wenn die eingestellte nicht antwortet: auf diesem
// Rechner, vom Docker-Container aus auf dem Host und als Dienst `ollama` im Compose-Profil.
// Die erste Adresse der Liste, die wie Ollama antwortet, gewinnt.
export async function findOllama(kandidaten) {
  const antworten = await Promise.all(
    kandidaten.map(async (url) => {
      try {
        const res = await fetch(`${url}/api/version`, { signal: AbortSignal.timeout(1500) })
        return res.ok && typeof (await res.json()).version === 'string'
      } catch {
        return false
      }
    }),
  )
  return kandidaten.find((_, i) => antworten[i]) ?? null
}

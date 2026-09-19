// Schnittstelle zu den KI-Anbietern der Belegauswertung. extract.js kennt nur diese
// Schnittstelle: Prompts, Schemas und Ablauf bleiben dort, Transport, Fehlermeldungen und
// Eigenheiten eines Anbieters liegen in seinem eigenen Modul.
//
// Ein Anbieter ist ein Objekt mit
//
//   json({ prompt, images, schema, timeoutMs, signal, onProgress }) → Promise<{ data, stats }>
//
// `images` ist eine Liste von { mimeType, data } mit den Bilddaten als Base64 in `data`, leer
// bei reinem Text. `data` ist die Antwort nach dem JSON-Schema `schema`. `stats` enthält
// { promptTokens, outputTokens, seconds, loadSeconds }, jeweils null, wenn der Anbieter es
// nicht meldet. Versteht das Modell nachweislich keine Bilder, wirft json(), statt sie zu
// schicken, denn sonst erfände es eine Rechnung.
//
// `onProgress` (optional) erfährt { phase: 'waiting' } zu Beginn und { phase: 'writing', chars }
// während die Antwort eintrifft. Die Oberfläche zeigt daran, dass das Modell arbeitet.
//
// `timeoutMs` gilt für die ganze Anfrage, auch wenn sie länger als fünf Minuten läuft (siehe
// ai/http.js). Bricht `signal` ab, etwa weil der Browser die Seite verlassen hat, endet die
// Anfrage beim Anbieter und json() wirft einen Fehler mit dem Namen 'AbortError'. Alle anderen
// Fehler tragen eine Meldung, die die Oberfläche so anzeigen kann.
//
// Welcher Anbieter einen Beleg auswertet, steht in `settings.ai` (siehe ai/settings.js): Fotos
// und Scans gehen an den eigenen Bilder-Anbieter, falls einer eingerichtet ist, sonst alles an
// den Standard.
//
// Bevor Belege das Haus verlassen, muss der Nutzer das einmal bestätigt haben (consentProblem in
// ai/settings.js). Das prüft aiProvider vor jeder Anfrage, nicht erst die Oberfläche.
import { ollamaProvider } from './ollama.js'
import { slotFor, consentProblem, isExternalUrl } from './settings.js'
import { getKey } from '../secrets.js'

// Alles, was ein Anbieter-Modul braucht: Platz, Art, Vorlage, Adresse, Modell, Bildverständnis,
// Schlüssel, die Bestätigung für diesen Platz und die Einstellungen für Fortgeschrittene, die
// den Transport betreffen
export function providerConfig(ai, { images = false } = {}) {
  const slot = slotFor(ai, { images })
  return {
    ...slot,
    apiKey: getKey(slot.slot) || null,
    consent: ai.consent?.[slot.slot] ?? null,
    numCtx: ai.numCtx,
    maxOutputTokens: ai.maxOutputTokens,
    jsonMode: ai.jsonMode,
    reasoningEffort: ai.reasoningEffort,
  }
}

function providerFor(config) {
  if (config.provider === 'ollama') return ollamaProvider(config)
  throw new Error('Dieser KI-Anbieter wird noch nicht unterstützt.')
}

export function aiProvider(ai, { images = false } = {}) {
  const config = providerConfig(ai, { images })
  const provider = providerFor(config)
  return {
    async json(request) {
      // Ob ein lokales Ollama das Modell an die Cloud weiterreicht, weiß nur Ollama selbst
      const remoteModel = !isExternalUrl(config.url) && provider.isRemoteModel ? await provider.isRemoteModel(request.signal) : false
      const problem = consentProblem(config, { remoteModel })
      if (problem) throw new Error(problem)
      return provider.json(request)
    },
  }
}

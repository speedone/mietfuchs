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
// ai/http.ts). Bricht `signal` ab, etwa weil der Browser die Seite verlassen hat, endet die
// Anfrage beim Anbieter und json() wirft einen Fehler mit dem Namen 'AbortError'. Alle anderen
// Fehler tragen eine Meldung, die die Oberfläche so anzeigen kann.
//
// Welcher Anbieter einen Beleg auswertet, steht in `settings.ai` (siehe ai/settings.ts): Fotos
// und Scans gehen an den eigenen Bilder-Anbieter, falls einer eingerichtet ist, sonst alles an
// den Standard.
//
// Bevor Belege das Haus verlassen, muss der Nutzer das einmal bestätigt haben (consentProblem in
// ai/settings.ts). Das prüft aiProvider vor jeder Anfrage, nicht erst die Oberfläche.
import type { AiConsent, AiJsonMode, AiSettings, AiSlot, AiSlotName } from '../../../shared/types.ts'
import { ollamaProvider, type Provider, type ProviderRequest, type ProviderResult } from './ollama.ts'
import { openaiProvider } from './openai.ts'
import { slotFor, consentProblem, isExternalUrl } from './settings.ts'
import { getKey } from '../secrets.ts'

// Die Typen der Anbieter-Schnittstelle selbst kommen aus ollama.ts (dort definiert, weil
// ollama.ts als erstes der beiden Provider-Module auf TypeScript umgestellt wurde). Hier nur
// erneut exportiert, weil dieses Modul die eigentliche Schnittstelle ist.
export type { JsonSchema, Provider, ProviderImage, ProviderProgressEvent, ProviderRequest, ProviderResult, ProviderStats } from './ollama.ts'

// Alles, was ein Anbieter-Modul braucht: Platz, Art, Vorlage, Adresse, Modell, Bildverständnis,
// Schlüssel, die Bestätigung für diesen Platz und die Einstellungen für Fortgeschrittene, die
// den Transport betreffen
export type ProviderConfig = AiSlot & {
  slot: AiSlotName
  apiKey: string | null
  consent: AiConsent | null
  numCtx: number | null
  maxOutputTokens: number | null
  jsonMode: AiJsonMode
  reasoningEffort: string | null
}

export function providerConfig(ai: AiSettings, { images = false }: { images?: boolean } = {}): ProviderConfig {
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

const providerFor = (config: ProviderConfig): Provider => (config.provider === 'openai' ? openaiProvider(config) : ollamaProvider(config))

export function aiProvider(ai: AiSettings, { images = false }: { images?: boolean } = {}): Provider {
  const config = providerConfig(ai, { images })
  const provider = providerFor(config)
  return {
    async json(request: ProviderRequest): Promise<ProviderResult> {
      // Ob ein lokales Ollama das Modell an die Cloud weiterreicht, weiß nur Ollama selbst.
      // Das kostet vor jeder Auswertung eine Anfrage an /api/show (eine Minute gemerkt); im
      // Zweifel darf nichts hinausgehen, deshalb scheitert die Auswertung, wenn sie scheitert.
      const remoteModel = !isExternalUrl(config.url) && provider.isRemoteModel ? await provider.isRemoteModel(request.signal) : false
      const problem = consentProblem(config, { remoteModel })
      if (problem) throw new Error(problem)
      return provider.json(request)
    },
  }
}

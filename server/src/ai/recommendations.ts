// Modellempfehlungen (#33). Wer nicht weiß, welches Modell passt, findet in den Einstellungen
// eine kurze Liste mit Größe, Bildverständnis und Messwerten aus dem KI-Prüflauf. Fest
// eingebaute Empfehlungen veralten, deshalb liegt dieselbe Liste als `ki-modelle.json` im Repo
// und wird nachgeladen — aber nur mit derselben Zustimmung wie beim Update-Hinweis
// (`settings.updateCheck === 'on'`) und höchstens einmal am Tag. Ohne Zustimmung, ohne Netz
// oder bei einer unbrauchbaren Datei gilt die mitgelieferte Kopie.
//
// Empfehlungen belegen nur vor: Jedes andere Modell lässt sich weiterhin eintragen und laden.
import type { AiRecommendation, AiRecommendations } from '../../../shared/types.ts'
import { readText, openRequest } from './http.ts'

// Die Gestalt von ki-modelle.json bzw. der eingebauten Kopie: eine geprüfte Liste ohne die
// Angabe, woher sie stammt (das ergänzt erst `get`).
export type RecommendationsFile = { format: 1; updated: string | null; models: AiRecommendation[] }

// Muss mit ki-modelle.json übereinstimmen, ein Test vergleicht beide. Die Kopie steht hier im
// Code, weil die Programmdatei (Bun) keine Dateien neben sich lesen kann.
export const BUILT_IN: RecommendationsFile = {
  format: 1,
  updated: '2026-09-19',
  models: [
    {
      name: 'qwen3.5:4b',
      provider: 'ollama',
      sizeGb: 3.6,
      vision: true,
      note: 'Voreingestellt. Guter Kompromiss ohne Grafikkarte: liest PDFs mit Textebene fast fehlerfrei, einseitige Scans meist richtig.',
      scores: { text: 93, scan: 75, photo: 56 },
    },
    {
      name: 'gemma4:12b',
      provider: 'ollama',
      sizeGb: 9.2,
      vision: true,
      note: 'Deutlich besser bei Fotos und Scans, braucht aber rund 9 GB Arbeitsspeicher und mehr Zeit.',
      scores: { text: 95, scan: 83, photo: 92 },
    },
    {
      name: 'minicpm-v4.5:8b',
      provider: 'ollama',
      sizeGb: 7.8,
      vision: true,
      note: 'Mittelgroß. Liest Text gut, bei Fotos und Scans schwächer als gemma4:12b.',
      scores: { text: 86, scan: 64, photo: 61 },
    },
    {
      name: 'gpt-5.4-nano',
      provider: 'openai',
      preset: 'openai',
      vision: true,
      note: 'Bei OpenAI. Ein Beleg dauert Sekunden und kostet rund 0,1 Cent. Die Belege verlassen dabei das Haus.',
      scores: { text: 95, scan: 86, photo: 79 },
    },
  ],
}

const MODELS_URL = process.env.NKA_MODELS_URL || 'https://raw.githubusercontent.com/speedone/mietfuchs/main/ki-modelle.json'
const ONE_DAY_MS = 24 * 60 * 60 * 1000
const AFTER_ERROR_MS = 60 * 60 * 1000 // nach einem Fehler eine Stunde Ruhe, wie beim Update-Hinweis
const MAX_MODELS = 20
const MAX_BYTES = 64 * 1024

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const number = (v: unknown, min: number, max: number): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null)

function checkScores(raw: unknown): AiRecommendation['scores'] | null {
  if (!isObject(raw)) return null
  const scores: NonNullable<AiRecommendation['scores']> = {}
  for (const key of ['text', 'scan', 'photo'] as const) {
    const value = number(raw[key], 0, 100)
    if (value !== null) scores[key] = value
  }
  return Object.keys(scores).length > 0 ? scores : null
}

// Ein Eintrag, auf die bekannten Felder beschränkt. Unbekannte Felder einer neueren Fassung
// fallen weg, unbrauchbare Einträge ebenso.
function checkModel(raw: unknown): AiRecommendation | null {
  if (!isObject(raw)) return null
  const { name, provider, sizeGb, vision, note, preset } = raw
  if (typeof name !== 'string' || !/^[\w.:/-]{1,100}$/.test(name)) return null
  if (provider !== 'ollama' && provider !== 'openai') return null
  if (typeof vision !== 'boolean') return null
  if (typeof note !== 'string' || !note || note.length > 300) return null
  const size = sizeGb === undefined ? null : number(sizeGb, 0.05, 1000)
  if (provider === 'ollama' && size === null) return null
  const model: AiRecommendation = { name, provider, vision, note }
  if (size !== null) model.sizeGb = size
  if (typeof preset === 'string' && /^[\w-]{1,40}$/.test(preset)) model.preset = preset
  const scores = checkScores(raw.scores)
  if (scores) model.scores = scores
  return model
}

// Prüft eine geladene Liste streng. Liefert die bereinigte Liste oder null.
export function validateRecommendations(raw: unknown): RecommendationsFile | null {
  if (!isObject(raw) || raw.format !== 1 || !Array.isArray(raw.models)) return null
  const models = raw.models.slice(0, MAX_MODELS).map(checkModel).filter((m): m is AiRecommendation => m !== null)
  if (models.length === 0) return null
  const updated = typeof raw.updated === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.updated) ? raw.updated : null
  return { format: 1, updated, models }
}

async function loadFromRepo(signal?: AbortSignal): Promise<unknown> {
  const res = await openRequest(MODELS_URL, { headers: { Accept: 'application/json' }, signal })
  if (!res.ok) throw new Error(`Status ${res.status}`)
  const text = await readText(res.body)
  if (text.length > MAX_BYTES) throw new Error('Datei zu groß')
  return JSON.parse(text)
}

export type LoadRecommendations = (signal?: AbortSignal) => Promise<unknown>
type CreateRecommendationsOptions = { load?: LoadRecommendations; now?: () => number }

// `load` und `now` lassen sich für Tests ersetzen. `get({ consented })` liefert
// { models, updated, source }, wobei `source` 'mitgeliefert' oder 'netz' ist.
export function createRecommendations({ load = loadFromRepo, now = Date.now }: CreateRecommendationsOptions = {}) {
  let cached: { at: number; value: Omit<RecommendationsFile, 'format'> } | null = null
  let blockedUntil = 0

  return {
    async get({ consented }: { consented: boolean }): Promise<AiRecommendations> {
      const builtIn: AiRecommendations = { models: BUILT_IN.models, updated: BUILT_IN.updated, source: 'mitgeliefert' }
      if (!consented) return builtIn
      const nowMs = now()
      if (cached && nowMs - cached.at < ONE_DAY_MS) return { ...cached.value, source: 'netz' }
      if (nowMs < blockedUntil) return builtIn
      try {
        const checked = validateRecommendations(await load())
        if (!checked) {
          blockedUntil = nowMs + ONE_DAY_MS // eine kaputte Datei wird nicht stündlich neu geholt
          return builtIn
        }
        cached = { at: nowMs, value: { models: checked.models, updated: checked.updated } }
        return { ...cached.value, source: 'netz' }
      } catch {
        blockedUntil = nowMs + AFTER_ERROR_MS
        return builtIn
      }
    },
  }
}

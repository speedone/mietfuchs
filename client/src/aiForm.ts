// Entscheidungslogik der KI-Einstellungen (#18), getrennt von der Darstellung in
// components/AiSettings.tsx: welche Vorlagen zur Wahl stehen, was ein Wechsel der Vorlage
// ändert, in welchem Zustand der Schlüssel ist, ob Belege erst nach einer Bestätigung an einen
// Dienst gehen und welcher Hinweis auf den Seiten mit KI-Auswertung steht. Was als extern gilt,
// entscheidet allein der Server (`aiExternal` in den Einstellungen). Geprüft in aiForm.test.ts.
import type { AiConsent, AiKeyInfo, AiModel, AiPreset, AiSettings, AiSlot, AiSlotName, Settings } from './types'
import { findModel } from './modelForm'

export const SLOT_LABELS: Record<AiSlotName, string> = { text: 'Standard-Anbieter', images: 'Anbieter für Fotos und Scans' }

// ---------- Vorlagen ----------

const GROUPS = [
  { label: 'Auf diesem Rechner oder im Heimnetz', ids: ['ollama-local', 'ollama-remote', 'lmstudio'] },
  { label: 'Dienste im Internet', ids: ['ollama-cloud', 'openai', 'ionos', 'mistral'] },
  { label: 'Eigene Adresse', ids: ['openai-compatible'] },
]

export type Option = { value: string; label: string }
export type OptionGroup = { label: string; options: Option[] }

// Gruppen für die Auswahl der Vorlage. Der gespeicherte Wert steht immer darin, sonst zeigte
// der Browser den ersten Eintrag und speicherte beim nächsten Mal etwas anderes als das
// Sichtbare. Vorlagen einer neueren Serverfassung erscheinen unter „Weitere“.
export function presetGroups(presets: AiPreset[], current: string): OptionGroup[] {
  const groups = GROUPS
    .map((g) => ({ label: g.label, options: presets.filter((p) => g.ids.includes(p.id)).map((p) => ({ value: p.id, label: p.label })) }))
    .filter((g) => g.options.length > 0)
  const grouped = new Set(groups.flatMap((g) => g.options.map((o) => o.value)))
  const rest = presets.filter((p) => !grouped.has(p.id)).map((p) => ({ value: p.id, label: p.label }))
  if (current && !grouped.has(current) && !rest.some((o) => o.value === current)) rest.push({ value: current, label: current })
  if (rest.length > 0) groups.push({ label: 'Weitere', options: rest })
  return groups
}

// Wechsel der Vorlage: Art und Adresse der Vorlage gelten. Hat die Vorlage keine Adresse, bleibt
// die bisherige, solange die Art gleich bleibt. Das Modell bleibt nur bei unveränderter Adresse,
// ein Modell von OpenAI gibt es bei Mistral nicht.
export function switchPreset(slot: AiSlot, preset: AiPreset): AiSlot {
  const sameProvider = slot.provider === preset.provider
  const url = preset.url || (sameProvider ? slot.url : '')
  const keepModel = sameProvider && url === slot.url
  return { provider: preset.provider, preset: preset.id, url, model: keepModel ? slot.model : '', vision: keepModel ? slot.vision : null }
}

export const isFixed = (settings: Settings, path: string) => (settings.fixedByEnv ?? []).includes(path)

// ---------- Schlüssel ----------

// none: die Vorlage kennt keinen · missing: nötig, aber keiner da · optional: möglich ·
// set: gespeichert · fromEnv: über eine Umgebungsvariable festgelegt
export type KeyState = 'none' | 'missing' | 'optional' | 'set' | 'fromEnv'

export function keyState(preset: AiPreset | undefined, info: AiKeyInfo | undefined): KeyState {
  if (info?.fromEnv) return 'fromEnv'
  if (info?.set) return 'set' // auch ohne Bedarf sichtbar, damit man ihn löschen kann
  if (!preset || preset.key === 'optional') return 'optional'
  return preset.key === 'required' ? 'missing' : 'none'
}

// ---------- Bestätigung externer Dienste ----------

export type ConsentState = { kind: 'external' | 'cloudModel'; target: string; given: AiConsent | null }

const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

// Braucht der gespeicherte Platz eine Bestätigung, bevor Belege hinausgehen? Maßgeblich ist der
// gespeicherte Stand, denn erst nach dem Speichern sagt der Server, ob die Adresse extern ist.
// Ein Cloud-Modell über das lokale Ollama erkennt man an der Modellliste. Sonst null.
export function consentState(settings: Settings, name: AiSlotName, models: AiModel[]): ConsentState | null {
  const slot = settings.ai?.[name]
  if (!slot) return null
  const consent = settings.ai?.consent?.[name] ?? null
  if (settings.aiExternal?.[name]) {
    return { kind: 'external', target: hostOf(slot.url), given: consent?.url === slot.url ? consent : null }
  }
  if (slot.provider === 'ollama' && findModel(models, slot.model, 'ollama')?.remote) {
    return { kind: 'cloudModel', target: slot.model, given: consent?.url === slot.url && consent?.model === slot.model ? consent : null }
  }
  return null
}

// Hinweis auf den Seiten mit KI-Auswertung, solange Belege das Haus verlassen, sonst null
export function externalNotice(settings: Settings): string | null {
  const ai = settings.ai
  if (!ai) return null
  const text = settings.aiExternal?.text ? hostOf(ai.text.url) : null
  const images = ai.images && settings.aiExternal?.images ? hostOf(ai.images.url) : null
  if (text && images && images !== text) return `Die KI-Auswertung schickt Belege an ${text}, Fotos und Scans an ${images}.`
  if (text) return `Die KI-Auswertung schickt Belege an ${text}.`
  if (images) return `Fotos und Scans gehen zur KI-Auswertung an ${images}.`
  return null
}

// Kurzfassung für die Seiten mit KI-Auswertung: welches Modell arbeitet, wo es läuft und
// gegebenenfalls, wohin die Belege gehen
export function aiSummary(settings: Settings | null): { model: string; where: string; notice: string | null } {
  const slot = settings?.ai?.text
  return {
    model: slot?.model || settings?.ollamaModel || 'ohne Modell',
    where: settings?.aiExternal?.text && slot
      ? `über ${hostOf(slot.url)}`
      : settings?.aiExternal?.images
        ? 'teils über einen Dienst'
        : 'lokal auf diesem Rechner',
    notice: settings ? externalNotice(settings) : null,
  }
}

// ---------- Formular ----------

// Das Formular entsteht aus den Einstellungen. Fehlt `ai` (Server von vor #18), gilt wie dort
// Ollama mit ollamaUrl und ollamaModel.
export function aiFormFrom(settings: Settings): AiSettings {
  if (settings.ai) return structuredClone(settings.ai)
  return {
    text: { provider: 'ollama', preset: 'ollama-local', url: settings.ollamaUrl, model: settings.ollamaModel, vision: null },
    images: null,
    timeoutSeconds: null,
    numCtx: null,
    maxOutputTokens: null,
    jsonMode: 'auto',
    reasoningEffort: null,
    extraInstructions: '',
    consent: {},
  }
}

// Ganze Zahl, null für ein leeres Feld (Standard), undefined für eine ungültige Eingabe. Die
// Grenzen prüft der Server und meldet sie mit Text.
export function parseOptionalInt(text: string): number | null | undefined {
  const trimmed = text.trim()
  if (!trimmed) return null
  return /^\d+$/.test(trimmed) ? Number(trimmed) : undefined
}

export const VISION_OPTIONS: Option[] = [
  { value: 'auto', label: 'Unbekannt, einfach versuchen' },
  { value: 'yes', label: 'Ja, versteht Bilder' },
  { value: 'no', label: 'Nein, nur Text' },
]
export const visionValue = (vision: boolean | null) => (vision === null ? 'auto' : vision ? 'yes' : 'no')
export const visionFromValue = (value: string): boolean | null => (value === 'yes' ? true : value === 'no' ? false : null)

export const JSON_MODE_OPTIONS: Option[] = [
  { value: 'auto', label: 'Automatisch (empfohlen)' },
  { value: 'schema', label: 'JSON-Schema' },
  { value: 'object', label: 'JSON-Objekt, Schema im Prompt' },
  { value: 'prompt', label: 'Nur Prompt' },
]

// Vorlagen für die KI-Anbieter (#18). Sie belegen nur vor: Adresse, Modell und Schlüssel
// lassen sich bei jeder Vorlage frei ändern, und „Eigener OpenAI-kompatibler Dienst“ nimmt jede
// Adresse, die die Chat-Completions-Schnittstelle spricht.
//
// Angaben nach der Dokumentation der Anbieter, Stand September 2026:
// - key: ob der Dienst einen Schlüssel verlangt ('required'), einen annimmt ('optional') oder
//   keinen kennt ('none')
// - tokenField: Feld für die Höchstzahl der Antwort-Token. OpenAI und IONOS nennen es
//   max_completion_tokens (IONOS nimmt ohne Angabe nur 16), Mistral, LM Studio und die
//   OpenAI-Schnittstelle von Ollama max_tokens.
// - temperature: false, wenn Mietfuchs keine Temperatur schicken soll. Neuere OpenAI-Modelle
//   lehnen 0 ab und nehmen nur ihren Standard.
// - jsonObject: false, wenn der Dienst `response_format: json_object` ablehnt (LM Studio)
// - keyUrl: wo man einen Schlüssel bekommt, privacyUrl: Bedingungen zur Datenverarbeitung,
//   notice: ein Hinweis, der vor der Bestätigung eines externen Dienstes erscheint
import type { AiPreset } from '../../../shared/types.ts'

// Ein Eintrag in PRESETS nennt nur, was von den Standardwerten (DEFAULTS) abweicht. presetById
// füllt den Rest auf.
type PresetSeed = Pick<AiPreset, 'id' | 'provider' | 'label' | 'url' | 'key'> & Partial<Omit<AiPreset, 'id' | 'provider' | 'label' | 'url' | 'key'>>

export const PRESETS: PresetSeed[] = [
  { id: 'ollama-local', provider: 'ollama', label: 'Ollama auf diesem Rechner', url: 'http://localhost:11434', key: 'none' },
  { id: 'ollama-remote', provider: 'ollama', label: 'Ollama auf einem anderen Rechner', url: '', key: 'optional' },
  {
    id: 'ollama-cloud', provider: 'ollama', label: 'Ollama Cloud', url: 'https://ollama.com', key: 'required',
    keyUrl: 'https://ollama.com/settings/keys', privacyUrl: 'https://ollama.com/privacy',
  },
  {
    id: 'openai', provider: 'openai', label: 'OpenAI', url: 'https://api.openai.com/v1', key: 'required',
    tokenField: 'max_completion_tokens', temperature: false,
    keyUrl: 'https://platform.openai.com/api-keys', privacyUrl: 'https://openai.com/policies/data-processing-addendum/',
  },
  {
    id: 'ionos', provider: 'openai', label: 'IONOS AI Model Hub', url: 'https://openai.inference.de-txl.ionos.com/v1', key: 'required',
    tokenField: 'max_completion_tokens',
    keyUrl: 'https://docs.ionos.com/cloud/ai/ai-model-hub/how-tos/access-management',
    privacyUrl: 'https://docs.ionos.com/cloud/ai/ai-model-hub/governance-and-compliance/data-handling',
  },
  {
    id: 'mistral', provider: 'openai', label: 'Mistral', url: 'https://api.mistral.ai/v1', key: 'required',
    keyUrl: 'https://console.mistral.ai/api-keys', privacyUrl: 'https://legal.mistral.ai/terms/data-processing-addendum/',
    notice: 'Im kostenlosen Tarif darf Mistral Ein- und Ausgaben zum Training verwenden. Abschalten lässt sich das in den Einstellungen des Kontos unter „Privacy“.',
  },
  { id: 'lmstudio', provider: 'openai', label: 'LM Studio', url: 'http://localhost:1234/v1', key: 'optional', jsonObject: false },
  { id: 'openai-compatible', provider: 'openai', label: 'Eigener OpenAI-kompatibler Dienst', url: '', key: 'optional' },
]

const DEFAULTS: Omit<AiPreset, 'id' | 'provider' | 'label' | 'url' | 'key'> = {
  tokenField: 'max_tokens', temperature: true, jsonObject: true, keyUrl: null, privacyUrl: null, notice: null,
}

// Vorlage mit allen Feldern, fehlende mit Standardwerten; null bei unbekannter Kennung. `id`
// kommt teils ungeprüft aus der Oberfläche, deshalb bewusst ohne Typvorgabe.
export function presetById(id: unknown): AiPreset | null {
  const preset = PRESETS.find((p) => p.id === id)
  return preset ? { ...DEFAULTS, ...preset } : null
}

// Die erste Vorlage eines Anbieters, wenn eine gespeicherte Vorlage unbrauchbar ist
export const defaultPresetFor = (provider: unknown): string | null => PRESETS.find((p) => p.provider === provider)?.id ?? null

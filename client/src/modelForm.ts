// Entscheidungslogik der Modellauswahl, getrennt von der Darstellung: welche Modelle
// zur Wahl stehen, wie sie beschriftet sind und welcher Hinweis zum gewählten Modell gehört.
// Gilt für jeden KI-Anbieter, der eine Modellliste liefert. Geprüft in client/src/modelForm.test.ts.
import type { AiModel, AiProviderKind } from './types'

// Wert des Eintrags, der von der Auswahl auf freie Eingabe umschaltet
export const OTHER_MODEL = '__other__'

export type ModelOption = { value: string; label: string }

// Ollama ergänzt einen Namen ohne Größenangabe um „:latest“, OpenAI-kompatible Dienste nicht
const fullName = (name: string, provider: AiProviderKind) => {
  const trimmed = name.trim()
  return provider === 'ollama' && !trimmed.includes(':') ? `${trimmed}:latest` : trimmed
}

export const findModel = (models: AiModel[], name: string, provider: AiProviderKind) => models.find((m) => m.name === fullName(name, provider))

export function fmtSize(bytes: number | null): string {
  if (bytes == null) return ''
  if (bytes >= 1e9) return `${(bytes / 1e9).toLocaleString('de-DE', { maximumFractionDigits: 1 })} GB`
  return `${Math.round(bytes / 1e6)} MB`
}

// Bei Ollama zählt, ob das Modell auf diesem Rechner läuft. Bei einem OpenAI-kompatiblen Dienst
// laufen alle Modelle dort, das braucht keinen Vermerk.
function optionLabel(m: AiModel, provider: AiProviderKind): string {
  const parts = provider === 'ollama' ? [m.remote ? 'Cloud-Dienst' : fmtSize(m.sizeBytes)] : []
  if (m.vision === true) parts.push('versteht Bilder')
  if (m.vision === false) parts.push('nur Text')
  const detail = parts.filter(Boolean).join(', ')
  return detail ? `${m.name} (${detail})` : m.name
}

// Optionen für das Auswahlfeld. Der gespeicherte Wert steht immer darin, auch wenn das Modell
// fehlt, damit das Feld zeigt, was tatsächlich gilt.
export function modelOptions(models: AiModel[], current: string, provider: AiProviderKind = 'ollama'): ModelOption[] {
  const selected = current.trim() ? findModel(models, current, provider) : undefined
  const options: ModelOption[] = models.map((m) => ({
    value: m === selected ? current : m.name,
    label: optionLabel(m, provider),
  }))
  const missing = provider === 'ollama' ? 'nicht installiert' : 'nicht in der Liste des Dienstes'
  if (!current.trim()) options.unshift({ value: current, label: 'Bitte ein Modell wählen' })
  else if (!selected) options.unshift({ value: current, label: `${current.trim()} (${missing})` })
  options.push({ value: OTHER_MODEL, label: 'Anderes Modell eintragen …' })
  return options
}

export type ModelHint = 'missing' | 'noVision' | 'cloud' | null

export function modelHint(models: AiModel[], current: string, provider: AiProviderKind = 'ollama'): ModelHint {
  if (!current.trim()) return null
  const m = findModel(models, current, provider)
  if (!m) return 'missing'
  if (provider === 'ollama' && m.remote) return 'cloud'
  if (m.vision === false) return 'noVision'
  return null
}

// Nur Ollama: wie man ein fehlendes Modell lädt. Im Compose-Profil „ki" läuft Ollama als
// Dienst `ollama` im Container, dort geht der Befehl über docker compose.
export function pullInstructions(name: string, ollamaUrl: string): { text: string; command: string } {
  let host = ''
  try {
    host = new URL(ollamaUrl).hostname
  } catch {
    // keine gültige Adresse: wie Ollama auf dem Rechner behandeln
  }
  const pull = `ollama pull ${name.trim()}`
  return host === 'ollama'
    ? { text: 'Im Ordner mit der docker-compose.yml ausführen:', command: `docker compose exec ollama ${pull}` }
    : { text: 'Zum Laden im Terminal ausführen:', command: pull }
}

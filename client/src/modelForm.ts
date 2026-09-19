// Entscheidungslogik der Modellauswahl, getrennt von der Darstellung: welche Modelle
// zur Wahl stehen, wie sie beschriftet sind und welcher Hinweis zum gewählten Modell gehört.
// Gilt für jeden KI-Anbieter, der eine Modellliste liefert. Geprüft in client/src/modelForm.test.ts.
import type { AiModel } from './types'

// Wert des Eintrags, der von der Auswahl auf freie Eingabe umschaltet
export const ANDERES_MODELL = '__anderes__'

export type ModelOption = { value: string; label: string }

// Ollama ergänzt einen Namen ohne Größenangabe um „:latest“
const vollerName = (name: string) => {
  const n = name.trim()
  return n.includes(':') ? n : `${n}:latest`
}

const finde = (models: AiModel[], name: string) => models.find((m) => m.name === vollerName(name))

export function fmtGroesse(bytes: number | null): string {
  if (bytes == null) return ''
  if (bytes >= 1e9) return `${(bytes / 1e9).toLocaleString('de-DE', { maximumFractionDigits: 1 })} GB`
  return `${Math.round(bytes / 1e6)} MB`
}

function beschriftung(m: AiModel): string {
  const teile = [m.remote ? 'Cloud-Dienst' : fmtGroesse(m.sizeBytes)]
  if (m.vision === true) teile.push('versteht Bilder')
  if (m.vision === false) teile.push('nur Text')
  const zusatz = teile.filter(Boolean).join(', ')
  return zusatz ? `${m.name} (${zusatz})` : m.name
}

// Optionen für das Auswahlfeld. Der gespeicherte Wert steht immer darin, auch wenn das Modell
// fehlt, damit das Feld zeigt, was tatsächlich gilt.
export function modelOptions(models: AiModel[], aktuell: string): ModelOption[] {
  const gewaehlt = aktuell.trim() ? finde(models, aktuell) : undefined
  const optionen: ModelOption[] = models.map((m) => ({
    value: m === gewaehlt ? aktuell : m.name,
    label: beschriftung(m),
  }))
  if (!aktuell.trim()) optionen.unshift({ value: aktuell, label: 'Bitte ein Modell wählen' })
  else if (!gewaehlt) optionen.unshift({ value: aktuell, label: `${aktuell.trim()} (nicht installiert)` })
  optionen.push({ value: ANDERES_MODELL, label: 'Anderes Modell eintragen …' })
  return optionen
}

export type ModelHinweis = 'fehlt' | 'ohneBilder' | 'cloud' | null

export function modelHinweis(models: AiModel[], aktuell: string): ModelHinweis {
  if (!aktuell.trim()) return null
  const m = finde(models, aktuell)
  if (!m) return 'fehlt'
  if (m.remote) return 'cloud'
  if (m.vision === false) return 'ohneBilder'
  return null
}

// Nur Ollama: Befehl zum Laden eines fehlenden Modells
export const pullBefehl = (name: string) => `ollama pull ${name.trim()}`

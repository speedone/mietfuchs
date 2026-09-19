import { describe, expect, test } from 'vitest'
import type { AiModel } from './types'
import { OTHER_MODEL, fmtSize, pullInstructions, modelHint, modelOptions } from './modelForm'

const withVision: AiModel = { name: 'bild:4b', sizeBytes: 3_400_000_000, vision: true, remote: false }
const textOnly: AiModel = { name: 'text:8b', sizeBytes: 5_000_000_000, vision: false, remote: false }
const cloudModel: AiModel = { name: 'gross:120b-cloud', sizeBytes: 384, vision: false, remote: true }
const legacy: AiModel = { name: 'alt:latest', sizeBytes: 270_000_000, vision: null, remote: false }
const MODELS = [withVision, textOnly, cloudModel, legacy]

const values = (models: AiModel[], current: string) => modelOptions(models, current).map((o) => o.value)

describe('Modellauswahl', () => {
  test('bietet die installierten Modelle an, dazu die freie Eingabe', () => {
    expect(values(MODELS, 'bild:4b')).toEqual(['bild:4b', 'text:8b', 'gross:120b-cloud', 'alt:latest', OTHER_MODEL])
  })

  test('die Beschriftung nennt Größe, Bildverständnis und Cloud-Dienste', () => {
    const labels = modelOptions(MODELS, 'bild:4b').map((o) => o.label)
    expect(labels).toEqual([
      'bild:4b (3,4 GB, versteht Bilder)',
      'text:8b (5 GB, nur Text)',
      'gross:120b-cloud (Cloud-Dienst, nur Text)',
      'alt:latest (270 MB)',
      'Anderes Modell eintragen …',
    ])
  })

  // Der angezeigte Wert muss dem gespeicherten entsprechen: Steht er nicht in der Liste,
  // zeigt der Browser den ersten Eintrag, gespeichert bliebe aber etwas anderes.
  test('ein nicht installiertes Modell steht als eigener Eintrag vorn', () => {
    const options = modelOptions(MODELS, 'fehlt:4b')
    expect(options[0]).toEqual({ value: 'fehlt:4b', label: 'fehlt:4b (nicht installiert)' })
    expect(options.map((o) => o.value)).toContain('bild:4b')
  })

  test('ein Name ohne Größenangabe meint wie bei Ollama die Fassung „latest“', () => {
    const options = modelOptions(MODELS, 'alt')
    expect(options.map((o) => o.value)).toEqual(['bild:4b', 'text:8b', 'gross:120b-cloud', 'alt', OTHER_MODEL])
    expect(options[3].label).toBe('alt:latest (270 MB)')
  })

  test('ohne gewähltes Modell steht ein leerer Eintrag vorn', () => {
    expect(modelOptions([withVision], '')[0]).toEqual({ value: '', label: 'Bitte ein Modell wählen' })
  })

  test('Leerzeichen um den Namen zählen nicht', () => {
    expect(values([withVision], ' bild:4b ')[0]).toBe(' bild:4b ')
    expect(modelOptions([withVision], ' bild:4b ')[0].label).toBe('bild:4b (3,4 GB, versteht Bilder)')
  })
})

describe('Hinweis zum gewählten Modell', () => {
  test('nicht installiert', () => expect(modelHint(MODELS, 'fehlt:4b')).toBe('missing'))
  test('ohne Bildverständnis', () => expect(modelHint(MODELS, 'text:8b')).toBe('noVision'))
  test('Cloud-Dienst geht vor fehlendem Bildverständnis', () => expect(modelHint(MODELS, 'gross:120b-cloud')).toBe('cloud'))
  test('versteht Bilder: kein Hinweis', () => expect(modelHint(MODELS, 'bild:4b')).toBeNull())
  test('Fähigkeiten unbekannt: kein Hinweis', () => expect(modelHint(MODELS, 'alt')).toBeNull())
  test('leer: kein Hinweis', () => expect(modelHint(MODELS, '  ')).toBeNull())
})

describe('Anleitung zum Laden eines Modells', () => {
  test('Ollama auf dem Rechner: Befehl im Terminal', () => {
    expect(pullInstructions(' qwen3.5:4b ', 'http://localhost:11434')).toEqual({
      text: 'Zum Laden im Terminal ausführen:',
      command: 'ollama pull qwen3.5:4b',
    })
  })

  // Im Compose-Profil läuft Ollama im Container, ein „ollama" auf dem Rechner gibt es dann nicht
  test('Ollama aus dem Compose-Profil: Befehl über docker compose', () => {
    expect(pullInstructions('qwen3.5:4b', 'http://ollama:11434/')).toEqual({
      text: 'Im Ordner mit der docker-compose.yml ausführen:',
      command: 'docker compose exec ollama ollama pull qwen3.5:4b',
    })
  })

  test('eine unlesbare Adresse gilt als Ollama auf dem Rechner', () => {
    expect(pullInstructions('a:1b', 'kein url').command).toBe('ollama pull a:1b')
  })
})

test('Größenangabe', () => {
  expect(fmtSize(3_400_000_000)).toBe('3,4 GB')
  expect(fmtSize(20_000_000_000)).toBe('20 GB')
  expect(fmtSize(270_000_000)).toBe('270 MB')
  expect(fmtSize(null)).toBe('')
})

// OpenAI-kompatible Dienste nennen Modelle ohne Größenangabe; „:latest“ ergänzt nur Ollama
describe('OpenAI-kompatible Dienste', () => {
  const SERVICE: AiModel[] = [
    { name: 'gpt-5.4-nano', sizeBytes: null, vision: null, remote: true },
    { name: 'mistral-small-latest', sizeBytes: null, vision: true, remote: true },
  ]

  test('ein Name ohne Doppelpunkt ist vollständig, nichts fehlt', () => {
    const options = modelOptions(SERVICE, 'gpt-5.4-nano', 'openai')
    expect(options.find((o) => o.value === 'gpt-5.4-nano')?.label).toBe('gpt-5.4-nano')
    expect(options.some((o) => o.label.includes('nicht'))).toBe(false)
    expect(modelHint(SERVICE, 'gpt-5.4-nano', 'openai')).toBe(null)
  })

  test('Bildverständnis steht dabei, wo der Dienst es meldet, ein Cloud-Hinweis nicht', () => {
    expect(modelOptions(SERVICE, '', 'openai').find((o) => o.value === 'mistral-small-latest')?.label).toBe('mistral-small-latest (versteht Bilder)')
  })

  test('ein Modell, das der Dienst nicht führt, bleibt sichtbar', () => {
    const options = modelOptions(SERVICE, 'eigenes-modell', 'openai')
    expect(options[0]).toEqual({ value: 'eigenes-modell', label: 'eigenes-modell (nicht in der Liste des Dienstes)' })
    expect(modelHint(SERVICE, 'eigenes-modell', 'openai')).toBe('missing')
  })
})

import { describe, expect, test } from 'vitest'
import type { AiModel } from './types'
import { ANDERES_MODELL, fmtGroesse, modelHinweis, modelOptions, pullBefehl } from './modelForm'

const bild: AiModel = { name: 'bild:4b', sizeBytes: 3_400_000_000, vision: true, remote: false }
const text: AiModel = { name: 'text:8b', sizeBytes: 5_000_000_000, vision: false, remote: false }
const cloud: AiModel = { name: 'gross:120b-cloud', sizeBytes: 384, vision: false, remote: true }
const alt: AiModel = { name: 'alt:latest', sizeBytes: 270_000_000, vision: null, remote: false }
const MODELLE = [bild, text, cloud, alt]

const werte = (models: AiModel[], aktuell: string) => modelOptions(models, aktuell).map((o) => o.value)

describe('Modellauswahl', () => {
  test('bietet die installierten Modelle an, dazu die freie Eingabe', () => {
    expect(werte(MODELLE, 'bild:4b')).toEqual(['bild:4b', 'text:8b', 'gross:120b-cloud', 'alt:latest', ANDERES_MODELL])
  })

  test('die Beschriftung nennt Größe, Bildverständnis und Cloud-Dienste', () => {
    const labels = modelOptions(MODELLE, 'bild:4b').map((o) => o.label)
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
    const optionen = modelOptions(MODELLE, 'fehlt:4b')
    expect(optionen[0]).toEqual({ value: 'fehlt:4b', label: 'fehlt:4b (nicht installiert)' })
    expect(optionen.map((o) => o.value)).toContain('bild:4b')
  })

  test('ein Name ohne Größenangabe meint wie bei Ollama die Fassung „latest“', () => {
    const optionen = modelOptions(MODELLE, 'alt')
    expect(optionen.map((o) => o.value)).toEqual(['bild:4b', 'text:8b', 'gross:120b-cloud', 'alt', ANDERES_MODELL])
    expect(optionen[3].label).toBe('alt:latest (270 MB)')
  })

  test('ohne gewähltes Modell steht ein leerer Eintrag vorn', () => {
    expect(modelOptions([bild], '')[0]).toEqual({ value: '', label: 'Bitte ein Modell wählen' })
  })

  test('Leerzeichen um den Namen zählen nicht', () => {
    expect(werte([bild], ' bild:4b ')[0]).toBe(' bild:4b ')
    expect(modelOptions([bild], ' bild:4b ')[0].label).toBe('bild:4b (3,4 GB, versteht Bilder)')
  })
})

describe('Hinweis zum gewählten Modell', () => {
  test('nicht installiert', () => expect(modelHinweis(MODELLE, 'fehlt:4b')).toBe('fehlt'))
  test('ohne Bildverständnis', () => expect(modelHinweis(MODELLE, 'text:8b')).toBe('ohneBilder'))
  test('Cloud-Dienst geht vor fehlendem Bildverständnis', () => expect(modelHinweis(MODELLE, 'gross:120b-cloud')).toBe('cloud'))
  test('versteht Bilder: kein Hinweis', () => expect(modelHinweis(MODELLE, 'bild:4b')).toBeNull())
  test('Fähigkeiten unbekannt: kein Hinweis', () => expect(modelHinweis(MODELLE, 'alt')).toBeNull())
  test('leer: kein Hinweis', () => expect(modelHinweis(MODELLE, '  ')).toBeNull())
})

test('Befehl zum Laden', () => {
  expect(pullBefehl(' qwen3.5:4b ')).toBe('ollama pull qwen3.5:4b')
})

test('Größenangabe', () => {
  expect(fmtGroesse(3_400_000_000)).toBe('3,4 GB')
  expect(fmtGroesse(20_000_000_000)).toBe('20 GB')
  expect(fmtGroesse(270_000_000)).toBe('270 MB')
  expect(fmtGroesse(null)).toBe('')
})

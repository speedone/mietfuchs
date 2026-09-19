import { describe, expect, test } from 'vitest'
import type { AiModel, AiPreset, AiSettings, AiSlot, Settings } from './types'
import {
  aiFormFrom, aiSummary, consentState, externalNotice, keyState, parseOptionalInt, presetGroups, switchPreset, visionFromValue, visionValue,
} from './aiForm'

const preset = (p: Partial<AiPreset> & Pick<AiPreset, 'id' | 'provider' | 'label'>): AiPreset => ({
  url: '', key: 'none', tokenField: 'max_tokens', temperature: true, jsonObject: true, keyUrl: null, privacyUrl: null, notice: null, ...p,
})
const PRESETS: AiPreset[] = [
  preset({ id: 'ollama-local', provider: 'ollama', label: 'Ollama auf diesem Rechner', url: 'http://localhost:11434' }),
  preset({ id: 'ollama-remote', provider: 'ollama', label: 'Ollama auf einem anderen Rechner', key: 'optional' }),
  preset({ id: 'ollama-cloud', provider: 'ollama', label: 'Ollama Cloud', url: 'https://ollama.com', key: 'required' }),
  preset({ id: 'openai', provider: 'openai', label: 'OpenAI', url: 'https://api.openai.com/v1', key: 'required' }),
  preset({ id: 'ionos', provider: 'openai', label: 'IONOS AI Model Hub', url: 'https://openai.inference.de-txl.ionos.com/v1', key: 'required' }),
  preset({ id: 'mistral', provider: 'openai', label: 'Mistral', url: 'https://api.mistral.ai/v1', key: 'required' }),
  preset({ id: 'lmstudio', provider: 'openai', label: 'LM Studio', url: 'http://localhost:1234/v1', key: 'optional' }),
  preset({ id: 'openai-compatible', provider: 'openai', label: 'Eigener OpenAI-kompatibler Dienst', key: 'optional' }),
]
const byId = (id: string) => PRESETS.find((p) => p.id === id)!

const LOCAL: AiSlot = { provider: 'ollama', preset: 'ollama-local', url: 'http://localhost:11434', model: 'qwen3.5:4b', vision: null }
const OPENAI: AiSlot = { provider: 'openai', preset: 'openai', url: 'https://api.openai.com/v1', model: 'gpt-5.4-nano', vision: true }

const ai = (patch: Partial<AiSettings> = {}): AiSettings => ({
  text: LOCAL, images: null, timeoutSeconds: null, numCtx: null, maxOutputTokens: null, jsonMode: 'auto',
  reasoningEffort: null, extraInstructions: '', consent: {}, ...patch,
})
const settings = (patch: Partial<Settings> = {}): Settings => ({
  houseName: '', address: '', landlordName: '', iban: '', paymentDeadlineDays: 30,
  ollamaUrl: 'http://localhost:11434', ollamaModel: 'qwen3.5:4b', ai: ai(), aiExternal: { text: false, images: false }, ...patch,
})

describe('Auswahl der Vorlage', () => {
  test('gruppiert nach „lokal“ und „im Internet“, der eigene Dienst extra', () => {
    const groups = presetGroups(PRESETS, 'ollama-local')
    expect(groups.map((g) => g.label)).toEqual(['Auf diesem Rechner oder im Heimnetz', 'Dienste im Internet', 'Eigene Adresse'])
    expect(groups[0].options.map((o) => o.value)).toEqual(['ollama-local', 'ollama-remote', 'lmstudio'])
    expect(groups[1].options.map((o) => o.value)).toEqual(['ollama-cloud', 'openai', 'ionos', 'mistral'])
  })

  // Steht der gespeicherte Wert nicht in der Liste, zeigt der Browser den ersten Eintrag und
  // speichert beim nächsten Mal etwas anderes als das Sichtbare (siehe CLAUDE.md)
  test('eine gespeicherte Vorlage, die es nicht mehr gibt, bleibt sichtbar', () => {
    const groups = presetGroups(PRESETS, 'alte-vorlage')
    expect(groups.flatMap((g) => g.options).some((o) => o.value === 'alte-vorlage')).toBe(true)
  })

  test('Vorlagen einer neueren Serverfassung erscheinen unter „Weitere“', () => {
    const groups = presetGroups([...PRESETS, preset({ id: 'neu', provider: 'openai', label: 'Neuer Dienst' })], 'openai')
    expect(groups.at(-1)).toEqual({ label: 'Weitere', options: [{ value: 'neu', label: 'Neuer Dienst' }] })
  })
})

describe('Wechsel der Vorlage', () => {
  test('übernimmt Adresse und Art der Vorlage, das Modell des alten Dienstes fällt weg', () => {
    expect(switchPreset(LOCAL, byId('openai'))).toEqual({ provider: 'openai', preset: 'openai', url: 'https://api.openai.com/v1', model: '', vision: null })
  })

  test('ohne Adresse in der Vorlage bleibt die bisherige, samt Modell, wenn die Art gleich bleibt', () => {
    expect(switchPreset(LOCAL, byId('ollama-remote'))).toEqual({ ...LOCAL, preset: 'ollama-remote' })
    expect(switchPreset(LOCAL, byId('openai-compatible')).url).toBe('')
  })
})

describe('Schlüssel', () => {
  test('Zustand je Vorlage und gespeichertem Schlüssel', () => {
    expect(keyState(byId('ollama-local'), { set: false, hint: '', fromEnv: null })).toBe('none')
    expect(keyState(byId('openai'), { set: false, hint: '', fromEnv: null })).toBe('missing')
    expect(keyState(byId('lmstudio'), { set: false, hint: '', fromEnv: null })).toBe('optional')
    expect(keyState(byId('openai'), { set: true, hint: '…abcd', fromEnv: null })).toBe('set')
    expect(keyState(byId('openai'), { set: true, hint: '…abcd', fromEnv: 'NKA_AI_API_KEY_FILE' })).toBe('fromEnv')
    // Ein gespeicherter Schlüssel bleibt sichtbar und löschbar, auch wenn die Vorlage keinen braucht
    expect(keyState(byId('ollama-local'), { set: true, hint: '', fromEnv: null })).toBe('set')
  })
})

describe('Bestätigung externer Dienste', () => {
  const MODELS: AiModel[] = [{ name: 'gpt-oss:120b-cloud', sizeBytes: null, vision: false, remote: true }]

  test('eine externe Adresse ohne Bestätigung', () => {
    const s = settings({ ai: ai({ text: OPENAI }), aiExternal: { text: true, images: false } })
    expect(consentState(s, 'text', [])).toEqual({ kind: 'external', target: 'api.openai.com', given: null })
  })

  test('bestätigt gilt nur für genau diese Adresse', () => {
    const consent = { url: 'https://api.openai.com/v1', model: 'gpt-5.4-nano', date: '2026-09-19' }
    const s = settings({ ai: ai({ text: OPENAI, consent: { text: consent } }), aiExternal: { text: true, images: false } })
    expect(consentState(s, 'text', [])?.given).toEqual(consent)
    const moved = settings({ ai: ai({ text: { ...OPENAI, url: 'https://api.mistral.ai/v1' }, consent: { text: consent } }), aiExternal: { text: true, images: false } })
    expect(consentState(moved, 'text', [])?.given).toBe(null)
  })

  test('ein Cloud-Modell über das lokale Ollama braucht sie, ein lokales nicht', () => {
    const cloud = settings({ ai: ai({ text: { ...LOCAL, model: 'gpt-oss:120b-cloud' } }) })
    expect(consentState(cloud, 'text', MODELS)).toEqual({ kind: 'cloudModel', target: 'gpt-oss:120b-cloud', given: null })
    expect(consentState(settings(), 'text', MODELS)).toBe(null)
  })

  test('ohne eigenen Bilder-Anbieter gibt es für Bilder nichts zu bestätigen', () => {
    expect(consentState(settings(), 'images', [])).toBe(null)
  })
})

describe('Hinweis auf Seiten mit KI-Auswertung', () => {
  test('nennt, wohin Belege gehen, und schweigt, solange alles im Haus bleibt', () => {
    expect(externalNotice(settings())).toBe(null)
    expect(externalNotice(settings({ ai: ai({ text: OPENAI }), aiExternal: { text: true, images: false } })))
      .toBe('Die KI-Auswertung schickt Belege an api.openai.com.')
    expect(externalNotice(settings({ ai: ai({ images: OPENAI }), aiExternal: { text: false, images: true } })))
      .toBe('Fotos und Scans gehen zur KI-Auswertung an api.openai.com.')
    const both = settings({ ai: ai({ text: { ...OPENAI, url: 'https://api.mistral.ai/v1' }, images: OPENAI }), aiExternal: { text: true, images: true } })
    expect(externalNotice(both)).toBe('Die KI-Auswertung schickt Belege an api.mistral.ai, Fotos und Scans an api.openai.com.')
  })
})

describe('Felder für Fortgeschrittene', () => {
  test('ganze Zahl oder leer', () => {
    expect(parseOptionalInt('')).toBe(null)
    expect(parseOptionalInt(' 900 ')).toBe(900)
    expect(parseOptionalInt('9,5')).toBe(undefined)
    expect(parseOptionalInt('zehn')).toBe(undefined)
  })

  test('Bildverständnis: unbekannt, ja, nein', () => {
    expect([null, true, false].map(visionValue)).toEqual(['auto', 'yes', 'no'])
    expect(['auto', 'yes', 'no'].map(visionFromValue)).toEqual([null, true, false])
  })

  test('das Formular entsteht aus den Einstellungen, auch von einem Server ohne „ai“', () => {
    expect(aiFormFrom(settings()).text).toEqual(LOCAL)
    const legacy = aiFormFrom(settings({ ai: undefined, ollamaUrl: 'http://nas:11434', ollamaModel: 'gemma4:12b' }))
    expect(legacy.text).toEqual({ provider: 'ollama', preset: 'ollama-local', url: 'http://nas:11434', model: 'gemma4:12b', vision: null })
    expect(legacy.jsonMode).toBe('auto')
  })
})

describe('Zusammenfassung für die Seiten mit KI-Auswertung', () => {
  test('nennt Modell und Ort, lokal ohne Hinweis', () => {
    expect(aiSummary(settings())).toEqual({ model: 'qwen3.5:4b', where: 'lokal auf diesem Rechner', notice: null })
  })

  test('bei einem Dienst im Internet steht dort dessen Adresse', () => {
    const s = settings({ ai: ai({ text: OPENAI }), aiExternal: { text: true, images: false } })
    expect(aiSummary(s)).toEqual({
      model: 'gpt-5.4-nano',
      where: 'über api.openai.com',
      notice: 'Die KI-Auswertung schickt Belege an api.openai.com.',
    })
  })
})

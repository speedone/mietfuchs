// Fehler mit Ausweg (#487): je Grund ein Satz, danach immer derselbe Ausweg; die Einstellungen werden nur
// angeboten, wo sie helfen.
import { expect, test } from 'vitest'
import { failureSentence, offersAiSettings } from './aiFailure'
import type { AiFailureReason } from './types'

test('je Grund ein Satz in der Sprache der Oberfläche', () => {
  expect(failureSentence({ reason: 'unreachable', provider: 'ollama' })).toBe('Die KI ist gerade nicht erreichbar. Ist der Rechner mit der KI eingeschaltet, oder läuft Ollama?')
  // Ollama nur, wo es um Ollama geht (Durchsicht #487)
  expect(failureSentence({ reason: 'unreachable', provider: 'openai' })).toBe('Die KI ist gerade nicht erreichbar. Ist der Dienst unter der eingestellten Adresse erreichbar?')
  expect(failureSentence({ reason: 'unreachable' })).toBe('Die KI ist gerade nicht erreichbar. Ist der Dienst unter der eingestellten Adresse erreichbar?')
  expect(failureSentence({ reason: 'address' })).toBe('Unter der eingestellten Adresse antwortet keine passende KI-Schnittstelle.')
  expect(failureSentence({ reason: 'key' })).toBe('Der Dienst nimmt den Schlüssel nicht an.')
  expect(failureSentence({ reason: 'quota' })).toBe('Das Guthaben oder Kontingent beim Dienst ist aufgebraucht.')
  expect(failureSentence({ reason: 'consent', service: 'api.openai.com' })).toBe('Die Übermittlung an api.openai.com ist noch nicht bestätigt.')
  expect(failureSentence({ reason: 'consent' })).toBe('Die Übermittlung an den Dienst ist noch nicht bestätigt.')
  expect(failureSentence({ reason: 'timeout' })).toBe('Die Auswertung hat zu lange gedauert.')
  expect(failureSentence({ reason: 'model' })).toBe('Das eingestellte KI-Modell steht nicht bereit oder kann diesen Beleg nicht lesen.')
  expect(failureSentence({ reason: 'other' })).toBe('Die KI konnte den Beleg nicht auswerten.')
})

test('„KI-Einstellungen öffnen“ nur bei Adresse, Schlüssel, Guthaben, Bestätigung und Modell', () => {
  const all: AiFailureReason[] = ['unreachable', 'address', 'model', 'key', 'quota', 'consent', 'timeout', 'other']
  expect(all.filter(offersAiSettings)).toEqual(['address', 'model', 'key', 'quota', 'consent'])
})

// Fehler mit Ausweg (#487): Scheitert die KI an einem Beleg, der schon im Belegordner liegt, schickt der Server
// den Grund in einem Wort mit (`AiFailure` in shared/types.ts). Hier steht, was die Oberfläche daraus macht: ein
// Satz je Grund, danach immer derselbe Ausweg, und ob die KI-Einstellungen weiterhelfen. Gezeigt wird es von
// components/KeptReceipt.tsx in Schnellerfassung und Kosten.
import type { AiFailure, AiFailureReason } from './types'

export const KEPT_TITLE = 'Gespeichert, nicht ausgewertet'
export const KEPT_NEXT = 'Ihr Beleg liegt im Belegordner. Sie können ihn jetzt von Hand erfassen oder es später erneut versuchen.'

const REASONS: readonly AiFailureReason[] = ['unreachable', 'address', 'model', 'key', 'quota', 'consent', 'timeout', 'other']

// Ollama nennt der Satz nur, wenn der Server sagt, dass es um Ollama geht (`provider`).
export function failureSentence({ reason, service, provider }: { reason: AiFailureReason; service?: string; provider?: AiFailure['provider'] }): string {
  switch (reason) {
    case 'unreachable': return provider === 'ollama'
      ? 'Die KI ist gerade nicht erreichbar. Ist der Rechner mit der KI eingeschaltet, oder läuft Ollama?'
      : 'Die KI ist gerade nicht erreichbar. Ist der Dienst unter der eingestellten Adresse erreichbar?'
    case 'address': return 'Unter der eingestellten Adresse antwortet keine passende KI-Schnittstelle.'
    case 'key': return 'Der Dienst nimmt den Schlüssel nicht an.'
    case 'quota': return 'Das Guthaben oder Kontingent beim Dienst ist aufgebraucht.'
    case 'consent': return `Die Übermittlung an ${service || 'den Dienst'} ist noch nicht bestätigt.`
    case 'timeout': return 'Die Auswertung hat zu lange gedauert.'
    case 'model': return 'Das eingestellte KI-Modell steht nicht bereit oder kann diesen Beleg nicht lesen.'
    case 'other': return 'Die KI konnte den Beleg nicht auswerten.'
  }
}

// Wo die Einstellungen helfen: die Adresse berichtigen, einen Schlüssel eintragen, Guthaben prüfen, die Übermittlung
// bestätigen, ein anderes Modell wählen. Bei „nicht erreichbar“ und „zu lange“ liegt es am Rechner der KI oder am Beleg.
export const offersAiSettings = (reason: AiFailureReason): boolean =>
  reason === 'address' || reason === 'model' || reason === 'key' || reason === 'quota' || reason === 'consent'

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object'

// Liest eine Fehlerantwort des Servers (Zeile `error` im Strom oder JSON-Rumpf). Nur mit gespeichertem Beleg ist es
// ein Fehler mit Ausweg; ein unbekannter Grund (neuerer Server) zählt als 'other'.
export function readFailure(data: unknown): AiFailure | null {
  if (!isObject(data) || data.kept !== true || typeof data.file !== 'string' || data.file === '') return null
  const reason = REASONS.find((r) => r === data.reason) ?? 'other'
  const error = typeof data.error === 'string' ? data.error : ''
  const provider = data.provider === 'ollama' || data.provider === 'openai' ? data.provider : undefined
  return {
    error, file: data.file, reason, kept: true,
    ...(typeof data.service === 'string' && data.service ? { service: data.service } : {}),
    ...(provider ? { provider } : {}),
    ...(data.meterPhoto === true ? { meterPhoto: true as const } : {}),
  }
}

// Der Fehler, den aiRequest wirft, trägt die Angaben als `failure`.
export const withFailure = (message: string, data: unknown): Error => {
  const failure = readFailure(data)
  return failure ? Object.assign(new Error(message), { failure }) : new Error(message)
}

export const failureOf = (e: unknown): AiFailure | null =>
  isObject(e) && isObject(e.failure) ? readFailure(e.failure) : null

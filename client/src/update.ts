// Entscheidungslogik des Update-Hinweises, ohne DOM prüfbar (siehe update.test.ts).
// Die Prüfung selbst macht der Server (server/src/update.js), und nur mit Zustimmung.
import type { Settings, UpdateStatus } from './types'

// Gefragt wird, bis eine Antwort gespeichert ist. Vor dem Laden der Einstellungen ist
// unbekannt, ob schon geantwortet wurde, dann bleibt die Frage aus.
export const consentPending = (s: Settings | null): boolean => s !== null && s.updateCheck === undefined

// „Später" gilt nur für die Version, bei der es geklickt wurde.
export const hintVisible = (st: UpdateStatus | null, s: Settings | null): boolean =>
  !!st && st.enabled && st.available && st.latest !== s?.updateDismissed

export type UpdateGuide =
  | { kind: 'download'; href: string }
  | { kind: 'command'; command: string }

// Wie man je Betriebsart aktualisiert: Die Programmdatei wird ersetzt, der Container neu
// gezogen, eine Installation aus dem Quellcode neu gebaut.
export function updateGuide(st: UpdateStatus): UpdateGuide {
  if (st.mode === 'binary') return { kind: 'download', href: st.downloadUrl ?? st.releaseUrl ?? '' }
  if (st.mode === 'docker') return { kind: 'command', command: 'docker compose pull && docker compose up -d' }
  return { kind: 'command', command: 'git pull && npm install && npm run build' }
}

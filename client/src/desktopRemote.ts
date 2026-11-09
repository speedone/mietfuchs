// Mietfuchs im Heimnetz im Programmfenster (#528, Schritt 2). Die Brücke stellt das Fenster bereit
// (desktop/src/preload.cjs, desktop/src/pairing.js); im Browser fehlt sie, dann erscheint die Karte nicht. Hier steht,
// was die Karte entscheidet, ohne React (Karte: components/RemoteCard.tsx).
import type { DesktopBridge } from './desktopNetwork'

// `get`: Stand der Verbindung; `connect`: koppelt mit Adresse und Code, bei Erfolg lädt das Fenster die Seite des
// anderen Mietfuchs; sonst steht in `problem` ein fertiger Satz. `disconnect` führt zurück zu den lokalen Daten.
export type RemoteField = 'address' | 'code'
export type RemoteState = { connected: boolean; origin?: string; version?: string }
export type RemoteResult = { ok: true } | { problem: string; field?: RemoteField }
export type RemoteBridge = {
  get: () => Promise<RemoteState>
  connect: (request: { address: string; code: string }) => Promise<RemoteResult>
  disconnect: () => Promise<unknown>
}

export function remoteBridge(
  w: { mietfuchsDesktop?: DesktopBridge } | undefined = typeof window === 'undefined' ? undefined : window,
): RemoteBridge | null {
  const remote = w?.mietfuchsDesktop?.remote
  return remote && typeof remote.get === 'function' && typeof remote.connect === 'function' && typeof remote.disconnect === 'function' ? remote : null
}

// „nas:3001“ aus dem Ursprung („https://nas:3001“); ohne lesbaren Ursprung der Text selbst
export function remoteHost(origin: string): string {
  try {
    return new URL(origin).host || origin
  } catch {
    return origin
  }
}

// Ohne Ursprung (der Stand ließ sich nach dem Koppeln nicht lesen) ohne Adresse
export const connectedLine = (state: RemoteState): string =>
  state.origin
    ? `Verbunden mit ${remoteHost(state.origin)}${state.version ? ` (Mietfuchs ${state.version})` : ''}`
    : 'Verbunden mit einem Mietfuchs im Heimnetz'


// Zu welchem Feld ein Satz der Brücke gehört: das Feld, das die Brücke nennt; ältere Fenster nennen keines, dann
// ein Stichwort im Satz. null, wenn er keines klar meint (dann steht er als Meldung der Karte).
export function problemField(problem: string, field?: RemoteField): RemoteField | null {
  if (field === 'address' || field === 'code') return field
  if (/\bCode\b/.test(problem) && !/Adresse/.test(problem)) return 'code'
  if (/Adresse|nicht erreichbar|antwortet kein Mietfuchs/.test(problem)) return 'address'
  return null
}

export const DISCONNECT_TEXT = 'Danach zeigt das Fenster wieder die Daten auf diesem Rechner. Dieses Fenster wird am anderen Mietfuchs entfernt.'

// Fehler einer Brücken-Anfrage ohne den Vorspann, den Electron vor jede abgewiesene Anfrage setzt
export function remoteErrorText(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e)
  return text.replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, '')
}

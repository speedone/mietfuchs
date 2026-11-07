// Die Anmeldung aus Sicht der Oberfläche (#528, Schritt 1): der Zustand aus `GET /api/auth`, das Ereignis, mit dem jeder
// Abruf eine verlangte Anmeldung meldet, und `appFetch`, über den alle Abrufe der Oberfläche gehen. Die Regeln stehen im
// Server (server/src/access.ts, accessServer.ts); hier wird nur gelesen und weitergereicht. Was daraus für die Seite
// folgt, entscheidet accessView.ts.
import { createContext, useContext } from 'react'

// Was der Server meldet; `transition` ist der Übergang der Stufe A, `none` heißt: nichts nötig und nichts entschieden.
export type AccessMode = 'setup' | 'password' | 'off' | 'transition' | 'none'
export type AccessInfo = {
  mode: AccessMode
  // Gilt die Anmeldung für diese Anfrage?
  required: boolean
  signedIn: boolean
  // Das Programmfenster mit seinem Fensterschlüssel: angemeldet und „am Rechner selbst“
  window: boolean
  reachable: 'local' | 'network'
  // NKA_AUTH ist gesetzt; dann entscheidet die Umgebung, nicht die Oberfläche
  envFixed: boolean
  minLength: number
  runtime: string
  // Wo der Einrichtungscode steht: der volle Pfad nur am Rechner selbst, von außen der Name der Datei
  codeFile?: string
  codeFileName?: string
}

const MODES: readonly AccessMode[] = ['setup', 'password', 'off', 'transition', 'none']
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

// Eine Antwort, die nicht so aussieht, ist keine: Dann bleibt es bei der App wie bisher (der Server prüft ohnehin).
export function accessInfoOf(raw: unknown): AccessInfo | null {
  if (!isObject(raw)) return null
  const mode = raw.mode
  if (typeof mode !== 'string' || !MODES.includes(mode as AccessMode)) return null
  return {
    mode: mode as AccessMode,
    required: raw.required === true,
    signedIn: raw.signedIn === true,
    window: raw.window === true,
    reachable: raw.reachable === 'network' ? 'network' : 'local',
    envFixed: raw.envFixed === true,
    minLength: typeof raw.minLength === 'number' && raw.minLength > 0 ? raw.minLength : 15,
    runtime: typeof raw.runtime === 'string' ? raw.runtime : '',
    ...(typeof raw.codeFile === 'string' && raw.codeFile ? { codeFile: raw.codeFile } : {}),
    ...(typeof raw.codeFileName === 'string' && raw.codeFileName ? { codeFileName: raw.codeFileName } : {}),
  }
}

// ---------- Ereignis bei verlangter Anmeldung ----------

export const ACCESS_EVENT = 'mietfuchs:anmeldung'
// `login`: Sitzung fehlt oder ist abgelaufen; `setup`: noch kein Passwort festgelegt
export type AccessDemand = 'login' | 'setup'

// Nur die Vorschaltung des Servers antwortet mit `login` bzw. `setup` im Rumpf; ein falsches Passwort (401 ohne beides)
// ist keine verlangte Anmeldung.
export function demandOf(status: number, body: unknown): AccessDemand | null {
  if (status !== 401 || !isObject(body)) return null
  if (body.setup === true) return 'setup'
  if (body.login === true) return 'login'
  return null
}

export function announceDemand(demand: AccessDemand): void {
  window.dispatchEvent(new CustomEvent<AccessDemand>(ACCESS_EVENT, { detail: demand }))
}

export function onAccessDemand(listener: (demand: AccessDemand) => void): () => void {
  const handle = (e: Event) => {
    const demand = (e as CustomEvent<unknown>).detail
    if (demand === 'login' || demand === 'setup') listener(demand)
  }
  window.addEventListener(ACCESS_EVENT, handle)
  return () => window.removeEventListener(ACCESS_EVENT, handle)
}

// Jeder Abruf der Oberfläche geht hierüber (Wächter in access.test.ts): Verlangt der Server eine Anmeldung, meldet es
// das Ereignis, und die App zeigt die Anmeldung. Die Antwort geht unverändert weiter, der Aufrufer behandelt den Fehler
// wie jeden anderen. Gelesen wird eine Kopie, damit der Aufrufer den Rumpf noch lesen kann.
export async function appFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init)
  if (res.status === 401 && typeof res.clone === 'function') {
    const body: unknown = await res.clone().json().catch(() => null)
    const demand = demandOf(res.status, body)
    if (demand) announceDemand(demand)
  }
  return res
}

// Der Zustand für diese Anfrage; ohne lesbare Antwort `null` (ältere Fassung, Netz weg): Dann zeigt die App sich wie
// bisher, und eine verlangte Anmeldung meldet sich über das Ereignis.
export async function loadAccess(): Promise<AccessInfo | null> {
  try {
    const res = await appFetch('/api/auth', { headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    return accessInfoOf(await res.json())
  } catch {
    return null
  }
}

// ---------- Zustand für die Schale ----------

export type AccessState = {
  info: AccessInfo | null
  // Fragt den Server neu, etwa nach dem Festlegen eines Passworts
  reload: () => Promise<void>
  // Der Einrichtungscode aus der Adresse (`#einrichtung=…`), schon aus ihr entfernt
  setupCode: string
}
export const AccessContext = createContext<AccessState | null>(null)
export const useAccess = (): AccessState | null => useContext(AccessContext)

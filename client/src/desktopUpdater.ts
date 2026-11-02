// Automatische Updates im Programmfenster unter Windows (#517). Die Brücke stellt das Fenster bereit
// (desktop/src/preload.cjs, Logik in desktop/src/updater.js); im Browser fehlt sie. Hier steht, was die Oberfläche
// entscheidet, ohne React (Hinweis und Abschnitt in „Über Mietfuchs“: components/DesktopUpdater.tsx).

// Wie desktop/src/updater.js (UpdaterState). `off`: Das Fenster aktualisiert hier nicht selbst (Mac, Microsoft Store,
// beim Entwickeln); dann gilt der Update-Hinweis des Servers wie bisher.
export type UpdaterState = {
  phase: 'off' | 'idle' | 'checking' | 'latest' | 'downloading' | 'ready' | 'error'
  current: string
  version: string | null
  percent: number | null
  choice: 'later' | null
  error: string | null
  checkedAt: string | null
}

export type UpdaterBridge = {
  get: () => Promise<UpdaterState>
  // `force` für „Jetzt prüfen“ (höchstens einmal pro Minute), sonst nur, wenn noch nicht oder vor einem Tag geprüft
  check: (options?: { force?: boolean }) => Promise<UpdaterState>
  later: () => Promise<UpdaterState>
  restart: () => Promise<UpdaterState>
  onChange: (listener: (state: UpdaterState) => void) => () => void
}

// Die Brücke, wenn das Fenster sie kennt. Fenster vor dieser Fassung hatten keine.
export function updaterBridge(
  w: { mietfuchsDesktop?: { updater?: unknown } } | undefined = typeof window === 'undefined' ? undefined : window,
): UpdaterBridge | null {
  const u = w?.mietfuchsDesktop?.updater as Partial<UpdaterBridge> | undefined
  if (!u) return null
  const fns = [u.get, u.check, u.later, u.restart, u.onChange]
  return fns.every((f) => typeof f === 'function') ? (u as UpdaterBridge) : null
}

// Wer für Updates zuständig ist: das Fenster (`window`), der Server mit seinem Hinweis und seiner Anleitung (`server`)
// oder noch unbekannt (`pending`: Brücke da, Stand noch nicht gelesen). Solange es unbekannt ist, zeigt die Oberfläche
// keinen der beiden Hinweise, damit nie beide nacheinander erscheinen.
export type UpdateOwner = 'window' | 'server' | 'pending'

export function updateOwner(bridge: boolean, state: UpdaterState | null): UpdateOwner {
  if (!bridge) return 'server'
  if (!state) return 'pending'
  return state.phase === 'off' ? 'server' : 'window'
}

// Der Hinweis „Version x ist bereit“ oben in der Seitenleiste, bis gewählt ist
export const readyHintVisible = (state: UpdaterState | null): boolean =>
  !!state && state.phase === 'ready' && state.choice !== 'later' && !!state.version

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })

const sentence = (text: string) => (/[.!?…]$/.test(text) ? text : `${text}.`)

// Der Stand in „Über Mietfuchs“
export function updaterText(state: UpdaterState): string {
  const lastChecked = state.checkedAt ? ` Zuletzt geprüft: ${fmtDateTime(state.checkedAt)}.` : ''
  switch (state.phase) {
    case 'checking':
      return `Installiert ist Version ${state.current}. Mietfuchs sucht nach einer neuen Version …`
    case 'latest':
      return `Sie nutzen die aktuelle Version ${state.current}.${lastChecked}`
    case 'downloading':
      return `Version ${state.version} wird heruntergeladen …${state.percent !== null ? ` (${state.percent} %)` : ''} Installiert ist ${state.current}.`
    case 'ready':
      return state.choice === 'later'
        ? `Version ${state.version} ist bereit und wird installiert, wenn Sie Mietfuchs beenden. Beim nächsten Start läuft die neue Version.`
        : `Version ${state.version} ist bereit, installiert ist ${state.current}. Mietfuchs installiert sie beim Neustart.`
    case 'error':
      return `Installiert ist Version ${state.current}. Die letzte Prüfung ist fehlgeschlagen: ${sentence(state.error ?? 'Unbekannter Fehler')}${lastChecked}`
    default:
      return `Installiert ist Version ${state.current}.`
  }
}

// Die Release-Seite einer Version, für „Was ist neu?“; die Adresse ist fest, die Version kommt vom Fenster
export const releaseNotesUrl = (version: string): string =>
  `https://github.com/speedone/mietfuchs/releases/tag/v${encodeURIComponent(version)}`

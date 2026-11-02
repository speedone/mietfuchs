import { useEffect, useState } from 'react'
import FoxLogo from './Logo'
import { useToast } from './feedback'
import { readyHintVisible, releaseNotesUrl, updateOwner, updaterBridge, updaterText, type UpdateOwner, type UpdaterBridge, type UpdaterState } from '../desktopUpdater'
import { RELEASES_URL } from '../update'

// Automatische Updates im Programmfenster unter Windows (#517): der Hinweis „Version x ist bereit“ oben in der
// Seitenleiste und der Stand in „Über Mietfuchs“. Geprüft, geladen und installiert wird im Fenster
// (desktop/src/updater.js), nur mit der Zustimmung aus den Einstellungen. Wo das Fenster nicht selbst aktualisiert
// (Mac, Store, Browser), bleibt es beim Update-Hinweis des Servers (Update.tsx).

export type DesktopUpdates = { owner: UpdateOwner; state: UpdaterState | null; bridge: UpdaterBridge | null }

const messageOf = (e: unknown) => String((e as Error)?.message ?? e)

const OFF: UpdaterState = { phase: 'off', current: '', version: null, percent: null, choice: null, error: null, checkedAt: null }

// Liest den Stand und folgt jeder Änderung. Wird das Häkchen gesetzt, prüft das Fenster gleich, wenn es heute noch
// nicht geprüft hat (es liest die Zustimmung selbst beim Server nach); ohne Zustimmung fragt es nicht.
export function useDesktopUpdater(consent: unknown): DesktopUpdates {
  const [bridge] = useState(() => updaterBridge())
  const [state, setState] = useState<UpdaterState | null>(null)
  useEffect(() => {
    if (!bridge) return
    let live = true
    const off = bridge.onChange((s) => { if (live) setState(s) })
    // Antwortet die Brücke nicht, gilt der Server (Durchsicht K4)
    bridge.get().then((s) => { if (live) setState(s) }).catch(() => { if (live) setState((s) => s ?? OFF) })
    return () => { live = false; off() }
  }, [bridge])
  useEffect(() => {
    if (bridge && consent === 'on') void bridge.check({ force: false }).catch(() => {})
  }, [bridge, consent])
  return { owner: updateOwner(bridge !== null, state), state, bridge }
}

// Die beiden Knöpfe, im Hinweis und in „Über Mietfuchs“. „Jetzt neu starten“ beendet den Server, installiert und
// startet Mietfuchs neu; „Beim nächsten Start“ installiert, wenn Mietfuchs beendet wird.
function useChoice(bridge: UpdaterBridge) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const restart = async () => {
    setBusy(true)
    try {
      await bridge.restart()
    } catch (e) {
      toast(`Neu starten ging nicht: ${messageOf(e)}`, 'error')
      setBusy(false)
    }
  }
  const later = async () => {
    try {
      await bridge.later()
    } catch (e) {
      toast(`Das ging nicht: ${messageOf(e)}`, 'error')
    }
  }
  return { busy, restart, later }
}

// ---------- Hinweis oben in der Seitenleiste ----------

export function UpdaterReadyHint({ updates }: { updates: DesktopUpdates }) {
  const { state, bridge } = updates
  if (!bridge || !state || !readyHintVisible(state)) return null
  return <ReadyHint state={state} bridge={bridge} />
}

function ReadyHint({ state, bridge }: { state: UpdaterState; bridge: UpdaterBridge }) {
  const { busy, restart, later } = useChoice(bridge)
  const version = state.version ?? ''
  return (
    <div className="update-hint" role="status">
      <div className="update-hint-head">
        <FoxLogo size={18} />
        <span>Version {version} ist bereit</span>
      </div>
      <p>Sie nutzen {state.current}. Zum Installieren startet Mietfuchs kurz neu.</p>
      <button className="update-go" disabled={busy} onClick={() => void restart()}>
        {busy && <span className="spinner" />}Jetzt neu starten
      </button>
      <div className="update-hint-links">
        <a href={releaseNotesUrl(version)} target="_blank" rel="noreferrer">Was ist neu?</a>
        <button disabled={busy} onClick={() => void later()}>Beim nächsten Start</button>
      </div>
    </div>
  )
}

// ---------- In „Über Mietfuchs“ ----------

// Der Stand und, wenn eine Version bereitliegt, dieselben Knöpfe wie im Hinweis. Bei einem Fehler führt ein Link zur
// Release-Seite, von dort lässt sich der Installer von Hand laden.
export function UpdaterStatus({ updates }: { updates: DesktopUpdates }) {
  const { state, bridge } = updates
  if (!state || !bridge) return null
  return (
    <>
      <p className="update-state">{updaterText(state)}</p>
      {state.phase === 'ready' && state.choice !== 'later' && <ReadyButtons bridge={bridge} />}
      {state.phase === 'error' && (
        <p className="muted">
          Sie können die neue Version auch selbst von der{' '}
          <a href={RELEASES_URL} target="_blank" rel="noreferrer">Release-Seite</a> laden und installieren. Ihre Daten
          bleiben, wo sie sind.
        </p>
      )}
    </>
  )
}

function ReadyButtons({ bridge }: { bridge: UpdaterBridge }) {
  const { busy, restart, later } = useChoice(bridge)
  return (
    <div className="row">
      <button className="btn" disabled={busy} onClick={() => void restart()}>
        {busy && <span className="spinner" />}Jetzt neu starten
      </button>
      <button className="btn secondary" disabled={busy} onClick={() => void later()}>Beim nächsten Start</button>
    </div>
  )
}

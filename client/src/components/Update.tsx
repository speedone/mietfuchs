import { useCallback, useEffect, useState } from 'react'
import type { Settings, UpdateStatus } from '../types'
import { api } from '../api'
import { updateGuide } from '../update'
import { useToast } from './feedback'
import FoxLogo from './Logo'

// Update-Hinweis in drei Teilen: die einmalige Frage im Cockpit, der Hinweis unten in der
// Seitenleiste und die Karte in den Einstellungen. Nach GitHub fragt nur der Server, und nur
// mit Zustimmung (server/src/update.js). /api/update selbst ist lokal und liefert ohne
// Zustimmung nur die installierte Version.

const speichern = (patch: Partial<Settings>) =>
  api('/api/settings', { method: 'PUT', body: JSON.stringify(patch) })

export type UpdateState = {
  status: UpdateStatus | null
  checking: boolean
  checkNow: () => Promise<void>
}

// Holt den Stand, sobald die Einstellungen geladen sind, und erneut, wenn sich die Zustimmung
// ändert. So erscheint der Hinweis direkt nach dem „Ja", ohne die Seite neu zu laden.
export function useUpdateStatus(settings: Settings | null): UpdateState {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const geladen = settings !== null
  const consent = settings?.updateCheck

  useEffect(() => {
    if (!geladen) return
    let aktuell = true
    api<UpdateStatus>('/api/update')
      .then((s) => { if (aktuell) setStatus(s) })
      .catch(() => {}) // ohne Antwort bleibt der Hinweis einfach aus
    return () => { aktuell = false }
  }, [geladen, consent])

  const checkNow = useCallback(async () => {
    setChecking(true)
    try {
      setStatus(await api<UpdateStatus>('/api/update/check', { method: 'POST' }))
    } finally {
      setChecking(false)
    }
  }, [])

  return { status, checking, checkNow }
}

// ---------- Einmalige Frage im Cockpit ----------

export function UpdateConsent({ onAnswered }: { onAnswered: () => unknown }) {
  const [busy, setBusy] = useState(false)
  const antworten = async (updateCheck: 'on' | 'off') => {
    setBusy(true)
    try {
      await speichern({ updateCheck })
      await onAnswered()
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="card update-consent" aria-labelledby="update-consent-title">
      <FoxLogo size={40} />
      <div className="update-consent-body">
        <h2 id="update-consent-title">Bei neuen Versionen Bescheid geben?</h2>
        <p>
          Mietfuchs kann beim Öffnen bei GitHub nachsehen, ob eine neue Version erschienen ist.
          GitHub sieht dabei nur deine IP-Adresse und die installierte Versionsnummer. Deine
          Daten bleiben auf diesem Rechner.
        </p>
        <div className="row">
          <button className="btn" disabled={busy} onClick={() => void antworten('on')}>Ja, Bescheid geben</button>
          <button className="btn secondary" disabled={busy} onClick={() => void antworten('off')}>Nein, danke</button>
        </div>
        <p className="muted">Du kannst das jederzeit in den Einstellungen ändern.</p>
      </div>
    </section>
  )
}

// ---------- Hinweis unten in der Seitenleiste ----------

type HintProps = {
  status: UpdateStatus
  onDismissed: () => unknown
  onShowGuide: () => void
}

export function UpdateHint({ status, onDismissed, onShowGuide }: HintProps) {
  const guide = updateGuide(status)
  const spaeter = async () => {
    await speichern({ updateDismissed: status.latest ?? undefined })
    await onDismissed()
  }
  return (
    <div className="update-hint" role="status">
      <div className="update-hint-head">
        <FoxLogo size={18} />
        <span>Version {status.latest} ist da</span>
      </div>
      <p>Du nutzt {status.current}.</p>
      {guide.kind === 'download' ? (
        <a className="update-go" href={guide.href}>Herunterladen</a>
      ) : (
        <button className="update-go" onClick={onShowGuide}>So aktualisierst du</button>
      )}
      <div className="update-hint-links">
        {status.releaseUrl && (
          <a href={status.releaseUrl} target="_blank" rel="noreferrer">Was ist neu?</a>
        )}
        <button onClick={() => void spaeter()}>Später</button>
      </div>
    </div>
  )
}

// ---------- Karte in den Einstellungen ----------

const zeitpunkt = (iso: string) =>
  new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })

type SettingsProps = {
  settings: Settings
  update: UpdateState
  reload: () => Promise<void>
}

export function UpdateSettings({ settings, update, reload }: SettingsProps) {
  const toast = useToast()
  const { status, checking, checkNow } = update
  // Das Häkchen springt sofort um und nicht erst nach der Antwort des Servers
  const [an, setAn] = useState(settings.updateCheck === 'on')
  useEffect(() => setAn(settings.updateCheck === 'on'), [settings.updateCheck])

  const umschalten = async (checked: boolean) => {
    setAn(checked)
    try {
      await speichern({ updateCheck: checked ? 'on' : 'off' })
      await reload()
      toast(checked ? 'Mietfuchs sieht ab jetzt nach neuen Versionen.' : 'Mietfuchs fragt nicht mehr nach neuen Versionen.')
    } catch {
      setAn(!checked)
      toast('Die Einstellung ließ sich nicht speichern.', 'error')
    }
  }

  const kopieren = async (befehl: string) => {
    try {
      await navigator.clipboard.writeText(befehl)
      toast('Befehl kopiert.')
    } catch {
      toast('Kopieren ging nicht. Bitte den Befehl von Hand markieren.', 'error')
    }
  }

  const guide = status?.enabled && status.available ? updateGuide(status) : null

  return (
    <div className="card">
      <h2>Updates</h2>
      <label className="update-toggle">
        <input type="checkbox" checked={an} onChange={(e) => void umschalten(e.target.checked)} />
        Beim Öffnen nach neuen Versionen schauen
      </label>
      <p className="muted">
        Dafür fragt Mietfuchs bei GitHub nach. GitHub sieht dabei nur deine IP-Adresse und die
        installierte Versionsnummer.
      </p>

      {status && <p className="update-state">{statusText(status)}</p>}

      <div className="row">
        <button className="btn secondary" disabled={!an || checking} onClick={() => void checkNow()}>
          {checking && <span className="spinner" />}Jetzt prüfen
        </button>
      </div>

      {guide && status && (
        <div className="update-guide">
          {guide.kind === 'download' ? (
            <>
              <p>
                Lade die neue Programmdatei herunter und ersetze damit die alte, während Mietfuchs
                beendet ist. Der Ordner <code>data</code> daneben bleibt, wie er ist.
              </p>
              <div className="row">
                <a className="btn" href={guide.href}>Version {status.latest} herunterladen</a>
                {status.releaseUrl && (
                  <a className="btn secondary" href={status.releaseUrl} target="_blank" rel="noreferrer">Was ist neu?</a>
                )}
              </div>
            </>
          ) : (
            <>
              <p>
                {status.mode === 'docker'
                  ? 'Im Ordner mit der docker-compose.yml ausführen:'
                  : 'Im Mietfuchs-Ordner ausführen und Mietfuchs danach neu starten:'}
              </p>
              <div className="update-command">
                <code>{guide.command}</code>
                <button className="btn secondary small" onClick={() => void kopieren(guide.command)}>Befehl kopieren</button>
              </div>
              {status.mode === 'docker' && (
                <p className="muted">
                  Mit <code>docker run</code> gestartet oder das Image selbst gebaut? Die passenden
                  Befehle stehen im{' '}
                  <a href="https://github.com/speedone/mietfuchs#mit-docker" target="_blank" rel="noreferrer">README</a>.
                </p>
              )}
              {status.releaseUrl && (
                <p className="muted">
                  <a href={status.releaseUrl} target="_blank" rel="noreferrer">Was ist neu in Version {status.latest}?</a>
                </p>
              )}
            </>
          )}
          <p className="muted">Vorher ein Backup herunterzuladen (weiter unten) schadet nie.</p>
        </div>
      )}
    </div>
  )
}

function statusText(s: UpdateStatus): string {
  if (!s.enabled) return `Installiert ist Version ${s.current}.`
  const wann = s.checkedAt ? ` Zuletzt geprüft: ${zeitpunkt(s.checkedAt)}.` : ''
  if (s.error) {
    const bekannt = s.available ? ` Zuletzt bekannt: Version ${s.latest} ist erschienen.` : ''
    return `Installiert ist Version ${s.current}. Die letzte Prüfung ist fehlgeschlagen: ${s.error}${bekannt}`
  }
  if (s.available) return `Version ${s.latest} ist erschienen, installiert ist ${s.current}.${wann}`
  if (s.latest) return `Du nutzt die aktuelle Version ${s.current}.${wann}`
  return `Installiert ist Version ${s.current}.`
}

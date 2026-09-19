import { useCallback, useEffect, useRef, useState } from 'react'
import type { Settings, UpdateStatus } from '../types'
import { api } from '../api'
import { updateGuide, type UpdateGuide } from '../update'
import { useToast } from './feedback'
import FoxLogo from './Logo'

// Update-Hinweis in drei Teilen: die einmalige Frage im Cockpit, der Hinweis oben in der
// Seitenleiste und die Karte in den Einstellungen. Nach GitHub fragt nur der Server, und nur
// mit Zustimmung (server/src/update.js). /api/update selbst ist lokal und liefert ohne
// Zustimmung nur die installierte Version.

const README = 'https://github.com/speedone/mietfuchs#herunterladen--starten-ohne-installation'

const speichern = (patch: Partial<Settings>) =>
  api('/api/settings', { method: 'PUT', body: JSON.stringify(patch) })

const meldung = (e: unknown) => String((e as Error)?.message ?? e)

export type UpdateState = {
  status: UpdateStatus | null
  checking: boolean
  checkNow: () => Promise<void> // wirft, wenn der Mietfuchs-Server nicht antwortet
}

// Holt den Stand, sobald die Einstellungen geladen sind, und erneut, wenn sich die Zustimmung
// ändert. So erscheint der Hinweis direkt nach dem „Ja", ohne die Seite neu zu laden.
export function useUpdateStatus(settings: Settings | null): UpdateState {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [checking, setChecking] = useState(false)
  // Jede Anfrage bekommt eine Nummer. Übernommen wird nur die Antwort der zuletzt gestellten,
  // sonst könnte ein langsames GET das Ergebnis von „Jetzt prüfen" überschreiben.
  const zaehler = useRef(0)
  const geladen = settings !== null
  const consent = settings?.updateCheck

  useEffect(() => {
    if (!geladen) return
    const nr = ++zaehler.current
    api<UpdateStatus>('/api/update')
      .then((s) => { if (nr === zaehler.current) setStatus(s) })
      .catch(() => {}) // ohne Antwort bleibt der Hinweis einfach aus
  }, [geladen, consent])

  const checkNow = useCallback(async () => {
    const nr = ++zaehler.current
    setChecking(true)
    try {
      const s = await api<UpdateStatus>('/api/update/check', { method: 'POST' })
      if (nr === zaehler.current) setStatus(s)
    } finally {
      setChecking(false)
    }
  }, [])

  return { status, checking, checkNow }
}

// ---------- Einmalige Frage im Cockpit ----------

export function UpdateConsent({ onAnswered }: { onAnswered: () => unknown }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const antworten = async (updateCheck: 'on' | 'off') => {
    setBusy(true)
    try {
      await speichern({ updateCheck })
      await onAnswered()
    } catch (e) {
      toast(`Die Antwort ließ sich nicht speichern: ${meldung(e)}`, 'error')
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

// ---------- Hinweis oben in der Seitenleiste ----------

type HintProps = {
  status: UpdateStatus
  onDismissed: () => unknown
  onShowGuide: () => void
}

// Führt immer zur Anleitung, auch bei der Programmdatei. Wer die neue Datei direkt aus dem
// Download-Ordner startet, sieht einen leeren Datenordner und hält seine Daten für verloren.
export function UpdateHint({ status, onDismissed, onShowGuide }: HintProps) {
  const toast = useToast()
  const spaeter = async () => {
    try {
      await speichern({ updateDismissed: status.latest ?? undefined })
      await onDismissed()
    } catch (e) {
      toast(`Ausblenden ging nicht: ${meldung(e)}`, 'error')
    }
  }
  return (
    <div className="update-hint" role="status">
      <div className="update-hint-head">
        <FoxLogo size={18} />
        <span>Version {status.latest} ist da</span>
      </div>
      <p>Du nutzt {status.current}.</p>
      <button className="update-go" onClick={onShowGuide}>So aktualisierst du</button>
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
  const [speichert, setSpeichert] = useState(false)
  useEffect(() => setAn(settings.updateCheck === 'on'), [settings.updateCheck])

  const umschalten = async (checked: boolean) => {
    setAn(checked)
    setSpeichert(true)
    try {
      await speichern({ updateCheck: checked ? 'on' : 'off' })
      await reload()
      toast(checked ? 'Mietfuchs schaut ab jetzt nach neuen Versionen.' : 'Mietfuchs fragt nicht mehr nach neuen Versionen.')
    } catch {
      setAn(!checked)
      toast('Die Einstellung ließ sich nicht speichern.', 'error')
    } finally {
      setSpeichert(false)
    }
  }

  const pruefen = async () => {
    try {
      await checkNow()
    } catch (e) {
      toast(`Prüfen ging nicht: ${meldung(e)}`, 'error')
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
        {/* Gesperrt, solange das Häkchen gespeichert wird: Sonst fragte der Server noch ohne Zustimmung. */}
        <button className="btn secondary" disabled={!an || checking || speichert} onClick={() => void pruefen()}>
          {checking && <span className="spinner" />}Jetzt prüfen
        </button>
      </div>

      {guide && status && (
        <div className="update-guide">
          {guide.kind === 'download'
            ? <Download guide={guide} status={status} />
            : <Befehle lines={guide.lines} status={status} />}
          <p className="muted">Vorher ein Backup herunterzuladen (weiter unten) schadet nie.</p>
        </div>
      )}
    </div>
  )
}

// Anleitung für die Programmdatei, je System. Der wichtigste Satz ist überall derselbe: Die
// neue Datei gehört in den Ordner der alten, denn dort liegt der Ordner data mit den Daten.
function Download({ guide, status }: { guide: Extract<UpdateGuide, { kind: 'download' }>; status: UpdateStatus }) {
  const datei = guide.href.split('/').pop() ?? ''
  const knopf = guide.newTab ? (
    <a className="btn" href={guide.href} target="_blank" rel="noreferrer">Zur Release-Seite</a>
  ) : (
    <a className="btn" href={guide.href}>Version {status.latest} herunterladen</a>
  )
  const beenden = <li>Mietfuchs beenden, also das Programmfenster schließen.</li>

  return (
    <>
      <div className="row update-download">
        {knopf}
        {status.releaseUrl && !guide.newTab && (
          <a className="btn secondary" href={status.releaseUrl} target="_blank" rel="noreferrer">Was ist neu?</a>
        )}
      </div>
      {guide.system === 'windows' && (
        <ol className="update-steps">
          <li>Die neue <code>{datei}</code> mit dem Knopf oben herunterladen.</li>
          {beenden}
          <li>Die neue Datei im selben Ordner wie bisher ablegen und die alte damit ersetzen. Dort liegt auch der Ordner <code>data</code> mit deinen Daten.</li>
          <li>Mietfuchs wie gewohnt starten. Meldet sich Windows wie beim ersten Mal, hilft <em>Weitere Informationen</em> und dann <em>Trotzdem ausführen</em>.</li>
        </ol>
      )}
      {guide.system === 'macos' && (
        <ol className="update-steps">
          <li>Die Zip-Datei mit dem Knopf oben herunterladen und mit einem Doppelklick entpacken.</li>
          {beenden}
          <li>Die entpackte Programmdatei im selben Ordner wie bisher ablegen und die alte damit ersetzen. Dort liegt auch der Ordner <code>data</code> mit deinen Daten.</li>
          <li>Mietfuchs starten. Beim ersten Start blockiert macOS die neue Datei wie bei der Erstinstallation. Wie du sie freigibst, steht im <a href={README} target="_blank" rel="noreferrer">README</a>.</li>
        </ol>
      )}
      {guide.system === 'linux' && (
        <ol className="update-steps">
          <li>Das Archiv mit dem Knopf oben herunterladen.</li>
          {beenden}
          <li>Das Archiv im selben Ordner wie bisher ablegen und dort entpacken. Das ersetzt die alte Programmdatei, der Ordner <code>data</code> bleibt. <code>tar -xzf {datei}</code></li>
          <li>Mietfuchs wie gewohnt starten, etwa mit <code>./{datei.replace(/\.tar\.gz$/, '')}</code>.</li>
        </ol>
      )}
      {guide.system === null && (
        <p>
          Auf der Release-Seite die Datei für dein System wählen. Danach wie beim ersten Mal
          entpacken, falls nötig, und die alte Programmdatei im selben Ordner wie bisher ersetzen,
          damit der Ordner <code>data</code> daneben bleibt.
        </p>
      )}
    </>
  )
}

function Befehle({ lines, status }: { lines: string[]; status: UpdateStatus }) {
  const toast = useToast()
  const text = lines.join('\n')
  const kopieren = async () => {
    try {
      await navigator.clipboard.writeText(text)
      toast('Befehle kopiert.')
    } catch {
      toast('Kopieren ging nicht. Bitte die Befehle von Hand markieren.', 'error')
    }
  }
  return (
    <>
      <p>
        {status.mode === 'docker'
          ? 'Im Ordner mit der docker-compose.yml nacheinander ausführen:'
          : 'Im Mietfuchs-Ordner nacheinander ausführen und Mietfuchs danach neu starten:'}
      </p>
      <div className="update-command">
        <pre>{lines.map((l) => <code key={l}>{l}</code>)}</pre>
        <button className="btn secondary small" onClick={() => void kopieren()}>Befehle kopieren</button>
      </div>
      {status.mode === 'docker' && (
        <p className="muted">
          Steht in der docker-compose.yml eine feste Version wie <code>:0.4.0</code>, trage vorher
          die neue ein. Mit <code>docker run</code> gestartet oder das Image selbst gebaut? Die
          passenden Befehle stehen im{' '}
          <a href="https://github.com/speedone/mietfuchs#mit-docker" target="_blank" rel="noreferrer">README</a>.
        </p>
      )}
      {status.releaseUrl && (
        <p className="muted">
          <a href={status.releaseUrl} target="_blank" rel="noreferrer">Was ist neu in Version {status.latest}?</a>
        </p>
      )}
    </>
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

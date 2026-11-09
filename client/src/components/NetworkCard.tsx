// Karte „Zugriff aus dem Heimnetz“ in den Einstellungen (#517), nur im Programmfenster. Das Häkchen ist ein Entwurf
// (#309); „Speichern“ lässt das Fenster den Server mit der neuen Adresse neu starten, danach lädt die Seite neu.
// Was die Karte zeigt, entscheidet desktopNetwork.ts.
import { useEffect, useRef, useState } from 'react'
import { ApiError, api, errorText } from '../api'
import { announceNetwork, askForPassword, networkView, onNetworkCardRequest, passwordEntryProblem, type NetworkAccess, type NetworkBridge, type NetworkState } from '../desktopNetwork'
import { keepDraft, useDraft } from '../useDraft'
import { useConfirm } from './feedback'
import { countOf } from '../../../shared/wording.ts'
import Card from './Card'
import DraftActions from './DraftActions'
import { NoticeBox } from './Notice'

// Fragt die Windows-Firewall nach dem Einschalten, soll nur das Heimnetz frei werden, nie ein öffentliches WLAN. Die
// Frage kommt erst nach dem Neustart, wenn die Karte schon die Adressen zeigt; deshalb steht der Satz auch dort.
const PRIVATE_ONLY = 'Wenn Windows fragt, lassen Sie nur „Private Netzwerke“ zu.'

export default function NetworkCard({ bridge }: { bridge: NetworkBridge }) {
  const [saved, setSaved] = useState<NetworkState | null>(null)
  const [loadError, setLoadError] = useState('')
  useEffect(() => {
    bridge.get().then(setSaved, (e: unknown) => setLoadError(errorText(e)))
  }, [bridge])
  const draft = useDraft(saved?.enabled ?? false)
  const view = saved && networkView(saved, draft.value)
  // Anmeldung (#528): ohne Passwort fragt die Karte beim Einschalten danach
  const [access, setAccess] = useState<NetworkAccess | null>(null)
  const loadAccess = () => api<NetworkAccess>('/api/auth').then((a) => {
    const next = typeof a?.mode === 'string' ? a : null
    setAccess(next)
    return next
  }, () => {
    setAccess(null)
    return null
  })
  useEffect(() => {
    void loadAccess()
  }, [])
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [withoutPassword, setWithoutPassword] = useState(false)
  const asking = saved !== null && askForPassword(access, saved, draft.value)
  // Die Felder gehören zum Entwurf (Durchsicht PR 4): Endet die Frage (Verwerfen, Abhaken, gespeichert), sind sie leer
  useEffect(() => {
    if (asking) return
    setPassword('')
    setRepeat('')
    setWithoutPassword(false)
  }, [asking])
  const confirm = useConfirm()
  // Welcher Satz zum Passwort: mit Passwort, beim Festlegen oder ohne (bisherige Warnung, auch bei unbekanntem Stand)
  const sentence = access?.mode === 'password' ? 'set' : asking && !withoutPassword ? 'choose' : 'open'
  // Der Sprung aus der Seitenleiste („Im Heimnetz erreichbar“, NetworkHint.tsx) holt die Karte ins Bild
  const card = useRef<HTMLElement>(null)
  useEffect(() => onNetworkCardRequest(() => card.current?.scrollIntoView({ block: 'start' })), [])

  // Inzwischen anderswo ein Passwort festgelegt (409): den Stand neu lesen und ohne Einrichtung umschalten
  async function setUp(body: Record<string, unknown>): Promise<void> {
    try {
      await api('/api/auth/setup', { method: 'POST', body: JSON.stringify(body) })
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 409) || (await loadAccess())?.mode !== 'password') throw e
    }
  }

  // Mit einem Mietfuchs im Heimnetz verbunden gibt es hier nichts einzustellen (#528, Karte RemoteCard)
  if (saved?.remote) return null
  return (
    <Card title="Zugriff aus dem Heimnetz" ref={card}>
      <p className="muted">Öffnen Sie Mietfuchs auch auf dem Handy, Tablet oder einem anderen Rechner im selben WLAN.</p>
      {loadError && <NoticeBox level="error" action={`Der Stand ließ sich nicht abfragen: ${loadError}`} />}
      {view && (
        <>
          <label className="checkline">
            <input type="checkbox" checked={draft.value} disabled={draft.saving} onChange={(e) => draft.set(e.target.checked)} />
            Zugriff aus dem Heimnetz erlauben
          </label>
          {sentence === 'open' && (
            <p className="muted">
              Ohne Passwort kann jeder in Ihrem Heimnetz Ihre Daten öffnen und ändern, solange der Zugriff erlaubt ist.
              Erlauben Sie ihn nur in einem Netz, dem Sie vertrauen, nicht in einem öffentlichen WLAN.
            </p>
          )}
          {sentence === 'choose' && (
            <p className="muted">
              Andere Geräte brauchen das Passwort, das Sie hier festlegen. Erlauben Sie den Zugriff nur in einem Netz,
              dem Sie vertrauen, nicht in einem öffentlichen WLAN.
            </p>
          )}
          {sentence === 'set' && (
            <p className="muted">
              Andere Geräte brauchen Ihr Passwort für Mietfuchs. Erlauben Sie den Zugriff nur in einem Netz, dem Sie
              vertrauen, nicht in einem öffentlichen WLAN.
            </p>
          )}
          {asking && access && (
            <>
              {!withoutPassword && (
                <>
                  <label className="field">
                    <span>Passwort für andere Geräte</span>
                    <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                  </label>
                  <label className="field">
                    <span>Passwort wiederholen</span>
                    <input type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
                  </label>
                  <p className="muted">Mindestens {countOf(access.minLength, 'Zeichen', 'Zeichen')}. Ein Satz aus drei, vier Wörtern lässt sich gut merken.</p>
                </>
              )}
              <label className="checkline">
                <input type="checkbox" checked={withoutPassword} onChange={(e) => setWithoutPassword(e.target.checked)} />
                Ohne Passwort
              </label>
            </>
          )}
          {view.addresses && (
            <>
              <p className="mb-1">Auf dem Handy im Browser öffnen:</p>
              <ul className="mt-0">
                {view.addresses.map((a) => <li key={a}><code className="break-all">{a}</code></li>)}
              </ul>
              <p className="muted mb-1">{PRIVATE_ONLY}</p>
              <p className="muted">
                Öffnet sich die Adresse nicht, prüfen Sie, ob Handy und Rechner im selben WLAN sind und ob
                Windows dieses WLAN als privates Netzwerk führt (Einstellungen → Netzwerk und Internet → WLAN → Ihr Netz →
                Netzwerkprofiltyp „Privates Netzwerk“).
              </p>
            </>
          )}
          {view.noAddress && <p className="muted">Dieser Rechner ist gerade mit keinem Netzwerk verbunden.</p>}
          {view.restart && !draft.saving && (
            <p className="muted">
              Beim Speichern startet Mietfuchs neu und lädt die Seite neu.
              {view.firewall && ` ${PRIVATE_ONLY}`}
            </p>
          )}
          {draft.saving && <p role="status"><span className="spinner" />Mietfuchs startet neu …</p>}
          <DraftActions
            draft={draft}
            layout="card"
            what="Zugriff aus dem Heimnetz"
            onSave={async (enabled) => {
              if (enabled && asking && access) {
                if (withoutPassword) {
                  const ok = await confirm({
                    title: 'Ohne Passwort im Heimnetz?',
                    message: 'Dann kann jedes Gerät in Ihrem Heimnetz Ihre Daten öffnen und ändern. Ein Passwort legen Sie später in den Einstellungen unter „Anmeldung“ fest.',
                    confirmLabel: 'Ohne Passwort erlauben',
                    danger: true,
                  })
                  if (!ok) return keepDraft
                  await setUp({ withoutPassword: true })
                } else {
                  const problem = passwordEntryProblem(password, repeat, access.minLength)
                  if (problem) throw new Error(problem)
                  await setUp({ password })
                }
                setPassword('')
                setRepeat('')
                setAccess({ ...access, mode: withoutPassword ? 'off' : 'password' })
              }
              const next = await bridge.set(enabled)
              setSaved(next)
              // Der Hinweis in der Seitenleiste folgt, auch bevor das Fenster die Seite neu lädt
              announceNetwork(next)
            }}
          />
        </>
      )}
    </Card>
  )
}

// Karte „Mietfuchs im Heimnetz“ in den Einstellungen (#528, Schritt 2), nur im Programmfenster. Lokal: Adresse und
// Code des anderen Mietfuchs eingeben, „Verbinden“ koppelt, danach lädt das Fenster dessen Seite. Verbunden: der
// Stand und der Weg zurück. Was die Karte entscheidet, steht in desktopRemote.ts, die Sätze bei Fehlern liefert die
// Brücke (desktop/src/pairing.js).
import { useEffect, useState } from 'react'
import { connectedLine, DISCONNECT_TEXT, problemField, remoteErrorText, type RemoteBridge, type RemoteField, type RemoteState } from '../desktopRemote'
import { useConfirm } from './feedback'
import Card from './Card'
import { ErrorSummary, useFormError } from './ErrorSummary'
import Field from './Field'
import { NoticeBox } from './Notice'

export default function RemoteCard({ bridge }: { bridge: RemoteBridge }) {
  const [state, setState] = useState<RemoteState | null>(null)
  const [loadError, setLoadError] = useState('')
  useEffect(() => {
    bridge.get().then(setState, (e: unknown) => setLoadError(remoteErrorText(e)))
  }, [bridge])
  const [address, setAddress] = useState('')
  const [code, setCode] = useState('')
  // Während des Koppelns und danach, bis das Fenster die Seite des anderen Mietfuchs lädt
  const [busy, setBusy] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const errors = useFormError<RemoteField>()
  const confirm = useConfirm()

  async function connect() {
    if (busy) return
    errors.clear()
    setBusy(true)
    try {
      const result = await bridge.connect({ address, code })
      if ('problem' in result) {
        errors.show(result.problem, problemField(result.problem, result.field) ?? undefined)
        setBusy(false)
        return
      }
    } catch (e) {
      errors.show(remoteErrorText(e))
      setBusy(false)
      return
    }
    // Erfolg: die Karte zeigt den neuen Stand (das Fenster lädt die Seite des anderen Mietfuchs). Lässt er sich nicht
    // lesen, ist das ein Fehler beim Laden, nicht beim Verbinden: Gekoppelt ist das Fenster schon.
    try {
      setState(await bridge.get())
    } catch (e) {
      setState({ connected: true })
      setLoadError(remoteErrorText(e))
    }
    setBusy(false)
  }

  async function disconnect() {
    const ok = await confirm({
      title: 'Verbindung trennen?',
      message: DISCONNECT_TEXT,
      confirmLabel: 'Trennen',
      danger: true,
    })
    if (!ok) return
    setLoadError('')
    setDisconnecting(true)
    try {
      await bridge.disconnect()
    } catch (e) {
      setLoadError(remoteErrorText(e))
    }
    setDisconnecting(false)
  }

  // Bis der Stand bekannt ist, zeigt die Karte nichts (sonst blitzt der falsche Stand auf)
  if (!state && !loadError) return null
  const label = busy ? 'Verbinde …' : 'Verbinden'
  return (
    <Card title="Mietfuchs im Heimnetz">
      {loadError && <NoticeBox level="error" action={`Das ließ sich nicht erledigen: ${loadError}`} />}
      {state?.connected ? (
        <>
          <p role="status">{connectedLine(state)}</p>
          {disconnecting && <p role="status"><span className="spinner" />Wird getrennt …</p>}
          <p>
            <button type="button" className="btn ghost danger-ghost" disabled={disconnecting} onClick={() => void disconnect()}>Verbindung trennen …</button>
          </p>
        </>
      ) : state && (
        <form noValidate onSubmit={(e) => { e.preventDefault(); void connect() }}>
          <p className="muted">
            Statt der Daten auf diesem Rechner zeigt das Fenster einen Mietfuchs, der im Heimnetz läuft, etwa auf einem
            NAS. Den Code nennt der andere Mietfuchs unter Einstellungen → Anmeldung → Programmfenster koppeln.
          </p>
          <ErrorSummary errors={errors} />
          <Field label="Adresse" width="m" hint="etwa nas:3001 oder 192.168.1.5:3001" {...errors.field('address')}>
            <input autoCapitalize="none" spellCheck={false} value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
          <Field label="Code" width="m" {...errors.field('code')}>
            <input autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <button type="submit" className="btn" disabled={busy}>{label}</button>
        </form>
      )}
    </Card>
  )
}

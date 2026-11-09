// Abschnitt „Programmfenster koppeln“ in der Karte „Anmeldung“ (#528, Schritt 2): ein Code, den das Programmfenster auf
// einem anderen Rechner eintippt, und die Liste der gekoppelten Fenster. Entscheidungen in pairingView.ts.
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, errorText } from '../api'
import type { AccessInfo } from '../access'
import { addressOf, CODE_EXPIRED, deviceLine, expiresText, LOAD_FAILED, pairingNote, REMOVE_CURRENT_TEXT, REMOVE_TEXT, type PairingDevice } from '../pairingView'
import { useConfirm, useToast } from './feedback'

type Code = { code: string; expiresAt: string }

export default function PairingSection({ info }: { info: AccessInfo }) {
  const note = pairingNote(info)
  const confirm = useConfirm()
  const toast = useToast()
  const [code, setCode] = useState<Code | null>(null)
  const [list, setList] = useState<PairingDevice[]>([])
  const [busy, setBusy] = useState(false)
  const [expired, setExpired] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const shown = note.kind === 'section'

  const load = useCallback(async () => {
    try {
      const r = await api<{ devices: PairingDevice[] }>('/api/auth/devices')
      setList(Array.isArray(r.devices) ? r.devices : [])
      setLoadFailed(false)
    } catch {
      setLoadFailed(true)
    }
  }, [])
  useEffect(() => { if (shown) void load() }, [shown, load])
  const loadRef = useRef(load)
  loadRef.current = load

  // Läuft der Code ab, verschwindet er; ein Fenster, das gerade gekoppelt hat, steht dann in der Liste
  const expiresAt = code?.expiresAt
  useEffect(() => {
    if (!expiresAt) return
    const timer = setTimeout(() => { setCode(null); setExpired(true); void loadRef.current() }, Math.max(0, new Date(expiresAt).getTime() - Date.now()))
    return () => clearTimeout(timer)
  }, [expiresAt])

  if (note.kind === 'hidden') return null
  if (note.kind === 'note') return <p className="muted">{note.text}</p>

  async function show() {
    setBusy(true)
    try {
      setCode(await api<Code>('/api/auth/pairing', { method: 'POST' }))
      setExpired(false)
      void load()
    } catch (e) {
      toast(errorText(e), 'error')
    }
    setBusy(false)
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast('Code kopiert.')
    } catch {
      toast('Kopieren ging nicht. Bitte den Code von Hand markieren.', 'error')
    }
  }
  async function remove(d: PairingDevice) {
    const ok = await confirm({ title: `„${d.name}“ entfernen?`, message: d.current ? REMOVE_CURRENT_TEXT : REMOVE_TEXT, confirmLabel: 'Entfernen', danger: true })
    if (!ok) return
    try {
      await api(`/api/auth/devices/${encodeURIComponent(d.id)}`, { method: 'DELETE' })
      toast('Das Programmfenster ist entfernt.')
    } catch (e) {
      toast(errorText(e), 'error')
    }
    await load()
  }

  const address = addressOf(window.location.host, window.location.hostname)
  const again = code !== null || expired
  return (
    <section className="stack border-t pt-4" aria-labelledby="pairing-title">
      <h3 id="pairing-title">Programmfenster koppeln</h3>
      <p>Ein Programmfenster auf einem anderen Rechner kann sich mit diesem Mietfuchs verbinden, ohne dass Sie dort das Passwort eintippen.</p>
      <div className="row">
        <button type="button" className="btn secondary" disabled={busy} onClick={() => void show()}>{again ? 'Neuen Code anzeigen' : 'Code anzeigen'}</button>
      </div>
      {expired && !code && <p className="muted" role="status">{CODE_EXPIRED}</p>}
      {code && (
        <div className="stack" role="status" aria-label="Kopplungscode">
          <div className="row">
            <strong className="font-mono text-2xl tracking-widest select-all">{code.code}</strong>
            <button type="button" className="btn ghost" aria-label="Kopplungscode kopieren" onClick={() => void copy(code.code)}>Kopieren</button>
          </div>
          <p className="muted">{expiresText(code.expiresAt, new Date())}</p>
          <p>Öffnen Sie im Programmfenster auf dem anderen Rechner Einstellungen → Mietfuchs im Heimnetz, und tragen Sie Adresse und Code ein. {address ? <>Die Adresse ist <code>{address}</code>.</> : 'Die Adresse ist die, unter der Sie Mietfuchs hier im Heimnetz erreichen.'}</p>
        </div>
      )}
      {loadFailed && <p className="muted">{LOAD_FAILED}</p>}
      {list.length > 0 && (
        <ul className="stack">
          {list.map((d) => (
            <li key={d.id} className="row">
              <span>
                <strong>{d.name}</strong>{d.current && <> (dieses Gerät)</>}
                <br /><span className="muted">{deviceLine(d)}</span>
              </span>
              <button type="button" className="btn ghost danger-ghost ml-auto" onClick={() => void remove(d)}>Entfernen …</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

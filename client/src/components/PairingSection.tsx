// Abschnitt „Programmfenster koppeln“ in der Karte „Anmeldung“ (#528, Schritt 2): ein Code, den das Programmfenster auf
// einem anderen Rechner eintippt, und die Liste der gekoppelten Fenster. Entscheidungen in pairingView.ts.
import { useCallback, useEffect, useState } from 'react'
import { api, errorText } from '../api'
import type { AccessInfo } from '../access'
import { deviceLine, expiresText, pairingNote, type PairingDevice } from '../pairingView'
import { useConfirm, useToast } from './feedback'

type Code = { code: string; expiresAt: string }

export default function PairingSection({ info }: { info: AccessInfo }) {
  const note = pairingNote(info)
  const confirm = useConfirm()
  const toast = useToast()
  const [code, setCode] = useState<Code | null>(null)
  const [list, setList] = useState<PairingDevice[]>([])
  const [busy, setBusy] = useState(false)
  const shown = note.kind === 'section'

  const load = useCallback(async () => {
    try {
      const r = await api<{ devices: PairingDevice[] }>('/api/auth/devices')
      setList(Array.isArray(r.devices) ? r.devices : [])
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }, [toast])
  useEffect(() => { if (shown) void load() }, [shown, load])

  if (note.kind === 'hidden') return null
  if (note.kind === 'note') return <p className="muted">{note.text}</p>

  async function show() {
    setBusy(true)
    try {
      setCode(await api<Code>('/api/auth/pairing', { method: 'POST' }))
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
    const ok = await confirm({ title: `„${d.name}“ entfernen?`, message: 'Dieses Programmfenster ist danach abgemeldet und muss neu gekoppelt werden.', confirmLabel: 'Entfernen', danger: true })
    if (!ok) return
    try {
      await api(`/api/auth/devices/${encodeURIComponent(d.id)}`, { method: 'DELETE' })
      toast('Das Programmfenster ist entfernt.')
    } catch (e) {
      toast(errorText(e), 'error')
    }
    await load()
  }

  return (
    <section className="stack" aria-labelledby="pairing-title">
      <h3 id="pairing-title">Programmfenster koppeln</h3>
      <p>Ein Programmfenster auf einem anderen Rechner kann sich mit diesem Mietfuchs verbinden, ohne dass Sie dort das Passwort eintippen.</p>
      <div className="row">
        <button type="button" className="btn secondary" disabled={busy} onClick={() => void show()}>Code anzeigen</button>
      </div>
      {code && (
        <div className="stack" role="group" aria-label="Kopplungscode">
          <div className="row">
            <strong className="font-mono text-2xl tracking-widest select-all">{code.code}</strong>
            <button type="button" className="btn ghost" onClick={() => void copy(code.code)}>Kopieren</button>
          </div>
          <p className="muted">{expiresText(code.expiresAt, new Date())}</p>
          <p>Öffnen Sie im Programmfenster auf dem anderen Rechner Einstellungen → Mietfuchs im Heimnetz, und tragen Sie Adresse und Code ein. Die Adresse ist die, unter der Sie Mietfuchs hier im Heimnetz erreichen.</p>
        </div>
      )}
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

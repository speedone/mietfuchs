import { useState } from 'react'
import type { Settings } from '../types'
import { api } from '../api'

type Props = { settings: Settings; reload: () => Promise<void> }

export default function Einstellungen({ settings, reload }: Props) {
  const [form, setForm] = useState({
    ollamaUrl: settings.ollamaUrl,
    ollamaModel: settings.ollamaModel,
    landlordName: settings.landlordName ?? '',
    iban: settings.iban ?? '',
    paymentDeadlineDays: String(settings.paymentDeadlineDays ?? 30),
  })
  const [saved, setSaved] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; models?: string[]; error?: string } | null>(null)
  const [testing, setTesting] = useState(false)

  async function save() {
    await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        ...form,
        paymentDeadlineDays: Math.max(1, Number(form.paymentDeadlineDays) || 30),
      }),
    })
    await reload()
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  async function test() {
    setTesting(true)
    setStatus(null)
    try {
      await save()
      setStatus(await api<{ ok: boolean; models?: string[]; error?: string }>('/api/ollama/status'))
    } finally {
      setTesting(false)
    }
  }

  return (
    <>
      <h1>Einstellungen</h1>
      <p className="sub">Vermieterdaten für das Anschreiben und KI-Belegauswertung über Ollama.</p>

      <div className="card">
        <h2>Vermieter &amp; Zahlung</h2>
        <p className="muted">Erscheint im Kopf und in der Zahlungsaufforderung der gedruckten Abrechnung.</p>
        <div className="row">
          <label className="field grow">
            Name des Vermieters
            <input value={form.landlordName} onChange={(e) => setForm({ ...form, landlordName: e.target.value })} placeholder="Vor- und Nachname" />
          </label>
          <label className="field grow">
            IBAN für Nachzahlungen
            <input value={form.iban} onChange={(e) => setForm({ ...form, iban: e.target.value })} placeholder="DE.." />
          </label>
          <label className="field">
            Zahlungsfrist (Tage)
            <input value={form.paymentDeadlineDays} onChange={(e) => setForm({ ...form, paymentDeadlineDays: e.target.value })} style={{ width: 90 }} />
          </label>
          <button className="btn" onClick={save}>Speichern</button>
        </div>
        {saved && <div className="ok">Gespeichert.</div>}
      </div>

      <div className="card">
        <h2>Ollama</h2>
        <div className="row">
          <label className="field grow">
            Server-URL
            <input value={form.ollamaUrl} onChange={(e) => setForm({ ...form, ollamaUrl: e.target.value })} placeholder="http://localhost:11434" />
          </label>
          <label className="field grow">
            Modell
            <input value={form.ollamaModel} onChange={(e) => setForm({ ...form, ollamaModel: e.target.value })} placeholder="z. B. qwen3.6-35b" />
          </label>
          <button className="btn" onClick={save}>Speichern</button>
          <button className="btn secondary" onClick={test} disabled={testing}>
            {testing && <span className="spinner" />}Verbindung testen
          </button>
        </div>
        {saved && <div className="ok">Gespeichert.</div>}
        {status?.ok && (
          <div className="ok">
            Ollama erreichbar. Installierte Modelle: {status.models?.join(', ') || 'keine'}
            {status.models && !status.models.some((m) => m.startsWith(form.ollamaModel)) && (
              <> — <strong>Achtung:</strong> „{form.ollamaModel}" ist nicht darunter. Mit <code>ollama pull {form.ollamaModel}</code> laden.</>
            )}
          </div>
        )}
        {status && !status.ok && (
          <div className="error">
            Ollama nicht erreichbar: {status.error}. Läuft die Ollama-App? (Standard-Port 11434)
          </div>
        )}
        <p className="muted">
          Für PDF-Rechnungen mit Textebene reicht ein reines Sprachmodell. Für fotografierte
          Belege wird ein Vision-fähiges Modell benötigt (z. B. ein qwen-VL-Modell).
        </p>
      </div>

      <div className="card">
        <h2>Daten &amp; Sicherung</h2>
        <p className="muted">
          Alle Daten liegen in <code>server/data/db.json</code>, hochgeladene Belege in{' '}
          <code>server/data/uploads/</code>. Für ein Backup genügt es, den Ordner{' '}
          <code>server/data</code> zu kopieren. Es werden keine Daten an externe Dienste übertragen.
        </p>
      </div>
    </>
  )
}

import { useState } from 'react'
import type { Settings } from '../types'
import { api } from '../api'
import PageHeader from '../components/PageHeader'
import { useToast, useConfirm } from '../components/feedback'

type Props = { settings: Settings; reload: () => Promise<void> }

export default function Einstellungen({ settings, reload }: Props) {
  const toast = useToast()
  const confirm = useConfirm()
  const [form, setForm] = useState({
    ollamaUrl: settings.ollamaUrl,
    ollamaModel: settings.ollamaModel,
    landlordName: settings.landlordName ?? '',
    iban: settings.iban ?? '',
    paymentDeadlineDays: String(settings.paymentDeadlineDays ?? 30),
  })
  const [status, setStatus] = useState<{ ok: boolean; models?: string[]; error?: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [restoreMsg, setRestoreMsg] = useState('')

  async function restore(file: File) {
    const ok = await confirm({
      title: `Backup „${file.name}" wiederherstellen?`,
      message: 'Alle aktuellen Daten werden durch den Stand aus dem Backup ersetzt.',
      confirmLabel: 'Wiederherstellen',
      danger: true,
    })
    if (!ok) return
    setRestoring(true)
    setRestoreMsg('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      await api('/api/restore', { method: 'POST', body: fd })
      setRestoreMsg('Backup wiederhergestellt — die Seite wird neu geladen …')
      setTimeout(() => window.location.reload(), 1200)
    } catch (e) {
      setRestoreMsg(`Fehler: ${String((e as Error).message)}`)
      setRestoring(false)
    }
  }

  async function save() {
    await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        ...form,
        paymentDeadlineDays: Math.max(1, Number(form.paymentDeadlineDays) || 30),
      }),
    })
    await reload()
    toast('Einstellungen gespeichert.')
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
      <PageHeader title="Einstellungen" subtitle="Vermieterdaten für das Anschreiben und KI-Belegauswertung über Ollama." />

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
          Alle Daten (Stammdaten, Kosten, Zähler, Belege) bleiben lokal auf diesem Rechner.
          Ein Backup enthält die komplette Datenbank samt aller hochgeladenen Belege als ZIP-Datei.
        </p>
        <div className="row">
          <a className="btn secondary" href="/api/backup" download>⬇ Backup herunterladen (ZIP)</a>
          <label className="btn secondary" style={{ cursor: 'pointer' }}>
            {restoring && <span className="spinner" />}⬆ Backup wiederherstellen …
            <input
              type="file"
              accept=".zip,application/zip"
              style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void restore(f) }}
            />
          </label>
        </div>
        {restoreMsg && <div className={restoreMsg.startsWith('Fehler') ? 'error' : 'ok'}>{restoreMsg}</div>}
        <p className="muted" style={{ marginTop: 10 }}>
          Beim Wiederherstellen werden die aktuellen Daten <strong>überschrieben</strong> (eine
          Sicherheitskopie des vorherigen Stands bleibt als <code>db.json.vor-restore</code> erhalten).
        </p>
      </div>
    </>
  )
}

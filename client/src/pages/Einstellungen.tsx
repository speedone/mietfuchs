import { useState } from 'react'
import type { Settings } from '../types'
import { api, errorText } from '../api'
import PageHeader from '../components/PageHeader'
import { useToast, useConfirm } from '../components/feedback'
import { UpdateSettings, type UpdateState } from '../components/Update'
import { AiSettings } from '../components/AiSettings'
import { useOpenForm, useProperty } from '../property'

type Props = { settings: Settings; reload: () => Promise<void>; update: UpdateState }

export default function Einstellungen({ settings, reload, update }: Props) {
  const { properties } = useProperty()
  const toast = useToast()
  const confirm = useConfirm()
  const [form, setForm] = useState({
    landlordName: settings.landlordName ?? '',
    iban: settings.iban ?? '',
    paymentDeadlineDays: String(settings.paymentDeadlineDays ?? 30),
  })
  // Ungespeicherte Vermieterdaten: Ein Objektwechsel stellt die Seiten neu auf und fragt deshalb
  // vorher (#145).
  useOpenForm(
    form.landlordName !== (settings.landlordName ?? '') ||
      form.iban !== (settings.iban ?? '') ||
      form.paymentDeadlineDays !== String(settings.paymentDeadlineDays ?? 30),
  )
  const [restoring, setRestoring] = useState(false)
  const [restoreMsg, setRestoreMsg] = useState('')
  const [saveError, setSaveError] = useState('')

  async function restore(file: File) {
    const ok = await confirm({
      title: `Backup „${file.name}“ wiederherstellen?`,
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
      const antwort = await api<{ notes?: string[] }>('/api/restore', { method: 'POST', body: fd })
      // Hinweise gibt es selten, aber wenn, dann gehören sie gelesen: etwa dass die Daten zwar
      // zurück sind, die Datenbank sich dabei aber nicht erneuern ließ. Dann wird bewusst nicht
      // von selbst neu geladen, denn das Neuladen nähme die Meldung gleich wieder weg.
      const hinweise = antwort?.notes ?? []
      if (hinweise.length > 0) {
        setRestoreMsg(`Backup wiederhergestellt. ${hinweise.join(' ')}`)
        setRestoring(false)
        return
      }
      setRestoreMsg('Backup wiederhergestellt — die Seite wird neu geladen …')
      setTimeout(() => window.location.reload(), 1200)
    } catch (e) {
      setRestoreMsg(`Fehler: ${String((e as Error).message)}`)
      setRestoring(false)
    }
  }

  async function save() {
    // Lehnt der Server ab (#146), steht sein Satz unter den Feldern.
    try {
      await api('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          ...form,
          paymentDeadlineDays: Math.max(1, Number(form.paymentDeadlineDays) || 30),
        }),
      })
    } catch (e) {
      setSaveError(errorText(e))
      return
    }
    setSaveError('')
    await reload()
    toast('Einstellungen gespeichert.')
  }

  return (
    <>
      <PageHeader title="Einstellungen" subtitle="Vermieterdaten für das Anschreiben, KI-Belegauswertung und Updates." />

      <div className="card">
        <h2>Vermieter &amp; Zahlung</h2>
        <p className="muted">
          Erscheint im Kopf und in der Zahlungsaufforderung der gedruckten Abrechnung.
          {properties.length > 1 && ' Die Angaben gelten als Vorgabe für alle Objekte; in den Stammdaten kann ein Objekt abweichen.'}
        </p>
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
            <input value={form.paymentDeadlineDays} onChange={(e) => setForm({ ...form, paymentDeadlineDays: e.target.value })} className="input-xs" />
          </label>
        </div>
        {/* Sichtprüfung E52: Speichern steht unter den Feldern wie in den anderen Karten */}
        <div className="row">
          <button className="btn" onClick={save}>Speichern</button>
        </div>
        {saveError && <div className="error">{saveError}</div>}
      </div>

      <AiSettings settings={settings} reload={reload} />

      <UpdateSettings settings={settings} update={update} reload={reload} />

      <div className="card">
        <h2>Daten &amp; Sicherung</h2>
        <p className="muted">
          Alle Daten (Stammdaten, Kosten, Zähler, Belege) bleiben lokal auf diesem Rechner.
          Ein Backup enthält die komplette Datenbank samt aller hochgeladenen Belege als ZIP-Datei.
        </p>
        <div className="row">
          <a className="btn secondary" href="/api/backup" download>⬇ Backup herunterladen (ZIP)</a>
          <label className="btn secondary">
            {restoring && <span className="spinner" />}⬆ Backup wiederherstellen …
            <input
              type="file"
              accept=".zip,application/zip"
              hidden
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void restore(f) }}
            />
          </label>
        </div>
        {restoreMsg && <div className={restoreMsg.startsWith('Fehler') ? 'error' : 'ok'}>{restoreMsg}</div>}
        <p className="muted">
          Beim Wiederherstellen werden die aktuellen Daten <strong>überschrieben</strong> (eine
          Sicherheitskopie des vorherigen Stands bleibt als{' '}
          <code>mietfuchs.sqlite.vor-restore</code> im Datenordner erhalten).
        </p>
      </div>
    </>
  )
}

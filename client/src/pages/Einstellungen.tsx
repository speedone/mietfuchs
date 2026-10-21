import { useState } from 'react'
import type { Settings } from '../types'
import { api, errorText } from '../api'
import PageHeader from '../components/PageHeader'
import { useToast, useConfirm } from '../components/feedback'
import { UpdateSettings, type UpdateState } from '../components/Update'
import { AiSettings } from '../components/AiSettings'
import LawOverridesCard from '../components/LawOverridesCard'
import { useOpenForm, useProperty } from '../property'
import IbanInput from '../components/IbanInput'
import { ErrorSummary, useFormError } from '../components/ErrorSummary'
import { ibanChanged, ibanForSave, ibanToInput } from '../ibanField'
import { IBAN_LABELS } from '../../../shared/iban.ts'
import Card from '../components/Card'

type Props = { settings: Settings; reload: () => Promise<void>; update: UpdateState }

export default function Einstellungen({ settings, reload, update }: Props) {
  const { properties } = useProperty()
  const toast = useToast()
  const confirm = useConfirm()
  const [form, setForm] = useState({
    landlordName: settings.landlordName ?? '',
    iban: ibanToInput(settings.iban),
    paymentDeadlineDays: String(settings.paymentDeadlineDays ?? 30),
  })
  // Ungespeicherte Vermieterdaten: Ein Objektwechsel stellt die Seiten neu auf und fragt deshalb
  // vorher (#145).
  useOpenForm(
    form.landlordName !== (settings.landlordName ?? '') ||
      ibanChanged(form.iban, settings.iban) ||
      form.paymentDeadlineDays !== String(settings.paymentDeadlineDays ?? 30),
  )
  const [restoring, setRestoring] = useState(false)
  const [restoreMsg, setRestoreMsg] = useState('')
  // Die Fehler der Karte „Vermieter & Zahlung“, oben in der Karte (#346, Schritt 3)
  const saveErrors = useFormError<'iban'>()

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
    // Eine neue ungültige IBAN wird nicht gespeichert (#279); eine gespeicherte ungültige geht
    // unverändert mit, damit die übrigen Angaben trotzdem gespeichert werden.
    const iban = ibanForSave(form.iban, settings.iban, IBAN_LABELS.settings)
    if ('error' in iban) {
      saveErrors.report([{ field: 'iban', short: 'IBAN ungültig', text: iban.error }])
      return
    }
    // Lehnt der Server ab (#146), steht sein Satz unter den Feldern.
    try {
      await api('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          ...form,
          iban: iban.value,
          paymentDeadlineDays: Math.max(1, Number(form.paymentDeadlineDays) || 30),
        }),
      })
    } catch (e) {
      saveErrors.show(errorText(e))
      return
    }
    saveErrors.clear()
    await reload()
    toast('Einstellungen gespeichert.')
  }

  return (
    <>
      <PageHeader context="none" title="Einstellungen" subtitle="Vermieterdaten für das Anschreiben, KI-Belegauswertung und Updates." />

      <Card title={<>Vermieter &amp; Zahlung</>}>
        <ErrorSummary errors={saveErrors} />
        <p className="muted">
          Erscheint im Kopf und in der Zahlungsaufforderung der gedruckten Abrechnung.
          {properties.length > 1 && ' Die Angaben gelten als Vorgabe für alle Objekte; in den Stammdaten kann ein Objekt abweichen.'}
        </p>
        <div className="row">
          <label className="field">
            Name des Vermieters
            <input value={form.landlordName} onChange={(e) => setForm({ ...form, landlordName: e.target.value })} placeholder="Vor- und Nachname" />
          </label>
          <IbanInput label="IBAN für Nachzahlungen" value={form.iban} stored={settings.iban} onChange={(iban) => setForm({ ...form, iban })} placeholder="DE.." {...saveErrors.field('iban')} />
          <label className="field">
            Zahlungsfrist (Tage)
            <input inputMode="numeric" value={form.paymentDeadlineDays} onChange={(e) => setForm({ ...form, paymentDeadlineDays: e.target.value })} />
          </label>
        </div>
        {/* Sichtprüfung E52: Speichern steht unter den Feldern wie in den anderen Karten */}
        <div className="row">
          <button className="btn" onClick={save}>Speichern</button>
        </div>
      </Card>

      <AiSettings settings={settings} reload={reload} />

      <UpdateSettings settings={settings} update={update} reload={reload} />

      <LawOverridesCard />

      <Card title={<>Daten &amp; Sicherung</>}>
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
              className="sr-only"
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
      </Card>
    </>
  )
}

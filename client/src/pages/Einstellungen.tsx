import { useEffect, useState } from 'react'
import { dataFolder, type HealthReport } from '../database'
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
import Field from '../components/Field'
import LetterTemplateCard from '../components/LetterTemplateCard'
import LetterDesignCard from '../components/LetterDesignCard'

// `onNavigate`: Sprung auf eine andere Seite (der Link auf den Verlauf, #318).
type Props = { settings: Settings; reload: () => Promise<void>; update: UpdateState; onNavigate?: (tab: 'verlauf') => void }

export default function Einstellungen({ settings, reload, update, onNavigate }: Props) {
  const { properties } = useProperty()
  const toast = useToast()
  const confirm = useConfirm()
  const [form, setForm] = useState({
    landlordName: settings.landlordName ?? '',
    iban: ibanToInput(settings.iban),
    paymentDeadlineDays: String(settings.paymentDeadlineDays ?? 30),
    // Teil 2 von #415: Rücksendeangabe und Fußzeile des Briefs
    landlordAddress: settings.landlordAddress ?? '',
    landlordContact: settings.landlordContact ?? '',
  })
  // Ungespeicherte Vermieterdaten: Ein Objektwechsel stellt die Seiten neu auf und fragt deshalb
  // vorher (#145).
  useOpenForm(
    form.landlordName !== (settings.landlordName ?? '') ||
      ibanChanged(form.iban, settings.iban) ||
      form.paymentDeadlineDays !== String(settings.paymentDeadlineDays ?? 30) ||
      form.landlordAddress !== (settings.landlordAddress ?? '') ||
      form.landlordContact !== (settings.landlordContact ?? ''),
  )
  // Wo die Daten liegen, aus dem Zustandsbericht des Servers; fehlt er, entfällt die Angabe.
  const [folder, setFolder] = useState<string | null>(null)
  useEffect(() => {
    api<HealthReport>('/healthz')
      .then((r) => setFolder(dataFolder(r?.database?.file)))
      .catch(() => {})
  }, [])
  // Ob das Backup den Verlauf der Änderungen mitnimmt (#318). Nur eine Wahl für den Download, nichts wird gespeichert.
  const [withJournal, setWithJournal] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [restoreMsg, setRestoreMsg] = useState('')
  // Die Fehler der Karte „Vermieter & Zahlung“, oben in der Karte (#346, Schritt 3)
  const saveErrors = useFormError<'iban'>()

  async function restore(file: File) {
    const ok = await confirm({
      title: `Backup „${file.name}“ wiederherstellen?`,
      message: 'Alle aktuellen Daten werden durch den Stand aus dem Backup ersetzt. ' +
        'Zustimmungen (Übermittlung an einen KI-Dienst, Abfrage nach Updates) bringt das Backup nicht mit: Es gelten die von jetzt, auf einem neuen Rechner also keine.',
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
        <div className="row">
          <Field label="Anschrift des Vermieters" width="l" hint="Für Rücksendeangabe, Briefkopf und Fußzeile des Briefs. Ohne Angabe nennt die Rücksendeangabe die Adresse des Objekts; Briefkopf und Fußzeile bleiben ohne Anschrift.">
            <input value={form.landlordAddress} onChange={(e) => setForm({ ...form, landlordAddress: e.target.value })} placeholder="Straße Nr., PLZ Ort" />
          </Field>
          <Field label="Kontakt" width="l" hint="Optional: Telefon oder E-Mail für die Fußzeile mit Kontakt und Bank.">
            <input value={form.landlordContact} onChange={(e) => setForm({ ...form, landlordContact: e.target.value })} placeholder="z. B. Tel. 0123 456789" />
          </Field>
        </div>
        {/* Sichtprüfung E52: Speichern steht unter den Feldern wie in den anderen Karten */}
        <div className="row">
          <button className="btn" onClick={save}>Speichern</button>
        </div>
      </Card>

      <LetterTemplateCard reload={reload} />
      <LetterDesignCard />

      <AiSettings settings={settings} reload={reload} />

      <UpdateSettings settings={settings} update={update} reload={reload} />

      <LawOverridesCard />

      <Card title={<>Daten &amp; Sicherung</>}>
        <p className="muted">
          {folder && <>Ihre Daten liegen im Datenordner von Mietfuchs: <code>{folder}</code>. </>}
          Belege gehen nur an einen externen KI-Dienst, und nur, wenn Sie dem zugestimmt haben; die Update-Prüfung fragt bei
          GitHub nach der neuesten Version, wenn sie eingeschaltet ist, und sendet dabei keine Daten.
          Sonst verlässt nichts den Rechner, auf dem Mietfuchs läuft.
          Ein Backup enthält die Datenbank samt aller hochgeladenen Belege, Logo und Briefpapier als ZIP-Datei;
          den Verlauf der Änderungen nur, wenn Sie es unten wählen.
        </p>
        <div className="row">
          <a className="btn secondary" href={withJournal ? '/api/backup?journal=1' : '/api/backup'} download>⬇ Backup herunterladen (ZIP)</a>
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
        <label className="checkline">
          <input type="checkbox" checked={withJournal} onChange={(e) => setWithJournal(e.target.checked)} />
          Verlauf der Änderungen mitsichern
        </label>
        <p className="muted">
          Der Verlauf (Seite „Verlauf“) enthält bis zu zwölf Monate lang auch gelöschte Angaben, etwa Name, Anschrift
          und IBAN früherer Mieter. Ohne dieses Häkchen bleibt er auf diesem Rechner; wählen Sie es nur, wenn das
          Backup den Verlauf mitnehmen soll, und geben Sie ein solches Backup nicht weiter. Die Sicherungen, die
          Mietfuchs vor einem Update und vor dem Einspielen eines Backups im Datenordner anlegt, enthalten den Verlauf
          ohne die Frist von zwölf Monaten. Ein Backup ohne Verlauf ersetzt beim Einspielen den Verlauf auf diesem
          Rechner; der bisherige steht dann nur noch in dieser Sicherung.
        </p>
        {restoreMsg && <div className={restoreMsg.startsWith('Fehler') ? 'error' : 'ok'}>{restoreMsg}</div>}
        <p className="muted">
          Beim Wiederherstellen werden die aktuellen Daten <strong>überschrieben</strong> (eine
          Sicherheitskopie des vorherigen Stands bleibt als{' '}
          <code>mietfuchs.sqlite.vor-restore</code> im Datenordner erhalten).
        </p>
      </Card>

      {/* Die automatischen Sicherungen stehen seit #318 in der Zeitachse des Verlaufs, mit dem Weg zurück. */}
      <p className="muted">
        Automatische Sicherungen und frühere Stände finden Sie{' '}
        <a href="#" onClick={(e) => { e.preventDefault(); onNavigate?.('verlauf') }}>im Verlauf</a>.
      </p>
    </>
  )
}

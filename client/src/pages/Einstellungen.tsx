import { inWindow, reloadWithArrival, type Arrival } from '../relocation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { dataFolder, type HealthReport } from '../database'
import type { BackupStatus, Settings } from '../types'
import { asBackupStatus, frameMessage, lastBackupLine, recheckUntilChanged } from '../backupView'
import { NoticeBox } from '../components/Notice'
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
import NetworkCard from '../components/NetworkCard'
import AccessCard from '../components/AccessCard'
import { networkBridge } from '../desktopNetwork'
import { remoteBridge } from '../desktopRemote'
import RemoteCard from '../components/RemoteCard'
import BrowserCard from '../components/BrowserCard'
import { useSectionJump, type FocusProps } from '../focus'
import { ifUnchanged, sameRecord } from '../staleRecord'
import { deadlineDays, LANDLORD_GROUPS, LANDLORD_KEYS, LANDLORD_LABELS, LANDLORD_STALE_FIELDS, mergeStale, sameLandlordInput, seenPart, settingsStaleText, staleCurrent, useFreshSettings, type LandlordKey } from '../settingsSeen'

const SOURCE_URL = 'https://github.com/speedone/mietfuchs'
const WEBSITE_URL = 'https://mietfuchs-app.de'
const LICENSE_URL = `${SOURCE_URL}/blob/main/LICENSE`

// `onNavigate`: Sprung auf eine andere Seite (der Link auf den Verlauf, #318).
// `onOpenRelocation`: „Daten aus bisherigem Mietfuchs übernehmen …“ (#517), nur im Programmfenster
// `focus`: die Karte, zu der ein Sprung führt (#554): Vermieter und IBAN, KI-Belegauswertung, Anleitung zum Update, Backup.
// `reloadPage`: das Neuladen nach dem Wiederherstellen, im Test hineingereicht.
type Props = { settings: Settings; reload: () => Promise<void>; update: UpdateState; onNavigate?: (tab: 'verlauf') => void; onOpenRelocation?: () => void; reloadPage?: (arrival: Arrival) => void } & FocusProps

// Der unsichtbare Rahmen, in den der Backup-Link lädt (siehe dort)
const BACKUP_FRAME = 'mietfuchs-backup'

const SETTINGS_SECTIONS = ['landlord', 'ai', 'about', 'access', 'backup'] as const
// Was die Karten dieser Seite aus den Einstellungen der App füllen (settingsSeen.ts, `useFreshSettings`).
const FRESH_KEYS = [...LANDLORD_KEYS, 'ai'] as const

// Das Formular der Karte „Vermieter & Zahlung“ aus den Einstellungen, wie der Server sie liefert (auch aus dem Stand von
// jetzt nach einer Ablehnung, deshalb lose getippt).
const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const landlordForm = (from: Record<string, unknown>) => ({
  landlordName: text(from.landlordName),
  iban: ibanToInput(text(from.iban)),
  paymentDeadlineDays: String(typeof from.paymentDeadlineDays === 'number' ? from.paymentDeadlineDays : 30),
  // Teil 2 von #415: Rücksendeangabe und Fußzeile des Briefs
  landlordAddress: text(from.landlordAddress),
  landlordContact: text(from.landlordContact),
})
type LandlordForm = ReturnType<typeof landlordForm>
const sameLandlordForm = (a: LandlordForm, b: LandlordForm): boolean => LANDLORD_KEYS.every((key) => sameLandlordInput(key, a[key], b[key]))
// Der Wert von dort, wie er am Feld und in der Entscheidung steht.
const shownValue = (key: LandlordKey, value: string): string => (value.trim() === '' ? 'leer' : key === 'iban' ? value : key === 'paymentDeadlineDays' ? `${deadlineDays(value)} Tage` : `„${value.trim()}“`)
// Nach einer Ablehnung: was hier und anderswo geändert wurde und noch zu entscheiden ist (`mergeStale`), je Einheit die
// Felder, dazu der Stand von dort (`now`), der gesehene davor (`before`) und was dort geändert wurde (`theirs`).
type Pending = { units: LandlordKey[][]; now: LandlordForm; before: LandlordForm; theirs: LandlordKey[] }

export default function Einstellungen({ settings, reload, update, onNavigate, onOpenRelocation, reloadPage = reloadWithArrival, focus, onFocusDone }: Props) {
  const jumpAt = useSectionJump(focus, SETTINGS_SECTIONS, true, onFocusDone)
  const { properties } = useProperty()
  const toast = useToast()
  const confirm = useConfirm()
  const [form, setForm] = useState(() => landlordForm({ ...settings }))
  // Der Stand, aus dem das Formular gefüllt wurde, als `ifUnchanged` beim Speichern (settingsSeen.ts): nur die Schlüssel
  // dieser Karte, wie der Server sie geliefert hat. Nach dem eigenen Speichern der Stand aus der Antwort.
  const seen = useRef(seenPart(settings, LANDLORD_KEYS))
  const [pending, setPending] = useState<Pending | null>(null)
  const pendingRef = useRef(pending)
  pendingRef.current = pending
  // Ein Tab im Hintergrund kennt einen alten Stand: Beim Öffnen fragt die Seite den von jetzt, und die App lädt neu,
  // wenn er abweicht. Liefert die App neuere Einstellungen, übernimmt die Karte sie, solange hier nichts geändert und
  // nichts zu entscheiden ist; sonst bleibt der alte Stand gesehen, und das Speichern wird abgelehnt.
  useFreshSettings(settings, FRESH_KEYS, reload)
  const formRef = useRef(form)
  formRef.current = form
  useEffect(() => {
    const now = seenPart(settings, LANDLORD_KEYS)
    if (sameRecord(now, seen.current) || pendingRef.current || !sameLandlordForm(formRef.current, landlordForm(seen.current))) return
    seen.current = now
    setForm(landlordForm(now))
  }, [settings])
  // Der Hinweis am Feld, solange über das Feld noch zu entscheiden ist.
  const conflictHint = (key: LandlordKey): string | undefined => {
    if (!pending || !pending.units.some((unit) => unit.includes(key))) return undefined
    const there = shownValue(key, pending.now[key])
    // Nur dort geändert (Durchsicht S1): Das Feld zeigt schon den Wert von dort, und der Hinweis sagt es.
    if (sameLandlordInput(key, form[key], pending.now[key])) return pending.theirs.includes(key) ? `Inzwischen anderswo geändert auf ${there}. Das steht jetzt hier.` : undefined
    if (!pending.theirs.includes(key)) return `Hier von Ihnen geändert. Anderswo steht ${there}.`
    const own = !sameLandlordInput(key, form[key], pending.before[key])
    return `Inzwischen anderswo geändert auf ${there}. Hier steht ${own ? 'Ihre Eingabe' : 'der Stand von vorher'}.`
  }
  const decide = (unit: LandlordKey[], theirs: boolean) => {
    if (!pending) return
    if (theirs) setForm((shown) => ({ ...shown, ...Object.fromEntries(unit.map((key) => [key, pending.now[key]])) }))
    const units = pending.units.filter((other) => other !== unit)
    setPending(units.length > 0 ? { ...pending, units } : null)
    saveErrors.clear()
  }
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
  // Wann zuletzt ein Backup heruntergeladen wurde. Der Download ist ein Link, kein Abruf; wann er fertig ist, erfährt die
  // Seite nicht. Deshalb fragt sie nach dem Klick in wachsendem Abstand nach, bis sich der Zeitpunkt ändert
  // (`recheckUntilChanged`, rund zwei Minuten), und immer, wenn das Fenster wieder den Fokus bekommt.
  const [backup, setBackup] = useState<BackupStatus | null>(null)
  // Die Ablehnung des Servers, wenn ein Backup scheitert (aus dem Rahmen gelesen)
  const [backupError, setBackupError] = useState('')
  const loadBackup = useCallback(() => {
    api<unknown>('/api/backup/status')
      .then((s) => setBackup(asBackupStatus(s)))
      .catch(() => {})
  }, [])
  // Je Klick eine Folge von Nachfragen; ein neuer Klick und das Verlassen der Seite beenden die laufende.
  const recheck = useRef(0)
  useEffect(() => {
    loadBackup()
    window.addEventListener('focus', loadBackup)
    return () => {
      window.removeEventListener('focus', loadBackup)
      recheck.current = -1
    }
  }, [loadBackup])
  function awaitDownload() {
    setBackupError('')
    const run = ++recheck.current
    void recheckUntilChanged(async () => asBackupStatus(await api<unknown>('/api/backup/status')), backup?.lastDownloadAt ?? null, { stopped: () => recheck.current !== run })
      .then((changed) => { if (changed && recheck.current === run) setBackup(changed) })
  }
  // Ob das Backup den Verlauf der Änderungen mitnimmt (#318). Nur eine Wahl für den Download, nichts wird gespeichert.
  const [withJournal, setWithJournal] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [restoreMsg, setRestoreMsg] = useState('')
  // Die Fehler der Karte „Vermieter & Zahlung“, oben in der Karte (#346, Schritt 3)
  const saveErrors = useFormError<'iban'>()
  // Nur im Programmfenster (#517): Im Browser und auf dem Handy fehlt die Brücke, und die Karte erscheint nicht.
  const [network] = useState(() => networkBridge())
  const [remote] = useState(() => remoteBridge())

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
      // Wie nach Umzug und neuerem Stand: neu laden, und danach steht einmal oben „Ihr Backup ist eingespielt“ mit dem,
      // was da ist (`reloadWithArrival`, Arrival.tsx). Vorher lud die Seite ins Cockpit, ohne ein Wort der Bestätigung.
      setRestoreMsg('Backup wiederhergestellt - die Seite wird neu geladen …')
      reloadPage('backup')
    } catch (e) {
      setRestoreMsg(`Fehler: ${String((e as Error).message)}`)
      setRestoring(false)
    }
  }

  async function save() {
    if (pending) {
      saveErrors.show('Bitte entscheiden Sie zuerst bei den gekennzeichneten Angaben, was gelten soll: Ihre Eingabe oder der Stand von dort.')
      return
    }
    // Eine neue ungültige IBAN wird nicht gespeichert (#279); eine gespeicherte ungültige geht
    // unverändert mit, damit die übrigen Angaben trotzdem gespeichert werden.
    const iban = ibanForSave(form.iban, settings.iban, IBAN_LABELS.settings)
    if ('error' in iban) {
      saveErrors.report([{ field: 'iban', short: 'IBAN ungültig', text: iban.error }])
      return
    }
    // Lehnt der Server ab (#146), steht sein Satz unter den Feldern.
    try {
      const saved = await api<Settings>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          ...form,
          iban: iban.value,
          paymentDeadlineDays: deadlineDays(form.paymentDeadlineDays),
          ...ifUnchanged(seen.current),
        }),
      })
      seen.current = seenPart(saved, LANDLORD_KEYS)
    } catch (e) {
      // Inzwischen anderswo geändert (ein zweites Fenster, ein anderes Gerät): Gespeichert ist nichts. Die Karte zeigt
      // dann den Stand von jetzt, außer in den Feldern, die hier geändert wurden, und der gilt als gesehen. Was beide
      // geändert haben oder im Brief zusammengehört (`LANDLORD_GROUPS`), bleibt, wie es hier steht, und ist vor dem
      // nächsten Speichern zu entscheiden.
      const now = staleCurrent(e)
      const before = landlordForm(seen.current)
      const merged = now ? mergeStale(form, before, landlordForm(now), { same: sameLandlordInput, groups: LANDLORD_GROUPS }) : null
      const refused = settingsStaleText(e, seen.current, LANDLORD_STALE_FIELDS, merged && merged.conflicts.length > 0
        ? 'Was hier und anderswo geändert wurde, ist unten gekennzeichnet: Bitte entscheiden Sie dort und speichern Sie dann erneut.'
        : 'Die Felder zeigen jetzt diesen Stand; was Sie hier selbst geändert haben, steht weiter da. Bitte prüfen Sie die Angaben und speichern Sie erneut.')
      if (now && merged) {
        setForm(merged.form)
        setPending(merged.conflicts.length > 0 ? { units: merged.conflicts, now: landlordForm(now), before, theirs: merged.theirs } : null)
        seen.current = seenPart(now, LANDLORD_KEYS)
        await reload().catch(() => { /* die Meldung in der Karte steht gleich */ })
      }
      saveErrors.show(refused ?? errorText(e))
      return
    }
    saveErrors.clear()
    await reload()
    toast('Einstellungen gespeichert.')
  }

  return (
    <>
      <PageHeader context="none" title="Einstellungen" subtitle="Vermieterdaten für das Anschreiben, KI-Belegauswertung und Updates." />

      <Card title={<>Vermieter &amp; Zahlung</>} {...jumpAt('landlord')}>
        <ErrorSummary errors={saveErrors} />
        <p className="muted">
          Erscheint im Kopf und in der Zahlungsaufforderung der gedruckten Abrechnung.
          {properties.length > 1 && ' Die Angaben gelten als Vorgabe für alle Objekte; in den Stammdaten kann ein Objekt abweichen.'}
        </p>
        <div className="row">
          <Field label="Name des Vermieters" hint={conflictHint('landlordName')}>
            <input value={form.landlordName} onChange={(e) => setForm({ ...form, landlordName: e.target.value })} placeholder="Vor- und Nachname" />
          </Field>
          <IbanInput label="IBAN für Nachzahlungen" value={form.iban} stored={settings.iban} onChange={(iban) => setForm({ ...form, iban })} placeholder="DE.." hint={conflictHint('iban')} {...saveErrors.field('iban')} />
          <Field label="Zahlungsfrist (Tage)" hint={conflictHint('paymentDeadlineDays')}>
            <input inputMode="numeric" value={form.paymentDeadlineDays} onChange={(e) => setForm({ ...form, paymentDeadlineDays: e.target.value })} />
          </Field>
        </div>
        <div className="row">
          <Field label="Anschrift des Vermieters" width="l" hint={conflictHint('landlordAddress') ?? 'Für Rücksendeangabe, Briefkopf und Fußzeile des Briefs. Ohne Angabe nennt die Rücksendeangabe die Adresse des Objekts; Briefkopf und Fußzeile bleiben ohne Anschrift.'}>
            <input value={form.landlordAddress} onChange={(e) => setForm({ ...form, landlordAddress: e.target.value })} placeholder="Straße Nr., PLZ Ort" />
          </Field>
          <Field label="Kontakt" width="l" hint={conflictHint('landlordContact') ?? 'Optional: Telefon oder E-Mail für die Fußzeile mit Kontakt und Bank.'}>
            <input value={form.landlordContact} onChange={(e) => setForm({ ...form, landlordContact: e.target.value })} placeholder="z. B. Tel. 0123 456789" />
          </Field>
        </div>
        {/* Nach einer Ablehnung: je Feld oder Gruppe, die hier und anderswo geändert wurde, eine Entscheidung */}
        {pending?.units.map((unit) => {
          // Je Knopf genau die Werte, die danach gelten (Durchsicht S1).
          const theirsLabel = unit.length > 1 ? 'Werte von dort übernehmen' : 'Wert von dort übernehmen'
          const values = (from: LandlordForm) => unit.map((key) => `${LANDLORD_LABELS[key]} ${shownValue(key, from[key])}`).join(', ')
          return (
            <NoticeBox
              key={unit.join(',')}
              level="hint"
              title={unit.length > 1 ? 'Hier und anderswo geändert: Diese Angaben stehen zusammen im Brief' : `Hier und anderswo geändert: ${unit.map((key) => LANDLORD_LABELS[key]).join('')}`}
              action={`Mit „Meine Eingabe behalten“ gilt: ${values(form)}. Mit „${theirsLabel}“ gilt: ${values(pending.now)}.`}
            >
              <div className="row">
                <button type="button" className="btn secondary small" onClick={() => decide(unit, false)}>Meine Eingabe behalten</button>
                <button type="button" className="btn secondary small" onClick={() => decide(unit, true)}>{theirsLabel}</button>
              </div>
            </NoticeBox>
          )
        })}
        {/* Sichtprüfung E52: Speichern steht unter den Feldern wie in den anderen Karten */}
        <div className="row">
          <button className="btn" onClick={save}>Speichern</button>
        </div>
      </Card>

      <LetterTemplateCard reload={reload} />
      <LetterDesignCard />

      <AiSettings settings={settings} reload={reload} jump={jumpAt('ai')} />

      <LawOverridesCard />

      <Card title={<>Daten &amp; Sicherung</>} {...jumpAt('backup')}>
        <p className="muted">
          {folder && <>Ihre Daten liegen im Datenordner von Mietfuchs: <code>{folder}</code>. </>}
          Belege gehen nur an einen externen KI-Dienst, und nur, wenn Sie dem zugestimmt haben; die Update-Prüfung fragt bei
          GitHub nach der neuesten Version, wenn sie eingeschaltet ist, und sendet dabei keine Daten.
          Sonst verlässt nichts den Rechner, auf dem Mietfuchs läuft.
          Ein Backup enthält die Datenbank samt aller hochgeladenen Belege, Logo und Briefpapier als ZIP-Datei;
          den Verlauf der Änderungen nur, wenn Sie es unten wählen.
        </p>
        <div className="row">
          {/* Ein Link, kein Abruf: Ein Archiv mit allen Belegen gehört nicht in den Arbeitsspeicher. Er lädt in einen
              unsichtbaren Rahmen. Nachgemessen in Chromium: Mit `download` speicherte der Browser eine Ablehnung des
              Servers als „backup.json“, und als gewöhnlicher Link fragte er bei offenem Formular „Seite verlassen?“. Im
              Rahmen lädt ein Download kein Dokument; eine Ablehnung schon, und ihr Satz steht dann hier in der Karte. */}
          <a className="btn secondary" href={withJournal ? '/api/backup?journal=1' : '/api/backup'} target={BACKUP_FRAME} onClick={awaitDownload}>⬇ Backup herunterladen (ZIP)</a>
          <iframe
            name={BACKUP_FRAME}
            title="Backup herunterladen"
            hidden
            tabIndex={-1}
            onLoad={(e) => {
              let text = ''
              try {
                text = frameMessage(e.currentTarget.contentDocument)
              } catch {
                // Lässt sich der Rahmen nicht lesen, gibt es nichts zu zeigen
              }
              if (text) setBackupError(text)
            }}
          />
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
        {backupError && <NoticeBox level="error" title="Das Backup wurde nicht erstellt" action={backupError} />}
        {backup && (
          <p className="muted" role="status">
            {lastBackupLine(backup)} Ob und wo die Datei gespeichert wurde, sieht Mietfuchs nicht; bewahren Sie Ihr Backup
            nicht auf diesem Rechner auf, etwa auf einem USB-Stick oder einer externen Festplatte.
          </p>
        )}
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
        {/* Umzug aus der bisherigen Programmdatei (#517), nur im Fenster; ersetzt einen Bestand nur nach Rückfrage */}
        {onOpenRelocation && inWindow() && (
          <p className="muted">
            Bisher mit der Programmdatei gearbeitet?{' '}
            <button type="button" className="btn ghost small" onClick={onOpenRelocation}>Daten aus bisherigem Mietfuchs übernehmen …</button>
          </p>
        )}
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

      {/* Womit sich Mietfuchs beim Start öffnet (#735): nur, wo Mietfuchs selbst einen Browser öffnet (`settings.browsers`) */}
      <BrowserCard settings={settings} reload={reload} />

      {network && <NetworkCard bridge={network} />}
      {remote && <RemoteCard bridge={remote} />}

      {/* Die Anmeldung (#528): nur, wenn Mietfuchs im Netz erreichbar ist, ein Passwort hat oder im Übergang steht */}
      <AccessCard jump={jumpAt('access')} />

      {/* Am Ende wie der Abschnitt „Info“ einer Windows-App: Version und Updates, dann Urheber und Lizenz. Wer aus dem
          Microsoft Store installiert, sieht README und LICENSE nie; die AGPL sieht Urheber, fehlende Gewähr und den Weg
          zur Lizenz in einer Oberfläche vor („Appropriate Legal Notices“). */}
      <Card title="Über Mietfuchs" {...jumpAt('about')}>
        <UpdateSettings settings={settings} update={update} reload={reload} />
        <p>
          Mietfuchs unterstützt Sie bei der Nebenkostenabrechnung, ersetzt aber keine Rechts- oder Steuerberatung.
          Prüfen Sie die Ergebnisse, bevor Sie eine Abrechnung versenden.
        </p>
        <p className="muted">
          © 2026 speedone. Mietfuchs ist freie Software unter der GNU Affero General Public License 3.0 und wird
          ohne Gewähr bereitgestellt, soweit das Gesetz es zulässt.{' '}
          <a href={WEBSITE_URL} target="_blank" rel="noreferrer">Website</a>
          {' · '}
          <a href={LICENSE_URL} target="_blank" rel="noreferrer">Lizenz</a>
          {' · '}
          <a href={SOURCE_URL} target="_blank" rel="noreferrer">Quellcode</a>
        </p>
      </Card>
    </>
  )
}

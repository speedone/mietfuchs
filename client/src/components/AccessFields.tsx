// Bausteine der Anmeldung (#528), geteilt von Anmeldeseite, Anmeldedialog, Einrichtung und der Karte „Anmeldung“:
// die Felder für ein neues Passwort mit Vorschlag einer Passphrase, das Feld für den Einrichtungscode und die Hilfe
// „Passwort vergessen?“.
import { useState } from 'react'
import type { AccessInfo } from '../access'
import { codePlaces, type AccessField } from '../accessView'
import { passphrase } from '../passphrase'
import type { FormErrors } from './ErrorSummary'
import Field from './Field'

export type NewPassword = { password: string; repeat: string }

// Zwei Felder und ein Vorschlag. Der Vorschlag steht im Klartext daneben, damit man ihn notieren kann; die Felder
// bleiben verdeckt.
export function NewPasswordFields({ label = 'Passwort', repeatLabel = 'Passwort wiederholen', value, onChange, minLength, errors, width = 'l' }: {
  label?: string
  // In der schmalen Karte der Einrichtung `full`, damit Code und Passwort gleich breit stehen
  width?: 'l' | 'full'
  repeatLabel?: string
  value: NewPassword
  onChange: (next: NewPassword) => void
  minLength: number
  errors: FormErrors<AccessField>
}) {
  const [suggested, setSuggested] = useState('')
  const suggest = () => {
    const p = passphrase(minLength)
    setSuggested(p)
    onChange({ password: p, repeat: p })
    errors.clearField('password')
    errors.clearField('repeat')
  }
  return (
    <>
      <Field label={label} width={width} hint={`Mindestens ${minLength} Zeichen. Ein Satz aus drei, vier Wörtern lässt sich gut merken.`} {...errors.field('password')}>
        <input type="password" autoComplete="new-password" value={value.password} onChange={(e) => onChange({ ...value, password: e.target.value })} />
      </Field>
      <Field label={repeatLabel} width={width} {...errors.field('repeat')}>
        <input type="password" autoComplete="new-password" value={value.repeat} onChange={(e) => onChange({ ...value, repeat: e.target.value })} />
      </Field>
      <p className="muted">
        <button type="button" className="btn secondary small" onClick={suggest}>Passwort vorschlagen</button>
      </p>
      {suggested && (
        <p role="status">
          Vorgeschlagen und in beide Felder eingetragen: <code className="break-all">{suggested}</code>. Schreiben Sie es auf
          oder speichern Sie es in einem Passwort-Manager.
        </p>
      )}
    </>
  )
}

export function CodeField({ value, onChange, info, errors, width = 'm' }: {
  width?: 'm' | 'full'
  value: string
  onChange: (code: string) => void
  info: AccessInfo
  errors: FormErrors<AccessField>
}) {
  return (
    <Field label="Einrichtungscode" width={width} hint={`Zwölf Zeichen wie K7QM-4XPA-9TRW. ${codePlaces(info).join(' ')}`} {...errors.field('code')}>
      <input autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  )
}

// „Passwort vergessen?“: zurücksetzen lässt es sich nur am Rechner, auf dem Mietfuchs läuft, über eine Datei im
// Datenordner (Entwurf, Abschnitt „Passwort vergessen“). Im Container der Befehl dafür.
export function ResetHelp({ runtime }: { runtime: string }) {
  return (
    <>
      <p className="muted text-s mb-1">Passwort vergessen? Am Rechner, auf dem Mietfuchs läuft, lässt es sich zurücksetzen.</p>
      <details className="text-s">
        <summary>So setzen Sie das Passwort zurück</summary>
        {runtime === 'docker' ? (
          <>
            <p>Geben Sie auf dem Rechner, auf dem der Container läuft, ein:</p>
            <p><code className="break-all">docker compose exec mietfuchs touch /app/server/data/passwort-zuruecksetzen</code></p>
            <p>
              Laden Sie diese Seite danach neu. Mietfuchs fragt dann nach einem neuen Passwort und einem Einrichtungscode;
              den zeigt <code>docker compose logs mietfuchs</code>. Alle Geräte sind danach abgemeldet.
            </p>
          </>
        ) : (
          <>
            <p>
              Legen Sie im Datenordner von Mietfuchs eine leere Datei mit dem Namen <code>passwort-zuruecksetzen</code> an.
              Wo der Datenordner liegt, steht in der Anleitung zur Installation; angemeldet nennen ihn auch die Einstellungen
              unter „Daten &amp; Sicherung“.
            </p>
            <p>
              Laden Sie diese Seite danach neu. Mietfuchs fragt dann nach einem neuen Passwort und einem Einrichtungscode;
              der steht im Konsolenfenster bzw. Protokoll von Mietfuchs und in der Datei <code>einrichtungscode.txt</code> im
              Datenordner. Alle Geräte sind danach abgemeldet.
            </p>
          </>
        )}
      </details>
    </>
  )
}

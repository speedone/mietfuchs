import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react'

// Ein Feld (#346, Schritt 3; Spezifikation Abschnitt 3 „Feld“, nach GOV.UK). Von oben nach unten:
// Beschriftung (fett, in Textfarbe, „(freiwillig)“ statt eines Sternchens am Pflichtfeld), Hinweis (grau,
// ein Satz), Fehler (rot, mit ⚠ und für Vorleser „Fehler:“), dann das Eingabefeld. Das Feld vergibt `id`,
// `aria-labelledby`, `aria-describedby` (Hinweis und Fehler) und `aria-invalid` selbst, damit keine Seite
// sie vergisst. Vorbild war das IBAN-Feld (IbanInput.tsx), das selbst darauf aufbaut.
//
// Das Ganze ist ein `<label class="field">` wie bisher, damit Raster, Zeilen und Seitenfenster es wie jedes
// andere Feld setzen; benannt wird das Eingabefeld aber nur durch die Beschriftung (`aria-labelledby`), sonst
// gehörten Hinweis und Fehler zu seinem Namen und würden doppelt vorgelesen.
//
// Das Kind ist ein Eingabefeld (`<input>`, `<select>`, `<textarea>`), dem die Angaben angehängt werden, oder
// eine Funktion, die sie bekommt und selbst weiterreicht (für Bausteine wie MonthPicker). Mit `onFix` (aus
// `useFormError().field(…)`) verschwindet die Meldung, sobald der Nutzer das Feld ändert.
export type FieldControlProps = {
  id: string
  'aria-labelledby': string
  'aria-describedby'?: string
  'aria-invalid'?: true
}

type Props = {
  label: ReactNode
  /** Freiwillige Angabe: „(freiwillig)“ hinter der Beschriftung. Ohne ist das Feld Pflicht. */
  optional?: boolean
  hint?: ReactNode
  /** Die kurze Meldung am Feld („Datum fehlt“), am besten aus `useFormError().field(…)`. */
  error?: string
  /** Die `id` des Eingabefelds; aus `useFormError().field(…)`, damit die Sammelmeldung darauf zeigen kann. */
  id?: string
  onFix?: () => void
  /** Liest der Bildschirmleser die Meldung sofort vor, auch ohne Sammelmeldung (Prüfung beim Verlassen). */
  announce?: boolean
  /** Breite nach Inhalt: `s` für Betrag und Postleitzahl, `m` für Monat und Auswahl; ohne die volle Spalte. */
  width?: 's' | 'm'
  className?: string
  children: ReactElement<Record<string, unknown>> | ((props: FieldControlProps) => ReactNode)
}

export default function Field({ label, optional, hint, error, id, onFix, announce, width, className, children }: Props) {
  const own = useId()
  const inputId = id ?? `${own}-input`
  const labelId = `${own}-label`
  const hintId = hint ? `${own}-hint` : undefined
  const errorId = error ? `${own}-error` : undefined
  const extra = isValidElement(children) ? (children.props['aria-describedby'] as string | undefined) : undefined
  const describedBy = [hintId, errorId, extra].filter(Boolean).join(' ') || undefined
  const control: FieldControlProps = {
    id: inputId,
    'aria-labelledby': labelId,
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
    ...(error ? { 'aria-invalid': true as const } : {}),
  }
  const classes = ['field', width === 's' ? 'width-s' : width === 'm' ? 'width-m' : '', className ?? ''].filter(Boolean).join(' ')
  return (
    <label className={classes} onChange={onFix ? () => onFix() : undefined}>
      <span id={labelId}>
        {label}
        {optional && <span className="font-normal text-muted"> (freiwillig)</span>}
      </span>
      {hint && <small id={hintId} className="muted">{hint}</small>}
      {error && <FieldMessage id={errorId} error={error} announce={announce} />}
      {typeof children === 'function' ? children(control) : cloneElement(children, control)}
    </label>
  )
}

// Die Meldung am Feld allein, für ein Eingabefeld ohne eigenes `<Field>` mitten im Text (der Entwurf am Feld,
// etwa „✎ anpassen“ der Vorauszahlung, UI-Durchsicht H4). Dort gibt es keine Sammelmeldung; mit `announce`
// liest der Bildschirmleser die Meldung sofort vor.
export function FieldMessage({ id, error, announce, className }: { id?: string; error: string; announce?: boolean; className?: string }) {
  return (
    <span id={id} className={className ? `field-message is-error ${className}` : 'field-message is-error'} role={announce ? 'alert' : undefined}>
      <span aria-hidden="true">⚠ </span><span className="sr-only">Fehler: </span>{error}
    </span>
  )
}

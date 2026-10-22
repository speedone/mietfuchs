import { useEffect, useRef, useState, type ReactNode } from 'react'
import Field, { type FieldWidth } from './Field'
import { YEAR_MAX, YEAR_MIN } from '../monthText'
import { parseYearText } from '../yearText'
import { localToday } from '../periodForm'

// Das Jahresfeld, Geschwister des Monatsfelds (MonthField.tsx) für Angaben, die nur ein Jahr sind: Eichjahr eines
// Zählers, Jahr der Zahlung für die Steuer. Ein Textfeld mit Ziffernblock und daneben ‹ › zum Blättern um ein
// Jahr; ein Raster wie beim Monat gibt es nicht, ein Jahr tippt sich schneller, als es sich wählt. Leer oder mit
// unlesbarem Text beginnt das Blättern beim Jahr von `today`. Die Grenzen sind die des Monatsfelds.
//
// Der Wert ist der Text, wie er dasteht; ein ungültiger Text wird nicht verworfen. Die Prüfung des Formulars
// meldet ihn, und schon beim Verlassen steht am Feld, was nicht stimmt (`parseYearText` in yearText.ts). Wie beim
// Monatsfeld kommen Beschriftung, Hinweis und Meldung von `<Field>`, und die Meldung der Prüfung geht vor.

type Props = {
  label: ReactNode
  value: string
  onChange: (value: string) => void
  /** Das Jahr, bei dem das Blättern im leeren Feld beginnt, kommt aus diesem Datum; sonst aus heute. */
  today?: string
  placeholder?: string
  required?: boolean
  hint?: ReactNode
  error?: string
  id?: string
  onFix?: () => void
  width?: FieldWidth
  className?: string
  /** Engere Grenzen fürs Blättern als die des Monatsfelds, etwa die Jahre, die eine Prüfung annimmt. */
  min?: number
  max?: number
}

export default function YearField({ label, value, onChange, today, placeholder, required, hint, error, id, onFix, width, className, min = YEAR_MIN, max = YEAR_MAX }: Props) {
  const [ownError, setOwnError] = useState<string>()
  // Was das Feld selbst gesendet hat. Kommt ein anderer Wert von außen (etwa ein übernommener Vorschlag), gilt die
  // eigene Meldung nicht mehr, wie beim Monatsfeld (Durchsicht von #404).
  const sent = useRef(value)
  useEffect(() => {
    if (value !== sent.current) setOwnError(undefined)
    sent.current = value
  }, [value])
  const send = (next: string) => {
    sent.current = next
    onChange(next)
  }
  // Was ‹ › gesetzt haben, sagt der Bildschirmleser an; der Fokus bleibt auf dem Knopf.
  const [stepped, setStepped] = useState('')
  const parsed = parseYearText(value)
  const current = parsed.kind === 'year' ? parsed.year : null
  const step = (delta: number) => {
    const start = current === null ? Number((today ?? localToday()).slice(0, 4)) : current + delta
    const next = String(Math.min(max, Math.max(min, start)))
    setOwnError(undefined)
    setStepped(next)
    send(next)
    onFix?.()
  }
  const onBlur = () => {
    const r = parseYearText(value)
    if (r.kind === 'invalid') setOwnError(r.short)
  }

  const shown = error ?? ownError
  return (
    <Field label={label} required={required} hint={hint} error={shown} announce={!error && !!ownError} id={id} onFix={onFix} width={width ?? 's'} className={className}>
      {(control) => (
        <span className="year-field">
          <input
            {...control}
            value={value}
            inputMode="numeric"
            placeholder={placeholder}
            autoComplete="off"
            onChange={(e) => {
              setOwnError(undefined)
              send(e.target.value)
            }}
            onBlur={onBlur}
          />
          <button type="button" aria-label="Voriges Jahr" aria-controls={control.id} disabled={current !== null && current <= min} onClick={() => step(-1)}>‹</button>
          <button type="button" aria-label="Nächstes Jahr" aria-controls={control.id} disabled={current !== null && current >= max} onClick={() => step(1)}>›</button>
          <span className="sr-only" aria-live="polite">{stepped}</span>
        </span>
      )}
    </Field>
  )
}

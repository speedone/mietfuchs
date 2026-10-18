import { useState } from 'react'
import { ibanFieldState, ibanOnBlur } from '../ibanField'
import Field from './Field'

// Ein IBAN-Feld mit Prüfung beim Verlassen (#279). Die Entscheidungen stehen in ibanField.ts;
// hier wird nur gerendert, seit #346 (Schritt 3) über `<Field>`. Der Fehler erscheint erst nach dem
// Verlassen des Feldes, damit eine halb getippte IBAN nicht schon rot dasteht, und wird dann sofort
// vorgelesen (`announce`), denn eine Sammelmeldung gibt es erst beim Speichern; der Hinweis auf eine
// gespeicherte ungültige steht sofort da. Meldet das Speichern selbst einen Fehler zur IBAN (`error`
// aus `useFormError().field('iban')`), steht er an derselben Stelle.
type Props = {
  label: string
  value: string
  // Der gespeicherte Wert, gegen den „unverändert“ gemessen wird
  stored: string | null | undefined
  onChange: (value: string) => void
  placeholder?: string
  id?: string
  error?: string
  onFix?: () => void
}

export default function IbanInput({ label, value, stored, onChange, placeholder, id, error: saveError, onFix }: Props) {
  const [left, setLeft] = useState(false)
  const state = ibanFieldState(value, stored)
  const error = saveError ?? (left ? state.error : null) ?? undefined
  return (
    <Field
      label={label}
      id={id}
      onFix={onFix}
      error={error}
      announce={!saveError}
      hint={state.notice ? <span className="text-amber">{state.notice}</span> : undefined}
    >
      <input
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          setLeft(true)
          const formatted = ibanOnBlur(value)
          if (formatted !== value) onChange(formatted)
        }}
      />
    </Field>
  )
}

import { useId, useState } from 'react'
import { ibanFieldState, ibanOnBlur } from '../ibanField'

// Ein IBAN-Feld mit Prüfung beim Verlassen (#279). Die Entscheidungen stehen in ibanField.ts;
// hier wird nur gerendert. Der Fehler erscheint erst nach dem Verlassen des Feldes, damit eine
// halb getippte IBAN nicht schon rot dasteht; der Hinweis auf eine gespeicherte ungültige steht
// sofort da.
type Props = {
  label: string
  value: string
  // Der gespeicherte Wert, gegen den „unverändert“ gemessen wird
  stored: string | null | undefined
  onChange: (value: string) => void
  placeholder?: string
}

export default function IbanInput({ label, value, stored, onChange, placeholder }: Props) {
  const id = useId()
  const [left, setLeft] = useState(false)
  const state = ibanFieldState(value, stored)
  const error = left ? state.error : null
  const message = error ?? state.notice
  return (
    <label className="field grow">
      {label}
      <input
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={message ? id : undefined}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          setLeft(true)
          const formatted = ibanOnBlur(value)
          if (formatted !== value) onChange(formatted)
        }}
      />
      {message && <span id={id} className={`field-message ${error ? 'is-error' : 'is-notice'}`} role={error ? 'alert' : undefined}>{message}</span>}
    </label>
  )
}

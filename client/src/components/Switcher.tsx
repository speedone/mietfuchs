// Die Auswahl von Objekt und Zeitraum (#346, Schritt 8; UI-Durchsicht #341 N1). Beide sahen verschieden aus
// (eigener Pfeil und kleine Schrift beim Objekt, nativer Pfeil beim Jahr); jetzt ist es ein Baustein: Der gewählte
// Eintrag steht als Text da, der umbrechen darf (ein Auswahlfeld bricht nicht um und schnitt lange Objektnamen
// ab, #180), mit demselben Pfeil ▾, und das echte Auswahlfeld liegt unsichtbar darüber. Klick, Tastatur und
// Vorleser bedienen also weiter das Auswahlfeld. Gestaltet über die Utility `switcher` in tw.css.
//
// Für Objekt und Abrechnungszeitraum steht er nur in der Seitenleiste bzw. im Menüblatt (M13, Wächter S18).
// Auf einer Seite gibt es ihn nur für eine andere Größe: das Kalenderjahr von Mietkonto und Steuer bei einem
// Zeitraum, der vom Kalenderjahr abweicht (`CalendarYearSelect`).
export type SwitcherOption = { value: string; label: string }

export default function Switcher({ label, ariaLabel, value, options, onChange, className }: {
  label: string
  // Der Name des Auswahlfelds für Vorleser, wenn er vom sichtbaren Wort abweicht („Objekt wählen“).
  ariaLabel?: string
  value: string
  options: readonly SwitcherOption[]
  onChange: (value: string) => void
  className?: string
}) {
  const current = options.find((o) => o.value === value)
  return (
    <label className={`switcher no-print${className ? ` ${className}` : ''}`}>
      <span>{label}</span>
      <div>
        <span aria-hidden="true">{current?.label ?? ''}</span>
        <select aria-label={ariaLabel ?? label} title={current?.label} value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
    </label>
  )
}

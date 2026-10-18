import type { PeriodView } from '../periodForm'
import { usePeriod, useSwitchCalendarYear, useSwitchPeriod } from '../period'

// Die Auswahl des Abrechnungszeitraums (#208). Beim Kalenderobjekt sieht sie aus wie die frühere
// Jahresauswahl: Beschriftung „Abrechnungsjahr“, Jahreszahlen als Werte. Die Ansicht ohne Hooks ist
// eigens da, damit der jsdom-Test den angezeigten gegen den gewählten Wert prüfen kann.
export function PeriodSelectView({ view, onChange, label, className = 'field' }: { view: PeriodView; onChange: (value: string) => void; label?: string; className?: string }) {
  return (
    <label className={className}>
      <span>{label ?? view.switcherLabel}</span>
      <select value={view.param} onChange={(e) => onChange(e.target.value)}>
        {view.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

export function PeriodSelect({ label, className }: { label?: string; className?: string }) {
  const view = usePeriod()
  const switchPeriod = useSwitchPeriod()
  return <PeriodSelectView view={view} label={label} className={className} onChange={(v) => void switchPeriod(v)} />
}

// Das Kalenderjahr für Mietkonto und Steuer (Entwurf 3.10, 3.11).
export function CalendarYearSelect({ label = 'Jahr' }: { label?: string }) {
  const view = usePeriod()
  const switchYear = useSwitchCalendarYear()
  return (
    <label className="field">
      {label}
      <select value={view.calendarYear} onChange={(e) => void switchYear(Number(e.target.value))}>
        {view.calendarYearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
    </label>
  )
}

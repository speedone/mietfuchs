import type { PeriodView } from '../periodForm'
import { usePeriod, useSwitchCalendarYear, useSwitchPeriod } from '../period'
import Switcher from './Switcher'

// Die Auswahl des Abrechnungszeitraums (#208). Beim Kalenderobjekt sieht sie aus wie die frühere
// Jahresauswahl: Beschriftung „Abrechnungsjahr“, Jahreszahlen als Werte. Die Ansicht ohne Hooks ist
// eigens da, damit der jsdom-Test den angezeigten gegen den gewählten Wert prüfen kann.
//
// Sie steht nur in der Seitenleiste bzw. im Menüblatt (#346 Schritt 8, M13); die Seiten zeigen den Zeitraum im
// Seitenkopf an (PageHeader) und wählen ihn nicht noch einmal (Wächter S18).
export function PeriodSelectView({ view, onChange, className }: { view: PeriodView; onChange: (value: string) => void; className?: string }) {
  return <Switcher label={view.switcherLabel} value={view.param} options={view.options} onChange={onChange} className={className} />
}

export function PeriodSelect({ className }: { className?: string }) {
  const view = usePeriod()
  const switchPeriod = useSwitchPeriod()
  return <PeriodSelectView view={view} className={className} onChange={(v) => void switchPeriod(v)} />
}

// Das Kalenderjahr für Mietkonto und Steuer (Entwurf 3.10, 3.11): eine andere Größe als der Abrechnungszeitraum,
// deshalb auf der Seite und als „Kalenderjahr“ beschriftet. Beim Kalenderobjekt ist es der Zeitraum selbst, und
// eine Auswahl hier wäre ein zweites „Abrechnungsjahr“ neben der Seitenleiste (M13): Dann gibt es sie nicht.
export function CalendarYearSelect({ className }: { className?: string }) {
  const view = usePeriod()
  const switchYear = useSwitchCalendarYear()
  if (view.calendar) return null
  return (
    <Switcher label="Kalenderjahr" value={String(view.calendarYear)} className={`switcher-field${className ? ` ${className}` : ''}`}
      options={view.calendarYearOptions.map((y) => ({ value: String(y), label: String(y) }))}
      onChange={(v) => void switchYear(Number(v))} />
  )
}

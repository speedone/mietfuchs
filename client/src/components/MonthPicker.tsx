// Monat und Jahr als zwei Auswahllisten (Logik in tenancyModel.ts), statt `<input type="month">`,
// das Safari auf dem Mac und Firefox nicht kennen (#287). Der Wert ist 'MM.JJJJ' (Staffeln) oder mit
// `iso` 'JJJJ-MM'; gelesen wird beides. `emptyLabel`: was „kein Monat“ heißt, solange auch kein Jahr
// gewählt ist (in der ersten Zeile einer Staffel „ab Einzug“, sonst nichts).
import { monthPickerIso, monthPickerParts, monthPickerText, monthPickerYears } from '../tenancyModel'

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

type Props = {
  label: string
  value: string
  start?: string // Einzug, bestimmt die Jahre zur Auswahl; ohne: zehn Jahre zurück und voraus
  today: string
  emptyLabel?: string
  iso?: boolean
  onChange: (text: string) => void
}

export default function MonthPicker({ label, value, start = '', today, emptyLabel, iso = false, onChange }: Props) {
  const { month, year } = monthPickerParts(value)
  const years = monthPickerYears(start, value, today)
  const emit = (m: string, y: string) => onChange(iso ? monthPickerIso(m, y) : monthPickerText(m, y))
  return (
    <div className="field" role="group" aria-label={label}>
      {label}
      <div className="month-picker">
        <select aria-label={`${label}: Monat`} value={month} onChange={(e) => emit(e.target.value, year)}>
          <option value="">{!year && emptyLabel ? emptyLabel : '– Monat –'}</option>
          {MONTHS.map((name, i) => {
            const mm = String(i + 1).padStart(2, '0')
            return <option key={mm} value={mm}>{name}</option>
          })}
        </select>
        <select aria-label={`${label}: Jahr`} value={year} onChange={(e) => emit(month, e.target.value)}>
          <option value="">{month ? '– Jahr –' : '–'}</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
    </div>
  )
}

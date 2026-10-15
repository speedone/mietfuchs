// Monat und Jahr einer Staffel als zwei Auswahllisten (Logik in tenancyModel.ts). Beide leer
// heißt „ab Einzug“.
import { monthPickerParts, monthPickerText, monthPickerYears } from '../tenancyModel'

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

type Props = {
  label: string
  value: string
  start: string // Einzug, bestimmt die Jahre zur Auswahl
  today: string
  onChange: (text: string) => void
}

export default function MonthPicker({ label, value, start, today, onChange }: Props) {
  const { month, year } = monthPickerParts(value)
  const years = monthPickerYears(start, value, today)
  return (
    <div className="field" role="group" aria-label={label}>
      {label}
      <div className="month-picker">
        <select aria-label={`${label}: Monat`} value={month} onChange={(e) => onChange(monthPickerText(e.target.value, year))}>
          <option value="">{year ? '– Monat –' : 'ab Einzug'}</option>
          {MONTHS.map((name, i) => {
            const mm = String(i + 1).padStart(2, '0')
            return <option key={mm} value={mm}>{name}</option>
          })}
        </select>
        <select aria-label={`${label}: Jahr`} value={year} onChange={(e) => onChange(monthPickerText(month, e.target.value))}>
          <option value="">{month ? '– Jahr –' : ''}</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
    </div>
  )
}

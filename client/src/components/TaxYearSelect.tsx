// Das Jahr der Zahlung (Steuer) als Auswahl (#208, Entwurf 3.10): im Kostenformular und in der Liste
// „Aus dem Vorjahr übernehmen“. Leer heißt „noch nicht gewählt“.
export default function TaxYearSelect({ label, value, years, onChange }: { label: string; value: string; years: readonly number[]; onChange: (value: string) => void }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">– bitte wählen –</option>
      {years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
    </select>
  )
}

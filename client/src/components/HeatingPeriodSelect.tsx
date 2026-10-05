// Die Heizperiode einer Heizposition im Kostenformular (Heizung PR 5), aus der Optionsliste gespeist:
// So zeigt das Feld immer den gespeicherten Wert (CLAUDE.md, Tests Ebene 3).
export default function HeatingPeriodSelect({ options, value, onChange }: { options: { value: string; label: string }[]; value: string; onChange: (value: string) => void }) {
  return (
    <>
    <label className="field">
      Heizperiode
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
      {/* Laienprobe B16: Zu einem Abrechnungszeitraum gehören die Heizperioden, die in ihm enden (BGH VIII ZR 240/07). */}
      {/* Sichtprüfung E23: zuerst, warum das Feld da ist. */}
      <small className="muted">Ihre Heizung rechnet in einem eigenen Zeitraum ab, der Heizperiode. Wählen Sie die Heizperiode, die die Rechnung abdeckt; mit ihr wird die Position abgerechnet. Hier stehen die Heizperioden, die in diesem Abrechnungszeitraum enden. Die Rechnung einer späteren Heizperiode erfassen Sie im Abrechnungszeitraum, in dem sie endet.</small>
    </>
  )
}

// Die Heizperiode einer Heizposition im Kostenformular (Heizung PR 5), aus der Optionsliste gespeist:
// So zeigt das Feld immer den gespeicherten Wert (CLAUDE.md, Tests Ebene 3).
// `current` (#690): die laufende Heizperiode, die erst nach dem gewählten Zeitraum endet; mit ihr sagt der Satz darunter,
// dass sie dabei ist und wo sie abgerechnet wird. Ohne sie bleibt er wortgleich.
export default function HeatingPeriodSelect({ options, value, onChange }: { options: { value: string; label: string; current?: boolean }[]; value: string; onChange: (value: string) => void }) {
  const withCurrent = options.some((o) => o.current)
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
      <small className="muted">Ihre Heizung rechnet in einem eigenen Zeitraum ab, der Heizperiode. Wählen Sie die Heizperiode, die die Rechnung abdeckt; mit ihr wird die Position abgerechnet. {withCurrent
        ? 'Hier stehen die Heizperioden, die in diesem Abrechnungszeitraum enden, und die laufende Heizperiode. Die laufende wird in dem Abrechnungszeitraum abgerechnet, in dem sie endet.'
        : 'Hier stehen die Heizperioden, die in diesem Abrechnungszeitraum enden. Die Rechnung einer späteren Heizperiode erfassen Sie im Abrechnungszeitraum, in dem sie endet.'}</small>
    </>
  )
}

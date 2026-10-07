// Skala und Bewertungsfaktor eines Heizkostenverteilers im Zählerformular (Heizung PR 12, Entwurf 8.1).
// Die Auswahl zeigt den gespeicherten Wert (CLAUDE.md, Kosten.test.tsx); ohne Skala steht „bitte wählen“.
import Term from './Term'
import { HCA_SCALE_OPTIONS, scaleOfOption, type HcaFieldsForm } from '../hcaForm'

export default function HcaFields({ form, onChange }: { form: HcaFieldsForm; onChange: (f: HcaFieldsForm) => void }) {
  return (
    <>
      <label className="field grow">
        <span>Skala des <Term id="heatCostAllocator">Heizkostenverteilers</Term></span>
        <select value={form.scale} onChange={(e) => onChange({ ...form, scale: scaleOfOption(e.target.value) })}>
          {HCA_SCALE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <small className="muted">Steht auf dem Gerät oder in den Unterlagen des Herstellers oder Messdienstes. Ein Gerät mit anderem Faktor, etwa nach einem Tausch, legen Sie als neuen Zähler an.</small>
      </label>
      {form.scale === 'unit' && (
        <label className="field grow">
          Bewertungsfaktor des Heizkörpers
          <input inputMode="decimal" value={form.factor} onChange={(e) => onChange({ ...form, factor: e.target.value })} placeholder="z. B. 1,25" className="input-num" />
          <small className="muted">Nachkommastellen mit Komma, etwa 0,875.</small>
        </label>
      )}
    </>
  )
}

// Der Druckblock „Warmwasseranteil“ der eigenen Heizkostenabrechnung (Heizung PR 11, Entwurf 8.8: „α mit
// Methode“). Logik ohne DOM; die Zahlen und den Rechenweg liefert der Server (`self.dhw`).
import type { DhwMethod, DhwStatement } from './types'
import { FUEL_GRADE_LABELS, HEATING_VALUE_UNIT_TEXT } from '../../shared/fuelGrades.ts'

export const DHW_METHOD_TEXT: Record<DhwMethod, string> = {
  heatMeter: 'mit einem Wärmezähler gemessen (§ 9 Abs. 2 Satz 1 HeizkostenV)',
  volumeFormula: 'aus dem gemessenen Warmwasser berechnet (§ 9 Abs. 2 Satz 2 HeizkostenV)',
  areaFormula: 'aus der Wohnfläche berechnet (§ 9 Abs. 2 Satz 4 HeizkostenV)',
}

export type DhwBlockView = { title: string; method: string; steps: string[]; values: string[] }

const pct = (alpha: number) => `${(alpha * 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`

// Den Block gibt es, wenn der Rechenweg mehr sagt als der Satz „gemessen … von … kWh“: bei einer Formel und
// bei Brennstoff als Menge (B = Q / Hᵢ). Gemessen gegen kWh laut Rechnung bleibt der Satz von PR 10.
export const showsDhwBlock = (d: DhwStatement | undefined): d is DhwStatement =>
  d !== undefined && (d.method !== 'heatMeter' || d.denominator.kind === 'fuelQuantity')

export function dhwBlock(d: DhwStatement | undefined): DhwBlockView | null {
  if (!d) return null
  return {
    title: `Warmwasseranteil ${pct(d.alpha)}`,
    method: DHW_METHOD_TEXT[d.method],
    steps: d.steps,
    values: d.heatingValues.map((v) =>
      `Heizwert „${v.label}“: ${v.kwh.toLocaleString('de-DE')} kWh je ${HEATING_VALUE_UNIT_TEXT[v.per]} ` +
        (v.source === 'invoice' ? 'laut Rechnung' : `aus der Tabelle der Heizkostenverordnung${v.grade ? ` (${FUEL_GRADE_LABELS[v.grade]})` : ''}, weil die Rechnung keinen nennt`)),
  }
}

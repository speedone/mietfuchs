// Das Formular eines Zählers, ohne DOM prüfbar (meterForm.test.ts).
import type { MeterType } from './types'

export type MeterForm = { id?: string; name: string; unitId: string; type: MeterType; meterNumber: string; unit: string }

// Die Einheit, die ein Zähler seiner Sparte nach meist zeigt (#142). Vorher stand für jede Sparte
// „m³“ im Feld, und ein Wärmezähler, bei dem niemand es änderte, zeigte seinen Verbrauch in m³.
// Bei „Sonstiges“ gibt es keine sinnvolle Vorgabe; dann bleibt das Feld leer statt falsch.
const DEFAULT_UNITS: Record<MeterType, string> = { kaltwasser: 'm³', waerme: 'kWh', strom: 'kWh', sonstig: '' }
export const defaultMeterUnit = (type: MeterType): string => DEFAULT_UNITS[type]

// Sparte wechseln: Stand im Feld noch die Vorgabe der bisherigen Sparte (oder nichts), wandert sie
// mit. Eine selbst eingetragene Einheit bleibt, sie ist eine Angabe. Nur bei einem neuen Zähler:
// Bei einem bestehenden ist die Einheit gespeichert und gehört zu seinen Ablesungen.
export function withMeterType(form: MeterForm, type: MeterType): MeterForm {
  if (form.id) return { ...form, type }
  const unit = form.unit.trim()
  const followsDefault = unit === '' || unit === defaultMeterUnit(form.type)
  return { ...form, type, unit: followsDefault ? defaultMeterUnit(type) : form.unit }
}

export const emptyMeterForm = (): MeterForm => ({ name: '', unitId: '', type: 'kaltwasser', meterNumber: '', unit: defaultMeterUnit('kaltwasser') })

// Der Endstand des alten Geräts in der Tabelle der Ablesungen. Fehlt er, steht „fehlt“ da und kein
// leerer Platz (#142); eine eingetragene 0 ist eine Angabe und bleibt stehen (#83).
export function oldEndText(value: number | null | undefined): string {
  return value == null ? 'fehlt' : value.toLocaleString('de-DE')
}

// Das Formular eines Zählers, ohne DOM prüfbar (meterForm.test.ts).
import type { HeatingRole, Meter, MeterType } from './types'
import { hkvRemoteReadingNewDevices, hkvRemoteReadingRetrofit } from '../../shared/law/heizkostenv.ts'
import { germanDate, LAW_AS_OF, onlyVersion, valueAt } from '../../shared/law/register.ts'

// Fernablesbar? Leer heißt „weiß ich nicht“.
export type RemoteAnswer = '' | 'yes' | 'no'

export type MeterForm = {
  id?: string
  name: string
  unitId: string
  type: MeterType
  meterNumber: string
  unit: string
  // Heizung PR 4: Rolle an der Heizanlage (nur ohne Wohnung), Fernablesbarkeit und Einbau.
  heatingRole: HeatingRole | ''
  remote: RemoteAnswer
  installedOn: string
}

// Die Einheit, die ein Zähler seiner Sparte nach meist zeigt (#142). Vorher stand für jede Sparte
// „m³“ im Feld, und ein Wärmezähler, bei dem niemand es änderte, zeigte seinen Verbrauch in m³.
// Bei „Sonstiges“ gibt es keine sinnvolle Vorgabe; dann bleibt das Feld leer statt falsch.
const DEFAULT_UNITS: Record<MeterType, string> = { kaltwasser: 'm³', warmwasser: 'm³', waerme: 'kWh', hkv: 'Einheiten', strom: 'kWh', sonstig: '' }
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

export const emptyMeterForm = (): MeterForm => ({
  name: '', unitId: '', type: 'kaltwasser', meterNumber: '', unit: defaultMeterUnit('kaltwasser'), heatingRole: '', remote: '', installedOn: '',
})

export const meterToForm = (m: Meter): MeterForm => ({
  id: m.id,
  name: m.name,
  unitId: m.unitId ?? '',
  type: m.type,
  meterNumber: m.meterNumber ?? '',
  unit: m.unit,
  heatingRole: m.heatingRole ?? '',
  remote: m.remoteReadable === true ? 'yes' : m.remoteReadable === false ? 'no' : '',
  installedOn: m.installedOn ?? '',
})

export const HEATING_ROLE_LABELS: Record<HeatingRole, string> = {
  supply: 'Versorgungszähler der Heizanlage (etwa der Gaszähler)',
  dhwHeat: 'Wärmezähler für das Warmwasser an der Heizanlage',
  totalHeat: 'Gesamtwärmezähler an der Heizanlage',
}

// Welche Rolle an der Heizanlage ein Zähler des Hauses (ohne Wohnung) haben kann (Sichtprüfung E19).
// Versorgungszähler ist, was Brennstoff oder Energie zuführt: Gas oder Öl (Sparte „Sonstiges“),
// Strom einer Wärmepumpe, Fernwärme. Die Wärmezähler der Anlage haben die Sparte „Wärme“, wie der
// Server verlangt. Ein Wasserzähler hat keine Rolle; dort fragt das Formular nicht.
export function heatingRoleOptions(form: Pick<MeterForm, 'unitId' | 'type'>, hasPlant: boolean): HeatingRole[] {
  if (!hasPlant || form.unitId) return []
  if (form.type === 'waerme') return ['supply', 'dhwHeat', 'totalHeat']
  if (form.type === 'sonstig' || form.type === 'strom') return ['supply']
  return []
}

export const HEATING_ROLE_HELP = 'Ein Zähler der Heizanlage zählt nicht als Hauptzähler des Hauses; Mietfuchs ordnet ihn den Heizkosten zu. Wählen Sie „Nein“, wenn er den Verbrauch des ganzen Hauses misst.'

// Fernablesbarkeit und Einbau fragt das Formular nur bei Geräten, die § 5 HeizkostenV erfasst:
// Wärme- und Warmwasserzähler und Heizkostenverteiler der Wohnungen, dazu die Wärmezähler der
// Heizanlage. Der Gaszähler gehört dem Versorger.
// Gefragt wird erst, wenn das Objekt eine Heizanlage hat (Durchsicht von #230, M1): Ohne Anlage
// rechnet Mietfuchs mit diesen Angaben nichts, und mit einer später angelegten Anlage änderten sie
// still die Hinweise der Abrechnung.
export function asksRemote(form: MeterForm, hasPlant: boolean): boolean {
  if (!hasPlant) return false
  if (form.unitId) return form.type === 'waerme' || form.type === 'warmwasser' || form.type === 'hkv'
  return form.type === 'waerme' && (form.heatingRole === 'dhwHeat' || form.heatingRole === 'totalHeat')
}

export type MeterBody = {
  name: string
  unitId: string | null
  type: MeterType
  meterNumber?: string
  unit: string
  heatingPlantId: string | null
  heatingRole: HeatingRole | null
  // Fehlen ohne Heizanlage im Rumpf: Eine gespeicherte Angabe bleibt dann, wie sie ist.
  remoteReadable?: boolean | null
  installedOn?: string | null
}

// Der Hilfetext am Einbaudatum, mit den Stichtagen aus dem Register (Durchsicht von #230, M5).
export const REMOTE_RULE_TEXT =
  `Für die Kürzung nach § 12 HeizkostenV: Geräte, die nach dem ${germanDate(valueAt(hkvRemoteReadingNewDevices, LAW_AS_OF).installedAfter)} ` +
  `eingebaut wurden, müssen ab dem Einbau aus der Ferne ablesbar sein, ältere ab dem ${germanDate(onlyVersion(hkvRemoteReadingRetrofit).validFrom ?? '')}.`

// Der Rumpf zum Speichern. `plantId`: die Heizanlage des Objekts, `null` ohne. Eine Zählernummer
// fehlt im Rumpf, wenn das Feld leer ist, wie bisher.
export function meterBody(form: MeterForm, plantId: string | null): { body: MeterBody } | { error: string } {
  if (!form.name.trim()) return { error: 'Bitte einen Namen für den Zähler angeben.' }
  if (form.type === 'hkv' && !form.unitId) {
    return { error: 'Ein Heizkostenverteiler sitzt an einem Heizkörper einer Wohnung. Bitte wählen Sie die Wohnung.' }
  }
  const role = form.heatingRole !== '' && heatingRoleOptions(form, plantId !== null).includes(form.heatingRole) ? form.heatingRole : null
  const asks = asksRemote({ ...form, heatingRole: role ?? '' }, plantId !== null)
  const number = form.meterNumber.trim()
  return {
    body: {
      name: form.name.trim(),
      unitId: form.unitId || null,
      type: form.type,
      ...(number ? { meterNumber: number } : {}),
      // Ohne Angabe die Vorgabe der Sparte (#142), nicht für jede Sparte „m³“.
      unit: form.unit.trim() || defaultMeterUnit(form.type),
      heatingPlantId: role === null ? null : plantId,
      heatingRole: role,
      ...(plantId === null ? {} : {
        remoteReadable: asks && form.remote !== '' ? form.remote === 'yes' : null,
        installedOn: asks && form.installedOn !== '' ? form.installedOn : null,
      }),
    },
  }
}

// Der Endstand des alten Geräts in der Tabelle der Ablesungen. Fehlt er, steht „fehlt“ da und kein
// leerer Platz (#142); eine eingetragene 0 ist eine Angabe und bleibt stehen (#83).
export function oldEndText(value: number | null | undefined): string {
  return value == null ? 'fehlt' : value.toLocaleString('de-DE')
}

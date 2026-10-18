// Das Formular eines Zählers, ohne DOM prüfbar (meterForm.test.ts).
import type { HcaScale, HeatingRole, Meter, MeterType } from './types'
import { EMPTY_HCA_FIELDS, hcaFieldsBody, hcaFieldsOf, type HcaFieldsForm } from './hcaForm'
import { hkvRemoteReadingNewDevices, hkvRemoteReadingRetrofit } from '../../shared/law/heizkostenv.ts'
import { dayBefore, germanDate, LAW_AS_OF, onlyVersion, valueAt } from '../../shared/law/register.ts'
import { calibrationEnd } from '../../shared/calibration.ts'
import { CALIBRATION_AMENDED_ON } from '../../shared/law/messev.ts'
import { hasKnownUnits, knownUnit, meterUnitOptions, unitKey, unitLabel, unitProblem } from '../../shared/meterUnits.ts'
import { METER_TYPE_LABELS } from '../../shared/wording.ts'
import type { Problem } from './formProblems'

// Die Auswahl der Einheit (#342): bekannte Einheiten der Sparte und eine gespeicherte unbekannte.
export { hasKnownUnits, meterUnitOptions }

// Fernablesbar? Leer heißt „weiß ich nicht“.
export type RemoteAnswer = '' | 'yes' | 'no'

export type MeterForm = {
  id?: string
  name: string
  unitId: string
  type: MeterType
  meterNumber: string
  unit: string
  // Die gespeicherte Einheit (#342): Eine unbekannte, die unverändert bleibt, hindert das Speichern nicht.
  keptUnit: string
  // Die Einheit, die ein Spartenwechsel geleert hat, weil die neue Sparte sie nicht kennt (Durchsicht von #342, S6);
  // für den Hinweis am Feld. Leer, wenn nichts geleert wurde.
  unitDropped: string
  // Die gespeicherte Sparte (Durchsicht S-N1): Nach einem Wechsel lässt sich ein Zähler ohne Einheit nicht leer speichern.
  keptType: MeterType | ''
  // Heizung PR 4: Rolle an der Heizanlage (nur ohne Wohnung), Fernablesbarkeit und Einbau.
  heatingRole: HeatingRole | ''
  // Die gespeicherte Rolle (Durchsicht M1): Sie bleibt wählbar, auch wenn die Sparte sie nicht mehr
  // anbietet, und fällt erst bei einem Spartenwechsel weg.
  keptRole: HeatingRole | ''
  remote: RemoteAnswer
  installedOn: string
  // Heizung PR 9: die gewählte Heizanlage, wenn das Objekt mehrere hat.
  heatingPlantId: string
  // Heizung PR 12: Skala und Bewertungsfaktor, nur beim Heizkostenverteiler.
  hca: HcaFieldsForm
  // Heizung PR 21: geeicht bis Ende dieses Jahres; leer heißt „nicht angegeben“.
  calibratedUntil: string
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
  if (type !== form.type) {
    // Mit der Sparte fällt eine Rolle weg, die die neue nicht anbietet (Durchsicht M1).
    const roles = rolesForType(type)
    form = { ...form, keptRole: '', heatingRole: form.heatingRole !== '' && roles.includes(form.heatingRole) ? form.heatingRole : '' }
  }
  const unit = form.unit.trim()
  // Durchsicht von #342, S6: Eine Einheit, die die neue Sparte nicht kennt (l bei Wärme), bleibt nicht still stehen und
  // wird auch nicht still eine Vorgabe. Die Auswahl steht auf „Bitte wählen“, und ein Hinweis nennt die geleerte Einheit.
  const impossible = unit !== '' && hasKnownUnits(type) && knownUnit(type, unit) === null
  if (form.id) return impossible ? { ...form, type, unit: '', unitDropped: unit } : { ...form, type, unitDropped: '' }
  // Bei einem neuen Zähler wandert die Vorgabe der bisherigen Sparte (oder nichts) mit (#142).
  if (unit === '' || unit === defaultMeterUnit(form.type)) return { ...form, type, unit: defaultMeterUnit(type), unitDropped: '' }
  return impossible ? { ...form, type, unit: '', unitDropped: unit } : { ...form, type, unitDropped: '' }
}

// Der Hinweis am Feld Einheit (Durchsicht von #342, S2 und S6), oder null.
export function meterUnitHint(form: Pick<MeterForm, 'id' | 'type' | 'unit' | 'unitDropped'>): string | null {
  if (!hasKnownUnits(form.type) || form.unit.trim() !== '') return null
  if (form.unitDropped) return `„${form.unitDropped}“ ist für ${METER_TYPE_LABELS[form.type]} keine Einheit. Bitte wählen Sie die Einheit, die der Zähler zeigt.`
  return form.id ? 'Für diesen Zähler ist keine Einheit gespeichert. Bitte wählen Sie die Einheit, die er zeigt.' : 'Bitte wählen Sie die Einheit, die der Zähler zeigt.'
}

export const emptyMeterForm = (): MeterForm => ({
  name: '', unitId: '', type: 'kaltwasser', meterNumber: '', unit: defaultMeterUnit('kaltwasser'), keptUnit: '', unitDropped: '', keptType: '', heatingRole: '', keptRole: '', remote: '', installedOn: '', heatingPlantId: '', hca: EMPTY_HCA_FIELDS, calibratedUntil: '',
})

export const meterToForm = (m: Meter): MeterForm => ({
  id: m.id,
  name: m.name,
  unitId: m.unitId ?? '',
  type: m.type,
  meterNumber: m.meterNumber ?? '',
  // In der bekannten Schreibweise (#342), damit der Wert in der Auswahl steht („m3“ wird „m³“). Leer gespeichert
  // bleibt leer (Durchsicht S2): Die Auswahl zeigt „Bitte wählen“, und still „kWh“ einzusetzen hieße raten.
  unit: unitLabel(m.type, m.unit),
  keptUnit: m.unit,
  unitDropped: '',
  keptType: m.type,
  heatingRole: m.heatingRole ?? '',
  keptRole: m.unitId === null && m.heatingRole ? m.heatingRole : '',
  remote: m.remoteReadable === true ? 'yes' : m.remoteReadable === false ? 'no' : '',
  installedOn: m.installedOn ?? '',
  heatingPlantId: m.heatingPlantId ?? '',
  hca: hcaFieldsOf(m),
  calibratedUntil: m.calibratedUntil == null ? '' : String(m.calibratedUntil),
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
const rolesForType = (type: MeterType): HeatingRole[] =>
  type === 'waerme' ? ['supply', 'dhwHeat', 'totalHeat'] : type === 'sonstig' || type === 'strom' ? ['supply'] : []

// Eine gespeicherte Rolle, die die Sparte nicht anbietet, steht dazu (Durchsicht M1): Sie fiele sonst
// beim nächsten Speichern weg, und die Berechnung läse den Zähler als Hauptzähler des Hauses.
export function heatingRoleOptions(form: Pick<MeterForm, 'unitId' | 'type'> & Partial<Pick<MeterForm, 'keptRole'>>, hasPlant: boolean): HeatingRole[] {
  if (!hasPlant || form.unitId) return []
  const roles = rolesForType(form.type)
  return form.keptRole && !roles.includes(form.keptRole) ? [...roles, form.keptRole] : roles
}

export function heatingRoleLabel(form: Pick<MeterForm, 'type'>, role: HeatingRole): string {
  return rolesForType(form.type).includes(role) ? HEATING_ROLE_LABELS[role] : `bisher: ${HEATING_ROLE_LABELS[role]}`
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
  // Heizung PR 12: bei jeder anderen Sparte `null`, sonst lehnte der Server ab.
  hcaScale: HcaScale | null
  ratingFactor: number | null
  // Heizung PR 21: bei jeder Sparte, auch ohne Heizanlage; beim Heizkostenverteiler immer `null`.
  calibratedUntil: number | null
}

// Der Hilfetext am Einbaudatum, mit den Stichtagen aus dem Register (Durchsicht von #230, M5).
export const REMOTE_RULE_TEXT =
  `Für die Kürzung nach § 12 HeizkostenV: Geräte, die nach dem ${germanDate(valueAt(hkvRemoteReadingNewDevices, LAW_AS_OF).installedAfter)} ` +
  `eingebaut wurden, müssen ab dem Einbau aus der Ferne ablesbar sein, ältere ab dem ${germanDate(onlyVersion(hkvRemoteReadingRetrofit).validFrom ?? '')}.`

// Der Rumpf zum Speichern. `plantId`: die Heizanlage des Objekts, `null` ohne. Eine Zählernummer
// fehlt im Rumpf, wenn das Feld leer ist, wie bisher.
// Die Anlage eines Zählers mit Rolle an der Heizanlage (Heizung PR 9): bei einer Anlage diese, ab zwei
// die gewählte. Ohne Rolle gehört der Zähler zu keiner.
// Die Felder des Zählerformulars, an denen eine Meldung stehen kann (#346, Schritt 3).
export type MeterField = 'name' | 'unitId' | 'unit' | 'heatingPlantId' | 'calibratedUntil'
// `problems` nennt alle Angaben auf einmal (#346, Schritt 3); `error`, `field` und `short` sind die erste davon.
type MeterError = { error: string; field?: MeterField; short?: string; problems: Problem<MeterField>[] }
const failed = (problems: Problem<MeterField>[]): MeterError => {
  const first = problems[0] ?? { text: '' }
  return { error: first.text, ...(first.field ? { field: first.field } : {}), ...(first.short ? { short: first.short } : {}), problems }
}

export function meterPlantId(form: Pick<MeterForm, 'unitId' | 'heatingRole' | 'heatingPlantId'>, plants: readonly { id: string }[]): { plantId: string | null } | MeterError {
  if (form.unitId || form.heatingRole === '') return { plantId: null }
  if (plants.length === 1) return { plantId: plants[0]?.id ?? null }
  if (plants.some((p) => p.id === form.heatingPlantId)) return { plantId: form.heatingPlantId }
  return plants.length === 0 ? { plantId: null } : failed([{ text: 'Bitte wählen Sie die Heizanlage, zu der der Zähler gehört.', field: 'heatingPlantId', short: 'Heizanlage fehlt' }])
}

export function meterBody(form: MeterForm, plantId: string | null): { body: MeterBody } | MeterError {
  const problems: Problem<MeterField>[] = []
  if (!form.name.trim()) problems.push({ text: 'Bitte einen Namen für den Zähler angeben.', field: 'name', short: 'Name fehlt' })
  if (form.type === 'hkv' && !form.unitId) {
    problems.push({ text: 'Ein Heizkostenverteiler sitzt an einem Heizkörper einer Wohnung. Bitte wählen Sie die Wohnung.', field: 'unitId', short: 'Wohnung fehlt' })
  }
  const role = form.heatingRole !== '' && heatingRoleOptions(form, plantId !== null).includes(form.heatingRole) ? form.heatingRole : null
  const asks = asksRemote({ ...form, heatingRole: role ?? '' }, plantId !== null)
  const number = form.meterNumber.trim()
  const hca = hcaFieldsBody(form.type, form.hca)
  if ('error' in hca) problems.push({ text: hca.error })
  // #342: Eine neue oder geänderte Einheit muss die Sparte kennen; eine gespeicherte, die unverändert bleibt, nicht.
  const entered = form.unit.trim()
  // Bei Sparten mit Auswahl wird nur gespeichert, was gewählt ist (Durchsicht S2, S6). Ohne Wahl darf nur ein schon
  // leer gespeicherter Zähler bleiben, wie er ist; ohne Auswahl gilt wie bisher die Vorgabe der Sparte.
  if (entered === '' && hasKnownUnits(form.type) && (!form.id || form.keptUnit.trim() !== '' || form.unitDropped !== '' || form.type !== form.keptType)) {
    problems.push({ text: 'Bitte wählen Sie die Einheit, die der Zähler zeigt.', field: 'unit', short: 'Einheit fehlt' })
  }
  const unitText = entered || (hasKnownUnits(form.type) ? '' : defaultMeterUnit(form.type))
  const unitKept = form.keptUnit !== '' && unitKey(form.type, unitText) === unitKey(form.type, form.keptUnit)
  const unitRefused = unitKept || unitText === '' ? null : unitProblem(form.type, unitText)
  if (unitRefused !== null) problems.push({ text: unitRefused, field: 'unit', short: 'Einheit passt nicht zur Sparte' })
  const until = form.calibratedUntil.trim()
  if (asksCalibration(form) && until !== '' && !/^[1-9]\d{3}$/.test(until)) {
    problems.push({ text: 'Bitte tragen Sie das Eichjahr vierstellig ein, so wie es der Messdienst oder der Eichschein nennt, oder lassen Sie das Feld leer.', field: 'calibratedUntil', short: 'Vierstellige Jahreszahl' })
  }
  if (problems.length > 0 || 'error' in hca) return failed(problems)
  return {
    body: {
      name: form.name.trim(),
      unitId: form.unitId || null,
      type: form.type,
      ...(number ? { meterNumber: number } : {}),
      // Ohne Angabe die Vorgabe der Sparte (#142), nicht für jede Sparte „m³“.
      unit: unitText,
      heatingPlantId: role === null ? null : plantId,
      heatingRole: role,
      // Heizkostenverteiler sind nicht eichpflichtig (Entwurf 3.12): nie ein Eichjahr.
      calibratedUntil: asksCalibration(form) && until !== '' ? Number(until) : null,
      ...(plantId === null ? {} : {
        remoteReadable: asks && form.remote !== '' ? form.remote === 'yes' : null,
        installedOn: asks && form.installedOn !== '' ? form.installedOn : null,
      }),
      ...hca.body,
    },
  }
}

// Der Endstand des alten Geräts in der Tabelle der Ablesungen. Fehlt er, steht „fehlt“ da und kein
// leerer Platz (#142); eine eingetragene 0 ist eine Angabe und bleibt stehen (#83).
export function oldEndText(value: number | null | undefined): string {
  return value == null ? 'fehlt' : value.toLocaleString('de-DE')
}

// ---------- Eichfrist (Heizung PR 21, #98) ----------

// Das Feld gibt es für jede Sparte außer Heizkostenverteilern (Plan PR 21, Abweichung 7): Auch Gas- und
// Stromzähler sind eichpflichtig (Anlage 7 Nr. 5.6 und Nr. 6 MessEV).
export const asksCalibration = (form: Pick<MeterForm, 'type'>): boolean => form.type !== 'hkv'

const ASK_SOURCE = 'Tragen Sie das Jahr ein, das der Messdienst oder der Eichschein nennt.'

// Der Vorschlag „geeicht bis“ aus der Jahreszahl auf dem Zähler (Eichmarke: das Jahr, in dem die Frist beginnt,
// Anlage 8 MessEV; Kennzeichnung „M22“: das Jahr der Anbringung, als Jahr des Inverkehrbringens vermutet). Das Ende
// rechnet shared/calibration.ts; alle Zahlen und Daten kommen aus dem Register.
export function calibrationSuggestion(type: MeterType, markedYear: string): { year: number; text: string } | { reason: string } {
  const text = markedYear.trim()
  if (!/^[1-9]\d{3}$/.test(text)) return { reason: 'Bitte nennen Sie die Jahreszahl vierstellig, wie auf dem Zähler.' }
  const year = Number(text)
  const end = calibrationEnd(type, year)
  if (end.kind === 'notInRegister') {
    return { reason: `Für diese Sparte schlägt Mietfuchs kein Jahr vor, denn ihre Eichfrist hängt von der Bauart ab. ${ASK_SOURCE.replace('der Messdienst', 'der Versorger, der Messdienst')}` }
  }
  if (end.kind === 'beforeRegister') {
    return { reason: `Für Zähler mit einer Jahreszahl vor ${end.firstYear} schlägt Mietfuchs kein Jahr vor: Bis dahin galt die Eichordnung, deren Fristen Mietfuchs nicht führt. ${ASK_SOURCE}` }
  }
  if (end.change === null) {
    return { year: end.year, text: `Vorschlag: geeicht bis Ende ${end.year} (Jahreszahl auf dem Zähler ${year}, Eichfrist ${end.years} Jahre).` }
  }
  const { from, before, after } = end.change
  const amendedOn = CALIBRATION_AMENDED_ON[from]
  const sameYear = Number(from.slice(0, 4)) === year
    ? ` Wurde der Zähler nach dem ${germanDate(dayBefore(from))} gekennzeichnet oder geeicht, galten von Anfang an ${after} Jahre; das Ende ist dasselbe.`
    : ''
  return {
    year: end.year,
    text:
      `Vorschlag: geeicht bis Ende ${end.year} (Jahreszahl auf dem Zähler ${year}). Seine Eichfrist von ${before} Jahren lief am ${germanDate(from)} noch, als sie auf ${after} Jahre stieg. ` +
      `Die Änderungsverordnung${amendedOn ? ` vom ${germanDate(amendedOn)}` : ''} enthält keine Übergangsregel. Mietfuchs wendet die Frist von ${after} Jahren auch auf Fristen an, die am ${germanDate(from)} noch liefen; eine schon abgelaufene Frist lebt nicht wieder auf. Das ist eine Auslegung. ` +
      `Steht auf dem Zähler noch das alte Ende, gilt im Zweifel das Jahr laut Messdienst oder Eichschein.${sameYear}`,
  }
}

// Der Hinweis unter dem Vorschlag (Prüfung des Plans, M4; § 34 Abs. 1 Satz 3, Anlage 8 MessEV).
export const CALIBRATION_MARK_HELP =
  'Die Jahreszahl auf der Eichmarke nennt das Jahr, in dem die Eichfrist beginnt. Wurde der Zähler erst nach Ablauf der alten Frist neu geeicht, beginnt die neue Frist mit dem Ablauf der alten; auf der Marke steht dann dieses Jahr und nicht das Jahr der Eichung (§ 34 Abs. 1 Satz 3, Anlage 8 MessEV). ' +
  'Eine Bauartzulassung nach dem früheren Eichrecht kann eine andere Frist bestimmen (§ 34 Abs. 1 Nr. 2 MessEV). Nehmen Sie im Zweifel das Jahr laut Eichschein oder Messdienst.'

// Die Einrichtung „Heizung“ in den Stammdaten (Heizung PR 4, Entwurf 11.2), ohne DOM prüfbar
// (heatingForm.test.ts). Gefragt wird in der Reihenfolge des Entwurfs: womit geheizt wird
// (Schritt 1), wer die Heizkostenabrechnung erstellt (2), welche Wohnungen angeschlossen sind (4),
// ob die Geräte aus der Ferne ablesbar sind (5) und bei einer Wärmepumpe, seit wann ihr Verbrauch
// erfasst wird (6). Schritt 3 (eigener Zeitraum) kommt mit Heizung PR 5, Schritt 7 (eigene
// Abrechnung) mit PR 10. Nichts davon ändert eine Zahl der Abrechnung.
import type { DevicesInstalledAfter, DevicesRemote, DhwMethod, HeatingEnergy, HeatingPlant, NewDevicesInstall, PropertyKind, Unit } from './types'
import { parseEuro } from './api'
import { hkvConsumptionShare, hkvCutNotByConsumption, hkvRemoteReadingNewDevices } from '../../shared/law/heizkostenv.ts'
import { germanDate, LAW_AS_OF, valueAt } from '../../shared/law/register.ts'

// Rechtszahlen aus dem Register, in der Fassung von heute (wie Lexikon und Anleitungen).
const SHARE = valueAt(hkvConsumptionShare, LAW_AS_OF)
const CUT = valueAt(hkvCutNotByConsumption, LAW_AS_OF)
export const NEW_DEVICES_AFTER = germanDate(valueAt(hkvRemoteReadingNewDevices, LAW_AS_OF).installedAfter)

export type EnergyAnswer = HeatingEnergy | 'perUnit'
export type PerUnitContract = '' | 'tenant' | 'landlord'
export type WhoSettles = '' | 'service' | 'homeowners' | 'self' | 'manual'
export type CaptureAnswer = 'unknown' | 'yes' | 'no'

export type HeatingForm = {
  energy: EnergyAnswer | ''
  contract: PerUnitContract
  who: WhoSettles
  unitIds: string[]
  remote: DevicesRemote
  installedAfter: DevicesInstalledAfter
  newInstall: NewDevicesInstall | ''
  captured: CaptureAnswer
  captureInstalledOn: string
  warmRentAverage: string
}

// Was die Einrichtung schickt. Die übrigen Felder der Anlage behalten ihre Vorgabe.
export type HeatingPlantBody = Pick<
  HeatingPlant,
  'energy' | 'supply' | 'method' | 'source' | 'devicesRemote' | 'devicesInstalledAfter2021' | 'capturedOnOct2024' | 'captureInstalledOn' | 'warmRentAverageCents' | 'units' | 'newDevicesInstall'
>
// `none`: Es entsteht bewusst keine Anlage, und der Satz sagt warum.
export type HeatingResult = { body: HeatingPlantBody } | { error: string } | { none: string }

type UnitInfo = Pick<Unit, 'id' | 'noConnection'>

export const ENERGY_OPTIONS: { value: EnergyAnswer; label: string }[] = [
  { value: 'gas', label: 'Gas' },
  { value: 'oil', label: 'Öl' },
  { value: 'lpg', label: 'Flüssiggas' },
  { value: 'districtHeating', label: 'Fernwärme' },
  { value: 'heatPump', label: 'Wärmepumpe' },
  { value: 'pellets', label: 'Pellets' },
  { value: 'wood', label: 'Holz (Scheitholz, Hackschnitzel)' },
  { value: 'electric', label: 'Strom (Nachtspeicher, Elektroheizung)' },
  { value: 'coal', label: 'Kohle' },
  { value: 'other', label: 'Etwas anderes' },
  { value: 'perUnit', label: 'Jede Wohnung hat eine eigene Heizung' },
]

export const CONTRACT_OPTIONS: { value: Exclude<PerUnitContract, ''>; label: string }[] = [
  { value: 'tenant', label: 'Der Mieter hat den Vertrag, etwa für die Gastherme' },
  { value: 'landlord', label: 'Ich habe den Vertrag und lege die Kosten um' },
]

export function whoOptions(kind: PropertyKind): { value: Exclude<WhoSettles, ''>; label: string }[] {
  const options: { value: Exclude<WhoSettles, ''>; label: string }[] = [
    { value: 'service', label: 'Ein Messdienst oder die Hausverwaltung' },
    { value: 'self', label: 'Ich selbst, mit Zählern oder Heizkostenverteilern' },
    { value: 'manual', label: 'Niemand, die Heizkosten werden nach Fläche oder fest verteilt' },
  ]
  // Bei einer vermieteten Eigentumswohnung liefert die Gemeinschaft die Abrechnung (Entwurf 11.2, D-F2).
  return kind === 'etw' ? [{ value: 'homeowners', label: 'Die Gemeinschaft (Hausverwaltung) rechnet ab' }, ...options] : options
}

export const REMOTE_OPTIONS: { value: DevicesRemote; label: string }[] = [
  { value: 'unknown', label: 'Weiß ich nicht' },
  { value: 'all', label: 'Ja, alle' },
  { value: 'partial', label: 'Nur einige' },
  { value: 'none', label: 'Nein' },
]

export const INSTALLED_OPTIONS: { value: DevicesInstalledAfter; label: string }[] = [
  { value: 'unknown', label: 'Weiß ich nicht' },
  { value: 'all', label: 'Ja, alle' },
  { value: 'some', label: 'Einige' },
  { value: 'none', label: 'Nein, alle früher' },
]

// Die Frage nach dem Einbau (§ 5 Abs. 2 Satz 1 und 4 HeizkostenV, Nachprüfung von #230). Sie zählt nur,
// wenn Geräte nach dem Stichtag eingebaut wurden und nicht alle fernablesbar sind.
// Sichtprüfung E10: kurz gefragt; was „einzeln“ und „als Ganzes“ bedeuten, sagen die Optionen und
// der Hilfetext darunter.
export const NEW_INSTALL_QUESTION = 'Wie wurden die nicht fernablesbaren Geräte eingebaut?'
export const NEW_INSTALL_OPTIONS: { value: NewDevicesInstall | ''; label: string }[] = [
  { value: '', label: 'Weiß ich nicht' },
  { value: 'single', label: 'Einzeln als Ersatz oder Ergänzung' },
  { value: 'whole', label: 'Das System wurde als Ganzes neu installiert' },
]
export const asksNewInstall = (form: Pick<HeatingForm, 'remote' | 'installedAfter'>): boolean =>
  (form.remote === 'none' || form.remote === 'partial') && form.installedAfter !== 'none'

export const CAPTURE_OPTIONS: { value: CaptureAnswer; label: string }[] = [
  { value: 'unknown', label: 'Weiß ich nicht' },
  { value: 'yes', label: 'Ja' },
  { value: 'no', label: 'Nein' },
]

const LATER_SELF = 'Die eigene Heizkostenabrechnung kommt mit einer späteren Version. Wählen Sie bis dahin „Ein Messdienst oder die Hausverwaltung“ oder „Niemand“; an Ihren Beträgen ändert sich dadurch nichts.'
const LATER_PER_UNIT = 'Etagenheizungen mit Vertrag auf den Vermieter kommen mit einer späteren Version. Bis dahin erfassen Sie ihre Kosten wie bisher, etwa direkt bei der Wohnung.'
const SELF_SUPPLY = 'Hat jeder Mieter einen eigenen Vertrag für seine Heizung, gibt es keine Heizkostenabrechnung des Hauses, und Mietfuchs legt keine Heizanlage an. Was Mieter für CO₂-Kosten vom Vermieter verlangen können, erklärt Mietfuchs mit einer späteren Version.'

// Der Satz unter der zweiten Frage.
// „Woran erkenne ich das?“ je Frage der Einrichtung (Entwurf 11.2, Laienprobe B9).
export const HOW_TO_TELL = {
  energy: 'Woran erkenne ich das? Am Brennstoff auf Ihrer Rechnung. Steht dort „Wärmelieferung“ oder „Fernwärme“, wählen Sie Fernwärme, auch wenn im Keller ein Kessel steht. Eine Wärmepumpe ist „Wärmepumpe“, nicht „Strom“; „Strom“ heißt Nachtspeicher- oder Elektroheizung.',
  who: 'Woran erkenne ich das? Bekommen Sie jedes Jahr eine Heizkostenabrechnung mit Beträgen je Wohnung, etwa von ista, Techem, Brunata, Minol oder KALO, wählen Sie „Ein Messdienst oder die Hausverwaltung“; das gilt auch für die Abrechnung einer Hausverwaltung. Gibt es keine Zähler oder Heizkostenverteiler in den Wohnungen, wählen Sie „Niemand“.',
  units: 'Woran erkenne ich das? Angeschlossen ist jede Wohnung, die von dieser Heizung warm wird. Eine Garage oder eine Wohnung mit eigener Gastherme gehört nicht dazu.',
  after: 'Den Zeitraum der Heizung stellen Sie nach dem Anlegen in dieser Karte mit „Zeitraum der Heizung ändern“ ein, wenn Ihr Messdienst nicht im Abrechnungszeitraum des Objekts abrechnet. Haupt- und Wärmezähler ordnen Sie auf der Seite Zähler der Heizung zu.',
} as const

// Laienprobe B8: Ohne Messdienst und eigene Ablesung gibt es keine Geräte, die aus der Ferne
// abzulesen wären; die beiden Fragen dazu entfallen dann, und die Zusammenfassung nennt sie nicht.
export const asksRemote = (who: WhoSettles | HeatingPlant['method']): boolean => who !== 'manual'

export function whoHint(who: WhoSettles, kind: PropertyKind): string {
  if (who === 'self') return LATER_SELF
  if (who === 'service') return 'Die Abrechnung des Messdienstes übernehmen Sie wie bisher als Position „Heizung und Warmwasser“ mit dem Schlüssel „Einzelbeträge“.'
  if (who === 'homeowners') return 'Die Abrechnung der Gemeinschaft übernehmen Sie wie die eines Messdienstes: als Position „Heizung und Warmwasser“ mit dem Schlüssel „Einzelbeträge“, mit den Beträgen der Hausgeldabrechnung.'
  if (who === 'manual') {
    const rule = `Die Heizkostenverordnung verlangt, ${SHARE.min} bis ${SHARE.max} % der Heizkosten nach Verbrauch zu verteilen; sonst darf jeder Mieter seinen Anteil um ${CUT} % kürzen. Mietfuchs rechnet wie bisher und sagt es in der Abrechnung.`
    return kind === 'zfh'
      ? `${rule} Im Haus mit höchstens zwei Wohnungen, von denen Sie eine selbst bewohnen, dürfen Sie mit dem Mieter etwas anderes vereinbaren (§ 2 HeizkostenV).`
      : rule
  }
  return ''
}

// „Alle Wohnungen“ heißt: alle ohne „kein Anschluss: Wärme“ (#117), wie beim Server ohne Liste.
export const defaultUnitIds = (units: readonly UnitInfo[]): string[] =>
  units.filter((u) => !(u.noConnection ?? []).includes('waerme')).map((u) => u.id)

export function emptyHeatingForm(units: readonly UnitInfo[]): HeatingForm {
  return {
    energy: '', contract: '', who: '', unitIds: defaultUnitIds(units), remote: 'unknown', installedAfter: 'unknown',
    captured: 'unknown', captureInstalledOn: '', warmRentAverage: '', newInstall: '',
  }
}

const centsText = (cents: number): string => (cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function heatingToForm(plant: HeatingPlant, units: readonly UnitInfo[]): HeatingForm {
  return {
    energy: plant.energy,
    contract: '',
    who: plant.source === 'homeowners' ? 'homeowners' : plant.method,
    unitIds: plant.units === null ? defaultUnitIds(units) : plant.units.map((u) => u.unitId),
    remote: plant.devicesRemote,
    installedAfter: plant.devicesInstalledAfter2021,
    captured: plant.capturedOnOct2024 === null ? 'unknown' : plant.capturedOnOct2024 ? 'yes' : 'no',
    captureInstalledOn: plant.captureInstalledOn ?? '',
    warmRentAverage: plant.warmRentAverageCents === null ? '' : centsText(plant.warmRentAverageCents),
    newInstall: plant.newDevicesInstall ?? '',
  }
}

export function heatingPlantBody(form: HeatingForm, units: readonly UnitInfo[]): HeatingResult {
  if (form.energy === '') return { error: 'Bitte wählen Sie, womit geheizt wird.' }
  if (form.energy === 'perUnit') {
    if (form.contract === '') return { error: 'Wer hat den Vertrag für die Heizung in der Wohnung?' }
    return form.contract === 'tenant' ? { none: SELF_SUPPLY } : { error: LATER_PER_UNIT }
  }
  const energy: HeatingEnergy = form.energy
  const who = form.who
  if (who === '') return { error: 'Bitte wählen Sie, wer die Heizkostenabrechnung erstellt.' }
  if (who === 'self') return { error: LATER_SELF }
  if (form.unitIds.length === 0) return { error: 'Bitte haken Sie mindestens eine Wohnung an, die an dieser Heizung hängt.' }
  const heatPump = energy === 'heatPump'
  const averageText = heatPump ? form.warmRentAverage.trim() : ''
  const average = averageText === '' ? null : parseEuro(averageText)
  if (averageText !== '' && (average === null || average < 0)) {
    return { error: 'Bitte geben Sie die durchschnittlichen Heizkosten als Betrag ein, etwa 1.234,56.' }
  }
  const all = defaultUnitIds(units)
  const allServed = form.unitIds.length === all.length && all.every((id) => form.unitIds.includes(id))
  return {
    body: {
      energy,
      supply: 'central',
      method: who === 'homeowners' ? 'service' : who,
      source: who === 'homeowners' ? 'homeowners' : 'building',
      devicesRemote: form.remote,
      devicesInstalledAfter2021: form.installedAfter,
      capturedOnOct2024: heatPump && form.captured !== 'unknown' ? form.captured === 'yes' : null,
      captureInstalledOn: heatPump && form.captured === 'no' && form.captureInstalledOn !== '' ? form.captureInstalledOn : null,
      warmRentAverageCents: average,
      units: allServed ? null : form.unitIds.map((unitId) => ({ unitId, heatedAreaM2: null })),
      newDevicesInstall: asksNewInstall(form) && form.newInstall !== '' ? form.newInstall : null,
    },
  }
}

// Sichtprüfung E9: Warum eine Einheit beim Einrichten nicht angehakt ist.
export const connectionNote = (u: Pick<Unit, 'noConnection'>): string | null =>
  (u.noConnection ?? []).includes('waerme') ? 'ohne Wärmeanschluss laut Wohnungsdaten' : null

// Die Zeilen der Karte, wenn eine Anlage eingerichtet ist. Ohne Liste versorgt die Anlage jede
// Einheit mit Wärmeanschluss (`servesUnit`); die übrigen nennt die Zeile, sonst hieße es „alle“.
export function heatingSummary(plant: HeatingPlant, units: readonly Pick<Unit, 'id' | 'name' | 'noConnection'>[]): string[] {
  const energy = ENERGY_OPTIONS.find((o) => o.value === plant.energy)?.label ?? plant.energy
  const who = plant.source === 'homeowners'
    ? 'Die Gemeinschaft (Hausverwaltung) rechnet ab'
    : (whoOptions('mfh').find((o) => o.value === plant.method)?.label ?? plant.method)
  const without = units.filter((u) => connectionNote(u) !== null).map((u) => u.name)
  const served = plant.units === null
    ? `alle Wohnungen${without.length > 0 ? ` außer ${without.join(', ')} (ohne Wärmeanschluss)` : ''}`
    : plant.units.length === 0
      ? 'keine Wohnung'
      : plant.units.map((u) => units.find((x) => x.id === u.unitId)?.name ?? u.unitId).join(', ')
  const remote = REMOTE_OPTIONS.find((o) => o.value === plant.devicesRemote)?.label ?? plant.devicesRemote
  const lines = [`Energie: ${energy}`, `Abrechnung: ${who}`, `Angeschlossen: ${served}`]
  return asksRemote(plant.method) ? [...lines, `Aus der Ferne ablesbar: ${remote}`] : lines
}

// ---------- Warmwasser laut Messdienst (Heizung PR 6, #211, Entwurf 7.7) ----------

export type HotWaterChoice = DhwMethod | ''
export const HOT_WATER_OPTIONS: readonly { value: HotWaterChoice; label: string }[] = [
  { value: '', label: 'keine Angabe' },
  { value: 'heatMeter', label: 'mit einem Wärmezähler gemessen' },
  { value: 'volumeFormula', label: 'mit einer Formel aus dem Warmwasserverbrauch' },
  { value: 'areaFormula', label: 'mit einer Formel aus der Wohnfläche' },
]
export const isFormula = (choice: HotWaterChoice): boolean => choice === 'volumeFormula' || choice === 'areaFormula'
// Die Bestätigung des unzumutbaren Aufwands (§ 9 Abs. 2 Satz 2 HeizkostenV) gibt es nur zu einer Formel.
export function hotWaterBody(choice: HotWaterChoice, unmeasurable: boolean): { dhwMethod: DhwMethod | null; dhwUnmeasurable: boolean | null } {
  return { dhwMethod: choice === '' ? null : choice, dhwUnmeasurable: isFormula(choice) ? unmeasurable : null }
}

// Die Bestätigung nennt die Voraussetzung der gewählten Formel (Durchsicht M1): die nach dem
// Warmwasserverbrauch bei unzumutbar hohem Aufwand (§ 9 Abs. 2 Satz 2), die nach der Wohnfläche nur,
// wenn auch das Volumen nicht gemessen werden kann (Satz 4).
export function unmeasurableLabel(choice: HotWaterChoice): string {
  return choice === 'areaFormula'
    ? 'Weder die Wärmemenge noch das Volumen des verbrauchten Warmwassers lässt sich messen (Nachweis aufbewahren)'
    : 'Die Wärmemenge ließe sich nur mit unzumutbar hohem Aufwand messen (Nachweis aufbewahren)'
}

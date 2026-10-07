// Die Einrichtung „Heizung“ in den Stammdaten (Heizung PR 4, Entwurf 11.2), ohne DOM prüfbar
// (heatingForm.test.ts). Gefragt wird in der Reihenfolge des Entwurfs: womit geheizt wird
// (Schritt 1), wer die Heizkostenabrechnung erstellt (2), welche Wohnungen angeschlossen sind (4),
// ob die Geräte aus der Ferne ablesbar sind (5) und bei einer Wärmepumpe, seit wann ihr Verbrauch
// erfasst wird (6). Schritt 3 (eigener Zeitraum) kommt mit Heizung PR 5. Schritt 7 (eigene
// Abrechnung, Heizung PR 10) steht in heatingSelfForm.ts: Wer „Ich selbst“ wählt, legt die Anlage hier
// zunächst bei „Niemand“ an, und Schritt 7 stellt sie in einer Transaktion um (Abweichung 21 des Plans).
// Nichts davon ändert eine Zahl der Abrechnung.
import type { DevicesInstalledAfter, DevicesRemote, DhwMethod, HeatGeneration, HeatPumpMajority, HeatingEnergy, HeatingPeriodView, HeatingPlant, HeatingPlantUnit, Meter, NewDevicesInstall, PropertyKind, Unit } from './types'
import { isStockEnergy } from '../../shared/fuelStock.ts'
import { parseEuro } from './api'
import { hkvConsumptionShare, hkvCutNotByConsumption, hkvHeatPumpCapture, hkvRemoteReadingNewDevices, hkvRenewableExemption } from '../../shared/law/heizkostenv.ts'
import { dayAfter, germanDate, LAW_AS_OF, valueAt } from '../../shared/law/register.ts'
import { lineRoot, sameLine } from '../../shared/heatingPeriod.ts'
import { parseMeterValue } from './tenantChange'
import { parseNumberDe } from './numbers'

// Rechtszahlen aus dem Register, in der Fassung von heute (wie Lexikon und Anleitungen).
const SHARE = valueAt(hkvConsumptionShare, LAW_AS_OF)
const CUT = valueAt(hkvCutNotByConsumption, LAW_AS_OF)
export const NEW_DEVICES_AFTER = germanDate(valueAt(hkvRemoteReadingNewDevices, LAW_AS_OF).installedAfter)
// § 12 Abs. 3 Satz 1 HeizkostenV: der Stichtag der Wärmepumpen aus dem Register (Heizung PR 10, Abweichung 1).
const HEAT_PUMP_CAPTURED_BY = valueAt(hkvHeatPumpCapture, LAW_AS_OF).capturedBy
export const NEWER_THAN = germanDate(HEAT_PUMP_CAPTURED_BY)

export type EnergyAnswer = HeatingEnergy | 'perUnit'
export type PerUnitContract = '' | 'tenant' | 'landlord'
export type WhoSettles = '' | 'service' | 'homeowners' | 'self' | 'manual'
export type CaptureAnswer = 'unknown' | 'yes' | 'no' | 'newer'

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
  // Wärmepumpe erst nach dem Stichtag eingebaut (Heizung PR 10): ihr Einbaudatum.
  heatPumpInstalledOn: string
  warmRentAverage: string
  // Heizung PR 9: Name der Anlage (Pflicht ab der zweiten), Energie der Etagenheizungen und die Namen
  // der bisherigen Anlagen, die beim Anlegen der zweiten noch keinen Namen oder keine Liste haben.
  name: string
  perUnitEnergy: HeatingEnergy | ''
  otherNames: Record<string, string>
  // Recht I3 der Durchsicht von #238: im selben Gebäude wie eine andere Anlage (deren Kennung), in einem
  // eigenen (`'own'`) oder noch nicht beantwortet (`''`). Keine Vorbelegung.
  building: string
  // Etagenheizung: Hat jede Wohnung einen eigenen Gaszähler? Ohne ihn gibt es keine Rechnung je Wohnung.
  ownMeters: boolean
  // Nach einem Kesseltausch mit demselben Vorratsbrennstoff (Nachprüfung von #238): Verheizt die neue Anlage
  // den Brennstoff im Tank weiter? `''`: nicht gefragt.
  takesOverStock: '' | 'yes' | 'no'
  // Heizung PR 11 (Durchsicht von #240, Recht-I1/I2): ob die Anlage die Wärme allein erzeugt, und bei einer
  // Wärmepumpe, ob sie mehr als die Hälfte der Wärme des Gebäudes liefert. Keine Vorbelegung.
  generation: HeatGeneration | ''
  majority: HeatPumpMajority | ''
}

// Was die Einrichtung schickt. Die übrigen Felder der Anlage behalten ihre Vorgabe.
export type HeatingPlantBody = Pick<
  HeatingPlant,
  'energy' | 'supply' | 'method' | 'source' | 'devicesRemote' | 'devicesInstalledAfter2021' | 'capturedOnOct2024' | 'captureInstalledOn' | 'warmRentAverageCents' | 'units' | 'newDevicesInstall' | 'name' | 'buildingWith'
> & Partial<Pick<HeatingPlant, 'heatPumpInstalledOn' | 'heatGeneration' | 'heatPumpMajority'>> & { takesOverStock?: boolean }
// Name und Wohnungen einer bisherigen Anlage, die mit dem Anlegen geändert werden (Heizung PR 9).
export type AdjustRow = { id: string; name: string; units: HeatingPlantUnit[] }
// `none`: Es entsteht bewusst keine Anlage, und der Satz sagt warum.
// `setUpSelf`: „Ich selbst“ gewählt; nach dem Speichern folgt Schritt 7 (Heizung PR 10).
export type HeatingResult = { body: HeatingPlantBody; adjust: AdjustRow[]; setUpSelf?: boolean } | { error: string } | { none: string }

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

// Womit Etagenheizungen auf Vertrag des Vermieters heizen können (Heizung PR 9). Ohne Vorratsenergien:
// Der Vorrat wird je Heizanlage geführt, nicht je Wohnung.
// Fernwärme bis in die Wohnung ist eine Wärmelieferung, keine Etagenheizung (§ 1 Abs. 1 Nr. 2 HeizkostenV).
export const PER_UNIT_ENERGY_OPTIONS: { value: HeatingEnergy; label: string }[] = ENERGY_OPTIONS.flatMap((o) =>
  o.value !== 'perUnit' && o.value !== 'districtHeating' && !isStockEnergy(o.value) ? [{ value: o.value, label: o.label }] : [],
)

// Die Antworten auf die Frage nach dem Gebäude: jede andere laufende Anlage oder ein eigenes Gebäude.
// `current`: die gespeicherte Antwort. Zeigt sie auf eine stillgelegte Anlage (Kesseltausch), steht dort die
// laufende Anlage ihrer Linie, mit der gespeicherten Kennung als Wert; so ist das Angezeigte das Gespeicherte
// (Nachprüfung von #238).
export const buildingOptions = (others: readonly Pick<HeatingPlant, 'id' | 'name' | 'endsOn' | 'replacesPlantId'>[], names: Record<string, string> = {}, current = ''): { value: string; label: string }[] => {
  const stored = others.find((p) => p.id === current && p.endsOn !== null)
  const heir = stored ? others.find((p) => p.endsOn === null && sameLine(p, stored, others)) : undefined
  return [
    ...others.filter((p) => p.endsOn === null).map((p) => ({ value: p.id === heir?.id ? current : p.id, label: `Ja, im selben Gebäude wie „${(names[p.id] ?? p.name).trim() || 'die bisherige Heizanlage'}“` })),
    { value: 'own', label: 'Nein, in einem anderen Gebäude' },
  ]
}

// Kesseltausch mit demselben Vorratsbrennstoff (Nachprüfung von #238): die Frage und ihre Antworten.
export const TAKES_OVER_QUESTION = 'Verheizt der neue Kessel den Brennstoff im Tank weiter?'
export const TAKES_OVER_OPTIONS: { value: 'yes' | 'no'; label: string }[] = [
  { value: 'yes', label: 'Ja, der Restbestand ist der Anfangsbestand der neuen Heizanlage' },
  { value: 'no', label: 'Nein, der Restbestand bleibt bei Ihnen (etwa verkauft oder abgepumpt)' },
]
export const TAKES_OVER_HINT = 'Mit „Nein“ tragen die Mieter den Restbestand nicht; er steht mit seinem Wert bei Ihrem Anteil, und Sie tragen bei der neuen Heizanlage einen eigenen Anfangsbestand ein, wenn sie mit neuem Brennstoff beginnt. Stellen Sie später auf „Ja“ zurück, entfällt dieser eigene Anfangsbestand.'
// Zurück von „Nein“ auf „Ja“ leert der Server den eigenen Anfangsbestand der neuen Anlage in ihrer ersten
// Heizperiode (Nachprüfung von #238); die Oberfläche fragt vorher. `null`: keine Rückfrage nötig.
export const TAKES_OVER_BACK = 'Der eigene Anfangsbestand der neuen Heizanlage in ihrer ersten Heizperiode wird dabei entfernt; ihr Anfangsbestand ist dann der Restbestand der bisherigen Heizanlage. Erfasste Lieferungen bleiben.'
export const takesOverBack = (plant: Pick<HeatingPlant, 'takesOverStock'> | undefined, form: Pick<HeatingForm, 'takesOverStock'>): boolean =>
  plant?.takesOverStock === false && form.takesOverStock === 'yes'

// Die Auswahl der Anlage an Kosten, Zählern und Lieferungen: erst ab zwei Anlagen. Eine stillgelegte
// Anlage (Kesseltausch) nennt ihren letzten Betriebstag.
export const plantOptions = (plants: readonly Pick<HeatingPlant, 'id' | 'name' | 'endsOn'>[]): { value: string; label: string }[] =>
  plants.length < 2 ? [] : plants.map((p) => ({ value: p.id, label: p.endsOn ? `${p.name} (bis ${germanDate(p.endsOn)})` : p.name }))

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
  // Heizung PR 10 (Abweichung 1): eine Wärmepumpe, die erst danach eingebaut wurde, fällt nicht unter § 12 Abs. 3.
  { value: 'newer', label: `Die Wärmepumpe ist erst nach dem ${NEWER_THAN} eingebaut worden` },
]

const SELF_HINT = 'Sie lesen Wärmezähler und Warmwasserzähler jeder Wohnung ab, und Mietfuchs verteilt nach der Heizkostenverordnung. Nach dem Anlegen fragt Mietfuchs nach Warmwasser, Erfassung und dem Anteil nach Verbrauch; bis dahin ändert sich an keiner Zahl etwas.'
const SELF_SUPPLY = 'Hat jeder Mieter einen eigenen Vertrag für seine Heizung, gibt es keine Heizkostenabrechnung des Hauses, und Mietfuchs legt keine Heizanlage an. Was Mieter für CO₂-Kosten vom Vermieter verlangen können, erklärt Mietfuchs mit einer späteren Version.'

// Der Satz unter der zweiten Frage.
// „Woran erkenne ich das?“ je Frage der Einrichtung (Entwurf 11.2, Laienprobe B9).
export const HOW_TO_TELL = {
  energy: 'Woran erkenne ich das? Am Brennstoff auf Ihrer Rechnung. Steht dort „Wärmelieferung“ oder „Fernwärme“, wählen Sie Fernwärme, auch wenn im Keller ein Kessel steht. Eine Wärmepumpe ist „Wärmepumpe“, nicht „Strom“; „Strom“ heißt Nachtspeicher- oder Elektroheizung.',
  who: 'Woran erkenne ich das? Bekommen Sie jedes Jahr eine Heizkostenabrechnung mit Beträgen je Wohnung, etwa von ista, Techem, Brunata, Minol oder KALO, wählen Sie „Ein Messdienst oder die Hausverwaltung“; das gilt auch für die Abrechnung einer Hausverwaltung. Gibt es keine Zähler oder Heizkostenverteiler in den Wohnungen, wählen Sie „Niemand“.',
  units: 'Woran erkenne ich das? Angeschlossen ist jede Wohnung, die von dieser Heizung warm wird. Eine Garage oder eine Wohnung mit eigener Gastherme gehört nicht dazu.',
  // Recht I5 der Durchsicht von #238: bei der Etagenheizung ein eigener Satz.
  unitsPerUnit: 'Haken Sie jede Wohnung an, deren Therme über Ihren Gasvertrag läuft. Wohnungen, deren Mieter einen eigenen Vertrag haben, gehören nicht dazu.',
  after: 'Den Zeitraum der Heizung stellen Sie nach dem Anlegen in dieser Karte mit „Zeitraum der Heizung ändern“ ein, wenn Ihr Messdienst nicht im Abrechnungszeitraum des Objekts abrechnet. Haupt- und Wärmezähler ordnen Sie auf der Seite Zähler der Heizung zu.',
} as const

// Laienprobe B8: Ohne Messdienst und eigene Ablesung gibt es keine Geräte, die aus der Ferne
// abzulesen wären; die beiden Fragen dazu entfallen dann, und die Zusammenfassung nennt sie nicht.
export const asksRemote = (who: WhoSettles | HeatingPlant['method']): boolean => who !== 'manual'

export function whoHint(who: WhoSettles, kind: PropertyKind): string {
  if (who === 'self') return SELF_HINT
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

// Die Wohnungen, an denen eine Anlage hängt; ohne Liste alle mit Anschluss an die Wärme.
const servedIds = (plant: Pick<HeatingPlant, 'units'>, units: readonly UnitInfo[]): string[] =>
  plant.units === null ? defaultUnitIds(units) : plant.units.map((u) => u.unitId)

export function emptyHeatingForm(units: readonly UnitInfo[], others: readonly HeatingPlant[] = []): HeatingForm {
  // Ab der zweiten Anlage beginnt die Liste mit den Wohnungen, die an keiner hängen (Heizung PR 9).
  const taken = new Set(others.flatMap((p) => servedIds(p, units)))
  return {
    energy: '', contract: '', who: '', unitIds: defaultUnitIds(units).filter((id) => !taken.has(id)), remote: 'unknown', installedAfter: 'unknown',
    captured: 'unknown', captureInstalledOn: '', heatPumpInstalledOn: '', warmRentAverage: '', newInstall: '',
    name: '', perUnitEnergy: '', building: '', ownMeters: false, takesOverStock: '', generation: '', majority: '', otherNames: Object.fromEntries(others.filter((p) => p.name.trim() === '' || p.units === null).map((p) => [p.id, p.name])),
  }
}

const centsText = (cents: number): string => (cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function heatingToForm(plant: HeatingPlant, units: readonly UnitInfo[]): HeatingForm {
  const perUnit = plant.supply === 'perUnit'
  return {
    energy: perUnit ? 'perUnit' : plant.energy,
    contract: perUnit ? 'landlord' : '',
    who: plant.source === 'homeowners' ? 'homeowners' : plant.method,
    unitIds: servedIds(plant, units),
    remote: plant.devicesRemote,
    installedAfter: plant.devicesInstalledAfter2021,
    captured: plant.heatPumpInstalledOn !== null ? 'newer' : plant.capturedOnOct2024 === null ? 'unknown' : plant.capturedOnOct2024 ? 'yes' : 'no',
    captureInstalledOn: plant.captureInstalledOn ?? '',
    heatPumpInstalledOn: plant.heatPumpInstalledOn ?? '',
    warmRentAverage: plant.warmRentAverageCents === null ? '' : centsText(plant.warmRentAverageCents),
    newInstall: plant.newDevicesInstall ?? '',
    name: plant.name,
    perUnitEnergy: perUnit ? plant.energy : '',
    otherNames: {},
    building: plant.buildingWith ?? '',
    ownMeters: perUnit,
    takesOverStock: plant.takesOverStock === null ? '' : plant.takesOverStock ? 'yes' : 'no',
    generation: plant.heatGeneration ?? '',
    majority: plant.heatPumpMajority ?? '',
  }
}

// `others`: die übrigen Anlagen des Objekts; `editingId`: die Anlage, die geändert wird (dann gibt es
// keine Anpassung anderer Anlagen, Heizung PR 9).
export function heatingPlantBody(form: HeatingForm, units: readonly UnitInfo[], others: readonly HeatingPlant[] = [], editingId: string | null = null): HeatingResult {
  if (form.energy === '') return { error: 'Bitte wählen Sie, womit geheizt wird.' }
  // Die Frage nach dem Gebäude (Recht I3 der Durchsicht von #238): beim Anlegen neben einer laufenden Anlage Pflicht.
  if (!editingId && others.some((p) => p.endsOn === null) && form.building === '') {
    return { error: 'Steht die neue Heizanlage im selben Gebäude wie eine bisherige? Bitte wählen Sie; im selben Gebäude stuft Mietfuchs die Anlagen für die CO₂-Aufteilung gemeinsam ein.' }
  }
  const several = others.length > 0
  const name = form.name.trim()
  if (several && name === '') {
    return { error: editingId ? 'Bitte geben Sie der Heizanlage einen Namen.' : 'Bitte geben Sie der neuen Heizanlage einen Namen, etwa „Haus B“ oder „Gastherme DG“.' }
  }
  const buildingWith = form.building === '' ? null : form.building
  // Die bisherigen Anlagen ohne Namen oder ohne Liste bekommen beides mit dem Anlegen (Review Focus 1).
  const adjust: AdjustRow[] = []
  if (!editingId) {
    for (const p of others.filter((x) => x.name.trim() === '' || x.units === null)) {
      const otherName = (form.otherNames[p.id] ?? p.name).trim()
      if (otherName === '') return { error: 'Bitte geben Sie auch der bisherigen Heizanlage einen Namen, etwa „Zentralheizung“.' }
      const rest = servedIds(p, units).filter((id) => !form.unitIds.includes(id))
      if (rest.length === 0) return { error: `An „${otherName}“ hinge dann keine Wohnung mehr. Ändern Sie stattdessen die bisherige Heizanlage.` }
      adjust.push({ id: p.id, name: otherName, units: rest.map((unitId) => ({ unitId, heatedAreaM2: null })) })
    }
  }
  const all = defaultUnitIds(units)
  const allServed = !several && form.unitIds.length === all.length && all.every((id) => form.unitIds.includes(id))
  const unitList = allServed ? null : form.unitIds.map((unitId) => ({ unitId, heatedAreaM2: null }))
  if (form.energy === 'perUnit') {
    if (form.contract === '') return { error: 'Wer hat den Vertrag für die Heizung in der Wohnung?' }
    if (form.contract === 'tenant') return { none: SELF_SUPPLY }
    // Etagenheizung auf Vertrag des Vermieters (Heizung PR 9, § 5 Abs. 1 Satz 2 CO2KostAufG): Die
    // Rechnung jeder Wohnung wird ihr direkt zugeordnet.
    if (form.perUnitEnergy === '') return { error: 'Womit heizen die Etagenheizungen?' }
    if (!form.ownMeters) {
      return { error: 'Mietfuchs ordnet die Rechnung jeder Wohnung dieser Wohnung zu; dafür braucht jede einen eigenen Gaszähler mit eigener Rechnung. Teilen sich Wohnungen einen Zähler, erfasst Mietfuchs das noch nicht.' }
    }
    if (form.unitIds.length === 0) return { error: 'Bitte haken Sie mindestens eine Wohnung an, die eine solche Heizung hat.' }
    return {
      body: {
        name, buildingWith, energy: form.perUnitEnergy, supply: 'perUnit', method: 'manual', source: 'building', devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown',
        capturedOnOct2024: null, captureInstalledOn: null, warmRentAverageCents: null, units: unitList, newDevicesInstall: null,
      },
      adjust,
    }
  }
  const energy: HeatingEnergy = form.energy
  const who = form.who
  if (who === '') return { error: 'Bitte wählen Sie, wer die Heizkostenabrechnung erstellt.' }
  if (form.unitIds.length === 0) return { error: 'Bitte haken Sie mindestens eine Wohnung an, die an dieser Heizung hängt.' }
  const heatPump = energy === 'heatPump'
  const averageText = heatPump ? form.warmRentAverage.trim() : ''
  const average = averageText === '' ? null : parseEuro(averageText)
  if (averageText !== '' && (average === null || average < 0)) {
    return { error: 'Bitte geben Sie die durchschnittlichen Heizkosten als Betrag ein, etwa 1.234,56.' }
  }
  // Abweichung 1 des Plans (Heizung PR 10): erst nach dem Stichtag eingebaut, dann das Einbaudatum statt der Erfassung.
  const installedText = heatPump && form.captured === 'newer' ? form.heatPumpInstalledOn : ''
  if (heatPump && form.captured === 'newer') {
    if (installedText === '') return { error: 'Bitte geben Sie das Einbaudatum der Wärmepumpe an.' }
    if (installedText <= HEAT_PUMP_CAPTURED_BY) {
      return { error: `Eine Wärmepumpe, die bis zum ${NEWER_THAN} eingebaut wurde, beantworten Sie mit „Ja“ oder „Nein“.` }
    }
  }
  return {
    setUpSelf: who === 'self',
    body: {
      energy,
      supply: 'central',
      // „Ich selbst“: zunächst „Niemand“; Schritt 7 stellt um (Abweichung 21).
      method: who === 'homeowners' ? 'service' : who === 'self' ? 'manual' : who,
      source: who === 'homeowners' ? 'homeowners' : 'building',
      devicesRemote: form.remote,
      devicesInstalledAfter2021: form.installedAfter,
      capturedOnOct2024: heatPump && (form.captured === 'yes' || form.captured === 'no') ? form.captured === 'yes' : null,
      captureInstalledOn: heatPump && form.captured === 'no' && form.captureInstalledOn !== '' ? form.captureInstalledOn : null,
      warmRentAverageCents: average,
      heatPumpInstalledOn: installedText === '' ? null : installedText,
      units: unitList,
      newDevicesInstall: asksNewInstall(form) && form.newInstall !== '' ? form.newInstall : null,
      name,
      buildingWith,
      ...(form.takesOverStock === '' ? {} : { takesOverStock: form.takesOverStock === 'yes' }),
      ...(asksGeneration(form) ? { heatGeneration: form.generation === '' ? null : form.generation } : {}),
      ...(heatPump ? { heatPumpMajority: form.majority === '' ? null : form.majority } : {}),
    },
    adjust,
  }
}

// ---------- Kessel getauscht (Heizung PR 9) ----------

export type SwapForm = { date: string; energy: HeatingEnergy | ''; name: string; previousName: string; takesOverStock: 'yes' | 'no'; meterValues?: Record<string, string> }
export type SwapBody = { date: string; energy: HeatingEnergy; name: string; previousName: string; takesOverStock?: boolean; meterReadings?: { meterId: string; value: number }[] }

// Bei der eigenen Heizkostenabrechnung fragt der Tausch die Stände der Zähler der Anlage (Wärme am
// Warmwasserspeicher, Gesamtwärme) am letzten Tag der bisherigen ab (Durchsicht von #239, I3): Mit ihnen
// grenzt Mietfuchs die Wärme beider Anlagen ab. Die Zähler bleiben, wo sie sind.
export const swapMetersOf = (plant: Pick<HeatingPlant, 'id' | 'method' | 'replacesPlantId'>, plants: readonly Pick<HeatingPlant, 'id' | 'replacesPlantId'>[], meters: readonly Meter[]): Meter[] => {
  if (plant.method !== 'self') return []
  const root = lineRoot(plant, plants)
  const line = new Set([plant.id, ...plants.filter((p) => lineRoot(p, plants) === root).map((p) => p.id)])
  return meters.filter((m) => m.heatingPlantId !== null && m.heatingPlantId !== undefined && line.has(m.heatingPlantId) && !!m.heatingRole)
}

// Bei demselben Vorratsbrennstoff fragt der Tausch, ob die neue Anlage den Brennstoff weiter verheizt.
export const asksTakeOver = (form: Pick<SwapForm, 'energy'>, previous: Pick<HeatingPlant, 'energy'>): boolean =>
  form.energy === previous.energy && isStockEnergy(previous.energy)

// Getauscht wird eine laufende zentrale Anlage; bei getrennter Heizkostenabrechnung kommt das später.
export const canSwap = (p: Pick<HeatingPlant, 'endsOn' | 'supply' | 'separateSpans'>): boolean =>
  p.endsOn === null && p.supply === 'central' && p.separateSpans.length === 0

// Vorbelegung „Ja“: Wer den Kessel tauscht, verheizt den Brennstoff im Tank meist weiter.
export const emptySwapForm = (p: Pick<HeatingPlant, 'name'>): SwapForm => ({ date: '', energy: '', name: '', previousName: p.name, takesOverStock: 'yes' })

export function swapBody(form: SwapForm, previous: Pick<HeatingPlant, 'energy'>, plantMeters: readonly Pick<Meter, 'id' | 'name'>[] = []): { body: SwapBody } | { error: string } {
  if (form.date === '') return { error: 'Bitte wählen Sie den Tag, an dem die neue Heizung in Betrieb ging.' }
  if (form.energy === '') return { error: 'Womit heizt die neue Heizung?' }
  const meterReadings: { meterId: string; value: number }[] = []
  for (const m of plantMeters) {
    const text = (form.meterValues?.[m.id] ?? '').trim()
    if (text === '') continue
    const value = parseMeterValue(text)
    if (value === null) return { error: `Der Stand für „${m.name}“ ist keine Zahl.` }
    meterReadings.push({ meterId: m.id, value })
  }
  const body: SwapBody = { date: form.date, energy: form.energy, name: form.name.trim(), previousName: form.previousName.trim(), ...(meterReadings.length > 0 ? { meterReadings } : {}) }
  return { body: asksTakeOver(form, previous) ? { ...body, takesOverStock: form.takesOverStock === 'yes' } : body }
}

// Sichtprüfung E9: Warum eine Einheit beim Einrichten nicht angehakt ist.
export const connectionNote = (u: Pick<Unit, 'noConnection'>): string | null =>
  (u.noConnection ?? []).includes('waerme') ? 'ohne Wärmeanschluss laut Wohnungsdaten' : null

// Die Zeilen der Karte, wenn eine Anlage eingerichtet ist. Ohne Liste versorgt die Anlage jede
// Einheit mit Wärmeanschluss (`servesUnit`); die übrigen nennt die Zeile, sonst hieße es „alle“.
export function heatingSummary(plant: HeatingPlant, units: readonly Pick<Unit, 'id' | 'name' | 'noConnection'>[], plants: readonly HeatingPlant[] = []): string[] {
  const energyLabel = ENERGY_OPTIONS.find((o) => o.value === plant.energy)?.label ?? plant.energy
  const perUnit = plant.supply === 'perUnit'
  const energy = perUnit ? `${energyLabel}, Etagenheizung je Wohnung (Vertrag bei Ihnen)` : energyLabel
  const who = perUnit
    ? 'Direktzuordnung der Rechnung jeder Wohnung'
    : plant.source === 'homeowners'
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
  // Kesseltausch (Heizung PR 9): Stilllegung und Nachfolge.
  const successor = plants.find((p) => p.replacesPlantId === plant.id)
  const predecessor = plants.find((p) => p.id === plant.replacesPlantId)
  const swap = [
    ...(plant.endsOn ? [`Außer Betrieb seit ${germanDate(dayAfter(plant.endsOn))}${successor ? `, ersetzt durch „${successor.name}“` : ''}`] : []),
    ...(predecessor?.endsOn ? [`In Betrieb seit ${germanDate(dayAfter(predecessor.endsOn))}, ersetzt „${predecessor.name}“`] : []),
  ]
  return [
    ...(plant.name.trim() ? [`Name: ${plant.name.trim()}`] : []),
    ...lines,
    ...(asksRemote(plant.method) && !perUnit ? [`Aus der Ferne ablesbar: ${remote}`] : []),
    ...swap,
  ]
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

// ---------- Warmwasser bei eigener Abrechnung (Heizung PR 11, Entwurf 8.3) ----------

// An der Anlage gefragt (Durchsicht von #240, Recht-I2): bei einer Wärmepumpe immer, sonst bei eigener
// Abrechnung, denn die Antwort entscheidet über Formel und Gesamtwärme beim Warmwasseranteil.
export const asksGeneration = (form: Pick<HeatingForm, 'energy' | 'who'>): boolean =>
  form.energy !== '' && form.energy !== 'perUnit' && (form.energy === 'heatPump' || form.who === 'self')
export const GENERATION_QUESTION = 'Erzeugt diese Heizung die Wärme allein?'
// § 11 Abs. 1 Nr. 3 Buchst. a HeizkostenV in der Fassung bis zum Tag vor diesem: Wärmepumpen waren ausgenommen.
const EXEMPTION_ENDS = hkvRenewableExemption.versions.find((v) => v.validFrom !== undefined)?.validFrom ?? ''
export const MAJORITY_QUESTION = `Liefert die Wärmepumpe mehr als die Hälfte der Wärme des Gebäudes? (Wichtig für Abrechnungszeiträume, die vor dem ${germanDate(EXEMPTION_ENDS)} beginnen.)`
export const MAJORITY_EXPLAINED = 'Bis dahin galten die Vorschriften der Heizkostenverordnung zur Verteilung nicht für Gebäude, die überwiegend mit Wärme aus Wärmepumpen versorgt werden (§ 11 Abs. 1 Nr. 3 Buchst. a HeizkostenV in der alten Fassung). Ohne Antwort rechnet Mietfuchs für diese Zeiträume ohne Kürzungsbeträge und nennt beide Folgen.'
export const MAJORITY_OPTIONS: readonly { value: HeatPumpMajority | ''; label: string }[] = [
  { value: '', label: 'bitte wählen' },
  { value: 'yes', label: 'Ja, mehr als die Hälfte' },
  { value: 'no', label: 'Nein' },
  { value: 'unknown', label: 'Weiß ich nicht' },
]

// Bei eigener Abrechnung rechnet Mietfuchs selbst; „keine Angabe“ gibt es dort nicht, die Vorgabe ist
// der Wärmezähler (§ 9 Abs. 2 Satz 1 HeizkostenV).
export const SELF_HOT_WATER_OPTIONS: readonly { value: HotWaterChoice; label: string }[] = HOT_WATER_OPTIONS.filter((o) => o.value !== '')

// Ob die Anlage die Wärme allein erzeugt (§ 9 Abs. 1 Satz 5, Abs. 2 Satz 6 Nr. 3 HeizkostenV). Ohne
// Vorgabe: Eine falsche Vorgabe ergäbe still einen falschen Anteil (Abweichung 5 des Plans PR 11).
export const HEAT_GENERATION_OPTIONS: readonly { value: HeatGeneration | ''; label: string }[] = [
  { value: '', label: 'bitte wählen' },
  { value: 'single', label: 'allein (ein Kessel, eine Wärmepumpe oder Fernwärme)' },
  { value: 'mixed', label: 'mit einem weiteren Erzeuger (Solaranlage, Heizstab, zweiter Kessel)' },
]

// Eine Zahl deutsch oder technisch geschrieben; leer heißt keine Angabe, `undefined` keine Zahl.
// Deutsche Tausenderpunkte wie bei Beträgen (`parseNumberDe`, Durchsicht von #240, M3).
export function parseDecimal(text: string): number | null | undefined {
  if (text.trim() === '') return null
  return parseNumberDe(text) ?? undefined
}
export const numberText = (n: number | null): string => (n === null ? '' : n.toLocaleString('de-DE', { maximumFractionDigits: 3, useGrouping: false }))

export type FormulaForm = { volume: string; temp: string }
export const formulaFormOf = (hw: HeatingPeriodView['hotWater']): FormulaForm => ({ volume: numberText(hw.dhwVolumeM3), temp: numberText(hw.dhwTempC) })

// Der Teil des Rumpfs, den nur die Volumenformel braucht.
export function selfFormulaBody(choice: HotWaterChoice, form: FormulaForm): { body: { dhwVolumeM3?: number | null; dhwTempC?: number | null } } | { error: string } {
  if (choice !== 'volumeFormula') return { body: {} }
  const volume = parseDecimal(form.volume)
  if (volume === undefined) return { error: 'Das Volumen des Warmwassers ist keine Zahl.' }
  const temp = parseDecimal(form.temp)
  if (temp === undefined) return { error: 'Die Temperatur des Warmwassers ist keine Zahl.' }
  return { body: { dhwVolumeM3: volume, dhwTempC: temp } }
}

// Die Folge einer fehlenden Bestätigung (Durchsicht von #240, M6), mit der Kürzung aus dem Register.
export const unconfirmedConsequence = (): string =>
  `Ohne diese Bestätigung nennt die Abrechnung, dass jeder Mieter seinen Anteil an den Heiz- und Warmwasserkosten um ${CUT} % kürzen darf (§ 12 Abs. 1 Satz 1 HeizkostenV).`
// Die Beschriftung des Volumens: bei einem Kesseltausch das der Laufzeit der Anlage (Durchsicht von #240, Geld-I1).
export const volumeLabel = (running: { from: string; to: string } | null, fmt: (iso: string) => string): string =>
  running ? `Warmwasser in der Laufzeit dieser Anlage (${fmt(running.from)}–${fmt(running.to)}, m³, gemessen)` : 'Warmwasser in der Heizperiode (m³, gemessen)'

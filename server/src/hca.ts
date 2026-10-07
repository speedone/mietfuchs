// Heizkostenverteiler und Werte eines Ablesedienstes (Heizung PR 12, Entwurf 8.1), als reine Funktionen.
//
// § 5 Abs. 1 Satz 1 HeizkostenV lässt Wärmezähler und Heizkostenverteiler gleichrangig zu: „Zur Erfassung
// des anteiligen Wärmeverbrauchs sind Wärmezähler oder Heizkostenverteiler … zu verwenden.“ Die eigene
// Heizkostenabrechnung (PR 10) rechnet mit dem Grenzmodell: je Zähler eine Ablesung an jeder Grenze
// (Beginn, Wechsel, Ende), Verbrauch ist die Differenz zweier wirklicher Ablesungen (`measuredBetween`),
// summiert je Wohnung in `planSelf`. Diese Datei bringt die beiden neuen Erfassungen in diese Gestalt:
//
// - Heizkostenverteiler sind Zähler vom Typ `hkv`; jeder trägt seinen Faktor (`meterFactor`): bei der
//   Einheitsskala den Bewertungsfaktor des Heizkörpers, bei der Produktskala 1. `planSelf` multipliziert
//   die Differenz damit. Der Stichtagswert ist eine Ablesung mit `replacement` (Entwurf 8.1).
// - Werte eines Ablesedienstes werden je Wohnung ein gedachter Zähler (`serviceMeters`) mit kumulierten
//   Ständen: 0 am Tag vor dem Beginn der ersten Zeile und die Summe am Ende jeder Zeile. Eine Lücke
//   zwischen zwei Zeilen ergibt keinen Stand an ihrem Beginn; eine Grenze darin findet keine eigene
//   Ablesung, und PR 10 nimmt die nächste in ihrer Zelle wie abgelesen (mit Hinweis) oder geht den Weg der
//   fehlenden Zwischenablesung. Nichts wird interpoliert (Entwurf 8.4).
//
// Skalen und Faktoren nach [M] Haufe HeizKV § 5.3 und Berliner Mieterverein (übernommen);
// ⟨Norm offen: VDI 2077; DIN EN 834⟩ (Entwurf 15.3). Ob ein Faktor stimmt, prüft Mietfuchs nicht
// (Entwurf 16). Diese Datei steht in `ENGINE_FILES` des Wächters (law-literals.test.ts).
import type { CaptureMethod, HcaDeviceLine, HcaScale, HeatingServiceValue, MeterType } from '../../shared/types.ts'
import { dayBefore, germanDate, type Period } from '../../shared/law/register.ts'
import { andList } from '../../shared/wording.ts'
import type { SelfMeter, SelfPlan, SelfReading } from './heating.ts'
import { lineRoot } from '../../shared/heatingPeriod.ts'

export type HcaMeter = {
  id: string
  unitId: string | null
  type: MeterType
  name?: string
  hcaScale?: HcaScale | null
  ratingFactor?: number | null
  heatingPlantId?: string | null
}

const byFrom = <T extends { from: string }>(a: T, b: T): number => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0)

// ---------- Erfassung je Heizperiode ----------

// `captureOf` und `hotWaterOf` stehen in shared/heatingPeriod.ts, weil die Oberfläche dieselbe Frage stellt
// (Durchsicht von #241, Runde 2, H1).
export { captureOf, hotWaterOf } from '../../shared/heatingPeriod.ts'

// ---------- Faktor ----------

export function ratingOf(m: HcaMeter): { ok: true; factor: number; scale: HcaScale } | { ok: false; missing: 'scale' | 'factor' } {
  const scale = m.hcaScale ?? null
  if (scale === null) return { ok: false, missing: 'scale' }
  if (scale === 'product') return { ok: true, factor: 1, scale }
  const factor = m.ratingFactor ?? null
  return factor !== null && factor > 0 ? { ok: true, factor, scale } : { ok: false, missing: 'factor' }
}

// Der Faktor am Zähler für `planSelf` (`SelfMeter.factor`): beim Heizkostenverteiler der der Skala, sonst
// 1. Fehlt Skala oder Faktor, ebenfalls 1; die Anlage wird dann nicht verteilt (`missingRatings`,
// `heating.hca-factor-missing`), die Zahl also nie benutzt.
export function meterFactor(m: HcaMeter): number {
  if (m.type !== 'hkv') return 1
  const r = ratingOf(m)
  return r.ok ? r.factor : 1
}

// Zähler, die an einer Wohnung der Anlage die Raumwärme erfassen: Wärmezähler und
// Heizkostenverteiler. Warmwasserzähler erfassen das Warmwasser (§ 5 Abs. 1 Satz 1, eigene
// Erfassung), Zähler mit `heatingPlantId` gehören zur Anlage selbst (PR 4).
const isRoomHeat = (m: HcaMeter, ids: ReadonlySet<string>): boolean =>
  m.unitId !== null && ids.has(m.unitId) && (m.heatingPlantId ?? null) === null && (m.type === 'waerme' || m.type === 'hkv')

// Zählt ein Gerät in der Heizperiode (Durchsicht von #241, C1)? Nur wenn seine Ablesungen sie überdecken:
// die erste vor ihrem Ende, die letzte nach dem Tag vor ihrem Beginn. Ein ausgebautes Gerät mit seiner
// letzten Ablesung am Stichtag und ein neues mit seiner ersten dort zählen so je nur in ihrer Heizperiode,
// und kein Gerät muss dafür samt seinen Ablesungen gelöscht werden.
export function coversPeriod(meterId: string, readings: readonly { meterId: string; date: string }[], h: Period): boolean {
  const dates = readings.filter((r) => r.meterId === meterId).map((r) => r.date)
  if (dates.length === 0) return false
  const first = dates.reduce((a, d) => (d < a ? d : a))
  const last = dates.reduce((a, d) => (d > a ? d : a))
  return first < h.to && last > dayBefore(h.from)
}

// Decken die Ablesungen eines Geräts die Heizperiode ganz ab (Durchsicht von #241, N1)? Die erste am Tag vor
// ihrem Beginn oder früher, die letzte an ihrem Ende oder später.
export function spansPeriod(meterId: string, readings: readonly { meterId: string; date: string }[], h: Period): boolean {
  const dates = readings.filter((r) => r.meterId === meterId).map((r) => r.date)
  if (dates.length === 0) return false
  const first = dates.reduce((a, d) => (d < a ? d : a))
  const last = dates.reduce((a, d) => (d > a ? d : a))
  return first <= dayBefore(h.from) && last >= h.to
}
type Reads = readonly { meterId: string; date: string }[]

// ---------- Ablesedienst ----------

export const SERVICE_METER_PREFIX = { heat: 'ablesedienst-heizung:', water: 'ablesedienst-warmwasser:' } as const
export const isServiceMeter = (id: string): boolean => id.startsWith(SERVICE_METER_PREFIX.heat) || id.startsWith(SERVICE_METER_PREFIX.water)

// Je Wohnung mit Zeilen ein gedachter Zähler (`ablesedienst-heizung:<Wohnung>` bzw.
// `ablesedienst-warmwasser:<Wohnung>`, Faktor 1) und seine kumulierten Stände. Beim Warmwasser `null`,
// wenn keine Zeile einen Wert dafür hat: Dann zählen die Warmwasserzähler (Abweichung 3).
export function serviceMeters(rows: readonly HeatingServiceValue[], units: readonly { id: string; name: string }[], part: 'heat' | 'water'): { meters: SelfMeter[]; readings: SelfReading[] } | null {
  if (part === 'water' && rows.every((r) => r.waterValue === null)) return null
  const meters: SelfMeter[] = []
  const readings: SelfReading[] = []
  for (const u of units) {
    const own = rows.filter((r) => r.unitId === u.id).slice().sort(byFrom)
    const first = own[0]
    if (!first) continue
    const id = `${SERVICE_METER_PREFIX[part]}${u.id}`
    meters.push({ id, name: `Ablesedienst ${u.name}`, unitId: u.id, type: part === 'heat' ? 'waerme' : 'warmwasser', factor: 1 })
    readings.push({ meterId: id, date: dayBefore(first.from), value: 0 })
    let sum = 0
    for (const r of own) {
      sum += part === 'heat' ? r.heatValue : (r.waterValue ?? 0)
      readings.push({ meterId: id, date: r.to, value: sum })
    }
  }
  return { meters, readings }
}

// Die Werte des Ablesedienstes einer Heizperiode für eine Anlage, über ihre Linie (Durchsicht von #241, I1):
// Nach einem Kesseltausch messen die Geräte der Wohnungen weiter, und der Dienst liefert seine Werte einmal
// für die Heizperiode. Die eigenen Zeilen gehen vor; ohne sie gelten die einer anderen Anlage der Linie
// (die erste in der Reihenfolge der Anlagen, die welche hat).
type LinePlant = { id: string; replacesPlantId?: string | null }
export function lineServiceRows(rows: readonly HeatingServiceValue[], plants: readonly LinePlant[], plantId: string, key: string): HeatingServiceValue[] {
  const inPeriod = rows.filter((v) => String(v.period) === key)
  const own = inPeriod.filter((v) => v.plantId === plantId)
  if (own.length > 0) return own
  const plant = plants.find((p) => p.id === plantId)
  if (!plant) return []
  const root = lineRoot(plant, plants)
  for (const other of plants) {
    if (other.id === plantId || lineRoot(other, plants) !== root) continue
    const theirs = inPeriod.filter((v) => v.plantId === other.id)
    if (theirs.length > 0) return theirs
  }
  return []
}

// Nennt der Dienst die Heizung in einer Heizperiode teils in Einheiten, teils in kWh, sind das Werte
// verschiedener Geräte (Heizkostenverteiler und Wärmezähler): § 5 Abs. 7, wie bei eigenen Geräten
// (Durchsicht von #241, Recht-I4). Die Wohnungen je Art, sonst `null`.
export function serviceUnitsMixed(rows: readonly HeatingServiceValue[]): MixedCapture | null {
  const of = (u: 'units' | 'kWh') => [...new Set(rows.filter((r) => r.heatUnit === u).map((r) => r.unitId))]
  const hcaUnits = of('units')
  const heatMeterUnits = of('kWh')
  return hcaUnits.length > 0 && heatMeterUnits.length > 0 ? { heatMeterUnits, hcaUnits } : null
}
// Die Einheit der Heizung beim Ablesedienst: kWh nur, wenn er alle Werte in kWh nennt.
export const serviceHeatUnit = (rows: readonly HeatingServiceValue[]): 'kWh' | 'Einheiten' =>
  rows.length > 0 && rows.every((r) => r.heatUnit === 'kWh') ? 'kWh' : 'Einheiten'

// ---------- Ausweis je Gerät ----------

// Je Heizkostenverteiler die Einheiten der Heizperiode für den Ausweis (Entwurf 8.8: „bei HKV je Gerät;
// bei der Einheitsskala muss der Faktor in der Abrechnung stehen“; Praxis der Messdienste nach Berliner
// Mieterverein, keine Norm, Durchsicht von #241, Recht-I3). Die abgelesenen Einheiten kommen aus
// dem Plan (`SelfUnitPlan.measured`), also aus denselben Differenzen, mit denen verteilt wird; eine
// zweite Lesart der Ablesungen könnte neben einer Ablesung, die einige Tage neben dem Stichtag liegt,
// andere Zahlen zeigen als die Rechnung (Abweichung vom Plan, Ruling).
export function deviceLines(capture: CaptureMethod, plan: Pick<SelfPlan, 'units'>, meters: readonly HcaMeter[]): HcaDeviceLine[] {
  if (capture !== 'hca') return []
  const byId = new Map(meters.map((m) => [m.id, m]))
  return plan.units.flatMap((u) => u.measured.flatMap((x) => {
    const m = byId.get(x.meterId)
    if (!m || m.type !== 'hkv' || x.pot !== 'heating') return []
    const rating = ratingOf(m)
    if (!rating.ok) return []
    return [{ unitId: u.unit.id, meterId: m.id, name: m.name ?? '', scale: rating.scale, factor: rating.factor, raw: x.raw, rated: x.raw * rating.factor, userKeys: x.userKeys, from: x.from, to: x.to }]
  }))
}

// ---------- Was die Verteilung verhindert oder einen Hinweis braucht ----------

// `switched`: Wohnungen, deren Gerät der eingestellten Art die Heizperiode nur zum Teil abdeckt, neben einem
// der anderen Art (Wechsel mitten in der Heizperiode).
export type MixedCapture = { heatMeterUnits: string[]; hcaUnits: string[]; switched?: string[] }

// § 5 Abs. 7 Satz 1 HeizkostenV: „Wird der Verbrauch der von einer Anlage … versorgten Nutzer nicht mit
// gleichen Ausstattungen erfasst, so sind zunächst durch Vorerfassung vom Gesamtverbrauch die Anteile der
// Gruppen von Nutzern zu erfassen …“. Gemischt heißt hier: Wärmezähler und Heizkostenverteiler an
// Wohnungen derselben Anlage, oder ein Gerät, das nicht zur eingestellten Erfassung passt (Abweichung 1).
// Beim Ablesedienst liefert der Dienst die Werte.
//
// Gemischt ist eine Wohnung, deren Raumwärme in der Heizperiode ein Gerät der anderen Art erfasst und
// kein Gerät der eingestellten Art über die ganze Heizperiode (Durchsicht von #241, C1 und N1): Deckt ein
// Gerät der eingestellten Art sie ganz ab (`spansPeriod`), wird die Wohnung damit erfasst, und ein weiteres
// Gerät daneben ändert nichts. Deckt es sie nur zum Teil ab, etwa nach einem Wechsel vom Wärmezähler zum
// Heizkostenverteiler am 30.06., fiele der Verbrauch des alten Geräts sonst still weg. Das andere Gerät
// zählt, wenn seine Ablesungen die Heizperiode überdecken (`coversPeriod`).
export function mixedCapture(capture: CaptureMethod, unitIds: readonly string[], meters: readonly HcaMeter[], readings: Reads, h: Period): MixedCapture | null {
  if (capture === 'serviceValues') return null
  const ids = new Set(unitIds)
  const room = meters.filter((m) => isRoomHeat(m, ids) && coversPeriod(m.id, readings, h))
  const own: 'waerme' | 'hkv' = capture === 'hca' ? 'hkv' : 'waerme'
  const other: 'waerme' | 'hkv' = own === 'hkv' ? 'waerme' : 'hkv'
  const has = (unitId: string, type: 'waerme' | 'hkv') => room.some((m) => m.unitId === unitId && m.type === type)
  const hasFull = (unitId: string) => room.some((m) => m.unitId === unitId && m.type === own && spansPeriod(m.id, readings, h))
  const foreign = [...ids].filter((u) => !hasFull(u) && has(u, other))
  if (foreign.length === 0) return null
  const switched = foreign.filter((u) => has(u, own))
  const ownUnits = [...ids].filter((u) => has(u, own) && !switched.includes(u))
  const lists = capture === 'hca' ? { heatMeterUnits: foreign, hcaUnits: ownUnits } : { heatMeterUnits: ownUnits, hcaUnits: foreign }
  return switched.length > 0 ? { ...lists, switched } : lists
}

// Heizung PR 13: Eine Wohnung mit Gerätewechsel mitten in der Heizperiode, deren Verbrauch der Heizung nach
// § 9a geschätzt ist, zählt nicht mehr als gemischt; die Schätzung in der Einheit der eingestellten Erfassung
// deckt die Zeit mit dem anderen Gerät. Bleibt keine gemischte Wohnung, `null`.
export function withoutEstimatedSwitches(m: MixedCapture, capture: 'heatMeter' | 'hca', estimated: ReadonlySet<string>): MixedCapture | null {
  const resolved = (m.switched ?? []).filter((u) => estimated.has(u))
  if (resolved.length === 0) return m
  const foreignKey = capture === 'hca' ? 'heatMeterUnits' : 'hcaUnits'
  const ownKey = capture === 'hca' ? 'hcaUnits' : 'heatMeterUnits'
  const foreign = m[foreignKey].filter((u) => !resolved.includes(u))
  if (foreign.length === 0) return null
  const switched = (m.switched ?? []).filter((u) => !resolved.includes(u))
  const lists = { [foreignKey]: foreign, [ownKey]: [...m[ownKey], ...resolved] } as Pick<MixedCapture, 'heatMeterUnits' | 'hcaUnits'>
  return switched.length > 0 ? { ...lists, switched } : lists
}

export type MissingRating = { meterId: string; name: string; unitId: string; missing: 'scale' | 'factor' }

export function missingRatings(capture: CaptureMethod, unitIds: readonly string[], meters: readonly HcaMeter[], readings: Reads, h: Period): MissingRating[] {
  if (capture !== 'hca') return []
  const ids = new Set(unitIds)
  return meters
    .filter((m) => isRoomHeat(m, ids) && m.type === 'hkv' && coversPeriod(m.id, readings, h))
    .flatMap((m) => {
      const r = ratingOf(m)
      return r.ok ? [] : [{ meterId: m.id, name: m.name ?? '', unitId: m.unitId ?? '', missing: r.missing }]
    })
}

export type DeviceCutoff = { meterId: string; name: string; unitId: string; date: string }

// Ein Heizkostenverteiler, der innerhalb der Heizperiode auf null zurücksetzt (Ablesung mit
// `replacement` und Wert 0). Am Tag vor dem Beginn oder am letzten Tag ist der Stichtag des Geräts der der
// Heizperiode (Abweichung 2).
export function deviceCutoffs(capture: CaptureMethod, meters: readonly HcaMeter[], readings: readonly SelfReading[], unitIds: readonly string[], h: Period): DeviceCutoff[] {
  if (capture !== 'hca') return []
  const ids = new Set(unitIds)
  return meters
    .filter((m) => isRoomHeat(m, ids) && m.type === 'hkv')
    .flatMap((m) =>
      readings
        .filter((r) => r.meterId === m.id && r.replacement === true && r.value === 0 && r.date >= h.from && r.date < h.to)
        .map((r) => ({ meterId: m.id, name: m.name ?? '', unitId: m.unitId ?? '', date: r.date })))
}

// ---------- Sätze ----------

const CAPTURE_WORDS: Record<CaptureMethod, string> = {
  heatMeter: 'Wärmezählern',
  hca: 'Heizkostenverteilern',
  serviceValues: 'Werten eines Ablesedienstes',
}

// Ohne Ort und ohne Folge: `computeSettlement` setzt beides wie bei jedem Grund, der die Anlage nicht
// verteilbar macht, davor bzw. dahinter (PR 10: „Bis dahin verteilt Mietfuchs …“).
export function mixedCaptureText(capture: CaptureMethod, m: MixedCapture, nameOf: (unitId: string) => string): string {
  if (capture === 'serviceValues') {
    return `Der Ablesedienst nennt die Heizung bei ${andList(m.hcaUnits.map(nameOf))} in Einheiten (Heizkostenverteiler), bei ${andList(m.heatMeterUnits.map(nameOf))} in kWh (Wärmezähler). ` +
      'Wird der Verbrauch nicht mit gleichen Geräten erfasst, ist nach § 5 Abs. 7 HeizkostenV zuerst der Anteil jeder Gruppe am Gesamtverbrauch vorab zu erfassen (Vorerfassung). Das rechnet Mietfuchs noch nicht. ' +
      'Dafür braucht es je Gruppe von Wohnungen mit gleichen Geräten einen eigenen Wärmezähler. Lassen Sie diese Heizkosten vom Messdienst abrechnen und übernehmen Sie dessen Beträge als Einzelbeträge.'
  }
  const parts = [
    ...(m.heatMeterUnits.length > 0 ? [`Wärmezähler bei ${andList(m.heatMeterUnits.map(nameOf))}`] : []),
    ...(m.hcaUnits.length > 0 ? [`Heizkostenverteiler bei ${andList(m.hcaUnits.map(nameOf))}`] : []),
  ]
  const switched = m.switched ?? []
  // N1: Ein Wechsel mitten in der Heizperiode ist kein Dauerzustand; der Weg ist ein anderer als bei
  // gemischten Geräten.
  const switchedText = switched.length === 0 ? '' :
    `Bei ${andList(switched.map(nameOf))} wechselt das Gerät innerhalb der Heizperiode: Wärmezähler und Heizkostenverteiler haben Ablesungen nur für einen Teil davon. ` +
    'Mietfuchs lässt den Verbrauch des einen Geräts deshalb nicht weg. Liegt der Wechsel am Tag vor dem Beginn der Heizperiode (bei einer Heizperiode im Kalenderjahr am 31.12.), braucht es nur den Stand des neuen Geräts an diesem Tag. ' +
    'Sonst ist der Verbrauch der Zeit mit dem anderen Gerät in der Einheit der eingestellten Erfassung zu ermitteln, und wenn das nicht ordnungsgemäß geht, nach § 9a HeizkostenV zu schätzen: ' +
    `Tragen Sie dann auf der Seite Heizkosten unter „Schätzung (§ 9a)“ den Verbrauch der ganzen Heizperiode für ${switched.length === 1 ? 'diese Wohnung' : 'jede dieser Wohnungen'} in ${capture === 'hca' ? 'Einheiten' : 'kWh'} ein. `
  // #218: Die Vorerfassung nach Nutzergruppen kommt mit einer eigenen Erweiterung.
  // Hängt das andere Gerät nur an Wohnungen mit Wechsel, ist die Vorerfassung nicht der Weg.
  const lasting = (capture === 'hca' ? m.heatMeterUnits : m.hcaUnits).some((u) => !switched.includes(u))
  return `Eingestellt ist die Erfassung mit ${CAPTURE_WORDS[capture]}, an den Wohnungen hängen aber ${andList(parts)}. ${switchedText}` +
    (lasting
      ? 'Wird der Verbrauch nicht mit gleichen Geräten erfasst, ist nach § 5 Abs. 7 HeizkostenV zuerst der Anteil jeder Gruppe am Gesamtverbrauch vorab zu erfassen (Vorerfassung). Das rechnet Mietfuchs noch nicht. ' +
        'Dafür braucht es je Gruppe von Wohnungen mit gleichen Geräten einen eigenen Wärmezähler. '
      : '') +
    'Lassen Sie diese Heizkosten von einem Messdienst abrechnen und übernehmen Sie dessen Beträge als Einzelbeträge. ' +
    'Ein ausgebautes Gerät zählt nicht mehr mit, sobald seine letzte Ablesung am Tag vor der Heizperiode oder früher liegt; löschen Sie es nicht, seine Ablesungen gehören zu früheren Abrechnungen.'
}

export function missingRatingsText(list: readonly MissingRating[], nameOf: (unitId: string) => string): string {
  const items = list.map((x) => `„${x.name || 'ohne Namen'}“ (${nameOf(x.unitId)}): ${x.missing === 'scale' ? 'die Skala' : 'der Bewertungsfaktor'}`)
  return `Bei ${list.length === 1 ? 'diesem Heizkostenverteiler' : 'diesen Heizkostenverteilern'} fehlt ${andList(items)}. ` +
    'Bei der Einheitsskala wird der Ablesewert mit dem Bewertungsfaktor des Heizkörpers malgenommen; die Abrechnung nennt den Faktor, damit der Mieter sie nachprüfen kann, so machen es die Messdienste. Bei der Produktskala ist er eingerechnet. ' +
    'Skala und Faktor stehen in der Geräteliste des Messdienstes oder in den Unterlagen des Herstellers; tragen Sie sie auf der Seite Zähler ein. Ein Gerät mit anderem Faktor, etwa nach einem Tausch, legen Sie als neuen Zähler an.'
}

export function deviceCutoffText(where: string, c: DeviceCutoff, h: Period, nameOf: (unitId: string) => string): string {
  return `${where}: Der Heizkostenverteiler „${c.name || 'ohne Namen'}“ (${nameOf(c.unitId)}) hat am ${germanDate(c.date)} auf null zurückgesetzt; die Heizperiode beginnt aber am ${germanDate(h.from)}. ` +
    'Mietfuchs rechnet mit den abgelesenen Werten, wie sie sind, und schätzt nichts dazwischen; für den Verbrauch der Heizperiode braucht es deshalb Werte zu ihrem Beginn und Ende. ' +
    'Setzt ein Gerät am Tag vor dem Beginn der Heizperiode zurück (bei einer Heizperiode im Kalenderjahr am 31.12.), passt sein Stichtag. Lassen Sie den Stichtag der Geräte so stellen, oder tragen Sie zu Beginn und Ende die Werte laut Gerätespeicher ein.'
}

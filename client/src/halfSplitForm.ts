// Die Entscheidungslogik der Karte „Heizung nach § 43 GModG“ (Heizung PR 18, #215), ohne DOM prüfbar wie
// costForm.ts; die Komponente rendert nur.
import type { HeatingEnergy, HeatingPlant, Tenancy } from './types'
import { gmodgHeating43 } from '../../shared/law/gmodg.ts'
import { co2HalfSplit, co2HalfSplitEmergency, co2HalfSplitNewBuildings, halfSplitBioFirstDay, halfSplitFirstDay } from '../../shared/law/co2kostaufg.ts'
import { germanDate, LAW_AS_OF, valueAt } from '../../shared/law/register.ts'

export type TriState = 'unknown' | 'yes' | 'no'
export const TRI_OPTIONS: { value: TriState; label: string }[] = [
  { value: 'unknown', label: 'Weiß ich nicht' },
  { value: 'yes', label: 'Ja' },
  { value: 'no', label: 'Nein' },
]
export type HalfSplitBody = Pick<HeatingPlant, 'gmodg43InstalledOn' | 'emergencyInstall' | 'emergencyPriorDuty' | 'newBuildingFirstUse' | 'buildingApplicationBefore20260513'>
export type HalfSplitForm = { installedOn: string; emergency: boolean; priorDuty: TriState; newBuilding: boolean; firstUse: string; applicationBefore: TriState }

const H43 = valueAt(gmodgHeating43, LAW_AS_OF)
const NB = valueAt(co2HalfSplitNewBuildings, LAW_AS_OF)
export const INSTALLED_AFTER = germanDate(H43.installedAfter)
export const APPLICATION_FROM = germanDate(NB.applicationFrom)
export const FIRST_USE_UNTIL = germanDate(NB.firstUseUntil)
// Die Jahre der ersten Teilung und des ersten Pflichtanteils, für Überschrift und Erläuterung.
export const HALF_SPLIT_YEAR = halfSplitFirstDay().slice(0, 4)
const BIO_YEAR = halfSplitBioFirstDay().slice(0, 4)
// Was geteilt wird, mit Stichtagen und der Grenze beim Biobrennstoff aus dem Register (Durchsicht K1).
const BIO_CAP = (valueAt(co2HalfSplit, halfSplitBioFirstDay()).bioCapPermille ?? 0) / 10
const EMERGENCY_MONTHS = valueAt(co2HalfSplitEmergency, LAW_AS_OF).windowMonths
export const HALF_SPLIT_WHAT = `Dann tragen Sie ab dem ${germanDate(halfSplitFirstDay())} die Hälfte der CO₂-Kosten und, nur bei Gas, der Netzentgelte, ab dem ${germanDate(halfSplitBioFirstDay())} auch die Hälfte der Kosten des Pflichtanteils an Biobrennstoff, höchstens für ${BIO_CAP.toLocaleString('de-DE')} % des verbrauchten Brennstoffs (§ 5a Abs. 3 CO2KostAufG).`
// Der Einleitungssatz der Karte: für wen die Teilung gilt, mit den Bedingungen des § 5b für den Neubau und der
// Ausnahme nach einem Notfalleinbau (§ 5a Abs. 4). Vorher hieß es nur „oder eine solche Heizung in einem
// Neubau“, und wer nur den Satz las, hielt jeden Neubau für erfasst. Alle Daten aus dem Register.
export const HALF_SPLIT_SCOPE =
  `Nur für eine Gas-, Öl- oder Flüssiggasheizung, die nach dem ${INSTALLED_AFTER} in ein bestehendes Gebäude eingebaut wurde, ` +
  `oder eine solche Heizung in einem Neubau, der bis zum ${FIRST_USE_UNTIL} erstmals genutzt wird, außer bei Bauantrag, ` +
  `Antrag auf Zustimmung oder Bauanzeige vor dem ${APPLICATION_FROM} (§ 5b CO2KostAufG). ${HALF_SPLIT_WHAT} ` +
  `Wurde die Heizung eingebaut, weil die bisherige irreparabel ausgefallen war, entfällt die Teilung je nach Zeitpunkt ` +
  `des Einbaus für ${EMERGENCY_MONTHS} Monate ab dem Einbau (§ 5a Abs. 4 CO2KostAufG).`

// § 5a Abs. 4 Satz 2 und 3 hängen daran, ob für die ausgefallene Heizung beim Ausfall schon eine Pflicht nach
// § 43 Abs. 1 GModG bestand. Gefragt wird danach, wann und was eingebaut war, nicht nach der Pflicht selbst
// (Prüfung M8 im Wortlaut der Gegenprüfung; Entscheidung R18-4): Ein Laie verneinte die Pflicht bei einem Ausfall
// 2028, weil der erste Pflichtanteil erst 2029 greift, und schlösse die Teilung so zu Lasten der Mieter aus.
// „Ja“ heißt `emergencyPriorDuty: true`.
export const PRIOR_DUTY_QUESTION = `War die ausgefallene Heizung eine Gas-, Öl- oder Flüssiggasheizung, die nach dem ${INSTALLED_AFTER} in das bestehende Gebäude eingebaut wurde?`
export const PRIOR_DUTY_EXPLAINED = `Nach der Gesetzesbegründung gilt für eine solche Heizung die Pflicht nach § 43 Abs. 1 GModG schon ab dem Einbau, auch bevor der erste Pflichtanteil ${BIO_YEAR} greift (BT-Drs. 21/7009, S. 150 und 154).`

export const halfSplitAvailable = (energy: HeatingEnergy): boolean => H43.energies.includes(energy)

const tri = (v: boolean | null): TriState => (v === null ? 'unknown' : v ? 'yes' : 'no')
const fromTri = (t: TriState): boolean | null => (t === 'unknown' ? null : t === 'yes')

export function halfSplitToForm(p: HalfSplitBody): HalfSplitForm {
  return {
    installedOn: p.gmodg43InstalledOn ?? '',
    emergency: p.emergencyInstall === true,
    priorDuty: tri(p.emergencyPriorDuty),
    newBuilding: p.newBuildingFirstUse !== null,
    firstUse: p.newBuildingFirstUse ?? '',
    applicationBefore: tri(p.buildingApplicationBefore20260513),
  }
}

export function halfSplitBody(f: HalfSplitForm): { body: HalfSplitBody } | { error: string } {
  if (f.installedOn === '') {
    return { body: { gmodg43InstalledOn: null, emergencyInstall: null, emergencyPriorDuty: null, newBuildingFirstUse: null, buildingApplicationBefore20260513: null } }
  }
  if (f.newBuilding && f.firstUse === '') return { error: 'Bitte geben Sie den Tag an, an dem das neue Gebäude erstmals genutzt wurde.' }
  return {
    body: {
      gmodg43InstalledOn: f.installedOn,
      emergencyInstall: f.emergency,
      emergencyPriorDuty: f.emergency ? fromTri(f.priorDuty) : null,
      newBuildingFirstUse: f.newBuilding ? f.firstUse : null,
      buildingApplicationBefore20260513: f.newBuilding ? fromTri(f.applicationBefore) : null,
    },
  }
}

// Die Mitteilung nach § 5d Abs. 4 steht am Mietverhältnis (Abweichung 3 des Plans). Gefragt wird bei den
// Mietverhältnissen der Wohnungen an dieser Anlage, die am Tag `from` (Beginn der Teilung) noch laufen.
export type NoticeTenancy = Pick<Tenancy, 'id' | 'unitId' | 'tenantName' | 'start' | 'end' | 'halfSplitNoticeOn'>
export function noticeTenancies<T extends NoticeTenancy>(tenancies: readonly T[], plant: Pick<HeatingPlant, 'units'>, from: string): T[] {
  return tenancies.filter((t) => (plant.units === null || plant.units.some((u) => u.unitId === t.unitId)) && (t.end === null || t.end >= from))
}
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
export function noticeBody(text: string): { body: { halfSplitNoticeOn: string | null } } | { error: string } {
  if (text === '') return { body: { halfSplitNoticeOn: null } }
  return ISO_DAY.test(text) ? { body: { halfSplitNoticeOn: text } } : { error: 'Bitte wählen Sie den Tag der Mitteilung im Kalender.' }
}

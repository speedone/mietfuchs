import { HEATING_CATEGORY } from './heating.ts'
import { periodsBetween } from './period.ts'
import type { CostItem, PeriodRules } from './types.ts'

// Ein Teil einer aufgeteilten Rechnung (#208): eine kalte Position, deren Leistungszeitraum mehr
// als einen Zeitraum des Objekts berührt. Anders entsteht so eine Position nicht, denn das
// gewöhnliche Speichern lehnt sie ab; sie kommt aus dem Aufteilen beim Speichern oder dem Wechsel des
// Rhythmus, und jeder Teil trägt den ganzen Leistungszeitraum der Rechnung. In shared/, weil auch die
// Belegbuchung (bookingPlan.ts, assessment.ts) danach fragt und deren Test im Browser läuft.
export function isSplitPart(rules: PeriodRules, c: Pick<CostItem, 'category' | 'serviceFrom' | 'serviceTo'>): boolean {
  if (c.category === HEATING_CATEGORY || c.serviceFrom === undefined || c.serviceTo === undefined || c.serviceFrom > c.serviceTo) return false
  return periodsBetween(rules, c.serviceFrom, c.serviceTo).length > 1
}

export const SPLIT_SUFFIX = / \(anteilig [^)]*\)$/

// Die Beschreibung ohne den Zusatz eines früheren Aufteilens.
export const baseDescription = (description: string): string => description.replace(SPLIT_SUFFIX, '')

const MS_DAY = 86400000
const daysOf = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_DAY) + 1

// Der Anteil eines Teils an seiner Rechnung (#454): Tage seines Leistungszeitraums im Zeitraum `period` von allen Tagen
// des Leistungszeitraums. Genau so teilt `splitByService` (server/src/serviceSplit.ts) den Betrag. `null`, wenn die
// Position keine geteilte ist (kein Leistungszeitraum, Heizkosten, ganz im Zeitraum oder ganz außerhalb): Dann trägt
// sie die ganze Rechnung. Wer den Betrag eines Teils mit einer Angabe über die ganze Rechnung vergleicht (`whole` in
// SPLIT_FIELDS), kürzt diese Angabe mit `days / of`.
export function partShare(c: Pick<CostItem, 'category' | 'serviceFrom' | 'serviceTo'>, period: { from: string; to: string }): { days: number; of: number } | null {
  if (c.category === HEATING_CATEGORY || c.serviceFrom === undefined || c.serviceTo === undefined || c.serviceFrom > c.serviceTo) return null
  const from = c.serviceFrom > period.from ? c.serviceFrom : period.from
  const to = c.serviceTo < period.to ? c.serviceTo : period.to
  if (from > to) return null
  const days = daysOf(from, to)
  const of = daysOf(c.serviceFrom, c.serviceTo)
  return days < of ? { days, of } : null
}

// Was beim Aufteilen einer Rechnung (#208) mit jedem Feld geschieht (#454). Vorher stand das nirgends: Jeder Teil
// erbte alle Felder, und nur Betrag und Lohnanteil wurden geteilt. Zwei Fehler folgten daraus, die Prüfung „laut
// Gemeinschaftsabrechnung“ maß den Teil an der ganzen Rechnung, und Einzelbeträge standen ungekürzt in jedem Teil.
// `satisfies Record<keyof CostItem, …>` verlangt für ein neues Feld eine Entscheidung, sonst scheitert `npm run
// typecheck`.
//
//   part      wird je Teil neu gesetzt (`PartWrite` in server/src/db/repository.ts, ein Test hält beide gleich)
//   same      gilt für jeden Teil unverändert (Zuordnung, Schlüssel, Beleg, Verweise)
//   whole     beschreibt die ganze Rechnung und bleibt; wer es mit dem Betrag eines Teils vergleicht, kürzt es mit
//             `partShare`
//   noSplit   eine Position mit diesem Feld wird nicht nach Tagen geteilt (`splitBlocker`)
export type SplitRule = 'part' | 'same' | 'whole' | 'noSplit'
export const SPLIT_FIELDS = {
  id: 'part', period: 'part', amountCents: 'part', labor35aCents: 'part', description: 'part', taxYear: 'part',
  propertyId: 'same', serviceFrom: 'same', serviceTo: 'same', paidOn: 'same', heatingPart: 'same', heatingTarget: 'same',
  category: 'same', vendor: 'same', key: 'same', directUnitId: 'same', meterType: 'same', customShares: 'same',
  participantUnitIds: 'same', notAgreedTenancyIds: 'same', namedTenancyIds: 'same', invoiceFile: 'same',
  heatingPlantId: 'same', fuelDeliveryId: 'same', operatingPower: 'same', operatingPowerItemId: 'same',
  operatingPowerBasis: 'same', operatingPowerGeneralId: 'same', operatingPowerReported: 'same',
  // Die Quelle (#455): Jeder Teil verweist auf dieselbe Rechnung.
  sourceId: 'same',
  externalBasis: 'whole',
  // Einzelbeträge hängen am Mieter, beim Messdienst schon nach Nutzerwechsel getrennt. Welcher davon in welchen
  // Zeitraum gehört, weiß nur dessen Abrechnung; nach Tagen geteilt fiele der Betrag eines Mieters, der im zweiten
  // Zeitraum nicht mehr wohnt, dem Vermieter zu, und der des Nachmieters ebenso im ersten.
  tenancyAmounts: 'noSplit', selfAmounts: 'noSplit',
} as const satisfies Record<keyof CostItem, SplitRule>

// Warum sich eine Position nicht nach Tagen teilen lässt, oder `null`. Heizkosten fragt der Aufrufer selbst (eigene
// Sätze mit VIII ZR 156/11); für sie gilt der Rat zum Abflussprinzip nicht, sie erreichen diesen Satz aber nie.
// Durchsicht, Befund 3: Rechnet die Quelle der Einzelbeträge in einem anderen Zeitraum ab, gibt es keine Beträge je
// Abrechnungszeitraum; dann bleibt die ganze Rechnung im Zeitraum der Zahlung, wie der Wechsel es für Positionen ohne
// Leistungszeitraum ohnehin tut (Gruppe `|einzelbetraege`).
export function splitBlocker(c: Pick<CostItem, 'key' | 'description'>): string | null {
  if (c.key !== 'amounts') return null
  return `„${c.description}“ ist nach Einzelbeträgen verteilt. Welcher Einzelbetrag in welchen Abrechnungszeitraum gehört, steht nur in der Abrechnung, aus der die Beträge stammen; nach Tagen teilt Mietfuchs sie nicht. ` +
    'Erfassen Sie die Rechnung je Abrechnungszeitraum, mit dem Leistungszeitraum in diesem Zeitraum und den Einzelbeträgen, die darauf entfallen. ' +
    'Gibt es keine Beträge je Zeitraum (etwa weil der Messdienst im Kalenderjahr abrechnet), erfassen Sie die Rechnung ganz in dem Abrechnungszeitraum, in dem sie bezahlt wurde, ohne Leistungszeitraum (Abflussprinzip, BGH VIII ZR 49/07).'
}

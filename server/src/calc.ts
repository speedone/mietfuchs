// Berechnungs-Engine für die Nebenkostenabrechnung.
// Alle Beträge werden in Cent (Integer) gerechnet, um Gleitkomma-Fehler zu vermeiden.
import type {
  AppliedValue,
  BillingPeriod,
  CaptureMethod,
  HcaDeviceLine,
  HeatingServiceValue,
  CalcStep,
  HeatingPeriodRef,
  HeatingStatement,
  HeatingPrepaymentOverride,
  PeriodKey,
  SeparateHeatingRef,
  CostKey,
  CostModel,
  FuelMethod,
  LegalBasis,
  NotSettled,
  ExternalMeasure,
  LandlordPart,
  LandlordReason,
  MeterType,
  Notice,
  NoticeLevel,
  NoticeSubject,
  PersonEntry,
  RentLedger,
  RentLedgerRow,
  RentMonth,
  Settlement,
  SettlementRow,
  Statement,
  TaxAllocation,
  TaxExpenseCategory,
  TaxExpenseGroup,
  TaxExpenseItem,
  TaxReport,
  FuelDeliveryLine,
  HeatingTarget,
  HotWater,
  SelfHeatingStatement,
  SelfPot,
  SelfPotView,
  SelfUnitView,
  SelfUserView,
} from '../../shared/types.ts'
// Die Berechnung kennt den Speicher nicht mehr, sondern nur noch den Schnappschuss eines
// Abrechnungsjahres (siehe snapshot.ts). Welche Sammlung darin nach Jahr eingegrenzt sein darf,
// entscheidet dort die Ablage und nicht hier.
import { rulesFor } from '../../shared/law/rules.ts'
import { co2ApplicableFrom, co2CostsBefore, co2CostsCountedFrom, co2CostsExcludedUntil, co2CutMissing, co2DistrictEtsNew, co2FirstPeriodStart, co2NonResidential, co2Restriction, co2RoundingDecimals, co2StageTable } from '../../shared/law/co2kostaufg.ts'
import { CO2_RELIEF_LABEL } from '../../shared/co2Probe.ts'
import { ausweisGaps, CO2_FUELS, co2Assessment, co2DeductionsOf, FORMULA_METHODS, co2PotsOf, itemBasisUnits, L_TOLERANCE_CENTS, perUnitClassification, perUnitExceeding, perUnitReliefs, reliefsByShare, spanningPlants, type PerUnitFuel, restage, selfSplit, SERVICE_FUEL_TOLERANCE_CENTS, shownReliefs, stageRanges, tableFactor, tenantLines as co2TenantLines, type Co2Pot, type ReliefShare } from './co2.ts'
// Zahlen und Daten der Rechtsregeln kommen aus dem Rechtsregister (Heizung PR 1) und stehen hier
// nicht als Literal; server/test/law-literals.test.ts wacht darüber.
import { createLawLog, dayAfter, dayBefore, law, LAW_AS_OF, onlyVersion, recordVersionAt, valueAt, type Period } from '../../shared/law/register.ts'
import { betrkvTvSignal, bgbDeadlineMonths, bgbMaxPeriodMonths } from '../../shared/law/bgb-betrkv.ts'
import { hkvConsumptionShare, hkvConsumptionShareForced, hkvCutNotByConsumption, hkvCutRemoteReading, hkvDegreeDays, hkvHeatPumpCapture, hkvRemoteReadingNewDevices, hkvRemoteReadingRetrofit, hkvRenewableExemption, hkvSettlementInfo, type DegreeDayTable } from '../../shared/law/heizkostenv.ts'
import { remoteReadingVerdict, servedUnitIds } from './remoteReading.ts'
import { practiceReadingOffWarning, practiceVacancyPersons } from '../../shared/law/practice.ts'
import { HEATING_CATEGORY, heatingByConsumption, heatingFindings, mayAgreeOtherwise } from '../../shared/heating.ts'
import { andList, meterTypeLabel, plural } from '../../shared/wording.ts'
import type { TermId } from '../../shared/glossary.ts'
import { allocationOf, comparablePrevious, sameAllocation, sameUnits } from '../../shared/allocation.ts'
import { possibleDuplicates } from '../../shared/duplicates.ts'
import { commonPeriod, tenancyOverlaps } from '../../shared/tenancyOverlap.ts'
import { CALENDAR_RULES, calendarYearPeriod, contextOf, formatDayRange, isCalendarRules, periodContaining, periodDays, periodLabel, periodMonths, periodOfKey, periodsBetween, previousPeriod, rulesOf, settlementDeadline, settlementPeriod, type PeriodContext } from '../../shared/period.ts'
import { lineRoot, monthSpanText, plantRules, plantSpan, recommendedDeadline, requestMonth, sameBuilding, sameFuelLine, sameLine, sameSpan, separateOwner, servesUnit, settledSeparately } from '../../shared/heatingPeriod.ts'
import { heatingSnapshotFor, selfAt, snapshotFor, wayOf } from './snapshot.ts'
import { plantFuel, rangeOf, type FuelCarry, type FuelResult } from './fuel.ts'
import { fuelFromDeliveries, fuelFromStock, looseCentsOf, measuredOffset, problemText, settledByDefault, stockKeysOf, stockOf, stockTemplateOfLine, stockTouched, valueOf as stockValueOf, type FuelFigures, type StockPeriodInput, type StockResult } from './fuelStock.ts'
import { isStockEnergy, STOCK_FUEL_NAMES, STOCK_UNIT_TEXT } from '../../shared/fuelStock.ts'
import { degreeDayPermille } from '../../shared/degreeDays.ts'
import { annualFactors, type AnnualBasis } from './prepaymentSuggestion.ts'
import {
  boundaryReadingsOf, consumptionSharesOf, heatPumpVerdict, lineShareRows, OIL_OR_GAS, hotWaterShareOf, measuredBetween, planSelf, sortReadings, targetProblem, usersOf, weightsOf,
  type Alpha, type ConsumptionShares, type HeatPumpVerdict, type SelfInput, type SelfPlan, type SelfProblem, type SelfReading, type SelfTenancy, type SelfUnit, type SelfUserPlan, type SelfWeights,
} from './heating.ts'
import { DHW_PLAUSIBLE, dhwProblemText, fmtShare } from './dhw.ts'
import { captureOf, hotWaterOf, lineServiceRows, serviceHeatUnit, serviceUnitsMixed, deviceCutoffs, isServiceMeter, deviceCutoffText, deviceLines, meterFactor, missingRatings, missingRatingsText, mixedCapture, mixedCaptureText, serviceMeters } from './hca.ts'
import { FUEL_GRADE_LABELS, HEATING_VALUE_UNIT_TEXT } from '../../shared/fuelGrades.ts'
import type { FrozenItemSelfUse, Snapshot, SnapshotCostItem, SnapshotHeatingPart, SnapshotHeatingPlant, SnapshotMeter, SnapshotReading, SnapshotTenancy, SnapshotUnit } from './snapshot.ts'

export const KEY_LABELS: Record<CostKey, string> = {
  area: 'Wohnfläche',
  persons: 'Personenzahl',
  units: 'Wohneinheiten',
  direct: 'Direktzuordnung',
  meter: 'Verbrauch (Zähler)',
  custom: 'Vereinbarte Anteile',
  external: 'Laut Gemeinschaftsabrechnung',
  amounts: 'Einzelbetrag',
  heatingSystem: 'Nach Heizkostenverordnung',
}

const MS_DAY = 86400000

function toUTC(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

export function daysInYear(year: number): number {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365
}

// Überlappung zweier Zeiträume in Tagen (alle Grenzen inklusiv, ISO-Strings, end=null = offen)
function rangeOverlapDays(aStart: string, aEnd: string | null, bStart: string, bEnd: string | null): number {
  const s = Math.max(toUTC(aStart), toUTC(bStart))
  const e = Math.min(aEnd ? toUTC(aEnd) : Infinity, bEnd ? toUTC(bEnd) : Infinity)
  if (e < s) return 0
  return Math.round((e - s) / MS_DAY) + 1
}

// Belegte Tage eines Mietverhältnisses innerhalb des Abrechnungsjahres
export function overlapDays(start: string, end: string | null, year: number): number {
  return rangeOverlapDays(start, end, `${year}-01-01`, `${year}-12-31`)
}

// Tage im Zeitraum [from, to], an denen mindestens eines der Mietverhältnisse besteht. Überlappen
// sie sich (ein Auszug nach dem nächsten Einzug), zählt jeder Tag nur einmal; die Lücke dazwischen
// ist der Leerstand (#177).
export function occupiedDays(tenancies: { start: string, end: string | null }[], from: string, to: string): number {
  const lo = toUTC(from)
  const hi = toUTC(to)
  const ranges = tenancies
    .map((t) => [Math.max(toUTC(t.start), lo), Math.min(t.end ? toUTC(t.end) : Infinity, hi)] as const)
    .filter(([s, e]) => e >= s)
    .sort((a, b) => a[0] - b[0])
  let days = 0
  let until = -Infinity // letzter schon gezählter Tag
  for (const [s, e] of ranges) {
    const start = Math.max(s, until + MS_DAY)
    if (e >= start) days += Math.round((e - start) / MS_DAY) + 1
    until = Math.max(until, e)
  }
  return days
}

// ---------- Sortieren ----------
//
// **Nichts in dieser Datei darf von der Locale der Laufzeit abhängen** (#70). Sonst ergäben
// dieselben Daten auf zwei Rechnern zwei Reihenfolgen, und bei `largestRemainder` entscheidet
// die Reihenfolge, wer den Rest-Cent bekommt. Ein blankes `localeCompare()` liest die
// Einstellung der Laufzeit und ist deshalb hier nirgends erlaubt; ein Test in calc.test.ts hält
// das fest, weil es sich auf einem einzelnen Rechner nicht messen lässt.
//
// Abgeschafft wird die Locale damit aber nicht, sondern festgenagelt — genau wie beim
// Formatieren von Zahlen weiter unten, das ausdrücklich `'de-DE'` verlangt. Welche der beiden
// Funktionen gilt, entscheidet, wofür die Reihenfolge da ist.

// **Trägt die Reihenfolge eine Bedeutung**, wird Zeichen für Zeichen verglichen: der Rest-Cent
// in `largestRemainder`, die Ablesungen und die Staffeln, bei denen sie entscheidet, welcher
// von zwei Einträgen zum selben Stichtag der spätere ist (siehe schedule.ts). Hier wäre eine
// Sprache die falsche Frage: Verglichen werden Kennungen und ISO-Daten, keine Wörter.
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

// **Steht die Reihenfolge in einer Liste, die ein Mensch liest**, gilt deutsche Sortierung, und
// zwar fest eingestellt. Zeichenweise verglichen landete „Älter“ hinter „Zaun“, weil das Ä einen
// höheren Zeichenwert hat als das Z — richtig wäre das nie, und einem Vermieter mit Umlauten im
// Haus fiele es sofort auf. Die Sprache steht hier und kommt nicht aus der Umgebung.
const NAME_COLLATOR = new Intl.Collator('de-DE')

export function compareName(a: string, b: string): number {
  return NAME_COLLATOR.compare(a, b)
}

// ---------- Personen-Staffel ----------

function personHistoryOf(tenancy: SnapshotTenancy): PersonEntry[] {
  const h = Array.isArray(tenancy.personHistory) && tenancy.personHistory.length
    ? tenancy.personHistory
    : [{ from: tenancy.start, persons: tenancy.persons ?? 1 }]
  return h.slice().sort((a, b) => compareText(a.from, b.from))
}

// Personentage eines Mietverhältnisses im Zeitraum [from, to] (inklusiv)
export function personDaysInPeriod(tenancy: SnapshotTenancy, from: string, to: string): number {
  const h = personHistoryOf(tenancy)
  let sum = 0
  for (let i = 0; i < h.length; i++) {
    const segStart = i === 0 ? tenancy.start : h[i].from // erste Stufe gilt ab Einzug
    const segEnd: string | null = i + 1 < h.length
      ? new Date(toUTC(h[i + 1].from) - MS_DAY).toISOString().slice(0, 10)
      : tenancy.end
    const effEnd = tenancy.end && (!segEnd || segEnd > tenancy.end) ? tenancy.end : segEnd
    sum += h[i].persons * rangeOverlapDays(segStart, effEnd, from, to)
  }
  return sum
}

// Personen je Leerstandstag beim Personenschlüssel (#177): Wert und Begründung stehen seit
// Heizung PR 1 im Rechtsregister (`practice.vacancy-persons`, shared/law/practice.ts), verwendet
// über `vacancyPersons` in computeSettlement.

// Aktuelle Personenzahl zu einem Stichtag
export function personsAt(tenancy: SnapshotTenancy, dateIso: string): number {
  const h = personHistoryOf(tenancy)
  let p = h[0]?.persons ?? 0
  for (const e of h) if (e.from <= dateIso) p = e.persons
  return p
}

// ---------- Hinweise (#112) ----------

// Jede Meldung der Berechnung hat einen festen Code, und Stufe, Titel und Regel hängen am Code
// und nicht an der Stelle, die sie ausgibt. So kann derselbe Code nie mit zwei Stufen
// erscheinen, und wer eine Meldung ergänzt, muss sie hier eintragen: `warn` nimmt nur Codes aus
// dieser Tabelle. Der Text bleibt an der Stelle, weil er die Einzelheiten des Falls nennt.
// Die Stufen sind in shared/types.ts (`NoticeLevel`) fachlich bestimmt.
// `terms`: die Begriffe des Lexikons (#113), die den Hinweis erklären, mindestens einer.
type NoticeKind = { level: NoticeLevel, title: string, rule?: string, terms: [TermId, ...TermId[]] }
const noticeKinds = {
  'meter.replacement-without-end': { level: 'warning', title: 'Zählerwechsel ohne Endstand', terms: ['meterReading'] },
  'meter.negative': { level: 'warning', title: 'Negativer Verbrauch', terms: ['meterReading'] },
  'meter.same-day': { level: 'warning', title: 'Mehrere Ablesungen am selben Tag', terms: ['meterReading'] },
  'basis.self-no-persons': { level: 'warning', title: 'Personenzahl der eigenen Wohnung fehlt', terms: ['ownShare', 'personDays'] },
  'basis.self-no-area': { level: 'warning', title: 'Wohnfläche der eigenen Wohnung fehlt', terms: ['ownShare', 'distributionBasis'] },
  'basis.unit-no-area': { level: 'warning', title: 'Wohnfläche fehlt', terms: ['distributionBasis'] },
  'basis.tenancy-no-persons': { level: 'warning', title: 'Personenzahl fehlt', terms: ['personDays'] },
  // #204: Stufe `error`, obwohl verteilt wird: Die Angaben widersprechen sich, und die Mieter der
  // Wohnung tragen für dieselben Tage doppelt. Verweigert wird nicht (Zielbild #91), beziffert schon.
  'tenancy.overlap': { level: 'error', title: 'Mietverhältnisse überschneiden sich', terms: ['tenancyOverlap'] },
  // Bewusst eingetragene 0 bei einer Einheit ohne Fläche und Bewohner (Garage, Stellplatz, #135)
  'basis.unit-zero': { level: 'hint', title: 'Einheit ohne Fläche', terms: ['distributionBasis'] },
  'basis.tenancy-zero': { level: 'hint', title: 'Mietverhältnis ohne Personen', terms: ['personDays'] },
  // Ein Hinweis und keine Warnung (#177): Nichts ist falsch erfasst, und das Geld landet, wo es nach
  // dem Grundsatz hingehört. Zu prüfen ist nur, ob der Ansatz für die leere Wohnung, eine Auslegung,
  // zum Mietvertrag passt.
  'basis.vacancy-persons': { level: 'hint', title: 'Leerstand beim Personenschlüssel', terms: ['vacancy', 'personDays'] },
  // Eine leere Einheit ohne Fläche ist beim Personenschlüssel kein Leerstand (#177); wie bei
  // `basis.unit-zero` ist die 0 meist eine Angabe (Garage, Stellplatz).
  'basis.vacancy-no-area': { level: 'hint', title: 'Leere Einheit ohne Fläche', terms: ['vacancy', 'personDays'] },
  'tv-signal.partial-year': { level: 'warning', title: `Kabelfernsehen nur bis ${fmtDay(onlyVersion(betrkvTvSignal).validTo ?? '')} umlagefähig`, rule: 'tv-signal', terms: ['cableTv', 'notAllocable'] },
  'tv-signal.ended': { level: 'warning', title: 'Kabelfernsehen nicht mehr umlagefähig', rule: 'tv-signal', terms: ['cableTv', 'notAllocable'] },
  'tv-signal.new-system': { level: 'warning', title: 'Kabelfernsehen bei neuer Anlage nie umlagefähig', rule: 'tv-signal', terms: ['cableTv', 'notAllocable'] },
  'item.no-basis': { level: 'warning', title: 'Position geht ganz an den Vermieter', terms: ['distributionBasis'] },
  'external.value-missing': { level: 'warning', title: 'Miteigentumsanteil oder Wohnfläche fehlt', terms: ['mea', 'homeownersStatement'] },
  'external.amount-mismatch': { level: 'hint', title: 'Betrag passt nicht zum Anteil', terms: ['homeownersStatement', 'mea'] },
  'amounts.exceed': { level: 'error', title: 'Einzelbeträge über dem Rechnungsbetrag', terms: ['individualAmounts'] },
  'amounts.forfeited': { level: 'warning', title: 'Einzelbetrag ohne Mietverhältnis', terms: ['individualAmounts'] },
  'amounts.missing': { level: 'warning', title: 'Einzelbetrag fehlt', terms: ['individualAmounts'] },
  'amounts.self-hidden': { level: 'hint', title: 'Eigenanteil nicht ausgewiesen', terms: ['individualAmounts', 'ownShare'] },
  'amounts.self-forfeited': { level: 'warning', title: 'Eigenbetrag ohne selbstgenutzte Wohnung', terms: ['individualAmounts', 'ownShare'] },
  'custom.forfeited': { level: 'warning', title: 'Vereinbarter Anteil entfällt', terms: ['agreedShares', 'billingUnit'] },
  'custom.none': { level: 'warning', title: 'Keine vereinbarten Anteile', terms: ['agreedShares'] },
  'custom.over-100': { level: 'error', title: 'Vereinbarte Anteile über 100 %', terms: ['agreedShares'] },
  'meter.no-consumption': { level: 'warning', title: 'Kein Verbrauch erfasst', terms: ['consumptionKey'] },
  'meter.unit-without-meter': { level: 'warning', title: 'Wohnung ohne Zähler', terms: ['mainMeter', 'consumptionKey'] },
  'meter.sub-exceeds-main': { level: 'warning', title: 'Wohnungszähler über dem Hauptzähler', terms: ['mainMeter'] },
  'meter.main-partial': { level: 'warning', title: 'Hauptzähler deckt nicht das ganze Jahr ab', terms: ['mainMeter', 'meterReading'] },
  'meter.main-gap': { level: 'hint', title: 'Wohnungszähler erfassen wenig vom Hauptzähler', terms: ['mainMeter'] },
  'meter.unit-partial': { level: 'warning', title: 'Zähler deckt nicht die ganze Zeit ab', terms: ['mainMeter', 'meterReading'] },
  'direct.unit-gone': { level: 'warning', title: 'Zugeordnete Wohnung gibt es nicht mehr', terms: ['directAssignment'] },
  'labor35a.invalid': { level: 'warning', title: 'Lohnanteil nach § 35a ungültig', terms: ['labor35a'] },
  'heating.not-by-consumption': { level: 'warning', title: 'Heizkosten nicht nach Verbrauch verteilt', rule: 'heating-consumption', terms: ['heatingCostOrdinance', 'consumptionKey'] },
  'heating.consumption-share': { level: 'hint', title: `Verbrauchsanteil der Heizkosten außerhalb ${hkvConsumptionShare.describe(valueAt(hkvConsumptionShare, LAW_AS_OF))}`, rule: 'heating-consumption', terms: ['heatingCostOrdinance', 'consumptionKey'] },
  'heating.may-agree-otherwise': { level: 'hint', title: 'Heizkosten nicht nach Verbrauch verteilt (Zweifamilienhaus)', rule: 'heating-consumption', terms: ['heatingCostOrdinance', 'consumptionKey'] },
  // #180, Entwurf 8.9: Die Objektart ist eine Beschreibung; die Ausnahme des § 2 hängt an den Wohnungen.
  'property.kind-mismatch': { level: 'hint', title: 'Art des Objekts passt nicht zu den Wohnungen', rule: 'heating-consumption', terms: ['heatingCostOrdinance', 'heatingSystem'] },
  'heating.flat-rate': { level: 'warning', title: 'Heizkosten pauschal vereinbart', rule: 'heating-flat-rate', terms: ['heatingCostOrdinance', 'inclusiveRent'] },
  'heating.remote-reading': { level: 'hint', title: 'Zähler der Heizung fernablesbar?', rule: 'heating-remote-reading', terms: ['heatingCostOrdinance'] },
  // Heizung PR 4 (#214): ein Gerät ist nicht fernablesbar, obwohl es das sein muss. Eine eigene Stufe
  // und damit ein eigener Code: `heating.remote-reading` bleibt der Hinweis, wenn es nur sein kann.
  'heating.remote-reading-missing': { level: 'warning', title: 'Geräte der Heizung nicht fernablesbar', rule: 'heating-remote-reading', terms: ['heatingCostOrdinance', 'heatCostAllocator'] },
  // Heizung PR 6 (#97, #209): CO₂ beim Messdienst (Entwurf 7.3, 10.1). Die Probe ist ein Fehler,
  // denn dann wird für die Heizperiode nichts gebucht; mit geschätztem S nur ein Hinweis (R6).
  'co2.sum-check': { level: 'error', title: 'CO₂-Angaben passen nicht zu den Positionen', rule: 'co2-split', terms: ['co2Deducted', 'co2Split'] },
  'co2.sum-check-approx': { level: 'hint', title: 'CO₂-Angaben mit geschätzter Summe', rule: 'co2-split', terms: ['co2Deducted', 'co2Split'] },
  'co2.pool-foreign-item': { level: 'hint', title: 'Position ohne Einzelbeträge bei der Heizanlage', terms: ['individualAmounts', 'co2Split'] },
  'co2.share-capped': { level: 'hint', title: 'CO₂-Anteil des Vermieters passt nicht in die Position', rule: 'co2-split', terms: ['co2Deducted', 'co2Split'] },
  'co2.reliefs-invalid': { level: 'error', title: 'Beträge „vom Vermieter übernommen“ passen nicht', rule: 'co2-split', terms: ['co2Split'] },
  'co2.reliefs-missing': { level: 'warning', title: 'Betrag „vom Vermieter übernommen“ fehlt', rule: 'co2-split', terms: ['co2Split'] },
  'co2.probably-deducted': { level: 'warning', title: 'CO₂-Anteil vermutlich schon abgezogen', rule: 'co2-split', terms: ['co2Deducted', 'co2Split'] },
  // Ohne Angaben oder ohne Aufteilung (Entwurf 9.1, 10.1). `co2.missing` und `co2.fuel-unknown`
  // färben die Ampel; angekündigt im CHANGELOG.
  'co2.missing': { level: 'warning', title: 'CO₂-Kosten nicht aufgeteilt', rule: 'co2-split', terms: ['co2Split', 'heatingSystem'] },
  'co2.missing-first-year': { level: 'hint', title: 'CO₂-Kosten im ersten Zeitraum der Aufteilung', rule: 'co2-split', terms: ['co2Split', 'heatingSystem'] },
  'co2.fuel-unknown': { level: 'hint', title: 'Energieträger der Heizung unbekannt', rule: 'co2-split', terms: ['co2Split', 'heatingSystem'] },
  'co2.service-unsplit': { level: 'warning', title: 'Messdienst hat die CO₂-Kosten nicht aufgeteilt', rule: 'co2-split', terms: ['co2Split'] },
  'co2.incomplete': { level: 'warning', title: 'Angaben für den CO₂-Ausweis fehlen', rule: 'co2-split', terms: ['co2Split', 'co2Stage'] },
  'co2.stage-mismatch': { level: 'hint', title: 'Einstufung laut Abrechnung weicht ab', rule: 'co2-split', terms: ['co2Stage', 'co2Area'] },
  // Heizung PR 7 (#97): Lieferungen (Entwurf 3.2, 3.3, 8.2, 10.1).
  'fuel.share-by-degree-days': { level: 'hint', title: 'Rechnung nach Gradtagen aufgeteilt', rule: 'heating-consumed-fuel', terms: ['degreeDays', 'accrualPrinciple'] },
  'fuel.fixed-unknown': { level: 'hint', title: 'Fester Preisbestandteil fehlt', rule: 'heating-consumed-fuel', terms: ['accrualPrinciple', 'degreeDays'] },
  'fuel.uncovered': { level: 'warning', title: 'Rechnung für einen Teil der Heizperiode fehlt', rule: 'heating-consumed-fuel', terms: ['accrualPrinciple', 'degreeDays'] },
  'fuel.manual-beyond-period': { level: 'warning', title: 'Heizrechnung reicht über die Heizperiode', rule: 'heating-consumed-fuel', terms: ['accrualPrinciple', 'heatingSystem'] },
  'fuel.closed-period-part': { level: 'hint', title: 'Teil einer abgeschlossenen Heizperiode beim Vermieter', rule: 'heating-consumed-fuel', terms: ['accrualPrinciple', 'settlementDeadline'] },
  'fuel.zero-invoice': { level: 'hint', title: 'Rechnung ergibt 0 €', rule: 'heating-consumed-fuel', terms: ['fuelDelivery', 'accrualPrinciple'] },
  'fuel.estimate-undistributed': { level: 'warning', title: 'Schätzung wird nicht verteilt', rule: 'heating-consumed-fuel', terms: ['fuelDelivery', 'accrualPrinciple'] },
  'fuel.estimated': { level: 'hint', title: 'Brennstoffkosten geschätzt', rule: 'heating-consumed-fuel', terms: ['accrualPrinciple', 'degreeDays'] },
  'fuel.estimate-settled': { level: 'warning', title: 'Schätzung durch die Rechnung ersetzt', rule: 'heating-consumed-fuel', terms: ['accrualPrinciple', 'settlementDeadline'] },
  'fuel.estimate-overcharged': { level: 'warning', title: 'Schätzung war zu hoch', rule: 'heating-consumed-fuel', terms: ['accrualPrinciple', 'settlementDeadline'] },
  'fuel.loose-item': { level: 'hint', title: 'Heizposition ohne Lieferung neben einer Lücke', rule: 'heating-consumed-fuel', terms: ['accrualPrinciple', 'fuelDelivery'] },
  'fuel.cancelled-after-close': { level: 'warning', title: 'Rechnung nach dem Abschluss storniert', rule: 'heating-consumed-fuel', terms: ['fuelDelivery', 'settlementDeadline'] },
  'fuel.owner-closed-unlinked': { level: 'hint', title: 'Rechnung nach dem Abschluss verknüpft', rule: 'heating-consumed-fuel', terms: ['fuelDelivery', 'accrualPrinciple'] },
  'co2.district-ets-exempt': { level: 'hint', title: 'CO₂-Kosten nicht aufzuteilen (Emissionshandel)', rule: 'co2-split', terms: ['districtEts', 'co2Split'] },
  // Heizung PR 7: eigene CO₂-Aufteilung (Entwurf 7.6, 9, 10.1).
  'co2.service-unsplit-healed': { level: 'hint', title: 'CO₂-Kosten nachträglich aufgeteilt', rule: 'co2-split', terms: ['co2Split'] },
  'co2.service-fuel-mismatch': { level: 'hint', title: 'Messdienst hat andere Brennstoffkosten angesetzt', rule: 'co2-split', terms: ['co2Split'] },
  'co2.share-approximated': { level: 'hint', title: 'CO₂-Abzug nach einer Näherung verteilt', rule: 'co2-split', terms: ['co2Split'] },
  'co2.exceeds-heating': { level: 'error', title: 'CO₂-Kosten höher als die Brennstoffkosten', rule: 'co2-split', terms: ['co2Split'] },
  'co2.pool-keys': { level: 'hint', title: 'Brennstoff nach verschiedenen Schlüsseln verteilt', rule: 'co2-split', terms: ['co2Split', 'allocationKey'] },
  'co2.restriction': { level: 'hint', title: 'CO₂-Anteil wegen Beschränkungen gekürzt', rule: 'co2-restriction', terms: ['co2Split', 'co2Stage'] },
  'co2.non-residential': { level: 'hint', title: 'CO₂-Kosten im Nichtwohngebäude', rule: 'co2-non-residential', terms: ['co2Split', 'co2Stage'] },
  'co2.short-period-agreed': { level: 'hint', title: 'Stufentabelle für einen kurzen Zeitraum gekürzt', rule: 'co2-split', terms: ['co2Stage'] },
  // Heizung PR 9 (#97, Entwurf 9.3 F9): Eine Position, deren Verteilbasis in zwei Anlagen reicht,
  // gehört zu keinem Topf. Verteilt wird sie weiter; ein Fehler, weil ihre CO₂-Kosten sich keiner
  // Einstufung zuordnen lassen.
  // Heizung PR 9: Kesseltausch in der Heizperiode; eingestuft wird über beide Anlagen.
  'co2.plant-replaced': { level: 'hint', title: 'Heizanlage im Zeitraum getauscht', rule: 'co2-split', terms: ['boilerSwap', 'co2Stage'] },
  // Heizung PR 9 (Recht I3 der Durchsicht von #238): mehrere Anlagen im selben Gebäude, gemeinsam eingestuft.
  // Heizung PR 9 (Recht I4 der Durchsicht von #238): Grundlage der Umlage bei einer Etagenheizung ungeklärt.
  'heating.per-unit-basis': { level: 'hint', title: 'Etagenheizung: Grundlage der Umlage prüfen', terms: ['perUnitHeating'] },
  'co2.building-joint': { level: 'hint', title: 'Anlagen im selben Gebäude gemeinsam eingestuft', rule: 'co2-split', terms: ['co2Stage', 'co2Area'] },
  // Heizung PR 9 (Durchsicht von #238, I2): Eine Anlage desselben Gebäudes heizt mit, ihr Ausstoß fehlt.
  'co2.classification-incomplete': { level: 'warning', title: 'Einstufung ohne eine Anlage des Gebäudes', rule: 'co2-split', terms: ['co2Stage', 'heatingSystem'] },
  'co2.item-spans-plants': { level: 'error', title: 'Heizposition über mehrere Heizanlagen', rule: 'co2-split', terms: ['co2Split', 'heatingSystem'] },
  // #211, Entwurf 7.7: Warmwasser nach einer Formel ohne bestätigten unzumutbaren Aufwand.
  // Heizung PR 8 (#97, #99): Brennstoffvorrat (Entwurf 8.2, 10.1). `fuel.stock-missing` ist hier eine
  // Warnung (Messdienst ohne Aufteilung, 3 %); den Fehler bei der eigenen Heizkostenabrechnung bringt
  // PR 10 mit eigenem Code, denn eine Stufe hängt am Code (#112).
  'fuel.stock-missing': { level: 'warning', title: 'Vorrat fehlt für die CO₂-Aufteilung', rule: 'co2-split', terms: ['fuelStock', 'co2Split'] },
  'fuel.stock-invalid': { level: 'error', title: 'Bestandsrechnung geht nicht auf', rule: 'heating-consumed-fuel', terms: ['fuelStock'] },
  'fuel.before-2023': { level: 'hint', title: 'Altbestand mit Rechnung vor 2023', rule: 'co2-split', terms: ['fuelStock', 'co2Split'] },
  'fuel.stock-date-differs': { level: 'hint', title: 'Tank nicht am Ende der Heizperiode gepeilt', rule: 'heating-consumed-fuel', terms: ['fuelStock'] },
  'fuel.manual-by-delivery': { level: 'warning', title: 'Heizkosten nach Lieferung statt nach Verbrauch', rule: 'heating-consumed-fuel', terms: ['fuelStock', 'co2Stage'] },
  // Durchsicht von #237: Bestand, den keine Abrechnung übernimmt (I2), schon umgelegter Anfangsbestand
  // (C1), Brennstoffposition ohne Lieferung neben dem Vorrat (I2a).
  // Kesseltausch (Heizung PR 9): Der Restbestand einer stillgelegten Anlage bleibt beim Vermieter.
  'fuel.stock-remaining': { level: 'hint', title: 'Restbestand nach Stilllegung der Heizanlage', rule: 'heating-consumed-fuel', terms: ['boilerSwap', 'fuelStock'] },
  'fuel.stock-not-taken-over': { level: 'warning', title: 'Endbestand wird nicht übernommen', rule: 'heating-consumed-fuel', terms: ['fuelStock'] },
  'fuel.opening-settled': { level: 'hint', title: 'Anfangsbestand schon umgelegt', rule: 'heating-consumed-fuel', terms: ['fuelStock'] },
  // Nachprüfung von #237 (N2): „nicht umgelegt“, obwohl die Vorperiode Heizkosten nach Lieferung verteilt hat.
  // Nachprüfung von 7ce5958, Befund 1: Vorbelegung nur nach Heizpositionen ohne Kennzeichen „Brennstoff“.
  'fuel.opening-settled-assumed': { level: 'warning', title: 'Anfangsbestand als umgelegt angenommen', rule: 'heating-consumed-fuel', terms: ['fuelStock'] },
  // Nachprüfung von 819398e: Heizkosten ohne Kennzeichen unter dem Wert des Anfangsbestands, ohne Antwort.
  'fuel.opening-check-loose': { level: 'hint', title: 'Heizkosten ohne Kennzeichen im Vorjahr', rule: 'heating-consumed-fuel', terms: ['fuelStock'] },
  'fuel.opening-not-settled': { level: 'warning', title: 'Anfangsbestand womöglich doppelt', rule: 'heating-consumed-fuel', terms: ['fuelStock'] },
  'fuel.stock-unlinked': { level: 'warning', title: 'Brennstoffposition ohne Lieferung', rule: 'heating-consumed-fuel', terms: ['fuelStock', 'fuelDelivery'] },
  // Heizung PR 10 (#99): eigene Heizkostenabrechnung (Entwurf 8, 10.1; Abweichungen 4 bis 6). Ein
  // Fehler heißt hier: Die Anlage wird nicht verteilt, ihre Positionen stehen beim Vermieter.
  'heating.self-incomplete': { level: 'error', title: 'Heizkostenabrechnung unvollständig', rule: 'heating-own-settlement', terms: ['heatingSystem', 'heatMeter'] },
  'heating.dhw-share-invalid': { level: 'error', title: 'Warmwasseranteil nicht bestimmbar', rule: 'heating-dhw-split', terms: ['hotWaterShare'] },
  'heating.heat-pump-dhw-basis': { level: 'error', title: 'Wärmepumpe ohne Gesamtwärmezähler', rule: 'heating-dhw-split', terms: ['hotWaterShare', 'heatMeter'] },
  'heating.target-invalid': { level: 'error', title: 'Ziel der Heizposition passt nicht', rule: 'heating-own-settlement', terms: ['heatingSystem', 'hotWaterShare'] },
  'fuel.stock-missing-self': { level: 'error', title: 'Vorrat fehlt bei der eigenen Heizkostenabrechnung', rule: 'heating-consumed-fuel', terms: ['fuelStock', 'heatingSystem'] },
  // Ablesungen und Nutzerwechsel (Entwurf 3.5, 15.2 F2, F3); eine Stufe je Code (Abweichungen 2, 3).
  'heating.interim-reading-off': { level: 'hint', title: 'Zwischenablesung neben dem Wechsel', rule: 'heating-tenant-change', terms: ['interimReading', 'degreeDays'] },
  'heating.interim-reading-far': { level: 'warning', title: 'Zwischenablesung weit neben dem Wechsel', rule: 'heating-tenant-change', terms: ['interimReading', 'degreeDays'] },
  'heating.no-interim-reading': { level: 'hint', title: 'Zwischenablesung nicht möglich', rule: 'heating-tenant-change', terms: ['interimReading', 'degreeDays'] },
  'heating.no-interim-reading-missed': { level: 'warning', title: 'Zwischenablesung nicht durchgeführt', rule: 'heating-tenant-change', terms: ['interimReading'] },
  'heating.reading-dates-differ': { level: 'hint', title: 'Ablesung neben dem Stichtag', rule: 'heating-reading-date', terms: ['heatMeter', 'degreeDays'] },
  'heating.reading-dates-far': { level: 'warning', title: 'Ablesung weit neben dem Stichtag', rule: 'heating-reading-date', terms: ['heatMeter', 'degreeDays'] },
  'heating.no-consumption': { level: 'warning', title: 'Kein Verbrauch erfasst', rule: 'heating-consumption', terms: ['consumptionCosts', 'heatMeter'] },
  // Durchsicht von #239: „Weiß ich nicht“ beim Wärmeschutz und weniger als der Pflichtanteil (C1), die
  // Angaben nach § 6a Abs. 3 bis PR 14 (I1).
  'heating.share-forced-unsure': { level: 'warning', title: 'Pflichtanteil nach Verbrauch ungeklärt', rule: 'heating-own-settlement', terms: ['forcedConsumptionShare', 'consumptionCosts'] },
  'heating.self-6a-missing': { level: 'warning', title: 'Angaben nach § 6a HeizkostenV fehlen', rule: 'heating-own-settlement', terms: ['heatingCostOrdinance', 'consumptionCosts'] },
  'heating.key-change': { level: 'hint', title: 'Anteil nach Verbrauch geändert', rule: 'heating-key-change', terms: ['consumptionCosts', 'keyChange'] },
  'heating.change-split-time': { level: 'hint', title: 'Mieterwechsel zeitanteilig statt nach Gradtagen', rule: 'heating-tenant-change', terms: ['interimReading', 'degreeDays'] },
  'heating.change-fee': { level: 'hint', title: 'Kosten der Zwischenablesung', rule: 'heating-tenant-change', terms: ['interimReading'] },
  'heating.heat-pump-capture': { level: 'hint', title: 'Wärmepumpe: Heizkostenverordnung gilt noch nicht', rule: 'heating-own-settlement', terms: ['heatingSystem', 'heatMeter'] },
  // Warmwasseranteil auf der Schätzung beim Abschluss (Abweichung 11).
  'heating.dhw-share-estimated': { level: 'hint', title: 'Warmwasseranteil aus geschätzter Energie', rule: 'heating-own-settlement', terms: ['hotWaterShare'] },
  'heating.dhw-not-metered': { level: 'warning', title: 'Warmwasser ohne Wärmezähler abgerechnet', rule: 'heating-dhw-split', terms: ['hotWaterShare', 'heatingCostOrdinance'] },
  // Heizung PR 11 (Entwurf 8.3, 10.1; Abweichung 9 des Plans).
  'heating.heating-value-from-table': { level: 'hint', title: 'Heizwert aus der Tabelle der Heizkostenverordnung', rule: 'heating-dhw-split', terms: ['hotWaterShare'] },
  // Plausibilität ohne Rechtsfolge (Entwurf 15.2 F6), deshalb ohne Regel.
  'heating.dhw-share-implausible': { level: 'hint', title: 'Warmwasseranteil ungewöhnlich', terms: ['hotWaterShare'] },
  'heating.heat-pump-majority-open': { level: 'warning', title: 'Wärmepumpe: Ausnahme der Heizkostenverordnung ungeklärt', rule: 'heating-own-settlement', terms: ['heatingSystem', 'heatingCostOrdinance'] },
  'heating.heat-pump-old-exemption': { level: 'hint', title: 'Wärmepumpe: Heizkostenverordnung galt in diesem Zeitraum nicht', rule: 'heating-own-settlement', terms: ['heatingSystem', 'heatingCostOrdinance'] },
  // Heizung PR 12 (Entwurf 8.1, 10.1)
  // Ein Hinweis (Durchsicht von #241, Minor 6): Gerechnet wird mit den Ständen an den Grenzen; fehlt einer,
  // sperrt `heating.self-incomplete`.
  'heating.device-cutoff': { level: 'hint', title: 'Stichtag eines Heizkostenverteilers mitten in der Heizperiode', rule: 'heating-own-settlement', terms: ['heatCostAllocator'] },
  'heating.mixed-capture': { level: 'error', title: 'Verschiedene Geräte in einer Heizanlage', rule: 'heating-own-settlement', terms: ['heatCostAllocator'] },
  'heating.hca-factor-missing': { level: 'error', title: 'Skala oder Bewertungsfaktor fehlt', rule: 'heating-own-settlement', terms: ['heatCostAllocator'] },
  'model.prepayment-unsettled': { level: 'warning', title: 'Vorauszahlung ohne Abrechnung', terms: ['prepayment', 'flatRate'] },
  'prepayment.arrears': { level: 'warning', title: 'Rückstand im Mietkonto', terms: ['prepayment'] },
  // #141: ein Hinweis und kein Fehler, denn eine vereinbarte Änderung ist zulässig.
  'key.changed-from-previous-year': { level: 'hint', title: 'Umlageschlüssel anders als im Vorjahr', terms: ['keyChange', 'allocationKey'] },
  // Dieselbe Rechnung zweimal erfasst? (Zusammenspiel #141 und #170, shared/duplicates.ts) Ein
  // Hinweis, denn zwei Rechnungen derselben Kostenart gibt es; zu prüfen ist es trotzdem, deshalb
  // zählt er in der Ampel des Cockpits mit.
  'cost.possible-duplicate': { level: 'hint', title: 'Dieselbe Rechnung zweimal erfasst?', terms: ['allocable'] },
  // Abrechnungszeitraum (#208, Entwurf 3.4, 3.6, 10.1)
  'period.short': { level: 'hint', title: 'Rumpfzeitraum', terms: ['shortPeriod', 'billingPeriod'] },
  'period.item-outside': { level: 'warning', title: 'Leistungszeitraum außerhalb des Abrechnungszeitraums', terms: ['accrualPrinciple', 'billingPeriod'] },
  'period.heating-mismatch': { level: 'warning', title: 'Heizkosten aus einem anderen Zeitraum', terms: ['accrualPrinciple', 'heatingCostOrdinance'] },
  'period.short-heating-whole': { level: 'warning', title: 'Heizrechnung ganz im Rumpfzeitraum', terms: ['shortPeriod', 'accrualPrinciple'] },
  'period.split-by-days-meter': { level: 'hint', title: 'Verbrauch nach Tagen aufgeteilt', terms: ['accrualPrinciple', 'meterReading'] },
  'prepayment.no-suggestion': { level: 'hint', title: 'Kein Vorschlag für die Vorauszahlung', terms: ['prepayment', 'degreeDays'] },
  'prepayment.annual-assumed': { level: 'hint', title: 'Rechnung ohne Leistungszeitraum im Rumpf', terms: ['prepayment', 'shortPeriod', 'accrualPrinciple'] },
  'period.heating-differs': { level: 'hint', title: 'Eigene Heizperiode', terms: ['heatingPeriod', 'billingPeriod'] },
  'period.heating-only-statement': { level: 'warning', title: 'Abrechnung nur mit Heizkosten', terms: ['heatingPeriod', 'settlementDeadline'] },
  'period.no-heating-period': { level: 'warning', title: 'Keine Heizperiode in diesem Zeitraum', terms: ['heatingPeriod'] },
  'prepayment.heating-share-missing': { level: 'hint', title: 'Heizvorauszahlung nicht aufgeteilt', terms: ['heatingPeriod', 'prepayment'] },
  'prepayment.heating-share-unchanged': { level: 'hint', title: 'Heizvorauszahlung unverändert', terms: ['prepayment'] },
  'prepayment.heating-override-pending': { level: 'warning', title: 'Heizkorrektur vorläufig', terms: ['heatingPeriod', 'prepayment'] },
} satisfies Record<string, NoticeKind>
// Was die eigene CO₂-Aufteilung liest (Heizung PR 7 und 8): aus den Lieferungen des Versorgers oder aus
// der Bestandsrechnung des Vorrats. `stock`: aus dem Vorrat.
type OwnFuel = {
  emissionsKg: number | null
  co2Cents: number | null
  serviceCo2Cents: number | null
  serviceGrossCents: number | null
  missingCo2: string[]
  coveragePermille: number
  stock: boolean
}

export type NoticeCode = keyof typeof noticeKinds
export const NOTICE_KINDS: Readonly<Record<string, NoticeKind | undefined>> = noticeKinds

function makeNotice(code: NoticeCode, text: string, subject: NoticeSubject | undefined): Notice {
  const kind: NoticeKind = noticeKinds[code]
  return { code, level: kind.level, title: kind.title, text, ...(subject ? { subject } : {}), ...(kind.rule ? { rule: kind.rule } : {}), terms: kind.terms }
}
const itemSubject = (item: { id: string }): NoticeSubject => ({ kind: 'costItem', id: item.id })
const meterSubject = (reading: SnapshotReading): NoticeSubject => ({ kind: 'meter', id: reading.meterId })
// Nennt eine Meldung mehrere Wohnungen oder Mietverhältnisse, führt der Knopf zur ersten; die
// Seite ist dieselbe.
const unitSubject = (units: { id: string }[]): NoticeSubject | undefined => (units[0] ? { kind: 'unit', id: units[0].id } : undefined)
const tenancySubject = (tenancies: { id: string }[]): NoticeSubject | undefined =>
  tenancies[0] ? { kind: 'tenancy', id: tenancies[0].id } : undefined

// ---------- Zähler & Verbrauch ----------

type MeterSegment = { from: string, to: string, delta: number, days: number }

// Ablesungen eines Zählers → Verbrauchssegmente zwischen aufeinanderfolgenden Ablesungen.
// Konvention: eine Ablesung gilt zum Tagesende ihres Datums. Bei Zählerwechsel trägt die
// Ablesung replacement=true: oldEndValue = Endstand des alten Geräts, value = Startstand des neuen.
// Zählerstände haben mehr Nachkommastellen als Geld: Ein Wasserzähler zeigt drei. Mit `fmtNum`
// (zwei Stellen) meldete die Warnung unten bei 150,001 gegen 150,004 einen „Unterschied von 0“
// und widerspräche sich damit selbst.
function fmtMeter(n: number): string {
  return n.toLocaleString('de-DE', { maximumFractionDigits: 3 })
}

// Ein Datum in den Meldungen der Zähler deutsch, wie überall in der Oberfläche (#142): Der
// Vermieter liest „am 01.07.2025“ und nicht „am 2025-07-01“. Aus der Zeichenkette gebaut und nicht
// über `Date`, damit keine Zeitzone einen Tag verschiebt.
// kg mit bis zu zwei, Promille mit einer Nachkommastelle (Heizung PR 8; Entwurf 3.5 „27,4 ‰“).
const fmtKg = (kg: number): string => kg.toLocaleString('de-DE', { maximumFractionDigits: 2 })
const fmtPermille = (pm: number): string => (Math.round(pm * 10) / 10).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

function fmtDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso
}

export function meterSegments(readings: SnapshotReading[]): { segments: MeterSegment[], notices: Notice[], warnings: string[] } {
  const sorted = readings.slice().sort((a, b) => compareText(a.date, b.date))
  const segments: MeterSegment[] = []
  const notices: Notice[] = []
  const warn = (code: NoticeCode, text: string, subject?: NoticeSubject) => notices.push(makeNotice(code, text, subject))
  // Je Tag die Menge, die zwischen Ablesungen desselben Tages herausfällt (#69, unten begründet).
  const lostPerDay = new Map<string, number>()
  for (let i = 1; i < sorted.length; i++) {
    const r0 = sorted[i - 1]
    const r1 = sorted[i]
    // **Ein Zählerwechsel ohne Endstand des alten Geräts ist keine Angabe, sondern eine Lücke**
    // (#83). Er wird mit `replacement` gekennzeichnet, und der letzte Stand des alten Geräts
    // steht in `oldEndValue`. Fehlt das Feld, las ein `?? 0` es als Null, und aus einem
    // Zählerstand von 980 wurde ein Segment von minus 980; gemessen ergab das einen
    // Jahresverbrauch von minus 910. Das ist nicht bloß eine falsche Zahl: Beim
    // Verbrauchsschlüssel geht sie in die Verteilbasis ein und verschiebt die Anteile aller
    // Mieter, ohne dass irgendwo etwas auffällt.
    //
    // **Gefragt wird nach `null` und nicht nach dem Wert**, denn genau dieses Zusammenwerfen war
    // der Fehler. Ein ausdrücklich eingetragener Endstand von 0 ist eine Angabe: Der alte Zähler
    // stand auf null, lief also rückwärts, und dafür gibt es die Meldung weiter unten.
    //
    // Verteilt wird nichts, und erfunden erst recht nichts. Wie viel das alte Gerät bis zum
    // Wechsel verbraucht hat, weiß nur der Vermieter; das neue rechnet ab seinem Startstand
    // normal weiter. Dieselbe Haltung wie bei zwei Ablesungen am selben Tag (#69).
    //
    // **Und dieselbe Folge: Bezahlt wird die Lücke von einem anderen Mieter**, nicht vom
    // Vermieter. Gemessen an zwei Wohnungen mit 2.000 € Wasser sinkt der Anteil des Mieters mit
    // der Lücke von 802,40 € auf 540,15 €, während der andere 1.459,85 € statt 1.197,60 € zahlt.
    // Deshalb ist die Meldung das Einzige, was den Vermieter darauf stößt: Auf der Abrechnung
    // liest sich der Rechenweg völlig plausibel.
    //
    // **Steht ein solcher Wechsel als allererste Ablesung des Zählers da, gibt es keine
    // Meldung**, denn die Schleife beginnt beim zweiten Eintrag. Das ist richtig so: Ohne
    // Vorgänger fehlt nichts, es gibt keinen Zeitraum, über den das alte Gerät gelaufen wäre.
    if (r1.replacement && r1.oldEndValue == null) {
      warn('meter.replacement-without-end',
        `Zählerwechsel am ${fmtDay(r1.date)} ohne Endstand des alten Geräts — der Verbrauch bis zum ` +
          'Wechsel lässt sich nicht bestimmen und wird nicht verteilt. Bitte den Endstand nachtragen.',
        meterSubject(r1),
      )
      continue
    }

    const delta = r1.replacement ? (r1.oldEndValue ?? 0) - r0.value : r1.value - r0.value
    const days = Math.round((toUTC(r1.date) - toUTC(r0.date)) / MS_DAY)

    // **Ablesungen am selben Tag: die Differenz verschwindet, und das wird gesagt** (#69).
    //
    // Ein Segment entsteht nur, wenn mindestens ein Tag dazwischenliegt, sonst müsste durch null
    // geteilt werden, um tagesanteilig zu verteilen. Das ist richtig. Bisher fiel die Differenz
    // dabei aber ersatzlos und ohne Meldung unter den Tisch.
    //
    // **Wer das bezahlt, ist nachgemessen, und es ist nicht der Vermieter.** Beim
    // Verbrauchsschlüssel ist die Verteilbasis die Summe des *gemessenen* Verbrauchs: Fehlt bei
    // einem Zähler etwas, schrumpfen Zähler und Nenner gemeinsam, und `largestRemainder` verteilt
    // den Rechnungsbetrag trotzdem vollständig. Gemessen an zwei Wohnungen mit je 100 m³ und
    // 2.000 € Wasser, mit einem Tippfehler von 10 m³ bei Mieter A: A zahlt 947,37 € statt
    // 1.000 €, **B zahlt 1.052,63 €**, der Vermieter trägt in beiden Fällen nichts. Liegt die
    // Doppelablesung am Zähler einer selbstgenutzten Wohnung, dreht es sich um und der Vermieter
    // zahlt zu wenig. Das ist schlimmer als ein Verlust beim Vermieter: Ein Mieter bekommt eine
    // zugestellte Abrechnung mit zu viel darauf, und niemandem fällt es auf.
    //
    // **Verteilt wird trotzdem nicht.** Das Haus hat für zwei Einträge zum selben Stichtag eine
    // ausformulierte Regel, nämlich „es gilt der letzte“ (`lastPerFrom` in schedule.ts), und sie
    // käme hier auf das Richtige: Bei einer Korrektur gölte der zweite Stand, beim Zählerwechsel
    // der `oldEndValue`. Sie greift hier aus zwei Gründen trotzdem nicht.
    //
    // Erstens bräuchte sie eine Ausnahme, nämlich dass die Wechsel-Ablesung immer gewinnt. Sonst
    // löschte eine zufällige Eingabereihenfolge — erst der Wechsel, dann eine gewöhnliche
    // Ablesung desselben Tages — den `oldEndValue` und mit ihm den ganzen Zählerwechsel. Das wäre
    // eine neue Regel, und neue Regeln über Geld werden nicht nebenbei eingeführt.
    //
    // Zweitens, und das wiegt schwerer: Eine Doppelablesung liegt am wahrscheinlichsten auf einer
    // Grenze, also am 31. Dezember oder am Auszugstag. Dort gehören die beiden Nachbarsegmente
    // **verschiedenen Mietern**. Die Menge einem davon zuzuschlagen hieße, still einen von beiden
    // auszuwählen, und welcher der richtige ist, weiß nur der Vermieter. Ihn zu fragen ist die
    // einzige Antwort, die nicht rät.
    //
    // **Eine Meldung je Tag, nicht je Paar.** Bei drei Ablesungen am selben Tag stünde sonst
    // zweimal wortgleich dasselbe da, und das Wort „zwei“ stimmte nicht mehr. Summiert ergibt
    // sich genau die Menge, die am Ende fehlt: Bei 150, 160, 150 heben sich die beiden Sprünge
    // auf, es fehlt nichts, und es gibt zu Recht keine Meldung.
    //
    // **Hier gilt diese Meldung und nicht die über negativen Verbrauch**, auch wenn die Differenz
    // negativ ist. Jene spricht von einem Zähler, der über die Zeit zurückläuft, und über null
    // Tage gibt es diese Zeit nicht; ihr Wortlaut wäre an dieser Stelle in beiden Hälften falsch
    // („zwischen dem 30.06. und dem 30.06.“ ist kein Zeitraum, und „Zählerwechsel markieren“ ist
    // gerade beim markierten Zählerwechsel der falsche Rat).
    if (days === 0) {
      if (delta !== 0) lostPerDay.set(r0.date, (lostPerDay.get(r0.date) ?? 0) + delta)
      continue
    }

    if (delta < 0) {
      warn('meter.negative', `Negativer Verbrauch zwischen dem ${fmtDay(r0.date)} und dem ${fmtDay(r1.date)} (${fmtMeter(delta)}) — Ablesung prüfen oder Zählerwechsel markieren.`, meterSubject(r1))
    }
    segments.push({ from: r0.date, to: r1.date, delta, days })
  }
  for (const [date, lost] of lostPerDay) {
    // Heben sich mehrere Sprünge desselben Tages auf, fehlt nichts.
    if (lost === 0) continue
    warn('meter.same-day',
      `Mehrere Ablesungen am ${fmtDay(date)}: Die Stände unterscheiden sich um ${fmtMeter(Math.abs(lost))}, ` +
        'und diese Menge wird nicht verteilt, weil zwischen ihnen kein Tag liegt. ' +
        'Bitte eine der Ablesungen prüfen.',
      sorted[0] && meterSubject(sorted[0]),
    )
  }
  return { segments, notices, warnings: notices.map((n) => n.text) }
}

// Verbrauch im Zeitraum [from, to] (inklusive Tage). Segmente werden tagesanteilig
// interpoliert — liegt eine Ablesung genau auf der Zeitraumgrenze (z. B. Zwischenablesung
// beim Mieterwechsel), ist die Aufteilung exakt.
export function consumptionInPeriod(readings: SnapshotReading[], from: string, to: string): number {
  const { segments } = meterSegments(readings)
  let sum = 0
  const pStart = toUTC(from) - MS_DAY // Zeitraum beginnt nach Tagesende des Vortags
  const pEnd = toUTC(to)
  for (const s of segments) {
    const s0 = toUTC(s.from)
    const s1 = toUTC(s.to)
    const overlap = Math.min(pEnd, s1) - Math.max(pStart, s0)
    if (overlap <= 0) continue
    sum += s.delta * (overlap / MS_DAY / s.days)
  }
  return sum
}

// Ein Eintrag der Jahresübersicht für die Zähler-Seite (Verbrauch je Zähler)
// Tage im Zeitraum [from, to], die Segmente des Zählers abdecken (#116). Eine Ablesung gilt
// zum Tagesende, ein Segment deckt also die Tage nach seiner ersten Ablesung bis einschließlich
// seiner letzten. Eine Lücke, etwa ein Zählerwechsel ohne Endstand, deckt nichts ab.
function coveredDays(readings: SnapshotReading[], from: string, to: string): number {
  return meterSegments(readings).segments.reduce(
    (a, seg) => a + rangeOverlapDays(new Date(toUTC(seg.from) + MS_DAY).toISOString().slice(0, 10), seg.to, from, to),
    0,
  )
}

// Wie viele Tage die Zähler einer Einheit zusammen abdecken. Zähler laufen **nebeneinander**
// (Küche und Bad, jeder muss das ganze Jahr abdecken) oder **nacheinander** (ein Tausch, als neuer
// Zähler angelegt statt als Wechsel; sie decken es gemeinsam ab), und oft beides zugleich. Deshalb
// werden die Zähler zu Ketten sortiert: Ein Zähler hängt sich an eine Kette, deren letzter Zähler
// endete, bevor er begann; sonst beginnt er eine neue. Jede Kette steht für eine Messstelle, und
// jede muss das Jahr abdecken, es zählt also die kürzeste Kette (zweite Integrationsdurchsicht).
// Ein Zähler, der vor dem Jahr endete, ist Geschichte und fällt weg; ein Zähler ohne jede Ablesung
// zählt als Messstelle ohne Abdeckung, sonst gälte ein vergessenes Bad als gemessen.
function unitCoveredDays(readingsPerMeter: SnapshotReading[][], from: string, to: string): number {
  const spans: { from: string, to: string, days: number }[] = []
  for (const readings of readingsPerMeter) {
    const segs = meterSegments(readings).segments
    const first = segs[0]
    const last = segs[segs.length - 1]
    if (!first || !last) return 0
    const days = coveredDays(readings, from, to)
    if (days === 0 && compareText(last.to, from) < 0) continue
    spans.push({ from: first.from, to: last.to, days })
  }
  if (spans.length === 0) return 0
  spans.sort((a, b) => compareText(a.from, b.from) || compareText(a.to, b.to))
  const chains: { to: string, days: number }[] = []
  for (const sp of spans) {
    const chain = chains.find((c) => compareText(c.to, sp.from) <= 0)
    if (chain) {
      chain.to = sp.to
      chain.days += sp.days
    } else {
      chains.push({ to: sp.to, days: sp.days })
    }
  }
  return Math.min(...chains.map((c) => c.days))
}

export type ConsumptionOverviewRow = {
  meterId: string
  consumption: number
  readingCount: number
  notices: Notice[]
  warnings: string[]
}

// Übersicht für die Zähler-Seite über den Zeitraum der Abrechnung (#208): Verbrauch pro Zähler + Warnungen
export function consumptionOverview(snapshot: Snapshot): ConsumptionOverviewRow[] {
  const { from, to } = snapshot.period
  return snapshot.meters.map((m) => {
    const readings = snapshot.readings.filter((r) => r.meterId === m.id)
    const { notices, warnings } = meterSegments(readings)
    return {
      meterId: m.id,
      consumption: Math.round(consumptionInPeriod(readings, from, to) * 100) / 100,
      readingCount: readings.length,
      notices,
      warnings,
    }
  })
}

// ---------- Vorauszahlungen ----------

// Vorauszahlungen eines Abrechnungszeitraums (#208): pro Monat des Zeitraums zählt der
// Staffelbetrag, der am Monatsersten gilt — sofern das Mietverhältnis am Monatsersten besteht. Eine
// Korrektur für den Zeitraum (tatsächlich gezahlter Betrag) hat immer Vorrang, denn rechtlich sind
// die tatsächlich geleisteten Vorauszahlungen anzusetzen.
function basePrepaymentCents(tenancy: SnapshotTenancy, period: Pick<BillingPeriod, 'key' | 'from' | 'to'>): { cents: number, overridden: boolean } {
  const override = tenancy.prepaymentOverrides?.[period.key]
  if (override != null) return { cents: override, overridden: true }
  // `prepaymentMonthlyCents` gibt es im heutigen Tenancy-Typ nicht mehr (Altformat, siehe
  // Migration in store.ts). Diese Funktion wird aber auch mit ungewanderten Altbeständen
  // aufgerufen (siehe calc.test.ts), deshalb führt `SnapshotTenancy` das Feld weiterhin.
  const schedule = (
    tenancy.prepayments?.length
      ? tenancy.prepayments
      : tenancy.prepaymentMonthlyCents != null // Altformat: ein fester Monatsbetrag
        ? [{ from: tenancy.start.slice(0, 7), monthlyCents: tenancy.prepaymentMonthlyCents }]
        : []
  )
    .slice()
    .sort((a, b) => compareText(a.from, b.from))
  let cents = 0
  for (const month of periodMonths(period)) {
    const firstDay = `${month}-01`
    if (tenancy.start > firstDay) continue
    if (tenancy.end && tenancy.end < firstDay) continue
    let rate = 0
    for (const e of schedule) if (e.from <= month) rate = e.monthlyCents
    cents += rate
  }
  return { cents, overridden: false }
}

// Die Heizvorauszahlung in einer Abrechnung P (Heizung PR 5, Entwurf 6.1 Nr. 5). `ownerOf` nennt die
// getrennt abgerechnete Heizperiode, der ein Monat gehört; ihn rechnet dann nicht P an, sondern deren
// Heizkostenabrechnung. Ohne Angabe rechnet P jeden Monat der Heizstaffel an.
export type HeatingCredit = { ownerOf: (month: string) => PeriodKey | null }

// Vorauszahlungen eines Abrechnungszeitraums (#208): die übrigen (`prepayments`) und die Heizstaffel
// der Monate, die P gehören (Heizung PR 5). **Die Jahreskorrektur von P gilt für alles, was P
// anrechnet** (3.7): Bei Weg d enthält sie nur noch die übrigen Vorauszahlungen, weil P keinen Monat
// der Heizstaffel mehr anrechnet; bei H = P mit getrennter Vorauszahlung beide. Eine Aufteilung kennt
// die Korrektur nicht, deshalb fehlt dann `heatingCents`. Ohne Heizstaffel genau wie vorher.
export function computePrepaymentCents(
  tenancy: SnapshotTenancy,
  period: Pick<BillingPeriod, 'key' | 'from' | 'to'>,
  heating?: HeatingCredit,
): { cents: number, overridden: boolean, heatingCents?: number } {
  const base = basePrepaymentCents(tenancy, period)
  const schedule: MonthlySchedule[] = Array.isArray(tenancy.heatingPrepayments) ? tenancy.heatingPrepayments : []
  if (schedule.length === 0 || base.overridden) return base
  const months = periodMonths(period).filter((m) => tenancy.start <= `${m}-01` && !(tenancy.end && tenancy.end < `${m}-01`))
  const heatingCents = months.filter((m) => (heating?.ownerOf(m) ?? null) === null).reduce((a, m) => a + rateAtMonth(schedule, m), 0)
  return { cents: base.cents + heatingCents, overridden: false, heatingCents }
}

// Die Heizvorauszahlung in der Heizkostenabrechnung einer Heizperiode (Weg d, Entwurf 3.1, D2 der
// achten Fassung). `owns` sagt, welche Monate dieser Heizperiode ihre Heizstaffel hier anrechnen
// (`separateOwner`); die übrigen, die Monate vor X, rechnet die Abrechnung des Objekts an, und die
// Heizkostenabrechnung nennt sie (`elsewhere`, C3). Eine endgültige Korrektur ersetzt die Anrechnung
// der ganzen Heizperiode; eine vorläufige nur ihre Monate, die übrigen rechnen nach der Staffel.
export function heatingPrepaymentCents(
  tenancy: SnapshotTenancy,
  plantId: string,
  h: Pick<BillingPeriod, 'key' | 'from' | 'to'>,
  owns: (month: string) => boolean = () => true,
): { cents: number, overridden: boolean, provisional: HeatingPrepaymentOverride | null, elsewhere: string[] } {
  const schedule: MonthlySchedule[] = Array.isArray(tenancy.heatingPrepayments) ? tenancy.heatingPrepayments : []
  const months = periodMonths(h).filter((m) => tenancy.start <= `${m}-01` && !(tenancy.end && tenancy.end < `${m}-01`))
  const mine = months.filter(owns)
  const elsewhere = months.filter((m) => !owns(m))
  const staffel = (list: readonly string[]): number => list.reduce((a, m) => a + rateAtMonth(schedule, m), 0)
  const override = (tenancy.heatingPrepaymentOverrides ?? []).find((o) => o.plantId === plantId && o.period === h.key)
  if (override && !override.provisional) return { cents: override.cents, overridden: true, provisional: null, elsewhere }
  if (override && override.fromMonth !== null && override.toMonth !== null) {
    const from = override.fromMonth
    const to = override.toMonth
    return { cents: override.cents + staffel(mine.filter((m) => m < from || m > to)), overridden: true, provisional: override, elsewhere }
  }
  return { cents: staffel(mine), overridden: false, provisional: null, elsewhere }
}

// ---------- Mietkonto / Zahlungs-Tracking ----------

type MonthlySchedule = { from: string, monthlyCents: number }

// Staffelbetrag, der am Monatsersten gilt (für Kaltmiete oder Vorauszahlung).
// `schedule`: Array aus { from: 'YYYY-MM', monthlyCents }. firstMonth: 'YYYY-MM'.
function rateAtMonth(schedule: MonthlySchedule[], firstMonth: string): number {
  let rate = 0
  for (const e of schedule.slice().sort((a, b) => compareText(a.from, b.from))) {
    if (e.from <= firstMonth) rate = e.monthlyCents
  }
  return rate
}

// Die Monatsrechnung für Abrechnung und Mietkonto (#208): je Mietverhältnis das Soll je Monat
// (Bruttomiete = Kaltmiete + Vorauszahlung + Pauschale) und die Zahlungen der Spanne, von vorn auf die
// Monate verteilt; so spiegelt der Status („bezahlt / teilweise / offen“) wider, bis zu welchem Monat
// das Konto gedeckt ist. Das Mietkonto ruft sie mit den zwölf Monaten des Kalenderjahres, die
// Abrechnung mit den Monaten ihres Zeitraums: eine Monatsregel und nicht zwei. `month` ist der
// Kalendermonat (1..12), in höchstens zwölf aufeinanderfolgenden Monaten also eindeutig.
//
// **Fällig ist nur, was vor dem Monat des Stichtags liegt** (#133). Die Miete ist bis zum dritten
// Werktag fällig (§ 556b Abs. 1 BGB), und eine Überweisung braucht ein paar Tage, bis sie gebucht
// ist; den laufenden Monat erst ab einem bestimmten Tag mitzuzählen, hinge an Wochenenden und
// Feiertagen. Liegt der Stichtag nach der Spanne, ist alles fällig, liegt er davor, nichts. Ohne
// Stichtag (Steuer, Regression, Tests) gilt die ganze Spanne als fällig. Die Berechnung fragt nie
// selbst nach „heute“; die Routen reichen den Tag hinein.
export function ledgerRows(
  source: Pick<Snapshot, 'units' | 'tenancies' | 'payments'>,
  span: Pick<BillingPeriod, 'from' | 'to'>,
  options: { asOf?: string } = {},
): RentLedgerRow[] {
  const months = periodMonths(span)
  const asOfMonth = options.asOf?.slice(0, 7)
  const dueMonths = asOfMonth === undefined ? months.length : months.filter((m) => m < asOfMonth).length
  const unitById = new Map(source.units.map((u) => [u.id, u]))
  // Der Schnappschuss führt alle Zahlungen. Welche zur Spanne zählt, entscheidet diese Rechnung
  // nach ihrem Datum, und diese Regel bleibt bewusst an dieser Stelle.
  return source.tenancies
    .filter((t) => rangeOverlapDays(t.start, t.end, span.from, span.to) > 0)
    .map((t) => {
      const baseSchedule: MonthlySchedule[] = Array.isArray(t.baseRents) ? t.baseRents : []
      const ppSchedule: MonthlySchedule[] = Array.isArray(t.prepayments) ? t.prepayments : []
      const flatSchedule: MonthlySchedule[] = Array.isArray(t.flatRates) ? t.flatRates : []
      // Die Heizstaffel (Heizung PR 5, Entwurf 3.11): im Soll neben der übrigen Vorauszahlung. Die
      // Felder dazu stehen nur in Zeilen mit Heizstaffel, damit sich ohne sie nichts ändert.
      const heatingSchedule: MonthlySchedule[] = Array.isArray(t.heatingPrepayments) ? t.heatingPrepayments : []
      const withHeating = heatingSchedule.length > 0
      const rowMonths = months.map((mm): RentMonth => {
        const firstDay = `${mm}-01`
        const active = t.start <= firstDay && !(t.end && t.end < firstDay)
        const baseRentCents = active ? rateAtMonth(baseSchedule, mm) : 0
        const prepaymentCents = active ? rateAtMonth(ppSchedule, mm) : 0
        const flatRateCents = active ? rateAtMonth(flatSchedule, mm) : 0
        const heatingPrepaymentCents = active && withHeating ? rateAtMonth(heatingSchedule, mm) : 0
        return {
          month: Number(mm.slice(5, 7)),
          baseRentCents,
          prepaymentCents,
          ...(withHeating ? { heatingPrepaymentCents } : {}),
          flatRateCents,
          sollCents: baseRentCents + prepaymentCents + heatingPrepaymentCents + flatRateCents,
          paidCents: 0,
          status: 'open',
        }
      })
      // Zahlungseingänge der Spanne der Reihe nach auf die Monate verteilen
      const paidYearCents = source.payments
        .filter((p) => p.tenancyId === t.id && p.date >= span.from && p.date <= span.to)
        .reduce((a, p) => a + p.amountCents, 0)
      let remaining = paidYearCents
      for (const [k, mo] of rowMonths.entries()) {
        if (mo.sollCents <= 0) {
          // kein Soll → als gedeckt behandeln, kein Geld verbrauchen
          mo.status = 'paid'
          continue
        }
        const applied = Math.max(0, Math.min(remaining, mo.sollCents))
        mo.paidCents = applied
        remaining -= applied
        mo.status = applied >= mo.sollCents ? 'paid' : k >= dueMonths ? 'notDue' : applied > 0 ? 'partial' : 'open'
      }
      const sollYearCents = rowMonths.reduce((a, mo) => a + mo.sollCents, 0)
      const dueSollCents = rowMonths.filter((_, k) => k < dueMonths).reduce((a, mo) => a + mo.sollCents, 0)
      return {
        tenancyId: t.id,
        tenantName: t.tenantName,
        unitName: unitById.get(t.unitId)?.name ?? '—',
        months: rowMonths,
        sollYearCents,
        baseRentYearCents: rowMonths.reduce((a, mo) => a + mo.baseRentCents, 0),
        prepaymentYearCents: rowMonths.reduce((a, mo) => a + mo.prepaymentCents, 0),
        flatRateYearCents: rowMonths.reduce((a, mo) => a + mo.flatRateCents, 0),
        ...(withHeating ? { heatingPrepaymentYearCents: rowMonths.reduce((a, mo) => a + (mo.heatingPrepaymentCents ?? 0), 0) } : {}),
        paidYearCents,
        balanceCents: paidYearCents - sollYearCents,
        dueSollCents,
        arrearsCents: Math.max(0, dueSollCents - paidYearCents),
        openMonths: rowMonths.filter((mo) => mo.status === 'open' || mo.status === 'partial').length,
      }
    })
    // Eine Liste, die ein Mensch liest: deutsche Sortierung, fest eingestellt (siehe compareName).
    .sort((a, b) => compareName(a.unitName, b.unitName) || compareName(a.tenantName, b.tenantName))
}

// Das Mietkonto bleibt im Kalenderjahr (#208, Entwurf 3.11), auch wenn die Abrechnung einen anderen
// Zeitraum hat: Es ist die Grundlage der Einnahmen in der Steuer. `asOf` wie bei der Abrechnung:
// Monate ab dem des Stichtags sind „noch nicht fällig“ und kein Rückstand (zweite Browserabnahme).
// Das Soll bleibt dasselbe, die Steuerübersicht hängt nicht daran.
export function rentLedger(snapshot: Snapshot, options: { asOf?: string } = {}): RentLedger {
  const rows = ledgerRows(snapshot, calendarYearPeriod(snapshot.year), options)
  return {
    year: snapshot.year,
    rows,
    totals: {
      sollYearCents: rows.reduce((a, r) => a + r.sollYearCents, 0),
      paidYearCents: rows.reduce((a, r) => a + r.paidYearCents, 0),
      openCents: rows.reduce((a, r) => a + r.arrearsCents, 0),
    },
  }
}

// ---------- §35a-Lohnanteil ----------

// Gilt der §35a-Lohnanteil einer Position (#148)? Er muss zwischen 0 und dem Rechnungsbetrag
// liegen; an einer Gutschrift gibt es deshalb keinen. Fehlt er, ist er 0. Ein ungültiger ergibt
// `null`: Die Abrechnung warnt dann (`labor35a.invalid`) und bescheinigt nichts, und die
// Steuerübersicht zählt ihn nicht. Einmal formuliert, damit beide nie Verschiedenes nennen.
export function validLabor35aCents(item: { amountCents: number, labor35aCents?: number | null }): number | null {
  const labor = item.labor35aCents ?? 0
  if (labor === 0) return 0
  return !Number.isFinite(labor) || labor < 0 || labor > item.amountCents ? null : labor
}

// ---------- Steuer-Export (Anlage V) ----------

// Betriebskostenarten den Anlage-V-nahen Positionsgruppen zuordnen. Bewusst beschreibende
// Gruppen statt fester Zeilennummern (die sich jährlich ändern können). Unbekannte Kategorien
// fallen auf „Sonstige Werbungskosten“.
// Ausgeführt für categories.test.ts, das die drei Listen der Kostenarten zusammenhält.
// `null` heißt: keine Werbungskosten dieses Jahres, sondern gesondert ausgewiesen (#143).
export const ANLAGE_V_GROUP: Record<string, string | null> = {
  Grundsteuer: 'Grundsteuer & öffentliche Abgaben',
  'Wasser/Abwasser': 'Laufende Betriebskosten',
  Niederschlagswasser: 'Laufende Betriebskosten',
  Müllabfuhr: 'Laufende Betriebskosten',
  Straßenreinigung: 'Laufende Betriebskosten',
  Gebäudereinigung: 'Laufende Betriebskosten',
  Gartenpflege: 'Laufende Betriebskosten',
  'Beleuchtung/Allgemeinstrom': 'Laufende Betriebskosten',
  Schornsteinfeger: 'Laufende Betriebskosten',
  Hauswart: 'Laufende Betriebskosten',
  Aufzug: 'Laufende Betriebskosten',
  'Kabel/Antenne': 'Laufende Betriebskosten',
  // #93: Heizung und Warmwasser sind laufende Betriebskosten wie Wasser und Strom.
  'Heizung und Warmwasser': 'Laufende Betriebskosten',
  'Sach- und Haftpflichtversicherung': 'Versicherungen',
  'Sonstige Betriebskosten': 'Sonstige Werbungskosten',
  'Nicht umlagefähig': 'Verwaltung & Instandhaltung',
  // #143: Die Zuführung zur Erhaltungsrücklage ist erst Werbungskosten, wenn und soweit die
  // Gemeinschaft sie für Erhaltungsmaßnahmen verausgabt (BFH, Urteil vom 14.01.2025, IX R 19/24).
  'Zuführung Erhaltungsrücklage': null,
}
// Anzeigereihenfolge der Gruppen in der Auswertung
export const ANLAGE_V_GROUP_ORDER = [
  'Grundsteuer & öffentliche Abgaben',
  'Laufende Betriebskosten',
  'Versicherungen',
  'Verwaltung & Instandhaltung',
  'Sonstige Werbungskosten',
]

// Jahres-Steuerübersicht (Hilfe für die Anlage V): das vereinbarte Soll aus dem Mietkonto, das
// tatsächlich Zugeflossene unmittelbar aus den Zahlungen,
// Werbungskosten aus den Kostenpositionen nach Anlage-V-Gruppen, §35a-Lohnanteile sowie
// der Flächenanteil der vermieteten Einheiten (für gemischt genutzte Gebäude). Die
// Werbungskosten folgen dem Abflussprinzip (im Jahr gebuchte Kosten), die Einnahmen
// werden sowohl als Soll (vereinbart) als auch als Ist (tatsächlich gezahlt) geliefert.
// Das Jahr der Zahlung einer Position (#208, Entwurf 3.10): angegeben, sonst das Kalenderjahr, in
// dem ihr Zeitraum beginnt (ein Zeitraum ohne Angabe liegt in einem Kalenderjahr, repository.ts
// sichert das zu).
export const taxYearOf = (item: Pick<SnapshotCostItem, 'taxYear'>, period: Pick<BillingPeriod, 'from'>): number =>
  item.taxYear ?? Number(period.from.slice(0, 4))

// Ein Teil der Steuerübersicht: der Schnappschuss eines Abrechnungszeitraums und seine Positionen,
// die im Kalenderjahr gezahlt wurden. Der Eigenanteil kommt aus der Abrechnung dieses Zeitraums.
export type TaxPart = { snapshot: Snapshot; items: SnapshotCostItem[] }

// Eigenanteil an den Überträgen aus dem Brennstoffvorrat einer Abrechnung (Heizung PR 8, N8). Die
// Überträge sind keine Positionen; die Steuerübersicht nimmt das Bezahlte (6.4 Nr. 1, G-C5), die
// Abrechnung den Verbrauch, und um diesen Betrag liegen beide beim Eigenanteil auseinander.
export function stockCarrySelfCents(settlement: Pick<ComputedSettlement, 'landlord'>): number {
  return settlement.landlord.rows
    .filter((r) => r.costItemId.startsWith('stock:'))
    .reduce((a, r) => a + (r.landlordParts ?? []).filter((x) => x.reason === 'selfUse').reduce((b, x) => b + x.cents, 0), 0)
}

export function taxReport(snapshot: Snapshot, parts?: readonly TaxPart[]): TaxReport {
  const year = snapshot.year
  // Die Steuerübersicht rechnet im Kalenderjahr (§ 11 EStG, #208). Ohne Teile: der Schnappschuss
  // eines Kalenderjahres. Mit Teilen: die Abrechnungen, die das Jahr berühren; `snapshot` liefert
  // dann nur Mietkonto und Zahlungen des Kalenderjahres.
  const calendar = calendarYearPeriod(year)
  if (snapshot.period.from !== calendar.from || snapshot.period.to !== calendar.to) {
    throw new Error('Die Steuerübersicht rechnet im Kalenderjahr; dieser Schnappschuss trägt einen anderen Zeitraum.')
  }
  const used: readonly TaxPart[] = parts ?? [{ snapshot, items: snapshot.costItems.filter((c) => c.period === snapshot.period.key) }]
  const ledger = rentLedger(snapshot)
  const baseRentSollCents = ledger.rows.reduce((a, r) => a + r.baseRentYearCents, 0)
  // Das Soll der Vorauszahlungen, beide Staffeln (Heizung PR 5): Die Heizvorauszahlung ist ein Teil davon.
  const prepaymentSollCents = ledger.rows.reduce((a, r) => a + r.prepaymentYearCents + (r.heatingPrepaymentYearCents ?? 0), 0)
  // Die Pauschale (#93) gehört zum Soll wie Kaltmiete und Vorauszahlung und bekommt ihre eigene
  // Zeile; sonst stünde sie in der Summe, ohne dass die Aufstellung sie nennt.
  const flatRateSollCents = ledger.rows.reduce((a, r) => a + r.flatRateYearCents, 0)
  const sollCents = ledger.totals.sollYearCents

  // **Zugeflossen ist, was da ist, und nicht, was eine Zeile hat** (§ 11 Abs. 1 Satz 1 EStG).
  // Deshalb wird hier nach Datum summiert und nicht `ledger.totals.paidYearCents` genommen.
  // Das Mietkonto bildet Zeilen nur für Mietverhältnisse mit Überlappung im Jahr und zählt
  // Zahlungen nur innerhalb dieser Zeilen; zwei gewöhnliche Fälle fielen dadurch aus **beiden**
  // Jahren heraus. Ein Mietverhältnis endet am 31.12. und die Dezembermiete geht am 5. Januar
  // ein: im alten Jahr liegt die Zahlung außerhalb, im neuen gibt es keine Zeile mehr. Oder ein
  // Mietverhältnis beginnt am 1. Januar und der Dauerauftrag bucht am 30. Dezember.
  //
  // Für das Mietkonto ist seine Zeilenbindung richtig: Es beantwortet, bis zu welchem Monat ein
  // laufendes Mietverhältnis gedeckt ist, und dafür ist eine Zahlung ohne Zeile kein Beitrag.
  // Für die Steuerübersicht ist sie falsch, seit das Zugeflossene die maßgebliche Zahl ist.
  const paidCents = snapshot.payments
    .filter((p) => p.date >= `${year}-01-01` && p.date <= `${year}-12-31`)
    .reduce((a, p) => a + p.amountCents, 0)

  // Mietverhältnisse des Jahres mit Soll, und wie viele davon ohne jede Zahlung dastehen. Nicht
  // für eine Rechnung, sondern für den Hinweis: Sind für einen Mieter Zahlungen erfasst und für
  // einen zweiten nicht, ist die Summe größer als null, und eine zu niedrige Einnahme ginge
  // ohne Vorbehalt in die Anlage V.
  //
  // Gezählt wird, für welches Mietverhältnis **überhaupt keine** Zahlung erfasst ist, und nicht,
  // wessen Summe null ergibt. Heben sich im Jahr ein Eingang und eine Rücklastschrift auf, ist
  // die Summe null, erfasst ist aber sehr wohl etwas, und der Satz „keine Zahlung erfasst“ wäre
  // dann schlicht falsch.
  const paidTenancies = new Set(
    snapshot.payments.filter((p) => p.date >= `${year}-01-01` && p.date <= `${year}-12-31`).map((p) => p.tenancyId),
  )
  const withSoll = ledger.rows.filter((r) => r.sollYearCents > 0)
  const tenanciesWithSoll = withSoll.length
  // Für die Kopfzeilen der Anlage V (#96): Zeile 24 fragt, ob Nebenkosten nicht gesondert
  // vereinbart sind (Inklusivmiete), und eine Pauschale gehört zu den Umlagen in Zeile 20.
  // Heizung und Warmwasser gehören zu den Nebenkosten: „ganz inklusiv“ heißt deshalb kalt und warm
  // inklusiv, und eine Pauschale zählt bei kalt oder warm (Durchsicht).
  // Steht im Jahr keine Heizposition, rechnen die Mieter die Heizung selbst mit dem Versorger ab,
  // und das Heizmodell sagt nichts über die Nebenkosten des Vermieters (dritte Durchsicht).
  const tenancyById = new Map(snapshot.tenancies.map((t) => [t.id, t]))
  const heatingBilled = used.some((p) => p.items.some((c) => c.category === HEATING_CATEGORY))
  const models = ledger.rows.map((r) => {
    const t = tenancyById.get(r.tenancyId)
    const cold = t?.costModel ?? 'settlement'
    return { cold, heat: heatingBilled ? t?.heatingModel ?? 'settlement' : cold }
  })
  const costModels = {
    tenancies: models.length,
    inclusive: models.filter((m) => m.cold === 'inclusive' && m.heat === 'inclusive').length,
    partlyInclusive: models.filter((m) => (m.cold === 'inclusive') !== (m.heat === 'inclusive')).length,
    flatRate: models.filter((m) => m.cold === 'flatRate' || m.heat === 'flatRate').length,
  }
  const tenanciesWithoutPayment = withSoll.filter((r) => !paidTenancies.has(r.tenancyId)).length
  // Der Teil der Kaltmiete, der Nebenkosten einschließt (#142): Inklusivmiete kalt oder warm, nach
  // denselben Modellen wie `costModels`. Die Übersicht nennt ihn eigens, denn „ohne Umlagen“ ist er
  // gerade nicht. Eine Auskunft über die Summe darüber, keine neue Zahl.
  const inclusiveRentSollCents = ledger.rows.reduce((a, r, i) => {
    const m = models[i]
    return m && (m.cold === 'inclusive' || m.heat === 'inclusive') ? a + r.baseRentYearCents : a
  }, 0)

  // Die Abrechnung desselben Jahres, einmal gerechnet. Aus ihr kommen zwei Angaben, und beide
  // werden ihr **entnommen** statt neu hergeleitet: Eine zweite Auslegung der Staffel oder eine
  // zweite Auswahl der Mietverhältnisse liefe irgendwann auseinander, und gemerkt hätte man es
  // erst daran, dass Steuerübersicht und versendete Abrechnung verschiedene Zahlen nennen.
  // Genau das ist der Befund aus #70.
  // Bei einem Objekt mit eigenem Rhythmus (#208) die Abrechnungen der Teile, je einmal gerechnet; die
  // Vorauszahlungen der Abrechnung gibt es nur, wenn ein Zeitraum dem Kalenderjahr gleicht.
  const settled = used.map((p) => ({ part: p, settlement: computeSettlement(p.snapshot) }))
  // Heizung PR 8 (N8): der Eigenanteil am Übertrag aus dem Vorrat, um den Abrechnung und Steuer beim
  // Eigenanteil auseinanderliegen.
  const stockCarrySelf = settled.reduce((a, { settlement }) => a + stockCarrySelfCents(settlement), 0)
  // Eine Heizkostenabrechnung nach Weg d ist kein Abrechnungszeitraum des Objekts. Gibt es eine,
  // gibt es für die Vorauszahlungen der Abrechnung keine einzelne Zahl mehr (Entwurf 3.10): `null`.
  const separateHeating = used.some((p) => p.snapshot.scope?.kind === 'heating')
  const same = separateHeating ? undefined
    : settled.find(({ part }) => part.snapshot.scope === undefined && part.snapshot.period.from === calendar.from && part.snapshot.period.to === calendar.to)

  // Was die Abrechnung bei den Vorauszahlungen ansetzt, und **bei abgeschlossener Abrechnung
  // ihr eingefrorener Stand**, genau wie beim Eigenanteil weiter unten. Die Zahl steht in der
  // Oberfläche als die, die auf der Abrechnung steht; ist sie abgeschlossen, steht dort der
  // eingefrorene Stand, und zwar beim Mieter im Briefkasten. Der lebende nennte eine Zahl, die
  // auf keinem zugestellten Papier steht — genau der Widerspruch, gegen den #70 antritt.
  //
  // Dass sie von `prepaymentSollCents` abweicht, ist gewollt und hat zwei Gründe. Die Abrechnung
  // muss die tatsächlich geleisteten Vorauszahlungen einstellen, sonst ist sie materiell falsch
  // und trägt nach Ablauf der Frist des § 556 Abs. 3 BGB keinen Nachforderungsanspruch mehr. Und
  // sie verteilt nur über Wohnungen, die zur Abrechnungseinheit gehören, während das Mietkonto
  // jedes Mietverhältnis führt. Das Mietkonto wiederum darf die Jahreskorrektur nicht übernehmen,
  // denn eine Jahreszahl auf zwölf Monate zu verteilen wäre erfunden. Alle drei Zahlen sind
  // richtig, und deshalb stehen sie jetzt nebeneinander statt jede für sich.
  const frozen = same?.part.snapshot.closedSettlement ?? null
  const prepaymentSettlementCents = same === undefined ? null : frozen
    ? frozen.prepaymentCents
    : same.settlement.statements.reduce((a, st) => a + st.prepaymentCents, 0)
  const prepaymentOverridden = same === undefined ? false : frozen
    ? frozen.prepaymentOverridden
    : same.settlement.statements.some((st) => st.prepaymentOverridden)

  // Kostenpositionen des Jahres nach Anlage-V-Gruppe und Kostenart aggregieren. Der Filter ist
  // bewusst doppelt: `snapshotFromDb` grenzt bereits ein. Er bleibt, weil er das Einzige ist,
  // was eine falsch eingegrenzte Ablage noch auffängt, und der Schaden wäre eine Steuerübersicht
  // mit den Werbungskosten mehrerer Jahre. Nicht als toten Code entfernen.
  // Seit #208 steht der Filter in `used` (Kalenderobjekt) bzw. in `taxPartsFor` (Jahr der Zahlung).
  const items = used.flatMap((p) => p.items)
  // Die Aufteilung bei teilweiser Eigennutzung (#163), je Position aus der Abrechnung ihres
  // Zeitraums. Die Rücklage fehlt darin.
  const splits = settled.map(({ part, settlement }) => splitForTax(part.snapshot, part.items.filter((c) => groupOf(c.category) !== null), settlement))
  const split: TaxSplit = {
    items: new Map(splits.flatMap((s) => [...s.items.entries()])),
    selfUseChangedInYear: splits.some((s) => s.selfUseChangedInYear),
    closedSelfUseDiffers: splits.some((s) => s.closedSelfUseDiffers),
    closedItemsChanged: splits.reduce((a, s) => a + s.closedItemsChanged, 0),
  }
  const byGroup = new Map<string, Map<string, TaxExpenseCategory>>()
  // Zuführung zur Erhaltungsrücklage (#143): nicht unter den Werbungskosten, sondern daneben.
  let reserveContributionCents = 0
  for (const item of items) {
    const group = groupOf(item.category)
    if (group === null) {
      reserveContributionCents += item.amountCents
      continue
    }
    let cats = byGroup.get(group)
    if (!cats) {
      cats = new Map()
      byGroup.set(group, cats)
    }
    const prev = cats.get(item.category) ?? { category: item.category, amountCents: 0, labor35aCents: 0, privateCents: 0, deductibleCents: 0 }
    const share = split.items.get(item.id)
    prev.amountCents += item.amountCents
    prev.privateCents += share?.privateCents ?? 0
    prev.deductibleCents += share?.deductibleCents ?? item.amountCents
    // Nur ein gültiger Lohnanteil, dieselbe Regel wie in der Abrechnung (#148).
    prev.labor35aCents += validLabor35aCents(item) ?? 0
    cats.set(item.category, prev)
  }
  const groups: TaxExpenseGroup[] = [...byGroup.entries()]
    .map(([group, cats]) => {
      const categories = [...cats.values()].sort((a, b) => b.amountCents - a.amountCents)
      return {
        group,
        amountCents: categories.reduce((a, c) => a + c.amountCents, 0),
        labor35aCents: categories.reduce((a, c) => a + c.labor35aCents, 0),
        privateCents: categories.reduce((a, c) => a + c.privateCents, 0),
        deductibleCents: categories.reduce((a, c) => a + c.deductibleCents, 0),
        categories,
      }
    })
    .sort((a, b) => {
      const ia = ANLAGE_V_GROUP_ORDER.indexOf(a.group)
      const ib = ANLAGE_V_GROUP_ORDER.indexOf(b.group)
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
    })
  const totalCents = groups.reduce((a, g) => a + g.amountCents, 0)
  const privateCents = groups.reduce((a, g) => a + g.privateCents, 0)
  // Als Differenz, damit privat und abziehbar zusammen immer die Bruttosumme ergeben.
  const deductibleCents = totalCents - privateCents
  const labor35aCents = groups.reduce((a, g) => a + g.labor35aCents, 0)
  // Positionen „Nicht umlagefähig“, die nach Rücklage aussehen (#143). Gerechnet wird wie
  // erfasst; die Steuerübersicht rät nur, die Kostenart zu ändern. Der Hinweis gehört hierher und
  // nicht unter die Hinweise der Abrechnung: Auf die Abrechnung wirkt die Kostenart nicht, beide
  // sind nicht umlagefähig, und dort bliebe er im Cockpit ein offener Punkt ohne Folge.
  const reserveSuspects = items
    .filter((c) => c.category === 'Nicht umlagefähig' && looksLikeReserveContribution(c.description))
    .map((c) => ({ costItemId: c.id, description: c.description, amountCents: c.amountCents }))

  // ---------- Gemischte Nutzung: gemessen wird das Private (#68) ----------
  //
  // **Gefragt wird dreiwertig**, wie überall sonst (`UnitUsage` in shared/types.ts): vermietet,
  // selbstgenutzt, außerhalb der Abrechnungseinheit. Vorher stand hier `!u.participates`, und
  // damit schlug eine ausdrücklich ausgenommene Wohnung — etwa eine getrennt abgerechnete
  // Gewerbeeinheit — als Eigennutzung durch. Der Vermieter bekam die Aufforderung, den
  // selbstgenutzten Anteil herauszurechnen, obwohl er gar nichts selbst nutzt. Die Regel ist
  // dieselbe wie bei `selfUnits` in computeSettlement, und sie steht bewusst nicht zweimal
  // ausformuliert da.
  //
  // **Gemessen wird der selbstgenutzte Anteil und nicht der vermietete**, und das ist die
  // Antwort auf die zweite Frage des Issues. Nur das Private ist eindeutig: Ob eine ausgenommene
  // Wohnung vermietet ist, weiß Mietfuchs nicht, ob sie selbstgenutzt ist, sehr wohl. Und die
  // steuerliche Frage ist ohnehin die nach dem privaten Anteil, denn er ist der nicht
  // abziehbare.
  //
  // **Die Grundmenge ist das ganze Gebäude und damit eine andere als die der Abrechnung.** Das
  // ist gewollt: Die Verteilbasis der Abrechnung beantwortet „welche Wohnungen teilen sich diese
  // Rechnung" und lässt ausgenommene Wohnungen deshalb weg; hier lautet die Frage „wie viel
  // meines Gebäudes ist privat", und dafür gehört jeder Quadratmeter in den Nenner. Der
  // Unterschied steht in der Oberfläche, nicht nur hier.
  const allUnits = snapshot.units
  const totalArea = allUnits.reduce((a, u) => a + (u.areaM2 || 0), 0)
  const selfUsedUnits = allUnits.filter((u) => u.selfUsed && !u.participates)
  // **Ausgegeben werden die Flächen und nicht ihr Verhältnis.** Die Anlage V fragt im Kopf nach
  // der Gesamtwohnfläche und dem davon eigengenutzten Teil; das sind genau diese beiden Zahlen,
  // und sie sind nachprüfbar. Ein bloßer Prozentsatz lädt außerdem dazu ein, den Rest für den
  // abziehbaren Anteil zu halten, und das ist falsch, sobald es Wohnungen außerhalb der
  // Abrechnungseinheit gibt.
  const selfUsedAreaM2 = selfUsedUnits.reduce((a, u) => a + (u.areaM2 || 0), 0)
  const selfOccupiedExists = selfUsedUnits.length > 0
  // **Wohnungen, die Mietfuchs nicht einordnen kann**, und deshalb ein eigener Hinweis statt
  // Schweigen. Zwei verschiedene Bestände fallen hier zusammen: die ausdrücklich ausgenommene
  // Gewerbeeinheit und die eigene Wohnung aus einem Bestand von vor der dreiwertigen
  // Unterscheidung, den die Migration in legacy/migrate.ts bewusst nicht anfasst (ein gesetztes
  // Kennzeichen veränderte die Verteilung bereits abgerechneter Jahre). Ohne diesen Hinweis
  // nähme die Behebung ausgerechnet dem die Hilfe weg, der sie braucht, nämlich dem Vermieter
  // mit altem Bestand und eigener Wohnung im Haus.
  //
  // **Dass beide zusammenfallen, ist eine Wahl und keine Eigenschaft der Daten.** Sie lassen
  // sich sehr wohl unterscheiden: Die Stammdaten schreiben beide Kennzeichen immer gemeinsam
  // (`unitForm.ts`), „ausgenommen“ ergibt also ausdrücklich `selfUsed: false`, während ein alter
  // Bestand das Feld gar nicht führt. Darauf eine Steuerauskunft zu stützen wäre aber brüchig:
  // `emptyUnit` in db/repository.ts kennt das Feld nicht, und ein `POST /api/units` ohne das
  // Feld liefert ebenfalls `undefined`. „Nicht gesetzt heißt nie eingeordnet“ ist heute nirgends
  // zugesichert, und ohne Zusicherung samt Test ist es keine Grundlage. Wer das ändern will,
  // fängt bei der Zusicherung an, nicht hier.
  const excludedExists = allUnits.some((u) => !u.participates && !u.selfUsed)
  // Auf selbstgenutzte Wohnungen entfallender Teil der Kosten, aus der Verteilung des Jahres
  // übernommen: privat veranlasst und damit nicht als Werbungskosten abziehbar. Die
  // Werbungskosten oben bleiben ungekürzt — die Aufteilung nimmt diese Übersicht nicht vor.
  // Ist die Abrechnung abgeschlossen, gilt ihr eingefrorener Stand (wie in
  // GET /api/settlement/:year), sonst widersprächen Übersicht und versendete Abrechnung.
  // Ohne Zeitraum gleich dem Kalenderjahr (#208): die Summe der Eigenanteile laut Abrechnung je
  // Position.
  const selfUsedShareCents = same !== undefined
    ? same.part.snapshot.closedSettlement?.selfUsedShareCents ?? same.settlement.selfUsedShareCents
    : [...split.items.values()].filter((i) => i.allocation === 'settlement').reduce((a, i) => a + i.privateCents, 0)

  return {
    year,
    income: {
      baseRentSollCents,
      inclusiveRentSollCents,
      prepaymentSollCents,
      flatRateSollCents,
      prepaymentSettlementCents,
      prepaymentOverridden,
      sollCents,
      paidCents,
      tenanciesWithSoll,
      tenanciesWithoutPayment,
    },
    expenses: { groups, totalCents, privateCents, deductibleCents, labor35aCents, ...(stockCarrySelf !== 0 ? { stockCarrySelfCents: stockCarrySelf } : {}), items: [...split.items.values()] },
    settlementPeriods: used.map((p) => ({ key: p.snapshot.period.key, label: p.snapshot.scope?.kind === 'heating' ? `Heizkosten ${periodLabel(p.snapshot.period)}` : periodLabel(p.snapshot.period) })),
    selfUseChangedInYear: split.selfUseChangedInYear,
    closedSelfUseDiffers: split.closedSelfUseDiffers,
    closedItemsChanged: split.closedItemsChanged,
    reserveContributionCents,
    reserveSuspects,
    totalAreaM2: totalArea,
    selfUsedAreaM2,
    selfOccupiedExists,
    excludedExists,
    costModels,
    selfUsedShareCents,
    // Der Überschuss rechnet mit dem abziehbaren Teil (#163). Ohne Eigennutzung ist er die
    // Bruttosumme, und die Zahl bleibt, wie sie war.
    surplusSollCents: sollCents - deductibleCents,
    surplusPaidCents: paidCents - deductibleCents,
  }
}

// Die Teile der Steuerübersicht eines Objekts mit eigenem Rhythmus oder eigener Heizperiode (#208,
// Heizung PR 5, Entwurf 3.10): jeder Abrechnungszeitraum, der das Jahr oder das Vorjahr berührt, mit
// seinen Positionen, deren Jahr der Zahlung dieses Jahr ist, dazu die Heizpositionen der
// Heizperioden, die er nach Weg b aufnimmt (ihr Jahr der Zahlung richtet sich nach ihrer
// Heizperiode). Jede Heizkostenabrechnung nach Weg d ist ein eigener Teil; den Eigenanteil liefert
// dann sie. `null` beim Kalenderobjekt ohne eigene Heizperiode: Dort rechnet `taxReport` wie bisher.
export function taxPartsFor(source: Parameters<typeof snapshotFor>[0], propertyId: string, year: number): TaxPart[] | null {
  const rules = rulesOf(source.properties?.find((p) => p.id === propertyId))
  const ownPlants = (source.heatingPlants ?? []).filter((p) => p.propertyId === propertyId && (p.periodStartMonth ?? null) !== null)
  if (isCalendarRules(rules) && ownPlants.length === 0) return null
  const jahr = calendarYearPeriod(year)
  const vorjahr = calendarYearPeriod(year - 1)
  // Eine Heizperiode, die in diesem Jahr beginnt, kann in der Abrechnung des Folgejahres stehen (Weg b)
  // und doch in diesem Jahr bezahlt sein (Durchsicht von #231): Mit eigener Heizperiode reicht die Suche
  // deshalb bis ins Folgejahr, dort aber nur nach deren Heizpositionen.
  const bis = ownPlants.length > 0 ? calendarYearPeriod(year + 1).to : jahr.to
  const parts: TaxPart[] = periodsBetween(rules, vorjahr.from, bis).flatMap((p) => {
    const snap = snapshotFor(source, propertyId, p)
    const items = [
      ...(p.from > jahr.to ? [] : snap.costItems.filter((c) => taxYearOf(c, p) === year)),
      ...(snap.heatingParts ?? []).filter((x) => !x.separate).flatMap((x) => x.items.filter((c) => taxYearOf(c, x.period) === year)),
    ]
    const touches = p.from <= jahr.to && p.to >= jahr.from
    return items.length > 0 || touches ? [{ snapshot: snap, items }] : []
  })
  const separate: TaxPart[] = ownPlants.flatMap((plant) => {
    const way = wayOf(plant)
    return periodsBetween(plantRules(way, rules), vorjahr.from, jahr.to).flatMap((h) => {
      if (!settledSeparately(way, rules, h)) return []
      const snap = heatingSnapshotFor(source, propertyId, plant.id, h)
      if (!snap) return []
      const items = snap.costItems.filter((c) => taxYearOf(c, h) === year)
      return items.length > 0 ? [{ snapshot: snap, items }] : []
    })
  })
  return [...parts, ...separate]
}

export function taxReportFor(source: Parameters<typeof snapshotFor>[0], propertyId: string, year: number): TaxReport {
  const calendar = snapshotFor(source, propertyId, calendarYearPeriod(year))
  const parts = taxPartsFor(source, propertyId, year)
  return parts === null ? taxReport(calendar) : taxReport(calendar, parts)
}

// Die Anlage-V-Gruppe einer Kostenart, `null` für die Rücklage (#143). Bewusst nach
// `Object.hasOwn` gefragt und nicht mit `??`: `null` ist hier eine Angabe.
const groupOf = (category: string): string | null =>
  Object.hasOwn(ANLAGE_V_GROUP, category) ? ANLAGE_V_GROUP[category] ?? null : 'Sonstige Werbungskosten'

// ---------- Werbungskosten bei teilweiser Eigennutzung (#163) ----------
//
// Die Regeln und ihre Quellen stehen in docs/superpowers/specs/2026-10-02-steuer-eigennutzung-design.md.
// Kurz: Was einer Einheit direkt zugeordnet ist, gehört ganz zu ihr; Gebäudekosten werden nach dem
// Verhältnis der Wohn- und Nutzflächen aufgeteilt (BFH, Urteil vom 24.06.2008, IX R 26/06), mit dem
// ganzen Gebäude als Grundmenge wie in #68; und bei umlagefähigen Kosten gilt der Eigenanteil, den
// die Nebenkostenabrechnung ausweist, damit Abrechnung und Steuer dasselbe sagen (Auslegung, F1).
//
// **Die Abrechnung bleibt unberührt.** Gelesen wird ihr Ergebnis, die Zerlegung des
// Vermieteranteils (#142); `computeSettlement` ändert sich nicht, und die Golden-Tests bleiben der
// Beweis, dass keine Abrechnung wandert.
//
// **Ohne selbstgenutzte Einheit ist nichts privat**: Der Eigenanteil der Abrechnung ist dann 0, und
// die Fläche der eigenen Einheiten ebenso. Eine Invariante in calc.test.ts hält das fest.

// Kaufmännisch gerundet und bei einer Gutschrift spiegelbildlich: −0,5 Cent wird −1 Cent, nicht 0.
// Das `|| 0` macht aus einer negativen Null eine Null; sonst hieße eine Gutschrift ohne privaten
// Teil „privat −0“, und ein Vergleich mit 0 schlüge fehl (gefunden von der Invariante).
const roundHalfAway = (x: number): number => (Math.sign(x) * Math.round(Math.abs(x))) || 0

// Die Schlüssel, bei denen der Eigenanteil der Abrechnung einem anderen Maßstab folgt als Fläche
// oder gemessenem Verbrauch. Für sie rechnet die Übersicht zum Vergleich nach Fläche.
const KEYS_NOT_AREA: readonly CostKey[] = ['persons', 'units', 'custom', 'external']

type TaxSplit = { items: Map<string, TaxExpenseItem>, selfUseChangedInYear: boolean, closedSelfUseDiffers: boolean, closedItemsChanged: number }

function splitForTax(snapshot: Snapshot, items: SnapshotCostItem[], settlement: ComputedSettlement): TaxSplit {
  const units = snapshot.units
  const unitById = new Map(units.map((u) => [u.id, u]))
  const isSelf = (u: SnapshotUnit) => !!u.selfUsed && !u.participates
  const areaOf = (u: SnapshotUnit) => u.areaM2 || 0

  // Der Eigenanteil je Position, wie ihn die Abrechnung dieses Jahres ausweist.
  const live = new Map<string, FrozenItemSelfUse>()
  for (const row of settlement.landlord.rows) {
    const entry = live.get(row.costItemId) ?? { selfCents: 0, noBasis: false }
    for (const part of row.landlordParts ?? []) {
      if (part.reason === 'selfUse') entry.selfCents += part.cents
      if (part.reason === 'noBasis') entry.noBasis = true
    }
    live.set(row.costItemId, entry)
  }
  const liveOf = (id: string): FrozenItemSelfUse => live.get(id) ?? { selfCents: 0, noBasis: false }

  // **Bei abgeschlossener Abrechnung gilt ihr eingefrorener Stand**, wie beim Eigenanteil und den
  // Vorauszahlungen (#70): Die Steuerübersicht soll nennen, was beim Mieter auf dem Papier steht.
  // **Aber nur für Positionen, die genau so auf dem Papier standen** (Durchsicht): Eine nach dem
  // Abschluss erfasste Position hat dort keinen Eigenanteil, und ihn als 0 zu lesen machte sie
  // ganz abziehbar; bei einem danach geänderten Betrag passte der eingefrorene Eigenanteil nicht
  // mehr zum Betrag und ergab einen negativen abziehbaren Teil. Solche Positionen rechnet die
  // Übersicht heute und zählt sie für den Hinweis.
  const frozen = snapshot.closedSettlement
  const totals = frozen?.itemTotals ?? null
  // Eine Position ohne Betrag fehlt in Archivstücken älterer Versionen, die für sie keine Zeile
  // schrieben; geändert ist sie deshalb nicht (Durchsicht), und privat ist an 0 € ohnehin nichts.
  const asClosed = (c: SnapshotCostItem): boolean =>
    !!frozen && (totals === null || (Object.hasOwn(totals, c.id) ? totals[c.id] === c.amountCents : c.amountCents === 0))
  const closedItemsChanged = frozen ? items.filter((c) => !asClosed(c)).length : 0
  let fromSettlement = (c: SnapshotCostItem) => liveOf(c.id)
  let closedSelfUseDiffers = false
  if (frozen && frozen.selfUseByItem) {
    const byItem = frozen.selfUseByItem
    fromSettlement = (c) => (asClosed(c) ? (Object.hasOwn(byItem, c.id) ? byItem[c.id] : undefined) ?? { selfCents: 0, noBasis: false } : liveOf(c.id))
    closedSelfUseDiffers = items.some((c) => asClosed(c) && fromSettlement(c).selfCents !== liveOf(c.id).selfCents)
  } else if (frozen) {
    // Ein Archivstück von vor #142 kennt nur die Summe. Sie wird auf die Positionen, die so auf dem
    // Papier standen, im Verhältnis der heutigen Eigenanteile verteilt, mit dem Restverfahren und
    // der Kennung als Entscheid. Ohne heutigen Eigenanteil lässt sie sich nicht verteilen, und das
    // sagt der Hinweis. Ist seither eine Position entfallen oder geändert, enthält die Summe auch
    // ihren Anteil; das bleibt eine Näherung, und der Hinweis erscheint.
    const allocable = items.filter((c) => !isNotAllocable(c.category) && asClosed(c))
    const today = allocable.map((c) => liveOf(c.id).selfCents)
    const todaySum = today.reduce((a, c) => a + c, 0)
    const parts = todaySum !== 0
      ? largestRemainder(frozen.selfUsedShareCents, today.map((c) => (c * frozen.selfUsedShareCents) / todaySum), allocable.map((c) => c.id))
      : allocable.map(() => 0)
    const distributed = new Map(allocable.map((c, k) => [c.id, parts[k] ?? 0]))
    fromSettlement = (c) => (asClosed(c) ? { selfCents: distributed.get(c.id) ?? 0, noBasis: liveOf(c.id).noBasis } : liveOf(c.id))
    closedSelfUseDiffers = todaySum !== frozen.selfUsedShareCents
  }

  // **Gibt es Einheiten außerhalb der Abrechnungseinheit, zählt das ganze Gebäude** (Durchsicht).
  // Die Abrechnung verteilt nur über die Abrechnungseinheit; ihr Eigenanteil behandelte die
  // Fläche einer getrennt abgerechneten Gewerbeeinheit damit wie privat (100 m² eigen, 100 m²
  // vermietet, 100 m² Gewerbe: 1.500 € statt 1.000 € von 3.000 €). Dann gilt für die Schlüssel,
  // die über Wohnungen verteilen, der BFH-Maßstab über das Gebäude, und der Eigenanteil der
  // Abrechnung steht zum Vergleich daneben. Verbrauch und Einzelbeträge ordnen dagegen eindeutig
  // zu (der Verbrauch einer Einheit außerhalb steckt in der Verteilbasis), dort bleibt es bei der
  // Abrechnung. Gefragt wird nach den betroffenen Einheiten der Position.
  const outside = (u: SnapshotUnit) => !u.participates && !u.selfUsed
  const BUILDING_KEYS: readonly CostKey[] = ['area', 'units', 'persons', 'custom', 'external']
  const outsideAffected = (item: SnapshotCostItem): boolean =>
    BUILDING_KEYS.includes(item.key) && units.some((u) => outside(u) && (!item.participantUnitIds || item.participantUnitIds.includes(u.id)))

  // Nach Fläche über die betroffenen Einheiten: die Teilnehmer der Position, sonst alle Einheiten
  // des Objekts. `null`, wenn eine Fläche fehlt, die es zum Aufteilen bräuchte.
  const byArea = (item: SnapshotCostItem) => {
    const only = item.participantUnitIds ? new Set(item.participantUnitIds) : null
    const affected = only ? units.filter((u) => only.has(u.id)) : units
    const area = affected.reduce((a, u) => a + areaOf(u), 0)
    const selfAffected = affected.filter(isSelf)
    const selfArea = selfAffected.reduce((a, u) => a + areaOf(u), 0)
    const missing = selfAffected.filter((u) => !(areaOf(u) > 0))
    if (selfAffected.length > 0 && (missing.length > 0 || !(area > 0))) {
      return { ok: false as const, missing: missing.length > 0 ? missing : selfAffected, limited: only !== null }
    }
    const raw = area > 0 ? (item.amountCents * selfArea) / area : 0
    return { ok: true as const, area, selfArea, raw, privateCents: roundHalfAway(raw), limited: only !== null }
  }

  const result = new Map<string, TaxExpenseItem>()
  for (const item of items) {
    const amount = item.amountCents
    const allocable = !isNotAllocable(item.category)
    const direct = item.key === 'direct' && item.directUnitId ? unitById.get(item.directUnitId) : undefined
    const fromBill = fromSettlement(item)
    const steps: CalcStep[] = [{ label: 'Rechnungsbetrag', value: fmtCents(amount) }]
    let allocation: TaxAllocation
    let privateCents = 0
    let areaPrivateCents: number | null = null
    let settlementPrivateCents: number | null = null
    // „Betrifft (für die Steuer)“: dieselben Einheiten, die die Zweige unten lesen.
    const taxUnits = allocable ? null
      : direct ? [direct]
        : item.participantUnitIds ? units.filter((u) => item.participantUnitIds?.includes(u.id))
          : null
    // Eine leere Liste nennt keine Einheit; die Seite zeigte sonst eine leere Aufzählung (Durchsicht).

    const directLabel = (u: SnapshotUnit) =>
      `direkt: ${u.name} (${isSelf(u) ? 'selbstgenutzt' : u.participates ? 'vermietete Einheit' : 'außerhalb der Abrechnungseinheit'})`
    // Nach Fläche aufteilen; gibt die Zuordnung zurück, damit jeder Zweig unten sie selbst setzt.
    const applyArea = (why?: string): TaxAllocation => {
      const a = byArea(item)
      if (why) steps.push({ label: 'Hinweis', value: why })
      if (!a.ok) {
        steps.push({ label: 'Zuordnung', value: `nicht aufteilbar: Für ${andList(a.missing.map((u) => u.name))} ist keine Fläche hinterlegt; der Betrag ist ungekürzt angesetzt`, term: 'mixedUse' })
        return 'unsplittable'
      }
      privateCents = a.privateCents
      steps.push({ label: 'Zuordnung', value: 'verhältnismäßig nach Wohn- und Nutzfläche', term: 'mixedUse' })
      steps.push({ label: 'Betroffene Fläche', value: `${fmtNum(a.area)} m² (${a.limited ? 'nur die betroffenen Einheiten' : 'ganzes Gebäude'})` })
      steps.push({ label: 'davon selbstgenutzt', value: `${fmtNum(a.selfArea)} m²` })
      if (a.area > 0 && a.selfArea > 0) {
        steps.push({ label: 'Rechnung', value: `${fmtCents(amount)} × ${fmtNum(a.selfArea)}/${fmtNum(a.area)} = ${fmtExactEuro(a.raw)}` })
      }
      steps.push({ label: 'privat, auf Cent gerundet', value: fmtCents(privateCents), term: 'ownShare' })
      return 'area'
    }

    if (!allocable) {
      if (direct && isSelf(direct)) {
        allocation = 'direct-self'
        privateCents = amount
        steps.push({ label: 'Zuordnung', value: directLabel(direct) })
        steps.push({ label: 'privat', value: fmtCents(privateCents), term: 'ownShare' })
      } else if (direct) {
        allocation = direct.participates ? 'direct-rented' : 'direct-outside'
        steps.push({ label: 'Zuordnung', value: directLabel(direct) })
      } else {
        allocation = applyArea()
      }
    } else if (direct && !fromBill.noBasis) {
      allocation = isSelf(direct) ? 'direct-self' : direct.participates ? 'direct-rented' : 'direct-outside'
      privateCents = fromBill.selfCents
      steps.push({ label: 'Zuordnung', value: directLabel(direct) })
      if (privateCents !== 0) steps.push({ label: 'Eigenanteil laut Abrechnung (privat)', value: fmtCents(privateCents), term: 'ownShare' })
    } else if (fromBill.noBasis) {
      allocation = applyArea('Die Nebenkostenabrechnung hat diese Position nicht verteilt; aufgeteilt wird deshalb nach Fläche.')
    } else if (outsideAffected(item)) {
      settlementPrivateCents = fromBill.selfCents
      allocation = applyArea(`Zum Gebäude gehören Einheiten außerhalb der Abrechnungseinheit. Die Nebenkostenabrechnung verteilt nur über die Abrechnungseinheit und weist ${fmtCents(fromBill.selfCents)} Eigenanteil aus; für die Steuer zählt das Verhältnis der Flächen des ganzen Gebäudes.`)
    } else {
      allocation = 'settlement'
      privateCents = fromBill.selfCents
      steps.push({ label: 'Zuordnung', value: `verhältnismäßig laut Nebenkostenabrechnung ${periodLabel(snapshot.period)}, verteilt nach ${KEY_LABELS[item.key] || item.key}${frozen ? ' (abgeschlossene Abrechnung)' : ''}`, term: 'allocationKey' })
      steps.push({ label: 'Eigenanteil laut Abrechnung (privat)', value: fmtCents(privateCents), term: 'ownShare' })
      if (KEYS_NOT_AREA.includes(item.key)) {
        const a = byArea(item)
        if (a.ok) {
          areaPrivateCents = a.privateCents
          steps.push({ label: 'Zum Vergleich nach Wohn- und Nutzfläche', value: `${fmtCents(a.privateCents)} privat (${fmtNum(a.selfArea)} von ${fmtNum(a.area)} m²)`, term: 'mixedUse' })
        }
      }
    }

    const deductibleCents = amount - privateCents
    const kind: TaxAllocation = allocation
    const deductiblePercent = (kind === 'settlement' || kind === 'area') && amount !== 0
      ? Math.round((deductibleCents / amount) * 10000) / 100
      : null
    steps.push({ label: 'abziehbar', value: deductiblePercent !== null ? `${fmtCents(deductibleCents)} (${fmtNum(deductiblePercent)} %)` : fmtCents(deductibleCents) })
    result.set(item.id, {
      costItemId: item.id,
      category: item.category,
      group: groupOf(item.category) ?? 'Sonstige Werbungskosten',
      description: item.description,
      amountCents: amount,
      privateCents,
      deductibleCents,
      labor35aCents: validLabor35aCents(item) ?? 0,
      allocation: kind,
      deductiblePercent,
      areaPrivateCents,
      settlementPrivateCents,
      steps,
      taxUnits: taxUnits && taxUnits.length > 0 ? taxUnits.map((u) => ({ unitId: u.id, unitName: u.name })) : null,
    })
  }

  // Ein Mietverhältnis auf einer selbstgenutzten Einheit im Jahr: Die Nutzung hat keine Zeitachse,
  // die Fläche zählt also das ganze Jahr als privat (F5).
  const selfIds = new Set(units.filter(isSelf).map((u) => u.id))
  const selfUseChangedInYear = snapshot.tenancies.some((t) => selfIds.has(t.unitId) && rangeOverlapDays(t.start, t.end, snapshot.period.from, snapshot.period.to) > 0)
  return { items: result, selfUseChangedInYear, closedSelfUseDiffers, closedItemsChanged }
}

// ---------- Hilfen ----------

// ---------- Die eine Rundungsregel (#202) ----------
//
// Jede Kostenposition wird **genau einmal** nach dem Restverfahren verteilt, und zwar über alle
// Empfänger zugleich: die Zeilen der Mieter und je Grund eine Zeile des Vermieters (Eigennutzung,
// Leerstand, Pauschale, Inklusivmiete, außerhalb der Abrechnungseinheit, Rest der Vereinbarung,
// Rest des Hauptzählers, Rest der Einzelbeträge). Die exakten Werte aller Zeilen ergeben zusammen
// genau den Betrag; der Rest des Vermieters ist dafür definiert als Betrag minus alle übrigen.
// Daraus folgt ohne Fallunterscheidung: Die Summe stimmt immer centgenau, jede Zeile ist ihr
// exakter Wert ab- oder aufgerundet, und keine Zeile des Vermieters kann das Vorzeichen wechseln.
// Vorher wurde bei voller Umlage nach dem Restverfahren verteilt, sonst jeder Mieter für sich
// gerundet und der Vermieter bekam den Rest; der konnte bei −1 Cent landen (1,00 € auf 67/67/65 m²
// vermietet und 1 m² selbstgenutzt: 34/34/33 ct, zusammen 1,01 €).
//
// Ein Empfänger: `key` ist die Kennung des Mietverhältnisses oder der Grund beim Vermieter, `raw`
// sein exakter Anteil in Cent (mit dem Vorzeichen der Position).
export type Recipient = { key: string, landlord: boolean, raw: number }

// Was nur durch Gleitkomma-Rauschen von 0 oder einer ganzen Zahl abweicht, gilt als genau das. Ein
// Rest des Vermieters von 1e-12 Cent ist rechnerisch 0 und darf beim Gleichstand nicht vorn liegen;
// einer von −1e-12 Cent ergäbe abgerundet −1 und holte sich dann einen Cent zurück.
const NOISE = 1e-6
export const cleanRaw = (x: number): number => {
  if (Math.abs(x) < NOISE) return 0
  const r = Math.round(x)
  return Math.abs(x - r) < NOISE ? r : x
}

// Reihenfolge, in der die Restcent vergeben werden: größter Nachkommaanteil zuerst. Gleich heißt
// gleich bis auf Rauschen (0,4999999999 und 0,5); dann geht ein Cent zuerst an eine Zeile des
// Vermieters und nicht an einen Mieter, unter Mietern entscheidet die Kennung wie seit #70, nie die
// Reihenfolge in der Datei. Eine Zeile mit dem exakten Wert 0 kommt nicht vor: Sie bekommt nie
// einen Cent.
const TIE = 1e-9
function remainderOrder(values: number[], recipients: Recipient[]): number[] {
  const frac = (k: number) => values[k] - Math.floor(values[k])
  return values.map((_, k) => k).filter((k) => values[k] !== 0).sort((i, j) => {
    const d = frac(j) - frac(i)
    if (Math.abs(d) > TIE) return d
    if (recipients[i].landlord !== recipients[j].landlord) return recipients[i].landlord ? -1 : 1
    return compareText(recipients[i].key, recipients[j].key)
  })
}

// Verteilt den Betrag über die Empfänger. Gerechnet wird mit dem Betrag ohne Vorzeichen, das
// Vorzeichen kommt danach dazu; eine Gutschrift ist so das Spiegelbild der Rechnung.
export function distributeCents(totalCents: number, recipients: Recipient[]): number[] {
  const sign = totalCents < 0 ? -1 : 1
  const values = recipients.map((r) => cleanRaw(r.raw * sign))
  const cents = values.map((v) => Math.floor(v))
  let rest = Math.abs(totalCents) - cents.reduce((a, b) => a + b, 0)
  const order = remainderOrder(values, recipients)
  if (order.length > 0) {
    for (let k = 0; rest > 0; k++, rest--) cents[order[k % order.length]]++
    for (let k = 0; rest < 0; k++, rest++) cents[order[order.length - 1 - (k % order.length)]]--
  }
  return cents.map((c) => (c * sign) || 0)
}

// **Der §35a-Lohnanteil wird mitverteilt** (#202), und zwar innerhalb der eben verteilten
// Kostenanteile: Jede Zeile bekommt ihren exakten Lohn L × exakt / A ab- oder aufgerundet, nie
// mehr als ihren Kostenanteil, und zusammen genau den Lohn der Rechnung, auch die Zeilen des
// Vermieters. Ist die Rechnung ganz Lohn (L = A), sind die exakten Werte dieselben wie die der
// Kosten, die Reihenfolge der Restcent ebenso, und der Lohnanteil jeder Zeile ist genau ihr
// Kostenanteil.
//
// Warum nicht Lohn und Rest unabhängig verteilen und addieren: Zwei Rundungen zusammen können um
// fast 2 Cent vom exakten Kostenanteil abweichen (0,5 + 0,5 exakt, beide aufgerundet, ergibt 2 statt
// 1). Deshalb erst die Kosten, dann der Lohn darin.
//
// Dass der Lohn dabei immer Platz findet, ist gemessen (über 46 Millionen kleine Fälle erschöpfend
// und 2 Millionen zufällige): Der erste Durchgang bis höchstens zur Aufrundung des Lohns ergab immer
// genau L. Für den Fall, dass es doch einmal nicht reicht, gibt der zweite Durchgang bis zum
// Kostenanteil nach; Platz gibt es dort immer, denn die Kostenanteile ergeben zusammen A ≥ L.
// „0 ≤ Lohn ≤ Kostenanteil“ gilt immer. „Σ Lohn = L“ hängt nicht an der Messung, solange keine
// Zeile negativ ist, also bei widerspruchsfreien Daten. Bei sich überschneidenden
// Mietverhältnissen ist der Leerstand negativ und bekommt Lohn 0, während die übrigen Zeilen
// zusammen mehr als A tragen; dann liegt Σ Lohn über L. Beispiel: zwei Wohnungen à 50 m², in W1
// zwei ganzjährige Mietverhältnisse, Garten 1.000 € mit 800 € Lohn: drei Mieter je 400 €, zusammen
// 1.200 € Lohn. Ebenfalls an der Messung und an widerspruchsfreien Daten (exakte Werte zusammen
// genau A) hängt, dass jeder Lohnanteil höchstens um einen Cent von seinem exakten Wert abweicht.
export function distributeLaborCents(laborCents: number, totalCents: number, recipients: Recipient[], shares: number[]): { cents: number[], exact: number[] } {
  const exact = recipients.map((r) => {
    const e = cleanRaw(r.raw)
    return laborCents === totalCents ? e : cleanRaw((e * laborCents) / totalCents)
  })
  const caps = shares.map((s) => Math.max(0, s))
  const cents = exact.map((l, k) => (l > 0 ? Math.min(Math.floor(l), caps[k]) : 0))
  let rest = laborCents - cents.reduce((a, b) => a + b, 0)
  const order = remainderOrder(exact.map((l) => Math.max(0, l)), recipients)
  for (const k of order) {
    if (rest <= 0) break
    if (cents[k] < Math.min(Math.ceil(exact[k]), caps[k])) { cents[k]++; rest-- }
  }
  for (const k of order) {
    if (rest <= 0) break
    const give = Math.min(caps[k] - cents[k], rest)
    if (give > 0) { cents[k] += give; rest -= give }
  }
  return { cents, exact }
}

// Die Verteilung einer Position, für Prüfungen von außen (#202): je Empfänger der exakte Wert und
// was er bekommen hat. `forced` heißt, die Position geht aus einem einzigen Grund ganz an den
// Vermieter (nicht umlagefähig, keine Verteilbasis …); dann gilt dieser Grund und kein Eigenanteil.
export type AllocationTrace = {
  costItemId: string
  amountCents: number
  laborCents: number
  forced: boolean
  lines: { recipient: string, landlord: boolean, exact: number, cents: number, laborExact: number, laborCents: number }[]
}

// Verteilt totalCents exakt auf die gegebenen (float) Rohanteile (Hare/largest remainder).
// `keys` enthält je Rohanteil eine stabile Kennung (die ID des Mietverhältnisses). Sie
// entscheidet, wer bei gleichem Nachkommaanteil den Rest-Cent bekommt — sonst hinge das an
// der Reihenfolge in der Datei, und dieselben Daten könnten anders abgerechnet werden.
export function largestRemainder(totalCents: number, raws: number[], keys: string[]): number[] {
  if (raws.length === 0) return []
  const floors = raws.map((r) => Math.floor(r))
  let rest = totalCents - floors.reduce((a, b) => a + b, 0)
  const byKey = (i: number, j: number) => compareText(keys[i], keys[j])
  const order = raws
    .map((r, i): [number, number] => [r - Math.floor(r), i])
    .sort((a, b) => b[0] - a[0] || byKey(a[1], b[1]))
  for (let k = 0; rest > 0; k++, rest--) floors[order[k % order.length][1]]++
  for (let k = 0; rest < 0; k++, rest++) floors[order[order.length - 1 - (k % order.length)][1]]--
  return floors
}

function fmtNum(n: number): string {
  return n.toLocaleString('de-DE', { maximumFractionDigits: 2 })
}

// Zwischenwerte des Rechenwegs (#114). Der Prozentsatz mit bis zu sechs Stellen, damit Betrag ×
// Prozent auch bei 30.000 € noch den gezeigten Wert ergibt; der genaue Betrag mit mindestens zwei
// und höchstens vier, damit ein Rundungsschritt sichtbar bleibt und er neben den übrigen
// Beträgen nicht ohne Cent dasteht.
function fmtPercent(n: number): string {
  return n.toLocaleString('de-DE', { maximumFractionDigits: 6 })
}
function fmtExactEuro(cents: number): string {
  return `${(cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} €`
}

// Ein Betrag für den Rechenweg auf der Abrechnung (#94): mit zwei Stellen und einem gewöhnlichen
// Leerzeichen vor dem Zeichen. `toLocaleString` mit `currency` setzte ein geschütztes, das in
// den Zeilen nicht anders aussieht, beim Vergleichen und Kopieren aber stört.
function fmtCents(cents: number): string {
  return `${(cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
}

// Die Maßstäbe einer Gemeinschaft, wie sie im Rechenweg heißen (#94).
const MEASURE_LABELS: Record<ExternalMeasure, string> = { mea: 'MEA', area: 'm²', units: 'Einheiten' }

// ---------- Abrechnung ----------

// Mietverhältnis, ergänzt um die im Jahr belegten Tage und die zugehörige Wohnung: das
// Ergebnis der Vorbereitung unten, sobald Mietverhältnisse ohne (mehr) vorhandene Wohnung
// herausgefiltert sind.
type TenancyWithUnit = SnapshotTenancy & { days: number, unit: SnapshotUnit }

// Ziel einer Kostenverteilung: das Mietverhältnis, sein (float) Rohanteil in Cent und der Text,
// der die Berechnungsgrundlage auf der Abrechnung beschreibt.
// `community`: bei der Gemeinschaftsabrechnung die Schritte davor (#114, #144). Erst der Anteil an
// der Gemeinschaft (Anteil × Kosten der Gemeinschaft), dann, ob der Betrag davon abweicht, dann
// der Anteil der Wohnung innerhalb der Wohnungen des Vermieters, nach dem wirklich verteilt wird;
// `ownShare` fehlt, wenn er nur eine hat.
type CommunitySteps = { costsCents: number, share: string, term: TermId, appliedCents: number | null, ownShare: string | null }
// `heating`: bei der eigenen Heizkostenabrechnung (Heizung PR 10) die Schritte über Grund- und
// Verbrauchskosten, Warmwasseranteil und Anteil, statt der Verteilbasis.
type Target = { t: TenancyWithUnit, raw: number, basisText: string, community?: CommunitySteps, heating?: CalcStep[] }

// Verbrauch und Zähler eines Zählertyps, aufbereitet für die Verteilung. Der Wert ist bewusst
// optional (nicht `Record<string, ConsumptionByTypeEntry>`): zu einer Kostenposition mit einem
// Zählertyp ohne Zähler gibt es keinen Eintrag, und `data` unten ist dann `undefined` statt
// eines für den Übersetzer immer vorhandenen Werts. Nur so bleibt die folgende Prüfung
// `if (!data || data.basis <= 0)` sichtbar nötig statt totem Code.
// Zum Hauptzähler (#116): `unmetered` sind bewohnte Einheiten ohne abgelesenen Zähler dieses
// Typs. `main` ist sein Verbrauch, wenn er die Basis ist, sonst null. Die übrigen Felder sagen,
// warum er es nicht ist, oder dass er weit mehr zeigt als die Wohnungszähler.
type ConsumptionByTypeEntry = {
  meters: (SnapshotMeter & { unitId: string })[]
  basis: number
  perUnit: Map<string, number>
  selfConsumption: number
  unmetered: SnapshotUnit[]
  limited: boolean
  hasMain: boolean
  main: number | null
  mainPartial: { meterId: string, days: number } | null
  mainBelowUnits: { main: number, units: number } | null
  mainGap: { main: number, units: number } | null
  // Bewohnte Einheiten, deren Zähler nur einen Teil ihrer Zeit abdecken (Befund der Durchsicht).
  partial: { unit: SnapshotUnit, covered: number, needed: number }[]
}

// Das tatsächliche Ergebnis von computeSettlement: wie Settlement aus shared/types.ts, aber ohne
// `closed` — das ergänzt erst die Route GET /api/settlement/:year.
// Frisch gerechnet sind die Felder immer da, die am `Settlement` für alte eingefrorene
// Abrechnungen optional sind.
export type ComputedSettlement = Omit<Settlement, 'closed' | 'notSettled' | 'notices' | 'legalBasis' | 'garageLikeUnitIds'> & {
  notSettled: NotSettled[]
  garageLikeUnitIds: string[]
  notices: Notice[]
  // Frisch gerechnet immer mit den benutzten Rechtswerten (Heizung PR 1)
  legalBasis: LegalBasis & { values: AppliedValue[] }
}

// Die Kostenart, an der Mietfuchs Heizung und Warmwasser erkennt (#93), steht mit der Ausnahme
// des § 2 HeizkostenV in shared/heating.ts; hier weitergereicht für die bisherigen Importe.
export { HEATING_CATEGORY }

// Die Zuführung zur Erhaltungsrücklage einer Eigentumswohnung (#143): nicht umlagefähig wie
// „Nicht umlagefähig“, aber steuerlich anders (siehe ANLAGE_V_GROUP).
export const RESERVE_CATEGORY = 'Zuführung Erhaltungsrücklage'
// Woran eine Beschreibung nach Rücklage aussieht: Rücklage, Instandhaltungs- und
// Erhaltungsrücklage, auch ohne Umlaut geschrieben.
// Eine Entnahme oder eine Zahlung „aus der Rücklage“ ist keine Zuführung (Durchsicht): Sie ist in
// dem Jahr Werbungskosten, in dem die Gemeinschaft das Geld ausgibt. Dieselbe Regel steht in
// matchCategory (client/src/types.ts); categories.test.ts prüft beide an denselben Texten.
const RESERVE_PATTERN = /r(ü|ue|u)cklage/i
const RESERVE_WITHDRAWAL = /entnahme|\baus\s+(der|dem)\b/i
// Wer „Zuführung“ schreibt, meint sie, auch „aus dem Hausgeld“.
const RESERVE_CONTRIBUTION = /zuf(ü|ue|u)hrung/i
export const looksLikeReserveContribution = (text: string): boolean =>
  RESERVE_PATTERN.test(text) && (RESERVE_CONTRIBUTION.test(text) || !RESERVE_WITHDRAWAL.test(text))

// Kostenarten, die nie auf Mieter verteilt werden. Dieselbe Menge steht als NOT_ALLOCABLE in
// client/src/types.ts; categories.test.ts hält beide zusammen.
export const NOT_ALLOCABLE_CATEGORIES: readonly string[] = ['Nicht umlagefähig', RESERVE_CATEGORY]
export const isNotAllocable = (category: string): boolean => NOT_ALLOCABLE_CATEGORIES.includes(category)

// Die Zeilen des Vermieters einer verteilten Position (#142, #202), in fester Reihenfolge: Jeder
// Grund ist ein Empfänger der einen Verteilung, und was er dort bekommt, ist zugleich sein Teil in
// der Zerlegung des Vermieteranteils. Nichts wird danach noch einmal gerundet oder begrenzt; einen
// Grund „Rundung“ gibt es deshalb nicht mehr (in eingefrorenen Abrechnungen kann er stehen).
//
// Die Anteile der Mietverhältnisse mit Pauschale, Inklusivmiete oder ohne Abrechnung sind exakte
// Anteile wie die der Mieter, und ebenso der Eigenanteil: Er ist immer sein exakter Wert, auch
// wenn andere Zeilen zusammen mehr als den Betrag ergeben (Durchsicht von #203: sonst fraß der
// Überhang zweier sich überschneidender Mietverhältnisse den Eigenanteil, und der private Teil
// erschien in der Steuerübersicht als abziehbar). Die übrigen Gründe beschreiben, was bleibt, und
// können sich mit dem Eigenanteil überschneiden (der Rest des Hauptzählers ist bei einer
// selbstgenutzten Wohnung ohne Zähler ihr Eigenanteil). Sie bekommen deshalb der Reihe nach
// höchstens, was noch übrig ist, wie vor #202 in der Zerlegung, nur jetzt vor dem Runden. Ein
// negativer Wert eines Grundes (ein rückwärts laufender Zähler außerhalb) bleibt bei seinem Grund
// und erscheint nicht unter fremdem Namen. Der letzte Grund ist der Rest: bei Einzelbeträgen der
// Rest der Einzelabrechnung, sonst Leerstand. So ergeben die exakten Werte zusammen genau den
// Betrag. Liegt er nur durch Rechenrauschen unter 0, ist er 0.
//
// Bei widerspruchsfreien Daten hat keine Zeile des Vermieters das umgekehrte Vorzeichen der
// Position. Zwei Datenfehler durchbrechen das, und dann bleibt der Fehler sichtbar, statt einen
// anderen Grund zu verbiegen: Überschneiden sich zwei Mietverhältnisse derselben Wohnung, tragen
// die Mieter rechnerisch mehr als den Betrag, und der Rest (Leerstand) wird negativ; läuft ein
// Zähler rückwärts, wird sein Grund negativ (dazu gibt es eine Meldung). Die Summe stimmt auch dann.
//
// Beim Vorwegabzug des Messdienstes (Heizung PR 6) steht der CO₂-Anteil des Vermieters als eigener
// Grund `co2Share` direkt hinter dem Eigenanteil; er gilt nur für die eine Position, in der L steckt.
function landlordRecipients(
  item: SnapshotCostItem,
  p: { selfRaw: number, co2ShareRaw: number | null, notBooked: { reason: LandlordReason | CostModel, raw: number }[], outsideRaw: number, customUnassignedRaw: number, mainRestRaw: number, bookedRaw: number },
): Recipient[] {
  const sign = item.amountCents < 0 ? -1 : 1
  const sum = (reason: string) => p.notBooked.filter((x) => x.reason === reason).reduce((a, x) => a + x.raw, 0)
  let left = (item.amountCents - p.bookedRaw - p.notBooked.reduce((a, x) => a + x.raw, 0)) * sign
  const take = (raw: number): number => {
    if (raw * sign <= 0) { left -= raw * sign; return raw }
    const t = Math.max(0, Math.min(raw * sign, left))
    left -= t
    return t * sign
  }
  const self = p.selfRaw
  left -= self * sign
  // Der CO₂-Anteil des Vermieters beim Vorwegabzug (Heizung PR 6, Entwurf 7.4, W10): nach dem
  // exakten Eigenanteil und vor allen übrigen Gründen, durch den Rest begrenzt. Reicht der Rest nicht,
  // kappt `take` ihn; bei bestandener Probe um höchstens NE · 2 ct. Der Eigenanteil (darin L_self)
  // wird nie gekürzt (G-B2, #203).
  const co2 = p.co2ShareRaw === null ? null : take(p.co2ShareRaw)
  const outside = take(p.outsideRaw)
  const custom = take(p.customUnassignedRaw)
  const mainRest = take(p.mainRestRaw)
  let rest = cleanRaw(left * sign)
  if (rest * sign < 0 && rest * sign > -0.5) rest = 0
  return [
    { key: 'selfUse', landlord: true, raw: self },
    ...(co2 === null ? [] : [{ key: 'co2Share', landlord: true, raw: co2 }]),
    { key: 'flatRate', landlord: true, raw: sum('flatRate') },
    { key: 'inclusive', landlord: true, raw: sum('inclusive') },
    { key: 'outsideUnit', landlord: true, raw: sum('outsideUnit') + outside },
    { key: 'customRest', landlord: true, raw: custom },
    { key: 'mainMeterRest', landlord: true, raw: mainRest },
    { key: item.key === 'amounts' ? 'amountsRest' : 'vacancy', landlord: true, raw: rest },
  ]
}

// Welches Modell für eine Kostenposition gilt: das für Heizung bei der Heizkostenart, sonst das
// für die kalten Kosten. Ohne Angabe die Abrechnung.
const modelFor = (t: SnapshotTenancy, item: SnapshotCostItem): CostModel =>
  (item.category === HEATING_CATEGORY ? t.heatingModel : t.costModel) ?? 'settlement'

// Optionen der Abrechnung. `asOf` (JJJJ-MM-TT) ist der Stichtag für den Hinweis auf einen
// Rückstand im Mietkonto (#133); die Route setzt ihn auf heute. Die Berechnung selbst fragt nie
// nach dem heutigen Datum, sonst rechneten dieselben Daten an zwei Tagen verschieden. Ohne
// Stichtag (Tests, Regression des Umstiegs) gilt das ganze Jahr als fällig.
// `onAllocation` bekommt je Position ihre Verteilung (#202), für die Invarianten der Tests; die
// Abrechnung selbst hängt nicht davon ab.
export type SettlementOptions = { asOf?: string, onAllocation?: (trace: AllocationTrace) => void }

// Der Schlüssel als Satzteil („2025 nach Personenzahl verteilt“), für den Hinweis unten.
const KEY_PHRASES: Record<CostKey, string> = {
  area: 'nach Wohnfläche',
  persons: 'nach Personenzahl',
  units: 'nach Wohneinheiten',
  direct: 'per Direktzuordnung',
  meter: 'nach Verbrauch',
  custom: 'nach vereinbarten Anteilen',
  external: 'laut Gemeinschaftsabrechnung',
  amounts: 'als Einzelbeträge',
  heatingSystem: 'nach der Heizkostenverordnung',
}

// Hat eine Position einen anderen Schlüssel als dieselbe Kostenart im Vorjahr (#141)? Dann der
// Text des Hinweises, sonst `null`. „Derselbe Schlüssel“ heißt dasselbe wie für den Vorschlag der
// Oberfläche (shared/allocation.ts); entspricht die Position einer der Vorjahrespositionen, ist sie
// keine Änderung. Wortlaut des § 556a BGB nachgelesen auf gesetze-im-internet.de.
function keyChangeText(item: SnapshotCostItem, previous: readonly SnapshotCostItem[], at: PeriodContext, basisUnitIds: readonly string[]): string | null {
  if (isNotAllocable(item.category)) return null
  // Bei einer breiten Kostenart nur die Position mit derselben Beschreibung (Befund der Durchsicht).
  const before = comparablePrevious(previous, item.category, at, item.description).map((i) => allocationOf(i, basisUnitIds))
  const now = allocationOf(item, basisUnitIds)
  const first = before[0]
  if (!first || before.some((a) => sameAllocation(a, now))) return null
  const sameKey = before.find((a) => a.key === now.key)
  const what = !sameKey
    ? `„${item.description}“ wird ${at.label} ${KEY_PHRASES[now.key]} verteilt, die Kostenart „${item.category}“ ${at.previousLabel} ${KEY_PHRASES[first.key]}.`
    : `„${item.description}“ wird ${at.label} wieder ${KEY_PHRASES[now.key]} verteilt, aber mit ${
      !sameUnits(sameKey.participantUnitIds, now.participantUnitIds) ? 'anderen beteiligten Wohnungen'
        : sameKey.meterType !== now.meterType ? 'einem anderen Zählertyp'
          : sameKey.directUnitId !== now.directUnitId ? 'einer anderen Wohnung'
            : now.key === 'custom' ? 'anderen vereinbarten Anteilen'
              : 'einem anderen Maßstab der Gemeinschaft'
    } als ${at.previousLabel}.`
  // Wortlaut nachgelesen auf gesetze-im-internet.de: § 556a BGB und § 6 Abs. 4 HeizkostenV. Für
  // Heizung und Warmwasser geht die Verordnung vor und erlaubt die Änderung in weiteren Fällen.
  if (item.category === HEATING_CATEGORY) {
    return `${what} Für Heizung und Warmwasser gilt die Heizkostenverordnung: Den Abrechnungsmaßstab darf der Gebäudeeigentümer durch Erklärung gegenüber den Nutzern für künftige Abrechnungszeiträume ändern, bei Einführung einer Vorerfassung nach Nutzergruppen, nach baulichen Maßnahmen, die nachhaltig Heizenergie einsparen, oder aus anderen sachgerechten Gründen, und nur mit Wirkung zum Beginn eines Abrechnungszeitraums (§ 6 Abs. 4 HeizkostenV). ` +
      'Ist die Änderung so erklärt oder vereinbart, ist nichts zu tun.'
  }
  return `${what} Ein vereinbarter Umlageschlüssel gilt weiter, bis er geändert wird: mit Zustimmung der Mieter, oder durch Ihre Erklärung in Textform, nur vor Beginn eines Abrechnungszeitraums und nur hin zu einer Verteilung nach erfasstem Verbrauch oder erfasster Verursachung (§ 556a Abs. 2 BGB). ` +
    'Bei einer vermieteten Eigentumswohnung gilt, soweit nichts anderes vereinbart ist, der jeweils geltende Maßstab der Gemeinschaft; widerspricht er billigem Ermessen, wird nach Absatz 1 umgelegt, also in der Regel nach Wohnfläche (§ 556a Abs. 3 BGB). Ist die Änderung so vereinbart, ist nichts zu tun.'
}

export function computeSettlement(snapshot: Snapshot, options: SettlementOptions = {}): ComputedSettlement {
  // Der Abrechnungszeitraum (#208). Grenzen, Tage und Monate kommen von hier; `year` ist das
  // Kalenderjahr des Beginns und steht nur noch im Ergebnis und an den Kabelzeilen (siehe dort).
  const period = snapshot.period
  const year = snapshot.year
  const diy = periodDays(period)
  const yFrom = period.from
  const yTo = period.to
  const label = periodLabel(period)
  // Das Protokoll der Rechtswerte dieser Abrechnung (Heizung PR 1, Entwurf 4.2): Jede Abfrage
  // trägt ein, was sie bekommen hat, und am Ende steht es in `legalBasis.values`. Abgefragt wird
  // erst dort, wo ein Wert wirklich gebraucht wird, damit nur Benutztes einfriert. `lawPeriod`
  // spannt den Abrechnungszeitraum (#208).
  const lawLog = createLawLog()
  const lawPeriod: Period = { from: yFrom, to: yTo }
  // Zeitraum und Vorzeitraum für den Vergleich der Schlüssel und der Doppelungen (#141).
  const at = contextOf(period, snapshot.previousPeriod)
  // Heizung PR 5. `scope`: 'heatingPart' ist die Heizperiode, die eine Abrechnung P nach Weg b in sich
  // aufnimmt (ohne Vorauszahlungen, ohne eigene Hinweise zum Mietkonto), 'heating' die
  // Heizkostenabrechnung einer Heizperiode nach Weg d; ohne Angabe die Betriebskostenabrechnung.
  const scope = snapshot.scope?.kind ?? 'all'
  const objectRules = snapshot.objectRules ?? CALENDAR_RULES
  const plants = snapshot.heatingPlants ?? []
  const unitById = new Map(snapshot.units.map((u) => [u.id, u]))
  // Selbstgenutzte Wohnungen (`selfUsed`) haben kein Mietverhältnis, bilden aber die
  // Verteilbasis mit: Kosten einer Rechnung über das ganze Haus dürfen nur anteilig auf die
  // Mieter umgelegt werden, der auf die selbstgenutzte Wohnung entfallende Teil bleibt beim
  // Vermieter (Eigenanteil) — wie bei Leerstand. Wohnungen ohne beide Kennzeichen gehören
  // nicht zur Abrechnungseinheit und bleiben ganz außen vor.
  // `participates` hat Vorrang: eine vermietete Wohnung ist nie Eigennutzung, auch wenn ein
  // von Hand bearbeiteter Datenbestand beide Kennzeichen trägt (siehe usageOf in types.ts).
  const selfUnits = snapshot.units.filter((u) => u.selfUsed && !u.participates)
  const basisUnits = snapshot.units.filter((u) => u.participates || u.selfUsed)
  const basisArea = basisUnits.reduce((a, u) => a + (u.areaM2 || 0), 0)
  const selfArea = selfUnits.reduce((a, u) => a + (u.areaM2 || 0), 0)
  // Werte aus der Datei defensiv behandeln: negative oder unsinnige Personenzahlen dürfen die
  // Verteilbasis nicht verkleinern — das würde die Mieteranteile über 100 % treiben.
  const selfPersonsOf = (u: SnapshotUnit) => Math.max(0, Number(u.selfPersons) || 0)

  // Mietverhältnisse mit Überlappung im Jahr, bewusst mit flatMap statt map().filter(): Erst so
  // prüft der Übersetzer mit, dass jedes übriggebliebene Mietverhältnis wirklich eine Wohnung
  // hat. Weder eine Zusicherung `as TenancyWithUnit[]` noch ein Prädikat
  // `(t): t is TenancyWithUnit` täte das — beide sind bloße Behauptungen über die Bedingung.
  // Fiele das `unit` später aus ihr heraus, übersetzte das weiterhin, und die Engine stürzte
  // ab, sobald eine gelöschte Wohnung ein Mietverhältnis hinterlässt (`t.unit` unten).
  const tenancies: TenancyWithUnit[] = snapshot.tenancies.flatMap((t) => {
    const days = rangeOverlapDays(t.start, t.end, yFrom, yTo)
    const unit = unitById.get(t.unitId)
    return days > 0 && unit ? [{ ...t, days, unit }] : []
  })
  const partTenancies = tenancies.filter((t) => t.unit.participates)
  // Garage-artig (#135): keine Fläche, und im Jahr ausdrücklich mit 0 Personen genutzt, also
  // mindestens ein Mietverhältnis und keines mit Personen (bei Eigennutzung ausdrücklich 0 eigene
  // Personen). Dann ist eine 0 eine Angabe (Garage, Stellplatz, Lager) und keine vergessene Zahl;
  // siehe die Hinweise zur Verteilbasis unten. **Leerstand zählt nicht dazu**: Ohne Mietverhältnis
  // lässt sich eine Garage von einer Wohnung mit vergessener Fläche nicht unterscheiden, und im
  // zweiten Fall wanderte der Anteil des Leerstands still zu den Mietern. Eine leere Garage warnt
  // dann eben; das ist der billigere Irrtum.
  const isGarageLike = (u: SnapshotUnit): boolean => {
    if (u.areaM2 > 0) return false
    if (u.selfUsed) return u.selfPersons === 0
    const own = tenancies.filter((t) => t.unitId === u.id)
    return own.length > 0 && own.every((t) => !(personDaysInPeriod(t, yFrom, yTo) > 0))
  }
  // Personentage der selbstgenutzten Wohnungen: ganzjährig mit der hinterlegten Personenzahl
  const selfPersonDays = selfUnits.reduce((a, u) => a + selfPersonsOf(u) * diy, 0)
  // Wohnung ist, was Fläche hat oder im Jahr bewohnt ist; eine Einheit ohne Fläche und ohne
  // Bewohner (Garage, Stellplatz) ist keine. Eine Regel für zwei Fragen: ob das Gebäude unter § 2
  // HeizkostenV fällt (unten) und ob eine leere Einheit beim Personenschlüssel Leerstand ist (#177).
  const inhabited = (u: SnapshotUnit) => u.selfUsed && !u.participates
    ? selfPersonsOf(u) > 0
    : tenancies.some((t) => t.unitId === u.id && personDaysInPeriod(t, yFrom, yTo) > 0)
  const isDwelling = (u: SnapshotUnit) => u.areaM2 > 0 || inhabited(u)
  // **Leerstand beim Personenschlüssel (#177).** Eine leere Wohnung hat keine Personentage und fiel
  // deshalb aus der Verteilbasis: Ihr Anteil ging still an die übrigen Mieter, während Fläche und
  // Einheiten ihn beim Vermieter ließen. Den Leerstand trägt der Vermieter (BGH, Urteil vom
  // 31.05.2006, VIII ZR 159/05, dort am Flächenschlüssel entschieden; zum Personenschlüssel die
  // fiktive Person nach BGH VIII ZR 180/12, siehe `practice.vacancy-persons` im Rechtsregister).
  // Deshalb zählt jede vermietete Wohnung der Verteilbasis für jeden Tag ohne Mietverhältnis mit
  // `vacancyPersons(u)` Personen; kein Mietverhältnis bekommt diese Tage, ihr Anteil bleibt also
  // als `vacancy` beim Vermieter. Auch der Leerstand zwischen zwei Mietern zählt.
  // Ausgenommen sind die selbstgenutzten Wohnungen (die zählen mit ihren eigenen Personen) und
  // alles, was keine Wohnung ist (`isDwelling`, dieselbe Regel wie bei § 2 HeizkostenV): Eine
  // Einheit ohne Fläche und ohne Bewohner, leer oder mit 0 Personen vermietet (Garage, Stellplatz,
  // #135), bekäme sonst eine fiktive Person, und eine Tiefgarage mit vier leeren Stellplätzen
  // verschöbe dem Vermieter einen großen Teil der Müllabfuhr. Eine ganz leere Einheit mit 0 m² meldet
  // dafür `basis.vacancy-no-area`, denn sie kann auch eine Wohnung mit vergessener Fläche sein. Eine
  // leere Garage **mit** eingetragener Fläche ist nach dieser Regel eine Wohnung und zählt weiter als
  // Leerstand; wer das nicht will, nimmt sie aus der Abrechnungseinheit oder aus den Teilnehmern.
  // Die Zahl je Wohnung kommt aus dieser einen Funktion: Wer später etwa die durchschnittliche
  // Belegung des Hauses ansetzen will, rechnet sie hier aus (ohne die Leerstände selbst). Der Wert
  // steht im Rechtsregister (`practice.vacancy-persons`) und wird nur bei Leerstand abgefragt.
  const vacancyPersons = (_u: SnapshotUnit): number => law(practiceVacancyPersons, { period: lawPeriod }, lawLog)
  type Vacancy = { unit: SnapshotUnit, days: number, persons: number, personDays: number }
  const vacancies: Vacancy[] = basisUnits.flatMap((u) => {
    if (!u.participates || !isDwelling(u)) return []
    const days = diy - occupiedDays(tenancies.filter((t) => t.unitId === u.id), yFrom, yTo)
    if (days <= 0) return []
    const persons = vacancyPersons(u)
    return persons > 0 ? [{ unit: u, days, persons, personDays: days * persons }] : []
  })
  const vacancyPersonDays = vacancies.reduce((a, v) => a + v.personDays, 0)
  const personsLabel = (n: number) => `${fmtNum(n)} ${n === 1 ? 'Person' : 'Personen'}`
  const daysLabel = (n: number) => `${fmtNum(n)} ${n === 1 ? 'Tag' : 'Tage'}`
  const vacancyText = (vs: Vacancy[]) =>
    vs.map((v) => `${v.unit.name}: ${daysLabel(v.days)} × ${personsLabel(v.persons)} = ${fmtNum(v.personDays)} ${v.personDays === 1 ? 'Personentag' : 'Personentage'}`).join('; ')
  // Personentage der Bewohner, ohne Leerstand: Fehlen sie bei vorhandenen Mietverhältnissen ganz,
  // ist das ein Datenmangel und keine Verteilung an den Leerstand (siehe `item.no-basis`).
  const occupantPersonDays =
    partTenancies.reduce((a, t) => a + personDaysInPeriod(t, yFrom, yTo), 0) + selfPersonDays
  const basisPersonDays = occupantPersonDays + vacancyPersonDays

  // Verbrauch je Zählertyp vorbereiten (nur Wohnungszähler bilden die Verteilbasis)
  // Alle Ablesungen, nicht nur die des Jahres: Der Anfangsstand steht im Vorjahr (siehe
  // snapshot.ts). `consumptionInPeriod` schneidet den Zeitraum tagesanteilig heraus.
  const allMeters = snapshot.meters
  const allReadings = snapshot.readings
  // Bewohnt im Jahr: selbstgenutzt oder mit einem Mietverhältnis. Nur bei ihnen fehlt ein
  // Zähler wirklich; eine leere Wohnung oder eine unvermietete Garage verbraucht nichts (#116).
  const occupied = new Set([...snapshot.units.filter((u) => u.selfUsed).map((u) => u.id), ...tenancies.map((t) => t.unitId)])
  const readingsOf = (meterId: string) => allReadings.filter((r) => r.meterId === meterId)
  // Wie viele Tage des Jahres ein Zähler der Einheit abdecken muss: das ganze Jahr bei einer
  // selbstgenutzten, sonst die Tage ihrer Mietverhältnisse.
  const neededDays = (u: SnapshotUnit) =>
    u.selfUsed ? diy : Math.min(diy, tenancies.filter((t) => t.unitId === u.id).reduce((a, t) => a + t.days, 0))
  // `only`: die Teilnehmer einer Position (#94); ohne sie alle Wohnungszähler wie bisher.
  // `basisOnes`: die Wohnungen der Verteilbasis.
  // Zähler der Heizanlage selbst (Gaszähler, Wärmezähler am Speicher; Heizung PR 4) haben keine
  // Wohnung, sind aber kein Hauptzähler des Hauses: Sie messen, was die Anlage bezieht oder erzeugt,
  // nicht, was die Wohnungen zusammen verbraucht haben. Als Hauptzähler gelesen, machte ein
  // Wärmezähler am Speicher aus jeder Wohnung ohne Wärmezähler einen Rest nach #116.
  const houseMeters = allMeters.filter((m) => !m.unitId && !m.heatingPlantId)
  // Wasser (Entwurf 5.3, G-B8): Beim Kaltwasser zählen die Warmwasserzähler der Wohnungen mit, denn
  // die Wasserkosten des Warmwassers gehören dazu, soweit sie nicht gesondert abgerechnet werden
  // (§ 8 Abs. 2 HeizkostenV), und der Hauptzähler misst beides. Ob eine Wohnung einen Zähler hat
  // (#116), sagt aber nur ein Kaltwasserzähler: Mit nur einem Warmwasserzähler fehlt ihr Kaltwasser,
  // und es kommt über den Hauptzähler.
  const measures = (type: string, m: SnapshotMeter): boolean => m.type === type || (type === 'kaltwasser' && m.type === 'warmwasser')
  const consumptionFor = (selfOnes: SnapshotUnit[], only: Set<string> | null, basisOnes: SnapshotUnit[]) => {
    const byType: Record<string, ConsumptionByTypeEntry | undefined> = {}
    const unitMeters = allMeters.filter((m) => m.unitId && (only === null || only.has(m.unitId)))
    // Hauptzähler: Zähler ohne Wohnung. Er misst das ganze Haus und taugt deshalb nicht als
    // Basis einer Position, die nur für einen Teil der Wohnungen gilt.
    const mainMeters = only === null ? houseMeters : []
    const selfIds = new Set(selfOnes.map((u) => u.id))
    // Ein Warmwasserzähler bringt auch den Kaltwasser-Schlüssel mit (siehe `measures`).
    const meterTypes = [...new Set(unitMeters.flatMap((m): string[] => (m.type === 'warmwasser' ? ['warmwasser', 'kaltwasser'] : [m.type])))]
    for (const type of meterTypes) {
      const meters = unitMeters.filter((m) => measures(type, m)) as (SnapshotMeter & { unitId: string })[]
      // Verbrauch je Wohnung, für den Eigenanteil; beim Kaltwasser samt Warmwasser.
      const usage = new Map<string, number>()
      // Wohnungen mit einem abgelesenen Zähler genau dieses Typs (#116, G-B8).
      const perUnit = new Map<string, number>()
      let basis = 0
      for (const m of meters) {
        const readings = readingsOf(m.id)
        const c = consumptionInPeriod(readings, yFrom, yTo)
        basis += c
        // Ein angelegter, aber im Jahr nie abgelesener Zähler ist kein Zähler: Sonst gälte die
        // Wohnung als gemessen, und der Fehler aus #116 käme ohne Warnung zurück.
        if (coveredDays(readings, yFrom, yTo) > 0) {
          usage.set(m.unitId, (usage.get(m.unitId) || 0) + c)
          if (m.type === type) perUnit.set(m.unitId, (perUnit.get(m.unitId) || 0) + c)
        }
      }
      // Ein Zählerstand belegt Verbrauch innerhalb der abgerechneten Menge und zählt deshalb
      // unabhängig vom Beteiligungs-Kennzeichen in die Basis; der Anteil nicht vermieteter
      // Wohnungen fällt damit ohnehin dem Vermieter zu.
      let selfConsumption = selfOnes.reduce((a, u) => a + (usage.get(u.id) || 0), 0)
      // **Vorwegabzug über den Hauptzähler (#116).** Hat jede bewohnte Einheit einen Zähler,
      // bleibt es bei ihrem Verhältnis, und die Messdifferenz zum Hauptzähler geht darin auf,
      // wie bisher. Fehlt einer der Zähler, ist ihr Verbrauch der Rest des Hauptzählers, und die
      // Basis ist der Hauptzähler; sonst zahlten die gemessenen Wohnungen ihren Verbrauch mit.
      // Gefragt wird ohne Teilnehmer jede Einheit des Objekts, auch außerhalb der
      // Abrechnungseinheit, denn der Hauptzähler misst sie alle.
      const candidates = only === null ? snapshot.units : basisOnes
      // Ohne Anschluss für diesen Typ (#117) fehlt auch kein Zähler, etwa bei einer Garage ohne Wasser.
      const unmetered = candidates.filter((u) => occupied.has(u.id) && !perUnit.has(u.id) && !(u.noConnection ?? []).includes(type as MeterType))
      // Gemessen, aber lückenhaft: Der Verbrauch der Lücke steckt dann im Rest des Hauptzählers.
      const partial = candidates.flatMap((u) => {
        if (!occupied.has(u.id) || !perUnit.has(u.id)) return []
        const covered = unitCoveredDays(meters.filter((m) => m.unitId === u.id && m.type === type).map((m) => readingsOf(m.id)), yFrom, yTo)
        const needed = neededDays(u)
        return covered < needed ? [{ unit: u, covered, needed }] : []
      })
      const mainOfType = mainMeters.filter((m) => m.type === type)
      const main = mainOfType.reduce((a, m) => a + consumptionInPeriod(readingsOf(m.id), yFrom, yTo), 0)
      // Nur ein Hauptzähler über das ganze Jahr taugt als Basis. Der Versorger liest selten zum
      // 31.12. ab, und ein Teiljahr gegen ganzjährige Wohnungszähler verschöbe die Anteile.
      const mainShort = mainOfType
        .map((m) => ({ meterId: m.id, days: coveredDays(readingsOf(m.id), yFrom, yTo) }))
        .find((c) => c.days < diy) ?? null
      let mainBasis: number | null = null
      let mainPartial: ConsumptionByTypeEntry['mainPartial'] = null
      let mainBelowUnits: ConsumptionByTypeEntry['mainBelowUnits'] = null
      let mainGap: ConsumptionByTypeEntry['mainGap'] = null
      if (mainOfType.length > 0 && unmetered.length > 0) {
        if (mainShort) {
          mainPartial = mainShort
        } else if (main < basis) {
          mainBelowUnits = { main, units: basis }
        } else if (main > 0) {
          mainBasis = main
          // Der Rest gehört zu den Einheiten ohne Zähler. Sind das nur selbstgenutzte, ist er ihr
          // Eigenanteil. Ist eine andere dabei, lässt er sich nicht aufteilen und bleibt beim
          // Vermieter, ohne Eigenanteil zu sein; das sagt eine Warnung.
          if (unmetered.every((u) => selfIds.has(u.id)) && partial.length === 0) selfConsumption += main - basis
          basis = main
        }
      } else if (mainOfType.length > 0 && !mainShort && basis < main * 0.8) {
        // Alle bewohnten Einheiten haben Zähler und erfassen doch weit weniger als der
        // Hauptzähler. Typisch, wenn eine Wohnung gar nicht angelegt ist; von einer gewöhnlichen
        // Messdifferenz lässt sich das nicht unterscheiden, also bleibt die Zahl, und es gibt
        // einen Hinweis. Die Grenze von 20 Prozent ist eine Schwelle zum Hinsehen, keine Regel.
        mainGap = { main, units: basis }
      }
      byType[type] = {
        meters, basis, perUnit, selfConsumption, unmetered, limited: only !== null,
        hasMain: mainOfType.length > 0, main: mainBasis, mainPartial, mainBelowUnits, mainGap, partial,
      }
    }
    return byType
  }
  const consumptionByType = consumptionFor(selfUnits, null, basisUnits)

  // Früh angelegt (Heizung PR 5): Die Vorauszahlung der Heizkostenabrechnung meldet schon beim
  // Anlegen der Statements eine vorläufige Korrektur.
  const notices: Notice[] = []
  const warn = (code: NoticeCode, text: string, subject?: NoticeSubject) => notices.push(makeNotice(code, text, subject))
  // Weg d (Heizung PR 5): die Heizvorauszahlungen der Monate dieser Heizperiode. Eine vorläufige
  // Korrektur meldet die Abrechnung, bis die Heizperiode abgeschlossen ist (D2 der achten Fassung);
  // danach steht die Warnung im eingefrorenen Stand, und eine neue Abrechnung gibt es nicht.
  const heatingScopePrepayment = (t: TenancyWithUnit): { cents: number, overridden: boolean, heatingCents: number, note?: string } => {
    const plant = snapshot.scope?.plant
    // Nur, wen die Anlage versorgt (Durchsicht von #231): Die Heizstaffel einer Wohnung ohne Anschluss
    // an diese Anlage rechnet P an (`prepaymentOf`), sonst stünde sie in beiden Abrechnungen.
    if (!plant || !servesUnit(plant, t.unit)) return { cents: 0, overridden: false, heatingCents: 0 }
    const way = wayOf(plant)
    const r = heatingPrepaymentCents(t, plant?.id ?? '', period, (m) => separateOwner(way, objectRules, m)?.key === period.key)
    const byPeriod = new Map<string, { label: string, months: string[] }>()
    for (const m of r.elsewhere) {
      const p = periodContaining(objectRules, `${m}-01`)
      const entry = byPeriod.get(p.key) ?? { label: periodLabel(p), months: [] }
      entry.months.push(m)
      byPeriod.set(p.key, entry)
    }
    const note = [...byPeriod.values()].map((e) => `Die Vorauszahlungen ${monthSpanText(e.months)} sind in der Abrechnung ${e.label} angerechnet.`).join(' ')
    if (r.provisional !== null && r.provisional.fromMonth !== null && r.provisional.toMonth !== null) {
      const from = r.provisional.fromMonth
      const to = r.provisional.toMonth
      const covered = periodMonths(period).filter((m) => m >= from && m <= to)
      warn('prepayment.heating-override-pending',
        `${t.tenantName} (${t.unit.name}): Für ${monthSpanText(covered)} gilt vorläufig ${fmtCents(r.provisional.cents)}, der Rest der Korrektur der Abrechnung ${periodLabel(periodContaining(objectRules, `${from}-01`))}. ` +
          `Erfassen Sie beim Abrechnen die tatsächlich gezahlten Heizvorauszahlungen für die ganze Heizperiode ${label} („✎ anpassen“); bis dahin bleibt diese Warnung.`,
        { kind: 'tenancy', id: t.id })
    }
    return { cents: r.cents, overridden: r.overridden, heatingCents: r.cents, ...(note ? { note } : {}) }
  }
  // Die Vorauszahlungen eines Mietverhältnisses (#208, Heizung PR 5): in einer Teilabrechnung nach
  // Weg b keine (die rechnet P an); sonst die übrigen und die Heizstaffel der Monate, die keiner
  // getrennt abgerechneten Heizperiode gehören (6.1 Nr. 5). Welche Anlage die Wohnung versorgt, sagt
  // `servesUnit`; ohne Anlage zählt die ganze Heizstaffel.
  const prepaymentOf = (t: TenancyWithUnit): { cents: number, overridden: boolean, heatingCents?: number, note?: string } => {
    if (scope === 'heatingPart') return { cents: 0, overridden: false }
    if (scope === 'heating') return heatingScopePrepayment(t)
    // Die Anlage, die die Wohnung versorgt, ausdrücklich (vorbereitend auf mehrere Anlagen, PR 9):
    // Nur deren getrennte Heizperioden nehmen P Monate der Heizstaffel ab.
    const plant = plants.find((p) => servesUnit(p, t.unit))
    if (!plant) return computePrepaymentCents(t, period)
    const way = wayOf(plant)
    const pp = computePrepaymentCents(t, period, { ownerOf: (m) => separateOwner(way, objectRules, m)?.key ?? null })
    // Sichtprüfung E42: Die Heizvorauszahlungen von Monaten, die einer getrennt abgerechneten
    // Heizperiode gehören, stehen hier nicht. Ohne Satz las der Mieter „davon Heizvorauszahlung
    // 0,00 €“ und fragte, wo sie geblieben ist.
    const schedule: MonthlySchedule[] = Array.isArray(t.heatingPrepayments) ? t.heatingPrepayments : []
    const byOwner = new Map<string, { label: string, months: string[] }>()
    // Dieselbe Quelle wie die Anrechnung dort (`heatingPrepaymentCents`): ein Monat zählt, wenn die
    // Staffel etwas verlangt oder eine Heizkorrektur der Heizperiode ihn abdeckt (Durchsicht N1).
    const overrides = (t.heatingPrepaymentOverrides ?? []).filter((o) => o.plantId === plant.id)
    for (const m of periodMonths(period)) {
      if (t.start > `${m}-01` || (t.end && t.end < `${m}-01`)) continue
      const owner = separateOwner(way, objectRules, m)
      if (owner === null) continue
      const override = overrides.find((o) => o.period === owner.key)
      const covered = override !== undefined && (!override.provisional || (override.fromMonth !== null && override.toMonth !== null && m >= override.fromMonth && m <= override.toMonth))
      if (rateAtMonth(schedule, m) === 0 && !covered) continue
      const entry = byOwner.get(owner.key) ?? { label: periodLabel(owner), months: [] }
      entry.months.push(m)
      byOwner.set(owner.key, entry)
    }
    const note = [...byOwner.values()].map((e) => `Ihre Heizkostenvorauszahlungen ${monthSpanText(e.months)} sind hier nicht angerechnet; sie werden in der Heizkostenabrechnung ${e.label} abgerechnet.`).join(' ')
    return note ? { ...pp, note } : pp
  }
  const statements = new Map<string, Statement>()
  for (const t of partTenancies) {
    const from = new Date(Math.max(toUTC(t.start), toUTC(yFrom)))
    const to = t.end ? new Date(Math.min(toUTC(t.end), toUTC(yTo))) : new Date(toUTC(yTo))
    const pp = prepaymentOf(t)
    statements.set(t.id, {
      tenancyId: t.id,
      tenantName: t.tenantName,
      unitId: t.unitId,
      unitName: t.unit.name,
      persons: personsAt(t, to.toISOString().slice(0, 10)),
      personDays: personDaysInPeriod(t, yFrom, yTo),
      days: t.days,
      periodStart: from.toISOString().slice(0, 10),
      periodEnd: to.toISOString().slice(0, 10),
      rows: [],
      totalShareCents: 0,
      total35aCents: 0,
      prepaymentCents: pp.cents,
      prepaymentOverridden: pp.overridden,
      ...(pp.heatingCents !== undefined ? { heatingPrepaymentCents: pp.heatingCents } : {}),
      ...(pp.note ? { prepaymentNote: pp.note } : {}),
      ...(scope === 'heating' ? { scope: 'heating' as const } : {}),
      suggestedMonthlyCents: 0,
      balanceCents: 0,
    })
  }

  // **Überschneidende Mietverhältnisse einer Wohnung (#204).** Beide werden wie erfasst gerechnet,
  // jedes mit seinem vollen Tagesanteil; für die gemeinsamen Tage wird die Wohnung also doppelt
  // berechnet. Gemeldet wird jede Überschneidung, die das Abrechnungsjahr berührt, mit dem
  // Mehrbetrag je Lesart (`extra`: ohne die Tage des ersten, ohne die des zweiten; exakt in Cent,
  // gerundet erst für den Text), den die Verteilung unten je Position aufsummiert (`overlapExtra`).
  // Getrennt nach Kosten (`cost`, was zu viel getragen wird) und Gutschriften (`credit`, was zu viel
  // gutgeschrieben wird, als Betrag ohne Vorzeichen). Es ist die Summe der Überzahlungen je
  // Position, kein Nettobetrag: Daneben kann eine Position stehen, bei der die Mieter zu wenig
  // tragen (Integrationsdurchsicht), und eine Gutschrift gleicht keine Kosten aus.
  // Gemeldet und beziffert wird je Paar. Überschneiden sich drei Mietverhältnisse an denselben
  // Tagen, erscheinen drei Paare, und ihre Mehrbeträge können sich teilweise doppelt zählen: Jedes
  // Paar rechnet für sich, als gäbe es das dritte nicht. Der Fall ist selten und jedes Paar für
  // sich ein Fehler; der Betrag je Meldung stimmt für dieses Paar.
  const overlaps = tenancyOverlaps(tenancies).flatMap((o) => {
    const inYear = commonPeriod({ start: o.from, end: o.to }, { start: yFrom, end: yTo })
    // Das Ende ist nie offen, weil das Jahr eines hat; `?? yTo` sagt das nur dem Übersetzer.
    return inYear ? [{ ...o, inYear: { from: inYear.from, to: inYear.to ?? yTo }, extra: { first: { cost: 0, credit: 0 }, second: { cost: 0, credit: 0 } } }] : []
  })
  // Was eine Position der Wohnung für die doppelt belegten Tage zu viel berechnet. „Zu viel“ heißt:
  // gegenüber derselben Verteilung ohne die Überschneidungstage eines der beiden Mietverhältnisse.
  // Welches Datum falsch ist, weiß nur der Vermieter; beide Lesarten werden gerechnet und beide
  // genannt (Durchsicht V1/V2), denn sie können verschieden sein, und eine kann 0 sein, wenn das
  // Mietverhältnis die Kosten gar nicht trägt (Pauschale). Gerechnet wird mit den exakten Anteilen der
  // Zeilen (`raw`), nur was einem Mieter wirklich zugebucht wird, zählt:
  // - Bei allen Schlüsseln, deren Verteilbasis nicht von den Mietverhältnissen abhängt (Fläche,
  //   Einheiten, Direktzuordnung, vereinbarte Anteile, Gemeinschaft, Verbrauch), wäre ohne die Tage
  //   nur dieser eine Anteil kleiner: um den Teil, der auf die Überschneidung entfällt, nach Tagen
  //   oder beim Verbrauch nach dem in dieser Zeit gemessenen Verbrauch.
  // - Beim Personenschlüssel stecken die Personentage auch in der Verteilbasis; ohne sie würde neu
  //   geteilt. Der Unterschied ist der Anteil der Wohnung vorher (S/P) gegen nachher
  //   ((S − o)/(P − o)), mit S den zugebuchten Personentagen der Wohnung, P der Verteilbasis und o
  //   den Personentagen des einen Mietverhältnisses in der Überschneidung.
  // - Einzelbeträge teilt der Messdienst selbst auf; dort entsteht nichts doppelt.
  // Ein Betrag gegen die Richtung der Position (wenn ohne die Tage die Mieter mehr trügen, etwa beim
  // Personenschlüssel neben einer Pauschale) wird zu null: Zu viel tragen sie dann nicht. Bei einer
  // Gutschrift ist der Betrag negativ, die Mieter bekommen dann zu viel gutgeschrieben.
  type OverlapPeriod = (typeof overlaps)[number]
  const overlapExtra = (
    item: SnapshotCostItem, b: { basisPersonDays: number }, targets: Target[], booked: boolean[], o: OverlapPeriod,
  ): { first: number, second: number } => {
    if (item.key === 'amounts' || targets.length === 0) return { first: 0, second: 0 }
    const { from, to } = o.inYear
    const reading = (t: TenancyWithUnit): number => {
      const i = targets.findIndex((x) => x.t.id === t.id)
      const x = targets[i]
      if (!x) return 0
      if (item.key === 'persons') {
        const p = b.basisPersonDays
        const doubled = personDaysInPeriod(t, from, to)
        if (!(doubled > 0) || !(p - doubled > 0)) return 0
        const s = targets.reduce((a, y, k) => a + (booked[k] && y.t.unitId === t.unitId ? personDaysInPeriod(y.t, yFrom, yTo) : 0), 0)
        return item.amountCents * (s / p - (s - (booked[i] ? doubled : 0)) / (p - doubled))
      }
      if (!booked[i]) return 0
      if (item.key === 'meter') {
        const meters = allMeters.filter((m) => m.unitId === t.unitId && m.type === item.meterType)
        const pFrom = t.start > yFrom ? t.start : yFrom
        const pTo = t.end && t.end < yTo ? t.end : yTo
        const all = meters.reduce((a, m) => a + consumptionInPeriod(readingsOf(m.id), pFrom, pTo), 0)
        const part = meters.reduce((a, m) => a + consumptionInPeriod(readingsOf(m.id), from, to), 0)
        return all > 0 ? x.raw * Math.min(1, Math.max(0, part / all)) : 0
      }
      return t.days > 0 ? x.raw * (rangeOverlapDays(from, to, from, to) / t.days) : 0
    }
    const sign = item.amountCents < 0 ? -1 : 1
    const towards = (v: number) => sign * Math.max(0, v * sign)
    return { first: towards(reading(o.first)), second: towards(reading(o.second)) }
  }
  const landlordRows: SettlementRow[] = []
  // Der Filter ist bewusst doppelt: `snapshotFromDb` grenzt bereits nach Jahr ein. Er bleibt,
  // weil er das Einzige ist, was eine falsch eingegrenzte Ablage noch auffängt. Ohne ihn
  // rechnete ein Repository, das zu viel liefert, die Kosten mehrerer Jahre in eine Abrechnung,
  // und das fiele niemandem auf, weil jede Zeile für sich stimmig aussieht. Nicht entfernen.
  const items = snapshot.costItems.filter((c) => c.period === period.key)
  // CO₂ beim Messdienst (Heizung PR 6): je Anlage und Heizperiode der Topf, und beim Vorwegabzug die
  // Zerlegung des Vermieterrests in der Position, in der L steckt. Vor der Verteilung, denn
  // `landlordRecipients` braucht sie.
  // ---------- Brennstofflieferungen (Heizung PR 7, #97; Entwurf 3.2, 3.3, 5.4, 8.2) ----------
  // Je Anlage, deren Heizperiode der Zeitraum dieser Berechnung ist (in P die Anlagen ohne eigene
  // Heizperiode, in einer Teil- oder Heizkostenabrechnung die eine Anlage): welcher Teil jeder
  // Versorgerrechnung hierher gehört und was deshalb herein- oder hinausgebucht wird. Bei freien
  // Schlüsseln bleiben die Rechnungen Positionen in voller Höhe in der Heizperiode, in der sie enden;
  // der Teil einer anderen Heizperiode steht als Zeile „Anteil … aus der Rechnung …“ (+) bzw. „Anteil
  // für …“ (−) bei den Mietern, mit dem Schlüssel der Position verteilt, und als Gegenzeile beim
  // Vermieter (`fuelCarry`, `fuelClosedPeriod`, `fuelEstimateDiff`). Über die Zeiträume hinweg ist so
  // jede Rechnung genau einmal verteilt (12.3 Nr. 1, 5). Beim Messdienst gibt es keine Überträge: Für
  // Kosten und C gilt, was er berechnet hat (G-A3); bewertet wird nur der Ausstoß. Die
  // Gradtagstabelle wird nur gefragt, wenn eine Anlage Lieferungen hat, sonst stünde sie im
  // Rechtsstand jeder Abrechnung.
  // Kesseltausch (Heizung PR 9): Eine Anlage zählt nur in Heizperioden, die ihre Betriebszeit berühren;
  // gerechnet wird sie über die Tage, an denen sie heizt, sonst fehlte der neuen Anlage die Zeit vor dem
  // Tausch als Lücke.
  const spanOfPlant = (p: SnapshotHeatingPlant) => plantSpan(p, plants)
  const activeIn = (p: SnapshotHeatingPlant): boolean => {
    const span = spanOfPlant(p)
    return (span.to === null || span.to >= period.from) && (span.from === null || span.from <= period.to)
  }
  // Eine Anlage, die in diesem Zeitraum nicht mehr heizt, zählt trotzdem, wenn eine Position dieses Zeitraums
  // mit einer ihrer Lieferungen verknüpft ist (Nachprüfung von #238): die Gasrechnung bis zum Tausch, die erst
  // im Folgejahr gebucht wird. Ihr Betrag gehört in den Zeitraum der Lieferung; ohne Abgrenzung trügen die
  // Mieter ihn zweimal, dort als Anteil aus der Rechnung und hier in voller Höhe.
  const linkedHere = (p: SnapshotHeatingPlant): boolean => {
    const ids = new Set((snapshot.fuel?.deliveries ?? []).filter((d) => d.plantId === p.id).map((d) => d.id))
    return items.some((c) => c.fuelDeliveryId != null && ids.has(c.fuelDeliveryId))
  }
  const fuelPlants: SnapshotHeatingPlant[] = (scope === 'all'
    ? plants.filter((p) => (p.periodStartMonth ?? null) === null)
    : snapshot.scope ? [snapshot.scope.plant] : []).filter((p) => activeIn(p) || linkedHere(p))
  const fuelResults = new Map<string, { plant: SnapshotHeatingPlant; result: FuelResult }>()
  const fuelSynthetic: SnapshotCostItem[] = []
  const fuelCarryOf = new Map<string, { carry: FuelCarry | null; step: CalcStep; itemId: string }>()
  const fuelCounterRows: SettlementRow[] = []
  const FUEL_METHOD_TEXT: Record<FuelMethod, string> = {
    entered: 'eingetragener Anteil', measured: 'nach Zählerstand', inside: 'ganz in der Heizperiode', parts: 'nach Teilmengen laut Rechnung',
    localDegreeDays: 'nach den Gradtagzahlen des Orts', degreeDays: 'nach der Gradtagszahlentabelle',
  }
  const fuel = snapshot.fuel
  if (fuel) {
    for (const plant of fuelPlants) {
      // Heizöl, Flüssiggas, Pellets, Holz und Kohle rechnen über den Vorrat (Heizung PR 8, unten).
      if (isStockEnergy(plant.energy)) continue
      const deliveries = fuel.deliveries.filter((d) => d.plantId === plant.id)
      if (deliveries.length === 0) continue
      const deliveryIds = new Set(deliveries.map((d) => d.id))
      const supply = snapshot.meters.filter((m) => m.heatingPlantId === plant.id && m.heatingRole === 'supply')
      const supplyMeter = supply.length === 1 ? supply[0] : undefined
      const result = plantFuel({
        method: plant.method,
        h: (() => {
          const span = spanOfPlant(plant)
          const from = span.from !== null && span.from > period.from ? span.from : period.from
          const to = span.to !== null && span.to < period.to ? span.to : period.to
          return from === period.from && to === period.to ? period : { ...period, from, to }
        })(),
        rules: plantRules(wayOf(plant), objectRules),
        deliveries,
        items: fuel.items.filter((c) => c.fuelDeliveryId != null && deliveryIds.has(c.fuelDeliveryId)),
        frozen: fuel.frozen.filter((f) => f.plantId === plant.id),
        closed: new Set(fuel.closed.filter((c) => c.plantId === plant.id).map((c) => c.period)),
        closedCarries: fuel.closed.filter((c) => c.plantId === plant.id).flatMap((c) => (c.carries ?? []).map((x) => ({ period: c.period, ...x }))),
        ctx: {
          table: law(hkvDegreeDays, { period: lawPeriod }, lawLog),
          local: new Map(fuel.degreeDays.map((v) => [v.month, v.value])),
          readings: supplyMeter ? snapshot.readings.filter((r) => r.meterId === supplyMeter.id) : null,
        },
        // Heizpositionen der Anlage ohne Lieferung decken mit ihrem Leistungszeitraum ab (Durchsicht I4).
        loose: items
          .filter((c) => c.category === HEATING_CATEGORY && !c.fuelDeliveryId && c.amountCents !== 0 && (c.heatingPlantId === plant.id || !c.heatingPlantId))
          // Ohne Anlage gehört sie zur einzigen des Objekts; bei mehreren ist unklar, zu welcher, und
          // Mietfuchs schlägt keine Schätzung vor (Nachprüfung, M-a).
          .map((c) => (c.heatingPlantId || plants.length === 1 ? { from: c.serviceFrom ?? null, to: c.serviceTo ?? null } : { from: null, to: null })),
      })
      if (!result) continue
      fuelResults.set(plant.id, { plant, result })
      for (const carry of result.carries) {
        const d = deliveries.find((x) => x.id === carry.deliveryId)
        const r = d ? rangeOf(d) : null
        const range = r ? formatDayRange(r.from, r.to) : ''
        // Mit der anderen Heizperiode: Eine Rechnung über drei Heizperioden hat zwei Überträge (Durchsicht M1).
        const carryKey = `fuel:${carry.deliveryId}:${period.key}:${carry.other.key}`
        // Der erste Schritt des Rechenwegs je Übertragszeile: woher der Betrag kommt.
        const step: CalcStep = carry.frozen
          ? { label: 'Anteil der Rechnung', value: `${fmtCents(Math.abs(carry.cents))}, eingefroren mit der Abrechnung ${periodLabel(carry.other)}`, term: 'accrualPrinciple' }
          : carry.kind === 'estimate'
            ? { label: 'Geschätzte Brennstoffkosten', value: `${fmtCents(carry.cents)} für ${range}, Nachberechnung vorbehalten`, term: 'accrualPrinciple' }
            : {
                label: 'Anteil der Rechnung',
                value: `${fmtCents(carry.totalCents)} × ${fmtNum(Math.round(carry.ratio * 100000) / 100)} ‰ (${FUEL_METHOD_TEXT[carry.method]}) = ${fmtCents(Math.abs(carry.cents))}`,
                term: carry.method === 'degreeDays' || carry.method === 'localDegreeDays' ? 'degreeDays' : 'accrualPrinciple',
              }
        // Eine Zeile je Position der Rechnung, mit ihrem Schlüssel; der Betrag einer Lieferung mit
        // Abschlag und Gutschrift verteilt sich im Verhältnis ihrer Beträge.
        const shares = distributeCents(carry.cents, carry.templates.map((t) => ({ key: t.itemId, landlord: false, raw: t.raw })))
        carry.templates.forEach((t, k) => {
          const template = fuel.items.find((c) => c.id === t.itemId)
          const cents = shares[k] ?? 0
          if (!template || cents === 0) return
          const { labor35aCents: _labor, serviceFrom: _from, serviceTo: _to, ...rest } = template
          const id = `${carryKey}:${t.itemId}`
          fuelSynthetic.push({
            ...rest,
            id,
            period: period.key,
            amountCents: cents,
            description: carry.kind === 'estimate'
              ? `Brennstoff ${range} (geschätzt)`
              : carry.kind === 'out'
                ? `${template.description}: Anteil für ${periodLabel(carry.other)} (voriger Zeitraum)`
                : `${template.description}: Anteil ${label} aus der Rechnung ${range} (Rechnung des nächsten Zeitraums)`,
          })
          fuelCarryOf.set(id, { carry, step, itemId: t.itemId })
        })
        fuelCounterRows.push({
          costItemId: carryKey,
          category: HEATING_CATEGORY,
          description: carry.kind === 'out' ? `Gegenbuchung: Anteil der Rechnung ${range} für ${periodLabel(carry.other)}` : `Gegenbuchung: Brennstoff ${range} aus einem anderen Zeitraum`,
          totalCents: -carry.cents,
          keyLabel: 'Abgrenzung der Brennstoffkosten',
          shareCents: -carry.cents,
          landlordParts: carry.landlord.filter((p) => p.cents !== 0),
        })
      }
    }
  }
  // ---------- Brennstoffvorrat (Heizung PR 8, #97, #99; Entwurf 8.2) ----------
  // Je Anlage mit Vorratsenergie die Bestandsrechnung der Heizperiode dieser Berechnung, bevor verteilt
  // wird: Bei freien Schlüsseln entstehen daraus die Übertragsposten, beim Messdienst ohne Aufteilung E
  // und C (Naht N1). Beim Messdienst mit Abzugszeile oder Ausweis führt der Messdienst den Bestand. Ob
  // die CO₂-Kosten einer Rechnung zählen (§ 11 Abs. 2 Satz 2 CO2KostAufG), fragt das Register;
  // `law()` protokolliert nur, wenn wirklich gerechnet wird, eine Anlage ohne Vorrat ändert
  // `legalBasis.values` also nicht.
  const stockCountedAt = (date: string): boolean => !law(co2CostsBefore, { date }, lawLog)
  const stockOfPlant = new Map<string, { plant: SnapshotHeatingPlant; result: StockResult; chain: StockPeriodInput[]; last: StockPeriodInput }>()
  for (const plant of fuelPlants) {
    if (!isStockEnergy(plant.energy)) continue
    const statement = (snapshot.co2Statements ?? []).find((x) => x.plantId === plant.id && x.period === period.key)
    // Heizung PR 10: auch bei der eigenen Heizkostenabrechnung (Entwurf 8.2).
    if (plant.method === 'service' && statement?.method !== 'selfAfterService') continue
    const chain = (snapshot.stockChains ?? []).find((c) => c.plantId === plant.id && c.period === period.key)?.chain ?? []
    const last = chain.at(-1)
    if (!last) continue
    // Ohne Angaben zum Vorrat keine Abfrage des Registers (Entwurf 1.2 Nr. 1).
    const touched = stockTouched(chain)
    const result = stockOf(chain, {
      needCost: plant.method !== 'service',
      needCo2: CO2_FUELS.includes(plant.energy),
      countedAt: touched ? stockCountedAt : () => true,
      excludedUntil: co2CostsExcludedUntil(),
      countedFrom: co2CostsCountedFrom(),
    })
    stockOfPlant.set(plant.id, { plant, result, chain, last })
  }
  // Übertragsposten bei freien Schlüsseln (Entwurf 8.2 „Wie das in die Abrechnung kommt“). Die
  // Rechnungen bleiben Positionen in voller Höhe, Steuer und Belegarchiv stimmen damit. Den Unterschied
  // zum Verbrauch tragen zwei Posten, „aus dem Vorrat“ (+ Wert des Anfangsbestands) und „im Vorrat“
  // (− Wert des Endbestands), verteilt mit dem Schlüssel der Brennstoffposition; ihre Gegenzeile beim
  // Vermieter (`fuelCarry`) gleicht die Summe aus. Sie sind keine Positionen: nicht in den
  // Gesamtkosten, nicht in der Steuerübersicht, nicht beim Hinweis auf doppelte Rechnungen.
  //
  // Der Schlüssel (Festlegung 5 des Plans): die Brennstoffposition dieser Heizperiode mit dem größten
  // Betrag, sonst die jüngste der Vorperiode; Einzelbeträge und „laut Gemeinschaftsabrechnung“ taugen
  // nicht, denn sie nennen feste Beträge. Ohne Schlüssel gilt „ohne Bestand“.
  const stockManualNotes: { plant: SnapshotHeatingPlant; text: string; invalid: boolean }[] = []
  // Weitere Hinweise zum Vorrat je Anlage (Durchsicht von #237): Verlust beim Vermieter (`lost`), ein
  // schon umgelegter Anfangsbestand (`settled`), Brennstoffpositionen ohne Lieferung (`unlinked`).
  const stockNotes: { plant: SnapshotHeatingPlant; code: 'fuel.stock-remaining' | 'fuel.stock-not-taken-over' | 'fuel.opening-settled' | 'fuel.opening-settled-assumed' | 'fuel.opening-check-loose' | 'fuel.opening-not-settled' | 'fuel.stock-unlinked'; text: string }[] = []
  const stockUnlinked = new Map<string, SnapshotCostItem[]>()
  const stockOpts = (plant: SnapshotHeatingPlant) => ({
    needCost: plant.method !== 'service', needCo2: CO2_FUELS.includes(plant.energy), countedAt: stockCountedAt,
    excludedUntil: co2CostsExcludedUntil(), countedFrom: co2CostsCountedFrom(),
  })
  // Heizung PR 10 (N14): Bei der eigenen Heizkostenabrechnung ist die Vorlage eine Brennstoffposition nach
  // Heizkostenverordnung; die Übertragsposten gehen mit den Gewichten ihres Ziels durch die Verordnung
  // (Entwurf 8.2). Den fehlenden Bestand meldet dort der Plan der Anlage (`fuel.stock-missing-self`).
  const stockWithoutTemplate = new Set<string>()
  for (const [plantId, entry] of stockOfPlant) {
    if (entry.plant.method === 'service') continue
    const ownSettlement = entry.plant.method === 'self'
    const mine = items.filter((c) => c.category === HEATING_CATEGORY && c.heatingPlantId === plantId)
    const template = stockTemplateOfLine(items, snapshot.previousCostItems ?? [], sameFuelLine(entry.plant, plants), HEATING_CATEGORY, stockKeysOf(entry.plant.method))
    const name = STOCK_FUEL_NAMES[entry.plant.energy] ?? 'Brennstoff'
    // Was die Vorperiode an diese weitergibt (eingefroren oder lebend), für den Hinweis auf einen
    // Bestand, den diese Heizperiode nicht übernimmt (I2).
    const prev = entry.chain.length > 1 ? entry.chain[entry.chain.length - 2] : undefined
    const prevResult = prev && !prev.frozenClosing ? stockOf(entry.chain.slice(0, -1), stockOpts(entry.plant)) : null
    const prevHandover = prev?.frozenClosing ?? (prevResult?.ok ? (prevResult.statement.handover ?? prevResult.statement.closing) : null)
    const prevValue = prevHandover?.costCents ?? 0
    const notTaken = (why: string) => {
      if (prev && prevValue > 0) {
        // Nach einem Kesseltausch im selben Zeitraum ist es der Restbestand der alten Anlage (Nachprüfung von #238).
        const text = prev.plantName !== undefined
          ? `Den Restbestand von „${prev.plantName}“ zum ${fmtDay(prev.to)} im Wert von ${fmtCents(prevValue)} übernimmt die neue Heizanlage nicht, weil ${why}. Die Mieter haben ihn bei „${prev.plantName}“ gutgeschrieben bekommen; bis er hier übernommen wird, tragen Sie ihn selbst.`
          : `Den Endbestand der Heizperiode ${prev.label} im Wert von ${fmtCents(prevValue)} übernimmt diese Heizperiode nicht, weil ${why}. Die Mieter der Heizperiode ${prev.label} haben ihn gutgeschrieben bekommen; bis er hier übernommen wird, tragen Sie ihn selbst.`
        stockNotes.push({ plant: entry.plant, code: 'fuel.stock-not-taken-over', text })
      }
    }
    // Brennstoffpositionen ohne Lieferung neben dem Vorrat (I2a): Die Bestandsrechnung kennt sie nicht.
    const unlinked = mine.filter((c) => c.heatingPart === 'fuel' && !c.fuelDeliveryId && c.amountCents !== 0)
    if (unlinked.length > 0 && stockTouched(entry.chain)) {
      stockUnlinked.set(plantId, unlinked)
      stockNotes.push({ plant: entry.plant, code: 'fuel.stock-unlinked', text: `${andList(unlinked.map((c) => `„${c.description}“`))} ${unlinked.length === 1 ? 'ist' : 'sind'} als Brennstoff gekennzeichnet, aber mit keiner Lieferung verknüpft. Die Bestandsrechnung kennt ${unlinked.length === 1 ? 'diese Rechnung' : 'diese Rechnungen'} nicht: Weder ${unlinked.length === 1 ? 'ihre Menge' : 'ihre Mengen'} noch ihr CO₂-Ausstoß zählen, und der Endbestand ist ohne sie bewertet. Verknüpfen Sie ${unlinked.length === 1 ? 'sie' : 'jede'} auf der Seite Heizkosten als Lieferung mit Lieferdatum und Menge.` })
    }
    if (!entry.result.ok) {
      if (!ownSettlement && (stockTouched(entry.chain) || mine.length > 0)) {
        stockManualNotes.push({ plant: entry.plant, text: problemText(entry.result.problem), invalid: entry.result.problem.kind === 'invalid' })
      }
      notTaken('die Bestandsrechnung hier fehlt oder nicht aufgeht')
      // Hat die abgeschlossene Folgeperiode den Endbestand übernommen, wird er hier immer als „im
      // Vorrat“ gutgeschrieben, auch wenn die Bestandsrechnung nicht aufgeht (C2): Sonst trügen ihn die
      // Mieter zweimal, hier in den Rechnungen und dort als „aus dem Vorrat“.
      const frozenNext = entry.last.nextFrozenOpening
      const cents = frozenNext ? (stockValueOf(frozenNext.layers).costCents ?? 0) : 0
      if (template && cents !== 0) {
        const { labor35aCents: _labor, serviceFrom: _from, serviceTo: _to, ...rest } = template
        const id = `stock:${plantId}:${period.key}:out`
        fuelSynthetic.push({ ...rest, id, period: period.key, description: `${name} im Vorrat`, amountCents: -cents, heatingPlantId: plantId, heatingPart: 'fuel', fuelDeliveryId: null })
        fuelCarryOf.set(id, { carry: null, step: { label: 'Im Vorrat', value: `Endbestand ${fmtCents(cents)}, wie ihn die abgeschlossene Folgeperiode übernommen hat`, term: 'fuelStock' }, itemId: template.id })
        fuelCounterRows.push({
          costItemId: `stock:${plantId}:${period.key}`, category: HEATING_CATEGORY, description: 'Gegenbuchung: Übertrag aus dem Brennstoffvorrat',
          totalCents: cents, keyLabel: 'Bestandsrechnung', shareCents: cents, landlordParts: [{ reason: 'fuelCarry', cents }],
        })
      }
      continue
    }
    const stmt = entry.result.statement
    const qty = `${fmtNum(stmt.opening.quantity)} ${STOCK_UNIT_TEXT[stmt.unit]}`
    const prevFuel = entry.last.previousFuel ?? null
    if (stmt.openingSettledCents !== undefined) {
      const v = stmt.openingSettledCents
      const worth = v !== null && v > 0 ? ` (Wert laut Eintrag ${fmtCents(v)})` : ''
      if (stmt.openingSettledSource === 'defaultLoose' && prevFuel) {
        // Nachprüfung von 7ce5958, Befund 1: Nur Positionen ohne Kennzeichen sprechen dafür; das kann
        // ebenso Wartung sein. Dann trüge der Vermieter den Wert still.
        const named = andList(prevFuel.loose.map((l) => `„${l.description}“ (${fmtCents(l.cents)})`))
        stockNotes.push({ plant: entry.plant, code: 'fuel.opening-settled-assumed', text: `Mietfuchs nimmt an, dass der Anfangsbestand von ${qty}${worth} schon mit der Abrechnung der Heizperiode ${prevFuel.label} umgelegt wurde, denn dort stehen Heizpositionen ohne Kennzeichen „Brennstoff“: ${named}. Er zählt hier deshalb mit 0 €. War darin kein Brennstoff, tragen Sie ${v !== null && v > 0 ? fmtCents(v) : 'seinen Wert'} selbst; antworten Sie dann in der Karte „Vorrat“ mit „Nein“, oder kennzeichnen Sie die Positionen bei den Kosten unter „Teil der Heizkosten“.` })
      }
      // Nachprüfung N2: Angabe des Vermieters oder Vorbelegung, und dann mit Grund.
      const why = stmt.openingSettledSource === 'default' && prevFuel
        ? `wurde nach der Vorbelegung schon mit einer früheren Abrechnung umgelegt, denn in der Heizperiode ${prevFuel.label} sind Heizkosten von ${fmtCents(prevFuel.cents)} nach Lieferung verteilt. Trifft das nicht zu, antworten Sie in der Karte „Vorrat“ mit „Nein“.`
        : 'ist nach Ihrer Angabe schon mit einer früheren Abrechnung umgelegt worden.'
      if (stmt.openingSettledSource !== 'defaultLoose') stockNotes.push({ plant: entry.plant, code: 'fuel.opening-settled', text: `Der Anfangsbestand von ${qty}${worth} ${why} Er zählt hier deshalb mit 0 € und ohne CO₂-Kosten; seine kg zählen für die Einstufung des Gebäudes.` })
    } else if (stmt.openingSource === 'own' && prevFuel && (stmt.opening.costCents ?? 0) > 0 && entry.last.ownOpening?.settledSource !== 'entered' &&
      settledByDefault(prevFuel, stmt.opening.costCents) === null && looseCentsOf(prevFuel) > 0) {
      // Nachprüfung von 819398e: Ohne Antwort und unter der Schwelle zählt der Anfangsbestand mit seinem
      // Wert; ob in den Positionen ohne Kennzeichen doch Brennstoff steckt, weiß nur der Vermieter.
      const named = andList(prevFuel.loose.map((l) => `„${l.description}“ (${fmtCents(l.cents)})`))
      stockNotes.push({ plant: entry.plant, code: 'fuel.opening-check-loose', text: `Der Anfangsbestand von ${qty} zählt mit ${fmtCents(stmt.opening.costCents ?? 0)}. In der Heizperiode ${prevFuel.label} stehen Heizkosten ohne Kennzeichnung über ${fmtCents(looseCentsOf(prevFuel))} (${named}). Prüfen Sie, ob Brennstoff darin war; dann wählen Sie in der Karte „Vorrat“ „Ja“.` })
    } else if (stmt.openingSource === 'own' && prevFuel && (stmt.opening.costCents ?? 0) > 0 && settledByDefault(prevFuel, stmt.opening.costCents) !== null) {
      // Dieselbe Schwelle wie die Vorbelegung: Eine Wartung erklärt keinen Anfangsbestand (W1n).
      stockNotes.push({ plant: entry.plant, code: 'fuel.opening-not-settled', text: `Nach Ihrer Angabe ist der Anfangsbestand von ${qty} noch nicht umgelegt; er zählt mit ${fmtCents(stmt.opening.costCents ?? 0)}. In der Heizperiode ${prevFuel.label} sind aber Heizkosten von ${fmtCents(prevFuel.cents)} nach Lieferung verteilt. Steckt der Brennstoff des Anfangsbestands darin, tragen die Mieter ${fmtCents(stmt.opening.costCents ?? 0)} zweimal; antworten Sie dann in der Karte „Vorrat“ mit „Ja“.` })
    }
    // Nachprüfung N1: Die Vorperiode ist ohne Vorrat abgeschlossen; ihr Endbestand zählt hier mit 0 €.
    const prevChain = entry.chain.length > 1 ? entry.chain[entry.chain.length - 2] : undefined
    if (prevChain?.closedWithoutStock && !prevChain.frozenClosing && stmt.opening.quantity > 0) {
      stockNotes.push({ plant: entry.plant, code: 'fuel.opening-settled', text: `Der Anfangsbestand von ${qty} zählt mit 0 € und ohne CO₂-Kosten: Die Heizperiode ${prevChain.label} ist ohne Vorrat abgeschlossen, ihre Mieter haben den Brennstoff mit den Rechnungen bezahlt. Seine kg zählen für die Einstufung des Gebäudes.` })
    }
    if (!template && ownSettlement) {
      stockWithoutTemplate.add(plantId)
      notTaken('es hier keine Brennstoffposition nach Heizkostenverordnung gibt')
      continue
    }
    if (!template) {
      stockManualNotes.push({ plant: entry.plant, text: 'Für den Verbrauch aus dem Vorrat gibt es keinen Schlüssel: In dieser Heizperiode und der vorigen steht keine Brennstoffposition dieser Heizanlage, die nach einem Umlageschlüssel verteilt wird. Der Endbestand geht deshalb mit 0 € in die nächste Heizperiode, denn die Mieter haben ihn mit den Rechnungen schon bezahlt.', invalid: false })
      notTaken('es hier keinen Schlüssel für den Übertrag gibt')
      continue
    }
    const st = entry.result.statement
    const opening = st.opening.costCents ?? 0
    const closing = st.closing.costCents ?? 0
    const q = (n: number): string => `${n.toLocaleString('de-DE', { maximumFractionDigits: 2 })} ${STOCK_UNIT_TEXT[st.unit]}`
    const { labor35aCents: _labor, serviceFrom: _from, serviceTo: _to, ...rest } = template
    const make = (suffix: 'in' | 'out', description: string, cents: number, step: CalcStep): void => {
      const id = `stock:${plantId}:${period.key}:${suffix}`
      fuelSynthetic.push({ ...rest, id, period: period.key, description, amountCents: cents, heatingPlantId: plantId, heatingPart: 'fuel', fuelDeliveryId: null })
      fuelCarryOf.set(id, { carry: null, step, itemId: template.id })
    }
    if (opening !== 0) {
      make('in', `${name} aus dem Vorrat`, opening, {
        label: 'Aus dem Vorrat',
        value: `Anfangsbestand ${q(st.opening.quantity)}, ${fmtCents(opening)}${st.openingSource === 'frozen' ? ', eingefroren mit der Abrechnung der Vorperiode' : ''}`,
        term: 'fuelStock',
      })
    }
    if (closing !== 0) {
      make('out', `${name} im Vorrat`, -closing, {
        label: 'Im Vorrat',
        value: `Endbestand ${q(st.closing.quantity)}, ${fmtCents(closing)}, zu den Preisen der jüngsten Lieferungen bewertet${st.closingFrozen ? ', wie ihn die abgeschlossene Folgeperiode übernommen hat' : ''}`,
        term: 'fuelStock',
      })
    }
    // Die Folgeperiode ist ohne Vorrat abgeschlossen (I2): Den Endbestand, den diese Heizperiode
    // gutschreibt, übernimmt keine Abrechnung.
    if (entry.last.nextClosedWithoutStock && closing > 0) {
      stockNotes.push({ plant: entry.plant, code: 'fuel.stock-not-taken-over', text: `Der Endbestand im Wert von ${fmtCents(closing)} wird von keiner Abrechnung übernommen: Die Folgeperiode ist ohne Vorrat abgeschlossen. Bis Sie ihn dort nachtragen, tragen Sie ihn selbst; öffnen Sie dafür die Abrechnung der Folgeperiode wieder und tragen Sie den Vorrat ein.` })
    }
    const net = opening - closing
    // Kesseltausch (Heizung PR 9): Endet die Anlage in dieser Heizperiode, übernimmt keine Folgeperiode
    // den Endbestand. Er gehört dem Vermieter; die Mieter tragen nur den verbrauchten Brennstoff. Die
    // Gegenbuchung wird deshalb geteilt: der Anfangsbestand wie bisher, der Restbestand mit seinem Wert
    // als eigene Zeile beim Vermieter.
    // Heizt die Nachfolgerin mit demselben Brennstoff weiter, ist der Restbestand ihr Anfangsbestand
    // (snapshot.ts, `stockChainsOf`); dann gilt die gewöhnliche Gegenbuchung (Recht I1 der Durchsicht von #238).
    const retiredOn = entry.plant.endsOn ?? null
    // Ein eigener Anfangsbestand der Nachfolgerin in dieser Heizperiode beginnt ihre Kette neu; dann bleibt
    // der Restbestand wie bei einem anderen Brennstoff beim Vermieter.
    const carriedOn = plants.some((p) => {
      if (p.replacesPlantId !== plantId || p.energy !== entry.plant.energy || p.takesOverStock === false || retiredOn === null) return false
      // Die erste Heizperiode der neuen Anlage: dieselbe oder, bei einem Tausch zum Ersten, die folgende.
      const first = periodContaining(plantRules(wayOf(p), objectRules), dayAfter(retiredOn)).key
      return ((snapshot.heatingPeriodRows ?? []).find((r) => r.plantId === p.id && r.period === first)?.openingQuantity ?? null) === null
    })
    if (retiredOn !== null && retiredOn >= period.from && retiredOn <= period.to && closing !== 0 && !carriedOn) {
      if (opening !== 0) {
        fuelCounterRows.push({
          costItemId: `stock:${plantId}:${period.key}`, category: HEATING_CATEGORY, description: 'Gegenbuchung: Übertrag aus dem Brennstoffvorrat',
          totalCents: -opening, keyLabel: 'Bestandsrechnung', shareCents: -opening, landlordParts: [{ reason: 'fuelCarry', cents: -opening }],
        })
      }
      fuelCounterRows.push({
        costItemId: `stock:${plantId}:${period.key}:remaining`, category: HEATING_CATEGORY,
        description: `Restbestand ${q(st.closing.quantity)} nach Stilllegung der Heizanlage (gehört Ihnen)`,
        totalCents: closing, keyLabel: 'Bestandsrechnung', shareCents: closing, landlordParts: [{ reason: 'stockRemaining', cents: closing }],
      })
      const norm = mayAgreeOtherwise(snapshot.units, isDwelling) ? '§ 2 Nr. 4a BetrKV' : '§ 7 Abs. 2 HeizkostenV'
      const plantName = entry.plant.name ? `„${entry.plant.name}“` : 'ohne Namen'
      // Ein Tausch mit demselben Brennstoff, dessen neue Anlage ihn nach Angabe des Vermieters nicht weiter verheizt.
      const refused = plants.find((p) => p.replacesPlantId === plantId && p.energy === entry.plant.energy && p.takesOverStock === false)
      stockNotes.push({ plant: entry.plant, code: 'fuel.stock-remaining', text:
        `Die Heizanlage ${plantName} ist seit dem ${fmtDay(dayAfter(retiredOn))} außer Betrieb.${refused ? ` Nach Ihrer Angabe verheizt „${refused.name ?? ''}“ den Brennstoff im Tank nicht weiter.` : ''} Ihren Restbestand von ${q(st.closing.quantity)} im Wert von ${fmtCents(closing)} tragen die Mieter nicht, ` +
        `denn umzulegen sind nur die Kosten der verbrauchten Brennstoffe (${norm}). Der Restbestand gehört Ihnen und steht mit seinem Wert bei Ihrem Anteil. ` +
        'Verkaufen Sie ihn oder lassen Sie ihn abholen, betrifft das die Abrechnung der Mieter nicht.' })
    } else if (net !== 0) {
      fuelCounterRows.push({
        costItemId: `stock:${plantId}:${period.key}`,
        category: HEATING_CATEGORY,
        description: 'Gegenbuchung: Übertrag aus dem Brennstoffvorrat',
        totalCents: -net,
        keyLabel: 'Bestandsrechnung',
        shareCents: -net,
        landlordParts: [{ reason: 'fuelCarry', cents: -net }],
      })
    }
  }
  // Mehrere Heizanlagen (Heizung PR 9, Entwurf 9.3 F9): Je Anlage gibt es eine eigene Einstufung. Eine
  // Heizposition, deren Verteilbasis Wohnungen einer zweiten Anlage erreicht, gehört deshalb zu
  // keinem Topf: Sie mindert keinen Abzug und zählt in keiner Probe. Verteilt wird sie weiter nach
  // ihrem Schlüssel, an den Kosten ändert sich nichts. Mit einer Anlage gibt es das nicht.
  const spanning = new Map<string, { plantId: string; name: string; unitIds: string[] }[]>()
  if (plants.length > 1) {
    const unitOfTenancy = new Map(snapshot.tenancies.map((t) => [t.id, t.unitId]))
    const meterUnitIds = (type: string): string[] => snapshot.meters.flatMap((m) => (m.unitId && m.type === type ? [m.unitId] : []))
    const ctx = { basisUnitIds: basisUnits.map((u) => u.id), unitOfTenancy, meterUnitIds }
    const serving = plants.map((p) => ({
      id: p.id,
      name: p.name ?? '',
      serves: (unitId: string) => {
        const u = unitById.get(unitId)
        return u ? servesUnit(p, u) : false
      },
    }))
    for (const c of items) {
      if (c.category !== HEATING_CATEGORY || !c.heatingPlantId) continue
      // Nach Heizkostenverordnung verteilt eine Position nur über die Wohnungen ihrer Anlage (Heizung PR 10).
      if (c.key === 'heatingSystem') continue
      // Nach einem Kesseltausch versorgen alte und neue Anlage dieselben Wohnungen nacheinander, auch über
      // mehrere Täusche (Durchsicht von #238, C1); das ist keine zweite Anlage im Sinne von F9. Eine Anlage,
      // die in diesem Zeitraum nicht heizt, zählt ebenso wenig.
      const ownPlant = plants.find((p) => p.id === c.heatingPlantId)
      const others = spanningPlants(itemBasisUnits(c, ctx), c.heatingPlantId, serving.filter((p) => {
        const other = plants.find((x) => x.id === p.id)
        return !!other && activeIn(other) && (!ownPlant || !sameLine(ownPlant, other, plants))
      }))
      if (others.length > 0) spanning.set(c.id, others)
    }
  }
  // ---------- Eigene Heizkostenabrechnung (Heizung PR 10, Entwurf 6.1 Nr. 4.3, 8) ----------
  // Je Anlage mit `method = 'self'`, deren Heizperiode der Zeitraum dieser Berechnung ist (dieselben
  // Anlagen wie bei den Lieferungen, `fuelPlants`), der Plan: Nutzer, Ablesungen, Gruppen und Bruchteile
  // (heating.ts), Anteil nach Verbrauch, Warmwasseranteil und das Urteil zur Wärmepumpe. Daraus die
  // Gewichte, mit denen jede Position mit `heatingSystem` und jeder Übertrag der Anlage verteilt wird.
  // Was die Anlage nicht verteilbar macht, steht in `blocked`; dann gehen ihre Positionen an den
  // Vermieter (`noBasis`), und je Grund nennt ein Fehler, was zu tun ist (Abweichung 5).
  type SelfBlock = {
    code: 'heating.self-incomplete' | 'heating.dhw-share-invalid' | 'heating.heat-pump-dhw-basis' | 'fuel.stock-missing-self' | 'fuel.stock-invalid'
      | 'heating.mixed-capture' | 'heating.hca-factor-missing'
    text: string
  }
  type SelfPlantPlan = {
    plant: SnapshotHeatingPlant
    plan: SelfPlan
    shares: ConsumptionShares | null
    alpha: Alpha | null
    weights: Map<string, SelfWeights> | null
    blocked: SelfBlock[]
    verdict: HeatPumpVerdict | null
    hotWater: HotWater
    changeSplit: 'degreeDays' | 'time'
    hDays: number
    hDegree: number
    userByKey: Map<string, SelfUserPlan>
    input: SelfInput
    // § 11 Abs. 1 Nr. 3 Buchst. a a. F. (Heizung PR 11, Abweichung 9): Wärmepumpe ohne weiteren Erzeuger in
    // einem Zeitraum, der vor dem 01.10.2024 beginnt. Dann keine Kürzungsbeträge und kein Fehler zu α.
    oldHeatPumpExemption: boolean
    // Ohne Antwort zur Überwiegend-Frage gerechnet wie „ja“ (Festlegung; Nachprüfung von #240, W2).
    majorityOpen: boolean
    // Ist der unzumutbare Aufwand für den Wärmezähler bestätigt (§ 9 Abs. 2 Satz 2, Heizung PR 11)?
    dhwUnmeasurable: boolean | null
    // Heizung PR 12: die Erfassung dieser Heizperiode, je Heizkostenverteiler die Einheiten und die Werte
    // des Ablesedienstes (für den Ausweis).
    capture: CaptureMethod
    devices: HcaDeviceLine[]
    serviceValues: HeatingServiceValue[]
  }
  const POT_NAME: Record<SelfPot, string> = { heating: 'Heizung', water: 'Warmwasser' }
  // Die Einheit des Verbrauchs eines Topfs (Heizung PR 12, Abweichung 9): Heizkostenverteiler und Ablesedienst
  // zählen Einheiten, keine Kilowattstunden.
  const potUnitOf = (sp: Pick<SelfPlantPlan, 'capture' | 'serviceValues'>, p: SelfPot): 'kWh' | 'm³' | 'Einheiten' =>
    p === 'water' ? 'm³' : sp.capture === 'heatMeter' ? 'kWh' : sp.capture === 'serviceValues' ? serviceHeatUnit(sp.serviceValues) : 'Einheiten'
  const selfProblemText = (p: SelfProblem, areaBasisHeat: string, capture: CaptureMethod = 'heatMeter'): string => {
    if (p.kind === 'farInterim') {
      return `Beim Wechsel in ${p.unitName} zum ${fmtDay(p.boundary)} wurde erst am ${fmtDay(p.readingDate)} abgelesen, ${p.days} Tage daneben und über einen Wintermonat. Lässt die Ablesung wegen des Zeitpunkts keine hinreichend genaue Ermittlung zu, wird nach Gradtagen bzw. Tagen geteilt (§ 9b Abs. 3 HeizkostenV). Ob das so ist, entscheiden Sie: Wählen Sie auf der Seite Heizkosten „Ablesung verwenden“ oder „Nach § 9b Abs. 3“.`
    }
    if (p.kind === 'noArea') {
      return `Für den Topf ${POT_NAME[p.pot]} ist keine Fläche hinterlegt, und die Grundkosten lassen sich nicht verteilen. Tragen Sie die Wohnfläche${p.pot === 'heating' && areaBasisHeat === 'heatedArea' ? ' bzw. die beheizte Fläche' : ''} der Wohnungen ein.`
    }
    const meter = p.meterName ? `„${p.meterName}“ (${p.unitName})` : p.unitName
    if (p.reason === 'noMeter') {
      if (capture === 'serviceValues' && p.pot === 'heating') {
        return `Für ${p.unitName} fehlen die Werte des Ablesedienstes, die übrigen Wohnungen haben welche. Tragen Sie sie auf der Seite Heizkosten in der Karte „Werte des Ablesedienstes“ ein.`
      }
      if (capture === 'hca' && p.pot === 'heating') return `${p.unitName} hat keinen Heizkostenverteiler, die übrigen Wohnungen schon. Legen Sie die Geräte mit Skala und Bewertungsfaktor an und tragen Sie die Stände ein.`
      return `${p.unitName} hat keinen ${p.pot === 'heating' ? 'Wärmezähler' : 'Warmwasserzähler'}, die übrigen Wohnungen schon. Legen Sie den Zähler an und tragen Sie die Stände ein.`
    }
    if (p.reason === 'noReading') return `Für ${meter} fehlt ein Stand zum ${fmtDay(p.boundary ?? yTo)}. Tragen Sie die Ablesung ein; liegt sie einige Tage daneben, gilt sie, wie sie ist.`
    if (p.reason === 'replacement') return `Beim Zähler ${meter} fehlt zu einem Zählerwechsel der Endstand des alten Geräts. Tragen Sie ihn nach.`
    if (p.reason === 'sameDay') return `Für ${meter} stehen am ${fmtDay(p.boundary ?? yTo)} zwei verschiedene Stände. Welcher stimmt, wissen nur Sie; löschen oder berichtigen Sie den falschen auf der Seite Zähler.`
    return `Der Zähler ${meter} zeigt bis zum ${fmtDay(p.boundary ?? yTo)} weniger als vorher. Prüfen Sie die Stände oder markieren Sie einen Zählerwechsel.`
  }
  const selfPlans = new Map<string, SelfPlantPlan>()
  for (const plant of fuelPlants.filter((p) => p.method === 'self')) {
    const rules = plantRules(wayOf(plant), objectRules)
    const prev = previousPeriod(rules, period)
    const next = periodContaining(rules, dayAfter(period.to))
    // Die Warmwasserbereitung dieser Heizperiode (Durchsicht von #241, I2).
    const hotWater: HotWater = hotWaterOf(plant, String(period.key))
    // Heizung PR 12: Die Heizung erfasst je nach Erfassung dieser Heizperiode der Typ `waerme` oder `hkv`; Werte
    // eines Ablesedienstes ersetzen die Zähler der Wohnungen (beim Warmwasser nur, wenn er es liefert).
    const capture: CaptureMethod = captureOf(plant, String(period.key))
    const potTypes: MeterType[] = [capture === 'hca' ? 'hkv' : 'waerme', ...(hotWater === 'none' ? [] : ['warmwasser' as const])]
    const unitMeters = snapshot.meters.flatMap((m) => (m.unitId !== null && (m.heatingPlantId ?? null) === null && potTypes.includes(m.type) ? [{ ...m, unitId: m.unitId }] : []))
    // `period.key` ist der Schlüssel der Heizperiode dieser Rechnung, derselbe wie `heating_periods.period` der Zeilen.
    const serviceRows = capture === 'serviceValues' ? lineServiceRows(snapshot.heatingServiceValues ?? [], snapshot.heatingPlants ?? [], plant.id, String(period.key)) : []
    const served = snapshot.units.filter((u) => servesUnit(plant, u) && ((u.areaM2 || 0) > 0 || unitMeters.some((m) => m.unitId === u.id)))
    const servedIds = new Set(served.map((u) => u.id))
    const svcHeat = capture === 'serviceValues' ? serviceMeters(serviceRows, served, 'heat') : null
    const svcWater = capture === 'serviceValues' && hotWater !== 'none' ? serviceMeters(serviceRows, served, 'water') : null
    const table = law(hkvDegreeDays, { period: lawPeriod }, lawLog)
    const neighbors = { before: dayBefore(prev.from), after: next.to }
    // Abweichung 9: die Wechselgrenzen der Nachbarperioden und der eingefrorene Endstand der vorigen.
    const selfUnits: SelfUnit[] = served.map((u) => ({
      id: u.id, name: u.name, areaM2: u.areaM2 || 0,
      heatedAreaM2: plant.units?.find((x) => x.unitId === u.id)?.heatedAreaM2 ?? null,
      role: u.participates ? 'rented' : u.selfUsed ? 'self' : 'outside',
    }))
    const selfTenancies: SelfTenancy[] = snapshot.tenancies.filter((t) => servedIds.has(t.unitId)).map((t) => ({ id: t.id, unitId: t.unitId, tenantName: t.tenantName, start: t.start, end: t.end }))
    const changesIn = (unit: SelfUnit, hh: { from: string; to: string }): string[] => usersOf(unit, selfTenancies, hh).slice(0, -1).map((u) => u.to)
    const outerChanges = new Map(selfUnits.map((u) => [u.id, [...changesIn(u, prev), ...changesIn(u, next)]]))
    // Die gedachten Zähler eines Ablesedienstes (Heizung PR 12) zählen in jeder Heizperiode von 0 an, denn ihre
    // Zeilen gehören zu genau dieser Heizperiode; ein eingefrorener Endstand der vorigen gilt für sie nicht.
    const opening = new Map((snapshot.selfClosedEnds ?? [])
      .filter((e) => e.plantId === plant.id && e.boundary === dayBefore(period.from) && !isServiceMeter(e.meterId))
      .map((e): [string, SelfReading] => [e.meterId, { meterId: e.meterId, date: e.date, value: e.value }]))
    const input: SelfInput = {
      h: { from: period.from, to: period.to },
      neighbors,
      outerChanges,
      opening,
      changeSplit: plant.changeSplit ?? 'degreeDays',
      hotWater,
      areaBasisHeat: plant.areaBasisHeat ?? 'area',
      units: selfUnits,
      tenancies: selfTenancies,
      meters: [
        ...unitMeters
          .filter((m) => servedIds.has(m.unitId) && !(svcHeat && m.type === 'waerme') && !(svcWater && m.type === 'warmwasser'))
          .map((m) => ({ id: m.id, name: m.name ?? m.id, unitId: m.unitId, type: m.type, factor: meterFactor(m) })),
        ...(svcHeat?.meters ?? []),
        ...(svcWater?.meters ?? []),
      ],
      readings: [
        ...snapshot.readings.map((r) => ({ ...r, boundFor: r.interimFor ?? null })),
        ...(svcHeat?.readings ?? []),
        ...(svcWater?.readings ?? []),
      ],
      capture,
      gaps: snapshot.interimGaps ?? [],
      table,
      offRule: () => law(practiceReadingOffWarning, { period: lawPeriod }, lawLog),
    }
    const plan = planSelf(input)
    const rows = (snapshot.heatingPeriodRows ?? []).filter((r) => r.plantId === plant.id)
    // Der Anteil gehört zur Linie (Durchsicht von #239, I3): Nach einem Kesseltausch gilt der der alten
    // Anlage weiter, ebenso ihr Verfahren für den Warmwasseranteil.
    const allPlants = snapshot.heatingPlants ?? []
    const lineIds = new Set([plant.id, ...allPlants.filter((p) => lineRoot(p, allPlants) === lineRoot(plant, allPlants)).map((p) => p.id)])
    const shares = consumptionSharesOf(
      lineShareRows((snapshot.heatingPeriodRows ?? []).map((r) => ({ plantId: r.plantId, period: String(r.period), heatConsumptionPct: r.heatConsumptionPct ?? null, waterConsumptionPct: r.waterConsumptionPct ?? null, insulationRule: r.insulationRule ?? null })), allPlants, plant.id),
      period.key, plant.energy, () => law(hkvConsumptionShareForced, { period: lawPeriod }, lawLog),
    )
    const own = rows.find((r) => r.period === period.key)
    const lineOwn = (snapshot.heatingPeriodRows ?? []).find((r) => r.plantId !== plant.id && lineIds.has(r.plantId) && r.period === period.key && r.dhwMethod !== null)
    // Läuft die Anlage nur einen Teil der Heizperiode (Kesseltausch), gilt die Wärme am Speicher nur
    // für ihre Laufzeit (I3); dafür braucht es den Stand am Tag des Tauschs. Die Zähler der Anlage
    // gehören zur Linie, denn der Speicher bleibt, wenn der Kessel getauscht wird.
    const predecessor = plant.replacesPlantId ? allPlants.find((p) => p.id === plant.replacesPlantId) : undefined
    const startsOn = predecessor?.endsOn ? dayAfter(predecessor.endsOn) : null
    const swapStart = startsOn !== null && startsOn > period.from && startsOn <= period.to ? dayBefore(startsOn) : null
    const swapEnd = plant.endsOn && plant.endsOn >= period.from && plant.endsOn < period.to ? plant.endsOn : null
    let swapMissing: string | null = null
    // Gemessene Wärme am Zähler der Anlage mit dieser Rolle über die Heizperiode (Abweichung 12).
    const plantMeterKwh = (role: 'dhwHeat' | 'totalHeat'): number | null => {
      const ms = snapshot.meters.filter((m) => m.heatingPlantId !== null && m.heatingPlantId !== undefined && lineIds.has(m.heatingPlantId) && m.heatingRole === role)
      if (ms.length === 0) return null
      let sum = 0
      for (const m of ms) {
        const sorted = sortReadings(snapshot.readings.filter((r) => r.meterId === m.id))
        const at = boundaryReadingsOf(sorted, [dayBefore(period.from), period.to], [neighbors.before, dayBefore(period.from), period.to, neighbors.after])
        const exact = (day: string) => sorted.find((r) => r.date === day) ?? null
        const a = swapStart !== null ? exact(swapStart) : (at.get(dayBefore(period.from)) ?? null)
        const b = swapEnd !== null ? exact(swapEnd) : (at.get(period.to) ?? null)
        if (swapStart !== null && a === null) swapMissing = swapStart
        if (swapEnd !== null && b === null) swapMissing = swapEnd
        if (a === null || b === null) return null
        const v = measuredBetween(sorted, a, b)
        if ('problem' in v) return null
        sum += v.value
      }
      return sum
    }
    const fuelOfPlant = fuelResults.get(plant.id)?.result
    // Heizung PR 11: der Warmwasseranteil nach allen drei Verfahren des § 9 Abs. 2 (dhw.ts). Beim Vorrat
    // (PR 8) zählt die verbrauchte Menge, sonst die Bewertung der Rechnungen (PR 7) mit ihren kWh in der
    // Heizperiode. Das Volumen gehört zur Anlage selbst, denn bei einem Kesseltausch zählt nur das ihrer
    // Laufzeit; Verfahren und Temperatur gelten wie in PR 10 für die Linie, der Speicher bleibt.
    const stockOfThis = stockOfPlant.get(plant.id)?.result
    // Kesseltausch mit übernommenem Vorrat (Durchsicht von #240, Geld-I3): Der Brennstoff im Tank stammt aus
    // Lieferungen der Vorgängerin(nen) gleicher Energie; ihr Heizwert gilt für ihn mit.
    const stockLine = new Set<string>([plant.id])
    for (let cur: SnapshotHeatingPlant | undefined = plant; cur?.takesOverStock === true && cur.replacesPlantId;) {
      const prev: SnapshotHeatingPlant | undefined = allPlants.find((x) => x.id === cur?.replacesPlantId)
      if (!prev || prev.energy !== plant.energy || stockLine.has(prev.id)) break
      stockLine.add(prev.id)
      cur = prev
    }
    const running = swapStart !== null || swapEnd !== null
      ? { from: swapStart !== null ? dayAfter(swapStart) : period.from, to: swapEnd ?? period.to }
      : null
    const alphaResult = hotWaterShareOf({
      hotWater,
      log: lawLog,
      plant: { energy: plant.energy, heatGeneration: plant.heatGeneration ?? null },
      row: own || lineOwn
        ? { dhwMethod: own?.dhwMethod ?? lineOwn?.dhwMethod ?? null, dhwVolumeM3: own?.dhwVolumeM3 ?? null, dhwTempC: own?.dhwTempC ?? lineOwn?.dhwTempC ?? null }
        : null,
      h: { from: period.from, to: period.to },
      running,
      fuelLines: (fuelOfPlant?.lines ?? []).map((l) => ({ deliveryId: l.deliveryId, sharePermille: l.sharePermille, energyKwh: l.energyKwh })),
      stock: stockOfThis?.ok ? { unit: stockOfThis.statement.unit, consumedQuantity: stockOfThis.statement.consumed.quantity } : null,
      deliveries: (snapshot.fuel?.deliveries ?? []).filter((d) => stockLine.has(d.plantId)).map((d) => ({
        id: d.id, label: d.label, invoiceTo: d.invoiceTo, deliveredAt: d.deliveredAt, invoiceDate: d.invoiceDate ?? null, energyKwh: d.energyKwh ?? null,
        quantity: d.quantity ?? null, quantityUnit: d.quantityUnit ?? null, gasBasis: d.gasBasis ?? null, heatingValue: d.heatingValue ?? null, fuelGrade: d.fuelGrade ?? null, parts: d.parts,
      })),
      units: served,
      measured: { dhwKwh: own?.dhwHeatKwh ?? plantMeterKwh('dhwHeat'), totalKwh: own?.totalHeatKwh ?? plantMeterKwh('totalHeat') },
      fuelCoveragePermille: fuelOfPlant?.coveragePermille ?? null,
      // Die Schätzung beim Abschluss (PR 7) trägt bei der Lieferung `estimated` (PR 10 Abweichung 11).
      fuelEstimated: fuelOfPlant?.lines.some((l) => l.estimated) ?? false,
    })
    // § 11 Abs. 1 Nr. 3 Buchst. a a. F. (Abweichung 9; Durchsicht von #240, Recht-I1): ausgenommen waren
    // Gebäude, die überwiegend mit Wärme aus Wärmepumpen versorgt werden. Das fragt die Anlage
    // (`heatPumpMajority`, mehr als die Hälfte der Wärme), unabhängig vom Erzeuger nach § 9. „Nein“ heißt: Die
    // Verordnung galt. Ohne Antwort oder mit „weiß nicht“ rechnet Mietfuchs ohne Kürzung und ohne Sperre und
    // nennt beide Folgen.
    const renewable = plant.energy === 'heatPump' ? law(hkvRenewableExemption, { period: lawPeriod }, lawLog) : null
    const majority = plant.heatPumpMajority ?? null
    const oldHeatPumpExemption = renewable?.heatPump === true && majority !== 'no'
    const majorityOpen = oldHeatPumpExemption && majority !== 'yes'
    // Unter dieser Ausnahme bindet § 9 nicht: Ohne bestimmbares α gehen „Heizung und Warmwasser“ ganz in
    // den Topf Heizung (Festlegung, Abweichung 9), und es gibt keinen Fehler.
    const alpha = alphaResult.ok ? alphaResult.alpha : null
    const verdict = plant.energy === 'heatPump'
      ? heatPumpVerdict(
        { energy: plant.energy, capturedOnOct2024: plant.capturedOnOct2024 ?? null, captureInstalledOn: plant.captureInstalledOn ?? null, heatPumpInstalledOn: plant.heatPumpInstalledOn ?? null },
        period.from, law(hkvHeatPumpCapture, { date: period.from }, lawLog),
      )
      : null
    const blocked: SelfBlock[] = []
    for (const p of plan.problems) blocked.push({ code: 'heating.self-incomplete', text: `${selfProblemText(p, plant.areaBasisHeat ?? 'area', capture)}${p.kind === 'missing' && p.reason !== 'sameDay' ? ' Lässt sich ein Wert nicht mehr ablesen, ist er zu schätzen (§ 9a HeizkostenV); das rechnet Mietfuchs mit einer späteren Version.' : ''}` })
    if (shares === null) {
      blocked.push({ code: 'heating.self-incomplete', text: 'Für diese Heizperiode ist kein Anteil nach Verbrauch festgelegt. Tragen Sie auf der Seite Heizkosten ein, mit welchem Anteil Sie bisher abgerechnet haben.' })
    } else {
      const { min, max } = law(hkvConsumptionShare, { period: lawPeriod }, lawLog)
      // § 8 Abs. 1: beim Warmwasser eine eigene Wahl, nie still die der Heizung (Abweichung 14).
      if (hotWater !== 'none' && shares.water === null) {
        blocked.push({ code: 'heating.self-incomplete', text: 'Für das Warmwasser ist kein Anteil nach Verbrauch festgelegt (§ 8 Abs. 1 HeizkostenV); er darf von dem der Heizung abweichen. Tragen Sie ihn auf der Seite Heizkosten ein.' })
      }
      if ([shares.heating, ...(hotWater !== 'none' && shares.water !== null ? [shares.water] : [])].some((v) => v < min || v > max)) {
        blocked.push({ code: 'heating.self-incomplete', text: `Der Anteil nach Verbrauch liegt außerhalb von ${hkvConsumptionShare.describe({ min, max })}. Korrigieren Sie ihn auf der Seite Heizkosten.` })
      }
    }
    if (!alphaResult.ok && swapMissing !== null && (alphaResult.problem === 'noDhwHeat' || alphaResult.problem === 'heatPumpBasis')) {
      blocked.push({
        code: 'heating.self-incomplete',
        text: `Die Anlage lief in dieser Heizperiode nur ${swapEnd !== null ? `bis zum ${fmtDay(swapEnd)}` : `ab dem ${fmtDay(startsOn ?? period.from)}`} (Kesseltausch). Für den Warmwasseranteil braucht es die Wärme am Warmwasserspeicher in dieser Zeit, also den Stand des Wärmezählers am Speicher am ${fmtDay(swapMissing)}. Tragen Sie ihn auf der Seite Zähler ein.`,
      })
    } else if (!alphaResult.ok && !oldHeatPumpExemption) {
      blocked.push({ code: alphaResult.problem === 'heatPumpBasis' ? 'heating.heat-pump-dhw-basis' : 'heating.dhw-share-invalid', text: dhwProblemText(alphaResult) })
    }
    const stocked = stockOfPlant.get(plant.id)
    if (stocked && !stocked.result.ok) {
      const kind = stocked.result.problem.kind
      blocked.push({
        code: kind === 'missing' ? 'fuel.stock-missing-self' : 'fuel.stock-invalid',
        text: `${problemText(stocked.result.problem)} Umzulegen sind die Kosten des verbrauchten Brennstoffs (§ 7 Abs. 2 HeizkostenV, BGH VIII ZR 156/11); ohne Bestandsrechnung verteilt Mietfuchs die Anlage nicht. Tragen Sie Anfangs- und Endbestand auf der Seite Heizkosten in der Karte „Vorrat“ ein.`,
      })
    }
    if (stockWithoutTemplate.has(plant.id)) {
      blocked.push({ code: 'heating.self-incomplete', text: 'Für den Verbrauch aus dem Vorrat fehlt eine Brennstoffposition dieser Heizanlage, in dieser Heizperiode und in der vorigen. Erfassen Sie die Brennstoffrechnung als Position nach Heizkostenverordnung.' })
    }
    // Heizkostenverteiler und Ablesedienst (Heizung PR 12, Entwurf 8.1): gemischte Geräte (§ 5 Abs. 7) und
    // fehlende Skala oder Faktor verhindern die Verteilung.
    const unitNameOf = (id: string) => snapshot.units.find((u) => u.id === id)?.name ?? id
    const hPeriod = { from: period.from, to: period.to }
    const mixed = capture === 'serviceValues' ? serviceUnitsMixed(serviceRows) : mixedCapture(capture, [...servedIds], snapshot.meters, snapshot.readings, hPeriod)
    if (mixed) blocked.push({ code: 'heating.mixed-capture', text: mixedCaptureText(capture, mixed, unitNameOf) })
    const unrated = missingRatings(capture, [...servedIds], snapshot.meters, snapshot.readings, hPeriod)
    if (unrated.length > 0) blocked.push({ code: 'heating.hca-factor-missing', text: missingRatingsText(unrated, unitNameOf) })
    const where = `${plant.name ? `Heizanlage „${plant.name}“` : 'Heizanlage'}, Heizperiode ${label}`
    if (shares !== null && shares.insulation !== 'applies' && shares.insulation !== 'notApplies' && OIL_OR_GAS.includes(plant.energy)) {
      const forced = law(hkvConsumptionShareForced, { period: lawPeriod }, lawLog)
      if (shares.heating < forced) {
        warn('heating.share-forced-unsure',
          `${where}: Ob Ihr Haus den Wärmeschutz nach dem Stand von 1994 nicht erfüllt und die Leitungen überwiegend gedämmt sind, haben Sie mit „Weiß ich nicht“ beantwortet, und von den Heizkosten gehen ${fmtNum(shares.heating)} % nach Verbrauch. Mit ${forced} % liegen Sie in jedem Fall richtig; trifft § 7 Abs. 1 Satz 2 HeizkostenV zu, sind weniger nicht zulässig. Beantworten Sie die Frage auf der Seite Heizkosten; den Pflichtwert können Sie auch in einer begonnenen Heizperiode eintragen.`,
          { kind: 'heatingCosts', id: plant.id })
      }
    }
    for (const b of blocked) warn(b.code, `${where}: ${b.text} Bis dahin verteilt Mietfuchs die Heizkosten dieser Anlage nicht; sie stehen beim Vermieter.`, { kind: 'heatingCosts', id: plant.id })
    for (const c of deviceCutoffs(capture, snapshot.meters, snapshot.readings, [...servedIds], { from: period.from, to: period.to })) {
      warn('heating.device-cutoff', deviceCutoffText(where, c, { from: period.from, to: period.to }, unitNameOf), { kind: 'meter', id: c.meterId })
    }
    const plantSubjectSelf: NoticeSubject = { kind: 'heatingCosts', id: plant.id }
    if (renewable && oldHeatPumpExemption) {
      const together = alpha === null && hotWater === 'combined'
        ? '; einen Warmwasseranteil nach § 9 HeizkostenV verlangt die Verordnung dann nicht, und die Kosten von Heizung und Warmwasser verteilt Mietfuchs gemeinsam wie die Heizkosten (Festlegung von Mietfuchs)'
        : ''
      // Ohne Antwort steht der Hinweis mit den Kürzungsbeträgen nach dem CO₂-Block
      // (`heating.heat-pump-majority-open`, Nachprüfung von #240, W2).
      if (!majorityOpen) {
        warn('heating.heat-pump-old-exemption',
          `${where}: Für diesen Abrechnungszeitraum galten die Vorschriften der Heizkostenverordnung zur Erfassung und Verteilung nicht für Räume in Gebäuden, die überwiegend mit Wärme aus ${hkvRenewableExemption.describe(renewable)} versorgt werden. ` +
            'Mietfuchs wendet die Fassung an, die zu Beginn des Abrechnungszeitraums galt (Festlegung von Mietfuchs). ' +
            'Sie haben angegeben, dass die Wärmepumpe mehr als die Hälfte der Wärme liefert. Dann gilt die Verteilung laut Mietvertrag, und Kürzungen nach § 12 HeizkostenV entfallen. ' +
            `Mietfuchs verteilt nach den erfassten Werten, wie Sie es eingerichtet haben${together}.`,
          plantSubjectSelf)
      }
    }
    if (alpha && blocked.length === 0) {
      // Heizwert hilfsweise aus der Tabelle (§ 9 Abs. 3 HeizkostenV, Entwurf R-A13).
      for (const v of alpha.statement.heatingValues.filter((x) => x.source === 'table')) {
        warn('heating.heating-value-from-table',
          `${where}: Die Rechnung „${v.label}“ nennt keinen Heizwert. Mietfuchs rechnet deshalb mit dem Wert der Heizkostenverordnung für ` +
            `${v.grade ? FUEL_GRADE_LABELS[v.grade] : 'diesen Brennstoff'}: ${v.kwh.toLocaleString('de-DE')} kWh je ${HEATING_VALUE_UNIT_TEXT[v.per]} (§ 9 Abs. 3 HeizkostenV, hilfsweise). ` +
            'Steht ein Heizwert auf der Rechnung, tragen Sie ihn an der Lieferung ein; er geht vor.',
          plantSubjectSelf)
      }
      // Plausibilität (Entwurf 15.2 F6): kein Recht, nur ein Anlass zu prüfen.
      if (alpha.value < DHW_PLAUSIBLE.min || alpha.value > DHW_PLAUSIBLE.max) {
        warn('heating.dhw-share-implausible',
          `${where}: Der Warmwasseranteil liegt bei ${fmtShare(alpha.value)}. Üblich sind Werte zwischen ${fmtShare(DHW_PLAUSIBLE.min)} und ${fmtShare(DHW_PLAUSIBLE.max)}; das ist keine Grenze des Gesetzes, ` +
            'sondern nur ein Anlass, die Angaben zu prüfen: die Wärme oder das Warmwasser und seine Temperatur, die Wohnflächen und die Energie der Rechnungen.',
          plantSubjectSelf)
      }
    }
    const weights = blocked.length === 0 && shares !== null && (alphaResult.ok || oldHeatPumpExemption)
      ? weightsOf(plan, { heating: shares.heating, water: shares.water ?? 0 }, alpha?.value ?? null)
      : null
    selfPlans.set(plant.id, {
      plant, plan, shares, alpha, weights, blocked, verdict, hotWater, input, oldHeatPumpExemption, majorityOpen,
      dhwUnmeasurable: own?.dhwUnmeasurable ?? lineOwn?.dhwUnmeasurable ?? null,
      capture,
      devices: deviceLines(capture, plan, snapshot.meters),
      serviceValues: serviceRows,
      changeSplit: plant.changeSplit ?? 'degreeDays',
      hDays: periodDays(period),
      hDegree: degreeDayPermille([{ from: period.from, to: period.to }], table),
      userByKey: new Map(plan.units.flatMap((u) => u.users.map((x): [string, SelfUserPlan] => [x.key, x]))),
    })
  }
  // Der Rechenweg einer Zeile nach Heizkostenverordnung (#114): Grund- und Verbrauchskosten je Topf,
  // Anteil nach Verbrauch, Warmwasseranteil und der Anteil des Nutzers, aus denselben Zahlen.
  const selfSteps = (sp: SelfPlantPlan, key: string, target: HeatingTarget): CalcStep[] => {
    const u = sp.userByKey.get(key)
    const unit = u ? sp.plan.units.find((x) => x.unit.id === u.unitId) : undefined
    if (!u || !unit || !sp.shares || !sp.weights) return []
    const pots: SelfPot[] = target === 'both' ? ['heating', 'water'] : [target]
    const steps: CalcStep[] = []
    for (const p of pots) {
      const total = sp.plan.totals[p]
      const area = p === 'heating' ? unit.heatArea : unit.unit.areaM2
      const byDegree = p === 'heating' && sp.changeSplit === 'degreeDays'
      const part = u.days < sp.hDays
        ? byDegree ? ` · ${fmtNum(Math.round(u.degreeDayPermille * 10) / 10)} von ${fmtNum(Math.round(sp.hDegree * 10) / 10)} ‰ Gradtage` : ` · ${u.days}/${sp.hDays} Tage`
        : ''
      steps.push({ label: `Grundkosten ${POT_NAME[p]}`, value: `${fmtNum(area)} von ${fmtNum(total.area)} m²${part}`, term: 'baseCosts' })
      const v = u.pots[p].value
      steps.push(total.measured && v !== null
        ? {
          label: `Verbrauchskosten ${POT_NAME[p]}`,
          value: `${fmtNum(Math.round(v * 1000) / 1000)} von ${fmtNum(Math.round(total.consumption * 1000) / 1000)} ${potUnitOf(sp, p)}${u.pots[p].group ? ' (ohne Zwischenablesung nach § 9b Abs. 3 HeizkostenV geteilt)' : ''}`,
          term: 'consumptionCosts',
        }
        : { label: `Verbrauchskosten ${POT_NAME[p]}`, value: 'kein Verbrauch erfasst, nur nach Fläche verteilt', term: 'consumptionCosts' })
      steps.push({ label: `Anteil nach Verbrauch ${POT_NAME[p]}`, value: `${fmtNum(total.measured ? (sp.shares[p] ?? 0) : 0)} %`, term: 'consumptionCosts' })
    }
    if (target === 'both' && sp.alpha) {
      const how = sp.alpha.statement.method === 'volumeFormula' ? 'aus dem gemessenen Warmwasser berechnet' : sp.alpha.statement.method === 'areaFormula' ? 'aus der Wohnfläche berechnet' : 'gemessen'
      steps.push({ label: 'Warmwasseranteil', value: `${fmtPercent(sp.alpha.value * 100)} % (${how})`, term: 'hotWaterShare' })
    }
    steps.push({ label: 'Ihr Anteil nach Heizkostenverordnung', value: `${fmtPercent((sp.weights.get(key)?.[target] ?? 0) * 100)} %`, term: 'heatingSystem' })
    return steps
  }
  const TARGET_TEXT: Record<HeatingTarget, string> = { both: 'Heizung und Warmwasser', heating: 'Heizung', water: 'Warmwasser' }
  const selfBasisText = (sp: SelfPlantPlan, key: string, target: HeatingTarget): string =>
    `nach Heizkostenverordnung, ${TARGET_TEXT[target]} ${fmtPercent((sp.weights?.get(key)?.[target] ?? 0) * 100)} %`
  // Die Kosten eines Topfs: jede Position der Anlage nach ihrem Ziel, „Heizung und Warmwasser“ nach dem
  // Warmwasseranteil geteilt (Entwurf 8.3, 8.5). Ohne α (kein verbundenes Warmwasser) gibt es kein
  // Ziel „beides“.
  const partOf = (sp: SelfPlantPlan, c: SnapshotCostItem, p: SelfPot): number => {
    const a = sp.alpha?.value ?? null
    const tg = c.heatingTarget ?? null
    return tg === p ? 1 : tg === 'both' ? (a === null ? (p === 'heating' ? 1 : 0) : p === 'heating' ? 1 - a : a) : 0
  }
  const potCostOf = (sp: SelfPlantPlan, potItems: readonly SnapshotCostItem[], p: SelfPot): number =>
    potItems.filter((c) => c.key === 'heatingSystem').reduce((sum, c) => sum + c.amountCents * partOf(sp, c, p), 0)
  // Der Teil des CO₂-Abzugs eines Mieters, der auf jeden Topf entfällt (Abweichung 15, Entwurf 6.5): sein
  // gedruckter Abzug (positiv) im Verhältnis seines Brennstoffs in diesem Topf zu seinem Brennstoff
  // insgesamt. Beim Ziel „beides“ teilt α.
  const potCo2Of = (sp: SelfPlantPlan, potItems: readonly SnapshotCostItem[], reliefKey: string | null, tenancyId: string | null, w: SelfWeights | undefined): Record<SelfPot, number> => {
    const st = tenancyId ? statements.get(tenancyId) : undefined
    const relief = st && reliefKey ? -st.rows.filter((r) => r.costItemId === reliefKey).reduce((a, r) => a + r.shareCents, 0) : 0
    if (!w || relief === 0) return { heating: 0, water: 0 }
    const fuel = potItems.filter((c) => c.key === 'heatingSystem' && c.heatingPart === 'fuel')
    const inPot = (p: SelfPot) => fuel.reduce((a, c) => a + c.amountCents * partOf(sp, c, p) * w[p], 0)
    const h = inPot('heating')
    const wa = inPot('water')
    return h + wa > 0 ? { heating: (relief * h) / (h + wa), water: (relief * wa) / (h + wa) } : { heating: 0, water: 0 }
  }
  // Der Ausweis je Anlage und Heizperiode (Entwurf 8.8 ohne § 6a, der mit PR 14 kommt).
  const selfStatementOf = (sp: SelfPlantPlan, potItems: readonly SnapshotCostItem[], reliefKey: string | null): SelfHeatingStatement => {
    const cost = { heating: potCostOf(sp, potItems, 'heating'), water: potCostOf(sp, potItems, 'water') }
    const offDays = (d: string, b: string): number => Math.abs(Math.round((toUTC(d) - toUTC(b)) / MS_DAY))
    return {
      ok: sp.weights !== null,
      heatPump: sp.verdict?.kind ?? null,
      changeSplit: sp.changeSplit,
      areaBasisHeat: sp.plant.areaBasisHeat ?? 'area',
      hotWater: sp.hotWater,
      alpha: sp.alpha ? { percent: sp.alpha.value * 100, dhwHeatKwh: sp.alpha.dhwHeatKwh, referenceKwh: sp.alpha.referenceKwh, reference: sp.alpha.reference, estimated: sp.alpha.estimated } : null,
      // Der Rechenweg zum Warmwasseranteil (Heizung PR 11, Entwurf 8.8 „α mit Methode“).
      ...(sp.alpha ? { dhw: sp.alpha.statement } : {}),
      shares: sp.shares ? { heating: sp.shares.heating, water: sp.shares.water, forced: sp.shares.forced, previous: sp.shares.previous } : null,
      pots: sp.plan.pots.map((p): SelfPotView => {
        const t = sp.plan.totals[p]
        const pct = t.measured && sp.shares ? (sp.shares[p] ?? 0) : 0
        return {
          pot: p, costCents: Math.round(cost[p]), consumptionPct: pct, byAreaOnly: !t.measured, areaM2: t.area, consumption: t.consumption,
          consumptionUnit: potUnitOf(sp, p),
          baseCentsPerM2: t.area > 0 ? (cost[p] * (1 - pct / 100)) / t.area : 0,
          consumptionCentsPerUnit: t.measured && t.consumption > 0 ? (cost[p] * pct / 100) / t.consumption : null,
        }
      }),
      units: sp.plan.units.map((u): SelfUnitView => ({
        unitId: u.unit.id,
        unitName: u.unit.name,
        areaM2: u.unit.areaM2,
        heatAreaM2: u.heatArea,
        readings: u.readings,
        boundaries: u.boundaries.map((b) => {
          const dated = b.readingDates.filter((d): d is string => d !== null)
          // Der Grund einer nicht möglichen Zwischenablesung (Durchsicht von #239, I3), nur wenn es ihn gibt.
          const reason = b.gap === 'impossible' ? ((snapshot.interimGaps ?? []).find((g) => g.unitId === u.unit.id && g.date === b.date)?.reason ?? '') : ''
          return {
            ...(reason !== '' ? { gapReason: reason } : {}),
            date: b.date, kind: b.kind, gap: b.gap, far: b.far,
            status: dated.length < b.readingDates.length ? 'missing' : dated.some((d) => d !== b.date) ? 'off' : 'read',
            offDays: dated.reduce((m, d) => Math.max(m, offDays(d, b.date)), 0),
          }
        }),
        users: u.users.map((x): SelfUserView => {
          const w = sp.weights?.get(x.key)
          const co2 = potCo2Of(sp, potItems, reliefKey, x.tenancyId, w)
          return {
            key: x.key, role: x.role, tenancyId: x.tenancyId, label: x.label, from: x.from, to: x.to, days: x.days, degreeDayPermille: x.degreeDayPermille,
            heatingConsumption: x.pots.heating.value,
            waterConsumption: sp.plan.pots.includes('water') ? x.pots.water.value : null,
            heatingGroup: x.pots.heating.group,
            waterGroup: x.pots.water.group,
            heatingCents: w ? Math.round(cost.heating * w.heating) : 0,
            waterCents: w ? Math.round(cost.water * w.water) : 0,
            heatingCo2Cents: Math.round(co2.heating),
            waterCo2Cents: Math.round(co2.water),
          }
        }),
      })),
      // Heizung PR 12 (Entwurf 8.8): je Heizkostenverteiler Einheiten, Skala und Faktor, bzw. die Werte des
      // Ablesedienstes; nur bei dieser Erfassung.
      ...(sp.devices.length > 0 ? { devices: sp.devices } : {}),
      ...(sp.serviceValues.length > 0 ? { serviceValues: sp.serviceValues } : {}),
    }
  }
  const co2Pots = co2PotsOf(snapshot, [...items, ...fuelSynthetic].filter((c) => !spanning.has(c.id)))
  const co2Deductions = co2DeductionsOf(co2Pots, snapshot.units, (p) => law(co2ApplicableFrom, { period: { from: p.from, to: p.to } }, lawLog))
  let totalCostsCents = 0
  let selfUsedShareCents = 0

  // Fehlende Angaben an der selbstgenutzten Wohnung heben ihren Eigenanteil beim jeweiligen
  // Schlüssel stillschweigend auf — dann verteilt er allein auf die Mieter. Deshalb warnen,
  // sobald ein betroffener Schlüssel im Jahr überhaupt vorkommt.
  const usesKey = (key: CostKey) => items.some((c) => c.key === key && !isNotAllocable(c.category))
  // Nimmt die Wohnung an einer Position dieses Schlüssels teil (#105)? Die Warnungen unten nennen
  // nur solche Wohnungen; eine Garage ohne Fläche, die an keiner Flächenposition teilnimmt, fehlt
  // in keiner Verteilung.
  const inKeyBasis = (unitId: string, key: CostKey) =>
    items.some((c) => c.key === key && !isNotAllocable(c.category) && (!c.participantUnitIds || c.participantUnitIds.includes(unitId)))
  // Fehlt die Basis ganz, geht jede Position des Schlüssels an den Vermieter — das meldet die
  // Position selbst. Die Meldungen je Wohnung wären dann widersprüchlich („verteilt nur auf
  // die Mieter", obwohl nichts verteilt wird) und entfallen. Ohne Mietverhältnis im Jahr
  // fehlen Personentage regulär (Leerstand) — das ist kein Datenmangel.
  const areaBasisMissing = !(basisArea > 0)
  const personsBasisMissing = !(occupantPersonDays > 0) && partTenancies.length > 0
  const selfNoPersons = selfUnits.filter((u) => selfPersonsOf(u) === 0 && inKeyBasis(u.id, 'persons'))
  if (selfNoPersons.length > 0 && usesKey('persons') && !personsBasisMissing) {
    warn('basis.self-no-persons',
      `Für die ${plural(selfNoPersons.length, 'selbstgenutzte Wohnung', 'selbstgenutzten Wohnungen')} ${andList(selfNoPersons.map((u) => u.name))} ist keine Personenzahl hinterlegt — der Personenschlüssel verteilt nur auf die Mieter.`,
      unitSubject(selfNoPersons),
    )
  }
  const selfNoArea = selfUnits.filter((u) => !(u.areaM2 > 0) && inKeyBasis(u.id, 'area'))
  if (selfNoArea.length > 0 && usesKey('area') && !areaBasisMissing) {
    warn('basis.self-no-area',
      `Für die ${plural(selfNoArea.length, 'selbstgenutzte Wohnung', 'selbstgenutzten Wohnungen')} ${andList(selfNoArea.map((u) => u.name))} ist keine Wohnfläche hinterlegt — der Flächenschlüssel verteilt nur auf die Mieter.`,
      unitSubject(selfNoArea),
    )
  }
  // Dasselbe bei den übrigen Wohnungen der Abrechnungseinheit, vermietet oder leer: Ohne
  // Basiswert verteilt der Schlüssel ihren Anteil auf die anderen, bei einer vermieteten Wohnung
  // zahlen dann die übrigen Mieter mit.
  // **Seit #135 kann 0 eine Angabe sein**: Das Formular lässt 0 m² und 0 Personen für Garage,
  // Stellplatz oder Lager ausdrücklich zu. In der Datenbank ist eine vergessene Fläche aber
  // ebenfalls 0 (Pflichtfeld, und der Umstieg macht aus einer fehlenden Fläche 0 m²). Unterschieden
  // wird deshalb am Gegenstück (`isGarageLike`): Hat eine Einheit weder Fläche noch Bewohner im
  // Jahr, ist sie Garage-artig, und beide Nullen sind ein Hinweis (`basis.unit-zero`,
  // `basis.tenancy-zero`). Wohnt dort jemand, ist 0 m² eine vergessene Fläche; hat sie Fläche, sind
  // 0 Personen eine vergessene Personenzahl. Beides bleibt eine Warnung wie vor #135.
  const positionsOf = (key: CostKey, unitIds: string[]) => {
    const names = [...new Set(items
      .filter((c) => c.key === key && !isNotAllocable(c.category) && (!c.participantUnitIds || unitIds.some((id) => c.participantUnitIds?.includes(id))))
      .map((c) => `„${c.description}“`))]
    return andList(names)
  }
  const partNoArea = snapshot.units.filter((u) => u.participates && !(u.areaM2 > 0) && inKeyBasis(u.id, 'area'))
  if (partNoArea.length > 0 && usesKey('area') && !areaBasisMissing) {
    const forgotten = partNoArea.filter((u) => !isGarageLike(u))
    const zero = partNoArea.filter((u) => isGarageLike(u))
    if (forgotten.length > 0) {
      warn('basis.unit-no-area',
        `Für die ${plural(forgotten.length, 'Einheit', 'Einheiten')} ${andList(forgotten.map((u) => u.name))} ist keine Wohnfläche hinterlegt — der Flächenschlüssel verteilt ihren Anteil auf die übrigen Wohnungen.`,
        unitSubject(forgotten),
      )
    }
    if (zero.length > 0) {
      warn('basis.unit-zero',
        `Für ${andList(zero.map((u) => u.name))} sind 0 m² und 0 Personen eingetragen; bei ${positionsOf('area', zero.map((u) => u.id))} ${zero.length === 1 ? 'trägt sie' : 'tragen sie'} nichts, ihr Anteil verteilt sich auf die übrigen Wohnungen. ` +
          'Ist das nicht gewollt (keine Garage, kein Stellplatz, kein Lager), tragen Sie die Wohnfläche ein.',
        unitSubject(zero),
      )
    }
  }
  const partNoPersons = partTenancies.filter((t) => !(personDaysInPeriod(t, yFrom, yTo) > 0) && inKeyBasis(t.unitId, 'persons'))
  if (partNoPersons.length > 0 && usesKey('persons') && !personsBasisMissing) {
    const forgotten = partNoPersons.filter((t) => t.unit.areaM2 > 0)
    const zero = partNoPersons.filter((t) => !(t.unit.areaM2 > 0))
    if (forgotten.length > 0) {
      warn('basis.tenancy-no-persons',
        `Für ${andList(forgotten.map((t) => `${t.tenantName} (${t.unit.name})`))} ist keine Personenzahl hinterlegt — der Personenschlüssel verteilt deren Anteil auf die übrigen Wohnungen.`,
        tenancySubject(forgotten),
      )
    }
    if (zero.length > 0) {
      warn('basis.tenancy-zero',
        `Für ${andList(zero.map((t) => `${t.tenantName} (${t.unit.name})`))} sind 0 Personen und 0 m² eingetragen; bei ${positionsOf('persons', zero.map((t) => t.unitId))} ${zero.length === 1 ? 'trägt das Mietverhältnis nichts, sein' : 'tragen die Mietverhältnisse nichts, ihr'} Anteil verteilt sich auf die übrigen. ` +
          'Ist das nicht gewollt (keine Garage, kein Stellplatz, kein Lager), tragen Sie die Personenzahl ein.',
        tenancySubject(zero),
      )
    }
  }

  // Leerstand beim Personenschlüssel (#177): einmal je Abrechnung, mit den Positionen, in deren
  // Verteilbasis eine leere Wohnung zählt. Positionen ohne Verteilbasis melden sich selbst. Ohne
  // ein Mietverhältnis unter den Teilnehmern geht die Position ohnehin ganz an den Vermieter, wie
  // bei Fläche und Einheiten; dann gibt es nichts zu erklären.
  {
    const takes = (c: SnapshotCostItem, unitId: string) => !c.participantUnitIds || c.participantUnitIds.includes(unitId)
    const affected = items.filter((c) => c.key === 'persons' && !isNotAllocable(c.category) &&
      vacancies.some((v) => takes(c, v.unit.id)) && partTenancies.some((t) => takes(c, t.unitId)))
    const units = vacancies.filter((v) => affected.some((c) => takes(c, v.unit.id)))
    if (affected.length > 0 && !personsBasisMissing) {
      const persons = [...new Set(units.map((v) => v.persons))]
      warn('basis.vacancy-persons',
        `Bei ${andList(affected.map((c) => `„${c.description}“`))} (nach Personen) ${units.length === 1 ? 'stand' : 'standen'} ${andList(units.map((v) => `${v.unit.name} (${daysLabel(v.days)})`))} leer. ` +
          'An den Kosten leerstehender Wohnungen ist der Vermieter zu beteiligen; sie gehen nicht still an die übrigen Mieter (Grundsatz nach BGH, Urteil vom 31.05.2006, VIII ZR 159/05, dort zum Flächenschlüssel). ' +
          'Wie das beim Personenschlüssel geschieht, regelt kein Gesetz, und es ist nicht abschließend geklärt: Nach BGH, Beschluss vom 08.01.2013, VIII ZR 180/12, kommt es auf den Einzelfall an, und es kann in Betracht kommen, für die Zeit des Leerstands eine fiktive Person anzusetzen. ' +
          `Mietfuchs setzt jeden Tag ohne Mietverhältnis mit ${persons.length === 1 ? personsLabel(persons[0] ?? 0) : 'der angegebenen Personenzahl'} an; das ist eine Auslegung von Mietfuchs. Der Anteil steht in Ihrem Vermieteranteil als Leerstand. ` +
          'Bei Kosten, die von der Personenzahl abhängen (etwa Wasser nach Personen), kann eine andere Aufteilung angemessener sein, zum Beispiel in Grund- und Verbrauchskosten.',
        // Bewusst ohne Eintrag: Eine Auskunft, an der Wohnung ist nichts zu beheben, und ein „Hier
        // beheben →“ darunter legte nahe, es sei etwas falsch (Endprüfung rc.4).
      )
    }
    // Ganz leer und ohne Fläche: keine Wohnung, also kein Leerstand (siehe `isDwelling`). Ob das
    // stimmt, weiß nur der Vermieter; eine Wohnung mit vergessener Fläche sähe genauso aus.
    const noArea = basisUnits.filter((u) => u.participates && !isDwelling(u) &&
      !tenancies.some((t) => t.unitId === u.id) &&
      items.some((c) => c.key === 'persons' && !isNotAllocable(c.category) && takes(c, u.id) && partTenancies.some((t) => takes(c, t.unitId))))
    if (noArea.length > 0 && !personsBasisMissing) {
      const names = andList(noArea.map((u) => u.name))
      warn('basis.vacancy-no-area', noArea.length === 1
        ? `${names} hat 0 m² und keine Bewohner und wird beim Personenschlüssel nicht als Leerstand angesetzt. Ist ${names} eine Wohnung, tragen Sie die Wohnfläche ein.`
        : `${names} haben 0 m² und keine Bewohner und werden beim Personenschlüssel nicht als Leerstand angesetzt. Ist eine davon eine Wohnung, tragen Sie dort die Wohnfläche ein.`,
      unitSubject(noArea))
    }
  }

  // Die Verteilbasis einer Position (#94). **Ohne Teilnehmer ist sie genau die bisherige**, und
  // zwar dasselbe Objekt, einmal berechnet: So kann die Umstellung keine Zahl verschieben, und
  // die Golden-Tests bleiben der Beweis dafür. Mit Teilnehmern besteht sie nur aus ihnen, bei
  // vermieteten wie bei selbstgenutzten Wohnungen, und beim Verbrauch zählen nur ihre Zähler.
  // Für den Vergleich mit dem Vorjahr (#141): die Wohnungen der Abrechnungseinheit heute.
  const basisUnitIds = basisUnits.map((u) => u.id)
  const fullBasis = { basisUnits, selfUnits, basisArea, selfArea, partTenancies, basisPersonDays, occupantPersonDays, selfPersonDays, vacancies, vacancyPersonDays, consumptionByType }
  const basisOf = (item: SnapshotCostItem): typeof fullBasis => {
    if (!item.participantUnitIds) return fullBasis
    const only = new Set(item.participantUnitIds)
    const bUnits = basisUnits.filter((u) => only.has(u.id))
    const sUnits = selfUnits.filter((u) => only.has(u.id))
    const pTenancies = partTenancies.filter((t) => only.has(t.unitId))
    const sPersonDays = sUnits.reduce((a, u) => a + selfPersonsOf(u) * diy, 0)
    const vs = vacancies.filter((v) => only.has(v.unit.id))
    const vPersonDays = vs.reduce((a, v) => a + v.personDays, 0)
    const oPersonDays = pTenancies.reduce((a, t) => a + personDaysInPeriod(t, yFrom, yTo), 0) + sPersonDays
    return {
      basisUnits: bUnits,
      selfUnits: sUnits,
      basisArea: bUnits.reduce((a, u) => a + (u.areaM2 || 0), 0),
      selfArea: sUnits.reduce((a, u) => a + (u.areaM2 || 0), 0),
      partTenancies: pTenancies,
      basisPersonDays: oPersonDays + vPersonDays,
      occupantPersonDays: oPersonDays,
      selfPersonDays: sPersonDays,
      vacancies: vs,
      vacancyPersonDays: vPersonDays,
      consumptionByType: consumptionFor(sUnits, only, bUnits),
    }
  }

  // Kabelfernsehen (#107): Seit dem 01.07.2024 sind die Gebühren für das TV-Signal nicht mehr als
  // Betriebskosten umlagefähig (Wegfall des Nebenkostenprivilegs, § 2 Nr. 15 BetrKV a. F.,
  // Übergangsfrist bis 30.06.2024, nur für Anlagen vor dem 01.12.2021, § 2 Satz 2 BetrKV). Danach bleibt
  // bei solchen Anlagen nur der Betriebsstrom, bei einer Gemeinschaftsantenne auch Prüfung und Einstellung.
  // Welcher Teil einer Position was ist, weiß Mietfuchs nicht; es kürzt deshalb nicht selbst,
  // sondern sagt es. Ab wann das gilt, steht im Rechtsregister (`betrkv.tv-signal`, Zeitregel
  // `overlap`): Gilt die Regel nur im Teil des Jahres, ist es das Übergangsjahr; gilt sie gar nicht
  // mehr, die Zeit danach. Einen Beginn hat die Regel nicht, „gar nicht“ heißt deshalb immer
  // „vorbei“. Abgefragt nur, wenn es eine Position Kabel/Antenne gibt.
  const tv = items.some((c) => c.category === 'Kabel/Antenne') ? law(betrkvTvSignal, { period: lawPeriod }, lawLog) : null
  // Gilt die Regel im Jahr gar nicht mehr, protokolliert das Register nichts. Jede Position
  // Kabel/Antenne bekommt dann aber einen Hinweis, der die Fassung nennt (Ende und Stichtag der
  // Anlage); auf sie stützt sich die Abrechnung, und die Anzeige nennt ihre Gültigkeit.
  if (tv && tv.coverage === 'none' && tv.validTo) recordVersionAt(betrkvTvSignal, tv.validTo, lawLog)
  const tvSignal = tv?.coverage ?? 'none'
  const tvUntil = tv?.validTo ?? ''
  const tvNewFrom = tv?.value.newSystemsFrom ?? ''
  // Eine Anlage ab dem Stichtag der Regel fiel nie unter sie (#121, § 2 Satz 2 BetrKV): dann in
  // jedem Zeitraum, der bis in die Zeit ab dem Stichtag reicht, dieselbe Warnung, ohne
  // Übergangszeit (#208).
  const newSystem = tv !== null && snapshot.property?.cableBuiltBeforeDec2021 === false && yTo >= tvNewFrom
  // Fällt der Stichtag in den Zeitraum, gilt die Warnung für die Kosten ab der Errichtung.
  const newSystemInPeriod = yFrom < tvNewFrom && yTo >= tvNewFrom
  // „Das erste Halbjahr“ stimmt nur im Kalenderjahr; sonst nennt der Text das Ende der Regel (#208).
  const kalenderjahr = calendarYearPeriod(year)
  const umlegbar = yFrom === kalenderjahr.from && yTo === kalenderjahr.to ? `für ${label} höchstens das erste Halbjahr` : `für ${label} höchstens die Zeit bis zum ${fmtDay(tvUntil)}`
  // Die Warnungen nennen den Betrag, der trotzdem bei den Mietern gelandet ist (#142, Zielbild
  // aus #91). Den kennt erst die Verteilung; geschrieben werden sie deshalb danach, aber an dieser
  // Stelle der Hinweise, damit ihre Reihenfolge bleibt.
  const tvAt = notices.length
  const tenantCentsOf = new Map<string, number>()
  // Die exakten Anteile der Mietverhältnisse mit Abrechnung je Position (Heizung PR 9), für x_t der
  // Etagenheizung (Entwurf 9.3). Leerstand, Eigennutzung und Pauschale stehen nicht darin.
  const exactByItem = new Map<string, Map<string, number>>()
  const tvNotices = () => items.filter((c) => c.category === 'Kabel/Antenne').flatMap((item): Notice[] => {
    const cents = tenantCentsOf.get(item.id) ?? 0
    // Nur ein wirklich umgelegter Betrag; eine Gutschrift hat den Mietern nichts aufgebürdet.
    const charged = cents > 0 ? ` Auf die Mieter umgelegt sind in dieser Abrechnung ${fmtCents(cents)}.` : ''
    if (newSystem) {
      return [makeNotice('tv-signal.new-system', `„${item.description}“: Die Kabel- oder Antennenanlage wurde ab dem ${fmtDay(tvNewFrom)} errichtet; für sie waren die Gebühren für das TV-Signal nie umlagefähig, auch Betriebsstrom und Wartung nicht (§ 2 Satz 2 BetrKV).${charged} Umlagefähig sind allenfalls Betriebsstrom und Bereitstellungsentgelt einer reinen Glasfaser-Verteilanlage, bei der der Mieter seinen Anbieter frei wählen kann (§ 2 Nr. 15 Buchst. c BetrKV); buchen Sie den Rest bitte als „Nicht umlagefähig“.${newSystemInPeriod ? ` Für ${label} gilt das für die Kosten ab der Errichtung; was davor auf eine ältere Anlage entfiel, war umlagefähig.` : ''}`, itemSubject(item))]
    } else if (tvSignal === 'partial') {
      return [makeNotice('tv-signal.partial-year', `„${item.description}“: Die Gebühren für das Kabelfernsehen (TV-Signal) sind nur bis zum ${fmtDay(tvUntil)} umlagefähig, danach nicht mehr (Wegfall des Nebenkostenprivilegs). Umlegen dürfen Sie ${umlegbar}, und das nur bei einer Anlage, die vor dem ${fmtDay(tvNewFrom)} errichtet wurde; danach nur noch den Betriebsstrom (bei einer Gemeinschaftsantenne des Hauses auch Prüfung und Einstellung durch eine Fachkraft). Bitte teilen Sie die Position entsprechend auf und buchen Sie den Rest als „Nicht umlagefähig“.`, itemSubject(item))]
    } else if (tvSignal === 'none') {
      return [makeNotice('tv-signal.ended', `„${item.description}“: Die Gebühren für das Kabelfernsehen (TV-Signal) sind seit dem ${fmtDay(dayAfter(tvUntil))} nicht mehr umlagefähig (Wegfall des Nebenkostenprivilegs).${charged} Umlegen dürfen Sie nur noch den Betriebsstrom, und das nur bei einer Anlage, die vor dem ${fmtDay(tvNewFrom)} errichtet wurde (bei einer Gemeinschaftsantenne des Hauses auch Prüfung und Einstellung durch eine Fachkraft); buchen Sie das TV-Signal bitte als „Nicht umlagefähig“.`, itemSubject(item))]
    }
    return []
  })

  // § 2 HeizkostenV (#93, #140), siehe shared/heating.ts: Im Gebäude mit höchstens zwei Wohnungen,
  // von denen der Vermieter eine selbst bewohnt, darf anderes vereinbart werden. Eine Garage oder
  // ein Stellplatz ist keine Wohnung.
  // Wohnung im Sinne des § 2 ist, was Fläche hat oder bewohnt ist. Eine Einheit ohne Fläche und
  // ohne Bewohner (Garage, Stellplatz, auch leer oder außerhalb der Abrechnungseinheit) zählt nicht;
  // eine bewohnte mit vergessener Fläche zählt (letzte Durchsicht). Bewusst anders als bei
  // `basis.unit-no-area`: Dort warnt auch ein Leerstand mit 0 m², weil Geld wandern kann; hier geht
  // es nur darum, ob das Gebäude mehr als zwei Wohnungen hat.
  const heatingAgreeable = mayAgreeOtherwise(snapshot.units, isDwelling)
  // Heizpositionen ohne Verbrauchsanteil (#140): Die Kürzungsbeträge entstehen in der Verteilung,
  // gemeldet wird erst danach, denn ob eine Wohnung nach Verbrauch gedeckt ist, steht erst fest,
  // wenn alle Positionen verteilt sind (siehe shared/heating.ts).
  // Je Zeile der Anteil des Mieters; den Kürzungsbetrag rechnet erst der Hinweis, mit dem Satz aus
  // dem Rechtsregister (`hkv.cut.not-by-consumption`).
  const heatingCuts: { item: SnapshotCostItem, rows: { unitId: string, label: string, share: number }[] }[] = []
  const heatingCovered = new Set<string>()
  // Die erste Heizposition, über die ein Mieter abgerechnet wird; an ihr hängt der Hinweis zur
  // Fernablesbarkeit (heating-remote-reading), einmal je Abrechnung.
  let heatingBilledItem: SnapshotCostItem | undefined
  // Eine Einheit ohne Wärmeanschluss (#117) oder eine Garage-artige (0 m², niemand wohnt dort) ist
  // bei Heizung und Warmwasser keine beteiligte Wohnung: keine Warnung zur Warmmiete, kein
  // Kürzungsbetrag (zweite Browserabnahme). Verteilt wird weiter wie erfasst.
  const outsideHeating = (u: SnapshotUnit) => isGarageLike(u) || (u.noConnection ?? []).includes('waerme')

  // Zwei Positionen derselben Kostenart, eine ohne Beleg: oft die Übernahme aus dem Vorjahr und
  // dieselbe Rechnung noch einmal aus dem Beleg. Nur ein Hinweis, verteilt wird wie erfasst. Der Rat
  // lautet „löschen“ und nicht „Beleg zuordnen“: Zugeordnet verstummt der Hinweis (er verlangt eine
  // Position ohne Beleg), die Summe bliebe aber doppelt (Integrationsdurchsicht M1).
  for (const group of possibleDuplicates(items, at, snapshot.comparableCostItems ?? snapshot.previousCostItems ?? [])) {
    const first = group.find((i) => !i.invoiceFile) ?? group[0]
    if (!first) continue
    const list = group.map((i) => `„${i.description}“ (${fmtCents(i.amountCents)}${i.invoiceFile ? '' : ', ohne Beleg'})`)
    const named = andList(list)
    warn('cost.possible-duplicate',
      `${named} stehen ${list.length === 2 ? `beide ${at.label}` : `${at.label} alle`} unter „${first.category}“. ${list.length === 2 ? 'Ist das dieselbe Rechnung' : 'Ist darunter dieselbe Rechnung zweimal'}, etwa einmal aus dem Vorjahr übernommen und einmal aus dem Beleg erfasst, wird sie zweimal verteilt. ` +
      (list.length === 2
        ? 'Dann bitte eine der beiden Positionen löschen, in der Regel die ohne Beleg. Soll die ohne Beleg bleiben, setzen Sie ihren Betrag auf den der Rechnung und löschen die andere. '
        : 'Dann bitte die doppelt erfasste Position löschen, in der Regel die ohne Beleg. ') +
      'Nur den Beleg zuzuordnen genügt nicht: Die Rechnung stünde weiter zweimal in der Summe. Sind es verschiedene Rechnungen, ist nichts zu tun.',
      itemSubject(first))
  }

  // „Nur Heizung“ zeitanteilig (Heizung PR 10) und der Betrag nach der Verordnung bei Pauschale (Entwurf 6.3).
  const manualSplitTime = new Map<string, Map<string, { now: number, alt: number }>>()
  const selfFlat = new Map<string, number>()
  for (const item of [...items, ...fuelSynthetic]) {
    const b = basisOf(item)
    // Eine Übertragszeile (Heizung PR 7) ist keine Position: Sie zählt nicht zu den Kosten des
    // Zeitraums, hat keinen Schlüsselwechsel und keine Überschneidung, und die Regeln aus #140
    // betreffen die Position, deren Teil sie ist.
    const carry = fuelCarryOf.get(item.id)
    const bookable = (t: SnapshotTenancy) => statements.has(t.id) && modelFor(t, item) === 'settlement'
    if (!carry) totalCostsCents += item.amountCents
    // Anders als im Vorjahr (#141)? Nur ein Hinweis, verteilt wird wie erfasst.
    const keyChange = carry ? null : keyChangeText(item, snapshot.comparableCostItems ?? snapshot.previousCostItems ?? [], at, basisUnitIds)
    if (keyChange) warn('key.changed-from-previous-year', keyChange, itemSubject(item))
    // Kosten der Zwischenablesung (BGH VIII ZR 19/07, Entwurf 10.1, Abweichung 19). Nicht an den
    // Übertragszeilen der Lieferungen und des Vorrats.
    if (item.category === HEATING_CATEGORY && !item.id.startsWith('fuel:') && !item.id.startsWith('stock:') && /zwischenablesung|nutzerwechsel/i.test(item.description)) {
      warn('heating.change-fee',
        `„${item.description}“: Kosten der Verbrauchserfassung, die wegen des Auszugs eines Mieters vor Ablauf des Abrechnungszeitraums entstehen, sind keine umlagefähigen Betriebskosten; sie trägt der Vermieter, soweit im Mietvertrag nichts anderes vereinbart ist (BGH VIII ZR 19/07). ` +
          'Ob eine Klausel im Formularmietvertrag genügt, hat der BGH nicht entschieden; ein Amtsgericht hält sie für unwirksam (AG Berlin-Hohenschönhausen; das Aktenzeichen steht im Lexikon unter „Zwischenablesung“). Eine wirksame Vereinbarung gibt einen Anspruch gegen den ausziehenden Mieter, keine Position für alle. ' +
          'Gehört die Position dazu, erfassen Sie sie unter „Nicht umlagefähig“.',
        itemSubject(item))
    }
    // Rohanteile (float, in Cent) pro Mietverhältnis bestimmen.
    // Nicht umlagefähige Kosten gehen immer vollständig an den Vermieter.
    const targets: Target[] = []
    // Anteil, der auf selbstgenutzte Wohnungen entfällt (Teil des Vermieteranteils) — für
    // die Steuerübersicht separat ausgewiesen, weil er privat und damit nicht abziehbar ist.
    let selfRaw = 0
    // Für die Zerlegung des Vermieteranteils (#142): Geht die Position ganz an den Vermieter, steht
    // hier der eine Grund dafür. Sonst ergibt sich die Zerlegung erst aus der Verteilung.
    let forced: LandlordReason | null = isNotAllocable(item.category) ? 'notAllocable' : null
    // Bei vereinbarten Anteilen, was unter 100 % fehlt; was auf Wohnungen außerhalb der
    // Abrechnungseinheit entfällt (verfallene Anteile, Zähler solcher Wohnungen); beim Hauptzähler
    // der Verbrauch, den kein Wohnungszähler misst.
    let customUnassignedRaw = 0
    let outsideRaw = 0
    let mainRestRaw = 0
    // Der abziehbare CO₂-Anteil beim Vorwegabzug (Heizung PR 6); `null` bei jeder anderen Position.
    let co2ShareRaw: number | null = null
    const noBasis = (reason: string) => {
      forced = 'noBasis'
      warn('item.no-basis', `„${item.description}“: ${reason} — Betrag geht an den Vermieter.`, itemSubject(item))
    }
    // Tage im Rechenweg, nur bei einem Teiljahr.
    // „Nur Heizung“ bei freien Schlüsseln (Heizung PR 10, Entwurf 5.3 `change_split`, A2, B7): Beim
    // Mieterwechsel teilen die übrigen Wärmekosten nach Gradtagszahlen (§ 9b Abs. 2), wenn die Anlage
    // es so eingestellt hat (Vorgabe). Eine kombinierte Position „Heizung und Warmwasser“ geht nach
    // Tagen wie bisher; ohne Ziel ändert sich keine Zahl. § 9b Abs. 2 lässt Gradtage oder Zeitanteil zu:
    // Bei Fläche, Einheiten, vereinbarten Anteilen und Direktzuordnung ist der Tagesanteil genau der
    // zeitanteilige Faktor, und an seine Stelle tritt der Gradtagsanteil. Personentage bleiben; sie sind
    // ebenso zeitanteilig, und die Verordnung kennt für Heizkosten keinen Personenschlüssel
    // (§ 7 Abs. 1 Satz 5; Abweichung 16).
    const manualPlant = item.category === HEATING_CATEGORY && item.heatingTarget === 'heating'
      ? plants.find((p) => p.id === item.heatingPlantId && p.method === 'manual')
      : undefined
    const degreeTable = manualPlant && (manualPlant.changeSplit ?? 'degreeDays') === 'degreeDays' ? law(hkvDegreeDays, { period: lawPeriod }, lawLog) : null
    const fullDegree = degreeTable ? degreeDayPermille([{ from: yFrom, to: yTo }], degreeTable) : 0
    const degreeOf = (t: TenancyWithUnit, table: DegreeDayTable): number =>
      degreeDayPermille([{ from: t.start > yFrom ? t.start : yFrom, to: t.end !== null && t.end < yTo ? t.end : yTo }], table)
    const dayShare = (t: TenancyWithUnit): number => (degreeTable && fullDegree > 0 ? degreeOf(t, degreeTable) / fullDegree : t.days / diy)
    const partOfYear = (t: TenancyWithUnit) => (t.days >= diy ? ''
      : degreeTable ? ` · ${fmtNum(Math.round(degreeOf(t, degreeTable) * 10) / 10)} von ${fmtNum(Math.round(fullDegree * 10) / 10)} ‰ Gradtage`
        : ` · ${t.days}/${diy} Tage`)
    // Teilnehmer wirken bei den Schlüsseln, deren Basis aus Wohnungen entsteht (#94).
    const withParticipants = ['area', 'units', 'persons', 'meter', 'external', 'amounts'].includes(item.key)
    if (isNotAllocable(item.category)) {
      // keine Verteilung
    } else if (withParticipants && item.participantUnitIds && item.participantUnitIds.length === 0) {
      noBasis('keine Wohnung nimmt teil')
    } else if (item.key === 'area' && !(b.basisArea > 0)) {
      noBasis(b === fullBasis ? 'für keine Wohnung ist eine Wohnfläche hinterlegt' : 'für keine teilnehmende Wohnung ist eine Wohnfläche hinterlegt')
    } else if (item.key === 'units' && b.basisUnits.length === 0) {
      noBasis(b === fullBasis ? 'keine Wohnung gehört zur Abrechnungseinheit' : 'keine teilnehmende Wohnung gehört zur Abrechnungseinheit')
    } else if (item.key === 'persons' && !(b.occupantPersonDays > 0) && b.partTenancies.length > 0) {
      noBasis('für die vermieteten Wohnungen sind keine Personen hinterlegt')
    } else if (item.key === 'area' && b.basisArea > 0) {
      for (const t of b.partTenancies) {
        const raw = item.amountCents * ((t.unit.areaM2 || 0) / b.basisArea) * dayShare(t)
        targets.push({ t, raw, basisText: `${fmtNum(t.unit.areaM2 || 0)} von ${fmtNum(b.basisArea)} m²${partOfYear(t)}` })
      }
      selfRaw = item.amountCents * (b.selfArea / b.basisArea)
    } else if (item.key === 'units' && b.basisUnits.length > 0) {
      for (const t of b.partTenancies) {
        const raw = (item.amountCents / b.basisUnits.length) * dayShare(t)
        targets.push({ t, raw, basisText: `1 von ${b.basisUnits.length} Einheiten${partOfYear(t)}` })
      }
      selfRaw = (item.amountCents / b.basisUnits.length) * b.selfUnits.length
    } else if (item.key === 'persons' && b.basisPersonDays > 0) {
      for (const t of b.partTenancies) {
        const pd = personDaysInPeriod(t, yFrom, yTo)
        const raw = item.amountCents * (pd / b.basisPersonDays)
        // Der Leerstand steht im gedruckten Text dabei, sonst ginge die Summe der Personentage für
        // den Mieter nicht auf (#177).
        const vacancyNote = b.vacancyPersonDays > 0 ? ` (davon ${fmtNum(b.vacancyPersonDays)} Leerstand)` : ''
        targets.push({ t, raw, basisText: `${fmtNum(pd)} von ${fmtNum(b.basisPersonDays)} Personentagen${vacancyNote}` })
      }
      selfRaw = item.amountCents * (b.selfPersonDays / b.basisPersonDays)
    } else if (item.key === 'external') {
      // Laut Gemeinschaftsabrechnung (#94). Der Betrag ist der eigene Anteil, also das, was der
      // Vermieter laut Hausgeldabrechnung für seine Wohnungen zahlt; die Angaben der Gemeinschaft
      // stehen daneben für den Rechenweg und die Plausibilität. Verteilt wird innerhalb des
      // Objekts nach dem Wert jeder Wohnung im Maßstab der Gemeinschaft.
      const eb = item.externalBasis
      if (!eb || !(eb.total > 0)) {
        noBasis('die Angaben aus der Abrechnung der Gemeinschaft fehlen (Maßstab, Summe in der Anlage, Gesamtkosten)')
      } else {
        const valueOf = (u: SnapshotUnit): number =>
          eb.measure === 'mea' ? Math.max(0, Number(u.mea) || 0) : eb.measure === 'area' ? Math.max(0, u.areaM2 || 0) : 1
        const own = b.basisUnits.reduce((a, u) => a + valueOf(u), 0)
        if (!(own > 0)) {
          noBasis(eb.measure === 'mea' ? 'für die Wohnungen sind keine Miteigentumsanteile hinterlegt' : 'für die Wohnungen ist keine Wohnfläche hinterlegt')
        } else {
          // Eine Garage-artige Einheit ohne Fläche (#135) fehlt beim Maßstab Fläche nicht, sie hat
          // bewusst keine; bei Miteigentumsanteilen bleibt jede fehlende Angabe eine Lücke.
          const missing = b.basisUnits.filter((u) => valueOf(u) === 0 && !(eb.measure === 'area' && isGarageLike(u)))
          if (missing.length > 0) {
            warn('external.value-missing', `„${item.description}“: für ${andList(missing.map((u) => u.name))} ${eb.measure === 'mea' ? 'sind keine Miteigentumsanteile' : 'ist keine Wohnfläche'} hinterlegt — ihr Anteil verteilt sich auf die übrigen Wohnungen.`, unitSubject(missing))
          }
          // Ein Tippfehler in der Gesamtsumme soll auffallen, aber keine Zahl verschieben:
          // Gezahlt ist der eingetragene Betrag, und der wird verteilt.
          const expected = Math.round((eb.totalCents * own) / eb.total)
          if (Math.abs(expected - item.amountCents) > 100) {
            warn('external.amount-mismatch', `„${item.description}“: der Betrag ${fmtCents(item.amountCents)} passt nicht zum rechnerischen Anteil ${fmtCents(expected)} (${fmtNum(own)} von ${fmtNum(eb.total)} ${MEASURE_LABELS[eb.measure]} aus ${fmtCents(eb.totalCents)}) — bitte die Angaben aus der Gemeinschaftsabrechnung prüfen. Verteilt wird der eingetragene Betrag.`, itemSubject(item))
          }
          // „Kosten der Gemeinschaft“ und nicht „Gesamtkosten der Anlage“ (#144): Die Spalte
          // Gesamtkosten zeigt hier den Anteil des Vermieters, und zweimal „Gesamtkosten“ mit zwei
          // Zahlen war doppeldeutig. Weicht der Betrag ab, steht das auch im Druck; der Rechenweg
          // erscheint dort nicht, und der Mieter sähe sonst eine Rechnung, die nicht aufgeht.
          const applied = Math.abs(expected - item.amountCents) > 100 ? ' · angesetzt laut Hausgeldabrechnung' : ''
          const suffix = ` · Kosten der Gemeinschaft ${fmtCents(eb.totalCents)}${applied}`
          const label = MEASURE_LABELS[eb.measure]
          for (const t of b.partTenancies) {
            const raw = item.amountCents * (valueOf(t.unit) / own) * (t.days / diy)
            targets.push({
              t, raw,
              basisText: `${fmtNum(valueOf(t.unit))} von ${fmtNum(eb.total)} ${label}${suffix}${partOfYear(t)}`,
              community: {
                costsCents: eb.totalCents,
                share: `${fmtNum(own)} von ${fmtNum(eb.total)} ${label} × ${fmtCents(eb.totalCents)} = ${fmtCents(expected)}`,
                term: eb.measure === 'mea' ? 'mea' : 'distributionBasis',
                appliedCents: expected !== item.amountCents ? item.amountCents : null,
                ownShare: valueOf(t.unit) !== own ? `${fmtNum(valueOf(t.unit))} von ${fmtNum(own)} ${label}` : null,
              },
            })
          }
          selfRaw = item.amountCents * (b.selfUnits.reduce((a, u) => a + valueOf(u), 0) / own)
        }
      }
    } else if (item.key === 'amounts') {
      // Einzelbeträge je Mietverhältnis (#94), etwa vom Messdienst. Der teilt beim Nutzerwechsel
      // selbst auf, deshalb hier kein Tagesanteil: Der Anteil ist genau der Betrag. Den Rest
      // (Leerstand, Eigennutzung, Rundung des Messdienstes) trägt der Vermieter.
      const given = item.tenancyAmounts ?? {}
      // Beträge selbstgenutzter Wohnungen (#104): nur für Wohnungen, die im Jahr selbstgenutzt zur
      // Verteilbasis gehören; einer anderen Wohnung ein Eigenanteil wäre privat gebuchtes Geld,
      // das in Wahrheit abziehbar ist.
      const selfGiven = item.selfAmounts ?? {}
      const selfIds = new Set(b.selfUnits.map((u) => u.id))
      const selfSum = Object.entries(selfGiven).filter(([id]) => selfIds.has(id)).reduce((a, [, c]) => a + Math.max(0, c), 0)
      const sum = Object.values(given).reduce((a, c) => a + Math.max(0, c), 0) + selfSum
      if (sum > item.amountCents) {
        forced = 'noBasis'
        warn('amounts.exceed', `„${item.description}“: die Einzelbeträge ergeben zusammen ${fmtCents(sum)} und übersteigen den Rechnungsbetrag ${fmtCents(item.amountCents)} — es wird nichts verteilt, der Betrag geht an den Vermieter.`, itemSubject(item))
      } else {
        const inYear = new Map(b.partTenancies.map((t) => [t.id, t]))
        const forfeited = Object.entries(given).filter(([id, c]) => c > 0 && !inYear.has(id))
        if (forfeited.length > 0) {
          const betrag = forfeited.reduce((a, [, c]) => a + c, 0)
          warn('amounts.forfeited', `„${item.description}“: ${forfeited.length === 1 ? 'ein Einzelbetrag' : `${forfeited.length} Einzelbeträge`} über ${fmtCents(betrag)} gehör${forfeited.length === 1 ? 't' : 'en'} zu keinem Mietverhältnis dieses Jahres in der Abrechnungseinheit und entfall${forfeited.length === 1 ? 't' : 'en'} — dieser Teil geht an den Vermieter.`, itemSubject(item))
        }
        // Nur wer die Position wirklich trägt; bei Pauschale fehlt nichts (Befund der Durchsicht).
        const without = b.partTenancies.filter((t) => !Object.hasOwn(given, t.id) && bookable(t))
        if (without.length > 0) {
          warn('amounts.missing', `„${item.description}“: für ${andList(without.map((t) => `${t.tenantName} (${t.unit.name})`))} ist kein Einzelbetrag eingetragen — bitte prüfen, sonst tragen sie diese Position nicht.`, itemSubject(item))
        }
        // Beträge selbstgenutzter Wohnungen (#104) sind ihr Eigenanteil. Fehlt einer, steckt er im
        // Rest beim Vermieter und fehlt im privaten, nicht abziehbaren Teil der Steuerübersicht;
        // das sagt die Meldung unten.
        const selfForfeited = Object.entries(selfGiven).filter(([id, c]) => c > 0 && !selfIds.has(id))
        // Zwei Gründe, und die Meldung nennt den richtigen: Die Wohnung ist nicht selbstgenutzt, oder
        // sie ist es, nimmt aber an dieser Position nicht teil (Befund der Durchsicht).
        const selfOutsideParticipants = selfForfeited.filter(([id]) => selfUnits.some((u) => u.id === id))
        const selfNotSelfUsed = selfForfeited.filter(([id]) => !selfUnits.some((u) => u.id === id))
        const nameOf = (id: string) => unitById.get(id)?.name ?? 'eine gelöschte Wohnung'
        if (selfNotSelfUsed.length > 0) {
          warn('amounts.self-forfeited', `„${item.description}“: ein Eigenbetrag ist für ${andList(selfNotSelfUsed.map(([id]) => nameOf(id)))} eingetragen, die in diesem Jahr nicht selbstgenutzt ist — er zählt nicht als Eigenanteil und bleibt beim Vermieter.`, itemSubject(item))
        }
        if (selfOutsideParticipants.length > 0) {
          warn('amounts.self-forfeited', `„${item.description}“: ein Eigenbetrag ist für ${andList(selfOutsideParticipants.map(([id]) => nameOf(id)))} eingetragen, die an dieser Position nicht teilnimmt — er zählt nicht als Eigenanteil und bleibt beim Vermieter. Nehmen Sie die Wohnung als Teilnehmerin auf, wenn die Position sie betrifft.`, itemSubject(item))
        }
        selfRaw = selfSum
        // Vorwegabzug beim Messdienst (Heizung PR 6, #209, Entwurf 7.4): In der Position, in der L
        // steckt, ist L_self exakt Eigenanteil (privat), der Rest von L der abziehbare `co2Share`.
        const co2 = co2Deductions.get(item.id)
        if (co2) {
          selfRaw += co2.selfRaw
          co2ShareRaw = co2.landlordCents - co2.selfRaw
        }
        const selfWithout = b.selfUnits.filter((u) => !Object.hasOwn(selfGiven, u.id))
        if (selfWithout.length > 0) {
          warn('amounts.self-hidden', `„${item.description}“: der Anteil der ${plural(selfWithout.length, 'selbstgenutzten Wohnung', 'selbstgenutzten Wohnungen')} ${andList(selfWithout.map((u) => u.name))} ist bei Einzelbeträgen nicht eingetragen — er steckt im Vermieteranteil, und die Steuerübersicht nennt den privaten Anteil entsprechend zu niedrig.`, itemSubject(item))
        }
        for (const t of b.partTenancies) {
          const c = given[t.id]
          if (c === undefined || c <= 0) continue
          targets.push({ t, raw: c, basisText: 'laut Einzelabrechnung' })
        }
      }
    } else if (item.key === 'custom') {
      // Vereinbarter Schlüssel (§556a Abs. 1 Satz 1 BGB): feste Prozentanteile je Wohnung.
      // Die Anteile gelten absolut — summieren sie unter 100 %, bleibt der Rest beim
      // Vermieter. Bei Mieterwechsel wird der Anteil tagesanteilig geteilt.
      const pctOf = (unitId: string) => Number(item.customShares?.[unitId]) || 0
      const pctSum = basisUnits.reduce((a, u) => a + Math.max(0, pctOf(u.id)), 0)
      // Anteile für Wohnungen außerhalb der Abrechnungseinheit verfallen — gelöscht oder
      // auf „nicht beteiligt“ gestellt. Sonst würde der Betrag unbemerkt kleiner verteilt,
      // als vereinbart ist.
      const forfeited = Object.keys(item.customShares ?? {})
        .filter((id) => pctOf(id) > 0 && !basisUnits.some((u) => u.id === id))
        .map((id) => unitById.get(id)?.name ?? 'gelöschte Wohnung')
      if (forfeited.length > 0) {
        warn('custom.forfeited', `„${item.description}“: der vereinbarte Anteil für ${andList(forfeited)} entfällt — die Wohnung gehört nicht zur Abrechnungseinheit. Dieser Teil geht an den Vermieter.`, itemSubject(item))
      }
      if (pctSum <= 0) {
        forced = 'noBasis'
        warn('custom.none', `„${item.description}“: keine vereinbarten Anteile hinterlegt — Betrag geht an den Vermieter.`, itemSubject(item))
      } else if (pctSum > 100.0001) {
        // Nicht verteilen: mehr als die Rechnung hergibt wäre auch beim §35a-Anteil zu hoch.
        forced = 'noBasis'
        warn('custom.over-100', `„${item.description}“: die vereinbarten Anteile ergeben ${fmtNum(Math.round(pctSum * 100) / 100)} % — über 100 % wird nicht verteilt, der Betrag geht an den Vermieter.`, itemSubject(item))
      } else {
        for (const t of partTenancies) {
          const pct = pctOf(t.unitId)
          if (pct <= 0) continue
          const raw = item.amountCents * (pct / 100) * dayShare(t)
          targets.push({ t, raw, basisText: `${fmtNum(pct)} % vereinbart${partOfYear(t)}` })
        }
        selfRaw = selfUnits.reduce((a, u) => a + item.amountCents * (pctOf(u.id) / 100), 0)
        // Ein Anteil für eine Wohnung, die es gibt, die aber außerhalb liegt, ist dort vereinbart
        // und verfällt; einer für eine gelöschte Wohnung zählt zum Nicht-Vereinbarten (so steht er
        // auch nach dem Geraderücken da, das ihn streicht).
        const outsidePct = Object.keys(item.customShares ?? {})
          .filter((id) => pctOf(id) > 0 && unitById.has(id) && !basisUnits.some((u) => u.id === id))
          .reduce((a, id) => a + pctOf(id), 0)
        // Über 100 % zusammen mit den Wohnungen innerhalb verfällt nur, was bis 100 % fehlt; mehr
        // als den Betrag kann der Vermieter nicht tragen (#202, vorher an der Zerlegung begrenzt).
        const outsideCapped = Math.min(outsidePct, Math.max(0, 100 - pctSum))
        outsideRaw = item.amountCents * (outsideCapped / 100)
        customUnassignedRaw = item.amountCents * (Math.max(0, 100 - pctSum - outsideCapped) / 100)
      }
    } else if (item.key === 'meter') {
      // `item.meterType` ist optional (string | null | undefined); die Indizierung selbst
      // verhält sich für null/undefined wie für einen unbekannten Zählertyp (kein Treffer,
      // `data` bleibt undefined), deshalb hier nur eine Typ-Zusicherung, keine neue Prüfung.
      const data = b.consumptionByType[item.meterType as MeterType]
      if (!data || data.basis <= 0) {
        forced = 'noBasis'
        warn('meter.no-consumption', `„${item.description}“: kein Verbrauch für Zählertyp „${meterTypeLabel(item.meterType)}“ erfasst — Betrag geht an den Vermieter.`, itemSubject(item))
      } else {
        const type = item.meterType ?? '—'
        // Für die Zerlegung des Vermieteranteils (#142): Verbrauch der Zähler von Wohnungen
        // außerhalb der Abrechnungseinheit, und beim Hauptzähler, was keine Wohnung misst.
        const inBasis = new Set(b.basisUnits.map((u) => u.id))
        const yearOf = (m: SnapshotMeter) => consumptionInPeriod(readingsOf(m.id), yFrom, yTo)
        const measured = data.meters.reduce((a, m) => a + yearOf(m), 0)
        outsideRaw = item.amountCents * (data.meters.filter((m) => !inBasis.has(m.unitId)).reduce((a, m) => a + yearOf(m), 0) / data.basis)
        if (data.main !== null) mainRestRaw = item.amountCents * ((data.basis - measured) / data.basis)
        if (data.mainPartial) {
          // Der Tag vor dem Zeitraum und sein Ende (#208); im Kalenderjahr wortgleich wie bisher.
          const vorher = new Date(toUTC(yFrom) - MS_DAY).toISOString().slice(0, 10)
          const kalender = calendarYearPeriod(year)
          const ende = yFrom === kalender.from && yTo === kalender.to ? 'zum Jahresende' : 'zum Ende des Zeitraums'
          warn('meter.main-partial', `„${item.description}“: der Hauptzähler deckt ${label} nur ${data.mainPartial.days} von ${diy} Tagen ab — bitte Ablesungen zum ${fmtDay(vorher)} und ${ende} (${fmtDay(yTo)}) nachtragen. Bis dahin wird nach den Wohnungszählern verteilt.`, { kind: 'meter', id: data.mainPartial.meterId })
        }
        if (data.mainBelowUnits) {
          warn('meter.sub-exceeds-main', `„${item.description}“: die Wohnungszähler zeigen zusammen ${fmtMeter(data.mainBelowUnits.units)}, mehr als der Hauptzähler (${fmtMeter(data.mainBelowUnits.main)}) — bitte die Ablesungen prüfen. Verteilt wird nach den Wohnungszählern.`, itemSubject(item))
        }
        if (data.mainGap) {
          warn('meter.main-gap', `„${item.description}“: die Wohnungszähler erfassen zusammen nur ${fmtMeter(data.mainGap.units)} von ${fmtMeter(data.mainGap.main)} des Hauptzählers. Gehört der Rest zu einer Wohnung, die nicht angelegt ist (etwa Ihrer eigenen), legen Sie sie unter Stammdaten an; dann gilt für sie der Rest des Hauptzählers. Verteilt wird nach den Wohnungszählern.`, itemSubject(item))
        }
        if (data.main !== null && data.partial.length > 0) {
          warn('meter.unit-partial', `„${item.description}“: der Zähler von ${andList(data.partial.map((p) => `${p.unit.name} (${p.covered} von ${p.needed} Tagen)`))} deckt nicht die ganze Zeit ab, in der dort gewohnt wurde — der Verbrauch der Lücke steckt im Rest des Hauptzählers, der deshalb beim Vermieter bleibt und nicht als Eigenanteil gilt. Bitte die fehlenden Ablesungen nachtragen.`, unitSubject(data.partial.map((p) => p.unit)))
        }
        // Fehlt der Zähler nur bei selbstgenutzten Wohnungen, gibt es nichts zu melden; bleibt der
        // Rest wegen einer Lücke trotzdem beim Vermieter, sagt das die Meldung davor.
        const onlySelfUnmetered = data.main !== null && data.unmetered.every((u) => b.selfUnits.includes(u))
        if (data.unmetered.length > 0 && !onlySelfUnmetered) {
          const names = andList(data.unmetered.map((u) => u.name))
          // Eine Garage oder ein Stellplatz hat oft keinen Anschluss; dann nennt die Meldung den
          // Ausweg, die Kennzeichnung an der Einheit (#117).
          const noConnection = ' Hat eine dieser Einheiten keinen eigenen Anschluss (etwa eine Garage), entfernen Sie in den Stammdaten der Einheit unter „Weitere Angaben — Anschlüsse“ das Häkchen dieser Zählerart.'
          const text = data.main !== null
            ? `der Rest des Hauptzählers geht an den Vermieter, weil sich nicht bestimmen lässt, wie viel davon auf sie entfällt.${b.selfUnits.length > 0 ? ' Einen Eigenanteil weist Mietfuchs für diesen Rest deshalb nicht aus.' : ''}${noConnection}`
            : data.hasMain
              ? 'ihr Verbrauch lässt sich nicht bestimmen und steckt in den Anteilen der übrigen Wohnungen, bis der Hauptzähler verwendbar ist (siehe den Hinweis zum Hauptzähler).'
              : data.limited
                ? `ihr Verbrauch lässt sich nicht bestimmen und wird von den übrigen teilnehmenden Wohnungen mitgetragen. Bitte die Teilnehmer der Position prüfen.${noConnection}`
                : `ihr Verbrauch lässt sich nicht bestimmen und wird von den übrigen Wohnungen mitgetragen. Mit einem Hauptzähler (Zähler ohne Wohnung) gilt für sie der Rest des Hauptzählers.${noConnection}`
          warn('meter.unit-without-meter', `„${item.description}“: für ${names} gibt es keinen abgelesenen Zähler „${meterTypeLabel(type)}“ — ${text}`, unitSubject(data.unmetered))
        }
        selfRaw = item.amountCents * (data.selfConsumption / data.basis)
        for (const t of b.partTenancies) {
          const meters = data.meters.filter((m) => m.unitId === t.unitId)
          let c = 0
          for (const m of meters) {
            const readings = allReadings.filter((r) => r.meterId === m.id)
            const pFrom = t.start > yFrom ? t.start : yFrom
            const pTo = t.end && t.end < yTo ? t.end : yTo
            c += consumptionInPeriod(readings, pFrom, pTo)
          }
          const raw = item.amountCents * (c / data.basis)
          targets.push({ t, raw, basisText: `${fmtNum(Math.round(c * 100) / 100)} von ${fmtNum(Math.round(data.basis * 100) / 100)} (${data.main !== null ? 'Hauptzähler' : 'gemessen'})` })
        }
      }
    } else if (item.key === 'heatingSystem') {
      // Eigene Heizkostenabrechnung (Heizung PR 10, Entwurf 6.2, 8.6): je Nutzer der Rohwert Betrag ×
      // Gewicht des Ziels. Mieter sind Ziele (bei Pauschale oder Inklusivmiete nicht zugebucht, wie
      // überall), die Eigennutzung ist der Eigenanteil (exakt, nie über `take()`), eine Wohnung
      // außerhalb ein eigener Grund; der Leerstand bleibt als Rest (`vacancy`).
      const sp = item.heatingPlantId ? selfPlans.get(item.heatingPlantId) : undefined
      const target = item.heatingTarget ?? null
      const problem = sp ? targetProblem(sp.hotWater, item.heatingPart ?? null, target) : null
      if (!sp) {
        forced = 'noBasis'
        warn('heating.target-invalid',
          `„${item.description}“: Die Position wird nach der Heizkostenverordnung verteilt, gehört aber in ${label} zu keiner Heizanlage mit eigener Heizkostenabrechnung — Betrag geht an den Vermieter. Wählen Sie im Kostenformular die Heizanlage oder einen anderen Schlüssel.`,
          itemSubject(item))
      } else if (problem !== null || target === null) {
        forced = 'noBasis'
        warn('heating.target-invalid', `„${item.description}“: ${problem ?? 'Das Ziel fehlt'} — Betrag geht an den Vermieter.`, itemSubject(item))
      } else if (sp.weights === null) {
        // Die Anlage ist nicht verteilbar; der Fehler steht einmal je Anlage (Plan oben).
        forced = 'noBasis'
      } else {
        for (const u of sp.plan.units.flatMap((x) => x.users)) {
          const raw = item.amountCents * (sp.weights.get(u.key)?.[target] ?? 0)
          if (u.role === 'tenancy') {
            const t = tenancies.find((x) => x.id === u.tenancyId)
            if (t) targets.push({ t, raw, basisText: selfBasisText(sp, u.key, target), heating: selfSteps(sp, u.key, target) })
            else outsideRaw += raw
          } else if (u.role === 'self') {
            selfRaw += raw
          } else if (u.role === 'outside') {
            outsideRaw += raw
          }
        }
      }
    } else if (item.key === 'direct') {
      // `item.directUnitId` ist optional (string | null | undefined); Map.get() verhält sich
      // für null/undefined wie für eine unbekannte ID (kein Treffer), deshalb hier nur eine
      // Typ-Zusicherung, keine neue Prüfung.
      const target = unitById.get(item.directUnitId as string)
      if (!target) {
        forced = 'noBasis'
        warn('direct.unit-gone', `„${item.description}“: die direkt zugeordnete Wohnung gibt es nicht mehr — Betrag geht an den Vermieter.`, itemSubject(item))
      } else if (!target.participates && !target.selfUsed) {
        // Leerstand und Eigennutzung sind reguläre Fälle; eine Wohnung außerhalb der
        // Abrechnungseinheit ist dagegen ein Datenfehler.
        noBasis(`die direkt zugeordnete Wohnung ${target.name} gehört nicht zur Abrechnungseinheit`)
        forced = 'outsideUnit'
      }
      const toSelf = selfUnits.some((u) => u.id === item.directUnitId)
      for (const t of tenancies.filter((t) => t.unitId === item.directUnitId)) {
        // Ein Mietverhältnis ohne Abrechnung in der selbstgenutzten Wohnung zählt zur Eigennutzung,
        // wie vor #202, als der ganze Vermieteranteil dort als Eigenanteil stand.
        if (toSelf && !statements.has(t.id)) continue
        const raw = item.amountCents * dayShare(t)
        targets.push({ t, raw, basisText: `Direktzuordnung ${t.unit.name}${partOfYear(t)}` })
      }
      // Eigenanteil nur, soweit die Kosten nicht doch einem Mieter dieser Wohnung zufallen
      // (z. B. Mietverhältnis bis März, Eigennutzung ab April).
      // Seit #202 ist das der Betrag abzüglich der Mietverhältnisse dieser Wohnung mit Abrechnung;
      // vorher stand hier der ganze Betrag, und erst die Begrenzung am Vermieteranteil machte daraus
      // dasselbe.
      if (toSelf) {
        selfRaw = item.amountCents - targets.reduce((a, x) => a + x.raw, 0)
        if (selfRaw * item.amountCents < 0) selfRaw = 0
      }
    }
    // Die eine Verteilung (#202): Mieter und Gründe des Vermieters sind Empfänger derselben
    // Restverteilung (siehe `distributeCents`). Ein Mietverhältnis mit Pauschale oder Inklusivmiete
    // für diese Kostenart (#93) bleibt in der Verteilbasis, bekommt seinen Anteil aber nicht
    // zugebucht: Er fällt dem Vermieter zu, als abziehbare Kosten und nicht als Eigenanteil. Ebenso
    // ein Mietverhältnis in einer nicht beteiligten Wohnung (nur bei Direktzuordnung möglich), das
    // keine Abrechnung hat. Solche Anteile werden je Grund zu einer Zeile des Vermieters.
    // „Nur Heizung“ zeitanteilig (Heizung PR 10, `heating.change-split-time`): was die Gradtage ergäben.
    if (manualPlant && degreeTable === null && ['area', 'units', 'custom', 'direct'].includes(item.key)) {
      const table = law(hkvDegreeDays, { period: lawPeriod }, lawLog)
      const full = degreeDayPermille([{ from: yFrom, to: yTo }], table)
      for (const x of targets) {
        if (x.t.days >= diy || full <= 0) continue
        const byPlant = manualSplitTime.get(manualPlant.id) ?? new Map<string, { now: number, alt: number }>()
        const e = byPlant.get(x.t.id) ?? { now: 0, alt: 0 }
        e.now += x.raw
        e.alt += (x.raw * (degreeOf(x.t, table) / full)) / (x.t.days / diy)
        byPlant.set(x.t.id, e)
        manualSplitTime.set(manualPlant.id, byPlant)
      }
    }
    const booked = targets.map((x) => bookable(x.t))
    // Pauschale und Inklusivmiete bei der eigenen Heizkostenabrechnung (Entwurf 6.3): Den Betrag nach der
    // Verordnung nennt `heating.flat-rate`.
    if (item.key === 'heatingSystem') targets.forEach((x, i) => { if (!booked[i] && statements.has(x.t.id)) selfFlat.set(x.t.id, (selfFlat.get(x.t.id) ?? 0) + x.raw) })
    const tenantLines: Recipient[] = targets.flatMap((x, i) => (booked[i] ? [{ key: String(x.t.id), landlord: false, raw: x.raw }] : []))
    const recipients: Recipient[] = [
      ...tenantLines,
      ...landlordRecipients(item, {
        selfRaw,
        co2ShareRaw,
        notBooked: targets.flatMap((x, i) => booked[i] ? [] : [{ reason: statements.has(x.t.id) ? modelFor(x.t, item) : 'outsideUnit', raw: x.raw }]),
        outsideRaw,
        customUnassignedRaw,
        mainRestRaw,
        bookedRaw: tenantLines.reduce((a, l) => a + l.raw, 0),
      }),
    ]
    const cents = distributeCents(item.amountCents, recipients)
    // Die Zeile jedes Ziels; ein nicht zugebuchtes hat keine eigene.
    const lineOf = new Map<number, number>()
    {
      let k = 0
      targets.forEach((_, i) => { if (booked[i]) lineOf.set(i, k++) })
    }
    const shareOf = (i: number): number => { const k = lineOf.get(i); return k === undefined ? 0 : cents[k] }
    // §35a-Lohnanteil, mitverteilt in denselben Zeilen (siehe `distributeLaborCents`): Wer 55/365
    // der Rechnung trägt, trägt 55/365 des Lohnanteils (#180), ab- oder aufgerundet, nie mehr als
    // seinen Kostenanteil, und alle Zeilen zusammen, die des Vermieters eingeschlossen, genau den
    // Lohnanteil der Rechnung. Die kaufmännische Rundung ist eine Festlegung dieser Berechnung,
    // keine Vorgabe des §35a EStG. Die Kostenanteile selbst bleiben, wie sie sind.
    const labor = validLabor35aCents(item)
    let laborCents: number[] = recipients.map(() => 0)
    let laborExact: number[] = recipients.map(() => 0)
    if (labor === null) {
      warn('labor35a.invalid', `„${item.description}“: der §35a-Lohnanteil muss zwischen 0 und dem Rechnungsbetrag liegen — es wird kein Lohnanteil bescheinigt.`, itemSubject(item))
    } else if (labor > 0) {
      const d = distributeLaborCents(labor, item.amountCents, recipients, cents)
      laborCents = d.cents
      laborExact = d.exact
    }
    options.onAllocation?.({
      costItemId: item.id,
      amountCents: item.amountCents,
      laborCents: labor ?? 0,
      forced: forced !== null,
      lines: recipients.map((r, k) => ({ recipient: r.key, landlord: r.landlord, exact: cleanRaw(r.raw), cents: cents[k], laborExact: laborExact[k], laborCents: laborCents[k] })),
    })
    for (const o of carry ? [] : overlaps) {
      const e = overlapExtra(item, b, targets, booked, o)
      const side = item.amountCents < 0 ? 'credit' : 'cost'
      o.extra.first[side] += Math.abs(e.first)
      o.extra.second[side] += Math.abs(e.second)
    }
    let distributed = 0
    targets.forEach((x, i) => {
      const k = lineOf.get(i)
      if (k === undefined) return
      const st = statements.get(x.t.id)
      if (!st) return
      const share = cents[k]
      distributed += share
      const labor35a = laborCents[k]
      // Der Rechenweg (#114): dieselben Zahlen, aus denen die Zeile entstand, als Text. Der
      // Restcent wird bei der Zeile benannt, die von der gewöhnlichen Rundung abweicht; sonst sähe
      // der Mieter einen Cent, den ihm niemand erklärt. Das ist nicht immer die Zeile, die einen
      // Cent dazubekommt: Liegen die Reste über einem halben Cent, ist es die, die einen verliert.
      const c = x.community
      const steps: CalcStep[] = [
        c
          ? { label: 'Kosten der Gemeinschaft', value: fmtCents(c.costsCents), term: 'homeownersStatement' }
          : { label: 'Rechnungsbetrag', value: fmtCents(item.amountCents) },
        { label: 'Umlageschlüssel', value: KEY_LABELS[item.key] || item.key, term: 'allocationKey' },
      ]
      if (carry) steps.unshift(carry.step)
      if (c) {
        // Laut Gemeinschaftsabrechnung (#144): erst der Schritt der Gemeinschaft, dann die
        // Verteilung im Objekt. Die Verteilbasis der ganzen Anlage steht nicht noch einmal da.
        steps.push({ label: 'Anteil an der Gemeinschaft', value: c.share, term: c.term })
        if (c.appliedCents !== null) steps.push({ label: 'Angesetzt laut Hausgeldabrechnung', value: fmtCents(c.appliedCents), term: 'homeownersStatement' })
        if (c.ownShare) steps.push({ label: 'Anteil Ihrer Wohnung daran', value: c.ownShare, term: c.term })
        if (item.amountCents !== 0) {
          steps.push({ label: 'Rechnung', value: `${fmtCents(item.amountCents)} × ${fmtPercent((x.raw / item.amountCents) * 100)} % = ${fmtExactEuro(x.raw)}` })
        }
      } else if (item.key === 'amounts') {
        steps.push({ label: 'Einzelbetrag', value: `${fmtCents(Math.round(x.raw))} laut Einzelabrechnung`, term: 'individualAmounts' })
      } else if (x.heating) {
        // Eigene Heizkostenabrechnung (Heizung PR 10): der Weg über Grund- und Verbrauchskosten.
        steps.push(...x.heating)
        if (item.amountCents !== 0) {
          steps.push({ label: 'Rechnung', value: `${fmtCents(item.amountCents)} × ${fmtPercent((x.raw / item.amountCents) * 100)} % = ${fmtExactEuro(x.raw)}` })
        }
      } else {
        steps.push({ label: 'Anteil an der Verteilbasis', value: x.basisText, term: 'distributionBasis' })
        // Der Leerstand steckt in der Verteilbasis (#177); ohne diesen Schritt sähe der Mieter eine
        // Summe der Personentage, die größer ist als die der Bewohner, und niemand erklärte sie.
        if (item.key === 'persons' && b.vacancies.length > 0) {
          steps.push({ label: 'davon Leerstand', value: vacancyText(b.vacancies), term: 'vacancy' })
        }
        if (item.amountCents !== 0) {
          steps.push({ label: 'Rechnung', value: `${fmtCents(item.amountCents)} × ${fmtPercent((x.raw / item.amountCents) * 100)} % = ${fmtExactEuro(x.raw)}` })
        }
      }
      const exact = cleanRaw(x.raw)
      steps.push(share !== roundHalfAway(exact)
        ? { label: 'Ergebnis, auf Cent gerundet', value: `${fmtCents(share)} (Restcent-Verfahren: rechnerisch ${fmtExactEuro(x.raw)}; damit die Anteile zusammen genau den Rechnungsbetrag ergeben, weicht dieser Anteil um einen Cent von der gewöhnlichen Rundung ab)`, term: 'largestRemainder' }
        : { label: 'Ergebnis, auf Cent gerundet', value: fmtCents(share) })
      // Wie beim Kostenanteil: Weicht der Lohnanteil von der Rundung seines rechnerischen Werts ab,
      // steht der Grund dabei, auch wenn er dadurch 0 wird (M3 der Durchsicht von #201); sonst fehlte
      // dem Mieter ein Cent ohne Erklärung. Bei ganzer Lohnrechnung ist der Lohnanteil der
      // Kostenanteil, und dessen Restcent erklärt schon der Schritt davor.
      const laborRounded = roundHalfAway(laborExact[k])
      if (labor !== null && labor > 0 && labor !== item.amountCents && labor35a !== laborRounded) {
        const why = laborRounded > Math.max(0, share)
          ? 'ein Lohnanteil liegt nie über dem Kostenanteil, deshalb ist er auf diesen begrenzt'
          : `Restcent: damit die Lohnanteile zusammen genau den Lohnanteil der Rechnung ergeben, ist dieser einen Cent ${labor35a > laborRounded ? 'höher' : 'geringer'} als gewöhnlich gerundet`
        steps.push({ label: 'davon Lohnanteil nach § 35a EStG', value: `${fmtCents(labor35a)} (rechnerisch ${fmtExactEuro(laborExact[k])}; ${why})`, term: 'labor35a' })
      } else if (labor35a > 0) {
        steps.push({ label: 'davon Lohnanteil nach § 35a EStG', value: fmtCents(labor35a), term: 'labor35a' })
      }
      st.rows.push({
        costItemId: item.id,
        ...(carry ? { kind: 'fuelCarry' as const } : {}),
        category: item.category,
        description: item.description,
        totalCents: item.amountCents,
        key: item.key,
        keyLabel: KEY_LABELS[item.key] || item.key,
        basisText: x.basisText,
        shareCents: share,
        labor35aCents: labor35a,
        steps,
      })
      st.totalShareCents += share
      st.total35aCents += labor35a
    })
    // Heizung und Warmwasser ohne Verbrauchsanteil (#140): Die Verordnung verlangt 50 bis 70 % nach
    // Verbrauch (§ 7 Abs. 1, § 8 Abs. 1 HeizkostenV), sonst darf der Mieter seinen Anteil um 15 %
    // kürzen (§ 12 Abs. 1). Gerechnet wird wie erfasst, unterstützen und warnen statt verweigern
    // (#91); beziffert wird die Kürzung je Mieter, der über die Heizung eine Abrechnung bekommt.
    // Bei Pauschale und Warmmiete gibt es keine Abrechnung, die er kürzen könnte; das meldet
    // `heating.flat-rate`. Auf den Cent gerundet, kaufmännisch wie überall bei einer Einzelzahl.
    // Mieter, die über diese Heizposition abgerechnet werden. Auch eine Direktzuordnung zählt für
    // den Hinweis zur Fernablesbarkeit (#110), etwa ein Ergebnis des Messdienstes, das direkt bei
    // der vermieteten Wohnung eingetragen ist; Kürzungen nach § 12 Abs. 1 Satz 1 rechnet sie nicht.
    const heatingReceived = item.category === HEATING_CATEGORY && !carry
      ? targets.flatMap((x, i) => (booked[i] && statements.has(x.t.id) && shareOf(i) > 0 && !outsideHeating(x.t.unit) ? [{ x, share: shareOf(i) }] : []))
      : []
    if (heatingReceived.length > 0) heatingBilledItem ??= item
    if (item.category === HEATING_CATEGORY && item.key !== 'direct' && !carry) {
      const received = heatingReceived
      if (heatingByConsumption(item.key)) {
        // Gedeckt nur durch eine Position mit positivem Betrag, die wirklich nach Verbrauch verteilt
        // (letzte Durchsicht). Nach Zählern: Die Wohnung nimmt teil und hat einen Zähler des Typs,
        // der im Jahr abgelesen ist; ein Verbrauch von 0 ist dann gemessen und keine Lücke. Ohne
        // Ablesungen geht der Betrag an den Vermieter, das deckt nichts. Als Einzelbeträge: Für ein
        // Mietverhältnis der Wohnung ist ein Betrag eingetragen, auch 0. Sonst (Gemeinschaft): ein
        // positiver Anteil.
        if (item.amountCents > 0 && item.key === 'meter') {
          const readMeters = allMeters.filter((m) => m.unitId && m.type === item.meterType && coveredDays(readingsOf(m.id), yFrom, yTo) > 0)
          if (targets.length > 0) {
            for (const m of readMeters) if (m.unitId && (!item.participantUnitIds || item.participantUnitIds.includes(m.unitId))) heatingCovered.add(m.unitId)
          }
        } else if (item.amountCents > 0 && item.key === 'amounts') {
          const given = item.tenancyAmounts ?? {}
          for (const t of b.partTenancies) if (Object.hasOwn(given, t.id)) heatingCovered.add(t.unitId)
        } else if (item.amountCents > 0) {
          for (const { x } of received) heatingCovered.add(x.t.unitId)
        }
      } else {
        heatingCuts.push({
          item,
          rows: received.map(({ x, share }) => ({ unitId: x.t.unitId, label: `${x.t.tenantName} (${x.t.unit.name})`, share })),
        })
      }
    }
    // Die Überträge aus dem Vorrat (Heizung PR 8) gehören zu den Heizkosten, die der Mieter trägt: Die
    // Kürzung nach § 12 Abs. 1 HeizkostenV wird auf seinen Anteil samt Übertrag gerechnet (Durchsicht von
    // #237, M3); sie stehen bei der Position, deren Schlüssel sie folgen.
    if (carry && item.id.startsWith('stock:') && item.category === HEATING_CATEGORY) {
      const cutOf = heatingCuts.find((c) => c.item.id === carry.itemId)
      if (cutOf) {
        targets.forEach((x, i) => {
          if (!booked[i] || !statements.has(x.t.id) || outsideHeating(x.t.unit) || shareOf(i) === 0) return
          const row = cutOf.rows.find((r) => r.label === `${x.t.tenantName} (${x.t.unit.name})` && r.unitId === x.t.unitId)
          if (row) row.share += shareOf(i)
          else cutOf.rows.push({ unitId: x.t.unitId, label: `${x.t.tenantName} (${x.t.unit.name})`, share: shareOf(i) })
        })
      }
    }
    tenantCentsOf.set(item.id, distributed)
    if (item.category === HEATING_CATEGORY && item.key === 'direct') {
      exactByItem.set(item.id, new Map(targets.flatMap((x, i): [string, number][] => (booked[i] && statements.has(x.t.id) ? [[x.t.id, x.raw]] : []))))
    }
    const landlordCents = item.amountCents - distributed
    // Die Zeilen des Vermieters aus derselben Verteilung; zusammen ergeben sie genau den
    // Vermieteranteil. Der Eigenanteil ist genau die Zeile der Eigennutzung (#202), ohne eigenes
    // Runden und ohne Begrenzung: Er kann nicht über dem Vermieteranteil liegen und nicht das
    // Vorzeichen wechseln, eine Gutschrift senkt ihn ebenso (#129). Geht die Position aus einem
    // einzigen Grund ganz an den Vermieter, gilt dieser Grund und kein Eigenanteil.
    const parts: LandlordPart[] = recipients.flatMap((r, k) => (r.landlord && cents[k] !== 0 ? [{ reason: r.key as LandlordReason, cents: cents[k] }] : []))
    if (!forced) selfUsedShareCents += parts.find((p) => p.reason === 'selfUse')?.cents ?? 0
    // Vorwegabzug (Heizung PR 6, Durchsicht M-2): Reicht der Rest der Position nicht für den
    // CO₂-Anteil, kappt `take()` ihn. Mehr als den Rundungsspielraum heißt: L steckt in einer
    // anderen Messdienstposition. Geld wandert dadurch nicht (beides bleibt beim Vermieter), nur
    // der Grund stimmt nicht; der Hinweis führt zur Wahl der Position.
    const co2Deduction = co2Deductions.get(item.id)
    if (co2ShareRaw !== null && co2Deduction && !forced) {
      const capped = Math.round(co2ShareRaw) - (parts.find((p) => p.reason === 'co2Share')?.cents ?? 0)
      if (capped > co2Deduction.toleranceCents + 1) {
        warn('co2.share-capped',
          `„${item.description}“: Der Rest dieser Position nach den Einzelbeträgen reicht nicht für den CO₂-Anteil des Vermieters von ${fmtCents(co2Deduction.landlordCents)}; ${fmtCents(capped)} fehlen. ` +
            'Vermutlich steckt der Abzug in einer anderen Position des Messdienstes. Wählen Sie auf der Seite Heizkosten unter „Position mit dem CO₂-Anteil“ die Position, die die Zeile „Abzüglich CO₂-Kosten Vermieter“ enthält.',
          { kind: 'heatingCosts', id: item.heatingPlantId ?? '' })
      }
    }
    if (landlordCents !== 0) {
      landlordRows.push({
        costItemId: item.id,
        category: item.category,
        description: item.description,
        totalCents: item.amountCents,
        keyLabel: KEY_LABELS[item.key] || item.key,
        shareCents: landlordCents,
        landlordParts: forced ? [{ reason: forced, cents: landlordCents }] : parts,
      })
    }
  }

  // Die Gegenzeilen der Überträge beim Vermieter (Heizung PR 7).
  landlordRows.push(...fuelCounterRows)
  // Hinweise an einer Übertragszeile führen zur Position, deren Teil sie ist (Durchsicht M4).
  for (const n of notices) {
    if (n.subject?.kind !== 'costItem') continue
    const owner = fuelCarryOf.get(n.subject.id)?.itemId
    if (owner) n.subject = { kind: 'costItem', id: owner }
  }

  notices.splice(tvAt, 0, ...tvNotices())

  // ---------- Hinweise zu den Lieferungen (Heizung PR 7, Entwurf 3.2, 3.3, 8.2, 10.1) ----------
  for (const { plant, result } of fuelResults.values()) {
    const where = `${plant.name ? `Heizanlage „${plant.name}“` : 'Heizanlage'}, Heizperiode ${label}`
    const subject: NoticeSubject = { kind: 'heatingCosts', id: plant.id }
    const closedOf = (key: string) => fuel?.closed.find((c) => c.plantId === plant.id && c.period === key)
    const nameOf = (id: string): string => {
      const l = result.lines.find((x) => x.deliveryId === id)
      const d = fuel?.deliveries.find((x) => x.id === id)
      return d?.label || (l?.from && l.to ? formatDayRange(l.from, l.to) : 'Lieferung')
    }
    for (const line of result.lines) {
      if (!line.split) continue
      const name = `„${nameOf(line.deliveryId)}“${line.from && line.to ? ` (${formatDayRange(line.from, line.to)})` : ''}`
      if (line.method === 'degreeDays' || line.method === 'localDegreeDays') {
        const stichtag = line.to !== null && line.to > yTo ? yTo : dayBefore(yFrom)
        warn('fuel.share-by-degree-days',
          `${where}: ${name} reicht über die Heizperiode hinaus. Den Teil für ${label} (${fmtNum(Math.round(line.sharePermille * 100) / 100)} ‰ des Verbrauchs) bestimmt Mietfuchs nach ${line.method === 'localDegreeDays' ? 'den Gradtagzahlen Ihres Orts' : 'der Gradtagszahlentabelle'}. ` +
            'Umzulegen sind die Kosten des im Zeitraum verbrauchten Brennstoffs, nicht der bezahlten Rechnungen; eine Abrechnung nach diesem Leistungsprinzip darf auf einer sachgerechten Schätzung beruhen (BGH VIII ZR 156/11, Rn. 14). ' +
            'Für Gas in der Grundversorgung schreibt § 12 Abs. 2 GasGVV bei einer Preisänderung eine ähnliche Aufteilung nach Erfahrungswerten vor. ' +
            `Genauer sind ein Zählerstand des Versorgungszählers zum ${fmtDay(stichtag)} oder eine Zwischenrechnung des Versorgers.`,
          subject)
      }
      if (!line.fixedKnown) {
        warn('fuel.fixed-unknown',
          `${where}: Für ${name} ist kein fester Preisbestandteil eingetragen. Grund-, Leistungs-, Mess- und Verrechnungspreise hängen an der Zeit und werden nach Tagen geteilt; ohne Angabe teilt Mietfuchs die ganze Rechnung nach dem Verbrauch. ` +
            'Weist die Rechnung feste Bestandteile aus, tragen Sie ihre Summe bei der Lieferung ein.',
          subject)
      }
    }
    for (const g of result.gaps) {
      const zaehler = plant.energy === 'gas' ? 'den Gaszähler' : plant.energy === 'districtHeating' ? 'den Wärmezähler der Übergabestation' : 'den Stromzähler der Wärmepumpe'
      // Durchsicht von #233: Ein Zählerstand schließt die Lücke nicht, er macht nur die Aufteilung der
      // Folgerechnung genauer (Stufe 1 braucht Stände am Tag vor ihrem Beginn, an ihrem Ende und am
      // Stichtag).
      const zero = g.zeroInvoices ?? []
      const vorliegend = zero.length > 0
        ? `liegt nur ${zero.length === 1 ? 'die Rechnung' : 'die Rechnungen'} ${zero.map((z) => `„${z}“`).join(', ')} vor, deren Positionen zusammen 0 € ergeben; Mietfuchs behandelt ${zero.length === 1 ? 'sie' : 'sie'} als storniert`
        : 'liegt keine Rechnung vor'
      warn('fuel.uncovered',
        `${where}: Für ${formatDayRange(g.from, g.to)} (${g.days} ${g.days === 1 ? 'Tag' : 'Tage'}, ${fmtNum(Math.round(g.permille * 10) / 10)} ‰ der Gradtage) ${vorliegend}; diesen Teil verteilt Mietfuchs nicht. ` +
          'Tragen Sie die Folgerechnung auf der Seite Heizkosten als Lieferung ein, sobald sie da ist. ' +
          `Ein Zählerstand allein schließt die Lücke nicht, er macht die Aufteilung der Folgerechnung genauer: Lesen Sie ${zaehler} zum ${fmtDay(g.to)} ab und tragen Sie den Stand auf der Seite Zähler ein; nach Zählerstand teilt Mietfuchs, wenn auch Stände am Tag vor Beginn und am letzten Tag der Rechnung eingetragen sind.`,
        subject)
    }
    if (result.looseWithoutRange) {
      warn('fuel.loose-item',
        `${where}: Neben der Lücke steht eine Heizposition dieser Anlage ohne Lieferung und ohne Leistungszeitraum. Ist die Rechnung schon als Position erfasst? Verknüpfen Sie sie auf der Seite Heizkosten mit ihrer Lieferung oder tragen Sie bei der Position den Leistungszeitraum ein. ` +
          'Bis dahin schlägt Mietfuchs keine Schätzung vor, damit dieselbe Rechnung nicht zweimal verteilt wird.',
        subject)
    }
    for (const z of result.zeroInvoices) {
      warn('fuel.zero-invoice',
        `${where}: Die Positionen der Rechnung „${z.label}“ ergeben zusammen 0 €. Mietfuchs behandelt sie als storniert und rechnet ihren Zeitraum als nicht abgedeckt. ` +
          'Ist es eine echte Rechnung über 0 € (etwa Kosten und eine gleich hohe Gutschrift), ist für diesen Zeitraum nichts zu verteilen: Schätzen Sie ihn dann nicht, sondern wählen Sie beim Abschließen „Ohne Schätzung abschließen“. ' +
          'Ist sie storniert, tragen Sie die neue Rechnung als Lieferung ein, sobald sie da ist.',
        subject)
    }
    for (const u of result.estimatesWithoutTemplate) {
      warn('fuel.estimate-undistributed',
        `${where}: Die Schätzung „${nameOf(u.deliveryId)}“ (${fmtCents(u.cents)}) verteilt Mietfuchs nicht: Es gibt keine Rechnung mit Positionen über mehr oder weniger als 0 €, deren Umlageschlüssel sie übernehmen könnte. ` +
          'Verknüpfen Sie eine Rechnung dieser Heizanlage mit ihrer Position oder entfernen Sie die Schätzung auf der Seite Heizkosten.',
        subject)
    }
    const undistributed = new Set(result.estimatesWithoutTemplate.map((u) => u.deliveryId))
    for (const line of result.lines.filter((l) => l.estimated && !undistributed.has(l.deliveryId))) {
      warn('fuel.estimated',
        `${where}: Die Brennstoffkosten vom ${fmtDay(line.from ?? yFrom)} bis ${fmtDay(line.to ?? yTo)} sind geschätzt (${fmtCents(line.inPeriodCents ?? line.amountCents ?? 0)}), weil die Rechnung des Versorgers noch nicht vorliegt. Eine Nachberechnung bleibt vorbehalten. ` +
          `${line.label ? `Grundlage: ${line.label}. ` : ''}Ob eine noch fehlende Versorgerrechnung so geschätzt werden darf, ist höchstrichterlich nicht entschieden; die Abrechnung nennt die Grundlage der Schätzung im Block „Brennstoff“.`,
        subject)
    }
    for (const u of result.ownerClosedUnlinked) {
      const owner = closedOf(u.owner.key)
      warn('fuel.owner-closed-unlinked',
        `${where}: Zur Rechnung „${nameOf(u.deliveryId)}“ gehörten heute ${fmtCents(u.cents)} in diese Heizperiode. Die Abrechnung ${owner?.label ?? periodLabel(u.owner)}, in der die Rechnung steht, ist abgeschlossen; ihre Position war beim Abschluss noch nicht mit der Lieferung verknüpft, deshalb ist die Rechnung dort ganz verteilt und hier kommt nichts dazu. ` +
          'Soll dieser Teil hierher, öffnen Sie jene Abrechnung wieder und schließen sie neu ab.',
        subject)
    }
    for (const carry of result.carries) {
      if (carry.kind === 'in' && carry.cancelled !== undefined) {
        warn('fuel.cancelled-after-close',
          `${where}: Die Rechnung „${nameOf(carry.deliveryId)}“ ist storniert oder auf 0 € gesetzt. Die abgeschlossene Abrechnung ${closedOf(carry.other.key)?.label ?? periodLabel(carry.other)}, in der sie steht, ` +
            (carry.cancelledOut !== undefined && carry.cancelledOut !== carry.cancelled
              ? `enthält dafür ${fmtCents(carry.cancelled)}, die die Mieter zu viel getragen haben; ${fmtCents(carry.cancelledOut)} hatte sie als Anteil dieser Heizperiode hinausgebucht, hier wird davon nichts mehr verteilt. `
              : `hat ${fmtCents(carry.cancelled)} als Anteil dieser Heizperiode hinausgebucht; hier wird davon nichts mehr verteilt, und die Mieter jener Abrechnung haben ihren Teil der Rechnung zu viel getragen. `) +
            'Öffnen Sie sie wieder und schließen Sie neu ab; ' +
            '§ 556 Abs. 3 Satz 3 BGB schließt nach Ablauf der Frist nur eine Nachforderung durch den Vermieter aus, eine Berichtigung zugunsten der Mieter hindert er nicht.',
          subject)
        continue
      }
      if (carry.kind !== 'out') continue
      const other = closedOf(carry.other.key)
      if (!other) continue
      if (carry.cancelled !== undefined) {
        warn('fuel.cancelled-after-close',
          `${where}: Die Rechnung „${nameOf(carry.deliveryId)}“ ist storniert oder auf 0 € gesetzt. Die abgeschlossene Abrechnung ${other.label} enthält dafür ${fmtCents(carry.cancelled)}, die die Mieter zu viel getragen haben. Öffnen Sie sie wieder und schließen Sie neu ab; ` +
            '§ 556 Abs. 3 Satz 3 BGB schließt nach Ablauf der Frist nur eine Nachforderung durch den Vermieter aus, eine Berichtigung zugunsten der Mieter hindert er nicht. Bis dahin steht der Betrag bei Ihnen.',
          subject)
        continue
      }
      const X = -carry.cents
      const name = `„${nameOf(carry.deliveryId)}“`
      if (carry.landlord.some((p) => p.reason === 'fuelClosedPeriod')) {
        // Zwei Lagen (Nachprüfung, M-b): ohne Schätzung abgeschlossen, oder abgeschlossen, als die
        // Lieferung noch keine Position hatte (mit 0 eingefroren).
        const lead = carry.zeroFrozen
          ? `Als die Abrechnung ${other.label} abgeschlossen wurde, war die Rechnung ${name} noch mit keiner Position verknüpft. Ihr Teil für ${periodLabel(carry.other)} (${fmtCents(X)}) ist dort deshalb nicht verteilt; bis Sie ihn nachfordern, steht er bei Ihnen. `
          : `Der Teil der Rechnung ${name} für ${periodLabel(carry.other)} (${fmtCents(X)}) gehört in die Abrechnung ${other.label}, die ohne Schätzung abgeschlossen wurde; bis Sie ihn nachfordern, steht er bei Ihnen. `
        warn('fuel.closed-period-part',
          `${where}: ${lead}` +
            `Solange die Frist dieser Abrechnung läuft (Zugang bis ${fmtDay(other.deadline)}), können Sie sie wieder öffnen und berichtigen. Danach dürfen Sie nur nachfordern, wenn Sie die Verspätung nicht zu vertreten haben (§ 556 Abs. 3 Satz 3 BGB, BGH VIII ZR 264/12), und dann alsbald, in der Regel binnen drei Monaten nach Wegfall des Hindernisses (BGH VIII ZR 220/05); lag die Rechnung schon vor Ablauf der Frist vor, ist die Verspätung in der Regel zu vertreten.`,
          subject)
        continue
      }
      const diff = carry.landlord.find((p) => p.reason === 'fuelEstimateDiff')?.cents ?? 0
      if (!carry.estimate || diff === 0) continue
      const E = carry.estimate.cents
      if (diff > 0) {
        // § 556 Abs. 3 Satz 2 und 3 BGB: Vor Fristablauf ist eine Berichtigung möglich (Umkehrschluss
        // aus BGH VIII ZR 115/04); danach nur ohne Vertretenmüssen (BGH VIII ZR 264/12) und alsbald
        // (BGH VIII ZR 220/05). Ohne Stichtag (`asOf`) gilt die Frist als offen.
        const past = options.asOf !== undefined && options.asOf > other.deadline
        warn('fuel.estimate-settled',
          `${where}: Die Rechnung ${name} ist da. Für ${periodLabel(carry.other)} war ${fmtCents(E)} geschätzt; tatsächlich entfallen ${fmtCents(X)}. Die Differenz von ${fmtCents(diff)} steht bei Ihnen. ` +
            (past
              ? `Die Frist der Abrechnung ${other.label} ist am ${fmtDay(other.deadline)} abgelaufen. Nachfordern dürfen Sie nur, wenn Sie die Verspätung nicht zu vertreten haben (§ 556 Abs. 3 Satz 3 BGB, BGH VIII ZR 264/12), und dann alsbald, in der Regel binnen drei Monaten nach Wegfall des Hindernisses (BGH VIII ZR 220/05). Lag die Rechnung schon vor Ablauf der Frist vor, ist die Verspätung in der Regel zu vertreten.`
              : `Nachfordern können Sie mit einer berichtigten Abrechnung ${other.label}; sie muss den Mietern bis ${fmtDay(other.deadline)} zugehen (§ 556 Abs. 3 Satz 2 und 3 BGB). Öffnen Sie die Abrechnung dafür wieder.`),
          subject)
      } else {
        // Zu hoch geschätzt (A4, B9): Ein Rückzahlungsanspruch folgt daraus nicht sicher (Einwendungsfrist,
        // § 556 Abs. 3 Satz 5 und 6 BGB); eine Gutschrift ist jederzeit zulässig. Je Mieter im Verhältnis
        // seiner Übertragszeilen der Schätzung im eingefrorenen Stand.
        const factor = E !== 0 ? -diff / E : 0
        const byTenant = new Map<string, { name: string; cents: number }>()
        for (const row of other.fuelRows) {
          if (!carry.estimate.ids.some((id) => row.costItemId.startsWith(`fuel:${id}:`))) continue
          const entry = byTenant.get(row.tenancyId) ?? { name: `${row.tenantName} (${row.unitName})`, cents: 0 }
          entry.cents += row.shareCents
          byTenant.set(row.tenancyId, entry)
        }
        const list = [...byTenant.values()].map((e) => `${e.name} ${fmtCents(Math.round(e.cents * factor))}`)
        warn('fuel.estimate-overcharged',
          `${where}: Für ${periodLabel(carry.other)} war ${fmtCents(E)} geschätzt; tatsächlich entfallen nur ${fmtCents(X)}. Die Mieter dieser Heizperiode haben ${fmtCents(-diff)} zu viel getragen${list.length > 0 ? `, hier: ${andList(list)}` : ''}. ` +
            `Eine Gutschrift ist jederzeit zulässig und wird empfohlen. Öffnen Sie die Abrechnung ${other.label} wieder oder erfassen Sie die Gutschrift; bis dahin steht der Betrag bei Ihnen als Abweichung von der Schätzung.`,
          subject)
      }
    }
  }

  // ---------- CO₂ und Warmwasser je Heizanlage (Heizung PR 6, #97, #209, #211) ----------
  // Je Anlage und Heizperiode: die Probe der Angaben, beim reinen Ausweis die Abzugszeilen, die
  // Hinweise mit ihren Kürzungen und die Bewertung für den Druckblock. Die Zerlegung beim
  // Vorwegabzug ist in der Verteilung oben geschehen (`co2Deductions`). Gerechnet wird mit den
  // gedruckten Zeilen, deshalb erst hier und vor der Fernablesbarkeit, deren 3 % ebenfalls auf die
  // Zeilen nach dem Abzug gehen (Entwurf 6.5).
  const heatingStatements: HeatingStatement[] = []
  // Wird jemand über diese Heizkosten abgerechnet, hat also eine Zeile aus ihnen? Bei Pauschale und
  // Warmmiete gibt es keine Heizkostenabrechnung, die der Mieter kürzen könnte (Entwurf 15.1 Nr. 15).
  // Gefragt wird je Topf und nicht je Abrechnung (Durchsicht M-1): Eine Anlage, die nur
  // Pauschalmieter versorgt, bekommt keinen Hinweis, nur weil eine andere abgerechnet wird.
  const settledOn = (ids: ReadonlySet<string>): boolean => [...statements.values()].some((x) => x.rows.some((r) => ids.has(r.costItemId)))
  // Die Kürzung je Mieter auf seine gedruckten Zeilen eines Topfs, nach der Abzugszeile, kaufmännisch
  // gerundet (Entwurf 6.5). Mietfuchs zieht nichts ab; erklären muss die Kürzung der Mieter.
  const cutsOn = (ids: ReadonlySet<string>, pct: number): string => {
    const list = [...statements.values()].flatMap((st) => {
      const sum = st.rows.filter((r) => ids.has(r.costItemId)).reduce((a, r) => a + r.shareCents, 0)
      return sum > 0 ? [`${st.tenantName} (${st.unitName}) ${fmtCents(Math.round((sum * pct) / 100))}`] : []
    })
    return list.length > 0 ? `, hier: ${andList(list)}` : ''
  }
  // Die Messdienstbeträge je Mieter im Topf, wie sie gedruckt sind (x beim reinen Ausweis, 7.5).
  const sharesOf = (pot: Co2Pot): ReliefShare[] => {
    const service = new Set(pot.serviceItems.map((c) => c.id))
    return [...statements.values()].flatMap((st) => {
      const cents = st.rows.filter((r) => service.has(r.costItemId)).reduce((a, r) => a + r.shareCents, 0)
      return cents > 0 ? [{ tenancyId: st.tenancyId, cents }] : []
    })
  }
  // Bucht die Abzugszeilen eines Topfs (PR 6 beim reinen Ausweis, PR 7 bei der eigenen Aufteilung):
  // R = round(Σ r) als eine Verteilung gerundet, je Mieter eine Zeile −r, beim Vermieter `co2Share` R.
  // L − R entfällt auf Eigennutzung, Leerstand, Pauschale und Wohnungen außerhalb, deren Anteil der
  // Vermieter ohnehin trägt. Gibt R zurück.
  const bookReliefs = (
    pot: Co2Pot,
    raws: readonly { tenancyId: string; raw: number; approximated: boolean }[],
    shares: readonly ReliefShare[],
    printed: Map<string, { cents: number; approximated: boolean }>,
    text: { basis: (x: { approximated: boolean }) => string; steps: (x: { tenancyId: string; raw: number; approximated: boolean }, cents: number, share: number) => CalcStep[] },
  ): number => {
    const total = Math.round(raws.reduce((a, x) => a + x.raw, 0))
    const cents = distributeCents(total, raws.map((x) => ({ key: x.tenancyId, landlord: false, raw: x.raw })))
    raws.forEach((x, k) => {
      const c = cents[k] ?? 0
      const target = statements.get(x.tenancyId)
      if (c === 0 || !target) return
      const share = shares.find((y) => y.tenancyId === x.tenancyId)?.cents ?? 0
      target.rows.push({
        costItemId: pot.reliefKey,
        kind: 'co2Relief',
        category: HEATING_CATEGORY,
        description: CO2_RELIEF_LABEL,
        totalCents: -total,
        keyLabel: 'CO₂-Kostenaufteilung',
        basisText: text.basis(x),
        shareCents: -c,
        labor35aCents: 0,
        steps: text.steps(x, c, share),
      })
      target.totalShareCents -= c
      printed.set(x.tenancyId, { cents: c, approximated: x.approximated })
    })
    if (total !== 0) {
      landlordRows.push({
        costItemId: pot.reliefKey, category: HEATING_CATEGORY, description: CO2_RELIEF_LABEL, totalCents: total,
        keyLabel: 'CO₂-Kostenaufteilung', shareCents: total, landlordParts: [{ reason: 'co2Share', cents: total }],
      })
    }
    return total
  }
  // Was das Gesetz verlangt, in einem Satz für alle Hinweise ohne Angaben.
  const co2Duty = (lead: string) =>
    `${lead} zwischen Ihnen und den Mietern aufzuteilen (§ 5 CO2KostAufG), und die Heizkostenabrechnung muss den Anteil der Mieter, ` +
    'die Einstufung des Gebäudes und die Berechnungsgrundlagen ausweisen (§ 7 Abs. 3 CO2KostAufG).'
  // Durchsicht M6: Auch wenn die Abrechnung nicht aufteilt, gehört der Anteil des Vermieters nicht zu
  // den Kosten der Mieter (§ 5 Abs. 2: die Aufteilung richtet sich nach der Stufe; § 6 Abs. 1:
  // eine Vereinbarung über mehr ist unwirksam).
  const CO2_NOT_ON_TENANTS = 'Ihren Anteil an den CO₂-Kosten dürfen Sie auch dann nicht auf die Mieter umlegen (§ 5 Abs. 2, § 6 Abs. 1 CO2KostAufG).'
  // Was der Vermieter tun kann, je nach Abrechnungsweg der Anlage.
  const nextStep = (pot: Co2Pot): string =>
    pot.method !== 'service'
      ? 'Tragen Sie auf der Seite Heizkosten die Rechnungen Ihres Versorgers als Lieferungen ein; dann teilt Mietfuchs die CO₂-Kosten selbst auf.'
      : `Tragen Sie auf der Seite Heizkosten die CO₂-Angaben aus der Abrechnung ${pot.source === 'homeowners' ? 'der Gemeinschaft' : 'des Messdienstes'} ein.`
  // Je Wohnung einer Etagenheizung die Zahlen für Einstufung und Abzug (Heizung PR 9, Entwurf 9.2,
  // 9.3 F8). Ausstoß und CO₂-Kosten stammen aus der Abgrenzung der Lieferungen (PR 7), Zeile für Zeile
  // der Rechnungen dieser Wohnung; A_u sind die Beträge ihrer Heizpositionen samt Überträgen, x_t die
  // exakten Anteile daran.
  const perUnitFuelOf = (pot: Co2Pot, lines: readonly FuelDeliveryLine[]): PerUnitFuel[] => {
    const unitOfDelivery = new Map((snapshot.fuel?.deliveries ?? []).filter((d) => d.plantId === pot.plantId).map((d) => [d.id, d.unitId ?? null]))
    const unitIds = [...new Set([
      ...pot.items.flatMap((c) => (c.key === 'direct' && c.directUnitId ? [c.directUnitId] : [])),
      ...lines.flatMap((l) => { const u = unitOfDelivery.get(l.deliveryId); return u ? [u] : [] }),
    ])]
    return unitIds.map((unitId): PerUnitFuel => {
      const u = unitById.get(unitId)
      const own = lines.filter((l) => unitOfDelivery.get(l.deliveryId) === unitId)
      const mine = pot.items.filter((c) => c.key === 'direct' && c.directUnitId === unitId)
      const shares = new Map<string, number>()
      for (const c of mine) for (const [t, x] of exactByItem.get(c.id) ?? []) shares.set(t, (shares.get(t) ?? 0) + x)
      return {
        unitId,
        rented: u?.participates === true,
        delivered: own.some((l) => l.sharePermille > 0),
        areaM2: u?.areaM2 ?? 0,
        emissionsKg: own.reduce((a, l) => a + (l.emissionsKg ?? 0), 0),
        co2Cents: own.reduce((a, l) => a + (l.co2Cents ?? 0), 0),
        fuelCents: mine.reduce((a, c) => a + c.amountCents, 0),
        shares: [...shares].map(([tenancyId, exact]) => ({ tenancyId, exact })),
      }
    })
  }
  // Was die eigene Aufteilung eines Topfs liest, aus den Lieferungen (PR 7) oder aus dem Vorrat (PR 8).
  // Vor der Schleife, denn nach einem Kesseltausch braucht der Topf der einen Anlage den Ausstoß der
  // anderen (Heizung PR 9).
  const ownOf = (pot: Co2Pot): OwnFuel | null => {
    const fuelOf = fuelResults.get(pot.plantId)?.result
    const stockEntry = stockOfPlant.get(pot.plantId)
    const stockFigures: FuelFigures | null = !stockEntry
      ? null
      : stockEntry.result.ok
        ? fuelFromStock(stockEntry.result.statement)
        : pot.method === 'manual'
          ? fuelFromDeliveries(stockEntry.last, stockCountedAt)
          : null
    return isStockEnergy(pot.energy)
      ? stockFigures === null ? null : {
        emissionsKg: stockFigures.emissionsKg, co2Cents: stockFigures.co2Cents, serviceCo2Cents: stockFigures.co2Cents,
        serviceGrossCents: stockFigures.grossCents, missingCo2: stockFigures.missing, coveragePermille: 1000, stock: stockEntry?.result.ok ?? false,
      }
      : fuelOf === undefined ? null : {
        emissionsKg: fuelOf.emissionsKg, co2Cents: fuelOf.co2Cents, serviceCo2Cents: fuelOf.serviceCo2Cents,
        serviceGrossCents: fuelOf.serviceGrossCents, missingCo2: fuelOf.missingCo2, coveragePermille: fuelOf.coveragePermille, stock: false,
      }
  }
  // Was eine Anlage zur Einstufung des Gebäudes beiträgt (Heizung PR 9): ihr Ausstoß in der Heizperiode und
  // die Wohnungen, deren Fläche zählt. Bei freien Schlüsseln aus Lieferungen oder Vorrat, bei einer
  // Etagenheizung nur die vermieteten Wohnungen mit Rechnung (§ 5 Abs. 1 Satz 2), beim Messdienst aus
  // seinen CO₂-Angaben. `null`: Mietfuchs kennt den Ausstoß nicht.
  const servedUnitsOf = (plant: SnapshotHeatingPlant | undefined): Map<string, number> =>
    new Map(snapshot.units.filter((u) => plant !== undefined && servesUnit(plant, u) && isDwelling(u)).map((u) => [u.id, u.areaM2]))
  const contributionOf = (q: Co2Pot): { kg: number | null; units: Map<string, number> } => {
    const plant = plants.find((p) => p.id === q.plantId)
    // Heizung PR 10: die eigene Heizkostenabrechnung wie freie Schlüssel.
    if (q.method === 'service' && q.statement?.method !== 'selfAfterService') return { kg: q.statement?.serviceEmissionsKg ?? null, units: servedUnitsOf(plant) }
    if (plant?.supply === 'perUnit') {
      const counted = perUnitFuelOf(q, fuelResults.get(q.plantId)?.result.lines ?? []).filter((u) => u.rented && u.delivered)
      return { kg: counted.length > 0 ? counted.reduce((a, u) => a + u.emissionsKg, 0) : null, units: new Map(counted.map((u) => [u.unitId, u.areaM2])) }
    }
    return { kg: ownOf(q)?.emissionsKg ?? null, units: servedUnitsOf(plant) }
  }
  // Die Anlagen, mit denen eine Anlage gemeinsam eingestuft wird (Heizung PR 9): die ihrer Linie von
  // Täuschen (§ 5 Abs. 1 Satz 1 CO2KostAufG: der Ausstoß „des Gebäudes … pro Quadratmeter Wohnfläche und
  // Jahr“) und die, die nach Angabe des Vermieters im selben Gebäude stehen (Satz 2 Halbsatz 2: „deren
  // Gesamtwohnfläche“), soweit sie in dieser Heizperiode heizen.
  // Die eingetragene Fläche der Einstufung einer Anlage (9.2): bei freien Schlüsseln im Datensatz `self`
  // (Heizung PR 7; der Topf führt ihn nicht, denn er kennt nur Angaben laut Messdienst), nach Weg
  // „selbst nach Messdienst“ in dessen Angaben. `null`: keine eingetragen.
  const enteredAreaOf = (q: Co2Pot): number | null => {
    if (q.statement?.method === 'selfAfterService') return q.statement.areaM2 ?? null
    if (q.method === 'service') return null
    return (snapshot.co2Statements ?? []).find((x) => x.plantId === q.plantId && x.period === q.period.key && x.method === 'self')?.areaM2 ?? null
  }
  // Die Fläche mehrerer Anlagen eines Gebäudes (Nachprüfung von #238, I-A): je Linie von Täuschen die
  // eingetragene Fläche einer ihrer Anlagen, sonst die Wohnfläche ihrer Wohnungen; jede Wohnung zählt einmal.
  const jointAreaOf = (members: readonly { pot: Co2Pot; units: ReadonlyMap<string, number> }[]): number => {
    const lines = new Map<string, { entered: number | null; units: Map<string, number> }>()
    for (const m of members) {
      const plant = plants.find((p) => p.id === m.pot.plantId)
      const root = plant ? lineRoot(plant, plants) : m.pot.plantId
      const line = lines.get(root) ?? { entered: null, units: new Map<string, number>() }
      line.entered ??= enteredAreaOf(m.pot)
      for (const [u, a] of m.units) line.units.set(u, a)
      lines.set(root, line)
    }
    // Die Wohnungen verschiedener Linien sind verschieden (guardPlantsOfProperty); innerhalb einer Linie
    // zählt jede einmal (Map).
    let total = 0
    for (const line of lines.values()) total += line.entered ?? [...line.units.values()].reduce((a, v) => a + v, 0)
    return total
  }
  const partnersOf = (pot: Co2Pot): { pot: Co2Pot; line: boolean }[] => {
    const mine = plants.find((p) => p.id === pot.plantId)
    if (!mine) return []
    return co2Pots.flatMap((other) => {
      const plant = plants.find((p) => p.id === other.plantId)
      if (!plant || other === pot || !activeIn(plant)) return []
      const line = sameLine(mine, plant, plants)
      return line || sameBuilding(mine, plant, plants) ? [{ pot: other, line }] : []
    })
  }
  for (const pot of co2Pots) {
    // Ohne Positionen kein Topf, außer die Anlage hat Lieferungen (Heizung PR 7): Dann gehört ihre
    // Bewertung samt Lücken in die Abrechnung.
    if (pot.items.length === 0 && !fuelResults.has(pot.plantId) && !(stockOfPlant.get(pot.plantId)?.result.ok ?? false)) continue
    const st = pot.statement
    const hPeriod = { from: pot.period.from, to: pot.period.to }
    const where = `${pot.plantName ? `Heizanlage „${pot.plantName}“` : 'Heizanlage'}, Heizperiode ${periodLabel(pot.period)}`
    const ids = new Set<string>([...pot.items.map((c) => c.id), pot.reliefKey])
    const plantSubject: NoticeSubject = { kind: 'heatingCosts', id: pot.plantId }
    const report: HeatingStatement = { plantId: pot.plantId, plantName: pot.plantName, energy: pot.energy, period: pot.period.key, from: pot.period.from, to: pot.period.to, co2: null }
    heatingStatements.push(report)
    // Lieferungen, Abgrenzung, Überträge und Lücken dieser Heizperiode (Heizung PR 7).
    const fuelOf = fuelResults.get(pot.plantId)?.result
    if (fuelOf) {
      report.fuel = {
        coveragePermille: fuelOf.coveragePermille, emissionsKg: fuelOf.emissionsKg, co2Cents: fuelOf.co2Cents, deliveries: fuelOf.lines,
        carries: fuelOf.carries.map((c) => ({ deliveryId: c.deliveryId, period: c.other.key, cents: c.cents, ...(c.kind === 'out' && c.cancelled === undefined ? { totalCents: c.totalCents } : {}) })), gaps: fuelOf.gaps,
      }
    }
    const settledHere = settledOn(ids)
    // Die Bestandsrechnung im Ausweis (Entwurf 9.5) und im abgeschlossenen Stand (G-A4); dazu die
    // Hinweise zum Altbestand vor 2023 (D-H6) und zur Peilung (8.2, wie 3.5). Heizung PR 8.
    const stocked = stockOfPlant.get(pot.plantId)
    if (stocked?.result.ok) {
      const sr = stocked.result.statement
      report.stock = sr
      if (CO2_FUELS.includes(pot.energy) && sr.oldStockKg > 0 && law(co2ApplicableFrom, { period: hPeriod }, lawLog)) {
        warn('fuel.before-2023',
          `${where}: ${fmtKg(sr.oldStockKg)} kg CO₂ des verbrauchten Brennstoffs stammen aus Brennstoff, der vor dem ${fmtDay(co2CostsCountedFrom())} in Rechnung gestellt wurde. ` +
            'Diese kg zählen für die Einstufung des Gebäudes, denn sie sind im Abrechnungszeitraum ausgestoßen (§ 7 Abs. 1 Satz 1, § 5 Abs. 1 CO2KostAufG); CO₂-Kosten trägt dieser Brennstoff nicht (§ 11 Abs. 2 Satz 2 CO2KostAufG). Die Stufe kann deshalb höher liegen, als die CO₂-Kosten allein vermuten lassen.',
          plantSubject)
      }
      const off = measuredOffset(stocked.last)
      if (off && sr.closingMeasuredOn) {
        const permille = degreeDayPermille([off.range], law(hkvDegreeDays, { period: hPeriod }, lawLog))
        const one = off.deliveries.length === 1
        const names = andList(off.deliveries.map((d) => `„${d.label}“`))
        const deliveryText = off.deliveries.length === 0
          ? ''
          : off.after
            ? ` ${names} ${one ? 'ist' : 'sind'} im gepeilten Endbestand schon enthalten, obwohl ${one ? 'sie' : 'sie alle'} zur nächsten Heizperiode ${one ? 'gehört' : 'gehören'}; ziehen Sie ${one ? 'ihre Menge' : 'ihre Mengen'} vom gepeilten Wert ab.`
            : ` ${names} nach der Peilung ${one ? 'ist' : 'sind'} im gepeilten Endbestand nicht enthalten und ${one ? 'zählt' : 'zählen'} in dieser Heizperiode als verbraucht; ändern Sie den Endbestand, wenn Sie zum Ende neu gepeilt haben.`
        warn('fuel.stock-date-differs',
          `${where}: Der Tank wurde am ${fmtDay(sr.closingMeasuredOn)} gepeilt, die Heizperiode ${off.after ? 'endete' : 'endet'} am ${fmtDay(pot.period.to)}: ${off.days} Tage, ${fmtPermille(permille)} ‰ der Gradtage dazwischen. Mietfuchs rechnet mit dem Wert wie gepeilt.${deliveryText}`,
          plantSubject)
      }
    }
    // Wärme aus dem Emissionshandel bei einem Anschluss nach dem Stichtag (§ 2 Abs. 4 Satz 2
    // CO2KostAufG, Heizung PR 7): Das Gesetz gilt nicht; der Stichtag steht im Rechtsstand.
    const potPlant = plants.find((x) => x.id === pot.plantId)
    // Etagenheizung auf Vertrag des Vermieters (Recht I4 der Durchsicht von #238): Die Heizkostenverordnung
    // gilt nicht, und für die Umlage der Gaskosten nennt die Betriebskostenverordnung keine Nummer; das sagt
    // die Abrechnung, statt eine Grundlage zu behaupten.
    if (potPlant?.supply === 'perUnit' && settledHere) {
      warn('heating.per-unit-basis',
        `${where}: Für Etagenheizungen gilt die Heizkostenverordnung nicht; sie regelt nur zentrale Anlagen und die Wärmelieferung (§ 1 Abs. 1 HeizkostenV). ` +
          'Die Betriebskostenverordnung nennt bei Etagenheizungen nur die Kosten der Reinigung und Wartung (§ 2 Nr. 4 Buchstabe d BetrKV). Ob Sie die Gaskosten selbst umlegen dürfen, wenn der Gasvertrag auf Sie läuft, ist nicht geklärt; ' +
          'umgelegt werden dürfen Betriebskosten nur, wenn der Mietvertrag es vereinbart (§ 556 Abs. 1 Satz 1 BGB). Prüfen Sie Ihren Mietvertrag, im Zweifel mit Ihrem Haus- und Grundbesitzerverein.',
        plantSubject)
    }
    let etsExempt = false
    if (pot.energy === 'districtHeating' && potPlant?.districtEtsNew === true) {
      const ets = law(co2DistrictEtsNew, { period: hPeriod }, lawLog)
      etsExempt = true
      // Der Satz für die Abrechnung (Durchsicht von #233): warum hier nichts aufgeteilt wird.
      if (settledHere) {
        warn('co2.district-ets-exempt',
          `${where}: Die Wärme stammt nach Ihrer Angabe aus einer Anlage im Europäischen Emissionshandel, und das Gebäude wurde erstmals nach dem ${fmtDay(ets.connectedAfter)} an das Wärmenetz angeschlossen. Die CO₂-Kosten werden deshalb nicht aufgeteilt (§ 2 Abs. 4 Satz 2 CO2KostAufG).`,
          plantSubject)
      }
    }
    const applicable = !etsExempt && (st !== null || settledHere) && law(co2ApplicableFrom, { period: hPeriod }, lawLog)
    // Eigene Aufteilung (Heizung PR 7, Entwurf 7.6, 9): bei freien Schlüsseln aus den Lieferungen dieser
    // Heizperiode, beim Messdienst ohne Aufteilung aus den Rechnungen, die er angesetzt hat.
    // Nur für Brennstoffe, für die es Standardwerte nach § 7 Abs. 4 BEHG gibt (§ 2 Abs. 1 CO2KostAufG):
    // Gas, Heizöl, Flüssiggas, Kohle; Fernwärme nur, wenn die Rechnung CO₂-Kosten ausweist. Strom einer
    // Wärmepumpe ist kein solcher Brennstoff (Durchsicht von #233, C1).
    const co2Relevant = CO2_FUELS.includes(pot.energy) || (pot.energy === 'districtHeating' && (fuelOf?.lines.some((l) => l.co2Cents !== null) ?? false))
    // Vorratsenergien (Heizung PR 8, Entwurf 8.2, Naht N1): E und C des verbrauchten Brennstoffs aus der
    // Bestandsrechnung. Bei freien Schlüsseln ohne Bestand wie geliefert (mit `fuel.manual-by-delivery`);
    // beim Messdienst ohne Aufteilung wird ohne Bestand nicht aufgeteilt (G-B4).
    const stockEntry = stockOfPlant.get(pot.plantId)
    // Was die eigene Aufteilung liest, aus den Lieferungen (PR 7) oder aus dem Vorrat (PR 8).
    const own = ownOf(pot)
    const ownSplit = applicable && co2Relevant && own !== null && pot.items.length > 0 && (isStockEnergy(pot.energy)
      // Heizung PR 10 (N13): bei freien Schlüsseln und bei der eigenen Heizkostenabrechnung teilt Mietfuchs selbst auf.
      ? pot.method !== 'service' || st?.method === 'selfAfterService'
      : (pot.method !== 'service' && (fuelOf?.lines.length ?? 0) > 0) || (st?.method === 'selfAfterService' && own.serviceCo2Cents !== null))
    // Messdienst ohne Aufteilung mit erfasstem Vorrat, der fehlt oder nicht aufgeht: Die Kürzung meldet
    // `fuel.stock-missing` bzw. `fuel.stock-invalid` statt `co2.service-unsplit`, nie beide.
    const stockHandled = stockEntry !== undefined && stockTouched(stockEntry.chain)
    if (stockEntry && stockHandled && !stockEntry.result.ok && pot.method === 'service' && applicable && co2Relevant && settledHere) {
      const cut = law(co2CutMissing, { period: hPeriod }, lawLog)
      const problem = stockEntry.result.problem
      const tail = ` Ohne Aufteilung darf jeder Mieter seinen Anteil an den Heizkosten um ${cut} % kürzen (§ 7 Abs. 4 CO2KostAufG)${cutsOn(ids, cut)}.`
      if (problem.kind === 'missing') {
        warn('fuel.stock-missing',
          `${where}: ${problemText(problem)} Ohne Bestandsrechnung teilt Mietfuchs die CO₂-Kosten nicht selbst auf, denn aufzuteilen sind die Kosten des im Abrechnungszeitraum verursachten Ausstoßes (§ 7 Abs. 1 CO2KostAufG), also des verbrauchten und nicht des gelieferten Brennstoffs.${tail} ` +
            'Tragen Sie Anfangs- und Endbestand auf der Seite Heizkosten in der Karte „Vorrat“ ein; die Abrechnung des Messdienstes nennt beide.',
          plantSubject)
      } else {
        warn('fuel.stock-invalid',
          `${where}: ${problemText(problem)} Bis das geklärt ist, teilt Mietfuchs die CO₂-Kosten nicht auf.${tail} Bitte prüfen Sie den Vorrat und die Lieferungen auf der Seite Heizkosten.`,
          plantSubject)
      }
    }
    if (st && applicable && !ownSplit) {
      const ranges = stageRanges(law(co2StageTable, { period: hPeriod }, lawLog), tableFactor(pot.period))
      // § 8 und § 9 nach den Angaben zum Gebäude (Durchsicht von #233, Recht I4): Die Nachstufung erwartet
      // den angepassten Anteil, wie die eigene Aufteilung ihn rechnet (`selfSplit`).
      const factsRestriction = potPlant?.restriction ?? 'none'
      const factsNonResidential = potPlant?.nonResidential === true ? law(co2NonResidential, { period: hPeriod }, lawLog) : null
      const factsCut = factsRestriction === 'none' ? null : law(co2Restriction, { period: hPeriod }, lawLog)
      const adjust = (permille: number): number => {
        const base = factsNonResidential ?? permille
        if (!factsCut) return base
        return factsRestriction === 'both' ? (factsCut.bothSplit ? base * factsCut.factor : 0) : base * factsCut.factor
      }
      const re = restage(st, ranges, law(co2RoundingDecimals, { period: hPeriod }, lawLog), adjust)
      const S = st.serviceUsersTotalCents ?? 0
      const L = st.serviceLandlordCents ?? 0
      let booked = false
      const printed = new Map<string, { cents: number; approximated: boolean }>()
      if (pot.probe) {
        for (const c of pot.foreign) {
          warn('co2.pool-foreign-item',
            `${where}: „${c.description}“ gehört zur Heizanlage, ist aber keine Position mit Einzelbeträgen des Messdienstes. Die Probe der CO₂-Angaben zählt sie nicht mit; verteilt wird sie wie bisher nach ihrem Schlüssel. ` +
              'Eine Gutschrift des Versorgers oder eine Wartung darf so daneben stehen. Gehört sie zu den Kosten, die der Messdienst verteilt hat, übernehmen Sie sie als Einzelbeträge.',
            itemSubject(c))
        }
        // Ein geschätztes S weitet nur den Spielraum der Probe; geht sie trotzdem nicht auf, ist das
        // derselbe Fehler wie mit gedrucktem S, und gebucht wird nichts (Durchsicht I-2). Ein
        // sichtbarer Fehler ist besser als ein Anteil, der still zweimal privat steht.
        // Laienprobe B20: ohne Formelbuchstaben, mit den Namen der Positionen und der Rechnung in Worten.
        const approxText = st.serviceUsersTotalApprox ? ' Die Summe der Kosten aller Nutzer ist geschätzt als Summe der Einzelbeträge aller Nutzeinheiten; dafür gilt der Rundungsspielraum auch für den Betrag.' : ''
        if (!pot.probe.ok && settledHere) {
          const names = andList(pot.serviceItems.map((c) => `„${c.description}“`))
          const lines = `${pot.serviceItems.length === 1 ? 'Ihre Position' : 'Ihre Positionen'} ${names} ${pot.serviceItems.length === 1 ? 'hat' : 'haben zusammen'} ${fmtCents(pot.probe.itemsCents)}. ` +
            `Mit Abzugszeile muss der Betrag die Summe der Kosten aller Nutzer (${fmtCents(S)}) plus den CO₂-Anteil des Vermieters (${fmtCents(L)}) sein, also ${fmtCents(S + L)}; ohne Abzugszeile genau die Summe der Kosten aller Nutzer, ${fmtCents(S)}.`
          const entered = pot.probe.enteredOk
            ? ''
            : ` Die eingetragenen Einzel- und Eigenbeträge ergeben zusammen ${fmtCents(pot.probe.enteredCents)}, mehr als die Summe der Kosten aller Nutzer und der Rundungsspielraum von ${fmtCents(pot.probe.toleranceCents)}; steht der CO₂-Anteil Ihrer Wohnung schon im Eigenbetrag, tragen Sie dort nur den Betrag der Abrechnung ein.`
          const cut = law(co2CutMissing, { period: hPeriod }, lawLog)
          warn('co2.sum-check',
            `${where}: Die Probe der CO₂-Angaben geht nicht auf.${approxText} ${lines}${entered} Bis das geklärt ist, bucht Mietfuchs keine CO₂-Aufteilung, und die Mieter tragen ihre Einzelbeträge wie eingetragen. ` +
              (st.method === 'serviceShown'
                ? `Stimmt Ihre Antwort, dass die Abrechnung die CO₂-Kosten nur ausweist, tragen die Mieter auch den CO₂-Anteil des Vermieters von ${fmtCents(L)} mit; den dürfen Sie nicht auf sie umlegen, eine Vereinbarung, nach der der Mieter mehr als seinen Anteil trägt, ist unwirksam (§ 5 Abs. 2, § 6 Abs. 1 CO2KostAufG). `
                : '') +
              `Fehlt die Aufteilung auch in der Abrechnung des Messdienstes, die die Mieter bekommen, darf jeder Mieter seinen Anteil an den Heizkosten um ${cut} % kürzen (§ 7 Abs. 4 CO2KostAufG)${cutsOn(ids, cut)}. ` +
              'Prüfen Sie den Betrag der Position (bezahlt, also vor „Abzüglich CO₂-Kosten Vermieter“) und Ihre Antwort auf die Frage nach der Abzugszeile.',
            plantSubject)
        } else if (pot.probe.ok && st.serviceUsersTotalApprox) {
          warn('co2.sum-check-approx',
            `${where}:${approxText} Die Probe geht in diesem Spielraum auf, und Mietfuchs bucht die CO₂-Aufteilung. Bitte prüfen Sie die Beträge der leeren oder nicht eingetragenen Einheiten.`,
            plantSubject)
        }
        booked = pot.probe.ok
        // Nur ausgewiesen (Entwurf 7.5): Abzugszeilen je Mieter, mit den Werten laut Messdienst oder
        // nach dem Anteil an den Messdienstbeträgen (9.4). R = round(Σ r) wird als eine Verteilung
        // gerundet; der Vermieter trägt R als `co2Share`. L − R entfällt auf Eigennutzung, Leerstand,
        // Pauschale und Wohnungen außerhalb, deren Beträge der Vermieter ohnehin trägt.
        if (booked && st.method === 'serviceShown') {
          const shares = sharesOf(pot)
          const reliefs = shownReliefs(L, S, shares, st.reliefs)
          const nameOf = (id: string): string => {
            const x = statements.get(id)
            return x ? `${x.tenantName} (${x.unitName})` : (snapshot.tenancies.find((t) => t.id === id)?.tenantName ?? 'ein Mietverhältnis')
          }
          bookReliefs(pot, reliefs.raws, shares, printed, {
            basis: (x) => (x.approximated ? 'nach Ihrem Anteil an den Heizkosten' : 'laut Abrechnung des Messdienstes'),
            steps: (x, c, share) => [
              { label: 'CO₂-Anteil des Vermieters laut Abrechnung', value: fmtCents(L), term: 'co2Split' },
              x.approximated
                ? { label: 'Ihr Teil davon', value: `${fmtCents(L)} × ${fmtCents(share)} ÷ ${fmtCents(S)} = ${fmtExactEuro(x.raw)}` }
                : { label: 'Ihr Teil davon', value: `${fmtCents(c)} laut Abrechnung des Messdienstes` },
              { label: 'Ergebnis, auf Cent gerundet', value: fmtCents(-c) },
            ],
          })
          if (reliefs.problem && settledHere) {
            const p = reliefs.problem
            const why = p.kind === 'sum'
              ? `Die eingetragenen Beträge „vom Vermieter übernommen“ ergeben zusammen ${fmtCents(p.givenCents)} und damit mehr als den CO₂-Anteil des Vermieters von ${fmtCents(L)}.`
              : `Für ${nameOf(p.tenancyId)} ist „vom Vermieter übernommen“ ${fmtCents(p.givenCents)} eingetragen, ${p.shareCents > 0 ? `mehr als die Heizkosten von ${fmtCents(p.shareCents)}` : 'aber in dieser Heizperiode kein Einzelbetrag'}.`
            warn('co2.reliefs-invalid',
              `${where}: ${why} Mietfuchs rechnet deshalb für alle Mieter nach ihrem Anteil an den Heizkosten (${fmtCents(L)} × Betrag des Mieters ÷ ${fmtCents(S)}). Bitte prüfen Sie die Beträge auf der Seite Heizkosten.`,
              plantSubject)
          }
          if (reliefs.missing.length > 0 && settledHere) {
            const list = reliefs.missing.map((id) => `${nameOf(id)} ${fmtCents(printed.get(id)?.cents ?? 0)}`)
            warn('co2.reliefs-missing',
              `${where}: Für ${andList(reliefs.missing.map(nameOf))} fehlt der Betrag „vom Vermieter übernommen“. Mietfuchs ergänzt ihn nach dem Anteil an den Heizkosten (${andList(list)}); ` +
                'steht er in der Abrechnung, tragen Sie ihn auf der Seite Heizkosten ein.',
              plantSubject)
          }
        }
        // Die Lücke „Nein, obwohl abgezogen, und Betrag = S“ sieht die Probe nicht (7.4). Liegen die
        // Brennstoffkosten der Abrechnung (G) genau um L über den verteilten (V), spricht das für
        // einen Vorwegabzug; dann würden die Mieter doppelt entlastet.
        const G = st.serviceFuelGrossCents
        const V = st.serviceFuelNetCents
        if (settledHere && st.method === 'serviceShown' && L > 0 && G !== null && V !== null && Math.abs(G - V - L) <= L_TOLERANCE_CENTS) {
          warn('co2.probably-deducted',
            `${where}: Sie haben angegeben, dass die Abrechnung die CO₂-Kosten nur ausweist. Die Brennstoffkosten der Abrechnung (${fmtCents(G)}) liegen aber genau um den CO₂-Anteil des Vermieters (${fmtCents(L)}) über den verteilten Brennstoffkosten (${fmtCents(V)}); ` +
              'das spricht für einen Vorwegabzug. Dann würden die Mieter doppelt entlastet: einmal in der Kostenaufstellung und einmal mit der eigenen Zeile. ' +
              'Prüfen Sie, ob die Kostenaufstellung eine Zeile „Abzüglich CO₂-Kosten Vermieter“ enthält.',
            plantSubject)
        }
      }
      const deduction = pot.carrierId === null ? undefined : co2Deductions.get(pot.carrierId)
      const service = st.method === 'serviceDeducted' || st.method === 'serviceShown'
      report.co2 = co2Assessment(st, re, {
        booked,
        ranges,
        shortened: pot.period.short,
        deduction,
        tenants: service ? co2TenantLines(st, sharesOf(pot), printed) : [],
      })
      if (settledHere && !service && !stockHandled) {
        // Der Messdienst hat nicht aufgeteilt (Entwurf 7.6). Ohne die Brennstoffrechnung als
        // Lieferung, vom Messdienst angesetzt (Heizung PR 7), ist die Kürzung sicher.
        const cut = law(co2CutMissing, { period: hPeriod }, lawLog)
        warn('co2.service-unsplit',
          `${where}: Der Messdienst hat die CO₂-Kosten nicht zwischen Ihnen und den Mietern aufgeteilt. Das Gesetz verlangt die Aufteilung und ihren Ausweis in der Heizkostenabrechnung (§§ 5, 7 Abs. 3 CO2KostAufG); ` +
            `ohne sie darf jeder Mieter seinen Anteil an den Heizkosten um ${cut} % kürzen (§ 7 Abs. 4 CO2KostAufG)${cutsOn(ids, cut)}. ` +
            `${CO2_NOT_ON_TENANTS} Bitten Sie den Messdienst um eine Abrechnung mit CO₂-Aufteilung; dafür braucht er die CO₂-Angaben Ihrer Brennstoffrechnung. Oder tragen Sie die Rechnung des Versorgers auf der Seite Heizkosten als Lieferung ein; dann teilt Mietfuchs selbst auf.`,
          plantSubject)
      }
      if (settledHere && service && booked) {
        const gaps = ausweisGaps(st)
        if (gaps.length > 0) {
          const cut = law(co2CutMissing, { period: hPeriod }, lawLog)
          warn('co2.incomplete',
            `${where}: Für den Ausweis der CO₂-Aufteilung fehlen ${andList(gaps)}. Die Heizkostenabrechnung muss den Anteil der Mieter, die Einstufung des Gebäudes und die Berechnungsgrundlagen ausweisen (§ 7 Abs. 3 CO2KostAufG); ` +
              `fehlen sie auch in der Abrechnung des Messdienstes, darf jeder Mieter seinen Anteil an den Heizkosten um ${cut} % kürzen (§ 7 Abs. 4 CO2KostAufG)${cutsOn(ids, cut)}. Stehen sie in der Abrechnung des Messdienstes, legen Sie diese den Mietern bei; tragen Sie die Angaben außerdem auf der Seite Heizkosten nach.`,
            plantSubject)
        }
      }
      // Nachstufung (Entwurf 9.2): Passt der Anteil laut Messdienst nicht zur Stufe des Werts, oder L
      // nicht zu C · ‰, ein Hinweis ohne Rechtsfolge.
      if (settledHere && service && re.value !== null && re.stage !== null && st.serviceLandlordPermille !== null && (re.percentOk === false || re.sumOk === false)) {
        const laut = fmtNum(st.serviceLandlordPermille / 10)
        const facts = [factsNonResidential !== null ? '§ 8' : null, factsCut ? '§ 9' : null].filter((x) => x !== null)
        const stufe = re.percentOk === false
          ? ` Nach der Stufentabelle des CO2KostAufG gehört dieser Wert zu ${fmtNum(re.stage.landlordPercent)} %.` +
            (facts.length > 0 ? ` Nach Ihren Angaben zum Gebäude (${andList(facts)} CO2KostAufG) gehören dazu ${fmtNum(adjust(re.stage.landlordPercent * 10) / 10)} %.` : '')
          : ''
        const summe = re.sumOk === false && st.serviceTotalCents !== null ? ` ${fmtCents(L)} sind nicht ${laut} % von ${fmtCents(st.serviceTotalCents)}.` : ''
        warn('co2.stage-mismatch',
          `${where}: Laut Abrechnung liegt der Ausstoß bei ${fmtNum(re.value)} kg CO₂ je m² und der Anteil des Vermieters bei ${laut} %.${stufe}${summe} ` +
            'Eine Abweichung kann berechtigt sein, etwa bei einem Gebäude, das überwiegend nicht zum Wohnen dient (§ 8 CO2KostAufG), oder bei Einschränkungen nach § 9 CO2KostAufG; auf diese kann sich der Vermieter nur berufen, wenn er dem Mieter die Umstände nachweist (§ 9 Abs. 3 CO2KostAufG). Bitte prüfen Sie die Angaben.',
          plantSubject)
      }
    }
    // Ohne Angaben (Entwurf 9.1): Gas, Öl, Flüssiggas und Kohle sind erfasst, Fernwärme nur, wenn der
    // Lieferant CO₂ ausweist (R-A28), Wärmepumpe, Strom, Holz und Pellets nicht (W8); unbekannt ist
    // „Sonstiges“.
    // Eine Anlage, die in diesem Zeitraum nicht heizt (Kesseltausch), steht hier nur mit der Rechnung, die in
    // einen anderen Zeitraum abgegrenzt wird; dort gilt der Hinweis, nicht hier (Nachprüfung von #238).
    if (!st && applicable && settledHere && !ownSplit && (!potPlant || activeIn(potPlant))) {
      if (CO2_FUELS.includes(pot.energy) || pot.energy === 'districtHeating') {
        const cut = law(co2CutMissing, { period: hPeriod }, lawLog)
        warn('co2.missing',
          `${where}: ${co2Duty(pot.energy === 'districtHeating' ? 'Weist Ihr Wärmelieferant CO₂-Kosten aus, sind sie' : 'Bei Gas, Heizöl, Flüssiggas und Kohle sind die CO₂-Kosten')} ` +
            `Für diese Heizperiode kennt Mietfuchs keine CO₂-Angaben. Fehlen sie auch in der Heizkostenabrechnung, darf jeder Mieter seinen Anteil an den Heizkosten um ${cut} % kürzen (§ 7 Abs. 4 CO2KostAufG)${cutsOn(ids, cut)}. ${CO2_NOT_ON_TENANTS} ${nextStep(pot)}`,
          plantSubject)
      } else if (pot.energy === 'other') {
        const cut = law(co2CutMissing, { period: hPeriod }, lawLog)
        warn('co2.fuel-unknown',
          `${where}: Mietfuchs weiß nicht, womit diese Anlage heizt. ${co2Duty('Heizt sie mit Gas, Heizöl, Flüssiggas oder Kohle oder weist Ihr Wärmelieferant CO₂-Kosten aus, sind die CO₂-Kosten')} ` +
            `Fehlt das, darf jeder Mieter seinen Anteil an den Heizkosten um ${cut} % kürzen (§ 7 Abs. 4 CO2KostAufG)${cutsOn(ids, cut)}. Tragen Sie unter Stammdaten bei der Heizung den Energieträger ein.`,
          plantSubject)
      }
    }
    if (ownSplit && own) {
      const afterService = st?.method === 'selfAfterService'
      // Etagenheizung (Heizung PR 9, Entwurf 9.2 Nr. 1, § 5 Abs. 1 Satz 2 CO2KostAufG): Einstufung über
      // die vermieteten Wohnungen mit Lieferung, eine eingetragene Fläche geht vor; C sind deren CO₂-Kosten.
      const perUnit = potPlant?.supply === 'perUnit' && !afterService ? perUnitFuelOf(pot, fuelOf?.lines ?? []) : null
      const classified = perUnit ? perUnitClassification(perUnit) : null
      const C = classified ? classified.co2Cents : (afterService ? own.serviceCo2Cents : own.co2Cents) ?? 0
      // Gemeinsame Einstufung (Heizung PR 9): nach einem Kesseltausch über die Anlagen der Linie, im selben
      // Gebäude über alle seine Anlagen. Jede teilt ihre CO₂-Kosten mit dem gemeinsamen Anteil. Fehlt der
      // Ausstoß einer, stuft Mietfuchs ohne sie ein und sagt es (Durchsicht von #238, I2).
      const selfKg = classified ? classified.emissionsKg : own.emissionsKg
      const selfUnits = classified && perUnit ? new Map(perUnit.filter((u) => u.rented && u.delivered).map((u) => [u.unitId, u.areaM2])) : servedUnitsOf(potPlant)
      const partners = partnersOf(pot).map((x) => ({ ...x, ...contributionOf(x.pot) }))
      const known = partners.filter((x) => x.kg !== null)
      const unknown = partners.filter((x) => x.kg === null)
      const emissionsKg = selfKg === null ? null : selfKg + known.reduce((a, x) => a + (x.kg ?? 0), 0)
      const jointUnits = new Map(selfUnits)
      for (const x of known) for (const [u, a] of x.units) jointUnits.set(u, a)
      const jointArea = [...jointUnits.values()].reduce((a, v) => a + v, 0)
      const replaced = known.find((x) => x.line && potPlant?.replacesPlantId === x.pot.plantId)
      if (replaced && selfKg !== null && emissionsKg !== null) {
        warn('co2.plant-replaced',
          `${where}: In dieser Heizperiode hat „${pot.plantName}“ die Heizanlage „${replaced.pot.plantName}“ ersetzt. Eingestuft wird das Gebäude über den Ausstoß beider Heizanlagen ` +
            `(${fmtKg(selfKg)} kg und ${fmtKg(replaced.kg ?? 0)} kg, zusammen ${fmtKg(emissionsKg)} kg CO₂), denn maßgeblich ist der Kohlendioxidausstoß des Gebäudes pro Quadratmeter Wohnfläche und Jahr (§ 5 Abs. 1 Satz 1 CO2KostAufG). ` +
            'Die CO₂-Kosten jeder Anlage werden mit dem Anteil dieser Stufe aufgeteilt.',
          plantSubject)
      }
      const building = known.filter((x) => !x.line)
      // Im selben Gebäude (Nachprüfung von #238, I-A): die Fläche aller Anlagen des Gebäudes, je Linie die
      // eingetragene oder die der versorgten Wohnungen, jede Wohnung einmal. Eine eingetragene Fläche einer
      // Anlage allein teilte den Ausstoß des ganzen Gebäudes durch einen Teil seiner Fläche.
      const buildingArea = building.length > 0 ? jointAreaOf([{ pot, units: selfUnits }, ...known]) : 0
      if (building.length > 0 && selfKg !== null) {
        warn('co2.building-joint',
          `${where}: Nach Ihrer Angabe steht die Anlage im selben Gebäude wie ${andList(building.map((x) => `„${x.pot.plantName}“`))}. Mietfuchs stuft das Gebäude deshalb über den Ausstoß aller seiner Anlagen und die Wohnfläche aller versorgten Wohnungen ein ` +
            `(${fmtKg(emissionsKg ?? 0)} kg CO₂ auf ${fmtNum(buildingArea)} m²; je Anlage zählt die eingetragene Fläche, sonst die ihrer Wohnungen, jede Wohnung einmal), denn maßgeblich sind der Ausstoß des Gebäudes und die Gesamtwohnfläche seiner Wohnungen mit gesonderter oder zentraler Versorgung (§ 5 Abs. 1 Satz 1 und 2 CO2KostAufG). ` +
            'Das ist eine Auslegung: Wie mehrere Heizanlagen in einem Gebäude einzustufen sind, ist höchstrichterlich nicht geklärt.',
          plantSubject)
      }
      if (unknown.length > 0) {
        warn('co2.classification-incomplete',
          `${where}: In dieser Heizperiode heizt auch ${andList(unknown.map((x) => `„${x.pot.plantName}“`))} ${unknown.some((x) => x.line) ? 'als Vorgängerin oder Nachfolgerin dieser Anlage' : 'im selben Gebäude'}, aber deren CO₂-Ausstoß kennt Mietfuchs nicht. ` +
            'Eingestuft wird deshalb ohne sie; die Stufe kann zu niedrig liegen, und dann tragen die Mieter einen zu großen Teil der CO₂-Kosten (§ 5 Abs. 1 CO2KostAufG). ' +
            'Tragen Sie dort die Rechnungen mit CO₂-Angaben oder die CO₂-Angaben des Messdienstes ein.',
          plantSubject)
      }
      const cut = law(co2CutMissing, { period: hPeriod }, lawLog)
      const ranges = stageRanges(law(co2StageTable, { period: hPeriod }, lawLog), tableFactor(pot.period))
      // Fläche der Einstufung (9.2): eingetragen, sonst die Wohnfläche der versorgten Wohnungen (`jointArea`).
      // Bei freien Schlüsseln hält ein Datensatz `self` nur die Fläche (Heizung PR 7); der Topf führt
      // ihn nicht, denn er kennt nur Angaben laut Messdienst.
      const entered = enteredAreaOf(pot)
      const area = building.length > 0 ? (buildingArea > 0 ? buildingArea : null) : entered ?? (jointArea > 0 ? jointArea : null)
      const restriction = potPlant?.restriction ?? 'none'
      const split = selfSplit({
        emissionsKg,
        co2Cents: C,
        areaM2: area,
        ranges,
        decimals: law(co2RoundingDecimals, { period: hPeriod }, lawLog),
        nonResidentialPermille: potPlant?.nonResidential ? law(co2NonResidential, { period: hPeriod }, lawLog) : null,
        restriction: restriction === 'none' ? null : { ...law(co2Restriction, { period: hPeriod }, lawLog), both: restriction === 'both' },
      })
      // x_t (9.4): bei freien Schlüsseln der Anteil an den Positionen mit Lieferung oder als Brennstoff
      // gekennzeichnet, samt den Übertragszeilen (Task 7); fehlt beides, der ganze Topf. Beim Messdienst
      // der Anteil an seinen Beträgen.
      const marked = afterService ? pot.serviceItems : pot.items.filter((c) => c.fuelDeliveryId != null || c.heatingPart === 'fuel')
      const approx = afterService || marked.length === 0
      const base = marked.length === 0 ? pot.items : marked
      const F = base.reduce((a, c) => a + c.amountCents, 0)
      const baseIds = new Set(base.map((c) => c.id))
      const shares: ReliefShare[] = [...statements.values()].flatMap((s) => {
        const cents = s.rows.filter((r) => baseIds.has(r.costItemId)).reduce((a, r) => a + r.shareCents, 0)
        return cents > 0 ? [{ tenancyId: s.tenancyId, cents }] : []
      })
      const gaps: string[] = []
      // Brennstoff ohne Lieferung neben dem Vorrat (I2a): Seine kg und CO₂-Kosten fehlen der Rechnung.
      const unlinkedHere = stockUnlinked.get(pot.plantId) ?? []
      if (unlinkedHere.length > 0) gaps.push(`die Lieferung zu ${andList(unlinkedHere.map((c) => `„${c.description}“`))} (Menge, Ausstoß in kg und CO₂-Kosten)`)
      if (!afterService && own.missingCo2.length > 0) gaps.push(`die CO₂-Angaben der Rechnung ${andList(own.missingCo2.map((l) => `„${l}“`))} (Ausstoß in kg und CO₂-Kosten)`)
      if (split.permille === null) {
        if (area === null) gaps.push('die Fläche der versorgten Wohnungen')
        else if (afterService || own.missingCo2.length === 0) gaps.push('der CO₂-Ausstoß laut Rechnung')
      }
      const printed = new Map<string, { cents: number; approximated: boolean }>()
      let booked = false
      // Etagenheizung (Geld M4 der Durchsicht von #238): Der Ausweis nennt, was wirklich abgezogen ist.
      let perUnitBooked: number | null = null
      if (gaps.length > 0) {
        warn('co2.incomplete',
          `${where}: Für die Aufteilung der CO₂-Kosten fehlen ${andList(gaps)}. Die Heizkostenabrechnung muss den Anteil der Mieter, die Einstufung des Gebäudes und die Berechnungsgrundlagen ausweisen (§ 7 Abs. 3 CO2KostAufG); ` +
            `fehlt das, darf jeder Mieter seinen Anteil an den Heizkosten um ${cut} % kürzen (§ 7 Abs. 4 CO2KostAufG)${cutsOn(ids, cut)}. Tragen Sie die Angaben bei der Lieferung auf der Seite Heizkosten nach.`,
          plantSubject)
      } else if (perUnit) {
        // Je Wohnung (Entwurf 9.3): Wohnungen, deren CO₂-Kosten nicht in ihren Heizkosten aufgehen,
        // bekommen keinen Abzug; die übrigen schon.
        booked = true
        const permille = split.permille ?? 0
        for (const unitId of perUnitExceeding(perUnit)) {
          const u = perUnit.find((x) => x.unitId === unitId)
          warn('co2.exceeds-heating',
            `${where}: Die CO₂-Kosten der Rechnungen für die Wohnung ${unitById.get(unitId)?.name ?? unitId} (${fmtCents(u?.co2Cents ?? 0)}) liegen über den Heizkosten, die ihr zugeordnet sind (${fmtCents(u?.fuelCents ?? 0)}), oder es gibt keine Heizposition für sie. ` +
              `Für diese Wohnung zieht Mietfuchs deshalb nichts ab; ohne Aufteilung darf ihr Mieter seinen Anteil an den Heizkosten um ${cut} % kürzen (§ 7 Abs. 4 CO2KostAufG). Prüfen Sie die Rechnungen und die Positionen der Wohnung.`,
            plantSubject)
        }
        const raws = perUnitReliefs(permille, perUnit)
        const unitOf = new Map(raws.map((r) => [r.tenancyId, perUnit.find((x) => x.unitId === r.unitId)]))
        const perUnitShares: ReliefShare[] = raws.map((r) => ({ tenancyId: r.tenancyId, cents: Math.round(unitOf.get(r.tenancyId)?.shares.find((x) => x.tenancyId === r.tenancyId)?.exact ?? 0) }))
        perUnitBooked = 0
        if (raws.some((r) => r.raw > 0)) {
          perUnitBooked = bookReliefs(pot, raws.map((r) => ({ tenancyId: r.tenancyId, raw: r.raw, approximated: false })), perUnitShares, printed, {
            basis: () => 'nach Ihrem Anteil an den Heizkosten Ihrer Wohnung',
            steps: (x, c) => {
              const u = unitOf.get(x.tenancyId)
              const exact = u?.shares.find((y) => y.tenancyId === x.tenancyId)?.exact ?? 0
              const lu = ((u?.co2Cents ?? 0) * permille) / 1000
              return [
                { label: 'CO₂-Anteil des Vermieters für Ihre Wohnung', value: `${fmtCents(u?.co2Cents ?? 0)} × ${fmtNum(permille / 10)} % = ${fmtExactEuro(lu)}`, term: 'co2Split' },
                { label: 'Ihr Teil davon', value: `${fmtExactEuro(lu)} × ${fmtExactEuro(exact)} ÷ ${fmtCents(u?.fuelCents ?? 0)} = ${fmtExactEuro(x.raw)}` },
                { label: 'Ergebnis, auf Cent gerundet', value: fmtCents(-c) },
              ]
            },
          })
        }
        shares.splice(0, shares.length, ...perUnitShares)
      } else if (C > 0 && (F <= 0 || C > F)) {
        warn('co2.exceeds-heating',
          `${where}: Die CO₂-Kosten der Lieferungen (${fmtCents(C)}) sind höher als die Brennstoffkosten, die verteilt werden (${fmtCents(F)}). Das passt nicht zusammen; Mietfuchs bucht keine CO₂-Aufteilung. ` +
            `Ohne Aufteilung darf jeder Mieter seinen Anteil an den Heizkosten um ${cut} % kürzen (§ 7 Abs. 4 CO2KostAufG)${cutsOn(ids, cut)}. Prüfen Sie die CO₂-Kosten und die Beträge der Lieferungen und Positionen.`,
          plantSubject)
      } else {
        booked = true
        const L = split.landlordRaw ?? 0
        const permille = split.permille ?? 0
        if (L > 0) {
          bookReliefs(pot, reliefsByShare(L, shares, F).map((x) => ({ ...x, approximated: approx })), shares, printed, {
            basis: () => (approx ? 'nach Ihrem Anteil an den Heizkosten' : 'nach Ihrem Anteil an den Brennstoffkosten'),
            steps: (x, c, share) => [
              { label: 'CO₂-Anteil des Vermieters', value: `${fmtCents(C)} × ${fmtNum(permille / 10)} % = ${fmtExactEuro(L)}`, term: 'co2Split' },
              { label: 'Ihr Teil davon', value: `${fmtExactEuro(L)} × ${fmtCents(share)} ÷ ${fmtCents(F)} = ${fmtExactEuro(x.raw)}` },
              { label: 'Ergebnis, auf Cent gerundet', value: fmtCents(-c) },
            ],
          })
        }
        if (afterService) {
          // 15.1 Nr. 3: Ob ein Ausweis neben der Abrechnung des Messdienstes die Kürzung heilt, ist offen.
          warn('co2.service-unsplit-healed',
            `${where}: Der Messdienst hat die CO₂-Kosten nicht aufgeteilt. Mietfuchs teilt sie aus den Rechnungen auf, die er angesetzt hat (CO₂-Kosten ${fmtCents(C)}), und zieht den Anteil des Vermieters von ${fmtExactEuro(L)} je Mieter als eigene Zeile ab. ` +
              `Ob das die Kürzung vermeidet, ist nicht entschieden: § 7 Abs. 3 CO2KostAufG verlangt den Ausweis „in der Heizkostenabrechnung“. Jeder Mieter könnte bis zu ${cut} % kürzen${cutsOn(ids, cut)}. Geben Sie die Aufstellung von Mietfuchs zusammen mit der Abrechnung des Messdienstes heraus.`,
            plantSubject)
          const G = own.serviceGrossCents
          const V = st?.serviceFuelNetCents ?? st?.serviceFuelGrossCents ?? null
          if (G !== null && V !== null && Math.abs(G - V) > SERVICE_FUEL_TOLERANCE_CENTS) {
            warn('co2.service-fuel-mismatch',
              `${where}: Der Messdienst hat Brennstoffkosten von ${fmtCents(V)} angesetzt, die Rechnungen, die Sie als angesetzt gekennzeichnet haben, ergeben ${fmtCents(G)}. ` +
                'Der Messdienst hat andere Brennstoffkosten angesetzt; prüfen Sie, welche Rechnungen er verwendet hat.',
              plantSubject)
          }
          warn('co2.share-approximated',
            `${where}: Der Messdienst weist den Brennstoffanteil je Nutzer nicht aus. Mietfuchs verteilt den CO₂-Anteil des Vermieters deshalb nach dem Anteil an den Heiz- und Warmwasserkosten des Messdienstes; das bleibt eine Näherung.`,
            plantSubject)
        } else if (marked.length === 0) {
          warn('co2.share-approximated',
            `${where}: Keine Position der Heizanlage ist als Brennstoff gekennzeichnet oder mit einer Lieferung verknüpft. Mietfuchs verteilt den CO₂-Anteil des Vermieters deshalb nach dem Anteil an allen Heizkosten. ` +
              'Das ist eine Näherung, denn die CO₂-Kosten folgen dem Schlüssel des Brennstoffs (§ 7 Abs. 1 Satz 2 CO2KostAufG). Verknüpfen Sie die Positionen der Versorgerrechnung mit ihrer Lieferung.',
            plantSubject)
        } else {
          const keys = [...new Set(marked.filter((c) => !c.id.startsWith('fuel:')).map((c) => c.key))]
          if (keys.length > 1) {
            warn('co2.pool-keys',
              `${where}: Die Brennstoffpositionen werden nach verschiedenen Schlüsseln verteilt (${andList(keys.map((k: CostKey) => KEY_LABELS[k] || k))}). ` +
                'Der CO₂-Anteil des Vermieters folgt jeder Position mit ihrem Schlüssel, denn die CO₂-Kosten sind Teil der Brennstoffkosten (§ 7 Abs. 1 Satz 2 CO2KostAufG). Prüfen Sie, ob die Schlüssel so gewollt sind.',
              plantSubject)
          }
        }
      }
      if (split.adjustments.includes('nonResidential')) {
        warn('co2.non-residential',
          `${where}: Das Gebäude dient nach Ihrer Angabe überwiegend nicht dem Wohnen. Dann tragen Sie mindestens ${fmtNum(law(co2NonResidential, { period: hPeriod }, lawLog) / 10)} % der CO₂-Kosten (§ 8 Abs. 1 CO2KostAufG); Mietfuchs rechnet mit diesem Anteil statt mit der Stufentabelle.`,
          plantSubject)
      }
      if (restriction !== 'none') {
        const r = law(co2Restriction, { period: hPeriod }, lawLog)
        const what = restriction === 'building' ? 'des Gebäudes' : restriction === 'supply' ? 'der Wärme- und Warmwasserversorgung' : 'des Gebäudes und der Wärme- und Warmwasserversorgung'
        const effect = restriction === 'both'
          ? 'Stehen sie beidem entgegen, werden die CO₂-Kosten nicht aufgeteilt (§ 9 Abs. 2 CO2KostAufG), und die Mieter tragen sie ganz.'
          : `Ihr Anteil an den CO₂-Kosten wird deshalb um ${fmtNum((1 - r.factor) * 100)} % gekürzt (§ 9 Abs. 1 CO2KostAufG).`
        warn('co2.restriction',
          `${where}: Nach Ihrer Angabe stehen öffentlich-rechtliche Vorgaben einer wesentlichen energetischen Verbesserung ${what} entgegen. ${effect} ` +
            'Darauf können Sie sich nur berufen, wenn Sie den Mietern die Umstände nachweisen (§ 9 Abs. 3 CO2KostAufG); legen Sie den Nachweis der Abrechnung bei.',
          plantSubject)
      }
      if (pot.period.short) {
        warn('co2.short-period-agreed',
          `${where}: Die Heizperiode ist kürzer als ein Jahr. Mietfuchs kürzt die Grenzen der Stufentabelle im Verhältnis der Tage (§ 5 Abs. 1 Satz 4 CO2KostAufG). ` +
            'Das Gesetz kürzt bei einem „vereinbarten“ Abrechnungszeitraum unter einem Jahr; ob ein Rumpf, den Sie selbst gesetzt haben, vereinbart ist, ist nicht geklärt. Prüfen Sie Ihren Mietvertrag.',
          plantSubject)
      }
      const L = split.landlordRaw
      report.co2 = {
        method: afterService ? 'selfAfterService' : 'self',
        booked,
        deducted: false,
        totalCents: C,
        landlordCents: perUnitBooked ?? (L === null ? null : Math.round(L)),
        landlordPermille: split.permille,
        kgPerM2: split.value,
        emissionsKg,
        areaM2: area,
        stage: split.stage,
        table: ranges,
        shortened: pot.period.short,
        selfLandlordCents: null,
        selfApproximated: false,
        tenants: shares.map((s) => {
          // Etagenheizung (Heizung PR 9): der Anteil an den CO₂-Kosten der eigenen Wohnung.
          const u = perUnit?.find((x) => x.shares.some((y) => y.tenancyId === s.tenancyId))
          const tenantCents = u
            ? (u.fuelCents > 0 ? Math.round((u.co2Cents * (1 - (split.permille ?? 0) / 1000) * (u.shares.find((y) => y.tenancyId === s.tenancyId)?.exact ?? 0)) / u.fuelCents) : null)
            : F > 0 ? Math.round(((C - (L ?? 0)) * s.cents) / F) : null
          return {
          tenancyId: s.tenancyId,
          landlordCents: printed.get(s.tenancyId)?.cents ?? 0,
          tenantCents,
          approximated: approx,
          }
        }),
        basis: own.stock ? 'stock' : 'deliveries',
        coveragePermille: own.coveragePermille,
        adjustments: split.adjustments,
        areaSource: entered !== null ? 'entered' : 'served',
      }
    }
    // Warmwasser beim Messdienst (#211, Entwurf 7.7): Laut Abrechnung nach einer Formel bestimmt, ohne
    // bestätigten unzumutbaren Aufwand. 15 % auf den ganzen Anteil an Heiz- und Warmwasserkosten im
    // Topf (§ 9 Abs. 2 Satz 1, § 12 Abs. 1 Satz 1 HeizkostenV; BGH VIII ZR 151/20; R-A6, G-B9). Die
    // Flächenformel hat die engere Voraussetzung des Satzes 4 (Durchsicht M1). Ohne Angabe kein Hinweis.
    // Bei eigener Abrechnung (Heizung PR 11, Entwurf 6.5, 8.3) nur, wenn Mietfuchs den Anteil nach einer
    // Formel gerechnet hat, und nicht unter der Ausnahme des § 11 Abs. 1 Nr. 3 Buchst. a a. F. (Abweichung 9).
    const hw = pot.hotWater
    const selfOfPot = pot.method === 'self' ? selfPlans.get(pot.plantId) : undefined
    const selfFormula = selfOfPot && !selfOfPot.oldHeatPumpExemption && selfOfPot.dhwUnmeasurable !== true && selfOfPot.alpha && selfOfPot.alpha.statement.method !== 'heatMeter'
      ? selfOfPot.alpha.statement.method
      : null
    const serviceFormula = pot.method === 'service' && hw && hw.dhwMethod !== null && FORMULA_METHODS.includes(hw.dhwMethod) && hw.dhwUnmeasurable !== true ? hw.dhwMethod : null
    const formulaMethod = selfFormula ?? serviceFormula
    if (settledHere && formulaMethod !== null) {
      const cut = law(hkvCutNotByConsumption, { period: hPeriod }, lawLog)
      warn('heating.dhw-not-metered',
        `${where}: ${selfFormula ? 'Die Wärme für das Warmwasser ist' : 'Laut Abrechnung wurde die Wärme für das Warmwasser'} mit einer Formel bestimmt und nicht mit einem Wärmezähler gemessen. ` +
          (formulaMethod === 'areaFormula'
            ? 'Die Heizkostenverordnung verlangt den Wärmezähler (§ 9 Abs. 2 Satz 1 HeizkostenV); die Formel nach der Wohnfläche ist nur erlaubt, wenn weder die Wärmemenge noch das Volumen des verbrauchten Warmwassers gemessen werden kann (§ 9 Abs. 2 Satz 4 HeizkostenV). '
            : 'Die Heizkostenverordnung verlangt den Wärmezähler (§ 9 Abs. 2 Satz 1 HeizkostenV); die Formel nach dem Warmwasserverbrauch ist nur erlaubt, wenn die Wärmemenge nur mit unzumutbar hohem Aufwand gemessen werden könnte (§ 9 Abs. 2 Satz 2 HeizkostenV). ') +
          `Sonst darf jeder Mieter seinen gesamten Anteil an den Heiz- und Warmwasserkosten um ${cut} % kürzen (§ 9 Abs. 2 Satz 1, § 12 Abs. 1 Satz 1 HeizkostenV; BGH, Urteil vom 12.01.2022, VIII ZR 151/20)${cutsOn(ids, cut)}. ` +
          'Trifft die Voraussetzung bei Ihnen zu, bestätigen Sie das auf der Seite Heizkosten und bewahren einen Nachweis auf.',
        plantSubject)
    }
  }
  // Der Ausweis je Anlage und Heizperiode (Heizung PR 10), nach dem CO₂-Block, denn er nennt den
  // gedruckten Abzug je Mieter (Abweichung 15).
  for (const report of heatingStatements) {
    const sp = selfPlans.get(report.plantId)
    const pot = co2Pots.find((x) => x.plantId === report.plantId)
    if (sp && pot) report.self = selfStatementOf(sp, pot.items, pot.reliefKey)
  }
  // ---------- Hinweise der eigenen Heizkostenabrechnung (Heizung PR 10, Entwurf 3.5, 8.5, 10.1) ----------
  // Nach dem CO₂-Block, denn die Kürzungsbeträge rechnen auf den gedruckten Zeilen nach der
  // Abzugszeile (Entwurf 6.5). Ist eine Anlage nicht verteilbar, steht dort schon ein Fehler, und ein
  // Hinweis auf leere Zeilen sagte nichts.
  const cutOf = (tenancyId: string, ids: ReadonlySet<string>, pct: number): number | null => {
    const st = statements.get(tenancyId)
    if (!st) return null
    const sum = st.rows.filter((r) => ids.has(r.costItemId)).reduce((a, r) => a + r.shareCents, 0)
    return sum > 0 ? Math.round((sum * pct) / 100) : null
  }
  const nameOf = (tenancyId: string): string => {
    const st = statements.get(tenancyId)
    return st ? `${st.tenantName} (${st.unitName})` : tenancyId
  }
  const permilleText = (p: number): string => `${fmtNum(Math.round(p * 10) / 10)} ‰`
  const lines6a = new Set<string>()
  for (const sp of selfPlans.values()) {
    if (sp.weights === null || !sp.shares) continue
    const plant = sp.plant
    const where = `${plant.name ? `Heizanlage „${plant.name}“` : 'Heizanlage'}, Heizperiode ${label}`
    const subject: NoticeSubject = { kind: 'heatingCosts', id: plant.id }
    const pot = co2Pots.find((x) => x.plantId === plant.id)
    const ids = new Set<string>([...(pot?.items ?? []).map((c) => c.id), ...(pot ? [pot.reliefKey] : [])])
    // § 12 Abs. 3 (PR 10) oder § 11 Abs. 1 Nr. 3 Buchst. a a. F. (Heizung PR 11): keine Kürzungsbeträge.
    const notYet = sp.verdict?.kind === 'notYet' || sp.oldHeatPumpExemption
    // Wärmepumpe vor dem Stichtag ohne Antwort zur Überwiegend-Frage (Nachprüfung von #240, W2): Galt die
    // Verordnung doch, dürfen die Mieter kürzen, soweit nicht nach Verbrauch verteilt ist (§ 12 Abs. 1
    // Satz 1). Nicht nach Verbrauch verteilt sind hier Heizung und Warmwasser ohne Warmwasseranteil und jeder
    // Topf ohne erfassten Verbrauch.
    if (sp.majorityOpen) {
      const cut = law(hkvCutNotByConsumption, { period: lawPeriod }, lawLog)
      const notByConsumption = (sp.alpha === null && sp.hotWater === 'combined') || sp.plan.pots.some((p) => !sp.plan.totals[p].measured)
      const renewableText = hkvRenewableExemption.describe(law(hkvRenewableExemption, { period: lawPeriod }, lawLog))
      warn('heating.heat-pump-majority-open',
        `${where}: Für diesen Abrechnungszeitraum galten die Vorschriften der Heizkostenverordnung zur Verteilung nicht für Gebäude, die überwiegend mit Wärme aus ${renewableText} versorgt werden. ` +
          'Ob Ihr Gebäude dazu gehört, hängt davon ab, ob die Wärmepumpe mehr als die Hälfte der Wärme liefert; beantworten Sie die Frage bei der Heizanlage. ' +
          'Bis dahin rechnet Mietfuchs, als liefere sie mehr als die Hälfte (Festlegung von Mietfuchs); die Ausnahme muss im Streit der Vermieter belegen. ' +
          (notByConsumption
            ? `Galt die Verordnung doch, darf jeder Mieter seinen Anteil um ${cut} % kürzen, soweit nicht nach Verbrauch verteilt ist (§ 12 Abs. 1 Satz 1 HeizkostenV)${cutsOn(ids, cut)}. Mietfuchs zieht nichts ab.`
            : `Mietfuchs hat nach dem erfassten Verbrauch verteilt; eine Kürzung um ${cut} % nach § 12 Abs. 1 Satz 1 HeizkostenV käme nur in Betracht, soweit nicht nach Verbrauch verteilt ist.`),
        subject)
    }
    // § 6a Abs. 3 HeizkostenV (Durchsicht von #239, I1 und N2): Die Informationen zur Abrechnung erstellt
    // Mietfuchs mit PR 14; bis dahin eine Warnung mit der Kürzung je Mieter (§ 12 Abs. 1 Satz 3). Nur für
    // Abrechnungszeiträume ab dem 01.12.2021 (`hkv.settlement-info`), einmal je Linie (nach einem Tausch
    // geht eine Abrechnung an die Mieter), und beruht die Abrechnung nicht auf erfasstem Verbrauch, nur die
    // Angaben nach Abs. 3 Satz 1 Nr. 2 und 3 (Abs. 5).
    const root6a = lineRoot(plant, snapshot.heatingPlants ?? [])
    if (!notYet && law(hkvSettlementInfo, { period: lawPeriod }, lawLog) && !lines6a.has(root6a)) {
      lines6a.add(root6a)
      const cut6a = law(hkvCutRemoteReading, { period: lawPeriod }, lawLog)
      const inLine = [...selfPlans.values()].filter((x) => lineRoot(x.plant, snapshot.heatingPlants ?? []) === root6a)
      const lineIds = new Set<string>(inLine.flatMap((x) => {
        const p = co2Pots.find((y) => y.plantId === x.plant.id)
        return [...(p?.items ?? []).map((c) => c.id), ...(p ? [p.reliefKey] : [])]
      }))
      const cuts6a = [...statements.keys()].flatMap((tenancyId) => {
        const v = cutOf(tenancyId, lineIds, cut6a)
        return v === null ? [] : [`${nameOf(tenancyId)} ${fmtCents(v)}`]
      })
      const measured = inLine.some((x) => Object.values(x.plan.totals).some((tot) => tot?.measured === true))
      const what = measured
        ? 'die Informationen nach § 6a Abs. 3 HeizkostenV zugänglich zu machen, unter anderem der Anteil der Energieträger, die Steuern und Abgaben, die Entgelte für Zähler, Ablesung und Abrechnung, Kontaktstellen zur Energieberatung, ein Vergleich mit einem Durchschnittsnutzer und der witterungsbereinigte Vergleich mit dem vorhergehenden Abrechnungszeitraum in grafischer Form'
        : 'nach § 6a Abs. 5 HeizkostenV mindestens die Kontaktstellen zur Energieberatung und der Hinweis auf die Streitbeilegung zu nennen (Abs. 3 Satz 1 Nr. 2 und 3), denn die Abrechnung beruht nicht auf erfasstem Verbrauch'
      warn('heating.self-6a-missing',
        `${where}: Zusammen mit der Abrechnung sind den Mietern ${what}. ` +
          `Diese Angaben erstellt Mietfuchs mit einer späteren Version; legen Sie sie bis dahin selbst bei. Fehlen sie oder sind sie unvollständig, darf jeder Mieter seinen Anteil an den Heizkosten um ${cut6a} % kürzen (§ 12 Abs. 1 Satz 3 HeizkostenV)` +
          `${cuts6a.length > 0 ? `, hier: ${andList(cuts6a)}` : ''}. Mietfuchs zieht nichts ab; die Kürzung muss der Mieter erklären.`,
        subject)
    }
    const farText = ' Liegt im Winter ein Monat oder mehr dazwischen, gilt eine solche Abweichung nach der Kommentarliteratur grundsätzlich als nicht zulässig; lesen Sie künftig zum Stichtag ab oder nutzen Sie den Stichtagswert des Geräts (⟨Norm offen: VDI 2077⟩).'
    for (const f of sp.plan.findings) {
      if (f.kind === 'datesDiffer') {
        warn(f.far ? 'heating.reading-dates-far' : 'heating.reading-dates-differ',
          `${where}: Die Zähler wurden nicht genau zum ${fmtDay(f.boundary)} abgelesen; die größte Abweichung hat ${f.unitName} mit ${f.days} ${f.days === 1 ? 'Tag' : 'Tagen'} (Ablesung am ${fmtDay(f.readingDate)}, ${permilleText(f.permille)} der Gradtage dazwischen). ` +
            'Mietfuchs rechnet mit den Werten, wie sie abgelesen sind, ohne Rückrechnung; das ist unschädlich, wenn in der Zwischenzeit wenig verbraucht wird.' + (f.far ? farText : ''),
          subject)
      } else if (f.kind === 'interimOff') {
        warn(f.far ? 'heating.interim-reading-far' : 'heating.interim-reading-off',
          `${where}: Beim Wechsel in ${f.unitName} zum ${fmtDay(f.boundary)} wurde am ${fmtDay(f.readingDate)} abgelesen (${f.days} ${f.days === 1 ? 'Tag' : 'Tage'} daneben, ${permilleText(f.permille)} der Gradtage). ` +
            `Der Verbrauch dazwischen zählt zum ${f.readingDate > f.boundary ? 'Vormieter' : 'Nachmieter'}; zurückgerechnet wird nicht.` +
            (f.far ? ' Sie haben gewählt, diese Ablesung zu verwenden, statt nach § 9b Abs. 3 HeizkostenV zu teilen.' + farText : ''),
          subject)
      } else if (f.status === 'impossible' || f.status === 'imprecise') {
        warn('heating.no-interim-reading',
          f.status === 'impossible'
            ? `${where}: Für den Wechsel in ${f.unitName} zum ${fmtDay(f.boundary)} gibt es keine Zwischenablesung (nicht möglich${f.reason ? `: ${f.reason}` : ''}). ` +
              'Die gesamten Kosten der Wohnung werden deshalb aufgeteilt, die Heizkosten nach Gradtagen bzw. Tagen, die Warmwasserkosten nach Tagen (§ 9b Abs. 3 HeizkostenV).'
            : `${where}: Die Zwischenablesung zum Wechsel in ${f.unitName} zum ${fmtDay(f.boundary)} lässt nach Ihrer Angabe wegen ihres Zeitpunkts keine hinreichend genaue Ermittlung zu. ` +
              'Die gesamten Kosten der Wohnung werden deshalb aufgeteilt, die Heizkosten nach Gradtagen bzw. Tagen, die Warmwasserkosten nach Tagen (§ 9b Abs. 3 HeizkostenV).',
          subject)
      } else {
        const cut = law(hkvCutNotByConsumption, { period: lawPeriod }, lawLog)
        const list = notYet ? [] : f.tenancyIds.flatMap((id) => {
          const c = cutOf(id, ids, cut)
          return c === null ? [] : [`${nameOf(id)} ${fmtCents(c)}`]
        })
        warn('heating.no-interim-reading-missed',
          `${where}: Für den Wechsel in ${f.unitName} zum ${fmtDay(f.boundary)} gibt es keine Zwischenablesung` +
            `${f.status === null ? '; bitte geben Sie auf der Seite Heizkosten an, ob sie nicht möglich war oder nicht durchgeführt wurde' : ''}. ` +
            'Gerechnet wird nach § 9b Abs. 3 HeizkostenV, denn eine andere Rechnung gibt es nicht. Die Zwischenablesung war Pflicht (§ 9b Abs. 1). ' +
            (list.length > 0 ? `Bis zu ${cut} % der Heizkosten von ${andList(list)} können gekürzt werden (LG Hamburg, 11 S 202/87); ` : `Bis zu ${cut} % können gekürzt werden (LG Hamburg, 11 S 202/87); `) +
            'nach AG Schöneberg, 104a C 226/05, ist die Umlage des Verbrauchsanteils angreifbar. Mietfuchs zieht nichts ab; die Kürzung muss der Mieter erklären.',
          subject)
      }
    }
    // Kein Verbrauch erfasst (Entwurf 8.5): nur nach Fläche, 15 % (Abweichung 15 zur Grundlage).
    const unmeasured = sp.plan.pots.filter((p) => !sp.plan.totals[p].measured)
    if (unmeasured.length > 0 && !notYet) {
      const cut = law(hkvCutNotByConsumption, { period: lawPeriod }, lawLog)
      const share = law(hkvConsumptionShare, { period: lawPeriod }, lawLog)
      let amounts = ''
      if (unmeasured.length === sp.plan.pots.length) {
        amounts = cutsOn(ids, cut)
      } else {
        // „Soweit“ (§ 12 Abs. 1 Satz 1): nur der unerfasste Topf, sein Anteil nach CO₂-Abzug (6.5); der
        // Ausweis druckt beide Beträge je Mieter (Abweichung 15).
        const p = unmeasured[0] ?? 'heating'
        const K = potCostOf(sp, pot?.items ?? [], p)
        const list = sp.plan.units.flatMap((u) => u.users).flatMap((u) => {
          const w = sp.weights?.get(u.key)
          if (u.role !== 'tenancy' || !u.tenancyId || !statements.has(u.tenancyId) || !w) return []
          const net = K * w[p] - potCo2Of(sp, pot?.items ?? [], pot?.reliefKey ?? null, u.tenancyId, w)[p]
          const c = Math.round((net * cut) / 100)
          return c > 0 ? [`${nameOf(u.tenancyId)} ${fmtCents(c)}`] : []
        })
        amounts = list.length > 0 ? `, hier vom Topf ${POT_NAME[p]} nach CO₂-Abzug laut Ausweis: ${andList(list)}` : ''
      }
      const missingCapture = sp.verdict?.kind === 'missing'
        ? ` Die Wärmepumpe hat keine Verbrauchserfassung, obwohl sie bis zum ${fmtDay(law(hkvHeatPumpCapture, { date: period.from }, lawLog).installBy)} einzubauen war (§ 12 Abs. 3 HeizkostenV). Dass die Mieter dann nach § 12 Abs. 1 Satz 1 kürzen dürfen, ist eine Auslegung; entschieden ist es nicht.`
        : ''
      warn('heating.no-consumption',
        `${where}: Für ${unmeasured.map((p) => POT_NAME[p]).join(' und ')} ist kein Verbrauch erfasst; Mietfuchs verteilt ${unmeasured.length === 1 ? 'diesen Teil' : 'die Kosten'} nur nach Fläche. ` +
          `Die Heizkostenverordnung verlangt, ${hkvConsumptionShare.describe(share)} nach dem erfassten Verbrauch zu verteilen; sonst darf jeder Mieter seinen Anteil um ${cut} % kürzen (§ 12 Abs. 1 Satz 1 HeizkostenV)${amounts}.${missingCapture}`,
        subject)
    }
    // Anteil anders als in der Vorperiode (§ 6 Abs. 4, R-A7).
    const prev = sp.shares.previous
    if (sp.shares.changed && prev) {
      warn('heating.key-change',
        `${where}: Der Anteil nach Verbrauch war in der vorigen Heizperiode ${fmtNum(prev.heating)} % bei der Heizung${prev.water !== null ? ` und ${fmtNum(prev.water)} % beim Warmwasser` : ''}, jetzt ${fmtNum(sp.shares.heating)} %${sp.shares.water !== null ? ` und ${fmtNum(sp.shares.water)} %` : ''}. ` +
          'Den Abrechnungsmaßstab ändern Sie nach der ersten Festlegung nur bei Einführung einer Vorerfassung nach Nutzergruppen, nach baulichen Maßnahmen, die nachhaltig Heizenergie einsparen, oder aus anderen sachgerechten Gründen, durch Erklärung gegenüber den Mietern und nur mit Wirkung zum Beginn eines Abrechnungszeitraums (§ 6 Abs. 4 HeizkostenV). Ist das so geschehen, ist nichts zu tun.',
        subject)
    }
    // Warmwasseranteil auf der Schätzung beim Abschluss (Abweichung 11).
    if (sp.alpha?.estimated) {
      warn('heating.dhw-share-estimated',
        `${where}: Der Warmwasseranteil von ${fmtNum(Math.round(sp.alpha.value * 1000) / 10)} % beruht auf der geschätzten Energie der fehlenden Rechnung, die Sie beim Abschluss eingetragen haben. Mit der Folgerechnung kann er sich ändern; die abgeschlossene Abrechnung bleibt, wie sie ist.`,
        subject)
    }
    // Wärmepumpe, für die die Verordnung noch nicht gilt (§ 12 Abs. 3 Satz 2, Abweichung 7).
    if (sp.verdict?.kind === 'notYet') {
      const rule = law(hkvHeatPumpCapture, { date: period.from }, lawLog)
      const on = sp.verdict.captureInstalledOn
      warn('heating.heat-pump-capture',
        `${where}: Bei dieser Wärmepumpe wurde der Verbrauch am ${fmtDay(rule.capturedBy)} noch nicht erfasst. Die Heizkostenverordnung gilt für sie erst ab dem Abrechnungszeitraum, der nach dem Einbau der Erfassung beginnt (§ 12 Abs. 3 HeizkostenV)` +
          `${on ? `, also ab dem Abrechnungszeitraum, der nach dem ${fmtDay(on)} beginnt` : `; einzubauen ist sie bis zum ${fmtDay(rule.installBy)}`}. ` +
          'Bis dahin gilt die Verteilung laut Mietvertrag, und Kürzungen nach § 12 Abs. 1 HeizkostenV entfallen. Mietfuchs verteilt nach den erfassten Werten, wie Sie es eingerichtet haben; prüfen Sie, ob der Mietvertrag das deckt.',
        subject)
    }
    // Zeitanteilig statt nach Gradtagen (§ 9b Abs. 2): beide Beträge.
    if (sp.changeSplit === 'time' && sp.plan.units.some((u) => u.users.length > 1)) {
      const alt = weightsOf(planSelf({ ...sp.input, changeSplit: 'degreeDays' }), { heating: sp.shares.heating, water: sp.shares.water ?? 0 }, sp.alpha?.value ?? null)
      const own = (pot?.items ?? []).filter((c) => c.key === 'heatingSystem')
      const sumFor = (w: Map<string, SelfWeights>, key: string): number => own.reduce((a, c) => a + c.amountCents * (w.get(key)?.[c.heatingTarget ?? 'both'] ?? 0), 0)
      const list = sp.plan.units.filter((u) => u.users.length > 1).flatMap((u) => u.users).flatMap((u) => (u.role === 'tenancy' && u.tenancyId && sp.weights
        ? [`${nameOf(u.tenancyId)}: zeitanteilig ${fmtCents(Math.round(sumFor(sp.weights, u.key)))}, nach Gradtagen ${fmtCents(Math.round(sumFor(alt, u.key)))}`]
        : []))
      if (list.length > 0) {
        warn('heating.change-split-time',
          `${where}: Beim Mieterwechsel teilen Sie die übrigen Heizkosten zeitanteilig. Die Heizkostenverordnung lässt auch die Gradtagszahlen zu, nach denen ein Wintermonat mehr wiegt als ein Sommermonat (§ 9b Abs. 2 HeizkostenV); beides ist zulässig. ${andList(list)}.`,
          subject)
      }
    }
  }
  // Dasselbe bei freien Schlüsseln mit Positionen „nur Heizung“ (Heizung PR 10, A2).
  for (const [plantId, byTenancy] of manualSplitTime) {
    const plant = plants.find((p) => p.id === plantId)
    const list = [...byTenancy].map(([id, e]) => `${nameOf(id)}: zeitanteilig ${fmtCents(Math.round(e.now))}, nach Gradtagen ${fmtCents(Math.round(e.alt))}`)
    if (!plant || list.length === 0) continue
    warn('heating.change-split-time',
      `${plant.name ? `Heizanlage „${plant.name}“` : 'Heizanlage'}: Beim Mieterwechsel teilen Sie die Positionen „nur Heizung“ zeitanteilig. Die Heizkostenverordnung lässt auch die Gradtagszahlen zu, nach denen ein Wintermonat mehr wiegt als ein Sommermonat (§ 9b Abs. 2 HeizkostenV); beides ist zulässig. ${andList(list)}.`,
      { kind: 'heatingCosts', id: plantId })
  }
  // Freie Schlüssel ohne Bestand oder ohne Schlüssel (Entwurf 8.2 „Ohne Bestand“, N9): verteilt wird nach
  // Lieferung wie bisher; der Text nennt beide Folgen (Heizung PR 8).
  for (const n of stockNotes) {
    const where = `${n.plant.name ? `Heizanlage „${n.plant.name}“` : 'Heizanlage'}, Heizperiode ${label}`
    warn(n.code, `${where}: ${n.text}`, { kind: 'heatingCosts', id: n.plant.id })
  }
  for (const n of stockManualNotes) {
    const where = `${n.plant.name ? `Heizanlage „${n.plant.name}“` : 'Heizanlage'}, Heizperiode ${label}`
    const subject: NoticeSubject = { kind: 'heatingCosts', id: n.plant.id }
    const co2 = CO2_FUELS.includes(n.plant.energy) ? ' Auch die CO₂-Einstufung beruht dann auf den gelieferten statt den verbrauchten kg (§ 5 Abs. 1 CO2KostAufG).' : ''
    if (n.invalid) {
      warn('fuel.stock-invalid',
        `${where}: ${n.text} Bis das geklärt ist, verteilt Mietfuchs die Brennstoffrechnungen, wie sie sind, nach ihrem Schlüssel; umzulegen sind aber die Kosten des verbrauchten Brennstoffs (§ 7 Abs. 2 HeizkostenV).${co2} Bitte prüfen Sie den Vorrat und die Lieferungen auf der Seite Heizkosten.`,
        subject)
    } else {
      // Durchsicht von #237, Recht I1: BGH VIII ZR 156/11, Leitsätze 1 und 2 (gelesen am 06.10.2026):
      // nur nach dem verbrauchten Brennstoff; der Fehler ist nicht durch die Kürzung nach § 12 Abs. 1
      // HeizkostenV auszugleichen. Im selbstbewohnten Zweifamilienhaus gilt die HeizkostenV nicht (§ 2),
      // die Kosten „der verbrauchten Brennstoffe und ihrer Lieferung“ nennt dann § 2 Nr. 4a BetrKV.
      const norm = heatingAgreeable ? '§ 2 Nr. 4a BetrKV' : '§ 7 Abs. 2 HeizkostenV'
      const cut = heatingAgreeable ? '' : `, und das lässt sich nicht durch eine Kürzung um ${law(hkvCutNotByConsumption, { period: lawPeriod }, lawLog)} % ausgleichen`
      warn('fuel.manual-by-delivery',
        `${where}: ${n.text} Mietfuchs verteilt die Brennstoffrechnungen deshalb, wie sie sind, nach ihrem Schlüssel. Umzulegen sind aber die Kosten der verbrauchten Brennstoffe und ihrer Lieferung (${norm}). ` +
          `Eine Abrechnung nach Lieferungen statt nach dem verbrauchten Brennstoff ist nach BGH VIII ZR 156/11 nicht zulässig; die Abrechnung ist insoweit falsch${cut}.${co2} ` +
          'Tragen Sie Anfangs- und Endbestand auf der Seite Heizkosten in der Karte „Vorrat“ ein.',
        subject)
    }
  }
  // Positionen über zwei Anlagen (Heizung PR 9): ein Fehler an der Position, mit den Wohnungen der
  // anderen Anlage.
  const plantsHere = (plantId: string | null | undefined): string => {
    const plant = plants.find((p) => p.id === plantId)
    return plant ? snapshot.units.filter((u) => servesUnit(plant, u)).map((u) => u.name).join(', ') : ''
  }
  for (const [itemId, others] of spanning) {
    const item = items.find((c) => c.id === itemId)
    if (!item) continue
    const own = plants.find((p) => p.id === item.heatingPlantId)?.name ?? ''
    const named = (unitIds: string[]) => unitIds.map((id) => unitById.get(id)?.name ?? id).join(', ')
    // Recht I2 und Geld M5 der Durchsicht von #238: keine Norm für „je Anlage“, die Folge in Euro und der
    // Handgriff im Formular.
    const cut = law(co2CutMissing, { period: lawPeriod }, lawLog)
    const ownUnits = plantsHere(item.heatingPlantId)
    warn('co2.item-spans-plants',
      `„${item.description}“ gehört zur Heizanlage „${own}“, wird aber auch auf Wohnungen verteilt, die an ${andList(others.map((o) => `„${o.name}“`))} hängen (${others.map((o) => named(o.unitIds)).join('; ')}). ` +
        'Mietfuchs teilt die CO₂-Kosten je Heizanlage auf; eine Position über zwei Anlagen gehört zu keiner, deshalb mindert sie keinen CO₂-Abzug, und die Mieter tragen den CO₂-Anteil darin mit. ' +
        `${CO2_NOT_ON_TENANTS} Fehlt die Aufteilung, darf jeder Mieter seinen Anteil an den Heizkosten um ${cut} % kürzen (§ 7 Abs. 4 CO2KostAufG)${cutsOn(new Set([item.id]), cut)}. ` +
        `Wählen Sie an der Position unter „Weitere Optionen: nur bestimmte Wohnungen beteiligen“ die Wohnungen von „${own}“${ownUnits ? ` (${ownUnits})` : ''}, und erfassen Sie den Teil der übrigen Wohnungen als eigene Position ihrer Anlage.`,
      itemSubject(item))
  }
  // Heizpositionen ohne Heizanlage (Entwurf 9.1, 11.1): Mietfuchs kennt den Energieträger nicht und
  // sagt, was gälte. Im ersten Zeitraum der Aufteilung ein eigener Hinweis. Knopf: „Heizung
  // einrichten →“.
  const inPots = new Set(co2Pots.flatMap((p) => p.items.map((c) => c.id)))
  const loose = items.filter((c) => c.category === HEATING_CATEGORY && c.amountCents !== 0 && !inPots.has(c.id) && !spanning.has(c.id))
  // Heizung PR 9 (Festlegung 5): Hat das Objekt Anlagen und gehört nur diese Position zu keiner, wäre
  // „Richten Sie die Heizung ein“ falsch; gesagt wird es an der Position.
  const looseWithPlants = loose.filter((c) => !c.heatingPlantId && plants.length > 0)
  if (looseWithPlants.length > 0 && settledOn(new Set(looseWithPlants.map((c) => c.id))) && law(co2ApplicableFrom, { period: lawPeriod }, lawLog)) {
    const cut = law(co2CutMissing, { period: lawPeriod }, lawLog)
    const firstYear = lawPeriod.from.slice(0, 4) === co2FirstPeriodStart().slice(0, 4)
    for (const c of looseWithPlants) {
      warn(firstYear ? 'co2.missing-first-year' : 'co2.fuel-unknown',
        `„${c.description}“ gehört zu keiner Heizanlage. Mietfuchs weiß deshalb nicht, womit für diese Position geheizt wurde, und teilt ihre CO₂-Kosten nicht auf. ` +
          `${co2Duty('Heizt die Anlage mit Gas, Heizöl, Flüssiggas oder Kohle oder weist Ihr Wärmelieferant CO₂-Kosten aus, sind die CO₂-Kosten')} ` +
          `Fehlt das, darf jeder Mieter seinen Anteil an den Heizkosten um ${cut} % kürzen (§ 7 Abs. 4 CO2KostAufG)${cutsOn(new Set([c.id]), cut)}. Ordnen Sie die Position unter Kosten einer Heizanlage zu.`,
        itemSubject(c))
    }
  }
  const looseRest = loose.filter((c) => !looseWithPlants.includes(c))
  if (looseRest.length > 0 && settledOn(new Set(looseRest.map((c) => c.id))) && law(co2ApplicableFrom, { period: lawPeriod }, lawLog)) {
    const cut = law(co2CutMissing, { period: lawPeriod }, lawLog)
    const first = co2FirstPeriodStart()
    const what =
      `Mietfuchs weiß nicht, womit das Haus geheizt wird. ${co2Duty('Heizen Sie mit Gas, Heizöl, Flüssiggas oder Kohle oder weist Ihr Wärmelieferant CO₂-Kosten aus, sind die CO₂-Kosten')} ` +
      `Fehlt das, darf jeder Mieter seinen Anteil an den Heizkosten um ${cut} % kürzen (§ 7 Abs. 4 CO2KostAufG)${cutsOn(new Set(looseRest.map((c) => c.id)), cut)}. ` +
      'Richten Sie unter Stammdaten die Heizung ein; dann sagt Mietfuchs, was zu tun ist.'
    const setUp: NoticeSubject = { kind: 'heatingPlant', id: '' }
    if (lawPeriod.from.slice(0, 4) === first.slice(0, 4)) {
      warn('co2.missing-first-year',
        `Für Abrechnungszeiträume, die am oder nach dem ${fmtDay(first)} beginnen, sind die CO₂-Kosten der Heizung aufzuteilen (§ 11 Abs. 2 Satz 1 CO2KostAufG); dieser Zeitraum ist der erste. ${what}`,
        setUp)
    } else {
      warn('co2.fuel-unknown', what, setUp)
    }
  }

  // Überschneidende Mietverhältnisse (#204), mit dem Mehrbetrag aus der Verteilung oben. „Hier
  // beheben →“ führt zum früher eingezogenen, denn meist ist sein Auszug vertippt.
  for (const o of overlaps) {
    const period = (t: SnapshotTenancy) => (t.end ? `${fmtDay(t.start)} bis ${fmtDay(t.end)}` : `ab ${fmtDay(t.start)}`)
    const span = o.to === null ? `seit dem ${fmtDay(o.from)}` : `vom ${fmtDay(o.from)} bis ${fmtDay(o.to)}`
    const yearDays = rangeOverlapDays(o.inYear.from, o.inYear.to, o.inYear.from, o.inYear.to)
    const whole = o.to !== null && o.from === o.inYear.from && o.to === o.inYear.to
    // Je Lesart, was zu viel getragen und was zu viel gutgeschrieben wird. Ist eine Lesart 0, heißt
    // das nur, dass niemand zu viel trägt: Zugunsten der Mieter können sich die Anteile verschieben
    // (wird je Position zur Seite „zu viel“ geklemmt), deshalb nie „wirkt sich nicht aus“.
    const rounded = (l: { cost: number, credit: number }) => ({ cost: Math.round(l.cost), credit: Math.round(l.credit) })
    const a = rounded(o.extra.first)
    const c = rounded(o.extra.second)
    const zero = (l: { cost: number, credit: number }) => l.cost === 0 && l.credit === 0
    const who = 'die Mieter dieser Wohnung'
    // Der Satzteil nach „Die Mieter dieser Wohnung“ bzw. nach „Ist …, “ (dann mit vorangestelltem Verb).
    const clause = (l: { cost: number, credit: number }, inverted: boolean): string => {
      const lead = (verb: string) => (inverted ? `${verb} ${who}` : `Die Mieter dieser Wohnung ${verb}`)
      if (zero(l)) return `${lead('tragen')} dadurch ${label} nicht zu viel`
      if (l.credit === 0) return `${lead('tragen')} ${label} bei den betroffenen Positionen zusammen ${fmtCents(l.cost)} mehr, als auf die Wohnung entfällt`
      if (l.cost === 0) return `${lead('bekommen')} ${label} bei den betroffenen Gutschriften zusammen ${fmtCents(l.credit)} mehr gutgeschrieben, als auf die Wohnung entfällt`
      return `${lead('tragen')} ${label} bei den betroffenen Kosten zusammen ${fmtCents(l.cost)} mehr, als auf die Wohnung entfällt, und bekommen ${fmtCents(l.credit)} mehr gutgeschrieben`
    }
    const amountText = a.cost === c.cost && a.credit === c.credit
      ? zero(a) ? `${clause(a, false)}. ` : `Für diese Zeit wird beiden der volle Anteil berechnet: ${clause(a, false)}. `
      : `Für diese Zeit wird beiden der volle Anteil berechnet. Wie viel zu viel, hängt davon ab, welches Datum falsch ist: Ist bei ${o.first.tenantName} ein Datum falsch, ${clause(a, true)}; ist es bei ${o.second.tenantName} falsch, ${
        // Beide nur Kosten: der zweite Betrag allein, der Satz davor sagt schon, was er heißt.
        a.credit === 0 && c.credit === 0 && a.cost > 0 && c.cost > 0 ? fmtCents(c.cost) : clause(c, true)
      }. `
    warn('tenancy.overlap',
      `Die Mietverhältnisse von ${o.first.tenantName} (${period(o.first)}) und ${o.second.tenantName} (${period(o.second)}) in ${o.first.unit.name} überschneiden sich ${span} (${whole ? '' : 'davon '}${daysLabel(yearDays)}${whole ? '' : ` in ${label}`}). ` +
        amountText +
        'Meist ist ein Datum vertippt: Bitte Auszug und Einzug prüfen und das falsche Datum berichtigen. Bis dahin rechnet Mietfuchs wie erfasst.',
      { kind: 'tenancy', id: o.first.id })
  }

  // Fernablesbarkeit (#110): Ab dem Abrechnungsjahr 2027 müssen alle Erfassungsgeräte fernablesbar
  // sein. Welche Geräte eingebaut sind, weiß Mietfuchs nicht; deshalb ein Hinweis ohne Betrag statt
  // einer bezifferten Kürzung. Ein Feld dafür am Zähler gehört zur Heizkostenabrechnung (#97, #99).
  // Ohne `subject`: An der Kostenposition gibt es nichts zu beheben, ein „Hier beheben →“ führte
  // ins Leere.
  // Der Zeitpunkt kommt aus `hkv.remote-reading.retrofit` (Zeitregel `overlap`), die Höhe aus
  // `hkv.cut.remote-reading` (dritte Fassung des Entwurfs, N6).
  // Mit Heizanlage (Heizung PR 4, #214) weiß Mietfuchs, was eingetragen ist: an den Zählern
  // Fernablesbarkeit und Einbaudatum, an der Anlage die Angabe für den Messdienst. Ohne Anlage, oder
  // solange dort nichts bekannt ist, bleibt es beim Hinweis darunter, Wort für Wort wie bisher.
  const remote = heatingBilledItem ? remoteReadingVerdict(snapshot.heatingPlants ?? [], snapshot.meters, snapshot.units, lawPeriod, lawLog) : null
  const retrofit = heatingBilledItem && (remote === null || remote.level === 'unknown') ? law(hkvRemoteReadingRetrofit, { period: lawPeriod }, lawLog) : null
  if (retrofit && retrofit.coverage !== 'none') {
    const remoteCut = law(hkvCutRemoteReading, { period: lawPeriod }, lawLog)
    warn('heating.remote-reading',
      `Spätestens seit dem ${fmtDay(retrofit.validFrom ?? '')} müssen alle Zähler und Heizkostenverteiler für Heizung und Warmwasser fernablesbar sein (§ 5 Abs. 3 HeizkostenV); ` +
        `Geräte, die nach dem ${fmtDay(retrofit.value.installedUpTo)} eingebaut wurden, müssen es in der Regel schon seit ihrem Einbau sein (§ 5 Abs. 2). Bei fernablesbaren Geräten stehen den Mietern schon seit 2022 monatliche Verbrauchsinformationen zu (§ 6a HeizkostenV). ` +
        `Fehlt das eine oder das andere, darf jeder Mieter seinen Anteil an den Heizkosten um ${remoteCut} % kürzen (§ 12 Abs. 1 HeizkostenV). ` +
        'Mietfuchs weiß nicht, welche Geräte bei Ihnen eingebaut sind. Prüfen Sie das bitte mit Ihrem Messdienst. Ausgenommen sind Einzelfälle, in denen die Nachrüstung technisch nicht möglich ist, unangemessen aufwendig wäre oder sonst eine unbillige Härte bedeutete (§ 5 Abs. 3 Satz 2), sowie die Fälle des § 11 HeizkostenV. ' +
        'Das gilt nicht für eine Gastherme in der Wohnung mit eigenem Gasvertrag des Mieters. ' +
        'Im Haus mit höchstens zwei Wohnungen, von denen Sie eine selbst bewohnen, gilt das nur, wenn Sie nichts anderes vereinbart haben (§ 2 HeizkostenV).')
  }
  if (remote && (remote.level === 'required' || remote.level === 'possible')) {
    const remoteCut = law(hkvCutRemoteReading, { period: lawPeriod }, lawLog)
    const newDevices = law(hkvRemoteReadingNewDevices, { date: lawPeriod.to }, lawLog)
    const retrofitRule = law(hkvRemoteReadingRetrofit, { period: lawPeriod }, lawLog)
    // Die Kürzung je Mieter auf seine gedruckten Heizzeilen, kaufmännisch gerundet (Entwurf 6.5).
    // Mietfuchs zieht nichts ab; erklären muss die Kürzung der Mieter.
    // Nur Mieter in Wohnungen an der Anlage (Durchsicht von #230).
    const served = servedUnitIds(snapshot.heatingPlants ?? [], snapshot.units)
    const cuts = [...statements.values()].filter((st) => served.has(st.unitId)).flatMap((st) => {
      const heat = st.rows.filter((r) => r.category === HEATING_CATEGORY).reduce((a, r) => a + r.shareCents, 0)
      return heat > 0 ? [`${st.tenantName} (${st.unitName}) ${fmtCents(Math.round((heat * remoteCut) / 100))}`] : []
    })
    // Mit der Wohnung (Durchsicht von #241, Minor 7): Heizkostenverteiler heißen oft nur nach dem Raum.
    const names = remote.meterIds.map((id) => {
      const m = snapshot.meters.find((x) => x.id === id)
      const unit = m?.unitId ? snapshot.units.find((u) => u.id === m.unitId)?.name : undefined
      return `„${m?.name ?? 'ohne Namen'}“${unit ? ` (${unit})` : ''}`
    })
    const which = names.length > 0
      ? `Nicht fernablesbar ${names.length === 1 ? 'ist' : 'sind'} ${andList(names)}.`
      : 'Laut Ihrer Angabe an der Heizanlage sind nicht alle Zähler und Heizkostenverteiler fernablesbar.'
    const rule = `Geräte, die nach dem ${fmtDay(newDevices.installedAfter)} eingebaut wurden, müssen ab ihrem Einbau fernablesbar sein (§ 5 Abs. 2 HeizkostenV), alle übrigen ab dem ${fmtDay(retrofitRule.validFrom ?? '')} (§ 5 Abs. 3).`
    const subject: NoticeSubject | undefined = remote.meterIds[0] ? { kind: 'meter', id: remote.meterIds[0] } : undefined
    if (remote.level === 'required') {
      warn('heating.remote-reading-missing',
        `${which} ${rule} In diesem Zeitraum gilt das für diese Geräte. Jeder Mieter darf seinen Anteil an den Heizkosten deshalb um ${remoteCut} % kürzen (§ 12 Abs. 1 Satz 2 HeizkostenV)` +
          `${cuts.length > 0 ? `, hier: ${andList(cuts)}` : ''}. Mietfuchs zieht nichts ab; die Kürzung muss der Mieter erklären. ` +
          'Ausgenommen sind ein einzelnes Gerät, das in einem nicht fernablesbaren System ersetzt oder ergänzt wurde (§ 5 Abs. 2 Satz 4), und Fälle, in denen die Nachrüstung technisch nicht möglich ist oder eine unbillige Härte wäre (§ 5 Abs. 3 Satz 2); bewahren Sie dafür einen Nachweis auf.',
        subject)
    } else {
      warn('heating.remote-reading',
        `${which} ${rule} Ob das in diesem Zeitraum schon für diese Geräte gilt, hängt an ihrem Einbaudatum und daran, ob ein einzelnes Gerät in einem System ersetzt oder ergänzt wurde, dessen übrige Geräte nicht fernablesbar sind; dann gilt die Frist für die übrigen (§ 5 Abs. 2 Satz 4). Wenn ja, darf jeder Mieter seinen Anteil an den Heizkosten um bis zu ${remoteCut} % kürzen (§ 12 Abs. 1 Satz 2 HeizkostenV)` +
          `${cuts.length > 0 ? `, hier bis zu: ${andList(cuts)}` : ''}. ` +
          (remote.askInstall
            ? `Sagen Sie Mietfuchs an der Heizanlage, ob die nicht fernablesbaren Geräte, die nach dem ${fmtDay(newDevices.installedAfter)} eingebaut wurden, einzeln als Ersatz oder Ergänzung in ein bestehendes, nicht fernablesbares System kamen oder ob das System als Ganzes neu installiert wurde; dann rechnet Mietfuchs es genau.`
            : 'Tragen Sie das Einbaudatum am Zähler oder die Angabe an der Heizanlage ein; dann rechnet Mietfuchs es genau.'),
        subject)
    }
  }

  // Zweifamilienhaus (#180, Entwurf 8.9): Die Objektart sagt, wie der Vermieter das Haus nennt. Ob
  // die Ausnahme des § 2 HeizkostenV gilt, hängt an den Wohnungen (`heatingAgreeable`), und danach
  // rechnet Mietfuchs. Widerspricht die Art den Wohnungen, erfährt es der Vermieter; ohne
  // Heizkosten spielt die Ausnahme keine Rolle.
  if (snapshot.property?.kind === 'zfh' && !heatingAgreeable && items.some((c) => c.category === HEATING_CATEGORY)) {
    warn('property.kind-mismatch',
      'Das Objekt ist als Zweifamilienhaus eingetragen, nach den angelegten Wohnungen gilt die Ausnahme des § 2 HeizkostenV aber nicht: ' +
        'Dafür darf das Gebäude höchstens zwei Wohnungen haben, von denen Sie eine selbst bewohnen. Mietfuchs richtet sich nach den Wohnungen; ' +
        'die Heizkostenverordnung gilt hier ohne diese Ausnahme. Prüfen Sie die Art des Objekts in den Stammdaten oder ob Ihre eigene Wohnung als „Eigennutzung“ angelegt ist.')
  }

  // Nur Wohnungen, die im Jahr nicht nach Verbrauch gedeckt sind, dürfen kürzen: Eine
  // Grundkostenposition nach Fläche neben der Verbrauchsposition ist der Regelfall der Verordnung.
  // Die Grenzen 50 und 70 % (`hkv.consumption-share`) fragt heatingFindings nur ab, wenn es eine
  // Wohnung mit Verbrauchs- und Grundkostenposition gibt.
  const consumptionShare = () => law(hkvConsumptionShare, { period: lawPeriod }, lawLog)
  const heating = heatingFindings(items, snapshot.units.filter((u) => !outsideHeating(u)), heatingCovered, consumptionShare)
  for (const { item, rows } of heatingCuts) {
    const affected = heating.withoutConsumption.get(item.id)
    const hit = rows.filter((r) => affected?.has(r.unitId))
    if (hit.length === 0) continue
    const share = consumptionShare()
    const cut = law(hkvCutNotByConsumption, { period: lawPeriod }, lawLog)
    if (!heatingAgreeable) {
      // Auf den Cent gerundet, kaufmännisch wie überall bei einer Einzelzahl.
      const cuts = hit.map((r) => `${r.label} ${fmtCents(Math.round((r.share * cut) / 100))}`)
      warn('heating.not-by-consumption',
        `„${item.description}“: Heizung und Warmwasser werden hier nicht nach Verbrauch verteilt. Die Heizkostenverordnung verlangt, mindestens ${share.min} und höchstens ${share.max} % nach dem erfassten Verbrauch zu verteilen, den Rest nach Fläche (§ 7 Abs. 1, § 8 Abs. 1 HeizkostenV). ` +
          `Sonst darf jeder Mieter seinen Anteil um ${cut} % kürzen (§ 12 Abs. 1 HeizkostenV), hier: ${andList(cuts)}. ` +
          `Verteilen Sie ${hkvConsumptionShare.describe(share)} nach Verbrauch (eine Position nach Verbrauch mit Wärmezählern, den Rest als eigene Position nach Fläche) oder übernehmen Sie die Abrechnung des Messdienstes als Einzelbeträge.`,
        itemSubject(item))
    } else {
      // § 2: Hier darf anderes vereinbart werden, und ob es vereinbart ist, weiß Mietfuchs nicht.
      // Deshalb ein Hinweis ohne Betrag statt Schweigen.
      warn('heating.may-agree-otherwise',
        `„${item.description}“: Heizung und Warmwasser werden hier nicht nach Verbrauch verteilt. Im Gebäude mit höchstens zwei Wohnungen, von denen Sie eine selbst bewohnen, darf anderes vereinbart werden (§ 2 HeizkostenV). ` +
          `Die Heizkostenverordnung gilt hier, sofern im Mietvertrag nichts anderes vereinbart ist; dann sind ${hkvConsumptionShare.describe(share)} nach Verbrauch zu verteilen, und sonst darf der Mieter seinen Anteil um ${cut} % kürzen (§ 12 Abs. 1 HeizkostenV).`,
        itemSubject(item))
    }
  }

  // Verbrauchsanteil außerhalb von 50 bis 70 % (#140, Durchsicht): ein Hinweis ohne Betrag, denn
  // nach Verbrauch abgerechnet wird ja; ob die Aufteilung der Positionen stimmt, prüft der Vermieter.
  for (const g of heating.shareOutside) {
    const names = andList(g.itemIds.map((id) => `„${items.find((c) => c.id === id)?.description ?? id}“`))
    const pct = Math.round((g.consumptionCents * 1000) / g.totalCents) / 10
    const share = consumptionShare()
    warn('heating.consumption-share',
      `Heizung und Warmwasser (${names}): nach Zählern verteilt werden ${fmtNum(pct)} % der Heizkosten. Die Heizkostenverordnung verlangt mindestens ${share.min} und höchstens ${share.max} % nach dem erfassten Verbrauch (§ 7 Abs. 1, § 8 Abs. 1 HeizkostenV). Bitte die Aufteilung zwischen Verbrauchs- und Grundkosten prüfen.`,
      itemSubject({ id: g.itemIds[0] ?? '' }))
  }

  // ---------- Zeitraum (#208, Entwurf 3.4, 3.6) ----------
  // Nur ein Rumpf und nur Positionen mit Leistungszeitraum ergeben hier etwas; ein Bestand im
  // Kalenderjahr ohne Leistungszeitraum bekommt keinen dieser Hinweise.
  if (period.short) {
    // In der Teilabrechnung nach Weg b ist der Rumpf der der Heizperiode, nicht der von P (Durchsicht von #231).
    warn('period.short', scope === 'heatingPart'
      ? `Die Heizperiode ${label} ist ein Rumpfzeitraum wegen der Umstellung der Heizung. Eine Verkürzung braucht einen sachlichen Grund, etwa die Angleichung an den Messdienst. Legt Ihr Mietvertrag den Zeitraum fest, braucht die Umstellung die Zustimmung der Mieter.`
      : `Rumpfzeitraum ${label} wegen der Umstellung. Eine Verkürzung braucht einen sachlichen Grund, etwa die Angleichung an den Messdienst. Legt Ihr Mietvertrag den Zeitraum fest, braucht die Umstellung die Zustimmung der Mieter.`)
  }
  // Laienprobe B2: Eine Heizrechnung ohne Leistungszeitraum steht ganz im Rumpf, etwa weil sie beim
  // Wechsel des Zeitraums dorthin kam. Ist sie eine Jahresrechnung, zahlen die Mieter hier die Wärme
  // eines ganzen Jahres gegen wenige Monate Vorauszahlung. Mit Leistungszeitraum greift der Hinweis
  // darunter (`period.heating-mismatch`), liegt er im Rumpf, ist alles in Ordnung.
  if (period.short && scope !== 'heatingPart') {
    for (const item of items) {
      if (item.category !== HEATING_CATEGORY || item.serviceFrom !== undefined || item.serviceTo !== undefined) continue
      warn('period.short-heating-whole',
        `„${item.description}“ (${fmtCents(item.amountCents)}) steht ohne Leistungszeitraum ganz im Rumpfzeitraum ${label}. Heizkosten gehören in den Zeitraum, in dem die Wärme verbraucht wurde (BGH VIII ZR 156/11); ist es eine Jahresrechnung, zahlen die Mieter hier die Heizkosten eines ganzen Jahres gegen die Vorauszahlungen weniger Monate. ` +
          'Tragen Sie unter „Weitere Angaben“ den Leistungszeitraum der Rechnung ein. Reicht er über den Rumpf hinaus, lassen Sie die Rechnung zum Stichtag abgrenzen (Zählerstand oder Zwischenrechnung des Versorgers).',
        itemSubject(item))
    }
  }
  for (const item of items) {
    if (item.serviceFrom === undefined || item.serviceTo === undefined) continue
    const range = formatDayRange(item.serviceFrom, item.serviceTo)
    if (item.serviceTo < yFrom || item.serviceFrom > yTo) {
      warn('period.item-outside', `„${item.description}“: Der Leistungszeitraum ${range} liegt außerhalb des Abrechnungszeitraums ${label}. Gehört die Rechnung in einen anderen Zeitraum, ordnen Sie sie dort zu.`, itemSubject(item))
      continue
    }
    if (item.serviceFrom >= yFrom && item.serviceTo <= yTo) continue
    if (item.category === HEATING_CATEGORY) {
      // Heizkosten werden nie nach Tagen geteilt (G-C1): Sie müssen den Verbrauch des Zeitraums
      // abbilden, und Winter und Sommer verbrauchen nicht gleich viel. Heizung PR 7 (Entwurf 3.2,
      // 3.4): Eine mit einer Lieferung verknüpfte Position grenzt Mietfuchs über die Lieferung ab,
      // dazu gibt es nichts zu sagen. Bei einer Anlage mit freien Schlüsseln ohne Verknüpfung der
      // Rat, die Rechnung als Lieferung einzutragen; ohne Anlage wie bisher.
      if (item.fuelDeliveryId) continue
      if ((plants.find((p) => p.id === item.heatingPlantId)?.method ?? 'service') !== 'service') {
        warn('fuel.manual-beyond-period',
          `„${item.description}“: Die Rechnung reicht über die Heizperiode ${label} hinaus (Leistungszeitraum ${range}) und wird ganz verteilt. Heizkosten gehören in die Heizperiode, in der sie verbraucht wurden (BGH VIII ZR 156/11). ` +
            'Tragen Sie die Rechnung auf der Seite Heizkosten als Lieferung ein und verknüpfen Sie die Position mit ihr; dann grenzt Mietfuchs sie ab.',
          itemSubject(item))
        continue
      }
      warn('period.heating-mismatch',
        `„${item.description}“: Heizkosten gehören in den Abrechnungszeitraum, in dem sie verbraucht wurden (BGH VIII ZR 156/11). Der Leistungszeitraum ${range} reicht über ${label} hinaus, und Heizkosten teilt Mietfuchs nicht nach Tagen auf. ` +
          'Lassen Sie die Rechnung zum Stichtag abgrenzen (Zählerstand oder Zwischenrechnung des Versorgers), oder rechnen Sie im Zeitraum Ihres Messdienstes ab.',
        itemSubject(item))
    } else if (item.key === 'meter') {
      // Ein Teil einer aufgeteilten Rechnung (Task 3 trägt an jedem Teil den ganzen
      // Leistungszeitraum). Zeitanteilig ist zulässig, mit dem Zählerstand genauer (Z-B11).
      const stichtag = item.serviceTo > yTo ? yTo : dayBefore(yFrom)
      warn('period.split-by-days-meter', `„${item.description}“ ist nach Tagen auf die Abrechnungszeiträume aufgeteilt. Mit dem Zählerstand zum ${fmtDay(stichtag)} wäre die Aufteilung genauer.`, itemSubject(item))
    }
  }

  // ---------- Eigene Heizperiode (#217, Entwurf 3.0, 3.1, 6.1 Nr. 2, 4 und 7) ----------
  // Rechnet eine Anlage in eigenen Heizperioden ab, stehen ihre Positionen unter der Heizperiode
  // (snapshot.ts). Jede Heizperiode, die in P endet, wird nach Weg b mit derselben Rechnung über ihre
  // eigenen Tage verteilt (`scope: 'heatingPart'`) und hier zusammengeführt; wer nur in der Heizperiode
  // gewohnt hat, bekommt eine Abrechnung nur mit Heizkosten. Eine Heizperiode nach Weg d steht nicht in
  // P; sie hat ihre eigene Abrechnung mit eigener Frist (`separateHeating`).
  const heatingPeriodsShown: HeatingPeriodRef[] = []
  const separateHeating: SeparateHeatingRef[] = []
  const mergedParts: SnapshotHeatingPart[] = []
  const deadlineP = settlementDeadline(period)
  const mergeHeatingPart = (sub: ComputedSettlement, part: SnapshotHeatingPart): void => {
    for (const s of sub.statements) {
      if (s.rows.length === 0) continue
      const own = statements.get(s.tenancyId)
      if (own) {
        own.rows.push(...s.rows)
        own.totalShareCents += s.totalShareCents
        own.total35aCents += s.total35aCents
        continue
      }
      // Hat in P nicht mehr gewohnt: eine Abrechnung nur mit Heizkosten (3.1, R-A4). Ob dafür die
      // Frist von P gilt, ist nicht entschieden (15.1 Nr. 2); empfohlen wird die frühere.
      const end = snapshot.tenancies.find((x) => x.id === s.tenancyId)?.end ?? null
      const recommended = end === null ? null : recommendedDeadline(objectRules, end)
      statements.set(s.tenancyId, {
        ...s, prepaymentCents: 0, prepaymentOverridden: false, suggestedMonthlyCents: 0, balanceCents: 0, heatingOnly: true,
        ...(recommended === null ? {} : { recommendedDeadline: recommended }),
      })
      if (recommended !== null) {
        warn('period.heating-only-statement',
          `Ob eine Abrechnung nur der Heizkosten für ein Jahr, in dem ${s.tenantName} nicht mehr gewohnt hat, die Frist bis ${fmtDay(deadlineP)} hat, ist nicht entschieden. ` +
            `Stellen Sie sie bis ${fmtDay(recommended)} zu. Fordern Sie dafür die Abrechnung des Messdienstes für ${periodLabel(part.period)} bis spätestens ${requestMonth(recommended)} an.`,
          { kind: 'tenancy', id: s.tenancyId })
      }
    }
    landlordRows.push(...sub.landlord.rows)
    // Die Bewertung je Anlage aus der Teilabrechnung nach Weg b (Heizung PR 6).
    heatingStatements.push(...(sub.heating ?? []))
    totalCostsCents += sub.totalCostsCents
    selfUsedShareCents += sub.selfUsedShareCents
    for (const n of sub.notices ?? []) if (!notices.some((m) => m.code === n.code && m.text === n.text)) notices.push(n)
    for (const v of sub.legalBasis?.values ?? []) if (!lawLog.values.some((a) => a.id === v.id && a.validFrom === v.validFrom)) lawLog.values.push(v)
  }
  if (scope === 'all') {
    for (const plant of plants.filter((p) => (p.periodStartMonth ?? null) !== null)) {
      const parts = (snapshot.heatingParts ?? []).filter((x) => x.plantId === plant.id)
      if (parts.length === 0) {
        warn('period.no-heating-period',
          `In der Abrechnung ${label} endet keine Heizperiode der Heizanlage${plant.name ? ` „${plant.name}“` : ''}. Ihre Heizkosten stehen in der Abrechnung, in der ihre Heizperiode endet; prüfen Sie den Zeitraum der Heizung unter Stammdaten.`,
          { kind: 'heatingPlant', id: plant.id })
        continue
      }
      for (const part of parts) {
        if (part.separate) {
          separateHeating.push({ plantId: plant.id, plantName: plant.name ?? '', period: settlementPeriod(part.period), deadline: settlementDeadline(part.period) })
          continue
        }
        heatingPeriodsShown.push({ plantId: plant.id, period: settlementPeriod(part.period) })
        // Ohne Positionen nichts zu rechnen, außer die Anlage hat Lieferungen (Heizung PR 7): Dann
        // bucht diese Heizperiode womöglich den Teil einer Rechnung herein, die in der nächsten steht.
        if (part.items.length === 0 && !(snapshot.fuel?.deliveries.some((d) => d.plantId === plant.id) ?? false)) continue
        if (!sameSpan(part.period, period)) {
          warn('period.heating-differs',
            `Die Heiz- und Warmwasserkosten dieser Abrechnung gelten für die Heizperiode ${periodLabel(part.period)}, die übrigen Kosten für ${label}. ` +
              'Das ist zulässig, wenn Heizkosten und übrige Betriebskosten nicht getrennt abgerechnet werden, also bei einer gemeinsamen Vorauszahlung (BGH, Urteil vom 30.04.2008, VIII ZR 240/07).',
            { kind: 'heatingPlant', id: plant.id })
        }
        const sub = computeSettlement({
          ...snapshot,
          period: part.period,
          previousPeriod: part.previous,
          year: Number(part.period.from.slice(0, 4)),
          costItems: part.items,
          previousCostItems: part.previousItems,
          comparableCostItems: part.comparableItems,
          heatingParts: [],
          // Je Heizperiode entschieden, ob die eigene Abrechnung schon gilt (Durchsicht von #239, N3).
          heatingPlants: (snapshot.heatingPlants ?? []).map((p) => selfAt(p, String(part.period.key))),
          closedSettlement: null,
          scope: { kind: 'heatingPart', plant: selfAt(plant, String(part.period.key)) },
        }, options)
        mergeHeatingPart(sub, part)
        mergedParts.push(part)
      }
    }
    // Hinweise zur Heizstaffel (R13, R-h), je Mietverhältnis, das eine Anlage versorgt.
    for (const t of partTenancies) {
      const own = statements.get(t.id)
      const plant = plants.find((p) => servesUnit(p, t.unit))
      if (!own || !plant) continue
      const same = periodOfKey(plantRules(wayOf(plant), objectRules), period.key)
      if (plant.separateSettlement === true && same !== null && sameSpan(same, period) && own.prepaymentCents > 0 && (own.heatingPrepaymentCents ?? 0) === 0) {
        warn('prepayment.heating-share-missing',
          `${t.tenantName} (${t.unit.name}): Die Heizkosten werden getrennt abgerechnet, die Vorauszahlung ist aber nicht aufgeteilt; die Abrechnung weist für die Heizung 0 € aus. ` +
            'Teilen Sie die Vorauszahlung unter Stammdaten → Heizung auf („Vorauszahlung aufteilen“); an der Summe ändert sich nichts.',
          { kind: 'heatingPlant', id: plant.id })
      }
      // Weg d (Durchsicht von #231): Monate, die einer getrennt abgerechneten Heizperiode gehören, ohne
      // Heizvorauszahlung. Deren Heizkostenabrechnung wiese 0 € aus, und die volle Vorauszahlung stünde
      // in P; typisch für ein neues Mietverhältnis, bei dem die Heizstaffel fehlt.
      const way = wayOf(plant)
      const heizRate: MonthlySchedule[] = Array.isArray(t.heatingPrepayments) ? t.heatingPrepayments : []
      // Ein Einzug mitten im Monat zählt den Monat mit, und eine Heizkorrektur der Heizperiode (endgültig,
      // oder vorläufig für diesen Monat) nennt schon, was gezahlt wurde (Durchsicht von #231, Minor 2).
      const korrigiert = (m: string, key: PeriodKey): boolean => (t.heatingPrepaymentOverrides ?? []).some((o) => o.plantId === plant.id && o.period === key &&
        (!o.provisional || (o.fromMonth !== null && o.toMonth !== null && o.fromMonth <= m && m <= o.toMonth)))
      const ohne = periodMonths(period).filter((m) => {
        if (t.start > `${m}-31` || (t.end && t.end < `${m}-01`)) return false
        const owner = separateOwner(way, objectRules, m)
        return owner !== null && !korrigiert(m, owner.key) && rateAtMonth(heizRate, m) === 0 && rateAtMonth(t.prepayments, m) > 0
      })
      if (ohne.length > 0) {
        warn('prepayment.heating-share-missing',
          `${t.tenantName} (${t.unit.name}): Die Heizkosten ${monthSpanText(ohne)} werden getrennt abgerechnet, für diese Monate ist aber keine Heizvorauszahlung erfasst; ` +
            'die Heizkostenabrechnung weist dafür 0 € aus, und die ganze Vorauszahlung steht in dieser Abrechnung. Tragen Sie die Heizvorauszahlung im Mietverhältnis ein (Stammdaten); die übrige Vorauszahlung verringert sich um denselben Betrag.',
          { kind: 'tenancy', id: t.id })
      }
      const heizstaffel = t.heatingPrepayments ?? []
      const first = [...heizstaffel].sort((a, b) => compareText(a.from, b.from))[0]
      if (first === undefined) continue
      const months = periodMonths(period)
      for (const e of t.prepayments) {
        if (e.from <= first.from || !months.includes(e.from) || heizstaffel.some((h) => h.from === e.from)) continue
        warn('prepayment.heating-share-unchanged',
          `${t.tenantName} (${t.unit.name}): Die Vorauszahlung ändert sich ab ${monthSpanText([e.from])} auf ${fmtCents(e.monthlyCents)}, die Heizvorauszahlung nicht. ` +
            'Gehört die Änderung ganz zu den übrigen Kosten? Sonst tragen Sie ab diesem Monat auch die Heizvorauszahlung neu ein.',
          { kind: 'tenancy', id: t.id })
      }
    }
  }

  // Ohne Abrechnung (#93): wer für keine der beiden Arten abgerechnet wird, oder wessen Abrechnung
  // leer bliebe, weil die abzurechnende Art im Jahr keine Kosten hatte. Ein Mietverhältnis mit
  // Abrechnung und ohne Kosten behält seine leere Abrechnung wie bisher.
  const notSettled: NotSettled[] = []
  for (const t of scope === 'heatingPart' ? [] : partTenancies) {
    const costModel = t.costModel ?? 'settlement'
    const heatingModel = t.heatingModel ?? 'settlement'
    if (costModel === 'settlement' && heatingModel === 'settlement') continue
    const st = statements.get(t.id)
    const neither = costModel !== 'settlement' && heatingModel !== 'settlement'
    // Eine leere Abrechnung entfällt nur ohne Vorauszahlung: Eine echte Vorauszahlung für die
    // abgerechnete Art muss abgerechnet werden, auch wenn im Jahr keine Kosten dieser Art anfielen.
    // Eine Vorauszahlung, gegen die nichts abgerechnet wird, ist meist die frühere Eingabe einer
    // Pauschale (vor #93 gab es kein Feld dafür). Ohne Hinweis würde sie hier still ganz erstattet
    // oder, ohne Abrechnung, im Mietkonto weiter als Soll geführt (Befund der Durchsicht).
    const prepaid = st ? st.prepaymentCents : computePrepaymentCents(t, period).cents
    if (scope === 'all' && prepaid > 0 && (neither || (st && st.rows.length === 0))) {
      warn('model.prepayment-unsettled', neither
        ? `Für ${t.tenantName} (${t.unit.name}) wird nichts abgerechnet, im Mietkonto stehen für ${label} aber Vorauszahlungen von ${fmtCents(prepaid)}. Ist das in Wahrheit die Pauschale, tragen Sie sie unter „Pauschale“ ein und leeren die Vorauszahlung; sonst stimmt das Mietkonto nicht.`
        : `Für ${t.tenantName} (${t.unit.name}) gibt es ${label} keine Kosten der abgerechneten Art, die Vorauszahlung von ${fmtCents(prepaid)} wird deshalb vollständig erstattet. Ist die eingetragene Vorauszahlung in Wahrheit die Pauschale, tragen Sie sie unter „Pauschale“ ein und leeren die Vorauszahlung.`,
      { kind: 'tenancy', id: t.id })
    }
    if (neither || (st && st.rows.length === 0 && st.prepaymentCents === 0)) {
      statements.delete(t.id)
      notSettled.push({ tenancyId: t.id, tenantName: t.tenantName, unitName: t.unit.name, costModel, heatingModel })
    }
  }

  // In der Heizkostenabrechnung steht nur, wer Heizkosten oder eine Heizvorauszahlung hat; eine
  // Garage ohne Anschluss an die Anlage bekäme sonst eine leere Abrechnung (Heizung PR 5).
  if (scope === 'heating') {
    for (const [id, own] of statements) if (own.rows.length === 0 && own.prepaymentCents === 0) statements.delete(id)
  }

  // Rückstand im Mietkonto (#133): Angerechnet wird die Vorauszahlung laut Staffel, solange keine
  // Jahreskorrektur gesetzt ist. Maßgeblich ist aber das tatsächlich Gezahlte (siehe
  // computePrepaymentCents); zeigt das Mietkonto einen Rückstand, ging womöglich ein Guthaben
  // hinaus, das es nicht gibt. Umgerechnet wird nicht: Ob eine Teilzahlung die Kaltmiete oder die
  // Vorauszahlung betraf, weiß nur der Vermieter. Der Rückstand kommt aus `rentLedger` selbst,
  // damit Abrechnung und Mietkonto nie Verschiedenes sagen.
  // **Ohne eine einzige Zahlung des Objekts im Jahr bleibt der Hinweis aus.** Wer keine Zahlungen
  // erfasst, führt das Mietkonto nicht, und dann stünde dort für jedes Mietverhältnis die ganze
  // Jahresmiete als Rückstand; der Hinweis erschiene bei jedem dieser Nutzer an jeder Abrechnung
  // und würde bald überlesen, auch dort, wo er zählt. Gefragt wird nach dem Objekt und nicht nach
  // dem Mietverhältnis, denn wer das Mietkonto führt und für einen Mieter nichts gebucht hat, hat
  // genau den Fall, um den es geht.
  // Gemeldet wird nur, wo eine Vorauszahlung angerechnet wird: Bei Pauschale und Inklusivmiete
  // fällt die Abrechnung oben weg oder rechnet nichts an.
  // **Fällig ist nur, was vor dem Monat des Stichtags liegt.** Das Mietkonto führt das Soll für alle
  // zwölf Monate, im laufenden Jahr also auch für die kommenden; ohne Grenze stünde dann bei jedem
  // Mieter ein Rückstand. Die Miete ist bis zum dritten Werktag fällig (§ 556b Abs. 1 BGB), und
  // eine Überweisung braucht ein paar Tage, bis sie gebucht ist. Den laufenden Monat erst ab einem
  // bestimmten Tag mitzuzählen, hinge an Wochenenden und Feiertagen; einfacher und ohne Fehlalarm
  // ist, ihn gar nicht mitzuzählen. Ein Rückstand des laufenden Monats erscheint dann im nächsten.
  // Liegt der Stichtag nach dem Zeitraum, ist alles fällig, liegt er davor, nichts.
  const ledgerInUse = snapshot.payments.some((p) => p.date >= yFrom && p.date <= yTo)
  // Fällig ist ein Monat des Zeitraums vor dem Monat des Stichtags; ohne Stichtag alle (#133).
  const asOfMonth = options.asOf?.slice(0, 7)
  const anyDue = asOfMonth === undefined || periodMonths(period).some((m) => m < asOfMonth)
  if (scope === 'all' && ledgerInUse && anyDue) {
    // Dieselbe Monatsrechnung wie das Mietkonto, über die Monate des Zeitraums (#208).
    const rowsByTenancy = new Map(ledgerRows(snapshot, period, { asOf: options.asOf }).map((r) => [r.tenancyId, r]))
    for (const st of statements.values()) {
      if (st.prepaymentOverridden || st.prepaymentCents <= 0) continue
      const row = rowsByTenancy.get(st.tenancyId)
      if (!row) continue
      const openCents = row.arrearsCents
      if (openCents <= 0) continue
      // Der Text behauptet nicht, dass die Vorauszahlung fehlt: Im Soll stehen auch Kaltmiete und
      // gegebenenfalls die Pauschale (gemischtes Modell, #93), und welcher Teil offen ist, sieht
      // man erst im Mietkonto.
      const alsoInSoll = row.baseRentYearCents > 0 && row.flatRateYearCents > 0
        ? 'stehen auch Kaltmiete und Pauschale'
        : row.baseRentYearCents > 0 ? 'steht auch die Kaltmiete' : row.flatRateYearCents > 0 ? 'steht auch die Pauschale' : ''
      warn('prepayment.arrears',
        `Im Mietkonto ${label} von ${st.tenantName} (${st.unitName}) sind ${fmtCents(openCents)} offen. Die Abrechnung rechnet die Vorauszahlung laut Vertrag an (${fmtCents(st.prepaymentCents)}); maßgeblich ist aber, was tatsächlich gezahlt wurde. ` +
          'Zahlungen zählen nach ihrem Datum; eine im Dezember vorab gezahlte Januarmiete steht im Vorjahr. ' +
          `Ob die Vorauszahlung betroffen ist, sehen Sie im Mietkonto${alsoInSoll ? `: Im Soll ${alsoInSoll}, der Rückstand kann ebenso sie betreffen` : ''}. ` +
          'Fehlt nur eine Buchung, tragen Sie die Zahlung im Mietkonto nach; ' +
          'hat der Mieter wirklich weniger Vorauszahlung geleistet, tragen Sie den gezahlten Betrag in der Abrechnung bei „abzüglich geleisteter Vorauszahlungen“ mit „✎ anpassen“ ein.',
        { kind: 'rentLedger', id: st.tenancyId })
    }
  }

  // § 2 HeizkostenV: Die Verordnung geht einer Vereinbarung vor; nur im Gebäude mit höchstens zwei
  // Wohnungen, von denen der Vermieter eine selbst bewohnt, darf anderes vereinbart werden. Gemeldet wird nur,
  // wenn es im Jahr eine Heizposition gibt; einen Kürzungsbetrag nennt die Meldung nicht, solange
  // der Rechenweg nach BGH VIII ZR 212/05 nicht geprüft ist (#93).
  const heatingFlat = partTenancies.filter((t) => (t.heatingModel ?? 'settlement') !== 'settlement' && !outsideHeating(t.unit))
  // Die Ausnahme steht in shared/heating.ts, für diese Warnung wie für die Verteilung (#140).
  if (heatingFlat.length > 0 && !heatingAgreeable && items.some((c) => c.category === HEATING_CATEGORY)) {
    const cut = law(hkvCutNotByConsumption, { period: lawPeriod }, lawLog)
    // Bei der eigenen Heizkostenabrechnung kennt Mietfuchs den Betrag nach der Verordnung (Entwurf 6.3).
    const selfFlatList = heatingFlat.flatMap((t) => {
      const raw = selfFlat.get(t.id)
      return raw === undefined ? [] : [`${t.tenantName} (${t.unit.name}) ${fmtCents(Math.round(raw))}`]
    })
    const selfFlatText = selfFlatList.length > 0 ? ` Nach der Heizkostenverordnung entfielen auf ${andList(selfFlatList)}.` : ''
    warn('heating.flat-rate',
      `Für ${andList(heatingFlat.map((t) => `${t.tenantName} (${t.unit.name})`))} ist für Heizung und Warmwasser eine Pauschale oder Warmmiete vereinbart. ` +
        'Die Heizkostenverordnung geht der Vereinbarung vor (§ 2 HeizkostenV); zulässig ist das nur im Gebäude mit höchstens zwei Wohnungen, von denen Sie eine selbst bewohnen. ' +
        'Sonst wird der Heizanteil als Vorauszahlung behandelt, über die Sie nach Verbrauch abrechnen müssen (BGH VIII ZR 212/05). ' +
        `Rechnen Sie trotzdem nicht nach Verbrauch ab, darf der Mieter seinen Anteil um ${cut} % kürzen (§ 12 Abs. 1 HeizkostenV).` + selfFlatText +
        // Die Einliegerwohnung (#116): Wer nur die vermietete Wohnung anlegt, hat womöglich
        // genau das Zweifamilienhaus der Ausnahme. Mietfuchs erkennt es an der eigenen Wohnung,
        // und die fehlt dann. Bei zwei oder mehr angelegten Wohnungen hülfe sie nicht mehr.
        // Nicht bei einer Eigentumswohnung: In einer Anlage hilft die eigene Wohnung nicht (#121).
        (snapshot.units.length === 1 && selfUnits.length === 0 && snapshot.property?.kind !== 'etw'
          ? ' Wohnen Sie selbst im Haus und hat es nur diese beiden Wohnungen, legen Sie Ihre eigene Wohnung unter Stammdaten als selbstgenutzt an; dann gilt die Ausnahme, und die Warnung entfällt.'
          : ''),
      tenancySubject(heatingFlat),
    )
  }

  // Die Höchstdauer hat P gebildet (shared/period.ts); eingefroren wird sie hier.
  law(bgbMaxPeriodMonths, { period: lawPeriod }, lawLog)
  // Vorschlag nach § 560 Abs. 4 BGB (#208, Entwurf 3.7, Heizung PR 5): je Position ein Faktor auf
  // zwölf Monate, siehe prepaymentSuggestion.ts. Gebraucht wird er im Rumpf und, wenn P nach Weg b
  // eine Heizperiode aufnimmt, die selbst ein Rumpf ist; eine volle Heizperiode zählt mit ihrem Betrag
  // (Faktor 1), ebenso jede Position eines vollen P. Die Gradtagstabelle wird nur gefragt (und
  // friert dann ein), wenn eine Brennstoffrechnung mit Leistungszeitraum da ist.
  const degreeDays = () => law(hkvDegreeDays, { period: lawPeriod }, lawLog)
  let shortBasis: AnnualBasis | null = null
  // Der Rumpf einer Heizperiode, an dem der Vorschlag scheitert, wenn P selbst voll ist (Durchsicht von #231).
  let failedShort: BillingPeriod | null = null
  if (period.short || mergedParts.some((p) => p.period.short)) {
    const ones = (list: readonly SnapshotCostItem[]): AnnualBasis => ({ ok: true, factors: new Map(list.map((c) => [c.id, 1])), annualAssumed: [] })
    // Je Basis, woher sie kommt: `null` ist P selbst, sonst der Rumpf einer Heizperiode (für den Text).
    const sources: { basis: AnnualBasis, short: BillingPeriod | null }[] = [
      {
        basis: period.short
          ? annualFactors(period, items, snapshot.previousCostItems ? { period: snapshot.previousPeriod, items: snapshot.previousCostItems } : null, degreeDays)
          : ones(items),
        short: null,
      },
      ...mergedParts.map((p) => ({
        basis: p.period.short ? annualFactors(p.period, p.items, { period: p.previous, items: p.previousItems }, degreeDays) : ones(p.items),
        short: p.period.short ? p.period : null,
      })),
    ]
    const bases = sources.map((x) => x.basis)
    failedShort = sources.find((x) => !x.basis.ok)?.short ?? null
    const failed = bases.find((b) => !b.ok)
    const factors = new Map<string, number>()
    const annualAssumed: string[] = []
    for (const b of bases) {
      if (!b.ok) continue
      for (const [id, f] of b.factors) factors.set(id, f)
      annualAssumed.push(...b.annualAssumed)
    }
    shortBasis = failed ?? { ok: true, factors, annualAssumed }
  }
  const continuing = partTenancies.some((t) => !(t.end != null && t.end <= yTo))
  const basis = shortBasis
  const allItems = [...items, ...mergedParts.flatMap((p) => p.items)]
  // Kalte Positionen ohne Leistungszeitraum (Durchsicht von #226, M3): als Jahresbetrag genommen,
  // nicht hochgerechnet; der Hinweis sagt, wie es genauer wird. Nicht in der Teilabrechnung nach
  // Weg b: Den Vorschlag macht P.
  if (scope !== 'heatingPart' && basis && basis.ok && continuing) {
    for (const id of basis.annualAssumed) {
      const which = allItems.find((c) => c.id === id)
      if (!which) continue
      warn('prepayment.annual-assumed',
        `„${which.description}“ hat keinen Leistungszeitraum. Für den Vorschlag der Vorauszahlung im Rumpfzeitraum ${label} nimmt Mietfuchs den Betrag als Kosten eines ganzen Jahres und rechnet ihn nicht hoch. Deckt die Rechnung nur einen Teil des Jahres ab, tragen Sie ihren Leistungszeitraum unter „Weitere Angaben“ ein.`,
        itemSubject(which))
    }
  }
  if (scope !== 'heatingPart' && basis && !basis.ok && continuing) {
    const which = allItems.find((c) => c.id === basis.costItemId)
    const heizRumpf = !period.short && failedShort !== null ? failedShort : null
    if (heizRumpf) {
      warn('prepayment.no-suggestion', basis.reason === 'unmarked'
        ? `Für die Abrechnung ${label} schlägt Mietfuchs keine neue Vorauszahlung vor: Die Heizperiode ${periodLabel(heizRumpf)} ist ein Rumpf, und keine Position der Heizkosten ist als Brennstoff gekennzeichnet. Kennzeichnen Sie die Brennstoffrechnung (Gas, Öl, Fernwärme, Strom der Wärmepumpe) unter „Weitere Angaben“ mit „Brennstoff/Energie“ und tragen Sie ihren Leistungszeitraum ein; dann rechnet Mietfuchs den Vorschlag nach Gradtagen hoch.`
        : `Für die Abrechnung ${label} schlägt Mietfuchs keine neue Vorauszahlung vor: Die Heizperiode ${periodLabel(heizRumpf)} ist ein Rumpf, und „${which?.description ?? ''}“ ist eine Lieferung ohne Leistungszeitraum. Aus einer Lieferung lässt sich der Jahresverbrauch nicht ableiten; den Vorschlag gibt es nach der nächsten vollen Abrechnung.`,
      which ? itemSubject(which) : undefined)
    } else warn('prepayment.no-suggestion', basis.reason === 'unmarked'
      ? `Für den Rumpfzeitraum ${label} schlägt Mietfuchs keine neue Vorauszahlung vor: Keine Position der Heizkosten ist als Brennstoff gekennzeichnet. Kennzeichnen Sie die Brennstoffrechnung (Gas, Öl, Fernwärme, Strom der Wärmepumpe) unter „Weitere Angaben“ mit „Brennstoff/Energie“ und tragen Sie ihren Leistungszeitraum ein; dann rechnet Mietfuchs den Vorschlag nach Gradtagen hoch.`
      : `Für den Rumpfzeitraum ${label} schlägt Mietfuchs keine neue Vorauszahlung vor: „${which?.description ?? ''}“ ist eine Lieferung ohne Leistungszeitraum. Aus einer Lieferung lässt sich der Jahresverbrauch nicht ableiten; den Vorschlag gibt es nach der nächsten vollen Abrechnung.`,
    which ? itemSubject(which) : undefined)
  }
  const result: ComputedSettlement = {
    year,
    daysInYear: diy,
    period: settlementPeriod(period),
    // Frist und Höchstdauer des Zeitraums frieren mit ein wie jeder Rechtswert (#208, Entwurf 4.4).
    deadline: settlementDeadline(period, law(bgbDeadlineMonths, { period: lawPeriod }, lawLog)),
    ...(heatingPeriodsShown.length > 0 ? { heatingPeriods: heatingPeriodsShown } : {}),
    ...(separateHeating.length > 0 ? { separateHeating } : {}),
    ...(scope === 'heating' && snapshot.scope
      ? { scope: { kind: 'heating' as const, plantId: snapshot.scope.plant.id, plantName: snapshot.scope.plant.name ?? '' } }
      : {}),
    statements: [...statements.values()],
    notSettled,
    // Eine Regel, und der Server entscheidet sie: Das Cockpit liest die Einstufung von hier, statt
    // sie aus seinen eigenen Daten nachzubauen (#135). Alle Mietverhältnisse zählen, auch die mit
    // Inklusivmiete oder Pauschale, die in `statements` fehlen.
    garageLikeUnitIds: snapshot.units.filter((u) => (u.participates || u.selfUsed) && isGarageLike(u)).map((u) => u.id),
    // Je Heizanlage und Heizperiode, was der Druckblock braucht (Heizung PR 6, Entwurf 9.5); ohne
    // Heizanlage fehlt das Feld, und eine Abrechnung ohne Anlage bleibt wortgleich.
    ...(heatingStatements.length > 0 ? { heating: heatingStatements } : {}),
    landlord: {
      rows: landlordRows,
      totalCents: landlordRows.reduce((a, r) => a + r.shareCents, 0),
    },
    // Im Vermieteranteil enthaltener Teil, der auf selbstgenutzte Wohnungen entfällt
    // (der Rest sind Leerstand, nicht umlagefähige Positionen und Rundungsdifferenzen).
    selfUsedShareCents,
    totalCostsCents,
    notices,
    warnings: notices.map((n) => n.text),
    // Der Rechtsstand (#112): Datum des Rechtsregisters, die Regeln des Jahres und die Rechtswerte,
    // mit denen gerechnet wurde (Heizung PR 1). Die abgeschlossene Abrechnung friert das Ergebnis
    // wortgleich ein und damit auch ihn.
    legalBasis: {
      asOf: LAW_AS_OF,
      rules: rulesFor(yFrom, yTo).map(({ code, title, norm, validFrom, validTo }) => ({
        code, title, norm, ...(validFrom ? { validFrom } : {}), ...(validTo ? { validTo } : {}),
      })),
      values: lawLog.values,
    },
  }
  const tenancyEnd = new Map(partTenancies.map((t) => [t.id, t.end]))
  // Eine CO₂-Abzugszeile (Heizung PR 6) hat keine Position und damit keinen eigenen Faktor. Sie gehört
  // zu den Messdienstpositionen ihres Topfs (`co2:<Anlage>:<Heizperiode>`) und wird mit deren Faktor
  // hochgerechnet, gewichtet nach den Zeilen des Mieters (Durchsicht M-4: ohne Faktor fiel sie aus
  // dem Vorschlag, und der war zu hoch).
  const itemById = new Map(allItems.map((c) => [c.id, c]))
  const reliefFactor = (rows: readonly SettlementRow[], key: string, factors: ReadonlyMap<string, number>): number => {
    const own = rows.filter((r) => {
      const c = itemById.get(r.costItemId)
      return c !== undefined && c.key === 'amounts' && `co2:${c.heatingPlantId ?? ''}:${c.period}` === key
    })
    const sum = own.reduce((a, r) => a + r.shareCents, 0)
    return sum === 0 ? 0 : own.reduce((a, r) => a + r.shareCents * (factors.get(r.costItemId) ?? 0), 0) / sum
  }
  for (const st of result.statements) {
    st.balanceCents = st.prepaymentCents - st.totalShareCents // >0 Guthaben, <0 Nachzahlung
    // Eine Abrechnung nur mit Heizkosten hat keine künftige Vorauszahlung (3.7: „heatingOnly ergibt
    // keinen Vorschlag“).
    if (st.heatingOnly) {
      st.suggestedMonthlyCents = 0
      continue
    }
    // Vorschlag nach §560 Abs. 4 BGB: ein Zwölftel der Jahreskosten, auf volle Euro gerundet.
    // Die Kosten fallen künftig für zwölf Monate an; wer erst im Jahr einzog, hat einen Anteil für
    // weniger Tage, der deshalb auf das volle Jahr hochgerechnet wird (#134). Das ist eine
    // Vergröberung: Bei einem kurzen Teiljahr vervielfacht die Hochrechnung jede Zufälligkeit
    // (ein Einzug im November ergibt den Faktor sechs), und verbrauchsabhängige Kosten wie Heizung
    // fallen nicht gleichmäßig übers Jahr an, ein Winterhalbjahr ergibt also zu viel, ein Sommer
    // zu wenig. Es bleibt ein Vorschlag, den der Vermieter vor dem Versand prüft.
    // Endet das Mietverhältnis im Jahr, auch zum 31.12., gibt es keine künftige Vorauszahlung und
    // keinen Vorschlag; 0 heißt für die Oberfläche „nichts anzeigen“. Im Rumpfzeitraum rechnet
    // `annualFactors` je Position hoch (#208).
    const end = tenancyEnd.get(st.tenancyId)
    const noFuture = (end != null && end <= yTo) || st.days <= 0
    if (noFuture || (shortBasis !== null && !shortBasis.ok)) {
      st.suggestedMonthlyCents = 0
    } else if (shortBasis !== null) {
      // Im Rumpf: jede Zeile mit ihrem Faktor auf zwölf Monate, dann wie im vollen Zeitraum auf die
      // Tage des Mieters bezogen (#134) und auf volle Euro gerundet.
      const factorOf = (row: SettlementRow): number => (row.kind === 'co2Relief' ? reliefFactor(st.rows, row.costItemId, shortBasis.factors) : (shortBasis.factors.get(row.costItemId) ?? 0))
      const annual = st.rows.reduce((a, row) => a + row.shareCents * factorOf(row), 0)
      st.suggestedMonthlyCents = Math.max(0, Math.round((annual * diy) / st.days / 12 / 100) * 100)
    } else {
      // Nie negativ: Überwiegen Gutschriften, gibt es keine Vorauszahlung unter 0 (Integrationsdurchsicht).
      st.suggestedMonthlyCents = Math.max(0, Math.round((st.totalShareCents * diy) / st.days / 12 / 100) * 100)
    }
  }
  return result
}

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
  HeatingModel,
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
  TaxMovedOut,
  TaxOutflow,
  TaxReport,
  FuelDeliveryLine,
  HeatingTarget,
  HotWater,
  SelfHeatingStatement,
  SelfPot,
  SelfPotView,
  SelfUnitView,
  SelfUserView,
  HeatingEstimate,
  SelfEstimateOption,
  SelfEstimateView,
  AgreedOtherwise,
  ExemptionScope,
  HeatingExemption,
  HeatingInfoStatement,
  HeatingRules,
  InfoItem,
} from '../../shared/types.ts'
// Die Berechnung kennt den Speicher nicht mehr, sondern nur noch den Schnappschuss eines
// Abrechnungsjahres (siehe snapshot.ts). Welche Sammlung darin nach Jahr eingegrenzt sein darf,
// entscheidet dort die Ablage und nicht hier.
import { rulesFor } from '../../shared/law/rules.ts'
import { co2ApplicableFrom, co2CostsBefore, co2CostsCountedFrom, co2CostsExcludedUntil, co2CutMissing, co2DistrictEtsNew, co2FirstPeriodStart, co2HalfSplit, co2HalfSplitEmergency, co2HalfSplitNewBuildings, co2HalfSplitTwoFamily, co2NonResidential, co2Restriction, co2RoundingDecimals, co2SelfSupply, co2StageTable, halfSplitBioFirstDay, halfSplitEnactedOn, halfSplitFirstDay } from '../../shared/law/co2kostaufg.ts'
import { gmodgHeating43 } from '../../shared/law/gmodg.ts'
// rangeOverlapDays: Überlappung zweier Zeiträume in Tagen, eine Stelle mit der Monatsregel.
import { monthShare, overlapDays as rangeOverlapDays, rateAtMonth, rateInMonth, type MonthlySchedule } from '../../shared/monthRate.ts'
import { applicableRanges, blendedPermille, halfAmounts, halfSplitStatus, intersect as intersectRange, termsFromDeliveries, termsFromPieces, termsWeight, tightMarketIn, twoFamilyOf, type HalfDelivery, type HalfSplitStatus, type HalfSplitTerm, type Piece, type TwoFamily } from './halfSplit.ts'
import { CO2_RELIEF_LABEL } from '../../shared/co2Probe.ts'
import { ausweisGaps, CO2_FUELS, co2Assessment, co2Required, NO_CO2_FUELS, co2DeductionsOf, FORMULA_METHODS, co2PotsOf, itemBasisUnits, L_TOLERANCE_CENTS, perUnitClassification, perUnitExceeding, perUnitReliefs, gmodgKeyOf, HALF_SPLIT_TOLERANCE_PERMILLE, reliefKeysOf, reliefsByShare, spanningPlants, type PerUnitFuel, restage, selfSplit, SERVICE_FUEL_TOLERANCE_CENTS, shownReliefs, stageRanges, tableFactor, tenantLines as co2TenantLines, type Co2Pot, type ReliefShare } from './co2.ts'
// Zahlen und Daten der Rechtsregeln kommen aus dem Rechtsregister (Heizung PR 1) und stehen hier
// nicht als Literal; server/test/law-literals.test.ts wacht darüber.
import { coversDate, createLawLog, dayAfter, dayBefore, law, LAW_AS_OF, onlyVersion, recordVersionAt, VALUE_CHANGE_LABEL, valueAt, type Period } from '../../shared/law/register.ts'
import { betrkvGenerationPower, betrkvTvSignal, bgbDeadlineMonths, bgbHeatDeliverySwitch, bgbMaxPeriodMonths } from '../../shared/law/bgb-betrkv.ts'
import { switchFindings, switchText } from './heatDelivery.ts'
import { cheapRentOf } from './cheapRent.ts'
import { hkvConsumptionShare, hkvConsumptionShareForced, hkvCutInformation, hkvCutNotByConsumption, hkvCutRemoteReading, hkvDegreeDays, hkvEstimateThreshold, hkvExemptions, hkvGenerationPower, hkvInfoDistrict, hkvMonthlyInfo, hkvHeatPumpCapture, hkvRemoteReadingNewDevices, hkvRemoteReadingRetrofit, hkvRenewableExemption, hkvSettlementInfo, type DegreeDayTable } from '../../shared/law/heizkostenv.ts'
import { plantDevices, remoteReadingVerdict, servedUnitIds } from './remoteReading.ts'
import { monthlyInfoMonths, openMonths } from './monthlyInfo.ts'
import { MONTHLY_INFO_GAP_TEXT, monthRanges } from '../../shared/monthlyInfo.ts'
import { heatingInfoOf, heatingRulesOf, planByConsumption, type RuleRow } from './heatingInfo.ts'
import { co2ExemptionOf, co2OffByExemptionOf, exemptionScopeFor, exemptionText as exemptionTextOf } from './co2Exemption.ts'
import { AGREED_FIXED_SELF_TEXT, INFO_CONTACTS, INFO_CONTACTS_CHECKED } from '../../shared/heatingInfo.ts'
import { practiceReadingOffWarning, practiceVacancyPersons } from '../../shared/law/practice.ts'
import { partShare } from '../../shared/splitPart.ts'
import { HEATING_CATEGORY, heatingByConsumption, heatingFindings, mayAgreeOtherwise, PART_OF_POT, POT_OF_PART } from '../../shared/heating.ts'
import { andList, meterTypeLabel, plural } from '../../shared/wording.ts'
import type { TermId } from '../../shared/glossary.ts'
import { allocationOf, comparablePrevious, sameAllocation, sameUnits } from '../../shared/allocation.ts'
import { invoicesOf, possibleDuplicates, receiptedSources } from '../../shared/duplicates.ts'
import { commonPeriod, tenancyOverlaps } from '../../shared/tenancyOverlap.ts'
import { baseUsage, unitAsOf, usageChangesWithin, usageDays, usageFlags, usageSpans, type UsageSpan } from '../../shared/unitUsage.ts'
import type { UnitUsage } from '../../shared/types.ts'
import { knownUnit, metersByUnitText, unitLabel, unitScale, type UnitScale } from '../../shared/meterUnits.ts'
import { CALENDAR_RULES, calendarYearPeriod, contextOf, formatDayRange, periodContaining, periodDays, periodLabel, periodMonths, periodOfKey, periodsBetween, previousPeriod, rulesOf, settlementDeadline, settlementPeriod, spansTwoYears, startYearOf, type PeriodContext } from '../../shared/period.ts'
import { allowsPaidOn, paidOnSpan, paidOnYear } from '../../shared/paidOn.ts'
import { generatorEnergy, noCo2Supplier } from '../../shared/heatDelivery.ts'
import { lineRoot, unitBasisOf, monthSpanText, plantRules, plantSpan, recommendedDeadline, requestMonth, sameBuilding, sameFuelLine, sameLine, sameSpan, separateOwner, servesUnit, settledSeparately } from '../../shared/heatingPeriod.ts'
import { heatingSnapshotFor, selfAt, snapshotFor, wayOf } from './snapshot.ts'
import { outflowShares, paidWhollyIn, storedOutflowYear } from './outflow.ts'
import { deliveryShare, notInvoiceDeliveries, plantFuel, rangeOf, type FuelCarry, type FuelResult, type ShareContext } from './fuel.ts'
import { co2Plausibility, etsExempt as etsExemptPlant, plausibilityText } from './co2Plausibility.ts'
import { billMissingText, deductionMissingText, generationPowerText, notReportedDeductions, notReportedText, selfSupplyPowerText, missingOperatingPowerText, missingPowerFindings, operatingPowerBalance, operatingPowerFindings, operatingPowerText, unmarkedPowerCredits, type OperatingPowerBalance } from './operatingPower.ts'
import { GENERAL_POWER_CATEGORY } from '../../shared/operatingPower.ts'
import { LAW_PARAMS } from '../../shared/law/params.ts'
import { fuelFromDeliveries, fuelFromStock, isFuelMarked, looseCentsOf, measuredOffset, problemText, settledByDefault, stockKeysOf, stockOf, stockTemplateOfLine, stockTouched, valueOf as stockValueOf, type FuelFigures, type StockPeriodInput, type StockResult } from './fuelStock.ts'
import { isStockEnergy, STOCK_FUEL_NAMES, STOCK_UNIT_TEXT } from '../../shared/fuelStock.ts'
import { degreeDayPermille, type DayRange } from '../../shared/degreeDays.ts'
import { claimDeadline, nextSettlement, prepaymentAgreed, refundDueDate, refundLawAt, refundProposal, refundSteps, type LawAsk } from './co2Refund.ts'
import { annualFactors, type AnnualBasis } from './prepaymentSuggestion.ts'
import {
  boundaryReadingsOf, consumptionSharesOf, estimateDeviceType, estimateKey, estimateProposals, heatPumpStatus, heatPumpWithoutMonthlyInfo, lineShareRows, OIL_OR_GAS, hotWaterShareOf, measuredBetween, planSelf, sortReadings, targetProblem, usersOf, weightsOf,
  type Alpha, type ConsumptionShares, type HeatPumpVerdict, type SelfInput, type SelfPlan, type SelfProblem, type SelfReading, type SelfTenancy, type SelfUnit, type SelfUnitPlan, type SelfUserPlan, type SelfWeights,
} from './heating.ts'
import { DHW_PLAUSIBLE, dhwProblemText, fmtShare } from './dhw.ts'
import { CAPTURE_TEXT, captureOf, coversPeriod, estimateFits, hotWaterOf, lineServiceRows, potUnitFor, serviceUnitsMixed, deviceCutoffs, isServiceMeter, deviceCutoffText, deviceLines, meterFactor, missingRatings, missingRatingsText, mixedCapture, mixedCaptureText, serviceMeters, withoutEstimatedSwitches } from './hca.ts'
import { FUEL_GRADE_LABELS, HEATING_VALUE_UNIT_TEXT } from '../../shared/fuelGrades.ts'
import { calibrationOverdue } from './calibration.ts'
import type { FrozenItemSelfUse, Snapshot, SnapshotCostItem, SnapshotHeatingPart, SnapshotHeatingPlant, SnapshotMeter, SnapshotPayment, SnapshotReading, SnapshotTenancy, SnapshotUnit } from './snapshot.ts'

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

// Ein Datumstext als Zeitpunkt in UTC. Die Zählerrechnung vergleicht dieselben Texte sehr oft (je Ablesung,
// Segment und Position); das Zerlegen kostete rund ein Zehntel der Abrechnung (Leistungsprüfung, Befund 3).
// Deshalb gemerkt: Der Wert hängt nur am Text. Begrenzt, damit ein lange laufender Server nicht wächst; beim
// Überlauf wird der Speicher geleert, das Ergebnis bleibt dasselbe (calc-zahlenformat.test.ts).
const UTC_CACHE = new Map<string, number>()
const UTC_CACHE_MAX = 20000
export function toUTC(iso: string): number {
  const hit = UTC_CACHE.get(iso)
  if (hit !== undefined) return hit
  const [y, m, d] = iso.split('-').map(Number)
  const value = Date.UTC(y, m - 1, d)
  if (UTC_CACHE.size >= UTC_CACHE_MAX) UTC_CACHE.clear()
  UTC_CACHE.set(iso, value)
  return value
}

export function daysInYear(year: number): number {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365
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
  // #342: error, denn nach dem Zählertyp wird nicht verteilt (Verbrauchsschlüssel) bzw. die Anlage nicht (eigene
  // Heizkostenabrechnung); der Betrag steht beim Vermieter.
  'meter.units-mixed': { level: 'error', title: 'Zähler in verschiedenen Einheiten', terms: ['meterUnit', 'consumptionKey'] },
  // Durchsicht von #342 (E1): Eine unbekannte Einheit neben anderen rechnet wie vor #342 mit Faktor 1; ob das stimmt,
  // weiß nur der Vermieter. warning, weil ein Mieter zu viel zahlen kann, aber nichts gesperrt ist.
  'meter.unit-unknown': { level: 'warning', title: 'Einheit eines Zählers unbekannt', terms: ['meterUnit', 'consumptionKey'] },
  // E2: Bei gemischt bekannten Einheiten rechnet ein Topf der eigenen Abrechnung in der Grundeinheit, und eine
  // Schätzung nach § 9a gilt dann in ihr. Ein Hinweis, weil die Zahl womöglich in der Einheit der Zähler gemeint war.
  'heating.estimate-base-unit': { level: 'hint', title: 'Schätzung in der Grundeinheit', terms: ['meterUnit', 'heatingEstimate'] },
  // Heizung PR 21 (#98): eine Warnung, keine Sperre; die Werte werden verwendet (Entwurf 3.12, #91). Nur auf der
  // Zähler-Seite und im Cockpit, nie auf der Abrechnung (wie die übrigen Zählerhinweise).
  'meter.calibration-overdue': { level: 'warning', title: 'Eichfrist abgelaufen', rule: 'meter-calibration', terms: ['meterCalibration', 'meterReading'] },
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
  // Nutzungswechsel (#259): eine Auskunft, nichts ist falsch erfasst; färbt das Cockpit nicht.
  'usage.changed': { level: 'hint', title: 'Nutzung wechselt im Zeitraum', terms: ['usageChange', 'ownShare'] },
  // Ein Mietverhältnis in einer Zeit, in der die Einheit nicht vermietet ist: Die Angaben widersprechen sich, und
  // für diese Tage trägt der Mieter nichts. `error` wie #204, denn nur der Vermieter weiß, welche Angabe stimmt.
  'usage.tenancy-conflict': { level: 'error', title: 'Mietverhältnis in einer Zeit ohne Vermietung', terms: ['usageChange'] },
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
  // Heizung PR 14, Durchsicht von #243, G-K3.
  'co2.exempt-deducted': { level: 'warning', title: 'CO₂-Abzug trotz Ausnahme nach § 11', rule: 'heating-exemption', terms: ['co2Deducted', 'heatingCostOrdinance'] },
  // Heizung PR 17 (#97, Entwurf 15.2 F6): kg oder CO₂-Kosten einer Rechnung passen nicht zum Gesetz.
  'co2.cost-implausible': { level: 'hint', title: 'CO₂-Angaben der Rechnung prüfen', terms: ['co2Split', 'ebev'] },
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
  // #251: Gutschrift ohne Rechnung; bestätigt (`creditNoteKind`), dass die Rechnung dazu nicht in Mietfuchs steht, nur ein Hinweis.
  'fuel.credit-only': { level: 'warning', title: 'Gutschrift ohne Rechnung', rule: 'heating-consumed-fuel', terms: ['fuelDelivery', 'accrualPrinciple'] },
  'fuel.credit-only-confirmed': { level: 'hint', title: 'Gutschrift ohne Rechnung', rule: 'heating-consumed-fuel', terms: ['fuelDelivery', 'accrualPrinciple'] },
  'fuel.estimate-undistributed': { level: 'warning', title: 'Schätzung wird nicht verteilt', rule: 'heating-consumed-fuel', terms: ['fuelDelivery', 'accrualPrinciple'] },
  'fuel.estimated': { level: 'hint', title: 'Brennstoffkosten geschätzt', rule: 'heating-consumed-fuel', terms: ['accrualPrinciple', 'degreeDays'] },
  'fuel.estimate-settled': { level: 'warning', title: 'Schätzung durch die Rechnung ersetzt', rule: 'heating-consumed-fuel', terms: ['accrualPrinciple', 'settlementDeadline'] },
  'fuel.estimate-overcharged': { level: 'warning', title: 'Schätzung war zu hoch', rule: 'heating-consumed-fuel', terms: ['accrualPrinciple', 'settlementDeadline'] },
  'fuel.loose-item': { level: 'hint', title: 'Heizposition ohne Lieferung neben einer Lücke', rule: 'heating-consumed-fuel', terms: ['accrualPrinciple', 'fuelDelivery'] },
  'fuel.cancelled-after-close': { level: 'warning', title: 'Rechnung nach dem Abschluss storniert', rule: 'heating-consumed-fuel', terms: ['fuelDelivery', 'settlementDeadline'] },
  // #251 (R-4): Der heutige Teil einer abgeschlossenen Heizperiode liegt unter dem eingefrorenen, bis unter 0 €.
  'fuel.reduced-after-close': { level: 'warning', title: 'Rechnung nach dem Abschluss gemindert', rule: 'heating-consumed-fuel', terms: ['fuelDelivery', 'settlementDeadline'] },
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
  // Heizung PR 14 (#99, Entwurf 8.8, 8.9, 10.1); ersetzt `heating.self-6a-missing` aus der Durchsicht von #239.
  'heating.info-incomplete': { level: 'warning', title: 'Angaben zur Heizkostenabrechnung unvollständig', rule: 'heating-info', terms: ['billingInfo'] },
  'heating.info-open': { level: 'hint', title: 'Angaben zur Heizkostenabrechnung prüfen', rule: 'heating-info', terms: ['billingInfo'] },
  'heating.monthly-info': { level: 'warning', title: 'Monatliche Verbrauchsinformation', rule: 'heating-info', terms: ['billingInfo', 'monthlyConsumptionInfo'] },
  'heating.exemption': { level: 'hint', title: 'Ausnahme von der Heizkostenverordnung', rule: 'heating-exemption', terms: ['heatingCostOrdinance'] },
  'heating.key-change': { level: 'hint', title: 'Anteil nach Verbrauch geändert', rule: 'heating-key-change', terms: ['consumptionCosts', 'keyChange'] },
  'heating.change-split-time': { level: 'hint', title: 'Mieterwechsel zeitanteilig statt nach Gradtagen', rule: 'heating-tenant-change', terms: ['interimReading', 'degreeDays'] },
  // #314: Auskunft (INFORMATIONAL), die Gegenrichtung zu `heating.change-split-time`.
  'heating.change-split-degree-days': { level: 'hint', title: 'Leerstand oder Wechsel nach Gradtagen geteilt', rule: 'heating-tenant-change', terms: ['degreeDays', 'vacancy'] },
  'heating.change-fee': { level: 'hint', title: 'Kosten der Zwischenablesung', rule: 'heating-tenant-change', terms: ['interimReading'] },
  'meter.change-fee': { level: 'hint', title: 'Kosten der Zwischenablesung', terms: ['changeFee', 'meterReading'] },
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
  'heating.pipe-heat': { level: 'hint', title: 'Rohrwärme', rule: 'heating-own-settlement', terms: ['pipeHeat', 'heatCostAllocator'] },
  'heating.pre-capture': { level: 'hint', title: 'Vorerfassung nach Nutzergruppen möglich', rule: 'heating-own-settlement', terms: ['preCapture'] },
  'heating.hca-factor-missing': { level: 'error', title: 'Skala oder Bewertungsfaktor fehlt', rule: 'heating-own-settlement', terms: ['heatCostAllocator'] },
  // Heizung PR 13 (#99, Entwurf 8.7, 10.1): Schätzung nach § 9a.
  'heating.estimate-unconfirmed': { level: 'warning', title: 'Schätzung nicht bestätigt', rule: 'heating-estimate', terms: ['heatingEstimate'] },
  'heating.estimated': { level: 'hint', title: 'Verbrauch geschätzt', rule: 'heating-estimate', terms: ['heatingEstimate'] },
  'heating.estimate-over-25': { level: 'hint', title: 'Geschätzte Fläche über der Grenze: nur nach Fläche', rule: 'heating-estimate', terms: ['heatingEstimate', 'baseCosts'] },
  // Prüfbericht vom 05.10.2026, A9 (Abweichung 11 des Plans).
  // Durchsicht von #242, R-I7: bestätigt, also vom Vermieter als unbrauchbar markiert; eine Auskunft, kein Fehler.
  'heating.estimate-complete': { level: 'hint', title: 'Schätzung ersetzt vollständige Ablesung', rule: 'heating-estimate', terms: ['heatingEstimate'] },
  // Durchsicht von #242: G-I1, G-M1, G-M2, G-M7.
  'heating.estimate-stale': { level: 'error', title: 'Schätzung passt nicht zur Erfassung', rule: 'heating-estimate', terms: ['heatingEstimate'] },
  // Durchsicht Runde 2, N-I1: dieselbe Lage neben vollständiger Ablesung; es gilt die Ablesung.
  'heating.estimate-stale-unused': { level: 'warning', title: 'Veraltete Schätzung nicht verwendet', rule: 'heating-estimate', terms: ['heatingEstimate'] },
  'heating.estimate-no-device': { level: 'warning', title: 'Schätzung ohne Gerät', rule: 'heating-estimate', terms: ['heatingEstimate'] },
  'heating.estimate-below-measured': { level: 'hint', title: 'Schätzung unter dem abgelesenen Verbrauch', rule: 'heating-estimate', terms: ['heatingEstimate'] },
  'heating.estimate-same-day': { level: 'warning', title: 'Schätzung neben zwei Ständen am selben Tag', rule: 'heating-estimate', terms: ['heatingEstimate'] },
  // Heizung PR 15 (#212): Betriebsstrom, der auch im Allgemeinstrom steckt, ohne Abzug in gleicher Höhe.
  // Durchsicht von #252, G-K3: ein Abzug, der anders verteilt ist als seine Stromrechnung.
  'heating.operating-power-key': { level: 'warning', title: 'Abzug anders verteilt als die Stromrechnung', terms: ['operatingPower', 'allocationKey'] },
  // Durchsicht von #252, G-W1: mehr Abzug als Stromrechnung.
  'heating.operating-power-exceeds': { level: 'warning', title: 'Mehr Abzug als Stromrechnung', terms: ['operatingPower'] },
  // Durchsicht von #252, N1: Den Hinweis `heating.operating-power-tax-year` (Betriebsstrom und Abzug in verschiedenen
  // Steuerjahren) gibt es seit #268 nicht mehr: Die Steuerübersicht gleicht je Steuerjahr aus, es verschiebt sich nichts.
  'heating.operating-power-double': { level: 'warning', title: 'Betriebsstrom und Abzug beim Allgemeinstrom passen nicht zusammen', terms: ['operatingPower', 'heatingCostOrdinance'] },
  // Folge-PR zu #252: Betriebsstrom fehlt (#224; färbt die Ampel nicht, Entscheidung F6) und Strom zur
  // Wärmeerzeugung einer Wärmepumpe oder eines Elektrokessels womöglich im Allgemeinstrom (#253).
  'heating.operating-power-missing': { level: 'hint', title: 'Betriebsstrom der Heizung fehlt', terms: ['operatingPower', 'heatingCostOrdinance'] },
  // Heizung PR 16 (#213): Umstellung auf Wärmelieferung im laufenden Mietverhältnis. Ein Hinweis, denn Mietfuchs
  // kann die Voraussetzungen des § 556c BGB nicht prüfen und nichts beziffern. Der Titel nennt § 556c nicht, denn
  // der Text sagt auch, wann er nicht gilt (Prüfung R-S3).
  'heating.contracting': { level: 'hint', title: 'Umstellung auf Wärmelieferung', terms: ['heatDelivery', 'heatingCostOrdinance'] },
  // Integrationsdurchsicht 0.13.0: Bis 0.12 legte ein Kesseltausch die Liste der Wohnungen fest; eine später angelegte
  // Wohnung hing an keiner Anlage, und ihre Heizkosten trugen die übrigen Mieter. Ob eine Liste vom Vermieter oder vom
  // Tausch stammt, lässt sich nicht unterscheiden, deshalb kein Datenschritt, sondern dieser Hinweis.
  'heating.unit-unserved': { level: 'warning', title: 'Wohnung an keiner Heizanlage', terms: ['heatingSystem'] },
  'heating.generation-power-missing': { level: 'hint', title: 'Strom zur Wärmeerzeugung womöglich im Allgemeinstrom', terms: ['operatingPower', 'heatingCostOrdinance'] },
  // #266: mit Angabe an der Anlage. Fehlt der Abzug trotz Angabe, ist das der Fall aus BGH V ZR 166/15 und VIII ZR 27/07
  // und färbt die Ampel; fehlt nur die Rechnung des eigenen Stromvertrags, trägt der Vermieter eigenes Geld (INFORMATIONAL).
  'heating.operating-power-deduction-missing': { level: 'hint', title: 'Abzug des Betriebsstroms fehlt', terms: ['operatingPower', 'heatingCostOrdinance'] },
  // Heizung PR 19, Durchsicht S-2: zentrale Heizung mit Brennstoff beim Mieter, ohne Heizanlage.
  'heating.self-supply-operating-power': { level: 'hint', title: 'Betriebsstrom der Heizung des Mieters im Allgemeinstrom?', terms: ['operatingPower', 'co2Refund'] },
  'heating.operating-power-bill-missing': { level: 'hint', title: 'Rechnung des Heizungsstromzählers fehlt', terms: ['operatingPower'] },
  // #270: Abzug ohne Verweis, nach Angabe des Vermieters dem Messdienst nicht gemeldet; er trägt ihn selbst (INFORMATIONAL).
  'heating.operating-power-not-reported': { level: 'hint', title: 'Betriebsstrom dem Messdienst nicht gemeldet', terms: ['operatingPower'] },
  // Heizung PR 17 (Entwurf 4.5, 10.1): ein Rechtswert, den der Vermieter eingetragen hat.
  'law.value-overridden': { level: 'hint', title: 'Selbst eingetragener Rechtswert', terms: ['legalBasis'] },
  'model.prepayment-unsettled': { level: 'warning', title: 'Vorauszahlung ohne Abrechnung', terms: ['prepayment', 'flatRate'] },
  'prepayment.arrears': { level: 'warning', title: 'Rückstand im Mietkonto', terms: ['prepayment'] },
  // #311: ein Hinweis, denn nichts ist falsch erfasst; die Monatsregel ist eine Auslegung und der
  // Vermieter prüft sie am tatsächlich Gezahlten (INFORMATIONAL, färbt die Ampel nicht).
  'prepayment.partial-month': { level: 'hint', title: 'Vorauszahlung im angebrochenen Monat', terms: ['prepayment', 'partialMonth'] },
  // #258 (Entwurf Entscheidungen 5 und 6): eine Auskunft, kein Fehler. Der Mietvertrag legt eine Position nicht um,
  // ihr Anteil bleibt beim Vermieter; bei „Sonstige Betriebskosten“ fehlt die Antwort, ob der Vertrag sie benennt.
  'allocation.not-agreed': { level: 'hint', title: 'Im Mietvertrag nicht vereinbart', terms: ['notAgreedCosts', 'allocable'] },
  'allocation.other-unanswered': { level: 'hint', title: 'Sonstige Betriebskosten im Mietvertrag benannt?', terms: ['namedOtherCosts', 'notAgreedCosts'] },
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
  // Heizung PR 18 (#215): §§ 5a, 5b, 5d CO2KostAufG (Entwurf 10.1; `co2.half-split-missing` nach Abweichung 9 des Plans).
  'co2.half-split': { level: 'hint', title: 'Hälftige Teilung nach § 5a', rule: 'co2-half-split', terms: ['co2HalfSplit', 'co2Split'] },
  'co2.half-split-two-family': { level: 'hint', title: 'Zweifamilienhaus: Teilung nach § 5d Abs. 3', rule: 'co2-half-split', terms: ['co2HalfSplit'] },
  'co2.half-split-missing': { level: 'warning', title: 'Angaben für die Teilung nach § 5a fehlen', rule: 'co2-half-split', terms: ['co2HalfSplit'] },
  // Heizung PR 19 (#97): Mieter, die selbst heizen (Prüfung M3).
  'co2.self-supply-items': { level: 'hint', title: 'Heizkosten bei einem Mieter, der selbst heizt', rule: 'co2-self-supply', terms: ['co2Refund', 'co2Split'] },
  'co2.self-supply-mixed': { level: 'error', title: 'Mieter heizt selbst und hängt an Ihrer Heizanlage', rule: 'co2-self-supply', terms: ['co2Refund', 'heatingSystem'] },
  'co2.refund-late': { level: 'hint', title: 'CO₂-Erstattung nach Ablauf der Frist verlangt', rule: 'co2-self-supply', terms: ['co2Refund'] },
  'co2.refund-not-next': { level: 'hint', title: 'CO₂-Erstattung nicht in der nächsten Abrechnung', rule: 'co2-self-supply', terms: ['co2Refund'] },
  'co2.refund-due': { level: 'warning', title: 'CO₂-Erstattung fällig', rule: 'co2-self-supply', terms: ['co2Refund'] },
  'co2.refund-differs': { level: 'hint', title: 'CO₂-Erstattung weicht von der Nachrechnung ab', rule: 'co2-self-supply', terms: ['co2Refund'] },
  'co2.refund-not-self': { level: 'error', title: 'CO₂-Erstattung bei einem Mieter, der nicht selbst heizt', rule: 'co2-self-supply', terms: ['co2Refund'] },
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

// CO₂-Erstattung an Mieter, die selbst heizen (Heizung PR 19): Kostenart und Beschriftung der Gutschriftzeile. Eine
// eigene Kostenart, denn die Zeile ist keine Heizkostenzeile und darf in keine Grundlage einer Kürzung fallen.
const CO2_REFUND_CATEGORY = 'CO₂-Erstattung'
const CO2_REFUND_LABEL = 'CO₂-Erstattung bei eigener Heizung (§ 6 Abs. 2 CO2KostAufG)'
// Die Zeile der Werbungskosten für ausgezahlte Erstattungen (Durchsicht S-1).
const CO2_REFUND_TAX_CATEGORY = 'CO₂-Erstattung an Mieter (§ 6 Abs. 2 CO2KostAufG)'

// Was ein Mieter im Zeitraum an wiederkehrenden Kosten trägt: ohne Erstattungen, denn eine Erstattung fällt nicht
// wieder an (§ 560 Abs. 4 BGB: angemessen sind die voraussichtlichen Kosten).
export const recurringShareCents = (st: Pick<Statement, 'rows' | 'totalShareCents'>): number =>
  st.totalShareCents - st.rows.filter((r) => r.kind === 'co2Refund').reduce((a, r) => a + r.shareCents, 0)
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
// Die Sätze zu den Einheiten der Zähler (#342, Durchsicht E1, S3): Sie nennen die Zähler mit Name und Einheit und
// führen zur Seite Zähler.
type UnitMeterRef = { id: string, type: MeterType, unit?: string | null, name?: string | null }
function unitUnknownText(where: string, meters: readonly UnitMeterRef[]): string {
  return `${where}: Die Zähler stehen in verschiedenen Einheiten, und nicht jede kennt Mietfuchs für diese Sparte: ${metersByUnitText(meters)}. ` +
    'Mietfuchs rechnet die Stände, als zeigten alle Zähler dieselbe Einheit, wie vor dieser Version. Stimmt das nicht, zahlen die Mieter falsch. ' +
    'Wählen Sie auf der Seite Zähler für jeden Zähler die Einheit, die er wirklich zeigt; bekannte Einheiten rechnet Mietfuchs ineinander um.'
}
function unitsMixedText(where: string, meters: readonly UnitMeterRef[], consequence: string): string {
  return `${where}: Die Zähler stehen in Einheiten verschiedener Größen: ${metersByUnitText(meters)}. Mietfuchs rechnet sie nicht ineinander um${consequence ? `. ${consequence}` : '.'} ` +
    'Prüfen Sie auf der Seite Zähler, welche Einheit jeder Zähler wirklich zeigt; Zähler, nach denen gemeinsam verteilt wird, brauchen dieselbe.'
}
// Zum ersten Zähler, dessen Einheit nicht passt, sonst zum ersten.
function unitProblemSubject(meters: readonly UnitMeterRef[]): NoticeSubject | undefined {
  const odd = meters.find((m) => typeof m.unit !== 'string' || m.unit.trim() === '' || (knownUnit(m.type, m.unit) === null && hasFamily(m.type))) ?? meters[0]
  return odd ? { kind: 'meter', id: odd.id } : undefined
}
const hasFamily = (t: MeterType): boolean => t !== 'sonstig' && t !== 'hkv'

// Die Zahlenformate einmal angelegt (Leistungsprüfung, Befund 3): `toLocaleString` baut je Aufruf ein neues
// Intl-Objekt, und der Rechenweg formatiert Tausende Zahlen. Gleiche Sprache, gleiche Optionen, also
// zeichengleich (calc-zahlenformat.test.ts vergleicht mit dem früheren Aufruf).
const NF_MAX2 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 })
const NF_MAX3 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 3 })
const NF_MAX6 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 6 })
const NF_FIX1 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const NF_FIX2 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const NF_2TO4 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
const NF_PLAIN = new Intl.NumberFormat('de-DE')
// Menge des Vorrats (bis zwei Stellen) und Heizwert (Vorgabe der Sprache, drei Stellen), Durchsicht von PR #449, K4
const fmtQuantity = (n: number): string => NF_MAX2.format(n)
const fmtPlain = (n: number): string => NF_PLAIN.format(n)

function fmtMeter(n: number): string {
  return NF_MAX3.format(n)
}

// Ein Datum in den Meldungen der Zähler deutsch, wie überall in der Oberfläche (#142): Der
// Vermieter liest „am 01.07.2025“ und nicht „am 2025-07-01“. Aus der Zeichenkette gebaut und nicht
// über `Date`, damit keine Zeitzone einen Tag verschiebt.
// kg mit bis zu zwei, Promille mit einer Nachkommastelle (Heizung PR 8; Entwurf 3.5 „27,4 ‰“).
const fmtKg = (kg: number): string => NF_MAX2.format(kg)
const fmtPermille = (pm: number): string => NF_FIX1.format(Math.round(pm * 10) / 10)

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
    // Eichfrist (Heizung PR 21): hier und nicht auf der Abrechnung, wie die übrigen Zählerhinweise; das
    // Cockpit liest sie für eine eigene Zeile. Der Leitsatz wird wörtlich zitiert (Vorgabe R21-3).
    const until = m.calibratedUntil ?? null
    const overdue = calibrationOverdue(until, readings, { from, to })
    if (overdue && until !== null) {
      const n = makeNotice('meter.calibration-overdue',
        `Zähler „${m.name ?? m.id}“: laut Ihrer Angabe nur bis Ende ${until} geeicht; die Ablesung vom ${fmtDay(overdue.lastDate)} stammt aus der Zeit danach. ` +
          'Nach Ablauf der Eichfrist darf der Zähler nicht ungeeicht verwendet werden, und seine Werte dürfen nicht in einer Abrechnung verwendet werden (§ 37 Abs. 1, § 33 Abs. 1 MessEG); das kann als Ordnungswidrigkeit geahndet werden. Mietfuchs rechnet mit den Werten trotzdem. ' +
          'Bestreitet ein Mieter sie, gilt: „Den von einem nicht (mehr) geeichten Messgerät abgelesenen Verbrauchswerten kommt die Vermutung ihrer Richtigkeit nicht zu. In diesem Fall muss der Vermieter im Prozess die Richtigkeit der abgelesenen Werte zur Überzeugung des Tatrichters nachweisen.“ (BGH VIII ZR 112/10, Leitsatz c). ' +
          'Lassen Sie den Zähler eichen oder tauschen. Hat der Messdienst oder Versorger die Eichfrist im Stichprobenverfahren verlängern lassen (§ 35 MessEV), tragen Sie das Jahr ein, bis zu dem sie verlängert ist; auf dem Zähler ist das nicht zu sehen.',
        { kind: 'meter', id: m.id })
      notices.push(n)
      warnings.push(n.text)
    }
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

// Die Monatsregel (#311) steht in shared/monthRate.ts, damit das Formular des Mietverhältnisses
// denselben Anteil zeigt, den Abrechnung und Mietkonto rechnen.
export { monthShare, rateInMonth }

// Die Monate eines Zeitraums, die nach der Monatsregel zum Mietverhältnis gehören (`days > 0`), auch
// der angebrochene Ein- und Auszugsmonat. Die Rückfragen beim Wechsel des Zeitraums, der Heizperiode
// und der getrennten Heizkostenabrechnung zählen mit dieser Funktion, damit sie dieselben Monate
// abfragen, die die Abrechnung anrechnet (Durchsicht #311, M1/S1).
export const tenancyMonths = (t: { start: string, end: string | null }, p: Pick<BillingPeriod, 'from' | 'to'>): string[] =>
  periodMonths(p).filter((m) => monthShare(t, m).days > 0)

// Ein angebrochener Monat, in dem eine Abrechnung Vorauszahlung anteilig anrechnet (#311): `cents` ist
// der angesetzte Betrag, `fullCents` die volle Rate desselben Monats, beides für das, was diese
// Abrechnung anrechnet. `heatingCents`/`heatingFullCents` sind der Heizanteil daran (je Staffel
// gerundet, Entscheidung R-6), `elsewhereHeating…` die Heizvorauszahlung des Monats, die eine
// getrennte Heizkostenabrechnung anrechnet (Weg d).
export type PartialMonth = {
  month: string
  days: number
  of: number
  cents: number
  fullCents: number
  heatingCents?: number
  heatingFullCents?: number
  elsewhereHeatingCents?: number
  elsewhereHeatingFullCents?: number
}

// Vorauszahlungen eines Abrechnungszeitraums (#208): je Monat des Zeitraums die Staffelrate nach der
// Monatsregel (`rateInMonth`, #311). Eine Korrektur für den Zeitraum (tatsächlich gezahlter Betrag)
// hat immer Vorrang, denn anzusetzen ist, was der Mieter für den Abrechnungszeitraum tatsächlich
// geleistet hat (BGH VIII ZR 240/10 vom 18.05.2011, Rn. 16).
function basePrepaymentCents(tenancy: SnapshotTenancy, period: Pick<BillingPeriod, 'key' | 'from' | 'to'>): { cents: number, overridden: boolean, partial?: PartialMonth[] } {
  const override = tenancy.prepaymentOverrides?.[period.key]
  if (override != null) return { cents: override, overridden: true }
  // `prepaymentMonthlyCents` gibt es im heutigen Tenancy-Typ nicht mehr (Altformat, siehe
  // Migration in store.ts). Diese Funktion wird aber auch mit ungewanderten Altbeständen
  // aufgerufen (siehe calc.test.ts), deshalb führt `SnapshotTenancy` das Feld weiterhin.
  const schedule: MonthlySchedule[] = tenancy.prepayments?.length
    ? tenancy.prepayments
    : tenancy.prepaymentMonthlyCents != null // Altformat: ein fester Monatsbetrag
      ? [{ from: tenancy.start.slice(0, 7), monthlyCents: tenancy.prepaymentMonthlyCents }]
      : []
  let cents = 0
  const partial: PartialMonth[] = []
  for (const month of periodMonths(period)) {
    const { days, of } = monthShare(tenancy, month)
    if (days === 0) continue
    const part = rateInMonth(schedule, tenancy, month)
    cents += part
    const full = rateAtMonth(schedule, month)
    if (days < of && full !== 0) partial.push({ month, days, of, cents: part, fullCents: full })
  }
  return { cents, overridden: false, ...(partial.length > 0 ? { partial } : {}) }
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
): { cents: number, overridden: boolean, heatingCents?: number, partial?: PartialMonth[] } {
  const base = basePrepaymentCents(tenancy, period)
  const schedule: MonthlySchedule[] = Array.isArray(tenancy.heatingPrepayments) ? tenancy.heatingPrepayments : []
  if (schedule.length === 0 || base.overridden) return base
  // Je Staffel einzeln gerundet (R-6): Bei Weg d gehören die beiden Beträge zwei Abrechnungen.
  const byMonth = new Map((base.partial ?? []).map((p) => [p.month, { ...p }]))
  let heatingCents = 0
  for (const m of periodMonths(period)) {
    const { days, of } = monthShare(tenancy, m)
    if (days === 0) continue
    const part = rateInMonth(schedule, tenancy, m)
    const full = rateAtMonth(schedule, m)
    const here = (heating?.ownerOf(m) ?? null) === null
    if (here) heatingCents += part
    if (days >= of || full === 0) continue
    const entry = byMonth.get(m)
    if (here) {
      const e = entry ?? { month: m, days, of, cents: 0, fullCents: 0 }
      byMonth.set(m, { ...e, cents: e.cents + part, fullCents: e.fullCents + full, heatingCents: part, heatingFullCents: full })
    } else if (entry) {
      byMonth.set(m, { ...entry, elsewhereHeatingCents: part, elsewhereHeatingFullCents: full })
    }
  }
  const partial = [...byMonth.values()].sort((x, y) => compareText(x.month, y.month))
  return { cents: base.cents + heatingCents, overridden: false, heatingCents, ...(partial.length > 0 ? { partial } : {}) }
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
): { cents: number, overridden: boolean, provisional: HeatingPrepaymentOverride | null, elsewhere: string[], partial?: PartialMonth[] } {
  const schedule: MonthlySchedule[] = Array.isArray(tenancy.heatingPrepayments) ? tenancy.heatingPrepayments : []
  const months = tenancyMonths(tenancy, h)
  const mine = months.filter(owns)
  const elsewhere = months.filter((m) => !owns(m))
  const staffel = (list: readonly string[]): number => list.reduce((a, m) => a + rateInMonth(schedule, tenancy, m), 0)
  const override = (tenancy.heatingPrepaymentOverrides ?? []).find((o) => o.plantId === plantId && o.period === h.key)
  if (override && !override.provisional) return { cents: override.cents, overridden: true, provisional: null, elsewhere }
  if (override && override.fromMonth !== null && override.toMonth !== null) {
    const from = override.fromMonth
    const to = override.toMonth
    return { cents: override.cents + staffel(mine.filter((m) => m < from || m > to)), overridden: true, provisional: override, elsewhere }
  }
  const partial = mine.flatMap((m): PartialMonth[] => {
    const { days, of } = monthShare(tenancy, m)
    const full = rateAtMonth(schedule, m)
    if (days >= of || full === 0) return []
    const part = rateInMonth(schedule, tenancy, m)
    return [{ month: m, days, of, cents: part, fullCents: full, heatingCents: part, heatingFullCents: full }]
  })
  return { cents: staffel(mine), overridden: false, provisional: null, elsewhere, ...(partial.length > 0 ? { partial } : {}) }
}

// ---------- Mietkonto / Zahlungs-Tracking ----------

// Eine Mietzahlung (#280)? Fehlt die Art, ist es eine: Die db.json und der eingefrorene Eingang
// (Stand 0000) kennen sie nicht, und vor #280 war jede Zahlung Miete.
export const isRentPayment = (p: Pick<SnapshotPayment, 'kind'>): boolean => (p.kind ?? 'rent') === 'rent'

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
        // Dieselbe Monatsregel wie die Abrechnung (#311): im angebrochenen Monat anteilig.
        const share = monthShare(t, mm)
        const baseRentCents = rateInMonth(baseSchedule, t, mm)
        const prepaymentCents = rateInMonth(ppSchedule, t, mm)
        const flatRateCents = rateInMonth(flatSchedule, t, mm)
        const heatingPrepaymentCents = withHeating ? rateInMonth(heatingSchedule, t, mm) : 0
        return {
          month: Number(mm.slice(5, 7)),
          ...(share.days > 0 && share.days < share.of ? { share } : {}),
          baseRentCents,
          prepaymentCents,
          ...(withHeating ? { heatingPrepaymentCents } : {}),
          flatRateCents,
          sollCents: baseRentCents + prepaymentCents + heatingPrepaymentCents + flatRateCents,
          paidCents: 0,
          status: 'open',
        }
      })
      // Zahlungseingänge der Spanne der Reihe nach auf die Monate verteilen, und zwar nur die Miete
      // (#280). Eine Nachzahlung aus der Abrechnung deckt kein Monats-Soll, und ein ausgezahltes
      // Guthaben ist keine Rücklastschrift; verteilt rissen beide eine Lücke in den Dezember oder
      // erfänden eine Überzahlung. Sie stehen gesondert in `settlementYearCents`.
      const inSpan = source.payments.filter((p) => p.tenancyId === t.id && p.date >= span.from && p.date <= span.to)
      const paidYearCents = inSpan.filter(isRentPayment).reduce((a, p) => a + p.amountCents, 0)
      const settlementYearCents = inSpan.filter((p) => !isRentPayment(p)).reduce((a, p) => a + p.amountCents, 0)
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
        settlementYearCents,
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
  const span = calendarYearPeriod(snapshot.year)
  const rows = ledgerRows(snapshot, span, options)
  // Nachzahlung und Guthaben kommen meist im Folgejahr, oft nach dem Auszug (#280). Ein
  // Mietverhältnis ohne Tag im Jahr hat keine Zeile; seine Zahlungen aus der Abrechnung stehen
  // dann hier, sonst fehlten sie im Mietkonto ganz. Eigene Liste statt Zeile: Eine Zeile ohne Soll
  // zählte in der Steuerübersicht als Mietverhältnis des Jahres (`costModels`).
  const withRow = new Set(rows.map((r) => r.tenancyId))
  const unitById = new Map(snapshot.units.map((u) => [u.id, u]))
  const settlementPayments = snapshot.payments.filter((p) => !isRentPayment(p) && p.date >= span.from && p.date <= span.to)
  const settlementOnly: RentLedger['settlementOnly'] = snapshot.tenancies
    .filter((t) => !withRow.has(t.id))
    .flatMap((t) => {
      const own = settlementPayments.filter((p) => p.tenancyId === t.id)
      if (own.length === 0) return []
      return [{
        tenancyId: t.id,
        tenantName: t.tenantName,
        unitName: unitById.get(t.unitId)?.name ?? '—',
        settlementYearCents: own.reduce((a, p) => a + p.amountCents, 0),
      }]
    })
    .sort((a, b) => compareName(a.unitName, b.unitName) || compareName(a.tenantName, b.tenantName))
  return {
    year: snapshot.year,
    rows,
    settlementOnly,
    totals: {
      sollYearCents: rows.reduce((a, r) => a + r.sollYearCents, 0),
      paidYearCents: rows.reduce((a, r) => a + r.paidYearCents, 0),
      settlementYearCents: rows.reduce((a, r) => a + r.settlementYearCents, 0) + settlementOnly.reduce((a, r) => a + r.settlementYearCents, 0),
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
// Einnahmen werden sowohl als Soll (vereinbart) als auch als Ist (tatsächlich gezahlt) geliefert.
// **Die Werbungskosten folgen dem Abflussprinzip nur mit Angabe** (#255): Eine Position steht im Jahr
// ihres Zahlungsdatums, sonst im angegebenen Jahr der Zahlung, sonst im Jahr, in dem ihr Zeitraum
// beginnt. Für die Steuer bestimmt das Jahr `outflowShares` in outflow.ts; was dabei zwischen den
// Jahren verschoben ist, nennt `shiftNotes` (PR 4).

// Ein Teil der Steuerübersicht: der Schnappschuss eines Abrechnungszeitraums und seine Positionen,
// die im Kalenderjahr gezahlt wurden. Der Eigenanteil kommt aus der Abrechnung dieses Zeitraums.
// `carryOnly`: eine Heizkostenabrechnung nach Weg d ohne Positionen in diesem Jahr, die nur für den Hinweis zum
// Übertrag aus dem Vorrat mitgerechnet wird (`carryShareCents`); sie ist kein Teil der Übersicht.
export type TaxPart = { snapshot: Snapshot; items: SnapshotCostItem[]; carryOnly?: true }

// Eigenanteil an den Überträgen aus dem Brennstoffvorrat einer Abrechnung (Heizung PR 8, N8). Die
// Überträge sind keine Positionen; die Steuerübersicht nimmt das Bezahlte (6.4 Nr. 1, G-C5), die
// Abrechnung den Verbrauch, und um diesen Betrag liegen beide beim Eigenanteil auseinander.
export function stockCarrySelfCents(settlement: Pick<ComputedSettlement, 'landlord'>): number {
  return settlement.landlord.rows
    .filter((r) => r.costItemId.startsWith('stock:'))
    .reduce((a, r) => a + (r.landlordParts ?? []).filter((x) => x.reason === 'selfUse').reduce((b, x) => b + x.cents, 0), 0)
}

// Der Teil des Übertrags einer Abrechnung, der in ein Steuerjahr gehört. Ein Zeitraum über zwei Kalenderjahre (Mai bis
// April, Heizperiode nach Weg b oder d) ist in beiden ein Teil der Steuerübersicht; sein Übertrag gehört aber dorthin,
// wo der Brennstoff bezahlt ist, denn mit dessen privatem Teil vergleicht ihn der Hinweis. Deshalb: nach dem Jahr der
// Zahlung der Brennstoffpositionen der Abrechnung, bei mehreren Jahren anteilig nach ihren Beträgen (Restverfahren,
// über alle Jahre also genau einmal). Brennstoff heißt wie in der Bestandsrechnung gekennzeichnet oder mit einer
// Lieferung verknüpft (`isFuelMarked`). Eine Gutschrift mindert das Gewicht ihres Jahres, aber nicht unter 0: Sonst zöge
// sie einen Übertrag mit umgekehrtem Vorzeichen in ihr Jahr und verdoppelte ihn im Jahr der Rechnung. Ohne Gewicht
// (Verbrauch nur aus dem Vorrat) ist nichts bezahlt, an dem er sich ausrichten könnte; dann gilt das Jahr, in dem der
// Zeitraum der Abrechnung beginnt, in dem sie stets ein Teil ist (bei Weg d über `carryOnly`).
export function carryShareCents(snapshot: Snapshot, carryCents: number, year: number): number {
  if (carryCents === 0) return 0
  const weights = new Map<number, number>()
  const seen = new Set<string>()
  const add = (c: SnapshotCostItem, period: Pick<BillingPeriod, 'from'>): void => {
    if (seen.has(c.id) || !isFuelMarked(c)) return
    seen.add(c.id)
    for (const share of outflowShares(c, period, snapshot.costItems)) weights.set(share.year, (weights.get(share.year) ?? 0) + share.cents)
  }
  for (const x of snapshot.heatingParts ?? []) if (!x.separate) for (const c of x.items) add(c, x.period)
  for (const c of snapshot.costItems) if (c.period === snapshot.period.key) add(c, snapshot.period)
  const years = [...weights.keys()].sort((a, b) => a - b)
  const weightOf = (y: number): number => Math.max(0, weights.get(y) ?? 0)
  const total = years.reduce((a, y) => a + weightOf(y), 0)
  if (total === 0) return Number(snapshot.period.from.slice(0, 4)) === year ? carryCents : 0
  const shares = largestRemainder(carryCents, years.map((y) => (carryCents * weightOf(y)) / total), years.map(String))
  const i = years.indexOf(year)
  return i < 0 ? 0 : shares[i] ?? 0
}

// `linkable`: Positionen, auf die ein Abzug zeigen kann, auch aus anderen Jahren (#268, Durchsicht M1); nur für die
// Anlage und die Beschreibung eines Verweises, nie für Beträge.
export function taxReport(snapshot: Snapshot, parts?: readonly TaxPart[], options: { linkable?: readonly SnapshotCostItem[]; foreignQuota?: ForeignHeatQuota } = {}): TaxReport {
  const year = snapshot.year
  // Die Steuerübersicht rechnet im Kalenderjahr (§ 11 EStG, #208). Ohne Teile: der Schnappschuss
  // eines Kalenderjahres. Mit Teilen: die Abrechnungen, die das Jahr berühren; `snapshot` liefert
  // dann nur Mietkonto und Zahlungen des Kalenderjahres.
  const calendar = calendarYearPeriod(year)
  if (snapshot.period.from !== calendar.from || snapshot.period.to !== calendar.to) {
    throw new Error('Die Steuerübersicht rechnet im Kalenderjahr; dieser Schnappschuss trägt einen anderen Zeitraum.')
  }
  const given: readonly TaxPart[] = parts ?? [{ snapshot, items: snapshot.costItems.filter((c) => c.period === snapshot.period.key) }]
  const used = given.filter((p) => !p.carryOnly)
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
  const paidInYear = snapshot.payments.filter((p) => p.date >= `${year}-01-01` && p.date <= `${year}-12-31`)
  const paidCents = paidInYear.reduce((a, p) => a + p.amountCents, 0)
  // Nachzahlungen und Erstattungen aus der Abrechnung (#280) bleiben Einnahmen nach dem
  // Zuflussprinzip und stecken in `paidCents`; die Übersicht nennt sie zusätzlich gesondert, denn die
  // Anlage V fragt sie bei den Umlagen ab. Getrennt nach Richtung, weil sich eine Nachzahlung
  // des einen und ein Guthaben des anderen Mieters nicht zu einer Zahl verrechnen sollen.
  const settlementInYear = paidInYear.filter((p) => !isRentPayment(p))
  const settlementBackPaymentsCents = settlementInYear.filter((p) => p.amountCents > 0).reduce((a, p) => a + p.amountCents, 0)
  // Als Betrag ohne Vorzeichen; summiert über −p, damit ohne Erstattungen 0 und nicht −0 dasteht.
  const settlementRefundsCents = settlementInYear.filter((p) => p.amountCents < 0).reduce((a, p) => a - p.amountCents, 0)

  // Mietverhältnisse des Jahres mit Soll, und wie viele davon ohne jede Zahlung dastehen. Nicht
  // für eine Rechnung, sondern für den Hinweis: Sind für einen Mieter Zahlungen erfasst und für
  // einen zweiten nicht, ist die Summe größer als null, und eine zu niedrige Einnahme ginge
  // ohne Vorbehalt in die Anlage V.
  //
  // Gezählt wird, für welches Mietverhältnis **überhaupt keine** Zahlung erfasst ist, und nicht,
  // wessen Summe null ergibt. Heben sich im Jahr ein Eingang und eine Rücklastschrift auf, ist
  // die Summe null, erfasst ist aber sehr wohl etwas, und der Satz „keine Zahlung erfasst“ wäre
  // dann schlicht falsch.
  // Nur Mietzahlungen (#280): Wer für einen Mieter nur die Nachzahlung aus der Abrechnung erfasst
  // hat, hat seine Miete nicht erfasst, und genau darauf soll der Hinweis stoßen.
  const paidTenancies = new Set(paidInYear.filter(isRentPayment).map((p) => p.tenancyId))
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
    return { cold, heat: heatingBilled ? allocationModel(t?.heatingModel) : cold }
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
  // Mit Teilen (#208) je Abrechnung nur der Anteil dieses Steuerjahres (`carryShareCents`); ohne Teile ist die eine
  // Abrechnung die des Kalenderjahres.
  const stockCarrySelf = parts === undefined
    ? settled.reduce((a, { settlement }) => a + stockCarrySelfCents(settlement), 0)
    : [...settled, ...given.filter((p) => p.carryOnly).map((p) => ({ part: p, settlement: computeSettlement(p.snapshot) }))]
      .reduce((a, { part, settlement }) => a + carryShareCents(part.snapshot, stockCarrySelfCents(settlement), year), 0)
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
  // nimmt die Jahreskorrektur, wenn sie erfasst ist: Anzusetzen sind die Vorauszahlungen, die der
  // Mieter für den Abrechnungszeitraum tatsächlich geleistet hat (BGH VIII ZR 240/10 vom 18.05.2011,
  // Rn. 16; VIII ZA 2/08), und Soll statt Ist ist, wenn beide abweichen, ein inhaltlicher Fehler.
  // Nach Fristablauf ist nach § 556 Abs. 3 Satz 3 BGB die Nachforderung über das Ergebnis einer
  // rechtzeitig erteilten Abrechnung hinaus ausgeschlossen, ohne rechtzeitige Abrechnung die über
  // die vereinbarten Vorauszahlungen hinaus (VIII ZR 190/06; VIII ZR 261/06), und eine erteilte
  // Abrechnung lässt sich grundsätzlich nicht mehr zulasten des Mieters korrigieren (VIII ZR 133/10,
  // Rn. 12 f.). Ohne Korrektur rechnen Abrechnung und Mietkonto dieselbe Staffel, auch im
  // angebrochenen Monat (`rateInMonth`, #311). Und
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
  // Seit #208 steht der Filter in `taxPartsFor` (Jahr der Zahlung, seit #255 aus `outflowShares` für jedes Objekt);
  // ohne Teile, also nur bei unmittelbarem Aufruf mit dem Schnappschuss eines Kalenderjahres, in `used`.
  const items = used.flatMap((p) => p.items)
  // Die Aufteilung bei teilweiser Eigennutzung (#163), je Position aus der Abrechnung ihres
  // Zeitraums. Die Rücklage fehlt darin.
  const splits = settled.map(({ part, settlement }) => splitForTax(part.snapshot, part.items.filter((c) => groupOf(c.category) !== null), settlement, calendar))
  const split: TaxSplit = {
    items: new Map(splits.flatMap((s) => [...s.items.entries()])),
    selfUseChangedInYear: splits.some((s) => s.selfUseChangedInYear),
    usageChangedUnits: [...new Set(splits.flatMap((s) => s.usageChangedUnits))],
    closedSelfUseDiffers: splits.some((s) => s.closedSelfUseDiffers),
    closedItemsChanged: splits.reduce((a, s) => a + s.closedItemsChanged, 0),
  }
  // Ausgleich beim Betriebsstrom (#268): eine abgeleitete Zeile beim Allgemeinstrom, damit der Strom in jedem
  // Steuerjahr genau die bezahlte Stromrechnung ist. Sie geht nicht durch den eingefrorenen Stand (keine Position der
  // Abrechnung) und nicht in den Eigenanteil laut Abrechnung.
  const lookup = new Map<string, SnapshotCostItem>()
  for (const c of options.linkable ?? []) lookup.set(c.id, c)
  for (const p of used) {
    for (const c of [...p.snapshot.costItems, ...(p.snapshot.heatingParts ?? []).flatMap((x) => x.items), ...p.items]) lookup.set(c.id, c)
  }
  const balanceParts = used.map((p) => ({ items: p.items, plants: p.snapshot.heatingPlants ?? [], period: p.snapshot.period }))
  const balance = operatingPowerBalance(balanceParts, [...lookup.values()])
  const balanceItem = balance.cents !== 0 ? operatingPowerBalanceItem(balance, used, splits, snapshot.units, year, options.foreignQuota, (i) => {
    const part = settled[i]
    return part === undefined ? undefined : splitForTax(part.part.snapshot, heatPool(part.part).map((x) => x.c).filter((c) => c.category === HEATING_CATEGORY), part.settlement, calendar)
  }) : null
  if (balanceItem) split.items.set(balanceItem.costItemId, balanceItem)
  const ambiguous = balance.ambiguous
  const reportedIds = new Set(balance.reported.map((x) => x.costItemId))
  const unmarked = unmarkedPowerCredits(balanceParts)
  // Verbilligte Vermietung (#257, Regeln in cheapRent.ts): der unentgeltliche Teil, aus dem abziehbaren Teil nach der
  // Aufteilung bei Eigennutzung herausgenommen, nie aus dem privaten. Ohne eingetragene ortsübliche Miete gibt es
  // nichts, und keine Zahl ändert sich. Die Umlagen kommen aus der Abrechnung des Kalenderjahres, heute gerechnet; der
  // eingefrorene Stand führt die Mieterzeilen nicht je Mietverhältnis.
  const cheap = cheapRentOf({
    year,
    units: snapshot.units,
    tenancies: snapshot.tenancies,
    ledgerRows: ledger.rows,
    statements: same === undefined ? null : same.settlement.statements,
    // Betriebsstrom (Integrationsdurchsicht 0.13.0, M1): Heizpositionen `included` und Abzüge, die in der Ausgleichszeile
    // C stecken, sind keine eigene Zahlung und zählen nicht. Ein Abzug, der als dem Messdienst gemeldet gilt
    // (`balance.reported`, dieselbe Regel `deductionReported` wie die Steuer), steht dagegen als eigene negative Position
    // da und wird mitgekürzt.
    items: items.filter((c) => groupOf(c.category) !== null && c.operatingPower !== 'included'
      && (c.operatingPower !== 'deduction' || reportedIds.has(c.id))),
    deductible: (id) => split.items.get(id)?.deductibleCents,
    // Durchsicht von PR #422, S1: der Anteil laut Abrechnung des Kalenderjahres, nur für Positionen, die genau diese
    // Abrechnung verteilt, und nur, wo sie ihn dem Mietverhältnis zubucht.
    settledShare: (tenancyId, costItemId) => {
      if (same === undefined || !same.part.items.some((c) => c.id === costItemId)) return null
      const item = same.part.items.find((c) => c.id === costItemId)
      const t = tenancyById.get(tenancyId)
      if (!item || !t || isNotAllocable(item.category) || modelFor(t, item) !== 'settlement') return null
      const st = same.settlement.statements.find((x) => x.tenancyId === tenancyId && x.scope !== 'heating')
      return st ? st.rows.filter((r) => r.costItemId === costItemId).reduce((a, r) => a + r.shareCents, 0) : null
    },
    chargesOf: recurringShareCents,
  })
  for (const [id, cut] of cheap?.cuts ?? []) {
    const entry = split.items.get(id)
    if (!entry) continue
    const deductibleCents = entry.deductibleCents - cut.cents
    split.items.set(id, {
      ...entry,
      deductibleCents,
      gratuitousCents: cut.cents,
      steps: [...entry.steps, ...cut.steps, { label: 'abziehbar nach Kürzung', value: fmtCents(deductibleCents) }],
    })
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
    if (share?.gratuitousCents) prev.gratuitousCents = (prev.gratuitousCents ?? 0) + share.gratuitousCents
    // Nur ein gültiger Lohnanteil, dieselbe Regel wie in der Abrechnung (#148).
    prev.labor35aCents += validLabor35aCents(item) ?? 0
    cats.set(item.category, prev)
  }
  if (balanceItem) {
    const cats = byGroup.get(balanceItem.group) ?? new Map<string, TaxExpenseCategory>()
    byGroup.set(balanceItem.group, cats)
    const prev = cats.get(balanceItem.category) ?? { category: balanceItem.category, amountCents: 0, labor35aCents: 0, privateCents: 0, deductibleCents: 0 }
    prev.amountCents += balanceItem.amountCents
    prev.privateCents += balanceItem.privateCents
    prev.deductibleCents += balanceItem.deductibleCents
    cats.set(balanceItem.category, prev)
  }
  // CO₂-Erstattung an Mieter, die selbst heizen (Heizung PR 19, Durchsicht S-1): Eine ausgezahlte Erstattung
  // (`paidOutOn`) ist Werbungskosten im Jahr der Auszahlung (§ 9 Abs. 1, § 11 Abs. 2 EStG), ganz abziehbar. Eine in der
  // Betriebskostenabrechnung verrechnete wirkt dort über den Saldo und die Zahlungen und steht hier nicht noch einmal.
  const paidOut = (snapshot.co2Refunds ?? []).filter((r) => r.paidOutOn !== null && r.paidOutOn.slice(0, 4) === String(year))
  const paidOutCents = paidOut.reduce((a, r) => a + r.amountCents, 0)
  // Nachprüfung N-4: Jede ausgezahlte Erstattung ist auch eine Zeile der Aufstellung je Position, damit deren Summe die
  // Werbungskosten ergibt (Seite und Übersicht der „Belege für die Steuer“). Direkt einem vermieteten Mietverhältnis
  // zugeordnet, ganz abziehbar.
  for (const r of paidOut) {
    if (r.amountCents === 0 || r.paidOutOn === null) continue
    const tenantName = snapshot.tenancies.find((t) => t.id === r.tenancyId)?.tenantName ?? ''
    split.items.set(`co2refund-paid:${r.id}`, {
      costItemId: `co2refund-paid:${r.id}`,
      category: CO2_REFUND_TAX_CATEGORY,
      group: groupOf(CO2_REFUND_TAX_CATEGORY) ?? 'Sonstige Werbungskosten',
      description: `CO₂-Erstattung an Mieter, ausgezahlt am ${fmtDay(r.paidOutOn)}`,
      amountCents: r.amountCents,
      privateCents: 0,
      deductibleCents: r.amountCents,
      labor35aCents: 0,
      allocation: 'direct-rented',
      deductiblePercent: null,
      areaPrivateCents: null,
      settlementPrivateCents: null,
      steps: [
        { label: 'Erstattung', value: `${fmtCents(r.amountCents)} an ${tenantName || 'den Mieter'}, ausgezahlt am ${fmtDay(r.paidOutOn)}`, term: 'co2Refund' },
        { label: 'Zuordnung', value: 'ganz abziehbar: Werbungskosten im Jahr der Auszahlung (§ 9 Abs. 1 Satz 1, § 11 Abs. 2 Satz 1 EStG), an den Mieter einer vermieteten Wohnung, also ohne privaten Teil' },
      ],
      taxUnits: null,
      co2RefundPaidOut: true,
    })
  }
  if (paidOutCents !== 0) {
    const group = groupOf(CO2_REFUND_TAX_CATEGORY) ?? 'Sonstige Werbungskosten'
    const cats = byGroup.get(group) ?? new Map<string, TaxExpenseCategory>()
    byGroup.set(group, cats)
    const prev = cats.get(CO2_REFUND_TAX_CATEGORY) ?? { category: CO2_REFUND_TAX_CATEGORY, amountCents: 0, labor35aCents: 0, privateCents: 0, deductibleCents: 0 }
    prev.amountCents += paidOutCents
    prev.deductibleCents += paidOutCents
    cats.set(CO2_REFUND_TAX_CATEGORY, prev)
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
        ...(categories.some((c) => c.gratuitousCents) ? { gratuitousCents: categories.reduce((a, c) => a + (c.gratuitousCents ?? 0), 0) } : {}),
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
  // Als Differenz, damit privat, unentgeltlich (#257) und abziehbar zusammen immer die Bruttosumme ergeben.
  const gratuitousCents = groups.reduce((a, g) => a + (g.gratuitousCents ?? 0), 0)
  const deductibleCents = totalCents - privateCents - gratuitousCents
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
  // Nutzungswechsel (#259): nach Tagen im Kalenderjahr (`taxUsage`); ohne Wechsel die Angabe an der Einheit.
  const allUnits = snapshot.units
  const yearUsage = taxUsage(allUnits, calendar.from, calendar.to)
  const totalArea = allUnits.reduce((a, u) => a + (u.areaM2 || 0), 0)
  const selfUsedUnits = allUnits.filter((u) => yearUsage.selfShare(u) > 0)
  // **Ausgegeben werden die Flächen und nicht ihr Verhältnis.** Die Anlage V fragt im Kopf nach
  // der Gesamtwohnfläche und dem davon eigengenutzten Teil; das sind genau diese beiden Zahlen,
  // und sie sind nachprüfbar. Ein bloßer Prozentsatz lädt außerdem dazu ein, den Rest für den
  // abziehbaren Anteil zu halten, und das ist falsch, sobald es Wohnungen außerhalb der
  // Abrechnungseinheit gibt.
  // Mit Wechsel die Fläche nach Tagen der Eigennutzung, auf zwei Stellen gerundet (eine Auslegung: die Anlage V fragt
  // die eigengenutzte Fläche, ohne einen Wechsel im Jahr zu regeln).
  const selfUsedAreaRaw = selfUsedUnits.reduce((a, u) => a + (u.areaM2 || 0) * yearUsage.selfShare(u), 0)
  const selfUsedAreaM2 = selfUsedUnits.some((u) => yearUsage.phased(u)) ? Math.round(selfUsedAreaRaw * 100) / 100 : selfUsedAreaRaw
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
  const excludedExists = allUnits.some((u) => yearUsage.outside(u))
  // Auf selbstgenutzte Wohnungen entfallender Teil der Kosten, aus der Verteilung des Jahres
  // übernommen: privat veranlasst und damit nicht als Werbungskosten abziehbar. Die
  // Werbungskosten oben bleiben ungekürzt — die Aufteilung nimmt diese Übersicht nicht vor.
  // Ist die Abrechnung abgeschlossen, gilt ihr eingefrorener Stand (wie in
  // GET /api/settlement/:year), sonst widersprächen Übersicht und versendete Abrechnung.
  // Ohne Zeitraum gleich dem Kalenderjahr (#208): die Summe der Eigenanteile laut Abrechnung je
  // Position.
  // #255 PR 3 (T3): Die Summe der ganzen Abrechnung nur, solange keine ihrer Positionen in einem anderen Jahr bezahlt
  // ist; sonst zählte deren Eigenanteil hier mit, obwohl die Position in der Übersicht eines anderen Jahres steht.
  // Ebenso, wenn ein anderer Teil eine Position mit Zahlungsdatum beiträgt: deren Eigenanteil steht nicht in dieser
  // Abrechnung. Ohne Datum bleibt es bei der Regel von vorher.
  // #255 PR 4: was zwischen den Jahren verschoben ist, nur Auskunft (`shiftNotes`).
  const shifts = shiftNotes(given, items, options.linkable, year, snapshot)
  for (const [id, note] of shifts.items) {
    const entry = split.items.get(id)
    if (entry) split.items.set(id, { ...entry, ...note })
  }
  const sameWhole = same !== undefined && same.part.snapshot.costItems.every((c) => same.part.items.includes(c)) &&
    !used.some((p) => p !== same.part && p.items.some((c) => c.paidOn != null))
  const selfUsedShareCents = same !== undefined && sameWhole
    ? same.part.snapshot.closedSettlement?.selfUsedShareCents ?? same.settlement.selfUsedShareCents
    : [...split.items.values()].filter((i) => i.allocation === 'settlement' && !i.operatingPowerBalance).reduce((a, i) => a + i.privateCents, 0)

  return {
    year,
    income: {
      baseRentSollCents,
      inclusiveRentSollCents,
      prepaymentSollCents,
      flatRateSollCents,
      prepaymentSettlementCents,
      prepaymentOverridden,
      ...(same !== undefined && frozen ? { prepaymentSettlementClosed: true as const } : {}),
      sollCents,
      paidCents,
      settlementBackPaymentsCents,
      settlementRefundsCents,
      tenanciesWithSoll,
      tenanciesWithoutPayment,
    },
    expenses: { groups, totalCents, privateCents, deductibleCents, labor35aCents, ...(gratuitousCents !== 0 ? { gratuitousCents } : {}), ...(stockCarrySelf !== 0 ? { stockCarrySelfCents: stockCarrySelf } : {}), items: [...split.items.values()], unstatedCount: shifts.unstatedCount },
    movedOut: shifts.movedOut,
    settlementPeriods: used.map((p) => ({ key: p.snapshot.period.key, label: p.snapshot.scope?.kind === 'heating' ? `Heizkosten ${periodLabel(p.snapshot.period)}` : periodLabel(p.snapshot.period) })),
    selfUseChangedInYear: split.selfUseChangedInYear,
    ...(split.usageChangedUnits.length > 0 ? { usageChangedUnits: split.usageChangedUnits } : {}),
    closedSelfUseDiffers: split.closedSelfUseDiffers,
    closedItemsChanged: split.closedItemsChanged,
    reserveContributionCents,
    reserveSuspects,
    totalAreaM2: totalArea,
    selfUsedAreaM2,
    selfOccupiedExists,
    excludedExists,
    costModels,
    ...(cheap ? { cheapRent: cheap.report } : {}),
    ...(balance.cents !== 0 ? { operatingPowerBalanceCents: balance.cents, operatingPowerBalanceKind: balance.kind } : {}),
    ...(balance.cents !== 0 && balance.keptCents !== 0 ? { operatingPowerKeptCents: balance.keptCents } : {}),
    ...(ambiguous.length > 0 ? { operatingPowerAmbiguous: ambiguous } : {}),
    ...(unmarked.length > 0 ? { unmarkedPowerCredits: unmarked } : {}),
    selfUsedShareCents,
    // Der Überschuss rechnet mit dem abziehbaren Teil (#163). Ohne Eigennutzung ist er die
    // Bruttosumme, und die Zahl bleibt, wie sie war.
    surplusSollCents: sollCents - deductibleCents,
    surplusPaidCents: paidCents - deductibleCents,
  }
}

// ---------- Was zwischen den Jahren verschoben ist (#255, PR 4) ----------
//
// Nur Auskunft, **keine Zahl hängt daran**: Welche Position in welchem Steuerjahr steht, hat `taxPartsFor` über
// `paidWhollyIn` schon entschieden; hier wird dieselbe Antwort von `outflowShares` nur noch einmal gelesen, um sie zu
// nennen. Die Gleichheitsinvariante in outflow.test.ts und die Prüfsummen (taxGolden.ts) lesen die neuen Felder nicht.
//
// **Verschoben heißt: das Jahr der Zahlung liegt außerhalb der Kalenderjahre, die der Zeitraum der Position berührt.**
// Bei Mai bis April ist eine Zahlung 2026 für 2025/2026 gewöhnlich und keine Verschiebung; eine Zahlung 2027 schon.
// Beim Kalenderzeitraum ist jede Zahlung in einem anderen Jahr eine. Eine verschobene Position steht
//   - in der Übersicht ihres Jahres der Zahlung mit ihrem Zeitraum (`settlementPeriod`),
//   - in der Übersicht des Jahres, in dem ihr Zeitraum beginnt, unter `movedOut`,
// also auf jeder Seite genau einmal, auch bei einem Zeitraum über zwei Kalenderjahre (Invariante in
// calc-steuer-verschiebung.test.ts). Die Zuführung zur Erhaltungsrücklage gehört nicht zu den Werbungskosten und steht
// in keiner der beiden Listen.
//
// `unstatedCount`: Positionen des Jahres ohne Datum und ohne Jahr der Zahlung (Quelle `period`). Nicht gezählt wird, wo
// es gar kein Datum gibt (`allowsPaidOn`: Hausgeld laut Gemeinschaftsabrechnung, Abzug beim Betriebsstrom), sonst riete
// der Hinweis zu einer Angabe, die das Formular nicht anbietet.
//
// `outsideSpan` (Durchsicht von PR 3, K8): Ein Datum außerhalb von Beginn − 1 bis Ende + 3 (R-4) fragt beim Eintragen
// nach. Ein späterer Wechsel des Zeitraums fragt nicht neu, denn das Datum ändert sich dabei nicht und gerechnet wird
// richtig; die Übersicht nennt es stattdessen, wo die Position auftaucht.
type ShiftNotes = {
  items: Map<string, Pick<TaxExpenseItem, 'outflow' | 'settlementPeriod' | 'outsideSpan'>>
  movedOut: TaxMovedOut[]
  unstatedCount: number
}
function shiftNotes(given: readonly TaxPart[], counted: readonly SnapshotCostItem[], linkable: readonly SnapshotCostItem[] | undefined, year: number, calendar: Pick<Snapshot, 'heatingPlants' | 'objectRules'>): ShiftNotes {
  // Der eigene Zeitraum jeder Position (bei einer Heizposition unter eigener Heizperiode deren Heizperiode, wie in
  // `taxPartsFor`) und die Positionen daneben, unter denen ein Abzug seine Stromrechnung findet.
  type Own = { period: BillingPeriod; label: string; items: readonly SnapshotCostItem[] }
  const ownOf = new Map<string, Own>()
  const periodOf = new Map<string, Own>()
  for (const p of given) {
    const heating = p.snapshot.scope?.kind === 'heating'
    for (const x of p.snapshot.heatingParts ?? []) {
      if (x.separate) continue
      const own = { period: x.period, label: `Heizkosten ${periodLabel(x.period)}`, items: x.items }
      if (!periodOf.has(x.period.key)) periodOf.set(x.period.key, own)
      for (const c of x.items) if (!ownOf.has(c.id)) ownOf.set(c.id, own)
    }
    const own = { period: p.snapshot.period, label: heating ? `Heizkosten ${periodLabel(p.snapshot.period)}` : periodLabel(p.snapshot.period), items: p.snapshot.costItems }
    if (!periodOf.has(p.snapshot.period.key)) periodOf.set(p.snapshot.period.key, own)
    for (const c of p.snapshot.costItems) if (!ownOf.has(c.id)) ownOf.set(c.id, own)
  }
  const touched = (period: Pick<BillingPeriod, 'from' | 'to'>, y: number): boolean => Number(period.from.slice(0, 4)) <= y && y <= Number(period.to.slice(0, 4))
  const outsideSpan = (c: SnapshotCostItem, period: Pick<BillingPeriod, 'from' | 'to'>): boolean => {
    if (c.paidOn == null) return false
    const span = paidOnSpan({ startYear: Number(period.from.slice(0, 4)), endYear: Number(period.to.slice(0, 4)) })
    const y = paidOnYear(c.paidOn)
    return y < span.from || y > span.to
  }
  const outflowOf = (c: SnapshotCostItem, own: Pick<Own, 'period' | 'items'>): TaxOutflow | null => {
    const shares = outflowShares(c, own.period, own.items)
    const share = shares[0]
    // Wie `paidWhollyIn`: mehrere Anteile (#292) nennt die Übersicht noch nicht, und still den ersten zu nehmen hieße,
    // von der einen Stelle abzuweichen, die jede Auswertung fragt (Durchsicht von PR 4, K1).
    if (shares.length > 1) throw new Error(`Die Position ${c.id} ist in mehreren Jahren abgeflossen; das zeigt die Steuerübersicht noch nicht.`)
    if (share === undefined) return null
    return { year: share.year, source: share.source, ...(share.source === 'paid' && c.paidOn != null ? { paidOn: c.paidOn } : {}) }
  }

  const items: ShiftNotes['items'] = new Map()
  let unstatedCount = 0
  for (const c of counted) {
    if (groupOf(c.category) === null) continue
    const own = ownOf.get(c.id)
    if (own === undefined) continue
    const outflow = outflowOf(c, own)
    if (outflow === null) continue
    const shifted = !touched(own.period, outflow.year)
    items.set(c.id, {
      outflow,
      ...(shifted ? { settlementPeriod: { key: own.period.key, label: own.label } } : {}),
      ...(shifted && outsideSpan(c, own.period) ? { outsideSpan: true as const } : {}),
    })
    if (outflow.source === 'period' && allowsPaidOn(c)) unstatedCount++
  }

  // Umgekehrt: Positionen der Zeiträume, die in diesem Jahr beginnen. Gesucht wird unter allen Positionen des Objekts,
  // wo der Aufrufer sie mitgibt (`taxReportFor`), sonst unter denen der Teile. Ein Zeitraum, der in diesem Jahr beginnt,
  // berührt es und ist deshalb stets ein Teil; eine Heizperiode, die in einer späteren Abrechnung steht, womöglich nicht.
  // Für sie gilt: zwölf Monate, also über den Jahreswechsel, wenn sie nicht im Januar beginnt.
  // Durchsicht von PR 4, M1: Eine Heizposition unter eigener Heizperiode hat deren Zeitraum, auch wenn die Abrechnung, in
  // der die Heizperiode steht, kein Teil dieses Jahres ist. Nach dem Schlüssel allein träfe sie sonst einen
  // Abrechnungszeitraum des Objekts, der zufällig im selben Monat beginnt (Rumpf am Wechsel des Rhythmus), und die
  // Übersicht meldete eine Verschiebung, die es nicht gibt. Die Regel ist dieselbe wie in `taxPartsFor`.
  const objectRules = calendar.objectRules ?? CALENDAR_RULES
  const heatingPeriodOf = (c: SnapshotCostItem): Own | undefined => {
    const plant = c.heatingPlantId ? (calendar.heatingPlants ?? []).find((p) => p.id === c.heatingPlantId) : undefined
    if (plant === undefined || (plant.periodStartMonth ?? null) === null) return undefined
    const period = periodOfKey(plantRules(wayOf(plant), objectRules), c.period)
    if (period === null) return undefined
    return { period, label: `Heizkosten ${periodLabel(period)}`, items: pool.filter((x) => x.period === c.period && x.heatingPlantId === c.heatingPlantId) }
  }
  const countedIds = new Set(counted.map((c) => c.id))
  const pool = linkable ?? given.flatMap((p) => [...p.snapshot.costItems, ...(p.snapshot.heatingParts ?? []).flatMap((x) => x.items)])
  const seen = new Set<string>()
  const movedOut: TaxMovedOut[] = []
  for (const c of pool) {
    if (seen.has(c.id) || countedIds.has(c.id) || startYearOf(c.period) !== year || groupOf(c.category) === null) continue
    seen.add(c.id)
    // Zuerst der Zeitraum, unter dessen Positionen sie steht; eine Heizperiode kann denselben Schlüssel tragen wie ein
    // Abrechnungszeitraum.
    const known = ownOf.get(c.id) ?? heatingPeriodOf(c) ?? periodOf.get(c.period)
    // Ohne bekannten Zeitraum zählen nur die Jahre seiner Grenzen (`touched`, `paidOnSpan`, `periodLabel`).
    const fallback = (): Own => {
      const period: BillingPeriod = { key: c.period, from: `${c.period}-01`, to: `${c.period.endsWith('-01') ? year : year + 1}-12-31`, short: false }
      return { period, label: periodLabel(period), items: pool.filter((x) => x.period === c.period) }
    }
    const own = known ?? fallback()
    const outflow = outflowOf(c, own)
    if (outflow === null || outflow.year === year || touched(own.period, outflow.year)) continue
    movedOut.push({
      costItemId: c.id, category: c.category, description: c.description, amountCents: c.amountCents,
      settlementPeriod: { key: own.period.key, label: own.label }, outflow,
      ...(outsideSpan(c, own.period) ? { outsideSpan: true as const } : {}),
    })
  }
  return { items, movedOut, unstatedCount }
}

// Die Teile der Steuerübersicht eines Objekts (#208, Heizung PR 5, Entwurf 3.10, #255): jeder
// Abrechnungszeitraum, der das Jahr oder das Vorjahr berührt, mit seinen Positionen, deren Jahr der
// Zahlung dieses Jahr ist (`paidWhollyIn`), dazu die Heizpositionen der Heizperioden, die er nach
// Weg b aufnimmt (ihr Jahr der Zahlung richtet sich nach ihrer Heizperiode). Jede
// Heizkostenabrechnung nach Weg d ist ein eigener Teil; den Eigenanteil liefert dann sie.
// **Für jedes Objekt, auch das Kalenderobjekt** (#255, E3): Vorher gab es dort `null`, und
// `taxReport` wie das Steuer-ZIP wählten mit einer zweiten Regel aus (`period` gleich dem
// Kalenderjahr). Für das Kalenderobjekt ergibt das denselben einen Teil: Ohne Angabe liegt jede
// Position im Jahr ihres Zeitraums, und eine Angabe ist dort nur das Jahr des Beginns
// (`requireTaxYear` in db/repository.ts); das Vorjahr hat dann keine Position und berührt das Jahr
// nicht. Die Invariante in outflow.test.ts hält alt gegen neu fest.
export function taxPartsFor(source: Parameters<typeof snapshotFor>[0], propertyId: string, year: number): TaxPart[] {
  const rules = rulesOf(source.properties?.find((p) => p.id === propertyId))
  const ownPlants = (source.heatingPlants ?? []).filter((p) => p.propertyId === propertyId && (p.periodStartMonth ?? null) !== null)
  const jahr = calendarYearPeriod(year)
  // Eine Heizperiode, die in diesem Jahr beginnt, kann in der Abrechnung des Folgejahres stehen (Weg b)
  // und doch in diesem Jahr bezahlt sein (Durchsicht von #231): Mit eigener Heizperiode reicht die Suche
  // deshalb bis ins Folgejahr, dort aber nur nach deren Heizpositionen.
  // #255 PR 3: Eine Position mit Zahlungsdatum kann weit vor oder nach ihrem Zeitraum bezahlt sein (vor dem Beginn oder
  // Jahre später, R-4 fragt dann nur nach). Die Suche reicht deshalb zusätzlich über die Zeiträume jeder Position, die in
  // diesem Jahr bezahlt ist, mit einem Jahr Rand für Zeiträume und Heizperioden über zwei Kalenderjahre. Ohne Datum
  // bleibt das Fenster, wie es war.
  const dated = source.costItems.filter((c) => c.propertyId === propertyId && c.paidOn != null && paidOnYear(c.paidOn) === year).map((c) => startYearOf(c.period))
  const von = calendarYearPeriod(Math.min(year - 1, ...dated.map((y) => y - 1))).from
  const bis = calendarYearPeriod(Math.max(ownPlants.length > 0 ? year + 1 : year, ...dated.map((y) => y + 2))).to
  const parts: TaxPart[] = periodsBetween(rules, von, bis).flatMap((p) => {
    const snap = snapshotFor(source, propertyId, p)
    const items = [
      // `snap.costItems`: Ein Abzug beim Betriebsstrom steht im Jahr seiner Stromrechnung (#267), und die steht im selben
      // Zeitraum (outflow.ts). Auch aus Zeiträumen nach dem Jahr: eine vorab bezahlte Position (#255 PR 3, R-9).
      ...snap.costItems.filter((c) => paidWhollyIn(c, p, year, snap.costItems)),
      ...(snap.heatingParts ?? []).filter((x) => !x.separate).flatMap((x) => x.items.filter((c) => paidWhollyIn(c, x.period, year, x.items))),
    ]
    const touches = p.from <= jahr.to && p.to >= jahr.from
    return items.length > 0 || touches ? [{ snapshot: snap, items }] : []
  })
  const separate: TaxPart[] = ownPlants.flatMap((plant) => {
    const way = wayOf(plant)
    return periodsBetween(plantRules(way, rules), von, dated.length > 0 ? bis : jahr.to).flatMap((h) => {
      if (!settledSeparately(way, rules, h)) return []
      const snap = heatingSnapshotFor(source, propertyId, plant.id, h)
      if (!snap) return []
      const items = snap.costItems.filter((c) => paidWhollyIn(c, h, year, snap.costItems))
      if (items.length > 0) return [{ snapshot: snap, items }]
      // Ohne Positionen in diesem Jahr nur im Jahr ihres Beginns, für den Übertrag aus dem Vorrat (`carryShareCents`).
      return Number(h.from.slice(0, 4)) === year ? [{ snapshot: snap, items: [], carryOnly: true as const }] : []
    })
  })
  return [...parts, ...separate]
}

// `parts`: die Teile aus `taxPartsFor`, wenn der Aufrufer sie ohnehin braucht (das Steuer-ZIP wählt mit denselben
// Teilen aus, Durchsicht von #255 PR 1, K5); sonst rechnet sie die Funktion selbst.
export function taxReportFor(source: Parameters<typeof snapshotFor>[0], propertyId: string, year: number, parts: readonly TaxPart[] = taxPartsFor(source, propertyId, year)): TaxReport {
  const calendar = snapshotFor(source, propertyId, calendarYearPeriod(year))
  // Durchsicht M1 zu #268: Ein Abzug kann auf eine Heizposition in einem anderen Steuerjahr zeigen; der Schnappschuss
  // kennt nur die Positionen seines Zeitraums. Deshalb bekommt die Übersicht alle Positionen des Objekts für Verweise.
  const all = source.costItems.filter((c) => c.propertyId === propertyId)
  return taxReport(calendar, parts, { linkable: all, foreignQuota: foreignHeatQuota(source, propertyId, year, all) })
}

// Durchsicht von #255 PR 2, M1: der Heizanteil der Anlage in dem Teil, in dem eine Heizposition steht, wenn sie in einem
// anderen Steuerjahr steht als der Abzug, der auf sie zeigt. Gesucht wird zuerst im Jahr, das `outflowShares` ihr gibt,
// dann in den Jahren daneben; gerechnet wird wie in der Steuerübersicht jenes Jahres (Teile, Abrechnung, Aufteilung).
function foreignHeatQuota(source: Parameters<typeof snapshotFor>[0], propertyId: string, year: number, all: Parameters<typeof snapshotFor>[0]['costItems']): ForeignHeatQuota {
  const partsOf = new Map<number, readonly TaxPart[]>()
  const splitOf = new Map<string, TaxSplit>()
  return (id, plant) => {
    const item = all.find((c) => c.id === id)
    if (item === undefined) return undefined
    // Das Jahr, in dem die Heizposition ohne Zahlungsdatum stünde, und ihr Teil darin (Durchsicht von PR 4, S1); gesucht
    // unter den Positionen des Teils, nicht nur unter den in diesem Jahr bezahlten.
    const own = storedOutflowYear(withoutDate(item), all.map(withoutDate))
    const years = [own, ...[-1, 1, -2, 2, -3, 3].map((d) => own + d)].filter((y) => y !== year)
    for (const y of years) {
      const parts = partsOf.get(y) ?? taxPartsFor(source, propertyId, y).filter((p) => !p.carryOnly)
      partsOf.set(y, parts)
      const at = parts.findIndex((p) => heatPool(p).some((x) => x.c.id === id))
      const part = parts[at]
      if (part === undefined) continue
      // Das Jahr ohne Datum aus der Position in ihrem Teil, mit dem Zeitraum (N1); `own` war nur der Ausgangspunkt der Suche.
      const entry = heatPool(part).find((x) => x.c.id === id)
      const y0 = entry ? yearWithoutDate(entry.c, entry.period, []) ?? own : own
      const key = `${y}|${at}`
      const settlement = () => computeSettlement(part.snapshot)
      const split = splitOf.get(key) ?? splitForTax(part.snapshot, part.items.filter((c) => groupOf(c.category) !== null), settlement(), calendarYearPeriod(y))
      splitOf.set(key, split)
      const extra = () => {
        const k = `${key}|alle`
        const done = splitOf.get(k) ?? splitForTax(part.snapshot, heatPool(part).map((x) => x.c).filter((c) => c.category === HEATING_CATEGORY), settlement(), calendarYearPeriod(y))
        splitOf.set(k, done)
        return done
      }
      return plantHeatQuota(part, split, plant, y0, extra)
    }
    return undefined
  }
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

type TaxSplit = { items: Map<string, TaxExpenseItem>, selfUseChangedInYear: boolean, usageChangedUnits: string[], closedSelfUseDiffers: boolean, closedItemsChanged: number }

// `calendar`: das Steuerjahr. Ein Zeitraum wie Mai bis April reicht über zwei; seine Hinweise gelten nur für den Teil darin.
// Die Nutzung der Einheiten in [from, to] (ein Zeitraum, nie leer) für die Steuer (#259): Anteil der Tage
// selbstgenutzt, außerhalb an einem Tag, Wechsel im Zeitraum. Ohne Wechsel ist der Anteil genau 1 oder 0, damit keine
// Zahl wandert.
function taxUsage(units: readonly SnapshotUnit[], from: string, to: string) {
  const days = rangeOverlapDays(from, to, from, to)
  const byId = new Map(units.map((u) => [u.id, usageDays(u, from, to)]))
  const of = (u: SnapshotUnit) => byId.get(u.id) ?? usageDays(u, from, to)
  const phased = (u: SnapshotUnit): boolean => { const d = of(u); return [d.vermietet, d.eigen, d.ausgenommen].filter((x) => x > 0).length > 1 }
  return {
    days,
    phased,
    selfDays: (u: SnapshotUnit): number => of(u).eigen,
    selfShare: (u: SnapshotUnit): number => {
      const d = of(u)
      return phased(u) ? d.eigen / days : (d.eigen > 0 ? 1 : 0)
    },
    outside: (u: SnapshotUnit): boolean => of(u).ausgenommen > 0,
  }
}

function splitForTax(snapshot: Snapshot, items: SnapshotCostItem[], settlement: ComputedSettlement, calendar: Pick<BillingPeriod, 'from' | 'to'>): TaxSplit {
  // Gefragt wird nur der Teil des Zeitraums im Steuerjahr; sonst meldete Mai bis April eine Vermietung im Juni 2024
  // auch für 2025.
  const from = snapshot.period.from > calendar.from ? snapshot.period.from : calendar.from
  const to = snapshot.period.to < calendar.to ? snapshot.period.to : calendar.to
  // **Nutzungswechsel (#259, Teil 1).** Umlagefähige Positionen folgen dem Eigenanteil der Abrechnung und sind damit
  // tagesgenau. Was hier nach Fläche geteilt wird, liest die Nutzung am letzten Tag dieses Teils im Steuerjahr
  // (`unitAsOf`); tagesgenau wird das mit Teil 2. Ohne Wechsel ist das die Angabe an der Einheit, dasselbe Objekt.
  const units = snapshot.units
  // Tagesgenau (#259, Durchsicht M1, Nachprüfung M-a): selbstgenutzt nach dem Anteil der Tage im **ganzen Zeitraum des
  // Teils**, außerhalb an mindestens einem Tag darin. Nicht nur im Schnitt mit dem Steuerjahr: Eine spät bezahlte Position
  // hätte sonst einen leeren Schnitt, und bei Mai bis April hinge der private Teil vom Jahr der Zahlung ab; so sagt die
  // Steuer dasselbe wie der Eigenanteil der Abrechnung desselben Zeitraums. Ohne Wechsel genau 1 oder 0. Beschriftet
  // wird nach der Nutzung am letzten Tag des Zeitraums.
  const usage = taxUsage(units, snapshot.period.from, snapshot.period.to)
  const labelOf = (u: SnapshotUnit): SnapshotUnit => unitAsOf(u, snapshot.period.to)
  const usageChangedIds = new Set(snapshot.units.filter((u) => usageChangesWithin(u, snapshot.period.from, snapshot.period.to)).map((u) => u.id))
  const unitById = new Map(units.map((u) => [u.id, u]))
  const isSelf = (u: SnapshotUnit) => usage.selfShare(u) > 0
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
    // Ein Zeitraum ohne Positionen in diesem Steuerjahr (Mai bis April: der Vorzeitraum) verteilt hier nichts; seine
    // Abweichung gehört in das Jahr, in dem seine Positionen stehen.
    closedSelfUseDiffers = items.length > 0 && todaySum !== frozen.selfUsedShareCents
  }

  // **Gibt es Einheiten außerhalb der Abrechnungseinheit, zählt das ganze Gebäude** (Durchsicht).
  // Die Abrechnung verteilt nur über die Abrechnungseinheit; ihr Eigenanteil behandelte die
  // Fläche einer getrennt abgerechneten Gewerbeeinheit damit wie privat (100 m² eigen, 100 m²
  // vermietet, 100 m² Gewerbe: 1.500 € statt 1.000 € von 3.000 €). Dann gilt für die Schlüssel,
  // die über Wohnungen verteilen, der BFH-Maßstab über das Gebäude, und der Eigenanteil der
  // Abrechnung steht zum Vergleich daneben. Verbrauch und Einzelbeträge ordnen dagegen eindeutig
  // zu (der Verbrauch einer Einheit außerhalb steckt in der Verteilbasis), dort bleibt es bei der
  // Abrechnung. Gefragt wird nach den betroffenen Einheiten der Position.
  const outside = (u: SnapshotUnit) => usage.outside(u)
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
    const selfArea = selfAffected.reduce((a, u) => a + areaOf(u) * usage.selfShare(u), 0)
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
      `direkt: ${u.name} (${usage.phased(u) ? `selbstgenutzt an ${fmtNum(usage.selfDays(u))} von ${fmtNum(usage.days)} Tagen` : isSelf(u) ? 'selbstgenutzt' : labelOf(u).participates ? 'vermietete Einheit' : 'außerhalb der Abrechnungseinheit'})`
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
        // Mit Wechsel nach den Tagen der Eigennutzung (#259); ohne Wechsel der ganze Betrag.
        privateCents = usage.phased(direct) ? roundHalfAway(amount * usage.selfShare(direct)) : amount
        steps.push({ label: 'Zuordnung', value: directLabel(direct) })
        steps.push({ label: 'privat', value: fmtCents(privateCents), term: 'ownShare' })
      } else if (direct) {
        allocation = labelOf(direct).participates ? 'direct-rented' : 'direct-outside'
        steps.push({ label: 'Zuordnung', value: directLabel(direct) })
      } else {
        allocation = applyArea()
      }
    } else if (direct && !fromBill.noBasis) {
      allocation = isSelf(direct) ? 'direct-self' : labelOf(direct).participates ? 'direct-rented' : 'direct-outside'
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
  // Eine Einheit mit eingetragenem Nutzungswechsel (#259) meldet sich eigens (`usageChangedUnits`).
  const selfIds = new Set(units.filter(isSelf).filter((u) => !usageChangedIds.has(u.id)).map((u) => u.id))
  const selfUseChangedInYear = from <= to && snapshot.tenancies.some((t) => selfIds.has(t.unitId) && rangeOverlapDays(t.start, t.end, from, to) > 0)
  const usageChangedUnits = snapshot.units.filter((u) => usageChangedIds.has(u.id)).map((u) => u.name)
  return { items: result, selfUseChangedInYear, usageChangedUnits, closedSelfUseDiffers, closedItemsChanged }
}

// ---------- Ausgleich beim Betriebsstrom in der Steuer (#268) ----------
//
// Die Zeile zum Ausgleich C (server/src/operatingPower.ts). **Der private Teil folgt dem Heizanteil** (R-4): Jeder
// Beitrag zu C wird mit dem Eigenanteil an den Heizkosten seiner Anlage in der Abrechnung seines Teils gewichtet, so
// wie diese Steuerübersicht die Heizpositionen dieser Anlage aufteilt (bei abgeschlossener Abrechnung also aus dem
// eingefrorenen Stand). Dann ergibt ein verknüpfter Abzug über dem Betriebsstrom steuerlich dasselbe wie das richtige
// Paar, und Abrechnung und Steuer nennen denselben Eigenanteil; beim Abzug ohne Verweis gilt die Fläche (unten). Lässt sich keine Anlage zuordnen (Abzug ohne Verweis) oder hat die Anlage dort
// keine Heizkosten, gilt die Wohn- und Nutzfläche des ganzen Gebäudes (BFH, Urteil vom 24.06.2008, IX R 26/06), wie
// bei einer nicht umlagefähigen Gebäudeposition. Beides ist eine Auslegung von Mietfuchs: Für den Maßstab gibt es keine
// Norm, die Abgrenzung zum Privaten folgt aus § 9 Abs. 1 Satz 1 und § 12 Nr. 1 EStG. Gerundet wird einmal, über die
// ganze Zeile; mit Vorzeichen, denn ein negativer Ausgleich hat einen negativen privaten Teil.
const balanceLineId = (year: number): string => `operating-power-balance:${year}`

// Eigenanteil an den Heizkosten einer Anlage in einem Teil, wie die Steuerübersicht die Heizpositionen aufteilt (#268).
// `null`: keine Heizposition der Anlage im Teil; `'unusable'`: kein Maßstab (Gutschrift über der Rechnung).
type HeatQuota = { privateCents: number; amountCents: number } | 'unusable' | null
// #255, Durchsicht von PR 4 (S1): **Der Heizanteil gehört zum Zeitraum, nicht zum Zahlungsdatum.** Gerechnet wird aus
// den Heizpositionen der Anlage im Teil (`heatPool`), die ohne Zahlungsdatum im Steuerjahr `y0` stünden
// (`yearWithoutDate`), und `y0` ist das Jahr, in dem der Betriebsstrom selbst ohne Datum stünde. Vorher zählten die
// Heizpositionen, die im Steuerjahr stehen: Wanderte eine per Zahlungsdatum in ein anderes Jahr, änderte sich der
// Heizanteil und mit ihm der private Teil des Ausgleichs, über alle Jahre zusammen bis 55,78 €. Dieselbe Regel wie in
// Teil 2 für den verknüpften Abzug (Heizanteil aus dem Teil der Heizposition). Ohne Datum sind es genau die Heizpositionen
// des Jahres, und keine Zahl ändert sich (Prüfsummen, Gleichheitsinvariante). `extra`: die Aufteilung der Heizpositionen,
// die nicht in diesem Jahr stehen, erst bei Bedarf gerechnet.
type PoolItem = { c: SnapshotCostItem; period: BillingPeriod }
function heatPool(p: TaxPart): PoolItem[] {
  return [
    ...p.snapshot.costItems.map((c) => ({ c, period: p.snapshot.period })),
    ...(p.snapshot.heatingParts ?? []).filter((x) => !x.separate).flatMap((x) => x.items.map((c) => ({ c, period: x.period }))),
  ]
}
const withoutDate = <C extends { paidOn?: string | null }>(c: C): C => (c.paidOn != null ? { ...c, paidOn: undefined } : c)
// Nachprüfung von PR 4, N1: **Dieselbe Zahlung in beiden Eingabeformen gleich.** Bei einem Zeitraum über zwei
// Kalenderjahre darf eine Position statt des Jahres der Zahlung nur ein Datum tragen (`requireTaxYear`). Für die Klammer
// gilt dann das Jahr des Datums, geklemmt auf die Spanne eines Jahres der Zahlung (Beginn bis Ende + 1), wie ein
// eingetragenes `taxYear`; sonst fiele sie auf das Beginnjahr zurück, das es für sie nie gab. Bei einem Kalenderzeitraum
// ist das Jahr der Zahlung stets das Beginnjahr. Offen ist die saubere Regel „alle Heizpositionen der Anlage im
// Zeitraum, unabhängig von Datum und Jahr“: Sie änderte veröffentlichte Zahlen bei Mai bis April mit `taxYear`.
function asStatedYear<C extends { paidOn?: string | null; taxYear?: number }>(c: C, period: Pick<BillingPeriod, 'from' | 'to'>): C {
  if (c.paidOn == null) return c
  if (c.taxYear != null || !spansTwoYears(period)) return withoutDate(c)
  const start = Number(period.from.slice(0, 4))
  const end = Number(period.to.slice(0, 4))
  return { ...withoutDate(c), taxYear: Math.min(Math.max(paidOnYear(c.paidOn), start), end + 1) }
}
function yearWithoutDate(c: SnapshotCostItem, period: Pick<BillingPeriod, 'from' | 'to'>, items: readonly SnapshotCostItem[]): number | null {
  return outflowShares(asStatedYear(c, period), period, items.map((x) => asStatedYear(x, period)))[0]?.year ?? null
}
function plantHeatQuota(p: TaxPart, s: TaxSplit, plant: string | null, y0: number, extra: () => TaxSplit): HeatQuota {
  let privateCents = 0
  let amountCents = 0
  for (const { c, period } of heatPool(p)) {
    if (c.category !== HEATING_CATEGORY || (c.heatingPlantId ?? null) !== plant) continue
    if (yearWithoutDate(c, period, []) !== y0) continue
    const x = s.items.get(c.id) ?? extra().items.get(c.id)
    if (!x) continue
    privateCents += x.privateCents
    amountCents += x.amountCents
  }
  // Durchsicht #297 K3: Heizkosten der Anlage netto ≤ 0 (Gutschrift über der Rechnung) sind ebenso kein Maßstab; ganz
  // ohne Heizposition bleibt es beim Rückfall wie beim Abzug ohne Verweis.
  if (amountCents === 0 && privateCents === 0) return null
  if (!(amountCents > 0)) return 'unusable'
  // Integrationsdurchsicht M1: Eine Gutschrift mit eigenem Schlüssel oder eigenen Teilnehmern kann den Nenner fast
  // aufzehren; dann liegt die Quote außerhalb 0…1 (gemessen 875 %), und der private Teil stünde über dem Betrag, auch
  // mit falschem Vorzeichen. Eine solche Quote ist kein Heizanteil; es gilt dann die Fläche wie beim Abzug ohne Verweis.
  return privateCents >= 0 && privateCents <= amountCents ? { privateCents, amountCents } : 'unusable'
}

// Der Heizanteil einer Heizposition in einem anderen Steuerjahr (Durchsicht von #255 PR 2, M1): der der Anlage in dem
// Teil, in dem die Heizposition dort steht. `undefined`: in keinem Steuerjahr gefunden.
export type ForeignHeatQuota = (heatingItemId: string, plant: string | null) => HeatQuota | undefined

function operatingPowerBalanceItem(
  balance: OperatingPowerBalance, used: readonly TaxPart[], splits: readonly TaxSplit[], units: readonly SnapshotUnit[], year: number,
  foreignQuota?: ForeignHeatQuota,
  allHeatSplit: (part: number) => TaxSplit | undefined = () => undefined,
): TaxExpenseItem {
  const cents = balance.cents
  // Nach Tagen der Eigennutzung im Zeitraum des Teils, aus dem der Abzug stammt (#259, K1, Nachprüfung M-a), dieselbe
  // Regel wie `splitForTax`; die Zeile des Rechenwegs nennt die Fläche über das Kalenderjahr.
  const usage = taxUsage(units, `${year}-01-01`, `${year}-12-31`)
  const usageOfPart = (part: number) => { const p = used[part]; return p ? taxUsage(units, p.snapshot.period.from, p.snapshot.period.to) : usage }
  const isSelf = (u: SnapshotUnit) => usage.selfShare(u) > 0 || used.some((_, k) => usageOfPart(k).selfShare(u) > 0)
  const areaOf = (u: SnapshotUnit) => u.areaM2 || 0
  const selfUnits = units.filter(isSelf)
  const totalArea = units.reduce((a, u) => a + areaOf(u), 0)
  const selfArea = selfUnits.reduce((a, u) => a + areaOf(u) * usage.selfShare(u), 0)
  const selfAreaOfPart = (part: number) => selfUnits.reduce((a, u) => a + areaOf(u) * usageOfPart(part).selfShare(u), 0)
  const missing = selfUnits.filter((u) => !(areaOf(u) > 0))
  const areaOk = selfUnits.length === 0 || (missing.length === 0 && totalArea > 0)

  // Eigenanteil an den Heizkosten einer Anlage in einem Teil, wie diese Übersicht die Heizpositionen aufteilt.
  const extraSplits = new Map<number, TaxSplit>()
  const empty: TaxSplit = { items: new Map(), selfUseChangedInYear: false, usageChangedUnits: [], closedSelfUseDiffers: false, closedItemsChanged: 0 }
  const heatQuota = (part: number, plant: string | null, y0: number): HeatQuota => {
    const p = used[part]
    const s = splits[part]
    const extra = () => {
      const done = extraSplits.get(part) ?? allHeatSplit(part) ?? empty
      extraSplits.set(part, done)
      return done
    }
    return p && s ? plantHeatQuota(p, s, plant, y0, extra) : null
  }
  // Das Jahr, in dem eine Position des Teils ohne Zahlungsdatum stünde (Durchsicht von PR 4, S1). Ein Abzug folgt dabei
  // seiner Stromrechnung, auch ohne deren Datum.
  const yearOf = (part: number, id: string): number => {
    const p = used[part]
    const at = p ? heatPool(p).find((x) => x.c.id === id) : undefined
    if (!p || !at) return year
    return yearWithoutDate(at.c, at.period, p.snapshot.costItems) ?? year
  }

  const steps: CalcStep[] = []
  const deductions = balance.sources.filter((s) => s.kind === 'deduction')
  const included = balance.sources.filter((s) => s.kind === 'included')
  // Durchsicht S1: Die Texte folgen der Lage. „Selbst getragen“ nur beim Abzug ohne Verweis, „prüfen“ nur, wenn Abzug
  // und Betriebsstrom im selben Steuerjahr verschieden hoch sind; ein Paar über zwei Steuerjahre ist richtig erfasst.
  for (const s of deductions) {
    // Nachprüfung N3: Ein Verweis auf eine Position, die kein Betriebsstrom in den Heizkosten ist, heißt so.
    const how = s.situation === 'kept'
      ? (s.notReported ? 'ohne Verweis auf eine Heizposition, nach Ihrer Angabe dem Messdienst nicht gemeldet' : 'ohne Verweis auf eine Heizposition und ohne Messdienst')
      : s.situation === 'brokenLink'
        ? (s.linkedDescription === null ? 'verknüpft mit einer Position, die Mietfuchs nicht findet; prüfen Sie den Verweis'
          : `verknüpft mit „${s.linkedDescription}“, die nicht als Betriebsstrom in den Heizkosten gekennzeichnet ist; prüfen Sie den Verweis`)
        : `verknüpft mit der Heizposition „${s.linkedDescription ?? ''}“${s.situation === 'otherYear' ? ' in einem anderen Steuerjahr' : ''}`
    steps.push({ label: 'Abzug beim Allgemeinstrom', value: `„${s.description}“ ${fmtCents(s.cents)}, ${how}`, term: 'operatingPower' })
  }
  for (const s of included) {
    steps.push({ label: 'Betriebsstrom in den Heizkosten', value: `„${s.description}“ ${fmtCents(0 - s.cents)}, steckt auch in der Stromrechnung${s.situation === 'otherYear' ? '; ihr Abzug steht in einem anderen Steuerjahr' : ''}`, term: 'operatingPower' })
  }
  for (const r of balance.reported) {
    // #270, Durchsicht K3: ohne Angabe gilt der Abzug als gemeldet; der Satz sagt es so.
    const why = r.stated ? 'Nach Ihrer Angabe steckt der Betrag in den Kosten des Messdienstes' : 'Ohne Ihre Angabe gilt er als dem Messdienst gemeldet; dann steckt der Betrag in den Kosten des Messdienstes'
    steps.push({ label: 'Abzug, dem Messdienst gemeldet', value: `„${r.description}“ ${fmtCents(0 - r.amountCents)}, zählt hier nicht: ${why}` })
  }
  const deducted = deductions.reduce((a, s) => a + s.cents, 0)
  // K1 der Durchsicht: `0 - …`, damit ohne Heizposition „0,00 €“ steht und nicht „-0,00 €“.
  const inHeating = included.reduce((a, s) => a - s.cents, 0)
  steps.push({ label: 'Ausgleich', value: `${fmtCents(deducted)} abgezogen − ${fmtCents(inHeating)} in den Heizkosten = ${fmtCents(cents)}` })
  const once = 'Bezahlt haben Sie die Stromrechnung einmal; Mietfuchs zählt sie deshalb genau einmal zu den Werbungskosten (§ 9 Abs. 1 Satz 1 EStG).'
  const hint: Record<OperatingPowerBalance['kind'], string> = {
    kept: 'Beim Allgemeinstrom ist Betriebsstrom abgezogen, ohne dass er in den Heizkosten steht. Diesen Teil legen Sie nicht um und tragen ihn selbst. Bezahlt haben Sie ihn mit der Stromrechnung; er gehört deshalb zu den Werbungskosten (§ 9 Abs. 1 Satz 1, § 11 Abs. 2 Satz 1 EStG). Der Abzug mindert nur die Abrechnung an die Mieter.',
    otherYear: `Abzug beim Allgemeinstrom und Betriebsstrom in den Heizkosten stehen in verschiedenen Steuerjahren. Der Ausgleich hebt in jedem Jahr auf, was zum anderen gehört, sodass jedes Jahr die in ihm bezahlte Stromrechnung zählt. ${once}`,
    mixed: `Ein Teil ist Betriebsstrom, den Sie nicht umlegen und selbst tragen (Abzug ohne Verweis); ein Teil gehört zu Abzug und Betriebsstrom in verschiedenen Steuerjahren. ${once}`,
    // Nachprüfung N2: Steht daneben ein Abzug ohne Verweis, ist dieser Teil richtig erfasst; „prüfen“ gilt dann nur den
    // verknüpften Abzügen.
    mismatch: balance.keptCents !== 0
      ? `Abzug beim Allgemeinstrom und Betriebsstrom in den Heizkosten sind in diesem Steuerjahr verschieden hoch. Davon tragen Sie ${fmtCents(balance.keptCents)} selbst (Abzug ohne Verweis); dieser Teil ist richtig erfasst. ${once} Prüfen Sie in der Abrechnung, ob der verknüpfte Abzug beim Allgemeinstrom zum Betriebsstrom passt.`
      : `Abzug beim Allgemeinstrom und Betriebsstrom in den Heizkosten sind in diesem Steuerjahr verschieden hoch. ${once} Prüfen Sie in der Abrechnung, ob der Abzug beim Allgemeinstrom zum Betriebsstrom passt.`,
  }
  steps.push({ label: 'Hinweis', value: hint[balance.kind] })

  // Der private Teil, Beitrag für Beitrag.
  let raw = 0
  let byArea = false
  let quotaUnusable = false
  let unsplittable = false
  const quotaSteps: CalcStep[] = []
  const seen = new Set<string>()
  // Durchsicht von #255 PR 2, M1: Ein verknüpfter Abzug nimmt den Heizanteil aus dem Teil, in dem seine Heizposition
  // steht, und nicht aus dem Teil, in dem er selbst steht. Seit #267 steht er im Steuerjahr seiner Stromrechnung, die
  // Heizposition oft in einem anderen; hat die Anlage im Jahr des Abzugs keine Heizkosten, galt dort die Fläche, und über
  // beide Jahre fehlte privat der Unterschied. So heben sich Abzug und Heizposition auch über zwei Steuerjahre im
  // privaten Teil auf. Stehen beide im selben Teil, ist es derselbe Heizanteil wie bisher.
  const quotaOf = (s: OperatingPowerBalance['sources'][number]): { quota: HeatQuota; where: string } => {
    if (s.plant === undefined) return { quota: null, where: '' }
    if (s.kind === 'deduction' && s.linkedId !== undefined) {
      const id = s.linkedId
      const at = used.findIndex((p) => p.items.some((c) => c.id === id))
      if (at >= 0) return { quota: heatQuota(at, s.plant, yearOf(at, id)), where: String(at) }
      const foreign = foreignQuota?.(id, s.plant)
      if (foreign !== undefined) return { quota: foreign, where: `bei ${id}` }
    }
    return { quota: heatQuota(s.part, s.plant, yearOf(s.part, s.costItemId)), where: String(s.part) }
  }
  for (const s of balance.sources) {
    const { quota, where } = quotaOf(s)
    if (quota === 'unusable') quotaUnusable = true
    const q = quota === 'unusable' ? null : quota
    if (q) {
      raw += (s.cents * q.privateCents) / q.amountCents
      const key = `${where}|${s.plant}`
      if (!seen.has(key)) {
        seen.add(key)
        quotaSteps.push({ label: where.startsWith('bei ') ? `Eigenanteil an den Heizkosten der Anlage im Zeitraum von „${s.linkedDescription ?? ''}“` : 'Eigenanteil an den Heizkosten der Anlage', value: `${fmtCents(q.privateCents)} von ${fmtCents(q.amountCents)} (${fmtNum(Math.round((q.privateCents / q.amountCents) * 10000) / 100)} %)`, term: 'ownShare' })
      }
    } else if (!areaOk) {
      unsplittable = true
    } else {
      byArea = true
      if (totalArea > 0) raw += (s.cents * selfAreaOfPart(s.part)) / totalArea
    }
  }
  const privateCents = roundHalfAway(raw)
  if (selfUnits.length > 0) {
    if (quotaSteps.length > 0) {
      steps.push({ label: 'Zuordnung', value: 'verhältnismäßig nach dem Eigenanteil an den Heizkosten derselben Anlage laut Nebenkostenabrechnung; das ist eine Auslegung von Mietfuchs', term: 'mixedUse' })
      steps.push(...quotaSteps)
    }
    if (byArea) {
      const why = quotaUnusable
        ? 'denn der Heizanteil der Anlage taugt hier nicht als Maßstab: Eine Gutschrift mit anderem Schlüssel oder anderen Beteiligten als die Rechnung lässt ihn unter null oder über den ganzen Betrag steigen'
        : 'denn ein Abzug ohne Verweis gehört zu keiner bestimmten Anlage'
      steps.push({ label: 'Zuordnung', value: `nach Wohn- und Nutzfläche des ganzen Gebäudes wie bei Kosten des ganzen Gebäudes, ${why}; das ist eine Auslegung von Mietfuchs`, term: 'mixedUse' })
      steps.push({ label: 'Betroffene Fläche', value: `${fmtNum(totalArea)} m² (ganzes Gebäude), davon selbstgenutzt ${fmtNum(selfArea)} m²` })
    }
    if (unsplittable) {
      steps.push({ label: 'Zuordnung', value: `nicht aufteilbar: Für ${andList(missing.length > 0 ? missing.map((u) => u.name) : selfUnits.map((u) => u.name))} ist keine Fläche hinterlegt; der Betrag ist insoweit ungekürzt angesetzt`, term: 'mixedUse' })
    }
    steps.push({ label: 'Rechnung', value: `privat ${fmtExactEuro(raw)}` })
    steps.push({ label: 'privat, auf Cent gerundet', value: fmtCents(privateCents), term: 'ownShare' })
  }
  const allocation: TaxAllocation = unsplittable ? 'unsplittable' : byArea ? 'area' : 'settlement'
  const deductibleCents = cents - privateCents
  const deductiblePercent = allocation !== 'unsplittable' ? Math.round((deductibleCents / cents) * 10000) / 100 : null
  steps.push({ label: 'abziehbar', value: deductiblePercent !== null ? `${fmtCents(deductibleCents)} (${fmtNum(deductiblePercent)} %)` : fmtCents(deductibleCents) })
  return {
    costItemId: balanceLineId(year),
    category: GENERAL_POWER_CATEGORY,
    group: groupOf(GENERAL_POWER_CATEGORY) ?? 'Sonstige Werbungskosten',
    // Durchsicht S1: „selbst getragen“ nur, wenn es das ist; sonst neutral.
    description: balance.kind === 'kept' ? 'Betriebsstrom der Heizung, selbst getragen' : 'Betriebsstrom der Heizung, Ausgleich',
    amountCents: cents,
    privateCents,
    deductibleCents,
    labor35aCents: 0,
    allocation,
    deductiblePercent,
    areaPrivateCents: null,
    settlementPrivateCents: null,
    steps,
    taxUnits: null,
    operatingPowerBalance: true,
  }
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
  return NF_MAX2.format(n)
}

// Zwischenwerte des Rechenwegs (#114). Der Prozentsatz mit bis zu sechs Stellen, damit Betrag ×
// Prozent auch bei 30.000 € noch den gezeigten Wert ergibt; der genaue Betrag mit mindestens zwei
// und höchstens vier, damit ein Rundungsschritt sichtbar bleibt und er neben den übrigen
// Beträgen nicht ohne Cent dasteht.
function fmtPercent(n: number): string {
  return NF_MAX6.format(n)
}
function fmtExactEuro(cents: number): string {
  return `${NF_2TO4.format(cents / 100)} €`
}

// Ein Betrag für den Rechenweg auf der Abrechnung (#94): mit zwei Stellen und einem gewöhnlichen
// Leerzeichen vor dem Zeichen. `toLocaleString` mit `currency` setzte ein geschütztes, das in
// den Zeilen nicht anders aussieht, beim Vergleichen und Kopieren aber stört.
function fmtCents(cents: number): string {
  return `${NF_FIX2.format(cents / 100)} €`
}

// Für calc-zahlenformat.test.ts: die Formate gegen den früheren Aufruf
export const STEP_FORMATS = { fmtNum, fmtPercent, fmtExactEuro, fmtCents, fmtMeter, fmtKg, fmtPermille, fmtQuantity, fmtPlain }

// Die Abzugszeile nach § 7 Abs. 5 CO2KostAufG (Heizung PR 18).
const GMODG_RELIEF_LABEL = 'Netzentgelte und Biobrennstoff: Anteil des Vermieters (§ 5a CO2KostAufG)'
// Wann beim Biobrennstoff eine 0 richtig ist und wann nicht (Prüfung M7 im Wortlaut der Gegenprüfung; Entscheidung
// R18-3): nur, wenn die Lieferung keinen Pflichtanteil enthält; sonst muss der Lieferant den Preisbestandteil
// ausweisen.
const BIO_ZERO_TEXT = 'Enthält die Lieferung keinen Pflichtanteil an Biobrennstoff, etwa weil die Pflicht ganz anders erfüllt ist (§ 43 Abs. 3 bis 5, § 45 Abs. 2 GModG) oder noch nicht gilt (§ 43 Abs. 1 und 7 GModG), tragen Sie 0 ein. ' +
  'Wurde Biobrennstoff geliefert und fehlt der Preisbestandteil auf der Rechnung, fordern Sie ihn beim Lieferanten an; er muss ihn ausweisen (§ 3 Abs. 1 Nr. 6 CO2KostAufG).'

// Die Maßstäbe einer Gemeinschaft, wie sie im Rechenweg heißen (#94).
const MEASURE_LABELS: Record<ExternalMeasure, string> = { mea: 'MEA', area: 'm²', units: 'Einheiten' }

// ---------- Abrechnung ----------

// Mietverhältnis, ergänzt um die im Jahr belegten Tage und die zugehörige Wohnung: das
// Ergebnis der Vorbereitung unten, sobald Mietverhältnisse ohne (mehr) vorhandene Wohnung
// herausgefiltert sind.
type TenancyWithUnit = SnapshotTenancy & { days: number, unit: SnapshotUnit }

// Die Texte zum angebrochenen Monat (#311). Beträge je Monat „82,26 € statt 150,00 €“; der Heizanteil
// steht dabei, wenn ihn dieselbe Abrechnung anrechnet, sonst als eigener Satz (Weg d).
const monthWord = (month: string): string => monthSpanText([month])
function partialMonthNote(partial: readonly PartialMonth[], heating: boolean): string {
  const what = heating ? 'Heizvorauszahlung' : 'Vorauszahlung'
  const months = andList(partial.map((x) => monthWord(x.month)))
  const [only] = partial
  const detail = partial.length === 1 && only
    ? `${only.days} von ${only.of} Tagen, ${fmtCents(only.cents)}`
    : partial.map((x) => `${monthWord(x.month)}: ${x.days} von ${x.of} Tagen, ${fmtCents(x.cents)}`).join('; ')
  return `Für ${months} ist die ${what} anteilig angesetzt (${detail}).`
}
function partialMonthHint(t: TenancyWithUnit, partial: readonly PartialMonth[], totalCents: number, heating: boolean): string {
  const what = heating ? 'Heizvorauszahlung' : 'Vorauszahlung'
  const months = new Set(partial.map((x) => x.month))
  const events = [
    ...(months.has(t.start.slice(0, 7)) ? [`Einzug am ${fmtDay(t.start)}`] : []),
    ...(t.end && months.has(t.end.slice(0, 7)) ? [`Auszug am ${fmtDay(t.end)}`] : []),
  ]
  const amount = (x: PartialMonth): string => `${fmtCents(x.cents)} statt ${fmtCents(x.fullCents)}` +
    (!heating && x.heatingCents !== undefined && x.heatingCents !== x.cents ? ` (davon Heizvorauszahlung ${fmtCents(x.heatingCents)})` : '')
  const [only] = partial
  const list = andList(partial.map((x) => monthWord(x.month)))
  const credited = partial.length === 1 && only
    ? `Für ${list} setzt Mietfuchs die ${what} anteilig nach Kalendertagen an, ${only.days} von ${only.of} Tagen: ${amount(only)}.`
    : `Für ${list} setzt Mietfuchs die ${what} anteilig nach Kalendertagen an: ${partial.map((x) => `${monthWord(x.month)} ${x.days} von ${x.of} Tagen, ${amount(x)}`).join('; ')}.`
  const elsewhere = partial.flatMap((x) => x.elsewhereHeatingCents !== undefined && x.elsewhereHeatingFullCents !== undefined
    ? [`Die anteilige Heizvorauszahlung für ${monthWord(x.month)} (${fmtCents(x.elsewhereHeatingCents)} statt ${fmtCents(x.elsewhereHeatingFullCents)}) rechnet die Heizkostenabrechnung an.`]
    : [])
  const partCents = partial.reduce((a, x) => a + x.cents, 0)
  const fullCents = partial.reduce((a, x) => a + x.fullCents, 0)
  const withFull = fmtCents(totalCents - partCents + fullCents)
  const without = fmtCents(totalCents - partCents)
  // Die Beispielsummen setzen voraus, dass alle übrigen Monate voll gezahlt sind (R-4); maßgeblich
  // bleibt das tatsächlich Gezahlte. Gibt es keine übrigen Monate (Ein- und Auszug im selben Monat),
  // nennt das Beispiel nur den vollen Monat; „ohne Mai 2025 0,00 €“ wäre ein leerer Satz (Durchsicht K1).
  const onlyPartial = totalCents === partCents
  const fullText = partial.length === 1 && only ? `mit vollem ${monthWord(only.month)} ${withFull}` : `mit vollen Monaten ${withFull}`
  const withoutText = partial.length === 1 && only ? `ohne ${monthWord(only.month)} ${without}` : `ohne diese Monate ${without}`
  const example = onlyPartial ? `Zum Beispiel: ${fullText}.` : `Zum Beispiel, wenn alle übrigen Monate voll gezahlt sind: ${fullText}, ${withoutText}.`
  return [
    `${t.tenantName} (${t.unit.name}):${events.length > 0 ? ` ${events.join(', ')}.` : ''}`,
    credited,
    ...elsewhere,
    'Das ist eine Auslegung: Ihr Mietvertrag kann anderes vorsehen, und maßgeblich ist, was der Mieter für den Zeitraum tatsächlich gezahlt hat.',
    `Weicht das ab, tragen Sie die gezahlte Summe bei „abzüglich geleisteter ${what}en“ mit „✎ anpassen“ ein.`,
    example,
  ].join(' ')
}

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
  // Was die Zähler von Einheiten der Verteilbasis in ihren Tagen außerhalb der Abrechnungseinheit messen (#259).
  outsidePhased: number
  // Der Rest des Hauptzählers ist nach Tagen teils Eigenanteil (#259, S2).
  mainSelfByDays: boolean
  unmetered: SnapshotUnit[]
  limited: boolean
  hasMain: boolean
  main: number | null
  mainPartial: { meterId: string, days: number } | null
  mainBelowUnits: { main: number, units: number } | null
  mainGap: { main: number, units: number } | null
  // Bewohnte Einheiten, deren Zähler nur einen Teil ihrer Zeit abdecken (Befund der Durchsicht).
  partial: { unit: SnapshotUnit, covered: number, needed: number }[]
  // Die gemeinsame Einheit der Zähler samt Hauptzähler (#342): womit der Verbrauch eines Zählers malzunehmen
  // ist. `unitProblem`: eine unbekannte Einheit (Warnung, Faktor 1) oder verschiedene Größen (nicht verteilt).
  scaleOf: (meterId: string) => number
  unitProblem: UnitScale['problem']
  // Die Einheit, in der `basis` steht (umgerechnet die Grundeinheit), für die Verteilbasis auf der Abrechnung (N4 aus #341);
  // leer bei einer unbekannten Einheit, denn dann ist mit Faktor 1 über verschiedene Größen gezählt
  unit: string
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
    { key: 'notAgreed', landlord: true, raw: sum('notAgreed') },
    { key: 'outsideUnit', landlord: true, raw: sum('outsideUnit') + outside },
    { key: 'customRest', landlord: true, raw: custom },
    { key: 'mainMeterRest', landlord: true, raw: mainRest },
    { key: item.key === 'amounts' ? 'amountsRest' : 'vacancy', landlord: true, raw: rest },
  ]
}

// Die Umlagevereinbarung je Mietverhältnis (#258): die Kennungen einer der beiden Listen der Position. Nicht bei
// „Heizung und Warmwasser“ (die Heizkostenverordnung gilt auch ohne Vereinbarung), nicht bei nicht Umlagefähigem
// und nicht an den Übertragszeilen aus Lieferung und Vorrat. Der Server lehnt die Listen dort ab, das
// Wiederherstellen eines Backups prüft es aber nicht; deshalb liest die Berechnung sie dort nicht.
const NO_CONTRACT_IDS: ReadonlySet<string> = new Set()
const OTHER_COSTS_CATEGORY = 'Sonstige Betriebskosten'
function contractTenancyIds(item: SnapshotCostItem, list: 'notAgreedTenancyIds' | 'namedTenancyIds'): ReadonlySet<string> {
  const ids = item[list]
  if (!ids || ids.length === 0) return NO_CONTRACT_IDS
  if (item.category === HEATING_CATEGORY || isNotAllocable(item.category) || item.id.startsWith('fuel:') || item.id.startsWith('stock:')) return NO_CONTRACT_IDS
  return new Set(ids)
}

// Welches Modell für eine Kostenposition gilt: das für Heizung bei der Heizkostenart, sonst das
// für die kalten Kosten. Ohne Angabe die Abrechnung.
const modelFor = (t: SnapshotTenancy, item: SnapshotCostItem): CostModel =>
  item.category === HEATING_CATEGORY ? allocationModel(t.heatingModel) : t.costModel ?? 'settlement'

// Wie die Heizkosten eines Mietverhältnisses abgerechnet werden (Heizung PR 19, Prüfung M2). Heizt der Mieter
// selbst (`selfSupply`), trägt er den Brennstoff über seinen eigenen Vertrag; was dem Vermieter dafür laufend
// entsteht, etwa Wartung oder Betriebsstrom, legt er um wie sonst (§ 556 Abs. 1 BGB, § 2 Nr. 4 a, d BetrKV).
// Das ist die Abrechnung und weder Pauschale noch Inklusivmiete; jede Stelle, die nach dem Heizmodell fragt,
// liest es deshalb über diese Funktion.
export const allocationModel = (m: HeatingModel | undefined): CostModel => (m === 'selfSupply' || m === undefined ? 'settlement' : m)

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

// Die Bestandsrechnung einer Anlage mit Vorratsenergie für eine Heizperiode, wie die Abrechnung sie rechnet.
// Eigene Funktion seit Heizung PR 17 (Nachprüfung von #246, O2a/O2b): Das Blatt „CO₂-Angaben für den
// Messdienst“ liest dieselbe Entscheidung, statt eine eigene Regel für den Anfangsbestand zu haben.
// `countedAt` sagt, ob die CO₂-Kosten einer Rechnung dieses Tages zählen (§ 11 Abs. 2 Satz 2); ohne Angaben
// zum Vorrat wird es nicht gefragt (Entwurf 1.2 Nr. 1).
export function plantStockOf(
  snapshot: Pick<Snapshot, 'stockChains'>,
  plant: Pick<SnapshotHeatingPlant, 'id' | 'energy' | 'method'>,
  periodKey: string,
  countedAt: (date: string) => boolean,
): { result: StockResult; chain: StockPeriodInput[]; last: StockPeriodInput } | null {
  if (!isStockEnergy(plant.energy)) return null
  const chain = (snapshot.stockChains ?? []).find((c) => c.plantId === plant.id && c.period === periodKey)?.chain ?? []
  const last = chain.at(-1)
  if (!last) return null
  const touched = stockTouched(chain)
  const result = stockOf(chain, {
    needCost: plant.method !== 'service',
    needCo2: CO2_FUELS.includes(plant.energy),
    countedAt: touched ? countedAt : () => true,
    excludedUntil: co2CostsExcludedUntil(),
    countedFrom: co2CostsCountedFrom(),
  })
  return { result, chain, last }
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
  const lawLog = createLawLog(snapshot.lawOverrides ?? [])
  const lawPeriod: Period = { from: yFrom, to: yTo }
  // Zeitraum und Vorzeitraum für den Vergleich der Schlüssel und der Doppelungen (#141).
  const at = contextOf(period, snapshot.previousPeriod)
  // Heizung PR 5. `scope`: 'heatingPart' ist die Heizperiode, die eine Abrechnung P nach Weg b in sich
  // aufnimmt (ohne Vorauszahlungen, ohne eigene Hinweise zum Mietkonto), 'heating' die
  // Heizkostenabrechnung einer Heizperiode nach Weg d; ohne Angabe die Betriebskostenabrechnung.
  const scope = snapshot.scope?.kind ?? 'all'
  const objectRules = snapshot.objectRules ?? CALENDAR_RULES
  const plants = snapshot.heatingPlants ?? []
  // **Nutzungswechsel (#259).** Je Einheit die Abschnitte gleicher Nutzung im Zeitraum (shared/unitUsage.ts,
  // die eine Stelle für „Nutzung am Tag t“) und die Tage je Nutzung. `phased`: Die Nutzung wechselt im
  // Zeitraum. Für jede andere Einheit gilt eine Nutzung über den ganzen Zeitraum, und jede Formel unten ergibt
  // für sie wörtlich dieselben Zahlen wie vor #259 (Faktor genau 1 oder 0). Entwurf:
  // docs/superpowers/specs/2026-10-23-nutzungswechsel-design.md
  type UnitPeriodUsage = { spans: UsageSpan[], phased: boolean, rented: number, self: number, outside: number }
  const usageById = new Map(snapshot.units.map((u): [string, UnitPeriodUsage] => {
    const spans = usageSpans(u, yFrom, yTo)
    const days = (k: UnitUsage) => spans.filter((x) => x.usage === k).reduce((a, x) => a + x.days, 0)
    return [u.id, { spans, phased: spans.length > 1, rented: days('vermietet'), self: days('eigen'), outside: days('ausgenommen') }]
  }))
  const usageIn = (u: { id: string }): UnitPeriodUsage => usageById.get(u.id) ?? { spans: [], phased: false, rented: 0, self: 0, outside: 0 }
  // Die Einheiten mit den Kennzeichen dieses Zeitraums, für alle Ja/Nein-Fragen (§ 2 HeizkostenV, Garage, Wohnung):
  // Gilt im ganzen Zeitraum die Angabe an der Einheit, dasselbe Objekt. Bei einem Wechsel im Zeitraum heißt
  // `participates` „an einem Tag vermietet“ und `selfUsed` „an einem Tag selbstgenutzt“; selbst bewohnt im Sinne
  // von `selfUsed && !participates` ist sie dann nur, wenn sie an keinem Tag vermietet ist (die vorsichtige
  // Lesart, Entwurf 2). Ohne Wechselliste, damit niemand aus der Ansicht eine Staffel rechnet.
  const periodUnits: SnapshotUnit[] = snapshot.units.map((u) => {
    const x = usageIn(u)
    if (!x.phased) return x.spans[0]?.usage === baseUsage(u) ? u : { ...u, ...usageFlags(x.spans[0]?.usage ?? baseUsage(u)), usageChanges: [] }
    return { ...u, participates: x.rented > 0, selfUsed: x.self > 0, usageChanges: [] }
  })
  // Anteil der Tage, an denen die Einheit zur Abrechnungseinheit gehört bzw. selbstgenutzt ist; ohne Wechsel
  // genau 1 oder 0, damit keine Gleitkommazahl wandert.
  const inShare = (u: { id: string }): number => {
    const x = usageIn(u)
    return x.phased ? (x.rented + x.self) / diy : (x.rented + x.self > 0 ? 1 : 0)
  }
  const selfShare = (u: { id: string }): number => {
    const x = usageIn(u)
    return x.phased ? x.self / diy : (x.self > 0 ? 1 : 0)
  }
  const outsideShare = (u: { id: string }): number => {
    const x = usageIn(u)
    return x.phased ? x.outside / diy : (x.outside > 0 ? 1 : 0)
  }
  // „Selbst bewohnt“ im Sinne von § 2 HeizkostenV und § 5d Abs. 3 CO2KostAufG (Durchsicht S4): nur eine Einheit,
  // die an jedem Tag des Zeitraums selbstgenutzt ist. Eine mit Wechsel im Zeitraum zählt nicht, auch wenn sie an
  // keinem Tag vermietet ist; die Ausnahmen greifen nur, wenn ihre Voraussetzung den ganzen Zeitraum besteht.
  const dwellerUnits: SnapshotUnit[] = periodUnits.map((u) => (usageIn(u).phased && u.selfUsed ? { ...u, selfUsed: false } : u))
  // Die Tage, an denen alle diese Einheiten selbstgenutzt sind (Schnitt ihrer Abschnitte der Eigennutzung).
  const daysAllSelf = (us: readonly SnapshotUnit[]): number => {
    let common: Period[] = [{ from: yFrom, to: yTo }]
    for (const u of us) {
      const own = usageIn(u).spans.filter((x) => x.usage === 'eigen')
      common = common.flatMap((c) => own.flatMap((x) => {
        const f = c.from > x.from ? c.from : x.from
        const t = c.to < x.to ? c.to : x.to
        return f <= t ? [{ from: f, to: t }] : []
      }))
    }
    return common.reduce((a, c) => a + rangeOverlapDays(c.from, c.to, c.from, c.to), 0)
  }
  // Ganz selbstgenutzt im Zeitraum: Nur dann wird der Rest des Hauptzählers Eigenanteil (#116).
  const wholeSelf = (u: { id: string }): boolean => usageIn(u).self >= diy
  const unitById = new Map(periodUnits.map((u) => [u.id, u]))
  // Selbstgenutzte Wohnungen (`selfUsed`) haben kein Mietverhältnis, bilden aber die
  // Verteilbasis mit: Kosten einer Rechnung über das ganze Haus dürfen nur anteilig auf die
  // Mieter umgelegt werden, der auf die selbstgenutzte Wohnung entfallende Teil bleibt beim
  // Vermieter (Eigenanteil) — wie bei Leerstand. Wohnungen ohne beide Kennzeichen gehören
  // nicht zur Abrechnungseinheit und bleiben ganz außen vor.
  // `participates` hat Vorrang: eine vermietete Wohnung ist nie Eigennutzung, auch wenn ein
  // von Hand bearbeiteter Datenbestand beide Kennzeichen trägt (siehe usageOf in types.ts).
  // Mit Nutzungswechsel (#259): selbstgenutzt an mindestens einem Tag bzw. an einem Tag in der Abrechnungseinheit,
  // gewichtet mit dem Anteil dieser Tage.
  const selfUnits = periodUnits.filter((u) => usageIn(u).self > 0)
  const basisUnits = periodUnits.filter((u) => usageIn(u).rented + usageIn(u).self > 0)
  const basisArea = basisUnits.reduce((a, u) => a + (u.areaM2 || 0) * inShare(u), 0)
  const selfArea = selfUnits.reduce((a, u) => a + (u.areaM2 || 0) * selfShare(u), 0)
  // Die Tage der Eigennutzung einer Einheit aus `selfUnits`; ohne Wechsel der ganze Zeitraum.
  const selfDaysOf = (u: { id: string }): number => (usageIn(u).phased ? usageIn(u).self : diy)
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
  // **Für die Kosten zählt ein Mietverhältnis nur in der vermieteten Zeit seiner Wohnung (#259).** Das ist die
  // bisherige Regel, verallgemeinert: Ein Mietverhältnis in einer selbstgenutzten oder ausgenommenen Wohnung
  // bekam nie einen Kostenanteil. Bei einem Wechsel im Zeitraum wird es auf seinen ersten vermieteten Abschnitt
  // beschnitten (`costTenancies`); die übrigen Tage bleiben beim Vermieter, nie bei anderen Mietern, und
  // `usage.tenancy-conflict` nennt sie. Abrechnung und Vorauszahlungen bleiben am ganzen Mietverhältnis
  // (`partTenancies`), denn gezahlt hat der Mieter. Ohne Wechsel ist beides dasselbe Objekt.
  // `days`: Tage in einer Zeit ohne Vermietung; `later`: Tage in einem späteren vermieteten Abschnitt, den das
  // Mietverhältnis über einen Wechsel hinweg erreicht (Durchsicht, Befund 2).
  const usageConflicts: { t: TenancyWithUnit, days: number, later: number }[] = []
  const costTenancies: TenancyWithUnit[] = tenancies.flatMap((t) => {
    const x = usageIn(t.unit)
    if (!x.phased) return t.unit.participates ? [t] : []
    const from = t.start > yFrom ? t.start : yFrom
    const to = t.end !== null && t.end < yTo ? t.end : yTo
    const pieces = x.spans.filter((sp) => sp.usage === 'vermietet' && sp.from <= to && sp.to >= from)
      .map((sp) => ({ from: sp.from > from ? sp.from : from, to: sp.to < to ? sp.to : to }))
    const first = pieces[0]
    const days = first ? rangeOverlapDays(first.from, first.to, yFrom, yTo) : 0
    const rentedDays = pieces.reduce((a, p) => a + rangeOverlapDays(p.from, p.to, yFrom, yTo), 0)
    if (t.days > days) usageConflicts.push({ t, days: t.days - rentedDays, later: rentedDays - days })
    if (!first) return []
    return [{ ...t, start: first.from > from ? first.from : t.start, end: first.to < to ? first.to : t.end, days }]
  })
  const costIds = new Set(costTenancies.map((t) => t.id))
  const partTenancies = tenancies.filter((t) => costIds.has(t.id))
  // Garage-artig (#135): keine Fläche, und im Jahr ausdrücklich mit 0 Personen genutzt, also
  // mindestens ein Mietverhältnis und keines mit Personen (bei Eigennutzung ausdrücklich 0 eigene
  // Personen). Dann ist eine 0 eine Angabe (Garage, Stellplatz, Lager) und keine vergessene Zahl;
  // siehe die Hinweise zur Verteilbasis unten. **Leerstand zählt nicht dazu**: Ohne Mietverhältnis
  // lässt sich eine Garage von einer Wohnung mit vergessener Fläche nicht unterscheiden, und im
  // zweiten Fall wanderte der Anteil des Leerstands still zu den Mietern. Eine leere Garage warnt
  // dann eben; das ist der billigere Irrtum.
  const isGarageLike = (u: SnapshotUnit): boolean => {
    if (u.areaM2 > 0) return false
    // Mit Wechsel im Zeitraum (#259): eigene Personen ausdrücklich 0 und die vermietete Zeit ohne Personen.
    if (usageIn(u).phased) {
      const mine = costTenancies.filter((t) => t.unitId === u.id)
      if (usageIn(u).self > 0 && u.selfPersons !== 0) return false
      return (usageIn(u).self > 0 || mine.length > 0) && mine.every((t) => !(personDaysInPeriod(t, yFrom, yTo) > 0))
    }
    if (u.selfUsed) return u.selfPersons === 0
    const own = tenancies.filter((t) => t.unitId === u.id)
    return own.length > 0 && own.every((t) => !(personDaysInPeriod(t, yFrom, yTo) > 0))
  }
  // Personentage der selbstgenutzten Wohnungen: in der Zeit der Eigennutzung (#259, ohne Wechsel der ganze
  // Zeitraum) mit der hinterlegten Personenzahl
  const selfPersonDays = selfUnits.reduce((a, u) => a + selfPersonsOf(u) * selfDaysOf(u), 0)
  // Wohnung ist, was Fläche hat oder im Jahr bewohnt ist; eine Einheit ohne Fläche und ohne
  // Bewohner (Garage, Stellplatz) ist keine. Eine Regel für zwei Fragen: ob das Gebäude unter § 2
  // HeizkostenV fällt (unten) und ob eine leere Einheit beim Personenschlüssel Leerstand ist (#177).
  const inhabited = (u: SnapshotUnit) => usageIn(u).phased
    ? (usageIn(u).self > 0 && selfPersonsOf(u) > 0) || costTenancies.some((t) => t.unitId === u.id && personDaysInPeriod(t, yFrom, yTo) > 0)
    : u.selfUsed && !u.participates
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
    // Leerstand sind die vermieteten Tage ohne Mietverhältnis; Zeiten der Eigennutzung oder außerhalb nicht (#259).
    const days = usageIn(u).phased
      ? usageIn(u).rented - occupiedDays(costTenancies.filter((t) => t.unitId === u.id), yFrom, yTo)
      : diy - occupiedDays(tenancies.filter((t) => t.unitId === u.id), yFrom, yTo)
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
    costTenancies.reduce((a, t) => a + personDaysInPeriod(t, yFrom, yTo), 0) + selfPersonDays
  const basisPersonDays = occupantPersonDays + vacancyPersonDays

  // Verbrauch je Zählertyp vorbereiten (nur Wohnungszähler bilden die Verteilbasis)
  // Alle Ablesungen, nicht nur die des Jahres: Der Anfangsstand steht im Vorjahr (siehe
  // snapshot.ts). `consumptionInPeriod` schneidet den Zeitraum tagesanteilig heraus.
  const allMeters = snapshot.meters
  const allReadings = snapshot.readings
  // Bewohnt im Jahr: selbstgenutzt oder mit einem Mietverhältnis. Nur bei ihnen fehlt ein
  // Zähler wirklich; eine leere Wohnung oder eine unvermietete Garage verbraucht nichts (#116).
  const occupied = new Set([...periodUnits.filter((u) => u.selfUsed).map((u) => u.id), ...tenancies.map((t) => t.unitId)])
  const readingsOf = (meterId: string) => allReadings.filter((r) => r.meterId === meterId)
  // Wie viele Tage des Jahres ein Zähler der Einheit abdecken muss: das ganze Jahr bei einer
  // selbstgenutzten, sonst die Tage ihrer Mietverhältnisse.
  // Mit Wechsel im Zeitraum (#259): die Tage der Eigennutzung und der vermieteten Mietverhältnisse.
  const neededDays = (u: SnapshotUnit) => usageIn(u).phased
    ? Math.min(diy, usageIn(u).self + costTenancies.filter((t) => t.unitId === u.id).reduce((a, t) => a + t.days, 0))
    : u.selfUsed ? diy : Math.min(diy, tenancies.filter((t) => t.unitId === u.id).reduce((a, t) => a + t.days, 0))
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
      const mainOfType = mainMeters.filter((m) => m.type === type)
      // **Eine gemeinsame Einheit (#342).** Haben alle Zähler samt Hauptzähler dieselbe, bleibt es bei ihr und
      // keine Zahl ändert sich; sonst wird in die Grundeinheit der Sparte umgerechnet (MWh in kWh, l in m³), wenn
      // jede Einheit bekannt ist. Gefragt werden nur Zähler, die im Jahr Verbrauch beitragen (Durchsicht M1b).
      const scale = unitScale([...meters, ...mainOfType].filter((m) => coveredDays(readingsOf(m.id), yFrom, yTo) > 0), 'relative')
      const scaleOf = scale.factorOf
      const use = (m: SnapshotMeter, from: string, to: string): number => consumptionInPeriod(readingsOf(m.id), from, to) * scaleOf(m.id)
      // Verbrauch je Wohnung, für den Eigenanteil; beim Kaltwasser samt Warmwasser.
      const usage = new Map<string, number>()
      // Wohnungen mit einem abgelesenen Zähler genau dieses Typs (#116, G-B8).
      const perUnit = new Map<string, number>()
      let basis = 0
      for (const m of meters) {
        const readings = readingsOf(m.id)
        const c = use(m, yFrom, yTo)
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
      // Mit Wechsel im Zeitraum (#259) zählt nur, was die Zähler in den Tagen der Eigennutzung messen, und was sie
      // in den Tagen außerhalb messen, geht wie bei einer ausgenommenen Einheit an den Vermieter.
      const spanUse = (u: SnapshotUnit, k: UnitUsage): number => meters
        .filter((m) => m.unitId === u.id && coveredDays(readingsOf(m.id), yFrom, yTo) > 0)
        .reduce((a, m) => a + usageIn(u).spans.filter((x) => x.usage === k).reduce((b, x) => b + use(m, x.from, x.to), 0), 0)
      let selfConsumption = selfOnes.reduce((a, u) => a + (usageIn(u).phased ? spanUse(u, 'eigen') : usage.get(u.id) || 0), 0)
      const outsidePhased = basisOnes.filter((u) => usageIn(u).phased).reduce((a, u) => a + spanUse(u, 'ausgenommen'), 0)
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
      const main = mainOfType.reduce((a, m) => a + use(m, yFrom, yTo), 0)
      // Nur ein Hauptzähler über das ganze Jahr taugt als Basis. Der Versorger liest selten zum
      // 31.12. ab, und ein Teiljahr gegen ganzjährige Wohnungszähler verschöbe die Anteile.
      const mainShort = mainOfType
        .map((m) => ({ meterId: m.id, days: coveredDays(readingsOf(m.id), yFrom, yTo) }))
        .find((c) => c.days < diy) ?? null
      let mainBasis: number | null = null
      let mainPartial: ConsumptionByTypeEntry['mainPartial'] = null
      let mainBelowUnits: ConsumptionByTypeEntry['mainBelowUnits'] = null
      let mainGap: ConsumptionByTypeEntry['mainGap'] = null
      let mainSelfByDays = false
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
          if (unmetered.every((u) => selfIds.has(u.id) && wholeSelf(u)) && partial.length === 0) selfConsumption += main - basis
          // Durchsicht S2 und Nachprüfung S-b (#259): Mit Nutzungswechsel gilt der Rest je Tag: Sind an dem Tag alle
          // Einheiten ohne Zähler selbstgenutzt, ist sein Anteil Eigenanteil, sonst bleibt er beim Vermieter (eine Einheit
          // außerhalb ist dabei nie selbstgenutzt, ihr Verbrauch gehört nicht in den Eigenanteil, #116). Nach Tagen
          // geteilt, also unter der Annahme gleichmäßigen Verbrauchs; das ist eine Auslegung.
          else if (partial.length === 0 && unmetered.every((u) => selfIds.has(u.id))) {
            const allSelf = daysAllSelf(unmetered)
            if (allSelf > 0) {
              mainSelfByDays = true
              selfConsumption += (main - basis) * (allSelf / diy)
            }
          }
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
        meters, basis, perUnit, selfConsumption, outsidePhased, mainSelfByDays, unmetered, limited: only !== null,
        hasMain: mainOfType.length > 0, main: mainBasis, mainPartial, mainBelowUnits, mainGap, partial,
        scaleOf, unitProblem: scale.problem, unit: scale.problem ? '' : scale.unit,
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
  const heatingScopePrepayment = (t: TenancyWithUnit): { cents: number, overridden: boolean, heatingCents: number, note?: string, partial?: PartialMonth[] } => {
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
    return { cents: r.cents, overridden: r.overridden, heatingCents: r.cents, ...(note ? { note } : {}), ...(r.partial ? { partial: r.partial } : {}) }
  }
  // Die Vorauszahlungen eines Mietverhältnisses (#208, Heizung PR 5): in einer Teilabrechnung nach
  // Weg b keine (die rechnet P an); sonst die übrigen und die Heizstaffel der Monate, die keiner
  // getrennt abgerechneten Heizperiode gehören (6.1 Nr. 5). Welche Anlage die Wohnung versorgt, sagt
  // `servesUnit`; ohne Anlage zählt die ganze Heizstaffel.
  const prepaymentOf = (t: TenancyWithUnit): { cents: number, overridden: boolean, heatingCents?: number, note?: string, partial?: PartialMonth[] } => {
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
      if (monthShare(t, m).days === 0) continue
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
  // Angebrochene Monate je Mietverhältnis (#311): der Hinweis an den Vermieter entsteht erst, wenn
  // feststeht, welche Abrechnungen bleiben (unten, nach „Ohne Abrechnung“).
  const partialMonths = new Map<string, { t: TenancyWithUnit, partial: PartialMonth[] }>()
  for (const t of partTenancies) {
    const from = new Date(Math.max(toUTC(t.start), toUTC(yFrom)))
    const to = t.end ? new Date(Math.min(toUTC(t.end), toUTC(yTo))) : new Date(toUTC(yTo))
    const prepayment = prepaymentOf(t)
    const partial = prepayment.overridden ? [] : (prepayment.partial ?? []).filter((x) => x.fullCents > 0)
    if (partial.length > 0) partialMonths.set(t.id, { t, partial })
    // Für den Mieter ein Satz, damit er den Ansatz an seinen Unterlagen prüfen kann (VIII ZR 240/10, Rn. 16).
    const partialNote = partial.length > 0 ? partialMonthNote(partial, scope === 'heating') : ''
    const pp = { ...prepayment, note: [prepayment.note, partialNote].filter((x) => x).join(' ') }
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
    item: SnapshotCostItem, b: { basisPersonDays: number, consumptionByType: Record<string, ConsumptionByTypeEntry | undefined> }, targets: Target[], booked: boolean[], o: OverlapPeriod,
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
        // In der gemeinsamen Einheit (#342): Küche in Litern, Bad in m³.
        const scaleOf = b.consumptionByType[item.meterType as MeterType]?.scaleOf ?? (() => 1)
        const all = meters.reduce((a, m) => a + consumptionInPeriod(readingsOf(m.id), pFrom, pTo) * scaleOf(m.id), 0)
        const part = meters.reduce((a, m) => a + consumptionInPeriod(readingsOf(m.id), from, to) * scaleOf(m.id), 0)
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
  // `ctx` seit Heizung PR 18: Die Teilung nach § 5a misst den Anfall einer Rechnung mit denselben Stufen 1–5.
  const fuelResults = new Map<string, { plant: SnapshotHeatingPlant; result: FuelResult; ctx: ShareContext }>()
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
      const ctx: ShareContext = {
        table: law(hkvDegreeDays, { period: lawPeriod }, lawLog),
        local: new Map(fuel.degreeDays.map((v) => [v.month, v.value])),
        readings: supplyMeter ? snapshot.readings.filter((r) => r.meterId === supplyMeter.id) : null,
      }
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
        closedCancelled: fuel.closed.filter((c) => c.plantId === plant.id).flatMap((c) => (c.cancelled ?? []).map((deliveryId) => ({ period: c.period, deliveryId }))),
        ctx,
        // Heizpositionen der Anlage ohne Lieferung decken mit ihrem Leistungszeitraum ab (Durchsicht I4).
        loose: items
          .filter((c) => c.category === HEATING_CATEGORY && !c.fuelDeliveryId && c.amountCents !== 0 && (c.heatingPlantId === plant.id || !c.heatingPlantId))
          // Ohne Anlage gehört sie zur einzigen des Objekts; bei mehreren ist unklar, zu welcher, und
          // Mietfuchs schlägt keine Schätzung vor (Nachprüfung, M-a).
          .map((c) => (c.heatingPlantId || plants.length === 1 ? { from: c.serviceFrom ?? null, to: c.serviceTo ?? null } : { from: null, to: null })),
      })
      if (!result) continue
      fuelResults.set(plant.id, { plant, result, ctx })
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
        // Ohne Betrag und ohne Teil beim Vermieter keine Gegenzeile (Storno eines Teils, der schon beim Vermieter lag).
        if (carry.cents !== 0 || carry.landlord.some((p) => p.cents !== 0)) fuelCounterRows.push({
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
    const found = plantStockOf(snapshot, plant, String(period.key), stockCountedAt)
    if (!found) continue
    stockOfPlant.set(plant.id, { plant, ...found })
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
    const q = (n: number): string => `${fmtQuantity(n)} ${STOCK_UNIT_TEXT[st.unit]}`
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
      const norm = mayAgreeOtherwise(dwellerUnits, isDwelling) ? '§ 2 Nr. 4a BetrKV' : '§ 7 Abs. 2 HeizkostenV'
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
  // ---------- Angaben je Heizperiode: Ausnahme nach § 11, Vereinbarung nach § 2 (Heizung PR 14) ----------
  // Wohnung im Sinne des § 2 ist, was Fläche hat oder bewohnt ist (Erläuterung bei `heatingCuts` unten).
  const heatingAgreeable = mayAgreeOtherwise(dwellerUnits, isDwelling)
  // Die Angaben stehen je Heizperiode und gelten ab ihr für die Linie (server/src/heatingInfo.ts). Zwei Fälle mit
  // verschiedenen Folgen:
  // - Ausnahme nach § 11: Die §§ 3 bis 7 gelten nicht, soweit sie die Wärme betreffen (Abs. 1); für das
  //   Warmwasser „entsprechend“ (Abs. 2). `exemptionScope` sagt, ob nur die Wärme oder beides ausgenommen ist.
  //   Für den ausgenommenen Topf nennt Mietfuchs keine Kürzung nach § 12; sind beide ausgenommen, gibt es auch
  //   keine Angaben nach § 6a und keine CO₂-Aufteilung, außer eine Abrechnung ist vereinbart (§ 2 Abs. 7
  //   CO2KostAufG).
  // - Vereinbarung nach § 2: Sie regelt den Verteilungsmaßstab. Es entfällt die Kürzung nach § 12 Abs. 1 Satz 1,
  //   nicht die nach Satz 2 (fernablesbare Ausstattung) und Satz 3 (Informationen nach § 6a). Wirksam nur,
  //   solange das Haus im Zeitraum die Voraussetzung des § 2 erfüllt; sonst gilt die Verordnung.
  // Für eine Etagenheizung gilt die Verordnung ohnehin nicht (§ 1 Abs. 1); dort gibt es keine dieser Angaben.
  const ruleRows: RuleRow[] = (snapshot.heatingPeriodRows ?? []).map((r) => ({ ...r, period: String(r.period) }))
  const rulePlants = snapshot.heatingPlants ?? []
  const rulesCache = new Map<string, HeatingRules>()
  const periodRulesFor = (plantId: string, key: string): HeatingRules => {
    const k = `${plantId}@${key}`
    const hit = rulesCache.get(k)
    if (hit) return hit
    const r = heatingRulesOf(ruleRows, rulePlants, plantId, key)
    rulesCache.set(k, r)
    return r
  }
  const centralPlant = (plantId: string | null | undefined): SnapshotHeatingPlant | undefined => {
    const p = plantId ? rulePlants.find((x) => x.id === plantId) : undefined
    return p && (p.supply ?? 'central') === 'central' ? p : undefined
  }
  // Bereitet die Anlage in der Heizperiode kein Warmwasser, betrifft eine Ausnahme der Wärme die ganze Anlage
  // (`exemptionScopeFor` in co2Exemption.ts, dieselbe Regel wie für das Blatt).
  const exemptionScopeOf = (plantId: string | null | undefined, key: string): ExemptionScope | null =>
    plantId ? exemptionScopeFor(centralPlant(plantId), periodRulesFor(plantId, key), key) : null
  const exemptPot = (plantId: string, pot: SelfPot, key: string): boolean => {
    const s = exemptionScopeOf(plantId, key)
    return s === 'both' || (s === 'heat' && pot === 'heating')
  }
  const agreedFor = (plantId: string | null | undefined, key: string): AgreedOtherwise | null => {
    if (!heatingAgreeable || !centralPlant(plantId) || !plantId) return null
    const a = periodRulesFor(plantId, key).agreedOtherwise
    return a === 'none' ? null : a
  }
  // Keine Kürzung nach § 12 Abs. 1 Satz 1 für Kosten mit diesem Ziel: Vereinbarung nach § 2, oder jeder Topf,
  // den das Ziel trifft, ist nach § 11 ausgenommen. Ohne Ziel trifft eine Position beide Töpfe.
  const noCutFor = (plantId: string | null | undefined, target: HeatingTarget | null | undefined, key: string): boolean => {
    if (!plantId) return false
    if (agreedFor(plantId, key) !== null) return true
    const s = exemptionScopeOf(plantId, key)
    return s === 'both' || (s === 'heat' && target === 'heating')
  }
  // § 2 Abs. 7 CO2KostAufG: in den Fällen des § 11 keine CO₂-Aufteilung, außer eine Abrechnung der Heiz- und
  // Warmwasserkosten ist vereinbart. Ist nur die Wärme ausgenommen, teilt Mietfuchs weiter auf, denn das
  // Warmwasser bleibt unter der Verordnung und das Gesetz unterscheidet den Fall nicht (Auslegung zur sicheren
  // Seite: Ohne Aufteilung dürften die Mieter sonst kürzen).
  // Die Regel steht in co2Exemption.ts, damit das Blatt für den Messdienst dieselbe fragt (#246).
  const co2OffByExemption = (plantId: string, key: string): boolean => co2OffByExemptionOf(centralPlant(plantId), periodRulesFor(plantId, key), key)
  // ---------- Eigene Heizkostenabrechnung (Heizung PR 10, Entwurf 6.1 Nr. 4.3, 8) ----------
  // Je Anlage mit `method = 'self'`, deren Heizperiode der Zeitraum dieser Berechnung ist (dieselben
  // Anlagen wie bei den Lieferungen, `fuelPlants`), der Plan: Nutzer, Ablesungen, Gruppen und Bruchteile
  // (heating.ts), Anteil nach Verbrauch, Warmwasseranteil und das Urteil zur Wärmepumpe. Daraus die
  // Gewichte, mit denen jede Position mit `heatingSystem` und jeder Übertrag der Anlage verteilt wird.
  // Was die Anlage nicht verteilbar macht, steht in `blocked`; dann gehen ihre Positionen an den
  // Vermieter (`noBasis`), und je Grund nennt ein Fehler, was zu tun ist (Abweichung 5).
  type SelfBlock = {
    code: 'heating.self-incomplete' | 'heating.dhw-share-invalid' | 'heating.heat-pump-dhw-basis' | 'fuel.stock-missing-self' | 'fuel.stock-invalid'
      | 'heating.mixed-capture' | 'heating.hca-factor-missing' | 'meter.units-mixed'
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
    // Vereinbarung nach § 2 „nach Wohnfläche“: verteilt wird ganz nach den Grundkosten (Durchsicht von #243, G-W3).
    agreedArea: boolean
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
    // Schätzung nach § 9a (Heizung PR 13): die Schätzungen der Linie in dieser Heizperiode und die
    // Vorperiode für den Vorschlag „vergleichbare Zeiträume“ (neu gerechnet, ohne ihre Schätzungen; null,
    // wenn sie anders erfasst wurde).
    estimates: HeatingEstimate[]
    staleEstimates: HeatingEstimate[]
    prev: SelfPlan | null
    prevSameLength: boolean
    // Die Heizperiode davor (Heizung PR 14): ob ein Mieter dort schon wohnte und wo ihr Klimafaktor steht.
    prevPeriod: { key: string; from: string; to: string }
    // Die Einheit des Ausweises je Topf, wenn alle Zähler einheitlich in einer anderen bekannten als der Grundeinheit
    // stehen (alle MWh, alle Liter; Durchsicht von #342, E2). Fehlt: die der Erfassung.
    potUnits: Partial<Record<SelfPot, string>>
    // #314: die Gewichte der anderen Teilung beim Wechsel (§ 9b Abs. 2) und die Wohnungen mit Leerstand, Eigennutzung
    // oder Wechsel ohne Zwischenablesung, deren Rechenweg den Vergleichswert nennt. Nur zum Vergleich.
    compare: { weights: Map<string, SelfWeights>; units: ReadonlySet<string> } | null
  }
  const POT_NAME: Record<SelfPot, string> = { heating: 'Heizung', water: 'Warmwasser' }
  // Die Einheit des Verbrauchs eines Topfs (Heizung PR 12, Abweichung 9): Heizkostenverteiler und Ablesedienst
  // zählen Einheiten, keine Kilowattstunden.
  const potUnitOf = (sp: Pick<SelfPlantPlan, 'capture' | 'serviceValues'>, p: SelfPot): 'kWh' | 'm³' | 'Einheiten' => potUnitFor(sp.capture, p, sp.serviceValues)
  // Die Einheit, in der der Verbrauch eines Topfs dasteht (Durchsicht von #342, E2): bei einheitlich MWh oder Litern diese.
  const potShownUnit = (sp: Pick<SelfPlantPlan, 'capture' | 'serviceValues' | 'potUnits'>, p: SelfPot): string => sp.potUnits[p] ?? potUnitOf(sp, p)
  // #322: In welcher Einheit die Grundkosten eines Topfs verteilt werden: beim Topf Heizung nach umbautem Raum m³,
  // sonst m² (beim Warmwasser immer, § 8 Abs. 1 HeizkostenV).
  const basisUnitOf = (sp: Pick<SelfPlantPlan, 'input'>, p: SelfPot): 'm²' | 'm³' => (p === 'heating' && sp.input.areaBasisHeat === 'volume' ? 'm³' : 'm²')
  const selfProblemText = (p: SelfProblem, areaBasisHeat: string, capture: CaptureMethod = 'heatMeter'): string => {
    if (p.kind === 'farInterim') {
      return `Beim Wechsel in ${p.unitName} zum ${fmtDay(p.boundary)} wurde erst am ${fmtDay(p.readingDate)} abgelesen, ${p.days} Tage daneben und über einen Wintermonat. Lässt die Ablesung wegen des Zeitpunkts keine hinreichend genaue Ermittlung zu, wird nach Gradtagen bzw. Tagen geteilt (§ 9b Abs. 3 HeizkostenV). Ob das so ist, entscheiden Sie: Wählen Sie auf der Seite Heizkosten „Ablesung verwenden“ oder „Nach § 9b Abs. 3“.`
    }
    if (p.kind === 'noBasisValue') {
      return p.basis === 'volume'
        ? `Die Grundkosten der Heizung werden nach dem umbauten Raum verteilt (§ 7 Abs. 1 Satz 5 HeizkostenV). An ${andList(p.unitNames)} fehlt der umbaute Raum in m³, und die Kosten dieser Heizanlage lassen sich nicht verteilen. Tragen Sie ihn auf der Seite Heizkosten unter „Heizanlage ändern“ ein.`
        : `Die Grundkosten der Heizung werden nach der beheizten Fläche verteilt (§ 7 Abs. 1 Satz 5 HeizkostenV). An ${andList(p.unitNames)} fehlt die beheizte Fläche in m², und die Kosten dieser Heizanlage lassen sich nicht verteilen. Tragen Sie sie auf der Seite Heizkosten unter „Heizanlage ändern“ ein.`
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
      // #322: mit Liste an deren Eintrag, ohne Liste aus `basisValues` (Durchsicht M1).
      heatedAreaM2: unitBasisOf(plant, u.id)?.heatedAreaM2 ?? null,
      volumeM3: unitBasisOf(plant, u.id)?.volumeM3 ?? null,
      role: u.participates ? 'rented' : u.selfUsed ? 'self' : 'outside',
      // Nutzungswechsel (#259): Die Zeiten ohne Mietverhältnis teilt `usersOf` an den Grenzen der Staffel, ein
      // Wechsel ist also ein Nutzerwechsel nach § 9b HeizkostenV. Über die Heizperiode und ihre Nachbarn, denn
      // `usersOf` fragt auch die Wechselgrenzen davor und danach.
      ...(u.usageChanges && u.usageChanges.length > 0 ? { usageSpans: (from: string, to: string) => usageSpans(u, from, to) } : {}),
    }))
    const selfTenancies: SelfTenancy[] = snapshot.tenancies.filter((t) => servedIds.has(t.unitId)).map((t) => ({ id: t.id, unitId: t.unitId, tenantName: t.tenantName, start: t.start, end: t.end }))
    const changesIn = (unit: SelfUnit, hh: { from: string; to: string }): string[] => usersOf(unit, selfTenancies, hh).slice(0, -1).map((u) => u.to)
    const outerChanges = new Map(selfUnits.map((u) => [u.id, [...changesIn(u, prev), ...changesIn(u, next)]]))
    // Die gedachten Zähler eines Ablesedienstes (Heizung PR 12) zählen in jeder Heizperiode von 0 an, denn ihre
    // Zeilen gehören zu genau dieser Heizperiode; ein eingefrorener Endstand der vorigen gilt für sie nicht.
    const opening = new Map((snapshot.selfClosedEnds ?? [])
      .filter((e) => e.plantId === plant.id && e.boundary === dayBefore(period.from) && !isServiceMeter(e.meterId))
      .map((e): [string, SelfReading] => [e.meterId, { meterId: e.meterId, date: e.date, value: e.value }]))
    // Schätzungen nach § 9a (Heizung PR 13): nur angeschlossene Wohnungen, nur Töpfe der Anlage. Wie die Werte
    // eines Ablesedienstes gelten sie für die Linie (nach einem Kesseltausch lesen beide Anlagen dieselben
    // Geräte); steht für dieselbe Wohnung und denselben Topf an mehreren Anlagen eine, gilt die eigene.
    const linePlants = snapshot.heatingPlants ?? []
    const inLine = (id: string): boolean => {
      const other = linePlants.find((p) => p.id === id)
      return id === plant.id || (!!other && lineRoot(other, linePlants) === lineRoot(plant, linePlants))
    }
    const lineEstimates = (snapshot.heatingEstimates ?? [])
      .filter((e) => inLine(e.plantId) && e.period === period.key && servedIds.has(e.unitId) && (hotWater !== 'none' || e.part === 'heat'))
      .sort((a, b) => (a.plantId === plant.id ? 0 : 1) - (b.plantId === plant.id ? 0 : 1))
      .filter((e, i, all) => all.findIndex((x) => x.unitId === e.unitId && x.part === e.part) === i)
    // Durchsicht von #242, G-I1: Nur Schätzungen, die unter der Erfassung und Einheit dieser Heizperiode eingetragen
    // sind, rechnen; die übrigen ergeben einen Fehler, und die Wohnung gilt als nicht erfasst.
    const estimates = lineEstimates.filter((e) => estimateFits(e, capture, serviceRows))
    const staleEstimates = lineEstimates.filter((e) => !estimateFits(e, capture, serviceRows))
    // **Die Einheit je Topf (#342, Durchsicht E2).** Für die Verteilung gilt dieselbe Regel wie beim
    // Verbrauchsschlüssel (`relative`): Einheitlich heißt Faktor 1, auch bei MWh oder Litern, so bleiben gespeicherte
    // Schätzungen und die Vorschläge in ihren Zahlen, und der Ausweis nennt die Einheit der Zähler. Nur gemischt
    // bekannte Einheiten werden in kWh bzw. m³ umgerechnet. Gefragt werden nur Geräte, deren Ablesungen die
    // Heizperiode überdecken (`coversPeriod`, Durchsicht M1b). Heizkostenverteiler zählen Einheiten.
    const potMeters = unitMeters.filter((m) => servedIds.has(m.unitId) && !(svcHeat && m.type === 'waerme') && !(svcWater && m.type === 'warmwasser'))
    const potScales = new Map<MeterType, UnitScale>(potTypes.filter((t) => t !== 'hkv').map((t) => [t, unitScale(potMeters.filter((m) => m.type === t && coversPeriod(m.id, snapshot.readings, period)), 'relative')]))
    const potScaleOf = (m: SnapshotMeter): number => potScales.get(m.type)?.factorOf(m.id) ?? 1
    // Die Einheit des Ausweises: einheitlich in einer bekannten Einheit außer der Grundeinheit (alle MWh) diese.
    const potUnits: Partial<Record<SelfPot, string>> = {}
    for (const [t, sc] of potScales) {
      const pot: SelfPot = t === 'warmwasser' ? 'water' : 'heating'
      if (!sc.converted && sc.problem === null && sc.unit !== '' && knownUnit(t, sc.unit) !== null) potUnits[pot] = sc.unit
    }
    const input: SelfInput = {
      h: { from: period.from, to: period.to },
      neighbors,
      outerChanges,
      opening,
      changeSplit: plant.changeSplit ?? 'degreeDays',
      hotWater,
      // #322: Eine Vereinbarung nach § 2 „nach Wohnfläche“ verteilt nach der Wohnfläche, auch wenn für die eigene
      // Abrechnung der umbaute Raum eingestellt ist. Die beheizte Fläche bleibt dort wie vor #322.
      areaBasisHeat: plant.areaBasisHeat === 'volume' && agreedFor(plant.id, String(period.key)) === 'area' ? 'area' : (plant.areaBasisHeat ?? 'area'),
      units: selfUnits,
      tenancies: selfTenancies,
      meters: [
        ...potMeters.map((m) => ({
          id: m.id, name: m.name ?? m.id, unitId: m.unitId, type: m.type, factor: meterFactor(m),
          // Die Zählernummer nennt eine Grenze ohne Ablesung (Befund M7 aus #341).
          ...(m.meterNumber?.trim() ? { number: m.meterNumber.trim() } : {}),
          // Die Einheit für das Ableseergebnis (UI-Durchsicht H5), in der bekannten Schreibweise (#342).
          ...(m.unit ? { unit: unitLabel(m.type, m.unit) } : {}),
          ...(m.type === 'hkv' ? {} : { scale: potScaleOf(m) }),
        })),
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
      estimates: new Map(estimates.map((e): [string, number] => [estimateKey(e.unitId, POT_OF_PART[e.part]), e.value])),
      estimateThreshold: () => law(hkvEstimateThreshold, { period: lawPeriod }, lawLog),
    }
    const plan = planSelf(input)
    // Die Vorperiode für den Vorschlag „vergleichbare Zeiträume“ (§ 9a Abs. 1, Abweichung 5 des Plans): ihre
    // Ablesungen, ohne Schätzungen, ohne Nachbarwechsel und ohne eingefrorenen Anfangsstand. Nur, wenn sie
    // mit denselben Geräten erfasst wurde (die Werte eines Ablesedienstes gehören je zu einer Heizperiode).
    // Die Rechtswerte fragt sie in einem eigenen Protokoll, damit sie nicht im Rechtsstand dieser Abrechnung
    // stehen.
    const prevLog = createLawLog()
    const prevPlan = capture !== 'serviceValues' && captureOf(plant, String(prev.key)) === capture && hotWaterOf(plant, String(prev.key)) === hotWater
      ? planSelf({
        ...input,
        h: { from: prev.from, to: prev.to },
        neighbors: { before: dayBefore(previousPeriod(rules, prev).from), after: period.to },
        outerChanges: undefined,
        opening: undefined,
        estimates: undefined,
        estimateThreshold: undefined,
        table: law(hkvDegreeDays, { period: { from: prev.from, to: prev.to } }, prevLog),
        offRule: () => law(practiceReadingOffWarning, { period: { from: prev.from, to: prev.to } }, prevLog),
      })
      : null
    const rows = (snapshot.heatingPeriodRows ?? []).filter((r) => r.plantId === plant.id)
    // Der Anteil gehört zur Linie (Durchsicht von #239, I3): Nach einem Kesseltausch gilt der der alten
    // Anlage weiter, ebenso ihr Verfahren für den Warmwasseranteil.
    const allPlants = snapshot.heatingPlants ?? []
    const lineIds = new Set([plant.id, ...allPlants.filter((p) => lineRoot(p, allPlants) === lineRoot(plant, allPlants)).map((p) => p.id)])
    const lineShares = consumptionSharesOf(
      lineShareRows((snapshot.heatingPeriodRows ?? []).map((r) => ({ plantId: r.plantId, period: String(r.period), heatConsumptionPct: r.heatConsumptionPct ?? null, waterConsumptionPct: r.waterConsumptionPct ?? null, insulationRule: r.insulationRule ?? null, above70Agreed: r.above70Agreed ?? null })), allPlants, plant.id),
      period.key, plant.energy, () => law(hkvConsumptionShareForced, { period: lawPeriod }, lawLog),
    )
    // Vereinbarung nach § 2 (Durchsicht von #243, G-W3): „nach Wohnfläche“ verteilt die eigene Abrechnung ganz nach
    // der Fläche, ohne Anteil nach Verbrauch und ohne die Grenzen der §§ 7, 8 und 10; „feste Anteile“ kann sie
    // nicht abbilden (dafür freie Schlüssel); „nach Verbrauch“ rechnet wie eingerichtet.
    const agreedHere = agreedFor(plant.id, String(period.key))
    const agreedArea = agreedHere === 'area'
    const shares: ConsumptionShares | null = agreedArea
      ? { heating: 0, water: 0, forced: false, previous: null, own: true, changed: false, insulation: null, above70Agreed: false }
      : lineShares
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
    // In kWh (#342): ein Zähler in MWh oder GJ wird umgerechnet; ohne gemeinsame Einheit gibt es keinen Wert.
    // E3: Q wird gegen die kWh der Brennstoffrechnung gestellt, also absolut (`base`); gefragt werden nur Zähler, deren
    // Ablesungen die Heizperiode überdecken. Eine unbekannte Einheit rechnet mit Faktor 1 und warnt.
    const plantUnitProblems: NonNullable<UnitScale['problem']>[] = []
    const plantMeterKwh = (role: 'dhwHeat' | 'totalHeat'): number | null => {
      const ms = snapshot.meters.filter((m) => m.heatingPlantId !== null && m.heatingPlantId !== undefined && lineIds.has(m.heatingPlantId) && m.heatingRole === role)
      if (ms.length === 0) return null
      const sc = unitScale(ms.filter((m) => coversPeriod(m.id, snapshot.readings, period)), 'base')
      if (sc.problem) plantUnitProblems.push(sc.problem)
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
        sum += v.value * sc.factorOf(m.id)
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
      plant: { energy: plant.energy, heatGeneration: plant.heatGeneration ?? null, ...(plant.fuelEnergy !== undefined ? { fuelEnergy: plant.fuelEnergy } : {}) },
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
    // Durchsicht von #272, M1: § 11 Abs. 1 Nr. 3 Buchst. a a. F. und § 12 Abs. 3 hängen am Wärmeerzeuger, nicht am
    // Betreiber (§ 1 Abs. 1 Nr. 2: Wärmelieferung „auch aus Anlagen nach Nummer 1“); bei Contracting zählt deshalb der
    // Erzeuger des Lieferanten (`generatorEnergy`, Auslegung am Wortlaut, nicht entschieden).
    // Prüfung K2 zu Heizung PR 22: Ausnahme, Antwort und § 12 Abs. 3 kommen aus `heatPumpStatus`, den auch die Karte
    // der monatlichen Verbrauchsinformation fragt.
    const heatPump = heatPumpStatus(plant, lawPeriod, lawLog)
    const renewable = heatPump.renewable
    const oldHeatPumpExemption = heatPump.oldExemption
    const majorityOpen = heatPump.majorityOpen
    // Unter dieser Ausnahme bindet § 9 nicht: Ohne bestimmbares α gehen „Heizung und Warmwasser“ ganz in
    // den Topf Heizung (Festlegung, Abweichung 9), und es gibt keinen Fehler.
    const alpha = alphaResult.ok ? alphaResult.alpha : null
    const verdict = heatPump.verdict
    const blocked: SelfBlock[] = []
    // Heizkostenverteiler und Ablesedienst (Heizung PR 12, Entwurf 8.1): gemischte Geräte (§ 5 Abs. 7).
    const unitNameOf = (id: string) => snapshot.units.find((u) => u.id === id)?.name ?? id
    const hPeriod = { from: period.from, to: period.to }
    // Heizung PR 13: Wechselt das Gerät einer Wohnung mitten in der Heizperiode und ist ihr Verbrauch der Heizung
    // nach § 9a geschätzt (in der Einheit der eingestellten Erfassung), deckt die Schätzung die Zeit mit dem
    // anderen Gerät; die Wohnung ist dann nicht mehr gemischt. Eine Wohnung, die dauerhaft anders erfasst wird,
    // bleibt ein Fall des § 5 Abs. 7.
    const heatEstimated = new Set(estimates.filter((e) => e.part === 'heat').map((e) => e.unitId))
    const mixedRaw = capture === 'serviceValues' ? serviceUnitsMixed(serviceRows) : mixedCapture(capture, [...servedIds], snapshot.meters, snapshot.readings, hPeriod)
    const mixed = mixedRaw && capture !== 'serviceValues' ? withoutEstimatedSwitches(mixedRaw, capture, heatEstimated) : mixedRaw
    // N1: Fehlt einem Gerät einer Wohnung mit Gerätewechsel ein Stand, nennt die Meldung das andere Gerät mit.
    const switchedNote = (p: SelfProblem): string => {
      if (p.kind !== 'missing' || p.pot !== 'heating' || !(mixed?.switched ?? []).includes(p.unitId)) return ''
      const otherType = capture === 'hca' ? 'waerme' : 'hkv'
      const names = snapshot.meters.filter((m) => m.unitId === p.unitId && m.type === otherType && (m.heatingPlantId ?? null) === null).map((m) => `„${m.name || 'ohne Namen'}“`)
      return ` An ${p.unitName} hängt in dieser Heizperiode außerdem ${names.length > 1 ? 'die' : 'der'} ${otherType === 'hkv' ? 'Heizkostenverteiler' : 'Wärmezähler'} ${andList(names)}: Das Gerät wurde gewechselt (siehe den Hinweis zu den Geräten).`
    }
    // § 9a (Heizung PR 13): Kann der Verbrauch nicht ordnungsgemäß erfasst werden, wird geschätzt; nicht bei einer Wohnung ohne
    // Gerät (Ausstattungspflicht, Abweichung 4 des Plans) und nicht bei zwei Ständen am selben Tag (welcher
    // stimmt, weiß nur der Vermieter). Beim Ablesedienst kennt Mietfuchs keine Geräte; fehlen dort die Werte
    // einer Wohnung, nennt die Meldung die Schätzung ebenfalls.
    const estimable = (p: SelfProblem): boolean => p.kind === 'missing' && (p.reason === 'noReading' || p.reason === 'replacement' || p.reason === 'negative' || (p.reason === 'noMeter' && capture === 'serviceValues'))
    // Nach einer Vereinbarung „nach Wohnfläche“ braucht die Verteilung weder Ablesungen noch den Warmwasseranteil; fehlen
    // sie, sperrt das die Anlage nicht (Durchsicht von #243, Runde 2, G2-N-K1).
    for (const p of plan.problems) {
      if (agreedArea && p.kind !== 'noArea') continue
      blocked.push({
        code: 'heating.self-incomplete',
        text: `${selfProblemText(p, plant.areaBasisHeat ?? 'area', capture)}${estimable(p)
          ? ' Lässt sich der Verbrauch nicht ordnungsgemäß erfassen, weil das Gerät ausgefallen ist oder ein anderer zwingender Grund vorliegt, schätzen Sie den Verbrauch auf der Seite Heizkosten unter „Schätzung (§ 9a)“.'
          : ''}${switchedNote(p)}`,
      })
    }
    if (agreedHere === 'fixedPercent') {
      blocked.push({ code: 'heating.self-incomplete', text: AGREED_FIXED_SELF_TEXT })
    }
    if (shares === null) {
      blocked.push({ code: 'heating.self-incomplete', text: 'Für diese Heizperiode ist kein Anteil nach Verbrauch festgelegt. Tragen Sie auf der Seite Heizkosten ein, mit welchem Anteil Sie bisher abgerechnet haben.' })
    } else {
      const { min, max } = law(hkvConsumptionShare, { period: lawPeriod }, lawLog)
      // § 8 Abs. 1: beim Warmwasser eine eigene Wahl, nie still die der Heizung (Abweichung 14).
      if (hotWater !== 'none' && shares.water === null) {
        blocked.push({ code: 'heating.self-incomplete', text: 'Für das Warmwasser ist kein Anteil nach Verbrauch festgelegt (§ 8 Abs. 1 HeizkostenV); er darf von dem der Heizung abweichen. Tragen Sie ihn auf der Seite Heizkosten ein.' })
      }
      // § 10 (Heizung PR 14): über dem Höchstsatz nur mit Vereinbarung, nie über 100 %.
      if (!agreedArea && [shares.heating, ...(hotWater !== 'none' && shares.water !== null ? [shares.water] : [])].some((v) => v < min || v > 100 || (v > max && !shares.above70Agreed))) {
        blocked.push({ code: 'heating.self-incomplete', text: `Der Anteil nach Verbrauch liegt außerhalb von ${hkvConsumptionShare.describe({ min, max })}. Mehr als ${max} % gehen nur mit einer Vereinbarung (§ 10 HeizkostenV). Korrigieren Sie ihn auf der Seite Heizkosten.` })
      }
    }
    if (!alphaResult.ok && !agreedArea && swapMissing !== null && (alphaResult.problem === 'noDhwHeat' || alphaResult.problem === 'heatPumpBasis')) {
      blocked.push({
        code: 'heating.self-incomplete',
        text: `Die Anlage lief in dieser Heizperiode nur ${swapEnd !== null ? `bis zum ${fmtDay(swapEnd)}` : `ab dem ${fmtDay(startsOn ?? period.from)}`} (Kesseltausch). Für den Warmwasseranteil braucht es die Wärme am Warmwasserspeicher in dieser Zeit, also den Stand des Wärmezählers am Speicher am ${fmtDay(swapMissing)}. Tragen Sie ihn auf der Seite Zähler ein.`,
      })
    } else if (!alphaResult.ok && !oldHeatPumpExemption && !agreedArea) {
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
    // Gemischte Geräte (§ 5 Abs. 7) und fehlende Skala oder Faktor verhindern die Verteilung.
    if (mixed) blocked.push({ code: 'heating.mixed-capture', text: mixedCaptureText(capture, mixed, unitNameOf) })
    const unrated = missingRatings(capture, [...servedIds], snapshot.meters, snapshot.readings, hPeriod)
    if (unrated.length > 0) blocked.push({ code: 'heating.hca-factor-missing', text: missingRatingsText(unrated, unitNameOf) })
    const where = `${plant.name ? `Heizanlage „${plant.name}“` : 'Heizanlage'}, Heizperiode ${label}`
    // #219: Nur die Auskunft nach § 7 Abs. 1 Satz 3 und 4 HeizkostenV; die Bestimmung des Verbrauchs nach der Technik rechnet
    // Mietfuchs nicht. Ob die Leitungen frei liegen und ungedämmt sind, kennt das Modell nicht, deshalb immer bei
    // Heizkostenverteilern und ohne Farbe (client/src/notices.ts, INFORMATIONAL).
    if (capture === 'hca') {
      warn('heating.pipe-heat',
        `${where}: Sind in Ihrem Haus die freiliegenden Leitungen der Wärmeverteilung überwiegend ungedämmt und erfassen die Heizkostenverteiler deswegen einen wesentlichen Anteil des Wärmeverbrauchs nicht, kann der Verbrauch der Nutzer nach anerkannten Regeln der Technik bestimmt werden (§ 7 Abs. 1 Satz 3 HeizkostenV); ein Verfahren beschreibt die Richtlinie VDI 2077 Blatt 3.5. ` +
          'Freiliegend sind nur Leitungen, die sichtbar auf der Wand verlaufen; für Leitungen unter Putz oder im Estrich gilt die Regel nicht (BGH VIII ZR 5/16). ' +
          'Diese Bestimmung rechnet Mietfuchs nicht; verteilt wird nach den erfassten Einheiten. Lassen Sie den Verbrauch von einem Messdienst bestimmen, tragen Sie dessen Werte als „Werte eines Ablesedienstes“ ein; sie gelten dann als erfasster Verbrauch.')
    }
    // #218: § 5 Abs. 7 Satz 2 HeizkostenV. Pflicht (Satz 1) meldet `heating.mixed-capture`; die freie Vorerfassung bei
    // unterschiedlicher Nutzungsart ist erkennbar, wenn das Gebäude überwiegend nicht dem Wohnen dient (Merkmal der
    // CO₂-Aufteilung, § 8 CO2KostAufG) und Mietfuchs die Anlage selbst verteilt. Nur Auskunft.
    if (plant.nonResidential && !mixed) {
      warn('heating.pre-capture',
        `${where}: Sie haben angegeben, dass das Gebäude überwiegend nicht dem Wohnen dient. Nutzen die Einheiten an dieser Anlage die Wärme verschieden, etwa ein Laden neben Wohnungen, kann der Gebäudeeigentümer bei unterschiedlichen Nutzungs- oder Gebäudearten oder aus anderen sachgerechten Gründen eine Vorerfassung nach Nutzergruppen durchführen (§ 5 Abs. 7 Satz 2 HeizkostenV). ` +
          'Vorgeschrieben ist sie, wenn der Verbrauch nicht mit gleichen Ausstattungen erfasst wird (Satz 1). Eine Vorerfassung rechnet Mietfuchs nicht; verteilt wird über alle Einheiten der Anlage zusammen. ' +
          'Soll vorerfasst werden, lassen Sie diese Heizkosten vom Messdienst abrechnen und übernehmen Sie dessen Beträge als Einzelbeträge.')
    }
    // Nicht unter einer Ausnahme nach § 11 für die Wärme oder einer Vereinbarung nach § 2 (Heizung PR 14): Dann
    // schreibt die Verordnung den Anteil nicht vor.
    if (shares !== null && shares.insulation !== 'applies' && shares.insulation !== 'notApplies' && OIL_OR_GAS.includes(plant.energy) && !exemptPot(plant.id, 'heating', String(period.key)) && agreedFor(plant.id, String(period.key)) === null) {
      const forced = law(hkvConsumptionShareForced, { period: lawPeriod }, lawLog)
      if (shares.heating < forced) {
        warn('heating.share-forced-unsure',
          `${where}: Ob Ihr Haus den Wärmeschutz nach dem Stand von 1994 nicht erfüllt und die Leitungen überwiegend gedämmt sind, haben Sie mit „Weiß ich nicht“ beantwortet, und von den Heizkosten gehen ${fmtNum(shares.heating)} % nach Verbrauch. Mit ${forced} % liegen Sie in jedem Fall richtig; trifft § 7 Abs. 1 Satz 2 HeizkostenV zu, sind weniger nicht zulässig. Beantworten Sie die Frage auf der Seite Heizkosten; den Pflichtwert können Sie auch in einer begonnenen Heizperiode eintragen.`,
          { kind: 'heatingCosts', id: plant.id })
      }
    }
    for (const b of blocked) warn(b.code, `${where}: ${b.text} Bis dahin verteilt Mietfuchs die Heizkosten dieser Anlage nicht; sie stehen beim Vermieter.`, { kind: 'heatingCosts', id: plant.id })
    // Einheiten (#342, Durchsicht E1, E2): unbekannte warnen, gerechnet wird mit Faktor 1; bei Umrechnung neben einer
    // Schätzung nach § 9a sagt ein Hinweis, in welcher Einheit ihre Zahl gilt.
    for (const pr of [...[...potScales.values()].flatMap((sc) => (sc.problem ? [sc.problem] : [])), ...plantUnitProblems]) {
      if (pr.kind === 'unknown') warn('meter.unit-unknown', unitUnknownText(where, pr.meters), unitProblemSubject(pr.meters))
    }
    for (const [t, sc] of potScales) {
      if (!sc.converted) continue
      const pot: SelfPot = t === 'warmwasser' ? 'water' : 'heating'
      const affected = estimates.filter((e) => POT_OF_PART[e.part] === pot)
      if (affected.length === 0) continue
      const metersOfType = potMeters.filter((m) => m.type === t && coversPeriod(m.id, snapshot.readings, period)).map((m) => ({ ...m, name: m.name ?? m.id }))
      warn('heating.estimate-base-unit',
        `${where}: Die ${t === 'warmwasser' ? 'Warmwasserzähler' : 'Wärmezähler'} stehen in verschiedenen Einheiten (${metersByUnitText(metersOfType)}); Mietfuchs rechnet sie in ${sc.unit} um. ` +
          `Die Schätzung nach § 9a für ${andList(affected.map((e) => unitNameOf(e.unitId)))} gilt deshalb in ${sc.unit}: ${andList(affected.map((e) => `${fmtNum(e.value)} ${sc.unit}`))}. Haben Sie die Zahl in der Einheit eines Zählers eingetragen (etwa MWh), berichtigen Sie sie auf der Seite Heizkosten unter „Schätzung (§ 9a)“.`,
        { kind: 'heatingCosts', id: plant.id })
    }
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
            `${v.grade ? FUEL_GRADE_LABELS[v.grade] : 'diesen Brennstoff'}: ${fmtPlain(v.kwh)} kWh je ${HEATING_VALUE_UNIT_TEXT[v.per]} (§ 9 Abs. 3 HeizkostenV, hilfsweise). ` +
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
    const weights = blocked.length === 0 && shares !== null && (alphaResult.ok || oldHeatPumpExemption || agreedArea)
      ? weightsOf(plan, { heating: shares.heating, water: shares.water ?? 0 }, alpha?.value ?? null)
      : null
    // #314: Die Gewichte der anderen Teilung nach § 9b Abs. 2 HeizkostenV, nur zum Vergleich in Rechenweg und
    // Hinweis; verteilt wird nie damit. Gerechnet für die Wohnungen, in denen die Teilung beim Wechsel spürbar
    // Geld bewegt (Leerstand, Eigennutzung, Wechsel ohne Zwischenablesung nach § 9b Abs. 3), und bei
    // zeitanteiliger Teilung wie bisher für jeden Wechsel (`heating.change-split-time`). Ein gewöhnlicher
    // Mieterwechsel mit Zwischenablesung bekommt bei Gradtagen nichts.
    const changeSplit = plant.changeSplit ?? 'degreeDays'
    const comparedUnits = new Set(plan.units
      // Eine Schätzung nach § 9a stellt die Nutzer ebenfalls in eine Gruppe (`assign` in heating.ts); das ist kein Wechsel
      // ohne Zwischenablesung (Durchsicht von #417, S1).
      // Integrationsdurchsicht 0.13.0, K1: eine Zeit außerhalb der Abrechnungseinheit (#259) ebenso, denn auch sie ist
      // ein Wechsel der Nutzer ohne Mieter.
      .filter((u) => u.users.length > 1 && u.users.some((x) => x.role === 'vacancy' || x.role === 'self' || x.role === 'outside' || (x.pots.heating.group && !x.pots.heating.estimated)))
      .map((u) => u.unit.id))
    const compare = weights !== null && shares !== null && (comparedUnits.size > 0 || (changeSplit === 'time' && plan.units.some((u) => u.users.length > 1)))
      ? {
        weights: weightsOf(planSelf({ ...input, changeSplit: changeSplit === 'time' ? 'degreeDays' : 'time' }), { heating: shares.heating, water: shares.water ?? 0 }, alpha?.value ?? null),
        units: comparedUnits,
      }
      : null
    selfPlans.set(plant.id, {
      compare,
      potUnits,
      plant, plan, shares, alpha, weights, blocked, verdict, hotWater, input, oldHeatPumpExemption, majorityOpen, agreedArea,
      dhwUnmeasurable: own?.dhwUnmeasurable ?? lineOwn?.dhwUnmeasurable ?? null,
      capture,
      devices: deviceLines(capture, plan, snapshot.meters),
      serviceValues: serviceRows,
      estimates,
      staleEstimates,
      prev: prevPlan,
      prevPeriod: { key: String(prev.key), from: prev.from, to: prev.to },
      // Gleich lang heißt gleich viele Monate (Ruling zu Abweichung 5 des Plans): Heizperioden beginnen am
      // Monatsersten, und ein Schaltjahr macht ein Kalenderjahr nicht unvergleichbar.
      prevSameLength: periodMonths(prev).length === periodMonths(period).length,
      changeSplit: plant.changeSplit ?? 'degreeDays',
      hDays: periodDays(period),
      hDegree: degreeDayPermille([{ from: period.from, to: period.to }], table),
      userByKey: new Map(plan.units.flatMap((u) => u.users.map((x): [string, SelfUserPlan] => [x.key, x]))),
    })
  }
  // Der Rechenweg einer Zeile nach Heizkostenverordnung (#114): Grund- und Verbrauchskosten je Topf,
  // Anteil nach Verbrauch, Warmwasseranteil und der Anteil des Nutzers, aus denselben Zahlen.
  const selfSteps = (sp: SelfPlantPlan, key: string, target: HeatingTarget, amountCents: number): CalcStep[] => {
    const u = sp.userByKey.get(key)
    const unit = u ? sp.plan.units.find((x) => x.unit.id === u.unitId) : undefined
    if (!u || !unit || !sp.shares || !sp.weights) return []
    const pots: SelfPot[] = target === 'both' ? ['heating', 'water'] : [target]
    const steps: CalcStep[] = []
    for (const p of pots) {
      const total = sp.plan.totals[p]
      const area = p === 'heating' ? unit.heatArea : unit.unit.areaM2
      const basis = basisUnitOf(sp, p)
      const byDegree = p === 'heating' && sp.changeSplit === 'degreeDays'
      // Runde 3 (N2-H2): Unter einer Vereinbarung „nach Wohnfläche“ gilt die Verordnung nicht; die Teilung nach
      // Gradtagzahlen übernimmt Mietfuchs sinngemäß und sagt es.
      const part = u.days < sp.hDays
        ? byDegree
          ? ` · ${fmtNum(Math.round(u.degreeDayPermille * 10) / 10)} von ${fmtNum(Math.round(sp.hDegree * 10) / 10)} ‰ Gradtage${sp.agreedArea ? ' (nach Gradtagzahlen geteilt wie § 9b Abs. 2 HeizkostenV, sinngemäß)' : ''}`
          : ` · ${u.days}/${sp.hDays} Tage`
        : ''
      steps.push({ label: `Grundkosten ${POT_NAME[p]}`, value: `${fmtNum(area)} von ${fmtNum(total.area)} ${basis}${part}`, term: 'baseCosts' })
      const v = u.pots[p].value
      // Nur der Teil des Nutzers ohne gültige Ablesung ist geschätzt (Heizung PR 13, Abweichung 3 des Plans).
      const estimatedHere = u.pots[p].estimated === true
      if (sp.agreedArea) {
        steps.push({ label: `Verbrauchskosten ${POT_NAME[p]}`, value: 'keine: nach der Vereinbarung (§ 2 HeizkostenV) nur nach Wohnfläche verteilt', term: 'heatingCostOrdinance' })
      } else if (total.overThreshold) {
        // § 9a Abs. 2 (Heizung PR 13): der Topf ausschließlich nach Fläche.
        steps.push({ label: `Verbrauchskosten ${POT_NAME[p]}`, value: `geschätzt für ${fmtNum(total.estimatedArea)} von ${fmtNum(total.area)} ${basis}, mehr als die Grenze: nur nach ${basis === 'm³' ? 'umbautem Raum' : 'Fläche'} verteilt (§ 9a Abs. 2 HeizkostenV)`, term: 'heatingEstimate' })
      } else {
        steps.push(total.measured && v !== null
          ? {
            label: `Verbrauchskosten ${POT_NAME[p]}`,
            value: `${fmtNum(Math.round(v * 1000) / 1000)} von ${fmtNum(Math.round(total.consumption * 1000) / 1000)} ${potShownUnit(sp, p)}` +
              `${estimatedHere ? ' (geschätzt nach § 9a HeizkostenV)' : ''}` +
              `${u.pots[p].group ? (estimatedHere ? ', auf die Nutzer der Wohnung wie nach § 9b Abs. 3 HeizkostenV geteilt' : ' (ohne Zwischenablesung nach § 9b Abs. 3 HeizkostenV geteilt)') : ''}`,
            term: estimatedHere ? 'heatingEstimate' : 'consumptionCosts',
          }
          : { label: `Verbrauchskosten ${POT_NAME[p]}`, value: `kein Verbrauch erfasst, nur nach ${basis === 'm³' ? 'umbautem Raum' : 'Fläche'} verteilt`, term: 'consumptionCosts' })
      }
      steps.push({ label: `Anteil nach Verbrauch ${POT_NAME[p]}`, value: `${fmtNum(total.measured && !total.overThreshold ? (sp.shares[p] ?? 0) : 0)} %`, term: 'consumptionCosts' })
    }
    if (target === 'both' && sp.alpha) {
      const how = sp.alpha.statement.method === 'volumeFormula' ? 'aus dem gemessenen Warmwasser berechnet' : sp.alpha.statement.method === 'areaFormula' ? 'aus der Wohnfläche berechnet' : 'gemessen'
      steps.push({ label: 'Warmwasseranteil', value: `${fmtPercent(sp.alpha.value * 100)} % (${how})`, term: 'hotWaterShare' })
    }
    steps.push({ label: 'Ihr Anteil nach Heizkostenverordnung', value: `${fmtPercent((sp.weights.get(key)?.[target] ?? 0) * 100)} %`, term: 'heatingSystem' })
    // #314: In einer Wohnung mit Leerstand, Eigennutzung oder Wechsel ohne Zwischenablesung der Wert der anderen
    // Teilung nach § 9b Abs. 2, damit die Wirkung der Wahl zu sehen ist. Verteilt wird damit nicht.
    // Durchsicht von #417: nicht beim Ziel Warmwasser (immer nach Tagen, S2), nicht ohne Unterschied, und nicht unter
    // einer Vereinbarung nach § 2, unter der § 9b nur sinngemäß gilt (K3).
    const alt = sp.compare?.units.has(u.unitId) && target !== 'water' && !sp.agreedArea ? sp.compare.weights.get(key)?.[target] : undefined
    if (alt !== undefined && Math.abs(alt - (sp.weights.get(key)?.[target] ?? 0)) > 1e-9) {
      steps.push({
        label: sp.changeSplit === 'degreeDays' ? 'Zum Vergleich zeitanteilig' : 'Zum Vergleich nach Gradtagen',
        value: `${fmtPercent(alt * 100)} %, ${fmtCents(Math.round(amountCents * alt))} (§ 9b Abs. 2 HeizkostenV)`,
        term: 'degreeDays',
      })
    }
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
    // Seit Heizung PR 18 auch die Abzugszeilen nach § 7 Abs. 5 CO2KostAufG (Netzentgelte und Biobrennstoff, Prüfung M5).
    const keys = reliefKey ? new Set([reliefKey, gmodgKeyOf(reliefKey)]) : null
    const relief = st && keys ? -st.rows.filter((r) => keys.has(r.costItemId)).reduce((a, r) => a + r.shareCents, 0) : 0
    if (!w || relief === 0) return { heating: 0, water: 0 }
    const fuel = potItems.filter((c) => c.key === 'heatingSystem' && c.heatingPart === 'fuel')
    const inPot = (p: SelfPot) => fuel.reduce((a, c) => a + c.amountCents * partOf(sp, c, p) * w[p], 0)
    const h = inPot('heating')
    const wa = inPot('water')
    return h + wa > 0 ? { heating: (relief * h) / (h + wa), water: (relief * wa) / (h + wa) } : { heating: 0, water: 0 }
  }
  // Für den Dialog der Schätzung (Heizung PR 13): je Wohnung und Topf mit Gerät, mit Schätzung oder mit fehlenden
  // Werten des Ablesedienstes, was fehlt, und die Vorschläge der drei Wege. Eine Wohnung ohne Gerät bekommt
  // keine (Abweichung 4 des Plans).
  const estimateOptionsOf = (sp: SelfPlantPlan): SelfEstimateOption[] => sp.plan.units.flatMap((u) => sp.plan.pots.flatMap((p): SelfEstimateOption[] => {
    const problems = sp.plan.problems.flatMap((x) => (x.kind === 'missing' && x.unitId === u.unit.id && x.pot === p ? [x] : []))
    const noValues = sp.capture === 'serviceValues' && problems.some((x) => x.reason === 'noMeter')
    if (!u.estimated[p] && !noValues && !u.readings.some((x) => x.pot === p)) return []
    const problem = problems.find((x) => x.reason === 'noReading' || x.reason === 'replacement' || x.reason === 'negative')
    const why = problem && (problem.reason === 'noReading' || problem.reason === 'replacement' || problem.reason === 'negative') ? problem.reason : noValues ? 'noValues' : null
    const { proposals, comparable } = estimateProposals(sp.plan, sp.prev, sp.prevSameLength, u.unit.id, p)
    // Durchsicht von #242, R-I5: Ein Teil der Wohnung ist gültig abgelesen, ein anderer nicht (oder geschätzt).
    const measuredUser = (x: SelfUserPlan) => x.pots[p].value !== null && x.pots[p].estimated !== true
    const partlyMeasured = u.users.some(measuredUser) && u.users.some((x) => !measuredUser(x))
    return [{
      unitId: u.unit.id, unitName: u.unit.name, part: PART_OF_POT[p], areaM2: p === 'heating' ? u.heatArea : u.unit.areaM2,
      why, boundary: problem?.boundary ?? null, estimated: u.estimated[p], partlyMeasured, proposals, comparable,
    }]
  }))
  // Der Ausweis je Anlage und Heizperiode (Entwurf 8.8 ohne § 6a, der mit PR 14 kommt).
  const selfStatementOf =(sp: SelfPlantPlan, potItems: readonly SnapshotCostItem[], reliefKey: string | null): SelfHeatingStatement => {
    const cost = { heating: potCostOf(sp, potItems, 'heating'), water: potCostOf(sp, potItems, 'water') }
    const offDays = (d: string, b: string): number => Math.abs(Math.round((toUTC(d) - toUTC(b)) / MS_DAY))
    return {
      capture: sp.capture,
      ok: sp.weights !== null,
      heatPump: sp.verdict?.kind ?? null,
      changeSplit: sp.changeSplit,
      areaBasisHeat: sp.input.areaBasisHeat,
      hotWater: sp.hotWater,
      alpha: sp.alpha ? { percent: sp.alpha.value * 100, dhwHeatKwh: sp.alpha.dhwHeatKwh, referenceKwh: sp.alpha.referenceKwh, reference: sp.alpha.reference, estimated: sp.alpha.estimated } : null,
      // Der Rechenweg zum Warmwasseranteil (Heizung PR 11, Entwurf 8.8 „α mit Methode“).
      ...(sp.alpha ? { dhw: sp.alpha.statement } : {}),
      shares: sp.shares ? { heating: sp.shares.heating, water: sp.shares.water, forced: sp.shares.forced, previous: sp.shares.previous, ...(sp.shares.above70Agreed ? { above70Agreed: true } : {}) } : null,
      ...(sp.agreedArea ? { agreedArea: true as const } : {}),
      pots: sp.plan.pots.map((p): SelfPotView => {
        const t = sp.plan.totals[p]
        // § 9a Abs. 2 (Heizung PR 13): über der Grenze kein Anteil nach Verbrauch.
        const pct = t.measured && !t.overThreshold && sp.shares ? (sp.shares[p] ?? 0) : 0
        return {
          pot: p, costCents: Math.round(cost[p]), consumptionPct: pct, byAreaOnly: !t.measured, areaM2: t.area, consumption: t.consumption,
          consumptionUnit: potShownUnit(sp, p),
          baseCentsPerM2: t.area > 0 ? (cost[p] * (1 - pct / 100)) / t.area : 0,
          consumptionCentsPerUnit: t.measured && !t.overThreshold && t.consumption > 0 ? (cost[p] * pct / 100) / t.consumption : null,
          overThreshold: t.overThreshold,
          estimatedAreaM2: t.estimatedArea,
          // Durchsicht von #242, R-M9: der geschätzte Teil des Verbrauchs im Topf.
          estimatedConsumption: sp.plan.units.flatMap((u) => u.users).reduce((a, x) => a + (x.pots[p].estimated === true ? (x.pots[p].value ?? 0) : 0), 0),
          ...(basisUnitOf(sp, p) === 'm³' ? { basisUnit: 'm³' as const } : {}),
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
            date: b.date, kind: b.kind, gap: b.gap, far: b.far, missingMeters: b.missingMeters,
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
            heatingEstimated: x.pots.heating.estimated === true,
            waterEstimated: x.pots.water.estimated === true,
          }
        }),
      })),
      // Schätzungen nach § 9a (Heizung PR 13, Entwurf 8.8 „Schätzungen mit Methode“).
      estimates: [...sp.estimates, ...sp.staleEstimates].map((e): SelfEstimateView => {
        const u = sp.plan.units.find((x) => x.unit.id === e.unitId)
        const pot = POT_OF_PART[e.part]
        const stale = sp.staleEstimates.includes(e)
        return {
          plantId: e.plantId, unitId: e.unitId, unitName: u?.unit.name ?? e.unitId, part: e.part, value: e.value, method: e.method, reason: e.reason, confirmed: e.confirmed,
          cause: e.cause, capture: e.capture, valueUnit: e.valueUnit,
          users: stale ? 0 : u?.users.filter((x) => x.pots[pot].estimated === true).length ?? 0,
          kept: stale ? 0 : u?.users.filter((x) => x.pots[pot].estimated !== true && x.pots[pot].value !== null).length ?? 0,
          complete: stale ? false : u?.estimateComplete[pot] ?? false,
          replacesMeasured: stale ? false : u?.replacesMeasured[pot] ?? false,
          ...(stale ? { stale: true } : {}),
        }
      }),
      estimateOptions: estimateOptionsOf(sp),
      threshold: sp.estimates.length > 0 ? law(hkvEstimateThreshold, { period: lawPeriod }, lawLog) : null,
      // Heizung PR 12 (Entwurf 8.8): je Heizkostenverteiler Einheiten, Skala und Faktor, bzw. die Werte des
      // Ablesedienstes; nur bei dieser Erfassung.
      ...(sp.devices.length > 0 ? { devices: sp.devices } : {}),
      ...(sp.serviceValues.length > 0 ? { serviceValues: sp.serviceValues } : {}),
    }
  }
  const co2Pots = co2PotsOf(snapshot, [...items, ...fuelSynthetic].filter((c) => !spanning.has(c.id)))
  // Auch unter einer Ausnahme nach § 11 ohne vereinbarte Abrechnung (Durchsicht von #243, G-K3): Hat der Messdienst den
  // CO₂-Anteil des Vermieters trotzdem abgezogen, steckt er im Rest der Position; zerlegt gehört der Teil der eigenen
  // Wohnung zum Eigenanteil (privat), sonst zählte er in der Steuerübersicht als abziehbar. Den Mietern bucht das
  // nichts zu; `co2.exempt-deducted` sagt es.
  // Eigenbeträge zählen als Eigenanteil bei jeder Einheit, die im Zeitraum selbstgenutzt ist (#259, wie `selfUnits`).
  const co2Units = periodUnits.map((u) => (usageIn(u).phased ? { ...u, participates: usageIn(u).self > 0 ? false : u.participates } : u))
  const co2Deductions = co2DeductionsOf(co2Pots, co2Units, (p) => law(co2ApplicableFrom, { period: { from: p.from, to: p.to } }, lawLog))
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
  const partNoArea = periodUnits.filter((u) => u.participates && !(u.areaM2 > 0) && inKeyBasis(u.id, 'area'))
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

  // Nutzungswechsel (#259): je Einheit mit Wechsel im Zeitraum die Abschnitte, und je Mietverhältnis die Tage,
  // in denen seine Wohnung nicht vermietet ist.
  {
    const usageWord: Record<UnitUsage, string> = { vermietet: 'vermietet', eigen: 'selbstgenutzt', ausgenommen: 'außerhalb der Abrechnungseinheit' }
    for (const u of periodUnits.filter((x) => usageIn(x).phased)) {
      const text = usageIn(u).spans.map((x) => `${formatDayRange(x.from, x.to)} ${usageWord[x.usage]}`).join(', ')
      warn('usage.changed',
        `${u.name}: Die Nutzung wechselt im Abrechnungszeitraum ${label} (${text}). Eigenanteil, Leerstand und Verteilbasis rechnet Mietfuchs für jeden Abschnitt nach seinen Tagen; dass die Kosten gleichmäßig über den Zeitraum anfallen, ist eine Auslegung von Mietfuchs.`,
        unitSubject([u]))
    }
    const tageText = (n: number) => `${fmtNum(n)} ${n === 1 ? 'Tag' : 'Tagen'}`
    // Nutzer der eigenen Heizkostenabrechnung bleibt nur ein Mietverhältnis mit Abrechnung (S3); eines ganz in einer
    // Zeit ohne Vermietung zählt dort zur Nutzung der Einheit.
    const heatingUser = (t: TenancyWithUnit): boolean => partTenancies.some((x) => x.id === t.id) &&
      plants.some((p) => p.method === 'self' && servesUnit(p, t.unit))
    for (const c of usageConflicts) {
      const parts = [
        ...(c.days > 0 ? [`Das Mietverhältnis läuft an ${tageText(c.days)} in einer Zeit, in der die Einheit laut ihrer Nutzung nicht vermietet ist.`] : []),
        ...(c.later > 0 ? [`Es reicht über einen Wechsel der Nutzung hinweg in eine spätere vermietete Zeit; für die Kosten zählt nur der erste vermietete Abschnitt, die übrigen ${fmtNum(c.later)} ${c.later === 1 ? 'Tag' : 'Tage'} nicht.`] : []),
      ]
      // Integrationsdurchsicht 0.13.0, S1: Liegt das Mietverhältnis ganz in einer Zeit ohne Vermietung, bekommt es keine
      // Abrechnung; der Satz nennt die Vorauszahlungen, die dann in keiner Abrechnung angerechnet werden.
      const none = !costIds.has(c.t.id)
      // Dieselbe Anrechnung wie eine Abrechnung dieses Umfangs (`prepaymentOf`), auch bei Weg d (Durchsicht von PR #426, K-2).
      const prepaid = none && scope !== 'heatingPart' ? prepaymentOf(c.t).cents : 0
      const noneText = !none ? ''
        : ` Für dieses Mietverhältnis entsteht deshalb keine Abrechnung${prepaid !== 0 ? `, und seine Vorauszahlungen von ${fmtCents(prepaid)} werden in keiner Abrechnung angerechnet` : ''}.`
      warn('usage.tenancy-conflict',
        `${c.t.tenantName} (${c.t.unit.name}): ${parts.join(' ')} Für diese Tage trägt der Mieter keine Betriebskosten; sie bleiben beim Vermieter.${noneText}${heatingUser(c.t) ? ' In der eigenen Heizkostenabrechnung bleibt er dagegen Nutzer, solange das Mietverhältnis läuft.' : ''} Bitte prüfen Sie Ein- und Auszug oder den Nutzungswechsel der Einheit in den Stammdaten.`,
        { kind: 'tenancy', id: c.t.id })
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
  // Einheiten gezählt nach dem Anteil ihrer Tage (#259); ohne Wechsel genau ihre Zahl.
  const unitCountOf = (us: SnapshotUnit[]): number => us.reduce((a, u) => a + inShare(u), 0)
  const selfCountOf = (us: SnapshotUnit[]): number => us.reduce((a, u) => a + selfShare(u), 0)
  const fullBasis = {
    basisUnits, selfUnits, basisArea, selfArea, partTenancies: costTenancies, basisPersonDays, occupantPersonDays, selfPersonDays, vacancies, vacancyPersonDays, consumptionByType,
    unitCount: unitCountOf(basisUnits), selfUnitCount: selfCountOf(selfUnits),
  }
  const basisOf = (item: SnapshotCostItem): typeof fullBasis => {
    if (!item.participantUnitIds) return fullBasis
    const only = new Set(item.participantUnitIds)
    const bUnits = basisUnits.filter((u) => only.has(u.id))
    const sUnits = selfUnits.filter((u) => only.has(u.id))
    const pTenancies = costTenancies.filter((t) => only.has(t.unitId))
    const sPersonDays = sUnits.reduce((a, u) => a + selfPersonsOf(u) * selfDaysOf(u), 0)
    const vs = vacancies.filter((v) => only.has(v.unit.id))
    const vPersonDays = vs.reduce((a, v) => a + v.personDays, 0)
    const oPersonDays = pTenancies.reduce((a, t) => a + personDaysInPeriod(t, yFrom, yTo), 0) + sPersonDays
    return {
      basisUnits: bUnits,
      selfUnits: sUnits,
      basisArea: bUnits.reduce((a, u) => a + (u.areaM2 || 0) * inShare(u), 0),
      selfArea: sUnits.reduce((a, u) => a + (u.areaM2 || 0) * selfShare(u), 0),
      partTenancies: pTenancies,
      basisPersonDays: oPersonDays + vPersonDays,
      occupantPersonDays: oPersonDays,
      selfPersonDays: sPersonDays,
      vacancies: vs,
      vacancyPersonDays: vPersonDays,
      consumptionByType: consumptionFor(sUnits, only, bUnits),
      unitCount: unitCountOf(bUnits),
      selfUnitCount: selfCountOf(sUnits),
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
  // `heatingAgreeable` steht seit Heizung PR 14 vor den CO₂-Töpfen (bei den Angaben je Heizperiode).
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
  const fuelOwnCarries: SnapshotCostItem[] = []
  // Eine Einheit ohne Wärmeanschluss (#117) oder eine Garage-artige (0 m², niemand wohnt dort) ist
  // bei Heizung und Warmwasser keine beteiligte Wohnung: keine Warnung zur Warmmiete, kein
  // Kürzungsbetrag (zweite Browserabnahme). Verteilt wird weiter wie erfasst.
  const outsideHeating = (u: SnapshotUnit) => isGarageLike(u) || (u.noConnection ?? []).includes('waerme')

  // Zwei Positionen derselben Kostenart, eine ohne Beleg: oft die Übernahme aus dem Vorjahr und
  // dieselbe Rechnung noch einmal aus dem Beleg. Nur ein Hinweis, verteilt wird wie erfasst. Der Rat
  // lautet „löschen“ und nicht „Beleg zuordnen“: Zugeordnet verstummt der Hinweis (er verlangt eine
  // Position ohne Beleg), die Summe bliebe aber doppelt (Integrationsdurchsicht M1).
  // Gezählt und genannt wird je Rechnung (#455): Die Teile einer Quelle stehen als eine Rechnung da, belegt, wenn einer
  // von ihnen den Beleg trägt; „Hier beheben“ führt nie zu einem Teil einer belegten Rechnung.
  // Belegt ist eine Rechnung auch, wenn ein Teil in einem anderen Zeitraum den Beleg trägt (N1 der Durchsicht von Task 8).
  const receipted = new Set([...receiptedSources(snapshot.costItems), ...(snapshot.receiptedSources ?? [])])
  for (const group of possibleDuplicates(items, at, snapshot.comparableCostItems ?? snapshot.previousCostItems ?? [], receipted)) {
    const invoices = invoicesOf(group, receipted)
    const unreceipted = invoices.find((inv) => !inv.hasReceipt)
    const first = unreceipted?.parts[0] ?? group[0]
    if (!first) continue
    // Ist eine aufgeteilte Rechnung beteiligt (Durchsicht von PR 3, I1), richtet sich der Rat nach der Quelle, nicht nach
    // der Zahl der Teile im Zeitraum: Ihre Teile in anderen Zeiträumen sieht die Gruppe nicht. Den Betrag eines Teils
    // auf den der Rechnung zu setzen, zählte sie doppelt; gelöscht wird eine aufgeteilte Rechnung nur ganz.
    const isSourced = (inv: { parts: SnapshotCostItem[] } | undefined) => !!inv?.parts.some((p) => p.sourceId)
    const anySourced = invoices.some(isSourced)
    const list = invoices.map(({ parts, hasReceipt }) => {
      const head = parts[0]
      const amount = parts.length > 1
        ? `${parts.length} Teile einer Rechnung, zusammen ${fmtCents(parts.reduce((a, i) => a + i.amountCents, 0))}`
        : fmtCents(head?.amountCents ?? 0)
      return `„${head?.description ?? ''}“ (${amount}${hasReceipt ? '' : ', ohne Beleg'})`
    })
    const named = andList(list)
    warn('cost.possible-duplicate',
      `${named} stehen ${list.length === 2 ? `beide ${at.label}` : `${at.label} alle`} unter „${first.category}“. ${list.length === 2 ? 'Ist das dieselbe Rechnung' : 'Ist darunter dieselbe Rechnung zweimal'}, etwa einmal aus dem Vorjahr übernommen und einmal aus dem Beleg erfasst, wird sie zweimal verteilt. ` +
      (isSourced(unreceipted)
        ? `Dann bitte die Rechnung ohne Beleg löschen, mit allen ihren Teilen, auch denen in anderen Zeiträumen, nicht nur einen einzelnen. Soll sie bleiben, löschen Sie stattdessen die ${list.length === 2 ? 'andere Position' : 'doppelt erfasste andere Position'}; ihren Betrag auf den der Rechnung zu setzen, zählte ihre übrigen Teile doppelt. `
        : anySourced
        ? (list.length === 2
          ? 'Dann bitte die Position ohne Beleg löschen und die aufgeteilte Rechnung mit allen ihren Teilen stehen lassen. '
          : 'Dann bitte die doppelt erfasste Position löschen, in der Regel die ohne Beleg; eine aufgeteilte Rechnung nur ganz, mit allen ihren Teilen, auch denen in anderen Zeiträumen. ') +
          'Einen ihrer Teile auf den Betrag der ganzen Rechnung zu setzen oder einzeln zu löschen, zählte die Rechnung falsch. '
        : list.length === 2
        ? 'Dann bitte eine der beiden Positionen löschen, in der Regel die ohne Beleg. Soll die ohne Beleg bleiben, setzen Sie ihren Betrag auf den der Rechnung und löschen die andere. '
        : 'Dann bitte die doppelt erfasste Position löschen, in der Regel die ohne Beleg. ') +
      'Nur den Beleg zuzuordnen genügt nicht: Die Rechnung stünde weiter zweimal in der Summe. Sind es verschiedene Rechnungen, ist nichts zu tun.',
      itemSubject(first))
  }

  // „Nur Heizung“ zeitanteilig (Heizung PR 10) und der Betrag nach der Verordnung bei Pauschale (Entwurf 6.3).
  const manualSplitTime = new Map<string, Map<string, { now: number, alt: number }>>()
  const selfFlat = new Map<string, number>()
  // #258: je Mietverhältnis die Positionen, die es laut Mietvertrag nicht trägt, mit Betrag (Hinweis nach der Schleife).
  // `settled`: Wenigstens eine dieser Positionen rechnet das Mietverhältnis ab (weder Pauschale noch Inklusivmiete).
  const notAgreedByTenancy = new Map<string, { t: TenancyWithUnit, items: string[], settled: boolean }>()
  for (const item of [...items, ...fuelSynthetic]) {
    const b = basisOf(item)
    // Eine Übertragszeile (Heizung PR 7) ist keine Position: Sie zählt nicht zu den Kosten des
    // Zeitraums, hat keinen Schlüsselwechsel und keine Überschneidung, und die Regeln aus #140
    // betreffen die Position, deren Teil sie ist.
    const carry = fuelCarryOf.get(item.id)
    // #258: Wer die Position laut Mietvertrag nicht trägt, bleibt in der Verteilbasis, sein Anteil geht an den
    // Vermieter (`notAgreed`), nicht an die übrigen Mieter.
    // Ein Abzug beim Betriebsstrom ist ein Ausschnitt seiner Stromrechnung (Durchsicht des Endstands von #258): Er folgt
    // ihrer Liste, sonst bekäme ein Mieter, der die Rechnung nicht trägt, aus dem Abzug eine Gutschrift.
    const contractSource = (item.operatingPower === 'deduction' && item.operatingPowerGeneralId
      ? items.find((g) => g.id === item.operatingPowerGeneralId)
      : undefined) ?? item
    const notAgreed = contractTenancyIds(contractSource, 'notAgreedTenancyIds')
    const bookable = (t: SnapshotTenancy) => statements.has(t.id) && !notAgreed.has(t.id) && modelFor(t, item) === 'settlement'
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
    // #223: dieselbe Regel bei Wasser und anderen Positionen nach Zählern; der Leitsatz gilt für die Kosten der
    // Verbrauchserfassung allgemein, nicht nur für die Heizung.
    if (item.category !== HEATING_CATEGORY && !isNotAllocable(item.category) && (item.category === 'Wasser/Abwasser' || item.key === 'meter') &&
      !item.id.startsWith('fuel:') && !item.id.startsWith('stock:') && /zwischenablesung|nutzerwechsel/i.test(item.description)) {
      warn('meter.change-fee',
        `„${item.description}“: Kosten der Verbrauchserfassung und Abrechnung, die wegen des Auszugs eines Mieters vor Ablauf des Abrechnungszeitraums entstehen, etwa für die Zwischenablesung der Wasserzähler, sind keine umlagefähigen Betriebskosten, sondern Verwaltungskosten; sie trägt der Vermieter, soweit im Mietvertrag nichts anderes vereinbart ist (BGH VIII ZR 19/07). ` +
          'Eine wirksame Vereinbarung gibt einen Anspruch gegen den ausziehenden Mieter, keine Position für alle. Gehört die Position dazu, erfassen Sie sie unter „Nicht umlagefähig“.',
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
    // **Je Abschnitt verteilen (#259, Durchsicht S1).** Wechselt eine Einheit zwischen „in der Abrechnungseinheit“
    // (vermietet, selbstgenutzt) und „außerhalb“, ändert sich die Verteilbasis von Fläche, Einheiten und Gemeinschaft
    // im Zeitraum. Dann wird der Betrag nach Tagen (bei „nur Heizung“ nach Gradtagen) auf die Abschnitte gleicher
    // Basis geteilt und je Abschnitt verteilt; die exakten Anteile werden summiert und danach **einmal** gerundet
    // (#202). So trägt kein Mieter für eine Zeit, in der eine andere Einheit außerhalb lag, den Anteil, den sie
    // in der übrigen Zeit hat; eine ganzjährig außerhalb liegende Einheit belastet die übrigen ja ebenso voll.
    // Dass die Kosten gleichmäßig über den Zeitraum anfallen, ist eine Auslegung (Hinweis `usage.changed`).
    // Ein Wechsel nur zwischen vermietet und selbstgenutzt ändert die Basis nicht und braucht keine Abschnitte.
    const segmentsOf = (units: SnapshotUnit[]): Period[] | null => {
      const inside = (k: UnitUsage) => k !== 'ausgenommen'
      const cuts = new Set<string>()
      for (const u of units) {
        const sp = usageIn(u).spans
        for (let i = 1; i < sp.length; i++) if (inside((sp[i - 1] as UsageSpan).usage) !== inside((sp[i] as UsageSpan).usage)) cuts.add((sp[i] as UsageSpan).from)
      }
      if (cuts.size === 0) return null
      const starts = [yFrom, ...[...cuts].sort()]
      return starts.map((from, i) => ({ from, to: i + 1 < starts.length ? dayBefore(starts[i + 1] as string) : yTo }))
    }
    const segmented = (segs: Period[], units: SnapshotUnit[], weight: (u: SnapshotUnit) => number, byDegree: boolean) => {
      const days = (r: Period) => rangeOverlapDays(r.from, r.to, r.from, r.to)
      const measure = (r: Period): number => (byDegree && degreeTable && fullDegree > 0 ? degreeDayPermille([r], degreeTable) : days(r))
      const full = byDegree && degreeTable && fullDegree > 0 ? fullDegree : diy
      const cut = (r: Period, from: string, to: string): Period | null => {
        const f = r.from > from ? r.from : from
        const e = r.to < to ? r.to : to
        return f <= e ? { from: f, to: e } : null
      }
      const tenants = new Map<string, { raw: number, parts: { from: string, to: string, w: number, total: number }[] }>()
      let self = 0
      for (const seg of segs) {
        const members = units.filter((u) => usageIn(u).spans.some((x) => x.usage !== 'ausgenommen' && cut(seg, x.from, x.to) !== null))
        const total = members.reduce((a, u) => a + weight(u), 0)
        const segMeasure = measure(seg)
        if (!(total > 0) || !(segMeasure > 0)) continue
        const amount = item.amountCents * (segMeasure / full)
        for (const t of b.partTenancies) {
          if (!members.some((u) => u.id === t.unitId)) continue
          const o = cut(seg, t.start > yFrom ? t.start : yFrom, t.end !== null && t.end < yTo ? t.end : yTo)
          if (!o) continue
          const e = tenants.get(t.id) ?? { raw: 0, parts: [] }
          e.raw += amount * (weight(t.unit) / total) * (measure(o) / segMeasure)
          e.parts.push({ ...o, w: weight(t.unit), total })
          tenants.set(t.id, e)
        }
        for (const u of members) {
          const selfMeasure = usageIn(u).spans.filter((x) => x.usage === 'eigen')
            .reduce((a, x) => { const o = cut(seg, x.from, x.to); return a + (o ? measure(o) : 0) }, 0)
          self += amount * (weight(u) / total) * (selfMeasure / segMeasure)
        }
      }
      return { tenants, self }
    }
    const partsText = (parts: { from: string, to: string, w: number, total: number }[], unitText: string) =>
      parts.map((x) => `${fmtNum(x.w)} von ${fmtNum(Math.round(x.total * 100) / 100)} ${unitText} ${formatDayRange(x.from, x.to)}`).join('; ')
    const segs = ['area', 'units', 'external'].includes(item.key) ? segmentsOf(b.basisUnits) : null
    // Die Tagesgewichte der Nutzung nach **demselben Maß** wie der Mieter der Position (Nachprüfung M-b): bei „nur
    // Heizung“ nach Gradtagen (§ 9b Abs. 2), sonst nach Tagen. Ohne Wechsel genau `selfShare`/`outsideShare`, also 1 oder 0.
    const byDegreeShare = (u: SnapshotUnit, k: UnitUsage): number => {
      if (!(degreeTable && fullDegree > 0)) return 0
      return usageIn(u).spans.filter((x) => x.usage === k).reduce((a, x) => a + degreeDayPermille([{ from: x.from, to: x.to }], degreeTable), 0) / fullDegree
    }
    const itemSelfShare = (u: SnapshotUnit): number => (degreeTable && fullDegree > 0 && usageIn(u).phased ? byDegreeShare(u, 'eigen') : selfShare(u))
    const itemOutsideShare = (u: SnapshotUnit): number => (degreeTable && fullDegree > 0 && usageIn(u).phased ? byDegreeShare(u, 'ausgenommen') : outsideShare(u))
    const degreeSelf = degreeTable !== null && fullDegree > 0 && b.selfUnits.some((u) => usageIn(u).phased)
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
    } else if (item.key === 'area' && b.basisArea > 0 && segs) {
      const r = segmented(segs, b.basisUnits, (u) => u.areaM2 || 0, true)
      for (const t of b.partTenancies) {
        const e = r.tenants.get(t.id)
        if (e) targets.push({ t, raw: e.raw, basisText: partsText(e.parts, 'm²') })
      }
      selfRaw = r.self
    } else if (item.key === 'area' && b.basisArea > 0) {
      for (const t of b.partTenancies) {
        const raw = item.amountCents * ((t.unit.areaM2 || 0) / b.basisArea) * dayShare(t)
        targets.push({ t, raw, basisText: `${fmtNum(t.unit.areaM2 || 0)} von ${fmtNum(b.basisArea)} m²${partOfYear(t)}` })
      }
      selfRaw = degreeSelf
        ? item.amountCents * (b.selfUnits.reduce((a, u) => a + (u.areaM2 || 0) * itemSelfShare(u), 0) / b.basisArea)
        : item.amountCents * (b.selfArea / b.basisArea)
    } else if (item.key === 'units' && b.basisUnits.length > 0 && segs) {
      const r = segmented(segs, b.basisUnits, () => 1, true)
      for (const t of b.partTenancies) {
        const e = r.tenants.get(t.id)
        if (e) targets.push({ t, raw: e.raw, basisText: partsText(e.parts, 'Einheiten') })
      }
      selfRaw = r.self
    } else if (item.key === 'units' && b.basisUnits.length > 0) {
      // Ohne Wechsel zwischen drinnen und außerhalb ist `unitCount` die Zahl der Einheiten (#259).
      const count = Number.isInteger(b.unitCount) ? String(b.unitCount) : fmtNum(Math.round(b.unitCount * 100) / 100)
      for (const t of b.partTenancies) {
        const raw = (item.amountCents / b.unitCount) * dayShare(t)
        targets.push({ t, raw, basisText: `1 von ${count} Einheiten${partOfYear(t)}` })
      }
      selfRaw = (item.amountCents / b.unitCount) * (degreeSelf ? b.selfUnits.reduce((a, u) => a + itemSelfShare(u), 0) : b.selfUnitCount)
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
        // Verteilt wird nach dem Anteil der Tage in der Abrechnungseinheit (#259); ohne Wechsel genau `own`.
        const ownIn = b.basisUnits.reduce((a, u) => a + valueOf(u) * inShare(u), 0)
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
          // Ein Teil einer aufgeteilten Rechnung trägt nur die Tage seines Zeitraums, die Angaben der Gemeinschaft
          // beschreiben die ganze (#454, `whole` in SPLIT_FIELDS); verglichen wird mit demselben Tagesanteil.
          const share = partShare(item, { from: yFrom, to: yTo })
          const expected = Math.round((eb.totalCents * own * (share ? share.days / share.of : 1)) / eb.total)
          // Nach zwei Wechseln können zwei Teile derselben Rechnung im Zeitraum stehen (Durchsicht, Befund 2); der
          // Tagesanteil gilt für beide zusammen, also werden sie zusammen gemessen. Welche Teile zusammengehören, sagt
          // die Quelle (#455); ohne Quelle zählt nur die Position selbst.
          const source = item.sourceId
          const measured = !source ? item.amountCents
            : items.filter((o) => o.key === 'external' && o.sourceId === source).reduce((a, o) => a + o.amountCents, 0)
          if (Math.abs(expected - measured) > 100) {
            const days = share ? `, davon ${share.days} von ${share.of} Tagen des Leistungszeitraums` : ''
            const together = measured !== item.amountCents ? ' mit den übrigen Teilen dieser Rechnung im Zeitraum' : ''
            warn('external.amount-mismatch', `„${item.description}“: der Betrag ${fmtCents(measured)}${together} passt nicht zum rechnerischen Anteil ${fmtCents(expected)} (${fmtNum(own)} von ${fmtNum(eb.total)} ${MEASURE_LABELS[eb.measure]} aus ${fmtCents(eb.totalCents)}${days}) — bitte die Angaben aus der Gemeinschaftsabrechnung prüfen. Verteilt wird der eingetragene Betrag.`, itemSubject(item))
          }
          // „Kosten der Gemeinschaft“ und nicht „Gesamtkosten der Anlage“ (#144): Die Spalte
          // Gesamtkosten zeigt hier den Anteil des Vermieters, und zweimal „Gesamtkosten“ mit zwei
          // Zahlen war doppeldeutig. Weicht der Betrag ab, steht das auch im Druck; der Rechenweg
          // erscheint dort nicht, und der Mieter sähe sonst eine Rechnung, die nicht aufgeht.
          const applied = Math.abs(expected - measured) > 100 ? ' · angesetzt laut Hausgeldabrechnung' : ''
          const suffix = ` · Kosten der Gemeinschaft ${fmtCents(eb.totalCents)}${applied}`
          const label = MEASURE_LABELS[eb.measure]
          // Je Abschnitt, wenn eine Einheit zwischen drinnen und außerhalb wechselt (#259, S1).
          const r = segs ? segmented(segs, b.basisUnits, valueOf, false) : null
          for (const t of b.partTenancies) {
            const e = r ? r.tenants.get(t.id) : undefined
            if (r && !e) continue
            const raw = e ? e.raw : item.amountCents * (valueOf(t.unit) / ownIn) * (t.days / diy)
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
          selfRaw = r ? r.self : item.amountCents * (b.selfUnits.reduce((a, u) => a + valueOf(u) * selfShare(u), 0) / ownIn)
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
        // Bis 0.13.0 teilte Mietfuchs Einzelbeträge nach Tagen und ließ die Beträge je Mieter ungekürzt in jedem Teil
        // (#454); seither nie (`splitBlocker`). Ein solcher Teil sagt, was zu tun ist.
        const part = partShare(item, { from: yFrom, to: yTo }) ? ' Die Rechnung ist nach Tagen auf mehrere Abrechnungszeiträume aufgeteilt, die Einzelbeträge aber nicht: Tragen Sie in jedem Teil die Einzelbeträge ein, die auf diesen Zeitraum entfallen.' : ''
        warn('amounts.exceed', `„${item.description}“: die Einzelbeträge ergeben zusammen ${fmtCents(sum)} und übersteigen den Rechnungsbetrag ${fmtCents(item.amountCents)} — es wird nichts verteilt, der Betrag geht an den Vermieter.${part}`, itemSubject(item))
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
      // Was davon in den Tagen in der Abrechnungseinheit verteilt wird (#259); ohne Wechsel genau `pctSum`.
      const pctSumIn = basisUnits.reduce((a, u) => a + Math.max(0, pctOf(u.id)) * (degreeTable && fullDegree > 0 && usageIn(u).phased ? 1 - itemOutsideShare(u) : inShare(u)), 0)
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
        for (const t of costTenancies) {
          const pct = pctOf(t.unitId)
          if (pct <= 0) continue
          const raw = item.amountCents * (pct / 100) * dayShare(t)
          targets.push({ t, raw, basisText: `${fmtNum(pct)} % vereinbart${partOfYear(t)}` })
        }
        selfRaw = selfUnits.reduce((a, u) => a + item.amountCents * (pctOf(u.id) / 100) * itemSelfShare(u), 0)
        // Ein Anteil für eine Wohnung, die es gibt, die aber außerhalb liegt, ist dort vereinbart
        // und verfällt; einer für eine gelöschte Wohnung zählt zum Nicht-Vereinbarten (so steht er
        // auch nach dem Geraderücken da, das ihn streicht).
        const outsidePct = Object.keys(item.customShares ?? {})
          .filter((id) => pctOf(id) > 0 && unitById.has(id) && !basisUnits.some((u) => u.id === id))
          .reduce((a, id) => a + pctOf(id), 0) +
          // Eine Einheit mit Wechsel (#259): ihr Anteil verfällt für die Tage außerhalb.
          basisUnits.filter((u) => usageIn(u).phased).reduce((a, u) => a + Math.max(0, pctOf(u.id)) * itemOutsideShare(u), 0)
        // Über 100 % zusammen mit den Wohnungen innerhalb verfällt nur, was bis 100 % fehlt; mehr
        // als den Betrag kann der Vermieter nicht tragen (#202, vorher an der Zerlegung begrenzt).
        const outsideCapped = Math.min(outsidePct, Math.max(0, 100 - pctSumIn))
        outsideRaw = item.amountCents * (outsideCapped / 100)
        customUnassignedRaw = item.amountCents * (Math.max(0, 100 - pctSumIn - outsideCapped) / 100)
      }
    } else if (item.key === 'meter') {
      // `item.meterType` ist optional (string | null | undefined); die Indizierung selbst
      // verhält sich für null/undefined wie für einen unbekannten Zählertyp (kein Treffer,
      // `data` bleibt undefined), deshalb hier nur eine Typ-Zusicherung, keine neue Prüfung.
      const data = b.consumptionByType[item.meterType as MeterType]
      if (data?.unitProblem?.kind === 'unknown') warn('meter.unit-unknown', unitUnknownText(`„${item.description}“`, data.unitProblem.meters), unitProblemSubject(data.unitProblem.meters))
      if (data?.unitProblem?.kind === 'mixed') {
        // Verschiedene Größen (Gas in m³ neben kWh) rechnete schon vor #342 falsch; verteilt wird nicht.
        forced = 'noBasis'
        warn('meter.units-mixed', unitsMixedText(`„${item.description}“`, data.unitProblem.meters, 'Der Betrag geht an den Vermieter.'), unitProblemSubject(data.unitProblem.meters))
      } else if (!data || data.basis <= 0) {
        forced = 'noBasis'
        warn('meter.no-consumption', `„${item.description}“: kein Verbrauch für Zählertyp „${meterTypeLabel(item.meterType)}“ erfasst — Betrag geht an den Vermieter.`, itemSubject(item))
      } else {
        const type = item.meterType ?? '—'
        // Für die Zerlegung des Vermieteranteils (#142): Verbrauch der Zähler von Wohnungen
        // außerhalb der Abrechnungseinheit, und beim Hauptzähler, was keine Wohnung misst.
        const inBasis = new Set(b.basisUnits.map((u) => u.id))
        const yearOf = (m: SnapshotMeter) => consumptionInPeriod(readingsOf(m.id), yFrom, yTo) * data.scaleOf(m.id)
        const measured = data.meters.reduce((a, m) => a + yearOf(m), 0)
        outsideRaw = item.amountCents * ((data.meters.filter((m) => !inBasis.has(m.unitId)).reduce((a, m) => a + yearOf(m), 0) + data.outsidePhased) / data.basis)
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
        const onlySelfUnmetered = data.main !== null && data.unmetered.every((u) => b.selfUnits.includes(u) && wholeSelf(u))
        if (data.unmetered.length > 0 && !onlySelfUnmetered) {
          const names = andList(data.unmetered.map((u) => u.name))
          // Eine Garage oder ein Stellplatz hat oft keinen Anschluss; dann nennt die Meldung den
          // Ausweg, die Kennzeichnung an der Einheit (#117).
          const noConnection = ' Hat eine dieser Einheiten keinen eigenen Anschluss (etwa eine Garage), entfernen Sie in den Stammdaten der Einheit unter „Weitere Angaben — Anschlüsse“ das Häkchen dieser Zählerart.'
          const text = data.main !== null
            ? data.mainSelfByDays
              ? `der Rest des Hauptzählers gilt für die Tage als Eigenanteil, an denen alle Einheiten ohne Zähler selbstgenutzt sind, für die übrigen Tage geht er an den Vermieter; Mietfuchs teilt ihn nach Tagen, nimmt also gleichmäßigen Verbrauch an (eine Auslegung). Ein Zwischenzähler macht das genau.${noConnection}`
              : `der Rest des Hauptzählers geht an den Vermieter, weil sich nicht bestimmen lässt, wie viel davon auf sie entfällt.${b.selfUnits.length > 0 ? ' Einen Eigenanteil weist Mietfuchs für diesen Rest deshalb nicht aus.' : ''}${noConnection}`
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
            c += consumptionInPeriod(readings, pFrom, pTo) * data.scaleOf(m.id)
          }
          const raw = item.amountCents * (c / data.basis)
          targets.push({ t, raw, basisText: `${fmtNum(Math.round(c * 100) / 100)} von ${fmtNum(Math.round(data.basis * 100) / 100)}${data.unit ? ` ${data.unit}` : ''} (${data.main !== null ? 'Hauptzähler' : 'gemessen'})` })
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
            const x = t ? usageIn(t.unit) : null
            if (t && x && x.phased && !statements.has(t.id)) {
              // Durchsicht S3 (#259): Ein Mietverhältnis ganz in einer Zeit ohne Vermietung hat keine Abrechnung; sein
              // Anteil gehört dann, wie die Nutzung des Tages sagt, zur Eigennutzung bzw. nach außerhalb.
              const own = x.spans.filter((y) => y.from <= u.to && y.to >= u.from)
                .map((y) => ({ usage: y.usage, days: rangeOverlapDays(y.from > u.from ? y.from : u.from, y.to < u.to ? y.to : u.to, yFrom, yTo) }))
              const all = own.reduce((a, y) => a + y.days, 0)
              const selfPart = all > 0 ? own.filter((y) => y.usage === 'eigen').reduce((a, y) => a + y.days, 0) / all : 0
              selfRaw += raw * selfPart
              outsideRaw += raw * (1 - selfPart)
            } else if (t) targets.push({ t, raw, basisText: selfBasisText(sp, u.key, target), heating: selfSteps(sp, u.key, target, item.amountCents) })
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
      if (target && usageIn(target).phased) {
        // Mit Nutzungswechsel im Zeitraum (#259) nach Tagen: die Mieter in der vermieteten Zeit, die Eigennutzung als
        // Eigenanteil, die Zeit außerhalb als eigener Grund; der Rest ist Leerstand.
        for (const t of costTenancies.filter((x) => x.unitId === target.id)) {
          targets.push({ t, raw: item.amountCents * dayShare(t), basisText: `Direktzuordnung ${t.unit.name}${partOfYear(t)}` })
        }
        selfRaw = item.amountCents * itemSelfShare(target)
        outsideRaw = item.amountCents * itemOutsideShare(target)
      } else for (const t of tenancies.filter((t) => t.unitId === item.directUnitId)) {
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
      if (toSelf && !(target && usageIn(target).phased)) {
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
        notBooked: targets.flatMap((x, i) => booked[i] ? [] : [{ reason: !statements.has(x.t.id) ? 'outsideUnit' : notAgreed.has(x.t.id) ? 'notAgreed' : modelFor(x.t, item), raw: x.raw }]),
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
    // #258: der Anteil jedes nicht vereinbarten Mietverhältnisses für den Hinweis. Die Zeile `notAgreed` des
    // Vermieters wird nach den exakten Anteilen auf sie aufgeteilt, damit die Beträge zusammen genau die Zeile ergeben.
    if (notAgreed.size > 0) {
      const k = recipients.findIndex((r) => r.key === 'notAgreed')
      const raws = new Map<string, { t: TenancyWithUnit, raw: number }>()
      targets.forEach((x, i) => {
        if (booked[i] || !statements.has(x.t.id) || !notAgreed.has(x.t.id)) return
        const e = raws.get(x.t.id) ?? { t: x.t, raw: 0 }
        e.raw += x.raw
        raws.set(x.t.id, e)
      })
      const list = [...raws.values()]
      const sign = item.amountCents < 0 ? -1 : 1
      const split = k < 0 ? [] : largestRemainder(cents[k] * sign, list.map((e) => Math.max(0, e.raw * sign)), list.map((e) => e.t.id))
      list.forEach((e, j) => {
        const c = (split[j] ?? 0) * sign
        if (c === 0) return
        const entry = notAgreedByTenancy.get(e.t.id) ?? { t: e.t, items: [], settled: false }
        entry.items.push(`„${item.description}“ (${fmtCents(c)})`)
        entry.settled ||= modelFor(e.t, item) === 'settlement'
        notAgreedByTenancy.set(e.t.id, entry)
      })
    }
    // #258, Entwurf Entscheidung 5: „Sonstige Betriebskosten“ trägt ein Mieter nur, wenn sein Vertrag sie benennt.
    // Gefragt wird nur, wo Geld fließt: bei Mietverhältnissen, die die Position tragen und noch keine Antwort haben.
    if (item.category === OTHER_COSTS_CATEGORY && !carry) {
      const named = contractTenancyIds(item, 'namedTenancyIds')
      const open = new Map<string, { t: TenancyWithUnit, cents: number }>()
      targets.forEach((x, i) => {
        if (!booked[i] || named.has(x.t.id) || shareOf(i) === 0) return
        const e = open.get(x.t.id) ?? { t: x.t, cents: 0 }
        e.cents += shareOf(i)
        open.set(x.t.id, e)
      })
      const unanswered = [...open.values()].filter((e) => e.cents !== 0).sort((a, b) => compareText(a.t.id, b.t.id))
      if (unanswered.length > 0) {
        warn('allocation.other-unanswered',
          `„${item.description}“: Ob der Mietvertrag diese sonstigen Betriebskosten ausdrücklich nennt, ist für ${andList(unanswered.map((e) => `${e.t.tenantName} (${e.t.unit.name}) mit ${fmtCents(e.cents)}`))} nicht angegeben. ` +
            'Sonstige Betriebskosten trägt ein Mieter nur, wenn sein Vertrag sie beim Namen nennt; ein Verweis auf die Betriebskostenverordnung genügt dafür nicht (BGH VIII ZR 167/03). ' +
            'Bis zu Ihrer Angabe verteilt Mietfuchs die Position wie erfasst. Geben Sie bei der Position je Mieter an, ob sein Vertrag sie nennt; nennt er sie nicht, trägt der Vermieter seinen Anteil.',
          itemSubject(item))
      }
    }
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
      // Die Grundlage der Schätzung des Betriebsstroms (Heizung PR 15, P-W1): Bestreitet ein Mieter den
      // Betrag, muss der Vermieter sie darlegen. Nur im Rechenweg, der nicht gedruckt wird.
      if (item.operatingPowerBasis) {
        steps.push({ label: 'Grundlage der Schätzung', value: item.operatingPowerBasis.split('\n').join('; '), term: 'operatingPower' })
      }
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
    // Heizt der Mieter selbst (Heizung PR 19, Gegenprüfung M3), zählt er nicht: Bei der Etagenheizung gilt die
    // Verordnung nicht (§ 1 Abs. 1 Nr. 1 HeizkostenV: „zentraler Heizungsanlagen“), und beim einzigen Nutzer einer
    // zentralen Anlage wird nichts „auf die Nutzer“ verteilt (Auslegung am Wortlaut). Was er für Wartung oder
    // Betriebsstrom trägt, kann er deshalb nicht nach § 12 kürzen.
    // Integrationsdurchsicht S2: Ein Übertrag `fuel:`, dessen Rechnung in einem anderen Zeitraum steht, ist in diesem
    // Zeitraum der einzige Teil dieser Heizkosten. Für § 12 HeizkostenV, die Deckung nach Verbrauch und den Hinweis zur
    // Fernablesung zählt er deshalb wie eine Position; der Übertrag aus einer Rechnung dieses Zeitraums (Anteil für einen
    // anderen) gehört dagegen zu ihr (unten).
    const ownCarry = !!carry && item.id.startsWith('fuel:') && !items.some((c) => c.id === carry.itemId)
    if (ownCarry) fuelOwnCarries.push(item)
    const heatingReceived = item.category === HEATING_CATEGORY && (!carry || ownCarry)
      ? targets.flatMap((x, i) => (booked[i] && statements.has(x.t.id) && shareOf(i) > 0 && !outsideHeating(x.t.unit) && x.t.heatingModel !== 'selfSupply' ? [{ x, share: shareOf(i) }] : []))
      : []
    if (heatingReceived.length > 0) heatingBilledItem ??= item
    if (item.category === HEATING_CATEGORY && item.key !== 'direct' && (!carry || ownCarry)) {
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
        // Mit Vorzeichen (Integrationsdurchsicht S2): Ein Übertrag kann den Anteil einer Gutschrift ins Positive drehen und
        // umgekehrt; gekürzt wird nur, was netto positiv bleibt (unten).
        heatingCuts.push({
          item,
          rows: targets.flatMap((x, i) => (booked[i] && statements.has(x.t.id) && shareOf(i) !== 0 && !outsideHeating(x.t.unit) && x.t.heatingModel !== 'selfSupply'
            ? [{ unitId: x.t.unitId, label: `${x.t.tenantName} (${x.t.unit.name})`, share: shareOf(i) }] : [])),
        })
      }
    }
    // Die Überträge aus dem Vorrat (Heizung PR 8) gehören zu den Heizkosten, die der Mieter trägt: Die
    // Kürzung nach § 12 Abs. 1 HeizkostenV wird auf seinen Anteil samt Übertrag gerechnet (Durchsicht von
    // #237, M3); sie stehen bei der Position, deren Schlüssel sie folgen.
    // Ebenso der Übertrag `fuel:` aus einer Rechnung dieses Zeitraums für einen anderen (Integrationsdurchsicht S2): Er
    // mindert den Anteil, den der Mieter hier trägt, und damit die Kürzung.
    if (carry && (item.id.startsWith('stock:') || (item.id.startsWith('fuel:') && !ownCarry)) && item.category === HEATING_CATEGORY) {
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

  // #258, Entwurf Entscheidung 6: eine Auskunft je Mietverhältnis. Die Auslegung, dass der Anteil beim Vermieter
  // bleibt und nicht bei den übrigen Mietern, steht als Begründung aus der Fundstelle unter „Mehr dazu“.
  // Pauschale und Inklusivmiete bekommen keine Abrechnung dieser Kosten; der Satz, dass die Position dort fehlt, entfällt.
  for (const { t, items: list, settled } of [...notAgreedByTenancy.values()].sort((a, b) => compareText(a.t.id, b.t.id))) {
    const who = `${t.tenantName} (${t.unit.name})`
    warn('allocation.not-agreed',
      `${who} trägt laut Mietvertrag ${list.length === 1 ? 'die Position' : 'die Positionen'} ${andList(list)} nicht; ${list.length === 1 ? 'diesen Anteil' : 'diese Anteile'} trägt der Vermieter (§ 556 Abs. 1 BGB), nicht die übrigen Mieter. ` +
        (settled ? `In der Abrechnung von ${who} ${list.length === 1 ? 'fehlt sie' : 'fehlen sie'}. ` : '') +
        'Dass der Anteil nicht auf die übrigen Mieter übergeht, ist eine Auslegung von Mietfuchs nach dem Grundsatz zum Leerstand (BGH VIII ZR 159/05).',
      { kind: 'tenancy', id: t.id })
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
      // Heizung PR 16 (Prüfung C-K3): bei Contracting der Wärmezähler, nach dem der Lieferant abrechnet.
      const zaehler = plant.energy === 'gas' ? 'den Gaszähler' : plant.contracting === true ? 'den Wärmezähler, nach dem der Lieferant abrechnet' : plant.energy === 'districtHeating' ? 'den Wärmezähler der Übergabestation' : 'den Stromzähler der Wärmepumpe'
      // Durchsicht von #233: Ein Zählerstand schließt die Lücke nicht, er macht nur die Aufteilung der
      // Folgerechnung genauer (Stufe 1 braucht Stände am Tag vor ihrem Beginn, an ihrem Ende und am
      // Stichtag).
      const zero = g.zeroInvoices ?? []
      const credit = g.creditOnly ?? []
      const vorliegend = zero.length > 0
        ? `liegt nur ${zero.length === 1 ? 'die Rechnung' : 'die Rechnungen'} ${zero.map((z) => `„${z}“`).join(', ')} vor, deren Positionen zusammen 0 € ergeben; Mietfuchs behandelt ${zero.length === 1 ? 'sie' : 'sie'} als storniert`
        : credit.length > 0
          ? `liegt nur ${credit.length === 1 ? 'die Gutschrift' : 'die Gutschriften'} ${credit.map((z) => `„${z}“`).join(', ')} ohne Rechnung vor`
          : 'liegt keine Rechnung vor'
      warn('fuel.uncovered',
        `${where}: Für ${formatDayRange(g.from, g.to)} (${g.days} ${g.days === 1 ? 'Tag' : 'Tage'}, ${fmtNum(Math.round(g.permille * 10) / 10)} ‰ der Gradtage) ${vorliegend}; diesen Teil verteilt Mietfuchs nicht. ` +
          // Durchsicht #277, S1: Die einzige mögliche Vorlage ist zu kurz für eine Hochrechnung.
          (g.shortTemplate ? `Einen Schätzvorschlag gibt es nicht: Die Rechnung „${g.shortTemplate}“ deckt weniger als 100 ‰ der Gradtage dieses Zeitraums ab, hochgerechnet ergäbe sie keinen belastbaren Betrag. ` : '') +
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
    for (const c of result.creditOnly) {
      // #251: Eine Lieferung mit negativer Summe belegt keinen Verbrauch (§ 7 Abs. 2 HeizkostenV: Kosten der verbrauchten
      // Brennstoffe). Die Zuordnung des Geldes zu den Heizperioden ihres Zeitraums ist Auslegung am Verbrauchsprinzip.
      const range = fuel?.deliveries.find((x) => x.id === c.deliveryId)
      const r = range ? rangeOf(range) : null
      const span = r ? ` (${formatDayRange(r.from, r.to)})` : ''
      const lead = `${where}: Die Positionen der Lieferung „${c.label}“${span} ergeben zusammen ${fmtCents(c.cents)}. `
      // Ohne Zeitraum gilt der Tag der Gutschrift, ein Notbehelf (R-6).
      const behelf = r && r.from === r.to
        ? 'Die Gutschrift nennt nur einen Tag; Mietfuchs ordnet sie behelfsweise der Heizperiode dieses Tages zu. Gehört sie zu den Kosten eines anderen Zeitraums, tragen Sie diesen als Rechnungszeitraum ein. '
        : ''
      if (c.confirmed) {
        warn('fuel.credit-only-confirmed',
          `${lead}Sie haben angegeben, dass die Rechnung dazu nicht in Mietfuchs steht. Mietfuchs verteilt die Gutschrift nach dem Verbrauch und rechnet ihren Zeitraum als nicht abgedeckt. ${behelf}`.trimEnd(),
          subject)
        continue
      }
      warn('fuel.credit-only',
        `${lead}Brennstoff kann nicht weniger als nichts kosten; eine solche Lieferung ist eine Gutschrift oder Stornorechnung ohne die Rechnung, die sie berichtigt. ` +
          'Mietfuchs rechnet ihren Zeitraum deshalb als nicht abgedeckt, nimmt sie nicht als Vorlage für Schätzungen und zählt keinen CO₂-Ausstoß für sie. ' +
          'Den Betrag verteilt Mietfuchs nach dem Verbrauch auf die Heizperioden ihres Zeitraums, damit die Gutschrift bei den Mietern ankommt (Auslegung nach dem Verbrauchsprinzip, § 7 Abs. 2 HeizkostenV). ' +
          behelf +
          'Gehört die Gutschrift zu einer anderen Lieferung, ordnen Sie sie auf der Seite Heizkosten dort zu; steht dort der Zahlbetrag nach Abzug der Abschläge, tragen Sie stattdessen die Kosten des Abrechnungszeitraums ein.',
        subject)
    }
    for (const u of result.estimatesWithoutTemplate) {
      warn('fuel.estimate-undistributed',
        `${where}: Die Schätzung „${nameOf(u.deliveryId)}“ (${fmtCents(u.cents)}) verteilt Mietfuchs nicht: Es gibt keine Rechnung mit Positionen über mehr als 0 €, deren Umlageschlüssel sie übernehmen könnte. ` +
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
        `${where}: Zur Rechnung „${nameOf(u.deliveryId)}“ gehörten heute ${fmtCents(u.cents)} in diese Heizperiode. Die Abrechnung ${owner?.label ?? periodLabel(u.owner)}, in der die Rechnung steht, ist abgeschlossen; ` +
          (u.cancelled
            ? 'beim Abschluss ergaben ihre Positionen zusammen 0 € (storniert), deshalb ist dort nichts von ihr verteilt und hier kommt nichts dazu. Solange jene Abrechnung abgeschlossen bleibt, verteilt Mietfuchs die Rechnung nirgends. '
            : 'ihre Position war beim Abschluss noch nicht mit der Lieferung verknüpft, deshalb ist die Rechnung dort ganz verteilt und hier kommt nichts dazu. ') +
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
      const nachfordern = `Solange die Frist dieser Abrechnung läuft (Zugang bis ${fmtDay(other.deadline)}), können Sie sie wieder öffnen und berichtigen. Danach dürfen Sie nur nachfordern, wenn Sie die Verspätung nicht zu vertreten haben (§ 556 Abs. 3 Satz 3 BGB, BGH VIII ZR 264/12), und dann alsbald, in der Regel binnen drei Monaten nach Wegfall des Hindernisses (BGH VIII ZR 220/05); lag die Rechnung schon vor Ablauf der Frist vor, ist die Verspätung in der Regel zu vertreten.`
      if (carry.frozenPart) {
        // #251, R-2 und R-4: Der eingefrorene Teil weicht vom heutigen ab. Liegt er darüber, haben die Mieter jener
        // Abrechnung zu viel getragen (eine Berichtigung zu ihren Gunsten ist nach § 556 Abs. 3 Satz 3 BGB im
        // Umkehrschluss jederzeit zulässig); liegt er darunter, kann der Vermieter den Rest nur dort nachfordern.
        const { frozen, today } = carry.frozenPart
        if (frozen > today) {
          warn('fuel.reduced-after-close',
            `${where}: Die Rechnung ${name} ergibt heute ${fmtCents(carry.totalCents)}. Die abgeschlossene Abrechnung ${other.label} enthält dafür ${fmtCents(frozen)}; heute entfielen auf sie ${fmtCents(today)}. ` +
              `Ihre Mieter haben damit ${fmtCents(frozen - today)} zu viel getragen. Öffnen Sie die Abrechnung ${other.label} wieder und schließen Sie sie neu ab. ` +
              '§ 556 Abs. 3 Satz 3 BGB schließt nach Ablauf der Abrechnungsfrist nur Nachforderungen des Vermieters aus; eine Berichtigung zugunsten der Mieter verbietet er nicht (Umkehrschluss). Bis dahin steht der Betrag bei Ihnen.',
            subject)
        } else {
          warn('fuel.closed-period-part',
            `${where}: Der Teil der Rechnung ${name} für ${periodLabel(carry.other)} beträgt heute ${fmtCents(today)}; die abgeschlossene Abrechnung ${other.label} enthält dafür ${fmtCents(frozen)}. ` +
              `Die Differenz von ${fmtCents(today - frozen)} gehört in jene Abrechnung; bis Sie sie nachfordern, steht sie bei Ihnen. ${nachfordern}`,
            subject)
        }
        continue
      }
      if (carry.landlord.some((p) => p.reason === 'fuelClosedPeriod') && X < 0) {
        // #251: Der Teil einer Gutschrift gehört den Mietern der abgeschlossenen Abrechnung; nachzufordern ist nichts,
        // und die Frist des § 556 Abs. 3 BGB betrifft nur Nachforderungen (Umkehrschluss aus Satz 3).
        warn('fuel.closed-period-part',
          `${where}: Der Teil der Gutschrift ${name} für ${periodLabel(carry.other)} (${fmtCents(-X)}) gehört den Mietern der abgeschlossenen Abrechnung ${other.label}. Bis Sie ihn dort gutschreiben, steht er bei Ihnen. ` +
            'Eine Berichtigung zugunsten der Mieter ist jederzeit zulässig (Umkehrschluss aus § 556 Abs. 3 Satz 3 BGB).',
          subject)
        continue
      }
      if (carry.landlord.some((p) => p.reason === 'fuelClosedPeriod')) {
        // Zwei Lagen (Nachprüfung, M-b): ohne Schätzung abgeschlossen, oder abgeschlossen, als die
        // Lieferung noch keine Position hatte (mit 0 eingefroren).
        const lead = carry.zeroFrozenCancelled
          ? `Als die Abrechnung ${other.label} abgeschlossen wurde, ergaben die Positionen der Rechnung ${name} zusammen 0 € (storniert). Ihr Teil für ${periodLabel(carry.other)} (${fmtCents(X)}) ist dort deshalb nicht verteilt; bis Sie ihn nachfordern, steht er bei Ihnen. `
          : carry.zeroFrozen
          ? `Als die Abrechnung ${other.label} abgeschlossen wurde, war die Rechnung ${name} noch mit keiner Position verknüpft. Ihr Teil für ${periodLabel(carry.other)} (${fmtCents(X)}) ist dort deshalb nicht verteilt; bis Sie ihn nachfordern, steht er bei Ihnen. `
          : `Der Teil der Rechnung ${name} für ${periodLabel(carry.other)} (${fmtCents(X)}) gehört in die Abrechnung ${other.label}, die ohne Schätzung abgeschlossen wurde; bis Sie ihn nachfordern, steht er bei Ihnen. `
        warn('fuel.closed-period-part', `${where}: ${lead}${nachfordern}`, subject)
        continue
      }
      const diff = carry.landlord.find((p) => p.reason === 'fuelEstimateDiff')?.cents ?? 0
      if (!carry.estimate || diff === 0) continue
      const E = carry.estimate.cents
      // Durchsicht #277, S2: Hat jene Heizperiode daneben einen (negativen) Teil der Lieferung verteilt, nennt der Satz ihn,
      // sonst ginge die Rechnung nicht auf.
      const part = carry.estimateFrozenPart
      const schaetzung = part === undefined
        ? `war ${fmtCents(E)} geschätzt;`
        : `waren ${fmtCents(E)} geschätzt und aus der Lieferung ${name} ${fmtCents(part)} verteilt, zusammen ${fmtCents(E + part)};`
      if (diff > 0) {
        // § 556 Abs. 3 Satz 2 und 3 BGB: Vor Fristablauf ist eine Berichtigung möglich (Umkehrschluss
        // aus BGH VIII ZR 115/04); danach nur ohne Vertretenmüssen (BGH VIII ZR 264/12) und alsbald
        // (BGH VIII ZR 220/05). Ohne Stichtag (`asOf`) gilt die Frist als offen.
        const past = options.asOf !== undefined && options.asOf > other.deadline
        warn('fuel.estimate-settled',
          `${where}: Die Rechnung ${name} ist da. Für ${periodLabel(carry.other)} ${schaetzung} tatsächlich entfallen ${fmtCents(X)}. Die Differenz von ${fmtCents(diff)} steht bei Ihnen. ` +
            (past
              ? `Die Frist der Abrechnung ${other.label} ist am ${fmtDay(other.deadline)} abgelaufen. Nachfordern dürfen Sie nur, wenn Sie die Verspätung nicht zu vertreten haben (§ 556 Abs. 3 Satz 3 BGB, BGH VIII ZR 264/12), und dann alsbald, in der Regel binnen drei Monaten nach Wegfall des Hindernisses (BGH VIII ZR 220/05). Lag die Rechnung schon vor Ablauf der Frist vor, ist die Verspätung in der Regel zu vertreten.`
              : `Nachfordern können Sie mit einer berichtigten Abrechnung ${other.label}; sie muss den Mietern bis ${fmtDay(other.deadline)} zugehen (§ 556 Abs. 3 Satz 2 und 3 BGB). Öffnen Sie die Abrechnung dafür wieder.`),
          subject)
      } else {
        // Zu hoch geschätzt (A4, B9): Ein Rückzahlungsanspruch folgt daraus nicht sicher (Einwendungsfrist,
        // § 556 Abs. 3 Satz 5 und 6 BGB); eine Gutschrift ist jederzeit zulässig.
        // Je Mieter sein Anteil an den eingefrorenen Zeilen der Schätzung, je Schätzung mit dem Teil, den die
        // Rechnung abdeckt (`ratios`): Gutschrift = Zeile × ratio × (−diff) / E. Das ist genau, was er ohne die
        // Schätzung weniger getragen hätte, denn die echte Rechnung wäre nach demselben Schlüssel über dieselbe
        // Heizperiode verteilt worden, je Mietverhältnis nach seinen Tagen darin, gleich wann der Brennstoff
        // verbraucht wurde (Durchsicht #247, Runde 4: Die Aufteilung nach Mietzeit im abgedeckten Zeitraum aus
        // Runde 3 war falsch und ist zurückgenommen). Genähert ist es nur, wenn die Positionen der echten
        // Rechnung einen anderen Schlüssel haben als die Vorlage der Schätzung. Zeilen des Vermieters
        // (Leerstand) sind keine Mieterzeilen; ihren Teil nennt der Text als Rest (G-K2). Verteilt wird nach dem
        // Restverfahren, die Beträge ergeben zusammen nie mehr als die Abweichung.
        const est = carry.estimate
        const coveredAll = est.frozen.reduce((a, f, k) => a + f * (est.ratios[k] ?? 0), 0)
        const factor = coveredAll !== 0 ? -diff / coveredAll : 0
        const byTenant = new Map<string, { name: string; exact: number }>()
        for (const row of other.fuelRows) {
          const k = est.ids.findIndex((id) => row.costItemId.startsWith(`fuel:${id}:`))
          if (k < 0) continue
          const entry = byTenant.get(row.tenancyId) ?? { name: `${row.tenantName} (${row.unitName})`, exact: 0 }
          entry.exact += row.shareCents * (est.ratios[k] ?? 0) * factor
          byTenant.set(row.tenancyId, entry)
        }
        const entries = [...byTenant.entries()]
        const credit = Math.max(0, Math.min(-diff, Math.round(entries.reduce((a, [, e]) => a + e.exact, 0))))
        const credits = distributeCents(credit, entries.map(([key, e]) => ({ key, landlord: false, raw: e.exact })))
        const list = entries.flatMap(([, e], k) => ((credits[k] ?? 0) !== 0 ? [`${e.name} ${fmtCents(credits[k] ?? 0)}`] : []))
        const hier = list.length > 0 ? `, hier: ${andList(list)}` : ''
        // Durchsicht #247, Runde 5 (G-K2): Ist die Rechnung nach einem anderen Schlüssel verteilt als die Vorlage
        // der Schätzung, wäre sie anders auf die Mieter gefallen; die Beträge je Mieter sind dann nur genähert.
        // Verglichen werden die Schlüssel der Positionen, deren Zeilen eingefroren sind, mit denen der Rechnung;
        // eine inzwischen gelöschte Vorlage zählt nicht.
        const keyOf = (id: string) => fuel?.items.find((c) => c.id === id)?.key
        const templateKeys = new Set(other.fuelRows.filter((row) => est.ids.some((id) => row.costItemId.startsWith(`fuel:${id}:`))).map((row) => keyOf(row.costItemId.split(':').at(-1) ?? '')).filter((k) => k !== undefined))
        const invoiceKeys = new Set((fuel?.items ?? []).filter((c) => c.fuelDeliveryId === carry.deliveryId && c.amountCents !== 0).map((c) => c.key))
        const mixed = list.length > 0 && templateKeys.size > 0 && invoiceKeys.size > 0 && [...invoiceKeys].some((k) => !templateKeys.has(k) || templateKeys.size > 1)
        const naeherung = mixed ? 'Die Rechnung ist nach einem anderen Umlageschlüssel verteilt als die Schätzung; die Beträge je Mieter sind nach dem Schlüssel der Schätzung aufgeteilt und nur eine Näherung. Bitte prüfen Sie sie. ' : ''
        warn('fuel.estimate-overcharged',
          `${where}: Für ${periodLabel(carry.other)} ${schaetzung} tatsächlich entfallen nur ${fmtCents(X)}. ` +
            (credit === -diff
              ? `Die Mieter dieser Heizperiode haben ${fmtCents(-diff)} zu viel getragen${hier}. `
              : `Die Abweichung beträgt ${fmtCents(-diff)}; davon haben die Mieter dieser Heizperiode ${fmtCents(credit)} zu viel getragen${hier}. Der Rest lag bei Ihnen. `) +
            naeherung +
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
  // Wer selbst heizt (Heizung PR 19), trägt in den Heizkosten des Vermieters keine CO₂-Kosten und kürzt nicht nach
  // § 7 Abs. 4 CO2KostAufG; an die Stelle tritt die Erstattung nach § 6 Abs. 2 (Gegenprüfung M3).
  const selfSupplied = new Set(snapshot.tenancies.filter((t) => t.heatingModel === 'selfSupply').map((t) => t.id))
  const cutsOn = (ids: ReadonlySet<string>, pct: number): string => {
    const list = [...statements.values()].flatMap((st) => {
      if (selfSupplied.has(st.tenancyId)) return []
      const sum = st.rows.filter((r) => ids.has(r.costItemId)).reduce((a, r) => a + r.shareCents, 0)
      return sum > 0 ? [`${st.tenantName} (${st.unitName}) ${fmtCents(Math.round((sum * pct) / 100))}`] : []
    })
    return list.length > 0 ? `, hier: ${andList(list)}` : ''
  }
  // Die Grundlage einer Kürzung, wenn nach § 11 nur die Wärme ausgenommen ist (Durchsicht von #243, G-W2): je Mieter
  // sein Anteil am Topf Warmwasser der Anlagen, nach dem CO₂-Abzug (Entwurf 6.5). Bei der eigenen Abrechnung aus dem
  // Plan (Kosten des Topfs mal Gewicht, abzüglich seines CO₂-Abzugs im Topf); bei freien Schlüsseln die Positionen
  // mit Ziel Warmwasser. Eine Position für Heizung und Warmwasser mit freiem Schlüssel hat einen Anteil Warmwasser,
  // den Mietfuchs nicht kennt (`unknown`).
  const waterBaseOf = (plantIds: readonly string[], tenancyId: string): { cents: number; unknown: boolean } => {
    const st = statements.get(tenancyId)
    if (!st) return { cents: 0, unknown: false }
    let cents = 0
    let unknown = false
    for (const plantId of plantIds) {
      const pot = co2Pots.find((x) => x.plantId === plantId)
      if (!pot) continue
      const sp = selfPlans.get(plantId)
      const weights = sp?.weights ?? null
      if (sp && weights) {
        const w = sp.plan.units.flatMap((u) => u.users).filter((u) => u.tenancyId === tenancyId).reduce<SelfWeights>((a, u) => {
          const x = weights.get(u.key)
          return x ? { heating: a.heating + x.heating, water: a.water + x.water, both: a.both + x.both } : a
        }, { heating: 0, water: 0, both: 0 })
        cents += potCostOf(sp, pot.items, 'water') * w.water - potCo2Of(sp, pot.items, pot.reliefKey, tenancyId, w).water
      }
      for (const c of pot.items) {
        if (weights && c.key === 'heatingSystem') continue
        const sum = st.rows.filter((r) => r.costItemId === c.id).reduce((a, r) => a + r.shareCents, 0)
        if (sum === 0) continue
        if (c.heatingTarget === 'water') cents += sum
        else if (c.heatingTarget !== 'heating') unknown = true
      }
    }
    return { cents: Math.max(0, cents), unknown }
  }
  // Die Beträge auf den Anteil Warmwasser je Mieter, im Satz wie `cutsOn` (Durchsicht von #243, Runde 2). Kennt Mietfuchs
  // den Anteil an einer Position für Heizung und Warmwasser nicht, steht das dabei, ohne Betrag (G2-N-H2).
  const waterCutsOn = (plantIds: readonly string[], pct: number): string => {
    const list: string[] = []
    const unknown: string[] = []
    for (const st of statements.values()) {
      const b = waterBaseOf(plantIds, st.tenancyId)
      const c = Math.round((b.cents * pct) / 100)
      if (c > 0) list.push(`${st.tenantName} (${st.unitName}) ${fmtCents(c)}`)
      if (b.unknown) unknown.push(`${st.tenantName} (${st.unitName})`)
    }
    return `${list.length > 0 ? `, hier: ${andList(list)}` : ''}${unknown.length > 0 ? `; bei ${andList(unknown)} kommt der Anteil Warmwasser an Positionen für Heizung und Warmwasser hinzu, den Mietfuchs bei diesen Schlüsseln nicht kennt` : ''}`
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
  // Wie eine Abzugszeile heißt und unter welchem Grund sie beim Vermieter steht (Heizung PR 18): CO₂ nach
  // § 7 Abs. 1 oder Netzentgelte und Biobrennstoff nach § 7 Abs. 5 CO2KostAufG.
  type ReliefAs = { kind: 'co2Relief' | 'gmodgRelief'; key: string; label: string; keyLabel: string; reason: 'co2Share' | 'gmodgShare' }
  const bookReliefs = (
    pot: Co2Pot,
    raws: readonly { tenancyId: string; raw: number; approximated: boolean }[],
    shares: readonly ReliefShare[],
    printed: Map<string, { cents: number; approximated: boolean }>,
    text: { basis: (x: { approximated: boolean }) => string; steps: (x: { tenancyId: string; raw: number; approximated: boolean }, cents: number, share: number) => CalcStep[] },
    as?: ReliefAs,
  ): number => {
    const art: ReliefAs = as ?? { kind: 'co2Relief', key: pot.reliefKey, label: CO2_RELIEF_LABEL, keyLabel: 'CO₂-Kostenaufteilung', reason: 'co2Share' }
    const total = Math.round(raws.reduce((a, x) => a + x.raw, 0))
    const cents = distributeCents(total, raws.map((x) => ({ key: x.tenancyId, landlord: false, raw: x.raw })))
    raws.forEach((x, k) => {
      const c = cents[k] ?? 0
      const target = statements.get(x.tenancyId)
      if (c === 0 || !target) return
      const share = shares.find((y) => y.tenancyId === x.tenancyId)?.cents ?? 0
      target.rows.push({
        costItemId: art.key,
        kind: art.kind,
        category: HEATING_CATEGORY,
        description: art.label,
        totalCents: -total,
        keyLabel: art.keyLabel,
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
        costItemId: art.key, category: HEATING_CATEGORY, description: art.label, totalCents: total,
        keyLabel: art.keyLabel, shareCents: total, landlordParts: [{ reason: art.reason, cents: total }],
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
    new Map(periodUnits.filter((u) => plant !== undefined && servesUnit(plant, u) && isDwelling(u)).map((u) => [u.id, u.areaM2]))
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
  // ---------- §§ 5a, 5b, 5d CO2KostAufG (Heizung PR 18, #215) ----------
  // Je Topf: ob und wo in der Heizperiode § 5a greift, mit den Teilen aus dem Register (`incurred`), den
  // Lieferungen der Anlage und ihren Anteilen nach den Stufen 1–5 (Abweichung 2 des Plans). Vor dem ersten Tag
  // der Teilung wird nichts gefragt; sonst stünde § 5a im Rechtsstand jeder Abrechnung 2027.
  type PotHalf = {
    status: HalfSplitStatus
    two: TwoFamily
    applicable: DayRange[]
    piecesOf: (r: DayRange) => readonly Piece[]
    weigh: (r: DayRange) => number
    share: (id: string, r: DayRange) => number
    deliveries: (afterService: boolean, ownLines: readonly { deliveryId: string; sharePermille: number }[]) => HalfDelivery[]
    rules: { emergencyMonths: number | null; emergencyBefore: string | null; applicationFrom: string | null; maxDwellings: number | null }
    // Belieferung mit Gas (§ 5a Abs. 1 Nr. 1): nach dem Brennstoff, bei Contracting dem des Lieferanten
    // (`generatorEnergy`, Heizung PR 16), nicht nach der Energie der Abrechnung.
    gas: boolean
  }
  const NO_HALF: PotHalf = {
    status: { kind: 'none' }, two: { kind: 'notApplicable' }, applicable: [], piecesOf: () => [], weigh: () => 0, share: () => 0,
    deliveries: () => [], rules: { emergencyMonths: null, emergencyBefore: null, applicationFrom: null, maxDwellings: null }, gas: false,
  }
  const halfSplitOf = (plant: SnapshotHeatingPlant | undefined, h: DayRange): PotHalf => {
    const installed = plant?.gmodg43InstalledOn ?? null
    if (!plant || installed === null || h.to < halfSplitFirstDay()) return NO_HALF
    law(gmodgHeating43, { date: installed }, lawLog)
    const firstUse = plant.newBuildingFirstUse ?? null
    const newBuildings = firstUse !== null ? law(co2HalfSplitNewBuildings, { date: firstUse }, lawLog) : null
    const emergency = plant.emergencyInstall === true ? law(co2HalfSplitEmergency, { date: installed }, lawLog) : null
    const status = halfSplitStatus({
      gmodg43InstalledOn: installed, emergencyInstall: plant.emergencyInstall ?? null, emergencyPriorDuty: plant.emergencyPriorDuty ?? null,
      newBuildingFirstUse: firstUse, buildingApplicationBefore20260513: plant.buildingApplicationBefore20260513 ?? null,
    }, { newBuildings, emergency })
    // § 5d Abs. 3 (Abweichung 15): höchstens zwei Wohnungen, eine selbst bewohnt, beide an dieser zentralen
    // Anlage („gemeinsame Wärmeversorgung“). § 5d Abs. 4 je Mietverhältnis mit Tagen in H (Abweichung 3); der
    // angespannte Markt nach seiner Geltung (Abweichung 4).
    const dwellings = dwellerUnits.filter(isDwelling)
    const selfUsed = dwellings.some((u) => u.selfUsed === true && !u.participates)
    let two: TwoFamily = { kind: 'notApplicable' }
    let maxDwellings: number | null = null
    if (selfUsed && (plant.supply ?? 'central') === 'central' && status.kind === 'applies') {
      const prop = snapshot.property
      // Die Voraussetzungen lagen vor ab dem Einbau nach § 43 und, wenn eine Verordnung vor H endete, ab dem
      // Tag danach. Den Beginn der Eigennutzung kennt Mietfuchs nicht (Abweichung 3).
      const ended = prop?.tightMarket === true && prop.tightMarketTo != null && prop.tightMarketTo < h.from ? dayAfter(prop.tightMarketTo) : null
      const conditionsFrom = ended !== null && ended > installed ? ended : installed
      const dwellingIds = new Set(dwellings.map((u) => u.id))
      const tenancies = snapshot.tenancies
        .filter((t) => dwellingIds.has(t.unitId) && t.start <= h.to && (t.end === null || t.end >= h.from))
        .map((t) => ({ tenantName: t.tenantName, contractFrom: t.contractDate ?? t.start, noticeOn: t.halfSplitNoticeOn ?? null }))
      maxDwellings = law(co2HalfSplitTwoFamily, { period: h }, lawLog).maxDwellings
      two = twoFamilyOf({
        dwellings: dwellings.length, selfUsed, central: true, servesAll: dwellings.every((u) => servesUnit(plant, u)),
        tightMarket: tightMarketIn(prop, h), tenancies, conditionsFrom,
        deadline: settlementDeadline(h, law(bgbDeadlineMonths, { period: h }, lawLog)),
      }, maxDwellings, h.from)
    }
    const table = law(hkvDegreeDays, { period: lawPeriod }, lawLog)
    const weigh = (r: DayRange): number => degreeDayPermille([r], table)
    const piecesOf = (r: DayRange): readonly Piece[] =>
      law(co2HalfSplit, { period: r, weights: weigh }, lawLog).map(({ from, to, value }) => ({ from, to, value }))
    const entry = fuelResults.get(plant.id)
    const byId = new Map((snapshot.fuel?.deliveries ?? []).filter((d) => d.plantId === plant.id).map((d) => [d.id, d]))
    const share = (id: string, r: DayRange): number => {
      const d = byId.get(id)
      return d && entry ? deliveryShare(d, 0, r, entry.ctx, null).kgShare : 0
    }
    const deliveries = (afterService: boolean, ownLines: readonly { deliveryId: string; sharePermille: number }[]): HalfDelivery[] =>
      [...byId.values()].flatMap((d) => {
        if (afterService && !d.usedByService) return []
        const range = rangeOf(d)
        const base = range ? (afterService ? range : intersectRange(range, h)) : null
        const portion = afterService ? 1 : (ownLines.find((l) => l.deliveryId === d.id)?.sharePermille ?? 0) / 1000
        if (!base || portion <= 0) return []
        return [{ id: d.id, label: d.label, base, portion, co2Cents: d.co2CostCents, gridFeeCents: d.gridFeeCents ?? null, bioCostCents: d.bioCostCents ?? null }]
      })
    return {
      status, two,
      applicable: two.kind === 'excepted' ? [] : applicableRanges(status, h),
      piecesOf, weigh, share, deliveries,
      rules: { emergencyMonths: emergency?.windowMonths ?? null, emergencyBefore: emergency?.before ?? null, applicationFrom: newBuildings?.applicationFrom ?? null, maxDwellings },
      gas: generatorEnergy(plant) === 'gas',
    }
  }
  // Die Hinweise zu §§ 5a, 5b, 5d je Topf (Heizung PR 18, Entwurf 10.1): was gilt, ab wann und warum nicht.
  const halfSplitNotices = (pot: Co2Pot, half: PotHalf, byDays: readonly HalfSplitTerm[], where: string, plantSubject: NoticeSubject, ids: ReadonlySet<string>, hPeriod: DayRange, potPlant: SnapshotHeatingPlant | undefined): void => {
    if (half.status.kind === 'excluded') {
      warn('co2.half-split',
        `${where}: Für dieses Gebäude wurde der Bauantrag, der Antrag auf Zustimmung oder die Bauanzeige vor dem ${fmtDay(half.rules.applicationFrom ?? '')} gestellt. Dann gilt § 5b nicht, und es bleibt beim Stufenmodell (§ 5b Satz 2 CO2KostAufG).`,
        plantSubject)
      return
    }
    if (half.status.kind !== 'applies') return
    const s = half.status
    const cap = valueAt(co2HalfSplit, halfSplitBioFirstDay()).bioCapPermille ?? 0
    // Durchsicht K4: Im Neubau zählt die Inbetriebnahme; § 43 Abs. 1 GModG gilt dort nicht unmittelbar.
    const installedText = s.basis === 'newBuilding'
      ? `Die Gas-, Öl- oder Flüssiggasheizung ging am ${fmtDay(s.from)} in Betrieb; im Neubau gilt § 5a entsprechend (§ 5b CO2KostAufG). `
      : `Die Heizung wurde am ${fmtDay(s.from)} nach § 43 Abs. 1 GModG eingebaut. `
    // § 5d Abs. 3, 4: das Zweifamilienhaus mit Eigennutzung.
    const twoFamilyNotice = (): void => {
      const two = half.two
      if (two.kind === 'notApplicable') return
      const intro = `${where}: Sie bewohnen das Gebäude selbst, es hat höchstens ${two.kind === 'excepted' || two.kind === 'split' ? (half.rules.maxDwellings === 2 ? 'zwei' : String(half.rules.maxDwellings ?? '')) : ''} Wohnungen, und beide hängen an dieser Heizung.`
      const withSettlement = two.kind === 'excepted' ? two.notices.filter((n) => n.withSettlement).map((n) => n.tenantName) : []
      const text = two.kind === 'excepted'
        ? `${intro} Das Gebäude liegt nach Ihrer Angabe in dieser Heizperiode in keinem Gebiet, das eine Verordnung nach § 556d Abs. 2 Satz 1, § 558 Abs. 3 Satz 3 oder § 577a Abs. 2 Satz 2 BGB als angespannten Wohnungsmarkt bestimmt, und Sie haben das ${andList(two.notices.map((n) => `${n.tenantName} am ${fmtDay(n.noticeOn)}`))} in Textform mitgeteilt (dass die Mitteilung auch für Abs. 3 nötig ist, ist eine Auslegung; Mietfuchs verlangt sie, damit Sie sicher gehen). ` +
          (withSettlement.length > 0
            ? `Bei ${andList(withSettlement)} bestand der Mietvertrag schon, bevor die Voraussetzungen eintraten; dann reicht die Mitteilung bei der ersten Geltendmachung (§ 5d Abs. 4 Satz 2 CO2KostAufG); dafür genügt nach der Begründung in der Regel die Mitteilung mit dieser Abrechnung (BT-Drs. 21/7009, S. 156). Ist sie noch nicht zugegangen, legen Sie sie der Abrechnung in Textform bei. `
            : '') +
          'Dann tragen Sie nur die CO₂-Kosten nach dem Stufenmodell und keine Netzentgelte und keinen Biobrennstoff (§ 5d Abs. 3, 4 CO2KostAufG). Jeder neue Mieter muss die Mitteilung bei Abschluss seines Mietvertrags bekommen (§ 5d Abs. 4 Satz 1).'
        : two.reason === 'tightMarket'
          ? `${intro} Das Gebäude liegt nach Ihrer Angabe in dieser Heizperiode in einem Gebiet mit angespanntem Wohnungsmarkt; die Ausnahme des § 5d Abs. 3 gilt dann nicht (Satz 2), und es wird hälftig geteilt. Gilt die Verordnung nur für einen Teil der Heizperiode, teilt Mietfuchs trotzdem für die ganze hälftig (Festlegung).`
          : two.reason === 'tightMarketUnknown'
            ? `${intro} Ob das Gebäude in einem Gebiet liegt, das eine Verordnung zur Mietpreisbremse (§ 556d BGB), zur Kappungsgrenze (§ 558 Abs. 3 BGB) oder zur Kündigungssperrfrist (§ 577a Abs. 2 BGB) bestimmt, ist nicht angegeben; manche Verordnungen nennen nur Teile einer Gemeinde. Bis dahin teilt Mietfuchs hälftig; tragen Sie die Antwort beim Objekt ein, bei „ja“ mit der Geltung der Verordnung.`
            : [
              intro,
              two.missing.length > 0
                ? `Für ${andList(two.missing)} ist keine Mitteilung in Textform eingetragen; die Ausnahme setzt sie voraus (§ 5d Abs. 4; dass das auch für Abs. 3 gilt, ist eine Auslegung). Bestand der Mietvertrag schon, bevor die Voraussetzungen eintraten, genügt nach der Begründung in der Regel die Mitteilung mit dieser Abrechnung (Satz 2; BT-Drs. 21/7009, S. 156); tragen Sie dann am Mietverhältnis den Tag ein, an dem sie zugeht.`
                : '',
              two.late.length > 0
                ? `Die Mitteilung an ${andList(two.late.map((n) => `${n.tenantName} vom ${fmtDay(n.noticeOn)}`))} kam zu spät für diese Heizperiode; später mitgeteilte Umstände werden im jeweiligen Abrechnungszeitraum nicht berücksichtigt (§ 5d Abs. 4 Satz 4 CO2KostAufG). Mietfuchs liest das so, dass eine Mitteilung bei Abschluss des Mietvertrags spätestens vor Beginn der Heizperiode zugehen muss; das ist eine Auslegung. In dieser Heizperiode wird hälftig geteilt, ab der nächsten nicht mehr.`
                : '',
              'Mietfuchs wendet die Ausnahme nur an, wenn für jeden Mieter der Heizperiode eine rechtzeitige Mitteilung eingetragen ist (Festlegung).',
            ].filter((x) => x !== '').join(' ')
      warn('co2.half-split-two-family', text, plantSubject)
    }
    if (half.two.kind === 'excepted') {
      // Durchsicht M3: Unter der Ausnahme weder Teilungssatz noch Abzug samt Kürzung noch Vorrat.
      warn('co2.half-split',
        `${where}: ${installedText}` +
          'Die hälftige Teilung nach § 5a gilt hier wegen § 5d Abs. 3 CO2KostAufG nicht; Sie tragen nur die CO₂-Kosten nach dem Stufenmodell (siehe den Hinweis zum Zweifamilienhaus).',
        plantSubject)
      twoFamilyNotice()
      return
    }
    const parts: string[] = [
      `${where}: ${installedText}` +
        `Ab dem ${fmtDay(halfSplitFirstDay())} tragen Sie die Hälfte ${half.gas ? 'der Gasnetzentgelte und ' : ''}der CO₂-Kosten, ab dem ${fmtDay(halfSplitBioFirstDay())} auch die Hälfte der Kosten des Pflichtanteils an Biobrennstoff, höchstens für ${fmtNum(cap / 10)} % des verbrauchten Brennstoffs (§ 5a Abs. 3 CO2KostAufG).`,
    ]
    if (byDays.length > 0) {
      // Prüfung S11: die Lesart nach Anfall mit der Gegenstimme der Begründung.
      parts.push(`In dieser Heizperiode fallen nach Gradtagen ${fmtNum(termsWeight(byDays) * 100)} % der CO₂-Kosten in die Teilung. ` +
        '§ 5a Abs. 3 Nr. 2 nennt für die CO₂-Kosten nur den Stichtag. Mietfuchs teilt sie wie die Netzentgelte nach § 5a Abs. 1 nach Anfall. ' +
        'Das ist eine Auslegung: Die Gesetzesbegründung spricht von Abrechnungszeiträumen „ab dem 01. Januar 2028“ (BT-Drs. 21/6278, S. 124), was auch so verstanden werden kann, dass erst ein Zeitraum zählt, der an oder nach diesem Tag beginnt.')
    }
    for (const x of s.excluded) {
      const months = half.rules.emergencyMonths ?? 0
      parts.push(x.rule === 'emergency1'
        ? `Nach dem Einbau wegen eines irreparablen Ausfalls ruht die Teilung ${months} Monate, bis ${fmtDay(x.to)} (§ 5a Abs. 4 Satz 1 CO2KostAufG).`
        : x.rule === 'emergency2'
          ? `Weil für die ausgefallene Heizung beim Ausfall keine Pflicht nach § 43 Abs. 1 GModG bestand, ruht die Teilung während der Übergangszeit des § 43 Abs. 7 Satz 1 GModG, ${months} Monate ab dem Einbau, bis ${fmtDay(x.to)} (§ 5a Abs. 4 Satz 2 CO2KostAufG; so die Begründung, BT-Drs. 21/7009, S. 154; das ist eine Auslegung, der Wortlaut ist nicht eindeutig).`
          : `Weil für die ausgefallene Heizung beim Ausfall keine Pflicht nach § 43 Abs. 1 GModG bestand, ruht die Teilung ${months} Monate ab dem Einbau, bis ${fmtDay(x.to)} (§ 5a Abs. 4 Satz 3 CO2KostAufG).`)
    }
    if (s.emergencyBoundary) {
      // Prüfung S14 (Entwurf 15.1 Nr. 26).
      const months = half.rules.emergencyMonths ?? 0
      const before = fmtDay(half.rules.emergencyBefore ?? '')
      parts.push(`Die Heizung wurde genau ${months === 12 ? 'zwölf' : months} Monate vor dem ${before} eingebaut. § 5a Abs. 4 Satz 1 erfasst nach dem Wortlaut nur einen Einbau „weniger als zwölf Monate“ davor, die Gesetzesbegründung spricht von einer „Havarie im Verlauf des Jahres 2027“ (BT-Drs. 21/7009, S. 154). Mietfuchs teilt deshalb ab dem ${before} hälftig; das ist eine Auslegung.`)
    }
    if (s.assumed.includes('application')) {
      parts.push(`Ob der Bauantrag vor dem ${fmtDay(half.rules.applicationFrom ?? '')} gestellt wurde, ist nicht angegeben; dann gälte § 5b nicht. Bis zur Angabe teilt Mietfuchs hälftig.`)
    }
    if (s.assumed.includes('priorDuty')) {
      parts.push('Ob die ausgefallene Heizung eine Gas-, Öl- oder Flüssiggasheizung war, die nach dem Inkrafttreten des GModG in das bestehende Gebäude eingebaut wurde (dann galt für sie schon die Pflicht nach § 43 Abs. 1 GModG), ist nicht angegeben; davon hängt § 5a Abs. 4 ab. Bis zur Angabe teilt Mietfuchs hälftig.')
    }
    if (pot.method === 'service' || potPlant?.source === 'homeowners') {
      // Prüfung S10: Verpflichtet ist der Vermieter (§ 7 Abs. 5 Satz 1), nicht der Messdienst.
      const cut = law(co2CutMissing, { period: hPeriod }, lawLog)
      parts.push(`Die Hälfte ${half.gas ? 'der Netzentgelte und ' : ''}der Kosten des Biobrennstoffs müssen Sie von den Heizkosten abziehen, bevor verteilt wird (§ 7 Abs. 5 CO2KostAufG); rechnet ein Messdienst für Sie ab, prüfen Sie das in seiner Abrechnung. Fehlt es, darf jeder Mieter seinen Anteil an den Heizkosten um ${cut} % kürzen (§ 7 Abs. 5 Satz 3, Abs. 4 CO2KostAufG)${cutsOn(ids, cut)}.`)
    }
    if (potPlant?.contracting) {
      // Durchsicht S2: den Biobrennstoff muss der Contractor ausweisen (§ 3 Abs. 4), die Netzentgelte nicht.
      parts.push('Die Anlage betreibt ein Contractor; § 5a gilt auch dann (Begründung, BT-Drs. 21/6278, S. 124). ' +
        'Den Preisbestandteil für Biobrennstoff muss der Contractor ausweisen (§ 3 Abs. 1 Nr. 6, Abs. 4 CO2KostAufG).' +
        (half.gas ? ' Die Netzentgelte seiner Gaslieferung fordern Sie bei ihm an; eine Pflicht, sie Ihnen auszuweisen, nennt das Gesetz nicht.' : ''))
    }
    // Abweichung 12 des Plans; Prüfung M10 im Wortlaut der Gegenprüfung.
    parts.push('Für Mietverhältnisse über Räume, die keine Wohnräume sind, gilt die Teilung nicht (§ 5a Abs. 1: Wohnraummietverhältnisse); Mietfuchs behandelt alle Mietverhältnisse als Wohnraum. ' +
      'Bei einer Hybridheizung mit Gas-, Öl- oder Flüssiggaskessel gilt die Pflicht nach § 43 Abs. 1 GModG durch die Wärmepumpe oder die feste Biomasse als erfüllt (§ 43 Abs. 5, § 45 Abs. 2 GModG). Weil die Anlage trotzdem mit Gas, Öl oder Flüssiggas beschickt wird, wendet Mietfuchs § 5a CO2KostAufG an. Das ist eine Auslegung; ausdrücklich regeln Gesetz und Begründung diesen Fall nicht. ' +
      'Einen Härtefall nach § 5d Abs. 1 CO2KostAufG rechnet Mietfuchs nicht.')
    warn('co2.half-split', parts.join(' '), plantSubject)
    // Biobrennstoff aus dem Vorrat (Abweichung 10): rechnet dieser Stand nicht; der Vermieter muss es selbst tun.
    // Steht an jeder Lieferung der Anlage eine 0, ist im Tank kein Pflichtanteil, und es gibt nichts zu teilen
    // (Abweichung 9).
    // Durchsicht S3: Brennstoff, der vor dem Stichtag geliefert wurde, enthält keinen Pflichtanteil; gefragt
    // werden nur Lieferungen ab dann (oder ohne Datum). Sonst bliebe die Warnung an einer gesperrten Lieferung
    // einer abgeschlossenen Heizperiode ohne Ausweg stehen.
    const plantDeliveries = (snapshot.fuel?.deliveries ?? []).filter((d) => d.plantId === pot.plantId)
    const fromBioDay = plantDeliveries.filter((d) => {
      const on = d.deliveredAt ?? d.invoiceDate ?? d.invoiceTo
      return on === null || on >= halfSplitBioFirstDay()
    })
    const noBioInStock = plantDeliveries.length > 0 && fromBioDay.every((d) => d.bioCostCents === 0)
    if (isStockEnergy(pot.energy) && !noBioInStock && half.applicable.some((a) => a.to >= halfSplitBioFirstDay())) {
      const cut = law(co2CutMissing, { period: hPeriod }, lawLog)
      warn('co2.half-split-missing',
        `${where}: Ab dem ${fmtDay(halfSplitBioFirstDay())} tragen Sie die Hälfte der Kosten des Pflichtanteils an Biobrennstoff, höchstens für ${fmtNum(cap / 10)} % des verbrauchten Brennstoffs (§ 5a Abs. 1 Nr. 2, Abs. 3 Nr. 3 CO2KostAufG). Für Brennstoff aus dem Vorrat rechnet Mietfuchs diesen Anteil mit einer späteren Version. ` +
          `Ermitteln Sie ihn bis dahin selbst und ziehen Sie ihn in der Abrechnung ab; sonst darf jeder Mieter seinen Anteil an den Heizkosten um ${cut} % kürzen (§ 7 Abs. 5 Satz 3, Abs. 4 CO2KostAufG)${cutsOn(ids, cut)}. ` +
          `${BIO_ZERO_TEXT} Tragen Sie die 0 dann an jeder Lieferung ab dem ${fmtDay(halfSplitBioFirstDay())} beim Biobrennstoff ein; früher gelieferter Brennstoff enthält keinen Pflichtanteil.`,
        plantSubject)
    }
    twoFamilyNotice()
  }
  for (const pot of co2Pots) {
    // Ohne Positionen kein Topf, außer die Anlage hat Lieferungen (Heizung PR 7): Dann gehört ihre
    // Bewertung samt Lücken in die Abrechnung.
    if (pot.items.length === 0 && !fuelResults.has(pot.plantId) && !(stockOfPlant.get(pot.plantId)?.result.ok ?? false)) continue
    const st = pot.statement
    const hPeriod = { from: pot.period.from, to: pot.period.to }
    const where = `${pot.plantName ? `Heizanlage „${pot.plantName}“` : 'Heizanlage'}, Heizperiode ${periodLabel(pot.period)}`
    // Die Abzugszeilen nach § 7 Abs. 1 und Abs. 5 gehören zum Topf (Heizung PR 18, Prüfung M5): „nach Abzug“ (6.5)
    // meint beide.
    const ids = new Set<string>([...pot.items.map((c) => c.id), ...reliefKeysOf(pot)])
    const plantSubject: NoticeSubject = { kind: 'heatingCosts', id: pot.plantId }
    // Wärmelieferung (Heizung PR 16): Contracting und der Brennstoff des Lieferanten, für die Beschriftung.
    const billed = plants.find((x) => x.id === pot.plantId)
    const report: HeatingStatement = {
      plantId: pot.plantId, plantName: pot.plantName, energy: pot.energy, period: pot.period.key, from: pot.period.from, to: pot.period.to, co2: null,
      ...(billed?.contracting === true && billed.fuelEnergy !== undefined ? { contracting: true, fuelEnergy: billed.fuelEnergy } : {}),
    }
    heatingStatements.push(report)
    // Lieferungen, Abgrenzung, Überträge und Lücken dieser Heizperiode (Heizung PR 7).
    const fuelOf = fuelResults.get(pot.plantId)?.result
    if (fuelOf) {
      report.fuel = {
        coveragePermille: fuelOf.coveragePermille, emissionsKg: fuelOf.emissionsKg, co2Cents: fuelOf.co2Cents, deliveries: fuelOf.lines,
        carries: fuelOf.carries.map((c) => ({
          deliveryId: c.deliveryId, period: c.other.key, cents: c.cents,
          ...(c.kind === 'out' && c.cancelled === undefined ? { totalCents: c.totalCents } : {}),
          ...(c.kind === 'out' && c.cancelled === undefined && !c.frozenPart && c.landlord.some((p) => p.reason === 'fuelClosedPeriod') ? { landlordBorne: true as const } : {}),
          ...(c.kind === 'out' && c.frozenPart ? { bookedCents: c.frozenPart.frozen } : {}),
        })), gaps: fuelOf.gaps,
        ...(fuelOf.zeroInvoices.length > 0 ? { zeroInvoiceIds: fuelOf.zeroInvoices.map((z) => z.deliveryId) } : {}),
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
    if (potPlant && etsExemptPlant({ energy: pot.energy, districtEtsNew: potPlant.districtEtsNew === true })) {
      const ets = law(co2DistrictEtsNew, { period: hPeriod }, lawLog)
      etsExempt = true
      // Der Satz für die Abrechnung (Durchsicht von #233): warum hier nichts aufgeteilt wird.
      if (settledHere) {
        warn('co2.district-ets-exempt',
          `${where}: Die Wärme stammt nach Ihrer Angabe aus einer Anlage im Europäischen Emissionshandel, und das Gebäude wurde erstmals nach dem ${fmtDay(ets.connectedAfter)} an das Wärmenetz angeschlossen. Die CO₂-Kosten werden deshalb nicht aufgeteilt (§ 2 Abs. 4 Satz 2 CO2KostAufG).`,
          plantSubject)
      }
    }
    // Plausibilität der CO₂-Angaben je Rechnung, die diese Heizperiode berührt (Heizung PR 17, #97): nur ein
    // Hinweis, gerechnet wird mit den Angaben der Rechnung. Bei Wärme aus dem Emissionshandel mit Anschluss
    // nach dem Stichtag gilt das Gesetz nicht (etsExempt). Für Vorratsenergien dieselben Rechnungen, denn
    // auch dort stehen kg und CO₂-Kosten auf der Rechnung der Lieferung.
    // Unter einer Ausnahme nach § 11 ohne vereinbarte Abrechnung gilt das CO2KostAufG nicht (§ 2 Abs. 7, Heizung
    // PR 14): dann auch keine Prüfung, dieselbe Bedingung wie die Aufteilung.
    // Heizung PR 16: auch nicht bei Contracting mit einem Brennstoff ohne CO₂-Kosten (§ 2 Abs. 1 Satz 2 CO2KostAufG).
    // Nachprüfung von #272, N1: nur, wenn der Lieferant allein ohne CO₂-Kosten heizt und die Rechnung keine ausweist.
    // Die Zeilen der Abgrenzung gehören zur Heizperiode dieser Berechnung, also zu diesem Topf (F2): Eine Rechnung ganz
    // in einer anderen Heizperiode steht nicht darin.
    const invoiceCo2 = fuelResults.get(pot.plantId)?.result.lines.some((l) => (l.co2Cents ?? 0) > 0) ?? false
    const noCo2Fuel = noCo2Supplier(pot) && !invoiceCo2
    const co2Check: NonNullable<HeatingStatement['co2Check']> = { applies: !etsExempt && !noCo2Fuel && !co2OffByExemption(pot.plantId, String(pot.period.key)), exemption: null, findings: [] }
    report.co2Check = co2Check
    if (co2Check.applies) {
      // Eine stornierte Rechnung und eine Gutschrift ohne Rechnung (#251) zählen nicht und werden nicht geprüft
      // (Durchsicht von #246, G-K1); dieselbe Auswahl wie die Bewertung (fuel.ts).
      const ownDeliveries = (snapshot.fuel?.deliveries ?? []).filter((d) => d.plantId === pot.plantId)
      const cancelled = notInvoiceDeliveries(potPlant?.method ?? 'manual', ownDeliveries, snapshot.fuel?.items ?? [])
      for (const d of ownDeliveries) {
        if (cancelled.has(d.id)) continue
        const r = rangeOf(d)
        if (!r || r.from > pot.period.to || r.to < pot.period.from) continue
        const checked = co2Plausibility({
          ...d, invoiceDate: d.invoiceDate ?? null, quantity: d.quantity ?? null, quantityUnit: d.quantityUnit ?? null, energyKwh: d.energyKwh ?? null, gasBasis: d.gasBasis ?? null,
        }, pot.energy, lawLog)
        // Je Anlage und Heizperiode gibt es einen Topf; doppelt wird ein Befund nur über die Teilabrechnungen
        // nach Weg b, und deren Hinweise führt die Zusammenführung ohnehin nur einmal (Durchsicht von #246, K5 a).
        const texts = checked.map((f) => plausibilityText(f, fmtCents))
        co2Check.findings.push({ deliveryId: d.id, texts })
        for (const t of texts) warn('co2.cost-implausible', t, plantSubject)
      }
    }
    // Heizung PR 14: unter einer Ausnahme nach § 11 für Wärme und Warmwasser nicht, außer eine Abrechnung ist
    // vereinbart (§ 2 Abs. 7 CO2KostAufG).
    const applicable = !etsExempt && !co2OffByExemption(pot.plantId, String(pot.period.key)) && (st !== null || settledHere) && law(co2ApplicableFrom, { period: hPeriod }, lawLog)
    // Hälftige Teilung nach § 5a (Heizung PR 18): nur, wo das CO2KostAufG überhaupt gilt. Der Anteil der CO₂-Kosten
    // nach Gradtagen (ohne Lieferungen) dient der Nachstufung des Messdienstes, dem Hinweis und dem Vorrat
    // (Abweichung 2 des Plans).
    const half = applicable ? halfSplitOf(potPlant, hPeriod) : NO_HALF
    // § 5d Abs. 3 gilt unabhängig davon, wer verteilt (Durchsicht M2): auch beim Messdienst, für das Blatt.
    if (half.status.kind === 'applies' && half.two.kind !== 'notApplicable') report.halfSplitTwoFamily = half.two.kind
    const co2TermsByDays = termsFromPieces(half.piecesOf(hPeriod), half.applicable, half.weigh, (v) => v.co2Permille)
    if (co2OffByExemption(pot.plantId, String(pot.period.key)) && co2Deductions.has(pot.carrierId ?? '') && settledHere) {
      warn('co2.exempt-deducted',
        `${where}: Sie haben eine Ausnahme nach § 11 HeizkostenV für Wärme und Warmwasser angegeben und keine Abrechnung der Heiz- und Warmwasserkosten mit den Mietern vereinbart; dann ist das CO2KostAufG nicht anzuwenden (§ 2 Abs. 7 CO2KostAufG). ` +
          `Ihr Messdienst hat trotzdem CO₂-Kosten des Vermieters von ${fmtCents(st?.serviceLandlordCents ?? 0)} abgezogen. Mietfuchs übernimmt seine Beträge, wie sie dastehen; die Mieter tragen damit weniger, als ohne Aufteilung auf sie entfiele. ` +
          'Den Teil, der auf Ihre selbstgenutzte Wohnung entfällt, rechnet Mietfuchs zum Eigenanteil; in der Steuerübersicht ist er privat. Klären Sie mit dem Messdienst, ob die Ausnahme gilt.',
        plantSubject)
    }
    // Eigene Aufteilung (Heizung PR 7, Entwurf 7.6, 9): bei freien Schlüsseln aus den Lieferungen dieser
    // Heizperiode, beim Messdienst ohne Aufteilung aus den Rechnungen, die er angesetzt hat.
    // Nur für Brennstoffe, für die es Standardwerte nach § 7 Abs. 4 BEHG gibt (§ 2 Abs. 1 CO2KostAufG):
    // Gas, Heizöl, Flüssiggas, Kohle; Fernwärme nur, wenn die Rechnung CO₂-Kosten ausweist. Strom einer
    // Wärmepumpe ist kein solcher Brennstoff (Durchsicht von #233, C1).
    // Heizung PR 16: Bei Contracting mit einem Brennstoff ohne CO₂-Kosten (Pellets, Holz, Strom, Wärmepumpe), den der
    // Lieferant allein einsetzt, gibt es nichts aufzuteilen (`co2Required`). Erzeugt er die Wärme mit einem weiteren
    // Erzeuger (`mixed`) oder weist eine Rechnung dieser Heizperiode CO₂-Kosten über 0 aus (`invoiceCo2`), wird
    // aufgeteilt (Nachprüfung von #272, N1).
    const co2Relevant = (co2Required(pot) || invoiceCo2) && (CO2_FUELS.includes(pot.energy) || (pot.energy === 'districtHeating' && (fuelOf?.lines.some((l) => l.co2Cents !== null) ?? false)))
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
      // Hälftige Teilung (Heizung PR 18, Prüfung M4): Der Messdienst muss den Anteil nach Stufen (mit § 8, § 9) und die
      // Hälfte nach Anfall mischen; verglichen wird mit Toleranz, weil er die Mischzahl gerundet druckt.
      const halfByDays = co2TermsByDays.length > 0
      const expectedOf = (permille: number): number | null => (halfByDays ? blendedPermille(adjust(permille), co2TermsByDays) : adjust(permille))
      const re = restage(st, ranges, law(co2RoundingDecimals, { period: hPeriod }, lawLog), expectedOf, halfByDays ? HALF_SPLIT_TOLERANCE_PERMILLE : 0)
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
        // Abdeckung V14: Bei einer Eigentumswohnung rechnet die Gemeinschaft ab, und gemeint ist der eigene Anteil laut
        // Einzelabrechnung der Wohnung, nicht die Summe des Hauses.
        const homeowners = potPlant?.source === 'homeowners'
        const usersName = homeowners ? 'die Heizkosten Ihrer Wohnung laut Einzelabrechnung' : 'die Summe der Kosten aller Nutzer'
        const landlordName = homeowners ? 'den CO₂-Anteil des Vermieters für Ihre Wohnung' : 'den CO₂-Anteil des Vermieters'
        if (!pot.probe.ok && settledHere) {
          const names = andList(pot.serviceItems.map((c) => `„${c.description}“`))
          const lines = `${pot.serviceItems.length === 1 ? 'Ihre Position' : 'Ihre Positionen'} ${names} ${pot.serviceItems.length === 1 ? 'hat' : 'haben zusammen'} ${fmtCents(pot.probe.itemsCents)}. ` +
            `Mit Abzugszeile muss der Betrag ${usersName} (${fmtCents(S)}) plus ${landlordName} (${fmtCents(L)}) sein, also ${fmtCents(S + L)}; ohne Abzugszeile genau ${usersName}, ${fmtCents(S)}.` +
            (homeowners ? ' Gemeint ist der Anteil Ihrer Wohnung aus der Hausgeldabrechnung, nicht die Summe des ganzen Hauses.' : '')
          const entered = pot.probe.enteredOk
            ? ''
            : ` Die eingetragenen Einzel- und Eigenbeträge ergeben zusammen ${fmtCents(pot.probe.enteredCents)}, mehr als ${usersName} und der Rundungsspielraum von ${fmtCents(pot.probe.toleranceCents)}; steht der CO₂-Anteil Ihrer Wohnung schon im Eigenbetrag, tragen Sie dort nur den Betrag der Abrechnung ein.`
          const cut = law(co2CutMissing, { period: hPeriod }, lawLog)
          warn('co2.sum-check',
            `${where}: Die Probe der CO₂-Angaben geht nicht auf.${approxText} ${lines}${entered} Bis das geklärt ist, bucht Mietfuchs keine CO₂-Aufteilung, und die Mieter tragen ihre Einzelbeträge wie eingetragen. ` +
              (st.method === 'serviceShown'
                ? `Stimmt Ihre Antwort, dass die Abrechnung die CO₂-Kosten nur ausweist, tragen die Mieter auch den CO₂-Anteil des Vermieters von ${fmtCents(L)} mit; den dürfen Sie nicht auf sie umlegen, eine Vereinbarung, nach der der Mieter mehr als seinen Anteil trägt, ist unwirksam (§ 5 Abs. 2, § 6 Abs. 1 CO2KostAufG). `
                : '') +
              `Fehlt die Aufteilung auch in ${homeowners ? 'der Einzelabrechnung (Heizung) Ihrer Wohnung,' : 'der Abrechnung des Messdienstes, die die Mieter bekommen,'} darf jeder Mieter seinen Anteil an den Heizkosten um ${cut} % kürzen (§ 7 Abs. 4 CO2KostAufG)${cutsOn(ids, cut)}. ` +
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
        // Heizung PR 18 (Review Focus 5): Bei hälftiger Teilung nennt der Hinweis den erwarteten Mischanteil.
        const halfText = halfByDays && re.percentOk === false
          ? ` Ab dem ${fmtDay(halfSplitFirstDay())} wird bei dieser Heizung hälftig geteilt (§ 5a CO2KostAufG), für ${fmtNum(termsWeight(co2TermsByDays) * 100)} % der Heizperiode nach Gradtagen; erwartet ist deshalb ein Anteil des Vermieters von ${fmtNum((expectedOf(re.stage.landlordPercent * 10) ?? 0) / 10)} %.`
          : ''
        warn('co2.stage-mismatch',
          `${where}: Laut Abrechnung liegt der Ausstoß bei ${fmtNum(re.value)} kg CO₂ je m² und der Anteil des Vermieters bei ${laut} %.${stufe}${summe}${halfText} ` +
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
      // Heizung PR 16: bei Contracting nach dem Brennstoff des Lieferanten (§ 2 Abs. 1 Satz 2 CO2KostAufG).
      if (co2Required(pot)) {
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
      // § 5a Abs. 3 Nr. 2 (Heizung PR 18): die Teile mit hälftiger Teilung, nach den Lieferungen gewogen, ohne
      // CO₂-Kosten an den Lieferungen nach Gradtagen (Abweichung 2 des Plans). Bei der Etagenheizung mischt jede
      // Wohnung nach ihren eigenen Rechnungen (unten), `selfSplit` liefert dort den Anteil nach Stufen.
      const halfList = half.deliveries(afterService, fuelOf?.lines ?? [])
      const co2Terms: readonly HalfSplitTerm[] = halfList.some((d) => (d.co2Cents ?? 0) > 0)
        ? termsFromDeliveries(halfList, half.piecesOf, half.applicable, half.share, (v) => v.co2Permille)
        : co2TermsByDays
      const split = selfSplit({
        emissionsKg,
        co2Cents: C,
        areaM2: area,
        ranges,
        decimals: law(co2RoundingDecimals, { period: hPeriod }, lawLog),
        nonResidentialPermille: potPlant?.nonResidential ? law(co2NonResidential, { period: hPeriod }, lawLog) : null,
        restriction: restriction === 'none' ? null : { ...law(co2Restriction, { period: hPeriod }, lawLog), both: restriction === 'both' },
        halfSplit: perUnit ? [] : co2Terms,
        twoFamily: half.two.kind === 'excepted',
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
      // Netzentgelte und Biobrennstoff (§ 5a Abs. 1, 3, § 7 Abs. 5 CO2KostAufG, Heizung PR 18): Der Anteil des
      // Vermieters wird abgezogen und nach der Vereinbarung über die Heizkosten verteilt (§ 7 Abs. 5 Satz 2), also
      // wie die CO₂-Kosten nach dem Anteil am Brennstoff. Im Zweifamilienhaus mit Ausnahme nichts (§ 5d Abs. 3: „nur
      // die Kohlendioxidkosten“; `half.applicable` ist dann leer). Unabhängig davon, ob die CO₂-Aufteilung gebucht
      // ist: Auch ohne CO₂-Angaben bleiben die Netzentgelte zu teilen.
      const amounts = halfAmounts(halfList, half.piecesOf, half.applicable, half.share, half.gas)
      const halfRaw = amounts.gridFeeRaw + amounts.bioRaw
      let halfBooked = false
      const bookHalf = (perUnitList: readonly PerUnitFuel[] | null): void => {
        if (halfBooked || !(halfRaw > 0) || !(F > 0)) return
        halfBooked = true
        const deliveryUnit = new Map((snapshot.fuel?.deliveries ?? []).map((d) => [d.id, d.unitId ?? null]))
        const raws = perUnitList
          ? perUnitList.filter((u) => u.rented && u.fuelCents > 0).flatMap((u) => {
            const own = halfAmounts(halfList.filter((d) => deliveryUnit.get(d.id) === u.unitId), half.piecesOf, half.applicable, half.share, half.gas)
            const amount = own.gridFeeRaw + own.bioRaw
            return u.shares.map((s) => ({ tenancyId: s.tenancyId, raw: (amount * s.exact) / u.fuelCents, approximated: false }))
          })
          : reliefsByShare(halfRaw, shares, F).map((x) => ({ ...x, approximated: approx }))
        const gmodgShares = perUnitList
          ? perUnitList.flatMap((u) => u.shares.map((s) => ({ tenancyId: s.tenancyId, cents: Math.round(s.exact) })))
          : shares
        bookReliefs(pot, raws, gmodgShares, new Map(), {
          basis: () => (perUnitList ? 'nach Ihrem Anteil an den Heizkosten Ihrer Wohnung' : approx ? 'nach Ihrem Anteil an den Heizkosten' : 'nach Ihrem Anteil an den Brennstoffkosten'),
          steps: (x, c, share) => [
            { label: 'Anteil des Vermieters nach § 5a', value: `Netzentgelte ${fmtExactEuro(amounts.gridFeeRaw)} + Biobrennstoff ${fmtExactEuro(amounts.bioRaw)} = ${fmtExactEuro(halfRaw)}`, term: 'co2HalfSplit' },
            perUnitList
              ? { label: 'Ihr Teil davon', value: `${fmtExactEuro(x.raw)} nach den Rechnungen Ihrer Wohnung` }
              : { label: 'Ihr Teil davon', value: `${fmtExactEuro(halfRaw)} × ${fmtCents(share)} ÷ ${fmtCents(F)} = ${fmtExactEuro(x.raw)}` },
            { label: 'Ergebnis, auf Cent gerundet', value: fmtCents(-c) },
          ],
        }, { kind: 'gmodgRelief', key: gmodgKeyOf(pot.reliefKey), label: GMODG_RELIEF_LABEL, keyLabel: 'Kostenaufteilung nach § 5a', reason: 'gmodgShare' })
      }
      // Vor den Hinweisen mit Kürzungsbeträgen, denn die rechnen auf die Heizkosten nach beiden Abzügen (6.5).
      if (!perUnit) bookHalf(null)
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
        // Je Wohnung nach ihren eigenen Rechnungen (§ 5 Abs. 1 Satz 2; Heizung PR 18).
        const deliveryUnit = new Map((snapshot.fuel?.deliveries ?? []).map((d) => [d.id, d.unitId ?? null]))
        const permilleOf = (unitId: string): number => {
          const own = halfList.filter((d) => deliveryUnit.get(d.id) === unitId)
          return blendedPermille(permille, termsFromDeliveries(own, half.piecesOf, half.applicable, half.share, (v) => v.co2Permille)) ?? permille
        }
        const raws = perUnitReliefs(permilleOf, perUnit)
        const unitOf = new Map(raws.map((r) => [r.tenancyId, perUnit.find((x) => x.unitId === r.unitId)]))
        const perUnitShares: ReliefShare[] = raws.map((r) => ({ tenancyId: r.tenancyId, cents: Math.round(unitOf.get(r.tenancyId)?.shares.find((x) => x.tenancyId === r.tenancyId)?.exact ?? 0) }))
        perUnitBooked = 0
        if (raws.some((r) => r.raw > 0)) {
          perUnitBooked = bookReliefs(pot, raws.map((r) => ({ tenancyId: r.tenancyId, raw: r.raw, approximated: false })), perUnitShares, printed, {
            basis: () => 'nach Ihrem Anteil an den Heizkosten Ihrer Wohnung',
            steps: (x, c) => {
              const u = unitOf.get(x.tenancyId)
              const exact = u?.shares.find((y) => y.tenancyId === x.tenancyId)?.exact ?? 0
              const pu = u ? permilleOf(u.unitId) : permille
              const lu = ((u?.co2Cents ?? 0) * pu) / 1000
              return [
                { label: 'CO₂-Anteil des Vermieters für Ihre Wohnung', value: `${fmtCents(u?.co2Cents ?? 0)} × ${fmtNum(pu / 10)} % = ${fmtExactEuro(lu)}`, term: 'co2Split' },
                { label: 'Ihr Teil davon', value: `${fmtExactEuro(lu)} × ${fmtExactEuro(exact)} ÷ ${fmtCents(u?.fuelCents ?? 0)} = ${fmtExactEuro(x.raw)}` },
                { label: 'Ergebnis, auf Cent gerundet', value: fmtCents(-c) },
              ]
            },
          })
        }
        shares.splice(0, shares.length, ...perUnitShares)
        bookHalf(perUnit)
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
      const cut5a = law(co2CutMissing, { period: hPeriod }, lawLog)
      if (amounts.missingGrid.length > 0) {
        warn('co2.half-split-missing',
          `${where}: Für ${andList(amounts.missingGrid.map((l) => `„${l}“`))} fehlen die Netzentgelte. Ab dem ${fmtDay(halfSplitFirstDay())} tragen Sie bei dieser Heizung die Hälfte davon (§ 5a Abs. 1 Nr. 1, Abs. 3 CO2KostAufG). ` +
            `Ohne die Angabe lässt sich Ihr Anteil nicht abziehen, und jeder Mieter darf seinen Anteil an den Heizkosten um ${cut5a} % kürzen (§ 7 Abs. 5 Satz 3, Abs. 4 CO2KostAufG)${cutsOn(ids, cut5a)}. Tragen Sie die Netzentgelte laut Gasrechnung bei der Lieferung ein.`,
          plantSubject)
      }
      if (amounts.missingBio.length > 0) {
        const cap = valueAt(co2HalfSplit, halfSplitBioFirstDay()).bioCapPermille ?? 0
        warn('co2.half-split-missing',
          `${where}: Für ${andList(amounts.missingBio.map((l) => `„${l}“`))} fehlen die Kosten des Pflichtanteils an Biobrennstoff (Preisbestandteil nach § 3 Abs. 1 Nr. 6 CO2KostAufG). Ab dem ${fmtDay(halfSplitBioFirstDay())} tragen Sie die Hälfte davon, höchstens für ${fmtNum(cap / 10)} % des verbrauchten Brennstoffs (§ 5a Abs. 1 Nr. 2, Abs. 3 Nr. 3 CO2KostAufG). ` +
            `Ohne die Angabe darf jeder Mieter seinen Anteil an den Heizkosten um ${cut5a} % kürzen (§ 7 Abs. 5 Satz 3, Abs. 4 CO2KostAufG)${cutsOn(ids, cut5a)}. ${BIO_ZERO_TEXT}`,
          plantSubject)
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
            'Darauf können Sie sich nur berufen, wenn Sie den Mietern die Umstände nachweisen (§ 9 Abs. 3 CO2KostAufG); legen Sie den Nachweis der Abrechnung bei.' +
            // Heizung PR 18 (Abweichung 5 des Plans, Prüfung M6 im Wortlaut der Gegenprüfung).
            (split.adjustments.includes('halfSplit')
              ? ' Bei einer Heizung nach § 43 GModG kürzt Mietfuchs nur den Anteil nach Stufen, nicht die Hälfte nach § 5a, weil § 9 Abs. 1 CO2KostAufG den Anteil ‚nach § 5, 6, 7 oder 8‘ nennt und § 5a nicht. Das ist eine Auslegung zu Ihren Lasten. Ebenso vertretbar ist, dass § 9 auch diese Hälfte kürzt: Sie gilt ‚in Abweichung von § 5 Absatz 2‘ (§ 5a Abs. 3 Nr. 2), und § 6 Abs. 1 Satz 2 und Abs. 2 Satz 1 beziehen die Kosten nach § 5a Abs. 3 ausdrücklich ein.'
              : ''),
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
        // Ob die Fläche die gemeinsame mehrerer Anlagen eines Gebäudes ist (Nachprüfung von #246): das Blatt
        // für den Messdienst liest es, statt es aus einer Abweichung zu schließen. Kein Betrag hängt daran.
        areaScope: building.length > 0 ? 'building' : 'plant',
        // § 5a im Ausweis (Heizung PR 18, Entwurf 9.5); `null` beim Betrag, wenn eine Angabe fehlt.
        ...(half.status.kind === 'applies' ? {
          halfSplit: {
            co2SharePermille: termsWeight(co2Terms) * 1000,
            landlordGridFeeCents: amounts.missingGrid.length > 0 ? null : Math.round(amounts.gridFeeRaw),
            landlordBioCents: amounts.missingBio.length > 0 ? null : Math.round(amounts.bioRaw),
            basis: half.status.basis,
            twoFamily: half.two.kind === 'excepted' ? 'excepted' as const : half.two.kind === 'split' ? 'split' as const : null,
          },
        } : {}),
      }
    }
    // §§ 5a, 5b, 5d CO2KostAufG (Heizung PR 18): was gilt, ab wann und warum nicht.
    if (settledHere) halfSplitNotices(pot, half, co2TermsByDays, where, plantSubject, ids, hPeriod, potPlant)
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
    // Heizung PR 14: keine Kürzung nach § 12 Abs. 1 Satz 1 bei Ausnahme nach § 11 oder Vereinbarung nach § 2.
    if (settledHere && formulaMethod !== null && !noCutFor(pot.plantId, 'water', String(pot.period.key))) {
      const cut = law(hkvCutNotByConsumption, { period: hPeriod }, lawLog)
      warn('heating.dhw-not-metered',
        `${where}: ${selfFormula ? 'Die Wärme für das Warmwasser ist' : 'Laut Abrechnung wurde die Wärme für das Warmwasser'} mit einer Formel bestimmt und nicht mit einem Wärmezähler gemessen. ` +
          (formulaMethod === 'areaFormula'
            ? 'Die Heizkostenverordnung verlangt den Wärmezähler (§ 9 Abs. 2 Satz 1 HeizkostenV); die Formel nach der Wohnfläche ist nur erlaubt, wenn weder die Wärmemenge noch das Volumen des verbrauchten Warmwassers gemessen werden kann (§ 9 Abs. 2 Satz 4 HeizkostenV). '
            : 'Die Heizkostenverordnung verlangt den Wärmezähler (§ 9 Abs. 2 Satz 1 HeizkostenV); die Formel nach dem Warmwasserverbrauch ist nur erlaubt, wenn die Wärmemenge nur mit unzumutbar hohem Aufwand gemessen werden könnte (§ 9 Abs. 2 Satz 2 HeizkostenV). ') +
          (exemptionScopeOf(pot.plantId, String(pot.period.key)) === 'heat'
            // Durchsicht von #243, Runde 2 (G2-N-W1): Ist nur die Wärme ausgenommen, gelten die Vorschriften der Verordnung
            // nur für das Warmwasser; gekürzt werden darf nur, „soweit“ entgegen ihnen abgerechnet wird (§ 12 Abs. 1 Satz 1).
            // Runde 3 (N2-W1): Die Beschränkung ist eine Auslegung; der BGH kürzte im Fall ohne Ausnahme auf Wärme und
            // Warmwasser insgesamt, und dieser Betrag steht als Obergrenze dabei.
            ? `Sonst darf jeder Mieter seinen Anteil kürzen (§ 9 Abs. 2 Satz 1, § 12 Abs. 1 Satz 1 HeizkostenV). Der BGH hat dafür im Fall ohne Ausnahme die Kosten für Wärme und Warmwasser insgesamt um ${cut} % gekürzt (BGH, Urteil vom 12.01.2022, VIII ZR 151/20). ` +
              `Weil die Wärme nach Ihrer Angabe nach § 11 HeizkostenV ausgenommen ist, nennt Mietfuchs nur ${cut} % des Anteils am Warmwasser${waterCutsOn([pot.plantId], cut)}: Gekürzt werden darf nur, „soweit“ entgegen den Vorschriften der Verordnung abgerechnet wird (§ 12 Abs. 1 Satz 1), und für die ausgenommene Wärme gelten sie nicht (§ 11 Abs. 1). Das ist eine Auslegung von Mietfuchs, entschieden ist es nicht; ` +
              `bis zum Betrag auf Wärme und Warmwasser insgesamt ist eine Kürzung deshalb nicht ausgeschlossen${cutsOn(ids, cut).replace(', hier: ', ', das wären ')}. `
            : `Sonst darf jeder Mieter seinen gesamten Anteil an den Heiz- und Warmwasserkosten um ${cut} % kürzen (§ 9 Abs. 2 Satz 1, § 12 Abs. 1 Satz 1 HeizkostenV; BGH, Urteil vom 12.01.2022, VIII ZR 151/20)${cutsOn(ids, cut)}. `) +
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
  // ---------- Schätzung nach § 9a (Heizung PR 13, Entwurf 8.7, 10.1) ----------
  // Vor den übrigen Hinweisen der eigenen Abrechnung und auch bei einer Anlage, die nicht verteilt wird: Die
  // Schätzung steht in der Abrechnung, und der Vermieter soll sie sehen, sobald er sie eingetragen hat.
  const METHOD_TEXT: Record<HeatingEstimate['method'], string> = {
    previousPeriod: 'dem Verbrauch derselben Wohnung in einem vergleichbaren Zeitraum',
    comparableUnit: 'dem Verbrauch einer vergleichbaren Wohnung in diesem Zeitraum',
    buildingAverage: 'dem Durchschnitt des Gebäudes je m²',
  }
  // Der Grund nach § 9a Abs. 1 Satz 1 (Durchsicht von #242, R-I1).
  const CAUSE_TEXT: Record<HeatingEstimate['cause'], string> = {
    deviceFailure: 'Gerät ausgefallen', wrongReading: 'Gerät zeigt falsch an', readingImpossible: 'Ablesung nicht möglich', otherReason: 'anderer zwingender Grund',
  }
  const DEVICE_TEXT = { waerme: 'keinen Wärmezähler', hkv: 'keinen Heizkostenverteiler', warmwasser: 'keinen Warmwasserzähler' } as const
  // Ein Nutzer im Satz: der Mieter mit Namen, sonst die Zeit des Vermieters (Leerstand, Eigennutzung).
  const userName = (x: SelfUserPlan): string => (x.role === 'tenancy' ? x.label : `${x.label} (Vermieter)`)
  const amount = (v: number, unit: string) => `${fmtNum(Math.round(v * 1000) / 1000)} ${unit}`
  // Nach einem Kesseltausch rechnen beide Anlagen der Linie mit derselben Schätzung; ihre Hinweise stehen einmal je
  // Linie (Durchsicht von #242, G-M5). Abgeschlossen wird weiter je Anlage.
  const estimateNoticeSeen = new Set<string>()
  const firstInLine = (key: string): boolean => {
    if (estimateNoticeSeen.has(key)) return false
    estimateNoticeSeen.add(key)
    return true
  }
  for (const sp of selfPlans.values()) {
    const plant = sp.plant
    const root = lineRoot(plant, snapshot.heatingPlants ?? [])
    const where = `${plant.name ? `Heizanlage „${plant.name}“` : 'Heizanlage'}, Heizperiode ${label}`
    const subject: NoticeSubject = { kind: 'heatingCosts', id: plant.id }
    const potWord = (pot: SelfPot) => (pot === 'heating' ? 'für die Heizung' : 'für das Warmwasser')
    // Durchsicht von #242, G-I1: unter einer anderen Erfassung oder Einheit eingetragen; gerechnet wird sie nicht.
    for (const e of sp.staleEstimates) {
      if (!firstInLine(`${root}|stale|${e.plantId}|${e.unitId}|${e.part}`)) continue
      const pot = POT_OF_PART[e.part]
      const name = snapshot.units.find((u) => u.id === e.unitId)?.name ?? e.unitId
      const head = `${where}: Die Schätzung nach § 9a ${potWord(pot)} von ${name} wurde bei Erfassung ${CAPTURE_TEXT[e.capture]} in ${e.valueUnit} eingetragen; diese Heizperiode wird jetzt ${CAPTURE_TEXT[sp.capture]} in ${potUnitOf(sp, pot)} erfasst. `
      // Durchsicht Runde 2, N-I1: Ist die Wohnung ohne die Schätzung erfasst, gilt die Ablesung (Warnung); sonst ist
      // sie nicht erfasst (Fehler). Die Karte zeigt die veraltete Schätzung in beiden Fällen mit beiden Knöpfen.
      if (sp.plan.units.find((u) => u.unit.id === e.unitId)?.captured[pot]) {
        warn('heating.estimate-stale-unused',
          `${head}Sie wird nicht verwendet, gerechnet wird mit den Ablesungen von ${name}. Sie können die Schätzung auf der Seite Heizkosten unter „Schätzung (§ 9a)“ bei ${name} mit „Entfernen“ entfernen, oder mit „Schätzung neu eintragen“ neu eintragen, wenn das Gerät falsch anzeigt.`,
          subject)
      } else {
        warn('heating.estimate-stale',
          `${head}Mietfuchs rechnet die Schätzung deshalb nicht, und ${name} gilt als nicht erfasst. Wählen Sie auf der Seite Heizkosten unter „Schätzung (§ 9a)“ bei ${name} „Schätzung neu eintragen“.`,
          subject)
      }
    }
    for (const e of sp.estimates) {
      const pot = POT_OF_PART[e.part]
      const unit = sp.plan.units.find((u) => u.unit.id === e.unitId)
      if (!unit) continue
      // Je Schätzung, nicht je Wohnung (Durchsicht Runde 2, N-M2): Stehen in der Linie zwei, hat jede ihre Hinweise.
      const line = (code: string) => firstInLine(`${root}|${code}|${e.plantId}|${e.unitId}|${e.part}`)
      const unitOfPot = potShownUnit(sp, pot)
      const name = unit.unit.name
      const why = `${CAUSE_TEXT[e.cause]}; Begründung: „${e.reason}“`
      const headOf = (withWhy: boolean) => `${where}: Der Verbrauch ${potWord(pot)} von ${name} ist nach § 9a HeizkostenV geschätzt: ${amount(e.value, unitOfPot)} für die ganze Heizperiode nach ${basisUnitOf(sp, pot) === 'm³' ? METHOD_TEXT[e.method].replace('je m²', 'je m³') : METHOD_TEXT[e.method]}${withWhy ? ` (${why})` : ''}.`
      const head = headOf(true)
      // Prüfbericht A5 (Abweichung 3 des Plans): Nutzer mit gültiger Ablesung behalten ihren Verbrauch; die
      // übrigen tragen ihren Anteil an der Schätzung, mehrere unter sich wie nach § 9b Abs. 3.
      const takers = unit.users.filter((x) => x.pots[pot].estimated === true)
      const kept = unit.users.filter((x) => x.pots[pot].estimated !== true && x.pots[pot].value !== null)
      const timeWord = pot === 'heating' ? (sp.changeSplit === 'degreeDays' ? 'Gradtagen' : 'Tagen') : 'Tagen'
      const takerSum = takers.reduce((a, x) => a + (x.pots[pot].value ?? 0), 0)
      const keptSum = kept.reduce((a, x) => a + (x.pots[pot].value ?? 0), 0)
      // Durchsicht von #242, R-I4: Dass ein gültig abgelesener Nutzer seinen Wert behält, folgt aus Satz 1.
      const split =
        (kept.length > 0
          ? ` ${andList(kept.map(userName))} ${kept.length === 1 ? 'behält' : 'behalten'} den abgelesenen Verbrauch: § 9a Abs. 1 Satz 1 HeizkostenV erfasst nur den Verbrauch von Nutzern, der nicht ordnungsgemäß erfasst werden kann; für ${andList(takers.map(userName))} gilt der Anteil der Schätzung nach ${timeWord}: ${amount(takerSum, unitOfPot)}. ` +
            'Wie ein für die Wohnung geschätzter Verbrauch auf die übrigen Nutzer geht, regelt die Verordnung nicht (Festlegung von Mietfuchs, wie § 9b Abs. 3).'
          : '') +
        (takers.length > 1
          ? ` Auf ${andList(takers.map(userName))} ist der geschätzte Verbrauch nach ${timeWord} geteilt wie nach § 9b Abs. 3 HeizkostenV; die Verordnung regelt nicht, wie ein für die Wohnung geschätzter Verbrauch auf mehrere Nutzer geht, und Mietfuchs nimmt dafür ihre einzige Teilungsregel (Festlegung von Mietfuchs).`
          : '')
      // Durchsicht von #242, G-M6: Ohne behaltenen Wert ersetzt die Schätzung auch abgelesene Zeiten desselben Nutzers.
      const whole = unit.replacesMeasured[pot]
        ? ' Die Schätzung ersetzt den Verbrauch der ganzen Heizperiode, auch für Zeiten, die abgelesen sind; § 9a ermittelt den Verbrauch des Abrechnungszeitraums.'
        : ''
      // Durchsicht von #242, G-M1: Das Gerät ist inzwischen gelöscht. Die Schätzung zählt weiter (der Ausfall ist ihr Grund).
      const device = estimateDeviceType(sp.capture, e.part)
      if (device !== null && !snapshot.meters.some((m) => m.unitId === e.unitId && m.type === device && (m.heatingPlantId ?? null) === null) && line('no-device')) {
        warn('heating.estimate-no-device',
          `${where}: ${name} hat ${DEVICE_TEXT[device]} mehr, für die eine Schätzung nach § 9a ${potWord(pot)} steht. Die Schätzung zählt weiter. ` +
            '§ 9a setzt ein Gerät voraus, das den Verbrauch nicht ordnungsgemäß erfasst hat; wurde das defekte Gerät ausgebaut, legen Sie das neue auf der Seite Zähler an. Hatte die Wohnung nie ein Gerät, ist das kein Fall des § 9a, sondern der Ausstattungspflicht (§§ 4, 5 HeizkostenV).',
          subject)
      }
      // Durchsicht von #242, G-M2: Die Schätzung der ganzen Heizperiode liegt unter dem, was ein Nutzer bis zum Wechsel abgelesen hat.
      if (kept.length > 0 && keptSum > e.value && line('below-measured')) {
        warn('heating.estimate-below-measured',
          `${where}: Die Schätzung ${potWord(pot)} von ${name} (${amount(e.value, unitOfPot)} für die ganze Heizperiode) ist kleiner als der Verbrauch, den ${andList(kept.map(userName))} bis zum Wechsel abgelesen ${kept.length === 1 ? 'hat' : 'haben'} (${amount(keptSum, unitOfPot)}). ` +
            'Prüfen Sie die Schätzung; für die ganze Heizperiode der Wohnung ist sie wahrscheinlich zu niedrig.',
          subject)
      }
      if (!line('estimate')) continue
      const sameDay = unit.sameDayCovered[pot]
      if (unit.estimateComplete[pot] && sameDay.length > 0) {
        // Durchsicht von #242, G-M7: Zwei Stände am selben Tag sind ein Widerspruch, keine vollständige Ablesung.
        warn('heating.estimate-same-day',
          `${head} Für ${name} stehen am ${andList(sameDay.map(fmtDay))} zwei verschiedene Stände; welcher gilt, ist offen. Mietfuchs ersetzt deshalb den abgelesenen Verbrauch der ganzen Heizperiode durch die Schätzung. ` +
            `Ist einer der Stände nur ein Tippfehler, löschen oder berichtigen Sie ihn auf der Seite Zähler und entfernen Sie die Schätzung; dann gilt die Ablesung.${e.confirmed ? '' : ' Die Schätzung ist außerdem noch nicht bestätigt.'}`,
          subject)
        continue
      }
      if (unit.estimateComplete[pot]) {
        // Prüfbericht A9, Durchsicht von #242 R-I7: Die Ablesungen sind vollständig, und die Schätzung ersetzt sie. Bestätigt
        // heißt, der Vermieter hält sie für unbrauchbar; das färbt nicht mehr. Unbestätigt bleibt es eine Warnung.
        if (e.confirmed) {
          warn('heating.estimate-complete',
            `${headOf(false)} Die Ablesungen von ${name} sind vollständig; Mietfuchs ersetzt sie durch die Schätzung, weil Sie sie als unbrauchbar markiert haben (${why}). ` +
              'Das ist nur zulässig, wenn das Gerät den Verbrauch nicht ordnungsgemäß erfasst hat (§ 9a Abs. 1 HeizkostenV); bewahren Sie den Nachweis auf, etwa einen Prüfbericht.',
            subject)
        } else {
          warn('heating.estimate-unconfirmed',
            `${head} Die Ablesungen von ${name} sind vollständig, und die Schätzung ist noch nicht bestätigt. Neben vollständigen Ablesungen darf nur geschätzt werden, wenn das Gerät den Verbrauch nicht ordnungsgemäß erfasst hat (§ 9a Abs. 1 HeizkostenV), etwa weil es falsch anzeigt. ` +
              'Bestätigen Sie die Schätzung auf der Seite Heizkosten, oder entfernen Sie sie; dann gilt die Ablesung.',
            subject)
        }
        continue
      }
      if (!e.confirmed) {
        // Durchsicht von #242, R-I6: was der BGH entschieden hat, nicht als allgemeiner Leitsatz.
        warn('heating.estimate-unconfirmed',
          `${head}${split}${whole} Die Schätzung ist noch nicht bestätigt. Geschätzt werden darf nur, wenn der Verbrauch wegen Geräteausfalls oder aus einem anderen zwingenden Grund nicht ordnungsgemäß erfasst werden kann (§ 9a Abs. 1 HeizkostenV). ` +
            'Auch ein Ablesefehler ist ein solcher Grund, wenn sich der Wert nicht mehr ermitteln lässt; im entschiedenen Fall war die Ablesung nicht nachholbar (BGH VIII ZR 373/04). Lässt sich ein Wert noch ablesen, ist er abzulesen. ' +
            'Bestätigen Sie die Schätzung auf der Seite Heizkosten, oder tragen Sie die Ablesung nach und entfernen die Schätzung.',
          subject)
      } else {
        warn('heating.estimated',
          `${head}${split}${whole} Lässt sich der Wert doch noch ablesen, ist er abzulesen; entfernen Sie dann die Schätzung.`,
          subject)
      }
    }
    // § 9a Abs. 2: je Topf (Entwurf 15.1 Nr. 6). Keine Kürzung nach § 12 (15.1 Nr. 7, Auslegung; Durchsicht von
    // #242, R-I5 und R-I6).
    for (const p of sp.plan.pots) {
      const t = sp.plan.totals[p]
      if (!t.overThreshold || !firstInLine(`${root}|over|${p}`)) continue
      const limit = law(hkvEstimateThreshold, { period: lawPeriod }, lawLog)
      const cut = law(hkvCutNotByConsumption, { period: lawPeriod }, lawLog)
      // #322: Beim umbauten Raum ist der maßgebliche gesamte umbaute Raum die Grundlage (§ 9a Abs. 2 HeizkostenV).
      const raum = basisUnitOf(sp, p) === 'm³'
      warn('heating.estimate-over-25',
        `${where}: Geschätzt ist der Verbrauch ${potWord(p)} für ${fmtNum(t.estimatedArea)} von ${fmtNum(t.area)} ${raum ? 'm³' : 'm²'} (${fmtPercent((t.estimatedArea * 100) / t.area)} %). ` +
          `Das ${hkvEstimateThreshold.describe(limit)} ${raum ? 'des für die Verteilung maßgeblichen umbauten Raums' : 'der für die Verteilung maßgeblichen Fläche'}; die Kosten ${p === 'heating' ? 'der Heizung' : 'des Warmwassers'} werden deshalb ausschließlich nach ${raum ? 'umbautem Raum' : 'Fläche'} verteilt (§ 9a Abs. 2 HeizkostenV). ` +
          `Mietfuchs zählt dabei ${raum ? 'den ganzen umbauten Raum' : 'die ganze Fläche'} der Wohnung, auch wenn nur ein Teil der Heizperiode geschätzt ist, und prüft Heizung und Warmwasser getrennt; die Verordnung sagt dazu nichts Ausdrückliches, das ist eine Auslegung von Mietfuchs. ` +
          'Einen Kürzungsbetrag nach § 12 HeizkostenV nennt Mietfuchs nicht: Die Verteilung nach Fläche schreibt hier die Verordnung selbst vor, und § 12 Abs. 1 Satz 1 betrifft eine Abrechnung „entgegen den Vorschriften dieser Verordnung“. ' +
          `Für eine Abrechnung mit einem nach § 9a Abs. 1 ermittelten Verbrauch hat der BGH die Kürzung um ${cut} % verneint (BGH VIII ZR 373/04); für die Verteilung nach Abs. 2 ist das nicht ausdrücklich entschieden.`,
        subject)
    }
  }
  for (const sp of selfPlans.values()) {
    if (sp.weights === null || !sp.shares) continue
    const plant = sp.plant
    const where = `${plant.name ? `Heizanlage „${plant.name}“` : 'Heizanlage'}, Heizperiode ${label}`
    const subject: NoticeSubject = { kind: 'heatingCosts', id: plant.id }
    const pot = co2Pots.find((x) => x.plantId === plant.id)
    // Mit den Abzugszeilen nach § 7 Abs. 1 und 5 CO2KostAufG (Heizung PR 18, Prüfung M5).
    const ids = new Set<string>([...(pot?.items ?? []).map((c) => c.id), ...(pot ? reliefKeysOf(pot) : [])])
    // § 12 Abs. 3 (PR 10) oder § 11 Abs. 1 Nr. 3 Buchst. a a. F. (Heizung PR 11): keine Kürzungsbeträge.
    const notYet = sp.verdict?.kind === 'notYet' || sp.oldHeatPumpExemption
    // Heizung PR 14: auch nicht unter einer Vereinbarung nach § 2 und nicht für einen Topf, den eine Ausnahme nach
    // § 11 betrifft.
    const key = String(period.key)
    const noCutPots = (ps: readonly SelfPot[]): boolean => notYet || agreedFor(plant.id, key) !== null || (ps.length > 0 && ps.every((p) => exemptPot(plant.id, p, key)))
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
    // § 6a Abs. 3 HeizkostenV: seit Heizung PR 14 im Abschnitt „Pflichtangaben und Ausnahmen“ unten
    // (`heating.info-incomplete`), statt der Warnung `heating.self-6a-missing` aus der Durchsicht von #239.
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
      } else if (sp.agreedArea) {
        // Runde 3 (N2-H1): Unter einer Vereinbarung „nach Wohnfläche“ braucht die Verteilung keine Zwischenablesung; § 9b
        // Abs. 1 betrifft die Verteilung nach Verbrauch. Keine Pflicht, keine Frage.
        continue
      } else {
        const cut = law(hkvCutNotByConsumption, { period: lawPeriod }, lawLog)
        const noCut = noCutPots(f.pots)
        // Ist nur die Wärme ausgenommen, nur der Anteil Warmwasser (Durchsicht von #243, G-W2).
        const heatOnly = exemptionScopeOf(plant.id, key) === 'heat'
        const list = noCut ? [] : f.tenancyIds.flatMap((id) => {
          const c = heatOnly ? Math.round((waterBaseOf([plant.id], id).cents * cut) / 100) : cutOf(id, ids, cut)
          return c === null || c <= 0 ? [] : [`${nameOf(id)} ${fmtCents(c)}`]
        })
        warn('heating.no-interim-reading-missed',
          `${where}: Für den Wechsel in ${f.unitName} zum ${fmtDay(f.boundary)} gibt es keine Zwischenablesung` +
            `${f.status === null ? '; bitte geben Sie auf der Seite Heizkosten an, ob sie nicht möglich war oder nicht durchgeführt wurde' : ''}. ` +
            'Gerechnet wird nach § 9b Abs. 3 HeizkostenV, denn eine andere Rechnung gibt es nicht. Die Zwischenablesung war Pflicht (§ 9b Abs. 1). ' +
            (noCut
              ? 'Eine Kürzung nach der Heizkostenverordnung nennt Mietfuchs hier nicht, weil die Verordnung insoweit nicht gilt oder die Verteilung vereinbart ist.'
              : (list.length > 0 ? `Bis zu ${cut} % der ${heatOnly ? 'Warmwasserkosten' : 'Heizkosten'} von ${andList(list)} können gekürzt werden (LG Hamburg, 11 S 202/87); ` : `Bis zu ${cut} % können gekürzt werden (LG Hamburg, 11 S 202/87); `) +
                'nach AG Schöneberg, 104a C 226/05, ist die Umlage des Verbrauchsanteils angreifbar. Mietfuchs zieht nichts ab; die Kürzung muss der Mieter erklären.'),
          subject)
      }
    }
    // Kein Verbrauch erfasst (Entwurf 8.5): nur nach Fläche, 15 % (Abweichung 15 zur Grundlage).
    // Nach § 9a Abs. 2 nur nach Fläche: Das schreibt die Verordnung vor, kein Fall des § 12 (Durchsicht von #242, G-M3).
    const unmeasured = sp.plan.pots.filter((p) => !sp.plan.totals[p].measured && !sp.plan.totals[p].overThreshold && !exemptPot(plant.id, p, key))
    if (unmeasured.length > 0 && !noCutPots(unmeasured)) {
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
        `${where}: Für ${unmeasured.map((p) => POT_NAME[p]).join(' und ')} ist kein Verbrauch erfasst; Mietfuchs verteilt ${unmeasured.length === 1 ? 'diesen Teil' : 'die Kosten'} nur nach ${unmeasured.every((p) => basisUnitOf(sp, p) === 'm³') ? 'umbautem Raum' : unmeasured.some((p) => basisUnitOf(sp, p) === 'm³') ? 'umbautem Raum bzw. Fläche' : 'Fläche'}. ` +
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
    // Zeitanteilig statt nach Gradtagen und umgekehrt (§ 9b Abs. 2): beide Beträge (#314: auch für Leerstand und
    // Eigennutzung, deren Anteil der Vermieter trägt). Die Gewichte der anderen Teilung stehen in `sp.compare`.
    const own = (pot?.items ?? []).filter((c) => c.key === 'heatingSystem')
    const sumFor = (w: Map<string, SelfWeights>, key: string): number => own.reduce((a, c) => a + c.amountCents * (w.get(key)?.[c.heatingTarget ?? 'both'] ?? 0), 0)
    const GAP_NAME: Partial<Record<SelfUserPlan['role'], string>> = { vacancy: 'Leerstand', self: 'Eigennutzung', outside: 'Außerhalb der Abrechnungseinheit' }
    // Je Nutzer der Wohnungen die Beträge: erst die eingestellte Teilung, dann die andere.
    const splitList = (units: readonly SelfUnitPlan[], now: string, other: string): string[] => units.flatMap((unit) => unit.users).flatMap((u) => {
      if (!sp.weights || !sp.compare) return []
      const name = u.role === 'tenancy' && u.tenancyId ? nameOf(u.tenancyId) : GAP_NAME[u.role] ? `${GAP_NAME[u.role]} in ${sp.plan.units.find((x) => x.unit.id === u.unitId)?.unit.name ?? u.unitId} (${fmtDay(u.from)} bis ${fmtDay(u.to)})` : null
      return name === null ? [] : [`${name}: ${now} ${fmtCents(Math.round(sumFor(sp.weights, u.key)))}, ${other} ${fmtCents(Math.round(sumFor(sp.compare.weights, u.key)))}`]
    })
    const vacancyIn = (units: readonly SelfUnitPlan[]): boolean => units.some((x) => x.users.some((u) => u.role === 'vacancy'))
    const AGREEMENT = 'Eine abweichende Vereinbarung im Mietvertrag geht vor (§ 9b Abs. 4 HeizkostenV).'
    if (sp.changeSplit === 'time' && sp.compare) {
      const units = sp.plan.units.filter((u) => u.users.length > 1)
      const list = splitList(units, 'zeitanteilig', 'nach Gradtagen')
      if (list.length > 0) {
        warn('heating.change-split-time',
          `${where}: Beim Mieterwechsel teilen Sie die übrigen Heizkosten zeitanteilig. Die Heizkostenverordnung lässt auch die Gradtagszahlen zu, nach denen ein Wintermonat mehr wiegt als ein Sommermonat (§ 9b Abs. 2 HeizkostenV); beides ist zulässig. ${list.join('; ')}.` +
            `${vacancyIn(units) ? ' Den Leerstand teilt Mietfuchs wie einen Nutzerwechsel, denn für die leeren Räume sind Sie der Nutzer (Auslegung von Mietfuchs).' : ''} ${AGREEMENT}`,
          subject)
      }
    }
    // #314: nach Gradtagen bei Leerstand, Eigennutzung oder Wechsel ohne Zwischenablesung. Auskunft, nichts zu beheben
    // (`INFORMATIONAL`); ein gewöhnlicher Mieterwechsel mit Zwischenablesung bekommt sie nicht. Unter einer Vereinbarung
    // nach § 2 „nach Wohnfläche“ gilt § 9b nicht unmittelbar, dort schweigt sie (der Rechenweg nennt den Vergleich).
    // Dass der Vermieter Nutzer der leeren Räume ist, steht im Entwurf (Abschnitt 3.5, R-A16); eine Entscheidung, die
    // Gradtage für den Leerstand bejaht oder verneint, ist nicht bekannt, deshalb „Auslegung“.
    if (sp.changeSplit === 'degreeDays' && sp.compare && sp.compare.units.size > 0 && !sp.agreedArea) {
      const compared = sp.compare.units
      const units = sp.plan.units.filter((u) => compared.has(u.unit.id))
      const list = splitList(units, 'nach Gradtagen', 'zeitanteilig')
      const vacancy = vacancyIn(units)
      const group = units.some((x) => x.users.some((u) => u.pots.heating.group))
      if (list.length > 0) {
        warn('heating.change-split-degree-days',
          `${where}: Mietfuchs teilt die übrigen Heizkosten beim Wechsel der Nutzer einer Wohnung${vacancy ? ' und für den Leerstand' : ''} nach Gradtagszahlen, nach denen ein Wintermonat mehr wiegt als ein Sommermonat; zeitanteilig zu teilen ist ebenso zulässig (§ 9b Abs. 2 HeizkostenV).` +
            `${group ? ' Wo ohne Zwischenablesung gewechselt wurde, gilt das für die gesamten Kosten der Heizung (§ 9b Abs. 3 HeizkostenV).' : ''} ${list.join('; ')}.` +
            `${vacancy ? ' Für die leeren Räume sind Sie der Nutzer; dass Mietfuchs den Leerstand deshalb wie einen Nutzerwechsel teilt, ist eine Auslegung von Mietfuchs, entschieden ist die Frage nicht.' : ''} ` +
            `${AGREEMENT} Zeitanteilig teilen Sie, wenn Sie das an der Heizanlage einstellen; es gilt dann für alle Wohnungen.`,
          subject)
      }
    }
  }
  // ---------- Pflichtangaben und Ausnahmen (Heizung PR 14, #99, Entwurf 8.8, 8.9) ----------
  // Je Linie und Heizperiode einmal (nach einem Kesseltausch bekommen die Mieter eine Abrechnung): der Hinweis zur
  // Ausnahme nach § 11, die monatliche Verbrauchsinformation (§ 6a Abs. 1) und die Informationen nach § 6a
  // Abs. 3 bzw. 5, deren Ausweis an der Anlage hängt, die am Ende der Heizperiode heizt. Kürzungsbeträge je
  // Mieter auf seine gedruckten Zeilen nach dem CO₂-Abzug (Entwurf 6.5); Mietfuchs zieht nichts ab.
  const ITEM_TEXT: Record<InfoItem, string> = {
    '1a': 'der Anteil der eingesetzten Energieträger, bei Fernwärme mit den jährlichen Treibhausgasemissionen und dem Primärenergiefaktor des Netzes (Nr. 1 a)',
    '1b': 'die erhobenen Steuern, Abgaben und Zölle (Nr. 1 b)',
    '1c': 'die Entgelte für Erfassung, Ablesung und Abrechnung (Nr. 1 c)',
    '2': 'die Kontaktinformationen (Nr. 2)',
    '3': 'beim Verbrauchervertrag die Information zur Streitbeilegung (Nr. 3)',
    '4': 'der Vergleich mit einem normierten oder durch Vergleichstests ermittelten Durchschnittsnutzer (Nr. 4)',
    '5': 'der witterungsbereinigte Vergleich mit dem vorhergehenden Abrechnungszeitraum in grafischer Form (Nr. 5)',
  }
  const exemptionText = (e: HeatingExemption, hPeriod: Period): string => exemptionTextOf(e, hPeriod, lawLog)
  // Die Ausnahme, unter der das CO2KostAufG nicht gilt, im Wortlaut der Abrechnung (§ 2 Abs. 7 CO2KostAufG): für
  // das Blatt für den Messdienst, das sie liest statt sie herzuleiten (#246).
  for (const report of heatingStatements) {
    if (!report.co2Check || report.co2Check.applies) continue
    const key = String(report.period)
    report.co2Check.exemption = co2ExemptionOf(centralPlant(report.plantId), periodRulesFor(report.plantId, key), key, { from: report.from, to: report.to }, lawLog)
  }

  // Ist ein Gerät in der Heizperiode in Betrieb? Seine Ablesungen überdecken sie (wie bei Heizkostenverteilern,
  // Durchsicht von #241, C1), oder es hat noch keine; ein ausgebautes Gerät zählt nicht.
  const deviceInUse = (meterId: string, h: Period): boolean => !snapshot.readings.some((r) => r.meterId === meterId) || coversPeriod(meterId, snapshot.readings, h)
  const lineGroups = new Map<string, HeatingStatement[]>()
  for (const report of heatingStatements) {
    const plant = plants.find((p) => p.id === report.plantId)
    if (!plant || (plant.supply ?? 'central') !== 'central') continue
    const k = `${lineRoot(plant, plants)}|${report.period}`
    lineGroups.set(k, [...(lineGroups.get(k) ?? []), report])
  }
  // Satz 3 ist ein Kürzungsrecht: Lücken innerhalb des Satzes summieren sich nicht, nur Kürzungsrechte aus
  // verschiedenen Sätzen des § 12 Abs. 1 (BR-Drs. 643/21, S. 24 f., Durchsicht von #243, R-W4).
  const ONE_RIGHT = 'Das ist ein Kürzungsrecht, auch wenn mehrere Angaben fehlen und auch wenn die monatliche Verbrauchsinformation fehlt: § 12 Abs. 1 Satz 3 HeizkostenV erfasst alle Informationen nach § 6a, und es summieren sich nur Kürzungsrechte aus verschiedenen Sätzen des § 12 Abs. 1 (BR-Drs. 643/21, S. 24 f.).'
  for (const group of lineGroups.values()) {
    const first = group[0]
    if (!first) continue
    // Der Ausweis hängt an der Anlage, die am Ende der Heizperiode heizt.
    const host = group.find((r) => {
      const p = plants.find((x) => x.id === r.plantId)
      return !p?.endsOn || p.endsOn >= r.to
    }) ?? group[group.length - 1] ?? first
    const plant = plants.find((p) => p.id === host.plantId)
    if (!plant) continue
    const key = String(host.period)
    const hPeriod = { from: host.from, to: host.to }
    const pots = group.flatMap((r) => co2Pots.filter((x) => x.plantId === r.plantId))
    const potItems = pots.flatMap((x) => x.items)
    const ids = new Set<string>([...potItems.map((c) => c.id), ...pots.flatMap((x) => reliefKeysOf(x))])
    if (!settledOn(ids)) continue
    const where = `${plant.name ? `Heizanlage „${plant.name}“` : 'Heizanlage'}, Heizperiode ${pots[0] ? periodLabel(pots[0].period) : label}`
    const subject: NoticeSubject = { kind: 'heatingCosts', id: plant.id }
    const rules = periodRulesFor(plant.id, key)
    const scope = exemptionScopeOf(plant.id, key)
    const agreement = agreedFor(plant.id, key)
    const since = (from: string | null) => (from !== null && from !== key ? ` (angegeben ab der Heizperiode ${from.slice(0, 4)}${from.slice(5, 7) === '01' ? '' : `/${from.slice(5, 7)}`})` : '')
    // § 11 (Entwurf 8.9): Hinweis mit § 556a BGB und § 2 Abs. 7 CO2KostAufG, je Topf. Die CO₂-Sätze folgen dem, was
    // Mietfuchs rechnet (`co2OffByExemption`, Durchsicht von #243, R-W8).
    if (scope !== null) {
      warn('heating.exemption',
        `${where}: Sie haben angegeben, dass die Heizkostenverordnung für diese Anlage nach § 11 HeizkostenV nicht gilt${since(rules.fromPeriod.exemption)}: ${exemptionText(rules.exemption, hPeriod)}. ` +
          'Soweit die Ausnahme reicht, gelten ihre Vorschriften zur Erfassung, zur Verteilung und zu den Informationen nach § 6a nicht, und Mietfuchs nennt dafür keine Kürzung nach § 12 HeizkostenV. ' +
          'Verteilt wird dann nach dem Mietvertrag; ist dort nichts anderes vereinbart, nach der Wohnfläche, und Kosten, die von einem erfassten Verbrauch abhängen, nach einem Maßstab, der dem Verbrauch Rechnung trägt (§ 556a Abs. 1 BGB). Mietfuchs verteilt, wie Sie die Positionen erfasst haben. Bewahren Sie den Nachweis für die Ausnahme auf. ' +
          (scope === 'heat'
            ? 'Die Ausnahme betrifft nach Ihrer Angabe nur die Wärme. Für das Warmwasser gilt § 11 nur „entsprechend“ (Abs. 2), also mit eigener Prüfung; Mietfuchs rechnet das Warmwasser deshalb weiter nach der Verordnung ab, mit den Angaben nach § 6a und den Kürzungsrechten, und beziffert Kürzungen nur auf den Anteil Warmwasser. ' +
              'Die CO₂-Kosten teilt Mietfuchs weiter auf: Das CO2KostAufG gilt nach der Begründung nicht für Räume im Sinne von § 11 HeizkostenV, „in denen keine Heizkostenabrechnung durchgeführt wird“ (BT-Drs. 20/3172, S. 28, zu § 2 Abs. 6 des Entwurfs, heute § 2 Abs. 7 CO2KostAufG), und hier wird das Warmwasser nach der Verordnung abgerechnet. Dass das schon genügt, ist eine Auslegung von Mietfuchs. Betrifft die Ausnahme auch das Warmwasser, geben Sie das auf der Seite Heizkosten an. '
            : rules.exemptionBillingAgreed
              ? 'Weil Sie mit den Mietern eine Abrechnung der Heiz- und Warmwasserkosten vereinbart haben, teilt Mietfuchs die CO₂-Kosten nach dem CO2KostAufG auf (§ 2 Abs. 7 CO2KostAufG). '
              : 'Die CO₂-Kosten werden in diesem Fall nicht nach dem CO2KostAufG aufgeteilt (§ 2 Abs. 7 CO2KostAufG; nach der Begründung, soweit „keine Heizkostenabrechnung durchgeführt wird“, BT-Drs. 20/3172, S. 28), außer Sie haben mit den Mietern eine Abrechnung der Heiz- und Warmwasserkosten vereinbart; das geben Sie auf der Seite Heizkosten an. ') +
          'Die Verordnung stellt auf Räume ab; Mietfuchs wendet die Ausnahme auf die ganze Anlage an (Vereinfachung).',
        subject)
    }
    if (scope === 'both') continue
    // Gilt die Verordnung in diesem Zeitraum für die Wärmepumpe noch nicht (§ 12 Abs. 3) oder galt die Ausnahme des
    // § 11 Abs. 1 Nr. 3 Buchst. a a. F. (Heizung PR 10, PR 11), gibt es auch keine Informationen nach § 6a.
    const hostSp = selfPlans.get(host.plantId)
    if (hostSp && heatPumpWithoutMonthlyInfo({ verdict: hostSp.verdict, oldExemption: hostSp.oldHeatPumpExemption, majorityOpen: hostSp.majorityOpen })) continue
    const groupPlants = group.flatMap((r) => plants.filter((p) => p.id === r.plantId))
    const groupIds = groupPlants.map((p) => p.id)
    // Die Mieter, die über diese Anlage abgerechnet werden, und je Mieter die Grundlage einer Kürzung nach Satz 3:
    // seine gedruckten Zeilen nach dem CO₂-Abzug; ist nur die Wärme ausgenommen, nur sein Anteil am Warmwasser
    // (Durchsicht von #243, G-W2: für die Wärme gilt § 6a nach § 11 Abs. 1 nicht).
    const billed = [...statements.values()].filter((st) => st.rows.some((r) => ids.has(r.costItemId))).map((st) => st.tenancyId)
    const baseOf = (tenancyId: string): { cents: number; unknown: boolean } => {
      if (scope === 'heat') return waterBaseOf(groupIds, tenancyId)
      const st = statements.get(tenancyId)
      return { cents: st ? st.rows.filter((r) => ids.has(r.costItemId)).reduce((a, r) => a + r.shareCents, 0) : 0, unknown: false }
    }
    const amountsFor = (tenancyIds: readonly string[], pct: number): { list: string[]; unknown: string[] } => {
      const list: string[] = []
      const unknown: string[] = []
      for (const id of tenancyIds) {
        const b = baseOf(id)
        const c = Math.round((b.cents * pct) / 100)
        if (c > 0) list.push(`${nameOf(id)} ${fmtCents(c)}`)
        if (b.unknown) unknown.push(nameOf(id))
      }
      return { list, unknown }
    }
    const waterWord = scope === 'heat' ? ' am Warmwasser' : ' an den Heizkosten'
    const unknownText = (u: readonly string[]) => (u.length > 0
      ? ` Bei ${andList(u)} kommt der Anteil Warmwasser an den Positionen für Heizung und Warmwasser hinzu; den kennt Mietfuchs bei diesen Schlüsseln nicht, deshalb steht dafür kein Betrag.`
      : '')
    // Monatliche Verbrauchsinformation (§ 6a Abs. 1, 2): Sind fernablesbare Geräte eingebaut, auch beim Messdienst
    // und unter einer Vereinbarung nach § 2 (die regelt nur die Verteilung). Ist nur die Wärme ausgenommen, zählen
    // nur die Warmwassergeräte (Durchsicht von #243, R-K12). Gemeldet wird nur, was Mietfuchs weiß: ein Gerät, das
    // als fernablesbar eingetragen ist, oder die Angabe an der Anlage. Ohne Angabe schweigt der Hinweis, denn das
    // Anlegen einer Anlage ändert keinen Hinweis (Entwurf 11.2); auf die monatliche Information weist dann der Hinweis
    // zur Fernablesbarkeit hin (§ 5 Abs. 3). Das Register wird erst gefragt, wenn ein Gerät in Frage kommt.
    const devices = groupPlants.flatMap((p) => plantDevices(p, snapshot.meters, snapshot.units))
      .filter((m) => deviceInUse(m.id, hPeriod) && (scope !== 'heat' || m.type === 'warmwasser'))
    const known = devices.some((m) => m.remoteReadable === true) ||
      groupPlants.some((p) => p.devicesRemote === 'all' || (scope !== 'heat' && p.devicesRemote === 'partial'))
    const monthly = !rules.monthlyInfoElsewhere && known ? law(hkvMonthlyInfo, { period: hPeriod }, lawLog) : null
    // Informationen nach § 6a Abs. 3 und 5: nicht beim Messdienst (er liefert sie mit seiner Abrechnung), erst für
    // Zeiträume, die ab dem 01.12.2021 beginnen (`hkv.settlement-info`).
    const withInfo = plant.method !== 'service' && law(hkvSettlementInfo, { period: hPeriod }, lawLog)
    let info: HeatingInfoStatement | null = null
    if (withInfo) {
      const sp = group.map((r) => selfPlans.get(r.plantId)).find((x) => x !== undefined && x.plant.id === host.plantId) ?? group.map((r) => selfPlans.get(r.plantId)).find((x) => x !== undefined)
      const potsUnder: SelfPot[] = scope === 'heat' ? ['water'] : ['heating', 'water']
      // Beruht die Abrechnung auf dem Verbrauch? Das sagt, was Mietfuchs rechnet: die Schlüssel der Positionen, bei
      // der eigenen Abrechnung ihr Plan; verteilt sie nach einer Vereinbarung nach § 2 nach Fläche, nicht
      // (Durchsicht von #243, G-W3).
      const byKeys = potItems.some((c) => heatingByConsumption(c.key) && (c.key !== 'heatingSystem' || (sp !== undefined && !sp.agreedArea && planByConsumption(sp.plan, potsUnder))))
      const ownRow = (snapshot.heatingPeriodRows ?? []).find((r) => r.plantId === plant.id && String(r.period) === key)
      const lineRow = (k: string) => (snapshot.heatingPeriodRows ?? []).filter((r) => String(r.period) === k && groupPlants.concat(plants.filter((p) => lineRoot(p, plants) === lineRoot(plant, plants))).some((p) => p.id === r.plantId))
      const prevRows = sp?.prevPeriod ? lineRow(sp.prevPeriod.key) : []
      const prevFactor = prevRows.find((r) => (r.climateFactor ?? null) !== null)
      const kwhOfPlant = (id: string): number | null => {
        const lines = fuelResults.get(id)?.result.lines ?? []
        return lines.length > 0 && lines.every((l) => l.energyKwh !== null) ? lines.reduce((a, l) => a + (l.energyKwh ?? 0), 0) : null
      }
      // Heizung PR 16 (Prüfung C-M2): Werte des Wärmenetzes nur bei Fernwärme (§ 6a Abs. 3 Satz 1 Nr. 1 Buchst. a
      // HeizkostenV: „bei Nutzern, die mit Fernwärme aus Fernwärmesystemen versorgt werden“), nicht bei Contracting;
      // der eingesetzte Energieträger ist dort der Brennstoff des Kessels (`generatorEnergy`).
      const district = groupPlants.find((p) => p.energy === 'districtHeating' && p.contracting !== true)
      const districtSp = district ? selfPlans.get(district.id) : undefined
      const costShares = districtSp?.weights
        ? new Map(districtSp.plan.units.flatMap((u) => u.users.flatMap((x): [string, number][] => {
          const w = districtSp.weights?.get(x.key)
          return x.tenancyId && w ? [[x.tenancyId, w.both]] : []
        })))
        : undefined
      const metering = potItems.filter((c) => c.heatingPart === 'metering')
      info = heatingInfoOf({
        byConsumption: byKeys,
        carriers: groupPlants.map((p) => ({ energy: generatorEnergy(p), kwh: kwhOfPlant(p.id) })),
        mixedGeneration: groupPlants.some((p) => (p.heatGeneration ?? null) === 'mixed'),
        district: district ? { required: law(hkvInfoDistrict, { period: hPeriod }, lawLog).scope === 'largeOnly' ? 'maybe' : 'yes', deliveredKwh: kwhOfPlant(district.id) } : null,
        row: ownRow ? {
          infoTaxesText: ownRow.infoTaxesText ?? null, infoDistrictGhg: ownRow.infoDistrictGhg ?? null, infoDistrictPef: ownRow.infoDistrictPef ?? null,
          climateFactor: ownRow.climateFactor ?? null, climateFactorPrev: ownRow.climateFactorPrev ?? null, climateFactorSource: ownRow.climateFactorSource ?? null,
          infoReferenceKwhPerM2: ownRow.infoReferenceKwhPerM2 ?? null, infoReferenceSource: ownRow.infoReferenceSource ?? null,
          infoComparisonSource: ownRow.infoComparisonSource ?? null,
        } : null,
        prevClimateFactor: prevFactor && prevFactor.climateFactor !== null && prevFactor.climateFactor !== undefined ? { factor: prevFactor.climateFactor, source: prevFactor.climateFactorSource ?? null } : null,
        consumerContract: rules.consumerContract,
        meteringCents: metering.length > 0 ? metering.reduce((a, c) => a + c.amountCents, 0) : null,
        contacts: INFO_CONTACTS,
        contactsChecked: INFO_CONTACTS_CHECKED,
        plan: byKeys && sp ? sp.plan : null,
        prev: byKeys && sp ? sp.prev : null,
        prevPeriod: sp?.prevPeriod ? { from: sp.prevPeriod.from, to: sp.prevPeriod.to } : null,
        tenancies: snapshot.tenancies.map((t) => ({ id: t.id, start: t.start, end: t.end })),
        units: { heating: sp ? potShownUnit(sp, 'heating') : 'kWh', water: sp ? potShownUnit(sp, 'water') : 'm³' },
        periodDays: rangeOverlapDays(host.from, host.to, host.from, host.to),
        pots: potsUnder,
        ...(costShares ? { costShares } : {}),
        attachedCoversPrev: sp?.capture === 'serviceValues',
      })
      host.info = { ...info, tenancyIds: billed }
    }
    // Je Mieter, was ihm fehlt (Durchsicht von #243, R-W2): die Angaben zur Anlage allen, Nr. 4 und 5 nur dem, den es
    // betrifft. Kürzen darf „der Nutzer“, dem eine Information fehlt (§ 12 Abs. 1 Satz 3).
    const missingFor = (tenancyId: string): InfoItem[] => {
      if (!info) return []
      const u = info.users.find((x) => x.tenancyId === tenancyId)
      return u ? u.missing : (info.missingCommon ?? info.missing)
    }
    const infoCut = info ? billed.filter((id) => missingFor(id).length > 0) : []
    // Mieter im ersten Jahr, für die der Hinweis zu den Angaben „bis zu“ nennt (Runde 2, R2-N-K4): Ihr Betrag steht dort
    // und nicht ein zweites Mal bei der monatlichen Information.
    const firstYear = info && info.uncertain.includes('5') ? info.users.filter((u) => u.firstPeriod && !u.estimated).map((u) => u.tenancyId) : []
    const named = [...new Set([...infoCut, ...firstYear])].filter((id) => billed.includes(id))
    // Das Register erst fragen, wenn ein Hinweis den Satz braucht; sonst stünde er im Rechtsstand jeder Abrechnung
    // mit Heizanlage (Entwurf 1.2 Nr. 1).
    const cutNow = () => law(hkvCutInformation, { period: hPeriod }, lawLog)
    // Monatliche Verbrauchsinformation (Heizung PR 22): Bei eigener Abrechnung mit eigenen Zählern kennt Mietfuchs
    // die Geräte, erstellt die Information und nennt die Monate, die fehlen oder unvollständig sind. Nur, wenn ein
    // Gerät selbst als fernablesbar eingetragen ist; die Angabe an der Anlage allein sagt nicht, welche Wohnungen,
    // und bei Werten des Ablesedienstes erstellt dieser die Information (Prüfung M5, S6). Sonst bleibt der Hinweis
    // von PR 14.
    const selfMade = plant.method === 'self' && captureOf(plant, key) !== 'serviceValues' && devices.some((m) => m.remoteReadable === true)
    const lineIds = new Set(plants.filter((p) => lineRoot(p, plants) === lineRoot(plant, plants)).map((p) => p.id))
    const periodRows = (snapshot.heatingPeriodRows ?? []).filter((r) => lineIds.has(r.plantId) && String(r.period) === key)
    const months = monthly && monthly.coverage !== 'none' && selfMade
      ? monthlyInfoMonths({
          plants: groupPlants,
          meters: snapshot.meters,
          units: snapshot.units.map((u) => ({ id: u.id, name: u.name, areaM2: u.areaM2 || 0, noConnection: u.noConnection })),
          tenancies: snapshot.tenancies,
          readings: snapshot.readings,
          rows: (snapshot.monthlyInfoRows ?? []).filter((r) => lineIds.has(r.plantId)),
          dhwTempC: periodRows.find((r) => r.plantId === plant.id)?.dhwTempC ?? periodRows.find((r) => (r.dhwTempC ?? null) !== null)?.dhwTempC ?? null,
          h: hPeriod,
          parts: { heat: scope !== 'heat', water: hotWaterOf(plant, key) !== 'none' },
          ...(options.asOf !== undefined ? { asOf: options.asOf } : {}),
        }, lawLog)
      : null
    const open = months ? openMonths(months) : []
    if (monthly && monthly.coverage !== 'none' && months && open.length > 0) {
      const cut = cutNow()
      const openSet = new Set(open.map((o) => o.month))
      const openUsers = months.filter((m) => openSet.has(m.month)).flatMap((m) => m.users)
      // Ein Kürzungsrecht je Mieter, nicht je Monat (Prüfung M3); nur für die Mieter, die über die Anlage
      // abgerechnet werden.
      const affected = billed.filter((id) => open.some((o) => o.tenancyIds.includes(id)))
      // „um 3 %“ für den, dessen Wohnung ganz fernablesbar ausgestattet ist; die übrigen bei gemischter
      // Ausstattung mit Einzelfallprüfung (BR-Drs. 643/21, S. 18; Prüfung M8, S7).
      const remoteIds = affected.filter((id) => openUsers.filter((u) => u.tenancyId === id).every((u) => u.remote))
      const otherIds = affected.filter((id) => !remoteIds.includes(id))
      const mixed = months.some((m) => openSet.has(m.month) && m.mixed)
      const unknown: string[] = []
      const amountsOf = (ids: readonly string[]): string => {
        const a = amountsFor(ids.filter((id) => !named.includes(id)), cut)
        unknown.push(...a.unknown)
        return a.list.length > 0 ? `, hier: ${andList(a.list)}` : ''
      }
      const notSent = open.filter((o) => o.notSent).map((o) => o.month)
      // Monate mit denselben Lücken zu einer Spanne.
      const byGaps = new Map<string, { gaps: string[]; months: string[] }>()
      for (const o of open.filter((x) => x.gaps.length > 0)) {
        const k = o.gaps.join('|')
        const group = byGaps.get(k) ?? { gaps: o.gaps.map((g) => MONTHLY_INFO_GAP_TEXT[g]), months: [] }
        group.months.push(o.month)
        byGaps.set(k, group)
      }
      const incomplete = [...byGaps.values()].map((g) => `${monthRanges(g.months)} (${g.gaps.join('; ')})`)
      const cutText = (remoteIds.length > 0 || otherIds.length === 0
        ? `Fehlt die Information oder ist sie unvollständig, darf ${mixed ? 'ein Mieter, dessen Wohnung fernablesbar ausgestattet ist,' : 'jeder betroffene Mieter'} seinen Anteil${waterWord} um ${cut} % kürzen (§ 12 Abs. 1 Satz 3 HeizkostenV)${amountsOf(remoteIds)}. `
        : '') +
        (otherIds.length > 0
          ? `Bei ${andList(otherIds.map(nameOf))} ist die Wohnung nicht oder nur zum Teil fernablesbar ausgestattet; auch dort ist eine Kürzung um ${cut} % möglich${amountsOf(otherIds)}. `
          : '') +
        (mixed
          ? 'Sind im Haus nur einige Geräte fernablesbar, ist nach der Verordnungsbegründung im Einzelfall zu prüfen, ob die monatliche Information möglich und zumutbar ist (BR-Drs. 643/21, S. 18); dass Mietfuchs die Kürzung trotzdem nennt, ist eine Auslegung zu Ihren Lasten. '
          : '') +
        `Ob schon ein einzelner fehlender Monat die volle Kürzung erlaubt, ist nicht höchstrichterlich geklärt; Mietfuchs rechnet vorsorglich mit den vollen ${cut} % (Auslegung). `
      const namedHere = affected.filter((id) => named.includes(id))
      const namedText = namedHere.length === 0
        ? ''
        : namedHere.length === affected.length
          ? 'Die Beträge je Mieter stehen beim Hinweis zu den Angaben zur Heizkostenabrechnung. '
          : `Für ${andList(namedHere.map(nameOf))} stehen die Beträge beim Hinweis zu den Angaben zur Heizkostenabrechnung. `
      const unknownPart = unknownText(unknown)
      warn('heating.monthly-info',
        `${where}: Nach Ihren Angaben sind Zähler oder Heizkostenverteiler fernablesbar. Dann steht den Mietern seit dem ${fmtDay(monthly.validFrom ?? '')} jeden Monat eine Verbrauchsinformation zu (§ 6a Abs. 1 und 2 HeizkostenV): der Verbrauch des Monats in Kilowattstunden, der Vergleich mit dem Vormonat und dem entsprechenden Monat des Vorjahres, soweit diese Daten erhoben worden sind, und der Vergleich mit einem Durchschnittsnutzer derselben Nutzerkategorie. ` +
          'Mietfuchs verlangt sie für jeden Monat, auch außerhalb der Heizperiode: Die Verordnung sagt nur „monatlich“, das Vorblatt der Begründung nennt „während der Heizperiode“ (BR-Drs. 643/21); das ist eine vorsichtige Auslegung zu Ihren Lasten. ' +
          (notSent.length > 0 ? `Nicht als mitgeteilt vermerkt: ${monthRanges(notSent)}. ` : '') +
          (incomplete.length > 0 ? `Unvollständig: ${incomplete.join('; ')}. ` : '') +
          cutText + namedText + (unknownPart ? `${unknownPart.trim()} ` : '') +
          'Das ist dasselbe Kürzungsrecht wie bei fehlenden Angaben zur Heizkostenabrechnung und kommt nicht hinzu: Satz 3 erfasst alle Informationen nach § 6a, und es summieren sich nur Kürzungsrechte aus verschiedenen Sätzen des § 12 Abs. 1 (BR-Drs. 643/21, S. 24 f.). ' +
          'Mietfuchs erstellt die Information aus den Zählerständen am Monatsende auf der Seite Heizkosten in der Karte „Monatliche Verbrauchsinformation“; zukommen lassen müssen Sie sie den Mietern selbst, als Brief oder E-Mail, und dort vermerken, wann. ' +
          'Bekommen Ihre Mieter sie anders, etwa vom Messdienst als Brief oder E-Mail oder in einem Portal mit einer Nachricht jeden Monat, dass sie dort steht, bestätigen Sie das auf der Seite Heizkosten in der Karte „Ausnahmen und Vereinbarungen“. ' +
          'Ein Portal ohne diese Nachricht genügt nach der Begründung der Verordnung nicht: Mitgeteilt ist die Information erst, wenn sie den Mieter erreicht (BR-Drs. 643/21, S. 18 f.).',
        subject)
    }
    if (monthly && monthly.coverage !== 'none' && !months) {
      const cut = cutNow()
      // Dasselbe Kürzungsrecht wie bei den Angaben zur Abrechnung (R-W4): Die Beträge stehen einmal, beim Hinweis zu
      // den Angaben, wenn er sie für den Mieter nennt.
      const rest = billed.filter((id) => !named.includes(id))
      const a = amountsFor(rest, cut)
      const amounts = rest.length === 0
        ? ' Die Beträge je Mieter stehen beim Hinweis zu den Angaben zur Heizkostenabrechnung.'
        : `${a.list.length > 0 ? `, hier bis zu: ${andList(a.list)}` : ''}.${named.length > 0 ? ` Für ${andList(named.map(nameOf))} stehen die Beträge beim Hinweis zu den Angaben zur Heizkostenabrechnung.` : ''}${unknownText(a.unknown)}`
      warn('heating.monthly-info',
        `${where}: Nach Ihren Angaben sind Zähler oder Heizkostenverteiler fernablesbar. Dann stehen den Mietern seit dem ${fmtDay(monthly.validFrom ?? '')} monatliche Verbrauchsinformationen zu: der Verbrauch des letzten Monats in Kilowattstunden, der Vergleich mit dem Vormonat und dem entsprechenden Monat des Vorjahres, soweit diese Daten erhoben worden sind, und der Vergleich mit einem Durchschnittsnutzer (§ 6a Abs. 1 und 2 HeizkostenV). ` +
          `Fehlen sie, darf jeder Mieter seinen Anteil${waterWord} um bis zu ${cut} % kürzen (§ 12 Abs. 1 Satz 3 HeizkostenV)${rest.length === 0 ? '.' : ''}${amounts} ` +
          'Das ist dasselbe Kürzungsrecht wie bei fehlenden Angaben zur Heizkostenabrechnung und kommt nicht hinzu: Satz 3 erfasst alle Informationen nach § 6a, und es summieren sich nur Kürzungsrechte aus verschiedenen Sätzen des § 12 Abs. 1 (BR-Drs. 643/21, S. 24 f.). ' +
          (plant.method !== 'self' ? 'Mietfuchs erstellt diese Informationen nicht. ' : captureOf(plant, key) === 'serviceValues' ? 'Bei Werten des Ablesedienstes erstellt Mietfuchs diese Informationen nicht; meist liefert sie der Ablesedienst. ' : 'Tragen Sie bei den Zählern ein, welche fernablesbar sind; dann erstellt Mietfuchs die Information. ') +
          'Bekommen Ihre Mieter sie anders, etwa vom Messdienst als Brief oder E-Mail oder in einem Portal mit einer Nachricht jeden Monat, dass sie dort steht, bestätigen Sie das auf der Seite Heizkosten in der Karte „Ausnahmen und Vereinbarungen“. ' +
          'Ein Portal ohne diese Nachricht genügt nach der Begründung der Verordnung nicht: Mitgeteilt ist die Information erst, wenn sie den Mieter erreicht (BR-Drs. 643/21, S. 18 f.).',
        subject)
    }
    if (!info) continue
    const cut = cutNow()
    const parts: string[] = []
    if (info.missing.length > 0) {
      const a = amountsFor(infoCut, cut)
      const all = infoCut.length === billed.length
      parts.push(`Es fehlen: ${andList(info.missing.map((x) => ITEM_TEXT[x]))}${!all ? `, und zwar für ${andList(infoCut.map(nameOf))}` : ''}. ` +
        `Fehlt eine dieser Angaben, darf ${all ? 'jeder Mieter' : 'der Mieter, dem sie fehlt,'} seinen Anteil${waterWord} um ${cut} % kürzen (§ 12 Abs. 1 Satz 3 HeizkostenV)${a.list.length > 0 ? `, hier: ${andList(a.list)}` : ''}.${unknownText(a.unknown)} ${ONE_RIGHT}`)
    }
    if (info.missing.includes('1a')) {
      if (info.mixedGeneration) parts.push('Ihre Anlage erzeugt die Wärme mit einem weiteren Erzeuger; den Anteil der Energieträger (Nr. 1 a) kennt Mietfuchs dann nicht. Legen Sie ihn der Abrechnung bei.')
      else if (info.carriers.length > 1) parts.push('In dieser Heizperiode heizten nacheinander Anlagen mit verschiedenen Energieträgern; ihren Anteil rechnet Mietfuchs aus den Kilowattstunden der Rechnungen, und die fehlen. Tragen Sie die Kilowattstunden bei den Lieferungen ein oder legen Sie den Anteil der Abrechnung bei.')
      else if (info.district) parts.push('Bei Fernwärme tragen Sie den Faktor der Treibhausgasemissionen und den Primärenergiefaktor laut Versorger ein; die jährliche Menge rechnet Mietfuchs aus den Kilowattstunden der Lieferungen.')
    }
    if (info.uncertain.includes('1c')) {
      parts.push('Keine Position dieser Heizanlage trägt den Teil „Messdienst, Ablesung, Geräte“; die Entgelte für Erfassung, Ablesung und Abrechnung (Nr. 1 c) druckt Mietfuchs deshalb nicht. Sind solche Kosten angefallen, etwa Gerätemiete, Eichung oder Ablesung, ordnen Sie die Position auf der Seite Kosten diesem Teil zu; sind keine angefallen, ist nichts zu tun.')
    }
    // Nr. 4 und 5, wo Mietfuchs sie nicht rechnet (Durchsicht von #243, R-W1): offen, bis der Vermieter bestätigt, dass
    // der Vergleich des Ablesedienstes beiliegt.
    // „jeder übrige Mieter“ neben einem nach § 9a geschätzten (Runde 2, R2-N-K7).
    const anyEstimated = info.users.some((u) => u.estimated)
    const attach = `Legt Ihr Ablesedienst einen solchen Vergleich bei, bestätigen Sie das mit seiner Quelle in der Karte „Angaben zur Abrechnung (§ 6a)“; sonst darf ${anyEstimated ? 'jeder übrige Mieter' : 'jeder Mieter'} um bis zu ${cut} % kürzen.`
    if (!info.comparisons && info.scope === 'full' && info.uncertain.includes('4')) {
      parts.push(`Die Vergleiche nach Nr. 4 und 5 erstellt Mietfuchs nur bei eigener Heizkostenabrechnung. ${attach}`)
    } else if (info.uncertain.includes('4')) {
      parts.push(`${info.heatExempt
        ? 'Den Vergleich mit einem Durchschnittsnutzer (Nr. 4) rechnet Mietfuchs mit dem Wärmeverbrauch in kWh; für das Warmwasser allein kann es ihn nicht erstellen.'
        : 'Heizkostenverteiler zählen Einheiten, keine Kilowattstunden; den Vergleich mit einem Durchschnittsnutzer (Nr. 4) kann Mietfuchs deshalb nicht rechnen.'} ${attach}`)
    } else if (info.missing.includes('4')) {
      parts.push(info.reference === null
        ? 'Für den Vergleich mit einem Durchschnittsnutzer (Nr. 4) tragen Sie einen Vergleichswert in kWh je m² Wohnfläche mit seiner Quelle ein, etwa aus den Vergleichsdaten Ihres Ablesedienstes. Ein Durchschnitt aus Ihrem eigenen Haus ist kein zulässiger Vergleich: Gemeint sind nach der Begründung der Verordnung anonymisierte Verbraucher aus den Beständen der Ablesedienste (BR-Drs. 643/21, S. 19 und 21).'
        : 'Für eine Wohnung ohne Wohnfläche lässt sich der Vergleichswert (Nr. 4) nicht umrechnen; tragen Sie die Wohnfläche in den Stammdaten ein.')
    }
    if (info.comparisons && info.missing.includes('5')) {
      const unknownPrev = info.users.filter((u) => u.prevUnknown && u.missing.includes('5'))
      // Bei Werten des Ablesedienstes deckt die Bestätigung des beigelegten Vergleichs auch Nr. 5 (Runde 2, R2-N-W1).
      const sp5 = group.some((r) => selfPlans.get(r.plantId)?.capture === 'serviceValues')
      if (unknownPrev.length > 0) {
        parts.push(`Den Verbrauch von ${andList(unknownPrev.map((u) => nameOf(u.tenancyId)))} im vorhergehenden Abrechnungszeitraum kennt Mietfuchs nicht, weil er dort nicht vollständig oder anders erfasst ist. Legen Sie den Vergleich nach Nr. 5 der Abrechnung bei${sp5 ? ' und bestätigen Sie das mit seiner Quelle in der Karte „Angaben zur Abrechnung (§ 6a)“' : ''}.`)
      }
      if (info.users.some((u) => !u.firstPeriod && !u.prevUnknown && u.missing.includes('5')) && (info.climate.factor === null || info.climate.factorPrev === null)) {
        parts.push('Für den witterungsbereinigten Vergleich (Nr. 5) tragen Sie die Klimafaktoren dieser und der vorigen Heizperiode mit ihrer Quelle ein, etwa die Klimafaktoren des Deutschen Wetterdienstes zu Ihrer Postleitzahl.')
      }
    }
    // § 9a (Durchsicht von #243, R-W5): Für einen Mieter mit geschätztem Verbrauch gehören die Vergleiche nicht dazu.
    const estimated = info.users.filter((u) => u.estimated)
    if (estimated.length > 0) {
      parts.push(`Der Verbrauch von ${andList(estimated.map((u) => nameOf(u.tenancyId)))} ist nach § 9a HeizkostenV geschätzt. Abrechnungen in den Fällen des § 9a nimmt die Begründung der Verordnung von § 6a Abs. 3 aus: „Nicht darunter fallen also die Fälle des § 9a und Fälle, in denen eine Ausnahme gemäß § 11 greift“; für sie gelten mindestens die Angaben nach Abs. 5, also Nr. 2 und 3 (BR-Drs. 643/21, S. 19 und 22). ` +
        `Mietfuchs verlangt sie für ${estimated.length === 1 ? 'ihn' : 'sie'} deshalb nur in diesem Umfang und nennt für ${estimated.length === 1 ? 'ihn' : 'sie'} keine Kürzung wegen der Nr. 1, 4 und 5; den Vergleich druckt es mit dem geschätzten Wert gekennzeichnet. Dass das je Mieter gilt und nicht für die ganze Abrechnung, ist eine Auslegung von Mietfuchs; der Wortlaut der Verordnung nennt § 9a nicht ausdrücklich.`)
    }
    if (agreement !== null) parts.push('Eine Vereinbarung über die Verteilung nach § 2 HeizkostenV ersetzt die Informationspflichten nicht.')
    if (info.uncertain.includes('1a')) parts.push(`Bei einem Fernwärmesystem ab ${law(hkvInfoDistrict, { period: hPeriod }, lawLog).thresholdMw} MW gehören Treibhausgasemissionen und Primärenergiefaktor schon in diese Abrechnung; dann bis zu ${cut} %.`)
    if (info.uncertain.includes('3')) {
      // Durchsicht von #243, R-K5: beide Seiten des Verbrauchervertrags und die Liste beim Bundesamt für Justiz.
      parts.push(`${info.scope === 'minimal' ? 'Beruht die Abrechnung nicht auf dem Verbrauch, gehören zu ihr mindestens die Kontaktinformationen, die Mietfuchs druckt, und beim Verbrauchervertrag die Information zur Streitbeilegung (§ 6a Abs. 5 HeizkostenV). ' : ''}` +
        `Ist Ihr Mietvertrag ein Verbrauchervertrag (§ 310 Abs. 3 BGB: Sie vermieten als Unternehmer im Sinne des § 14 BGB, und der Mieter ist Verbraucher im Sinne des § 13 BGB), gehört die Information zur Streitbeilegung dazu; geben Sie an, ob das zutrifft. Fehlt sie, bis zu ${cut} %.`)
    }
    const firsts = info.users.filter((u) => u.firstPeriod && !u.estimated)
    if (info.uncertain.includes('5') && firsts.length > 0) {
      // Wer schon oben einen Betrag hat, bekommt hier keinen zweiten: dasselbe Kürzungsrecht (Runde 2, R2-N-K4).
      const a = amountsFor(firsts.map((u) => u.tenancyId).filter((id) => !infoCut.includes(id)), cut)
      parts.push(`${andList(firsts.map((u) => nameOf(u.tenancyId)))} ${firsts.length === 1 ? 'wohnte' : 'wohnten'} im vorhergehenden Abrechnungszeitraum noch nicht in der Wohnung; der Vergleich nach Nr. 5 ist für ${firsts.length === 1 ? 'ihn' : 'sie'} nicht möglich. Eine Ausnahme dafür nennt die Verordnung nicht; Mietfuchs nennt deshalb bis zu ${cut} % (Auslegung von Mietfuchs)${a.list.length > 0 ? `: ${andList(a.list)}` : ''}. Das ist dasselbe Kürzungsrecht wie bei den übrigen Angaben und der monatlichen Verbrauchsinformation, nicht ein zusätzliches.`)
    }
    if (parts.length > 0) {
      warn(infoCut.length > 0 ? 'heating.info-incomplete' : 'heating.info-open',
        `${where}: Zur Heizkostenabrechnung gehören die Informationen nach § 6a ${info.scope === 'full' ? 'Abs. 3' : 'Abs. 5'} HeizkostenV. ${parts.join(' ')} Tragen Sie die Angaben auf der Seite Heizkosten in der Karte „Angaben zur Abrechnung (§ 6a)“ ein. Mietfuchs zieht nichts ab; die Kürzung muss der Mieter erklären.`,
        subject)
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
  // Wer eine Position trägt: die Abrechnungen mit einer Zeile daraus.
  const bearersOf = (id: string): Statement[] => [...statements.values()].filter((st) => st.rows.some((r) => r.costItemId === id && r.shareCents !== 0))
  // Heizpositionen, die nur Mieter tragen, die selbst heizen (Heizung PR 19, Prüfung M3): Wartung oder Betriebsstrom
  // einer Etagenheizung oder einer zentralen Heizung, deren Brennstoff der Mieter selbst bezieht. Darin stecken keine
  // CO₂-Kosten des Vermieters, also auch keine Kürzung nach § 7 Abs. 4; an die Stelle tritt § 6 Abs. 2.
  const selfOnly = (c: SnapshotCostItem): boolean => {
    const bearers = bearersOf(c.id)
    return bearers.length > 0 && bearers.every((st) => selfSupplied.has(st.tenancyId))
  }
  const selfSupplyItems = items.filter((c) => c.category === HEATING_CATEGORY && c.amountCents !== 0 && !inPots.has(c.id) && !spanning.has(c.id) && !c.heatingPlantId && selfOnly(c))
  if (selfSupplyItems.length > 0 && law(co2ApplicableFrom, { period: lawPeriod }, lawLog)) {
    const names = andList(selfSupplyItems.map((c) => `„${c.description}“`))
    const one = selfSupplyItems.length === 1
    warn('co2.self-supply-items',
      `${names} ${one ? 'betrifft' : 'betreffen'} eine Heizung, deren Brennstoff oder Wärme der Mieter selbst bezieht. Darin stecken keine CO₂-Kosten, die Sie aufteilen müssten; eine Kürzung nach § 7 Abs. 4 CO2KostAufG kommt dafür nicht in Betracht. ` +
        'Ihren Anteil an den CO₂-Kosten des Mieters erstatten Sie ihm, wenn er ihn nach § 6 Abs. 2 CO2KostAufG in Textform verlangt; erfassen Sie seine Anzeige auf der Seite Kosten unter „CO₂-Erstattung“.',
      itemSubject(selfSupplyItems[0] ?? { id: '' }))
  }
  // Gemischt (Prüfung M3): Wer selbst heizt, trägt zugleich eine Position einer Heizanlage, deren Brennstoff oder
  // Wärme der Vermieter bezieht. Das deckt Mietfuchs nicht ab; gerechnet wird wie erfasst.
  const conflicts = new Map<string, string[]>()
  // Abdeckung V27: Hängt der Mieter an einer zentralen Anlage, bezieht er bei eigenem Vertrag den Brennstoff des ganzen
  // Hauses; dafür legt die Einrichtung keine Anlage an (client/src/heatingForm.ts, CENTRAL_SELF_SUPPLY).
  const viaCentral = new Set<string>()
  for (const c of items) {
    if (c.category !== HEATING_CATEGORY || !c.heatingPlantId) continue
    const central = plants.find((p) => p.id === c.heatingPlantId)?.supply !== 'perUnit'
    for (const st of bearersOf(c.id)) {
      if (!selfSupplied.has(st.tenancyId)) continue
      conflicts.set(st.tenancyId, [...(conflicts.get(st.tenancyId) ?? []), c.description])
      if (central) viaCentral.add(st.tenancyId)
    }
  }
  for (const [tenancyId, descriptions] of conflicts) {
    const st = statements.get(tenancyId)
    if (!st) continue
    const selfWay = viaCentral.has(tenancyId)
      ? 'Bezieht er den Brennstoff dieser zentralen Heizung über einen eigenen Vertrag, legen Sie dafür keine Heizanlage an: Entfernen Sie die Heizanlage in den Stammdaten in der Karte „Heizung“ mit „Entfernen …“ (die Heizpositionen bleiben, nur ohne Anlage), ' +
        'klicken Sie dann auf „Heizung einrichten“ und wählen Sie bei „Wer hat den Liefervertrag für den Brennstoff?“ „Der Mieter, der alle angeschlossenen Wohnungen gemietet hat“.'
      : 'Bezieht er den Brennstoff selbst, nehmen Sie seine Wohnung aus der Heizanlage.'
    warn('co2.self-supply-mixed',
      `${st.tenantName} (${st.unitName}) ist in den Stammdaten auf „Mieter heizt selbst“ gestellt, trägt aber einen Anteil an ${andList([...new Set(descriptions)].map((d) => `„${d}“`))} einer Heizanlage, deren Brennstoff oder Wärme Sie beziehen. ` +
        `Beides zugleich deckt Mietfuchs nicht ab; gerechnet wird wie erfasst, ohne CO₂-Kürzung für diesen Mieter. Heizt der Mieter über Ihre Heizanlage, stellen Sie sein Mietverhältnis unter Heizung auf „Abrechnung“. ${selfWay}`,
      { kind: 'tenancy', id: tenancyId })
  }
  const loose = items.filter((c) => c.category === HEATING_CATEGORY && c.amountCents !== 0 && !inPots.has(c.id) && !spanning.has(c.id) && !selfSupplyItems.includes(c))
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
      'Richten Sie unter Stammdaten die Heizung ein; dann sagt Mietfuchs, was zu tun ist. ' +
      // Heizung PR 19: Wer selbst heizt, ist von diesem Hinweis ausgenommen, sobald das Mietverhältnis es sagt.
      'Bezieht der Mieter Brennstoff oder Wärme über einen eigenen Vertrag, etwa für eine Gastherme in der Wohnung, stellen Sie sein Mietverhältnis unter Heizung auf „Mieter heizt selbst“; dann entfällt die Kürzung.'
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
  // Heizung PR 14: Eine Anlage, deren Wärme und Warmwasser nach § 11 ausgenommen sind, fällt nicht unter § 5;
  // sind alle Anlagen des Objekts so ausgenommen, gibt es keinen Hinweis. Eine Vereinbarung nach § 2 lässt die
  // Pflicht unberührt.
  const remotePlants = (snapshot.heatingPlants ?? []).filter((p) => exemptionScopeOf(p.id, String(period.key)) !== 'both')
  const allExempt = (snapshot.heatingPlants ?? []).length > 0 && remotePlants.length === 0
  // Ist nach § 11 nur die Wärme ausgenommen, zählen nur die Warmwassergeräte, und gekürzt wird nur der Anteil
  // Warmwasser (Durchsicht von #243, G-W2, R-K12).
  const heatOnlyPlants = new Set(remotePlants.filter((p) => exemptionScopeOf(p.id, String(period.key)) === 'heat').map((p) => p.id))
  const remote = heatingBilledItem && !allExempt ? remoteReadingVerdict(remotePlants, snapshot.meters, snapshot.units, lawPeriod, lawLog, heatOnlyPlants) : null
  const retrofit = heatingBilledItem && !allExempt && (remote === null || remote.level === 'unknown') ? law(hkvRemoteReadingRetrofit, { period: lawPeriod }, lawLog) : null
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
    const heatOnlyItems = new Set(co2Pots.filter((x) => heatOnlyPlants.has(x.plantId)).flatMap((x) => [...x.items.map((c) => c.id), ...reliefKeysOf(x)]))
    let remoteUnknown = false
    const cuts = [...statements.values()].filter((st) => served.has(st.unitId)).flatMap((st) => {
      const heat = st.rows.filter((r) => r.category === HEATING_CATEGORY && !heatOnlyItems.has(r.costItemId)).reduce((a, r) => a + r.shareCents, 0)
      const water = heatOnlyPlants.size > 0 ? waterBaseOf([...heatOnlyPlants], st.tenancyId) : { cents: 0, unknown: false }
      if (water.unknown) remoteUnknown = true
      const sum = heat + water.cents
      return sum > 0 ? [`${st.tenantName} (${st.unitName}) ${fmtCents(Math.round((sum * remoteCut) / 100))}`] : []
    })
    const remoteWaterNote = heatOnlyPlants.size > 0
      ? ` Bei einer Anlage, deren Wärme nach § 11 HeizkostenV ausgenommen ist, zählt nur der Anteil Warmwasser${remoteUnknown ? '; bei Positionen für Heizung und Warmwasser mit freiem Schlüssel kennt Mietfuchs ihn nicht und rechnet ihn nicht mit' : ''}.`
      : ''
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
          `${cuts.length > 0 ? `, hier: ${andList(cuts)}` : ''}.${remoteWaterNote} Mietfuchs zieht nichts ab; die Kürzung muss der Mieter erklären. ` +
          'Ausgenommen sind ein einzelnes Gerät, das in einem nicht fernablesbaren System ersetzt oder ergänzt wurde (§ 5 Abs. 2 Satz 4), und Fälle, in denen die Nachrüstung technisch nicht möglich ist oder eine unbillige Härte wäre (§ 5 Abs. 3 Satz 2); bewahren Sie dafür einen Nachweis auf.',
        subject)
    } else {
      warn('heating.remote-reading',
        `${which} ${rule} Ob das in diesem Zeitraum schon für diese Geräte gilt, hängt an ihrem Einbaudatum und daran, ob ein einzelnes Gerät in einem System ersetzt oder ergänzt wurde, dessen übrige Geräte nicht fernablesbar sind; dann gilt die Frist für die übrigen (§ 5 Abs. 2 Satz 4). Wenn ja, darf jeder Mieter seinen Anteil an den Heizkosten um bis zu ${remoteCut} % kürzen (§ 12 Abs. 1 Satz 2 HeizkostenV)` +
          `${cuts.length > 0 ? `, hier bis zu: ${andList(cuts)}` : ''}.${remoteWaterNote} ` +
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
  const heatingUnits = snapshot.units.filter((u) => !outsideHeating(u))
  const heating = heatingFindings(items, heatingUnits, heatingCovered, consumptionShare)
  // Die Überträge aus Rechnungen anderer Zeiträume (S2) nur für die Frage, wer nicht nach Verbrauch gedeckt ist; der
  // Rahmen von 50 bis 70 % bleibt bei den Positionen, wie bisher.
  for (const [id, units] of heatingFindings(fuelOwnCarries, heatingUnits, heatingCovered, () => ({ min: 0, max: 100 })).withoutConsumption) heating.withoutConsumption.set(id, units)
  for (const { item, rows } of heatingCuts) {
    // Heizung PR 14: keine Kürzung nach § 12 Abs. 1 Satz 1 bei Ausnahme nach § 11 oder Vereinbarung nach § 2.
    if (noCutFor(item.heatingPlantId, item.heatingTarget, String(item.period))) continue
    const affected = heating.withoutConsumption.get(item.id)
    const hit = rows.filter((r) => affected?.has(r.unitId) && r.share > 0)
    if (hit.length === 0) continue
    const share = consumptionShare()
    const cut = law(hkvCutNotByConsumption, { period: lawPeriod }, lawLog)
    if (!heatingAgreeable) {
      // Auf den Cent gerundet, kaufmännisch wie überall bei einer Einzelzahl. Ist nach § 11 nur die Wärme
      // ausgenommen, darf nur der Anteil Warmwasser gekürzt werden; den kennt Mietfuchs bei einer Position für
      // Heizung und Warmwasser mit freiem Schlüssel nicht (Durchsicht von #243, G-W2).
      const waterPart = exemptionScopeOf(item.heatingPlantId, String(item.period)) === 'heat' && item.heatingTarget !== 'water'
      const cuts = hit.map((r) => `${r.label} ${fmtCents(Math.round((r.share * cut) / 100))}`)
      warn('heating.not-by-consumption',
        `„${item.description}“: Heizung und Warmwasser werden hier nicht nach Verbrauch verteilt. Die Heizkostenverordnung verlangt, mindestens ${share.min} und höchstens ${share.max} % nach dem erfassten Verbrauch zu verteilen, den Rest nach Fläche (§ 7 Abs. 1, § 8 Abs. 1 HeizkostenV). ` +
          (waterPart
            ? `Die Ausnahme nach § 11 HeizkostenV betrifft nach Ihrer Angabe nur die Wärme. Sonst darf jeder Mieter deshalb nur den Anteil Warmwasser an seinem Anteil um ${cut} % kürzen (§ 12 Abs. 1 HeizkostenV); diesen Anteil kennt Mietfuchs bei diesem Schlüssel nicht und nennt keinen Betrag. `
            : `Sonst darf jeder Mieter seinen Anteil um ${cut} % kürzen (§ 12 Abs. 1 HeizkostenV), hier: ${andList(cuts)}. `) +
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
    // Heizung PR 14: unter einer Ausnahme oder Vereinbarung gilt der Rahmen von 50 bis 70 % nicht.
    if (g.itemIds.every((id) => {
      const c = items.find((x) => x.id === id)
      return noCutFor(c?.heatingPlantId, c?.heatingTarget, String(c?.period ?? period.key))
    })) continue
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
        if (monthShare(t, m).days === 0) return false
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
    const heatingModel = allocationModel(t.heatingModel)
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

  // Nutzungswechsel (Integrationsdurchsicht 0.13.0, S1): Ein Mietverhältnis ganz in einer Zeit ohne Vermietung hat keine
  // Abrechnung und steht hier, mit den Vorauszahlungen, die keine Abrechnung anrechnet; sonst verschwände es still.
  // Auch in der Heizkostenabrechnung nach Weg d, mit deren Anrechnung (Durchsicht von PR #426, K-2).
  if (scope !== 'heatingPart') {
    for (const t of tenancies) {
      if (costIds.has(t.id) || !usageIn(t.unit).phased) continue
      notSettled.push({
        tenancyId: t.id, tenantName: t.tenantName, unitName: t.unit.name, costModel: t.costModel ?? 'settlement', heatingModel: allocationModel(t.heatingModel),
        usageConflict: { prepaymentCents: prepaymentOf(t).cents },
      })
    }
  }

  // In der Heizkostenabrechnung steht nur, wer Heizkosten oder eine Heizvorauszahlung hat; eine
  // Garage ohne Anschluss an die Anlage bekäme sonst eine leere Abrechnung (Heizung PR 5).
  if (scope === 'heating') {
    for (const [id, own] of statements) if (own.rows.length === 0 && own.prepaymentCents === 0) statements.delete(id)
  }

  // Vorauszahlung im angebrochenen Monat (#311): je Mietverhältnis ein Hinweis mit dem angesetzten
  // Betrag, nur ohne Jahreskorrektur und nur, wo diese Abrechnung im Monat etwas anrechnet.
  for (const [id, { t, partial }] of partialMonths) {
    const own = statements.get(id)
    if (!own) continue
    warn('prepayment.partial-month', partialMonthHint(t, partial, own.prepaymentCents, scope === 'heating'), { kind: 'tenancy', id })
  }

  // Rückstand im Mietkonto (#133): Angerechnet wird die Vorauszahlung laut Staffel, solange keine
  // Jahreskorrektur gesetzt ist. Maßgeblich ist aber das tatsächlich Gezahlte (siehe
  // computePrepaymentCents); zeigt das Mietkonto einen Rückstand, ging womöglich ein Guthaben
  // hinaus, das es nicht gibt. Umgerechnet wird nicht: Ob eine Teilzahlung die Kaltmiete oder die
  // Vorauszahlung betraf, weiß nur der Vermieter. Der Rückstand kommt aus `rentLedger` selbst,
  // damit Abrechnung und Mietkonto nie Verschiedenes sagen; im angebrochenen Monat rechnen beide
  // anteilig (`rateInMonth`, #311), und was dort angesetzt ist, nennt `prepayment.partial-month`.
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
  // Nur Mietzahlungen (#280): Wer allein Nachzahlungen und Guthaben aus der Abrechnung bucht, führt
  // das Mietkonto nicht, und dann stünde für jedes Mietverhältnis die ganze Miete als Rückstand da.
  const ledgerInUse = snapshot.payments.some((p) => isRentPayment(p) && p.date >= yFrom && p.date <= yTo)
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
  const heatingFlat = partTenancies.filter((t) => allocationModel(t.heatingModel) !== 'settlement' && !outsideHeating(t.unit))
  // Die Ausnahme steht in shared/heating.ts, für diese Warnung wie für die Verteilung (#140).
  // Heizung PR 14: nicht für Heizpositionen einer Anlage, die nach § 11 ausgenommen ist.
  if (heatingFlat.length > 0 && !heatingAgreeable && items.some((c) => c.category === HEATING_CATEGORY && !noCutFor(c.heatingPlantId, c.heatingTarget, String(c.period)))) {
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

  // Eingetragene Rechtswerte (Heizung PR 17, Entwurf 4.5): in jeder Abrechnung, die einen nutzt. Aus einer
  // Heizperiode nach Weg b kommt der Hinweis schon mit ihren Hinweisen; dann nicht ein zweites Mal.
  for (const v of lawLog.values) {
    if (!v.overridden) continue
    const year = Number(v.validFrom?.slice(0, 4))
    const param = LAW_PARAMS.find((p) => p.id === v.id)
    const label = param?.overridable?.yearLabel?.(year) ?? String(year)
    const change = param?.checkOnly ? VALUE_CHANGE_LABEL.check : VALUE_CHANGE_LABEL.law
    const text = `${v.title} ${label}: ${v.text}, von Ihnen eingetragen (Quelle: ${v.overridden.source}), weil der amtliche Wert noch nicht im Programm steht. ` +
      `Bringt ein Update den amtlichen Wert, gilt dieser; bei einer abgeschlossenen Abrechnung nennt die Seite Abrechnung die Änderung dann als „${change}“.`
    if (!notices.some((n) => n.code === 'law.value-overridden' && n.text === text)) warn('law.value-overridden', text)
  }

  // Betriebsstrom im Allgemeinstrom (Heizung PR 15, #212): geprüft werden die Positionen, die diese
  // Abrechnung verteilt (`items`); bei Weg b tut das der Unteraufruf der Heizperiode, und sein Hinweis
  // wird übernommen (ohne Doppel, PR 5). Die Abzüge kommen aus allen Zeiträumen; einer in einer
  // abgeschlossenen Abrechnung zählt nur mit dem, was im eingefrorenen Stand steht (P-W3, R2-W2).
  for (const f of operatingPowerFindings(items, snapshot.operatingPowerDeductions ?? [])) {
    warn('heating.operating-power-double', operatingPowerText(f, fmtCents), itemSubject({ id: f.itemId }))
  }
  // Durchsicht von #252, G-K3: Ein Abzug mindert seine Stromrechnung nur dann im Verhältnis, wenn er
  // verteilt ist wie sie (Schlüssel, Zähler, Wohnung, Anteile, Teilnehmer, seit #258 auch „nicht vereinbart“; dieselbe Regel wie beim
  // gemerkten Schlüssel, shared/allocation.ts). Sonst verschieben sich die Anteile der Mieter.
  // Durchsicht von #252, G-K2 und N1: Betriebsstrom und Abzug in verschiedenen Steuerjahren standen bis #268 in beiden
  // Jahren der Anlage V falsch, und hier stand ein Hinweis. Seit #268 gleicht die Steuerübersicht je Steuerjahr aus
  // (`operatingPowerBalance`): Jedes Jahr zeigt die in ihm bezahlten Rechnungen, nichts verschiebt sich, der Hinweis
  // entfällt (Zahlen in calc-steuer-betriebsstrom.test.ts, „Verschiedene Steuerjahre“).
  // Durchsicht von #252, G-W1: Aus einer Stromrechnung ist höchstens ihr Betrag abzuziehen; sonst ist der
  // Allgemeinstrom netto negativ, und die Mieter bekommen mehr gutgeschrieben, als er kostet.
  for (const g of items) {
    if (g.category !== GENERAL_POWER_CATEGORY || g.operatingPower !== undefined || !(g.amountCents > 0)) continue
    const deducted = -items.filter((d) => d.operatingPower === 'deduction' && d.operatingPowerGeneralId === g.id).reduce((a, d) => a + d.amountCents, 0)
    if (deducted <= g.amountCents) continue
    warn('heating.operating-power-exceeds',
      `Aus der Stromrechnung „${g.description}“ (${fmtCents(g.amountCents)}) sind ${fmtCents(deducted)} abgezogen, ${fmtCents(deducted - g.amountCents)} mehr als die Rechnung. ` +
      'Der Allgemeinstrom ist damit netto negativ; meist ist ein Betriebsstrom doppelt gebucht. Prüfen Sie die Abzüge im Kostenformular.',
      itemSubject(g))
  }
  for (const d of items) {
    if (d.operatingPower !== 'deduction' || !d.operatingPowerGeneralId) continue
    const g = items.find((c) => c.id === d.operatingPowerGeneralId)
    if (!g || sameAllocation(allocationOf(d, undefined, { contract: true }), allocationOf(g, undefined, { contract: true }))) continue
    const how = d.key === g.key ? `beide nach „${KEY_LABELS[d.key]}“, aber mit anderen Angaben (Teilnehmer, Anteile, Zähler, Wohnung oder nicht im Mietvertrag vereinbart)` : `der Abzug nach „${KEY_LABELS[d.key]}“, die Rechnung nach „${KEY_LABELS[g.key]}“`
    warn('heating.operating-power-key',
      `„${d.description}“ (${fmtCents(-d.amountCents)}) ist anders verteilt als die Stromrechnung „${g.description}“, aus der er gerechnet wurde: ${how}. ` +
      'Damit verschieben sich die Anteile der Mieter am Allgemeinstrom. Verteilen Sie den Abzug im Kostenformular wie die Rechnung.',
      itemSubject(d))
  }

  // Folge-PR zu #252 (#224, #253): Betriebsstrom fehlt, und Strom zur Wärmeerzeugung womöglich im Allgemeinstrom.
  // Nur in der Gesamtberechnung, denn nur dort stehen Allgemeinstrom und Heizperiode zusammen; die Heizperioden
  // einer Anlage mit eigener Heizperiode kommen aus `heatingParts`. Das Register wird erst gefragt, wenn der
  // Hinweis sonst käme, damit es nicht im Rechtsstand jeder Abrechnung mit Wärmepumpe steht.
  if (scope === 'all') {
    // Heizung PR 19, Durchsicht S-2: zentrale Heizung, Brennstoff beim Mieter, ohne Heizanlage. Trägt ein anderer Mieter
    // den Allgemeinstrom mit und steht dort kein Abzug, kann der Brennerstrom bei ihm landen. Ein Hinweis, der die Ampel
    // nicht färbt (INFORMATIONAL in client/src/notices.ts, Entscheidung zur Durchsicht S-2).
    // Nachprüfung N-1: Beantwortet wird er nur von einem Abzug, der dieser Heizung zuzuordnen ist: ohne Verweis, oder
    // verknüpft mit einer Heizposition, die der Selbstversorger trägt (eine Zeile seiner Abrechnung, direkt oder über
    // seine Teilnahme). Der Abzug für eine andere Heizanlage des Vermieters zählt nicht.
    const centralSelf = snapshot.tenancies.filter((t) => t.heatingModel === 'selfSupply' && t.selfSupplyKind === 'central' && statements.has(t.id))
    if (centralSelf.length > 0) {
      const generals = items.filter((c) => c.category === GENERAL_POWER_CATEGORY && c.amountCents > 0 && c.operatingPower === undefined)
      const deductedFor = (tenancyId: string): boolean => items.some((c) => c.operatingPower === 'deduction' &&
        (!c.operatingPowerItemId || (statements.get(tenancyId)?.rows.some((r) => r.costItemId === c.operatingPowerItemId) ?? false)))
      const centralIds = new Set(centralSelf.map((t) => t.id))
      const othersPay = generals.some((g) => [...statements.values()].some((st) => !centralIds.has(st.tenancyId) && st.rows.some((r) => r.costItemId === g.id && r.shareCents > 0)))
      if (othersPay) {
        for (const t of centralSelf) {
          if (deductedFor(t.id)) continue
          const unitName = snapshot.units.find((u) => u.id === t.unitId)?.name ?? ''
          warn('heating.self-supply-operating-power', selfSupplyPowerText(t.tenantName, unitName, generals), { kind: 'tenancy', id: t.id })
        }
      }
    }
    // #270: Abzug ohne Verweis, dem Messdienst nach Angabe nicht gemeldet.
    for (const d of notReportedDeductions(items, plants, period)) warn('heating.operating-power-not-reported', notReportedText(d), itemSubject(d))
    for (const f of missingPowerFindings({ period, plants, items, heatingParts: snapshot.heatingParts ?? [] })) {
      if (f.kind === 'operating') {
        warn('heating.operating-power-missing', missingOperatingPowerText(f, label), { kind: 'heatingCosts', id: f.plantId })
        continue
      }
      // #266: mit Angabe an der Anlage, wie der Betriebsstrom erfasst ist.
      if (f.kind === 'deductionMissing') {
        warn('heating.operating-power-deduction-missing', deductionMissingText(f, label), { kind: 'heatingCosts', id: f.plantId })
        continue
      }
      if (f.kind === 'billMissing') {
        warn('heating.operating-power-bill-missing', billMissingText(f, label), { kind: 'heatingCosts', id: f.plantId })
        continue
      }
      const betrkv = law(betrkvGenerationPower, { period: lawPeriod }, lawLog)
      if (betrkv.coverage === 'none') continue
      // K-2 (Rechtsprüfung des Plans): Gilt die Heizkostenverordnung für diese Wärmepumpe noch nicht (§ 12 Abs. 3
      // Satz 2), nennt der Text sie nicht.
      const notYet = notices.some((n) => n.code === 'heating.heat-pump-capture' && n.subject?.id === f.plantId)
      const hkv = notYet ? null : law(hkvGenerationPower, { period: lawPeriod }, lawLog)
      const first = f.generals[0]
      warn('heating.generation-power-missing',
        generationPowerText(f, label, fmtDay(betrkv.value.since), hkv && hkv.coverage !== 'none' ? fmtDay(hkv.value.since) : null),
        first ? itemSubject(first) : { kind: 'heatingCosts', id: f.plantId })
    }
  }

  // Umstellung auf Wärmelieferung (Heizung PR 16, #213): in der Abrechnung, die die Heizkosten der Anlage verteilt
  // (`items`; bei Weg b der Unteraufruf der Heizperiode, übernommen ohne Doppel), für die Mieter, deren Vertrag
  // schon vorher lief. Der Hinweis führt zur Anlage, wo die Umstellung eingetragen wird (Prüfung C-S10). Eine
  // Umstellung vor der ersten Fassung erkennt Mietfuchs am Beginn dieser Fassung, nicht an einem Fehler des
  // Registers; der Rechtswert wird nur gefragt, wenn der Hinweis kommt.
  const switchFrom = onlyVersion(bgbHeatDeliverySwitch).validFrom ?? ''
  for (const f of switchFindings(plants, items, snapshot.tenancies.filter((t) => statements.has(t.id)), snapshot.units)) {
    const rule = f.since >= switchFrom ? law(bgbHeatDeliverySwitch, { date: f.since }, lawLog) : null
    warn('heating.contracting', switchText(f, rule, fmtDay, switchFrom), { kind: 'heatingPlant', id: f.plantId })
  }

  // Wohnung an keiner Heizanlage (Integrationsdurchsicht 0.13.0, Durchsicht zu PR #436 M1): Bis 0.12 schrieb ein
  // Kesseltausch die Liste der Wohnungen fest. Aufs Geld wirkt die Liste nur bei der eigenen Heizkostenabrechnung
  // (Schlüssel `heatingSystem`, Nutzer nach der Liste); freie Schlüssel verteilen über ihre eigene Basis. Gemeldet wird
  // deshalb nur dort und nur in einer Linie mit Tausch, denn nur dort kann der Fehler stecken. Jede Wohnung mit Fläche der
  // Abrechnungseinheit zählt, auch eine leere: Ihr Leerstand gehört zum Vermieter, ohne Liste trügen ihn die übrigen.
  // Ausgenommen sind Wohnungen ohne Wärmeanschluss (#117) und solche, deren Mieter selbst heizt.
  const running = plants.filter((p) => {
    const span = plantSpan(p, plants)
    return (span.from === null || span.from <= yTo) && (span.to === null || span.to >= yFrom)
  })
  const swappedSelf = running.find((p) => p.method === 'self' && p.supply !== 'perUnit' && p.units !== null
    && plants.some((q) => sameLine(p, q, plants)) && items.some((c) => c.heatingPlantId === p.id && c.key === 'heatingSystem'))
  if (swappedSelf) {
    const plantLabel = (swappedSelf.name ?? '').trim() ? `der Heizanlage „${(swappedSelf.name ?? '').trim()}“` : 'der Heizanlage'
    for (const u of snapshot.units) {
      if (!(u.areaM2 > 0) || (u.noConnection ?? []).includes('waerme')) continue
      if (running.some((p) => servesUnit(p, u))) continue
      if (usageIn(u).rented + usageIn(u).self === 0) continue
      const own = snapshot.tenancies.filter((t) => t.unitId === u.id && t.start <= yTo && (t.end === null || t.end >= yFrom))
      if (own.some((t) => t.heatingModel === 'selfSupply')) continue
      warn('heating.unit-unserved',
        `Die Wohnung „${u.name}“ hängt an keiner Heizanlage und trägt deshalb keinen Anteil an den Heizkosten ${plantLabel}, die nach der Heizkostenverordnung verteilt werden; die übrigen Nutzer tragen ihn. ` +
          'Das kann nach einem Kesseltausch geschehen sein: Bis Version 0.12 legte der Tausch die Liste der Wohnungen fest, und eine später angelegte Wohnung kam nicht hinein. ' +
          'Nehmen Sie die Wohnung auf der Seite Heizkosten unter „Heizanlage ändern“ in die Liste ihrer Heizanlage auf. Hat sie keinen Anschluss an die Heizung, nehmen Sie in den Stammdaten bei der Wohnung unter den Anschlüssen das Häkchen bei Wärme heraus.',
        { kind: 'heatingPlant', id: swappedSelf.id })
    }
  }

  // ---------- CO₂-Erstattung an Mieter, die selbst heizen (§ 6 Abs. 2 CO2KostAufG, Heizung PR 19) ----------
  // Verrechnet in diesem Zeitraum: eine Gutschriftzeile beim Mieter und die Gegenzeile beim Vermieter; die Summe
  // aller Zeilen bleibt die der Positionen. Nicht verrechnet und nicht ausgezahlt: ab der Fälligkeit eine Warnung
  // in jeder Abrechnung. Die Steuer liest nichts davon (Entwurf 6.4 Nr. 3): Verrechnet der Vermieter, steckt die
  // Erstattung in der kleineren Zahlung; zahlt er aus, trägt er den Tag ein, und taxReport führt sie im Jahr der
  // Auszahlung als Werbungskosten (Durchsicht S-1).
  if (scope === 'all') {
    for (const r of snapshot.co2Refunds ?? []) {
      const t = snapshot.tenancies.find((x) => x.id === r.tenancyId)
      // Vor 2023 gibt es keine Erstattung (§ 11 Abs. 2); db/co2Refunds.ts lehnt das schon beim Speichern ab.
      if (!t || !coversDate(co2SelfSupply, r.supplierBilledAt)) continue
      const tenancySubject: NoticeSubject = { kind: 'tenancy', id: r.tenancyId }
      const st = statements.get(r.tenancyId)
      // Prüfung M4: nur, wer sich selbst mit Wärme versorgt; sonst bekäme der Mieter seinen CO₂-Anteil doppelt.
      if (t.heatingModel !== 'selfSupply') {
        if (r.settlePeriod === period.key || r.settlePeriod === null) {
          warn('co2.refund-not-self',
            `Für ${t.tenantName} ist eine CO₂-Erstattung von ${fmtCents(r.amountCents)} eingetragen, das Mietverhältnis steht unter Heizung aber nicht auf „Mieter heizt selbst“. ` +
              'Eine Erstattung nach § 6 Abs. 2 CO2KostAufG steht nur einem Mieter zu, der sich selbst mit Wärme versorgt; Mietfuchs verrechnet sie deshalb nicht. Stellen Sie das Mietverhältnis um, wenn das zutrifft, oder löschen Sie die Erstattung.',
            tenancySubject)
        }
        continue
      }
      const self = law(co2SelfSupply, { date: r.supplierBilledAt }, lawLog)
      const due = refundDueDate(r.claimedAt, self.refundMonths)
      if (r.settlePeriod === period.key && st) {
        const ask: LawAsk = {
          applicable: (p) => law(co2ApplicableFrom, { period: p }, lawLog),
          stageTable: (p) => law(co2StageTable, { period: p }, lawLog),
          decimals: (p) => law(co2RoundingDecimals, { period: p }, lawLog),
          restriction: (p) => law(co2Restriction, { period: p }, lawLog),
          selfSupply: () => self,
          pieces: (p) => law(co2HalfSplit, { period: p, weights: (x) => degreeDayPermille([x], law(hkvDegreeDays, { period: p }, lawLog)) }, lawLog).map(({ from, to, value }) => ({ from, to, value })),
          degreeDays: (p) => law(hkvDegreeDays, { period: p }, lawLog),
        }
        const rl = refundLawAt(r, ask)
        const proposal = rl ? refundProposal(r, rl) : null
        const steps = refundSteps(proposal, r, r.amountCents, {
          euro: fmtCents, exact: fmtExactEuro, num: fmtNum, applicableFrom: fmtDay(co2FirstPeriodStart()), cutPercent: self.ownAppliancesCutPercent,
        })
        st.rows.push({
          costItemId: `co2refund:${r.id}`, kind: 'co2Refund', category: CO2_REFUND_CATEGORY, description: CO2_REFUND_LABEL, totalCents: -r.amountCents,
          keyLabel: 'Erstattung', basisText: `Anzeige vom ${fmtDay(r.claimedAt)}`, shareCents: -r.amountCents, labor35aCents: 0, steps,
        })
        st.totalShareCents -= r.amountCents
        landlordRows.push({
          costItemId: `co2refund:${r.id}`, category: CO2_REFUND_CATEGORY, description: CO2_REFUND_LABEL, totalCents: 0,
          keyLabel: 'Erstattung', shareCents: r.amountCents, landlordParts: [{ reason: 'co2Refund', cents: r.amountCents }],
        })
        // Geschuldet ist der Anteil nach § 6 Abs. 2 Satz 1; gebucht ist der eingetragene Betrag.
        if (proposal && proposal.excluded !== 'overYear' && proposal.cents !== r.amountCents) {
          warn('co2.refund-differs',
            `Die eingetragene CO₂-Erstattung an ${t.tenantName} (${fmtCents(r.amountCents)}) weicht von der Nachrechnung nach den eingetragenen Grundlagen ab (${fmtCents(proposal.cents)}). ` +
              'Zu erstatten ist der Anteil, den Sie nach § 6 Abs. 2 Satz 1 CO2KostAufG zu tragen haben; gebucht ist der eingetragene Betrag. Prüfen Sie die Anzeige des Mieters und die Grundlagen.',
            tenancySubject)
        }
        const deadline = claimDeadline(r.supplierBilledAt, self.claimMonths)
        if (r.claimedAt > deadline) {
          warn('co2.refund-late',
            `${t.tenantName} hat die CO₂-Erstattung am ${fmtDay(r.claimedAt)} geltend gemacht; die Abrechnung des Lieferanten stammt vom ${fmtDay(r.supplierBilledAt)}. ` +
              `Die Frist von ${self.claimMonths} Monaten (§ 6 Abs. 2 Satz 3 CO2KostAufG) endete am ${fmtDay(deadline)}. Die Frist ist nach der Begründung des Gesetzes eine Ausschlussfrist (BT-Drs. 20/3172, S. 34, damals noch mit sechs Monaten); den Anspruch müssen Sie dann voraussichtlich nicht erfüllen. Mietfuchs verrechnet ihn, weil Sie ihn eingetragen haben.`,
            tenancySubject)
        }
        const months = law(bgbDeadlineMonths, { period: lawPeriod }, lawLog)
        const lived = periodsBetween(objectRules, t.start, period.to).filter((p) => t.start <= p.to && (t.end === null || t.end >= p.from))
        const candidates = lived.map((p) => ({ key: p.key, from: p.from, deadline: settlementDeadline(p, months), sentAt: snapshot.settlementsSent?.find((s) => s.period === p.key)?.sentAt ?? null }))
        const next = nextSettlement(r.claimedAt, candidates)
        const nextPeriod = lived.find((p) => p.key === next)
        // Satz 4 verlangt eine vereinbarte Vorauszahlung: die Staffel und das Nebenkostenmodell, nicht das Gezahlte
        // (BT-Drs. 20/3172, S. 35: bei Pauschale oder ohne Umlage ist auszuzahlen).
        if (!prepaymentAgreed(t, period)) {
          warn('co2.refund-not-next',
            `Mit ${t.tenantName} ist für diesen Zeitraum keine Vorauszahlung auf Betriebskosten vereinbart (keine Staffel mit Vorauszahlung, oder Pauschale bzw. Inklusivmiete). Verrechnen dürfen Sie die CO₂-Erstattung nach § 6 Abs. 2 Satz 4 CO2KostAufG nur bei vereinbarter Vorauszahlung; ` +
              `zahlen Sie sie spätestens am ${fmtDay(due)} aus (Satz 5) und tragen Sie die Auszahlung ein.`,
            tenancySubject)
        } else if (next !== period.key) {
          warn('co2.refund-not-next',
            `${t.tenantName} hat die CO₂-Erstattung am ${fmtDay(r.claimedAt)} geltend gemacht. Verrechnen dürfen Sie sie nach § 6 Abs. 2 Satz 4 CO2KostAufG in der nächsten Betriebskostenabrechnung nach der Anzeige, in der Regel` +
              (nextPeriod ? ` die für ${periodLabel(nextPeriod)}` : '') +
              `. Sonst ist sie spätestens am ${fmtDay(due)} auszuzahlen (Satz 5).`,
            tenancySubject)
        }
        continue
      }
      // Integrationsdurchsicht S1: Zum Verrechnen in diesem Zeitraum eingetragen, aber der Mieter bekommt hier keine
      // Abrechnung (Inklusivmiete oder Pauschale ohne Vorauszahlung, Wohnung außerhalb der Abrechnungseinheit). Das
      // Speichern lehnt das inzwischen ab; ein vorhandener Eintrag bekommt hier einen Hinweis, unabhängig von der
      // Fälligkeit, denn in späteren Zeiträumen ist er nicht mehr „offen“ und bliebe sonst still liegen.
      if (r.paidOutOn === null && r.settlePeriod === period.key && !st) {
        // Schon fällig: Warnung wie bei einer offenen Erstattung; sonst ein Hinweis.
        warn(due <= period.to ? 'co2.refund-due' : 'co2.refund-not-next',
          `${t.tenantName} bekommt für ${label} keine Abrechnung; die dort zum Verrechnen eingetragene CO₂-Erstattung von ${fmtCents(r.amountCents)} verrechnet Mietfuchs deshalb nicht. ` +
            `Zahlen Sie sie spätestens am ${fmtDay(due)} aus (§ 6 Abs. 2 Satz 5 CO2KostAufG) und tragen Sie die Auszahlung ein.`,
          tenancySubject)
        continue
      }
      const open = r.paidOutOn === null && r.settlePeriod === null
      if (open && r.claimedAt <= period.to && due <= period.to) {
        warn('co2.refund-due',
          `${t.tenantName} hat am ${fmtDay(r.claimedAt)} eine CO₂-Erstattung von ${fmtCents(r.amountCents)} geltend gemacht. Wird sie nicht verrechnet, war sie spätestens am ${fmtDay(due)} zu erstatten (§ 6 Abs. 2 Satz 5 CO2KostAufG); bei vereinbarter Vorauszahlung wird sie mit Ablauf der Frist der Abrechnung fällig, in der sie zu verrechnen ist (BT-Drs. 20/3172, S. 35). ` +
            'Verrechnen Sie sie in dieser Abrechnung oder zahlen Sie sie aus; dann tragen Sie den Tag der Auszahlung an der Erstattung ein; die Steuerübersicht führt sie dann im Jahr der Auszahlung als Werbungskosten. Als Zahlung im Mietkonto erfassen Sie sie nicht, sonst stünde dort ein Rückstand.' +
            (r.nonResidential
              ? ` Ob diese Frist auch im Nichtwohngebäude gilt, ist nach dem Wortlaut nicht sicher: § 8 Abs. 2 verweist auf § 6 Abs. 2 Satz 2 bis 4, und seit dem ${fmtDay(halfSplitEnactedOn())} steht die Frist in Satz 5. Nach der Begründung des Gesetzes sollen dieselben Fristen gelten (BT-Drs. 20/3172, S. 37); Mietfuchs warnt deshalb.`
              : ''),
          tenancySubject)
      }
    }
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
    garageLikeUnitIds: periodUnits.filter((u) => (u.participates || u.selfUsed) && isGarageLike(u)).map((u) => u.id),
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
  // Die Abzugszeilen nach § 7 Abs. 1 und Abs. 5 (`co2:`, `gmodg:`, Heizung PR 18, Prüfung M5) gehören zu den
  // Messdienstpositionen ihres Topfs, ohne solche (eigene Aufteilung bei freien Schlüsseln) zu seinen
  // Brennstoffpositionen und erst ohne diese zu allen Heizpositionen des Topfs. Vorher ging die CO₂-Abzugszeile der eigenen Aufteilung mit 0 ein, und der Vorschlag war zu hoch
  // (Behebung mit Heizung PR 18; nur der Vorschlag, keine Zahl der Abrechnung).
  const reliefFactor = (rows: readonly SettlementRow[], key: string, factors: ReadonlyMap<string, number>): number => {
    const potKey = key.replace(/^gmodg:/, 'co2:')
    const inPot = rows.filter((r) => {
      const c = itemById.get(r.costItemId)
      return c !== undefined && c.category === HEATING_CATEGORY && `co2:${c.heatingPlantId ?? ''}:${c.period}` === potKey
    })
    const service = inPot.filter((r) => itemById.get(r.costItemId)?.key === 'amounts')
    // Durchsicht S1: ohne Messdienst die Brennstoffpositionen, wie beim Anteil x_t; die Übertragszeilen tragen
    // `heatingPart: 'fuel'`. Erst ohne solche alle Heizpositionen. Sonst minderte die Wartung den Faktor.
    const fuel = inPot.filter((r) => {
      const c = itemById.get(r.costItemId)
      return c?.fuelDeliveryId != null || c?.heatingPart === 'fuel'
    })
    const own = service.length > 0 ? service : fuel.length > 0 ? fuel : inPot
    const sum = own.reduce((a, r) => a + r.shareCents, 0)
    return sum === 0 ? 0 : own.reduce((a, r) => a + r.shareCents * (factors.get(r.costItemId) ?? 0), 0) / sum
  }
  // Abdeckung V21: Wird eine Anlage nach dem Ende dieses Zeitraums getrennt abgerechnet (Weg d), laufen ihre Heizkosten
  // künftig über die Heizvorauszahlung. Der Vorschlag heißt dann „Vorauszahlung für die übrigen Nebenkosten (ohne
  // Heizung)“ und lässt ihre Zeilen aus, auch im Übergangsjahr, das ihre letzte Heizperiode davor noch enthält.
  const nextMonth = dayAfter(period.to).slice(0, 7)
  const separateLater = new Set(scope === 'all' ? plants.filter((p) => separateOwner(wayOf(p), objectRules, nextMonth) !== null).map((p) => p.id) : [])
  const syntheticById = new Map(fuelSynthetic.map((c) => [c.id, c]))
  // Integrationsdurchsicht 0.13.0 (#435): Endet in P eine getrennt abgerechnete Heizperiode, fehlen ihre Heizkosten in P und
  // damit im Vorschlag, auch wenn Weg d danach endet. Ohne diese Angabe hieße der Betrag „Vorauszahlung“ für alles, und die
  // Übernahme in die Staffel ersetzte die ganze Vorauszahlung durch die ohne Heizung.
  if (scope === 'all') result.suggestionWithoutHeating = separateLater.size > 0 || separateHeating.length > 0
  const laterSeparate = (row: SettlementRow): boolean => {
    if (separateLater.size === 0) return false
    const relief = /^(?:co2|gmodg):([^:]*):/.exec(row.costItemId)
    if ((row.kind === 'co2Relief' || row.kind === 'gmodgRelief') && relief) return separateLater.has(relief[1] ?? '')
    const c = itemById.get(row.costItemId) ?? syntheticById.get(row.costItemId)
    return c !== undefined && c.category === HEATING_CATEGORY && separateLater.has(c.heatingPlantId ?? '')
  }
  // Integrationsdurchsicht 0.13.0, K2: Hochgerechnet wird auf die Tage, an denen das Mietverhältnis Kosten trägt
  // (`costTenancies`, #259). Ohne Widerspruch zur Nutzung sind das seine Tage; mit einem Widerspruch trägt es nur einen
  // Teil, und der Vorschlag halbierte sich sonst bei einem Wechsel zur Jahresmitte. `usage.tenancy-conflict` nennt ihn.
  const costDays = new Map(costTenancies.map((t) => [t.id, t.days]))
  // Durchsicht von PR #426, S-1: In der eigenen Heizkostenabrechnung bleibt der Mieter Nutzer für seine ganze Zeit (S3
  // von #259); seine Zeilen dort (Schlüssel `heatingSystem`, dazu die Abzugszeilen ihres Topfs) decken also alle seine
  // Tage und rechnen auf `st.days` hoch, nur die übrigen auf die Tage mit Kosten.
  const wholeTime = (row: SettlementRow): boolean => {
    const relief = /^(?:co2|gmodg):([^:]*):/.exec(row.costItemId)
    if ((row.kind === 'co2Relief' || row.kind === 'gmodgRelief') && relief) return selfPlans.get(relief[1] ?? '')?.weights != null
    const c = itemById.get(row.costItemId)
    return c !== undefined && c.key === 'heatingSystem' && selfPlans.get(c.heatingPlantId ?? '')?.weights != null
  }
  for (const st of result.statements) {
    st.balanceCents = st.prepaymentCents - st.totalShareCents // >0 Guthaben, <0 Nachzahlung
    const basisDays = costDays.get(st.tenancyId) ?? st.days
    const daysOf = (row: SettlementRow): number => (basisDays !== st.days && wholeTime(row) ? st.days : basisDays)
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
      // Die Abzugszeilen nach § 7 Abs. 5 (Heizung PR 18, Prüfung M5) gehören zu denselben Heizkosten wie die
      // CO₂-Abzugszeile ihres Topfs.
      const factorOf = (row: SettlementRow): number => (row.kind === 'co2Relief' || row.kind === 'gmodgRelief'
        ? reliefFactor(st.rows, row.costItemId, shortBasis.factors)
        : (shortBasis.factors.get(row.costItemId) ?? 0))
      // Ohne Widerspruch zur Nutzung wie bisher über die Summe; sonst je Zeile mit ihren Tagen (S-1).
      const yearly = basisDays === st.days
        ? (st.rows.reduce((a, row) => a + (laterSeparate(row) ? 0 : row.shareCents * factorOf(row)), 0) * diy) / basisDays
        : st.rows.reduce((a, row) => a + (laterSeparate(row) ? 0 : (row.shareCents * factorOf(row) * diy) / daysOf(row)), 0)
      st.suggestedMonthlyCents = Math.max(0, Math.round(yearly / 12 / 100) * 100)
    } else {
      // Nie negativ: Überwiegen Gutschriften, gibt es keine Vorauszahlung unter 0 (Integrationsdurchsicht).
      // Ohne CO₂-Erstattung: Sie fällt nicht wieder an (Heizung PR 19, `recurringShareCents`).
      const later = st.rows.reduce((a, row) => a + (laterSeparate(row) ? row.shareCents : 0), 0)
      // Ohne Widerspruch zur Nutzung wie bisher über die Summe; sonst je Zeile mit ihren Tagen (S-1).
      const yearly = basisDays === st.days
        ? ((recurringShareCents(st) - later) * diy) / basisDays
        : st.rows.reduce((a, row) => a + (laterSeparate(row) || row.kind === 'co2Refund' ? 0 : (row.shareCents * diy) / daysOf(row)), 0)
      st.suggestedMonthlyCents = Math.max(0, Math.round(yearly / 12 / 100) * 100)
    }
  }
  return result
}

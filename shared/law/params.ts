// Alle Parameter des Registers, für die Prüfungen in server/test/law.test.ts und den Wächter. Wer
// einen Parameter anlegt, trägt ihn hier ein; ein Test sucht in shared/law/ nach `LawParam`-
// Konstanten, die hier fehlen.
import type { LawParam, Timing } from './register.ts'
import type { LawValue } from '../types.ts'
import { betrkvTvSignal, bgbDeadlineMonths, bgbMaxPeriodMonths } from './bgb-betrkv.ts'
import { co2ApplicableFrom, co2CostsBefore, co2CutMissing, co2DistrictEtsNew, co2EbevFactors, co2NonResidential, co2Price, co2PriceEts, co2Restriction, co2RoundingDecimals, co2StageTable } from './co2kostaufg.ts'
import { hkvConsumptionShare, hkvConsumptionShareForced, hkvCutInformation, hkvCutNotByConsumption, hkvCutRemoteReading, hkvDegreeDays, hkvDhwAreaFormula, hkvDhwFactors, hkvDhwVolumeFormula, hkvEstimateThreshold, hkvExemptions, hkvHeatingValues, hkvHeatPumpCapture, hkvInfoDistrict, hkvMonthlyInfo, hkvRenewableExemption, hkvRemoteReadingNewDevices, hkvRemoteReadingRetrofit, hkvSettlementInfo } from './heizkostenv.ts'
import { practiceEvaporatorWindow, practiceReadingOffWarning, practiceVacancyPersons } from './practice.ts'
import { ustgGasHeatNetworkRate, ustgStandardRate } from './ustg.ts'

export const LAW_PARAMS: readonly LawParam<LawValue, Timing>[] = [
  betrkvTvSignal,
  bgbDeadlineMonths,
  bgbMaxPeriodMonths,
  co2ApplicableFrom,
  co2CostsBefore,
  co2CutMissing,
  co2DistrictEtsNew,
  co2EbevFactors,
  co2NonResidential,
  co2Price,
  co2PriceEts,
  co2Restriction,
  co2RoundingDecimals,
  co2StageTable,
  hkvConsumptionShare,
  hkvConsumptionShareForced,
  hkvSettlementInfo,
  hkvCutNotByConsumption,
  hkvCutRemoteReading,
  hkvDegreeDays,
  hkvHeatPumpCapture,
  hkvRemoteReadingRetrofit,
  hkvRemoteReadingNewDevices,
  practiceReadingOffWarning,
  practiceVacancyPersons,
  ustgGasHeatNetworkRate,
  ustgStandardRate,
  hkvDhwVolumeFormula,
  hkvDhwAreaFormula,
  hkvDhwFactors,
  hkvHeatingValues,
  hkvRenewableExemption,
  hkvEstimateThreshold,
  practiceEvaporatorWindow,
  // Heizung PR 14
  hkvCutInformation,
  hkvInfoDistrict,
  hkvMonthlyInfo,
  hkvExemptions,
]

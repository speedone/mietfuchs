// Alle Parameter des Registers, für die Prüfungen in server/test/law.test.ts und den Wächter. Wer
// einen Parameter anlegt, trägt ihn hier ein; ein Test sucht in shared/law/ nach `LawParam`-
// Konstanten, die hier fehlen.
import type { LawParam, Timing } from './register.ts'
import type { LawValue } from '../types.ts'
import { betrkvGenerationPower, betrkvTvSignal, bgbDeadlineMonths, bgbDeadlineOnWorkday, bgbHeatDeliverySwitch, bgbMaxPeriodMonths, bgbRentDueSaturday, bgbRentDueWorkday } from './bgb-betrkv.ts'
import { HOLIDAY_PARAMS } from './feiertagsgesetze.ts'
import { co2ApplicableFrom, co2CostsBefore, co2CutMissing, co2DistrictEtsNew, co2EbevFactors, co2HalfSplit, co2HalfSplitEmergency, co2HalfSplitNewBuildings, co2HalfSplitTwoFamily, co2NonResidential, co2Price, co2PriceEts, co2Restriction, co2RoundingDecimals, co2SelfSupply, co2StageTable } from './co2kostaufg.ts'
import { estgAcquisitionRelated, estgCheapRent } from './estg.ts'
import { gmodgHeating43 } from './gmodg.ts'
import { hkvConsumptionShare, hkvConsumptionShareForced, hkvCutInformation, hkvCutNotByConsumption, hkvCutRemoteReading, hkvDegreeDays, hkvDhwAreaFormula, hkvDhwFactors, hkvDhwVolumeFormula, hkvEstimateThreshold, hkvExemptions, hkvGenerationPower, hkvHeatingValues, hkvHeatPumpCapture, hkvInfoDistrict, hkvMonthlyInfo, hkvRenewableExemption, hkvRemoteReadingNewDevices, hkvRemoteReadingRetrofit, hkvSettlementInfo } from './heizkostenv.ts'
import { messevCalibrationYears } from './messev.ts'
import { practiceEvaporatorWindow, practiceReadingOffWarning, practiceVacancyPersons } from './practice.ts'
import { ustgGasHeatNetworkRate, ustgSmallBusiness, ustgStandardRate } from './ustg.ts'

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
  // Folge-PR zu #252 (#253)
  betrkvGenerationPower,
  hkvGenerationPower,
  // Heizung PR 16 (#213)
  bgbHeatDeliverySwitch,
  // Heizung PR 21 (#98)
  messevCalibrationYears,
  // Heizung PR 18 (#215)
  co2HalfSplit,
  co2HalfSplitEmergency,
  co2HalfSplitNewBuildings,
  co2HalfSplitTwoFamily,
  gmodgHeating43,
  // Heizung PR 19 (#97)
  co2SelfSupply,
  // Fristen nach Werktagen und die Feiertage der Länder
  bgbRentDueWorkday,
  bgbRentDueSaturday,
  bgbDeadlineOnWorkday,
  ...HOLIDAY_PARAMS,
  // Verbilligte Vermietung (#257)
  estgCheapRent,
  estgAcquisitionRelated,
  // Garage und Umsatzsteuer (#323)
  ustgSmallBusiness,
]

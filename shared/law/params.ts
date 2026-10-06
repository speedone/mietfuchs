// Alle Parameter des Registers, für die Prüfungen in server/test/law.test.ts und den Wächter. Wer
// einen Parameter anlegt, trägt ihn hier ein; ein Test sucht in shared/law/ nach `LawParam`-
// Konstanten, die hier fehlen.
import type { LawParam, Timing } from './register.ts'
import type { LawValue } from '../types.ts'
import { betrkvTvSignal, bgbDeadlineMonths, bgbMaxPeriodMonths } from './bgb-betrkv.ts'
import { co2ApplicableFrom, co2CostsBefore, co2CutMissing, co2DistrictEtsNew, co2NonResidential, co2Restriction, co2RoundingDecimals, co2StageTable } from './co2kostaufg.ts'
import { hkvConsumptionShare, hkvCutNotByConsumption, hkvCutRemoteReading, hkvDegreeDays, hkvRemoteReadingNewDevices, hkvRemoteReadingRetrofit } from './heizkostenv.ts'
import { practiceVacancyPersons } from './practice.ts'
import { ustgStandardRate } from './ustg.ts'

export const LAW_PARAMS: readonly LawParam<LawValue, Timing>[] = [
  betrkvTvSignal,
  bgbDeadlineMonths,
  bgbMaxPeriodMonths,
  co2ApplicableFrom,
  co2CostsBefore,
  co2CutMissing,
  co2DistrictEtsNew,
  co2NonResidential,
  co2Restriction,
  co2RoundingDecimals,
  co2StageTable,
  hkvConsumptionShare,
  hkvCutNotByConsumption,
  hkvCutRemoteReading,
  hkvDegreeDays,
  hkvRemoteReadingRetrofit,
  hkvRemoteReadingNewDevices,
  practiceVacancyPersons,
  ustgStandardRate,
]

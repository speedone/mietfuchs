// Alle Parameter des Registers, für die Prüfungen in server/test/law.test.ts und den Wächter. Wer
// einen Parameter anlegt, trägt ihn hier ein; ein Test sucht in shared/law/ nach `LawParam`-
// Konstanten, die hier fehlen.
import type { LawParam, Timing } from './register.ts'
import type { LawValue } from '../types.ts'
import { betrkvTvSignal, bgbDeadlineMonths, bgbMaxPeriodMonths } from './bgb-betrkv.ts'
import { hkvConsumptionShare, hkvCutNotByConsumption, hkvCutRemoteReading, hkvRemoteReadingRetrofit } from './heizkostenv.ts'
import { practiceVacancyPersons } from './practice.ts'
import { ustgStandardRate } from './ustg.ts'

export const LAW_PARAMS: readonly LawParam<LawValue, Timing>[] = [
  betrkvTvSignal,
  bgbDeadlineMonths,
  bgbMaxPeriodMonths,
  hkvConsumptionShare,
  hkvCutNotByConsumption,
  hkvCutRemoteReading,
  hkvRemoteReadingRetrofit,
  practiceVacancyPersons,
  ustgStandardRate,
]

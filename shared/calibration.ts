// Das Ende der Eichfrist aus der Jahreszahl auf dem Zähler (Heizung PR 21, #98). In shared/, weil das
// Zählerformular den Vorschlag zeigt und der Server dieselbe Regel prüft (server/test/calibration.test.ts).
//
// **Beginn und Ende** (§ 34 Abs. 1 Satz 2 und Abs. 2 MessEV, § 37 Abs. 1 Satz 2 MessEG): Die Frist beginnt
// mit der Eichung oder, beim konformitätsbewerteten Gerät, mit dem Inverkehrbringen, vermutet im Jahr der
// Kennzeichnung („M22“, § 14 Abs. 1 Nr. 2, § 34 Abs. 2 Satz 2); die Eichmarke nennt das Jahr, in dem die Frist
// beginnt (Anlage 8 Nr. 1.1, 2.1). Die Frist endet mit dem Ende des Jahres, in dem sie rechnerisch abläuft;
// bei ganzen Jahren also am 31.12. von Jahreszahl plus Frist. Gerechnet wird mit der Fassung am 1. Januar des
// Jahres; der Tag des Beginns ist nicht bekannt.
//
// **Übergang** (Vorgabe R21-1): Ändert sich die Frist einer Sparte, solange eine Frist noch läuft (bis zum
// 31.12. ihres Endjahres), gilt ab dem Inkrafttreten die neue Zahl, gerechnet vom selben Beginn. Eine schon
// abgelaufene Frist lebt nicht wieder auf. Die Dritte Änderungsverordnung zur MessEV (BGBl. 2021 I S. 4742)
// enthält dazu keine Übergangsregel (Art. 2 regelt nur das Inkrafttreten, § 58 Abs. 7 MessEV betrifft § 25);
// ohne eine solche gilt die neue Fassung ab ihrem Inkrafttreten auch für eine laufende Frist, denn das
// Verbot des § 37 Abs. 1 MessEG knüpft an die „bestimmte Eichfrist“ an. Der Vorschlag sagt es so:
// Die Änderungsverordnung vom 26.10.2021 enthält keine Übergangsregel. Mietfuchs wendet die Frist von 6 Jahren
// auch auf Fristen an, die am 03.11.2021 noch liefen; eine schon abgelaufene Frist lebt nicht wieder auf. Das
// ist eine Auslegung.
import type { MeterType } from './types.ts'
import { CALIBRATED_METER_TYPES, messevCalibrationYears, type CalibrationYears } from './law/messev.ts'
import { coversDate, versionAt, yearStart, type LawParam } from './law/register.ts'

export type CalibratedMeterType = (typeof CALIBRATED_METER_TYPES)[number]

export const isCalibratedType = (t: MeterType): t is CalibratedMeterType =>
  CALIBRATED_METER_TYPES.some((x) => x === t)

export type CalibrationEnd =
  // `change`: die Frist lief beim Inkrafttreten einer neuen Zahl noch und richtet sich seitdem nach ihr.
  | { kind: 'end'; year: number; years: number; change: { from: string; before: number; after: number } | null }
  // Vor der ersten Fassung des Registers (Eichordnung): Mietfuchs führt deren Fristen nicht.
  | { kind: 'beforeRegister'; firstYear: number }
  // Sparten, deren Frist von der Bauart abhängt (Gas, Strom) oder die nicht eichpflichtig sind.
  | { kind: 'notInRegister' }

// `param` nur für Tests mit erfundenen Fassungen; sonst das Register.
export function calibrationEnd(type: MeterType, markedYear: number, param: LawParam<CalibrationYears> = messevCalibrationYears): CalibrationEnd {
  if (!isCalibratedType(type)) return { kind: 'notInRegister' }
  const start = yearStart(markedYear)
  if (!coversDate(param, start)) {
    const first = param.versions[0]?.validFrom ?? start
    return { kind: 'beforeRegister', firstYear: Number(first.slice(0, 4)) }
  }
  const initial = versionAt(param, start).value[type]
  let years = initial
  let changedFrom: string | null = null
  // Die späteren Fassungen der Reihe nach: Tritt eine in Kraft, solange die Frist läuft, gilt ihre Zahl.
  for (const v of param.versions) {
    const from = v.validFrom
    if (from === undefined || from <= start) continue
    if (from > `${markedYear + years}-12-31`) break
    const after = v.value[type]
    if (after !== years) {
      changedFrom = from
      years = after
    }
  }
  const change = changedFrom !== null && years !== initial ? { from: changedFrom, before: initial, after: years } : null
  return { kind: 'end', year: markedYear + years, years, change }
}

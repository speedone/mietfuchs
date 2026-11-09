// Ob die Feiertage an einem Tag amtlich gelesen sind (Auflage aus #290, Entwurf zu #334, E6): wahr, wenn
// jede an dem Tag geltende Fassung jedes `holiday.*` im Rechtsregister `checked` ist oder eine Landesliste, die
// bis auf abgeglichene Länder (Bremen, Hamburg; STATE_HOLIDAY_LAW_CROSS_CHECKED, Entscheidung vom 09.11.2026) gelesen ist. Wer mit Feiertagen
// eine Zahl mit Folgen rechnet (Rückstand im Mietkonto), fragt vorher hier und nimmt sonst eine sichere
// Grenze ohne Feiertage. Ältere Fassungen (Reformationstag 2017, Frauentag vor 2019) bleiben `adopted`;
// für sie ist die Antwort falsch.
//
// Eine eigene Datei, damit shared/holidays.ts unverändert die Auskunft bleibt und der Wächter in
// server/test/holidays.test.ts jeden Einsatz im Server einzeln sieht.
import { versionAt } from './law/register.ts'
import { HOLIDAY_PARAMS, isCrossCheckedStateList } from './law/feiertagsgesetze.ts'
import { parseIsoDate } from './holidays.ts'

export function holidaysCheckedOn(date: string): boolean {
  parseIsoDate(date)
  return HOLIDAY_PARAMS.every((p) => {
    const { source } = versionAt(p, date)
    return source.checked === 'checked' || isCrossCheckedStateList(source)
  })
}

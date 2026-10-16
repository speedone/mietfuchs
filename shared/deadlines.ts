// Fristen des Mietrechts nach Werktagen, als reine Funktionen: Datum hinein, Datum heraus, ohne Uhr und
// ohne Datenzugriff. Die Regeln stehen im Rechtsregister (shared/law/bgb-betrkv.ts: `bgb.rent-due-workday`,
// `bgb.rent-due-saturday`, `bgb.deadline-on-workday`), die Feiertage in shared/holidays.ts; maßgeblich ist
// das Land des Objekts (`Property.state`), ohne Angabe gelten nur die Feiertage aller Länder.
//
// Daten sind 'JJJJ-MM-TT', Monate 'JJJJ-MM', gerechnet in UTC wie im übrigen Projekt.
//
// **Nichts wird still ersetzt.** Das Mietkonto zählt einen Monat weiterhin erst ab dem Folgemonat als
// fällig (#133, `ledgerRows` in server/src/calc.ts). Diese Bausteine werden dort eingesetzt, wo eine
// Frist genau sein muss, und jeder Einsatz ist eine eigene Entscheidung mit eigenem Test. Rechnet eine
// Abrechnung einmal damit, fragt sie das Register mit `law()` und Protokoll statt mit `valueAt`.
import type { FederalState } from './types.ts'
import { addDays, isHoliday, isWorkday, parseIsoDate, weekdayOf } from './holidays.ts'
import { valueAt } from './law/register.ts'
import { bgbDeadlineOnWorkday, bgbRentDueSaturday, bgbRentDueWorkday } from './law/bgb-betrkv.ts'

const MONTH = /^(\d{4})-(\d{2})$/

// Spätester Tag, an dem die Miete eines Monats pünktlich ist: der dritte Werktag (§ 556b Abs. 1 BGB),
// und der Samstag zählt dabei nicht als Werktag (BGH, Urteil vom 13.07.2010, VIII ZR 129/09). Beides aus
// dem Register, gefragt am Ersten des Monats.
//
// Pünktlich ist der Mieter, wenn er bis zu diesem Tag bei gedecktem Konto überwiesen hat; wann das
// Geld beim Vermieter eingeht, ist dafür nicht entscheidend (BGH, Urteil vom 05.10.2016,
// VIII ZR 222/15). Ein Zahlungseingang ein paar Tage später ist deshalb kein Beleg für Verspätung.
//
// Bemessen nach Monaten, wie es Mietfuchs für alle Mieten annimmt.
export function rentDueDate(month: string, state: FederalState | null): string {
  const m = MONTH.exec(month)
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new RangeError(`„${month}“ ist kein Monat in der Form JJJJ-MM.`)
  const first = `${month}-01`
  const nth = valueAt(bgbRentDueWorkday, first)
  const saturday = valueAt(bgbRentDueSaturday, first)
  let day = first
  let count = 0
  for (;;) {
    if (isWorkday(day, state, { saturday }) && ++count === nth) return day
    day = addDays(day, 1)
  }
}

// § 193 BGB: Fällt der letzte Tag einer Frist auf einen Sonnabend, Sonntag oder einen am Erklärungs- oder
// Leistungsort staatlich anerkannten allgemeinen Feiertag, tritt an seine Stelle der nächste Werktag.
// Welche Tage das sind, steht im Register (`bgb.deadline-on-workday`), gefragt am Tag des Fristendes.
//
// Ein Werktag bleibt, wie er ist. Als Ort nimmt Mietfuchs das Land des Objekts. Ob § 193 BGB auf eine
// bestimmte Frist überhaupt anzuwenden ist, entscheidet der Aufrufer, nicht diese Funktion.
export function deadlineOnWorkday(date: string, state: FederalState | null): string {
  parseIsoDate(date)
  const shift = valueAt(bgbDeadlineOnWorkday, date)
  const moves = (d: string): boolean => {
    const wd = weekdayOf(d)
    return (shift.saturday && wd === 6) || (shift.sunday && wd === 0) || (shift.holiday && isHoliday(d, state))
  }
  let day = date
  while (moves(day)) day = addDays(day, 1)
  return day
}

// Für Texte (Mietkonto): die Regel in Worten, aus dem Register zum Stichtag des Rechtsstands.
export function rentDueRuleText(atDate: string): string {
  const nth = valueAt(bgbRentDueWorkday, atDate)
  const saturday = valueAt(bgbRentDueSaturday, atDate)
  return `${nth}. Werktag${saturday ? '' : ', Samstag nicht mitgezählt'}`
}

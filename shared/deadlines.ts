// Fristen des Mietrechts nach Werktagen, als reine Funktionen: Datum hinein, Datum heraus, ohne Uhr und
// ohne Datenzugriff. Welche Tage Feiertage sind, steht in shared/holidays.ts; maßgeblich ist das Land
// des Objekts (`Property.state`), ohne Angabe gelten nur die Feiertage aller Länder.
//
// Daten sind 'JJJJ-MM-TT', Monate 'JJJJ-MM', gerechnet in UTC wie im übrigen Projekt.
//
// **Nichts wird still ersetzt.** Das Mietkonto zählt einen Monat weiterhin erst ab dem Folgemonat als
// fällig (#133, `ledgerRows` in server/src/calc.ts). Diese Bausteine werden dort eingesetzt, wo eine
// Frist genau sein muss, und jeder Einsatz ist eine eigene Entscheidung mit eigenem Test.
import type { FederalState } from './types.ts'
import { addDays, isWorkday, parseIsoDate } from './holidays.ts'

const MONTH = /^(\d{4})-(\d{2})$/

// Der wievielte Werktag eines Monats die Miete spätestens bringt (§ 556b Abs. 1 BGB).
export const RENT_DUE_WORKDAY = 3

// Spätester Tag, an dem die Miete eines Monats pünktlich ist: der dritte Werktag (§ 556b Abs. 1 BGB:
// „Die Miete ist zu Beginn, spätestens bis zum dritten Werktag der einzelnen Zeitabschnitte zu
// entrichten, nach denen sie bemessen ist.“).
//
// **Der Samstag zählt dabei nicht als Werktag** (BGH, Urteil vom 13.07.2010, VIII ZR 129/09;
// Pressemitteilung Nr. 144/2010): Die drei Tage sollen dem Mieter ungeschmälert zur Verfügung stehen,
// und Bankgeschäftstage sind Montag bis Freitag.
//
// Pünktlich ist der Mieter, wenn er bis zu diesem Tag bei gedecktem Konto überwiesen hat; wann das
// Geld beim Vermieter eingeht, ist dafür nicht entscheidend (BGH, Urteil vom 05.10.2016,
// VIII ZR 222/15). Ein Zahlungseingang ein paar Tage später ist deshalb kein Beleg für Verspätung.
//
// Bemessen nach Monaten, wie es Mietfuchs für alle Mieten annimmt.
export function rentDueDate(month: string, state: FederalState | null): string {
  const m = MONTH.exec(month)
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new RangeError(`„${month}“ ist kein Monat in der Form JJJJ-MM.`)
  let day = `${month}-01`
  let count = 0
  for (;;) {
    if (isWorkday(day, state, { saturday: false }) && ++count === RENT_DUE_WORKDAY) return day
    day = addDays(day, 1)
  }
}

// § 193 BGB: „Ist an einem bestimmten Tage oder innerhalb einer Frist eine Willenserklärung abzugeben
// oder eine Leistung zu bewirken und fällt der bestimmte Tag oder der letzte Tag der Frist auf einen
// Sonntag, einen am Erklärungs- oder Leistungsort staatlich anerkannten allgemeinen Feiertag oder einen
// Sonnabend, so tritt an die Stelle eines solchen Tages der nächste Werktag.“
//
// Ein Werktag bleibt, wie er ist; sonst der nächste Tag, der weder Samstag noch Sonntag noch Feiertag
// ist. Als Ort nimmt Mietfuchs das Land des Objekts. Ob § 193 BGB auf eine bestimmte Frist überhaupt
// anzuwenden ist, entscheidet der Aufrufer, nicht diese Funktion.
export function deadlineOnWorkday(date: string, state: FederalState | null): string {
  parseIsoDate(date)
  let day = date
  while (!isWorkday(day, state, { saturday: false })) day = addDays(day, 1)
  return day
}

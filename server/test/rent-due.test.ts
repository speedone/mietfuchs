// Fälligkeit der Miete je Regel und erwarteter Eingang (#334, shared/rentDue.ts). Beispiele von Hand nachgezählt, dazu
// Abgleiche über alle Länder und Monate, Invarianten über zufällige Mietverhältnisse mit festem Startwert und die
// Zeitzone. Die Feiertage zählen für den Rückstand nur, wo alle am Tag geltenden Fassungen amtlich gelesen sind
// (Entwurf E6, `holidaysCheckedOn`); die Beispiele mit Feiertagen reichen deshalb `holidaysChecked: () => true` hinein,
// die sichere Grenze wird mit `() => false` geprüft, und die Voreinstellung folgt dem Register.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  arrearsFrom, creditExpectedBy, effectiveRentDue, holidaysCheckedOn, isBankBusinessDay, monthDue, rentDueOn, safeArrearsFrom,
  type RentDueTerms,
} from '../../shared/rentDue.ts'
import { addDays, holidaysOf, localHolidaysOf, STATE_CODES, weekdayOf } from '../../shared/holidays.ts'
import { rentDueDate } from '../../shared/deadlines.ts'
import { createLawLog, dayAfter } from '../../shared/law/register.ts'
import { HOLIDAY_PARAMS } from '../../shared/law/feiertagsgesetze.ts'
import type { FederalState } from '../../shared/types.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const CHECKED = { holidaysChecked: (): boolean => true }
const UNCHECKED = { holidaysChecked: (): boolean => false }
const terms = (over: Partial<RentDueTerms> = {}): RentDueTerms => ({ start: '2020-01-01', end: null, ...over })

const monthsFrom = (from: string, to: string): string[] => {
  const out: string[] = []
  for (let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7)); `${y}-${String(m).padStart(2, '0')}` <= to; m === 12 ? (y++, m = 1) : m++) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
  }
  return out
}
const nextMonthFirst = (month: string): string => {
  const y = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
}
const afterNextFirst = (month: string): string => nextMonthFirst(nextMonthFirst(month).slice(0, 7))

// ---------- Beispiele aus dem Entwurf ----------

test('Einzug Fr 09.10.2026: fällig Di 13.10., Eingang erwartet bis Mo 19.10., Rückstand ab 20.10.', () => {
  const t = terms({ start: '2026-10-09' })
  assert.equal(effectiveRentDue(t), 'startWorkday')
  // Fr 09. (1), Mo 12. (2), Di 13. (3); der Samstag zählt nicht (VIII ZR 129/09).
  assert.equal(rentDueOn(t, '2026-10', 'NW'), '2026-10-13')
  // Mi 14., Do 15., Fr 16., Mo 19.
  assert.equal(creditExpectedBy('2026-10-13'), '2026-10-19')
  assert.equal(arrearsFrom(t, '2026-10', 'NW', CHECKED), '2026-10-20')
  const at = (asOf: string) => monthDue(t, '2026-10', 'NW', asOf, CHECKED)
  assert.deepEqual(at('2026-10-13'), { dueOn: '2026-10-13', creditExpectedBy: '2026-10-19', arrearsFrom: '2026-10-20', arrears: false })
  assert.equal(at('2026-10-19').arrears, false)
  assert.equal(at('2026-10-20').arrears, true)
  // Ohne geprüfte Feiertage gilt im Einzugsmonat die sichere Grenze: der Erste des übernächsten Monats (E6).
  assert.equal(arrearsFrom(t, '2026-10', 'NW', UNCHECKED), '2026-12-01')
  assert.equal(monthDue(t, '2026-10', 'NW', '2026-11-30', UNCHECKED).arrears, false)
  assert.equal(monthDue(t, '2026-10', 'NW', '2026-12-01', UNCHECKED).arrears, true)
  // Der Folgemonat ist ein voller Monat: November 2026 Mo 2. (1), Di 3. (2), Mi 4. (3); erwartet bis Di 10.11.
  assert.equal(rentDueOn(t, '2026-11', 'NW'), '2026-11-04')
  assert.equal(arrearsFrom(t, '2026-11', 'NW', CHECKED), '2026-11-11')
  assert.equal(arrearsFrom(t, '2026-11', 'NW', UNCHECKED), '2026-12-01')
})

test('Erste Miete schon bei Mietbeginn fällig: der Mietbeginn, nach § 193 BGB verschoben', () => {
  assert.equal(rentDueOn(terms({ start: '2026-10-09', firstRentAtStart: true }), '2026-10', 'NW'), '2026-10-09')
  // Sa 10.10.2026 → Mo 12.10.2026
  assert.equal(rentDueOn(terms({ start: '2026-10-10', firstRentAtStart: true }), '2026-10', 'NW'), '2026-10-12')
  // Nur der erste Monat: im November wieder der dritte Werktag.
  assert.equal(rentDueOn(terms({ start: '2026-10-10', firstRentAtStart: true }), '2026-11', 'NW'), '2026-11-04')
  // Auch beim Altvertrag und beim festen Tag gilt im ersten Monat der Mietbeginn.
  assert.equal(rentDueOn(terms({ start: '2026-10-09', firstRentAtStart: true, rentDue: 'inArrears' }), '2026-10', 'NW'), '2026-10-09')
  assert.equal(rentDueOn(terms({ start: '2026-10-09', firstRentAtStart: true, rentDue: 'dayOfMonth', rentDueDay: 20 }), '2026-10', 'NW'), '2026-10-09')
  // Ohne geprüfte Feiertage: Einzugsmonat, also der Erste des übernächsten Monats.
  assert.equal(arrearsFrom(terms({ start: '2026-10-09', firstRentAtStart: true }), '2026-10', 'NW', UNCHECKED), '2026-12-01')
})

test('Fester Tag: § 193 BGB, kurzer Monat, Einzugsmonat', () => {
  const t = terms({ rentDue: 'dayOfMonth', rentDueDay: 15 })
  // 15.03.2026 ist ein Sonntag.
  assert.equal(weekdayOf('2026-03-15'), 0)
  assert.equal(rentDueOn(t, '2026-03', 'NW'), '2026-03-16')
  // Mo 16. → Di 17., Mi 18., Do 19., Fr 20.
  assert.equal(arrearsFrom(t, '2026-03', 'NW', CHECKED), '2026-03-21')
  assert.equal(arrearsFrom(t, '2026-03', 'NW', UNCHECKED), '2026-05-01')
  // Tag 31 im Februar 2026: der 28. ist ein Samstag, also Montag, 02.03.2026.
  assert.equal(rentDueOn(terms({ rentDue: 'dayOfMonth', rentDueDay: 31 }), '2026-02', 'NW'), '2026-03-02')
  // Tag 31 im April: der 30. (Donnerstag).
  assert.equal(rentDueOn(terms({ rentDue: 'dayOfMonth', rentDueDay: 31 }), '2026-04', 'NW'), '2026-04-30')
  // Einzug Fr 20.03.2026 mit Tag 15: der spätere vom vereinbarten Tag und dem dritten Werktag ab dem Einzug (Fr 20.,
  // Mo 23., Di 24.).
  assert.equal(rentDueOn(terms({ start: '2026-03-20', rentDue: 'dayOfMonth', rentDueDay: 15 }), '2026-03', 'NW'), '2026-03-24')
  // Einzug am 05.03.2026 mit Tag 15: der vereinbarte Tag ist später.
  assert.equal(rentDueOn(terms({ start: '2026-03-05', rentDue: 'dayOfMonth', rentDueDay: 15 }), '2026-03', 'NW'), '2026-03-16')
  // Feiertag am Ort: 03.10.2028 ist ein Dienstag (Tag der Deutschen Einheit).
  assert.equal(rentDueOn(terms({ rentDue: 'dayOfMonth', rentDueDay: 3 }), '2028-10', 'BY'), '2028-10-04')
  assert.throws(() => rentDueOn(terms({ rentDue: 'dayOfMonth' }), '2026-03', 'NW'), /Tag/)
})

test('Nach Ablauf des Monats (Altvertrag): der Erste des Folgemonats bzw. der Tag nach dem Mietende, nach § 193 BGB', () => {
  const t = terms({ rentDue: 'inArrears' })
  // 01.04.2026 ist ein Mittwoch.
  assert.equal(rentDueOn(t, '2026-03', 'NW'), '2026-04-01')
  // 01.05.2026 (Freitag, Tag der Arbeit) → Mo 04.05.
  assert.equal(rentDueOn(t, '2026-04', 'NW'), '2026-05-04')
  // Dezember 2026: 01.01.2027 Freitag (Neujahr) → Mo 04.01.2027.
  assert.equal(rentDueOn(t, '2026-12', 'NW'), '2027-01-04')
  // Auszug am 15.06.2026: fällig am Di 16.06.2026.
  assert.equal(rentDueOn(terms({ rentDue: 'inArrears', end: '2026-06-15' }), '2026-06', 'NW'), '2026-06-16')
  // Auszug am Freitag, 12.06.2026: Sa 13. → Mo 15.06.
  assert.equal(rentDueOn(terms({ rentDue: 'inArrears', end: '2026-06-12' }), '2026-06', 'NW'), '2026-06-15')
  // Auszug am Monatsletzten: der Erste des Folgemonats (01.07.2026, Mittwoch).
  assert.equal(rentDueOn(terms({ rentDue: 'inArrears', end: '2026-06-30' }), '2026-06', 'NW'), '2026-07-01')
  assert.equal(arrearsFrom(t, '2026-03', 'NW', UNCHECKED), '2026-05-01')
  // Mi 01.04. → Do 02., Karfreitag 03.04. und Ostermontag 06.04. nicht, Di 07., Mi 08., Do 09.
  assert.equal(arrearsFrom(t, '2026-03', 'NW', CHECKED), '2026-04-10')
})

test('Gesetzliche Vorgabe: Mietverhältnis am 01.09.2001 bestehend nach Ablauf des Monats, danach zu Beginn', () => {
  assert.equal(effectiveRentDue(terms({ start: '2005-01-01', contractDate: '1998-03-15' })), 'inArrears')
  assert.equal(effectiveRentDue(terms({ start: '1998-04-01' })), 'inArrears')
  assert.equal(effectiveRentDue(terms({ start: '2001-09-01' })), 'inArrears')
  assert.equal(effectiveRentDue(terms({ start: '2001-09-02' })), 'startWorkday')
  // Ein Vertragsdatum nach dem Beginn zählt nicht; maßgeblich ist das frühere.
  assert.equal(effectiveRentDue(terms({ start: '2001-08-01', contractDate: '2001-10-01' })), 'inArrears')
  assert.equal(effectiveRentDue(terms({ start: '2002-01-01', contractDate: 'kaputt' })), 'startWorkday')
  // Eine eingestellte Regel geht vor.
  assert.equal(effectiveRentDue(terms({ start: '1998-04-01', rentDue: 'startWorkday' })), 'startWorkday')
  assert.equal(effectiveRentDue(terms({ start: '2020-01-01', rentDue: 'inArrears' })), 'inArrears')
  assert.equal(effectiveRentDue(terms({ rentDue: 'dayOfMonth', rentDueDay: 3 })), 'dayOfMonth')
  // `null` heißt gesetzlich (so liest es die Datenbank).
  assert.equal(effectiveRentDue(terms({ start: '1998-04-01', rentDue: null })), 'inArrears')
  // Protokolliert wird die gefragte Fassung.
  const log = createLawLog()
  effectiveRentDue(terms({ start: '1998-04-01' }), log)
  assert.deepEqual(log.values.map((v) => [v.id, v.validTo]), [['bgb.rent-due-at-start', '2001-09-01']])
})

test('Altvertrag ohne Angabe: März 2026 nie im März Rückstand, erst nach dem erwarteten Eingang ab dem 01.04.', () => {
  const t = terms({ start: '1998-04-01', contractDate: '1998-03-15' })
  for (const asOf of ['2026-03-15', '2026-03-31', '2026-04-01', '2026-04-09']) {
    assert.equal(monthDue(t, '2026-03', 'NW', asOf, CHECKED).arrears, false, asOf)
  }
  assert.equal(monthDue(t, '2026-03', 'NW', '2026-04-10', CHECKED).arrears, true)
  assert.equal(monthDue(t, '2026-03', 'NW', '2026-04-30', UNCHECKED).arrears, false)
  assert.equal(monthDue(t, '2026-03', 'NW', '2026-05-01', UNCHECKED).arrears, true)
})

test('Erwarteter Eingang: vier Bankgeschäftstage, über Weihnachten und den Jahreswechsel', () => {
  // Mi 23.12.2026: 24.12. kein Geschäftsbetrieb, 25./26. Feiertage, 27. Sonntag, Mo 28. (1), Di 29. (2), Mi 30. (3),
  // 31.12. kein Geschäftsbetrieb, 01.01. Neujahr, 02./03. Wochenende, Mo 04.01.2027 (4).
  assert.equal(creditExpectedBy('2026-12-23'), '2027-01-04')
  // Do 24.12.2026 als Fälligkeitstag (fester Tag 24): ab Mo 28.12. → Mo 04.01.2027.
  assert.equal(creditExpectedBy('2026-12-24'), '2027-01-04')
  // Do 31.12.2026: Mo 04., Di 05., Mi 06. (Heilige Drei Könige in BW, BY, ST, also kein Bankgeschäftstag), Do 07., Fr 08.
  assert.equal(creditExpectedBy('2026-12-31'), '2027-01-08')
  // Fester Tag 24 und 31 im Dezember 2026, mit § 193 BGB: beides sind Werktage (keine gesetzlichen Feiertage).
  assert.equal(rentDueOn(terms({ rentDue: 'dayOfMonth', rentDueDay: 24 }), '2026-12', 'NW'), '2026-12-24')
  assert.equal(rentDueOn(terms({ rentDue: 'dayOfMonth', rentDueDay: 31 }), '2026-12', 'NW'), '2026-12-31')
  // Dezember 2026, dritter Werktag: Di 1., Mi 2., Do 3.; erwartet bis Mi 09.12.
  assert.equal(rentDueOn(terms(), '2026-12', 'NW'), '2026-12-03')
  assert.equal(arrearsFrom(terms(), '2026-12', 'NW', CHECKED), '2026-12-10')
  // Januar 2027 (Jahreswechsel): Neujahr Fr 1., Mo 4. (1), Di 5. (2), Mi 6. (3) in NW; erwartet bis Mi 13.01. (der 6.
  // ist in drei Ländern Feiertag und zählt nicht als Bankgeschäftstag: Do 7., Fr 8., Mo 11., Di 12.).
  assert.equal(rentDueOn(terms(), '2027-01', 'NW'), '2027-01-06')
  assert.equal(creditExpectedBy('2027-01-06'), '2027-01-12')
  assert.equal(arrearsFrom(terms(), '2027-01', 'NW', CHECKED), '2027-01-13')
})

test('Bankgeschäftstag: Montag bis Freitag, kein Feiertag in irgendeinem Land (auch nur in Gemeinden), nicht 24. und 31.12.', () => {
  assert.equal(isBankBusinessDay('2026-10-13'), true)
  assert.equal(isBankBusinessDay('2026-10-10'), false) // Samstag
  assert.equal(isBankBusinessDay('2026-10-11'), false) // Sonntag
  assert.equal(isBankBusinessDay('2026-12-24'), false)
  assert.equal(isBankBusinessDay('2026-12-31'), false)
  assert.equal(isBankBusinessDay('2026-12-30'), true)
  assert.equal(isBankBusinessDay('2027-01-06'), false) // Heilige Drei Könige in BW, BY, ST
  assert.equal(isBankBusinessDay('2026-11-18'), false) // Buß- und Bettag in Sachsen
  assert.equal(isBankBusinessDay('2026-09-21'), true) // kein Feiertag (Weltkindertag 2026 ist Sonntag, der 20.)
  assert.equal(isBankBusinessDay('2027-09-20'), false) // Weltkindertag in Thüringen, Montag
  assert.equal(isBankBusinessDay('2026-08-10'), true)
  assert.equal(isBankBusinessDay('2025-08-08'), false) // Augsburger Friedensfest (nur Augsburg), Freitag
  assert.equal(isBankBusinessDay('2025-08-15'), false) // Mariä Himmelfahrt (Saarland, Teile Bayerns), Freitag
  assert.equal(isBankBusinessDay('2026-03-09'), true)
  assert.equal(isBankBusinessDay('2027-03-08'), false) // Frauentag in Berlin und Mecklenburg-Vorpommern, Montag
  // Ein Tag, der in keinem Land Feiertag ist, gleich nach der Formel aus dem Register gezählt:
  for (let d = '2026-01-01'; d <= '2026-12-31'; d = addDays(d, 1)) {
    const wd = weekdayOf(d)
    const y = Number(d.slice(0, 4))
    const holiday = STATE_CODES.some((s) => holidaysOf(y, s).some((h) => h.date === d) || localHolidaysOf(y, s).some((h) => h.date === d))
    const expected = wd >= 1 && wd <= 5 && !holiday && !d.endsWith('-12-24') && !d.endsWith('-12-31')
    assert.equal(isBankBusinessDay(d), expected, d)
  }
})

// ---------- Ohne Land, Gemeindefeiertage, volle Monate ----------

// Der dritte Werktag ab einem Tag, unabhängig gezählt: mit den Feiertagen des Landes und der Gemeinden.
function thirdWorkday(from: string, state: FederalState): string {
  let day = from
  let n = 0
  for (;;) {
    const wd = weekdayOf(day)
    const y = Number(day.slice(0, 4))
    const holiday = holidaysOf(y, state).some((h) => h.date === day) || localHolidaysOf(y, state).some((h) => h.date === day)
    if (wd !== 0 && wd !== 6 && !holiday && ++n === 3) return day
    day = addDays(day, 1)
  }
}

test('Volle Monate, Land gesetzt: der dritte Werktag wie rentDueDate, außer ein Feiertag einzelner Gemeinden fällt davor', () => {
  let localHits = 0
  for (const month of monthsFrom('2019-01', '2040-12')) {
    for (const s of STATE_CODES) {
      const got = rentDueOn(terms({ start: '2018-01-01' }), month, s)
      const expected = thirdWorkday(`${month}-01`, s)
      assert.equal(got, expected, `${month} ${s}`)
      const plain = rentDueDate(month, s)
      if (got !== plain) {
        localHits++
        assert.ok(got > plain, `${month} ${s}: ${got} vor ${plain}`)
        assert.ok(localHolidaysOf(Number(month.slice(0, 4)), s).some((h) => h.date >= `${month}-01` && h.date <= got), `${month} ${s}: ohne Gemeindefeiertag verschoben`)
      }
    }
  }
  assert.ok(localHits > 0, 'kein Fall mit Gemeindefeiertag gefunden')
  // Fronleichnam 2021 am Donnerstag, 03.06.: in Sachsen nur in Gemeinden um Bautzen, Hoyerswerda und Kamenz.
  assert.equal(rentDueDate('2021-06', 'SN'), '2021-06-03')
  assert.equal(rentDueOn(terms({ start: '2018-01-01' }), '2021-06', 'SN'), '2021-06-04')
})

test('Ohne Land: der späteste Tag aller Länder, Monate 2019 bis 2100, nie früher als die Auskunft ohne Land', () => {
  for (const month of monthsFrom('2019-01', '2100-12')) {
    const latest = STATE_CODES.map((s) => thirdWorkday(`${month}-01`, s)).sort().at(-1)
    const got = rentDueOn(terms({ start: '2018-01-01' }), month, null)
    assert.equal(got, latest, month)
    assert.ok(got >= rentDueDate(month, null), month)
    // Und daraus nie ein früherer Rückstand als in irgendeinem Land.
    for (const s of STATE_CODES) assert.ok(arrearsFrom(terms({ start: '2018-01-01' }), month, null, CHECKED) >= arrearsFrom(terms({ start: '2018-01-01' }), month, s, CHECKED), `${month} ${s}`)
  }
  // Januar 2027: in Baden-Württemberg, Bayern und Sachsen-Anhalt der 07.01., anderswo der 06.01.
  assert.equal(rentDueOn(terms(), '2027-01', null), '2027-01-07')
  assert.equal(rentDueOn(terms(), '2027-01', 'NW'), '2027-01-06')
})

test('Feiertage je Land: Allerheiligen, Buß- und Bettag, Reformationstag, Fronleichnam', () => {
  // November 2027 beginnt mit Allerheiligen am Montag.
  assert.equal(rentDueOn(terms(), '2027-11', 'BW'), '2027-11-04')
  assert.equal(rentDueOn(terms(), '2027-11', 'HH'), '2027-11-03')
  // Fester Tag 18 im November 2026: Buß- und Bettag (Mittwoch) nur in Sachsen.
  const d18 = terms({ rentDue: 'dayOfMonth', rentDueDay: 18 })
  assert.equal(rentDueOn(d18, '2026-11', 'SN'), '2026-11-19')
  assert.equal(rentDueOn(d18, '2026-11', 'BY'), '2026-11-18')
  assert.equal(rentDueOn(d18, '2026-11', null), '2026-11-19')
  // Altvertrag Oktober 2025: Fr 31.10. ist nicht betroffen, der Erste des Folgemonats ist Allerheiligen (Samstag): Mo 03.11.
  assert.equal(rentDueOn(terms({ rentDue: 'inArrears' }), '2025-10', 'NW'), '2025-11-03')
  // Auszug 30.10.2025 (Donnerstag) beim Altvertrag: fällig am 31.10., in Niedersachsen Reformationstag, also Mo 03.11.
  assert.equal(rentDueOn(terms({ rentDue: 'inArrears', end: '2025-10-30' }), '2025-10', 'NI'), '2025-11-03')
  assert.equal(rentDueOn(terms({ rentDue: 'inArrears', end: '2025-10-30' }), '2025-10', 'NW'), '2025-10-31')
  // Fronleichnam 2021 (Do 03.06.) in Nordrhein-Westfalen landesweit, in Hamburg nicht.
  assert.equal(rentDueOn(terms(), '2021-06', 'NW'), '2021-06-04')
  assert.equal(rentDueOn(terms(), '2021-06', 'HH'), '2021-06-03')
})

// ---------- sichere Grenze, Prüfstand der Feiertage ----------

test('Sichere Grenze ohne geprüfte Feiertage: voller Monat zu Beginn ab dem Ersten des Folgemonats, sonst des übernächsten', () => {
  assert.equal(safeArrearsFrom(terms({ start: '2010-01-01' }), '2017-10'), '2017-11-01')
  assert.equal(safeArrearsFrom(terms({ start: '2010-01-01', rentDue: 'dayOfMonth', rentDueDay: 3 }), '2017-10'), '2017-12-01')
  assert.equal(safeArrearsFrom(terms({ start: '2010-01-01', rentDue: 'inArrears' }), '2017-10'), '2017-12-01')
  assert.equal(safeArrearsFrom(terms({ start: '2017-10-02' }), '2017-10'), '2017-12-01')
  assert.equal(safeArrearsFrom(terms({ start: '2017-10-01', firstRentAtStart: true }), '2017-10'), '2017-12-01')
  assert.equal(safeArrearsFrom(terms(), '2026-12'), '2027-01-01')
  assert.equal(safeArrearsFrom(terms({ rentDue: 'inArrears' }), '2026-12'), '2027-02-01')
  // Vor dem geprüften Zeitraum gilt sie auch mit der Voreinstellung (die Fassungen von 2017 sind nicht amtlich gelesen).
  assert.equal(holidaysCheckedOn('2017-10-31'), false)
  assert.equal(arrearsFrom(terms({ start: '2010-01-01' }), '2017-10', 'BY'), '2017-11-01')
  assert.equal(arrearsFrom(terms({ start: '2010-01-01', rentDue: 'inArrears' }), '2017-10', 'BY'), '2017-12-01')
  // Vor 1995 rechnet Mietfuchs keine Feiertage: auch mit geprüften Feiertagen die sichere Grenze, und keine Auskunft.
  // Ohne Angabe ist ein Mietverhältnis von 1980 nach Ablauf des Monats fällig.
  assert.equal(arrearsFrom(terms({ start: '1980-01-01' }), '1990-03', 'BY', CHECKED), '1990-05-01')
  assert.equal(arrearsFrom(terms({ start: '1980-01-01', rentDue: 'startWorkday' }), '1990-03', 'BY', CHECKED), '1990-04-01')
  assert.deepEqual(monthDue(terms({ start: '1980-01-01' }), '1990-03', 'BY', '2026-11-07', CHECKED), { dueOn: null, creditExpectedBy: null, arrearsFrom: '1990-05-01', arrears: true })
  assert.equal(monthDue(terms({ start: '1980-01-01' }), '1990-03', 'BY', '1990-04-30', CHECKED).arrears, false)
  // Einzug Fr 30.10.2026: ohne geprüfte Feiertage der 01.12.2026, nicht der 01.11.; mit: fällig Di 03.11., erwartet bis
  // Mo 09.11.
  const late = terms({ start: '2026-10-30' })
  assert.equal(arrearsFrom(late, '2026-10', 'NW', UNCHECKED), '2026-12-01')
  assert.equal(rentDueOn(late, '2026-10', 'NW'), '2026-11-03')
  assert.equal(creditExpectedBy('2026-11-03'), '2026-11-09')
  assert.equal(arrearsFrom(late, '2026-10', 'NW', CHECKED), '2026-11-10')
})

test('holidaysCheckedOn: wahr genau dann, wenn jede am Tag geltende Fassung jedes Feiertags amtlich gelesen ist', () => {
  const expected = (d: string): boolean => HOLIDAY_PARAMS.every((p) => p.versions.filter((v) => (v.validFrom ?? '') <= d && (v.validTo ?? '9999') >= d).every((v) => v.source.checked === 'checked'))
  for (const d of ['1995-01-01', '2017-10-31', '2018-06-29', '2019-02-07', '2022-07-13', '2025-05-08', '2026-11-07', '2028-06-17', '2100-12-31']) {
    assert.equal(holidaysCheckedOn(d), expected(d), d)
  }
  // Die Voreinstellung von arrearsFrom folgt dem Register: Heute geprüft heißt dieselbe Grenze wie mit `() => true`.
  const t = terms({ start: '2026-10-09' })
  const window = ['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19']
  assert.equal(arrearsFrom(t, '2026-10', 'NW'), window.every(holidaysCheckedOn) ? '2026-10-20' : '2026-12-01')
  // Gefragt wird jeder Tag vom Beginn des Abschnitts bis zum erwarteten Eingang, kein Tag davor oder danach.
  const asked: string[] = []
  arrearsFrom(t, '2026-10', 'NW', { holidaysChecked: (d) => (asked.push(d), true) })
  assert.deepEqual([...new Set(asked)].sort(), window)
  // Ein einziger ungeprüfter Tag im Fenster genügt für die sichere Grenze.
  assert.equal(arrearsFrom(t, '2026-10', 'NW', { holidaysChecked: (d) => d !== '2026-10-16' }), '2026-12-01')
})

// ---------- Invarianten ----------

// Zufallszahlen mit festem Startwert (mulberry32), damit ein roter Lauf wiederholbar ist.
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

test('Invariante: Rückstand nie vor dem Tag nach der Fälligkeit, die sichere Grenze nie früher als mit Feiertagen, volle Monate zu Beginn im Monat', () => {
  const random = rng(334)
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T
  const states: readonly (FederalState | null)[] = [...STATE_CODES, null]
  for (let i = 0; i < 3000; i++) {
    // Durchsicht S2: Jahre ab 1995 und Einzug an jedem Tag, auch am 29. bis 31. (Fälligkeit im Folgemonat).
    const year = 1995 + Math.floor(random() * 90)
    const startMonth = 1 + Math.floor(random() * 12)
    const lastDay = new Date(Date.UTC(year, startMonth, 0)).getUTCDate()
    const startDay = random() < 0.3 ? 1 : random() < 0.3 ? lastDay - Math.floor(random() * 3) : 1 + Math.floor(random() * lastDay)
    const start = `${year}-${String(startMonth).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`
    const end = random() < 0.3 ? addDays(start, 20 + Math.floor(random() * 400)) : null
    const rule = pick(['startWorkday', 'dayOfMonth', 'inArrears', undefined] as const)
    const t: RentDueTerms = {
      start, end,
      ...(rule !== undefined ? { rentDue: rule } : {}),
      ...(rule === 'dayOfMonth' ? { rentDueDay: 1 + Math.floor(random() * 31) } : {}),
      ...(random() < 0.2 ? { firstRentAtStart: true } : {}),
      ...(random() < 0.1 ? { contractDate: '1999-05-01' } : {}),
    }
    const offset = Math.floor(random() * 14)
    const month = monthsFrom(start.slice(0, 7), `${year + 2}-12`)[offset] ?? start.slice(0, 7)
    if (end !== null && month > end.slice(0, 7)) continue
    const state = pick(states)
    const label = `${JSON.stringify(t)} ${month} ${state}`
    const due = rentDueOn(t, month, state)
    const expected = creditExpectedBy(due)
    const withHolidays = arrearsFrom(t, month, state, CHECKED)
    const safe = arrearsFrom(t, month, state, UNCHECKED)
    assert.equal(withHolidays, dayAfter(expected), label)
    assert.ok(withHolidays > due, `${label}: Rückstand nicht nach der Fälligkeit`)
    assert.ok(due >= (t.start > `${month}-01` ? t.start : `${month}-01`), `${label}: Fälligkeit vor dem Abschnitt`)
    // Die sichere Grenze liegt nie vor der Grenze mit Feiertagen; sonst wäre sie nicht sicher.
    assert.ok(safe >= withHolidays, `${label}: sichere Grenze ${safe} vor ${withHolidays}`)
    assert.equal(safe, safeArrearsFrom(t, month), label)
    // Ohne Land nie früher als mit irgendeinem Land.
    if (state === null) for (const s of STATE_CODES) assert.ok(withHolidays >= arrearsFrom(t, month, s, CHECKED), `${label} ${s}`)
    const full = !(t.start.slice(0, 7) === month && t.start > `${month}-01`)
    if (effectiveRentDue(t) === 'startWorkday' && full && !(t.firstRentAtStart === true && t.start.slice(0, 7) === month)) {
      assert.ok(withHolidays <= nextMonthFirst(month), `${label}: zu Beginn fällig, aber erst ${withHolidays}`)
      assert.equal(safe, nextMonthFirst(month), label)
    } else {
      assert.equal(safe, afterNextFirst(month), label)
    }
  }
})

test('Invariante: Für volle Monate zu Beginn liegt der Rückstand 2019 bis 2100 in jedem Land im Monat selbst', () => {
  for (const month of monthsFrom('2019-01', '2100-12')) {
    for (const s of [...STATE_CODES, null]) {
      const from = arrearsFrom(terms({ start: '2018-01-01' }), month, s, CHECKED)
      assert.ok(from > `${month}-01` && from <= nextMonthFirst(month), `${month} ${s}: ${from}`)
    }
  }
})

test('die Zeitzone des Rechners ändert nichts', () => {
  const script = [
    "import { arrearsFrom, creditExpectedBy, rentDueOn } from './shared/rentDue.ts'",
    'const yes = { holidaysChecked: () => true }',
    "console.log(JSON.stringify([rentDueOn({ start: '2026-10-09', end: null }, '2026-10', 'NW'), creditExpectedBy('2026-12-23'), arrearsFrom({ start: '2026-10-09', end: null }, '2026-10', null, yes), rentDueOn({ start: '2020-01-01', end: null, rentDue: 'inArrears' }, '2026-12', 'BY'), rentDueOn({ start: '2020-01-01', end: null, rentDue: 'dayOfMonth', rentDueDay: 31 }, '2026-02', 'BE')]))",
  ].join('\n')
  const root = path.resolve(here, '../..')
  const results = ['Europe/Berlin', 'America/Los_Angeles', 'Pacific/Kiritimati'].map((tz) =>
    execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, env: { ...process.env, TZ: tz }, encoding: 'utf8' }).trim())
  assert.equal(new Set(results).size, 1, results.join('\n'))
  assert.equal(results[0], JSON.stringify(['2026-10-13', '2027-01-04', '2026-10-20', '2027-01-04', '2026-03-02']))
})

test('Register: die Bausteine fragen die Fristregeln mit Protokoll', () => {
  const log = createLawLog()
  arrearsFrom(terms({ start: '2026-10-09' }), '2026-10', 'NW', { ...CHECKED, log })
  assert.deepEqual(log.values.map((v) => v.id).sort(), [
    'bgb.rent-due-at-start', 'bgb.rent-due-saturday', 'bgb.rent-due-workday', 'bgb.transfer-execution-days', 'practice.bank-closed-days', 'practice.credit-booking-days',
  ])
  const fixed = createLawLog()
  arrearsFrom(terms({ rentDue: 'dayOfMonth', rentDueDay: 15 }), '2026-03', 'NW', { ...CHECKED, log: fixed })
  assert.ok(fixed.values.some((v) => v.id === 'bgb.deadline-on-workday'), 'der feste Tag fragt § 193 BGB')
  assert.ok(!fixed.values.some((v) => v.id === 'bgb.rent-due-at-start'), 'eine eingestellte Regel fragt die gesetzliche Vorgabe nicht')
})

// Durchsicht der Bausteine (S1, K3, K6): Monate außerhalb des Mietverhältnisses, ungültiger Tag, Fenster über den
// Monatswechsel, Einzug am Wochenende und am Jahresende.
test('Durchsicht: ein Monat ohne Tag im Mietverhältnis ist ein Fehler, auch vor 1995 und für die sichere Grenze', () => {
  assert.throws(() => monthDue(terms({ start: '1990-05-01' }), '1990-03', 'BY', '2026-01-01'), /besteht das Mietverhältnis nicht/)
  assert.throws(() => safeArrearsFrom(terms({ start: '1990-05-01' }), '1990-03'), /besteht das Mietverhältnis nicht/)
  assert.throws(() => arrearsFrom(terms({ start: '2026-05-01' }), '2026-03', 'BY'), /besteht das Mietverhältnis nicht/)
  assert.throws(() => rentDueOn(terms({ start: '2026-05-01', end: '2026-06-30' }), '2026-07', 'BY'), /besteht das Mietverhältnis nicht/)
  assert.throws(() => rentDueOn(terms(), '2026-13', 'BY'), /kein Monat/)
})

test('Durchsicht: ein fester Tag außerhalb 1 bis 31 ist ein Fehler, auch im ersten Monat mit Miete bei Beginn', () => {
  for (const day of [0, 32, 1.5, undefined, null]) {
    assert.throws(() => rentDueOn(terms({ rentDue: 'dayOfMonth', rentDueDay: day }), '2026-03', 'NW'), /festen Tag/, String(day))
    assert.throws(() => rentDueOn(terms({ start: '2026-03-05', rentDue: 'dayOfMonth', rentDueDay: day, firstRentAtStart: true }), '2026-03', 'NW'), /festen Tag/, String(day))
  }
})

test('Durchsicht: das Fenster der Prüfung reicht bei „nach Ablauf“ und beim verschobenen festen Tag bis in den Folgemonat', () => {
  const asked = (t: RentDueTerms, month: string): string[] => {
    const days: string[] = []
    arrearsFrom(t, month, 'NW', { holidaysChecked: (d) => (days.push(d), true) })
    return [...new Set(days)].sort()
  }
  // März 2026 nach Ablauf: fällig Mi 01.04., erwartet bis Do 09.04.; gefragt ab dem 01.03.
  const inArrears = asked(terms({ rentDue: 'inArrears' }), '2026-03')
  assert.equal(inArrears[0], '2026-03-01')
  assert.equal(inArrears.at(-1), '2026-04-09')
  assert.equal(inArrears.length, 40)
  // Februar 2026, Tag 31: Sa 28.02. → Mo 02.03., erwartet bis Fr 06.03.
  const day31 = asked(terms({ rentDue: 'dayOfMonth', rentDueDay: 31 }), '2026-02')
  assert.equal(day31[0], '2026-02-01')
  assert.equal(day31.at(-1), '2026-03-06')
  // Ein ungeprüfter Tag im Folgemonat genügt für die sichere Grenze.
  assert.equal(arrearsFrom(terms({ rentDue: 'inArrears' }), '2026-03', 'NW', { holidaysChecked: (d) => d !== '2026-04-08' }), '2026-05-01')
  assert.equal(arrearsFrom(terms({ rentDue: 'inArrears' }), '2026-03', 'NW', CHECKED), '2026-04-10')
})

test('Durchsicht: Einzug am Samstag zählt ab dem Montag, Einzug am 31.12. ohne Land reicht in den Januar', () => {
  // Sa 10.10.2026: Mo 12. (1), Di 13. (2), Mi 14. (3).
  assert.equal(rentDueOn(terms({ start: '2026-10-10' }), '2026-10', 'NW'), '2026-10-14')
  // So 11.10.2026: ebenso.
  assert.equal(rentDueOn(terms({ start: '2026-10-11' }), '2026-10', 'NW'), '2026-10-14')
  // Do 31.12.2026 ohne Land: Do 31. (1), Neujahr, Mo 04.01. (2), Di 05.01. (3); Bankgeschäftstage Do 07., Fr 08., Mo 11.,
  // Di 12.01. (der 06.01. ist in drei Ländern Feiertag); sichere Grenze 01.02.2027.
  const t = terms({ start: '2026-12-31' })
  assert.equal(rentDueOn(t, '2026-12', null), '2027-01-05')
  assert.equal(creditExpectedBy('2027-01-05'), '2027-01-12')
  assert.equal(arrearsFrom(t, '2026-12', null, CHECKED), '2027-01-13')
  assert.equal(arrearsFrom(t, '2026-12', null, UNCHECKED), '2027-02-01')
})

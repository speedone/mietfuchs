// Gesetzliche Feiertage je Bundesland (shared/holidays.ts) gegen eine unabhängig erzeugte
// Vergleichsliste: die Python-Bibliothek holidays 0.104 für alle 16 Länder von 1995 bis 2100
// (fixtures/holidays/README.md). Dazu Einzelfälle aus den Feiertagsgesetzen, das unbekannte Land und
// die Zeitzone.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  addDays, easterSunday, FIRST_YEAR, holidaysOf, isFederalState, isHoliday, isWorkday, localHolidaysOf, STATE_CODES, STATES,
} from '../../shared/holidays.ts'
import type { FederalState } from '../../shared/types.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
type Fixture = { jahre: [number, number]; ostern: string[]; varianten: Record<string, string[]> }
const fixture: Fixture = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'holidays', 'python-holidays.json'), 'utf8'))
const [FROM, TO] = fixture.jahre
const years = Array.from({ length: TO - FROM + 1 }, (_, i) => FROM + i)

function easterOf(year: number): string {
  const e = fixture.ostern[year - FROM]
  if (e === undefined) return assert.fail(`kein Ostern ${year} in der Vergleichsliste`)
  return e
}

// Die Schlüssel der Vergleichsliste in Tage eines Jahres übersetzen (Format in der README).
function fixtureDays(variant: string, year: number): string[] {
  const tokens = fixture.varianten[variant]
  if (!tokens) return assert.fail(`Variante ${variant} fehlt in der Vergleichsliste`)
  const days = new Set<string>()
  for (const token of tokens) {
    const [key = '', yrs] = token.split('@')
    if (yrs !== undefined) {
      const inRange = yrs.split(',').some((part) => {
        const [a, b] = part.split('-').map(Number)
        return a !== undefined && year >= a && year <= (b ?? a)
      })
      if (!inRange) continue
    }
    days.add(key.startsWith('O') ? addDays(easterOf(year), Number(key.slice(1))) : `${year}-${key}`)
  }
  return [...days].sort()
}

const ours = (year: number, state: FederalState): string[] => holidaysOf(year, state).map((h) => h.date)
const local = (year: number, state: FederalState, name: string): string[] =>
  localHolidaysOf(year, state).filter((h) => h.name === name).map((h) => h.date)

test('Ostersonntag nach der Formel stimmt 1995 bis 2100 mit der Vergleichsliste', () => {
  for (const y of years) assert.equal(easterSunday(y), easterOf(y), `Ostern ${y}`)
})

test('alle 16 Länder, jedes Jahr von 1995 bis 2100: dieselben Feiertage wie die Vergleichsliste', () => {
  assert.equal(STATE_CODES.length, 16)
  for (const state of STATE_CODES) {
    for (const y of years) assert.deepEqual(ours(y, state), fixtureDays(state, y), `${state} ${y}`)
  }
})

// Die einzige gewollte Abweichung: Feiertage, die nur in einzelnen Gemeinden gelten, zählt Mietfuchs
// nicht mit, weil es die Gemeinde nicht kennt. Die Vergleichsliste führt sie als eigene Varianten;
// sie ergeben sich genau aus Land plus Hinweis.
test('gemeindeweise Feiertage: Varianten der Vergleichsliste = Land plus Hinweis, nie mitgezählt', () => {
  const variants: { variant: string; state: FederalState; names: string[] }[] = [
    { variant: 'BY:catholic', state: 'BY', names: ['Mariä Himmelfahrt'] },
    { variant: 'Augsburg', state: 'BY', names: ['Mariä Himmelfahrt', 'Augsburger Friedensfest'] },
    { variant: 'SN:catholic', state: 'SN', names: ['Fronleichnam'] },
    { variant: 'TH:catholic', state: 'TH', names: ['Fronleichnam'] },
  ]
  for (const { variant, state, names } of variants) {
    for (const y of years) {
      const extra = names.flatMap((n) => local(y, state, n))
      assert.equal(extra.length, names.length, `${variant} ${y}: Hinweis fehlt`)
      for (const d of extra) assert.equal(ours(y, state).includes(d), false, `${variant} ${y}: ${d} darf nicht mitzählen`)
      assert.deepEqual([...new Set([...ours(y, state), ...extra])].sort(), fixtureDays(variant, y), `${variant} ${y}`)
    }
  }
  // Andere Länder haben keine gemeindeweisen Feiertage.
  for (const s of STATE_CODES.filter((c) => !['BY', 'SN', 'TH'].includes(c))) assert.deepEqual(localHolidaysOf(2026, s), [], s)
  assert.deepEqual(localHolidaysOf(2026, null), [])
  const augsburg = localHolidaysOf(2026, 'BY').find((h) => h.name === 'Augsburger Friedensfest')
  assert.deepEqual(augsburg, { date: '2026-08-08', name: 'Augsburger Friedensfest', where: 'nur im Stadtgebiet Augsburg' })
})

test('Einzelfälle aus den Feiertagsgesetzen', () => {
  // Frauentag: Berlin seit 2019, Mecklenburg-Vorpommern seit 2023.
  assert.equal(isHoliday('2018-03-08', 'BE'), false)
  assert.equal(isHoliday('2019-03-08', 'BE'), true)
  assert.equal(isHoliday('2022-03-08', 'MV'), false)
  assert.equal(isHoliday('2023-03-08', 'MV'), true)
  // Weltkindertag in Thüringen seit 2019.
  assert.equal(isHoliday('2018-09-20', 'TH'), false)
  assert.equal(isHoliday('2019-09-20', 'TH'), true)
  // Reformationstag: 2017 einmalig überall, im Norden seit 2018, vorher dort nicht.
  for (const s of STATE_CODES) assert.equal(isHoliday('2017-10-31', s), true, s)
  for (const s of ['HB', 'HH', 'NI', 'SH'] as const) {
    assert.equal(isHoliday('2016-10-31', s), false, s)
    assert.equal(isHoliday('2018-10-31', s), true, s)
  }
  assert.equal(isHoliday('2018-10-31', 'BY'), false)
  // Einmalig in Berlin: 8. Mai 2020 und 2025, 17. Juni 2028; nicht in den Jahren dazwischen.
  assert.equal(isHoliday('2020-05-08', 'BE'), true)
  assert.equal(isHoliday('2025-05-08', 'BE'), true)
  assert.equal(isHoliday('2026-05-08', 'BE'), false)
  assert.equal(isHoliday('2028-06-17', 'BE'), true)
  assert.equal(isHoliday('2029-06-17', 'BE'), false)
  // Buß- und Bettag nur in Sachsen, der Mittwoch vor dem 23. November.
  assert.equal(isHoliday('2026-11-18', 'SN'), true)
  assert.equal(isHoliday('2026-11-18', 'BY'), false)
  assert.equal(isHoliday('2017-11-22', 'SN'), true, 'der 22. ist selbst ein Mittwoch')
  // Mariä Himmelfahrt landesweit nur im Saarland.
  assert.equal(isHoliday('2026-08-15', 'SL'), true)
  assert.equal(isHoliday('2026-08-15', 'BY'), false)
  // 2008 fielen Christi Himmelfahrt und der 1. Mai zusammen: ein Tag, einmal genannt.
  assert.deepEqual(holidaysOf(2008, 'NI').filter((h) => h.date === '2008-05-01'), [{ date: '2008-05-01', name: 'Tag der Arbeit' }])
})

test('ohne Bundesland zählen nur die Feiertage aller Länder', () => {
  assert.deepEqual(holidaysOf(2026, null).map((h) => h.name), [
    'Neujahr', 'Karfreitag', 'Ostermontag', 'Tag der Arbeit', 'Christi Himmelfahrt', 'Pfingstmontag',
    'Tag der Deutschen Einheit', '1. Weihnachtstag', '2. Weihnachtstag',
  ])
  // Der Reformationstag 2017 galt überall und zählt deshalb auch ohne Land.
  assert.equal(isHoliday('2017-10-31', null), true)
  assert.equal(isHoliday('2018-10-31', null), false)
  assert.equal(isHoliday('2026-01-06', null), false)
  // Ohne Land ist jeder Feiertag einer, der auch in jedem Land gilt.
  for (const y of [1995, 2017, 2026, 2100]) {
    for (const h of holidaysOf(y, null)) for (const s of STATE_CODES) assert.equal(isHoliday(h.date, s), true, `${h.date} ${s}`)
  }
})

test('Werktag: Samstag nur auf ausdrücklichen Wunsch, Sonntag und Feiertag nie', () => {
  assert.equal(isWorkday('2026-10-16', 'NW', { saturday: false }), true, 'Freitag')
  assert.equal(isWorkday('2026-10-17', 'NW', { saturday: false }), false, 'Samstag ohne')
  assert.equal(isWorkday('2026-10-17', 'NW', { saturday: true }), true, 'Samstag mit')
  assert.equal(isWorkday('2026-10-18', 'NW', { saturday: true }), false, 'Sonntag')
  assert.equal(isWorkday('2026-11-01', 'NW', { saturday: true }), false, 'Allerheiligen ist Sonntag')
  assert.equal(isWorkday('2027-11-01', 'NW', { saturday: false }), false, 'Allerheiligen am Montag')
  assert.equal(isWorkday('2027-11-01', 'HB', { saturday: false }), true, 'in Bremen kein Feiertag')
  assert.equal(isWorkday('2027-11-01', null, { saturday: false }), true, 'ohne Land kein Feiertag')
})

test('ungültige Eingaben und Jahre ohne Daten werfen, statt still zu rechnen', () => {
  assert.throws(() => isHoliday('2026-02-30', 'BY'), /kein Datum/)
  assert.throws(() => isWorkday('26.10.2026', 'BY', { saturday: false }), /kein Datum/)
  assert.throws(() => holidaysOf(FIRST_YEAR - 1, 'BY'), /ab 1995/)
  assert.throws(() => isHoliday('1994-12-26', null), /ab 1995/)
  assert.doesNotThrow(() => holidaysOf(2150, 'BY'))
  assert.equal(isFederalState('BY'), true)
  assert.equal(isFederalState('DE'), false)
  assert.equal(isFederalState('by'), false)
  assert.equal(isFederalState(null), false)
  assert.deepEqual(STATES.map((s) => s.code), [...STATE_CODES])
})

test('die Zeitzone des Rechners ändert nichts', () => {
  const script = [
    "import { holidaysOf, isWorkday } from './shared/holidays.ts'",
    "import { rentDueDate } from './shared/deadlines.ts'",
    "console.log(JSON.stringify([holidaysOf(2026, 'BY').map((h) => h.date), isWorkday('2026-10-03', 'BY', { saturday: true }), rentDueDate('2026-10', 'BY'), rentDueDate('2027-01', 'BW')]))",
  ].join('\n')
  const root = path.resolve(here, '../..')
  const results = ['Europe/Berlin', 'America/Los_Angeles', 'Pacific/Kiritimati'].map((tz) =>
    execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, env: { ...process.env, TZ: tz }, encoding: 'utf8' }).trim())
  assert.equal(new Set(results).size, 1, results.join('\n'))
})

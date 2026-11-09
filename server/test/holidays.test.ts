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
import { LAW_PARAMS } from '../../shared/law/params.ts'
import { dayAfter, LAW_AS_OF, versionAt } from '../../shared/law/register.ts'
import {
  HOLIDAY_PARAMS, holidayReformation, holidayUprising1953, isCrossCheckedStateList, STATE_HOLIDAY_LAW, STATE_HOLIDAY_LAW_CROSS_CHECKED, STATE_HOLIDAY_LAW_UNREAD,
} from '../../shared/law/feiertagsgesetze.ts'
import { arrearsFrom } from '../../shared/rentDue.ts'
import { holidaysCheckedOn } from '../../shared/holidaysChecked.ts'

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

// Auflage aus #290, präzisiert in #334 (Entwurf E6): Mit Feiertagen rechnet der Server nur für einen Tag,
// an dem jede dann geltende Fassung jedes `holiday.*` amtlich gelesen (`checked`) ist. Ältere Fassungen
// (Reformationstag 2017, Frauentag vor 2019 …) dürfen `adopted` bleiben; für sie ist `holidaysCheckedOn`
// falsch, und wer rechnet, nimmt dort die sichere Grenze ohne Feiertage.
test('Feiertage: jedes Land ist amtlich gelesen, abgeglichen oder mit Grund offen', () => {
  for (const s of STATE_CODES) {
    const read = STATE_HOLIDAY_LAW[s]
    const crossChecked = STATE_HOLIDAY_LAW_CROSS_CHECKED[s]
    const unread = STATE_HOLIDAY_LAW_UNREAD[s]
    assert.equal([read, crossChecked, unread].filter((x) => x !== undefined).length, 1, `${s}: genau eines von gelesen, abgeglichen und offen`)
    if (read) {
      assert.match(read.url, /^https:\/\//, s)
      assert.doesNotMatch(read.url, /kirchenrecht|umwelt-online|lexaris|dejure|buzer|wikipedia/, `${s}: keine Sammlung als Quelle`)
      assert.match(read.cite, /§|Art\./, s)
    }
    if (crossChecked !== undefined) {
      // Abgeglichen heißt: Vorschrift genannt, eine amtliche Übersicht mit Adresse und beide Vergleichslisten.
      assert.match(crossChecked, /§/, s)
      assert.match(crossChecked, /https:\/\/www\.hamburg\.de\//, `${s}: amtliche Übersicht`)
      assert.match(crossChecked, /python-holidays und date-holidays/, `${s}: beide Vergleichslisten`)
    }
    if (unread !== undefined) assert.ok(unread.trim().length > 40, `${s}: Grund nennen`)
  }
})

// Solange ein Land offen ist, bleibt jede geltende Fassung `adopted` und nennt das Land. Ist keins offen, aber
// eins nur abgeglichen, bleibt sie `adopted`, nennt die abgeglichenen Länder und zählt doch
// (`isCrossCheckedStateList`); sind alle gelesen, ist jede geltende Fassung `checked`. Geprüft von heute bis
// 2100. Jede Fassung sagt etwas über alle 16 Länder (auch „nur in Berlin“ heißt „in keinem anderen Land“);
// ausgenommen ist nur der Tag der Deutschen Einheit, den der Einigungsvertrag als Bundesrecht festlegt.
test('Feiertage: ab dem Rechtsstand bis 2100 zählt jede geltende Fassung, sobald kein Land mehr offen ist', () => {
  const unread = STATE_CODES.filter((s) => STATE_HOLIDAY_LAW_UNREAD[s] !== undefined)
  const crossChecked = STATE_CODES.filter((s) => STATE_HOLIDAY_LAW_CROSS_CHECKED[s] !== undefined)
  const params = LAW_PARAMS.filter((p) => p.id.startsWith('holiday.'))
  assert.equal(params.length, HOLIDAY_PARAMS.length)
  // Jede Grenze einer Fassung ab dem Rechtsstand, dazu der Rechtsstand selbst und das Ende 2100: Zwischen
  // zwei Grenzen gilt dieselbe Fassung, jeder Tag dazwischen ergibt dasselbe.
  const days = new Set<string>([LAW_AS_OF, '2100-12-31'])
  for (const p of params) {
    for (const v of p.versions) {
      if (v.validFrom !== undefined && v.validFrom >= LAW_AS_OF) days.add(v.validFrom)
      if (v.validTo !== undefined && v.validTo >= LAW_AS_OF) { days.add(v.validTo); days.add(dayAfter(v.validTo)) }
    }
  }
  for (const day of [...days].sort()) {
    const open = params.filter((p) => versionAt(p, day).source.checked !== 'checked')
    const named = [...unread, ...crossChecked]
    if (named.length === 0) assert.deepEqual(open.map((p) => p.id), [], `am ${day} nicht amtlich gelesen`)
    else assert.deepEqual(params.filter((p) => !open.includes(p)).map((p) => p.id), ['holiday.unity-day'], `am ${day} geprüft trotz offener oder abgeglichener Länder`)
    for (const p of open) {
      const { source } = versionAt(p, day)
      for (const s of named) assert.match(source.cite, new RegExp(`\\b${s}\\b`), `${p.id} am ${day} nennt das Land ${s}`)
      assert.equal(isCrossCheckedStateList(source), unread.length === 0, `${p.id} am ${day}: zählt genau dann, wenn kein Land offen ist`)
    }
    assert.equal(holidaysCheckedOn(day), unread.length === 0, day)
  }
})

// Entscheidung vom 09.11.2026 (#334): Bremen und Hamburg sperren ihre Gesetzestexte. Ihre Listen gelten als
// abgeglichen (STATE_HOLIDAY_LAW_CROSS_CHECKED): was amtlich lesbar war, gelesen, der Rest deckt sich mit der
// Übersicht der Hamburger Schulbehörde und beiden Vergleichslisten. Die Fassungen bleiben im Register
// `adopted`, das Mietkonto rechnet aber mit Feiertagen.
test('Feiertage: heute zählen sie im Rückstand, Bremen und Hamburg abgeglichen statt offen', () => {
  assert.deepEqual(Object.keys(STATE_HOLIDAY_LAW_UNREAD), [])
  assert.deepEqual(Object.keys(STATE_HOLIDAY_LAW_CROSS_CHECKED).sort(), ['HB', 'HH'])
  for (const day of ['2019-02-07', '2026-11-09', '2028-06-17', '2100-12-31']) assert.equal(holidaysCheckedOn(day), true, day)
  // Einzug Fr 09.10.2026 in NRW: fällig Di 13.10., Eingang erwartet bis Mo 19.10., Rückstand ab 20.10.
  assert.equal(arrearsFrom({ start: '2026-10-09', end: null }, '2026-10', 'NW'), '2026-10-20')
  // Die Fassungen bleiben übernommen und nennen den Abgleich.
  const v = versionAt(holidayReformation, '2026-10-31')
  assert.equal(v.source.checked, 'adopted')
  assert.equal(isCrossCheckedStateList(v.source), true)
  assert.match(v.source.cite, /HB, HH/)
  assert.match(v.source.cite, /abgeglichen/)
})

test('Feiertage: an einem Tag mit übernommener Fassung ist nichts geprüft', () => {
  // Der Reformationstag 2017 galt einmalig in allen Ländern, jedes mit eigener Regelung; nicht jede ist
  // amtlich gelesen.
  assert.equal(versionAt(holidayReformation, '2017-10-31').source.checked, 'adopted')
  assert.equal(holidaysCheckedOn('2017-10-31'), false)
  assert.equal(holidaysCheckedOn('2019-02-06'), false, 'Frauentag vor Berlin')
  assert.throws(() => holidaysCheckedOn('31.10.2017'), /kein Datum/)
})

// Wer unter server/src mit Feiertagen rechnet, steht hier mit Grund. Eine neue Stelle ist damit eine
// bewusste Entscheidung, und shared/rentDue.ts, über das der Rückstand rechnet, fragt vor jedem Feiertag
// `holidaysCheckedOn`. Geprüft wird der Quelltext.
const HOLIDAY_USERS: Readonly<Record<string, string>> = {
  'calc.ts': 'Rückstand im Mietkonto und prepayment.arrears über monthDue (Feiertage nur an geprüften Tagen, #334); Zehn-Tage-Regel beim festen Tag nur, wenn jeder Tag bis zur Fälligkeit geprüft ist',
  'rentAllocation.ts': 'nur die Regel des Mietverhältnisses (effectiveRentDue, #334) für den Beginn der Erfassung, ohne Feiertage',
  'markPaid.ts': 'Datum einer als bezahlt erfassten Miete: der Fälligkeitstag wie im Mietkonto (rentDueOn, #608), nur als Datum der Zahlung, nie für den Rückstand',
}

test('Feiertage: jede Stelle im Server, die mit ihnen rechnet, ist benannt', () => {
  const root = path.join(here, '..', 'src')
  const files = (fs.readdirSync(root, { recursive: true }) as string[]).filter((f) => f.endsWith('.ts'))
  const users = files.filter((f) => /shared\/(holidays|deadlines|rentDue)\.ts['"]/.test(fs.readFileSync(path.join(root, f), 'utf8')))
    .map((f) => f.split(path.sep).join('/')).sort()
  assert.deepEqual(users, Object.keys(HOLIDAY_USERS).sort(), 'neue Stelle mit Grund in HOLIDAY_USERS eintragen')
  const rentDue = path.join(here, '..', '..', 'shared', 'rentDue.ts')
  if (fs.existsSync(rentDue)) {
    const src = fs.readFileSync(rentDue, 'utf8')
    assert.match(src, /holidaysCheckedOn/, 'shared/rentDue.ts rechnet mit Feiertagen nur über holidaysCheckedOn')
    // #334 (Kann-Befund der Durchsicht von #593): genau eine Stelle entscheidet den Rückstand, und sie nimmt ohne geprüfte
    // Feiertage die sichere Grenze; das Verhalten prüft rent-due.test.ts (ein ungeprüfter Tag im Fenster genügt).
    assert.match(src, /import \{ holidaysCheckedOn \} from '\.\/holidaysChecked\.ts'/, 'der Prüfstand kommt aus shared/holidaysChecked.ts')
    assert.match(src, /const checked = options\.holidaysChecked \?\? holidaysCheckedOn/)
    assert.match(src, /for \(let d = sectionStart\(t, month\); all && d <= expected; d = addDays\(d, 1\)\) all = checked\(d\)/, 'jeder Tag vom Abschnitt bis zum erwarteten Eingang')
    assert.match(src, /const from = all \? dayAfter\(expected\) : safe/)
    assert.equal(src.match(/dayAfter\(expected\)/g)?.length, 1, 'nur eine Stelle rechnet den Rückstand mit Feiertagen')
  }
})

// Befunde der Gegenprüfung vom 07.11.2026 (#334): Die Fundstellen stimmen mit dem Gesetzblatt überein.
test('Fundstellen: Berlin 17.06.2028 ist § 1 Abs. 1 Nr. 11, NRW 2017 steht in GV. NRW. S. 496', () => {
  // Art. 2 G v. 10.07.2024 (in Kraft am 09.05.2025): „Nummer 12 wird zu Nummer 11“; Art. 3 hebt Nr. 11 auf.
  assert.match(holidayUprising1953.norm, /Nr\. 11\b/)
  assert.match(versionAt(holidayUprising1953, '2028-06-17').source.cite, /^§ 1 Abs\. 1 Nr\. 11\b/)
  assert.match(versionAt(holidayReformation, '2017-10-31').source.cite, /GV\. NRW\. S\. 496/)
})

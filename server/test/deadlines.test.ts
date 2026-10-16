// Fristen nach Werktagen (shared/deadlines.ts): Zahlungsfrist der Miete (§ 556b Abs. 1 BGB, Samstag
// kein Werktag nach BGH VIII ZR 129/09) und Fristende am nächsten Werktag (§ 193 BGB). Die Beispiele
// sind von Hand nachgezählt; dazu ein Abgleich, der die Feiertage nicht aus dem Rechtsregister nimmt,
// sondern aus der Vergleichsliste (fixtures/holidays/).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deadlineOnWorkday, rentDueDate } from '../../shared/deadlines.ts'
import { addDays, STATE_CODES, weekdayOf } from '../../shared/holidays.ts'
import type { FederalState } from '../../shared/types.ts'

test('dritter Werktag: Samstag zählt nicht', () => {
  // August 2026 beginnt an einem Samstag: Mo 3., Di 4., Mi 5. Mit Samstag wäre es der 4.
  assert.equal(rentDueDate('2026-08', 'BE'), '2026-08-05')
  // Januar 2028 beginnt am Samstag (Neujahr): Mo 3., Di 4., Mi 5.
  assert.equal(rentDueDate('2028-01', null), '2028-01-05')
  // Oktober 2026: Do 1., Fr 2., Sa 3. (Tag der Deutschen Einheit), Mo 5.
  assert.equal(rentDueDate('2026-10', 'BY'), '2026-10-05')
})

test('dritter Werktag über Ostern und Pfingsten', () => {
  // April 2026: Mi 1., Do 2., Karfreitag 3., Ostermontag 6., Di 7.
  assert.equal(rentDueDate('2026-04', 'HH'), '2026-04-07')
  // Juni 2011: Mi 1., Christi Himmelfahrt Do 2., Fr 3., Mo 6.
  assert.equal(rentDueDate('2011-06', 'NW'), '2011-06-06')
  // Pfingstsonntag 2026 (24. Mai) als Fristende: Pfingstmontag ist Feiertag, also Dienstag.
  assert.equal(deadlineOnWorkday('2026-05-24', 'BE'), '2026-05-26')
  // Karfreitag 2026: über Ostersonntag (in Brandenburg Feiertag) und Ostermontag zum Dienstag.
  assert.equal(deadlineOnWorkday('2026-04-03', 'BB'), '2026-04-07')
})

test('dritter Werktag hängt am Land: Heilige Drei Könige und Allerheiligen', () => {
  // Januar 2021: Neujahr Fr 1., Mo 4., Di 5.; der 6. ist in Baden-Württemberg Feiertag.
  assert.equal(rentDueDate('2021-01', 'BW'), '2021-01-07')
  assert.equal(rentDueDate('2021-01', 'NW'), '2021-01-06')
  assert.equal(rentDueDate('2027-01', 'BW'), '2027-01-07')
  assert.equal(rentDueDate('2027-01', 'NW'), '2027-01-06')
  // November 2027 beginnt mit Allerheiligen am Montag, November 2028 am Mittwoch.
  const allSaints: FederalState[] = ['BW', 'BY', 'NW', 'RP', 'SL']
  for (const s of STATE_CODES) {
    assert.equal(rentDueDate('2027-11', s), allSaints.includes(s) ? '2027-11-04' : '2027-11-03', `2027-11 ${s}`)
    assert.equal(rentDueDate('2028-11', s), allSaints.includes(s) ? '2028-11-06' : '2028-11-03', `2028-11 ${s}`)
  }
  // Ohne Land zählen nur die Feiertage aller Länder: Die Frist kann dann einen Tag früher enden als
  // am Ort; die Oberfläche sagt dazu, dass das Land fehlt.
  assert.equal(rentDueDate('2027-11', null), '2027-11-03')
})

test('§ 193 BGB: Samstag, Sonntag und Feiertag am Ort verschieben auf den nächsten Werktag', () => {
  assert.equal(deadlineOnWorkday('2026-10-16', 'NW'), '2026-10-16', 'ein Werktag bleibt')
  assert.equal(deadlineOnWorkday('2026-10-17', 'NW'), '2026-10-19', 'Samstag')
  assert.equal(deadlineOnWorkday('2026-10-18', 'NW'), '2026-10-19', 'Sonntag')
  // Jahreswechsel
  assert.equal(deadlineOnWorkday('2026-12-31', 'BY'), '2026-12-31')
  assert.equal(deadlineOnWorkday('2022-12-24', 'HE'), '2022-12-27', 'Heiligabend am Samstag, dann zwei Feiertage')
  assert.equal(deadlineOnWorkday('2027-12-25', 'SN'), '2027-12-27')
  assert.equal(deadlineOnWorkday('2027-12-31', 'SN'), '2027-12-31')
  assert.equal(deadlineOnWorkday('2028-01-01', 'SN'), '2028-01-03', 'Neujahr am Samstag')
  // Reformationstag nur, wo er gilt
  assert.equal(deadlineOnWorkday('2025-10-31', 'NI'), '2025-11-03')
  assert.equal(deadlineOnWorkday('2025-10-31', 'NW'), '2025-10-31')
  // Gemeindeweise Feiertage zählen nicht: Fronleichnam in Sachsen gilt nur in einzelnen Gemeinden.
  assert.equal(deadlineOnWorkday('2026-06-04', 'BY'), '2026-06-05')
  assert.equal(deadlineOnWorkday('2026-06-04', 'SN'), '2026-06-04')
  assert.equal(deadlineOnWorkday('2026-10-03', null), '2026-10-05')
})

test('ungültige Eingaben werfen', () => {
  assert.throws(() => rentDueDate('2026-13', 'BY'), /kein Monat/)
  assert.throws(() => rentDueDate('2026-1', 'BY'), /kein Monat/)
  assert.throws(() => rentDueDate('1994-12', 'BY'), /ab 1995/)
  assert.throws(() => deadlineOnWorkday('2026-02-29', 'BY'), /kein Datum/)
})

// Unabhängiger Abgleich: dieselbe Zählung mit den Feiertagen der Vergleichsliste statt der aus dem
// Register, für alle Länder und alle Monate von 2015 bis 2035.
test('Abgleich mit der Vergleichsliste 2015 bis 2035, alle Länder', () => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const fixture: { jahre: [number, number]; ostern: string[]; varianten: Record<string, string[]> } =
    JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'holidays', 'python-holidays.json'), 'utf8'))
  const daysOf = (state: string, year: number): Set<string> => {
    const easter = fixture.ostern[year - fixture.jahre[0]] ?? assert.fail(`Ostern ${year}`)
    const out = new Set<string>()
    for (const token of fixture.varianten[state] ?? assert.fail(state)) {
      const [key = '', yrs] = token.split('@')
      if (yrs !== undefined && !yrs.split(',').some((p) => { const [a, b] = p.split('-').map(Number); return a !== undefined && year >= a && year <= (b ?? a) })) continue
      out.add(key.startsWith('O') ? addDays(easter, Number(key.slice(1))) : `${year}-${key}`)
    }
    return out
  }
  for (const s of STATE_CODES) {
    for (let y = 2015; y <= 2035; y++) {
      const holidays = new Set([...daysOf(s, y), ...daysOf(s, y + 1)])
      const free = (d: string) => weekdayOf(d) === 0 || weekdayOf(d) === 6 || holidays.has(d)
      for (let m = 1; m <= 12; m++) {
        const month = `${y}-${String(m).padStart(2, '0')}`
        let d = `${month}-01`
        let n = 0
        for (;;) {
          if (!free(d) && ++n === 3) break
          d = addDays(d, 1)
        }
        assert.equal(rentDueDate(month, s), d, `${month} ${s}`)
        // Jedes Monatsende als Fristende
        let end = addDays(m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`, -1)
        const last = end
        while (free(end)) end = addDays(end, 1)
        assert.equal(deadlineOnWorkday(last, s), end, `${last} ${s}`)
      }
    }
  }
})

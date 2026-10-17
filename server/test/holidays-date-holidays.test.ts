// Die Feiertage im Rechtsregister (shared/law/feiertagsgesetze.ts, gerechnet in shared/holidays.ts)
// gegen die npm-Bibliothek date-holidays, für alle 16 Länder von 1995 bis zehn Jahre nach dem laufenden.
//
// **Wozu.** date-holidays ist die zweite unabhängige Quelle neben der festen Vergleichsliste aus
// python-holidays (holidays.test.ts). Sie ist eine devDependency der Wurzel, und Dependabot hebt sie
// monatlich. Trägt ihre Pflege eine Gesetzesänderung nach (ein neuer Feiertag, ein einmaliger Tag), wird
// dieser Test rot, und das Register bekommt eine neue Fassung mit amtlicher Fundstelle. Geraten wird dabei
// nicht: Maßgeblich bleibt das Feiertagsgesetz des Landes.
//
// **Warum nur im Test.** Die Feiertagsdaten von date-holidays stehen unter CC BY-SA 3.0 (sie beruhen auf
// Wikipedia), der Code unter ISC; Mietfuchs steht unter AGPL-3.0, mit der CC BY-SA 3.0 nicht verträglich ist. In Programmdatei, Docker-Image oder
// Oberfläche würden die Daten mit ausgeliefert. Deshalb steht das Paket in der Wurzel-package.json, deren
// node_modules weder das Image (es übernimmt nur server/, client/dist, shared/) noch Bun beim Kompilieren
// (es bündelt nur, was server/src importiert) noch Vite erreichen. Nichts unter server/src, shared/ oder
// client/src importiert es; der letzte Test hier hält das fest.
//
// **Gewollte Abweichungen**, wie beim python-holidays-Abgleich: Feiertage, die nur in einzelnen Gemeinden
// gelten, zählt Mietfuchs nicht mit. date-holidays führt sie als Regionen (Bayern KATH und A, Sachsen BZ,
// Thüringen EIC); sie müssen genau Land plus Hinweis aus `localHolidaysOf` sein. Bayern selbst wird mit der
// Region EVANG verglichen, das ist Bayern ohne Mariä Himmelfahrt.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Holidays from 'date-holidays'
import { holidaysOf, localHolidaysOf, STATE_CODES } from '../../shared/holidays.ts'
import type { FederalState } from '../../shared/types.ts'

const FROM = 1995
// Ein festes Ende statt „heute plus zehn“: Sonst würde die CI am 1. Januar ohne Codeänderung rot, wenn
// date-holidays schon eine spätere Regel führt, und hielte das gebündelte Dependabot-Update auf.
const TO = 2036

type Day = { date: string; name: string }

function library(state: FederalState, region: string | null): (year: number) => Day[] {
  const cal = region ? new Holidays('DE', state, region) : new Holidays('DE', state)
  return (year) => cal.getHolidays(year).filter((h) => h.type === 'public').map((h) => ({ date: h.date.slice(0, 10), name: h.name }))
}

// Abweichungen mit Datum, Land und Name, damit ein roter Lauf sagt, was zu prüfen ist.
function differences(label: string, ours: Day[], theirs: Day[]): string[] {
  const has = (list: Day[], d: string) => list.some((x) => x.date === d)
  return [
    ...ours.filter((o) => !has(theirs, o.date)).map((o) => `${o.date} ${label}: nur im Register (${o.name})`),
    ...theirs.filter((t) => !has(ours, t.date)).map((t) => `${t.date} ${label}: nur in date-holidays (${t.name})`),
  ]
}

test(`alle 16 Länder, ${FROM} bis ${TO}: dieselben Feiertage wie date-holidays`, () => {
  const found: string[] = []
  for (const state of STATE_CODES) {
    const theirs = library(state, state === 'BY' ? 'EVANG' : null)
    for (let y = FROM; y <= TO; y++) found.push(...differences(state, holidaysOf(y, state), theirs(y)))
  }
  assert.deepEqual(found, [], `Abweichungen; am Landesgesetz prüfen und im Register eine neue Fassung anlegen:\n${found.join('\n')}`)
})

test('gemeindeweise Feiertage: die Regionen von date-holidays sind genau Land plus Hinweis', () => {
  const variants: { label: string; state: FederalState; region: string; names: string[] }[] = [
    { label: 'BY/KATH', state: 'BY', region: 'KATH', names: ['Mariä Himmelfahrt'] },
    { label: 'BY/A (Augsburg)', state: 'BY', region: 'A', names: ['Mariä Himmelfahrt', 'Augsburger Friedensfest'] },
    { label: 'SN/BZ', state: 'SN', region: 'BZ', names: ['Fronleichnam'] },
    { label: 'TH/EIC', state: 'TH', region: 'EIC', names: ['Fronleichnam'] },
  ]
  const found: string[] = []
  for (const { label, state, region, names } of variants) {
    const theirs = library(state, region)
    for (let y = FROM; y <= TO; y++) {
      const extra = localHolidaysOf(y, state).filter((h) => names.includes(h.name)).map((h) => ({ date: h.date, name: h.name }))
      assert.equal(extra.length, names.length, `${label} ${y}: Hinweis fehlt`)
      found.push(...differences(label, [...holidaysOf(y, state), ...extra], theirs(y)))
    }
  }
  assert.deepEqual(found, [], found.join('\n'))
})

// Ein Verweis auf das Paket in jeder Schreibweise eines Modulnamens: auch ein Unterpfad
// ('date-holidays/data'), ein Template-Literal und das Schwesterpaket date-holidays-parser, das die Daten
// auswertet (Durchsicht: vorher fing der Wächter nur den nackten Namen in ' oder ").
const DATE_HOLIDAYS_REF = /['"`]date-holidays(?:-parser)?(?:\/[^'"`]*)?['"`]/

test('der Wächter erkennt jede Schreibweise eines Imports von date-holidays', () => {
  for (const line of [
    "import Holidays from 'date-holidays'",
    'const h = require("date-holidays")',
    'await import(`date-holidays`)',
    "import data from 'date-holidays/data/holidays.json'",
    "import { Parser } from 'date-holidays-parser'",
  ]) assert.match(line, DATE_HOLIDAYS_REF, line)
  assert.doesNotMatch("// date-holidays stimmte mit der Vergleichsliste überein", DATE_HOLIDAYS_REF)
})

test('date-holidays wird nur in Tests benutzt, nie in ausgeliefertem Code', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const offenders: string[] = []
  for (const dir of ['server/src', 'server/scripts', 'shared', 'client/src', 'scripts']) {
    for (const f of fs.readdirSync(path.join(root, dir), { recursive: true }).map(String)) {
      if (!/\.(ts|tsx|mjs|js)$/.test(f) || /\.test\.tsx?$/.test(f)) continue
      if (DATE_HOLIDAYS_REF.test(fs.readFileSync(path.join(root, dir, f), 'utf8'))) offenders.push(`${dir}/${f}`)
    }
  }
  assert.deepEqual(offenders, [])
  const pkg = (p: string): { dependencies?: Record<string, string> } => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'))
  for (const p of ['package.json', 'server/package.json', 'client/package.json']) assert.equal(pkg(p).dependencies?.['date-holidays'], undefined, p)
})

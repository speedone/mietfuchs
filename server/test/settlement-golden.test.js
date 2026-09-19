// Prüfkatalog der Abrechnung: Fixtures mit Handrechnung.
//
// Jedes Fixture unter fixtures/settlement/ besteht aus:
//   db.json       Eingangsdaten im aktuellen Mietfuchs-Datenformat
//   expected.json erwartetes Ergebnis — von Hand hergeleitet, nicht aus dem Code abgelesen
//   README.md     die Handrechnung mit fachlicher Begründung
//
// Verglichen wird cent-genau ohne Toleranz. Eine Abweichung ist immer eine fachliche
// Frage, nie ein Testproblem: entweder ist die Engine falsch, oder die Herleitung.
//
// Erwartungen werden NIE automatisch überschrieben. Wer eine Abweichung untersuchen will,
// startet mit
//     GOLDEN=diff npm --prefix server test
// dann liegt das Ist-Ergebnis als expected.actual.json neben der Golden-Datei und kann
// mit `diff` verglichen werden. Die Übernahme in expected.json bleibt ein bewusster,
// begründeter Commit, und die Begründung gehört in die README.md des Fixtures.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { loadFixtures, actualOf } from '../testing/fixtures.js'

const fixtures = loadFixtures()

assert.ok(fixtures.length > 0, 'keine Fixtures gefunden — der Golden Master wäre wirkungslos')

for (const fx of fixtures) {
  test(`Prüfkatalog ${fx.name}`, () => {
    const actual = actualOf(fx.db(), fx.year)

    if (process.env.GOLDEN === 'diff') {
      fs.writeFileSync(
        path.join(fx.dir, 'expected.actual.json'),
        JSON.stringify(actual, null, 2) + '\n',
        'utf8',
      )
    }

    assert.deepStrictEqual(actual, fx.expected)
  })
}

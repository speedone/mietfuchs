// Zugriff auf die Fixtures des Prüfkatalogs.
//
// Bewusst außerhalb von test/: `node --test` führt jede .js-Datei unter test/ als Test aus.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeSettlement, consumptionOverview } from '../src/calc.js'
import { normalizeSettlement, normalizeConsumption } from './normalize.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const FIXTURE_DIR = path.join(__dirname, '..', 'test', 'fixtures', 'settlement')

export function loadFixtures() {
  return fs
    .readdirSync(FIXTURE_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .map((name) => {
      const dir = path.join(FIXTURE_DIR, name)
      const expected = JSON.parse(fs.readFileSync(path.join(dir, 'expected.json'), 'utf8'))
      return {
        name,
        dir,
        expected,
        year: expected.year,
        // Frisch aus der Datei geparst: jeder Testfall bekommt seine eigene, unberührte
        // Kopie — die Engine darf die Eingabe nicht mutieren, aber verlassen wollen wir
        // uns darauf im Test nicht.
        db: () => JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8')),
      }
    })
}

// Die vollständige, normalisierte Momentaufnahme eines Abrechnungsjahres —
// der Umfang, der cent-genau verglichen wird.
export function actualOf(db, year) {
  return {
    year,
    settlement: normalizeSettlement(computeSettlement(db, year)),
    consumption: normalizeConsumption(consumptionOverview(db, year)),
  }
}

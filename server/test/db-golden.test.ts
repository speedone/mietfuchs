// Gleichstand: der Prüfkatalog noch einmal, nur durch die Datenbank.
//
// [settlement-golden.test.ts](settlement-golden.test.ts) rechnet jedes Fixture aus der Datei und
// vergleicht cent-genau mit der Handrechnung in `expected.json`. Dieser Test nimmt denselben
// Katalog und dieselbe Handrechnung, schickt den Bestand aber durch SQLite: hineinschreiben,
// zurücklesen, rechnen.
//
// **Warum beides.** Solange es zwei Wege in die Berechnung gibt, muss jeder von ihnen an der
// Handrechnung gemessen werden, und zwar an derselben. Verglichen die beiden Wege nur
// miteinander, ginge ein Fehler durch, der beide gleich verschöbe — und genau das kann
// passieren, weil beide dasselbe `calc.ts` benutzen. Gegen `expected.json` gemessen ist die
// Aussage stärker: Aus der Datenbank kommt das, was ein Mensch auf Papier hergeleitet hat.
//
// **Warum der ganze Katalog und nicht ein Bestand.** db-stock.test.ts prüft die Rundreise
// ausführlich, aber an einem einzigen, für diesen Zweck gebauten Bestand. Der Prüfkatalog
// bringt die schiefen Konstellationen mit, die sich niemand ausdenkt: Teiljahre,
// Zählerwechsel, Leerstand, Direktzuordnung, vereinbarte Anteile. Eine Spalte mit zu kleinem
// Wertebereich oder ein Feld, das beim Schreiben verlorengeht, fällt dort auf und sonst nirgends.
//
// **Der Weg ist der echte.** Gegangen wird, was auch der Umstieg geht: `migrateLegacy`, dann
// `straightenForDatabase`, dann `writeStock`. Bewegte eines der beiden eine Zahl, wird dieser
// Test rot, und das ist dann ein Befund und kein Testproblem.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { migrateLegacy, straightenForDatabase } from '../src/legacy.ts'
import { snapshotOf } from '../src/snapshot.ts'
import { openDatabase } from '../src/db/open.ts'
import { readStock } from '../src/db/read.ts'
import { writeStock } from '../src/db/write.ts'
import { actualOfSnapshot, loadFixtures } from '../testing/fixtures.ts'

const fixtures = loadFixtures()

assert.ok(fixtures.length > 0, 'keine Fixtures gefunden — der Gleichstand wäre wirkungslos')

for (const fx of fixtures) {
  test(`Gleichstand ${fx.name}: durch die Datenbank dieselbe Abrechnung`, async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-gleichstand-'))
    const opened = await openDatabase({ dataDir })
    try {
      await opened.write((db) => writeStock(db, straightenForDatabase(migrateLegacy(fx.db()))))
      const stock = await opened.read(readStock)
      assert.deepStrictEqual(actualOfSnapshot(snapshotOf(stock, fx.year)), fx.expected)
    } finally {
      opened.close()
      fs.rmSync(dataDir, { recursive: true, force: true })
    }
  })
}

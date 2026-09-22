// Der eingefrorene Ausgangsstand (server/src/legacy/schema.ts, Aufgabe 6b).
//
// **Ohne diesen Test wäre „eingefroren" nur eine Behauptung.** Die Datei ist eine Kopie des
// Schemas, wie es nach Migration 0000 aussieht, und sie soll nie wieder angefasst werden. Dass
// sie dem entspricht, was dieser eine Migrationsschritt wirklich anlegt, prüft niemand sonst:
// Der Übersetzer sieht nur TypeScript, und die Migration ist SQL.
//
// Geprüft wird in **beide** Richtungen, denn die beiden Fehler sind verschiedene:
//
//   Eine Spalte, die die Kopie führt und die Migration nicht anlegt, ergibt beim Import einen
//   Fehler von SQLite. Das fällt auf, aber erst beim Vermieter.
//
//   Eine Spalte, die die Migration anlegt und die Kopie nicht führt, ist der stille Fall: Der
//   Import schreibt sie nie, und weil sie in der Datenbank NULL zulässt oder einen Vorgabewert
//   hat, fällt gar nichts auf. Genau so verliert ein Umstieg ein Feld.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { is } from 'drizzle-orm'
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core'
import { applyMigrations, connect, loadMigrations } from '../src/db/client.ts'
import * as v0 from '../src/legacy/schema.ts'

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-v0-'))

// Zeilenenden vereinheitlichen, bevor eine Prüfsumme darüber gebildet wird. Git stellt
// Textdateien unter Windows auf CRLF um; ohne diesen Schritt hinge die Marke vom Rechner ab.
// Dieselbe Behandlung wie bei den Migrationen (scripts/embed-migrations.mjs).
const CR = String.fromCharCode(13)
const normalizedLineEndings = (text: string): string => text.split(CR).join('')

// Die Tabellen der eingefrorenen Kopie, aus ihr selbst abgelesen. Eine Liste von Hand vergisst
// der nächste, der eine Tabelle hinzufügt — und dann bewacht der Test genau sie nicht.
function frozenTables(): Map<string, string[]> {
  const tabellen = new Map<string, string[]>()
  for (const wert of Object.values(v0)) {
    // `is` ist Drizzles eigene Frage nach der Art eines Wertes und verengt dabei den Typ. Eine
    // Zusicherung (`wert as SQLiteTable`) wäre hier eine Behauptung über etwas, das aus einem
    // `Object.values` kommt, also gerade über den Wert, dessen Art der Test wissen will.
    if (!is(wert, SQLiteTable)) continue
    const config = getTableConfig(wert)
    tabellen.set(config.name, config.columns.map((spalte) => spalte.name).sort())
  }
  return tabellen
}

// Eine Datenbank mit **genau** dem ersten Migrationsschritt, so wie der Umstieg sie anlegt.
async function tablesAfterFirstMigration(): Promise<Map<string, string[]>> {
  const dataDir = tempDir()
  const connection = await connect(path.join(dataDir, 'v0.sqlite'))
  try {
    const migrations = await loadMigrations()
    const erster = migrations[0]
    if (!erster) return assert.fail('es gibt keine Migrationen')
    applyMigrations(connection, [erster])
    const namen = connection
      .rows(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
      .map((zeile) => String(zeile[0]))
    const tabellen = new Map<string, string[]>()
    for (const name of namen) {
      // Die Buchführung der Migrationen gehört nicht zum Schema; sie legt `applyMigrations` an.
      if (name === '__drizzle_migrations') continue
      const spalten = connection
        .rows(`SELECT name FROM pragma_table_info('${name}')`)
        .map((zeile) => String(zeile[0]))
      tabellen.set(name, spalten.sort())
    }
    return tabellen
  } finally {
    connection.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

test('Der eingefrorene Ausgangsstand ist der, den Migration 0000 anlegt', async () => {
  const ausDerKopie = frozenTables()
  const ausDerMigration = await tablesAfterFirstMigration()

  assert.ok(ausDerKopie.size > 0, 'die Kopie führt gar keine Tabellen; der Test wäre wirkungslos')
  assert.deepEqual(
    [...ausDerKopie.keys()].sort(),
    [...ausDerMigration.keys()].sort(),
    'die Kopie und der erste Migrationsschritt führen verschiedene Tabellen',
  )
  for (const [name, spalten] of ausDerKopie) {
    assert.deepEqual(
      spalten,
      ausDerMigration.get(name),
      `Tabelle ${name}: die Spalten der Kopie und die des ersten Migrationsschrittes gehen auseinander`,
    )
  }
})

test('Der eingefrorene Ausgangsstand ist unverändert', () => {
  // **Die Zusicherung, die die anderen erst tragfähig macht.** Der Vergleich der Spalten darüber
  // sieht eine gelockerte Prüfbedingung nicht: Nimmt jemand einen Wert in eine Aufzählung mit
  // auf, bleiben Tabellen und Spalten dieselben, und der Test blieb grün.
  //
  // Und das ist keine erfundene Sorge, sondern die naheliegende falsche Behebung. Benennt jemand
  // einen Wert im lebenden Modell um, bricht die Übersetzung in `legacy/write.ts`, zwei Zeilen
  // (nachgemessen). Der schnelle Griff wäre, den neuen Wert hier mit aufzunehmen — und damit
  // wäre der Wortschatz von damals verloren, ein alter Bestand käme nicht mehr durch, und die
  // Migrationskette hätte nichts mehr zu tun. Genau dieser Griff wird hier rot.
  //
  // Dieselbe Technik wie bei den Migrationen, und aus demselben Grund: Was sich nicht ändern
  // darf, wird an seiner Prüfsumme festgehalten. Zeilenenden werden dabei vereinheitlicht, weil
  // Git Textdateien unter Windows auf CRLF umstellt und die Marke sonst vom Rechner abhinge.
  const HASH = '2afc1504584f6b73393310bfcbf7e65bd516339a904a9d75de8c71d5b6a24de9'
  const datei = path.join(import.meta.dirname, '..', 'src', 'legacy', 'schema.ts')
  const inhalt = normalizedLineEndings(fs.readFileSync(datei, 'utf8'))
  assert.equal(
    createHash('sha256').update(inhalt).digest('hex'),
    HASH,
    'server/src/legacy/schema.ts ist verändert worden. Diese Datei beschreibt den Stand nach ' +
      'Migration 0000 und wird nie geändert: Wer das Schema oder einen Auswahlwert ändert, ändert ' +
      'db/schema.ts und erzeugt einen Migrationsschritt. Siehe server/src/legacy/README.md.',
  )
})

test('Der Eingang greift nicht auf das heutige Schema zu', () => {
  // **Das ist die Einfrierung als Zusicherung und nicht als Absicht.** Eine Datei im Eingang, die
  // `db/schema.ts` benutzt, zielt wieder auf den neuesten Stand, und damit wäre die ganze
  // Aufteilung wirkungslos: Jede Regel, die den Weg dorthin beschreibt, müsste dann ein zweites
  // Mal hier stehen. Gemerkt hätte man es erst an einem Bestand, bei dem die Kette etwas
  // umschreibt, was der Import schon umgeschrieben hat.
  //
  // Geprüft wird der Quelltext und nicht das Verhalten, weil es dafür kein Verhalten gibt: Solange
  // der Ausgangsstand und der neueste derselbe ist, lässt sich der Unterschied nicht messen.
  const verboten = /from '[^']*db\/schema\.ts'/
  const ordner = path.join(import.meta.dirname, '..', 'src', 'legacy')
  const dateien = fs.readdirSync(ordner).filter((name) => name.endsWith('.ts'))
  assert.ok(dateien.length > 0, 'im Eingang liegt keine einzige Quelldatei; der Test wäre wirkungslos')
  for (const name of dateien) {
    const inhalt = fs.readFileSync(path.join(ordner, name), 'utf8')
    assert.doesNotMatch(inhalt, verboten, `${name} benutzt das heutige Schema statt des eingefrorenen`)
  }
})

test('Der eingefrorene Wortschatz ist der von damals', () => {
  // Die Listen stehen in der Kopie bewusst **ohne** Bindung an die Domänentypen. Damit kann
  // niemand sie versehentlich mitziehen, wenn er `shared/types.ts` ändert — und genau dieses
  // Mitziehen wäre das Gegenteil von eingefroren. Dass sie den Stand von damals führen, steht
  // deshalb hier als Zahl und nicht als Verweis auf eine andere Liste.
  assert.deepEqual([...v0.COST_KEYS], ['area', 'persons', 'units', 'direct', 'meter', 'custom'])
  assert.deepEqual([...v0.METER_TYPES], ['kaltwasser', 'strom', 'waerme', 'sonstig'])
  assert.deepEqual([...v0.DEPOSIT_STATUS], ['offen', 'erhalten', 'teilweise', 'zurückgezahlt'])
  assert.deepEqual([...v0.UPDATE_CHECK], ['on', 'off'])
})

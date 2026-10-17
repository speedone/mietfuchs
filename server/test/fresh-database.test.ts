// Die Vorlage für frische Testdatenbanken (testing/freshDatabase.ts, #263).
//
// Jeder Test, der eine leere Datenbank braucht, bekam bisher eine eigene und ließ dafür die ganze
// Migrationskette laufen, rund eine Viertelsekunde je Test. Die Vorlage fährt die Kette einmal je
// Testprozess, und jeder Test bekommt eine Kopie davon, geöffnet mit derselben `openDatabase` wie
// beim Start des Servers. Diese Datei hält fest, dass die Kopie von einer frisch migrierten
// Datenbank nicht zu unterscheiden ist und dass eine veraltete Vorlage nicht still durchgeht.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyMigrations, connect, loadMigrations } from '../src/db/client.ts'
import { databaseFile, openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import { openFreshDatabase, openFromTemplate, templateFile } from '../testing/freshDatabase.ts'

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-vorlage-'))

// Alles, woran sich zwei Datenbanken unterscheiden könnten, die gleich sein sollen: der Aufbau
// (jede Tabelle, jeder Index, jeder Auslöser samt SQL), die Buchführung der Migrationen ohne die
// fortlaufende Nummer, der Inhalt jeder Tabelle und die Einstellungen der Verbindung.
const PRAGMAS = ['foreign_keys', 'journal_mode', 'synchronous', 'user_version', 'page_size', 'auto_vacuum', 'encoding', 'integrity_check']

async function fingerprint(opened: OpenedDatabase): Promise<Record<string, unknown>> {
  const rows = async (sql: string): Promise<unknown[]> => opened.read((db) => db.all(sql))
  const schema = await rows(`SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`)
  const tables = (await rows(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`))
    .map((row) => String(Array.isArray(row) ? row[0] : Reflect.get(Object(row), 'name')))
  const content: Record<string, unknown[]> = {}
  for (const table of tables) {
    content[table] = table === '__drizzle_migrations'
      ? await rows('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at, hash')
      : await rows(`SELECT * FROM "${table}" ORDER BY rowid`)
  }
  const pragmas: Record<string, unknown> = {}
  for (const name of PRAGMAS) pragmas[name] = await rows(`PRAGMA ${name}`)
  return { schema, content, pragmas }
}

test('Vorlage: eine Kopie gleicht einer frisch migrierten Datenbank in Aufbau, Inhalt und Einstellungen', async () => {
  const freshDir = tempDir()
  const copyDir = tempDir()
  const fresh = await openDatabase({ dataDir: freshDir })
  const copy = await openFreshDatabase(copyDir)
  try {
    assert.ok(fresh.migrations > 0, 'die Vergleichsdatenbank ist wirklich frisch migriert')
    const expected = await fingerprint(fresh)
    // Der Vergleich muss etwas zu vergleichen haben: ein leerer Abdruck wäre immer gleich.
    assert.ok(Array.isArray(expected.schema) && expected.schema.length > 30, 'der Abdruck enthält den Aufbau')
    assert.deepEqual(expected.pragmas, { ...Object(expected.pragmas), foreign_keys: [[1]], integrity_check: [['ok']] })
    assert.deepEqual(await fingerprint(copy), expected)
    assert.equal(copy.file, databaseFile(copyDir), 'die Kopie liegt im Ordner des Tests, nicht in der Vorlage')
    assert.deepEqual(copy.warnings, fresh.warnings)
    assert.equal(copy.backup, null, 'eine Kopie der Vorlage legt keine Sicherung an')
    assert.deepEqual(fs.readdirSync(copyDir), fs.readdirSync(freshDir), 'im Ordner liegt dasselbe')
  } finally {
    fresh.close()
    copy.close()
    fs.rmSync(freshDir, { recursive: true, force: true })
    fs.rmSync(copyDir, { recursive: true, force: true })
  }
})

test('Vorlage: die Kopie prüft Fremdschlüssel wirklich, wie eine frisch geöffnete Datenbank', async () => {
  // Der Wert des Pragmas allein sagt es nicht ganz; hier wird ein Verstoß tatsächlich abgelehnt.
  const dir = tempDir()
  const copy = await openFreshDatabase(dir)
  try {
    const [fk] = await copy.read((db) => db.all('PRAGMA foreign_keys'))
    assert.equal(Number(Array.isArray(fk) ? fk[0] : Object.values(Object(fk))[0]), 1)
    // Drizzle wickelt die Meldung von SQLite in eine eigene; der Grund steht in `cause`.
    await assert.rejects(
      copy.write((db) => db.run(`INSERT INTO tenancies (id, unit_id, tenant_name, persons, start) VALUES ('t', 'gibt-es-nicht', 'A', 1, '2025-01-01')`)),
      (err: unknown) => /FOREIGN KEY/.test(String(err instanceof Error ? err.cause : err)),
    )
  } finally {
    copy.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Vorlage: jeder Test bekommt seine eigene Kopie, und die Vorlage bleibt unberührt', async () => {
  const dirs = [tempDir(), tempDir()]
  const before = fs.readFileSync(await templateFile())
  const [a, b] = [await openFreshDatabase(dirs[0] ?? assert.fail()), await openFreshDatabase(dirs[1] ?? assert.fail())]
  try {
    await a.write((db) => db.run(`INSERT INTO units (id, property_id, name, area_m2, participates) VALUES ('u1', 'objekt-1', 'EG', 60, 1)`))
    const inB = await b.read((db) => db.all(`SELECT id FROM units`))
    assert.deepEqual(inB, [], 'was ein Test schreibt, sieht der nächste nicht')
    assert.ok(before.equals(fs.readFileSync(await templateFile())), 'die Vorlage ist nach dem Schreiben unverändert')
  } finally {
    a.close()
    b.close()
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Vorlage: eine veraltete Vorlage, der ein Schritt der Kette fehlt, wird abgelehnt statt still nachgeholt', async () => {
  // openDatabase holte den fehlenden Schritt beim Öffnen einfach nach, und jeder Test bliebe grün,
  // obwohl die Vorlage nicht dem heutigen Stand entspricht. Das darf nicht unbemerkt bleiben.
  const migrations = await loadMigrations()
  const stale = path.join(tempDir(), 'veraltet.sqlite')
  const connection = await connect(stale)
  try {
    applyMigrations(connection, migrations.slice(0, -1))
  } finally {
    connection.close()
  }
  const dir = tempDir()
  try {
    await assert.rejects(openFromTemplate(stale, dir), /Vorlage.*veraltet/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
    fs.rmSync(path.dirname(stale), { recursive: true, force: true })
  }
})

test('Vorlage: ein Ordner, in dem schon eine Datenbank liegt, wird nicht überschrieben', async () => {
  const dir = tempDir()
  const first = await openFreshDatabase(dir)
  first.close()
  try {
    await assert.rejects(openFreshDatabase(dir), /liegt schon eine Datenbank/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

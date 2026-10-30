// Datenschritte (#455): TypeScript, das innerhalb eines Migrationsschrittes läuft, wo SQL nicht reicht.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyMigrations, connect, hashOf, loadMigrations, type Migration } from '../src/db/client.ts'
import { DATA_STEPS } from '../src/db/dataSteps/index.ts'

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-datenschritt-'))

const step = (tag: string, folderMillis: number, ...statements: string[]): Migration => ({
  tag,
  hash: hashOf(statements.join(';')),
  folderMillis,
  statements,
})

const chain = (): Migration[] => [
  step('0000_eins', 1, 'CREATE TABLE t (x INTEGER)'),
  step('0001_zwei', 2, 'CREATE TABLE u (y INTEGER)'),
]

test('Ein Datenschritt sieht die Tabelle seines Schrittes und wird mit ihm vermerkt', async () => {
  const dir = tempDir()
  try {
    const c = await connect(path.join(dir, 'db.sqlite'))
    const migrations = chain()
    applyMigrations(c, migrations, {
      '0000_eins': (connection) => {
        // Die Tabelle des eigenen Schrittes ist schon da.
        connection.exec('INSERT INTO t VALUES (1)')
      },
    })
    assert.deepEqual(c.rows('SELECT x FROM t'), [[1]])
    assert.equal(c.rows('SELECT hash FROM __drizzle_migrations').length, 2)
    c.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Wirft der Datenschritt, rollt sein Schritt zurück', async () => {
  const dir = tempDir()
  try {
    const c = await connect(path.join(dir, 'db.sqlite'))
    const migrations = chain()
    assert.throws(
      () =>
        applyMigrations(c, migrations, {
          '0001_zwei': (connection) => {
            connection.exec('INSERT INTO u VALUES (1)')
            throw new Error('kaputt')
          },
        }),
      /0001_zwei.*kaputt/s,
    )
    const marken = c.rows('SELECT hash FROM __drizzle_migrations').map((r) => String(r[0]))
    assert.deepEqual(marken, [migrations[0]!.hash], 'nur der erste Schritt ist festgeschrieben')
    assert.deepEqual(c.rows("SELECT name FROM sqlite_master WHERE name = 'u'"), [], 'die Tabelle des Schrittes fehlt')
    assert.deepEqual(c.rows("SELECT name FROM sqlite_master WHERE name = 't'"), [['t']])
    c.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Datenschritt: ohne Eintrag für einen Schritt läuft er wie bisher', async () => {
  const dir = tempDir()
  try {
    const c = await connect(path.join(dir, 'db.sqlite'))
    assert.equal(applyMigrations(c, chain(), {}), 2)
    c.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// Der Wächter als Funktion, damit ein Test ihn an einer nachgestellten Quelle prüfen kann.
function importProblems(file: string, source: string): string[] {
  const problems: string[] = []
  if (/from\s+['"][^'"]*schema\.ts['"]/.test(source)) problems.push(`${file}: kein Import aus schema.ts`)
  if (/from\s+['"][^'"]*shared\//.test(source)) problems.push(`${file}: kein Import aus shared/`)
  if (/\bimport\s*\(/.test(source)) problems.push(`${file}: kein dynamisches import(`)
  if (/\brequire\s*\(/.test(source)) problems.push(`${file}: kein require(`)
  const imports = [...source.matchAll(/^\s*(import|export)\b[^'"]*?from\s+['"]([^'"]+)['"]/gm)]
  const bare = [...source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)]
  for (const match of imports) {
    const [line, , spec] = match as unknown as [string, string, string]
    if (!spec.startsWith('.')) continue // Pakete des Laufzeitsystems (node:…) sind erlaubt
    if (spec === '../client.ts') {
      if (!/^\s*import type\b/.test(line)) problems.push(`${file}: ../client.ts nur als import type`)
    } else if (spec.startsWith('./') && !spec.slice(2).includes('/')) {
      continue // Geschwister im Ordner
    } else {
      problems.push(`${file}: Import ${spec} verlässt den Ordner`)
    }
  }
  for (const match of bare) {
    if (match[1]!.startsWith('.')) problems.push(`${file}: Seiteneffekt-Import ${match[1]}`)
  }
  return problems
}

test('Wächter: Datenschritte importieren nichts außer ihrem Ordner und ../client.ts (nur import type)', () => {
  const folder = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'db', 'dataSteps')
  const files = fs.readdirSync(folder).filter((f) => f.endsWith('.ts'))
  assert.ok(files.length > 0, 'index.ts fehlt')
  for (const file of files) {
    assert.deepEqual(importProblems(file, fs.readFileSync(path.join(folder, file), 'utf8')), [])
  }
})

test('Wächter: dynamisches import( und require( in einem Datenschritt fallen auf', () => {
  assert.equal(importProblems('x.ts', "const m = await import('../schema.ts')").length, 1)
  assert.equal(importProblems('x.ts', "const m = require('../x')").length, 1)
  assert.deepEqual(importProblems('x.ts', "import type { Connection } from '../client.ts'\nimport { a } from './b.ts'"), [])
})

test('Wächter: jeder Datenschritt gehört zu einer Migration', async () => {
  const tags = new Set((await loadMigrations()).map((m) => m.tag))
  for (const tag of Object.keys(DATA_STEPS)) assert.ok(tags.has(tag), `${tag} ist keine Migration`)
})

// Ein veröffentlichter Datenschritt ist eingefroren wie seine SQL-Datei (Muster legacy-schema.test.ts): Was sich nicht
// ändern darf, hängt an seiner Prüfsumme. Zeilenenden werden vereinheitlicht, weil Git unter Windows auf CRLF umstellt.
test('Wächter: jeder Datenschritt hängt an seiner Prüfsumme', () => {
  const PINNED: Record<string, string> = {
    '0077_quellrechnung.ts': 'e9df293bf6f9fb372398734b3473d5a791fb93e0199d5b7abdb0ce286e4a47dd',
  }
  const folder = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'db', 'dataSteps')
  const steps = fs.readdirSync(folder).filter((f) => f.endsWith('.ts') && f !== 'index.ts').sort()
  assert.deepEqual(steps, Object.keys(PINNED).sort(), 'jeder Datenschritt steht mit Prüfsumme hier')
  for (const [name, expected] of Object.entries(PINNED)) {
    const content = fs.readFileSync(path.join(folder, name), 'utf8').split(String.fromCharCode(13)).join('')
    assert.equal(
      createHash('sha256').update(content).digest('hex'),
      expected,
      `server/src/db/dataSteps/${name} ist verändert worden. Ein Datenschritt beschreibt, was sein Schritt mit den Daten ` +
        'tat, und wird nach der Veröffentlichung nie geändert; ein Fehler wird mit einem neuen Schritt geradegerückt ' +
        '(server/drizzle/README.md).',
    )
  }
})

test('Datenschritt 0077_quellrechnung ist eingetragen', () => {
  assert.equal(typeof DATA_STEPS['0077_quellrechnung'], 'function')
})

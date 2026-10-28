// Datenschritte (#455): TypeScript, das innerhalb eines Migrationsschrittes läuft, wo SQL nicht reicht.
import { test } from 'node:test'
import assert from 'node:assert/strict'
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

test('Ein Datenschritt läuft nach seinem Schritt in derselben Transaktion', async () => {
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

test('Wächter: Datenschritte importieren nichts außer ihrem Ordner und ../client.ts (nur import type)', () => {
  const folder = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'db', 'dataSteps')
  const files = fs.readdirSync(folder).filter((f) => f.endsWith('.ts'))
  assert.ok(files.length > 0, 'index.ts fehlt')
  for (const file of files) {
    const source = fs.readFileSync(path.join(folder, file), 'utf8')
    assert.doesNotMatch(source, /from\s+['"][^'"]*schema\.ts['"]/, `${file}: kein Import aus schema.ts`)
    assert.doesNotMatch(source, /from\s+['"][^'"]*shared\//, `${file}: kein Import aus shared/`)
    const imports = [...source.matchAll(/^\s*(import|export)\b[^'"]*?from\s+['"]([^'"]+)['"]/gm)]
    const bare = [...source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)]
    for (const match of imports) {
      const [line, , spec] = match as unknown as [string, string, string]
      if (!spec.startsWith('.')) continue // Pakete des Laufzeitsystems (node:…) sind erlaubt
      if (spec === '../client.ts') {
        assert.match(line, /^\s*import type\b/, `${file}: ../client.ts nur als import type`)
      } else if (spec.startsWith('./') && !spec.slice(2).includes('/')) {
        continue // Geschwister im Ordner
      } else {
        assert.fail(`${file}: Import ${spec} verlässt den Ordner`)
      }
    }
    for (const match of bare) {
      if (match[1]!.startsWith('.')) assert.fail(`${file}: Seiteneffekt-Import ${match[1]}`)
    }
  }
})

test('Wächter: jeder Datenschritt gehört zu einer Migration', async () => {
  const tags = new Set((await loadMigrations()).map((m) => m.tag))
  for (const tag of Object.keys(DATA_STEPS)) assert.ok(tags.has(tag), `${tag} ist keine Migration`)
})

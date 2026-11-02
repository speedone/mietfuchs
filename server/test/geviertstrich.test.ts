// Keine Geviertstriche (—) in Mietfuchs, grundsätzlich: Oberfläche, Fenstertitel, Meldungen des Servers, gedruckte
// Abrechnung, Kommentare, README und Doku. Als Gedankenstrich steht ein Bindestrich mit Leerzeichen („Mietfuchs -
// Nebenkosten im Griff“), sonst Doppelpunkt, Komma oder Klammer. Halbgeviertstriche (–) für Bereiche bleiben erlaubt.
//
// Ausgenommen sind nur Zeilen, in denen das Zeichen selbst der Gegenstand ist: die Zeichentabelle der Windows-Kodierung
// beim Ordnerexport (tenantFolder.ts) und Tests, die prüfen, dass es nirgends steht.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DIRS = ['client/src', 'client/index.html', 'server/src', 'server/test', 'server/testing', 'shared', 'scripts', 'desktop/src', 'desktop/test', 'docs', 'packaging', '.github']
const ROOT_FILES = ['README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'MIGRATION.md', 'CLAUDE.md', 'SECURITY.md']
const TEXT = /\.(ts|tsx|js|mjs|cjs|css|html|md|json|yml|yaml|txt)$/
// Erzeugt oder eingefroren: die Migrationen und der eingefrorene Eingang des Umstiegs hängen an Prüfsummen
// (server/drizzle, legacy-schema.test.ts für schema.ts, write.ts, migrate.ts), die übrigen entstehen beim Bauen
const SKIP = /(^|\/)(node_modules|dist|drizzle)(\/|$)|package-lock\.json$|embedded-migrations\.js$|^server\/src\/legacy\/(schema|write|migrate)\.ts$/
const ALLOWED = ['WIN_ANSI_EXTRA', ".not.toContain('—')", '.not.toMatch(/—/)']

function files(entry: string): string[] {
  const full = path.join(ROOT, entry)
  if (!fs.existsSync(full) || SKIP.test(entry)) return []
  if (fs.statSync(full).isFile()) return TEXT.test(entry) ? [entry] : []
  return fs.readdirSync(full).flatMap((name) => files(path.posix.join(entry, name)))
}

test('Keine Geviertstriche in Oberfläche, Meldungen, Code und Doku', () => {
  const found: string[] = []
  for (const file of [...DIRS.flatMap(files), ...ROOT_FILES.filter((f) => fs.existsSync(path.join(ROOT, f)))]) {
    // Dieser Wächter selbst nennt das Zeichen
    if (file === 'server/test/geviertstrich.test.ts') continue
    fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n').forEach((line, i) => {
      if (line.includes('—') && !ALLOWED.some((a) => line.includes(a))) found.push(`${file}:${i + 1}: ${line.trim().slice(0, 100)}`)
    })
  }
  assert.deepEqual(found, [], `Geviertstrich gefunden; bitte Bindestrich, Doppelpunkt, Komma oder Klammer:\n${found.join('\n')}`)
})

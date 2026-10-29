// Wächter für #455: Welche Positionen Teile derselben Rechnung sind, sagt die Quelle (`sourceId`), nicht mehr die
// Heuristik `splitFamilyKey` über ähnliche Felder. Sie ist entfernt und soll nicht zurückkommen. Ausgenommen ist der
// eingefrorene Datenschritt unter server/src/db/dataSteps/, der seine eigene Kopie behält, denn ein veröffentlichter
// Schritt ändert sich nie.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DIRS = ['server/src', 'shared', 'client/src']

function files(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { recursive: true }).map(String)
    .map((f) => path.join(dir, f).split(path.sep).join('/'))
    .filter((f) => /\.(?:ts|tsx|js|mjs)$/.test(f) && !f.includes('/node_modules/') && !f.startsWith('server/src/db/dataSteps/'))
}

test('#455: splitFamilyKey kommt im Quelltext nicht mehr vor (außer im eingefrorenen Datenschritt)', () => {
  const all = DIRS.flatMap(files)
  assert.ok(all.includes('server/src/calc.ts') && all.includes('client/src/pages/Kosten.tsx'), 'der Wächter liest die richtigen Ordner')
  const hits = all.filter((f) => fs.readFileSync(path.join(ROOT, f), 'utf8').includes('splitFamilyKey'))
  assert.deepEqual(hits, [])
})

test('#455: der eingefrorene Datenschritt behält seine eigene Kopie der Heuristik', () => {
  const step = fs.readFileSync(path.join(ROOT, 'server/src/db/dataSteps/0077_quellrechnung.ts'), 'utf8')
  assert.match(step, /const familyKey = /)
  assert.doesNotMatch(step, /from '[^']*shared\//, 'eine Kopie, kein Import aus shared/')
})

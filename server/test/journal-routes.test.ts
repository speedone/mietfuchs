// Wächter: Jede schreibende Route hat ihren Satz im Verlauf (#318, journalRoutes.ts), und kein Satz
// steht für eine Route, die es nicht gibt. Geprüft wird der Quelltext von index.ts: Eine Route, deren
// Rumpf `writeData(` oder `saveSettings(` aufruft, schreibt.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { DRY_RUN_ROUTES, ROUTE_SENTENCES } from '../src/journalRoutes.ts'
import { serverRoot } from '../testing/api.ts'

const COLLECTIONS = ['units', 'tenancies', 'costItems', 'meters', 'readings', 'payments']


function writingRoutes(): { all: Set<string>, writing: Set<string> } {
  const source = fs.readFileSync(path.join(serverRoot, 'src', 'index.ts'), 'utf8')
  // Grenzen sind alle Routen und Middleware, damit ein Rumpf nicht in den nächsten hineinreicht.
  const boundaries = [...source.matchAll(/\n(?:\s*app\.(?:get|post|put|delete|use)\(|(?:export )?(?:async function|function|const|let|for) )/g)].map((m) => m.index ?? 0)
  const found = [...source.matchAll(/\bapp\.(post|put|delete)\((['`])([^'`]+)\2/g)]
  const all = new Set<string>()
  const writing = new Set<string>()
  for (const match of found) {
    const start = match.index ?? 0
    const end = boundaries.find((b) => b > start + 1) ?? source.length
    const body = source.slice(start, end)
    const paths = match[3].includes('${coll}') ? COLLECTIONS.map((c) => match[3].replace('${coll}', c)) : [match[3]]
    for (const p of paths) {
      const key = `${match[1].toUpperCase()} ${p}`
      all.add(key)
      if (/\bwriteData\(|\bsaveSettings\(/.test(body) && !DRY_RUN_ROUTES.has(key)) writing.add(key)
    }
  }
  return { all, writing }
}

test('Verlauf: Jede schreibende Route hat einen Satz', () => {
  const { writing } = writingRoutes()
  assert.ok(writing.size > 60, `nur ${writing.size} schreibende Routen gefunden`)
  const missing = [...writing].filter((key) => !ROUTE_SENTENCES[key])
  assert.deepEqual(missing, [])
})

test('Verlauf: Jeder Satz und jede Vorschau der Ausnahmeliste gehört zu einer Route, die es gibt', () => {
  const { all } = writingRoutes()
  assert.deepEqual([...DRY_RUN_ROUTES].filter((key) => !all.has(key)), [])
  assert.deepEqual(Object.keys(ROUTE_SENTENCES).filter((key) => !all.has(key)), [])
})

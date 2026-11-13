// Wächter (#188): Bankdaten gehen nie an eine KI. Kein Modul unter server/src/bank/ importiert aus server/src/ai/, und
// keines unter server/src/ai/ aus server/src/bank/, außer der Erkennung `looksLikeBankFile` aus read.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const src = path.join(import.meta.dirname, '..', 'src')
const sources = (dir: string): string[] =>
  fs.readdirSync(path.join(src, dir), { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts')).map((f) => path.join(src, dir, f))
const imports = (file: string): { from: string; names: string }[] =>
  [...fs.readFileSync(file, 'utf8').matchAll(/import\s+(type\s+)?([^'"]*?)\s*from\s*['"]([^'"]+)['"]/g)]
    .map((m) => ({ names: m[2] ?? '', from: path.resolve(path.dirname(file), m[3] ?? '') }))

test('Bankdaten und KI sind getrennt', () => {
  const bank = path.join(src, 'bank') + path.sep
  const ai = path.join(src, 'ai') + path.sep
  assert.ok(sources('bank').length >= 5)
  for (const file of sources('bank')) {
    for (const i of imports(file)) assert.ok(!i.from.startsWith(ai), `${path.relative(src, file)} importiert aus ai/: ${i.from}`)
  }
  for (const file of sources('ai')) {
    for (const i of imports(file)) {
      if (!i.from.startsWith(bank)) continue
      assert.equal(path.relative(bank, i.from), 'read.ts', `${path.relative(src, file)} importiert aus bank/`)
      assert.match(i.names, /^\{\s*looksLikeBankFile\s*\}$/, `${path.relative(src, file)} darf aus bank/read.ts nur looksLikeBankFile nehmen`)
    }
  }
})

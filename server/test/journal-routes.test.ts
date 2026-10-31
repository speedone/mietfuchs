// Wächter: Jede schreibende Route hat ihren Satz im Verlauf (#318, journalRoutes.ts), und kein Satz
// steht für eine Route, die es nicht gibt. Geprüft wird der Quelltext von index.ts: Eine Route, deren
// Rumpf `writeData(` oder `saveSettings(` aufruft, schreibt.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { DRY_RUN_ROUTES, MULTI_WRITE_ROUTES, ROUTE_SENTENCES } from '../src/journalRoutes.ts'
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

// #318, Schritt 4: Wie oft eine Route schreibt, über die Funktionen von index.ts hinweg (eine Route ruft `saveSettings`,
// das `writeData` ruft). Gezählt wird jede Stelle `writeData(` im Rumpf und in den Funktionen, die er nennt (auch als
// Handler, `app.put('/x', saveRoute)`), je Funktion einmal. Eine Schleife zählt einmal; das genügt, denn ein Schreiben in
// einer Schleife ist ohnehin ein Fall für die Liste.
export function writesPerRoute(source: string): Map<string, number> {
  const boundaries = [...source.matchAll(/\n(?:\s*app\.(?:get|post|put|delete|use)\(|(?:export )?(?:async function|function|const|let|for|type|class) )/g)].map((m) => m.index ?? 0)
  // Ohne Kommentare: Ein Satz, der eine Funktion nennt, ruft sie nicht.
  const bodyAt = (start: number) => source.slice(start, boundaries.find((b) => b > start + 1) ?? source.length).replace(/\/\/.*$/gm, '')
  const defs = new Map<string, string>()
  for (const m of source.matchAll(/\n(?:export )?(?:async function|function) ([A-Za-z0-9_]+)|\n(?:export )?const ([A-Za-z0-9_]+) = (?:async )?(?:\(|<|[a-z]+ =>)/g)) {
    const name = m[1] ?? m[2]
    const body = bodyAt(m.index ?? 0)
    // Ohne die Kopfzeile: Sonst zählte die Definition von `writeData` sich selbst.
    defs.set(name, body.slice(body.indexOf('\n', 1) === -1 ? body.length : body.indexOf(name) + name.length))
  }
  defs.delete('writeData')
  const memo = new Map<string, number>()
  const count = (name: string, seen: Set<string>): number => {
    const known = memo.get(name)
    if (known !== undefined) return known
    if (seen.has(name)) return 0
    seen.add(name)
    const body = defs.get(name) ?? ''
    let n = (body.match(/\bwriteData\(/g) ?? []).length
    for (const other of defs.keys()) if (other !== name && new RegExp(`\\b${other}\\b`).test(body)) n += count(other, seen)
    memo.set(name, n)
    return n
  }
  const out = new Map<string, number>()
  for (const match of source.matchAll(/\bapp\.(post|put|delete)\((['`])([^'`]+)\2/g)) {
    const body = bodyAt(match.index ?? 0)
    let n = (body.match(/\bwriteData\(/g) ?? []).length
    for (const name of defs.keys()) if (new RegExp(`\\b${name}\\b`).test(body)) n += count(name, new Set())
    const paths = match[3].includes('${coll}') ? COLLECTIONS.map((c) => match[3].replace('${coll}', c)) : [match[3]]
    for (const p of paths) out.set(`${match[1].toUpperCase()} ${p}`, n)
  }
  return out
}

test('Verlauf: Jede Route mit Satz schreibt höchstens einmal, außer sie steht mit Grund auf der Liste', () => {
  const counts = writesPerRoute(fs.readFileSync(path.join(serverRoot, 'src', 'index.ts'), 'utf8'))
  const many = [...counts].filter(([key, n]) => n > 1 && ROUTE_SENTENCES[key]).map(([key]) => key).sort()
  assert.deepEqual(many, Object.keys(MULTI_WRITE_ROUTES).sort())
  assert.ok(Object.values(MULTI_WRITE_ROUTES).every((reason) => reason.length > 20))
  // Der Zähler sieht die Wege über Funktionen: PUT /api/settings schreibt über `saveSettings` genau einmal.
  assert.equal(counts.get('PUT /api/settings'), 1)
  assert.equal(counts.get('PUT /api/settlement/:period/letters/:tenancyId'), 1)
})

// Die Mutationsprobe des Zählers: Ein zweites Schreiben in einer Route fällt auf.
test('Verlauf: Der Zähler der Schreibvorgänge schlägt bei einem zweiten Schreiben an', () => {
  const source = fs.readFileSync(path.join(serverRoot, 'src', 'index.ts'), 'utf8')
  const mutated = source.replace("app.put('/api/units/:id/interim-gaps/:date', async (req, res) => {", "app.put('/api/units/:id/interim-gaps/:date', async (req, res) => {\n  await writeData(async () => undefined)")
  assert.notEqual(mutated, source)
  const before = writesPerRoute(source).get('PUT /api/units/:id/interim-gaps/:date') ?? 0
  assert.equal(writesPerRoute(mutated).get('PUT /api/units/:id/interim-gaps/:date'), before + 1)
})

// #490: Schnellerfassung und Belegordner sind eine Seite „Belege“. Ein Satz im Verlauf nennt keine Seite, die es nicht
// mehr gibt; ältere Einträge zeigen danach den neuen Satz.
test('Verlauf: kein Satz nennt Schnellerfassung, Belegordner oder Posteingang', () => {
  const old = Object.entries(ROUTE_SENTENCES).filter(([, s]) => /Schnellerfassung|Belegordner|Posteingang/.test(s.text))
  assert.deepEqual(old, [])
  assert.equal(ROUTE_SENTENCES['POST /api/intake']?.text, 'Beleg mit KI ausgewertet')
})

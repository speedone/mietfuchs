// Kompatibilitätszusage ab 1.0 (#447), Teil „Umgebungsvariablen“: Die Zusage nennt „die Umgebungsvariablen“, also
// muss feststehen, welche. Die Liste der öffentlichen steht in docs/installation.md („Umgebungsvariablen“). Dieser
// Wächter liest jeden Namen `NKA_…` aus dem Quelltext von Server, Skripten, Programmfenster und Docker-Dateien und
// verlangt für jeden eine Entscheidung: öffentlich (Zeile in der Tabelle der Doku) oder intern (Liste hier, mit Grund).
//
// **Eine neue Variable macht den Test rot.** Dann: Soll ein Nutzer sie setzen dürfen, kommt sie mit Bedeutung und
// Voreinstellung in die Tabelle und gilt ab 1.0 als zugesagt. Setzt Mietfuchs sie für sich selbst, kommt sie in
// `INTERNAL`. Ein Griff nur für Tests heißt `NKA_TEST_…` und braucht keinen Eintrag.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// Nicht Teil der Zusage, je mit Grund. Die Doku nennt sie unter der Tabelle als „nicht Teil der Zusage“.
const INTERNAL: Record<string, string> = {
  NKA_RUNTIME: 'die Betriebsart; das Dockerfile setzt docker, Prüfläufe stellen damit binary und desktop nach',
  NKA_DESKTOP: 'setzt das Programmfenster für seinen Server (desktop/src/server.js)',
  NKA_STORE: 'setzt das Programmfenster aus dem Microsoft Store für seinen Server',
  NKA_WINDOW_KEY: 'der Schlüssel zwischen Programmfenster und seinem Server, je Start neu',
  NKA_SEARCH_DIRS: 'die Suchorte für den Umzug, die das Programmfenster seinem Server nennt',
  // Griffe für Tests aus der Zeit vor dem Präfix NKA_TEST_. Sie umzubenennen wäre eine Verhaltensänderung.
  NKA_UPDATE_URL: 'Testgriff: lenkt die Update-Prüfung auf einen eigenen Server oder ins Leere',
  NKA_MODELS_URL: 'Testgriff: lenkt das Laden der Modellempfehlungen um',
  NKA_OLLAMA_CANDIDATES: 'Testgriff: die Adressen, unter denen Mietfuchs ein Ollama sucht',
  NKA_RESTORE_MAX_BYTES: 'Testgriff: setzt die Grenze beim Wiederherstellen für die Tests herab',
}
const TEST_PREFIX = 'NKA_TEST_'

const SOURCE = /\.(ts|tsx|js|mjs|cjs|json|yml|yaml|sh|ps1)$/
function filesIn(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'node_modules' || e.name === 'data') return []
    const full = path.join(dir, e.name)
    return e.isDirectory() ? filesIn(full) : SOURCE.test(e.name) ? [full] : []
  })
}

// Wo Mietfuchs und seine Verpackung Umgebungsvariablen lesen oder setzen.
const scanned = [
  ...['server/src', 'shared', 'scripts', 'desktop/src', 'deploy'].flatMap((d) => filesIn(path.join(ROOT, d))),
  ...['Dockerfile', 'docker-compose.yml'].map((f) => path.join(ROOT, f)),
]

// Jeder Name samt den Dateien, die ihn nennen. Ein Name, der auf `_` endet, ist ein genanntes Präfix (`NKA_TEST_…`).
function namesInSource(): Map<string, string[]> {
  const found = new Map<string, string[]>()
  for (const file of scanned) {
    for (const name of new Set(fs.readFileSync(file, 'utf8').match(/\bNKA_[A-Z0-9_]+/g) ?? [])) {
      if (name.endsWith('_')) continue
      found.set(name, [...(found.get(name) ?? []), path.relative(ROOT, file)])
    }
  }
  return found
}

type DocRow = { name: string, meaning: string, preset: string }
const DOC = 'docs/installation.md'
// Die Tabelle unter „## Umgebungsvariablen“: `| \`NKA_X\` | Bedeutung | Voreinstellung |`
function documented(): { rows: DocRow[], section: string } {
  const doc = fs.readFileSync(path.join(ROOT, DOC), 'utf8')
  const at = doc.indexOf('\n## Umgebungsvariablen\n')
  assert.ok(at >= 0, `In ${DOC} fehlt der Abschnitt „## Umgebungsvariablen“`)
  const end = doc.indexOf('\n## ', at + 1)
  const section = doc.slice(at, end < 0 ? undefined : end)
  const rows = section.split('\n').flatMap((line): DocRow[] => {
    const m = /^\| `(NKA_[A-Z0-9_]+)` \| (.*) \| (.*) \|$/.exec(line)
    return m ? [{ name: m[1] ?? '', meaning: (m[2] ?? '').trim(), preset: (m[3] ?? '').trim() }] : []
  })
  return { rows, section }
}

test('der Wächter liest wirklich Quelltext (sonst wäre er wirkungslos)', () => {
  const found = namesInSource()
  assert.ok(scanned.length > 100, `nur ${scanned.length} Dateien gelesen`)
  for (const name of ['NKA_DATA_DIR', 'NKA_PORT', 'NKA_HOST', 'NKA_TEST_TODAY']) assert.ok(found.has(name), `${name} nicht gefunden`)
})

test('jede Umgebungsvariable NKA_… ist entschieden: öffentlich in der Doku oder intern mit Grund', () => {
  const publicNames = new Set(documented().rows.map((r) => r.name))
  const open = [...namesInSource()].filter(([name]) => !name.startsWith(TEST_PREFIX) && !publicNames.has(name) && !(name in INTERNAL))
  assert.deepEqual(open.map(([name, files]) => `${name} (${files.slice(0, 3).join(', ')})`), [],
    `Neue Umgebungsvariable ohne Entscheidung. Soll ein Nutzer sie setzen, gehört sie mit Bedeutung und Voreinstellung in die Tabelle in ${DOC} ` +
    '(„Umgebungsvariablen“) und ist ab 1.0 zugesagt; setzt Mietfuchs sie für sich selbst, gehört sie mit Grund in INTERNAL in diesem Test und in den Absatz ' +
    '„Nicht Teil der Zusage“ der Doku. Ein Griff nur für Tests heißt NKA_TEST_….')
})

test('die Doku-Liste nennt nur Variablen, die es gibt, je einmal, mit Bedeutung und Voreinstellung', () => {
  const found = namesInSource()
  const { rows } = documented()
  assert.ok(rows.length >= 15, `nur ${rows.length} Zeilen in der Tabelle gelesen`)
  assert.deepEqual(rows.map((r) => r.name).filter((n, i, all) => all.indexOf(n) !== i), [], 'doppelt in der Tabelle')
  for (const row of rows) {
    assert.ok(found.has(row.name), `${row.name} steht in ${DOC}, aber nirgends im Quelltext: Eine zugesagte Variable fällt nicht still weg (Kompatibilitätszusage ab 1.0).`)
    assert.ok(row.meaning.length > 10, `${row.name}: Bedeutung fehlt`)
    assert.ok(row.preset.length > 0, `${row.name}: Voreinstellung fehlt`)
    assert.ok(!row.name.startsWith(TEST_PREFIX) && !(row.name in INTERNAL), `${row.name} ist zugleich öffentlich und intern`)
  }
})

test('was intern ist, gibt es noch, hat einen Grund und steht in der Doku als nicht zugesagt', () => {
  const found = namesInSource()
  const { section } = documented()
  const outside = section.slice(section.indexOf('**Nicht Teil der Zusage**'))
  assert.ok(outside.startsWith('**Nicht Teil der Zusage**'), `In ${DOC} fehlt der Absatz „Nicht Teil der Zusage“`)
  for (const [name, reason] of Object.entries(INTERNAL)) {
    assert.ok(found.has(name), `${name} steht in INTERNAL, aber nirgends mehr im Quelltext`)
    assert.ok(reason.length > 10, `${name}: Grund fehlt`)
    assert.ok(outside.includes(`\`${name}\``), `${name} fehlt im Absatz „Nicht Teil der Zusage“ in ${DOC}`)
  }
  assert.ok(outside.includes(`\`${TEST_PREFIX}\``), `Der Absatz nennt das Präfix ${TEST_PREFIX}`)
})

// Die Voreinstellungen, die sich aus dem Quelltext wörtlich lesen lassen: Port und Adresse von Ollama.
test('Voreinstellungen der Doku stimmen mit dem Quelltext überein (Port, Ollama)', () => {
  const preset = (name: string): string => documented().rows.find((r) => r.name === name)?.preset ?? assert.fail(`${name} fehlt in der Tabelle`)
  const index = fs.readFileSync(path.join(ROOT, 'server/src/index.ts'), 'utf8')
  assert.match(index, /const PORT = Number\(process\.env\.NKA_PORT \|\| 3001\)/)
  assert.equal(preset('NKA_PORT'), '`3001`')
  const settings = fs.readFileSync(path.join(ROOT, 'server/src/ai/settings.ts'), 'utf8')
  assert.match(settings, /const DEFAULT_OLLAMA_URL = 'http:\/\/localhost:11434'/)
  assert.equal(preset('NKA_OLLAMA_URL'), '`http://localhost:11434`')
  assert.equal(preset('NKA_AUTH'), '`auto`')
})

test('docs/docker.md und der Abschnitt Kompatibilität der README verweisen auf die Liste', () => {
  for (const [file, link] of [['docs/docker.md', 'installation.md#umgebungsvariablen'], ['README.md', 'docs/installation.md#umgebungsvariablen']] as const) {
    assert.ok(fs.readFileSync(path.join(ROOT, file), 'utf8').includes(link), `${file} verweist nicht auf ${link}`)
  }
})

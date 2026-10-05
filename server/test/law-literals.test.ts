// Wächter über Rechtszahlen außerhalb des Rechtsregisters (Heizung PR 1, Entwurf 4.7). Eine
// Rechtszahl steht nur in shared/law/; überall sonst kommt sie von dort. Sonst kann ein Text
// „15 %“ sagen, während die Rechnung schon mit einem anderen Satz rechnet, oder ein Datum in einer
// Bedingung überleben, wenn das Register eine neue Fassung bekommt.
//
// Geprüft wird der Quelltext mit demselben Scanner wie die Anrede (testing/sourceScan.ts): nur
// Zeichenketten und JSX-Text, keine Kommentare, keine Prompts an das Modell. Zwei Prüfungen:
//
// - **Prozentangaben im Muster einer Rechtsfolge** („um 15 %“, „15 % kürzen“, „50 bis 70 %“,
//   „mindestens 50 und höchstens 70 %“, „15 Prozent“) in Server, Oberfläche und shared/, außer
//   shared/law/. Ein Prozentsatz, der über `${…}` eingesetzt wird, ist kein Literal und fällt
//   nicht auf; so bleiben Nutzerdaten wie die vereinbarten Anteile (`custom`) außen vor.
// - **Datumsliterale** (ISO und deutsch) in den Dateien der Berechnung. Spätere PRs ergänzen ihre
//   Dateien (co2.ts, fuel.ts, period.ts) in ENGINE_FILES.
//
// Erlaubte Stellen stehen unten benannt, jede mit Grund. Eine erlaubte Stelle, die es nicht mehr
// gibt, ist ein Fehler: Sonst bliebe die Ausnahme stehen und deckte später etwas anderes.
// Beispielrechnungen im Lexikon dürfen „70 % nach Verbrauch“ sagen; das trifft kein Muster.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scan } from '../testing/sourceScan.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const PERCENT_PATTERNS = [/um \d+ ?%/g, /\d+ ?% kürzen/g, /\d+ bis \d+ ?%/g, /\d+ und höchstens \d+ ?%/g, /\d+ Prozent/g]
const DATE_PATTERNS = [/\d{4}-\d{2}-\d{2}/g, /\d{2}\.\d{2}\.\d{4}/g]
const ENGINE_FILES = ['server/src/calc.ts', 'server/src/snapshot.ts', 'shared/heating.ts']

type Allowed = { file: string; match: string; reason: string }
const ALLOWED: readonly Allowed[] = [
  { file: 'shared/glossary.ts', match: '100 Prozent', reason: 'Summe vereinbarter Quoten, keine Rechtsfolge' },
  { file: 'shared/glossary.ts', match: '20 Prozent', reason: '§ 35a Abs. 2 EStG, Steuer des Mieters; kein Parameter des Entwurfs (4.3)' },
  { file: 'shared/guides.ts', match: '3 Prozent', reason: 'CO₂-Kürzung nach § 7 Abs. 4 CO2KostAufG; `co2.cut.missing` kommt mit PR 6 ins Register (4.3, G-C7)' },
  { file: 'server/src/calc.ts', match: '31.05.2006', reason: 'Datum einer Entscheidung im Zitat (BGH VIII ZR 159/05), kein Rechtswert' },
  { file: 'server/src/calc.ts', match: '08.01.2013', reason: 'Datum einer Entscheidung im Zitat (BGH VIII ZR 180/12), kein Rechtswert' },
]

type Finding = { file: string; line: number; match: string }

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { recursive: true })
    .map(String)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.endsWith('.d.ts'))
    .map((f) => path.join(dir, f).split(path.sep).join('/'))
}

// Die Textstücke eines Quelltexts ohne die Prompts an das Modell (wie in anrede.test.ts).
const textsOf = (source: string, jsx: boolean): { text: string; line: number }[] =>
  scan(source, jsx).strings.filter((s) => !/prompt\w*\s*[=:]\s*$/i.test(s.before))
const texts = (file: string) => textsOf(fs.readFileSync(path.join(ROOT, file), 'utf8'), file.endsWith('.tsx'))

const matchesIn = (file: string, fragments: { text: string; line: number }[], patterns: readonly RegExp[]): Finding[] =>
  fragments.flatMap((s) => patterns.flatMap((p) => [...s.text.matchAll(p)].map((m) => ({ file, line: s.line, match: m[0] }))))

function findings(files: readonly string[], patterns: readonly RegExp[]): Finding[] {
  return files.flatMap((file) => matchesIn(file, texts(file), patterns))
}

const percentFiles = (): string[] =>
  [...sourceFiles('server/src'), ...sourceFiles('shared'), ...sourceFiles('client/src')].filter((f) => !f.startsWith('shared/law/'))

const isAllowed = (f: Finding): boolean => ALLOWED.some((a) => a.file === f.file && f.match.includes(a.match))
const report = (list: Finding[]): string => list.map((f) => `${f.file}:${f.line}: „${f.match}“`).join('\n')

test('Rechtszahlen: keine Prozentangabe einer Rechtsfolge außerhalb des Registers', () => {
  const open = findings(percentFiles(), PERCENT_PATTERNS).filter((f) => !isAllowed(f))
  assert.equal(open.length, 0, `Rechtszahl als Literal, bitte aus shared/law/ nehmen:\n${report(open)}`)
})

test('Rechtszahlen: kein Datumsliteral in den Dateien der Berechnung', () => {
  for (const file of ENGINE_FILES) assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} gibt es nicht; die Liste ist veraltet`)
  const open = findings(ENGINE_FILES, DATE_PATTERNS).filter((f) => !isAllowed(f))
  assert.equal(open.length, 0, `Datum als Literal, bitte aus shared/law/ nehmen:\n${report(open)}`)
})

test('Rechtszahlen: jede erlaubte Stelle gibt es noch, und jede hat einen Grund', () => {
  const all = [...findings(percentFiles(), PERCENT_PATTERNS), ...findings(ENGINE_FILES, DATE_PATTERNS)]
  for (const a of ALLOWED) {
    assert.ok(a.reason.trim(), `${a.file}: „${a.match}“ ohne Grund`)
    assert.ok(all.some((f) => f.file === a.file && f.match.includes(a.match)), `erlaubte Stelle nicht mehr da: ${a.file} „${a.match}“`)
  }
})

// Der Wächter selbst: Fängt er, was er fangen soll, und lässt er durch, was er durchlassen muss?
test('Rechtszahlen-Wächter: erkennt die Muster und übersieht Kommentare, eingesetzte Werte und Prompts', () => {
  const sample = [
    "// Kommentar: um 15 % kürzen",
    "const a = 'darf der Mieter seinen Anteil um 15 % kürzen'",
    'const b = `mindestens 50 und höchstens 70 % nach Verbrauch`',
    'const c = `um ${cut} % kürzen`',
    "const d = '50 bis 70 Prozent'",
    'const PROMPT = `Kürze um 15 % kürzen`',
    "const e = 'gilt bis 30.06.2024 und ab 2027-01-01'",
  ].join('\n')
  const found = (patterns: readonly RegExp[]) => matchesIn('probe.ts', textsOf(sample, false), patterns).map((f) => `${f.line}:${f.match}`)
  assert.deepEqual(found(PERCENT_PATTERNS), ['2:um 15 %', '2:15 % kürzen', '3:50 und höchstens 70 %', '5:70 Prozent'])
  assert.deepEqual(found(DATE_PATTERNS), ['7:2027-01-01', '7:30.06.2024'])
})

// Ohne diese Probe könnte der Wächter grün sein, weil er gar keine Datei liest.
test('Rechtszahlen-Wächter: er liest Server, Oberfläche, shared/ und die Dateien der Berechnung', () => {
  const files = percentFiles()
  for (const f of ['server/src/calc.ts', 'client/src/pages/Cockpit.tsx', 'shared/glossary.ts', 'shared/guides.ts']) assert.ok(files.includes(f), `${f} fehlt`)
  assert.ok(!files.some((f) => f.startsWith('shared/law/')), 'das Register selbst ist ausgenommen')
  assert.ok(texts('server/src/calc.ts').length > 200, 'der Scanner findet in calc.ts kaum Texte')
})

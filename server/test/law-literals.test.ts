// Wächter über Rechtszahlen außerhalb des Rechtsregisters (Heizung PR 1, Entwurf 4.7). Eine
// Rechtszahl steht nur in shared/law/; überall sonst kommt sie von dort. Sonst kann ein Text
// „15 %“ sagen, während die Rechnung schon mit einem anderen Satz rechnet, oder ein Datum in einer
// Bedingung überleben, wenn das Register eine neue Fassung bekommt.
//
// Geprüft wird der Quelltext mit demselben Scanner wie die Anrede (testing/sourceScan.ts): nur
// Zeichenketten und JSX-Text, keine Kommentare, keine Prompts an das Modell. Drei Prüfungen:
//
// - **Prozentangaben im Muster einer Rechtsfolge** („um 15 %“, „15 % kürzen“, „50 bis 70 %“,
//   „mindestens 50 und höchstens 70 %“, „15 Prozent“) in Server, Oberfläche und shared/, außer
//   shared/law/. Ein Prozentsatz, der über `${…}` eingesetzt wird, ist kein Literal und fällt
//   nicht auf; so bleiben Nutzerdaten wie die vereinbarten Anteile (`custom`) außen vor.
// - **Datumsliterale** (ISO und deutsch) in den Dateien der Berechnung. Spätere PRs ergänzen ihre
//   Dateien (co2.ts, fuel.ts, period.ts) in ENGINE_FILES.
// - **Zahlen im Code** (15, 50, 70, 19, 16, 2021, 2024, 2027) in den Dateien der Berechnung und in
//   invoiceAmounts.ts, ohne Zeichenketten und Kommentare (Durchsicht von #221, I2).
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

const PERCENT_PATTERNS = [/um \d+ ?%/g, /\d+ ?% kürzen/g, /\d+ bis \d+ ?%/g, /\d+ und höchstens \d+ ?%/g, /\d+ Prozent/g, /\d+ vom Hundert/g, /\d+–\d+ ?%/g]
const DATE_PATTERNS = [/\d{4}-\d{2}-\d{2}/g, /\d{2}\.\d{2}\.\d{4}/g]
const ENGINE_FILES = ['server/src/calc.ts', 'server/src/snapshot.ts', 'shared/heating.ts', 'shared/period.ts', 'shared/heatingPeriod.ts', 'shared/degreeDays.ts', 'server/src/remoteReading.ts', 'server/src/co2.ts']
// Rechtszahlen als Zahl im Code (Durchsicht von #221, I2): Die Muster oben sehen nur Texte, eine
// Zeile wie `Math.round((share * 15) / 100)` oder `year >= 2021` fiele durch. Geprüft wird der Code
// ohne Zeichenketten und Kommentare, in den Dateien der Berechnung und in invoiceAmounts.ts, auf die
// Zahlen, die heute im Register stehen. Eine Zahl in einem Bezeichner oder eine Dezimalzahl zählt
// nicht.
// Die Oberfläche der Heizung nennt Stichtage und Jahre aus dem Register (Durchsicht von #230, M5):
// Datumsangaben und Jahreszahlen der Rechtslage stehen dort nicht als Text.
const CLIENT_LAW_FILES = ['client/src/components/HeatingCard.tsx', 'client/src/pages/Zaehler.tsx', 'client/src/heatingForm.ts', 'client/src/meterForm.ts']
const CLIENT_LAW_PATTERNS = [...DATE_PATTERNS, /(?<![\w.])20[12]\d(?!\w|\.\d)/g]
const CODE_FILES = [...ENGINE_FILES, 'server/src/invoiceAmounts.ts']
const CODE_PATTERN = /(?<![\w.])(15|50|70|19|16|2021|2024|2027)(?![\w.])/g

type Allowed = { file: string; match: string; reason: string }
const ALLOWED: readonly Allowed[] = [
  { file: 'client/src/components/HeatingCard.tsx', match: '01.10.2024', reason: 'Frage nach der Wärmepumpe (§ 12 Abs. 3 HeizkostenV); `hkv.heat-pump.capture` kommt mit PR 10, PR 4 speichert nur die Antwort' },
  { file: 'client/src/components/HeatingCard.tsx', match: '2022', reason: 'Durchschnittskosten 2022 bis 2024 (§ 12 Abs. 3 Satz 3 HeizkostenV); `hkv.heat-pump.capture` kommt mit PR 10' },
  { file: 'client/src/components/HeatingCard.tsx', match: '2024', reason: 'Durchschnittskosten 2022 bis 2024 (§ 12 Abs. 3 Satz 3 HeizkostenV); `hkv.heat-pump.capture` kommt mit PR 10' },
  { file: 'shared/glossary.ts', match: '100 Prozent', reason: 'Summe vereinbarter Quoten, keine Rechtsfolge' },
  { file: 'shared/glossary.ts', match: '20 Prozent', reason: '§ 35a Abs. 2 EStG, Steuer des Mieters; kein Parameter des Entwurfs (4.3)' },
  { file: 'server/src/calc.ts', match: '31.05.2006', reason: 'Datum einer Entscheidung im Zitat (BGH VIII ZR 159/05), kein Rechtswert' },
  { file: 'server/src/calc.ts', match: '08.01.2013', reason: 'Datum einer Entscheidung im Zitat (BGH VIII ZR 180/12), kein Rechtswert' },
  { file: 'server/src/calc.ts', match: '30.04.2008', reason: 'Datum einer Entscheidung im Zitat (BGH VIII ZR 240/07, eigene Heizperiode), kein Rechtswert' },
  { file: 'server/src/invoiceAmounts.ts', match: 'Math.max(50,', reason: 'Rundungstoleranz der Schnellerfassung (mindestens 0,50 €), keine Rechtszahl' },
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

// Treffer im Code: `match` ist die ganze Zeile, damit eine erlaubte Stelle sie am Ausdruck erkennt
// und nicht an der Zahl allein. Der Scanner ersetzt Zeichenketten und Kommentare durch Leerzeichen
// und behält die Zeilenumbrüche, die Zeilennummern stimmen also.
function codeMatchesIn(file: string, source: string): Finding[] {
  return scan(source, file.endsWith('.tsx')).code.split('\n').flatMap((text, i) =>
    [...text.matchAll(CODE_PATTERN)].map(() => ({ file, line: i + 1, match: text.trim() })))
}
const codeFindings = (): Finding[] => CODE_FILES.flatMap((file) => codeMatchesIn(file, fs.readFileSync(path.join(ROOT, file), 'utf8')))

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

test('Rechtszahlen: kein Stichtag und kein Stichjahr als Text in der Oberfläche der Heizung', () => {
  for (const file of CLIENT_LAW_FILES) assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} gibt es nicht; die Liste ist veraltet`)
  const open = findings(CLIENT_LAW_FILES, CLIENT_LAW_PATTERNS).filter((f) => !isAllowed(f))
  assert.equal(open.length, 0, `Rechtsdatum als Literal in der Oberfläche, bitte aus shared/law/ nehmen:\n${report(open)}`)
})

test('Rechtszahlen: keine Zahl einer Rechtsregel im Code der Berechnung', () => {
  for (const file of CODE_FILES) assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} gibt es nicht; die Liste ist veraltet`)
  const open = codeFindings().filter((f) => !isAllowed(f))
  assert.equal(open.length, 0, `Rechtszahl im Code, bitte aus shared/law/ nehmen:\n${report(open)}`)
})

test('Rechtszahlen: jede erlaubte Stelle gibt es noch, und jede hat einen Grund', () => {
  const all = [...findings(percentFiles(), PERCENT_PATTERNS), ...findings(ENGINE_FILES, DATE_PATTERNS), ...findings(CLIENT_LAW_FILES, CLIENT_LAW_PATTERNS), ...codeFindings()]
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

// ---------- Rechtszahlen im Code (Durchsicht von #221, I2) ----------

// Ohne diese Probe könnte die Prüfung des Codes grün sein, weil sie die Zahlen gar nicht sieht: Jede
// der vier Stellen stand vor dem Rechtsregister so im Code und muss den Wächter rot machen.
test('Rechtszahlen-Wächter: eine Rechtszahl im Code der Berechnung fällt auf (Mutationsprobe)', () => {
  const mutations: [string, string][] = [
    ['server/src/calc.ts', 'const probe = Math.round((r.share * 15) / 100)'],
    ['server/src/calc.ts', 'const probe = year >= 2021'],
    ['shared/heating.ts', 'const probe = { min: 50, max: 70 }'],
    ['server/src/invoiceAmounts.ts', 'const VAT_PERCENT = 19'],
  ]
  for (const [file, line] of mutations) {
    const source = `${fs.readFileSync(path.join(ROOT, file), 'utf8')}\n${line}\n`
    const lastLine = source.split('\n').length - 1
    const hit = codeMatchesIn(file, source).filter((f) => !isAllowed(f) && f.line === lastLine)
    assert.ok(hit.length > 0, `nicht erkannt: ${file} „${line}“`)
  }
  // Kommentare und Zeichenketten gehören nicht zum Code; Zahlen in Bezeichnern und Dezimalzahlen
  // auch nicht.
  const quiet = "// um 15 Prozent\nconst a = 'ab 2027'\nconst x15 = 0.15 + 150 + 1.5\n"
  assert.deepEqual(codeMatchesIn('probe.ts', quiet), [])
})

test('Rechtszahlen-Wächter: „vom Hundert“ und Spannen mit Halbgeviertstrich sind Rechtsfolgen-Muster', () => {
  const sample = "const a = 'um 15 vom Hundert'\nconst b = 'zu 50–70 % nach Verbrauch'"
  const found = matchesIn('probe.ts', textsOf(sample, false), PERCENT_PATTERNS).map((f) => `${f.line}:${f.match}`)
  assert.ok(found.includes('1:15 vom Hundert'), found.join(', '))
  assert.ok(found.includes('2:50–70 %'), found.join(', '))
})

// Die Gradtagstabelle steht nur im Register (Entwurf 4.7: „die Zahlen von Stufen- und
// Gradtagstabelle als Feld“). Geprüft wird der Code ohne Kommentare, nicht nur die Texte: Eine
// Tabelle wäre ein Objekt aus Zahlen und fiele dem Scanner der Zeichenketten nicht auf.
test('Rechtszahlen: die Gradtagstabelle steht nur im Register (#208)', () => {
  const code = fs.readFileSync(path.join(ROOT, 'shared/degreeDays.ts'), 'utf8')
    .split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')
  assert.doesNotMatch(code, /\b(170|150|130|160|120)\b/, 'shared/degreeDays.ts enthält einen Wert der Gradtagstabelle')
})

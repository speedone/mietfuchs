// Der Wächter über die Anrede (#142): Mietfuchs siezt.
//
// Vorher duzten Cockpit, KI-Einstellungen, Schnellerfassung und Update-Hinweis, während Lexikon,
// Nutzungshilfe, Steuer und alle Meldungen des Servers siezten. Entschieden ist „Sie“ für alles,
// was ein Vermieter in der Oberfläche, auf der Konsole oder im Startmenü liest. README,
// CONTRIBUTING und die Doku für Entwickler bleiben beim „du“; sie liegen außerhalb dieser Prüfung.
//
// Geprüft wird der Quelltext, denn die Texte entstehen an Hunderten Stellen und kein Test rendert
// sie alle. Drei Fallen sind dabei bedacht:
//
// - **Kommentare zählen nicht.** Sie richten sich an Entwickler; der Scanner unten streift sie ab,
//   statt Zeilen anhand von `//` zu raten. Ein `//` im JSX-Text ist dabei kein Kommentar, sondern
//   Text („Wohnung // Haus“), und eine Adresse wie `https://` in einer Zeichenkette ebenso wenig.
// - **Geprüft werden nur Texte, nie Code.** In der Oberfläche sind das Zeichenketten und der
//   JSX-Text zwischen den Tags, im Server nur Zeichenketten. Bezeichner und Attributnamen zählen
//   nicht: Eine Variable `dir` oder ein `dir="auto"` ist kein Pronomen.
// - **Die Prompts an das Modell sind ausgenommen.** „Du bist ein Assistent …“ redet die KI an und
//   nicht den Vermieter. Erkannt werden sie an der Zuweisung an einen Namen oder eine Eigenschaft
//   mit `prompt` (`const PROMPT = …`, `{ prompt: … }`).
//
// JavaScripts `\b` kennt keine Umlaute, deshalb grenzen die Muster mit `\p{L}` ab.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const word = (alternatives: string): RegExp => new RegExp(`(?<![\\p{L}\\d_])(?:${alternatives})(?![\\p{L}\\d_])`, 'gu')

// Pronomen der zweiten Person. „eure“ fehlt mit Absicht, es träfe „Euro“ nicht, aber „teure“ schon
// nach einem Bindestrich; vorgekommen ist es ohnehin nie.
const PRONOUNS = word('[Dd]u|[Dd]ich|[Dd]ir|[Dd]ein\\p{L}*|[Ee]uch')
// Verbformen der zweiten Person Singular, die eindeutig sind („nutzt“ ist es nicht: er nutzt).
const VERBS = word('kannst|musst|hast|bist|willst|solltest|brauchst|findest|siehst|bekommst|möchtest|darfst|weißt|wirst|würdest|gibst|nimmst|übernimmst|prüfst|fängst|startest|lädst')
// Imperative in Du-Form am Satzanfang. Die Oberfläche schreibt Anweisungen sonst im Infinitiv
// („Bitte den Betrag prüfen“) oder siezt („Legen Sie … an“). Ein Satz beginnt auch am Anfang eines
// Textstücks, also direkt hinter einem JSX-Tag oder hinter `{…}`. „Lade …“ fehlt hier bewusst: Es
// ist die Fortschrittsanzeige „Lade Abrechnungsstand …“ und spricht niemanden an; als Anrede fällt
// es erst mit „hoch“ auf (LOAD_UP).
const IMPERATIVE_VERBS = 'Lege|Leg|Trage|Trag|Klicke|Wähle|Prüfe|Gib|Nimm|Wirf|Öffne|Starte|Speichere|Schau|Hinterlege|Ergänze|Erfasse|Lösche|Ändere|Füge|Richte|Installiere|Kopiere|Gehe|Geh|Mach|Mache|Setze|Schreibe|Melde|Ziehe|Zieh|Nutze|Verwende|Tippe|Schicke|Lies|Sieh|Lass'
const IMPERATIVES = new RegExp(`(?:^|[.!?:;—–]\\s+|[>}]\\s*|^\\s+)(${IMPERATIVE_VERBS})(?![\\p{L}\\d_])`, 'gmu')
// „Bitte prüfe …“: hinter „Bitte“ steht der Imperativ klein. „Bitte den Betrag prüfen“ bleibt frei.
const PLEASE = new RegExp(`(?<![\\p{L}\\d_])[Bb]itte\\s+(${IMPERATIVE_VERBS.toLowerCase()}|lade)(?![\\p{L}\\d_])`, 'gu')
// „Lade den Beleg hoch“ – im selben Satz.
const LOAD_UP = /(?<![\p{L}\d_])([Ll]ade)(?![\p{L}\d_])[^.!?\n]{0,80}?(?<![\p{L}\d_])hoch(?![\p{L}\d_])/gu

// Ein Textstück: eine Zeichenkette oder ein Stück JSX-Text. `before` ist der Code davor, an dem
// ein Prompt erkannt wird.
interface Fragment { text: string; line: number; before: string }

type Frame =
  // Code. `depth` zählt offene `{`; `resume` sagt, wohin ein `}` auf Tiefe null zurückführt.
  | { kind: 'code'; depth: number; resume: 'none' | 'text' | 'tag' | 'template'; before: string }
  | { kind: 'text' } // JSX-Text zwischen den Tags
  | { kind: 'tag' } // innerhalb von <…>, also Name und Attribute

// Ein kleiner Scanner für TypeScript und JSX. Er muss nicht jede Feinheit der Sprache kennen, nur
// Kommentare, Zeichenketten samt Vorlagen mit `${…}` und JSX-Text sicher abgrenzen. Ein
// Schrägstrich nach einem Operator ist ein regulärer Ausdruck und wird übersprungen, sonst läse
// er `/'/` als Beginn einer Zeichenkette. Ein `<` beginnt nur dort ein Tag, wo ein Ausdruck
// beginnen kann, also nicht hinter einem Bezeichner (`Array<string>`, `a < b`), und nur in .tsx.
function scan(source: string, jsx = false): { code: string; strings: Fragment[] } {
  let code = ''
  const strings: Fragment[] = []
  let line = 1
  let i = 0
  const stack: Frame[] = [{ kind: 'code', depth: 0, resume: 'none', before: '' }]

  const lastSignificant = (): string => code.replace(/\s+$/, '').slice(-1)
  const expressionMayStart = (): boolean =>
    lastSignificant() === '' || '(,=:[!&|?{};>'.includes(lastSignificant()) || /\breturn\s*$/.test(code)

  // '…' oder "…": endet spätestens am Zeilenende, so richtet ein verirrter Apostroph höchstens in
  // seiner eigenen Zeile Schaden an.
  const readString = (quote: string): void => {
    const start = line
    const before = code.slice(-120)
    let text = ''
    i++
    while (i < source.length && source[i] !== '\n') {
      const c = source[i]
      if (c === '\\') { text += ' '; i += 2; continue }
      if (c === quote) { i++; break }
      text += c
      i++
    }
    strings.push({ text, line: start, before })
    code += ' '
  }

  // `…`, ab der Stelle hinter dem Backtick oder hinter der `}` eines `${…}`.
  const readTemplate = (before: string): void => {
    const start = line
    let text = ''
    while (i < source.length) {
      const c = source[i]
      if (c === '\\') { text += ' '; i += 2; continue }
      if (c === '`') { i++; break }
      if (c === '$' && source[i + 1] === '{') {
        strings.push({ text, line: start, before })
        stack.push({ kind: 'code', depth: 0, resume: 'template', before })
        i += 2
        code += ' '
        return
      }
      if (c === '\n') line++
      text += c
      i++
    }
    strings.push({ text, line: start, before })
    code += ' '
  }

  while (i < source.length) {
    const top = stack[stack.length - 1]
    const c = source[i]
    const next = source[i + 1]

    if (top.kind === 'text') {
      const start = line
      let text = ''
      while (i < source.length && source[i] !== '<' && source[i] !== '{') {
        if (source[i] === '\n') line++
        text += source[i]
        i++
      }
      if (text.trim()) strings.push({ text, line: start, before: '' })
      if (source[i] === '{') {
        stack.push({ kind: 'code', depth: 0, resume: 'text', before: '' })
        i++
      } else if (source[i + 1] === '/') {
        // Schließendes Tag: zurück zum Elternelement.
        while (i < source.length && source[i] !== '>') i++
        i++
        stack.pop()
      } else {
        stack.push({ kind: 'tag' })
        i++
      }
      continue
    }

    if (top.kind === 'tag') {
      if (c === '"' || c === "'") { readString(c); continue }
      if (c === '{') { stack.push({ kind: 'code', depth: 0, resume: 'tag', before: '' }); i++; continue }
      if (c === '/' && next === '>') { stack.pop(); i += 2; continue }
      if (c === '>') { stack.pop(); stack.push({ kind: 'text' }); i++; continue }
      if (c === '\n') line++
      i++
      continue
    }

    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++
      continue
    }
    if (c === '/' && next === '*') {
      i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') { line++; code += '\n' }
        i++
      }
      i += 2
      continue
    }
    if (c === '/' && expressionMayStart()) {
      i++
      let inClass = false
      while (i < source.length && source[i] !== '\n') {
        if (source[i] === '\\') { i += 2; continue }
        if (source[i] === '[') inClass = true
        else if (source[i] === ']') inClass = false
        else if (source[i] === '/' && !inClass) { i++; break }
        i++
      }
      code += ' '
      continue
    }
    if (c === "'" || c === '"') { readString(c); continue }
    if (c === '`') { const before = code.slice(-120); i++; readTemplate(before); continue }
    if (jsx && c === '<' && /[A-Za-z>]/.test(next ?? '') && expressionMayStart()) {
      stack.push({ kind: 'tag' })
      i++
      continue
    }
    if (c === '{') top.depth++
    if (c === '}') {
      if (top.depth === 0 && top.resume !== 'none') {
        stack.pop()
        i++
        if (top.resume === 'template') readTemplate(top.before)
        continue
      }
      top.depth--
    }
    if (c === '\n') line++
    code += c
    i++
  }
  return { code, strings }
}

interface Finding { file: string; line: number; match: string }

function findAll(text: string, firstLine: number, file: string): Finding[] {
  const findings: Finding[] = []
  for (const pattern of [PRONOUNS, VERBS, IMPERATIVES, PLEASE, LOAD_UP]) {
    for (const m of text.matchAll(pattern)) {
      const offset = m.index ?? 0
      const line = firstLine + (text.slice(0, offset).match(/\n/g)?.length ?? 0)
      findings.push({ file, line, match: m[1] ?? m[0] })
    }
  }
  return findings
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { recursive: true })
    .map(String)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.endsWith('.d.ts'))
    .map((f) => path.join(dir, f))
}

type Kind = 'client' | 'server'

// Was der Wächter in einer Quelldatei findet. Geprüft werden nur Textstücke, nie Code; die
// Prompts an das Modell sind ausgenommen.
function check(source: string, kind: Kind, file = 'x.tsx'): Finding[] {
  const { strings } = scan(source, kind === 'client' && file.endsWith('.tsx'))
  return strings
    .filter((s) => !/prompt\w*\s*[=:]\s*$/i.test(s.before))
    .flatMap((s) => findAll(s.text, s.line, file))
}

function clientFiles(): string[] {
  return [...sourceFiles('client/src'), ...sourceFiles('shared')]
}

function clientFindings(): Finding[] {
  return clientFiles().flatMap((file) => check(fs.readFileSync(path.join(ROOT, file), 'utf8'), 'client', file))
}

function serverFindings(): Finding[] {
  return sourceFiles('server/src').flatMap((file) => check(fs.readFileSync(path.join(ROOT, file), 'utf8'), 'server', file))
}

function desktopFindings(): Finding[] {
  const file = 'packaging/mietfuchs.desktop'
  return fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n')
    .flatMap((text, index) => /^(Name|GenericName|Comment|Keywords)=/.test(text) ? findAll(text, index + 1, file) : [])
}

const report = (findings: Finding[]): string =>
  findings.map((f) => `${f.file}:${f.line}: „${f.match}“`).join('\n')

test('Anrede: die Oberfläche und das Lexikon siezen', () => {
  const findings = clientFindings()
  assert.equal(findings.length, 0, `Du-Anrede in Nutzertexten (#142, Mietfuchs siezt):\n${report(findings)}`)
})

test('Anrede: Meldungen des Servers siezen, die Prompts an das Modell sind ausgenommen', () => {
  const findings = serverFindings()
  assert.equal(findings.length, 0, `Du-Anrede in Meldungen des Servers (#142, Mietfuchs siezt):\n${report(findings)}`)
})

test('Anrede: der Startmenü-Eintrag siezt', () => {
  const findings = desktopFindings()
  assert.equal(findings.length, 0, report(findings))
})

// Der Wächter selbst: Fängt er, was er fangen soll, und lässt er durch, was er durchlassen muss?
test('Anrede: der Wächter erkennt Du-Formen und übersieht Code, Kommentare und Prompts', () => {
  const sample = [
    '// Kommentar: hier darf du stehen',
    "const dir = path.dirname(file) // dir ist kein Pronomen",
    "const a = 'Deine Daten bleiben gespeichert.'",
    'const b = `Solange er läuft, kannst du ${x} weiterarbeiten.`',
    "const c = 'Fertig. Lege sie unter Stammdaten an.'",
    'const re = /[\'"]/g',
    'const PROMPT = `Du bist ein Assistent. ${schema} Gib JSON zurück.`',
    "const d = 'Wählen Sie Ihre Datei. Laden Sie sie hoch.'",
    'const e = `Wie Sie ${`verschachtelt ${y}`} zurückkommen`',
    "const f = 'Übernommen wird erst, was du geprüft hast.'",
  ].join('\n')
  const { code } = scan(sample)
  const found = check(sample, 'server')
  assert.deepEqual(found.map((f) => `${f.line}:${f.match}`), ['3:Deine', '4:du', '4:kannst', '5:Lege', '10:du', '10:hast'])
  // Im Code bleibt `dir` als Bezeichner stehen; deshalb zählen nur Textstücke.
  assert.match(code, /const dir/)
  assert.doesNotMatch(code, /Kommentar|Pronomen/)
})

// Ohne diese Probe könnte der Wächter grün sein, weil der Scanner gar keinen Text findet. Gezählt
// werden Stellen, die siezen; liegen sie auf einmal bei null, prüft er nichts mehr.
test('Anrede: der Wächter sieht die Texte, die er prüft', () => {
  const sie = word('Sie|Ihre?[mnrs]?|Ihnen')
  const serverTexts = sourceFiles('server/src').flatMap((file) => scan(fs.readFileSync(path.join(ROOT, file), 'utf8')).strings.map((s) => s.text))
  const clientTexts = sourceFiles('client/src').flatMap((file) =>
    scan(fs.readFileSync(path.join(ROOT, file), 'utf8'), file.endsWith('.tsx')).strings.map((s) => s.text))
  const count = (texts: string[]): number => texts.reduce((n, t) => n + (t.match(sie)?.length ?? 0), 0)
  assert.ok(count(serverTexts) > 50, `nur ${count(serverTexts)} Sie-Stellen in den Zeichenketten des Servers`)
  assert.ok(count(clientTexts) > 30, `nur ${count(clientTexts)} Sie-Stellen in der Oberfläche`)
})

// ---------- Härtung nach der Durchsicht: je Lücke ein Selbsttest ----------

const matches = (source: string, kind: Kind): string[] => check(source, kind).map((f) => f.match)

test('Anrede-Wächter (1): ein Imperativ direkt nach einem JSX-Tag oder nach `}` fällt auf', () => {
  const source = [
    'const a = <p>Lege sie unter Stammdaten an.</p>',
    "const b = <p><b>Kosten</b>{' '}Wähle eine Datei.</p>",
    'const c = <p>{n}  Trage den Stand ein.</p>',
  ].join('\n')
  assert.deepEqual(matches(source, 'client'), ['Lege', 'Wähle', 'Trage'])
})

test('Anrede-Wächter (2): „Bitte prüfe …“ und „Lade … hoch“ fallen auf, „Lade Abrechnungsstand …“ nicht', () => {
  const source = [
    "const a = 'Bitte prüfe den Betrag.'",
    "const b = 'Bitte trag ihn ein.'",
    "const c = 'Fehlt etwas? Bitte gib es an.'",
    "const d = 'Lade den Beleg hoch.'",
    "const e = 'Lade Abrechnungsstand …'",
    "const f = 'Bitte den Betrag prüfen.'",
  ].join('\n')
  assert.deepEqual(matches(source, 'client'), ['prüfe', 'trag', 'gib', 'Lade'])
})

test('Anrede-Wächter (3): `//` im JSX-Fließtext ist kein Kommentar', () => {
  const source = [
    'const a = <p>Wohnung // dein Haus</p>',
    'const b = <p>Mieter//du</p>',
    '// ein echter Kommentar: du',
  ].join('\n')
  assert.deepEqual(matches(source, 'client'), ['dein', 'du'])
})

test('Anrede-Wächter (4): in der Oberfläche zählen nur JSX-Text und Zeichenketten, keine Bezeichner', () => {
  const source = [
    'const dir = props.dir',
    'const a = <div dir="auto" className="row">Text</div>',
    'const b = <Box dir={dir}>Sie sehen es.</Box>',
    'if (a > b) { const du = 1 } else { return <p>{x > 1 ? "ja" : "nein"} dein Haus</p> }',
  ].join('\n')
  assert.deepEqual(matches(source, 'client'), ['dein'])
})

test('Anrede-Wächter (5): ein Prompt als Objekteigenschaft ist ausgenommen', () => {
  const source = [
    'const options = { prompt: `Du bist ein Assistent. ${schema} Gib JSON zurück.` }',
    "const message = { text: 'Du kannst das ändern.' }",
  ].join('\n')
  assert.deepEqual(matches(source, 'server'), ['Du', 'kannst'])
})

test('Anrede-Wächter (6): der ganze Ordner shared/ wird geprüft', () => {
  const files = clientFiles()
  for (const file of sourceFiles('shared')) assert.ok(files.includes(file), `${file} fehlt in der Prüfung`)
  assert.ok(files.includes(path.join('shared', 'types.ts')))
})

test('Anrede-Wächter (7): weitere Imperative in Du-Form', () => {
  const source = ['Nutze die Vorlage.', 'Verwende Ollama.', 'Tippe den Betrag.', 'Schicke ihn ab.', 'Lies den Stand.', 'Sieh nach.', 'Lass das Feld leer.']
    .map((t, i) => `const t${i} = '${t}'`).join('\n')
  assert.deepEqual(matches(source, 'client'), ['Nutze', 'Verwende', 'Tippe', 'Schicke', 'Lies', 'Sieh', 'Lass'])
})

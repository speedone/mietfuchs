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
//   statt Zeilen anhand von `//` zu raten (eine Adresse wie `https://` ist kein Kommentar).
// - **Im Server zählen nur Zeichenketten.** Dort heißt eine Variable gern `dir`, und das ist kein
//   Pronomen. In der Oberfläche steht der Text dagegen auch als JSX zwischen den Tags, deshalb
//   zählt dort alles außer Kommentaren.
// - **Die Prompts an das Modell sind ausgenommen.** „Du bist ein Assistent …“ redet die KI an und
//   nicht den Vermieter. Erkannt werden sie an der Zuweisung an einen Namen mit `prompt`.
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
// („Bitte den Betrag prüfen“) oder siezt („Legen Sie … an“). „Lade …“ fehlt bewusst: Es ist die
// Fortschrittsanzeige „Lade Abrechnungsstand …“ und spricht niemanden an.
const IMPERATIVES = new RegExp(
  '(?:^|[.!?:;—–]\\s+|^\\s+)(Lege|Leg|Trage|Trag|Klicke|Wähle|Prüfe|Gib|Nimm|Wirf|Öffne|Starte|Speichere|Schau|Hinterlege|Ergänze|Erfasse|Lösche|Ändere|Füge|Richte|Installiere|Kopiere|Gehe|Geh|Mach|Mache|Setze|Schreibe|Melde|Ziehe|Zieh)(?![\\p{L}\\d_])',
  'gmu',
)

interface Fragment { text: string; line: number; before: string }

// Ein kleiner Scanner für TypeScript: trennt Code, Zeichenketten und Kommentare. Er muss nicht
// jede Feinheit der Sprache kennen, nur Kommentare sicher erkennen und Zeichenketten samt
// Vorlagen mit `${…}` richtig abgrenzen. Ein Schrägstrich nach einem Operator ist ein regulärer
// Ausdruck und wird übersprungen, sonst läse er `/'/` als Beginn einer Zeichenkette.
function scan(source: string): { code: string; strings: Fragment[] } {
  let code = ''
  const strings: Fragment[] = []
  let line = 1
  let i = 0
  // Stapel der offenen Vorlagen: je Eintrag die Klammertiefe außerhalb des `${…}` und der Code vor
  // der Vorlage. Den braucht die Fortsetzung hinter `}`, sonst gälte ein Prompt ab dem ersten
  // `${…}` nicht mehr als Prompt.
  const templates: { depth: number; before: string }[] = []
  let depth = 0

  const lastSignificant = (): string => code.replace(/\s+$/, '').slice(-1)

  const readString = (quote: string, continued?: string): void => {
    const start = line
    const before = continued ?? code.slice(-120)
    let text = ''
    i++
    while (i < source.length) {
      const c = source[i]
      if (c === '\\') { text += ' '; i += 2; continue }
      if (c === '\n') {
        // Eine Zeichenkette in '…' oder "…" endet spätestens am Zeilenende; so richtet ein
        // Apostroph im JSX-Text höchstens in seiner eigenen Zeile Schaden an.
        if (quote !== '`') break
        line++
      }
      if (c === quote) { i++; break }
      if (quote === '`' && c === '$' && source[i + 1] === '{') {
        strings.push({ text, line: start, before })
        templates.push({ depth, before })
        depth = 0
        i += 2
        code += ' '
        return
      }
      text += c
      i++
    }
    strings.push({ text, line: start, before })
    code += ' '
  }

  while (i < source.length) {
    const c = source[i]
    const next = source[i + 1]
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
    if (c === '/' && (lastSignificant() === '' || '(,=:[!&|?{};'.includes(lastSignificant()))) {
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
    if (c === "'" || c === '"' || c === '`') { readString(c); continue }
    if (templates.length > 0 && c === '{') depth++
    if (templates.length > 0 && c === '}') {
      if (depth === 0) {
        const outer = templates.pop()
        depth = outer?.depth ?? 0
        // Weiter in der Vorlage: `readString` überspringt das erste Zeichen, hier die `}`.
        readString('`', outer?.before)
        continue
      }
      depth--
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
  for (const pattern of [PRONOUNS, VERBS, IMPERATIVES]) {
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

function clientFindings(): Finding[] {
  const files = [...sourceFiles('client/src'), 'shared/glossary.ts']
  return files.flatMap((file) => {
    const { code, strings } = scan(fs.readFileSync(path.join(ROOT, file), 'utf8'))
    // Im Code steht der JSX-Text; die Zeichenketten hat der Scanner herausgelöst, sie kommen dazu.
    return [...findAll(code, 1, file), ...strings.flatMap((s) => findAll(s.text, s.line, file))]
  })
}

function serverFindings(): Finding[] {
  return sourceFiles('server/src').flatMap((file) =>
    scan(fs.readFileSync(path.join(ROOT, file), 'utf8')).strings
      .filter((s) => !/prompt\w*\s*=\s*$/i.test(s.before))
      .flatMap((s) => findAll(s.text, s.line, file)))
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
  const { strings, code } = scan(sample)
  const found = strings.filter((s) => !/prompt\w*\s*=\s*$/i.test(s.before)).flatMap((s) => findAll(s.text, s.line, 'x'))
  assert.deepEqual(found.map((f) => `${f.line}:${f.match}`), ['3:Deine', '4:du', '4:kannst', '5:Lege', '10:du', '10:hast'])
  // Im Code bleibt `dir` als Bezeichner stehen; deshalb zählen im Server nur Zeichenketten.
  assert.match(code, /const dir/)
  assert.doesNotMatch(code, /Kommentar|Pronomen/)
})

// Ohne diese Probe könnte der Wächter grün sein, weil der Scanner gar keinen Text findet. Gezählt
// werden Stellen, die siezen; liegen sie auf einmal bei null, prüft er nichts mehr.
test('Anrede: der Wächter sieht die Texte, die er prüft', () => {
  const sie = word('Sie|Ihre?[mnrs]?|Ihnen')
  const serverTexts = sourceFiles('server/src').flatMap((file) => scan(fs.readFileSync(path.join(ROOT, file), 'utf8')).strings.map((s) => s.text))
  const clientTexts = sourceFiles('client/src').flatMap((file) => {
    const { code, strings } = scan(fs.readFileSync(path.join(ROOT, file), 'utf8'))
    return [code, ...strings.map((s) => s.text)]
  })
  const count = (texts: string[]): number => texts.reduce((n, t) => n + (t.match(sie)?.length ?? 0), 0)
  assert.ok(count(serverTexts) > 50, `nur ${count(serverTexts)} Sie-Stellen in den Zeichenketten des Servers`)
  assert.ok(count(clientTexts) > 30, `nur ${count(clientTexts)} Sie-Stellen in der Oberfläche`)
})

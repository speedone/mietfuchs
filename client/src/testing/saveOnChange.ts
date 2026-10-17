// Der Wächter aus #309: Auswahlfelder, Häkchen, Optionsfelder und Datumsfelder, deren `onChange`
// sofort speichert. Wer sich verklickt, hat dort den Wert schon geändert, ohne Schaltfläche und
// ohne Zurück. Geändertes geht stattdessen über `useDraft` und `<DraftActions>` (draft.ts).
//
// Geprüft wird der Quelltext, wie in uiRules.test.ts: Am Verhalten ließe sich das nur Feld für Feld
// messen. Die Prüfung ist bewusst einfach gehalten und kennt ihre Grenzen:
// - Sie liest nur die eingebauten Elemente (`<select`, `<input type="checkbox|radio|date">`), keine
//   eigenen Bausteine, die ein `onChange` weiterreichen; dort entscheidet die Seite, die ihn setzt.
// - Was „speichert“, erkennt sie am Aufruf von `api(` oder `fetch(`, an einer Methode PUT, POST,
//   PATCH oder DELETE und an Aufrufen von Funktionen, deren Name mit save, persist oder submit
//   beginnt. Ruft `onChange` eine Funktion auf, die in derselben Datei steht oder relativ
//   importiert ist, sieht sie in deren Rumpf nach, bis in die dritte Ebene. Ein Rückruf aus den
//   Props mit anderem Namen (`onPick(…)`) bleibt unsichtbar, er gehört der Datei, die ihn übergibt.

export type Field = 'select' | 'checkbox' | 'radio' | 'date'

export type Finding = {
  file: string
  line: number
  field: Field
  // Woran das Speichern erkannt wurde: der Name der aufgerufenen Funktion aus `onChange`, sonst
  // `api`, `fetch` oder die Methode. Stabil über Zeilenverschiebungen, deshalb Schlüssel der Ausnahmen.
  via: string
}

// Öffnende Tags von select und input. Gesucht wird der Anfang, das Ende ergibt `tagEnd`.
const TAG_START = /<(select|input)\b/g

// Das Ende eines öffnenden JSX-Tags: das erste `>` außerhalb von geschweiften Klammern und Texten.
// Ein `=>` in `onChange={(e) => …}` steht in Klammern und zählt deshalb nicht.
export function tagEnd(source: string, from: number): number {
  let depth = 0
  let quote: string | null = null
  for (let i = from; i < source.length; i++) {
    const c = source[i]
    if (quote) {
      if (c === '\\') { i++; continue }
      if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      // Auf oberster Ebene sind nur Attributtexte in "…" üblich; ein Apostroph in einem Text ist
      // dort keiner. In Klammern sind alle drei Zeichen Anfang eines Texts.
      if (depth > 0 || c === '"') quote = c
      continue
    }
    if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === '>' && depth === 0) return i
  }
  return source.length
}

// Der Inhalt in ausgeglichenen geschweiften Klammern ab `open` (dem `{`), ohne die äußeren.
export function braced(source: string, open: number): string {
  let depth = 0
  let quote: string | null = null
  for (let i = open; i < source.length; i++) {
    const c = source[i]
    if (quote) {
      if (c === '\\') { i++; continue }
      if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return source.slice(open + 1, i)
    }
  }
  return source.slice(open + 1)
}

function fieldOf(name: string, tag: string): Field | null {
  if (name === 'select') return 'select'
  const type = /\stype="(checkbox|radio|date)"/.exec(tag)?.[1]
  return (type as Field | undefined) ?? null
}

// Unmittelbares Speichern im Ausdruck selbst.
const DIRECT = /\b(api|fetch)\s*[<(]|method:\s*['"](PUT|POST|PATCH|DELETE)['"]/
// Aufrufe, deren Name schon sagt, dass gespeichert wird; auch als Methode (`draft.save(…)`), und
// auch, wenn die Funktion aus den Props kommt und sich deshalb nicht nachschlagen lässt. Nicht
// `patch`, `put` oder `post`: `patch(…)` und `patchEntry(…)` ändern in vielen Formularen nur den Entwurf.
const SAVING_NAME = /(?:^|[^\w$])(?:[\w$]+\.)?((?:save|persist|submit)[\w$]*)\s*\(/
// Aufgerufene Namen, um in deren Rumpf nachzusehen. `foo.bar(` liefert `bar` nicht: Methoden fremder
// Objekte sind nicht in dieser Datei definiert.
const CALLED = /(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*\(/g

// Die Definition einer Funktion dieser Datei: `function name(…) {…}` oder `const name = (…) => …`.
// Ergibt den Rumpf, bei einem Pfeil mit Ausdruck statt Rumpf den Ausdruck. Die Parameter werden
// übersprungen, denn ein Typ wie `changes: { year?: number }` hat selbst geschweifte Klammern.
function definitionOf(source: string, name: string): string | null {
  // Ein Name darf `$` enthalten, das in einem regulären Ausdruck etwas anderes heißt.
  name = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const declared = new RegExp(`(?:^|[^\\w$])function\\s+${name}\\s*\\(`).exec(source)
  const assigned = declared ? null : new RegExp(`(?:^|[^\\w$])(?:const|let)\\s+${name}\\s*=`).exec(source)
  const m = declared ?? assigned
  if (!m) return null
  let i = m.index + m[0].length
  if (declared) {
    // Hinter die schließende Klammer der Parameter.
    let depth = 1
    for (; i < source.length && depth > 0; i++) {
      if (source[i] === '(') depth++
      else if (source[i] === ')') depth--
    }
  } else {
    const arrow = source.indexOf('=>', i)
    if (arrow < 0) return null
    i = arrow + 2
    const rest = /^\s*/.exec(source.slice(i))?.[0].length ?? 0
    if (source[i + rest] !== '{') {
      // Der Ausdruck reicht bis zur nächsten Zeile, die nicht tiefer eingerückt ist als die
      // Definition; er darf auf der nächsten Zeile beginnen (`=>\n  api(…)`).
      const lineStart = source.lastIndexOf('\n', m.index) + 1
      const indent = /^[ \t]*/.exec(source.slice(lineStart))?.[0].length ?? 0
      const lines = source.slice(i).split('\n')
      const kept = [lines[0] ?? '']
      for (const line of lines.slice(1)) {
        if (line.trim() !== '' && (/^[ \t]*/.exec(line)?.[0].length ?? 0) <= indent) break
        kept.push(line)
      }
      return kept.join('\n')
    }
  }
  const open = source.indexOf('{', i)
  return open < 0 ? null : braced(source, open)
}

// Alle Quelltexte, nach Pfad wie `./pages/Abrechnung.tsx`. Damit sieht die Prüfung auch in Helfer
// hinein, die eine Seite aus einer anderen Datei importiert (`changeAssessmentYear` aus assessment.ts).
export type Sources = Record<string, string>

// Der Pfad einer relativen Einfuhr, wie er in `Sources` steht, oder `null`.
function resolveImport(from: string, spec: string, sources: Sources): string | null {
  const parts = from.split('/').slice(0, -1)
  for (const step of spec.split('/')) {
    if (step === '..') parts.pop()
    else if (step !== '.') parts.push(step)
  }
  const base = parts.join('/')
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
    if (sources[candidate] !== undefined) return candidate
  }
  return null
}

// Die Datei, aus der `name` eingeführt wird (`import { a, b as name } from './x'`), oder `null`.
// Gesucht wird dort unter dem ursprünglichen Namen.
function importedFrom(file: string, source: string, name: string, sources: Sources): { file: string, name: string } | null {
  for (const m of source.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"](\.[^'"]+)['"]/g)) {
    for (const entry of (m[1] ?? '').split(',')) {
      const [original, local] = entry.replace(/^\s*type\s+/, '').split(/\s+as\s+/).map((x) => x.trim())
      if ((local ?? original) !== name || !original) continue
      const target = resolveImport(file, m[2] ?? '', sources)
      return target ? { file: target, name: original } : null
    }
  }
  return null
}

// Woran das Speichern in `code` erkannt wird, oder `null`. `file` ist die Datei, in der `code` steht.
export function savingVia(code: string, file: string, sources: Sources, depth = 0, seen = new Set<string>()): string | null {
  const direct = DIRECT.exec(code)
  if (direct) return direct[1] ?? direct[2] ?? 'api'
  const named = SAVING_NAME.exec(code)
  if (named?.[1]) return named[1]
  if (depth >= 3) return null
  const source = sources[file] ?? ''
  // Ein bloßer Name (`onChange={toggle}`) ist ebenfalls ein Aufruf.
  const bare = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(code)?.[1]
  const names = new Set([...(bare ? [bare] : []), ...[...code.matchAll(CALLED)].map((m) => m[1] ?? '')])
  for (const name of names) {
    if (!name) continue
    const local = definitionOf(source, name)
    const imported = local === null ? importedFrom(file, source, name, sources) : null
    const where = imported ?? { file, name }
    const key = `${where.file}#${where.name}`
    if (seen.has(key)) continue
    seen.add(key)
    const body = local ?? (imported ? definitionOf(sources[imported.file] ?? '', imported.name) : null)
    if (body === null) continue
    if (savingVia(body, where.file, sources, depth + 1, seen) !== null) return name
  }
  return null
}

// Alle Felder einer Datei, deren `onChange` speichert.
export function findSavingFields(file: string, sources: Sources): Finding[] {
  const source = sources[file] ?? ''
  const findings: Finding[] = []
  for (const m of source.matchAll(TAG_START)) {
    const start = m.index
    const end = tagEnd(source, start + m[0].length)
    const tag = source.slice(start, end)
    const field = fieldOf(m[1] ?? '', tag)
    if (!field) continue
    const at = /\sonChange=\{/.exec(tag)
    if (!at) continue
    const handler = braced(tag, at.index + at[0].length - 1)
    const via = savingVia(handler, file, sources)
    if (via === null) continue
    findings.push({ file, line: source.slice(0, start).split('\n').length, field, via })
  }
  return findings
}

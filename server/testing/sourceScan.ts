// Ein kleiner Scanner für TypeScript und JSX, für Wächter, die Quelltext lesen: die Anrede
// (anrede.test.ts) und die Rechtszahlen (law-literals.test.ts). Er liefert die Zeichenketten
// samt JSX-Text, ohne Kommentare. Bis Heizung PR 1 stand er in anrede.test.ts.
//
// Liegt in testing/ und nicht in test/, weil `node --test` jede Datei unter test/ ausführt.

// Ein Textstück: eine Zeichenkette oder ein Stück JSX-Text. `before` ist der Code davor, an dem
// ein Prompt erkannt wird.
export interface Fragment { text: string; line: number; before: string }

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
export function scan(source: string, jsx = false): { code: string; strings: Fragment[] } {
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

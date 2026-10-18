// Wächter zu #309: Kein Auswahlfeld, Häkchen, Options- oder Datumsfeld speichert schon beim Anklicken.
// Wer sich verklickt, hätte sonst den Wert bereits geändert, ohne Schaltfläche und ohne Zurück.
// Geänderte Werte gehen über `useDraft` und `<DraftActions>` (useDraft.ts, DraftActions.tsx).
//
// Sofort speichern darf nur, was keine Daten ändert: der Wechsel von Zeitraum, Objekt oder Design
// und die Antwort auf die Frage nach der Update-Prüfung im Cockpit. Diese Wechsel rufen keinen
// Server auf und fallen dem Wächter deshalb gar nicht erst auf. Was er heute noch findet, steht
// unten mit Grund; jede Umstellung streicht ihren Eintrag, und Neues kommt nicht hinzu.
import { describe, expect, test } from 'vitest'
import { findSavingFields, type Sources } from './testing/saveOnChange'

const sources: Sources = import.meta.glob<string>(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}', '!./testing/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

type Exception = {
  file: string
  // Woran der Wächter das Speichern erkennt (`Finding.via`): der Name der Funktion aus `onChange`.
  via: string
  // Wie viele Felder dieser Datei so speichern. Eine Umstellung senkt die Zahl, und dann muss sie
  // auch hier sinken; ein weiteres Feld mit demselben Muster fällt ebenso auf.
  count: number
  // „Wird mit #309 umgestellt: …“ oder „Erlaubt: …“ mit dem Grund, warum es keine Daten ändert.
  reason: string
}

const EXCEPTIONS: Exception[] = [
  { file: './components/AssessmentReview.tsx', via: 'changeYear', count: 1, reason: 'Wird mit #309 umgestellt: Jahr der Buchung in der Auswertung eines Belegs.' },
  { file: './pages/Belege.tsx', via: 'place', count: 2, reason: 'Wird mit #309 umgestellt: Objekt und Jahr eines Belegs im Posteingang.' },
  { file: './pages/Belege.tsx', via: 'attachExisting', count: 2, reason: 'Wird mit #309 umgestellt: Beleg einer Position zuordnen.' },
  { file: './pages/Mietkonto.tsx', via: 'changeKind', count: 1, reason: 'Wird mit #309 umgestellt: Art einer Zahlung (fragt vorher schon nach).' },
]

const files = Object.keys(sources).filter((f) => f.endsWith('.tsx'))
const keyOf = (file: string, via: string) => `${file} → ${via}`

describe('Felder speichern nicht beim Anklicken (#309)', () => {
  test('der Wächter sieht die Seiten und Bausteine', () => {
    // Fände das Muster keine Dateien, wäre der Test grün, ohne etwas zu prüfen.
    expect(files).toContain('./pages/Abrechnung.tsx')
    expect(files).toContain('./components/Update.tsx')
    expect(Object.keys(sources)).toContain('./assessment.ts')
  })

  test('nur die Stellen der Ausnahmeliste, und jede genau so oft wie dort angegeben', () => {
    const found = new Map<string, { count: number, lines: number[] }>()
    for (const file of files) {
      for (const f of findSavingFields(file, sources)) {
        const k = keyOf(f.file, f.via)
        const entry = found.get(k) ?? { count: 0, lines: [] }
        entry.count++
        entry.lines.push(f.line)
        found.set(k, entry)
      }
    }
    const actual = Object.fromEntries([...found].map(([k, v]) => [k, v.count]))
    const allowed = Object.fromEntries(EXCEPTIONS.map((e) => [keyOf(e.file, e.via), e.count]))
    // Steht hier eine neue Stelle: auf useDraft und DraftActions umstellen. Fehlt eine: Sie ist
    // umgestellt, dann den Eintrag streichen oder die Zahl senken.
    expect(actual, `gefunden: ${JSON.stringify(Object.fromEntries(found))}`).toEqual(allowed)
  })

  test('jede Ausnahme nennt ihren Grund', () => {
    for (const e of EXCEPTIONS) expect(e.reason, keyOf(e.file, e.via)).toMatch(/^(Wird mit #309 umgestellt|Erlaubt): \S/)
    expect(new Set(EXCEPTIONS.map((e) => keyOf(e.file, e.via))).size).toBe(EXCEPTIONS.length)
  })
})

// Der Wächter selbst: Er soll die Muster fangen, die es gab, und einen Ansichtswechsel durchlassen.
describe('der Wächter erkennt sofortiges Speichern', () => {
  const check = (page: string, extra: Sources = {}) =>
    findSavingFields('./pages/Probe.tsx', { './pages/Probe.tsx': page, ...extra }).map((f) => `${f.field}:${f.via}`)

  test('Aufruf von api unmittelbar in onChange', () => {
    expect(check(`<select value={v} onChange={(e) => void api('/api/x', { method: 'PUT', body: e.target.value })}><option /></select>`))
      .toEqual(['select:api'])
  })

  test('Methode PUT in einem Häkchen, auch über mehrere Zeilen', () => {
    expect(check(`<input
      type="checkbox"
      checked={on}
      onChange={(e) => { void request('/x', { method: 'PUT' }) }}
    />`)).toEqual(['checkbox:PUT'])
  })

  test('Funktion mit sprechendem Namen, auch aus den Props', () => {
    expect(check(`<input type="date" value={d} onChange={(e) => void saveSentAt(e.target.value)} />`)).toEqual(['date:saveSentAt'])
    expect(check(`<input type="radio" checked={a} onChange={() => props.onSave('a')} />`)).toEqual([])
    expect(check(`<input type="radio" checked={a} onChange={() => persistChoice('a')} />`)).toEqual(['radio:persistChoice'])
  })

  test('Funktion derselben Datei, die speichert, auch eine Ebene tiefer', () => {
    const page = `
      async function place(u: Upload, changes: { year?: number | null }) {
        await api(\`/api/uploads/\${u.file}\`, { method: 'PUT', body: JSON.stringify(changes) })
      }
      const move = (u: Upload, year: number) => { void place(u, { year }) }
      <select value={y} onChange={(e) => move(upload, Number(e.target.value))}><option /></select>
      <input type="checkbox" checked={x} onChange={toggle} />
      const toggle = async () => { await api('/api/settings', { method: 'PUT' }) }
    `
    expect(check(page)).toEqual(['select:move', 'checkbox:toggle'])
  })

  test('ein Name mit $ wird nachgeschlagen wie jeder andere', () => {
    expect(check(`const $put = () => api('/api/x', { method: 'PUT' })
      <select value={v} onChange={() => $put()}><option /></select>`)).toEqual(['select:$put'])
  })

  test('importierter Helfer, der speichert, auch als Pfeil über zwei Zeilen', () => {
    const page = `import { changeYear } from '../assessment'
      <select value={y} onChange={(e) => void changeYear(Number(e.target.value))}><option /></select>`
    const helper = `export const changeYear = (year: number): Promise<View> =>
  api<View>('/api/assessments/1', { method: 'PUT', body: JSON.stringify({ year }) })
`
    expect(check(page, { './assessment.ts': helper })).toEqual(['select:changeYear'])
  })

  test('Ansichtswechsel, Entwurf und lokaler Zustand gehen durch', () => {
    const page = `
      const patch = (idx: number, p: Partial<Row>) => setRows((r) => ({ ...r, [idx]: p }))
      function patchEntry(id: number, p: Partial<Entry>) { setQueue((q) => q.map((x) => (x.id === id ? { ...x, ...p } : x))) }
      <select value={param} onChange={(e) => void switchPeriod(e.target.value)}><option /></select>
      <select value={id} onChange={(e) => void switchProperty(e.target.value)}><option /></select>
      <input type="checkbox" checked={dark} onChange={(e) => setTheme(e.target.checked ? 'dark' : 'light')} />
      <input type="date" value={sentAt.value} onChange={(e) => sentAt.set(e.target.value)} />
      <select value={row.action} onChange={(e) => patch(1, { action: e.target.value })}><option /></select>
      <input type="checkbox" checked={c} onChange={() => patchEntry(1, { done: true })} />
      <input value={text} onChange={(e) => void api('/api/x', { method: 'PUT' })} />
    `
    // Das letzte Feld ist ein Textfeld; die schreiben ohnehin bei jedem Zeichen in den Zustand und
    // haben ihre eigene Schaltfläche. Der Wächter liest nur Auswahl, Häkchen, Option und Datum.
    expect(check(page)).toEqual([])
  })

  test('eine Funktion, die nur einen Entwurf speichert, gilt als speichernd: draft.save gehört an den Knopf', () => {
    expect(check(`<input type="checkbox" checked={d.value} onChange={(e) => { d.set(e.target.checked); void d.save(put) }} />`))
      .toEqual(['checkbox:save'])
  })
})

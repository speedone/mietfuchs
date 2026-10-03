// Die Prüfung einer gespeicherten Auswertung im Browser (Belegbuchung, #170). Entschieden wird je
// Zeile hier, gerechnet und gebucht auf dem Server: Die Vorschau kommt von dort, und gebucht wird
// genau das, was sie zeigt. Ohne DOM prüfbar (assessment.test.ts); die Komponente
// components/AssessmentReview.tsx rendert nur.
import type { AssessmentLine, AssessmentView, BookingPreview, CostKey, LineCandidate, LineDecision, LineFields } from './types'
import type { Allocation } from '../../shared/allocation.ts'
import { api, ApiError, fmtEuro, parseEuro } from './api'
import { withProperty } from './property'

export type RowAction = '' | 'create' | 'dismiss' | 'release' | `link:${string}`

// Eine Zeile, wie der Nutzer sie gerade sieht: Texte statt Cent, damit er frei korrigieren kann.
export type RowDraft = {
  action: RowAction
  description: string
  category: string
  amount: string
  labor35a: string
  key: CostKey
  allocation: Allocation | null
  externalTotalAmount: string
}

const centsText = (c: number | null): string =>
  c === null ? '' : (c / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
// Ein leeres Feld heißt „nicht gelesen“; was sich nicht lesen lässt, ebenso. Der Server sagt dann,
// was fehlt.
const cents = (raw: string): number | null => (raw.trim() ? parseEuro(raw) : null)

// Vorab angehakt ist, was der Server vorschlägt (`preselected`); sonst entscheidet der Nutzer.
export function initialRow(line: AssessmentLine): RowDraft {
  const f = line.suggestion?.fields
  return {
    action: line.state === 'open' && line.suggestion?.preselected ? 'create' : '',
    description: f?.description ?? line.description,
    category: f?.category ?? line.category,
    amount: centsText(f ? f.amountCents : line.amountCents),
    labor35a: centsText(f ? f.labor35aCents : line.labor35aCents),
    key: f?.key ?? 'area',
    allocation: f?.allocation ?? null,
    externalTotalAmount: '',
  }
}

export const initialRows = (v: AssessmentView): Record<number, RowDraft> =>
  Object.fromEntries(v.lines.map((l) => [l.idx, initialRow(l)]))

export function fieldsOf(row: RowDraft): LineFields {
  return {
    description: row.description,
    category: row.category,
    amountCents: cents(row.amount),
    labor35aCents: cents(row.labor35a),
    key: row.key,
    // Wer den Schlüssel wechselt, verlässt den gemerkten (AiKeyCell setzt ihn dann auf null).
    allocation: row.allocation && row.allocation.key === row.key ? row.allocation : null,
    externalTotalCents: cents(row.externalTotalAmount),
  }
}

// Die Entscheidungen, die an den Server gehen. Eine Zeile ohne Wahl bleibt offen; gebuchte Zeilen
// lassen sich nur lösen, und das nur, wenn sie verknüpft sind (eine angelegte löst man durch
// Löschen der Position).
export function decisionsOf(view: AssessmentView, rows: Record<number, RowDraft>): LineDecision[] {
  const out: LineDecision[] = []
  for (const line of view.lines) {
    const row = rows[line.idx]
    if (!row || row.action === '') continue
    if (row.action === 'release') {
      if (line.state === 'linked') out.push({ idx: line.idx, action: 'release' })
      continue
    }
    if (line.state !== 'open' && line.state !== 'dismissed') continue
    if (row.action === 'create') out.push({ idx: line.idx, action: 'create', fields: fieldsOf(row) })
    else if (row.action === 'dismiss') out.push({ idx: line.idx, action: 'dismiss' })
    else out.push({ idx: line.idx, action: 'link', costItemId: row.action.slice('link:'.length), amountCents: cents(row.amount), labor35aCents: cents(row.labor35a) })
  }
  return out
}

// Womit eine Zeile verknüpft werden kann: Kandidaten, deren Betrag nicht an weiteren Angaben hängt
// (die öffnet man im Formular), und nie, wenn die Zeile eine Gutschrift ist.
export function linkChoices(line: AssessmentLine, row: RowDraft): LineCandidate[] {
  const amount = cents(row.amount)
  if (amount !== null && amount < 0) return []
  return (line.suggestion?.candidates ?? []).filter((c) => !c.formOnly)
}

// Was die Auswahl einer Zeile zeigt und was von ihr gebucht wird, ist dasselbe: Ein Ziel zum
// Verknüpfen, das nicht mehr angeboten wird (Betrag ins Negative berichtigt, Kandidat nach einer
// anderen Buchung weggefallen), gilt als „offen lassen“. Sonst zeigte der Browser den ersten
// Eintrag der Liste und gebucht würde etwas anderes als das Sichtbare (CLAUDE.md, Auswahlfelder).
export function shownRow(line: AssessmentLine, row: RowDraft): RowDraft {
  if (!row.action.startsWith('link:')) return row
  const id = row.action.slice('link:'.length)
  return linkChoices(line, row).some((c) => c.id === id) ? row : { ...row, action: '' }
}

// Nach „Trotzdem anlegen“: dieselben Entscheidungen, die bestätigten Zeilen ausdrücklich.
export function withConfirmed(decisions: readonly LineDecision[], idxs: readonly number[]): LineDecision[] {
  return decisions.map((d) => (d.action === 'create' && idxs.includes(d.idx) ? { ...d, despiteCandidates: true } : d))
}

// „Alle grünen übernehmen“: offene Zeilen, die der Server vorab anhakt und grün bewertet, mit
// seinem Vorschlag. Eingaben, die noch in einer Tabelle stehen, gelten dabei nicht; wer etwas
// geändert hat, bucht diese Zeile mit „Vorschau“ und „Buchen“.
export function greenDecisions(view: AssessmentView): LineDecision[] {
  return view.lines.flatMap((l): LineDecision[] =>
    l.state === 'open' && l.suggestion?.preselected && l.suggestion.level === 'gruen'
      ? [{ idx: l.idx, action: 'create', fields: l.suggestion.fields }]
      : [])
}

const laborText = (c: number | null): string => (c === null ? 'keiner' : fmtEuro(c))

// Die Vorschau in Sätzen, je Position eine Zeile.
export function previewLines(p: BookingPreview): string[] {
  return p.items.map((i) => {
    if (i.costItemId === null) {
      return `Neu: „${i.description}“ (${i.category}) ${fmtEuro(i.afterCents)}${i.afterLabor35aCents ? `, davon §35a ${fmtEuro(i.afterLabor35aCents)}` : ''}`
    }
    const labor = i.beforeLabor35aCents !== i.afterLabor35aCents ? `; §35a ${laborText(i.beforeLabor35aCents)} → ${laborText(i.afterLabor35aCents)}` : ''
    if (i.beforeCents === i.afterCents) return `„${i.description}“ bleibt bei ${fmtEuro(i.afterCents)}${labor}`
    return `„${i.description}“: ${fmtEuro(i.beforeCents ?? 0)} → ${fmtEuro(i.afterCents)}${labor}`
  })
}

// ---------- Gestalt der Antworten ----------
//
// Was der Server in einer Ablehnung mitschickt, wird an seinen Feldern erkannt und nicht
// behauptet: Ein Rumpf anderer Gestalt (ein Proxy, eine ältere Fassung des Servers) wird als
// Fehler weitergegeben, statt als Vorschau oder Auswertung in die Oberfläche zu geraten.
const fieldOf = (v: unknown, key: string): unknown => (v !== null && typeof v === 'object' ? Reflect.get(v, key) : undefined)

export function isPreview(v: unknown): v is BookingPreview {
  return Array.isArray(fieldOf(v, 'items')) && Array.isArray(fieldOf(v, 'notices')) && Array.isArray(fieldOf(v, 'errors')) &&
    Array.isArray(fieldOf(v, 'confirm')) && typeof fieldOf(v, 'token') === 'string'
}

export function isAssessment(v: unknown): v is AssessmentView {
  return typeof fieldOf(v, 'id') === 'string' && typeof fieldOf(v, 'file') === 'string' && Array.isArray(fieldOf(v, 'lines')) &&
    typeof fieldOf(v, 'open') === 'boolean' && typeof fieldOf(v, 'year') === 'number'
}

// ---------- Abrufe ----------

export const loadOpenAssessments = (propertyId: string | null | undefined): Promise<AssessmentView[]> =>
  api<AssessmentView[]>(withProperty('/api/assessments?open=1', propertyId))

export const planDecisions = (id: string, decisions: readonly LineDecision[]): Promise<BookingPreview> =>
  api<BookingPreview>(`/api/assessments/${encodeURIComponent(id)}/plan`, { method: 'POST', body: JSON.stringify({ decisions }) })

export const changeAssessmentYear = (id: string, year: number): Promise<AssessmentView> =>
  api<AssessmentView>(`/api/assessments/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ year }) })

export type BookResult =
  | { kind: 'done'; changed: boolean; assessment: AssessmentView; preview: BookingPreview }
  | { kind: 'refused' | 'stale'; message: string; preview: BookingPreview }
  | { kind: 'conflict'; message: string; assessment: AssessmentView }

const UNREADABLE = 'Die Antwort des Servers auf die Buchung ist unlesbar. Bitte laden Sie die Seite neu und sehen Sie nach, was gebucht ist.'

// Bucht und übersetzt die Ablehnungen des Servers (bookingResponse in server/src/bookingPlan.ts):
// 400 mit Vorschau (Fehler oder offene Rückfrage), 409 mit Vorschau (Stand geändert) und 409 mit
// Auswertung (anders gebucht). Alles andere wirft wie `api()`.
export async function bookDecisions(id: string, decisions: readonly LineDecision[], token: string): Promise<BookResult> {
  let r: unknown
  try {
    r = await api<unknown>(`/api/assessments/${encodeURIComponent(id)}/book`, { method: 'POST', body: JSON.stringify({ decisions, token }) })
  } catch (e) {
    if (!(e instanceof ApiError)) throw e
    const { preview, assessment } = e.data
    if (e.status === 409 && isAssessment(assessment)) return { kind: 'conflict', message: e.message, assessment }
    if ((e.status === 409 || e.status === 400) && isPreview(preview)) return { kind: e.status === 409 ? 'stale' : 'refused', message: e.message, preview }
    throw e
  }
  const changed = fieldOf(r, 'changed')
  const assessment = fieldOf(r, 'assessment')
  const preview = fieldOf(r, 'preview')
  if (typeof changed !== 'boolean' || !isAssessment(assessment) || !isPreview(preview)) throw new Error(UNREADABLE)
  return { kind: 'done', changed, assessment, preview }
}

// Die Prüfung einer gespeicherten Auswertung im Browser (Belegbuchung, #170). Entschieden wird je
// Zeile hier, gerechnet und gebucht auf dem Server: Die Vorschau kommt von dort, und gebucht wird
// genau das, was sie zeigt. Ohne DOM prüfbar (assessment.test.ts); die Komponente
// components/AssessmentReview.tsx rendert nur.
import type { AssessmentLine, AssessmentView, BookingPreview, CostKey, LineCandidate, LineDecision, LineFields, TrafficLight } from './types'
import { CATEGORIES } from './types'
import type { Allocation } from '../../shared/allocation.ts'
import { informsOnly } from '../../shared/assessment.ts'
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

// Vorab angehakt ist, was der Server vorschlägt (`preselected`); sonst entscheidet der Nutzer. Eine
// verworfene Zeile steht als verworfen da: Angezeigt wird, was gespeichert ist.
function initialAction(line: AssessmentLine): RowAction {
  if (line.state === 'dismissed') return 'dismiss'
  return line.state === 'open' && line.suggestion?.preselected ? 'create' : ''
}

export function initialRow(line: AssessmentLine): RowDraft {
  const f = line.suggestion?.fields
  return {
    action: initialAction(line),
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
    // Schon verworfen und dabei geblieben ist keine Entscheidung.
    else if (row.action === 'dismiss') { if (line.state === 'open') out.push({ idx: line.idx, action: 'dismiss' }) }
    else out.push({ idx: line.idx, action: 'link', costItemId: row.action.slice('link:'.length), amountCents: cents(row.amount), labor35aCents: cents(row.labor35a) })
  }
  return out
}

// Womit eine Zeile verknüpft werden kann: Kandidaten, deren Betrag nicht an weiteren Angaben hängt
// (die öffnet man im Formular), dazu die Positionen, die aus diesem Beleg schon gebucht sind (`sameReceipt`: eine
// Rechnung mit vielen Zeilen als eine Position), und nie, wenn die Zeile eine Gutschrift ist.
export function linkChoices(line: AssessmentLine, row: RowDraft): LineCandidate[] {
  const amount = cents(row.amount)
  if (amount !== null && amount < 0) return []
  const candidates = (line.suggestion?.candidates ?? []).filter((c) => !c.formOnly)
  return [...candidates, ...(line.suggestion?.sameReceipt ?? []).filter((c) => !candidates.some((k) => k.id === c.id))]
}

// Ist das Ziel eine Position, die aus diesem Beleg schon gebucht ist? Die Auswahl sagt dann, dass der Betrag dazukommt.
export const fromSameReceipt = (line: AssessmentLine, id: string): boolean =>
  (line.suggestion?.sameReceipt ?? []).some((c) => c.id === id) && !(line.suggestion?.candidates ?? []).some((c) => c.id === id)

// Die Notizen einer E-Rechnung, getrennt nach dem, was sie sagen (shared/assessment.ts, `informsOnly`): Zweifel an der
// Rechnung (färben jede Zeile rot) und bloße Information (bezahlte Abschläge).
export function noteGroups(v: Pick<AssessmentView, 'eInvoiceNotes'>): { doubts: string[]; info: string[] } {
  return { doubts: v.eInvoiceNotes.filter((n) => !informsOnly(n)), info: v.eInvoiceNotes.filter(informsOnly) }
}

// Die Begründungen unter der Tabelle: jede einmal, in der schlechtesten Farbe der Zeilen, die sie nennen. Eine Rechnung
// mit 14 Zeilen zeigte sonst dieselben Sätze 14-mal. Was schon als Notiz der E-Rechnung im Kasten darüber steht, kommt
// hier nicht noch einmal.
export function reasonChips(v: Pick<AssessmentView, 'lines' | 'eInvoiceNotes'>): { text: string; level: TrafficLight }[] {
  const chips = new Map<string, TrafficLight>()
  for (const l of v.lines) {
    const s = l.suggestion
    if (l.state !== 'open' || !s || s.level === 'gruen') continue
    for (const r of s.reasons) {
      if (v.eInvoiceNotes.includes(r)) continue
      chips.set(r, chips.get(r) === 'rot' ? 'rot' : s.level)
    }
  }
  return [...chips].map(([text, level]) => ({ text, level }))
}

// Die Jahre zur Wahl im Feld „Jahr der Buchung“: um das gespeicherte herum, dazu immer das gewählte Jahr
// (`requestedYear`). Liest die KI ein weit früheres Jahr aus dem Beleg, rät der Hinweis der Zeile, das Jahr der Buchung zu
// ändern; das gewählte muss dann in der Liste stehen. Das gespeicherte steht immer darin (der angezeigte Wert eines
// Auswahlfelds muss dem gespeicherten entsprechen). Bei abweichendem Zeitraum führt das gewählte Jahr in den gewählten
// Zeitraum zurück (der Server bildet ihn aus dem Jahr); das Jahr, in dem er beginnt, gehört nicht dazu: Bei Oktober bis
// September führte es in den Vorzeitraum.
export function yearOptions(v: Pick<AssessmentView, 'year' | 'requestedYear'>): number[] {
  const years = new Set([v.year - 2, v.year - 1, v.year, v.year + 1])
  if (v.requestedYear !== null) years.add(v.requestedYear)
  return [...years].sort((a, b) => a - b)
}

// Der Satz zu bezahlten Abschlägen im Kasten der Auswertung (`noteGroups().info`): warum die Zeilen nicht vorab angehakt sind.
export const PREPAID_ADVICE = 'Haben Sie diese Abschläge oder Anzahlungen schon einzeln als Kosten gebucht, dürfen sie nicht zusätzlich zählen: Prüfen Sie das, bevor Sie diese Rechnung buchen.'

// Steht der Grund einer Ampel nur im Kasten der Rechnung über der Tabelle (`reasonChips` nennt ihn nicht noch einmal),
// sagt die Ampel es Vorlesern; der `title` allein erreicht sie nicht.
export function ampelNote(v: Pick<AssessmentView, 'eInvoiceNotes'>, line: AssessmentLine): string | null {
  const s = line.suggestion
  if (!s || s.level === 'gruen' || !s.reasons.some((r) => v.eInvoiceNotes.includes(r))) return null
  return `${s.level === 'rot' ? 'Rot' : 'Gelb'}: siehe Hinweis zur Rechnung über der Tabelle`
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

// Nach „Trotzdem anlegen“ oder „Trotzdem verknüpfen“: dieselben Entscheidungen, die bestätigten
// Zeilen ausdrücklich. Verknüpfen fragt nach, wenn eine erneut ausgewertete Zeile an eine schon aus
// demselben Beleg gebuchte Position soll, denn das addiert ihren Betrag (Integrationsdurchsicht, H1).
export function withConfirmed(decisions: readonly LineDecision[], idxs: readonly number[]): LineDecision[] {
  return decisions.map((d) => ((d.action === 'create' || d.action === 'link') && idxs.includes(d.idx) ? { ...d, despiteCandidates: true } : d))
}

// Die Beschriftung des Knopfs der Rückfrage, nach dem, was bestätigt wird.
export function confirmLabel(decisions: readonly LineDecision[], idxs: readonly number[]): string {
  const kinds = new Set(decisions.filter((d) => idxs.includes(d.idx)).map((d) => d.action))
  if (kinds.size === 1 && kinds.has('link')) return 'Trotzdem verknüpfen'
  if (kinds.has('link')) return 'Trotzdem buchen'
  return 'Trotzdem anlegen'
}

// Grün im Sinne von „Alle grünen übernehmen“: offen, vom Server grün bewertet und vorab angehakt.
// Die Zählung der Schnellerfassung und die Übernahme nehmen beide diese Bedingung, damit nie mehr
// angezeigt wird, als gebucht würde.
export const isGreen = (l: AssessmentLine): boolean =>
  l.state === 'open' && !!l.suggestion?.preselected && l.suggestion.level === 'gruen'

// „Alle grünen übernehmen“: die grünen Zeilen mit dem Vorschlag des Servers. Eingaben, die noch in
// einer Tabelle stehen, gelten dabei nicht; wer etwas geändert hat, bucht diese Zeile mit
// „Vorschau“ und „Buchen“.
export function greenDecisions(view: AssessmentView): LineDecision[] {
  return view.lines.flatMap((l): LineDecision[] => (isGreen(l) && l.suggestion ? [{ idx: l.idx, action: 'create', fields: l.suggestion.fields }] : []))
}

// Die Kostenarten zur Wahl, samt der gespeicherten, auch wenn es sie in der Liste nicht (mehr)
// gibt (Altbestand aus dem Vorjahr): Sonst zeigte das Auswahlfeld den ersten Eintrag, und gebucht
// würde etwas anderes als das Sichtbare (wie costKeyOptions und meterTypeOptions).
export function categoryOptions(stored: string): string[] {
  return CATEGORIES.includes(stored) ? [...CATEGORIES] : [...CATEGORIES, stored]
}

const laborText = (c: number | null): string => (c === null ? 'keiner' : fmtEuro(c))

// Die Vorschau in Sätzen, je Position eine Zeile. Eine neue Position nennt ihr Jahr: Es ist das
// Jahr aus dem Beleg und kann vom gewählten abweichen (Schlussdurchsicht, I1); nach dem Buchen
// stünde sie sonst nicht in der Liste, die man gerade ansieht, und niemand wüsste, wo sie ist.
export function previewLines(p: BookingPreview): string[] {
  return p.items.map((i) => {
    if (i.costItemId === null) {
      return `Neu für ${i.year}: „${i.description}“ (${i.category}) ${fmtEuro(i.afterCents)}${i.afterLabor35aCents ? `, davon §35a-Lohn ${fmtEuro(i.afterLabor35aCents)}` : ''}`
    }
    const labor = i.beforeLabor35aCents !== i.afterLabor35aCents ? `; §35a-Lohn ${laborText(i.beforeLabor35aCents)} → ${laborText(i.afterLabor35aCents)}` : ''
    if (i.beforeCents === i.afterCents) return `„${i.description}“ bleibt bei ${fmtEuro(i.afterCents)}${labor}`
    return `„${i.description}“: ${fmtEuro(i.beforeCents ?? 0)} → ${fmtEuro(i.afterCents)}${labor}`
  })
}

// Was nach dem Buchen als erledigt dasteht: die Sätze der Vorschau und ihre Hinweise. Eine Buchung,
// die nur verwirft, hat keine Position, aber einen Hinweis je verworfener Zeile; ohne ihn stünde
// dort ein leeres „✓ Gebucht:“ (Schlussdurchsicht, I2).
export const bookedLines = (p: BookingPreview): string[] => [...previewLines(p), ...p.notices]

// Die Gestalt der Zeilen einer Auswertung: Nummer und Zustand je Zeile. Ändert sie sich, gelten
// Eingaben, Vorschau und Erfolgsmeldung einer Karte nicht mehr.
export const linesShape = (v: AssessmentView): string => v.lines.map((l) => `${l.idx}:${l.state}`).join('|')

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

// Sichtprüfung E30: Die Kennzeichnung offener Zeilen trägt die Farbe der schlechtesten Ampel, nicht Grün für „bitte
// prüfen“; im Eingang wie auf der Seite Kosten (#490, dort vorher immer gelb).
export function openBadgeClass(v: Pick<AssessmentView, 'lines'>): 'badge red' | 'badge amber' | 'badge green' {
  const levels = v.lines.filter((l) => l.state === 'open').map((l) => l.suggestion?.level)
  return levels.includes('rot') ? 'badge red' : levels.includes('gelb') ? 'badge amber' : 'badge green'
}

// ---------- Alle Zeilen als eine Position (Durchsicht der Systemprüfung) ----------
//
// Eine Rechnung mit vielen Zeilen einer Kostenart (Energie, Wasser) soll eine Kostenposition werden. Der Planer legt in
// einem Schritt keine Position an und verknüpft zugleich mit ihr; gebucht wird deshalb zweimal nacheinander, beide Male
// über Vorschau und Marke des Servers: erst die erste Zeile anlegen, dann die übrigen mit ihrer Position verknüpfen
// (`sameReceipt`). Es gelten die Angaben des Servers; Eingaben, die noch in der Tabelle stehen, gelten dabei nicht (wie
// bei „Alle grünen übernehmen“).

export type CombineDraft = { category: string; description: string }

// Die Zeilen, die zusammen eine Position werden können: offen, mit gelesenem Betrag über 0. Gutschriften werden nie
// verrechnet und bleiben offen. Angeboten wird die Aktion erst ab zwei solchen Zeilen und nur mit Objekt.
export function combinableLines(v: Pick<AssessmentView, 'lines' | 'propertyId'>): AssessmentLine[] {
  if (v.propertyId === null) return []
  const lines = v.lines.filter((l) => l.state === 'open' && l.suggestion !== null && l.amountCents !== null && l.amountCents > 0)
  return lines.length >= 2 ? lines : []
}

// Womit das Fenster beginnt: die Kostenart nur, wenn alle Zeilen dieselbe tragen (sonst wählt der Nutzer), die
// Beschreibung aus Rechnungssteller und Rechnungsnummer, ohne Steller der Name des Belegs.
export function combineStart(v: Pick<AssessmentView, 'lines' | 'propertyId' | 'vendor' | 'invoiceNumber' | 'originalName'>): CombineDraft {
  const categories = new Set(combinableLines(v).map((l) => l.suggestion?.fields.category ?? l.category))
  const [only] = categories
  const vendor = (v.vendor ?? '').trim()
  const description = vendor === '' ? v.originalName : v.invoiceNumber ? `${vendor}, Rechnung ${v.invoiceNumber}` : vendor
  return { category: categories.size === 1 && only !== undefined ? only : '', description }
}

// Was entsteht, vor dem Buchen: eine Position mit der Summe der Zeilen, und was offen bleibt.
export function combineSummary(v: Pick<AssessmentView, 'lines' | 'propertyId'>, draft: CombineDraft): string {
  const lines = combinableLines(v)
  const sum = lines.reduce((t, l) => t + (l.amountCents ?? 0), 0)
  const left = v.lines.filter((l) => l.state === 'open' && !lines.includes(l)).length
  const rest = left === 0 ? '' : left === 1 ? ' 1 Zeile bleibt offen (Gutschrift oder Zeile ohne Betrag).' : ` ${left} Zeilen bleiben offen (Gutschriften und Zeilen ohne Betrag).`
  return `Es entsteht eine Position „${draft.description.trim()}“${draft.category ? ` (${draft.category})` : ''} über ${fmtEuro(sum)} aus ${lines.length} Zeilen.${rest}`
}

// Schritt 1: die erste Zeile als die neue Position, mit Kostenart und Beschreibung des Fensters und dem Schlüssel dazu.
export function combineFirst(v: Pick<AssessmentView, 'lines' | 'propertyId'>, draft: CombineDraft, key: Pick<LineFields, 'key' | 'allocation'>): LineDecision[] {
  const first = combinableLines(v)[0]
  if (!first?.suggestion) return []
  return [{ idx: first.idx, action: 'create', fields: { ...first.suggestion.fields, category: draft.category, description: draft.description.trim(), key: key.key, allocation: key.allocation, externalTotalCents: null } }]
}

// Schritt 2: die übrigen Zeilen an die eben angelegte Position.
export function combineRest(v: Pick<AssessmentView, 'lines' | 'propertyId'>, costItemId: string): LineDecision[] {
  return combinableLines(v).slice(1).map((l) => ({ idx: l.idx, action: 'link', costItemId }))
}

export type CombineResult =
  | { kind: 'done'; assessment: AssessmentView; lines: string[] }
  | { kind: 'cancelled' }
  // Nichts ist gebucht: die Meldung steht im Fenster.
  | { kind: 'refused'; message: string }
  // Die Position ist angelegt, die übrigen Zeilen sind noch offen.
  | { kind: 'partial'; message: string; assessment: AssessmentView }

const planProblems = (p: BookingPreview): string => p.errors.map((e) => e.message).join(' ')

// Bucht beide Schritte. `ask` stellt die Rückfrage des Planers (schon eine Position dieser Art erfasst?), bevor etwas
// gebucht ist. Scheitert der zweite Schritt, bleibt die angelegte Position stehen, und die Meldung sagt, wie es weitergeht.
export async function bookAsOne(
  v: AssessmentView, draft: CombineDraft, key: Pick<LineFields, 'key' | 'allocation'>, ask: (messages: string[]) => Promise<boolean>,
): Promise<CombineResult> {
  let first = combineFirst(v, draft, key)
  const [create] = first
  if (!create) return { kind: 'refused', message: 'Es gibt keine zwei offenen Zeilen mit Betrag mehr. Bitte schließen Sie das Fenster.' }
  const plan = await planDecisions(v.id, first)
  if (plan.errors.length > 0) return { kind: 'refused', message: planProblems(plan) }
  if (plan.confirm.length > 0) {
    if (!await ask(plan.confirm.map((c) => c.message))) return { kind: 'cancelled' }
    first = withConfirmed(first, [create.idx])
  }
  const created = await bookDecisions(v.id, first, plan.token)
  if (created.kind === 'conflict') return { kind: 'partial', message: created.message, assessment: created.assessment }
  if (created.kind !== 'done') return { kind: 'refused', message: [created.message, planProblems(created.preview)].filter(Boolean).join(' ') }
  const itemId = created.assessment.lines.find((l) => l.idx === create.idx)?.costItemId
  const next = `Die Position „${draft.description.trim()}“ ist mit der ersten Zeile angelegt; die übrigen Zeilen sind noch offen. Verknüpfen Sie sie unter „Was geschieht?“ mit dieser Position.`
  if (!itemId) return { kind: 'partial', message: next, assessment: created.assessment }
  try {
    const rest = combineRest(v, itemId)
    const linkPlan = await planDecisions(v.id, rest)
    if (linkPlan.errors.length > 0 || linkPlan.confirm.length > 0) {
      return { kind: 'partial', message: [planProblems(linkPlan), ...linkPlan.confirm.map((c) => c.message), next].filter(Boolean).join(' '), assessment: created.assessment }
    }
    const linked = await bookDecisions(v.id, rest, linkPlan.token)
    if (linked.kind === 'done') return { kind: 'done', assessment: linked.assessment, lines: bookedLines(linked.preview) }
    return { kind: 'partial', message: `${linked.message} ${next}`, assessment: linked.kind === 'conflict' ? linked.assessment : created.assessment }
  } catch (e) {
    return { kind: 'partial', message: `${e instanceof Error ? e.message : String(e)} ${next}`, assessment: created.assessment }
  }
}

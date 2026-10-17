// Die gespeicherten Auswertungen in der Datenbank (Belegbuchung, #170), Tabellen `assessments`
// und `assessment_lines` in schema.ts. Hier steht nur der Zugriff; was eine Buchung bedeutet,
// steht in bookingPlan.ts, und db/booking.ts verbindet beides.
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import type { PeriodKey, StoredAssessment, StoredAssessmentLine, UploadLinks } from '../../../shared/types.ts'
import { withoutBooked, type BookedLine, type LineChange, type NewLine } from '../assessment.ts'
import type { Database, Executor } from './client.ts'
import { assessmentLines, assessments } from './schema.ts'
import { parsePeriodKey, periodOfKey, rulesOf } from '../../../shared/period.ts'
import { periodForYear } from '../../../shared/assessment.ts'
import { readProperties } from './read.ts'

export type AssessmentRecord = { assessment: StoredAssessment; lines: StoredAssessmentLine[] }
// Der gewählte Zeitraum entsteht hier aus dem gewählten Jahr und dem Objekt. Der Aufrufer darf einen
// Zeitraum mitschicken (die Seite, von der aus ausgewertet wurde, #208); er gilt nur, wenn es ihn für
// das Objekt gibt.
export type NewAssessment = Omit<StoredAssessment, 'id' | 'createdAt' | 'nextIdx' | 'requestedPeriod'> & { lines: NewLine[]; requestedPeriod?: PeriodKey | null }

// Der gewählte Zeitraum (#208): aus dem gewählten Kalenderjahr nach den Regeln des Objekts
// (`periodForYear`, beim Kalenderobjekt der Kalenderzeitraum), sobald es ein Objekt gibt (G-B7).
// Ohne Objekt keiner; das Jahr bleibt dann stehen und ergibt beim Zuordnen den Zeitraum
// (Durchsicht von #222, I1). Ein fester 'JJJJ-01' wäre bei einem anderen Rhythmus ein verwaister
// Schlüssel, und jedes spätere Backup lehnte das Wiederherstellen ab (Nachprüfung von #222).
// `sent`: ein mitgeschickter Zeitraum, nur wenn es ihn für das Objekt gibt.
async function requestedPeriodOf(db: Database, propertyId: string | null, requestedYear: number | null, sent: unknown = null): Promise<PeriodKey | null> {
  if (propertyId === null) return null
  const rules = rulesOf((await readProperties(db)).find((p) => p.id === propertyId))
  const key = parsePeriodKey(sent)
  if (key !== null && periodOfKey(rules, key) !== null) return key
  return requestedYear === null ? null : periodForYear(rules, requestedYear).key
}

async function linesOf(db: Executor, assessmentId: string): Promise<StoredAssessmentLine[]> {
  return db.select().from(assessmentLines).where(eq(assessmentLines.assessmentId, assessmentId)).orderBy(asc(assessmentLines.idx))
}

export async function readAssessment(db: Executor, id: string): Promise<AssessmentRecord | null> {
  const [assessment] = await db.select().from(assessments).where(eq(assessments.id, id))
  return assessment ? { assessment, lines: await linesOf(db, assessment.id) } : null
}

export async function readAssessmentOfFile(db: Executor, file: string): Promise<AssessmentRecord | null> {
  const [assessment] = await db.select().from(assessments).where(eq(assessments.file, file))
  return assessment ? { assessment, lines: await linesOf(db, assessment.id) } : null
}

// Die Auswertungen eines Objekts, älteste zuerst.
export async function listAssessments(db: Executor, propertyId: string): Promise<AssessmentRecord[]> {
  const rows = await db.select().from(assessments).where(eq(assessments.propertyId, propertyId)).orderBy(asc(assessments.createdAt), asc(sql`rowid`))
  const out: AssessmentRecord[] = []
  for (const assessment of rows) out.push({ assessment, lines: await linesOf(db, assessment.id) })
  return out
}

async function insertLines(db: Executor, assessmentId: string, lines: readonly NewLine[], start: number, reassessed: boolean): Promise<void> {
  if (lines.length === 0) return
  await db.insert(assessmentLines).values(lines.map((l, i) => ({
    ...l, assessmentId, idx: start + i, booking: null, costItemId: null, dismissed: false, reassessed,
  })))
}

// Speichert eine Auswertung, und zwar **nur nach Erfolg** der KI (die Route ruft es erst dann).
// Gibt es zu dem Beleg schon eine, ersetzt die neue nur die offenen und verworfenen Zeilen.
// Gebuchte bleiben mit ihren Nummern; neue Zeilen bekommen Nummern, die es in dieser Auswertung
// noch nie gab, damit eine offene Vorschau in einem anderen Tab nicht still eine andere Zeile
// meint. Objekt und Jahr folgen der neuen Auswertung nur, solange nichts gebucht ist.
export async function saveAssessment(db: Database, input: NewAssessment, ids: { id: string; now: string }): Promise<AssessmentRecord> {
  const { lines, requestedPeriod: sent, ...fields } = input
  const head = { ...fields, requestedPeriod: await requestedPeriodOf(db, fields.propertyId, fields.requestedYear, sent) }
  const current = await readAssessmentOfFile(db, input.file)
  await db.transaction(async (tx) => {
    if (!current) {
      await tx.insert(assessments).values({ ...head, id: ids.id, createdAt: ids.now, nextIdx: lines.length })
      await insertLines(tx, ids.id, lines, 0, false)
      return
    }
    const id = current.assessment.id
    const booked = current.lines.filter((l) => l.costItemId !== null)
    // Ab der Hochwassermarke, nicht ab dem höchsten vorhandenen: Eine ersetzte Zeile hinterließe sonst
    // ihre Nummer wieder frei.
    const next = Math.max(current.assessment.nextIdx, current.lines.reduce((max, l) => Math.max(max, l.idx + 1), 0))
    await tx.delete(assessmentLines).where(and(eq(assessmentLines.assessmentId, id), isNull(assessmentLines.costItemId)))
    // `withoutBooked` erkennt nur Zeilen, die einer gebuchten gleichen. Eine von Hand berichtigte
    // oder von der KI anders aufgeteilte käme sonst als neue, grüne Zeile wieder; deshalb sind die
    // Zeilen einer erneuten Auswertung neben gebuchten gekennzeichnet (Integrationsdurchsicht, H1).
    const added = withoutBooked(lines, booked)
    await insertLines(tx, id, added, next, booked.length > 0)
    const placement = booked.length > 0 ? {} : { propertyId: head.propertyId, year: head.year, requestedYear: head.requestedYear, requestedPeriod: head.requestedPeriod }
    await tx.update(assessments).set({
      detectedYear: head.detectedYear, vendor: head.vendor, invoiceDate: head.invoiceDate, totalGrossCents: head.totalGrossCents,
      amountsAdjusted: head.amountsAdjusted, laborFromTotal: head.laborFromTotal, createdAt: ids.now, nextIdx: next + added.length, ...placement,
    }).where(eq(assessments.id, id))
  })
  const saved = await readAssessmentOfFile(db, input.file)
  if (!saved) throw new Error('Die Auswertung ist nach dem Speichern nicht auffindbar.')
  return saved
}

export async function writeLine(db: Executor, assessmentId: string, idx: number, change: LineChange): Promise<void> {
  await db.update(assessmentLines).set(change).where(and(eq(assessmentLines.assessmentId, assessmentId), eq(assessmentLines.idx, idx)))
}

// Alle gebuchten Zeilen aller Auswertungen, mit ihrem Beleg. Die Summenregel rechnet über alle
// Belege, die an einer Position hängen.
export async function bookedLines(db: Executor): Promise<BookedLine[]> {
  const rows = await db.select({ line: assessmentLines, file: assessments.file })
    .from(assessmentLines)
    .innerJoin(assessments, eq(assessments.id, assessmentLines.assessmentId))
    .where(isNotNull(assessmentLines.costItemId))
    .orderBy(asc(assessments.createdAt), asc(assessmentLines.idx))
  return rows.map((r) => ({ ...r.line, file: r.file }))
}

export async function forgetAssessment(db: Executor, file: string): Promise<void> {
  await db.delete(assessments).where(eq(assessments.file, file))
}

// Objekt und Jahr ändern, beides nur, solange keine Zeile gebucht ist: Sonst hingen Zeilen einer
// Auswertung an Positionen zweier Objekte oder eines anderen Jahres, und ein weiteres Verknüpfen
// mit derselben Position scheiterte an der Jahresprüfung des Planers. Ein von Hand gesetztes Jahr
// ist zugleich das gewählte: Wer es ausdrücklich setzt, hat über die Abweichung entschieden.
export async function placeAssessment(db: Database, id: string, change: { year?: number; propertyId?: string | null }): Promise<'ok' | 'missing' | 'booked'> {
  const current = await readAssessment(db, id)
  if (!current) return 'missing'
  const moves = (change.propertyId !== undefined && change.propertyId !== current.assessment.propertyId) ||
    (change.year !== undefined && change.year !== current.assessment.year)
  if (moves && current.lines.some((l) => l.costItemId !== null)) return 'booked'
  if (change.year === undefined && change.propertyId === undefined) return 'ok'
  const propertyId = change.propertyId !== undefined ? change.propertyId : current.assessment.propertyId
  // Ein von Hand gesetztes Jahr ist zugleich das gewählte, mit oder ohne Objekt. Der gewählte
  // Zeitraum folgt aus Jahr und Objekt (#208).
  const requestedYear = change.year !== undefined ? change.year : current.assessment.requestedYear
  await db.update(assessments).set({ ...change, requestedYear, requestedPeriod: await requestedPeriodOf(db, propertyId, requestedYear) }).where(eq(assessments.id, id))
  return 'ok'
}

// Je Beleg mit Auswertung: die Positionen, an denen gebuchte Zeilen hängen, und ob noch eine Zeile
// offen ist. Belege ohne Auswertung fehlen in der Liste; für sie gilt weiter `invoice_file`.
export async function uploadLinks(db: Executor): Promise<Map<string, UploadLinks>> {
  const all = await db.select().from(assessments)
  const lines = await db.select().from(assessmentLines)
  const links = new Map<string, UploadLinks>()
  for (const a of all) {
    const own = lines.filter((l) => l.assessmentId === a.id)
    const bookedCents: Record<string, number> = {}
    for (const l of own) if (l.costItemId) bookedCents[l.costItemId] = (bookedCents[l.costItemId] ?? 0) + (l.amountCents ?? 0)
    links.set(a.file, {
      bookedItemIds: Object.keys(bookedCents),
      bookedCents,
      assessment: { id: a.id, propertyId: a.propertyId, open: own.some((l) => l.costItemId === null && !l.dismissed) },
    })
  }
  return links
}

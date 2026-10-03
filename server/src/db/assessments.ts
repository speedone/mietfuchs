// Die gespeicherten Auswertungen in der Datenbank (Belegbuchung, #170), Tabellen `assessments`
// und `assessment_lines` in schema.ts. Hier steht nur der Zugriff; was eine Buchung bedeutet,
// steht in bookingPlan.ts, und db/booking.ts verbindet beides.
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import type { StoredAssessment, StoredAssessmentLine } from '../../../shared/types.ts'
import { withoutBooked, type BookedLine, type LineChange, type NewLine } from '../assessment.ts'
import type { Database, Executor } from './client.ts'
import { assessmentLines, assessments } from './schema.ts'

export type AssessmentRecord = { assessment: StoredAssessment; lines: StoredAssessmentLine[] }
export type NewAssessment = Omit<StoredAssessment, 'id' | 'createdAt'> & { lines: NewLine[] }

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

async function insertLines(db: Executor, assessmentId: string, lines: readonly NewLine[], start: number): Promise<void> {
  if (lines.length === 0) return
  await db.insert(assessmentLines).values(lines.map((l, i) => ({
    ...l, assessmentId, idx: start + i, booking: null, costItemId: null, dismissed: false,
  })))
}

// Speichert eine Auswertung, und zwar **nur nach Erfolg** der KI (die Route ruft es erst dann).
// Gibt es zu dem Beleg schon eine, ersetzt die neue nur die offenen und verworfenen Zeilen.
// Gebuchte bleiben mit ihren Nummern; neue Zeilen bekommen Nummern, die es in dieser Auswertung
// noch nie gab, damit eine offene Vorschau in einem anderen Tab nicht still eine andere Zeile
// meint. Objekt und Jahr folgen der neuen Auswertung nur, solange nichts gebucht ist.
export async function saveAssessment(db: Database, input: NewAssessment, ids: { id: string; now: string }): Promise<AssessmentRecord> {
  const { lines, ...head } = input
  const current = await readAssessmentOfFile(db, input.file)
  await db.transaction(async (tx) => {
    if (!current) {
      await tx.insert(assessments).values({ ...head, id: ids.id, createdAt: ids.now })
      await insertLines(tx, ids.id, lines, 0)
      return
    }
    const id = current.assessment.id
    const booked = current.lines.filter((l) => l.costItemId !== null)
    const next = current.lines.reduce((max, l) => Math.max(max, l.idx + 1), 0)
    await tx.delete(assessmentLines).where(and(eq(assessmentLines.assessmentId, id), isNull(assessmentLines.costItemId)))
    await insertLines(tx, id, withoutBooked(lines, booked), next)
    const placement = booked.length > 0 ? {} : { propertyId: head.propertyId, year: head.year }
    await tx.update(assessments).set({
      detectedYear: head.detectedYear, vendor: head.vendor, invoiceDate: head.invoiceDate, totalGrossCents: head.totalGrossCents,
      amountsAdjusted: head.amountsAdjusted, laborFromTotal: head.laborFromTotal, createdAt: ids.now, ...placement,
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

// Objekt und Jahr ändern. Das Objekt nur, solange keine Zeile gebucht ist: Sonst hingen Zeilen
// einer Auswertung an Positionen zweier Objekte.
export async function placeAssessment(db: Database, id: string, change: { year?: number; propertyId?: string | null }): Promise<'ok' | 'missing' | 'booked'> {
  const current = await readAssessment(db, id)
  if (!current) return 'missing'
  const moves = change.propertyId !== undefined && change.propertyId !== current.assessment.propertyId
  if (moves && current.lines.some((l) => l.costItemId !== null)) return 'booked'
  if (change.year === undefined && change.propertyId === undefined) return 'ok'
  await db.update(assessments).set(change).where(eq(assessments.id, id))
  return 'ok'
}

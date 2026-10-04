// Vorschau und Buchung einer Auswertung über die Datenbank (Belegbuchung, #170). Das Fachliche
// steht in bookingPlan.ts; hier wird gelesen, was der Planer braucht, und seine Schreibliste in
// **einer** Transaktion ausgeführt.
//
// Die Route ruft `bookAssessment` durch die Schreibschlange (`opened.write`). Lesen, Planen und
// Schreiben geschehen damit, ohne dass eine andere Anfrage dazwischenkommt; zwei gleichzeitige
// Buchungen derselben Zeile sehen nacheinander den Stand der anderen. Die zweite ist dann ohne
// Änderung oder ein Widerspruch.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { AssessmentView, BookingPreview, CostItem, LineDecision } from '../../../shared/types.ts'
import { describeAssessment, openTargets, type BookedLine, type OpenTarget } from '../assessment.ts'
import { planBooking, previewWith, settle, tokenSource, type BookingOutcome, type Planned } from '../bookingPlan.ts'
import { narrowToProperty } from '../snapshot.ts'
import type { Database } from './client.ts'
import { bookedLines, listAssessments, readAssessment, writeLine, type AssessmentRecord } from './assessments.ts'
import { readStock, type Stock } from './read.ts'
import { insertCostItemIn, patchCostItemIn } from './repository.ts'
import { uploadRows, type UploadRow } from './uploads.ts'

// Eine Ablehnung mit einer Meldung für den Nutzer; die Fehlerbehandlung in index.ts gibt sie
// unverändert weiter.
export class BookingRefusal extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const NOT_FOUND = 'Diese Auswertung gibt es nicht (mehr). Bitte laden Sie die Seite neu.'
const fileGone = (name: string): string =>
  `Den Beleg „${name}“ gibt es im Belegordner nicht mehr. Die Auswertung lässt sich deshalb nicht buchen; laden Sie den Beleg bitte erneut hoch.`

type Context = { stock: Stock; booked: BookedLine[]; uploads: Map<string, UploadRow> }

async function contextOf(db: Database): Promise<Context> {
  return { stock: await readStock(db), booked: await bookedLines(db), uploads: await uploadRows(db) }
}

const exists = (uploadDir: string, file: string): boolean => {
  const full = path.join(uploadDir, path.basename(file))
  return fs.existsSync(full) && fs.statSync(full).isFile()
}
const nameOf = (ctx: Context, file: string): string => ctx.uploads.get(file)?.originalName || file

// Andere Belege mit demselben Inhalt. Eine leere Prüfsumme (noch nicht nachgetragen) trifft nichts.
function twinFilesOf(ctx: Context, file: string): string[] {
  const sha = ctx.uploads.get(file)?.sha256
  if (!sha) return []
  return [...ctx.uploads.values()].filter((u) => u.file !== file && u.sha256 === sha).map((u) => u.file)
}

const scopeOf = (ctx: Context, propertyId: string | null) => (propertyId ? narrowToProperty(ctx.stock, propertyId) : null)

const twinNamesOf = (ctx: Context, file: string): Map<string, string> => new Map(twinFilesOf(ctx, file).map((f) => [f, nameOf(ctx, f)]))

// Die offenen Zeilen der Auswertungen eines Objekts mit eindeutigem Ziel (#170): Kommt eine
// Rechnung in zwei Belegen, ersetzen ihre Zeilen gemeinsam dieselbe Schätzung, und die Ampel rechnet
// sie zusammen (`peerTargets` in assessment.ts). **Einmal je Auswertung berechnet** und für alle
// Ansichten derselben Liste wiederverwendet (Durchsicht): Je Ansicht neu gerechnet wüchse die Liste
// quadratisch, und das in der Leseschlange.
type Peer = { id: string, file: string, targets: OpenTarget[] }

function peersFrom(records: readonly AssessmentRecord[], ctx: Context): Peer[] {
  return records.flatMap((r) => {
    const scoped = scopeOf(ctx, r.assessment.propertyId)
    if (!scoped) return []
    return [{ id: r.assessment.id, file: r.assessment.file, targets: openTargets(r, { items: scoped.costItems, booked: ctx.booked, twinNames: twinNamesOf(ctx, r.assessment.file) }) }]
  })
}

// Was davon für eine Auswertung zählt: nicht ihre eigenen Zeilen und nicht die eines Belegs mit
// gleichem Inhalt (Durchsicht). Derselbe Beleg zweimal hochgeladen ist keine zweite Rechnung, das
// zweite Verknüpfen lehnt der Planer ab; zusammengezählt zeigte die Ampel die doppelte Summe.
function peerTargetsFor(record: AssessmentRecord, peers: readonly Peer[], ctx: Context): OpenTarget[] {
  const twins = new Set(twinFilesOf(ctx, record.assessment.file))
  return peers.filter((p) => p.id !== record.assessment.id && !twins.has(p.file)).flatMap((p) => p.targets)
}

// Die Auswertungen des Objekts, deren Beleg noch im Belegordner liegt, wie in `viewAssessments`.
async function peersOf(db: Database, record: AssessmentRecord, uploadDir: string, ctx: Context): Promise<Peer[]> {
  const propertyId = record.assessment.propertyId
  if (!propertyId) return []
  const records = (await listAssessments(db, propertyId)).filter((r) => r.assessment.id !== record.assessment.id && exists(uploadDir, r.assessment.file))
  return peersFrom(records, ctx)
}

function viewOf(record: AssessmentRecord, ctx: Context, peers: readonly Peer[]): AssessmentView {
  const a = record.assessment
  const scoped = scopeOf(ctx, a.propertyId)
  const twins = twinFilesOf(ctx, a.file)
  const twin = ctx.booked.find((l) => twins.includes(l.file))
  return describeAssessment(record, {
    items: scoped?.costItems ?? [],
    units: scoped?.units ?? [],
    meters: scoped?.meters ?? [],
    propertyKind: ctx.stock.properties.find((p) => p.id === a.propertyId)?.kind ?? null,
    originalName: nameOf(ctx, a.file),
    twinOf: twin ? nameOf(ctx, twin.file) : null,
    twinNames: new Map(twins.map((f) => [f, nameOf(ctx, f)])),
    booked: ctx.booked,
    peerTargets: peerTargetsFor(record, peers, ctx),
  })
}

// Die Auswertungen eines Objekts, ohne die, deren Datei nicht mehr im Belegordner liegt.
export async function viewAssessments(db: Database, propertyId: string, openOnly: boolean, uploadDir: string): Promise<AssessmentView[]> {
  const ctx = await contextOf(db)
  const records = (await listAssessments(db, propertyId)).filter((r) => exists(uploadDir, r.assessment.file))
  const peers = peersFrom(records, ctx)
  return records
    .map((r) => viewOf(r, ctx, peers))
    .filter((v) => !openOnly || v.open)
}

export async function viewAssessment(db: Database, id: string, uploadDir: string): Promise<AssessmentView> {
  const record = await readAssessment(db, id)
  if (!record) throw new BookingRefusal(404, NOT_FOUND)
  const ctx = await contextOf(db)
  if (!exists(uploadDir, record.assessment.file)) throw new BookingRefusal(404, fileGone(nameOf(ctx, record.assessment.file)))
  return viewOf(record, ctx, await peersOf(db, record, uploadDir, ctx))
}

export async function viewRecord(db: Database, record: AssessmentRecord, uploadDir: string): Promise<AssessmentView> {
  const ctx = await contextOf(db)
  return viewOf(record, ctx, await peersOf(db, record, uploadDir, ctx))
}

async function plannedFor(db: Database, id: string, decisions: readonly LineDecision[], uploadDir: string, newId: () => string) {
  const record = await readAssessment(db, id)
  if (!record) throw new BookingRefusal(404, NOT_FOUND)
  const ctx = await contextOf(db)
  if (!exists(uploadDir, record.assessment.file)) throw new BookingRefusal(404, fileGone(nameOf(ctx, record.assessment.file)))
  const scoped = scopeOf(ctx, record.assessment.propertyId)
  const twinFiles = twinFilesOf(ctx, record.assessment.file)
  const planned = planBooking({
    assessment: record.assessment, lines: record.lines, items: ctx.stock.costItems, booked: ctx.booked,
    units: scoped?.units ?? [], twinFiles,
    fileNames: new Map([...ctx.booked.map((l) => l.file), ...twinFiles].map((f) => [f, nameOf(ctx, f)])),
    closed: ctx.stock.closedSettlements,
  }, decisions, newId)
  return { record, ctx, planned }
}

const tokenOf = (p: Planned): string => crypto.createHash('sha256').update(tokenSource(p)).digest('hex')

export async function previewBooking(db: Database, id: string, decisions: readonly LineDecision[], uploadDir: string): Promise<BookingPreview> {
  // Die Kennungen neuer Positionen gehen nicht in die Marke ein; hier entsteht keine.
  const { planned } = await plannedFor(db, id, decisions, uploadDir, () => 'vorschau')
  return previewWith(planned, tokenOf(planned))
}

export type { BookingOutcome } from '../bookingPlan.ts'

export async function bookAssessment(
  db: Database, id: string, decisions: readonly LineDecision[], token: string, options: { uploadDir: string; newId: () => string },
): Promise<BookingOutcome> {
  const { record, ctx, planned } = await plannedFor(db, id, decisions, options.uploadDir, options.newId)
  const preview = previewWith(planned, tokenOf(planned))
  const settled = settle(planned, decisions.length, token, preview)
  if (settled) return settled
  // `Stock` schneidet zwei Listentypen; benannt, damit `map` die vollständigen Positionen sieht.
  const stockItems: readonly CostItem[] = ctx.stock.costItems
  const items = new Map(stockItems.map((i) => [i.id, i]))
  await db.transaction(async (tx) => {
    for (const w of planned.writes) {
      if (w.kind === 'createItem') {
        await insertCostItemIn(tx, w.id, w.body)
      } else if (w.kind === 'updateItem') {
        const current = items.get(w.id)
        if (!current) throw new BookingRefusal(409, 'Eine Position ist während der Buchung verschwunden. Bitte laden Sie die Seite neu.')
        await patchCostItemIn(tx, current, w.patch)
      } else {
        await writeLine(tx, record.assessment.id, w.idx, w.change)
      }
    }
  })
  return { kind: 'done', changed: true, preview }
}

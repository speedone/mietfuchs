// Rücksprung im Verlauf (#318, Schritt 4): „Zu diesem Stand zurückkehren“.
//
// Zurückgenommen wird immer ein **Ende** des Journals: ein Eintrag und alles danach (Stand vor dem Eintrag) oder nur
// alles danach (Stand nach dem Eintrag), streng rückwärts, neueste Zeile zuerst, in einer Transaktion durch die
// Schreibschlange. „Rückgängig“ am obersten Eintrag ist derselbe Weg mit genau einem Eintrag.
//
// **Warum kein selektives Rückgängig**: Ein Rücksprung kehrt in einen Zustand zurück, der nachweislich gültig war (er
// bestand, und jede Schreibprüfung hatte ihn zugelassen). Einen einzelnen Eintrag mitten aus dem Verlauf
// herauszunehmen bräuchte eine Regel, welche späteren Änderungen von ihm abhängen; jeder Fehler darin ergäbe einen
// Bestand, den es nie gab und den keine Prüfung gesehen hat, in einem Programm, das Geld verteilt.
//
// **Wie**: Für jede Zeile des Journals ab der ersten zurückzunehmenden Gruppe, von der neuesten zur ältesten, das
// Gegenstück: ein Einfügen wird gelöscht, ein Löschen mit seinem Vorher-Bild samt `rowid` wieder eingefügt, eine
// Änderung bekommt ihr Vorher-Bild. Die Fremdschlüssel werden bis zum Ende der Transaktion aufgeschoben
// (`defer_foreign_keys`): Eine Kaskade erfasst Eltern und Kinder in einer Reihenfolge, die SQLite bestimmt, und
// rückwärts eingefügt kämen Kinder sonst vor ihre Eltern. Am Ende prüfen `PRAGMA foreign_key_check` und die Prüfungen
// des Wiederherstellens den ganzen Bestand (das Sicherheitsnetz; durch die Bauart greift es nicht, die Invariante in
// invariant-ruecksprung.test.ts bestätigt das).
//
// **Grenzen** (jede mit Satz in der Vorschau):
// - Abschluss und Wiederöffnen (`FROZEN_TABLES`): Liegt im Bereich eine Gruppe, die eine dieser Tabellen ändert, wird
//   abgelehnt. So verschwindet nie still ein zugestellter, eingefrorener Stand, und es entsteht keiner, den niemand
//   abgeschlossen hat. Über „Wieder öffnen“ (mit Verlauf der Abschlüsse) geht es bewusst; danach ist der Rücksprung bis
//   nach dem Wiederöffnen möglich, nicht darüber hinweg.
// - Gruppen von vor der letzten Migration (`schema_steps`): nur lesbar.
// - Schranken (`barrier`: Backup, Vorversion, Umstieg): Der Stand davor steht nicht in dieser Datei.
// - Dateien: Ein Beleg oder ein Logo, das der Stand wieder nennt, kommt aus dem Papierkorb zurück; fehlt es dort,
//   wird abgelehnt.
//
// Die Vorschau trägt `kind: 'journal'`: Ein späterer Weg (Einspielen einer Sicherung als Sicherungspunkt der
// Zeitachse) bekommt eine eigene Art mit derselben Gestalt von Vorschau und Marke.

import { createHash } from 'node:crypto'
import { gte, inArray, sql } from 'drizzle-orm'
import type { Database, Executor } from './client.ts'
import { changeGroups, changeLog } from './schema.ts'
import { collapse, currentGroupId, groupTitle, latestBarrierId, Resolver, ROWID, type JournalSchema, type LogRow } from './journal.ts'
import { crossPropertyViolations, orphanPeriodKeys } from './repository.ts'
import { heatingPlantViolations } from './heating.ts'
import { existsIn, moveToTrash, restoreFromTrash, storeDir, trashDir, type FileStore } from '../trash.ts'

// Die Tabellen der Abschlüsse. Eine neue Abschlusstabelle gehört hierher (Checkliste in db/CLAUDE.md).
export const FROZEN_TABLES = ['closed_settlements', 'closed_settlement_history', 'closed_heating_settlements', 'closed_heating_settlement_history'] as const

// Welche Zeilen auf Dateien verweisen, je Ablage (trash.ts). Eine neue Ablage gehört hierher.
const FILE_COLUMNS: Readonly<Record<FileStore, Readonly<Record<string, readonly string[]>>>> = {
  uploads: { uploads: ['file'] },
  briefpapier: {
    letter_design: ['logo_file', 'paper_file', 'paper_next_file'],
    property_letter_designs: ['logo_file', 'paper_file', 'paper_next_file'],
  },
}

export type RevertMode = 'including' | 'after'
export const isRevertMode = (value: unknown): value is RevertMode => value === 'including' || value === 'after'

export type RevertEntry = { id: number, at: string, title: string, rows: number, reverted: boolean }

export type RevertPreview = {
  kind: 'journal'
  mode: RevertMode
  entry: { id: number, firstId: number, at: string, title: string }
  // Die erste zurückzunehmende Gruppe; alles ab ihr wird zurückgenommen.
  startId: number
  // Was zurückgenommen wird, je Eintrag, neueste zuerst.
  entries: RevertEntry[]
  changes: number
  // Leer heißt: Der Rücksprung geht. Sonst je Grenze ein Satz.
  refusals: string[]
  files: { restore: number, trash: number }
  token: string
}

// Ein Rücksprung, der nicht geht (409). `preview` trägt die neue Vorschau, wenn die Marke nicht mehr stimmte.
export class RevertRefused extends Error {
  readonly preview: RevertPreview | null
  constructor(message: string, preview: RevertPreview | null = null) {
    super(message)
    this.preview = preview
  }
}

type GroupRow = typeof changeGroups.$inferSelect
type Image = Record<string, unknown>

const parseImage = (text: string | null): Image | null => {
  if (text === null) return null
  const value: unknown = JSON.parse(text)
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Image) : null
}

// Ein Zeitpunkt für einen Satz, wie ihn ein Vermieter in Deutschland liest.
export function berlinTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
  } catch {
    return iso.slice(0, 16).replace('T', ' ')
  }
}

// Die Gruppen eines Eintrags (eine Anfrage, siehe `requestId`): die jüngste ist der Eintrag.
async function entryGroups(db: Executor, id: number): Promise<GroupRow[] | null> {
  const group = await db.select().from(changeGroups).where(sql`${changeGroups.id} = ${id}`).get()
  if (!group) return null
  if (group.requestId === null) return [group]
  return db.select().from(changeGroups).where(sql`${changeGroups.requestId} = ${group.requestId} AND ${changeGroups.id} <= ${id}`).orderBy(changeGroups.id).all()
}

type Range = { mode: RevertMode, entry: RevertPreview['entry'], startId: number, groups: GroupRow[], rows: Map<number, LogRow[]> }

async function rangeOf(db: Executor, schema: JournalSchema, id: number, mode: RevertMode): Promise<Range | null> {
  const own = await entryGroups(db, id)
  if (!own) return null
  const resolver = new Resolver(db, schema)
  const ownRows = await db.select().from(changeLog).where(inArray(changeLog.groupId, own.map((g) => g.id))).orderBy(changeLog.id).all()
  const newest = own[own.length - 1]
  const entry = {
    id: newest.id,
    firstId: own[0].id,
    at: newest.at,
    title: await groupTitle(newest.description, newest.subjectTable, ownRows, resolver),
  }
  const startId = mode === 'including' ? entry.firstId : entry.id + 1
  const groups = await db.select().from(changeGroups).where(gte(changeGroups.id, startId)).orderBy(changeGroups.id).all()
  const rows = new Map<number, LogRow[]>(groups.map((g) => [g.id, []]))
  for (const row of await db.select().from(changeLog).where(gte(changeLog.groupId, startId)).orderBy(changeLog.id).all()) rows.get(row.groupId)?.push(row)
  return { mode, entry, startId, groups, rows }
}

// Die Einträge des Bereichs, neueste zuerst: Gruppen einer Anfrage zusammen.
async function entriesOf(db: Executor, schema: JournalSchema, range: Range): Promise<RevertEntry[]> {
  const resolver = new Resolver(db, schema)
  const byEntry = new Map<string, GroupRow[]>()
  for (const g of range.groups) {
    const key = g.requestId === null ? `#${g.id}` : `r${g.requestId}`
    const list = byEntry.get(key)
    if (list) list.push(g)
    else byEntry.set(key, [g])
  }
  const out: RevertEntry[] = []
  for (const list of byEntry.values()) {
    const newest = list[list.length - 1]
    const rows = list.flatMap((g) => range.rows.get(g.id) ?? []).sort((a, b) => a.id - b.id)
    out.push({
      id: newest.id,
      at: newest.at,
      title: newest.barrier !== null ? newest.description : await groupTitle(newest.description, newest.subjectTable, rows, resolver),
      rows: collapse(rows).length,
      reverted: newest.revertedBy !== null,
    })
  }
  return out.sort((a, b) => b.id - a.id)
}

const BARRIER_TEXT: Record<string, (at: string) => string> = {
  restore: (at) =>
    `Am ${at} wurde ein Backup eingespielt. Über das Einspielen hinweg führt kein Rücksprung, denn der Stand davor steht nicht in dieser Datenbank. Er liegt im Datenordner als „mietfuchs.sqlite.vor-restore“; zurück kommen Sie dorthin über die automatischen Vorversionen oder ein Backup.`,
  priorVersion: (at) =>
    `Am ${at} wurde eine Vorversion eingespielt. Über das Einspielen hinweg führt kein Rücksprung, denn der Stand davor steht nicht in dieser Datenbank. Er liegt im Datenordner als „mietfuchs.sqlite.vor-restore“; zurück kommen Sie dorthin über die automatischen Vorversionen oder ein Backup.`,
  changeover: (at) =>
    `Am ${at} hat Mietfuchs Ihre Daten aus der früheren db.json übernommen. Davor gibt es keinen Verlauf; der frühere Stand liegt im Datenordner als „db.json.abgeloest“.`,
}

const SCHEMA_TEXT =
  'Im Bereich liegen Änderungen von vor dem letzten Update von Mietfuchs. Sie lassen sich lesen, aber nicht zurücknehmen, denn ein Update kann den Aufbau der Daten ändern. ' +
  'Den Stand vor dem Update enthält die Sicherung, die Mietfuchs dabei im Datenordner angelegt hat („mietfuchs.sqlite.vor-…“, siehe MIGRATION.md).'

const FROZEN_TAIL =
  'Ein Abschluss und ein Wiederöffnen lassen sich im Verlauf nicht zurücknehmen, damit kein zugestellter, eingefrorener Stand still verschwindet oder ohne Abschluss entsteht. ' +
  'Öffnen Sie die Abrechnung bei Bedarf bewusst mit „Wieder öffnen“ auf der Seite Abrechnung (der eingefrorene Stand bleibt dort im Verlauf der Abschlüsse). Danach können Sie bis zu diesem Wiederöffnen zurückkehren, aber nicht darüber hinweg.'

// Die Grenzen, die sich ohne Probelauf erkennen lassen.
async function staticRefusals(db: Executor, schema: JournalSchema, range: Range, schemaSteps: number): Promise<string[]> {
  const out: string[] = []
  if (range.groups.length === 0) return ['Nach diesem Eintrag gibt es keine Änderung, also ist nichts zurückzunehmen.']
  const barrierId = await latestBarrierId(db)
  for (const g of range.groups) {
    if (g.barrier !== null) out.push(BARRIER_TEXT[g.barrier]?.(berlinTime(g.at)) ?? 'Über diese Stelle des Verlaufs führt kein Rücksprung.')
  }
  if (out.length === 0 && range.startId < barrierId) out.push('Über das Einspielen eines Backups oder einer Vorversion hinweg führt kein Rücksprung.')
  if (range.groups.some((g) => g.schemaSteps !== schemaSteps)) out.push(SCHEMA_TEXT)
  const resolver = new Resolver(db, schema)
  const frozen = range.groups.filter((g) => (range.rows.get(g.id) ?? []).some((r) => (FROZEN_TABLES as readonly string[]).includes(r.tableName)))
  for (const g of frozen) {
    const rows = range.rows.get(g.id) ?? []
    const main = rows.find((r) => r.tableName === 'closed_settlements' || r.tableName === 'closed_heating_settlements')
    const what = main?.op === 'insert' ? 'schließt eine Abrechnung ab' : main?.op === 'delete' ? 'öffnet eine abgeschlossene Abrechnung wieder' : 'ändert eine abgeschlossene Abrechnung'
    out.push(`„${await groupTitle(g.description, g.subjectTable, rows, resolver)}“ vom ${berlinTime(g.at)} ${what}.`)
  }
  if (frozen.length > 0) out.push(FROZEN_TAIL)
  return out
}

// ---------- Dateien ----------

async function referencedFiles(db: Executor): Promise<Map<FileStore, Set<string>>> {
  const out = new Map<FileStore, Set<string>>()
  for (const [store, tables] of Object.entries(FILE_COLUMNS) as [FileStore, Record<string, readonly string[]>][]) {
    const names = new Set<string>()
    for (const [table, columns] of Object.entries(tables)) {
      for (const column of columns) {
        for (const row of await db.all<[unknown]>(sql`SELECT ${sql.identifier(column)} FROM ${sql.identifier(table)} WHERE ${sql.identifier(column)} IS NOT NULL`)) {
          if (typeof row[0] === 'string' && row[0] !== '') names.add(row[0])
        }
      }
    }
    out.set(store, names)
  }
  return out
}

// Welche Dateien das Journal noch nennt: Was keine Zeile mehr nennt, braucht kein Rücksprung mehr aus dem Papierkorb.
export async function filesNamedInJournal(db: Executor): Promise<Map<FileStore, Set<string>>> {
  const out = new Map<FileStore, Set<string>>()
  for (const [store, tables] of Object.entries(FILE_COLUMNS) as [FileStore, Record<string, readonly string[]>][]) {
    const names = new Set<string>()
    const list = Object.keys(tables)
    const rows = await db.select({ table: changeLog.tableName, before: changeLog.before, after: changeLog.after }).from(changeLog).where(inArray(changeLog.tableName, list)).all()
    for (const row of rows) {
      for (const image of [parseImage(row.before), parseImage(row.after)]) {
        for (const column of tables[row.table] ?? []) {
          const value = image?.[column]
          if (typeof value === 'string' && value !== '') names.add(value)
        }
      }
    }
    out.set(store, names)
  }
  return out
}

type FilePlan = { restore: [FileStore, string][], trash: [FileStore, string][], missing: [FileStore, string][] }

function filePlan(dataDir: string, before: Map<FileStore, Set<string>>, after: Map<FileStore, Set<string>>): FilePlan {
  const plan: FilePlan = { restore: [], trash: [], missing: [] }
  for (const [store, names] of after) {
    const had = before.get(store) ?? new Set()
    for (const name of names) {
      if (had.has(name) || existsIn(storeDir(dataDir, store), name)) continue
      if (existsIn(trashDir(dataDir, store), name)) plan.restore.push([store, name])
      else plan.missing.push([store, name])
    }
    for (const name of had) {
      if (!names.has(name) && existsIn(storeDir(dataDir, store), name)) plan.trash.push([store, name])
    }
  }
  return plan
}

// Verschiebt die Dateien; scheitert eine, gehen die schon verschobenen zurück, und der Fehler rollt die Transaktion
// zurück.
function moveFiles(dataDir: string, plan: FilePlan): void {
  const done: (() => void)[] = []
  try {
    for (const [store, name] of plan.restore) {
      restoreFromTrash(dataDir, store, name)
      done.push(() => moveToTrash(dataDir, store, name))
    }
    for (const [store, name] of plan.trash) {
      moveToTrash(dataDir, store, name)
      done.push(() => restoreFromTrash(dataDir, store, name))
    }
  } catch (err) {
    for (const undo of done.reverse()) {
      try {
        undo()
      } catch { /* bleibt im Papierkorb bzw. im Ordner liegen; die Konsole hat den ersten Fehler */ }
    }
    throw err
  }
}

// ---------- Zurücknehmen ----------

function sqlValue(value: unknown): unknown {
  if (value !== null && typeof value === 'object') {
    if ('$blob' in value && typeof value.$blob === 'string') return Buffer.from(value.$blob, 'hex')
    // Ein ausgelassener eingefrorener Stand (`OMITTED_COLUMNS`) lässt sich nicht wiederherstellen; Abschlusstabellen
    // sind deshalb gesperrt, und hier kommt keiner an.
    throw new RevertRefused('Eine Zeile des Verlaufs ist nicht vollständig gespeichert und lässt sich nicht wiederherstellen.')
  }
  return value
}

const keyCondition = (table: string, key: Image) => {
  const parts = Object.entries(key).map(([column, value]) =>
    column === 'rowid' ? sql`rowid = ${sqlValue(value)}` : sql`${sql.identifier(column)} = ${sqlValue(value)}`)
  if (parts.length === 0) throw new Error(`Zeile ohne Schlüssel in ${table}`)
  return sql.join(parts, sql` AND `)
}

async function inverse(db: Executor, row: LogRow): Promise<void> {
  const table = sql.identifier(row.tableName)
  const key = parseImage(row.rowKey) ?? {}
  if (row.op === 'insert') {
    await db.run(sql`DELETE FROM ${table} WHERE ${keyCondition(row.tableName, key)}`)
    return
  }
  const before = parseImage(row.before)
  if (!before) throw new Error(`Zeile ohne Vorher-Stand in ${row.tableName}`)
  const columns = Object.keys(before).filter((c) => c !== ROWID)
  if (row.op === 'delete') {
    const rowid = before[ROWID]
    const names = [...(typeof rowid === 'number' ? [sql.raw('rowid')] : []), ...columns.map((c) => sql.identifier(c))]
    const values = [...(typeof rowid === 'number' ? [sql`${rowid}`] : []), ...columns.map((c) => sql`${sqlValue(before[c])}`)]
    await db.run(sql`INSERT INTO ${table} (${sql.join(names, sql`, `)}) VALUES (${sql.join(values, sql`, `)})`)
    return
  }
  const sets = columns.map((c) => sql`${sql.identifier(c)} = ${sqlValue(before[c])}`)
  await db.run(sql`UPDATE ${table} SET ${sql.join(sets, sql`, `)} WHERE ${keyCondition(row.tableName, key)}`)
}

// Das Sicherheitsnetz nach dem Zurücknehmen: dieselben Prüfungen wie beim Wiederherstellen eines Backups.
async function stockProblems(db: Executor): Promise<string[]> {
  const fk = await db.all<[string, number, string, number]>(sql`PRAGMA foreign_key_check`)
  const out = fk.slice(0, 3).map((r) => `Eine Zeile in „${String(r[0])}“ verwiese auf eine fehlende in „${String(r[2])}“.`)
  out.push(...(await crossPropertyViolations(db)), ...(await orphanPeriodKeys(db)), ...(await heatingPlantViolations(db)))
  return out
}

async function applyRange(db: Executor, range: Range, dataDir: string): Promise<FilePlan> {
  const before = await referencedFiles(db)
  await db.run(sql`PRAGMA defer_foreign_keys = ON`)
  const rows = range.groups.flatMap((g) => range.rows.get(g.id) ?? []).sort((a, b) => b.id - a.id)
  for (const row of rows) await inverse(db, row)
  const problems = await stockProblems(db)
  if (problems.length > 0) {
    throw new RevertRefused(`Nach dem Rücksprung stimmte der Bestand nicht; deshalb ist nichts geändert. ${problems.slice(0, 3).join(' ')}`)
  }
  const plan = filePlan(dataDir, before, await referencedFiles(db))
  if (plan.missing.length > 0) {
    const names = plan.missing.slice(0, 3).map(([, name]) => `„${name}“`).join(', ')
    throw new RevertRefused(
      `Der Stand nennt ${plan.missing.length === 1 ? 'eine Datei' : `${plan.missing.length} Dateien`} (${names}), die weder im Belegordner noch im Papierkorb liegt; ` +
        'ohne sie wäre der Beleg bzw. das Logo verloren. Deshalb ist nichts geändert. Der Papierkorb wird mit dem Verlauf nach zwölf Monaten geleert.',
    )
  }
  return plan
}

class Rollback extends Error {
  readonly plan: FilePlan
  constructor(plan: FilePlan) {
    super('Probelauf')
    this.plan = plan
  }
}

// Die Marke steht für den Bereich: welche Einträge mit wie vielen Änderungen. Kommt ein Eintrag hinzu, ändert sie sich.
const tokenOf = (p: Pick<RevertPreview, 'kind' | 'mode' | 'entry' | 'startId' | 'entries' | 'changes'>): string =>
  createHash('sha256').update(JSON.stringify([p.kind, p.mode, p.entry, p.startId, p.entries, p.changes])).digest('hex').slice(0, 32)

type Plan = { range: Range, entries: RevertEntry[], refusals: string[], token: string }

// Bereich, Einträge, die Grenzen ohne Probelauf und die Marke.
async function planOf(db: Executor, schema: JournalSchema, id: number, mode: RevertMode, schemaSteps: number): Promise<Plan | null> {
  const range = await rangeOf(db, schema, id, mode)
  if (!range) return null
  const refusals = await staticRefusals(db, schema, range, schemaSteps)
  const entries = await entriesOf(db, schema, range)
  const changes = entries.reduce((sum, e) => sum + e.rows, 0)
  return { range, entries, refusals, token: tokenOf({ kind: 'journal', mode, entry: range.entry, startId: range.startId, entries, changes }) }
}

// Die Vorschau: was zurückgenommen würde, und ob es geht. Der Probelauf schreibt in einer Transaktion und rollt
// zurück; er läuft durch die Schreibschlange ohne Gruppe (DRY_RUN_ROUTES).
export async function previewRevert(db: Database, schema: JournalSchema, id: number, mode: RevertMode, schemaSteps: number, dataDir: string): Promise<RevertPreview | null> {
  const plan = await planOf(db, schema, id, mode, schemaSteps)
  if (!plan) return null
  const refusals = [...plan.refusals]
  let files = { restore: 0, trash: 0 }
  if (refusals.length === 0) {
    try {
      await db.transaction(async (tx) => {
        throw new Rollback(await applyRange(tx, plan.range, dataDir))
      })
    } catch (err) {
      if (err instanceof Rollback) files = { restore: err.plan.restore.length, trash: err.plan.trash.length }
      else if (err instanceof RevertRefused) refusals.push(err.message)
      else throw err
    }
  }
  return {
    kind: 'journal',
    mode,
    entry: plan.range.entry,
    startId: plan.range.startId,
    entries: plan.entries,
    changes: plan.entries.reduce((sum, e) => sum + e.rows, 0),
    refusals,
    files,
    token: plan.token,
  }
}

// Der Satz der Gruppe des Rücksprungs.
function revertDescription(range: Range, entries: RevertEntry[]): string {
  const at = berlinTime(range.entry.at)
  if (range.mode === 'including' && entries.length === 1) return `Rückgängig: ${range.entry.title}`
  return range.mode === 'including'
    ? `Zurückgekehrt zum Stand vor „${range.entry.title}“ vom ${at}`
    : `Zurückgekehrt zum Stand nach „${range.entry.title}“ vom ${at}`
}

// Der Rücksprung. Läuft in der Schreibschlange mit Gruppe (der Satz der Route wird hier durch den genauen ersetzt); die
// Marke muss die der Vorschau sein, sonst 409 mit neuer Vorschau. Ohne Zustimmung wird nichts geschrieben.
export async function applyRevert(
  db: Database, schema: JournalSchema, id: number, mode: RevertMode, token: unknown, schemaSteps: number, dataDir: string,
): Promise<{ groupId: number | null, reverted: number } | null> {
  const plan = await planOf(db, schema, id, mode, schemaSteps)
  if (!plan) return null
  const refuse = async (message: string) => new RevertRefused(message, await previewRevert(db, schema, id, mode, schemaSteps, dataDir))
  if (token !== plan.token) throw await refuse('Der Verlauf hat sich inzwischen geändert. Bitte prüfen Sie den Rücksprung noch einmal.')
  if (plan.refusals.length > 0) throw await refuse(plan.refusals.join(' '))
  const { range, entries } = plan
  let groupId: number | null = null
  try {
    await db.transaction(async (tx) => {
      const files = await applyRange(tx, range, dataDir)
      groupId = await currentGroupId(tx)
      if (groupId !== null) {
        // Die Gruppe des Rücksprungs gibt es, sobald er eine Zeile geändert hat; ohne Zeile (nur leere Gruppen im
        // Bereich) entsteht sie hier, damit die Markierung einen Bezug hat.
        await tx.run(sql`INSERT INTO change_groups (id, at, method, route, description, subject_table, schema_steps, request_id)
          SELECT group_id, at, method, route, description, subject_table, schema_steps, request_id FROM temp.journal_current
          WHERE NOT EXISTS (SELECT 1 FROM change_groups WHERE id = (SELECT group_id FROM temp.journal_current))`)
        // Was ein zurückgenommener Rücksprung zurückgenommen hatte, gilt wieder (außer es liegt selbst im Bereich).
        await tx.run(sql`UPDATE change_groups SET reverted_by = NULL WHERE reverted_by IN (SELECT id FROM change_groups WHERE id >= ${range.startId} AND id <> ${groupId})`)
        await tx.run(sql`UPDATE change_groups SET reverted_by = ${groupId} WHERE id >= ${range.startId} AND id <> ${groupId} AND reverted_by IS NULL`)
        await tx.run(sql`UPDATE change_groups SET description = ${revertDescription(range, entries)} WHERE id = ${groupId}`)
      }
      moveFiles(dataDir, files)
    })
  } catch (err) {
    // Das Sicherheitsnetz oder eine fehlende Datei: zurückgerollt, die Antwort trägt die Vorschau mit dem Grund.
    if (err instanceof RevertRefused) throw await refuse(err.message)
    throw err
  }
  return { groupId, reverted: entries.length }
}

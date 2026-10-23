// Das Änderungsjournal (#318, Schritte 2 und 3; Entwurf in
// docs/superpowers/specs/2026-10-24-journal-design.md).
//
// Neben dem Bestand steht, was jede schreibende Anfrage geändert hat: eine Gruppe je Anfrage
// (`change_groups`) und eine Zeile je geänderter Zeile (`change_log`) mit Vorher- und Nachher-Stand.
// Keine Berechnung liest es.
//
// **Die Trigger stehen nicht in der Datei.** Sie entstehen bei jedem Öffnen als TEMP TRIGGER auf den
// Tabellen von `main`, nach der Migrationskette und mit den Spalten, die die Datei gerade hat
// (`ensureJournal`). So verliert ein Migrationsschritt, der eine Tabelle neu baut (drizzle-kit:
// CREATE `__new_x`, kopieren, DROP, RENAME), keine Trigger, und eine neue Tabelle ist ohne Zutun
// dabei. Backup, Vorversionen und `VACUUM INTO` tragen nur die Daten; der Umstieg und der
// eingefrorene Eingang schreiben über eigene Verbindungen ohne Trigger.
//
// **Erfasst wird nur in einer Gruppe.** Die TEMP-Tabelle `journal_current` hält die Kennung der
// laufenden Gruppe; die Trigger schreiben nur, wenn sie gesetzt ist. Gesetzt wird sie allein von
// der Schlange (open.ts) für einen Schreibvorgang mit Angabe zur Gruppe; Systemarbeit ohne Anfrage
// (Prüfsummen nachtragen, Schnappschuss, Migrationen) bleibt draußen.

import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import type { Connection, Database, Executor } from './client.ts'
import { changeGroups, changeLog } from './schema.ts'

// Wie lange Gruppen aufbewahrt werden (Datenschutz, siehe Entwurf). Aufgeräumt wird beim Start.
export const JOURNAL_KEEP_MONTHS = 12

// Nie erfasst: das Journal selbst, die Buchführung von drizzle und SQLite.
const NOT_JOURNALED = new Set(['change_groups', 'change_log', '__drizzle_migrations'])

// Der eingefrorene Stand einer Abrechnung ist das größte Feld des Bestands und ändert sich nie
// (Abschließen legt ihn an, Wieder öffnen verschiebt ihn in den Verlauf, wo er erhalten bleibt).
// Er steht im Journal nur als Vermerk mit seiner Länge.
export const OMITTED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  closed_settlements: ['settlement'],
  closed_settlement_history: ['settlement'],
  closed_heating_settlements: ['settlement'],
  closed_heating_settlement_history: ['settlement'],
}

export const TRIGGER_PREFIX = 'journal_'
const OPS = ['insert', 'update', 'delete'] as const

export type TableInfo = {
  name: string
  columns: string[]
  // Die Spalten des Primärschlüssels in ihrer Reihenfolge; leer heißt: die rowid.
  key: string[]
  // Fremdschlüssel: eigene Spalte → Tabelle und Spalte darüber.
  parents: { column: string, table: string, to: string }[]
}

export type JournalSchema = Map<string, TableInfo>

const quoteId = (name: string): string => `"${name.replace(/"/g, '""')}"`
const quoteText = (text: string): string => `'${text.replace(/'/g, "''")}'`

// Die Tabellen, die erfasst werden, mit Spalten, Schlüssel und Fremdschlüsseln, so wie die Datei
// sie gerade hat.
export function journalSchema(connection: Pick<Connection, 'rows'>): JournalSchema {
  const names = connection
    .rows("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .map((row) => String(row[0]))
    .filter((name) => !NOT_JOURNALED.has(name))
  const schema: JournalSchema = new Map()
  for (const name of names) {
    const info = connection.rows(`PRAGMA table_info(${quoteId(name)})`)
    const columns = info.map((row) => String(row[1]))
    const key = info
      .filter((row) => Number(row[5]) > 0)
      .sort((a, b) => Number(a[5]) - Number(b[5]))
      .map((row) => String(row[1]))
    const parents = connection
      .rows(`PRAGMA foreign_key_list(${quoteId(name)})`)
      .map((row) => ({ table: String(row[2]), column: String(row[3]), to: String(row[4]) }))
    schema.set(name, { name, columns, key, parents })
  }
  return schema
}

// Der Ausdruck für eine Zeile als JSON über alle Spalten; `side` ist OLD oder NEW.
function rowJson(table: TableInfo, side: 'OLD' | 'NEW'): string {
  const omitted = OMITTED_COLUMNS[table.name] ?? []
  const parts = table.columns.map((column) => {
    const ref = `${side}.${quoteId(column)}`
    const value = omitted.includes(column)
      ? `CASE WHEN ${ref} IS NULL THEN NULL ELSE json_object('$omitted', 1, 'length', length(${ref})) END`
      : ref
    return `${quoteText(column)}, ${value}`
  })
  return `json_object(${parts.join(', ')})`
}

function keyJson(table: TableInfo, side: 'OLD' | 'NEW'): string {
  if (table.key.length === 0) return `json_object('rowid', ${side}.rowid)`
  return `json_object(${table.key.map((c) => `${quoteText(c)}, ${side}.${quoteId(c)}`).join(', ')})`
}

export const triggerName = (table: string, op: (typeof OPS)[number]): string => `${TRIGGER_PREFIX}${table}_${op}`

// Die drei Trigger einer Tabelle. Unqualifizierte Namen im Rumpf: Ein TEMP-Trigger findet
// `journal_current` im temp-Schema und `change_log` in main; Namen mit Schema lässt SQLite in einem
// Trigger-Rumpf nicht in jeder Fassung zu.
export function triggerSql(table: TableInfo): string[] {
  const target = `main.${quoteId(table.name)}`
  const active = '(SELECT group_id FROM journal_current) IS NOT NULL'
  const insert = (op: string, key: string, before: string, after: string) =>
    `INSERT INTO change_log (group_id, table_name, row_key, op, before, after) VALUES ` +
    `((SELECT group_id FROM journal_current), ${quoteText(table.name)}, ${key}, '${op}', ${before}, ${after});`
  // Ein Update, das nichts ändert (die Repository-Schicht schreibt die Hauptzeile immer), ergibt
  // keine Zeile.
  const changed = table.columns.map((c) => `OLD.${quoteId(c)} IS NOT NEW.${quoteId(c)}`).join(' OR ')
  return [
    `CREATE TEMP TRIGGER ${quoteId(triggerName(table.name, 'insert'))} AFTER INSERT ON ${target} WHEN ${active} ` +
      `BEGIN ${insert('insert', keyJson(table, 'NEW'), 'NULL', rowJson(table, 'NEW'))} END`,
    `CREATE TEMP TRIGGER ${quoteId(triggerName(table.name, 'update'))} AFTER UPDATE ON ${target} WHEN ${active} AND (${changed}) ` +
      `BEGIN ${insert('update', keyJson(table, 'NEW'), rowJson(table, 'OLD'), rowJson(table, 'NEW'))} END`,
    `CREATE TEMP TRIGGER ${quoteId(triggerName(table.name, 'delete'))} AFTER DELETE ON ${target} WHEN ${active} ` +
      `BEGIN ${insert('delete', keyJson(table, 'OLD'), rowJson(table, 'OLD'), 'NULL')} END`,
  ]
}

// Legt `journal_current` und die Trigger an, idempotent: Vorhandene Trigger des Journals werden
// erst entfernt, damit ihre Spaltenliste immer die von heute ist.
export function ensureJournal(connection: Pick<Connection, 'rows' | 'exec'>): JournalSchema {
  connection.exec('CREATE TEMP TABLE IF NOT EXISTS journal_current (group_id INTEGER)')
  connection.exec('DELETE FROM temp.journal_current')
  connection.exec('INSERT INTO temp.journal_current (group_id) VALUES (NULL)')
  const existing = connection
    .rows(`SELECT name FROM sqlite_temp_master WHERE type = 'trigger' AND name LIKE '${TRIGGER_PREFIX}%'`)
    .map((row) => String(row[0]))
  for (const name of existing) connection.exec(`DROP TRIGGER IF EXISTS temp.${quoteId(name)}`)
  const schema = journalSchema(connection)
  for (const table of schema.values()) for (const statement of triggerSql(table)) connection.exec(statement)
  return schema
}

// ---------- Gruppen ----------

export type JournalMeta = {
  method: string
  route: string
  description: string
  subjectTable: string | null
  // Woran zwei Schreibvorgänge derselben Anfrage erkannt werden (die Anfrage selbst). Eine
  // Anfrage ist eine Gruppe.
  scope: object
}

const groupOfScope = new WeakMap<object, number>()

export async function beginGroup(db: Database, meta: JournalMeta, schemaSteps: number, now: Date): Promise<number> {
  let id = groupOfScope.get(meta.scope)
  if (id !== undefined) {
    const still = await db.select({ id: changeGroups.id }).from(changeGroups).where(eq(changeGroups.id, id)).get()
    if (!still) id = undefined
  }
  if (id === undefined) {
    const row = await db
      .insert(changeGroups)
      .values({
        at: now.toISOString(),
        method: meta.method,
        route: meta.route,
        description: meta.description,
        subjectTable: meta.subjectTable,
        schemaSteps,
      })
      .returning({ id: changeGroups.id })
      .get()
    if (!row) throw new Error('Die Gruppe des Änderungsjournals ließ sich nicht anlegen.')
    id = row.id
    groupOfScope.set(meta.scope, id)
  }
  await db.run(sql`UPDATE temp.journal_current SET group_id = ${id}`)
  return id
}

// Schließt die Gruppe: Kennung leeren, eine leere Gruppe (nichts geschrieben oder zurückgerollt)
// entfernen, sonst das Objekt bestimmen.
export async function endGroup(db: Database, id: number, schema: JournalSchema, scope: object): Promise<void> {
  await db.run(sql`UPDATE temp.journal_current SET group_id = NULL`)
  const rows = await db.select().from(changeLog).where(eq(changeLog.groupId, id)).orderBy(changeLog.id).all()
  if (rows.length === 0) {
    await db.delete(changeGroups).where(eq(changeGroups.id, id))
    groupOfScope.delete(scope)
    return
  }
  const propertyId = await propertyOfGroup(db, rows, schema)
  await db.update(changeGroups).set({ propertyId }).where(eq(changeGroups.id, id))
}

type LogRow = typeof changeLog.$inferSelect

const parseRow = (text: string | null): Record<string, unknown> | null => {
  if (text === null) return null
  const value: unknown = JSON.parse(text)
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

// Das Objekt einer Gruppe aus ihren Zeilen: `property_id` der Zeile, sonst über die Fremdschlüssel
// zum Elternteil, zuerst in derselben Gruppe (die eben gelöschte Wohnung), sonst im Bestand. Genau
// ein Objekt ergibt dessen Kennung, keines oder mehrere `null` (installationsweit).
export async function propertyOfGroup(db: Executor, rows: LogRow[], schema: JournalSchema): Promise<string | null> {
  const images = new Map<string, Record<string, unknown>>()
  const imageKey = (table: string, column: string, value: unknown) => `${table}\u0000${column}\u0000${String(value)}`
  for (const row of rows) {
    for (const image of [parseRow(row.before), parseRow(row.after)]) {
      if (!image) continue
      for (const [column, value] of Object.entries(image)) {
        if (value !== null && typeof value !== 'object') images.set(imageKey(row.tableName, column, value), image)
      }
    }
  }
  const lookup = async (table: string, column: string, value: unknown): Promise<Record<string, unknown> | null> => {
    const own = images.get(imageKey(table, column, value))
    if (own) return own
    const info = schema.get(table)
    if (!info || !info.columns.includes(column)) return null
    const found = await db.get<[string]>(
      sql`SELECT ${sql.raw(`json_object(${info.columns.map((c) => `${quoteText(c)}, ${quoteId(c)}`).join(', ')})`)} FROM ${sql.identifier(table)} WHERE ${sql.identifier(column)} = ${value as string | number} LIMIT 1`,
    )
    return found ? parseRow(found[0]) : null
  }
  const propertyOf = async (table: string, image: Record<string, unknown>, depth: number): Promise<string | null> => {
    if (table === 'properties') return typeof image.id === 'string' ? image.id : null
    if (typeof image.property_id === 'string') return image.property_id
    if (depth > 6) return null
    for (const parent of schema.get(table)?.parents ?? []) {
      const value = image[parent.column]
      if (value === null || value === undefined) continue
      const up = await lookup(parent.table, parent.to, value)
      if (!up) continue
      const found = await propertyOf(parent.table, up, depth + 1)
      if (found) return found
    }
    return null
  }
  // Ist ein Teil nicht zuzuordnen (etwa die Einstellungen neben einem Objekt), bleibt die Gruppe
  // trotzdem bei ihrem Objekt, solange es nur eines gibt; erst mehrere machen sie installationsweit.
  const found = new Set<string>()
  for (const row of rows) {
    const image = parseRow(row.after) ?? parseRow(row.before)
    const property = image ? await propertyOf(row.tableName, image, 0) : null
    if (property) found.add(property)
  }
  return found.size === 1 ? [...found][0] : null
}

// ---------- Aufräumen ----------

export function journalCutoff(now: Date): string {
  const cutoff = new Date(now.getTime())
  cutoff.setUTCMonth(cutoff.getUTCMonth() - JOURNAL_KEEP_MONTHS)
  return cutoff.toISOString()
}

export async function pruneJournal(db: Database, now: Date): Promise<number> {
  const old = await db.select({ id: changeGroups.id }).from(changeGroups).where(lt(changeGroups.at, journalCutoff(now))).all()
  if (old.length === 0) return 0
  await db.delete(changeGroups).where(lt(changeGroups.at, journalCutoff(now)))
  return old.length
}

// ---------- Lesen (Schritt 3) ----------

export type JournalGroupView = {
  id: number
  at: string
  method: string
  route: string
  description: string
  title: string
  propertyId: string | null
  rows: number
}

export type JournalRowView = {
  id: number
  table: string
  key: Record<string, unknown>
  op: 'insert' | 'update' | 'delete'
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  // Bei einer Änderung nur die Spalten, die sich geändert haben, sonst alle.
  changed: string[]
}

// Womit eine Zeile im Verlauf benannt wird, je Tabelle.
const LABEL: Record<string, (row: Record<string, unknown>) => string | null> = {
  properties: (r) => text(r.name),
  units: (r) => text(r.name),
  tenancies: (r) => text(r.tenant_name),
  cost_items: (r) => text(r.description),
  meters: (r) => text(r.name),
  heating_plants: (r) => text(r.name),
  fuel_deliveries: (r) => text(r.label),
  uploads: (r) => text(r.original_name),
  closed_settlements: (r) => text(r.period),
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

export function groupTitle(description: string, subjectTable: string | null, rows: LogRow[]): string {
  const label = subjectTable ? LABEL[subjectTable] : undefined
  if (!label || !subjectTable) return description
  const row = rows.find((r) => r.tableName === subjectTable)
  const image = row ? (parseRow(row.after) ?? parseRow(row.before)) : null
  const name = image ? label(image) : null
  return name ? `${description}: ${name}` : description
}

export async function listJournal(
  db: Executor,
  options: { propertyId: string | null, before: number | null, limit: number },
): Promise<JournalGroupView[]> {
  const filters = [
    options.propertyId === null ? undefined : or(eq(changeGroups.propertyId, options.propertyId), isNull(changeGroups.propertyId)),
    options.before === null ? undefined : lt(changeGroups.id, options.before),
  ].filter((f) => f !== undefined)
  const groups = await db
    .select()
    .from(changeGroups)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(changeGroups.id))
    .limit(options.limit)
    .all()
  if (groups.length === 0) return []
  const rows = await db.select().from(changeLog).where(inArray(changeLog.groupId, groups.map((g) => g.id))).orderBy(changeLog.id).all()
  return groups.map((g) => {
    const own = rows.filter((r) => r.groupId === g.id)
    return {
      id: g.id,
      at: g.at,
      method: g.method,
      route: g.route,
      description: g.description,
      title: groupTitle(g.description, g.subjectTable, own),
      propertyId: g.propertyId,
      rows: collapse(own).length,
    }
  })
}

// Ersetzt die Repository-Schicht eine Unterliste (Löschen und neu Einfügen), stehen unveränderte
// Zeilen als Löschen und Einfügen mit gleichem Inhalt da. Für den Verlauf fallen sie weg, eine
// geänderte wird zur Änderung. Die gespeicherten Zeilen bleiben, wie sie sind (Schritt 4 braucht
// die wirkliche Reihenfolge).
export function collapse(rows: LogRow[]): JournalRowView[] {
  const views: JournalRowView[] = rows.map((r) => ({
    id: r.id,
    table: r.tableName,
    key: parseRow(r.rowKey) ?? {},
    op: r.op,
    before: parseRow(r.before),
    after: parseRow(r.after),
    changed: [],
  }))
  const out: JournalRowView[] = []
  const used = new Set<number>()
  for (let i = 0; i < views.length; i++) {
    if (used.has(i)) continue
    const v = views[i]
    if (v.op === 'delete') {
      const j = views.findIndex((w, k) => k > i && !used.has(k) && w.op === 'insert' && w.table === v.table && asJson(w.key) === asJson(v.key))
      if (j >= 0) {
        used.add(j)
        const merged: JournalRowView = { ...v, op: 'update', after: views[j].after }
        merged.changed = changedColumns(merged.before, merged.after)
        if (merged.changed.length > 0) out.push(merged)
        continue
      }
    }
    v.changed = v.op === 'update' ? changedColumns(v.before, v.after) : Object.keys(v.after ?? v.before ?? {})
    out.push(v)
  }
  return out
}

const asJson = (value: unknown): string => JSON.stringify(value)

function changedColumns(before: Record<string, unknown> | null, after: Record<string, unknown> | null): string[] {
  const columns = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])
  return [...columns].filter((c) => asJson(before?.[c] ?? null) !== asJson(after?.[c] ?? null))
}

export async function journalGroup(db: Executor, id: number): Promise<(JournalGroupView & { changes: JournalRowView[] }) | null> {
  const group = await db.select().from(changeGroups).where(eq(changeGroups.id, id)).get()
  if (!group) return null
  const rows = await db.select().from(changeLog).where(eq(changeLog.groupId, id)).orderBy(changeLog.id).all()
  const changes = collapse(rows)
  return {
    id: group.id,
    at: group.at,
    method: group.method,
    route: group.route,
    description: group.description,
    title: groupTitle(group.description, group.subjectTable, rows),
    propertyId: group.propertyId,
    rows: changes.length,
    changes,
  }
}

// Leert das Journal in einer fremden Datei (der Schnappschuss fürs Backup ohne Verlauf).
export function clearJournal(connection: Pick<Connection, 'exec'>): void {
  connection.exec('DELETE FROM change_log')
  connection.exec('DELETE FROM change_groups')
}

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
// **Erfasst wird nur in einer Gruppe, und die Gruppe legt der erste Trigger an.** Die TEMP-Tabelle
// `journal_current` hält Kennung und Angaben der laufenden Gruppe; jeder Trigger legt die Gruppe an,
// wenn es sie noch nicht gibt, bevor er seine Zeile schreibt. Damit entsteht sie in der Transaktion der
// Arbeit: Rollt die zurück, ist auch die Gruppe weg, und ein Schreibvorgang ohne Änderung legt keine
// an. Vorher legte die Schlange die Gruppe vor der Arbeit in einem eigenen Schreibvorgang an und
// bestimmte danach in einem weiteren das Objekt; das waren zwei zusätzliche Festschreibungen je
// Anfrage und verdoppelte die Zeit eines einfachen Speicherns (Durchsicht von PR #430, S2). Gesetzt
// wird `journal_current` allein von der Schlange (open.ts) für einen Schreibvorgang mit Angabe zur
// Gruppe; das ist eine TEMP-Tabelle und kostet keine Festschreibung. Systemarbeit ohne Anfrage
// (Prüfsummen nachtragen, Schnappschuss, Migrationen, Aufräumen) bleibt draußen.
//
// **Das Objekt einer Gruppe wird beim Lesen bestimmt** (`groupProperties`), aus ihren Zeilen über die
// Fremdschlüssel. So kostet es beim Schreiben nichts, und ein später gelöschtes Objekt macht die
// Gruppe von selbst installationsweit (S6).

import { and, desc, eq, lt, sql } from 'drizzle-orm'
import type { Connection, Database, Executor } from './client.ts'
import { changeGroups, changeLog } from './schema.ts'

// Wie lange Gruppen aufbewahrt werden (Datenschutz, siehe Entwurf). Aufgeräumt wird beim Öffnen und
// danach einmal am Tag (index.ts, zusammen mit der Vorversion).
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

// Ein Wert für `json_object`. Ein BLOB lässt sich dort nicht ablegen („JSON cannot hold BLOB values“),
// und der Trigger risse dann die ganze Änderung mit; er steht deshalb hexadezimal da (S5).
const jsonValue = (ref: string): string => `CASE typeof(${ref}) WHEN 'blob' THEN json_object('$blob', hex(${ref})) ELSE ${ref} END`

// Der Ausdruck für eine Zeile als JSON über alle Spalten; `side` ist OLD oder NEW.
function rowJson(table: TableInfo, side: 'OLD' | 'NEW'): string {
  const omitted = OMITTED_COLUMNS[table.name] ?? []
  const parts = table.columns.map((column) => {
    const ref = `${side}.${quoteId(column)}`
    const value = omitted.includes(column)
      ? `CASE WHEN ${ref} IS NULL THEN NULL ELSE json_object('$omitted', 1, 'length', length(${ref})) END`
      : jsonValue(ref)
    return `${quoteText(column)}, ${value}`
  })
  return `json_object(${parts.join(', ')})`
}

function keyJson(table: TableInfo, side: 'OLD' | 'NEW'): string {
  if (table.key.length === 0) return `json_object('rowid', ${side}.rowid)`
  return `json_object(${table.key.map((c) => `${quoteText(c)}, ${jsonValue(`${side}.${quoteId(c)}`)}`).join(', ')})`
}

export const triggerName = (table: string, op: (typeof OPS)[number]): string => `${TRIGGER_PREFIX}${table}_${op}`

const GROUP_COLUMNS = 'id, at, method, route, description, subject_table, schema_steps'

// Die drei Trigger einer Tabelle. Unqualifizierte Namen im Rumpf: Ein TEMP-Trigger findet
// `journal_current` im temp-Schema und `change_groups`/`change_log` in main; Namen mit Schema lässt
// SQLite in einem Trigger-Rumpf nicht in jeder Fassung zu.
export function triggerSql(table: TableInfo): string[] {
  const target = `main.${quoteId(table.name)}`
  const active = '(SELECT group_id FROM journal_current) IS NOT NULL'
  // Die Gruppe entsteht mit ihrer ersten Zeile, in derselben Transaktion. **Nicht mit `INSERT OR
  // IGNORE`**: Eine Regel für Konflikte im Rumpf eines Triggers ersetzt SQLite durch die des äußeren
  // Befehls. Bei einem Upsert (`ON CONFLICT DO UPDATE`, etwa `recordUpload`) wird daraus ABORT, und das
  // zweite Speichern eines Belegs scheiterte an „UNIQUE constraint failed: change_groups.id“; bei
  // `INSERT OR REPLACE` würde die Gruppe ersetzt und nähme ihre Zeilen mit. Deshalb ohne Konflikt:
  // nur einfügen, wenn es sie noch nicht gibt.
  const group =
    `INSERT INTO change_groups (${GROUP_COLUMNS}) ` +
    `SELECT group_id, at, method, route, description, subject_table, schema_steps FROM journal_current ` +
    `WHERE NOT EXISTS (SELECT 1 FROM change_groups WHERE id = (SELECT group_id FROM journal_current));`
  const insert = (op: string, key: string, before: string, after: string) =>
    `${group} INSERT INTO change_log (group_id, table_name, row_key, op, before, after) VALUES ` +
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
  // Ein `REPLACE` löscht die alte Zeile, und ohne diese Einstellung feuert dabei kein DELETE-Trigger: Der
  // Vorher-Stand ginge verloren. Andere Trigger als die des Journals gibt es nicht.
  connection.exec('PRAGMA recursive_triggers = ON')
  connection.exec('DROP TABLE IF EXISTS temp.journal_current')
  connection.exec(
    'CREATE TEMP TABLE journal_current (group_id INTEGER, at TEXT, method TEXT, route TEXT, description TEXT, subject_table TEXT, schema_steps INTEGER)',
  )
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

// Die Gruppe des zuletzt erfassten Schreibvorgangs. Weil die Schlange alles nacheinander ausführt,
// gehört eine Kennung nur so lange einer Anfrage, bis eine andere schreibt: Kommt danach dieselbe
// Anfrage wieder, bekommt sie eine neue Gruppe, denn ihre alte Kennung könnte inzwischen vergeben
// sein (verschränkte Gruppen, siehe Entwurf).
let last: { scope: object, id: number } | null = null

// Setzt die laufende Gruppe. Liest nur (die nächste Kennung) und schreibt in die TEMP-Tabelle; die
// Gruppe selbst legt der erste Trigger an.
export async function beginGroup(db: Database, meta: JournalMeta, schemaSteps: number, now: Date): Promise<number> {
  let id: number
  if (last && last.scope === meta.scope) {
    id = last.id
  } else {
    // Über die Folge von AUTOINCREMENT, nicht nur über das größte `id`: Eine entfernte jüngste Gruppe
    // soll ihre Kennung nicht weitergeben (eine Liste im Browser blättert mit `before`).
    const next = await db.get<[number]>(sql`SELECT max(
      coalesce((SELECT max(id) FROM change_groups), 0),
      coalesce((SELECT seq FROM sqlite_sequence WHERE name = 'change_groups'), 0)) + 1`)
    id = Number(next?.[0] ?? 1)
    last = { scope: meta.scope, id }
  }
  await db.run(sql`UPDATE temp.journal_current SET group_id = ${id}, at = ${now.toISOString()}, method = ${meta.method},
    route = ${meta.route}, description = ${meta.description}, subject_table = ${meta.subjectTable}, schema_steps = ${schemaSteps}`)
  return id
}

// Schließt die Gruppe. **Wirft nie** (K1): Die Arbeit ist geschehen, und ein Fehler hier darf ihr
// Ergebnis nicht überdecken. Zuerst und für sich die Kennung leeren, sonst erfasste ein späterer
// Schreibvorgang ohne Angabe in diese Gruppe.
export async function endGroup(db: Database, id: number): Promise<void> {
  try {
    await db.run(sql`UPDATE temp.journal_current SET group_id = NULL`)
  } catch (err) {
    console.error(`Das Änderungsjournal ließ sich nicht schließen: ${String(err)}`)
    return
  }
  try {
    await dropIfNoChange(db, id)
  } catch (err) {
    console.error(`Das Änderungsjournal ließ sich nicht aufräumen: ${String(err)}`)
  }
}

// Eine Gruppe, die nach dem Zusammenfassen nichts ändert (eine Unterliste gelöscht und gleich wieder
// eingefügt, etwa beim Speichern der Einstellungen), wird gleich wieder entfernt (S4). Gefragt wird
// zuerst billig: Eine Zeile `update` ist immer eine Änderung, denn der Trigger schreibt keine ohne
// Unterschied.
async function dropIfNoChange(db: Database, id: number): Promise<void> {
  const update = await db.select({ id: changeLog.id }).from(changeLog).where(and(eq(changeLog.groupId, id), eq(changeLog.op, 'update'))).limit(1).get()
  if (update) return
  const rows = await db.select().from(changeLog).where(eq(changeLog.groupId, id)).orderBy(changeLog.id).all()
  if (rows.length > 0 && collapse(rows).length === 0) await db.delete(changeGroups).where(eq(changeGroups.id, id))
}

type LogRow = typeof changeLog.$inferSelect
type Image = Record<string, unknown>

const parseRow = (text: string | null): Image | null => {
  if (text === null) return null
  const value: unknown = JSON.parse(text)
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Image) : null
}

// ---------- Verweise auflösen ----------

// Findet Zeilen über ihre Spalte: zuerst unter den Bildern der eigenen Gruppe, dann im Bestand, dann
// im übrigen Journal (die zuletzt erfasste Fassung einer seither gelöschten Zeile). Ein Treffer wird
// je Lesevorgang gemerkt (K6), denn dieselbe Wohnung steht in vielen Gruppen.
export class Resolver {
  private readonly cache = new Map<string, Image | null>()
  private existing: Set<string> | null = null
  private readonly db: Executor
  private readonly schema: JournalSchema
  constructor(db: Executor, schema: JournalSchema) {
    this.db = db
    this.schema = schema
  }

  async row(table: string, column: string, value: unknown, own?: Map<string, Image>): Promise<Image | null> {
    const k = imageKey(table, column, value)
    const mine = own?.get(k)
    if (mine) return mine
    if (this.cache.has(k)) return this.cache.get(k) ?? null
    const found = await this.lookup(table, column, value)
    this.cache.set(k, found)
    return found
  }

  private async lookup(table: string, column: string, value: unknown): Promise<Image | null> {
    const info = this.schema.get(table)
    if (!info || !info.columns.includes(column) || (typeof value !== 'string' && typeof value !== 'number')) return null
    const live = await this.db.get<[string]>(
      sql`SELECT ${sql.raw(`json_object(${info.columns.map((c) => `${quoteText(c)}, ${jsonValue(quoteId(c))}`).join(', ')})`)} FROM ${sql.identifier(table)} WHERE ${sql.identifier(column)} = ${value} LIMIT 1`,
    )
    if (live) return parseRow(live[0])
    // Gelöscht: die jüngste Fassung im Journal. Über den Index (table_name, row_key), wenn die Spalte
    // der ganze Schlüssel ist, sonst nicht (dann bleibt es ohne Treffer).
    if (info.key.length !== 1 || info.key[0] !== column) return null
    const logged = await this.db
      .select({ before: changeLog.before, after: changeLog.after })
      .from(changeLog)
      .where(and(eq(changeLog.tableName, table), eq(changeLog.rowKey, JSON.stringify({ [column]: value }))))
      .orderBy(desc(changeLog.id))
      .limit(1)
      .get()
    return logged ? (parseRow(logged.after) ?? parseRow(logged.before)) : null
  }

  parentsOf(table: string): TableInfo['parents'] {
    return this.schema.get(table)?.parents ?? []
  }

  async propertyExists(id: string): Promise<boolean> {
    if (!this.existing) {
      const rows = await this.db.all<[string]>(sql`SELECT id FROM properties`)
      this.existing = new Set(rows.map((r) => String(r[0])))
    }
    return this.existing.has(id)
  }

  // Die Objekte, zu denen ein Bild gehört: `property_id` der Zeile, sonst über die Fremdschlüssel.
  async propertiesOf(table: string, image: Image, own: Map<string, Image>, depth = 0): Promise<string[]> {
    if (table === 'properties') return typeof image.id === 'string' ? [image.id] : []
    if (typeof image.property_id === 'string') return [image.property_id]
    if (depth > 6) return []
    for (const parent of this.parentsOf(table)) {
      const value = image[parent.column]
      if (value === null || value === undefined) continue
      const up = await this.row(parent.table, parent.to, value, own)
      if (!up) continue
      const found = await this.propertiesOf(parent.table, up, own, depth + 1)
      if (found.length > 0) return found
    }
    return []
  }
}

const imageKey = (table: string, column: string, value: unknown) => `${table}\u0000${column}\u0000${String(value)}`

function ownImages(rows: LogRow[]): Map<string, Image> {
  const images = new Map<string, Image>()
  for (const row of rows) {
    for (const image of [parseRow(row.before), parseRow(row.after)]) {
      if (!image) continue
      for (const [column, value] of Object.entries(image)) {
        if (value !== null && typeof value !== 'object') images.set(imageKey(row.tableName, column, value), image)
      }
    }
  }
  return images
}

export type GroupProperties = { ids: string[], installationWide: boolean }

// Die Objekte einer Gruppe. Vorher- und Nachher-Bild zählen beide: Wechselt eine Wohnung das Objekt,
// steht die Gruppe bei beiden (K6). **Installationsweit** ist sie, wenn keine Zeile einem Objekt
// zuzuordnen ist (Einstellungen), wenn sie ein Objekt löscht, oder wenn ein Objekt, zu dem sie
// gehört, nicht mehr besteht (S6): Sonst stünde sie bei keinem Objekt mehr und verschwände aus dem
// Verlauf. Ist nur ein Teil nicht zuzuordnen (Einstellungen neben einer Wohnung), bleibt sie bei
// ihren Objekten.
export async function groupProperties(rows: LogRow[], resolver: Resolver): Promise<GroupProperties> {
  const own = ownImages(rows)
  const found = new Set<string>()
  let installationWide = false
  for (const row of rows) {
    if (row.tableName === 'properties' && row.op === 'delete') installationWide = true
    for (const image of [parseRow(row.before), parseRow(row.after)]) {
      if (!image) continue
      for (const id of await resolver.propertiesOf(row.tableName, image, own)) found.add(id)
    }
  }
  const ids: string[] = []
  for (const id of found) {
    if (await resolver.propertyExists(id)) ids.push(id)
    else installationWide = true
  }
  if (ids.length === 0) installationWide = true
  return { ids: ids.sort(), installationWide }
}

// ---------- Aufräumen ----------

export function journalCutoff(now: Date): string {
  const cutoff = new Date(now.getTime())
  cutoff.setUTCMonth(cutoff.getUTCMonth() - JOURNAL_KEEP_MONTHS)
  return cutoff.toISOString()
}

// Entfernt Gruppen, die älter sind als die Aufbewahrungsfrist, samt ihren Zeilen (Kaskade).
export async function pruneJournal(db: Database, now: Date): Promise<number> {
  const cutoff = journalCutoff(now)
  const old = await db.get<[number]>(sql`SELECT count(*) FROM change_groups WHERE at < ${cutoff}`)
  const count = Number(old?.[0] ?? 0)
  if (count > 0) await db.delete(changeGroups).where(lt(changeGroups.at, cutoff))
  return count
}

// ---------- Lesen (Schritt 3) ----------

export type JournalGroupView = {
  id: number
  at: string
  method: string
  route: string
  description: string
  title: string
  // Die Objekte der Gruppe; leer und `installationWide` heißt: betrifft alle (siehe groupProperties).
  propertyIds: string[]
  installationWide: boolean
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
  // Bezeichnungen der Zeilen, auf die Spalten verweisen (`unit_id` → „EG links“), soweit bekannt (K4).
  refs: Record<string, string>
}

// Womit eine Zeile im Verlauf benannt wird, je Tabelle.
const LABEL: Record<string, (row: Image) => string | null> = {
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

// Die Überschrift: Satz der Route und Bezeichnung der Zeile, um die es geht. Steht sie selbst nicht in
// der Gruppe (ein Mietverhältnis, an dem sich nur eine Staffel geändert hat), kommt sie über den
// Verweis einer Zeile darunter (K5).
export async function groupTitle(description: string, subjectTable: string | null, rows: LogRow[], resolver: Resolver): Promise<string> {
  const label = subjectTable ? LABEL[subjectTable] : undefined
  if (!label || !subjectTable) return description
  const own = ownImages(rows)
  const direct = rows.find((r) => r.tableName === subjectTable)
  let image = direct ? (parseRow(direct.after) ?? parseRow(direct.before)) : null
  if (!image) {
    for (const row of rows) {
      const child = parseRow(row.after) ?? parseRow(row.before)
      const link = resolver.parentsOf(row.tableName).find((p) => p.table === subjectTable)
      if (!child || !link) continue
      image = await resolver.row(subjectTable, link.to, child[link.column], own)
      if (image) break
    }
  }
  const name = image ? label(image) : null
  return name ? `${description}: ${name}` : description
}

const PAGE_SCAN = 200

// Die Gruppen, neueste zuerst. Mit `propertyId` die des Objekts und die installationsweiten. Gruppen,
// die nach dem Zusammenfassen nichts ändern, fehlen (S4, falls eine ältere Version sie geschrieben hat).
export async function listJournal(
  db: Executor,
  schema: JournalSchema,
  options: { propertyId: string | null, before: number | null, limit: number },
): Promise<JournalGroupView[]> {
  const resolver = new Resolver(db, schema)
  const out: JournalGroupView[] = []
  let before = options.before
  while (out.length < options.limit) {
    const groups = await db
      .select()
      .from(changeGroups)
      .where(before === null ? undefined : lt(changeGroups.id, before))
      .orderBy(desc(changeGroups.id))
      .limit(PAGE_SCAN)
      .all()
    if (groups.length === 0) break
    for (const g of groups) {
      before = g.id
      const rows = await db.select().from(changeLog).where(eq(changeLog.groupId, g.id)).orderBy(changeLog.id).all()
      const changes = collapse(rows)
      if (changes.length === 0) continue
      const props = await groupProperties(rows, resolver)
      if (options.propertyId !== null && !props.installationWide && !props.ids.includes(options.propertyId)) continue
      out.push({
        id: g.id,
        at: g.at,
        method: g.method,
        route: g.route,
        description: g.description,
        title: await groupTitle(g.description, g.subjectTable, rows, resolver),
        propertyIds: props.ids,
        installationWide: props.installationWide,
        rows: changes.length,
      })
      if (out.length >= options.limit) break
    }
    if (groups.length < PAGE_SCAN) break
  }
  return out
}

// Ersetzt die Repository-Schicht eine Unterliste (Löschen und neu Einfügen), stehen unveränderte
// Zeilen als Löschen und Einfügen mit gleichem Inhalt da. Für den Verlauf fallen sie weg, eine
// geänderte wird zur Änderung. Die gespeicherten Zeilen bleiben, wie sie sind (Schritt 4 braucht
// die wirkliche Reihenfolge).
export function collapse(rows: LogRow[]): Omit<JournalRowView, 'refs'>[] {
  const views: Omit<JournalRowView, 'refs'>[] = rows.map((r) => ({
    id: r.id,
    table: r.tableName,
    key: parseRow(r.rowKey) ?? {},
    op: r.op,
    before: parseRow(r.before),
    after: parseRow(r.after),
    changed: [],
  }))
  const out: Omit<JournalRowView, 'refs'>[] = []
  const used = new Set<number>()
  for (let i = 0; i < views.length; i++) {
    if (used.has(i)) continue
    const v = views[i]
    if (v.op === 'delete') {
      const j = views.findIndex((w, k) => k > i && !used.has(k) && w.op === 'insert' && w.table === v.table && asJson(w.key) === asJson(v.key))
      if (j >= 0) {
        used.add(j)
        const merged = { ...v, op: 'update' as const, after: views[j].after }
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

function changedColumns(before: Image | null, after: Image | null): string[] {
  const columns = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])
  return [...columns].filter((c) => asJson(before?.[c] ?? null) !== asJson(after?.[c] ?? null))
}

export async function journalGroup(db: Executor, schema: JournalSchema, id: number): Promise<(JournalGroupView & { changes: JournalRowView[] }) | null> {
  const group = await db.select().from(changeGroups).where(eq(changeGroups.id, id)).get()
  if (!group) return null
  const resolver = new Resolver(db, schema)
  const rows = await db.select().from(changeLog).where(eq(changeLog.groupId, id)).orderBy(changeLog.id).all()
  const own = ownImages(rows)
  const changes: JournalRowView[] = []
  for (const change of collapse(rows)) {
    const refs: Record<string, string> = {}
    const image = change.after ?? change.before ?? {}
    for (const parent of resolver.parentsOf(change.table)) {
      const values = [change.before?.[parent.column], change.after?.[parent.column], image[parent.column]]
      for (const value of values) {
        if (value === null || value === undefined) continue
        const up = await resolver.row(parent.table, parent.to, value, own)
        const name = up ? LABEL[parent.table]?.(up) : null
        if (name) refs[`${parent.column}=${String(value)}`] = name
      }
    }
    changes.push({ ...change, refs })
  }
  const props = await groupProperties(rows, resolver)
  return {
    id: group.id,
    at: group.at,
    method: group.method,
    route: group.route,
    description: group.description,
    title: await groupTitle(group.description, group.subjectTable, rows, resolver),
    propertyIds: props.ids,
    installationWide: props.installationWide,
    rows: changes.length,
    changes,
  }
}

// Leert das Journal in einer fremden Datei (der Schnappschuss fürs Backup ohne Verlauf).
export function clearJournal(connection: Pick<Connection, 'exec'>): void {
  connection.exec('DELETE FROM change_log')
  connection.exec('DELETE FROM change_groups')
}

// Der Transport zur Datenbank: eine SQLite-Datei, erreicht über Drizzle.
//
// Warum der Umweg über `sqlite-proxy` und nicht der eigene Treiber
// -----------------------------------------------------------------
// Drizzle bringt für SQLite mehrere Treiber mit. Zwei kämen für uns in Frage, und beide
// scheiden aus:
//
//   drizzle-orm/better-sqlite3  importiert das native Paket `better-sqlite3` fest beim Laden
//                               des Moduls, unabhängig davon, welchen Client man übergibt.
//                               Ein natives Modul lässt sich aber nicht für alle Ziele in die
//                               Bun-Programmdatei einbetten; genau daran ist schon `pdf-to-img`
//                               gescheitert (#21). Der Server kommt deshalb bewusst ohne aus.
//   drizzle-orm/node-sqlite     gibt es erst in der 1.0.0-Reihe, und die ist bis heute
//                               Vorabfassung (`latest` zeigt auf 0.45.2). Zwei Messungen haben
//                               sie ausgeschlossen: Ihr Treiber wartet den Rumpf einer
//                               Transaktion nicht ab, wodurch eine gescheiterte Transaktion
//                               festgeschrieben statt zurückgerollt wird, und ihr drizzle-kit
//                               lässt bei einem Primärschlüssel aus Text das `NOT NULL` weg,
//                               was SQLite als Erlaubnis für NULL-Kennungen liest.
//
// Bleibt `sqlite-proxy`. Er ist eigentlich für einen Dienst am anderen Ende einer Leitung
// gedacht: Drizzle baut das SQL, reicht es samt Parametern an eine Rückruffunktion, und die
// schafft es irgendwohin. Wir nutzen ihn zweckentfremdet für eine Verbindung **im selben
// Prozess** — der Rückruf geht nicht ins Netz, sondern unmittelbar an das eingebaute SQLite
// der Laufzeit. Das kostet etwas Geschwindigkeit, weil jede Anweisung einzeln durch den
// Rückruf läuft; bei einem Haus mit wenigen Wohnungen fällt das nicht ins Gewicht.
//
// Transaktionen kann er dabei wirklich, und zwar richtig: `begin`, `commit`, `rollback` gehen
// als gewöhnliche Anweisungen durch denselben Rückruf auf dieselbe Verbindung, verschachtelte
// Transaktionen über Sicherungspunkte. Anders als beim Treiber der Vorabfassung wird der Rumpf
// dabei abgewartet, ein `async`-Rumpf verhält sich also wie erwartet. Das ist der Grund für
// den ganzen Umbau, deshalb steht es hier und nicht nur im Bericht.
//
// Wenn die stabile 1.0 kommt
// ---------------------------
// Dann tauscht man `drizzle-orm/sqlite-proxy` gegen `drizzle-orm/node-sqlite` beziehungsweise
// `drizzle-orm/bun-sqlite` und wirft den Rückruf weg. Betroffen ist **nur diese Datei**.
// Schema, Migrationen und die Ablage darüber überleben den Tausch unverändert, weil sie schon
// die stabile Form haben: Das erzeugte SQL ist gewöhnliches DDL für SQLite, und die
// Buchführung in `server/drizzle/` liegt im Format der stabilen drizzle-kit-Reihe. Vorher aber
// nachmessen, ob die beiden oben genannten Mängel behoben sind; die Tests in
// `server/test/schema.test.ts` halten den zweiten fest.
//
// Node und Bun
// -------------
// Die Unterscheidung gehört hierher und an keine andere Stelle. Beide Laufzeiten bringen
// SQLite selbst mit, nur unter verschiedenen Namen und mit verschiedenen Methoden für
// „Zeilen als Werteliste". Erkannt wird Bun an `globalThis.Bun`, wie überall sonst im Projekt.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import type { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy'
import * as schema from './schema.ts'

export type Database = SqliteRemoteDatabase<typeof schema>

// Was SQLite als Parameter annimmt. Alles andere ist ein Programmierfehler und soll auffallen,
// statt als `undefined` still zu einer leeren Zelle zu werden.
type SqlValue = null | number | bigint | string | Uint8Array

function toSqlValue(value: unknown): SqlValue {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'string') return value
  if (value instanceof Uint8Array) return value
  // Drizzle wandelt Wahrheitswerte eigentlich selbst in 0 und 1; hier steht es als Netz, damit
  // eine künftige Spalte nicht still an SQLite scheitert.
  if (typeof value === 'boolean') return value ? 1 : 0
  throw new Error(`Dieser Wert lässt sich nicht an SQLite übergeben: ${typeof value}`)
}

// Die schmale Sicht auf das eingebaute SQLite, die beide Laufzeiten erfüllen müssen.
type Handle = {
  // Zeilen als Wertelisten (nicht als Objekte): genau das erwartet der Rückruf von sqlite-proxy.
  rows: (sql: string, params: SqlValue[]) => unknown[][]
  run: (sql: string, params: SqlValue[]) => void
  exec: (sql: string) => void
  close: () => void
}

async function openNode(file: string): Promise<Handle> {
  const { DatabaseSync } = await import('node:sqlite')
  const handle = new DatabaseSync(file)
  return {
    rows: (sql, params) => {
      const stmt = handle.prepare(sql)
      // Ohne dies liefert node:sqlite Objekte; sqlite-proxy will Wertelisten.
      stmt.setReturnArrays(true)
      const result = stmt.all(...params)
      // `all()` gibt `unknown[]`; mit setReturnArrays(true) ist jede Zeile eine Werteliste.
      return result.map((row) => (Array.isArray(row) ? row : [row]))
    },
    run: (sql, params) => {
      handle.prepare(sql).run(...params)
    },
    exec: (sql) => handle.exec(sql),
    close: () => handle.close(),
  }
}

async function openBun(file: string): Promise<Handle> {
  const { Database } = await import('bun:sqlite')
  const handle = new Database(file)
  return {
    // Bun hat dafür `values()`, das Zeilen von sich aus als Wertelisten liefert.
    rows: (sql, params) => handle.query(sql).values(...params),
    run: (sql, params) => {
      handle.query(sql).run(...params)
    },
    exec: (sql) => handle.exec(sql),
    close: () => handle.close(),
  }
}

export type Connection = {
  db: Database
  // Roher Zugang für Dinge, die an Drizzle vorbeigehen: das Anwenden der Migrationen und die
  // Prüfungen beim Start (Aufgabe 3). Beides arbeitet mit SQL, das es zur Übersetzungszeit noch
  // gar nicht gibt, und hat deshalb vom Schema nichts.
  exec: (sql: string) => void
  rows: (sql: string) => unknown[][]
  close: () => void
}

// Öffnet die Datenbankdatei und legt Drizzle darüber.
//
// Hier steht bewusst nur das Nötigste. Wo die Datei liegt, was beim Start geprüft wird, was
// passiert, wenn sie fehlt oder von einer neueren Version stammt, und wann die Migrationen
// laufen: Das ist Aufgabe 3 und gehört nicht in den Transport.
export async function connect(file: string): Promise<Connection> {
  const handle = globalThis.Bun ? await openBun(file) : await openNode(file)

  // Ohne diese Zeile prüft SQLite Fremdschlüssel überhaupt nicht: Die Voreinstellung ist aus,
  // und sie gilt je Verbindung. Alle `references()` im Schema wären sonst Dekoration, und das
  // Löschen einer Wohnung ließe verwaiste Mietverhältnisse zurück, ohne dass etwas auffiele.
  handle.exec('PRAGMA foreign_keys = ON')

  const db = drizzle(
    async (sql, params, method) => {
      const values = params.map(toSqlValue)
      if (method === 'run') {
        handle.run(sql, values)
        return { rows: [] }
      }
      const rows = handle.rows(sql, values)
      // Bei `get` erwartet sqlite-proxy die eine Zeile selbst, nicht eine Liste von Zeilen.
      // Gibt es keine, muss `undefined` heraus: Eine leere Liste wäre für Drizzle eine
      // vorhandene Zeile ohne Spalten, und `.get()` lieferte ein Objekt voller `undefined`
      // statt gar nichts.
      return { rows: method === 'get' ? rows[0] : rows }
    },
    { schema },
  )

  return { db, exec: handle.exec, rows: (sql) => handle.rows(sql, []), close: handle.close }
}

// ---------- Migrationen ----------

export type Migration = {
  tag: string
  hash: string
  folderMillis: number
  statements: string[]
}

// Trennt die Anweisungen einer Migration. drizzle-kit schreibt diese Marke selbst zwischen sie,
// weil SQLite je Aufruf nur eine Anweisung ausführt.
const BREAKPOINT = '--> statement-breakpoint'

// Zeilenenden vereinheitlichen, bevor irgendetwas mit dem SQL geschieht.
//
// Das ist keine Kosmetik. Git kann Textdateien beim Auschecken auf CRLF umstellen
// (`core.autocrlf=true` ist unter Windows die Voreinstellung), und dann hätte dieselbe
// Migration je nach Rechner einen anderen Inhalt. Ihre Marke wäre damit eine andere, der Test
// „ein bereits veröffentlichter Schritt ist unverändert" schlüge unter Windows fehl und unter
// Linux nicht, und das eingebettete Modul sähe je nach Bau-Rechner anders aus. Eine Marke, die
// vom Rechner abhängt, taugt aber nicht als Marke.
const normalize = (sql: string): string => sql.replace(/\r\n/g, '\n')

export function splitStatements(sql: string): string[] {
  return normalize(sql)
    .split(BREAKPOINT)
    .map((s) => s.trim())
    .filter(Boolean)
}

export const hashOf = (sql: string): string => crypto.createHash('sha256').update(normalize(sql)).digest('hex')

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle')

// Die Migrationen von der Platte lesen, wie sie im npm-Betrieb und im Docker-Image vorliegen.
// Maßgeblich für die Reihenfolge ist das Journal und nicht die Sortierung der Dateinamen.
function migrationsFromDisk(): Migration[] {
  const journal = JSON.parse(fs.readFileSync(path.join(migrationsDir, 'meta', '_journal.json'), 'utf8'))
  return (journal.entries ?? []).map((entry: { tag: string; when: number }) => {
    const sql = fs.readFileSync(path.join(migrationsDir, `${entry.tag}.sql`), 'utf8')
    return { tag: entry.tag, hash: hashOf(sql), folderMillis: entry.when, statements: splitStatements(sql) }
  })
}

// Woher die Migrationen kommen, ist die zweite Stelle, an der sich Node und Bun unterscheiden,
// und sie steht deshalb ebenfalls hier. In der Programmdatei gibt es kein Dateisystem mit
// Projektdateien, dort kommen sie aus dem eingebetteten Modul (siehe
// scripts/embed-migrations.mjs). Dass beide Wege dasselbe ergeben, hält ein Test in
// server/test/migrations.test.ts fest.
export async function loadMigrations(): Promise<Migration[]> {
  if (globalThis.Bun) {
    const { migrations } = await import('./embedded-migrations.js')
    return migrations
  }
  return migrationsFromDisk()
}

// Buchführung darüber, was schon gelaufen ist. Name und Spalten sind bewusst die, die Drizzles
// eigener Migrator anlegt: Sollten wir später auf ihn umstellen, findet er seine Tabelle vor,
// statt neben ihr eine zweite zu beginnen.
const BOOKKEEPING = `CREATE TABLE IF NOT EXISTS __drizzle_migrations (
  id integer PRIMARY KEY AUTOINCREMENT,
  hash text NOT NULL,
  created_at numeric
)`

// Wendet an, was noch fehlt, und gibt zurück, wie viele Schritte das waren.
//
// Jeder Schritt läuft ganz oder gar nicht: Seine Anweisungen und der Eintrag in die Buchführung
// stehen zusammen in einer Transaktion. Bricht einer ab, bleibt die Datenbank auf dem Stand des
// vorigen Schrittes, und der nächste Start versucht denselben erneut. Ein halb angewendetes
// Schema, bei dem die Hälfte der Tabellen fehlt und trotzdem alles als erledigt gilt, kann so
// nicht entstehen.
//
// Wann das beim Start geschieht, was der Nutzer dabei zu sehen bekommt und ob vorher eine
// Sicherung angelegt wird, entscheidet Aufgabe 3. Hier steht nur, wie ein Schritt in die
// Datenbank kommt.
export function applyMigrations(connection: Connection, migrations: Migration[]): number {
  connection.exec(BOOKKEEPING)
  const done = new Set(
    connection.rows('SELECT hash FROM __drizzle_migrations').map((row) => String(row[0])),
  )
  let applied = 0
  for (const migration of migrations) {
    if (done.has(migration.hash)) continue
    connection.exec('BEGIN')
    try {
      for (const statement of migration.statements) connection.exec(statement)
      connection.exec(
        `INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('${migration.hash}', ${migration.folderMillis})`,
      )
      connection.exec('COMMIT')
    } catch (err) {
      connection.exec('ROLLBACK')
      throw new Error(`Die Migration ${migration.tag} ließ sich nicht anwenden: ${String(err)}`, { cause: err })
    }
    applied++
  }
  return applied
}

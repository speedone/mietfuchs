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
// Prozess**. Der Rückruf geht nicht ins Netz, sondern unmittelbar an das eingebaute SQLite
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

// Was SQLite als Parameter annimmt. Alles andere ist ein Programmierfehler und soll mit einer
// Meldung auffallen, statt still zu einer leeren Zelle zu werden.
type SqlValue = null | number | bigint | string | Uint8Array

// Ausgeführt wird sie nur vom Rückruf unten; ausgeführt **geprüft** wird sie im Test, deshalb
// steht `export` davor.
export function toSqlValue(value: unknown): SqlValue {
  if (value === null) return null
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'string') return value
  if (value instanceof Uint8Array) return value
  // Drizzle wandelt Wahrheitswerte eigentlich selbst in 0 und 1; hier steht es als Netz, damit
  // eine künftige Spalte nicht still an SQLite scheitert.
  if (typeof value === 'boolean') return value ? 1 : 0
  // `undefined` bekommt ausdrücklich **kein** NULL. In SQL bedeutet NULL „kein Wert", in
  // JavaScript bedeutet `undefined` meist „hier fehlt etwas, das dastehen sollte", etwa eine
  // Kennung, die der Aufrufer nicht gesetzt hat. Würde daraus stillschweigend NULL, liefe ein
  // Vergleich wie `eq(units.id, undefined)` auf `= NULL` hinaus, das in SQL nie wahr ist: Die
  // Abfrage käme leer zurück, und niemand erführe, warum. `node:sqlite` wirft an dieser Stelle
  // von sich aus; diese Meldung sagt zusätzlich, was zu tun ist.
  if (value === undefined) {
    throw new Error(
      'An die Datenbank wurde `undefined` übergeben. Gemeint ist vermutlich `null` (ausdrücklich kein Wert); ' +
        'ein `undefined` an dieser Stelle ist fast immer eine Kennung oder ein Feld, das vorher nicht gesetzt wurde.',
    )
  }
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

  // Fremdschlüssel gelten je Verbindung und müssen ausdrücklich eingeschaltet sein; SQLite
  // selbst liefert sie aus Rücksicht auf alte Datenbestände abgeschaltet aus, und `bun:sqlite`
  // reicht diese Voreinstellung durch. `node:sqlite` schaltet sie von sich aus ein
  // (`enableForeignKeyConstraints`, Voreinstellung `true`), dort ist die Zeile also nur eine
  // Bestätigung. Sie steht trotzdem für beide da: So hängt die Zusicherung an einer sichtbaren
  // Zeile und nicht an der Voreinstellung einer Laufzeit, die sich ändern kann. Ohne sie wären
  // alle `references()` im Schema Dekoration, und das Löschen einer Wohnung ließe verwaiste
  // Mietverhältnisse zurück, ohne dass etwas auffiele.
  //
  // `applyMigrations` schaltet sie vorübergehend ab und hier wieder an; die Begründung dafür
  // steht dort.
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

// Das Journal lesen und dabei wirklich prüfen, was dasteht.
//
// `JSON.parse` liefert `any`, und ein `any` nimmt jede Behauptung widerspruchslos an: Ein
// Tippfehler im Feldnamen oder eine Zeichenkette statt einer Zahl käme ungehindert durch, und
// der Fehler zeigte sich erst weit später als etwas ganz anderes. Das Bau-Skript
// (scripts/embed-migrations.mjs) prüft an denselben Stellen und sagt, was fehlt. Dieser Weg
// hier ist der, den ein Vermieter tatsächlich geht, und darf deshalb nicht weniger können.
//
// Verengt wird ausschließlich mit `typeof` und `in`, die der Übersetzer selbst nachrechnet;
// ein angeschriebenes Typprädikat wäre wieder nur eine Behauptung.
type JournalEntry = { tag: string; when: number }

// Getrennt vom Lesen der Datei, damit der Test ihr unmittelbar kaputte Gestalten vorlegen kann,
// ohne dafür Dateien anzulegen.
export function parseJournal(raw: unknown, file: string): JournalEntry[] {
  if (typeof raw !== 'object' || raw === null || !('entries' in raw)) {
    throw new Error(`Die Buchführung der Migrationen (${file}) hat kein Feld „entries". Das kann nicht stimmen.`)
  }
  const entries = raw.entries
  if (!Array.isArray(entries)) {
    throw new Error(`Das Feld „entries" in ${file} ist keine Liste.`)
  }
  if (entries.length === 0) {
    throw new Error(`Die Buchführung in ${file} führt keinen einzigen Migrationsschritt. Das kann nicht stimmen.`)
  }
  return entries.map((entry: unknown, index: number) => {
    const wo = `Der ${index + 1}. Eintrag in ${file}`
    if (typeof entry !== 'object' || entry === null || !('tag' in entry) || !('when' in entry)) {
      throw new Error(`${wo} braucht die Felder „tag" und „when".`)
    }
    const { tag, when } = entry
    if (typeof tag !== 'string' || tag === '') {
      throw new Error(`${wo} hat kein brauchbares „tag" (den Namen des Schrittes).`)
    }
    if (typeof when !== 'number' || !Number.isFinite(when)) {
      throw new Error(`${wo} („${tag}") hat kein brauchbares „when" (den Zeitpunkt, der die Reihenfolge bestimmt).`)
    }
    return { tag, when }
  })
}

function readJournal(file: string): JournalEntry[] {
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    throw new Error(`Die Buchführung der Migrationen (${file}) ließ sich nicht lesen: ${String(err)}`, { cause: err })
  }
  return parseJournal(raw, file)
}

// Die Migrationen von der Platte lesen, wie sie im npm-Betrieb und im Docker-Image vorliegen.
// Maßgeblich für die Reihenfolge ist das Journal und nicht die Sortierung der Dateinamen.
function migrationsFromDisk(): Migration[] {
  const journalFile = path.join(migrationsDir, 'meta', '_journal.json')
  if (!fs.existsSync(journalFile)) {
    throw new Error(
      `Die Migrationen fehlen: ${journalFile} gibt es nicht. Ohne sie lässt sich die Datenbank nicht anlegen.`,
    )
  }
  return readJournal(journalFile).map((entry) => {
    const file = path.join(migrationsDir, `${entry.tag}.sql`)
    if (!fs.existsSync(file)) {
      throw new Error(`Die Buchführung nennt den Schritt „${entry.tag}", aber die Datei ${file} fehlt.`)
    }
    const sql = fs.readFileSync(file, 'utf8')
    const statements = splitStatements(sql)
    if (statements.length === 0) {
      throw new Error(`Der Migrationsschritt „${entry.tag}" enthält keine einzige Anweisung.`)
    }
    return { tag: entry.tag, hash: hashOf(sql), folderMillis: entry.when, statements }
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

// Buchführung darüber, was schon gelaufen ist. Name und Spalten sind die, die Drizzles eigener
// Migrator anlegt: Sollten wir später auf ihn umstellen, findet er seine Tabelle vor, statt
// neben ihr eine zweite zu beginnen.
//
// Eine Abweichung gibt es, und sie ist unschädlich: Drizzle schreibt dort `id SERIAL PRIMARY
// KEY`, hier steht `id integer PRIMARY KEY AUTOINCREMENT`. `SERIAL` kennt SQLite gar nicht; es
// nimmt jeden unbekannten Typnamen an und gibt der Spalte die Affinität NUMERIC. Gelesen wird
// die Spalte von niemandem, weder von Drizzle noch von uns, beide fragen nur `hash` und
// `created_at` ab. Beide Schreibweisen ergeben eine brauchbare Kennung, und weil die Tabelle
// mit `IF NOT EXISTS` angelegt wird, baut Drizzle sie später ohnehin nicht um.
const BOOKKEEPING = `CREATE TABLE IF NOT EXISTS __drizzle_migrations (
  id integer PRIMARY KEY AUTOINCREMENT,
  hash text NOT NULL,
  created_at numeric
)`

// Wendet an, was noch fehlt, und gibt zurück, wie viele Schritte das waren.
//
// Jeder Schritt läuft ganz oder gar nicht: Seine Anweisungen, der Eintrag in die Buchführung und
// die abschließende Prüfung stehen zusammen in einer Transaktion. Bricht einer ab, bleibt die
// Datenbank auf dem Stand des vorigen Schrittes, und der nächste Start versucht denselben
// erneut. Ein halb angewendetes Schema, bei dem Tabellen fehlen und trotzdem alles als erledigt
// gilt, kann so nicht entstehen.
//
// **Warum die Fremdschlüsselprüfung außerhalb der Transaktion abgeschaltet wird**
//
// SQLite kann eine Spalte oder eine Prüfbedingung nicht an Ort und Stelle ändern. drizzle-kit
// baut die Tabelle dafür neu: neue anlegen, Daten hinüberkopieren, alte löschen, neue
// umbenennen. Damit das Löschen nicht die Kinder mitreißt, schreibt es
// `PRAGMA foreign_keys=OFF` an den Anfang der Migration. Genau das betrifft **jede** spätere
// Änderung an einer Spalte oder einer Bedingung; unsere erste Migration legt nur an und ist
// deshalb noch nicht betroffen.
//
// Nur: Dieses Pragma ist laut SQLite-Dokumentation „a no-op within a transaction; foreign key
// constraint enforcement may only be enabled or disabled when there is no pending BEGIN or
// SAVEPOINT". Stünde die Migration also samt ihrem Pragma in BEGIN/COMMIT, wäre die Prüfung gar
// nicht abgeschaltet. Das `DROP TABLE` kaskadierte, und das COMMIT meldete Erfolg: Der Nutzer
// verlöre Mietverhältnisse, Zähler und Zahlungen, ohne dass irgendwo etwas stünde. Das ist der
// schlimmste Ausgang, den dieses Modul haben kann, denn er sieht wie ein geglücktes Update aus.
//
// `PRAGMA defer_foreign_keys = ON` hilft dagegen nicht: Es verschiebt die *Prüfung* ans Ende der
// Transaktion, aber `ON DELETE CASCADE` ist keine Prüfung, sondern eine Handlung, und die
// geschieht trotzdem.
//
// Deshalb hier das Verfahren, das SQLite selbst für Schemaänderungen vorschreibt
// (lang_altertable.html, „Making Other Kinds Of Table Schema Changes"): abschalten **vor** der
// Transaktion, am Ende und noch **innerhalb** der Transaktion `PRAGMA foreign_key_check`
// fragen, und erst danach wieder einschalten. Weil die Prüfung eine gewöhnliche Abfrage ist und
// kein Pragma, wirkt sie in der Transaktion; ein kaputter Verweis führt also zum Rückrollen und
// nicht zu einem Fehler nach dem Festschreiben.
//
// **Achtung, wenn wir später auf Drizzles eigenen Migrator wechseln:** Der macht denselben
// Fehler, er reicht alle Anweisungen als einen Block in eine Transaktion. Ein Wechsel auf ihn
// löst das hier also nicht, sondern bringt es zurück. Diese Behebung darf dabei nicht
// verschwinden.
export function applyMigrations(connection: Connection, migrations: Migration[]): number {
  connection.exec(BOOKKEEPING)
  const done = new Set(connection.rows('SELECT hash FROM __drizzle_migrations').map((row) => String(row[0])))
  const pending = migrations.filter((m) => !done.has(m.hash))
  if (pending.length === 0) return 0

  // Schritt 1 des Verfahrens: abschalten, solange keine Transaktion offen ist. Nur dann wirkt es.
  connection.exec('PRAGMA foreign_keys = OFF')
  try {
    for (const migration of pending) {
      connection.exec('BEGIN')
      try {
        for (const statement of migration.statements) connection.exec(statement)
        connection.exec(
          `INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('${migration.hash}', ${migration.folderMillis})`,
        )
        // Schritt 10: noch innerhalb der Transaktion, damit ein kaputter Verweis diesen Schritt
        // zurückrollt, statt festgeschrieben zu werden.
        const violations = connection.rows('PRAGMA foreign_key_check')
        if (violations.length > 0) {
          const betroffen = violations.slice(0, 5).map((row) => `${String(row[0])} (Zeile ${String(row[1])} verweist auf ${String(row[2])})`)
          throw new Error(
            `Nach diesem Schritt zeigen ${violations.length} Fremdschlüssel ins Leere: ${betroffen.join(', ')}` +
              (violations.length > 5 ? ' und weitere' : ''),
          )
        }
        connection.exec('COMMIT')
      } catch (err) {
        connection.exec('ROLLBACK')
        throw new Error(`Die Migration ${migration.tag} ließ sich nicht anwenden: ${String(err)}`, { cause: err })
      }
    }
  } finally {
    // Schritt 12, und zwar auch dann, wenn oben etwas schiefging: Sonst liefe der Server mit
    // abgeschalteter Fremdschlüsselprüfung weiter, und alle `references()` im Schema wären für
    // den Rest der Sitzung Dekoration.
    connection.exec('PRAGMA foreign_keys = ON')
  }
  return pending.length
}

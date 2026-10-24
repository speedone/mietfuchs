// Welche Zeilen auf Dateien verweisen (#318, Durchsicht von PR #439, M1). Eine Stelle für den Rücksprung (welche Datei
// kommt zurück, welche in den Papierkorb), für das Aufräumen des Papierkorbs (was der Bestand oder das Journal nennt,
// bleibt) und für den Abgleich beim Start und nach dem Einspielen. Ein Wächter in trash.test.ts verlangt jede Spalte des
// Schemas, deren Name eine Datei nennt, hier.
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { Executor } from './client.ts'
import { changeLog } from './schema.ts'
import { existsIn, filesIn, moveToTrash, restoreFromTrash, storeDir, trashDir, type FileStore } from '../trash.ts'

export const FILE_COLUMNS: Readonly<Record<FileStore, Readonly<Record<string, readonly string[]>>>> = {
  uploads: {
    uploads: ['file'],
    cost_items: ['invoice_file'],
    assessments: ['file'],
  },
  briefpapier: {
    letter_design: ['logo_file', 'paper_file', 'paper_next_file'],
    property_letter_designs: ['logo_file', 'paper_file', 'paper_next_file'],
  },
}

const stores = () => Object.entries(FILE_COLUMNS) as [FileStore, Readonly<Record<string, readonly string[]>>][]

type Image = Record<string, unknown>
const parseImage = (text: string | null): Image | null => {
  if (text === null) return null
  const value: unknown = JSON.parse(text)
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Image) : null
}

// Die Dateien, die der Bestand nennt, je Ablage.
export async function referencedFiles(db: Executor): Promise<Map<FileStore, Set<string>>> {
  const out = new Map<FileStore, Set<string>>()
  for (const [store, tables] of stores()) {
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

// Die Dateien, die das Journal nennt: Ein Rücksprung kann sie noch brauchen.
export async function filesNamedInJournal(db: Executor): Promise<Map<FileStore, Set<string>>> {
  const out = new Map<FileStore, Set<string>>()
  for (const [store, tables] of stores()) {
    const names = new Set<string>()
    const rows = await db.select({ table: changeLog.tableName, before: changeLog.before, after: changeLog.after }).from(changeLog).where(inArray(changeLog.tableName, Object.keys(tables))).all()
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

// Was im Papierkorb bleibt: alles, was der Bestand oder das Journal nennt (M1 a). Eine Datei, auf die eine eingespielte
// Vorversion verweist, geht so nie verloren, auch wenn der Verlauf sie nicht mehr kennt.
export async function trashKeep(db: Executor): Promise<Map<FileStore, Set<string>>> {
  const keep = await filesNamedInJournal(db)
  for (const [store, names] of await referencedFiles(db)) {
    const set = keep.get(store) ?? new Set<string>()
    for (const n of names) set.add(n)
    keep.set(store, set)
  }
  return keep
}

// Ob ein Beleg zuletzt gelöscht wurde: Die jüngste Zeile des Journals zu seiner Zeile in `uploads` ist ein Löschen.
async function lastUploadDeleted(db: Executor, file: string): Promise<boolean> {
  const row = await db.select({ op: changeLog.op }).from(changeLog)
    .where(and(eq(changeLog.tableName, 'uploads'), eq(changeLog.rowKey, JSON.stringify({ file }))))
    .orderBy(desc(changeLog.id)).limit(1).get()
  return row?.op === 'delete'
}

// Der Abgleich von Belegordner, Ordner für Briefpapier und Papierkorb mit dem Bestand (M1 b, K1), beim Start und nach
// dem Einspielen einer Sicherung. **Er löscht nie**, er verschiebt nur:
// - Eine Datei, die der Bestand nennt und die nur im Papierkorb liegt, kommt zurück.
// - Ein Beleg im Belegordner, den der Bestand nicht nennt und den das Journal zuletzt gelöscht hat, wandert in den
//   Papierkorb (das Verschieben nach dem Festschreiben war gescheitert). Ein Beleg ohne Zeile, den das Journal nicht
//   so kennt, bleibt: Er ist eine Datei des Nutzers.
// - Ein Logo oder Briefpapier, das keine Gestaltung nennt, das Journal aber kennt, wandert in den Papierkorb (wie
//   `removeUnreferenced`). Eine Datei, die das Journal nie gesehen hat, bleibt.
// Liefert Sätze für die Antwort; ein Fehler bei einer Datei steht auf der Konsole und hält die übrigen nicht auf.
export async function reconcileFiles(db: Executor, dataDir: string): Promise<string[]> {
  const referenced = await referencedFiles(db)
  const journal = await filesNamedInJournal(db)
  let restored = 0
  let trashed = 0
  for (const [store] of stores()) {
    const named = referenced.get(store) ?? new Set<string>()
    for (const name of named) {
      if (existsIn(storeDir(dataDir, store), name) || !existsIn(trashDir(dataDir, store), name)) continue
      try {
        await restoreFromTrash(dataDir, store, name)
        restored++
      } catch (err) {
        console.error(`Die Datei ${name} ließ sich nicht aus dem Papierkorb zurückholen: ${String(err)}`)
      }
    }
    for (const name of filesIn(storeDir(dataDir, store))) {
      if (named.has(name) || !journal.get(store)?.has(name)) continue
      if (store === 'uploads' && !(await lastUploadDeleted(db, name))) continue
      try {
        await moveToTrash(dataDir, store, name)
        trashed++
      } catch (err) {
        console.error(`Die Datei ${name} ließ sich nicht in den Papierkorb legen: ${String(err)}`)
      }
    }
  }
  const notes: string[] = []
  if (restored > 0) notes.push(restored === 1 ? 'Ein Beleg oder Logo, auf das der Stand verweist, kam aus dem Papierkorb zurück.' : `${restored} Belege oder Logos, auf die der Stand verweist, kamen aus dem Papierkorb zurück.`)
  if (trashed > 0) notes.push(trashed === 1 ? 'Ein Beleg oder Logo, auf das der Stand nicht mehr verweist, liegt jetzt im Papierkorb.' : `${trashed} Belege oder Logos, auf die der Stand nicht mehr verweist, liegen jetzt im Papierkorb.`)
  return notes
}

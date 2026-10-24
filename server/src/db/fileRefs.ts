// Welche Zeilen auf Dateien verweisen (#318, Durchsicht von PR #439, M1). Eine Stelle für den Rücksprung (welche Datei
// kommt zurück, welche in den Papierkorb), für das Aufräumen des Papierkorbs (was der Bestand oder das Journal nennt,
// bleibt) und für den Abgleich beim Start und nach dem Einspielen. Ein Wächter in trash.test.ts verlangt jede Spalte des
// Schemas, deren Name eine Datei nennt, hier.
import { inArray, sql } from 'drizzle-orm'
import type { Executor } from './client.ts'
import { changeLog } from './schema.ts'
import { existsIn, restoreFromTrash, storeDir, trashDir, type FileStore } from '../trash.ts'

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

// Der Abgleich von Belegordner, Ordner für Briefpapier und Papierkorb mit dem Bestand (M1 b), beim Start und nach dem
// Einspielen einer Sicherung: Eine Datei, die der Bestand nennt und die nur im Papierkorb liegt, kommt zurück. **Er legt
// nie etwas in den Papierkorb** (Gegenprüfung von PR #439): Ein Beleg im Belegordner ohne Zeile ist harmlos, und er kann
// einer sein, den der Vermieter von Hand aus dem Papierkorb zurückgeholt hat. Scheitert nach einem Rücksprung das
// Verschieben in den Papierkorb, bleibt der Beleg deshalb im Belegordner liegen; das steht auf der Konsole. Zurückgeholt
// wird ohne Überschreiben (`restoreFromTrash`). Liefert Sätze für die Antwort; ein Fehler bei einer Datei steht auf der
// Konsole und hält die übrigen nicht auf.
export async function reconcileFiles(db: Executor, dataDir: string): Promise<string[]> {
  const referenced = await referencedFiles(db)
  let restored = 0
  const refused: string[] = []
  for (const [store] of stores()) {
    for (const name of referenced.get(store) ?? []) {
      if (existsIn(storeDir(dataDir, store), name) || !existsIn(trashDir(dataDir, store), name)) continue
      try {
        await restoreFromTrash(dataDir, store, name)
        restored++
      } catch (err) {
        refused.push(name)
        console.error(`Die Datei ${name} ließ sich nicht aus dem Papierkorb zurückholen: ${String(err)}`)
      }
    }
  }
  const notes: string[] = []
  if (restored > 0) notes.push(restored === 1 ? 'Ein Beleg oder Logo, auf das der Stand verweist, kam aus dem Papierkorb zurück.' : `${restored} Belege oder Logos, auf die der Stand verweist, kamen aus dem Papierkorb zurück.`)
  if (refused.length > 0) notes.push(`Aus dem Papierkorb ließ sich nicht zurückholen: ${refused.map((n) => `„${n}“`).join(', ')}. Die Datei liegt dort weiter; legen Sie sie bei Bedarf selbst in den Belegordner.`)
  return notes
}

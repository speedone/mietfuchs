// Die Angaben zu Belegen in der Datenbank (#170), Tabelle `uploads` in schema.ts.
//
// Die Datei auf der Platte ist der Beleg; die Zeile hier ist eine Beschreibung dazu und darf
// fehlen (siehe schema.ts). Deshalb nimmt jede Funktion, die eine Zeile braucht, einen Rückfall
// aus der Datei entgegen, statt eine fehlende Zeile als Fehler zu behandeln.
import { eq } from 'drizzle-orm'
import type { UploadInfo } from '../../../shared/types.ts'
import type { Database } from './client.ts'
import { uploads } from './schema.ts'

export type UploadRow = typeof uploads.$inferSelect

export async function uploadRows(db: Database): Promise<Map<string, UploadRow>> {
  const rows = await db.select().from(uploads)
  return new Map(rows.map((r) => [r.file, r]))
}

// Legt die Zeile zu einem eben hochgeladenen Beleg an. Gibt es zu dem Namen schon eine (eine
// Datei gleichen Namens, die vorher gelöscht wurde, ohne dass ihre Zeile mitging), wird sie
// ersetzt: Die Zeile beschreibt die Datei, die jetzt dort liegt.
export async function recordUpload(db: Database, row: UploadRow): Promise<void> {
  await db.insert(uploads).values(row).onConflictDoUpdate({ target: uploads.file, set: { ...row } })
}

// Die Zeile eines Belegs, der noch keine hat (Nachtragen der Prüfsumme). Eine schon vorhandene
// bleibt unberührt: Sie kann inzwischen Objekt, Jahr oder Rechnungsdatum tragen.
export async function recordIfMissing(db: Database, row: UploadRow): Promise<void> {
  await db.insert(uploads).values(row).onConflictDoNothing({ target: uploads.file })
}

export type Placement = Partial<Pick<UploadRow, 'propertyId' | 'year' | 'invoiceDate' | 'kind'>>

// Ändert Objekt, Jahr oder Rechnungsdatum. Fehlt die Zeile, entsteht sie aus dem Rückfall, also
// aus dem, was die Datei selbst hergibt. Verschmolzen wird nach Anwesenheit eines Schlüssels,
// wie bei den übrigen Routen (repository.ts): `{ year: null }` leert das Jahr, ein fehlendes
// `year` lässt es stehen.
export async function placeUpload(db: Database, file: string, changes: Placement, fallback: () => UploadInfo | null): Promise<UploadRow | null> {
  const [current] = await db.select().from(uploads).where(eq(uploads.file, file))
  const described = current ? null : fallback()
  const base: UploadRow | null = current ?? (described ? rowOf(described) : null)
  if (!base) return null
  const next: UploadRow = { ...base, ...changes }
  await recordUpload(db, next)
  return next
}

export async function forgetUpload(db: Database, file: string): Promise<void> {
  await db.delete(uploads).where(eq(uploads.file, file))
}

export function rowOf(info: UploadInfo): UploadRow {
  const { mtime: _mtime, ...row } = info
  return row
}

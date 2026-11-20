// Die Tabelle `rent_increases` lesen und schreiben (#191, PR 3). Nur Zeilen: Regeln, Marken und die Übernahme in die
// Staffel stehen in ../rentIncreaseSave.ts, die Routen in index.ts. `basis` ist eingefrorenes JSON wie ein Abschluss
// (db/CLAUDE.md, „JSON bleibt nur der eingefrorene Abschluss“, hier ebenso begründet): Nachdruck und Prüfung lesen es so,
// wie es beim Speichern galt, auch wenn eine spätere Version anders rechnet.
import { eq, inArray, sql } from 'drizzle-orm'
import type { Executor } from './client.ts'
import { rentIncreases } from './schema.ts'
import type { RentIncrease, RentIncreaseBasis } from '../../../shared/types.ts'

type Row = typeof rentIncreases.$inferSelect

function fromRow(r: Row): RentIncrease {
  // Geschrieben wird `basis` nur über `toRow` aus dem Typ; die Bedingung der Tabelle sichert, dass es ein Objekt ist. Die
  // Gestalt prüft hier niemand, damit Liste, Verlauf und Backup auch eine Grundlage aus einer anderen Fassung tragen
  // (Durchsicht K1): Wer sie liest (Schreiben, Versand, Antwort), prüft vorher `rentIncreaseBasisProblem`
  // (shared/rentIncreaseLetter.ts) und nennt dessen Satz statt abzustürzen.
  const basis = JSON.parse(r.basis) as RentIncreaseBasis
  return {
    id: r.id,
    tenancyId: r.tenancyId,
    kind: r.kind,
    createdOn: r.createdOn,
    receivedOn: r.receivedOn,
    effectiveFrom: r.effectiveFrom,
    fromCents: r.fromCents,
    toCents: r.toCents,
    basis,
    status: r.status,
    agreedCents: r.agreedCents,
    decidedOn: r.decidedOn,
  }
}

const toRow = (x: RentIncrease): Row => ({ ...x, basis: JSON.stringify(x.basis) })

// Die Verlangen eines Mietverhältnisses in der Reihenfolge des Anlegens.
export async function readRentIncreases(db: Executor, tenancyId: string): Promise<RentIncrease[]> {
  const rows = await db.select().from(rentIncreases).where(eq(rentIncreases.tenancyId, tenancyId)).orderBy(sql`rowid`)
  return rows.map(fromRow)
}

// Die Verlangen mehrerer Mietverhältnisse (eines Objekts) in einer Abfrage, für „Demnächst fällig“ (PR 4).
export async function readRentIncreasesOf(db: Executor, tenancyIds: readonly string[]): Promise<RentIncrease[]> {
  if (tenancyIds.length === 0) return []
  const rows = await db.select().from(rentIncreases).where(inArray(rentIncreases.tenancyId, [...tenancyIds])).orderBy(sql`rowid`)
  return rows.map(fromRow)
}

export async function readRentIncrease(db: Executor, id: string): Promise<RentIncrease | null> {
  const [row] = await db.select().from(rentIncreases).where(eq(rentIncreases.id, id))
  return row ? fromRow(row) : null
}

export async function insertRentIncrease(tx: Executor, x: RentIncrease): Promise<void> {
  await tx.insert(rentIncreases).values(toRow(x))
}

export async function replaceRentIncrease(tx: Executor, x: RentIncrease): Promise<void> {
  const { id, ...rest } = toRow(x)
  await tx.update(rentIncreases).set(rest).where(eq(rentIncreases.id, id))
}

export async function deleteRentIncrease(tx: Executor, id: string): Promise<void> {
  await tx.delete(rentIncreases).where(eq(rentIncreases.id, id))
}

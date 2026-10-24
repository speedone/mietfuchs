// Logo und Briefpapier (#415, Teil 2b): die Zeilen der Gestaltung. Mechanisch; welche Dateien und Ränder gehen,
// prüft shared/letterDesign.ts vor dem Schreiben, die Dateien selbst legt server/src/letterDesign.ts ab.
import { eq } from 'drizzle-orm'
import type { LetterDesign, LetterDesignFile } from '../../../shared/types.ts'
import { DEFAULT_LETTER_DESIGN, designFileType, letterDesignFiles } from '../../../shared/letterDesign.ts'
import type { Executor } from './client.ts'
import { letterDesign, propertyLetterDesigns } from './schema.ts'

type Row = typeof letterDesign.$inferSelect

// Eine gespeicherte Datei, deren Name nicht die eigene Gestalt hat, gilt als nicht vorhanden: gelesen, ausgeliefert
// oder gesichert wird nur, was der Server selbst benannt hat.
const fileOf = (name: string | null): LetterDesignFile | null => {
  if (name === null) return null
  const type = designFileType(name)
  return type ? { file: name, type } : null
}

const asDesign = (r: Omit<Row, 'id'>): LetterDesign => ({
  logo: fileOf(r.logoFile),
  paper: fileOf(r.paperFile),
  paperNext: r.paperNext,
  paperNextFile: r.paperNext === 'other' ? fileOf(r.paperNextFile) : null,
  margins: { top: r.marginTop, right: r.marginRight, bottom: r.marginBottom, left: r.marginLeft },
})

const asRow = (d: LetterDesign) => ({
  logoFile: d.logo?.file ?? null,
  paperFile: d.paper?.file ?? null,
  paperNext: d.paperNext,
  paperNextFile: d.paperNext === 'other' ? d.paperNextFile?.file ?? null : null,
  marginTop: d.margins.top,
  marginRight: d.margins.right,
  marginBottom: d.margins.bottom,
  marginLeft: d.margins.left,
})

export async function readInstallationDesign(db: Executor): Promise<LetterDesign> {
  const [row] = await db.select().from(letterDesign).where(eq(letterDesign.id, 1))
  return row ? asDesign(row) : DEFAULT_LETTER_DESIGN
}

export async function readPropertyDesign(db: Executor, propertyId: string): Promise<LetterDesign | null> {
  const [row] = await db.select().from(propertyLetterDesigns).where(eq(propertyLetterDesigns.propertyId, propertyId))
  return row ? asDesign(row) : null
}

export async function saveInstallationDesign(db: Executor, design: LetterDesign): Promise<void> {
  const row = asRow(design)
  await db.insert(letterDesign).values({ id: 1, ...row }).onConflictDoUpdate({ target: letterDesign.id, set: row })
}

// `null`: Das Objekt hat keine eigene Gestaltung mehr, die der Installation gilt.
export async function savePropertyDesign(db: Executor, propertyId: string, design: LetterDesign | null): Promise<void> {
  if (design === null) {
    await db.delete(propertyLetterDesigns).where(eq(propertyLetterDesigns.propertyId, propertyId))
    return
  }
  const row = asRow(design)
  await db.insert(propertyLetterDesigns).values({ propertyId, ...row }).onConflictDoUpdate({ target: propertyLetterDesigns.propertyId, set: row })
}

// Alle Dateien, auf die irgendeine Gestaltung verweist: Eine Datei kann an der Installation und an einem Objekt
// zugleich hängen (die eigene Gestaltung beginnt mit der der Installation), weggeräumt wird nur, was niemand mehr nennt.
export async function referencedDesignFiles(db: Executor): Promise<Set<string>> {
  const designs = [
    ...(await db.select().from(letterDesign)).map(asDesign),
    ...(await db.select().from(propertyLetterDesigns)).map(asDesign),
  ]
  return new Set(designs.flatMap(letterDesignFiles))
}

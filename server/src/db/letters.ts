// Die Texte des Anschreibens je Ebene und die Anpassung der Vorauszahlung je Mieter (#415). Mechanisch:
// Was ein Text darf, prüft shared/letter.ts (`parseLetterTexts`), bevor hier geschrieben wird.
//
// Geschrieben wird wie überall nach Anwesenheit eines Schlüssels: Ein Baustein mit Text setzt ihn, mit
// `null` entfällt die eigene Zeile (die Ebene darüber gilt), ein fehlender Baustein bleibt, wie er war.
import { and, eq, inArray } from 'drizzle-orm'
import type { LetterAdjustment, LetterBlock, LetterTexts, TenancyLetter } from '../../../shared/types.ts'
import type { Executor } from './client.ts'
import { letterTexts, propertyLetterTexts, tenancyLetterAdjustments, tenancyLetterTexts } from './schema.ts'

export type TextChanges = Partial<Record<LetterBlock, string | null>>

const asTexts = (rows: { block: LetterBlock, text: string }[]): LetterTexts => Object.fromEntries(rows.map((r) => [r.block, r.text]))

export async function readInstallationLetterTexts(db: Executor): Promise<LetterTexts> {
  return asTexts(await db.select().from(letterTexts))
}

export async function readPropertyLetterTexts(db: Executor, propertyId: string): Promise<LetterTexts> {
  return asTexts(await db.select({ block: propertyLetterTexts.block, text: propertyLetterTexts.text }).from(propertyLetterTexts).where(eq(propertyLetterTexts.propertyId, propertyId)))
}

export async function saveInstallationLetterTexts(db: Executor, changes: TextChanges): Promise<void> {
  for (const [block, text] of Object.entries(changes) as [LetterBlock, string | null][]) {
    if (text === null) await db.delete(letterTexts).where(eq(letterTexts.block, block))
    else await db.insert(letterTexts).values({ block, text }).onConflictDoUpdate({ target: letterTexts.block, set: { text } })
  }
}

export async function savePropertyLetterTexts(db: Executor, propertyId: string, changes: TextChanges): Promise<void> {
  for (const [block, text] of Object.entries(changes) as [LetterBlock, string | null][]) {
    if (text === null) await db.delete(propertyLetterTexts).where(and(eq(propertyLetterTexts.propertyId, propertyId), eq(propertyLetterTexts.block, block)))
    else await db.insert(propertyLetterTexts).values({ propertyId, block, text }).onConflictDoUpdate({ target: [propertyLetterTexts.propertyId, propertyLetterTexts.block], set: { text } })
  }
}

// Je Mietverhältnis, was es für diese Abrechnung (`doc`) abweichend festgelegt hat; wer nichts hat, fehlt.
export async function readTenancyLetters(db: Executor, doc: string, tenancyIds: readonly string[]): Promise<Record<string, TenancyLetter>> {
  if (tenancyIds.length === 0) return {}
  const texts = await db.select().from(tenancyLetterTexts).where(and(eq(tenancyLetterTexts.doc, doc), inArray(tenancyLetterTexts.tenancyId, [...tenancyIds])))
  const adjustments = await db.select().from(tenancyLetterAdjustments).where(and(eq(tenancyLetterAdjustments.doc, doc), inArray(tenancyLetterAdjustments.tenancyId, [...tenancyIds])))
  const out: Record<string, TenancyLetter> = {}
  const entry = (id: string): TenancyLetter => (out[id] ??= { texts: {}, adjustment: null })
  for (const r of texts) entry(r.tenancyId).texts[r.block] = r.text
  for (const r of adjustments) entry(r.tenancyId).adjustment = { mode: r.mode, cents: r.mode === 'custom' ? r.cents : null }
  return out
}

// `adjustment`: `undefined` lässt sie, `null` nimmt die eigene Wahl weg (die Vorgabe gilt).
export async function saveTenancyLetter(db: Executor, tenancyId: string, doc: string, changes: TextChanges, adjustment: LetterAdjustment | null | undefined): Promise<void> {
  for (const [block, text] of Object.entries(changes) as [LetterBlock, string | null][]) {
    const where = and(eq(tenancyLetterTexts.tenancyId, tenancyId), eq(tenancyLetterTexts.doc, doc), eq(tenancyLetterTexts.block, block))
    if (text === null) await db.delete(tenancyLetterTexts).where(where)
    else await db.insert(tenancyLetterTexts).values({ tenancyId, doc, block, text }).onConflictDoUpdate({ target: [tenancyLetterTexts.tenancyId, tenancyLetterTexts.doc, tenancyLetterTexts.block], set: { text } })
  }
  if (adjustment === undefined) return
  const where = and(eq(tenancyLetterAdjustments.tenancyId, tenancyId), eq(tenancyLetterAdjustments.doc, doc))
  if (adjustment === null) {
    await db.delete(tenancyLetterAdjustments).where(where)
    return
  }
  const row = { mode: adjustment.mode, cents: adjustment.mode === 'custom' ? adjustment.cents : null }
  await db.insert(tenancyLetterAdjustments).values({ tenancyId, doc, ...row }).onConflictDoUpdate({ target: [tenancyLetterAdjustments.tenancyId, tenancyLetterAdjustments.doc], set: row })
}

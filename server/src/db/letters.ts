// Die Texte des Anschreibens je Ebene und die Anpassung der Vorauszahlung je Mieter (#415). Mechanisch:
// Was ein Text darf, prüft shared/letter.ts (`parseLetterTexts`), bevor hier geschrieben wird.
//
// Geschrieben wird wie überall nach Anwesenheit eines Schlüssels: Ein Baustein mit Text setzt ihn, mit
// `null` entfällt die eigene Zeile (die Ebene darüber gilt), ein fehlender Baustein bleibt, wie er war.
import { and, eq, inArray, like } from 'drizzle-orm'
import type { LetterAdjustment, LetterBlock, LetterTexts, TenancyLetter } from '../../../shared/types.ts'
import type { Executor } from './client.ts'
import { closedHeatingSettlements, closedSettlements, letterTexts, properties, propertyLetterTexts, tenancyLetterAdjustments, tenancyLetterTexts } from './schema.ts'
import { andList } from '../../../shared/wording.ts'

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

// „Anschreiben mitdrucken“ am Objekt (Teil 2); `null` heißt „wie in den Einstellungen“.
export async function savePropertyPrintLetter(db: Executor, propertyId: string, printLetter: boolean | null): Promise<void> {
  await db.update(properties).set({ printLetter }).where(eq(properties.id, propertyId))
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

// ---------- Schlüssel, die nicht mehr passen (Integrationsdurchsicht zu #415) ----------
//
// Der Schlüssel `doc` nennt das Objekt und den Zeitraum (`<Objekt>:<Zeitraum>`) bzw. Anlage und Heizperiode
// (`heating:<Anlage>:<Heizperiode>`, die Anlage gehört zu einem Objekt; `letterDoc` in letter.ts). Ändert sich ein
// Zeitraum, gehörten die Texte zu einem anderen Brief; wechselt ein Mietverhältnis das Objekt, zu einem fremden Haus.
// Dann entfallen die offenen; abgeschlossene sind im Stand eingefroren und bleiben.

export type LetterDocRows = { doc: string, period: string, tenancyIds: string[] }
const periodOfDoc = (doc: string): string => doc.slice(doc.lastIndexOf(':') + 1)

// Je Schlüssel mit diesem Anfang die Mietverhältnisse, die dort eigene Texte oder eine eigene Anpassung haben.
export async function letterDocsWithPrefix(db: Executor, prefix: string): Promise<LetterDocRows[]> {
  const rows = [
    ...await db.select({ doc: tenancyLetterTexts.doc, tenancyId: tenancyLetterTexts.tenancyId }).from(tenancyLetterTexts).where(like(tenancyLetterTexts.doc, `${prefix}%`)),
    ...await db.select({ doc: tenancyLetterAdjustments.doc, tenancyId: tenancyLetterAdjustments.tenancyId }).from(tenancyLetterAdjustments).where(like(tenancyLetterAdjustments.doc, `${prefix}%`)),
  ].filter((r) => r.doc.startsWith(prefix))
  const out = new Map<string, LetterDocRows>()
  for (const r of rows) {
    const entry = out.get(r.doc) ?? { doc: r.doc, period: periodOfDoc(r.doc), tenancyIds: [] }
    if (!entry.tenancyIds.includes(r.tenancyId)) entry.tenancyIds.push(r.tenancyId)
    out.set(r.doc, entry)
  }
  return [...out.values()]
}

export async function dropLetterDocs(db: Executor, docs: readonly string[]): Promise<void> {
  if (docs.length === 0) return
  await db.delete(tenancyLetterTexts).where(inArray(tenancyLetterTexts.doc, [...docs]))
  await db.delete(tenancyLetterAdjustments).where(inArray(tenancyLetterAdjustments.doc, [...docs]))
}

// Der Satz der Vorschau je entfallendem Schlüssel.
export function droppedLettersText(names: readonly string[], label: string): string {
  return names.length === 1
    ? `Das eigene Anschreiben von ${names[0]} für ${label} entfällt, weil sich der Zeitraum ändert; danach gilt die Vorlage.`
    : `Die eigenen Anschreiben von ${andList([...names])} für ${label} entfallen, weil sich der Zeitraum ändert; danach gilt die Vorlage.`
}

// Die offenen Anschreiben einer getrennten Heizkostenabrechnung ab einer Heizperiode (Durchsicht zu PR #427, K4): beim
// Ausschalten von Weg d und beim Entfernen der Anlage. Abgeschlossene bleiben eingefroren.
export async function dropOpenHeatingLetters(db: Executor, plantId: string, from: string | null): Promise<void> {
  const closed = new Set((await db.select({ period: closedHeatingSettlements.period }).from(closedHeatingSettlements).where(eq(closedHeatingSettlements.plantId, plantId))).map((c) => c.period as string))
  const docs = (await letterDocsWithPrefix(db, `heating:${plantId}:`)).filter((d) => (from === null || d.period >= from) && !closed.has(d.period))
  await dropLetterDocs(db, docs.map((d) => d.doc))
}

// Ein Mietverhältnis wechselt das Objekt: seine offenen Anschreiben entfallen, die abgeschlossener Abrechnungen bleiben.
export async function dropOpenTenancyLetters(db: Executor, tenancyId: string): Promise<void> {
  const docs = new Set([
    ...(await db.select({ doc: tenancyLetterTexts.doc }).from(tenancyLetterTexts).where(eq(tenancyLetterTexts.tenancyId, tenancyId))).map((r) => r.doc),
    ...(await db.select({ doc: tenancyLetterAdjustments.doc }).from(tenancyLetterAdjustments).where(eq(tenancyLetterAdjustments.tenancyId, tenancyId))).map((r) => r.doc),
  ])
  if (docs.size === 0) return
  const closed = new Set([
    ...(await db.select({ owner: closedSettlements.propertyId, period: closedSettlements.period }).from(closedSettlements)).map((c) => `${c.owner}:${c.period}`),
    ...(await db.select({ owner: closedHeatingSettlements.plantId, period: closedHeatingSettlements.period }).from(closedHeatingSettlements)).map((c) => `heating:${c.owner}:${c.period}`),
  ])
  const open = [...docs].filter((d) => !closed.has(d))
  if (open.length === 0) return
  await db.delete(tenancyLetterTexts).where(and(eq(tenancyLetterTexts.tenancyId, tenancyId), inArray(tenancyLetterTexts.doc, open)))
  await db.delete(tenancyLetterAdjustments).where(and(eq(tenancyLetterAdjustments.tenancyId, tenancyId), inArray(tenancyLetterAdjustments.doc, open)))
}

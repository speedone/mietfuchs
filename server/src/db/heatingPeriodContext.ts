// Die Heizperioden einer Anlage in der Datenbank (Heizung PR 6, ausgelagert mit PR 8): die Anlage mit
// den Regeln ihres Objekts und ihren eigenen, eine Heizperiode aus ihrem Schlüssel, ob sie
// abgeschlossen ist, und ihre Zeile in `heating_periods`, angelegt beim ersten Speichern und entfernt,
// wenn nichts mehr an ihr hängt. db/co2.ts (CO₂ und Warmwasser), db/fuel.ts (Lieferungen) und
// db/fuelStock.ts (Vorrat) importieren von hier, nie umgekehrt.
import { and, count, eq } from 'drizzle-orm'
import type { BillingPeriod, HeatingPlant, PeriodKey, PeriodRules } from '../../../shared/types.ts'
import { heatingPeriodsEndingIn, plantRules, settledSeparately } from '../../../shared/heatingPeriod.ts'
import { parsePeriodKey, periodContaining, periodLabel, periodOfKey, rulesOf } from '../../../shared/period.ts'
import { newId } from '../store.ts'
import type { Database, Executor } from './client.ts'
import { readHeatingPlants, readProperties } from './read.ts'
import { HeatingError } from './repository.ts'
import { closedHeatingSettlements, closedSettlements, co2Statements, fuelCarryFrozen, heatingPeriods } from './schema.ts'

export const closedText = (h: BillingPeriod) =>
  `Die Heizperiode ${periodLabel(h)} ist abgeschlossen; ihre Angaben bleiben, wie sie beim Abschluss waren. Öffnen Sie die Abrechnung wieder, um etwas zu ändern.`

export type PlantContext = { plant: HeatingPlant; objectRules: PeriodRules; plantRules: PeriodRules }

// Die Anlage mit dem Rhythmus ihres Objekts und ihrem eigenen. Ohne eigenen Beginnmonat folgt die
// Heizperiode dem Objekt samt seinen Wechseln (Entwurf 3.0); mit eigenem gelten Beginnmonat und
// Wechsel der Anlage (`plantRules`, PR 5; `periodChanges` füllt `readHeatingPlants`).
export async function plantContext(db: Database, plantId: string): Promise<PlantContext | null> {
  const plant = (await readHeatingPlants(db)).find((p) => p.id === plantId)
  if (!plant) return null
  const objectRules = rulesOf((await readProperties(db)).find((p) => p.id === plant.propertyId))
  return { plant, objectRules, plantRules: plantRules(plant, objectRules) }
}

export function heatingPeriodOf(ctx: PlantContext, text: string): BillingPeriod {
  const key = parsePeriodKey(text)
  const h = key === null ? null : periodOfKey(ctx.plantRules, key)
  if (!h) throw new HeatingError(400, `Eine Heizperiode „${text}“ gibt es für diese Heizanlage nicht. Bitte laden Sie die Seite neu.`)
  return h
}

// Abgeschlossen ist eine Heizperiode nach Weg d mit ihrer eigenen Heizkostenabrechnung
// (`closed_heating_settlements`, PR 5); der Abschluss von P friert sie nicht ein (B3). Jede andere mit
// der Abrechnung des Objektzeitraums, der ihr Ende enthält (W1).
export async function heatingPeriodClosed(db: Executor, ctx: PlantContext, h: BillingPeriod): Promise<boolean> {
  if (settledSeparately(ctx.plant, ctx.objectRules, h)) {
    const [heizung] = await db
      .select({ n: count() })
      .from(closedHeatingSettlements)
      .where(and(eq(closedHeatingSettlements.plantId, ctx.plant.id), eq(closedHeatingSettlements.period, h.key)))
    return (heizung?.n ?? 0) > 0
  }
  const p = periodContaining(ctx.objectRules, h.to)
  const [gesamt] = await db
    .select({ n: count() })
    .from(closedSettlements)
    .where(and(eq(closedSettlements.propertyId, ctx.plant.propertyId), eq(closedSettlements.period, p.key)))
  return (gesamt?.n ?? 0) > 0
}

// Die Schlüssel der abgeschlossenen Heizperioden einer Anlage (Durchsicht von #239, W2 und Runde 3): nach
// Weg d die eigenen Heizkostenabrechnungen, sonst die Abrechnungen des Objekts, deren Zeitraum das Ende
// einer Heizperiode enthält.
export async function closedHeatingKeys(db: Executor, ctx: PlantContext): Promise<string[]> {
  const keys: string[] = []
  const heating = await db.select({ period: closedHeatingSettlements.period }).from(closedHeatingSettlements).where(eq(closedHeatingSettlements.plantId, ctx.plant.id))
  for (const c of heating) keys.push(String(c.period))
  const object = await db.select({ period: closedSettlements.period }).from(closedSettlements).where(eq(closedSettlements.propertyId, ctx.plant.propertyId))
  for (const c of object) {
    const key = parsePeriodKey(String(c.period))
    const p = key === null ? null : periodOfKey(ctx.objectRules, key)
    if (!p) continue
    for (const h of heatingPeriodsEndingIn(ctx.plantRules, p)) if (!settledSeparately(ctx.plant, ctx.objectRules, h)) keys.push(String(h.key))
  }
  return [...new Set(keys)]
}

export async function ensureHeatingPeriod(db: Executor, plantId: string, key: PeriodKey): Promise<string> {
  const [row] = await db.select({ id: heatingPeriods.id }).from(heatingPeriods).where(and(eq(heatingPeriods.plantId, plantId), eq(heatingPeriods.period, key)))
  if (row) return row.id
  const id = newId()
  await db.insert(heatingPeriods).values({ id, plantId, period: key })
  return id
}

// Eine Zeile in `heating_periods` ohne jede Angabe wird wieder entfernt. Sie entstand nur, damit
// etwas an ihr hängen konnte; bliebe sie leer stehen, sperrte sie den Wechsel des Zeitraums der
// Heizung (PR 5, heatingPeriodChange.ts: jede Zeile gilt dort als erfasste Angabe).
export async function dropIfEmpty(db: Executor, heatingPeriodId: string): Promise<void> {
  const [row] = await db.select().from(heatingPeriods).where(eq(heatingPeriods.id, heatingPeriodId))
  if (!row) return
  const { id: _id, plantId: _plant, period: _period, ...data } = row
  if (Object.values(data).some((v) => v !== null)) return
  const [co2] = await db.select({ n: count() }).from(co2Statements).where(eq(co2Statements.heatingPeriodId, heatingPeriodId))
  if ((co2?.n ?? 0) > 0) return
  // Eingefrorene Teile von Lieferungen (Heizung PR 7) hängen an der Zeile; mit ihr fielen sie.
  const [frozen] = await db.select({ n: count() }).from(fuelCarryFrozen).where(eq(fuelCarryFrozen.heatingPeriodId, heatingPeriodId))
  if ((frozen?.n ?? 0) > 0) return
  await db.delete(heatingPeriods).where(eq(heatingPeriods.id, heatingPeriodId))
}


// Die Heizkostenabrechnungen nach Weg d (Heizung PR 5, Entwurf 3.1, B3): Abschluss, Versanddatum,
// Wiederöffnen und Verlauf (#56), wie bei den Abrechnungen des Objekts in repository.ts, aber in
// eigenen Tabellen. Der Abschluss einer Abrechnung des Objekts friert eine Heizkostenabrechnung nie
// mit ein, denn sie hat ihre eigene Frist.

import { and, desc, eq, sql } from 'drizzle-orm'
import { plantRules, settledSeparately } from '../../../shared/heatingPeriod.ts'
import { periodsBetween, rulesOf, settlementDeadline, settlementPeriod } from '../../../shared/period.ts'
import type { HeatingSettlementInfo, PeriodKey } from '../../../shared/types.ts'
import type { Database } from './client.ts'
import { readClosedHeatingSettlements, readHeatingPlants, readProperties, type StoredClosedHeatingSettlement } from './read.ts'
import type { SettlementHistoryEntry } from './repository.ts'
import { closedHeatingSettlementHistory, closedHeatingSettlements } from './schema.ts'

const closedOf = (plantId: string, period: PeriodKey) =>
  and(eq(closedHeatingSettlements.plantId, plantId), eq(closedHeatingSettlements.period, period))

export async function findClosedHeatingSettlement(db: Database, plantId: string, period: PeriodKey): Promise<StoredClosedHeatingSettlement | undefined> {
  return (await readClosedHeatingSettlements(db)).find((c) => c.plantId === plantId && c.period === period)
}

export async function closeHeatingSettlement(
  db: Database,
  entry: { id: string, plantId: string, period: PeriodKey, closedAt: string, sentAt: string | null, settlement: unknown },
): Promise<void> {
  await db.insert(closedHeatingSettlements).values(entry)
}

export async function setHeatingSentAt(db: Database, plantId: string, period: PeriodKey, sentAt: string | null): Promise<boolean> {
  if (!(await findClosedHeatingSettlement(db, plantId, period))) return false
  await db.update(closedHeatingSettlements).set({ sentAt }).where(closedOf(plantId, period))
  return true
}

export async function reopenHeatingSettlement(db: Database, plantId: string, period: PeriodKey, historyId: string): Promise<boolean> {
  const eintrag = await findClosedHeatingSettlement(db, plantId, period)
  if (!eintrag) return false
  await db.transaction(async (tx) => {
    await tx.insert(closedHeatingSettlementHistory).values({
      id: historyId, plantId, period, closedAt: eintrag.closedAt, sentAt: eintrag.sentAt,
      reopenedAt: new Date().toISOString(), settlement: eintrag.settlement,
    })
    await tx.delete(closedHeatingSettlements).where(closedOf(plantId, period))
  })
  return true
}

export async function heatingSettlementHistory(db: Database, plantId: string, period: PeriodKey): Promise<SettlementHistoryEntry[]> {
  const rows = await db
    .select()
    .from(closedHeatingSettlementHistory)
    .where(and(eq(closedHeatingSettlementHistory.plantId, plantId), eq(closedHeatingSettlementHistory.period, period)))
    .orderBy(desc(closedHeatingSettlementHistory.reopenedAt), desc(sql`rowid`))
  return rows.map((r) => ({ id: r.id, closedAt: r.closedAt, sentAt: r.sentAt, reopenedAt: r.reopenedAt, settlement: r.settlement }))
}

// Die Heizkostenabrechnungen eines Objekts nach Weg d, von der ersten Spanne bis zur Heizperiode, die
// heute läuft, mit Frist und Abschluss. Das Cockpit führt jede mit ihrer eigenen Frist (3.1).
export async function separateHeatingSettlements(db: Database, propertyId: string, today: string): Promise<HeatingSettlementInfo[]> {
  const objectRules = rulesOf((await readProperties(db)).find((p) => p.id === propertyId))
  const closed = await readClosedHeatingSettlements(db)
  const result: HeatingSettlementInfo[] = []
  for (const plant of (await readHeatingPlants(db)).filter((p) => p.propertyId === propertyId)) {
    const first = plant.separateSpans[0]
    if (plant.periodStartMonth === null || first === undefined) continue
    for (const h of periodsBetween(plantRules(plant, objectRules), `${first.from}-01`, today)) {
      if (!settledSeparately(plant, objectRules, h)) continue
      const c = closed.find((x) => x.plantId === plant.id && x.period === h.key)
      result.push({
        plantId: plant.id, plantName: plant.name, period: settlementPeriod(h), deadline: settlementDeadline(h),
        closed: c ? { closedAt: c.closedAt, sentAt: c.sentAt } : null,
      })
    }
  }
  return result
}

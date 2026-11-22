// Lesen der eigenen Kostenarten (db/costTypes.ts), getrennt, damit read.ts sie ohne repository.ts lesen kann.
import { and, asc, count, eq, inArray } from 'drizzle-orm'
import type { CostType, PeriodKey } from '../../../shared/types.ts'
import type { Executor } from './client.ts'
import { costItems, costTypes } from './schema.ts'

export async function readCostTypes(db: Executor, propertyId?: string, period?: PeriodKey): Promise<CostType[]> {
  const where = propertyId === undefined ? undefined : period === undefined
    ? eq(costTypes.propertyId, propertyId)
    : and(eq(costTypes.propertyId, propertyId), eq(costTypes.period, period))
  const rows = await db.select().from(costTypes).where(where).orderBy(asc(costTypes.period), asc(costTypes.position), asc(costTypes.name))
  if (rows.length === 0) return []
  const counts = await db.select({ id: costItems.costTypeId, n: count() }).from(costItems)
    .where(inArray(costItems.costTypeId, rows.map((r) => r.id))).groupBy(costItems.costTypeId)
  const byId = new Map(counts.map((c) => [c.id, c.n]))
  return rows.map((r) => ({ id: r.id, propertyId: r.propertyId, period: r.period, name: r.name, baseCategory: r.baseCategory, position: r.position, itemCount: byId.get(r.id) ?? 0 }))
}

// Eigene Kostenarten je Objekt und Abrechnungszeitraum (gewerbliche Abrechnung). Eine Kostenart hat einen Namen für
// Abrechnung und Export und eine Grundart aus der Liste von Mietfuchs (shared/categories.ts), nach der gerechnet wird;
// eine Position verweist mit `costTypeId` auf sie und trägt die Grundart als `category` (`guardCostType` in
// repository.ts). Die Liste gilt je Zeitraum, wie das Blatt „Kostenarten“ einer Abrechnung mit Jahr: Jedes Jahr lässt
// sie sich ergänzen und kürzen, „Aus dem Vorjahr übernehmen“ legt die des Vorzeitraums an.
//
// Ohne eigene Kostenart bleibt alles, wie es war.
import { and, count, eq } from 'drizzle-orm'
import { CATEGORIES } from '../../../shared/categories.ts'
import { parsePeriodKey, periodOfKey, previousPeriod } from '../../../shared/period.ts'
import type { CostType, PeriodKey } from '../../../shared/types.ts'
import type { Executor } from './client.ts'
import { CostTypeError, requirePeriods, rulesForProperty } from './repository.ts'
import { costItems, costTypes } from './schema.ts'
import { readCostTypes } from './costTypesRead.ts'

export { readCostTypes }

export const COST_TYPE_NAME_MAX = 80

const text = (body: unknown, key: string): unknown => (body !== null && typeof body === 'object' ? Reflect.get(body, key) : undefined)
const has = (body: unknown, key: string): boolean => body !== null && typeof body === 'object' && Object.hasOwn(body, key)

function nameOf(v: unknown): string {
  if (typeof v !== 'string' || v.trim() === '') throw new CostTypeError('Bitte geben Sie der Kostenart einen Namen, etwa „Sicherheitsdienst“.')
  const name = v.trim().replace(/\s+/g, ' ')
  if (name.length > COST_TYPE_NAME_MAX) throw new CostTypeError(`Der Name einer Kostenart hat höchstens ${COST_TYPE_NAME_MAX} Zeichen.`)
  return name
}

function baseOf(v: unknown): string {
  if (typeof v !== 'string' || !CATEGORIES.includes(v)) {
    throw new CostTypeError('Bitte wählen Sie, wie Mietfuchs die Kostenart rechnet (Grundart), etwa „Sonstige Betriebskosten“.')
  }
  return v
}

async function periodOf(db: Executor, propertyId: string, v: unknown): Promise<PeriodKey> {
  const period = parsePeriodKey(v)
  if (period === null) throw new CostTypeError('Bitte nennen Sie den Abrechnungszeitraum der Kostenart.')
  await requirePeriods(db, propertyId, [period], false, 'Die Kostenart')
  return period
}

async function requireFreeName(db: Executor, propertyId: string, period: PeriodKey, name: string, ownId: string | null): Promise<void> {
  const same = (await db.select({ id: costTypes.id, name: costTypes.name }).from(costTypes)
    .where(and(eq(costTypes.propertyId, propertyId), eq(costTypes.period, period))))
    .find((r) => r.id !== ownId && r.name.toLocaleLowerCase('de-DE') === name.toLocaleLowerCase('de-DE'))
  if (same) throw new CostTypeError(`Die Kostenart „${same.name}“ gibt es in diesem Zeitraum schon.`)
}

async function findType(db: Executor, id: string): Promise<CostType> {
  const [row] = await db.select().from(costTypes).where(eq(costTypes.id, id))
  if (!row) throw new CostTypeError('Diese Kostenart gibt es nicht mehr.', 404)
  const [n] = await db.select({ n: count() }).from(costItems).where(eq(costItems.costTypeId, id))
  return { ...row, itemCount: n?.n ?? 0 }
}

async function nextPosition(db: Executor, propertyId: string, period: PeriodKey): Promise<number> {
  const rows = await db.select({ position: costTypes.position }).from(costTypes).where(and(eq(costTypes.propertyId, propertyId), eq(costTypes.period, period)))
  return rows.reduce((a, r) => Math.max(a, r.position + 1), 0)
}

export async function createCostType(db: Executor, id: string, propertyId: string, body: unknown): Promise<CostType> {
  const period = await periodOf(db, propertyId, text(body, 'period'))
  const name = nameOf(text(body, 'name'))
  const baseCategory = baseOf(text(body, 'baseCategory'))
  await requireFreeName(db, propertyId, period, name, null)
  await db.insert(costTypes).values({ id, propertyId, period, name, baseCategory, position: await nextPosition(db, propertyId, period) })
  return findType(db, id)
}

// Name und Reihenfolge lassen sich immer ändern; der neue Name gilt auch für Positionen, die schon auf die Kostenart
// zeigen (eine abgeschlossene Abrechnung behält den eingefrorenen). Die Grundart nur ohne Positionen: Sie änderte, wie
// deren Beträge gerechnet werden, und jede Position hat dafür ihre eigenen Prüfungen.
export async function updateCostType(db: Executor, id: string, body: unknown): Promise<CostType> {
  const current = await findType(db, id)
  const name = has(body, 'name') ? nameOf(text(body, 'name')) : current.name
  const baseCategory = has(body, 'baseCategory') ? baseOf(text(body, 'baseCategory')) : current.baseCategory
  const rawPosition = text(body, 'position')
  const position = has(body, 'position') && typeof rawPosition === 'number' && Number.isInteger(rawPosition) && rawPosition >= 0 ? rawPosition : current.position
  if (baseCategory !== current.baseCategory && current.itemCount > 0) {
    throw new CostTypeError(`An „${current.name}“ hängen ${current.itemCount === 1 ? 'eine Position' : `${current.itemCount} Positionen`}; die Grundart lässt sich dann nicht ändern. Legen Sie eine neue Kostenart an und ordnen Sie die Positionen dort zu.`, 409)
  }
  if (name !== current.name) await requireFreeName(db, current.propertyId, current.period, name, id)
  await db.update(costTypes).set({ name, baseCategory, position }).where(eq(costTypes.id, id))
  return findType(db, id)
}

export async function removeCostType(db: Executor, id: string): Promise<void> {
  const current = await findType(db, id)
  if (current.itemCount > 0) {
    throw new CostTypeError(`An „${current.name}“ hängen ${current.itemCount === 1 ? 'eine Position' : `${current.itemCount} Positionen`}. Ordnen Sie sie zuerst einer anderen Kostenart zu oder löschen Sie sie.`, 409)
  }
  await db.delete(costTypes).where(eq(costTypes.id, id))
}

// Legt im Zeitraum die Kostenarten des Vorzeitraums an, deren Name dort noch fehlt, in ihrer Reihenfolge. Liefert die
// Liste des Zeitraums danach.
export async function carryOverCostTypes(db: Executor, propertyId: string, rawPeriod: unknown, newId: () => string): Promise<{ created: number; types: CostType[] }> {
  const period = await periodOf(db, propertyId, rawPeriod)
  const rules = await rulesForProperty(db, propertyId)
  const current = periodOfKey(rules, period)
  if (!current) throw new CostTypeError('Diesen Abrechnungszeitraum gibt es für das Objekt nicht.')
  const previous = previousPeriod(rules, current).key
  const before = await readCostTypes(db, propertyId, previous)
  const present = new Set((await readCostTypes(db, propertyId, period)).map((t) => t.name.toLocaleLowerCase('de-DE')))
  let position = await nextPosition(db, propertyId, period)
  let created = 0
  for (const t of before) {
    if (present.has(t.name.toLocaleLowerCase('de-DE'))) continue
    await db.insert(costTypes).values({ id: newId(), propertyId, period, name: t.name, baseCategory: t.baseCategory, position: position++ })
    created++
  }
  return { created, types: await readCostTypes(db, propertyId, period) }
}

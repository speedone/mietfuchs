// Die eigene Heizkostenabrechnung in der Datenbank (Heizung PR 10, Entwurf 5.3, 8.5, 11.2 Schritt 7).
//
// **Einrichtung** (`setUpSelf`): Eine Anlage wird nur hier zur eigenen Heizkostenabrechnung, in einer
// Transaktion mit dem Anteil nach Verbrauch der Heizperiode, an der der Vermieter arbeitet, den
// Zählern, die fehlen, und der Umstellung der Heizpositionen offener Zeiträume (Abweichung 17). Fehlt
// für eine dieser Positionen die Angabe von Teil und Ziel, entsteht nichts, und die Antwort nennt sie
// (409, Review Focus 3).
//
// **Anteil nach Verbrauch** (§ 6 Abs. 4, R-A7): Vorgabe ist der Anteil der Vorperiode. Eine Änderung
// gilt nur für eine Heizperiode, die noch nicht begonnen hat; der erste Anteil darf jederzeit gesetzt
// werden („Mit welchem Anteil haben Sie bisher abgerechnet?“). 50 bis 70 % (§ 7 Abs. 1, § 8 Abs. 1),
// bei Öl und Gas mit gedämmten Leitungen 70 % für die Heizung (§ 7 Abs. 1 Satz 2); mehr als 70 % nur
// mit Vereinbarung (§ 10), das kommt mit PR 14.
//
// **Fehlende Zwischenablesung** (Abweichung 8): die Antwort je Wohnung und Grenze.
import { and, eq, ne } from 'drizzle-orm'
import { hkvConsumptionShare, hkvConsumptionShareForced } from '../../../shared/law/heizkostenv.ts'
import { germanDate, valueAt } from '../../../shared/law/register.ts'
import { HEATING_CATEGORY } from '../../../shared/heating.ts'
import { servesUnit } from '../../../shared/heatingPeriod.ts'
import type {
  BillingPeriod, CostItem, CostKey, HeatingDistribution, HeatingEnergy, HeatingPart, HeatingPlant, InterimGap, InsulationRule, Meter,
} from '../../../shared/types.ts'
import { consumptionSharesOf, OIL_OR_GAS, POT_METER, targetProblem, type ShareRow } from '../heating.ts'
import type { Database, Executor } from './client.ts'
import { closedText, ensureHeatingPeriod, heatingPeriodClosed, heatingPeriodOf, plantContext } from './heatingPeriodContext.ts'
import { readCostItems, readHeatingPlants, readMeters, readUnits } from './read.ts'
import { guardHeatingPlant, plantRow } from './heating.ts'
import { HeatingError, insertEntityIn, ISO_DATE, oneOfOrUndefined, patchCostItemIn, raw } from './repository.ts'
import { costItems, heatingPeriods, heatingPlants, INSULATION_RULES, INTERIM_GAP_STATUS, interimReadingGaps, units } from './schema.ts'

export const SELF_VIA_SETUP =
  'Die eigene Heizkostenabrechnung richten Sie in den Stammdaten unter „Heizung“ mit den Fragen der Einrichtung ein; dort entstehen Anteil, Zähler und die Umstellung der Positionen gemeinsam.'

export type SelfConvertItem = Pick<CostItem, 'id' | 'period' | 'description' | 'amountCents' | 'key'> & { heatingPart: HeatingPart | null }

// Ablehnung mit der Liste der Positionen, die umzustellen sind (409).
export class SelfItemsError extends Error {
  status = 409 as const
  items: SelfConvertItem[]
  constructor(message: string, items: SelfConvertItem[]) {
    super(message)
    this.items = items
  }
}

// Heizpositionen der Anlage in offenen Zeiträumen, mit einem anderen Schlüssel als `keyNot` bzw. genau
// dem Schlüssel `keyIs`. Offen heißt: weder der Zeitraum des Objekts noch die Heizperiode ist
// abgeschlossen; abgeschlossene bleiben, wie sie sind.
export async function selfItemsOf(db: Database, plantId: string, keyNot: CostKey | null, keyIs: CostKey | null): Promise<SelfConvertItem[]> {
  const conds = [eq(costItems.heatingPlantId, plantId), eq(costItems.category, HEATING_CATEGORY)]
  if (keyNot !== null) conds.push(ne(costItems.key, keyNot))
  if (keyIs !== null) conds.push(eq(costItems.key, keyIs))
  const rows = await db.select({ id: costItems.id, period: costItems.period, description: costItems.description, amountCents: costItems.amountCents, key: costItems.key, heatingPart: costItems.heatingPart, propertyId: costItems.propertyId })
    .from(costItems).where(and(...conds)).orderBy(costItems.period, costItems.description)
  const ctx = await plantContext(db, plantId)
  const out: SelfConvertItem[] = []
  for (const r of rows) {
    const h = ctx ? heatingPeriodOf(ctx, String(r.period)) : null
    if (ctx && h && (await heatingPeriodClosed(db, ctx, h))) continue
    out.push({ id: r.id, period: r.period, description: r.description, amountCents: r.amountCents, key: r.key, heatingPart: r.heatingPart ?? null })
  }
  return out
}

// Der Anteil einer Heizperiode für die Seite Heizkosten.
export function distributionOf(rows: readonly ShareRow[], energy: HeatingEnergy, h: Pick<BillingPeriod, 'key' | 'from'>, today: string): HeatingDistribution {
  const own = rows.find((r) => r.period === h.key)
  const shares = consumptionSharesOf(rows, h.key, energy, () => valueAt(hkvConsumptionShareForced, h.from))
  const earlier = rows.some((r) => r.period < h.key && r.heatConsumptionPct !== null)
  return {
    own: { heating: own?.heatConsumptionPct ?? null, water: own?.waterConsumptionPct ?? null, insulationRule: own?.insulationRule ?? null },
    effective: shares ? { heating: shares.heating, water: shares.water, insulationRule: own?.insulationRule ?? null } : null,
    inherited: shares !== null && !shares.own,
    begun: today !== '' && today >= h.from,
    first: shares === null || (!earlier && !shares.own),
    forcedPercent: shares?.forced ? shares.heating : null,
  }
}

const pctOf = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

// Prüft einen neuen Anteil (Prozent) und gibt Heizung und Warmwasser zurück.
function checkShares(body: unknown, plant: HeatingPlant, h: BillingPeriod, rows: readonly ShareRow[], today: string): { heating: number; water: number | null; insulationRule: InsulationRule } {
  const heating = pctOf(raw(body, 'heatConsumptionPct'))
  // § 8 Abs. 1: eigene Wahl beim Warmwasser (Abweichung 14); ohne zentrales Warmwasser gibt es keinen.
  const withWater = plant.hotWater !== 'none'
  const water = withWater ? pctOf(raw(body, 'waterConsumptionPct')) : null
  if (withWater && water === null) {
    throw new HeatingError(400, 'Bitte geben Sie auch den Anteil nach Verbrauch beim Warmwasser an (§ 8 Abs. 1 HeizkostenV); er darf von dem der Heizung abweichen.')
  }
  const insulationRule = oneOfOrUndefined(INSULATION_RULES, raw(body, 'insulationRule')) ?? 'unknown'
  const { min, max } = valueAt(hkvConsumptionShare, h.from)
  for (const v of withWater ? [heating, water] : [heating]) {
    if (v === null) throw new HeatingError(400, 'Bitte geben Sie an, welcher Anteil der Kosten nach Verbrauch verteilt wird.')
    if (v > max) throw new HeatingError(400, `Mehr als ${max} % nach Verbrauch gehen nur mit einer Vereinbarung (§ 10 HeizkostenV); das kommt mit einer späteren Version.`)
    if (v < min) throw new HeatingError(400, `Die Heizkostenverordnung verlangt mindestens ${min} % nach Verbrauch (§ 7 Abs. 1, § 8 Abs. 1).`)
  }
  if (heating === null) throw new HeatingError(400, 'Bitte geben Sie den Anteil an.')
  if (insulationRule === 'applies' && OIL_OR_GAS.includes(plant.energy)) {
    const forced = valueAt(hkvConsumptionShareForced, h.from)
    if (heating !== forced) {
      throw new HeatingError(400, `Bei Öl- oder Gasheizung, Wärmeschutz unter dem Niveau von 1994 und überwiegend gedämmten Leitungen sind von den Heizkosten ${forced} % nach Verbrauch zu verteilen (§ 7 Abs. 1 Satz 2 HeizkostenV).`)
    }
  }
  // § 6 Abs. 4: nur für künftige Zeiträume; der erste Anteil darf jederzeit gesetzt werden.
  const before = consumptionSharesOf(rows, h.key, plant.energy, () => valueAt(hkvConsumptionShareForced, h.from))
  if (before !== null && today >= h.from && (before.heating !== heating || before.water !== water) && !(insulationRule === 'applies' && before.forced)) {
    throw new HeatingError(400,
      `Die Heizperiode hat am ${germanDate(h.from)} begonnen. Den Anteil nach Verbrauch ändern Sie nur für künftige Abrechnungszeiträume, durch Erklärung gegenüber den Mietern und mit Wirkung zum Beginn eines Zeitraums (§ 6 Abs. 4 HeizkostenV). Tragen Sie ihn bei der nächsten Heizperiode ein.`)
  }
  return { heating, water, insulationRule }
}

async function shareRows(db: Executor, plantId: string): Promise<ShareRow[]> {
  return (await db.select({ period: heatingPeriods.period, heatConsumptionPct: heatingPeriods.heatConsumptionPct, waterConsumptionPct: heatingPeriods.waterConsumptionPct, insulationRule: heatingPeriods.insulationRule })
    .from(heatingPeriods).where(eq(heatingPeriods.plantId, plantId))).map((r) => ({ ...r, period: String(r.period) }))
}

// `null`, wenn es die Anlage nicht gibt; die Route macht daraus ihre 404.
export async function saveDistribution(db: Database, plantId: string, period: string, body: unknown, today: string): Promise<HeatingDistribution | null> {
  const ctx = await plantContext(db, plantId)
  if (!ctx) return null
  if (ctx.plant.method !== 'self') throw new HeatingError(400, 'Den Anteil nach Verbrauch legen Sie nur bei einer eigenen Heizkostenabrechnung fest.')
  const h = heatingPeriodOf(ctx, period)
  if (await heatingPeriodClosed(db, ctx, h)) throw new HeatingError(409, closedText(h))
  const rows = await shareRows(db, plantId)
  const next = checkShares(body, ctx.plant, h, rows, today)
  await db.transaction(async (tx) => {
    const id = await ensureHeatingPeriod(tx, plantId, h.key)
    await tx.update(heatingPeriods).set({ heatConsumptionPct: next.heating, waterConsumptionPct: next.water, insulationRule: next.insulationRule }).where(eq(heatingPeriods.id, id))
  })
  return distributionOf(await shareRows(db, plantId), ctx.plant.energy, h, today)
}

type ItemAnswer = { id: string; heatingPart: HeatingPart; heatingTarget: CostItem['heatingTarget'] }
function readItemAnswers(value: unknown): ItemAnswer[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((x) => {
    const id = raw(x, 'id')
    const part = raw(x, 'heatingPart')
    const target = raw(x, 'heatingTarget')
    return typeof id === 'string' && (part === 'fuel' || part === 'operating' || part === 'metering') && (target === 'both' || target === 'heating' || target === 'water')
      ? [{ id, heatingPart: part, heatingTarget: target }]
      : []
  })
}

// `null`, wenn es die Anlage nicht gibt.
export async function setUpSelf(db: Database, plantId: string, body: unknown, today: string, newId: () => string): Promise<{ plant: HeatingPlant; created: Meter[]; converted: number } | null> {
  const ctx = await plantContext(db, plantId)
  if (!ctx) return null
  const current = ctx.plant
  const periodText = raw(body, 'period')
  const h = heatingPeriodOf(ctx, typeof periodText === 'string' ? periodText : '')
  if (await heatingPeriodClosed(db, ctx, h)) throw new HeatingError(409, closedText(h))
  const capture = raw(body, 'capture')
  const after: HeatingPlant = {
    ...current,
    method: 'self',
    hotWater: raw(body, 'hotWater') === 'separate' ? 'separate' : raw(body, 'hotWater') === 'none' ? 'none' : 'combined',
    capture: capture === 'heatMeter' || capture === 'hca' || capture === 'serviceValues' ? capture : null,
    areaBasisHeat: raw(body, 'areaBasisHeat') === 'heatedArea' ? 'heatedArea' : 'area',
  }
  await guardHeatingPlant(db, current, after)
  const rows = await shareRows(db, plantId)
  const shares = checkShares(body, after, h, rows, today)

  // Positionen offener Zeiträume mit anderem Schlüssel: jede braucht Teil und Ziel (Review Focus 3).
  const offen = await selfItemsOf(db, plantId, 'heatingSystem', null)
  const answers = readItemAnswers(raw(body, 'items'))
  const missing = offen.filter((c) => !answers.some((a) => a.id === c.id))
  if (missing.length > 0) {
    throw new SelfItemsError(
      `Für ${missing.length === 1 ? 'diese Heizposition' : `diese ${missing.length} Heizpositionen`} in offenen Zeiträumen braucht die eigene Abrechnung Teil und Ziel: ${missing.map((c) => `„${c.description}“`).join(', ')}.`,
      missing,
    )
  }
  for (const a of answers) {
    const problem = targetProblem(after.hotWater, a.heatingPart, a.heatingTarget ?? null)
    if (problem !== null) throw new HeatingError(400, `„${offen.find((c) => c.id === a.id)?.description ?? a.id}“: ${problem}.`)
  }
  const currentItems = await readCostItems(db)

  // Zähler, die fehlen: je angeschlossener Wohnung Wärme, bei Warmwasser auch Warmwasser; an der Anlage
  // der Wärmezähler am Speicher und der Gesamtwärmezähler, wenn gewünscht.
  const allUnits = (await readUnits(db)).filter((u) => u.propertyId === current.propertyId && servesUnit(after, u))
  const allMeters = await readMeters(db)
  const pots = after.hotWater === 'none' ? (['heating'] as const) : (['heating', 'water'] as const)
  const plans: Record<string, unknown>[] = []
  for (const u of allUnits) {
    for (const pot of pots) {
      const type = POT_METER[pot]
      if (allMeters.some((m) => m.unitId === u.id && m.type === type)) continue
      plans.push({ propertyId: current.propertyId, name: `${type === 'waerme' ? 'Wärme' : 'Warmwasser'} ${u.name}`, unitId: u.id, type, unit: type === 'waerme' ? 'kWh' : 'm³' })
    }
  }
  const plantMeter = (role: 'dhwHeat' | 'totalHeat', name: string) => {
    if (allMeters.some((m) => m.heatingPlantId === plantId && m.heatingRole === role)) return
    plans.push({ propertyId: current.propertyId, name, unitId: null, type: 'waerme', unit: 'kWh', heatingPlantId: plantId, heatingRole: role })
  }
  if (raw(body, 'dhwHeatMeter') === true && after.hotWater === 'combined') plantMeter('dhwHeat', 'Wärmezähler Warmwasserspeicher')
  if (raw(body, 'totalHeatMeter') === true) plantMeter('totalHeat', 'Gesamtwärmezähler')

  const createdIds: string[] = []
  await db.transaction(async (tx) => {
    await tx.update(heatingPlants).set(plantRow(after)).where(eq(heatingPlants.id, plantId))
    for (const a of answers) {
      const item = currentItems.find((c) => c.id === a.id)
      if (!item) continue
      await patchCostItemIn(tx, item, {
        key: 'heatingSystem', heatingPart: a.heatingPart, heatingTarget: a.heatingTarget,
        directUnitId: null, meterType: null, customShares: null, participantUnitIds: null, externalBasis: null, tenancyAmounts: null, selfAmounts: null,
      })
    }
    const id = await ensureHeatingPeriod(tx, plantId, h.key)
    await tx.update(heatingPeriods).set({
      heatConsumptionPct: shares.heating, waterConsumptionPct: shares.water, insulationRule: shares.insulationRule,
      dhwMethod: after.hotWater === 'combined' ? 'heatMeter' : null,
    }).where(eq(heatingPeriods.id, id))
    for (const p of plans) {
      const meterId = newId()
      await insertEntityIn(tx, 'meters', meterId, p)
      createdIds.push(meterId)
    }
  })
  const plant = (await readHeatingPlants(db)).find((p) => p.id === plantId)
  if (!plant) throw new Error('Die Heizanlage ist nach der Einrichtung nicht auffindbar.')
  const created = (await readMeters(db)).filter((m) => createdIds.includes(m.id))
  return { plant, created, converted: answers.length }
}

// `null`, wenn es die Wohnung nicht gibt.
export async function saveInterimGap(db: Database, unitId: string, date: string, body: unknown): Promise<InterimGap | null> {
  if (!ISO_DATE.test(date)) throw new HeatingError(400, 'Das Datum der Grenze ist kein Datum.')
  const status = oneOfOrUndefined(INTERIM_GAP_STATUS, raw(body, 'status'))
  if (status === undefined) throw new HeatingError(400, 'Bitte wählen Sie, ob die Zwischenablesung nicht möglich war oder nicht durchgeführt wurde.')
  const [unit] = await db.select({ id: units.id }).from(units).where(eq(units.id, unitId))
  if (!unit) return null
  const reasonRaw = raw(body, 'reason')
  const reason = typeof reasonRaw === 'string' ? reasonRaw.trim() : ''
  await db.transaction(async (tx) => {
    await tx.delete(interimReadingGaps).where(and(eq(interimReadingGaps.unitId, unitId), eq(interimReadingGaps.date, date)))
    await tx.insert(interimReadingGaps).values({ unitId, date, status, reason })
  })
  return { unitId, date, status, reason }
}

export async function removeInterimGap(db: Database, unitId: string, date: string): Promise<boolean> {
  const before = await db.select({ unitId: interimReadingGaps.unitId }).from(interimReadingGaps).where(and(eq(interimReadingGaps.unitId, unitId), eq(interimReadingGaps.date, date)))
  if (before.length === 0) return false
  await db.delete(interimReadingGaps).where(and(eq(interimReadingGaps.unitId, unitId), eq(interimReadingGaps.date, date)))
  return true
}

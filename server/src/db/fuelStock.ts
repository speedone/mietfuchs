// Der Vorrat je Heizperiode (Heizung PR 8, #97, #99; Entwurf 5.3, 8.2): speichern, entfernen und die
// Ansicht der Karte „Vorrat“. Die Bestandsrechnung steht in ../fuelStock.ts, die Kette der Vorperioden
// baut snapshot.ts (`stockChainsOf`); Ansicht und Abrechnung rechnen also dasselbe.
//
// **Der Anfangsbestand** wird nur in der ersten Heizperiode mit Vorrat eingetragen. Hat die
// Vorperiode einen Endbestand, ist er der Anfangsbestand (derselbe Tank, dieselbe Peilung); eine
// eigene Eingabe wird abgelehnt, und eine frühere wird beim Speichern geleert, damit kein Wert gilt,
// den niemand mehr sieht.
//
// **Gesperrt** (G-A4) ist der Vorrat einer abgeschlossenen Heizperiode, und ebenso Einheit und
// Endbestand einer offenen, deren abgeschlossene Folgeperiode diesen Endbestand übernommen hat: Sonst
// gäbe sie nach dem Wiederöffnen etwas anderes weiter, als die Folgeperiode eingefroren hat.
import { and, eq } from 'drizzle-orm'
import { isStockEnergy } from '../../../shared/fuelStock.ts'
import { co2CostsBefore, co2CostsCountedFrom, co2CostsExcludedUntil } from '../../../shared/law/co2kostaufg.ts'
import { dayAfter, germanDate, valueAt } from '../../../shared/law/register.ts'
import { periodContaining, periodLabel } from '../../../shared/period.ts'
import type { BillingPeriod, HeatingPlant, HeatingStockStatement, StockRow, StockView } from '../../../shared/types.ts'
import { CO2_FUELS } from '../co2.ts'
import { problemText, readFrozenStock, settledByDefault, stockOf, type StockOptions, type StockPeriodInput } from '../fuelStock.ts'
import { stockChainsOf } from '../snapshot.ts'
import type { Database } from './client.ts'
import { closedText, dropIfEmpty, ensureHeatingPeriod, heatingPeriodClosed, heatingPeriodOf, plantContext, type PlantContext } from './heatingPeriodContext.ts'
import { readStock, type Stock, type StoredClosedHeatingSettlement, type StoredClosedSettlement } from './read.ts'
import { has, HeatingError, ISO_DATE, plantSpanOf, raw } from './repository.ts'
import { heatingPeriods, STOCK_UNITS } from './schema.ts'

const NOT_STOCK = 'Einen Vorrat gibt es nur bei Heizöl, Flüssiggas, Pellets, Holz und Kohle.'
const LATER_SELF = 'Den Vorrat bei der eigenen Heizkostenabrechnung rechnet Mietfuchs mit einer späteren Version.'
const NUMBER = 'Mengen und kg sind je eine Zahl ab 0, zum Beispiel 1800 oder 5352,6.'
const CENTS = 'Beträge sind ganze Cent ab 0.'
const UNIT = 'Bitte wählen Sie die Einheit des Vorrats: Liter, Kilogramm oder Schüttraummeter.'
const DATE = 'Der Tag der Peilung ist kein Datum. Bitte wählen Sie ihn im Kalender oder lassen Sie das Feld leer.'
const derivedText = (label: string) => `Der Anfangsbestand ergibt sich aus dem Endbestand der Heizperiode ${label}. Ändern Sie ihn dort; hier ist er nicht einzutragen.`
const lockedText = (label: string) =>
  `Die Heizperiode ${label} ist abgeschlossen; sie rechnet mit diesem Endbestand. Einheit und Endbestand bleiben deshalb, wie sie sind. Öffnen Sie die Abrechnung ${label} wieder, um sie zu ändern.`

const EMPTY: StockRow = {
  stockUnit: null, openingQuantity: null, openingCostCents: null, openingEmissionsKg: null, openingCo2Cents: null,
  openingInvoicedBefore2023: null, openingAlreadySettled: null, closingQuantity: null, closingMeasuredOn: null,
}
const OPENING_KEYS = ['openingQuantity', 'openingCostCents', 'openingEmissionsKg', 'openingCo2Cents', 'openingInvoicedBefore2023', 'openingAlreadySettled'] as const

// Was die Bestandsrechnung einer Anlage verlangt (fuelStock.ts): Beträge, wenn nach Verbrauch verteilt
// wird (freie Schlüssel), kg und CO₂-Kosten bei Heizöl, Flüssiggas und Kohle. Das Register beantwortet
// § 11 Abs. 2 Satz 2 hier ohne Protokoll; in der Abrechnung protokolliert `law()`.
export function stockOptionsFor(plant: Pick<HeatingPlant, 'energy' | 'method'>): StockOptions {
  return {
    needCost: plant.method === 'manual',
    needCo2: CO2_FUELS.includes(plant.energy),
    countedAt: (date) => !valueAt(co2CostsBefore, date),
    excludedUntil: co2CostsExcludedUntil(),
    countedFrom: co2CostsCountedFrom(),
  }
}

const rowOf = (r: StockRow | undefined): StockRow => (r ? {
  stockUnit: r.stockUnit, openingQuantity: r.openingQuantity, openingCostCents: r.openingCostCents, openingEmissionsKg: r.openingEmissionsKg,
  openingCo2Cents: r.openingCo2Cents, openingInvoicedBefore2023: r.openingInvoicedBefore2023, openingAlreadySettled: r.openingAlreadySettled,
  closingQuantity: r.closingQuantity, closingMeasuredOn: r.closingMeasuredOn,
} : { ...EMPTY })

// Die Kette dieser Heizperiode, wie die Abrechnung sie bekommt (snapshot.ts). Abgeschlossene
// Abrechnungen nur des eigenen Objekts, denn Zeitraumschlüssel wiederholen sich zwischen Objekten.
function chainOf(stock: Stock, ctx: PlantContext, h: BillingPeriod): StockPeriodInput[] {
  const closed: StoredClosedSettlement[] = stock.closedSettlements
  const [entry] = stockChainsOf({
    costItems: stock.costItems,
    closedSettlements: closed.filter((c) => c.propertyId === ctx.plant.propertyId),
    closedHeatingSettlements: stock.closedHeatingSettlements,
    heatingPeriodRows: stock.heatingPeriodRows,
    fuelDeliveries: stock.fuelDeliveries,
  }, ctx.plant, ctx.objectRules, [h], stock.heatingPlants.filter((p) => p.propertyId === ctx.plant.propertyId))
  return entry?.chain ?? []
}

// Die Folgeperiode, wenn sie abgeschlossen ist, mit oder ohne Vorrat (Befunde C2, I2 der Durchsicht von
// #237): Dann bleiben Einheit und Endbestand, wie sie sind.
function lockedBy(chain: readonly StockPeriodInput[], ctx: PlantContext, h: BillingPeriod): StockView['closingLockedBy'] {
  const last = chain.at(-1)
  if (!last?.nextFrozenOpening && !last?.nextClosedWithoutStock) return null
  const next = periodContaining(ctx.plantRules, dayAfter(h.to))
  return { period: next.key, label: periodLabel(next) }
}

// Die Ansicht einer Heizperiode: eingetragen, Anfangsbestand aus der Vorperiode, Bestandsrechnung, was
// fehlt.
// Die eingefrorene Bestandsrechnung einer abgeschlossenen Heizperiode aus ihrem Stand (M1).
function frozenStatementOf(stock: Stock, ctx: PlantContext, h: BillingPeriod): HeatingStockStatement | null {
  const closed: StoredClosedSettlement[] = stock.closedSettlements
  const heatingClosed: StoredClosedHeatingSettlement[] = stock.closedHeatingSettlements
  const stands = [...closed.filter((c) => c.propertyId === ctx.plant.propertyId).map((c) => c.settlement), ...heatingClosed.filter((c) => c.plantId === ctx.plant.id).map((c) => c.settlement)]
  for (const st of stands) {
    const heating: unknown = st !== null && typeof st === 'object' ? Reflect.get(st, 'heating') : undefined
    if (!Array.isArray(heating)) continue
    for (const x of heating) {
      if (x === null || typeof x !== 'object' || Reflect.get(x, 'plantId') !== ctx.plant.id || Reflect.get(x, 'period') !== h.key) continue
      const s: unknown = Reflect.get(x, 'stock')
      if (s !== null && typeof s === 'object' && readFrozenStock(Reflect.get(s, 'closing'))) return s as HeatingStockStatement
    }
  }
  return null
}

export function stockViewFor(stock: Stock, ctx: PlantContext, h: BillingPeriod, closed = false): StockView {
  const opts = stockOptionsFor(ctx.plant)
  const chain = chainOf(stock, ctx, h)
  const prev = chain.length > 1 ? chain[chain.length - 2] : undefined
  let derived: StockView['derived'] = null
  if (prev?.frozenClosing) derived = { value: prev.frozenClosing, period: prev.key, label: prev.label, frozen: true }
  else if (prev) {
    const before = stockOf(chain.slice(0, -1), opts)
    if (before.ok) derived = { value: before.statement.closing, period: prev.key, label: prev.label, frozen: false }
  }
  const result = stockOf(chain, opts)
  const row = rowOf(stock.heatingPeriodRows.find((r) => r.plantId === ctx.plant.id && r.period === h.key))
  return {
    row,
    derived,
    closingLockedBy: lockedBy(chain, ctx, h),
    askAlreadySettled: derived === null && (chain.at(-1)?.previousFuel ?? null) !== null,
    defaultAlreadySettled: derived === null ? settledByDefault(chain.at(-1)?.previousFuel, row.openingCostCents) : null,
    statement: result.ok ? result.statement : null,
    frozen: closed ? frozenStatementOf(stock, ctx, h) : null,
    problem: result.ok ? null : problemText(result.problem),
  }
}

// Eine Zahl aus dem Rumpf: fehlt der Schlüssel, bleibt der bisherige Wert; leer heißt null; alles
// andere muss eine Zahl ab 0 sein, bei Beträgen ganze Cent. Ein ungültiger Wert ist ein Fehler mit
// Satz, kein stilles Weglassen.
function numberField(body: unknown, key: keyof StockRow, current: number | null, cents: boolean): number | null {
  if (!has(body, key)) return current
  const v = raw(body, key)
  if (v === null || v === undefined || v === '') return null
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new HeatingError(400, cents ? CENTS : NUMBER)
  if (cents && !Number.isInteger(v)) throw new HeatingError(400, CENTS)
  return v
}

function booleanField(body: unknown, key: keyof StockRow, current: boolean | null): boolean | null {
  if (!has(body, key)) return current
  const v = raw(body, key)
  return typeof v === 'boolean' ? v : null
}

function mergeStock(current: StockRow, body: unknown): StockRow {
  const unitRaw = has(body, 'stockUnit') ? raw(body, 'stockUnit') : current.stockUnit
  const stockUnit = unitRaw === null || unitRaw === undefined || unitRaw === '' ? null : STOCK_UNITS.find((u) => u === unitRaw)
  if (stockUnit === undefined) throw new HeatingError(400, UNIT)
  const before = has(body, 'openingInvoicedBefore2023') ? raw(body, 'openingInvoicedBefore2023') : current.openingInvoicedBefore2023
  const measuredRaw = has(body, 'closingMeasuredOn') ? raw(body, 'closingMeasuredOn') : current.closingMeasuredOn
  const closingMeasuredOn = measuredRaw === null || measuredRaw === undefined || measuredRaw === '' ? null : String(measuredRaw)
  if (closingMeasuredOn !== null && !ISO_DATE.test(closingMeasuredOn)) throw new HeatingError(400, DATE)
  const next: StockRow = {
    stockUnit,
    openingQuantity: numberField(body, 'openingQuantity', current.openingQuantity, false),
    openingCostCents: numberField(body, 'openingCostCents', current.openingCostCents, true),
    openingEmissionsKg: numberField(body, 'openingEmissionsKg', current.openingEmissionsKg, false),
    openingCo2Cents: numberField(body, 'openingCo2Cents', current.openingCo2Cents, true),
    openingInvoicedBefore2023: typeof before === 'boolean' ? before : null,
    openingAlreadySettled: booleanField(body, 'openingAlreadySettled', current.openingAlreadySettled),
    closingQuantity: numberField(body, 'closingQuantity', current.closingQuantity, false),
    closingMeasuredOn,
  }
  if ((next.openingQuantity !== null || next.closingQuantity !== null) && next.stockUnit === null) throw new HeatingError(400, UNIT)
  return next
}

// Gilt für eine Anlage überhaupt ein Vorrat, den Mietfuchs rechnet?
function guardPlant(ctx: PlantContext): void {
  if (!isStockEnergy(ctx.plant.energy)) throw new HeatingError(400, NOT_STOCK)
  if (ctx.plant.method === 'self') throw new HeatingError(400, LATER_SELF)
}

// `null`, wenn es die Anlage nicht gibt; die Route macht daraus ihre 404.
export async function saveStock(db: Database, plantId: string, period: string, body: unknown): Promise<StockView | null> {
  const ctx = await plantContext(db, plantId)
  if (!ctx) return null
  guardPlant(ctx)
  const h = heatingPeriodOf(ctx, period)
  // Kesseltausch (Durchsicht von #238, I3): Vorrat nur in Heizperioden, in denen die Anlage heizt.
  const span = await plantSpanOf(db, plantId)
  if (span.to !== null && h.from > span.to) {
    throw new HeatingError(400, `Die Heizanlage „${span.name}“ ist seit dem ${germanDate(dayAfter(span.to))} außer Betrieb; in der Heizperiode ${periodLabel(h)} hat sie keinen Vorrat. Tragen Sie ihn bei der neuen Anlage ein.`)
  }
  if (span.from !== null && h.to < span.from) {
    throw new HeatingError(400, `Die Heizanlage „${span.name}“ heizt erst seit dem ${germanDate(span.from)}; in der Heizperiode ${periodLabel(h)} hat sie keinen Vorrat.`)
  }
  const stock = await readStock(db)
  const current = rowOf(stock.heatingPeriodRows.find((r) => r.plantId === plantId && r.period === h.key))
  const chain = chainOf(stock, ctx, h)
  const prev = chain.length > 1 ? chain[chain.length - 2] : undefined
  if (prev && OPENING_KEYS.some((k) => has(body, k) && raw(body, k) !== null && raw(body, k) !== '')) {
    // Nach einem Kesseltausch mit demselben Brennstoff ist es der Restbestand der alten Anlage (Nachprüfung von #238).
    const before = ctx.plant.replacesPlantId && ctx.plant.takesOverStock !== false ? stock.heatingPlants.find((p) => p.id === ctx.plant.replacesPlantId && p.energy === ctx.plant.energy) : undefined
    if (before?.endsOn && h.from <= dayAfter(before.endsOn) && dayAfter(before.endsOn) <= h.to) {
      throw new HeatingError(400, `Der Anfangsbestand ist der Restbestand der Heizanlage „${before.name.trim() || 'vor dem Tausch'}“ zum ${germanDate(before.endsOn)}; ändern Sie ihn dort als Endbestand. Verheizt die neue Heizanlage den Brennstoff im Tank nicht weiter, wählen Sie bei ihr unter „Verheizt der neue Kessel den Brennstoff im Tank weiter?“ „Nein“; dann tragen Sie hier einen eigenen Anfangsbestand ein.`)
    }
    throw new HeatingError(400, derivedText(prev.label))
  }
  const next = mergeStock(current, body)
  if (prev) for (const k of OPENING_KEYS) next[k] = null
  const locked = lockedBy(chain, ctx, h)
  if (locked && (next.stockUnit !== current.stockUnit || next.closingQuantity !== current.closingQuantity)) throw new HeatingError(409, lockedText(locked.label))
  const following = periodContaining(ctx.plantRules, dayAfter(h.to))
  await db.transaction(async (tx) => {
    if (await heatingPeriodClosed(tx, ctx, h)) throw new HeatingError(409, closedText(h))
    const id = await ensureHeatingPeriod(tx, plantId, h.key)
    await tx.update(heatingPeriods).set(next).where(eq(heatingPeriods.id, id))
    await dropIfEmpty(tx, id)
    // Mit einem Endbestand hier übernimmt die Folgeperiode ihn als Anfangsbestand; ein dort früher
    // eingetragener eigener Anfangsbestand gälte sonst wieder, sobald dieser Vorrat entfernt wird
    // (Nachprüfung von 7ce5958, Befund 2). Eine abgeschlossene Folgeperiode bleibt, wie sie ist.
    if (next.closingQuantity !== null && !(await heatingPeriodClosed(tx, ctx, following))) {
      await tx.update(heatingPeriods).set({ openingQuantity: null, openingCostCents: null, openingEmissionsKg: null, openingCo2Cents: null, openingInvoicedBefore2023: null, openingAlreadySettled: null })
        .where(and(eq(heatingPeriods.plantId, plantId), eq(heatingPeriods.period, following.key)))
    }
  })
  return stockViewFor(await readStock(db), ctx, h)
}

// `true` geleert, `false` gab es keinen Vorrat, `null` keine Anlage. Die Zeile der Heizperiode
// bleibt, solange an ihr noch etwas hängt (Warmwasser, CO₂-Angaben, eingefrorene Lieferungen).
export async function removeStock(db: Database, plantId: string, period: string): Promise<boolean | null> {
  const ctx = await plantContext(db, plantId)
  if (!ctx) return null
  const h = heatingPeriodOf(ctx, period)
  const [own] = await db.select().from(heatingPeriods).where(and(eq(heatingPeriods.plantId, plantId), eq(heatingPeriods.period, h.key)))
  if (!own || Object.values(rowOf(own)).every((v) => v === null)) return false
  const locked = isStockEnergy(ctx.plant.energy) ? lockedBy(chainOf(await readStock(db), ctx, h), ctx, h) : null
  await db.transaction(async (tx) => {
    if (await heatingPeriodClosed(tx, ctx, h)) throw new HeatingError(409, closedText(h))
    if (locked && (own.stockUnit !== null || own.closingQuantity !== null)) throw new HeatingError(409, lockedText(locked.label))
    await tx.update(heatingPeriods).set({ ...EMPTY }).where(eq(heatingPeriods.id, own.id))
    await dropIfEmpty(tx, own.id)
    // Die Folgeperiode beginnt jetzt selbst; eine früher gegebene Antwort auf „schon umgelegt?“ galt einer
    // anderen Lage und wird zurückgesetzt (Nachprüfung von 7ce5958, Befund 2).
    const following = periodContaining(ctx.plantRules, dayAfter(h.to))
    if (!(await heatingPeriodClosed(tx, ctx, following))) {
      await tx.update(heatingPeriods).set({ openingAlreadySettled: null }).where(and(eq(heatingPeriods.plantId, plantId), eq(heatingPeriods.period, following.key)))
    }
  })
  return true
}

// Monatliche Verbrauchsinformation (Heizung PR 22): Vergleichswert und Tag der Mitteilung je Anlage und
// Monat speichern; die Monate einer Heizperiode für die Seite Heizkosten zusammenstellen. Die Rechnung steht
// in server/src/monthlyInfo.ts, die Bedingungen der Tabelle in schema.ts sind das Netz darunter.
import { and, eq } from 'drizzle-orm'
import type { HeatingPlant, MonthlyInfoRow, MonthlyInfoView } from '../../../shared/types.ts'
import { createLawLog, dayAfter, germanDate } from '../../../shared/law/register.ts'
import { captureOf, hotWaterOf, lineRoot } from '../../../shared/heatingPeriod.ts'
import { monthBounds, monthName } from '../../../shared/monthlyInfo.ts'
import { effectiveRules, heatingRulesOf } from '../heatingInfo.ts'
import { heatingPlantAt, monthlyInfoMonths } from '../monthlyInfo.ts'
import { narrowToProperty } from '../snapshot.ts'
import type { Database, Executor } from './client.ts'
import { heatingPeriodOf, plantContext } from './heatingPeriodContext.ts'
import { readHeatingPlants, readStock } from './read.ts'
import { has, HeatingError } from './repository.ts'
import { heatingMonthlyInfo } from './schema.ts'

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const isDay = (text: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(text) && new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) === text

// Die Anlagen der Linie einer Anlage (Kesseltausch), in der Reihenfolge des Bestands.
const lineOf = <P extends Pick<HeatingPlant, 'id' | 'replacesPlantId'>>(plant: P, plants: readonly P[]): P[] =>
  plants.filter((p) => lineRoot(p, plants) === lineRoot(plant, plants))

// Ein Teilrumpf ergänzt (wie PUT überall in Mietfuchs), `null` leert. Gespeichert wird an der Anlage der Linie,
// die am Monatsende heizt (Prüfung S5): Die Information gilt dem Nutzer, nicht dem Kessel. Ohne Anlage null.
export async function saveMonthlyInfoRow(db: Executor, plantId: string, month: string, body: unknown): Promise<MonthlyInfoRow | null> {
  const plants = await readHeatingPlants(db)
  const plant = plants.find((p) => p.id === plantId)
  if (!plant) return null
  if (!MONTH.test(month)) throw new HeatingError(400, `„${month}“ ist kein Monat in der Form JJJJ-MM. Bitte laden Sie die Seite neu.`)
  const target = heatingPlantAt(lineOf(plant, plants), monthBounds(month).to)?.id ?? plant.id
  const where = and(eq(heatingMonthlyInfo.plantId, target), eq(heatingMonthlyInfo.month, month))
  const [current] = await db.select().from(heatingMonthlyInfo).where(where)
  const field = (key: string): unknown => (has(body, key) ? Reflect.get(Object(body), key) : undefined)
  const ref = has(body, 'referenceKwhPerM2') ? field('referenceKwhPerM2') : current?.referenceKwhPerM2 ?? null
  const sourceRaw = has(body, 'referenceSource') ? field('referenceSource') : current?.referenceSource ?? null
  const sent = has(body, 'sentOn') ? field('sentOn') : current?.sentOn ?? null
  if (ref !== null && (typeof ref !== 'number' || !Number.isFinite(ref) || ref <= 0)) {
    throw new HeatingError(400, 'Der Vergleichswert ist eine Zahl größer als 0 (kWh je m² Wohnfläche im Monat).')
  }
  const source = typeof sourceRaw === 'string' ? sourceRaw.trim() || null : null
  if (ref !== null && source === null) {
    throw new HeatingError(400, 'Bitte nennen Sie die Quelle des Vergleichswerts, etwa die Vergleichsdaten Ihres Ablesedienstes. Ein Durchschnitt aus Ihrem eigenen Haus ist kein zulässiger Vergleich.')
  }
  if (sent !== null) {
    if (typeof sent !== 'string' || !isDay(sent)) throw new HeatingError(400, 'Der Tag der Mitteilung ist kein Datum. Bitte wählen Sie ihn im Kalender.')
    // Die Information nennt den Verbrauch des ganzen Monats (Review Focus 5).
    const earliest = dayAfter(monthBounds(month).to)
    if (sent < earliest) {
      throw new HeatingError(400, `Die Information für ${monthName(month)} nennt den Verbrauch des ganzen Monats und kann frühestens am ${germanDate(earliest)} mitgeteilt werden.`)
    }
  }
  const next: MonthlyInfoRow = { plantId: target, month, referenceKwhPerM2: ref, referenceSource: source, sentOn: sent }
  if (current) {
    await db.update(heatingMonthlyInfo).set({ referenceKwhPerM2: next.referenceKwhPerM2, referenceSource: next.referenceSource, sentOn: next.sentOn }).where(where)
  } else {
    await db.insert(heatingMonthlyInfo).values(next)
  }
  return next
}

// Die Monate einer Heizperiode mit den Informationen je Mieter. Null ohne Anlage; ein unbekannter Schlüssel
// ergibt 400 (heatingPeriodOf). Mietfuchs erstellt die Information nur bei eigener Abrechnung einer zentralen
// Anlage mit eigenen Zählern (nicht mit Werten des Ablesedienstes) und nur, soweit § 6a nach § 11 gilt; wie
// die Abrechnung (calc.ts, `heating.monthly-info`).
export async function monthlyInfoView(db: Database, plantId: string, periodText: string, today: string): Promise<MonthlyInfoView | null> {
  const ctx = await plantContext(db, plantId)
  if (!ctx) return null
  const h = heatingPeriodOf(ctx, periodText)
  const key = String(h.key)
  const stock = await readStock(db)
  const plant = stock.heatingPlants.find((p) => p.id === plantId) ?? ctx.plant
  const own = stock.heatingPlants.filter((p) => p.propertyId === plant.propertyId)
  const line = lineOf(plant, own)
  // Die Anlagen der Linie, die in dieser Heizperiode heizen.
  const group = line.filter((p) => {
    if (p.endsOn && p.endsOn < h.from) return false
    const before = p.replacesPlantId ? line.find((x) => x.id === p.replacesPlantId) : undefined
    return !before?.endsOn || before.endsOn < h.to
  })
  const rules = effectiveRules(heatingRulesOf(stock.heatingPeriodRows, own, plant.id, key), hotWaterOf(plant, key))
  const lineIds = new Set(line.map((p) => p.id))
  const rowsOfPeriod = stock.heatingPeriodRows.filter((r) => lineIds.has(r.plantId) && String(r.period) === key)
  const ownRow = rowsOfPeriod.find((r) => r.plantId === plant.id)
  const dhwTempC = ownRow?.dhwTempC ?? rowsOfPeriod.find((r) => r.dhwTempC !== null)?.dhwTempC ?? null
  const selfMade = plant.method === 'self' && (plant.supply ?? 'central') === 'central' && captureOf(plant, key) !== 'serviceValues' && rules.exemptionScope !== 'both'
  const { units, tenancies, meters, readings } = narrowToProperty(stock, plant.propertyId)
  const months = selfMade
    ? monthlyInfoMonths({
        plants: group,
        meters,
        units: units.map((u) => ({ id: u.id, name: u.name, areaM2: u.areaM2 || 0, noConnection: u.noConnection })),
        tenancies,
        readings,
        rows: stock.monthlyInfoRows.filter((r) => lineIds.has(r.plantId)),
        dhwTempC,
        h: { from: h.from, to: h.to },
        parts: { heat: rules.exemptionScope !== 'heat', water: hotWaterOf(plant, key) !== 'none' },
        asOf: today,
      }, createLawLog())
    : []
  const ref = ownRow?.infoReferenceKwhPerM2 ?? null
  return {
    plantId: plant.id,
    period: h.key,
    managed: months.length > 0,
    elsewhere: rules.monthlyInfoElsewhere,
    months,
    periodReference: ref === null ? null : { kwhPerM2: ref, source: ownRow?.infoReferenceSource ?? null },
  }
}

// Werte eines Ablesedienstes je Wohnung und Nutzungszeitraum (Heizung PR 12, Entwurf 5.6, 8.1). Der
// Rumpf ersetzt alle Zeilen der Heizperiode in einer Transaktion: Die Karte zeigt und schickt immer die
// ganze Liste.
import { eq } from 'drizzle-orm'
import type { HeatingPlant, HeatingServiceValue, Unit } from '../../../shared/types.ts'
import { servesUnit } from '../../../shared/heatingPeriod.ts'
import { germanDate } from '../../../shared/law/register.ts'
import { captureOf } from '../hca.ts'
import { selfActive } from '../heating.ts'
import { closedText, ensureHeatingPeriod, heatingPeriodClosed, heatingPeriodOf, plantContext } from './heatingPeriodContext.ts'
import type { Database } from './client.ts'
import { readUnits } from './read.ts'
import { HeatingError, ISO_DATE, raw } from './repository.ts'
import { heatingServiceValues } from './schema.ts'

type Row = Omit<HeatingServiceValue, 'plantId' | 'period'>
type Span = { from: string; to: string }

// Eine Zahl oder leer; was keine Zahl ist, ist `undefined` und wird mit einem Satz abgelehnt.
const numberOrNull = (v: unknown): number | null | undefined =>
  v === null || v === undefined ? null : typeof v === 'number' && Number.isFinite(v) ? v : undefined

function readRow(item: unknown, h: Span, propertyUnits: readonly Unit[], plant: HeatingPlant): Row {
  const unitId = raw(item, 'unitId')
  const unit = typeof unitId === 'string' ? propertyUnits.find((u) => u.id === unitId) : undefined
  if (!unit) throw new HeatingError(400, 'Diese Wohnung gibt es in diesem Objekt nicht (mehr). Bitte laden Sie die Seite neu; gespeichert wurde nichts.')
  if (!servesUnit(plant, unit)) throw new HeatingError(400, `Die Wohnung „${unit.name}“ hängt nicht an dieser Heizanlage. Gespeichert wurde nichts.`)
  const from = raw(item, 'from')
  const to = raw(item, 'to')
  if (typeof from !== 'string' || typeof to !== 'string' || !ISO_DATE.test(from) || !ISO_DATE.test(to) || from > to) {
    throw new HeatingError(400, `Bei „${unit.name}“ ist der Zeitraum kein gültiger Zeitraum: Beginn und Ende sind Daten, und das Ende liegt nicht vor dem Beginn. Gespeichert wurde nichts.`)
  }
  if (from < h.from || to > h.to) {
    throw new HeatingError(400, `Die Zeile für „${unit.name}“ vom ${germanDate(from)} bis ${germanDate(to)} liegt nicht ganz in der Heizperiode (${germanDate(h.from)} bis ${germanDate(h.to)}). Gespeichert wurde nichts.`)
  }
  const heatValue = numberOrNull(raw(item, 'heatValue'))
  if (heatValue === null || heatValue === undefined || !(heatValue >= 0)) throw new HeatingError(400, `Der Wert für die Heizung bei „${unit.name}“ ist eine Zahl ab 0. Gespeichert wurde nichts.`)
  const waterValue = numberOrNull(raw(item, 'waterValue'))
  if (waterValue === undefined || (waterValue !== null && !(waterValue >= 0))) throw new HeatingError(400, `Der Wert für das Warmwasser bei „${unit.name}“ ist eine Zahl ab 0 oder leer. Gespeichert wurde nichts.`)
  // Worin der Dienst die Heizung nennt (Durchsicht von #241, Recht-I4); ohne Angabe bewertete Einheiten.
  const unitRaw = raw(item, 'heatUnit')
  const heatUnit = unitRaw === undefined || unitRaw === null ? 'units' : unitRaw === 'units' || unitRaw === 'kWh' ? unitRaw : null
  if (heatUnit === null) throw new HeatingError(400, `Bei „${unit.name}“ ist die Einheit der Heizung weder „Einheiten“ noch „kWh“. Gespeichert wurde nichts.`)
  return { unitId: unit.id, from, to, heatValue, waterValue, heatUnit }
}

// Warmwasser für alle Zeilen oder für keine (Abweichung 3, Review Focus 3); je Wohnung kein Tag doppelt.
// Lücken bleiben Lücken: Was fehlt, behandelt die Abrechnung wie eine fehlende Ablesung (Review Focus 2).
function checkRows(rows: readonly Row[], propertyUnits: readonly Unit[]): void {
  const withWater = rows.filter((r) => r.waterValue !== null).length
  if (withWater > 0 && withWater < rows.length) {
    throw new HeatingError(400, 'Tragen Sie die Werte für das Warmwasser bitte für alle Zeilen ein oder für keine; sonst käme das Warmwasser teils vom Ablesedienst und teils von den Warmwasserzählern. Gespeichert wurde nichts.')
  }
  for (const unit of propertyUnits) {
    const own = rows.filter((r) => r.unitId === unit.id).sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
    for (let i = 1; i < own.length; i++) {
      const prev = own[i - 1]
      const next = own[i]
      if (prev && next && next.from <= prev.to) {
        throw new HeatingError(400,
          `Die Zeilen für „${unit.name}“ überschneiden sich (${germanDate(prev.from)} bis ${germanDate(prev.to)} und ${germanDate(next.from)} bis ${germanDate(next.to)}). Jeder Tag einer Wohnung zählt nur einmal. Gespeichert wurde nichts.`)
      }
    }
  }
}

// `null` heißt: Die Anlage gibt es nicht.
export async function saveServiceValues(db: Database, plantId: string, period: string, body: unknown): Promise<HeatingServiceValue[] | null> {
  const ctx = await plantContext(db, plantId)
  if (!ctx) return null
  const h = heatingPeriodOf(ctx, period)
  // Die Erfassung der Heizperiode (ihr Zeitraum der eigenen Abrechnung), nicht die heutige der Anlage.
  if (!selfActive(ctx.plant, String(h.key)) || captureOf(ctx.plant, String(h.key)) !== 'serviceValues') {
    throw new HeatingError(400, 'Werte eines Ablesedienstes gibt es nur bei eigener Heizkostenabrechnung mit der Erfassung „Werte eines Ablesedienstes“ in dieser Heizperiode. Stellen Sie das unter Stammdaten bei der Heizung ein.')
  }
  const list = raw(body, 'values')
  if (!Array.isArray(list)) throw new HeatingError(400, 'Bitte schicken Sie die Werte des Ablesedienstes als Liste.')
  const propertyUnits = (await readUnits(db)).filter((u) => u.propertyId === ctx.plant.propertyId)
  const rows = list.map((item) => readRow(item, h, propertyUnits, ctx.plant))
  checkRows(rows, propertyUnits)
  await db.transaction(async (tx) => {
    if (await heatingPeriodClosed(tx, ctx, h)) throw new HeatingError(409, closedText(h))
    const heatingPeriodId = await ensureHeatingPeriod(tx, plantId, h.key)
    await tx.delete(heatingServiceValues).where(eq(heatingServiceValues.heatingPeriodId, heatingPeriodId))
    if (rows.length > 0) await tx.insert(heatingServiceValues).values(rows.map((r) => ({ heatingPeriodId, ...r })))
  })
  return rows.map((r) => ({ plantId, period: h.key, ...r }))
}

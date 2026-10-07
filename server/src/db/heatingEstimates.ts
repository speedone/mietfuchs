// Schätzungen nach § 9a HeizkostenV (Heizung PR 13, Entwurf 5.6, 8.7): je Heizperiode, Wohnung und Topf
// der geschätzte Verbrauch mit Weg, Begründung und Bestätigung. Geschätzt wird nur bei eigener
// Heizkostenabrechnung; rechnet ein Messdienst ab, schätzt dieser.
import { and, eq } from 'drizzle-orm'
import { servesUnit } from '../../../shared/heatingPeriod.ts'
import type { EstimatePart, HeatingEstimate } from '../../../shared/types.ts'
import { captureOf, hotWaterOf, lineServiceRows, potUnitFor } from '../hca.ts'
import { estimateDeviceType, selfActive } from '../heating.ts'
import type { Database } from './client.ts'
import { closedText, dropIfEmpty, ensureHeatingPeriod, heatingPeriodClosed, heatingPeriodOf, plantContext } from './heatingPeriodContext.ts'
import { readHeatingPlants, readHeatingServiceValues, readMeters, readUnits } from './read.ts'
import { HeatingError, oneOfOrUndefined, raw } from './repository.ts'
import { ESTIMATE_CAUSES, ESTIMATE_METHODS, ESTIMATE_PARTS, heatingEstimates, heatingPeriods } from './schema.ts'

const DEVICE_NAME = { waerme: 'keinen Wärmezähler', hkv: 'keinen Heizkostenverteiler', warmwasser: 'keinen Warmwasserzähler' } as const

function partOf(text: string): EstimatePart {
  const part = oneOfOrUndefined(ESTIMATE_PARTS, text)
  if (part === undefined) throw new HeatingError(400, 'Geschätzt wird der Verbrauch für die Heizung oder das Warmwasser.')
  return part
}

// `null`, wenn es die Anlage nicht gibt; die Route macht daraus ihre 404. Jede Prüfung wirft vor dem
// Schreiben, gespeichert wird also ganz oder gar nicht.
export async function saveEstimate(db: Database, plantId: string, period: string, unitId: string, partText: string, body: unknown): Promise<HeatingEstimate | null> {
  const ctx = await plantContext(db, plantId)
  if (!ctx) return null
  const h = heatingPeriodOf(ctx, period)
  const key = String(h.key)
  // Die Art der Abrechnung, die Erfassung und das Warmwasser dieser Heizperiode, nicht die heutigen der Anlage.
  if (!selfActive(ctx.plant, key)) {
    throw new HeatingError(400, 'Geschätzt nach § 9a HeizkostenV wird hier nur bei einer eigenen Heizkostenabrechnung. Rechnet ein Messdienst oder die Gemeinschaft ab, schätzt dieser; übernehmen Sie seine Beträge.')
  }
  const part = partOf(partText)
  if (part === 'water' && hotWaterOf(ctx.plant, key) === 'none') {
    throw new HeatingError(400, 'Diese Heizanlage bereitet kein Warmwasser; geschätzt werden kann nur der Verbrauch für die Heizung.')
  }
  const unit = (await readUnits(db)).find((u) => u.id === unitId && u.propertyId === ctx.plant.propertyId)
  if (!unit) throw new HeatingError(400, 'Diese Wohnung gibt es in diesem Objekt nicht (mehr). Bitte laden Sie die Seite neu; gespeichert wurde nichts.')
  if (!servesUnit(ctx.plant, unit)) throw new HeatingError(400, `Die Wohnung „${unit.name}“ hängt nicht an dieser Heizanlage.`)
  // § 9a setzt ein Gerät voraus, das ausfällt (Abweichung 4 des Plans).
  const device = estimateDeviceType(captureOf(ctx.plant, key), part)
  if (device !== null && !(await readMeters(db)).some((m) => m.unitId === unit.id && m.type === device && (m.heatingPlantId ?? null) === null)) {
    throw new HeatingError(400,
      `„${unit.name}“ hat ${DEVICE_NAME[device]}. Geschätzt wird nach § 9a HeizkostenV der Verbrauch, der wegen eines Geräteausfalls oder aus einem anderen zwingenden Grund nicht erfasst werden kann; eine Wohnung ohne Gerät ist ein Fall der Ausstattungspflicht (§§ 4, 5 HeizkostenV). Legen Sie das Gerät auf der Seite Zähler an und tragen Sie die Stände ein.`)
  }
  const value = raw(body, 'value')
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new HeatingError(400, 'Der geschätzte Verbrauch ist eine Zahl ab 0.')
  const method = oneOfOrUndefined(ESTIMATE_METHODS, raw(body, 'method'))
  if (method === undefined) throw new HeatingError(400, 'Bitte wählen Sie einen der drei Wege des § 9a Abs. 1 HeizkostenV: vergleichbarer Zeitraum, vergleichbare Wohnung oder Durchschnitt des Gebäudes.')
  const reasonText = raw(body, 'reason')
  const reason = typeof reasonText === 'string' ? reasonText.trim() : ''
  if (reason === '') throw new HeatingError(400, 'Bitte nennen Sie die Begründung, warum der Verbrauch nicht erfasst werden konnte (etwa „Wärmezähler defekt“).')
  // Der Grund nach § 9a Abs. 1 Satz 1 als Auswahl (Durchsicht von #242, R-I1).
  const cause = oneOfOrUndefined(ESTIMATE_CAUSES, raw(body, 'cause'))
  if (cause === undefined) throw new HeatingError(400, 'Bitte wählen Sie den Grund, aus dem der Verbrauch nicht ordnungsgemäß erfasst werden konnte: Gerät ausgefallen, Gerät zeigt falsch an, Ablesung nicht möglich oder ein anderer zwingender Grund.')
  const confirmed = raw(body, 'confirmed') === true
  // Erfassung und Einheit der Heizperiode beim Speichern (Durchsicht von #242, G-I1): Wechselt die Erfassung
  // danach, rechnet die Berechnung die Schätzung nicht mehr, statt den Wert in einer anderen Einheit zu verteilen.
  const capture = captureOf(ctx.plant, key)
  const serviceRows = capture === 'serviceValues' ? lineServiceRows(await readHeatingServiceValues(db), await readHeatingPlants(db), plantId, key) : []
  // Durchsicht Runde 2, N-M3: Beim Ablesedienst steht die Einheit der Heizung erst mit seinen Werten fest. Ohne Werte
  // nennt der Vermieter sie (Einheiten oder kWh); mit Werten gilt deren Einheit, eine abweichende Angabe wird abgelehnt.
  const derived = potUnitFor(capture, part === 'heat' ? 'heating' : 'water', serviceRows)
  const asked = raw(body, 'valueUnit')
  let valueUnit = derived
  if (capture === 'serviceValues' && part === 'heat') {
    const named = asked === 'kWh' || asked === 'Einheiten' ? asked : undefined
    if (asked !== undefined && asked !== null && named === undefined) throw new HeatingError(400, 'Die Einheit der Schätzung beim Ablesedienst ist „Einheiten“ oder „kWh“.')
    if (serviceRows.length === 0) {
      if (named === undefined) throw new HeatingError(400, 'Der Ablesedienst hat für diese Heizperiode noch keine Werte eingetragen. Bitte wählen Sie, in welcher Einheit die Schätzung steht: in Einheiten oder in kWh, wie der Ablesedienst die Heizung nennt.')
      valueUnit = named
    } else if (named !== undefined && named !== derived) {
      throw new HeatingError(400, `Der Ablesedienst nennt die Heizung in dieser Heizperiode in ${derived}; die Einheit der Schätzung ist deshalb ${derived}.`)
    }
  }
  await db.transaction(async (tx) => {
    if (await heatingPeriodClosed(tx, ctx, h)) throw new HeatingError(409, closedText(h))
    const heatingPeriodId = await ensureHeatingPeriod(tx, plantId, h.key)
    await tx.delete(heatingEstimates).where(and(eq(heatingEstimates.heatingPeriodId, heatingPeriodId), eq(heatingEstimates.unitId, unit.id), eq(heatingEstimates.part, part)))
    await tx.insert(heatingEstimates).values({ heatingPeriodId, unitId: unit.id, part, value, method, reason, confirmed, cause, capture, valueUnit })
  })
  return { plantId, period: h.key, unitId: unit.id, part, value, method, reason, confirmed, cause, capture, valueUnit }
}

// `null`, wenn es die Anlage nicht gibt; sonst, ob etwas entfernt wurde. Eine abgeschlossene Heizperiode
// bleibt, wie sie beim Abschluss war.
export async function removeEstimate(db: Database, plantId: string, period: string, unitId: string, partText: string): Promise<boolean | null> {
  const ctx = await plantContext(db, plantId)
  if (!ctx) return null
  const part = partOf(partText)
  const h = heatingPeriodOf(ctx, period)
  let removed = false
  await db.transaction(async (tx) => {
    if (await heatingPeriodClosed(tx, ctx, h)) throw new HeatingError(409, closedText(h))
    const [row] = await tx.select({ id: heatingPeriods.id }).from(heatingPeriods).where(and(eq(heatingPeriods.plantId, plantId), eq(heatingPeriods.period, h.key)))
    if (!row) return
    const where = and(eq(heatingEstimates.heatingPeriodId, row.id), eq(heatingEstimates.unitId, unitId), eq(heatingEstimates.part, part))
    const before = await tx.select({ unitId: heatingEstimates.unitId }).from(heatingEstimates).where(where)
    if (before.length === 0) return
    await tx.delete(heatingEstimates).where(where)
    await dropIfEmpty(tx, row.id)
    removed = true
  })
  return removed
}

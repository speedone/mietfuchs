// Bezugszähler und verteilter Rest einer Position nach Verbrauch (#98, Entwurf 2026-11-04-virtuelle-zaehler-design.md):
// Lesen des Rumpfs, Schreiben in die vier Tabellen `cost_item_meter_rest…`, die Prüfungen beim Speichern (je ein Satz,
// 400), die Löschsperre eines Zählers und die Befunde über den ganzen Bestand für Wiederherstellen und Rücksprung. Die
// Berechnung liest nichts davon; sie bekommt `meterRest` über den Schnappschuss.
import { and, eq, inArray, ne } from 'drizzle-orm'
import type { CostItem, Meter, MeterRest, MeterRestKey, MeterRestTarget, MeterType } from '../../../shared/types.ts'
import { andList } from '../../../shared/wording.ts'
import { STANDARD_ONLY, standardMisplaced } from '../../../shared/meterRest.ts'
import type { Executor } from './client.ts'
import { CrossPropertyError } from './repository.ts'
import {
  costItemMeterRest, costItemMeterRestBehind, costItemMeterRestSubs, costItemMeterRestUnits, costItems, meters, REST_GROUP_KEYS, REST_KEYS, units,
} from './schema.ts'

// Eine Angabe zum Bezugszähler, die nicht passt. Die Meldung ist für den Nutzer geschrieben; die Route gibt sie mit 400
// weiter wie `CrossPropertyError`.
export class MeterRestError extends Error {
  status = 400
}

// Nur diese Sparten haben einen Rest, der sich verteilen lässt: Wasser, Strom und „Sonstiges“ (Gas). Wärme geht über die
// Heizanlage, Heizkostenverteiler haben keinen Hauptzähler.
const REST_METER_TYPES: readonly MeterType[] = ['kaltwasser', 'strom', 'sonstig']

const FORM = 'Die Angaben zum Bezugszähler haben nicht die erwartete Form. Bitte laden Sie die Seite neu und wählen Sie sie noch einmal.'

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

// Eine Liste von Kennungen. Wohnungen werden von Doppeln befreit (wie die Teilnehmer); Zähler nicht: Ein Zähler, der zweimal
// dasteht, ist eine falsche Angabe, die `guardMeterRest` mit einem Satz ablehnt, und kein Tippfehler zum Geraderücken.
function idList(v: unknown, dedupe: boolean): string[] | null {
  if (v === null || v === undefined) return null
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || x === '')) throw new MeterRestError(FORM)
  return dedupe ? [...new Set(v as string[])] : [...(v as string[])]
}

function readTarget(v: unknown): MeterRestTarget {
  if (v === 'landlord' || v === 'selfUse' || v === 'excluded') return v
  if (!isRecord(v) || typeof v.key !== 'string' || !(REST_GROUP_KEYS as readonly string[]).includes(v.key)) throw new MeterRestError(FORM)
  return { key: v.key as MeterRestKey | 'direct', unitIds: idList(v.unitIds, true) ?? [] }
}

// Der Rumpf einer Anfrage. `null` entfernt die Angabe (Ergebnis `undefined`: das Feld steht dann nicht mehr da); was
// keine Gestalt von `MeterRest` hat, wird abgelehnt und nicht still geleert.
export function readMeterRest(value: unknown): MeterRest | undefined {
  if (value === null || value === undefined) return undefined
  if (!isRecord(value)) throw new MeterRestError(FORM)
  const reference = value.referenceMeterId ?? null
  if (reference !== null && (typeof reference !== 'string' || reference === '')) throw new MeterRestError(FORM)
  if (typeof value.key !== 'string' || !(REST_KEYS as readonly string[]).includes(value.key)) throw new MeterRestError(FORM)
  const subs = value.subMeters ?? []
  if (!Array.isArray(subs)) throw new MeterRestError(FORM)
  return {
    referenceMeterId: reference,
    behindMeterIds: idList(value.behindMeterIds, false),
    key: value.key as MeterRest['key'],
    unitIds: idList(value.unitIds, true),
    subMeters: subs.map((s: unknown) => {
      if (!isRecord(s) || typeof s.meterId !== 'string' || s.meterId === '') throw new MeterRestError(FORM)
      return { meterId: s.meterId, target: readTarget(s.target) }
    }),
  }
}

// Die Untertabellen einer Position, ganz ersetzt (wie `writeCostItemShares`). Die Reihenfolge der Zwischenzähler bleibt.
export async function writeMeterRest(db: Executor, c: CostItem): Promise<void> {
  await db.delete(costItemMeterRestUnits).where(eq(costItemMeterRestUnits.costItemId, c.id))
  await db.delete(costItemMeterRestBehind).where(eq(costItemMeterRestBehind.costItemId, c.id))
  await db.delete(costItemMeterRestSubs).where(eq(costItemMeterRestSubs.costItemId, c.id))
  await db.delete(costItemMeterRest).where(eq(costItemMeterRest.costItemId, c.id))
  const rest = c.meterRest
  if (!rest) return
  await db.insert(costItemMeterRest).values({
    costItemId: c.id,
    referenceMeterId: rest.referenceMeterId,
    key: rest.key,
    unitIdsAll: rest.unitIds === null,
    behindAll: rest.behindMeterIds === null,
  })
  if (rest.unitIds && rest.unitIds.length > 0) await db.insert(costItemMeterRestUnits).values(rest.unitIds.map((unitId) => ({ costItemId: c.id, unitId })))
  if (rest.behindMeterIds && rest.behindMeterIds.length > 0) await db.insert(costItemMeterRestBehind).values(rest.behindMeterIds.map((meterId) => ({ costItemId: c.id, meterId })))
  if (rest.subMeters.length > 0) {
    await db.insert(costItemMeterRestSubs).values(rest.subMeters.map((s) => ({
      costItemId: c.id,
      meterId: s.meterId,
      targetKind: typeof s.target === 'string' ? s.target : ('group' as const),
      targetKey: typeof s.target === 'string' ? null : s.target.key,
      targetUnitIds: typeof s.target === 'string' ? null : JSON.stringify(s.target.unitIds),
    })))
  }
}

// ---------- Prüfen beim Speichern ----------

type MeterFacts = Pick<Meter, 'id' | 'name' | 'propertyId' | 'unitId' | 'type' | 'heatingPlantId' | 'scope'>

async function factsOf(db: Executor, ids: string[]): Promise<Map<string, MeterFacts>> {
  const rows = ids.length === 0 ? [] : await db
    .select({ id: meters.id, name: meters.name, propertyId: meters.propertyId, unitId: meters.unitId, type: meters.type, heatingPlantId: meters.heatingPlantId, scope: meters.scope })
    .from(meters).where(inArray(meters.id, ids))
  return new Map(rows.map((r) => [r.id, { ...r, heatingPlantId: r.heatingPlantId, scope: r.scope ?? undefined }]))
}

// Alle Zähler und Wohnungen, die die Angabe nennt, passen zur Position (Entwurf, Datenmodell). Liefert nichts, wirft mit
// einem Satz.
export async function guardMeterRest(db: Executor, after: CostItem): Promise<void> {
  const rest = after.meterRest
  if (!rest) return
  const label = `„${after.description}“`
  if (after.key !== 'meter') {
    throw new MeterRestError(`Bezugszähler und Rest gibt es nur bei einer Position, die nach Verbrauch verteilt wird. ${label} hat einen anderen Schlüssel.`)
  }
  const type = after.meterType ?? null
  if (type === null || !REST_METER_TYPES.includes(type)) {
    throw new MeterRestError(`Einen Bezugszähler mit verteiltem Rest gibt es für Wasser, Strom und „Sonstiges“. ${label} hat eine andere Sparte oder keine; bitte wählen Sie die Sparte, die der Zähler misst.`)
  }
  // „Wie bisher“ nur am Hauptzähler, ohne Empfänger und mit allen Wohnungen (shared/meterRest.ts).
  if (standardMisplaced(rest, after.participantUnitIds)) {
    throw new MeterRestError(`${label}: ${STANDARD_ONLY}`)
  }
  if (rest.referenceMeterId !== null && rest.behindMeterIds === null) {
    throw new MeterRestError(`Bei einem anderen Bezugszähler als dem Hauptzähler nennen Sie bitte die Zähler, die hinter ihm hängen (${label}); sonst ließe sich der Rest nicht bestimmen.`)
  }
  const behind = rest.behindMeterIds ?? []
  const subs = rest.subMeters.map((s) => s.meterId)
  const all = [...(rest.referenceMeterId === null ? [] : [rest.referenceMeterId]), ...behind, ...subs]
  if (new Set(all).size !== all.length) {
    throw new MeterRestError(`Ein Zähler kann in ${label} nur eine Rolle haben: Bezugszähler, Zähler hinter ihm oder Zwischenzähler, und jeder nur einmal.`)
  }
  const facts = await factsOf(db, all)
  for (const id of all) {
    const m = facts.get(id)
    if (!m) throw new MeterRestError(`Ein Zähler, den ${label} nennt, gibt es nicht (mehr). Bitte laden Sie die Seite neu.`)
    if (m.propertyId !== after.propertyId) {
      throw new CrossPropertyError(`Die Kostenposition ${label} gehört zu einem anderen Objekt als der Zähler „${m.name}“. Ein Verweis über die Grenze eines Objekts ginge in keiner Abrechnung auf. Bitte wählen Sie einen Zähler desselben Objekts.`)
    }
    if (m.type !== type) throw new MeterRestError(`Der Zähler „${m.name}“ misst eine andere Sparte als ${label}. Bitte wählen Sie einen Zähler derselben Sparte.`)
    if (m.heatingPlantId) throw new MeterRestError(`Der Zähler „${m.name}“ gehört zur Heizanlage. Zähler der Heizanlage sind weder Bezugs- noch Zwischenzähler; die Heizkosten verteilt die Heizkostenabrechnung.`)
  }
  for (const id of behind) {
    const m = facts.get(id)
    if (m && !m.unitId) throw new MeterRestError(`Hinter dem Bezugszähler hängen die Zähler von Wohnungen. „${m.name}“ gehört zu keiner Wohnung; ein Zähler ohne Wohnung ist ein Zwischenzähler.`)
  }
  for (const id of subs) {
    const m = facts.get(id)
    if (m && (m.unitId || m.scope !== 'common')) {
      throw new MeterRestError(`Ein Zwischenzähler hat keine Wohnung und misst nur einen Teil des Hauses. „${m.name}“ ist ${m.unitId ? 'einer Wohnung zugeordnet' : 'der Hauptzähler des Hauses'}. Kennzeichnen Sie einen Zähler ohne Wohnung beim Bearbeiten des Zählers als „Zähler für einen Teil des Hauses“.`)
    }
  }
  // Empfänger und Zielgruppen: Teilmenge der Verteilbasis.
  const groups = rest.subMeters.flatMap((s) => (typeof s.target === 'string' ? [] : [s.target.unitIds]))
  const named = [...new Set([...(rest.unitIds ?? []), ...groups.flat()])]
  if (named.length === 0) return
  const basis = after.participantUnitIds ?? null
  if (basis === null) {
    const own = new Set((await db.select({ id: units.id }).from(units).where(and(inArray(units.id, named), eq(units.propertyId, after.propertyId)))).map((r) => r.id))
    const foreign = named.find((id) => !own.has(id))
    if (foreign !== undefined) {
      const [u] = await db.select({ name: units.name }).from(units).where(eq(units.id, foreign))
      // Abschlussdurchsicht I3: Eine Wohnung, die es nicht (mehr) gibt, ist kein Verweis über die Grenze eines Objekts.
      if (!u) throw new MeterRestError(`Eine Wohnung, die ${label} beim Allgemeinverbrauch oder einem Zwischenzähler nennt, gibt es nicht mehr. Bitte laden Sie die Seite neu und wählen Sie die Wohnungen noch einmal.`)
      throw new CrossPropertyError(`Die Kostenposition ${label} gehört zu einem anderen Objekt als die Wohnung${u ? ` „${u.name}“` : ''}, die der Rest bekommen soll. Bitte wählen Sie Wohnungen desselben Objekts.`)
    }
    return
  }
  const outside = named.filter((id) => !basis.includes(id))
  if (outside.length > 0) {
    const rows = await db.select({ name: units.name }).from(units).where(inArray(units.id, outside))
    throw new MeterRestError(`${label} verteilt nur auf die Teilnehmer, die Sie gewählt haben. ${andList(rows.map((r) => `„${r.name}“`))} ${rows.length === 1 ? 'gehört' : 'gehören'} nicht dazu und kann den Rest nicht bekommen.`)
  }
}

// ---------- Eine Wohnung wird gelöscht ----------

// Die Gruppen der Zwischenzähler tragen ihre Wohnungen als JSON und kaskadieren nicht (Abschlussdurchsicht I3): Ohne
// diesen Schritt bliebe die Kennung stehen, und jedes spätere Speichern der Position scheiterte an der Prüfung. Die
// Wohnung fällt aus jeder Gruppe; eine leere Gruppe (auch die Direktzuordnung an genau diese Wohnung) geht an den
// Vermieter, wie die Berechnung einen Teil ohne Basis ohnehin verbucht. Das Journal hält die Änderung fest (Trigger).
// Die Empfänger des Rests (`cost_item_meter_rest_units`) nimmt der Fremdschlüssel mit.
export async function dropUnitFromMeterRest(db: Executor, unitId: string): Promise<void> {
  for (const r of await db.select().from(costItemMeterRestSubs)) {
    if (r.targetUnitIds === null) continue
    let ids: unknown
    try { ids = JSON.parse(r.targetUnitIds) } catch { continue }
    if (!Array.isArray(ids) || !ids.includes(unitId)) continue
    const left = ids.filter((id) => id !== unitId)
    const where = and(eq(costItemMeterRestSubs.costItemId, r.costItemId), eq(costItemMeterRestSubs.meterId, r.meterId))
    await db.update(costItemMeterRestSubs).set(left.length > 0
      ? { targetUnitIds: JSON.stringify(left) }
      : { targetKind: 'landlord', targetKey: null, targetUnitIds: null }).where(where)
  }
}

// Wie viele Angaben zum Allgemeinverbrauch die Wohnung nennen (Empfänger des Rests, Gruppen der Zwischenzähler), für die
// Löschfrage (`unitDependents`).
export async function meterRestUnitLinks(db: Executor, unitId: string): Promise<number> {
  const { recipients, groups } = await meterRestUnitRefs(db, unitId)
  return recipients + groups
}

// Getrennt nach Empfängern des Rests und Gruppen der Zwischenzähler, damit der Objektwechsel (`guardUnit`) beide nennen kann.
export async function meterRestUnitRefs(db: Executor, unitId: string): Promise<{ recipients: number; groups: number }> {
  const recipients = (await db.select({ id: costItemMeterRestUnits.costItemId }).from(costItemMeterRestUnits).where(eq(costItemMeterRestUnits.unitId, unitId))).length
  const groups = (await db.select({ ids: costItemMeterRestSubs.targetUnitIds }).from(costItemMeterRestSubs)).filter((r) => {
    if (r.ids === null) return false
    try { const ids: unknown = JSON.parse(r.ids); return Array.isArray(ids) && ids.includes(unitId) } catch { return false }
  }).length
  return { recipients, groups }
}

// ---------- Wer einen Zähler braucht ----------

// Die Beschreibungen der Positionen, die einen dieser Zähler nennen (als Bezugszähler, dahinter oder als Zwischenzähler).
export async function meterRestUsers(db: Executor, meterIds: string[]): Promise<string[]> {
  if (meterIds.length === 0) return []
  const ids = new Set<string>()
  for (const r of await db.select({ id: costItemMeterRest.costItemId }).from(costItemMeterRest).where(inArray(costItemMeterRest.referenceMeterId, meterIds))) ids.add(r.id)
  for (const r of await db.select({ id: costItemMeterRestBehind.costItemId }).from(costItemMeterRestBehind).where(inArray(costItemMeterRestBehind.meterId, meterIds))) ids.add(r.id)
  for (const r of await db.select({ id: costItemMeterRestSubs.costItemId }).from(costItemMeterRestSubs).where(inArray(costItemMeterRestSubs.meterId, meterIds))) ids.add(r.id)
  if (ids.size === 0) return []
  const rows = await db.select({ description: costItems.description }).from(costItems).where(inArray(costItems.id, [...ids]))
  return [...new Set(rows.map((r) => r.description))]
}

// Der Satz, wenn ein Zähler (oder die Zähler einer Wohnung) noch gebraucht wird; sonst `null`.
export function meterRestUsedText(what: string, users: string[]): string | null {
  if (users.length === 0) return null
  const names = andList(users.map((u) => `„${u}“`))
  return `${what} ${users.length === 1 ? 'wird in der Position' : 'wird in den Positionen'} ${names} als Bezugs-, Zwischen- oder Zähler dahinter gebraucht. Nehmen Sie ihn dort zuerst heraus.`
}

// ---------- Befunde über den ganzen Bestand ----------

// Verweise über Objektgrenzen in den vier Tabellen, als lesbare Sätze (Teil von `crossPropertyViolations`).
export async function meterRestViolations(db: Executor): Promise<string[]> {
  const out: string[] = []
  const wrong = (description: string, meter: string) => `Die Kostenposition „${description}“ nennt als Bezugs-, Zwischen- oder Zähler dahinter den Zähler „${meter}“ eines anderen Objekts.`
  for (const r of await db.select({ d: costItems.description, m: meters.name }).from(costItemMeterRest)
    .innerJoin(costItems, eq(costItemMeterRest.costItemId, costItems.id)).innerJoin(meters, eq(costItemMeterRest.referenceMeterId, meters.id))
    .where(ne(costItems.propertyId, meters.propertyId))) out.push(wrong(r.d, r.m))
  for (const r of await db.select({ d: costItems.description, m: meters.name }).from(costItemMeterRestBehind)
    .innerJoin(costItems, eq(costItemMeterRestBehind.costItemId, costItems.id)).innerJoin(meters, eq(costItemMeterRestBehind.meterId, meters.id))
    .where(ne(costItems.propertyId, meters.propertyId))) out.push(wrong(r.d, r.m))
  for (const r of await db.select({ d: costItems.description, m: meters.name }).from(costItemMeterRestSubs)
    .innerJoin(costItems, eq(costItemMeterRestSubs.costItemId, costItems.id)).innerJoin(meters, eq(costItemMeterRestSubs.meterId, meters.id))
    .where(ne(costItems.propertyId, meters.propertyId))) out.push(wrong(r.d, r.m))
  for (const r of await db.select({ d: costItems.description }).from(costItemMeterRestUnits)
    .innerJoin(costItems, eq(costItemMeterRestUnits.costItemId, costItems.id)).innerJoin(units, eq(costItemMeterRestUnits.unitId, units.id))
    .where(ne(costItems.propertyId, units.propertyId))) out.push(`Die Kostenposition „${r.d}“ verteilt den Rest auf eine Wohnung eines anderen Objekts.`)
  // Die Wohnungen eines Ziels stehen als JSON in der Zeile; eine gelöschte nimmt `dropUnitFromMeterRest` heraus, eine
  // übrig gebliebene (älterer Bestand) ist harmlos.
  const groups = await db.select({ d: costItems.description, p: costItems.propertyId, ids: costItemMeterRestSubs.targetUnitIds })
    .from(costItemMeterRestSubs).innerJoin(costItems, eq(costItemMeterRestSubs.costItemId, costItems.id))
  const unitProperty = new Map((await db.select({ id: units.id, p: units.propertyId }).from(units)).map((u) => [u.id, u.p]))
  for (const g of groups) {
    if (g.ids === null) continue
    let list: unknown
    try { list = JSON.parse(g.ids) } catch { list = [] }
    if (Array.isArray(list) && list.some((id) => typeof id === 'string' && unitProperty.has(id) && unitProperty.get(id) !== g.p)) {
      out.push(`Die Kostenposition „${g.d}“ verteilt den Rest eines Zwischenzählers auf eine Wohnung eines anderen Objekts.`)
    }
  }
  return out
}

// Zimmer einer Wohnung (#573, Entwurf 2026-11-05-wohnung-zimmer-design.md, Abschnitt Datenmodell): die Prüfungen beim
// Speichern (je ein Satz, 400 bzw. 409) und die Befunde über den ganzen Bestand für Wiederherstellen und Rücksprung.
// Eine Einheit, auf die mindestens eine andere über `units.parent_unit_id` verweist, heißt Wohnung mit Zimmern. Die
// Berechnung liest nichts davon aus der Datenbank; sie bekommt `parentUnitId` über den Schnappschuss.
import { and, eq, inArray, isNotNull, ne } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import type { CostItem, Meter, MeterType, Unit } from '../../../shared/types.ts'
import { andList, meterTypeLabel } from '../../../shared/wording.ts'
import type { Executor } from './client.ts'
import { CrossPropertyError, HeatingError } from './repository.ts'
import {
  costItemMeterRestSubs, costItemMeterRestUnits, costItemParticipants, costItemSelfAmounts, costItemShares, costItems, meters,
  tenancies, unitUsageChanges, units,
} from './schema.ts'

// An der Wohnung hängen nur Zähler dieser Sparten (Entwurf, Datenmodell): Wärme, Warmwasser und Heizkostenverteiler
// messen am Zimmer.
const APARTMENT_METER_TYPES: readonly MeterType[] = ['kaltwasser', 'strom', 'sonstig']

type UnitFacts = { id: string, name: string, selfUsed: boolean, hasUsageChanges: boolean }

const q = (name: string) => `„${name}“`

// Die Gründe, aus denen eine Einheit keine Wohnung mit Zimmern sein kann, als Sätze. Mietverhältnisse, Zähler und die
// Nennung als Empfänger kommen aus der Datenbank; Eigennutzung und Nutzungswechsel aus `unit`, denn beim Speichern der
// Wohnung selbst gilt, was gerade geschickt wurde.
async function apartmentProblems(db: Executor, unit: UnitFacts): Promise<string[]> {
  const out: string[] = []
  const lead = `Die Wohnung ${q(unit.name)} hat Zimmer`
  const rule = 'Eine Wohnung mit Zimmern wird nur über ihre Zimmer vermietet und genutzt'
  const own = await db.select({ id: tenancies.id }).from(tenancies).where(eq(tenancies.unitId, unit.id))
  if (own.length > 0) out.push(`${lead}, hat aber ein Mietverhältnis. ${rule}; legen Sie das Mietverhältnis an einem Zimmer an.`)
  if (unit.selfUsed) out.push(`${lead}, ist aber als selbstgenutzt eingetragen. ${rule}; tragen Sie die Eigennutzung an einem Zimmer ein.`)
  if (unit.hasUsageChanges) out.push(`${lead}, hat aber Nutzungswechsel. ${rule}; tragen Sie die Nutzung an den Zimmern ein.`)
  const bad = await db.select({ name: meters.name, type: meters.type }).from(meters)
    .where(eq(meters.unitId, unit.id))
  const wrong = bad.filter((m) => !APARTMENT_METER_TYPES.includes(m.type))
  if (wrong.length > 0) {
    out.push(`${lead}, aber ${andList(wrong.map((m) => `${q(m.name)} (${meterTypeLabel(m.type)})`))} ${wrong.length === 1 ? 'hängt' : 'hängen'} an der Wohnung. ` +
      'An einer Wohnung mit Zimmern hängen nur Zähler für Kaltwasser, Strom und Sonstiges; Wärme, Warmwasser und Heizkostenverteiler gehören an das Zimmer.')
  }
  const users = await recipientUsers(db, [unit.id])
  if (users.length > 0) {
    out.push(`${lead}, wird aber in ${users.length === 1 ? 'der Kostenposition' : 'den Kostenpositionen'} ${andList(users.map(q))} als Empfänger genannt (Direktzuordnung, Anteil, Teilnehmer, Eigenbetrag oder Rest). ` +
      'Die Wohnung selbst bekommt keinen Anteil; nennen Sie dort stattdessen die Zimmer.')
  }
  return out
}

// Die Beschreibungen der Positionen, die eine dieser Einheiten als Empfänger nennen.
async function recipientUsers(db: Executor, unitIds: string[]): Promise<string[]> {
  if (unitIds.length === 0) return []
  const ids = new Set<string>()
  const pick = (rows: { id: string }[]) => { for (const r of rows) ids.add(r.id) }
  pick(await db.select({ id: costItems.id }).from(costItems).where(inArray(costItems.directUnitId, unitIds)))
  pick(await db.select({ id: costItemShares.costItemId }).from(costItemShares).where(inArray(costItemShares.unitId, unitIds)))
  pick(await db.select({ id: costItemParticipants.costItemId }).from(costItemParticipants).where(inArray(costItemParticipants.unitId, unitIds)))
  pick(await db.select({ id: costItemSelfAmounts.costItemId }).from(costItemSelfAmounts).where(inArray(costItemSelfAmounts.unitId, unitIds)))
  pick(await db.select({ id: costItemMeterRestUnits.costItemId }).from(costItemMeterRestUnits).where(inArray(costItemMeterRestUnits.unitId, unitIds)))
  for (const r of await db.select({ id: costItemMeterRestSubs.costItemId, ids: costItemMeterRestSubs.targetUnitIds }).from(costItemMeterRestSubs)) {
    if (r.ids === null) continue
    let list: unknown
    try { list = JSON.parse(r.ids) } catch { continue }
    if (Array.isArray(list) && list.some((x) => typeof x === 'string' && unitIds.includes(x))) ids.add(r.id)
  }
  if (ids.size === 0) return []
  const rows = await db.select({ description: costItems.description }).from(costItems).where(inArray(costItems.id, [...ids]))
  return [...new Set(rows.map((r) => r.description))]
}

// Die Zimmer einer Wohnung (Einheiten, die auf sie verweisen).
async function roomsOf(db: Executor, unitId: string): Promise<{ id: string, name: string, propertyId: string }[]> {
  return db.select({ id: units.id, name: units.name, propertyId: units.propertyId }).from(units).where(eq(units.parentUnitId, unitId))
}

// Wie viele Zimmer in der Wohnung liegen, für die Löschfrage (`unitDependents`) und die Löschsperre.
export async function roomCount(db: Executor, unitId: string): Promise<number> {
  return (await roomsOf(db, unitId)).length
}

// Löschen einer Wohnung mit Zimmern: 409 mit Satz (der Fremdschlüssel ist `RESTRICT`).
export async function guardRoomsRemoval(db: Executor, unitId: string): Promise<void> {
  const rooms = await roomsOf(db, unitId)
  if (rooms.length === 0) return
  const [self] = await db.select({ name: units.name }).from(units).where(eq(units.id, unitId))
  throw new HeatingError(409,
    `In der Wohnung ${q(self?.name ?? '')} ${rooms.length === 1 ? 'liegt das Zimmer' : 'liegen die Zimmer'} ${andList(rooms.map((r) => q(r.name)))}. ` +
      'Lösen oder löschen Sie zuerst die Zimmer, damit keines ohne Wohnung zurückbleibt.')
}

// Beim Speichern einer Einheit: die Zeile selbst als Zimmer und als Wohnung.
export async function guardRooms(db: Executor, before: Unit | null, after: Unit): Promise<void> {
  const parentId = after.parentUnitId ?? null
  if (parentId === after.id) throw new HeatingError(400, `Ein Zimmer kann nicht in sich selbst liegen. Bitte wählen Sie für ${q(after.name)} eine andere Wohnung.`)
  const rooms = await roomsOf(db, after.id)
  const changed = parentId !== (before?.parentUnitId ?? null) || (before !== null && before.propertyId !== after.propertyId)
  if (parentId !== null && (changed || before === null)) {
    const [parent] = await db.select({ id: units.id, name: units.name, propertyId: units.propertyId, parentUnitId: units.parentUnitId, selfUsed: units.selfUsed })
      .from(units).where(eq(units.id, parentId))
    if (!parent) throw new HeatingError(400, `Die Wohnung, in der ${q(after.name)} liegen soll, gibt es nicht (mehr). Bitte laden Sie die Seite neu und wählen Sie die Wohnung noch einmal.`)
    if (parent.propertyId !== after.propertyId) {
      throw new CrossPropertyError(`Das Zimmer ${q(after.name)} gehört zu einem anderen Objekt als die Wohnung ${q(parent.name)}. Ein Zimmer liegt in einer Wohnung desselben Objekts.`)
    }
    if (parent.parentUnitId !== null) {
      throw new HeatingError(400, `${q(parent.name)} liegt selbst als Zimmer in einer Wohnung. Ein Zimmer kann nicht in einem Zimmer liegen; wählen Sie die Wohnung.`)
    }
    if (rooms.length > 0) {
      throw new HeatingError(400, `${q(after.name)} hat selbst Zimmer und kann deshalb nicht in einer anderen Wohnung liegen. Es gibt nur eine Ebene: Wohnung und Zimmer.`)
    }
    const hasChanges = (await db.select({ id: unitUsageChanges.unitId }).from(unitUsageChanges).where(eq(unitUsageChanges.unitId, parent.id))).length > 0
    const problems = await apartmentProblems(db, { id: parent.id, name: parent.name, selfUsed: parent.selfUsed === true, hasUsageChanges: hasChanges })
    if (problems[0] !== undefined) throw new HeatingError(400, problems[0].replace(/^Die Wohnung (.*?) hat Zimmer/, 'Die Wohnung $1 soll Zimmer bekommen'))
  }
  if (rooms.length > 0) {
    const foreign = rooms.find((r) => r.propertyId !== after.propertyId)
    if (foreign) {
      throw new CrossPropertyError(`Die Wohnung ${q(after.name)} hat das Zimmer ${q(foreign.name)} und wechselt deshalb nicht in ein anderes Objekt. Lösen Sie zuerst die Zimmer.`)
    }
    const problems = await apartmentProblems(db, { id: after.id, name: after.name, selfUsed: after.selfUsed === true, hasUsageChanges: (after.usageChanges ?? []).length > 0 })
    if (problems[0] !== undefined) throw new HeatingError(400, problems[0])
  }
}

// Beim Speichern eines Mietverhältnisses: nicht an einer Wohnung mit Zimmern.
export async function guardRoomTenancy(db: Executor, unitId: string): Promise<void> {
  const rooms = await roomsOf(db, unitId)
  if (rooms.length === 0) return
  const [unit] = await db.select({ name: units.name }).from(units).where(eq(units.id, unitId))
  throw new HeatingError(400, `Die Wohnung ${q(unit?.name ?? '')} hat Zimmer. Ein Mietverhältnis gehört an ein Zimmer, nicht an die Wohnung.`)
}

// Beim Speichern eines Zählers: an einer Wohnung mit Zimmern nur Kaltwasser, Strom und Sonstiges.
export async function guardRoomMeter(db: Executor, after: Pick<Meter, 'unitId' | 'type' | 'name'>): Promise<void> {
  if (!after.unitId || APARTMENT_METER_TYPES.includes(after.type)) return
  const rooms = await roomsOf(db, after.unitId)
  if (rooms.length === 0) return
  const [unit] = await db.select({ name: units.name }).from(units).where(eq(units.id, after.unitId))
  throw new HeatingError(400,
    `Die Wohnung ${q(unit?.name ?? '')} hat Zimmer. An ihr hängen nur Zähler für Kaltwasser, Strom und Sonstiges; ${q(after.name)} (${meterTypeLabel(after.type)}) gehört an das Zimmer.`)
}

// Beim Speichern einer Position: keine Wohnung mit Zimmern als Empfänger (Direktzuordnung, Anteile, Teilnehmer,
// Eigenbeträge, Empfänger des Rests, Zielgruppen von Zwischenzählern).
export async function guardRoomRecipients(db: Executor, after: CostItem): Promise<void> {
  const groups = (after.meterRest?.subMeters ?? []).flatMap((s) => (typeof s.target === 'string' ? [] : s.target.unitIds))
  const named = [...new Set([
    ...(after.directUnitId ? [after.directUnitId] : []),
    ...Object.keys(after.customShares ?? {}),
    ...(after.participantUnitIds ?? []),
    ...Object.keys(after.selfAmounts ?? {}),
    ...(after.meterRest?.unitIds ?? []),
    ...groups,
  ])]
  if (named.length === 0) return
  const parents = [...new Set((await db.select({ parent: units.parentUnitId }).from(units)
    .where(and(isNotNull(units.parentUnitId), inArray(units.parentUnitId, named)))).map((r) => r.parent))]
  const first = parents[0]
  if (first === null || first === undefined) return
  const [unit] = await db.select({ name: units.name }).from(units).where(eq(units.id, first))
  throw new HeatingError(400,
    `Die Wohnung ${q(unit?.name ?? '')} hat Zimmer und bekommt selbst keinen Anteil: ${q(after.description)} nennt sie als Empfänger (Direktzuordnung, Anteil, Teilnehmer, Eigenbetrag oder Rest). Nennen Sie stattdessen die Zimmer.`)
}

// Beim Speichern einer Position: `roomSplit` gilt nur beim Schlüssel `meter` und ist sonst nicht gespeichert.
export function roomSplitOf(key: CostItem['key'], value: unknown): CostItem['roomSplit'] {
  if (key !== 'meter') return undefined
  return value === 'persons' ? 'persons' : value === 'area' ? 'area' : undefined
}

// Befunde über den ganzen Bestand (Teil von `crossPropertyViolations`): Objektgrenze, Ebene und alles, was eine Wohnung mit
// Zimmern nicht haben darf.
export async function roomViolations(db: Executor): Promise<string[]> {
  const out: string[] = []
  const parent = alias(units, 'parent_unit')
  for (const r of await db.select({ name: units.name, parent: parent.name }).from(units)
    .innerJoin(parent, eq(units.parentUnitId, parent.id)).where(ne(units.propertyId, parent.propertyId))) {
    out.push(`Das Zimmer ${q(r.name)} liegt in der Wohnung ${q(r.parent)} eines anderen Objekts.`)
  }
  for (const r of await db.select({ name: units.name, parent: parent.name }).from(units)
    .innerJoin(parent, eq(units.parentUnitId, parent.id)).where(isNotNull(parent.parentUnitId))) {
    out.push(`Das Zimmer ${q(r.name)} liegt in ${q(r.parent)}, das selbst ein Zimmer ist; es gibt nur eine Ebene.`)
  }
  const apartmentIds = [...new Set((await db.select({ p: units.parentUnitId }).from(units).where(isNotNull(units.parentUnitId))).flatMap((r) => (r.p === null ? [] : [r.p])))]
  if (apartmentIds.length === 0) return out
  const changes = new Set((await db.select({ id: unitUsageChanges.unitId }).from(unitUsageChanges).where(inArray(unitUsageChanges.unitId, apartmentIds))).map((r) => r.id))
  for (const a of await db.select({ id: units.id, name: units.name, selfUsed: units.selfUsed }).from(units).where(inArray(units.id, apartmentIds))) {
    out.push(...await apartmentProblems(db, { id: a.id, name: a.name, selfUsed: a.selfUsed === true, hasUsageChanges: changes.has(a.id) }))
  }
  return out
}

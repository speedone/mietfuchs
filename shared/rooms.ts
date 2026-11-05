// Zimmer einer Wohnung (#573, Entwurf docs/superpowers/specs/2026-11-05-wohnung-zimmer-design.md).
//
// Eine Einheit, auf die andere mit `parentUnitId` verweisen, ist eine Wohnung mit Zimmern; die verweisenden sind ihre
// Zimmer. Für die Rechnung gilt eine Sicht (`roomView`), gesetzt beim Bilden des Schnappschusses, damit jeder Leser
// von Fläche und Name sie bekommt (Verteilung, Heizung, CO₂, Steuer, Hinweise):
//
// - Die Zimmer tragen ihre **wirksame Fläche** (die Fläche der Wohnung nach dem Verhältnis der Zimmerflächen, so zählt
//   die ganze Wohnung mit Küche, Bad und Flur genau einmal) und ihren vollen Namen („Zimmer 1 in der Wohnung …“).
// - Die Wohnung selbst ist in keiner Verteilbasis: `participates` und `selfUsed` false, Fläche 0, keine Nutzungswechsel.
//   Ihre Kennung bleibt, denn an ihr hängen die Zähler der Wohnung.
// - Ihre Miteigentumsanteile (`mea`, Schlüssel „laut Gemeinschaftsabrechnung“) gehen nach derselben Teilung auf die
//   Zimmer, die Wohnung trägt 0 (Gesamtdurchsicht C1); hat die Wohnung keine, bleibt jedes Zimmer bei seiner Angabe.
//
// Ohne `parentUnitId` ist die Sicht der Bestand selbst (dasselbe Feld, kein neues Objekt), damit keine Zahl wandert.
import type { Unit } from './types.ts'

export type RoomUnit = Pick<Unit, 'id' | 'name' | 'areaM2' | 'participates' | 'selfUsed' | 'usageChanges' | 'parentUnitId' | 'mea'>

export function roomName(room: { name: string }, flat: { name: string }): string {
  return `${room.name} in der Wohnung ${flat.name}`
}

const areaOf = (u: Pick<Unit, 'areaM2'>): number => (u.areaM2 > 0 ? u.areaM2 : 0)

// Wirksame Fläche je Zimmer: Wohnungsfläche × Zimmerfläche / Summe der Zimmerflächen. Ist die Fläche der Wohnung 0 oder
// leer, gelten die Zimmerflächen, wie sie stehen (Hinweis `unit.rooms-area` in calc.ts); sind alle Zimmerflächen 0, geht
// die Wohnungsfläche zu gleichen Teilen auf die Zimmer.
export function effectiveRoomAreas(flat: Pick<Unit, 'areaM2'>, rooms: readonly Pick<Unit, 'id' | 'areaM2'>[]): Map<string, number> {
  const total = areaOf(flat)
  if (!(total > 0)) return new Map(rooms.map((r) => [r.id, areaOf(r)]))
  const sum = rooms.reduce((a, r) => a + areaOf(r), 0)
  return new Map(rooms.map((r) => [r.id, sum > 0 ? (total * areaOf(r)) / sum : total / rooms.length]))
}

// Anteil jedes Zimmers an seiner Wohnung: das Verhältnis der eingetragenen Zimmerflächen (alle 0: zu gleichen Teilen).
// Dieselbe Teilung wie die wirksame Fläche, und das Gewicht eines Zimmers im Schlüssel „Einheiten“ (calc.ts `unitWeight`).
export function roomShares(rooms: readonly Pick<Unit, 'id' | 'areaM2'>[]): Map<string, number> {
  const sum = rooms.reduce((a, r) => a + areaOf(r), 0)
  return new Map(rooms.map((r) => [r.id, sum > 0 ? areaOf(r) / sum : 1 / rooms.length]))
}

// Die Sicht der Rechnung. `flatOf` nennt je Zimmer seine Wohnung, **wie sie gespeichert ist** (mit ihrer Fläche und
// ihrem Namen, für Rechenweg und Hinweise); die Wohnung der Sicht steht in `units`. `roomsOf` nennt je Wohnung ihre
// Zimmer in der Sicht (wirksame Fläche, voller Name), `rawArea` je Zimmer die eingetragene Fläche.
export type RoomView<U> = { units: U[]; flatOf: Map<string, U>; roomsOf: Map<string, U[]>; rawArea: Map<string, number> }

// Die Wohnung, in der eine Einheit als Zimmer liegt, oder null. Eine Ebene (db/rooms.ts prüft das beim Speichern):
// Wohnung ist nur, was es gibt und selbst in keiner liegt. Ein krummer Bestand (Wiederherstellen eines Backups, eine
// Kette über zwei Ebenen, ein Verweis ins Leere) ergibt so in `roomView` und `dwellingsOf` dieselbe Lesart.
type Nested = { id: string; parentUnitId?: string | null }
export function flatIdOf(u: Nested, byId: ReadonlyMap<string, Nested>): string | null {
  const p = u.parentUnitId ?? null
  if (p === null || p === u.id) return null
  const parent = byId.get(p)
  return parent && (parent.parentUnitId ?? null) === null ? p : null
}

export function roomView<U extends RoomUnit>(units: U[]): RoomView<U> {
  const byId = new Map(units.map((u) => [u.id, u]))
  const grouped = new Map<string, U[]>()
  for (const u of units) {
    const p = flatIdOf(u, byId)
    if (p !== null) grouped.set(p, [...(grouped.get(p) ?? []), u])
  }
  if (grouped.size === 0) return { units, flatOf: new Map(), roomsOf: new Map(), rawArea: new Map() }
  const viewed = new Map<string, U>()
  const flatOf = new Map<string, U>()
  const roomsOf = new Map<string, U[]>()
  const rawArea = new Map<string, number>()
  for (const [flatId, rooms] of grouped) {
    const flat = byId.get(flatId)
    if (!flat) continue
    const areas = effectiveRoomAreas(flat, rooms)
    const flatMea = typeof flat.mea === 'number' && flat.mea > 0 ? flat.mea : null
    const shares = roomShares(rooms)
    const shown = rooms.map((r): U => ({
      ...r, name: roomName(r, flat), areaM2: areaOf(flat) > 0 ? areas.get(r.id) ?? 0 : r.areaM2,
      ...(flatMea !== null ? { mea: flatMea * (shares.get(r.id) ?? 0) } : {}),
    }))
    for (const r of shown) viewed.set(r.id, r)
    for (const r of rooms) {
      flatOf.set(r.id, flat)
      rawArea.set(r.id, areaOf(r))
    }
    roomsOf.set(flatId, shown)
    viewed.set(flatId, { ...flat, participates: false, selfUsed: false, areaM2: 0, usageChanges: [], ...(flatMea !== null ? { mea: 0 } : {}) })
  }
  return { units: units.map((u) => viewed.get(u.id) ?? u), flatOf, roomsOf, rawArea }
}

// Die Wohnungen für die Zahl der Wohnungen (§ 2 HeizkostenV, § 5d Abs. 3 CO2KostAufG): Zimmer zählen nicht, eine
// Wohnung mit Zimmern zählt einmal, wenn eines ihrer Zimmer Wohnung im Sinne von `isDwelling` ist. Sie gilt als selbst
// bewohnt, wenn ein Zimmer selbstgenutzt und keines vermietet ist, und als vermietet, sobald eines vermietet ist
// (Festlegung im Entwurf: eine Wohnung mit vermieteten Zimmern gilt nicht als selbst bewohnt). Gleich, ob die Einheiten
// in der Sicht der Rechnung oder wie gespeichert hereinkommen: Die Wohnung selbst zählt nie neben ihren Zimmern.
export type Dwelling<U> = { members: U[]; selfUsed: boolean; participates: boolean }

export function dwellingsOf<U extends { id: string; participates: boolean; selfUsed?: boolean; parentUnitId?: string | null }>(
  units: readonly U[],
  isDwelling: (u: U) => boolean,
): Dwelling<U>[] {
  const byId = new Map(units.map((u) => [u.id, u]))
  const flatOf = (u: U): string | null => flatIdOf(u, byId)
  const flats = new Set(units.flatMap((u) => flatOf(u) ?? []))
  const result: Dwelling<U>[] = []
  for (const u of units) {
    if (flats.has(u.id) || flatOf(u) !== null) continue
    if (isDwelling(u)) result.push({ members: [u], selfUsed: u.selfUsed === true, participates: u.participates })
  }
  for (const flatId of flats) {
    const rooms = units.filter((u) => flatOf(u) === flatId)
    if (!rooms.some(isDwelling)) continue
    result.push({ members: rooms, selfUsed: rooms.some((r) => r.selfUsed === true), participates: rooms.some((r) => r.participates) })
  }
  return result
}

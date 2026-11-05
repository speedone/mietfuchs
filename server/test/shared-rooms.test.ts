// Zimmer einer Wohnung (#573): wirksame Fläche, Name und die Sicht der Rechnung (shared/rooms.ts).
import test from 'node:test'
import assert from 'node:assert/strict'
import type { Unit } from '../../shared/types.ts'
import { dwellingsOf, effectiveRoomAreas, roomName, roomView } from '../../shared/rooms.ts'
import { mayAgreeOtherwise } from '../../shared/heating.ts'

const unit = (id: string, over: Partial<Unit> = {}): Unit => ({ id, propertyId: 'objekt-1', name: id, areaM2: 0, participates: true, ...over })
const flat = (areaM2: number): Unit => unit('wg', { name: '1. OG links', areaM2, participates: false })
const rooms = (...areas: number[]): Unit[] => areas.map((a, i) => unit(`z${i + 1}`, { name: `Zimmer ${i + 1}`, areaM2: a, parentUnitId: 'wg' }))

test('effectiveRoomAreas: die Wohnungsfläche nach dem Verhältnis der Zimmerflächen', () => {
  assert.deepEqual([...effectiveRoomAreas(flat(80), rooms(12, 12, 16)).values()], [24, 24, 32])
})

test('effectiveRoomAreas: Wohnungsfläche 0 heißt Zimmerflächen, wie sie stehen', () => {
  assert.deepEqual([...effectiveRoomAreas(flat(0), rooms(12, 12, 16)).values()], [12, 12, 16])
})

test('effectiveRoomAreas: alle Zimmerflächen 0 heißt zu gleichen Teilen', () => {
  const areas = [...effectiveRoomAreas(flat(80), rooms(0, 0, 0)).values()]
  for (const a of areas) assert.equal(Math.round(a * 100) / 100, 26.67)
  assert.ok(Math.abs(areas.reduce((x, y) => x + y, 0) - 80) < 1e-9)
})

test('roomName: „Zimmer 1 in der Wohnung 1. OG links“', () => {
  assert.equal(roomName({ name: 'Zimmer 1' }, { name: '1. OG links' }), 'Zimmer 1 in der Wohnung 1. OG links')
})

test('roomView: ohne Zimmer ist die Sicht der Bestand selbst', () => {
  const units = [unit('a', { areaM2: 60 }), unit('b', { areaM2: 80 })]
  const view = roomView(units)
  assert.equal(view.units, units)
  assert.equal(view.flatOf.size, 0)
  assert.equal(view.roomsOf.size, 0)
  assert.equal(view.rawArea.size, 0)
})

test('roomView: Zimmer mit wirksamer Fläche und vollem Namen, die Wohnung zählt nirgends', () => {
  const w = flat(80)
  const units = [unit('a', { areaM2: 60 }), w, ...rooms(12, 12, 16)]
  const view = roomView(units)
  assert.deepEqual(view.units.map((u) => [u.id, u.name, u.areaM2]), [
    ['a', 'a', 60], ['wg', '1. OG links', 0],
    ['z1', 'Zimmer 1 in der Wohnung 1. OG links', 24], ['z2', 'Zimmer 2 in der Wohnung 1. OG links', 24], ['z3', 'Zimmer 3 in der Wohnung 1. OG links', 32],
  ])
  const sicht = view.units.find((u) => u.id === 'wg')
  assert.deepEqual({ participates: sicht?.participates, selfUsed: sicht?.selfUsed, areaM2: sicht?.areaM2, usageChanges: sicht?.usageChanges }, { participates: false, selfUsed: false, areaM2: 0, usageChanges: [] })
  // `flatOf` nennt die Wohnung, wie sie gespeichert ist (Fläche für den Rechenweg), `roomsOf` die Zimmer der Sicht.
  assert.equal(view.flatOf.get('z1'), w)
  assert.deepEqual(view.roomsOf.get('wg')?.map((u) => u.areaM2), [24, 24, 32])
  assert.deepEqual([...view.rawArea], [['z1', 12], ['z2', 12], ['z3', 16]])
  // Der Bestand selbst bleibt unverändert.
  assert.equal(units[2]?.areaM2, 12)
  assert.equal(w.areaM2, 80)
})

test('Wohnungszahl: EG selbstgenutzt und eine WG mit zwei vermieteten Zimmern sind zwei Wohnungen', () => {
  const units = [unit('eg', { areaM2: 70, participates: false, selfUsed: true }), flat(80), ...rooms(12, 16)]
  const dwelling = (u: Unit) => u.areaM2 > 0
  assert.equal(dwellingsOf(units, dwelling).length, 2)
  assert.equal(mayAgreeOtherwise(units, dwelling), true)
  // Dasselbe in der Sicht der Rechnung (die Wohnung hat dort keine Fläche).
  assert.equal(mayAgreeOtherwise(roomView(units).units, dwelling), true)
})

test('Wohnungszahl: EG vermietet, in der WG ein Zimmer selbstgenutzt und eines vermietet: nicht selbst bewohnt', () => {
  const [z1, z2] = rooms(12, 16)
  const units = [unit('eg', { areaM2: 70 }), flat(80), { ...(z1 as Unit), participates: false, selfUsed: true }, z2 as Unit]
  assert.equal(mayAgreeOtherwise(units, (u) => u.areaM2 > 0), false)
})

test('Wohnungszahl: EG vermietet, in der WG alle Zimmer selbstgenutzt: selbst bewohnt', () => {
  const units = [unit('eg', { areaM2: 70 }), flat(80), ...rooms(12, 16).map((z) => ({ ...z, participates: false, selfUsed: true }))]
  assert.equal(mayAgreeOtherwise(units, (u) => u.areaM2 > 0), true)
})

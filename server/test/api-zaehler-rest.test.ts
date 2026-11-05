// Bezugszähler und verteilter Rest an der Kostenposition (#98, Entwurf 2026-11-04-virtuelle-zaehler-design.md): Speichern,
// Lesen, Teilrumpf, Prüfungen (je ein Satz, 400) und die Löschsperre eines Zählers, auf den eine Position verweist.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { errorFrom, jsonOf, startServer, type Server } from '../testing/api.ts'
import type { CostItem, HeatingPlant, Meter, MeterRest, Property, Unit } from '../../shared/types.ts'

const send = (s: Server, route: string, method: string, body?: unknown) =>
  fetch(`${s.base}${route}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

const created = async <T>(res: Response): Promise<T> => {
  assert.equal(res.status, 201, await res.clone().text())
  return jsonOf<T>(res)
}

const unitIn = (s: Server, name: string, property = 'objekt-1') =>
  send(s, `/api/units?property=${property}`, 'POST', { name, areaM2: 50, participates: true }).then((r) => created<Unit>(r))

const meterIn = (s: Server, body: Partial<Meter> & Pick<Meter, 'name'>, property = 'objekt-1') =>
  send(s, `/api/meters?property=${property}`, 'POST', { unitId: null, type: 'kaltwasser', unit: 'm³', ...body })

const water = { period: '2025-01', category: 'Wasser', description: 'Wasser', amountCents: 100000, key: 'meter', meterType: 'kaltwasser' }

const simple: MeterRest = { referenceMeterId: null, behindMeterIds: null, key: 'area', unitIds: null, subMeters: [] }

// Ein Haus mit drei Wohnungen, deren Zähler, dem Hauptzähler und einem gemeinsamen Zähler ohne Wohnung.
async function house(s: Server) {
  const [u1, u2, u3] = [await unitIn(s, 'EG'), await unitIn(s, 'OG'), await unitIn(s, 'DG')]
  if (!u1 || !u2 || !u3) assert.fail('Wohnungen fehlen')
  const m1 = await created<Meter>(await meterIn(s, { name: 'Wasser EG', unitId: u1.id }))
  const m2 = await created<Meter>(await meterIn(s, { name: 'Wasser OG', unitId: u2.id }))
  const main = await created<Meter>(await meterIn(s, { name: 'Hauptzähler Wasser' }))
  const common = await created<Meter>(await meterIn(s, { name: 'Gartenwasser', scope: 'common' }))
  return { u1, u2, u3, m1, m2, main, common }
}

const post = (s: Server, body: Record<string, unknown>) => send(s, '/api/costItems?property=objekt-1', 'POST', { ...water, ...body })
const rejected = async (res: Response, label: string): Promise<string> => {
  assert.equal(res.status, 400, `${label}: ${res.status} ${await res.clone().text()}`)
  const text = await errorFrom(res)
  assert.ok(text.length > 20 && /[.!?]$/.test(text), `${label}: kein Satz: ${text}`)
  assert.doesNotMatch(text, /constraint|SQLITE|INSERT/i, `${label}: Technik statt Satz: ${text}`)
  return text
}

test('Bezugszähler: eine Position mit meterRest wird gespeichert und gleich gelesen', async () => {
  const s = await startServer()
  try {
    const item = await created<CostItem>(await post(s, { meterRest: simple }))
    assert.deepEqual(item.meterRest, simple)
    const [read] = await s.api<CostItem[]>('/api/costItems')
    assert.deepEqual(read?.meterRest, simple)

    // Mit allem: Bezugszähler, Zähler dahinter, Zwischenzähler mit Ziel, Empfänger.
    const h = await house(s)
    const full: MeterRest = {
      referenceMeterId: h.main.id,
      behindMeterIds: [h.m1.id, h.m2.id],
      key: 'persons',
      unitIds: [h.u1.id, h.u2.id],
      subMeters: [{ meterId: h.common.id, target: { key: 'area', unitIds: [h.u1.id] } }],
    }
    const other = await created<CostItem>(await post(s, { description: 'Wasser 2', meterRest: full }))
    assert.deepEqual(other.meterRest, full)
    const all = await s.api<CostItem[]>('/api/costItems')
    assert.deepEqual(all.find((c) => c.id === other.id)?.meterRest, full)

    const targets: MeterRest['subMeters'] = [
      { meterId: h.common.id, target: 'excluded' },
    ]
    const withTargets = await created<CostItem>(await post(s, { description: 'Wasser 3', meterRest: { ...simple, key: 'landlord', subMeters: targets } }))
    assert.deepEqual(withTargets.meterRest?.subMeters, targets)
  } finally {
    s.stop()
  }
})

test('Bezugszähler: ein Zähler ohne Wohnung mit scope common wird gespeichert, an einer Wohnung abgelehnt', async () => {
  const s = await startServer()
  try {
    const u = await unitIn(s, 'EG')
    const ok = await created<Meter>(await meterIn(s, { name: 'WG Strom', type: 'strom', unit: 'kWh', scope: 'common' }))
    assert.equal(ok.scope, 'common')
    const meters = await s.api<Meter[]>('/api/meters')
    assert.equal(meters.find((m) => m.id === ok.id)?.scope, 'common')
    // Der Hauptzähler ohne Angabe bleibt ohne Feld.
    const plain = await created<Meter>(await meterIn(s, { name: 'Haupt' }))
    assert.equal('scope' in plain, false)
    await rejected(await meterIn(s, { name: 'Zimmer', unitId: u.id, scope: 'common' }), 'common an Wohnung')
    // „property“ ist das Bisherige und wird nicht gespeichert.
    const prop = await created<Meter>(await meterIn(s, { name: 'Haupt 2', scope: 'property' }))
    assert.equal('scope' in prop, false)
  } finally {
    s.stop()
  }
})

test('Bezugszähler: Fälle, die der Server mit einem Satz ablehnt', async () => {
  const s = await startServer()
  try {
    const h = await house(s)
    const otherProperty = await created<Property>(await send(s, '/api/properties', 'POST', { name: 'Zweites Haus' }))
    const foreign = await created<Meter>(await meterIn(s, { name: 'Fremd' }, otherProperty.id))
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send(s, '/api/heating-plants?property=objekt-1', 'POST', { energy: 'gas', method: 'service' }))
    const inPlant = await created<Meter>(await meterIn(s, { name: 'Anlage', heatingPlantId: plant.id, heatingRole: 'supply' }))
    const power = await created<Meter>(await meterIn(s, { name: 'Strom', type: 'strom', unit: 'kWh' }))

    await rejected(await post(s, { key: 'area', meterRest: simple }), 'Schlüssel area')
    await rejected(await post(s, { meterType: 'waerme', meterRest: simple }), 'Sparte Wärme')
    await rejected(await post(s, { meterRest: { ...simple, referenceMeterId: inPlant.id, behindMeterIds: [] } }), 'Bezugszähler der Heizanlage')
    await rejected(await post(s, { meterRest: { ...simple, referenceMeterId: h.main.id, behindMeterIds: [h.m1.id], subMeters: [{ meterId: inPlant.id, target: 'excluded' }] } }), 'Zwischenzähler der Heizanlage')
    await rejected(await post(s, { meterRest: { ...simple, referenceMeterId: foreign.id, behindMeterIds: [] } }), 'Bezugszähler aus anderem Objekt')
    await rejected(await post(s, { meterRest: { ...simple, referenceMeterId: h.main.id, behindMeterIds: [h.main.id] } }), 'Bezugszähler zugleich dahinter')
    await rejected(await post(s, { meterRest: { ...simple, referenceMeterId: h.main.id, behindMeterIds: [h.m1.id, h.m1.id] } }), 'Zähler zweimal dahinter')
    await rejected(await post(s, { meterRest: { ...simple, referenceMeterId: h.main.id, behindMeterIds: [h.m1.id], subMeters: [{ meterId: h.m1.id, target: 'excluded' }] } }), 'Zähler dahinter und Zwischenzähler')
    await rejected(await post(s, { meterRest: { ...simple, referenceMeterId: h.main.id, behindMeterIds: [], subMeters: [{ meterId: h.common.id, target: 'excluded' }, { meterId: h.common.id, target: 'landlord' }] } }), 'Zwischenzähler zweimal')
    await rejected(await post(s, { meterRest: { ...simple, referenceMeterId: h.main.id, behindMeterIds: null } }), 'Bezugszähler ohne Liste')
    await rejected(await post(s, { meterRest: { ...simple, referenceMeterId: power.id, behindMeterIds: [] } }), 'Zähler anderer Sparte')
    await rejected(await post(s, { meterRest: { ...simple, referenceMeterId: h.main.id, behindMeterIds: [h.m1.id], subMeters: [{ meterId: h.m2.id, target: 'excluded' }] } }), 'Zwischenzähler mit Wohnung')
    await rejected(await post(s, { meterRest: { ...simple, referenceMeterId: h.main.id, behindMeterIds: [h.m1.id], subMeters: [{ meterId: h.main.id, target: 'excluded' }] } }), 'Hauptzähler als Zwischenzähler')

    // Teilnehmer: nur EG und OG.
    const part = { participantUnitIds: [h.u1.id, h.u2.id] }
    await rejected(await post(s, { ...part, meterRest: { ...simple, unitIds: [h.u3.id] } }), 'unitIds außerhalb der Teilnehmer')
    await rejected(await post(s, { ...part, meterRest: { ...simple, referenceMeterId: h.main.id, behindMeterIds: [], subMeters: [{ meterId: h.common.id, target: { key: 'area', unitIds: [h.u3.id] } }] } }), 'Ziel außerhalb der Teilnehmer')
    // Innerhalb ist es in Ordnung.
    await created<CostItem>(await post(s, { ...part, meterRest: { ...simple, unitIds: [h.u2.id], referenceMeterId: h.main.id, behindMeterIds: [], subMeters: [{ meterId: h.common.id, target: { key: 'direct', unitIds: [h.u1.id] } }] } }))

    // Unbekannte Form und Zähler.
    await rejected(await post(s, { meterRest: 'viel' }), 'kein Objekt')
    await rejected(await post(s, { meterRest: { ...simple, key: 'weight' } }), 'unbekannter Schlüssel')
    await rejected(await post(s, { meterRest: { ...simple, referenceMeterId: 'gibtsnicht', behindMeterIds: [] } }), 'unbekannter Zähler')
    assert.equal((await s.api<CostItem[]>('/api/costItems?property=objekt-1')).length, 1, 'abgelehnte Positionen wurden nicht gespeichert')
  } finally {
    s.stop()
  }
})

test('Bezugszähler: PUT ohne meterRest lässt es stehen, mit null entfernt es, ein anderer Schlüssel räumt es auf', async () => {
  const s = await startServer()
  try {
    const item = await created<CostItem>(await post(s, { meterRest: simple }))
    const p = await send(s, `/api/costItems/${item.id}`, 'PUT', { amountCents: 120000 })
    assert.equal(p.status, 200, await p.clone().text())
    assert.deepEqual((await s.api<CostItem[]>('/api/costItems'))[0]?.meterRest, simple)

    const changed: MeterRest = { ...simple, key: 'units' }
    await s.api(`/api/costItems/${item.id}`, { method: 'PUT', body: JSON.stringify({ meterRest: changed }) })
    assert.deepEqual((await s.api<CostItem[]>('/api/costItems'))[0]?.meterRest, changed)

    const n = await send(s, `/api/costItems/${item.id}`, 'PUT', { meterRest: null })
    assert.equal(n.status, 200, await n.clone().text())
    const [gone] = await s.api<CostItem[]>('/api/costItems')
    assert.equal(gone && 'meterRest' in gone, false)

    // Wechselt nur der Schlüssel, fällt die Angabe mit weg (wie die Direktzuordnung).
    await s.api(`/api/costItems/${item.id}`, { method: 'PUT', body: JSON.stringify({ meterRest: simple }) })
    const k = await send(s, `/api/costItems/${item.id}`, 'PUT', { key: 'area' })
    assert.equal(k.status, 200, await k.clone().text())
    const [after] = await s.api<CostItem[]>('/api/costItems')
    assert.equal(after && 'meterRest' in after, false)
  } finally {
    s.stop()
  }
})

test('Bezugszähler: ein Zähler, auf den eine Position verweist, wird nicht gelöscht (409 mit Satz)', async () => {
  const s = await startServer()
  try {
    const h = await house(s)
    const item = await created<CostItem>(await post(s, { meterRest: { ...simple, referenceMeterId: h.main.id, behindMeterIds: [h.m1.id], subMeters: [{ meterId: h.common.id, target: 'excluded' }] } }))
    for (const [meter, what] of [[h.main, 'Bezugszähler'], [h.m1, 'Zähler dahinter'], [h.common, 'Zwischenzähler']] as const) {
      const d = await send(s, `/api/meters/${meter.id}`, 'DELETE')
      assert.equal(d.status, 409, `${what}: ${d.status}`)
      assert.match(await errorFrom(d), /„Wasser“/, what)
    }
    // Auch über die Wohnung, deren Zähler dahinter hängt.
    const du = await send(s, `/api/units/${h.u1.id}`, 'DELETE')
    assert.equal(du.status, 409, `Wohnung: ${du.status}`)
    assert.match(await errorFrom(du), /„Wasser“/)
    // Ein Zähler, der nicht gebraucht wird, geht.
    const free = await send(s, `/api/meters/${h.m2.id}`, 'DELETE')
    assert.equal(free.status, 200, await free.clone().text())
    // Ist die Position weg, gehen auch die Zähler.
    assert.equal((await send(s, `/api/costItems/${item.id}`, 'DELETE')).status, 200)
    assert.equal((await send(s, `/api/meters/${h.main.id}`, 'DELETE')).status, 200)
    assert.equal((await send(s, `/api/meters/${h.common.id}`, 'DELETE')).status, 200)
  } finally {
    s.stop()
  }
})

test('Bezugszähler: ein verwendeter Zähler wechselt weder Objekt noch Sparte noch Wohnung', async () => {
  const s = await startServer()
  try {
    const h = await house(s)
    await created<CostItem>(await post(s, { meterRest: { ...simple, referenceMeterId: h.main.id, behindMeterIds: [h.m1.id], subMeters: [{ meterId: h.common.id, target: 'excluded' }] } }))
    assert.equal((await send(s, `/api/meters/${h.main.id}`, 'PUT', { type: 'strom', unit: 'kWh' })).status, 409)
    assert.equal((await send(s, `/api/meters/${h.common.id}`, 'PUT', { unitId: h.u3.id })).status, 400)
    assert.equal((await send(s, `/api/meters/${h.common.id}`, 'PUT', { scope: null })).status, 409)
    // Ein Name ändert sich.
    assert.equal((await send(s, `/api/meters/${h.main.id}`, 'PUT', { name: 'Neu' })).status, 200)
  } finally {
    s.stop()
  }
})

// Nicht vereinbart und im Vertrag benannt je Mietverhältnis (#258, Entwurf Entscheidung 1): zwei Listen an der
// Kostenposition, gespeichert in `cost_item_contract`. Hier über die echten Routen: Lesen, Teilrumpf, und was der
// Server ablehnt (verbotene Kostenart, fremdes oder unbekanntes Mietverhältnis, dieselbe Kennung in beiden Listen).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { errorFrom, jsonOf, startServer, type Server } from '../testing/api.ts'
import type { CostItem, Property, Tenancy, Unit } from '../../shared/types.ts'

const send = (s: Server, route: string, method: string, body: unknown) =>
  fetch(`${s.base}${route}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

async function tenancyIn(s: Server, propertyId: string, unitName: string, tenantName: string): Promise<Tenancy> {
  const unit = await s.api<Unit>(`/api/units?property=${propertyId}`, { method: 'POST', body: JSON.stringify({ name: unitName, areaM2: 60, participates: true }) })
  return s.api<Tenancy>(`/api/tenancies?property=${propertyId}`, { method: 'POST', body: JSON.stringify({
    unitId: unit.id, tenantName, persons: 1, personHistory: [], start: '2023-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [],
  }) })
}

const garden = { period: '2025-01', category: 'Gartenpflege', description: 'Gartenpflege', amountCents: 50000, key: 'area' }

test('Vertrag: beide Listen werden gespeichert und gelesen, ein PUT ohne sie lässt sie stehen', async () => {
  const s = await startServer()
  try {
    const t1 = await tenancyIn(s, 'objekt-1', 'EG', 'Lea Schneider')
    const t2 = await tenancyIn(s, 'objekt-1', 'OG', 'Max Berger')
    const r = await send(s, '/api/costItems', 'POST', { ...garden, notAgreedTenancyIds: [t1.id], namedTenancyIds: [] })
    assert.equal(r.status, 201, await r.clone().text())
    const created = await jsonOf<CostItem>(r)
    assert.deepEqual(created.notAgreedTenancyIds, [t1.id])
    assert.deepEqual(created.namedTenancyIds, [])
    const [read] = await s.api<CostItem[]>('/api/costItems')
    if (!read) assert.fail('Die Position fehlt in der Liste')
    assert.deepEqual(read.notAgreedTenancyIds, [t1.id])
    assert.deepEqual(read.namedTenancyIds, [])

    // Teilrumpf: nur der Betrag ändert sich.
    const p = await send(s, `/api/costItems/${created.id}`, 'PUT', { amountCents: 60000 })
    assert.equal(p.status, 200, await p.clone().text())
    const [after] = await s.api<CostItem[]>('/api/costItems')
    if (!after) assert.fail('Die Position fehlt nach dem PUT')
    assert.equal(after.amountCents, 60000)
    assert.deepEqual(after.notAgreedTenancyIds, [t1.id])
    assert.deepEqual(after.namedTenancyIds, [])

    // Ersetzt, wenn die Felder dastehen.
    await s.api(`/api/costItems/${created.id}`, { method: 'PUT', body: JSON.stringify({ notAgreedTenancyIds: [], namedTenancyIds: [t2.id] }) })
    const [replaced] = await s.api<CostItem[]>('/api/costItems')
    assert.deepEqual(replaced?.notAgreedTenancyIds, [])
    assert.deepEqual(replaced?.namedTenancyIds, [t2.id])

    // Ein gelöschtes Mietverhältnis nimmt seine Zeile mit.
    const d = await fetch(`${s.base}/api/tenancies/${t2.id}`, { method: 'DELETE' })
    assert.ok(d.ok, `DELETE → ${d.status}`)
    const [gone] = await s.api<CostItem[]>('/api/costItems')
    assert.equal(gone && 'namedTenancyIds' in gone, false, 'ohne Zeilen fehlen beide Felder')
  } finally {
    s.stop()
  }
})

test('Vertrag: ohne Angaben fehlen beide Felder', async () => {
  const s = await startServer()
  try {
    await tenancyIn(s, 'objekt-1', 'EG', 'Lea Schneider')
    const created = await jsonOf<CostItem>(await send(s, '/api/costItems', 'POST', garden))
    assert.equal('notAgreedTenancyIds' in created, false)
    assert.equal('namedTenancyIds' in created, false)
    const [read] = await s.api<CostItem[]>('/api/costItems')
    assert.equal(read && 'notAgreedTenancyIds' in read, false)
    assert.equal(read && 'namedTenancyIds' in read, false)
  } finally {
    s.stop()
  }
})

test('Vertrag: bei Heizung, nicht umlagefähig und Rücklage abgelehnt, bei Heizung mit Verweis auf die Heizkostenverordnung', async () => {
  const s = await startServer()
  try {
    const t1 = await tenancyIn(s, 'objekt-1', 'EG', 'Lea Schneider')
    const heat = await send(s, '/api/costItems', 'POST', { ...garden, category: 'Heizung und Warmwasser', description: 'Wartung', notAgreedTenancyIds: [t1.id], namedTenancyIds: [] })
    assert.equal(heat.status, 400)
    assert.match(await errorFrom(heat), /Heizkostenverordnung/)
    for (const category of ['Nicht umlagefähig', 'Zuführung Erhaltungsrücklage']) {
      const r = await send(s, '/api/costItems', 'POST', { ...garden, category, description: category, namedTenancyIds: [t1.id] })
      assert.equal(r.status, 400, category)
      assert.match(await errorFrom(r), new RegExp(category))
    }
    // Leere Listen sind keine Angabe und stören nirgends.
    const leer = await send(s, '/api/costItems', 'POST', { ...garden, category: 'Nicht umlagefähig', description: 'Verwaltung', notAgreedTenancyIds: [], namedTenancyIds: [] })
    assert.equal(leer.status, 201, await leer.clone().text())
    assert.equal((await s.api<CostItem[]>('/api/costItems')).length, 1, 'nichts halb angelegt')
  } finally {
    s.stop()
  }
})

test('Vertrag: Mietverhältnis eines anderen Objekts, unbekannte Kennung und dieselbe Kennung in beiden Listen → 400', async () => {
  const s = await startServer()
  try {
    const t1 = await tenancyIn(s, 'objekt-1', 'EG', 'Lea Schneider')
    const b = await s.api<Property>('/api/properties', { method: 'POST', body: JSON.stringify({ name: 'Zweites Haus' }) })
    const fremd = await tenancyIn(s, b.id, 'B-EG', 'Jonas Weber')
    const route = '/api/costItems?property=objekt-1'
    const cross = await send(s, route, 'POST', { ...garden, notAgreedTenancyIds: [fremd.id] })
    assert.equal(cross.status, 400)
    assert.match(await errorFrom(cross), /Objekt/)
    const unknown = await send(s, route, 'POST', { ...garden, namedTenancyIds: ['gibt-es-nicht'] })
    assert.equal(unknown.status, 400)
    assert.match(await errorFrom(unknown), /Mietverhältnis/)
    const both = await send(s, route, 'POST', { ...garden, notAgreedTenancyIds: [t1.id], namedTenancyIds: [t1.id] })
    assert.equal(both.status, 400)
    assert.match(await errorFrom(both), /Lea Schneider/)
    assert.equal((await s.api<CostItem[]>(route)).length, 0, 'nichts angelegt')
  } finally {
    s.stop()
  }
})

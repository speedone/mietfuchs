// Zimmer einer Wohnung (#573): speichern und prüfen über die Routen. Eine Einheit, auf die andere verweisen
// (`parentUnitId`), ist eine Wohnung mit Zimmern; ihre Regeln stehen in db/rooms.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CostItem, Meter, Property, Settlement, Tenancy, Unit, UnitDependents } from '../../shared/types.ts'
import { errorFrom, startServer, type Server } from '../testing/api.ts'

const json = (body: unknown) => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const post = (s: Server, route: string, body: unknown) => fetch(`${s.base}${route}`, { method: 'POST', ...json(body) })
const put = (s: Server, route: string, body: unknown) => fetch(`${s.base}${route}`, { method: 'PUT', ...json(body) })
const unit = (s: Server, name: string, extra: object = {}) => s.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name, areaM2: 20, participates: true, ...extra }) })
const tenancy = (unitId: string) => ({
  unitId, tenantName: 'A', persons: 1, personHistory: [], start: '2025-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [],
})
const refused = async (r: Response, pattern: RegExp, status = 400) => {
  const text = await errorFrom(r)
  assert.equal(r.status, status, text)
  assert.match(text, pattern)
}

test('Zimmer anlegen: parentUnitId wird gespeichert, gelesen und gelöst', async () => {
  const s = await startServer()
  try {
    const w = await unit(s, '1. OG links', { areaM2: 80 })
    const z = await unit(s, 'Zimmer 1', { parentUnitId: w.id })
    assert.equal(z.parentUnitId, w.id)
    assert.equal((await s.api<Unit[]>('/api/units')).find((u) => u.id === z.id)?.parentUnitId, w.id)
    assert.equal((await s.api<Unit[]>('/api/units')).find((u) => u.id === w.id)?.parentUnitId, undefined)
    const frei = await s.api<Unit>(`/api/units/${z.id}`, { method: 'PUT', body: JSON.stringify({ parentUnitId: null }) })
    assert.equal(frei.parentUnitId, undefined)
  } finally { s.stop() }
})

test('Zimmer: die Regeln der Verknüpfung, je mit Satz', async () => {
  const s = await startServer()
  try {
    const w = await unit(s, 'Wohnung')
    const z = await unit(s, 'Zimmer 1', { parentUnitId: w.id })
    const [eigenes] = await s.api<Property[]>('/api/properties')
    const anderes = await s.api<Property>('/api/properties', { method: 'POST', body: JSON.stringify({ name: 'Zweites Haus' }) })
    const fremd = await unit(s, 'Fremd', { propertyId: anderes.id })
    const hier = { propertyId: eigenes?.id }
    await refused(await post(s, '/api/units', { ...hier, name: 'Z', areaM2: 10, participates: true, parentUnitId: fremd.id }), /anderen Objekt/)
    await refused(await post(s, '/api/units', { ...hier, name: 'Z', areaM2: 10, participates: true, parentUnitId: z.id }), /Zimmer kann nicht in einem Zimmer liegen/)
    const w2 = await unit(s, 'Wohnung 2', hier)
    await refused(await put(s, `/api/units/${w.id}`, { parentUnitId: w2.id }), /nur eine Ebene/)
    await refused(await put(s, `/api/units/${w.id}`, { propertyId: anderes.id }), /anderes Objekt/)
    await refused(await put(s, `/api/units/${w.id}`, { selfUsed: true }), /selbstgenutzt/)
    await refused(await put(s, `/api/units/${w.id}`, { usageChanges: [{ from: '2025-06-01', usage: 'eigen' }] }), /Nutzungswechsel/)
    await refused(await put(s, `/api/units/${z.id}`, { parentUnitId: z.id }), /nicht in sich selbst/)
    // Selbstgenutzte Wohnung oder eine mit Mietverhältnis nimmt kein Zimmer.
    const eigen = await unit(s, 'Eigen', { ...hier, selfUsed: true })
    await refused(await post(s, '/api/units', { ...hier, name: 'Z', areaM2: 10, participates: true, parentUnitId: eigen.id }), /selbstgenutzt/)
    const vermietet = await unit(s, 'Vermietet', hier)
    assert.equal((await post(s, '/api/tenancies', tenancy(vermietet.id))).status, 201)
    await refused(await post(s, '/api/units', { ...hier, name: 'Z', areaM2: 10, participates: true, parentUnitId: vermietet.id }), /Mietverhältnis/)
  } finally { s.stop() }
})

test('Wohnung mit Zimmern: kein Mietverhältnis, kein Empfänger, nur bestimmte Zähler', async () => {
  const s = await startServer()
  try {
    const w = await unit(s, 'Wohnung')
    await unit(s, 'Zimmer 1', { parentUnitId: w.id })
    await refused(await post(s, '/api/tenancies', tenancy(w.id)), /hat Zimmer.*Mietverhältnis/)
    const item = (extra: object) => post(s, '/api/costItems', { year: 2025, category: 'Wasser', description: 'Wasser', amountCents: 1000, key: 'area', ...extra })
    await refused(await item({ key: 'direct', directUnitId: w.id }), /bekommt selbst keinen Anteil/)
    await refused(await item({ participantUnitIds: [w.id] }), /bekommt selbst keinen Anteil/)
    await refused(await item({ key: 'custom', customShares: { [w.id]: 100 } }), /bekommt selbst keinen Anteil/)
    await refused(await item({ selfAmounts: { [w.id]: 100 } }), /bekommt selbst keinen Anteil/)
    await refused(await item({ key: 'meter', meterType: 'kaltwasser', meterRest: { referenceMeterId: null, behindMeterIds: null, key: 'area', unitIds: [w.id], subMeters: [] } }), /bekommt selbst keinen Anteil/)
    const gruppe = await post(s, '/api/meters', { name: 'Teil', unitId: null, type: 'kaltwasser', unit: 'm³', scope: 'common' })
    const teil = await jsonMeter(gruppe)
    await refused(await item({ key: 'meter', meterType: 'kaltwasser', meterRest: { referenceMeterId: null, behindMeterIds: null, key: 'area', unitIds: null, subMeters: [{ meterId: teil.id, target: { key: 'area', unitIds: [w.id] } }] } }), /bekommt selbst keinen Anteil/)
    for (const type of ['waerme', 'hkv', 'warmwasser'] as const) {
      await refused(await post(s, '/api/meters', { name: type, unitId: w.id, type, unit: type === 'hkv' ? 'Einheiten' : type === 'warmwasser' ? 'm³' : 'kWh' }), /nur Zähler für Kaltwasser, Strom und Sonstiges/)
    }
    for (const type of ['kaltwasser', 'strom', 'sonstig'] as const) {
      assert.equal((await post(s, '/api/meters', { name: type, unitId: w.id, type, unit: type === 'kaltwasser' ? 'm³' : 'kWh' })).status, 201, type)
    }
  } finally { s.stop() }
})

const jsonMeter = async (r: Response) => (await r.json()) as Meter

test('Zimmer an eine Einheit mit Wärmezähler oder Empfänger-Angabe hängen: abgelehnt', async () => {
  const s = await startServer()
  try {
    const w = await unit(s, 'Wohnung')
    assert.equal((await post(s, '/api/meters', { name: 'Wärme', unitId: w.id, type: 'waerme', unit: 'kWh' })).status, 201)
    await refused(await post(s, '/api/units', { name: 'Z', areaM2: 10, participates: true, parentUnitId: w.id }), /„Wärme“ \(Wärme\)/)
    const w2 = await unit(s, 'Wohnung 2')
    assert.equal((await post(s, '/api/costItems', { year: 2025, category: 'Müll', description: 'Müll', amountCents: 1000, key: 'direct', directUnitId: w2.id })).status, 201)
    await refused(await post(s, '/api/units', { name: 'Z', areaM2: 10, participates: true, parentUnitId: w2.id }), /als Empfänger genannt/)
  } finally { s.stop() }
})

test('Wohnung mit Zimmern löschen: 409 mit Satz, dependents zählt die Zimmer', async () => {
  const s = await startServer()
  try {
    const w = await unit(s, 'Wohnung')
    const z1 = await unit(s, 'Zimmer 1', { parentUnitId: w.id })
    await unit(s, 'Zimmer 2', { parentUnitId: w.id })
    assert.equal((await s.api<UnitDependents>(`/api/units/${w.id}/dependents`)).rooms, 2)
    await refused(await fetch(`${s.base}/api/units/${w.id}`, { method: 'DELETE' }), /Zimmer/, 409)
    assert.equal((await fetch(`${s.base}/api/units/${z1.id}`, { method: 'DELETE' })).status, 200)
    assert.equal((await s.api<UnitDependents>(`/api/units/${w.id}/dependents`)).rooms, 1)
  } finally { s.stop() }
})

test('roomSplit: nur beim Schlüssel meter gespeichert und gelesen', async () => {
  const s = await startServer()
  try {
    const base = { year: 2025, category: 'Wasser', description: 'Wasser', amountCents: 1000 }
    const meter = await s.api<CostItem>('/api/costItems', { method: 'POST', body: JSON.stringify({ ...base, key: 'meter', meterType: 'kaltwasser', roomSplit: 'persons' }) })
    assert.equal(meter.roomSplit, 'persons')
    assert.equal((await s.api<CostItem[]>('/api/costItems')).find((c) => c.id === meter.id)?.roomSplit, 'persons')
    const area = await s.api<CostItem>('/api/costItems', { method: 'POST', body: JSON.stringify({ ...base, description: 'Fläche', key: 'area', roomSplit: 'persons' }) })
    assert.equal(area.roomSplit, undefined)
    assert.equal((await s.api<CostItem[]>('/api/costItems')).find((c) => c.id === area.id)?.roomSplit, undefined)
    // Beim Wechsel des Schlüssels fällt sie weg.
    const gewechselt = await s.api<CostItem>(`/api/costItems/${meter.id}`, { method: 'PUT', body: JSON.stringify({ key: 'area' }) })
    assert.equal(gewechselt.roomSplit, undefined)
    assert.equal((await s.api<CostItem[]>('/api/costItems')).find((c) => c.id === meter.id)?.roomSplit, undefined)
  } finally { s.stop() }
})

// Sicht der Rechnung (#573, Task 2): Abrechnung und Anschreiben nennen das Zimmer mit vollem Namen und wirksamer Fläche;
// die Stammdaten zeigen es, wie es gespeichert ist.
test('Zimmer in Abrechnung und Anschreiben: voller Name, wirksame Fläche; Stammdaten unverändert', async () => {
  const s = await startServer()
  try {
    await unit(s, 'A', { areaM2: 60 })
    const w = await unit(s, 'WG', { areaM2: 80, participates: false })
    const z1 = await unit(s, 'Zimmer 1', { areaM2: 12, parentUnitId: w.id })
    await unit(s, 'Zimmer 2', { areaM2: 12, parentUnitId: w.id })
    await unit(s, 'Zimmer 3', { areaM2: 16, parentUnitId: w.id })
    const t = await s.api<Tenancy>('/api/tenancies', { method: 'POST', body: JSON.stringify(tenancy(z1.id)) })
    await s.api('/api/costItems', { method: 'POST', body: JSON.stringify({ period: '2025-01', category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 100000, key: 'area' }) })
    const st = await s.api<Settlement>('/api/settlement/2025')
    const mine = st.statements.find((x) => x.tenancyId === t.id)
    assert.equal(mine?.unitName, 'Zimmer 1 in der Wohnung WG')
    assert.equal(mine?.totalShareCents, 17143)
    assert.equal(st.letters?.[t.id]?.premises?.areaM2, 24)
    const listed = (await s.api<Unit[]>('/api/units')).find((u) => u.id === z1.id)
    assert.deepEqual([listed?.name, listed?.areaM2], ['Zimmer 1', 12])
  } finally { s.stop() }
})

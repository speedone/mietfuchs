// Eigene Kostenarten je Objekt und Abrechnungszeitraum (gewerbliche Abrechnung, db/costTypes.ts): anlegen, ändern,
// entfernen, aus dem Vorjahr übernehmen, an Positionen hängen, auf Abrechnung und Export, im Backup.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CostItem, CostType, Property, Settlement, Unit } from '../../shared/types.ts'
import { errorFrom, jsonOf, restore, startServer, type Server } from '../testing/api.ts'

const send = (s: Server, path: string, method: string, body?: unknown) =>
  fetch(`${s.base}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

async function stock(s: Server): Promise<{ unit: Unit }> {
  const unit = await s.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'Halle', areaM2: 100, participates: true }) })
  await s.api('/api/tenancies', {
    method: 'POST',
    body: JSON.stringify({ unitId: unit.id, tenantName: 'Gewerbe GmbH', start: '2025-01-01', end: null, persons: 1, personHistory: [{ from: '2025-01-01', persons: 1 }], prepayments: [], prepaymentOverrides: {}, baseRents: [] }),
  })
  return { unit }
}

test('Eigene Kostenarten: anlegen, Liste je Zeitraum, Name eindeutig, Grundart aus der Liste', async () => {
  const s = await startServer()
  try {
    const created = await jsonOf<CostType>(await send(s, '/api/cost-types', 'POST', { period: '2025-01', name: '  Sicherheitsdienst ', baseCategory: 'Sonstige Betriebskosten' }))
    assert.deepEqual([created.name, created.baseCategory, created.period, created.itemCount], ['Sicherheitsdienst', 'Sonstige Betriebskosten', '2025-01', 0])
    assert.equal((await s.api<CostType[]>('/api/cost-types?period=2025-01')).length, 1)
    assert.equal((await s.api<CostType[]>('/api/cost-types?period=2024-01')).length, 0)
    const doppelt = await send(s, '/api/cost-types', 'POST', { period: '2025-01', name: 'sicherheitsdienst', baseCategory: 'Aufzug' })
    assert.equal(doppelt.status, 400)
    assert.match(await errorFrom(doppelt), /gibt es in diesem Zeitraum schon/)
    for (const falsch of [{ period: '2025-01', name: '', baseCategory: 'Aufzug' }, { period: '2025-01', name: 'X', baseCategory: 'Erfunden' }, { name: 'Y', baseCategory: 'Aufzug' }]) {
      assert.equal((await send(s, '/api/cost-types', 'POST', falsch)).status, 400, JSON.stringify(falsch))
    }
  } finally {
    s.stop()
  }
})

test('Eigene Kostenarten: Position mit Kostenart, Name auf Abrechnung und Export, Sperren bei Positionen', async () => {
  const s = await startServer()
  try {
    await stock(s)
    const art = await jsonOf<CostType>(await send(s, '/api/cost-types', 'POST', { period: '2025-01', name: 'Sicherheitsdienst', baseCategory: 'Sonstige Betriebskosten' }))
    const item = { period: '2025-01', category: 'Sonstige Betriebskosten', costTypeId: art.id, description: 'Aufschaltung Gefahrenmeldeanlage', amountCents: 101782, key: 'area' }
    // Die Kostenart der Position muss die Grundart sein.
    const falsch = await send(s, '/api/costItems', 'POST', { ...item, category: 'Aufzug' })
    assert.equal(falsch.status, 400)
    assert.match(await errorFrom(falsch), /rechnet als „Sonstige Betriebskosten“/)
    // Eine Kostenart eines anderen Zeitraums nicht.
    const vorjahr = await jsonOf<CostType>(await send(s, '/api/cost-types', 'POST', { period: '2024-01', name: 'Sicherheitsdienst', baseCategory: 'Sonstige Betriebskosten' }))
    const anderer = await send(s, '/api/costItems', 'POST', { ...item, costTypeId: vorjahr.id })
    assert.equal(anderer.status, 400)
    assert.match(await errorFrom(anderer), /anderen Abrechnungszeitraum/)
    const position = await jsonOf<CostItem>(await send(s, '/api/costItems', 'POST', item))
    assert.equal(position.costTypeId, art.id)

    const settlement = await s.api<Settlement>('/api/settlement/2025')
    const row = settlement.statements[0]?.rows[0] ?? assert.fail('keine Zeile')
    assert.deepEqual([row.costType, row.category, row.shareCents], ['Sicherheitsdienst', 'Sonstige Betriebskosten', 101782])
    const csv = await (await fetch(`${s.base}/api/settlement/2025/export?format=csv`)).text()
    assert.match(csv, /;Position;Sicherheitsdienst;Aufschaltung Gefahrenmeldeanlage;/)
    const json = await (await fetch(`${s.base}/api/settlement/2025/export?format=json`)).json() as { statements: { rows: { costType: string | null, category: string }[] }[] }
    assert.deepEqual([json.statements[0]?.rows[0]?.costType, json.statements[0]?.rows[0]?.category], ['Sicherheitsdienst', 'Sonstige Betriebskosten'])

    // Umbenennen gilt auch für die Position; die Grundart nicht ändern, nicht entfernen, solange eine Position daran hängt.
    assert.equal((await jsonOf<CostType>(await send(s, `/api/cost-types/${art.id}`, 'PUT', { name: 'Wachdienst' }))).name, 'Wachdienst')
    assert.equal((await s.api<Settlement>('/api/settlement/2025')).statements[0]?.rows[0]?.costType, 'Wachdienst')
    const grundart = await send(s, `/api/cost-types/${art.id}`, 'PUT', { baseCategory: 'Aufzug' })
    assert.equal(grundart.status, 409)
    const weg = await send(s, `/api/cost-types/${art.id}`, 'DELETE')
    assert.equal(weg.status, 409)
    assert.match(await errorFrom(weg), /hängen eine Position/)
    // Ohne Position geht es; die Position behält dann ihre Grundart.
    await s.api(`/api/costItems/${position.id}`, { method: 'PUT', body: JSON.stringify({ costTypeId: null }) })
    assert.equal((await send(s, `/api/cost-types/${art.id}`, 'DELETE')).status, 200)
    const ohne = (await s.api<Settlement>('/api/settlement/2025')).statements[0]?.rows[0]
    assert.deepEqual([ohne?.costType, ohne?.category], [undefined, 'Sonstige Betriebskosten'])
  } finally {
    s.stop()
  }
})

test('Eigene Kostenarten: aus dem Vorjahr übernehmen, nur fehlende, in derselben Reihenfolge', async () => {
  const s = await startServer()
  try {
    for (const name of ['Sicherheitsdienst', 'Wartung Brandschutz', 'Verwaltung']) {
      await send(s, '/api/cost-types', 'POST', { period: '2024-01', name, baseCategory: name === 'Verwaltung' ? 'Nicht umlagefähig' : 'Sonstige Betriebskosten' })
    }
    await send(s, '/api/cost-types', 'POST', { period: '2025-01', name: 'Verwaltung', baseCategory: 'Sonstige Betriebskosten' })
    const r = await jsonOf<{ created: number, types: CostType[] }>(await send(s, '/api/cost-types/carry-over', 'POST', { period: '2025-01' }))
    assert.equal(r.created, 2)
    assert.deepEqual(r.types.map((t) => [t.name, t.baseCategory]), [['Verwaltung', 'Sonstige Betriebskosten'], ['Sicherheitsdienst', 'Sonstige Betriebskosten'], ['Wartung Brandschutz', 'Sonstige Betriebskosten']])
    assert.equal((await jsonOf<{ created: number }>(await send(s, '/api/cost-types/carry-over', 'POST', { period: '2025-01' }))).created, 0, 'ein zweites Mal legt nichts doppelt an')
  } finally {
    s.stop()
  }
})

test('Eigene Kostenarten: im Backup erhalten; der Wechsel des Rhythmus ist mit ihnen gesperrt', async () => {
  const s = await startServer()
  try {
    await stock(s)
    const art = await jsonOf<CostType>(await send(s, '/api/cost-types', 'POST', { period: '2025-01', name: 'Sicherheitsdienst', baseCategory: 'Sonstige Betriebskosten' }))
    await send(s, '/api/costItems', 'POST', { period: '2025-01', category: 'Sonstige Betriebskosten', costTypeId: art.id, description: 'Wache', amountCents: 1000, key: 'area' })
    const backup = Buffer.from(await (await fetch(`${s.base}/api/backup`)).arrayBuffer())
    await s.api(`/api/cost-types/${art.id}`, { method: 'PUT', body: JSON.stringify({ name: 'Anders' }) })
    const back = await restore(s, backup)
    assert.equal(back.status, 200, JSON.stringify(back.body))
    assert.deepEqual((await s.api<CostType[]>('/api/cost-types')).map((t) => [t.name, t.itemCount]), [['Sicherheitsdienst', 1]])
    const [objekt] = await s.api<Property[]>('/api/properties')
    const wechsel = await send(s, `/api/properties/${objekt?.id}/period/preview`, 'POST', { rules: { startMonth: 5, changes: [] } })
    assert.equal(wechsel.status, 400)
    assert.match(await errorFrom(wechsel), /eigene Kostenarten/)
  } finally {
    s.stop()
  }
})

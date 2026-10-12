// Integrationstests gegen den echten Server: CO₂-Erstattung an Mieter, die selbst heizen (Heizung PR 19, #97).
// Der Server läuft als eigener Prozess mit NKA_DATA_DIR auf einem Wegwerf-Ordner (testing/api.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Settlement, Tenancy, Unit } from '../../shared/types.ts'
import { errorFrom, jsonOf, startServer } from '../testing/api.ts'

const jsonPost = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })
const send = (base: string, path: string, method: string, body?: unknown) =>
  fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

test('CO₂-Erstattung: Routen anlegen, lesen, ändern, löschen; nur bei „Mieter heizt selbst“; verrechnet als Gutschrift', async () => {
  const s = await startServer()
  try {
    const unit = await s.api<Unit>('/api/units', jsonPost({ name: 'EG', areaM2: 80, participates: true }))
    const tenancy = await s.api<Tenancy>('/api/tenancies', jsonPost({
      unitId: unit.id, tenantName: 'Mieter', personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null,
      prepayments: [{ from: '2020-01', monthlyCents: 10000 }],
    }))
    const body = { tenancyId: tenancy.id, supplierBilledAt: '2025-01-20', claimedAt: '2025-03-01', amountCents: 24000, settlePeriod: '2025-01' }
    // Prüfung M4: ohne „Mieter heizt selbst“ abgelehnt.
    const abgelehnt = await send(s.base, '/api/co2-refunds', 'POST', body)
    assert.equal(abgelehnt.status, 400)
    assert.match(await errorFrom(abgelehnt), /Mieter heizt selbst/)
    await s.api(`/api/tenancies/${tenancy.id}`, { method: 'PUT', body: JSON.stringify({ heatingModel: 'selfSupply' }) })
    const created = await send(s.base, '/api/co2-refunds', 'POST', body)
    assert.equal(created.status, 201)
    const r = await jsonOf<{ id: string }>(created)
    const list = await s.api<{ id: string; tenantName: string; refundDue: string }[]>('/api/co2-refunds')
    assert.deepEqual(list.map((x) => [x.id, x.tenantName, x.refundDue]), [[r.id, 'Mieter', '2026-03-01']])
    // In der Abrechnung 2025 als Gutschriftzeile beim Mieter.
    const settlement = await s.api<Settlement>('/api/settlement/2025')
    const row = settlement.statements[0]?.rows.find((x) => x.kind === 'co2Refund') ?? assert.fail('keine Gutschriftzeile')
    assert.equal(row.shareCents, -24000)
    const changed = await s.api<{ amountCents: number }>(`/api/co2-refunds/${r.id}`, { method: 'PUT', body: JSON.stringify({ amountCents: 20000 }) })
    assert.equal(changed.amountCents, 20000)
    assert.equal((await send(s.base, '/api/co2-refunds/gibt-es-nicht', 'PUT', { amountCents: 1 })).status, 404)
    assert.equal((await send(s.base, `/api/co2-refunds/${r.id}`, 'DELETE')).status, 200)
    assert.equal((await send(s.base, `/api/co2-refunds/${r.id}`, 'DELETE')).status, 404)
  } finally {
    s.stop()
  }
})

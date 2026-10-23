// Integrationstest: Export der Abrechnung als JSON und CSV (#415, Teil 3), offen und abgeschlossen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Tenancy, Unit } from '../../shared/types.ts'
import type { SettlementExport } from '../src/settlementExport.ts'
import { startServer } from '../testing/api.ts'

test('Export: JSON und CSV mit den Zahlen der Abrechnung, eingefroren nach dem Abschluss', async () => {
  const s = await startServer()
  try {
    await s.api('/api/settings', { method: 'PUT', body: JSON.stringify({ landlordName: 'Max Vermieter' }) })
    const unit = await s.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 60, participates: true }) })
    await s.api<Tenancy>('/api/tenancies', { method: 'POST', body: JSON.stringify({ unitId: unit.id, tenantName: 'Erika Mustermann', persons: 1, start: '2024-01-01', end: null, prepayments: [{ from: '2024-01', monthlyCents: 4000 }] }) })
    await s.api('/api/costItems', { method: 'POST', body: JSON.stringify({ period: '2025-01', category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 60000, key: 'area' }) })

    const res = await fetch(`${s.base}/api/settlement/2025/export?format=json`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') ?? '', /application\/json/)
    assert.match(res.headers.get('content-disposition') ?? '', /attachment; filename="abrechnung-.*-2025\.json"/)
    const json = (await res.json()) as SettlementExport
    assert.equal(json.format, 'mietfuchs-abrechnung')
    assert.equal(json.version, 1)
    const st = json.statements[0] ?? assert.fail('keine Abrechnung')
    assert.equal(st.tenantName, 'Erika Mustermann')
    assert.equal(st.totalShareCents, 60000)
    assert.equal(st.prepaymentCents, 48000)
    assert.equal(st.balanceCents, -12000)
    assert.equal(json.closed, null)

    const csvRes = await fetch(`${s.base}/api/settlement/2025/export?format=csv`)
    assert.match(csvRes.headers.get('content-type') ?? '', /text\/csv/)
    assert.match(csvRes.headers.get('content-disposition') ?? '', /\.csv"/)
    const bytes = Buffer.from(await csvRes.arrayBuffer())
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM')
    const csv = bytes.toString('utf8')
    assert.ok(csv.includes('Mieter;Wohnung;'))
    assert.ok(csv.includes('Nachzahlung') && csv.includes('120,00'))

    assert.equal((await fetch(`${s.base}/api/settlement/2025/export?format=xml`)).status, 400)
    assert.equal((await fetch(`${s.base}/api/settlement/2025/export`)).status, 400)

    assert.equal((await fetch(`${s.base}/api/settlement/2025/close`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 201)
    const closed = (await (await fetch(`${s.base}/api/settlement/2025/export?format=json`)).json()) as SettlementExport
    assert.ok(closed.closed)
    assert.equal(closed.statements[0]?.balanceCents, -12000)
  } finally {
    s.stop()
  }
})

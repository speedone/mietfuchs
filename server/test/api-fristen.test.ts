// „Demnächst fällig“ über die Route (#190): GET /api/upcoming je Objekt, mit dem Tag des Servers (NKA_TEST_TODAY).
// Die Regeln im Einzelnen prüft fristen-cockpit.test.ts an der reinen Funktion.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { DepositEntry, Meter, Property, Tenancy, Unit, UpcomingDeadlines } from '../../shared/types.ts'
import { withEnv, type Server } from '../testing/api.ts'

const post = <T>(s: Server, url: string, body: unknown) => s.api<T>(url, { method: 'POST', body: JSON.stringify(body) })
const send = (s: Server, method: string, url: string, body?: unknown) =>
  fetch(`${s.base}${url}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

test('Demnächst fällig: Abrechnungsfrist, nach dem Versand die Einwendungsfrist, Eichfrist und Kaution je Objekt', async () => {
  await withEnv({ NKA_TEST_TODAY: '2026-11-20' }, async (s) => {
    const unit = await post<Unit>(s, '/api/units', { name: 'EG', areaM2: 80, participates: true })
    const tenancy = await post<Tenancy>(s, '/api/tenancies', {
      unitId: unit.id, tenantName: 'Erika Mustermann', persons: 1, start: '2025-01-01', end: null,
      prepayments: [{ from: '2025-01', monthlyCents: 15000 }], prepaymentOverrides: {}, baseRents: [{ from: '2025-01', monthlyCents: 80000 }],
    })
    await post(s, '/api/costItems', { period: '2025-01', category: 'Grundsteuer', description: 'Grundsteuer 2025', amountCents: 60000, key: 'area' })
    const meter = await post<Meter>(s, '/api/meters', { name: 'Kaltwasser EG', unitId: unit.id, type: 'kaltwasser', unit: 'm³', calibratedUntil: 2026 })

    const first = await s.api<UpcomingDeadlines>('/api/upcoming')
    assert.equal(first.today, '2026-11-20')
    assert.equal(first.until, '2027-02-18')
    assert.deepEqual(first.items, [
      { kind: 'calibration', id: `calibration:${meter.id}`, date: '2026-12-31', meterId: meter.id, meterName: 'Kaltwasser EG' },
      { kind: 'settlement', id: 'settlement:2025-01', date: '2026-12-31', period: '2025-01', label: '2025', closed: false },
    ])

    // Abgeschlossen ohne Versanddatum: die Abrechnungsfrist bleibt, als abgeschlossen gekennzeichnet.
    assert.equal((await send(s, 'POST', '/api/settlement/2025-01/close', {})).status, 201)
    const closed = await s.api<UpcomingDeadlines>('/api/upcoming')
    assert.deepEqual(closed.items.filter((i) => i.kind === 'settlement').map((i) => i.kind === 'settlement' && i.closed), [true])

    // Versendet: statt der Abrechnungsfrist die Einwendungsfrist, gerechnet ab dem Versanddatum.
    assert.equal((await send(s, 'PUT', '/api/settlement/2025-01/close', { sentAt: '2026-01-20' })).status, 200)
    const sent = await s.api<UpcomingDeadlines>('/api/upcoming')
    assert.deepEqual(sent.items.map((i) => i.id), [`calibration:${meter.id}`, 'objection:2025-01'])
    assert.deepEqual(sent.items[1], { kind: 'objection', id: 'objection:2025-01', date: '2027-01-31', period: '2025-01', label: '2025', sentAt: '2026-01-20' })

    // Ausgezogen, Kaution liegt noch beim Vermieter.
    await s.api(`/api/tenancies/${tenancy.id}`, { method: 'PUT', body: JSON.stringify({ end: '2026-08-31' }) })
    await post<DepositEntry>(s, '/api/deposit-entries', { tenancyId: tenancy.id, date: '2025-01-05', kind: 'received', amountCents: 160000 })
    const moved = await s.api<UpcomingDeadlines>('/api/upcoming')
    assert.deepEqual(moved.items[0], { kind: 'deposit', id: `deposit:${tenancy.id}`, date: '2026-08-31', tenancyId: tenancy.id, tenantName: 'Erika Mustermann', balanceCents: 160000 })

    // Ein zweites Objekt: ohne Angabe 400, mit Angabe nur seine Liste.
    const [own] = await s.api<Property[]>('/api/properties')
    const other = await post<Property>(s, '/api/properties', { name: 'Gartenweg 3' })
    assert.equal((await send(s, 'GET', '/api/upcoming')).status, 400)
    assert.deepEqual((await s.api<UpcomingDeadlines>(`/api/upcoming?property=${other.id}`)).items, [])
    assert.equal((await s.api<UpcomingDeadlines>(`/api/upcoming?property=${own?.id ?? assert.fail('Objekt fehlt')}`)).items.length, 3)
  })
})

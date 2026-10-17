// Die Art einer Zahlung über die Routen (#280): gespeichert und geliefert, fehlend Miete, unbekannt 400,
// ein Teilrumpf ändert sie nicht; Mietkonto und Steuerübersicht führen die Zahlungen aus der Abrechnung
// gesondert; ein Backup einer Datenbank von vor der Spalte kommt mit „rent“ zurück.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { applyMigrations, connect, loadMigrations } from '../src/db/client.ts'
import type { Payment, RentLedger, TaxReport, Tenancy, Unit } from '../../shared/types.ts'
import { jsonOf, restore, startServer } from '../testing/api.ts'

test('Zahlungen: Art gespeichert und geliefert, fehlend Miete, unbekannt 400, Teilrumpf lässt sie stehen', async () => {
  const s = await startServer()
  try {
    const post = <T>(route: string, body: unknown) => s.api<T>(route, { method: 'POST', body: JSON.stringify(body) })
    const eg = await post<Unit>('/api/units', { name: 'EG', areaM2: 80, participates: true })
    const t = await post<Tenancy>('/api/tenancies', {
      unitId: eg.id, tenantName: 'A', persons: 1, start: '2025-01-01', end: null,
      prepayments: [{ from: '2025-01', monthlyCents: 15000 }], prepaymentOverrides: {}, baseRents: [{ from: '2025-01', monthlyCents: 65000 }],
    })
    for (let m = 1; m <= 12; m++) await post('/api/payments', { tenancyId: t.id, date: `2025-${String(m).padStart(2, '0')}-03`, amountCents: 80000 })
    const guthaben = await post<Payment>('/api/payments', { tenancyId: t.id, date: '2025-06-15', amountCents: -20000, kind: 'settlement', note: 'Guthaben 2024' })
    assert.equal(guthaben.kind, 'settlement')

    const res = await fetch(`${s.base}/api/payments`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenancyId: t.id, date: '2025-07-01', amountCents: 100, kind: 'kaution' }),
    })
    assert.equal(res.status, 400)
    assert.match((await jsonOf<{ error: string }>(res)).error, /Unbekannte Art der Zahlung/)

    // Teilrumpf ohne Art
    const geaendert = await s.api<Payment>(`/api/payments/${guthaben.id}`, { method: 'PUT', body: JSON.stringify({ note: 'Abrechnung 2024' }) })
    assert.equal(geaendert.kind, 'settlement')

    const alle = await s.api<Payment[]>('/api/payments')
    assert.equal(alle.length, 13)
    assert.deepEqual([...new Set(alle.filter((p) => p.id !== guthaben.id).map((p) => p.kind))], ['rent'])

    const ledger = await s.api<RentLedger>('/api/rentledger/2025')
    assert.equal(ledger.rows[0]?.months[11]?.status, 'paid')
    assert.equal(ledger.rows[0]?.settlementYearCents, -20000)
    assert.equal(ledger.totals.settlementYearCents, -20000)
    assert.equal(ledger.totals.openCents, 0)

    const tax = await s.api<TaxReport>('/api/taxreport/2025')
    assert.equal(tax.income.paidCents, 960000 - 20000)
    assert.equal(tax.income.settlementRefundsCents, 20000)
    assert.equal(tax.income.settlementBackPaymentsCents, 0)
  } finally {
    s.stop()
  }
})

test('Zahlungen: ein Backup mit einer Datenbank von vor der Spalte kommt mit der Art „rent“ zurück', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-zahlungsart-backup-'))
  const s = await startServer()
  try {
    const file = path.join(dir, 'mietfuchs.sqlite')
    const c = await connect(file)
    const migrations = await loadMigrations()
    const bis = migrations.findIndex((m) => m.tag.endsWith('_zahlungsart'))
    if (bis < 0) assert.fail('Schritt …_zahlungsart fehlt')
    applyMigrations(c, migrations.slice(0, bis))
    c.exec(`INSERT INTO units (id, property_id, name, area_m2, participates) VALUES ('u', 'objekt-1', 'EG', 50, 1)`)
    c.exec(`INSERT INTO tenancies (id, unit_id, tenant_name, persons, start) VALUES ('t', 'u', 'Mieter', 1, '2025-01-01')`)
    c.exec(`INSERT INTO payments (id, tenancy_id, date, amount_cents) VALUES ('p1', 't', '2025-01-03', 80000), ('p2', 't', '2025-06-15', -20000)`)
    c.close()
    const zip = new AdmZip()
    zip.addFile('mietfuchs.sqlite', fs.readFileSync(file))
    const r = await restore(s, zip.toBuffer())
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const alle = await s.api<Payment[]>('/api/payments')
    assert.deepEqual(alle.map((p) => [p.id, p.kind]), [['p1', 'rent'], ['p2', 'rent']])
  } finally {
    s.stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

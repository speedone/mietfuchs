// Die Art einer Zahlung über die Routen (#280): gespeichert und geliefert, fehlend Miete, unbekannt 400,
// ein Teilrumpf ändert sie nicht; Mietkonto und Steuerübersicht führen die Zahlungen aus der Abrechnung
// gesondert; ein Backup einer Datenbank von vor der Spalte kommt mit „rent“ zurück. Der Monat laut Verwendungszweck
// (#281): setzen und leeren über PUT, 400 an einer Zahlung aus der Abrechnung und außerhalb des Mietverhältnisses, im
// Mietkonto wirksam und im Backup erhalten.
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
    // Älter als der Monat laut Verwendungszweck (#281): keine Bestimmung.
    assert.deepEqual(alle.map((p) => p.designatedMonth ?? null), [null, null])
  } finally {
    s.stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Zahlungen: Monat laut Verwendungszweck setzen und leeren, 400 an der Abrechnung und außerhalb, im Mietkonto wirksam, im Backup erhalten', async () => {
  const s = await startServer()
  try {
    const post = <T>(route: string, body: unknown) => s.api<T>(route, { method: 'POST', body: JSON.stringify(body) })
    const put = (id: string, body: unknown) => fetch(`${s.base}/api/payments/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const eg = await post<Unit>('/api/units', { name: 'EG', areaM2: 80, participates: true })
    const t = await post<Tenancy>('/api/tenancies', {
      unitId: eg.id, tenantName: 'A', persons: 1, start: '2025-01-01', end: null,
      prepayments: [{ from: '2025-01', monthlyCents: 20000 }], prepaymentOverrides: {}, baseRents: [{ from: '2025-01', monthlyCents: 60000 }],
    })
    // Januar nichts, am 03.02. eine Monatsmiete: ohne Bestimmung deckt sie die Vorauszahlungen und die Kaltmiete Januar.
    const feb = await post<Payment>('/api/payments', { tenancyId: t.id, date: '2025-02-03', amountCents: 80000 })
    const guthaben = await post<Payment>('/api/payments', { tenancyId: t.id, date: '2025-06-15', amountCents: -20000, kind: 'settlement' })
    const before = (await s.api<RentLedger>('/api/rentledger/2025')).rows[0]?.months ?? assert.fail('keine Zeile')
    assert.deepEqual([before[0]?.status, before[1]?.status], ['partial', 'partial'])

    const set = await put(feb.id, { designatedMonth: '2025-02' })
    assert.equal(set.status, 200)
    assert.equal((await jsonOf<Payment>(set)).designatedMonth, '2025-02')
    const after = (await s.api<RentLedger>('/api/rentledger/2025')).rows[0]?.months ?? assert.fail('keine Zeile')
    assert.deepEqual([after[0]?.status, after[1]?.status], ['open', 'paid'], 'die Bestimmung gilt (§ 366 Abs. 1 BGB)')

    const atSettlement = await put(guthaben.id, { designatedMonth: '2025-06' })
    assert.equal(atSettlement.status, 400)
    assert.match((await jsonOf<{ error: string }>(atSettlement)).error, /Eine Zahlung aus der Abrechnung gilt dem Saldo, nicht einem Monat\./)
    const outside = await put(feb.id, { designatedMonth: '2024-12' })
    assert.equal(outside.status, 400)
    assert.match((await jsonOf<{ error: string }>(outside)).error, /außerhalb des Mietverhältnisses\. Das Mietverhältnis besteht seit 01\.01\.2025\./)
    const form = await put(feb.id, { designatedMonth: 'Februar' })
    assert.equal(form.status, 400)

    // Im Backup erhalten: einspielen, und der Monat ist noch da.
    const backup = Buffer.from(await (await fetch(`${s.base}/api/backup`)).arrayBuffer())
    const cleared = await put(feb.id, { designatedMonth: null })
    assert.equal(cleared.status, 200)
    assert.equal((await jsonOf<Payment>(cleared)).designatedMonth, undefined)
    const r = await restore(s, backup)
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const back = await s.api<Payment[]>('/api/payments')
    assert.deepEqual(back.map((p) => [p.id, p.designatedMonth ?? null]), [[feb.id, '2025-02'], [guthaben.id, null]])
  } finally {
    s.stop()
  }
})

test('Mietkonto über die Route: eine versandte Abrechnung macht die nicht gezahlte Vorauszahlung nicht mehr einzeln einforderbar (#281 E5)', async () => {
  const s = await startServer()
  try {
    const post = <T>(route: string, body: unknown) => s.api<T>(route, { method: 'POST', body: JSON.stringify(body) })
    const eg = await post<Unit>('/api/units', { name: 'EG', areaM2: 80, participates: true })
    const t = await post<Tenancy>('/api/tenancies', {
      unitId: eg.id, tenantName: 'A', persons: 1, start: '2024-01-01', end: '2024-12-31',
      prepayments: [{ from: '2024-01', monthlyCents: 20000 }], prepaymentOverrides: {}, baseRents: [{ from: '2024-01', monthlyCents: 60000 }],
    })
    await post('/api/costItems', { period: '2024-01', category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 50000, key: 'area' })
    // Januar bis November gezahlt, der Dezember fehlt ganz: 200 € Vorauszahlung und 600 € Kaltmiete offen.
    for (let m = 1; m <= 11; m++) await post('/api/payments', { tenancyId: t.id, date: `2024-${String(m).padStart(2, '0')}-03`, amountCents: 80000 })
    const open = await s.api<RentLedger>('/api/rentledger/2025')
    assert.deepEqual(open.carriedOnly.map((r) => [r.openCents, r.notDemandableCents]), [[80000, 0]], 'ohne erteilte Abrechnung: alles einforderbar (Frist bis 31.12.2025)')

    // Abgeschlossen und am 01.03.2025 versandt, ohne Jahreskorrektur: Sie rechnet das Soll an.
    const closed = await fetch(`${s.base}/api/settlement/2024/close`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sentAt: '2025-03-01' }) })
    assert.equal(closed.status, 201, JSON.stringify(await jsonOf(closed)))
    const l = await s.api<RentLedger>('/api/rentledger/2025')
    assert.deepEqual(l.carriedOnly, [{
      tenancyId: t.id, tenantName: 'A', unitName: 'EG', end: '2024-12-31', openCents: 60000, notDemandableCents: 20000,
      notDemandable: [{ reason: 'creditedAsPaid', label: '2024', cents: 20000, differenceCents: 20000 }],
    }])
    assert.equal(l.totals.openCents, 60000)
    assert.equal(l.totals.notDemandableCents, 20000)
  } finally {
    s.stop()
  }
})

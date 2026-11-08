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
import type { MarkPaidPayment, MarkPaidPlan, Payment, RentLedger, TaxReport, Tenancy, Unit } from '../../shared/types.ts'
import { errorFrom, jsonOf, restore, startServer, withEnv, type Server } from '../testing/api.ts'
import { journalOf, revert } from '../testing/revert.ts'
import { openFreshDatabase } from '../testing/freshDatabase.ts'
import { createEntity, insertPayments } from '../src/db/repository.ts'
import { readPayments } from '../src/db/read.ts'

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
    // Am 01.01. 100 € (das Objekt erfasst ab Januar, #281), am 03.02. eine Monatsmiete: ohne Bestimmung deckt sie zuerst
    // die offenen Vorauszahlungen, dann die Kaltmiete Januar; beide Monate bleiben teilweise offen.
    await post('/api/payments', { tenancyId: t.id, date: '2025-01-01', amountCents: 10000 })
    const feb = await post<Payment>('/api/payments', { tenancyId: t.id, date: '2025-02-03', amountCents: 80000 })
    const guthaben = await post<Payment>('/api/payments', { tenancyId: t.id, date: '2025-06-15', amountCents: -20000, kind: 'settlement' })
    const before = (await s.api<RentLedger>('/api/rentledger/2025')).rows[0]?.months ?? assert.fail('keine Zeile')
    assert.deepEqual([before[0]?.status, before[1]?.status], ['partial', 'partial'])

    const set = await put(feb.id, { designatedMonth: '2025-02' })
    assert.equal(set.status, 200)
    assert.equal((await jsonOf<Payment>(set)).designatedMonth, '2025-02')
    const after = (await s.api<RentLedger>('/api/rentledger/2025')).rows[0]?.months ?? assert.fail('keine Zeile')
    assert.deepEqual([after[0]?.status, after[1]?.status], ['partial', 'paid'], 'die Bestimmung gilt (§ 366 Abs. 1 BGB)')

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
    assert.deepEqual(back.filter((p) => p.date !== '2025-01-01').map((p) => [p.id, p.designatedMonth ?? null]), [[feb.id, '2025-02'], [guthaben.id, null]])
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

// #608: „Offene Monate als bezahlt erfassen“ über die Routen. Der Server rechnet mit festem Tag (NKA_TEST_TODAY).
const markPaidPost = (s: Server, url: string, body: unknown) =>
  fetch(`${s.base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

test('Monate als bezahlt erfassen: Vorschau, Anlegen in einem Schritt mit einem Eintrag im Verlauf, 409 bei geänderter Marke, 400', async () => {
  await withEnv({ NKA_TEST_TODAY: '2025-04-20' }, async (s) => {
    const post = <T>(route: string, body: unknown) => s.api<T>(route, { method: 'POST', body: JSON.stringify(body) })
    await s.api('/api/properties/objekt-1', { method: 'PUT', body: JSON.stringify({ state: 'NW' }) })
    const eg = await post<Unit>('/api/units', { name: 'EG', areaM2: 80, participates: true })
    const og = await post<Unit>('/api/units', { name: 'OG', areaM2: 60, participates: true })
    const rents = { prepayments: [{ from: '2025-01', monthlyCents: 20000 }], prepaymentOverrides: {}, baseRents: [{ from: '2025-01', monthlyCents: 60000 }] }
    const a = await post<Tenancy>('/api/tenancies', { unitId: eg.id, tenantName: 'Albers', persons: 1, start: '2025-01-01', end: null, ...rents })
    const b = await post<Tenancy>('/api/tenancies', { unitId: og.id, tenantName: 'Brandt', persons: 1, start: '2025-01-01', end: null, ...rents })
    await post('/api/payments', { tenancyId: a.id, date: '2025-01-03', amountCents: 80000 })
    await post('/api/payments', { tenancyId: b.id, date: '2025-01-03', amountCents: 30000, designatedMonth: '2025-01' })

    const plan = await post<MarkPaidPlan>('/api/rentledger/2025/mark-paid/plan', { tenancyIds: [a.id, b.id], through: '2025-03' })
    assert.deepEqual(plan.payments.map((p) => [p.tenantName, p.month, p.date, p.amountCents]), [
      ['Albers', '2025-02', '2025-02-05', 80000],
      ['Albers', '2025-03', '2025-03-05', 80000],
      ['Brandt', '2025-01', '2025-01-06', 50000],
      ['Brandt', '2025-02', '2025-02-05', 80000],
      ['Brandt', '2025-03', '2025-03-05', 80000],
    ])
    assert.equal(plan.totalCents, 370000)
    assert.deepEqual(plan.unresolved, [])
    assert.deepEqual(plan.othersAffected, [])
    assert.match(plan.token, /^[0-9a-f]{32}$/)

    // 400: kein Mietverhältnis, fremdes Mietverhältnis, Monat nach dem laufenden, anderes Jahr, keine Marke.
    const refused = async (url: string, body: unknown, text: RegExp) => {
      const res = await markPaidPost(s, url, body)
      assert.equal(res.status, 400, url)
      assert.match(await errorFrom(res), text)
    }
    await refused('/api/rentledger/2025/mark-paid/plan', { tenancyIds: [], through: '2025-03' }, /Wählen Sie mindestens ein Mietverhältnis/)
    await refused('/api/rentledger/2025/mark-paid/plan', { tenancyIds: ['gibt-es-nicht'], through: '2025-03' }, /gehört nicht zu diesem Objekt/)
    await refused('/api/rentledger/2025/mark-paid/plan', { tenancyIds: [a.id], through: '2025-05' }, /nicht nach dem laufenden Monat/)
    await refused('/api/rentledger/2025/mark-paid/plan', { tenancyIds: [a.id], through: '2024-12' }, /im Jahr 2025/)
    await refused('/api/rentledger/2025/mark-paid', { tenancyIds: [a.id], through: '2025-03' }, /zuerst die Vorschau/)

    // Ändert sich der Bestand nach der Vorschau, 409 mit der neuen Vorschau; nichts angelegt.
    await post('/api/payments', { tenancyId: a.id, date: '2025-02-04', amountCents: 80000 })
    const stale = await markPaidPost(s, '/api/rentledger/2025/mark-paid', { tenancyIds: [a.id, b.id], through: '2025-03', token: plan.token })
    assert.equal(stale.status, 409)
    const staleBody = await jsonOf<{ error: string, plan: MarkPaidPlan }>(stale)
    assert.match(staleBody.error, /Der Stand hat sich geändert/)
    assert.equal(staleBody.plan.payments.length, 4, 'Februar von Albers ist inzwischen bezahlt')
    assert.equal((await s.api<Payment[]>('/api/payments')).length, 3)

    const created = await markPaidPost(s, '/api/rentledger/2025/mark-paid', { tenancyIds: [a.id, b.id], through: '2025-03', token: staleBody.plan.token })
    assert.equal(created.status, 200, await created.clone().text())
    const done = await jsonOf<{ ok: boolean, count: number, payments: (MarkPaidPayment & { id: string })[] }>(created)
    assert.equal(done.count, 4)
    const stored = await s.api<Payment[]>('/api/payments')
    assert.equal(stored.length, 7)
    const added = stored.filter((p) => done.payments.some((d) => d.id === p.id))
    assert.deepEqual(added.map((p) => [p.tenancyId, p.date, p.amountCents, p.kind, p.designatedMonth, p.note]).sort(), [
      [a.id, '2025-03-05', 80000, 'rent', '2025-03', 'als bezahlt erfasst'],
      [b.id, '2025-01-06', 50000, 'rent', '2025-01', 'als bezahlt erfasst'],
      [b.id, '2025-02-05', 80000, 'rent', '2025-02', 'als bezahlt erfasst'],
      [b.id, '2025-03-05', 80000, 'rent', '2025-03', 'als bezahlt erfasst'],
    ].sort())
    const ledger = await s.api<RentLedger>('/api/rentledger/2025')
    for (const row of ledger.rows) assert.deepEqual(row.months.slice(0, 3).map((m) => m.status), ['paid', 'paid', 'paid'], row.tenantName)

    // Ein Eintrag im Verlauf, mit der Zahl; danach ist nichts mehr offen.
    const [newest] = await journalOf(s)
    assert.equal(newest?.title, '4 Mietzahlungen als bezahlt erfasst')
    assert.equal(newest?.rows, 4)
    const again = await post<MarkPaidPlan>('/api/rentledger/2025/mark-paid/plan', { tenancyIds: [a.id, b.id], through: '2025-03' })
    assert.deepEqual(again.payments, [])
    // Rückgängig nimmt alle vier zurück.
    await revert(s, newest?.id ?? assert.fail('kein Eintrag'))
    assert.equal((await s.api<Payment[]>('/api/payments')).length, 3)
  })
})

test('Monate als bezahlt erfassen: Zahlungen ganz oder gar nicht; bei einem Fehler wird keine angelegt', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-als-bezahlt-'))
  const opened = await openFreshDatabase(dataDir)
  try {
    await opened.write(async (db) => {
      await createEntity(db, 'units', 'u', { propertyId: 'objekt-1', name: 'EG', areaM2: 50, participates: true })
      await createEntity(db, 'tenancies', 't', { unitId: 'u', tenantName: 'Mieter', persons: 1, start: '2025-01-01' })
    })
    let n = 0
    const ids = () => `p${++n}`
    const good = { tenancyId: 't', date: '2025-01-06', amountCents: 80000, kind: 'rent', designatedMonth: '2025-01', note: 'als bezahlt erfasst' }
    // Der zweite Rumpf nennt einen Monat außerhalb des Mietverhältnisses: `guardPayment` lehnt ab.
    await assert.rejects(opened.write((db) => insertPayments(db, [good, { ...good, designatedMonth: '2024-12' }], ids, 'x')), /außerhalb des Mietverhältnisses/)
    assert.deepEqual(await opened.read(readPayments), [])
    assert.deepEqual(await opened.write((db) => insertPayments(db, [good, { ...good, date: '2025-02-05', designatedMonth: '2025-02' }], ids, 'x')), ['p3', 'p4'])
    assert.equal((await opened.read(readPayments)).length, 2)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})

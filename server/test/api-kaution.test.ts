// Kautionsbuchungen über die Routen (#228, Teil 1): anlegen, ändern, löschen; die Prüfungen vor dem Schreiben; der
// Stand fällt an keinem Tag unter null; Buchungen folgen ihrem Mietverhältnis; Verlauf und Rücksprung; Mietkonto und
// Steuer bleiben unberührt.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { DepositEntry, DepositStatementInfo, PaymentListItem, RentLedger, TaxReport, Tenancy, Unit } from '../../shared/types.ts'
import { errorFrom, startServer, withEnv, type Server } from '../testing/api.ts'
import { journalOf, newest, revert } from '../testing/revert.ts'

const send = (s: Server, method: string, url: string, body?: unknown) =>
  fetch(`${s.base}${url}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
const post = <T>(s: Server, url: string, body: unknown) => s.api<T>(url, { method: 'POST', body: JSON.stringify(body) })

async function stock(s: Server, propertyQuery = ''): Promise<{ unit: Unit; tenancy: Tenancy }> {
  const unit = await post<Unit>(s, `/api/units${propertyQuery}`, { name: 'EG', areaM2: 80, participates: true })
  const tenancy = await post<Tenancy>(s, '/api/tenancies', {
    unitId: unit.id, tenantName: 'Erika Mustermann', persons: 1, start: '2025-01-01', end: null, depositCents: 240000,
    prepayments: [{ from: '2025-01', monthlyCents: 15000 }], prepaymentOverrides: {}, baseRents: [{ from: '2025-01', monthlyCents: 80000 }],
  })
  return { unit, tenancy }
}
const entries = (s: Server, propertyQuery = '') => s.api<DepositEntry[]>(`/api/deposit-entries${propertyQuery}`)

test('Kautionsbuchung anlegen, ändern, löschen', async () => {
  const s = await startServer()
  try {
    const { tenancy } = await stock(s)
    const res = await send(s, 'POST', '/api/deposit-entries', { tenancyId: tenancy.id, date: '2025-03-01', kind: 'received', amountCents: 240000, note: '  erste Rate  ' })
    assert.equal(res.status, 201)
    const created = await res.json() as DepositEntry
    assert.deepEqual(created, { id: created.id, tenancyId: tenancy.id, date: '2025-03-01', kind: 'received', amountCents: 240000, note: 'erste Rate' })
    assert.deepEqual(await entries(s), [created])

    const changed = await s.api<DepositEntry>(`/api/deposit-entries/${created.id}`, { method: 'PUT', body: JSON.stringify({ amountCents: 250000 }) })
    assert.equal(changed.amountCents, 250000)
    assert.equal(changed.date, '2025-03-01')
    assert.equal(changed.note, 'erste Rate')

    // Verrechnung mit Schaden: der Zweck wird gespeichert; beim Wechsel der Art fällt er weg.
    const applied = await post<DepositEntry>(s, '/api/deposit-entries', { tenancyId: tenancy.id, date: '2025-04-01', kind: 'applied', purpose: 'damage', amountCents: 5000 })
    assert.equal(applied.purpose, 'damage')
    const asRefund = await s.api<DepositEntry>(`/api/deposit-entries/${applied.id}`, { method: 'PUT', body: JSON.stringify({ kind: 'refunded' }) })
    assert.equal(asRefund.purpose, undefined)

    assert.equal((await send(s, 'DELETE', `/api/deposit-entries/${applied.id}`)).status, 200)
    assert.equal((await send(s, 'DELETE', `/api/deposit-entries/${created.id}`)).status, 200)
    assert.deepEqual(await entries(s), [])
    assert.equal((await send(s, 'DELETE', `/api/deposit-entries/${created.id}`)).status, 404)
    assert.equal((await send(s, 'PUT', `/api/deposit-entries/${created.id}`, { amountCents: 1 })).status, 404)
  } finally {
    s.stop()
  }
})

test('Kautionsbuchung: abgelehnt wird, was keine Buchung ist', async () => {
  const s = await startServer()
  try {
    const { tenancy } = await stock(s)
    const base = { tenancyId: tenancy.id, date: '2025-03-01', kind: 'received', amountCents: 100000 }
    const refused = async (patch: Record<string, unknown>, status: number, text: RegExp) => {
      const res = await send(s, 'POST', '/api/deposit-entries', { ...base, ...patch })
      assert.equal(res.status, status, JSON.stringify(patch))
      assert.match(await errorFrom(res), text, JSON.stringify(patch))
    }
    for (const amountCents of [0, -1, 12.5, 'viel', null]) await refused({ amountCents }, 400, /^Betrag der Kautionsbuchung ist ein Betrag größer als 0\.$/)
    await refused({ date: '2025-02-30' }, 400, /Datum/)
    await refused({ date: '' }, 400, /Datum/)
    await refused({ kind: 'retained' }, 400, /Art der Kautionsbuchung/)
    await refused({ kind: 'applied' }, 400, /^Bitte geben Sie an, womit Sie verrechnen\.$/)
    await refused({ kind: 'applied', purpose: 'foo' }, 400, /^Bitte geben Sie an, womit Sie verrechnen\.$/)
    await refused({ purpose: 'damage' }, 400, /Zweck/)
    await refused({ tenancyId: 'gibt-es-nicht' }, 404, /Mietverhältnis/)
    await refused({ note: 'x'.repeat(501) }, 400, /Notiz/)
    assert.deepEqual(await entries(s), [])

    // Eine Zahlung lässt sich in Teil 1 nicht anhängen: `paymentId` im Rumpf wird nicht gelesen.
    const withPayment = await post<DepositEntry>(s, '/api/deposit-entries', { ...base, paymentId: 'irgendeine' })
    assert.equal(withPayment.paymentId, undefined)
  } finally {
    s.stop()
  }
})

test('Kautionsbuchung: der Stand fällt an keinem Tag unter null', async () => {
  const s = await startServer()
  try {
    const { tenancy } = await stock(s)
    const received = await post<DepositEntry>(s, '/api/deposit-entries', { tenancyId: tenancy.id, date: '2025-03-01', kind: 'received', amountCents: 100000 })
    // Rückdatiert vor den Eingang: abgelehnt, obwohl die Summe am Ende aufginge.
    const early = await send(s, 'POST', '/api/deposit-entries', { tenancyId: tenancy.id, date: '2025-02-01', kind: 'refunded', amountCents: 100000 })
    assert.equal(early.status, 400)
    assert.equal(await errorFrom(early), 'Mehr als die Kaution hergibt: Am 01.02.2025 fehlten 1.000,00 €.')

    const refunded = await post<DepositEntry>(s, '/api/deposit-entries', { tenancyId: tenancy.id, date: '2025-06-01', kind: 'refunded', amountCents: 100000 })
    // Den Eingang löschen oder kürzen, nachdem zurückgezahlt ist.
    const remove = await send(s, 'DELETE', `/api/deposit-entries/${received.id}`)
    assert.equal(remove.status, 400)
    assert.equal(await errorFrom(remove), 'Mehr als die Kaution hergibt: Am 01.06.2025 fehlten 1.000,00 €.')
    const cut = await send(s, 'PUT', `/api/deposit-entries/${received.id}`, { amountCents: 50000 })
    assert.equal(cut.status, 400)
    assert.equal(await errorFrom(cut), 'Mehr als die Kaution hergibt: Am 01.06.2025 fehlten 500,00 €.')
    // Die Rückzahlung vor den Eingang ziehen.
    assert.equal((await send(s, 'PUT', `/api/deposit-entries/${refunded.id}`, { date: '2025-01-15' })).status, 400)
    assert.deepEqual((await entries(s)).map((e) => [e.id, e.date, e.amountCents]), [[received.id, '2025-03-01', 100000], [refunded.id, '2025-06-01', 100000]])

    // In der richtigen Reihenfolge geht es: erst die Rückzahlung löschen, dann den Eingang.
    assert.equal((await send(s, 'DELETE', `/api/deposit-entries/${refunded.id}`)).status, 200)
    assert.equal((await send(s, 'DELETE', `/api/deposit-entries/${received.id}`)).status, 200)
  } finally {
    s.stop()
  }
})

test('Kautionsbuchung: sie folgt ihrem Mietverhältnis, je Objekt gelistet', async () => {
  const s = await startServer()
  try {
    const { tenancy } = await stock(s)
    const b = await post<{ id: string }>(s, '/api/properties', { name: 'Zweites Haus' })
    const other = await stock(s, `?property=${b.id}`)
    const first = await post<DepositEntry>(s, '/api/deposit-entries', { tenancyId: tenancy.id, date: '2025-03-01', kind: 'received', amountCents: 100000 })
    const second = await post<DepositEntry>(s, '/api/deposit-entries', { tenancyId: other.tenancy.id, date: '2025-03-01', kind: 'received', amountCents: 70000 })
    assert.deepEqual((await entries(s, '?property=objekt-1')).map((e) => e.id), [first.id])
    assert.deepEqual((await entries(s, `?property=${b.id}`)).map((e) => e.id), [second.id])

    // Eine Buchung wandert nicht in ein anderes Objekt.
    const moved = await send(s, 'PUT', `/api/deposit-entries/${first.id}`, { tenancyId: other.tenancy.id })
    assert.equal(moved.status, 400)
    assert.match(await errorFrom(moved), /anderes Mietverhältnis/)

    // Ein Mietverhältnis, das in eine Wohnung eines anderen Objekts wechselt, nimmt seine Buchungen mit: Das alte Objekt
    // liefert sie nicht mehr (Review Focus 5).
    assert.equal((await send(s, 'PUT', `/api/tenancies/${tenancy.id}`, { unitId: other.unit.id })).status, 200)
    assert.deepEqual(await entries(s, '?property=objekt-1'), [])
    assert.deepEqual((await entries(s, `?property=${b.id}`)).map((e) => e.id), [first.id, second.id])

    // Mit dem Mietverhältnis fallen seine Buchungen weg, die des anderen bleiben.
    assert.equal((await send(s, 'DELETE', `/api/tenancies/${tenancy.id}`)).status, 200)
    assert.deepEqual((await entries(s, `?property=${b.id}`)).map((e) => e.id), [second.id])
  } finally {
    s.stop()
  }
})

test('Kautionsbuchung: Verlauf und Rücksprung', async () => {
  const s = await startServer()
  try {
    const { tenancy } = await stock(s)
    const created = await post<DepositEntry>(s, '/api/deposit-entries', { tenancyId: tenancy.id, date: '2025-03-01', kind: 'received', amountCents: 240000 })
    const top = await newest(s)
    assert.match(top.title, /^Kautionsbuchung angelegt/)
    await s.api(`/api/deposit-entries/${created.id}`, { method: 'PUT', body: JSON.stringify({ amountCents: 250000 }) })
    assert.match((await newest(s)).title, /^Kautionsbuchung geändert/)
    await revert(s, (await newest(s)).id)
    assert.equal((await entries(s))[0]?.amountCents, 240000)
    await revert(s, top.id)
    assert.deepEqual(await entries(s), [])
    await s.api(`/api/deposit-entries`, { method: 'POST', body: JSON.stringify({ tenancyId: tenancy.id, date: '2025-03-01', kind: 'received', amountCents: 1000 }) })
    const [again] = await entries(s)
    if (!again) assert.fail('Buchung fehlt')
    await s.api(`/api/deposit-entries/${again.id}`, { method: 'DELETE' })
    assert.match((await journalOf(s, '?limit=1'))[0]?.title ?? '', /^Kautionsbuchung gelöscht/)
  } finally {
    s.stop()
  }
})

test('Kautionsbuchung: Mietkonto und Steuer bleiben, wie sie sind', async () => {
  const s = await startServer()
  try {
    const { tenancy } = await stock(s)
    for (let m = 1; m <= 12; m++) await post(s, '/api/payments', { tenancyId: tenancy.id, date: `2025-${String(m).padStart(2, '0')}-03`, amountCents: 95000 })
    const ledger = await s.api<RentLedger>('/api/rentledger/2025')
    const tax = await s.api<TaxReport>('/api/taxreport/2025')
    for (const body of [
      { date: '2025-01-05', kind: 'received', amountCents: 240000 },
      { date: '2025-12-31', kind: 'interest', amountCents: 1234 },
      { date: '2025-12-31', kind: 'applied', purpose: 'damage', amountCents: 30000 },
      { date: '2025-12-31', kind: 'refunded', amountCents: 211234 },
    ]) await post(s, '/api/deposit-entries', { tenancyId: tenancy.id, ...body })
    assert.equal((await entries(s)).length, 4)
    assert.deepEqual(await s.api<RentLedger>('/api/rentledger/2025'), ledger)
    assert.deepEqual(await s.api<TaxReport>('/api/taxreport/2025'), tax)
  } finally {
    s.stop()
  }
})

// ---------- Teil 2: Verrechnung mit Miete oder Abrechnung als gebundene Zahlung ----------

const BOUND = 'Diese Zahlung stammt aus der Kaution. Löschen Sie die Verrechnung unter Stammdaten bei „Kaution führen“ und legen Sie sie neu an.'

// Ausgezogen am 31.12.2025; Januar bis November je 950 € (Soll 800 € kalt + 150 € Vorauszahlung), Dezember offen;
// 2.400 € Kaution eingegangen. Der übliche Fall der Verrechnung: nach dem Auszug, mit dem letzten offenen Monat.
async function withArrears(s: Server): Promise<{ tenancy: Tenancy }> {
  const { tenancy: running } = await stock(s)
  const tenancy = await s.api<Tenancy>(`/api/tenancies/${running.id}`, { method: 'PUT', body: JSON.stringify({ end: '2025-12-31' }) })
  for (let m = 1; m <= 11; m++) await post(s, '/api/payments', { tenancyId: tenancy.id, date: `2025-${String(m).padStart(2, '0')}-03`, amountCents: 95000 })
  await post(s, '/api/deposit-entries', { tenancyId: tenancy.id, date: '2025-01-05', kind: 'received', amountCents: 240000 })
  return { tenancy }
}
const paymentsOf = (s: Server) => s.api<PaymentListItem[]>('/api/payments')

test('Verrechnung mit Mietrückstand legt eine Mietzahlung an', async () => {
  const s = await startServer()
  try {
    const { tenancy } = await withArrears(s)
    const tax2025 = await s.api<TaxReport>('/api/taxreport/2025')
    const tax2026 = await s.api<TaxReport>('/api/taxreport/2026')
    const entry = await post<DepositEntry>(s, '/api/deposit-entries', { tenancyId: tenancy.id, date: '2026-02-10', kind: 'applied', purpose: 'rent', amountCents: 95000 })
    const payment = (await paymentsOf(s)).find((p) => p.id === entry.paymentId) ?? assert.fail('keine Zahlung zur Verrechnung')
    assert.deepEqual({ ...payment, id: '' }, { id: '', tenancyId: tenancy.id, date: '2026-02-10', amountCents: 95000, kind: 'rent', note: 'Aus der Kaution verrechnet', fromDeposit: true })
    const december = (await s.api<RentLedger>('/api/rentledger/2025')).rows[0]?.months[11] ?? assert.fail('kein Dezember')
    assert.equal(december.paidLaterOn, '2026-02-10')
    const after2026 = await s.api<TaxReport>('/api/taxreport/2026')
    assert.equal((after2026.income.received?.formerYearsCents ?? 0) - (tax2026.income.received?.formerYearsCents ?? 0), 95000)
    assert.equal(after2026.income.paidCents - tax2026.income.paidCents, 95000)
    assert.deepEqual(await s.api<TaxReport>('/api/taxreport/2025'), tax2025)
  } finally {
    s.stop()
  }
})

test('Verrechnung mit der Nachzahlung legt eine Abrechnungszahlung an', async () => {
  const s = await startServer()
  try {
    const { tenancy } = await withArrears(s)
    const before = await s.api<TaxReport>('/api/taxreport/2026')
    const entry = await post<DepositEntry>(s, '/api/deposit-entries', { tenancyId: tenancy.id, date: '2026-03-01', kind: 'applied', purpose: 'settlement', amountCents: 18000 })
    const payment = (await paymentsOf(s)).find((p) => p.id === entry.paymentId) ?? assert.fail('keine Zahlung zur Verrechnung')
    assert.equal(payment.kind, 'settlement')
    const after = await s.api<TaxReport>('/api/taxreport/2026')
    assert.equal(after.income.settlementBackPaymentsCents - before.income.settlementBackPaymentsCents, 18000)
  } finally {
    s.stop()
  }
})

test('die gebundene Zahlung ist geschützt', async () => {
  const s = await startServer()
  try {
    const { tenancy } = await withArrears(s)
    const entry = await post<DepositEntry>(s, '/api/deposit-entries', { tenancyId: tenancy.id, date: '2026-02-10', kind: 'applied', purpose: 'rent', amountCents: 95000 })
    const url = `/api/payments/${entry.paymentId}`
    for (const patch of [{ amountCents: 1 }, { date: '2026-02-11' }, { kind: 'settlement' }]) {
      const res = await send(s, 'PUT', url, patch)
      assert.equal(res.status, 409, JSON.stringify(patch))
      assert.equal(await errorFrom(res), BOUND)
    }
    const other = await post<Tenancy>(s, '/api/tenancies', { unitId: tenancy.unitId, tenantName: 'Zweiter', persons: 1, start: '2026-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] })
    assert.equal((await send(s, 'PUT', url, { tenancyId: other.id })).status, 409)
    assert.equal((await send(s, 'PUT', url, { note: 'Kaution verrechnet, Dezember 2025' })).status, 200)
    assert.equal((await send(s, 'PUT', url, { designatedMonth: '2025-12' })).status, 200)
    // Unverändert gesendet ist keine Änderung.
    assert.equal((await send(s, 'PUT', url, { amountCents: 95000, date: '2026-02-10', kind: 'rent' })).status, 200)
  } finally {
    s.stop()
  }
})

test('gebundene Zahlung und Verrechnung fallen gemeinsam weg, von beiden Seiten', async () => {
  const s = await startServer()
  try {
    const { tenancy } = await withArrears(s)
    const a = await post<DepositEntry>(s, '/api/deposit-entries', { tenancyId: tenancy.id, date: '2026-02-10', kind: 'applied', purpose: 'rent', amountCents: 95000 })
    assert.equal((await send(s, 'DELETE', `/api/payments/${a.paymentId}`)).status, 200)
    assert.deepEqual((await entries(s)).map((e) => e.kind), ['received'])
    const b = await post<DepositEntry>(s, '/api/deposit-entries', { tenancyId: tenancy.id, date: '2026-02-10', kind: 'applied', purpose: 'rent', amountCents: 95000 })
    assert.equal((await send(s, 'DELETE', `/api/deposit-entries/${b.id}`)).status, 200)
    assert.equal((await paymentsOf(s)).some((p) => p.id === b.paymentId), false)
    assert.equal((await paymentsOf(s)).length, 11)
  } finally {
    s.stop()
  }
})

test('Ändern der Verrechnung zieht die Zahlung mit', async () => {
  const s = await startServer()
  try {
    const { tenancy } = await withArrears(s)
    const entry = await post<DepositEntry>(s, '/api/deposit-entries', { tenancyId: tenancy.id, date: '2026-02-10', kind: 'applied', purpose: 'rent', amountCents: 95000 })
    const changed = await s.api<DepositEntry>(`/api/deposit-entries/${entry.id}`, { method: 'PUT', body: JSON.stringify({ amountCents: 50000, date: '2026-02-12' }) })
    assert.equal(changed.paymentId, entry.paymentId)
    const p = (await paymentsOf(s)).find((x) => x.id === entry.paymentId) ?? assert.fail('Zahlung fehlt')
    assert.deepEqual([p.amountCents, p.date, p.kind], [50000, '2026-02-12', 'rent'])
    // Zweck Abrechnung: dieselbe Zahlung wird zur Abrechnungszahlung.
    await s.api(`/api/deposit-entries/${entry.id}`, { method: 'PUT', body: JSON.stringify({ purpose: 'settlement' }) })
    assert.equal((await paymentsOf(s)).find((x) => x.id === entry.paymentId)?.kind, 'settlement')
    // Zweck Schaden: Die Zahlung fällt weg, die Buchung bleibt.
    const damage = await s.api<DepositEntry>(`/api/deposit-entries/${entry.id}`, { method: 'PUT', body: JSON.stringify({ purpose: 'damage' }) })
    assert.equal(damage.paymentId, undefined)
    assert.equal((await paymentsOf(s)).length, 11)
    // Zurück auf Mietrückstand: eine neue Zahlung.
    const again = await s.api<DepositEntry>(`/api/deposit-entries/${entry.id}`, { method: 'PUT', body: JSON.stringify({ purpose: 'rent' }) })
    assert.ok(again.paymentId)
    assert.equal((await paymentsOf(s)).find((x) => x.id === again.paymentId)?.amountCents, 50000)
  } finally {
    s.stop()
  }
})

test('Rücksprung über eine Verrechnung nimmt Buchung und Zahlung gemeinsam', async () => {
  const s = await startServer()
  try {
    const { tenancy } = await withArrears(s)
    const entry = await post<DepositEntry>(s, '/api/deposit-entries', { tenancyId: tenancy.id, date: '2026-02-10', kind: 'applied', purpose: 'rent', amountCents: 95000 })
    const top = await newest(s)
    assert.match(top.title, /^Kautionsbuchung angelegt/)
    await revert(s, top.id)
    assert.deepEqual((await entries(s)).map((e) => e.kind), ['received'])
    assert.equal((await paymentsOf(s)).some((p) => p.id === entry.paymentId), false)
    await revert(s, (await newest(s)).id)
    assert.equal((await entries(s)).find((e) => e.id === entry.id)?.paymentId, entry.paymentId)
    assert.equal((await paymentsOf(s)).some((p) => p.id === entry.paymentId), true)
  } finally {
    s.stop()
  }
})

test('eine Verrechnung mit Miete braucht Geld in der Kaution wie jede andere', async () => {
  const s = await startServer()
  try {
    const { tenancy } = await stock(s)
    const res = await send(s, 'POST', '/api/deposit-entries', { tenancyId: tenancy.id, date: '2026-02-10', kind: 'applied', purpose: 'rent', amountCents: 95000 })
    assert.equal(res.status, 400)
    assert.deepEqual(await paymentsOf(s), [])
  } finally {
    s.stop()
  }
})

// ---------- Teil 2: als Miete gebuchte Kaution umbuchen ----------

test('Umbuchen macht aus der Mietzahlung einen Kautionseingang', async () => {
  const s = await startServer()
  try {
    const { tenancy } = await stock(s)
    // Die Kaution kam als Zahlung über 2.400 € am Einzug; daneben die Januarmiete.
    const deposit = await post<PaymentListItem>(s, '/api/payments', { tenancyId: tenancy.id, date: '2025-01-02', amountCents: 240000, note: 'Kaution Erika' })
    await post(s, '/api/payments', { tenancyId: tenancy.id, date: '2025-01-03', amountCents: 95000 })
    const before = await s.api<TaxReport>('/api/taxreport/2025')
    assert.deepEqual(before.income.received?.possibleDeposits.map((d) => d.paymentId), [deposit.id])
    const res = await send(s, 'POST', `/api/deposit-entries/from-payment/${deposit.id}`)
    assert.equal(res.status, 201)
    const entry = await res.json() as DepositEntry
    assert.deepEqual({ ...entry, id: '' }, { id: '', tenancyId: tenancy.id, date: '2025-01-02', kind: 'received', amountCents: 240000, note: 'Kaution Erika' })
    assert.deepEqual((await paymentsOf(s)).map((p) => p.amountCents), [95000])
    const after = await s.api<TaxReport>('/api/taxreport/2025')
    assert.equal(before.income.paidCents - after.income.paidCents, 240000)
    assert.deepEqual(after.income.received?.possibleDeposits, [])
    assert.match((await newest(s)).title, /^Mietzahlung als Kaution umgebucht/)
    // Ein Rücksprung bringt die Zahlung zurück und nimmt die Buchung weg.
    await revert(s, (await newest(s)).id)
    assert.deepEqual(await entries(s), [])
    assert.equal((await paymentsOf(s)).length, 2)
  } finally {
    s.stop()
  }
})

test('Umbuchen geht nur mit einem Mieteingang', async () => {
  const s = await startServer()
  try {
    const { tenancy } = await withArrears(s)
    const settlement = await post<PaymentListItem>(s, '/api/payments', { tenancyId: tenancy.id, date: '2025-06-01', amountCents: 18000, kind: 'settlement' })
    const negative = await post<PaymentListItem>(s, '/api/payments', { tenancyId: tenancy.id, date: '2025-06-02', amountCents: -95000 })
    const applied = await post<DepositEntry>(s, '/api/deposit-entries', { tenancyId: tenancy.id, date: '2026-02-10', kind: 'applied', purpose: 'rent', amountCents: 95000 })
    for (const id of [settlement.id, negative.id, applied.paymentId ?? '']) {
      const res = await send(s, 'POST', `/api/deposit-entries/from-payment/${id}`)
      assert.equal(res.status, 400, id)
      assert.equal(await errorFrom(res), 'Umbuchen lässt sich nur ein Mieteingang.')
    }
    const unknown = await send(s, 'POST', '/api/deposit-entries/from-payment/gibt-es-nicht')
    assert.equal(unknown.status, 404)
  } finally {
    s.stop()
  }
})

// ---------- Teil 2: Einbehalt und Auskunft für die Aufstellung zum Auszug ----------

test('Einbehalt am Mietverhältnis: Betrag nur mit Grund, größer 0, Grund begrenzt', async () => {
  const s = await startServer()
  try {
    const { tenancy } = await stock(s)
    const url = `/api/tenancies/${tenancy.id}`
    const saved = await s.api<Tenancy>(url, { method: 'PUT', body: JSON.stringify({ depositHoldCents: 30000, depositHoldNote: '  Nebenkosten 2025  ' }) })
    assert.deepEqual([saved.depositHoldCents, saved.depositHoldNote], [30000, 'Nebenkosten 2025'])
    const noReason = await send(s, 'PUT', url, { depositHoldCents: 30000, depositHoldNote: '' })
    assert.equal(noReason.status, 400)
    assert.equal(await errorFrom(noReason), 'Bitte nennen Sie den Grund für den Einbehalt.')
    for (const depositHoldCents of [0, -1, 12.5]) assert.equal((await send(s, 'PUT', url, { depositHoldCents })).status, 400, String(depositHoldCents))
    assert.equal((await send(s, 'PUT', url, { depositHoldNote: 'x'.repeat(201) })).status, 400)
    // Leeren: beide null.
    const cleared = await s.api<Tenancy>(url, { method: 'PUT', body: JSON.stringify({ depositHoldCents: null, depositHoldNote: null }) })
    assert.deepEqual([cleared.depositHoldCents, cleared.depositHoldNote], [undefined, undefined])
    // Ein Grund ohne Betrag ist erlaubt (etwa „Schlüssel fehlt noch“).
    assert.equal((await send(s, 'PUT', url, { depositHoldNote: 'Schlüssel fehlt noch' })).status, 200)
  } finally {
    s.stop()
  }
})

test('Auskunft zur Aufstellung: letzte abgeschlossene Abrechnung des Mieters und ausstehende Zeiträume', async () => {
  await withEnv({ NKA_TEST_TODAY: '2026-01-15' }, async (s) => {
    const { tenancy } = await stock(s)
    await s.api(`/api/tenancies/${tenancy.id}`, { method: 'PUT', body: JSON.stringify({ end: '2025-06-30' }) })
    await post(s, '/api/costItems', { period: '2024-01', category: 'Grundsteuer', description: 'Grundsteuer 2024', amountCents: 60000, key: 'area' })
    const before = await s.api<DepositStatementInfo[]>('/api/deposit-entries/statements')
    // Ohne Abschluss: keine letzte Abrechnung; 2025 steht aus. 2024 liegt vor dem Einzug (2025-01-01) und zählt nicht.
    assert.deepEqual(before, [{ tenancyId: tenancy.id, last: null, pending: ['2025'] }])
    await post(s, '/api/costItems', { period: '2025-01', category: 'Grundsteuer', description: 'Grundsteuer 2025', amountCents: 60000, key: 'area' })
    assert.equal((await send(s, 'POST', '/api/settlement/2025-01/close', {})).status, 201)
    const [after] = await s.api<DepositStatementInfo[]>('/api/deposit-entries/statements')
    assert.equal(after?.last?.label, '2025')
    assert.equal(typeof after?.last?.balanceCents, 'number')
    assert.deepEqual(after?.pending, [])
  })
})

// Durchsicht W1: Ein langes Mietverhältnis, erst seit Kurzem mit Mietfuchs abgerechnet. „Steht noch aus“ nennt nur
// Zeiträume, deren Abrechnungsfrist (§ 556 Abs. 3 Satz 2 BGB) noch läuft; für ältere ist eine Nachforderung ausgeschlossen.
test('Auskunft zur Aufstellung: ausstehend nur, solange die Abrechnungsfrist läuft', async () => {
  await withEnv({ NKA_TEST_TODAY: '2026-01-15' }, async (s) => {
    const { tenancy } = await stock(s)
    await s.api(`/api/tenancies/${tenancy.id}`, { method: 'PUT', body: JSON.stringify({ start: '2015-01-01', end: '2025-06-30', baseRents: [{ from: '2015-01', monthlyCents: 80000 }], prepayments: [{ from: '2015-01', monthlyCents: 15000 }] }) })
    const [info] = await s.api<DepositStatementInfo[]>('/api/deposit-entries/statements')
    // 2024 endet am 31.12.2024, Frist bis 31.12.2025: vorbei. 2025 läuft bis 31.12.2026.
    assert.deepEqual(info?.pending, ['2025'])
  })
})

test('Umbuchen mit langer Notiz kürzt sie auf die Länge einer Kautionsbuchung', async () => {
  const s = await startServer()
  try {
    const { tenancy } = await stock(s)
    const p = await post<PaymentListItem>(s, '/api/payments', { tenancyId: tenancy.id, date: '2025-01-02', amountCents: 240000, note: 'K'.repeat(600) })
    const res = await send(s, 'POST', `/api/deposit-entries/from-payment/${p.id}`)
    assert.equal(res.status, 201, await res.clone().text())
    assert.equal((await res.json() as DepositEntry).note?.length, 500)
  } finally {
    s.stop()
  }
})

// Abschlussdurchsicht W1: Bei Pauschale oder Inklusivmiete für Kaltes und Heizung ist keine Abrechnung geschuldet; auf dem
// Blatt für den Mieter läse sich „steht noch aus“ wie eine offene Forderung.
test('Auskunft zur Aufstellung: nichts steht aus, wenn der Mieter keine Abrechnung bekommt', async () => {
  await withEnv({ NKA_TEST_TODAY: '2026-01-15' }, async (s) => {
    const unit = await post<Unit>(s, '/api/units', { name: 'EG', areaM2: 80, participates: true })
    const base = { unitId: unit.id, persons: 1, prepayments: [], prepaymentOverrides: {}, baseRents: [{ from: '2024-01', monthlyCents: 80000 }] }
    const flat = await post<Tenancy>(s, '/api/tenancies', { ...base, tenantName: 'Pauschal', start: '2024-01-01', end: '2025-06-30', costModel: 'flatRate', heatingModel: 'flatRate', flatRates: [{ from: '2024-01', monthlyCents: 15000 }] })
    const warm = await post<Tenancy>(s, '/api/tenancies', { ...base, tenantName: 'Warm', start: '2025-07-01', end: '2025-12-31', costModel: 'inclusive', heatingModel: 'inclusive', baseRents: [{ from: '2025-07', monthlyCents: 95000 }] })
    const mixed = await post<Tenancy>(s, '/api/tenancies', { ...base, tenantName: 'Gemischt', unitId: (await post<Unit>(s, '/api/units', { name: 'OG', areaM2: 60, participates: true })).id, start: '2025-01-01', end: '2025-12-31', costModel: 'flatRate', flatRates: [{ from: '2025-01', monthlyCents: 5000 }], prepayments: [{ from: '2025-01', monthlyCents: 9000 }] })
    const info = await s.api<DepositStatementInfo[]>('/api/deposit-entries/statements')
    const of = (id: string) => info.find((i) => i.tenancyId === id)?.pending
    assert.deepEqual(of(flat.id), [])
    assert.deepEqual(of(warm.id), [])
    // Kaltes pauschal, Heizung abgerechnet: Die Heizkosten werden abgerechnet, also steht 2025 aus.
    assert.deepEqual(of(mixed.id), ['2025'])
  })
})

// Kautionsbuchungen über die Routen (#228, Teil 1): anlegen, ändern, löschen; die Prüfungen vor dem Schreiben; der
// Stand fällt an keinem Tag unter null; Buchungen folgen ihrem Mietverhältnis; Verlauf und Rücksprung; Mietkonto und
// Steuer bleiben unberührt.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { DepositEntry, RentLedger, TaxReport, Tenancy, Unit } from '../../shared/types.ts'
import { errorFrom, startServer, type Server } from '../testing/api.ts'
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
    await refused({ kind: 'applied', purpose: 'rent' }, 400, /^Zweck der Verrechnung ist Schaden oder Sonstiges\.$/)
    await refused({ kind: 'applied', purpose: 'settlement' }, 400, /^Zweck der Verrechnung ist Schaden oder Sonstiges\.$/)
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
    assert.equal(await errorFrom(early), 'Mehr als die Kaution hergibt: Am 01.02.2025 lägen -1.000,00 € bei Ihnen.')

    const refunded = await post<DepositEntry>(s, '/api/deposit-entries', { tenancyId: tenancy.id, date: '2025-06-01', kind: 'refunded', amountCents: 100000 })
    // Den Eingang löschen oder kürzen, nachdem zurückgezahlt ist.
    const remove = await send(s, 'DELETE', `/api/deposit-entries/${received.id}`)
    assert.equal(remove.status, 400)
    assert.equal(await errorFrom(remove), 'Mehr als die Kaution hergibt: Am 01.06.2025 lägen -1.000,00 € bei Ihnen.')
    const cut = await send(s, 'PUT', `/api/deposit-entries/${received.id}`, { amountCents: 50000 })
    assert.equal(cut.status, 400)
    assert.equal(await errorFrom(cut), 'Mehr als die Kaution hergibt: Am 01.06.2025 lägen -500,00 € bei Ihnen.')
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

    assert.equal((await send(s, 'DELETE', `/api/tenancies/${tenancy.id}`)).status, 200)
    assert.deepEqual(await entries(s, '?property=objekt-1'), [])
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

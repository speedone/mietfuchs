// Kontoumsätze zuordnen und buchen (#188, Teil 2) über die Routen: Vorschlag, Buchen mit Marke, Lösen, Mietkonto und
// Steuer wie bei Handeingabe, Wächter an verknüpften Zahlungen, Verlauf und Rücksprung. Auszüge erfunden
// (fixtures/camt/kontoauszug-juni.xml, -juli.xml).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import type { DepositEntry, Payment, RentLedger, TaxReport, Tenancy, Unit } from '../../shared/types.ts'
import { errorFrom, startServer, type Server } from '../testing/api.ts'
import { journalOf, newest, revert } from '../testing/revert.ts'

const OWN = 'DE89370400440532013000'
const TENANT = 'DE02120300000000202051'
const fixture = (name: string) => fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'camt', name))

type Target = { type: 'newPayment'; kind: 'rent' | 'settlement' } | { type: 'existingPayment'; paymentId: string } | { type: 'deposit'; kind: 'received' | 'refunded' }
type Suggestion = { tenancyId: string; target: Target; light: 'green' | 'yellow'; reason: string }
type TxView = { id: string; bookingDate: string; amountCents: number; purpose: string; openCents: number; suggestion: Suggestion | null; links: { id: string; paymentId: string | null; depositEntryId: string | null; created: boolean }[] }
type LinkPreview = { problems: { transactionId: string; message: string }[]; sentence: string; token: string }

async function withServer(work: (s: Server) => Promise<void>): Promise<void> {
  const s = await startServer()
  try {
    await work(s)
  } finally {
    s.child.kill()
    await new Promise((resolve) => s.child.once('exit', resolve))
    fs.rmSync(s.dataDir, { recursive: true, force: true })
  }
}

const json = (s: Server, method: string, url: string, body?: unknown) =>
  fetch(`${s.base}${url}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

async function tenancy(s: Server, name = 'EG', iban: string | null = TENANT, over: Record<string, unknown> = {}): Promise<Tenancy> {
  const unit = await s.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name, areaM2: 80, participates: true }) })
  return s.api<Tenancy>('/api/tenancies', {
    method: 'POST',
    body: JSON.stringify({ unitId: unit.id, tenantName: `Mieter ${name}`, persons: 1, start: '2025-01-01', end: null, ...(iban ? { iban } : {}),
      prepayments: [{ from: '2025-01', monthlyCents: 15000 }], prepaymentOverrides: {}, baseRents: [{ from: '2025-01', monthlyCents: 70000 }], ...over }),
  })
}

async function importFile(s: Server, file: Buffer, name: string): Promise<void> {
  const form = (fields: Record<string, string>) => {
    const fd = new FormData()
    fd.append('statement', new Blob([file]), name)
    for (const [k, v] of Object.entries(fields)) fd.append(k, v)
    return fd
  }
  const decisions = JSON.stringify([{ type: 'account', iban: OWN, accept: true }])
  const preview = await (await fetch(`${s.base}/api/bank/import/plan`, { method: 'POST', body: form({ decisions }) })).json() as { token: string; ready: boolean }
  assert.equal(preview.ready, true)
  const res = await fetch(`${s.base}/api/bank/import`, { method: 'POST', body: form({ decisions, token: preview.token }) })
  assert.equal(res.status, 200, await res.clone().text())
}
const importJune = (s: Server) => importFile(s, fixture('kontoauszug-juni.xml'), 'juni.xml')

const transactions = (s: Server, state: 'open' | 'done' = 'open') => s.api<TxView[]>(`/api/bank/transactions?state=${state}`)

// Je Umsatz der Vorschlag als Entscheidung, wie „alle grünen übernehmen“.
const asSuggested = (txs: readonly TxView[]) => txs.map((t) => {
  const sg = t.suggestion ?? assert.fail(`kein Vorschlag für ${t.purpose}`)
  return { transactionId: t.id, parts: [{ tenancyId: sg.tenancyId, amountCents: t.openCents, target: sg.target }] }
})

async function planLinks(s: Server, decisions: unknown): Promise<LinkPreview> {
  const res = await json(s, 'POST', '/api/bank/links/plan', { decisions })
  assert.equal(res.status, 200, await res.clone().text())
  return res.json() as Promise<LinkPreview>
}
const bookRaw = (s: Server, decisions: unknown, token: string) => json(s, 'POST', '/api/bank/links', { decisions, token })
async function book(s: Server, decisions: unknown): Promise<{ ok: boolean; sentence: string }> {
  const res = await bookRaw(s, decisions, (await planLinks(s, decisions)).token)
  assert.equal(res.status, 200, await res.clone().text())
  return res.json() as Promise<{ ok: boolean; sentence: string }>
}

const payments = (s: Server) => s.api<(Payment & { fromBank?: true })[]>('/api/payments')
const withoutIds = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (k, x: unknown) => (k === 'id' || k === 'tenancyId' || k === 'paymentId' || k.endsWith('Id') ? undefined : x)))

test('Zuordnen: Vorschlag grün, gebucht wie von Hand erfasst; Mietkonto und Steuer gleich', async () => {
  let ledgerA: RentLedger | null = null
  let taxA: TaxReport | null = null
  await withServer(async (s) => {
    await tenancy(s)
    await importJune(s)
    const open = await transactions(s)
    assert.deepEqual(open.map((t) => [t.bookingDate, t.openCents, t.suggestion?.light]), [['2025-06-02', 85000, 'green'], ['2025-06-03', 85000, 'green']])
    assert.deepEqual(await book(s, asSuggested(open)), { ok: true, sentence: '2 Zahlungen gebucht.' })
    assert.deepEqual(await transactions(s), [])
    assert.equal((await transactions(s, 'done')).length, 2)
    const list = await payments(s)
    assert.deepEqual(list.map((p) => [p.date, p.amountCents, p.note, p.designatedMonth, p.fromBank]), [['2025-06-02', 85000, 'Miete Juni Whg EG', undefined, true], ['2025-06-03', 85000, 'Nachzahlung Miete Juni', undefined, true]])
    assert.equal((await newest(s)).description, '2 Umsätze aus dem Kontoauszug gebucht')
    ledgerA = await s.api<RentLedger>('/api/rentledger/2025')
    taxA = await s.api<TaxReport>('/api/taxreport/2025')
  })
  await withServer(async (s) => {
    const t = await tenancy(s)
    for (const [date, note] of [['2025-06-02', 'Miete Juni Whg EG'], ['2025-06-03', 'Nachzahlung Miete Juni']]) {
      await s.api('/api/payments', { method: 'POST', body: JSON.stringify({ tenancyId: t.id, date, amountCents: 85000, note }) })
    }
    assert.deepStrictEqual(withoutIds(await s.api<RentLedger>('/api/rentledger/2025')), withoutIds(ledgerA))
    assert.deepStrictEqual(withoutIds(await s.api<TaxReport>('/api/taxreport/2025')), withoutIds(taxA))
  })
})

test('Zuordnen: eine schon erfasste Zahlung wird verknüpft, nicht doppelt gebucht', () => withServer(async (s) => {
  const t = await tenancy(s)
  const hand = await s.api<Payment>('/api/payments', { method: 'POST', body: JSON.stringify({ tenancyId: t.id, date: '2025-06-01', amountCents: 85000 }) })
  await importJune(s)
  const [first] = await transactions(s)
  assert.deepEqual(first?.suggestion?.target, { type: 'existingPayment', paymentId: hand.id })
  assert.equal((await book(s, asSuggested(first ? [first] : []))).sentence, '1 Umsatz mit erfasster Zahlung verknüpft.')
  assert.equal((await payments(s)).length, 1)
  assert.equal((await transactions(s)).length, 1)
}))

test('Zuordnen: Rücklastschrift ist eine negative Mietzahlung; das Mietkonto ist um sie wieder offen', () => withServer(async (s) => {
  await tenancy(s)
  await importJune(s)
  await book(s, asSuggested(await transactions(s)))
  const before = await s.api<RentLedger>('/api/rentledger/2025')
  await importFile(s, fixture('kontoauszug-juli.xml'), 'juli.xml')
  const [reversal] = await transactions(s)
  assert.equal(reversal?.amountCents, -85000)
  assert.deepEqual(reversal?.suggestion?.target, { type: 'newPayment', kind: 'rent' })
  await book(s, asSuggested(reversal ? [reversal] : []))
  const after = await s.api<RentLedger>('/api/rentledger/2025')
  assert.equal(after.rows[0]?.closingBalanceCents, (before.rows[0]?.closingBalanceCents ?? 0) - 85000)
}))

test('Zuordnen: eine Kaution wird Kautionsbuchung, keine Zahlung', () => withServer(async (s) => {
  const t = await tenancy(s)
  await importJune(s)
  const [first] = await transactions(s)
  assert.ok(first)
  await book(s, [{ transactionId: first.id, parts: [{ tenancyId: t.id, amountCents: 85000, target: { type: 'deposit', kind: 'received' } }] }])
  assert.deepEqual(await payments(s), [])
  const entries = await s.api<DepositEntry[]>('/api/deposit-entries')
  assert.deepEqual(entries.map((e) => [e.kind, e.amountCents, e.date]), [['received', 85000, '2025-06-02']])
}))

test('Zuordnen: aufteilen auf zwei Wohnungen; ein Cent zu viel ist 400', () => withServer(async (s) => {
  const a = await tenancy(s)
  const b = await tenancy(s, 'OG', null)
  await importJune(s)
  const [first] = await transactions(s)
  assert.ok(first)
  const split = (cents: number) => [{ transactionId: first.id, parts: [
    { tenancyId: a.id, amountCents: 50000, target: { type: 'newPayment', kind: 'rent' } },
    { tenancyId: b.id, amountCents: cents, target: { type: 'newPayment', kind: 'rent' } },
  ] }]
  const tooMuch = await planLinks(s, split(35001))
  assert.deepEqual(tooMuch.problems.map((p) => p.message), ['Die Teile ergeben mehr als den Umsatz (850,01 € statt 850,00 €).'])
  const refused = await bookRaw(s, split(35001), tooMuch.token)
  assert.equal(refused.status, 400)
  assert.equal(await errorFrom(refused), 'Die Teile ergeben mehr als den Umsatz (850,01 € statt 850,00 €).')
  await book(s, split(35000))
  assert.deepEqual((await payments(s)).map((p) => [p.tenancyId, p.amountCents]).sort(), [[a.id, 50000], [b.id, 35000]].sort())
}))

test('Zuordnen: veraltete Marke ergibt 409, nichts wird gebucht', () => withServer(async (s) => {
  await tenancy(s)
  await importJune(s)
  const decisions = asSuggested(await transactions(s))
  const stale = await planLinks(s, decisions)
  await book(s, decisions)
  const res = await bookRaw(s, decisions, stale.token)
  assert.equal(res.status, 409)
  assert.equal((await payments(s)).length, 2)
}))

test('Zuordnen: Lösen behält die Zahlung oder löscht sie; eine selbst erfasste wird nicht gelöscht', () => withServer(async (s) => {
  const t = await tenancy(s)
  const hand = await s.api<Payment>('/api/payments', { method: 'POST', body: JSON.stringify({ tenancyId: t.id, date: '2025-06-01', amountCents: 85000 }) })
  await importJune(s)
  await book(s, asSuggested(await transactions(s)))
  const done = await transactions(s, 'done')
  const linkOf = (paymentId: string) => done.flatMap((d) => d.links).find((l) => l.paymentId === paymentId) ?? assert.fail('kein Link')
  const own = linkOf(hand.id)
  const refused = await json(s, 'DELETE', `/api/bank/links/${own.id}?payment=delete`)
  assert.equal(refused.status, 400)
  assert.equal(await errorFrom(refused), 'Diese Zahlung haben Sie selbst erfasst. Löschen Sie sie bitte im Mietkonto.')
  assert.equal((await json(s, 'DELETE', `/api/bank/links/${own.id}`)).status, 200)
  assert.equal((await newest(s)).description, 'Zuordnung gelöst')
  assert.equal((await payments(s)).length, 2, 'mit keep bleibt die Zahlung')
  const created = done.flatMap((d) => d.links).find((l) => l.paymentId !== hand.id) ?? assert.fail('kein Link')
  assert.equal((await json(s, 'DELETE', `/api/bank/links/${created.id}?payment=delete`)).status, 200)
  assert.deepEqual((await payments(s)).map((p) => p.id), [hand.id])
  assert.equal((await transactions(s)).length, 2, 'beide Umsätze wieder offen')
  assert.equal((await json(s, 'DELETE', `/api/bank/links/${created.id}`)).status, 404)
}))

test('Zuordnen: eine im Mietkonto gelöschte Zahlung öffnet den Umsatz mit seinem Vorschlag', () => withServer(async (s) => {
  await tenancy(s)
  await importJune(s)
  await book(s, asSuggested(await transactions(s)))
  const [p] = await payments(s)
  assert.equal((await json(s, 'DELETE', `/api/payments/${p?.id}`)).status, 200)
  const open = await transactions(s)
  assert.equal(open.length, 1)
  assert.equal(open[0]?.suggestion?.light, 'green')
}))

test('Zuordnen: eine verknüpfte Zahlung lässt sich senken, nicht über den Umsatz heben und nicht umhängen', () => withServer(async (s) => {
  await tenancy(s)
  const other = await tenancy(s, 'OG', null)
  await importJune(s)
  await book(s, asSuggested(await transactions(s)))
  const [p] = await payments(s)
  assert.ok(p)
  const lowered = await json(s, 'PUT', `/api/payments/${p.id}`, { ...p, amountCents: 70000 })
  assert.equal(lowered.status, 200, await lowered.clone().text())
  assert.deepEqual((await transactions(s)).map((t) => t.openCents), [15000])
  const raised = await json(s, 'PUT', `/api/payments/${p.id}`, { ...p, amountCents: 90000 })
  assert.equal(raised.status, 409)
  assert.equal(await errorFrom(raised), 'Diese Zahlung ist einem Kontoumsatz über 850,00 € zugeordnet. Lösen Sie zuerst die Zuordnung auf der Seite Kontoauszug.')
  const moved = await json(s, 'PUT', `/api/payments/${p.id}`, { ...p, amountCents: 70000, tenancyId: other.id })
  assert.equal(moved.status, 409)
  assert.equal((await payments(s)).find((x) => x.id === p.id)?.amountCents, 70000)
}))

test('Zuordnen: beiseitelegen und zurückholen', () => withServer(async (s) => {
  await tenancy(s)
  await importJune(s)
  const [first] = await transactions(s)
  assert.ok(first)
  assert.equal((await book(s, [{ transactionId: first.id, setAside: 'other' }])).sentence, '1 beiseitegelegt.')
  assert.equal((await transactions(s)).length, 1)
  const back = await json(s, 'PUT', `/api/bank/transactions/${first.id}`, { setAside: null })
  assert.equal(back.status, 200)
  assert.equal((await newest(s)).description, 'Umsatz zurückgeholt')
  assert.equal((await transactions(s)).length, 2)
}))

test('Zuordnen: ein Eintrag im Verlauf je Buchungslauf; der Rücksprung nimmt Zahlungen, Kautionsbuchungen und Links gemeinsam zurück', () => withServer(async (s) => {
  const t = await tenancy(s)
  await importJune(s)
  const [a, b] = await transactions(s)
  assert.ok(a && b)
  const groups = (await journalOf(s)).length
  await book(s, [
    { transactionId: a.id, parts: [{ tenancyId: t.id, amountCents: 85000, target: { type: 'newPayment', kind: 'rent' } }] },
    { transactionId: b.id, parts: [{ tenancyId: t.id, amountCents: 85000, target: { type: 'deposit', kind: 'received' } }] },
  ])
  assert.equal((await journalOf(s)).length, groups + 1)
  await revert(s, (await newest(s)).id)
  assert.deepEqual(await payments(s), [])
  assert.deepEqual(await s.api<DepositEntry[]>('/api/deposit-entries'), [])
  assert.equal((await transactions(s)).length, 2)
}))

// ---------- Befunde der Durchsicht (Teil 2) ----------

test('Durchsicht C1: eine Verrechnung aus der Kaution ist keine erfasste Zahlung für den Umsatz', () => withServer(async (s) => {
  const t = await tenancy(s)
  await s.api('/api/deposit-entries', { method: 'POST', body: JSON.stringify({ tenancyId: t.id, date: '2025-01-05', kind: 'received', amountCents: 170000 }) })
  await s.api('/api/deposit-entries', { method: 'POST', body: JSON.stringify({ tenancyId: t.id, date: '2025-06-01', kind: 'applied', purpose: 'rent', amountCents: 85000 }) })
  const bound = (await payments(s))[0] ?? assert.fail('keine gebundene Zahlung')
  await importJune(s)
  const open = await transactions(s)
  assert.ok(open.every((t) => t.suggestion?.target.type !== 'existingPayment'), JSON.stringify(open.map((o) => o.suggestion)))
  const first = open[0] ?? assert.fail('kein Umsatz')
  const p = await planLinks(s, [{ transactionId: first.id, parts: [{ tenancyId: t.id, amountCents: 85000, target: { type: 'existingPayment', paymentId: bound.id } }] }])
  assert.equal(p.problems.length, 1)
}))

test('Durchsicht C2: „Ist das die Kaution?“ hängt die Zuordnung auf die neue Kautionsbuchung um', () => withServer(async (s) => {
  await tenancy(s)
  await importJune(s)
  const [first] = await transactions(s)
  assert.ok(first)
  await book(s, asSuggested([first]))
  const [p] = await payments(s)
  assert.equal((await json(s, 'POST', `/api/deposit-entries/from-payment/${p?.id}`)).status, 201)
  const open = await transactions(s)
  assert.ok(!open.some((o) => o.id === first.id), 'der Umsatz bleibt erledigt')
  const done = (await transactions(s, 'done')).find((d) => d.id === first.id)
  assert.equal(done?.links.length, 1)
  assert.ok(done?.links[0]?.depositEntryId)
  assert.equal(done?.links[0]?.created, true)
}))

test('Durchsicht I1: eine verknüpfte Kautionsbuchung wechselt ihre Art nicht', () => withServer(async (s) => {
  const t = await tenancy(s)
  await s.api('/api/deposit-entries', { method: 'POST', body: JSON.stringify({ tenancyId: t.id, date: '2025-01-05', kind: 'received', amountCents: 240000 }) })
  await importJune(s)
  await importFile(s, fixture('kontoauszug-juli.xml'), 'juli.xml')
  const open = await transactions(s)
  const inflow = open.find((o) => o.amountCents > 0) ?? assert.fail('kein Eingang')
  const outflow = open.find((o) => o.amountCents < 0) ?? assert.fail('kein Ausgang')
  await book(s, [
    { transactionId: inflow.id, parts: [{ tenancyId: t.id, amountCents: 85000, target: { type: 'deposit', kind: 'received' } }] },
    { transactionId: outflow.id, parts: [{ tenancyId: t.id, amountCents: -85000, target: { type: 'deposit', kind: 'refunded' } }] },
  ])
  const entries = await s.api<DepositEntry[]>('/api/deposit-entries')
  const refunded = entries.find((e) => e.kind === 'refunded') ?? assert.fail('keine Rückzahlung')
  const res = await json(s, 'PUT', `/api/deposit-entries/${refunded.id}`, { kind: 'applied', purpose: 'rent' })
  assert.equal(res.status, 409)
  assert.match(await errorFrom(res), /einem Kontoumsatz über 850,00 € zugeordnet/)
  assert.deepEqual(await payments(s), [], 'keine gebundene Zahlung entstanden')
  const received = entries.find((e) => e.kind === 'received' && e.date === inflow.bookingDate) ?? assert.fail('kein Eingang')
  assert.equal((await json(s, 'PUT', `/api/deposit-entries/${received.id}`, { kind: 'interest' })).status, 200, 'Eingang und Ertrag sind beide Zufluss')
}))

test('Seite: GET /api/bank/tenancies nennt alle Mietverhältnisse mit Wohnung und Objekt', () => withServer(async (s) => {
  const t = await tenancy(s)
  const list = await s.api<{ id: string; label: string }[]>('/api/bank/tenancies')
  assert.equal(list.length, 1)
  assert.equal(list[0]?.id, t.id)
  assert.equal(list[0]?.label, 'Mieter EG, EG')
}))

test('Cockpit: GET /api/bank/open-count zählt die offenen Umsätze', () => withServer(async (s) => {
  assert.deepEqual(await s.api('/api/bank/open-count'), { count: 0 })
  await tenancy(s)
  await importJune(s)
  assert.deepEqual(await s.api('/api/bank/open-count'), { count: 2 })
}))

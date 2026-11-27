// Kontoumsätze zuordnen und buchen (#188, Teil 2) über die Routen: Vorschlag, Buchen mit Marke, Lösen, Mietkonto und
// Steuer wie bei Handeingabe, Wächter an verknüpften Zahlungen, Verlauf und Rücksprung. Auszüge erfunden
// (fixtures/camt/kontoauszug-juni.xml, -juli.xml).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import type { DepositEntry, Payment, RentLedger, TaxReport, Tenancy, Unit } from '../../shared/types.ts'
import { errorFrom, startServer, withEnv, type Server } from '../testing/api.ts'
import { journalOf, newest, revert } from '../testing/revert.ts'

const OWN = 'DE89370400440532013000'
const TENANT = 'DE02120300000000202051'
const fixture = (name: string) => fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'camt', name))

type Target = { type: 'newPayment'; kind: 'rent' | 'settlement'; designatedMonth?: string } | { type: 'existingPayment'; paymentId: string } | { type: 'deposit'; kind: 'received' | 'refunded' }
type Suggestion = { tenancyId: string; target: Target; light: 'green' | 'yellow'; reason: string; parts?: { amountCents: number; target: Target }[] }
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

// #693: „Miete Juni Whg EG“ nennt den Monat. Er ändert hier nichts an der Tilgung (die erste Zahlung des Objekts, nichts
// davor offen), deshalb bleibt der Vorschlag grün und ohne Monat.
test('Zuordnen: Vorschlag grün, gebucht wie von Hand erfasst; Mietkonto und Steuer gleich', async () => {
  let ledgerA: RentLedger | null = null
  let taxA: TaxReport | null = null
  await withServer(async (s) => {
    await tenancy(s)
    await importJune(s)
    const open = await transactions(s)
    assert.deepEqual(open.map((t) => [t.bookingDate, t.openCents, t.suggestion?.light]), [['2025-06-02', 85000, 'green'], ['2025-06-03', 85000, 'green']])
    assert.deepEqual(open.map((t) => t.suggestion?.target), [{ type: 'newPayment', kind: 'rent' }, { type: 'newPayment', kind: 'rent' }])
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
  assert.deepEqual([open[0]?.purpose, open[0]?.suggestion?.light], ['Miete Juni Whg EG', 'green'])
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


// ---------- #308: Nachzahlung und Guthaben aus der abgeschlossenen Abrechnung am Betrag ----------
// Auszüge im Test gebaut. Der Abschluss trägt die wirkliche Uhrzeit (`closedAt`), der Server rechnet mit NKA_TEST_TODAY;
// deshalb setzt jeder Abschluss ein Versanddatum vor den Umsätzen.
const SECOND = 'DE44500105175407324931'
type Entry = { date: string; cents: number; purpose?: string; iban?: string }
const camtOf = (entries: readonly Entry[]) => {
  const first = entries[0]?.date ?? '2026-01-01'
  const ntry = entries.map((e, i) => {
    const amount = (Math.abs(e.cents) / 100).toFixed(2)
    const party = e.cents > 0
      ? `<Dbtr><Pty><Nm>Erika Beispiel</Nm></Pty></Dbtr><DbtrAcct><Id><IBAN>${e.iban ?? TENANT}</IBAN></Id></DbtrAcct>`
      : `<Cdtr><Pty><Nm>Erika Beispiel</Nm></Pty></Cdtr><CdtrAcct><Id><IBAN>${e.iban ?? TENANT}</IBAN></Id></CdtrAcct>`
    return `<Ntry><Amt Ccy="EUR">${amount}</Amt><CdtDbtInd>${e.cents > 0 ? 'CRDT' : 'DBIT'}</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts>
      <BookgDt><Dt>${e.date}</Dt></BookgDt><ValDt><Dt>${e.date}</Dt></ValDt><AcctSvcrRef>REF-${e.date}-${i}</AcctSvcrRef>
      <NtryDtls><TxDtls><RltdPties>${party}</RltdPties><RmtInf><Ustrd>${e.purpose ?? 'Ueberweisung'}</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>`
  }).join('\n')
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"><BkToCstmrStmt>
  <GrpHdr><MsgId>MSG-${first}</MsgId><CreDtTm>${first}T18:00:00+01:00</CreDtTm></GrpHdr>
  <Stmt><Id>${first}</Id><CreDtTm>${first}T18:00:00+01:00</CreDtTm><Acct><Id><IBAN>${OWN}</IBAN></Id></Acct>
${ntry}
  </Stmt></BkToCstmrStmt></Document>`)
}
const importEntries = (s: Server, entries: readonly Entry[]) => importFile(s, camtOf(entries), 'auszug.xml')

// Je Monat von `from` bis `to` (je einschließlich) eine Miete von 850 € am Ersten, außer in `skip`.
async function payRent(s: Server, tenancyId: string, from: string, to: string, skip: readonly string[] = []): Promise<Payment[]> {
  const out: Payment[] = []
  for (let m = from; m <= to; m = m.endsWith('-12') ? `${Number(m.slice(0, 4)) + 1}-01` : `${m.slice(0, 5)}${String(Number(m.slice(5)) + 1).padStart(2, '0')}`) {
    if (skip.includes(m)) continue
    out.push(await s.api<Payment>('/api/payments', { method: 'POST', body: JSON.stringify({ tenancyId, date: `${m}-01`, amountCents: 85000 }) }))
  }
  return out
}
// Grundsteuer des Kalenderjahrs anlegen, abschließen und das Versanddatum setzen. Mit 1.800 € Vorauszahlung im Jahr
// ergeben 2.100 € eine Nachzahlung von 300 €, 1.680 € ein Guthaben von 120 €.
async function settle(s: Server, year: number, amountCents: number, sentAt: string): Promise<void> {
  await s.api('/api/costItems', { method: 'POST', body: JSON.stringify({ period: `${year}-01`, category: 'Grundsteuer', description: `Grundsteuer ${year}`, amountCents, key: 'area' }) })
  const closed = await json(s, 'POST', `/api/settlement/${year}-01/close`, {})
  assert.equal(closed.status, 201, await closed.clone().text())
  const sent = await json(s, 'PUT', `/api/settlement/${year}-01/close`, { sentAt })
  assert.equal(sent.status, 200, await sent.clone().text())
}
const suggestions = async (s: Server) => (await transactions(s)).map((t) => [t.bookingDate, t.openCents, t.suggestion?.target, t.suggestion?.parts])
const RENT_TARGET = { type: 'newPayment', kind: 'rent' }
const SETTLEMENT_TARGET = { type: 'newPayment', kind: 'settlement' }

test('#308: Nachzahlung am Betrag nur aus der abgeschlossenen Abrechnung; wieder geöffnet zählt sie nicht', () => withEnv({ NKA_TEST_TODAY: '2026-04-15' }, async (s) => {
  const t = await tenancy(s)
  await payRent(s, t.id, '2025-01', '2026-04')
  await importEntries(s, [{ date: '2026-03-10', cents: 30000 }])
  const suggestion = async () => (await transactions(s))[0]?.suggestion
  await s.api('/api/costItems', { method: 'POST', body: JSON.stringify({ period: '2025-01', category: 'Grundsteuer', description: 'Grundsteuer 2025', amountCents: 210000, key: 'area' }) })
  assert.deepEqual((await suggestion())?.target, RENT_TARGET, 'nur Live-Berechnung')

  assert.equal((await json(s, 'POST', '/api/settlement/2025-01/close', {})).status, 201)
  assert.deepEqual((await suggestion())?.target, RENT_TARGET, 'abgeschlossen erst nach dem Umsatz, ohne Versanddatum (Durchsicht PR #654, 1)')
  assert.equal((await json(s, 'PUT', '/api/settlement/2025-01/close', { sentAt: '2026-02-20' })).status, 200)
  const closed = await suggestion()
  assert.deepEqual([closed?.target, closed?.light, closed?.reason], [SETTLEMENT_TARGET, 'yellow', 'Betrag wie die offene Nachzahlung aus der Abrechnung 2025; das Mietkonto ist sonst ausgeglichen'])

  assert.equal((await json(s, 'DELETE', '/api/settlement/2025-01/close')).status, 200)
  assert.deepEqual((await suggestion())?.target, RENT_TARGET, 'wieder geöffnet')

  assert.equal((await json(s, 'POST', '/api/settlement/2025-01/close', {})).status, 201)
  assert.equal((await json(s, 'PUT', '/api/settlement/2025-01/close', { sentAt: '2026-02-20' })).status, 200)
  await book(s, asSuggested(await transactions(s)))
  assert.deepEqual((await payments(s)).filter((p) => p.kind === 'settlement').map((p) => [p.date, p.amountCents]), [['2026-03-10', 30000]])
}))

// Durchsicht PR #654, 2: Der erste passende Umsatz in Datumsfolge nimmt die Nachzahlung, wie eine erfasste Zahlung.
test('#308 Durchsicht: zwei Umsätze in Höhe derselben Nachzahlung, nur der erste bekommt den Vorschlag', () => withEnv({ NKA_TEST_TODAY: '2026-04-15' }, async (s) => {
  const t = await tenancy(s)
  await payRent(s, t.id, '2025-01', '2026-04')
  await settle(s, 2025, 210000, '2026-02-20')
  await importEntries(s, [{ date: '2026-03-10', cents: 30000 }, { date: '2026-03-12', cents: 30000 }])
  assert.deepEqual((await suggestions(s)).map(([d, , target]) => [d, target]), [['2026-03-10', SETTLEMENT_TARGET], ['2026-03-12', RENT_TARGET]])
}))

// (a) Miete + Nachzahlung in einer Überweisung, der Buchungsmonat schon im Rückstand; gebucht werden beide Teile.
test('#308 Durchsicht: Miete und Nachzahlung in einer Überweisung, Buchungsmonat überfällig', () => withEnv({ NKA_TEST_TODAY: '2026-03-25' }, async (s) => {
  const t = await tenancy(s)
  await payRent(s, t.id, '2025-01', '2026-02')
  await settle(s, 2025, 210000, '2026-02-20')
  await importEntries(s, [{ date: '2026-03-03', cents: 115000 }])
  const [row] = await transactions(s)
  const sg = row?.suggestion ?? assert.fail('kein Vorschlag')
  assert.deepEqual([sg.light, sg.parts], ['yellow', [{ amountCents: 85000, target: RENT_TARGET }, { amountCents: 30000, target: SETTLEMENT_TARGET }]])
  await book(s, [{ transactionId: row.id, parts: (sg.parts ?? []).map((p) => ({ tenancyId: sg.tenancyId, ...p })) }])
  assert.deepEqual((await payments(s)).filter((p) => p.date === '2026-03-03').map((p) => [p.kind, p.amountCents]), [['rent', 85000], ['settlement', 30000]])
  const ledger = await s.api<RentLedger>('/api/rentledger/2026')
  assert.equal(ledger.rows[0]?.months[2]?.status, 'paid', 'März bezahlt')
}))

// (b) Die erteilte Abrechnung rechnet die Vorauszahlung Dezember an, die nie gezahlt wurde: kein Vorschlag.
test('#308 Durchsicht: unbezahlte, angerechnete Vorauszahlung: kein Vorschlag', () => withEnv({ NKA_TEST_TODAY: '2026-04-15' }, async (s) => {
  const t = await tenancy(s)
  await payRent(s, t.id, '2025-01', '2026-04', ['2025-12'])
  await settle(s, 2025, 210000, '2026-02-20')
  await importEntries(s, [{ date: '2026-03-10', cents: 30000 }])
  assert.deepEqual((await suggestions(s))[0]?.[2], RENT_TARGET)
}))

// (c) Umsatz im Vorjahr, heute im Folgejahr: Ob das Mietkonto ausgeglichen ist, sagt die Ansicht des laufenden Jahres.
test('#308 Durchsicht: Buchung im Vorjahr, Rückstand im laufenden Jahr zählt', () => withEnv({ NKA_TEST_TODAY: '2027-02-15' }, async (s) => {
  const t = await tenancy(s)
  const paid = await payRent(s, t.id, '2025-01', '2027-02')
  await settle(s, 2025, 210000, '2026-02-20')
  await importEntries(s, [{ date: '2026-03-10', cents: 30000 }])
  assert.deepEqual((await suggestions(s))[0]?.[2], SETTLEMENT_TARGET, 'alles bezahlt')
  const january = paid.find((p) => p.date === '2027-01-01') ?? assert.fail('keine Januarmiete')
  assert.equal((await json(s, 'DELETE', `/api/payments/${january.id}`)).status, 200)
  assert.deepEqual((await suggestions(s))[0]?.[2], RENT_TARGET, 'Rückstand 2027')
}))

// (d) Ausgezogen: ohne Rückstand ausgeglichen, mit Übertrag (`carriedOnly`) nicht.
test('#308 Durchsicht: Ausgezogener ohne und mit Rückstand', () => withEnv({ NKA_TEST_TODAY: '2026-04-15' }, async (s) => {
  const t = await tenancy(s, 'EG', TENANT, { end: '2025-12-31' })
  const paid = await payRent(s, t.id, '2025-01', '2025-12')
  await settle(s, 2025, 210000, '2026-02-20')
  await importEntries(s, [{ date: '2026-03-10', cents: 30000 }])
  assert.deepEqual((await suggestions(s))[0]?.[2], SETTLEMENT_TARGET, 'nichts offen')
  const december = paid.find((p) => p.date === '2025-12-01') ?? assert.fail('keine Dezembermiete')
  assert.equal((await json(s, 'DELETE', `/api/payments/${december.id}`)).status, 200)
  assert.deepEqual((await suggestions(s))[0]?.[2], RENT_TARGET, 'Übertrag aus 2025')
}))

// Durchsicht PR #654, 4: Endete das Mietverhältnis vor dem Beginn der Erfassung, weiß das Mietkonto nichts über es; das
// ist nicht „ausgeglichen“.
test('#308 Durchsicht: Mietverhältnis vor dem Beginn der Erfassung: unbekannt, kein Vorschlag', () => withEnv({ NKA_TEST_TODAY: '2025-04-15' }, async (s) => {
  await tenancy(s, 'EG', TENANT, { start: '2024-01-01', end: '2024-12-31', baseRents: [{ from: '2024-01', monthlyCents: 70000 }], prepayments: [{ from: '2024-01', monthlyCents: 15000 }] })
  const next = await tenancy(s, 'OG', SECOND)
  await payRent(s, next.id, '2025-01', '2025-04')
  // Zwei gleich große Wohnungen, 2024 nur EG vermietet: 4.200 € je zur Hälfte, 2.100 € gegen 1.800 €.
  await settle(s, 2024, 420000, '2025-02-20')
  await importEntries(s, [{ date: '2025-03-10', cents: 30000 }])
  assert.deepEqual((await suggestions(s))[0]?.[2], RENT_TARGET)
}))

// (f) Guthaben 2024 und Nachzahlung 2025 zugleich offen; auch die Auszahlung reserviert (Durchsicht PR #654, 2).
test('#308 Durchsicht: Guthaben und Nachzahlung zugleich offen; zwei gleiche Auszahlungen, nur die erste', () => withEnv({ NKA_TEST_TODAY: '2026-04-15' }, async (s) => {
  const t = await tenancy(s, 'EG', TENANT, { start: '2024-01-01', baseRents: [{ from: '2024-01', monthlyCents: 70000 }], prepayments: [{ from: '2024-01', monthlyCents: 15000 }] })
  await payRent(s, t.id, '2024-01', '2026-04')
  await settle(s, 2024, 168000, '2025-02-20')
  await settle(s, 2025, 210000, '2026-02-20')
  await importEntries(s, [{ date: '2026-03-05', cents: -12000 }, { date: '2026-03-06', cents: -12000 }, { date: '2026-03-10', cents: 30000 }])
  const rows = await transactions(s)
  assert.deepEqual(rows.map((r) => [r.bookingDate, r.suggestion?.reason]), [
    ['2026-03-05', 'Betrag wie das offene Guthaben aus der Abrechnung 2024'],
    ['2026-03-06', 'Auszahlung an den Mieter, etwa ein Guthaben aus der Abrechnung'],
    ['2026-03-10', 'Betrag wie die offene Nachzahlung aus der Abrechnung 2025; das Mietkonto ist sonst ausgeglichen'],
  ])
}))

// ---------- #693: Monat laut Verwendungszweck ----------
type Month = { month: number; status: string; paidCents: number }
const monthsOf = async (s: Server, year: number, tenancyId: string): Promise<Month[]> =>
  (await s.api<RentLedger>(`/api/rentledger/${year}`)).rows.find((r) => r.tenancyId === tenancyId)?.months ?? assert.fail('keine Zeile im Mietkonto')
const paidOf = (months: readonly Month[], month: number) => months.find((m) => m.month === month)?.paidCents

test('#693: Rückstand im Januar, „Miete November“ im November: ohne Monat tilgt die Zahlung den Januar, mit bestätigtem Monat den November', () => withEnv({ NKA_TEST_TODAY: '2026-11-20' }, async (s) => {
  const t = await tenancy(s, 'EG', TENANT, { start: '2026-01-01', prepayments: [{ from: '2026-01', monthlyCents: 15000 }], baseRents: [{ from: '2026-01', monthlyCents: 70000 }] })
  // Im Januar kommt nur die Vorauszahlung (damit beginnt die Erfassung im Januar), 700 € Kaltmiete bleiben offen. Februar
  // bis Oktober sind mit ihrem Monat erfasst, sonst wanderte der Rückstand mit jeder Zahlung einen Monat weiter.
  await s.api('/api/payments', { method: 'POST', body: JSON.stringify({ tenancyId: t.id, date: '2026-01-02', amountCents: 15000 }) })
  for (let m = 2; m <= 10; m++) {
    const month = `2026-${String(m).padStart(2, '0')}`
    await s.api('/api/payments', { method: 'POST', body: JSON.stringify({ tenancyId: t.id, date: `${month}-01`, amountCents: 85000, designatedMonth: month }) })
  }
  await importEntries(s, [{ date: '2026-11-03', cents: 85000, purpose: 'Miete November' }])
  const [open] = await transactions(s)
  assert.deepEqual(open?.suggestion, {
    tenancyId: t.id, target: { type: 'newPayment', kind: 'rent', designatedMonth: '2026-11' }, light: 'yellow',
    reason: 'Der Verwendungszweck nennt November 2026. Bitte prüfen Sie den Monat.',
  })
  // Wie bisher, wenn der Vermieter den Monat herausnimmt: Nach der Vorauszahlung des Novembers tilgt die Zahlung die
  // offene Kaltmiete des Januars; im November bleiben 700 € offen.
  const plain = [{ transactionId: open?.id, parts: [{ tenancyId: t.id, amountCents: 85000, target: { type: 'newPayment', kind: 'rent' } }] }]
  await book(s, plain)
  let months = await monthsOf(s, 2026, t.id)
  assert.deepEqual([paidOf(months, 1), paidOf(months, 11)], [85000, 15000])
  const [link] = (await transactions(s, 'done'))[0]?.links ?? []
  assert.equal((await json(s, 'DELETE', `/api/bank/links/${link?.id}?payment=delete`)).status, 200)
  // Mit dem bestätigten Vorschlag: November bezahlt, im Januar bleiben die 700 € offen; die Summe des Rückstands ist dieselbe.
  await book(s, asSuggested(await transactions(s)))
  months = await monthsOf(s, 2026, t.id)
  assert.deepEqual([paidOf(months, 1), paidOf(months, 11)], [15000, 85000])
  assert.deepEqual((await payments(s)).filter((p) => p.fromBank).map((p) => [p.date, p.designatedMonth, p.note]), [['2026-11-03', '2026-11', 'Miete November']])
}))

test('#693: ein Monat außerhalb des Mietverhältnisses ist schon in der Vorschau ein Problem, gebucht wird nichts', () => withEnv({ NKA_TEST_TODAY: '2026-11-20' }, async (s) => {
  const t = await tenancy(s, 'EG', TENANT, { start: '2026-03-01', prepayments: [{ from: '2026-03', monthlyCents: 15000 }], baseRents: [{ from: '2026-03', monthlyCents: 70000 }] })
  await importEntries(s, [{ date: '2026-11-03', cents: 85000, purpose: 'Miete' }])
  const [open] = await transactions(s)
  assert.deepEqual(open?.suggestion?.target, RENT_TARGET)
  const decisions = [{ transactionId: open?.id, parts: [{ tenancyId: t.id, amountCents: 85000, target: { type: 'newPayment', kind: 'rent', designatedMonth: '2026-02' } }] }]
  const preview = await planLinks(s, decisions)
  assert.deepEqual(preview.problems.map((p) => p.message), ['Der Monat laut Verwendungszweck liegt außerhalb des Mietverhältnisses. Das Mietverhältnis besteht seit 01.03.2026.'])
  assert.equal((await bookRaw(s, decisions, preview.token)).status, 400)
  assert.deepEqual(await payments(s), [])
}))

// Durchsicht: Wer nichts schuldet und jeden Monat den Monat nennt, bleibt grün; die Zahlung tilgt ohne Monat dasselbe.
test('#693: alles bezahlt, „Miete 11/2026“: grün ohne Monat; mit Rückstand im April gelb mit Monat; ein Name wie ein Monat: kein Monat', () => withEnv({ NKA_TEST_TODAY: '2026-11-20' }, async (s) => {
  const t = await tenancy(s, 'EG', TENANT, { start: '2026-01-01', prepayments: [{ from: '2026-01', monthlyCents: 15000 }], baseRents: [{ from: '2026-01', monthlyCents: 70000 }] })
  const late = await tenancy(s, 'OG', SECOND, { start: '2026-01-01', prepayments: [{ from: '2026-01', monthlyCents: 15000 }], baseRents: [{ from: '2026-01', monthlyCents: 70000 }] })
  for (let m = 1; m <= 10; m++) {
    const month = `2026-${String(m).padStart(2, '0')}`
    await s.api('/api/payments', { method: 'POST', body: JSON.stringify({ tenancyId: t.id, date: `${month}-01`, amountCents: 85000, designatedMonth: month }) })
    if (m !== 4) await s.api('/api/payments', { method: 'POST', body: JSON.stringify({ tenancyId: late.id, date: `${month}-01`, amountCents: 85000, designatedMonth: month }) })
  }
  await importEntries(s, [
    { date: '2026-11-03', cents: 85000, purpose: 'Miete 11/2026' },
    { date: '2026-11-03', cents: 85000, purpose: 'Miete 11/2026', iban: SECOND },
    { date: '2026-11-04', cents: 85000, purpose: 'Miete Jan Mueller' },
  ])
  const open = await transactions(s)
  assert.deepEqual(open.map((o) => [o.purpose, o.suggestion?.tenancyId === t.id ? 'EG' : 'OG', o.suggestion?.light, o.suggestion?.target]), [
    ['Miete 11/2026', 'EG', 'green', RENT_TARGET],
    ['Miete 11/2026', 'OG', 'yellow', { type: 'newPayment', kind: 'rent', designatedMonth: '2026-11' }],
    ['Miete Jan Mueller', 'EG', 'green', RENT_TARGET],
  ])
}))

// Durchsicht: Das Soll kannte nur Jahre mit Umsätzen und das laufende; ein Monat im Nachbarjahr bekam keinen Vorschlag.
for (const [today, entries, expected] of [
  ['2026-12-30', [{ date: '2026-12-28', cents: 85000, purpose: 'Miete Januar' }, { date: '2026-12-29', cents: 85000, purpose: 'Miete 01/2027' }], ['2027-01', '2027-01']],
  ['2027-01-10', [{ date: '2027-01-04', cents: 85000, purpose: 'Miete Dezember' }], ['2026-12']],
] as const) {
  test(`#693 Jahreswechsel, heute ${today}: der Monat im Nachbarjahr wird vorgeschlagen`, () => withEnv({ NKA_TEST_TODAY: today }, async (s) => {
    const t = await tenancy(s, 'EG', TENANT, { start: '2026-01-01', prepayments: [{ from: '2026-01', monthlyCents: 15000 }], baseRents: [{ from: '2026-01', monthlyCents: 70000 }] })
    // Nur der Januar 2026 ist bezahlt: Davor ist viel offen, der Monat ändert also die Tilgung.
    await s.api('/api/payments', { method: 'POST', body: JSON.stringify({ tenancyId: t.id, date: '2026-01-02', amountCents: 85000 }) })
    await importEntries(s, entries)
    assert.deepEqual((await transactions(s)).map((o) => [o.suggestion?.light, o.suggestion?.target]), expected.map((month) => ['yellow', { type: 'newPayment', kind: 'rent', designatedMonth: month }]))
  }))
}

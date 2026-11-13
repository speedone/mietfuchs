// Zuordnungen planen (#188, Teil 2): aus den Entscheidungen des Vermieters werden Zahlungen, Kautionsbuchungen und
// Verknüpfungen, oder Probleme. Nichts ohne Entscheidung; der Monat wird nie gesetzt.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { linkToken, parseLinkDecisions, planBankLinks, type LinkDecision } from '../src/bank/linkPlan.ts'
import type { MatchContext } from '../src/bank/match.ts'
import type { BankTransaction } from '../src/bank/model.ts'
import type { Payment } from '../../shared/types.ts'

const tx = (id: string, amountCents: number, over: Partial<BankTransaction> = {}): BankTransaction => ({
  id, accountId: 'a', importId: 'i', bookingDate: '2025-03-03', valueDate: null, amountCents, counterpartyName: 'Erika Beispiel',
  counterpartyIban: 'DE02120300000000202051', ultimatePartyName: null, purpose: 'Miete März', bankReference: null, endToEndId: null,
  reversal: false, fingerprint: 'f', batchReference: null, batchPart: null, batchParts: null, batchTotalCents: null, setAside: null, ...over,
})
const open = (...txs: BankTransaction[]) => txs.map((t) => ({ tx: t, openCents: t.amountCents }))

const payment = (id: string, amountCents: number, tenancyId = 't1'): Payment => ({ id, tenancyId, date: '2025-03-01', amountCents, kind: 'rent' })

const ctx = (over: Partial<MatchContext> = {}): MatchContext => ({
  tenancies: [{ id: 't1', start: '2025-01-01', end: null }, { id: 't2', start: '2025-01-01', end: null }],
  payers: [], payments: [], linkedPaymentIds: new Set(), depositEntries: [], monthlySollCents: () => 80000, ...over,
})

const rent = (transactionId: string, amountCents: number, tenancyId = 't1'): LinkDecision =>
  ({ transactionId, parts: [{ tenancyId, amountCents, target: { type: 'newPayment', kind: 'rent' } }] })

test('Zuordnung: eine Mietzahlung je Entscheidung, Datum ist der Buchungstag, Notiz der gekürzte Zweck, kein Monat', () => {
  const long = 'Miete '.repeat(60)
  const p = planBankLinks([rent('x', 80000)], open(tx('x', 80000, { purpose: long })), ctx())
  assert.deepEqual(p.problems, [])
  assert.deepEqual(p.writes.payments, [{ transactionId: 'x', tenancyId: 't1', date: '2025-03-03', amountCents: 80000, kind: 'rent', note: long.slice(0, 200) }])
  assert.ok(!('designatedMonth' in (p.writes.payments[0] ?? {})))
  assert.equal(p.sentence, '1 Zahlung gebucht.')
})

test('Zuordnung: aufteilen auf zwei Mietverhältnisse; mehr als der Umsatz ist ein Problem, weniger lässt den Rest offen', () => {
  const split: LinkDecision = { transactionId: 'x', parts: [
    { tenancyId: 't1', amountCents: 80000, target: { type: 'newPayment', kind: 'rent' } },
    { tenancyId: 't2', amountCents: 70000, target: { type: 'newPayment', kind: 'rent' } },
  ] }
  const ok = planBankLinks([split], open(tx('x', 150000)), ctx())
  assert.deepEqual(ok.problems, [])
  assert.deepEqual(ok.writes.payments.map((w) => [w.tenancyId, w.amountCents]), [['t1', 80000], ['t2', 70000]])
  const tooMuch = planBankLinks([split], open(tx('x', 149999)), ctx())
  assert.deepEqual(tooMuch.problems, [{ transactionId: 'x', message: 'Die Teile ergeben mehr als den Umsatz (1.500,00 € statt 1.499,99 €).' }])
  const less = planBankLinks([rent('x', 80000)], open(tx('x', 150000)), ctx())
  assert.deepEqual(less.problems, [])
})

test('Zuordnung: ein Teil mit anderem Vorzeichen als der Umsatz oder über 0 € ist ein Problem', () => {
  assert.match(planBankLinks([rent('x', -80000)], open(tx('x', 80000)), ctx()).problems[0]?.message ?? '', /Vorzeichen/)
  assert.match(planBankLinks([rent('x', 0)], open(tx('x', 80000)), ctx()).problems[0]?.message ?? '', /Vorzeichen|0 €/)
})

test('Zuordnung: eine Kaution wird Kautionsbuchung mit positivem Betrag, auch die Rückzahlung', () => {
  const received = planBankLinks([{ transactionId: 'x', parts: [{ tenancyId: 't1', amountCents: 240000, target: { type: 'deposit', kind: 'received' } }] }], open(tx('x', 240000)), ctx())
  assert.deepEqual(received.writes.depositEntries, [{ transactionId: 'x', tenancyId: 't1', date: '2025-03-03', kind: 'received', amountCents: 240000, note: 'Miete März' }])
  assert.deepEqual(received.writes.payments, [])
  const refunded = planBankLinks([{ transactionId: 'y', parts: [{ tenancyId: 't1', amountCents: -240000, target: { type: 'deposit', kind: 'refunded' } }] }], open(tx('y', -240000)), ctx())
  assert.equal(refunded.writes.depositEntries[0]?.amountCents, 240000)
  assert.equal(refunded.writes.depositEntries[0]?.kind, 'refunded')
  const wrong = planBankLinks([{ transactionId: 'y', parts: [{ tenancyId: 't1', amountCents: -240000, target: { type: 'deposit', kind: 'received' } }] }], open(tx('y', -240000)), ctx())
  assert.equal(wrong.problems.length, 1)
})

test('Zuordnung: erfasste Zahlung nur mit gleichem Mietverhältnis und Betrag und nur einmal', () => {
  const link = (paymentId: string, tenancyId = 't1', amountCents = 80000): LinkDecision => ({ transactionId: 'x', parts: [{ tenancyId, amountCents, target: { type: 'existingPayment', paymentId } }] })
  const c = ctx({ payments: [payment('p1', 80000), payment('p2', 80000, 't2')], linkedPaymentIds: new Set(['p2']) })
  const ok = planBankLinks([link('p1')], open(tx('x', 80000)), c)
  assert.deepEqual(ok.writes.existing, [{ transactionId: 'x', paymentId: 'p1' }])
  assert.equal(ok.sentence, '1 Umsatz mit erfasster Zahlung verknüpft.')
  assert.equal(planBankLinks([link('p1', 't2')], open(tx('x', 80000)), c).problems.length, 1, 'anderes Mietverhältnis')
  assert.equal(planBankLinks([link('p1', 't1', 70000)], open(tx('x', 80000)), c).problems.length, 1, 'anderer Betrag')
  assert.equal(planBankLinks([link('p2', 't2')], open(tx('x', 80000)), c).problems[0]?.message, 'Diese Zahlung ist schon einem Kontoumsatz zugeordnet.')
  assert.equal(planBankLinks([link('fehlt')], open(tx('x', 80000)), c).problems.length, 1)
  const twice = planBankLinks([link('p1'), { ...link('p1'), transactionId: 'y' }], open(tx('x', 80000), tx('y', 80000)), c)
  assert.equal(twice.problems.length, 1)
})

test('Zuordnung: ein erledigter Umsatz, ein fremdes Mietverhältnis und zwei Entscheidungen zu einem Umsatz sind Probleme', () => {
  assert.deepEqual(planBankLinks([rent('weg', 80000)], open(tx('x', 80000)), ctx()).problems, [{ transactionId: 'weg', message: 'Dieser Umsatz ist schon zugeordnet.' }])
  assert.match(planBankLinks([rent('x', 80000, 'fremd')], open(tx('x', 80000)), ctx()).problems[0]?.message ?? '', /Mietverhältnis/)
  assert.equal(planBankLinks([rent('x', 40000), rent('x', 40000)], open(tx('x', 80000)), ctx()).problems.length, 1)
})

test('Zuordnung: beiseitelegen und der Satz mit Einzahl und Mehrzahl', () => {
  const decisions: LinkDecision[] = [
    rent('a', 80000), rent('b', 80000), rent('c', 80000),
    { transactionId: 'd', parts: [{ tenancyId: 't1', amountCents: 240000, target: { type: 'deposit', kind: 'received' } }] },
    { transactionId: 'e', parts: [{ tenancyId: 't1', amountCents: 80000, target: { type: 'existingPayment', paymentId: 'p1' } }] },
    { transactionId: 'f', setAside: 'transfer' }, { transactionId: 'g', setAside: 'notRental' },
  ]
  const p = planBankLinks(decisions, open(tx('a', 80000), tx('b', 80000), tx('c', 80000), tx('d', 240000), tx('e', 80000), tx('f', -5000), tx('g', 100)), ctx({ payments: [payment('p1', 80000)] }))
  assert.deepEqual(p.problems, [])
  assert.deepEqual(p.writes.setAside, [{ transactionId: 'f', reason: 'transfer' }, { transactionId: 'g', reason: 'notRental' }])
  assert.equal(p.sentence, '3 Zahlungen gebucht, 1 Kautionsbuchung, 1 Umsatz mit erfasster Zahlung verknüpft, 2 beiseitegelegt.')
})

test('Zuordnung: die Marke hängt an Entscheidungen und Plan', () => {
  const a = planBankLinks([rent('x', 80000)], open(tx('x', 80000)), ctx())
  assert.equal(linkToken(a, [rent('x', 80000)]), linkToken(planBankLinks([rent('x', 80000)], open(tx('x', 80000)), ctx()), [rent('x', 80000)]))
  const b = planBankLinks([rent('x', 70000)], open(tx('x', 80000)), ctx())
  assert.notEqual(linkToken(a, [rent('x', 80000)]), linkToken(b, [rent('x', 70000)]))
  const other = planBankLinks([rent('x', 80000)], open(tx('x', 80000, { purpose: 'anders' })), ctx())
  assert.notEqual(linkToken(a, [rent('x', 80000)]), linkToken(other, [rent('x', 80000)]))
})

test('parseLinkDecisions: lehnt alles ab, was nicht der Form entspricht, mit einem Satz', () => {
  assert.deepEqual(parseLinkDecisions([rent('x', 80000), { transactionId: 'y', setAside: 'other' }]), { decisions: [rent('x', 80000), { transactionId: 'y', setAside: 'other' }] })
  for (const bad of [null, 'x', [{}], [{ transactionId: 'x' }], [{ transactionId: 'x', parts: [] }], [{ transactionId: 'x', setAside: 'privat' }],
    [{ transactionId: 'x', parts: [{ tenancyId: 't1', amountCents: 1.5, target: { type: 'newPayment', kind: 'rent' } }] }],
    [{ transactionId: 'x', parts: [{ tenancyId: 't1', amountCents: 100, target: { type: 'newPayment', kind: 'kaution' } }] }],
    [{ transactionId: 'x', parts: [{ tenancyId: 't1', amountCents: 100, target: { type: 'deposit', kind: 'applied' } }] }],
    [{ transactionId: 'x', parts: [{ tenancyId: 't1', amountCents: 100, target: { type: 'existingPayment' } }] }]]) {
    const r = parseLinkDecisions(bad)
    assert.ok('error' in r, JSON.stringify(bad))
    assert.match(r.error, /^Die Zuordnungen /)
  }
})

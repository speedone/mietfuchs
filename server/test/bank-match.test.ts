// Vorschlag zu einem offenen Kontoumsatz (#188, Teil 2): Mietverhältnis über die IBAN, schon erfasste Zahlung, Art und
// Ampel. Regeln: docs/superpowers/specs/2026-11-12-kontoauszug-design.md, „Zuordnen und Buchen“.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { linkedCents, openCents, suggest, type MatchContext, type MatchTenancy } from '../src/bank/match.ts'
import type { BankTransaction } from '../src/bank/model.ts'
import type { DepositEntry, Payment } from '../../shared/types.ts'

const TENANT = 'DE02120300000000202051'
const PAYER = 'DE44500105175407324931'

const tx = (bookingDate: string, amountCents: number, over: Partial<BankTransaction> = {}): BankTransaction => ({
  id: 'x', accountId: 'a', importId: 'i', bookingDate, valueDate: bookingDate, amountCents, counterpartyName: 'Erika Beispiel',
  counterpartyIban: TENANT, ultimatePartyName: null, purpose: 'Miete', bankReference: null, endToEndId: null, reversal: false,
  fingerprint: 'f', batchReference: null, batchPart: null, batchParts: null, batchTotalCents: null, setAside: null, ...over,
})

const tenancy = (over: Partial<MatchTenancy> = {}): MatchTenancy => ({ id: 't1', iban: TENANT, start: '2025-01-01', end: null, depositCents: 240000, ...over })

const ctx = (over: Partial<MatchContext> = {}): MatchContext => ({
  tenancies: [tenancy()], payers: [], payments: [], linkedPaymentIds: new Set(), depositEntries: [], linkedDepositEntryIds: new Set(),
  monthlySollCents: () => 80000, ...over,
})

const payment = (id: string, date: string, amountCents: number, tenancyId = 't1'): Payment => ({ id, tenancyId, date, amountCents, kind: 'rent' })

test('Vorschlag: Mietverhältnis über die IBAN des Mieters, Betrag wie Monatsmiete ist grün', () => {
  assert.deepEqual(suggest(tx('2025-03-03', 80000), ctx()), {
    tenancyId: 't1', target: { type: 'newPayment', kind: 'rent' }, light: 'green', reason: 'IBAN bekannt, Betrag wie Monatsmiete',
  })
})

test('Vorschlag: über einen gemerkten Zahler; IBAN mit Leerzeichen und klein trifft', () => {
  const viaPayer = suggest(tx('2025-03-03', 80000, { counterpartyIban: PAYER }), ctx({ payers: [{ id: 'z', tenancyId: 't1', iban: PAYER, name: null }] }))
  assert.equal(viaPayer?.tenancyId, 't1')
  const spaced = suggest(tx('2025-03-03', 80000), ctx({ tenancies: [tenancy({ iban: 'de02 1203 0000 0000 2020 51' })] }))
  assert.equal(spaced?.tenancyId, 't1')
})

test('Vorschlag: zwei Mietverhältnisse mit derselben IBAN, nur wenn am Buchungstag genau eines läuft', () => {
  const old = tenancy({ id: 'alt', start: '2024-01-01', end: '2025-02-28' })
  const next = tenancy({ id: 'neu', start: '2025-03-01' })
  assert.equal(suggest(tx('2025-03-03', 80000), ctx({ tenancies: [old, next] }))?.tenancyId, 'neu')
  assert.equal(suggest(tx('2025-02-03', 80000), ctx({ tenancies: [old, next] }))?.tenancyId, 'alt')
  assert.equal(suggest(tx('2025-03-03', 80000), ctx({ tenancies: [tenancy({ id: 'a' }), tenancy({ id: 'b' })] })), null)
  assert.equal(suggest(tx('2023-03-03', 80000), ctx({ tenancies: [old, next] })), null)
})

test('Vorschlag: ohne bekannte IBAN keiner, auch wenn der Name des Mieters im Zweck steht', () => {
  assert.equal(suggest(tx('2025-03-03', 80000, { counterpartyIban: 'DE75512108001245126199', purpose: 'Miete Erika Beispiel' }), ctx()), null)
  assert.equal(suggest(tx('2025-03-03', 80000, { counterpartyIban: null }), ctx()), null)
})

test('Vorschlag: schon erfasst, innerhalb von 7 Tagen und unverknüpft', () => {
  const p = payment('p1', '2025-03-03', 80000)
  assert.deepEqual(suggest(tx('2025-03-05', 80000), ctx({ payments: [p] }))?.target, { type: 'existingPayment', paymentId: 'p1' })
  assert.deepEqual(suggest(tx('2025-03-12', 80000), ctx({ payments: [p] }))?.target, { type: 'newPayment', kind: 'rent' })
  assert.deepEqual(suggest(tx('2025-03-05', 80000), ctx({ payments: [p], linkedPaymentIds: new Set(['p1']) }))?.target, { type: 'newPayment', kind: 'rent' })
  assert.deepEqual(suggest(tx('2025-03-05', 80000), ctx({ payments: [p, payment('p2', '2025-03-06', 80000)] }))?.target, { type: 'existingPayment', paymentId: 'p2' }, 'die nächste')
  const tie = suggest(tx('2025-03-05', 80000), ctx({ payments: [p, payment('p3', '2025-03-07', 80000)] }))
  assert.deepEqual(tie?.target, { type: 'newPayment', kind: 'rent' })
  assert.equal(tie?.light, 'yellow')
  assert.equal(tie?.reason, 'Zwei erfasste Zahlungen passen. Bitte wählen Sie.')
  assert.deepEqual(suggest(tx('2025-03-05', 80000), ctx({ payments: [payment('p4', '2025-03-03', 80000, 'anderes')] }))?.target, { type: 'newPayment', kind: 'rent' })
})

test('Vorschlag: Rücklastschrift ist eine negative Mietzahlung, gelb', () => {
  const s = suggest(tx('2025-03-08', -80000, { reversal: true }), ctx())
  assert.deepEqual(s?.target, { type: 'newPayment', kind: 'rent' })
  assert.equal(s?.light, 'yellow')
})

test('Vorschlag: Kaution in Höhe der vereinbarten, nahe dem Mietbeginn und ungleich dem Soll', () => {
  const s = suggest(tx('2025-01-11', 240000), ctx())
  assert.deepEqual(s?.target, { type: 'deposit', kind: 'received' })
  assert.equal(s?.light, 'yellow')
  assert.deepEqual(suggest(tx('2025-03-11', 240000), ctx())?.target, { type: 'newPayment', kind: 'rent' }, 'zu weit vom Beginn')
  assert.deepEqual(suggest(tx('2025-01-11', 240000), ctx({ monthlySollCents: () => 240000 }))?.target, { type: 'newPayment', kind: 'rent' }, 'gleich dem Soll')
})

test('Vorschlag: Ausgang an den Mieter ist nach dem Auszug mit Kaution eine Rückzahlung, sonst ein Guthaben; beides gelb', () => {
  const ended = tenancy({ end: '2025-06-30' })
  const received: DepositEntry = { id: 'd', tenancyId: 't1', date: '2025-01-05', kind: 'received', amountCents: 240000 }
  const refund = suggest(tx('2025-08-01', -240000), ctx({ tenancies: [ended], depositEntries: [received] }))
  assert.deepEqual(refund?.target, { type: 'deposit', kind: 'refunded' })
  assert.equal(refund?.light, 'yellow')
  const credit = suggest(tx('2025-08-01', -12000), ctx({ tenancies: [ended] }))
  assert.deepEqual(credit?.target, { type: 'newPayment', kind: 'settlement' })
  assert.equal(credit?.light, 'yellow')
  assert.deepEqual(suggest(tx('2025-05-01', -12000), ctx({ tenancies: [ended], depositEntries: [received] }))?.target, { type: 'newPayment', kind: 'settlement' }, 'vor dem Auszug')
})

test('Vorschlag: Ampel gelb bei abweichendem Betrag und ohne Soll', () => {
  const less = suggest(tx('2025-03-03', 79000), ctx())
  assert.equal(less?.light, 'yellow')
  assert.equal(less?.reason, 'Betrag weicht vom Soll ab (800,00 €)')
  const none = suggest(tx('2025-03-03', 80000), ctx({ monthlySollCents: () => null }))
  assert.equal(none?.light, 'yellow')
})

test('openCents und linkedCents', () => {
  assert.equal(openCents(tx('2025-03-03', 160000), [80000]), 80000)
  assert.equal(openCents(tx('2025-03-03', 160000, { setAside: 'other' }), []), 0)
  assert.equal(openCents(tx('2025-03-03', -50000), [-20000]), -30000)
  assert.equal(linkedCents({ id: 'd', tenancyId: 't1', date: '2025-08-01', kind: 'refunded', amountCents: 240000 }), -240000)
  assert.equal(linkedCents({ id: 'd', tenancyId: 't1', date: '2025-08-01', kind: 'interest', amountCents: 100 }), 100)
  assert.equal(linkedCents(payment('p', '2025-03-03', -80000)), -80000)
})

// ---------- Befunde der Durchsicht (Teil 2) ----------

test('Durchsicht I2: eine schon erfasste Kautionsbuchung gleichen Betrags wird verknüpft, nicht doppelt angelegt', () => {
  const hand: DepositEntry = { id: 'd1', tenancyId: 't1', date: '2025-01-08', kind: 'received', amountCents: 240000 }
  const s = suggest(tx('2025-01-11', 240000), ctx({ depositEntries: [hand] }))
  assert.deepEqual(s?.target, { type: 'existingDeposit', depositEntryId: 'd1' })
  assert.deepEqual(suggest(tx('2025-01-11', 240000), ctx({ depositEntries: [hand], linkedDepositEntryIds: new Set(['d1']) }))?.target, { type: 'deposit', kind: 'received' })
  const refund: DepositEntry = { id: 'd2', tenancyId: 't1', date: '2025-08-03', kind: 'refunded', amountCents: 240000 }
  assert.deepEqual(suggest(tx('2025-08-01', -240000), ctx({ tenancies: [tenancy({ end: '2025-06-30' })], depositEntries: [hand, refund] }))?.target, { type: 'existingDeposit', depositEntryId: 'd2' })
})

test('Durchsicht I3: eine erfasste Zahlung außerhalb von 7 Tagen, aber im Monat drumherum, macht den Vorschlag gelb', () => {
  const s = suggest(tx('2025-06-02', 80000), ctx({ payments: [payment('p1', '2025-06-15', 80000)] }))
  assert.deepEqual(s?.target, { type: 'newPayment', kind: 'rent' })
  assert.equal(s?.light, 'yellow')
  assert.equal(s?.reason, 'Am 15.06.2025 ist schon eine Zahlung über 800,00 € erfasst. Bitte prüfen Sie, ob es dieselbe ist.')
  assert.equal(suggest(tx('2025-06-02', 80000), ctx({ payments: [payment('p1', '2025-08-15', 80000)] }))?.light, 'green')
  assert.equal(suggest(tx('2025-06-02', 80000), ctx({ payments: [payment('p1', '2025-06-15', 80000)], linkedPaymentIds: new Set(['p1']) }))?.light, 'green')
})

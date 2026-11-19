// Vorschlag zu einem offenen Kontoumsatz (#188, Teil 2): Mietverhältnis über die IBAN, schon erfasste Zahlung, Art und
// Ampel. Regeln: docs/superpowers/specs/2026-11-12-kontoauszug-design.md, „Zuordnen und Buchen“.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { linkedCents, openCents, suggest, type MatchContext, type MatchTenancy } from '../src/bank/match.ts'
import type { BankTransaction } from '../src/bank/model.ts'
import { closedBalancesOf, openSettlementsOf, type ClosedBalance, type OpenSettlement, type RentAccount } from '../src/bank/settlementMatch.ts'
import { periodKey } from '../../shared/period.ts'
import type { DepositEntry, HeatingPlant, Payment, Property } from '../../shared/types.ts'

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
  // Die Kaution ist mit d1 schon ganz gebucht (Durchsicht 642/4): kein zweiter Vorschlag als Kaution, d1 wird nicht wiederverwendet.
  assert.deepEqual(suggest(tx('2025-01-11', 240000), ctx({ depositEntries: [hand], linkedDepositEntryIds: new Set(['d1']) }))?.target, { type: 'newPayment', kind: 'rent' })
  const refund: DepositEntry = { id: 'd2', tenancyId: 't1', date: '2025-08-03', kind: 'refunded', amountCents: 240000 }
  assert.deepEqual(suggest(tx('2025-08-01', -240000), ctx({ tenancies: [tenancy({ end: '2025-06-30' })], depositEntries: [hand, refund] }))?.target, { type: 'existingDeposit', depositEntryId: 'd2' })
})

test('Durchsicht I3: eine erfasste Zahlung außerhalb von 7 Tagen, aber im Monat drumherum, macht den Vorschlag gelb', () => {
  const s = suggest(tx('2025-06-02', 80000), ctx({ payments: [payment('p1', '2025-06-15', 80000)] }))
  assert.deepEqual(s?.target, { type: 'newPayment', kind: 'rent' })
  assert.equal(s?.light, 'yellow')
  assert.equal(s?.reason, 'Am 15.06.2025 ist schon eine Zahlung über denselben Betrag erfasst. Bitte prüfen Sie, ob es dieselbe ist.')
  assert.equal(suggest(tx('2025-06-02', 80000), ctx({ payments: [payment('p1', '2025-08-15', 80000)] }))?.light, 'green')
  assert.equal(suggest(tx('2025-06-02', 80000), ctx({ payments: [payment('p1', '2025-06-15', 80000)], linkedPaymentIds: new Set(['p1']) }))?.light, 'green')
})

// ---------- Befunde des Praxistests vor 0.18.0 ----------

test('Praxistest 1: eine Kautionsrate wird als Kaution vorgeschlagen, solange Kaution offen ist', () => {
  const rate = suggest(tx('2025-02-04', 80000, { purpose: 'Rate 2' }), ctx({ monthlySollCents: () => 95000 }))
  assert.deepEqual(rate?.target, { type: 'deposit', kind: 'received' }, 'ein Drittel der vereinbarten Kaution in den ersten Monaten')
  assert.equal(rate?.light, 'yellow')
  assert.equal(rate?.reason, 'Betrag wie eine Rate der vereinbarten Kaution (ein Drittel)')
  const byPurpose = suggest(tx('2025-03-04', 56000, { purpose: 'Kaution Rate 2' }), ctx({ monthlySollCents: () => 95000 }))
  assert.deepEqual(byPurpose?.target, { type: 'deposit', kind: 'received' }, '„Kaution“ im Zweck')
  assert.equal(byPurpose?.reason, '„Kaution“ im Verwendungszweck, und die vereinbarte Kaution ist noch nicht ganz eingegangen')
  const paid: DepositEntry = { id: 'd', tenancyId: 't1', date: '2025-01-05', kind: 'received', amountCents: 240000 }
  assert.deepEqual(suggest(tx('2025-02-04', 80000, { purpose: 'Kaution' }), ctx({ depositEntries: [paid], monthlySollCents: () => 95000 }))?.target, { type: 'newPayment', kind: 'rent' }, 'Kaution schon ganz da')
  assert.deepEqual(suggest(tx('2025-02-04', 80000), ctx())?.target, { type: 'newPayment', kind: 'rent' }, 'gleich dem Soll bleibt Miete')
  assert.deepEqual(suggest(tx('2025-09-04', 80000), ctx({ monthlySollCents: () => 95000 }))?.target, { type: 'newPayment', kind: 'rent' }, 'ein Drittel lange nach dem Beginn')
  assert.deepEqual(suggest(tx('2025-03-04', 300000, { purpose: 'Kaution' }), ctx({ monthlySollCents: () => 95000 }))?.target, { type: 'newPayment', kind: 'rent' }, 'mehr als offen')
})

test('Praxistest 2: nur eine erfasste Zahlung gleichen Betrags in der Nähe macht gelb, mit passendem Grund', () => {
  assert.equal(suggest(tx('2025-06-02', 80000), ctx({ payments: [payment('p1', '2025-06-15', 79000)] }))?.light, 'green', 'anderer Betrag')
  assert.equal(suggest(tx('2025-06-02', 80000), ctx({ payments: [payment('p1', '2025-05-02', 80000)] }))?.light, 'green', 'Miete des Vormonats')
  const near = suggest(tx('2025-05-31', 80000), ctx({ payments: [payment('p1', '2025-06-15', 80000)] }))
  assert.equal(near?.light, 'yellow')
  assert.equal(near?.reason, 'Am 15.06.2025 ist schon eine Zahlung über denselben Betrag erfasst. Bitte prüfen Sie, ob es dieselbe ist.')
})

test('Durchsicht 642/1: ohne oder mit anteiligem Soll ist eine volle Monatsmiete keine Kautionsrate', () => {
  // Garage: Miete 60 €, Kaution 180 €. Beginn 01.04., April-Miete am 29.03. (Soll März null) bzw. Beginn 15.04. (anteilig).
  const garage = tenancy({ start: '2025-04-01', depositCents: 18000 })
  const soll = (_t: string, m: string): number | null => (m < '2025-04' ? null : 6000)
  assert.deepEqual(suggest(tx('2025-03-29', 6000), ctx({ tenancies: [garage], monthlySollCents: soll }))?.target, { type: 'newPayment', kind: 'rent' })
  const mid = tenancy({ start: '2025-04-15', depositCents: 18000 })
  const prorated = (_t: string, m: string): number | null => (m === '2025-04' ? 3200 : m > '2025-04' ? 6000 : null)
  assert.deepEqual(suggest(tx('2025-05-02', 6000), ctx({ tenancies: [mid], monthlySollCents: prorated }))?.target, { type: 'newPayment', kind: 'rent' })
})

test('Durchsicht 642/2: Kaution laut Stammdaten erhalten oder als Bürgschaft: kein Vorschlag als Kaution', () => {
  const kept = suggest(tx('2025-02-04', 80000, { purpose: 'Kaution' }), ctx({ tenancies: [tenancy({ depositStatus: 'erhalten' })], monthlySollCents: () => 95000 }))
  assert.deepEqual(kept?.target, { type: 'newPayment', kind: 'rent' })
  const bond = suggest(tx('2025-01-11', 240000), ctx({ tenancies: [tenancy({ depositForm: 'guarantee' })] }))
  assert.deepEqual(bond?.target, { type: 'newPayment', kind: 'rent' })
  const full: DepositEntry = { id: 'd', tenancyId: 't1', date: '2024-12-01', kind: 'received', amountCents: 240000 }
  assert.deepEqual(suggest(tx('2025-01-11', 240000), ctx({ depositEntries: [full] }))?.target, { type: 'newPayment', kind: 'rent' }, 'volle Kaution schon gebucht')
})

test('Durchsicht 642/3: eine erfasste Zahlung gleichen Betrags geht dem Vorschlag als Kaution vor; die Miete vom 15. des Vormonats nicht', () => {
  const s = suggest(tx('2025-02-04', 80000, { purpose: 'Kaution' }), ctx({ payments: [payment('p1', '2025-02-16', 80000)], monthlySollCents: () => 95000 }))
  assert.match(s?.reason ?? '', /schon eine Zahlung über denselben Betrag/)
  assert.equal(suggest(tx('2025-06-02', 80000), ctx({ payments: [payment('p1', '2025-05-15', 80000)] }))?.light, 'green')
})

// ---------- Nachzahlung und Guthaben aus der abgeschlossenen Abrechnung am Betrag (#308) ----------

const archive = (statements: { tenancyId: string; balanceCents: number }[]): unknown => ({ statements })
const calendarHouse: Pick<Property, 'id' | 'periodRules'> = { id: 'h', periodRules: { startMonth: 1, changes: [] } }

test('#308: aus jedem Abschluss je Mietverhältnis die Nachzahlung (positiv) oder das Guthaben (negativ), mit Zeitraum und Versand', () => {
  const plant: Pick<HeatingPlant, 'id' | 'propertyId' | 'periodStartMonth' | 'periodChanges'> = { id: 'p', propertyId: 'h', periodStartMonth: 10, periodChanges: [] }
  const balances = closedBalancesOf({
    properties: [calendarHouse],
    heatingPlants: [plant],
    closed: [{ propertyId: 'h', period: periodKey('2025-01'), sentAt: '2026-02-15', settlement: archive([{ tenancyId: 't1', balanceCents: -30000 }, { tenancyId: 't2', balanceCents: 12000 }, { tenancyId: 't3', balanceCents: 0 }]) }],
    closedHeating: [{ plantId: 'p', period: periodKey('2024-10'), sentAt: null, settlement: archive([{ tenancyId: 't1', balanceCents: -4500 }]) }],
  })
  assert.deepEqual(balances.map((b) => [b.tenancyId, b.label, b.periodTo, b.sentAt, b.dueCents]), [
    ['t1', 'Abrechnung 2025', '2025-12-31', '2026-02-15', 30000],
    ['t2', 'Abrechnung 2025', '2025-12-31', '2026-02-15', -12000],
    ['t1', 'Heizkostenabrechnung 2024/2025', '2025-09-30', null, 4500],
  ])
  assert.equal(new Set(balances.map((b) => b.key)).size, 3, 'Kennung je Abrechnung und Mietverhältnis')
  assert.deepEqual(closedBalancesOf({ properties: [calendarHouse], heatingPlants: [], closed: [{ propertyId: 'h', period: periodKey('2025-01'), sentAt: null, settlement: 'kaputt' }], closedHeating: [] }), [], 'unlesbares Archivstück')
})

const balance = (over: Partial<ClosedBalance> = {}): ClosedBalance =>
  ({ key: 'h|2025-01|t1', tenancyId: 't1', label: 'Abrechnung 2025', periodTo: '2025-12-31', sentAt: null, dueCents: 30000, ...over })
const settlementPayment = (date: string, amountCents: number, tenancyId = 't1'): Payment => ({ id: `s${date}${amountCents}`, tenancyId, date, amountCents, kind: 'settlement' })

test('#308: Zahlungen der Art „Abrechnung“ mindern den offenen Betrag, die älteste Abrechnung zuerst; Mieten und frühere Zahlungen nicht', () => {
  const open = (b: ClosedBalance[], p: Payment[]) => openSettlementsOf(b, p).map((o) => [o.label, o.openCents])
  assert.deepEqual(open([balance()], [settlementPayment('2026-03-01', 10000)]), [['Abrechnung 2025', 20000]], 'Teilzahlung')
  assert.deepEqual(open([balance()], [settlementPayment('2025-12-15', 10000), payment('r', '2026-03-01', 10000)]), [['Abrechnung 2025', 30000]], 'vor dem Ende des Zeitraums, Miete')
  assert.deepEqual(open([balance()], [settlementPayment('2026-03-01', 10000, 't2')]), [['Abrechnung 2025', 30000]], 'anderes Mietverhältnis')
  const older = balance({ key: 'h|2024-01|t1', label: 'Abrechnung 2024', periodTo: '2024-12-31', dueCents: 20000 })
  assert.deepEqual(open([balance(), older], [settlementPayment('2026-04-01', 25000)]), [['Abrechnung 2025', 25000], ['Abrechnung 2024', 0]])
  assert.deepEqual(open([balance({ dueCents: -12000 })], [settlementPayment('2026-03-01', -12000)]), [['Abrechnung 2025', 0]], 'Guthaben ausgezahlt')
  assert.deepEqual(open([balance({ dueCents: -12000 })], [settlementPayment('2026-03-01', 5000)]), [['Abrechnung 2025', -12000]], 'Zahlung in der Gegenrichtung mindert nichts')
})

const BALANCED: RentAccount = { arrearsCents: 0, uncertain: false, month: { sollCents: 80000, paidCents: 80000, overdue: false } }
const UNPAID_MONTH: RentAccount = { arrearsCents: 0, uncertain: false, month: { sollCents: 80000, paidCents: 0, overdue: false } }
const settled = (open: Partial<OpenSettlement>[] = [{}], account: RentAccount | null = BALANCED, over: Partial<MatchContext> = {}): MatchContext => ctx({
  openSettlements: (id) => open.map((o) => ({ ...balance(), openCents: o.dueCents ?? 30000, ...o })).filter((o) => o.tenancyId === id),
  rentAccount: () => account,
  ...over,
})
const RENT = { type: 'newPayment', kind: 'rent' }

test('#308: Nachzahlung ohne Zweck bei ausgeglichenem Mietkonto wird gelb als Abrechnung vorgeschlagen', () => {
  const s = suggest(tx('2026-03-10', 30000, { purpose: 'Ueberweisung' }), settled())
  assert.deepEqual(s, { tenancyId: 't1', target: { type: 'newPayment', kind: 'settlement' }, light: 'yellow', reason: 'Betrag wie die offene Nachzahlung aus der Abrechnung 2025; das Mietkonto ist sonst ausgeglichen' })
  assert.deepEqual(suggest(tx('2026-03-10', 30000), settled([{}], null))?.target, RENT, 'ohne Mietkonto keine Aussage')
  assert.deepEqual(suggest(tx('2026-03-10', 30000), settled([{}], { ...BALANCED, arrearsCents: 80000 }))?.target, RENT, 'Rückstand: vielleicht Miete')
  assert.deepEqual(suggest(tx('2026-03-10', 30000), settled([{}], { ...BALANCED, uncertain: true }))?.target, RENT, 'mehr angerechnet als gezahlt')
  assert.deepEqual(suggest(tx('2026-03-10', 30000), ctx())?.target, RENT, 'ohne Abschluss (nur Live-Berechnung) kein Vorschlag')
  assert.deepEqual(suggest(tx('2026-03-10', 30000), settled([]))?.target, RENT, 'nichts offen')
})

test('#308: Miete und Nachzahlung in einer Überweisung ergeben die Aufteilung', () => {
  const s = suggest(tx('2026-03-02', 110000), settled([{}], UNPAID_MONTH))
  assert.deepEqual(s, {
    tenancyId: 't1', target: { type: 'newPayment', kind: 'settlement' }, light: 'yellow',
    reason: 'Betrag wie Monatsmiete (800,00 €) und offene Nachzahlung aus der Abrechnung 2025 (300,00 €); das Mietkonto ist sonst ausgeglichen',
    parts: [{ amountCents: 80000, target: { type: 'newPayment', kind: 'rent' } }, { amountCents: 30000, target: { type: 'newPayment', kind: 'settlement' } }],
  })
  assert.equal(suggest(tx('2026-03-02', 110000), settled([{}], BALANCED))?.parts, undefined, 'Miete des Monats schon bezahlt')
  const overdue = { sollCents: 80000, paidCents: 0, overdue: true }
  assert.equal(suggest(tx('2026-03-02', 110000), settled([{}], { ...UNPAID_MONTH, month: overdue, arrearsCents: 80000 }))?.parts?.length, 2, 'nur der Monat selbst im Rückstand')
  assert.equal(suggest(tx('2026-03-02', 110000), settled([{}], { ...UNPAID_MONTH, month: overdue, arrearsCents: 160000 }))?.parts, undefined, 'noch ein Monat offen')
  assert.equal(suggest(tx('2026-03-02', 110000), settled([{}], { ...UNPAID_MONTH, arrearsCents: 80000 }))?.parts, undefined, 'ein anderer Monat offen')
  assert.equal(suggest(tx('2026-03-02', 110000), settled([{}], { ...UNPAID_MONTH, month: null }))?.parts, undefined, 'Monat unbekannt')
})

test('#308: Auszahlung eines offenen Guthabens an den Mieter, auch nach dem Auszug mit Kaution', () => {
  const s = suggest(tx('2026-03-10', -12000), settled([{ dueCents: -12000 }], null))
  assert.deepEqual(s, { tenancyId: 't1', target: { type: 'newPayment', kind: 'settlement' }, light: 'yellow', reason: 'Betrag wie das offene Guthaben aus der Abrechnung 2025' })
  const ended = tenancy({ end: '2025-12-31' })
  const received: DepositEntry = { id: 'd', tenancyId: 't1', date: '2025-01-05', kind: 'received', amountCents: 240000 }
  assert.equal(suggest(tx('2026-03-10', -12000), settled([{ dueCents: -12000 }], null, { tenancies: [ended], depositEntries: [received] }))?.reason, 'Betrag wie das offene Guthaben aus der Abrechnung 2025')
  assert.deepEqual(suggest(tx('2026-03-10', -240000), settled([{ dueCents: -12000 }], null, { tenancies: [ended], depositEntries: [received] }))?.target, { type: 'deposit', kind: 'refunded' }, 'Betrag wie die Kaution')
  assert.equal(suggest(tx('2026-03-10', -10000), settled([{ dueCents: -12000 }], null))?.reason, 'Auszahlung an den Mieter, etwa ein Guthaben aus der Abrechnung', 'anderer Betrag: wie bisher')
})

test('#308: nach einer Teilzahlung nur beim genauen Rest', () => {
  assert.match(suggest(tx('2026-04-10', 20000), settled([{ openCents: 20000 }]))?.reason ?? '', /offene Nachzahlung aus der Abrechnung 2025/)
  assert.deepEqual(suggest(tx('2026-04-10', 30000), settled([{ openCents: 20000 }]))?.target, RENT)
})

test('#308: zwei offene Abrechnungen: ein Vorschlag nur, wenn genau eine passt', () => {
  const y2024 = { key: 'h|2024-01|t1', label: 'Abrechnung 2024', periodTo: '2024-12-31', dueCents: 30000 }
  assert.deepEqual(suggest(tx('2026-03-10', 30000), settled([{}, y2024]))?.target, RENT, 'beide gleich hoch')
  assert.match(suggest(tx('2026-03-10', 20000), settled([{}, { ...y2024, dueCents: 20000 }]))?.reason ?? '', /Abrechnung 2024/)
  assert.match(suggest(tx('2026-03-10', 30000), settled([{}, { ...y2024, dueCents: 20000 }]))?.reason ?? '', /Abrechnung 2025/)
  assert.deepEqual(suggest(tx('2026-03-02', 110000), settled([{}, { ...y2024, dueCents: 110000 }], UNPAID_MONTH))?.target, RENT, 'die eine genau, die andere mit der Miete')
})

test('#308: nicht vor dem Ende des Zeitraums und nicht vor dem Versand; Monatsmiete und Kaution im Zweck bleiben wie bisher', () => {
  assert.deepEqual(suggest(tx('2025-12-20', 30000), settled())?.target, RENT)
  assert.deepEqual(suggest(tx('2026-02-10', 30000), settled([{ sentAt: '2026-02-15' }]))?.target, RENT)
  assert.match(suggest(tx('2026-02-15', 30000), settled([{ sentAt: '2026-02-15' }]))?.reason ?? '', /Nachzahlung/)
  assert.equal(suggest(tx('2026-03-02', 80000), settled([{ dueCents: 80000 }]))?.light, 'green', 'gleich dem Soll: Miete')
  assert.deepEqual(suggest(tx('2026-03-10', 30000, { purpose: 'Kaution Rest' }), settled())?.target, RENT)
})

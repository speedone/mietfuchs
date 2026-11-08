// „Offene Monate als bezahlt erfassen“ (#608, server/src/markPaid.ts): der Plan je Mietverhältnis und Monat aus dem
// Mietkonto, die Nachprüfung auf dem Schnappschuss mit den neuen Zahlungen und die Mietverhältnisse, bei denen rückwirkende
// Zahlungen Monate neu zählen lassen (Beginn der Erfassung im Objekt, rentAllocation.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rentLedger } from '../src/calc.ts'
import { snapshotOf, type SnapshotPayment, type SnapshotSource, type SnapshotTenancy } from '../src/snapshot.ts'
import type { Snapshot } from '../src/snapshot.ts'
import { markPaidRequestOf, markPaidToken, markPaidWrites, planMarkPaid } from '../src/markPaid.ts'
import { rentDueOn, rentPaidOn } from '../../shared/rentDue.ts'
import type { FederalState, MarkPaidPayment } from '../../shared/types.ts'

// 800 € im Monat: 600 € Kaltmiete, 200 € Vorauszahlung.
const tenancy = (id: string, over: Partial<SnapshotTenancy> = {}): SnapshotTenancy => ({
  id, unitId: `u-${id}`, tenantName: `Mieter ${id}`, persons: 1, personHistory: [], start: '2025-01-01', end: null,
  prepayments: [{ from: '2025-01', monthlyCents: 20000 }], prepaymentOverrides: {},
  baseRents: [{ from: '2025-01', monthlyCents: 60000 }], ...over,
})
let seq = 0
const pay = (tenancyId: string, date: string, amountCents: number, over: Partial<SnapshotPayment> = {}): SnapshotPayment =>
  ({ id: `p${String(++seq).padStart(4, '0')}`, tenancyId, date, amountCents, kind: 'rent', ...over })

const snapshot = (tenancies: SnapshotTenancy[], payments: SnapshotPayment[], year = 2025, state: FederalState | null = 'NW'): Snapshot => {
  const source: SnapshotSource = {
    units: tenancies.map((t) => ({ id: t.unitId, name: `Wohnung ${t.id}`, areaM2: 50, participates: true })),
    tenancies, costItems: [], meters: [], readings: [], payments, closedSettlements: [],
  }
  return { ...snapshotOf(source, year), property: { kind: 'mfh', cableBuiltBeforeDec2021: false, state } }
}
const plan = (s: Snapshot, asOf: string, tenancyIds: string[], through: string) => planMarkPaid(s, { asOf }, { tenancyIds, through })
const months = (payments: readonly MarkPaidPayment[]) => payments.map((p) => [p.tenancyId, p.month, p.date, p.amountCents])
const withPlan = (s: Snapshot, payments: readonly MarkPaidPayment[]): Snapshot => ({
  ...s,
  payments: [...s.payments, ...payments.map((p, i) => ({ id: `neu${i}`, tenancyId: p.tenancyId, date: p.date, amountCents: p.amountCents, kind: 'rent' as const, designatedMonth: p.month }))],
})

test('Plan: alle offenen Monate bis „Bis Monat“, Betrag = Soll, Datum = Fälligkeitstag in NRW', () => {
  const s = snapshot([tenancy('a')], [])
  const p = plan(s, '2025-06-20', ['a'], '2025-04')
  assert.deepEqual(months(p.payments), [
    ['a', '2025-01', '2025-01-06', 80000],
    ['a', '2025-02', '2025-02-05', 80000],
    ['a', '2025-03', '2025-03-05', 80000],
    ['a', '2025-04', '2025-04-03', 80000],
  ])
  assert.equal(p.totalCents, 320000)
  assert.deepEqual(p.unresolved, [])
  assert.deepEqual(p.othersAffected, [])
  assert.equal(p.payments[0]?.tenantName, 'Mieter a')
  assert.equal(p.payments[0]?.unitName, 'Wohnung a')
})

test('Plan: ein teilweise bezahlter Monat bekommt den Rest, ein bezahlter und ein später bezahlter keinen', () => {
  // Januar voll, Februar 300 € für Februar, März erst im Folgejahr für März bezahlt.
  const payments = [pay('a', '2025-01-03', 80000), pay('a', '2025-02-04', 30000, { designatedMonth: '2025-02' }), pay('a', '2026-01-10', 80000, { designatedMonth: '2025-03' })]
  const p = plan(snapshot([tenancy('a')], payments), '2026-02-01', ['a'], '2025-04')
  assert.deepEqual(months(p.payments), [
    ['a', '2025-02', '2025-02-05', 50000],
    ['a', '2025-04', '2025-04-03', 80000],
  ])
})

test('Plan: im Einzugsmonat anteilig und ab dem dritten Werktag nach Einzug, nach dem Auszug nichts', () => {
  const t = tenancy('a', { start: '2025-03-15', end: '2025-05-20', prepayments: [{ from: '2025-03', monthlyCents: 20000 }], baseRents: [{ from: '2025-03', monthlyCents: 60000 }] })
  const s = snapshot([t], [])
  const p = plan(s, '2025-07-01', ['a'], '2025-06')
  const row = rentLedger(s, { asOf: '2025-07-01' }).rows[0] ?? assert.fail('keine Zeile')
  assert.deepEqual(months(p.payments), [
    ['a', '2025-03', '2025-03-19', row.months[2]?.sollCents],
    ['a', '2025-04', '2025-04-03', 80000],
    ['a', '2025-05', '2025-05-06', row.months[4]?.sollCents],
  ])
  assert.ok((row.months[2]?.sollCents ?? 0) < 80000, 'März anteilig')
})

test('Plan: Datum nie nach heute, „nach Ablauf“ höchstens der Monatsletzte, ohne Land der späteste Tag aller Länder', () => {
  const old = tenancy('a', { start: '2025-01-01', rentDue: 'inArrears' })
  const p = plan(snapshot([old], []), '2025-03-02', ['a'], '2025-03')
  assert.deepEqual(p.payments.map((x) => x.date), ['2025-01-31', '2025-02-28', '2025-03-02'])
  const noState = snapshot([tenancy('b')], [], 2025, null)
  const q = plan(noState, '2025-02-20', ['b'], '2025-01')
  assert.equal(q.payments[0]?.date, rentDueOn(tenancy('b'), '2025-01', null), 'Heilige Drei Könige in Bayern: 07.01.')
  assert.equal(q.payments[0]?.date, '2025-01-07')
})

test('rentPaidOn: Fälligkeitstag, höchstens Monatsletzter und heute', () => {
  assert.equal(rentPaidOn('2025-03', '2025-03-05', '2025-06-01'), '2025-03-05')
  assert.equal(rentPaidOn('2025-12', '2026-01-02', '2026-02-01'), '2025-12-31')
  assert.equal(rentPaidOn('2025-03', '2025-03-05', '2025-03-02'), '2025-03-02')
})

test('Plan: nur die gewählten Mietverhältnisse, leerer Plan ist kein Fehler', () => {
  const s = snapshot([tenancy('a'), tenancy('b')], [pay('a', '2025-01-03', 80000), pay('b', '2025-01-03', 80000)])
  assert.deepEqual(plan(s, '2025-03-01', ['b'], '2025-02').payments.map((x) => x.tenancyId), ['b'])
  const empty = plan(s, '2025-03-01', ['a'], '2025-01')
  assert.deepEqual(empty.payments, [])
  assert.equal(empty.totalCents, 0)
})

// 2024 seit Januar, Dezember 2024 offen (Übertrag).
const since2024 = tenancy('a', { start: '2024-01-01', prepayments: [{ from: '2024-01', monthlyCents: 20000 }], baseRents: [{ from: '2024-01', monthlyCents: 60000 }] })
const year2024 = (): SnapshotPayment[] => Array.from({ length: 11 }, (_, i) => pay('a', `2024-${String(i + 1).padStart(2, '0')}-03`, 80000))
// Am 05.06. ist der Juni noch kein Rückstand.
const JUNE_5 = '2025-06-05'

test('Nachprüfung: danach ist jeder geplante Monat bezahlt, mit Übertrag aus dem Vorjahr und einer Zahlung ohne Monat vor dem Fälligkeitstag', () => {
  // Am 02.01. 800 € ohne Monat: zuerst die Vorauszahlungen Dezember und Januar, dann 400 € Kaltmiete Dezember.
  const s = snapshot([since2024], [...year2024(), pay('a', '2025-01-02', 80000)])
  const p = plan(s, JUNE_5, ['a'], '2025-05')
  assert.deepEqual(p.payments.map((x) => [x.month, x.amountCents]), [['2025-01', 60000], ['2025-02', 80000], ['2025-03', 80000], ['2025-04', 80000], ['2025-05', 80000]])
  assert.deepEqual(p.unresolved, [])
  const after = rentLedger(withPlan(s, p.payments), { asOf: JUNE_5 }).rows[0] ?? assert.fail('keine Zeile')
  assert.deepEqual(after.months.slice(0, 5).map((m) => m.status), ['paid', 'paid', 'paid', 'paid', 'paid'])
  assert.equal(after.arrearsCents, 20000, 'offen bleibt der Rest der Kaltmiete Dezember 2024')
})

test('Nachprüfung: Hat eine Zahlung ohne Monat nach dem Fälligkeitstag einen Teil getilgt, wandert der Rest; die Monate stehen in unresolved', () => {
  // Am 10.03. 800 € ohne Monat: die Vorauszahlungen Dezember bis März, die älteste zuerst. Die neuen Zahlungen liegen
  // davor und tilgen deshalb zuerst die Vorauszahlung ihres Monats; die Zahlung vom 10.03. geht danach an den Dezember.
  const s = snapshot([since2024], [...year2024(), pay('a', '2025-03-10', 80000)])
  const before = rentLedger(s, { asOf: JUNE_5 }).rows[0] ?? assert.fail('keine Zeile')
  assert.deepEqual(before.months.slice(0, 3).map((m) => m.status), ['partial', 'partial', 'partial'])
  const p = plan(s, JUNE_5, ['a'], '2025-05')
  assert.deepEqual(p.payments.map((x) => [x.month, x.amountCents]), [['2025-01', 60000], ['2025-02', 60000], ['2025-03', 60000], ['2025-04', 80000], ['2025-05', 80000]])
  assert.deepEqual(p.unresolved.map((u) => [u.month, u.status, u.openCents]), [['2025-01', 'partial', 20000], ['2025-02', 'partial', 20000], ['2025-03', 'partial', 20000]])
  // Kein Cent verloren: Rückstand vorher − geplant = Rückstand nachher.
  const after = rentLedger(withPlan(s, p.payments), { asOf: JUNE_5 }).rows[0] ?? assert.fail('keine Zeile')
  assert.equal(after.arrearsCents, before.arrearsCents - p.totalCents)
  assert.equal(after.arrearsCents, 60000)
})

test('Nachprüfung: eine Staffel unter 0 ist keine Forderung; der Rest Soll − gezahlt deckt den Monat nicht, er steht in unresolved', () => {
  // Kaltmiete 600 €, Vorauszahlung −50 €: Soll 550 €, gefordert sind 600 € (rentAllocation.ts, `claimOf`).
  const t = tenancy('a', { prepayments: [{ from: '2025-01', monthlyCents: -5000 }] })
  const p = plan(snapshot([t], []), '2025-05-20', ['a'], '2025-02')
  assert.deepEqual(p.payments.map((x) => [x.month, x.amountCents]), [['2025-01', 55000], ['2025-02', 55000]])
  assert.deepEqual(p.unresolved.map((u) => [u.month, u.status, u.openCents]), [['2025-01', 'partial', 5000], ['2025-02', 'partial', 5000]])
})

test('othersAffected: Zahlungen im Objekt erst ab Juni, ein Mietverhältnis rückwirkend ab Januar, beim anderen zählen Januar bis Mai neu', () => {
  const payments = ['06', '07'].flatMap((m) => [pay('a', `2025-${m}-03`, 80000), pay('b', `2025-${m}-03`, 80000)])
  const s = snapshot([tenancy('a'), tenancy('b')], payments)
  // Am 02.07. ist der Juli noch nicht fällig.
  const asOf = '2025-07-02'
  const before = rentLedger(s, { asOf }).rows.find((r) => r.tenancyId === 'b') ?? assert.fail('keine Zeile b')
  assert.equal(before.months[0]?.status, 'notRecorded')
  assert.equal(before.arrearsCents, 0)
  const p = plan(s, asOf, ['a'], '2025-05')
  assert.deepEqual(p.payments.map((x) => x.month), ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05'], 'nicht erfasst zählt mit dem ganzen Soll')
  assert.deepEqual(p.unresolved, [])
  assert.deepEqual(p.othersAffected, [{ tenancyId: 'b', tenantName: 'Mieter b', unitName: 'Wohnung b', beforeCents: 0, afterCents: 340000 }])
  // Die Juni- und Julizahlung von b tilgen danach zuerst die Vorauszahlungen Januar bis Juli, dann 400 € Kaltmiete Januar;
  // Rückstand sind Januar bis Juni: 4.800 € Soll − 1.400 € (der Juli ist noch nicht fällig).
  // Für beide zusammen: niemand verliert.
  assert.deepEqual(plan(s, asOf, ['a', 'b'], '2025-05').othersAffected, [])
})

test('othersAffected: auch ein gewähltes Mietverhältnis, dessen Monate nach „Bis Monat“ neu zählen', () => {
  const payments = [pay('a', '2025-06-03', 80000)]
  const s = snapshot([tenancy('a')], payments)
  // Die Junizahlung tilgt danach den April; Mai und Juni sind Rückstand.
  const p = plan(s, '2025-07-02', ['a'], '2025-03')
  assert.deepEqual(p.othersAffected, [{ tenancyId: 'a', tenantName: 'Mieter a', unitName: 'Wohnung a', beforeCents: 0, afterCents: 160000 }])
})

test('Marke: über Anfrage und Plan; ändert sich der Bestand, ändert sie sich', () => {
  const s = snapshot([tenancy('a')], [])
  const request = { tenancyIds: ['a'], through: '2025-03' }
  const p = planMarkPaid(s, { asOf: '2025-06-01' }, request)
  assert.equal(markPaidToken(request, p), markPaidToken(request, planMarkPaid(s, { asOf: '2025-06-01' }, request)))
  assert.notEqual(markPaidToken(request, p), markPaidToken({ ...request, through: '2025-02' }, p))
  const changed = planMarkPaid(snapshot([tenancy('a')], [pay('a', '2025-02-03', 80000)]), { asOf: '2025-06-01' }, request)
  assert.notEqual(markPaidToken(request, p), markPaidToken(request, changed))
})

test('Schreibliste: Miete für den Monat laut Verwendungszweck, mit Notiz', () => {
  const p = plan(snapshot([tenancy('a')], []), '2025-02-20', ['a'], '2025-01')
  assert.deepEqual(markPaidWrites(p.payments), [{ tenancyId: 'a', date: '2025-01-06', amountCents: 80000, kind: 'rent', designatedMonth: '2025-01', note: 'als bezahlt erfasst' }])
})

test('Anfrage: Bis Monat im Jahr und nicht nach dem laufenden Monat, Mietverhältnisse nicht leer und des Objekts', () => {
  const known = new Set(['a', 'b'])
  const ok = markPaidRequestOf(2025, { tenancyIds: ['a'], through: '2025-03' }, '2025-06-01', known)
  assert.deepEqual(ok, { request: { tenancyIds: ['a'], through: '2025-03' } })
  const error = (body: unknown, today = '2025-06-01') => {
    const r = markPaidRequestOf(2025, body, today, known)
    return 'error' in r ? r.error : assert.fail('keine Ablehnung')
  }
  assert.match(error({ tenancyIds: ['a'], through: '2024-12' }), /im Jahr 2025/)
  assert.match(error({ tenancyIds: ['a'], through: 'März' }), /JJJJ-MM/)
  assert.match(error({ tenancyIds: ['a'], through: '2025-07' }), /nach dem laufenden Monat/)
  assert.match(error({ tenancyIds: [], through: '2025-03' }), /Wählen Sie/)
  assert.match(error({ through: '2025-03' }), /Wählen Sie/)
  assert.match(error({ tenancyIds: ['x'], through: '2025-03' }), /gehört nicht zu diesem Objekt/)
})

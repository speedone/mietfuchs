// Die Art einer Zahlung (#280): Miete verteilt das Mietkonto auf die Monate, Nachzahlung und Guthaben
// aus der Abrechnung führt es gesondert. Für die Steuer bleiben beide Einnahmen nach dem
// Zuflussprinzip, die aus der Abrechnung stehen zusätzlich gesondert da.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, rentLedger, taxReport } from '../src/calc.ts'
import { snapshotOf, type SnapshotPayment, type SnapshotSource, type SnapshotTenancy } from '../src/snapshot.ts'
import { calendarPeriod } from '../../shared/period.ts'
import type { RentLedgerRow, TaxReport } from '../../shared/types.ts'

// Kennungen der Zahlungen (#281: Die Tilgung braucht sie als Nachrang beim Sortieren).
let paymentSeq = 0
const pid = (): string => `p${String(++paymentSeq).padStart(4, '0')}`


// Ab 01.01.2025, 800 € im Monat (650 € kalt, 150 € Vorauszahlung).
const tenancy = (over: Partial<SnapshotTenancy> = {}): SnapshotTenancy => ({
  id: 't', unitId: 'a', tenantName: 'Mieter', persons: 1, personHistory: [], start: '2025-01-01', end: null,
  prepayments: [{ from: '2025-01', monthlyCents: 15000 }], prepaymentOverrides: {},
  baseRents: [{ from: '2025-01', monthlyCents: 65000 }], ...over,
})
const rentAllYear = (tenancyId = 't', year = 2025): SnapshotPayment[] =>
  Array.from({ length: 12 }, (_, i) => ({ id: pid(), tenancyId, date: `${year}-${String(i + 1).padStart(2, '0')}-03`, amountCents: 80000, kind: 'rent' }))

const source = (s: Partial<SnapshotSource>): SnapshotSource => ({
  units: [{ id: 'a', name: 'EG', areaM2: 50, participates: true }],
  tenancies: [tenancy()],
  costItems: [{ id: 'g', period: calendarPeriod(2025), category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 73056, key: 'area' }],
  meters: [], readings: [], payments: [], closedSettlements: [], ...s,
})
const rowOf = (rows: RentLedgerRow[], id = 't'): RentLedgerRow => rows.find((r) => r.tenancyId === id) ?? assert.fail(`keine Zeile ${id}`)

test('Issue #280: Guthaben −200 € im Juni als Abrechnung, der Dezember bleibt bezahlt', () => {
  const payments: SnapshotPayment[] = [...rentAllYear(), { id: pid(), tenancyId: 't', date: '2025-06-15', amountCents: -20000, kind: 'settlement' }]
  const l = rentLedger(snapshotOf(source({ payments }), 2025))
  const r = rowOf(l.rows)
  assert.equal(r.months[11]?.status, 'paid')
  assert.equal(r.paidYearCents, 960000)
  assert.equal(r.settlementYearCents, -20000)
  assert.equal(r.balanceCents, 0)
  assert.equal(r.arrearsCents, 0)
  assert.equal(l.totals.settlementYearCents, -20000)
  assert.equal(l.totals.openCents, 0)
})

test('Gegenprobe: dasselbe Guthaben als Miete gebucht lässt den Dezember offen (so war es vor #280)', () => {
  const payments: SnapshotPayment[] = [...rentAllYear(), { id: pid(), tenancyId: 't', date: '2025-06-15', amountCents: -20000, kind: 'rent' }]
  const r = rowOf(rentLedger(snapshotOf(source({ payments }), 2025)).rows)
  assert.equal(r.months[11]?.status, 'partial')
  assert.equal(r.arrearsCents, 20000)
})

test('Issue #280: Nachzahlung 150 € im März als Abrechnung ist keine Überzahlung', () => {
  const payments: SnapshotPayment[] = [...rentAllYear(), { id: pid(), tenancyId: 't', date: '2025-03-20', amountCents: 15000, kind: 'settlement' }]
  const r = rowOf(rentLedger(snapshotOf(source({ payments }), 2025)).rows)
  assert.equal(r.balanceCents, 0)
  assert.equal(r.settlementYearCents, 15000)
  assert.ok(r.months.every((m) => m.paidCents === m.sollCents), 'kein Monat über- oder unterdeckt')
})

test('Eine Zahlung ohne Art ist Miete (db.json, eingefrorener Eingang)', () => {
  const ohneArt: SnapshotPayment[] = rentAllYear().map(({ kind: _, ...p }) => p)
  const mitArt = rentAllYear()
  const a = rentLedger(snapshotOf(source({ payments: [...ohneArt, { id: pid(), tenancyId: 't', date: '2025-06-15', amountCents: -20000 }] }), 2025))
  const b = rentLedger(snapshotOf(source({ payments: [...mitArt, { id: pid(), tenancyId: 't', date: '2025-06-15', amountCents: -20000, kind: 'rent' }] }), 2025))
  assert.deepEqual(a, b)
  assert.equal(rowOf(a.rows).settlementYearCents, 0)
})

test('Nachzahlung nach dem Auszug: im Folgejahr gesondert geführt, ohne eigene Zeile', () => {
  const t = tenancy({ end: '2025-12-31' })
  const payments: SnapshotPayment[] = [...rentAllYear(), { id: pid(), tenancyId: 't', date: '2026-04-10', amountCents: 12345, kind: 'settlement' }]
  const l = rentLedger(snapshotOf(source({ tenancies: [t], payments }), 2026))
  assert.equal(l.rows.length, 0)
  assert.deepEqual(l.settlementOnly, [{ tenancyId: 't', tenantName: 'Mieter', unitName: 'EG', settlementYearCents: 12345 }])
  assert.equal(l.totals.settlementYearCents, 12345)
  // Ohne Zahlung aus der Abrechnung steht dort nichts.
  assert.deepEqual(rentLedger(snapshotOf(source({ tenancies: [t], payments: rentAllYear() }), 2026)).settlementOnly, [])
})

test('Steuer: beide Arten sind Zufluss, die aus der Abrechnung stehen nach Richtung gesondert da', () => {
  const t2 = tenancy({ id: 't2', unitId: 'b', tenantName: 'Zweiter' })
  const payments: SnapshotPayment[] = [
    ...rentAllYear(), ...rentAllYear('t2'),
    { id: pid(), tenancyId: 't', date: '2025-05-02', amountCents: 15000, kind: 'settlement' },
    { id: pid(), tenancyId: 't2', date: '2025-05-20', amountCents: -20000, kind: 'settlement' },
  ]
  const units = [{ id: 'a', name: 'EG', areaM2: 50, participates: true }, { id: 'b', name: 'OG', areaM2: 50, participates: true }]
  const r = taxReport(snapshotOf(source({ units, tenancies: [tenancy(), t2], payments }), 2025))
  assert.equal(r.income.paidCents, 2 * 960000 + 15000 - 20000)
  assert.equal(r.income.settlementBackPaymentsCents, 15000)
  assert.equal(r.income.settlementRefundsCents, 20000)
  // Das Soll kennt sie nicht.
  assert.equal(r.income.sollCents, 2 * 960000)
})

test('Steuer: Wer nur die Nachzahlung erfasst hat, hat keine Miete erfasst', () => {
  const payments: SnapshotPayment[] = [{ id: pid(), tenancyId: 't', date: '2025-05-02', amountCents: 15000, kind: 'settlement' }]
  const r = taxReport(snapshotOf(source({ payments }), 2025))
  assert.equal(r.income.tenanciesWithSoll, 1)
  assert.equal(r.income.tenanciesWithoutPayment, 1)
})

test('Abrechnung: Zahlungen nur aus der Abrechnung führen kein Mietkonto, also kein Hinweis auf Rückstand', () => {
  const payments: SnapshotPayment[] = [{ id: pid(), tenancyId: 't', date: '2025-05-02', amountCents: 15000, kind: 'settlement' }]
  const s = computeSettlement(snapshotOf(source({ payments }), 2025))
  assert.equal(s.notices.filter((n) => n.code === 'prepayment.arrears').length, 0)
  // Gegenprobe: dieselbe Zahlung als Miete führt das Mietkonto, der Rest ist offen.
  const rent = computeSettlement(snapshotOf(source({ payments: [{ ...payments[0]!, kind: 'rent' }] }), 2025))
  assert.equal(rent.notices.filter((n) => n.code === 'prepayment.arrears').length, 1)
})

test('Zusammenspiel mit #311: Einzug am 15.03., anteiliges Soll im März, Nachzahlung als Abrechnung', () => {
  // 800 € im Monat (650 € kalt, 150 € Vorauszahlung); der März zählt mit 17/31 Tagen.
  const t = tenancy({ start: '2025-03-15' })
  const march = { id: pid(), tenancyId: 't', date: '2025-03-20', amountCents: 35645 + 8226, kind: 'rent' as const }
  const later: SnapshotPayment[] = Array.from({ length: 9 }, (_, i) => ({
    id: pid(), tenancyId: 't', date: `2025-${String(i + 4).padStart(2, '0')}-03`, amountCents: 80000, kind: 'rent' as const,
  }))
  const backPayment: SnapshotPayment = { id: pid(), tenancyId: 't', date: '2025-11-10', amountCents: 15000, kind: 'settlement' }
  const snap = snapshotOf(source({ tenancies: [t], payments: [march, ...later, backPayment] }), 2025)
  const r = rowOf(rentLedger(snap).rows)
  const m = r.months[2] ?? assert.fail('kein März')
  assert.deepEqual(m.share, { days: 17, of: 31 })
  assert.equal(m.sollCents, 35645 + 8226)
  assert.equal(r.sollYearCents, 35645 + 8226 + 9 * 80000)
  // Die Nachzahlung füllt keinen Monat auf und ist keine Überzahlung.
  assert.equal(r.paidYearCents, r.sollYearCents)
  assert.equal(r.balanceCents, 0)
  assert.equal(r.arrearsCents, 0)
  assert.equal(r.settlementYearCents, 15000)
  assert.ok(r.months.every((mo) => mo.status === 'paid'))
  // Die Abrechnung setzt dieselbe anteilige Vorauszahlung an und meldet keinen Rückstand.
  const s = computeSettlement(snap)
  const st = s.statements.find((x) => x.tenancyId === 't') ?? assert.fail('keine Abrechnung')
  assert.equal(st.prepaymentCents, 8226 + 9 * 15000)
  assert.equal(s.notices.filter((n) => n.code === 'prepayment.arrears').length, 0)
  // Steuer: Zufluss beider Arten, Soll anteilig.
  const tax = taxReport(snap)
  assert.equal(tax.income.paidCents, r.sollYearCents + 15000)
  assert.equal(tax.income.sollCents, r.sollYearCents)
  assert.equal(tax.income.settlementBackPaymentsCents, 15000)
  // Gegenprobe: als Miete gebucht wäre sie eine Überzahlung.
  const asRent = rowOf(rentLedger(snapshotOf(source({ tenancies: [t], payments: [march, ...later, { ...backPayment, kind: 'rent' }] }), 2025)).rows)
  assert.equal(asRent.balanceCents, 15000)
})

// Invariante: Zahlungen aus der Abrechnung ändern am Mietkonto nichts außer ihrer eigenen Summe, und
// an der Steuer nur den Zufluss um genau ihre Summe. Zufällige Bestände mit festem Startwert.
function makeRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

test('Invariante: Zahlungen aus der Abrechnung verschieben im Mietkonto nichts und in der Steuer nur den Zufluss', () => {
  const rnd = makeRng(280)
  let formerSeen = 0
  for (let run = 0; run < 200; run++) {
    const tenancies: SnapshotTenancy[] = Array.from({ length: 1 + Math.floor(rnd() * 4) }, (_, i) => {
      const startMonth = 1 + Math.floor(rnd() * 12)
      // Durchsicht N4: auch Mietverhältnisse, die im Vorjahr enden; ihre Zahlungen aus der Abrechnung
      // laufen über `settlementOnly`.
      if (rnd() < 0.3) {
        return tenancy({
          id: `t${i}`, unitId: 'a', tenantName: `M${i}`, start: '2023-01-01',
          end: `2024-${String(startMonth).padStart(2, '0')}-28`,
          baseRents: [{ from: '2023-01', monthlyCents: 30000 + Math.floor(rnd() * 70000) }],
        })
      }
      const ends = rnd() < 0.4
      return tenancy({
        id: `t${i}`, unitId: 'a', tenantName: `M${i}`,
        // Auch zur Monatsmitte (#311): Das anteilige Soll im Ein- und Auszugsmonat darf am Befund
        // nichts ändern.
        start: `2025-${String(startMonth).padStart(2, '0')}-${String(rnd() < 0.5 ? 1 : 2 + Math.floor(rnd() * 27)).padStart(2, '0')}`,
        end: ends ? `2025-${String(Math.max(startMonth, 1 + Math.floor(rnd() * 12))).padStart(2, '0')}-28` : null,
        baseRents: [{ from: '2025-01', monthlyCents: 30000 + Math.floor(rnd() * 70000) }],
      })
    })
    const date = () => `2025-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}`
    const rent: SnapshotPayment[] = tenancies.flatMap((t) => Array.from({ length: Math.floor(rnd() * 14) }, () => ({
      id: pid(), tenancyId: t.id, date: date(), amountCents: Math.floor(rnd() * 120000) - 10000, kind: 'rent' as const,
    })))
    const settlement: SnapshotPayment[] = tenancies.flatMap((t) => Array.from({ length: Math.floor(rnd() * 3) }, () => ({
      id: pid(), tenancyId: t.id, date: date(), amountCents: Math.floor(rnd() * 60000) - 30000, kind: 'settlement' as const,
    })))
    const without = snapshotOf(source({ tenancies, payments: rent }), 2025)
    const withIt = snapshotOf(source({ tenancies, payments: [...rent, ...settlement] }), 2025)
    const a = rentLedger(without)
    const b = rentLedger(withIt)
    const strip = (r: RentLedgerRow) => ({ ...r, settlementYearCents: 0 })
    assert.deepEqual(b.rows.map(strip), a.rows.map(strip), `Lauf ${run}: Monate verschoben`)
    const sum = settlement.reduce((x, p) => x + p.amountCents, 0)
    // Die Summe aller Zahlungen aus der Abrechnung im Jahr, über Zeilen und `settlementOnly` zusammen.
    assert.equal(b.totals.settlementYearCents, sum, `Lauf ${run}`)
    assert.equal(b.rows.reduce((x, r) => x + r.settlementYearCents, 0) + b.settlementOnly.reduce((x, r) => x + r.settlementYearCents, 0), sum, `Lauf ${run}`)
    assert.deepEqual(a.settlementOnly, [], `Lauf ${run}`)
    for (const r of b.settlementOnly) assert.ok(!b.rows.some((x) => x.tenancyId === r.tenancyId), `Lauf ${run}: ${r.tenancyId} doppelt`)
    assert.deepEqual({ ...b.totals, settlementYearCents: 0 }, { ...a.totals, settlementYearCents: 0 }, `Lauf ${run}`)
    if (b.settlementOnly.length > 0) formerSeen++
    const ta = taxReport(without)
    const tb = taxReport(withIt)
    assert.equal(tb.income.paidCents - ta.income.paidCents, sum, `Lauf ${run}`)
    assert.equal(tb.income.settlementBackPaymentsCents - tb.income.settlementRefundsCents, sum, `Lauf ${run}`)
    assert.equal(ta.income.settlementBackPaymentsCents + ta.income.settlementRefundsCents, 0, `Lauf ${run}`)
    // Das Zugeflossene nach Zeilen (#312 PR 2): Die Zahlungen aus der Abrechnung gehen nicht durch die Tilgung, sie ändern
    // nur Zeile 21 (`settlementCents` je Mietverhältnis, Wohnung und Angehörige).
    const noSettlement = (x: TaxReport['income']): TaxReport['income'] => {
      const r = x.received ?? assert.fail('received fehlt')
      // Ein Mietverhältnis mit nur Zahlungen aus der Abrechnung steht mit ihnen allein da (und mit ihm seine Wohnung).
      const byTenancy = r.byTenancy.filter((t) => rent.some((p) => p.tenancyId === t.tenancyId))
      // Zeile 32 (Durchsicht von PR 3, S1) enthält den Saldo der Abrechnung, sonst nichts davon.
      return { ...x, paidCents: 0, settlementBackPaymentsCents: 0, settlementRefundsCents: 0, received: { ...r, totalCents: r.totalCents - (x.settlementBackPaymentsCents - x.settlementRefundsCents),
        byTenancy: byTenancy.map((t) => ({ ...t, settlementCents: 0 })),
        byUnit: r.byUnit.filter((u) => byTenancy.some((t) => t.unitId === u.unitId)).map((u) => ({ ...u, settlementCents: 0 })), relatives: { ...r.relatives, settlementCents: 0 } } }
    }
    assert.equal(tb.income.received?.byTenancy.reduce((x, t) => x + t.settlementCents, 0), sum, `Lauf ${run}`)
    assert.deepEqual(noSettlement(tb.income), noSettlement(ta.income), `Lauf ${run}`)
    assert.deepEqual(tb.expenses, ta.expenses, `Lauf ${run}`)
  }
  // Der Pfad über `settlementOnly` muss wirklich vorkommen, sonst prüfte die Invariante ihn nicht.
  assert.ok(formerSeen > 20, `nur ${formerSeen} Läufe mit früheren Mietverhältnissen`)
})

// Durchsicht zu #328: Ohne Erstattungen ergab das Negieren einer leeren Summe −0. `assert.equal` im
// strengen Modus vergleicht mit Object.is und unterscheidet −0 von 0.
test('Steuer: ohne Zahlungen aus der Abrechnung sind Nachzahlungen und Erstattungen 0, nicht −0', () => {
  const r = taxReport(snapshotOf(source({ payments: rentAllYear() }), 2025))
  assert.equal(r.income.settlementBackPaymentsCents, 0)
  assert.equal(r.income.settlementRefundsCents, 0)
  const nurNachzahlung = taxReport(snapshotOf(source({ payments: [...rentAllYear(), { id: pid(), tenancyId: 't', date: '2025-04-01', amountCents: 15000, kind: 'settlement' }] }), 2025))
  assert.equal(nurNachzahlung.income.settlementRefundsCents, 0)
})

// Durchsicht zu #328: Die Abrechnung setzt die Vorauszahlungen aus Staffel und Jahreskorrektur an, nie
// aus den Zahlungen. Eine Nachzahlung oder ein Guthaben der Vorjahresabrechnung darf an ihr nichts ändern.
test('Abrechnung: Zahlungen der Art „Abrechnung“ ändern keinen Betrag von computeSettlement', () => {
  const ohne = computeSettlement(snapshotOf(source({ payments: rentAllYear() }), 2025))
  for (const extra of [
    [{ id: pid(), tenancyId: 't', date: '2025-06-15', amountCents: -20000, kind: 'settlement' }],
    [{ id: pid(), tenancyId: 't', date: '2025-03-20', amountCents: 15000, kind: 'settlement' }, { id: pid(), tenancyId: 't', date: '2025-11-02', amountCents: -4711, kind: 'settlement' }],
  ] satisfies SnapshotPayment[][]) {
    const mit = computeSettlement(snapshotOf(source({ payments: [...rentAllYear(), ...extra] }), 2025))
    assert.deepEqual(mit, ohne)
  }
})

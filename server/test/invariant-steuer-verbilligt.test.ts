// Invariante der verbilligten Vermietung (#257) über Zufallsbestände mit festem Startwert: eigene und vermietete
// Wohnungen, verbilligte und übliche Mieten, Mieterwechsel, Gutschriften, direkte Zuordnung und Teilnehmer.
//
// (v1) je Position: privat + unentgeltlich + abziehbar = Betrag; der unentgeltliche Teil hat das Vorzeichen des
//      abziehbaren und ist nie größer als der abziehbare Teil vor der Kürzung (keine Doppelkürzung mit dem Privaten);
// (v2) der private Teil ist derselbe wie ohne Eintrag der ortsüblichen Miete;
// (v3) ohne Eintrag ist die ganze Steuerübersicht dieselbe wie ohne das Feld, und es gibt keinen unentgeltlichen Teil;
// (v4) gekürzt wird nur bei einer Quote unter der Grenze von Satz 1, und höchstens um Betrag × Σ (1 − Quote);
// (v5) die Summen: abziehbar = Bruttosumme − privat − unentgeltlich, und der Überschuss rechnet damit;
// (v7) je Wohnung ist der unentgeltliche Anteil min(1, Σ (1 − Quote) × Tage / Tage des Jahres) über die
//      Mietverhältnisse mit Urteil `split`, hier aus Entgelt und Vergleichsmiete selbst gerechnet;
// (v6) direkt an Dritte gezahlte Kosten (#257) ändern weder Bruttosumme, privaten Teil noch Einnahmen, und mehr davon
//      kürzt nie mehr (die Quote steigt).

//
// Mehr Startwerte mit INV_FROM/INV_TO.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { taxReport } from '../src/calc.ts'
import { snapshotOf, type SnapshotCostItem, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'
import type { CostKey, TaxReport } from '../../shared/types.ts'
import { calendarPeriod } from '../../shared/period.ts'

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const YEAR = 2025
const CATEGORIES = ['Nicht umlagefähig', 'Grundsteuer', 'Müllabfuhr', 'Sach- und Haftpflichtversicherung']
const KEYS: CostKey[] = ['area', 'units', 'persons', 'direct']

function stock(seed: number): SnapshotSource {
  const r = rng(seed)
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T
  const n = 2 + Math.floor(r() * 3)
  const units: SnapshotUnit[] = []
  const tenancies: SnapshotTenancy[] = []
  for (let i = 0; i < n; i++) {
    const self = i === 0 && r() < 0.4
    const area = r() < 0.1 ? 0 : 30 + Math.floor(r() * 90)
    const u: SnapshotUnit = self
      ? { id: `u${i}`, name: `u${i}`, areaM2: area, participates: false, selfUsed: true, selfPersons: 2 }
      : { id: `u${i}`, name: `u${i}`, areaM2: area, participates: true }
    if (!self && r() < 0.7) u.localRents = [{ from: r() < 0.15 ? '2025-04' : '2020-01', monthlyCents: 60000 + Math.floor(r() * 60000), source: 'Mietspiegel', sourceDate: '2024-01-01' }]
    units.push(u)
    if (self) continue
    const change = r() < 0.3
    const end = change ? `2025-0${1 + Math.floor(r() * 8)}-15` : null
    const base = Math.floor(r() * 90000)
    tenancies.push({
      id: `t${i}a`, unitId: u.id, tenantName: `t${i}a`, persons: 1 + Math.floor(r() * 3), personHistory: [{ from: '2020-01-01', persons: 1 }],
      start: '2020-01-01', end, prepayments: r() < 0.5 ? [{ from: '2020-01', monthlyCents: 10000 }] : [], prepaymentOverrides: {},
      baseRents: [{ from: '2020-01', monthlyCents: base }], ...(r() < 0.1 ? { heatingModel: 'selfSupply' as const } : {}),
      ...(r() < 0.3 ? { directCharges: [{ from: r() < 0.5 ? '2020-01' : '2025-05', monthlyCents: Math.floor(r() * 30000) }] } : {}),
    })
    if (end !== null && r() < 0.7) {
      // Gelegentlich überschneiden sich die beiden (#204, ein Fehler der Erfassung), damit die Begrenzung auf 1 greift.
      const start = r() < 0.25 ? '2025-01-10' : `2025-${end.slice(5, 7)}-16`
      tenancies.push({
        id: `t${i}b`, unitId: u.id, tenantName: `t${i}b`, persons: 1, personHistory: [{ from: start, persons: 1 }], start, end: null,
        prepayments: [], prepaymentOverrides: {}, baseRents: [{ from: start.slice(0, 7), monthlyCents: Math.floor(r() * 100000) }],
      })
    }
  }
  const costItems: SnapshotCostItem[] = []
  const m = 2 + Math.floor(r() * 5)
  for (let k = 0; k < m; k++) {
    const key = pick(KEYS)
    const credit = r() < 0.15
    const item: SnapshotCostItem = {
      id: `c${k}`, period: calendarPeriod(YEAR), category: pick(CATEGORIES), description: `c${k}`,
      amountCents: (credit ? -1 : 1) * (1000 + Math.floor(r() * 300000)), key,
    }
    if (key === 'direct') item.directUnitId = pick(units).id
    else if (r() < 0.3) item.participantUnitIds = units.filter(() => r() < 0.6).map((u) => u.id)
    costItems.push(item)
  }
  return { units, tenancies, costItems, meters: [], readings: [], payments: [], closedSettlements: [] }
}

const withoutRents = (s: SnapshotSource): SnapshotSource => ({ ...s, units: s.units.map(({ localRents: _, ...u }) => u) })
const tax = (s: SnapshotSource): TaxReport => taxReport(snapshotOf(s, YEAR))

test('Invariante verbilligte Vermietung: Aufteilung je Position, kein Doppelabzug, ohne Eintrag unverändert', () => {
  const from = Number(process.env.INV_FROM ?? 1)
  const to = Number(process.env.INV_TO ?? 400)
  let cutSeen = 0
  for (let seed = from; seed <= to; seed++) {
    const s = stock(seed)
    const mit = tax(s)
    const ohne = tax(withoutRents(s))
    const at = `Startwert ${seed}`
    // (v3)
    assert.equal(ohne.cheapRent, undefined, at)
    assert.equal(ohne.expenses.gratuitousCents, undefined, at)
    const before = new Map(ohne.expenses.items.map((i) => [i.costItemId, i]))
    const limits = mit.cheapRent?.law
    for (const i of mit.expenses.items) {
      const b = before.get(i.costItemId)
      if (!b) assert.fail(`${at}: Position ${i.costItemId} fehlt ohne Eintrag`)
      const g = i.gratuitousCents ?? 0
      // (v1)
      assert.equal(i.privateCents + g + i.deductibleCents, i.amountCents, `${at} ${i.costItemId}: Summe`)
      assert.ok(g === 0 || Math.sign(g) === Math.sign(b.deductibleCents), `${at} ${i.costItemId}: Vorzeichen`)
      assert.ok(Math.abs(g) <= Math.abs(b.deductibleCents), `${at} ${i.costItemId}: mehr gekürzt als abziehbar`)
      // (v2)
      assert.equal(i.privateCents, b.privateCents, `${at} ${i.costItemId}: privat`)
      if (g !== 0) cutSeen++
      // (v4): höchstens Betrag × Σ (1 − entgeltlicher Anteil) über die Wohnungen, plus Rundung.
      const bound = (mit.cheapRent?.units ?? []).flatMap((u) => u.tenancies.filter((t) => t.verdict === 'split')).reduce((a, t) => a + (1 - t.entgeltCents / t.comparisonCents), 0) * Math.abs(i.amountCents) + 0.5
      assert.ok(Math.abs(g) <= bound, `${at} ${i.costItemId}: Kürzung ${g} über ${bound}`)
    }
    if (limits) {
      for (const u of mit.cheapRent?.units ?? []) {
        const splitDays = u.tenancies.filter((t) => t.verdict === 'split')
        if (splitDays.length === 0) assert.equal(u.gratuitousCents, 0, `${at} ${u.unitId}: gekürzt ohne Quote unter der Grenze`)
        for (const t of u.tenancies) {
          if (t.verdict === 'split') assert.ok(t.entgeltCents * 100 < limits.split * t.comparisonCents, `${at} ${t.tenancyId}`)
          if (t.verdict === 'paid') assert.ok(t.entgeltCents * 100 >= limits.paid * t.comparisonCents, `${at} ${t.tenancyId}`)
        }
      }
    }
    // (v7)
    for (const u of mit.cheapRent?.units ?? []) {
      const expected = Math.min(1, u.tenancies.filter((t) => t.verdict === 'split').reduce((a, t) => a + (1 - t.entgeltCents / t.comparisonCents) * t.days / 365, 0))
      assert.ok(Math.abs((1 - u.paidFactor) - expected) < 1e-9, `${at} ${u.unitId}: unentgeltlicher Anteil ${1 - u.paidFactor} statt ${expected}`)
    }
    // (v6)
    const ohneDirekt = tax({ ...s, tenancies: s.tenancies.map(({ directCharges: _, ...t }) => t) })
    assert.equal(ohneDirekt.expenses.totalCents, mit.expenses.totalCents, `${at}: Brutto`)
    assert.equal(ohneDirekt.expenses.privateCents, mit.expenses.privateCents, `${at}: privat`)
    assert.equal(ohneDirekt.income.sollCents, mit.income.sollCents, `${at}: Einnahmen`)
    for (const u of mit.cheapRent?.units ?? []) {
      for (const t of u.tenancies) {
        const o = ohneDirekt.cheapRent?.units.find((x) => x.unitId === u.unitId)?.tenancies.find((x) => x.tenancyId === t.tenancyId)
        if (!o) assert.fail(`${at}: ${t.tenancyId} fehlt ohne direkte Kosten`)
        assert.equal(t.entgeltCents - t.directChargesCents, o.entgeltCents, `${at} ${t.tenancyId}: Entgelt`)
      }
    }
    // Je Position, nicht je Wohnung: Die Summe je Wohnung verteilt gerundete Kürzungen und kann um einen Cent wandern.
    const lowerBound = [mit, ohneDirekt].some((x) => (x.cheapRent?.units ?? []).some((u) => u.tenancies.some((t) => t.verdict === 'lowerBound')))
    if (!lowerBound) {
      const before = new Map(ohneDirekt.expenses.items.map((i) => [i.costItemId, i.gratuitousCents ?? 0]))
      for (const i of mit.expenses.items) {
        assert.ok(Math.abs(i.gratuitousCents ?? 0) <= Math.abs(before.get(i.costItemId) ?? 0), `${at} ${i.costItemId}: mehr gekürzt mit direkten Kosten`)
      }
    }
    // (v5)
    const e = mit.expenses
    assert.equal(e.deductibleCents, e.totalCents - e.privateCents - (e.gratuitousCents ?? 0), `${at}: Summen`)
    assert.equal(mit.surplusSollCents, mit.income.sollCents - e.deductibleCents, `${at}: Überschuss`)
    assert.equal(e.gratuitousCents ?? 0, e.items.reduce((a, i) => a + (i.gratuitousCents ?? 0), 0), `${at}: Summe der Positionen`)
  }
  assert.ok(cutSeen > 50, `zu wenige gekürzte Positionen (${cutSeen}); der Generator trifft die Regel nicht`)
})

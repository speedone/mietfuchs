// Verbilligte Vermietung nach § 21 Abs. 2 EStG (#257), mit Handrechnung.
//
// Die Quote ist Entgelt durch ortsübliche Warmmiete. Entgelt ist die vereinbarte Kaltmiete (BFH, Urteil vom 22.02.2021,
// IX R 7/20, Rz. 11) zuzüglich der gezahlten Umlagen (BMF-Schreiben vom 08.10.2004, BStBl I S. 933, Rz. 11); die
// Umlagen nimmt Mietfuchs aus der Abrechnung des Kalenderjahres, sonst aus dem Soll der Vorauszahlungen. Unter der
// Grenze von Satz 1 werden die Werbungskosten der Wohnung auf den entgeltlichen Teil gekürzt, zwischen den Grenzen gibt
// es nur einen Hinweis (Totalüberschussprognose), ab der Grenze von Satz 2 ist die Vermietung entgeltlich.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { taxReport } from '../src/calc.ts'
import { snapshotOf, type SnapshotCostItem, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'
import type { CheapRentTenancy, LocalRentEntry, TaxExpenseItem, TaxReport } from '../../shared/types.ts'
import { calendarPeriod } from '../../shared/period.ts'

const tenancy = (id: string, unitId: string, monthlyCents: number, over: Partial<SnapshotTenancy> = {}): SnapshotTenancy => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [{ from: '2010-01-01', persons: 1 }], start: '2010-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [{ from: '2010-01', monthlyCents }], ...over,
})
const local = (monthlyCents: number, from = '2010-01'): LocalRentEntry => ({ from, monthlyCents, source: 'Mietspiegel Musterstadt', sourceDate: '2024-04-01' })
const rented = (id: string, areaM2: number, localRents?: LocalRentEntry[]): SnapshotUnit => ({ id, name: id, areaM2, participates: true, ...(localRents ? { localRents } : {}) })
const own = (id: string, areaM2: number): SnapshotUnit => ({ id, name: id, areaM2, participates: false, selfUsed: true, selfPersons: 2 })
const item = (id: string, year: number, over: Partial<SnapshotCostItem>): SnapshotCostItem => ({
  id, period: calendarPeriod(year), category: 'Nicht umlagefähig', description: id, amountCents: 100000, key: 'area', ...over,
})
const source = (over: Partial<SnapshotSource>): SnapshotSource => ({
  units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [], ...over,
})
const tax = (s: SnapshotSource, year = 2025): TaxReport => taxReport(snapshotOf(s, year))
const itemOf = (r: TaxReport, id: string): TaxExpenseItem => {
  const found = r.expenses.items.find((x) => x.costItemId === id)
  if (!found) assert.fail(`keine Position ${id} in der Steuerübersicht`)
  return found
}
const tenancyOf = (r: TaxReport, id: string): CheapRentTenancy => {
  const found = r.cheapRent?.units.flatMap((u) => u.tenancies).find((t) => t.tenancyId === id)
  if (!found) assert.fail(`kein Mietverhältnis ${id} in der Prüfung der verbilligten Vermietung`)
  return found
}

// Zwei Wohnungen, 60 und 40 m². Die Tochter wohnt in „a“ für 200 € kalt ohne Vorauszahlung, ortsüblich wären 900 € warm.
const family = (year: number, kalt: number, over: Partial<SnapshotSource> = {}): SnapshotSource => source({
  units: [rented('a', 60, [local(90000)]), rented('b', 40)],
  tenancies: [tenancy('tochter', 'a', kalt), tenancy('fremd', 'b', 80000)],
  costItems: [
    item('dach', year, { amountCents: 100000 }),
    item('a-direkt', year, { amountCents: 30000, key: 'direct', directUnitId: 'a' }),
    item('b-direkt', year, { amountCents: 50000, key: 'direct', directUnitId: 'b' }),
  ],
  ...over,
})

test('unter 50 %: die Werbungskosten der Wohnung werden auf den entgeltlichen Teil gekürzt', () => {
  const r = tax(family(2025, 20000))
  const t = tenancyOf(r, 'tochter')
  // 12 × 200 € = 2.400 € gegen 12 × 900 € = 10.800 €: 22,22 %.
  assert.deepEqual([t.entgeltCents, t.comparisonCents, t.quotePercent, t.verdict, t.chargesSource], [240000, 1080000, 22.22, 'split', 'settlement'])
  // Dach nach Fläche: 1.000 € × 60/100 × (1 − 2.400/10.800) = 466,666… → 466,67 € unentgeltlich.
  assert.deepEqual([itemOf(r, 'dach').gratuitousCents, itemOf(r, 'dach').deductibleCents], [46667, 53333])
  // Direkt der Wohnung zugeordnet: 300 € × 7/9 = 233,33 €.
  assert.deepEqual([itemOf(r, 'a-direkt').gratuitousCents, itemOf(r, 'a-direkt').deductibleCents], [23333, 6667])
  // Die andere Wohnung bleibt ungekürzt.
  assert.equal(itemOf(r, 'b-direkt').gratuitousCents, undefined)
  assert.equal(itemOf(r, 'b-direkt').deductibleCents, 50000)
  assert.equal(r.expenses.gratuitousCents, 70000)
  assert.equal(r.expenses.deductibleCents, 180000 - 70000)
  assert.equal(r.surplusSollCents, r.income.sollCents - 110000)
  const unit = r.cheapRent?.units.find((u) => u.unitId === 'a')
  assert.equal(unit?.gratuitousCents, 70000)
  assert.ok(Math.abs((unit?.paidFactor ?? 0) - 2 / 9) < 1e-9)
  // Die Gruppe trägt den unentgeltlichen Teil mit.
  const g = r.expenses.groups.find((x) => x.group === 'Verwaltung & Instandhaltung')
  assert.deepEqual([g?.amountCents, g?.gratuitousCents, g?.deductibleCents], [180000, 70000, 110000])
  // Der Rechenweg nennt die Kürzung.
  assert.ok(itemOf(r, 'dach').steps.some((s) => /§ 21 Abs\. 2 EStG/.test(s.value) || /verbilligt/i.test(s.label)), JSON.stringify(itemOf(r, 'dach').steps))
})

test('50 bis unter 66 %: nur ein Hinweis auf die Totalüberschussprognose, keine Kürzung', () => {
  // 12 × 550 € = 6.600 € gegen 10.800 €: 61,11 %.
  const r = tax(family(2025, 55000))
  assert.deepEqual([tenancyOf(r, 'tochter').quotePercent, tenancyOf(r, 'tochter').verdict], [61.11, 'forecast'])
  assert.equal(r.expenses.gratuitousCents, undefined)
  assert.equal(itemOf(r, 'dach').deductibleCents, 100000)
})

test('ab 66 %: entgeltlich', () => {
  const r = tax(family(2025, 60000))
  assert.deepEqual([tenancyOf(r, 'tochter').quotePercent, tenancyOf(r, 'tochter').verdict], [66.66, 'paid'])
  assert.equal(r.expenses.gratuitousCents, undefined)
})

test('genau an den Grenzen: 50 % ist keine Aufteilung, 66 % ist entgeltlich', () => {
  assert.equal(tenancyOf(tax(family(2025, 45000)), 'tochter').verdict, 'forecast')
  // 594 € von 900 € sind genau 66 %.
  assert.equal(tenancyOf(tax(family(2025, 59400)), 'tochter').verdict, 'paid')
})

test('bis 2020 gilt die frühere Fassung: Aufteilung unter 66 %, ohne Prognosebereich', () => {
  const r = tax(family(2020, 55000), 2020)
  assert.deepEqual([tenancyOf(r, 'tochter').verdict, r.cheapRent?.law?.split, r.cheapRent?.law?.paid], ['split', 66, 66])
  // 1.000 € × 60/100 × (1 − 6.600/10.800) = 233,33 €.
  assert.equal(itemOf(r, 'dach').gratuitousCents, 23333)
})

test('vor 2012 führt das Register keine Fassung: keine Prüfung, keine Kürzung', () => {
  const r = tax(family(2011, 20000), 2011)
  assert.equal(r.cheapRent?.law, null)
  assert.deepEqual(r.cheapRent?.units, [])
  assert.equal(r.expenses.gratuitousCents, undefined)
})

test('ohne Eintrag gibt es keine Prüfung, und keine Zahl ändert sich', () => {
  const mit = family(2025, 20000)
  const ohne = { ...mit, units: [rented('a', 60), rented('b', 40)] }
  const r = tax(ohne)
  assert.equal(r.cheapRent, undefined)
  assert.equal(r.expenses.gratuitousCents, undefined)
  assert.ok(r.expenses.items.every((i) => i.gratuitousCents === undefined))
  assert.equal(r.expenses.deductibleCents, 180000)
})

test('Mieter heizt selbst: die Quote ist nur eine Untergrenze, unter 66 % keine Kürzung', () => {
  const s = family(2025, 20000)
  const r = tax({ ...s, tenancies: [tenancy('tochter', 'a', 20000, { heatingModel: 'selfSupply' }), tenancy('fremd', 'b', 80000)] })
  assert.equal(tenancyOf(r, 'tochter').verdict, 'lowerBound')
  assert.equal(r.expenses.gratuitousCents, undefined)
})

test('fehlt für einen Monat die ortsübliche Miete, wird nicht gerechnet', () => {
  const s = family(2025, 20000)
  const r = tax({ ...s, units: [rented('a', 60, [local(90000, '2025-07')]), rented('b', 40)] })
  const t = tenancyOf(r, 'tochter')
  assert.deepEqual([t.verdict, t.quotePercent, t.missingMonths], ['incomplete', null, [1, 2, 3, 4, 5, 6]])
  assert.equal(r.expenses.gratuitousCents, undefined)
})

test('ein halbes Jahr verbilligt: gekürzt wird nach den Tagen des Mietverhältnisses', () => {
  const s = family(2025, 20000)
  const r = tax({ ...s, tenancies: [tenancy('tochter', 'a', 20000, { end: '2025-06-30' }), tenancy('fremd', 'b', 80000)] })
  const t = tenancyOf(r, 'tochter')
  // 6 × 200 € gegen 6 × 900 €: 22,22 %, an 181 von 365 Tagen.
  assert.deepEqual([t.days, t.quotePercent, t.verdict], [181, 22.22, 'split'])
  // 1.000 € × 0,6 × 7/9 × 181/365 = 231,41 €.
  assert.equal(itemOf(r, 'dach').gratuitousCents, Math.round(100000 * 0.6 * (7 / 9) * (181 / 365)))
})

test('Umlagen aus der Abrechnung des Kalenderjahres: der Anteil des Mieters an den Kosten', () => {
  // Grundsteuer 1.000 € nach Fläche: Die Tochter trägt 600 €; Vorauszahlung 100 € im Monat.
  const s = family(2025, 20000)
  const r = tax({
    ...s,
    tenancies: [tenancy('tochter', 'a', 20000, { prepayments: [{ from: '2010-01', monthlyCents: 10000 }] }), tenancy('fremd', 'b', 80000)],
    costItems: [...s.costItems, item('grundsteuer', 2025, { category: 'Grundsteuer', amountCents: 100000 })],
  })
  const t = tenancyOf(r, 'tochter')
  assert.deepEqual([t.chargesSource, t.chargesCents, t.entgeltCents], ['settlement', 60000, 300000])
})

test('mit eigener Wohnung: privater Teil und unentgeltlicher Teil zählen nicht doppelt', () => {
  // 100 m² eigen, 100 m² an die Tochter für 200 € statt 900 €. Dach 2.000 € nach Fläche: 1.000 € privat, vom Rest
  // 1.000 € × 7/9 = 777,78 € unentgeltlich.
  const r = tax(source({
    units: [own('eigen', 100), rented('a', 100, [local(90000)])],
    tenancies: [tenancy('tochter', 'a', 20000)],
    costItems: [item('dach', 2025, { amountCents: 200000 })],
  }))
  const x = itemOf(r, 'dach')
  assert.deepEqual([x.privateCents, x.gratuitousCents, x.deductibleCents], [100000, 77778, 22222])
  assert.equal(x.privateCents + (x.gratuitousCents ?? 0) + x.deductibleCents, x.amountCents)
})

test('eine Gutschrift wird spiegelbildlich gekürzt', () => {
  const s = family(2025, 20000)
  const r = tax({ ...s, costItems: [item('erstattung', 2025, { amountCents: -10000 })] })
  // −100 € × 0,6 × 7/9 = −46,67 €.
  assert.deepEqual([itemOf(r, 'erstattung').gratuitousCents, itemOf(r, 'erstattung').deductibleCents], [-4667, -5333])
})

test('fehlt der Wohnung die Fläche, bleibt eine Position nach Fläche ungekürzt und wird genannt', () => {
  const s = family(2025, 20000)
  const r = tax({ ...s, units: [rented('a', 0, [local(90000)]), rented('b', 40)] })
  assert.equal(itemOf(r, 'dach').gratuitousCents, undefined)
  assert.deepEqual(r.cheapRent?.units.find((u) => u.unitId === 'a')?.unallocated.map((u) => u.costItemId), ['dach'])
  // Direkt zugeordnet geht weiter.
  assert.equal(itemOf(r, 'a-direkt').gratuitousCents, 23333)
})

test('Betriebsstrom: gekürzt wird die Stromrechnung, nicht ihr Abzug, sonst fehlte der Ausschnitt (Durchsicht)', () => {
  // Allgemeinstrom 1.000 € nach Fläche, davon 100 € Betriebsstrom der Heizung abgezogen und selbst getragen. Die bezahlte
  // Rechnung bleibt 1.000 € (Ausgleichszeile +100 €). Die Tochter trägt laut Abrechnung 900 € × 0,6 = 540 € Umlagen, ihr
  // Entgelt ist 2.940 € von 10.800 €; gekürzt wird 1.000 € × 0,6 × 7.860/10.800 = 436,67 €.
  const s = family(2025, 20000)
  const r = tax({
    ...s,
    costItems: [
      item('strom', 2025, { category: 'Beleuchtung/Allgemeinstrom', amountCents: 100000 }),
      item('abzug', 2025, { category: 'Beleuchtung/Allgemeinstrom', amountCents: -10000, operatingPower: 'deduction' }),
    ],
  })
  assert.equal(tenancyOf(r, 'tochter').entgeltCents, 294000)
  assert.equal(itemOf(r, 'strom').gratuitousCents, 43667)
  assert.equal(itemOf(r, 'abzug').gratuitousCents, undefined)
  assert.equal(r.expenses.gratuitousCents, 43667)
})

test('überschneiden sich zwei verbilligte Mietverhältnisse, ist höchstens alles unentgeltlich', () => {
  const s = family(2025, 20000)
  const r = tax({ ...s, tenancies: [tenancy('tochter', 'a', 20000), tenancy('sohn', 'a', 10000), tenancy('fremd', 'b', 80000)] })
  const u = r.cheapRent?.units.find((x) => x.unitId === 'a')
  assert.ok((u?.paidFactor ?? -1) >= 0, String(u?.paidFactor))
})

// Vom Mieter unmittelbar an Dritte gezahlte umlagefähige Kosten (#257, Entscheidung in PR #422): Sie gehören zum
// Entgelt (BFH IX R 7/20, Rz. 21; OFD Frankfurt, Tz. 3), nie in die Werbungskosten oder die Abrechnung.
test('direkt an Dritte gezahlte Kosten zählen zum Entgelt: 200 € kalt + 150 € Gas gegen 900 € warm', () => {
  const s = family(2025, 20000)
  const r = tax({ ...s, tenancies: [tenancy('tochter', 'a', 20000, { directCharges: [{ from: '2010-01', monthlyCents: 15000 }] }), tenancy('fremd', 'b', 80000)] })
  const t = tenancyOf(r, 'tochter')
  // 12 × 350 € = 4.200 € von 10.800 €: 38,88 % (abgeschnitten).
  assert.deepEqual([t.directChargesCents, t.entgeltCents, t.quotePercent, t.verdict], [180000, 420000, 38.88, 'split'])
  // Dach: 1.000 € × 0,6 × 6.600/10.800 = 366,67 €.
  assert.equal(itemOf(r, 'dach').gratuitousCents, 36667)
  // Die Werbungskosten selbst ändert der Betrag nicht: Brutto bleibt Brutto.
  assert.equal(r.expenses.totalCents, 180000)
})

test('direkt gezahlte Kosten heben über die Grenze: dann keine Kürzung', () => {
  const s = family(2025, 20000)
  // 200 € + 400 € = 600 € von 900 €: 66,67 %, entgeltlich.
  const r = tax({ ...s, tenancies: [tenancy('tochter', 'a', 20000, { directCharges: [{ from: '2010-01', monthlyCents: 40000 }] }), tenancy('fremd', 'b', 80000)] })
  assert.equal(tenancyOf(r, 'tochter').verdict, 'paid')
  assert.equal(r.expenses.gratuitousCents, undefined)
})

test('Mieter heizt selbst mit eingetragenen direkt gezahlten Kosten: es wird normal gerechnet', () => {
  const s = family(2025, 20000)
  const r = tax({ ...s, tenancies: [tenancy('tochter', 'a', 20000, { heatingModel: 'selfSupply', directCharges: [{ from: '2010-01', monthlyCents: 15000 }] }), tenancy('fremd', 'b', 80000)] })
  assert.equal(tenancyOf(r, 'tochter').verdict, 'split')
  assert.equal(itemOf(r, 'dach').gratuitousCents, 36667)
})

test('direkt gezahlte Kosten im angebrochenen Monat nach Tagen, ab ihrem Monat', () => {
  const s = family(2025, 20000)
  const r = tax({ ...s, tenancies: [tenancy('tochter', 'a', 20000, { directCharges: [{ from: '2025-07', monthlyCents: 15000 }] }), tenancy('fremd', 'b', 80000)] })
  assert.equal(tenancyOf(r, 'tochter').directChargesCents, 90000)
})

// ---------- Durchsicht von PR #422 ----------

test('S1: umlagefähige Position mit Einzelbeträgen: gekürzt wird der Anteil des Mieters laut Abrechnung, nicht die Fläche', () => {
  // Heizung 1.000 € nach Einzelbeträgen, die Tochter trägt 100 €, ihre Wohnung hat 50 % der Fläche. Entgelt 2.400 € + 100 €
  // Umlagen = 2.500 € von 10.800 €; unentgeltlich 8.300/10.800. Gekürzt 100 € × 8.300/10.800 = 76,85 €, nicht
  // 1.000 € × 0,5 × 8.300/10.800 = 384,26 €.
  const r = tax(source({
    units: [rented('a', 50, [local(90000)]), rented('b', 50)],
    tenancies: [tenancy('tochter', 'a', 20000), tenancy('fremd', 'b', 80000)],
    costItems: [item('heizung', 2025, { category: 'Heizung und Warmwasser', amountCents: 100000, key: 'amounts', tenancyAmounts: { tochter: 10000, fremd: 90000 } })],
  }))
  assert.equal(tenancyOf(r, 'tochter').entgeltCents, 250000)
  assert.equal(itemOf(r, 'heizung').gratuitousCents, 7685)
})

test('S1: Pauschale: der Anteil steht nicht in der Abrechnung, dann gilt die Fläche', () => {
  const r = tax(source({
    units: [rented('a', 50, [local(90000)]), rented('b', 50)],
    tenancies: [tenancy('tochter', 'a', 20000, { costModel: 'flatRate', flatRates: [{ from: '2010-01', monthlyCents: 0 }] }), tenancy('fremd', 'b', 80000)],
    costItems: [item('grundsteuer', 2025, { category: 'Grundsteuer', amountCents: 100000 })],
  }))
  // 1.000 € × 0,5 × (1 − 2.400/10.800) = 388,89 €.
  assert.equal(itemOf(r, 'grundsteuer').gratuitousCents, 38889)
})

test('S3: die Quote wird abgeschnitten, nicht gerundet: 49,999 % ist 49,99 % und aufgeteilt', () => {
  const s = source({
    units: [rented('a', 60, [local(100000)]), rented('b', 40)],
    tenancies: [tenancy('tochter', 'a', 49999), tenancy('fremd', 'b', 80000)],
    costItems: [item('dach', 2025, {})],
  })
  assert.deepEqual([tenancyOf(tax(s), 'tochter').quotePercent, tenancyOf(tax(s), 'tochter').verdict], [49.99, 'split'])
  const s2 = { ...s, tenancies: [tenancy('tochter', 'a', 65999), tenancy('fremd', 'b', 80000)] }
  assert.deepEqual([tenancyOf(tax(s2), 'tochter').quotePercent, tenancyOf(tax(s2), 'tochter').verdict], [65.99, 'forecast'])
})

test('K3: eine vermietete Wohnung außerhalb der Abrechnungseinheit wird geprüft', () => {
  const r = tax(source({
    units: [{ id: 'gewerbe', name: 'gewerbe', areaM2: 60, participates: false, selfUsed: false, localRents: [local(90000)] }, rented('b', 40)],
    tenancies: [tenancy('tochter', 'gewerbe', 20000), tenancy('fremd', 'b', 80000)],
    costItems: [item('dach', 2025, {})],
  }))
  assert.equal(tenancyOf(r, 'tochter').verdict, 'split')
  assert.equal(itemOf(r, 'dach').gratuitousCents, 46667)
})

test('K4: eine verrechnete CO₂-Erstattung mindert das Entgelt nicht (wie beim Vorschlag nach § 560)', () => {
  // Die Erstattung von 240 € steht als Gutschriftzeile in der Abrechnung der Tochter; sie fällt nicht wieder an und ist
  // keine Minderung der Umlagen (`recurringShareCents`). Grundsteuer 1.000 € nach Fläche: Die Tochter trägt 600 €.
  const s = family(2025, 20000)
  const snapshot = snapshotOf({
    ...s,
    tenancies: [tenancy('tochter', 'a', 20000, { heatingModel: 'selfSupply', directCharges: [{ from: '2010-01', monthlyCents: 15000 }] }), tenancy('fremd', 'b', 80000)],
    costItems: [item('grundsteuer', 2025, { category: 'Grundsteuer', amountCents: 100000 })],
  }, 2025)
  const r = taxReport({
    ...snapshot,
    co2Refunds: [{
      id: 'e', tenancyId: 'tochter', supplierBilledAt: '2025-01-20', claimedAt: '2025-03-01', amountCents: 24000, settlePeriod: calendarPeriod(2025), paidOutOn: null,
      billedFrom: null, billedTo: null, emissionsKg: null, co2CostCents: null, areaM2: 60, ownAppliances: false, commercialUse: false, commercialMetered: false,
      nonResidential: false, restriction: 'none', halfSplitFrom: null, gridFeeCents: null, bioCostCents: null,
    }],
  })
  assert.equal(tenancyOf(r, 'tochter').chargesCents, 60000)
})

// #259: Die Prüfung liest die Nutzung nach Tagen. Wohnung a ist bis 30.06.2025 selbstgenutzt und ab 01.07. verbilligt an
// die Tochter vermietet: geprüft wird sie trotzdem, und gekürzt nur für die 184 vermieteten Tage.
test('Nutzungswechsel: eine erst ab Juli vermietete Wohnung wird geprüft und nach den vermieteten Tagen gekürzt', () => {
  const s = family(2025, 20000)
  const r = tax({
    ...s,
    units: [{ ...rented('a', 60, [local(90000)]), participates: false, selfUsed: true, selfPersons: 1, usageChanges: [{ from: '2025-07-01', usage: 'vermietet' }] }, rented('b', 40)],
    tenancies: [tenancy('tochter', 'a', 20000, { start: '2025-07-01', personHistory: [{ from: '2025-07-01', persons: 1 }] }), tenancy('fremd', 'b', 80000)],
  })
  const t = tenancyOf(r, 'tochter')
  assert.deepEqual([t.days, t.quotePercent, t.verdict], [184, 22.22, 'split'])
  // Privat (selbstgenutzt Januar bis Juni) 1.000 € × 60 × 181/365 / 100 = 297,53 €; unentgeltlich 1.000 € × 0,6 × 7/9 × 184/365.
  assert.equal(itemOf(r, 'dach').privateCents, Math.round(100000 * 0.6 * 181 / 365))
  assert.equal(itemOf(r, 'dach').gratuitousCents, Math.round(100000 * 0.6 * (7 / 9) * (184 / 365)))
})

test('Nutzungswechsel: ein Mietverhältnis in einer Zeit der Eigennutzung zählt nicht als verbilligte Tage', () => {
  const s = family(2025, 20000)
  const r = tax({
    ...s,
    units: [{ ...rented('a', 60, [local(90000)]), usageChanges: [{ from: '2025-07-01', usage: 'eigen' }], selfPersons: 1 }, rented('b', 40)],
    tenancies: [tenancy('tochter', 'a', 20000), tenancy('fremd', 'b', 80000)],
  })
  // Bis 30.06. vermietet (181 Tage), danach selbstgenutzt: das Mietverhältnis zählt nur 181 Tage.
  assert.equal(tenancyOf(r, 'tochter').days, 181)
})

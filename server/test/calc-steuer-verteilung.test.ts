// Größeren Erhaltungsaufwand verteilen (§ 82b EStDV, #262 PR 2): die Rechnung der Steuerübersicht, mit Handrechnung.
// Entwurf docs/superpowers/specs/2026-10-30-erhaltungsaufwand-verteilen-design.md, E-3 bis E-7.
//
// § 82b Abs. 1 Satz 1 EStDV: Größere Aufwendungen für die Erhaltung von Gebäuden, die überwiegend Wohnzwecken dienen,
// kann der Steuerpflichtige abweichend von § 11 Abs. 2 EStG auf zwei bis fünf Jahre gleichmäßig verteilen. Verteilt
// wird D = Betrag − privat (Eigennutzung im Jahr des Abflusses, E-3), die erste Rate im Jahr des Abflusses, der Rest-Cent
// in den ersten Jahren (E-4). Bei verbilligter Vermietung wird jede Rate im Jahr ihres Abzugs mit der Quote dieses
// Jahres gekürzt (Anleitung zur Anlage V 2024, S. 7: Aufwendungen in den Zeilen 33 bis 84 in voller Höhe, gekürzt nur
// in den Zeilen 87 und 88). Abs. 2: Rest im Jahr des vorzeitigen Endes. Die Abrechnung für die Mieter liest die Wahl nie.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { carriedRates, computeSettlement, RESERVE_WITHDRAWAL_CATEGORY, taxReportFor } from '../src/calc.ts'
import { snapshotFor } from '../src/snapshot.ts'
import { TAX_STOCK_PROPERTY, type TaxSource } from '../testing/taxStock.ts'
import { CALENDAR_RULES, periodKey, periodOfKey, rulesOf } from '../../shared/period.ts'
import type { LocalRentEntry, PeriodRules, TaxExpenseItem, TaxReport } from '../../shared/types.ts'

type Item = TaxSource['costItems'][number]
type Tenancy = TaxSource['tenancies'][number]
type Unit = TaxSource['units'][number]
const P = TAX_STOCK_PROPERTY

const item = (over: Partial<Item> & Pick<Item, 'id'>): Item => ({
  propertyId: P, period: periodKey('2026-01'), category: 'Nicht umlagefähig', description: 'Dachsanierung', amountCents: 1_000_000, key: 'area', ...over,
})
const tenancy = (id: string, unitId: string, over: Partial<Tenancy> = {}): Tenancy => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [{ from: '2020-01', monthlyCents: 70000 }], ...over,
})
const unit = (id: string, areaM2: number, over: Partial<Unit> = {}): Unit => ({ id, propertyId: P, name: id, areaM2, participates: true, ...over })
const house = (costItems: Item[], over: { units?: Unit[]; tenancies?: Tenancy[]; rules?: PeriodRules; restYear?: number | null } = {}): TaxSource => ({
  properties: [{ id: P, kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: over.rules ?? CALENDAR_RULES, ...(over.restYear !== undefined ? { spreadRestYear: over.restYear } : {}) }],
  units: over.units ?? [unit('eg', 40), unit('og', 60)],
  tenancies: over.tenancies ?? [tenancy('a', 'eg'), tenancy('b', 'og')],
  costItems, meters: [], readings: [], payments: [], closedSettlements: [],
})
const report = (src: TaxSource, year: number): TaxReport => taxReportFor(src, P, year)
const row = (r: TaxReport, id: string): TaxExpenseItem => r.expenses.items.find((x) => x.costItemId === id) ?? assert.fail(`keine Zeile ${id} in ${r.year}`)
// I-2: je Zeile, Kategorie, Gruppe und Summe Betrag = privat + unentgeltlich + verschoben + abziehbar.
const balanced = (r: TaxReport): void => {
  const sum = (x: { privateCents: number; gratuitousCents?: number; deferredCents?: number; deductibleCents: number }) =>
    x.privateCents + (x.gratuitousCents ?? 0) + (x.deferredCents ?? 0) + x.deductibleCents
  for (const i of r.expenses.items) assert.equal(sum(i), i.amountCents, `${r.year} ${i.costItemId}`)
  for (const g of r.expenses.groups) {
    assert.equal(sum(g), g.amountCents, `${r.year} ${g.group}`)
    for (const c of g.categories) assert.equal(sum(c), c.amountCents, `${r.year} ${g.group}/${c.category}`)
  }
  assert.equal(r.expenses.totalCents - r.expenses.privateCents - (r.expenses.gratuitousCents ?? 0) - (r.expenses.deferredCents ?? 0), r.expenses.deductibleCents, `${r.year} Summe`)
}

test('10.000 € auf 3 Jahre ohne Eigennutzung: 3.333,34 / 3.333,33 / 3.333,33, die Position bleibt im Jahr der Zahlung', () => {
  const src = house([item({ id: 'dach', spreadYears: 3 })])
  const r26 = report(src, 2026)
  const dach = row(r26, 'dach')
  assert.deepEqual([dach.amountCents, dach.privateCents, dach.deferredCents, dach.deductibleCents], [1_000_000, 0, 666_666, 333_334])
  assert.deepEqual(dach.spread, {
    years: 3, baseCents: 1_000_000,
    rates: [{ year: 2026, cents: 333_334, grossCents: 333_334 }, { year: 2027, cents: 333_333, grossCents: 333_333 }, { year: 2028, cents: 333_333, grossCents: 333_333 }],
  })
  assert.deepEqual([r26.expenses.totalCents, r26.expenses.deferredCents, r26.expenses.deductibleCents], [1_000_000, 666_666, 333_334])
  // Der Überschuss rechnet mit dem abziehbaren Teil: 2 × 12 × 700 € Kaltmiete Soll − 3.333,34 €.
  assert.equal(r26.surplusSollCents, 2 * 12 * 70_000 - 333_334)
  balanced(r26)

  for (const [year, k, rate, restAfter] of [[2027, 2, 333_333, 333_333], [2028, 3, 333_333, 0]] as const) {
    const r = report(src, year)
    const d = row(r, 'spread:dach:2026')
    assert.deepEqual([d.amountCents, d.privateCents, d.deferredCents, d.deductibleCents, d.labor35aCents], [0, 0, -rate, rate, 0], `${year}`)
    assert.deepEqual(d.spreadFrom, { costItemId: 'dach', outflowYear: 2026, index: k, of: 3, baseCents: 1_000_000, grossRateCents: rate, restAfterCents: restAfter })
    assert.equal(d.description, `Anteil ${k} von 3 aus 2026: Dachsanierung`)
    assert.deepEqual([d.category, d.group], [dach.category, dach.group])
    assert.deepEqual([r.expenses.totalCents, r.expenses.deferredCents, r.expenses.deductibleCents], [0, -rate, rate], `${year}`)
    balanced(r)
  }
  assert.equal(report(src, 2029).expenses.items.length, 0)
  assert.equal(report(src, 2025).expenses.items.length, 0)
})

test('Gruppen und Kategorien führen den verschobenen Teil mit', () => {
  const src = house([item({ id: 'dach', spreadYears: 2 }), item({ id: 'verwaltung', description: 'Verwaltervergütung', amountCents: 36_000 })])
  const r = report(src, 2026)
  const g = r.expenses.groups.find((x) => x.group === row(r, 'dach').group) ?? assert.fail('Gruppe fehlt')
  assert.deepEqual([g.amountCents, g.deferredCents, g.deductibleCents], [1_036_000, 500_000, 536_000])
  const c = g.categories.find((x) => x.category === 'Nicht umlagefähig') ?? assert.fail('Kategorie fehlt')
  assert.deepEqual([c.amountCents, c.deferredCents, c.deductibleCents], [1_036_000, 500_000, 536_000])
  // Folgejahr: Betrag 0, verschoben −Rate.
  const r27 = report(src, 2027)
  const g27 = r27.expenses.groups[0] ?? assert.fail('Gruppe fehlt')
  assert.deepEqual([g27.amountCents, g27.deferredCents, g27.deductibleCents], [0, -500_000, 500_000])
  // Ohne Verteilung fehlt das Feld überall.
  const ohne = report(house([item({ id: 'dach' })]), 2026)
  assert.equal('deferredCents' in ohne.expenses, false)
  assert.ok(ohne.expenses.groups.every((x) => !('deferredCents' in x) && x.categories.every((y) => !('deferredCents' in y))))
  assert.ok(ohne.expenses.items.every((x) => !('deferredCents' in x) && !('spread' in x)))
  assert.equal('spread' in ohne.expenses, false)
})

test('40 % Eigennutzung (Fläche): D = 6.000 €, Raten 2.000 €, Bruttoanteil 3.333,34 / 3.333,33 / 3.333,33, abzugsfähig 60 %', () => {
  const src = house([item({ id: 'dach', spreadYears: 3 })], {
    units: [unit('eg', 40, { participates: false, selfUsed: true, selfPersons: 2 }), unit('og', 60)],
    tenancies: [tenancy('b', 'og')],
  })
  const r = report(src, 2026)
  const dach = row(r, 'dach')
  assert.deepEqual([dach.amountCents, dach.privateCents, dach.deferredCents, dach.deductibleCents], [1_000_000, 400_000, 400_000, 200_000])
  assert.deepEqual(dach.spread?.rates, [
    { year: 2026, cents: 200_000, grossCents: 333_334 }, { year: 2027, cents: 200_000, grossCents: 333_333 }, { year: 2028, cents: 200_000, grossCents: 333_333 },
  ])
  assert.deepEqual(r.expenses.spread, {
    started: [{
      costItemId: 'dach', description: 'Dachsanierung', amountCents: 1_000_000, privateCents: 400_000, baseCents: 600_000, deductiblePercent: 60,
      years: 3, grossRateCents: 333_334, rateCents: 200_000, remainingCents: 400_000, direct: false,
    }],
    carried: [],
    thisYearCents: 200_000,
  })
  balanced(r)
  const r27 = report(src, 2027)
  assert.deepEqual(r27.expenses.spread, {
    started: [],
    carried: [{
      costItemId: 'dach', description: 'Dachsanierung', outflowYear: 2026, index: 2, of: 3, baseCents: 600_000, deductiblePercent: 60,
      grossRateCents: 333_333, rateCents: 200_000, remainingCents: 200_000, direct: false,
    }],
    thisYearCents: 200_000,
  })
  // Die Nutzung im Folgejahr ändert D nicht (E-3): Wird die Wohnung 2027 vermietet, bleibt die Rate 2.000 €.
  const vermietet = house(src.costItems, { units: [unit('eg', 40, { participates: false, selfUsed: true, selfPersons: 2, usageChanges: [{ from: '2027-01-01', usage: 'vermietet' }] }), unit('og', 60)], tenancies: [tenancy('b', 'og')] })
  assert.equal(row(report(vermietet, 2026), 'dach').privateCents, 400_000)
  assert.equal(row(report(vermietet, 2027), 'spread:dach:2026').deductibleCents, 200_000)
})

// Die Tochter wohnt in „eg“ (60 m²), ortsüblich wären 900 € warm. Kaltmiete 200 € ergibt 22,22 % (Kürzung), 800 €
// ergeben 88,89 % (entgeltlich). Gekürzt wird die Rate im Jahr ihres Abzugs mit der Quote dieses Jahres.
const local = (monthlyCents: number, from = '2020-01'): LocalRentEntry => ({ from, monthlyCents, source: 'Mietspiegel Musterstadt', sourceDate: '2025-04-01' })
const family = (costItems: Item[], rents: { from: string; monthlyCents: number }[]): TaxSource => house(costItems, {
  units: [unit('eg', 60, { localRents: [local(90_000)] }), unit('og', 40)],
  tenancies: [tenancy('tochter', 'eg', { baseRents: rents }), tenancy('fremd', 'og')],
})

test('verbilligte Vermietung, Quote wechselt: Rate 2026 gekürzt (22,22 %), Rate 2027 ungekürzt (88,89 %), und umgekehrt (V1, I-9)', () => {
  const cheapFirst = family([item({ id: 'dach', spreadYears: 2 })], [{ from: '2020-01', monthlyCents: 20_000 }, { from: '2027-01', monthlyCents: 80_000 }])
  const r26 = report(cheapFirst, 2026)
  // Rate 5.000 € × 60/100 × (1 − 2.400/10.800) = 2.333,333… → 2.333,33 € unentgeltlich.
  const dach = row(r26, 'dach')
  assert.deepEqual([dach.amountCents, dach.privateCents, dach.gratuitousCents, dach.deferredCents, dach.deductibleCents], [1_000_000, 0, 233_333, 500_000, 266_667])
  balanced(r26)
  const d27 = row(report(cheapFirst, 2027), 'spread:dach:2026')
  assert.deepEqual([d27.gratuitousCents, d27.deductibleCents], [undefined, 500_000])

  const cheapLater = family([item({ id: 'dach', spreadYears: 2 })], [{ from: '2020-01', monthlyCents: 80_000 }, { from: '2027-01', monthlyCents: 20_000 }])
  assert.deepEqual([row(report(cheapLater, 2026), 'dach').gratuitousCents, row(report(cheapLater, 2026), 'dach').deductibleCents], [undefined, 500_000])
  const r27 = report(cheapLater, 2027)
  const later = row(r27, 'spread:dach:2026')
  assert.deepEqual([later.amountCents, later.gratuitousCents, later.deferredCents, later.deductibleCents], [0, 233_333, -500_000, 266_667])
  assert.ok(later.steps.some((s) => s.term === 'cheapRent'), JSON.stringify(later.steps))
  assert.equal(r27.expenses.gratuitousCents, 233_333)
  balanced(r27)
  // I-9 von Hand: dieselbe Kürzung wie eine unverteilte Position über 5.000 € mit denselben Einheiten im Jahr 2027.
  const twin = family([item({ id: 'zwilling', period: periodKey('2027-01'), amountCents: 500_000 })], [{ from: '2020-01', monthlyCents: 80_000 }, { from: '2027-01', monthlyCents: 20_000 }])
  assert.equal(row(report(twin, 2027), 'zwilling').gratuitousCents, later.gratuitousCents)
})

test('verbilligte Vermietung, direkt der Wohnung zugeordnet: Kürzung der Rate mit Gewicht 1', () => {
  const src = family([item({ id: 'bad', key: 'direct', directUnitId: 'eg', amountCents: 300_000, spreadYears: 3 })], [{ from: '2020-01', monthlyCents: 20_000 }])
  // Rate 1.000 € × (1 − 2.400/10.800) = 777,78 € unentgeltlich, in jedem der drei Jahre.
  assert.deepEqual([row(report(src, 2026), 'bad').gratuitousCents, row(report(src, 2026), 'bad').deductibleCents], [77_778, 22_222])
  assert.deepEqual([row(report(src, 2028), 'spread:bad:2026').gratuitousCents, row(report(src, 2028), 'spread:bad:2026').deductibleCents], [77_778, 22_222])
})

test('Mai bis April, Zahlungsdatum im Folgejahr: die Verteilung beginnt im Jahr der Zahlung', () => {
  const mai: PeriodRules = { startMonth: 5, changes: [] }
  const src = house([item({ id: 'dach', period: periodKey('2025-05'), paidOn: '2026-03-10', spreadYears: 2, amountCents: 400_001 })], { rules: mai })
  assert.equal(report(src, 2025).expenses.items.some((x) => x.costItemId === 'dach' || x.costItemId.startsWith('spread:')), false)
  const dach = row(report(src, 2026), 'dach')
  assert.deepEqual([dach.deferredCents, dach.deductibleCents], [200_000, 200_001])
  assert.deepEqual(dach.outflow, { year: 2026, source: 'paid', paidOn: '2026-03-10' })
  assert.equal(row(report(src, 2027), 'spread:dach:2026').deductibleCents, 200_000)
  assert.equal(report(src, 2028).expenses.items.length, 0)
})

test('Entnahme aus der Erhaltungsrücklage verteilt: Gruppe „Erhaltungsaufwand“ auch in den Folgejahren', () => {
  const src = house([item({ id: 'e', category: RESERVE_WITHDRAWAL_CATEGORY, description: 'Fassade laut Hausgeldabrechnung', amountCents: 124_000, key: 'external', spreadYears: 3 })])
  const r = report(src, 2026)
  assert.deepEqual([row(r, 'e').group, row(r, 'e').deductibleCents, row(r, 'e').deferredCents], ['Erhaltungsaufwand', 41_334, 82_666])
  const d = row(report(src, 2028), 'spread:e:2026')
  assert.deepEqual([d.group, d.category, d.deductibleCents], ['Erhaltungsaufwand', RESERVE_WITHDRAWAL_CATEGORY, 41_333])
})

test('vorzeitiges Ende (§ 82b Abs. 2) am Objekt: der Rest im Jahr des Endes, danach nichts', () => {
  const src = house([item({ id: 'dach', spreadYears: 5, amountCents: 1_000_003 })], { restYear: 2027 })
  const dach = row(report(src, 2026), 'dach')
  assert.deepEqual([dach.deferredCents, dach.deductibleCents], [800_002, 200_001])
  assert.deepEqual(dach.spread?.rates, [{ year: 2026, cents: 200_001, grossCents: 200_001 }, { year: 2027, cents: 800_002, grossCents: 800_002, rest: true }])
  const d = row(report(src, 2027), 'spread:dach:2026')
  assert.deepEqual([d.deductibleCents, d.spreadFrom?.rest, d.spreadFrom?.restAfterCents, d.spreadFrom?.index, d.spreadFrom?.of], [800_002, true, 0, 2, 5])
  assert.equal(report(src, 2028).expenses.items.length, 0)
  // Der Rechenweg nennt den tatsächlichen Zeitraum des Abzugs, nicht den gewählten.
  const step = dach.steps.find((x) => x.label === 'Verteilung nach § 82b EStDV') ?? assert.fail('Schritt fehlt')
  assert.ok(step.value.includes('(2026 bis 2027)') && !step.value.includes('2030'), step.value)
  // Ende im Jahr der Zahlung oder davor: nicht verteilt.
  const early = row(report(house(src.costItems, { restYear: 2026 }), 2026), 'dach')
  assert.deepEqual([early.deductibleCents, 'deferredCents' in early, 'spread' in early], [1_000_003, false, false])
})

test('D = 0 (direkt der selbstgenutzten Wohnung): die Wahl hat keine Wirkung, Folgejahre ohne Zeile', () => {
  const src = house([item({ id: 'bad', key: 'direct', directUnitId: 'eg', spreadYears: 3 })], {
    units: [unit('eg', 40, { participates: false, selfUsed: true, selfPersons: 2 }), unit('og', 60)],
    tenancies: [tenancy('b', 'og')],
  })
  const bad = row(report(src, 2026), 'bad')
  assert.deepEqual([bad.privateCents, bad.deferredCents, bad.deductibleCents, bad.spread?.baseCents], [1_000_000, 0, 0, 0])
  assert.equal(report(src, 2027).expenses.items.length, 0)
})

test('eine Wahl, wo nicht verteilt werden kann (Ablage von Hand), zählt nicht und wird genannt', () => {
  const src = house([item({ id: 'gs', category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 60_000, spreadYears: 2 })])
  const r = report(src, 2026)
  assert.equal(row(r, 'gs').deductibleCents, 60_000)
  assert.deepEqual(r.spreadIgnored, [{ costItemId: 'gs', description: 'Grundsteuer' }])
  assert.equal(report(src, 2027).expenses.items.length, 0)
  assert.equal('spreadIgnored' in report(house([item({ id: 'dach', spreadYears: 2 })]), 2026), false)
})

test('Rechenweg: die Position nennt die Verteilung, die Zeile des Folgejahres ihre Herkunft', () => {
  const src = house([item({ id: 'dach', spreadYears: 3 })])
  const steps = row(report(src, 2026), 'dach').steps
  assert.ok(steps.some((s) => s.label === 'Verteilung nach § 82b EStDV' && s.value.includes('10.000,00 €') && s.value.includes('3 Jahre') && s.value.includes('2026 bis 2028')), JSON.stringify(steps))
  const later = row(report(src, 2027), 'spread:dach:2026').steps
  assert.ok(later.some((s) => s.value.includes('Anteil 2 von 3') && s.value.includes('3.333,33 €')), JSON.stringify(later))
  // #262 PR 3: Beide Schritte verweisen auf den Begriff im Lexikon.
  for (const s of [...steps, ...later].filter((x) => x.label === 'Verteilung nach § 82b EStDV')) assert.equal(s.term, 'spread82b', JSON.stringify(s))
})

test('Sonderumlage unter „Nicht umlagefähig“ mit gewählter Verteilung: Hinweis auch ohne Zahlungsdatum (Durchsicht X3)', () => {
  const r = report(house([item({ id: 's', description: 'Sonderumlage Dach', spreadYears: 3 })]), 2026)
  assert.deepEqual(r.specialLevySuspects, [{ costItemId: 's', description: 'Sonderumlage Dach', amountCents: 1_000_000, category: 'Nicht umlagefähig' }])
  assert.equal('specialLevySuspects' in report(house([item({ id: 's', description: 'Sonderumlage Dach' })]), 2026), false)
})

test('Teile einer Rechnung werden je Teil verteilt, die Summe über alle Jahre bleibt centgenau', () => {
  const src = house([
    item({ id: 'a', sourceId: 'q', amountCents: 500_001, spreadYears: 3 }),
    item({ id: 'b', sourceId: 'q', amountCents: 500_001, spreadYears: 3 }),
  ])
  const years = [2026, 2027, 2028].map((y) => report(src, y).expenses.deductibleCents)
  assert.deepEqual(years, [333_334, 333_334, 333_334])
  assert.equal(years.reduce((a, b) => a + b, 0), 1_000_002)
})

test('die Abrechnung für die Mieter liest die Wahl nicht (I-6, von Hand)', () => {
  const ohne = house([item({ id: 'dach' }), item({ id: 'gs', category: 'Grundsteuer', amountCents: 60_000 })])
  const mit = house([item({ id: 'dach', spreadYears: 5 }), item({ id: 'gs', category: 'Grundsteuer', amountCents: 60_000, spreadYears: 2 })], { restYear: 2027 })
  const p = periodOfKey(rulesOf(ohne.properties?.[0]), periodKey('2026-01')) ?? assert.fail('kein Zeitraum')
  assert.deepEqual(computeSettlement(snapshotFor(mit, P, p)), computeSettlement(snapshotFor(ohne, P, p)))
})

// Wächter (Suche im Quelltext, E-2, E-14): Die Jahre des Abzugs rechnet nur outflow.ts. In calc.ts steht die Wahl nur in
// der Steuerübersicht, und dort nur als Weitergabe an `deductionPlan`; das Ende am Objekt liest nur `taxReportFor`. Die
// Abrechnung, das Mietkonto, der Verbrauch und der Schnappschuss lesen beide nie.
const source = (file: string): string => fs.readFileSync(new URL(file, import.meta.url), 'utf8')
const withoutComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n')
const bodyOf = (code: string, head: string): string => {
  const at = code.indexOf(head)
  if (at < 0) return assert.fail(`${head} nicht gefunden`)
  const next = code.slice(at + head.length).search(/\n(export )?function /)
  return code.slice(at, next < 0 ? undefined : at + head.length + next)
}

test('Wächter: spreadYears und spreadRestYear liest in calc.ts nur die Steuerübersicht, über deductionPlan', () => {
  const calc = withoutComments(source('../src/calc.ts'))
  const allowed = [bodyOf(calc, 'export function taxReport('), bodyOf(calc, 'export function taxReportFor('), bodyOf(calc, 'function carriedRates(')]
  const outside = allowed.reduce((s, b) => s.replace(b, ''), calc)
  assert.equal(/spreadYears|spreadRestYear/.test(outside), false, 'die Wahl wird außerhalb der Steuerübersicht gelesen')
  // In der Steuerübersicht nur als Weitergabe: kein eigener Vergleich mit der Zahl der Jahre.
  for (const b of allowed) assert.equal(/\.spreadYears\b/.test(b), false, 'spreadYears wird in calc.ts gelesen statt über deductionPlan')
  for (const name of ['export function computeSettlement(', 'export function rentLedger(', 'export function consumptionOverview(']) {
    assert.equal(/spread/i.test(bodyOf(calc, name)), false, `${name} kennt die Verteilung`)
  }
  const snapshot = withoutComments(source('../src/snapshot.ts'))
  assert.equal(/spreadRestYear/.test(snapshot.replace(/properties\?: \(SnapshotProperty[^\n]*\n/, '')), false, 'der Schnappschuss führt das Ende der Verteilung')
  // Der Rückgriff auf das Jahr des Abflusses rechnet keine Tilgung und sucht selbst keine Vorjahre (E-6).
  assert.match(bodyOf(calc, 'function carriedRates('), /carried: false, received: false/)
})

// Entwurf PR 2, Test 7 (Durchsicht): Der Rückgriff auf das Jahr des Abflusses rechnet ohne Tilgung der Einnahmen und ohne
// eigene Vorjahre, je Jahr des Abflusses einmal; ein Bestand ohne Wahl rechnet keinen. Beobachtet über die Naht
// `reportOf` von `carriedRates` (Vorgabe `taxReportFor`).
test('Rückgriff: einmal je Jahr des Abflusses, ohne received und ohne Vorjahre; ohne Wahl gar nicht', () => {
  const calls: { year: number; options: unknown; report: TaxReport }[] = []
  const spy: typeof taxReportFor = (src, pid, year, parts, options) => {
    const r = taxReportFor(src, pid, year, parts, options)
    calls.push({ year, options, report: r })
    return r
  }
  const src = house([item({ id: 'dach', spreadYears: 3 }), item({ id: 'fenster', description: 'Fenster', amountCents: 300_000, spreadYears: 2 })], {
    tenancies: [tenancy('a', 'eg'), tenancy('b', 'og')],
  })
  const withPayments = { ...src, payments: [{ id: 'z1', tenancyId: 'a', date: '2026-03-01', amountCents: 70_000 }] }
  const all = withPayments.costItems
  const rates = carriedRates(withPayments, P, 2027, all, null, spy)
  assert.equal(rates.length, 2)
  assert.deepEqual(calls.map((c) => [c.year, c.options]), [[2026, { carried: false, received: false }]])
  assert.equal(calls[0]?.report.income.received, undefined)
  // Der eigene Bericht des Jahres hat sein Zugeflossenes.
  assert.notEqual(taxReportFor(withPayments, P, 2026).income.received, undefined)
  calls.length = 0
  assert.deepEqual(carriedRates(house([item({ id: 'dach' })]), P, 2027, [item({ id: 'dach' })], null, spy), [])
  assert.equal(calls.length, 0)
})

// Eigennutzung und verbilligte Vermietung zugleich (Durchsicht): EG 40 m² selbstgenutzt, OG 60 m² an die Tochter für
// 200 € kalt, ortsüblich 900 € warm (22,22 %). 10.000 € auf 2 Jahre: privat 4.000 €, D = 6.000 €, Raten 3.000 €,
// Bruttoanteil 5.000 €. Kürzung je Jahr: 5.000 € × 60/100 × (1 − 2.400/10.800) = 2.333,333… → 2.333,33 €, aus der Rate
// genommen: abziehbar 666,67 €. Über beide Jahre 4.666,66 € unentgeltlich, unverteilt wären es 4.666,67 € (Rundung je
// Jahr); Σ abziehbar + unentgeltlich ist in beiden Fällen D.
test('Eigennutzung und verbilligte Vermietung zugleich: Kürzung je Jahr über den Bruttoanteil, privat fest aus dem Jahr der Zahlung', () => {
  const src = house([item({ id: 'dach', spreadYears: 2 })], {
    units: [unit('eg', 40, { participates: false, selfUsed: true, selfPersons: 2 }), unit('og', 60, { localRents: [local(90_000)] })],
    tenancies: [tenancy('tochter', 'og', { baseRents: [{ from: '2020-01', monthlyCents: 20_000 }] })],
  })
  const r26 = report(src, 2026)
  const dach = row(r26, 'dach')
  assert.deepEqual([dach.amountCents, dach.privateCents, dach.gratuitousCents, dach.deferredCents, dach.deductibleCents], [1_000_000, 400_000, 233_333, 300_000, 66_667])
  assert.deepEqual(dach.spread?.rates, [{ year: 2026, cents: 300_000, grossCents: 500_000 }, { year: 2027, cents: 300_000, grossCents: 500_000 }])
  balanced(r26)
  const d27 = row(report(src, 2027), 'spread:dach:2026')
  assert.deepEqual([d27.privateCents, d27.gratuitousCents, d27.deferredCents, d27.deductibleCents], [0, 233_333, -300_000, 66_667])
  const unverteilt = row(report(house([item({ id: 'dach' })], { units: src.units, tenancies: src.tenancies }), 2026), 'dach')
  assert.deepEqual([unverteilt.privateCents, unverteilt.gratuitousCents, unverteilt.deductibleCents], [400_000, 466_667, 133_333])
})

// Kein Einfrieren abgegebener Jahre (Entscheidung U-1): Wird eine verteilte Position nach Y0 gelöscht oder auf eine
// Kostenart umgestellt, an der nicht verteilt werden kann, entfällt ihr Anteil im Folgejahr; die übrigen Raten und das
// Jahr Y0 der anderen Position bleiben, wie sie waren.
test('U-1: Position gelöscht oder Kostenart geändert: Folgejahr ohne ihre Zeile, die andere Verteilung unverändert', () => {
  const fenster = item({ id: 'fenster', description: 'Fenster', amountCents: 300_000, spreadYears: 2 })
  const before = house([item({ id: 'dach', spreadYears: 3 }), fenster])
  assert.equal(row(report(before, 2027), 'spread:dach:2026').deductibleCents, 333_333)
  const deleted = house([fenster])
  const changed = house([item({ id: 'dach', category: 'Grundsteuer', spreadYears: 3 }), fenster])
  for (const [label, src] of [['gelöscht', deleted], ['Kostenart geändert', changed]] as const) {
    const r27 = report(src, 2027)
    assert.equal(r27.expenses.items.some((x) => x.costItemId === 'spread:dach:2026'), false, label)
    assert.deepEqual(row(r27, 'spread:fenster:2026'), row(report(before, 2027), 'spread:fenster:2026'), label)
    assert.deepEqual(row(report(src, 2026), 'fenster'), row(report(before, 2026), 'fenster'), label)
  }
  // Umgestellt: in Y0 ganz abgezogen, als nicht verteilte Wahl genannt.
  const r26 = report(changed, 2026)
  assert.deepEqual([row(r26, 'dach').deductibleCents, 'spread' in row(r26, 'dach')], [1_000_000, false])
  assert.deepEqual(r26.spreadIgnored, [{ costItemId: 'dach', description: 'Dachsanierung' }])
})

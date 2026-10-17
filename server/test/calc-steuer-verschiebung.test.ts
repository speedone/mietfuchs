// Die Steuerübersicht zeigt, was zwischen den Jahren verschoben ist (#255, PR 4). Gerechnet wird nichts Neues: Welche
// Position in welchem Steuerjahr steht, entscheidet weiter `outflowShares` (outflow.ts). Neu sind nur Auskünfte:
//   - je Position das Jahr der Zahlung samt Quelle (`outflow`) und bei einer Position aus einem Abrechnungszeitraum, der
//     das Steuerjahr nicht berührt, dieser Zeitraum (`settlementPeriod`, „aus Abrechnung 2026, bezahlt 2027“),
//   - umgekehrt die Positionen der Abrechnungen, die in diesem Jahr beginnen, aber in einem anderen Jahr abgeflossen
//     sind (`movedOut`); sie zählen nicht in der Summe,
//   - wie viele Positionen des Jahres ohne Angabe im Jahr ihrer Abrechnung stehen (`expenses.unstatedCount`),
//   - ein Datum außerhalb der üblichen Spanne (Beginn − 1 bis Ende + 3, R-4) wird markiert (`outsideSpan`), weil ein
//     reiner Wechsel des Zeitraums nicht neu fragt (Durchsicht von PR 3, K8).
// Dass sich keine Zahl ändert, halten die Gleichheitsinvariante in outflow.test.ts und test/fixtures/tax-golden.json fest.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { taxReportFor } from '../src/calc.ts'
import { makeRng, randomTaxStock, TAX_STOCK_PROPERTY, type TaxSource } from '../testing/taxStock.ts'
import { CALENDAR_RULES, periodKey, startYearOf } from '../../shared/period.ts'
import type { CostKey, PeriodRules, TaxReport } from '../../shared/types.ts'

const MAI: PeriodRules = { startMonth: 5, changes: [] }
type ItemIn = Omit<TaxSource['costItems'][number], 'propertyId' | 'key' | 'category'> & { category?: string; key?: CostKey }
const haus = (rules: PeriodRules, costItems: ItemIn[]): TaxSource => ({
  properties: [{ id: TAX_STOCK_PROPERTY, kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: rules }],
  units: [
    { id: 'eg', propertyId: TAX_STOCK_PROPERTY, name: 'EG', areaM2: 50, participates: false, selfUsed: true },
    { id: 'og', propertyId: TAX_STOCK_PROPERTY, name: 'OG', areaM2: 50, participates: true },
  ],
  tenancies: [{ id: 't1', unitId: 'og', tenantName: 'A', persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] }],
  costItems: costItems.map((c) => ({ category: 'Sach- und Haftpflichtversicherung', key: 'area' as const, ...c, propertyId: TAX_STOCK_PROPERTY })),
  meters: [], readings: [], payments: [], closedSettlements: [],
} as TaxSource)
const report = (src: TaxSource, year: number): TaxReport => taxReportFor(src, TAX_STOCK_PROPERTY, year)
const itemOf = (r: TaxReport, id: string) => r.expenses.items.find((i) => i.costItemId === id) ?? assert.fail(`${id} fehlt in ${r.year}`)

test('Fall 1: Abrechnung 2026, bezahlt 2027. 2027 nennt die Herkunft, 2026 nennt die Verschiebung', () => {
  const src = haus(CALENDAR_RULES, [
    { id: 'gs', period: periodKey('2026-01'), description: 'Grundsteuer 2026', amountCents: 62000, category: 'Grundsteuer', paidOn: '2027-02-10' },
    { id: 'vers', period: periodKey('2026-01'), description: 'Versicherung 2026', amountCents: 125000 },
  ])
  const r27 = report(src, 2027)
  const gs = itemOf(r27, 'gs')
  assert.deepEqual(gs.settlementPeriod, { key: '2026-01', label: '2026' })
  assert.deepEqual(gs.outflow, { year: 2027, source: 'paid', paidOn: '2027-02-10' })
  assert.equal(gs.outsideSpan, undefined)
  assert.deepEqual(r27.movedOut, [])
  assert.equal(r27.expenses.unstatedCount, 0)

  const r26 = report(src, 2026)
  assert.deepEqual(r26.expenses.items.map((i) => i.costItemId), ['vers'])
  const vers = itemOf(r26, 'vers')
  assert.equal(vers.settlementPeriod, undefined, 'im eigenen Jahr keine Herkunft')
  assert.deepEqual(vers.outflow, { year: 2026, source: 'period' })
  assert.deepEqual(r26.movedOut, [{
    costItemId: 'gs', category: 'Grundsteuer', description: 'Grundsteuer 2026', amountCents: 62000,
    settlementPeriod: { key: '2026-01', label: '2026' }, outflow: { year: 2027, source: 'paid', paidOn: '2027-02-10' },
  }])
  assert.equal(r26.expenses.totalCents, 125000, 'die verschobene Position zählt nicht mit')
  assert.equal(r26.expenses.unstatedCount, 1)
})

test('Fall 2: vor Beginn bezahlt. 2025 nennt die Herkunft 2026, 2026 nennt die Verschiebung nach 2025', () => {
  const src = haus(CALENDAR_RULES, [{ id: 'vers', period: periodKey('2026-01'), description: 'Versicherung 2026', amountCents: 125000, paidOn: '2025-12-01' }])
  const vers = itemOf(report(src, 2025), 'vers')
  assert.deepEqual(vers.settlementPeriod, { key: '2026-01', label: '2026' })
  assert.deepEqual(vers.outflow, { year: 2025, source: 'paid', paidOn: '2025-12-01' })
  const r26 = report(src, 2026)
  assert.deepEqual(r26.movedOut.map((m) => [m.costItemId, m.outflow.year]), [['vers', 2025]])
  assert.deepEqual(report(src, 2025).movedOut, [])
})

test('Mai bis April: das Jahr der Zahlung im Zeitraum ist keine Verschiebung, Ende + 1 schon', () => {
  const src = haus(MAI, [
    { id: 'im', period: periodKey('2025-05'), description: 'Versicherung 2025/2026', amountCents: 60000, taxYear: 2026 },
    { id: 'nach', period: periodKey('2025-05'), description: 'Wasser 2025/2026', amountCents: 20000, taxYear: 2027 },
  ])
  const r26 = report(src, 2026)
  assert.equal(itemOf(r26, 'im').settlementPeriod, undefined)
  assert.deepEqual(itemOf(r26, 'im').outflow, { year: 2026, source: 'stated' })
  assert.deepEqual(report(src, 2025).movedOut.map((m) => [m.costItemId, m.settlementPeriod.label, m.outflow]), [['nach', '2025/2026', { year: 2027, source: 'stated' }]])
  assert.deepEqual(r26.movedOut, [], 'nur in der Übersicht des Jahres, in dem der Zeitraum beginnt')
  assert.deepEqual(itemOf(report(src, 2027), 'nach').settlementPeriod, { key: '2025-05', label: '2025/2026' })
  assert.equal(r26.expenses.unstatedCount, 0, 'ein angegebenes Jahr ist eine Angabe')
})

test('Durchsicht PR 3, K8: ein Datum außerhalb von Beginn − 1 bis Ende + 3 wird markiert, gerechnet wird wie angegeben', () => {
  const src = haus(CALENDAR_RULES, [
    { id: 'spaet', period: periodKey('2026-01'), description: 'Grundsteuer 2026', amountCents: 30000, category: 'Grundsteuer', paidOn: '2030-03-01' },
    { id: 'rand', period: periodKey('2026-01'), description: 'Grundsteuer Nachzahlung', amountCents: 10000, category: 'Grundsteuer', paidOn: '2029-03-01' },
  ])
  assert.equal(itemOf(report(src, 2030), 'spaet').outsideSpan, true)
  assert.equal(itemOf(report(src, 2029), 'rand').outsideSpan, undefined, '2029 ist Ende + 3')
  const out = report(src, 2026).movedOut
  assert.deepEqual(out.map((m) => [m.costItemId, m.outsideSpan ?? false]), [['spaet', true], ['rand', false]])
})

test('ohne Angabe: Hausgeld laut Gemeinschaftsabrechnung zählt nicht, denn dort gibt es kein Datum (R-6)', () => {
  const src = haus(CALENDAR_RULES, [
    { id: 'a', period: periodKey('2026-01'), description: 'Versicherung', amountCents: 10000 },
    { id: 'b', period: periodKey('2026-01'), description: 'Müll', amountCents: 10000, category: 'Müllabfuhr' },
    { id: 'weg', period: periodKey('2026-01'), description: 'Hausgeld', amountCents: 10000, category: 'Verwaltungskosten', key: 'external' },
    { id: 'c', period: periodKey('2026-01'), description: 'Wasser', amountCents: 10000, category: 'Wasserversorgung', paidOn: '2026-03-01' },
  ])
  const r = report(src, 2026)
  assert.equal(r.expenses.unstatedCount, 2)
  assert.deepEqual(itemOf(r, 'c').outflow, { year: 2026, source: 'paid', paidOn: '2026-03-01' })
  assert.equal(itemOf(r, 'c').settlementPeriod, undefined)
})

// Durchsicht von PR 4, M1: Eine Heizposition unter eigener Heizperiode hat deren Zeitraum, auch wenn ihre Abrechnung kein
// Teil des Jahres ist und ein Abrechnungszeitraum des Objekts denselben Schlüssel trägt. Hier: Mai bis April mit Wechsel
// auf Kalender 2027, also Rumpf 2026-05 = 01.05.–31.12.2026; die Anlage heizt ab Mai, Heizperiode 2026-05 =
// 01.05.2026–30.04.2027. Gas der Heizperiode, bezahlt 2027, ist keine Verschiebung.
test('Heizposition unter eigener Heizperiode: Zeitraum aus der Heizperiode, nicht aus dem Rumpf gleichen Schlüssels (M1)', () => {
  const rules: PeriodRules = { startMonth: 5, changes: [periodKey('2027-01')] }
  const plant = {
    id: 'hp1', propertyId: TAX_STOCK_PROPERTY, name: 'Kessel', method: 'manual' as const, source: 'building' as const, supply: 'central' as const, energy: 'gas' as const,
    devicesRemote: 'unknown' as const, devicesInstalledAfter2021: 'unknown' as const, newDevicesInstall: null, units: null,
    periodStartMonth: 5, periodChanges: [], separateSpans: [], separateSettlement: false, endsOn: null, replacesPlantId: null,
  }
  const gas = (id: string, taxYear: number) => ({ id, period: periodKey('2026-05'), description: `Gas ${id}`, amountCents: 300000, category: 'Heizung und Warmwasser', heatingPlantId: 'hp1', heatingPart: 'fuel' as const, taxYear })
  const src = { ...haus(rules, [gas('im', 2027), gas('nach', 2028)]), heatingPlants: [plant] } as TaxSource
  const r26 = report(src, 2026)
  assert.deepEqual(r26.movedOut.map((m) => [m.costItemId, m.settlementPeriod.label, m.outflow.year]), [['nach', 'Heizkosten 2026/2027', 2028]])
  const r27 = report(src, 2027)
  assert.equal(itemOf(r27, 'im').settlementPeriod, undefined)
  assert.deepEqual(itemOf(report(src, 2028), 'nach').settlementPeriod, { key: '2026-05', label: 'Heizkosten 2026/2027' })
})

// Gegenseitigkeit: Jede verschobene Position steht genau einmal als Herkunft (im Jahr ihrer Zahlung) und genau einmal
// als Verschiebung (im Jahr, in dem ihr Zeitraum beginnt); eine Position im eigenen Zeitraum nirgends. Zufällige
// Bestände mit zufälligen Daten wie in calc-steuer-zahlungsdatum.test.ts.
const SEEDS = Array.from({ length: Number(process.env.INV_TO ?? 20) - Number(process.env.INV_FROM ?? 1) + 1 }, (_, k) => Number(process.env.INV_FROM ?? 1) + k)
test('Invariante: jede Verschiebung genau einmal auf beiden Seiten, ohne Einfluss auf die Summe', () => {
  let moved = 0
  // Zwei Folgen von Startwerten: Die zweite (·31337) erzeugt den Rumpf am Wechsel neben einer Heizperiode gleichen
  // Schlüssels (Durchsicht von PR 4, M1), den die erste kaum trifft.
  for (const seed of SEEDS.flatMap((s) => [s * 7919, s * 31337])) {
    const rnd = makeRng(seed)
    const { source } = randomTaxStock(rnd)
    const items = source.costItems.map((c) => {
      if (c.operatingPower === 'deduction' || c.key === 'external' || rnd() < 0.4) return c
      const start = Number(c.period.slice(0, 4))
      return { ...c, paidOn: `${start - 2 + Math.floor(rnd() * 7)}-${rnd() < 0.5 ? '01-05' : '12-28'}` }
    })
    const src: TaxSource = { ...source, costItems: items }
    const labelIn = new Map<string, string>()
    const labelOut = new Map<string, string>()
    const movedIn = new Map<string, number[]>()
    const movedOut = new Map<string, number[]>()
    for (let y = 2020; y <= 2035; y++) {
      const r = report(src, y)
      for (const i of r.expenses.items) {
        if (i.operatingPowerBalance || i.co2RefundPaidOut) continue
        assert.equal(i.outflow?.year, y, `Startwert ${seed}, ${i.costItemId} in ${y}`)
        if (i.settlementPeriod) {
          movedIn.set(i.costItemId, [...(movedIn.get(i.costItemId) ?? []), y])
          labelIn.set(i.costItemId, i.settlementPeriod.label)
        }
      }
      const counted = new Set(r.expenses.items.map((i) => i.costItemId))
      for (const m of r.movedOut) {
        assert.ok(!counted.has(m.costItemId), `Startwert ${seed}: ${m.costItemId} zählt in ${y} und ist zugleich verschoben`)
        assert.notEqual(m.outflow.year, y)
        movedOut.set(m.costItemId, [...(movedOut.get(m.costItemId) ?? []), y])
        labelOut.set(m.costItemId, m.settlementPeriod.label)
      }
      const unstated = r.expenses.items.filter((i) => i.outflow?.source === 'period' && !src.costItems.some((c) => c.id === i.costItemId && (c.operatingPower === 'deduction' || c.key === 'external')))
      assert.equal(r.expenses.unstatedCount, unstated.length, `Startwert ${seed}, ${y}: ohne Angabe`)
    }
    for (const c of items) {
      const ins = movedIn.get(c.id) ?? []
      const outs = movedOut.get(c.id) ?? []
      assert.equal(ins.length, outs.length, `Startwert ${seed}: ${c.id} Herkunft ${ins.join(',')} / Verschiebung ${outs.join(',')}`)
      assert.ok(ins.length <= 1, `Startwert ${seed}: ${c.id} mehrfach`)
      if (outs.length === 1) assert.equal(outs[0], startYearOf(c.period), `Startwert ${seed}: ${c.id} im Jahr des Beginns`)
      assert.equal(labelOut.get(c.id), labelIn.get(c.id), `Startwert ${seed}: ${c.id} heißt auf beiden Seiten gleich`)
      // Beim Kalenderzeitraum ist jede Zahlung in einem anderen Jahr eine Verschiebung.
      if (c.paidOn !== undefined && c.period.endsWith('-01') && source.properties?.[0]?.periodRules?.startMonth === 1 && c.category !== 'Zuführung Erhaltungsrücklage') {
        assert.equal(ins.length, Number(c.paidOn.slice(0, 4)) !== startYearOf(c.period) ? 1 : 0, `Startwert ${seed}: ${c.id}`)
      }
      moved += ins.length
    }
  }
  assert.ok(moved > 30, `verschobene Positionen: ${moved}`)
})

// #712: Die zweite Vorauszahlung (Heizstaffel) deckt auf Wunsch auch die Kostenart „Wasser/Abwasser“, was der Messdienst
// oft mit abrechnet. Die Angabe steht an der Heizanlage (`secondPrepaymentCoversWater`) und wirkt nur in einer gemeinsamen
// Abrechnung: Der Teil des Vorschlags nach § 560 Abs. 4 BGB für die zweite Vorauszahlung zählt dann auch die Zeilen dieser
// Kostenart, und die Aufstellung trägt die Angabe für den Ausweis. Keine Summe ändert sich.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { snapshotFor } from '../src/snapshot.ts'
import { CALENDAR_RULES, periodKey, periodOfKey } from '../../shared/period.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { WATER_CATEGORY } from '../../shared/heatingModel.ts'
import { integrationStock, INTEGRATION_PROPERTY } from '../testing/integration013.ts'
import type { BillingPeriod, PeriodRules, SeparateSpan } from '../../shared/types.ts'

type Source = Parameters<typeof snapshotFor>[0]
const of = (rules: PeriodRules, key: string): BillingPeriod => periodOfKey(rules, periodKey(key)) ?? assert.fail(`kein Zeitraum ${key}`)

type PlantOver = { id?: string; name?: string; periodStartMonth?: number | null; separateSpans?: SeparateSpan[]; separateSettlement?: boolean | null; secondPrepaymentCoversWater?: boolean; endsOn?: string | null; replacesPlantId?: string | null; units?: { unitId: string; heatedAreaM2: number | null }[] | null }
const anlage = (over: PlantOver = {}) => ({
  id: 'hp1', propertyId: 'objekt-1', name: '', method: 'service' as const, source: 'building' as const,
  energy: 'gas' as const, devicesRemote: 'unknown' as const, devicesInstalledAfter2021: 'unknown' as const, newDevicesInstall: null, units: null,
  periodStartMonth: null, periodChanges: [], separateSpans: [], separateSettlement: true, ...over,
})
const mieter = (id: string, unitId: string, over: Record<string, unknown> = {}) => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [{ from: '2024-01-01', persons: 1 }], start: '2024-01-01', end: null,
  prepayments: [{ from: '2024-01', monthlyCents: 18000 }], heatingPrepayments: [{ from: '2024-01', monthlyCents: 12000 }], prepaymentOverrides: {}, baseRents: [], ...over,
})
const position = (id: string, key: string, amountCents: number, over: Record<string, unknown> = {}) => ({
  id, propertyId: 'objekt-1', period: periodKey(key), category: 'Grundsteuer', description: id, amountCents, key: 'area' as const, ...over,
})
const haus = (over: Partial<Source> = {}): Source => ({
  properties: [{ id: 'objekt-1', kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: CALENDAR_RULES }],
  units: [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true }],
  tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [], heatingPlants: [anlage()],
  ...over,
} as Source)
const settle = (src: Source, key: string, rules: PeriodRules = CALENDAR_RULES): ComputedSettlement =>
  computeSettlement(snapshotFor(src, 'objekt-1', of(rules, key)))
const st = (s: ComputedSettlement, id: string) => s.statements.find((x) => x.tenancyId === id) ?? assert.fail(`${id} fehlt`)
// 1.500 € Heizung, 600 € Wasser/Abwasser, 2.000 € Grundsteuer: 4.100 € im Jahr, 341,67 € je Monat, auf volle Euro 342 €.
const kosten = (plantId = 'hp1') => [
  position('gas', '2025-01', 150000, { category: HEATING_CATEGORY, heatingPlantId: plantId }),
  position('wasser', '2025-01', 60000, { category: WATER_CATEGORY }),
  position('grundsteuer', '2025-01', 200000),
]
const sums = (s: ComputedSettlement) => ({
  total: s.totalCostsCents, landlord: s.landlord, selfUsed: s.selfUsedShareCents,
  statements: s.statements.map((x) => [x.tenancyId, x.totalShareCents, x.prepaymentCents, x.heatingPrepaymentCents, x.balanceCents, x.suggestedMonthlyCents, x.rows]),
})

test('#712: mit der Angabe zählt Wasser/Abwasser zum zweiten Teil des Vorschlags, die Summe bleibt', () => {
  const src = (coversWater: boolean) => haus({ heatingPlants: [anlage({ secondPrepaymentCoversWater: coversWater })], tenancies: [mieter('A', 'u1')], costItems: kosten() })
  const ohne = st(settle(src(false), '2025-01'), 'A')
  // ohne Angabe wie bisher: Heizung 1.500 € / 12 = 125 €
  assert.deepEqual([ohne.suggestedMonthlyCents, ohne.suggestedHeatingMonthlyCents, ohne.secondPrepaymentCoversWater], [34200, 12500, undefined])
  const mit = st(settle(src(true), '2025-01'), 'A')
  // mit Angabe: (1.500 € + 600 €) / 12 = 175 €
  assert.deepEqual([mit.suggestedMonthlyCents, mit.suggestedHeatingMonthlyCents, mit.secondPrepaymentCoversWater], [34200, 17500, true])
  assert.deepEqual(sums(settle(src(true), '2025-01')), sums(settle(src(false), '2025-01')), 'keine Summe und keine Zeile ändert sich')
})

test('#712: ohne Heizstaffel trägt die Aufstellung die Angabe nicht, und es gibt keinen Teil', () => {
  const s = settle(haus({ heatingPlants: [anlage({ secondPrepaymentCoversWater: true })], tenancies: [mieter('A', 'u1', { heatingPrepayments: [], prepayments: [{ from: '2024-01', monthlyCents: 30000 }] })], costItems: kosten() }), '2025-01')
  assert.deepEqual([st(s, 'A').suggestedMonthlyCents, st(s, 'A').suggestedHeatingMonthlyCents, st(s, 'A').secondPrepaymentCoversWater], [34200, undefined, undefined])
})

test('#712: eigene Heizkostenabrechnung je Heizperiode (Weg d) bleibt unverändert, die Angabe wirkt dort nicht', () => {
  const rules: PeriodRules = CALENDAR_RULES
  const src = (coversWater: boolean) => haus({
    heatingPlants: [anlage({ periodStartMonth: 5, separateSpans: [{ from: '2024-05', until: null }], secondPrepaymentCoversWater: coversWater })],
    tenancies: [mieter('A', 'u1')],
    costItems: [position('gas', '2024-05', 150000, { category: HEATING_CATEGORY, heatingPlantId: 'hp1', taxYear: 2025 }), position('wasser', '2025-01', 60000, { category: WATER_CATEGORY }), position('grundsteuer', '2025-01', 200000)],
  })
  const mit = settle(src(true), '2025-01', rules)
  const ohne = settle(src(false), '2025-01', rules)
  assert.deepEqual(mit, ohne, 'Betriebskostenabrechnung neben Weg d: wortgleich')
  assert.equal(st(mit, 'A').secondPrepaymentCoversWater, undefined)
  assert.equal(st(mit, 'A').suggestedHeatingMonthlyCents, undefined)
  // die Heizkostenabrechnung der Heizperiode selbst
  const heizperiode = of({ startMonth: 5, changes: [] }, '2024-05')
  const plant = (coversWater: boolean) => src(coversWater).heatingPlants?.[0] ?? assert.fail('Anlage fehlt')
  const heating = (coversWater: boolean) => computeSettlement({ ...snapshotFor(src(coversWater), 'objekt-1', heizperiode), scope: { kind: 'heating', plant: plant(coversWater) } })
  assert.deepEqual(heating(true), heating(false), 'Heizkostenabrechnung: wortgleich')
  assert.ok(heating(true).statements.every((x) => x.secondPrepaymentCoversWater === undefined))
})

test('#712: zwei Anlagen im Objekt, nur eine mit der Angabe: je Mietverhältnis gilt die Anlage seiner Wohnung', () => {
  const src = haus({
    units: [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true }, { id: 'u2', propertyId: 'objekt-1', name: 'OG', areaM2: 60, participates: true }],
    heatingPlants: [
      anlage({ id: 'hp1', name: 'Vorderhaus', units: [{ unitId: 'u1', heatedAreaM2: null }], secondPrepaymentCoversWater: true }),
      anlage({ id: 'hp2', name: 'Hinterhaus', units: [{ unitId: 'u2', heatedAreaM2: null }] }),
    ],
    tenancies: [mieter('A', 'u1'), mieter('B', 'u2')],
    costItems: [
      position('gas1', '2025-01', 150000, { category: HEATING_CATEGORY, heatingPlantId: 'hp1', key: 'direct', directUnitId: 'u1' }),
      position('gas2', '2025-01', 150000, { category: HEATING_CATEGORY, heatingPlantId: 'hp2', key: 'direct', directUnitId: 'u2' }),
      position('wasser', '2025-01', 120000, { category: WATER_CATEGORY }),
      position('grundsteuer', '2025-01', 400000),
    ],
  })
  const s = settle(src, '2025-01')
  assert.deepEqual([st(s, 'A').suggestedMonthlyCents, st(s, 'A').suggestedHeatingMonthlyCents, st(s, 'A').secondPrepaymentCoversWater], [34200, 17500, true])
  assert.deepEqual([st(s, 'B').suggestedMonthlyCents, st(s, 'B').suggestedHeatingMonthlyCents, st(s, 'B').secondPrepaymentCoversWater], [34200, 12500, undefined])
})

test('#712: ohne Rest für die übrigen Nebenkosten gibt es keinen Teil (0 < Teil < Summe)', () => {
  const s = settle(haus({
    heatingPlants: [anlage({ secondPrepaymentCoversWater: true })], tenancies: [mieter('A', 'u1')],
    costItems: [position('gas', '2025-01', 150000, { category: HEATING_CATEGORY, heatingPlantId: 'hp1' }), position('wasser', '2025-01', 60000, { category: WATER_CATEGORY })],
  }), '2025-01')
  assert.deepEqual([st(s, 'A').suggestedMonthlyCents, st(s, 'A').suggestedHeatingMonthlyCents, st(s, 'A').secondPrepaymentCoversWater], [17500, undefined, true])
})

const RULES: [string, PeriodRules][] = [['Kalenderjahr', CALENDAR_RULES], ['Mai bis April', { startMonth: 5, changes: [] }], ['Wechsel mit Rumpf', { startMonth: 1, changes: ['2025-07'] }]]
const MODELS = ['settlement', 'flatRate', 'inclusive'] as const

test('#712: Invariante über Zufallsbestände: mit und ohne Angabe dieselben Summen, der Teil liegt zwischen 0 und Summe', () => {
  let parts = 0
  let moved = 0
  let statements = 0
  for (const [name, rules] of RULES) {
    for (let seed = 1; seed <= 40; seed++) {
      const { source, periods } = integrationStock(seed, rules)
      for (const mixed of [false, true]) {
        const tenancies = source.tenancies.map((t, i) => ({
          ...t, ...(mixed ? { heatingModel: MODELS[(seed + i) % 3] ?? 'settlement' } : {}),
          heatingPrepayments: [{ from: '2020-01', monthlyCents: (seed + i) % 4 === 0 ? 0 : 4000 }],
        }))
        // Wasser/Abwasser je Zeitraum, mal nach Personen, mal nach Fläche, gelegentlich als Gutschrift.
        const water = periods.map((p, i) => ({
          id: `w${i}`, propertyId: INTEGRATION_PROPERTY, period: p.key, category: WATER_CATEGORY, description: `w${i}`,
          amountCents: (seed % 7 === 0 ? -1 : 1) * (20000 + seed * 1500), key: (seed + i) % 2 === 0 ? 'persons' as const : 'area' as const,
        }))
        const stock = (coversWater: boolean) => ({
          ...source, tenancies, costItems: [...source.costItems, ...water],
          heatingPlants: (source.heatingPlants ?? []).map((p) => ({ ...p, separateSettlement: true, secondPrepaymentCoversWater: coversWater })),
        })
        for (const p of periods) {
          const where = `${name}, Startwert ${seed}, ${p.key}${mixed ? ', gemischte Heizmodelle' : ''}`
          const a = computeSettlement(snapshotFor(stock(false), INTEGRATION_PROPERTY, p))
          const b = computeSettlement(snapshotFor(stock(true), INTEGRATION_PROPERTY, p))
          assert.deepEqual([b.totalCostsCents, b.landlord, b.selfUsedShareCents, b.notices], [a.totalCostsCents, a.landlord, a.selfUsedShareCents, a.notices], `${where}: Gesamtkosten, Vermieteranteil, Hinweise`)
          assert.ok(a.statements.every((x) => x.secondPrepaymentCoversWater === undefined), `${where}: Angabe ohne Angabe`)
          for (const sa of a.statements) {
            const sb = b.statements.find((x) => x.tenancyId === sa.tenancyId) ?? assert.fail(`${where}: ${sa.tenancyId} fehlt`)
            statements++
            const { suggestedHeatingMonthlyCents: partA, ...restA } = sa
            const { suggestedHeatingMonthlyCents: partB, secondPrepaymentCoversWater: flag, ...restB } = sb
            assert.deepEqual(restB, restA, `${where}, ${sa.tenancyId}: alles außer dem Teil und der Angabe`)
            assert.equal(flag, true, `${where}, ${sa.tenancyId}: Angabe an der Aufstellung`)
            for (const part of [partA, partB]) {
              if (part === undefined) continue
              assert.ok(Number.isInteger(part) && part % 100 === 0 && part > 0 && part < sb.suggestedMonthlyCents, `${where}, ${sa.tenancyId}: Teil ${part} bei Summe ${sb.suggestedMonthlyCents}`)
            }
            if (partB !== undefined) parts++
            if (partA !== undefined && partB !== undefined && partA !== partB) moved++
          }
        }
      }
    }
  }
  // Der Test prüft etwas: viele Aufstellungen mit Teil, und in vielen wandert der Wasseranteil.
  assert.ok(statements > 300 && parts > 100 && moved > 50, `zu wenige Fälle: ${statements} Aufstellungen, ${parts} mit Teil, ${moved} verschoben`)
})

// Durchsicht M1: Nach einem Kesseltausch steht die Wahl nur an der neuen Anlage (die stillgelegte zeigt sie nicht). Es gilt
// deshalb die Angabe der laufenden Anlage der Wohnung, auch für einen Zeitraum, in dem noch die alte geheizt hat, und
// unabhängig von der Reihenfolge der Anlagen.
test('#712: nach einem Kesseltausch gilt die Angabe der laufenden Anlage, in jeder Reihenfolge, vor und nach dem Tausch', () => {
  const alt = (flag: boolean) => anlage({ id: 'alt', name: 'Alt', endsOn: '2026-02-28', secondPrepaymentCoversWater: flag })
  const neu = (flag: boolean) => anlage({ id: 'neu', name: 'Neu', replacesPlantId: 'alt', secondPrepaymentCoversWater: flag })
  for (const [altFlag, neuFlag, part, kept] of [[true, false, 12500, undefined], [false, true, 17500, true]] as const) {
    for (const plants of [[alt(altFlag), neu(neuFlag)], [neu(neuFlag), alt(altFlag)]]) {
      const a = st(settle(haus({ heatingPlants: plants, tenancies: [mieter('A', 'u1')], costItems: kosten('alt') }), '2025-01'), 'A')
      assert.deepEqual([a.suggestedMonthlyCents, a.suggestedHeatingMonthlyCents, a.secondPrepaymentCoversWater], [34200, part, kept], `alt=${altFlag} neu=${neuFlag}, zuerst ${plants[0]?.id}`)
    }
  }
})

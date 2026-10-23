// Zufallsbestände für die Invariante über das Zusammenspiel der Funktionen von 0.13.0 (Integrationsdurchsicht):
// Nutzungswechsel (#259), verbilligte Vermietung (#257) und Betriebsstrom mit gemeldetem, selbst getragenem und
// verknüpftem Abzug (#268, #270), je Kalenderjahr oder in eigenem Rhythmus. Fester Startwert, also reproduzierbar.
import type { snapshotFor } from '../src/snapshot.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { periodsBetween } from '../../shared/period.ts'
import type { BillingPeriod, PeriodRules, UnitUsage } from '../../shared/types.ts'

export type IntegrationSource = Parameters<typeof snapshotFor>[0]
type Plant = NonNullable<IntegrationSource['heatingPlants']>[number]
type Item = IntegrationSource['costItems'][number]
type U = IntegrationSource['units'][number]
type T = IntegrationSource['tenancies'][number]

export const INTEGRATION_PROPERTY = 'p'

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

const plantOf = (method: 'service' | 'manual'): Plant => ({
  id: 'hp1', propertyId: INTEGRATION_PROPERTY, name: 'Kessel', method, source: 'building', supply: 'central', energy: 'gas', devicesRemote: 'unknown',
  devicesInstalledAfter2021: 'unknown', newDevicesInstall: null, units: null, periodStartMonth: null, periodChanges: [], separateSpans: [],
  separateSettlement: false, endsOn: null, replacesPlantId: null,
})
const USAGES: readonly UnitUsage[] = ['vermietet', 'eigen', 'ausgenommen']
const ALLOCABLE = ['Müllabfuhr', 'Grundsteuer', 'Sach- und Haftpflichtversicherung', 'Gartenpflege'] as const
const GENERAL_POWER = 'Beleuchtung/Allgemeinstrom'

// Ein Bestand mit zwei bis vier Einheiten (Nutzung mit bis zu zwei Wechseln, oft mit ortsüblicher Miete), bis zu zwei
// Mietverhältnissen je Einheit und je Zeitraum, der 2025 berührt: kalte Positionen, Allgemeinstrom, Heizkosten und
// einer von vier Fällen beim Betriebsstrom (Abzug ohne Angabe, „nicht gemeldet“, verknüpftes Paar, keiner).
export function integrationStock(seed: number, rules: PeriodRules): { source: IntegrationSource, service: boolean, periods: BillingPeriod[] } {
  const r = rng(seed)
  const pick = <X>(xs: readonly X[]): X => {
    const x = xs[Math.floor(r() * xs.length)]
    if (x === undefined) throw new Error('leere Auswahl')
    return x
  }
  const day = (y = 2025) => `${y}-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}`
  const units: U[] = []
  const tenancies: T[] = []
  const n = 2 + Math.floor(r() * 3)
  for (let i = 0; i < n; i++) {
    const base = r() < 0.6 ? 'vermietet' : pick(USAGES)
    const usageChanges = Array.from({ length: Math.floor(r() * 3) }, () => ({ from: day(r() < 0.8 ? 2025 : 2026), usage: pick(USAGES) }))
    const u: U = {
      id: `u${i}`, propertyId: INTEGRATION_PROPERTY, name: `u${i}`, areaM2: 30 + Math.floor(r() * 70), participates: base === 'vermietet',
      selfUsed: base === 'eigen', selfPersons: 1 + Math.floor(r() * 2), usageChanges,
    }
    if (r() < 0.6) u.localRents = [{ from: '2020-01', monthlyCents: 80000 + Math.floor(r() * 60000), source: 'Mietspiegel', sourceDate: '2024-01-01' }]
    units.push(u)
    const points = [day(), day(), day()].sort()
    const count = Math.floor(r() * 3)
    let prevEnd = '2019-12-31'
    for (let k = 0; k < count; k++) {
      const start = k === 0 ? (r() < 0.5 ? '2020-01-01' : points[0] ?? '2020-01-01') : points[k] ?? '2020-01-01'
      if (start <= prevEnd) break
      const next = points[k + 1]
      const end = k === count - 1 && r() < 0.5 ? null : (next !== undefined && next > start ? next : null)
      tenancies.push({
        id: `t${i}${k}`, unitId: u.id, tenantName: `t${i}${k}`, persons: 1, personHistory: [{ from: start, persons: 1 + Math.floor(r() * 3) }], start, end,
        prepayments: r() < 0.7 ? [{ from: '2020-01', monthlyCents: 5000 + Math.floor(r() * 20000) }] : [], prepaymentOverrides: {},
        baseRents: [{ from: start.slice(0, 7), monthlyCents: Math.floor(r() * 100000) }],
      })
      if (end === null) break
      prevEnd = end
    }
  }
  const service = r() < 0.5
  const periods = periodsBetween(rules, '2025-01-01', '2025-12-31')
  const costItems: Item[] = []
  let k = 0
  for (const p of periods) {
    const add = (over: Partial<Item>): string => {
      const id = `c${k++}`
      costItems.push({ id, propertyId: INTEGRATION_PROPERTY, period: p.key, category: 'Grundsteuer', description: id, amountCents: 100000, key: 'area', ...over })
      return id
    }
    for (let j = 0; j < 2 + Math.floor(r() * 3); j++) {
      const key = pick(['area', 'units', 'persons', 'direct'] as const)
      add({ category: r() < 0.3 ? 'Nicht umlagefähig' : pick(ALLOCABLE), key, amountCents: (r() < 0.1 ? -1 : 1) * (1000 + Math.floor(r() * 200000)), ...(key === 'direct' ? { directUnitId: pick(units).id } : {}) })
    }
    const bill = add({ category: GENERAL_POWER, key: 'units', amountCents: 100000 + Math.floor(r() * 50000) })
    add({ category: HEATING_CATEGORY, heatingPlantId: 'hp1', key: 'area', amountCents: 300000 + Math.floor(r() * 100000), ...(service ? {} : { heatingPart: 'fuel' as const }) })
    const mode = r()
    const deduction = (cents: number, over: Partial<Item> = {}) => add({ category: GENERAL_POWER, key: 'units', amountCents: -cents, operatingPower: 'deduction', operatingPowerGeneralId: bill, ...over })
    if (mode < 0.25) deduction(5000 + Math.floor(r() * 20000))
    else if (mode < 0.5) deduction(5000 + Math.floor(r() * 20000), { operatingPowerReported: false })
    else if (mode < 0.75 && !service) {
      const cents = 5000 + Math.floor(r() * 20000)
      const included = add({ category: HEATING_CATEGORY, heatingPlantId: 'hp1', key: 'area', amountCents: cents, heatingPart: 'operating', operatingPower: 'included' })
      deduction(r() < 0.5 ? cents : cents + 1000, { operatingPowerItemId: included })
    }
  }
  const source: IntegrationSource = {
    properties: [{ id: INTEGRATION_PROPERTY, kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: rules }],
    units, tenancies, costItems, meters: [], readings: [], payments: [], closedSettlements: [], heatingPlants: [plantOf(service ? 'service' : 'manual')],
  }
  return { source, service, periods }
}

// Derselbe Bestand ohne ortsübliche Miete: die Steuer ohne verbilligte Vermietung zum Vergleich.
export const withoutLocalRents = (s: IntegrationSource): IntegrationSource => ({
  ...s,
  units: s.units.map((u) => {
    const { localRents: _, ...rest } = u
    return rest
  }),
})

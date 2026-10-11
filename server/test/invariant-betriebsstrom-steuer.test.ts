// Invarianten zum Betriebsstrom in der Steuerübersicht (#268), über zufällige Bestände mit festem Startwert.
//
// Je Bestand: ein Objekt mit ein bis drei Einheiten (vermietet oder selbstgenutzt), eine Anlage mit oder ohne
// Messdienst, zwei Kalenderjahre mit Gas, Stromrechnung, null bis zwei Heizpositionen „steckt auch in der
// Stromrechnung“ und null bis drei Abzügen beim Allgemeinstrom, verknüpft (auch ins andere Jahr) oder ohne Verweis.
// Geprüft wird je Steuerjahr:
//   I1 Werbungskosten = bezahlte Rechnungen, mit Gleichheit: Σ aller Positionen ohne Kennzeichnung, dazu die Abzüge
//      ohne Verweis bei Messdienst (deren Betriebsstrom steckt im Betrag des Messdienstes, der als Heizposition dasteht).
//      Ohne Messdienst also genau Gas + Stromrechnung + übrige Heizkosten. Gilt ohne Klemme, auch wenn mehr Betriebsstrom
//      in den Heizkosten steht als abgezogen ist (Entscheidung R-2).
//   I2 Die Abrechnung bleibt: Die Zeilen der echten Positionen tragen deren Betrag, und der Eigenanteil laut Abrechnung
//      (`selfUsedShareCents`) ist der von computeSettlement, die abgeleitete Zeile steckt nicht darin.
//   I3 privat + abziehbar = gesamt je Zeile und in der Summe; ohne selbstgenutzte Einheit ist nichts privat.
//   I4 Ist der Strom nach Fläche über alle Einheiten verteilt und gibt es keine Heizposition „steckt auch in der
//      Stromrechnung“, ist die Steuer mit selbst getragenem Abzug (ohne Verweis, ohne Messdienst) dieselbe wie ohne
//      Abzug: gleicher Betrag, privat auf höchstens einen Cent gleich (zwei Rundungen).
// Mehr Startwerte mit INV_FROM/INV_TO.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, taxReportFor } from '../src/calc.ts'
import { snapshotFor } from '../src/snapshot.ts'
import { CALENDAR_RULES, calendarYearPeriod, periodKey } from '../../shared/period.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import type { CostKey } from '../../shared/types.ts'

type Source = Parameters<typeof snapshotFor>[0]
type Item = Source['costItems'][number]
type Plant = NonNullable<Source['heatingPlants']>[number]
type Rng = () => number
function makeRng(seed: number): Rng {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}
const SEEDS: number[] = process.env.INV_FROM !== undefined || process.env.INV_TO !== undefined
  ? Array.from({ length: Math.max(0, Number(process.env.INV_TO ?? 10) - Number(process.env.INV_FROM ?? 1) + 1) }, (_, k) => Number(process.env.INV_FROM ?? 1) + k)
  : Array.from({ length: 150 }, (_, k) => k + 1)
const YEARS = [2025, 2026]

type Stock = { source: Source; service: boolean; selfUsed: boolean }

function randomStock(rnd: Rng, opts: { generalKey?: CostKey; noIncluded?: boolean; deductions?: 'none' | 'unlinked' | 'random'; method?: 'manual' | 'service' } = {}): Stock {
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)] as T
  const cents = (min: number, max: number) => Math.round((min + rnd() * (max - min)) * 100)
  const unitCount = 1 + Math.floor(rnd() * 3)
  const units = Array.from({ length: unitCount }, (_, i) => {
    const self = unitCount > 1 && rnd() < 0.35
    return { id: `u${i}`, propertyId: 'objekt-1', name: `W${i}`, areaM2: 20 + Math.floor(rnd() * 80), participates: !self, ...(self ? { selfUsed: true, selfPersons: 1 + Math.floor(rnd() * 3) } : {}) }
  })
  const tenancies = units.filter((u) => u.participates).map((u) => ({
    id: `t-${u.id}`, unitId: u.id, tenantName: u.id, persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 + Math.floor(rnd() * 3) }], start: '2020-01-01', end: null,
    prepayments: [], prepaymentOverrides: {}, baseRents: [],
  }))
  const method = opts.method ?? pick(['manual', 'manual', 'service'] as const)
  const plant: Plant = {
    id: 'hp1', propertyId: 'objekt-1', name: 'Kessel', method, source: 'building', supply: 'central', energy: 'gas', devicesRemote: 'unknown',
    devicesInstalledAfter2021: 'unknown', newDevicesInstall: null, units: null, periodStartMonth: null, periodChanges: [], separateSpans: [],
    separateSettlement: false, endsOn: null, replacesPlantId: null,
  }
  const heatKeys: CostKey[] = ['area', 'units', 'persons']
  const subset = () => {
    if (rnd() < 0.7 || unitCount < 2) return {}
    const ids = units.filter(() => rnd() < 0.6).map((u) => u.id)
    return ids.length > 0 ? { participantUnitIds: ids } : {}
  }
  const items: Item[] = []
  const included: string[] = []
  for (const year of YEARS) {
    const period = periodKey(`${year}-01`)
    const heatSubset = subset()
    items.push({ id: `gas${year}`, propertyId: 'objekt-1', period, category: HEATING_CATEGORY, description: `Gas ${year}`, amountCents: cents(1000, 9000), key: pick(heatKeys), heatingPlantId: 'hp1', heatingPart: 'fuel', ...heatSubset })
    items.push({ id: `hs${year}`, propertyId: 'objekt-1', period, category: 'Beleuchtung/Allgemeinstrom', description: `Hausstrom ${year}`, amountCents: cents(300, 2000), key: opts.generalKey ?? pick(heatKeys) })
    if (!opts.noIncluded) {
      const n = Math.floor(rnd() * 3)
      for (let k = 0; k < n; k++) {
        const id = `bs${year}-${k}`
        included.push(id)
        items.push({ id, propertyId: 'objekt-1', period, category: HEATING_CATEGORY, description: `Betriebsstrom ${id}`, amountCents: cents(20, 400), key: pick(heatKeys), heatingPlantId: 'hp1', heatingPart: 'operating', operatingPower: 'included', ...heatSubset })
      }
    }
  }
  const deductionMode = opts.deductions ?? 'random'
  if (deductionMode !== 'none') {
    for (const year of YEARS) {
      const period = periodKey(`${year}-01`)
      const n = deductionMode === 'unlinked' ? 1 : Math.floor(rnd() * 4)
      for (let k = 0; k < n; k++) {
        const link = deductionMode === 'random' && included.length > 0 && rnd() < 0.6 ? pick(included) : undefined
        items.push({
          id: `ab${year}-${k}`, propertyId: 'objekt-1', period, category: 'Beleuchtung/Allgemeinstrom', description: `Abzug ${year}-${k}`,
          amountCents: -cents(10, 250), key: opts.generalKey ?? 'units', operatingPower: 'deduction', operatingPowerGeneralId: `hs${year}`,
          ...(link ? { operatingPowerItemId: link } : {}),
        })
      }
    }
  }
  const source = {
    properties: [{ id: 'objekt-1', kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: CALENDAR_RULES }],
    units, tenancies, costItems: items, meters: [], readings: [], payments: [], closedSettlements: [], heatingPlants: [plant],
  } as Source
  return { source, service: method === 'service', selfUsed: units.some((u) => !u.participates) }
}

const yearItems = (s: Source, year: number) => s.costItems.filter((c) => c.period === periodKey(`${year}-01`))

test('#268 Invariante I1–I3: Werbungskosten = bezahlte Rechnungen je Steuerjahr, privat + abziehbar = gesamt, Abrechnung unberührt', () => {
  let negative = 0
  let positive = 0
  for (const seed of SEEDS) {
    const rnd = makeRng(seed)
    const { source, service, selfUsed } = randomStock(rnd)
    for (const year of YEARS) {
      const at = `Startwert ${seed}, ${year}`
      const r = taxReportFor(source, 'objekt-1', year)
      const own = yearItems(source, year)
      // I1: bezahlt sind die Rechnungen ohne Kennzeichnung; bei Messdienst bleiben die Abzüge ohne Verweis abgezogen.
      const paid = own.filter((c) => c.operatingPower === undefined).reduce((a, c) => a + c.amountCents, 0)
      const reported = service ? own.filter((c) => c.operatingPower === 'deduction' && !c.operatingPowerItemId).reduce((a, c) => a + c.amountCents, 0) : 0
      assert.equal(r.expenses.totalCents, paid + reported, `${at}: I1`)
      const balance = r.operatingPowerBalanceCents ?? 0
      if (balance < 0) negative++
      if (balance > 0) positive++
      // I2: echte Positionen mit ihrem Betrag; der Eigenanteil laut Abrechnung ohne die abgeleitete Zeile.
      for (const i of r.expenses.items) {
        if (i.operatingPowerBalance) continue
        assert.equal(i.amountCents, own.find((c) => c.id === i.costItemId)?.amountCents, `${at}: I2 ${i.costItemId}`)
      }
      const settlement = computeSettlement(snapshotFor(source, 'objekt-1', calendarYearPeriod(year)))
      assert.equal(r.selfUsedShareCents, settlement.selfUsedShareCents, `${at}: I2 Eigenanteil`)
      // I3
      for (const i of r.expenses.items) assert.equal(i.privateCents + i.deductibleCents, i.amountCents, `${at}: I3 ${i.costItemId}`)
      assert.equal(r.expenses.privateCents + r.expenses.deductibleCents, r.expenses.totalCents, `${at}: I3 Summe`)
      if (!selfUsed) assert.ok(r.expenses.items.every((i) => i.privateCents === 0), `${at}: I3 ohne Eigennutzung`)
    }
  }
  // Der Generator muss beide Richtungen des Ausgleichs erzeugen, sonst prüft I1 die Klemme nicht.
  assert.ok(negative > 0 && positive > 0, `negativ ${negative}, positiv ${positive}`)
})

test('#268 Invariante I4: Strom nach Fläche, Abzug ohne Verweis und ohne Messdienst: Steuer wie ohne Abzug', () => {
  let compared = 0
  for (const seed of SEEDS) {
    const withDeduction = randomStock(makeRng(seed), { generalKey: 'area', noIncluded: true, deductions: 'unlinked', method: 'manual' })
    const without = randomStock(makeRng(seed), { generalKey: 'area', noIncluded: true, deductions: 'none', method: 'manual' })
    for (const year of YEARS) {
      const a = taxReportFor(withDeduction.source, 'objekt-1', year)
      const b = taxReportFor(without.source, 'objekt-1', year)
      const at = `Startwert ${seed}, ${year}`
      assert.equal(a.expenses.totalCents, b.expenses.totalCents, `${at}: Betrag`)
      assert.ok(Math.abs(a.expenses.privateCents - b.expenses.privateCents) <= 1, `${at}: privat ${a.expenses.privateCents} gegen ${b.expenses.privateCents}`)
      compared++
    }
  }
  assert.ok(compared > 0)
})

// Invariante zu #342: Wert und Einheit eines Zählers gemeinsam umzustellen (kWh ↔ MWh, m³ ↔ l) ändert keinen
// Cent. Über Zufallsbestände mit festem Startwert (wie randomDb in calc.test.ts und die Läufe in
// fuel-invariant.test.ts), einmal für den Verbrauchsschlüssel `meter` (mit Mieterwechseln, zweitem Zähler einer
// Wohnung, Zählerwechsel und Hauptzähler) und einmal für die eigene Heizkostenabrechnung (Beispiel A über
// `selfSnapshot`, mit zufälligen Wohnungen, Mietverhältnissen und Ständen). Mehr Läufe mit INV_RUNS.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement } from '../src/calc.ts'
import { selfMeter, selfReading, selfSnapshot, selfTenancy, selfUnit } from '../testing/selfHeating.ts'
import { periodKey } from '../../shared/period.ts'
import { knownUnit } from '../../shared/meterUnits.ts'
import type { CostItem, HeatingPlant, Meter, MeterType, Reading, Tenancy, Unit } from '../../shared/types.ts'

type Rng = () => number
function makeRng(seed: number): Rng {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

const RUNS = Number(process.env.INV_RUNS ?? 150)
const DAY = 86400000
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10)
const START = '2024-12-31'
const END = '2025-12-31'

// Ein Zufallsbestand: Wohnungen, Mietverhältnisse (auch mit Wechsel), Zähler je Sparte (manchmal zwei, manchmal
// keiner), Hauptzähler, Ablesungen an den Grenzen und dazwischen, manchmal ein Zählerwechsel.
function randomStock(rnd: Rng, types: readonly MeterType[], self: boolean) {
  const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1))
  const units: Unit[] = []
  const tenancies: Tenancy[] = []
  const meters: Meter[] = []
  const readings: Reading[] = []
  const unitCount = int(2, 5)
  for (let i = 0; i < unitCount; i++) {
    const id = `u${i}`
    const selfUsed = !self && rnd() < 0.15
    units.push(selfUnit(id, int(30, 120), selfUsed ? { participates: false, selfUsed: true, selfPersons: 1 } : {}))
    if (selfUsed) continue
    if (rnd() < 0.35) {
      const change = iso(Date.parse('2025-02-01T00:00:00Z') + int(0, 300) * DAY)
      tenancies.push(selfTenancy(`${id}-1`, id, '2020-01-01', change))
      tenancies.push(selfTenancy(`${id}-2`, id, iso(Date.parse(`${change}T00:00:00Z`) + (rnd() < 0.2 ? int(2, 40) : 1) * DAY), null))
    } else if (rnd() < 0.9) {
      tenancies.push(selfTenancy(`${id}-1`, id, '2020-01-01', null))
    }
  }
  // Ein Zähler mit Ständen an den Grenzen seiner Wohnung (Beginn, Ende, Wechsel) und manchmal dazwischen.
  const addMeter = (id: string, unitId: string | null, type: MeterType) => {
    meters.push(selfMeter(id, unitId, id, type))
    const water = type === 'kaltwasser' || type === 'warmwasser'
    // Wasser mit drei Nachkommastellen, Wärme und Strom in ganzen kWh.
    const step = () => (water ? int(0, 80000) / 1000 : int(0, 9000))
    const dates = new Set([START, END])
    for (const t of tenancies) if (t.unitId === unitId && t.end) dates.add(t.end)
    if (rnd() < 0.4) dates.add(iso(Date.parse('2025-01-15T00:00:00Z') + int(0, 330) * DAY))
    let value = water ? int(0, 500000) / 1000 : int(0, 50000)
    const sorted = [...dates].sort()
    sorted.forEach((date, k) => {
      if (k > 0) value += step()
      // Ein Zählerwechsel mitten im Jahr: der neue beginnt bei 0.
      if (k > 0 && k < sorted.length - 1 && rnd() < 0.15) {
        readings.push({ ...selfReading(id, date, 0), replacement: true, oldEndValue: value })
        value = 0
      } else {
        readings.push(selfReading(id, date, value))
      }
    })
  }
  for (const u of units) {
    for (const type of types) {
      if (rnd() < (self ? 0.05 : 0.15)) continue
      addMeter(`${type}-${u.id}`, u.id, type)
      if (!self && rnd() < 0.25) addMeter(`${type}-${u.id}-2`, u.id, type)
    }
  }
  if (!self) for (const type of types) if (rnd() < 0.5) addMeter(`${type}-haus`, null, type)
  return { units, tenancies, meters, readings }
}

// Wert und Einheit gemeinsam umstellen: dieselbe Menge, in anderer Einheit. Wasser in Litern, Wärme und Strom in
// MWh; ein Zähler mit unveränderter Einheit bleibt, wie er ist.
const OTHER: Partial<Record<MeterType, { unit: string; factor: number }>> = {
  kaltwasser: { unit: 'l', factor: 1000 }, warmwasser: { unit: 'l', factor: 1000 },
  waerme: { unit: 'MWh', factor: 1 / 1000 }, strom: { unit: 'MWh', factor: 1 / 1000 },
}
function rescaled(rnd: Rng, meters: Meter[], readings: Reading[]): { meters: Meter[]; readings: Reading[]; changed: number } {
  const picked = new Set(meters.filter((m) => OTHER[m.type] && rnd() < 0.5).map((m) => m.id))
  const factorOf = (id: string) => {
    const m = meters.find((x) => x.id === id)
    return m && picked.has(id) ? (OTHER[m.type]?.factor ?? 1) : 1
  }
  return {
    meters: meters.map((m) => (picked.has(m.id) ? { ...m, unit: OTHER[m.type]?.unit ?? m.unit } : m)),
    readings: readings.map((r) => (picked.has(r.meterId) ? { ...r, value: r.value * factorOf(r.meterId), ...(r.oldEndValue !== undefined ? { oldEndValue: r.oldEndValue * factorOf(r.meterId) } : {}) } : r)),
    changed: picked.size,
  }
}

// Was in Cent herauskommt: jede Zeile der Mieter und des Vermieters, der Eigenanteil und die Hinweise.
function money(s: ReturnType<typeof computeSettlement>) {
  return {
    tenants: s.statements.map((st) => [st.tenancyId, st.rows.map((r) => [r.costItemId, r.shareCents]), st.balanceCents]),
    landlord: s.landlord.rows.map((r) => [r.costItemId, r.shareCents]),
    self: s.selfUsedShareCents,
    codes: s.notices.map((n) => n.code).sort(),
  }
}

const P = 'objekt-1'
const manual = { method: 'manual' } as Partial<HeatingPlant>
const METER_TYPES: readonly MeterType[] = ['kaltwasser', 'warmwasser', 'strom', 'waerme']

test(`Invariante #342, Verbrauchsschlüssel: Wert und Einheit eines Zählers gemeinsam umstellen ändert keinen Cent (${RUNS} Bestände)`, () => {
  const rnd = makeRng(20261017)
  let changedTotal = 0
  let distributed = 0
  for (let i = 0; i < RUNS; i++) {
    const stock = randomStock(rnd, METER_TYPES, false)
    const costItems: CostItem[] = METER_TYPES.map((type, k) => {
      const amount = 1 + Math.floor(rnd() * 300000)
      return { id: `c-${type}`, propertyId: P, period: periodKey('2025-01'), category: 'Sonstige Betriebskosten', description: `Nach Verbrauch ${k}`, amountCents: rnd() < 0.1 ? -amount : amount, key: 'meter', meterType: type }
    })
    const before = computeSettlement(selfSnapshot({ ...stock, costItems, plant: manual }))
    const other = rescaled(rnd, stock.meters, stock.readings)
    changedTotal += other.changed
    const after = computeSettlement(selfSnapshot({ ...stock, meters: other.meters, readings: other.readings, costItems, plant: manual }))
    assert.deepEqual(money(after), money(before), `Bestand ${i}`)
    assert.equal(after.notices.some((n) => n.code === 'meter.units-mixed'), false, `Bestand ${i}: bekannte Einheiten sind umrechenbar`)
    distributed += before.statements.flatMap((st) => st.rows).filter((r) => r.shareCents !== 0).length
  }
  // Die Invariante prüft etwas: umgestellte Zähler und verteilte Zeilen.
  assert.ok(changedTotal > RUNS, `nur ${changedTotal} Zähler umgestellt`)
  assert.ok(distributed > RUNS, `nur ${distributed} verteilte Zeilen`)
})

test(`Invariante #342, eigene Heizkostenabrechnung: Wert und Einheit eines Zählers gemeinsam umstellen ändert keinen Cent (${Math.ceil(RUNS / 3)} Bestände)`, () => {
  const rnd = makeRng(20261018)
  let changedTotal = 0
  let distributedRuns = 0
  for (let i = 0; i < Math.ceil(RUNS / 3); i++) {
    const stock = randomStock(rnd, ['waerme', 'warmwasser'], true)
    // Der Wärmezähler am Warmwasserspeicher für den Warmwasseranteil.
    const storage = int3(rnd)
    const meters = [...stock.meters, selfMeter('ww', null, 'Speicher', 'waerme', { heatingPlantId: 'hp', heatingRole: 'dhwHeat' })]
    const readings = [...stock.readings, selfReading('ww', START, storage), selfReading('ww', END, storage + 5000 + Math.floor(rnd() * 8000))]
    const before = computeSettlement(selfSnapshot({ ...stock, meters, readings }))
    const other = rescaled(rnd, meters, readings)
    changedTotal += other.changed
    const after = computeSettlement(selfSnapshot({ ...stock, meters: other.meters, readings: other.readings }))
    assert.deepEqual(money(after), money(before), `Bestand ${i}`)
    // Der Verbrauch je Nutzer, in die Grundeinheit gebracht: Bei einheitlich MWh oder Litern steht er in dieser Einheit
    // (Durchsicht von #342, E2), der Ausweis sagt es; umgerechnet ist er derselbe.
    const users = (s: typeof before) => (s.heating ?? []).flatMap((h) => {
      const f = (pot: 'heating' | 'water') => {
        const u = knownUnit(pot === 'heating' ? 'waerme' : 'warmwasser', h.self?.pots.find((p) => p.pot === pot)?.consumptionUnit ?? '')
        return u ? u.num / u.den : 1
      }
      return h.self?.units.flatMap((u) => u.users.map((v) => [v.heatingConsumption === null ? null : v.heatingConsumption * f('heating'), v.waterConsumption === null ? null : v.waterConsumption * f('water')].map((x) => (x === null ? null : Math.round(x * 1000) / 1000)))) ?? []
    })
    assert.deepEqual(users(after), users(before), `Bestand ${i}: Verbrauch je Nutzer`)
    if (before.statements.some((st) => st.rows.some((r) => r.costItemId === 'gas' && r.shareCents !== 0))) distributedRuns++
  }
  assert.ok(changedTotal > RUNS / 3, `nur ${changedTotal} Zähler umgestellt`)
  assert.ok(distributedRuns > RUNS / 6, `nur in ${distributedRuns} Beständen verteilt`)
})

function int3(rnd: Rng): number {
  return Math.floor(rnd() * 20000)
}

// Mehrere Anlagen und Etagenheizung ohne Abrechnung (Heizung PR 9, Entwurf 9.2 Nr. 1, 9.3, 12.3 Nr. 9).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { distributeCents } from '../src/calc.ts'
import { itemBasisUnits, perUnitClassification, perUnitExceeding, perUnitReliefs, roundSpecific, spanningPlants, stageOf, stageRanges, type BasisContext, type PerUnitFuel } from '../src/co2.ts'
import type { SnapshotCostItem } from '../src/snapshot.ts'
import { co2StageTable } from '../../shared/law/co2kostaufg.ts'
import { LAW_AS_OF, valueAt } from '../../shared/law/register.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { periodKey } from '../../shared/period.ts'

const CTX: BasisContext = {
  basisUnitIds: ['eg', 'og', 'dg'],
  unitOfTenancy: new Map([['ta', 'eg'], ['tb', 'og'], ['tc', 'dg']]),
  meterUnitIds: (type) => (type === 'waerme' ? ['eg', 'og'] : []),
}
const posten = (over: Partial<SnapshotCostItem>): SnapshotCostItem => ({
  id: 'c', period: periodKey('2025-01'), category: HEATING_CATEGORY, description: 'c', amountCents: 100000, key: 'area', ...over,
})
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6

test('Verteilbasis einer Position (F9): Direktzuordnung, Anteile, Einzelbeträge, Teilnehmer, Zähler, ganzes Haus', () => {
  assert.deepEqual(itemBasisUnits(posten({ key: 'direct', directUnitId: 'dg' }), CTX), ['dg'])
  assert.deepEqual(itemBasisUnits(posten({ key: 'custom', customShares: { eg: 60, og: 0, dg: 40 } }), CTX), ['eg', 'dg'])
  assert.deepEqual(itemBasisUnits(posten({ key: 'amounts', tenancyAmounts: { ta: 500, tc: 0 }, selfAmounts: { og: 100 } }), CTX), ['eg', 'dg', 'og'])
  assert.deepEqual(itemBasisUnits(posten({ participantUnitIds: ['og', 'og'] }), CTX), ['og'])
  assert.deepEqual(itemBasisUnits(posten({ key: 'meter', meterType: 'waerme' }), CTX), ['eg', 'og'])
  assert.deepEqual(itemBasisUnits(posten({}), CTX), ['eg', 'og', 'dg'])
})

test('Über zwei Anlagen: die übrigen Anlagen mit den Wohnungen, die an ihnen hängen', () => {
  const plants = [
    { id: 'hp1', name: 'Zentralheizung', serves: (u: string) => u === 'eg' || u === 'og' },
    { id: 'hp2', name: 'Gastherme DG', serves: (u: string) => u === 'dg' },
  ]
  assert.deepEqual(spanningPlants(['og', 'dg'], 'hp1', plants), [{ plantId: 'hp2', name: 'Gastherme DG', unitIds: ['dg'] }])
  assert.deepEqual(spanningPlants(['eg', 'og'], 'hp1', plants), [])
})

// F8: zwei Wohnungen mit eigener Gasrechnung. EG 60 m², ganzjährig vermietet; OG 40 m², Mieter bis
// 30.04.2025 (120 Tage), Leerstand Mai und Juni (61 Tage), neuer Mieter ab 01.07.2025 (184 Tage).
// Je Wohnung eine Gasrechnung als Direktzuordnung: EG 1.500 €, OG 1.000 €.
const EG: PerUnitFuel = { unitId: 'eg', rented: true, delivered: true, areaM2: 60, emissionsKg: 1800, co2Cents: 20000, fuelCents: 150000, shares: [{ tenancyId: 't1', exact: 150000 }] }
const OG: PerUnitFuel = {
  unitId: 'og', rented: true, delivered: true, areaM2: 40, emissionsKg: 1200, co2Cents: 12000, fuelCents: 100000,
  shares: [{ tenancyId: 't2', exact: (100000 * 120) / 365 }, { tenancyId: 't3', exact: (100000 * 184) / 365 }],
}

test('Einstufung bei Etagenheizungen (§ 5 Abs. 1 Satz 2, Entwurf 9.2 Nr. 1): Σ kg / Σ Fläche der vermieteten Wohnungen mit Lieferung', () => {
  assert.deepEqual(perUnitClassification([EG, OG]), { emissionsKg: 3000, areaM2: 100, co2Cents: 32000 })
  const ranges = stageRanges(valueAt(co2StageTable, LAW_AS_OF), 1)
  assert.equal(stageOf(roundSpecific(3000 / 100, 1), ranges).landlordPercent, 40)
  // Eine selbstgenutzte Wohnung und eine ohne Rechnung in der Heizperiode zählen nicht.
  const eigen: PerUnitFuel = { ...EG, unitId: 'eigen', rented: false, emissionsKg: 5000, co2Cents: 50000, areaM2: 80, shares: [] }
  const ohne: PerUnitFuel = { ...OG, unitId: 'ohne', delivered: false, emissionsKg: 0, co2Cents: 0, areaM2: 70, shares: [] }
  assert.deepEqual(perUnitClassification([EG, OG, eigen, ohne]), { emissionsKg: 3000, areaM2: 100, co2Cents: 32000 })
})

test('Abzug je Wohnung ohne Normierung (Entwurf 9.3, Review Focus 3): 80,00 / 15,78 / 24,20 €, der Leerstand bleibt beim Vermieter', () => {
  const raws = perUnitReliefs(400, [EG, OG])
  assert.ok(near(raws[0]?.raw ?? 0, 8000))
  assert.ok(near(raws[1]?.raw ?? 0, (0.4 * 12000 * 120) / 365))
  assert.ok(near(raws[2]?.raw ?? 0, (0.4 * 12000 * 184) / 365))
  const total = Math.round(raws.reduce((a, x) => a + x.raw, 0))
  assert.equal(total, 11998)
  assert.deepEqual(distributeCents(total, raws.map((x) => ({ key: x.tenancyId, landlord: false, raw: x.raw }))), [8000, 1578, 2420])
  // Der Leerstand: 4.800 ct (40 % von 120 €) für das OG, davon 39,98 € an die Mieter, 8,02 € beim Vermieter.
  assert.ok(near(4800 - (raws[1]?.raw ?? 0) - (raws[2]?.raw ?? 0), (0.4 * 12000 * 61) / 365))
  // Mit Normierung (falsch) bekämen die beiden Mieter des OG die ganzen 48,00 €: 18,95 und 29,05 €.
  assert.notEqual(Math.round(raws[1]?.raw ?? 0), Math.round((4800 * 120) / 304))
})

test('CO₂-Kosten über den Heizkosten einer Wohnung: kein Abzug für sie, gemeldet (co2.exceeds-heating)', () => {
  const zuviel: PerUnitFuel = { ...OG, co2Cents: 120000 }
  assert.deepEqual(perUnitExceeding([EG, zuviel]), ['og'])
  assert.deepEqual(perUnitReliefs(400, [EG, zuviel]).map((x) => x.tenancyId), ['t1'])
  const ohnePosition: PerUnitFuel = { ...OG, fuelCents: 0, shares: [] }
  assert.deepEqual(perUnitExceeding([ohnePosition]), ['og'])
})

// Fester Startwert: jeder Lauf prüft dieselben Bestände.
function zufall(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

test('Invariante (Entwurf 12.3 Nr. 9): 0 ≤ r_t ≤ x_t, Σ r je Wohnung ≤ ‰ · C_u', () => {
  const rnd = zufall(20261005)
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))
  for (let lauf = 0; lauf < 300; lauf++) {
    const list: PerUnitFuel[] = Array.from({ length: int(1, 4) }, (_, i) => {
      const fuelCents = int(0, 300000)
      const n = int(0, 3)
      const parts = Array.from({ length: n }, () => rnd())
      const sum = parts.reduce((a, p) => a + p, 0) + rnd()
      return {
        unitId: `u${i}`, rented: rnd() < 0.8, delivered: rnd() < 0.9, areaM2: int(20, 120), emissionsKg: int(0, 8000), co2Cents: int(0, 40000), fuelCents,
        shares: parts.map((p, k) => ({ tenancyId: `t${i}-${k}`, exact: sum > 0 ? (fuelCents * p) / sum : 0 })),
      }
    })
    const permille = int(0, 950)
    const raws = perUnitReliefs(permille, list)
    for (const r of raws) {
      const u = list.find((x) => x.unitId === r.unitId)
      const x = u?.shares.find((s) => s.tenancyId === r.tenancyId)?.exact ?? -1
      assert.ok(r.raw >= 0 && r.raw <= x + 1e-9, `Lauf ${lauf}: ${JSON.stringify(r)}`)
    }
    for (const u of list) {
      const sum = raws.filter((r) => r.unitId === u.unitId).reduce((a, r) => a + r.raw, 0)
      assert.ok(sum <= (permille / 1000) * u.co2Cents + 1e-9, `Lauf ${lauf}: ${u.unitId}`)
    }
  }
})

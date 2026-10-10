// Das Blatt „CO₂-Angaben für den Messdienst“ nach der Durchsicht von #246, Runde 3 (S-W1, S-K1, W-N4): Was
// die Abrechnung entscheidet (Endbestand, Verbrauch, Abgrenzung, kg/m² und Stufe), liest das Blatt aus ihrem
// Ergebnis; die Summe der Rechnungen ist ausdrücklich nicht abgegrenzt.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement } from '../src/calc.ts'
import { co2SheetFor } from '../src/co2Sheet.ts'
import { snapshotFor, type SnapshotHeatingPeriodRow } from '../src/snapshot.ts'
import { co2Source } from '../testing/co2Snapshot.ts'
import { CALENDAR_RULES, periodKey, periodOfKey } from '../../shared/period.ts'
import type { Co2Sheet, FuelDelivery, HeatingStatement } from '../../shared/types.ts'

const P = periodOfKey(CALENDAR_RULES, periodKey('2025-01')) ?? assert.fail('kein Zeitraum 2025')
type Row = Partial<SnapshotHeatingPeriodRow>
type Src = ReturnType<typeof co2Source>

const oel: Partial<FuelDelivery> = { deliveredAt: '2025-03-15', invoiceDate: '2025-03-15', invoiceFrom: null, invoiceTo: null, quantity: 3000, quantityUnit: 'l', emissionsKg: 8028.9, co2CostCents: 52549, label: 'Heizöl März' }
const vorrat: Row = { stockUnit: 'l', openingQuantity: 1000, openingCostCents: 95000, openingEmissionsKg: 2676.3, openingCo2Cents: 17517, openingInvoicedBefore2023: false, openingAlreadySettled: null, closingQuantity: 1800, closingMeasuredOn: '2025-12-31' }

function oelSource(row: Row, linked = true): Src {
  const src = co2Source(2025, oel, [], { energy: 'oil' })
  return {
    ...src,
    costItems: linked ? src.costItems.map((c) => ({ ...c, amountCents: 315000 })) : src.costItems.map((c) => ({ ...c, fuelDeliveryId: null, amountCents: 315000 })),
    heatingPeriodRows: [{ plantId: 'hp', period: periodKey('2025-01'), dhwMethod: null, dhwUnmeasurable: null, ...vorrat, ...row }],
  }
}
function both(src: Src): { sheet: Co2Sheet; heating: HeatingStatement | null } {
  const sheet = co2SheetFor(src, 'objekt-1', 'hp', P, '2026-10-07') ?? assert.fail('kein Blatt')
  const s = computeSettlement(snapshotFor(src, 'objekt-1', P))
  return { sheet, heating: s.heating?.find((h) => h.plantId === 'hp') ?? null }
}

test('S-W1 Vorrat: Endbestand und Verbrauch wie in der Abrechnung; der Verbrauch ist die Grundlage der CO₂-Aufteilung', () => {
  const { sheet, heating } = both(oelSource({}))
  const co2 = heating?.co2 ?? assert.fail('keine CO₂-Aufteilung')
  // Gemessen in der Nachprüfung: Summe 10.705,20 kg / 700,66 €, Endbestand 4.817,34 kg / 315,29 €, Verbrauch 5.887,86 kg / 385,37 €.
  assert.deepEqual(sheet.totals, { emissionsKg: 10705.2, co2CostCents: 70066 })
  assert.deepEqual([sheet.billing?.closing?.quantity, sheet.billing?.closing?.emissionsKg, sheet.billing?.closing?.co2Cents], [1800, 4817.34, 31529])
  assert.deepEqual([sheet.billing?.consumed?.emissionsKg, sheet.billing?.consumed?.co2Cents], [5887.86, 38537])
  assert.deepEqual([sheet.billing?.basis?.emissionsKg, sheet.billing?.basis?.co2Cents], [co2.emissionsKg, co2.totalCents])
  assert.deepEqual([sheet.billing?.consumed?.emissionsKg, sheet.billing?.consumed?.co2Cents], [co2.emissionsKg, co2.totalCents])
  // kg/m² und Stufe kommen aus der Abrechnung: 5.887,86 kg / 100 m² = 58,9 kg/m², nicht aus der Summe.
  assert.deepEqual([sheet.billing?.basis?.kgPerM2, sheet.billing?.basis?.landlordPermille], [co2.kgPerM2, co2.landlordPermille])
  assert.equal(sheet.billing?.basis?.kgPerM2, 58.9)
})

test('S-W1 Zeitraumrechnungen: je Rechnung der Teil in der Heizperiode und die Summe davon wie in der Abrechnung', () => {
  const gas = (id: string, from: string, to: string): FuelDelivery => ({
    id, plantId: 'hp', label: `Gas ${from}`, invoiceDate: null, deliveredAt: null, invoiceFrom: from, invoiceTo: to, unitId: null, amountCents: null, quantity: null, quantityUnit: null,
    energyKwh: null, gasBasis: null, heatingValue: null, fuelGrade: null, emissionsKg: 10000, co2CostCents: 65450, emissionFactor: null, gridFeeCents: null, bioCostCents: null,
    sharePermille: null, fixedCents: null, estimated: false, usedByService: true, parts: [],
  })
  const src = co2Source(2025, {})
  const both2 = {
    ...src,
    fuelDeliveries: [gas('a', '2024-07-01', '2025-06-30'), gas('b', '2025-07-01', '2026-06-30')],
    costItems: [
      { ...src.costItems[0] ?? assert.fail('keine Position'), id: 'pa', fuelDeliveryId: 'a', period: periodKey('2025-01') },
      { ...src.costItems[0] ?? assert.fail('keine Position'), id: 'pb', fuelDeliveryId: 'b', period: periodKey('2025-01') },
    ],
  }
  const { sheet, heating } = both(both2)
  const co2 = heating?.co2 ?? assert.fail('keine CO₂-Aufteilung')
  assert.deepEqual(sheet.totals, { emissionsKg: 20000, co2CostCents: 130900 }, 'Summe der Rechnungen, nicht abgegrenzt')
  assert.equal(sheet.billing?.inPeriod?.coveragePermille, 1000)
  assert.ok(Math.abs((sheet.billing?.inPeriod?.emissionsKg ?? 0) - (co2.emissionsKg ?? 0)) < 0.01)
  assert.deepEqual([Math.round(sheet.billing?.inPeriod?.emissionsKg ?? 0), sheet.billing?.inPeriod?.co2Cents, co2.totalCents], [10000, 65450, 65450])
  const teile = sheet.deliveries.map((d) => d.inPeriod?.sharePermille ?? 0)
  assert.ok(teile.every((t) => t > 0 && t < 1000), String(teile))
  assert.ok(Math.abs(sheet.deliveries.reduce((a, d) => a + (d.inPeriod?.emissionsKg ?? 0), 0) - (sheet.billing?.inPeriod?.emissionsKg ?? 0)) < 1e-6)
})

test('S-K1: der Anfangsbestand zeigt den eingetragenen Betrag; berücksichtigt ist davon nichts, wenn schon umgelegt', () => {
  const { sheet } = both(oelSource({ openingAlreadySettled: true }))
  assert.deepEqual([sheet.opening?.co2CostCents, sheet.opening?.countedCents, sheet.opening?.co2Counted], [17517, 0, false])
  assert.equal(sheet.totals.co2CostCents, 52549)
})

test('W-N4 und Klein: Vermerke in der dritten Person, mit Heizperiode und Zahl der fehlenden Angaben; Gründe für den Vermieter nur ungedruckt', () => {
  const ungueltig = both(oelSource({}, false)).sheet
  assert.match(ungueltig.opening?.note ?? '', /Bestandsrechnung des Vorrats \(Heizperiode 2025\) geht nicht auf\./)
  assert.match(ungueltig.opening?.adminNote ?? '', /verknüpfen Sie/)
  const zwei = both(oelSource({ openingInvoicedBefore2023: null, openingEmissionsKg: null })).sheet
  assert.match(zwei.opening?.note ?? '', /Heizperiode 2025\) fehlen zwei Angaben \(/)
  const eine = both(oelSource({ openingInvoicedBefore2023: null })).sheet
  assert.match(eine.opening?.note ?? '', /fehlt eine Angabe \(ob der Anfangsbestand vor dem 01\.01\.2023 in Rechnung gestellt wurde\)/)
})

// Wächter: Kein gedruckter Vermerk des Blatts spricht den Leser an, über alle Vermerkarten (W-N4), auch nicht
// mit einer Aufforderung ohne „Sie“ (Runde 4, K-3). Die übrigen gedruckten Texte prüft co2Sheet.test.ts.
const ANREDE = /\b(Sie|Ihr\w*|Ihnen)\b|[Bb]itte/
test('Wächter: kein Vermerk des Blatts spricht den Leser an', () => {
  const faelle: Src[] = [
    oelSource({}), oelSource({}, false), oelSource({ openingInvoicedBefore2023: null }), oelSource({ openingEmissionsKg: null }), oelSource({ openingInvoicedBefore2023: true }),
    oelSource({ openingAlreadySettled: true }), oelSource({ closingQuantity: null }), oelSource({ openingCo2Cents: null }),
  ]
  const gas = co2Source(2025, { co2CostCents: 1 })
  const storno = { ...gas, costItems: [...gas.costItems, { ...gas.costItems[0] ?? assert.fail('keine Position'), id: 'gut', amountCents: -300000 }] }
  faelle.push(gas, storno, co2Source(2025, { estimated: true, amountCents: 300000 }), co2Source(2022, { invoiceDate: '2022-12-20' }), co2Source(2022, { invoiceDate: null }), co2Source(2025, {}, [], { energy: 'districtHeating', districtEtsNew: true }))
  const notes = faelle.flatMap((src) => {
    const year = Number(String(src.costItems[0]?.period ?? '2025').slice(0, 4))
    const p = periodOfKey(CALENDAR_RULES, periodKey(`${year}-01`)) ?? assert.fail('kein Zeitraum')
    const s = co2SheetFor(src, 'objekt-1', 'hp', p, '2026-10-07') ?? assert.fail('kein Blatt')
    return [s.opening?.note ?? null, ...s.deliveries.map((d) => d.note)].filter((n): n is string => n !== null)
  })
  assert.ok(notes.length >= 8, `zu wenige Vermerke: ${notes.length}`)
  for (const n of notes) assert.doesNotMatch(n, ANREDE, n)
})

test('Emissionshandel mit Anschluss nach dem Stichtag: keine Grundlage der Aufteilung auf dem Blatt', () => {
  const { sheet } = both(co2Source(2025, { co2CostCents: 1 }, [], { energy: 'districtHeating', districtEtsNew: true }))
  assert.equal(sheet.billing?.basis, null)
})

// Zufallsprüfung über Startwerte (S-W1, Punkt 5): Die abgegrenzte Zeile des Blatts ist die CO₂-Grundlage der
// Abrechnung, je Heizperiode, in kg und in €: beim Vorrat der Verbrauch, bei Rechnungen über einen Zeitraum
// die Summe der abgegrenzten Teile, solange die Rechnungen die Heizperiode ganz abdecken.
test('Invariante: abgegrenzte Zeile des Blatts = CO₂-Grundlage der Abrechnung, über Startwerte', () => {
  const from = Number(process.env.INV_FROM ?? 1)
  const to = Number(process.env.INV_TO ?? 120)
  let geprueft = 0
  let luecken = 0
  for (let seed = from; seed <= to; seed++) {
    let x = seed
    const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648)
    const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1))
    let src: Src
    if (rnd() < 0.5) {
      // Vorrat: Anfangsbestand, ein bis drei Lieferungen, Endbestand unter der Summe.
      const n = int(1, 3)
      const base = co2Source(2025, {}, [], { energy: 'oil' })
      const ds: FuelDelivery[] = Array.from({ length: n }, (_, i): FuelDelivery => {
        const q = int(5, 40) * 100
        return {
          ...(base.fuelDeliveries[0] ?? assert.fail('keine Lieferung')), id: `d${i}`, label: `Heizöl ${i}`, invoiceFrom: null, invoiceTo: null,
          deliveredAt: `2025-${String(int(1, 12)).padStart(2, '0')}-10`, invoiceDate: null, quantity: q, quantityUnit: 'l', emissionsKg: Math.round(q * 2.6763 * 100) / 100, co2CostCents: Math.round(q * 2.6763 * 0.0655 * 100),
        }
      }).map((d): FuelDelivery => ({ ...d, invoiceDate: d.deliveredAt }))
      const openingQ = int(0, 20) * 100
      const total = openingQ + ds.reduce((a, d) => a + (d.quantity ?? 0), 0)
      src = {
        ...base, fuelDeliveries: ds,
        costItems: ds.map((d, i) => ({ ...(base.costItems[0] ?? assert.fail('keine Position')), id: `p${i}`, fuelDeliveryId: d.id, amountCents: int(1000, 5000) * 100 })),
        heatingPeriodRows: [{
          plantId: 'hp', period: periodKey('2025-01'), dhwMethod: null, dhwUnmeasurable: null, stockUnit: 'l', openingQuantity: openingQ, openingCostCents: openingQ * 95,
          openingEmissionsKg: Math.round(openingQ * 2.6763 * 100) / 100, openingCo2Cents: Math.round(openingQ * 2.6763 * 0.0655 * 100), openingInvoicedBefore2023: rnd() < 0.2,
          openingAlreadySettled: rnd() < 0.2, closingQuantity: int(0, Math.floor(total / 100)) * 100, closingMeasuredOn: '2025-12-31',
        }],
      }
    } else {
      // Gas: zwei bis vier Rechnungen, die 2024 bis 2026 lückenlos abdecken, mit zufälligen Grenzen.
      const n = int(2, 4)
      const days = Array.from({ length: n - 1 }, () => int(1, 700)).sort((a, b) => a - b)
      const start = Date.UTC(2024, 6, 1)
      const iso = (d: number) => new Date(start + d * 86400000).toISOString().slice(0, 10)
      const bounds = [0, ...days, 730]
      const base = co2Source(2025, {})
      const ds: FuelDelivery[] = bounds.slice(0, -1).map((b, i) => ({
        ...(base.fuelDeliveries[0] ?? assert.fail('keine Lieferung')), id: `g${i}`, label: `Gas ${i}`, invoiceFrom: iso(i === 0 ? b : b), invoiceTo: iso((bounds[i + 1] ?? 730) - 1),
        invoiceDate: null, emissionsKg: int(1000, 20000), co2CostCents: int(5000, 150000),
      }))
      // Mit Lücke (Runde 4, Gegenmutation a): eine Rechnung fehlt, die Abrechnung rechnet die kg hoch.
      if (n > 2 && rnd() < 0.4) ds.splice(int(0, ds.length - 1), 1)
      src = { ...base, fuelDeliveries: ds, costItems: ds.map((d, i) => ({ ...(base.costItems[0] ?? assert.fail('keine Position')), id: `p${i}`, fuelDeliveryId: d.id, amountCents: int(1000, 5000) * 100 })) }
    }
    const { sheet, heating } = both(src)
    const co2 = heating?.co2
    if (!co2 || co2.emissionsKg === null || co2.totalCents === null) continue
    const fall = `Startwert ${seed}`
    if (sheet.billing?.consumed) {
      assert.deepEqual([sheet.billing?.consumed.emissionsKg, sheet.billing?.consumed.co2Cents], [co2.emissionsKg, co2.totalCents], fall)
    } else if (sheet.billing?.inPeriod && sheet.billing?.inPeriod.coveragePermille === 1000) {
      assert.ok(Math.abs(sheet.billing?.inPeriod.emissionsKg - co2.emissionsKg) < 0.011, `${fall}: ${sheet.billing?.inPeriod.emissionsKg} gegen ${co2.emissionsKg}`)
      assert.equal(sheet.billing?.inPeriod.co2Cents, co2.totalCents, fall)
    } else if (sheet.billing?.inPeriod) {
      // Lücke: die abgegrenzte Zeile ist die Summe der abgegrenzten Teile der Abrechnung, die € gleich der
      // Grundlage (nur die kg werden hochgerechnet).
      const teile = (heating?.fuel?.deliveries ?? []).reduce((a, l) => a + (l.emissionsKg ?? 0), 0)
      assert.ok(Math.abs(sheet.billing.inPeriod.emissionsKg - teile) < 1e-6, `${fall}: ${sheet.billing.inPeriod.emissionsKg} gegen ${teile}`)
      assert.equal(sheet.billing.inPeriod.co2Cents, co2.totalCents, fall)
      luecken++
    } else continue
    assert.deepEqual([sheet.billing?.basis?.emissionsKg, sheet.billing?.basis?.co2Cents], [co2.emissionsKg, co2.totalCents], fall)
    geprueft++
  }
  assert.ok(geprueft >= (to - from + 1) / 3, `zu wenige geprüfte Fälle: ${geprueft}`)
  if (to - from >= 50) assert.ok(luecken >= 5, `zu wenige Fälle mit Lücke: ${luecken}`)
})

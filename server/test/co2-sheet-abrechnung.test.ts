// Das Blatt „CO₂-Angaben für den Messdienst“ und die Abrechnung entscheiden über den Anfangsbestand eines
// Vorrats gleich (Heizung PR 17, Nachprüfung von #246, O2a/O2b): Das Blatt liest die Bestandsrechnung der
// Abrechnung (`plantStockOf`) und hat keine eigene Regel. Fehlt eine Angabe, rechnet die Abrechnung den
// Vorrat nicht, und das Blatt zählt den Anfangsbestand ebenfalls nicht.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement } from '../src/calc.ts'
import { co2SheetFor } from '../src/co2Sheet.ts'
import { snapshotFor, type SnapshotHeatingPeriodRow } from '../src/snapshot.ts'
import { co2Source } from '../testing/co2Snapshot.ts'
import { CALENDAR_RULES, periodKey, periodOfKey } from '../../shared/period.ts'

const P = periodOfKey(CALENDAR_RULES, periodKey('2025-01')) ?? assert.fail('kein Zeitraum 2025')
type Row = Partial<SnapshotHeatingPeriodRow>

const oel = { deliveredAt: '2025-03-15', invoiceDate: '2025-03-15', invoiceFrom: null, invoiceTo: null, quantity: 3000, quantityUnit: 'l' as const, emissionsKg: 8028.9, co2CostCents: 52549, label: 'Heizöl März' }
const vorrat: Row = { stockUnit: 'l', openingQuantity: 1000, openingCostCents: 95000, openingEmissionsKg: 2676.3, openingCo2Cents: 17517, openingInvoicedBefore2023: false, openingAlreadySettled: null, closingQuantity: 800, closingMeasuredOn: '2025-12-31' }

function source(row: Row) {
  const src = co2Source(2025, oel, [], { energy: 'oil' })
  return { ...src, costItems: src.costItems.map((c) => ({ ...c, amountCents: 315000 })), heatingPeriodRows: [{ plantId: 'hp', period: periodKey('2025-01'), dhwMethod: null, dhwUnmeasurable: null, ...row }] }
}
function both(row: Row) {
  const src = source(row)
  const sheet = co2SheetFor(src, 'objekt-1', 'hp', P, '2026-10-07') ?? assert.fail('kein Blatt')
  const s = computeSettlement(snapshotFor(src, 'objekt-1', P))
  return { sheet, stock: s.heating?.find((h) => h.plantId === 'hp')?.stock ?? null }
}

test('O2a: fehlt die Angabe „vor 2023 in Rechnung gestellt“, rechnet die Abrechnung den Vorrat nicht, und das Blatt zählt den Anfangsbestand nicht', () => {
  const { sheet, stock } = both({ ...vorrat, openingInvoicedBefore2023: null })
  assert.equal(stock, null, 'die Abrechnung rechnet den Vorrat nicht')
  assert.deepEqual([sheet.opening?.kgCounted, sheet.opening?.co2Counted], [false, false])
  assert.match(sheet.opening?.note ?? '', /Nicht berücksichtigt: Für die Bestandsrechnung des Vorrats \(Heizperiode 2025\) fehlt eine Angabe \(ob der Anfangsbestand vor dem 01\.01\.2023 in Rechnung gestellt wurde\)/)
  assert.deepEqual(sheet.totals, { emissionsKg: 8028.9, co2CostCents: 52549 })
})

test('O2b: ohne kg des Anfangsbestands ebenso; die Zeile bleibt sichtbar', () => {
  const { sheet, stock } = both({ ...vorrat, openingEmissionsKg: null })
  assert.equal(stock, null)
  assert.deepEqual([sheet.opening?.emissionsKg, sheet.opening?.kgCounted, sheet.opening?.co2Counted], [null, false, false])
  assert.match(sheet.opening?.note ?? '', /der CO₂-Ausstoß des Anfangsbestands in kg/)
  assert.deepEqual(sheet.totals, { emissionsKg: 8028.9, co2CostCents: 52549 })
})

test('Vollständige Angaben: das Blatt zählt den Anfangsbestand genau so wie die Abrechnung', () => {
  const { sheet, stock } = both(vorrat)
  const o = stock?.opening ?? assert.fail('keine Bestandsrechnung')
  assert.deepEqual([sheet.opening?.emissionsKg, sheet.opening?.countedCents, sheet.opening?.co2Counted], [o.emissionsKg, o.co2Cents, true])
  assert.deepEqual(sheet.totals, { emissionsKg: Math.round((8028.9 + o.emissionsKg) * 100) / 100, co2CostCents: 52549 + o.co2Cents })
})

test('G-W2: vor 2023 in Rechnung gestellt oder schon umgelegt: nur die kg zählen, mit Vermerk', () => {
  const alt = both({ ...vorrat, openingInvoicedBefore2023: true })
  assert.deepEqual([alt.sheet.opening?.kgCounted, alt.sheet.opening?.co2Counted, alt.sheet.totals.co2CostCents], [true, false, 52549])
  assert.match(alt.sheet.opening?.note ?? '', /§ 11 Abs\. 2 Satz 2/)
  const umgelegt = both({ ...vorrat, openingAlreadySettled: true })
  assert.deepEqual([umgelegt.sheet.opening?.kgCounted, umgelegt.sheet.opening?.co2Counted, umgelegt.sheet.totals.co2CostCents], [true, false, 52549])
  assert.match(umgelegt.sheet.opening?.note ?? '', /früheren Abrechnung/)
})

// Zufallsprüfung: über alle Kombinationen der Angaben zum Anfangsbestand ist, was das Blatt vom Anfangsbestand
// zählt, genau das, was die Abrechnung als Anfangsbestand ansetzt (nichts, wenn sie den Vorrat nicht rechnet).
test('Invariante: Anfangsbestand des Blatts = Anfangsbestand der Abrechnung, über zufällige Angaben', () => {
  let seed = 17
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T
  for (let i = 0; i < 300; i++) {
    const row: Row = {
      ...vorrat,
      openingEmissionsKg: pick([null, 2676.3, 1000]),
      openingCo2Cents: pick([null, 0, 17517, 5000]),
      openingCostCents: pick([null, 95000]),
      openingInvoicedBefore2023: pick([null, true, false]),
      openingAlreadySettled: pick([null, true, false]),
      closingQuantity: pick([null, 800, 0]),
    }
    const { sheet, stock } = both(row)
    const kg = sheet.opening?.kgCounted ? (sheet.opening.emissionsKg ?? 0) : 0
    const co2 = sheet.opening?.countedCents ?? 0
    const fall = JSON.stringify(row)
    assert.deepEqual([kg, co2], stock ? [stock.opening.emissionsKg, stock.opening.co2Cents] : [0, 0], fall)
    assert.deepEqual(sheet.totals, { emissionsKg: Math.round((8028.9 + kg) * 100) / 100, co2CostCents: 52549 + co2 }, fall)
  }
})

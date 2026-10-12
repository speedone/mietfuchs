// Die Abzugszeilen nach § 7 Abs. 5 CO2KostAufG an allen Stellen, an denen die Berechnung die CO₂-Abzugszeile
// eines Topfs erkennt (Heizung PR 18, Prüfung M5): Vorschlag nach § 560 im Rumpfzeitraum und Kürzungsbeträge.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement } from '../src/calc.ts'
import { snapshotFor } from '../src/snapshot.ts'
import { periodKey, periodOfKey } from '../../shared/period.ts'
import type { PeriodRules } from '../../shared/types.ts'
import { delivery, item, plant, three, type Quelle } from '../testing/halfSplitSnapshot.ts'

// Ein Rumpf 01.01.–30.04.2028 (Wechsel des Rhythmus auf Mai), ganz in der Teilung nach § 5a.
const RUMPF: PeriodRules = { startMonth: 1, changes: ['2028-05'] }
function rumpf(over: Partial<Quelle>) {
  const p = periodOfKey(RUMPF, periodKey('2028-01')) ?? assert.fail('kein Rumpf')
  const q = three({
    properties: [{ id: 'objekt-1', kind: 'mfh', cableBuiltBeforeDec2021: null, tightMarket: null, periodRules: RUMPF }],
    costItems: [item({ id: 'gas', period: periodKey('2028-01'), amountCents: 300000, serviceFrom: '2028-01-01', serviceTo: '2028-04-30' })],
    fuelDeliveries: [delivery({ invoiceFrom: '2028-01-01', invoiceTo: '2028-04-30', label: 'Gas Jan–Apr 2028', emissionsKg: null, co2CostCents: null })],
    tenancies: ['a', 'b', 'c'].map((u) => ({
      id: `t${u}`, unitId: u, tenantName: `Mieter ${u.toUpperCase()}`, persons: 1, personHistory: [], start: '2020-01-01', end: null,
      prepayments: [{ from: '2020-01', monthlyCents: 10000 }], prepaymentOverrides: {}, baseRents: [],
    })),
    ...over,
  })
  return computeSettlement(snapshotFor(q, 'objekt-1', p))
}

test('Rumpf: die Abzugszeile nach § 5a gehört zu denselben Heizkosten wie ihr Brennstoff (Vorschlag nach § 560)', () => {
  // Netzentgelte 300 €, ganz in 2028: Der Vermieter trägt 150 €, Mieter A (50 %) davon 75 €.
  const mit = rumpf({ fuelDeliveries: [delivery({ invoiceFrom: '2028-01-01', invoiceTo: '2028-04-30', label: 'Gas Jan–Apr 2028', emissionsKg: null, co2CostCents: null, gridFeeCents: 30000 })] })
  const a = mit.statements.find((s) => s.tenancyId === 'ta') ?? assert.fail('kein Mieter A')
  assert.deepEqual(a.rows.filter((r) => r.kind === 'gmodgRelief').map((r) => r.shareCents), [-7500])
  // Derselbe Vorschlag wie ohne Netzentgelte mit 150 € weniger Brennstoff.
  const netto = rumpf({ costItems: [item({ id: 'gas', period: periodKey('2028-01'), amountCents: 285000, serviceFrom: '2028-01-01', serviceTo: '2028-04-30' })] })
  const b = netto.statements.find((s) => s.tenancyId === 'ta') ?? assert.fail('kein Mieter A')
  assert.equal(a.totalShareCents, b.totalShareCents)
  assert.ok(b.suggestedMonthlyCents > 0, `Vorschlag ${b.suggestedMonthlyCents}`)
  assert.equal(a.suggestedMonthlyCents, b.suggestedMonthlyCents)
})

test('Kürzungsbeträge nach § 7 Abs. 4 rechnen auf die Heizkosten nach beiden Abzügen (Entwurf 6.5)', () => {
  // Ohne CO₂-Angaben: `co2.incomplete` nennt die 3 % je Mieter auf die Heizkosten nach dem Abzug nach § 5a.
  const p = periodOfKey({ startMonth: 5, changes: [] }, periodKey('2027-05')) ?? assert.fail('kein Zeitraum')
  const r = computeSettlement(snapshotFor(three({
    fuelDeliveries: [delivery({ gridFeeCents: 30000, emissionsKg: null, co2CostCents: null })],
    heatingPlants: [plant()],
  }), 'objekt-1', p))
  const n = r.notices.find((x) => x.code === 'co2.incomplete') ?? assert.fail('kein Hinweis')
  // Mieter A: 4.500,00 € − 39,75 € = 4.460,25 €; 3 % = 133,81 €.
  assert.match(n.text, /Mieter A \(A\) 133,81 €/)
})

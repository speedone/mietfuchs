// Kürzung nach § 12 Abs. 1 HeizkostenV und die Überträge `fuel:` (Integrationsdurchsicht vor 0.11.0, S2).
//
// Abrechnungszeitraum Mai bis April, Gasrechnung über das Kalenderjahr 2027 als Position in 2027/28: Ein Teil der
// Rechnung gehört über einen Übertrag in 2026/27. Nach Fläche verteilt darf jeder Mieter seinen Anteil um 15 %
// kürzen; gemeint ist der Anteil, den er in **dieser** Abrechnung trägt. Vorher fehlte der Hinweis in 2026/27 ganz,
// und in 2027/28 nannte er 15 % von 1.800,00 € = 270,00 €, obwohl Mieter A netto nur 846,00 € trägt.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { snapshotFor } from '../src/snapshot.ts'
import { periodKey, periodOfKey } from '../../shared/period.ts'
import { co2Source } from '../testing/co2Snapshot.ts'
import type { PeriodRules } from '../../shared/types.ts'

const MAI: PeriodRules = { startMonth: 5, changes: [] }
const base = co2Source(2027, { invoiceFrom: '2027-01-01', invoiceTo: '2027-12-31', emissionsKg: 10000, co2CostCents: 50000 })
const property = base.properties?.[0] ?? assert.fail('kein Objekt')
const src = {
  ...base,
  properties: [{ ...property, periodRules: MAI }],
  costItems: base.costItems.map((c) => ({ ...c, period: periodKey('2027-05'), heatingPart: 'fuel' as const, taxYear: 2027 })),
}
const settle = (key: string): ComputedSettlement =>
  computeSettlement(snapshotFor(src, 'objekt-1', periodOfKey(MAI, periodKey(key)) ?? assert.fail(`kein Zeitraum ${key}`)))
const gasOf = (r: ComputedSettlement, tenancyId: string) =>
  (r.statements.find((s) => s.tenancyId === tenancyId) ?? assert.fail(`kein Mieter ${tenancyId}`)).rows
    .filter((x) => x.costItemId === 'gas' || (x.costItemId.startsWith('fuel:') && x.costItemId.endsWith(':gas')))
    .reduce((a, x) => a + x.shareCents, 0)
const cutText = (r: ComputedSettlement) => r.notices.find((n) => n.code === 'heating.not-by-consumption')?.text ?? assert.fail(`kein Hinweis: ${r.notices.map((n) => n.code).join(', ')}`)

test('S2: § 12 nennt je Abrechnung 15 % des Anteils samt Übertrag (2026/27: 143,10 €, 2027/28: 126,90 € statt 270,00 €)', () => {
  const vorher = settle('2026-05')
  const nachher = settle('2027-05')
  assert.deepEqual([gasOf(vorher, 'ta'), gasOf(nachher, 'ta')], [95400, 84600])
  assert.match(cutText(vorher), /hier: Mieter A \(A\) 143,10 €/)
  assert.match(cutText(nachher), /hier: Mieter A \(A\) 126,90 €/)
  // Über beide Zeiträume zusammen wie vorher 270,00 €.
  assert.doesNotMatch(cutText(nachher), /270,00/)
})

test('S2: im Zeitraum, der nur Überträge hat, auch der Hinweis zur Fernablesung (§ 5 Abs. 2 HeizkostenV)', () => {
  const codes = (r: ComputedSettlement) => r.notices.map((n) => n.code).filter((c) => c.startsWith('heating.remote'))
  assert.deepEqual(codes(settle('2026-05')), codes(settle('2027-05')))
})

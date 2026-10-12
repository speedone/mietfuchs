// Das Blatt „CO₂-Angaben für den Messdienst“ bei einer Heizung nach § 43 Abs. 1 GModG (Heizung PR 18, #215):
// Was der Messdienst für die hälftige Teilung nach § 5a CO2KostAufG braucht.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { co2SheetFor } from '../src/co2Sheet.ts'
import { periodKey, periodOfKey } from '../../shared/period.ts'
import { delivery, MAI, plant, three } from '../testing/halfSplitSnapshot.ts'
import type { FuelDelivery } from '../../shared/types.ts'

const H27 = periodOfKey(MAI, periodKey('2027-05')) ?? assert.fail('kein Zeitraum')
const H26 = periodOfKey(MAI, periodKey('2026-05')) ?? assert.fail('kein Zeitraum')
// Die Anlage mit ihrem Objekt, wie die Route sie hineinreicht.
const quelle = (anlage: ReturnType<typeof plant>, deliveries: FuelDelivery[] = [delivery()]) => ({ ...three(), heatingPlants: [anlage], fuelDeliveries: deliveries })

test('Heizperiode 2027/2028: Tag des Einbaus, Anteil in der Teilung, Netzentgelte und Biobrennstoff je Rechnung', () => {
  const s = co2SheetFor(quelle(plant(), [delivery({ gridFeeCents: 30000, bioCostCents: 0 })]), 'objekt-1', 'hp', H27, '2028-06-01') ?? assert.fail('kein Blatt')
  const h = s.halfSplit ?? assert.fail('keine Angaben zu § 5a')
  assert.equal(h.installedOn, '2027-03-01')
  assert.equal(h.status, 'applies')
  assert.equal(h.newBuilding, false)
  assert.ok(Math.abs(h.sharePermille - 530) < 1e-9, `${h.sharePermille}`)
  assert.deepEqual([h.landlordGridFeeCents, h.landlordBioCents, h.twoFamily], [7950, 0, null])
  assert.deepEqual(s.deliveries.map((d) => [d.gridFeeCents, d.bioCostCents]), [[30000, 0]])
})

test('Notfalleinbau: das Blatt nennt die Zeit ohne Teilung; ohne Merkmal oder vor 2028 keine Angaben', () => {
  const notfall = co2SheetFor(quelle(plant({ gmodg43InstalledOn: '2027-06-15', emergencyInstall: true })), 'objekt-1', 'hp', H27, '2028-06-01') ?? assert.fail('kein Blatt')
  assert.deepEqual(notfall.halfSplit?.excluded, [{ from: '2027-06-15', to: '2028-06-15', rule: 'emergency1' }])
  assert.equal(notfall.halfSplit?.sharePermille, 0)
  const ohne = co2SheetFor(quelle(plant({ gmodg43InstalledOn: null })), 'objekt-1', 'hp', H27, '2028-06-01') ?? assert.fail('kein Blatt')
  assert.equal(ohne.halfSplit, undefined)
  const vorher = co2SheetFor(quelle(plant(), [delivery({ invoiceFrom: '2026-05-01', invoiceTo: '2027-04-30' })]), 'objekt-1', 'hp', H26, '2027-06-01') ?? assert.fail('kein Blatt')
  assert.equal(vorher.halfSplit, undefined)
})

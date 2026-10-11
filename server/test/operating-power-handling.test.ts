// Angabe an der Heizanlage, wie der Betriebsstrom erfasst ist (#266): wo Mietfuchs danach fragt, und dass die
// Beschriftungen zur Liste der Werte passen. Die Unterscheidung „eigener Stromvertrag“ gegen „Zwischenzähler“
// steht in den Beschriftungen selbst (Rechtsprüfung des Plans, M-1): Ein Zwischenzähler hinter dem Zähler des
// Hauses ersetzt nur das Schätzen, nicht den Abzug (BGH, Versäumnisurteil vom 20.02.2008, VIII ZR 27/07, Rn. 32).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { asksOperatingPowerHandling, OPERATING_POWER_BURNERS, OPERATING_POWER_HANDLING_LABELS, OPERATING_POWER_HANDLING_QUESTION } from '../../shared/operatingPower.ts'
import { HEATING_ENERGIES, OPERATING_POWER_HANDLINGS } from '../src/db/schema.ts'
import type { HeatingEnergy } from '../../shared/types.ts'

const plant = (over: Partial<Parameters<typeof asksOperatingPowerHandling>[0]> = {}) =>
  ({ energy: 'gas' as HeatingEnergy, method: 'manual' as const, source: 'building' as const, supply: 'central' as const, ...over })

test('gefragt wird bei Zentralheizungen mit Brenner, die der Vermieter selbst verteilt oder abrechnet', () => {
  for (const energy of ['gas', 'oil', 'lpg', 'pellets', 'wood', 'coal'] as HeatingEnergy[]) {
    for (const method of ['manual', 'self'] as const) assert.equal(asksOperatingPowerHandling(plant({ energy, method })), true, `${energy}/${method}`)
  }
  // Ohne Angabe der Versorgung ist die Anlage zentral.
  assert.equal(asksOperatingPowerHandling({ energy: 'gas', method: 'manual', source: 'building' }), true)
  assert.deepEqual([...OPERATING_POWER_BURNERS].sort(), ['coal', 'gas', 'lpg', 'oil', 'pellets', 'wood'])
})

test('nicht gefragt bei Messdienst, Gemeinschaft, Etagenheizung und ohne Brenner', () => {
  assert.equal(asksOperatingPowerHandling(plant({ method: 'service' })), false)
  assert.equal(asksOperatingPowerHandling(plant({ source: 'homeowners', method: 'service' })), false)
  assert.equal(asksOperatingPowerHandling(plant({ source: 'homeowners' })), false)
  assert.equal(asksOperatingPowerHandling(plant({ supply: 'perUnit' })), false)
  for (const energy of ['districtHeating', 'heatPump', 'electric', 'other'] as HeatingEnergy[]) assert.equal(asksOperatingPowerHandling(plant({ energy })), false, energy)
  // Jeder Energieträger ist entweder Brenner oder ausdrücklich ohne Frage.
  for (const energy of HEATING_ENERGIES) assert.equal(asksOperatingPowerHandling(plant({ energy })), OPERATING_POWER_BURNERS.includes(energy), energy)
})

test('Beschriftungen: eine je Wert der Liste und eine für „keine Angabe“', () => {
  assert.deepEqual(Object.keys(OPERATING_POWER_HANDLING_LABELS).sort(), ['', ...OPERATING_POWER_HANDLINGS].sort())
  assert.equal(OPERATING_POWER_HANDLING_LABELS[''], 'Keine Angabe')
  assert.equal(OPERATING_POWER_HANDLING_QUESTION, 'Wie ist der Betriebsstrom dieser Heizung erfasst?')
})

test('Beschriftungen unterscheiden den eigenen Stromvertrag vom Zwischenzähler (M-1)', () => {
  assert.equal(OPERATING_POWER_HANDLING_LABELS.ownMeter, 'Eigener Stromvertrag (eigener Zähler mit eigener Rechnung), Rechnung als Heizposition „Betrieb“ erfasst')
  assert.equal(OPERATING_POWER_HANDLING_LABELS.deducted, 'Über die Stromrechnung des Hauses (auch mit Zwischenzähler), beim Allgemeinstrom abgezogen')
  assert.equal(OPERATING_POWER_HANDLING_LABELS.landlordPays, 'Eigener Stromvertrag (eigener Zähler mit eigener Rechnung), die Kosten trägt der Vermieter selbst')
  for (const v of ['ownMeter', 'landlordPays'] as const) assert.match(OPERATING_POWER_HANDLING_LABELS[v], /eigener Rechnung/)
  assert.match(OPERATING_POWER_HANDLING_LABELS.deducted, /Zwischenzähler/)
})

import { expect, test } from 'vitest'
import { dhwBlock, showsDhwBlock } from './dhwView'
import type { DhwStatement } from './types'

const formel: DhwStatement = {
  method: 'volumeFormula', alpha: 0.255102, heatKwh: 15000, formulaKwh: 15000, factor: null,
  denominator: { kind: 'fuelQuantity', value: 6000, unit: 'l' }, energyKwh: 58800, estimated: false,
  fuelForDhw: { quantity: 1530.61, unit: 'l', heatingValue: 9.8 },
  heatingValues: [
    { label: 'Öl Oktober', kwh: 9.8, per: 'l', source: 'invoice', grade: 'heatingOilEL' },
    { label: 'Öl Dezember', kwh: 10, per: 'l', source: 'table', grade: 'heatingOilEL' },
  ],
  steps: ['Q = 2,5 · 120 m³ · (60 °C − 10 °C) = 15.000 kWh (§ 9 Abs. 2 Satz 2 HeizkostenV)'],
}

test('Druckblock Warmwasseranteil: α mit Methode, Rechenweg und Heizwerte samt Herkunft (Entwurf 8.8)', () => {
  expect(dhwBlock(formel)).toEqual({
    title: 'Warmwasseranteil 25,51 %',
    method: 'aus dem gemessenen Warmwasser berechnet (§ 9 Abs. 2 Satz 2 HeizkostenV)',
    steps: formel.steps,
    values: [
      'Heizwert „Öl Oktober“: 9,8 kWh je Liter laut Rechnung',
      'Heizwert „Öl Dezember“: 10 kWh je Liter aus der Tabelle der Heizkostenverordnung (Leichtes Heizöl extra leichtflüssig), weil die Rechnung keinen nennt',
    ],
  })
  expect(dhwBlock(undefined)).toBe(null)
})

test('Gemessen gegen kWh laut Rechnung bleibt der Satz von PR 10; Formel und Brennstoff als Menge zeigen den Rechenweg', () => {
  const gemessen: DhwStatement = { ...formel, method: 'heatMeter', formulaKwh: null, denominator: { kind: 'fuelKwh', value: 60000, unit: 'kWh' }, fuelForDhw: null, heatingValues: [] }
  expect(showsDhwBlock(gemessen)).toBe(false)
  expect(showsDhwBlock({ ...gemessen, denominator: { kind: 'fuelQuantity', value: 6000, unit: 'l' } })).toBe(true)
  expect(showsDhwBlock(formel)).toBe(true)
  expect(showsDhwBlock(undefined)).toBe(false)
})

test('Durchsicht #240, M3: beruht die Energie auf der Schätzung beim Abschluss, sagt der Block das', () => {
  expect(dhwBlock({ ...formel, estimated: true })?.values.at(-1)).toBe('Die Energie beruht teils auf einer Schätzung der fehlenden Rechnung.')
  expect(dhwBlock(formel)?.values).toHaveLength(2)
})

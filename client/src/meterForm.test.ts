// Die Einheit eines Zählers folgt seiner Sparte (#142): Ein Wärmezähler, bei dem niemand die
// Einheit geändert hat, zeigte „m³“.
import { expect, test } from 'vitest'
import { defaultMeterUnit, oldEndText, withMeterType } from './meterForm'

test('Vorgabe der Einheit je Sparte: Wasser m³, Wärme und Strom kWh, Sonstiges leer', () => {
  expect(defaultMeterUnit('kaltwasser')).toBe('m³')
  expect(defaultMeterUnit('waerme')).toBe('kWh')
  expect(defaultMeterUnit('strom')).toBe('kWh')
  expect(defaultMeterUnit('sonstig')).toBe('')
})

test('Sparte wechseln: die Vorgabe wandert mit, eine eigene Einheit bleibt', () => {
  const form = { name: 'Wärme EG', unitId: '', type: 'kaltwasser' as const, meterNumber: '', unit: 'm³' }
  expect(withMeterType(form, 'waerme')).toMatchObject({ type: 'waerme', unit: 'kWh' })
  expect(withMeterType({ ...form, unit: '' }, 'waerme')).toMatchObject({ unit: 'kWh' })
  expect(withMeterType({ ...form, unit: 'MWh' }, 'waerme')).toMatchObject({ type: 'waerme', unit: 'MWh' })
  expect(withMeterType({ ...form, type: 'waerme', unit: 'kWh' }, 'sonstig')).toMatchObject({ unit: '' })
})

test('Zählerwechsel: ein fehlender Endstand heißt „fehlt“, eine 0 bleibt eine 0', () => {
  expect(oldEndText(null)).toBe('fehlt')
  expect(oldEndText(undefined)).toBe('fehlt')
  expect(oldEndText(0)).toBe('0')
  expect(oldEndText(1234.5)).toBe('1.234,5')
})

test('ein bestehender Zähler behält beim Wechsel der Sparte seine Einheit (Durchsicht zu #142)', () => {
  const vorhanden = { id: 'm1', name: 'Zähler', unitId: '', type: 'kaltwasser' as const, meterNumber: '', unit: 'm³' }
  expect(withMeterType(vorhanden, 'waerme')).toMatchObject({ type: 'waerme', unit: 'm³' })
})

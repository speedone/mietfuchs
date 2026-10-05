// Die Einheit eines Zählers folgt seiner Sparte (#142): Ein Wärmezähler, bei dem niemand die
// Einheit geändert hat, zeigte „m³“.
import { expect, test } from 'vitest'
import { defaultMeterUnit, emptyMeterForm, meterBody, meterToForm, oldEndText, withMeterType } from './meterForm'

test('Vorgabe der Einheit je Sparte: Wasser m³, Wärme und Strom kWh, Sonstiges leer', () => {
  expect(defaultMeterUnit('kaltwasser')).toBe('m³')
  expect(defaultMeterUnit('waerme')).toBe('kWh')
  expect(defaultMeterUnit('strom')).toBe('kWh')
  expect(defaultMeterUnit('sonstig')).toBe('')
})

test('Sparte wechseln: die Vorgabe wandert mit, eine eigene Einheit bleibt', () => {
  const form = { ...emptyMeterForm(), name: 'Wärme EG' }
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
  const vorhanden = { ...emptyMeterForm(), id: 'm1', name: 'Zähler' }
  expect(withMeterType(vorhanden, 'waerme')).toMatchObject({ type: 'waerme', unit: 'm³' })
})

test('Warmwasser in m³, Heizkostenverteiler in Einheiten (Heizung PR 4)', () => {
  expect(defaultMeterUnit('warmwasser')).toBe('m³')
  expect(defaultMeterUnit('hkv')).toBe('Einheiten')
})

test('Zähler der Heizanlage: nur ohne Wohnung und mit Anlage; Fernablesbarkeit nur bei Geräten nach § 5 HeizkostenV', () => {
  const speicher = { ...emptyMeterForm(), name: 'Speicher', type: 'waerme' as const, unit: 'kWh', heatingRole: 'dhwHeat' as const, remote: 'no' as const, installedOn: '2022-03-01' }
  expect(meterBody(speicher, 'hp1')).toEqual({
    body: { name: 'Speicher', unitId: null, type: 'waerme', unit: 'kWh', heatingPlantId: 'hp1', heatingRole: 'dhwHeat', remoteReadable: false, installedOn: '2022-03-01' },
  })
  // Ohne Anlage im Objekt bleibt es ein Hauptzähler, und dann fragt das Formular nicht nach § 5.
  expect(meterBody(speicher, null)).toMatchObject({ body: { heatingPlantId: null, heatingRole: null, remoteReadable: null, installedOn: null } })
  // Der Gaszähler gehört dem Versorger: Rolle ja, Fernablesbarkeit nein.
  expect(meterBody({ ...speicher, name: 'Gas', type: 'sonstig', heatingRole: 'supply' }, 'hp1'))
    .toMatchObject({ body: { heatingPlantId: 'hp1', heatingRole: 'supply', remoteReadable: null, installedOn: null } })
  // An einer Wohnung: Kaltwasser ohne, Heizkostenverteiler mit Fernablesbarkeit.
  expect(meterBody({ ...emptyMeterForm(), name: 'Küche', unitId: 'eg', remote: 'yes' }, 'hp1')).toMatchObject({ body: { unitId: 'eg', heatingPlantId: null, remoteReadable: null } })
  const hkv = { ...emptyMeterForm(), name: 'HKV Bad', unitId: 'eg', type: 'hkv' as const, unit: 'Einheiten', remote: 'yes' as const }
  expect(meterBody(hkv, 'hp1')).toMatchObject({ body: { remoteReadable: true, heatingPlantId: null } })
  expect(meterBody({ ...hkv, unitId: '' }, 'hp1')).toEqual({ error: expect.stringMatching(/Heizkörper/) })
  expect(meterBody({ ...hkv, name: ' ' }, 'hp1')).toEqual({ error: 'Bitte einen Namen für den Zähler angeben.' })
})

test('Bearbeiten: was gespeichert ist, steht wieder im Formular', () => {
  expect(meterToForm({
    id: 'm1', propertyId: 'objekt-1', name: 'Speicher', unitId: null, type: 'waerme', unit: 'kWh',
    heatingPlantId: 'hp1', heatingRole: 'dhwHeat', remoteReadable: false, installedOn: '2022-03-01',
  })).toEqual({ id: 'm1', name: 'Speicher', unitId: '', type: 'waerme', meterNumber: '', unit: 'kWh', heatingRole: 'dhwHeat', remote: 'no', installedOn: '2022-03-01' })
})

import { expect, test } from 'vitest'
import type { HeatingPlant, Meter, Reading, Unit } from './types'
import { buildReadingSheet, calibrationMark, DEFAULT_SHEET_OPTIONS, type SheetOptions } from './readingSheet'

const unit = (id: string, name: string): Unit => ({ id, propertyId: 'p', name, areaM2: 50, participates: true })
const meter = (id: string, over: Partial<Meter> = {}): Meter => ({ id, propertyId: 'p', name: id, unitId: null, type: 'kaltwasser', unit: 'm³', ...over })
const reading = (meterId: string, date: string, value: number): Reading => ({ id: `${meterId}-${date}-${value}`, meterId, date, value })
const plant = { id: 'h1', name: 'Heizung Keller' } as HeatingPlant

const UNITS = [unit('u1', 'EG'), unit('u2', 'OG')]
const build = (meters: Meter[], options: SheetOptions = DEFAULT_SHEET_OPTIONS, readings: Reading[] = [], plants: HeatingPlant[] = []) =>
  buildReadingSheet({ meters, readings, units: UNITS, plants, year: 2026, options })

test('gruppiert: Hauptzähler zuerst, dann Wohnungen in ihrer Reihenfolge, die Heizanlage zuletzt', () => {
  const meters = [
    meter('og', { unitId: 'u2' }),
    meter('heiz', { heatingPlantId: 'h1', heatingRole: 'supply', type: 'waerme', unit: 'kWh' }),
    meter('haus'),
    meter('eg', { unitId: 'u1' }),
  ]
  const sheet = build(meters, DEFAULT_SHEET_OPTIONS, [], [plant])
  expect(sheet.groups.map((g) => g.title)).toEqual(['Hauptzähler (Haus)', 'EG', 'OG', 'Heizanlage Heizung Keller'])
  expect(sheet.groups.map((g) => g.rows.map((r) => r.name))).toEqual([['haus'], ['eg'], ['og'], ['heiz']])
})

test('der letzte Stand ist der mit dem jüngsten Datum, bei Gleichstand der spätere in der Liste', () => {
  const readings = [reading('a', '2025-12-31', 10), reading('a', '2024-12-31', 5), reading('b', '2025-01-01', 1), reading('b', '2025-01-01', 2)]
  const rows = build([meter('a'), meter('b')], DEFAULT_SHEET_OPTIONS, readings).groups.flatMap((g) => g.rows)
  expect(rows.map((r) => r.last)).toEqual([{ value: 10, date: '2025-12-31' }, { value: 2, date: '2025-01-01' }])
})

test('ein Zähler ohne Ablesung hat keinen letzten Stand', () => {
  expect(build([meter('a')]).groups[0]?.rows[0]?.last).toBeNull()
})

test('Eichfrist: abgelaufen vor dem laufenden Jahr, endet im laufenden und im folgenden Jahr, sonst nichts', () => {
  expect(calibrationMark({ type: 'kaltwasser', calibratedUntil: 2025 }, 2026)).toEqual({ kind: 'overdue', year: 2025 })
  expect(calibrationMark({ type: 'kaltwasser', calibratedUntil: 2026 }, 2026)).toEqual({ kind: 'ending', year: 2026 })
  expect(calibrationMark({ type: 'kaltwasser', calibratedUntil: 2027 }, 2026)).toEqual({ kind: 'ending', year: 2027 })
  expect(calibrationMark({ type: 'kaltwasser', calibratedUntil: 2028 }, 2026)).toBeNull()
  expect(calibrationMark({ type: 'kaltwasser', calibratedUntil: null }, 2026)).toBeNull()
  expect(calibrationMark({ type: 'kaltwasser' }, 2026)).toBeNull()
  // Heizkostenverteiler sind nicht eichpflichtig
  expect(calibrationMark({ type: 'hkv', calibratedUntil: 2020 }, 2026)).toBeNull()
})

test('Auswahl: fernablesbare Zähler und Heizkostenverteiler lassen sich ausblenden', () => {
  const meters = [
    meter('normal', { unitId: 'u1' }),
    meter('fern', { unitId: 'u1', remoteReadable: true }),
    meter('hkv', { unitId: 'u1', type: 'hkv', unit: '' }),
  ]
  const names = (options: SheetOptions) => build(meters, options).groups.flatMap((g) => g.rows.map((r) => r.name))
  expect(names(DEFAULT_SHEET_OPTIONS)).toEqual(['normal', 'fern', 'hkv'])
  expect(names({ ...DEFAULT_SHEET_OPTIONS, remote: false })).toEqual(['normal', 'hkv'])
  expect(names({ ...DEFAULT_SHEET_OPTIONS, hca: false })).toEqual(['normal', 'fern'])
  expect(names({ ...DEFAULT_SHEET_OPTIONS, remote: false, hca: false })).toEqual(['normal'])
})

test('Wohnung gewählt: nur deren Zähler, weder Hauptzähler noch Heizanlage; leere Gruppen entfallen', () => {
  const meters = [meter('haus'), meter('eg', { unitId: 'u1' }), meter('og', { unitId: 'u2' }), meter('heiz', { heatingPlantId: 'h1' })]
  const sheet = build(meters, { ...DEFAULT_SHEET_OPTIONS, unitId: 'u2' }, [], [plant])
  expect(sheet.groups.map((g) => g.title)).toEqual(['OG'])
  expect(sheet.groups[0]?.rows.map((r) => r.name)).toEqual(['og'])
  expect(sheet.count).toBe(1)
})

test('Wohnung gewählt und Auswahl gelten zusammen', () => {
  const meters = [meter('a', { unitId: 'u1' }), meter('b', { unitId: 'u1', remoteReadable: true })]
  const sheet = build(meters, { remote: false, hca: true, unitId: 'u1' })
  expect(sheet.groups.flatMap((g) => g.rows.map((r) => r.name))).toEqual(['a'])
})

test('die Zeile nennt Art, Einheit, Nummer und Kennzeichnung', () => {
  const m = meter('x', { name: 'Küche', meterNumber: '123', type: 'warmwasser', calibratedUntil: 2026 })
  expect(build([m]).groups[0]?.rows[0]).toMatchObject({ name: 'Küche', meterNumber: '123', typeLabel: 'Warmwasser', unit: 'm³', mark: { kind: 'ending', year: 2026 } })
})

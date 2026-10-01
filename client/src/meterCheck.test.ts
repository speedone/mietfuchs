// Die Ampel „Zählerstände“ im Cockpit (#136): Sie muss den Hauptzähler mitzählen, denn seit #116
// kann er die Verteilbasis des Verbrauchsschlüssels sein.
import { expect, test } from 'vitest'
import type { CostItem, Meter, Unit } from './types'
import { heatingWithoutConsumption, meterReadiness } from './meterCheck'

const meter = (id: string, unitId: string | null, type: Meter['type'] = 'kaltwasser'): Meter =>
  ({ id, propertyId: 'p', name: id, type, unitId, unit: 'm³' })
const ok = (meterId: string) => ({ meterId, readingCount: 2, warnings: [] })

test('Hauptzähler ohne Endstand: die Ampel nennt ihn', () => {
  const r = meterReadiness([meter('haupt', null), meter('zwischen', 'u1')], [ok('zwischen'), { meterId: 'haupt', readingCount: 1, warnings: [] }], new Set(['kaltwasser']))
  expect(r.incomplete.map((m) => m.id)).toEqual(['haupt'])
})

test('Hauptzähler und Zwischenzähler vollständig: beide gezählt', () => {
  const r = meterReadiness([meter('haupt', null), meter('zwischen', 'u1')], [ok('haupt'), ok('zwischen')], new Set(['kaltwasser']))
  expect(r.relevant.map((m) => m.id)).toEqual(['haupt', 'zwischen'])
  expect(r.incomplete).toEqual([])
})

test('Zähler eines anderen Typs zählen nicht', () => {
  const r = meterReadiness([meter('strom', null, 'strom')], [], new Set(['kaltwasser']))
  expect(r.relevant).toEqual([])
})

// #140: Heizung und Warmwasser ohne Verbrauchsschlüssel. Die Ampel darf dann nicht sagen, dass
// keine Ablesungen nötig sind; die Heizkostenverordnung verlangt eine Verteilung nach Verbrauch.
const kosten = (over: Partial<CostItem>): CostItem => ({
  id: 'h', propertyId: 'p', year: 2025, category: 'Heizung und Warmwasser', description: 'Heizöl', amountCents: 540000, key: 'area', ...over,
})
const wohnung = (id: string, over: Partial<Unit> = {}): Unit => ({ id, propertyId: 'p', name: id, areaM2: 80, participates: true, ...over })

test('Heizung nach Fläche: gemeldet, also nicht „Ablesungen nicht erforderlich“', () => {
  const units = [wohnung('a'), wohnung('b'), wohnung('c')]
  expect(heatingWithoutConsumption([kosten({})], units).map((c) => c.id)).toEqual(['h'])
})

test('Heizung nach Verbrauch, als Einzelbeträge, laut Gemeinschaft oder andere Kostenart: nicht gemeldet', () => {
  const units = [wohnung('a'), wohnung('b'), wohnung('c')]
  for (const over of [{ key: 'meter' as const }, { key: 'amounts' as const }, { key: 'external' as const }, { category: 'Grundsteuer' }]) {
    expect(heatingWithoutConsumption([kosten(over)], units)).toEqual([])
  }
})

test('Zweifamilienhaus mit selbst bewohnter Wohnung: Ausnahme des § 2 HeizkostenV', () => {
  const units = [wohnung('oben'), wohnung('unten', { participates: false, selfUsed: true })]
  expect(heatingWithoutConsumption([kosten({})], units)).toEqual([])
})

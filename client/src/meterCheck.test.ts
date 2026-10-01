// Die Ampel „Zählerstände“ im Cockpit (#136): Sie muss den Hauptzähler mitzählen, denn seit #116
// kann er die Verteilbasis des Verbrauchsschlüssels sein.
import { expect, test } from 'vitest'
import type { Meter, Notice } from './types'
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

// #140: Heizung und Warmwasser ohne Verbrauchsanteil. Die Ampel darf dann nicht sagen, dass keine
// Ablesungen nötig sind. Sie liest den Hinweis der Berechnung, damit beide dieselbe Regel anwenden
// (Mischfall, Teilnehmer, Direktzuordnung, § 2 HeizkostenV mit Garage, siehe shared/heating.ts).
const hinweis = (code: string, id = 'h'): Notice => ({ code, level: 'warning', title: '', text: '', subject: { kind: 'costItem', id } })

test('Kürzungshinweis der Berechnung: gemeldet, also nicht „Ablesungen nicht erforderlich“', () => {
  expect(heatingWithoutConsumption({ notices: [hinweis('heating.not-by-consumption'), hinweis('item.no-basis', 'x')] })).toEqual(['h'])
})

test('Ohne Kürzungshinweis nichts, auch nicht beim Hinweis zum Zweifamilienhaus oder zum Mischfall', () => {
  expect(heatingWithoutConsumption({ notices: [hinweis('heating.may-agree-otherwise'), hinweis('heating.consumption-share')] })).toEqual([])
  // Eine vor #112 abgeschlossene Abrechnung hat keine Hinweise.
  expect(heatingWithoutConsumption({})).toEqual([])
})

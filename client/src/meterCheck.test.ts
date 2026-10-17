// Die Ampel „Zählerstände“ im Cockpit (#136): Sie muss den Hauptzähler mitzählen, denn seit #116
// kann er die Verteilbasis des Verbrauchsschlüssels sein.
import { expect, test } from 'vitest'
import type { Meter, Notice } from './types'
import { calibrationDetail, heatingWithoutConsumption, meterReadiness, overdueMeters } from './meterCheck'

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

// Heizung PR 21 (#98, Prüfung des Plans M1): Die Eichfrist ist eine Warnung und keine Sperre. Die Ampel
// „Zählerstände“ bleibt davon unberührt; das Cockpit nennt sie in einer eigenen gelben Zeile.
const eichfrist = (meterId: string): Notice => ({ code: 'meter.calibration-overdue', level: 'warning', title: 'Eichfrist abgelaufen', text: `Zähler ${meterId}: abgelaufen`, subject: { kind: 'meter', id: meterId } })
const mitHinweisen = (meterId: string, notices: Notice[]) => ({ meterId, readingCount: 2, notices, warnings: notices.map((n) => n.text) })

test('Eichfrist abgelaufen: Zählerstände vollständig, der Zähler steht in der eigenen Liste', () => {
  const zaehler = [meter('k1', 'u1'), meter('k2', 'u2')]
  const verbrauch = [mitHinweisen('k1', [eichfrist('k1')]), ok('k2')]
  expect(meterReadiness(zaehler, verbrauch, new Set(['kaltwasser'])).incomplete).toEqual([])
  expect(overdueMeters(zaehler, verbrauch).map((m) => m.id)).toEqual(['k1'])
})

test('Eichfrist neben einem anderen Befund: unvollständig wegen des anderen', () => {
  const negativ: Notice = { code: 'meter.negative', level: 'warning', title: 'Negativer Verbrauch', text: 'negativ', subject: { kind: 'meter', id: 'k1' } }
  const verbrauch = [mitHinweisen('k1', [negativ, eichfrist('k1')])]
  expect(meterReadiness([meter('k1', 'u1')], verbrauch, new Set(['kaltwasser'])).incomplete.map((m) => m.id)).toEqual(['k1'])
})

test('Ohne Hinweise (älterer Server) zählen die Texte wie bisher', () => {
  expect(meterReadiness([meter('k1', 'u1')], [{ meterId: 'k1', readingCount: 2, warnings: ['x'] }], new Set(['kaltwasser'])).incomplete.map((m) => m.id)).toEqual(['k1'])
  expect(overdueMeters([meter('k1', 'u1')], [{ meterId: 'k1', readingCount: 2, warnings: ['x'] }])).toEqual([])
})

test('Cockpit-Zeile „Eichfrist“: nennt die Zähler, dass Mietfuchs rechnet, und die Beweislast', () => {
  const text = calibrationDetail([meter('Kaltwasser EG', 'u1'), meter('Wärme OG', 'u2', 'waerme')])
  expect(text).toMatch(/^Eichfrist abgelaufen bei: Kaltwasser EG und Wärme OG\./)
  expect(text).toMatch(/Mietfuchs rechnet mit den Werten/)
  expect(text).toMatch(/müssen Sie beweisen, dass sie stimmen/)
  expect(text).toMatch(/Stichprobenverfahren/)
})

// Die Kostenarten stehen an drei Stellen: in der Oberfläche (CATEGORIES, client/src/types.ts), im
// Schema der KI-Auswertung (extract.ts) und in der Zuordnung zur Anlage V (calc.ts). Liefen sie
// auseinander, schlüge die KI eine Kostenart vor, die die Oberfläche nicht kennt, oder eine
// Kostenart landete in der Steuerübersicht unter „Sonstige Werbungskosten“, ohne dass es jemand
// bemerkt. Dieser Test hält sie zusammen; aufgefallen ist die Lücke beim Hinzufügen von
// „Heizung und Warmwasser“ (#93).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CATEGORIES } from '../../client/src/types.ts'
import { ANLAGE_V_GROUP, HEATING_CATEGORY } from '../src/calc.ts'
import { EXTRACT_CATEGORIES } from '../src/extract.ts'

const sorted = (list: Iterable<string>) => [...list].sort()

test('die Kostenarten sind in Oberfläche, KI-Schema und Anlage V dieselben', () => {
  assert.deepEqual(sorted(EXTRACT_CATEGORIES), sorted(CATEGORIES), 'KI-Schema')
  assert.deepEqual(sorted(Object.keys(ANLAGE_V_GROUP)), sorted(CATEGORIES), 'Anlage V')
})

test('die Heizkostenart gibt es überall (#93)', () => {
  assert.ok(CATEGORIES.includes(HEATING_CATEGORY))
})

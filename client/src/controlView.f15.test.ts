// Die Kontrollansicht gegen eine echte Abrechnung (#321, Durchsicht S3): das Techem-Muster F15 mit Vorwegabzug.
// Die Abrechnung ist eingefroren (testing/f15Settlement.ts); dass sie der Berechnung entspricht, prüft
// server/test/controlview-f15.test.ts.
import { expect, test } from 'vitest'
import { controlView } from './controlView'
import { f15Settlement } from './testing/f15Settlement'

test('F15: die Position geht auf, der CO₂-Anteil des Vermieters steht als Grund, keine Differenz', () => {
  const view = controlView(f15Settlement)
  expect(view.items.map((i) => [i.id, i.totalCents, i.sumCents, i.differenceCents])).toEqual([['hz', 393301, 393301, 0]])
  expect(view.landlordColumns.map((c) => c.label)).toEqual(['CO₂-Anteil des Vermieters'])
  expect(view.extrasSumCents).toBe(0)
  expect(view.hasDifference).toBe(false)
})

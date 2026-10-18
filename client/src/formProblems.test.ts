// Alle Angaben auf einmal, je mit Feld (#346, Schritt 3, Durchsicht S1 und S4): Die Prüfungen der umgestellten
// Formulare nennen jede Angabe, die fehlt oder nicht passt, nicht nur die erste.
import { expect, test } from 'vitest'
import { costFieldProblems } from './costForm'
import { emptyMeterForm, meterBody } from './meterForm'
import { emptySelfSetup, selfSetupBody } from './heatingSelfForm'
import type { HeatingPlant } from './types'

const fields = (r: object) => ('problems' in r ? (r.problems as { field?: string }[]).map((p) => p.field) : [])

test('Kostenposition: ein Betrag, der keine Zahl ist, steht am Feld „Betrag“', () => {
  const base = { description: 'Wasser', amount: '100,00', labor35a: '', category: 'Wasser' }
  expect(costFieldProblems(base, null)).toEqual([])
  expect(costFieldProblems({ ...base, amount: 'abc' }, null)).toEqual([expect.objectContaining({ field: 'amount', short: 'Kein Betrag' })])
  expect(costFieldProblems({ ...base, amount: '0' }, null)).toEqual([expect.objectContaining({ field: 'amount', short: 'Betrag ist 0' })])
  // Der Lohnanteil über dem Betrag steht an seinem Feld.
  expect(costFieldProblems({ ...base, labor35a: '200' }, null)).toEqual([expect.objectContaining({ field: 'labor35a' })])
  // Alle auf einmal, und das Ziel mit seinem Satz
  expect(costFieldProblems({ ...base, description: ' ', amount: '' }, { text: 'Ziel: neu wählen.', short: 'Ziel neu wählen' }).map((p) => p.field))
    .toEqual(['description', 'amount', 'target'])
})

test('Zähler: Name und Eichjahr zugleich', () => {
  expect(fields(meterBody({ ...emptyMeterForm(), name: '', calibratedUntil: '22' }, null))).toEqual(['name', 'calibratedUntil'])
})

test('eigene Heizkostenabrechnung: Warmwasser, Wärmeschutz und Anteil zugleich', () => {
  const plant: Pick<HeatingPlant, 'id' | 'energy' | 'hotWater' | 'capture' | 'areaBasisHeat'> = { id: 'hp1', energy: 'gas', hotWater: 'combined', capture: null, areaBasisHeat: 'area' }
  const form = { ...emptySelfSetup(plant, '2025-01'), hotWater: '' as const, insulation: '' as const, share: '' }
  expect(fields(selfSetupBody(form, 'gas'))).toEqual(['hotWater', 'insulation', 'share', 'waterShare'])
})

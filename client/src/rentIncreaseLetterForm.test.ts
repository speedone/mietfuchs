// Eingaben des Schreibens einer Mieterhöhung im Seitenfenster (#191, PR 3): Texte zu Beträgen und Monaten, Meldungen am
// Feld mit denselben Sätzen wie der Server, Auswahllisten mit allen Werten, Hinweise zu altem Mietspiegel und
// Vergleichswohnungen, Antworten je Stand.
import { expect, test } from 'vitest'
import type { RentIncreasePlan } from './types'
import { qualifiedSurveyOptions, rentIncreaseDecisions, rentLetterInput, rentLetterStart, rentLetterWarnings, type RentLetterValue } from './rentIncreaseLetterForm'

const start = rentLetterStart({ tenantName: 'Erika Mustermann' })
const ready: RentLetterValue = {
  ...start, justification: 'survey', qualifiedSurvey: 'no', allLandlordsNamed: true, allTenantsNamed: true,
  survey: { name: 'Mietspiegel Musterstadt', asOf: '4.2023', field: 'Baujahr 1950 bis 1964', low: '8,50', high: '11', availableAt: 'www.musterstadt.de' },
}

test('Vorgaben: Empfänger ist der Mieter, die Frage zum qualifizierten Mietspiegel unbeantwortet und als Option vorhanden', () => {
  expect(start.recipientName).toBe('Erika Mustermann')
  expect(start.qualifiedSurvey).toBe('')
  expect(qualifiedSurveyOptions().map((o) => o.value)).toEqual(['', 'yes', 'no', 'unknown'])
  expect(start.comparables).toHaveLength(3)
})

test('Rumpf: Beträge in Cent, Monat als JJJJ-MM; Meldungen am Feld', () => {
  const ok = rentLetterInput(ready, 'comparison')
  if (!('body' in ok)) throw new Error(ok.problems.map((p) => p.text).join(' '))
  expect(ok.body.survey).toEqual({ name: 'Mietspiegel Musterstadt', asOf: '2023-04', field: 'Baujahr 1950 bis 1964', rangeLowCentsPerM2: 850, rangeHighCentsPerM2: 1100, availableAt: 'www.musterstadt.de' })
  const bad = rentLetterInput({ ...ready, qualifiedSurvey: '', survey: { ...ready.survey, low: 'acht' } }, 'comparison')
  expect('problems' in bad && bad.problems.map((p) => p.field)).toEqual(['survey.range', 'qualifiedSurvey'])
  const comparables = rentLetterInput({ ...ready, justification: 'comparables', comparables: start.comparables.map(() => ({ address: 'Ahornweg 3', location: '', area: '58', perM2: '10,20' })) }, 'comparison')
  expect('problems' in comparables && comparables.problems.map((p) => p.field)).toEqual(['comparables.0.location', 'comparables.1.location', 'comparables.2.location'])
})

test('Hinweise: alter Mietspiegel, Miete über der niedrigsten Vergleichswohnung', () => {
  const ok = rentLetterInput(ready, 'comparison')
  if (!('body' in ok)) throw new Error('Rumpf erwartet')
  expect(rentLetterWarnings(ok.body, null, '2026-11-20').join(' ')).toMatch(/Stand April 2023.*nur verwendet werden, wenn es keinen neueren gibt/)
  const plan: RentIncreasePlan = { ...PLAN_BASE, newCents: 61200, comparison: { centsPerM2: 1020, areaM2: 60, rentCents: 61200, operatingCostsCents: null, limitCents: 61200 } }
  const letter = { ...ok.body, justification: 'comparables' as const, survey: null, comparables: [1020, 1010, 1050].map((c) => ({ address: 'A', location: 'EG', areaM2: 60, centsPerM2: c })) }
  expect(rentLetterWarnings(letter, plan, '2026-11-20').join(' ')).toMatch(/über der niedrigsten Miete der Vergleichswohnungen \(10,10\s€ je m²\)/)
  expect(rentLetterWarnings(letter, { ...plan, newCents: 60600 }, '2026-11-20')).toEqual([])
})

test('Antworten je Stand: Index nur zurücknehmen, nach Ablehnung noch zustimmen, Entwurf keine', () => {
  expect(rentIncreaseDecisions({ kind: 'comparison', status: 'draft' })).toEqual([])
  expect(rentIncreaseDecisions({ kind: 'comparison', status: 'sent' })).toEqual(['agreed', 'partial', 'refused', 'withdrawn'])
  expect(rentIncreaseDecisions({ kind: 'comparison', status: 'refused' })).toEqual(['agreed', 'partial', 'withdrawn'])
  expect(rentIncreaseDecisions({ kind: 'comparison', status: 'agreed' })).toEqual(['withdrawn'])
  expect(rentIncreaseDecisions({ kind: 'index', status: 'sent' })).toEqual(['withdrawn'])
  expect(rentIncreaseDecisions({ kind: 'index', status: 'withdrawn' })).toEqual([])
})

const PLAN_BASE: RentIncreasePlan = {
  kind: 'comparison', state: 'possible', reasons: [], refusals: [], warnings: [], needs: [], currentCents: 50000, currentSince: null, receivedOn: '2026-11-20', today: '2026-11-20', capBaseDay: null,
  earliestReceivedOn: null, effectiveFrom: '2027-02', earliestEffectiveFrom: null, consent: null, cap: null, comparison: null, index: null, maxCents: null,
  newCents: null, steps: [], staggered: null, legalValues: [],
}

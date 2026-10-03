// Die Prüfung einer Kostenposition in shared/ (Belegbuchung, #170). Formular und Server benutzen
// dieselbe Funktion; das Formular reicht Cent herein und formuliert selbst nichts mehr. Dass das
// Formular sich dabei nicht ändert, halten client/src/costForm.test.ts und costForm.memory.test.ts
// fest; hier steht die Schnittstelle in Cent.
import test from 'node:test'
import assert from 'node:assert/strict'
import { amountProblem, costItemBody, euro, type CostItemDraft } from '../../shared/costItem.ts'
import { defaultKeyFor, isNotAllocable, matchCategory } from '../../shared/categories.ts'
import { aiPositionDefaults, aiRowPreselected, scorePosition } from '../../shared/assessment.ts'
import type { Unit } from '../../shared/types.ts'

const UNITS: Unit[] = [
  { id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true },
  { id: 'u2', propertyId: 'objekt-1', name: 'OG', areaM2: 40, participates: true },
]
const draft = (patch: Partial<CostItemDraft> = {}): CostItemDraft => ({
  category: 'Grundsteuer', description: 'Grundsteuer 2025', vendor: '', invoiceFile: null,
  amountCents: 61240, labor35aCents: 0, key: 'area', directUnitId: null, meterType: null,
  customShares: {}, participants: null, external: { measure: 'mea', total: null, totalCents: null },
  tenancyAmounts: {}, selfAmounts: {}, ...patch,
})
const errorOf = (built: ReturnType<typeof costItemBody>): string => ('error' in built ? built.error : assert.fail('kein Fehler'))

test('Rumpf einer Kostenposition: dieselben Felder wie bisher im Formular', () => {
  const built = costItemBody(draft(), UNITS, 2025)
  if (!('body' in built)) return assert.fail(built.error)
  assert.deepEqual(built.body, {
    year: 2025, category: 'Grundsteuer', description: 'Grundsteuer 2025', vendor: undefined, amountCents: 61240,
    labor35aCents: undefined, key: 'area', directUnitId: null, meterType: null, customShares: null,
    participantUnitIds: null, externalBasis: null, tenancyAmounts: null, selfAmounts: null, invoiceFile: null,
  })
})

test('Betrag und Lohnanteil: Gutschrift ja, 0 € nein, unlesbar nein', () => {
  assert.equal(amountProblem(-5000, 0), null)
  assert.match(amountProblem(0, 0) ?? '', /0 €/)
  assert.match(amountProblem(null, 0) ?? '', /Euro-Betrag/)
  assert.match(amountProblem(-5000, 100) ?? '', /Gutschrift/)
  assert.match(amountProblem(10000, null) ?? '', /§35a-Lohnanteil muss/)
  assert.match(amountProblem(10000, 20000) ?? '', /§35a-Lohnanteil muss/)
  assert.match(amountProblem(10000, 100, 'Zuführung Erhaltungsrücklage') ?? '', /Erhaltungsrücklage/)
  const credit = costItemBody(draft({ amountCents: -5000 }), UNITS, 2025)
  assert.ok('body' in credit && credit.body.amountCents === -5000)
})

test('Verteilung: Anteile, Teilnehmer, Gemeinschaft und Einzelbeträge in Cent geprüft', () => {
  assert.match(errorOf(costItemBody(draft({ key: 'custom', customShares: { u1: null } }), UNITS, 2025)), /Anteil für „EG"/)
  assert.match(errorOf(costItemBody(draft({ key: 'custom', customShares: { u1: 60, u2: 50 } }), UNITS, 2025)), /mehr als 100 %/)
  assert.match(errorOf(costItemBody(draft({ participants: [] }), UNITS, 2025)), /mindestens eine teilnehmende/)
  const alle = costItemBody(draft({ participants: ['u1', 'u2'] }), UNITS, 2025)
  assert.ok('body' in alle && alle.body.participantUnitIds === null, 'alle angehakt heißt alle')
  const eine = costItemBody(draft({ participants: ['u1'] }), UNITS, 2025)
  assert.ok('body' in eine && JSON.stringify(eine.body.participantUnitIds) === '["u1"]')
  assert.match(errorOf(costItemBody(draft({ key: 'external' }), UNITS, 2025)), /Gemeinschaftsabrechnung/)
  assert.match(errorOf(costItemBody(draft({ key: 'amounts', tenancyAmounts: { t1: 70000 } }), UNITS, 2025)), /mehr als der Rechnungsbetrag/)
  assert.match(errorOf(costItemBody(draft({ key: 'amounts', amountCents: -100 }), UNITS, 2025)), /Gutschrift/)
  assert.match(errorOf(costItemBody(draft({ key: 'direct' }), UNITS, 2025)), /Wohnung wählen/)
  assert.match(errorOf(costItemBody(draft({ key: 'meter' }), UNITS, 2025)), /Zählertyp/)
  assert.match(errorOf(costItemBody(draft({ description: '  ' }), UNITS, 2025)), /Beschreibung/)
})

test('Nicht umlagefähig: gespeichert wird die neutrale Vorgabe, eine stehengebliebene Zuordnung fällt weg', () => {
  const built = costItemBody(draft({ category: 'Nicht umlagefähig', key: 'direct', directUnitId: null }), UNITS, 2025)
  assert.ok('body' in built)
  assert.equal(built.body.key, 'area')
  assert.equal(built.body.directUnitId, null)
})

test('Kostenarten und Ampel stehen in shared/ und sagen dasselbe wie bisher', () => {
  assert.equal(matchCategory('Frischwasser'), 'Wasser/Abwasser')
  assert.equal(matchCategory('Heizungsreparatur'), 'Nicht umlagefähig')
  assert.equal(isNotAllocable('Zuführung Erhaltungsrücklage'), true)
  assert.equal(defaultKeyFor('Müllabfuhr'), 'persons')
  assert.equal(euro(61240), '612,40\u00a0€')
  const credit = scorePosition({ category: 'Müllabfuhr', amountCents: -5000, labor35aCents: 0, matchedByDesc: false, vendor: 'Stadt', detectedYear: 2025, targetYear: 2025, existingItems: [] })
  assert.equal(credit.level, 'gelb')
  assert.deepEqual(aiPositionDefaults('Müllabfuhr', UNITS, []), { key: 'persons', allocation: null })
  assert.equal(aiRowPreselected({ category: 'Grundsteuer', preselect: true, problem: null, level: 'gruen', candidates: [] }), true)
  const row = { category: 'Grundsteuer', preselect: true, problem: null, level: 'gruen' as const, candidates: [] }
  assert.equal(aiRowPreselected({ ...row, level: 'rot' }), false)
  assert.equal(aiRowPreselected({ ...row, category: 'Nicht umlagefähig' }), false)
  assert.equal(aiRowPreselected({ ...row, preselect: false }), false)
  assert.equal(aiRowPreselected({ ...row, problem: 'Betrag fehlt' }), false)
  assert.equal(aiRowPreselected({ ...row, candidates: [{}] }), false)
})

// Eingaben des Schreibens einer Mieterhöhung (#191, PR 3, shared/rentIncreaseLetter.ts): Pflichtfrage zum qualifizierten
// Mietspiegel (M6), auffindbare Vergleichswohnungen (M7), alle Vermieter und Mieter (S4), Alter des Mietspiegels (S5).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rentIncreaseBasisProblem, rentIncreaseLetterOf, rentSenderProblem, surveyStale } from '../../shared/rentIncreaseLetter.ts'
import type { RentIncreaseLetterInput } from '../../shared/types.ts'

const SURVEY = { name: 'Mietspiegel Musterstadt 2025', asOf: '2025-04', field: 'Baujahr 1950 bis 1964', rangeLowCentsPerM2: 850, rangeHighCentsPerM2: 1100, availableAt: 'www.musterstadt.de' }
const BASE = { recipientName: 'Anna Becker', allLandlordsNamed: true, allTenantsNamed: true, extraParagraph: '' }
const ok = (x: ReturnType<typeof rentIncreaseLetterOf>): RentIncreaseLetterInput => ('letter' in x ? x.letter : assert.fail(x.problems.map((p) => p.text).join(' ')))
const fields = (x: ReturnType<typeof rentIncreaseLetterOf>): string[] => ('problems' in x ? x.problems.map((p) => p.field) : [])

test('Schreiben: Mietspiegel als Begründung, fremde Felder geleert', () => {
  const letter = ok(rentIncreaseLetterOf({ ...BASE, justification: 'survey', survey: SURVEY, qualifiedSurvey: 'no', expert: { name: 'X', date: '2026-01-01' }, comparables: [{}] }, 'comparison'))
  assert.deepEqual(letter.survey, SURVEY)
  assert.equal(letter.expert, null)
  assert.deepEqual(letter.comparables, [])
  assert.equal(letter.qualified, null)
})

test('Schreiben: qualifizierter Mietspiegel ist Pflichtfrage, „weiß nicht“ sperrt, bei „ja“ mit Angaben auch bei Gutachten', () => {
  assert.deepEqual(fields(rentIncreaseLetterOf({ ...BASE, justification: 'expert', expert: { name: 'Dipl.-Ing. Muster', date: '2026-10-01' } }, 'comparison')), ['qualifiedSurvey'])
  assert.deepEqual(fields(rentIncreaseLetterOf({ ...BASE, justification: 'expert', expert: { name: 'Dipl.-Ing. Muster', date: '2026-10-01' }, qualifiedSurvey: 'unknown' }, 'comparison')), ['qualifiedSurvey'])
  assert.deepEqual(fields(rentIncreaseLetterOf({ ...BASE, justification: 'expert', expert: { name: 'Dipl.-Ing. Muster', date: '2026-10-01' }, qualifiedSurvey: 'yes' }, 'comparison')), ['qualified.name', 'qualified.asOf', 'qualified.field'])
  const letter = ok(rentIncreaseLetterOf({ ...BASE, justification: 'expert', expert: { name: 'Dipl.-Ing. Muster', date: '2026-10-01' }, qualifiedSurvey: 'yes', qualified: SURVEY }, 'comparison'))
  assert.deepEqual(letter.qualified, SURVEY)
})

test('Schreiben: Vergleichswohnungen genau drei, je mit Anschrift, Lage, Fläche und Miete je m²', () => {
  const one = { address: 'Ahornweg 3', location: '1. OG links', areaM2: 58, centsPerM2: 1020 }
  assert.deepEqual(fields(rentIncreaseLetterOf({ ...BASE, justification: 'comparables', qualifiedSurvey: 'no', comparables: [one, one] }, 'comparison')), ['comparables'])
  assert.deepEqual(fields(rentIncreaseLetterOf({ ...BASE, justification: 'comparables', qualifiedSurvey: 'no', comparables: [one, { ...one, location: ' ', areaM2: 0 }, one] }, 'comparison')), ['comparables.1.location', 'comparables.1.areaM2'])
})

test('Schreiben: Spanne nur ganz oder gar nicht, Unterwert nicht über Oberwert', () => {
  assert.deepEqual(fields(rentIncreaseLetterOf({ ...BASE, justification: 'survey', qualifiedSurvey: 'no', survey: { ...SURVEY, rangeHighCentsPerM2: null } }, 'comparison')), ['survey.range'])
  assert.deepEqual(fields(rentIncreaseLetterOf({ ...BASE, justification: 'survey', qualifiedSurvey: 'no', survey: { ...SURVEY, rangeLowCentsPerM2: 1200 } }, 'comparison')), ['survey.range'])
})

test('Schreiben: alle Vermieter und Mieter bestätigt, Empfänger genannt; bei der Indexmiete nur das', () => {
  assert.deepEqual(fields(rentIncreaseLetterOf({ recipientName: ' ', allLandlordsNamed: false, allTenantsNamed: false }, 'index')), ['recipientName', 'allLandlordsNamed', 'allTenantsNamed'])
  const letter = ok(rentIncreaseLetterOf({ ...BASE, justification: 'survey', survey: SURVEY, qualifiedSurvey: 'yes' }, 'index'))
  assert.equal(letter.justification, null)
  assert.equal(letter.survey, null)
  assert.equal(letter.qualifiedSurvey, null)
})

test('Schreiben: ein Mietspiegel gilt nach zwei Jahren als alt (§ 558d Abs. 2 Satz 1 BGB, nur Warnung)', () => {
  assert.equal(surveyStale('2024-11', '2026-11-20'), false)
  assert.equal(surveyStale('2024-10', '2026-11-20'), true)
  assert.equal(surveyStale('', '2026-11-20'), false)
})

test('Schreiben: mehrere Vermieter nur mit ausdrücklicher Angabe, eingefroren mit den Eingaben (Durchsicht S3)', () => {
  assert.equal(ok(rentIncreaseLetterOf({ ...BASE, severalLandlords: true }, 'index')).severalLandlords, true)
  assert.equal(ok(rentIncreaseLetterOf({ ...BASE, severalLandlords: false }, 'index')).severalLandlords, false)
  assert.equal(ok(rentIncreaseLetterOf(BASE, 'index')).severalLandlords, false, 'ohne Angabe ein Vermieter')
})

test('Grundlage: Fassung und Grundgestalt geprüft, sonst ein ganzer Satz statt eines Absturzes (Durchsicht K1)', () => {
  for (const x of [null, 'text', {}, { version: 2 }, { version: 1 }, { version: 1, plan: {}, letter: {}, sender: {}, recipient: [], premises: {}, prepayments: {} }]) {
    assert.match(rentIncreaseBasisProblem(x) ?? '', /^Dieses Schreiben stammt aus einer anderen Fassung von Mietfuchs.*\.$/, JSON.stringify(x))
  }
})

test('Schreiben: ohne Namen des Vermieters kein Schreiben (§ 126b BGB), außer das Briefpapier trägt den Absender', () => {
  assert.equal(rentSenderProblem('Max Vermieter', false), null)
  assert.equal(rentSenderProblem('', true), null)
  const p = rentSenderProblem('  ', false)
  assert.equal(p?.field, 'allLandlordsNamed')
  assert.match(p?.text ?? '', /§ 558a Abs\. 1/)
  assert.match(p?.text ?? '', /§ 557b Abs\. 3/)
  assert.match(p?.text ?? '', /§ 126b BGB/)
})

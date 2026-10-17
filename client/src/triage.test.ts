import { expect, test } from 'vitest'
// Die Ampel und die Doppelungsregel stehen in shared/ (Server und Browser benutzen sie, #170).
import { calendarContext, calendarPeriod } from '../../shared/period.ts'
import { aiRowPreselected, categoryDeviationPct, scorePosition, type PositionCtx } from '../../shared/assessment.ts'
import { sameCostCandidates } from '../../shared/duplicates.ts'
import type { CostItem } from './types'

const ctx = (patch: Partial<PositionCtx>): PositionCtx => ({
  category: 'Sach- und Haftpflichtversicherung', amountCents: 10000, labor35aCents: 0, matchedByDesc: false,
  vendor: 'Versicherung AG', detectedYear: 2025, targetYear: 2025, existingItems: [], ...patch,
})

test('Gutschrift (#139): ein negativer Betrag ist kein fehlender, wird aber zum Prüfen als Gutschrift benannt', () => {
  const s = scorePosition(ctx({ amountCents: -5400 }))
  expect(s.reasons).not.toContain('Betrag fehlt oder ist 0')
  expect(s.reasons.some((r) => /Gutschrift/.test(r))).toBe(true)
  expect(s.level).toBe('gelb')
  // Kein Lohnanteil heißt nicht „Lohnanteil größer als der Betrag“
  expect(s.reasons.some((r) => /§35a/.test(r))).toBe(false)
})

test('Betrag 0 bleibt rot', () => {
  expect(scorePosition(ctx({ amountCents: 0 })).level).toBe('rot')
})

// ---------- Zusammenspiel mit „Aus dem Vorjahr übernehmen“ (Befund A) ----------
// Erst übernommen (Schätzbetrag, ohne Beleg), dann kommt die echte Rechnung per KI: Es entstand
// still eine zweite Position derselben Kostenart. Die Regel steht in shared/duplicates.ts.

const schaetzung: CostItem = { id: 'gs', propertyId: 'p', period: calendarPeriod(2026), category: 'Grundsteuer', description: 'Grundsteuer 2026', vendor: 'Stadt', amountCents: 61000, key: 'area' }

test('A: eine KI-Zeile derselben Kostenart findet die übernommene Position, auch mit anderer Beschreibung', () => {
  const found = sameCostCandidates([schaetzung], { category: 'Grundsteuer', description: 'Abgabenbescheid Q1–Q4', vendor: 'Stadt Musterstadt', period: calendarPeriod(2026) })
  expect(found.map((i) => i.id)).toEqual(['gs'])
  // anderes Jahr: nichts
  expect(sameCostCandidates([schaetzung], { category: 'Grundsteuer', description: 'x', vendor: '', period: calendarPeriod(2025) })).toEqual([])
})

test('A: mit Kandidaten ist die Ampel nicht grün und nennt die Position', () => {
  const s = scorePosition(ctx({ category: 'Grundsteuer', description: 'Abgabenbescheid', vendor: 'Stadt Musterstadt', amountCents: 61240, detectedYear: 2026, targetYear: 2026, existingItems: [schaetzung] }))
  expect(s.level).not.toBe('gruen')
  expect(s.reasons.some((r) => /schon erfasst: „Grundsteuer 2026“/.test(r))).toBe(true)
})

test('A: vorab angehakt nur ohne Kandidaten und ohne Rot', () => {
  expect(aiRowPreselected({ category: 'Grundsteuer', preselect: true, problem: null, level: 'gruen', candidates: [] })).toBe(true)
  expect(aiRowPreselected({ category: 'Grundsteuer', preselect: true, problem: null, level: 'gelb', candidates: [schaetzung] })).toBe(false)
  expect(aiRowPreselected({ category: 'Grundsteuer', preselect: true, problem: null, level: 'rot', candidates: [] })).toBe(false)
  expect(aiRowPreselected({ category: 'Grundsteuer', preselect: true, problem: 'Betrag fehlt', level: 'gelb', candidates: [] })).toBe(false)
  expect(aiRowPreselected({ category: 'Nicht umlagefähig', preselect: true, problem: null, level: 'gelb', candidates: [] })).toBe(false)
})

test('A im Januar: Vorjahresvergleich nach dem Jahr des Belegs, nicht nach dem gewählten', () => {
  const items: CostItem[] = [
    { ...schaetzung, id: 'a', period: calendarPeriod(2025), amountCents: 60000 },
    { ...schaetzung, id: 'b', period: calendarPeriod(2024), amountCents: 30000 },
  ]
  // Beleg für 2026, gewählt ist noch 2025: verglichen wird 2026 (nichts erfasst) mit 2025
  expect(categoryDeviationPct(items, 'Grundsteuer', calendarContext(2026), 61200)).toBeCloseTo(2)
  // Das gewählte Jahr hätte 2025 (schon 600 €) + 612 € gegen 2024 verglichen: +304 %
  expect(categoryDeviationPct(items, 'Grundsteuer', calendarContext(2025), 61200)).toBeCloseTo(304)
  expect(categoryDeviationPct([], 'Grundsteuer', calendarContext(2026), 61200)).toBeNull()
})

// ---------- Verknüpfen je Gruppe (zweite Durchsicht) ----------

// Befund gegen 0.10.0-rc.1: Eine Gutschrift ist nie dieselbe Rechnung wie eine Rechnung derselben
// Kostenart. Die Ampel nannte die Rechnung als „schon erfasst“ und riet, die Gutschrift nicht
// anzulegen; befolgt fehlte sie in der Abrechnung, und die Mieter zahlten sie mit.
test('Gutschrift neben einer Rechnung derselben Kostenart: nicht „schon erfasst“ (rc.1)', () => {
  const s = scorePosition(ctx({ category: 'Grundsteuer', description: 'Erstattung', vendor: 'Stadt', amountCents: -5745, detectedYear: 2026, targetYear: 2026, existingItems: [schaetzung] }))
  expect(s.reasons.some((r) => /schon erfasst/.test(r))).toBe(false)
  // Eine zweite Gutschrift derselben Art bleibt eine Rückfrage wert.
  const gutschrift: CostItem = { ...schaetzung, id: 'g', amountCents: -5745 }
  const t = scorePosition(ctx({ category: 'Grundsteuer', description: 'Erstattung', vendor: 'Stadt', amountCents: -5745, detectedYear: 2026, targetYear: 2026, existingItems: [schaetzung, gutschrift] }))
  expect(t.reasons.some((r) => /schon erfasst/.test(r) && /dieselbe Gutschrift/.test(r))).toBe(true)
})

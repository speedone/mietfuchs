// Das Zahlungsdatum im Kostenformular (#255 PR 3): was gespeichert wird, wann das Formular nachfragt (R-2, R-4) und
// wann der Hinweis zur Zehn-Tage-Regel kommt (R-8).
import { describe, expect, test } from 'vitest'
import { buildCostItemBody, EMPTY_ITEM_FORM, itemToForm, paidOnChange, paidOnTenDayHint, showsPaidOn, deductionTaxYear } from './costForm'
import { calendarYearPeriod, periodKey } from '../../shared/period.ts'
import { splitPaidOnQuestions, taxYearQuestions } from '../../shared/paidOn.ts'
import type { CostItem, Unit } from './types'

const UNITS: Unit[] = [{ id: 'a', propertyId: 'p', name: 'A', areaM2: 80, participates: true }]
const form = { ...EMPTY_ITEM_FORM, category: 'Sach- und Haftpflichtversicherung', description: 'Versicherung', amount: '600,00', key: 'area' as const }
const span = { startYear: 2026, endYear: 2026 }

describe('Bezahlt am (für die Steuer)', () => {
  test('das Datum geht in den Rumpf, leer als null; ein gespeichertes kommt ins Formular', () => {
    const mit = buildCostItemBody({ ...form, paidOn: '2027-02-10' }, UNITS, calendarYearPeriod(2026))
    if ('error' in mit) return expect.unreachable(mit.error)
    expect(mit.body.paidOn).toBe('2027-02-10')
    const ohne = buildCostItemBody(form, UNITS, 2026)
    if ('error' in ohne) return expect.unreachable(ohne.error)
    expect(ohne.body.paidOn).toBeNull()
    expect(itemToForm({ id: 'x', propertyId: 'p', period: periodKey('2026-01'), category: 'Grundsteuer', description: 'G', amountCents: 1, key: 'area', paidOn: '2026-05-15' }).paidOn).toBe('2026-05-15')
  })
  test('kein Datum bei Hausgeld laut Gemeinschaftsabrechnung, am Abzug für Betriebsstrom und an der Rücklage (R-6)', () => {
    expect(showsPaidOn({ ...form, key: 'external' })).toBe(false)
    expect(showsPaidOn({ ...form, operatingPower: 'deduction' })).toBe(false)
    expect(showsPaidOn({ ...form, category: 'Zuführung Erhaltungsrücklage' })).toBe(false)
    expect(showsPaidOn(form)).toBe(true)
    // Durchsicht K1: Bei „Nicht umlagefähig“ speichert costItemBody einen neutralen Schlüssel, ein stehengebliebenes
    // `external` im Formular verbirgt das Feld deshalb nicht (eine Regel mit shared/costItem.ts).
    expect(showsPaidOn({ ...form, key: 'external', category: 'Nicht umlagefähig' })).toBe(true)
    const na = buildCostItemBody({ ...form, key: 'external', category: 'Nicht umlagefähig', paidOn: '2026-05-01' }, UNITS, 2026)
    if ('error' in na) return expect.unreachable(na.error)
    expect(na.body.paidOn).toBe('2026-05-01')
    const ext = buildCostItemBody({ ...form, key: 'external', externalTotal: '1000', externalTotalAmount: '6000,00', paidOn: '2026-05-01' }, UNITS, 2026)
    if ('error' in ext) return expect.unreachable(ext.error)
    expect(ext.body.paidOn).toBeNull()
  })
  test('ein unlesbares Datum wird abgelehnt', () => {
    expect(buildCostItemBody({ ...form, paidOn: '2026-02-30' }, UNITS, 2026)).toEqual({ error: 'Das Zahlungsdatum von „Versicherung“ ist kein gültiges Datum.' })
  })
  test('Rückfrage, wenn sich das Steuerjahr ändert (R-2); keine im selben Jahr und ohne Änderung', () => {
    const neu = { paidOn: '2027-02-10', taxYear: null, period: '2026-01' }
    expect(paidOnChange(null, neu, span)[0]).toBe('Mit dem Datum 10.02.2027 zählt die Position für die Steuer zu 2027 statt zu 2026.')
    expect(paidOnChange(null, { ...neu, paidOn: '2026-11-30' }, span)).toEqual([])
    const gespeichert: Pick<CostItem, 'paidOn' | 'taxYear' | 'period'> = { paidOn: '2027-02-10', period: periodKey('2026-01') }
    expect(paidOnChange(gespeichert, neu, span)).toEqual([])
    expect(paidOnChange(gespeichert, { ...neu, paidOn: null }, span)[0]).toBe('Ohne Zahlungsdatum zählt die Position für die Steuer wieder zu 2026 statt zu 2027.')
    // Gegen ein gesetztes Jahr der Zahlung.
    expect(paidOnChange({ taxYear: 2026, period: periodKey('2026-05') }, { paidOn: '2027-01-12', taxYear: 2026, period: '2026-05' }, { startYear: 2026, endYear: 2027 })[0])
      .toBe('Als Jahr der Zahlung ist 2026 angegeben; mit dem Datum 12.01.2027 zählt die Position für die Steuer zu 2027.')
  })
  // Durchsicht M1: Beim Aufteilen zählt jeder Teil mit seinem eigenen Zeitraum, nicht der des Formulars. Dieselbe Regel
  // fragt der Server in `saveCostItemSplit`.
  test('Aufteilen: gefragt wird je Teil, auch wenn das Datum im Jahr des Formulars liegt', () => {
    const parts = [
      { period: '2025-01', needsTaxYear: false, startYear: 2025, endYear: 2025 },
      { period: '2026-01', needsTaxYear: false, startYear: 2026, endYear: 2026 },
    ]
    const neu = { paidOn: '2025-07-01', taxYear: null, period: '2025-01' }
    expect(paidOnChange(null, neu, { startYear: 2025, endYear: 2025 })).toEqual([])
    const q = splitPaidOnQuestions(null, neu, parts)
    expect(q[0]).toBe('Mit dem Datum 01.07.2025 zählt die Position für die Steuer zu 2025 statt zu 2026.')
    expect(q.filter((x) => x.startsWith('Haben Sie'))).toHaveLength(1)
    // Unverändertes Datum an einer gespeicherten Position: nichts zu bestätigen.
    expect(splitPaidOnQuestions({ paidOn: '2025-07-01', period: periodKey('2025-01') }, neu, parts)).toEqual([])
    // Ein Teil über zwei Kalenderjahre trägt das Jahr der Zahlung des Rumpfes, einer in einem Kalenderjahr keines.
    expect(splitPaidOnQuestions(null, { paidOn: '2026-03-01', taxYear: 2025, period: '2025-01' }, [
      { period: '2025-01', needsTaxYear: false, startYear: 2025, endYear: 2025 },
      { period: '2025-05', needsTaxYear: true, startYear: 2025, endYear: 2026 },
    ]).some((x) => x.startsWith('Als Jahr der Zahlung ist 2025 angegeben'))).toBe(true)
  })
  test('außerhalb der Spanne Beginn − 1 bis Ende + 3 eine Rückfrage statt einer Ablehnung (R-4)', () => {
    expect(paidOnChange(null, { paidOn: '2030-01-15', taxYear: null, period: '2026-01' }, span).some((q) => q.includes('außerhalb der üblichen Spanne von 2025 bis 2029'))).toBe(true)
    expect(paidOnChange(null, { paidOn: '2029-12-31', taxYear: null, period: '2026-01' }, span).some((q) => q.includes('außerhalb'))).toBe(false)
  })
  test('Zehn-Tage-Regel: Hinweis zwischen 22.12. und 10.01., nie bei der Grundsteuer (R-8)', () => {
    expect(paidOnTenDayHint({ paidOn: '2025-12-22', category: 'Sach- und Haftpflichtversicherung' })).toBe(true)
    expect(paidOnTenDayHint({ paidOn: '2026-01-10', category: 'Müllabfuhr' })).toBe(true)
    expect(paidOnTenDayHint({ paidOn: '2025-12-21', category: 'Müllabfuhr' })).toBe(false)
    expect(paidOnTenDayHint({ paidOn: '2026-01-11', category: 'Müllabfuhr' })).toBe(false)
    expect(paidOnTenDayHint({ paidOn: '2025-12-28', category: 'Grundsteuer' })).toBe(false)
    expect(paidOnTenDayHint({ paidOn: '', category: 'Müllabfuhr' })).toBe(false)
  })
  test('der Abzug für Betriebsstrom nennt das Jahr seiner Stromrechnung, auch aus ihrem Datum (#267)', () => {
    const bill: CostItem = { id: 'hs', propertyId: 'p', period: periodKey('2026-01'), category: 'Beleuchtung/Allgemeinstrom', description: 'Hausstrom', amountCents: 100000, key: 'units', paidOn: '2027-01-20' }
    expect(deductionTaxYear({ operatingPower: 'deduction', operatingPowerGeneralId: 'hs' }, [bill])).toBe(2027)
  })
})

// #478 (E2): Das Jahr der Zahlung hat dieselbe übliche Spanne wie das Datum; außerhalb fragt Mietfuchs nach, und nur,
// wenn sich das Jahr ändert. Dieselben Sätze im Formular und am Server (409 `question: 'taxYear'`).
describe('Jahr der Zahlung außerhalb der üblichen Spanne', () => {
  const kalender = { startYear: 2025, endYear: 2025 }
  test('in der Spanne keine Frage, auch nicht im Kalenderzeitraum mit anderem Jahr', () => {
    expect(taxYearQuestions(null, { period: '2025-01', taxYear: 2026 }, kalender)).toEqual([])
    expect(taxYearQuestions(null, { period: '2025-01', taxYear: 2024 }, kalender)).toEqual([])
    expect(taxYearQuestions(null, { period: '2025-01', taxYear: 2028 }, kalender)).toEqual([])
    expect(taxYearQuestions(null, { period: '2025-01', taxYear: null }, kalender)).toEqual([])
  })
  test('außerhalb ein Satz mit der Spanne und dem Rat zur abgegebenen Erklärung', () => {
    expect(taxYearQuestions(null, { period: '2025-01', taxYear: 2029 }, kalender)).toEqual([
      'Als Jahr der Zahlung ist 2029 angegeben; das liegt außerhalb der üblichen Spanne von 2024 bis 2028 für diesen Abrechnungszeitraum. Bitte prüfen Sie das Jahr.',
      'Haben Sie die Steuererklärung eines betroffenen Jahres schon abgegeben, besprechen Sie die Änderung mit Ihrem Steuerberater oder Finanzamt.',
    ])
    expect(taxYearQuestions(null, { period: '2025-05', taxYear: 2023 }, { startYear: 2025, endYear: 2026 })[0]).toMatch(/von 2024 bis 2029/)
  })
  test('gefragt wird nur, wenn sich das Jahr ändert', () => {
    const gespeichert = { period: '2025-01', taxYear: 2030 }
    expect(taxYearQuestions(gespeichert, { period: '2025-01', taxYear: 2030 }, kalender)).toEqual([])
    expect(taxYearQuestions(gespeichert, { period: '2025-01', taxYear: 2031 }, kalender)).toHaveLength(2)
  })
})

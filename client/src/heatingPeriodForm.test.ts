import { describe, expect, test } from 'vitest'
import {
  heatingPeriodAnswersOf, heatingPeriodForm, heatingPeriodSummary, heatingRulesBody, initialHeatingPeriodAnswers, initialSeparateAnswers,
  heatingWays, separateAnswersOf, suggestedWay,
} from './heatingPeriodForm'
import { CALENDAR_RULES, periodKey as k } from '../../shared/period.ts'
import type { HeatingPeriodChangePreview, HeatingPlant, SeparatePreview } from './types'

const plant = (over: Partial<HeatingPlant> = {}): HeatingPlant => ({
  id: 'hp1', propertyId: 'objekt-1', name: '', energy: 'gas', supply: 'central', method: 'service', separateSettlement: null,
  devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', source: 'building', captureInstalledOn: null, capturedOnOct2024: null,
  warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: null, periodChanges: [], separateSpans: [], units: null, newDevicesInstall: null, ...over,
})

describe('Zeitraum der Heizung (Entwurf 11.2 Schritt 3)', () => {
  test('Vorgabe: wie das Objekt; mit eigener Heizperiode ihr Beginnmonat', () => {
    expect(heatingPeriodForm(plant())).toEqual({ choice: 'object', mode: 'start', month: 5, from: '', separate: '' })
    expect(heatingPeriodForm(plant({ periodStartMonth: 7, separateSettlement: true }))).toEqual({ choice: 'own', mode: 'start', month: 7, from: '', separate: 'yes' })
  })
  test('Regeln: wie das Objekt, von Anfang an, ab einem Monat', () => {
    expect(heatingRulesBody({ choice: 'object', mode: 'start', month: 5, from: '', separate: '' }, plant(), CALENDAR_RULES)).toEqual({ rules: null })
    expect(heatingRulesBody({ choice: 'own', mode: 'start', month: 5, from: '', separate: '' }, plant(), CALENDAR_RULES)).toEqual({ rules: { startMonth: 5, changes: [] } })
    expect(heatingRulesBody({ choice: 'own', mode: 'change', month: 5, from: '2026-01', separate: '' }, plant({ periodStartMonth: 5 }), CALENDAR_RULES)).toEqual({ rules: { startMonth: 5, changes: ['2026-01'] } })
    expect(heatingRulesBody({ choice: 'own', mode: 'change', month: 5, from: '', separate: '' }, plant(), CALENDAR_RULES)).toEqual({ error: 'Bitte geben Sie den Monat an, ab dem die Heizung im neuen Zeitraum abrechnet.' })
  })
  test('Vorgeschlagener Weg: getrennt → d, sonst b bei vorhandenen Daten, sonst a; immer mit dem Mietvertrag', () => {
    expect(suggestedWay({ differs: false, separate: 'yes', hasCalendarData: true })).toBe(null)
    expect(suggestedWay({ differs: true, separate: 'yes', hasCalendarData: true })?.way).toBe('d')
    expect(suggestedWay({ differs: true, separate: 'no', hasCalendarData: true })?.way).toBe('b')
    expect(suggestedWay({ differs: true, separate: 'unknown', hasCalendarData: false })?.way).toBe('a')
    expect(suggestedWay({ differs: true, separate: 'no', hasCalendarData: true })?.text).toMatch(/Zustimmung der Mieter/)
  })
  test('Zusammenfassung in der Karte', () => {
    expect(heatingPeriodSummary(plant(), CALENDAR_RULES)).toEqual(['Zeitraum der Heizung: wie das Objekt'])
    expect(heatingPeriodSummary(plant({ periodStartMonth: 5, separateSettlement: true, separateSpans: [{ from: '2026-01', until: null }] }), CALENDAR_RULES)).toEqual([
      'Zeitraum der Heizung: Mai bis April',
      'Heizkosten getrennt abgerechnet ab Januar 2026',
    ])
  })
})

describe('Antworten zu den Vorschauen', () => {
  const wechsel: HeatingPeriodChangePreview = {
    rules: { startMonth: 5, changes: [] }, periods: [], newShort: [], blocked: [], moves: [], endsSeparate: [], effects: [], token: 'w1',
    groups: [{ from: k('2026-01'), fromLabel: '2026', items: [{ costItemId: 'c1', description: 'Gas', amountCents: 100000 }], options: [{ key: k('2025-05'), label: '2025/2026', range: '01.05.2025–30.04.2026' }], suggested: k('2025-05') }],
    overrides: [{ tenancyId: 't1', tenantName: 'A', from: [], ask: [{ kind: 'heating', period: k('2025-05'), label: '01.05.–31.12.2025', months: '05–12/2025' }, { kind: 'total', period: k('2026-01'), label: '2026', months: '01–12/2026' }] }],
  }
  test('Wechsel: Gruppen vorbelegt, Beträge oder „keine Korrektur“', () => {
    const form = initialHeatingPeriodAnswers(wechsel)
    expect(form.groups).toEqual({ '2026-01': '2025-05' })
    expect(heatingPeriodAnswersOf(wechsel, form)).toEqual({ error: 'Bitte tragen Sie für A den Betrag 05–12/2025 ein oder setzen Sie „keine Korrektur“.' })
    const ok = heatingPeriodAnswersOf(wechsel, { ...form, amounts: { 't1|heating|2025-05': '900,00' }, none: { 't1|total|2026-01': true } })
    expect(ok).toEqual({ groups: { '2026-01': '2025-05' }, moves: {}, overrides: { t1: { '2025-05': 90000 } }, totals: { t1: { '2026-01': null } }, token: 'w1' })
  })
  const ein: SeparatePreview = {
    separate: true, way: 'separate', month: '2026-01', earliestMonth: null, until: null, earliestUntil: null, share: null, keep: [], merge: [], blocked: [], deadlines: [], effects: [], token: 's1',
    steps: [{ tenancyId: 't1', tenantName: 'A', rows: [{ from: '2026-01', totalCents: 30000, heatingCents: 12300 }] }],
    overrides: [{ tenancyId: 't1', tenantName: 'A', period: k('2026-01'), label: '2026', cents: 330000,
      asks: [{ kind: 'total', period: k('2026-01'), label: '2026', months: '01–12/2026' }, { kind: 'heating', period: k('2025-05'), label: '2025/2026', months: '01–04/2026' }],
      remainder: { period: k('2026-05'), label: '2026/2027', months: '05–12/2026' } }],
  }
  test('Einschalten: Heizanteil vorbelegt, Korrekturen verlangt, Rest wird angezeigt', () => {
    const form = initialSeparateAnswers(ein)
    expect(form.steps).toEqual({ 't1|2026-01': '123,00' })
    expect(separateAnswersOf(ein, form)).toEqual({ error: 'Bitte tragen Sie für A „2026“ ein.' })
    const ok = separateAnswersOf(ein, { ...form, amounts: { 't1|total|2026-01': '2.124,00', 't1|heating|2025-05': '300,00' } })
    expect(ok).toEqual({ steps: { t1: { '2026-01': 12300 } }, totals: { t1: { '2026-01': 212400 } }, overrides: { t1: { '2025-05': 30000 } }, merge: true, token: 's1' })
    expect(separateAnswersOf(ein, { ...form, steps: { 't1|2026-01': '400,00' } })).toEqual({ error: 'Der Heizanteil von A ab 01/2026 liegt über der Vorauszahlung von 300,00 €.' })
  })
})

describe('Drei Wege, wenn der Messdienst anders abrechnet (Nutzerwunsch, BGH VIII ZR 240/07)', () => {
  test('Alle drei Wege mit Vor- und Nachteilen; Vorgabe Weg 1 bei gemeinsamer Vorauszahlung', () => {
    const ways = heatingWays({ objectCalendar: true, separate: 'no' })
    expect(ways.map((w) => w.id)).toEqual(['own', 'object', 'service'])
    expect(ways.map((w) => w.title)).toEqual([
      'Kalenderjahr, Heizung in der Heizperiode des Messdienstes',
      'Alles auf den Zeitraum des Messdienstes umstellen',
      'Den Messdienst auf den 31.12. umstellen lassen',
    ])
    expect(ways.filter((w) => w.recommended).map((w) => w.id)).toEqual(['own'])
    for (const w of ways) {
      expect(w.pros.length).toBeGreaterThan(0)
      expect(w.cons.length).toBeGreaterThan(0)
    }
    expect(ways[0]?.example).toBe('Beispiel: Der Messdienst rechnet von Mai bis April ab. Die Heizperiode 01.05.2025–30.04.2026 steht in der Betriebskostenabrechnung 2026, dem Jahr, in dem sie endet.')
    expect(ways[0]?.why).toMatch(/BGH, Urteil vom 30\.04\.2008, VIII ZR 240\/07/)
    // Auch Weg 1 nennt den Vorbehalt des Mietvertrags (Durchsicht von #231, Minor 8).
    expect(ways[0]?.cons.join(' ')).toMatch(/Zustimmung der Mieter/)
  })
  test('Ohne Antwort zur Vorauszahlung bleibt Weg 1 die Vorgabe, mit Vorbehalt; bei getrennter Abrechnung keine Vorgabe unter den drei', () => {
    expect(heatingWays({ objectCalendar: true, separate: '' }).filter((w) => w.recommended).map((w) => w.id)).toEqual(['own'])
    expect(heatingWays({ objectCalendar: true, separate: '' })[0]?.why).toMatch(/sofern Ihre Mieter eine einzige Vorauszahlung für alle Nebenkosten zahlen/)
    // Laienprobe B14: das Beispiel nach dem Zeitraum des Objekts.
    expect(heatingWays({ objectCalendar: false, separate: '' })[0]?.example).toMatch(/des Zeitraums, in dem der 30\.04\.2026 liegt/)
    expect(heatingWays({ objectCalendar: true, separate: 'yes' }).some((w) => w.recommended)).toBe(false)
  })
})

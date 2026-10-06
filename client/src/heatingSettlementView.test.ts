import { describe, expect, test } from 'vitest'
import {
  adjustedPrepaymentLabel, cockpitHeatingRows, heatingChoices, heatingItemPeriods, heatingOnlyNote, heatingOverridesWith, itemsOfPeriod, prepaymentLabel, prepaymentSplit, totalLabel,
  heatingTaxYear, recommendedDeadlineText, scheduleOf, separateHeatingFor, settlementPaths, settlementTitle,
} from './heatingSettlementView'
import { CALENDAR_RULES, calendarYearPeriod, periodKey as k, settlementPeriod } from '../../shared/period.ts'
import type { HeatingPlant, HeatingSettlementInfo, Statement, Tenancy } from './types'

const p2026 = settlementPeriod(calendarYearPeriod(2026))
const h2025 = { key: k('2025-05'), from: '2025-05-01', to: '2026-04-30', short: false, label: '2025/2026' }
const statement = (over: Partial<Statement> = {}): Statement => ({
  tenancyId: 't1', unitId: 'u1', tenantName: 'M', unitName: 'EG', persons: 1, days: 184, personDays: 184, periodStart: '2025-05-01', periodEnd: '2025-10-31',
  rows: [], totalShareCents: 41230, total35aCents: 0, prepaymentCents: 0, prepaymentOverridden: false, suggestedMonthlyCents: 0, balanceCents: -41230, ...over,
})
const plant = (over: Partial<HeatingPlant> = {}): HeatingPlant => ({
  id: 'hp1', propertyId: 'objekt-1', name: '', energy: 'gas', supply: 'central', method: 'service', separateSettlement: null,
  devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', source: 'building', captureInstalledOn: null, capturedOnOct2024: null,
  warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: 5, periodChanges: [], separateSpans: [], units: null, newDevicesInstall: null, nonResidential: false, restriction: 'none', districtEtsNew: false, endsOn: null, replacesPlantId: null, buildingWith: null, takesOverStock: null, ...over,
})

describe('Überschrift und Druckkopf (Entwurf 3.1)', () => {
  test('Betriebskosten mit eigener Heizperiode, Heizkostenabrechnung, sonst wie bisher', () => {
    expect(settlementTitle({ period: p2026, heatingPeriods: [{ plantId: 'hp1', period: h2025 }] })).toBe('Betriebskosten 2026, darin Heiz- und Warmwasserkosten 01.05.2025–30.04.2026')
    expect(settlementTitle({ period: h2025, scope: { kind: 'heating', plantId: 'hp1', plantName: '' } })).toBe('Heizkostenabrechnung 2025/2026')
    expect(settlementTitle({ period: p2026 })).toBe('Nebenkostenabrechnung 2026')
    expect(settlementTitle({ period: p2026, heatingPeriods: [{ plantId: 'hp1', period: p2026 }] })).toBe('Nebenkostenabrechnung 2026')
  })
  test('Abrechnung nur mit Heizkosten', () => {
    expect(heatingOnlyNote(statement({ heatingOnly: true }))).toMatch(/^Abrechnung nur der Heizkosten/)
    expect(heatingOnlyNote(statement())).toBe(null)
    expect(recommendedDeadlineText(statement({ heatingOnly: true, recommendedDeadline: '2026-12-31' }))).toBe('Empfohlene Frist für diese Abrechnung: 31.12.2026 (die Frist der Abrechnung selbst ist nicht entschieden).')
  })
  test('Vorauszahlungen: beide getrennt ausgewiesen, in der Heizkostenabrechnung die Heizvorauszahlung', () => {
    expect(prepaymentSplit(statement({ prepaymentCents: 360000, heatingPrepaymentCents: 147600 }))).toEqual([
      { label: 'davon Heizvorauszahlung', cents: 147600 },
      { label: 'davon übrige Vorauszahlungen', cents: 212400 },
    ])
    expect(prepaymentSplit(statement({ prepaymentCents: 147600, heatingPrepaymentCents: 147600, scope: 'heating' }))).toEqual([])
    expect(prepaymentLabel(statement({ scope: 'heating' }))).toBe('abzüglich geleisteter Heizvorauszahlungen')
    expect(prepaymentLabel(statement())).toBe('abzüglich geleisteter Vorauszahlungen')
  })
  test('Laienprobe B17, B18: Beschriftungen nach Art der Abrechnung, keine Heizvorauszahlung von 0,00 €', () => {
    expect(totalLabel(statement({ scope: 'heating' }))).toBe('Summe Ihrer Heizkosten')
    expect(totalLabel(statement())).toBe('Summe Ihrer Betriebskosten')
    expect(adjustedPrepaymentLabel(statement({ scope: 'heating' }), false)).toBe('monatliche Heizkostenvorauszahlung')
    expect(adjustedPrepaymentLabel(statement(), true)).toBe('monatliche Vorauszahlung für die übrigen Nebenkosten (ohne Heizung)')
    expect(adjustedPrepaymentLabel(statement(), false)).toBe('monatliche Nebenkostenvorauszahlung')
    // Sichtprüfung E42: „davon Heizvorauszahlung 0,00 €“ stand auch ohne eigene Heizkostenabrechnung
    // da, etwa im Jahr, bevor die Heizvorauszahlung beginnt. Ohne Heizvorauszahlung keine Zeilen; wo
    // sie abgerechnet wird, sagt der Server in `prepaymentNote`.
    const ohneHeizung = statement({ prepaymentCents: 42000, heatingPrepaymentCents: 0 })
    expect(prepaymentSplit(ohneHeizung)).toEqual([])
  })
})

describe('Heizkostenabrechnungen auswählen, abschließen, korrigieren', () => {
  const info = (key: string, to: string, closed: HeatingSettlementInfo['closed'] = null): HeatingSettlementInfo => ({
    plantId: 'hp1', plantName: '', period: { key: k(key), from: `${key}-01`, to, short: false, label: key }, deadline: `${Number(to.slice(0, 4)) + 1}${to.slice(4)}`, closed,
  })
  test('Auswahl: die Heizperioden, die im Zeitraum enden', () => {
    const list = [info('2024-05', '2025-04-30'), info('2025-05', '2026-04-30'), info('2026-05', '2027-04-30')]
    expect(heatingChoices(list, p2026).map((h) => h.period.key)).toEqual(['2025-05'])
  })
  test('Adressen', () => {
    expect(settlementPaths('2026', null)).toEqual({ load: '/api/settlement/2026', close: '/api/settlement/2026/close', history: '/api/settlement/2026/history' })
    expect(settlementPaths('2026', { plantId: 'hp1', period: k('2025-05') }).close).toBe('/api/heating-settlement/hp1/2025-05/close')
  })
  test('„✎ anpassen“ schreibt die Heizkorrektur der Heizperiode, endgültig', () => {
    const t = { heatingPrepaymentOverrides: [{ plantId: 'hp1', period: k('2026-05'), cents: 87600, provisional: true, fromMonth: '2026-05', toMonth: '2026-12' }] } satisfies Pick<Tenancy, 'heatingPrepaymentOverrides'>
    expect(heatingOverridesWith(t, 'hp1', k('2026-05'), 140000)).toEqual([{ plantId: 'hp1', period: '2026-05', cents: 140000, provisional: false, fromMonth: null, toMonth: null }])
    expect(heatingOverridesWith(t, 'hp1', k('2026-05'), null)).toEqual([])
  })
  test('Cockpit: jede beendete Heizperiode mit ihrer Frist', () => {
    const rows = cockpitHeatingRows([
      info('2024-05', '2025-04-30', { closedAt: '2025-08-01', sentAt: '2025-08-02' }),
      info('2025-05', '2026-04-30'),
      info('2026-05', '2027-04-30'),
    ], '2026-10-05')
    expect(rows.map((r) => [r.label, r.level])).toEqual([['Heizkostenabrechnung 2024-05', 'gruen'], ['Heizkostenabrechnung 2025-05', 'gelb']])
    expect(rows[1]?.text).toBe('Frist 30.04.2027, noch nicht versendet.')
    expect(cockpitHeatingRows([info('2024-05', '2025-04-30')], '2026-05-01')[0]).toMatchObject({ level: 'rot', text: 'Frist 30.04.2026 abgelaufen; eine Nachforderung ist in der Regel ausgeschlossen, außer Sie haben die Verspätung nicht zu vertreten (§ 556 Abs. 3 Satz 3 BGB).' })
  })
})

describe('Kostenformular und Mietverhältnis', () => {
  test('Heizperioden einer eigenen Heizperiode im Zeitraum, und die Positionen dazu', () => {
    expect(heatingItemPeriods([plant(), plant({ id: 'hp2', periodStartMonth: null })], CALENDAR_RULES, p2026)).toEqual([
      { plantId: 'hp1', options: [{ value: '2025-05', label: 'Heizperiode 2025/2026 (01.05.2025–30.04.2026)', startYear: 2025, endYear: 2026 }] },
    ])
    const items = [
      { id: 'a', period: k('2026-01'), heatingPlantId: undefined },
      { id: 'b', period: k('2025-05'), heatingPlantId: 'hp1' },
      { id: 'c', period: k('2025-05'), heatingPlantId: undefined },
    ]
    expect(itemsOfPeriod(items, k('2026-01'), [{ plantId: 'hp1', key: '2025-05' }]).map((c) => c.id)).toEqual(['a', 'b'])
  })
  test('Staffel aus dem Formular', () => {
    expect(scheduleOf([{ from: '2025-05', amount: '123,00' }, { from: '', amount: '' }])).toEqual([{ from: '2025-05', monthlyCents: 12300 }])
    expect(scheduleOf([{ from: '2025-05', amount: 'viel' }])).toEqual({ error: 'Bitte die Staffel der Heizvorauszahlung prüfen (Monat und Betrag).' })
    // Ein leerer Monat ist der Einzugsmonat, wie bei den übrigen Staffeln (Durchsicht von #231, Minor 3).
    expect(scheduleOf([{ from: '', amount: '123,00' }], '2025-08')).toEqual([{ from: '2025-08', monthlyCents: 12300 }])
  })
})

describe('Heizvorauszahlung im Mietverhältnis (Durchsicht von #231, Important 2)', () => {
  test('Gefragt wird, wenn die Anlage der Wohnung getrennt abrechnet', () => {
    const unit = { id: 'u1', noConnection: undefined }
    expect(separateHeatingFor(unit, [plant()])).toBe(false)
    expect(separateHeatingFor(unit, [plant({ separateSpans: [{ from: '2025-05', until: null }] })])).toBe(true)
    expect(separateHeatingFor(unit, [plant({ separateSpans: [{ from: '2025-05', until: k('2026-05') }] })])).toBe(false)
    expect(separateHeatingFor(unit, [plant({ periodStartMonth: null, separateSettlement: true })])).toBe(true)
    expect(separateHeatingFor(unit, [plant({ separateSpans: [{ from: '2025-05', until: null }], units: [{ unitId: 'u2', heatedAreaM2: null }] })])).toBe(false)
  })
})

describe('Jahr der Zahlung einer Heizposition (Durchsicht von #231, Important 3)', () => {
  test('Heizperiode über zwei Jahre: sichtbar, Jahre vom Beginn bis ein Jahr nach dem Ende, Vorgabe das Jahr des Beginns', () => {
    // Laienprobe B15: ohne Beleg keine Vorgabe; mit Beleg das Jahr des Rechnungsdatums (Entwurf 3.10).
    expect(heatingTaxYear({ startYear: 2025, endYear: 2026 }, '')).toEqual({ show: true, years: [2025, 2026, 2027], fallback: '', valid: false })
    expect(heatingTaxYear({ startYear: 2025, endYear: 2026 }, '', '2025-11-20')).toMatchObject({ fallback: '2025' })
    expect(heatingTaxYear({ startYear: 2025, endYear: 2026 }, '', '2029-01-15')).toMatchObject({ fallback: '2027' })
    expect(heatingTaxYear({ startYear: 2025, endYear: 2026 }, '2026')).toMatchObject({ valid: true })
    // Ein Wert aus dem Objektzeitraum (Juli–Juni, 2027 erlaubt dort), den es für die Heizperiode nicht gibt.
    expect(heatingTaxYear({ startYear: 2024, endYear: 2025 }, '2027')).toMatchObject({ valid: false, fallback: '' })
  })
  test('Heizperiode in einem Kalenderjahr: kein Feld, kein Wert', () => {
    expect(heatingTaxYear({ startYear: 2026, endYear: 2026 }, '2027')).toEqual({ show: false, years: [], fallback: '', valid: true })
  })
})

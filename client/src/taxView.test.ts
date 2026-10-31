import { describe, expect, it, test } from 'vitest'
import type { TaxExpenseItem, TaxReport } from './types'
import { costModelLineTexts, allocationLabel, assignedUnitItems, DEFAULT_BASIS, excludedAreaDifference, incomeCentsFor, keyNotAreaDifference, operatingPowerBalanceText, paidWithoutSettlementCents, prepaymentNote, settlementBalanceCents, settlementLine, settlementSourcesText, showsSplit, stockCarryNote, surplusCentsFor, taxHints, maintenanceLineText, withdrawalLinesText, usageChangeTouchesWithdrawal, withdrawalSuspectDated, ETW_WITHDRAWAL_TEXT, movedInLines, movedInText, movedOutLines, unstatedText, headerRows, acquisitionRelated, acquisitionRelatedText, ACQUISITION_RELATED_MORE, type TaxHeaderProperty } from './taxView'
import { fmtEuro } from './api'
import { periodKey } from '../../shared/period.ts'

// Ein Bericht, in dem nur das steht, was die Hinweise lesen. Die übrigen Felder füllt der Typ
// ab, damit der Übersetzer mitprüft, dass die Hinweise wirklich einen TaxReport lesen.
const report = (income: Partial<TaxReport['income']>, rest: Partial<TaxReport> = {}): TaxReport => ({
  year: 2025,
  income: {
    baseRentSollCents: 960000,
    inclusiveRentSollCents: 0,
    prepaymentSollCents: 240000,
    flatRateSollCents: 0,
    prepaymentSettlementCents: 240000,
    prepaymentOverridden: false,
    sollCents: 1200000,
    paidCents: 1200000,
    settlementBackPaymentsCents: 0,
    settlementRefundsCents: 0,
    tenanciesWithSoll: 1,
    tenanciesWithoutPayment: 0,
    ...income,
  },
  expenses: { groups: [], totalCents: 0, privateCents: 0, deductibleCents: 0, labor35aCents: 0, items: [], unstatedCount: 0 },
  movedOut: [],
  selfUseChangedInYear: false,
  closedSelfUseDiffers: false,
  closedItemsChanged: 0,
  reserveContributionCents: 0,
  reserveSuspects: [],
  totalAreaM2: 100,
  selfUsedAreaM2: 0,
  selfOccupiedExists: false,
  excludedExists: false,
  selfUsedShareCents: 0,
  surplusSollCents: 1100000,
  surplusPaidCents: 900000,
  costModels: { tenancies: 1, inclusive: 0, partlyInclusive: 0, flatRate: 0 },
  settlementPeriods: [],
  ...rest,
})

describe('Steuerübersicht: Grundlage und Hinweise (#70)', () => {
  it('rechnet von sich aus auf das tatsächlich Zugeflossene', () => {
    // **Der eigentliche Befund.** Nach § 11 Abs. 1 Satz 1 EStG sind Einnahmen in dem Jahr
    // anzusetzen, in dem sie zugeflossen sind; ein vereinbartes, nicht gezahltes Soll ist keine
    // Einnahme. Die Vorgabe war trotzdem das Soll, weil es auch ohne erfasste Zahlungen eine
    // Zahl liefert. Das ist der schlechtere der beiden Ausgänge: 0 € sind sichtbar falsch und
    // führen ins Mietkonto, eine Soll-Summe ist unsichtbar falsch und wandert in die Anlage V.
    expect(DEFAULT_BASIS).toBe('ist')
  })

  it('setzt auf der Ist-Grundlage wirklich das Zugeflossene an', () => {
    // **Ohne diesen Test war die Kernaussage des Umbaus ungeprüft.** Die Durchsicht hat gemessen:
    // Vertauscht man in den beiden Funktionen Soll und Ist, bleibt die ganze Client-Suite grün.
    // Das Auswahlfeld sagte dann weiter „tatsächlich gezahlt", angesetzt würde das Soll, und die
    // Anlage V bekäme wieder die unsichtbar falsche Zahl. Geprüft war nur der Name der Vorgabe,
    // nicht die Zahl, die daraus folgt.
    const r = report({})
    expect(incomeCentsFor(r, 'ist')).toBe(1200000)
    expect(surplusCentsFor(r, 'ist')).toBe(900000)
    expect(incomeCentsFor(r, 'soll')).toBe(1200000)
    expect(surplusCentsFor(r, 'soll')).toBe(1100000)
    // Und die beiden Grundlagen dürfen sich nicht dieselbe Zahl teilen, sonst prüfte der Test
    // oben nichts: Bei gleichen Werten fiele ein Vertauschen nicht auf.
    const verschieden = report({ paidCents: 900000 })
    expect(incomeCentsFor(verschieden, 'ist')).toBe(900000)
    expect(incomeCentsFor(verschieden, 'soll')).toBe(1200000)
  })

  it('sagt es, wenn jemand auf das Soll umschaltet', () => {
    expect(taxHints(report({}), 'soll')).toContain('sollIsNotTaxBasis')
    expect(taxHints(report({}), 'ist')).not.toContain('sollIsNotTaxBasis')
  })

  it('bringt auf der Soll-Grundlage keine Hinweise, die nur das Ist betreffen', () => {
    // Auf der Soll-Grundlage ist weder die fehlende Zahlung noch der Jahreswechsel eine Frage:
    // Beide betreffen den Zufluss, und der ist dort nicht die angesetzte Zahl.
    expect(taxHints(report({ tenanciesWithoutPayment: 1 }), 'soll')).toEqual(['sollIsNotTaxBasis'])
  })

  it('warnt, sobald für ein Mietverhältnis mit Soll gar keine Zahlung erfasst ist', () => {
    // **Ein Hinweis für beide Stärken, und das ist die Korrektur aus der zweiten Durchsicht.**
    // Vorher gab es zwei, und der für „gar nichts erfasst" behauptete „Deshalb stehen hier 0 €".
    // Gemessen stimmt das nicht: Eine Zahlung, die zu keiner Zeile des Jahres gehört (alter
    // Mieter bis 31.12., Dezembermiete am 5. Januar), zählt in `paidCents`, aber zu keinem
    // Mietverhältnis der Liste. Der Satz stand dann neben angesetzten Einnahmen von 800 €.
    const alle = report({ paidCents: 0, tenanciesWithSoll: 2, tenanciesWithoutPayment: 2 })
    expect(taxHints(alle, 'ist')).toContain('paymentsMissing')

    // **Der gefährlichere der beiden Fälle, und bisher fiel er ganz durch.** Sind für einen
    // Mieter Zahlungen erfasst und für einen zweiten nicht, ist die Summe größer als null, sieht
    // also vollständig aus, und die zu niedrige Einnahme ginge ohne Vorbehalt in die Anlage V.
    const teilweise = report({ tenanciesWithSoll: 2, tenanciesWithoutPayment: 1 })
    expect(taxHints(teilweise, 'ist')).toContain('paymentsMissing')

    // Und er bleibt aus, sobald überall etwas erfasst ist.
    expect(taxHints(report({}), 'ist')).not.toContain('paymentsMissing')
  })

  it('schweigt über fehlende Zahlungen, wenn es auch kein Soll gibt', () => {
    // Ein Jahr ohne Mietverhältnis ist kein Versäumnis. Ohne diese Bedingung bekäme jeder, der
    // ein künftiges Jahr aufschlägt, eine Ermahnung für etwas, das es nicht gibt.
    const hints = taxHints(report({ paidCents: 0, sollCents: 0, tenanciesWithSoll: 0, tenanciesWithoutPayment: 0 }), 'ist')
    expect(hints).not.toContain('paymentsMissing')
  })

  it('nennt die Zehn-Tage-Regel nur mit Betrag und nur auf der Ist-Grundlage (#312 PR 3, E8)', () => {
    // Er stand als Bedingung in der Seite und war damit ungeprüft, obwohl der CHANGELOG ihn als
    // eigenes Verhalten führt. Seit #312 PR 3 rechnet Mietfuchs die Regel; ein Vorbehalt ohne Anlass entfällt
    // (weitere Lagen in taxIncome.test.ts).
    expect(taxHints(report({}), 'ist')).not.toContain('turnOfYear')
    const turn = { forwardCents: 80000, forwardAllocationsCents: 0, fromPreviousCents: 0, fromPreviousAllocationsCents: 0, forwardOldLeaseCents: 0, lateDecemberCents: 0 }
    const received: NonNullable<TaxReport['income']['received']> = {
      rentCents: 0, inclusiveRentCents: 0, unallocatedCents: 0, allocationsCents: 0, flatRateCents: 0, formerYearsCents: 0, formerYearsAllocationsCents: 0,
      turnOfYear: turn, byUnit: [], byTenancy: [], possibleDeposits: [], totalCents: 0, unassignedCents: 0,
      relatives: { rentCents: 0, allocationsCents: 0, settlementCents: 0, inclusiveRentCents: 0, unallocatedCents: 0, flatRateCents: 0, sollRentCents: 0, sollInclusiveRentCents: 0, sollAllocationsCents: 0, sollFlatRateCents: 0 },
    }
    expect(taxHints(report({ received }), 'ist')).toContain('turnOfYear')
    expect(taxHints(report({ received }), 'soll')).not.toContain('turnOfYear')
  })
})

describe('Steuerübersicht: der Unterschied zur Abrechnung (#70)', () => {
  it('schweigt, solange beide Zahlen dieselbe sind', () => {
    expect(prepaymentNote(report({}))).toBeNull()
  })

  it('meldet den Unterschied auch ohne Jahreskorrektur', () => {
    // **Der Befund der Durchsicht, und es ist #70 eine Ecke weiter.** Der erste Entwurf löste den
    // Hinweis an der Jahreskorrektur aus. Den Unterschied gibt es aber auch ohne sie: Das
    // Mietkonto führt jedes Mietverhältnis mit Überlappung im Jahr, die Abrechnung nur die auf
    // beteiligten Wohnungen. Eine vermietete Wohnung außerhalb der Abrechnungseinheit ergibt
    // damit zwei verschiedene Zahlen und bisher kein Wort dazu.
    const note = prepaymentNote(report({ prepaymentSollCents: 480000, prepaymentSettlementCents: 240000 }))
    expect(note).toEqual({ settlementCents: 240000, sollCents: 480000, jahreskorrektur: false, closed: false })
  })

  it('schweigt, wenn eine Jahreskorrektur zufällig dem Soll entspricht', () => {
    // Die Gegenrichtung desselben Fehlers: Ein Hinweis, der einen Unterschied erklärt, den es
    // nicht gibt, ist schlimmer als keiner.
    expect(prepaymentNote(report({ prepaymentOverridden: true }))).toBeNull()
  })

  it('nennt den eingefrorenen Stand einer abgeschlossenen Abrechnung (Durchsicht #311, K3)', () => {
    // Vor #311 abgeschlossen: Die Abrechnung setzt eingefroren 1.350 € an, das Soll rechnet heute den
    // angebrochenen März anteilig mit (1.432,26 €). Ohne den Satz suchte der Vermieter eine Korrektur.
    const note = prepaymentNote(report({ prepaymentSollCents: 143226, prepaymentSettlementCents: 135000, prepaymentSettlementClosed: true }))
    expect(note).toEqual({ settlementCents: 135000, sollCents: 143226, jahreskorrektur: false, closed: true })
  })

  it('nennt die Jahreskorrektur, wenn die Abrechnung eine ansetzt', () => {
    const note = prepaymentNote(report({ prepaymentSettlementCents: 180000, prepaymentOverridden: true }))
    expect(note?.jahreskorrektur).toBe(true)
    expect(note?.settlementCents).toBe(180000)
  })
})

describe('Anlage V, Zeilen 24 und 20 (#96)', () => {
  it('eine 1 in Zeile 24 nur, wenn alle Mietverhältnisse ganz inklusiv sind; sonst der gemischte Fall', () => {
    const cm = (c: Partial<TaxReport['costModels']>) => report({}, { costModels: { tenancies: 2, inclusive: 0, partlyInclusive: 0, flatRate: 0, ...c } })
    expect(taxHints(cm({ inclusive: 2 }), 'ist')).toContain('inclusiveLine24')
    expect(taxHints(cm({ inclusive: 1 }), 'ist')).toContain('inclusiveLine24Mixed')
    expect(taxHints(cm({ partlyInclusive: 2 }), 'ist')).toContain('inclusiveLine24Mixed')
    expect(taxHints(cm({ partlyInclusive: 2 }), 'ist')).not.toContain('inclusiveLine24')
    expect(taxHints(cm({ flatRate: 1 }), 'soll')).toContain('flatRateLine20')
    expect(taxHints(cm({}), 'ist')).not.toContain('inclusiveLine24Mixed')
  })
})

describe('Erhaltungsrücklage (#143)', () => {
  it('weist die Zuführung aus, sobald es eine gibt', () => {
    expect(taxHints(report({}), 'ist')).not.toContain('reserveContribution')
    expect(taxHints(report({}, { reserveContributionCents: 90000 }), 'ist')).toContain('reserveContribution')
    expect(taxHints(report({}, { reserveContributionCents: 90000 }), 'soll')).toContain('reserveContribution')
  })
  it('meldet eine Position, die nach Rücklage aussieht', () => {
    const r = report({}, { reserveSuspects: [{ costItemId: 'v', description: 'Rücklage', amountCents: 90000 }] })
    expect(taxHints(r, 'ist')).toContain('reserveSuspected')
    expect(taxHints(report({}), 'ist')).not.toContain('reserveSuspected')
  })
  it('nennt den Abfluss des Hausgelds nur bei einer Eigentumswohnung', () => {
    expect(taxHints(report({}), 'ist', 'etw')).toContain('etwHousingMoney')
    expect(taxHints(report({}), 'soll', 'etw')).toContain('etwHousingMoney')
    expect(taxHints(report({}), 'ist', 'mfh')).not.toContain('etwHousingMoney')
    expect(taxHints(report({}), 'ist')).not.toContain('etwHousingMoney')
  })
})

describe('Teilweise Eigennutzung (#163)', () => {
  const pos = (over: Partial<TaxExpenseItem>): TaxExpenseItem => ({
    costItemId: 'c', category: 'Grundsteuer', group: 'Grundsteuer & öffentliche Abgaben', description: 'Grundsteuer',
    amountCents: 100000, privateCents: 0, deductibleCents: 100000, labor35aCents: 0,
    allocation: 'settlement', deductiblePercent: 100, areaPrivateCents: null, settlementPrivateCents: null, steps: [], taxUnits: null, ...over,
  })
  const mixed = (items: TaxExpenseItem[], rest: Partial<TaxReport> = {}) => report({}, {
    selfOccupiedExists: true, selfUsedAreaM2: 50,
    expenses: {
      groups: [], items, unstatedCount: 0, totalCents: items.reduce((a, x) => a + x.amountCents, 0),
      privateCents: items.reduce((a, x) => a + x.privateCents, 0),
      deductibleCents: items.reduce((a, x) => a + x.deductibleCents, 0), labor35aCents: 0,
    },
    ...rest,
  })

  it('erklärt die Aufteilung und das, was nicht gerechnet wird, nur bei Eigennutzung', () => {
    expect(taxHints(mixed([]), 'ist')).toEqual(expect.arrayContaining(['mixedUseSplit', 'mixedUseNotCalculated']))
    expect(taxHints(report({}), 'ist')).not.toContain('mixedUseSplit')
    expect(taxHints(report({}), 'ist')).not.toContain('mixedUseNotCalculated')
  })

  it('zeigt die Spalten privat und abziehbar nur, wenn es etwas Privates geben kann', () => {
    expect(showsSplit(report({}))).toBe(false)
    expect(showsSplit(mixed([]))).toBe(true)
  })

  it('beziffert den Unterschied zum Flächenmaßstab, wenn die Abrechnung anders verteilt', () => {
    const r = mixed([
      pos({ costItemId: 'a', privateCents: 50000, deductibleCents: 50000, areaPrivateCents: 25000 }),
      pos({ costItemId: 'b', privateCents: 30000, deductibleCents: 70000, areaPrivateCents: 30000 }),
      pos({ costItemId: 'c', privateCents: 10000, deductibleCents: 90000, areaPrivateCents: null }),
    ])
    expect(taxHints(r, 'ist')).toContain('mixedUseKeyNotArea')
    expect(keyNotAreaDifference(r)).toEqual({ count: 1, differenceCents: 25000 })
    // Gleich oder ohne Vergleich: kein Hinweis.
    expect(taxHints(mixed([pos({ areaPrivateCents: 0 })]), 'ist')).not.toContain('mixedUseKeyNotArea')
  })

  it('meldet fehlende Fläche, Einheiten außerhalb, Nutzungswechsel, geänderten Abschluss und Lohnanteile', () => {
    expect(taxHints(mixed([pos({ allocation: 'unsplittable', deductiblePercent: null })]), 'ist')).toContain('mixedUseAreaMissing')
    expect(taxHints(mixed([pos({ allocation: 'direct-outside', deductiblePercent: null })]), 'ist')).toContain('mixedUseDirectOutside')
    expect(taxHints(mixed([], { selfUseChangedInYear: true }), 'ist')).toContain('mixedUseChangedInYear')
    expect(taxHints(mixed([], { closedSelfUseDiffers: true }), 'ist')).toContain('mixedUseClosedChanged')
    expect(taxHints(mixed([pos({ labor35aCents: 8000, privateCents: 4000, deductibleCents: 96000 })]), 'ist')).toContain('mixedUseLabor35a')
    // Ein Lohnanteil an einer voll abziehbaren Position betrifft die eigene Erklärung nicht.
    expect(taxHints(mixed([pos({ labor35aCents: 8000 })]), 'ist')).not.toContain('mixedUseLabor35a')
    const leer = taxHints(mixed([]), 'ist')
    for (const h of ['mixedUseAreaMissing', 'mixedUseDirectOutside', 'mixedUseChangedInYear', 'mixedUseClosedChanged', 'mixedUseLabor35a'] as const) expect(leer).not.toContain(h)
  })

  it('nennt die Zuordnung wie der Vordruck: direkt oder anteilig mit Prozent', () => {
    expect(allocationLabel(pos({ allocation: 'settlement', deductiblePercent: 27.27 }))).toBe('anteilig, abziehbar 27,27 % (laut Abrechnung)')
    expect(allocationLabel(pos({ allocation: 'area', deductiblePercent: 42.86 }))).toBe('anteilig, abziehbar 42,86 % (nach Fläche)')
    expect(allocationLabel(pos({ allocation: 'settlement', deductiblePercent: null }))).toBe('anteilig (laut Abrechnung)')
    expect(allocationLabel(pos({ allocation: 'direct-self' }))).toBe('direkt, selbstgenutzt')
    expect(allocationLabel(pos({ allocation: 'direct-rented' }))).toBe('direkt, vermietet')
    expect(allocationLabel(pos({ allocation: 'direct-outside' }))).toBe('direkt, außerhalb der Abrechnungseinheit')
    expect(allocationLabel(pos({ allocation: 'unsplittable' }))).toBe('nicht aufteilbar, Fläche fehlt')
  })

  it('beziffert bei Einheiten außerhalb den Abstand zur Abrechnung (Durchsicht)', () => {
    const r = mixed([pos({ allocation: 'area', privateCents: 100000, deductibleCents: 200000, amountCents: 300000, settlementPrivateCents: 150000 })])
    expect(taxHints(r, 'ist')).toContain('mixedUseExcludedArea')
    expect(excludedAreaDifference(r)).toEqual({ count: 1, differenceCents: 50000, lessPrivateCents: 50000, morePrivateCents: 0 })
    // Beim Personenschlüssel kann die Gebäudefläche mehr privat ergeben als die Abrechnung
    // (eigene 100 m² mit 1 Person, vermietet 50 m² mit 4 Personen, 50 m² außerhalb).
    const mehr = mixed([pos({ allocation: 'area', amountCents: 100000, privateCents: 50000, deductibleCents: 50000, settlementPrivateCents: 20000 })])
    expect(excludedAreaDifference(mehr)).toEqual({ count: 1, differenceCents: 30000, lessPrivateCents: 0, morePrivateCents: 30000 })
    expect(taxHints(mixed([pos({})]), 'ist')).not.toContain('mixedUseExcludedArea')
  })

  // Integrationsdurchsicht vor 0.10: „Nicht umlagefähig“ mit einer Zuordnung aus 0.8.0 oder älter.
  it('nennt „Nicht umlagefähig“-Positionen, die bestimmten Einheiten zugeordnet sind, mit ihrer Wirkung', () => {
    const na = (over: Partial<TaxExpenseItem>) => pos({ category: 'Nicht umlagefähig', group: 'Verwaltung & Instandhaltung', deductiblePercent: null, ...over })
    const r = mixed([
      na({ costItemId: 'a', description: 'Malerarbeiten', allocation: 'direct-self', privateCents: 100000, deductibleCents: 0, taxUnits: [{ unitId: 'EG', unitName: 'EG' }] }),
      na({ costItemId: 'b', description: 'Bad', allocation: 'direct-rented', taxUnits: [{ unitId: 'OG', unitName: 'OG' }] }),
      na({ costItemId: 'c', description: 'Dach Hinterhaus', allocation: 'area', privateCents: 20000, deductibleCents: 80000, taxUnits: [{ unitId: 'OG', unitName: 'OG' }, { unitId: 'DG', unitName: 'DG' }] }),
      na({ costItemId: 'd', description: 'Gebäude', allocation: 'area', taxUnits: null }),
      na({ costItemId: 'f', description: 'Dach Vorderhaus', allocation: 'unsplittable', taxUnits: [{ unitId: 'EG', unitName: 'EG' }, { unitId: 'OG', unitName: 'OG' }] }),
      pos({ costItemId: 'e', allocation: 'direct-rented' }),
    ])
    expect(taxHints(r, 'ist')).toContain('mixedUseAssignedUnits')
    expect(assignedUnitItems(r)).toEqual([
      { costItemId: 'a', description: 'Malerarbeiten', amountCents: 100000, units: ['EG'], effect: 'private' },
      { costItemId: 'b', description: 'Bad', amountCents: 100000, units: ['OG'], effect: 'deductible' },
      { costItemId: 'c', description: 'Dach Hinterhaus', amountCents: 100000, units: ['OG', 'DG'], effect: 'area' },
      // Fehlt eine Fläche, ist die Position ungekürzt abziehbar, nicht nach Fläche (Durchsicht)
      { costItemId: 'f', description: 'Dach Vorderhaus', amountCents: 100000, units: ['EG', 'OG'], effect: 'unsplittable' },
    ])
    // Ohne Zuordnung kein Hinweis, und ohne selbstgenutzte Einheit wirkt sie nicht.
    expect(taxHints(mixed([na({ taxUnits: null })]), 'ist')).not.toContain('mixedUseAssignedUnits')
    const ohneEigene = report({}, { expenses: { groups: [], items: [na({ allocation: 'direct-rented', taxUnits: [{ unitId: 'OG', unitName: 'OG' }] })], totalCents: 100000, privateCents: 0, deductibleCents: 100000, labor35aCents: 0, unstatedCount: 0 } })
    expect(taxHints(ohneEigene, 'ist')).not.toContain('mixedUseAssignedUnits')
  })

  it('meldet Positionen, die nach dem Abschluss erfasst oder geändert wurden (Durchsicht)', () => {
    expect(taxHints(mixed([], { closedItemsChanged: 2 }), 'ist')).toContain('mixedUseClosedItemsChanged')
    expect(taxHints(mixed([]), 'ist')).not.toContain('mixedUseClosedItemsChanged')
  })
})

describe('Steuer über mehrere Abrechnungen (#208)', () => {
  it('ohne Zeitraum gleich dem Kalenderjahr: kein Vergleich, dafür die Quellen', () => {
    const r = { ...report({ prepaymentSettlementCents: null }), settlementPeriods: [{ key: periodKey('2024-05'), label: '2024/2025' }, { key: periodKey('2025-05'), label: '2025/2026' }] }
    expect(prepaymentNote(r)).toBeNull()
    expect(settlementSourcesText(r)).toBe('Die Eigenanteile stammen aus den Abrechnungen 2024/2025 und 2025/2026. Weil kein Abrechnungszeitraum dem Kalenderjahr entspricht, steht hier kein Vergleich der Vorauszahlungen mit einer Abrechnung.')
  })
  it('Kalenderjahr: kein Satz', () => {
    expect(settlementSourcesText({ ...report({}), settlementPeriods: [{ key: periodKey('2025-01'), label: '2025' }] })).toBeNull()
  })
})

describe('Vorrat (Heizung PR 8, N8)', () => {
  it('erklärt den Abstand beim Eigenanteil in beide Richtungen', () => {
    const mit = (cents: number) => report({}, { expenses: { ...report({}).expenses, stockCarrySelfCents: cents } })
    const tail = 'Die Abrechnung rechnet nach Verbrauch, die Steuerübersicht nach Bezahltem.'
    // Durchsicht von #237, M7: mit Richtung.
    expect(stockCarryNote(mit(3333))).toBe(`Der Eigenanteil der Abrechnung ist um ${fmtEuro(3333)} höher als der private Teil hier: Brennstoff aus dem Vorrat, steuerlich bereits 2024 oder früher abgeflossen. ${tail}`)
    expect(stockCarryNote(mit(-500))).toBe(`Der Eigenanteil der Abrechnung ist um ${fmtEuro(500)} niedriger als der private Teil hier: Brennstoff, der im Vorrat bleibt, steuerlich 2025 abgeflossen und erst später verbraucht. ${tail}`)
    expect(stockCarryNote(report({}))).toBeNull()
  })
})

describe('Betriebsstrom der Heizung (#268)', () => {
  const tax = (rest: Partial<TaxReport>) => report({}, rest)
  it('Hinweis nur bei einem Ausgleich ungleich 0', () => {
    expect(taxHints(tax({ operatingPowerBalanceCents: 20000 }), 'ist')).toContain('operatingPowerBalance')
    expect(taxHints(tax({ operatingPowerBalanceCents: -10000 }), 'ist')).toContain('operatingPowerBalance')
    expect(taxHints(tax({}), 'ist')).not.toContain('operatingPowerBalance')
  })
  it('selbst getragen (kept): Betrag, Fundstellen und die Zeile; mit Eigennutzung der Satz zur Auslegung', () => {
    const text = operatingPowerBalanceText(tax({ operatingPowerBalanceCents: 20000, operatingPowerBalanceKind: 'kept' }))
    expect(text).toContain(`Beim Allgemeinstrom ist Betriebsstrom der Heizung abgezogen, ohne dass er in den Heizkosten steht (${fmtEuro(20000)}).`)
    expect(text).toContain('§ 9 Abs. 1 Satz 1, § 11 Abs. 2 Satz 1 EStG')
    expect(text).toContain('„Betriebsstrom der Heizung, selbst getragen“')
    expect(text).not.toContain('Auslegung')
    expect(text).not.toContain('Prüfen Sie')
    expect(operatingPowerBalanceText(tax({ operatingPowerBalanceCents: 20000, operatingPowerBalanceKind: 'kept', selfOccupiedExists: true }))).toContain('beides ist eine Auslegung')
  })
  // Durchsicht S1: Ein Paar über zwei Steuerjahre ist richtig erfasst; kein „selbst“, kein „prüfen“, in beiden Richtungen.
  it('verschiedene Steuerjahre (otherYear): neutral, nichts zu tun', () => {
    for (const c of [20000, -20000]) {
      const text = operatingPowerBalanceText(tax({ operatingPowerBalanceCents: c, operatingPowerBalanceKind: 'otherYear' })) ?? ''
      expect(text).toContain(`Abzug beim Allgemeinstrom und Betriebsstrom in den Heizkosten stehen in verschiedenen Steuerjahren (Ausgleich in diesem Jahr ${fmtEuro(c)}).`)
      expect(text).toContain('„Betriebsstrom der Heizung, Ausgleich“')
      expect(text).toContain('Zu tun ist nichts.')
      expect(text).not.toMatch(/selbst|Prüfen Sie/)
    }
  })
  it('im selben Jahr verschieden hoch (mismatch): ohne Unterstellung, mit „prüfen“', () => {
    const text = operatingPowerBalanceText(tax({ operatingPowerBalanceCents: -10000, operatingPowerBalanceKind: 'mismatch' })) ?? ''
    expect(text).toContain(`Abzug beim Allgemeinstrom und Betriebsstrom in den Heizkosten sind in diesem Steuerjahr verschieden hoch (Ausgleich ${fmtEuro(-10000)}).`)
    expect(text).toContain('„Betriebsstrom der Heizung, Ausgleich“')
    expect(text).toContain('Prüfen Sie in der Abrechnung, ob der Abzug beim Allgemeinstrom zum Betriebsstrom passt.')
    expect(text).not.toMatch(/selbst/)
    expect(operatingPowerBalanceText(tax({}))).toBeNull()
  })
  // Nachprüfung N1: Fehlt die Lage (ältere Antwort), gilt ein neutraler Text ohne „prüfen“.
  it('ohne Lage: neutral, ohne „prüfen“ und ohne „selbst“', () => {
    const text = operatingPowerBalanceText(tax({ operatingPowerBalanceCents: 20000 })) ?? ''
    expect(text).toContain(`(Ausgleich ${fmtEuro(20000)})`)
    expect(text).toContain('„Betriebsstrom der Heizung, Ausgleich“')
    expect(text).not.toMatch(/Prüfen Sie|selbst/)
  })
  // Nachprüfung N2: Neben einem Abzug ohne Verweis gilt „prüfen“ nur dem verknüpften Abzug.
  it('verschieden hoch neben einem Abzug ohne Verweis: der freie Teil ist richtig erfasst', () => {
    const text = operatingPowerBalanceText(tax({ operatingPowerBalanceCents: 15000, operatingPowerBalanceKind: 'mismatch', operatingPowerKeptCents: 5000 })) ?? ''
    expect(text).toContain(`Davon tragen Sie ${fmtEuro(5000)} selbst (Abzug ohne Verweis); dieser Teil ist richtig erfasst.`)
    expect(text).toContain('Prüfen Sie in der Abrechnung, ob der verknüpfte Abzug beim Allgemeinstrom zum Betriebsstrom passt.')
  })
  it('gemischt (mixed): beides benannt, ohne „prüfen“', () => {
    const text = operatingPowerBalanceText(tax({ operatingPowerBalanceCents: 25000, operatingPowerBalanceKind: 'mixed' })) ?? ''
    expect(text).toContain('Abzug ohne Verweis')
    expect(text).toContain('in verschiedenen Steuerjahren')
    expect(text).not.toContain('Prüfen Sie')
  })
  it('nicht eindeutig (R-6) und negativer Allgemeinstrom ohne Kennzeichnung', () => {
    const note = [{ costItemId: 'ab', description: 'Abzug Heizung', amountCents: -20000 }]
    expect(taxHints(tax({ operatingPowerAmbiguous: note }), 'ist')).toContain('operatingPowerAmbiguous')
    expect(taxHints(tax({ unmarkedPowerCredits: note }), 'ist')).toContain('unmarkedPowerCredits')
    expect(taxHints(tax({}), 'ist')).not.toContain('operatingPowerAmbiguous')
    expect(taxHints(tax({}), 'ist')).not.toContain('unmarkedPowerCredits')
  })
})

// ---------- Anlage V, Zeile der Nachzahlungen und Erstattungen (#280, Durchsicht N3) ----------

test('Zeile 21 (Kennzahl 11) nur für die nachgesehenen Jahre 2023 bis 2025, Angehörige Zeile 23', () => {
  for (const year of [2023, 2024, 2025]) {
    expect(settlementLine(year)).toEqual({
      line: 21, code: 11, relativesLine: 23, relativesCode: 12, rentLines: [15, 18], prepaymentLine: 20, relativesRentLine: 19, relativesPrepaymentLine: 22,
    })
  }
  for (const year of [2021, 2022, 2026, 2027]) expect(settlementLine(year)).toBeNull()
})

test('der Betrag der Zeile ist der Saldo: Nachzahlungen minus Erstattungen', () => {
  expect(settlementBalanceCents(report({ settlementBackPaymentsCents: 15000, settlementRefundsCents: 20000 }))).toBe(-5000)
  expect(settlementBalanceCents(report({ settlementBackPaymentsCents: 15000, settlementRefundsCents: 0 }))).toBe(15000)
})

test('Zufluss ohne Abrechnung plus Saldo ergibt den Zufluss (Durchsicht zu #328)', () => {
  // 12 × 800 € Miete, 200 € Guthaben erstattet: Zufluss 9.400 €, ohne Abrechnung 9.600 €, Saldo −200 €.
  const r = report({ paidCents: 940000, settlementBackPaymentsCents: 0, settlementRefundsCents: 20000 })
  expect(paidWithoutSettlementCents(r)).toBe(960000)
  expect(settlementBalanceCents(r)).toBe(-20000)
  expect(paidWithoutSettlementCents(r) + settlementBalanceCents(r)).toBe(r.income.paidCents)
})

// ---------- #255, PR 4: was zwischen den Jahren verschoben ist ----------

// Beispiel B1 aus dem Plan: Grundsteuer 2025 (600,00 €), bezahlt am 20.02.2026, und Versicherung 2026 (1.250,00 €),
// bezahlt am 01.12.2025. Die Felder stehen so da, wie die Steuerübersicht sie liefert.
const shifted = (over: Partial<TaxExpenseItem>): TaxExpenseItem => ({
  costItemId: 'gs25', category: 'Grundsteuer', group: 'Grundsteuer & öffentliche Abgaben', description: 'Grundsteuer 2025',
  amountCents: 60000, privateCents: 0, deductibleCents: 60000, labor35aCents: 0, allocation: 'settlement',
  deductiblePercent: null, areaPrivateCents: null, settlementPrivateCents: null, steps: [], taxUnits: null,
  ...over,
})
const withItems = (items: TaxExpenseItem[], unstatedCount = 0): TaxReport['expenses'] => {
  const total = items.reduce((a, x) => a + x.amountCents, 0)
  return { groups: [], totalCents: total, privateCents: 0, deductibleCents: total, labor35aCents: 0, items, unstatedCount }
}

describe('Steuerübersicht: Verschiebung zwischen den Jahren (#255)', () => {
  it('Fall 1: Abrechnung 2025, bezahlt 2026. Die Übersicht 2026 nennt Herkunft und Grund', () => {
    const gs = shifted({ outflow: { year: 2026, source: 'paid', paidOn: '2026-02-20' }, settlementPeriod: { key: periodKey('2025-01'), label: '2025' } })
    const vers = shifted({ costItemId: 'v26', description: 'Versicherung 2026', category: 'Sach- und Haftpflichtversicherung', amountCents: 125000, outflow: { year: 2026, source: 'period' } })
    const r = report({}, { year: 2026, expenses: withItems([gs, vers], 1) })
    expect(movedInLines(r)).toEqual([{ costItemId: 'gs25', text: `„Grundsteuer 2025“ (${fmtEuro(60000)}), aus Abrechnung 2025, bezahlt am 20.02.2026`, outsideSpan: false }])
    expect(movedInText(gs)).toBe('aus Abrechnung 2025, bezahlt am 20.02.2026')
    expect(movedInText(vers)).toBeNull()
    expect(taxHints(r, 'ist')).toEqual(expect.arrayContaining(['movedIn', 'unstated']))
    expect(taxHints(r, 'ist')).not.toContain('movedOut')
  })

  it('Fall 1, Gegenseite: die Übersicht 2025 nennt, dass die Grundsteuer 2026 steht', () => {
    const r = report({}, { year: 2025, movedOut: [{ costItemId: 'gs25', category: 'Grundsteuer', description: 'Grundsteuer 2025', amountCents: 60000, settlementPeriod: { key: periodKey('2025-01'), label: '2025' }, outflow: { year: 2026, source: 'paid', paidOn: '2026-02-20' } }] })
    expect(movedOutLines(r)).toEqual([{ costItemId: 'gs25', text: `„Grundsteuer 2025“ (${fmtEuro(60000)}), Abrechnung 2025, bezahlt am 20.02.2026: steht in der Steuerübersicht 2026`, outsideSpan: false }])
    expect(taxHints(r, 'ist')).toContain('movedOut')
    expect(taxHints(r, 'ist')).not.toContain('movedIn')
  })

  it('Fall 2: vor Beginn bezahlt. Die Versicherung 2026 steht 2025, die Übersicht 2026 nennt das', () => {
    const v = shifted({ costItemId: 'v26', description: 'Versicherung 2026', amountCents: 125000, outflow: { year: 2025, source: 'paid', paidOn: '2025-12-01' }, settlementPeriod: { key: periodKey('2026-01'), label: '2026' } })
    expect(movedInLines(report({}, { year: 2025, expenses: withItems([v]) })).map((l) => l.text)).toEqual([`„Versicherung 2026“ (${fmtEuro(125000)}), aus Abrechnung 2026, bezahlt am 01.12.2025`])
    const r26 = report({}, { year: 2026, movedOut: [{ costItemId: 'v26', category: 'Sach- und Haftpflichtversicherung', description: 'Versicherung 2026', amountCents: 125000, settlementPeriod: { key: periodKey('2026-01'), label: '2026' }, outflow: { year: 2025, source: 'paid', paidOn: '2025-12-01' } }] })
    expect(movedOutLines(r26).map((l) => l.text)).toEqual([`„Versicherung 2026“ (${fmtEuro(125000)}), Abrechnung 2026, bezahlt am 01.12.2025: steht in der Steuerübersicht 2025`])
  })

  it('nennt den Grund auch ohne Datum: angegebenes Jahr der Zahlung und Abzug beim Betriebsstrom', () => {
    const stated = shifted({ description: 'Wasser 2025/2026', outflow: { year: 2027, source: 'stated' }, settlementPeriod: { key: periodKey('2025-05'), label: '2025/2026' } })
    const bill = shifted({ costItemId: 'ab', description: 'Abzug Betriebsstrom', amountCents: -3000, outflow: { year: 2027, source: 'bill' }, settlementPeriod: { key: periodKey('2025-05'), label: '2025/2026' } })
    expect(movedInText(stated)).toBe('aus Abrechnung 2025/2026, als Jahr der Zahlung 2027 angegeben')
    expect(movedInText(bill)).toBe('aus Abrechnung 2025/2026, fließt mit seiner Stromrechnung 2027 ab')
  })

  it('Durchsicht PR 3, K8: ein Datum außerhalb der üblichen Spanne ist markiert', () => {
    const gs = shifted({ outflow: { year: 2030, source: 'paid', paidOn: '2030-03-01' }, settlementPeriod: { key: periodKey('2025-01'), label: '2025' }, outsideSpan: true })
    expect(movedInLines(report({}, { year: 2030, expenses: withItems([gs]) }))[0]?.outsideSpan).toBe(true)
  })

  it('ohne Angabe ein ruhiger Satz, gezählt vom Server, Einzahl und Mehrzahl, auf beiden Grundlagen', () => {
    expect(unstatedText(report({}))).toBeNull()
    expect(unstatedText(report({}, { expenses: withItems([], 1) }))).toMatch(/^Bei einer Position dieses Jahres ist nicht angegeben, wann sie bezahlt wurde; sie steht im Jahr ihrer Abrechnung\./)
    const drei = report({}, { expenses: withItems([], 3) })
    expect(unstatedText(drei)).toMatch(/^Bei 3 Positionen dieses Jahres ist nicht angegeben, wann sie bezahlt wurden; sie stehen im Jahr ihrer Abrechnung\./)
    expect(unstatedText(drei)).toMatch(/„Bezahlt am \(für die Steuer\)“/)
    expect(taxHints(drei, 'soll')).toContain('unstated')
    expect(taxHints(drei, 'ist')).toContain('unstated')
  })
})

// #96 PR 1 (A4): Hinweise zur Entnahme aus der Erhaltungsrücklage, alle nur Auskunft.
describe('Entnahme Erhaltungsrücklage (#96)', () => {
  const entnahme = (over: Partial<TaxExpenseItem> = {}): TaxExpenseItem => ({
    costItemId: 'e', category: 'Entnahme Erhaltungsrücklage', group: 'Erhaltungsaufwand', description: 'Dachsanierung',
    amountCents: 124000, privateCents: 0, deductibleCents: 124000, labor35aCents: 0,
    allocation: 'area', deductiblePercent: 100, areaPrivateCents: null, settlementPrivateCents: null, taxUnits: null, steps: [],
    ...over,
  })
  const mit = (items: TaxExpenseItem[], year = 2025, rest: Partial<TaxReport> = {}): TaxReport => report({}, {
    year,
    expenses: {
      groups: [{ group: 'Erhaltungsaufwand', amountCents: 124000, labor35aCents: 0, privateCents: 0, deductibleCents: 124000, categories: [] }],
      totalCents: 124000, privateCents: 0, deductibleCents: 124000, labor35aCents: 0, items, unstatedCount: 0,
    },
    ...rest,
  })

  test('A4.1: Zeilen 55/56 nur für unverteilte Positionen, für 2025 mit Nummern', () => {
    const r = mit([entnahme()])
    expect(taxHints(r, 'ist')).toContain('maintenanceLines')
    expect(taxHints(report({}), 'ist')).not.toContain('maintenanceLines')
    // Durchsicht K1: Zeile 56 nur, wenn eine Position verhältnismäßig aufgeteilt ist.
    expect(maintenanceLineText(r)).toEqual({
      unspread: 'Anlage V 2025: Zeile 55. Nicht in die Zeilen 76 bis 78, die gelten „ohne Erhaltungsrücklage“.',
      spread: null,
    })
    expect(maintenanceLineText(mit([entnahme(), entnahme({ costItemId: 'p', privateCents: 62000, deductibleCents: 62000, deductiblePercent: 50 })])).unspread)
      .toBe('Anlage V 2025: Zeile 55, für verhältnismäßig aufgeteilten Aufwand Zeile 56 (Gesamtbetrag und abzugsfähiger Anteil). Nicht in die Zeilen 76 bis 78, die gelten „ohne Erhaltungsrücklage“.')
  })

  test('Durchsicht S2: der Satz zur vermuteten Entnahme nennt die Zeilen nur, wo der Vordruck gelesen ist', () => {
    expect(withdrawalLinesText(2025)).toBe('Entnahmen gehören zu den Erhaltungsaufwendungen (Zeilen 55 bis 72), nicht zu den übrigen nicht umgelegten Kosten.')
    expect(withdrawalLinesText(2023)).toBe('Entnahmen gehören zu den Erhaltungsaufwendungen, nicht zu den übrigen nicht umgelegten Kosten.')
    expect(withdrawalLinesText(2026)).toBe('Entnahmen gehören zu den Erhaltungsaufwendungen, nicht zu den übrigen nicht umgelegten Kosten.')
  })

  test('A4.1 (Durchsicht X7): eine nachgebildete verteilte Position steht in den Zeilen 57 bis 72, nicht in 55/56', () => {
    const r = mit([entnahme(), entnahme({ costItemId: 'v', description: 'Fassade, verteilt' })])
    const text = maintenanceLineText(r, (x) => x.costItemId === 'v')
    expect(text.spread).toBe('Verteilter Erhaltungsaufwand: siehe Zeilen 57 bis 72.')
    expect(text.unspread).toMatch(/^Anlage V 2025: Zeile 55/)
    expect(maintenanceLineText(mit([entnahme({ costItemId: 'v' })]), () => true)).toEqual({ unspread: null, spread: 'Verteilter Erhaltungsaufwand: siehe Zeilen 57 bis 72.' })
  })

  test('A4.1: Jahre ohne belegten Vordruck ohne Nummer', () => {
    expect(maintenanceLineText(mit([entnahme()], 2026))).toEqual({
      unspread: 'Anlage V 2026: bei den Erhaltungsaufwendungen, einschließlich Entnahmen aus der Erhaltungsrücklage; die Zeile sehen Sie bitte im Vordruck für 2026 nach.',
      spread: null,
    })
  })

  test('A4.2 und A4.3: Hinweise nur mit Treffer', () => {
    expect(taxHints(report({}, { reserveWithdrawalSuspects: [{ costItemId: 'a', description: 'Entnahme Rücklage', amountCents: 1 }] }), 'ist')).toContain('reserveWithdrawalSuspected')
    expect(taxHints(report({}, { specialLevySuspects: [{ costItemId: 'a', description: 'Sonderumlage', amountCents: 1, category: 'Nicht umlagefähig' }] }), 'ist')).toContain('specialLevy')
    expect(taxHints(report({}), 'ist')).not.toContain('reserveWithdrawalSuspected')
    expect(taxHints(report({}), 'ist')).not.toContain('specialLevy')
    expect(withdrawalSuspectDated(report({}, { reserveWithdrawalSuspects: [{ costItemId: 'a', description: 'x', amountCents: 1 }] }))).toBe(false)
    expect(withdrawalSuspectDated(report({}, { reserveWithdrawalSuspects: [{ costItemId: 'a', description: 'x', amountCents: 1, paidOn: '2025-03-01' }] }))).toBe(true)
  })

  test('A4.5: Nutzungswechsel mit Entnahme bekommt den Satz zum Tag der Ausgabe', () => {
    expect(usageChangeTouchesWithdrawal(mit([entnahme()], 2025, { usageChangedUnits: ['EG'] }))).toBe(true)
    expect(usageChangeTouchesWithdrawal(mit([entnahme()]))).toBe(false)
    expect(usageChangeTouchesWithdrawal(report({}, { usageChangedUnits: ['EG'] }))).toBe(false)
  })

  test('A4.6: der Satz zum Hausgeld bei einer Eigentumswohnung nennt die Entnahme', () => {
    expect(taxHints(report({}), 'ist', 'etw')).toContain('etwHousingMoney')
    expect(ETW_WITHDRAWAL_TEXT).toBe('Entnahmen aus der Erhaltungsrücklage zählen abweichend im Jahr, in dem die Gemeinschaft sie ausgibt, also nach der Hausgeldabrechnung dieses Jahres; die Zuführung, die in den gezahlten Vorschüssen steckt, ziehen Sie ab.')
  })
})

// ---------- Kopf der Anlage V (#96 PR 2, Entwurf B1, B3, A4.4) ----------

describe('Kopf der Anlage V (#96 PR 2)', () => {
  const objekt: TaxHeaderProperty = { groundTaxFileNumber: '2141/123/45678', purchaseContractOn: '2023-05-10', ownershipTransferOn: '2023-07-01', buildingApplicationOn: null, completedOn: null }

  test('2025: Zeilen 6, 7 und 10 mit Nummer, Aktenzeichen ohne Sonderzeichen, Fehlendes „nicht eingetragen“', () => {
    const rows = headerRows(report({}), objekt, 2025)
    expect(rows.map((r) => [r.key, r.line])).toEqual([
      ['groundTaxFile', 6], ['purchaseContract', 7], ['ownershipTransfer', 7], ['buildingApplication', 7], ['completed', 7], ['relatives', 10],
    ])
    expect(rows[0]?.value).toBe('214112345678')
    expect(rows.find((r) => r.key === 'ownershipTransfer')?.value).toBe('01.07.2023')
    expect(rows.find((r) => r.key === 'completed')?.value).toBeNull()
    expect(rows.find((r) => r.key === 'relatives')).toMatchObject({ value: '2 = Nein', code: 62 })
  })

  test('Kennzahl 62: „1 = Ja“, sobald ein Mietverhältnis des Jahres an Angehörige vermietet ist', () => {
    const r = report({}, { costModels: { tenancies: 2, inclusive: 0, partlyInclusive: 0, flatRate: 0, relativeTenancies: 1 } })
    expect(headerRows(r, objekt, 2025).find((x) => x.key === 'relatives')?.value).toBe('1 = Ja')
  })

  test('2024: nur Zeile 6 mit Nummer, Zeile 7 fragt der Vordruck noch nicht; 2026 ohne Nummern', () => {
    const r24 = headerRows(report({}, { year: 2024 }), objekt, 2024)
    expect(r24.map((r) => [r.key, r.line])).toEqual([['groundTaxFile', 6], ['relatives', null]])
    expect(r24.find((r) => r.key === 'relatives')?.code).toBeUndefined()
    const r26 = headerRows(report({}, { year: 2026 }), null, 2026)
    expect(r26.map((r) => r.line)).toEqual([null, null, null, null, null, null])
    expect(r26[0]?.value).toBeNull()
  })

  // A4.4 (Durchsicht X6): der gemeinsame Hinweis zu anschaffungsnahen Herstellungskosten, § 6 Abs. 1 Nr. 1a EStG.
  const instand = (over: Partial<TaxExpenseItem> = {}): TaxExpenseItem => ({
    costItemId: 'i', category: 'Nicht umlagefähig', group: 'Verwaltung & Instandhaltung', description: 'Bad', amountCents: 500000,
    privateCents: 0, deductibleCents: 500000, labor35aCents: 0, allocation: 'area', deductiblePercent: 100, areaPrivateCents: null,
    settlementPrivateCents: null, taxUnits: null, steps: [], ...over,
  })
  const mit = (year: number, items: TaxExpenseItem[] = [instand()]) => report({}, {
    year, expenses: { groups: [], totalCents: 0, privateCents: 0, deductibleCents: 0, labor35aCents: 0, items, unstatedCount: 0 },
  })

  test('Frist nach §§ 187 Abs. 1, 188 Abs. 2 BGB: sie endet am Tag gleicher Zahl drei Jahre nach dem Übergang (K1)', () => {
    // BMF-Schreiben vom 26.01.2026, Rn. 62: taggenau ab dem Übergang; über § 108 AO §§ 187 Abs. 1, 188 Abs. 2 BGB. Der Tag
    // des Übergangs zählt nicht mit, die Frist endet mit dem Tag, der durch seine Zahl dem Übergang entspricht.
    expect(acquisitionRelated(mit(2026), { ownershipTransferOn: '2023-07-01' })).toMatchObject({ from: '2023-07-01', until: '2026-07-01', basis: 'transfer' })
    expect(acquisitionRelated(mit(2025), { ownershipTransferOn: '2022-01-02' })).toMatchObject({ until: '2025-01-02' })
    // Früher endete die Frist am 31.12.2024, und 2025 hatte keinen Hinweis; nach § 188 Abs. 2 BGB endet sie am 01.01.2025.
    expect(acquisitionRelated(mit(2025), { ownershipTransferOn: '2022-01-01' })).toMatchObject({ until: '2025-01-01' })
    expect(acquisitionRelated(mit(2022), { ownershipTransferOn: '2022-12-31' })).not.toBeNull()
    expect(acquisitionRelated(mit(2021), { ownershipTransferOn: '2022-01-02' })).toBeNull()
    // Schaltjahr: Fehlt der 29.02. im letzten Monat, endet die Frist mit dessen letztem Tag (§ 188 Abs. 3 BGB).
    expect(acquisitionRelated(mit(2023), { ownershipTransferOn: '2020-02-29' })).toMatchObject({ until: '2023-02-28' })
    expect(taxHints(mit(2025), 'ist', 'mfh', { ownershipTransferOn: '2023-07-01' })).toContain('acquisitionRelated')
  })

  test('auch im Kalenderjahr nach dem Fristende: später bezahlte Arbeiten zählen mit (S1, BMF 26.01.2026 Rn. 63)', () => {
    expect(acquisitionRelated(mit(2026), { ownershipTransferOn: '2022-07-01' })).toMatchObject({ until: '2025-07-01' })
    expect(acquisitionRelated(mit(2027), { ownershipTransferOn: '2022-07-01' })).toBeNull()
    expect(acquisitionRelated(mit(2026), { ownershipTransferOn: '2022-01-01' })).not.toBeNull()
    expect(acquisitionRelated(mit(2027), { ownershipTransferOn: '2022-01-01' })).toBeNull()
  })

  test('nur der Kaufvertrag: das Ende großzügig ein Jahr länger, der Übergang geht vor (S2, BMF 26.01.2026 Rn. 62)', () => {
    // Maßgeblich ist allein der Übergang, und er liegt nach dem Kaufvertrag. Aus dem Kaufvertrag gerechnet endete der
    // Hinweis zu früh; deshalb vier statt drei Jahre.
    expect(acquisitionRelated(mit(2026), { purchaseContractOn: '2022-12-15' })).toMatchObject({ from: '2022-12-15', until: '2026-12-15', basis: 'contract' })
    expect(acquisitionRelated(mit(2027), { purchaseContractOn: '2022-12-15' })).not.toBeNull()
    expect(acquisitionRelated(mit(2028), { purchaseContractOn: '2022-12-15' })).toBeNull()
    expect(acquisitionRelated(mit(2025), { purchaseContractOn: '2020-05-10', ownershipTransferOn: '2023-07-01' })).toMatchObject({ basis: 'transfer', until: '2026-07-01' })
  })

  test('nur mit abziehbarem Erhaltungsaufwand oder Instandhaltung; ohne Datum nicht, außer eine Verteilung beginnt (taxSpread.test.ts)', () => {
    expect(acquisitionRelated(mit(2025, []), { ownershipTransferOn: '2023-07-01' })).toBeNull()
    expect(acquisitionRelated(mit(2025, [instand({ group: 'Grundsteuer & öffentliche Abgaben', category: 'Grundsteuer' })]), { ownershipTransferOn: '2023-07-01' })).toBeNull()
    expect(acquisitionRelated(mit(2025, [instand({ deductibleCents: 0, privateCents: 500000 })]), { ownershipTransferOn: '2023-07-01' })).toBeNull()
    expect(acquisitionRelated(mit(2025, [instand({ group: 'Erhaltungsaufwand', category: 'Entnahme Erhaltungsrücklage' })]), { ownershipTransferOn: '2023-07-01' })).not.toBeNull()
    expect(acquisitionRelated(mit(2025), {})).toBeNull()
    expect(acquisitionRelated(mit(2025), null)).toBeNull()
    expect(taxHints(mit(2025), 'ist', 'mfh')).not.toContain('acquisitionRelated')
  })

  test('der Text nennt die Grenze, die Frist mit Datum, später Bezahltes und dass Mietfuchs die Anschaffungskosten nicht kennt', () => {
    const info = acquisitionRelated(mit(2026), { ownershipTransferOn: '2023-07-01' }) ?? expect.unreachable('kein Hinweis')
    const t = acquisitionRelatedText(info)
    expect(t).toMatch(/15 % der Anschaffungskosten des Gebäudes/)
    expect(t).toMatch(/ohne Umsatzsteuer/)
    expect(t).toMatch(/nach dem Eigentumsübergang am 01\.07\.2023 \(bis 01\.07\.2026\)/)
    expect(t).toMatch(/Arbeiten, die bis 01\.07\.2026 ausgeführt wurden, zählen mit, auch wenn sie später bezahlt sind\./)
    expect(t).toMatch(/kennt die Anschaffungskosten nicht/)
    expect(ACQUISITION_RELATED_MORE).toMatch(/BMF-Schreiben vom 26\.01\.2026, IV C 1 - S 2253\/00082\/001\/064, Rn\. 54, 62 und 63/)
  })

  test('nur der Kaufvertrag: der Text sagt, dass der Übergang maßgeblich ist und das Ende großzügig gerechnet', () => {
    const info = acquisitionRelated(mit(2025), { purchaseContractOn: '2023-05-10' }) ?? expect.unreachable('kein Hinweis')
    const t = acquisitionRelatedText(info)
    expect(t).toMatch(/Besitz, Nutzen und Lasten.*Kaufvertrag vom 10\.05\.2023/s)
    expect(t).toMatch(/bis 10\.05\.2027, ein Jahr länger/)
    expect(t).toMatch(/Eigentumsübergang ein/)
  })
})

// Durchsicht von #312 PR 3, K4: Die Hinweise zum Mietmodell nennen Zeilen nur aus `anlageVLines`, sonst ohne Nummer.
describe('Hinweise zu Inklusivmiete und Pauschale: Zeilen nur aus anlageVLines (K4)', () => {
  test('2025: Zeile 24, Zeilen 20 und 21, Zeile 20', () => {
    const t = costModelLineTexts(2025)
    expect(t.inclusiveTitle).toBe('Zeile 24 der Anlage V.')
    expect(t.inclusiveAction).toBe('Tragen Sie dort eine 1 ein; die ganze Miete gehört dann zu den Mieteinnahmen, und für diese Mietverhältnisse sind keine Umlagen in den Zeilen 20 und 21 einzutragen.')
    expect(t.flatRateTitle).toBe('Zeile 20 der Anlage V.')
    expect(t.flatRateMore).toBe('Nach dem Wortlaut gehört sie zu den laufend vereinnahmten Umlagen in Zeile 20; ausdrücklich nennt die Anleitung die Pauschale nicht.')
  })
  test('2026 (Vordruck nicht gelesen): keine Nummer', () => {
    const t = costModelLineTexts(2026)
    for (const v of Object.values(t)) expect(v).not.toMatch(/Zeilen? \d/)
    expect(t.inclusiveTitle).toBe('Anlage V: Nebenkosten nicht gesondert vereinbart.')
    expect(t.inclusiveAction).toBe('Tragen Sie dort eine 1 ein; die ganze Miete gehört dann zu den Mieteinnahmen, und für diese Mietverhältnisse sind keine Umlagen und keine Nachzahlungen oder Erstattungen aus der Abrechnung einzutragen.')
    expect(t.flatRateTitle).toBe('Anlage V: laufende Umlagen.')
  })
  test('2023: Zeile 24 nicht gelesen, Zeilen 20 und 21 schon', () => {
    const t = costModelLineTexts(2023)
    expect(t.inclusiveTitle).toBe('Anlage V: Nebenkosten nicht gesondert vereinbart.')
    expect(t.inclusiveAction).toMatch(/in den Zeilen 20 und 21 einzutragen/)
    expect(t.flatRateTitle).toBe('Zeile 20 der Anlage V.')
  })
})

import { describe, expect, it } from 'vitest'
import type { TaxExpenseItem, TaxReport } from './types'
import { allocationLabel, assignedUnitItems, DEFAULT_BASIS, excludedAreaDifference, incomeCentsFor, keyNotAreaDifference, prepaymentNote, showsSplit, surplusCentsFor, taxHints } from './taxView'

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
    tenanciesWithSoll: 1,
    tenanciesWithoutPayment: 0,
    ...income,
  },
  expenses: { groups: [], totalCents: 0, privateCents: 0, deductibleCents: 0, labor35aCents: 0, items: [] },
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

  it('nennt den Vorbehalt zum Jahreswechsel auf der Ist-Grundlage', () => {
    // Er stand als Bedingung in der Seite und war damit ungeprüft, obwohl der CHANGELOG ihn als
    // eigenes Verhalten führt.
    expect(taxHints(report({}), 'ist')).toContain('turnOfYear')
    expect(taxHints(report({}), 'soll')).not.toContain('turnOfYear')
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
    expect(note).toEqual({ settlementCents: 240000, sollCents: 480000, jahreskorrektur: false })
  })

  it('schweigt, wenn eine Jahreskorrektur zufällig dem Soll entspricht', () => {
    // Die Gegenrichtung desselben Fehlers: Ein Hinweis, der einen Unterschied erklärt, den es
    // nicht gibt, ist schlimmer als keiner.
    expect(prepaymentNote(report({ prepaymentOverridden: true }))).toBeNull()
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
      groups: [], items, totalCents: items.reduce((a, x) => a + x.amountCents, 0),
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
    const ohneEigene = report({}, { expenses: { groups: [], items: [na({ allocation: 'direct-rented', taxUnits: [{ unitId: 'OG', unitName: 'OG' }] })], totalCents: 100000, privateCents: 0, deductibleCents: 100000, labor35aCents: 0 } })
    expect(taxHints(ohneEigene, 'ist')).not.toContain('mixedUseAssignedUnits')
  })

  it('meldet Positionen, die nach dem Abschluss erfasst oder geändert wurden (Durchsicht)', () => {
    expect(taxHints(mixed([], { closedItemsChanged: 2 }), 'ist')).toContain('mixedUseClosedItemsChanged')
    expect(taxHints(mixed([]), 'ist')).not.toContain('mixedUseClosedItemsChanged')
  })
})

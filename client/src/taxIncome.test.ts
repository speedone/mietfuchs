// Die Einnahmentabelle der Steuerübersicht nach Zeilen der Anlage V (#312 PR 3) und die Sätze ihrer Hinweise.
import { describe, expect, test } from 'vitest'
import type { TaxReceived, TaxReceivedTenancy, TaxReport } from './types'
import { formerYearsText, incomeTable, lateDecemberText, oldLeaseForwardText, possibleDepositText, turnOfYearLines, unallocatedText, unitRows } from './taxIncome'
import { incomeCentsFor, surplusCentsFor, taxHints } from './taxView'
import { fmtEuro } from './api'

const tenancy = (over: Partial<TaxReceivedTenancy> = {}): TaxReceivedTenancy => ({
  tenancyId: 't1', unitId: 'u1', tenantName: 'Meyer', unitName: 'EG', start: '2020-01-01', end: null, relative: false,
  rentCents: 0, inclusiveRentCents: 0, allocationsCents: 0, settlementCents: 0, formerYearsCents: 0, unallocatedCents: 0, forwardCents: 0,
  ...over,
})

// Das Zugeflossene; die Summen aus `byTenancy` wie in calc.ts (`receivedIncome`).
const received = (byTenancy: TaxReceivedTenancy[], over: Partial<TaxReceived> = {}): TaxReceived => {
  const sum = (f: (t: TaxReceivedTenancy) => number, only: (t: TaxReceivedTenancy) => boolean = () => true) => byTenancy.filter(only).reduce((a, t) => a + f(t), 0)
  return {
    rentCents: sum((t) => t.rentCents), inclusiveRentCents: sum((t) => t.inclusiveRentCents), unallocatedCents: sum((t) => t.unallocatedCents),
    allocationsCents: sum((t) => t.allocationsCents), flatRateCents: 0, formerYearsCents: sum((t) => t.formerYearsCents), formerYearsAllocationsCents: 0,
    turnOfYear: { forwardCents: sum((t) => t.forwardCents), forwardAllocationsCents: 0, fromPreviousCents: 0, fromPreviousAllocationsCents: 0, forwardOldLeaseCents: 0, lateDecemberCents: 0 },
    byUnit: [], byTenancy,
    relatives: { rentCents: sum((t) => t.rentCents, (t) => t.relative), allocationsCents: sum((t) => t.allocationsCents, (t) => t.relative), settlementCents: sum((t) => t.settlementCents, (t) => t.relative) },
    possibleDeposits: [],
    ...over,
  }
}

const report = (income: Partial<TaxReport['income']>, rest: Partial<TaxReport> = {}): TaxReport => ({
  year: 2025,
  income: {
    baseRentSollCents: 960000, inclusiveRentSollCents: 0, prepaymentSollCents: 240000, flatRateSollCents: 0,
    prepaymentSettlementCents: 240000, prepaymentOverridden: false, sollCents: 1200000, paidCents: 1200000,
    settlementBackPaymentsCents: 0, settlementRefundsCents: 0, tenanciesWithSoll: 1, tenanciesWithoutPayment: 0,
    ...income,
  },
  expenses: { groups: [], totalCents: 0, privateCents: 0, deductibleCents: 0, labor35aCents: 0, items: [], unstatedCount: 0 },
  movedOut: [], selfUseChangedInYear: false, closedSelfUseDiffers: false, closedItemsChanged: 0, reserveContributionCents: 0, reserveSuspects: [],
  totalAreaM2: 100, selfUsedAreaM2: 0, selfOccupiedExists: false, excludedExists: false, selfUsedShareCents: 0,
  surplusSollCents: 1200000, surplusPaidCents: 1200000,
  costModels: { tenancies: 1, inclusive: 0, partlyInclusive: 0, flatRate: 0 }, settlementPeriods: [],
  ...rest,
})

const row = (t: ReturnType<typeof incomeTable>, key: string) => t.rows.find((r) => r.key === key)

describe('incomeTable: Zeilen der Anlage V aus `received` (#312 PR 3)', () => {
  // Das Beispiel des Issues: 12 × 800 € (600 Kalt, 200 Vorauszahlung) und 150 € Nachzahlung aus der Abrechnung.
  const pünktlich = report({ paidCents: 975000, settlementBackPaymentsCents: 15000, received: received([tenancy({ rentCents: 720000, allocationsCents: 240000, settlementCents: 15000 })]) },
    { costModels: { tenancies: 1, inclusive: 0, partlyInclusive: 0, flatRate: 0 } })

  test('ohne Angehörige: 15/18, 20, 21; Summe = Zeile 32 = paidCents', () => {
    const t = incomeTable(pünktlich)
    expect(t.rows.filter((r) => !r.sub).map((r) => [r.key, r.line, r.paidCents, r.sollCents])).toEqual([
      ['homes', '15, 18', 720000, 960000],
      ['allocations', '20', 240000, 240000],
      ['settlement', '21', 15000, null],
    ])
    expect(row(t, 'homes')?.code).toBe('01, 02')
    expect(row(t, 'settlement')?.code).toBe('11')
    expect(t.paidTotalCents).toBe(975000)
    expect(t.sollTotalCents).toBe(1200000)
    expect(t.totalLine).toBe(32)
    expect(t.showsLines).toBe(true)
  })

  test('Zeilen mit 0 € in beiden Spalten entfallen, außer 15/18 und 20', () => {
    const t = incomeTable(report({ paidCents: 0, sollCents: 0, baseRentSollCents: 0, prepaymentSollCents: 0, received: received([]) }))
    expect(t.rows.map((r) => r.key)).toEqual(['homes', 'allocations'])
  })

  test('Inklusivmiete, Überzahlung, Pauschale, frühere Jahre: je mit „davon“', () => {
    const r = received([tenancy({ rentCents: 860000, inclusiveRentCents: 600000, unallocatedCents: 20000, allocationsCents: 120000, formerYearsCents: 80000 })],
      { flatRateCents: 60000, formerYearsAllocationsCents: 20000 })
    const t = incomeTable(report({ paidCents: 1060000, inclusiveRentSollCents: 600000, flatRateSollCents: 60000, received: r }))
    expect(t.rows.map((x) => [x.key, x.sub, x.paidCents, x.sollCents])).toEqual([
      ['homes', false, 860000, 960000],
      ['inclusive', true, 600000, 600000],
      ['unallocated', true, 20000, null],
      ['allocations', false, 120000, 300000],
      ['flatRate', true, 60000, 60000],
      ['formerYears', false, 80000, null],
      ['formerYearsAllocations', true, 20000, null],
    ])
    expect(row(t, 'formerYears')?.line).toBe('25')
    expect(row(t, 'formerYears')?.code).toBe('06')
    expect(t.paidTotalCents).toBe(1060000)
  })

  test('mit Angehörigen: dazu 19, 22, 23; 15/18, 20 und 21 zeigen den Rest; Summe bleibt', () => {
    const r = received([
      tenancy({ rentCents: 720000, allocationsCents: 240000, settlementCents: -5000 }),
      tenancy({ tenancyId: 't2', unitId: 'u2', unitName: 'OG', tenantName: 'Tochter', relative: true, rentCents: 360000, allocationsCents: 120000, settlementCents: 3000 }),
    ])
    const t = incomeTable(report({ paidCents: 1438000, settlementBackPaymentsCents: 3000, settlementRefundsCents: 5000, received: r }, { costModels: { tenancies: 2, inclusive: 0, partlyInclusive: 0, flatRate: 0, relativeTenancies: 1 } }))
    expect(t.rows.map((x) => [x.key, x.line, x.paidCents])).toEqual([
      ['homes', '15, 18', 720000],
      ['relatives', '19', 360000],
      ['allocations', '20', 240000],
      ['settlement', '21', -5000],
      ['relativesAllocations', '22', 120000],
      ['relativesSettlement', '23', 3000],
    ])
    // Das Soll kennt Mietfuchs nicht je Mietverhältnis: 15/18 und 20 tragen es zusammen mit 19 und 22, mit Vermerk.
    expect(row(t, 'homes')?.sollNote).toBe('einschließlich Zeile 19')
    expect(row(t, 'allocations')?.sollNote).toBe('einschließlich Zeile 22')
    expect(row(t, 'relatives')?.sollCents).toBeNull()
    expect(t.paidTotalCents).toBe(1438000)
  })

  test('Inklusivmiete einer Angehörigen zählt nicht unter „davon“ bei 15/18', () => {
    const r = received([
      tenancy({ rentCents: 500000, inclusiveRentCents: 100000 }),
      tenancy({ tenancyId: 't2', relative: true, rentCents: 300000, inclusiveRentCents: 300000 }),
    ])
    const t = incomeTable(report({ paidCents: 800000, inclusiveRentSollCents: 400000, received: r }, { costModels: { tenancies: 2, inclusive: 1, partlyInclusive: 1, flatRate: 0, relativeTenancies: 1 } }))
    expect(row(t, 'inclusive')?.paidCents).toBe(100000)
  })

  test('Zehn-Tage-Regel: die Summe ist paidCents − forward + fromPrevious, und Ist-Einnahmen und Überschuss folgen ihr', () => {
    const r = received([tenancy({ rentCents: 720000, allocationsCents: 240000, forwardCents: 80000 })])
    r.turnOfYear.fromPreviousCents = 80000
    r.turnOfYear.forwardCents = 70000
    // 960.000 in den Zeilen; nach Datum kamen 960.000 − 80.000 (aus dem Vorjahr) + 70.000 (für das Folgejahr) herein.
    const rep = report({ paidCents: 950000, received: r }, { surplusPaidCents: 950000 - 100000, expenses: { groups: [], totalCents: 100000, privateCents: 0, deductibleCents: 100000, labor35aCents: 0, items: [], unstatedCount: 0 } })
    expect(incomeTable(rep).paidTotalCents).toBe(960000)
    expect(incomeCentsFor(rep, 'ist')).toBe(960000)
    expect(surplusCentsFor(rep, 'ist')).toBe(860000)
    expect(incomeCentsFor(rep, 'soll')).toBe(1200000)
  })

  test('Jahr ohne gelesenen Vordruck: keine Nummer, keine Spalte „Zeile“', () => {
    const t = incomeTable({ ...pünktlich, year: 2026 })
    expect(t.showsLines).toBe(false)
    expect(t.rows.every((r) => r.line === null)).toBe(true)
    expect(t.totalLine).toBeNull()
  })

  test('2023: Zeile 25 noch nicht gelesen, ohne Nummer; die übrigen mit', () => {
    const r = received([tenancy({ rentCents: 720000, allocationsCents: 240000, formerYearsCents: 80000 })])
    const t = incomeTable({ ...report({ paidCents: 1040000, received: r }), year: 2023 })
    expect(row(t, 'homes')?.line).toBe('15, 18')
    expect(row(t, 'formerYears')?.line).toBeNull()
    expect(t.totalLine).toBeNull()
  })

  test('ohne `received` (Rückgriff): Ist je Zeile unbekannt, die Summe ist der Zufluss nach Datum', () => {
    const t = incomeTable(report({ paidCents: 940000, settlementRefundsCents: 20000 }))
    expect(row(t, 'homes')?.paidCents).toBeNull()
    expect(row(t, 'settlement')?.paidCents).toBe(-20000)
    expect(t.paidTotalCents).toBe(940000)
  })
})

describe('unitRows: je Wohnung für die Zeilen 13 und 14', () => {
  test('Bezeichnung, Fläche, Miete ohne Umlagen; Wohnungen an Angehörige vermerkt', () => {
    const r = received([tenancy(), tenancy({ tenancyId: 't2', unitId: 'u2', relative: true })], {
      byUnit: [
        { unitId: 'u1', unitName: 'EG', areaM2: 80, rentCents: 720000, allocationsCents: 240000, settlementCents: 0, formerYearsCents: 0 },
        { unitId: 'u2', unitName: 'OG', areaM2: null, rentCents: 360000, allocationsCents: 0, settlementCents: 0, formerYearsCents: 0 },
      ],
    })
    expect(unitRows(report({ received: r }))).toEqual([
      { unitId: 'u1', unitName: 'EG', areaM2: 80, rentCents: 720000, relative: false },
      { unitId: 'u2', unitName: 'OG', areaM2: null, rentCents: 360000, relative: true },
    ])
  })
})

describe('Hinweise zum Zugeflossenen (#312 PR 3)', () => {
  const withReceived = (over: Partial<TaxReceived>, turn: Partial<TaxReceived['turnOfYear']> = {}) => {
    const r = received([tenancy({ rentCents: 720000, allocationsCents: 240000 })], over)
    r.turnOfYear = { ...r.turnOfYear, ...turn }
    return report({ paidCents: 960000, received: r })
  }

  test('Zehn-Tage-Regel nur mit Betrag, nicht mehr bei jedem Bericht', () => {
    expect(taxHints(withReceived({}), 'ist')).not.toContain('turnOfYear')
    expect(taxHints(report({}), 'ist')).not.toContain('turnOfYear')
    expect(taxHints(withReceived({}, { forwardCents: 80000 }), 'ist')).toContain('turnOfYear')
    expect(taxHints(withReceived({}, { fromPreviousCents: 80000 }), 'ist')).toContain('turnOfYear')
    expect(taxHints(withReceived({}, { forwardCents: 80000 }), 'soll')).not.toContain('turnOfYear')
  })

  test('vorwärts: zählt im Folgejahr und steht dort; aus dem Vorjahr: je Zeile', () => {
    const forward = turnOfYearLines(withReceived({}, { forwardCents: 80000, forwardAllocationsCents: 20000 }))
    expect(forward).toEqual([`${fmtEuro(80000)} Januarmiete sind Ende Dezember 2025 eingegangen; sie zählen nach § 11 Abs. 1 Satz 2 EStG im Jahr 2026 und stehen dort.`])
    const previous = turnOfYearLines(withReceived({}, { fromPreviousCents: 80000, fromPreviousAllocationsCents: 20000 }))
    expect(previous).toEqual([`${fmtEuro(80000)} Januarmiete aus dem Dezember 2024 stehen nach § 11 Abs. 1 Satz 2 EStG in diesem Jahr: ${fmtEuro(60000)} in Zeile 15/18 und ${fmtEuro(20000)} in Zeile 20.`])
    // Nie ins alte Jahr: kein Satz legt eine Verschiebung zurück nahe.
    for (const s of [...forward, ...previous]) expect(s).not.toMatch(/gehör\w* (zu|ins Jahr) 2024/)
  })

  test('aus dem Vorjahr ohne gelesenen Vordruck oder mit Angehörigen: Beträge ohne Zeilennummer', () => {
    const rep = withReceived({}, { fromPreviousCents: 80000, fromPreviousAllocationsCents: 20000 })
    expect(turnOfYearLines({ ...rep, year: 2026 })[0]).toBe(`${fmtEuro(80000)} Januarmiete aus dem Dezember 2025 stehen nach § 11 Abs. 1 Satz 2 EStG in diesem Jahr, davon ${fmtEuro(20000)} Umlagen.`)
    expect(turnOfYearLines({ ...rep, costModels: { ...rep.costModels, relativeTenancies: 1 } })[0]).toMatch(/in diesem Jahr, davon 200,00\s€ Umlagen\.$/)
  })

  test('Altvertrag vorwärts: Vorbehalt mit Datum und Tagen aus dem Register', () => {
    const rep = withReceived({}, { forwardOldLeaseCents: 80000 })
    expect(taxHints(rep, 'ist')).toContain('turnOfYearOldLease')
    expect(oldLeaseForwardText(rep)).toBe(`${fmtEuro(80000)} Januarmiete sind Ende Dezember eingegangen, aus einem Mietverhältnis, das schon am 01.09.2001 bestand. Ohne andere Vereinbarung ist die Miete dort am Monatsende fällig, die Januarmiete also nicht in den 10 Tagen um den Jahreswechsel; Mietfuchs lässt den Betrag deshalb im Jahr der Zahlung. Ist laut Vertrag zu Beginn des Monats zu zahlen, gehört er ins Jahr 2026.`)
    expect(taxHints(withReceived({}), 'ist')).not.toContain('turnOfYearOldLease')
  })

  test('rückwärts nur beim Altvertrag: ein ruhiger Satz, kein Titel „gehören zu“', () => {
    const rep = withReceived({}, { lateDecemberCents: 80000 })
    expect(taxHints(rep, 'ist')).toContain('lateDecember')
    expect(lateDecemberText(rep)).toBe(`${fmtEuro(80000)} Dezembermiete sind Anfang Januar eingegangen und stehen in diesem Jahr. Nur wenn die Miete laut Vertrag am Monatsende fällig ist, gehören sie ins Jahr 2024.`)
    expect(taxHints(withReceived({}), 'ist')).not.toContain('lateDecember')
  })

  test('ohne vereinbarte Miete: Betrag und Mietkonto; eine Rückzahlung mit eigenem Satz', () => {
    const rep = withReceived({ unallocatedCents: 20000 })
    expect(taxHints(rep, 'ist')).toContain('unallocatedPayment')
    expect(unallocatedText(rep)).toBe(`${fmtEuro(20000)} sind ohne vereinbarte Miete eingegangen.`)
    expect(unallocatedText(withReceived({ unallocatedCents: -20000 }))).toBe(`${fmtEuro(20000)} sind ohne vereinbarte Miete zurückgezahlt worden.`)
    expect(taxHints(withReceived({}), 'ist')).not.toContain('unallocatedPayment')
  })

  test('mögliche Kaution: Datum, Betrag, Mieter', () => {
    const rep = withReceived({ possibleDeposits: [{ tenancyId: 't1', tenantName: 'Meyer', paidOn: '2025-03-05', cents: 240000 }] })
    expect(taxHints(rep, 'ist')).toContain('possibleDeposit')
    expect(possibleDepositText(rep)).toBe(`Zahlung vom 05.03.2025 über ${fmtEuro(240000)} (Meyer)`)
    expect(taxHints(withReceived({}), 'ist')).not.toContain('possibleDeposit')
  })

  test('frühere Jahre: Zeile 25 und § 366; negativ der Satz zur Rücklastschrift', () => {
    const rep = withReceived({ formerYearsCents: 80000, formerYearsAllocationsCents: 20000 })
    expect(taxHints(rep, 'ist')).toContain('formerYears')
    expect(formerYearsText(rep)).toBe(`${fmtEuro(80000)} Miete für frühere Jahre sind 2025 eingegangen (Zeile 25, darin ${fmtEuro(20000)} Umlagen). Bestimmt der Mieter nichts, tilgt eine Zahlung zuerst offene Beträge früherer Monate (§ 366 Abs. 2 BGB). Hat er einen Monat genannt, tragen Sie ihn im Mietkonto an der Zahlung unter „Für Monat“ ein.`)
    expect(formerYearsText(withReceived({ formerYearsCents: -30000 }))).toBe(`Zeile 25 ist negativ (${fmtEuro(-30000)}). Eine Rücklastschrift nimmt eine früher verbuchte Miete zurück; tragen Sie den Betrag mit Minus ein.`)
    expect(formerYearsText({ ...rep, year: 2026 })).toMatch(/^800,00\s€ Miete für frühere Jahre sind 2026 eingegangen \(darin 200,00\s€ Umlagen\)\./)
  })
})

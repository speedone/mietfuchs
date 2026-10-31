// Verteilung nach § 82b EStDV auf der Steuerseite (#262 PR 3, Entwurf 2026-10-30-erhaltungsaufwand-verteilen-design.md,
// E-5, E-8, E-13): die Spalte „verteilt“, der Block der Zeilen 57 bis 72 aus `anlageVLines` und die Hinweise.
import { describe, expect, test } from 'vitest'
import type { TaxExpenseItem, TaxReport, TaxSpread } from './types'
import { acquisitionRelated, acquisitionRelatedText, maintenanceLineText, showsSplit, taxHints } from './taxView'
import { isSpreadItem, showsDeferred, spreadBlock, spreadCarriedText as carriedRaw, spreadConditionsText, spreadIgnoredText, spreadItemText as itemRaw, spreadNothingDeductibleText, SPREAD_CARRIED_MORE, spreadRestBeforeStartText, spreadRestText as restRaw, SPREAD_REST_MORE, spreadUsageChangedText } from './taxSpread'

// fmtEuro setzt ein geschütztes Leerzeichen vor das €.
const plain = (s: string | null): string | null => (s === null ? null : s.replace(/\u00a0/g, ' '))
const spreadItemText = (x: TaxExpenseItem) => plain(itemRaw(x))
const spreadCarriedText = (r: TaxReport) => plain(carriedRaw(r)) ?? ''
const spreadRestText = (r: TaxReport) => plain(restRaw(r)) ?? ''

const pos = (over: Partial<TaxExpenseItem> = {}): TaxExpenseItem => ({
  costItemId: 'dach', category: 'Nicht umlagefähig', group: 'Verwaltung & Instandhaltung', description: 'Dachsanierung',
  amountCents: 1_000_000, privateCents: 0, deductibleCents: 1_000_000, labor35aCents: 0, allocation: 'area', deductiblePercent: 100,
  areaPrivateCents: null, settlementPrivateCents: null, taxUnits: null, steps: [], ...over,
})
// Im Jahr des Abflusses: 10.000 € auf 3 Jahre ohne privaten Teil.
const Y0 = pos({
  deductibleCents: 333_334, deferredCents: 666_666,
  spread: { years: 3, baseCents: 1_000_000, rates: [{ year: 2025, cents: 333_334, grossCents: 333_334 }, { year: 2026, cents: 333_333, grossCents: 333_333 }, { year: 2027, cents: 333_333, grossCents: 333_333 }] },
})
// Im Folgejahr: die abgeleitete Zeile, mit 40 % privat aus 2023 (D = 6.000 €).
const FOLGE = pos({
  costItemId: 'spread:fassade:2023', description: 'Anteil 3 von 3 aus 2023: Fassade', amountCents: 0, deferredCents: -200_000, deductibleCents: 200_000,
  deductiblePercent: null,
  spreadFrom: { costItemId: 'fassade', outflowYear: 2023, index: 3, of: 3, baseCents: 600_000, grossRateCents: 333_333, restAfterCents: 0 },
})
const BLOCK: TaxSpread = {
  started: [
    { costItemId: 'dach', description: 'Dachsanierung', amountCents: 1_000_000, privateCents: 0, baseCents: 1_000_000, deductiblePercent: null, years: 3, grossRateCents: 333_334, rateCents: 333_334, remainingCents: 666_666, direct: true },
    { costItemId: 'bad', description: 'Bad', amountCents: 500_000, privateCents: 200_000, baseCents: 300_000, deductiblePercent: 60, years: 2, grossRateCents: 250_000, rateCents: 150_000, remainingCents: 150_000, direct: false },
  ],
  carried: [
    { costItemId: 'fassade', description: 'Fassade', outflowYear: 2023, index: 3, of: 3, baseCents: 600_000, deductiblePercent: 60, grossRateCents: 333_333, rateCents: 200_000, remainingCents: 0, direct: false },
    { costItemId: 'alt', description: 'Fenster', outflowYear: 2020, index: 5, of: 5, baseCents: 500_000, deductiblePercent: null, grossRateCents: 100_000, rateCents: 100_000, remainingCents: 0, direct: true },
  ],
  thisYearCents: 783_334,
}

const report = (items: TaxExpenseItem[], over: Partial<TaxReport> = {}, spread: TaxSpread | null = BLOCK): TaxReport => {
  const sum = (f: (x: TaxExpenseItem) => number) => items.reduce((a, x) => a + f(x), 0)
  return {
    year: 2025,
    income: {
      baseRentSollCents: 0, inclusiveRentSollCents: 0, prepaymentSollCents: 0, flatRateSollCents: 0, prepaymentSettlementCents: 0, prepaymentOverridden: false,
      sollCents: 0, paidCents: 0, settlementBackPaymentsCents: 0, settlementRefundsCents: 0, tenanciesWithSoll: 0, tenanciesWithoutPayment: 0,
    },
    expenses: {
      groups: [], items, totalCents: sum((x) => x.amountCents), privateCents: sum((x) => x.privateCents), deductibleCents: sum((x) => x.deductibleCents),
      labor35aCents: 0, unstatedCount: 0, deferredCents: sum((x) => x.deferredCents ?? 0), ...(spread ? { spread } : {}),
    },
    movedOut: [], selfUseChangedInYear: false, closedSelfUseDiffers: false, closedItemsChanged: 0, reserveContributionCents: 0, reserveSuspects: [],
    totalAreaM2: 100, selfUsedAreaM2: 0, selfOccupiedExists: false, excludedExists: false, selfUsedShareCents: 0, surplusSollCents: 0, surplusPaidCents: 0,
    costModels: { tenancies: 0, inclusive: 0, partlyInclusive: 0, flatRate: 0 }, settlementPeriods: [],
    ...over,
  }
}

describe('Spalten der Werbungskosten (Aufgabe aus der Durchsicht von PR 2)', () => {
  test('mit Verteilung die aufgeteilte Tabelle und die Spalte „verteilt“, auch ohne Eigennutzung', () => {
    expect(showsSplit(report([Y0]))).toBe(true)
    expect(showsSplit(report([FOLGE]))).toBe(true)
    expect(showsDeferred(report([Y0]))).toBe(true)
    // Im Jahr des Abflusses positiv, im Folgejahr negativ; heben sich beide auf, bleibt die Spalte.
    expect(showsDeferred(report([pos({ costItemId: 'a', deferredCents: 200_000 }), pos({ costItemId: 'b', deferredCents: -200_000 })]))).toBe(true)
    expect(showsSplit(report([pos()], {}, null))).toBe(false)
    expect(showsDeferred(report([pos()], {}, null))).toBe(false)
    expect(isSpreadItem(Y0)).toBe(true)
    expect(isSpreadItem(FOLGE)).toBe(true)
    expect(isSpreadItem(pos())).toBe(false)
  })

  test('der Satz an der Zeile: Jahre und Rate im ersten Jahr, Herkunft und Grundlage im Folgejahr', () => {
    expect(spreadItemText(Y0)).toBe('auf 3 Jahre verteilt (2025 bis 2027): in diesem Jahr 3.333,34 €, in die Folgejahre 6.666,66 €')
    expect(spreadItemText(FOLGE)).toBe('Anteil 3 von 3 aus 2023, Grundlage 6.000,00 € abziehbar; danach nichts mehr')
    expect(spreadItemText(pos({ spreadFrom: { ...FOLGE.spreadFrom!, index: 2, restAfterCents: 200_000 } }))).toBe('Anteil 2 von 3 aus 2023, Grundlage 6.000,00 € abziehbar; danach noch 2.000,00 €')
    expect(spreadItemText(pos({ privateCents: 1_000_000, deductibleCents: 0, spread: { years: 2, baseCents: 0, rates: [{ year: 2025, cents: 0, grossCents: 500_000 }, { year: 2026, cents: 0, grossCents: 500_000 }] } })))
      .toBe('auf 2 Jahre verteilt (2025 bis 2026): ohne Wirkung, nichts davon abziehbar')
    expect(spreadItemText(pos())).toBeNull()
  })

  test('Zeile 55/56 nur für unverteilte Positionen: eine verteilte Entnahme verweist auf 57 bis 72', () => {
    const entnahme = pos({ ...Y0, category: 'Entnahme Erhaltungsrücklage', group: 'Erhaltungsaufwand', costItemId: 'e' })
    expect(maintenanceLineText(report([entnahme]), isSpreadItem)).toEqual({ unspread: null, spread: 'Verteilter Erhaltungsaufwand: siehe Zeilen 57 bis 72.' })
  })
})

describe('Block der Zeilen 57 bis 72 (E-5)', () => {
  test('2025: Zeilen 57 bis 60 für das erste Jahr, 2023 in 67 bis 69, vor 2021 ohne Nummer; Reihenfolge des Vordrucks', () => {
    const b = spreadBlock(report([Y0])) ?? expect.unreachable('kein Block')
    expect(b.showsLines).toBe(true)
    const [started, from2020, from2023] = b.sections
    expect(started?.title).toBe('In 2025 begonnen')
    expect(started?.rows.map((r) => [r.kind, r.line, r.label, r.grossCents, r.percent, r.cents])).toEqual([
      ['total', 57, 'Gesamtaufwand 2025, davon 2025 abzuziehen', 1_500_000, null, 583_334],
      ['item', 58, 'Dachsanierung (direkt zugeordnet)', null, null, 333_334],
      ['item', 59, 'Bad (verhältnismäßig zugeordnet)', 250_000, 60, 150_000],
      ['sum', 60, 'Summe der in 2025 begonnenen Verteilungen', null, null, 483_334],
    ])
    expect(started?.rows.find((r) => r.kind === 'sum')?.code).toBe(38)
    // Je Ursprungsjahr aufsteigend; 2020 hat im Vordruck 2025 keine Zeilen mehr.
    expect(from2020?.title).toBe('Anteile aus 2020')
    expect(from2020?.rows.map((r) => [r.kind, r.line, r.cents])).toEqual([['item', null, 100_000], ['sum', null, 100_000]])
    expect(from2023?.title).toBe('Anteile aus 2023')
    expect(from2023?.rows.map((r) => [r.kind, r.line, r.label, r.grossCents, r.percent, r.cents])).toEqual([
      ['item', 68, 'Fassade (Anteil 3 von 3, verhältnismäßig zugeordnet)', 333_333, 60, 200_000],
      ['sum', 69, 'Summe der Anteile aus 2023', null, null, 200_000],
    ])
    expect(from2023?.rows.at(-1)?.code).toBe(41)
    expect(b.thisYearCents).toBe(783_334)
  })

  test('2026 (Vordruck nicht gelesen): keine Nummer; ohne Verteilung kein Block', () => {
    const b = spreadBlock(report([Y0], { year: 2026 })) ?? expect.unreachable('kein Block')
    expect(b.showsLines).toBe(false)
    expect(b.sections.flatMap((s) => s.rows.map((r) => r.line))).toEqual(b.sections.flatMap((s) => s.rows.map(() => null)))
    expect(b.sections[0]?.title).toBe('In 2026 begonnen')
    expect(spreadBlock(report([pos()], {}, null))).toBeNull()
  })

  // Durchsicht S3: Eine Verteilung ohne abziehbaren Teil (D = 0) gehört nicht in den Block, auch nicht in die Summe von
  // Zeile 57; keine Zeile 59 mit 0 %. Der Hinweis `spreadNothingDeductible` bleibt.
  test('D = 0 steht nicht im Block und nicht in Zeile 57 (S3)', () => {
    const null0 = { ...BLOCK.started[1]!, costItemId: 'privat', description: 'Bad privat', privateCents: 500_000, baseCents: 0, deductiblePercent: 0, rateCents: 0, remainingCents: 0 }
    const b = spreadBlock(report([Y0], {}, { ...BLOCK, started: [BLOCK.started[0]!, null0] })) ?? expect.unreachable('kein Block')
    const started = b.sections[0]?.rows ?? []
    expect(started.map((r) => r.label)).not.toContain('Bad privat (verhältnismäßig zugeordnet)')
    expect(started[0]).toMatchObject({ grossCents: 1_000_000, cents: 333_334 })
    const nur = report([Y0], {}, { started: [null0], carried: [], thisYearCents: 0 })
    expect(spreadBlock(nur)).toBeNull()
    expect(taxHints(nur, 'ist')).toContain('spreadNothingDeductible')
  })

  test('vorzeitiges Ende: der Anteil heißt „Rest“', () => {
    const b = spreadBlock(report([FOLGE], {}, { started: [], carried: [{ ...BLOCK.carried[0]!, index: 2, rest: true }], thisYearCents: 200_000 }))
    expect(b?.sections[0]?.rows[0]?.label).toBe('Fassade (Rest aus Anteil 2 von 3, verhältnismäßig zugeordnet)')
  })
})

describe('Hinweise der Verteilung (E-8)', () => {
  test('jeder mit Auslöser und ohne', () => {
    const r = report([Y0])
    expect(taxHints(r, 'ist')).toEqual(expect.arrayContaining(['spreadConditions', 'spreadCarried']))
    expect(taxHints(r, 'ist')).not.toContain('spreadNothingDeductible')
    expect(taxHints(report([pos()], {}, { ...BLOCK, carried: [] }), 'ist')).not.toContain('spreadCarried')
    expect(taxHints(report([pos()], {}, { ...BLOCK, started: [] }), 'ist')).not.toContain('spreadConditions')
    const leer = { ...BLOCK, started: [{ ...BLOCK.started[1]!, privateCents: 500_000, baseCents: 0, deductiblePercent: 0, rateCents: 0, remainingCents: 0 }] }
    expect(taxHints(report([pos()], {}, leer), 'ist')).toContain('spreadNothingDeductible')
    expect(taxHints(report([pos()], { spreadIgnored: [{ costItemId: 'gs', description: 'Grundsteuer' }] }, null), 'ist')).toContain('spreadIgnored')
    const ohne = taxHints(report([pos()], {}, null), 'ist')
    for (const h of ['spreadConditions', 'spreadCarried', 'spreadNothingDeductible', 'spreadIgnored'] as const) expect(ohne).not.toContain(h)
  })

  test('Voraussetzungen als Warnung: Privatvermögen, überwiegend Wohnzwecke, Bindung; Eigentumswohnung und „Sonstiges“ eigens', () => {
    const t = spreadConditionsText(report([Y0]), 'mfh')
    expect(t.action).toMatch(/Privatvermögen/)
    expect(t.action).toMatch(/mehr als die Hälfte der gesamten Nutzfläche/)
    expect(t.action).toMatch(/§ 82b Abs\. 1 Satz 1 und 2 EStDV/)
    expect(t.action).toMatch(/Erklärung dieses Jahres.*bindet die Folgejahre/s)
    // „Nicht umlagefähig“ umfasst auch Verwaltung und Zinsen, die kein Erhaltungsaufwand sind.
    expect(t.action).toMatch(/Verwaltungskosten und Zinsen/)
    expect(t.more).toMatch(/§ 82b Abs\. 1 Satz 3 und 4 EStDV/)
    expect(t.more).toMatch(/§ 82b Abs\. 3 EStDV/)
    expect(t.more).toMatch(/§§ 11a, 11b EStG/)
    expect(spreadConditionsText(report([Y0]), 'etw').action).toMatch(/an der Wohnung.*Auslegung/s)
    expect(spreadConditionsText(report([Y0]), 'sonstiges').action).toMatch(/kennt die Nutzung der Flächen nicht/)
    // Nur Entnahmen: kein Satz zu „Nicht umlagefähig“.
    const nurEntnahme = report([pos({ ...Y0, category: 'Entnahme Erhaltungsrücklage', group: 'Erhaltungsaufwand' })])
    expect(spreadConditionsText(nurEntnahme, 'mfh').action).not.toMatch(/Zinsen/)
  })

  test('Anteile aus Vorjahren: Grundlage je Position zum Vergleich mit dem Bescheid, nicht nachholbar', () => {
    const t = spreadCarriedText(report([FOLGE]))
    expect(t).toMatch(/„Fassade“ aus 2023: Grundlage 6\.000,00 €/)
    expect(t).toMatch(/„Fenster“ aus 2020: Grundlage 5\.000,00 €/)
    // Durchsicht S2: nicht nachholbar in einem späteren Jahr, verloren mit bestandskräftigem Bescheid; Fundstellen im „Mehr dazu“.
    expect(t).toMatch(/in einem späteren Jahr lässt sich ein vergessener Anteil nicht nachholen, und ist der Bescheid dieses Jahres bestandskräftig, ist er verloren\./)
    expect(SPREAD_CARRIED_MORE).toMatch(/H 21\.1 EStH \(BFH, Urteil vom 26\.10\.1977, VIII R 111\/74, BStBl 1978 II S\. 367/)
    expect(SPREAD_CARRIED_MORE).toMatch(/BFH, Urteil vom 27\.10\.1992, IX R 152\/89, Rn\. 12 bis 14/)
    expect(t).toMatch(/gilt für die Erklärung der Wert des Bescheids/)
  })

  test('D = 0 und eine Wahl, wo nicht verteilt werden kann: mit Namen', () => {
    const leer = report([pos()], {}, { ...BLOCK, started: [{ ...BLOCK.started[1]!, baseCents: 0 }] })
    expect(spreadNothingDeductibleText(leer)).toMatch(/„Bad“.*keine Wirkung.*Folgejahren steht nichts/s)
    expect(spreadIgnoredText(report([pos()], { spreadIgnored: [{ costItemId: 'gs', description: 'Grundsteuer' }] }))).toMatch(/„Grundsteuer“.*nicht verteilt/s)
  })

  test('anschaffungsnahe Herstellungskosten ohne Datum am Objekt: nur, wenn in diesem Jahr eine Verteilung beginnt (X6)', () => {
    const info = acquisitionRelated(report([Y0]), null) ?? expect.unreachable('kein Hinweis')
    expect(info.basis).toBe('unknown')
    expect(acquisitionRelatedText(info)).toMatch(/Eigentumsübergang ein/)
    expect(acquisitionRelatedText(info)).toMatch(/kennt die Anschaffungskosten nicht/)
    expect(taxHints(report([Y0]), 'ist', 'mfh', {})).toContain('acquisitionRelated')
    // Nur übernommene Anteile: kein Beginn, ohne Datum kein Hinweis.
    expect(acquisitionRelated(report([FOLGE], {}, { ...BLOCK, started: [] }), null)).toBeNull()
    // Mit Datum gilt die Frist wie bisher, auch für den übernommenen Anteil.
    expect(acquisitionRelated(report([FOLGE], {}, { ...BLOCK, started: [] }), { ownershipTransferOn: '2023-07-01' })).toMatchObject({ basis: 'transfer' })
  })
})

// #262 PR 4 (E-7, E-8): vorzeitiges Ende nach § 82b Abs. 2 EStDV am Objekt.
describe('Hinweise zum vorzeitigen Ende (§ 82b Abs. 2 EStDV)', () => {
  const REST: TaxSpread = { started: [], carried: [{ ...BLOCK.carried[0]!, index: 2, rateCents: 400_000, rest: true }, BLOCK.carried[1]!], thisYearCents: 500_000 }
  test('spreadRest nur mit einem Rest in diesem Jahr; nennt Position, Jahr der Zahlung und Betrag', () => {
    expect(taxHints(report([FOLGE], {}, REST), 'ist')).toContain('spreadRest')
    expect(taxHints(report([FOLGE], {}, BLOCK), 'ist')).not.toContain('spreadRest')
    const t = spreadRestText(report([FOLGE], {}, REST))
    expect(t).toMatch(/In 2025 endet die Verteilung vorzeitig/)
    expect(t).toMatch(/„Fassade“ aus 2023: 4\.000,00 €/)
    expect(t).not.toMatch(/Fenster/)
    expect(t).toMatch(/Verkauft, verschenkt, vererbt oder Vermietung beendet im Jahr/)
    expect(SPREAD_REST_MORE).toMatch(/§ 82b Abs\. 2 EStDV/)
    expect(SPREAD_REST_MORE).toMatch(/BFH, Urteil vom 10\.11\.2020, IX R 31\/19/)
    expect(SPREAD_REST_MORE).toMatch(/Schenkung.*Auslegung.*R 21\.1 Abs\. 6 EStR 2012/s)
  })

  test('spreadRestBeforeStart: Ende im Jahr der Zahlung, nicht verteilt', () => {
    const r = report([pos()], { spreadRestBeforeStart: [{ costItemId: 'dach', description: 'Dachsanierung', restYear: 2025 }] }, null)
    expect(taxHints(r, 'ist')).toContain('spreadRestBeforeStart')
    expect(taxHints(report([pos()], {}, null), 'ist')).not.toContain('spreadRestBeforeStart')
    // Durchsicht S2: nur ein Ende im Jahr der Zahlung; eines davor wirkt nicht und kommt hier nicht vor.
    expect(spreadRestBeforeStartText(r)).toMatch(/„Dachsanierung“: Die Verteilung endet im Jahr der Zahlung \(2025\); die Position wird nicht verteilt und zählt ganz in 2025\./)
    expect(spreadRestBeforeStartText(r)).not.toMatch(/davor/)
  })

  test('spreadUsageChanged: Nutzungswechsel bei laufender Verteilung, ohne Rest in diesem Jahr', () => {
    expect(taxHints(report([Y0], { usageChangedUnits: ['EG'] }), 'ist')).toContain('spreadUsageChanged')
    expect(taxHints(report([Y0], { usageChangedUnits: ['EG'] }, { ...BLOCK, started: [] }), 'ist')).toContain('spreadUsageChanged')
    expect(taxHints(report([Y0], { usageChangedUnits: ['EG'] }, null), 'ist')).not.toContain('spreadUsageChanged')
    expect(taxHints(report([Y0]), 'ist')).not.toContain('spreadUsageChanged')
    // Ist das Ende in diesem Jahr schon eingetragen, sagt `spreadRest` alles.
    expect(taxHints(report([FOLGE], { usageChangedUnits: ['EG'] }, REST), 'ist')).not.toContain('spreadUsageChanged')
    const t = spreadUsageChangedText(report([Y0], { usageChangedUnits: ['EG', 'OG'] }))
    expect(t).toMatch(/Die Nutzung von EG, OG wechselt in diesem Jahr/)
    expect(t).toMatch(/Mietfuchs rechnet die Anteile weiter wie gewählt/)
    expect(t).toMatch(/§ 82b Abs\. 2 EStDV/)
  })
})

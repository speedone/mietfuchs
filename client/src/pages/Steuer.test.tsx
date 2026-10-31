// @vitest-environment jsdom
// Komponententest der Steuer-Seite.
//
// **Er schließt die Lücke, durch die ein ganzer Hinweis verschwinden konnte.** Beim Umbau der
// Hinweiskästen für #68 wurde der Block zur Zehn-Tage-Regel aus #70 überschrieben. Er wurde
// weiter berechnet, der CHANGELOG bewarb ihn weiter, und angezeigt wurde er nirgends. Kein Test
// hat das gefangen: `taxView.test.ts` prüft, dass `taxHints` den Wert liefert, und blieb grün;
// für die Seite gab es gar keinen Test.
//
// **Geprüft wird deshalb die ganze Gattung und nicht der eine Fall.** Der erste Entwurf dieser
// Datei prüfte drei Kästen einzeln und ließ ausgerechnet den druckrelevanten Soll-Vorbehalt aus;
// nachgemessen blieb er grün, als man dessen Block entfernte. Jetzt geht der Test die Liste
// `TAX_HINTS` durch und verlangt für **jeden** Eintrag eine Lage, in der er erscheint. Wer einen
// Hinweis hinzufügt, bekommt hier einen Übersetzungsfehler, solange er ihn nicht einträgt.
//
// Die erwarteten Texte stehen wörtlich da, und das lässt sich für einen Rendering-Test auch
// nicht vermeiden: Ein Test, der nur prüft, ob irgendetwas gerendert wurde, prüft nichts. Wer
// einen Satz umformuliert, zieht den Ausdruck hier mit.

import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Property, PropertyKind, TaxExpenseItem, TaxOverview, TaxOverviewSums, TaxReceived, TaxReceivedTenancy, TaxReport } from '../types'
import { TAX_HINTS, type Basis, type TaxHint } from '../taxView'
import { PeriodProvider } from '../period'
import { PropertyProvider } from '../property'
import Steuer from './Steuer'
import { periodKey } from '../../../shared/period.ts'
import { fmtEuro } from '../api'
import { anlageVLines } from '../anlageV'

// Dasselbe Jahr, das der PeriodProvider von sich aus wählt. Eine feste Jahreszahl wäre eine
// Zeitbombe: Der erste Entwurf prüfte auf „Die Abrechnung 2025", und das wäre am 1. Januar 2027
// von selbst rot geworden, ohne dass jemand Code anfasst.
const JAHR = new Date().getFullYear() - 1

const REPORT = (over: Partial<TaxReport> = {}, income: Partial<TaxReport['income']> = {}): TaxReport => ({
  year: JAHR,
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
  totalAreaM2: 200,
  selfUsedAreaM2: 0,
  selfOccupiedExists: false,
  excludedExists: false,
  selfUsedShareCents: 0,
  surplusSollCents: 1200000,
  surplusPaidCents: 1200000,
  costModels: { tenancies: 1, inclusive: 0, partlyInclusive: 0, flatRate: 0 },
  settlementPeriods: [],
  ...over,
})

// #312 PR 3: das Zugeflossene nach Zeilen; die Summen aus `byTenancy` wie in calc.ts.
const MIETER = (over: Partial<TaxReceivedTenancy> = {}): TaxReceivedTenancy => ({
  tenancyId: 't1', unitId: 'u1', tenantName: 'Meyer', unitName: 'EG', start: '2020-01-01', end: null, relative: false,
  rentCents: 960000, inclusiveRentCents: 0, allocationsCents: 240000, settlementCents: 0, formerYearsCents: 0, unallocatedCents: 0, forwardCents: 0,
  flatRateCents: 0, fromPreviousCents: 0,
  ...over,
})
const RECEIVED = (byTenancy: TaxReceivedTenancy[] = [MIETER()], over: Partial<TaxReceived> = {}, turn: Partial<TaxReceived['turnOfYear']> = {}): TaxReceived => {
  const sum = (f: (t: TaxReceivedTenancy) => number, only: (t: TaxReceivedTenancy) => boolean = () => true) => byTenancy.filter(only).reduce((a, t) => a + f(t), 0)
  return {
    rentCents: sum((t) => t.rentCents), inclusiveRentCents: sum((t) => t.inclusiveRentCents), unallocatedCents: sum((t) => t.unallocatedCents),
    allocationsCents: sum((t) => t.allocationsCents), flatRateCents: 0, formerYearsCents: sum((t) => t.formerYearsCents), formerYearsAllocationsCents: 0,
    turnOfYear: { forwardCents: sum((t) => t.forwardCents), forwardAllocationsCents: 0, fromPreviousCents: sum((t) => t.fromPreviousCents), fromPreviousAllocationsCents: 0, forwardOldLeaseCents: 0, lateDecemberCents: 0, ...turn },
    byUnit: byTenancy.map((t) => ({ unitId: t.unitId, unitName: t.unitName, areaM2: 80, rentCents: t.rentCents, allocationsCents: t.allocationsCents, settlementCents: t.settlementCents, formerYearsCents: t.formerYearsCents })),
    byTenancy,
    relatives: {
      rentCents: sum((t) => t.rentCents, (t) => t.relative), allocationsCents: sum((t) => t.allocationsCents, (t) => t.relative), settlementCents: sum((t) => t.settlementCents, (t) => t.relative),
      inclusiveRentCents: sum((t) => t.inclusiveRentCents, (t) => t.relative), unallocatedCents: sum((t) => t.unallocatedCents, (t) => t.relative), flatRateCents: sum((t) => t.flatRateCents, (t) => t.relative),
      sollRentCents: 0, sollInclusiveRentCents: 0, sollAllocationsCents: 0, sollFlatRateCents: 0,
    },
    possibleDeposits: [], unassignedCents: 0,
    totalCents: sum((t) => t.rentCents + t.allocationsCents + t.settlementCents + t.formerYearsCents),
    ...over,
  }
}
const MIT = (received: TaxReceived, income: Partial<TaxReport['income']> = {}, over: Partial<TaxReport> = {}): TaxReport => REPORT(over, { received, ...income })

// Eine Position der Steuerübersicht (#163) und ein Bericht mit eigener Wohnung.
const POS = (over: Partial<TaxExpenseItem> = {}): TaxExpenseItem => ({
  costItemId: 'c1', category: 'Nicht umlagefähig', group: 'Verwaltung & Instandhaltung', description: 'Dachreparatur',
  amountCents: 330000, privateCents: 240000, deductibleCents: 90000, labor35aCents: 0,
  allocation: 'area', deductiblePercent: 27.27, areaPrivateCents: null, settlementPrivateCents: null, taxUnits: null,
  steps: [{ label: 'Rechnungsbetrag', value: '3.300,00 €' }, { label: 'Rechnung', value: '3.300,00 € × 120/165 = 2.400 €' }],
  ...over,
})
const MIXED = (items: TaxExpenseItem[] = [POS()], over: Partial<TaxReport> = {}): TaxReport => {
  const sum = (f: (x: TaxExpenseItem) => number) => items.reduce((a, x) => a + f(x), 0)
  return REPORT({
    selfOccupiedExists: true, selfUsedAreaM2: 120, totalAreaM2: 165,
    expenses: {
      groups: [{ group: 'Verwaltung & Instandhaltung', amountCents: sum((x) => x.amountCents), labor35aCents: 0, privateCents: sum((x) => x.privateCents), deductibleCents: sum((x) => x.deductibleCents), categories: [] }],
      items, totalCents: sum((x) => x.amountCents), privateCents: sum((x) => x.privateCents), deductibleCents: sum((x) => x.deductibleCents), labor35aCents: 0, unstatedCount: 0,
    },
    surplusPaidCents: 1200000 - sum((x) => x.deductibleCents),
    ...over,
  })
}

// #96 PR 1: eine Entnahme aus der Erhaltungsrücklage in ihrer Gruppe.
const ENTNAHME = POS({
  costItemId: 'e', category: 'Entnahme Erhaltungsrücklage', group: 'Erhaltungsaufwand', description: 'Dachsanierung laut Hausgeldabrechnung',
  amountCents: 124000, privateCents: 0, deductibleCents: 124000, deductiblePercent: 100,
})

// #255, PR 4: die beiden Fälle des Mitwirkenden (R-9). Grundsteuer der Abrechnung des Vorjahres, in diesem Jahr bezahlt;
// und eine Position dieses Jahres, schon vor Beginn bezahlt.
const GS_IN = POS({
  costItemId: 'gs', category: 'Grundsteuer', group: 'Grundsteuer & öffentliche Abgaben', description: `Grundsteuer ${JAHR - 1}`,
  amountCents: 60000, privateCents: 24000, deductibleCents: 36000, allocation: 'settlement', deductiblePercent: 60,
  outflow: { year: JAHR, source: 'paid', paidOn: `${JAHR}-02-20` }, settlementPeriod: { key: periodKey(`${JAHR - 1}-01`), label: String(JAHR - 1) },
})
const GS_OUT: TaxReport['movedOut'][number] = {
  costItemId: 'vers', category: 'Sach- und Haftpflichtversicherung', description: `Versicherung ${JAHR}`, amountCents: 125000,
  settlementPeriod: { key: periodKey(`${JAHR}-01`), label: String(JAHR) }, outflow: { year: JAHR - 1, source: 'paid', paidOn: `${JAHR - 1}-12-01` },
}


// #262 PR 3: eine Verteilung nach § 82b EStDV. Im Jahr JAHR beginnt die Dachsanierung (10.000 € auf 3 Jahre, ohne privaten
// Teil), aus JAHR − 2 kommt der dritte Anteil der Fassade (D = 6.000 €, 60 %).
const DACH = POS({
  costItemId: 'dach', description: 'Dachsanierung', amountCents: 1_000_000, privateCents: 0, deductibleCents: 333_334, deferredCents: 666_666, deductiblePercent: 100,
  spread: { years: 3, baseCents: 1_000_000, rates: [{ year: JAHR, cents: 333_334, grossCents: 333_334 }, { year: JAHR + 1, cents: 333_333, grossCents: 333_333 }, { year: JAHR + 2, cents: 333_333, grossCents: 333_333 }] },
  steps: [{ label: 'Verteilung nach § 82b EStDV', value: 'abziehbar 10.000,00 € auf 3 Jahre', term: 'spread82b' }],
})
const FASSADE = POS({
  costItemId: `spread:fassade:${JAHR - 2}`, description: `Anteil 3 von 3 aus ${JAHR - 2}: Fassade`, amountCents: 0, privateCents: 0, deferredCents: -200_000, deductibleCents: 200_000, deductiblePercent: null,
  spreadFrom: { costItemId: 'fassade', outflowYear: JAHR - 2, index: 3, of: 3, baseCents: 600_000, grossRateCents: 333_333, restAfterCents: 0 },
})
const VERTEILT = (items: TaxExpenseItem[] = [DACH, FASSADE], over: Partial<TaxReport> = {}): TaxReport => {
  const sum = (f: (x: TaxExpenseItem) => number) => items.reduce((a, x) => a + f(x), 0)
  return REPORT({
    expenses: {
      groups: [{ group: 'Verwaltung & Instandhaltung', amountCents: sum((x) => x.amountCents), labor35aCents: 0, privateCents: 0, deductibleCents: sum((x) => x.deductibleCents), deferredCents: sum((x) => x.deferredCents ?? 0), categories: [] }],
      items, totalCents: sum((x) => x.amountCents), privateCents: 0, deductibleCents: sum((x) => x.deductibleCents), deferredCents: sum((x) => x.deferredCents ?? 0), labor35aCents: 0, unstatedCount: 0,
      spread: {
        started: items.some((x) => x.spread) ? [{ costItemId: 'dach', description: 'Dachsanierung', amountCents: 1_000_000, privateCents: 0, baseCents: 1_000_000, deductiblePercent: null, years: 3, grossRateCents: 333_334, rateCents: 333_334, remainingCents: 666_666, direct: true }] : [],
        carried: items.some((x) => x.spreadFrom) ? [{ costItemId: 'fassade', description: 'Fassade', outflowYear: JAHR - 2, index: 3, of: 3, baseCents: 600_000, deductiblePercent: 60, grossRateCents: 333_333, rateCents: 200_000, remainingCents: 0, direct: false }] : [],
        thisYearCents: sum((x) => x.deductibleCents),
      },
    },
    ...over,
  })
}

// Die Abrufe des letzten `zeige`, für Tests, die prüfen, wohin die Seite fragt (Gesamtsicht, #96 PR 3).
let requests: string[] = []
const OBJEKT = (id: string, name: string, kind: PropertyKind = 'mfh', over: Partial<Property> = {}): Property =>
  ({ id, name, kind, address: '', landlordName: null, iban: null, paymentDeadlineDays: null, ...over })

const zeige = async (report: TaxReport, basis: Basis = 'ist', kind?: PropertyKind, over: Partial<Property> = {}, overview?: TaxOverview) => {
  // Die Objekte sind meist gleichgültig: ohne Objekt gilt auf dem Server das einzige (#92). Nur
  // die Art des Objekts entscheidet über den Satz zum Hausgeld (#143), die Kopfangaben über den Kopf der Anlage V und den
  // Hinweis zu anschaffungsnahen Herstellungskosten (#96 PR 2). Mit `overview` gibt es ein zweites Objekt, und die Seite
  // fragt die Gesamtsicht (#96 PR 3).
  const properties: Property[] = kind || Object.keys(over).length > 0 || overview
    ? [OBJEKT('p', 'Objekt', kind ?? 'mfh', over), ...(overview ? [OBJEKT('q', 'Haus B')] : [])]
    : []
  requests = []
  vi.stubGlobal('fetch', async (url: string) => {
    requests.push(url)
    const body = url === '/api/properties' ? properties : url.startsWith('/api/tax/overview') ? overview : report
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  render(
    <PeriodProvider>
      <PropertyProvider>
        <Steuer settings={null} />
      </PropertyProvider>
    </PeriodProvider>,
  )
  await waitFor(() => expect(screen.getByText(/Summe der Einnahmen/i)).toBeTruthy())
  if (basis === 'soll') {
    fireEvent.change(screen.getByLabelText(/Einnahmen ansetzen als/i), { target: { value: 'soll' } })
  }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// ---------- Jeder berechnete Hinweis landet auf der Seite ----------

// `Record<TaxHint, …>` ist hier die eigentliche Zusicherung: Es zwingt den Übersetzer, für jeden
// Hinweis eine Lage zu verlangen. Ohne das wäre die Schleife unten nur eine hübsche Form.
type Lage = { report: TaxReport; basis?: Basis; kind?: PropertyKind; property?: Partial<Property>; text: RegExp }

const LAGEN: Record<TaxHint, Lage> = {
  // Muss auch im Druck stehen: Ein ausgedrucktes Blatt auf Soll-Basis ginge sonst ohne jeden
  // Vorbehalt zum Steuerberater. Genau dieser Kasten war im ersten Entwurf ungeprüft.
  sollIsNotTaxBasis: {
    report: REPORT(),
    basis: 'soll',
    text: /Diese Ansicht rechnet mit dem vereinbarten Soll/i,
  },
  paymentsMissing: {
    report: REPORT({}, { paidCents: 0, tenanciesWithSoll: 2, tenanciesWithoutPayment: 2 }),
    text: /keine einzige Mietzahlung erfasst/i,
  },
  // Genau dieser Block war schon einmal weg. Seit #312 PR 3 nur mit Betrag.
  turnOfYear: {
    report: MIT(RECEIVED([MIETER({ forwardCents: 80000 })])),
    text: /zählen nach § 11 Abs\. 1 Satz 2 EStG im Jahr \d{4} und stehen dort/,
  },
  turnOfYearOldLease: {
    report: MIT(RECEIVED([MIETER()], {}, { forwardOldLeaseCents: 80000 })),
    text: /Januarmiete Ende Dezember: Fälligkeit laut Vertrag prüfen/,
  },
  lateDecember: {
    report: MIT(RECEIVED([MIETER()], {}, { lateDecemberCents: 80000 })),
    text: /Dezembermiete sind Anfang Januar eingegangen und stehen in diesem Jahr/,
  },
  unallocatedPayment: {
    report: MIT(RECEIVED([MIETER({ rentCents: 980000, unallocatedCents: 20000 })])),
    text: /sind ohne vereinbarte Miete eingegangen/,
  },
  possibleDeposit: {
    report: MIT(RECEIVED([MIETER()], { possibleDeposits: [{ tenancyId: 't1', tenantName: 'Meyer', paidOn: `${JAHR}-03-05`, cents: 240000 }] })),
    text: /Ist das die Kaution\?/,
  },
  formerYears: {
    report: MIT(RECEIVED([MIETER({ formerYearsCents: 80000 })])),
    text: /Miete für frühere Jahre sind \d{4} eingegangen/,
  },
  // #96: Die beiden Kopfzeilen der Anlage V, die am Mietmodell hängen.
  inclusiveLine24: {
    report: REPORT({ costModels: { tenancies: 1, inclusive: 1, partlyInclusive: 0, flatRate: 0 } }),
    text: /Tragen Sie dort eine 1 ein/i,
  },
  inclusiveLine24Mixed: {
    report: REPORT({ costModels: { tenancies: 2, inclusive: 1, partlyInclusive: 0, flatRate: 0 } }),
    text: /bei gemischten Verträgen/i,
  },
  flatRateLine20: {
    report: REPORT({ costModels: { tenancies: 2, inclusive: 0, partlyInclusive: 0, flatRate: 1 } }),
    text: /Eine Betriebskostenpauschale ist eine Einnahme wie die Miete/,
  },
  // #143: Die Zuführung zur Erhaltungsrücklage steht neben den Werbungskosten, nicht darin.
  reserveContribution: {
    report: REPORT({ reserveContributionCents: 90000 }),
    text: /erst abziehbar, wenn und soweit die Gemeinschaft/i,
  },
  reserveSuspected: {
    report: REPORT({ reserveSuspects: [{ costItemId: 'v', description: 'Instandhaltungsrücklage 2025', amountCents: 90000 }] }),
    text: /Vielleicht eine Zuführung zur Erhaltungsrücklage/,
  },
  // #259: Nutzungswechsel im Jahr; das Leerstandsurteil steht unter „Mehr dazu“.
  usageChangedInYear: {
    report: REPORT({ usageChangedUnits: ['EG'] }),
    text: /Die Nutzung wechselt in diesem Jahr: EG/,
  },
  etwHousingMoney: {
    report: REPORT(),
    kind: 'etw',
    text: /Hausgeld-Vorschüsse/i,
  },
  // #96 PR 1: die Gruppe „Erhaltungsaufwand“ mit ihren Zeilen, eine vermutete Entnahme und die Sonderumlage.
  maintenanceLines: { report: MIXED([ENTNAHME]), text: /Anlage V \d{4}: Zeile 55\./ },
  // #96 PR 2 (A4.4): Übergang im Jahr vor dem Steuerjahr, also in der Frist; eine Entnahme ist Erhaltungsaufwand.
  acquisitionRelated: { report: MIXED([ENTNAHME]), property: { ownershipTransferOn: `${JAHR - 1}-07-01` }, text: /mehr als 15 % der Anschaffungskosten des Gebäudes/ },
  reserveWithdrawalSuspected: {
    report: REPORT({ reserveWithdrawalSuspects: [{ costItemId: 'a', description: 'Dach aus der Rücklage', amountCents: 50000, paidOn: `${JAHR}-03-01` }] }),
    text: /nicht das Ihrer eigenen Hausgeldzahlung/,
  },
  specialLevy: {
    report: REPORT({ specialLevySuspects: [{ costItemId: 's', description: 'Sonderumlage Dach', amountCents: 300000, category: 'Nicht umlagefähig' }] }),
    text: /Ihre eigene Zahlung an die Gemeinschaft zählt nicht/,
  },
  // #262 PR 3: die Verteilung nach § 82b EStDV.
  spreadConditions: { report: VERTEILT([DACH]), text: /Prüfen Sie die Voraussetzungen/ },
  spreadCarried: { report: VERTEILT([FASSADE]), text: /Diese Anteile gehören in die Erklärung dieses Jahres/ },
  spreadNothingDeductible: {
    report: (() => { const r = VERTEILT([DACH]); r.expenses.spread!.started[0]!.baseCents = 0; return r })(),
    text: /die Verteilung hat keine Wirkung/,
  },
  spreadIgnored: { report: REPORT({ spreadIgnored: [{ costItemId: 'gs', description: 'Grundsteuer' }] }), text: /an dieser Position wird aber nicht verteilt/ },
  // #262 PR 4: vorzeitiges Ende nach § 82b Abs. 2 EStDV am Objekt.
  spreadRest: {
    report: (() => { const r = VERTEILT([FASSADE]); r.expenses.spread!.carried[0]!.rest = true; return r })(),
    text: /endet die Verteilung vorzeitig/,
  },
  spreadRestBeforeStart: { report: REPORT({ spreadRestBeforeStart: [{ costItemId: 'dach', description: 'Dachsanierung', restYear: JAHR }] }), text: /die Position wird nicht verteilt und zählt ganz in/ },
  // #163: teilweise Eigennutzung.
  mixedUseSplit: { report: MIXED(), text: /durch direkte Zuordnung ermittelt/ },
  mixedUseKeyNotArea: {
    report: MIXED([POS({ allocation: 'settlement', category: 'Müllabfuhr', privateCents: 50000, deductibleCents: 50000, amountCents: 100000, areaPrivateCents: 25000 })]),
    text: /Nach Fläche wären es/,
  },
  mixedUseAreaMissing: { report: MIXED([POS({ allocation: 'unsplittable', privateCents: 0, deductibleCents: 330000, deductiblePercent: null })]), text: /ließ sich nicht aufteilen/ },
  mixedUseDirectOutside: { report: MIXED([POS({ allocation: 'direct-outside', privateCents: 0, deductibleCents: 330000, deductiblePercent: null })]), text: /außerhalb der Abrechnungseinheit zugeordnet/ },
  mixedUseChangedInYear: { report: MIXED([POS()], { selfUseChangedInYear: true }), text: /Ohne eingetragenen Nutzungswechsel/ },
  mixedUseClosedChanged: { report: MIXED([POS()], { closedSelfUseDiffers: true }), text: /gilt der eingefrorene Stand/ },
  mixedUseLabor35a: { report: MIXED([POS({ labor35aCents: 50000 })]), text: /in Ihrer eigenen Steuererklärung/ },
  mixedUseNotCalculated: { report: MIXED(), text: /Nicht gerechnet werden/ },
  mixedUseExcludedArea: {
    report: MIXED([POS({ allocation: 'area', category: 'Grundsteuer', privateCents: 100000, deductibleCents: 200000, amountCents: 300000, settlementPrivateCents: 150000 })], { excludedExists: true }),
    text: /über das ganze Gebäude/,
  },
  mixedUseClosedItemsChanged: { report: MIXED([POS()], { closedItemsChanged: 1 }), text: /nach dem Abschluss der Abrechnung/ },
  mixedUseAssignedUnits: {
    report: MIXED([POS({ allocation: 'direct-self', description: 'Malerarbeiten', amountCents: 100000, privateCents: 100000, deductibleCents: 0, deductiblePercent: null, taxUnits: [{ unitId: 'EG', unitName: 'EG' }] })]),
    text: /bestimmten Einheiten zugeordnet/,
  },
  // #268: Ausgleich beim Betriebsstrom, nicht eindeutige Meldung an den Messdienst, negativer Allgemeinstrom ohne Kennzeichnung.
  operatingPowerBalance: { report: REPORT({ operatingPowerBalanceCents: 20000, operatingPowerBalanceKind: 'kept' }), text: /Diesen Teil legen Sie nicht um und tragen ihn selbst/ },
  operatingPowerAmbiguous: {
    report: REPORT({ operatingPowerAmbiguous: [{ costItemId: 'ab', description: 'Abzug Heizung', amountCents: -20000 }] }),
    text: /zählt als dem Messdienst gemeldet/,
  },
  unmarkedPowerCredits: {
    report: REPORT({ unmarkedPowerCredits: [{ costItemId: 'gut', description: 'Abzug alt', amountCents: -20000 }] }),
    text: /Negativer Betrag beim Allgemeinstrom ohne Kennzeichnung/,
  },
  // #255, PR 4: was zwischen den Jahren verschoben ist.
  movedIn: { report: MIXED([GS_IN]), text: new RegExp(`In ${JAHR} bezahlt, aus einer anderen Abrechnung`) },
  movedOut: { report: REPORT({ movedOut: [GS_OUT] }), text: new RegExp(`In der Abrechnung ${JAHR}, aber in einem anderen Jahr bezahlt`) },
  unstated: { report: REPORT({ expenses: { groups: [], totalCents: 0, privateCents: 0, deductibleCents: 0, labor35aCents: 0, items: [], unstatedCount: 2 } }), text: /Bei 2 Positionen dieses Jahres ist nicht angegeben, wann sie bezahlt wurden/ },
}

for (const hint of TAX_HINTS) {
  test(`Der Hinweis ${hint} steht auf der Seite`, async () => {
    const lage = LAGEN[hint]
    await zeige(lage.report, lage.basis, lage.kind, lage.property)
    await waitFor(() => expect(screen.getByText(lage.text)).toBeTruthy())
  })
}

test('Der Soll-Vorbehalt nennt den Paragraphen und steht nicht auf der Ist-Grundlage', async () => {
  await zeige(REPORT(), 'soll')
  expect(screen.getByText(/Diese Ansicht rechnet mit dem vereinbarten Soll/i).closest('.notice-item')?.textContent).toMatch(/§ 11 Abs. 1 Satz 1 EStG/)
  cleanup()
  await zeige(REPORT())
  expect(screen.queryByText(/Diese Ansicht rechnet mit dem vereinbarten Soll/i)).toBeNull()
})

test('Vom Mieter übernommene Kosten und Umsatzsteuer bei Garagen: genannt, nicht gerechnet, je mit Begriff (#336, #323)', async () => {
  await zeige(REPORT())
  expect(screen.getByText(/Zwei Dinge rechnet Mietfuchs nicht/)).toBeTruthy()
  expect(screen.getByRole('button', { name: /vom Mieter übernommene Kosten/ })).toBeTruthy()
  expect(screen.getByRole('button', { name: /Umsatzsteuer bei Garage und Stellplatz/ })).toBeTruthy()
})

test('Der Unterschied zur Abrechnung steht auf der Seite (#70)', async () => {
  await zeige(REPORT({}, { prepaymentSettlementCents: 180000, prepaymentOverridden: true }))
  expect(screen.getByText(new RegExp(`Die Abrechnung ${JAHR} setzt bei den Vorauszahlungen`))).toBeTruthy()
})

// ---------- Die Kästen zur gemischten Nutzung ----------

test('Die gemischte Nutzung nennt Quadratmeter, nicht nur einen Anteil (#68)', async () => {
  // Die Quadratmeter sind die Angabe, die in die Anlage V wandert. Ein bloßer Prozentsatz lädt
  // außerdem dazu ein, den Rest für den abziehbaren Anteil zu halten.
  await zeige(REPORT({ selfOccupiedExists: true, selfUsedAreaM2: 50, totalAreaM2: 200 }))
  const kasten = screen.getByText(/Gemischt genutztes Gebäude/i).closest('.notice-item')
  expect(kasten?.textContent).toMatch(/50 m²/)
  expect(kasten?.textContent).toMatch(/200 m²/)
  expect(kasten?.textContent).toMatch(/25 %/)
})

test('Ohne erfasste Fläche steht kein Prozentsatz da (#68)', async () => {
  // Ein Anteil von 0 wäre eine Aussage über etwas, das niemand eingetragen hat.
  await zeige(REPORT({ selfOccupiedExists: true, selfUsedAreaM2: 0, totalAreaM2: 0 }))
  const kasten = screen.getByText(/Gemischt genutztes Gebäude/i).closest('.notice-item')
  expect(kasten?.textContent).not.toMatch(/%/)
})

test('Ausgenommene Wohnungen bekommen einen eigenen Kasten (#68)', async () => {
  await zeige(REPORT({ excludedExists: true }))
  expect(screen.getByText(/Wohnungen außerhalb der Abrechnungseinheit/i)).toBeTruthy()
  cleanup()
  await zeige(REPORT())
  expect(screen.queryByText(/Wohnungen außerhalb der Abrechnungseinheit/i)).toBeNull()
})

test('Der Vorbehalt zum Flächenanteil erscheint nur, wenn es auch einen Anteil gibt (#68)', async () => {
  // **Er verweist auf den Flächenanteil oben, muss also warten, bis es ihn gibt.** Der Kasten
  // mit dem Anteil hängt an `selfOccupiedExists`; ohne ihn zeigte der Absatz ins Leere und
  // behauptete von zwei nirgends angezeigten Zahlen, dass sie auseinandergehen. Genau diese Lage
  // trifft den Vermieter mit altem Bestand, den die Behebung schützen soll.
  await zeige(REPORT({ excludedExists: true }))
  expect(screen.queryByText(/rechnet über das/i)).toBeNull()
  cleanup()
  // Und ohne ausgenommene Wohnungen gibt es nichts zu erklären: Die Verteilbasis der Abrechnung
  // ist dann genau das ganze Gebäude.
  await zeige(REPORT({ selfOccupiedExists: true, selfUsedAreaM2: 50 }))
  expect(screen.queryByText(/rechnet über das/i)).toBeNull()
  cleanup()
  await zeige(REPORT({ selfOccupiedExists: true, selfUsedAreaM2: 50, excludedExists: true }))
  expect(screen.getByText(/rechnet über das/i)).toBeTruthy()
})

test('Die Rücklage nennt ihren Betrag und bleibt aus den Werbungskosten (#143)', async () => {
  await zeige(REPORT({ reserveContributionCents: 90000 }))
  const kasten = screen.getByText(/Zuführung zur Erhaltungsrücklage/i).closest('.notice-item')
  expect(kasten?.textContent).toMatch(/900,00/)
  expect(kasten?.textContent).toMatch(/IX R 19\/24/)
  cleanup()
  await zeige(REPORT())
  expect(screen.queryByText(/erst abziehbar, wenn und soweit die Gemeinschaft/i)).toBeNull()
})

test('Der Satz zum Hausgeld steht nur bei einer Eigentumswohnung (#143)', async () => {
  await zeige(REPORT(), 'ist', 'mfh')
  expect(screen.queryByText(/Hausgeld-Vorschüsse/i)).toBeNull()
})

test('Eine saldiert negative Rücklage heißt nicht „Zuführung“ (#143, Integrationsdurchsicht)', async () => {
  await zeige(REPORT({ reserveContributionCents: -30000 }))
  expect(screen.getByText(/Erhaltungsrücklage, saldiert/i)).toBeTruthy()
  expect(screen.queryByText(/^Zuführung zur Erhaltungsrücklage/i)).toBeNull()
})

// ---------- #142: Inklusivmiete und Zeile 24 ----------

// #142, seit #312 PR 3 mit der Tabelle nach Zeilen: Die Inklusivmiete gehört ganz zu den Mieteinnahmen (Zeile 24,
// `inclusiveLine24`) und steht dort als „davon“, in beiden Spalten; die Summe bleibt.
test('Die Inklusivmiete steht als „davon“ bei den Mieteinnahmen ohne Umlagen; die Summe bleibt (#142, #312)', async () => {
  await zeige(MIT(RECEIVED([MIETER({ inclusiveRentCents: 840000 })]), { baseRentSollCents: 960000, inclusiveRentSollCents: 840000 }))
  const kalt = zeile('homes')
  expect(kalt.textContent).toMatch(/Mieteinnahmen ohne Umlagen/)
  expect(kalt.textContent).toMatch(/9\.600,00.*9\.600,00/)
  const inklusiv = zeile('inclusive')
  expect(inklusiv.textContent).toMatch(/davon Inklusivmieten/)
  expect(inklusiv.textContent).toMatch(/8\.400,00.*8\.400,00/)
  expect(zeile('total').textContent).toMatch(/12\.000,00.*12\.000,00/)
  cleanup()
  await zeige(MIT(RECEIVED()))
  expect(zeilen()).not.toContain('inclusive')
})

test('Der Hinweis zu Zeile 24 bei gemischten Verträgen liest sich als ein Satz (#142)', async () => {
  await zeige(REPORT({ costModels: { tenancies: 2, inclusive: 1, partlyInclusive: 0, flatRate: 0 } }))
  expect(screen.getByText(/Eine Inklusivmiete gilt hier nur für einen Teil der Mietverhältnisse oder nur für einen Teil der Nebenkosten/)).toBeTruthy()
  expect(screen.queryByText(/Für einen Teil der Mietverhältnisse, oder/)).toBeNull()
})

// ---------- #163: Werbungskosten bei teilweiser Eigennutzung ----------

test('Mit eigener Wohnung: Hauptzahl abziehbar, „davon privat“ daneben, Überschuss aus dem abziehbaren Teil (#163)', async () => {
  await zeige(MIXED())
  const kpi = screen.getByText(/Werbungskosten \(abziehbar\)/).closest('.kpi')
  expect(kpi?.textContent).toMatch(/900,00/)
  expect(kpi?.textContent).toMatch(/gesamt 3\.300,00.*davon privat 2\.400,00/)
  // Die Tabelle führt Gesamt, privat, abziehbar und die Zuordnung.
  const zeile = screen.getByText('Dachreparatur').closest('tr')
  expect(zeile?.textContent).toMatch(/3\.300,00.*2\.400,00.*900,00/)
  expect(zeile?.textContent).toMatch(/anteilig, abziehbar 27,27 % \(nach Fläche\)/)
  expect(screen.getByRole('columnheader', { name: 'privat' })).toBeTruthy()
  // Ergebnis: abzüglich der abziehbaren Werbungskosten.
  expect(screen.getByText(/abzüglich abziehbarer Werbungskosten/).closest('tr')?.textContent).toMatch(/900,00/)
  // Der Rechenweg ist die gesonderte Aufstellung, zum Aufklappen.
  const rechenweg = screen.getByRole('button', { name: 'Rechenweg' })
  expect(rechenweg.classList.contains('disclosure')).toBe(true)
  fireEvent.click(rechenweg)
  expect(screen.getByText(/3\.300,00 € × 120\/165/)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Rechenweg schließen' }).getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByText(/3\.300,00 € × 120\/165/).closest('tr')?.id).toBe(rechenweg.getAttribute('aria-controls'))
  // Der alte Satz, die Übersicht nehme die Aufteilung nicht vor, ist weg.
  expect(screen.queryByText(/nimmt die\s+Aufteilung nicht automatisch vor/)).toBeNull()
})

test('Ohne eigene Wohnung: keine Spalte „privat“ und kein „davon privat“ (#163)', async () => {
  await zeige(REPORT({
    expenses: {
      unstatedCount: 0, groups: [{ group: 'Laufende Betriebskosten', amountCents: 50000, labor35aCents: 0, privateCents: 0, deductibleCents: 50000, categories: [{ category: 'Müllabfuhr', amountCents: 50000, labor35aCents: 0, privateCents: 0, deductibleCents: 50000 }] }],
      items: [POS({ category: 'Müllabfuhr', description: 'Müll', amountCents: 50000, privateCents: 0, deductibleCents: 50000, allocation: 'settlement', deductiblePercent: 100 })],
      totalCents: 50000, privateCents: 0, deductibleCents: 50000, labor35aCents: 0,
    },
  }))
  expect(screen.queryByRole('columnheader', { name: 'privat' })).toBeNull()
  expect(screen.queryByText(/davon privat/)).toBeNull()
  expect(screen.getByText(/Müllabfuhr/).closest('tr')?.textContent).toMatch(/500,00/)
})

test('Der Unterschied zum Flächenmaßstab wird beziffert (#163)', async () => {
  await zeige(MIXED([POS({ allocation: 'settlement', category: 'Müllabfuhr', description: 'Müll', privateCents: 50000, deductibleCents: 50000, amountCents: 100000, areaPrivateCents: 25000 })]))
  expect(screen.getByText(/Nach Fläche wären es/).textContent).toMatch(/250,00/)
})

test('Der Hinweis zum Personenschlüssel beschreibt Leerstand wie die Abrechnung seit #177 (#163, Durchsicht)', async () => {
  await zeige(MIXED([POS({ allocation: 'settlement', category: 'Müllabfuhr', description: 'Müll', privateCents: 50000, deductibleCents: 50000, amountCents: 100000, areaPrivateCents: 25000 })]))
  const kasten = screen.getByText(/Nach Fläche wären es/)
  // Seit 0.9.0 zählt eine leere Wohnung mit einer Person je Tag, und ihr Anteil bleibt beim
  // Vermieter; er fällt nicht mehr auf die übrigen Bewohner.
  expect(kasten.textContent).not.toMatch(/trägt eine leere Wohnung keine Personen/)
  expect(kasten.textContent).not.toMatch(/Personen der übrigen/)
  expect(kasten.textContent).toMatch(/mit einer Person je Tag/)
  expect(kasten.textContent).toMatch(/Vermietungsabsicht/)
})

test('Einheiten außerhalb: der Abstand zur Abrechnung nennt die richtige Richtung (#163, Durchsicht)', async () => {
  // Eigene Wohnung 100 m² mit 1 Person, vermietet 50 m² mit 4 Personen, dazu 50 m² außerhalb der
  // Abrechnungseinheit; Müll 1.000 € nach Personen: Die Abrechnung sagt 200 € privat, die
  // Gebäudefläche 500 €. Das sind 300 € mehr privat, nicht weniger.
  await zeige(MIXED([POS({ allocation: 'area', category: 'Müllabfuhr', description: 'Müll', amountCents: 100000, privateCents: 50000, deductibleCents: 50000, settlementPrivateCents: 20000 })], { excludedExists: true }))
  const kasten = screen.getByText(/über das ganze Gebäude/)
  expect(kasten.textContent).toMatch(/300,00\s€\s*mehr privat/)
  expect(kasten.textContent).not.toMatch(/weniger privat/)
  expect(kasten.textContent).not.toMatch(/wie privat/)
})

test('Einheiten außerhalb: der Kasten sagt, dass die Aufteilung über das ganze Gebäude rechnet (#163, Durchsicht)', async () => {
  await zeige(MIXED([POS()], { excludedExists: true }))
  const kasten = screen.getByText(/Wohnungen außerhalb der Abrechnungseinheit/i).closest('.notice-item')
  expect(kasten?.textContent).toMatch(/ganzen Gebäudes/)
  expect(kasten?.textContent).not.toMatch(/zählen sie bei der Aufteilung als\s+vermietet/)
})

// Integrationsdurchsicht vor 0.10: Positionen „Nicht umlagefähig“ aus 0.8.0 oder älter tragen oft
// noch eine Direktzuordnung aus dem damaligen Umlageschlüssel. Die Seite nennt Position, Einheit
// und Wirkung und den Weg zurück zum ganzen Gebäude.
test('„Nicht umlagefähig“ mit Zuordnung: Position, Einheit, Wirkung und der Weg zum ganzen Gebäude', async () => {
  await zeige(MIXED([
    POS({ costItemId: 'a', allocation: 'direct-self', description: 'Malerarbeiten', amountCents: 100000, privateCents: 100000, deductibleCents: 0, deductiblePercent: null, taxUnits: [{ unitId: 'EG', unitName: 'EG' }] }),
    POS({ costItemId: 'b', allocation: 'direct-rented', description: 'Bad', amountCents: 50000, privateCents: 0, deductibleCents: 50000, deductiblePercent: null, taxUnits: [{ unitId: 'OG', unitName: 'OG' }] }),
    POS({ costItemId: 'c', allocation: 'area', description: 'Dach Hinterhaus', taxUnits: [{ unitId: 'OG', unitName: 'OG' }, { unitId: 'DG', unitName: 'DG' }] }),
    POS({ costItemId: 'd', allocation: 'unsplittable', description: 'Dach Vorderhaus', amountCents: 20000, privateCents: 0, deductibleCents: 20000, deductiblePercent: null, taxUnits: [{ unitId: 'EG', unitName: 'EG' }] }),
  ]))
  const kasten = screen.getByText(/bestimmten Einheiten zugeordnet/).closest('.notice')
  if (!kasten) return expect.fail('kein Hinweiskasten')
  // Der Betrag steht mit geschütztem Leerzeichen vor dem €.
  const text = (kasten.textContent ?? '').replace(/\u00a0/g, ' ')
  expect(text).toContain('„Malerarbeiten“ (1.000,00 €): EG, ganz privat')
  expect(text).toContain('„Bad“ (500,00 €): OG, ganz abziehbar')
  expect(text).toContain('„Dach Hinterhaus“ (3.300,00 €): OG und DG, nach der Fläche dieser Einheiten')
  expect(text).toContain('„Dach Vorderhaus“ (200,00 €): EG, nicht aufteilbar (Fläche fehlt), ungekürzt abziehbar')
  expect(text).toMatch(/„das ganze Gebäude \(nach Fläche\)“/)
  expect(text).toMatch(/0\.8\.0 oder älter/)
})

test('„Nicht umlagefähig“ ohne Zuordnung: kein Hinweis', async () => {
  await zeige(MIXED([POS({ taxUnits: null })]))
  expect(screen.queryByText(/bestimmten Einheiten zugeordnet/)).toBeNull()
})

// ---------- Einnahmen nach Zeilen der Anlage V (#312 PR 3; Zahlungen aus der Abrechnung seit #280) ----------

// Eine Zeile der Einnahmentabelle über ihre Kennung.
const zeile = (key: string): HTMLElement => {
  const tr = document.querySelector<HTMLElement>(`tr[data-row="${key}"]`)
  if (!tr) return expect.unreachable(`Zeile ${key} fehlt`)
  return tr
}
const zeilen = (): string[] => [...document.querySelectorAll<HTMLElement>('tbody tr[data-row]')].map((tr) => tr.dataset.row ?? '')
const LINES = anlageVLines(JAHR)?.income

test('Die Zeilen der Tabelle sind die des Berichts, auf der Ist-Grundlage eingegangen vorn, vereinbart zum Abgleich', async () => {
  // 12 × 800 € (600 Kalt, 200 Vorauszahlung), 150 € Nachzahlung, 200 € Guthaben erstattet, 300 € Rückstand aus dem Vorjahr.
  const report = MIT(RECEIVED([MIETER({ rentCents: 720000, allocationsCents: 240000, settlementCents: -5000, formerYearsCents: 30000 })]),
    { baseRentSollCents: 720000, sollCents: 960000, paidCents: 985000, settlementBackPaymentsCents: 15000, settlementRefundsCents: 20000 })
  await zeige(report)
  expect(zeilen()).toEqual(['homes', 'allocations', 'settlement', 'formerYears'])
  const heads = screen.getAllByRole('columnheader').map((h) => h.textContent)
  expect(heads.slice(-2)).toEqual(['eingegangen (Ist)', 'vereinbart (Soll), zum Abgleich'])
  expect(zeile('homes').textContent).toMatch(/7\.200,00\s€.*7\.200,00\s€/)
  expect(zeile('allocations').textContent).toMatch(/2\.400,00\s€.*2\.400,00\s€/)
  expect(zeile('settlement').textContent).toMatch(/[−-]50,00\s€.*–/)
  expect(zeile('formerYears').textContent).toMatch(/300,00\s€.*–/)
  expect(zeile('total').textContent).toMatch(/9\.850,00\s€.*9\.600,00\s€/)
  // Die Kennzahl in der Spalte „Zeile“ nur, wo der Vordruck des Jahres gelesen ist (JAHR folgt der Uhr).
  if (LINES?.formerYears) {
    expect(zeile('homes').textContent).toMatch(/15, 18Kennzahl 01, 02/)
    expect(zeile('formerYears').textContent).toMatch(/25Kennzahl 06/)
    expect(zeile('total').textContent).toMatch(/32/)
    expect(screen.getByRole('columnheader', { name: 'Zeile' })).toBeTruthy()
  } else {
    expect(screen.queryByRole('columnheader', { name: 'Zeile' })).toBeNull()
  }
  // Die angesetzten Einnahmen sind die Summe der Zeilen.
  expect(screen.getByText(`Einnahmen ${JAHR}`).closest('.kpi')?.textContent).toMatch(/9\.850,00/)
  // Auf der Soll-Grundlage tauschen nur die Spalten.
  fireEvent.change(screen.getByLabelText(/Einnahmen ansetzen als/i), { target: { value: 'soll' } })
  const sollHeads = screen.getAllByRole('columnheader').map((h) => h.textContent)
  expect(sollHeads.slice(-2)).toEqual(['vereinbart (Soll)', 'eingegangen (Ist), zum Abgleich'])
  expect(zeilen()).toEqual(['homes', 'allocations', 'settlement', 'formerYears'])
  expect(zeile('total').textContent).toMatch(/9\.600,00\s€.*9\.850,00\s€/)
})

test('Tabelle am Handy gestapelt: jede Betragszelle trägt ihre Beschriftung', async () => {
  await zeige(MIT(RECEIVED()))
  const table = screen.getByRole('table', { name: 'Einnahmen nach Zeilen der Anlage V' })
  expect(table.classList.contains('stacked')).toBe(true)
  for (const td of zeile('homes').querySelectorAll('td.num')) expect(td.getAttribute('data-label')).toMatch(/eingegangen|vereinbart/)
})

test('Mit Angehörigen: Zeilen 19, 22, 23 eigens, das Soll je Zeile vom Server', async () => {
  const r = RECEIVED([
    MIETER({ rentCents: 720000, allocationsCents: 240000 }),
    MIETER({ tenancyId: 't2', unitId: 'u2', unitName: 'OG', tenantName: 'Tochter', relative: true, rentCents: 360000, allocationsCents: 120000, settlementCents: 3000 }),
  ])
  r.relatives = { ...r.relatives, sollRentCents: 360000, sollAllocationsCents: 120000 }
  await zeige(MIT(r, { paidCents: 1443000, settlementBackPaymentsCents: 3000 }, { costModels: { tenancies: 2, inclusive: 0, partlyInclusive: 0, flatRate: 0, relativeTenancies: 1 } }))
  // K5: Zeile 21 steht, sobald es eine Nachzahlung gibt, hier 0 € für die übrigen.
  expect(zeilen()).toEqual(['homes', 'relatives', 'allocations', 'settlement', 'relativesAllocations', 'relativesSettlement'])
  expect(zeile('relatives').textContent).toMatch(/3\.600,00\s€/)
  expect(zeile('relativesSettlement').textContent).toMatch(/30,00\s€/)
  // Soll ohne die Angehörigen: 9.600 − 3.600 = 6.000 und 2.400 − 1.200 = 1.200; deren Soll in 19 und 22.
  expect(zeile('homes').textContent).toMatch(/7\.200,00\s€.*6\.000,00\s€/)
  expect(zeile('relatives').textContent).toMatch(/3\.600,00\s€.*3\.600,00\s€/)
  expect(zeile('allocations').textContent).toMatch(/2\.400,00\s€.*1\.200,00\s€/)
  expect(zeile('relativesAllocations').textContent).toMatch(/1\.200,00\s€.*1\.200,00\s€/)
  expect(zeile('total').textContent).toMatch(/14\.430,00\s€/)
})

test('Unter der Tabelle: jede Zeile einzeln, Vergleich nur in der Summe, „Mehr dazu“ mit Tilgung und Abrechnungsreife', async () => {
  await zeige(MIT(RECEIVED()))
  expect(screen.getByText(/Tragen Sie jede Zeile einzeln ein/).textContent).toMatch(LINES?.total ? /in Zeile 32/ : /ergibt sich daraus/)
  expect(screen.getByText(/lassen sich nur in der Summe vergleichen/)).toBeTruthy()
  const reife = screen.getByText(/Vorauszahlungen eines schon abgerechneten Zeitraums nach/)
  // Eingeklappt am Bildschirm, im Druck offen.
  const box = reife.closest('[hidden]')
  expect(box?.classList.contains('print:block')).toBe(true)
  expect(screen.getByText(/VIII ZR 84\/17, Rn\. 53 und 57/)).toBeTruthy()
  fireEvent.click(screen.getAllByRole('button', { name: 'Mehr dazu' }).find((b) => b.getAttribute('aria-controls') === box?.id) ?? expect.unreachable('Knopf fehlt'))
  expect(reife.closest('[hidden]')).toBeNull()
})

test('Je Wohnung für die Zeilen 13 und 14: aufklappbar, im Druck offen', async () => {
  await zeige(MIT(RECEIVED([MIETER({ rentCents: 720000 }), MIETER({ tenancyId: 't2', unitId: 'u2', unitName: 'OG', relative: true, rentCents: 360000 })]), {}, { costModels: { tenancies: 2, inclusive: 0, partlyInclusive: 0, flatRate: 0, relativeTenancies: 1 } }))
  const table = screen.getByRole('table', { name: 'Einnahmen je Wohnung', hidden: true })
  const box = table.closest('[hidden]')
  expect(box?.classList.contains('print:block')).toBe(true)
  expect(table.textContent).toMatch(/EG.*80\s?m².*7\.200,00/)
  expect(table.textContent).toMatch(/OGan Angehörige vermietet/)
  const knopf = screen.getByRole('button', { name: LINES?.perUnit ? 'Je Wohnung (für die Zeilen 13 und 14)' : 'Je Wohnung' })
  fireEvent.click(knopf)
  expect(table.closest('[hidden]')).toBeNull()
  expect(screen.getByRole('button', { name: 'Je Wohnung schließen' })).toBeTruthy()
})

test('Zehn-Tage-Regel: vorwärts und aus dem Vorjahr mit Beträgen; ohne Betrag kein Hinweis; rückwärts ohne Titel', async () => {
  await zeige(MIT(RECEIVED([MIETER({ forwardCents: 80000 })], {}, { forwardCents: 80000, fromPreviousCents: 80000, fromPreviousAllocationsCents: 20000 })))
  const box = screen.getByText(/am Jahreswechsel/).closest('.notice-item')
  expect(box?.textContent).toContain(`im Jahr ${JAHR + 1} und stehen dort`)
  expect(box?.textContent).toMatch(new RegExp(`im Dezember ${JAHR - 1} eingegangene Januarmiete stehen nach § 11 Abs\\. 1 Satz 2 EStG in diesem Jahr`))
  // M1: der Hinweis auf eine Erklärung des Vorjahres mit Mietfuchs bis 0.13, ohne etwas zu verschieben.
  expect(box?.textContent).toContain(`schon in der Erklärung für ${JAHR - 1} angegeben (Mietfuchs bis Version 0.13 zählte ihn dort), lassen Sie jene berichtigen`)
  expect(box?.textContent).toMatch(/bis zu 10 Tage/)
  expect(box?.textContent).not.toMatch(/steht hier aber im alten/)
  cleanup()
  await zeige(MIT(RECEIVED()))
  expect(screen.queryByText(/am Jahreswechsel/)).toBeNull()
  cleanup()
  await zeige(MIT(RECEIVED([MIETER()], {}, { lateDecemberCents: 80000 })))
  const satz = screen.getByText(/Dezembermiete sind Anfang Januar eingegangen/)
  expect(satz.closest('.notice-item')).toBeNull()
  expect(satz.textContent).toContain(`(so § 551 BGB a. F., sofern der Vertrag nichts anderes bestimmt), gehören sie ins Jahr ${JAHR - 1}`)
})

test('Mieten für frühere Jahre negativ: der Satz zur Rücklastschrift', async () => {
  await zeige(MIT(RECEIVED([MIETER({ formerYearsCents: -30000 })])))
  expect(screen.getByText(/Eine Rücklastschrift nimmt eine früher verbuchte Miete zurück; tragen Sie den Betrag mit Minus ein/)).toBeTruthy()
})

test('Mögliche Kaution: Datum, Betrag und Mieter im Hinweis, auch im Druck', async () => {
  await zeige(MIT(RECEIVED([MIETER()], { possibleDeposits: [{ tenancyId: 't1', tenantName: 'Meyer', paidOn: `${JAHR}-03-05`, cents: 240000 }] })))
  const box = screen.getByText(/Ist das die Kaution\?/).closest('.notice-item')
  expect(box?.textContent).toMatch(new RegExp(`Zahlung vom 05\\.03\\.${JAHR} über 2\\.400,00\\s€ \\(Meyer\\)`))
  expect(box?.closest('.no-print')).toBeNull()
  // K2: keine unbelegte Aussage zur Einnahme, § 551 Abs. 3 BGB bleibt.
  expect(box?.textContent).not.toMatch(/keine Einnahme|verrechnete Kaution ist eine Einnahme/)
  expect(box?.textContent).toMatch(/§ 551 Abs\. 3 BGB/)
})

test('Ohne `received` (älterer Bericht): Ist je Zeile „–“, die Summe ist der Zufluss', async () => {
  await zeige(REPORT({}, { paidCents: 940000, settlementRefundsCents: 20000 }))
  expect(zeile('homes').textContent).toMatch(/–/)
  expect(zeile('settlement').textContent).toMatch(/[−-]200,00\s€/)
  expect(zeile('total').textContent).toMatch(/9\.400,00\s€/)
})

// ---------- #255, PR 4: was zwischen den Jahren verschoben ist ----------

test('Fall 1: Abrechnung des Vorjahres, in diesem Jahr bezahlt. Block und Zeile nennen Herkunft und Datum', async () => {
  await zeige(MIXED([GS_IN]))
  const block = screen.getByText(new RegExp(`In ${JAHR} bezahlt, aus einer anderen Abrechnung`)).closest('.notice-item')
  expect(block?.textContent).toContain(`„Grundsteuer ${JAHR - 1}“ (${fmtEuro(60000)}), aus Abrechnung ${JAHR - 1}, bezahlt am 20.02.${JAHR}`)
  expect(block?.textContent).toContain('§ 11 Abs. 2 Satz 1 EStG')
  // Durchsicht von PR 4, K2: „Nicht umlagefähig“ teilt nach Fläche und nicht nach der Abrechnung.
  expect(block?.textContent).toContain('umlagefähige Kosten nach dessen Abrechnung, die übrigen nach Zuordnung oder Fläche')
  // In der Aufstellung je Position steht die Herkunft an der Zeile.
  expect(screen.getByText(`aus Abrechnung ${JAHR - 1}, bezahlt am 20.02.${JAHR}`)).toBeTruthy()
  expect(screen.queryByText(/aber in einem anderen Jahr bezahlt/)).toBeNull()
})

test('Fall 2: vor Beginn bezahlt. Die Übersicht dieses Jahres nennt die Position, zählt sie aber nicht', async () => {
  await zeige(REPORT({ movedOut: [GS_OUT] }))
  const block = screen.getByText(new RegExp(`In der Abrechnung ${JAHR}, aber in einem anderen Jahr bezahlt`)).closest('.notice-item')
  expect(block?.textContent).toContain(`„Versicherung ${JAHR}“ (${fmtEuro(125000)}), Abrechnung ${JAHR}, bezahlt am 01.12.${JAHR - 1}: steht in der Steuerübersicht ${JAHR - 1}`)
  expect(block?.textContent).toMatch(new RegExp(`zählen nicht zu den Werbungskosten ${JAHR}`))
  expect(screen.queryByText(/aus einer anderen Abrechnung/)).toBeNull()
})

test('Ein Datum außerhalb der üblichen Spanne bekommt einen Satz zum Prüfen (Durchsicht PR 3, K8)', async () => {
  await zeige(REPORT({ movedOut: [{ ...GS_OUT, outsideSpan: true }] }))
  expect(screen.getByText(/außerhalb der üblichen Spanne/)).toBeTruthy()
})

// Durchsicht von PR #422, S2: Prognose, Untergrenze und fehlende Vergleichsmiete stehen auch im Druck, je Wohnung mit
// Quote, Vergleichsmiete und Quelle, nicht nur in der Karte zum Eintragen (no-print).
test('verbilligte Vermietung: der Satz zur Totalüberschussprognose steht druckbar in der Übersicht', async () => {
  const quelle = { from: `${JAHR}-01`, monthlyCents: 90000, source: 'Mietspiegel Musterstadt', sourceDate: `${JAHR - 1}-04-01` }
  await zeige(REPORT({
    cheapRent: {
      law: { split: 50, paid: 66, cite: '§ 21 Abs. 2 Satz 1 und 2 EStG', text: '' },
      units: [{
        unitId: 'a', unitName: 'DG', paidFactor: 1, gratuitousCents: 0, unallocated: [], sources: [quelle],
        tenancies: [{ tenancyId: 't', tenantName: 'Tochter', days: 365, baseRentCents: 660000, chargesCents: 0, chargesSource: 'settlement', directChargesCents: 0, entgeltCents: 660000, comparisonCents: 1080000, quotePercent: 61.11, verdict: 'forecast', missingMonths: [] }],
      }],
    },
  }))
  const satz = await screen.findByText(/Fällt sie negativ aus/)
  expect(satz.closest('.no-print')).toBeNull()
  expect(screen.getAllByText(/Mietspiegel Musterstadt/).some((e) => e.closest('.no-print') === null)).toBe(true)
})

// Reihenfolge der Steuerseite wie der Vordruck (#96 PR 1, Durchsicht Abschnitt 8): Kopf → Einnahmen (13–32) →
// Werbungskosten mit Erhaltung (55–72) → übrige → 87/88 → Gesamtsicht. Angelegt mit den Blöcken, die es gibt; der Kopf
// der Anlage V (#96 PR 2), die Einnahmentabelle (#312), der verteilte Erhaltungsaufwand (#262) und die Gesamtsicht
// (#96 PR 3) tragen sich hier ein.
test('Reihenfolge der Steuerseite: Einnahmen, Werbungskosten mit Erhaltungsaufwand, Kürzung nach Zeilen 87/88', async () => {
  const report = MIXED([ENTNAHME, DACH], {
    cheapRent: {
      law: { split: 50, paid: 66, cite: '§ 21 Abs. 2 Satz 1 und 2 EStG', text: '' },
      units: [{
        unitId: 'a', unitName: 'DG', paidFactor: 1, gratuitousCents: 0, unallocated: [], sources: [{ from: `${JAHR}-01`, monthlyCents: 90000, source: 'Mietspiegel', sourceDate: `${JAHR - 1}-04-01` }],
        tenancies: [{ tenancyId: 't', tenantName: 'Tochter', days: 365, baseRentCents: 660000, chargesCents: 0, chargesSource: 'settlement', directChargesCents: 0, entgeltCents: 660000, comparisonCents: 1080000, quotePercent: 61.11, verdict: 'forecast', missingMonths: [] }],
      }],
    },
  })
  report.expenses.spread = VERTEILT([DACH]).expenses.spread
  await zeige(report, 'ist', 'mfh', { ownershipTransferOn: `${JAHR - 1}-07-01` }, GESAMT())
  const blocks = [
    screen.getByRole('heading', { name: 'Kopf der Anlage V' }),
    screen.getByRole('heading', { name: 'Einnahmen' }),
    // #312 PR 3: die Einnahmentabelle (13 bis 32) zwischen Kopf und Werbungskosten.
    screen.getByRole('table', { name: 'Einnahmen nach Zeilen der Anlage V' }),
    screen.getByRole('heading', { name: 'Werbungskosten' }),
    await screen.findByText(/Anlage V \d{4}: Zeile 55\./),
    // #262 PR 3: der Block der Zeilen 57 bis 72 nach 55/56, vor der Kürzung.
    screen.getByRole('heading', { name: 'Zu verteilender Erhaltungsaufwand' }),
    screen.getByText(/Verbilligte Vermietung: DG/),
    // #96 PR 3: die Gesamtsicht zuletzt, nach der Karte zur ortsüblichen Miete.
    await screen.findByRole('heading', { name: `Alle Objekte ${JAHR}` }),
  ]
  for (let i = 1; i < blocks.length; i++) {
    const before = blocks[i - 1] ?? expect.unreachable('Block fehlt')
    const after = blocks[i] ?? expect.unreachable('Block fehlt')
    expect(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING, `Block ${i}`).toBeTruthy()
  }
})

test('Entnahme: Nutzungswechsel nennt den Tag der Ausgabe, die Eigentumswohnung den Satz zur Entnahme (#96, A4.5, A4.6)', async () => {
  await zeige(MIXED([ENTNAHME], { usageChangedUnits: ['EG'] }), 'ist', 'etw')
  expect(await screen.findByText(/streng genommen die Nutzung am Tag/)).toBeTruthy()
  expect(screen.getByText(/Entnahmen aus der Erhaltungsrücklage zählen abweichend im Jahr/)).toBeTruthy()
})


// #96 PR 2 (Entwurf B3): der Kopf der Anlage V mit Zeilen, Aktenzeichen ohne Sonderzeichen und „nicht eingetragen“.
test('Kopf der Anlage V: Aktenzeichen ohne Sonderzeichen, Eigentumsübergang, Fehlendes „nicht eingetragen“, Kennzahl 62', async () => {
  const report = REPORT({ costModels: { tenancies: 1, inclusive: 0, partlyInclusive: 0, flatRate: 0, relativeTenancies: 1 } })
  await zeige(report, 'ist', 'mfh', { groundTaxFileNumber: '2141/123/45678', ownershipTransferOn: '2023-07-01' })
  expect(await screen.findByText('214112345678')).toBeTruthy()
  expect(screen.getByText('01.07.2023')).toBeTruthy()
  expect(screen.getAllByText('nicht eingetragen').length).toBe(3)
  expect(screen.getByText('1 = Ja')).toBeTruthy()
  // Die Nummer nur, solange der Vordruck des Jahres gelesen ist (JAHR folgt der Uhr, siehe oben).
  if (anlageVLines(JAHR)?.header?.use === 10) expect(screen.getByText('Zeile 10, Kennzahl 62')).toBeTruthy()
  else expect(screen.queryByText(/Kennzahl 62/)).toBeNull()
})

// ---------- #262 PR 3: Verteilung nach § 82b EStDV ----------

const plain = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\u00a0/g, ' ')

test('Verteilung: Spalte „verteilt“, je Zeile Betrag = privat + verteilt + abziehbar, Satz an der Zeile, KPI nennt den verschobenen Teil', async () => {
  await zeige(VERTEILT())
  expect(screen.getByRole('columnheader', { name: 'verteilt' })).toBeTruthy()
  const dach = screen.getByText('Dachsanierung').closest('tr')
  expect(plain(dach)).toMatch(/10\.000,00 €.*0,00 €.*6\.666,66 € in Folgejahre.*3\.333,34 €/)
  // Am Handy Karten statt seitlichem Wischen; jede Zelle mit ihrer Spalte.
  const tabelle = dach?.closest('table')
  expect(tabelle?.classList.contains('stacked')).toBe(true)
  expect([...(dach?.querySelectorAll('td') ?? [])].every((td) => td.hasAttribute('data-label') || td.classList.contains('actions'))).toBe(true)
  expect(plain(dach)).toContain(`auf 3 Jahre verteilt (${JAHR} bis ${JAHR + 2}): in diesem Jahr 3.333,34 €, in die Folgejahre 6.666,66 €`)
  const fassade = screen.getByText(`Anteil 3 von 3 aus ${JAHR - 2}: Fassade`).closest('tr')
  expect(plain(fassade)).toMatch(new RegExp(`0,00 €.*0,00 €.*2\\.000,00 € aus ${JAHR - 2}.*2\\.000,00 €`))
  expect(plain(fassade)).toContain('Grundlage 6.000,00 € abziehbar')
  const summe = screen.getByText('Summe Werbungskosten').closest('tr')
  expect(plain(summe)).toMatch(new RegExp(`10\\.000,00 €.*0,00 €.*6\\.666,66 € in Folgejahre · 2\\.000,00 € aus Vorjahren.*5\\.333,34 €`))
  expect(plain(screen.getByText(/Werbungskosten \(abziehbar\)/).closest('.kpi'))).toMatch(/gesamt 10\.000,00 €.*in Folgejahre verschoben 6\.666,66 €/)
  // Rechenweg mit Begriff.
  fireEvent.click(screen.getAllByRole('button', { name: 'Rechenweg' })[0] ?? expect.unreachable('kein Rechenweg'))
  const schritt = screen.getByText(/abziehbar 10\.000,00 € auf 3 Jahre/).closest('tr.calc-steps')
  expect(schritt?.querySelector('[role="button"]')?.textContent).toMatch(/Verteilung nach § 82b EStDV/)
})

test('Ohne Verteilung: keine Spalte „verteilt“ und kein Block', async () => {
  await zeige(MIXED())
  expect(screen.queryByRole('columnheader', { name: 'verteilt' })).toBeNull()
  expect(screen.queryByRole('heading', { name: /Zu verteilender Erhaltungsaufwand/ })).toBeNull()
})

test('Block der Zeilen 57 bis 72: Gesamtbetrag, Anteil und Ergebnis in der Reihenfolge des Vordrucks, Folgejahr mit Grundlage', async () => {
  await zeige(VERTEILT())
  const started = screen.getByRole('table', { name: `Zu verteilender Erhaltungsaufwand: In ${JAHR} begonnen` })
  const heads = [...started.querySelectorAll('th')].map((h) => h.textContent)
  expect(heads.indexOf('Gesamtbetrag')).toBeLessThan(heads.indexOf('abzugsfähiger Anteil'))
  expect(heads.indexOf('abzugsfähiger Anteil')).toBeLessThan(heads.indexOf(`in ${JAHR} abzuziehen`))
  const rows = [...started.querySelectorAll('tbody tr[data-row]')].map((tr) => plain(tr))
  const lines = anlageVLines(JAHR)?.maintenance
  if (lines?.spread) {
    expect(rows[0]).toMatch(new RegExp(`^${lines.spread.total}Gesamtaufwand ${JAHR}, davon ${JAHR} abzuziehen10\\.000,00 €3\\.333,34 €`))
    expect(rows.some((r) => r.startsWith(`${lines.spread?.direct}Dachsanierung (direkt zugeordnet)`))).toBe(true)
  }
  // K3: am Handy beschriftet jede Zelle nach dem Vordruck, Zeile 57 mit „Gesamtaufwand“.
  const total = started.querySelector('tbody tr[data-row="started-total"]')
  expect([...(total?.querySelectorAll('td[data-label]') ?? [])].map((td) => td.getAttribute('data-label'))).toEqual(expect.arrayContaining(['Gesamtaufwand', `davon in ${JAHR} abzuziehen`]))
  expect(started.querySelector('th[colspan]')).toBeNull()
  const vorjahr = screen.getByRole('table', { name: `Zu verteilender Erhaltungsaufwand: Anteile aus ${JAHR - 2}` })
  const fassade = [...vorjahr.querySelectorAll('tbody tr[data-row]')].map((tr) => plain(tr)).find((r) => r.includes('Fassade')) ?? expect.unreachable('Fassade fehlt')
  expect(fassade).toMatch(/3\.333,33 €.*60 %.*2\.000,00 €/)
  expect(plain(document.querySelector('[data-row="this-year"]'))).toMatch(new RegExp(`In ${JAHR} abzuziehen.*5\\.333,34 €`))
  // K4/K5: die Belegung der Felder als Auslegung, das Prozent abgerundet.
  expect(screen.getByText(/Die Belegung der Felder ist eine Auslegung/)).toBeTruthy()
  expect(started.closest('.no-print')).toBeNull()
})

test('Erhaltungsaufwand: Zeile 55 nur für Unverteiltes, die verteilte Entnahme verweist auf 57 bis 72', async () => {
  const entnahmeVerteilt = { ...DACH, costItemId: 'ev', category: 'Entnahme Erhaltungsrücklage', group: 'Erhaltungsaufwand', description: 'Dach laut Hausgeldabrechnung' }
  await zeige(VERTEILT([entnahmeVerteilt]))
  const box = await screen.findByText(/Verteilter Erhaltungsaufwand/)
  expect(box.textContent).not.toMatch(/Zeile 55\./)
})

test('„Was diese Übersicht nicht rechnet“ nennt die Verteilung nicht mehr als fehlend', async () => {
  await zeige(MIXED())
  const box = screen.getByText('Was diese Übersicht nicht rechnet').closest('.notice-item')
  expect(box?.textContent).toMatch(/Größeren Erhaltungsaufwand verteilt Mietfuchs, wenn Sie es an der Position wählen \(§ 82b EStDV\)/)
  expect(box?.textContent).not.toMatch(/die Verteilung nach § 82b EStDV tragen Sie selbst ein/)
  expect(box?.textContent).not.toMatch(/Verteilung größeren Erhaltungsaufwands auf mehrere Jahre nach § 82b EStDV;/)
})

test('Anschaffungsnahe Herstellungskosten ohne Datum: mit beginnender Verteilung fragt der Hinweis nach dem Eigentumsübergang', async () => {
  await zeige(VERTEILT([DACH]), 'ist', 'mfh', { name: 'Objekt' })
  expect(await screen.findByText(/Sie verteilen in diesem Jahr Erhaltungsaufwand/)).toBeTruthy()
})

// #262, Durchsicht K2: Der Satz zur Verteilung steht im Hinweis zum Nutzungswechsel, nicht als eigener Hinweis.
test('Nutzungswechsel weg von der Vermietung bei laufender Verteilung: ein Hinweis mit dem Satz zu § 82b Abs. 2', async () => {
  await zeige(VERTEILT([DACH], { usageChangedUnits: ['EG'], usageLeftRentalUnits: ['EG'] }))
  const titel = await screen.findByText(/Die Nutzung wechselt in diesem Jahr: EG/)
  expect(titel.closest('.notice-item')?.textContent).toMatch(/Mietfuchs rechnet die Anteile weiter wie gewählt/)
  expect(screen.getAllByText(/Mietfuchs rechnet die Anteile weiter wie gewählt/)).toHaveLength(1)
  cleanup()
  await zeige(VERTEILT([DACH], { usageChangedUnits: ['EG'] }))
  await screen.findByText(/Die Nutzung wechselt in diesem Jahr: EG/)
  expect(screen.queryByText(/Mietfuchs rechnet die Anteile weiter wie gewählt/)).toBeNull()
})

// Durchsicht S1: Im Folgejahr ist der Anteil kein „verschobener“ Betrag, sondern einer aus einem Vorjahr; die Spalte erklärt
// ihr Vorzeichen.
test('Folgejahr nur mit Anteil aus einem Vorjahr: „aus Vorjahren“ statt eines negativen „verschoben“, Spalte erklärt (S1)', async () => {
  await zeige(VERTEILT([FASSADE]))
  const kpi = plain(screen.getByText(/Werbungskosten \(abziehbar\)/).closest('.kpi'))
  expect(kpi).toMatch(/aus Vorjahren 2\.000,00 €/)
  expect(kpi).not.toMatch(/verschoben/)
  expect(screen.getByText(/Spalte „verteilt“ \(§ 82b EStDV\)/)).toBeTruthy()
  // Nachtrag: kein unerklärtes Minus, der Betrag mit Wort.
  const zeile = screen.getByText(`Anteil 3 von 3 aus ${JAHR - 2}: Fassade`).closest('tr')
  expect(plain(zeile?.querySelector('td[data-label="verteilt"]'))).toBe(`2.000,00 € aus ${JAHR - 2}`)
  expect(plain(screen.getByText('Summe Werbungskosten').closest('tr')?.querySelector('td[data-label="verteilt"]'))).toBe('2.000,00 € aus Vorjahren')
  cleanup()
  await zeige(VERTEILT())
  expect(plain(screen.getByText(/Werbungskosten \(abziehbar\)/).closest('.kpi'))).toMatch(/in Folgejahre verschoben 6\.666,66 €.*aus Vorjahren 2\.000,00 €/)
})

// ---------- Gesamtsicht über alle Objekte (#96 PR 3) ----------

const SUMME = (over: Partial<TaxOverviewSums> = {}): TaxOverviewSums => ({
  incomeCents: 1200000,
  incomeLines: { homes: 1200000, inclusive: 0, unallocated: 0, relatives: 0, allocations: 0, flatRate: 0, settlement: 0, relativesAllocations: 0, relativesSettlement: 0, formerYears: 0, formerYearsAllocations: 0, totalCents: 1200000 },
  sollCents: 1100000, expensesTotalCents: 300000, privateCents: 0, gratuitousCents: 0, deferredCents: 0, deductibleCents: 300000,
  reserveContributionCents: 0, surplusCents: 900000, surplusSollCents: 800000, ...over,
})
const GESAMT = (): TaxOverview => ({
  year: JAHR,
  rows: [
    { propertyId: 'p', name: 'Objekt', kind: 'mfh', ok: true, hasRental: true, number: 1, sums: SUMME() },
    // Selbst bewohnt: privater Teil ohne Vermietung, zählt nicht (Durchsicht S1).
    { propertyId: 'g', name: 'Garagenhof', kind: 'sonstiges', ok: true, hasRental: false, number: null, sums: SUMME({ incomeCents: 0, sollCents: 0, deductibleCents: 0, surplusCents: 0, surplusSollCents: 0, expensesTotalCents: 25000, privateCents: 25000 }) },
    { propertyId: 'q', name: 'Haus B', kind: 'etw', ok: true, hasRental: true, number: 2, sums: SUMME({ incomeCents: 0, sollCents: 0, deductibleCents: 120000, privateCents: 40000, surplusCents: -120000, surplusSollCents: -120000 }) },
    { propertyId: 'x', name: 'Haus X', kind: 'mfh', ok: false, error: 'Die Position y ist nur mit einem Teilbetrag abgeflossen.' },
  ],
  totals: SUMME({ deductibleCents: 420000, privateCents: 40000, surplusCents: 780000, surplusSollCents: 680000 }),
})

test('Gesamtsicht: fehlt bei einem Objekt und wird dann auch nicht abgefragt', async () => {
  await zeige(REPORT(), 'ist', 'mfh')
  expect(screen.queryByRole('heading', { name: /Alle Objekte/ })).toBeNull()
  expect(requests.some((u) => u.startsWith('/api/tax/overview'))).toBe(false)
})

test('Gesamtsicht ab zwei Objekten: installationsweit abgefragt, je Objekt eine Zeile, Summe, neutraler Satz, Fehler, privat daneben', async () => {
  await zeige(REPORT(), 'ist', 'mfh', {}, GESAMT())
  const table = await screen.findByRole('table', { name: `Alle Objekte ${JAHR}` })
  expect(requests).toContain(`/api/tax/overview?year=${JAHR}`)
  const rows = [...table.querySelectorAll('tbody tr')]
  expect(rows.map((r) => r.getAttribute('data-row'))).toEqual(['p', 'g', 'q', 'x'])
  expect(rows[0]?.textContent).toMatch(/Objekt/)
  expect(rows[0]?.textContent).toMatch(/dieses Objekt/)
  expect(rows[0]?.textContent).toContain(fmtEuro(1200000))
  expect(rows[1]?.textContent).toContain(`Keine Einnahmen und keine Werbungskosten in ${JAHR}.`)
  expect(rows[2]?.textContent).toContain(fmtEuro(40000))
  expect(rows[2]?.textContent).toContain(fmtEuro(-120000))
  expect(rows[3]?.textContent).toMatch(/Nicht gerechnet: Die Position y/)
  const foot = table.querySelector('tfoot')?.textContent ?? ''
  expect(foot).toContain(fmtEuro(420000))
  expect(foot).toContain(fmtEuro(780000))
  // Die Fußzeile „privat“ ist die Summe der angezeigten Zellen (Durchsicht S1).
  const cells = [...table.querySelectorAll('tbody td[data-label="privat, nicht abziehbar"]')].map((td) => td.textContent)
  expect(cells).toEqual([fmtEuro(0), fmtEuro(40000)])
  expect(table.querySelector('tfoot td[data-label="privat, nicht abziehbar"]')?.textContent).toBe(fmtEuro(40000))
  expect(screen.getByText(/zählt nicht in die Summe/)).toBeTruthy()
  expect(screen.getByText('Kein Formular: Die Summe dient nur Ihrer Kontrolle.')).toBeTruthy()
  // Am Handy gestapelt; der Kopf nennt Zeile 32, die Nummer der Anlage steht je Zeile.
  expect(table.classList.contains('stacked')).toBe(true)
  expect([...table.querySelectorAll('thead th')].map((t) => t.textContent)).toContain('Einnahmen (Zeile 32)')
  expect(rows[2]?.querySelector('[data-label="Nr. der Anlage"]')?.textContent).toBe('2')
  // Nicht im Druck: Das Blatt ist die Anlage eines Objekts.
  expect(table.closest('.no-print')).not.toBeNull()
})

test('Gesamtsicht auf Soll: Einnahmen und Überschuss vereinbart, mit Vermerk', async () => {
  await zeige(REPORT(), 'soll', 'mfh', {}, GESAMT())
  const table = await screen.findByRole('table', { name: `Alle Objekte ${JAHR}` })
  expect([...table.querySelectorAll('thead th')].map((t) => t.textContent)).toContain('Einnahmen vereinbart (Soll)')
  expect(table.querySelector('tbody tr')?.textContent).toContain(fmtEuro(1100000))
  // K3: der Vermerk zum Soll steht auch in der Karte.
  const card = table.closest('section') ?? expect.unreachable('Karte')
  expect(card.textContent).toMatch(/Diese Ansicht rechnet mit dem vereinbarten Soll/)
})

test('Gesamtsicht auf Ist: kein Vermerk zum Soll in der Karte', async () => {
  await zeige(REPORT(), 'ist', 'mfh', {}, GESAMT())
  const table = await screen.findByRole('table', { name: `Alle Objekte ${JAHR}` })
  expect(table.closest('section')?.textContent).not.toMatch(/vereinbarten Soll/)
})

// K4: Scheitert der Abruf, steht die Meldung in der Karte; die Seite des Objekts bleibt.
test('Gesamtsicht: Fehler beim Abruf steht in der Karte', async () => {
  const properties = [OBJEKT('p', 'Objekt'), OBJEKT('q', 'Haus B')]
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.startsWith('/api/tax/overview')) return new Response(JSON.stringify({ error: 'Die Datenbank ist gerade nicht erreichbar.' }), { status: 500, headers: { 'content-type': 'application/json' } })
    return new Response(JSON.stringify(url === '/api/properties' ? properties : REPORT()), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  render(<PeriodProvider><PropertyProvider><Steuer settings={null} /></PropertyProvider></PeriodProvider>)
  const heading = await screen.findByRole('heading', { name: `Alle Objekte ${JAHR}` })
  const card = heading.closest('section') ?? expect.unreachable('Karte')
  await waitFor(() => expect(card.textContent).toMatch(/Die Datenbank ist gerade nicht erreichbar/))
  expect(screen.getByText(/Summe der Einnahmen/i)).toBeTruthy()
})

test('Gesamtsicht: der Sprung wechselt in das Objekt und lädt dessen Steuerübersicht', async () => {
  vi.stubGlobal('scrollTo', () => {})
  await zeige(REPORT(), 'ist', 'mfh', {}, GESAMT())
  await screen.findByRole('table', { name: `Alle Objekte ${JAHR}` })
  // Kein Sprung für das gewählte Objekt und für eines, das es in der Liste nicht gibt.
  expect(screen.getAllByRole('button', { name: /^Öffnen / }).map((b) => b.textContent)).toEqual(['Öffnen Haus B'])
  fireEvent.click(screen.getByRole('button', { name: 'Öffnen Haus B' }))
  await waitFor(() => expect(requests).toContain(`/api/taxreport/${JAHR}?property=q`))
  // Danach ist Haus B das gewählte, und der Sprung zurück steht beim ersten Objekt.
  expect(await screen.findByRole('button', { name: 'Öffnen Objekt' })).toBeTruthy()
})

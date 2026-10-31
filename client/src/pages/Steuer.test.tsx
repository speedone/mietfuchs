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
import type { Property, PropertyKind, TaxExpenseItem, TaxReport } from '../types'
import { settlementLine, TAX_HINTS, type Basis, type TaxHint } from '../taxView'
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

const zeige = async (report: TaxReport, basis: Basis = 'ist', kind?: PropertyKind, over: Partial<Property> = {}) => {
  // Die Objekte sind meist gleichgültig: ohne Objekt gilt auf dem Server das einzige (#92). Nur
  // die Art des Objekts entscheidet über den Satz zum Hausgeld (#143), die Kopfangaben über den Kopf der Anlage V und den
  // Hinweis zu anschaffungsnahen Herstellungskosten (#96 PR 2).
  const properties: Property[] = kind || Object.keys(over).length > 0
    ? [{ id: 'p', name: 'Objekt', kind: kind ?? 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null, ...over }]
    : []
  vi.stubGlobal('fetch', async (url: string) =>
    new Response(JSON.stringify(url === '/api/properties' ? properties : report), { status: 200, headers: { 'content-type': 'application/json' } }))
  render(
    <PeriodProvider>
      <PropertyProvider>
        <Steuer settings={null} />
      </PropertyProvider>
    </PeriodProvider>,
  )
  await waitFor(() => expect(screen.getByText(/Angesetzte Einnahmen/i)).toBeTruthy())
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
  // Genau dieser Block war schon einmal weg.
  turnOfYear: {
    report: REPORT(),
    text: /Am Jahreswechsel bitte prüfen/i,
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
    text: /Zeile 20 der Anlage V/i,
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
  expect(screen.getByText(/§ 11 Abs. 1 Satz 1 EStG/i)).toBeTruthy()
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

test('Die Inklusivmiete steht nicht unter „ohne Umlagen (Kaltmiete)“, sondern eigens; die Summe bleibt (#142)', async () => {
  await zeige(REPORT({}, { baseRentSollCents: 960000, inclusiveRentSollCents: 840000 }))
  const kalt = screen.getByText(/Mieteinnahmen ohne Umlagen/i).closest('tr')
  expect(kalt?.textContent).toMatch(/1\.200,00/)
  // Auch eine Miete, die nur kalt oder nur warm inklusiv ist, steht hier (Durchsicht).
  const inklusiv = screen.getByText(/Inklusivmieten \(ganz oder teilweise/i).closest('tr')
  expect(inklusiv?.textContent).toMatch(/8\.400,00/)
  expect(screen.getByText(/Summe Soll/i).closest('tr')?.textContent).toMatch(/12\.000,00/)
  cleanup()
  await zeige(REPORT())
  expect(screen.queryByText(/Inklusivmieten/i)).toBeNull()
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
  fireEvent.click(screen.getByRole('button', { name: 'Rechenweg' }))
  expect(screen.getByText(/3\.300,00 € × 120\/165/)).toBeTruthy()
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

// ---------- Zahlungen aus der Abrechnung (#280) ----------

test('Nachzahlungen und Erstattungen aus der Nebenkostenabrechnung: Saldo gesondert, mit Zeile nur, wo nachgesehen (N3)', async () => {
  await zeige(REPORT({}, { paidCents: 1200000 + 15000 - 20000, settlementBackPaymentsCents: 15000, settlementRefundsCents: 20000 }))
  const saldo = screen.getByText(/davon Saldo der Nebenkostenabrechnung/).closest('tr')
  expect(saldo?.textContent).toMatch(/Nachzahlungen 150,00\s€ minus erstattete Guthaben 200,00\s€/)
  expect(saldo?.textContent).toMatch(/[−-]50,00\s€/)
  const satz = screen.getByText(/sind im Zufluss\s+enthalten/)
  expect(satz.textContent).toMatch(/[−-]50,00\s€/)
  // Das Jahr der Seite ist das Vorjahr; welche Zeile gilt, entscheidet dieselbe Tabelle wie auf der Seite.
  const line = settlementLine(JAHR)
  if (line) {
    expect(satz.textContent).toMatch(/Anlage V, Zeile 21 \(Kennzahl 11\)/)
    expect(satz.textContent).toMatch(/Vermietung an Angehörige gilt stattdessen Zeile 23 \(Kennzahl 12\)/)
  } else {
    expect(satz.textContent).not.toMatch(/Zeile \d/)
    expect(satz.textContent).toMatch(/im Vordruck für \d{4} nach/)
  }
})

// Durchsicht speedone zu #328: Wer den Zufluss in die Zeilen der Mieten und Umlagen und den Saldo
// zusätzlich in Zeile 21 einträgt, zählt den Saldo doppelt. Die Seite nennt deshalb den Zufluss ohne
// Abrechnung als eigene Zahl, und beide Teile ergeben zusammen den Zufluss.
test('Zufluss ohne Abrechnung und Saldo getrennt: 12 × 800 € Miete, 200 € Guthaben erstattet', async () => {
  await zeige(REPORT({}, { paidCents: 940000, settlementBackPaymentsCents: 0, settlementRefundsCents: 20000 }))
  expect(screen.getByText(/Tatsächlich eingegangen/).closest('tr')?.textContent).toMatch(/9\.400,00\s€/)
  const ohne = screen.getByText(/davon Mieten und laufende Umlagen ohne Abrechnung/).closest('tr')
  expect(ohne?.textContent).toMatch(/9\.600,00\s€/)
  const saldo = screen.getByText(/davon Saldo der Nebenkostenabrechnung/).closest('tr')
  expect(saldo?.textContent).toMatch(/[−-]200,00\s€/)
  const satz = screen.getByText(/sind im Zufluss\s+enthalten/)
  expect(satz.textContent).toMatch(/9\.600,00\s€/)
  expect(satz.textContent).toMatch(/nicht zusätzlich/)
  if (settlementLine(JAHR)) expect(satz.textContent).toMatch(/Zeilen 15 und 18 sowie Zeile 20/)
})

test('Auf Soll-Basis erscheint der Hinweis zu Zeile 21 nicht (Durchsicht zu #328)', async () => {
  await zeige(REPORT({}, { paidCents: 940000, settlementRefundsCents: 20000 }), 'soll')
  expect(screen.queryByText(/sind im Zufluss\s+enthalten/)).toBeNull()
  expect(screen.queryByText(/Zeile 21/)).toBeNull()
})

test('Ohne Zahlungen aus der Abrechnung erscheint davon nichts', async () => {
  await zeige(REPORT())
  expect(screen.queryByText(/aus der Nebenkostenabrechnung/)).toBeNull()
})

test('Nur eine Nachzahlung aus der Abrechnung erfasst: der Hinweis sagt „keine Mietzahlung“, nicht „keine Zahlung“ (#280, Durchsicht)', async () => {
  await zeige(REPORT({}, { paidCents: 15000, settlementBackPaymentsCents: 15000, tenanciesWithSoll: 1, tenanciesWithoutPayment: 1 }))
  expect(screen.getByText(/keine einzige Mietzahlung erfasst/)).toBeTruthy()
  expect(screen.queryByText(/keine einzige Zahlung erfasst/)).toBeNull()
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
  const report = MIXED([ENTNAHME], {
    cheapRent: {
      law: { split: 50, paid: 66, cite: '§ 21 Abs. 2 Satz 1 und 2 EStG', text: '' },
      units: [{
        unitId: 'a', unitName: 'DG', paidFactor: 1, gratuitousCents: 0, unallocated: [], sources: [{ from: `${JAHR}-01`, monthlyCents: 90000, source: 'Mietspiegel', sourceDate: `${JAHR - 1}-04-01` }],
        tenancies: [{ tenancyId: 't', tenantName: 'Tochter', days: 365, baseRentCents: 660000, chargesCents: 0, chargesSource: 'settlement', directChargesCents: 0, entgeltCents: 660000, comparisonCents: 1080000, quotePercent: 61.11, verdict: 'forecast', missingMonths: [] }],
      }],
    },
  })
  await zeige(report, 'ist', 'mfh', { ownershipTransferOn: `${JAHR - 1}-07-01` })
  const blocks = [
    screen.getByRole('heading', { name: 'Kopf der Anlage V' }),
    screen.getByRole('heading', { name: 'Einnahmen' }),
    screen.getByRole('heading', { name: 'Werbungskosten' }),
    await screen.findByText(/Anlage V \d{4}: Zeile 55\./),
    screen.getByText(/Verbilligte Vermietung: DG/),
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

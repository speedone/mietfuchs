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
import { TAX_HINTS, type Basis, type TaxHint } from '../taxView'
import { YearProvider } from '../year'
import { PropertyProvider } from '../property'
import Steuer from './Steuer'

// Dasselbe Jahr, das der YearProvider von sich aus wählt. Eine feste Jahreszahl wäre eine
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
  totalAreaM2: 200,
  selfUsedAreaM2: 0,
  selfOccupiedExists: false,
  excludedExists: false,
  selfUsedShareCents: 0,
  surplusSollCents: 1200000,
  surplusPaidCents: 1200000,
  costModels: { tenancies: 1, inclusive: 0, partlyInclusive: 0, flatRate: 0 },
  ...over,
})

// Eine Position der Steuerübersicht (#163) und ein Bericht mit eigener Wohnung.
const POS = (over: Partial<TaxExpenseItem> = {}): TaxExpenseItem => ({
  costItemId: 'c1', category: 'Nicht umlagefähig', group: 'Verwaltung & Instandhaltung', description: 'Dachreparatur',
  amountCents: 330000, privateCents: 240000, deductibleCents: 90000, labor35aCents: 0,
  allocation: 'area', deductiblePercent: 27.27, areaPrivateCents: null, settlementPrivateCents: null,
  steps: [{ label: 'Rechnungsbetrag', value: '3.300,00 €' }, { label: 'Rechnung', value: '3.300,00 € × 120/165 = 2.400 €' }],
  ...over,
})
const MIXED = (items: TaxExpenseItem[] = [POS()], over: Partial<TaxReport> = {}): TaxReport => {
  const sum = (f: (x: TaxExpenseItem) => number) => items.reduce((a, x) => a + f(x), 0)
  return REPORT({
    selfOccupiedExists: true, selfUsedAreaM2: 120, totalAreaM2: 165,
    expenses: {
      groups: [{ group: 'Verwaltung & Instandhaltung', amountCents: sum((x) => x.amountCents), labor35aCents: 0, privateCents: sum((x) => x.privateCents), deductibleCents: sum((x) => x.deductibleCents), categories: [] }],
      items, totalCents: sum((x) => x.amountCents), privateCents: sum((x) => x.privateCents), deductibleCents: sum((x) => x.deductibleCents), labor35aCents: 0,
    },
    surplusPaidCents: 1200000 - sum((x) => x.deductibleCents),
    ...over,
  })
}

const zeige = async (report: TaxReport, basis: Basis = 'ist', kind?: PropertyKind) => {
  // Die Objekte sind meist gleichgültig: ohne Objekt gilt auf dem Server das einzige (#92). Nur
  // die Art des Objekts entscheidet über den Satz zum Hausgeld (#143).
  const properties: Property[] = kind
    ? [{ id: 'p', name: 'Objekt', kind, address: '', landlordName: null, iban: null, paymentDeadlineDays: null }]
    : []
  vi.stubGlobal('fetch', async (url: string) =>
    new Response(JSON.stringify(url === '/api/properties' ? properties : report), { status: 200, headers: { 'content-type': 'application/json' } }))
  render(
    <YearProvider>
      <PropertyProvider>
        <Steuer settings={null} />
      </PropertyProvider>
    </YearProvider>,
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
type Lage = { report: TaxReport; basis?: Basis; kind?: PropertyKind; text: RegExp }

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
    text: /keine einzige Zahlung erfasst/i,
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
    text: /sieht nach einer Zuführung zur Erhaltungsrücklage aus/i,
  },
  etwHousingMoney: {
    report: REPORT(),
    kind: 'etw',
    text: /Hausgeld-Vorschüsse/i,
  },
  // #163: teilweise Eigennutzung.
  mixedUseSplit: { report: MIXED(), text: /durch direkte Zuordnung ermittelt/ },
  mixedUseKeyNotArea: {
    report: MIXED([POS({ allocation: 'settlement', category: 'Müllabfuhr', privateCents: 50000, deductibleCents: 50000, amountCents: 100000, areaPrivateCents: 25000 })]),
    text: /Nach Fläche wären es/,
  },
  mixedUseAreaMissing: { report: MIXED([POS({ allocation: 'unsplittable', privateCents: 0, deductibleCents: 330000, deductiblePercent: null })]), text: /ließ sich nicht aufteilen/ },
  mixedUseDirectOutside: { report: MIXED([POS({ allocation: 'direct-outside', privateCents: 0, deductibleCents: 330000, deductiblePercent: null })]), text: /außerhalb der Abrechnungseinheit zugeordnet/ },
  mixedUseChangedInYear: { report: MIXED([POS()], { selfUseChangedInYear: true }), text: /nicht nach Tagen/ },
  mixedUseClosedChanged: { report: MIXED([POS()], { closedSelfUseDiffers: true }), text: /gilt der eingefrorene Stand/ },
  mixedUseLabor35a: { report: MIXED([POS({ labor35aCents: 50000 })]), text: /in Ihrer eigenen Steuererklärung/ },
  mixedUseNotCalculated: { report: MIXED(), text: /Nicht gerechnet werden/ },
  mixedUseExcludedArea: {
    report: MIXED([POS({ allocation: 'area', category: 'Grundsteuer', privateCents: 100000, deductibleCents: 200000, amountCents: 300000, settlementPrivateCents: 150000 })], { excludedExists: true }),
    text: /über das ganze Gebäude/,
  },
  mixedUseClosedItemsChanged: { report: MIXED([POS()], { closedItemsChanged: 1 }), text: /nach dem Abschluss der Abrechnung/ },
}

for (const hint of TAX_HINTS) {
  test(`Der Hinweis ${hint} steht auf der Seite`, async () => {
    const lage = LAGEN[hint]
    await zeige(lage.report, lage.basis, lage.kind)
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

test('Der Unterschied zur Abrechnung steht auf der Seite (#70)', async () => {
  await zeige(REPORT({}, { prepaymentSettlementCents: 180000, prepaymentOverridden: true }))
  expect(screen.getByText(new RegExp(`Die Abrechnung ${JAHR} setzt bei den Vorauszahlungen`))).toBeTruthy()
})

// ---------- Die Kästen zur gemischten Nutzung ----------

test('Die gemischte Nutzung nennt Quadratmeter, nicht nur einen Anteil (#68)', async () => {
  // Die Quadratmeter sind die Angabe, die in die Anlage V wandert. Ein bloßer Prozentsatz lädt
  // außerdem dazu ein, den Rest für den abziehbaren Anteil zu halten.
  await zeige(REPORT({ selfOccupiedExists: true, selfUsedAreaM2: 50, totalAreaM2: 200 }))
  const kasten = screen.getByText(/Gemischt genutztes Gebäude/i).closest('div')
  expect(kasten?.textContent).toMatch(/50 m²/)
  expect(kasten?.textContent).toMatch(/200 m²/)
  expect(kasten?.textContent).toMatch(/25 %/)
})

test('Ohne erfasste Fläche steht kein Prozentsatz da (#68)', async () => {
  // Ein Anteil von 0 wäre eine Aussage über etwas, das niemand eingetragen hat.
  await zeige(REPORT({ selfOccupiedExists: true, selfUsedAreaM2: 0, totalAreaM2: 0 }))
  const kasten = screen.getByText(/Gemischt genutztes Gebäude/i).closest('div')
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
  const kasten = screen.getByText(/Zuführung zur Erhaltungsrücklage/i).closest('div')
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
      groups: [{ group: 'Laufende Betriebskosten', amountCents: 50000, labor35aCents: 0, privateCents: 0, deductibleCents: 50000, categories: [{ category: 'Müllabfuhr', amountCents: 50000, labor35aCents: 0, privateCents: 0, deductibleCents: 50000 }] }],
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

test('Der Hinweis zum Personenschlüssel nennt den Leerstand als Ursache (#163, Durchsicht)', async () => {
  await zeige(MIXED([POS({ allocation: 'settlement', category: 'Müllabfuhr', description: 'Müll', privateCents: 50000, deductibleCents: 50000, amountCents: 100000, areaPrivateCents: 25000 })]))
  const kasten = screen.getByText(/Nach Fläche wären es/)
  expect(kasten.textContent).toMatch(/Leerstand/)
  expect(kasten.textContent).toMatch(/Vermietungsabsicht/)
})

test('Einheiten außerhalb: der Kasten sagt, dass die Aufteilung über das ganze Gebäude rechnet (#163, Durchsicht)', async () => {
  await zeige(MIXED([POS()], { excludedExists: true }))
  const kasten = screen.getByText(/Wohnungen außerhalb der Abrechnungseinheit/i).closest('div')
  expect(kasten?.textContent).toMatch(/ganzen Gebäudes/)
  expect(kasten?.textContent).not.toMatch(/zählen sie bei der Aufteilung als\s+vermietet/)
})

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
import type { TaxReport } from '../types'
import { TAX_HINTS, type Basis, type TaxHint } from '../taxView'
import { YearProvider } from '../year'
import Steuer from './Steuer'

// Dasselbe Jahr, das der YearProvider von sich aus wählt. Eine feste Jahreszahl wäre eine
// Zeitbombe: Der erste Entwurf prüfte auf „Die Abrechnung 2025", und das wäre am 1. Januar 2027
// von selbst rot geworden, ohne dass jemand Code anfasst.
const JAHR = new Date().getFullYear() - 1

const REPORT = (over: Partial<TaxReport> = {}, income: Partial<TaxReport['income']> = {}): TaxReport => ({
  year: JAHR,
  income: {
    baseRentSollCents: 960000,
    prepaymentSollCents: 240000,
    prepaymentSettlementCents: 240000,
    prepaymentOverridden: false,
    sollCents: 1200000,
    paidCents: 1200000,
    tenanciesWithSoll: 1,
    tenanciesWithoutPayment: 0,
    ...income,
  },
  expenses: { groups: [], totalCents: 0, labor35aCents: 0 },
  totalAreaM2: 200,
  selfUsedAreaM2: 0,
  selfOccupiedExists: false,
  excludedExists: false,
  selfUsedShareCents: 0,
  surplusSollCents: 1200000,
  surplusPaidCents: 1200000,
  ...over,
})

const zeige = async (report: TaxReport, basis: Basis = 'ist') => {
  vi.stubGlobal('fetch', async () =>
    new Response(JSON.stringify(report), { status: 200, headers: { 'content-type': 'application/json' } }))
  render(
    <YearProvider>
      <Steuer settings={null} />
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
type Lage = { report: TaxReport; basis?: Basis; text: RegExp }

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
}

for (const hint of TAX_HINTS) {
  test(`Der Hinweis ${hint} steht auf der Seite`, async () => {
    const lage = LAGEN[hint]
    await zeige(lage.report, lage.basis)
    expect(screen.getByText(lage.text)).toBeTruthy()
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

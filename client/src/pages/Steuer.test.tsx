// @vitest-environment jsdom
// Komponententest der Steuer-Seite.
//
// **Er schließt die Lücke, durch die ein ganzer Hinweis verschwinden konnte.** Beim Umbau der
// Hinweiskästen für #68 wurde der Block zur Zehn-Tage-Regel aus #70 überschrieben. Er wurde
// weiter berechnet, der CHANGELOG bewarb ihn weiter, und angezeigt wurde er nirgends. Kein Test
// hat das gefangen: `taxView.test.ts` prüft, dass `taxHints` den Wert liefert, und blieb grün;
// für die Seite gab es gar keinen Test.
//
// Geprüft wird deshalb genau das Dazwischen, also **dass jeder berechnete Hinweis auch wirklich
// auf der Seite landet**. Die Texte selbst stehen hier bewusst nicht Wort für Wort: Sie sollen
// sich ändern dürfen, ohne dass ein Test rot wird. Festgehalten wird, dass es sie gibt.

import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { TaxReport } from '../types'
import { YearProvider } from '../year'
import Steuer from './Steuer'

const REPORT = (over: Partial<TaxReport> = {}, income: Partial<TaxReport['income']> = {}): TaxReport => ({
  year: 2025,
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

const zeige = async (report: TaxReport) => {
  vi.stubGlobal('fetch', async () =>
    new Response(JSON.stringify(report), { status: 200, headers: { 'content-type': 'application/json' } }))
  render(
    <YearProvider>
      <Steuer settings={null} />
    </YearProvider>,
  )
  await waitFor(() => expect(screen.getByText(/Angesetzte Einnahmen/i)).toBeTruthy())
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('Der Hinweis zur Zehn-Tage-Regel steht auf der Seite (#70)', async () => {
  // **Genau dieser Block war schon einmal weg.** Er hängt an der Ist-Grundlage, und die ist die
  // Vorgabe, er muss also ohne jedes Zutun erscheinen.
  await zeige(REPORT())
  expect(screen.getByText(/Am Jahreswechsel bitte prüfen/i)).toBeTruthy()
  expect(screen.getByText(/§ 11 Abs. 1 Satz 2 EStG/i)).toBeTruthy()
})

test('Fehlende Zahlungen werden auf der Seite gemeldet (#70)', async () => {
  await zeige(REPORT({}, { paidCents: 0, tenanciesWithSoll: 2, tenanciesWithoutPayment: 2 }))
  expect(screen.getByText(/keine einzige Zahlung erfasst/i)).toBeTruthy()
})

test('Der Unterschied zur Abrechnung steht auf der Seite (#70)', async () => {
  await zeige(REPORT({}, { prepaymentSettlementCents: 180000, prepaymentOverridden: true }))
  expect(screen.getByText(/Die Abrechnung 2025 setzt bei den Vorauszahlungen/i)).toBeTruthy()
})

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
  // Und ohne sie schweigt die Seite darüber.
  cleanup()
  await zeige(REPORT())
  expect(screen.queryByText(/Wohnungen außerhalb der Abrechnungseinheit/i)).toBeNull()
})

test('Der Vorbehalt zum Flächenanteil erscheint nur bei ausgenommenen Wohnungen (#68)', async () => {
  // Ohne sie ist die Verteilbasis der Abrechnung genau das ganze Gebäude, die beiden Anteile
  // können also gar nicht auseinandergehen. Ein Absatz, der dort einen Unterschied erklärt, den
  // es nicht gibt, ist schlechter als keiner.
  await zeige(REPORT({ selfOccupiedExists: true, selfUsedAreaM2: 50 }))
  expect(screen.queryByText(/rechnet über das/i)).toBeNull()
  cleanup()
  await zeige(REPORT({ selfOccupiedExists: true, selfUsedAreaM2: 50, excludedExists: true }))
  expect(screen.getByText(/rechnet über das/i)).toBeTruthy()
})

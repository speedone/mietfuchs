// Beträge einer ausgewerteten Rechnung geradeziehen (#34). Zwei Fälle kommen oft vor, und kein
// Modell rechnet sie zuverlässig selbst. Deshalb liefert das Modell nur, was auf der Rechnung
// steht, und gerechnet wird hier, deterministisch und in Cent:
//
// 1. **Positionen netto.** Handwerker und Schornsteinfeger weisen die Positionen oft ohne
//    Umsatzsteuer aus und nennen sie erst in der Summe. Umgelegt wird aber, was der Vermieter
//    gezahlt hat. Die Positionen werden deshalb hochgerechnet, sodass sie zusammen genau den
//    Rechnungsbetrag ergeben: mit dem ausgewiesenen Steuersatz, sonst anteilig.
// 2. **Lohnanteil nach §35a als ein Betrag.** Steht er nur unter der Rechnung („Im
//    Rechnungsbetrag sind Arbeitskosten von 90,56 € enthalten“), wird er nach Beträgen auf die
//    Positionen verteilt, damit die Bescheinigung ihn ausweisen kann.
//
// Beides ist ein Vorschlag wie alles aus der KI: Die Oberfläche zeigt es an, übernommen wird
// erst nach Prüfung. `amountsAdjusted` und `laborFromTotal` sagen ihr, was gerechnet wurde.
import { largestRemainder } from './calc.ts'

// Eine Rechnungsposition aus der KI-Auswertung. Weitere Felder (Beschreibung, Kategorie, …)
// fasst diese Funktion nicht an, deshalb bleiben sie über den Index-Zugriff nur durchgereicht.
type Position = {
  amountEur?: number
  labor35aEur?: number
  [key: string]: unknown
}

// Die Rohausgabe der KI-Auswertung, so weit diese Funktion sie liest oder ergänzt. Auch hier
// bleiben unbekannte Felder über den Index-Zugriff erhalten.
type Extraction = {
  positionsAreNet?: boolean
  vatRatePercent?: number
  labor35aTotalEur?: number
  totalGrossEur?: number
  positions?: Position[]
  amountsAdjusted?: string
  laborFromTotal?: boolean
  [key: string]: unknown
}

const toCents = (eur: unknown): number | null => (typeof eur === 'number' && Number.isFinite(eur) ? Math.round(eur * 100) : null)
const toEur = (cents: number): number => Math.round(cents) / 100
// Wie in der Schnellerfassung: kleine Abweichungen sind Rundung, keine fehlende Umsatzsteuer
const tolerance = (totalCents: number): number => Math.max(50, Math.round(totalCents * 0.02))

export function normalizeAmounts(extraction: Extraction | null | undefined) {
  const { positionsAreNet, vatRatePercent, labor35aTotalEur, ...result } = extraction ?? {}
  const positions = Array.isArray(result.positions) ? result.positions.map((p) => ({ ...p })) : []
  result.positions = positions
  const keys = positions.map((_, i) => String(i))
  const totalCents = toCents(result.totalGrossEur) ?? 0
  const netCents = positions.map((p) => toCents(p.amountEur) ?? 0)
  const netSum = netCents.reduce((a, b) => a + b, 0)

  // 1. Netto → brutto
  if (positionsAreNet === true && positions.length > 0 && netSum > 0 && totalCents > 0 && netSum < totalCents - tolerance(totalCents)) {
    const rate = typeof vatRatePercent === 'number' && Number.isFinite(vatRatePercent) && vatRatePercent > 0 && vatRatePercent <= 30
      ? vatRatePercent
      : null
    const raws = rate ? netCents.map((c) => c * (1 + rate / 100)) : netCents.map((c) => (c * totalCents) / netSum)
    const gross = largestRemainder(totalCents, raws, keys)
    positions.forEach((p, i) => { p.amountEur = toEur(gross[i]) })
    result.amountsAdjusted = 'netto'
  }

  // 2. Lohnanteil aus dem Gesamtbetrag
  const laborTotal = toCents(labor35aTotalEur) ?? 0
  const hasOwnLabor = positions.some((p) => (toCents(p.labor35aEur) ?? 0) > 0)
  const grossCents = positions.map((p) => toCents(p.amountEur) ?? 0)
  const grossSum = grossCents.reduce((a, b) => a + b, 0)
  if (laborTotal > 0 && !hasOwnLabor && grossSum > 0 && laborTotal <= grossSum) {
    const parts = largestRemainder(laborTotal, grossCents.map((c) => (c * laborTotal) / grossSum), keys)
    positions.forEach((p, i) => { p.labor35aEur = toEur(parts[i]) })
    result.laborFromTotal = true
  }
  return result
}

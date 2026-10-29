// Der Teil einer aufgeteilten Rechnung in der Kostenliste (#455): „Teil von 2 · Rechnung gesamt 365,00 €“. Die Teile
// einer Rechnung tragen dieselbe Quelle (`sourceId`) und können in verschiedenen Zeiträumen stehen; die Summe ist die
// der Teile, wie sie heute stehen, denn eine Summe an der Quelle gibt es nicht (Entwurf, Datenmodell). Eine Nummer
// je Teil steht bewusst nicht da: Zwei Teile können im selben Zeitraum stehen, und eine Reihenfolge wäre dann geraten.
import type { CostItem } from './types'
import { fmtEuro } from './api'

// `null` ohne Quelle oder wenn nur ein Teil übrig ist: Dann ist die Position die ganze Rechnung, soweit erfasst.
export function sourceSummary(item: CostItem, all: readonly CostItem[]): { parts: number; totalCents: number } | null {
  if (!item.sourceId) return null
  const parts = all.filter((c) => c.sourceId === item.sourceId)
  if (parts.length < 2) return null
  return { parts: parts.length, totalCents: parts.reduce((a, c) => a + c.amountCents, 0) }
}

export function sourceLabel(item: CostItem, all: readonly CostItem[]): string | null {
  const s = sourceSummary(item, all)
  return s ? `Teil von ${s.parts} · Rechnung gesamt ${fmtEuro(s.totalCents)}` : null
}

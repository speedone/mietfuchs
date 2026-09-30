// Der Rechenweg einer Zeile (#114), ohne DOM prüfbar. Die Schritte liefert die Berechnung; eine
// Abrechnung, die vorher abgeschlossen wurde, kennt sie nicht. Dann zeigt die Seite, was die
// Zeile selbst hergibt, und sagt, dass mehr nicht vorliegt, statt Schritte nachzurechnen, die
// nicht zum eingefrorenen Stand passen müssen.

import { fmtEuro } from './api'
import type { CalcStep, SettlementRow } from './types'

export function stepsOf(row: SettlementRow): { steps: CalcStep[], complete: boolean } {
  if (row.steps) return { steps: row.steps, complete: true }
  const steps: CalcStep[] = [
    { label: 'Rechnungsbetrag', value: fmtEuro(row.totalCents) },
    { label: 'Umlageschlüssel', value: row.keyLabel, term: 'allocationKey' },
  ]
  if (row.basisText) steps.push({ label: 'Anteil an der Verteilbasis', value: row.basisText, term: 'distributionBasis' })
  steps.push({ label: 'Ergebnis', value: fmtEuro(row.shareCents) })
  return { steps, complete: false }
}

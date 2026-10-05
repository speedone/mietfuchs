// Der Druckblock „Brennstoff“ (Heizung PR 7, Entwurf 9.5, 10.1): je Rechnung ihr Anteil an der
// Heizperiode mit dem Verfahren, der Ausstoß umgerechnet und die Abdeckung, dazu der Vorbehalt einer
// Schätzung. Er wird mitgedruckt: Er erklärt die Zeilen „Anteil … aus der Rechnung …“ und ist Teil der
// Berechnungsgrundlagen nach § 7 Abs. 3 CO2KostAufG.
import { fmtDate, fmtEuro } from './api'
import { formatDayRange } from '../../shared/period.ts'
import type { FuelMethod, HeatingStatement } from './types'

export type FuelBlockView = { title: string; rows: { label: string; value: string }[]; notes: string[] }

export const FUEL_METHOD_LABELS: Record<FuelMethod, string> = {
  entered: 'eingetragener Anteil',
  measured: 'nach Zählerstand',
  inside: 'ganz in der Heizperiode',
  parts: 'nach Teilmengen laut Rechnung',
  localDegreeDays: 'nach den Gradtagzahlen des Orts',
  degreeDays: 'nach der Gradtagszahlentabelle',
}

const num = (n: number, digits: number): string => n.toLocaleString('de-DE', { maximumFractionDigits: digits })

export function fuelBlock(h: HeatingStatement): FuelBlockView | null {
  const f = h.fuel
  if (!f || (f.deliveries.length === 0 && f.carries.length === 0)) return null
  const rows = f.deliveries.map((d) => {
    const range = d.from && d.to ? ` (${formatDayRange(d.from, d.to)})` : ''
    const label = `${d.label || 'Lieferung'}${range}`
    if (d.estimated) return { label, value: `geschätzt, ${fmtEuro(d.inPeriodCents ?? d.amountCents ?? 0)}` }
    const amount = d.inPeriodCents !== null && d.amountCents !== null ? ` = ${fmtEuro(d.inPeriodCents)} von ${fmtEuro(d.amountCents)}` : ''
    const kg = d.emissionsKg !== null ? `, ${num(d.emissionsKg, 1)} kg CO₂` : ''
    return { label, value: `${num(d.sharePermille, 2)} ‰ ${FUEL_METHOD_LABELS[d.method]}${amount}${kg}` }
  })
  if (f.emissionsKg !== null) {
    rows.push({ label: 'CO₂-Ausstoß, umgerechnet auf die Heizperiode', value: `${num(f.emissionsKg, 1)} kg (die Rechnungen decken ${num(f.coveragePermille, 1)} ‰ der Gradtage ab)` })
  }
  const notes = [
    ...f.deliveries.filter((d) => d.estimated && d.from && d.to).map((d) =>
      `Die Brennstoffkosten vom ${fmtDate(d.from ?? '')} bis ${fmtDate(d.to ?? '')} sind geschätzt, weil die Rechnung des Versorgers noch nicht vorlag. Eine Nachberechnung bleibt vorbehalten.`),
    ...f.gaps.map((g) => `Für ${formatDayRange(g.from, g.to)} lag keine Rechnung vor.`),
  ]
  return { title: `Brennstoff ${h.plantName || 'Heizanlage'}, Heizperiode ${fmtDate(h.from)} – ${fmtDate(h.to)}`, rows, notes }
}

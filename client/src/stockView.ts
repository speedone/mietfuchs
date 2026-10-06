// Der Druckblock „Bestandsrechnung Brennstoff“ (Heizung PR 8, Entwurf 8.2, 9.5). Er gehört zu den
// Berechnungsgrundlagen des Ausweises nach § 7 Abs. 3 CO2KostAufG und erklärt die Zeilen „aus dem
// Vorrat“ und „im Vorrat“; gedruckt wird er mit.
import { fmtDate, fmtEuro } from './api'
import { STOCK_UNIT_TEXT } from '../../shared/fuelStock.ts'
import { co2CostsCountedFrom } from '../../shared/law/co2kostaufg.ts'
import { germanDate } from '../../shared/law/register.ts'
import type { HeatingStatement, Statement } from './types'

export type StockBlockView = { title: string; lines: { label: string; value: string }[]; notes: string[] }

const amount = (n: number): string => n.toLocaleString('de-DE', { maximumFractionDigits: 2 })

export function stockBlock(h: HeatingStatement): StockBlockView | null {
  const s = h.stock
  if (!s) return null
  const q = (n: number): string => `${amount(n)} ${STOCK_UNIT_TEXT[s.unit]}`
  const euro = (c: number | null): string => (c === null ? 'Betrag unbekannt' : fmtEuro(c))
  const lines = [
    { label: 'Anfangsbestand', value: `${q(s.opening.quantity)} · ${euro(s.opening.costCents)}` },
    ...s.deliveries.map((d) => ({ label: d.label, value: `${q(d.quantity)} · ${euro(d.costCents)}` })),
    {
      label: s.closingMeasuredOn && s.closingMeasuredOn !== h.to ? `Endbestand (gepeilt am ${fmtDate(s.closingMeasuredOn)})` : 'Endbestand',
      value: `${q(s.closing.quantity)} · ${euro(s.closing.costCents)}`,
    },
    { label: 'Verbraucht', value: `${q(s.consumed.quantity)} · ${euro(s.consumed.costCents)} · ${amount(s.consumed.emissionsKg)} kg CO₂ · CO₂-Kosten ${fmtEuro(s.consumed.co2Cents)}` },
  ]
  const notes = ['Verbraucht wird das Älteste zuerst; den Endbestand bewertet Mietfuchs wie die Messdienste zu den Preisen der jüngsten Lieferungen.']
  if (s.oldStockKg > 0) {
    notes.push(`Davon ${amount(s.oldStockKg)} kg CO₂ aus Brennstoff mit Rechnung vor dem ${germanDate(co2CostsCountedFrom())}: Sie zählen für die Einstufung, CO₂-Kosten trägt er nicht (§ 11 Abs. 2 Satz 2 CO2KostAufG).`)
  }
  if (s.openingSource === 'frozen') notes.push('Der Anfangsbestand ist der eingefrorene Endbestand der abgeschlossenen Vorperiode.')
  return { title: 'Bestandsrechnung Brennstoff', lines, notes }
}

// Beim Mieter steht der Block, wenn er einen Übertrag dieser Anlage trägt oder einen CO₂-Abzug aus ihr.
export function showsStock(h: HeatingStatement, st: Pick<Statement, 'tenancyId' | 'rows'>): boolean {
  if (!h.stock) return false
  const prefix = `stock:${h.plantId}:${h.period}:`
  return st.rows.some((r) => r.costItemId.startsWith(prefix)) || (h.co2?.tenants.some((t) => t.tenancyId === st.tenancyId) ?? false)
}

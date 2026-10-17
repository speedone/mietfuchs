// Der Druckblock „Bestandsrechnung Brennstoff“ (Heizung PR 8, Entwurf 8.2, 9.5). Er gehört zu den
// Berechnungsgrundlagen des Ausweises nach § 7 Abs. 3 CO2KostAufG und erklärt die Zeilen „aus dem
// Vorrat“ und „im Vorrat“; gedruckt wird er mit.
import { fmtDate, fmtEuro } from './api'
import { STOCK_UNIT_TEXT } from '../../shared/fuelStock.ts'
import { CO2_ENERGIES } from './fuelForm'
import { co2CostsCountedFrom } from '../../shared/law/co2kostaufg.ts'
import { germanDate } from '../../shared/law/register.ts'
import type { HeatingStatement, Statement } from './types'

export type StockBlockView = { title: string; lines: { label: string; value: string }[]; notes: string[] }

const amount = (n: number): string => n.toLocaleString('de-DE', { maximumFractionDigits: 2 })

export function stockBlock(h: HeatingStatement): StockBlockView | null {
  const s = h.stock
  if (!s) return null
  // CO₂-Angaben nur bei Brennstoffen, deren CO₂-Kosten aufzuteilen sind (Durchsicht von #237, I4).
  const co2 = CO2_ENERGIES.includes(h.energy)
  const unit = STOCK_UNIT_TEXT[s.unit]
  const q = (n: number): string => `${amount(n)} ${unit}`
  const euro = (c: number | null): string => (c === null ? 'Betrag unbekannt' : fmtEuro(c))
  const value = (x: { quantity: number; costCents: number | null; emissionsKg: number; co2Cents: number }): string =>
    `${q(x.quantity)} · ${euro(x.costCents)}${co2 ? ` · ${amount(x.emissionsKg)} kg CO₂ · CO₂-Kosten ${fmtEuro(x.co2Cents)}` : ''}`
  // Die Lieferungen mit Datum (§ 7 Abs. 3 CO2KostAufG: Berechnungsgrundlagen); eine Bezeichnung
  // „Lieferung vom …“ trägt es schon.
  const named = (label: string, date: string | null): string =>
    date === null || label.includes(fmtDate(date)) ? label : `„${label}“ vom ${fmtDate(date)}`
  const quoted = (label: string, date: string | null): string => {
    const n = named(label, date)
    return n.startsWith('„') ? n : `„${n}“`
  }
  // Der Endbestand nach seiner Herkunft, mit dem Preis je Einheit (I3).
  const layers = s.closing.layers.map((l) => ({
    label: `davon aus ${quoted(l.label, l.date)}`,
    value: `${q(l.quantity)}${l.costCents === null || l.quantity <= 0 ? '' : ` zu ${(l.costCents / 100 / l.quantity).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €/${unit}`}`,
  }))
  const lines = [
    { label: 'Anfangsbestand', value: value(s.opening) },
    ...s.deliveries.map((d) => ({ label: named(d.label, d.date), value: value(d) })),
    {
      label: s.closingMeasuredOn && s.closingMeasuredOn !== h.to ? `Endbestand (abgelesen am ${fmtDate(s.closingMeasuredOn)})` : 'Endbestand',
      value: value(s.closing),
    },
    ...layers,
    { label: 'Verbraucht', value: value(s.consumed) },
  ]
  const notes = ['Verbraucht wird rechnerisch das Älteste zuerst (Kinne/Schach/Bieber-Kinne, BGB § 556 Rn. 121); der Endbestand hat deshalb die Preise der jüngsten Lieferungen.']
  if (co2 && s.oldStockKg > 0) {
    notes.push(`Davon ${amount(s.oldStockKg)} kg CO₂ aus Brennstoff mit Rechnung vor dem ${germanDate(co2CostsCountedFrom())}: Diese kg zählen für die Einstufung, CO₂-Kosten trägt dieser Brennstoff nicht (§ 11 Abs. 2 Satz 2 CO2KostAufG).`)
  }
  if (s.openingSettledCents !== undefined) {
    notes.push(`Der Anfangsbestand ist schon mit einer früheren Abrechnung umgelegt worden${s.openingSettledCents !== null && s.openingSettledCents > 0 ? ` (Wert laut Eintrag ${fmtEuro(s.openingSettledCents)})` : ''}; er zählt hier mit 0 €${co2 ? ' und ohne CO₂-Kosten' : ''}.`)
  }
  if (s.openingSource === 'frozen') notes.push('Der Anfangsbestand ist der eingefrorene Endbestand der abgeschlossenen Vorperiode.')
  if (s.handover && s.handover.costCents === 0 && (s.closing.costCents ?? 0) > 0) {
    notes.push('Der Endbestand geht mit 0 € in die nächste Heizperiode, denn diese Abrechnung verteilt die Rechnungen ohne Übertrag.')
  }
  return { title: 'Bestandsrechnung Brennstoff', lines, notes }
}

// Beim Mieter steht der Block, wenn er einen Übertrag dieser Anlage trägt oder einen CO₂-Abzug aus ihr.
export function showsStock(h: HeatingStatement, st: Pick<Statement, 'tenancyId' | 'rows'>): boolean {
  if (!h.stock) return false
  const prefix = `stock:${h.plantId}:${h.period}:`
  return st.rows.some((r) => r.costItemId.startsWith(prefix)) || (h.co2?.tenants.some((t) => t.tenancyId === st.tenancyId) ?? false)
}

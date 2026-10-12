// Die Karte „Monatliche Verbrauchsinformation“ der Seite Heizkosten und das Blatt je Mieter (Heizung PR 22),
// ohne DOM. Die Komponenten rendern nur.
import { fmtDate } from './api'
import { parseDecimal } from './co2Form'
import { addMonths, MONTHLY_INFO_GAP_TEXT, monthBounds, monthName } from '../../shared/monthlyInfo.ts'
import type { MonthlyInfoAmounts, MonthlyInfoGap, MonthlyInfoMonth, MonthlyInfoRow, MonthlyInfoUser, MonthlyInfoView } from './types'

export type MonthlyRowForm = { reference: string; source: string; sentOn: string }
export const EMPTY_ROW_FORM: MonthlyRowForm = { reference: '', source: '', sentOn: '' }

const kwh = (n: number): string => `${Math.round(n).toLocaleString('de-DE')} kWh`
const m3 = (n: number): string => `${n.toLocaleString('de-DE', { maximumFractionDigits: 3 })} m³`

export function rowToForm(row: MonthlyInfoRow | null): MonthlyRowForm {
  return {
    reference: row?.referenceKwhPerM2 == null ? '' : row.referenceKwhPerM2.toLocaleString('de-DE', { maximumFractionDigits: 3, useGrouping: false }),
    source: row?.referenceSource ?? '',
    sentOn: row?.sentOn ?? '',
  }
}

// Dieselben Sätze wie die Prüfung des Servers (db/monthlyInfo.ts).
export function rowBody(form: MonthlyRowForm): { body: { referenceKwhPerM2: number | null; referenceSource: string | null; sentOn: string | null } } | { error: string } {
  const text = form.reference.trim()
  const ref = text === '' ? null : parseDecimal(text)
  if (text !== '' && (ref === null || !(ref > 0))) return { error: 'Der Vergleichswert ist eine Zahl größer als 0 (kWh je m² Wohnfläche im Monat).' }
  const source = form.source.trim() || null
  if (ref !== null && source === null) return { error: 'Bitte nennen Sie die Quelle des Vergleichswerts, etwa die Vergleichsdaten Ihres Ablesedienstes.' }
  return { body: { referenceKwhPerM2: ref, referenceSource: source, sentOn: form.sentOn || null } }
}

// Die mittlere Warmwassertemperatur bei getrenntem Warmwasser, mit der Prüfung des Servers (readFormulaInputs in
// server/src/db/co2.ts, wie in der Karte „Warmwasser“).
export function tempBody(text: string): { body: { dhwTempC: number | null } } | { error: string } {
  const t = text.trim()
  if (t === '') return { body: { dhwTempC: null } }
  const v = parseDecimal(t)
  if (v === null || !(v > 0 && v < 100)) return { error: 'Die mittlere Temperatur des Warmwassers liegt zwischen 0 und 100 °C.' }
  return { body: { dhwTempC: v } }
}

export const gapText = (g: MonthlyInfoGap): string => MONTHLY_INFO_GAP_TEXT[g]

export function monthStatus(m: MonthlyInfoMonth): { text: string; tone: 'ok' | 'open' | 'warn' | 'none' } {
  if (!m.due) return { text: 'noch nicht fällig', tone: 'none' }
  if (m.users.length === 0) return { text: 'kein Mieter in diesem Monat', tone: 'none' }
  if (!m.complete) return { text: `unvollständig: ${[...new Set(m.users.flatMap((u) => u.gaps))].map(gapText).join('; ')}`, tone: 'warn' }
  if (!m.sent || !m.row?.sentOn) return { text: 'noch nicht mitgeteilt', tone: 'open' }
  return { text: `mitgeteilt am ${fmtDate(m.row.sentOn)}`, tone: 'ok' }
}

// Der Vergleichswert der Heizperiode (Angaben nach § 6a Abs. 3 Nr. 4) als Hinweis an der Karte (Prüfung S13):
// dieselbe Herkunft, aber eine andere Bezugsgröße; aufgeteilt wird er nicht.
export function periodReferenceText(ref: MonthlyInfoView['periodReference']): string | null {
  if (ref === null) return null
  return `Für die Angaben zur Heizkostenabrechnung haben Sie für die ganze Heizperiode ${ref.kwhPerM2.toLocaleString('de-DE')} kWh je m² eingetragen${ref.source ? ` (Quelle: ${ref.source})` : ''}. ` +
    'Für jeden Monat braucht es einen eigenen Wert; Mietfuchs teilt den Wert der Heizperiode nicht auf, denn der Verbrauch verteilt sich nicht gleichmäßig über das Jahr.'
}

// Eine frühere Zeile: jede Größe für sich, keine Summe.
function amountsText(a: MonthlyInfoAmounts | null): string {
  if (a === null) return 'nicht erhoben'
  const parts: string[] = []
  if (a.heatKwh !== null) parts.push(`Heizung ${kwh(a.heatKwh)}`)
  if (a.dhwM3 !== null) parts.push(`Warmwasser ${m3(a.dhwM3)}${a.dhwKwh !== null ? ` (umgerechnet etwa ${kwh(a.dhwKwh)})` : ''}`)
  return parts.length > 0 ? parts.join(', ') : 'nicht erhoben'
}

// Die Zeilen des Blatts eines Mieters (§ 6a Abs. 2 Nr. 1 bis 3). Es nennt keinen anderen Nutzer (Begründung:
// keine personenbezogenen Daten). Heizung (gemessen) und Warmwasser (gemessen in m³, umgerechnet in kWh)
// stehen getrennt; eine Summe bildet es nicht, weil die umgerechnete Wärme die Verluste der Erzeugung enthält.
export function sheetLines(m: MonthlyInfoMonth, u: MonthlyInfoUser): string[] {
  const whole = monthBounds(m.month)
  const part = u.from !== whole.from || u.to !== whole.to ? ` (${fmtDate(u.from)} bis ${fmtDate(u.to)})` : ''
  const lines = [`Ihr Verbrauch im ${monthName(m.month)}${part}:`]
  if (u.heatKwh !== null) lines.push(`Heizung: ${kwh(u.heatKwh)} (gemessen)`)
  if (u.dhwM3 !== null) {
    lines.push(u.dhwKwh !== null
      ? `Warmwasser: ${m3(u.dhwM3)} (gemessen); umgerechnet etwa ${kwh(u.dhwKwh)}, angelehnt an § 9 Abs. 2 Satz 2 HeizkostenV einschließlich der Verluste der Erzeugung`
      : `Warmwasser: ${m3(u.dhwM3)} (gemessen), nicht in kWh umgerechnet (Temperatur fehlt)`)
  }
  if (u.heatKwh === null && u.dhwM3 === null) lines.push('nicht vollständig erhoben')
  lines.push(`${monthName(addMonths(m.month, -1))}: ${amountsText(u.previousMonth)}`)
  lines.push(`${monthName(addMonths(m.month, -12))}: ${amountsText(u.previousYear)}`)
  if (u.referenceKwh !== null && m.row?.referenceSource) {
    lines.push(`Ein Durchschnittsnutzer mit ${u.areaM2.toLocaleString('de-DE')} m² Wohnfläche: ${kwh(u.referenceKwh)} (Quelle: ${m.row.referenceSource})`)
  }
  return lines
}

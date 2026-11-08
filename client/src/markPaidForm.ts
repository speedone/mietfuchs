// „Offene Monate als bezahlt erfassen“ im Mietkonto (#608), ohne DOM, damit es prüfbar bleibt (markPaidForm.test.ts).
// Den Plan rechnet der Server (server/src/markPaid.ts); hier stehen Auswahl, Vorgaben, die Prüfung vor der Vorschau und
// die Sätze. Die Seite rendert nur.
import type { MarkPaidPlan, RentLedgerRow } from './types'
import type { Checked } from './formProblems'
import { fmtEuro } from './api'
import { monthLabel, parseMonthText } from './monthText'

// Der Zustand des Seitenfensters (`value` des Drawer): ein Mietverhältnis oder alle, und „Bis Monat“ wie eingegeben.
export type MarkPaidValue = { tenancyId: string; through: string }
export type MarkPaidField = 'tenancyId' | 'through'
export const ALL_TENANCIES = 'all'

type Row = Pick<RentLedgerRow, 'tenancyId' | 'tenantName' | 'unitName'>
const pad = (n: number): string => String(n).padStart(2, '0')
const currentMonth = (today: Date): string => `${today.getFullYear()}-${pad(today.getMonth() + 1)}`

// Die Auswahl „Mietverhältnis“: alle, dann die Zeilen des Mietkontos (Mietverhältnisse mit Tagen im Jahr).
export function markPaidTenancyOptions(rows: readonly Row[]): { value: string; label: string }[] {
  return [{ value: ALL_TENANCIES, label: 'Alle Mietverhältnisse' }, ...rows.map((r) => ({ value: r.tenancyId, label: `${r.tenantName} · ${r.unitName}` }))]
}

// Vorgabe beim Öffnen: alle, im laufenden Jahr bis zum aktuellen Monat, in früheren Jahren bis Dezember. Örtlich.
export function markPaidStart(year: number, today: Date): MarkPaidValue {
  return { tenancyId: ALL_TENANCIES, through: year < today.getFullYear() ? `${year}-12` : currentMonth(today) }
}

// Warum der Knopf gesperrt ist, oder `null`.
export function markPaidBlocked(rows: readonly Row[], year: number, today: Date): string | null {
  if (rows.length === 0) return `Für ${year} gibt es keine Mietverhältnisse.`
  if (year > today.getFullYear()) return `Im Jahr ${year} ist noch kein Monat vergangen.`
  return null
}

export type MarkPaidBody = { tenancyIds: string[]; through: string }

// Der Rumpf der Vorschau, oder die Meldung am Feld. Der Server prüft dasselbe noch einmal.
export function markPaidRequest(value: MarkPaidValue, rows: readonly Row[], year: number, today: Date): Checked<MarkPaidBody, MarkPaidField> {
  const ids = value.tenancyId === ALL_TENANCIES ? rows.map((r) => r.tenancyId) : rows.some((r) => r.tenancyId === value.tenancyId) ? [value.tenancyId] : []
  if (ids.length === 0) return { problems: [{ field: 'tenancyId', short: 'Mietverhältnis fehlt', text: 'Mietverhältnis: Wählen Sie, für wen die Monate als bezahlt erfasst werden.' }] }
  const month = parseMonthText(value.through)
  if (month.kind === 'empty') return { problems: [{ field: 'through', short: 'Monat fehlt', text: `Bis Monat: Geben Sie den Monat ein, bis zu dem die Mieten eingegangen sind, etwa „3.${year}“.` }] }
  if (month.kind === 'invalid') return { problems: [{ field: 'through', short: month.short, text: `Bis Monat: ${month.text}` }] }
  if (!month.key.startsWith(`${year}-`)) return { problems: [{ field: 'through', short: `Nicht in ${year}`, text: `Bis Monat: Wählen Sie einen Monat im Jahr ${year}.` }] }
  const now = currentMonth(today)
  if (month.key > now) return { problems: [{ field: 'through', short: 'Monat liegt in der Zukunft', text: `Bis Monat: Künftige Monate lassen sich nicht als bezahlt erfassen; wählen Sie höchstens ${monthLabel(now)}.` }] }
  return { body: { tenancyIds: ids, through: month.key } }
}

// Der Satz über der Vorschau.
export const MARK_PAID_EXPLAIN =
  'Je offenem Monat legt Mietfuchs eine Mietzahlung über den offenen Rest an. Jede gilt dem genannten Monat, wie „Für Monat“ an einer Zahlung, ' +
  'und trägt den Fälligkeitstag als Datum, höchstens heute. Ging eine Miete später oder in anderer Höhe ein, ändern Sie danach die Zahlung; eine Teilzahlung erfassen Sie mit „+ Zahlung anlegen“.'

// „Bis Monat“ wie eingegeben („3.2026“ oder „2026-03“).
export function emptyPlanText(through: string): string {
  const month = parseMonthText(through)
  return `Bis ${month.kind === 'month' ? monthLabel(month.key) : through} ist nichts offen.`
}

// Rückwirkende Zahlungen können das Mietkonto früher beginnen lassen (Beginn der Erfassung im Objekt).
export function affectedText(plan: Pick<MarkPaidPlan, 'othersAffected'>): string | null {
  if (plan.othersAffected.length === 0) return null
  const list = plan.othersAffected.map((a) => `${a.tenantName} (${a.unitName}): Rückstand bisher ${fmtEuro(a.beforeCents)}, danach ${fmtEuro(a.afterCents)}`).join('; ')
  return 'Das Mietkonto des Objekts beginnt mit der frühesten erfassten Mietzahlung. Mit diesen Zahlungen beginnt es früher, und Monate, die bisher nicht erfasst waren, zählen dann mit: ' +
    `${list}. Erfassen Sie die Zahlungen dieser Monate, oder wählen Sie die Mietverhältnisse mit.`
}

// Geplante Monate, die nach der Nachprüfung des Servers nicht ganz gedeckt sind.
export function unresolvedText(plan: Pick<MarkPaidPlan, 'unresolved'>): string | null {
  if (plan.unresolved.length === 0) return null
  const list = plan.unresolved.map((u) => `${u.tenantName}, ${monthLabel(u.month)} (noch ${fmtEuro(u.openCents)} offen)`).join('; ')
  return `Nicht ganz gedeckt bleibt danach: ${list}. Eine Zahlung ohne Monat im Verwendungszweck tilgt dann eine ältere Forderung (§ 366 BGB); prüfen Sie die Zahlungen dieses Mietverhältnisses.`
}

export const createdText = (count: number): string => (count === 1 ? 'Eine Zahlung angelegt.' : `${count} Zahlungen angelegt.`)

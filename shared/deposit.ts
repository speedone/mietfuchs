// Die Kaution eines Mietverhältnisses (#228): der Stand aus den Kautionsbuchungen und die Höchstgrenze nach
// § 551 Abs. 1 BGB. Rein und für beide Seiten: Der Server prüft damit jede Buchung, die Oberfläche zeigt denselben
// Stand. Die Kaution ist keine Einnahme; nichts hier berührt das Mietkonto oder die Steuer.
import { bgbDepositMaxMonths } from './law/bgb-betrkv.ts'
import { valueAt } from './law/register.ts'
import type { DepositEntry, DepositStatus, Tenancy } from './types.ts'

export type DepositState = {
  // false: keine Buchung, es gilt der am Mietverhältnis gespeicherte Stand.
  derived: boolean
  status: DepositStatus
  receivedCents: number
  interestCents: number
  appliedCents: number
  refundedCents: number
  // received + interest − applied − refunded: was beim Vermieter liegt.
  balanceCents: number
}

// Die Wirkung einer Buchung auf den Stand: Eingang und Ertrag erhöhen, Verrechnung und Rückzahlung mindern.
export const depositDelta = (entry: Pick<DepositEntry, 'kind' | 'amountCents'>): number =>
  entry.kind === 'received' || entry.kind === 'interest' ? entry.amountCents : -entry.amountCents

// Der Stand. Die Regeln gelten in dieser Reihenfolge (Entwurf 2026-11-12, „Der Stand“):
// 1. ohne Buchung der gespeicherte Stand, sonst `offen`;
// 2. nichts eingegangen: `offen` (ein Ertrag allein ist kein Eingang);
// 3. verrechnet oder ausgezahlt und nichts mehr da: `zurückgezahlt`;
// 4. vereinbarte Kaution bekannt und weniger eingegangen: `teilweise`;
// 5. sonst `erhalten`.
// Der gespeicherte Stand wird nie überschrieben: Löscht jemand alle Buchungen, gilt er wieder.
export function depositState(tenancy: Pick<Tenancy, 'depositCents' | 'depositStatus'>, entries: readonly DepositEntry[]): DepositState {
  const sum = (kind: DepositEntry['kind']): number => entries.reduce((a, e) => (e.kind === kind ? a + e.amountCents : a), 0)
  const receivedCents = sum('received')
  const interestCents = sum('interest')
  const appliedCents = sum('applied')
  const refundedCents = sum('refunded')
  const balanceCents = receivedCents + interestCents - appliedCents - refundedCents
  const amounts = { receivedCents, interestCents, appliedCents, refundedCents, balanceCents }
  if (entries.length === 0) return { derived: false, status: tenancy.depositStatus ?? 'offen', ...amounts }
  const status: DepositStatus =
    receivedCents === 0 ? 'offen'
    : appliedCents + refundedCents > 0 && balanceCents <= 0 ? 'zurückgezahlt'
    : tenancy.depositCents !== undefined && receivedCents < tenancy.depositCents ? 'teilweise'
    : 'erhalten'
  return { derived: true, status, ...amounts }
}

// Der erste Tag, an dem der Stand unter 0 fiele: Es kann nicht mehr verrechnet oder ausgezahlt werden, als bis dahin
// eingegangen ist. Geordnet nach dem Datum, am selben Tag in der Reihenfolge der Liste (die Sortierung ist stabil).
// ISO-Daten vergleichen sich Zeichen für Zeichen richtig, unabhängig von der Locale.
export function depositProblem(entries: readonly DepositEntry[]): { date: string; balanceCents: number } | null {
  const ordered = [...entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  let balanceCents = 0
  for (const e of ordered) {
    balanceCents += depositDelta(e)
    if (balanceCents < 0) return { date: e.date, balanceCents }
  }
  return null
}

// Die Höchstgrenze nach § 551 Abs. 1 BGB in Cent: das Dreifache der Monatsmiete ohne die als Pauschale oder als
// Vorauszahlung ausgewiesenen Betriebskosten. Maßgeblich ist die Kaltmiete, mit der das Mietverhältnis beginnt; eine
// spätere Staffel ändert die Grenze nicht. Bei einer Inklusivmiete sind keine Betriebskosten ausgewiesen, also zählt
// die ganze Miete (sie steht in der Staffel der Kaltmiete). `null` heißt kein Wert und damit kein Hinweis: ohne
// Kaltmiete am Beginn, und bei teilweise inklusiver Miete, weil dort nicht feststeht, welcher Teil der Staffel Miete
// ist. `at` ist der Tag, dessen Fassung des Gesetzes gilt; ohne Angabe der Mietbeginn.
export function depositLimit(tenancy: Pick<Tenancy, 'start' | 'baseRents' | 'costModel' | 'heatingModel'>, at?: string): number | null {
  if ((tenancy.costModel === 'inclusive') !== (tenancy.heatingModel === 'inclusive')) return null
  const startMonth = tenancy.start.slice(0, 7)
  let rent: number | null = null
  let from = ''
  for (const r of tenancy.baseRents) {
    if (r.from <= startMonth && r.from >= from) {
      rent = r.monthlyCents
      from = r.from
    }
  }
  if (rent === null || rent <= 0) return null
  return valueAt(bgbDepositMaxMonths, at ?? tenancy.start) * rent
}

// Die Aufstellung zum Auszug (#228, Teil 2), ohne DOM prüfbar (depositSettlement.test.ts). Sie zeigt, was mit der
// Kaution geschehen ist, den Einbehalt mit Grund und was auszuzahlen bleibt. Darunter als Orientierung die jüngste
// abgeschlossene Abrechnung des Mieters und die Zeiträume, deren Abrechnung noch aussteht. Kein Vorschlag und kein
// Prozentsatz für den Einbehalt: Die Rechtsprechung dazu ist nicht gelesen (Entwurf, Abschnitt Recht).
import { depositState } from '../../shared/deposit.ts'
import { fmtEuro } from './api'
import { depositKindText, signedCents } from './depositForm'
import type { DepositEntry, DepositStatementInfo, Tenancy } from './types'

export type DepositSettlement = {
  rows: { label: string; cents: number; date: string; note?: string }[]
  balanceCents: number
  hold: { cents: number; note: string } | null
  payoutCents: number
  lastStatement: string | null
  // Die jüngste getrennte Heizkostenabrechnung einer Anlage (Weg d), wenn es eine gibt.
  lastHeatingStatement: string | null
  pending: string[]
}

const ORDER: Record<DepositEntry['kind'], number> = { received: 0, interest: 1, applied: 2, refunded: 3 }

// `null`, solange das Mietende fehlt oder nach `today` liegt, und ohne Buchung (dann weiß Mietfuchs nicht, was wo liegt).
export function depositSettlement(
  tenancy: Pick<Tenancy, 'end' | 'depositCents' | 'depositStatus' | 'depositHoldCents' | 'depositHoldNote'>,
  entries: readonly DepositEntry[],
  info: DepositStatementInfo | undefined,
  today: string,
): DepositSettlement | null {
  if (tenancy.end === null || tenancy.end > today || entries.length === 0) return null
  const state = depositState(tenancy, entries)
  const rows = [...entries]
    .sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((e) => ({ label: depositKindText(e), cents: signedCents(e), date: e.date, ...(e.note ? { note: e.note } : {}) }))
  const balanceCents = Math.max(0, state.balanceCents)
  const holdCents = Math.min(tenancy.depositHoldCents ?? 0, balanceCents)
  const hold = holdCents > 0 ? { cents: holdCents, note: tenancy.depositHoldNote ?? '' } : null
  const last = info?.last
  const saldo = (b: number): string => (b > 0 ? `Guthaben ${fmtEuro(b)}` : b < 0 ? `Nachzahlung ${fmtEuro(-b)}` : 'ausgeglichen')
  return {
    rows,
    balanceCents,
    hold,
    payoutCents: balanceCents - holdCents,
    lastStatement: last ? `Nebenkostenabrechnung ${last.label}: ${saldo(last.balanceCents)}` : null,
    lastHeatingStatement: info?.lastHeating ? `Heizkostenabrechnung ${info.lastHeating.label}: ${saldo(info.lastHeating.balanceCents)}` : null,
    pending: (info?.pending ?? []).map((label) => `Abrechnung für ${label} steht noch aus`),
  }
}

// Die Zeilen „Kaution nach Auszug“ im Cockpit (#228): Mietverhältnisse, deren Ende erreicht ist und bei denen laut den
// Buchungen noch Geld liegt. Ohne Buchungen keine Zeile: Dann weiß Mietfuchs nicht, was wo liegt. Keine Frist, denn eine
// gesetzliche gibt es nicht, und die Rechtsprechung dazu ist nicht gelesen.
export function depositsAfterMoveOut(
  tenancies: readonly Pick<Tenancy, 'id' | 'tenantName' | 'end' | 'depositCents' | 'depositStatus'>[],
  entries: readonly DepositEntry[],
  today: string,
): { tenancyId: string; tenantName: string; end: string; balanceCents: number }[] {
  return tenancies.flatMap((t) => {
    if (t.end === null || t.end > today) return []
    const own = entries.filter((e) => e.tenancyId === t.id)
    if (own.length === 0) return []
    const balanceCents = depositState(t, own).balanceCents
    return balanceCents > 0 ? [{ tenancyId: t.id, tenantName: t.tenantName, end: t.end, balanceCents }] : []
  })
}

// Der Hinweis der Steuer (#228): Was im Jahr mit Schaden oder Sonstigem verrechnet wurde, steht nicht in den Einnahmen.
// Die Verrechnung mit Miete oder Abrechnung zählt dort schon über ihre Zahlung. Die steuerliche Einordnung eines
// einbehaltenen Schadensersatzes ist nicht belegt; deshalb nennt der Satz nur den Betrag.
export function depositAppliedText(entries: readonly DepositEntry[], year: number): string | null {
  const cents = entries
    .filter((e) => e.kind === 'applied' && (e.purpose === 'damage' || e.purpose === 'other') && e.date.startsWith(`${year}-`))
    .reduce((sum, e) => sum + e.amountCents, 0)
  return cents > 0 ? `Aus Kautionen einbehalten, nicht in den Einnahmen enthalten: ${fmtEuro(cents)}. Ob und wo das anzugeben ist, hängt vom Grund ab.` : null
}

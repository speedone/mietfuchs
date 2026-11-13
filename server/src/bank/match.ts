// Der Vorschlag zu einem offenen Kontoumsatz (#188, Teil 2): welches Mietverhältnis, was daraus wird, und wie sicher.
// Rein. Gebucht wird nichts ohne Entscheidung des Vermieters; der Vorschlag ist nur die Voreinstellung der Seite.
//
// Regeln (docs/superpowers/specs/2026-11-12-kontoauszug-design.md, „Zuordnen und Buchen“):
// 1. Mietverhältnis nur über die IBAN der Gegenseite (Mieter, sonst gemerkter Zahler). Name und Zweck allein reichen nie.
// 2. Eine schon erfasste, nicht verknüpfte Zahlung gleichen Betrags innerhalb von 7 Tagen wird verknüpft statt neu
//    angelegt.
// 3. Art: Rücklastschrift, Kaution, Ausgang an den Mieter, sonst Miete. Der Monat wird nie gesetzt.
// 4. Ampel: grün nur, wenn alles eindeutig ist.
// Naht für #308 (Nachzahlung am Betrag erkennen): eine weitere Regel zwischen Kaution und Ausgang.

import { depositState } from '../../../shared/deposit.ts'
import { germanDate } from '../../../shared/law/register.ts'
import type { BankLinkTarget, BankSuggestion, DepositEntry, Payment, Tenancy } from '../../../shared/types.ts'
import { addIsoDays } from './coverage.ts'
import { normalizeIban } from './statement.ts'
import type { BankTransaction, TenancyPayer } from './model.ts'

export type MatchTenancy = Pick<Tenancy, 'id' | 'start' | 'end' | 'depositCents'> & { iban?: string | null }

export type MatchContext = {
  tenancies: readonly MatchTenancy[]
  payers: readonly TenancyPayer[]
  payments: readonly Payment[]
  linkedPaymentIds: ReadonlySet<string>
  depositEntries: readonly DepositEntry[]
  // Kautionsbuchungen, die schon an einem Umsatz hängen.
  linkedDepositEntryIds: ReadonlySet<string>
  // Soll des Monats laut Mietkonto ('JJJJ-MM'); null, wenn das Mietkonto für den Monat keines kennt.
  monthlySollCents: (tenancyId: string, month: string) => number | null
}

export type LinkTarget = BankLinkTarget

export type Suggestion = BankSuggestion

export const SAME_PAYMENT_DAYS = 7
export const DEPOSIT_WINDOW_DAYS = 31
// Eine erfasste Zahlung in diesem Abstand, die nicht schon „dieselbe“ ist, macht einen sonst grünen Vorschlag gelb
// (Durchsicht I3: Juni-Miete von Hand mit dem 15.06. erfasst, die Bank bucht am 02.06.).
export const NEARBY_PAYMENT_DAYS = 31

const euro = (cents: number): string => `${(cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
const dayNumber = (d: string): number => Date.parse(`${d}T00:00:00Z`) / 86_400_000
const runsOn = (t: MatchTenancy, d: string): boolean => t.start <= d && (t.end === null || d <= t.end)

// Der Betrag, den ein Ziel einem Umsatz zuordnet. Der Link trägt keinen eigenen: Bei einer Zahlung ist es ihr Betrag, bei
// einer Kautionsbuchung der Betrag mit dem Vorzeichen der Art.
export function linkedCents(target: Payment | DepositEntry): number {
  if ('kind' in target && (target.kind === 'applied' || target.kind === 'refunded')) return -target.amountCents
  return target.amountCents
}

// Was von einem Umsatz noch offen ist, mit seinem Vorzeichen. Ein beiseitegelegter ist erledigt.
export function openCents(tx: Pick<BankTransaction, 'amountCents' | 'setAside'>, linked: readonly number[]): number {
  if (tx.setAside !== null) return 0
  return tx.amountCents - linked.reduce((a, c) => a + c, 0)
}

// Regel 1: das Mietverhältnis über die IBAN. Mehrere Treffer: das am Buchungstag laufende, sonst keines.
export function tenancyFor(tx: Pick<BankTransaction, 'counterpartyIban' | 'bookingDate'>, ctx: Pick<MatchContext, 'tenancies' | 'payers'>): MatchTenancy | null {
  if (tx.counterpartyIban === null) return null
  const iban = normalizeIban(tx.counterpartyIban)
  const byTenant = ctx.tenancies.filter((t) => t.iban && normalizeIban(t.iban) === iban)
  const viaPayer = byTenant.length > 0 ? [] : ctx.payers.filter((p) => normalizeIban(p.iban) === iban)
  const hits = byTenant.length > 0 ? byTenant : ctx.tenancies.filter((t) => viaPayer.some((p) => p.tenancyId === t.id))
  if (hits.length === 1) return hits[0] ?? null
  const running = hits.filter((t) => runsOn(t, tx.bookingDate))
  return running.length === 1 ? (running[0] ?? null) : null
}

export function suggest(tx: BankTransaction, ctx: MatchContext): Suggestion | null {
  const t = tenancyFor(tx, ctx)
  if (!t) return null
  const day = dayNumber(tx.bookingDate)
  // Regel 2: schon erfasst.
  const candidates = ctx.payments
    .filter((p) => p.tenancyId === t.id && p.amountCents === tx.amountCents && !ctx.linkedPaymentIds.has(p.id))
    .map((p) => ({ p, distance: Math.abs(dayNumber(p.date) - day) }))
    .filter((c) => c.distance <= SAME_PAYMENT_DAYS)
    .sort((a, b) => a.distance - b.distance)
  const [nearest, second] = candidates
  const tie = nearest !== undefined && second !== undefined && second.distance === nearest.distance
  if (nearest && !tie) {
    return { tenancyId: t.id, target: { type: 'existingPayment', paymentId: nearest.p.id }, light: 'green', reason: `Zahlung vom ${germanDate(nearest.p.date)} schon erfasst` }
  }
  const yellow = (target: LinkTarget, reason: string): Suggestion => ({ tenancyId: t.id, target, light: 'yellow', reason })
  if (tie) return yellow({ type: 'newPayment', kind: 'rent' }, 'Zwei erfasste Zahlungen passen. Bitte wählen Sie.')
  // Regel 2 für die Kaution (Durchsicht I2): eine von Hand erfasste Kautionsbuchung gleicher Richtung und gleichen Betrags.
  const depositKind = tx.amountCents > 0 ? 'received' : 'refunded'
  const deposits = ctx.depositEntries
    .filter((d) => d.tenancyId === t.id && d.kind === depositKind && d.amountCents === Math.abs(tx.amountCents) && !ctx.linkedDepositEntryIds.has(d.id))
    .map((d) => ({ d, distance: Math.abs(dayNumber(d.date) - day) }))
    .filter((c) => c.distance <= SAME_PAYMENT_DAYS)
    .sort((a, b) => a.distance - b.distance)
  const [nearestDeposit, secondDeposit] = deposits
  if (nearestDeposit && !(secondDeposit && secondDeposit.distance === nearestDeposit.distance)) {
    return { tenancyId: t.id, target: { type: 'existingDeposit', depositEntryId: nearestDeposit.d.id }, light: 'green', reason: `Kautionsbuchung vom ${germanDate(nearestDeposit.d.date)} schon erfasst` }
  }
  // Regel 3: Art.
  if (tx.amountCents < 0 && tx.reversal) return yellow({ type: 'newPayment', kind: 'rent' }, 'Rücklastschrift einer Miete')
  const soll = ctx.monthlySollCents(t.id, tx.bookingDate.slice(0, 7))
  if (tx.amountCents > 0 && t.depositCents !== undefined && t.depositCents > 0 && tx.amountCents === t.depositCents && soll !== tx.amountCents
    && Math.abs(day - dayNumber(t.start)) <= DEPOSIT_WINDOW_DAYS) {
    return yellow({ type: 'deposit', kind: 'received' }, 'Betrag wie die vereinbarte Kaution, nahe dem Mietbeginn')
  }
  if (tx.amountCents < 0) {
    const balance = depositState({ depositCents: t.depositCents }, ctx.depositEntries.filter((d) => d.tenancyId === t.id)).balanceCents
    if (t.end !== null && tx.bookingDate > t.end && balance > 0) return yellow({ type: 'deposit', kind: 'refunded' }, 'Auszahlung nach dem Auszug, die Kaution liegt noch bei Ihnen')
    return yellow({ type: 'newPayment', kind: 'settlement' }, 'Auszahlung an den Mieter, etwa ein Guthaben aus der Abrechnung')
  }
  // Regel 4: Ampel.
  const nearby = ctx.payments
    .filter((p) => p.tenancyId === t.id && Math.sign(p.amountCents) === Math.sign(tx.amountCents) && !ctx.linkedPaymentIds.has(p.id))
    .map((p) => ({ p, distance: Math.abs(dayNumber(p.date) - day) }))
    .filter((c) => c.distance <= NEARBY_PAYMENT_DAYS)
    .sort((a, b) => a.distance - b.distance)[0]
  if (nearby) {
    return yellow({ type: 'newPayment', kind: 'rent' }, `Am ${germanDate(nearby.p.date)} ist schon eine Zahlung über ${euro(Math.abs(nearby.p.amountCents))} erfasst. Bitte prüfen Sie, ob es dieselbe ist.`)
  }
  if (soll === null) return yellow({ type: 'newPayment', kind: 'rent' }, 'Für diesen Monat kennt das Mietkonto kein Soll')
  if (soll !== tx.amountCents) return yellow({ type: 'newPayment', kind: 'rent' }, `Betrag weicht vom Soll ab (${euro(soll)})`)
  return { tenancyId: t.id, target: { type: 'newPayment', kind: 'rent' }, light: 'green', reason: 'IBAN bekannt, Betrag wie Monatsmiete' }
}


// Der Vorschlag zu einem offenen Kontoumsatz (#188, Teil 2): welches Mietverhältnis, was daraus wird, und wie sicher.
// Rein. Gebucht wird nichts ohne Entscheidung des Vermieters; der Vorschlag ist nur die Voreinstellung der Seite.
//
// Regeln (docs/superpowers/specs/2026-11-12-kontoauszug-design.md, „Zuordnen und Buchen“):
// 1. Mietverhältnis nur über die IBAN der Gegenseite (Mieter, sonst gemerkter Zahler). Name und Zweck allein reichen nie.
// 2. Eine schon erfasste, nicht verknüpfte Zahlung gleichen Betrags innerhalb von 7 Tagen wird verknüpft statt neu
//    angelegt.
// 3. Art: Rücklastschrift, Kaution (volle Höhe nahe dem Beginn), Ausgang an den Mieter, sonst Miete. Der Monat wird nie
//    gesetzt.
// 4. Ampel: grün nur, wenn alles eindeutig ist; eine erfasste Zahlung gleichen Betrags bis 15 Tage entfernt macht gelb und
//    geht einer Kautionsrate vor (ein Drittel oder „Kaution“ im Zweck, in den ersten 100 Tagen, solange Kaution offen).
// Naht für #308 (Nachzahlung am Betrag erkennen): eine weitere Regel zwischen Kaution und Ausgang.

import { depositState } from '../../../shared/deposit.ts'
import { germanDate } from '../../../shared/law/register.ts'
import type { BankLinkTarget, BankSuggestion, DepositEntry, Payment, Tenancy } from '../../../shared/types.ts'
import { addIsoDays } from './coverage.ts'
import { normalizeIban } from './statement.ts'
import type { BankTransaction, TenancyPayer } from './model.ts'

export type MatchTenancy = Pick<Tenancy, 'id' | 'start' | 'end' | 'depositCents' | 'depositStatus' | 'depositForm'> & { iban?: string | null }

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
// Nur gleicher Betrag (Praxistest vor 0.18.0): Ein anderer Betrag oder die Miete des Vormonats rund 30 Tage davor ist
// keine mögliche Dublette; der Abstand bleibt deshalb bei 15 Tagen (eine Miete vom 15. liegt 18 Tage vor dem 2. des
// Folgemonats).
export const NEARBY_PAYMENT_DAYS = 15
// Raten der Kaution kommen mit den ersten Mieten (§ 551 Abs. 2 BGB); etwas Spielraum für späte Raten.
export const DEPOSIT_RATE_DAYS = 100

const euro = (cents: number): string => `${(cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
const dayNumber = (d: string): number => Date.parse(`${d}T00:00:00Z`) / 86_400_000
const nextMonth = (d: string): string => {
  const [y, m] = d.slice(0, 7).split('-').map(Number) as [number, number]
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}
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
  const entries = ctx.depositEntries.filter((d) => d.tenancyId === t.id)
  // Eine Kaution als Bürgschaft oder verpfändetes Sparbuch kommt nie als Geld aufs Konto (Durchsicht 642/2).
  const moneyDeposit = t.depositCents !== undefined && t.depositCents > 0 && t.depositForm !== 'pledged' && t.depositForm !== 'guarantee'
  const depositOpenCents = (t.depositCents ?? 0) - depositState({ depositCents: t.depositCents }, entries).receivedCents
  if (tx.amountCents > 0 && moneyDeposit && tx.amountCents === t.depositCents && soll !== tx.amountCents
    && tx.amountCents <= depositOpenCents && Math.abs(day - dayNumber(t.start)) <= DEPOSIT_WINDOW_DAYS) {
    return yellow({ type: 'deposit', kind: 'received' }, 'Betrag wie die vereinbarte Kaution, nahe dem Mietbeginn')
  }
  if (tx.amountCents < 0) {
    const balance = depositState({ depositCents: t.depositCents }, entries).balanceCents
    if (t.end !== null && tx.bookingDate > t.end && balance > 0) return yellow({ type: 'deposit', kind: 'refunded' }, 'Auszahlung nach dem Auszug, die Kaution liegt noch bei Ihnen')
    return yellow({ type: 'newPayment', kind: 'settlement' }, 'Auszahlung an den Mieter, etwa ein Guthaben aus der Abrechnung')
  }
  // Regel 4, zuerst (Durchsicht 642/3): Eine erfasste Zahlung gleichen Betrags in der Nähe geht jedem weiteren Vorschlag vor.
  const nearby = ctx.payments
    .filter((p) => p.tenancyId === t.id && p.amountCents === tx.amountCents && !ctx.linkedPaymentIds.has(p.id))
    .map((p) => ({ p, distance: Math.abs(dayNumber(p.date) - day) }))
    .filter((c) => c.distance <= NEARBY_PAYMENT_DAYS)
    .sort((a, b) => a.distance - b.distance)[0]
  if (nearby) {
    return yellow({ type: 'newPayment', kind: 'rent' }, `Am ${germanDate(nearby.p.date)} ist schon eine Zahlung über denselben Betrag erfasst. Bitte prüfen Sie, ob es dieselbe ist.`)
  }
  // Eine Rate der Kaution (Praxistest vor 0.18.0): Eine Geldkaution darf in drei Raten kommen (§ 551 Abs. 2 BGB). Nur in
  // den ersten Monaten, nur solange die vereinbarte nicht ganz eingegangen ist (laut Buchungen; ohne Buchung nicht, wenn die
  // Stammdaten sie schon als erhalten führen) und nur, wenn der Betrag weder dem Soll dieses noch dem des Folgemonats
  // gleicht (ohne Soll vor dem Beginn, anteilig im ersten Monat; Durchsicht 642/1). Dann ist ein Drittel oder „Kaution“
  // im Zweck ein Vorschlag „Kaution erhalten“, gelb. Der Zweck entscheidet nur über die Art, nie über das Mietverhältnis.
  const sinceStart = day - dayNumber(t.start)
  const settledInStock = entries.length === 0 && (t.depositStatus === 'erhalten' || t.depositStatus === 'zurückgezahlt')
  if (tx.amountCents > 0 && moneyDeposit && !settledInStock
    && sinceStart >= -DEPOSIT_WINDOW_DAYS && sinceStart <= DEPOSIT_RATE_DAYS
    && soll !== tx.amountCents && ctx.monthlySollCents(t.id, nextMonth(tx.bookingDate)) !== tx.amountCents
    && tx.amountCents <= depositOpenCents) {
    if (/kaution/i.test(tx.purpose ?? '')) return yellow({ type: 'deposit', kind: 'received' }, '„Kaution“ im Verwendungszweck, und die vereinbarte Kaution ist noch nicht ganz eingegangen')
    if (Math.abs(tx.amountCents * 3 - (t.depositCents ?? 0)) <= 2) return yellow({ type: 'deposit', kind: 'received' }, 'Betrag wie eine Rate der vereinbarten Kaution (ein Drittel)')
  }
  if (soll === null) return yellow({ type: 'newPayment', kind: 'rent' }, 'Für diesen Monat kennt das Mietkonto kein Soll')
  if (soll !== tx.amountCents) return yellow({ type: 'newPayment', kind: 'rent' }, `Betrag weicht vom Soll ab (${euro(soll)})`)
  return { tenancyId: t.id, target: { type: 'newPayment', kind: 'rent' }, light: 'green', reason: 'IBAN bekannt, Betrag wie Monatsmiete' }
}


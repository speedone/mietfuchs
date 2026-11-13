// Zuordnungen planen (#188, Teil 2): aus den Entscheidungen des Vermieters werden Zahlungen, Kautionsbuchungen und
// Verknüpfungen. Rein. Der Server bucht nur, was als Entscheidung im Rumpf steht; die Route plant beim Ausführen in der
// Schreibschlange neu und vergleicht die Marke, wie beim Einlesen.
//
// Feste Regeln: Datum ist der Buchungstag, Notiz der Verwendungszweck (200 Zeichen), **nie ein Monat** (designatedMonth
// setzt nur der Vermieter im Mietkonto). Eine Kaution wird nie Zahlung, sondern Kautionsbuchung mit positivem Betrag.
// Ein Umsatz lässt sich auf mehrere Mietverhältnisse aufteilen; die Teile ergeben höchstens seinen offenen Betrag, der
// Rest bleibt offen.

import crypto from 'node:crypto'
import { depositProblem } from '../../../shared/deposit.ts'
import { germanDate } from '../../../shared/law/register.ts'
import type { DepositEntry, Payment, PaymentKind } from '../../../shared/types.ts'
import { BANK_SET_ASIDE } from '../db/schema.ts'
import { clip, type BankEntry } from './statement.ts'
import type { LinkTarget, MatchContext } from './match.ts'
import type { BankTransaction } from './model.ts'

export type SetAsideReason = (typeof BANK_SET_ASIDE)[number]

export type LinkPart = { tenancyId: string; amountCents: number; target: LinkTarget }
export type LinkDecision =
  | { transactionId: string; parts: LinkPart[] }
  | { transactionId: string; setAside: SetAsideReason }

export type LinkWrite = {
  payments: (Pick<Payment, 'tenancyId' | 'date' | 'amountCents' | 'kind' | 'note'> & { transactionId: string })[]
  depositEntries: (Pick<DepositEntry, 'tenancyId' | 'date' | 'kind' | 'amountCents' | 'note'> & { transactionId: string })[]
  existing: { transactionId: string; paymentId: string }[]
  existingDeposits: { transactionId: string; depositEntryId: string }[]
  setAside: { transactionId: string; reason: SetAsideReason }[]
}

export type LinkProblem = { transactionId: string; message: string }
export type LinkPlan = { writes: LinkWrite; problems: LinkProblem[]; sentence: string }

export const NOTE_LENGTH = 200
export const ALREADY_DONE = 'Dieser Umsatz ist schon zugeordnet.'
export const PAYMENT_ALREADY_LINKED = 'Diese Zahlung ist schon einem Kontoumsatz zugeordnet.'

const euro = (cents: number): string => `${(cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`
const noteOf = (tx: Pick<BankEntry, 'purpose'>): { note?: string } => {
  const note = clip(tx.purpose.trim(), NOTE_LENGTH)
  return note === '' ? {} : { note }
}

export function planBankLinks(
  decisions: readonly LinkDecision[],
  open: readonly { tx: BankTransaction; openCents: number }[],
  ctx: MatchContext,
): LinkPlan {
  const writes: LinkWrite = { payments: [], depositEntries: [], existing: [], existingDeposits: [], setAside: [] }
  // Der Stand der Kaution mit allem, was dieser Lauf schon bucht (Durchsicht I4): Eine Rückzahlung über den Stand ist ein
  // Problem dieses Umsatzes, nicht ein Fehler des ganzen Laufs beim Buchen.
  const plannedDeposits: DepositEntry[] = [...ctx.depositEntries]
  const usedDeposits = new Set<string>()
  const problems: LinkProblem[] = []
  const openById = new Map(open.filter((o) => o.openCents !== 0).map((o) => [o.tx.id, o]))
  const tenancyIds = new Set(ctx.tenancies.map((t) => t.id))
  const decided = new Set<string>()
  const usedPayments = new Set<string>()

  for (const d of decisions) {
    const problem = (message: string): void => {
      problems.push({ transactionId: d.transactionId, message })
    }
    if (decided.has(d.transactionId)) {
      problem('Für diesen Umsatz gibt es zwei Entscheidungen. Bitte laden Sie die Seite neu.')
      continue
    }
    decided.add(d.transactionId)
    const entry = openById.get(d.transactionId)
    if (!entry) {
      problem(ALREADY_DONE)
      continue
    }
    const { tx, openCents } = entry
    if ('setAside' in d) {
      writes.setAside.push({ transactionId: tx.id, reason: d.setAside })
      continue
    }
    const sign = Math.sign(openCents)
    const sum = d.parts.reduce((a, p) => a + p.amountCents, 0)
    const local: LinkWrite = { payments: [], depositEntries: [], existing: [], existingDeposits: [], setAside: [] }
    const localPayments = new Set<string>()
    const localDeposits = new Set<string>()
    let failed = false
    for (const part of d.parts) {
      const fail = (message: string): void => {
        if (!failed) problem(message)
        failed = true
      }
      if (!tenancyIds.has(part.tenancyId)) fail('Dieses Mietverhältnis gibt es nicht (mehr). Bitte laden Sie die Seite neu.')
      else if (part.amountCents === 0 || Math.sign(part.amountCents) !== sign) fail('Ein Teil hat ein anderes Vorzeichen als der Umsatz oder ist 0 €.')
      else if (part.target.type === 'newPayment') {
        local.payments.push({ transactionId: tx.id, tenancyId: part.tenancyId, date: tx.bookingDate, amountCents: part.amountCents, kind: part.target.kind, ...noteOf(tx) })
      } else if (part.target.type === 'deposit') {
        const fits = part.target.kind === 'received' ? part.amountCents > 0 : part.amountCents < 0
        if (!fits) fail(part.target.kind === 'received' ? 'Eine eingegangene Kaution ist ein Eingang.' : 'Eine zurückgezahlte Kaution ist ein Ausgang.')
        else local.depositEntries.push({ transactionId: tx.id, tenancyId: part.tenancyId, date: tx.bookingDate, kind: part.target.kind, amountCents: Math.abs(part.amountCents), ...noteOf(tx) })
      } else if (part.target.type === 'existingDeposit') {
        const depositEntryId = part.target.depositEntryId
        const d = ctx.depositEntries.find((x) => x.id === depositEntryId)
        const signed = d ? (d.kind === 'applied' || d.kind === 'refunded' ? -d.amountCents : d.amountCents) : 0
        if (!d) fail('Diese Kautionsbuchung gibt es nicht (mehr). Bitte laden Sie die Seite neu.')
        else if (ctx.linkedDepositEntryIds.has(d.id) || usedDeposits.has(d.id) || localDeposits.has(d.id)) fail('Diese Kautionsbuchung ist schon einem Kontoumsatz zugeordnet.')
        else if (d.tenancyId !== part.tenancyId || (d.kind !== 'received' && d.kind !== 'refunded') || signed !== part.amountCents) fail('Die erfasste Kautionsbuchung passt nicht zu diesem Teil: Mietverhältnis, Art oder Betrag weichen ab.')
        else {
          localDeposits.add(d.id)
          local.existingDeposits.push({ transactionId: tx.id, depositEntryId: d.id })
        }
      } else {
        const paymentId = part.target.paymentId
        const p = ctx.payments.find((x) => x.id === paymentId)
        if (!p) fail('Diese Zahlung gibt es nicht (mehr). Bitte laden Sie die Seite neu.')
        else if (ctx.linkedPaymentIds.has(p.id) || usedPayments.has(p.id) || localPayments.has(p.id)) fail(PAYMENT_ALREADY_LINKED)
        else if (p.tenancyId !== part.tenancyId || p.amountCents !== part.amountCents) fail('Die erfasste Zahlung passt nicht zu diesem Teil: Mietverhältnis oder Betrag weichen ab.')
        else {
          localPayments.add(p.id)
          local.existing.push({ transactionId: tx.id, paymentId: p.id })
        }
      }
    }
    if (!failed && Math.abs(sum) > Math.abs(openCents)) {
      problem(`Die Teile ergeben mehr als den Umsatz (${euro(Math.abs(sum))} statt ${euro(Math.abs(openCents))}).`)
      failed = true
    }
    if (!failed && local.depositEntries.length > 0) {
      const after = [...plannedDeposits, ...local.depositEntries.map((d, i) => ({ id: `geplant-${tx.id}-${i}`, tenancyId: d.tenancyId, date: d.date, kind: d.kind, amountCents: d.amountCents }))]
      for (const tenancyId of new Set(local.depositEntries.map((d) => d.tenancyId))) {
        const short = depositProblem(after.filter((d) => d.tenancyId === tenancyId))
        if (short && !failed) {
          problem(`Mehr als die Kaution hergibt: Am ${germanDate(short.date)} fehlten ${euro(-short.balanceCents)}.`)
          failed = true
        }
      }
      if (!failed) plannedDeposits.splice(0, plannedDeposits.length, ...after)
    }
    if (failed) continue
    for (const id of localPayments) usedPayments.add(id)
    for (const id of localDeposits) usedDeposits.add(id)
    writes.existingDeposits.push(...local.existingDeposits)
    writes.payments.push(...local.payments)
    writes.depositEntries.push(...local.depositEntries)
    writes.existing.push(...local.existing)
  }

  const clauses = [
    ...(writes.payments.length > 0 ? [`${plural(writes.payments.length, 'Zahlung', 'Zahlungen')} gebucht`] : []),
    ...(writes.depositEntries.length > 0 ? [plural(writes.depositEntries.length, 'Kautionsbuchung', 'Kautionsbuchungen')] : []),
    ...(writes.existing.length > 0 ? [`${plural(writes.existing.length, 'Umsatz', 'Umsätze')} mit erfasster Zahlung verknüpft`] : []),
    ...(writes.existingDeposits.length > 0 ? [`${plural(writes.existingDeposits.length, 'Umsatz', 'Umsätze')} mit erfasster Kautionsbuchung verknüpft`] : []),
    ...(writes.setAside.length > 0 ? [`${writes.setAside.length} beiseitegelegt`] : []),
  ]
  const sentence = clauses.length === 0 ? 'Nichts zu buchen.' : `${clauses.join(', ')}.`
  return { writes, problems, sentence }
}

// SHA-256 über Plan und Entscheidungen. Der Plan hängt am Bestand (offene Beträge, Zwecke, erfasste Zahlungen); hat er
// sich zwischen Vorschau und Buchen geändert, ist die Marke eine andere.
export function linkToken(plan: LinkPlan, decisions: readonly LinkDecision[]): string {
  return crypto.createHash('sha256').update(JSON.stringify({ plan, decisions }), 'utf8').digest('hex')
}

const UNREADABLE = 'Die Zuordnungen sind nicht lesbar. Bitte laden Sie die Seite neu.'
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const PAYMENT_KIND_SET: ReadonlySet<string> = new Set<PaymentKind>(['rent', 'settlement'])

function targetOf(raw: unknown): LinkTarget | null {
  if (!isObject(raw)) return null
  if (raw.type === 'newPayment' && typeof raw.kind === 'string' && PAYMENT_KIND_SET.has(raw.kind)) return { type: 'newPayment', kind: raw.kind as PaymentKind }
  if (raw.type === 'existingPayment' && typeof raw.paymentId === 'string' && raw.paymentId !== '') return { type: 'existingPayment', paymentId: raw.paymentId }
  if (raw.type === 'deposit' && (raw.kind === 'received' || raw.kind === 'refunded')) return { type: 'deposit', kind: raw.kind }
  if (raw.type === 'existingDeposit' && typeof raw.depositEntryId === 'string' && raw.depositEntryId !== '') return { type: 'existingDeposit', depositEntryId: raw.depositEntryId }
  return null
}

export function parseLinkDecisions(raw: unknown): { decisions: LinkDecision[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length > 5000) return { error: UNREADABLE }
  const decisions: LinkDecision[] = []
  for (const d of raw as unknown[]) {
    if (!isObject(d) || typeof d.transactionId !== 'string' || d.transactionId === '') return { error: UNREADABLE }
    if ('setAside' in d) {
      if (typeof d.setAside !== 'string' || !(BANK_SET_ASIDE as readonly string[]).includes(d.setAside)) return { error: UNREADABLE }
      decisions.push({ transactionId: d.transactionId, setAside: d.setAside as SetAsideReason })
      continue
    }
    if (!Array.isArray(d.parts) || d.parts.length === 0 || d.parts.length > 50) return { error: UNREADABLE }
    const parts: LinkPart[] = []
    for (const p of d.parts as unknown[]) {
      if (!isObject(p) || typeof p.tenancyId !== 'string' || !Number.isSafeInteger(p.amountCents)) return { error: UNREADABLE }
      const target = targetOf(p.target)
      if (!target) return { error: UNREADABLE }
      parts.push({ tenancyId: p.tenancyId, amountCents: p.amountCents as number, target })
    }
    decisions.push({ transactionId: d.transactionId, parts })
  }
  return { decisions }
}

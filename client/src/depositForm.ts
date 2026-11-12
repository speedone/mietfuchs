// Das Formular „Kautionsbuchung“ im Seitenfenster der Kaution (#228), ohne DOM, damit es prüfbar bleibt
// (depositForm.test.ts). Das Fenster rendert nur. Der Stand selbst kommt aus shared/deposit.ts.
import type { DepositState } from '../../shared/deposit.ts'
import { fmtEuro, parseEuro } from './api'
import type { Checked, Problem } from './formProblems'
import { DEPOSIT_STATUS_LABELS, type DepositEntry, type DepositEntryKind, type DepositPurpose, type Tenancy } from './types'

export type DepositFormState = { date: string; kind: DepositEntryKind; purpose: DepositPurpose | ''; amount: string; note: string }
export type DepositField = 'date' | 'amount' | 'purpose'

export const DEPOSIT_KIND_LABELS: Record<DepositEntryKind, string> = {
  received: 'Eingang',
  interest: 'Ertrag (Zinsen)',
  applied: 'Verrechnung',
  refunded: 'Rückzahlung an den Mieter',
}
// Jeder Wert, den das Formular halten kann, steht in der Liste (client/CLAUDE.md, Selects).
export const DEPOSIT_KIND_OPTIONS: readonly { value: DepositEntryKind; label: string }[] =
  (['received', 'interest', 'applied', 'refunded'] as const).map((value) => ({ value, label: DEPOSIT_KIND_LABELS[value] }))

// Die Zwecke einer Verrechnung. Mietrückstand und Nachzahlung legen eine gebundene Zahlung im Mietkonto an
// (server/src/db/deposits.ts); Schaden und Sonstiges nicht.
export const DEPOSIT_PURPOSE_LABELS: Record<DepositPurpose, string> = {
  rent: 'Mietrückstand',
  settlement: 'Nachzahlung aus der Abrechnung',
  damage: 'Schaden',
  other: 'Sonstiges',
}
export const DEPOSIT_PURPOSE_OPTIONS: readonly { value: DepositPurpose; label: string }[] =
  (['rent', 'settlement', 'damage', 'other'] as const).map((value) => ({ value, label: DEPOSIT_PURPOSE_LABELS[value] }))

// Der Satz unter dem Zweck: was die Verrechnung anlegt, und was sie für die Steuer heißt. Zum Schaden steht nur, was
// Mietfuchs tut; ob und wo ein einbehaltener Schadensersatz anzugeben ist, ist nicht belegt (Entwurf, Abschnitt Recht).
export function depositPurposeHint(purpose: DepositPurpose | ''): string | null {
  switch (purpose) {
    case 'rent': return 'Mietfuchs legt dazu im Mietkonto eine Mietzahlung an diesem Tag an; sie tilgt den ältesten offenen Monat.'
    case 'settlement': return 'Mietfuchs legt dazu im Mietkonto eine Zahlung aus der Abrechnung an diesem Tag an.'
    case 'damage':
    case 'other': return 'Die Steuerübersicht zählt diesen Betrag nicht als Einnahme.'
    case '': return null
  }
}

export const emptyDepositForm = (today: string): DepositFormState => ({ date: today, kind: 'received', purpose: '', amount: '', note: '' })

// Der Wechsel der Art: Eine Verrechnung bekommt sofort den ersten Zweck, damit das Auswahlfeld zeigt, was gesendet
// wird; jede andere Art hat keinen.
export function withKind(form: DepositFormState, kind: DepositEntryKind): DepositFormState {
  const first = DEPOSIT_PURPOSE_OPTIONS[0]?.value ?? ''
  return { ...form, kind, purpose: kind === 'applied' ? (form.purpose === '' ? first : form.purpose) : '' }
}

export type DepositEntryBody = { tenancyId: string; date: string; kind: DepositEntryKind; amountCents: number; purpose: DepositPurpose | null; note: string }

export function depositEntryBody(form: DepositFormState, tenancyId: string): Checked<DepositEntryBody, DepositField> {
  const problems: Problem<DepositField>[] = []
  if (form.date === '') problems.push({ field: 'date', short: 'Datum fehlt', text: 'Kautionsbuchung: Geben Sie das Datum ein, an dem das Geld geflossen ist.' })
  const cents = parseEuro(form.amount)
  if (form.amount.trim() === '') problems.push({ field: 'amount', short: 'Kein Betrag', text: 'Kautionsbuchung: Geben Sie den Betrag ein.' })
  else if (cents === null || cents <= 0) problems.push({ field: 'amount', short: 'Betrag größer als 0', text: 'Kautionsbuchung: Der Betrag ist größer als 0. Die Richtung ergibt die Art, etwa „Rückzahlung an den Mieter“.' })
  if (form.kind === 'applied' && form.purpose === '') problems.push({ field: 'purpose', short: 'Bitte wählen', text: 'Kautionsbuchung: Geben Sie an, womit Sie verrechnen.' })
  if (problems.length > 0 || cents === null) return { problems }
  return { body: { tenancyId, date: form.date, kind: form.kind, amountCents: cents, purpose: form.kind === 'applied' && form.purpose !== '' ? form.purpose : null, note: form.note.trim() } }
}

// Der Betrag, wie er auf den Stand wirkt: Verrechnung und Rückzahlung mindern.
export const signedCents = (entry: Pick<DepositEntry, 'kind' | 'amountCents'>): number =>
  entry.kind === 'applied' || entry.kind === 'refunded' ? -entry.amountCents : entry.amountCents

export const depositKindText = (entry: Pick<DepositEntry, 'kind' | 'purpose'>): string =>
  entry.kind === 'applied' && entry.purpose ? `${DEPOSIT_KIND_LABELS.applied} (${DEPOSIT_PURPOSE_LABELS[entry.purpose]})` : DEPOSIT_KIND_LABELS[entry.kind]

// Die Marke zum Stand. Einen gespeicherten Wert „abgerechnet“ gibt es nicht: Er ergibt sich aus `zurückgezahlt`, wenn
// etwas verrechnet wurde.
export const depositStatusLabel = (state: DepositState): string =>
  state.derived && state.status === 'zurückgezahlt' && state.appliedCents > 0 ? 'abgerechnet' : DEPOSIT_STATUS_LABELS[state.status]

// Der Stand in einem Satz, für den Kopf des Seitenfensters.
export function depositStateText(state: DepositState, tenancy: Pick<Tenancy, 'depositCents'>): string {
  if (!state.derived) return `Noch keine Kautionsbuchung. Es gilt der Stand aus den Stammdaten: ${DEPOSIT_STATUS_LABELS[state.status]}.`
  if (state.status === 'zurückgezahlt') {
    const parts = [`eingegangen ${fmtEuro(state.receivedCents)}`]
    if (state.interestCents > 0) parts.push(`Erträge ${fmtEuro(state.interestCents)}`)
    if (state.appliedCents > 0) parts.push(`verrechnet ${fmtEuro(state.appliedCents)}`)
    if (state.refundedCents > 0) parts.push(`ausgezahlt ${fmtEuro(state.refundedCents)}`)
    return `Die Kaution ist ${depositStatusLabel(state)}: ${parts.join(', ')}.`
  }
  const parts: string[] = []
  if (tenancy.depositCents !== undefined) parts.push(`vereinbart ${fmtEuro(tenancy.depositCents)}`)
  parts.push(`eingegangen ${fmtEuro(state.receivedCents)}`)
  if (state.interestCents > 0) parts.push(`Erträge ${fmtEuro(state.interestCents)}`)
  parts.push(`bei Ihnen liegen ${fmtEuro(state.balanceCents)}`)
  const text = parts.join(', ')
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`
}

// Bei einer Sicherheit, die nicht beim Vermieter liegt, fließt kein Geld; der Satz erklärt, wozu die Buchungen dann sind.
export const NO_MONEY_FORM_TEXT = 'Bei dieser Form fließt kein Geld an Sie; Buchungen brauchen Sie nur, wenn Sie die Sicherheit in Anspruch nehmen.'
export const formWithoutMoney = (tenancy: Pick<Tenancy, 'depositForm'>): boolean => tenancy.depositForm === 'pledged' || tenancy.depositForm === 'guarantee'

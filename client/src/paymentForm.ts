// Das Formular „Zahlung erfassen“ im Mietkonto (#280), ohne DOM, damit es prüfbar bleibt
// (paymentForm.test.ts). Die Seite rendert nur.

import type { Payment, PaymentKind, RentLedgerRow, Tenancy } from './types'
import type { Checked, Problem } from './formProblems'
import { fmtEuro, parseEuro } from './api'
import { parseMonthText } from './monthText'

// `designatedMonth`: der Monat laut Verwendungszweck (#281), wie im Monatsfeld eingegeben; leer heißt keine Bestimmung.
export type PaymentForm = { tenancyId: string; date: string; amount: string; note: string; kind: PaymentKind; designatedMonth: string }

// Die Arten einer Zahlung als Auswahl. Wie bei den übrigen Auswahlfeldern (CLAUDE.md, Selects)
// steht jeder Wert, den das Formular halten kann, in der Liste: Sonst zeigte der Browser den ersten
// Eintrag, und gespeichert würde etwas anderes als das Sichtbare.
export const PAYMENT_KIND_OPTIONS: readonly { value: PaymentKind; label: string }[] = [
  { value: 'rent', label: 'Miete' },
  { value: 'settlement', label: 'Nachzahlung oder Guthaben aus der Abrechnung' },
]

export const PAYMENT_KIND_LABELS: Record<PaymentKind, string> = {
  rent: 'Miete',
  settlement: 'Abrechnung',
}

// Der Satz unter dem Betrag: Ein ausgezahltes Guthaben ist ein Abgang und steht mit Minus da. Ist das
// Guthaben mit der Miete verrechnet, ging weniger ein, als die Miete beträgt; gebucht wird trotzdem die
// volle Miete als Miete und das Guthaben mit Minus als Abrechnung (Durchsicht M1). Wer nur den
// Eingang als Miete bucht und das Guthaben dazu, hat den Monat offen und in der Steuer das Guthaben
// zweimal abgezogen: 600 € Eingang, gebucht 600 € Miete und −200 € Abrechnung, ergäbe 400 € Zufluss.
export const SETTLEMENT_AMOUNT_HINT =
  'Eine Nachzahlung des Mieters tragen Sie als positiven Betrag ein, ein ausgezahltes Guthaben mit Minus (z. B. -200,00). ' +
  'Das Mietkonto führt sie gesondert und verteilt sie nicht auf die Monate.'

export const SETTLEMENT_OFFSET_HINT =
  'Hat der Mieter das Guthaben mit der Miete verrechnet, tragen Sie die Miete in voller Höhe als „Miete“ ein und das Guthaben mit Minus als „Abrechnung“, ' +
  'auch wenn weniger eingegangen ist. Zusammen ergeben beide den tatsächlichen Eingang.'

// Die Hinweise unter dem Formular. Bei „Abrechnung“ der Satz zum Vorzeichen; bei einem Guthaben
// (Betrag mit Minus) dazu der Satz zur Verrechnung mit der Miete.
export function paymentFormHints(form: Pick<PaymentForm, 'kind' | 'amount'>): string[] {
  if (form.kind !== 'settlement') return []
  const cents = parseEuro(form.amount)
  return cents !== null && cents < 0 ? [SETTLEMENT_AMOUNT_HINT, SETTLEMENT_OFFSET_HINT] : [SETTLEMENT_AMOUNT_HINT]
}

// Hat im Jahr kein Mietverhältnis Tage, gibt es keine Miete zu buchen (Durchsicht M2b): Das Formular
// beginnt dann mit „Abrechnung“ und sagt warum.
export const noRentYearText = (year: number): string =>
  `In ${year} besteht kein Mietverhältnis; hier lassen sich nur Nachzahlungen oder Guthaben aus der Abrechnung erfassen.`

export function newPaymentForm(ledger: { rows: readonly Pick<RentLedgerRow, 'tenancyId'>[] } | null, date: string): PaymentForm {
  const first = ledger?.rows[0]?.tenancyId
  return first === undefined ? { ...emptyPaymentForm('', date), kind: 'settlement' } : emptyPaymentForm(first, date)
}

// Eine Miete für ein Mietverhältnis ohne Zeile im Mietkonto des Jahres (Durchsicht M2b): Das geht,
// etwa wenn nach Wahl eines ausgezogenen Mieters unter „Abrechnung“ zurück auf „Miete“ gestellt wurde
// oder die Dezembermiete nach dem Auszug im Januar einging. Im Mietkonto erschiene sie nicht, in der
// Steuer schon. Gespeichert wird deshalb erst nach Rückfrage.
export function rentWithoutRow(form: Pick<PaymentForm, 'kind' | 'tenancyId'>, ledger: { rows: readonly Pick<RentLedgerRow, 'tenancyId'>[] } | null): boolean {
  return form.kind === 'rent' && form.tenancyId !== '' && !(ledger?.rows ?? []).some((r) => r.tenancyId === form.tenancyId)
}

export const rentWithoutRowQuestion = (year: number, tenantName: string): string =>
  `Das Mietverhältnis von ${tenantName} besteht in ${year} nicht. Als Miete erscheint die Zahlung im Mietkonto ${year} nicht, ` +
  'in der Steuerübersicht zählt sie als Zufluss. Ist es eine Nachzahlung oder ein Guthaben aus der Abrechnung, wählen Sie als Art „Abrechnung“.'

// Gibt es im Jahr Zahlungen aus der Abrechnung (Durchsicht N1)? Gefragt wird nach den Zahlungen und
// nicht nach der Summe: +150 € und −150 € heben sich auf und sind trotzdem gebucht.
export function hasSettlementPayments(payments: readonly Pick<Payment, 'kind' | 'tenancyId' | 'date'>[], year: number, tenancyId?: string): boolean {
  return payments.some((p) => p.kind === 'settlement' && p.date.startsWith(`${year}-`) && (tenancyId === undefined || p.tenancyId === tenancyId))
}

// Die Rückfrage vor dem Umstellen der Art einer erfassten Zahlung (Durchsicht der Umstellung auf
// main). Die Auswahl in der Liste speichert nicht von selbst: Mit den Pfeiltasten wechselt ein
// Auswahlfeld seinen Wert schon beim Durchgehen der Tabelle, und jede Umstellung verschiebt den
// Betrag zwischen der Miete der Monate und „gesondert“. Der Satz sagt, was sich ändert.
export function kindChangeQuestion(p: Pick<Payment, 'date' | 'amountCents'>, kind: PaymentKind, dateText: string): { title: string; message: string } {
  const what = `Die Zahlung vom ${dateText} über ${fmtEuro(p.amountCents)}`
  return kind === 'settlement'
    ? {
        title: 'Als Abrechnung führen?',
        message: `${what} gilt dann als Nachzahlung oder Guthaben aus der Abrechnung. Das Mietkonto verteilt sie dann nicht mehr auf die Monate, sondern führt sie gesondert.`,
      }
    : {
        title: 'Als Miete führen?',
        message: `${what} gilt dann als Miete. Das Mietkonto verteilt sie dann nach § 366 BGB auf die offenen Monate: den Monat laut Verwendungszweck, sonst zuerst die Vorauszahlungen, dann die Miete, jeweils die ältesten zuerst.`,
      }
}

export function emptyPaymentForm(tenancyId: string, date: string): PaymentForm {
  return { tenancyId, date, amount: '', note: '', kind: 'rent', designatedMonth: '' }
}

// Welche Mietverhältnisse das Formular anbietet. Miete: die Zeilen des Mietkontos, also die
// Mietverhältnisse mit Tagen im Jahr. Abrechnung: dazu jedes übrige des Objekts, denn Nachzahlung
// und Guthaben kommen oft erst nach dem Auszug, im Jahr danach. Ein schon gewähltes bleibt in der
// Liste, damit das Sichtbare dem Gewählten entspricht.
export function paymentTenancyOptions(
  kind: PaymentKind,
  ledger: { rows: readonly Pick<RentLedgerRow, 'tenancyId' | 'tenantName' | 'unitName'>[] } | null,
  tenancies: readonly Pick<Tenancy, 'id' | 'tenantName' | 'unitId'>[],
  unitName: (unitId: string) => string,
  selected: string,
): { value: string; label: string }[] {
  const rows = (ledger?.rows ?? []).map((r) => ({ value: r.tenancyId, label: `${r.tenantName} · ${r.unitName}` }))
  const inRows = new Set(rows.map((r) => r.value))
  const others = tenancies
    .filter((t) => !inRows.has(t.id) && (kind === 'settlement' || t.id === selected))
    .map((t) => ({ value: t.id, label: `${t.tenantName} · ${unitName(t.unitId)}` }))
  return [...rows, ...others]
}

export type PaymentBody = Pick<Payment, 'tenancyId' | 'date' | 'amountCents' | 'kind'> & { note?: string; designatedMonth?: string }

// Der Rumpf für POST /api/payments, oder die Angaben, die fehlen, je mit Feld (#346, Schritt 3). Vorher
// stand dort ein Sammelsatz „Bitte Mietverhältnis, Datum und einen Betrag angeben.“, der nicht sagte, welches
// Feld gemeint ist (UI-Durchsicht M5).
export type PaymentField = 'tenancyId' | 'date' | 'amount' | 'designatedMonth'
export function paymentBody(form: PaymentForm): Checked<PaymentBody, PaymentField> {
  const cents = parseEuro(form.amount)
  const problems: Problem<PaymentField>[] = []
  if (!form.tenancyId) problems.push({ field: 'tenancyId', short: 'Mietverhältnis fehlt', text: 'Mietverhältnis: Wählen Sie, von wem die Zahlung kommt.' })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) problems.push({ field: 'date', short: 'Datum fehlt', text: 'Datum: Geben Sie den Tag ein, an dem das Geld eingegangen ist.' })
  if (!form.amount.trim()) problems.push({ field: 'amount', short: 'Betrag fehlt', text: 'Betrag: Geben Sie den eingegangenen Betrag ein, etwa 1.000,00.' })
  else if (cents === null) problems.push({ field: 'amount', short: 'Kein Betrag', text: 'Betrag: Geben Sie den Betrag als Zahl ein, etwa 1.000,00.' })
  else if (cents === 0) problems.push({ field: 'amount', short: 'Betrag ist 0', text: 'Betrag: Eine Zahlung über 0,00 € gibt es nicht; geben Sie den eingegangenen Betrag ein.' })
  // Den Monat laut Verwendungszweck gibt es nur an einer Miete (#281); bei „Abrechnung“ ist das Feld ausgeblendet, und
  // ein stehengebliebener Wert geht nicht mit (der Server lehnte ihn ab).
  const month = form.kind === 'rent' ? parseMonthText(form.designatedMonth) : { kind: 'empty' as const }
  if (month.kind === 'invalid') problems.push({ field: 'designatedMonth', short: month.short, text: `Für Monat: ${month.text}` })
  if (problems.length > 0 || cents === null) return { problems }
  return {
    body: {
      tenancyId: form.tenancyId, date: form.date, amountCents: cents, kind: form.kind, note: form.note.trim() || undefined,
      ...(month.kind === 'month' ? { designatedMonth: month.key } : {}),
    },
  }
}

// Die Bestätigung nach dem Speichern.
export function savedText(body: Pick<PaymentBody, 'amountCents' | 'kind'>): string {
  if (body.kind === 'settlement') {
    return body.amountCents < 0
      ? `Guthaben aus der Abrechnung über ${fmtEuro(-body.amountCents)} erfasst.`
      : `Nachzahlung aus der Abrechnung über ${fmtEuro(body.amountCents)} erfasst.`
  }
  return `Zahlung über ${fmtEuro(body.amountCents)} erfasst.`
}

// Art und Monat laut Verwendungszweck einer erfassten Zahlung als Entwurf (#281, #309): Gesendet wird nur, was sich
// geändert hat (PUT ergänzt nach Anwesenheit eines Schlüssels); leer entfernt den Monat. Eine Zahlung aus der
// Abrechnung gilt dem Saldo, nicht einem Monat: Wer auf „Abrechnung“ umstellt, entfernt einen eingetragenen Monat mit.
export type PaymentDraft = { kind: PaymentKind; month: string }
export type PaymentChange = { kind?: PaymentKind; designatedMonth?: string | null }

export function paymentChangeBody(p: Pick<Payment, 'kind' | 'designatedMonth'>, draft: PaymentDraft): { body: PaymentChange } | { problem: string } {
  const saved = p.designatedMonth ?? null
  const body: PaymentChange = {}
  if (draft.kind !== p.kind) body.kind = draft.kind
  if (draft.kind === 'settlement') {
    if (saved !== null) body.designatedMonth = null
    return { body }
  }
  const month = parseMonthText(draft.month)
  if (month.kind === 'invalid') return { problem: `Für Monat: ${month.text}` }
  const next = month.kind === 'month' ? month.key : null
  if (next !== saved) body.designatedMonth = next
  return { body }
}

// Die Hilfe am Feld (Entwurf E3).
export const DESIGNATED_MONTH_HINT =
  'Nennt der Mieter in der Überweisung einen Monat, tragen Sie ihn hier ein. Sonst verteilt Mietfuchs die Zahlung nach § 366 BGB: ' +
  'zuerst offene Vorauszahlungen, dann die Miete, jeweils die ältesten zuerst.'

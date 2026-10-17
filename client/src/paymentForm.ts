// Das Formular „Zahlung erfassen“ im Mietkonto (#280), ohne DOM, damit es prüfbar bleibt
// (paymentForm.test.ts). Die Seite rendert nur.

import type { Payment, PaymentKind, RentLedgerRow, Tenancy } from './types'
import { fmtEuro, parseEuro } from './api'

export type PaymentForm = { tenancyId: string; date: string; amount: string; note: string; kind: PaymentKind }

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
        message: `${what} gilt dann als Miete. Das Mietkonto verteilt sie dann von Januar an auf die Monate.`,
      }
}

export function emptyPaymentForm(tenancyId: string, date: string): PaymentForm {
  return { tenancyId, date, amount: '', note: '', kind: 'rent' }
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

export type PaymentBody = Pick<Payment, 'tenancyId' | 'date' | 'amountCents' | 'kind'> & { note?: string }

// Der Rumpf für POST /api/payments, oder der Satz, warum es keinen gibt.
export function paymentBody(form: PaymentForm): { body: PaymentBody } | { error: string } {
  const cents = parseEuro(form.amount)
  if (!form.tenancyId || !/^\d{4}-\d{2}-\d{2}$/.test(form.date) || cents === null || cents === 0) {
    return { error: 'Bitte Mietverhältnis, Datum und einen Betrag angeben.' }
  }
  return { body: { tenancyId: form.tenancyId, date: form.date, amountCents: cents, kind: form.kind, note: form.note.trim() || undefined } }
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

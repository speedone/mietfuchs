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

// Der Satz unter dem Betrag: Ein ausgezahltes Guthaben ist ein Abgang und steht mit Minus da.
export const SETTLEMENT_AMOUNT_HINT =
  'Eine Nachzahlung des Mieters tragen Sie als positiven Betrag ein, ein ausgezahltes oder verrechnetes Guthaben mit Minus (z. B. -200,00). ' +
  'Das Mietkonto führt sie gesondert und verteilt sie nicht auf die Monate.'

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

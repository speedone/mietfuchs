// Das gemeinsame Modell einer E-Rechnung (#189), gleich ob sie als UBL oder CII kam. Die Typen stehen in
// shared/types.ts, denn die Rechnungsansicht der Oberfläche zeigt dasselbe Modell.
// Entwurf: docs/superpowers/specs/2026-11-09-e-rechnung-design.md

export type { EInvoice, EInvoiceAddress, EInvoiceDocCharge, EInvoiceLine, EInvoiceSyntax, EInvoiceTotals, EInvoiceVatGroup, EInvoiceView, VatKey } from '../../../shared/types.ts'

// Eine E-Rechnung, die Mietfuchs erkannt hat, aber nicht übernimmt. Der Satz ist für den
// Vermieter geschrieben (gesiezt) und sagt, warum.
export type Refusal = { refused: string }

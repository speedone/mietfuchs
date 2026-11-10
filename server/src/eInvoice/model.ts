// Das gemeinsame Modell einer E-Rechnung (#189), gleich ob sie als UBL oder CII kam.
// Entwurf: docs/superpowers/specs/2026-11-09-e-rechnung-design.md

export type EInvoiceSyntax = 'ubl-invoice' | 'ubl-credit-note' | 'cii'

// Eine E-Rechnung, die Mietfuchs erkannt hat, aber nicht übernimmt. Der Satz ist für den
// Vermieter geschrieben (gesiezt) und sagt, warum.
export type Refusal = { refused: string }

// Das gemeinsame Modell einer E-Rechnung (#189), gleich ob sie als UBL oder CII kam.
// Entwurf: docs/superpowers/specs/2026-11-09-e-rechnung-design.md

export type EInvoiceSyntax = 'ubl-invoice' | 'ubl-credit-note' | 'cii'

// Eine E-Rechnung, die Mietfuchs erkannt hat, aber nicht übernimmt. Der Satz ist für den
// Vermieter geschrieben (gesiezt) und sagt, warum.
export type Refusal = { refused: string }

// Umsatzsteuerkategorie (BT-118/151/95/102: S, Z, E, AE, K, G, O, L, M) und Satz in
// Hundertstel-Prozent (19 % → 1900), damit kein Gleitkomma im Schlüssel steht. Fehlt der Satz
// (Kategorie E, O, AE …), gilt 0.
export type VatKey = { category: string, rateBasisPoints: number }

// Eine Position (BG-25). `netCents` ist BT-131, wie im XML: bei einer Gutschrift positiv.
export type EInvoiceLine = { id: string, name: string, description: string | null, netCents: number, unitCode: string | null, vat: VatKey }

// Ein Abschlag (BG-20, `charge: false`) oder Zuschlag (BG-21) auf Dokumentebene, netto.
export type EInvoiceDocCharge = { charge: boolean, cents: number, reason: string | null, vat: VatKey }

// Eine Zeile der Umsatzsteuer-Aufschlüsselung (BG-23): BT-116 und BT-117.
export type EInvoiceVatGroup = { vat: VatKey, basisCents: number, taxCents: number }

export type EInvoiceTotals = {
  lineNet: number | null        // BT-106
  allowances: number | null     // BT-107
  charges: number | null        // BT-108
  taxExclusive: number | null   // BT-109
  tax: number | null            // BT-110, in der Rechnungswährung
  taxInclusive: number | null   // BT-112
  prepaid: number | null        // BT-113
  rounding: number | null       // BT-114
  payable: number | null        // BT-115
}

// Eine E-Rechnung, gleich in welcher Schreibweise. Beträge in Cent, so wie sie dastehen (eine
// Gutschrift trägt positive Beträge; das Vorzeichen setzt toRaw.ts). Daten als 'JJJJ-MM-TT'.
export type EInvoice = {
  syntax: EInvoiceSyntax
  typeCode: string | null          // BT-3
  number: string | null            // BT-1
  issueDate: string | null         // BT-2
  currency: string | null          // BT-5
  seller: string | null            // BT-27
  buyer: string | null             // BT-44
  periodStart: string | null       // BT-73
  periodEnd: string | null         // BT-74
  deliveryDate: string | null      // BT-72
  dueDate: string | null           // BT-9
  iban: string | null              // BT-84, nicht bei Lastschrift
  precedingInvoice: { number: string, date: string | null } | null   // BG-3
  lines: EInvoiceLine[]
  charges: EInvoiceDocCharge[]
  vatGroups: EInvoiceVatGroup[]
  totals: EInvoiceTotals
  // Angaben, die dastehen, aber nicht lesbar sind (Betrag mit drei Nachkommastellen, Datum in
  // fremdem Format). Eine solche Rechnung wird nicht übernommen (check.ts).
  unreadable: string[]
}

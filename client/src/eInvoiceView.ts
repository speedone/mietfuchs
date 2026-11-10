// Rechnungsansicht einer E-Rechnung als XML-Datei (#189, PR 3): Was aus dem Modell des Servers (GET /api/e-invoice/:file)
// lesbar dasteht, gegliedert wie die Visualisierung der KoSIT (Kopf, Beteiligte, Positionen, Steuer, Summen, Zahlung).
// Die Ansicht am Bildschirm (components/EInvoiceView.tsx) und das PDF für Vorschau, Belegkopien und Mappe
// (eInvoicePdf.ts) zeigen beide genau das; geprüft in eInvoiceView.test.ts.
import { formatIban } from '../../shared/iban.ts'
import type { EInvoiceAddress, EInvoiceView, VatKey } from './types'

// Wohin ein Beleg führt: eine XML-Datei in die Rechnungsansicht der App (die Datei selbst kommt nur als Download), alles
// andere auf die Datei.
export function receiptHref(file: string): string {
  return /\.xml$/i.test(file) ? `/?e-rechnung=${encodeURIComponent(file)}` : `/uploads/${encodeURIComponent(file)}`
}

// Rechnungsarten nach UNTDID 1001, soweit eine E-Rechnung sie trägt
const TYPE_LABELS: Record<string, string> = {
  '380': 'Rechnung',
  '381': 'Gutschrift',
  '384': 'Korrigierte Rechnung',
  '386': 'Vorauszahlungsrechnung',
  '326': 'Teilrechnung',
  '389': 'Selbst ausgestellte Rechnung',
  '875': 'Teilrechnung für Bauleistungen',
  '876': 'Teilschlussrechnung für Bauleistungen',
  '877': 'Schlussrechnung für Bauleistungen',
}

// Mengeneinheiten nach UN/ECE Empfehlung 20, die auf Rechnungen eines Vermieters vorkommen; sonst steht der Code.
const UNITS: Record<string, string> = {
  C62: 'Stk.', H87: 'Stk.', XPP: 'Stk.', EA: 'Stk.', HUR: 'Std.', MIN: 'Min.', DAY: 'Tage', WEE: 'Wochen', MON: 'Monate',
  ANN: 'Jahre', KWH: 'kWh', MWH: 'MWh', MTQ: 'm³', MTK: 'm²', MTR: 'm', KMT: 'km', LTR: 'l', KGM: 'kg', TNE: 't', LS: 'pauschal',
}

// Umsatzsteuerkategorien (BT-151); `S` nennt nur den Satz
const VAT_CATEGORIES: Record<string, string> = {
  Z: 'Nullsatz', E: 'steuerfrei', AE: 'Steuerschuldnerschaft des Leistungsempfängers', K: 'innergemeinschaftliche Lieferung',
  G: 'Ausfuhr', O: 'nicht steuerbar', L: 'Kanarische Inseln', M: 'Ceuta und Melilla',
}

export type EInvoiceDocument = {
  title: string
  facts: [string, string][]
  parties: { role: 'Verkäufer' | 'Käufer'; name: string; lines: string[] }[]
  positions: { nr: string; name: string; description: string | null; quantity: string; unitPrice: string; vat: string; net: string }[]
  charges: { kind: 'Zuschlag' | 'Abschlag'; reason: string; vat: string; amount: string }[]
  vat: { label: string; basis: string; tax: string }[]
  totals: [string, string][]
  payment: [string, string][]
  refusal: string | null
  notes: string[]
  unreadable: string[]
}

const decimal = (n: number, min: number, max: number): string =>
  n.toLocaleString('de-DE', { minimumFractionDigits: min, maximumFractionDigits: max })
const date = (iso: string): string => {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

function vatLabel(v: VatKey): string {
  const rate = `${decimal(v.rateBasisPoints / 100, 0, 2)} %`
  if (v.category === 'S') return rate
  const name = VAT_CATEGORIES[v.category] ?? `Kategorie ${v.category}`
  return v.rateBasisPoints === 0 ? name : `${name} ${rate}`
}

function addressLines(a: EInvoiceAddress | null): string[] {
  if (!a) return []
  const place = [a.postcode, a.city].filter(Boolean).join(' ')
  return [...a.lines, ...(place ? [place] : []), ...(a.country ? [a.country] : [])]
}

export function eInvoiceDocument({ invoice: inv, notes, refusal }: EInvoiceView): EInvoiceDocument {
  // Beträge mit gewöhnlichem Leerzeichen vor der Währung (im PDF wie am Bildschirm); fremde Währungen mit ihrem Code
  const unit = inv.currency === 'EUR' || inv.currency === null ? '€' : inv.currency
  const money = (cents: number): string => `${decimal(cents / 100, 2, 2)} ${unit}`
  const known = inv.typeCode === null ? undefined : TYPE_LABELS[inv.typeCode]
  const kind = known ?? (inv.syntax === 'ubl-credit-note' ? 'Gutschrift' : 'Rechnung')
  const kindWithCode = known || inv.typeCode === null ? kind : `${kind} (Art ${inv.typeCode})`

  const facts: [string, string][] = []
  if (inv.typeCode !== null) facts.push(['Rechnungsart', known ? `${known} (${inv.typeCode})` : `Art ${inv.typeCode}`])
  if (inv.number) facts.push(['Rechnungsnummer', inv.number])
  if (inv.issueDate) facts.push(['Rechnungsdatum', date(inv.issueDate)])
  if (inv.periodStart || inv.periodEnd) {
    facts.push(['Leistungszeitraum', inv.periodStart && inv.periodEnd ? `${date(inv.periodStart)} bis ${date(inv.periodEnd)}` : date(inv.periodStart ?? inv.periodEnd ?? '')])
  }
  if (inv.deliveryDate) facts.push(['Lieferdatum', date(inv.deliveryDate)])
  if (inv.precedingInvoice) {
    facts.push(['Bezug auf Rechnung', `${inv.precedingInvoice.number}${inv.precedingInvoice.date ? ` vom ${date(inv.precedingInvoice.date)}` : ''}`])
  }
  if (inv.currency) facts.push(['Währung', inv.currency])

  const quantity = (raw: string | null, code: string | null): string => {
    const n = raw === null ? Number.NaN : Number(raw)
    const amount = raw === null ? '' : Number.isFinite(n) ? decimal(n, 0, 4) : raw
    const label = code === null ? '' : UNITS[code] ?? code
    return [amount, label].filter(Boolean).join(' ')
  }
  const price = (raw: string | null): string => {
    const n = raw === null ? Number.NaN : Number(raw)
    return raw === null ? '' : Number.isFinite(n) ? `${decimal(n, 2, 4)} ${unit}` : raw
  }

  const t = inv.totals
  const totals: [string, string][] = []
  const total = (label: string, cents: number | null, sign = 1) => { if (cents !== null) totals.push([label, money(sign * cents)]) }
  total('Summe der Positionen (netto)', t.lineNet)
  total('Abschläge', t.allowances, -1)
  total('Zuschläge', t.charges)
  total('Gesamt netto', t.taxExclusive)
  total('Umsatzsteuer', t.tax)
  total('Gesamt brutto', t.taxInclusive)
  total('Bereits gezahlt', t.prepaid, -1)
  total('Rundung', t.rounding)
  total('Zahlbetrag', t.payable)

  const payment: [string, string][] = []
  if (inv.dueDate) payment.push(['Fällig am', date(inv.dueDate)])
  if (inv.iban) payment.push(['IBAN', formatIban(inv.iban)])
  if (inv.paymentTerms) payment.push(['Zahlungsbedingungen', inv.paymentTerms])

  return {
    title: inv.number ? `${kindWithCode} Nr. ${inv.number}` : kindWithCode,
    facts,
    parties: [
      { role: 'Verkäufer', name: inv.seller ?? '', lines: [...addressLines(inv.sellerAddress), ...(inv.sellerVatId ? [`USt-IdNr. ${inv.sellerVatId}`] : [])] },
      { role: 'Käufer', name: inv.buyer ?? '', lines: addressLines(inv.buyerAddress) },
    ],
    positions: inv.lines.map((l) => ({
      nr: l.id, name: l.name, description: l.description, quantity: quantity(l.quantity, l.unitCode), unitPrice: price(l.unitPrice), vat: vatLabel(l.vat), net: money(l.netCents),
    })),
    charges: inv.charges.map((c) => ({
      kind: c.charge ? 'Zuschlag' : 'Abschlag', reason: c.reason ?? '', vat: vatLabel(c.vat), amount: money(c.charge ? c.cents : -c.cents),
    })),
    vat: inv.vatGroups.map((g) => ({ label: vatLabel(g.vat), basis: money(g.basisCents), tax: money(g.taxCents) })),
    totals,
    payment,
    refusal,
    notes,
    unreadable: inv.unreadable,
  }
}

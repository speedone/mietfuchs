// Eine E-Rechnung lesen (#189): UBL (Rechnung, Gutschrift) und CII zu einem gemeinsamen Modell.
//
// Gelesen wird nur, was Mietfuchs zeigt oder übernimmt (rund 40 Felder der EN 16931), an den
// Stellen, an denen die Norm sie vorsieht; geprüft an Dateien der KoSIT-Testsuite
// (test/fixtures/e-invoice/). Ob die Rechnung übernommen wird, entscheidet check.ts.
//
// - **Beträge als Text, in Cent.** Ein Betrag, der dasteht, aber nicht centgenau lesbar ist (drei
//   Nachkommastellen, Komma), wird nicht gerundet, sondern in `unreadable` vermerkt.
// - **BT-110 nur in der Rechnungswährung.** UBL und CII können die Steuer ein zweites Mal in der
//   Buchungswährung nennen (BT-111); die zählt nicht.
// - **Keine IBAN bei Lastschrift** (BT-81 = 59): Dann steht dort das Konto des Käufers.

import { all, at, attr, isNode, makeParser, signedDecimalToCents, text, tryParse } from '../xml.ts'
import type { EInvoice, EInvoiceAddress, EInvoiceDocCharge, EInvoiceLine, EInvoiceSyntax, EInvoiceTotals, EInvoiceVatGroup, VatKey } from './model.ts'

const DIRECT_DEBIT = '59'

// Sammelt, was dasteht, aber nicht lesbar ist.
class Reader {
  unreadable: string[] = []

  amount(v: unknown, label: string): number | null {
    const raw = text(v)
    if (raw === null) return null
    const cents = signedDecimalToCents(raw)
    if (cents === null) this.unreadable.push(label)
    return cents
  }

  // Ein Betrag, den die Norm verlangt: fehlt er, ist er unlesbar.
  required(v: unknown, label: string): number {
    const cents = this.amount(v, label)
    if (cents === null) {
      if (!this.unreadable.includes(label)) this.unreadable.push(label)
      return 0
    }
    return cents
  }

  // Satz in Hundertstel-Prozent; fehlt er, gilt 0 (Kategorie E, O, AE …).
  vat(category: unknown, percent: unknown, label: string): VatKey {
    const raw = text(percent)
    const rate = raw === null ? 0 : signedDecimalToCents(raw)
    if (rate === null) this.unreadable.push(label)
    return { category: (text(category) ?? '').toUpperCase(), rateBasisPoints: rate ?? 0 }
  }

  // UBL: 'JJJJ-MM-TT'.
  isoDate(v: unknown, label: string): string | null {
    const raw = text(v)
    if (raw === null) return null
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
    this.unreadable.push(label)
    return null
  }

  // CII: `<udt:DateTimeString format="102">JJJJMMTT</…>`. Andere Formate (610 = Monat, 616 = Woche)
  // nennen keinen Tag.
  ciiDate(node: unknown, label: string): string | null {
    const s = at(node, 'DateTimeString')
    const raw = text(s)
    if (raw === null) return null
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(raw)
    if (m && (attr(s, 'format') ?? '102') === '102') return `${m[1]}-${m[2]}-${m[3]}`
    this.unreadable.push(label)
    return null
  }
}

// Der Betrag eines Elements mit `currencyID` gleich der Rechnungswährung; ohne Angabe gilt er.
function inCurrency(nodes: unknown[], currency: string | null): unknown {
  return nodes.find((n) => { const c = attr(n, 'currencyID'); return c === null || c === currency })
}

// Eine Anschrift nur zum Anzeigen. `null`, wenn nichts davon dasteht.
function address(lines: unknown[], postcode: unknown, city: unknown, country: unknown): EInvoiceAddress | null {
  const a = { lines: lines.map(text).filter((l): l is string => l !== null), postcode: text(postcode), city: text(city), country: text(country) }
  return a.lines.length === 0 && a.postcode === null && a.city === null && a.country === null ? null : a
}

// ---------- UBL ----------

function readUbl(root: unknown, syntax: EInvoiceSyntax): EInvoice {
  const r = new Reader()
  const credit = syntax === 'ubl-credit-note'
  const currency = text(at(root, 'DocumentCurrencyCode'))
  const ublAddress = (role: string) => {
    const a = at(root, role, 'Party', 'PostalAddress')
    return address([at(a, 'StreetName'), at(a, 'AdditionalStreetName'), at(a, 'AddressLine', 'Line')], at(a, 'PostalZone'), at(a, 'CityName'), at(a, 'Country', 'IdentificationCode'))
  }
  const sellerVat = all(at(root, 'AccountingSupplierParty', 'Party'), 'PartyTaxScheme').find((t) => text(at(t, 'TaxScheme', 'ID'))?.toUpperCase() === 'VAT')
  const partyName = (role: string) => text(at(root, role, 'Party', 'PartyLegalEntity', 'RegistrationName')) ?? text(at(root, role, 'Party', 'PartyName', 'Name'))
  const means = all(root, 'PaymentMeans')
  const transfer = means.find((m) => text(at(m, 'PaymentMeansCode')) !== DIRECT_DEBIT && text(at(m, 'PayeeFinancialAccount', 'ID')) !== null)
  const preceding = at(root, 'BillingReference', 'InvoiceDocumentReference')
  const precedingNumber = text(at(preceding, 'ID'))

  const lines: EInvoiceLine[] = all(root, credit ? 'CreditNoteLine' : 'InvoiceLine').map((l, i) => {
    const label = `Position ${i + 1}`
    const tax = at(l, 'Item', 'ClassifiedTaxCategory')
    return {
      id: text(at(l, 'ID')) ?? String(i + 1),
      name: text(at(l, 'Item', 'Name')) ?? '',
      description: text(at(l, 'Item', 'Description')),
      netCents: r.required(at(l, 'LineExtensionAmount'), `BT-131 ${label}`),
      unitCode: attr(at(l, credit ? 'CreditedQuantity' : 'InvoicedQuantity'), 'unitCode'),
      vat: r.vat(at(tax, 'ID'), at(tax, 'Percent'), `BT-152 ${label}`),
      quantity: text(at(l, credit ? 'CreditedQuantity' : 'InvoicedQuantity')),
      unitPrice: text(at(l, 'Price', 'PriceAmount')),
    }
  })

  const charges: EInvoiceDocCharge[] = all(root, 'AllowanceCharge').map((c, i) => ({
    charge: text(at(c, 'ChargeIndicator'))?.toLowerCase() === 'true',
    cents: r.required(at(c, 'Amount'), `BT-92/99 Zu- oder Abschlag ${i + 1}`),
    reason: text(at(c, 'AllowanceChargeReason')),
    vat: r.vat(at(c, 'TaxCategory', 'ID'), at(c, 'TaxCategory', 'Percent'), `BT-96/103 Zu- oder Abschlag ${i + 1}`),
  }))

  // Die Aufschlüsselung steht in dem TaxTotal, dessen Betrag in der Rechnungswährung ist.
  const taxTotals = all(root, 'TaxTotal')
  const taxTotal = taxTotals.find((t) => { const c = attr(at(t, 'TaxAmount'), 'currencyID'); return c === null || c === currency })
  const vatGroups: EInvoiceVatGroup[] = all(taxTotal, 'TaxSubtotal').map((g, i) => ({
    vat: r.vat(at(g, 'TaxCategory', 'ID'), at(g, 'TaxCategory', 'Percent'), `BT-119 Gruppe ${i + 1}`),
    basisCents: r.required(at(g, 'TaxableAmount'), `BT-116 Gruppe ${i + 1}`),
    taxCents: r.required(at(g, 'TaxAmount'), `BT-117 Gruppe ${i + 1}`),
  }))

  const m = at(root, 'LegalMonetaryTotal')
  const totals: EInvoiceTotals = {
    lineNet: r.amount(at(m, 'LineExtensionAmount'), 'BT-106'),
    allowances: r.amount(at(m, 'AllowanceTotalAmount'), 'BT-107'),
    charges: r.amount(at(m, 'ChargeTotalAmount'), 'BT-108'),
    taxExclusive: r.amount(at(m, 'TaxExclusiveAmount'), 'BT-109'),
    tax: r.amount(inCurrency(taxTotals.map((t) => at(t, 'TaxAmount')), currency), 'BT-110'),
    taxInclusive: r.amount(at(m, 'TaxInclusiveAmount'), 'BT-112'),
    prepaid: r.amount(at(m, 'PrepaidAmount'), 'BT-113'),
    rounding: r.amount(at(m, 'PayableRoundingAmount'), 'BT-114'),
    payable: r.amount(at(m, 'PayableAmount'), 'BT-115'),
  }

  return {
    syntax,
    typeCode: text(at(root, credit ? 'CreditNoteTypeCode' : 'InvoiceTypeCode')),
    number: text(at(root, 'ID')),
    issueDate: r.isoDate(at(root, 'IssueDate'), 'BT-2'),
    currency,
    seller: partyName('AccountingSupplierParty'),
    sellerAddress: ublAddress('AccountingSupplierParty'),
    sellerVatId: text(at(sellerVat, 'CompanyID')),
    buyer: partyName('AccountingCustomerParty'),
    buyerAddress: ublAddress('AccountingCustomerParty'),
    periodStart: r.isoDate(at(root, 'InvoicePeriod', 'StartDate'), 'BT-73'),
    periodEnd: r.isoDate(at(root, 'InvoicePeriod', 'EndDate'), 'BT-74'),
    deliveryDate: r.isoDate(at(root, 'Delivery', 'ActualDeliveryDate'), 'BT-72'),
    dueDate: r.isoDate(at(root, 'DueDate') ?? means.map((x) => at(x, 'PaymentDueDate')).find((x) => x !== undefined), 'BT-9'),
    paymentTerms: text(at(root, 'PaymentTerms', 'Note')),
    iban: transfer ? text(at(transfer, 'PayeeFinancialAccount', 'ID')) : null,
    precedingInvoice: precedingNumber === null ? null : { number: precedingNumber, date: r.isoDate(at(preceding, 'IssueDate'), 'BT-26') },
    lines, charges, vatGroups, totals,
    unreadable: r.unreadable,
  }
}

// ---------- CII ----------

function readCii(root: unknown): EInvoice {
  const r = new Reader()
  const doc = at(root, 'ExchangedDocument')
  const trade = at(root, 'SupplyChainTradeTransaction')
  const agreement = at(trade, 'ApplicableHeaderTradeAgreement')
  const delivery = at(trade, 'ApplicableHeaderTradeDelivery')
  const settlement = at(trade, 'ApplicableHeaderTradeSettlement')
  const currency = text(at(settlement, 'InvoiceCurrencyCode'))
  const means = all(settlement, 'SpecifiedTradeSettlementPaymentMeans')
  const transfer = means.find((m) => text(at(m, 'TypeCode')) !== DIRECT_DEBIT && text(at(m, 'PayeePartyCreditorFinancialAccount', 'IBANID')) !== null)
  const preceding = at(settlement, 'InvoiceReferencedDocument')
  const precedingNumber = text(at(preceding, 'IssuerAssignedID'))
  const ciiAddress = (party: unknown) => {
    const a = at(party, 'PostalTradeAddress')
    return address([at(a, 'LineOne'), at(a, 'LineTwo'), at(a, 'LineThree')], at(a, 'PostcodeCode'), at(a, 'CityName'), at(a, 'CountryID'))
  }
  const seller = at(agreement, 'SellerTradeParty')
  const buyer = at(agreement, 'BuyerTradeParty')
  const sellerVat = all(seller, 'SpecifiedTaxRegistration').map((t) => at(t, 'ID')).find((id) => attr(id, 'schemeID')?.toUpperCase() === 'VA')

  const lines: EInvoiceLine[] = all(trade, 'IncludedSupplyChainTradeLineItem').map((l, i) => {
    const label = `Position ${i + 1}`
    const lineSettlement = at(l, 'SpecifiedLineTradeSettlement')
    const tax = at(lineSettlement, 'ApplicableTradeTax')
    return {
      id: text(at(l, 'AssociatedDocumentLineDocument', 'LineID')) ?? String(i + 1),
      name: text(at(l, 'SpecifiedTradeProduct', 'Name')) ?? '',
      description: text(at(l, 'SpecifiedTradeProduct', 'Description')),
      netCents: r.required(at(lineSettlement, 'SpecifiedTradeSettlementLineMonetarySummation', 'LineTotalAmount'), `BT-131 ${label}`),
      unitCode: attr(at(l, 'SpecifiedLineTradeDelivery', 'BilledQuantity'), 'unitCode'),
      vat: r.vat(at(tax, 'CategoryCode'), at(tax, 'RateApplicablePercent'), `BT-152 ${label}`),
      quantity: text(at(l, 'SpecifiedLineTradeDelivery', 'BilledQuantity')),
      unitPrice: text(at(l, 'SpecifiedLineTradeAgreement', 'NetPriceProductTradePrice', 'ChargeAmount')),
    }
  })

  const charges: EInvoiceDocCharge[] = all(settlement, 'SpecifiedTradeAllowanceCharge').map((c, i) => ({
    charge: text(at(c, 'ChargeIndicator', 'Indicator'))?.toLowerCase() === 'true',
    cents: r.required(at(c, 'ActualAmount'), `BT-92/99 Zu- oder Abschlag ${i + 1}`),
    reason: text(at(c, 'Reason')),
    vat: r.vat(at(c, 'CategoryTradeTax', 'CategoryCode'), at(c, 'CategoryTradeTax', 'RateApplicablePercent'), `BT-96/103 Zu- oder Abschlag ${i + 1}`),
  }))

  const vatGroups: EInvoiceVatGroup[] = all(settlement, 'ApplicableTradeTax').map((g, i) => ({
    vat: r.vat(at(g, 'CategoryCode'), at(g, 'RateApplicablePercent'), `BT-119 Gruppe ${i + 1}`),
    basisCents: r.required(at(g, 'BasisAmount'), `BT-116 Gruppe ${i + 1}`),
    taxCents: r.required(at(g, 'CalculatedAmount'), `BT-117 Gruppe ${i + 1}`),
  }))

  const m = at(settlement, 'SpecifiedTradeSettlementHeaderMonetarySummation')
  const totals: EInvoiceTotals = {
    lineNet: r.amount(at(m, 'LineTotalAmount'), 'BT-106'),
    allowances: r.amount(at(m, 'AllowanceTotalAmount'), 'BT-107'),
    charges: r.amount(at(m, 'ChargeTotalAmount'), 'BT-108'),
    taxExclusive: r.amount(at(m, 'TaxBasisTotalAmount'), 'BT-109'),
    tax: r.amount(inCurrency(all(m, 'TaxTotalAmount'), currency), 'BT-110'),
    taxInclusive: r.amount(at(m, 'GrandTotalAmount'), 'BT-112'),
    prepaid: r.amount(at(m, 'TotalPrepaidAmount'), 'BT-113'),
    rounding: r.amount(at(m, 'RoundingAmount'), 'BT-114'),
    payable: r.amount(at(m, 'DuePayableAmount'), 'BT-115'),
  }

  return {
    syntax: 'cii',
    typeCode: text(at(doc, 'TypeCode')),
    number: text(at(doc, 'ID')),
    issueDate: r.ciiDate(at(doc, 'IssueDateTime'), 'BT-2'),
    currency,
    seller: text(at(seller, 'Name')),
    sellerAddress: ciiAddress(seller),
    sellerVatId: text(sellerVat),
    buyer: text(at(buyer, 'Name')),
    buyerAddress: ciiAddress(buyer),
    periodStart: r.ciiDate(at(settlement, 'BillingSpecifiedPeriod', 'StartDateTime'), 'BT-73'),
    periodEnd: r.ciiDate(at(settlement, 'BillingSpecifiedPeriod', 'EndDateTime'), 'BT-74'),
    deliveryDate: r.ciiDate(at(delivery, 'ActualDeliverySupplyChainEvent', 'OccurrenceDateTime'), 'BT-72'),
    dueDate: r.ciiDate(at(settlement, 'SpecifiedTradePaymentTerms', 'DueDateDateTime'), 'BT-9'),
    paymentTerms: text(at(settlement, 'SpecifiedTradePaymentTerms', 'Description')),
    iban: transfer ? text(at(transfer, 'PayeePartyCreditorFinancialAccount', 'IBANID')) : null,
    precedingInvoice: precedingNumber === null ? null : { number: precedingNumber, date: r.ciiDate(at(preceding, 'FormattedIssueDateTime'), 'BT-26') },
    lines, charges, vatGroups, totals,
    unreadable: r.unreadable,
  }
}

// Das Modell einer erkannten E-Rechnung (`detectEInvoice` hat Schreibweise und Sicherheit geprüft).
export function readModel(xml: string, syntax: EInvoiceSyntax): EInvoice {
  const doc = tryParse(makeParser({ keepPrefixes: false }), xml)
  const rootName = syntax === 'cii' ? 'CrossIndustryInvoice' : syntax === 'ubl-credit-note' ? 'CreditNote' : 'Invoice'
  const root = isNode(doc) ? at(doc, rootName) : undefined
  const inv = syntax === 'cii' ? readCii(root) : readUbl(root, syntax)
  return doc === undefined ? { ...inv, unreadable: ['XML', ...inv.unreadable] } : inv
}

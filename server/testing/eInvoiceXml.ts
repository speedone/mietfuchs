// Testbauer für E-Rechnungen (#189): aus dem Modell `EInvoice` eine XRechnung als UBL oder CII.
//
// Nur für Tests. Er prüft nicht, ob die Rechnung stimmt; `consistent` rechnet Steuergruppen und
// Summen aus Positionen und Dokumentzuschlägen nach, wie ein ordentlicher Aussteller es täte.
// Weil derselbe Kopf Leser und Bauer schreibt, prüfen die Dateien der KoSIT-Testsuite
// (test/fixtures/e-invoice/) die Pfade unabhängig davon.

import type { EInvoice, EInvoiceAddress, EInvoiceDocCharge, EInvoiceLine, EInvoiceTotals, VatKey } from '../src/eInvoice/model.ts'

const NS = {
  ublInvoice: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  ublCreditNote: 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2',
  cac: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  cbc: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
  rsm: 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
  ram: 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
  udt: 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100',
  qdt: 'urn:un:unece:uncefact:data:standard:QualifiedDataType:100',
}
export const XRECHNUNG_PROFILE = 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const money = (cents: number) => `${cents < 0 ? '-' : ''}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, '0')}`
const rate = (bp: number) => money(bp)
const d102 = (iso: string) => iso.replace(/-/g, '')
const opt = (v: string | null | undefined, f: (s: string) => string) => (v === null || v === undefined ? '' : f(v))

// ---------- Modell ----------

export const vat = (category: string, percent: number): VatKey => ({ category, rateBasisPoints: Math.round(percent * 100) })
export const S19 = vat('S', 19)
export const S7 = vat('S', 7)

export function line(netCents: number, name: string, more: Partial<EInvoiceLine> = {}): EInvoiceLine {
  return { id: '1', name, description: null, netCents, unitCode: 'C62', vat: S19, quantity: '1', unitPrice: money(netCents), ...more }
}

export function docCharge(charge: boolean, cents: number, reason: string | null, v: VatKey = S19): EInvoiceDocCharge {
  return { charge, cents, reason, vat: v }
}

const keyOf = (v: VatKey) => `${v.category}|${v.rateBasisPoints}`

// Steuergruppen und Summen aus Positionen und Dokumentzuschlägen, gerundet je Gruppe wie
// EN 16931 (BR-CO-17: Steuer der Gruppe = Bemessungsgrundlage × Satz, auf Cent gerundet).
export function consistent(inv: EInvoice): EInvoice {
  const groups = new Map<string, { vat: VatKey, basisCents: number }>()
  const add = (v: VatKey, cents: number) => {
    const g = groups.get(keyOf(v)) ?? { vat: v, basisCents: 0 }
    g.basisCents += cents
    groups.set(keyOf(v), g)
  }
  for (const l of inv.lines) add(l.vat, l.netCents)
  for (const c of inv.charges) add(c.vat, c.charge ? c.cents : -c.cents)
  const vatGroups = [...groups.values()].map((g) => ({ ...g, taxCents: Math.round(g.basisCents * g.vat.rateBasisPoints / 10000) }))
  const lineNet = inv.lines.reduce((s, l) => s + l.netCents, 0)
  const allowances = inv.charges.filter((c) => !c.charge).reduce((s, c) => s + c.cents, 0)
  const charges = inv.charges.filter((c) => c.charge).reduce((s, c) => s + c.cents, 0)
  const taxExclusive = lineNet - allowances + charges
  const tax = vatGroups.reduce((s, g) => s + g.taxCents, 0)
  const prepaid = inv.totals.prepaid
  const totals: EInvoiceTotals = {
    lineNet, allowances: inv.charges.some((c) => !c.charge) ? allowances : null, charges: inv.charges.some((c) => c.charge) ? charges : null,
    taxExclusive, tax, taxInclusive: taxExclusive + tax, prepaid, rounding: null, payable: taxExclusive + tax - (prepaid ?? 0),
  }
  return { ...inv, vatGroups, totals }
}

export function invoice(more: Partial<EInvoice> = {}): EInvoice {
  const base: EInvoice = {
    syntax: 'ubl-invoice', typeCode: '380', number: 'R-2025-0042', issueDate: '2025-03-14', currency: 'EUR',
    seller: 'Haustechnik Beispiel GmbH', sellerAddress: { lines: ['Werkstraße 7'], postcode: '12345', city: 'Musterstadt', country: 'DE' },
    sellerVatId: 'DE123456789', buyer: 'Erika Mustermann', buyerAddress: { lines: ['Am Hang 3', 'Hinterhaus'], postcode: '54321', city: 'Beispieldorf', country: 'DE' },
    periodStart: null, periodEnd: null,
    deliveryDate: '2025-03-10', dueDate: '2025-03-28', paymentTerms: null, iban: 'DE02120300000000202051', precedingInvoice: null,
    lines: [line(10000, 'Wartung Heizung')], charges: [], vatGroups: [],
    totals: { lineNet: null, allowances: null, charges: null, taxExclusive: null, tax: null, taxInclusive: null, prepaid: null, rounding: null, payable: null },
    unreadable: [],
  }
  const merged = { ...base, ...more }
  return more.vatGroups || more.totals ? merged : consistent(merged)
}

// ---------- UBL ----------

export type BuildOptions = { foreignTaxTotal?: boolean }

export function ublOf(inv: EInvoice, opts: BuildOptions = {}): string {
  const credit = inv.syntax === 'ubl-credit-note'
  const root = credit ? 'CreditNote' : 'Invoice'
  const cur = inv.currency ?? 'EUR'
  const amt = (tag: string, cents: number | null) => (cents === null ? '' : `<cbc:${tag} currencyID="${cur}">${money(cents)}</cbc:${tag}>`)
  const address = (a: EInvoiceAddress | null) => (a === null ? '' : `<cac:PostalAddress>${opt(a.lines[0], (l) => `<cbc:StreetName>${esc(l)}</cbc:StreetName>`)}${opt(a.lines[1], (l) => `<cbc:AdditionalStreetName>${esc(l)}</cbc:AdditionalStreetName>`)}${opt(a.city, (c) => `<cbc:CityName>${esc(c)}</cbc:CityName>`)}${opt(a.postcode, (c) => `<cbc:PostalZone>${esc(c)}</cbc:PostalZone>`)}${opt(a.lines[2], (l) => `<cac:AddressLine><cbc:Line>${esc(l)}</cbc:Line></cac:AddressLine>`)}${opt(a.country, (c) => `<cac:Country><cbc:IdentificationCode>${c}</cbc:IdentificationCode></cac:Country>`)}</cac:PostalAddress>`)
  const vatId = (id: string | null) => opt(id, (v) => `<cac:PartyTaxScheme><cbc:CompanyID>${esc(v)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>`)
  const party = (role: string, name: string | null, a: EInvoiceAddress | null, id: string | null = null) => opt(name, (n) => `<cac:${role}><cac:Party>${address(a)}${vatId(id)}<cac:PartyLegalEntity><cbc:RegistrationName>${esc(n)}</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:${role}>`)
  const taxCategory = (tag: string, v: VatKey) => `<cac:${tag}><cbc:ID>${v.category}</cbc:ID><cbc:Percent>${rate(v.rateBasisPoints)}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:${tag}>`
  const t = inv.totals
  return `<?xml version="1.0" encoding="UTF-8"?>
<${root} xmlns="${credit ? NS.ublCreditNote : NS.ublInvoice}" xmlns:cac="${NS.cac}" xmlns:cbc="${NS.cbc}">
<cbc:CustomizationID>${XRECHNUNG_PROFILE}</cbc:CustomizationID>
${opt(inv.number, (n) => `<cbc:ID>${esc(n)}</cbc:ID>`)}
${opt(inv.issueDate, (d) => `<cbc:IssueDate>${d}</cbc:IssueDate>`)}
${credit ? '' : opt(inv.dueDate, (d) => `<cbc:DueDate>${d}</cbc:DueDate>`)}
${opt(inv.typeCode, (c) => `<cbc:${root}TypeCode>${c}</cbc:${root}TypeCode>`)}
${opt(inv.currency, (c) => `<cbc:DocumentCurrencyCode>${c}</cbc:DocumentCurrencyCode>`)}
${inv.periodStart || inv.periodEnd ? `<cac:InvoicePeriod>${opt(inv.periodStart, (d) => `<cbc:StartDate>${d}</cbc:StartDate>`)}${opt(inv.periodEnd, (d) => `<cbc:EndDate>${d}</cbc:EndDate>`)}</cac:InvoicePeriod>` : ''}
${inv.precedingInvoice ? `<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${esc(inv.precedingInvoice.number)}</cbc:ID>${opt(inv.precedingInvoice.date, (d) => `<cbc:IssueDate>${d}</cbc:IssueDate>`)}</cac:InvoiceDocumentReference></cac:BillingReference>` : ''}
${party('AccountingSupplierParty', inv.seller, inv.sellerAddress, inv.sellerVatId)}
${party('AccountingCustomerParty', inv.buyer, inv.buyerAddress)}
${opt(inv.deliveryDate, (d) => `<cac:Delivery><cbc:ActualDeliveryDate>${d}</cbc:ActualDeliveryDate></cac:Delivery>`)}
${inv.iban
    ? `<cac:PaymentMeans><cbc:PaymentMeansCode>58</cbc:PaymentMeansCode>${credit ? opt(inv.dueDate, (d) => `<cbc:PaymentDueDate>${d}</cbc:PaymentDueDate>`) : ''}<cac:PayeeFinancialAccount><cbc:ID>${inv.iban}</cbc:ID></cac:PayeeFinancialAccount></cac:PaymentMeans>`
    : `<cac:PaymentMeans><cbc:PaymentMeansCode>59</cbc:PaymentMeansCode>${credit ? opt(inv.dueDate, (d) => `<cbc:PaymentDueDate>${d}</cbc:PaymentDueDate>`) : ''}<cac:PaymentMandate><cbc:ID>M-1</cbc:ID><cac:PayerFinancialAccount><cbc:ID>DE02500105170137075030</cbc:ID></cac:PayerFinancialAccount></cac:PaymentMandate></cac:PaymentMeans>`}
${opt(inv.paymentTerms, (t) => `<cac:PaymentTerms><cbc:Note>${esc(t)}</cbc:Note></cac:PaymentTerms>`)}
${inv.charges.map((c) => `<cac:AllowanceCharge><cbc:ChargeIndicator>${c.charge}</cbc:ChargeIndicator>${opt(c.reason, (r) => `<cbc:AllowanceChargeReason>${esc(r)}</cbc:AllowanceChargeReason>`)}${amt('Amount', c.cents)}${taxCategory('TaxCategory', c.vat)}</cac:AllowanceCharge>`).join('\n')}
<cac:TaxTotal>${amt('TaxAmount', t.tax)}
${inv.vatGroups.map((g) => `<cac:TaxSubtotal>${amt('TaxableAmount', g.basisCents)}${amt('TaxAmount', g.taxCents)}${taxCategory('TaxCategory', g.vat)}</cac:TaxSubtotal>`).join('\n')}
</cac:TaxTotal>
${opts.foreignTaxTotal ? `<cac:TaxTotal><cbc:TaxAmount currencyID="USD">999.99</cbc:TaxAmount></cac:TaxTotal>` : ''}
<cac:LegalMonetaryTotal>${amt('LineExtensionAmount', t.lineNet)}${amt('TaxExclusiveAmount', t.taxExclusive)}${amt('TaxInclusiveAmount', t.taxInclusive)}${amt('AllowanceTotalAmount', t.allowances)}${amt('ChargeTotalAmount', t.charges)}${amt('PrepaidAmount', t.prepaid)}${amt('PayableRoundingAmount', t.rounding)}${amt('PayableAmount', t.payable)}</cac:LegalMonetaryTotal>
${inv.lines.map((l) => `<cac:${root}Line><cbc:ID>${esc(l.id)}</cbc:ID><cbc:${credit ? 'Credited' : 'Invoiced'}Quantity${opt(l.unitCode, (u) => ` unitCode="${u}"`)}>${l.quantity ?? '1'}</cbc:${credit ? 'Credited' : 'Invoiced'}Quantity>${amt('LineExtensionAmount', l.netCents)}<cac:Item>${opt(l.description, (d) => `<cbc:Description>${esc(d)}</cbc:Description>`)}<cbc:Name>${esc(l.name)}</cbc:Name>${taxCategory('ClassifiedTaxCategory', l.vat)}</cac:Item>${opt(l.unitPrice, (p) => `<cac:Price><cbc:PriceAmount currencyID="${cur}">${p}</cbc:PriceAmount></cac:Price>`)}</cac:${root}Line>`).join('\n')}
</${root}>`
}

// ---------- CII ----------

export function ciiOf(inv: EInvoice): string {
  const cur = inv.currency ?? 'EUR'
  const dt = (tag: string, iso: string | null) => opt(iso, (d) => `<ram:${tag}><udt:DateTimeString format="102">${d102(d)}</udt:DateTimeString></ram:${tag}>`)
  const amt = (tag: string, cents: number | null, withCurrency = false) => (cents === null ? '' : `<ram:${tag}${withCurrency ? ` currencyID="${cur}"` : ''}>${money(cents)}</ram:${tag}>`)
  const tax = (tag: string, v: VatKey, inner = '') => `<ram:${tag}>${inner}<ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${v.category}</ram:CategoryCode><ram:RateApplicablePercent>${rate(v.rateBasisPoints)}</ram:RateApplicablePercent></ram:${tag}>`
  const ciiAddress = (a: EInvoiceAddress | null) => (a === null ? '' : `<ram:PostalTradeAddress>${opt(a.postcode, (c) => `<ram:PostcodeCode>${esc(c)}</ram:PostcodeCode>`)}${a.lines.slice(0, 3).map((l, i) => `<ram:Line${['One', 'Two', 'Three'][i]}>${esc(l)}</ram:Line${['One', 'Two', 'Three'][i]}>`).join('')}${opt(a.city, (c) => `<ram:CityName>${esc(c)}</ram:CityName>`)}${opt(a.country, (c) => `<ram:CountryID>${c}</ram:CountryID>`)}</ram:PostalTradeAddress>`)
  const t = inv.totals
  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="${NS.rsm}" xmlns:ram="${NS.ram}" xmlns:udt="${NS.udt}" xmlns:qdt="${NS.qdt}">
<rsm:ExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>${XRECHNUNG_PROFILE}</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>
<rsm:ExchangedDocument>${opt(inv.number, (n) => `<ram:ID>${esc(n)}</ram:ID>`)}${opt(inv.typeCode, (c) => `<ram:TypeCode>${c}</ram:TypeCode>`)}${dt('IssueDateTime', inv.issueDate)}</rsm:ExchangedDocument>
<rsm:SupplyChainTradeTransaction>
${inv.lines.map((l) => `<ram:IncludedSupplyChainTradeLineItem><ram:AssociatedDocumentLineDocument><ram:LineID>${esc(l.id)}</ram:LineID></ram:AssociatedDocumentLineDocument><ram:SpecifiedTradeProduct><ram:Name>${esc(l.name)}</ram:Name>${opt(l.description, (d) => `<ram:Description>${esc(d)}</ram:Description>`)}</ram:SpecifiedTradeProduct><ram:SpecifiedLineTradeAgreement>${opt(l.unitPrice, (p) => `<ram:NetPriceProductTradePrice><ram:ChargeAmount>${p}</ram:ChargeAmount></ram:NetPriceProductTradePrice>`)}</ram:SpecifiedLineTradeAgreement><ram:SpecifiedLineTradeDelivery><ram:BilledQuantity${opt(l.unitCode, (u) => ` unitCode="${u}"`)}>${l.quantity ?? '1'}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery><ram:SpecifiedLineTradeSettlement>${tax('ApplicableTradeTax', l.vat)}<ram:SpecifiedTradeSettlementLineMonetarySummation>${amt('LineTotalAmount', l.netCents)}</ram:SpecifiedTradeSettlementLineMonetarySummation></ram:SpecifiedLineTradeSettlement></ram:IncludedSupplyChainTradeLineItem>`).join('\n')}
<ram:ApplicableHeaderTradeAgreement>${opt(inv.seller, (n) => `<ram:SellerTradeParty><ram:Name>${esc(n)}</ram:Name>${ciiAddress(inv.sellerAddress)}${opt(inv.sellerVatId, (v) => `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${esc(v)}</ram:ID></ram:SpecifiedTaxRegistration>`)}</ram:SellerTradeParty>`)}${opt(inv.buyer, (n) => `<ram:BuyerTradeParty><ram:Name>${esc(n)}</ram:Name>${ciiAddress(inv.buyerAddress)}</ram:BuyerTradeParty>`)}</ram:ApplicableHeaderTradeAgreement>
<ram:ApplicableHeaderTradeDelivery>${opt(inv.deliveryDate, (d) => `<ram:ActualDeliverySupplyChainEvent>${dt('OccurrenceDateTime', d)}</ram:ActualDeliverySupplyChainEvent>`)}</ram:ApplicableHeaderTradeDelivery>
<ram:ApplicableHeaderTradeSettlement>
${opt(inv.currency, (c) => `<ram:InvoiceCurrencyCode>${c}</ram:InvoiceCurrencyCode>`)}
${inv.iban
    ? `<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>58</ram:TypeCode><ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${inv.iban}</ram:IBANID></ram:PayeePartyCreditorFinancialAccount></ram:SpecifiedTradeSettlementPaymentMeans>`
    : `<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>59</ram:TypeCode><ram:PayerPartyDebtorFinancialAccount><ram:IBANID>DE02500105170137075030</ram:IBANID></ram:PayerPartyDebtorFinancialAccount></ram:SpecifiedTradeSettlementPaymentMeans>`}
${inv.vatGroups.map((g) => tax('ApplicableTradeTax', g.vat, `${amt('CalculatedAmount', g.taxCents)}`).replace('<ram:TypeCode>VAT</ram:TypeCode>', `<ram:TypeCode>VAT</ram:TypeCode>${amt('BasisAmount', g.basisCents)}`)).join('\n')}
${inv.periodStart || inv.periodEnd ? `<ram:BillingSpecifiedPeriod>${dt('StartDateTime', inv.periodStart)}${dt('EndDateTime', inv.periodEnd)}</ram:BillingSpecifiedPeriod>` : ''}
${inv.charges.map((c) => `<ram:SpecifiedTradeAllowanceCharge><ram:ChargeIndicator><udt:Indicator>${c.charge}</udt:Indicator></ram:ChargeIndicator>${amt('ActualAmount', c.cents)}${opt(c.reason, (r) => `<ram:Reason>${esc(r)}</ram:Reason>`)}${tax('CategoryTradeTax', c.vat)}</ram:SpecifiedTradeAllowanceCharge>`).join('\n')}
${inv.dueDate || inv.paymentTerms ? `<ram:SpecifiedTradePaymentTerms>${opt(inv.paymentTerms, (t) => `<ram:Description>${esc(t)}</ram:Description>`)}${dt('DueDateDateTime', inv.dueDate)}</ram:SpecifiedTradePaymentTerms>` : ''}
<ram:SpecifiedTradeSettlementHeaderMonetarySummation>${amt('LineTotalAmount', t.lineNet)}${amt('ChargeTotalAmount', t.charges)}${amt('AllowanceTotalAmount', t.allowances)}${amt('TaxBasisTotalAmount', t.taxExclusive)}${amt('TaxTotalAmount', t.tax, true)}${amt('RoundingAmount', t.rounding)}${amt('GrandTotalAmount', t.taxInclusive)}${amt('TotalPrepaidAmount', t.prepaid)}${amt('DuePayableAmount', t.payable)}</ram:SpecifiedTradeSettlementHeaderMonetarySummation>
${inv.precedingInvoice ? `<ram:InvoiceReferencedDocument><ram:IssuerAssignedID>${esc(inv.precedingInvoice.number)}</ram:IssuerAssignedID>${opt(inv.precedingInvoice.date, (d) => `<ram:FormattedIssueDateTime><qdt:DateTimeString format="102">${d102(d)}</qdt:DateTimeString></ram:FormattedIssueDateTime>`)}</ram:InvoiceReferencedDocument>` : ''}
</ram:ApplicableHeaderTradeSettlement>
</rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`
}

// Das XML zur Schreibweise des Modells: 'cii' als CII, sonst UBL.
export const xmlOf = (inv: EInvoice, opts: BuildOptions = {}) => (inv.syntax === 'cii' ? ciiOf(inv) : ublOf(inv, opts))

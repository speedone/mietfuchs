// E-Rechnungen lesen (#189): XRechnung (UBL, CII) und das XML aus ZUGFeRD/Factur-X.
//
// Alle Rechnungen hier sind erfunden. Die Dateien unter fixtures/e-invoice/ stammen aus der
// Testsuite der KoSIT (Apache-2.0, siehe HERKUNFT.md dort) und sind ebenfalls keine echten
// Rechnungen. Echte Rechnungen gehören nie ins Repo.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectEInvoice } from '../src/eInvoice/detect.ts'

const UBL_NS = 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2'
const UBL_CN_NS = 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2'
const CII_NS = 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100'
const XRECHNUNG = 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0'

const ciiWithGuideline = (id: string) => `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="${CII_NS}" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100">
  <rsm:ExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>${id}</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>
</rsm:CrossIndustryInvoice>`

// ---------- Erkennen ----------

test('E-Rechnung erkennen: UBL-Rechnung mit Vorgabe-Namensraum und mit Präfix', () => {
  const plain = `<Invoice xmlns="${UBL_NS}" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cbc:CustomizationID>${XRECHNUNG}</cbc:CustomizationID></Invoice>`
  assert.deepEqual(detectEInvoice(plain), { syntax: 'ubl-invoice', profile: XRECHNUNG })
  const prefixed = `<ubl:Invoice xmlns:ubl="${UBL_NS}"/>`
  assert.deepEqual(detectEInvoice(prefixed), { syntax: 'ubl-invoice', profile: null })
})

test('E-Rechnung erkennen: UBL-Gutschrift', () => {
  assert.deepEqual(detectEInvoice(`<CreditNote xmlns="${UBL_CN_NS}"/>`), { syntax: 'ubl-credit-note', profile: null })
})

test('E-Rechnung erkennen: CII mit Präfix und als Vorgabe-Namensraum, Profil aus der Guideline', () => {
  assert.deepEqual(detectEInvoice(ciiWithGuideline(XRECHNUNG)), { syntax: 'cii', profile: XRECHNUNG })
  assert.deepEqual(detectEInvoice(`<CrossIndustryInvoice xmlns="${CII_NS}"/>`), { syntax: 'cii', profile: null })
})

test('E-Rechnung erkennen: anderes XML ist keine E-Rechnung', () => {
  assert.equal(detectEInvoice('<Invoice xmlns="urn:example"/>'), null)
  assert.equal(detectEInvoice('<Invoice/>'), null)
  assert.equal(detectEInvoice('<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"/>'), null)
})

test('E-Rechnung erkennen: Profile MINIMUM und BASIC WL tragen keine Positionen', () => {
  for (const id of ['urn:factur-x.eu:1p0:minimum', 'urn:factur-x.eu:1p0:basicwl']) {
    const found = detectEInvoice(ciiWithGuideline(id))
    assert.ok(found && 'refused' in found, id)
    assert.match(found.refused, /keine Positionen/)
  }
})

test('E-Rechnung erkennen: ZUGFeRD 1.0 wird nicht übernommen', () => {
  const found = detectEInvoice('<rsm:CrossIndustryDocument xmlns:rsm="urn:ferd:CrossIndustryDocument:invoice:1p0"/>')
  assert.ok(found && 'refused' in found)
  assert.match(found.refused, /ZUGFeRD 1\.0/)
})

test('E-Rechnung erkennen: Dokumenttyp-Erklärung und abgeschnittenes XML werden abgelehnt', () => {
  const doctype = detectEInvoice(`<!DOCTYPE Invoice [<!ENTITY a "b">]><Invoice xmlns="${UBL_NS}"/>`)
  assert.ok(doctype && 'refused' in doctype)
  const cut = detectEInvoice(`<Invoice xmlns="${UBL_NS}"><cbc:ID>1`)
  assert.ok(cut && 'refused' in cut)
})

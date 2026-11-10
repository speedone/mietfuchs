// E-Rechnungen lesen (#189): XRechnung (UBL, CII) und das XML aus ZUGFeRD/Factur-X.
//
// Alle Rechnungen hier sind erfunden. Die Dateien unter fixtures/e-invoice/ stammen aus der
// Testsuite der KoSIT (Apache-2.0, siehe HERKUNFT.md dort) und sind ebenfalls keine echten
// Rechnungen. Echte Rechnungen gehören nie ins Repo.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { detectEInvoice } from '../src/eInvoice/detect.ts'
import { readModel } from '../src/eInvoice/read.ts'
import { checkEInvoice } from '../src/eInvoice/check.ts'
import type { EInvoice, EInvoiceSyntax } from '../src/eInvoice/model.ts'
import { ciiOf, consistent, docCharge, invoice, line, S7, ublOf } from '../testing/eInvoiceXml.ts'

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'e-invoice')
const fixture = (name: string) => fs.readFileSync(path.join(FIXTURES, name), 'utf8')

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

// ---------- Lesen: KoSIT-Testsuite (Werte von Hand aus dem XML abgeschrieben) ----------

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

for (const [file, syntax] of [['03.06a-INVOICE_ubl.xml', 'ubl-invoice'], ['03.06a-INVOICE_uncefact.xml', 'cii']] as const) {
  test(`E-Rechnung lesen: KoSIT 03.06a (${syntax}), negative Position und Gruppe Z`, () => {
    const inv = readModel(fixture(file), syntax)
    assert.deepEqual(inv.unreadable, [])
    assert.equal(inv.typeCode, '380')
    assert.equal(inv.number, '112233')
    assert.equal(inv.issueDate, '2021-04-23')
    assert.equal(inv.dueDate, '2021-04-28')
    assert.equal(inv.deliveryDate, '2020-11-23')
    assert.equal(inv.currency, 'EUR')
    assert.equal(inv.seller, 'Testverkäufer')
    assert.equal(inv.buyer, 'Testkäufer')
    assert.equal(inv.iban, 'DE79000000001234567890')
    assert.equal(inv.precedingInvoice, null)
    assert.deepEqual(inv.lines.map((l) => [l.id, l.name, l.netCents, l.unitCode, l.vat.category, l.vat.rateBasisPoints]), [
      ['1', 'Neumotor', 100000, 'C62', 'S', 1900],
      ['2', 'Bemessungsgrundlage und Umsatzsteuer auf Altteil', 10000, 'C62', 'S', 1900],
      ['3', 'Korrektur/Stornierung Bemessungsgrundlage der Umsatzsteuer auf Altteil', -10000, 'C62', 'Z', 0],
      ['4', 'Montage', 50000, 'HUR', 'S', 1900],
    ])
    assert.deepEqual(inv.charges, [])
    assert.deepEqual(inv.vatGroups, [
      { vat: { category: 'S', rateBasisPoints: 1900 }, basisCents: 160000, taxCents: 30400 },
      { vat: { category: 'Z', rateBasisPoints: 0 }, basisCents: -10000, taxCents: 0 },
    ])
    assert.deepEqual(inv.totals, { lineNet: 150000, allowances: null, charges: null, taxExclusive: 150000, tax: 30400, taxInclusive: 180400, prepaid: null, rounding: null, payable: 180400 })
  })
}

for (const [file, syntax] of [['03.01a-INVOICE_ubl.xml', 'ubl-invoice'], ['03.01a-INVOICE_uncefact.xml', 'cii']] as const) {
  test(`E-Rechnung lesen: KoSIT 03.01a (${syntax}), Versorger mit Abschlägen und Lastschrift`, () => {
    const inv = readModel(fixture(file), syntax)
    assert.deepEqual(inv.unreadable, [])
    assert.equal(inv.number, '123456789')
    assert.equal(inv.issueDate, '2019-02-28')
    assert.equal(inv.dueDate, '2019-03-14')
    assert.equal(inv.periodStart, '2018-05-01')
    assert.equal(inv.periodEnd, '2019-01-31')
    assert.equal(inv.seller, '[Seller name]')
    // Lastschrift (59): Die Kontoverbindung ist die des Käufers, keine IBAN des Empfängers.
    assert.equal(inv.iban, null)
    assert.equal(inv.lines.length, 14)
    assert.deepEqual([inv.lines[0].id, inv.lines[0].name, inv.lines[0].netCents, inv.lines[0].unitCode], ['1.1', 'Arbeitspreis Strom', 20430, 'KWH'])
    assert.equal(inv.lines[2].unitCode, 'DAY')
    // Unabhängig vom Kopf: Die Summe der gelesenen Positionen ergibt BT-106 aus der Datei.
    assert.equal(sum(inv.lines.map((l) => l.netCents)), 68728)
    assert.deepEqual(inv.vatGroups, [
      { vat: { category: 'S', rateBasisPoints: 1900 }, basisCents: 57889, taxCents: 10999 },
      { vat: { category: 'S', rateBasisPoints: 700 }, basisCents: 10839, taxCents: 759 },
    ])
    assert.deepEqual(inv.totals, { lineNet: 68728, allowances: null, charges: null, taxExclusive: 68728, tax: 11758, taxInclusive: 80486, prepaid: 103000, rounding: null, payable: -22514 })
  })
}

test('E-Rechnung lesen: KoSIT 02.03a, Zu- und Abschlag auf Dokumentebene, BT-110 nur in Rechnungswährung', () => {
  const inv = readModel(fixture('02.03a-INVOICE_ubl.xml'), 'ubl-invoice')
  assert.deepEqual(inv.unreadable, [])
  assert.equal(inv.number, '1234567')
  assert.equal(inv.issueDate, '2018-04-13')
  assert.equal(inv.seller, '[Seller name]')
  assert.equal(inv.iban, 'DE79000000001234567890')
  assert.deepEqual(inv.charges, [
    { charge: true, cents: 0, reason: 'Testing', vat: { category: 'E', rateBasisPoints: 0 } },
    { charge: false, cents: 0, reason: 'Fixed long term', vat: { category: 'E', rateBasisPoints: 0 } },
  ])
  assert.equal(inv.totals.tax, 204844)
  assert.equal(inv.totals.taxInclusive, 1282969)
  assert.equal(inv.totals.prepaid, 1282969)
  assert.equal(inv.totals.payable, 0)
  assert.equal(inv.totals.allowances, 0)
  assert.equal(inv.totals.charges, 0)
  assert.equal(sum(inv.lines.map((l) => l.netCents)), 1078125)
  assert.equal(inv.lines[0].name, 'Beratung')
})

test('E-Rechnung lesen: KoSIT 01.18a, korrigierte Rechnung mit Bezug auf die Vorgängerrechnung', () => {
  const inv = readModel(fixture('01.18a-INVOICE_ubl.xml'), 'ubl-invoice')
  assert.equal(inv.typeCode, '384')
  assert.equal(inv.number, 'PRG1502112')
  assert.deepEqual(inv.precedingInvoice, { number: 'PRG1502168', date: null })
  assert.equal(inv.totals.taxInclusive, 1055530)
})

// ---------- Lesen: Rundlauf über den Testbauer ----------

function roundTrip(inv: EInvoice, xml: string, syntax: EInvoiceSyntax) {
  assert.deepEqual(readModel(xml, syntax), inv)
}

const SAMPLES: [string, EInvoice][] = [
  ['zwei Steuersätze', invoice({ lines: [line(10000, 'Wartung', { id: '1' }), line(5000, 'Ersatzteil ermäßigt', { id: '2', vat: S7 })] })],
  ['Zu- und Abschlag auf Dokumentebene', invoice({ charges: [docCharge(true, 2000, 'Entsorgung'), docCharge(false, 500, 'Rabatt')] })],
  ['negative Position', invoice({ lines: [line(10000, 'Leistung', { id: '1' }), line(-2500, 'Gutschrift Altteil', { id: '2' })] })],
  ['bereits bezahlte Abschläge', invoice({ totals: { lineNet: null, allowances: null, charges: null, taxExclusive: null, tax: null, taxInclusive: null, prepaid: 5000, rounding: null, payable: null } })],
  ['Vorgängerrechnung und Zeitraum', invoice({ typeCode: '384', precedingInvoice: { number: 'R-2025-0041', date: '2025-02-01' }, periodStart: '2025-01-01', periodEnd: '2025-12-31' })],
  ['Lastschrift ohne IBAN', invoice({ iban: null })],
  ['Beschreibung und Einheit', invoice({ lines: [line(11000, 'Arbeitszeit', { description: 'Monteur, 2 Stunden', unitCode: 'HUR' })] })],
]

for (const [name, inv0] of SAMPLES) {
  // Die Vorausgezahlten stehen erst nach `consistent` in den Summen; `invoice` mit `totals` rechnet nicht nach.
  const inv = inv0.totals.lineNet === null ? consistent(inv0) : inv0
  test(`E-Rechnung lesen: Rundlauf UBL, ${name}`, () => roundTrip(inv, ublOf(inv), 'ubl-invoice'))
  test(`E-Rechnung lesen: Rundlauf CII, ${name}`, () => roundTrip({ ...inv, syntax: 'cii' }, ciiOf({ ...inv, syntax: 'cii' }), 'cii'))
}

test('E-Rechnung lesen: Rundlauf UBL-Gutschrift, Beträge stehen positiv', () => {
  const inv = invoice({ syntax: 'ubl-credit-note', typeCode: '381' })
  roundTrip(inv, ublOf(inv), 'ubl-credit-note')
  assert.ok(inv.lines[0].netCents > 0)
})

test('E-Rechnung lesen: ein zweites BT-110 in fremder Währung zählt nicht', () => {
  const inv = invoice()
  assert.equal(readModel(ublOf(inv, { foreignTaxTotal: true }), 'ubl-invoice').totals.tax, inv.totals.tax)
})

test('E-Rechnung lesen: ein Betrag mit drei Nachkommastellen ist unlesbar, nicht gerundet', () => {
  const xml = ublOf(invoice()).replace('<cbc:LineExtensionAmount currencyID="EUR">100.00</cbc:LineExtensionAmount><cac:Item>', '<cbc:LineExtensionAmount currencyID="EUR">100.005</cbc:LineExtensionAmount><cac:Item>')
  const inv = readModel(xml, 'ubl-invoice')
  assert.deepEqual(inv.unreadable, ['BT-131 Position 1'])
})

test('E-Rechnung lesen: ein CII-Datum in fremdem Format ist unlesbar', () => {
  const xml = ciiOf({ ...invoice(), syntax: 'cii' }).replace('<udt:DateTimeString format="102">20250314</udt:DateTimeString>', '<udt:DateTimeString format="610">202503</udt:DateTimeString>')
  const inv = readModel(xml, 'cii')
  assert.equal(inv.issueDate, null)
  assert.deepEqual(inv.unreadable, ['BT-2'])
})

test('E-Rechnung lesen: Umlaute aus ISO-8859-1 über decodeXml', async () => {
  const { decodeXml } = await import('../src/xml.ts')
  const xml = ublOf(invoice({ seller: 'Müller Sanitär' })).replace('encoding="UTF-8"', 'encoding="ISO-8859-1"')
  const decoded = decodeXml(Buffer.from(xml, 'latin1'))
  assert.ok('xml' in decoded)
  assert.equal(readModel(decoded.xml, 'ubl-invoice').seller, 'Müller Sanitär')
})

// ---------- Prüfen ----------

const notesOf = (inv: EInvoice): string[] => {
  const r = checkEInvoice(inv)
  if ('refused' in r) return assert.fail(`abgelehnt: ${r.refused}`)
  return r.notes
}
const refusalOf = (inv: EInvoice): string => {
  const r = checkEInvoice(inv)
  if (!('refused' in r)) return assert.fail('nicht abgelehnt')
  return r.refused
}

test('E-Rechnung prüfen: Rechnung, Gutschrift und Schlussrechnung ohne Notiz', () => {
  for (const typeCode of ['380', '381', '875', '876', '877']) assert.deepEqual(notesOf(invoice({ typeCode })), [], typeCode)
})

test('E-Rechnung prüfen: Abschlags- und Teilrechnungen werden nicht übernommen (sonst zählte die Schlussrechnung doppelt)', () => {
  for (const typeCode of ['386', '326']) assert.match(refusalOf(invoice({ typeCode })), /Schlussrechnung doppelt/, typeCode)
})

test('E-Rechnung prüfen: andere Rechnungsarten werden mit ihrer Nummer abgelehnt', () => {
  assert.match(refusalOf(invoice({ typeCode: '389' })), /389/)
  assert.match(refusalOf(invoice({ typeCode: null })), /Rechnungsart/)
})

test('E-Rechnung prüfen: korrigierte Rechnung nennt die ersetzte', () => {
  const notes = notesOf(invoice({ typeCode: '384', precedingInvoice: { number: 'R-2025-0041', date: '2025-02-01' } }))
  assert.equal(notes.length, 1)
  assert.match(notes[0], /korrigiert die Rechnung R-2025-0041 vom 01\.02\.2025/)
  assert.match(notes[0], /nicht zusätzlich gebucht/)
})

test('E-Rechnung prüfen: fremde Währung wird abgelehnt', () => {
  assert.match(refusalOf(invoice({ currency: 'CHF' })), /CHF/)
})

test('E-Rechnung prüfen: Unlesbares, fehlendes Datum, fehlender Gesamtbetrag, keine Position', () => {
  assert.match(refusalOf({ ...invoice(), unreadable: ['BT-131 Position 1'] }), /BT-131 Position 1/)
  assert.match(refusalOf(invoice({ issueDate: null })), /Rechnungsdatum/)
  const noTotal = invoice()
  assert.match(refusalOf({ ...noTotal, totals: { ...noTotal.totals, taxInclusive: null } }), /Gesamtbetrag/)
  assert.match(refusalOf(invoice({ lines: [] })), /keine Positionen/)
})

test('E-Rechnung prüfen: bereits bezahlte Abschläge werden genannt, der Gesamtbetrag zählt', () => {
  const inv = consistent(invoice({ totals: { ...invoice().totals, prepaid: 5000 } }))
  const notes = notesOf(inv)
  assert.equal(notes.length, 1)
  assert.match(notes[0], /Abschläge über 50,00\s€ sind bereits bezahlt; als Kosten zählt der Gesamtbetrag von 119,00\s€/)
})

test('E-Rechnung prüfen: Summenregeln BR-CO mit einem Cent Spielraum', () => {
  const inv = invoice()
  const total = inv.totals.taxInclusive ?? assert.fail('BT-112 fehlt')
  assert.deepEqual(notesOf({ ...inv, totals: { ...inv.totals, taxInclusive: total + 1 } }), [])
  const off = notesOf({ ...inv, totals: { ...inv.totals, taxInclusive: total + 2 } })
  assert.equal(off.length, 1)
  assert.match(off[0], /Gesamtbetrag/)
  assert.equal(notesOf({ ...inv, lines: [{ ...inv.lines[0], netCents: 9000 }] }).filter((n) => /Positionen/.test(n)).length, 1)
  assert.equal(notesOf({ ...inv, totals: { ...inv.totals, taxExclusive: 5000 } }).length >= 1, true)
  assert.equal(notesOf({ ...inv, vatGroups: [{ ...inv.vatGroups[0], taxCents: 1000 }] }).filter((n) => /Steuer/.test(n)).length, 1)
})

test('E-Rechnung prüfen: Abzug mit Bezug auf eine Vorgängerrechnung', () => {
  const byText = notesOf(invoice({ lines: [line(100000, 'Jahresverbrauch', { id: '1' }), line(-60000, 'abzüglich geleisteter Abschlag', { id: '2' })] }))
  assert.equal(byText.length, 1)
  assert.match(byText[0], /zieht 600,00\s€ für „abzüglich geleisteter Abschlag“ ab/)
  const byReference = notesOf(invoice({ typeCode: '875', precedingInvoice: { number: 'A-1', date: null }, charges: [docCharge(false, 20000, 'Verrechnung')] }))
  assert.ok(byReference.some((n) => /zieht 200,00\s€ für „Verrechnung“ ab/.test(n)))
  // Eine negative Position ohne Abschlagstext und ohne Bezug ist nur eine Gutschriftzeile.
  assert.deepEqual(notesOf(invoice({ lines: [line(10000, 'Leistung', { id: '1' }), line(-2500, 'Altteil', { id: '2' })] })), [])
})

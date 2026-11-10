// Gemeinsame XML-Leser für Kontoauszug (camt) und E-Rechnung (#188, #189).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { all, at, attr, decodeXml, makeParser, refuseUnsafe, signedDecimalToCents, text } from '../src/xml.ts'

test('XML: Beträge mit Vorzeichen centgenau, ohne Runden', () => {
  assert.equal(signedDecimalToCents('-12.5'), -1250)
  assert.equal(signedDecimalToCents('12'), 1200)
  assert.equal(signedDecimalToCents('12.3400'), 1234)
  assert.equal(signedDecimalToCents(' 7.05 '), 705)
  assert.equal(signedDecimalToCents('-0.00'), 0)
  assert.equal(signedDecimalToCents('0.005'), null)
  assert.equal(signedDecimalToCents('1e3'), null)
  assert.equal(signedDecimalToCents('12,50'), null)
  assert.equal(signedDecimalToCents('+5'), null)
  assert.equal(signedDecimalToCents(''), null)
})

test('XML: Dokumenttyp-Erklärung und unvollständiges XML werden erkannt', () => {
  assert.equal(refuseUnsafe('<!DOCTYPE x><x/>'), 'doctype')
  assert.equal(refuseUnsafe('<x><!ENTITY a "b"></x>'), 'doctype')
  assert.equal(refuseUnsafe('<a><b></a>'), 'incomplete')
  assert.equal(refuseUnsafe('<a><b>1</b></a>'), null)
})

test('XML: Attribute, Pfade und Text mit Entitäten', () => {
  const doc = makeParser({ keepPrefixes: false }).parse('<p:a xmlns:p="urn:x" x="1"><p:b>M&#252;ller &amp; S&#xF6;hne</p:b><p:b>2</p:b></p:a>')
  assert.equal(attr(doc.a, 'x'), '1')
  assert.equal(text(at(doc, 'a', 'b')), 'Müller & Söhne')
  assert.deepEqual(all(doc, 'a', 'b').map(text), ['Müller & Söhne', '2'])
  const kept = makeParser({ keepPrefixes: true }).parse('<p:a xmlns:p="urn:x"/>')
  assert.equal(attr(kept['p:a'], 'xmlns:p'), 'urn:x')
})

test('XML: Kodierung aus der XML-Erklärung', () => {
  const latin = Buffer.concat([Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><a>M'), Buffer.from([0xfc]), Buffer.from('ller</a>')])
  const decoded = decodeXml(latin)
  assert.ok('xml' in decoded)
  assert.match(decoded.xml, /Müller/)
  assert.ok('problem' in decodeXml(Buffer.from('<?xml version="1.0" encoding="x-unbekannt"?><a/>')))
})

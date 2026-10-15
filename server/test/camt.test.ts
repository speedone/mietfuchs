// Kontoauszüge im Format camt lesen (#188): die reine Funktion, ohne Datenbank.
//
// Die Beispielauszüge unter fixtures/camt/ sind erfunden, ebenso alles, was hier im Test
// gebaut wird. Echte Kontoauszüge gehören nie ins Repo.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'
import { amountToCents, readCamt, readCamtFile } from '../src/bank/camt.ts'
import { readBankFile } from '../src/bank/read.ts'
import type { BankEntry, BankReadResult } from '../src/bank/statement.ts'

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'camt')
const fixture = (name: string) => fs.readFileSync(path.join(FIXTURES, name))

const ACCOUNT = 'DE00123456789012345678'

// Ein camt.053 mit einem Auszug und den gegebenen Umsätzen, als XML-Bausteine.
function camt053(entries: string[], account = ACCOUNT): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt><Stmt><Id>S1</Id><Acct><Id><IBAN>${account}</IBAN></Id></Acct>
    ${entries.join('\n')}
  </Stmt></BkToCstmrStmt>
</Document>`
}

type EntryOptions = {
  amount?: string, ccy?: string, ind?: string, date?: string, booking?: string, status?: string,
  ref?: string, iban?: string, name?: string, purpose?: string,
}

function ntry(o: EntryOptions = {}): string {
  return `<Ntry>
    <Amt Ccy="${o.ccy ?? 'EUR'}">${o.amount ?? '850.00'}</Amt>
    <CdtDbtInd>${o.ind ?? 'CRDT'}</CdtDbtInd>
    ${o.status ?? '<Sts>BOOK</Sts>'}
    <BookgDt>${o.booking ?? `<Dt>${o.date ?? '2025-03-03'}</Dt>`}</BookgDt>
    ${o.ref ? `<AcctSvcrRef>${o.ref}</AcctSvcrRef>` : ''}
    <NtryDtls><TxDtls>
      <RltdPties>
        <Dbtr><Nm>${o.name ?? 'Erika Beispiel'}</Nm></Dbtr>
        <DbtrAcct><Id><IBAN>${o.iban ?? 'DE00500105170000000001'}</IBAN></Id></DbtrAcct>
      </RltdPties>
      <RmtInf><Ustrd>${o.purpose ?? 'Miete'}</Ustrd></RmtInf>
    </TxDtls></NtryDtls>
  </Ntry>`
}

function entriesOf(r: BankReadResult): BankEntry[] {
  return r.statements.flatMap((s) => s.entries)
}

function onlyEntry(r: BankReadResult): BankEntry {
  const all = entriesOf(r)
  if (all.length !== 1) assert.fail(`genau ein Umsatz erwartet, gelesen: ${all.length}`)
  return all[0]
}

// ---------- Beträge ----------

test('camt: Beträge werden centgenau ohne Gleitkomma gelesen', () => {
  assert.equal(amountToCents('850.00'), 85000)
  assert.equal(amountToCents('850'), 85000)
  assert.equal(amountToCents('850.5'), 85050)
  assert.equal(amountToCents('0.01'), 1)
  // 0,1 + 0,2 als Gleitkomma wäre 0,30000000000000004
  assert.equal(amountToCents('0.30'), 30)
  assert.equal(amountToCents('1234567.89'), 123456789)
  // camt erlaubt fünf Nachkommastellen; Nullen dahinter sind kein Bruchteil eines Cents
  assert.equal(amountToCents('12.34000'), 1234)
})

test('camt: ein Betrag mit Bruchteil eines Cents wird nicht gerundet, sondern abgelehnt', () => {
  assert.equal(amountToCents('850.123'), null)
  assert.equal(amountToCents('-850.00'), null) // die Richtung steht in CdtDbtInd, nie im Betrag
  assert.equal(amountToCents('850,00'), null)
  assert.equal(amountToCents(''), null)
})

// ---------- die Beispielauszüge ----------

test('camt.053.001.02: Eingänge, Ausgang und vorgemerkter Umsatz', () => {
  const r = readCamtFile(fixture('camt053-001.02.xml'), 'auszug.xml')
  assert.deepEqual(r.problems, [])
  assert.equal(r.statements.length, 1)
  const st = r.statements[0]
  assert.equal(st.format, 'camt.053')
  assert.equal(st.statementId, '2025-03-03-001')
  assert.equal(st.accountIban, ACCOUNT, 'Leerzeichen der IBAN fallen weg')
  assert.equal(st.fromDate, '2025-03-03')
  assert.equal(st.toDate, '2025-03-03')
  // Der vorgemerkte Umsatz wird gezählt, aber nicht gelesen
  assert.equal(r.pendingSkipped, 1)
  assert.equal(st.entries.length, 3)

  const [rent1, rent2, tax] = st.entries
  assert.match(rent1.fingerprint, /^[0-9a-f]{64}$/)
  assert.deepEqual({ ...rent1, fingerprint: '' }, {
    bookingDate: '2025-03-03',
    valueDate: '2025-03-03',
    amountCents: 85000,
    counterpartyName: 'Erika Beispiel',
    counterpartyIban: 'DE00500105170000000001',
    ultimatePartyName: null,
    purpose: 'Miete Maerz 2025 Whg 1 Lindenweg 12',
    bankReference: '2025030300001',
    endToEndId: null, // „NOTPROVIDED“ ist keine Referenz
    reversal: false,
    bookingDateEstimated: false,
    batch: null,
    fingerprint: '',
  })
  assert.equal(rent2.amountCents, 72000, 'Betrag ohne Nachkommastellen')
  assert.equal(rent2.bookingDate, '2025-03-03', '00:10 Uhr deutscher Zeit ist der 3. März')
  assert.equal(rent2.counterpartyIban, 'DE00500105170000000002', 'IBAN in Großbuchstaben, ohne Leerzeichen')
  assert.equal(rent2.endToEndId, 'MIETE-W2')
  assert.equal(rent2.bankReference, null)
  assert.equal(tax.amountCents, -31240, 'ein Ausgang ist negativ')
  assert.equal(tax.counterpartyName, 'Stadtkasse Musterstadt', 'bei einem Ausgang ist die Gegenpartei der Empfänger')
  assert.equal(tax.counterpartyIban, 'DE00700500000000000099')
})

test('camt.053.001.08: Sammelbuchung wird in Posten zerlegt, Rücklastschrift nennt den Mieter', () => {
  const r = readCamtFile(fixture('camt053-001.08.xml'), 'auszug.xml')
  assert.deepEqual(r.problems, [])
  assert.equal(entriesOf(r).length, 3)
  const [a, b, back] = entriesOf(r)
  assert.equal(a.amountCents, 85000)
  assert.equal(a.counterpartyName, 'Erika Beispiel', 'Name ab .08 unter Pty')
  assert.equal(a.purpose, 'Miete April')
  assert.equal(b.amountCents, 72000)
  assert.equal(b.counterpartyIban, 'DE00500105170000000002')
  assert.equal(a.amountCents + b.amountCents, 157000, 'die Posten ergeben genau den Umsatz')
  assert.deepEqual(a.batch, { reference: 'SAMMEL-0401', totalCents: 157000, part: 1, parts: 2 })
  assert.deepEqual(b.batch, { reference: 'SAMMEL-0401', totalCents: 157000, part: 2, parts: 2 })
  assert.notEqual(a.fingerprint, b.fingerprint)
  // Die Rücklastschrift: Geld fließt ab, aber die Gegenseite ist der Mieter, nicht das eigene Konto
  assert.equal(back.amountCents, -72000)
  assert.equal(back.reversal, true)
  assert.equal(back.counterpartyName, 'Max Mustermann')
  assert.equal(back.counterpartyIban, 'DE00500105170000000002')
})

test('camt: eine Sammelbuchung, deren Posten nicht aufgehen, bleibt ein Umsatz und wird gemeldet', () => {
  const batch = `<Ntry><Amt Ccy="EUR">1000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts>
    <BookgDt><Dt>2025-03-03</Dt></BookgDt><AddtlNtryInf>SAMMLER 2 POSTEN</AddtlNtryInf>
    <NtryDtls>
      <TxDtls><Amt Ccy="EUR">600.00</Amt></TxDtls>
      <TxDtls><Amt Ccy="EUR">300.00</Amt></TxDtls>
    </NtryDtls></Ntry>`
  const r = readCamt(camt053([batch]))
  assert.equal(onlyEntry(r).amountCents, 100000, 'der Betrag des Umsatzes gilt, nicht die Summe der Posten')
  assert.equal(onlyEntry(r).counterpartyIban, null, 'keine Gegenseite aus einem einzelnen Posten')
  assert.equal(onlyEntry(r).purpose, 'SAMMLER 2 POSTEN')
  assert.equal(onlyEntry(r).batch, null)
  assert.equal(r.problems.length, 1)
  assert.match(r.problems[0].message, /Sammelbuchung/)
})

test('camt: Posten in mehreren NtryDtls-Blöcken werden alle gelesen', () => {
  // camt erlaubt NtryDtls mehrfach; manche Banken schreiben je Posten einen eigenen Block.
  const batch = `<Ntry><Amt Ccy="EUR">1570.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts>
    <BookgDt><Dt>2025-03-03</Dt></BookgDt>
    <NtryDtls><TxDtls><Amt Ccy="EUR">850.00</Amt><RltdPties><Dbtr><Nm>A</Nm></Dbtr></RltdPties></TxDtls></NtryDtls>
    <NtryDtls><TxDtls><Amt Ccy="EUR">720.00</Amt><RltdPties><Dbtr><Nm>B</Nm></Dbtr></RltdPties></TxDtls></NtryDtls>
  </Ntry>`
  const r = readCamt(camt053([batch]))
  assert.deepEqual(r.problems, [])
  assert.deepEqual(entriesOf(r).map((e) => [e.counterpartyName, e.amountCents]), [['A', 85000], ['B', 72000]])
})

test('camt: ein Sammler mit gemischten Richtungen wird mit Vorzeichen zerlegt', () => {
  const batch = `<Ntry><Amt Ccy="EUR">850.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts>
    <BookgDt><Dt>2025-03-03</Dt></BookgDt>
    <NtryDtls>
      <TxDtls><Amt Ccy="EUR">1000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd></TxDtls>
      <TxDtls><Amt Ccy="EUR">150.00</Amt><CdtDbtInd>DBIT</CdtDbtInd></TxDtls>
    </NtryDtls></Ntry>`
  assert.deepEqual(entriesOf(readCamt(camt053([batch]))).map((e) => e.amountCents), [100000, -15000])
})

// ---------- Gegenseite ----------

test('camt: abweichender Zahler (UltmtDbtr) wird mitgeführt', () => {
  const xml = camt053([ntry()]).replace('<DbtrAcct>', '<UltmtDbtr><Nm>Jobcenter Musterstadt</Nm></UltmtDbtr><DbtrAcct>')
  const e = onlyEntry(readCamt(xml))
  assert.equal(e.counterpartyName, 'Erika Beispiel')
  assert.equal(e.ultimatePartyName, 'Jobcenter Musterstadt')
})

test('camt: steht auf der erwarteten Seite das eigene Konto, ist die Gegenseite die andere', () => {
  // Eine Bank, die die Rollen einer Rücklastschrift ohne RvslInd vertauscht, darf nicht dazu
  // führen, dass der Vermieter als Zahler seines eigenen Kontos dasteht.
  const xml = camt053([`<Ntry><Amt Ccy="EUR">720.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts>
    <BookgDt><Dt>2025-04-08</Dt></BookgDt>
    <NtryDtls><TxDtls><RltdPties>
      <Dbtr><Nm>Max Mustermann</Nm></Dbtr><DbtrAcct><Id><IBAN>DE00500105170000000002</IBAN></Id></DbtrAcct>
      <Cdtr><Nm>Vermieter</Nm></Cdtr><CdtrAcct><Id><IBAN>${ACCOUNT}</IBAN></Id></CdtrAcct>
    </RltdPties></TxDtls></NtryDtls></Ntry>`])
  assert.equal(onlyEntry(readCamt(xml)).counterpartyName, 'Max Mustermann')
})

// ---------- Datum ----------

test('camt: ein Zeitpunkt in UTC wird in den Kalendertag in Deutschland umgerechnet', () => {
  const late = onlyEntry(readCamt(camt053([ntry({ booking: '<DtTm>2025-03-02T23:30:00Z</DtTm>' })])))
  assert.equal(late.bookingDate, '2025-03-03', '23:30 Uhr UTC ist in Deutschland schon der 3. März')
  const newYear = onlyEntry(readCamt(camt053([ntry({ booking: '<DtTm>2025-12-31T23:30:00Z</DtTm>' })])))
  assert.equal(newYear.bookingDate, '2026-01-01', 'am Jahreswechsel hängt daran das Jahr')
  const summer = onlyEntry(readCamt(camt053([ntry({ booking: '<DtTm>2025-07-31T22:30:00Z</DtTm>' })])))
  assert.equal(summer.bookingDate, '2025-08-01', 'im Sommer gilt die Sommerzeit')
  const local = onlyEntry(readCamt(camt053([ntry({ booking: '<DtTm>2025-03-03T23:30:00</DtTm>' })])))
  assert.equal(local.bookingDate, '2025-03-03', 'ohne Zeitzone gilt die Ortszeit der Bank')
})

// ---------- Fassungen, Arten, Kodierung ----------

test('camt.052 und camt.054 werden wie camt.053 gelesen', () => {
  const body = `<Acct><Id><IBAN>${ACCOUNT}</IBAN></Id></Acct>${ntry()}`
  const c052 = readCamt(`<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.052.001.08"><BkToCstmrAcctRpt><Rpt><Id>R1</Id>${body}</Rpt></BkToCstmrAcctRpt></Document>`)
  const c054 = readCamt(`<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.02"><BkToCstmrDbtCdtNtfctn><Ntfctn><Id>N1</Id>${body}</Ntfctn></BkToCstmrDbtCdtNtfctn></Document>`)
  assert.equal(c052.statements[0].format, 'camt.052')
  assert.equal(c054.statements[0].format, 'camt.054')
  assert.equal(onlyEntry(c052).amountCents, 85000)
  assert.equal(onlyEntry(c054).amountCents, 85000)
})

test('camt: Namensraum-Präfixe ändern nichts', () => {
  const plain = readCamt(camt053([ntry()]))
  const prefixed = readCamt(camt053([ntry()]).replace(/<(\/?)(?!\?)([A-Za-z])/g, '<$1ns:$2').replace('xmlns=', 'xmlns:ns='))
  assert.deepEqual(prefixed, plain)
})

test('camt: Status als Code (ab .08) und als Prtry wird gelesen', () => {
  assert.equal(entriesOf(readCamt(camt053([ntry({ status: '<Sts><Cd>BOOK</Cd></Sts>' })]))).length, 1)
  assert.equal(entriesOf(readCamt(camt053([ntry({ status: '<Sts><Prtry>BOOK</Prtry></Sts>' })]))).length, 1)
  const pending = readCamt(camt053([ntry({ status: '<Sts><Cd>PDNG</Cd></Sts>' })]))
  assert.equal(entriesOf(pending).length, 0)
  assert.equal(pending.pendingSkipped, 1)
})

test('camt: ISO-8859-1 aus der XML-Erklärung wird beachtet', () => {
  const xml = camt053([ntry({ purpose: 'Miete März' })]).replace('encoding="UTF-8"', 'encoding="ISO-8859-1"')
  const e = onlyEntry(readCamtFile(Buffer.from(xml, 'latin1'), 'alt.xml'))
  assert.equal(e.purpose, 'Miete März')
  // und derselbe Umsatz in UTF-8 hat denselben Fingerabdruck
  assert.equal(e.fingerprint, onlyEntry(readCamtFile(Buffer.from(camt053([ntry({ purpose: 'Miete März' })]), 'utf8'), 'neu.xml')).fingerprint)
})

test('camt: UTF-8 mit Byte-Order-Mark und Zeichenreferenzen', () => {
  const xml = '\uFEFF' + camt053([ntry({ purpose: 'Miete M&#xE4;rz &amp; M&#228;rz &lt;1&gt; &quot;a&quot; &apos;b&apos; &amp;lt;' })])
  // „&amp;lt;“ ist der Text „&lt;“ und wird nicht zweimal aufgelöst
  assert.equal(onlyEntry(readCamtFile(Buffer.from(xml, 'utf8'), 'bom.xml')).purpose, 'Miete März & März <1> "a" \'b\' &lt;')
})

// ---------- Befunde statt Raten ----------

test('camt: fremde Währung, unlesbarer Betrag, fehlendes Datum und fehlender Status ergeben Befunde, keine Umsätze', () => {
  const r = readCamt(camt053([
    ntry({ ccy: 'USD' }),
    ntry({ amount: '850.123' }),
    ntry({ date: '' }),
    ntry({ ind: 'XXXX' }),
    ntry({ status: '' }),
    ntry({ purpose: 'gültig' }),
  ]))
  assert.equal(onlyEntry(r).purpose, 'gültig')
  assert.equal(r.problems.length, 5)
  assert.match(r.problems[0].message, /USD/)
  assert.match(r.problems[1].message, /850\.123/)
  assert.match(r.problems[2].message, /Buchungsdatum/)
  assert.match(r.problems[3].message, /Richtung/)
  assert.match(r.problems[4].message, /Status/)
  assert.match(r.problems[0].where, /Umsatz 1/, 'der Befund nennt den Umsatz')
})

test('camt: keine camt-Datei, kaputtes XML und Dokumenttyp-Erklärung werden abgelehnt', () => {
  assert.match(readCamt('<Document><Foo/></Document>').problems[0].message, /kein Kontoauszug/)
  assert.match(readCamt('<Document><BkToCstmrStmt>').problems[0].message, /kein vollständiges XML/)
  // abgeschnitten mitten im Auszug: kein halber Auszug, sondern ein Befund
  const full = camt053([ntry(), ntry({ purpose: 'zweite' })])
  const cut = readCamt(full.slice(0, full.indexOf('zweite')))
  assert.equal(entriesOf(cut).length, 0)
  assert.match(cut.problems[0].message, /kein vollständiges XML/)
  assert.match(readCamt('<Document><BkToCstmrStmt></BkToCstmrStmt></Document>').problems[0].message, /keinen Auszug/)
  const entity = `<?xml version="1.0"?><!DOCTYPE d [<!ENTITY a "aaaa">]>${camt053([ntry()]).replace(/^<\?xml[^>]*>/, '')}`
  const r = readCamt(entity)
  assert.equal(entriesOf(r).length, 0)
  assert.match(r.problems[0].message, /Dokumenttyp/)
})

test('camt: ein Konto ohne IBAN wird mit seiner Kennung gelesen und gemeldet', () => {
  const other = readCamt(camt053([ntry()]).replace(/<Acct>.*?<\/Acct>/s, '<Acct><Id><Othr><Id>1234567890</Id></Othr></Id></Acct>'))
  assert.equal(other.statements[0].accountIban, null)
  assert.equal(other.statements[0].accountOtherId, '1234567890')
  assert.equal(entriesOf(other).length, 1)
  assert.match(other.problems[0].message, /„1234567890“, ohne IBAN/)
  const none = readCamt(camt053([ntry()]).replace(/<Acct>.*?<\/Acct>/s, ''))
  assert.match(none.problems[0].message, /nennt das Konto nicht/)
})

// ---------- Fingerabdruck ----------

// Der Parser entscheidet nicht, ob ein Umsatz schon bekannt ist (siehe camt.ts). Was er
// zusichert: Derselbe Umsatz hat überall denselben Fingerabdruck, gleich in welcher Datei,
// mit welchen Nachbarn und ob die Bank eine Referenz mitgibt.

test('camt: derselbe Umsatz hat in jeder Datei denselben Fingerabdruck', () => {
  const a = entriesOf(readCamtFile(fixture('camt053-001.02.xml'), 'a.xml')).map((e) => e.fingerprint)
  const b = entriesOf(readCamtFile(fixture('camt053-001.02.xml'), 'b.xml')).map((e) => e.fingerprint)
  assert.deepEqual(a, b)
  assert.equal(new Set(a).size, a.length)
})

test('camt: der Fingerabdruck hängt nicht an Nachbarn, Referenz, Name oder Datei', () => {
  const alone = onlyEntry(readCamt(camt053([ntry()]))).fingerprint
  // mit anderen Umsätzen im selben Auszug, auch einem gleichen
  const crowded = entriesOf(readCamt(camt053([ntry({ purpose: 'andere' }), ntry(), ntry()]))).map((e) => e.fingerprint)
  assert.equal(crowded[1], alone)
  assert.equal(crowded[2], alone, 'zwei gleiche Überweisungen haben denselben Fingerabdruck; was daraus folgt, entscheidet der Import')
  // camt.052 ohne Referenz, camt.053 mit: dieselbe Buchung
  assert.equal(onlyEntry(readCamt(camt053([ntry({ ref: '2025030300001' })]))).fingerprint, alone)
  // anders gekürzter Name
  assert.equal(onlyEntry(readCamt(camt053([ntry({ name: 'ERIKA BEISP' })]))).fingerprint, alone)
  // im ZIP neben einer Datei, in der dieselbe Referenz eine andere Buchung nennt
  const zip = new AdmZip()
  zip.addFile('a.xml', Buffer.from(camt053([ntry({ ref: '0001' })])))
  zip.addFile('b.xml', Buffer.from(camt053([ntry({ ref: '0001', amount: '720.00', iban: 'DE00500105170000000002' })])))
  assert.equal(entriesOf(readBankFile(zip.toBuffer(), 'z.zip'))[0].fingerprint, alone)
})

test('camt: verschiedene Buchungen haben verschiedene Fingerabdrücke, auch bei gleicher Referenz', () => {
  // Banken, die ihre Referenz je Tag neu zählen: dieselbe Referenz, verschiedene Buchungen
  const day1 = onlyEntry(readCamt(camt053([ntry({ ref: '0001', date: '2025-03-03' })])))
  const day2 = onlyEntry(readCamt(camt053([ntry({ ref: '0001', date: '2025-03-04', amount: '720.00', iban: 'DE00500105170000000002' })])))
  assert.equal(day1.bankReference, day2.bankReference)
  assert.notEqual(day1.fingerprint, day2.fingerprint)
  const base = onlyEntry(readCamt(camt053([ntry()]))).fingerprint
  for (const o of [{ date: '2025-03-04' }, { amount: '850.01' }, { iban: 'DE00500105170000000009' }, { purpose: 'Kaution' }, { ind: 'DBIT' }]) {
    assert.notEqual(onlyEntry(readCamt(camt053([ntry(o)]))).fingerprint, base, JSON.stringify(o))
  }
})

test('camt: ein Sammler als Summe und zerlegt trägt dieselbe Referenz und Summe', () => {
  // camt.052 meldet die Sammelbuchung mitunter als Summe, camt.053 zerlegt sie. Der Import
  // erkennt die beiden an Referenz und Summe als dieselbe Buchung.
  const summed = onlyEntry(readCamt(camt053([`<Ntry><Amt Ccy="EUR">1570.00</Amt><CdtDbtInd>CRDT</CdtDbtInd>
    <Sts>BOOK</Sts><BookgDt><Dt>2025-04-01</Dt></BookgDt><AcctSvcrRef>SAMMEL-0401</AcctSvcrRef></Ntry>`])))
  const parts = entriesOf(readCamtFile(fixture('camt053-001.08.xml'), 'a.xml')).filter((e) => e.batch)
  assert.equal(summed.bankReference, 'SAMMEL-0401')
  assert.ok(parts.every((p) => p.batch?.reference === summed.bankReference && p.batch.totalCents === summed.amountCents))
})

// ---------- ZIP ----------

test('camt: ein ZIP mit mehreren Auszügen wird vollständig gelesen, Nicht-XML und macOS-Beiwerk übergangen', () => {
  const zip = new AdmZip()
  zip.addFile('2025-03-03.xml', fixture('camt053-001.02.xml'))
  zip.addFile('2025-04-01.xml', fixture('camt053-001.08.xml'))
  zip.addFile('liesmich.txt', Buffer.from('kein Auszug'))
  zip.addFile('__MACOSX/._2025-03-03.xml', Buffer.from([0x00, 0x05, 0x16, 0x07]))
  zip.addFile('._2025-04-01.xml', Buffer.from([0x00, 0x05, 0x16, 0x07]))
  const r = readBankFile(zip.toBuffer(), 'auszuege.zip')
  assert.deepEqual(r.problems, [])
  assert.equal(r.statements.length, 2)
  assert.equal(entriesOf(r).length, 6)
  assert.equal(r.pendingSkipped, 1)
})

test('camt: die Packreihenfolge eines ZIP ändert nichts', () => {
  const forward = new AdmZip()
  forward.addFile('a.xml', Buffer.from(camt053([ntry({ purpose: 'x' })])))
  forward.addFile('b.xml', Buffer.from(camt053([ntry({ purpose: 'y' })])))
  const backward = new AdmZip()
  backward.addFile('b.xml', Buffer.from(camt053([ntry({ purpose: 'y' })])))
  backward.addFile('a.xml', Buffer.from(camt053([ntry({ purpose: 'x' })])))
  const read = (z: AdmZip) => readBankFile(z.toBuffer(), 'z.zip')
  assert.deepEqual(read(backward), read(forward))
})

test('camt: ein ZIP ohne XML, ein kaputtes ZIP und eine beschädigte Datei darin ergeben Befunde statt eines Absturzes', () => {
  const empty = new AdmZip()
  empty.addFile('liesmich.txt', Buffer.from('x'))
  assert.match(readBankFile(empty.toBuffer(), 'leer.zip').problems[0].message, /keinen Kontoauszug/)

  const broken = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('kaputt')])
  assert.ok(readBankFile(broken, 'kaputt.zip').problems.length > 0)

  // Eine Datei, deren Inhalt nach dem Packen verändert wurde: Die Prüfsumme stimmt nicht mehr.
  const zip = new AdmZip()
  zip.addFile('a.xml', Buffer.from(camt053([ntry()])))
  const stored = zip.getEntry('a.xml')
  if (!stored) assert.fail('Eintrag fehlt')
  stored.header.method = 0 // unkomprimiert, damit sich ein Byte gezielt verändern lässt
  const bytes = zip.toBuffer()
  const at = bytes.indexOf(Buffer.from('Erika'))
  if (at < 0) assert.fail('Der Inhalt sollte unkomprimiert im Archiv stehen')
  bytes[at] = 'X'.charCodeAt(0)
  const r = readBankFile(bytes, 'manipuliert.zip')
  assert.equal(entriesOf(r).length, 0)
  assert.ok(r.problems.length > 0)
})

// ---------- Befunde der Durchsicht in #282 ----------

test('camt: eine Sammelbuchung mit nur einem genannten Posten wird nicht dessen Zahler zugeschrieben', () => {
  // 2.400 € gesammelt, angekündigt drei Posten, genannt nur Erikas 800 €: sonst stünde ein Umsatz
  // über 2.400 € von Erika da, und die Zuordnung schlüge ihr eine dreifache Miete vor.
  const announced = `<Ntry><Amt Ccy="EUR">2400.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts>
    <BookgDt><Dt>2025-03-03</Dt></BookgDt><AcctSvcrRef>SAMMEL-1</AcctSvcrRef>
    <NtryDtls><Btch><NbOfTxs>3</NbOfTxs></Btch>
      <TxDtls><Amt Ccy="EUR">800.00</Amt><RltdPties><Dbtr><Nm>Erika Beispiel</Nm></Dbtr>
        <DbtrAcct><Id><IBAN>DE00500105170000000001</IBAN></Id></DbtrAcct></RltdPties>
        <RmtInf><Ustrd>Miete</Ustrd></RmtInf></TxDtls>
    </NtryDtls></Ntry>`
  const r = readCamt(camt053([announced]))
  const e = onlyEntry(r)
  assert.equal(e.amountCents, 240000)
  assert.equal(e.counterpartyName, null)
  assert.equal(e.counterpartyIban, null)
  assert.equal(r.problems.length, 1)
  assert.match(r.problems[0].message, /Sammelbuchung/)
  // Ohne NbOfTxs, aber mit abweichendem Betrag des Postens: ebenso
  const r2 = readCamt(camt053([announced.replace('<Btch><NbOfTxs>3</NbOfTxs></Btch>', '')]))
  assert.equal(onlyEntry(r2).counterpartyIban, null)
  assert.equal(r2.problems.length, 1)
  // Ein einzelner Posten mit gleichem Betrag bleibt der Umsatz mit Gegenseite
  const whole = onlyEntry(readCamt(camt053([announced.replace('<Btch><NbOfTxs>3</NbOfTxs></Btch>', '').replace('2400.00', '800.00')])))
  assert.equal(whole.counterpartyName, 'Erika Beispiel')
})

test('camt: ein unlesbarer Saldo wird gemeldet, statt die Saldenprobe still entfallen zu lassen', () => {
  const xml = camt053([ntry()]).replace('<Acct>', `<Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">1.000,00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2025-03-03</Dt></Dt></Bal>
    <Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">1850.00</Amt><Dt><Dt>2025-03-03</Dt></Dt></Bal><Acct>`)
  const r = readCamt(xml)
  const messages = r.problems.map((p) => p.message)
  assert.ok(messages.some((m) => /Anfangssaldo lässt sich nicht lesen/.test(m)), messages.join(' | '))
  assert.ok(messages.some((m) => /Endsaldo lässt sich nicht lesen/.test(m)), messages.join(' | '))
})

test('camt: RvslInd als XML-Boolean, also auch „1“', () => {
  const xml = (v: string) => camt053([ntry({ ind: 'DBIT' }).replace('<Sts>', `<RvslInd>${v}</RvslInd><Sts>`)])
  assert.equal(onlyEntry(readCamt(xml('1'))).reversal, true)
  assert.equal(onlyEntry(readCamt(xml('true'))).reversal, true)
  assert.equal(onlyEntry(readCamt(xml('0'))).reversal, false)
})

test('camt: nennen beide Seiten nur das eigene Konto, gibt es keine Gegenseite', () => {
  const xml = camt053([`<Ntry><Amt Ccy="EUR">50.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts>
    <BookgDt><Dt>2025-03-03</Dt></BookgDt>
    <NtryDtls><TxDtls><RltdPties>
      <Dbtr><Nm>Vermieter</Nm></Dbtr><DbtrAcct><Id><IBAN>${ACCOUNT}</IBAN></Id></DbtrAcct>
    </RltdPties></TxDtls></NtryDtls></Ntry>`])
  const e = onlyEntry(readCamt(xml))
  assert.equal(e.counterpartyIban, null)
  assert.equal(e.counterpartyName, null)
})

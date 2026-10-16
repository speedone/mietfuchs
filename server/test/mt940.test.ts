// Kontoauszüge im Format MT940 lesen (#188). Der Beispielauszug ist erfunden.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readMt940 } from '../src/bank/mt940.ts'
import { readBankFile } from '../src/bank/read.ts'
import { readCamt } from '../src/bank/camt.ts'

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'mt940', 'sparkasse.sta')

test('MT940: Auszug im Stil einer Sparkasse', () => {
  const r = readBankFile(fs.readFileSync(FIXTURE), 'umsaetze.sta')
  assert.equal(r.statements.length, 1)
  const st = r.statements[0]
  assert.equal(st.format, 'mt940')
  assert.equal(st.statementId, '3/1')
  assert.equal(st.accountIban, null)
  assert.equal(st.accountOtherId, '50010517/0123456789')
  assert.match(r.problems[0].message, /ohne IBAN/)
  assert.equal(r.problems.length, 1)
  assert.equal(st.openingBalanceCents, 100000)
  assert.equal(st.closingBalanceCents, 153760)
  assert.equal(st.entries.length, 4)
  // Saldenprüfung: Anfang + Umsätze = Ende
  assert.equal((st.openingBalanceCents ?? 0) + st.entries.reduce((a, e) => a + e.amountCents, 0), st.closingBalanceCents)

  const [rent1, rent2, tax, back] = st.entries
  assert.deepEqual({ ...rent1, fingerprint: '' }, {
    bookingDate: '2025-03-03',
    valueDate: '2025-03-03',
    amountCents: 85000,
    counterpartyName: 'Erika Beispiel',
    counterpartyIban: 'DE00500105170000000001',
    ultimatePartyName: null,
    purpose: 'Miete Maerz 2025 Whg 1 Lindenweg 12',
    bankReference: '2025030300001',
    endToEndId: null,
    reversal: false,
    bookingDateEstimated: false,
    batch: null,
    fingerprint: '',
  })
  assert.equal(rent2.ultimatePartyName, 'Jobcenter Musterstadt', 'ABWA+ über zwei Unterfelder')
  assert.equal(rent2.endToEndId, 'MIETE-W2')
  assert.equal(rent2.bankReference, null)
  assert.equal(tax.amountCents, -31240)
  assert.equal(tax.purpose, 'Grundsteuer 1. Quartal 2025', 'der Zweck ist der SVWZ-Teil, über Unterfelder hinweg')
  assert.equal(tax.counterpartyName, 'Stadtkasse Musterstadt')
  assert.equal(back.amountCents, -72000, 'RC ist der Storno einer Gutschrift und mindert das Konto')
  assert.equal(back.reversal, true)
  assert.equal(back.bookingDate, '2025-04-08')
})

test('MT940 und camt ergeben für dieselbe Buchung denselben Fingerabdruck', () => {
  const mt = readMt940(fs.readFileSync(FIXTURE, 'latin1')).statements[0].entries[0]
  const camt = readCamt(`<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"><BkToCstmrStmt><Stmt><Id>1</Id>
    <Acct><Id><IBAN>DE00123456789012345678</IBAN></Id></Acct>
    <Ntry><Amt Ccy="EUR">850.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts><BookgDt><Dt>2025-03-03</Dt></BookgDt>
    <NtryDtls><TxDtls><RltdPties><Dbtr><Pty><Nm>Erika Beispiel</Nm></Pty></Dbtr><DbtrAcct><Id><IBAN>DE00500105170000000001</IBAN></Id></DbtrAcct></RltdPties>
    <RmtInf><Ustrd>Miete Maerz 2025 Whg 1 Lindenweg 12</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry></Stmt></BkToCstmrStmt></Document>`).statements[0].entries[0]
  assert.equal(mt.fingerprint, camt.fingerprint)
})

test('MT940: Buchungstag am Jahreswechsel', () => {
  const text = [':20:X', ':25:DE00123456789012345678', ':60F:C241231EUR0,00',
    ':61:2412310102C10,00NTRFNONREF', ':86:166?20SVWZ+a', // Wertstellung 31.12., gebucht 02.01.
    ':61:2501021231D5,00NTRFNONREF', ':86:166?20SVWZ+b', // Wertstellung 02.01., gebucht 31.12.
    ':62F:C250102EUR5,00'].join('\n')
  const [a, b] = readMt940(text).statements[0].entries
  assert.equal(a.bookingDate, '2025-01-02')
  assert.equal(b.bookingDate, '2024-12-31')
})

test('MT940: unlesbare Zeile, fremde Währung und keine MT940-Datei ergeben Befunde', () => {
  const bad = readMt940([':20:X', ':25:DE00123456789012345678', ':60F:C250101EUR0,00', ':61:XXXX', ':62F:C250101EUR0,00'].join('\n'))
  assert.equal(bad.statements[0].entries.length, 0)
  assert.match(bad.problems[0].message, /Umsatzzeile/)
  const usd = readMt940([':20:X', ':25:DE00123456789012345678', ':60F:C250101USD0,00', ':61:2501010101C1,00NTRFX', ':62F:C250101USD1,00'].join('\n'))
  assert.equal(usd.statements[0].entries.length, 0)
  assert.match(usd.problems[0].message, /USD/)
  assert.match(readBankFile(Buffer.from('Hallo Welt'), 'x.txt').problems[0].message, /kein Kontoauszug/)
})

test('MT940 in ISO-8859-1 wird erkannt', () => {
  const text = [':20:X', ':25:DE00123456789012345678', ':60F:C250101EUR0,00', ':61:2501010101C1,00NTRFNONREF', ':86:166?20SVWZ+Miete März', ':62F:C250101EUR1,00'].join('\r\n')
  const r = readBankFile(Buffer.from(text, 'latin1'), 'alt.sta')
  assert.equal(r.statements[0].entries[0].purpose, 'Miete März')
})

test('Fingerabdruck: camt kürzt den Zweck auf 140 Zeichen, MT940 nicht; dieselbe Buchung bleibt dieselbe', () => {
  // camt führt den Zweck in einem Feld mit höchstens 140 Zeichen, MT940 in mehreren Unterfeldern.
  const long = 'Entgelt Kontofuehrung 01.07.2026 bis 30.09.2026 Grundpreis Postenentgelte Ueberweisungen beleglos Lastschriften Kartenumsaetze Zinsen Abschluss gemaess Preisverzeichnis'
  const mtText = [':20:X', ':25:50010517/0123456789', ':60F:C260930EUR10,00',
    ':61:2609300930D7,50NCHGNONREF', `:86:805?00ENTGELT?20${long.slice(0, 27)}?21${long.slice(27, 54)}?22${long.slice(54, 81)}?23${long.slice(81, 108)}?24${long.slice(108, 135)}?25${long.slice(135)}`,
    ':62F:C260930EUR2,50'].join('\n')
  const mt = readMt940(mtText).statements[0].entries[0]
  assert.equal(mt.purpose.length > 140, true)
  const camt = readCamt(`<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt><Id>1</Id>
    <Acct><Id><IBAN>DE00123456789012345678</IBAN></Id></Acct>
    <Ntry><Amt Ccy="EUR">7.50</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-09-30</Dt></BookgDt>
    <NtryDtls><TxDtls><RmtInf><Ustrd>${long.slice(0, 140)}</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry></Stmt></BkToCstmrStmt></Document>`).statements[0].entries[0]
  assert.equal(camt.fingerprint, mt.fingerprint)
})

test('MT940: ein Konto ohne IBAN wird einmal gemeldet, nicht je Tagesauszug', () => {
  const day = (d: string) => [':20:X', ':25:50010517/0123456789', `:60F:C${d}EUR0,00`, `:61:${d}${d.slice(2)}C1,00NTRFNONREF`, ':86:166?20SVWZ+a', `:62F:C${d}EUR1,00`].join('\n')
  const r = readMt940([day('250101'), day('250102'), day('250103')].join('\n-\n'))
  assert.equal(r.statements.length, 3)
  assert.equal(r.problems.length, 1)
})

// ---------- Befunde der Durchsicht vor dem PR ----------

const statement = (...lines: string[]) => [':20:X', ':25:DE00123456789012345678', ...lines].join('\n')

test('MT940: Rücklastschrift mit Wertstellung im November, gebucht im Januar, landet im neuen Jahr', () => {
  // Die Wertstellung einer zurückgegebenen Lastschrift ist der ursprüngliche Belastungstag
  const r = readMt940(statement(':60F:C250110EUR100,00', ':61:2411200110RD50,00NRTINONREF', ':86:109?20SVWZ+Rueckgabe', ':62F:C250110EUR150,00'))
  const e = r.statements[0].entries[0]
  assert.equal(e.bookingDate, '2025-01-10')
  assert.equal(e.valueDate, '2024-11-20')
  assert.deepEqual(r.problems, [])
})

test('MT940: SWIFT-Umschläge verschlucken den Endsaldo nicht', () => {
  const message = (day: string, amount: string, closing: string) => [
    '{1:F01BANKDEFFXXXX0000000000}{2:O9401200250110BANKDEFFXXXX00000000002501101200N}{3:{108:MT940}}{4:',
    ':20:X', ':25:DE00123456789012345678', `:60F:C${day}EUR0,00`, `:61:${day}${day.slice(2)}C${amount}NTRFNONREF`, ':86:166?20SVWZ+a', `:62F:C${day}EUR${closing}`,
    '-}{5:{CHK:ABCDEF012345}}',
  ].join('\r\n')
  const r = readMt940([message('250110', '1,00', '1,00'), message('250111', '2,00', '2,00')].join('\r\n'))
  assert.equal(r.statements.length, 2)
  assert.deepEqual(r.statements.map((s) => s.closingBalanceCents), [100, 200])
  assert.deepEqual(r.problems, [])
})

test('MT940: ein unlesbarer Saldo und eine Abweichung der Salden ergeben Befunde', () => {
  const unreadable = readMt940(statement(':60F:C250110EUR1,00', ':61:2501100110C1,00NTRFNONREF', ':62F:Cunlesbar'))
  assert.match(unreadable.problems.map((p) => p.message).join('|'), /Endsaldo \(:62:\) lässt sich nicht lesen/)
  const off = readMt940(statement(':60F:C250110EUR1,00', ':61:2501100110C1,00NTRFNONREF', ':62F:C250110EUR5,00'))
  assert.match(off.problems[0].message, /ergeben nicht den Endsaldo \(Abweichung -3\.00 €\)/)
  assert.equal(off.statements[0].entries.length, 1, 'der Auszug wird trotzdem geliefert')
})

test('MT940: eine SEPA-Kennung, die über eine Unterfeldgrenze geteilt ist, wird erkannt', () => {
  const r = readMt940(statement(':60F:C250110EUR0,00', ':61:2501100110C1,00NTRFNONREF', ':86:166?20EREF+ABC123 MREF+M1 SV?21WZ+Miete Januar Whg 3', ':62F:C250110EUR1,00'))
  const e = r.statements[0].entries[0]
  assert.equal(e.purpose, 'Miete Januar Whg 3')
  assert.equal(e.endToEndId, 'ABC123')
})

test('MT940: ein Freitext, der mit drei Ziffern beginnt, behält seinen Zweck', () => {
  const r = readMt940(statement(':60F:C250110EUR0,00', ':61:2501100110C100,00NTRFNONREF', ':86:100 EUR Kaution Rate 2 von 3 Whg 12', ':62F:C250110EUR100,00'))
  assert.equal(r.statements[0].entries[0].purpose, '100 EUR Kaution Rate 2 von 3 Whg 12')
})

test('MT942 (untertägig) wird nicht übernommen, sondern gezählt und gemeldet', () => {
  const r = readMt940([':20:X', ':25:DE00123456789012345678', ':34F:EUR0,', ':13D:2501101200+0100', ':61:2501100110C1,00NTRFNONREF', ':86:166?20SVWZ+a'].join('\n'))
  assert.equal(r.statements.length, 0)
  assert.equal(r.pendingSkipped, 1)
  assert.match(r.problems[0].message, /MT942/)
})

test('Fingerabdruck: zwei gleiche Überweisungen am selben Tag haben denselben, der Import zählt deshalb', () => {
  // Gewollt: Der Fingerabdruck ist kein Schlüssel. Zwei Zahlungen bleiben zwei, weil der Import
  // nach Anzahl abgleicht; die Bankreferenzen trennen sie, wo es welche gibt.
  const r = readMt940(statement(':60F:C250110EUR0,00',
    ':61:2501100110C850,00NTRFE1//A1', ':86:166?20EREF+E1?21SVWZ+Miete Januar?31DE00500105170000000001',
    ':61:2501100110C850,00NTRFE2//A2', ':86:166?20EREF+E2?21SVWZ+Miete Januar?31DE00500105170000000001',
    ':62F:C250110EUR1700,00'))
  const [a, b] = r.statements[0].entries
  assert.equal(a.fingerprint, b.fingerprint)
  assert.notEqual(a.bankReference, b.bankReference)
  assert.notEqual(a.endToEndId, b.endToEndId)
})

test('Fingerabdruck: „März“ aus camt und „Maerz“ aus MT940 sind dieselbe Buchung', () => {
  const mt = readMt940(statement(':60F:C250303EUR0,00', ':61:2503030303C850,00NTRFNONREF', ':86:166?20SVWZ+Miete Maerz?31DE00500105170000000001', ':62F:C250303EUR850,00')).statements[0].entries[0]
  const camt = readCamt(`<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt><Id>1</Id>
    <Acct><Id><IBAN>DE00123456789012345678</IBAN></Id></Acct>
    <Ntry><Amt Ccy="EUR">850.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2025-03-03</Dt></BookgDt>
    <NtryDtls><TxDtls><RltdPties><DbtrAcct><Id><IBAN>DE00500105170000000001</IBAN></Id></DbtrAcct></RltdPties>
    <RmtInf><Ustrd>Miete März</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry></Stmt></BkToCstmrStmt></Document>`).statements[0].entries[0]
  assert.equal(mt?.fingerprint, camt?.fingerprint)
})

test('MT940: ohne Buchungstag in :61: gilt die Wertstellung, gekennzeichnet als geschätzt', () => {
  const e = readMt940(statement(':60F:C250301EUR0,00', ':61:250301C1,00NTRFNONREF', ':62F:C250301EUR1,00')).statements[0].entries[0]
  assert.equal(e?.bookingDate, '2025-03-01')
  assert.equal(e?.bookingDateEstimated, true)
})

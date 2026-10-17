// Grenzen beim Lesen hochgeladener Kontoauszüge (#188): ZIP-Archive, Dateigröße und Länge der
// Textfelder. Alle Auszüge hier sind erfunden.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import AdmZip from 'adm-zip'
import { readCamt } from '../src/bank/camt.ts'
import { readMt940 } from '../src/bank/mt940.ts'
import { MAX_FILE_BYTES, MAX_ZIP_ENTRIES, MAX_ZIP_TOTAL_BYTES, readBankFile } from '../src/bank/read.ts'
import { fingerprintOf, TEXT_LIMITS, type BankEntry, type BankReadResult } from '../src/bank/statement.ts'

const ACCOUNT = 'DE00123456789012345678'

function camt053(entries: string[], id = 'S1'): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt><Stmt><Id>${id}</Id><Acct><Id><IBAN>${ACCOUNT}</IBAN></Id></Acct>
    ${entries.join('\n')}
  </Stmt></BkToCstmrStmt>
</Document>`
}

type EntryOptions = { amount?: string, ref?: string, e2e?: string, name?: string, ultimate?: string, purpose?: string[] }

function ntry(o: EntryOptions = {}): string {
  return `<Ntry>
    <Amt Ccy="EUR">${o.amount ?? '850.00'}</Amt>
    <CdtDbtInd>CRDT</CdtDbtInd>
    <Sts>BOOK</Sts>
    <BookgDt><Dt>2025-03-03</Dt></BookgDt>
    ${o.ref ? `<AcctSvcrRef>${o.ref}</AcctSvcrRef>` : ''}
    <NtryDtls><TxDtls>
      ${o.e2e ? `<Refs><EndToEndId>${o.e2e}</EndToEndId></Refs>` : ''}
      <RltdPties>
        <Dbtr><Nm>${o.name ?? 'Erika Beispiel'}</Nm></Dbtr>
        <DbtrAcct><Id><IBAN>DE00500105170000000001</IBAN></Id></DbtrAcct>
        ${o.ultimate ? `<UltmtDbtr><Nm>${o.ultimate}</Nm></UltmtDbtr>` : ''}
      </RltdPties>
      <RmtInf>${(o.purpose ?? ['Miete']).map((p) => `<Ustrd>${p}</Ustrd>`).join('')}</RmtInf>
    </TxDtls></NtryDtls>
  </Ntry>`
}

function onlyEntry(r: BankReadResult): BankEntry {
  const all = r.statements.flatMap((s) => s.entries)
  if (all.length !== 1) assert.fail(`genau ein Umsatz erwartet, gelesen: ${all.length}; Befunde: ${JSON.stringify(r.problems)}`)
  return all[0]
}

// Ein ZIP mit `count` leeren Einträgen, von Hand gebaut (nur gespeichert, ohne Inhalt): adm-zip
// bräuchte dafür selbst Sekunden. `name` liefert den Namen des i-ten Eintrags, `size` die im
// Verzeichnis angegebene Größe.
function handmadeZip(count: number, name: (i: number) => string, size: (i: number) => number = () => 0): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (let i = 0; i < count; i++) {
    const n = Buffer.from(name(i))
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(10, 4)
    local.writeUInt16LE(n.length, 26)
    locals.push(local, n)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(10, 6)
    central.writeUInt32LE(size(i), 20)
    central.writeUInt32LE(size(i), 24)
    central.writeUInt16LE(n.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, n)
    offset += 30 + n.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Math.min(count, 0xffff), 8)
  end.writeUInt16LE(Math.min(count, 0xffff), 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

// ---------- ZIP ----------

// Vorher entpackte adm-zip alle 65.535 Einträge in Objekte (gemessen 4,7 s und 865 MB
// Arbeitsspeicher), bevor gezählt wurde, und gezählt wurden nur die mit passender Endung. Jetzt
// zählt das Verzeichnis am Ende des Archivs, bevor ein Eintrag gelesen wird (gemessen unter 1 ms).
// Die Zeitgrenze ist großzügig, damit der Test auf einem langsamen Runner nicht flackert; der
// alte Weg lag um das Zwanzigfache darüber.
test('Kontoauszug: ein ZIP mit 65.535 leeren Einträgen wird abgelehnt, ohne sie zu entpacken', () => {
  const zip = handmadeZip(65535, (i) => `j${i}.bin`)
  const start = performance.now()
  const r = readBankFile(zip, 'viele.zip')
  const ms = performance.now() - start
  assert.equal(r.statements.length, 0)
  assert.equal(r.problems.length, 1)
  assert.match(r.problems[0].message, /mehr als 1000 Einträge/)
  assert.ok(ms < 250, `Ablehnung dauerte ${ms.toFixed(0)} ms`)
})

test('Kontoauszug: im ZIP zählen alle Einträge, nicht nur die mit passender Endung', () => {
  const zip = new AdmZip()
  zip.addFile('2025-03-03.xml', Buffer.from(camt053([ntry()])))
  for (let i = 0; i < MAX_ZIP_ENTRIES; i++) zip.addFile(`beiwerk/${i}.bin`, Buffer.alloc(0))
  const r = readBankFile(zip.toBuffer(), 'gemischt.zip')
  assert.equal(r.statements.length, 0)
  assert.match(r.problems[0].message, /mehr als 1000 Einträge/)
})

test('Kontoauszug: die Größe aller Einträge zählt, auch die ohne passende Endung', () => {
  // Ein kleiner Auszug und daneben ein großer Eintrag ohne passende Endung, zusammen über der
  // Grenze. Die Größen stehen nur im Verzeichnis; entpackt wird nichts, denn die Ablehnung kommt
  // vorher.
  const zip = handmadeZip(2, (i) => (i === 0 ? 'a.xml' : 'b.bin'), (i) => (i === 0 ? 1000 : MAX_ZIP_TOTAL_BYTES))
  const r = readBankFile(zip, 'gross.zip')
  assert.equal(r.statements.length, 0)
  assert.match(r.problems[0].message, /zu groß/)
})

// adm-zip legt zu jedem Ordner im Namen einen Eintrag an, und zwar mit Aufwand im Quadrat der
// Tiefe: ein Name aus 8.000 Ebenen dauerte gemessen 2,8 s, einer aus 32.000 (die Grenze eines
// Namens) rund 45 s, und davon passen mehr als hundert in eine Datei. Kein Auszug heißt so.
test('Kontoauszug: ein ZIP-Eintrag mit überlangem Namen wird abgelehnt, bevor adm-zip ihn zerlegt', () => {
  const zip = handmadeZip(1, () => `${'a/'.repeat(8000)}x.xml`)
  const start = performance.now()
  const r = readBankFile(zip, 'tief.zip')
  const ms = performance.now() - start
  assert.equal(r.statements.length, 0)
  assert.match(r.problems[0].message, /Namen/)
  assert.ok(ms < 250, `Ablehnung dauerte ${ms.toFixed(0)} ms`)
})

test('Kontoauszug: ein ZIP, dessen Verzeichnis über das Archiv hinausreicht, ergibt einen Befund', () => {
  const zip = handmadeZip(3, (i) => `a${i}.xml`)
  // Das Verzeichnis kündigt 3 Einträge an, die Datei endet nach dem zweiten.
  const cut = Buffer.concat([zip.subarray(0, zip.length - 22 - 52), zip.subarray(zip.length - 22)])
  const r = readBankFile(cut, 'kurz.zip')
  assert.equal(r.statements.length, 0)
  assert.match(r.problems[0].message, /lässt sich nicht öffnen/)
})

// Ein gespeicherter Eintrag (ohne Kompression) ist beim Entpacken so groß wie seine Daten im
// Archiv, gleich welche Größe das Verzeichnis nennt; adm-zip deckelt nur das Entpacken komprimierter
// Einträge auf die genannte Größe. Mehrere Einträge können auf dieselben Daten zeigen. Drei
// Einträge, die je 1 Byte angeben und auf denselben Auszug von 8 MB zeigen, ergaben vorher 24 MB
// gelesenes XML, über der Grenze von 20 MB.
test('Kontoauszug: gespeicherte ZIP-Einträge zählen mit ihrer wirklichen Größe, nicht der angegebenen', () => {
  const content = Buffer.from(camt053([ntry()]).replace('</Document>', `${' '.repeat(8 * 1024 * 1024)}</Document>`))
  const crc = zlib.crc32(content)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(10, 4)
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(content.length, 18)
  local.writeUInt32LE(1, 22)
  local.writeUInt16LE(5, 26)
  const head = Buffer.concat([local, Buffer.from('a.xml'), content])
  const centrals = ['a.xml', 'b.xml', 'c.xml'].map((name) => {
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(10, 6)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(content.length, 20) // komprimiert: die wirklichen Daten
    central.writeUInt32LE(1, 24) // entpackt: angeblich 1 Byte
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(0, 42) // alle drei zeigen auf dieselben Daten
    return Buffer.concat([central, Buffer.from(name)])
  })
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(3, 8)
  end.writeUInt16LE(3, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(head.length, 16)
  const r = readBankFile(Buffer.concat([head, directory, end]), 'gespeichert.zip')
  assert.equal(r.statements.length, 0)
  assert.match(r.problems[0].message, /zu groß/)
})

test('Kontoauszug: ein gewöhnliches ZIP mit Ordnern und Auszügen bleibt lesbar', () => {
  const zip = new AdmZip()
  zip.addFile('2025/', Buffer.alloc(0))
  zip.addFile('2025/03/2025-03-03.xml', Buffer.from(camt053([ntry()])))
  zip.addFile('2025/03/2025-03-04.xml', Buffer.from(camt053([ntry({ amount: '10.00' })], 'S2')))
  const r = readBankFile(zip.toBuffer(), 'auszuege.zip')
  assert.deepEqual(r.problems, [])
  assert.equal(r.statements.length, 2)
})

test('Kontoauszug: die Grenzen passen zueinander', () => {
  // Eine Datei an der Grenze muss auch im ZIP Platz haben, und mehrere Jahre Tagesauszüge eines
  // Kontos (gut 250 Bankarbeitstage im Jahr) müssen in die Zahl der Einträge passen.
  assert.ok(MAX_ZIP_TOTAL_BYTES >= MAX_FILE_BYTES)
  assert.ok(MAX_ZIP_ENTRIES >= 3 * 260)
  assert.equal(MAX_FILE_BYTES, 10 * 1024 * 1024)
})

test('Kontoauszug: eine einzelne Datei über der Grenze wird nicht gelesen', () => {
  const big = Buffer.alloc(MAX_FILE_BYTES + 1, 0x20)
  big.write('<?xml version="1.0"?>', 0)
  const r = readBankFile(big, 'gross.xml')
  assert.equal(r.statements.length, 0)
  assert.match(r.problems[0].message, /zu groß/)
})

// ---------- Länge der Textfelder ----------

test('camt: überlange Textfelder werden gekürzt, der Fingerabdruck bleibt der der ungekürzten Buchung', () => {
  const long = (c: string, n: number) => c.repeat(n)
  // 20 Zeilen Verwendungszweck zu 140 Zeichen ergeben 2.819 Zeichen.
  const lines = Array.from({ length: 20 }, (_, i) => `${i}`.padEnd(140, 'x'))
  const r = readCamt(camt053([ntry({
    ref: long('R', 500), e2e: long('E', 500), name: long('N', 5000), ultimate: long('U', 5000), purpose: lines,
  })], long('S', 5000)))
  const e = onlyEntry(r)
  const full = lines.join(' ')
  assert.equal(e.purpose.length, TEXT_LIMITS.purpose)
  assert.equal(e.purpose, full.slice(0, TEXT_LIMITS.purpose))
  assert.equal(e.counterpartyName?.length, TEXT_LIMITS.name)
  assert.equal(e.ultimatePartyName?.length, TEXT_LIMITS.name)
  assert.equal(e.bankReference?.length, TEXT_LIMITS.reference)
  assert.equal(e.endToEndId?.length, TEXT_LIMITS.reference)
  assert.equal(r.statements[0].statementId?.length, TEXT_LIMITS.reference)
  // Der Fingerabdruck nimmt nur die ersten 100 genormten Zeichen des Zwecks: gekürzt und
  // ungekürzt ergeben denselben.
  const base = { bookingDate: e.bookingDate, amountCents: e.amountCents, counterpartyIban: e.counterpartyIban }
  assert.equal(fingerprintOf({ ...base, purpose: full }), e.fingerprint)
  assert.equal(fingerprintOf({ ...base, purpose: e.purpose }), e.fingerprint)
})

// Gekürzt sähe eine überlange IBAN aus wie eine IBAN, und der spätere Abgleich mit dem Konto eines
// Mieters ginge nach ihr. Länger als 34 Zeichen ist keine IBAN; sie fehlt dann.
test('camt: eine überlange IBAN wird nicht gekürzt, sondern fehlt', () => {
  const long = `DE${'1'.repeat(60)}`
  const xml = camt053([ntry()]).replace('DE00500105170000000001', long).replace(`<IBAN>${ACCOUNT}</IBAN>`, `<IBAN>${long}</IBAN>`)
  const r = readCamt(xml)
  const e = onlyEntry(r)
  assert.equal(e.counterpartyIban, null)
  assert.equal(r.statements[0].accountIban, null)
  // Der Fingerabdruck beschreibt weiter die Buchung, wie sie in der Datei steht.
  assert.equal(e.fingerprint, fingerprintOf({ bookingDate: e.bookingDate, amountCents: e.amountCents, counterpartyIban: long, purpose: e.purpose }))
})

test('camt: ein Zweck, dessen Buchstaben erst hinter der Kürzung beginnen, behält seinen Fingerabdruck', () => {
  // 1.500 Satzzeichen vor dem eigentlichen Zweck: Die Kürzung schneidet den ganzen Text ab, der
  // Fingerabdruck entsteht aber aus der ungekürzten Fassung.
  const full = `${'-'.repeat(1500)} Miete Maerz`
  const e = onlyEntry(readCamt(camt053([ntry({ purpose: [full] })])))
  assert.equal(e.purpose.length, TEXT_LIMITS.purpose)
  assert.equal(e.fingerprint, fingerprintOf({ bookingDate: e.bookingDate, amountCents: e.amountCents, counterpartyIban: e.counterpartyIban, purpose: full }))
})

test('camt: ein überlanger Betrag oder eine überlange Kontokennung steht gekürzt im Befund', () => {
  const huge = '1'.repeat(100000)
  const r = readCamt(camt053([ntry({ amount: `${huge}.001` })]))
  assert.equal(r.problems.length, 1)
  assert.ok(r.problems[0].message.length < 300, `Befund mit ${r.problems[0].message.length} Zeichen`)
  const other = readCamt(`<?xml version="1.0"?><Document><BkToCstmrStmt><Stmt><Id>S1</Id><Acct><Id><Othr><Id>${huge}</Id></Othr></Id></Acct></Stmt></BkToCstmrStmt></Document>`)
  assert.equal(other.statements[0].accountOtherId?.length, TEXT_LIMITS.reference)
  assert.ok(other.problems[0].message.length < 300)
})

test('MT940: überlange Textfelder werden gekürzt, der Fingerabdruck bleibt der der ungekürzten Buchung', () => {
  const purposeParts = Array.from({ length: 14 }, (_, i) => `?${20 + (i < 10 ? i : 40 + i - 10)}${'ABCDEFGHIJKLMNOPQRSTUVWXYZ0'.repeat(10)}`).join('')
  const text = [
    ':20:STARTUMS',
    `:25:${ACCOUNT}`,
    `:28C:${'7'.repeat(500)}`,
    ':60F:C250303EUR0,00',
    `:61:2503030303C850,00N051NONREF//${'B'.repeat(500)}`,
    `:86:166?00GUTSCHRIFT${purposeParts}?31DE00500105170000000001?32${'N'.repeat(3000)}?33${'M'.repeat(3000)}`,
    ':62F:C250303EUR850,00',
    '-',
  ].join('\n')
  const r = readMt940(text, 'lang.sta')
  const e = onlyEntry(r)
  assert.equal(e.purpose.length, TEXT_LIMITS.purpose)
  assert.equal(e.counterpartyName?.length, TEXT_LIMITS.name)
  assert.equal(e.bankReference?.length, TEXT_LIMITS.reference)
  assert.equal(r.statements[0].statementId?.length, TEXT_LIMITS.reference)
  const full = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0'.repeat(140)
  assert.equal(fingerprintOf({ bookingDate: e.bookingDate, amountCents: e.amountCents, counterpartyIban: e.counterpartyIban, purpose: full }), e.fingerprint)
})

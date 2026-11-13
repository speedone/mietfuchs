// Kontoauszug einlesen, planen (#188): je Regel der Spec (docs/superpowers/specs/2026-11-12-kontoauszug-design.md,
// „Import“) ein Test mit ihrer Nummer im Namen, dazu die Invarianten. Die Auszüge sind erfunden und hier als
// Leseergebnis gebaut; den Weg durch den Leser prüft api-kontoauszug.test.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fingerprintOf, type BankEntry, type BankReadResult, type BankStatement } from '../src/bank/statement.ts'
import { coverageOf } from '../src/bank/coverage.ts'
import { importToken, MISSING_DAY_STATEMENT, planBankImport, type ImportDecision, type ImportPlan } from '../src/bank/importPlan.ts'
import type { BankAccount, BankStock } from '../src/bank/model.ts'

const OWN = 'DE89370400440532013000'
const TENANT = 'DE02120300000000202051'
const PAYER = 'DE44500105175407324931'
const STRANGER = 'DE75512108001245126199'

function entry(bookingDate: string, amountCents: number, over: Partial<BankEntry> = {}): BankEntry {
  const base = {
    bookingDate, valueDate: bookingDate, amountCents, counterpartyName: 'Erika Beispiel', counterpartyIban: TENANT,
    ultimatePartyName: null, purpose: `Miete ${bookingDate}`, bankReference: null, endToEndId: null, reversal: false,
    bookingDateEstimated: false, batch: null, ...over,
  }
  return { ...base, fingerprint: over.fingerprint ?? fingerprintOf(base) }
}

function statement(entries: BankEntry[], over: Partial<BankStatement> = {}): BankStatement {
  const sum = entries.reduce((a, e) => a + e.amountCents, 0)
  return {
    format: 'camt.053', statementId: null, accountIban: OWN, accountOtherId: null, createdAt: null, fromWholeDay: true,
    fromDate: entries[0]?.bookingDate ?? null, toDate: entries[entries.length - 1]?.bookingDate ?? null,
    openingBalanceCents: 100000, closingBalanceCents: 100000 + sum, entries, ...over,
  }
}

const read = (...statements: BankStatement[]): BankReadResult => ({ statements, problems: [], pendingSkipped: 0 })

const account = (kind: 'mixed' | 'rental' = 'mixed'): BankAccount =>
  ({ id: 'konto', iban: OWN, otherId: null, label: 'Girokonto', kind, rentalConfirmedAt: kind === 'rental' ? '2025-01-01T00:00:00Z' : null })

const stock = (over: Partial<BankStock> = {}): BankStock => ({
  accounts: [account()], imports: [], days: [], transactions: [], links: [], payers: [],
  tenancyIbans: [{ tenancyId: 't1', iban: TENANT }], ownIbans: [], ...over,
})

function counter(prefix = 'id'): () => string {
  let n = 0
  return () => `${prefix}-${++n}`
}

const plan = (r: BankReadResult, s: BankStock, decisions: ImportDecision[] = [], sha = 'sha-1'): ImportPlan =>
  planBankImport(r, s, decisions, { sha256: sha, name: 'auszug.xml' }, counter(), '2025-07-01T08:00:00Z')

// Den Plan in den Bestand übernehmen, wie db/bank.ts es tut.
function apply(s: BankStock, p: ImportPlan): BankStock {
  const removed = new Set(p.writes.replaced.map((r) => r.removeId))
  return {
    ...s,
    accounts: [...s.accounts, ...p.writes.accounts],
    imports: [...s.imports, ...p.writes.imports],
    days: [...s.days, ...p.writes.days],
    transactions: [...s.transactions.filter((t) => !removed.has(t.id)), ...p.writes.transactions, ...p.writes.replaced.flatMap((r) => r.parts)],
    payers: [...s.payers, ...p.writes.payers],
  }
}

test('1 Auszug mit gescheiterter Saldenprobe wird nicht übernommen, die übrigen der Datei schon', () => {
  const bad = statement([entry('2025-06-02', 85000)], { closingBalanceCents: 1, statementId: 'A' })
  const good = statement([entry('2025-06-03', 85000)], { statementId: 'B' })
  const p = plan(read(bad, good), stock())
  assert.deepEqual(p.writes.days.map((d) => d.date), ['2025-06-03'])
  assert.ok(p.findings.some((f) => f.where.includes('Auszug A') && /nicht übernommen/.test(f.message)))
})

test('2 schon eingelesen: gleiche Prüfsumme am Konto schreibt nichts und nennt das Datum', () => {
  const r = read(statement([entry('2025-06-02', 85000)]))
  const first = plan(r, stock())
  const second = plan(r, apply(stock(), first))
  assert.deepEqual(second.writes, { accounts: [], imports: [], days: [], transactions: [], replaced: [], payers: [] })
  assert.equal(second.sentence, 'Dieser Auszug wurde am 01.07.2025 schon eingelesen.')
})

test('3 unbekanntes Konto ist eine Rückfrage; ja legt ein Mischkonto an, nein übernimmt nichts', () => {
  const r = read(statement([entry('2025-06-02', 85000)]))
  const open = plan(r, stock({ accounts: [] }))
  assert.equal(open.ready, false)
  assert.deepEqual(open.questions, [{ type: 'account', iban: OWN, otherId: null }])
  assert.equal(open.writes.days.length, 0)
  const yes = plan(r, stock({ accounts: [] }), [{ type: 'account', iban: OWN, accept: true }])
  assert.equal(yes.ready, true)
  assert.equal(yes.writes.accounts[0]?.kind, 'mixed')
  assert.equal(yes.writes.transactions.length, 1)
  const no = plan(r, stock({ accounts: [] }), [{ type: 'account', iban: OWN, accept: false }])
  assert.deepEqual(no.writes, { accounts: [], imports: [], days: [], transactions: [], replaced: [], payers: [] })
})

test('3 Datei mit zwei Konten: das bekannte wird übernommen, vom abgelehnten nichts', () => {
  const other = 'DE12500105170648489890'
  const r = read(statement([entry('2025-06-02', 85000)]), statement([entry('2025-06-02', 85000)], { accountIban: other }))
  const p = plan(r, stock(), [{ type: 'account', iban: other, accept: false }])
  assert.equal(p.ready, true)
  assert.deepEqual(p.writes.days.map((d) => d.accountId), ['konto'])
})

test('4 camt.052: Umsätze ab dem Tag der Erstellung kommen mit dem Tagesauszug; ohne Erstellung alle', () => {
  const entries = [entry('2025-06-02', 85000), entry('2025-06-03', 70000, { counterpartyIban: PAYER })]
  const r = read(statement(entries, { format: 'camt.052', createdAt: '2025-06-03T10:00:00+02:00' }))
  const p = plan(r, stock({ payers: [{ id: 'z', tenancyId: 't1', iban: PAYER, name: null }] }))
  assert.equal(p.summary.pending, 1)
  assert.deepEqual(p.writes.days.map((d) => d.date), ['2025-06-02'])
  assert.equal(p.writes.imports[0]?.toDate, '2025-06-02')
  assert.equal(p.writes.imports[0]?.openingBalanceCents, null)
  const none = plan(read(statement(entries, { format: 'camt.052', createdAt: null })), stock())
  assert.equal(none.summary.pending, 2)
  assert.equal(none.writes.days.length, 0)
  assert.equal(none.writes.imports.length, 0)
})

test('5 camt.054 zerlegt eine gespeicherte Sammelbuchung; zugeordnet bleibt sie, ohne Tagesauszug ein Befund; nie ein Tag', () => {
  const sum = entry('2025-06-02', 240000, { counterpartyIban: null, counterpartyName: null, purpose: '', bankReference: 'SAMMEL-1' })
  const day = plan(read(statement([sum])), stock({ accounts: [account('rental')] }))
  const base = apply(stock({ accounts: [account('rental')] }), day)
  const stored = base.transactions[0]
  assert.ok(stored)
  const batch = { reference: 'SAMMEL-1', totalCents: 240000, parts: 3 }
  const parts = [85000, 85000, 70000].map((c, i) => entry('2025-06-02', c, { batch: { ...batch, part: i + 1 }, purpose: `Miete ${i}` }))
  const breakdown = read(statement(parts, { format: 'camt.054', openingBalanceCents: null, closingBalanceCents: null }))
  const p = plan(breakdown, base)
  assert.equal(p.writes.replaced.length, 1)
  assert.equal(p.writes.replaced[0]?.removeId, stored.id)
  assert.equal(p.writes.replaced[0]?.parts.reduce((a, t) => a + t.amountCents, 0), 240000)
  assert.equal(p.writes.replaced[0]?.parts[0]?.importId, stored.importId)
  assert.equal(p.writes.days.length, 0)
  assert.equal(p.writes.imports.length, 0)
  const linked = plan(breakdown, { ...base, links: [{ id: 'l', transactionId: stored.id, paymentId: 'p', depositEntryId: null, created: true }] })
  assert.equal(linked.writes.replaced.length, 0)
  assert.ok(linked.findings.some((f) => /schon zugeordnet/.test(f.message)))
  const missing = plan(breakdown, stock())
  assert.equal(missing.writes.replaced.length, 0)
  assert.ok(missing.findings.some((f) => f.message === MISSING_DAY_STATEMENT))
  const twice = plan(breakdown, apply(base, p))
  assert.equal(twice.writes.replaced.length, 0)
})

test('6 Tagesabgleich: bekannt und gleich wird übersprungen, bekannt und abweichend ist ein Befund ohne Schreiben', () => {
  const june = [entry('2025-06-02', 85000), entry('2025-06-03', 85000)]
  const base = apply(stock(), plan(read(statement(june)), stock()))
  const same = plan(read(statement(june)), base, [], 'sha-2')
  assert.equal(same.summary.knownDays, 2)
  assert.equal(same.writes.days.length, 0)
  assert.equal(same.writes.imports.length, 0)
  const differing = plan(read(statement([...june, entry('2025-06-03', 100, { counterpartyIban: STRANGER })])), base, [], 'sha-3')
  assert.equal(differing.writes.transactions.length, 0)
  assert.ok(differing.findings.some((f) => f.message === 'Der 03.06.2025 sieht in dieser Datei anders aus (2 Umsätze statt 1). Übernommen ist der frühere Stand; nehmen Sie den früheren Import im Verlauf zurück, wenn dieser Auszug gelten soll.'))
})

test('7 Mischkonto: Mieter und Zahler gespeichert, Privates nur in der Tagessumme, Unbekanntes ist eine Rückfrage', () => {
  const entries = [
    entry('2025-06-02', 85000),
    entry('2025-06-02', 30000, { counterpartyIban: PAYER }),
    entry('2025-06-02', -85000, { reversal: true }),
    entry('2025-06-02', -12000), // Guthaben an den Mieter
    entry('2025-06-02', -4999, { counterpartyIban: STRANGER, counterpartyName: 'Supermarkt', purpose: 'Einkauf' }),
    entry('2025-06-02', 50000, { counterpartyIban: STRANGER, counterpartyName: 'Neues Konto', purpose: 'Miete Juni' }),
  ]
  const s = stock({ payers: [{ id: 'z', tenancyId: 't1', iban: PAYER, name: 'Jobcenter' }] })
  const open = plan(read(statement(entries)), s)
  assert.equal(open.ready, false)
  assert.deepEqual(open.questions, [{ type: 'entry', key: '0:2025-06-02:6', bookingDate: '2025-06-02', amountCents: 50000, counterpartyName: 'Neues Konto', counterpartyIban: STRANGER, purpose: 'Miete Juni' }])
  assert.equal(open.writes.days.length, 0, 'ein Tag mit offener Rückfrage wird nicht geschrieben')
  const rent = plan(read(statement(entries)), s, [{ type: 'entry', key: '0:2025-06-02:6', as: 'rent', tenancyId: 't1', rememberPayer: true }])
  assert.deepEqual(rent.writes.transactions.map((t) => t.amountCents), [85000, 30000, -85000, -12000, 50000])
  assert.deepEqual(rent.writes.payers.map((p) => [p.tenancyId, p.iban, p.name]), [['t1', STRANGER, 'Neues Konto']])
  assert.deepEqual(rent.writes.days, [{ accountId: 'konto', date: '2025-06-02', importId: rent.writes.imports[0]?.id, entryCount: 6, creditCents: 165000, debitCents: 101999 }])
  const priv = plan(read(statement(entries)), s, [{ type: 'entry', key: '0:2025-06-02:6', as: 'private' }])
  assert.deepEqual(priv.writes.transactions.map((t) => t.amountCents), [85000, 30000, -85000, -12000])
  assert.equal(priv.writes.payers.length, 0)
  assert.equal(priv.writes.days[0]?.creditCents, 165000)
  assert.ok(!JSON.stringify(priv.writes).includes('Supermarkt'))
  assert.ok(!JSON.stringify(priv.writes).includes(STRANGER))
})

test('7 Mischkonto: eine Umbuchung vom eigenen Konto ist privat und keine Rückfrage', () => {
  const p = plan(read(statement([entry('2025-06-02', 100000, { counterpartyIban: 'DE12500105170648489890' })])), stock({ ownIbans: ['DE12500105170648489890'] }))
  assert.equal(p.ready, true)
  assert.equal(p.writes.transactions.length, 0)
  assert.equal(p.writes.days[0]?.creditCents, 100000)
})

test('7 Mietkonto speichert jeden Umsatz, eine Umbuchung vom eigenen Konto beiseitegelegt', () => {
  const entries = [entry('2025-06-02', 85000), entry('2025-06-02', -4999, { counterpartyIban: STRANGER }), entry('2025-06-02', 50000, { counterpartyIban: 'DE12500105170648489890' })]
  const p = plan(read(statement(entries)), stock({ accounts: [account('rental')], ownIbans: ['DE12500105170648489890'] }))
  assert.equal(p.ready, true)
  assert.deepEqual(p.writes.transactions.map((t) => [t.amountCents, t.setAside]), [[85000, null], [-4999, null], [50000, 'transfer']])
})

test('zwei gleiche Überweisungen am selben Tag bleiben zwei, ein zweites Einlesen legt keine dritte an', () => {
  const twin = entry('2025-06-02', 85000)
  const r = read(statement([twin, twin]))
  const first = plan(r, stock())
  assert.equal(first.writes.transactions.length, 2)
  const again = plan(r, apply(stock(), first), [], 'sha-anders')
  assert.equal(again.writes.transactions.length, 0)
  assert.equal(again.summary.knownDays, 1)
})

test('Satz zum Ergebnis, Einzahl richtig', () => {
  const entries = [entry('2025-06-02', 85000), entry('2025-06-03', 85000)]
  const base = apply(stock(), plan(read(statement([entries[0] as BankEntry])), stock()))
  const p = plan(read(statement(entries, { format: 'camt.052', createdAt: '2025-06-03T09:00:00Z', fromDate: null, toDate: null })), base, [], 'sha-2')
  assert.equal(p.sentence, '0 Umsätze übernommen, 1 Tag schon eingelesen, 1 Umsatz kommt mit dem Tagesauszug.')
  const many = Array.from({ length: 12 }, (_, i) => entry(`2025-06-${String(i + 10).padStart(2, '0')}`, 85000))
  const known = [entry('2025-05-02', 1), entry('2025-05-03', 1), entry('2025-05-05', 1)]
  const withKnown = apply(stock(), plan(read(statement(known)), stock(), [], 'sha-mai'))
  const later = [entry('2025-06-30', 1), entry('2025-06-30', 2)]
  const all = plan(read(statement([...known, ...many]), statement(later, { format: 'camt.052', createdAt: '2025-06-30T09:00:00Z' })), withKnown, [], 'sha-juni')
  assert.equal(all.sentence, '12 Umsätze übernommen, 3 Tage schon eingelesen, 2 Umsätze kommen mit dem Tagesauszug.')
})

test('Marke: gleich bei gleichem Bestand und gleichen Antworten trotz anderer Kennungen, anders nach geänderter Mieter-IBAN', () => {
  const r = read(statement([entry('2025-06-02', 85000), entry('2025-06-03', 50000, { counterpartyIban: STRANGER })]))
  const d: ImportDecision[] = [{ type: 'entry', key: '0:2025-06-03:1', as: 'rent', tenancyId: 't1' }]
  const a = planBankImport(r, stock(), d, { sha256: 's', name: 'a.xml' }, counter('a'), '2025-07-01T08:00:00Z')
  const b = planBankImport(r, stock(), d, { sha256: 's', name: 'a.xml' }, counter('b'), '2025-07-02T09:00:00Z')
  assert.equal(importToken(a, d), importToken(b, d))
  const changed = planBankImport(r, stock({ tenancyIbans: [{ tenancyId: 't1', iban: STRANGER }] }), d, { sha256: 's', name: 'a.xml' }, counter('a'), '2025-07-01T08:00:00Z')
  assert.notEqual(importToken(changed, d), importToken(a, d))
})

// Fester Zufall (mulberry32), damit ein Fehlschlag sich wiederholen lässt.
function random(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ (t + t)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

test('Invariante: Einlesen in jeder Reihenfolge, auch doppelt und überlappend, ergibt denselben Bestand', () => {
  const rnd = random(188)
  const ibans = [TENANT, PAYER, STRANGER]
  // Sechs Monatsauszüge, jeder überlappt den nächsten um eine Woche.
  const all: BankEntry[] = []
  for (let day = 0; day < 200; day++) {
    const date = new Date(Date.UTC(2025, 0, 1 + day)).toISOString().slice(0, 10)
    const n = Math.floor(rnd() * 3)
    for (let k = 0; k < n; k++) {
      const amount = (rnd() < 0.7 ? 1 : -1) * (1 + Math.floor(rnd() * 100000))
      // Eingänge von Unbekannt wären Rückfragen; private Ausgänge gehen nur in die Tagessumme.
      const from = amount > 0 ? ibans.slice(0, 2) : ibans
      all.push(entry(date, amount, { counterpartyIban: from[Math.floor(rnd() * from.length)] ?? null, purpose: `Zweck ${Math.floor(rnd() * 3)}` }))
    }
  }
  // Ein doppelter Umsatz am selben Tag gehört dazu.
  all.push(all[3] as BankEntry)
  all.sort((x, y) => (x.bookingDate < y.bookingDate ? -1 : x.bookingDate > y.bookingDate ? 1 : 0))
  const statements = Array.from({ length: 6 }, (_, m) => {
    const from = new Date(Date.UTC(2025, m, 1)).toISOString().slice(0, 10)
    const to = new Date(Date.UTC(2025, m + 1, 7)).toISOString().slice(0, 10)
    return statement(all.filter((e) => e.bookingDate >= from && e.bookingDate <= to), { fromDate: from, toDate: to, openingBalanceCents: null, closingBalanceCents: null })
  })
  const payers = [{ id: 'z', tenancyId: 't1', iban: PAYER, name: null }]
  const shape = (s: BankStock): string => JSON.stringify({
    days: s.days.map((d) => [d.date, d.entryCount, d.creditCents, d.debitCents]).sort(),
    transactions: s.transactions.map((t) => [t.bookingDate, t.amountCents, t.counterpartyIban, t.purpose]).sort(),
  })
  let expected: string | null = null
  for (let round = 0; round < 50; round++) {
    const order = statements.map((s, i) => ({ s, i, k: rnd() })).sort((a, b) => a.k - b.k)
    if (round % 5 === 0) order.push(...order.slice(0, 2))
    let s = stock({ payers })
    for (const { s: st, i } of order) {
      const p = plan(read(st), s, [], `sha-${i}`)
      assert.equal(p.ready, true)
      // Invariante (c): auf dem Mischkonto steht nichts, dessen Gegenseite weder Mieter noch Zahler ist.
      for (const t of p.writes.transactions) assert.ok(t.counterpartyIban === TENANT || t.counterpartyIban === PAYER, `privat gespeichert: ${t.counterpartyIban}`)
      s = apply(s, p)
    }
    const got = shape(s)
    if (expected === null) expected = got
    assert.equal(got, expected, `Runde ${round}`)
  }
})

// ---------- Befunde der Durchsicht (PR 1) ----------

test('Durchsicht W1: März, dann Februar bis März ergibt dieselbe Lückenlosigkeit wie umgekehrt', () => {
  const feb = entry('2025-02-10', 85000)
  const mar = entry('2025-03-10', 85000)
  const febMar = statement([feb, mar], { fromDate: '2025-02-01', toDate: '2025-03-31', openingBalanceCents: 100000, closingBalanceCents: 270000 })
  const marOnly = statement([mar], { fromDate: '2025-03-01', toDate: '2025-03-31', openingBalanceCents: 185000, closingBalanceCents: 270000 })
  const inOrder = apply(apply(stock(), plan(read(febMar), stock(), [], 'a')), plan(read(marOnly), apply(stock(), plan(read(febMar), stock(), [], 'a')), [], 'b'))
  const first = apply(stock(), plan(read(marOnly), stock(), [], 'b'))
  const reverse = apply(first, plan(read(febMar), first, [], 'a'))
  assert.deepEqual(coverageOf(reverse.imports), { from: '2025-02-01', to: '2025-03-31' })
  assert.deepEqual(coverageOf(reverse.imports), coverageOf(inOrder.imports))
})

test('Durchsicht W2: derselbe Tag auf zwei Seiten einer Datei wird ein Tag mit allen Umsätzen; ein exaktes Doppel zählt einmal', () => {
  const a = entry('2025-03-10', 1000)
  const b = entry('2025-03-10', 500, { purpose: 'Rest' })
  const page1 = statement([a], { statementId: 'S/1', fromDate: '2025-03-10', toDate: '2025-03-10', openingBalanceCents: 0, closingBalanceCents: 1000 })
  const page2 = statement([b], { statementId: 'S/2', fromDate: '2025-03-10', toDate: '2025-03-10', openingBalanceCents: 1000, closingBalanceCents: 1500 })
  const p = plan(read(page1, page2), stock())
  assert.deepEqual(p.writes.days.map((d) => [d.date, d.entryCount, d.creditCents]), [['2025-03-10', 2, 1500]])
  assert.deepEqual(p.writes.transactions.map((t) => t.amountCents).sort(), [1000, 500].sort())
  assert.ok(!p.findings.some((f) => /anders aus/.test(f.message)))
  const twice = plan(read(page1, page1), stock())
  assert.deepEqual(twice.writes.days.map((d) => [d.entryCount, d.creditCents]), [[1, 1000]])
  assert.equal(twice.writes.transactions.length, 1)
})

test('Durchsicht W3: zwei Aufschlüsselungen mit gleicher Referenz und gleichem Betrag ersetzen nur die des Buchungstags', () => {
  const s0 = stock({ accounts: [account('rental')] })
  const sum = entry('2025-03-10', 3000, { counterpartyIban: null, counterpartyName: null, purpose: '', bankReference: 'R' })
  const base = apply(s0, plan(read(statement([sum])), s0))
  const parts = (date: string) => [1000, 2000].map((c, i) => entry(date, c, { batch: { reference: 'R', totalCents: 3000, part: i + 1, parts: 2 }, purpose: `P${i}` }))
  const p = plan(read(statement([...parts('2025-03-10'), ...parts('2025-04-10')], { format: 'camt.054', openingBalanceCents: null, closingBalanceCents: null })), base)
  assert.equal(p.writes.replaced.length, 1)
  assert.deepEqual(p.writes.replaced[0]?.parts.map((t) => [t.bookingDate, t.amountCents]), [['2025-03-10', 1000], ['2025-03-10', 2000]])
  assert.ok(p.findings.some((f) => f.message === MISSING_DAY_STATEMENT))
  // Unvollständig (ein Posten fehlt): nicht ersetzt.
  const partial = plan(read(statement([parts('2025-03-10')[0] as BankEntry], { format: 'camt.054', openingBalanceCents: null, closingBalanceCents: null })), base)
  assert.equal(partial.writes.replaced.length, 0)
})

test('Durchsicht W4: auf dem Mischkonto zerlegt eine Aufschlüsselung mit privatem Posten nichts', () => {
  const sum = entry('2025-03-10', 3000, { counterpartyIban: null, counterpartyName: null, purpose: '', bankReference: 'R' })
  const first = plan(read(statement([sum])), stock(), [{ type: 'entry', key: '0:2025-03-10:1', as: 'rent', tenancyId: 't1' }])
  const base = apply(stock(), first)
  assert.equal(base.transactions.length, 1)
  const batch = { reference: 'R', totalCents: 3000, parts: 2 }
  const mixedParts = [entry('2025-03-10', 1000, { batch: { ...batch, part: 1 } }), entry('2025-03-10', 2000, { batch: { ...batch, part: 2 }, counterpartyIban: STRANGER, counterpartyName: 'Privat Person' })]
  const p = plan(read(statement(mixedParts, { format: 'camt.054', openingBalanceCents: null, closingBalanceCents: null })), base)
  assert.equal(p.writes.replaced.length, 0)
  assert.ok(!JSON.stringify(p.writes).includes('Privat Person'))
  assert.ok(p.findings.some((f) => /nicht zur Vermietung/.test(f.message)))
  const tenantParts = [entry('2025-03-10', 1000, { batch: { ...batch, part: 1 } }), entry('2025-03-10', 2000, { batch: { ...batch, part: 2 }, counterpartyIban: PAYER })]
  const ok = plan(read(statement(tenantParts, { format: 'camt.054', openingBalanceCents: null, closingBalanceCents: null })), { ...base, payers: [{ id: 'z', tenancyId: 't1', iban: PAYER, name: null }] })
  assert.equal(ok.writes.replaced.length, 1)
})

test('Durchsicht W5: camt.052, der mitten am Tag beginnt, schreibt seinen ersten Tag nicht fest', () => {
  const entries = [entry('2025-06-02', 85000), entry('2025-06-03', 70000), entry('2025-06-04', 1000)]
  const r = read(statement(entries, { format: 'camt.052', createdAt: '2025-06-04T08:00:00+02:00', fromWholeDay: false, fromDate: '2025-06-02' }))
  const p = plan(r, stock())
  assert.deepEqual(p.writes.days.map((d) => d.date), ['2025-06-03'])
  assert.equal(p.summary.pending, 2)
  assert.equal(p.writes.imports[0]?.fromDate, '2025-06-03')
})

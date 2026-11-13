// Kontoauszug in der Datenbank (#188): die sechs Tabellen mit ihren Bedingungen und ihrem Löschverhalten.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyMigrations, connect, loadMigrations } from '../src/db/client.ts'
import { openFreshDatabase } from '../testing/freshDatabase.ts'
import { readBankStock } from '../src/db/bank.ts'

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-kontoauszug-'))

async function withRaw(work: (c: Awaited<ReturnType<typeof connect>>) => void): Promise<void> {
  const dir = tempDir()
  try {
    const c = await connect(path.join(dir, 'db.sqlite'))
    applyMigrations(c, await loadMigrations())
    c.exec(`INSERT INTO units (id, property_id, name, area_m2, participates) VALUES ('u', 'objekt-1', 'EG', 50, 1)`)
    c.exec(`INSERT INTO tenancies (id, unit_id, tenant_name, persons, start, iban) VALUES ('t', 'u', 'Mieter', 1, '2025-01-01', 'DE02120300000000202051')`)
    c.exec(`INSERT INTO payments (id, tenancy_id, date, amount_cents) VALUES ('p', 't', '2025-06-02', 85000)`)
    c.exec(`INSERT INTO deposit_entries (id, tenancy_id, date, kind, amount_cents) VALUES ('d', 't', '2025-01-05', 'received', 240000)`)
    c.exec(`INSERT INTO bank_accounts (id, iban, label, kind) VALUES ('a', 'DE89370400440532013000', 'Girokonto', 'mixed')`)
    c.exec(`INSERT INTO bank_imports (id, account_id, file_sha256, file_name, format, from_date, to_date, imported_at, fingerprint_version)
            VALUES ('i', 'a', 'abc', 'auszug.xml', 'camt.053', '2025-06-01', '2025-06-30', '2025-07-01T08:00:00Z', 1)`)
    c.exec(`INSERT INTO bank_days (account_id, date, import_id, entry_count, credit_cents, debit_cents) VALUES ('a', '2025-06-02', 'i', 2, 85000, 1200)`)
    c.exec(transaction('x1', 85000))
    work(c)
    c.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

const transaction = (id: string, amount: number, extra = ''): string =>
  `INSERT INTO bank_transactions (id, account_id, import_id, booking_date, amount_cents, purpose, reversal, fingerprint${extra ? ', set_aside' : ''})
   VALUES ('${id}', 'a', 'i', '2025-06-02', ${amount}, 'Miete Juni', 0, 'f-${id}'${extra ? `, ${extra}` : ''})`

const count = (c: Awaited<ReturnType<typeof connect>>, table: string): number => Number(c.rows(`SELECT count(*) FROM ${table}`)[0]?.[0])

test('Kontoauszug: Bedingungen der Tabellen', async () => {
  await withRaw((c) => {
    assert.throws(() => c.exec(transaction('x0', 0)), /bank_transactions_amount_valid/)
    assert.throws(() => c.exec(transaction('x9', 100, `'foo'`)), /bank_transactions_set_aside_known/)
    c.exec(transaction('x2', -1200, `'transfer'`))
    assert.throws(() => c.exec(`INSERT INTO bank_accounts (id, iban, label, kind) VALUES ('b', 'DE1', 'B', 'rental')`), /bank_accounts_rental_valid/)
    assert.throws(() => c.exec(`INSERT INTO bank_accounts (id, label, kind) VALUES ('b', 'B', 'mixed')`), /bank_accounts_identity_complete/)
    assert.throws(() => c.exec(`INSERT INTO bank_accounts (id, iban, label, kind) VALUES ('b', 'DE1', 'B', 'private')`), /bank_accounts_kind_known/)
    assert.throws(() => c.exec(`INSERT INTO bank_accounts (id, iban, label, kind) VALUES ('b', 'DE89370400440532013000', 'B', 'mixed')`), /UNIQUE/)
    c.exec(`INSERT INTO bank_accounts (id, iban, label, kind, rental_confirmed_at) VALUES ('b', 'DE1', 'B', 'rental', '2025-07-01T08:00:00Z')`)
    assert.throws(() => c.exec(`INSERT INTO bank_days (account_id, date, import_id, entry_count, credit_cents, debit_cents) VALUES ('a', '2025-06-02', 'i', 1, 1, 0)`), /UNIQUE|PRIMARY/)
    assert.throws(() => c.exec(`INSERT INTO bank_days (account_id, date, import_id, entry_count, credit_cents, debit_cents) VALUES ('a', '2025-06-03', 'i', 1, -1, 0)`), /bank_days_credit_not_negative/)
    assert.throws(() => c.exec(`INSERT INTO bank_days (account_id, date, import_id, entry_count, credit_cents, debit_cents) VALUES ('a', '2025-06-03', 'i', 1, 0, -1)`), /bank_days_debit_not_negative/)
    assert.throws(() => c.exec(`INSERT INTO bank_imports (id, account_id, file_sha256, file_name, format, from_date, to_date, imported_at, fingerprint_version)
            VALUES ('i2', 'a', 'abc', 'auszug.xml', 'camt.053', '2025-06-01', '2025-06-30', '2025-07-01T08:00:00Z', 1)`), /UNIQUE/)
    assert.throws(() => c.exec(`INSERT INTO bank_imports (id, account_id, file_sha256, file_name, format, from_date, to_date, imported_at, fingerprint_version)
            VALUES ('i3', 'a', 'abd', 'auszug.xml', 'csv', '2025-06-01', '2025-06-30', '2025-07-01T08:00:00Z', 1)`), /bank_imports_format_known/)
    // Ein Link hat genau ein Ziel.
    assert.throws(() => c.exec(`INSERT INTO bank_transaction_links (id, transaction_id, created) VALUES ('l0', 'x1', 1)`), /bank_transaction_links_target_valid/)
    assert.throws(() => c.exec(`INSERT INTO bank_transaction_links (id, transaction_id, payment_id, deposit_entry_id, created) VALUES ('l0', 'x1', 'p', 'd', 1)`), /bank_transaction_links_target_valid/)
    c.exec(`INSERT INTO bank_transaction_links (id, transaction_id, payment_id, created) VALUES ('l1', 'x1', 'p', 1)`)
    assert.throws(() => c.exec(`INSERT INTO bank_transaction_links (id, transaction_id, payment_id, created) VALUES ('l2', 'x2', 'p', 0)`), /UNIQUE/)
    c.exec(`INSERT INTO bank_transaction_links (id, transaction_id, deposit_entry_id, created) VALUES ('l3', 'x2', 'd', 0)`)
    assert.throws(() => c.exec(`INSERT INTO bank_transaction_links (id, transaction_id, deposit_entry_id, created) VALUES ('l4', 'x1', 'd', 0)`), /UNIQUE/)
    // Der Link trägt keinen Betrag: Der zugeordnete Betrag ist der seines Ziels.
    const columns = c.rows(`SELECT name FROM pragma_table_info('bank_transaction_links')`).map((r) => String(r[0]))
    assert.deepEqual(columns.sort(), ['created', 'deposit_entry_id', 'id', 'payment_id', 'transaction_id'])
    c.exec(`INSERT INTO tenancy_payers (id, tenancy_id, iban, name) VALUES ('z1', 't', 'DE44500105175407324931', 'Jobcenter')`)
    assert.throws(() => c.exec(`INSERT INTO tenancy_payers (id, tenancy_id, iban, name) VALUES ('z2', 't', 'DE44500105175407324931', 'Jobcenter')`), /UNIQUE/)
  })
})

test('Kontoauszug: Löschen des Kontos nimmt alles vom Konto mit, nie die Zahlung', async () => {
  await withRaw((c) => {
    c.exec(`INSERT INTO bank_transaction_links (id, transaction_id, payment_id, created) VALUES ('l1', 'x1', 'p', 1)`)
    c.exec(`DELETE FROM bank_accounts WHERE id = 'a'`)
    for (const table of ['bank_imports', 'bank_days', 'bank_transactions', 'bank_transaction_links']) assert.equal(count(c, table), 0, table)
    assert.equal(count(c, 'payments'), 1)
  })
})

test('Kontoauszug: mit der Zahlung fällt der Link, mit dem Mietverhältnis die Zahler, mit dem Import Tage und Umsätze', async () => {
  await withRaw((c) => {
    c.exec(`INSERT INTO bank_transaction_links (id, transaction_id, payment_id, created) VALUES ('l1', 'x1', 'p', 1)`)
    c.exec(`INSERT INTO tenancy_payers (id, tenancy_id, iban, name) VALUES ('z1', 't', 'DE44500105175407324931', NULL)`)
    c.exec(`DELETE FROM payments WHERE id = 'p'`)
    assert.equal(count(c, 'bank_transaction_links'), 0)
    assert.equal(count(c, 'bank_transactions'), 1, 'der Umsatz bleibt und ist wieder offen')
    c.exec(`DELETE FROM tenancies WHERE id = 't'`)
    assert.equal(count(c, 'tenancy_payers'), 0)
    c.exec(`DELETE FROM bank_imports WHERE id = 'i'`)
    assert.equal(count(c, 'bank_days'), 0)
    assert.equal(count(c, 'bank_transactions'), 0)
    assert.equal(count(c, 'bank_accounts'), 1)
  })
})

test('Kontoauszug: readBankStock liest einen leeren Bestand', async () => {
  const dir = tempDir()
  const opened = await openFreshDatabase(dir)
  try {
    await opened.write(async (db) => {
      assert.deepEqual(await readBankStock(db), { accounts: [], imports: [], days: [], transactions: [], links: [], payers: [], tenancyIbans: [], ownIbans: [] })
    })
  } finally {
    opened.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

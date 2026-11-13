// Kontoauszug in der Datenbank (#188): den Bestand lesen, gegen den bank/import { sql } from 'drizzle-orm'
import type { Executor } from './client.ts'
import {
  bankAccounts, bankDays, bankImports, bankTransactionLinks, bankTransactions, properties, settings, tenancies, tenancyPayers,
} from './schema.ts'
import { normalizeIban } from '../bank/statement.ts'
import type { BankStock } from '../bank/model.ts'

const INSERTION_ORDER = sql`rowid`

const ibanSet = (values: readonly (string | null)[]): string[] =>
  [...new Set(values.filter((v): v is string => v !== null && v.trim() !== '').map(normalizeIban))]

export async function readBankStock(db: Executor): Promise<BankStock> {
  const [accounts, imports, days, transactions, links, payers, tenancyRows, settingRows, propertyRows] = await Promise.all([
    db.select().from(bankAccounts).orderBy(INSERTION_ORDER),
    db.select().from(bankImports).orderBy(INSERTION_ORDER),
    db.select().from(bankDays).orderBy(bankDays.accountId, bankDays.date),
    db.select().from(bankTransactions).orderBy(INSERTION_ORDER),
    db.select().from(bankTransactionLinks).orderBy(INSERTION_ORDER),
    db.select().from(tenancyPayers).orderBy(INSERTION_ORDER),
    db.select({ id: tenancies.id, iban: tenancies.iban }).from(tenancies).orderBy(INSERTION_ORDER),
    db.select({ iban: settings.iban }).from(settings),
    db.select({ iban: properties.iban }).from(properties),
  ])
  return {
    accounts,
    imports,
    days,
    transactions,
    links,
    payers: payers.map((p) => ({ ...p, iban: normalizeIban(p.iban) })),
    tenancyIbans: tenancyRows.flatMap((t) => (t.iban && t.iban.trim() !== '' ? [{ tenancyId: t.id, iban: normalizeIban(t.iban) }] : [])),
    ownIbans: ibanSet([...settingRows.map((s) => s.iban), ...propertyRows.map((p) => p.iban)]),
  }
}

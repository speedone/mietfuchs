// Kontoauszug in der Datenbank (#188): den Bestand lesen, gegen den bank/importPlan.ts plant, und den Plan schreiben.

import { eq, inArray, sql } from 'drizzle-orm'
import type { Database, Executor } from './client.ts'
import {
  bankAccounts, bankDays, bankImports, bankTransactionLinks, bankTransactions, properties, settings, tenancies, tenancyPayers,
} from './schema.ts'
import { normalizeIban } from '../bank/statement.ts'
import { coverageOf, type Coverage } from '../bank/coverage.ts'
import type { BankAccount, BankImport, BankStock } from '../bank/model.ts'
import type { ImportWrite } from '../bank/importPlan.ts'

export class BankError extends Error {
  status: 400 | 404 | 409
  constructor(status: 400 | 404 | 409, message: string) {
    super(message)
    this.status = status
  }
}

export const RENTAL_CONFIRM_TEXT = 'Ab jetzt wird jeder Umsatz dieses Kontos einzeln gespeichert, auch ein privater.'
export const IMPORT_LINKED_TEXT = 'Zu diesem Auszug sind schon Zahlungen gebucht. Lösen Sie zuerst die Zuordnungen.'

// SQLite nimmt höchstens 32.766 Werte je Anweisung; ein Umsatz hat 19 Spalten.
const CHUNK = 500
async function insertChunked<T>(rows: readonly T[], insert: (part: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) await insert(rows.slice(i, i + CHUNK))
}

// Schreibt einen geplanten Import (bank/importPlan.ts) in einer Transaktion. Geprüft hat der Plan; hier wird nur
// geschrieben, in der Reihenfolge der Fremdschlüssel.
export async function applyBankImport(db: Database, writes: ImportWrite): Promise<void> {
  await db.transaction(async (tx) => {
    await insertChunked(writes.accounts, (rows) => tx.insert(bankAccounts).values(rows))
    await insertChunked(writes.imports, (rows) => tx.insert(bankImports).values(rows))
    await insertChunked(writes.days, (rows) => tx.insert(bankDays).values(rows))
    await insertChunked(writes.transactions, (rows) => tx.insert(bankTransactions).values(rows))
    for (const r of writes.replaced) {
      await tx.delete(bankTransactions).where(eq(bankTransactions.id, r.removeId))
      await insertChunked(r.parts, (rows) => tx.insert(bankTransactions).values(rows))
    }
    await insertChunked(writes.payers, (rows) => tx.insert(tenancyPayers).values(rows))
  })
}

export type BankAccountView = BankAccount & { coverage: Coverage | null; imports: BankImport[] }

export async function readBankAccounts(db: Executor): Promise<BankAccountView[]> {
  const [accounts, imports] = await Promise.all([
    db.select().from(bankAccounts).orderBy(INSERTION_ORDER),
    db.select().from(bankImports).orderBy(bankImports.fromDate, bankImports.toDate),
  ])
  return accounts.map((a) => {
    const own = imports.filter((i) => i.accountId === a.id)
    return { ...a, coverage: coverageOf(own), imports: own }
  })
}

// Bezeichnung und Art eines Kontos. „Nur für die Vermietung“ verlangt die ausdrückliche Bestätigung und gilt für
// künftige Importe; was vorher als privat nur in die Tagessumme ging, bleibt dort.
export async function updateBankAccount(db: Database, id: string, body: Record<string, unknown>, now: string): Promise<BankAccount> {
  const [current] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, id))
  if (!current) throw new BankError(404, 'Dieses Konto gibt es nicht mehr. Bitte laden Sie die Seite neu.')
  const next = { ...current }
  if (body.label !== undefined) {
    const label = typeof body.label === 'string' ? body.label.trim() : ''
    if (label === '' || label.length > 100) throw new BankError(400, 'Bitte geben Sie dem Konto eine Bezeichnung mit höchstens 100 Zeichen.')
    next.label = label
  }
  if (body.kind !== undefined) {
    if (body.kind !== 'mixed' && body.kind !== 'rental') throw new BankError(400, 'Ein Konto ist ein Mischkonto oder nur für die Vermietung.')
    if (body.kind === 'rental' && current.kind !== 'rental') {
      if (body.confirm !== true) throw new BankError(400, `${RENTAL_CONFIRM_TEXT} Bitte bestätigen Sie das.`)
      next.rentalConfirmedAt = now
    }
    if (body.kind === 'mixed') next.rentalConfirmedAt = null
    next.kind = body.kind
  }
  await db.update(bankAccounts).set({ label: next.label, kind: next.kind, rentalConfirmedAt: next.rentalConfirmedAt }).where(eq(bankAccounts.id, id))
  return next
}

// Nimmt einen Import zurück: seine Tage und Umsätze fallen mit ihm (CASCADE), danach lässt sich der Auszug neu
// einlesen. Nicht, solange ein Umsatz daraus zugeordnet ist: Die Zahlung bliebe, und der Umsatz fehlte.
export async function removeBankImport(db: Database, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [found] = await tx.select({ id: bankImports.id }).from(bankImports).where(eq(bankImports.id, id))
    if (!found) throw new BankError(404, 'Diesen Import gibt es nicht mehr. Bitte laden Sie die Seite neu.')
    const transactionIds = (await tx.select({ id: bankTransactions.id }).from(bankTransactions).where(eq(bankTransactions.importId, id))).map((t) => t.id)
    for (let i = 0; i < transactionIds.length; i += CHUNK) {
      const linked = await tx.select({ id: bankTransactionLinks.id }).from(bankTransactionLinks)
        .where(inArray(bankTransactionLinks.transactionId, transactionIds.slice(i, i + CHUNK))).limit(1)
      if (linked.length > 0) throw new BankError(409, IMPORT_LINKED_TEXT)
    }
    await tx.delete(bankImports).where(eq(bankImports.id, id))
  })
}

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

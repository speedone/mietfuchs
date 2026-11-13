// Kontoauszug in der Datenbank (#188): den Bestand lesen, gegen den bank/importPlan.ts plant, und den Plan schreiben.

import { eq, inArray, sql } from 'drizzle-orm'
import type { Database, Executor } from './client.ts'
import {
  bankAccounts, bankDays, bankImports, bankTransactionLinks, bankTransactions, payments, properties, settings, tenancies, tenancyPayers,
} from './schema.ts'
import { normalizeIban } from '../bank/statement.ts'
import { coverageOf, type Coverage } from '../bank/coverage.ts'
import type { BankAccount, BankImport, BankStock } from '../bank/model.ts'
import type { ImportWrite } from '../bank/importPlan.ts'
import type { LinkWrite, SetAsideReason } from '../bank/linkPlan.ts'
import { linkedCents, openCents, suggest, type MatchContext, type Suggestion } from '../bank/match.ts'
import type { BankTransaction } from '../bank/model.ts'
import type { BankLinkView, BankPayerView, BankTransactionView as SharedTransactionView } from '../../../shared/types.ts'
import { compareText } from '../apportion.ts'
import { retitleCurrentGroup } from './journal.ts'
import { readDepositEntries, readPayments } from './read.ts'
import { insertEntityIn } from './repository.ts'
import { insertDepositEntriesIn, removeDepositEntry } from './deposits.ts'

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

// Gemerkte Zahler für die Karte auf der Seite Kontoauszug, je Mietverhältnis in der Reihenfolge des Merkens.
export async function readTenancyPayers(db: Executor): Promise<BankPayerView[]> {
  const rows = await db.select().from(tenancyPayers).orderBy(INSERTION_ORDER)
  return rows.map((p) => ({ id: p.id, tenancyId: p.tenancyId, iban: normalizeIban(p.iban), name: p.name }))
}

// Einen gemerkten Zahler vergessen: Das nächste Einlesen fragt bei seiner IBAN wieder nach (auf einem Mischkonto
// bleibt ein privater Eingang dann wieder nur in der Tagessumme). Gespeicherte Umsätze und Zuordnungen bleiben.
export async function removeTenancyPayer(db: Database, id: string): Promise<void> {
  const removed = await db.delete(tenancyPayers).where(eq(tenancyPayers.id, id)).returning({ id: tenancyPayers.id })
  if (removed.length === 0) throw new BankError(404, 'Diesen gemerkten Zahler gibt es nicht mehr. Bitte laden Sie die Seite neu.')
}

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

// ---------- Zuordnen und Buchen (Teil 2) ----------

export type BankTransactionView = BankTransaction & SharedTransactionView

// Umsätze mit offenem Rest, Verknüpfungen und Vorschlag, dazu der Zusammenhang, gegen den geplant wird. Das Monats-Soll
// kommt von außen aus dem Mietkonto (index.ts), hier wird es nicht neu gerechnet.
export async function readBankState(db: Executor, monthlySollCents: MatchContext['monthlySollCents']): Promise<{ ctx: MatchContext; views: BankTransactionView[] }> {
  const stock = await readBankStock(db)
  const [tenancyRows, paymentList, deposits] = await Promise.all([
    db.select({ id: tenancies.id, iban: tenancies.iban, start: tenancies.start, end: tenancies.end, depositCents: tenancies.depositCents, depositStatus: tenancies.depositStatus, depositForm: tenancies.depositForm }).from(tenancies).orderBy(INSERTION_ORDER),
    readPayments(db),
    readDepositEntries(db),
  ])
  const paymentById = new Map(paymentList.map((p) => [p.id, p]))
  const depositById = new Map(deposits.map((d) => [d.id, d]))
  // Eine Zahlung aus einer Verrechnung der Kaution (#228) ist kein Geldeingang und nie die erfasste Zahlung eines Umsatzes
  // (Durchsicht C1): Sonst verschwände eine echte Überweisung hinter der Verrechnung.
  const bound = new Set(deposits.flatMap((d) => (d.paymentId ? [d.paymentId] : [])))
  const ctx: MatchContext = {
    tenancies: tenancyRows.map((t) => ({ id: t.id, iban: t.iban, start: t.start, end: t.end, ...(t.depositCents !== null ? { depositCents: t.depositCents } : {}), ...(t.depositStatus !== null ? { depositStatus: t.depositStatus } : {}), ...(t.depositForm !== null ? { depositForm: t.depositForm } : {}) })),
    payers: stock.payers,
    payments: paymentList.filter((p) => !bound.has(p.id)),
    linkedPaymentIds: new Set(stock.links.flatMap((l) => (l.paymentId ? [l.paymentId] : []))),
    depositEntries: deposits,
    linkedDepositEntryIds: new Set(stock.links.flatMap((l) => (l.depositEntryId ? [l.depositEntryId] : []))),
    monthlySollCents,
  }
  const linksOf = new Map<string, BankLinkView[]>()
  for (const l of stock.links) {
    const target = l.paymentId ? paymentById.get(l.paymentId) : l.depositEntryId ? depositById.get(l.depositEntryId) : undefined
    const view: BankLinkView = { id: l.id, paymentId: l.paymentId, depositEntryId: l.depositEntryId, created: l.created, cents: target ? linkedCents(target) : 0, tenancyId: target?.tenancyId ?? null }
    linksOf.set(l.transactionId, [...(linksOf.get(l.transactionId) ?? []), view])
  }
  // In zeitlicher Folge: Eine erfasste Zahlung, die ein Umsatz schon vorschlägt, schlägt kein späterer noch einmal vor;
  // sonst scheiterte „alle grünen übernehmen“ am zweiten (zwei Mieten von 850 € neben einer erfassten).
  const reserved = new Set(ctx.linkedPaymentIds)
  const views = [...stock.transactions]
    .sort((a, b) => compareText(a.bookingDate, b.bookingDate))
    .map((tx) => {
      const links = linksOf.get(tx.id) ?? []
      const open = openCents(tx, links.map((l) => l.cents))
      const suggestion = open !== 0 ? suggest({ ...tx, amountCents: open }, { ...ctx, linkedPaymentIds: reserved }) : null
      if (suggestion?.target.type === 'existingPayment') reserved.add(suggestion.target.paymentId)
      return { ...tx, openCents: open, links, suggestion }
    })
  return { ctx, views }
}

export const bookedTitle = (count: number): string =>
  count === 1 ? '1 Umsatz aus dem Kontoauszug gebucht' : `${count} Umsätze aus dem Kontoauszug gebucht`

// Schreibt einen geplanten Buchungslauf (bank/linkPlan.ts) in einer Transaktion: Zahlungen über denselben Weg wie
// POST /api/payments (mit `guardPayment`), Kautionsbuchungen mit den Prüfungen der Kaution, je Ziel ein Link.
export async function applyBankLinks(db: Database, writes: LinkWrite, newId: () => string): Promise<void> {
  const touched = new Set([...writes.payments, ...writes.depositEntries, ...writes.existing, ...writes.existingDeposits, ...writes.setAside].map((w) => w.transactionId))
  await db.transaction(async (tx) => {
    for (const { transactionId, ...body } of writes.payments) {
      const paymentId = newId()
      await insertEntityIn(tx, 'payments', paymentId, body)
      await tx.insert(bankTransactionLinks).values({ id: newId(), transactionId, paymentId, depositEntryId: null, created: true })
    }
    const deposits = writes.depositEntries.map(({ transactionId, ...body }) => ({ id: newId(), transactionId, body }))
    await insertDepositEntriesIn(tx, deposits, newId)
    for (const d of deposits) await tx.insert(bankTransactionLinks).values({ id: newId(), transactionId: d.transactionId, paymentId: null, depositEntryId: d.id, created: true })
    for (const e of writes.existing) await tx.insert(bankTransactionLinks).values({ id: newId(), transactionId: e.transactionId, paymentId: e.paymentId, depositEntryId: null, created: false })
    for (const e of writes.existingDeposits) await tx.insert(bankTransactionLinks).values({ id: newId(), transactionId: e.transactionId, paymentId: null, depositEntryId: e.depositEntryId, created: false })
    for (const a of writes.setAside) await tx.update(bankTransactions).set({ setAside: a.reason }).where(eq(bankTransactions.id, a.transactionId))
    if (touched.size > 0) await retitleCurrentGroup(tx, bookedTitle(touched.size))
  })
}

export const OWN_PAYMENT_TEXT = 'Diese Zahlung haben Sie selbst erfasst. Löschen Sie sie bitte im Mietkonto.'
export const OWN_DEPOSIT_TEXT = 'Diese Kautionsbuchung haben Sie selbst erfasst. Löschen Sie sie bitte unter Stammdaten bei „Kaution führen“.'

// Löst eine Zuordnung; der Umsatz ist danach wieder offen. Mit `deleteTarget` fällt auch die Zahlung bzw. Kautionsbuchung,
// aber nur, wenn sie aus dem Umsatz entstand: Eine selbst erfasste gehört ins Mietkonto.
export async function removeBankLink(db: Database, id: string, deleteTarget: boolean): Promise<void> {
  await db.transaction(async (tx) => {
    const [link] = await tx.select().from(bankTransactionLinks).where(eq(bankTransactionLinks.id, id))
    if (!link) throw new BankError(404, 'Diese Zuordnung gibt es nicht mehr. Bitte laden Sie die Seite neu.')
    if (deleteTarget && !link.created) throw new BankError(400, link.depositEntryId ? OWN_DEPOSIT_TEXT : OWN_PAYMENT_TEXT)
    await tx.delete(bankTransactionLinks).where(eq(bankTransactionLinks.id, id))
    if (!deleteTarget) return
    if (link.paymentId) await tx.delete(payments).where(eq(payments.id, link.paymentId))
    else if (link.depositEntryId) await removeDepositEntry(tx, link.depositEntryId)
  })
}

// Einen Umsatz beiseitelegen oder zurückholen (`null`).
export async function setTransactionAside(db: Database, id: string, reason: SetAsideReason | null): Promise<void> {
  const [found] = await db.select({ id: bankTransactions.id }).from(bankTransactions).where(eq(bankTransactions.id, id))
  if (!found) throw new BankError(404, 'Diesen Umsatz gibt es nicht mehr. Bitte laden Sie die Seite neu.')
  await db.transaction(async (tx) => {
    await tx.update(bankTransactions).set({ setAside: reason }).where(eq(bankTransactions.id, id))
    if (reason !== null) await retitleCurrentGroup(tx, 'Umsatz beiseitegelegt')
  })
}

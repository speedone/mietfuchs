// Wächter an Zielen eines Kontoumsatzes (#188, Teil 2): Eine Zahlung oder Kautionsbuchung, die einem Umsatz zugeordnet
// ist, darf gesenkt werden (der Rest des Umsatzes ist dann wieder offen), aber nicht über den Umsatz hinaus wachsen, nicht
// das Vorzeichen wechseln und nicht auf ein anderes Mietverhältnis wandern. Sonst stünde im Mietkonto mehr, als auf dem
// Konto ankam. Eigenes Modul ohne Abhängigkeit von repository.ts oder deposits.ts, die es beide rufen.

import { eq } from 'drizzle-orm'
import type { Executor } from './client.ts'
import { bankTransactionLinks, bankTransactions, depositEntries, payments } from './schema.ts'

const euro = (cents: number): string => `${(cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

const signedDeposit = (kind: string, cents: number): number => (kind === 'applied' || kind === 'refunded' ? -cents : cents)

// Ergibt den Satz der Ablehnung oder null. `after.cents` ist der zugeordnete Betrag mit Vorzeichen (bei einer
// Kautionsbuchung nach ihrer Art).
export async function linkedTargetRefusal(
  db: Executor,
  target: { paymentId: string } | { depositEntryId: string },
  before: { tenancyId: string },
  after: { tenancyId: string; cents: number },
): Promise<string | null> {
  const where = 'paymentId' in target ? eq(bankTransactionLinks.paymentId, target.paymentId) : eq(bankTransactionLinks.depositEntryId, target.depositEntryId)
  const [link] = await db.select().from(bankTransactionLinks).where(where)
  if (!link) return null
  const [tx] = await db.select({ amountCents: bankTransactions.amountCents }).from(bankTransactions).where(eq(bankTransactions.id, link.transactionId))
  if (!tx) return null
  const what = 'paymentId' in target ? 'Diese Zahlung' : 'Diese Kautionsbuchung'
  const refusal = `${what} ist einem Kontoumsatz über ${euro(Math.abs(tx.amountCents))} zugeordnet. Lösen Sie zuerst die Zuordnung auf der Seite Kontoauszug.`
  if (after.tenancyId !== before.tenancyId) return refusal
  let others = 0
  for (const l of await db.select().from(bankTransactionLinks).where(eq(bankTransactionLinks.transactionId, link.transactionId))) {
    if (l.id === link.id) continue
    if (l.paymentId) {
      const [p] = await db.select({ amountCents: payments.amountCents }).from(payments).where(eq(payments.id, l.paymentId))
      others += p?.amountCents ?? 0
    } else if (l.depositEntryId) {
      const [d] = await db.select({ kind: depositEntries.kind, amountCents: depositEntries.amountCents }).from(depositEntries).where(eq(depositEntries.id, l.depositEntryId))
      others += d ? signedDeposit(d.kind, d.amountCents) : 0
    }
  }
  const sign = Math.sign(tx.amountCents)
  if (after.cents === 0 || Math.sign(after.cents) !== sign || Math.abs(others + after.cents) > Math.abs(tx.amountCents)) return refusal
  return null
}

export { signedDeposit }

// Die gespeicherten Zeilen des Kontoauszugs (#188) und der Bestand, gegen den der Import plant. Nur der Server kennt
// sie; was die Seite braucht, kommt mit PR 3 nach shared/.

import type {
  bankAccounts, bankDays, bankImports, bankTransactionLinks, bankTransactions, tenancyPayers,
} from '../db/schema.ts'

export type BankAccount = typeof bankAccounts.$inferSelect
export type BankImport = typeof bankImports.$inferSelect
export type BankDay = typeof bankDays.$inferSelect
export type BankTransaction = typeof bankTransactions.$inferSelect
export type BankLink = typeof bankTransactionLinks.$inferSelect
export type TenancyPayer = typeof tenancyPayers.$inferSelect

// Eine IBAN eines Mietverhältnisses (`tenancies.iban`), genormt ohne Leerzeichen und groß.
export type TenancyIban = { tenancyId: string; iban: string }

export type BankStock = {
  accounts: BankAccount[]
  imports: BankImport[]
  days: BankDay[]
  transactions: BankTransaction[]
  links: BankLink[]
  payers: TenancyPayer[]
  tenancyIbans: TenancyIban[]
  // IBANs des Vermieters aus den Einstellungen und den Objekten, genormt.
  ownIbans: string[]
}

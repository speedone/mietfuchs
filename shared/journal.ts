// Die Bereiche des Verlaufs (#318, Schritt 4): Der Server leitet sie aus den Tabellen einer Gruppe ab
// (server/src/db/journal.ts, `TABLE_KINDS`) und prüft den Filter, die Oberfläche bietet sie zur Auswahl an.
export const JOURNAL_KINDS = ['units', 'costs', 'meters', 'payments', 'heating', 'receipts', 'settlements', 'settings'] as const
export type JournalKind = (typeof JOURNAL_KINDS)[number]
export const isJournalKind = (value: unknown): value is JournalKind => typeof value === 'string' && (JOURNAL_KINDS as readonly string[]).includes(value)

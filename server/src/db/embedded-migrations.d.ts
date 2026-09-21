// Erzeugt von scripts/embed-migrations.mjs, existiert erst nach dessen Lauf (und immer im
// Bun-Build). Diese Beschreibung ist von Hand gepflegt und gehört ins Repository, damit
// `npm run typecheck` auch im frisch geklonten Stand durchläuft, in dem die erzeugte Datei
// noch fehlt. Genau wie bei embedded-client.d.ts.
export declare const migrations: {
  /** Name des Schritts, wie ihn drizzle-kit vergeben hat, etwa '0000_ancient_mercury'. */
  tag: string
  /** SHA-256 über den Inhalt der .sql-Datei. Verrät einen nachträglich veränderten Schritt. */
  hash: string
  /** Zeitpunkt aus dem Journal. Bestimmt die Reihenfolge. */
  folderMillis: number
  /** Die einzelnen SQL-Anweisungen, schon an `--> statement-breakpoint` zerlegt. */
  statements: string[]
}[]

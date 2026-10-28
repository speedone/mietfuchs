// Datenschritte (#455): TypeScript, das innerhalb eines Migrationsschrittes läuft, wo SQL nicht reicht
// (zum Beispiel Werte, die erst berechnet werden müssen). Der Schlüssel ist der `tag` des Schrittes;
// `applyMigrations` ruft den Datenschritt nach den Anweisungen des Schrittes und vor der Marke auf,
// in derselben Transaktion. Wirft er, rollt der ganze Schritt zurück.
//
// Ein Datenschritt ist **eingefroren wie die SQL-Datei** seines Schrittes: Er liest und schreibt
// rohes SQL über `connection` und importiert nichts außer `import type` aus ../client.ts und seinen
// Geschwistern in diesem Ordner. Weder schema.ts noch shared/ noch Repository: Sonst änderte sich
// ein veröffentlichter Schritt mit dem Code, und zwei Bestände, die denselben Schritt durchlaufen
// haben, wichen voneinander ab. Ein Wächter in server/test/data-steps.test.ts hält das fest.
import type { Connection } from '../client.ts'

export type DataStep = (connection: Connection) => void

export const DATA_STEPS: Readonly<Record<string, DataStep>> = {}

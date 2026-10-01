// Einen Bestand in eine Datenbank bringen, so wie es beim Nutzer geschieht.
//
// `legacy/write.ts` schreibt auf den Stand von Migration 0000, denn dafür ist es gebaut: Der
// Umstieg importiert dorthin und lässt erst danach die übrige Kette darüber laufen. Seit #92
// verlangt der neueste Stand an Wohnungen, Zählern, Kostenpositionen und Abschlüssen ein Objekt,
// das es auf 0000 nicht gibt. Ein Bestand direkt in eine voll migrierte Datenbank geschrieben
// scheiterte deshalb, und zwar zu Recht.
//
// Dieser Helfer geht denselben Weg wie der Umstieg: Datei auf 0000 anlegen, Bestand hinein, die
// Kette beim Öffnen nachholen. Was die Tests danach lesen, ist damit genau das, was ein Vermieter
// nach dem Update in seiner Datenbank hätte.
//
// Bewusst außerhalb von test/: `node --test` führt jede Quelldatei unter test/ als Test aus.

import { applyMigrations, connect, loadMigrations } from '../src/db/client.ts'
import { databaseFile, openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import type { StraightDb } from '../src/legacy/migrate.ts'
import { writeStock } from '../src/legacy/write.ts'

export async function openDatabaseWithStock(dataDir: string, stock: StraightDb): Promise<OpenedDatabase> {
  const connection = await connect(databaseFile(dataDir))
  try {
    const [baseline] = await loadMigrations()
    if (!baseline) throw new Error('Migration 0000 fehlt')
    applyMigrations(connection, [baseline])
    await writeStock(connection.db, stock)
  } finally {
    connection.close()
  }
  return openDatabase({ dataDir })
}

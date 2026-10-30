// Eine Datenbank auf dem Stand **vor** einem Migrationsschritt, für die Tests eines Datenschrittes (#455).
//
// Ein Datenschritt läuft auf Beständen, die eine frühere Version geschrieben hat. Geprüft wird er deshalb so: die
// echte Kette bis zum Schritt davor, dann rohe Zeilen so, wie die frühere Version sie schrieb, dann der Rest der
// Kette mit dem echten Datenschritt (`finishChain`). Eine frische, voll migrierte Datenbank (freshDatabase.ts) taugt
// dafür nicht, denn in ihr ist der Schritt schon gelaufen.
//
// Je Prozess und Marke entsteht die Kette einmal als Vorlage; jeder Test bekommt eine Dateikopie (wie in
// freshDatabase.ts zulässig: Die Vorlage ist geschlossen, ohne WAL und ohne Beidateien).
//
// Bewusst außerhalb von test/: `node --test` führt jede Quelldatei unter test/ als Test aus.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyMigrations, connect, loadMigrations, type Connection } from '../src/db/client.ts'
import { databaseFile } from '../src/db/open.ts'

const templates = new Map<string, Promise<string>>()

async function createTemplate(tag: string): Promise<string> {
  const migrations = await loadMigrations()
  const index = migrations.findIndex((m) => m.tag === tag)
  if (index < 0) throw new Error(`Den Migrationsschritt ${tag} gibt es nicht`)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-vor-schritt-'))
  process.once('exit', () => fs.rmSync(dir, { recursive: true, force: true }))
  const file = databaseFile(dir)
  const connection = await connect(file)
  try {
    applyMigrations(connection, migrations.slice(0, index))
  } finally {
    connection.close()
  }
  return file
}

// Öffnet in `dataDir` eine Datenbank mit allen Schritten **vor** `tag`. Der Aufrufer schließt die Verbindung.
export async function migrateUpTo(dataDir: string, tag: string): Promise<Connection> {
  let template = templates.get(tag)
  if (template === undefined) {
    template = createTemplate(tag)
    templates.set(tag, template)
  }
  const source = await template
  fs.mkdirSync(dataDir, { recursive: true })
  const target = databaseFile(dataDir)
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL)
  return connect(target)
}

// Der Rest der Kette, mit den echten Datenschritten. Gibt die Zahl der nachgeholten Schritte zurück.
export async function finishChain(connection: Connection): Promise<number> {
  return applyMigrations(connection, await loadMigrations())
}

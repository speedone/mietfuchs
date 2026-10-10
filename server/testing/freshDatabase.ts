// Eine frische, voll migrierte Datenbank für einen Test, ohne dass jeder Test die ganze
// Migrationskette fährt (#263).
//
// **Warum es das gibt.** Ein Test, der eine leere Datenbank braucht, öffnete bisher einen leeren
// Ordner mit `openDatabase`, und dabei lief jedes Mal die ganze Kette. Das sind rund 40 Schritte
// mit einer Transaktion und einem fsync je Schritt, nachgemessen gut eine Viertelsekunde je Test
// auf einer gewöhnlichen Platte. Bei der Invariante mit über 1.700 Läufen je Abschnitt war das
// der größte Einzelposten (gut ein Drittel der Rechenzeit im Profil).
//
// **Wie es geht.** Je Testprozess entsteht einmal eine Vorlage: ein Wegwerf-Ordner, geöffnet mit
// derselben `openDatabase` wie beim Start des Servers, also mit der Kette, wie sie in diesem
// Augenblick auf der Platte steht. Nichts davon wird eingecheckt, und eine Vorlage überlebt ihren
// Prozess nicht; veralten kann sie deshalb nur innerhalb eines Laufs, und auch das fängt die
// Prüfung unten. Jeder Test bekommt eine **Dateikopie** in seinen eigenen Ordner. Das ist hier
// zulässig, anders als beim Backup: Die Vorlage ist geschlossen, ohne WAL und ohne Beidateien.
//
// **Geöffnet wird die Kopie wieder mit `openDatabase`**, und das ist der Kern der Sache. Dieselben
// Prüfungen wie bei jedem Start laufen also auch hier: Fremdschlüssel an (mit Nachsehen),
// `integrity_check`, Schreibprobe, Abgleich mit der Kette. Eine Verbindung, die der Test bekommt,
// ist damit genau eine, die der Server bekäme; kein Pragma muss nachgestellt werden.
//
// **Eine veraltete Vorlage wird abgelehnt.** `openDatabase` holte einen fehlenden Schritt beim
// Öffnen der Kopie still nach, und jeder Test bliebe grün. Weil die Vorlage die ganze Kette
// tragen muss, verlangt `openFromTemplate`, dass beim Öffnen nichts mehr nachzuholen war.
//
// **Nicht hierher gehören die Tests der Kette selbst**: Marken, Umstieg, `backupBeforeMigrating`,
// der eingefrorene Eingang. Sie fahren die echte Kette auf einem leeren oder alten Stand, denn
// genau das prüfen sie.
//
// Bewusst außerhalb von test/: `node --test` führt jede Quelldatei unter test/ als Test aus.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { databaseFile, openDatabase, type OpenedDatabase } from '../src/db/open.ts'

let template: Promise<string> | null = null

// Die Vorlage dieses Prozesses, beim ersten Aufruf angelegt.
export function templateFile(): Promise<string> {
  template ??= createTemplate()
  return template
}

async function createTemplate(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-vorlage-'))
  // Aufräumen am Ende des Prozesses. `exit` ruft nur Synchrones auf, und das genügt hier.
  process.once('exit', () => fs.rmSync(dir, { recursive: true, force: true }))
  const opened = await openDatabase({ dataDir: dir })
  opened.close()
  if (opened.migrations === 0) throw new Error(`Die Vorlage in ${dir} ist nicht frisch migriert worden`)
  return databaseFile(dir)
}

// Öffnet eine Kopie von `source` im Ordner `dataDir`. Für die Tests der Vorlage einzeln
// erreichbar, damit sich eine veraltete Vorlage hineinreichen lässt.
export async function openFromTemplate(source: string, dataDir: string): Promise<OpenedDatabase> {
  const target = databaseFile(dataDir)
  fs.mkdirSync(dataDir, { recursive: true })
  if (fs.existsSync(target)) {
    throw new Error(`In ${dataDir} liegt schon eine Datenbank; eine frische Kopie überschriebe sie`)
  }
  // COPYFILE_EXCL zusätzlich zur Prüfung oben: Auch ein Wettlauf überschreibt nichts.
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL)
  const opened = await openDatabase({ dataDir })
  if (opened.migrations !== 0) {
    opened.close()
    throw new Error(
      `Die Vorlage ${source} ist veraltet: Beim Öffnen der Kopie waren noch ${opened.migrations} ` +
        `Schritte der Migrationskette nachzuholen. Eine Vorlage muss die ganze Kette tragen.`,
    )
  }
  return opened
}

// Der Ersatz für `openDatabase({ dataDir })` auf einem leeren Ordner.
export async function openFreshDatabase(dataDir: string): Promise<OpenedDatabase> {
  return openFromTemplate(await templateFile(), dataDir)
}

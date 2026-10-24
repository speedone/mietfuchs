// Der Papierkorb für Dateien (#318, Schritt 5). Belege und Logo/Briefpapier sind Dateien neben der Datenbank; das
// Journal hält nur ihre Zeilen. Damit ein Rücksprung einen gelöschten Beleg zurückholen kann, wird er nicht gelöscht,
// sondern nach `papierkorb/<Ablage>/` im Datenordner verschoben, unter seinem Namen (die Namen vergibt der Server,
// sie sind eindeutig).
//
// - **Nicht im Backup**: Das Backup packt nur `uploads/` und `briefpapier/`.
// - **Aufgeräumt** wird mit der Aufbewahrung des Journals (`cleanTrash`, beim Start und einmal am Tag): Weg kommt nur, was
//   weder das Journal noch der Bestand nennt (db/fileRefs.ts).
// - **Nur eigene Dateien**: Angefasst werden nur Dateien unmittelbar in `papierkorb/uploads/` und
//   `papierkorb/briefpapier/`, nie Ordner und nie etwas anderes im Datenordner.
import fs from 'node:fs'
import path from 'node:path'

export const TRASH_DIR = 'papierkorb'

// Eine Ablage: der Ordner im Datenordner und der Ordner im Papierkorb heißen gleich. Eine neue Ablage gehört hierher
// und in `FILE_COLUMNS` (db/fileRefs.ts). `briefpapier` ist `DESIGN_DIR_NAME` aus letterDesign.ts (hier als Text, weil
// letterDesign.ts diese Datei einbindet; trash.test.ts vergleicht beide).
export const FILE_STORES = ['uploads', 'briefpapier'] as const
export type FileStore = (typeof FILE_STORES)[number]

export const storeDir = (dataDir: string, store: FileStore): string => path.join(dataDir, store)
export const trashDir = (dataDir: string, store: FileStore): string => path.join(dataDir, TRASH_DIR, store)

// Nur ein schlichter Name, nie ein Pfad.
const plain = (name: string): boolean => name !== '' && name === path.basename(name) && name !== '.' && name !== '..'

export function existsIn(dir: string, name: string): boolean {
  if (!plain(name)) return false
  try {
    return fs.statSync(path.join(dir, name)).isFile()
  } catch {
    return false
  }
}

export function filesIn(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name)
  } catch {
    return []
  }
}

// Die Dateioperationen, hineingereicht für den Test (ein Virenscanner unter Windows oder ein zweites Laufwerk lassen
// sich nicht nachstellen).
export type FileOps = {
  rename: (from: string, to: string) => void
  copyFile: (from: string, to: string) => void
  rm: (file: string) => void
  exists: (file: string) => boolean
  mkdir: (dir: string) => void
}
const realOps: FileOps = {
  rename: (from, to) => fs.renameSync(from, to),
  copyFile: (from, to) => fs.copyFileSync(from, to),
  rm: (file) => fs.rmSync(file),
  exists: (file) => fs.existsSync(file),
  mkdir: (dir) => fs.mkdirSync(dir, { recursive: true }),
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Verschiebt eine Datei, mit Wiederholungen wie `replaceFile` (ein Virenscanner unter Windows hält eine eben
// geschlossene Datei kurz offen). Unter Windows ersetzt `rename` kein vorhandenes Ziel; liegt dort dieselbe Datei
// (zweimal gelöscht), wird sie vorher entfernt. Auf ein anderes Laufwerk (EXDEV) wird kopiert und die Quelle entfernt;
// scheitert das Entfernen, wird die Kopie wieder entfernt und der Fehler geworfen: Die Datei gilt dann als nicht
// verschoben, und es gibt nie zwei Exemplare.
export async function moveFile(from: string, to: string, ops: FileOps = realOps, wait: (ms: number) => Promise<unknown> = pause): Promise<void> {
  ops.mkdir(path.dirname(to))
  for (let attempt = 1; ; attempt++) {
    try {
      if (ops.exists(to)) ops.rm(to)
      ops.rename(from, to)
      return
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EXDEV') break
      if (attempt >= 5) throw err
      await wait(100)
    }
  }
  ops.copyFile(from, to)
  try {
    ops.rm(from)
  } catch (err) {
    try {
      ops.rm(to)
    } catch { /* bleibt als zweites Exemplar; der Fehler unten nennt den Grund */ }
    throw err
  }
}

export async function moveToTrash(dataDir: string, store: FileStore, name: string): Promise<void> {
  if (!plain(name)) return
  const from = path.join(storeDir(dataDir, store), name)
  if (!fs.existsSync(from)) return
  await moveFile(from, path.join(trashDir(dataDir, store), name))
}

export async function restoreFromTrash(dataDir: string, store: FileStore, name: string): Promise<void> {
  if (!plain(name)) throw new Error(`Ungültiger Dateiname: ${name}`)
  await moveFile(path.join(trashDir(dataDir, store), name), path.join(storeDir(dataDir, store), name))
}

// Entfernt jede Datei im Papierkorb, die `keep` nicht nennt. Wirft nie; ein Fehler steht auf der Konsole.
export function cleanTrash(dataDir: string, keep: ReadonlyMap<FileStore, ReadonlySet<string>>): number {
  let removed = 0
  for (const store of FILE_STORES) {
    const dir = trashDir(dataDir, store)
    for (const name of filesIn(dir)) {
      if (keep.get(store)?.has(name)) continue
      try {
        fs.rmSync(path.join(dir, name))
        removed++
      } catch (err) {
        console.error(`Eine Datei im Papierkorb ließ sich nicht entfernen (${path.join(dir, name)}): ${String(err)}`)
      }
    }
  }
  return removed
}

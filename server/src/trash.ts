// Der Papierkorb für Dateien (#318, Schritt 5). Belege und Logo/Briefpapier sind Dateien neben der Datenbank; das
// Journal hält nur ihre Zeilen. Damit ein Rücksprung einen gelöschten Beleg zurückholen kann, wird er nicht gelöscht,
// sondern nach `papierkorb/<Ablage>/` im Datenordner verschoben, unter seinem Namen (die Namen vergibt der Server,
// sie sind eindeutig).
//
// - **Nicht im Backup**: Das Backup packt nur `uploads/` und `briefpapier/`.
// - **Aufgeräumt** wird mit der Aufbewahrung des Journals (`cleanTrash`, beim Start und einmal am Tag): Eine Datei,
//   die keine Zeile im Journal mehr nennt, kann kein Rücksprung mehr brauchen.
// - **Nur eigene Dateien**: Angefasst werden nur Dateien unmittelbar in `papierkorb/uploads/` und
//   `papierkorb/briefpapier/`, nie Ordner und nie etwas anderes im Datenordner.
import fs from 'node:fs'
import path from 'node:path'

export const TRASH_DIR = 'papierkorb'

// Eine Ablage: der Ordner im Datenordner und der Ordner im Papierkorb heißen gleich. Eine neue Ablage gehört hierher
// und in `FILE_COLUMNS` (db/revert.ts). `briefpapier` ist `DESIGN_DIR_NAME` aus letterDesign.ts (hier als Text, weil
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

// Verschiebt eine Datei; liegt am Ziel schon eine gleichnamige (dieselbe Datei, zweimal gelöscht), wird sie ersetzt.
function move(from: string, to: string): void {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  try {
    fs.renameSync(from, to)
  } catch (err) {
    // Windows ersetzt beim Umbenennen nicht; ein anderes Laufwerk kennt `rename` nicht.
    if (!fs.existsSync(from)) throw err
    fs.copyFileSync(from, to)
    fs.rmSync(from)
  }
}

export function moveToTrash(dataDir: string, store: FileStore, name: string): void {
  if (!plain(name)) return
  const from = path.join(storeDir(dataDir, store), name)
  if (!fs.existsSync(from)) return
  move(from, path.join(trashDir(dataDir, store), name))
}

export function restoreFromTrash(dataDir: string, store: FileStore, name: string): void {
  if (!plain(name)) throw new Error(`Ungültiger Dateiname: ${name}`)
  move(path.join(trashDir(dataDir, store), name), path.join(storeDir(dataDir, store), name))
}

// Entfernt jede Datei im Papierkorb, die `keep` nicht nennt. Wirft nie; ein Fehler steht auf der Konsole.
export function cleanTrash(dataDir: string, keep: ReadonlyMap<FileStore, ReadonlySet<string>>): number {
  let removed = 0
  for (const store of FILE_STORES) {
    const dir = trashDir(dataDir, store)
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (!e.isFile() || keep.get(store)?.has(e.name)) continue
      try {
        fs.rmSync(path.join(dir, e.name))
        removed++
      } catch (err) {
        console.error(`Eine Datei im Papierkorb ließ sich nicht entfernen (${path.join(dir, e.name)}): ${String(err)}`)
      }
    }
  }
  return removed
}

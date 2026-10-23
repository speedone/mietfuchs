// Die Dateiarbeit beim Wiederherstellen eines Backups, getrennt von der Route in index.ts, damit
// sich ihre Fehlerwege ohne echten Virenscanner und ohne volle Platte prüfen lassen.

import fs from 'node:fs'
import path from 'node:path'

type MoveOps = {
  rename?: (from: string, to: string) => void
  remove?: (file: string) => void
  // Pause zwischen zwei Versuchen; die Tests setzen 0.
  pauseMs?: number
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Einen ausgepackten Beleg an seinen Platz. Liegt die Zwischenablage auf demselben Datenträger
// (der Regelfall, sie steht im Datenordner), ist das ein `rename`, bei einem kurz gesperrten Ziel
// mit Wiederholungen wie `replaceFile` beim Umstieg (unter Windows hält ein Virenscanner eine eben
// geschriebene Datei gern einen Augenblick fest). Zeigt der Belegordner auf einen anderen
// Datenträger (EXDEV) oder bleibt es gesperrt, wird kopiert, samt der Zeit aus dem Archiv.
//
// **Scheitert danach nur das Entfernen der Quelle, ist das kein Fehlschlag.** Der Beleg liegt
// dann schon an seinem Platz, und die Zwischenablage räumt die Route ohnehin weg. Würfe es hier,
// bräche der Austausch mittendrin ab: ein Teil der Belege verschoben, die Datenbank nicht erneuert.
export async function moveIntoPlace(from: string, to: string, ops: MoveOps = {}): Promise<void> {
  const rename = ops.rename ?? fs.renameSync
  const remove = ops.remove ?? ((file: string) => fs.rmSync(file, { force: true }))
  const pauseMs = ops.pauseMs ?? 100
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      rename(from, to)
      return
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'EXDEV') break
      if (attempt < 5) await pause(pauseMs)
    }
  }
  const { atime, mtime } = fs.statSync(from)
  fs.copyFileSync(from, to)
  try {
    fs.utimesSync(to, atime, mtime)
  } catch { /* Datum bleibt das von heute */ }
  try {
    remove(from)
  } catch { /* bleibt in der Zwischenablage liegen, die die Route wegräumt */ }
}

// Der Name, den die Route einem hochgeladenen Archiv gibt (`newId`: 16 Hexziffern).
const RESTORE_UPLOAD_NAME = /^restore-upload-[0-9a-f]{16}\.zip$/

// Der Pfad des hochgeladenen Archivs, gebaut aus dem Datenordner und dem Namen, den der
// multer-Speicher vergeben hat; `null`, wenn der Name nicht dieser Gestalt ist. Die Route
// übernimmt `req.file.path` nicht ungeprüft, denn die Datei wird danach in jedem Fall gelöscht.
export function restoreUploadPath(dataDir: string, name: string | undefined): string | null {
  if (!name || !RESTORE_UPLOAD_NAME.test(name)) return null
  return path.join(dataDir, name)
}

// Was ein abgebrochenes Wiederherstellen im Datenordner hinterlässt: das hochgeladene Archiv
// (`restore-upload-<id>.zip`) und die Zwischenablage (`restore-<id>/`). Zusammen bis zur doppelten
// Größe eines Backups, und ohne Aufräumen blieben sie für immer liegen. Beim Start läuft keine
// Wiederherstellung, beides lässt sich dort gefahrlos entfernen. Ebenso der Schnappschuss eines abgebrochenen Backups
// (`mietfuchs.sqlite.<id>.backup` samt `-journal`, `-wal`, `-shm`, GET /api/backup; Integrationsdurchsicht 0.13.0): Beim Start läuft auch kein Backup.
//
// **Nicht** dazu gehört `mietfuchs.sqlite.restore-<id>`: Scheitert der Austausch der Datenbank,
// kann sie die einzige Kopie der wiederhergestellten Daten sein (siehe runRestore).
export function cleanRestoreLeftovers(dataDir: string): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dataDir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    // Nur genau die Namen, die die Route vergibt (`newId`: 16 Hexziffern). Ein Ordner, den der
    // Nutzer „restore-alt“ genannt hat, ist seiner und bleibt.
    const upload = e.isFile() && RESTORE_UPLOAD_NAME.test(e.name)
    const staging = e.isDirectory() && /^restore-[0-9a-f]{16}$/.test(e.name)
    // Samt Beidateien, falls SQLite beim Schreiben welche anlegt (Durchsicht von PR #426, K-4).
    const snapshot = e.isFile() && /^mietfuchs\.sqlite\.[0-9a-f]{16}\.backup(?:-journal|-wal|-shm)?$/.test(e.name)
    if (!upload && !staging && !snapshot) continue
    try {
      fs.rmSync(path.join(dataDir, e.name), { recursive: true, force: true })
    } catch { /* dann beim nächsten Start */ }
  }
}

// Platz, den ein Wiederherstellen braucht, in Bytes. Nicht nur die Belege und die Datenbank aus
// dem Archiv: Danach entstehen noch die db.json und `db.json.vor-restore`, und je nach Archiv die
// Sicherung vor ausstehenden Migrationen (`mietfuchs.sqlite.vor-<Schritt>`) oder bei einem Archiv
// ohne Datenbank die neu aufgebaute (`mietfuchs.sqlite.umstieg`, etwa so groß wie die db.json).
// Grob also die doppelte Datenbank (die größere von mitgebrachter, bisheriger und aufzubauender)
// und die doppelte db.json, dazu 64 MB Reserve. Ging die Rechnung nur für die Belege auf, kam
// „ok“, und danach ließ sich die Datenbank nicht öffnen.
export function restoreSpaceNeeded(sizes: { files: number, database: number, currentDatabase: number, dbJson: number }): number {
  const database = Math.max(sizes.database, sizes.currentDatabase, sizes.dbJson)
  return sizes.files + sizes.database + 2 * database + 2 * sizes.dbJson + 64 * 1024 * 1024
}

// Eine Meldung für eine volle Platte (oder eine Grenze des Dateisystems), oder `null`, wenn der
// Fehler etwas anderes ist. Die Meldung von Node („ENOSPC: no space left on device, write“) sagt
// einem Vermieter nichts.
export function diskFullMessage(err: unknown): string | null {
  const code = err && typeof err === 'object' && 'code' in err ? err.code : null
  if (code === 'ENOSPC' || code === 'EDQUOT') {
    return 'Auf dem Datenträger des Datenordners ist nicht genug Platz. Bitte schaffen Sie Platz ' +
      '(zum Beispiel alte Sicherungen im Datenordner löschen oder auslagern) und versuchen Sie es ' +
      'dann erneut. Ihre bisherigen Daten sind unverändert.'
  }
  if (code === 'EFBIG') {
    return 'Die Datei ist zu groß für das Dateisystem des Datenordners, dort ist nicht genug Platz ' +
      'für eine so große Datei (manche Dateisysteme, etwa FAT32 auf USB-Sticks, erlauben höchstens ' +
      '4 GB je Datei). Bitte legen Sie den Datenordner auf einen anderen Datenträger. Ihre bisherigen ' +
      'Daten sind unverändert.'
  }
  return null
}

// Freier Platz auf dem Datenträger von `dir`, oder `null`, wenn das System es nicht sagt.
// NKA_TEST_FREE_BYTES gibt ihn für Tests vor; ein Nutzer setzt die Variable nie.
export function freeBytes(dir: string): number | null {
  const forTest = Number(process.env.NKA_TEST_FREE_BYTES)
  if (forTest > 0) return forTest
  try {
    const s = fs.statfsSync(dir)
    return s.bavail * s.bsize
  } catch {
    return null
  }
}

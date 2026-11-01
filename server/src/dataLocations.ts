// Ort des Datenordners merken (#517, Schritt 1). Die Programmdatei legt ihre Daten neben sich ab, und die kann überall
// liegen: im Download-Ordner, auf dem Desktop, auf einem Stick. Das spätere Programm mit eigenem Fenster installiert
// sich an einen festen Ort und hält die Daten im Benutzerordner; den Umzug soll es selbst anbieten. Dafür schreibt die
// Programmdatei beim Start in eine feste Datei je Benutzer, wo ihre Daten liegen. Nur auf diesem Rechner, nichts
// verlässt ihn; kein Teil des Backups.
import fs from 'node:fs'
import path from 'node:path'
import type { Runtime } from './version.ts'

export type DataLocation = {
  /** Der Datenordner, wie die Programmdatei ihn benutzt. */
  dataDir: string
  /** Die Programmdatei, die ihn zuletzt benutzt hat. */
  exe: string
  appVersion: string
  /** Zeitpunkt des letzten Starts (ISO). */
  lastSeen: string
}
export type LocationsFile = { version: 1; locations: DataLocation[] }

const MAX_LOCATIONS = 20
const LOCATIONS_DIR = 'mietfuchs-standorte'

// Wie in paths.ts nach der genannten Plattform rechnen, nicht nach der des laufenden Rechners. Linux bleibt außen
// vor: Dort gibt es kein Programm mit eigenem Fenster (#517), und die Pakete halten die Daten schon im Benutzerordner.
// **Ein eigener Ordner**, nicht „Mietfuchs“: Der ist unter Windows auch der Datenordner, wenn die Programmdatei neben
// sich nicht schreiben darf (`userDataHome` in store.ts), und auf dem Mac der Ordner, den Electron für sich anlegt.
export function locationsFile({ platform, env, home }: {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  home: () => string
}): string | null {
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA && path.win32.isAbsolute(env.LOCALAPPDATA) ? env.LOCALAPPDATA : null
    const base = local ?? (home() ? path.win32.join(home(), 'AppData', 'Local') : null)
    return base ? path.win32.join(base, LOCATIONS_DIR, 'standorte.json') : null
  }
  if (platform === 'darwin') {
    const dir = home()
    return dir ? path.posix.join(dir, 'Library', 'Application Support', LOCATIONS_DIR, 'standorte.json') : null
  }
  return null
}

// Nur die echte Programmdatei (Bun) unter Windows und macOS. Die Store-Fassung zieht nicht um. **Nie mit `CI`**: Jeder
// Test und jede Probe setzt es (CLAUDE.md), und eine nachgestellte Programmdatei schriebe sonst in den echten
// Benutzerordner des Entwicklers.
export function shouldRecord({ packaged, runtime, platform, env }: {
  packaged: boolean
  runtime: Runtime
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
}): boolean {
  if (!packaged || env.CI) return false
  if (platform !== 'win32' && platform !== 'darwin') return false
  return runtime === 'binary' || runtime === 'package'
}

// Liegt ein Bestand im Ordner? Entschieden an der Datei, nicht daran, ob sie sich öffnen ließ: Ein Probestart in einem
// leeren Ordner legt erst eine Datenbank an, und ein beschädigter Bestand muss für den Umzug trotzdem auffindbar sein.
export function hasStock(dataDir: string, exists: (file: string) => boolean = fs.existsSync): boolean {
  return ['mietfuchs.sqlite', 'db.json'].some((name) => exists(path.join(dataDir, name)))
}

const isLocation = (value: unknown): value is DataLocation => {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return ['dataDir', 'exe', 'appVersion', 'lastSeen'].every((key) => typeof v[key] === 'string')
}

// Der neue Eintrag ersetzt einen mit demselben Ordner; der zuletzt benutzte steht zuerst. Unter Windows und macOS
// unterscheidet das Dateisystem nicht nach Groß- und Kleinschreibung, also auch der Vergleich nicht. Was nicht dem
// Format entspricht, fällt heraus: Die Datei ist nur ein Hinweis, eine kaputte darf den Start nicht aufhalten.
export function mergeLocation(existing: unknown, entry: DataLocation, platform: NodeJS.Platform = process.platform): LocationsFile {
  const key = (dir: string) => (platform === 'win32' || platform === 'darwin' ? dir.toLowerCase() : dir)
  const old = existing && typeof existing === 'object' && !Array.isArray(existing) && (existing as { version?: unknown }).version === 1
    ? (existing as { locations?: unknown }).locations
    : []
  const kept = (Array.isArray(old) ? old : []).filter(isLocation).filter((l) => key(l.dataDir) !== key(entry.dataDir))
  const locations = [entry, ...kept].sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : a.lastSeen > b.lastSeen ? -1 : 0))
  return { version: 1, locations: locations.slice(0, MAX_LOCATIONS) }
}

// Schreibt über eine Zwischendatei und Umbenennen, damit ein Abbruch keine halbe Datei hinterlässt. Jeder Fehler wird
// nur gemeldet: Ohne den Hinweis bietet das spätere Programm die Suche und „Ordner wählen …“ an. Bewusst einfach, weil
// es nur ein Hinweis ist: ohne fsync (nach einem Absturz kann die Liste leer sein, der nächste Start füllt sie) und
// ohne Sperre (starten zwei Programmdateien zugleich, kann ein Eintrag bis zum nächsten Start fehlen).
export function recordDataLocation(file: string, entry: DataLocation, warn: (message: string) => void = console.warn): void {
  try {
    let existing: unknown = null
    try {
      existing = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      existing = null
    }
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    try {
      fs.writeFileSync(tmp, `${JSON.stringify(mergeLocation(existing, entry), null, 2)}\n`)
      fs.renameSync(tmp, file)
    } finally {
      fs.rmSync(tmp, { force: true })
    }
  } catch (err) {
    warn(`Den Ort des Datenordners konnte Mietfuchs nicht vermerken (${err instanceof Error ? err.message : String(err)}).`)
  }
}

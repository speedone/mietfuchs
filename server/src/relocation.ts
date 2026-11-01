// Umzug der Daten ins Programmfenster (#517, Schritte 2 bis 4). Das Fenster hält die Daten im Benutzerordner; die
// bisherige Programmdatei hatte sie in `data/` neben sich, oft im Download-Ordner oder auf dem Schreibtisch. Hier steht,
// was sich ohne Server prüfen lässt: wo gesucht wird, was ein Fund ist, wie er beschrieben wird, der Vermerk im alten
// Ordner, die Entscheidung im neuen und der Vergleich der Kopie mit dem Original. Das Kopieren selbst geht in index.ts
// über das Wiederherstellen (eine Kopie des Ordners ist dort ein Backup, das schon ausgepackt ist).
//
// **Plattform, Heimatordner und Umgebung kommen immer hinein** (CLAUDE.md, Konventionen): Die Tests prüfen die Wege
// unter Windows und macOS auf jedem Rechner, und keiner liest den echten Benutzerordner.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { connect } from './db/client.ts'
import { DB_FILE_NAME } from './db/open.ts'
import { hasStock } from './dataLocations.ts'

export const MOVED_MARKER = 'umgezogen.json'
export const MOVED_NOTE = 'UMGEZOGEN.txt'
export const DECISION_FILE = 'umzug.json'

const pathOf = (platform: NodeJS.Platform) => (platform === 'win32' ? path.win32 : path.posix)

// Der Heimatordner, unter dem gesucht wird. **Im Test nur `NKA_TEST_HOME`, mit `CI` sonst keiner**: Jeder Test und jede
// Prüfung setzt CI (CLAUDE.md), und eine Suche im echten Benutzerordner des Entwicklers fände dessen Bestand.
export function relocationHome(env: NodeJS.ProcessEnv, home: () => string): string | null {
  if (env.NKA_TEST_HOME) return env.NKA_TEST_HOME
  if (env.CI) return null
  try {
    return home() || null
  } catch {
    return null
  }
}

// Wo die Programmdatei meist lag: Downloads, Schreibtisch, Dokumente. Unter Windows lenkt OneDrive Schreibtisch und
// Dokumente oft in seinen Ordner um; auf der Platte heißen sie dort „Desktop“ und „Documents“, bei manchen deutschen
// Einrichtungen „Dokumente“.
// `given`: die echten Orte, die das Fenster über `app.getPath` nennt (NKA_SEARCH_DIRS); sie gehen vor, denn unter
// Windows lenkt OneDrive sie oft in Ordner wie „OneDrive - Firma\Schreibtisch“ um, die sich nicht ableiten lassen.
export function searchRoots({ platform, home, given = [] }: { platform: NodeJS.Platform, home: string | null, given?: readonly string[] }): string[] {
  const p = pathOf(platform)
  const derived = home ? ['Downloads', 'Desktop', 'Documents'].map((name) => p.join(home, name)) : []
  if (home && platform === 'win32') derived.push(...['Desktop', 'Documents', 'Dokumente'].map((name) => p.join(home, 'OneDrive', name)))
  const roots: string[] = []
  for (const dir of [...given, ...derived]) if (!roots.some((r) => samePath(r, dir, platform))) roots.push(dir)
  return roots
}

// Die Orte des Fensters aus NKA_SEARCH_DIRS (eine JSON-Liste, damit kein Trennzeichen in einem Pfad stört).
export function searchDirsFromEnv(env: NodeJS.ProcessEnv): string[] {
  try {
    const raw: unknown = JSON.parse(env.NKA_SEARCH_DIRS ?? '[]')
    return Array.isArray(raw) ? raw.filter((d): d is string => typeof d === 'string' && d !== '') : []
  } catch {
    return []
  }
}

// Feste Orte, an denen eine Programmdatei ihre Daten hatte, wenn sie neben sich nicht schreiben durfte (`userDataHome`
// in store.ts). Auf dem Mac ist das `~/Library/Application Support/Mietfuchs`, der Ordner des Fensters selbst; dort
// gibt es nichts umzuziehen. Unter Windows `%LOCALAPPDATA%\Mietfuchs`, das Fenster nimmt `%USERPROFILE%\Mietfuchs`.
export function fixedPlaces({ platform, home, env }: { platform: NodeJS.Platform, home: string | null, env: NodeJS.ProcessEnv }): string[] {
  if (platform !== 'win32' || !home) return []
  const local = env.LOCALAPPDATA && path.win32.isAbsolute(env.LOCALAPPDATA) ? env.LOCALAPPDATA : path.win32.join(home, 'AppData', 'Local')
  return [path.win32.join(local, 'Mietfuchs')]
}

// Woran die Programmdatei zu erkennen ist: `mietfuchs-win.exe` (auch umbenannt, „(1)“ vom zweiten Herunterladen),
// `mietfuchs-macos-apple-silicon` und `-intel`. Linux nur für den Praxislauf (scripts/fenster-umzug-praxislauf.mjs).
export function programFilePattern(platform: NodeJS.Platform): RegExp {
  if (platform === 'win32') return /^mietfuchs.*\.exe$/i
  if (platform === 'darwin') return /^mietfuchs-macos-(?!.*\.zip$)/i
  return /^mietfuchs-linux(?!.*\.tar\.gz$)/
}

// Derselbe Ordner? Unter Windows und macOS unterscheidet das Dateisystem nicht nach Groß- und Kleinschreibung.
export function samePath(a: string, b: string, platform: NodeJS.Platform): boolean {
  const p = pathOf(platform)
  const norm = (dir: string) => {
    const resolved = p.resolve(dir)
    const trimmed = resolved.length > 1 ? resolved.replace(/[\\/]+$/, '') : resolved
    return platform === 'win32' || platform === 'darwin' ? trimmed.toLowerCase() : trimmed
  }
  return norm(a) === norm(b)
}

export type SearchLimits = { maxDepth: number, deadlineMs: number, maxEntries: number }
// Drei Ebenen unter einem Suchort genügen für „entpackt in einen Ordner im Download-Ordner“ samt einem Unterordner
// dazwischen. Vier Sekunden und 20.000 Einträge, damit ein voller Download-Ordner oder ein langsamer Datenträger den
// Bildschirm nicht aufhält; dann sagt die Oberfläche, dass die Suche nicht alles gesehen hat, und bietet die Wahl
// des Ordners an.
const DEFAULT_LIMITS: SearchLimits = { maxDepth: 3, deadlineMs: 4000, maxEntries: 20_000 }
// Ordner, in denen keine Programmdatei liegt und die groß sein können
const SKIPPED_DIRS = new Set(['node_modules', 'AppData', 'Library', '$RECYCLE.BIN', 'System Volume Information'])

// Sucht Ordner `data` mit Bestand neben einer Programmdatei. **Folgt keinem Verweis** (Symlink, unter Windows auch
// Verzeichnisverbindung: beide meldet `Dirent` nicht als Ordner), damit die Suche nicht im Kreis läuft und nicht auf
// Netzlaufwerke gerät. Ein Suchort, den es nicht gibt oder der sich nicht lesen lässt, ist kein Fehler.
export async function searchProgramFolders(roots: readonly string[], options: {
  platform: NodeJS.Platform
  limits?: Partial<SearchLimits>
  now?: () => number
}): Promise<{ folders: string[], complete: boolean }> {
  const limits = { ...DEFAULT_LIMITS, ...options.limits }
  const now = options.now ?? Date.now
  const deadline = now() + limits.deadlineMs
  const program = programFilePattern(options.platform)
  const folders: string[] = []
  let entries = 0
  let complete = true
  const queue: { dir: string, depth: number }[] = roots.map((dir) => ({ dir, depth: 0 }))
  while (queue.length > 0) {
    if (now() > deadline || entries > limits.maxEntries) {
      complete = false
      break
    }
    const { dir, depth } = queue.shift() as { dir: string, depth: number }
    let list: fs.Dirent[]
    try {
      list = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    entries += list.length
    // Auch ein Verweis auf die Programmdatei zählt (unter Windows etwa ein Platzhalter von OneDrive, Durchsicht D3)
    const hasProgram = list.some((e) => (e.isFile() || e.isSymbolicLink()) && program.test(e.name))
    const dataEntry = list.find((e) => e.isDirectory() && e.name === 'data')
    if (hasProgram && dataEntry && hasStock(path.join(dir, 'data'))) folders.push(path.join(dir, 'data'))
    if (depth >= limits.maxDepth) continue
    for (const e of list) {
      if (!e.isDirectory() || e.name.startsWith('.') || SKIPPED_DIRS.has(e.name) || e.name === 'data') continue
      queue.push({ dir: path.join(dir, e.name), depth: depth + 1 })
    }
  }
  return { folders, complete }
}

// „Ordner der alten Programmdatei wählen …“: gewählt ist meist der Ordner der Programmdatei, manchmal gleich `data`.
export function folderFromChoice(chosen: string): string | null {
  const beside = path.join(chosen, 'data')
  if (hasStock(beside)) return beside
  return hasStock(chosen) ? chosen : null
}

// Was jemand bei „Ordner wählen …“ gewählt hat, nachsichtig gelesen: den Ordner der Programmdatei, `data`, die
// Programmdatei selbst, `mietfuchs.sqlite` oder `db.json` (dann deren Ordner), oder ein Backup (ZIP), das dann
// eingespielt wird. `null`: nichts davon.
export function classifyChoice(chosen: string, platform: NodeJS.Platform): { dataDir: string } | { backup: string } | null {
  let stat: fs.Stats
  try {
    stat = fs.statSync(chosen)
  } catch {
    return null
  }
  if (stat.isDirectory()) {
    const dataDir = folderFromChoice(chosen)
    return dataDir ? { dataDir } : null
  }
  if (!stat.isFile()) return null
  const name = path.basename(chosen)
  if (/\.zip$/i.test(name)) return { backup: chosen }
  const dir = path.dirname(chosen)
  if (/^(mietfuchs\.sqlite|db\.json)$/i.test(name)) return hasStock(dir) ? { dataDir: dir } : null
  if (programFilePattern(platform).test(name)) {
    const dataDir = folderFromChoice(dir)
    return dataDir ? { dataDir } : null
  }
  return null
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

// Die Orte aus der Ortsdatei (dataLocations.ts), die noch einen Bestand haben, ohne Vermerk und ohne den eigenen Ordner,
// der zuletzt benutzte zuerst (so steht die Datei schon). Die Datei ist nur ein Hinweis; eine kaputte ergibt nichts.
export function rememberedFolders(file: unknown, { ownDir, platform }: { ownDir: string, platform: NodeJS.Platform }): { dataDir: string, appVersion: string }[] {
  if (!isObject(file) || file.version !== 1 || !Array.isArray(file.locations)) return []
  const out: { dataDir: string, appVersion: string }[] = []
  for (const entry of file.locations) {
    if (!isObject(entry) || typeof entry.dataDir !== 'string' || !entry.dataDir) continue
    const dataDir = entry.dataDir
    if (samePath(dataDir, ownDir, platform) || out.some((o) => samePath(o.dataDir, dataDir, platform))) continue
    if (!hasStock(dataDir) || readMovedMarker(dataDir)) continue
    out.push({ dataDir, appVersion: typeof entry.appVersion === 'string' ? entry.appVersion : '' })
  }
  return out
}

export type StockKind = 'database' | 'json'

// Die Zahl der Zeilen einer Tabelle, oder null, wenn es sie nicht gibt.
function countOf(rows: (sql: string) => unknown[][], table: string): number | null {
  try {
    const value = rows(`SELECT count(*) FROM "${table}"`)[0]?.[0]
    return typeof value === 'number' || typeof value === 'bigint' ? Number(value) : null
  } catch {
    return null
  }
}

type DatabaseLook = { stock: boolean, properties: number | null, tenancies: number | null, costItems: number | null }

// Liest eine Datenbank einer früheren Fassung **nur lesend** (`readOnly`): nichts daran ändert sich, auch keine
// Dateizeit. Die Tabellen gibt es seit dem ersten Schritt (0000), Objekte seit 0001; davor ist es ein Objekt.
async function lookIntoDatabase(file: string): Promise<DatabaseLook | null> {
  // Mit liegengebliebenem Journal (das alte Mietfuchs endete mitten im Speichern) lässt sich die Datei nur lesend nicht
  // öffnen: SQLite müsste zurückrollen. Dann eine Kopie samt Journal lesen, das Original bleibt, wie es ist (Durchsicht D2).
  if (fs.existsSync(`${file}-journal`)) {
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-blick-'))
    try {
      fs.copyFileSync(file, path.join(copy, DB_FILE_NAME))
      fs.copyFileSync(`${file}-journal`, path.join(copy, `${DB_FILE_NAME}-journal`))
      return await readLook(path.join(copy, DB_FILE_NAME), false)
    } catch {
      return null
    } finally {
      fs.rmSync(copy, { recursive: true, force: true })
    }
  }
  return readLook(file, true)
}

async function readLook(file: string, readOnly: boolean): Promise<DatabaseLook | null> {
  let connection
  try {
    connection = await connect(file, { readOnly })
  } catch {
    return null
  }
  try {
    const tenancies = countOf(connection.rows, 'tenancies')
    const costItems = countOf(connection.rows, 'cost_items')
    if (tenancies === null || costItems === null) return null
    const stock = [countOf(connection.rows, 'units'), tenancies, countOf(connection.rows, 'meters'), costItems].some((n) => (n ?? 0) > 0)
    const properties = countOf(connection.rows, 'properties') ?? (stock ? 1 : 0)
    return { stock, properties, tenancies, costItems }
  } finally {
    connection.close()
  }
}

type JsonLook = { tenancies: number, costItems: number }
function lookIntoJson(file: string): JsonLook | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!isObject(parsed)) return null
    const length = (v: unknown) => (Array.isArray(v) ? v.length : 0)
    return { tenancies: length(parsed.tenancies), costItems: length(parsed.costItems) }
  } catch {
    return null
  }
}

// Was der Umzug übernimmt, entschieden wie beim Start einer neuen Version im alten Ordner (Umstieg, db/changeover.ts):
// Trägt die Datenbank keinen Bestand (oder lässt sie sich nicht lesen) und liegt eine db.json daneben, gilt die
// db.json; sonst die Datenbank, auch neben einer liegengebliebenen db.json (#89, `stale`). `null`: kein Bestand.
export async function stockKind(dataDir: string): Promise<StockKind | null> {
  const dbFile = path.join(dataDir, DB_FILE_NAME)
  const jsonFile = path.join(dataDir, 'db.json')
  const hasJson = fs.existsSync(jsonFile)
  if (!fs.existsSync(dbFile)) return hasJson ? 'json' : null
  const look = await lookIntoDatabase(dbFile)
  if (look?.stock) return 'database'
  if (hasJson) return 'json'
  return look ? null : 'database'
}

export type CandidateInfo = {
  dataDir: string
  kind: StockKind | null
  // Zuletzt geändert: die jüngere der beiden Dateien des Bestands (ISO), wenn lesbar
  modifiedAt: string | null
  properties: number | null
  tenancies: number | null
}

const mtimeOf = (file: string): number | null => {
  try {
    return fs.statSync(file).mtime.getTime()
  } catch {
    return null
  }
}

export async function describeCandidate(dataDir: string): Promise<CandidateInfo> {
  const kind = await stockKind(dataDir)
  const times = [DB_FILE_NAME, 'db.json'].map((name) => mtimeOf(path.join(dataDir, name))).filter((t): t is number => t !== null)
  const modifiedAt = times.length > 0 ? new Date(Math.max(...times)).toISOString() : null
  let properties: number | null = null
  let tenancies: number | null = null
  if (kind === 'database') {
    const look = await lookIntoDatabase(path.join(dataDir, DB_FILE_NAME))
    properties = look?.properties ?? null
    tenancies = look?.tenancies ?? null
  } else if (kind === 'json') {
    const look = lookIntoJson(path.join(dataDir, 'db.json'))
    // Die db.json kannte nur ein Haus
    properties = look ? 1 : null
    tenancies = look?.tenancies ?? null
  }
  return { dataDir, kind, modifiedAt, properties, tenancies }
}

// Mietverhältnisse und Kostenpositionen des Originals, für den Vergleich nach dem Kopieren.
export async function originalCounts(dataDir: string, kind: StockKind): Promise<{ tenancies: number, costItems: number } | null> {
  if (kind === 'json') return lookIntoJson(path.join(dataDir, 'db.json'))
  const look = await lookIntoDatabase(path.join(dataDir, DB_FILE_NAME))
  return look && look.tenancies !== null && look.costItems !== null ? { tenancies: look.tenancies, costItems: look.costItems } : null
}

export type Counts = { tenancies: number, costItems: number }
export type FileSize = { name: string, size: number }

// Ist die Kopie vollständig? `null` heißt ja, sonst ein Satz für die Meldung. Verglichen werden Mietverhältnisse,
// Kostenpositionen und die Belege mit ihrer Größe.
export function copyMismatch(original: { counts: Counts, files: readonly FileSize[] }, copy: { counts: Counts, files: readonly FileSize[] }): string | null {
  const problems: string[] = []
  if (original.counts.tenancies !== copy.counts.tenancies) problems.push(`Mietverhältnisse: ${original.counts.tenancies} im Original, ${copy.counts.tenancies} in der Kopie.`)
  if (original.counts.costItems !== copy.counts.costItems) problems.push(`Kostenpositionen: ${original.counts.costItems} im Original, ${copy.counts.costItems} in der Kopie.`)
  const copied = new Map(copy.files.map((f) => [f.name, f.size]))
  for (const file of original.files) {
    const size = copied.get(file.name)
    if (size === undefined) problems.push(`Der Beleg „${file.name}“ fehlt in der Kopie.`)
    else if (size !== file.size) problems.push(`Der Beleg „${file.name}“ ist in der Kopie ${size} statt ${file.size} Byte groß.`)
  }
  if (copy.files.length > original.files.length) problems.push(`In der Kopie liegen ${copy.files.length} Belege, im Original ${original.files.length}.`)
  return problems.length > 0 ? problems.slice(0, 5).join(' ') : null
}

// ---------- Vermerk im alten Ordner ----------

export type MovedMarker = { version: 1, movedTo: string, at: string, appVersion: string }

export function readMovedMarker(dataDir: string): MovedMarker | null {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(path.join(dataDir, MOVED_MARKER), 'utf8'))
    if (!isObject(raw) || raw.version !== 1 || typeof raw.movedTo !== 'string' || typeof raw.at !== 'string') return null
    return { version: 1, movedTo: raw.movedTo, at: raw.at, appVersion: typeof raw.appVersion === 'string' ? raw.appVersion : '' }
  } catch {
    return null
  }
}

// Ein Datum für Menschen, unabhängig von der Sprache des Rechners (wie `germanDate` in db/open.ts).
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
export function movedDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getUTCDate()}. ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

export function movedNoteText(marker: MovedMarker): string {
  return [
    'Ihre Mietfuchs-Daten sind umgezogen.',
    '',
    `Am ${movedDate(marker.at)} hat das neue Mietfuchs mit eigenem Programmfenster die Daten aus diesem Ordner übernommen.`,
    'Sie liegen jetzt hier:',
    '',
    `    ${marker.movedTo}`,
    '',
    'Arbeiten Sie bitte nur noch mit dem neuen Mietfuchs. Eine aktuelle Programmdatei zeigt die Daten in diesem Ordner',
    'nur noch an und nimmt keine Änderungen mehr an. Ältere Fassungen kennen diesen Vermerk nicht: Was Sie dort',
    'ändern, fehlt im neuen Mietfuchs.',
    '',
    'Dieser Ordner bleibt als Kopie liegen. Löschen Sie ihn erst, wenn im neuen Mietfuchs alles da ist.',
    '',
  ].join('\n')
}

// Was eine aktuelle Fassung in einem umgezogenen Ordner auf jede Änderung antwortet und in der Oberfläche sagt.
export function movedAwayMessage(marker: MovedMarker): string {
  return `Ihre Daten sind ins neue Mietfuchs umgezogen (am ${movedDate(marker.at)} nach ${marker.movedTo}). ` +
    'Hier können Sie sie nur noch ansehen; ändern Sie sie bitte im neuen Mietfuchs.'
}

// Über Zwischendatei und Umbenennen, damit kein halber Vermerk entsteht. Wirft bei einem Fehler (der Aufrufer meldet ihn).
export function writeMovedMarker(dataDir: string, marker: MovedMarker): void {
  writeAtomically(path.join(dataDir, MOVED_NOTE), movedNoteText(marker))
  writeAtomically(path.join(dataDir, MOVED_MARKER), `${JSON.stringify(marker, null, 2)}\n`)
}

function writeAtomically(file: string, content: string): void {
  const tmp = `${file}.${process.pid}.tmp`
  try {
    fs.writeFileSync(tmp, content)
    fs.renameSync(tmp, file)
  } finally {
    fs.rmSync(tmp, { force: true })
  }
}

// ---------- Entscheidung im neuen Ordner ----------

// `source`: Art und Fingerabdruck des übernommenen Bestands, um spätere Änderungen im alten Ordner zu erkennen
export type RelocationDecision = { version: 1, decision: 'moved' | 'fresh', at: string, from?: string, source?: { kind: StockKind, fingerprint: string } }

export function readDecision(dataDir: string): RelocationDecision | null {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(path.join(dataDir, DECISION_FILE), 'utf8'))
    if (!isObject(raw) || raw.version !== 1 || (raw.decision !== 'moved' && raw.decision !== 'fresh') || typeof raw.at !== 'string') return null
    const source = isObject(raw.source) && (raw.source.kind === 'database' || raw.source.kind === 'json') && typeof raw.source.fingerprint === 'string'
      ? { source: { kind: raw.source.kind as StockKind, fingerprint: raw.source.fingerprint } }
      : {}
    return { version: 1, decision: raw.decision, at: raw.at, ...(typeof raw.from === 'string' ? { from: raw.from } : {}), ...source }
  } catch {
    return null
  }
}

export function writeDecision(dataDir: string, decision: RelocationDecision): void {
  fs.mkdirSync(dataDir, { recursive: true })
  writeAtomically(path.join(dataDir, DECISION_FILE), `${JSON.stringify(decision, null, 2)}\n`)
}

// ---------- Läuft das alte Mietfuchs noch? ----------

// Aus der Antwort von /healthz der alten Fassung auf Port 3001: Ab 0.8 nennt sie ihre Datenbank (`database.file`),
// davor nur sich selbst. Dann ist der Ordner unbekannt.
export function liveDataDir(health: unknown, platform: NodeJS.Platform): { running: boolean, dataDir: string | null } {
  if (!isObject(health) || health.app !== 'mietfuchs') return { running: false, dataDir: null }
  const file = isObject(health.database) && typeof health.database.file === 'string' ? health.database.file : null
  return { running: true, dataDir: file ? pathOf(platform).dirname(file) : null }
}

// Bis 0.3 gab es kein /healthz. Ein Mietfuchs dieser Zeit erkennt man an der Antwort von /api/settings: ein Objekt mit
// den Feldern, die es schon damals hatte.
export function earlyMietfuchs(settings: unknown): boolean {
  return isObject(settings) && typeof settings.landlordName === 'string' && typeof settings.paymentDeadlineDays === 'number'
}

// Gehört das laufende alte Mietfuchs zu diesem Fund? Nennt es seinen Ordner nicht, vorsichtshalber ja: Es zu beenden
// schadet nicht, eine Kopie unter einem schreibenden Programm schon.
export function runningFor(dataDir: string, live: { running: boolean, dataDir: string | null }, platform: NodeJS.Platform): boolean {
  if (!live.running) return false
  return live.dataDir === null || samePath(live.dataDir, dataDir, platform)
}

// Was beim Kopieren schiefging, in Worten für die Oberfläche (Durchsicht D12). Endet immer mit der Zusage, dass im alten
// Ordner nichts verändert ist, und nur einmal.
export const ADOPT_UNCHANGED = 'Es wurde nichts übernommen; Ihre bisherigen Daten im alten Ordner sind unverändert, und Sie können dort weiterarbeiten.'
export function copyErrorText(err: unknown): string {
  const code = isObject(err) && typeof err.code === 'string' ? err.code : null
  if (code === 'ENOSPC' || code === 'EDQUOT') return `Auf dem Datenträger ist nicht genug Platz für die Kopie. Bitte schaffen Sie Platz und versuchen Sie es dann noch einmal. ${ADOPT_UNCHANGED}`
  if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
    return `Eine Datei ließ sich nicht kopieren, weil ein anderes Programm sie gerade benutzt, etwa ein Virenscanner oder das alte Mietfuchs. Bitte warten Sie einen Moment und versuchen Sie es dann noch einmal. ${ADOPT_UNCHANGED}`
  }
  const message = err instanceof Error ? err.message : String(err)
  return `Die Daten ließen sich nicht kopieren (${message}). ${ADOPT_UNCHANGED}`
}

// ---------- Später im alten Mietfuchs geändert? ----------

// Ein Fingerabdruck des Inhalts (#517): Alte Fassungen kennen den Vermerk nicht, und mancher startet die angeheftete
// Programmdatei weiter. Verglichen wird der Inhalt, nicht die Dateizeit: Schon der Start einer Fassung schreibt eine
// Probe in die Datei. Das Journal selbst zählt nur mit seiner jüngsten Gruppe, denn sein Aufräumen ändert nichts am
// Bestand. `null`: nicht lesbar.
const SKIPPED_TABLES = new Set(['__drizzle_migrations', 'change_log', 'change_groups'])
export async function stockFingerprint(dataDir: string, kind: StockKind): Promise<string | null> {
  if (kind === 'json') {
    try {
      return crypto.createHash('sha256').update(fs.readFileSync(path.join(dataDir, 'db.json'))).digest('hex')
    } catch {
      return null
    }
  }
  return withDatabase(path.join(dataDir, DB_FILE_NAME), (rows) => {
    const hash = crypto.createHash('sha256')
    const value = (_key: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v instanceof Uint8Array ? Buffer.from(v).toString('hex') : v)
    const tables = rows("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((r) => String(r[0]))
    for (const table of tables.filter((t) => !SKIPPED_TABLES.has(t))) {
      hash.update(`${table}\n`)
      for (const row of rows(`SELECT * FROM "${table}" ORDER BY rowid`)) hash.update(`${JSON.stringify(row, value)}\n`)
    }
    if (tables.includes('change_groups')) hash.update(`journal:${JSON.stringify(rows('SELECT max(id) FROM change_groups'), value)}`)
    return hash.digest('hex')
  })
}

// Eine Datenbank einer früheren Fassung lesen, ohne sie zu ändern: nur lesend, mit liegengebliebenem Journal als Kopie.
async function withDatabase<T>(file: string, work: (rows: (sql: string) => unknown[][]) => T): Promise<T | null> {
  const run = async (target: string, readOnly: boolean) => {
    const connection = await connect(target, { readOnly })
    try {
      return work(connection.rows)
    } finally {
      connection.close()
    }
  }
  try {
    if (!fs.existsSync(`${file}-journal`)) return await run(file, true)
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-blick-'))
    try {
      fs.copyFileSync(file, path.join(copy, DB_FILE_NAME))
      fs.copyFileSync(`${file}-journal`, path.join(copy, `${DB_FILE_NAME}-journal`))
      return await run(path.join(copy, DB_FILE_NAME), false)
    } finally {
      fs.rmSync(copy, { recursive: true, force: true })
    }
  } catch {
    return null
  }
}

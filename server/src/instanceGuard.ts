// Zwei Mietfuchs auf demselben Datenordner (#517, Durchsicht M2). Der Port sperrt nur gegen einen zweiten Start auf
// demselben Port (#244). Seit es das Programmfenster gibt, laufen zwei Fassungen auf verschiedenen Ports: das Fenster auf
// 17517, die Programmdatei und der Store bis 0.14 auf 3001. Beide können denselben Ordner nehmen, auf dem Mac
// `~/Library/Application Support/Mietfuchs` (Programmdatei unter /Applications und Fenster), unter Windows
// `%USERPROFILE%\Mietfuchs` (Store 0.14 und Fenster). Spielt der eine dann ein Backup ein, benennt er die Datei um, und der
// andere schreibt ins Leere.
//
// **Erkannt wird über die Antwort des anderen, nicht über eine Datei allein.** Die Lauf-Datei im Datenordner nennt den
// Port des laufenden Mietfuchs, sie gilt aber nur, wenn dort `/healthz` mit `app: 'mietfuchs'` und demselben Datenordner
// antwortet; eine Datei, die ein Absturz hat liegen lassen, verhindert so keinen Start. Zusätzlich werden die
// Standardports abgefragt, denn Fassungen vor 0.15 schreiben keine Lauf-Datei; ihr `/healthz` nennt ab 0.8 den Pfad der
// Datenbank (`database.file`), dagegen wird verglichen. Fassungen davor nennen nichts und bleiben unerkannt.
//
// **Nie den Start eines einzelnen Mietfuchs verhindern**: Jede Frage, die nicht klar „derselbe Ordner“ ergibt (keine
// Antwort, fremdes Programm, anderer Ordner, umgezogener Ordner, Lesefehler der Lauf-Datei), zählt als frei.
//
// **Zwei gleichzeitige Starts** auf verschiedenen Ports: Beide haben ihren Port schon gebunden und antworten während des
// Startens mit `status: 'starting'`, samt Datenordner und Zeitpunkt des Bindens (`boundAt`). Wer später gebunden hat,
// sieht den anderen sicher (der war schon gebunden, als er fragte) und weicht; wer früher gebunden hat, sieht den anderen
// vielleicht nicht, und falls doch, weicht nach derselben Regel der andere. So bleibt genau einer.
//
// **Schweigt der Port aus der Lauf-Datei, wird nachgefragt** (#694): Wer zuerst gebunden hat, fragt, schreibt seine
// Lauf-Datei und öffnet die Datenbank; die Migrationen halten seine Ereignisschleife an, bei einem frischen Ordner oder
// nach einem Update auf einem langsamen Rechner länger als eine Frage dauert. Der Port nimmt die Verbindung dann an und
// antwortet nicht. Das als „kein Mietfuchs“ zu werten ließ beide laufen (unter Last nachgestellt: die erste Frage traf
// auf einen noch nicht gebundenen Port, die des zweiten lief nach 1,5 Sekunden ab). Eine Lauf-Datei in diesem Ordner
// samt einem Port, der Verbindungen annimmt, ist aber ein starkes Zeichen; dort wird bis `SILENT_WAIT_MS` erneut
// gefragt. Ein Port, der die Verbindung ablehnt (Datei nach einem Absturz), entscheidet weiter sofort, und ein
// Standardport ohne Lauf-Datei wird weiter nur einmal gefragt, sonst wartete jeder Start, wenn dort etwas schweigt.
import fs from 'node:fs'
import path from 'node:path'
import { asBrowserId } from './browser.ts'
import type { BrowserId } from '../../shared/types.ts'

export const RUN_FILE = 'mietfuchs.laeuft.json'
// Die Standardports: Programmdatei, Store bis 0.14 und Docker auf 3001, das Fenster auf 17517
export const DEFAULT_PORTS: readonly number[] = [3001, 17517]

export type RunFile = { version: 1, port: number, pid: number, startedAt: string, appVersion: string }

// Wer dieser Start ist, für die Antwort von /healthz und den Vergleich zweier gleichzeitiger Starts
export type Self = { dataDir: string, port: number, pid: number, boundAt: number }

// `openWith`: der Browser aus den Einstellungen des anderen (#735), damit ein zweiter Start dieselbe Wahl nimmt
export type Twin = { port: number, url: string, version: string | null, openWith: BrowserId | null }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

export function readRunFile(dataDir: string): RunFile | null {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(path.join(dataDir, RUN_FILE), 'utf8'))
    if (!isObject(raw) || !Number.isInteger(raw.port) || !Number.isInteger(raw.pid)) return null
    return { version: 1, port: Number(raw.port), pid: Number(raw.pid), startedAt: String(raw.startedAt ?? ''), appVersion: String(raw.appVersion ?? '') }
  } catch {
    return null
  }
}

// Über Zwischendatei und Umbenennen. Ergibt false statt zu werfen: Ein Ordner ohne Schreibrecht hält keinen Start auf,
// das meldet die Datenbank ohnehin selbst.
export function writeRunFile(dataDir: string, run: RunFile): boolean {
  const file = path.join(dataDir, RUN_FILE)
  const tmp = `${file}.${process.pid}.tmp`
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(run, null, 2)}\n`)
    fs.renameSync(tmp, file)
    return true
  } catch {
    try {
      fs.rmSync(tmp, { force: true })
    } catch { /* bleibt liegen */ }
    return false
  }
}

// Nur die eigene: Hat inzwischen ein anderer Start sie geschrieben (etwa nach einem Absturz dieses), bleibt sie.
export function removeRunFile(dataDir: string, pid: number): void {
  try {
    if (readRunFile(dataDir)?.pid === pid) fs.rmSync(path.join(dataDir, RUN_FILE), { force: true })
  } catch { /* dann beim nächsten Mal; sie gilt ohnehin nur mit Antwort */ }
}

// Derselbe Ordner? Unter Windows und macOS ohne Groß/Klein; ein Verweis zählt mit seinem Ziel, wo es ihn gibt.
export function sameDir(a: string, b: string, platform: NodeJS.Platform): boolean {
  const p = platform === 'win32' ? path.win32 : path.posix
  const real = (dir: string) => {
    try {
      return fs.realpathSync.native(dir)
    } catch {
      return dir
    }
  }
  const norm = (dir: string) => {
    const resolved = p.resolve(real(dir))
    const trimmed = resolved.length > 1 ? resolved.replace(/[\\/]+$/, '') : resolved
    return platform === 'win32' || platform === 'darwin' ? trimmed.toLowerCase() : trimmed
  }
  return norm(a) === norm(b)
}

// Welcher Datenordner aus einer Antwort von /healthz: ab 0.15 `dataDir`, davor der Ordner von `database.file` (ab 0.8).
// `null`: nicht Mietfuchs, umgezogen (der liest nur), oder der Ordner bleibt unbekannt.
export function reportedDataDir(health: unknown, platform: NodeJS.Platform): string | null {
  if (!isObject(health) || health.app !== 'mietfuchs' || health.moved) return null
  if (typeof health.dataDir === 'string' && health.dataDir) return health.dataDir
  const file = isObject(health.database) && typeof health.database.file === 'string' ? health.database.file : null
  return file ? (platform === 'win32' ? path.win32 : path.posix).dirname(file) : null
}

// Weicht dieser Start einem anderen, der ebenfalls gerade startet? Wer später gebunden hat; bei gleicher Zeit entscheiden
// Prozessnummer und Port, damit beide Seiten zum selben Ergebnis kommen.
export function yieldsTo(self: Self, other: { boundAt: number, pid: number, port: number }): boolean {
  if (other.boundAt !== self.boundAt) return other.boundAt < self.boundAt
  if (other.pid !== self.pid) return other.pid < self.pid
  return other.port < self.port
}

type Fetch = (url: string) => Promise<unknown>

// Wie lange auf den Port aus der Lauf-Datei gewartet wird, wenn er Verbindungen annimmt und nicht antwortet
export const SILENT_WAIT_MS = 30_000

// Die Frage lief ab, ohne dass der Port antwortete (im Unterschied zu einer abgelehnten Verbindung)
const isSilence = (err: unknown): boolean => err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')

// Wie dieser Start beim Schweigen eines Ports Bescheid gibt: `onSilent` einmal je Port, sobald nachgefragt wird,
// `onGaveUp`, wenn der Port bis zum Ende schwieg (er zählt dann als frei)
type SilentHooks = { onSilent: (port: number) => void, onGaveUp: (port: number) => void }

// Antwortet Mietfuchs auf diesem Port, mit welchem Bericht? Mehrmals, solange es meldet, dass es noch startet und seinen
// Ordner nicht nennt (Fassungen vor 0.15), und solange ein Port schweigt, bei dem sich das Warten lohnt (`silentWaitMs`
// über 0: der Port aus der Lauf-Datei). `silentWaitMs` wird erst beim Schweigen gefragt, denn der andere kann seine
// Lauf-Datei geschrieben haben, nachdem dieser Start sie las. `settled`: Ein anderer Port hat den Zwilling schon
// ergeben, weiter zu fragen lohnt nicht. `null`: keine Antwort, kein Mietfuchs.
async function askPort(port: number, fetchJson: Fetch, startingWaitMs: number, pause: (ms: number) => Promise<void>, silentWaitMs: () => number, hooks: SilentHooks, settled: () => boolean): Promise<unknown> {
  const deadline = Date.now() + startingWaitMs
  const start = Date.now()
  let told = false
  for (;;) {
    let health: unknown
    try {
      health = await fetchJson(`http://127.0.0.1:${port}/healthz`)
    } catch (err) {
      if (!isSilence(err) || settled()) return null
      if (Date.now() >= start + silentWaitMs()) {
        if (told) hooks.onGaveUp(port)
        return null
      }
      if (!told) hooks.onSilent(port)
      told = true
      // Die abgelaufene Frage war selbst die Wartezeit, deshalb ohne Pause weiter
      continue
    }
    if (!isObject(health) || health.app !== 'mietfuchs') return null
    const waiting = health.status === 'starting' && typeof health.dataDir !== 'string'
    if (!waiting || Date.now() >= deadline || settled()) return health
    await pause(500)
  }
}

// Ergibt diese Antwort den Zwilling? Derselbe Ordner, und startet der andere gerade auch, weicht nur, wer später gebunden hat
function twinFrom(self: Self, port: number, health: unknown, platform: NodeJS.Platform): Twin | null {
  const dir = reportedDataDir(health, platform)
  if (!dir || !sameDir(dir, self.dataDir, platform) || !isObject(health)) return null
  if (health.status === 'starting' && typeof health.boundAt === 'number' && typeof health.pid === 'number') {
    if (!yieldsTo(self, { boundAt: health.boundAt, pid: health.pid, port })) return null
  }
  return { port, url: `http://127.0.0.1:${port}`, version: typeof health.version === 'string' ? health.version : null, openWith: asBrowserId(health.openWith) }
}

/**
 * Läuft auf diesem Datenordner schon ein Mietfuchs? Gefragt werden der Port aus der Lauf-Datei und die Standardports,
 * außer dem eigenen, alle zugleich. Ergibt den anderen, sobald ein Port ihn ergibt (ohne auf einen schweigenden zu
 * warten), sonst `null`, wenn alle geantwortet haben oder frei sind.
 */
export async function findTwin(self: Self, options: {
  platform: NodeJS.Platform
  ports?: readonly number[]
  fetchJson?: Fetch
  // Wie lange auf eine ältere Fassung gewartet wird, die noch startet und ihren Ordner noch nicht nennt
  startingWaitMs?: number
  // Wie lange der Port aus der Lauf-Datei schweigen darf, bevor er als frei zählt
  silentWaitMs?: number
  // Einmal je Port, sobald wegen seines Schweigens nachgefragt wird (für eine Zeile auf der Konsole)
  onSilent?: (port: number) => void
  // Wenn ein Port, auf den gewartet wurde, bis zum Ende schwieg
  onGaveUp?: (port: number) => void
  pause?: (ms: number) => Promise<void>
}): Promise<Twin | null> {
  const fetchJson: Fetch = options.fetchJson ?? (async (url) => (await fetch(url, { signal: AbortSignal.timeout(1500) })).json())
  const pause = options.pause ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const run = readRunFile(self.dataDir)
  const ports = [...new Set([...(run ? [run.port] : []), ...(options.ports ?? DEFAULT_PORTS)])].filter((p) => p !== self.port && p > 0)
  const hooks: SilentHooks = { onSilent: options.onSilent ?? (() => {}), onGaveUp: options.onGaveUp ?? (() => {}) }
  const silentWaitFor = (port: number) => () => port === readRunFile(self.dataDir)?.port ? options.silentWaitMs ?? SILENT_WAIT_MS : 0
  let found: Twin | null = null
  return new Promise((resolve, reject) => {
    let open = ports.length
    if (open === 0) return resolve(null)
    for (const port of ports) {
      askPort(port, fetchJson, options.startingWaitMs ?? 15_000, pause, silentWaitFor(port), hooks, () => found !== null).then((health) => {
        found = found ?? twinFrom(self, port, health, options.platform)
        open--
        if (found || open === 0) resolve(found)
      }, reject)
    }
  })
}

// Was der Nutzer liest. Im Fenster als Meldung (desktop/src/server.js erkennt sie am Anfang), sonst auf der Konsole.
export function twinMessage(twin: Twin, dataDir: string): string {
  return `Mietfuchs läuft bereits mit denselben Daten (${dataDir}, ${twin.url}, Port ${twin.port}). ` +
    'Bitte beenden Sie das andere Mietfuchs zuerst.'
}

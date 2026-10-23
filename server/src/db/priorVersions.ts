// Automatische Vorversionen der Datenbank (#318, Schritt 1).
//
// **Wogegen sie helfen.** Gegen einen Bedienfehler im laufenden Betrieb half bisher nichts von
// selbst: Wer eine Wohnung löscht, löscht über die Fremdschlüssel Mietverhältnisse, Zähler,
// Ablesungen und Zahlungen mit, und die Sicherung vor einem Update (`backupBeforeMigrating`) gibt
// es nur vor ausstehenden Migrationsschritten. Deshalb legt der Server von sich aus eine Kopie der
// Datenbank in `vorversionen/` im Datenordner an, höchstens eine je Woche, und behält die letzten
// vier.
//
// **Wie sie entstehen.** Mit `VACUUM INTO` durch die Schlange (`opened.write`), dieselbe Bauart
// wie der Schnappschuss fürs Backup (backup.ts): Eine Kopie der offenen Datei könnte einen Stand
// liefern, den es nie gab. Geschrieben wird erst unter einem Zwischennamen und dann umbenannt,
// damit die Liste nie eine halbe Datei zeigt.
//
// **Was sie nicht sind.** Kein Teil des Backup-ZIPs (es wüchse um das Vierfache der Datenbank) und
// kein Eintrag in den `checks` von /healthz (ein Fehler hier ist kein Grund, einen Container neu zu
// starten). Eingespielt werden sie über denselben Weg wie die Datenbank aus einem Backup (index.ts).
//
// Die Auswahl (fällig, was wegfällt, welche Namen gelten) sind reine Funktionen und haben eigene
// Tests (prior-versions.test.ts); nur `createPriorVersion` fasst Datei und Datenbank an.

import fs from 'node:fs'
import path from 'node:path'
import { count, sql } from 'drizzle-orm'
import { connect, type Database } from './client.ts'
import { integrityProblem, messageOf, type OpenedDatabase } from './open.ts'
import { replaceFile } from './changeover.ts'
import { CHANGEOVER_NOT_TAKEN, CHANGEOVER_PENDING, databaseUnavailable } from '../health.ts'
import type { DatabaseState } from '../../../shared/types.ts'
import { costItems, meters, tenancies, units } from './schema.ts'

export const PRIOR_DIR = 'vorversionen'
// Wie viele Vorversionen bleiben, und ab welchem Alter der jüngsten eine neue entsteht.
export const PRIOR_KEEP = 4
export const PRIOR_MAX_AGE_DAYS = 7
// Wie oft der laufende Server nachsieht. Einmal am Tag genügt: Fällig wird eine Vorversion erst
// nach sieben Tagen, und ein Server, der wochenlang läuft, bekommt sie so spätestens einen Tag zu spät.
export const PRIOR_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

const DAY_MS = 24 * 60 * 60 * 1000

// Der Name trägt den Zeitpunkt in UTC, Jahr vorn: So sortiert er sich als Text in der Zeitfolge,
// und der Zeitpunkt lässt sich aus ihm zurücklesen, ohne der Dateizeit zu trauen (die ein Kopieren
// des Datenordners verfälscht).
const NAME = /^vorversion-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})\.sqlite$/

export type PriorVersion = { name: string, createdAt: string, size: number }

export function priorVersionName(at: Date): string {
  const iso = at.toISOString() // 2026-10-23T08:15:00.000Z
  return `vorversion-${iso.slice(0, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}.sqlite`
}

// Der Zeitpunkt aus dem Namen, oder null, wenn der Name nicht von hier stammt. Das ist zugleich die
// Prüfung für einen Namen, der von außen kommt (die Route zum Einspielen): Nur was dieses Muster
// erfüllt und kein Pfad ist, wird überhaupt angefasst.
export function priorVersionTime(name: string): Date | null {
  if (path.basename(name) !== name) return null
  const m = NAME.exec(name)
  if (!m) return null
  const at = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])))
  // Ein Name wie „…-2026-02-31-…“ erfüllt das Muster, ist aber kein Zeitpunkt.
  return priorVersionName(at) === name ? at : null
}

// Die Vorversionen im Ordner, die jüngste zuerst. Andere Dateien (ein Zwischenstand, etwas, das
// jemand hineingelegt hat) zählen nicht. Fehlt der Ordner, gibt es keine.
export function listPriorVersions(dataDir: string): PriorVersion[] {
  const dir = path.join(dataDir, PRIOR_DIR)
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const list: PriorVersion[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const at = priorVersionTime(entry.name)
    if (!at) continue
    let size: number
    try {
      size = fs.statSync(path.join(dir, entry.name)).size
    } catch {
      continue // zwischen Lesen und Nachsehen verschwunden
    }
    list.push({ name: entry.name, createdAt: at.toISOString(), size })
  }
  return list.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0))
}

// Fällig ist eine neue, wenn es keine gibt oder die jüngste älter als die Frist ist. Eine jüngste
// „aus der Zukunft“ bis zu einem Tag gilt als frisch (eine Uhr, die etwas vorging, oder eine andere
// Zeitzone beim Kopieren des Ordners). Liegt sie mehr als einen Tag voraus, zählt sie nicht als
// jüngste (Durchsicht K3): Sonst hielte eine einzige Datei mit falschem Datum, etwa nach einem
// Zurückstellen der Uhr um ein Jahr, jede neue Vorversion für Monate auf.
export function priorVersionDue(list: readonly PriorVersion[], now: Date, maxAgeDays = PRIOR_MAX_AGE_DAYS): boolean {
  const newest = list.reduce<number | null>((max, v) => {
    const t = Date.parse(v.createdAt)
    if (t - now.getTime() > DAY_MS) return max
    return max === null || t > max ? t : max
  }, null)
  return newest === null || now.getTime() - newest > maxAgeDays * DAY_MS
}

// Darf jetzt eine Vorversion entstehen? Nur, wenn die Datenbank offen ist und den Bestand trägt
// (`databaseUnavailable`, health.ts) und kein Wiederherstellen läuft: Eine Vorversion der leeren
// Datenbank eines gescheiterten Umstiegs wäre keine.
export function mayCreatePriorVersion(state: DatabaseState, restoreRunning: boolean): boolean {
  return !restoreRunning && state.open && databaseUnavailable(state) === null
}

// Sind Liste und Einspielen gesperrt? **Nicht, wenn sich die Datenbank nicht öffnen lässt**
// (Durchsicht S1): Gerade dann ist eine Vorversion der Weg zurück, und `restoreDatabase` kommt ohne
// offene Datenbank aus. Gesperrt bleibt, wo die Daten noch in der db.json stehen (gescheiterter
// Umstieg, `stale` mit `pending`): Eine eingespielte Vorversion machte die Datenbank dann zum
// maßgeblichen Bestand und hängte die db.json ab, wie es health.ts verhindern soll.
export function priorVersionsBlocked(state: DatabaseState): string | null {
  if (state.changeover.state === 'failed') return CHANGEOVER_PENDING
  if (state.changeover.state === 'stale' && state.changeover.pending) return CHANGEOVER_NOT_TAKEN
  return null
}

// Was nach dem Anlegen wegfällt: alles über die Zahl der behaltenen hinaus, die ältesten zuerst.
export function priorVersionsToDrop(list: readonly PriorVersion[], keep = PRIOR_KEEP): string[] {
  return [...list].sort((a, b) => (a.name < b.name ? 1 : -1)).slice(keep).map((v) => v.name)
}

// Trägt die Datenbank einen Bestand? Eine frisch angelegte hat ein Objekt und Einstellungen, aber
// nichts, was eine Vorversion wert wäre; sie sicherte nur einen leeren Stand und verdrängte nach vier
// Wochen ohne Eingabe nichts, was zählt, wohl aber den Platz in der Liste.
export async function carriesStock(db: Database): Promise<boolean> {
  for (const table of [units, tenancies, meters, costItems]) {
    const [row] = await db.select({ n: count() }).from(table)
    if ((row?.n ?? 0) > 0) return true
  }
  return false
}

const TEMP_PREFIX = '.entsteht-'

export type PriorVersionOptions = {
  // Noch einmal gefragt, wenn die Schlange den Vorgang dran nimmt (Durchsicht K1): Zwischen der Prüfung
  // in index.ts und dem VACUUM kann ein Wiederherstellen begonnen haben.
  skip?: () => boolean
  // Nur für Tests: läuft mit der fertigen Zwischendatei, bevor sie geprüft wird.
  afterSnapshot?: (file: string) => void
}

// Legt eine Vorversion an, wenn sie fällig ist und die Datenbank etwas trägt, und räumt danach die
// überzähligen weg. Liefert den Namen der neuen oder null. **Wirft** bei einem Fehler; der Aufrufer
// in index.ts fängt ihn und schreibt ihn auf die Konsole, denn eine fehlende Vorversion darf den
// Betrieb nicht stören. **Scheitert die neue, wird nichts rotiert** (Durchsicht K4): Die alten sind
// dann die einzigen.
export async function createPriorVersion(opened: OpenedDatabase, dataDir: string, now: Date, options: PriorVersionOptions = {}): Promise<string | null> {
  const dir = path.join(dataDir, PRIOR_DIR)
  if (!priorVersionDue(listPriorVersions(dataDir), now)) return null
  if (!(await opened.read(carriesStock))) return null
  fs.mkdirSync(dir, { recursive: true })
  // Reste eines Versuchs, den ein Absturz unterbrochen hat. Nur Namen von hier.
  for (const entry of fs.readdirSync(dir)) {
    if (entry.startsWith(TEMP_PREFIX)) fs.rmSync(path.join(dir, entry), { force: true })
  }
  const name = priorVersionName(now)
  const target = path.join(dir, name)
  if (fs.existsSync(target)) return null
  const temp = path.join(dir, `${TEMP_PREFIX}${name}`)
  try {
    // VACUUM verträgt keine offene Transaktion; in der Schlange läuft keine (siehe backup.ts).
    const written = await opened.write(async (db) => {
      if (options.skip?.()) return false
      await db.run(sql`VACUUM INTO ${temp}`)
      return true
    })
    if (!written) return null
    options.afterSnapshot?.(temp)
    const problem = await snapshotProblem(temp)
    if (problem !== null) throw new Error(`Die neue Vorversion ist nicht unversehrt und wurde verworfen: ${problem}`)
    await replaceFile(temp, target)
  } finally {
    // Das Aufräumen darf den eigentlichen Fehler nicht überdecken (Durchsicht K2).
    try {
      fs.rmSync(temp, { force: true })
    } catch (err) {
      console.error(`Der Zwischenstand der Vorversion ließ sich nicht entfernen: ${messageOf(err)}`)
    }
  }
  // Eine, die sich nicht löschen lässt, hält die übrigen nicht auf (Durchsicht K2).
  for (const old of priorVersionsToDrop(listPriorVersions(dataDir))) {
    try {
      fs.rmSync(path.join(dir, old), { force: true })
    } catch (err) {
      console.error(`Die alte Vorversion ${old} ließ sich nicht entfernen: ${messageOf(err)}`)
    }
  }
  return name
}

// `PRAGMA integrity_check` auf der eben geschriebenen Datei. `null` heißt unversehrt.
async function snapshotProblem(file: string): Promise<string | null> {
  let connection
  try {
    connection = await connect(file)
  } catch (err) {
    return messageOf(err)
  }
  try {
    return integrityProblem(connection.rows('PRAGMA integrity_check'))
  } catch (err) {
    return messageOf(err)
  } finally {
    connection.close()
  }
}

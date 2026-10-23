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
import type { Database } from './client.ts'
import type { OpenedDatabase } from './open.ts'
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
// „aus der Zukunft“ (die Uhr wurde zurückgestellt) gilt als frisch; sonst entstünde bei jeder
// Prüfung eine neue und verdrängte die älteren.
export function priorVersionDue(list: readonly PriorVersion[], now: Date, maxAgeDays = PRIOR_MAX_AGE_DAYS): boolean {
  const newest = list.reduce<number | null>((max, v) => {
    const t = Date.parse(v.createdAt)
    return max === null || t > max ? t : max
  }, null)
  return newest === null || now.getTime() - newest > maxAgeDays * DAY_MS
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

// Legt eine Vorversion an, wenn sie fällig ist und die Datenbank etwas trägt, und räumt danach die
// überzähligen weg. Liefert den Namen der neuen oder null. **Wirft** bei einem Fehler; der Aufrufer
// in index.ts fängt ihn und schreibt ihn auf die Konsole, denn eine fehlende Vorversion darf den
// Betrieb nicht stören.
export async function createPriorVersion(opened: OpenedDatabase, dataDir: string, now: Date): Promise<string | null> {
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
    await opened.write((db) => db.run(sql`VACUUM INTO ${temp}`))
    fs.renameSync(temp, target)
  } finally {
    fs.rmSync(temp, { force: true })
  }
  for (const old of priorVersionsToDrop(listPriorVersions(dataDir))) fs.rmSync(path.join(dir, old), { force: true })
  return name
}

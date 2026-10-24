// Sicherungspunkte in der Zeitachse des Verlaufs (#318): ganze Kopien der Datenbank im Datenordner.
//
// Drei Arten, jede mit eigenem Namensmuster:
// - **wöchentlich** (`vorversionen/vorversion-JJJJ-MM-TT-HHMMSS.sqlite`, priorVersions.ts), Zeitpunkt aus dem Namen;
// - **vor dem Update** (`mietfuchs.sqlite.vor-<Schritt>`, `backupBeforeMigrating` in open.ts, und beiseitegelegte
//   `….vom-JJJJ-MM-TT-HHMM[-n]`); der Schritt muss einer dieser Version sein;
// - **vor dem Einspielen** (`mietfuchs.sqlite.vor-restore`, `restoreDatabase` in index.ts, samt beiseitegelegten).
//
// **Woher der Zeitpunkt kommt** (`timeFrom`): Aus dem Namen, wo er einen trägt (wöchentlich in Sekunden, beiseitegelegt
// in Minuten, beides UTC; der Zusatz `.vom-` entsteht aus der Dateizeit beim Beiseitelegen, also aus dem Zeitpunkt, zu
// dem die Sicherung geschrieben wurde). Sonst aus der Merkdatei `sicherung-vor-update.json`, wenn sie diese Datei nennt
// (`at`, ebenfalls die Dateizeit beim Update, aber festgehalten). Sonst aus der Dateizeit (`mtime`): `VACUUM INTO`
// schreibt die Sicherung vor dem Update in einem Zug, und `mietfuchs.sqlite.vor-restore` ist die umbenannte
// Arbeitsdatei, ihre Dateizeit also die letzte Änderung des Stands. **Verlässlich ist sie nur, solange niemand den
// Datenordner ohne Zeiten kopiert hat**: Dann trägt jede Datei die Zeit des Kopierens. Die Oberfläche kennzeichnet
// solche Zeitpunkte deshalb („laut Datei“), und das Aufräumen irrt dabei nur zur sicheren Seite (die Datei wirkt jünger).
//
// **Aufräumen** (`snapshotsToDrop`, im Takt der Vorversionen): Je Art (vor dem Update, vor dem Einspielen) bleiben die
// drei jüngsten und dazu alle aus den letzten zwölf Monaten. Zwölf Monate, weil der Verlauf so lange Einträge zeigt und
// ältere Einträge auf die Sicherung vor dem Update verweisen; drei, damit eine Installation, die lange kein Update
// bekam, ihre letzten Rückwege nicht verliert. Die Datei, die der offene Hinweis nach dem Update nennt, bleibt immer.
// Die wöchentlichen räumt priorVersions.ts (vier). Angefasst wird nur, was eines der Muster erfüllt, nie ein Ordner.

import fs from 'node:fs'
import path from 'node:path'
import { connect } from './client.ts'
import { messageOf } from './open.ts'
import { PRIOR_DIR, priorVersionTime } from './priorVersions.ts'
import { versionBringing } from './releaseSteps.ts'

export type SnapshotType = 'weekly' | 'update' | 'restore'

export type SnapshotPoint = {
  kind: 'snapshot'
  name: string
  type: SnapshotType
  at: string
  // Woher der Zeitpunkt stammt; `file` heißt: aus der Dateizeit, nur so verlässlich wie diese.
  timeFrom: 'name' | 'notice' | 'file'
  size: number
  // Bei „vor dem Update“: die Version, auf die das Update ging, sonst null.
  version: string | null
  title: string
}

// Was die Merkdatei des Hinweises nach dem Update sagt (migrationNotice.ts).
export type SnapshotNotice = { backup: string, at: string, version?: string | null } | null

export const SNAPSHOT_KEEP = 3
export const SNAPSHOT_KEEP_DAYS = 365

const DAY_MS = 24 * 60 * 60 * 1000

const SET_ASIDE = String.raw`(?:\.vom-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(?:-[1-9]\d{0,3})?)?`
const UPDATE_NAME = new RegExp(String.raw`^mietfuchs\.sqlite\.vor-(\d{4}_[a-z0-9_]+?)${SET_ASIDE}$`)
const RESTORE_NAME = new RegExp(String.raw`^mietfuchs\.sqlite\.vor-restore${SET_ASIDE}$`)

// Der Zeitpunkt des Zusatzes `.vom-…`, oder `undefined`, wenn der Zusatz fehlt, oder null, wenn er kein Zeitpunkt ist.
function setAsideTime(m: RegExpExecArray, from: number): Date | null | undefined {
  if (m[from] === undefined) return undefined
  const [y, mo, d, h, mi] = [m[from], m[from + 1], m[from + 2], m[from + 3], m[from + 4]].map(Number)
  const at = new Date(Date.UTC(y, mo - 1, d, h, mi))
  const back = at.toISOString()
  return back.slice(0, 16) === `${m[from]}-${m[from + 1]}-${m[from + 2]}T${m[from + 3]}:${m[from + 4]}` ? at : null
}

// Gehört der Name zu einem Sicherungspunkt? Zugleich die Prüfung für einen Namen, der von außen kommt (die Routen zum
// Einspielen): kein Pfad, eines der Muster, bei „vor dem Update“ ein Schritt dieser Version.
export function parseSnapshotName(name: string, tags: ReadonlySet<string>): { type: SnapshotType, at: Date | null, tag: string | null } | null {
  if (typeof name !== 'string' || name === '' || path.basename(name) !== name) return null
  const weekly = priorVersionTime(name)
  if (weekly) return { type: 'weekly', at: weekly, tag: null }
  const restore = RESTORE_NAME.exec(name)
  if (restore) {
    const at = setAsideTime(restore, 1)
    return at === null ? null : { type: 'restore', at: at ?? null, tag: null }
  }
  const update = UPDATE_NAME.exec(name)
  if (update && update[1] !== 'restore' && tags.has(update[1])) {
    const at = setAsideTime(update, 2)
    return at === null ? null : { type: 'update', at: at ?? null, tag: update[1] }
  }
  return null
}

// Wo die Datei liegt. Der Pfad entsteht aus dem Datenordner und einem Namen, der `parseSnapshotName` bestanden hat.
export function snapshotFile(dataDir: string, point: Pick<SnapshotPoint, 'name' | 'type'>): string {
  return point.type === 'weekly' ? path.join(dataDir, PRIOR_DIR, point.name) : path.join(dataDir, point.name)
}

function titleOf(type: SnapshotType, version: string | null): string {
  if (type === 'weekly') return 'Wöchentliche Sicherung'
  if (type === 'restore') return 'Vor dem Einspielen eines Backups'
  return version ? `Vor dem Update auf Version ${version}` : 'Vor einem Update'
}

// Alle Sicherungspunkte, die jüngste zuerst. `tags`: die Schritte dieser Version in ihrer Reihenfolge.
export function listSnapshots(dataDir: string, tags: readonly string[], notice: SnapshotNotice): SnapshotPoint[] {
  const known = new Set(tags)
  const out: SnapshotPoint[] = []
  const scan = (dir: string, weeklyOnly: boolean) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const parsed = parseSnapshotName(entry.name, known)
      if (!parsed || (parsed.type === 'weekly') !== weeklyOnly) continue
      let stat: fs.Stats
      try {
        stat = fs.statSync(path.join(dir, entry.name))
      } catch {
        continue // zwischen Lesen und Nachsehen verschwunden
      }
      const fromNotice = parsed.type === 'update' && parsed.at === null && notice?.backup === entry.name && !Number.isNaN(Date.parse(notice.at))
      const at = parsed.at ?? (fromNotice && notice ? new Date(notice.at) : stat.mtime)
      const version = parsed.type !== 'update'
        ? null
        : (fromNotice && notice?.version) || versionBringing(parsed.tag === null ? -1 : tags.indexOf(parsed.tag))
      out.push({
        kind: 'snapshot',
        name: entry.name,
        type: parsed.type,
        at: at.toISOString(),
        timeFrom: parsed.at ? 'name' : fromNotice ? 'notice' : 'file',
        size: stat.size,
        version,
        title: titleOf(parsed.type, version),
      })
    }
  }
  scan(path.join(dataDir, PRIOR_DIR), true)
  scan(dataDir, false)
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.name < b.name ? 1 : -1))
}

// Was beim Aufräumen wegfällt (siehe Kopf). `keep`: die Datei des offenen Hinweises nach dem Update.
export function snapshotsToDrop(list: readonly SnapshotPoint[], now: Date, keep: string | null): string[] {
  const out: string[] = []
  for (const type of ['update', 'restore'] as const) {
    const ofType = list.filter((p) => p.type === type).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    ofType.forEach((p, i) => {
      if (i < SNAPSHOT_KEEP || p.name === keep) return
      if (now.getTime() - Date.parse(p.at) <= SNAPSHOT_KEEP_DAYS * DAY_MS) return
      out.push(p.name)
    })
  }
  return out
}

// Räumt auf und liefert die entfernten Namen. Wirft nie; eine Datei, die sich nicht entfernen lässt, steht auf der
// Konsole und hält die übrigen nicht auf.
export function cleanSnapshots(dataDir: string, tags: readonly string[], now: Date, notice: SnapshotNotice): string[] {
  const list = listSnapshots(dataDir, tags, notice)
  const removed: string[] = []
  for (const name of snapshotsToDrop(list, now, notice?.backup ?? null)) {
    const point = list.find((p) => p.name === name)
    if (!point) continue
    try {
      fs.rmSync(snapshotFile(dataDir, point))
      removed.push(name)
    } catch (err) {
      console.error(`Die alte Sicherung ${name} ließ sich nicht entfernen: ${messageOf(err)}`)
    }
  }
  return removed
}

// Die jüngste Gruppe des Verlaufs in einer Sicherung, oder null (kein Verlauf darin, unlesbar). Daran erkennt der
// Rücksprung, ob eine Sicherung genau den Stand nach einer Gruppe des heutigen Verlaufs trägt: dieselbe Kennung und
// derselbe Zeitpunkt. Eine Sicherung aus einem anderen Zweig der Geschichte (vor dem Einspielen eines Backups) hat
// dort eine andere Gruppe.
export async function snapshotLastGroup(file: string): Promise<{ id: number, at: string } | null> {
  let connection
  try {
    connection = await connect(file)
  } catch {
    return null
  }
  try {
    if (connection.rows("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'change_groups'").length === 0) return null
    const [row] = connection.rows('SELECT id, at FROM change_groups ORDER BY id DESC LIMIT 1')
    return row ? { id: Number(row[0]), at: String(row[1]) } : null
  } catch {
    return null
  } finally {
    connection.close()
  }
}

// Sortiert Sicherungspunkte zwischen die Gruppen einer Seite des Verlaufs, neueste zuerst. Auf eine Seite gehört ein
// Sicherungspunkt, der älter ist als die Gruppe, ab der geblättert wird (`beforeAt`), und nicht älter als die älteste
// Gruppe der Seite; auf die letzte Seite alle älteren. Der Zeitraumfilter gilt auch für sie (`to` ausschließlich).
export function interleaveSnapshots<G extends { at: string }>(
  groups: readonly G[], snapshots: readonly SnapshotPoint[],
  options: { beforeAt: string | null, last: boolean, from: string | null, to: string | null },
): (G | SnapshotPoint)[] {
  const oldest = groups.at(-1)?.at ?? null
  const time = (iso: string) => Date.parse(iso)
  const mine = [...snapshots].sort((a, b) => time(b.at) - time(a.at)).filter((p) => {
    const t = time(p.at)
    if (options.beforeAt !== null && t >= time(options.beforeAt)) return false
    if (!options.last && oldest !== null && t < time(oldest)) return false
    if (options.from !== null && t < time(options.from)) return false
    if (options.to !== null && t >= time(options.to)) return false
    return true
  })
  const out: (G | SnapshotPoint)[] = []
  let i = 0
  for (const g of groups) {
    while (i < mine.length && time(mine[i].at) > time(g.at)) out.push(mine[i++])
    out.push(g)
  }
  while (i < mine.length) out.push(mine[i++])
  return out
}

// Die Vorschau zum Einspielen eines Sicherungspunkts (#318): „Zu diesem Stand zurückkehren“ über eine ganze Kopie der
// Datenbank statt Schritt für Schritt über den Verlauf.
//
// Sie hat dieselbe Gestalt wie die Vorschau des Rücksprungs (`kind`, `refusals`, `notes`, `token`, revert.ts), mit
// `kind: 'snapshot'`. Geprüft wird an einer Kopie der Sicherung, genau wie beim Einspielen (`archiveDatabaseProblem`:
// Integrität, neuerer Aufbau, Schritte nachholen, Verweise). Danach nennt sie, was der Vermieter vorher wissen muss:
// wie viele Einträge seither ersetzt werden, welche Belege fehlen würden, welche aus dem Papierkorb zurückkommen, welche
// Zustimmungen gelten, und ob seither eine Abrechnung abgeschlossen oder wieder geöffnet wurde. Die Kopie geht danach
// wieder weg (`mietfuchs.sqlite.vorschau-<id>`; Reste räumt der Start, cleanRestoreLeftovers).
//
// **Die Marke** steht für die Datei (Name, Größe, Dateizeit) und den neuesten Eintrag des Verlaufs: Ändert sich eins
// davon zwischen Vorschau und Einspielen, antwortet das Einspielen mit 409 und neuer Vorschau.

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { sql } from 'drizzle-orm'
import { connect, loadMigrations, type Executor } from './client.ts'
import { archiveDatabaseProblem } from './backup.ts'
import { referencedFiles } from './fileRefs.ts'
import { FROZEN_TABLES, type RevertMode } from './revert.ts'
import { snapshotFile, type SnapshotPoint } from './snapshots.ts'
import { existsIn, storeDir, trashDir } from '../trash.ts'
import { newId } from '../ids.ts'
import type { OpenedDatabase } from './open.ts'

export type SnapshotPreview = {
  kind: 'snapshot'
  snapshot: SnapshotPoint
  // Kam die Vorschau von einem Eintrag des Verlaufs: der Eintrag, die Art des Rücksprungs und warum er Schritt für
  // Schritt nicht geht. Sonst null und leer.
  entry: { id: number, firstId: number, at: string, title: string } | null
  mode: RevertMode | null
  reasons: string[]
  // Einträge im Verlauf seit dem Zeitpunkt der Sicherung (ohne Schranken); sie werden ersetzt.
  later: number
  // Belege und Logos, die der Stand nennt und die weder im Ordner noch im Papierkorb liegen.
  missing: string[]
  // Belege und Logos, die aus dem Papierkorb zurückkommen.
  fromTrash: number
  // Welche Zustimmungen danach gelten, als Sätze.
  consents: string[]
  notes: string[]
  refusals: string[]
  token: string
}

export const PREVIEW_COPY = /^mietfuchs\.sqlite\.vorschau-[0-9a-f]{16}(?:-journal|-wal|-shm)?$/

// Die Marke: Datei und neuester Eintrag des Verlaufs.
export async function snapshotToken(dataDir: string, point: SnapshotPoint, current: OpenedDatabase | null): Promise<string> {
  let stat: fs.Stats | null = null
  try {
    stat = fs.statSync(snapshotFile(dataDir, point))
  } catch {
    stat = null
  }
  let newest: number | null = null
  try {
    newest = current ? await current.read(async (db) => Number((await db.get<[number | null]>(sql`SELECT max(id) FROM change_groups`))?.[0] ?? 0)) : null
  } catch {
    newest = null
  }
  return createHash('sha256').update(JSON.stringify([point.name, stat?.size ?? null, stat?.mtimeMs ?? null, newest])).digest('hex').slice(0, 32)
}

// Die Zustimmungen von jetzt, als Sätze. Sie gelten danach (`restoreConsent` in revert.ts); die Sicherung bringt keine mit.
async function consentSentences(db: Executor | null): Promise<string[]> {
  if (!db) {
    return ['Die aktuellen Zustimmungen lassen sich gerade nicht lesen. Nach dem Einspielen gilt deshalb keine; erteilen Sie sie bei Bedarf in den Einstellungen neu.']
  }
  const granted: string[] = []
  for (const [slot, url] of await db.all<[string, string | null]>(sql`SELECT slot, consent_url FROM ai_slots WHERE consent_url IS NOT NULL ORDER BY slot`)) {
    granted.push(`die Übermittlung ${slot === 'images' ? 'von Fotos und Scans' : 'von Belegen'} an den KI-Dienst unter ${url}`)
  }
  const [update] = await db.all<[string | null]>(sql`SELECT update_check FROM settings LIMIT 1`)
  if (update?.[0] === 'on') granted.push('die Abfrage nach Updates')
  return [
    granted.length === 0
      ? 'Zustimmungen bringt die Sicherung nicht mit: Es bleibt dabei, dass Sie zurzeit keiner Übermittlung an einen KI-Dienst und keiner Abfrage nach Updates zugestimmt haben.'
      : `Zustimmungen bringt die Sicherung nicht mit; es gelten danach die von jetzt: ${granted.join(', ')}. Was Sie seither widerrufen haben, bleibt widerrufen.`,
  ]
}

// Wie viele Einträge seit dem Zeitpunkt der Sicherung im Verlauf stehen, und ob darunter ein Abschluss oder ein
// Wiederöffnen ist.
async function laterInJournal(db: Executor, at: string): Promise<{ later: number, frozen: boolean }> {
  const [row] = await db.all<[number]>(sql`SELECT count(*) FROM change_groups WHERE at > ${at} AND barrier IS NULL`)
  const frozenTables = sql.join(FROZEN_TABLES.map((t) => sql`${t}`), sql`, `)
  const [frozen] = await db.all<[number]>(sql`SELECT count(*) FROM change_log l JOIN change_groups g ON g.id = l.group_id
    WHERE g.at > ${at} AND l.table_name IN (${frozenTables})`)
  return { later: Number(row?.[0] ?? 0), frozen: Number(frozen?.[0] ?? 0) > 0 }
}

export type PreviewContext = { entry: SnapshotPreview['entry'], mode: RevertMode | null, reasons: string[] }

// Die Vorschau. `current`: die offene Datenbank, wenn sie den Bestand trägt (sonst null, der Rettungsfall).
// `blocked`: Gründe des Aufrufers, etwa eine laufende KI-Auswertung.
export async function previewSnapshot(
  dataDir: string, point: SnapshotPoint, current: OpenedDatabase | null, blocked: readonly string[], context: PreviewContext | null = null,
): Promise<SnapshotPreview> {
  const refusals = [...blocked]
  const notes: string[] = []
  let missing: string[] = []
  let fromTrash = 0
  const copy = path.join(dataDir, `mietfuchs.sqlite.vorschau-${newId()}`)
  try {
    fs.copyFileSync(snapshotFile(dataDir, point), copy)
    let older = false
    try {
      const c = await connect(copy)
      try {
        const has = c.rows("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'").length > 0
        const done = has ? Number(c.rows('SELECT count(*) FROM __drizzle_migrations')[0]?.[0] ?? 0) : 0
        older = has && done < (await loadMigrations()).length
      } finally {
        c.close()
      }
    } catch {
      // Die Prüfung darunter sagt, was los ist.
    }
    const problem = await archiveDatabaseProblem(copy, 'priorVersion')
    if (problem) {
      refusals.push(problem)
    } else {
      if (older) notes.push('Diese Sicherung stammt aus einer früheren Version von Mietfuchs. Beim Einspielen bringt Mietfuchs sie auf den heutigen Stand; zurück in die frühere Version führt das nicht.')
      const c = await connect(copy)
      try {
        for (const [store, names] of await referencedFiles(c.db)) {
          for (const name of names) {
            if (existsIn(storeDir(dataDir, store), name)) continue
            if (existsIn(trashDir(dataDir, store), name)) fromTrash++
            else missing.push(name)
          }
        }
      } finally {
        c.close()
      }
    }
  } catch (err) {
    refusals.push(`Die Sicherung ließ sich nicht lesen: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    for (const suffix of ['', '-journal', '-wal', '-shm']) fs.rmSync(`${copy}${suffix}`, { force: true })
  }
  missing = [...new Set(missing)].sort()

  let later = 0
  let consents: string[]
  if (current) {
    const seen = await current.read((db) => laterInJournal(db, point.at))
    later = seen.later
    if (seen.frozen) {
      notes.push('Seit diesem Stand wurde mindestens eine Abrechnung abgeschlossen, wieder geöffnet oder ihr Versanddatum geändert. ' +
        'Nach dem Einspielen gilt für Abschlüsse der Stand der Sicherung; prüfen Sie danach auf der Seite Abrechnung, ob jede zugestellte Abrechnung noch abgeschlossen ist.')
    }
    consents = await current.read((db) => consentSentences(db))
  } else {
    consents = await consentSentences(null)
  }
  return {
    kind: 'snapshot',
    snapshot: point,
    entry: context?.entry ?? null,
    mode: context?.mode ?? null,
    reasons: context?.reasons ?? [],
    later,
    missing,
    fromTrash,
    consents,
    notes,
    refusals,
    token: await snapshotToken(dataDir, point, current),
  }
}

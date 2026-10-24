// Helfer für die Tests des Rücksprungs im Verlauf (#318, Schritt 4): Bestand zeilengleich lesen, Vorschau und
// Rücksprung über die Routen.
import assert from 'node:assert/strict'
import type { JournalGroupView } from '../src/db/journal.ts'
import type { RevertMode, RevertPreview } from '../src/db/revert.ts'
import type { SnapshotPreview } from '../src/db/snapshotPreview.ts'
import { besideServer, jsonOf, type Server } from './api.ts'
import { CONSENT_COLUMNS } from '../src/db/revert.ts'

// Nicht verglichen: das Journal selbst und die Buchführung von drizzle und SQLite.
const SKIP = new Set(['change_groups', 'change_log', '__drizzle_migrations'])

// Der Bestand als Text je Tabelle: jede Zeile mit `rowid`, in der Reihenfolge der `rowid` (read.ts liest so). Die
// Zustimmungen (`CONSENT_COLUMNS`) nimmt ein Rücksprung bewusst nicht zurück; sie stehen deshalb als `*` da, außer mit
// `raw`.
export async function dumpStock(dataDir: string, options: { raw?: boolean } = {}): Promise<Record<string, string[]>> {
  const c = await besideServer(dataDir)
  try {
    const tables = c.rows("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .map((r) => String(r[0])).filter((t) => !SKIP.has(t))
    const out: Record<string, string[]> = {}
    for (const t of tables) {
      const columns = ['rowid', ...c.rows(`PRAGMA table_info("${t}")`).map((r) => String(r[1]))]
      const masked = new Set(options.raw ? [] : (CONSENT_COLUMNS[t]?.columns ?? []))
      out[t] = c.rows(`SELECT rowid, * FROM "${t}" ORDER BY rowid`).map((r) => JSON.stringify(r.map((v, i) => (masked.has(columns[i]) ? '*' : v))))
    }
    return out
  } finally {
    c.close()
  }
}

export const journalOf = async (s: Server, query = ''): Promise<JournalGroupView[]> => {
  const res = await fetch(`${s.base}/api/journal${query}`)
  assert.equal(res.status, 200, await res.clone().text())
  return jsonOf<JournalGroupView[]>(res)
}

const post = (s: Server, url: string, body: unknown) =>
  fetch(`${s.base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

export async function previewOf(s: Server, id: number, mode: RevertMode = 'including'): Promise<RevertPreview> {
  const res = await post(s, `/api/journal/${id}/revert/preview`, { mode })
  assert.equal(res.status, 200, await res.clone().text())
  return jsonOf<RevertPreview>(res)
}

export const revertRaw = (s: Server, id: number, mode: RevertMode, token: unknown) => post(s, `/api/journal/${id}/revert`, { mode, token })

// Vorschau, dann Rücksprung mit ihrer Marke; die Vorschau muss ohne Grenze sein.
export async function revert(s: Server, id: number, mode: RevertMode = 'including'): Promise<RevertPreview> {
  const preview = await previewOf(s, id, mode)
  assert.deepEqual(preview.refusals, [], `Rücksprung zu ${id} (${mode}) abgelehnt`)
  const res = await revertRaw(s, id, mode, preview.token)
  assert.equal(res.status, 200, await res.clone().text())
  return preview
}

// Der oberste Eintrag des Verlaufs (die neueste Änderung).
export async function newest(s: Server): Promise<JournalGroupView> {
  const [top] = await journalOf(s, '?limit=1')
  return top ?? assert.fail('Der Verlauf ist leer.')
}

// Sicherungspunkte (#318): Vorschau zum Einspielen und Einspielen mit ihrer Marke.
export async function snapshotPreviewOf(s: Server, name: string): Promise<SnapshotPreview> {
  const res = await post(s, `/api/prior-versions/${encodeURIComponent(name)}/restore/preview`, {})
  assert.equal(res.status, 200, await res.clone().text())
  return jsonOf<SnapshotPreview>(res)
}

export const restoreSnapshotRaw = (s: Server, name: string, token: unknown) =>
  post(s, `/api/prior-versions/${encodeURIComponent(name)}/restore`, { token })

// Vorschau, dann Einspielen; die Vorschau muss ohne Grenze sein. Liefert Vorschau und die Sätze der Antwort.
export async function restoreSnapshot(s: Server, name: string): Promise<{ preview: SnapshotPreview, notes: string[] }> {
  const preview = await snapshotPreviewOf(s, name)
  assert.deepEqual(preview.refusals, [], `Einspielen von ${name} abgelehnt`)
  const res = await restoreSnapshotRaw(s, name, preview.token)
  assert.equal(res.status, 200, await res.clone().text())
  return { preview, notes: (await jsonOf<{ notes: string[] }>(res)).notes }
}

// Der Papierkorb für Dateien (#318, Schritt 5): nur eigene Dateien, nie Ordner, nie ein Pfad; Verschieben mit
// Wiederholungen und nie zwei Exemplare (Durchsicht von PR #439, K5); jede Spalte mit Dateinamen und jede Zustimmung
// an ihrer Stelle (M1, M2).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DESIGN_DIR_NAME } from '../src/letterDesign.ts'
import { cleanTrash, FILE_STORES, moveFile, moveToTrash, restoreFromTrash, trashDir, type FileOps } from '../src/trash.ts'
import { FILE_COLUMNS } from '../src/db/fileRefs.ts'
import { CONSENT_COLUMNS } from '../src/db/revert.ts'
import { openFreshDatabase } from '../testing/freshDatabase.ts'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-trash-'))

test('Papierkorb: Die Ablage für Logo und Briefpapier heißt wie ihr Ordner', () => {
  assert.ok((FILE_STORES as readonly string[]).includes(DESIGN_DIR_NAME))
})

test('Papierkorb: verschieben und zurückholen, ein Pfad statt eines Namens bewegt nichts', async () => {
  const dir = tmp()
  try {
    fs.mkdirSync(path.join(dir, 'uploads'))
    fs.writeFileSync(path.join(dir, 'uploads', 'a.pdf'), 'A')
    fs.writeFileSync(path.join(dir, 'geheim.txt'), 'G')
    await moveToTrash(dir, 'uploads', 'a.pdf')
    await moveToTrash(dir, 'uploads', '../geheim.txt')
    assert.ok(fs.existsSync(path.join(trashDir(dir, 'uploads'), 'a.pdf')))
    assert.ok(fs.existsSync(path.join(dir, 'geheim.txt')))
    await assert.rejects(() => restoreFromTrash(dir, 'uploads', '../geheim.txt'))
    await restoreFromTrash(dir, 'uploads', 'a.pdf')
    assert.equal(fs.readFileSync(path.join(dir, 'uploads', 'a.pdf'), 'utf8'), 'A')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Papierkorb: Aufräumen nimmt nur Dateien, die keiner mehr braucht, und keine Ordner', () => {
  const dir = tmp()
  try {
    const t = trashDir(dir, 'uploads')
    fs.mkdirSync(path.join(t, 'ordner'), { recursive: true })
    fs.writeFileSync(path.join(t, 'weg.pdf'), 'x')
    fs.writeFileSync(path.join(t, 'bleibt.pdf'), 'x')
    fs.writeFileSync(path.join(dir, 'papierkorb', 'fremd.txt'), 'x')
    assert.equal(cleanTrash(dir, new Map([['uploads', new Set(['bleibt.pdf'])]])), 1)
    assert.deepEqual(fs.readdirSync(t).sort(), ['bleibt.pdf', 'ordner'])
    assert.ok(fs.existsSync(path.join(dir, 'papierkorb', 'fremd.txt')))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// Nachgestellte Dateioperationen: ein Dateisystem als Menge von Namen.
function fakeOps(files: Set<string>, fail: { rename?: string[], rm?: string[] } = {}): FileOps & { calls: string[] } {
  const calls: string[] = []
  const error = (code: string) => Object.assign(new Error(code), { code })
  return {
    calls,
    mkdir: () => undefined,
    exists: (f) => files.has(f),
    rename: (from, to) => {
      calls.push(`rename ${from}`)
      const code = fail.rename?.shift()
      if (code) throw error(code)
      files.delete(from)
      files.add(to)
    },
    copyFile: (from, to) => {
      calls.push(`copy ${from}`)
      files.add(to)
    },
    rm: (f) => {
      calls.push(`rm ${f}`)
      const code = fail.rm?.shift()
      if (code) throw error(code)
      files.delete(f)
    },
  }
}
const noWait = async () => undefined

test('Durchsicht K5: Ein kurz gesperrtes Verschieben wird wiederholt', async () => {
  const files = new Set(['/a/x.pdf'])
  const ops = fakeOps(files, { rename: ['EBUSY', 'EPERM'] })
  await moveFile('/a/x.pdf', '/b/x.pdf', ops, noWait)
  assert.deepEqual([...files], ['/b/x.pdf'])
  assert.equal(ops.calls.filter((c) => c.startsWith('rename')).length, 3)
})

test('Durchsicht K5: Auf ein anderes Laufwerk wird kopiert; scheitert das Entfernen der Quelle, gibt es keine zweite Kopie', async () => {
  const ok = new Set(['/a/x.pdf'])
  await moveFile('/a/x.pdf', '/b/x.pdf', fakeOps(ok, { rename: ['EXDEV'] }), noWait)
  assert.deepEqual([...ok], ['/b/x.pdf'])
  const stuck = new Set(['/a/x.pdf'])
  await assert.rejects(() => moveFile('/a/x.pdf', '/b/x.pdf', fakeOps(stuck, { rename: ['EXDEV'], rm: ['EBUSY'] }), noWait))
  assert.deepEqual([...stuck], ['/a/x.pdf'], 'die Datei gilt als nicht verschoben, die Kopie ist wieder weg')
})

test('Durchsicht K5: Liegt am Ziel schon dieselbe Datei (zweimal gelöscht), wird sie ersetzt', async () => {
  const files = new Set(['/a/x.pdf', '/b/x.pdf'])
  await moveFile('/a/x.pdf', '/b/x.pdf', fakeOps(files), noWait)
  assert.deepEqual([...files], ['/b/x.pdf'])
})

// Wächter: Jede Spalte, deren Name eine Datei nennt, steht in FILE_COLUMNS (M1); sonst räumte der Papierkorb eine Datei
// weg, auf die der Bestand verweist. Jede Spalte, die nach Zustimmung klingt, steht in CONSENT_COLUMNS (M2).
test('Wächter: Spalten mit Dateinamen und Zustimmungen stehen an ihrer Stelle', async () => {
  const dir = tmp()
  const opened = await openFreshDatabase(dir)
  try {
    const columns: [string, string][] = []
    for (const table of opened.journalSchema.values()) for (const c of table.columns) columns.push([table.name, c])
    const listed = new Set(Object.values(FILE_COLUMNS).flatMap((tables) => Object.entries(tables).flatMap(([t, cs]) => cs.map((c) => `${t}.${c}`))))
    const fileLike = columns.filter(([, c]) => /(^|_)file$/.test(c)).map(([t, c]) => `${t}.${c}`)
    assert.deepEqual(fileLike.filter((c) => !listed.has(c)), [])
    assert.deepEqual([...listed].filter((c) => !fileLike.includes(c)), [], 'FILE_COLUMNS nennt eine Spalte, die es nicht gibt')
    const consent = new Set(Object.entries(CONSENT_COLUMNS).flatMap(([t, { columns: cs }]) => cs.map((c) => `${t}.${c}`)))
    const consentLike = columns.filter(([, c]) => /consent|update_check/.test(c)).map(([t, c]) => `${t}.${c}`)
    assert.deepEqual(consentLike.filter((c) => !consent.has(c)), [])
    for (const [t, { key }] of Object.entries(CONSENT_COLUMNS)) assert.ok(opened.journalSchema.get(t)?.key.includes(key), `${t}.${key} ist kein Schlüssel`)
  } finally {
    opened.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

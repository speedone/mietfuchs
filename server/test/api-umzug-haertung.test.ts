// Härtung des Umzugs ins Programmfenster vor 0.15 (#517, Integrationsdurchsicht unter dem Blickwinkel Daten): Beenden
// während einer Übernahme, Reste eines Abbruchs, Abbruch nach dem Umschalten, Papierkorb, und dass ein umgezogener Ordner
// wirklich nur gelesen wird. Aufbau wie in api-umzug.test.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Tenancy } from '../../shared/types.ts'
import type { Db } from '../src/store.ts'
import { straightenForDatabase } from '../src/legacy/migrate.ts'
import { openDatabaseWithStock } from '../testing/database.ts'
import { removeDataDir, startServerIn, waitForExit } from '../testing/api.ts'

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-umzug-'))
const programName = 'mietfuchs-linux'
const PDF = Buffer.from('%PDF-1.4\n% Rechnung\n')

const someDb = (): Db => ({
  settings: { houseName: 'Haus am Weg', address: 'Weg 1', landlordName: 'V. Vermieter', iban: '', paymentDeadlineDays: 30, ollamaUrl: 'http://localhost:11434', ollamaModel: 'modell', updateCheck: 'on' },
  units: [{ id: 'u1', name: 'EG', areaM2: 80, participates: true }],
  tenancies: [{
    id: 't1', unitId: 'u1', tenantName: 'Müller', persons: 1, personHistory: [{ from: '2024-01-01', persons: 1 }], start: '2024-01-01', end: null,
    prepayments: [{ from: '2024-01', monthlyCents: 10000 }], prepaymentOverrides: {}, baseRents: [{ from: '2024-01', monthlyCents: 50000 }],
  }],
  costItems: [{ id: 'c1', year: 2024, category: 'Müllabfuhr', description: 'Gebühren', amountCents: 120000, key: 'area', invoiceFile: 'rechnung.pdf' }],
  meters: [], readings: [], payments: [], closedSettlements: [],
})

type Old = { home: string, data: string }
async function oldFolder(receipts = 1): Promise<Old> {
  const home = tempDir()
  const program = path.join(home, 'Downloads', 'mietfuchs-0.14')
  const data = path.join(program, 'data')
  fs.mkdirSync(path.join(data, 'uploads'), { recursive: true })
  fs.writeFileSync(path.join(program, programName), 'Programmdatei')
  fs.writeFileSync(path.join(data, 'uploads', 'rechnung.pdf'), PDF)
  for (let i = 1; i < receipts; i++) fs.writeFileSync(path.join(data, 'uploads', `beleg-${i}.pdf`), PDF)
  ;(await openDatabaseWithStock(data, straightenForDatabase(someDb()))).close()
  return { home, data }
}

const desktopEnv = (home: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  NKA_RUNTIME: 'desktop', NKA_HOST: '127.0.0.1', NKA_TEST_HOME: home, NKA_TEST_OLD_PORT: '9', ...extra,
})

async function post(base: string, urlPath: string, body: unknown = {}): Promise<{ status: number, body: Record<string, unknown> }> {
  const res = await fetch(`${base}${urlPath}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: res.status, body: await res.json() as Record<string, unknown> }
}

// Übernehmen wie die Oberfläche (K11 der Durchsicht Sicherheit): erst den Ort über /inspect bekannt machen, dann mit
// seiner Kennung
async function adopt(base: string, dataDir: string): Promise<{ status: number, body: Record<string, unknown> }> {
  const known = await post(base, '/api/relocation/inspect', { folder: dataDir })
  const id = (known.body.candidate as { id?: string } | undefined)?.id
  if (!id) return known
  return post(base, '/api/relocation/adopt', { id })
}

test('Durchsicht K2: Beenden während des Umschaltens wartet, bis die Übernahme fertig ist', async () => {
  const old = await oldFolder()
  const s = await startServerIn(tempDir(), desktopEnv(old.home, { NKA_TEST_SWITCH_DELAY_MS: '1500' }))
  try {
    const adopting = adopt(s.base, old.data)
    for (let i = 0; i < 200; i++) {
      if ((await s.api<{ phase: string }>('/api/relocation/progress')).phase === 'switch') break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    const quit = await post(s.base, '/api/quit')
    assert.deepEqual(quit.body, { ok: true, busy: true })
    const adopted = await adopting
    assert.equal(adopted.status, 200, JSON.stringify(adopted.body))
    assert.equal(await waitForExit(s.child, 20000), 0)
    assert.ok(fs.existsSync(path.join(old.data, 'umgezogen.json')))
    assert.equal(JSON.parse(fs.readFileSync(path.join(s.dataDir, 'umzug.json'), 'utf8')).decision, 'moved')
  } finally {
    s.stop()
    fs.rmSync(old.home, { recursive: true, force: true })
  }
})

test('Durchsicht K2: Beenden während des Kopierens bricht ab, beide Ordner bleiben, wie sie waren', async () => {
  const old = await oldFolder(6)
  const s = await startServerIn(tempDir(), desktopEnv(old.home, { NKA_TEST_COPY_DELAY_MS: '300' }))
  try {
    const adopting = adopt(s.base, old.data)
    for (let i = 0; i < 100; i++) {
      if ((await s.api<{ files: number }>('/api/relocation/progress')).files >= 1) break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    assert.equal((await post(s.base, '/api/quit')).status, 200)
    const adopted = await adopting
    assert.equal(adopted.status, 400)
    assert.match(String(adopted.body.error), /abgebrochen/)
    assert.equal(await waitForExit(s.child, 20000), 0)
    assert.equal(fs.existsSync(path.join(old.data, 'umgezogen.json')), false)
    assert.deepEqual(fs.readdirSync(path.join(s.dataDir, 'uploads')), [])
    assert.ok(!fs.readdirSync(s.dataDir).some((n) => n.startsWith('mietfuchs.sqlite.kopie-') || n.startsWith('restore-')), fs.readdirSync(s.dataDir).join(', '))
  } finally {
    s.stop()
    fs.rmSync(old.home, { recursive: true, force: true })
  }
})

test('Durchsicht K2: die Kopie einer abgebrochenen Übernahme heißt bis zum Umschalten anders und wird beim Start weggeräumt', async () => {
  const dataDir = tempDir()
  fs.writeFileSync(path.join(dataDir, 'mietfuchs.sqlite.kopie-0123456789abcdef'), 'Rest einer Übernahme')
  fs.writeFileSync(path.join(dataDir, 'mietfuchs.sqlite.kopie-0123456789abcdef-journal'), 'Rest')
  // Die Datenbank unter dem Namen des Austauschs kann die einzige Kopie sein und bleibt
  fs.writeFileSync(path.join(dataDir, 'mietfuchs.sqlite.restore-fedcba9876543210'), 'kann die einzige Kopie sein')
  const s = await startServerIn(dataDir, {})
  try {
    const names = fs.readdirSync(dataDir)
    assert.ok(!names.some((n) => n.startsWith('mietfuchs.sqlite.kopie-')), names.join(', '))
    assert.ok(names.includes('mietfuchs.sqlite.restore-fedcba9876543210'))
  } finally {
    s.stop()
  }
})

test('Durchsicht K3: endet das Fenster nach dem Umschalten, holt der nächste Start Entscheidung und Vermerk nach', async () => {
  const old = await oldFolder()
  const dataDir = tempDir()
  const first = await startServerIn(dataDir, desktopEnv(old.home, { NKA_TEST_EXIT_AFTER_SWITCH: '1' }))
  try {
    await adopt(first.base, old.data).catch(() => null)
    await waitForExit(first.child, 20000)
    assert.equal(fs.existsSync(path.join(dataDir, 'umzug.json')), false, 'abgebrochen vor der Entscheidung')
    assert.equal(fs.existsSync(path.join(old.data, 'umgezogen.json')), false, 'abgebrochen vor dem Vermerk')
  } finally {
    first.child.kill()
  }
  const again = await startServerIn(dataDir, desktopEnv(old.home))
  try {
    const decided = JSON.parse(fs.readFileSync(path.join(dataDir, 'umzug.json'), 'utf8'))
    assert.equal(decided.decision, 'moved')
    assert.equal(decided.from, old.data)
    assert.ok(decided.source, 'mit Fingerabdruck, damit spätere Änderungen im alten Ordner auffallen')
    assert.ok(fs.existsSync(path.join(old.data, 'umgezogen.json')))
    assert.deepEqual(await again.api('/api/relocation'), { offered: false })
    assert.deepEqual((await again.api<Tenancy[]>('/api/tenancies')).map((t) => t.tenantName), ['Müller'])
  } finally {
    again.stop()
    fs.rmSync(old.home, { recursive: true, force: true })
  }
})

test('Durchsicht K3: endet es vor dem Umschalten, bleibt alles, wie es war, und der Umzug wird wieder angeboten', async () => {
  const old = await oldFolder()
  const dataDir = tempDir()
  const first = await startServerIn(dataDir, desktopEnv(old.home, { NKA_TEST_EXIT_BEFORE_SWITCH: '1' }))
  try {
    await adopt(first.base, old.data).catch(() => null)
    await waitForExit(first.child, 20000)
  } finally {
    first.child.kill()
  }
  const again = await startServerIn(dataDir, desktopEnv(old.home))
  try {
    assert.equal(fs.existsSync(path.join(dataDir, 'umzug.json')), false)
    assert.equal(fs.existsSync(path.join(old.data, 'umgezogen.json')), false)
    assert.deepEqual(await again.api('/api/relocation'), { offered: true })
    assert.ok(!fs.readdirSync(dataDir).some((n) => n.startsWith('umzug.offen') || n.startsWith('mietfuchs.sqlite.kopie-')), fs.readdirSync(dataDir).join(', '))
  } finally {
    again.stop()
    fs.rmSync(old.home, { recursive: true, force: true })
  }
})

test('Durchsicht K9: der Papierkorb zieht mit, damit ein Rücksprung im neuen Mietfuchs gelöschte Belege zurückholt', async () => {
  const old = await oldFolder()
  fs.mkdirSync(path.join(old.data, 'papierkorb', 'uploads'), { recursive: true })
  fs.writeFileSync(path.join(old.data, 'papierkorb', 'uploads', 'geloescht.pdf'), PDF)
  fs.mkdirSync(path.join(old.data, 'vorversionen'), { recursive: true })
  fs.writeFileSync(path.join(old.data, 'vorversionen', 'mietfuchs-2026-10-01.sqlite'), 'Vorversion')
  const s = await startServerIn(tempDir(), desktopEnv(old.home))
  try {
    const adopted = await adopt(s.base, old.data)
    assert.equal(adopted.status, 200, JSON.stringify(adopted.body))
    assert.ok(fs.existsSync(path.join(old.data, 'papierkorb', 'uploads', 'geloescht.pdf')), 'kopiert, nicht verschoben')
    // Ob er auf Dauer bleibt, entscheidet wie immer das Aufräumen mit dem Journal; mitgekommen ist er
    assert.ok(fs.existsSync(path.join(s.dataDir, 'papierkorb', 'uploads', 'geloescht.pdf')), fs.readdirSync(s.dataDir).join(', '))
    // Vorversionen bleiben im alten Ordner; der Erfolg sagt es. Geänderte Erwartung (Praxistest B-03): ohne Pfad und
    // ohne Fachwort, mit dem Rat, den Ordner zu behalten
    assert.equal(fs.existsSync(path.join(s.dataDir, 'vorversionen', 'mietfuchs-2026-10-01.sqlite')), false)
    const notes = JSON.stringify(adopted.body.notes)
    assert.match(notes, /Ältere Sicherungen bleiben im alten Ordner\. Behalten Sie diesen Ordner deshalb noch eine Weile/)
    assert.ok(!notes.includes(old.data), 'kein langer Pfad')
  } finally {
    s.stop()
    fs.rmSync(old.home, { recursive: true, force: true })
  }
})

// Ein umgezogener Ordner wird nur gelesen (#517). Die Zeit eines Ordners ändert sich mit jeder Datei, die darin entsteht
// oder verschwindet, auch mit einer Probe, die gleich wieder weg ist.
const dirTimes = (dir: string) => ({ data: fs.statSync(dir).mtimeMs, uploads: fs.statSync(path.join(dir, 'uploads')).mtimeMs })

test('Durchsicht K7: /healthz und das Backup schreiben im umgezogenen Ordner nichts', async () => {
  const old = await oldFolder()
  fs.writeFileSync(path.join(old.data, 'umgezogen.json'), JSON.stringify({ version: 1, movedTo: '/neu', at: '2026-11-01T10:15:00.000Z', appVersion: '0.15.0' }))
  const s = await startServerIn(old.data, {})
  try {
    const before = dirTimes(old.data)
    await new Promise((resolve) => setTimeout(resolve, 50))
    const health = await fetch(`${s.base}/healthz`)
    assert.equal(health.status, 200, await health.text())
    const backup = await fetch(`${s.base}/api/backup`)
    assert.equal(backup.status, 200)
    await backup.arrayBuffer()
    assert.deepEqual(dirTimes(old.data), before)
  } finally {
    s.child.kill()
    await new Promise((resolve) => s.child.once('exit', resolve))
    fs.rmSync(old.home, { recursive: true, force: true })
  }
})

test('Durchsicht K8: entsteht der Vermerk während des Laufs, ruht die Hintergrundarbeit im alten Ordner', async () => {
  const dataDir = tempDir()
  const s = await startServerIn(dataDir, { NKA_TEST_PRIOR_INTERVAL_MS: '200' })
  try {
    const trash = path.join(dataDir, 'papierkorb', 'uploads')
    fs.mkdirSync(trash, { recursive: true })
    // Ohne Vermerk räumt der Takt eine Datei weg, die kein Verlauf nennt; so ist gezeigt, dass er läuft
    fs.writeFileSync(path.join(trash, 'erste.pdf'), PDF)
    for (let i = 0; i < 50 && fs.existsSync(path.join(trash, 'erste.pdf')); i++) await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(fs.existsSync(path.join(trash, 'erste.pdf')), false, 'der Takt läuft')
    fs.writeFileSync(path.join(dataDir, 'umgezogen.json'), JSON.stringify({ version: 1, movedTo: '/neu', at: '2026-11-01T10:15:00.000Z', appVersion: '0.15.0' }))
    fs.writeFileSync(path.join(trash, 'zweite.pdf'), PDF)
    await new Promise((resolve) => setTimeout(resolve, 1200))
    assert.ok(fs.existsSync(path.join(trash, 'zweite.pdf')), 'nach dem Vermerk wird im alten Ordner nichts mehr aufgeräumt')
  } finally {
    s.stop()
    removeDataDir(dataDir)
  }
})

// Durchsicht vor dem PR (Daten, M3): Scheitert der Austausch der Datenbank, ist nicht umgeschaltet. Dann keine
// Entscheidung „moved“ und beim nächsten Start kein Vermerk im alten Ordner, in dem weitergearbeitet werden soll.
test('Durchsicht M3: scheitert der Austausch, bleibt der Umzug offen und der alte Ordner ohne Vermerk', async () => {
  const old = await oldFolder()
  const dataDir = tempDir()
  const first = await startServerIn(dataDir, desktopEnv(old.home, { NKA_TEST_FAIL_EXCHANGE: '1' }))
  try {
    const adopted = await adopt(first.base, old.data)
    assert.equal(adopted.body.ok, false, JSON.stringify(adopted.body))
    assert.equal(fs.existsSync(path.join(dataDir, 'umzug.json')), false)
    assert.equal(fs.existsSync(path.join(dataDir, 'umzug.offen.json')), false)
  } finally {
    first.stop()
  }
  const again = await startServerIn(dataDir, desktopEnv(old.home))
  try {
    assert.equal(fs.existsSync(path.join(old.data, 'umgezogen.json')), false)
    assert.deepEqual(await again.api('/api/relocation'), { offered: true })
  } finally {
    again.stop()
    fs.rmSync(old.home, { recursive: true, force: true })
  }
})

// Durchsicht vor dem PR (Daten, K1): Der Papierkorb liegt schon im neuen Ordner, bevor die Datenbank getauscht ist;
// das Aufräumen im Takt darf ihn in dieser Zeit nicht gegen die alte Datenbank leeren.
test('Durchsicht K1: während des Umschaltens räumt der Takt den übernommenen Papierkorb nicht weg', async () => {
  const old = await oldFolder()
  fs.mkdirSync(path.join(old.data, 'papierkorb', 'uploads'), { recursive: true })
  fs.writeFileSync(path.join(old.data, 'papierkorb', 'uploads', 'geloescht.pdf'), PDF)
  const s = await startServerIn(tempDir(), desktopEnv(old.home, { NKA_TEST_SWITCH_DELAY_MS: '1500', NKA_TEST_PRIOR_INTERVAL_MS: '100' }))
  try {
    const adopting = adopt(s.base, old.data)
    for (let i = 0; i < 200; i++) {
      if ((await s.api<{ phase: string }>('/api/relocation/progress')).phase === 'switch') break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    // Mitten im Umschalten, nach mehreren Takten: Die Datei liegt da. Danach entscheidet das Aufräumen mit dem
    // übernommenen Journal (das diese ausgedachte Datei nicht nennt)
    await new Promise((resolve) => setTimeout(resolve, 900))
    assert.ok(fs.existsSync(path.join(s.dataDir, 'papierkorb', 'uploads', 'geloescht.pdf')))
    const adopted = await adopting
    assert.equal(adopted.status, 200, JSON.stringify(adopted.body))
  } finally {
    s.stop()
    fs.rmSync(old.home, { recursive: true, force: true })
  }
})

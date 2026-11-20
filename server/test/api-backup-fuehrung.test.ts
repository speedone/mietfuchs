// Datensicherung aus Nutzersicht: wann zuletzt ein Backup heruntergeladen wurde, die Erinnerung im Cockpit, das Backup
// bei nicht beschreibbarem Datenordner, die Fehlerseite hinter dem Download-Link und die Meldungen beim Wiederherstellen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import type { BackupStatus, Unit } from '../../shared/types.ts'
import { backupReminder, BACKUP_MARK_FILE, BACKUP_REMINDER_DAYS } from '../src/backupMark.ts'
import { errorOf, removeDataDir, restore, startServer, startServerIn, startServerRaw, until, waitForExit, type Server } from '../testing/api.ts'

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
const addUnit = (s: Server): Promise<Unit> => s.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 80, participates: true }) })
const statusOf = (s: Server): Promise<BackupStatus> => s.api<BackupStatus>('/api/backup/status')
// Der Server merkt sich den Zeitpunkt, wenn das Archiv ganz gesendet ist; das kann einen Augenblick nach dem letzten
// Byte beim Empfänger sein. Deshalb wartet der Helfer, bis der Stand den neuen Zeitpunkt nennt.
const recorded = async (s: Server, before: string | null): Promise<void> => {
  for (let i = 0; i < 100; i++) {
    if ((await statusOf(s)).lastDownloadAt !== before) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.fail('der Server hat sich den Zeitpunkt des Backups nicht gemerkt')
}
const download = async (s: Server): Promise<Buffer> => {
  const before = (await statusOf(s)).lastDownloadAt
  // Zwei Backups in derselben Millisekunde trügen denselben Zeitpunkt
  await new Promise((resolve) => setTimeout(resolve, 5))
  const res = await fetch(`${s.base}/api/backup`)
  assert.equal(res.status, 200, `Backup: ${res.status}`)
  const body = Buffer.from(await res.arrayBuffer())
  await recorded(s, before)
  return body
}
const daysAgo = (days: number): string => new Date(Date.now() - days * 86_400_000).toISOString()

test('Erinnerung: die Regel für sich (kein Bestand, nie, zu alt, Abschluss danach)', () => {
  const now = new Date('2026-11-20T12:00:00Z')
  const at = (days: number): string => new Date(now.getTime() - days * 86_400_000).toISOString()
  assert.equal(backupReminder({ hasStock: false, lastAt: null, latestClosedAt: null, now }), null, 'ohne Bestand gibt es nichts zu sichern')
  assert.equal(backupReminder({ hasStock: true, lastAt: null, latestClosedAt: null, now }), 'never')
  assert.equal(backupReminder({ hasStock: true, lastAt: at(BACKUP_REMINDER_DAYS), latestClosedAt: null, now }), null, 'genau an der Grenze noch nicht')
  assert.equal(backupReminder({ hasStock: true, lastAt: at(BACKUP_REMINDER_DAYS + 1), latestClosedAt: null, now }), 'old')
  assert.equal(backupReminder({ hasStock: true, lastAt: at(2), latestClosedAt: at(1), now }), 'closed')
  assert.equal(backupReminder({ hasStock: true, lastAt: at(1), latestClosedAt: at(2), now }), null, 'ein Abschluss vor dem Backup ist gesichert')
  assert.equal(backupReminder({ hasStock: true, lastAt: 'kein Datum', latestClosedAt: null, now }), 'never', 'ein unlesbarer Zeitpunkt zählt wie keiner')
})

test('Letztes Backup: der Server merkt sich den Zeitpunkt in einer eigenen Datei, nicht im Backup', async () => {
  const s = await startServer()
  try {
    assert.deepEqual(await statusOf(s), { lastDownloadAt: null, ageDays: null, reminder: null }, 'ohne Bestand keine Erinnerung')
    await addUnit(s)
    assert.equal((await statusOf(s)).reminder, 'never')
    const before = Date.now()
    await download(s)
    const status = await statusOf(s)
    assert.equal(status.reminder, null)
    assert.equal(status.ageDays, 0)
    const at = Date.parse(status.lastDownloadAt ?? assert.fail('kein Zeitpunkt gemerkt'))
    assert.ok(at >= before - 1000 && at <= Date.now() + 1000, 'der Zeitpunkt ist der des Downloads')
    assert.ok(fs.existsSync(path.join(s.dataDir, BACKUP_MARK_FILE)), 'die Datei liegt im Datenordner')
    assert.deepEqual(fs.readdirSync(s.dataDir).filter((n) => n.includes('.tmp')), [], 'keine Zwischendatei bleibt liegen')
    const names = new AdmZip(await download(s)).getEntries().map((e) => e.entryName)
    assert.ok(!names.some((n) => n.includes(BACKUP_MARK_FILE)), `die Datei gehört nicht ins Backup: ${names.join(', ')}`)
  } finally {
    s.stop()
  }
})

test('Letztes Backup: ein eingespieltes Backup bringt keinen alten Zeitpunkt mit', async () => {
  const s = await startServer()
  try {
    await addUnit(s)
    const backup = await download(s)
    fs.rmSync(path.join(s.dataDir, BACKUP_MARK_FILE))
    assert.equal((await restore(s, backup)).status, 200)
    assert.equal((await statusOf(s)).lastDownloadAt, null)
  } finally {
    s.stop()
  }
})

test('Erinnerung: ein altes Backup und ein Abschluss seit dem Backup', async () => {
  const s = await startServer()
  try {
    await addUnit(s)
    fs.writeFileSync(path.join(s.dataDir, BACKUP_MARK_FILE), JSON.stringify({ version: 1, at: daysAgo(BACKUP_REMINDER_DAYS + 10) }), 'utf8')
    const old = await statusOf(s)
    assert.equal(old.reminder, 'old')
    assert.equal(old.ageDays, BACKUP_REMINDER_DAYS + 10)
    fs.writeFileSync(path.join(s.dataDir, BACKUP_MARK_FILE), JSON.stringify({ version: 1, at: daysAgo(1) }), 'utf8')
    assert.equal((await statusOf(s)).reminder, null)
    const closed = await fetch(`${s.base}/api/settlement/2025/close`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    assert.equal(closed.status, 201)
    assert.equal((await statusOf(s)).reminder, 'closed')
    await download(s)
    assert.equal((await statusOf(s)).reminder, null)
    // Eine verdorbene Datei ist kein Fehler, sie zählt wie keine
    fs.writeFileSync(path.join(s.dataDir, BACKUP_MARK_FILE), '{ kaputt', 'utf8')
    assert.equal((await statusOf(s)).reminder, 'never')
  } finally {
    s.stop()
  }
})

test('Backup: bei nicht beschreibbarem Datenordner entsteht das Archiv trotzdem, ohne Datei im Ordner', async (t) => {
  if (process.getuid?.() === 0) return t.skip('läuft als root, Dateirechte greifen dann nicht')
  const s = await startServer()
  try {
    const unit = await addUnit(s)
    fs.chmodSync(s.dataDir, 0o555)
    const leftBefore = new Set(fs.readdirSync(os.tmpdir()))
    const res = await fetch(`${s.base}/api/backup`)
    assert.equal(res.status, 200, `erwartet ein Archiv, bekommen ${res.status}: ${res.status === 200 ? '' : await res.text()}`)
    const zip = new AdmZip(Buffer.from(await res.arrayBuffer()))
    await recorded(s, null)
    assert.ok(zip.getEntry('mietfuchs.sqlite'), 'das Archiv enthält die Datenbank')
    assert.ok(!fs.existsSync(path.join(s.dataDir, BACKUP_MARK_FILE)), 'im schreibgeschützten Ordner entsteht keine Datei')
    // Der Schnappschuss lag in einem eigenen Ordner für Zwischendateien, und der ist wieder weg
    assert.deepEqual(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('mietfuchs-backup-') && !leftBefore.has(n)), [])
    assert.doesNotMatch(s.errorOutput(), /Unhandled|TypeError/, s.errorOutput())
    // Gemerkt wird der Zeitpunkt dann nur, solange der Server läuft; die Erinnerung bleibt also aus.
    assert.equal((await statusOf(s)).reminder, null)
    fs.chmodSync(s.dataDir, 0o755)
    assert.deepEqual((await s.api<Unit[]>('/api/units')).map((u) => u.id), [unit.id])
  } finally {
    fs.chmodSync(s.dataDir, 0o755)
    s.stop()
  }
})

test('Backup: der Link im Browser bekommt bei einem Fehler eine lesbare Seite, kein nacktes JSON', async () => {
  const dataDir = tempDir()
  fs.writeFileSync(path.join(dataDir, 'mietfuchs.sqlite'), 'Das ist ein Brief und keine Datenbank.', 'utf8')
  const s = await startServerIn(dataDir)
  try {
    // So fragt ein Browser, der einem Link folgt
    const res = await fetch(`${s.base}/api/backup`, { headers: { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' } })
    assert.equal(res.status, 503)
    assert.match(res.headers.get('content-type') ?? '', /text\/html/)
    const page = await res.text()
    assert.match(page, /<html lang="de">/)
    assert.match(page, /kann gerade kein Backup erstellen/)
    assert.match(page, /Zurück zu Mietfuchs/)
    assert.doesNotMatch(page, /\{"error"/)
    // Wer JSON erwartet (Skripte, Tests, die Oberfläche über `api()`), bekommt es weiter
    const json = await fetch(`${s.base}/api/backup`)
    assert.match(json.headers.get('content-type') ?? '', /json/)
    // Und in dieser Lage gibt es weder einen Zeitpunkt noch eine Erinnerung: Woran es liegt, sagt der Hinweis oben.
    assert.equal(fs.existsSync(path.join(dataDir, BACKUP_MARK_FILE)), false)
  } finally {
    s.stop()
  }
})

test('Wiederherstellen: was kein ZIP ist, nennt den unvollständigen Download und sagt, dass nichts geändert wurde', async () => {
  const s = await startServer()
  try {
    const unit = await addUnit(s)
    const backup = await download(s)
    const cases: Record<string, Buffer> = {
      Zufallsbytes: Buffer.from(Array.from({ length: 2048 }, (_, i) => (i * 37 + 11) % 256)),
      Textdatei: Buffer.from('Nur ein Text, kein Archiv.'),
      'abgeschnittener Download': backup.subarray(0, Math.floor(backup.length / 2)),
    }
    for (const [name, content] of Object.entries(cases)) {
      const r = await restore(s, content)
      assert.equal(r.status, 400, name)
      const text = errorOf(r.body)
      assert.match(text, /kein gültiges ZIP-Archiv/, name)
      assert.match(text, /nicht vollständig heruntergeladen/, `${name}: ${text}`)
      assert.match(text, /Ihre bisherigen Daten sind unverändert/, `${name}: ${text}`)
    }
    assert.deepEqual((await s.api<Unit[]>('/api/units')).map((u) => u.id), [unit.id])
  } finally {
    s.stop()
  }
})

test('Umgezogener Ordner: ein Backup schreibt dort keine Datei', async () => {
  const dataDir = tempDir()
  const first = await startServerIn(dataDir)
  await addUnit(first)
  first.child.kill()
  await waitForExit(first.child)
  fs.writeFileSync(path.join(dataDir, 'umgezogen.json'), JSON.stringify({ version: 1, movedTo: '/anderswo', at: new Date().toISOString(), appVersion: '0.18.0' }), 'utf8')
  const s = await startServerIn(dataDir)
  try {
    await download(s)
    assert.equal(fs.existsSync(path.join(dataDir, BACKUP_MARK_FILE)), false)
    assert.equal((await statusOf(s)).reminder, null, 'im umgezogenen Ordner wird nicht erinnert')
  } finally {
    s.stop()
  }
})

test('Start im schreibgeschützten Ordner ohne db.json: die Konsole verweist nicht auf eine db.json, die es nicht gibt', async (t) => {
  if (process.getuid?.() === 0) return t.skip('läuft als root, Dateirechte greifen dann nicht')
  for (const withJson of [false, true]) {
    const dataDir = tempDir()
    fs.mkdirSync(path.join(dataDir, 'uploads'))
    if (withJson) fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], settings: {} }), 'utf8')
    fs.chmodSync(dataDir, 0o555)
    const s = startServerRaw(dataDir, { NKA_PORT: '0' })
    try {
      await until(() => /läuft auf/.test(s.out()), 20000)
      await until(() => /Datenbank: nicht geöffnet/.test(s.out()), 5000)
      const out = s.out()
      if (withJson) {
        assert.match(out, /arbeitet weiter mit .*db\.json; es geht nichts verloren/, out)
      } else {
        assert.doesNotMatch(out, /arbeitet weiter mit/, out)
        assert.match(out, /startet ohne Daten/, out)
        assert.match(out, /nichts geändert/, out)
      }
    } finally {
      s.child.kill()
      await waitForExit(s.child)
      fs.chmodSync(dataDir, 0o755)
      removeDataDir(dataDir)
    }
  }
})

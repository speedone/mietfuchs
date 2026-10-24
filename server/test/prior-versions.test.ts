// Automatische Vorversionen der Datenbank (#318): die Auswahl ohne Server.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  PRIOR_DIR, createPriorVersion, mayCreatePriorVersion, priorVersionsBlocked, listPriorVersions, priorVersionDue, priorVersionName, priorVersionTime, priorVersionsToDrop, type PriorVersion,
} from '../src/db/priorVersions.ts'
import { openFreshDatabase } from '../testing/freshDatabase.ts'
import { units } from '../src/db/schema.ts'
import { connect } from '../src/db/client.ts'
import { archiveDatabaseProblem, writeDatabaseSnapshot } from '../src/db/backup.ts'
import type { DatabaseState } from '../../shared/types.ts'

const version = (iso: string): PriorVersion => ({ name: priorVersionName(new Date(iso)), createdAt: new Date(iso).toISOString(), size: 1 })

test('Vorversionen: Der Name trägt den Zeitpunkt in UTC und lässt sich zurücklesen', () => {
  const at = new Date('2026-10-23T08:15:09Z')
  assert.equal(priorVersionName(at), 'vorversion-2026-10-23-081509.sqlite')
  assert.equal(priorVersionTime('vorversion-2026-10-23-081509.sqlite')?.toISOString(), at.toISOString())
})

test('Vorversionen: Fremde Namen, Pfade und unmögliche Tage gelten nicht', () => {
  for (const name of [
    '../vorversion-2026-10-23-081509.sqlite',
    'vorversionen/vorversion-2026-10-23-081509.sqlite',
    'vorversion-2026-02-31-081509.sqlite',
    'vorversion-2026-10-23-081509.sqlite.tmp',
    'mietfuchs.sqlite',
    '.entsteht-vorversion-2026-10-23-081509.sqlite',
  ]) assert.equal(priorVersionTime(name), null, name)
})

test('Vorversionen: fällig ohne Vorversion und erst, wenn die jüngste älter als sieben Tage ist', () => {
  const now = new Date('2026-10-23T12:00:00Z')
  assert.equal(priorVersionDue([], now), true)
  assert.equal(priorVersionDue([version('2026-10-16T12:00:00Z')], now), false) // genau sieben Tage
  assert.equal(priorVersionDue([version('2026-10-16T11:59:59Z')], now), true)
  assert.equal(priorVersionDue([version('2026-10-01T00:00:00Z'), version('2026-10-20T00:00:00Z')], now), false)
  // Mehr als einen Tag in der Zukunft zählt sie nicht (Durchsicht K3, unten).
  assert.equal(priorVersionDue([version('2026-12-01T00:00:00Z')], now), true)
})

test('Vorversionen: Behalten werden die vier jüngsten, die älteste fällt weg', () => {
  const list = ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29'].map((d) => version(`${d}T00:00:00Z`))
  assert.deepEqual(priorVersionsToDrop(list), [list[0].name])
  assert.deepEqual(priorVersionsToDrop(list.slice(1)), [])
})

test('Vorversionen: die Liste zeigt nur eigene Dateien, die jüngste zuerst', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-vorversionen-'))
  try {
    fs.mkdirSync(path.join(dir, PRIOR_DIR))
    for (const name of ['vorversion-2026-09-01-000000.sqlite', 'vorversion-2026-10-01-000000.sqlite', 'notiz.txt', '.entsteht-vorversion-2026-10-02-000000.sqlite']) {
      fs.writeFileSync(path.join(dir, PRIOR_DIR, name), 'x')
    }
    assert.deepEqual(listPriorVersions(dir).map((v) => v.name), ['vorversion-2026-10-01-000000.sqlite', 'vorversion-2026-09-01-000000.sqlite'])
    assert.deepEqual(listPriorVersions(path.join(dir, 'gibt-es-nicht')), [])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Vorversionen: Eine leere Datenbank bekommt keine, eine mit Bestand schon, und es bleiben vier', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-vorversionen-'))
  const opened = await openFreshDatabase(dir)
  try {
    assert.equal(await createPriorVersion(opened, dir, new Date('2026-10-23T08:00:00Z')), null)
    assert.deepEqual(listPriorVersions(dir), [])

    await opened.write((db) => db.insert(units).values({ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true, selfUsed: false }))
    const names: (string | null)[] = []
    for (const day of ['2026-09-01', '2026-09-09', '2026-09-17', '2026-09-25', '2026-10-03']) {
      names.push(await createPriorVersion(opened, dir, new Date(`${day}T08:00:00Z`)))
    }
    assert.ok(names.every((n) => n !== null))
    // Am selben Tag noch einmal: nicht fällig.
    assert.equal(await createPriorVersion(opened, dir, new Date('2026-10-04T08:00:00Z')), null)
    const list = listPriorVersions(dir)
    assert.equal(list.length, 4)
    assert.equal(list[0].name, 'vorversion-2026-10-03-080000.sqlite')
    assert.ok(!list.some((v) => v.name === names[0]), 'die älteste fällt weg')
    // Kein Zwischenstand bleibt liegen.
    assert.deepEqual(fs.readdirSync(path.join(dir, PRIOR_DIR)).filter((n) => n.startsWith('.')), [])
  } finally {
    opened.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ---------- Durchsicht zu PR #416 ----------

type StateChange = Omit<Partial<DatabaseState>, 'changeover'> & { changeover?: Partial<DatabaseState['changeover']> }
const state = (over: StateChange = {}): DatabaseState => ({
  open: true, file: 'mietfuchs.sqlite', migrations: 0, detail: 'geöffnet', migrated: null,
  ...over,
  changeover: { state: 'none', message: '', notes: [], ...over.changeover },
})

test('Durchsicht K3: Eine Vorversion mehr als einen Tag in der Zukunft zählt nicht als jüngste', () => {
  const now = new Date('2026-10-23T12:00:00Z')
  assert.equal(priorVersionDue([version('2026-10-25T12:00:00Z')], now), true)
  assert.equal(priorVersionDue([version('2026-10-24T06:00:00Z')], now), false) // weniger als ein Tag: Uhrenabweichung
  assert.equal(priorVersionDue([version('2026-10-30T00:00:00Z'), version('2026-10-20T00:00:00Z')], now), false)
})

test('Durchsicht K8: Ohne tragende Datenbank und während eines Wiederherstellens entsteht keine Vorversion', () => {
  assert.equal(mayCreatePriorVersion(state(), false), true)
  assert.equal(mayCreatePriorVersion(state(), true), false)
  assert.equal(mayCreatePriorVersion(state({ open: false }), false), false)
  assert.equal(mayCreatePriorVersion(state({ changeover: { state: 'failed' } }), false), false)
  assert.equal(mayCreatePriorVersion(state({ changeover: { state: 'stale', pending: true } }), false), false)
})

test('Durchsicht S1: Gesperrt sind die Vorversionen nur, wenn die Daten noch in der db.json stehen', () => {
  assert.equal(priorVersionsBlocked(state()), null)
  assert.equal(priorVersionsBlocked(state({ open: false, detail: 'ist beschädigt' })), null) // der Rettungsfall
  assert.equal(priorVersionsBlocked(state({ changeover: { state: 'stale' } })), null)
  assert.notEqual(priorVersionsBlocked(state({ changeover: { state: 'failed' } })), null)
  assert.notEqual(priorVersionsBlocked(state({ open: false, changeover: { state: 'failed' } })), null)
  assert.notEqual(priorVersionsBlocked(state({ changeover: { state: 'stale', pending: true } })), null)
})

async function withStockDb(fn: (opened: Awaited<ReturnType<typeof openFreshDatabase>>, dir: string) => Promise<void>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-vorversionen-'))
  const opened = await openFreshDatabase(dir)
  try {
    await opened.write((db) => db.insert(units).values({ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true, selfUsed: false }))
    await fn(opened, dir)
  } finally {
    opened.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test('Durchsicht K1: Beginnt ein Wiederherstellen, während die Vorversion wartet, entsteht keine', async () => {
  await withStockDb(async (opened, dir) => {
    assert.equal(await createPriorVersion(opened, dir, new Date('2026-10-23T08:00:00Z'), { skip: () => true }), null)
    assert.deepEqual(listPriorVersions(dir), [])
  })
})

test('Durchsicht K4/K8: Ist die neue Vorversion nicht unversehrt, wird sie verworfen und nichts rotiert', async () => {
  await withStockDb(async (opened, dir) => {
    fs.mkdirSync(path.join(dir, PRIOR_DIR))
    const old = ['2026-08-01', '2026-08-09', '2026-08-17', '2026-08-25'].map((d) => priorVersionName(new Date(`${d}T08:00:00Z`)))
    for (const name of old) fs.writeFileSync(path.join(dir, PRIOR_DIR, name), 'alt')
    await assert.rejects(
      createPriorVersion(opened, dir, new Date('2026-10-23T08:00:00Z'), {
        afterSnapshot: (file) => {
          const bytes = fs.readFileSync(file)
          bytes.fill(0x5a, 4096, 8192)
          fs.writeFileSync(file, bytes)
        },
      }),
      /nicht unversehrt|beschädigt/,
    )
    assert.deepEqual(listPriorVersions(dir).map((v) => v.name).sort(), [...old].sort())
    assert.deepEqual(fs.readdirSync(path.join(dir, PRIOR_DIR)).filter((n) => n.startsWith('.')), [])
  })
})

test('Durchsicht S3: Keine Meldung zu einer Sicherung im Datenordner spricht von Archiv oder Backup', async () => {
  await withStockDb(async (opened, dir) => {
    const messages: string[] = []
    const kaputt = path.join(dir, 'kaputt.sqlite')
    fs.writeFileSync(kaputt, 'keine Datenbank')
    messages.push(await archiveDatabaseProblem(kaputt, 'priorVersion') ?? '')

    const neuer = path.join(dir, 'neuer.sqlite')
    await writeDatabaseSnapshot(opened, neuer)
    const c1 = await connect(neuer)
    c1.exec("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('kennen-wir-nicht', 1893456000000)")
    c1.close()
    messages.push(await archiveDatabaseProblem(neuer, 'priorVersion') ?? '')

    const waise = path.join(dir, 'waise.sqlite')
    await writeDatabaseSnapshot(opened, waise)
    const c2 = await connect(waise)
    c2.exec("INSERT INTO cost_items (id, property_id, period, category, description, amount_cents, key) VALUES ('c1', 'objekt-1', '2025-05', 'Grundsteuer', 'Grundsteuer', 100, 'area')")
    c2.close()
    messages.push(await archiveDatabaseProblem(waise, 'priorVersion') ?? '')

    for (const m of messages) {
      assert.ok(m.length > 0, 'jede dieser Dateien wird beanstandet')
      assert.doesNotMatch(m, /Archiv|Backup/, m)
      assert.match(m, /Sicherung/, m)
    }
    // Der Weg übers Backup sagt weiterhin Archiv.
    assert.match(await archiveDatabaseProblem(kaputt) ?? '', /Archiv/)
  })
})

test('Durchsicht S3: Jede Meldung in archiveDatabaseProblem nimmt ihre Bezeichnung aus dem Parameter', () => {
  // Am Verhalten lassen sich nicht alle Zweige billig herbeiführen (Migration scheitert, Heizanlagen);
  // deshalb prüft dieser Wächter den Quelltext: In den Meldungen steht kein festes „Archiv“ oder „Backup“.
  const source = fs.readFileSync(new URL('../src/db/backup.ts', import.meta.url), 'utf8')
  const start = source.indexOf('export async function archiveDatabaseProblem')
  const body = source.slice(start, source.indexOf('// ---------- Ende der Prüfung', start))
  assert.ok(start > 0 && body.length > 200, 'Rumpf gefunden')
  const literals = [...body.matchAll(/`[^`]*`|'[^'\n]*'/g)].map((m) => m[0])
  for (const l of literals) assert.doesNotMatch(l, /Archiv|Backup/, l)
})

// Sicherungspunkte in der Zeitachse des Verlaufs (#318): Namen, Zeitpunkte, Titel, Aufräumen und Einsortieren, ohne
// Server. Die Wege über die Routen stehen in api-sicherungspunkte.test.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadMigrations } from '../src/db/client.ts'
import {
  cleanSnapshots, interleaveSnapshots, listSnapshots, parseSnapshotName, snapshotLastGroup, snapshotsToDrop, SNAPSHOT_KEEP, type SnapshotPoint,
} from '../src/db/snapshots.ts'
import { RELEASE_STEPS, releaseStepsOf, versionBringing } from '../src/db/releaseSteps.ts'
import { PRIOR_DIR } from '../src/db/priorVersions.ts'
import { APP_VERSION } from '../src/version.ts'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
const DAY = 24 * 60 * 60 * 1000
const tags = async () => (await loadMigrations()).map((m) => m.tag)

test('Sicherungspunkte: jede Art hat ihr eigenes Muster, fremde Namen und Pfade gelten nicht', async () => {
  const known = new Set(await tags())
  assert.deepEqual(parseSnapshotName('vorversion-2026-10-01-081500.sqlite', known), { type: 'weekly', at: new Date('2026-10-01T08:15:00.000Z'), tag: null })
  assert.deepEqual(parseSnapshotName('mietfuchs.sqlite.vor-0001_objekte', known), { type: 'update', at: null, tag: '0001_objekte' })
  assert.deepEqual(parseSnapshotName('mietfuchs.sqlite.vor-0001_objekte.vom-2026-03-04-0506', known), { type: 'update', at: new Date('2026-03-04T05:06:00.000Z'), tag: '0001_objekte' })
  assert.deepEqual(parseSnapshotName('mietfuchs.sqlite.vor-0001_objekte.vom-2026-03-04-0506-2', known), { type: 'update', at: new Date('2026-03-04T05:06:00.000Z'), tag: '0001_objekte' })
  assert.deepEqual(parseSnapshotName('mietfuchs.sqlite.vor-restore', known), { type: 'restore', at: null, tag: null })
  assert.deepEqual(parseSnapshotName('mietfuchs.sqlite.vor-restore.vom-2026-03-04-0506', known), { type: 'restore', at: new Date('2026-03-04T05:06:00.000Z'), tag: null })
  for (const bad of [
    'mietfuchs.sqlite', 'db.json.vor-restore', 'mietfuchs.sqlite.vor-9999_unbekannt', 'mietfuchs.sqlite.vor-0001_objekte-journal',
    'mietfuchs.sqlite.vor-restore-journal', 'mietfuchs.sqlite.vor-restore.vom-2026-02-31-0000', 'mietfuchs.sqlite.vor-restore.vom-2026-03-04-2560',
    '../mietfuchs.sqlite.vor-restore', 'vorversionen/vorversion-2026-10-01-081500.sqlite', 'mietfuchs.sqlite.vor-0001_objekte.vom-2026-03-04-0506.x',
    'mietfuchs.sqlite.restore-0123456789abcdef', 'mietfuchs.sqlite.vor-restore/', '',
  ]) {
    assert.equal(parseSnapshotName(bad, known), null, bad)
  }
})

test('Sicherungspunkte: Zeitpunkt aus dem Namen, sonst aus der Merkdatei oder der Datei, mit Kennzeichnung', async () => {
  const dir = tmp()
  const all = await tags()
  fs.mkdirSync(path.join(dir, PRIOR_DIR))
  fs.writeFileSync(path.join(dir, PRIOR_DIR, 'vorversion-2026-10-01-081500.sqlite'), 'a')
  fs.writeFileSync(path.join(dir, PRIOR_DIR, 'fremd.sqlite'), 'a')
  fs.writeFileSync(path.join(dir, 'mietfuchs.sqlite.vor-0001_objekte'), 'bb')
  fs.writeFileSync(path.join(dir, 'mietfuchs.sqlite.vor-0001_objekte.vom-2026-03-04-0506'), 'ccc')
  fs.writeFileSync(path.join(dir, 'mietfuchs.sqlite.vor-0075_verlauf_ruecksprung'), 'dddd')
  fs.writeFileSync(path.join(dir, 'mietfuchs.sqlite.vor-restore'), 'eeeee')
  fs.writeFileSync(path.join(dir, 'mietfuchs.sqlite.vor-restore-journal'), 'x')
  fs.writeFileSync(path.join(dir, 'mietfuchs.sqlite'), 'x')
  fs.writeFileSync(path.join(dir, 'db.json.vor-restore'), 'x')
  const fileTime = new Date('2026-05-06T07:08:09.000Z')
  fs.utimesSync(path.join(dir, 'mietfuchs.sqlite.vor-restore'), fileTime, fileTime)
  fs.utimesSync(path.join(dir, 'mietfuchs.sqlite.vor-0075_verlauf_ruecksprung'), fileTime, fileTime)
  const notice = { steps: 3, backup: 'mietfuchs.sqlite.vor-0001_objekte', at: '2026-04-01T10:00:00.000Z', version: '0.12.0' }
  const list = listSnapshots(dir, all, notice)
  const byName = new Map(list.map((p) => [p.name, p]))
  assert.deepEqual(list.map((p) => p.name).sort(), [
    'mietfuchs.sqlite.vor-0001_objekte', 'mietfuchs.sqlite.vor-0001_objekte.vom-2026-03-04-0506', 'mietfuchs.sqlite.vor-0075_verlauf_ruecksprung',
    'mietfuchs.sqlite.vor-restore', 'vorversion-2026-10-01-081500.sqlite',
  ])
  assert.deepEqual(list.map((p) => p.at), [...list.map((p) => p.at)].sort().reverse(), 'die jüngste zuerst')
  const weekly = byName.get('vorversion-2026-10-01-081500.sqlite')
  assert.deepEqual(weekly && { type: weekly.type, at: weekly.at, timeFrom: weekly.timeFrom, title: weekly.title, size: weekly.size }, {
    type: 'weekly', at: '2026-10-01T08:15:00.000Z', timeFrom: 'name', title: 'Wöchentliche Sicherung', size: 1,
  })
  // Die Merkdatei nennt Zeitpunkt und Version der Sicherung, die sie meint.
  const update = byName.get('mietfuchs.sqlite.vor-0001_objekte')
  assert.deepEqual(update && { at: update.at, timeFrom: update.timeFrom, version: update.version, title: update.title }, {
    at: '2026-04-01T10:00:00.000Z', timeFrom: 'notice', version: '0.12.0', title: 'Vor dem Update auf Version 0.12.0',
  })
  // Beiseitegelegt: Zeitpunkt aus dem Namen, Version aus dem Schritt (0001 kam mit 0.9.0).
  const setAside = byName.get('mietfuchs.sqlite.vor-0001_objekte.vom-2026-03-04-0506')
  assert.deepEqual(setAside && { at: setAside.at, timeFrom: setAside.timeFrom, version: setAside.version, title: setAside.title }, {
    at: '2026-03-04T05:06:00.000Z', timeFrom: 'name', version: '0.9.0', title: 'Vor dem Update auf Version 0.9.0',
  })
  // Ohne Merkdatei: Zeitpunkt aus der Datei, Version aus dem Schritt. Enthält ihn noch keine veröffentlichte Version (ein
  // Stand von main zwischen zwei Releases), bleibt sie leer; mit dem Release nennt sie die neue. Abgeleitet, damit der
  // Test vor und nach dem Eintrag in RELEASE_STEPS gilt.
  const late = byName.get('mietfuchs.sqlite.vor-0075_verlauf_ruecksprung')
  const lateVersion = versionBringing(all.indexOf('0075_verlauf_ruecksprung'))
  assert.deepEqual(late && { at: late.at, timeFrom: late.timeFrom, version: late.version, title: late.title }, {
    at: fileTime.toISOString(), timeFrom: 'file', version: lateVersion,
    title: lateVersion ? `Vor dem Update auf Version ${lateVersion}` : 'Vor einem Update',
  })
  const restore = byName.get('mietfuchs.sqlite.vor-restore')
  assert.deepEqual(restore && { at: restore.at, timeFrom: restore.timeFrom, title: restore.title }, {
    at: fileTime.toISOString(), timeFrom: 'file', title: 'Vor dem Einspielen eines Backups',
  })
  // Ohne Merkdatei gilt für die Sicherung vor dem Update die Dateizeit und die Version aus dem Schritt.
  const plain = listSnapshots(dir, all, null).find((p) => p.name === 'mietfuchs.sqlite.vor-0001_objekte')
  assert.deepEqual(plain && { timeFrom: plain.timeFrom, version: plain.version }, { timeFrom: 'file', version: '0.9.0' })
  // Fehlt der Ordner ganz, gibt es keine.
  assert.deepEqual(listSnapshots(path.join(dir, 'fehlt'), all, null), [])
})

test('Sicherungspunkte: Versionen je Schritt aus den veröffentlichten Versionen', async () => {
  const count = (await tags()).length
  assert.equal(versionBringing(0), '0.8.0')
  assert.equal(versionBringing(1), '0.9.0')
  assert.equal(versionBringing(11), '0.9.0')
  assert.equal(versionBringing(12), '0.10.0')
  assert.equal(versionBringing(62), '0.12.0')
  assert.equal(versionBringing(63), '0.13.0')
  // Ein Schritt nach der jüngsten veröffentlichten Version gehört noch zu keiner.
  const last = RELEASE_STEPS.at(-1) ?? assert.fail('RELEASE_STEPS leer')
  assert.equal(versionBringing(last.steps - 1), last.version)
  assert.equal(versionBringing(last.steps), null)
  assert.equal(releaseStepsOf('0.11.3'), 56)
  assert.equal(releaseStepsOf('0.12.0'), 63)
  assert.equal(releaseStepsOf('0.7.1'), 0)
  // Die Liste steigt, und keine Version nennt mehr Schritte, als es gibt.
  for (let i = 1; i < RELEASE_STEPS.length; i++) assert.ok(RELEASE_STEPS[i].steps > RELEASE_STEPS[i - 1].steps, RELEASE_STEPS[i].version)
  assert.ok(RELEASE_STEPS.every((r) => r.steps <= count))
})

// Wächter für das Release: Wer die Version auf eine neue Nebenversion hebt, trägt ein, wie viele Schritte sie bringt,
// sonst hieße jede Sicherung vor dem Update auf sie nur „Vor einem Update“.
test('Sicherungspunkte: Die laufende Nebenversion steht in RELEASE_STEPS', () => {
  const [major, minor] = APP_VERSION.split('.')
  assert.ok(RELEASE_STEPS.some((r) => r.version === `${major}.${minor}.0`), `${major}.${minor}.0 fehlt in server/src/db/releaseSteps.ts`)
})

const point = (name: string, type: SnapshotPoint['type'], at: string): SnapshotPoint =>
  ({ kind: 'snapshot', name, type, at, timeFrom: 'name', size: 1, version: null, title: '' })

test('Sicherungspunkte: Aufräumen behält je Art die drei jüngsten und alles aus zwölf Monaten, die genannte immer', () => {
  const now = new Date('2026-10-24T12:00:00.000Z')
  const ago = (days: number) => new Date(now.getTime() - days * DAY).toISOString()
  const list = [
    point('u1', 'update', ago(10)), point('u2', 'update', ago(400)), point('u3', 'update', ago(500)), point('u4', 'update', ago(600)),
    point('u5', 'update', ago(700)), point('u6', 'update', ago(800)),
    point('r1', 'restore', ago(380)), point('r2', 'restore', ago(390)), point('r3', 'restore', ago(395)), point('r4', 'restore', ago(398)),
    point('w1', 'weekly', ago(1000)),
  ]
  assert.equal(SNAPSHOT_KEEP, 3)
  // u1 (jung), u2, u3 (die drei jüngsten); u4 bis u6 fallen. Die wöchentlichen räumt priorVersions.ts.
  assert.deepEqual(snapshotsToDrop(list, now, null).sort(), ['r4', 'u4', 'u5', 'u6'])
  // Die Datei, die der offene Hinweis nach dem Update nennt, bleibt.
  assert.deepEqual(snapshotsToDrop(list, now, 'u5').sort(), ['r4', 'u4', 'u6'])
  // Innerhalb von zwölf Monaten bleibt jede, auch über drei hinaus.
  const recent = [1, 2, 3, 4, 5].map((d) => point(`n${d}`, 'restore', ago(d * 30)))
  assert.deepEqual(snapshotsToDrop(recent, now, null), [])
})

test('Sicherungspunkte: Aufräumen fasst nur Sicherungen an, nie andere Dateien', async () => {
  const dir = tmp()
  const all = await tags()
  const old = new Date(Date.now() - 900 * DAY)
  const names = ['mietfuchs.sqlite.vor-restore', 'mietfuchs.sqlite.vor-restore.vom-2020-01-01-0000', 'mietfuchs.sqlite.vor-restore.vom-2020-01-02-0000',
    'mietfuchs.sqlite.vor-restore.vom-2020-01-03-0000', 'mietfuchs.sqlite.vor-restore.vom-2020-01-04-0000']
  for (const n of names) fs.writeFileSync(path.join(dir, n), 'x')
  fs.utimesSync(path.join(dir, 'mietfuchs.sqlite.vor-restore'), old, old)
  const others = ['mietfuchs.sqlite', 'db.json.vor-restore', 'mietfuchs.sqlite.vor-restore-journal', 'mietfuchs.sqlite.vor-restore.vom-2019-01-01-0000.bak', 'notiz.txt']
  for (const n of others) {
    fs.writeFileSync(path.join(dir, n), 'x')
    fs.utimesSync(path.join(dir, n), old, old)
  }
  fs.mkdirSync(path.join(dir, 'mietfuchs.sqlite.vor-restore.vom-2018-01-01-0000'))
  const removed = cleanSnapshots(dir, all, new Date(), null)
  // Alle älter als zwölf Monate: Es bleiben die drei jüngsten (die ohne Zusatz nach ihrer Dateizeit, dann die vom
  // 04. und 03.01.2020).
  assert.deepEqual(removed.sort(), ['mietfuchs.sqlite.vor-restore.vom-2020-01-01-0000', 'mietfuchs.sqlite.vor-restore.vom-2020-01-02-0000'])
  for (const n of others) assert.ok(fs.existsSync(path.join(dir, n)), n)
  assert.ok(fs.existsSync(path.join(dir, 'mietfuchs.sqlite.vor-restore.vom-2018-01-01-0000')), 'ein Ordner bleibt')
})

test('Sicherungspunkte: Einsortiert nach der Zeit, je Seite nur zwischen ihren Gruppen, mit Zeitraumfilter', () => {
  const g = (id: number, at: string) => ({ id, at })
  const s = (name: string, at: string) => point(name, 'weekly', at)
  const snaps = [s('neu', '2026-10-20T00:00:00.000Z'), s('mitte', '2026-10-10T00:00:00.000Z'), s('alt', '2026-01-01T00:00:00.000Z')]
  const page1 = [g(9, '2026-10-22T00:00:00.000Z'), g(8, '2026-10-15T00:00:00.000Z')]
  const names = (items: ReturnType<typeof interleaveSnapshots<{ id: number, at: string }>>) =>
    items.map((i) => ('kind' in i && i.kind === 'snapshot' ? i.name : `#${(i as { id: number }).id}`))
  // Erste Seite, es folgt noch eine: nur, was nicht älter ist als ihre älteste Gruppe.
  assert.deepEqual(names(interleaveSnapshots(page1, snaps, { beforeAt: null, last: false, from: null, to: null })), ['#9', 'neu', '#8'])
  // Folgeseite (letzte): alles vor der Gruppe, ab der geblättert wird.
  const page2 = [g(7, '2026-10-12T00:00:00.000Z')]
  assert.deepEqual(names(interleaveSnapshots(page2, snaps, { beforeAt: '2026-10-15T00:00:00.000Z', last: true, from: null, to: null })), ['#7', 'mitte', 'alt'])
  // Ohne Gruppen und ohne Blättern: alle.
  assert.deepEqual(names(interleaveSnapshots([], snaps, { beforeAt: null, last: true, from: null, to: null })), ['neu', 'mitte', 'alt'])
  // Der Zeitraum gilt auch für sie (`to` ausschließlich).
  assert.deepEqual(names(interleaveSnapshots([], snaps, { beforeAt: null, last: true, from: '2026-10-01T00:00:00.000Z', to: '2026-10-20T00:00:00.000Z' })), ['mitte'])
})

// Durchsicht von PR #442, K2: Das Nachsehen in einer Sicherung legt nie eine Datei an (SQLite legt beim Öffnen einer
// fehlenden Datei eine leere an, mit dem Namen einer Sicherung).
test('Durchsicht K2: Eine fehlende Sicherung wird beim Nachsehen nicht angelegt', async () => {
  const dir = tmp()
  const file = path.join(dir, 'mietfuchs.sqlite.vor-restore')
  assert.equal(await snapshotLastGroup(file), null)
  assert.equal(fs.existsSync(file), false)
})

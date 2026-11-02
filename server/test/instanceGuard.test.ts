// Zwei Mietfuchs auf demselben Datenordner (#517, Durchsicht M2): die Regeln ohne Server. Die echten Starts prüft
// api-zweimal.test.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findTwin, readRunFile, removeRunFile, reportedDataDir, RUN_FILE, sameDir, writeRunFile, yieldsTo, type Self } from '../src/instanceGuard.ts'
import { ciSet } from '../src/ci.ts'
import { relocationHome } from '../src/relocation.ts'
import { shouldRecord } from '../src/dataLocations.ts'

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-zweimal-'))

test('Lauf-Datei: schreiben, lesen, nur die eigene entfernen', () => {
  const d = dir()
  try {
    assert.equal(writeRunFile(d, { version: 1, port: 17517, pid: 42, startedAt: 'x', appVersion: '0.15.0' }), true)
    assert.equal(readRunFile(d)?.port, 17517)
    removeRunFile(d, 43)
    assert.ok(fs.existsSync(path.join(d, RUN_FILE)))
    removeRunFile(d, 42)
    assert.equal(fs.existsSync(path.join(d, RUN_FILE)), false)
    // Ein nicht beschreibbarer Ordner hält keinen Start auf
    assert.equal(writeRunFile(path.join(d, 'gibt-es-nicht'), { version: 1, port: 1, pid: 1, startedAt: 'x', appVersion: 'y' }), false)
    fs.writeFileSync(path.join(d, RUN_FILE), 'kaputt')
    assert.equal(readRunFile(d), null)
  } finally {
    fs.rmSync(d, { recursive: true, force: true })
  }
})

test('Datenordner aus /healthz: ab 0.15 dataDir, davor der Ordner der Datenbank, umgezogen nie', () => {
  assert.equal(reportedDataDir({ app: 'mietfuchs', dataDir: '/a' }, 'linux'), '/a')
  assert.equal(reportedDataDir({ app: 'mietfuchs', database: { file: 'C:\\Users\\X\\Mietfuchs\\mietfuchs.sqlite' } }, 'win32'), 'C:\\Users\\X\\Mietfuchs')
  assert.equal(reportedDataDir({ app: 'mietfuchs', status: 'ok' }, 'linux'), null)
  assert.equal(reportedDataDir({ app: 'mietfuchs', dataDir: '/a', moved: { movedTo: '/b' } }, 'linux'), null)
  assert.equal(reportedDataDir({ app: 'anderes', dataDir: '/a' }, 'linux'), null)
  assert.ok(sameDir('C:\\Users\\X\\Mietfuchs\\', 'c:\\users\\x\\mietfuchs', 'win32'))
  assert.ok(!sameDir('/Users/x/A', '/Users/x/a', 'linux'))
})

test('Gleichzeitige Starts: wer später gebunden hat, weicht; beide Seiten kommen zum selben Ergebnis', () => {
  const a = { dataDir: '/d', port: 3001, pid: 10, boundAt: 1000.5 }
  const b = { dataDir: '/d', port: 17517, pid: 11, boundAt: 1000.7 }
  assert.equal(yieldsTo(b, a), true)
  assert.equal(yieldsTo(a, b), false)
  const c = { ...b, boundAt: a.boundAt }
  assert.notEqual(yieldsTo(a, c), yieldsTo(c, a))
})

test('findTwin: keine Antwort, fremder Ordner und fremdes Programm zählen als frei; eine startende ältere Fassung wird abgewartet', async () => {
  const d = dir()
  try {
    const self: Self = { dataDir: d, port: 17517, pid: 1, boundAt: 5 }
    const answers: Record<string, unknown> = {
      'http://127.0.0.1:3001/healthz': { app: 'mietfuchs', status: 'ok', dataDir: '/woanders' },
    }
    const fetchJson = async (url: string) => {
      if (url in answers) return answers[url]
      throw new Error('ECONNREFUSED')
    }
    assert.equal(await findTwin(self, { platform: 'linux', fetchJson }), null)
    answers['http://127.0.0.1:3001/healthz'] = '<html>'
    assert.equal(await findTwin(self, { platform: 'linux', fetchJson }), null)
    // Eine ältere Fassung, die erst startet und dann ihre Datenbank nennt
    let calls = 0
    const starting = async (url: string) => {
      if (!url.includes(':3001')) throw new Error('ECONNREFUSED')
      calls++
      return calls < 3 ? { app: 'mietfuchs', status: 'starting', version: '0.14.1' } : { app: 'mietfuchs', status: 'ok', database: { file: path.join(d, 'mietfuchs.sqlite') } }
    }
    const twin = await findTwin(self, { platform: 'linux', fetchJson: starting, pause: async () => {} })
    assert.equal(twin?.port, 3001)
    // Der eigene Port wird nicht gefragt, auch wenn die Lauf-Datei ihn nennt
    writeRunFile(d, { version: 1, port: 17517, pid: 1, startedAt: 'x', appVersion: 'y' })
    const asked: string[] = []
    await findTwin(self, { platform: 'linux', ports: [], fetchJson: async (url) => { asked.push(url); throw new Error('x') } })
    assert.deepEqual(asked, [])
  } finally {
    fs.rmSync(d, { recursive: true, force: true })
  }
})

test('CI zählt nur mit 1 oder true: CI=false schaltet weder Ortsdatei noch Suche beim Umzug ab (Durchsicht Sicherheit K2)', () => {
  assert.equal(ciSet({ CI: 'true' }), true)
  assert.equal(ciSet({ CI: '1' }), true)
  assert.equal(ciSet({ CI: 'TRUE' }), true)
  assert.equal(ciSet({ CI: 'false' }), false)
  assert.equal(ciSet({ CI: '0' }), false)
  assert.equal(ciSet({ CI: '' }), false)
  assert.equal(ciSet({}), false)
  assert.equal(relocationHome({ CI: 'false' }, () => '/home/x'), '/home/x')
  assert.equal(relocationHome({ CI: 'true' }, () => '/home/x'), null)
  assert.equal(shouldRecord({ packaged: true, runtime: 'binary', platform: 'win32', env: { CI: 'false' } }), true)
  assert.equal(shouldRecord({ packaged: true, runtime: 'binary', platform: 'win32', env: { CI: 'true' } }), false)
})

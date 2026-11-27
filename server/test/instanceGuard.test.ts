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

// #694: Der andere hat gebunden und seine Lauf-Datei geschrieben, steckt aber gerade in den Migrationen; seine
// Ereignisschleife antwortet erst danach. Im Versuch unter Last liefen so beide auf demselben Ordner.
test('findTwin: schweigt der Port aus der Lauf-Datei, wird nachgefragt, bis er antwortet; ein schweigender Standardport hält nicht auf', async () => {
  const d = dir()
  const silence = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
  try {
    const self: Self = { dataDir: d, port: 17517, pid: 1, boundAt: 5 }
    writeRunFile(d, { version: 1, port: 4711, pid: 2, startedAt: 'x', appVersion: '0.18.1' })
    let calls = 0
    const busy = async (url: string) => {
      if (!url.includes(':4711')) throw new Error('ECONNREFUSED')
      calls++
      if (calls < 4) throw silence()
      return { app: 'mietfuchs', status: 'ok', dataDir: d, version: '0.18.1' }
    }
    const said: string[] = []
    const hooks = { onSilent: (port: number) => said.push(`wartet ${port}`), onGaveUp: (port: number) => said.push(`gibt auf ${port}`) }
    const twin = await findTwin(self, { platform: 'linux', ports: [], fetchJson: busy, ...hooks })
    assert.equal(twin?.port, 4711)
    assert.equal(calls, 4)
    // Genau einmal je Port gesagt, obwohl dreimal geschwiegen; aufgegeben wurde nicht
    assert.deepEqual(said, ['wartet 4711'])

    // Schreibt der andere seine Lauf-Datei erst, während die Frage an seinen Port läuft (er hatte gerade gebunden, als
    // dieser Start las), zählt sie trotzdem: Entschieden wird beim Schweigen, nicht beim Lesen vor der Frage
    fs.rmSync(path.join(d, RUN_FILE))
    let late = 0
    const lateRunFile = async (url: string) => {
      if (!url.includes(':4711')) throw new Error('ECONNREFUSED')
      late++
      if (late === 1) writeRunFile(d, { version: 1, port: 4711, pid: 2, startedAt: 'x', appVersion: '0.18.1' })
      if (late < 3) throw silence()
      return { app: 'mietfuchs', status: 'ok', dataDir: d, version: '0.18.1' }
    }
    assert.equal((await findTwin(self, { platform: 'linux', ports: [4711], fetchJson: lateRunFile }))?.port, 4711)
    assert.equal(late, 3)

    // Nimmt der Port aus der Lauf-Datei keine Verbindung an (nach einem Absturz), ist es eine Frage und kein Warten
    const refused: string[] = []
    said.length = 0
    assert.equal(await findTwin(self, { platform: 'linux', ports: [], fetchJson: async (url) => { refused.push(url); throw new Error('ECONNREFUSED') }, ...hooks }), null)
    assert.equal(refused.length, 1)
    assert.equal(said.length, 0, 'bei abgelehnter Verbindung kein Warten und keine Zeile')

    // Schweigt er auf Dauer, endet das Nachfragen, und der Start geht weiter (nie den Start eines einzelnen verhindern)
    let silent = 0
    const forever = async () => {
      silent++
      await new Promise((resolve) => setTimeout(resolve, 5))
      throw silence()
    }
    assert.equal(await findTwin(self, { platform: 'linux', ports: [], fetchJson: forever, silentWaitMs: 60, ...hooks }), null)
    assert.ok(silent > 1, `nur ${silent} Frage(n)`)
    assert.deepEqual(said, ['wartet 4711', 'gibt auf 4711'])

    // Ergibt ein anderer Port den Zwilling, wartet die Frage nicht auf den schweigenden aus der Lauf-Datei
    said.length = 0
    let silentAsked = 0
    const other = async (url: string) => {
      if (url.includes(':4711')) {
        silentAsked++
        await new Promise((resolve) => setTimeout(resolve, 5))
        throw silence()
      }
      return { app: 'mietfuchs', status: 'ok', dataDir: d, version: '0.18.1' }
    }
    const started = Date.now()
    assert.equal((await findTwin(self, { platform: 'linux', ports: [3001], fetchJson: other, silentWaitMs: 10_000, ...hooks }))?.port, 3001)
    assert.ok(Date.now() - started < 5000, `${Date.now() - started} ms gewartet`)
    // Die laufende Frage endet noch, eine weitere folgt nicht
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.ok(silentAsked <= 2, `${silentAsked} Fragen an den schweigenden Port`)
    assert.ok(!said.includes('gibt auf 4711'))

    // Ein Standardport ohne Lauf-Datei, auf dem etwas schweigt, wird einmal gefragt: sonst wartete jeder Start
    fs.rmSync(path.join(d, RUN_FILE))
    const asked: string[] = []
    said.length = 0
    assert.equal(await findTwin(self, { platform: 'linux', ports: [3001], fetchJson: async (url) => { asked.push(url); throw silence() }, ...hooks }), null)
    assert.deepEqual(asked, ['http://127.0.0.1:3001/healthz'])
    assert.equal(said.length, 0, 'ein Standardport ohne Lauf-Datei wird nicht abgewartet')
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

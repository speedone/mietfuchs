// Wo die Daten liegen (#25). Bisher galt: im npm-Betrieb server/data, in der Programmdatei
// „data“ daneben. Aus einem Installationspaket liegt die Programmdatei aber in /usr/bin, wo
// niemand schreiben darf. Dann gehören die Daten in den Benutzerordner.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chooseDataDir } from '../src/store.js'
import { writable } from '../src/paths.js'

// Nichts anfassen, was wirklich auf der Platte liegt: Schreibtest und Heimatordner werden
// hineingereicht.
const args = (over = {}) => ({
  env: {},
  execPath: '/usr/bin/mietfuchs',
  packaged: true,
  moduleDir: '/projekt/server/src',
  home: () => '/home/erika',
  platform: 'linux',
  canWrite: () => false,
  ...over,
})

test('NKA_DATA_DIR geht allem vor und wird absolut gemacht', () => {
  const dir = chooseDataDir(args({ env: { NKA_DATA_DIR: 'wegwerf' }, canWrite: () => true }))
  assert.equal(dir, path.resolve('wegwerf'))
})

test('ohne Programmdatei bleibt es bei server/data', () => {
  assert.equal(chooseDataDir(args({ packaged: false })), path.join('/projekt/server/src', '..', 'data'))
})

test('neben einer entpackten Programmdatei liegen die Daten daneben', () => {
  const dir = chooseDataDir(args({ execPath: '/home/erika/Downloads/mietfuchs-linux', canWrite: () => true }))
  assert.equal(dir, path.join('/home/erika/Downloads', 'data'))
})

test('aus einem Paket installiert, landen die Daten im Benutzerordner', () => {
  assert.equal(chooseDataDir(args()), path.posix.join('/home/erika', '.local', 'share', 'mietfuchs'))
})

test('auch mit Schreibrecht in /usr/bin bleibt es beim Benutzerordner', () => {
  // Als Administrator gestartet, lägen die Daten sonst dort und wären beim nächsten Start
  // als normaler Benutzer verschwunden.
  const dir = chooseDataDir(args({ canWrite: () => true }))
  assert.equal(dir, path.posix.join('/home/erika', '.local', 'share', 'mietfuchs'))
})

test('ein Ordner neben der Programmdatei, in den niemand schreiben darf, weicht aus', () => {
  const dir = chooseDataDir(args({ execPath: '/mnt/stick/mietfuchs-linux', canWrite: () => false }))
  assert.equal(dir, path.posix.join('/home/erika', '.local', 'share', 'mietfuchs'))
})

test('XDG_DATA_HOME wird beachtet, aber nur mit absolutem Pfad', () => {
  assert.equal(
    chooseDataDir(args({ env: { XDG_DATA_HOME: '/home/erika/daten' } })),
    path.posix.join('/home/erika/daten', 'mietfuchs'),
  )
  // Ein relativer Wert hinge am Arbeitsverzeichnis; die XDG-Spezifikation sagt, er ist zu
  // ignorieren.
  const relativ = chooseDataDir(args({ env: { XDG_DATA_HOME: 'daten' } }))
  assert.equal(relativ, path.posix.join('/home/erika', '.local', 'share', 'mietfuchs'))
  assert.ok(path.isAbsolute(relativ))
})

test('Windows und macOS haben eigene Benutzerordner', () => {
  // Gerechnet wird nach der genannten Plattform, nicht nach der des Prüfrechners: Sonst fiele
  // der Windows-Fall unter Linux durch, weil dort „C:\…“ nicht als absolut gilt.
  assert.equal(
    chooseDataDir(args({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\Erika\\AppData\\Local' }, execPath: 'C:\\Program Files\\Mietfuchs\\mietfuchs.exe' })),
    path.win32.join('C:\\Users\\Erika\\AppData\\Local', 'Mietfuchs'),
  )
  assert.equal(
    chooseDataDir(args({ platform: 'darwin', execPath: '/Applications/mietfuchs', home: () => '/Users/erika' })),
    path.posix.join('/Users/erika', 'Library', 'Application Support', 'Mietfuchs'),
  )
})

test('Ordner, die nur „Windows“ oder „Programme“ im Namen tragen, sind keine Systemorte', () => {
  // Ein Teilstring-Vergleich hätte diese Nutzer nach einem Update vor einen leeren Bestand
  // gestellt, obwohl ihr Ordner „data“ daneben liegt.
  for (const execPath of [
    'C:\\Users\\Erika\\Desktop\\Windows-Tools\\mietfuchs-win.exe',
    'D:\\WindowsApps\\mietfuchs-win.exe',
    'D:\\Programme\\Mietfuchs\\mietfuchs-win.exe',
    'C:\\Daten\\Program Files Kopie\\mietfuchs-win.exe',
  ]) {
    const dir = chooseDataDir(args({ platform: 'win32', execPath, canWrite: () => true }))
    assert.equal(dir, path.join(path.dirname(execPath), 'data'), execPath)
  }
})

test('nach dem Heimatordner wird nur gesucht, wenn er gebraucht wird', () => {
  // `os.homedir()` wirft ohne HOME und ohne Eintrag in der Benutzerdatenbank (Container mit
  // --user). Das darf den Start nicht verhindern, wenn die Daten ohnehin woanders liegen.
  let lookups = 0
  const home = () => (lookups++, '/home/erika')
  assert.equal(chooseDataDir(args({ home, env: { NKA_DATA_DIR: '/tmp/daten' } })), path.resolve('/tmp/daten'))
  assert.equal(chooseDataDir(args({ home, packaged: false })), path.join('/projekt/server/src', '..', 'data'))
  assert.equal(
    chooseDataDir(args({ home, execPath: '/home/erika/Downloads/mietfuchs-linux', canWrite: () => true })),
    path.join('/home/erika/Downloads', 'data'),
  )
  assert.equal(chooseDataDir(args({ home, env: { XDG_DATA_HOME: '/daten' } })), path.posix.join('/daten', 'mietfuchs'))
  assert.equal(lookups, 0)
  assert.equal(chooseDataDir(args({ home })), path.posix.join('/home/erika', '.local', 'share', 'mietfuchs'))
  assert.equal(lookups, 1)
})

test('ohne Heimatordner bricht der Start mit klarer Ansage ab', () => {
  // Nur wenn es wirklich keinen Platz für die Daten gibt. Die Meldung muss den Ausweg nennen.
  assert.throws(() => chooseDataDir(args({ home: () => '' })), /NKA_DATA_DIR/)
  assert.throws(() => chooseDataDir(args({ platform: 'darwin', execPath: '/Applications/mietfuchs', home: () => '' })), /NKA_DATA_DIR/)
})

test('der Schreibtest bekommt den Ordner neben der Programmdatei', () => {
  const asked = []
  chooseDataDir(args({ execPath: '/mnt/stick/mietfuchs-linux', canWrite: (dir) => (asked.push(dir), false) }))
  assert.deepEqual(asked, [path.join('/mnt/stick', 'data')])
})

test('der Schreibtest sieht auch nach, ob sich der Ordner anlegen ließe', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-schreibtest-'))
  try {
    assert.equal(writable(tmp), true)
    // Den Ordner gibt es noch nicht: Dann zählt, ob er sich anlegen ließe.
    assert.equal(writable(path.join(tmp, 'data')), true)
    assert.equal(writable(path.join(tmp, 'a', 'b', 'c')), true)
    // Ein Laufwerk, das es nicht gibt, ist nicht beschreibbar (unter Unix führt der Aufstieg
    // immer bis zur Wurzel, deshalb nur unter Windows prüfbar).
    if (process.platform === 'win32') assert.equal(writable('Q:\\kein-laufwerk\\daten'), false)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

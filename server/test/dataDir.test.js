// Wo die Daten liegen (#25). Bisher galt: im npm-Betrieb server/data, in der Programmdatei
// „data“ daneben. Aus einem Installationspaket liegt die Programmdatei aber in /usr/bin, wo
// niemand schreiben darf. Dann gehören die Daten in den Benutzerordner.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { chooseDataDir } from '../src/store.js'

// Nichts anfassen, was wirklich auf der Platte liegt: Der Schreibtest wird hineingereicht.
const args = (over = {}) => ({
  env: {},
  execPath: '/usr/bin/mietfuchs',
  packaged: true,
  moduleDir: '/projekt/server/src',
  home: '/home/erika',
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
  assert.equal(chooseDataDir(args()), path.join('/home/erika', '.local', 'share', 'mietfuchs'))
})

test('auch mit Schreibrecht in /usr/bin bleibt es beim Benutzerordner', () => {
  // Als Administrator gestartet, lägen die Daten sonst dort und wären beim nächsten Start
  // als normaler Benutzer verschwunden.
  const dir = chooseDataDir(args({ canWrite: () => true }))
  assert.equal(dir, path.join('/home/erika', '.local', 'share', 'mietfuchs'))
})

test('ein Ordner neben der Programmdatei, in den niemand schreiben darf, weicht aus', () => {
  const dir = chooseDataDir(args({ execPath: '/mnt/stick/mietfuchs-linux', canWrite: () => false }))
  assert.equal(dir, path.join('/home/erika', '.local', 'share', 'mietfuchs'))
})

test('XDG_DATA_HOME wird beachtet', () => {
  const dir = chooseDataDir(args({ env: { XDG_DATA_HOME: '/home/erika/daten' } }))
  assert.equal(dir, path.join('/home/erika/daten', 'mietfuchs'))
})

test('Windows und macOS haben eigene Benutzerordner', () => {
  assert.equal(
    chooseDataDir(args({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\Erika\\AppData\\Local' }, execPath: 'C:\\Program Files\\Mietfuchs\\mietfuchs.exe' })),
    path.join('C:\\Users\\Erika\\AppData\\Local', 'Mietfuchs'),
  )
  assert.equal(
    chooseDataDir(args({ platform: 'darwin', home: '/Users/erika' })),
    path.join('/Users/erika', 'Library', 'Application Support', 'Mietfuchs'),
  )
})

test('der Schreibtest bekommt den Ordner neben der Programmdatei', () => {
  const gefragt = []
  chooseDataDir(args({ execPath: '/mnt/stick/mietfuchs-linux', canWrite: (dir) => (gefragt.push(dir), false) }))
  assert.deepEqual(gefragt, [path.join('/mnt/stick', 'data')])
})

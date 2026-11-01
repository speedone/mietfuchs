// Ort des Datenordners merken (#517, Schritt 1): Die Programmdatei schreibt beim Start in eine feste Datei je
// Benutzer, wo ihre Daten liegen. Das spätere Programm mit eigenem Fenster findet sie so, wo immer die alte Datei
// liegt, und kann den Umzug selbst anbieten.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { hasStock, locationsFile, mergeLocation, recordDataLocation, shouldRecord, type DataLocation } from '../src/dataLocations.ts'

// Durchsicht: ein eigener Ordner, nicht „Mietfuchs“. Der ist unter Windows auch der Datenordner, wenn die Programmdatei
// neben sich nicht schreiben darf, und auf dem Mac der Ordner, den Electron für sich anlegt (#517).
test('Ortsdatei: Windows unter LOCALAPPDATA, macOS unter Application Support, je in eigenem Ordner, sonst keine', () => {
  assert.equal(
    locationsFile({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\Anna\\AppData\\Local' }, home: () => 'C:\\Users\\Anna' }),
    'C:\\Users\\Anna\\AppData\\Local\\mietfuchs-standorte\\standorte.json',
  )
  // Ohne (oder mit relativem) LOCALAPPDATA der übliche Ort im Benutzerordner
  assert.equal(
    locationsFile({ platform: 'win32', env: { LOCALAPPDATA: 'relativ' }, home: () => 'C:\\Users\\Anna' }),
    'C:\\Users\\Anna\\AppData\\Local\\mietfuchs-standorte\\standorte.json',
  )
  assert.equal(
    locationsFile({ platform: 'darwin', env: {}, home: () => '/Users/anna' }),
    '/Users/anna/Library/Application Support/mietfuchs-standorte/standorte.json',
  )
  // Linux, Docker, Server: dort zieht nichts um
  assert.equal(locationsFile({ platform: 'linux', env: {}, home: () => '/home/anna' }), null)
  // Ohne Benutzerordner kein Ort, aber auch kein Fehler
  assert.equal(locationsFile({ platform: 'darwin', env: {}, home: () => '' }), null)
})

test('gemerkt wird nur in der Programmdatei unter Windows und macOS, nie in Tests, Store oder Docker', () => {
  const base = { packaged: true, runtime: 'binary' as const, platform: 'win32' as const, env: {} }
  assert.equal(shouldRecord(base), true)
  assert.equal(shouldRecord({ ...base, platform: 'darwin' }), true)
  assert.equal(shouldRecord({ ...base, runtime: 'package' }), true)
  // Die Store-Fassung zieht nicht um, ihre Daten liegen schon im Benutzerordner
  assert.equal(shouldRecord({ ...base, runtime: 'store' }), false)
  assert.equal(shouldRecord({ ...base, platform: 'linux' }), false)
  // Nachgestellte Programmdatei (NKA_RUNTIME=binary unter Node) und jeder Test: nie in den echten Benutzerordner
  assert.equal(shouldRecord({ ...base, packaged: false }), false)
  assert.equal(shouldRecord({ ...base, env: { CI: '1' } }), false)
})

const at = (dataDir: string, lastSeen: string, appVersion = '0.15.0'): DataLocation =>
  ({ dataDir, exe: path.join(dataDir, '..', 'mietfuchs-win.exe'), appVersion, lastSeen })

test('Zusammenführen: derselbe Ordner einmal, der zuletzt benutzte zuerst', () => {
  const first = mergeLocation(null, at('D:\\Vermietung\\data', '2026-11-01T08:00:00.000Z', '0.14.0'))
  assert.deepEqual(first, { version: 1, locations: [at('D:\\Vermietung\\data', '2026-11-01T08:00:00.000Z', '0.14.0')] })
  const second = mergeLocation(first, at('C:\\Users\\Anna\\Downloads\\data', '2026-11-02T08:00:00.000Z'))
  const third = mergeLocation(second, at('D:\\Vermietung\\data', '2026-11-03T08:00:00.000Z', '0.15.0'))
  assert.deepEqual(third.locations.map((l) => [l.dataDir, l.appVersion]), [
    ['D:\\Vermietung\\data', '0.15.0'],
    ['C:\\Users\\Anna\\Downloads\\data', '0.15.0'],
  ])
})

// Durchsicht: Windows und macOS unterscheiden in Pfaden nicht nach Groß- und Kleinschreibung
test('Zusammenführen: unter Windows und macOS ist „D:\\Vermietung“ derselbe Ordner wie „d:\\vermietung“', () => {
  const first = mergeLocation(null, at('D:\\Vermietung\\data', '2026-11-01T08:00:00.000Z'), 'win32')
  const again = mergeLocation(first, at('d:\\vermietung\\Data', '2026-11-02T08:00:00.000Z'), 'win32')
  assert.deepEqual(again.locations.map((l) => l.dataDir), ['d:\\vermietung\\Data'])
  const mac = mergeLocation(mergeLocation(null, at('/Users/Anna/Data', '2026-11-01T08:00:00.000Z'), 'darwin'), at('/users/anna/data', '2026-11-02T08:00:00.000Z'), 'darwin')
  assert.equal(mac.locations.length, 1)
  // Unter Linux sind es zwei Ordner
  const linux = mergeLocation(mergeLocation(null, at('/a/Data', '2026-11-01T08:00:00.000Z'), 'linux'), at('/a/data', '2026-11-02T08:00:00.000Z'), 'linux')
  assert.equal(linux.locations.length, 2)
})

// Durchsicht: Ob ein Bestand im Ordner liegt, entscheidet die Datei, nicht ob sie sich öffnen ließ. Ein Probestart in
// einem leeren Ordner hat keinen; ein beschädigter Bestand muss für den Umzug trotzdem auffindbar sein.
test('Bestand im Ordner: Datenbank oder alte db.json', () => {
  const seen = (names: string[]) => (file: string) => names.includes(path.basename(file))
  assert.equal(hasStock('/x/data', seen(['mietfuchs.sqlite'])), true)
  assert.equal(hasStock('/x/data', seen(['db.json'])), true)
  assert.equal(hasStock('/x/data', seen([])), false)
})

test('Zusammenführen: eine kaputte oder fremde Datei wird ersetzt, nicht übernommen', () => {
  for (const bad of ['kein json', { version: 2, locations: [] }, { version: 1, locations: [{ dataDir: 3 }] }, [], 42]) {
    const merged = mergeLocation(bad, at('/Users/anna/Mietfuchs/data', '2026-11-01T08:00:00.000Z'))
    assert.equal(merged.locations.length, 1, JSON.stringify(bad))
  }
  // Gültige Einträge neben einem ungültigen bleiben erhalten
  const mixed = { version: 1, locations: [at('/a/data', '2026-10-01T08:00:00.000Z'), { dataDir: null }] }
  assert.deepEqual(mergeLocation(mixed, at('/b/data', '2026-11-01T08:00:00.000Z')).locations.map((l) => l.dataDir), ['/b/data', '/a/data'])
})

test('Zusammenführen: höchstens 20 Orte, die ältesten fallen heraus', () => {
  let file: unknown = null
  for (let i = 0; i < 25; i++) file = mergeLocation(file, at(`/d${i}/data`, new Date(Date.UTC(2026, 0, 1 + i)).toISOString()))
  const { locations } = mergeLocation(file, at('/neu/data', '2026-12-31T00:00:00.000Z'))
  assert.equal(locations.length, 20)
  assert.equal(locations[0]?.dataDir, '/neu/data')
  assert.ok(!locations.some((l) => l.dataDir === '/d5/data'), 'die ältesten sind weg')
})

test('Schreiben: legt den Ordner an, schreibt vollständig, ein Fehler hält den Start nicht auf', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-orte-'))
  try {
    const file = path.join(dir, 'Mietfuchs', 'standorte.json')
    recordDataLocation(file, at('/x/data', '2026-11-01T08:00:00.000Z'))
    recordDataLocation(file, at('/y/data', '2026-11-02T08:00:00.000Z'))
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
    assert.deepEqual(saved.locations.map((l: DataLocation) => l.dataDir), ['/y/data', '/x/data'])
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['standorte.json'], 'keine Reste einer halb geschriebenen Datei')
    // Ein Ort, an dem sich nicht schreiben lässt (hier eine Datei statt eines Ordners): kein Wurf
    const blocked = path.join(dir, 'datei')
    fs.writeFileSync(blocked, 'x')
    const warnings: string[] = []
    assert.doesNotThrow(() => recordDataLocation(path.join(blocked, 'standorte.json'), at('/z/data', '2026-11-03T08:00:00.000Z'), (m) => warnings.push(m)))
    assert.equal(warnings.length, 1)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// Umzug der Daten ins Programmfenster (#517, Schritte 2 bis 4): Fundorte, Suche, Vermerk im alten Ordner, Entscheidung
// im neuen und der Vergleich mit dem Original. Plattform, Heimatordner und Umgebung kommen immer hinein; kein Test liest
// den echten Benutzerordner oder eine echte Ortsdatei.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Db } from '../src/store.ts'
import { straightenForDatabase } from '../src/legacy/migrate.ts'
import { openDatabaseWithStock } from '../testing/database.ts'
import { openFreshDatabase } from '../testing/freshDatabase.ts'
import {
  classifyChoice, copyErrorText, copyMismatch, describeCandidate, earlyMietfuchs, fixedPlaces, folderFromChoice, liveDataDir, movedNoteText, programFilePattern,
  readDecision, readMovedMarker, relocationHome, searchDirsFromEnv, stockFingerprint, rememberedFolders, runningFor, samePath, searchProgramFolders,
  searchRoots, stockKind, writeDecision, writeMovedMarker, type MovedMarker,
} from '../src/relocation.ts'

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-umzug-'))
const made = (dir: string): string => {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
const touch = (file: string, content = 'x'): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

const someDb = (tenancies = 1): Db => ({
  settings: { houseName: 'Haus', address: 'Weg 1', landlordName: 'Vermieter', iban: '', paymentDeadlineDays: 30, ollamaUrl: 'http://localhost:11434', ollamaModel: 'modell' },
  units: [{ id: 'u1', name: 'EG', areaM2: 80, participates: true }],
  tenancies: Array.from({ length: tenancies }, (_, i) => ({
    id: `t${i}`, unitId: 'u1', tenantName: `Mieter ${i}`, persons: 1,
    personHistory: [{ from: `${2020 + i}-01-01`, persons: 1 }], start: `${2020 + i}-01-01`, end: `${2020 + i}-12-31`,
    prepayments: [{ from: `${2020 + i}-01`, monthlyCents: 10000 }], prepaymentOverrides: {},
    baseRents: [{ from: `${2020 + i}-01`, monthlyCents: 50000 }],
  })),
  costItems: [{ id: 'c1', year: 2024, category: 'Müllabfuhr', description: 'Gebühren', amountCents: 12000, key: 'area' }],
  meters: [], readings: [], payments: [], closedSettlements: [],
})

test('Heimatordner: im Test nur der hineingereichte, mit CI sonst keiner, nie der echte', () => {
  assert.equal(relocationHome({ NKA_TEST_HOME: '/tmp/zuhause' }, () => '/home/echt'), '/tmp/zuhause')
  assert.equal(relocationHome({ CI: '1' }, () => '/home/echt'), null)
  assert.equal(relocationHome({}, () => '/home/echt'), '/home/echt')
  assert.equal(relocationHome({}, () => ''), null)
})

test('Suchorte: Downloads, Schreibtisch und Dokumente je Plattform, unter Windows auch die von OneDrive', () => {
  assert.deepEqual(searchRoots({ platform: 'win32', home: 'C:\\Users\\Anna' }), [
    'C:\\Users\\Anna\\Downloads', 'C:\\Users\\Anna\\Desktop', 'C:\\Users\\Anna\\Documents',
    'C:\\Users\\Anna\\OneDrive\\Desktop', 'C:\\Users\\Anna\\OneDrive\\Documents', 'C:\\Users\\Anna\\OneDrive\\Dokumente',
  ])
  assert.deepEqual(searchRoots({ platform: 'darwin', home: '/Users/anna' }), [
    '/Users/anna/Downloads', '/Users/anna/Desktop', '/Users/anna/Documents',
  ])
  assert.deepEqual(searchRoots({ platform: 'darwin', home: null }), [])
})

// Durchsicht der Speicherorte: Durfte die Programmdatei neben sich nicht schreiben, lagen ihre Daten im Benutzerordner
// des Systems (userDataHome in store.ts). Auf dem Mac ist das der Ordner des Fensters selbst, unter Windows nicht.
test('Feste Orte: unter Windows der Ausweichordner der Programmdatei, auf dem Mac keiner', () => {
  assert.deepEqual(fixedPlaces({ platform: 'win32', home: 'C:\\Users\\Anna', env: { LOCALAPPDATA: 'D:\\Profile\\Local' } }), ['D:\\Profile\\Local\\Mietfuchs'])
  assert.deepEqual(fixedPlaces({ platform: 'win32', home: 'C:\\Users\\Anna', env: {} }), ['C:\\Users\\Anna\\AppData\\Local\\Mietfuchs'])
  assert.deepEqual(fixedPlaces({ platform: 'darwin', home: '/Users/anna', env: {} }), [])
  assert.deepEqual(fixedPlaces({ platform: 'win32', home: null, env: { LOCALAPPDATA: 'D:\\Profile\\Local' } }), [])
})

test('Programmdatei erkennen: mietfuchs*.exe unter Windows, mietfuchs-macos-* auf dem Mac', () => {
  const win = programFilePattern('win32')
  for (const name of ['mietfuchs-win.exe', 'Mietfuchs-win (1).exe', 'mietfuchs-win-arm64.exe', 'MIETFUCHS-WIN.EXE']) assert.ok(win.test(name), name)
  for (const name of ['mietfuchs.sqlite', 'mietfuchs-macos-intel', 'anderes.exe']) assert.ok(!win.test(name), name)
  const mac = programFilePattern('darwin')
  for (const name of ['mietfuchs-macos-apple-silicon', 'mietfuchs-macos-intel', 'mietfuchs-macos-intel 2']) assert.ok(mac.test(name), name)
  for (const name of ['mietfuchs-win.exe', 'mietfuchs-macos-intel.zip']) assert.ok(!mac.test(name), name)
  assert.ok(programFilePattern('linux').test('mietfuchs-linux'))
})

test('Gleicher Ort: unter Windows und macOS ohne Groß und Klein, unter Linux genau', () => {
  assert.ok(samePath('C:\\Users\\Anna\\Downloads\\data', 'c:\\users\\anna\\downloads\\Data\\', 'win32'))
  assert.ok(samePath('/Users/Anna/data', '/users/anna/data', 'darwin'))
  assert.ok(!samePath('/home/a/Data', '/home/a/data', 'linux'))
})

test('Suche: findet „data“ neben der Programmdatei bis drei Ebenen tief, folgt keinem Verweis', async () => {
  const home = tempDir()
  try {
    const downloads = path.join(home, 'Downloads')
    // Ebene 0: die Datei liegt direkt im Download-Ordner, die Daten daneben
    touch(path.join(downloads, 'mietfuchs-win.exe'))
    touch(path.join(downloads, 'data', 'mietfuchs.sqlite'))
    // Ebene 2: in einem entpackten Ordner, alte db.json
    touch(path.join(downloads, 'a', 'mietfuchs-0.3', 'mietfuchs-win.exe'))
    touch(path.join(downloads, 'a', 'mietfuchs-0.3', 'data', 'db.json'), '{}')
    // Ebene 4: zu tief
    touch(path.join(downloads, 'a', 'b', 'c', 'd', 'mietfuchs-win.exe'))
    touch(path.join(downloads, 'a', 'b', 'c', 'd', 'data', 'mietfuchs.sqlite'))
    // Daten ohne Programmdatei und Programmdatei ohne Bestand
    touch(path.join(downloads, 'nur-daten', 'data', 'mietfuchs.sqlite'))
    touch(path.join(downloads, 'leer', 'mietfuchs-win.exe'))
    fs.mkdirSync(path.join(downloads, 'leer', 'data'))
    // Versteckte Ordner und node_modules bleiben außen vor
    touch(path.join(downloads, '.versteckt', 'mietfuchs-win.exe'))
    touch(path.join(downloads, '.versteckt', 'data', 'mietfuchs.sqlite'))
    // Ein Verweis auf einen Ordner mit Bestand wird nicht verfolgt
    const elsewhere = path.join(home, 'woanders')
    touch(path.join(elsewhere, 'mietfuchs-win.exe'))
    touch(path.join(elsewhere, 'data', 'mietfuchs.sqlite'))
    fs.symlinkSync(elsewhere, path.join(downloads, 'verweis'), 'dir')
    const found = await searchProgramFolders([downloads, path.join(home, 'Desktop')], { platform: 'win32' })
    assert.deepEqual(found.folders.sort(), [path.join(downloads, 'a', 'mietfuchs-0.3', 'data'), path.join(downloads, 'data')].sort())
    assert.equal(found.complete, true)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('Suche: mit Zeitgrenze und Grenze der Einträge, danach unvollständig statt hängend', async () => {
  const home = tempDir()
  try {
    for (let i = 0; i < 30; i++) fs.mkdirSync(path.join(home, `ordner-${i}`, 'unter'), { recursive: true })
    let clock = 0
    const slow = await searchProgramFolders([home], { platform: 'win32', now: () => (clock += 100), limits: { deadlineMs: 500 } })
    assert.equal(slow.complete, false)
    const many = await searchProgramFolders([home], { platform: 'win32', limits: { maxEntries: 10 } })
    assert.equal(many.complete, false)
    // Ein Suchort, den es nicht gibt, ist kein Fehler
    assert.deepEqual(await searchProgramFolders([path.join(home, 'fehlt')], { platform: 'win32' }), { folders: [], complete: true })
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('Ordner gewählt: der Ordner der Programmdatei oder gleich der Datenordner, sonst keiner', () => {
  const dir = tempDir()
  try {
    touch(path.join(dir, 'prog', 'mietfuchs-win.exe'))
    touch(path.join(dir, 'prog', 'data', 'mietfuchs.sqlite'))
    assert.equal(folderFromChoice(path.join(dir, 'prog')), path.join(dir, 'prog', 'data'))
    assert.equal(folderFromChoice(path.join(dir, 'prog', 'data')), path.join(dir, 'prog', 'data'))
    fs.mkdirSync(path.join(dir, 'leer'))
    assert.equal(folderFromChoice(path.join(dir, 'leer')), null)
    assert.equal(folderFromChoice(path.join(dir, 'gibt-es-nicht')), null)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Gemerkte Orte: nur mit Bestand, ohne Vermerk, ohne den eigenen Ordner, jeder einmal', () => {
  const dir = tempDir()
  try {
    const a = path.join(dir, 'a')
    const b = path.join(dir, 'b')
    const moved = path.join(dir, 'umgezogen')
    touch(path.join(a, 'mietfuchs.sqlite'))
    touch(path.join(b, 'db.json'), '{}')
    touch(path.join(moved, 'mietfuchs.sqlite'))
    writeMovedMarker(moved, { version: 1, movedTo: path.join(dir, 'neu'), at: '2026-11-01T10:00:00.000Z', appVersion: '0.15.0' })
    const file = {
      version: 1,
      locations: [
        { dataDir: a, exe: path.join(dir, 'mietfuchs-win.exe'), appVersion: '0.14.1', lastSeen: '2026-11-01T08:00:00.000Z' },
        { dataDir: path.join(dir, 'fehlt'), exe: 'x', appVersion: '0.14.1', lastSeen: '2026-10-01T08:00:00.000Z' },
        { dataDir: moved, exe: 'x', appVersion: '0.14.1', lastSeen: '2026-09-01T08:00:00.000Z' },
        { dataDir: b, exe: 'x', appVersion: '0.15.0', lastSeen: '2026-08-01T08:00:00.000Z' },
        { dataDir: path.join(dir, 'neu'), exe: 'x', appVersion: '0.15.0', lastSeen: '2026-07-01T08:00:00.000Z' },
      ],
    }
    assert.deepEqual(rememberedFolders(file, { ownDir: path.join(dir, 'neu'), platform: 'linux' }), [
      { dataDir: a, appVersion: '0.14.1' },
      { dataDir: b, appVersion: '0.15.0' },
    ])
    assert.deepEqual(rememberedFolders('kaputt', { ownDir: dir, platform: 'linux' }), [])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// Was der Umzug übernimmt, entscheidet sich wie beim Start einer neuen Version im alten Ordner: Trägt die Datenbank
// keinen Bestand und liegt eine db.json daneben, gilt die db.json (Umstieg); sonst die Datenbank (#89, `stale`).
test('Bestand im Ordner: Datenbank, db.json oder beide', async () => {
  const dir = tempDir()
  try {
    const onlyJson = path.join(dir, 'json')
    touch(path.join(onlyJson, 'db.json'), JSON.stringify(someDb()))
    assert.equal(await stockKind(onlyJson), 'json')

    const filled = made(path.join(dir, 'gefuellt'))
    ;(await openDatabaseWithStock(filled, straightenForDatabase(someDb()))).close()
    assert.equal(await stockKind(filled), 'database')
    // Daneben eine liegengebliebene db.json: die Datenbank gilt
    touch(path.join(filled, 'db.json'), JSON.stringify(someDb(3)))
    assert.equal(await stockKind(filled), 'database')

    // Gescheiterter Umstieg: leere Datenbank neben der db.json
    const failed = made(path.join(dir, 'gescheitert'))
    ;(await openFreshDatabase(failed)).close()
    touch(path.join(failed, 'db.json'), JSON.stringify(someDb()))
    assert.equal(await stockKind(failed), 'json')

    const empty = made(path.join(dir, 'leer'))
    ;(await openFreshDatabase(empty)).close()
    assert.equal(await stockKind(empty), null)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Fund beschreiben: zuletzt geändert, Objekte und Mietverhältnisse, ohne das Original zu ändern', async () => {
  const dir = tempDir()
  try {
    const filled = made(path.join(dir, 'gefuellt'))
    ;(await openDatabaseWithStock(filled, straightenForDatabase(someDb(3)))).close()
    const file = path.join(filled, 'mietfuchs.sqlite')
    const stamp = new Date('2026-10-12T09:30:00.000Z')
    fs.utimesSync(file, stamp, stamp)
    const before = fs.readFileSync(file)
    const info = await describeCandidate(filled)
    assert.deepEqual(info, { dataDir: filled, kind: 'database', modifiedAt: stamp.toISOString(), properties: 1, tenancies: 3 })
    assert.ok(fs.readFileSync(file).equals(before), 'die Datei ist unverändert')
    assert.equal(fs.statSync(file).mtime.toISOString(), stamp.toISOString())

    const json = path.join(dir, 'json')
    touch(path.join(json, 'db.json'), JSON.stringify(someDb(2)))
    const jsonInfo = await describeCandidate(json)
    assert.equal(jsonInfo.kind, 'json')
    assert.equal(jsonInfo.properties, 1)
    assert.equal(jsonInfo.tenancies, 2)

    // Unlesbar: Ort und Zeit, aber keine Zahlen
    const broken = path.join(dir, 'kaputt')
    touch(path.join(broken, 'mietfuchs.sqlite'), 'keine Datenbank')
    const brokenInfo = await describeCandidate(broken)
    assert.equal(brokenInfo.tenancies, null)
    assert.equal(brokenInfo.properties, null)
    assert.ok(brokenInfo.modifiedAt)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Vermerk im alten Ordner: umgezogen.json und eine lesbare UMGEZOGEN.txt', () => {
  const dir = tempDir()
  try {
    assert.equal(readMovedMarker(dir), null)
    const marker: MovedMarker = { version: 1, movedTo: 'C:\\Users\\Anna\\Mietfuchs', at: '2026-11-01T10:15:00.000Z', appVersion: '0.15.0' }
    writeMovedMarker(dir, marker)
    assert.deepEqual(readMovedMarker(dir), marker)
    const text = fs.readFileSync(path.join(dir, 'UMGEZOGEN.txt'), 'utf8')
    assert.match(text, /C:\\Users\\Anna\\Mietfuchs/)
    assert.match(text, /1\. November 2026/)
    assert.equal(text, movedNoteText(marker))
    assert.deepEqual(fs.readdirSync(dir).sort(), ['UMGEZOGEN.txt', 'umgezogen.json'], 'keine Zwischendateien')
    // Ein kaputter oder fremder Vermerk gilt nicht
    fs.writeFileSync(path.join(dir, 'umgezogen.json'), '{"version":2}')
    assert.equal(readMovedMarker(dir), null)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Entscheidung im neuen Ordner: übernommen oder neu angefangen', () => {
  const dir = tempDir()
  try {
    assert.equal(readDecision(dir), null)
    writeDecision(dir, { version: 1, decision: 'fresh', at: '2026-11-01T10:00:00.000Z' })
    assert.equal(readDecision(dir)?.decision, 'fresh')
    writeDecision(dir, { version: 1, decision: 'moved', at: '2026-11-01T11:00:00.000Z', from: '/alt/data' })
    assert.deepEqual(readDecision(dir), { version: 1, decision: 'moved', at: '2026-11-01T11:00:00.000Z', from: '/alt/data' })
    fs.writeFileSync(path.join(dir, 'umzug.json'), 'kaputt')
    assert.equal(readDecision(dir), null)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Altes Mietfuchs: der Datenordner aus /healthz, ab 0.8 über die Datenbank, davor unbekannt', () => {
  assert.deepEqual(liveDataDir({ app: 'mietfuchs', database: { file: 'C:\\Users\\Anna\\Downloads\\data\\mietfuchs.sqlite' } }, 'win32'), { running: true, dataDir: 'C:\\Users\\Anna\\Downloads\\data' })
  assert.deepEqual(liveDataDir({ app: 'mietfuchs', status: 'ok' }, 'win32'), { running: true, dataDir: null })
  assert.deepEqual(liveDataDir({ app: 'anderes' }, 'win32'), { running: false, dataDir: null })
  assert.deepEqual(liveDataDir(null, 'win32'), { running: false, dataDir: null })
  const live = { running: true, dataDir: 'C:\\Users\\Anna\\Downloads\\data' }
  assert.equal(runningFor('c:\\users\\anna\\downloads\\data', live, 'win32'), true)
  assert.equal(runningFor('C:\\Users\\Anna\\Desktop\\data', live, 'win32'), false)
  // Nennt die alte Fassung ihren Ordner nicht, gilt sie vorsichtshalber als die zu diesem Fund
  assert.equal(runningFor('C:\\Users\\Anna\\Desktop\\data', { running: true, dataDir: null }, 'win32'), true)
  assert.equal(runningFor('C:\\x', { running: false, dataDir: null }, 'win32'), false)
})

test('Vergleich mit dem Original: Mietverhältnisse, Kostenpositionen, Belege mit Größe', () => {
  const counts = { tenancies: 3, costItems: 7 }
  const files = [{ name: 'a.pdf', size: 10 }, { name: 'b.jpg', size: 20 }]
  assert.equal(copyMismatch({ counts, files }, { counts, files: [...files].reverse() }), null)
  assert.match(copyMismatch({ counts, files }, { counts: { tenancies: 2, costItems: 7 }, files }) ?? '', /Mietverhältnisse: 3 im Original, 2 in der Kopie/)
  assert.match(copyMismatch({ counts, files }, { counts: { tenancies: 3, costItems: 6 }, files }) ?? '', /Kostenpositionen: 7 im Original, 6 in der Kopie/)
  assert.match(copyMismatch({ counts, files }, { counts, files: [{ name: 'a.pdf', size: 10 }] }) ?? '', /Beleg „b\.jpg“ fehlt in der Kopie/)
  assert.match(copyMismatch({ counts, files }, { counts, files: [{ name: 'a.pdf', size: 9 }, { name: 'b.jpg', size: 20 }] }) ?? '', /Beleg „a\.pdf“ ist in der Kopie 9 statt 10 Byte groß/)
})

// Bis 0.3 gab es kein /healthz; ein laufendes Mietfuchs dieser Zeit erkennt man an seinen Einstellungen.
test('Altes Mietfuchs vor /healthz: an den Einstellungen erkannt, sonst nicht', () => {
  assert.equal(earlyMietfuchs({ houseName: 'Haus', landlordName: 'V', paymentDeadlineDays: 30, ollamaUrl: 'http://x' }), true)
  assert.equal(earlyMietfuchs({ name: 'anderes Programm' }), false)
  assert.equal(earlyMietfuchs(null), false)
  assert.equal(earlyMietfuchs([]), false)
})

// Durchsicht D2: Wurde das alte Mietfuchs mitten im Speichern beendet, liegt neben der Datenbank ein Journal. Nur lesend
// lässt sie sich dann nicht öffnen (SQLite müsste zurückrollen); mit einer db.json daneben nahm der Umzug still die
// db.json statt der gefüllten Datenbank. Gelesen wird dann eine Kopie, das Original bleibt unberührt.
test('Durchsicht D2: Datenbank mit liegengebliebener Transaktion gilt und wird beschrieben', async () => {
  const dir = tempDir()
  try {
    const source = made(path.join(dir, 'quelle'))
    ;(await openDatabaseWithStock(source, straightenForDatabase(someDb(2)))).close()
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(path.join(source, 'mietfuchs.sqlite'))
    db.exec('PRAGMA cache_size = 1')
    db.exec('BEGIN')
    for (let i = 0; i < 200; i++) db.exec(`INSERT INTO units (id, property_id, name, area_m2, participates) SELECT 'x${i}', property_id, 'X${i}', 1, 1 FROM units LIMIT 1`)
    const hot = made(path.join(dir, 'heiss'))
    fs.copyFileSync(path.join(source, 'mietfuchs.sqlite'), path.join(hot, 'mietfuchs.sqlite'))
    fs.copyFileSync(path.join(source, 'mietfuchs.sqlite-journal'), path.join(hot, 'mietfuchs.sqlite-journal'))
    db.exec('ROLLBACK')
    db.close()
    touch(path.join(hot, 'db.json'), JSON.stringify(someDb(5)))
    const before = fs.readFileSync(path.join(hot, 'mietfuchs.sqlite'))
    assert.equal(await stockKind(hot), 'database')
    const info = await describeCandidate(hot)
    assert.equal(info.tenancies, 2)
    assert.ok(fs.readFileSync(path.join(hot, 'mietfuchs.sqlite')).equals(before), 'das Original ist unverändert')
    assert.ok(fs.existsSync(path.join(hot, 'mietfuchs.sqlite-journal')), 'das Journal bleibt liegen')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// Durchsicht D12: Beim Kopieren keine Rohmeldung von Node („EBUSY: resource busy or locked, copyfile …“) und keine
// doppelte Beruhigung, sondern was los ist und was zu tun ist.
test('Durchsicht D12: Fehler beim Kopieren in Worten', () => {
  const err = (code: string) => Object.assign(new Error(`${code}: roh, copyfile 'C:\\x'`), { code })
  for (const code of ['EBUSY', 'EPERM', 'EACCES']) {
    const text = copyErrorText(err(code))
    assert.doesNotMatch(text, /copyfile|EBUSY|EPERM|EACCES/, text)
    assert.match(text, /anderes Programm|Virenscanner/)
  }
  const full = copyErrorText(err('ENOSPC'))
  assert.match(full, /nicht genug Platz/)
  assert.equal(full.match(/unverändert/g)?.length, 1, full)
  assert.doesNotMatch(full, /Sicherungen im Datenordner/)
  assert.match(copyErrorText(new Error('etwas anderes')), /etwas anderes/)
})

// Ergänzung 1 (#517): Schreibtisch, Dokumente und Downloads liegen unter Windows oft im OneDrive-Ordner („OneDrive -
// Firma“, lokalisierte Namen). Die echten Orte nennt das Fenster (app.getPath) in NKA_SEARCH_DIRS; sie gehen vor.
test('Suchorte: die Orte des Fensters zuerst, danach die abgeleiteten, jeder einmal', () => {
  const given = searchDirsFromEnv({ NKA_SEARCH_DIRS: JSON.stringify(['C:\\Users\\Anna\\OneDrive - Firma\\Schreibtisch', 'C:\\Users\\Anna\\Downloads', 7, '']) })
  assert.deepEqual(given, ['C:\\Users\\Anna\\OneDrive - Firma\\Schreibtisch', 'C:\\Users\\Anna\\Downloads'])
  const roots = searchRoots({ platform: 'win32', home: 'C:\\Users\\Anna', given })
  assert.equal(roots[0], 'C:\\Users\\Anna\\OneDrive - Firma\\Schreibtisch')
  assert.equal(roots.filter((r) => r.toLowerCase() === 'c:\\users\\anna\\downloads').length, 1)
  assert.deepEqual(searchDirsFromEnv({ NKA_SEARCH_DIRS: 'kein json' }), [])
  assert.deepEqual(searchDirsFromEnv({}), [])
  // Ohne Heimatordner nur die genannten
  assert.deepEqual(searchRoots({ platform: 'darwin', home: null, given: ['/Users/anna/Desktop'] }), ['/Users/anna/Desktop'])
})

// Ergänzung 2 (#517): Ein Fingerabdruck des Bestands, an dem sich zeigt, ob im alten Mietfuchs nach dem Umzug noch
// etwas geändert wurde. Ein Start der alten Fassung allein (Schreibprobe, Dateizeit) ändert ihn nicht.
test('Fingerabdruck: ändert sich mit dem Inhalt, nicht mit Dateizeit oder Schreibprobe', async () => {
  const dir = tempDir()
  try {
    const filled = made(path.join(dir, 'gefuellt'))
    ;(await openDatabaseWithStock(filled, straightenForDatabase(someDb()))).close()
    const first = await stockFingerprint(filled, 'database')
    assert.ok(first)
    const { DatabaseSync } = await import('node:sqlite')
    const file = path.join(filled, 'mietfuchs.sqlite')
    const probe = new DatabaseSync(file)
    const version = Number((probe.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
    probe.exec(`PRAGMA user_version = ${version}`)
    probe.close()
    const later = new Date(Date.now() + 60_000)
    fs.utimesSync(file, later, later)
    assert.equal(await stockFingerprint(filled, 'database'), first)
    const edit = new DatabaseSync(file)
    edit.exec("UPDATE cost_items SET amount_cents = amount_cents + 1")
    edit.close()
    assert.notEqual(await stockFingerprint(filled, 'database'), first)
    const json = made(path.join(dir, 'json'))
    touch(path.join(json, 'db.json'), JSON.stringify(someDb()))
    const a = await stockFingerprint(json, 'json')
    touch(path.join(json, 'db.json'), JSON.stringify(someDb(2)))
    assert.notEqual(await stockFingerprint(json, 'json'), a)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// Ergänzung: „Ordner wählen …“ nachsichtig. Gewählt werden kann der Ordner der Programmdatei, `data`, die Programmdatei
// selbst, `mietfuchs.sqlite`, `db.json` (ein Ordner nur mit db.json ist ein gültiger alter Bestand) oder ein Backup.
test('Gewählt: Ordner, Programmdatei, Datenbank, db.json oder Backup', () => {
  const dir = tempDir()
  try {
    const prog = path.join(dir, 'prog')
    touch(path.join(prog, 'mietfuchs-win.exe'))
    touch(path.join(prog, 'data', 'db.json'), '{}')
    const data = path.join(prog, 'data')
    assert.deepEqual(classifyChoice(prog, 'win32'), { dataDir: data })
    assert.deepEqual(classifyChoice(data, 'win32'), { dataDir: data })
    assert.deepEqual(classifyChoice(path.join(prog, 'mietfuchs-win.exe'), 'win32'), { dataDir: data })
    assert.deepEqual(classifyChoice(path.join(data, 'db.json'), 'win32'), { dataDir: data })
    touch(path.join(dir, 'neu', 'mietfuchs.sqlite'))
    assert.deepEqual(classifyChoice(path.join(dir, 'neu', 'mietfuchs.sqlite'), 'win32'), { dataDir: path.join(dir, 'neu') })
    touch(path.join(dir, 'mietfuchs-backup-2026-10-01.zip'), 'PK')
    assert.deepEqual(classifyChoice(path.join(dir, 'mietfuchs-backup-2026-10-01.zip'), 'win32'), { backup: path.join(dir, 'mietfuchs-backup-2026-10-01.zip') })
    touch(path.join(dir, 'brief.pdf'))
    assert.equal(classifyChoice(path.join(dir, 'brief.pdf'), 'win32'), null)
    assert.equal(classifyChoice(path.join(dir, 'fehlt'), 'win32'), null)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

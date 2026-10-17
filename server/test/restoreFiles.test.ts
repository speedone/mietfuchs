// Die Dateiarbeit beim Wiederherstellen (server/src/restoreFiles.ts): Belege an ihren Platz,
// Reste eines abgebrochenen Vorgangs, Platzbedarf und Meldungen bei voller Platte.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { cleanRestoreLeftovers, diskFullMessage, moveIntoPlace, restoreSpaceNeeded } from '../src/restoreFiles.ts'

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-restorefiles-'))
}

const fail = (code: string) => () => {
  throw Object.assign(new Error(code), { code })
}

test('Belege an ihren Platz: scheitert nach dem Kopieren das Entfernen der Quelle, ist das kein Fehlschlag', async () => {
  // Unter Windows hält ein Virenscanner die eben ausgepackte Datei gern kurz fest. Scheiterte das
  // Entfernen, warf die Schleife mitten im Austausch: db.json schon ersetzt, Belege halb verschoben.
  const dir = tempDir()
  try {
    const from = path.join(dir, 'beleg-0')
    const to = path.join(dir, 'ziel.pdf')
    fs.writeFileSync(from, 'Inhalt')
    const when = new Date('2022-01-02T03:04:06Z')
    fs.utimesSync(from, when, when)
    await moveIntoPlace(from, to, { rename: fail('EXDEV'), remove: fail('EPERM'), pauseMs: 0 })
    assert.equal(fs.readFileSync(to, 'utf8'), 'Inhalt')
    assert.equal(fs.statSync(to).mtime.getTime(), when.getTime())
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Belege an ihren Platz: ein kurz gesperrtes Umbenennen wird wiederholt', async () => {
  const dir = tempDir()
  try {
    const from = path.join(dir, 'beleg-0')
    const to = path.join(dir, 'ziel.pdf')
    fs.writeFileSync(from, 'Inhalt')
    let tries = 0
    const rename = (a: string, b: string) => {
      tries++
      if (tries < 3) fail('EBUSY')()
      fs.renameSync(a, b)
    }
    await moveIntoPlace(from, to, { rename, pauseMs: 0 })
    assert.equal(tries, 3)
    assert.equal(fs.readFileSync(to, 'utf8'), 'Inhalt')
    assert.equal(fs.existsSync(from), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Aufräumen beim Start: nur hochgeladene Archive und Zwischenablagen eines abgebrochenen Wiederherstellens', () => {
  const dir = tempDir()
  try {
    // Die Namen, die die Route vergibt (newId: 16 Hexziffern).
    fs.writeFileSync(path.join(dir, 'restore-upload-0123456789abcdef.zip'), 'x')
    fs.mkdirSync(path.join(dir, 'restore-0123456789abcdef'))
    fs.writeFileSync(path.join(dir, 'restore-0123456789abcdef', 'beleg-0'), 'x')
    // Was bleibt: die Datenbank aus einem gescheiterten Austausch (kann die einzige Kopie sein),
    // was nur ähnlich heißt, auch ein Ordner, den der Nutzer selbst angelegt hat, und alles andere.
    const keep = ['mietfuchs.sqlite.restore-0123456789abcdef', 'restore-notiz.txt', 'restore-alt', 'restore-upload-alt.zip', 'mietfuchs.sqlite', 'db.json.vor-restore', 'uploads']
    for (const name of keep) {
      if (name === 'uploads' || name === 'restore-alt') fs.mkdirSync(path.join(dir, name))
      else fs.writeFileSync(path.join(dir, name), 'x')
    }
    fs.writeFileSync(path.join(dir, 'restore-alt', 'brief.txt'), 'vom Nutzer')
    cleanRestoreLeftovers(dir)
    assert.deepEqual(fs.readdirSync(dir).sort(), [...keep].sort())
    assert.equal(fs.readFileSync(path.join(dir, 'restore-alt', 'brief.txt'), 'utf8'), 'vom Nutzer')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Platzbedarf: Belege und Datenbank, dazu Reserve für die Sicherungen danach', () => {
  const MB = 1024 * 1024
  // Danach entstehen noch: db.json und db.json.vor-restore, die Sicherung vor einer Migration
  // oder die Datei des Umstiegs, also etwa die doppelte Datenbank, und 64 MB Reserve.
  assert.equal(restoreSpaceNeeded({ files: 100 * MB, database: 10 * MB, currentDatabase: 20 * MB, dbJson: 0 }), 100 * MB + 10 * MB + 2 * 20 * MB + 64 * MB)
  assert.equal(restoreSpaceNeeded({ files: 0, database: 0, currentDatabase: 0, dbJson: 5 * MB }), 2 * 5 * MB + 2 * 5 * MB + 64 * MB)
})

test('Volle Platte: eine deutsche Meldung mit Ausweg statt der von Node', () => {
  for (const code of ['ENOSPC', 'EFBIG', 'EDQUOT']) {
    const message = diskFullMessage(Object.assign(new Error(`${code}: write`), { code }))
    if (!message) return assert.fail(code)
    assert.match(message, /Platz/)
    assert.doesNotMatch(message, new RegExp(code))
  }
  assert.equal(diskFullMessage(new Error('anders')), null)
})

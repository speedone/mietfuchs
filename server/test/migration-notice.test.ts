// Der Hinweis auf die Sicherung vor dem Update über einen Neustart hinweg (#180).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { acknowledgeNotice, clearNotice, NOTICE_NAME, noticeKey, readNotice, recordNotice } from '../src/db/migrationNotice.ts'

const BACKUP = 'mietfuchs.sqlite.vor-0001_objekte'
const notice = { steps: 3, backup: BACKUP, at: '2026-10-01T10:00:00.000Z' }

function withDir(work: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-hinweis-'))
  try {
    work(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test('Festgehalten, gelesen, weggeklickt', () => withDir((dir) => {
  fs.writeFileSync(path.join(dir, BACKUP), '')
  assert.equal(readNotice(dir), null, 'ohne Merkdatei kein Hinweis')
  recordNotice(dir, notice)
  assert.deepEqual(readNotice(dir), notice)
  assert.equal(acknowledgeNotice(dir, `${BACKUP}@1970-01-01T00:00:00.000Z`), 'unchanged', 'ein fremder Schlüssel räumt nichts weg')
  assert.deepEqual(readNotice(dir), notice)
  assert.equal(acknowledgeNotice(dir, noticeKey(notice)), 'cleared')
  assert.equal(readNotice(dir), null)
  assert.equal(fs.existsSync(path.join(dir, NOTICE_NAME)), false)
}))

test('Keine Meldung über eine Sicherung, die es nicht mehr gibt', () => withDir((dir) => {
  recordNotice(dir, notice)
  assert.equal(readNotice(dir), null)
}))

test('Eine unlesbare oder fremde Merkdatei ergibt keinen Hinweis und keinen Fehler', () => withDir((dir) => {
  fs.writeFileSync(path.join(dir, BACKUP), '')
  for (const inhalt of ['{kaputt', 'null', '[]', JSON.stringify({ ...notice, steps: '3' }),
    JSON.stringify({ ...notice, backup: '../mietfuchs.sqlite.vor-0001_objekte' }),
    JSON.stringify({ ...notice, backup: 'db.json' })]) {
    fs.writeFileSync(path.join(dir, NOTICE_NAME), inhalt)
    assert.equal(readNotice(dir), null, inhalt)
  }
  clearNotice(dir)
  clearNotice(dir) // zweimal geht auch
}))

test('Lässt sich die Merkdatei nicht entfernen, meldet das Wegklicken das, statt zu werfen', () => withDir((dir) => {
  fs.writeFileSync(path.join(dir, BACKUP), '')
  recordNotice(dir, notice)
  const scheitert = () => { throw new Error('EACCES') }
  assert.equal(acknowledgeNotice(dir, noticeKey(notice), scheitert), 'failed')
  assert.deepEqual(readNotice(dir), notice, 'der Hinweis bleibt und kommt beim nächsten Start wieder')
  assert.equal(acknowledgeNotice(dir, 'fremd'), 'unchanged')
  assert.equal(acknowledgeNotice(dir, noticeKey(notice)), 'cleared')
}))

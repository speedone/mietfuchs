import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { copyDirRetrying } from '../testing/copyDir.ts'

// Für scripts/fenster-umzug-praxislauf.mjs: Die alte Fassung löscht ihren Schnappschuss fürs Backup
// (`mietfuchs.sqlite.<id>.backup`) erst, nachdem die Antwort gesendet ist. cpSync bricht dann mit ENOENT ab
// und nennt das Ziel statt der verschwundenen Datei.

function scratch(t: { after: (fn: () => void) => void }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-copydir-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

function stockIn(dir: string): string {
  const src = path.join(dir, 'alt')
  fs.mkdirSync(path.join(src, 'uploads'), { recursive: true })
  fs.writeFileSync(path.join(src, 'mietfuchs.sqlite'), 'db')
  fs.writeFileSync(path.join(src, 'uploads', 'beleg.pdf'), 'pdf')
  fs.writeFileSync(path.join(src, 'mietfuchs.sqlite.abc.backup'), 'schnappschuss')
  return src
}

const listing = (dir: string): string[] => fs.readdirSync(dir, { recursive: true }).map(String).sort()

// So bricht cpSync ab, wenn eine Datei zwischen Auflisten und Kopieren verschwindet (Node 24 nachgestellt)
const vanishError = (dst: string): NodeJS.ErrnoException => Object.assign(new Error(`ENOENT, No such file or directory '${dst}'`), { code: 'ENOENT' })

test('Ordner kopieren: ohne Störung ein Versuch, alles mit Unterordnern', async (t) => {
  const dir = scratch(t)
  const src = stockIn(dir)
  const dst = path.join(dir, 'kopie')
  const result = await copyDirRetrying(src, dst)
  assert.equal(result.attempts, 1)
  assert.deepEqual(result.vanished, [])
  assert.deepEqual(listing(dst), listing(src))
  assert.equal(fs.readFileSync(path.join(dst, 'uploads', 'beleg.pdf'), 'utf8'), 'pdf')
})

test('Ordner kopieren: verschwindet eine Datei mittendrin, neuer Versuch in ein leeres Ziel, die Datei wird genannt', async (t) => {
  const dir = scratch(t)
  const src = stockIn(dir)
  const dst = path.join(dir, 'kopie')
  let calls = 0
  const result = await copyDirRetrying(src, dst, {
    pauseMs: 1,
    copy: (from, to) => {
      calls++
      if (calls === 1) {
        // Halb kopiert, dann löscht die alte Fassung ihren Schnappschuss
        fs.mkdirSync(to, { recursive: true })
        fs.copyFileSync(path.join(from, 'mietfuchs.sqlite.abc.backup'), path.join(to, 'mietfuchs.sqlite.abc.backup'))
        fs.rmSync(path.join(from, 'mietfuchs.sqlite.abc.backup'))
        throw vanishError(to)
      }
      fs.cpSync(from, to, { recursive: true })
    },
  })
  assert.equal(result.attempts, 2)
  assert.deepEqual(result.vanished, ['mietfuchs.sqlite.abc.backup'])
  // Kein Rest des ersten Versuchs im Ziel
  assert.deepEqual(listing(dst), listing(src))
  assert.ok(!fs.existsSync(path.join(dst, 'mietfuchs.sqlite.abc.backup')))
})

test('Ordner kopieren: nach drei Versuchen mit ENOENT ein Fehler, der die verschwundenen Dateien nennt', async (t) => {
  const dir = scratch(t)
  const src = stockIn(dir)
  const dst = path.join(dir, 'kopie')
  let calls = 0
  await assert.rejects(
    copyDirRetrying(src, dst, {
      pauseMs: 1,
      copy: (_from, to) => {
        calls++
        // Jedes Mal eine neue kurzlebige Datei, die gleich wieder weg ist
        const name = `mietfuchs.sqlite.v${calls}.backup`
        fs.writeFileSync(path.join(src, name), 'x')
        if (calls === 1) fs.rmSync(path.join(src, 'mietfuchs.sqlite.abc.backup'))
        fs.rmSync(path.join(src, name))
        throw vanishError(to)
      },
    }),
    (err: Error) => {
      assert.match(err.message, /3 Versuche/)
      assert.match(err.message, /mietfuchs\.sqlite\.abc\.backup/)
      return true
    },
  )
  assert.equal(calls, 3)
})

test('Ordner kopieren: ein anderer Fehler als ENOENT bricht sofort ab', async (t) => {
  const dir = scratch(t)
  const src = stockIn(dir)
  let calls = 0
  await assert.rejects(
    copyDirRetrying(src, path.join(dir, 'kopie'), {
      pauseMs: 1,
      copy: () => {
        calls++
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
      },
    }),
    /EACCES/,
  )
  assert.equal(calls, 1)
})

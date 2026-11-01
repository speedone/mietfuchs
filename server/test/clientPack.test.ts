// Das Frontend als eine Datei für das Programmfenster (#517, server/src/clientPack.ts)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openClientPack, writeClientPack } from '../src/clientPack.ts'

function fakeDist(t: { after: (fn: () => void) => void }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-pack-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const dist = path.join(dir, 'dist')
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true })
  fs.mkdirSync(path.join(dist, 'pdfjs', 'cmaps'), { recursive: true })
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>Größe</title>')
  fs.writeFileSync(path.join(dist, 'assets', 'index-abc.js'), 'console.log("ä")')
  // Binärdaten bleiben Byte für Byte, auch eine leere Datei
  fs.writeFileSync(path.join(dist, 'pdfjs', 'cmaps', 'A.bcmap'), Buffer.from([0, 255, 1, 254]))
  fs.writeFileSync(path.join(dist, 'pdfjs', 'cmaps', 'leer.bcmap'), Buffer.alloc(0))
  return { dir, dist }
}

test('Frontend-Paket: jede Datei kommt unter ihrer Adresse Byte für Byte zurück', (t) => {
  const { dir, dist } = fakeDist(t)
  const file = path.join(dir, 'out', 'dist.pack')
  assert.equal(writeClientPack(dist, file), 4)
  const pack = openClientPack(file)
  assert.equal(pack.size, 4)
  for (const rel of ['index.html', 'assets/index-abc.js', 'pdfjs/cmaps/A.bcmap', 'pdfjs/cmaps/leer.bcmap']) {
    assert.deepEqual(pack.read(`/${rel}`), fs.readFileSync(path.join(dist, rel)), rel)
  }
  // Was nicht darin steht, auch Namen aus dem Prototyp von Object, gibt es nicht
  for (const missing of ['/', '/assets', '/fehlt.js', '/constructor', '/__proto__', 'index.html']) assert.equal(pack.read(missing), null, missing)
})

test('Frontend-Paket: derselbe Ordner ergibt dieselbe Datei', (t) => {
  const { dir, dist } = fakeDist(t)
  writeClientPack(dist, path.join(dir, 'a.pack'))
  writeClientPack(dist, path.join(dir, 'b.pack'))
  assert.deepEqual(fs.readFileSync(path.join(dir, 'a.pack')), fs.readFileSync(path.join(dir, 'b.pack')))
})

test('Frontend-Paket: eine fremde oder abgeschnittene Datei wird abgelehnt', (t) => {
  const { dir, dist } = fakeDist(t)
  const foreign = path.join(dir, 'fremd.pack')
  fs.writeFileSync(foreign, 'irgendetwas anderes')
  assert.throws(() => openClientPack(foreign), /kein Frontend-Paket/)
  const file = path.join(dir, 'dist.pack')
  writeClientPack(dist, file)
  const whole = fs.readFileSync(file)
  fs.writeFileSync(file, whole.subarray(0, 30))
  assert.throws(() => openClientPack(file), /unvollständig/)
  fs.writeFileSync(file, whole.subarray(0, whole.length - 2))
  assert.throws(() => openClientPack(file).read('/pdfjs/cmaps/A.bcmap'), /unvollständig/)
})

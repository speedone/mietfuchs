// scripts/sign-update-manifest.mjs (#551): signiert latest.yml beim Release, so wie electron-builder 27 es täte, und nur,
// was wirklich gebaut wurde.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { signManifestFile } from '../../scripts/sign-update-manifest.mjs'
import { verifyManifestSignatures } from '../src/updateManifest.js'

// Dieselbe Fassung, mit der electron-updater latest.yml liest
const yaml = createRequire(import.meta.url)('js-yaml')

function keyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  return { pub: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), privateKey }
}

// Ein Ordner wie dist-desktop nach electron-builder: Installer und latest.yml in dessen Schreibweise
function release(content = 'MZ der Installer') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-signatur-'))
  const name = 'Mietfuchs-Setup-0.15.1.exe'
  fs.writeFileSync(path.join(dir, name), content)
  const sha512 = crypto.createHash('sha512').update(content).digest('base64')
  const size = Buffer.byteLength(content)
  fs.writeFileSync(path.join(dir, 'latest.yml'), `version: 0.15.1\nfiles:\n  - url: ${name}\n    sha512: ${sha512}\n    size: ${size}\npath: ${name}\nsha512: ${sha512}\nreleaseDate: '2026-11-02T10:00:00.000Z'\n`)
  return { dir, name }
}

test('signiert latest.yml so, dass das Fenster sie annimmt, und lässt den Rest stehen', (t) => {
  const { dir } = release()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const { pub, privateKey } = keyPair()
  const before = fs.readFileSync(path.join(dir, 'latest.yml'), 'utf8')
  const result = signManifestFile({ dir, privateKey, trusted: [pub] })
  assert.equal(result.version, '0.15.1')
  const after = fs.readFileSync(path.join(dir, 'latest.yml'), 'utf8')
  assert.ok(after.startsWith(before), 'der bisherige Inhalt bleibt unverändert davor stehen')
  const info = yaml.load(after)
  assert.equal(verifyManifestSignatures(info, [pub]).ok, true)
  assert.equal(info.signatures.length, 1)
})

test('signiert nicht, wenn latest.yml nicht zum gebauten Installer passt', (t) => {
  const { dir, name } = release()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const { pub, privateKey } = keyPair()
  fs.writeFileSync(path.join(dir, name), 'MZ ein anderer Installer')
  assert.throws(() => signManifestFile({ dir, privateKey, trusted: [pub] }), /passt nicht/)
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'latest.yml'), 'utf8'), /signatures/)
})

test('signiert nicht mit einem Schlüssel, dem das Fenster nicht glaubt', (t) => {
  // Ein falsch eingetragenes Secret fiele sonst erst auf, wenn kein Nutzer mehr ein Update bekommt
  const { dir } = release()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const { privateKey } = keyPair()
  assert.throws(() => signManifestFile({ dir, privateKey, trusted: [keyPair().pub] }), /keinem Schlüssel im Programm/)
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'latest.yml'), 'utf8'), /signatures/)
})

test('signiert nicht zweimal', (t) => {
  const { dir } = release()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const { pub, privateKey } = keyPair()
  signManifestFile({ dir, privateKey, trusted: [pub] })
  assert.throws(() => signManifestFile({ dir, privateKey, trusted: [pub] }), /schon signiert/)
})

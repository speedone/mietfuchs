// scripts/package-msix.mjs (#500): Versionsnummer und Manifest des Store-Pakets. Gebaut wird das
// Paket nur unter Windows (release.yml), die Regeln dafür lassen sich überall prüfen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fillManifest, msixVersion } from '../../scripts/package-msix.mjs'
import { STORE_PACKAGE_NAME } from '../src/paths.ts'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const template = fs.readFileSync(path.join(root, 'packaging', 'msix', 'AppxManifest.xml'), 'utf8')

test('MSIX-Version: Hauptversion plus 1, vierter Teil 0', () => {
  assert.equal(msixVersion('0.14.0'), '1.14.0.0')
  assert.equal(msixVersion('0.14.2'), '1.14.2.0')
  assert.equal(msixVersion('1.0.0'), '2.0.0.0')
  // Vorabversionen bekommen die Nummer der fertigen; eingereicht werden sie nicht
  assert.equal(msixVersion('0.15.0-rc.1'), '1.15.0.0')
})

test('MSIX-Version steigt mit jeder SemVer-Version, der Store nimmt nur höhere an', () => {
  const order = ['0.13.0', '0.13.1', '0.14.0', '0.99.99', '1.0.0', '1.0.1', '2.3.4']
  const key = (v: string) => msixVersion(v).split('.').map(Number)
  for (let i = 1; i < order.length; i++) {
    const [a, b] = [key(order[i - 1]), key(order[i])]
    const firstDiff = a.findIndex((n, j) => n !== b[j])
    assert.ok(firstDiff >= 0 && a[firstDiff] < b[firstDiff], `${order[i - 1]} < ${order[i]}`)
  }
})

test('MSIX-Version lehnt Unsinn und zu große Teile ab', () => {
  assert.throws(() => msixVersion('v0.14.0'), /SemVer/)
  assert.throws(() => msixVersion('0.14'), /SemVer/)
  assert.throws(() => msixVersion('0.65536.0'), /65535/)
})

test('Manifest: alle Platzhalter ersetzt, Identität passt zur Erkennung im Server', () => {
  const xml = fillManifest(template, { version: '1.14.0.0', arch: 'arm64' })
  assert.doesNotMatch(xml, /\{\{/)
  assert.match(xml, /Version="1\.14\.0\.0"/)
  assert.match(xml, /ProcessorArchitecture="arm64"/)
  assert.match(xml, /Executable="mietfuchs\.exe"/)
  // storeLocation erkennt das Paket an seinem Ordner, der mit dem Paketnamen beginnt
  assert.match(xml, new RegExp(`<Identity\\s+Name="${STORE_PACKAGE_NAME.replace('.', '\\.')}"`))
  // nur runFullTrust, keine Berechtigung, die der Store eigens begründet haben will
  const capabilities = [...xml.matchAll(/Capability Name="([^"]+)"/g)].map((m) => m[1])
  assert.deepEqual(capabilities, ['runFullTrust'])
})

test('Manifest: ein vergessener Platzhalter bricht ab', () => {
  assert.throws(() => fillManifest(`${template}<x>{{NEU}}</x>`, { version: '1.0.0.0', arch: 'x64' }), /\{\{NEU\}\}/)
})

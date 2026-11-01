// scripts/package-msix.mjs (#500): Versionsnummer, Manifest und Inhalt des Store-Pakets. Gebaut wird das
// Paket nur unter Windows (release.yml), die Regeln dafür lassen sich überall prüfen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ARCHITECTURES, PACKAGE_EXE, SERVER_DIR, checkWindowFolder, fillManifest, msixVersion, peInfo } from '../../scripts/package-msix.mjs'
import { REQUIRED_SERVER_FILES } from '../../scripts/package-desktop.mjs'
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
  // Gestartet wird das Programmfenster (#517), auch über den Befehlsalias, der weiter „mietfuchs“ heißt
  assert.equal(PACKAGE_EXE, 'Mietfuchs.exe')
  assert.deepEqual([...xml.matchAll(/Executable="([^"]+)"/g)].map((m) => m[1]), ['Mietfuchs.exe', 'Mietfuchs.exe'])
  assert.deepEqual([...xml.matchAll(/Alias="([^"]+)"/g)].map((m) => m[1]), ['mietfuchs.exe'])
  // storeLocation erkennt das Paket an seinem Ordner, der mit dem Paketnamen beginnt
  assert.match(xml, new RegExp(`<Identity\\s+Name="${STORE_PACKAGE_NAME.replace('.', '\\.')}"`))
  // nur runFullTrust, keine Berechtigung, die der Store eigens begründet haben will
  const capabilities = [...xml.matchAll(/Capability Name="([^"]+)"/g)].map((m) => m[1])
  assert.deepEqual(capabilities, ['runFullTrust'])
})

test('Manifest: ein vergessener Platzhalter bricht ab', () => {
  assert.throws(() => fillManifest(`${template}<x>{{NEU}}</x>`, { version: '1.0.0.0', arch: 'x64' }), /\{\{NEU\}\}/)
})

// Ein Kopf, wie ihn eine Windows-Programmdatei trägt: „MZ“, bei 0x3C der Verweis auf „PE\0\0“, danach die Maschine
// und im optionalen Kopf (PE32+) das Subsystem.
function fakePe(machine: number, subsystem: number): Buffer {
  const b = Buffer.alloc(1024)
  b.write('MZ', 0, 'latin1')
  b.writeUInt32LE(0x80, 0x3c)
  b.write('PE\0\0', 0x80, 'latin1')
  b.writeUInt16LE(machine, 0x84)
  b.writeUInt16LE(0xf0, 0x80 + 20)
  b.writeUInt16LE(0x20b, 0x80 + 24)
  b.writeUInt16LE(subsystem, 0x80 + 24 + 68)
  return b
}
const X64 = 0x8664
const ARM64 = 0xaa64
const GUI = 2
const CONSOLE = 3

test('peInfo: Architektur und Subsystem aus dem Kopf einer Programmdatei', () => {
  assert.deepEqual(peInfo(fakePe(X64, GUI)), { machine: 'x64', subsystem: 'gui' })
  assert.deepEqual(peInfo(fakePe(ARM64, CONSOLE)), { machine: 'arm64', subsystem: 'console' })
  assert.deepEqual(peInfo(fakePe(0x14c, 9)), { machine: '0x14c', subsystem: '9' })
  assert.throws(() => peInfo(Buffer.from('#!/bin/sh\n')), /keine Windows-Programmdatei/)
})

// Der Ordner, den electron-builder je Architektur entpackt neben den Installer legt. Geänderte Erwartung: Darin lag
// bisher die Programmdatei des Servers (resources\\server\\mietfuchs.exe), geprüft auf Architektur und Konsolenfenster.
// Heute läuft der Server als Bündel im Fenster selbst (utilityProcess); geprüft wird deshalb das Fenster am PE-Kopf
// und der Server-Ordner auf Vollständigkeit. Ein Konsolenfenster kann der Server nicht mehr öffnen, er ist
// Mietfuchs.exe, und das ist eine GUI-Datei.
function windowFolder(arch: number, subsystem: number, server: boolean) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-msix-'))
  fs.writeFileSync(path.join(dir, PACKAGE_EXE), fakePe(arch, subsystem))
  if (server) {
    const serverDir = path.join(dir, ...SERVER_DIR.split('\\'))
    for (const file of REQUIRED_SERVER_FILES) {
      fs.mkdirSync(path.join(serverDir, path.dirname(file)), { recursive: true })
      fs.writeFileSync(path.join(serverDir, file), '')
    }
  }
  return dir
}

test('Store-Paket: je Architektur der entpackte Ordner des Programmfensters', () => {
  assert.deepEqual(ARCHITECTURES, [{ arch: 'x64', dir: 'win-unpacked' }, { arch: 'arm64', dir: 'win-arm64-unpacked' }])
  // Dort sucht das Fenster den Server (serverModule und SERVER_FOLDER in desktop/src/server.js)
  assert.equal(SERVER_DIR, 'resources\\mietfuchs')
})

test('Store-Paket: ein vollständiger Ordner geht durch', (t) => {
  const dir = windowFolder(ARM64, GUI, true)
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  assert.doesNotThrow(() => checkWindowFolder(dir, 'arm64'))
})

test('Store-Paket: fehlender Server, falsche Architektur oder Konsolenfenster brechen ab', (t) => {
  const cases: [string, ReturnType<typeof windowFolder>, RegExp][] = [
    ['ohne Server', windowFolder(ARM64, GUI, false), /server\.mjs fehlt/],
    ['Fenster für die falsche Architektur', windowFolder(X64, GUI, true), /Mietfuchs\.exe ist für x64 gebaut, nicht für arm64/],
    ['Fenster mit Konsolenfenster', windowFolder(ARM64, CONSOLE, true), /Konsolenfenster/],
  ]
  for (const [what, dir, error] of cases) {
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
    assert.throws(() => checkWindowFolder(dir, 'arm64'), error, what)
  }
})

// scripts/package-desktop.mjs (#517): Namen der Dateien, die Nutzer herunterladen. electron-builder kennt für die
// Architektur nur arm64 und x64; am Release stehen die Namen, unter denen Mac-Nutzer ihren Rechner kennen, wie bei
// den Programmdateien (mietfuchs-macos-apple-silicon.zip, mietfuchs-macos-intel.zip).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { userFileName } from '../../scripts/package-desktop.mjs'

test('Programmfenster: .dmg heißen nach Apple Silicon und Intel', () => {
  assert.equal(userFileName('Mietfuchs-0.15.0-arm64.dmg'), 'Mietfuchs-0.15.0-apple-silicon.dmg')
  assert.equal(userFileName('Mietfuchs-0.15.0-x64.dmg'), 'Mietfuchs-0.15.0-intel.dmg')
  // Vorabversion: der Bindestrich der Version bleibt unberührt
  assert.equal(userFileName('Mietfuchs-0.15.0-rc.1-arm64.dmg'), 'Mietfuchs-0.15.0-rc.1-apple-silicon.dmg')
  // Die Blockmap gehört zur Datei und zieht mit
  assert.equal(userFileName('Mietfuchs-0.15.0-x64.dmg.blockmap'), 'Mietfuchs-0.15.0-intel.dmg.blockmap')
})

test('Programmfenster: der Windows-Installer und alles andere behält seinen Namen', () => {
  for (const name of ['Mietfuchs-Setup-0.15.0.exe', 'Mietfuchs-Setup-0.15.0.exe.blockmap', 'latest.yml', 'win-unpacked', 'win-arm64-unpacked', 'mac-arm64', 'builder-debug.yml']) {
    assert.equal(userFileName(name), name)
  }
})

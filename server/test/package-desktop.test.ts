// scripts/package-desktop.mjs (#517): Namen der Dateien, die Nutzer herunterladen. electron-builder kennt für die
// Architektur nur arm64 und x64; am Release stehen die Namen, unter denen Mac-Nutzer ihren Rechner kennen, wie bei
// den Programmdateien (mietfuchs-macos-apple-silicon.zip, mietfuchs-macos-intel.zip).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { REQUIRED_SERVER_FILES, checkServerFolder, prunable, stagedPath, userFileName } from '../../scripts/package-desktop.mjs'

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

// Der Server im Fenster (#517) läuft aus dem Quellcode unter Electrons Node. package-desktop.mjs legt ihn unter
// resources/mietfuchs in der Anordnung des Repos ab; was der Server zur Laufzeit liest, muss darin stehen, was nur
// Entwickler brauchen (Tests, Doku, eingebettete Dateien der Programmdatei, der eigene Datenordner, die Schnappschüsse
// von drizzle-kit, zusammen 12 MB) nicht.
test('Programmfenster: in den Server-Ordner kommt, was der Server zur Laufzeit braucht', () => {
  for (const file of ['server/src/index.ts', 'server/src/db/client.ts', 'server/drizzle/0000_ordinary_karnak.sql', 'server/drizzle/meta/_journal.json', 'server/package.json', 'server/package-lock.json', 'shared/types.ts', 'shared/law/register.ts', 'client/dist/index.html', 'client/dist/assets/index-abc.js']) {
    assert.equal(stagedPath(file), true, file)
  }
  for (const file of ['server/test/calc.test.ts', 'server/testing/api.ts', 'server/data/mietfuchs.sqlite', 'server/src/CLAUDE.md', 'server/src/db/CLAUDE.md', 'server/src/embedded-client.js', 'server/src/db/embedded-migrations.js', 'server/node_modules/express/index.js', 'server/scripts/irgendwas.mjs', 'client/src/App.tsx', 'shared/CLAUDE.md', 'server/tsconfig.json', 'server/drizzle.config.ts', 'server/drizzle/meta/0000_snapshot.json']) {
    assert.equal(stagedPath(file), false, file)
  }
  // Auch unter Windows geschriebene Pfade
  assert.equal(stagedPath('server\\src\\index.ts'), true)
  assert.equal(stagedPath('server\\test\\calc.test.ts'), false)
})

test('Programmfenster: ein unvollständiger Server-Ordner bricht ab und nennt, was fehlt', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-fenster-server-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  assert.throws(() => checkServerFolder(dir), /server[\\/]src[\\/]index\.ts fehlt/)
  for (const file of REQUIRED_SERVER_FILES) {
    fs.mkdirSync(path.join(dir, path.dirname(file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), file === 'package.json' ? '{"type":"module"}' : '')
  }
  assert.doesNotThrow(() => checkServerFolder(dir))
  // Ohne "type": "module" gälte shared/ als CommonJS, und der Server startete nicht
  fs.writeFileSync(path.join(dir, 'package.json'), '{}')
  assert.throws(() => checkServerFolder(dir), /"type": "module"/)
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}')
  // Ohne Produktionsabhängigkeiten ebenso nicht
  fs.rmSync(path.join(dir, 'server', 'node_modules'), { recursive: true })
  assert.throws(() => checkServerFolder(dir), /node_modules/)
})

// Typdeklarationen und Source-Maps der Abhängigkeiten lädt der Server nie, sie machen aber fast die Hälfte von
// node_modules aus (13 von 30 MB, vor allem drizzle-orm). Lizenzen und Code bleiben.
test('Programmfenster: aus node_modules fallen nur Typdeklarationen und Source-Maps', () => {
  for (const file of ['drizzle-orm/index.d.ts', 'drizzle-orm/index.d.cts', 'x/y.d.mts', 'express/lib/a.js.map']) assert.equal(prunable(file), true, file)
  for (const file of ['drizzle-orm/index.js', 'drizzle-orm/index.cjs', 'express/LICENSE', 'qs/package.json', 'a/types.ts', 'a/d.ts.js']) assert.equal(prunable(file), false, file)
})

// Baut das Programmfenster (#517) mit electron-builder: unter Windows einen Installer für x64 und ARM64 zusammen
// (NSIS, für den Benutzer, ohne Adminrechte), auf dem Mac je ein Abbild (.dmg) für Apple Silicon und Intel, ad hoc
// signiert. Hinein kommt die Programmdatei des Servers aus package-binaries.mjs, unter Windows die ohne
// Konsolenfenster (dist-bin/store), damit neben dem Fenster kein schwarzes aufgeht.
//
//   node scripts/package-desktop.mjs win     (unter Windows)
//   node scripts/package-desktop.mjs mac     (unter macOS)
//
// Vorher: `node scripts/package-binaries.mjs` (oder die Programmdateien aus dem Artefakt nach dist-bin/) und
// `npm --prefix desktop ci`. Ergebnis in dist-desktop/.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bin = path.join(root, 'dist-bin')
const stage = path.join(bin, 'desktop')

// Woher die Programmdatei je Architektur kommt und wohin electron-builder sie erwartet (desktop/package.json, `build`)
const SOURCES = {
  win: [
    { from: path.join('store', 'mietfuchs-store-x64.exe'), to: path.join('win-x64', 'mietfuchs.exe') },
    { from: path.join('store', 'mietfuchs-store-arm64.exe'), to: path.join('win-arm64', 'mietfuchs.exe') },
  ],
  mac: [
    { from: 'mietfuchs-macos-apple-silicon', to: path.join('mac-arm64', 'mietfuchs-server') },
    { from: 'mietfuchs-macos-intel', to: path.join('mac-x64', 'mietfuchs-server') },
  ],
}

const target = process.argv[2]
if (target !== 'win' && target !== 'mac') {
  console.error('Aufruf: node scripts/package-desktop.mjs win|mac')
  process.exit(1)
}

for (const { from, to } of SOURCES[target]) {
  const source = path.join(bin, from)
  if (!fs.existsSync(source)) {
    console.error(`${source} fehlt. Zuerst die Programmdateien bauen: node scripts/package-binaries.mjs`)
    process.exit(1)
  }
  const dest = path.join(stage, to)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(source, dest)
  fs.chmodSync(dest, 0o755)
}

// Kein Veröffentlichen aus electron-builder heraus: Ans Release hängt release.yml an, wie alle anderen Dateien.
const builder = path.join(root, 'desktop', 'node_modules', '.bin', process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder')
execFileSync(builder, [`--${target}`, '--publish', 'never'], { cwd: path.join(root, 'desktop'), stdio: 'inherit', shell: process.platform === 'win32' })
for (const file of fs.readdirSync(path.join(root, 'dist-desktop'))) console.log('   •', file)

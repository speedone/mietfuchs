// Baut das Programmfenster (#517) mit electron-builder: unter Windows einen Installer für x64 und ARM64 zusammen
// (NSIS, für den Benutzer, ohne Adminrechte), auf dem Mac je ein Abbild (.dmg) für Apple Silicon und Intel, ad hoc
// signiert. Der Server läuft im Fenster aus dem Quellcode mit Electrons eigenem Node (utilityProcess, siehe
// desktop/src/main.js); eine Programmdatei des Servers gibt es darin nicht. Dieses Skript legt ihn dafür unter
// dist-desktop-server/ in der Anordnung des Repos ab, mit den Produktionsabhängigkeiten (`npm ci --omit=dev` in der
// Kopie) und dem gebauten Frontend; electron-builder nimmt den Ordner als resources/mietfuchs mit (desktop/package.json,
// `extraResources`). Er ist für alle Architekturen derselbe, denn der Server hat keine nativen Module.
//
//   node scripts/package-desktop.mjs win     (unter Windows)
//   node scripts/package-desktop.mjs mac     (unter macOS)
//   node scripts/package-desktop.mjs server  (nur den Server-Ordner, auf jedem System)
//
// Vorher: `npm run build` (oder `npm --prefix client ci && npm --prefix client run build`) für client/dist und
// `npm --prefix desktop ci`. Ergebnis in dist-desktop/: Mietfuchs-Setup-<Version>.exe, daneben je Architektur der
// entpackte Ordner (win-unpacked, win-arm64-unpacked), aus dem package-msix.mjs das Store-Paket baut; auf dem Mac
// Mietfuchs-<Version>-apple-silicon.dmg und -intel.dmg.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Wohin der Server-Ordner kommt; `extraResources` in desktop/package.json liest ihn von dort
const stage = path.join(root, 'dist-desktop-server')

/**
 * Gehört die Datei (Pfad relativ zum Repo) in den Server-Ordner des Fensters? Hinein kommt, was der Server zur
 * Laufzeit liest: sein Quellcode, die Migrationen samt Journal, die beiden package.json, shared/ und das gebaute
 * Frontend. Nicht hinein: Tests und Testhelfer, Doku, die eingebetteten Dateien der Programmdatei (Bun), der
 * Datenordner beim Entwickeln, die Schnappschüsse von drizzle-kit (12 MB, nur zum Erzeugen neuer Migrationen) und
 * node_modules (die kommen frisch aus `npm ci --omit=dev`).
 * @param {string} file
 */
export function stagedPath(file) {
  const rel = file.replaceAll('\\', '/')
  if (rel.endsWith('.md')) return false
  if (rel.startsWith('server/src/')) return !['server/src/embedded-client.js', 'server/src/db/embedded-migrations.js'].includes(rel)
  if (rel.startsWith('server/drizzle/')) return /^server\/drizzle\/[^/]+\.sql$/.test(rel) || rel === 'server/drizzle/meta/_journal.json'
  if (rel === 'server/package.json' || rel === 'server/package-lock.json') return true
  return rel.startsWith('shared/') || rel.startsWith('client/dist/')
}

// Was nach `npm ci` aus node_modules fällt: Typdeklarationen und Source-Maps, die der Server zur Laufzeit nie lädt
// (13 von 30 MB, vor allem drizzle-orm). Lizenzen und Code bleiben.
/** @param {string} file */
export function prunable(file) {
  return /\.d\.[cm]?ts$|\.map$/.test(file)
}

// Woran sich ein vollständiger Server-Ordner erkennen lässt, auch im entpackten Ordner des Fensters (package-msix.mjs)
export const REQUIRED_SERVER_FILES = [
  'server/src/index.ts',
  'server/package.json',
  'server/drizzle/meta/_journal.json',
  'server/node_modules/express/package.json',
  'shared/types.ts',
  'client/dist/index.html',
  'package.json',
]

/** @param {string} dir der Server-Ordner (dist-desktop-server bzw. resources/mietfuchs) */
export function checkServerFolder(dir) {
  for (const file of REQUIRED_SERVER_FILES) {
    if (!fs.existsSync(path.join(dir, file))) throw new Error(`${path.join(dir, file)} fehlt im Server-Ordner des Fensters`)
  }
  // Die Wurzel trägt "type": "module", sonst gälte shared/ als CommonJS (CLAUDE.md, Architektur)
  const pkg = /** @type {any} */ (JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')))
  if (pkg.type !== 'module') throw new Error(`${path.join(dir, 'package.json')} braucht "type": "module"`)
}

/** @param {string} dir @param {string} [rel] @returns {string[]} */
function listFiles(dir, rel = '') {
  /** @type {string[]} */
  const files = []
  for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const child = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') files.push(...listFiles(dir, child))
    } else if (entry.isFile()) files.push(child)
  }
  return files
}

// Den Server-Ordner neu anlegen: Dateien aus dem Repo, eine package.json mit "type": "module", die
// Produktionsabhängigkeiten aus dem Lockfile des Servers. Ohne Installskripte, der Server hat keine nativen Module.
function prepareServer() {
  if (!fs.existsSync(path.join(root, 'client', 'dist', 'index.html'))) {
    console.error('client/dist fehlt. Zuerst das Frontend bauen: npm run build')
    process.exit(1)
  }
  fs.rmSync(stage, { recursive: true, force: true })
  let count = 0
  for (const top of ['server', 'shared', 'client/dist']) {
    for (const file of listFiles(root, top)) {
      if (!stagedPath(file)) continue
      fs.mkdirSync(path.join(stage, path.dirname(file)), { recursive: true })
      fs.copyFileSync(path.join(root, file), path.join(stage, file))
      count++
    }
  }
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'server', 'package.json'), 'utf8'))
  fs.writeFileSync(path.join(stage, 'package.json'), `${JSON.stringify({ name: 'mietfuchs-fenster-server', version, private: true, type: 'module' }, null, 2)}\n`)
  console.log(`→ Server-Ordner: ${count} Dateien, Produktionsabhängigkeiten mit npm ci --omit=dev`)
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: path.join(stage, 'server'),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  let pruned = 0
  const modules = path.join(stage, 'server', 'node_modules')
  for (const file of fs.readdirSync(modules, { recursive: true, encoding: 'utf8' })) {
    if (!prunable(file) || !fs.statSync(path.join(modules, file)).isFile()) continue
    fs.rmSync(path.join(modules, file))
    pruned++
  }
  console.log(`→ ${pruned} Typdeklarationen und Source-Maps aus node_modules entfernt`)
  checkServerFolder(stage)
}

// electron-builder benennt die Architektur nur arm64 oder x64. Nutzer kennen ihren Mac als Apple Silicon oder Intel,
// so heißen auch die Programmdateien am Release; die .dmg ziehen nach (samt Blockmap).
const MAC_NAMES = { arm64: 'apple-silicon', x64: 'intel' }
/** @param {string} file */
export function userFileName(file) {
  return file.replace(/-(arm64|x64)(\.dmg(?:\.blockmap)?)$/, (_all, arch, ext) => `-${MAC_NAMES[/** @type {'arm64' | 'x64'} */ (arch)]}${ext}`)
}

function main() {
  const target = process.argv[2]
  if (target !== 'win' && target !== 'mac' && target !== 'server') {
    console.error('Aufruf: node scripts/package-desktop.mjs win|mac|server')
    process.exit(1)
  }

  prepareServer()
  if (target === 'server') return

  // Kein Veröffentlichen aus electron-builder heraus: Ans Release hängt release.yml an, wie alle anderen Dateien.
  const builder = path.join(root, 'desktop', 'node_modules', '.bin', process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder')
  // Signiert wird auch beim Bau aus einem Pull Request (dort lässt electron-builder es sonst aus): Auf dem Mac ist es nur
  // die Ad-hoc-Signatur ohne Geheimnis, und ohne sie ist die App nach dem Setzen der Fuses ungültig signiert.
  execFileSync(builder, [`--${target}`, '--publish', 'never'], {
    cwd: path.join(root, 'desktop'),
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, CSC_FOR_PULL_REQUEST: 'true' },
  })
  const out = path.join(root, 'dist-desktop')
  for (const file of fs.readdirSync(out)) {
    const name = userFileName(file)
    if (name !== file) fs.renameSync(path.join(out, file), path.join(out, name))
    console.log('   •', name)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()

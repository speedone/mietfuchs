// Baut Mietfuchs zu eigenständigen Binaries (Windows/macOS/Linux) über Bun --compile.
// Ablauf: Frontend bauen → Embed-Modul aus client/dist erzeugen → für jedes Ziel
// ein Binary kompilieren. Bun führt ESM + top-level await nativ aus und bettet die
// per `with { type: "file" }` referenzierten Frontend-Dateien mit ein.
//
// Nutzung:
//   node scripts/package-binaries.mjs            # alle Ziele
//   node scripts/package-binaries.mjs win        # nur ein Ziel (win|macos-x64|macos-arm64|linux)
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const isWin = process.platform === 'win32'
const npm = isWin ? 'npm.cmd' : 'npm'
const bun = isWin ? 'bun.cmd' : 'bun'
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: 'inherit', cwd: root, ...opts })
// npm/bun sind unter Windows .cmd-Wrapper — die brauchen seit Node 20 shell:true.
// Direkte .exe-Aufrufe (node) dürfen das NICHT (shell:true zerlegt Pfade mit Leerzeichen).
const runShell = (cmd, args, opts = {}) => run(cmd, args, { shell: isWin, ...opts })

// Ausgabename + Bun-Target je Plattform
const TARGETS = {
  win: { target: 'bun-windows-x64', out: 'mietfuchs-win.exe' },
  'macos-x64': { target: 'bun-darwin-x64', out: 'mietfuchs-macos-intel' },
  'macos-arm64': { target: 'bun-darwin-arm64', out: 'mietfuchs-macos-apple-silicon' },
  linux: { target: 'bun-linux-x64', out: 'mietfuchs-linux' },
}
const only = process.argv[2]
if (only && !TARGETS[only]) {
  console.error(`Unbekanntes Ziel "${only}". Erlaubt: ${Object.keys(TARGETS).join(', ')}`)
  process.exit(1)
}
const selected = only ? { [only]: TARGETS[only] } : TARGETS

console.log('→ Frontend bauen (vite build) …')
runShell(npm, ['run', 'build'])

console.log('→ Embed-Modul aus client/dist erzeugen …')
run(process.execPath, ['scripts/embed-client.mjs'])

const outDir = path.join(root, 'dist-bin')
fs.mkdirSync(outDir, { recursive: true })

for (const [name, { target, out }] of Object.entries(selected)) {
  console.log(`\n→ Bun --compile: ${name} (${target}) …`)
  runShell(bun, [
    'build',
    '--compile',
    `--target=${target}`,
    'server/src/index.js',
    '--outfile',
    path.join(outDir, out),
  ])
}

console.log(`\n✓ Fertig. Binaries liegen in ${outDir}:`)
for (const f of fs.readdirSync(outDir)) console.log('   •', f)

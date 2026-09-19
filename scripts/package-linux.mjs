// Baut die Linux-Installationspakete (#25) aus den fertigen Programmdateien in dist-bin/:
// .deb (Debian, Ubuntu, Mint), .rpm (Fedora, openSUSE, RHEL und Verwandte) und das Paket für
// Arch Linux, je Prozessor (x64 und ARM64). Gebaut wird mit nFPM, das alle Formate aus einer
// Vorschrift erzeugt (packaging/nfpm.yaml), ohne dpkg oder rpmbuild auf dem Rechner.
//
// Nutzung (nach `npm run package`, das die Programmdateien baut):
//   node scripts/package-linux.mjs             # alle Formate für beide Prozessoren
//   node scripts/package-linux.mjs linux-arm64 # nur ein Ziel (Namen siehe TARGETS)
//
// nFPM kommt von der Platte, wenn es im Pfad liegt, sonst aus seinem Container. Wer weder nFPM
// noch Docker hat, bekommt eine Meldung statt eines halben Ergebnisses.
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'dist-bin')
// Ordner, aus dem nFPM die Programmdatei nimmt. Der Name darin ist fest, damit die Vorschrift
// ohne Platzhalter im Dateipfad auskommt.
const stageDir = path.join(outDir, 'stage')

// Die Paketversion kommt aus der Root-package.json, die Programmdatei meldet die aus
// server/package.json. Laufen beide auseinander, trüge ein Paket die falsche Nummer: `rpm -i`
// bricht mit „already installed“ ab, und der Nutzer käme nicht an die neue Fassung.
const versionOf = (dir) => JSON.parse(fs.readFileSync(path.join(root, dir, 'package.json'), 'utf8')).version
const version = versionOf('.')
const serverVersion = versionOf('server')
if (version !== serverVersion) {
  console.error(`Die Versionen weichen ab: package.json ${version}, server/package.json ${serverVersion}. Beide müssen gleich sein.`)
  process.exit(1)
}

// Prozessor in der Schreibweise von nFPM (wie Go sie nutzt), dazu die gebaute Programmdatei
const TARGETS = {
  linux: { arch: 'amd64', binary: 'mietfuchs-linux' },
  'linux-arm64': { arch: 'arm64', binary: 'mietfuchs-linux-arm64' },
}
const FORMATS = ['deb', 'rpm', 'archlinux']

const only = process.argv[2]
if (only && !TARGETS[only]) {
  console.error(`Unbekanntes Ziel "${only}". Erlaubt: ${Object.keys(TARGETS).join(', ')}`)
  process.exit(1)
}
const selected = only ? { [only]: TARGETS[only] } : TARGETS

// nFPM von der Platte oder aus dem Container. Die Vorschrift und die Quelldateien liegen unter
// root, deshalb läuft der Container mit root als Arbeitsordner.
function nfpmRunner() {
  const works = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' }).status === 0
  if (works('nfpm', ['--version'])) {
    return (env, args) => execFileSync('nfpm', args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } })
  }
  if (works('docker', ['version', '--format', '{{.Server.Os}}'])) {
    return (env, args) =>
      execFileSync(
        'docker',
        ['run', '--rm', '-v', `${root}:/work`, '-w', '/work',
          ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
          'goreleaser/nfpm:latest', ...args],
        { cwd: root, stdio: 'inherit' },
      )
  }
  throw new Error('Weder nFPM noch Docker gefunden. nFPM installieren (https://nfpm.goreleaser.com) oder Docker starten.')
}

const run = nfpmRunner()
fs.mkdirSync(stageDir, { recursive: true })

try {
  for (const [name, { arch, binary }] of Object.entries(selected)) {
    const built = path.join(outDir, binary)
    if (!fs.existsSync(built)) {
      console.error(`${binary} fehlt in dist-bin. Erst "npm run package" ausführen (oder "node scripts/package-binaries.mjs ${name}").`)
      process.exit(1)
    }
    const staged = path.join(stageDir, 'mietfuchs')
    fs.copyFileSync(built, staged)
    fs.chmodSync(staged, 0o755)
    for (const format of FORMATS) {
      console.log(`\n→ ${format} für ${arch} …`)
      run({ PKG_ARCH: arch, PKG_VERSION: version }, ['package', '--config', 'packaging/nfpm.yaml', '--packager', format, '--target', 'dist-bin'])
    }
  }
} finally {
  // Auch nach einem Fehler weg: Sonst bliebe eine Kopie der Programmdatei von gut 100 MB liegen.
  fs.rmSync(stageDir, { recursive: true, force: true })
}

console.log(`\n✓ Fertig. Pakete in ${outDir}:`)
for (const f of fs.readdirSync(outDir).filter((f) => /\.(deb|rpm|pkg\.tar\.zst)$/.test(f))) console.log('   •', f)

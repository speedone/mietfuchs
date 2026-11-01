// Baut aus dem Programmfenster (#517) das Paket für den Microsoft Store (#500): je Architektur ein .msix,
// zusammen ein .msixbundle, das das Partner Center so annimmt. Hinein kommt der Ordner, den electron-builder beim
// Bau des Installers je Architektur entpackt ablegt (dist-desktop/win-unpacked, win-arm64-unpacked; siehe
// package-desktop.mjs): das Fenster Mietfuchs.exe und darin unter resources\server\mietfuchs.exe die Programmdatei
// des Servers ohne Konsolenfenster. Dort erkennt der Server den Store (storeLocation in server/src/paths.ts).
// Signiert wird nicht: Das übernimmt der Store bei der Zertifizierung. Läuft nur unter Windows, weil makeappx zum
// Windows SDK gehört.
//
// Nutzung:
//   node scripts/package-msix.mjs                 # liest dist-desktop, schreibt dist-bin/msix
//   node scripts/package-msix.mjs --in <Ordner> --out <Ordner>
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Die Version des Pakets hat vier Teile, der erste darf nicht 0 sein und der vierte gehört dem
// Store (immer 0). Mietfuchs zählt in SemVer ab 0.x, deshalb steht vorn die Hauptversion plus 1:
// 0.14.2 wird 1.14.2.0, 1.0.0 wird 2.0.0.0. Die Zuordnung ist für immer festgelegt, denn der
// Store nimmt nur höhere Versionen an; die Oberfläche nennt weiter die SemVer-Version. Eine
// Vorabversion bekommt dieselbe Nummer wie die fertige, eingereicht wird sie nie (release.yml).
/** @param {string} version */
export function msixVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(version)
  if (!match) throw new Error(`Keine SemVer-Version: „${version}“`)
  const [major, minor, patch] = match.slice(1).map(Number)
  const parts = [major + 1, minor, patch]
  if (parts.some((n) => n > 65535)) throw new Error(`Version ${version} passt nicht in ein MSIX-Paket (je Teil höchstens 65535)`)
  return `${parts.join('.')}.0`
}

// Je Architektur der entpackte Ordner des Fensters, so benennt ihn electron-builder (x64 ohne Zusatz).
export const ARCHITECTURES = [
  { arch: 'x64', dir: 'win-unpacked' },
  { arch: 'arm64', dir: 'win-arm64-unpacked' },
]
// Gestartet wird das Fenster (productName in desktop/package.json); der Befehlsalias im Manifest heißt weiter
// mietfuchs.exe und zeigt darauf.
export const PACKAGE_EXE = 'Mietfuchs.exe'
// Die Programmdatei des Servers im Ordner des Fensters (extraResources in desktop/package.json, serverCommand in
// desktop/src/server.js)
export const SERVER_EXE = 'resources\\server\\mietfuchs.exe'

const MACHINES = { 0x8664: 'x64', 0xaa64: 'arm64' }
const SUBSYSTEMS = { 2: 'gui', 3: 'console' }

// Architektur und Subsystem aus dem Kopf einer Windows-Programmdatei (PE): bei 0x3C der Verweis auf „PE\0\0“, vier
// Bytes dahinter die Maschine, im optionalen Kopf ab 24 an Stelle 68 das Subsystem (für PE32 und PE32+ gleich).
/** @param {Buffer} head die ersten Bytes der Datei, 1 KiB genügt */
export function peInfo(head) {
  const pe = head.length >= 0x40 && head.toString('latin1', 0, 2) === 'MZ' ? head.readUInt32LE(0x3c) : -1
  if (pe < 0 || pe + 24 + 70 > head.length || head.toString('latin1', pe, pe + 4) !== 'PE\0\0') {
    throw new Error('keine Windows-Programmdatei')
  }
  const machine = head.readUInt16LE(pe + 4)
  const subsystem = head.readUInt16LE(pe + 24 + 68)
  return {
    machine: MACHINES[machine] ?? `0x${machine.toString(16)}`,
    subsystem: SUBSYSTEMS[subsystem] ?? String(subsystem),
  }
}

/** @param {string} file */
function readHead(file) {
  const fd = fs.openSync(file, 'r')
  try {
    const head = Buffer.alloc(4096)
    return head.subarray(0, fs.readSync(fd, head, 0, head.length, 0))
  } finally {
    fs.closeSync(fd)
  }
}

// Bevor gepackt wird: Fenster und Server da, beide für die Architektur des Pakets, der Server ohne Konsolenfenster.
// Ein vertauschter Ordner liefe auf dem falschen Rechner gar nicht oder nur emuliert, und die Datei vom Release
// stellte neben das Fenster ein schwarzes Konsolenfenster; beides fiele erst bei Nutzern auf.
/** @param {string} dir @param {string} arch */
export function checkWindowFolder(dir, arch) {
  for (const name of [PACKAGE_EXE, SERVER_EXE]) {
    const file = path.join(dir, ...name.split('\\'))
    if (!fs.existsSync(file)) throw new Error(`${name} fehlt in ${dir}. Zuerst das Fenster bauen: node scripts/package-desktop.mjs win`)
    let info
    try {
      info = peInfo(readHead(file))
    } catch (err) {
      throw new Error(`${name} in ${dir}: ${/** @type {Error} */ (err).message}`)
    }
    if (info.machine !== arch) throw new Error(`${name} ist für ${info.machine} gebaut, nicht für ${arch} (${dir})`)
    if (info.subsystem !== 'gui') throw new Error(`${name} öffnet ein Konsolenfenster (Subsystem ${info.subsystem}); ins Paket gehört die Datei aus dist-bin/store (${dir})`)
  }
}

/** @param {string} template @param {{ version: string, arch: string }} values */
export function fillManifest(template, { version, arch }) {
  const filled = template
    .replaceAll('{{VERSION}}', version)
    .replaceAll('{{ARCH}}', arch)
    .replaceAll('{{EXE}}', PACKAGE_EXE)
  const left = /\{\{[A-Z]+\}\}/.exec(filled)
  if (left) throw new Error(`Platzhalter ${left[0]} im Manifest nicht ersetzt`)
  return filled
}

// makeappx liegt im Windows SDK unter einer Versionsnummer; genommen wird die neueste.
function findSdkTool(name) {
  const base = 'C:\\Program Files (x86)\\Windows Kits\\10\\bin'
  const versions = fs.existsSync(base)
    ? fs.readdirSync(base).filter((d) => /^10\./.test(d) && fs.existsSync(path.join(base, d, 'x64', name)))
    : []
  versions.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  const newest = versions.at(-1)
  if (!newest) throw new Error(`${name} nicht gefunden. Es gehört zum Windows SDK (${base}).`)
  return path.join(base, newest, 'x64', name)
}

function main() {
  if (process.platform !== 'win32') {
    console.error('Das MSIX-Paket lässt sich nur unter Windows bauen (makeappx aus dem Windows SDK).')
    process.exit(1)
  }
  const args = process.argv.slice(2)
  const opt = (name, fallback) => {
    const i = args.indexOf(`--${name}`)
    return i >= 0 ? path.resolve(args[i + 1]) : fallback
  }
  const inDir = opt('in', path.join(root, 'dist-desktop'))
  const outDir = opt('out', path.join(root, 'dist-bin', 'msix'))
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'server', 'package.json'), 'utf8'))
  const version = msixVersion(pkg.version)
  const template = fs.readFileSync(path.join(root, 'packaging', 'msix', 'AppxManifest.xml'), 'utf8')
  const makeappx = findSdkTool('makeappx.exe')

  fs.rmSync(outDir, { recursive: true, force: true })
  const packagesDir = path.join(outDir, 'pakete')
  fs.mkdirSync(packagesDir, { recursive: true })

  for (const { arch, dir } of ARCHITECTURES) {
    const source = path.join(inDir, dir)
    checkWindowFolder(source, arch)
    const stage = path.join(outDir, `inhalt-${arch}`)
    fs.cpSync(source, stage, { recursive: true })
    fs.cpSync(path.join(root, 'packaging', 'msix', 'Assets'), path.join(stage, 'Assets'), { recursive: true })
    fs.writeFileSync(path.join(stage, 'AppxManifest.xml'), fillManifest(template, { version, arch }))
    console.log(`→ makeappx pack: ${arch} (${version})`)
    execFileSync(makeappx, ['pack', '/d', stage, '/p', path.join(packagesDir, `Mietfuchs_${version}_${arch}.msix`), '/o'], { stdio: 'inherit' })
  }

  const bundle = path.join(outDir, `Mietfuchs_${version}.msixbundle`)
  console.log('→ makeappx bundle')
  execFileSync(makeappx, ['bundle', '/d', packagesDir, '/p', bundle, '/bv', version, '/o'], { stdio: 'inherit' })

  console.log(`✓ ${bundle}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()

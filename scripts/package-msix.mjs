// Baut aus den Store-Programmdateien (dist-bin/store, siehe package-binaries.mjs) das Paket für
// den Microsoft Store (#500): je Architektur ein .msix, zusammen ein .msixbundle, das
// `msstore publish` und das Partner Center so annehmen. Signiert wird nicht: Das übernimmt der
// Store bei der Zertifizierung. Läuft nur unter Windows, weil makeappx zum Windows SDK gehört.
//
// Nutzung:
//   node scripts/package-msix.mjs                 # liest dist-bin/store, schreibt dist-bin/msix
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

// Je Architektur die Programmdatei aus dist-bin/store. Im Paket heißt sie schlicht mietfuchs.exe.
export const ARCHITECTURES = [
  { arch: 'x64', exe: 'mietfuchs-store-x64.exe' },
  { arch: 'arm64', exe: 'mietfuchs-store-arm64.exe' },
]
export const PACKAGE_EXE = 'mietfuchs.exe'

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
  const inDir = opt('in', path.join(root, 'dist-bin', 'store'))
  const outDir = opt('out', path.join(root, 'dist-bin', 'msix'))
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'server', 'package.json'), 'utf8'))
  const version = msixVersion(pkg.version)
  const template = fs.readFileSync(path.join(root, 'packaging', 'msix', 'AppxManifest.xml'), 'utf8')
  const makeappx = findSdkTool('makeappx.exe')

  fs.rmSync(outDir, { recursive: true, force: true })
  const packagesDir = path.join(outDir, 'pakete')
  fs.mkdirSync(packagesDir, { recursive: true })

  for (const { arch, exe } of ARCHITECTURES) {
    const stage = path.join(outDir, `inhalt-${arch}`)
    fs.mkdirSync(stage, { recursive: true })
    fs.copyFileSync(path.join(inDir, exe), path.join(stage, PACKAGE_EXE))
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

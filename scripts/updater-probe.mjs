// Bereitet den zweiten Bau für die echte Update-Probe vor (#517, Job „Automatisches Update prüfen“ in release.yml):
// eine höhere Version und ein Migrationsschritt mehr. Läuft nur in der CI auf einem eigenen Checkout, nie im Repo
// eines Entwicklers; das Ergebnis wird nie veröffentlicht.
//
//   node scripts/updater-probe.mjs [--root <Ordner>]
//
// - **Version**: die nächste Patch-Version der jetzigen (0.14.1 wird 0.14.2, 0.15.0-rc.1 wird 0.15.1), in allen vier
//   package.json wie set-version.mjs. Das Fenster vergleicht sie mit seiner eigenen (electron-updater, SemVer).
// - **Migrationsschritt**: ein Schritt ohne Wirkung (`SELECT 1;`) am Ende der Kette. Nur dann legt der Server beim
//   ersten Start der neuen Version die Sicherung `mietfuchs.sqlite.vor-<Schritt>` an (backupBeforeMigrating in
//   server/src/db/open.ts), und genau die prüft die Probe.
//
// Gibt Version und Schritt als `version=…` und `schritt=…` aus (für GITHUB_OUTPUT).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseVersion } from '../server/src/update.ts'

const FOLDERS = ['.', 'server', 'client', 'desktop']

/** @param {string} version @returns {string} */
export function nextPatch(version) {
  const v = parseVersion(version)
  if (!v) throw new Error(`„${version}“ ist keine Version.`)
  return `${v.core[0]}.${v.core[1]}.${v.core[2] + 1}`
}

/**
 * Der nächste Schritt nach dem letzten im Journal, ohne Wirkung.
 * @param {{ entries: { idx: number, when: number, tag: string }[] }} journal
 * @returns {{ tag: string, entry: Record<string, unknown>, sql: string }}
 */
export function probeStep(journal) {
  const last = journal.entries.at(-1)
  if (!last) throw new Error('Das Journal der Migrationen ist leer.')
  const idx = last.idx + 1
  const tag = `${String(idx).padStart(4, '0')}_update_probe`
  return { tag, entry: { idx, version: '6', when: last.when + 1000, tag, breakpoints: true }, sql: 'SELECT 1;\n' }
}

// Für updater-check.mjs: die abgerufene Datei ohne Abfrageteil; electron-updater hängt an die Kanaldatei
// `?noCache=…` (GenericProvider.getLatestVersion, Durchsicht M1)
/** @param {string} url @returns {string} */
export function requestedFile(url) {
  return decodeURIComponent(new URL(url, 'http://127.0.0.1').pathname).replace(/^\/+/, '')
}

/**
 * Für updater-check.mjs: Ist diese Version installiert? electron-builder schreibt `version` als FileVersion, die
 * ProductVersion vierstellig ohne Vorabversion (0.15.0-rc.1 wird 0.15.0.0, Durchsicht S2). Deshalb zählt die
 * FileVersion; nur ohne sie die ProductVersion, und die nur, wenn die gesuchte Version keine Vorabversion ist.
 * @param {{ file: string, product: string }} installed aus `(Get-Item …).VersionInfo`
 * @param {string} wanted
 */
export function installedMatches({ file, product }, wanted) {
  const same = (/** @type {string} */ v) => v === wanted || v === `${wanted}.0`
  if (file) return same(file)
  return !wanted.includes('-') && same(product)
}

async function main() {
  const args = process.argv.slice(2)
  const i = args.indexOf('--root')
  const root = i >= 0 ? path.resolve(args[i + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  /** @type {any} */
  const first = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const version = nextPatch(first.version)
  for (const dir of FOLDERS) {
    const file = path.join(root, dir, 'package.json')
    /** @type {any} */
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
    pkg.version = version
    fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`)
  }
  const drizzle = path.join(root, 'server', 'drizzle')
  const journalFile = path.join(drizzle, 'meta', '_journal.json')
  /** @type {any} */
  const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8'))
  const step = probeStep(journal)
  fs.writeFileSync(path.join(drizzle, `${step.tag}.sql`), step.sql)
  journal.entries.push(step.entry)
  fs.writeFileSync(journalFile, `${JSON.stringify(journal, null, 2)}\n`)
  console.log(`version=${version}`)
  console.log(`schritt=${step.tag}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()

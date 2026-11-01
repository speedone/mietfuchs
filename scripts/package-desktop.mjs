// Baut das Programmfenster (#517) mit electron-builder: unter Windows einen Installer für x64 und ARM64 zusammen
// (NSIS, für den Benutzer, ohne Adminrechte), auf dem Mac je ein Abbild (.dmg) für Apple Silicon und Intel, ad hoc
// signiert. Der Server läuft im Fenster mit Electrons eigenem Node (utilityProcess, siehe desktop/src/main.js); eine
// Programmdatei des Servers gibt es darin nicht. Dieses Skript legt ihn dafür in dist-desktop-server/ ab, als drei
// Dateien in der Anordnung des Repos:
//   server/server.mjs                  Server, shared/, Abhängigkeiten und Migrationen, gebündelt mit rolldown (dem
//                                      Bündler von Vite, aus client/node_modules)
//   server/THIRD-PARTY-LICENSES.txt    die Lizenzen der gebündelten Abhängigkeiten
//   client/dist.pack                   das gebaute Frontend als eine Datei (server/src/clientPack.ts)
// electron-builder nimmt den Ordner als resources/mietfuchs mit (desktop/package.json, `extraResources`). Er ist für
// alle Architekturen derselbe, denn der Server hat keine nativen Module. Warum gebündelt: Aus den Quellen lud der
// Server rund 470 Dateien und streifte ihre Typen ab, das kostete beim Start ein bis drei Sekunden; und unter Windows
// prüft der Echtzeitschutz beim Installieren jede Datei einzeln, vorher waren es Tausende (Quellen und node_modules).
//
//   node scripts/package-desktop.mjs win     (unter Windows)
//   node scripts/package-desktop.mjs mac     (unter macOS)
//   node scripts/package-desktop.mjs server  (nur den Server-Ordner, auf jedem System)
//
// Vorher: `npm run build` (oder `npm --prefix client ci && npm --prefix client run build`) für client/dist und den
// Bündler, die Abhängigkeiten des Servers (`npm --prefix server ci --omit=dev` genügt) und `npm --prefix desktop ci`. Ergebnis in dist-desktop/: Mietfuchs-Setup-<Version>.exe, daneben je Architektur der
// entpackte Ordner (win-unpacked, win-arm64-unpacked), aus dem package-msix.mjs das Store-Paket baut; auf dem Mac
// Mietfuchs-<Version>-apple-silicon.dmg und -intel.dmg.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire, isBuiltin } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { writeClientPack } from '../server/src/clientPack.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Wohin der Server-Ordner kommt; `extraResources` in desktop/package.json liest ihn von dort
const stage = path.join(root, 'dist-desktop-server')

// Das Bündel, relativ zum Server-Ordner; desktop/src/server.js (`serverModule`) startet es
export const SERVER_BUNDLE = 'server/server.mjs'
// Die Lizenzen der gebündelten Abhängigkeiten. Bis zum Bündelschritt lagen sie in node_modules bei.
export const SERVER_LICENSES = 'server/THIRD-PARTY-LICENSES.txt'

// Das Frontend als eine Datei, relativ zum Server-Ordner (server/src/index.ts liest es dort im Bündel)
export const CLIENT_PACK = 'client/dist.pack'

// Woran sich ein vollständiger Server-Ordner erkennen lässt, auch im entpackten Ordner des Fensters (package-msix.mjs)
export const REQUIRED_SERVER_FILES = [SERVER_BUNDLE, SERVER_LICENSES, CLIENT_PACK]

/** @param {string} dir der Server-Ordner (dist-desktop-server bzw. resources/mietfuchs) */
export function checkServerFolder(dir) {
  for (const file of REQUIRED_SERVER_FILES) {
    if (!fs.existsSync(path.join(dir, file))) throw new Error(`${path.join(dir, file)} fehlt im Server-Ordner des Fensters`)
  }
  // Mehr nicht: Jede weitere Datei prüft der Echtzeitschutz unter Windows beim Installieren einzeln
  const extra = listFiles(dir).filter((file) => !REQUIRED_SERVER_FILES.includes(file))
  if (extra.length) throw new Error(`Im Server-Ordner des Fensters liegt mehr als vorgesehen: ${extra.slice(0, 5).join(', ')}${extra.length > 5 ? ' …' : ''}`)
}

/**
 * `import.meta.url` im Bündel ist die Adresse der einen Datei. Der Server rechnet von dort zu client/dist,
 * server/drizzle und server/data, je Modul aus einer anderen Tiefe (index.ts aus server/src, db/client.ts aus
 * server/src/db). Deshalb bekommt jedes Modul die Adresse, die es im Repo hätte, ausgedrückt relativ zum Bündel; der
 * Server-Ordner hat die Anordnung des Repos, so stimmen die Wege wie bei `npm start`. Gibt `null` zurück, wenn nichts
 * zu ändern ist. Bricht ab bei allem anderen an `import.meta` und bei Abhängigkeiten, die es nutzen: Dafür gibt es
 * keine Regel, und still falsch gerechnete Pfade fielen erst beim Nutzer auf.
 * @param {string} code
 * @param {string} id der Pfad des Moduls
 * @param {{ root: string, bundleFile: string }} where Wurzel des Repos und das Bündel im Server-Ordner
 * @returns {string | null}
 */
export function rewriteImportMeta(code, id, { root, bundleFile }) {
  // Hilfsmodule des Bündlers (\0…) stammen nicht aus dem Repo; ihr import.meta.url ist das des Bündels
  if (id.startsWith('\0') || !code.includes('import.meta')) return null
  const rel = path.relative(root, id)
  if (rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep).includes('node_modules')) {
    throw new Error(`${id} nutzt import.meta; im Bündel des Fensters zeigte es auf das Bündel statt auf das Modul`)
  }
  const other = code.replaceAll('import.meta.url', '').match(/import\.meta\.\w+/)
  if (other) throw new Error(`${id} nutzt ${other[0]}; im Bündel des Fensters ist dafür nichts vorgesehen`)
  const stageRoot = path.resolve(path.dirname(bundleFile), path.relative(path.dirname(SERVER_BUNDLE), '.'))
  const target = path.relative(path.dirname(bundleFile), path.join(stageRoot, rel)).split(path.sep).join('/')
  return code.replaceAll('import.meta.url', `new URL(${JSON.stringify(`./${target}`)}, import.meta.url).href`)
}

// Was das Bündel von außen laden darf: Node selbst, Bun (nur in der Programmdatei, dort hinter `globalThis.Bun`) und
// das eingebettete Frontend der Programmdatei (ebenso hinter `globalThis.Bun`, im Fenster nie geladen). Die
// Migrationen dagegen kommen ins Bündel (`migrationsModule`).
const EXTERNAL = [/^node:/, /^bun:/, /(^|[\\/])embedded-client\.js$/]
// Die Zeile in server/src/bundle.ts, die das Bündel auf true stellt
const BUNDLE_FLAG = 'export const IN_BUNDLE: boolean = false'
const MIGRATIONS_ID = '\0mietfuchs-migrations'

// Das Modul, das server/src/db/client.ts im Bündel statt embedded-migrations.js lädt: genau das, was es unter Node
// von der Platte läse. Erst beim Bündeln geladen: client.ts zieht drizzle-orm nach, und package-msix.mjs, das
// `checkServerFolder` von hier nimmt, läuft ohne die Abhängigkeiten des Servers.
async function migrationsModule() {
  const { migrationsFromDisk } = await import('../server/src/db/client.ts')
  return `export const migrations = ${JSON.stringify(migrationsFromDisk())}\n`
}
/** @param {string} id */
const allowedExternal = (id) => isBuiltin(id) || EXTERNAL.some((rule) => rule.test(id))

/**
 * Den Server zu einer Datei bündeln (ESM, Ziel Node 24.22, wie Electron 45 es mitbringt), mit den Lizenzen der
 * gebündelten Abhängigkeiten daneben. rolldown kommt aus client/node_modules, über Vite: kein eigenes Werkzeug.
 * @param {string} stageDir der Server-Ordner
 * @returns {Promise<{ file: string, licenses: string, modules: number }>}
 */
export async function bundleServer(stageDir) {
  const viteRequire = createRequire(createRequire(path.join(root, 'client', 'package.json')).resolve('vite/package.json'))
  const { rolldown } = /** @type {any} */ (await import(pathToFileURL(viteRequire.resolve('rolldown')).href))
  const file = path.join(stageDir, SERVER_BUNDLE)
  /** @type {string[]} */
  const problems = []
  // Ob server/src/bundle.ts umgestellt wurde. Ohne das suchte das Bündel im Fenster Migrationen und Frontend auf der
  // Platte, fände nichts, und der Server startete nicht (Durchsicht): lieber hier abbrechen.
  let flagged = false
  const bundle = await rolldown({
    input: path.join(root, 'server', 'src', 'index.ts'),
    platform: 'node',
    transform: { target: 'node24.22' },
    external: (/** @type {string} */ id) => allowedExternal(id),
    plugins: [{
      name: 'mietfuchs-fenster',
      /** @param {string} source */
      resolveId(source) {
        return /(^|[\\/])embedded-migrations\.js$/.test(source) ? MIGRATIONS_ID : null
      },
      /** @param {string} id */
      async load(id) {
        return id === MIGRATIONS_ID ? await migrationsModule() : null
      },
      /** @param {string} code @param {string} id */
      transform(code, id) {
        if (path.resolve(id) === path.join(root, 'server', 'src', 'bundle.ts')) {
          if (code.split(BUNDLE_FLAG).length !== 2) throw new Error(`server/src/bundle.ts: „${BUNDLE_FLAG}“ nicht genau einmal gefunden`)
          flagged = true
          return { code: code.replace(BUNDLE_FLAG, 'export const IN_BUNDLE: boolean = true') }
        }
        const changed = rewriteImportMeta(code, id, { root, bundleFile: file })
        return changed === null ? null : { code: changed }
      },
    }],
    // Ein Import, den rolldown nicht auflöst, bliebe sonst als Verweis nach außen stehen und scheiterte erst im Fenster
    onLog: (/** @type {string} */ level, /** @type {any} */ log, /** @type {(level: string, log: any) => void} */ fallback) => {
      if (level === 'warn' && (log.code === 'UNRESOLVED_IMPORT' || log.code === 'MISSING_EXPORT')) problems.push(log.message)
      else fallback(level, log)
    },
  })
  const { output } = await bundle.write({ file, format: 'esm', codeSplitting: false })
  await bundle.close()
  if (problems.length) throw new Error(`Das Bündel des Servers ist unvollständig:\n${problems.join('\n')}`)
  if (!flagged) throw new Error('server/src/bundle.ts kam nicht ins Bündel oder wurde nicht erkannt; IN_BUNDLE bliebe false')
  const chunks = output.filter((/** @type {any} */ item) => item.type === 'chunk')
  if (chunks.length !== 1) throw new Error(`Das Bündel des Servers sollte eine Datei sein, es sind ${chunks.length}`)
  const [chunk] = chunks
  // Ein eingebetteter dynamischer Import (die Migrationen) nennt das Bündel selbst
  const outside = [...chunk.imports, ...chunk.dynamicImports].filter((/** @type {string} */ id) => id !== chunk.fileName && !allowedExternal(id))
  if (outside.length) throw new Error(`Das Bündel des Servers lädt von außen: ${outside.join(', ')}`)
  const licenses = path.join(stageDir, SERVER_LICENSES)
  fs.writeFileSync(licenses, licenseText(Object.keys(chunk.modules)))
  return { file, licenses, modules: Object.keys(chunk.modules).length }
}

/**
 * Die Lizenzen der Pakete, aus denen Module im Bündel stammen: je Paket Name, Version, Lizenz und der Text seiner
 * Lizenzdatei (MIT und Verwandte verlangen, dass der Hinweis mitgeht).
 * @param {string[]} moduleIds
 */
function licenseText(moduleIds) {
  /** @type {Set<string>} */
  const dirs = new Set()
  for (const id of moduleIds) {
    const match = id.replaceAll('\\', '/').match(/^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)\//)
    if (match?.[1]) dirs.add(match[1])
  }
  // Je Name und Version einmal, auch wenn npm dasselbe Paket an mehreren Stellen ablegt
  /** @type {Map<string, string>} */
  const parts = new Map()
  for (const dir of dirs) {
    const pkg = /** @type {any} */ (JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')))
    const key = `${pkg.name}@${pkg.version}`
    if (parts.has(key)) continue
    // Ältere Pakete nennen die Lizenz noch als Liste (`licenses: [{ type: 'MIT' }]`)
    const license = pkg.license ?? (Array.isArray(pkg.licenses) ? pkg.licenses.map((/** @type {any} */ l) => l.type).join(' OR ') : 'ohne Angabe')
    const licenseFile = fs.readdirSync(dir).find((name) => /^(licen[cs]e|copying|notice)/i.test(name))
    const text = licenseFile ? fs.readFileSync(path.join(dir, licenseFile), 'utf8').trim() : '(keine Lizenzdatei im Paket)'
    parts.set(key, `${key} (${license})\n\n${text}\n`)
  }
  const sep = `\n${'-'.repeat(80)}\n\n`
  const sorted = [...parts.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, text]) => text)
  return `Lizenzen der Abhängigkeiten, die im Server des Programmfensters (server.mjs) gebündelt sind\n${sep}${sorted.join(sep)}`
}

/** @param {string} dir @param {string} [rel] @returns {string[]} */
function listFiles(dir, rel = '') {
  /** @type {string[]} */
  const files = []
  for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const child = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) files.push(...listFiles(dir, child))
    else if (entry.isFile()) files.push(child)
  }
  return files
}

/**
 * Das gebaute Frontend als eine Datei in den Server-Ordner
 * @param {string} clientDist der Ordner mit dem Build (client/dist)
 * @param {string} stageDir
 * @returns {number} wie viele Dateien darin
 */
export function packClient(clientDist, stageDir) {
  return writeClientPack(clientDist, path.join(stageDir, CLIENT_PACK))
}

// Den Server-Ordner neu anlegen: das Bündel, seine Lizenzen und das Frontend
async function prepareServer() {
  if (!fs.existsSync(path.join(root, 'client', 'dist', 'index.html'))) {
    console.error('client/dist fehlt. Zuerst das Frontend bauen: npm run build')
    process.exit(1)
  }
  if (!fs.existsSync(path.join(root, 'server', 'node_modules', 'express', 'package.json'))) {
    console.error('Die Abhängigkeiten des Servers fehlen. Zuerst: npm --prefix server ci --omit=dev')
    process.exit(1)
  }
  fs.rmSync(stage, { recursive: true, force: true })
  const started = Date.now()
  const { file, modules } = await bundleServer(stage)
  const count = packClient(path.join(root, 'client', 'dist'), stage)
  console.log(`→ Server gebündelt: ${modules} Module in ${path.relative(root, file)} (${(fs.statSync(file).size / 1e6).toFixed(1)} MB, ${Date.now() - started} ms), Frontend: ${count} Dateien in ${CLIENT_PACK}`)
  checkServerFolder(stage)
}

// electron-builder benennt die Architektur nur arm64 oder x64. Nutzer kennen ihren Mac als Apple Silicon oder Intel,
// so heißen auch die Programmdateien am Release; die .dmg ziehen nach (samt Blockmap).
const MAC_NAMES = { arm64: 'apple-silicon', x64: 'intel' }
/** @param {string} file */
export function userFileName(file) {
  return file.replace(/-(arm64|x64)(\.dmg(?:\.blockmap)?)$/, (_all, arch, ext) => `-${MAC_NAMES[/** @type {'arm64' | 'x64'} */ (arch)]}${ext}`)
}

async function main() {
  const target = process.argv[2]
  if (target !== 'win' && target !== 'mac' && target !== 'server') {
    console.error('Aufruf: node scripts/package-desktop.mjs win|mac|server')
    process.exit(1)
  }

  await prepareServer()
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()

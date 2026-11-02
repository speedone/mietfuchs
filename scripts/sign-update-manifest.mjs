// Signiert die Update-Beschreibung latest.yml des Programmfensters (#551) mit Ed25519, im Format von electron-builder 27
// (desktop/src/updateManifest.js). Das Fenster lädt eine neue Version nur mit gültiger Signatur.
//
// Aufruf (release.yml, Job „Ans Release anhängen“, bevor latest.yml ans Release geht):
//   MIETFUCHS_UPDATE_SIGNING_KEY=<PEM> node scripts/sign-update-manifest.mjs --dir dist-desktop
// Für die Update-Probe (Job „Automatisches Update prüfen“) mit einem Wegwerf-Schlüssel; der öffentliche Teil steht danach
// als `testkey=…` auf der Ausgabe, für MIETFUCHS_UPDATE_TESTKEY:
//   node scripts/sign-update-manifest.mjs --dir <Ordner> --ephemeral
//
// Signiert wird nur, was wirklich gebaut wurde: Name, Größe und SHA-512 jeder Datei aus latest.yml werden an der Datei im
// Ordner nachgerechnet. Und nur mit einem Schlüssel, dem das Fenster glaubt (UPDATE_MANIFEST_PUBLIC_KEYS): Ein falsch
// eingetragenes Secret fiele sonst erst auf, wenn kein Nutzer mehr ein Update bekommt. Gelesen wird latest.yml mit dem
// js-yaml aus desktop/, derselben Fassung, mit der electron-updater sie im Fenster liest; die Signatur wird angehängt,
// der bisherige Inhalt bleibt Zeichen für Zeichen stehen.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { UPDATE_MANIFEST_PUBLIC_KEYS, signManifest, verifyManifestSignatures } from '../desktop/src/updateManifest.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function loadYaml() {
  try {
    return createRequire(path.join(root, 'desktop', 'package.json'))('js-yaml')
  } catch {
    throw new Error('js-yaml aus desktop/ fehlt. Nachholen mit: npm --prefix desktop ci --omit=dev --ignore-scripts')
  }
}

/** @param {string} file */
function sha512Of(file) {
  return crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64')
}

/**
 * @param {{ dir: string, privateKey: crypto.KeyObject, trusted?: readonly string[] }} input
 * @returns {{ version: string, keyId: string }}
 */
export function signManifestFile({ dir, privateKey, trusted = UPDATE_MANIFEST_PUBLIC_KEYS }) {
  const yaml = loadYaml()
  const file = path.join(dir, 'latest.yml')
  const text = fs.readFileSync(file, 'utf8')
  /** @type {any} */
  const info = yaml.load(text)
  if (info === null || typeof info !== 'object') throw new Error(`${file} ist keine Update-Beschreibung.`)
  if (info.signatures != null || info.signature != null) throw new Error(`${file} ist schon signiert.`)
  if (!Array.isArray(info.files) || info.files.length === 0) throw new Error(`${file} nennt keine Dateien.`)
  for (const entry of info.files) {
    const name = String(entry?.url ?? '')
    // Nur ein Dateiname neben latest.yml, wie electron-builder ihn schreibt
    if (!name || name !== path.basename(name)) throw new Error(`${file}: unerwarteter Dateiname „${name}“.`)
    const built = path.join(dir, name)
    if (!fs.existsSync(built)) throw new Error(`${file} nennt ${name}, die Datei fehlt.`)
    if (entry.sha512 !== sha512Of(built) || entry.size !== fs.statSync(built).size) {
      throw new Error(`${file} passt nicht zu ${name}: Prüfsumme oder Größe weichen ab.`)
    }
  }
  const entry = signManifest(info, privateKey)
  // Vor dem Schreiben gegen die Schlüssel geprüft, denen das Fenster glaubt
  const check = verifyManifestSignatures({ ...info, signatures: [entry] }, trusted)
  if (!check.ok) throw new Error(`Der Schlüssel (Kennung ${entry.keyId}) gehört zu keinem Schlüssel im Programm (desktop/src/updateManifest.js).`)
  const block = yaml.dump({ signatures: [entry] }, { lineWidth: -1 })
  fs.writeFileSync(file, `${text.endsWith('\n') ? text : `${text}\n`}${block}`)
  // Und nach dem Schreiben noch einmal so, wie das Fenster die Datei liest
  const written = yaml.load(fs.readFileSync(file, 'utf8'))
  if (!verifyManifestSignatures(written, trusted).ok) throw new Error(`${file}: Die geschriebene Signatur ließ sich nicht bestätigen.`)
  return { version: String(info.version), keyId: entry.keyId }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const at = args.indexOf('--dir')
  const dir = at >= 0 ? args[at + 1] : undefined
  if (!dir) {
    console.error('Aufruf: node scripts/sign-update-manifest.mjs --dir <Ordner mit latest.yml> [--ephemeral]')
    process.exit(2)
  }
  try {
    if (args.includes('--ephemeral')) {
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
      const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
      const { version } = signManifestFile({ dir, privateKey, trusted: [pub] })
      console.error(`latest.yml für ${version} mit einem Wegwerf-Schlüssel signiert (nur für die Update-Probe).`)
      console.log(`testkey=${pub}`)
    } else {
      const pem = process.env.MIETFUCHS_UPDATE_SIGNING_KEY
      if (!pem) throw new Error('MIETFUCHS_UPDATE_SIGNING_KEY fehlt (Secret in GitHub). Ohne Signatur nimmt kein Programmfenster das Update an.')
      const { version, keyId } = signManifestFile({ dir, privateKey: crypto.createPrivateKey(pem) })
      console.log(`latest.yml für ${version} signiert, Schlüssel ${keyId}.`)
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}

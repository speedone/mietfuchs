// Schreibt die Version aus dem Git-Tag in die package.json-Dateien, bevor ein Release gebaut
// wird (#166). Aufgerufen von release.yml und docker.yml, und zwar nur bei einem Tag-Lauf.
//
// Nutzung:
//   node scripts/set-version.mjs v0.9.0-rc.2   # oder ohne Angabe: GITHUB_REF_NAME
//   node scripts/set-version.mjs v0.9.0-rc.2 --root <Ordner>   # für Tests
//
// Warum es das gibt: Die Programmdatei meldet die Version aus server/package.json
// (server/src/version.ts), und dort steht auf dem Release-Zweig schon die fertige Nummer. Ein
// Release-Kandidat meldete sich deshalb als 0.9.0, und erschien später die echte 0.9.0, bekam
// sein Nutzer keinen Update-Hinweis. Die Nummer des Kandidaten steht nur im Tag, denn derselbe
// Commit kann nacheinander rc.1, rc.2 und die fertige Version werden.
//
// Deshalb darf der Tag genau eines ändern, nämlich das Vorab-Suffix. Weicht die Basis ab (Tag
// v0.9.1 bei package.json 0.9.0), bricht das Skript ab, statt still eine andere Version zu
// bauen: Dann ist der falsche Commit getaggt oder das Anheben der Version vergessen, und im
// Commit stünden CHANGELOG, package-lock.json und package.json auf einer anderen Nummer als
// die ausgelieferte Datei. Das zu reparieren gehört in einen Commit, nicht in den Bau.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// Dieselbe Regel wie der Update-Hinweis, und zwar dieselbe Funktion statt einer Abschrift: Eine
// Version, die das Skript annähme und update.ts nicht läse (etwa rc.01), meldete sich in der
// Programmdatei als unvergleichbar, und ihr Nutzer bekäme nie wieder einen Hinweis. Node führt
// die .ts-Datei unmittelbar aus; sie importiert nur Typen.
import { parseVersion } from '../server/src/update.ts'

const FOLDERS = ['.', 'server', 'client']

/** @returns {never} */
function fail(message) {
  console.error(`Version aus dem Tag: ${message}`)
  process.exit(1)
}

const args = process.argv.slice(2)
const rootIndex = args.indexOf('--root')
const root = rootIndex >= 0
  ? path.resolve(args.splice(rootIndex, 2)[1] ?? fail('--root ohne Ordner'))
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tag = args[0] ?? process.env.GITHUB_REF_NAME
if (!tag) fail('kein Tag angegeben und GITHUB_REF_NAME ist leer.')

const wanted = parseVersion(tag)
if (!wanted || tag.trim() !== tag) fail(`„${tag}“ ist keine Version wie v0.9.0 oder v0.9.0-rc.2.`)
const version = tag.replace(/^v/, '')

const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const manifests = FOLDERS.map((dir) => path.join(root, dir, 'package.json'))
const current = manifests.map((file) => read(file).version)
if (new Set(current).size !== 1) {
  fail(`die package.json-Dateien tragen verschiedene Versionen (${FOLDERS.map((d, i) => `${d}: ${current[i]}`).join(', ')}).`)
}
const base = parseVersion(current[0])?.core.join('.')
if (base !== wanted.core.join('.')) {
  fail(`der Tag ${tag} passt nicht zu package.json ${current[0]}. Abweichen darf nur das Vorab-Suffix; ` +
    'erst die Version im Repo anheben und dann taggen.')
}

// Die Dateien behalten ihre Gestalt (zwei Leerzeichen, Zeilenende am Schluss), wie npm sie
// schreibt. Die package-lock.json führt die eigene Version an zwei Stellen, dort zieht das
// Skript sie mit, wie es `npm version` täte.
const write = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n')
for (const dir of FOLDERS) {
  const manifest = path.join(root, dir, 'package.json')
  write(manifest, { ...read(manifest), version })
  const lock = path.join(root, dir, 'package-lock.json')
  if (fs.existsSync(lock)) {
    const data = read(lock)
    data.version = version
    if (data.packages?.['']) data.packages[''].version = version
    write(lock, data)
  }
}
console.log(`Version ${version} eingetragen (package.json war ${current[0]}).`)

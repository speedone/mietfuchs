// scripts/set-version.mjs (#166): Beim Bau aus einem Tag kommt die Version aus dem Tag in die
// package.json-Dateien, damit ein Release-Kandidat sich als solcher meldet. Geprüft wird das
// Skript als eigener Prozess auf einem Wegwerf-Ordner, so wie die Workflows es aufrufen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'set-version.mjs')
const FOLDERS = ['.', 'server', 'client']

type Manifest = { name: string, version: string, private?: boolean }
type Lock = { name: string, version: string, lockfileVersion: number, packages: Record<string, { version?: string }> }

// Ein Repo im Kleinen: drei package.json und drei package-lock.json mit derselben Version
function fakeRepo(versions: [string, string, string] = ['0.9.0', '0.9.0', '0.9.0']): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-version-'))
  FOLDERS.forEach((dir, i) => {
    fs.mkdirSync(path.join(root, dir), { recursive: true })
    const manifest: Manifest = { name: `mietfuchs-${i}`, version: versions[i], private: true }
    fs.writeFileSync(path.join(root, dir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
    const lock: Lock = { name: manifest.name, version: versions[i], lockfileVersion: 3, packages: { '': { version: versions[i] }, 'node_modules/x': { version: '1.0.0' } } }
    fs.writeFileSync(path.join(root, dir, 'package-lock.json'), JSON.stringify(lock, null, 2) + '\n')
  })
  return root
}

const run = (root: string, ...args: string[]) =>
  spawnSync(process.execPath, [script, ...args, '--root', root], { encoding: 'utf8', env: { ...process.env, GITHUB_REF_NAME: '' } })

const read = <T>(root: string, dir: string, file: string): T => JSON.parse(fs.readFileSync(path.join(root, dir, file), 'utf8'))

test('set-version: ein Release-Kandidat trägt seine Nummer in alle drei Pakete ein', () => {
  const root = fakeRepo()
  const result = run(root, 'v0.9.0-rc.2')
  assert.equal(result.status, 0, result.stderr)
  for (const dir of FOLDERS) {
    const manifest = read<Manifest>(root, dir, 'package.json')
    assert.equal(manifest.version, '0.9.0-rc.2', dir)
    assert.equal(manifest.private, true, 'die übrigen Felder bleiben')
    const lock = read<Lock>(root, dir, 'package-lock.json')
    assert.equal(lock.version, '0.9.0-rc.2')
    assert.equal(lock.packages[''].version, '0.9.0-rc.2')
    assert.equal(lock.packages['node_modules/x'].version, '1.0.0', 'Abhängigkeiten bleiben unberührt')
  }
  // Die Gestalt bleibt, wie npm sie schreibt: zwei Leerzeichen, Zeilenende am Schluss
  assert.match(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), /^\{\n {2}"name"[\s\S]*\}\n$/)
})

test('set-version: der Tag der fertigen Version lässt sie, wie sie ist', () => {
  const root = fakeRepo()
  assert.equal(run(root, 'v0.9.0').status, 0)
  assert.equal(read<Manifest>(root, 'server', 'package.json').version, '0.9.0')
})

test('set-version: ohne Angabe gilt GITHUB_REF_NAME, wie im Workflow', () => {
  const root = fakeRepo()
  const result = spawnSync(process.execPath, [script, '--root', root], { encoding: 'utf8', env: { ...process.env, GITHUB_REF_NAME: 'v0.9.0-rc.3' } })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(read<Manifest>(root, 'server', 'package.json').version, '0.9.0-rc.3')
})

test('set-version: eine andere Basis im Tag bricht ab und ändert nichts', () => {
  for (const tag of ['v0.9.1', 'v0.9.1-rc.1', 'v1.0.0']) {
    const root = fakeRepo()
    const result = run(root, tag)
    assert.notEqual(result.status, 0, `${tag} hätte scheitern müssen`)
    assert.match(result.stderr, /passt nicht zu package\.json 0\.9\.0/)
    assert.equal(read<Manifest>(root, 'server', 'package.json').version, '0.9.0')
  }
})

test('set-version: verschieden versionierte Pakete brechen ab', () => {
  const root = fakeRepo(['0.9.0', '0.8.0', '0.9.0'])
  const result = run(root, 'v0.9.0-rc.2')
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /verschiedene Versionen/)
  assert.equal(read<Manifest>(root, '.', 'package.json').version, '0.9.0')
})

test('set-version: was keine Version ist, bricht ab', () => {
  for (const tag of ['main', 'v0.9', 'v0.9.0-', 'v0.9.0-rc..1']) {
    const root = fakeRepo()
    assert.notEqual(run(root, tag).status, 0, tag)
    assert.equal(read<Manifest>(root, 'server', 'package.json').version, '0.9.0')
  }
  const root = fakeRepo()
  const result = run(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /kein Tag/)
})

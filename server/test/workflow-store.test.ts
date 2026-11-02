import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Einreichung im Microsoft Store (#500). Geprüft wird der Quelltext der Workflows, denn ausführen
// lassen sie sich hier nicht.
const workflows = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.github/workflows')
const read = (name: string) => fs.readFileSync(path.join(workflows, name), 'utf8')

// Die Einreichung scheiterte bei v0.14.0 an der Store-CLI: Sie legt unter Linux die Zugangsdaten im
// Schlüsselbund ab, den ein Runner nicht hat. Eingereicht wird deshalb mit dem eigenen Skript.
test('Store: eingereicht wird mit scripts/store-submit.mjs, nicht mit der Store-CLI', () => {
  const yml = read('store.yml')
  assert.match(yml, /node scripts\/store-submit\.mjs --bundle /)
  assert.doesNotMatch(yml, /setup-msstore-cli|msstore /)
})

// checkout räumt den Arbeitsordner auf; käme es nach dem Download, wäre das Paket weg
test('Store: erst auschecken, dann das Paket laden', () => {
  const yml = read('store.yml')
  const checkout = yml.indexOf('uses: actions/checkout@')
  const download = yml.indexOf('uses: actions/download-artifact@')
  assert.ok(checkout > 0 && download > 0 && checkout < download)
})

// Durchsicht (M1): Beim Start von Hand gibt es das Artefakt auch in einem Tag-Lauf, dessen Prüfungen
// rot waren und der nichts ans Release hängte. Eingereicht wird nur, was es bei GitHub gibt.
test('Store: der Start von Hand verlangt, dass der Lauf ans Release angehängt hat', () => {
  const yml = read('store.yml')
  const start = yml.indexOf('- name: Lauf prüfen')
  if (start < 0) return assert.fail('Schritt „Lauf prüfen“ fehlt in store.yml')
  const step = yml.slice(start, yml.indexOf('\n      - ', start + 1))
  assert.match(step, /Ans Release anhängen/)
  assert.match(step, /per_page=100/, 'der Release-Lauf hat über 40 Jobs, die erste Seite reicht nicht')
})

// Ein PR, der nur store.yml ändert, soll release.yml starten: GitHub löst den aufgerufenen Workflow
// beim Start auf, ein Fehler darin fiele sonst erst beim Tag auf.
test('Store: ein PR an store.yml startet release.yml', () => {
  const yml = read('release.yml')
  const paths = yml.slice(yml.indexOf('    paths:'), yml.indexOf('  workflow_dispatch:'))
  assert.match(paths, /- \.github\/workflows\/store\.yml/)
})

// Durchsicht (M1 zum Skript): Beim Nachreichen von Hand lud checkout den Stand des Tags, und dem
// fehlte das Skript (v0.14.0) samt den Texten aus dem Partner Center. Skript, Texte und Bilder kommen
// aus dem Stand des Workflows: beim Tag der Tag, von Hand gestartet main.
test('Store: ausgecheckt wird der Stand des Workflows, nicht der Tag des nachgereichten Laufs', () => {
  const yml = read('store.yml')
  const start = yml.indexOf('uses: actions/checkout@')
  const step = yml.slice(start, yml.indexOf('\n      - ', start))
  assert.doesNotMatch(step, /ref:/)
})

// Prüfsummen und Herkunftsnachweis am Release: SHA256SUMS.txt muss genau die Dateien nennen, die angehängt werden,
// sonst fehlt für eine Datei die Prüfsumme und mit ihr der Herkunftsnachweis (der liest dieselbe Liste).
const publishJob = () => {
  const yml = read('release.yml')
  const start = yml.indexOf('\n  veroeffentlichen:')
  if (start < 0) return assert.fail('Job „veroeffentlichen“ fehlt in release.yml')
  return yml.slice(start, yml.indexOf('\n  # ', start + 1))
}
const stepOf = (job: string, marker: string) => {
  const at = job.indexOf(marker)
  if (at < 0) return assert.fail(`${marker} fehlt im Job „veroeffentlichen“`)
  const begin = job.lastIndexOf('\n      - ', at)
  const end = job.indexOf('\n      - ', at)
  return job.slice(begin, end < 0 ? undefined : end)
}
const patterns = (block: string) => [...block.matchAll(/^\s+((?:dist-bin|dist-desktop)\/\S+)$/gm)].map((m) => m[1]).sort()

test('Release: SHA256SUMS.txt nennt jede angehängte Datei', () => {
  const job = publishJob()
  const sums = stepOf(job, '- name: Prüfsummen bilden')
  const uploads = [...job.matchAll(/uses: softprops\/action-gh-release@[\s\S]*?files: ?(\|[\s\S]*?\n {10}\w|\S+)/g)]
    .flatMap((m) => [...(m[1] ?? '').matchAll(/(?:dist-bin|dist-desktop)\/\S+/g)].map((f) => f[0]))
    .sort()
  assert.ok(uploads.length >= 11, `angehängte Dateien nicht gefunden: ${uploads.join(', ')}`)
  assert.deepEqual(patterns(sums), uploads)
  // Nur mit ausdrücklichem `shell: bash` setzt GitHub pipefail; sonst bliebe ein nicht passendes Muster unbemerkt, weil
  // sed am Ende der Pipe gelingt, und SHA256SUMS.txt wäre unvollständig
  assert.match(sums, /\n\s+shell: bash\n/)
  assert.match(job, /files: \|\n\s+pruefsummen\/SHA256SUMS\.txt\n/, 'SHA256SUMS.txt selbst geht mit ans Release')
})

test('Release: Prüfsummen nach dem Signieren, Herkunftsnachweis über dieselbe Liste', () => {
  const job = publishJob()
  const sign = job.indexOf('scripts/sign-update-manifest.mjs')
  const sums = job.indexOf('- name: Prüfsummen bilden')
  const attest = job.indexOf('uses: actions/attest@')
  assert.ok(sign > 0 && sums > sign, 'latest.yml ändert sich beim Signieren, die Prüfsumme muss danach entstehen')
  assert.ok(attest > sums)
  assert.match(stepOf(job, 'uses: actions/attest@'), /subject-checksums: pruefsummen\/SHA256SUMS\.txt/)
  assert.match(job, /id-token: write/)
  assert.match(job, /attestations: write/)
})

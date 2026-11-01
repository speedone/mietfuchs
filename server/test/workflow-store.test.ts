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

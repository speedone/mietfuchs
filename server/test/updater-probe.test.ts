// Die Update-Probe des Programmfensters (#517, scripts/updater-probe.mjs und updater-check.mjs): die zweite Fassung
// und die Prüfungen, die sich ohne Windows nachrechnen lassen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { installedMatches, nextPatch, probeStep, requestedFile } from '../../scripts/updater-probe.mjs'

test('Zweite Fassung: nächste Patch-Version, auch nach einer Vorabversion', () => {
  assert.equal(nextPatch('0.14.1'), '0.14.2')
  assert.equal(nextPatch('0.15.0-rc.1'), '0.15.1')
})

test('Zweite Fassung: ein Migrationsschritt ohne Wirkung nach dem letzten', () => {
  const step = probeStep({ entries: [{ idx: 84, when: 1000, tag: '0084_umstieg_hinweis' }] })
  assert.equal(step.tag, '0085_update_probe')
  assert.deepEqual(step.entry, { idx: 85, version: '6', when: 2000, tag: '0085_update_probe', breakpoints: true })
  assert.equal(step.sql, 'SELECT 1;\n')
})

// Durchsicht M1: electron-updater hängt an die Kanaldatei `?noCache=…`
test('Durchsicht M1: die abgerufene Datei ohne Abfrageteil', () => {
  assert.equal(requestedFile('/latest.yml?noCache=1k6cv0pv1'), 'latest.yml')
  assert.equal(requestedFile('/Mietfuchs-Setup-0.14.2.exe'), 'Mietfuchs-Setup-0.14.2.exe')
  assert.equal(requestedFile('/a%20b.yml'), 'a b.yml')
})

// Durchsicht S2: ProductVersion ist bei einer Vorabversion „0.15.0.0“; FileVersion trägt den Text der Version
test('Durchsicht S2: installierte Version aus FileVersion, ProductVersion nur ohne Vorabversion', () => {
  assert.equal(installedMatches({ file: '0.15.0-rc.1', product: '0.15.0.0' }, '0.15.0-rc.1'), true)
  assert.equal(installedMatches({ file: '0.15.0-rc.1', product: '0.15.0.0' }, '0.15.0'), false)
  assert.equal(installedMatches({ file: '0.14.2.0', product: '0.14.2.0' }, '0.14.2'), true)
  assert.equal(installedMatches({ file: '', product: '0.14.2' }, '0.14.2'), true)
  assert.equal(installedMatches({ file: '0.14.1', product: '0.14.1' }, '0.14.2'), false)
})

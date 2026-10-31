// Betriebsart (#25, Microsoft Store #500): Daran hängen Update-Hinweis, Beenden aus der
// Oberfläche und das Öffnen des Browsers.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectRuntime } from '../src/version.ts'

const STORE_EXE = 'C:\\Program Files\\WindowsApps\\speedone.Mietfuchs_0.14.0.0_x64__bzganrceka4qp\\mietfuchs.exe'

test('Programmdatei: entpackt, aus einem Paket oder aus dem Microsoft Store', () => {
  assert.equal(detectRuntime({ bun: true, execPath: 'C:\\Users\\Erika\\Downloads\\mietfuchs-win.exe', platform: 'win32', env: {} }), 'binary')
  assert.equal(detectRuntime({ bun: true, execPath: '/usr/bin/mietfuchs', platform: 'linux', env: {} }), 'package')
  assert.equal(detectRuntime({ bun: true, execPath: STORE_EXE, platform: 'win32', env: {} }), 'store')
})

test('ohne Bun entscheidet NKA_RUNTIME, eine Store-Angabe dort zählt nicht', () => {
  assert.equal(detectRuntime({ bun: false, execPath: STORE_EXE, platform: 'win32', env: {} }), 'npm')
  assert.equal(detectRuntime({ bun: false, env: { NKA_RUNTIME: 'docker' } }), 'docker')
  assert.equal(detectRuntime({ bun: false, env: { NKA_RUNTIME: 'binary' } }), 'binary')
  assert.equal(detectRuntime({ bun: false, env: { NKA_RUNTIME: 'store' } }), 'npm')
})

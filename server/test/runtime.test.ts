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

// Das Programmfenster (#517) startet die Programmdatei mit NKA_DESKTOP=1. Aus dem Store liegt sie dann tiefer im Paket
// (resources\server), und es bleibt bei 'store': Dort aktualisiert weiter der Store.
const STORE_WINDOW_EXE = 'C:\\Program Files\\WindowsApps\\speedone.Mietfuchs_1.15.0.0_x64__bzganrceka4qp\\resources\\server\\mietfuchs.exe'

test('Programmfenster: desktop, aus dem Store weiter store, ohne Bun über NKA_RUNTIME', () => {
  const exe = 'C:\\Users\\Erika\\AppData\\Local\\Programs\\Mietfuchs\\resources\\server\\mietfuchs.exe'
  assert.equal(detectRuntime({ bun: true, execPath: exe, platform: 'win32', env: { NKA_DESKTOP: '1' } }), 'desktop')
  assert.equal(detectRuntime({ bun: true, execPath: '/Applications/Mietfuchs.app/Contents/MacOS/mietfuchs-server', platform: 'darwin', env: { NKA_DESKTOP: '1' } }), 'desktop')
  assert.equal(detectRuntime({ bun: true, execPath: STORE_WINDOW_EXE, platform: 'win32', env: { NKA_DESKTOP: '1' } }), 'store')
  assert.equal(detectRuntime({ bun: true, execPath: STORE_WINDOW_EXE, platform: 'win32', env: {} }), 'store')
  // Ohne die Angabe bleibt die Datei, was sie ist
  assert.equal(detectRuntime({ bun: true, execPath: exe, platform: 'win32', env: {} }), 'binary')
  assert.equal(detectRuntime({ bun: false, env: { NKA_RUNTIME: 'desktop' } }), 'desktop')
  // Eine nackte Angabe ohne Bun zählt nicht, sonst hielte sich der Dev-Server für das Fenster
  assert.equal(detectRuntime({ bun: false, env: { NKA_DESKTOP: '1' } }), 'npm')
})

test('Store: ein Ordner, der nur so heißt, oder ein fremdes Paket bleibt eine Programmdatei', () => {
  assert.equal(detectRuntime({ bun: true, execPath: 'C:\\Users\\Erika\\WindowsApps\\resources\\mietfuchs.exe', platform: 'win32', env: {} }), 'binary')
  assert.equal(detectRuntime({ bun: true, execPath: 'D:\\WindowsApps\\fremd.App_1.0.0.0_x64__abc\\resources\\mietfuchs.exe', platform: 'win32', env: {} }), 'binary')
})

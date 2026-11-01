// Betriebsart (#25, Microsoft Store #500): Daran hängen Update-Hinweis, Beenden aus der
// Oberfläche und das Öffnen des Browsers.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectRuntime, inWindow } from '../src/version.ts'

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

// Das Programmfenster (#517) startet den Server nicht mehr als Programmdatei (Bun), sondern aus dem Quellcode mit
// Electrons eigenem Node als utilityProcess und setzt NKA_DESKTOP=1, aus dem Store zusätzlich NKA_STORE=1
// (`process.windowsStore`). Die Betriebsart hängt deshalb nicht mehr an Bun, sondern daran, dass der Server wirklich
// in einem utilityProcess von Electron läuft (`process.parentPort`): Eine Angabe in der Umgebung allein kann jeder
// setzen, auch versehentlich im Terminal des Dev-Servers.
const WINDOW_EXE = 'C:\\Users\\Erika\\AppData\\Local\\Programs\\mietfuchs\\Mietfuchs.exe'
const STORE_WINDOW_EXE = 'C:\\Program Files\\WindowsApps\\speedone.Mietfuchs_1.15.0.0_x64__bzganrceka4qp\\Mietfuchs.exe'

test('Programmfenster: desktop im utilityProcess mit NKA_DESKTOP, aus dem Store store', () => {
  assert.equal(detectRuntime({ utility: true, execPath: WINDOW_EXE, platform: 'win32', env: { NKA_DESKTOP: '1' } }), 'desktop')
  assert.equal(detectRuntime({ utility: true, execPath: '/Applications/Mietfuchs.app/Contents/MacOS/Mietfuchs', platform: 'darwin', env: { NKA_DESKTOP: '1' } }), 'desktop')
  // Aus dem Store: die Angabe des Fensters, und zur Sicherheit auch der Ort, falls `process.windowsStore` einmal fehlt
  assert.equal(detectRuntime({ utility: true, execPath: WINDOW_EXE, platform: 'win32', env: { NKA_DESKTOP: '1', NKA_STORE: '1' } }), 'store')
  assert.equal(detectRuntime({ utility: true, execPath: STORE_WINDOW_EXE, platform: 'win32', env: { NKA_DESKTOP: '1' } }), 'store')
  // NKA_RUNTIME=desktop bleibt der Testgriff, mit dem die Servertests das Fenster unter Node nachstellen
  assert.equal(detectRuntime({ env: { NKA_RUNTIME: 'desktop' } }), 'desktop')
})

// Geänderte Erwartung: Bisher war `bun: true` mit NKA_DESKTOP das Fenster. Die Programmdatei startet heute kein
// Fenster mehr, eine Angabe darin ändert also nichts mehr an ihr.
test('Programmfenster: ohne utilityProcess zählt NKA_DESKTOP nicht, weder unter Node noch in der Programmdatei', () => {
  // Der Dev-Server (`npm run dev`) und Docker laufen unter Node ohne Electron
  assert.equal(detectRuntime({ utility: false, env: { NKA_DESKTOP: '1' } }), 'npm')
  assert.equal(detectRuntime({ utility: false, env: { NKA_DESKTOP: '1', NKA_STORE: '1' } }), 'npm')
  assert.equal(detectRuntime({ utility: false, env: { NKA_DESKTOP: '1', NKA_RUNTIME: 'docker' } }), 'docker')
  assert.equal(detectRuntime({ utility: false, bun: true, execPath: WINDOW_EXE, platform: 'win32', env: { NKA_DESKTOP: '1' } }), 'binary')
  // Im utilityProcess ohne Angabe des Fensters (ein anderes Electron-Programm) ebenso nicht
  assert.equal(detectRuntime({ utility: true, env: {} }), 'npm')
  // Die Programmdatei aus dem Store bleibt store
  assert.equal(detectRuntime({ bun: true, execPath: STORE_WINDOW_EXE, platform: 'win32', env: {} }), 'store')
})

test('Fenster: nur im utilityProcess mit NKA_DESKTOP, oder mit dem Testgriff', () => {
  assert.equal(inWindow({ utility: true, env: { NKA_DESKTOP: '1' } }), true)
  assert.equal(inWindow({ utility: true, env: { NKA_DESKTOP: '1', NKA_STORE: '1' } }), true)
  assert.equal(inWindow({ utility: false, env: { NKA_DESKTOP: '1' } }), false)
  assert.equal(inWindow({ utility: true, env: {} }), false)
  assert.equal(inWindow({ utility: false, env: { NKA_RUNTIME: 'desktop' } }), true)
})

test('Store: ein Ordner, der nur so heißt, oder ein fremdes Paket bleibt eine Programmdatei', () => {
  assert.equal(detectRuntime({ bun: true, execPath: 'C:\\Users\\Erika\\WindowsApps\\resources\\mietfuchs.exe', platform: 'win32', env: {} }), 'binary')
  assert.equal(detectRuntime({ bun: true, execPath: 'D:\\WindowsApps\\fremd.App_1.0.0.0_x64__abc\\resources\\mietfuchs.exe', platform: 'win32', env: {} }), 'binary')
})

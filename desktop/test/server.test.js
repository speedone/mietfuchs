// Der Server im Programmfenster (#517), ohne Electron geprüft: Datei, Umgebung, Port, Startzeile und Links.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { DEFAULT_PORT, canListen, dataDirIn, freePort, linkTarget, serverCommand, serverEnv, startUrlIn, whoIsOn } from '../src/server.js'

test('Programmdatei: Windows in resources\\server, Mac neben dem Fenster, beim Entwickeln der Quellcode', () => {
  assert.deepEqual(
    serverCommand({ packaged: true, platform: 'win32', resourcesPath: 'C:\\Users\\Anna\\AppData\\Local\\Programs\\Mietfuchs\\resources', execPath: 'C:\\Users\\Anna\\AppData\\Local\\Programs\\Mietfuchs\\Mietfuchs.exe', repoRoot: '' }),
    { command: 'C:\\Users\\Anna\\AppData\\Local\\Programs\\Mietfuchs\\resources\\server\\mietfuchs.exe', args: [] },
  )
  assert.deepEqual(
    serverCommand({ packaged: true, platform: 'darwin', resourcesPath: '/Applications/Mietfuchs.app/Contents/Resources', execPath: '/Applications/Mietfuchs.app/Contents/MacOS/Mietfuchs', repoRoot: '' }),
    { command: '/Applications/Mietfuchs.app/Contents/MacOS/mietfuchs-server', args: [] },
  )
  const dev = serverCommand({ packaged: false, platform: 'linux', resourcesPath: '', execPath: '', repoRoot: '/repo' })
  assert.deepEqual(dev.args, ['/repo/server/src/index.ts'])
})

test('Umgebung: Betriebsart, Port, nur 127.0.0.1 ohne Heimnetz, Prüfangaben des Fensters gehen weiter', () => {
  const base = { CI: '1', NKA_DATA_DIR: '/tmp/probe', NKA_UPDATE_URL: 'http://127.0.0.1:9', ELECTRON_RUN_AS_NODE: '1' }
  const env = serverEnv(base, { port: DEFAULT_PORT, network: false, packaged: true })
  assert.equal(env.NKA_DESKTOP, '1')
  assert.equal(env.NKA_PORT, '17517')
  assert.equal(env.NKA_HOST, '127.0.0.1')
  assert.equal(env.CI, '1')
  assert.equal(env.NKA_DATA_DIR, '/tmp/probe')
  assert.equal(env.NKA_UPDATE_URL, 'http://127.0.0.1:9')
  assert.equal(env.ELECTRON_RUN_AS_NODE, undefined)
  assert.equal(env.NKA_RUNTIME, undefined, 'die Programmdatei erkennt sich selbst')
  assert.equal(serverEnv(base, { port: 4000, network: true, packaged: true }).NKA_HOST, '0.0.0.0')
  assert.equal(serverEnv(base, { port: 4000, network: false, packaged: false }).NKA_RUNTIME, 'desktop')
  // Die Umgebung des Fensters selbst bleibt unverändert
  assert.equal(base.ELECTRON_RUN_AS_NODE, '1')
})

test('Startzeile und Datenordner aus der Ausgabe des Servers', () => {
  const output = 'Mietfuchs-Server läuft auf http://127.0.0.1:17517\nDaten: C:\\Users\\Anna\\Mietfuchs\nDatenbank: C:\\Users\\Anna\\Mietfuchs\\mietfuchs.sqlite\n'
  assert.equal(startUrlIn(output), 'http://127.0.0.1:17517')
  assert.equal(dataDirIn(output), 'C:\\Users\\Anna\\Mietfuchs')
  assert.equal(startUrlIn('Mietfuchs startet …'), null)
})

test('Port: frei, Mietfuchs oder ein anderes Programm', async () => {
  const port = await freePort()
  assert.equal(await whoIsOn(port), 'free')
  const other = http.createServer((req, res) => res.end('nicht Mietfuchs'))
  await new Promise((resolve) => other.listen(0, () => resolve(undefined)))
  const address = other.address()
  const busy = typeof address === 'object' && address ? address.port : 0
  try {
    assert.equal(await canListen(busy), false)
    assert.equal(await whoIsOn(busy), 'other')
    const mietfuchs = async () => new Response(JSON.stringify({ app: 'mietfuchs', status: 'ok' }))
    assert.equal(await whoIsOn(busy, mietfuchs), 'mietfuchs')
  } finally {
    other.close()
  }
})

test('Links: eigene Seiten im Fenster, http, https und mailto im Standardprogramm, sonst nichts', () => {
  const origin = 'http://127.0.0.1:17517'
  assert.equal(linkTarget('/uploads/beleg.pdf', origin), 'window')
  assert.equal(linkTarget('http://127.0.0.1:17517/abrechnung', origin), 'window')
  assert.equal(linkTarget('https://github.com/speedone/mietfuchs', origin), 'external')
  assert.equal(linkTarget('mailto:anna@example.org', origin), 'external')
  // Ein anderer Port ist eine andere Seite
  assert.equal(linkTarget('http://127.0.0.1:3001/', origin), 'external')
  assert.equal(linkTarget('file:///C:/Windows/system32/calc.exe', origin), 'deny')
  assert.equal(linkTarget('javascript:alert(1)', origin), 'deny')
  assert.equal(linkTarget('ms-settings:', origin), 'deny')
})

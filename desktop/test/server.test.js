// Der Server im Programmfenster (#517), ohne Electron geprüft: Datei, Umgebung, Port, Startzeile und Links.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import { DEFAULT_PORT, canListen, dataDirIn, freePort, lanUrls, linkTarget, networkState, serverCommand, serverEnv, startUrlIn, whoIsOn } from '../src/server.js'

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

// Zugriff aus dem Heimnetz: die Adressen fürs Handy, aus den Netzwerkkarten des Rechners
test('Heimnetz: IPv4 der äußeren Netzwerkkarten, ohne Loopback, link-local und IPv6, jede einmal', () => {
  /** @type {NodeJS.Dict<import('node:os').NetworkInterfaceInfo[]>} */
  const interfaces = {
    lo: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: true, cidr: '127.0.0.1/8' }],
    WLAN: [
      { address: 'fe80::1', netmask: 'ffff:ffff:ffff:ffff::', family: 'IPv6', mac: 'aa:bb:cc:dd:ee:ff', internal: false, cidr: 'fe80::1/64', scopeid: 3 },
      { address: '192.168.178.23', netmask: '255.255.255.0', family: 'IPv4', mac: 'aa:bb:cc:dd:ee:ff', internal: false, cidr: '192.168.178.23/24' },
    ],
    Ethernet: [
      { address: '169.254.12.7', netmask: '255.255.0.0', family: 'IPv4', mac: '11:22:33:44:55:66', internal: false, cidr: '169.254.12.7/16' },
      { address: '10.0.0.5', netmask: '255.255.255.0', family: 'IPv4', mac: '11:22:33:44:55:66', internal: false, cidr: '10.0.0.5/24' },
    ],
    // Dieselbe Adresse zweimal (etwa eine Brücke) erscheint nur einmal
    Bruecke: [{ address: '10.0.0.5', netmask: '255.255.255.0', family: 'IPv4', mac: '11:22:33:44:55:67', internal: false, cidr: '10.0.0.5/24' }],
    leer: undefined,
  }
  assert.deepEqual(lanUrls(interfaces, 17517), ['http://192.168.178.23:17517', 'http://10.0.0.5:17517'])
  assert.deepEqual(lanUrls({ lo: interfaces.lo }, 17517), [])
  // Ältere Node-Fassungen nannten die Familie als Zahl
  const numeric = /** @type {any} */ ({ eth0: [{ address: '192.168.1.2', family: 4, internal: false }] })
  assert.deepEqual(lanUrls(numeric, 4000), ['http://192.168.1.2:4000'])
})

test('Heimnetz: Stand für die Oberfläche aus Einstellung, Port und Netzwerkkarten', () => {
  const interfaces = { WLAN: [{ address: '192.168.178.23', netmask: '255.255.255.0', family: /** @type {const} */ ('IPv4'), mac: '', internal: false, cidr: null }] }
  assert.deepEqual(networkState({ network: true }, 17517, interfaces), { enabled: true, port: 17517, addresses: ['http://192.168.178.23:17517'] })
  assert.deepEqual(networkState({}, 17517, interfaces), { enabled: false, port: 17517, addresses: ['http://192.168.178.23:17517'] })
  // Nur ein echtes true schaltet ein (fenster.json ist von Hand änderbar)
  assert.equal(networkState(/** @type {any} */ ({ network: 'ja' }), 17517, interfaces).enabled, false)
})

// Gefunden auf einem echten Windows-Rechner: Eine Probe auf allen Netzwerkkarten (listen ohne Adresse) ließ die
// Windows-Firewall beim ersten Start fragen, ob Mietfuchs ins Netz darf. Das Fenster bindet nur 127.0.0.1; ins Netz
// geht allein der Server, und nur mit dem Schalter „Zugriff aus dem Heimnetz“.
test('Fenster: jede Probe bindet nur 127.0.0.1 (sonst fragt die Windows-Firewall)', () => {
  for (const file of ['../src/server.js', '../src/main.js']) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8')
    const calls = source.match(/\.listen\([^)]*\)/g) ?? []
    for (const call of calls) assert.match(call, /'127\.0\.0\.1'/, `${file}: ${call}`)
  }
})

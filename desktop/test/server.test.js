// Der Server im Programmfenster (#517), ohne Electron geprüft: Modul, Umgebung, Port, Startzeile und Links.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import { DEFAULT_PORT, SERVER_FOLDER, canListen, dataDirIn, freePort, lanUrls, linkTarget, networkState, serverEnv, serverModule, startUrlIn, whoIsOn } from '../src/server.js'

// Geänderte Erwartung: Bisher lief ausgeliefert die Programmdatei des Servers (Bun) unter resources\server bzw. in
// Contents/MacOS. Heute läuft der Server aus dem Quellcode mit Electrons eigenem Node als utilityProcess; ausgeliefert
// liegt er unter resources/mietfuchs in der Anordnung des Repos, beim Entwickeln im Repo selbst.
test('Server: ausgeliefert unter resources/mietfuchs, beim Entwickeln aus dem Repo, nach der genannten Plattform', () => {
  assert.deepEqual(
    serverModule({ packaged: true, platform: 'win32', resourcesPath: 'C:\\Users\\Anna\\AppData\\Local\\Programs\\mietfuchs\\resources', repoRoot: '' }),
    {
      modulePath: 'C:\\Users\\Anna\\AppData\\Local\\Programs\\mietfuchs\\resources\\mietfuchs\\server\\src\\index.ts',
      cwd: 'C:\\Users\\Anna\\AppData\\Local\\Programs\\mietfuchs\\resources\\mietfuchs\\server',
    },
  )
  assert.deepEqual(
    serverModule({ packaged: true, platform: 'darwin', resourcesPath: '/Applications/Mietfuchs.app/Contents/Resources', repoRoot: '' }),
    { modulePath: '/Applications/Mietfuchs.app/Contents/Resources/mietfuchs/server/src/index.ts', cwd: '/Applications/Mietfuchs.app/Contents/Resources/mietfuchs/server' },
  )
  assert.deepEqual(
    serverModule({ packaged: false, platform: 'linux', resourcesPath: '/irgendwo/electron/resources', repoRoot: '/repo' }),
    { modulePath: '/repo/server/src/index.ts', cwd: '/repo/server' },
  )
  assert.equal(SERVER_FOLDER, 'mietfuchs')
})

test('Umgebung: Fenster, Port, nur 127.0.0.1 ohne Heimnetz, Prüfangaben des Fensters gehen weiter', () => {
  const base = { CI: '1', NKA_DATA_DIR: '/tmp/probe', NKA_UPDATE_URL: 'http://127.0.0.1:9', ELECTRON_RUN_AS_NODE: '1', NKA_RUNTIME: 'docker' }
  const env = serverEnv(base, { port: DEFAULT_PORT, network: false, packaged: true, windowsStore: false, repoRoot: '/repo' })
  assert.equal(env.NKA_DESKTOP, '1')
  assert.equal(env.NKA_STORE, undefined)
  assert.equal(env.NKA_PORT, '17517')
  assert.equal(env.NKA_HOST, '127.0.0.1')
  assert.equal(env.CI, '1')
  assert.equal(env.NKA_DATA_DIR, '/tmp/probe')
  assert.equal(env.NKA_UPDATE_URL, 'http://127.0.0.1:9')
  assert.equal(env.ELECTRON_RUN_AS_NODE, undefined)
  // Geänderte Erwartung: Den Testgriff NKA_RUNTIME setzt das Fenster beim Entwickeln nicht mehr, und einen geerbten
  // nimmt es heraus. Der Server erkennt das Fenster am utilityProcess mit NKA_DESKTOP, ausgeliefert wie beim Entwickeln.
  assert.equal(env.NKA_RUNTIME, undefined)
  assert.equal(serverEnv(base, { port: 4000, network: true, packaged: true, windowsStore: false, repoRoot: '/repo' }).NKA_HOST, '0.0.0.0')
  // Aus dem Store sagt es das Fenster dem Server ausdrücklich (process.windowsStore)
  assert.equal(serverEnv(base, { port: 4000, network: false, packaged: true, windowsStore: true, repoRoot: '/repo' }).NKA_STORE, '1')
  // Die Umgebung des Fensters selbst bleibt unverändert
  assert.equal(base.ELECTRON_RUN_AS_NODE, '1')
})

// Beim Entwickeln nie der echte Bestand im Benutzerordner: Wie `npm run dev` arbeitet das Fenster dann mit
// server/data, außer eine Prüfung gibt NKA_DATA_DIR vor. Ausgeliefert wählt der Server selbst (chooseDataDir).
test('Umgebung: beim Entwickeln server/data, ausgeliefert entscheidet der Server', () => {
  const dev = serverEnv({}, { port: 4000, network: false, packaged: false, windowsStore: false, repoRoot: '/repo' })
  assert.equal(dev.NKA_DATA_DIR, '/repo/server/data')
  assert.equal(dev.NKA_DESKTOP, '1')
  const probe = serverEnv({ NKA_DATA_DIR: '/tmp/probe' }, { port: 4000, network: false, packaged: false, windowsStore: false, repoRoot: '/repo' })
  assert.equal(probe.NKA_DATA_DIR, '/tmp/probe')
  assert.equal(serverEnv({}, { port: 4000, network: false, packaged: true, windowsStore: false, repoRoot: '/repo' }).NKA_DATA_DIR, undefined)
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
  // Ein anderes Programm auf allen Adressen: Windows und macOS ließen 127.0.0.1 daneben noch binden, die Probe allein
  // hielte den Port also für frei. Entscheidend ist die Anfrage über 127.0.0.1, die es vorher erreicht.
  const other = http.createServer((req, res) => res.end('nicht Mietfuchs'))
  await new Promise((resolve) => other.listen(0, () => resolve(undefined)))
  const address = other.address()
  const busy = typeof address === 'object' && address ? address.port : 0
  // Und eins nur auf 127.0.0.1, dort sagt auch die Probe „belegt“
  const local = http.createServer((req, res) => res.end('nicht Mietfuchs'))
  await new Promise((resolve) => local.listen(0, '127.0.0.1', () => resolve(undefined)))
  const localAddress = local.address()
  const localBusy = typeof localAddress === 'object' && localAddress ? localAddress.port : 0
  try {
    assert.equal(await whoIsOn(busy), 'other')
    assert.equal(await canListen(localBusy), false)
    assert.equal(await whoIsOn(localBusy), 'other')
    const mietfuchs = async () => new Response(JSON.stringify({ app: 'mietfuchs', status: 'ok' }))
    assert.equal(await whoIsOn(busy, mietfuchs), 'mietfuchs')
  } finally {
    other.close()
    local.close()
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

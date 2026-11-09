// Der Server im Programmfenster (#517), ohne Electron geprüft: Modul, Umgebung, Port, Startzeile und Links.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { remoteOf, DEFAULT_PORT, SERVER_FOLDER, blockedFileIn, canListen, findBlockedFile, programFiles, startFailure, dataDirIn, freePort, lanUrls, linkTarget, networkState, serverEnv, serverModule, startUrlIn, whoIsOn, chosenFolder, folderDialogProperties, isReceipt, isAppPage, trustedSender, childWebPreferences, frameTarget, navigationTarget, readSettingsFile, writeSettingsFile, surfaceWindow } from '../src/server.js'

// Geänderte Erwartung: Bisher lief ausgeliefert die Programmdatei des Servers (Bun) unter resources\server bzw. in
// Contents/MacOS, danach der Quellcode unter resources/mietfuchs/server/src, dann das Bündel offen unter
// resources/mietfuchs/server/server.mjs. Heute liegt das Bündel in der app.asar (desktop/package.json, `files`): keine
// einzelne große Skriptdatei mehr im Installationsordner, und die Prüfung der Integrität der asar deckt es mit ab. Ein
// Arbeitsordner kann nicht in der asar liegen, er ist deshalb resources. Beim Entwickeln der Quellcode im Repo.
test('Server: ausgeliefert das Bündel in der app.asar, beim Entwickeln die Quellen im Repo, nach der genannten Plattform', () => {
  assert.deepEqual(
    serverModule({ packaged: true, platform: 'win32', resourcesPath: 'C:\\Users\\Anna\\AppData\\Local\\Programs\\mietfuchs\\resources', repoRoot: '' }),
    {
      modulePath: 'C:\\Users\\Anna\\AppData\\Local\\Programs\\mietfuchs\\resources\\app.asar\\mietfuchs\\server\\server.mjs',
      cwd: 'C:\\Users\\Anna\\AppData\\Local\\Programs\\mietfuchs\\resources',
    },
  )
  assert.deepEqual(
    serverModule({ packaged: true, platform: 'darwin', resourcesPath: '/Applications/Mietfuchs.app/Contents/Resources', repoRoot: '' }),
    { modulePath: '/Applications/Mietfuchs.app/Contents/Resources/app.asar/mietfuchs/server/server.mjs', cwd: '/Applications/Mietfuchs.app/Contents/Resources' },
  )
  assert.deepEqual(
    serverModule({ packaged: false, platform: 'linux', resourcesPath: '/irgendwo/electron/resources', repoRoot: '/repo' }),
    { modulePath: '/repo/server/src/index.ts', cwd: '/repo/server' },
  )
  assert.equal(SERVER_FOLDER, 'mietfuchs')
})

// Geänderte Erwartung: Ausgeliefert gehen CI und NKA_UPDATE_URL nur noch mit MIETFUCHS_TESTGRIFFE=1 weiter (testGrips.test.js)
test('Umgebung: Fenster, Port, nur 127.0.0.1 ohne Heimnetz, Prüfangaben des Fensters gehen weiter', () => {
  const base = { CI: '1', MIETFUCHS_TESTGRIFFE: '1', NKA_DATA_DIR: '/tmp/probe', NKA_UPDATE_URL: 'http://127.0.0.1:9', ELECTRON_RUN_AS_NODE: '1', NKA_RUNTIME: 'docker' }
  const env = serverEnv(base, { port: DEFAULT_PORT, network: false, packaged: true, windowsStore: false, repoRoot: '/repo', platform: 'linux' })
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
  assert.equal(serverEnv(base, { port: 4000, network: true, packaged: true, windowsStore: false, repoRoot: '/repo', platform: 'linux' }).NKA_HOST, '0.0.0.0')
  // Aus dem Store sagt es das Fenster dem Server ausdrücklich (process.windowsStore)
  assert.equal(serverEnv(base, { port: 4000, network: false, packaged: true, windowsStore: true, repoRoot: '/repo', platform: 'linux' }).NKA_STORE, '1')
  // Die Umgebung des Fensters selbst bleibt unverändert
  assert.equal(base.ELECTRON_RUN_AS_NODE, '1')
})

// Beim Entwickeln nie der echte Bestand im Benutzerordner: Wie `npm run dev` arbeitet das Fenster dann mit
// server/data, außer eine Prüfung gibt NKA_DATA_DIR vor. Ausgeliefert wählt der Server selbst (chooseDataDir).
test('Umgebung: beim Entwickeln server/data, ausgeliefert entscheidet der Server', () => {
  const dev = serverEnv({}, { port: 4000, network: false, packaged: false, windowsStore: false, repoRoot: '/repo', platform: 'linux' })
  assert.equal(dev.NKA_DATA_DIR, '/repo/server/data')
  assert.equal(dev.NKA_DESKTOP, '1')
  const probe = serverEnv({ NKA_DATA_DIR: '/tmp/probe' }, { port: 4000, network: false, packaged: false, windowsStore: false, repoRoot: '/repo', platform: 'linux' })
  assert.equal(probe.NKA_DATA_DIR, '/tmp/probe')
  assert.equal(serverEnv({}, { port: 4000, network: false, packaged: true, windowsStore: false, repoRoot: '/repo', platform: 'linux' }).NKA_DATA_DIR, undefined)
  // Nach der genannten Plattform, nicht nach der des Rechners, auf dem geprüft wird
  assert.equal(serverEnv({}, { port: 4000, network: false, packaged: false, windowsStore: false, repoRoot: 'C:\\mietfuchs', platform: 'win32' }).NKA_DATA_DIR, 'C:\\mietfuchs\\server\\data')
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

// Belege ohne Brücke (#517): Ein Beleg kommt vom selben Ursprung wie die Oberfläche. Sein Fenster bekommt kein Preload,
// und keine Anfrage an das Fenster gilt, die aus einem Beleg oder einem eingebetteten Rahmen kommt.
test('Belege: erkannt unter /uploads, auch groß geschrieben, kodiert oder über Umwege im Pfad, nur auf der eigenen Adresse', () => {
  const origin = 'http://127.0.0.1:17517'
  assert.equal(isReceipt('/uploads/1700000000000_Rechnung.pdf', origin), true)
  assert.equal(isReceipt('http://127.0.0.1:17517/uploads/a.svg?x=1#y', origin), true)
  assert.equal(isReceipt('http://127.0.0.1:17517/UPLOADS/a.svg', origin), true, 'Express unterscheidet Groß und Klein nicht')
  assert.equal(isReceipt('http://127.0.0.1:17517/%75ploads/a.svg', origin), true)
  assert.equal(isReceipt('http://127.0.0.1:17517/belege/../uploads/a.svg', origin), true)
  assert.equal(isReceipt('http://127.0.0.1:17517/uploads', origin), true)
  assert.equal(isReceipt('http://127.0.0.1:17517/belege', origin), false)
  assert.equal(isReceipt('http://127.0.0.1:17517/uploadsliste', origin), false)
  assert.equal(isReceipt('http://127.0.0.1:17517/api/uploads', origin), false)
  assert.equal(isReceipt('https://example.org/uploads/a.svg', origin), false)
  assert.equal(isReceipt('kein url', 'kaputt'), false)
  assert.equal(isAppPage('http://127.0.0.1:17517/belege', origin), true)
  assert.equal(isAppPage('http://127.0.0.1:17517/uploads/a.pdf', origin), false)
  assert.equal(isAppPage('https://example.org/', origin), false)
})

test('Belege: Anfragen an das Fenster nur vom Hauptrahmen der Oberfläche, nicht aus einem Beleg oder Rahmen', () => {
  const origin = 'http://127.0.0.1:17517'
  assert.equal(trustedSender({ url: 'http://127.0.0.1:17517/einstellungen', parent: null }, origin), true)
  assert.equal(trustedSender({ url: 'http://127.0.0.1:17517/uploads/a.svg', parent: null }, origin), false, 'Beleg im Hauptrahmen')
  assert.equal(trustedSender({ url: 'http://127.0.0.1:17517/einstellungen', parent: {} }, origin), false, 'eingebetteter Rahmen')
  assert.equal(trustedSender({ url: 'https://example.org/', parent: null }, origin), false)
  assert.equal(trustedSender(null, origin), false)
  assert.equal(trustedSender({ url: 'http://127.0.0.1:17517/', parent: null }, null), false, 'ohne Server keine Oberfläche')
})

test('Belege: ein neues Fenster für einen Beleg ohne Preload, für die Oberfläche mit; immer abgeschottet', () => {
  const origin = 'http://127.0.0.1:17517'
  const preload = '/app/src/preload.cjs'
  const receipt = childWebPreferences('http://127.0.0.1:17517/uploads/a.pdf', origin, preload)
  assert.equal('preload' in receipt, false)
  assert.deepEqual(receipt, { contextIsolation: true, sandbox: true, nodeIntegration: false })
  assert.deepEqual(childWebPreferences('http://127.0.0.1:17517/belege', origin, preload), { preload, contextIsolation: true, sandbox: true, nodeIntegration: false })
  assert.equal('preload' in childWebPreferences('http://127.0.0.1:17517/Uploads/a.svg', origin, preload), false)
  // Was ein Fenster ohne Brücke öffnet (ein Link im PDF eines Belegfensters), bleibt ohne Brücke (Durchsicht)
  assert.equal('preload' in childWebPreferences('http://127.0.0.1:17517/einstellungen', origin, preload, false), false)
  assert.equal(childWebPreferences('http://127.0.0.1:17517/einstellungen', origin, preload, true).preload, preload)
})

// Ein Beleg öffnet nie in einem Fenster mit Brücke, auch nicht über einen Link ohne neues Fenster oder eine Weiterleitung:
// Dann bleibt das Fenster, wo es ist, und der Beleg kommt in ein eigenes ohne Preload (#517, Durchsicht).
test('Navigation: ein Beleg aus einem Fenster mit Brücke in ein eigenes Fenster, sonst wie bei Links', () => {
  const origin = 'http://127.0.0.1:17517'
  assert.equal(navigationTarget('http://127.0.0.1:17517/belege', origin, true), 'stay')
  assert.equal(navigationTarget('http://127.0.0.1:17517/uploads/a.pdf', origin, true), 'receipt')
  assert.equal(navigationTarget('http://127.0.0.1:17517/Uploads/a.svg', origin, true), 'receipt')
  assert.equal(navigationTarget('http://127.0.0.1:17517/uploads/b.pdf', origin, false), 'stay', 'im Belegfenster ohne Brücke')
  assert.equal(navigationTarget('https://example.org/', origin, true), 'external')
  assert.equal(navigationTarget('file:///etc/passwd', origin, true), 'deny')
  assert.equal(navigationTarget('http://127.0.0.1:17517/', null, true), 'deny')
})

// Ein PDF zeigt Electron mit dem eingebauten Betrachter, einer Erweiterung in einem Rahmen unter dem Dokument. Ließ die
// Wache nur die eigene Adresse zu, blieb jedes PDF im Fenster grau, in der Vorschau wie im eigenen Fenster (nachgemessen
// mit Electron 45 für #517). Zugelassen ist genau dieser Betrachter, keine andere Erweiterung.
test('Rahmen: eigene Adresse und der eingebaute PDF-Betrachter, sonst nichts', () => {
  const origin = 'http://127.0.0.1:17517'
  assert.equal(frameTarget('http://127.0.0.1:17517/uploads/a.pdf', origin), true)
  assert.equal(frameTarget('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/3cdd4370-071c-4188-a4f2-2c5d7c8336bf', origin), true)
  assert.equal(frameTarget('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html', origin), true)
  assert.equal(frameTarget('chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/index.html', origin), false)
  assert.equal(frameTarget('https://example.org/', origin), false)
  assert.equal(frameTarget('data:text/html,<script>1</script>', origin), false)
  assert.equal(frameTarget('http://127.0.0.1:17517/', null), false)
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

// Gefunden auf einem echten Windows-11-Rechner: Die Malware-Prävention von HP Wolf Security stufte das Bündel als
// Schadcode ein und blockierte es. Node meldete EPERM beim Öffnen, und der Dialog zeigte nur einen Stacktrace. Jetzt sagt
// er, was los ist und was zu tun ist; die technische Meldung steht klein darunter.
const RESOURCES = 'C:\\Users\\Anna\\AppData\\Local\\Programs\\mietfuchs\\resources'
const ASAR = `${RESOURCES}\\app.asar`

test('Programmdateien: Bündel und Frontend in der app.asar, beim Entwickeln die Quellen', () => {
  assert.deepEqual(programFiles({ packaged: true, platform: 'win32', resourcesPath: RESOURCES, repoRoot: '' }), [
    `${ASAR}\\mietfuchs\\server\\server.mjs`,
    `${ASAR}\\mietfuchs\\client\\dist.pack`,
  ])
  assert.deepEqual(programFiles({ packaged: false, platform: 'linux', resourcesPath: '/x', repoRoot: '/repo' }), ['/repo/server/src/index.ts'])
})

test('Blockierte Datei: eine Datei des Programms, die sich nicht öffnen lässt', () => {
  const files = ['/a/server.mjs', '/a/dist.pack']
  const fail = (/** @type {string} */ code) => (/** @type {string} */ file) => {
    if (file !== '/a/dist.pack') return
    throw Object.assign(new Error(`${code}: open '${file}'`), { code })
  }
  assert.equal(findBlockedFile(files, () => {}), null)
  assert.deepEqual(findBlockedFile(files, fail('EPERM')), { code: 'EPERM', path: '/a/dist.pack' })
  assert.deepEqual(findBlockedFile(files, fail('EACCES')), { code: 'EACCES', path: '/a/dist.pack' })
  assert.deepEqual(findBlockedFile(files, fail('ENOENT')), { code: 'ENOENT', path: '/a/dist.pack' })
  // Andere Fehler sind kein Virenschutz
  assert.equal(findBlockedFile(files, fail('EMFILE')), null)
})

test('Blockierte Datei: aus der Ausgabe des Servers, nur Dateien unter dem Programmordner', () => {
  const programDir = 'C:\\Users\\Anna\\AppData\\Local\\Programs\\mietfuchs'
  // So auf dem Rechner mit HP Wolf Security (damals noch offen unter resources\mietfuchs)
  const wolf = `node:internal/modules/esm/load:189
Error: EPERM: operation not permitted, open 'C:\\Users\\Anna\\AppData\\Local\\Programs\\mietfuchs\\resources\\mietfuchs\\server\\server.mjs'
    at Object.readFileSync (node:fs:441:20) {
  errno: -4048,
  code: 'EPERM',
  syscall: 'open',
  path: 'C:\\\\Users\\\\Anna\\\\AppData\\\\Local\\\\Programs\\\\mietfuchs\\\\resources\\\\mietfuchs\\\\server\\\\server.mjs'
}`
  assert.deepEqual(blockedFileIn(wolf, programDir, 'win32'), { code: 'EPERM', path: `${RESOURCES}\\mietfuchs\\server\\server.mjs` })
  // Nur das Objekt am Ende, wie es Node unter einem abgeschnittenen Stacktrace druckt; Groß- und Kleinschreibung zählt
  // unter Windows nicht
  const objectOnly = "  code: 'EPERM',\n  syscall: 'open',\n  path: 'c:\\\\users\\\\anna\\\\appdata\\\\local\\\\programs\\\\mietfuchs\\\\resources\\\\app.asar'\n}"
  assert.deepEqual(blockedFileIn(objectOnly, programDir, 'win32'), { code: 'EPERM', path: 'c:\\users\\anna\\appdata\\local\\programs\\mietfuchs\\resources\\app.asar' })
  // Aus der asar: Electrons Meldungen für fehlende und gesperrte Einträge
  assert.deepEqual(blockedFileIn(`Error: ENOENT, mietfuchs\\client\\dist.pack not found in ${ASAR}`, programDir, 'win32'), { code: 'ENOENT', path: `${ASAR}\\mietfuchs\\client\\dist.pack` })
  // Durchsicht: Electrons NO_ACCESS nennt in der Zeile nur den Eintrag im Archiv, den vollen Pfad erst im Objekt darunter
  const noAccess = `Error: EACCES: permission denied, access 'mietfuchs\\server\\server.mjs'\n    at x {\n  code: 'EACCES',\n  errno: -4092,\n  syscall: 'open',\n  path: '${ASAR.replaceAll('\\', '\\\\')}\\\\mietfuchs\\\\server\\\\server.mjs'\n}`
  assert.deepEqual(blockedFileIn(noAccess, programDir, 'win32'), { code: 'EACCES', path: `${ASAR}\\mietfuchs\\server\\server.mjs` })
  // Durchsicht: Kann der utilityProcess die asar selbst nicht öffnen, meldet Electron „Invalid package“ ohne Code
  assert.deepEqual(blockedFileIn(`Error: Invalid package ${ASAR}\n    at x`, programDir, 'win32'), { code: 'EPERM', path: ASAR })
  // Durchsicht: ein Apostroph im Benutzernamen; util.inspect setzt den Pfad dann in doppelte Anführungszeichen
  const obrien = "C:\\Users\\O'Brien\\AppData\\Local\\Programs\\mietfuchs"
  assert.deepEqual(blockedFileIn(`Error: EPERM: operation not permitted, open '${obrien}\\resources\\app.asar'\n  code: 'EPERM',\n  syscall: 'open',\n  path: "${obrien.replaceAll('\\', '\\\\')}\\\\resources\\\\app.asar"\n}`, obrien, 'win32'), { code: 'EPERM', path: `${obrien}\\resources\\app.asar` })
  assert.deepEqual(blockedFileIn(`Error: EPERM: operation not permitted, open '${obrien}\\resources\\app.asar'`, obrien, 'win32'), { code: 'EPERM', path: `${obrien}\\resources\\app.asar` })
  // Leerzeichen im Benutzernamen
  const spaced = 'C:\\Users\\Anna Maria\\AppData\\Local\\Programs\\mietfuchs'
  assert.deepEqual(blockedFileIn(`Error: ENOENT, mietfuchs\\client\\dist.pack not found in ${spaced}\\resources\\app.asar\n    at x`, spaced, 'win32'), { code: 'ENOENT', path: `${spaced}\\resources\\app.asar\\mietfuchs\\client\\dist.pack` })
  // Ein entferntes Bündel meldet der Lader von Node als fehlendes Modul
  assert.deepEqual(blockedFileIn(`Error [ERR_MODULE_NOT_FOUND]: Cannot find module '${ASAR}\\mietfuchs\\server\\server.mjs' imported from ${RESOURCES}\\`, programDir, 'win32'), { code: 'ENOENT', path: `${ASAR}\\mietfuchs\\server\\server.mjs` })
  // Auf dem Mac
  assert.deepEqual(blockedFileIn("Error: EPERM: operation not permitted, open '/Applications/Mietfuchs.app/Contents/Resources/app.asar'", '/Applications/Mietfuchs.app/Contents', 'darwin'), { code: 'EPERM', path: '/Applications/Mietfuchs.app/Contents/Resources/app.asar' })
  // Daten, Zwischenspeicher und alles außerhalb des Programmordners gehören nicht dazu
  assert.equal(blockedFileIn("Error: EPERM: operation not permitted, open 'C:\\Users\\Anna\\Mietfuchs\\mietfuchs.sqlite'", programDir, 'win32'), null)
  assert.equal(blockedFileIn("Error: EPERM: operation not permitted, open 'C:\\Users\\Anna\\AppData\\Local\\Programs\\mietfuchs-alt\\x.js'", programDir, 'win32'), null)
  assert.equal(blockedFileIn('Error: listen EADDRINUSE: address already in use 127.0.0.1:17517', programDir, 'win32'), null)
  assert.equal(blockedFileIn('', programDir, 'win32'), null)
})

test('Meldung: gesiezt, mit der Datei auf der Platte, die technische Meldung darunter', () => {
  const blocked = startFailure({ found: { code: 'EPERM', path: `${ASAR}\\mietfuchs\\server\\server.mjs` }, technical: 'Error: EPERM: operation not permitted', logDir: 'C:\\Users\\Anna\\AppData\\Local\\mietfuchs-fenster\\protokoll', platform: 'win32' })
  // Im Virenschutz steht die Datei auf der Platte, also die app.asar, nicht der Eintrag darin
  assert.equal(blocked.message, `Ein Virenschutzprogramm hat eine Datei von Mietfuchs blockiert:\n${ASAR}\n\nGeben Sie die Datei dort frei oder installieren Sie Mietfuchs neu.`)
  assert.equal(blocked.detail, 'Error: EPERM: operation not permitted\n\nDas Protokoll liegt unter C:\\Users\\Anna\\AppData\\Local\\mietfuchs-fenster\\protokoll.')
  const gone = startFailure({ found: { code: 'ENOENT', path: '/Applications/Mietfuchs.app/Contents/Resources/app.asar/mietfuchs/client/dist.pack' }, technical: 'x', logDir: '/p', platform: 'darwin' })
  assert.equal(gone.message, 'Eine Datei von Mietfuchs fehlt, vermutlich hat ein Virenschutzprogramm sie entfernt:\n/Applications/Mietfuchs.app/Contents/Resources/app.asar\n\nGeben Sie die Datei dort frei oder installieren Sie Mietfuchs neu.')
  // Ohne Befund bleibt es bei der technischen Meldung
  assert.deepEqual(startFailure({ found: null, technical: 'Der Server hat sich beim Start beendet (Code 1).', logDir: '/p', platform: 'linux' }), { message: 'Der Server hat sich beim Start beendet (Code 1).', detail: 'Das Protokoll liegt unter /p.' })
  // Eine sehr lange Zeile (Electron druckt bei manchen Fehlern seinen eigenen Quelltext) wird gekürzt
  const long = startFailure({ found: null, technical: `kurz\n${'x'.repeat(5000)}`, logDir: '/p', platform: 'linux' })
  assert.ok(long.message.length < 600, `${long.message.length} Zeichen`)
})

// Umzug der Daten (#517): „Ordner der alten Programmdatei wählen …“ öffnet den Ordner-Dialog des Systems. Die Seite
// bekommt nur einen Pfad oder nichts, nie das ganze Ergebnis des Dialogs.
test('Ordner wählen: ein gewählter Ordner oder nichts', () => {
  assert.equal(chosenFolder({ canceled: false, filePaths: ['C:\\Users\\Anna\\Downloads\\mietfuchs'] }), 'C:\\Users\\Anna\\Downloads\\mietfuchs')
  assert.equal(chosenFolder({ canceled: true, filePaths: ['/x'] }), null)
  assert.equal(chosenFolder({ canceled: false, filePaths: [] }), null)
  assert.equal(chosenFolder({ canceled: false, filePaths: [''] }), null)
})

// Durchsicht D10 zum Umzug (#517): Die Suche liest auf dem Mac Downloads, Schreibtisch und Dokumente; macOS fragt
// dafür je Ordner nach. Ohne eigenen Satz stünde dort nur, dass „Mietfuchs“ zugreifen möchte, ohne Grund.
test('macOS: ein Satz für die Rückfrage je Ordner, den die Suche liest', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const info = pkg.build?.mac?.extendInfo ?? {}
  for (const key of ['NSDownloadsFolderUsageDescription', 'NSDesktopFolderUsageDescription', 'NSDocumentsFolderUsageDescription']) {
    assert.match(String(info[key] ?? ''), /bisherigen Daten/, key)
  }
})

// Ergänzung zum Umzug (#517): Die echten Orte von Schreibtisch, Dokumente und Downloads (unter Windows oft im
// OneDrive-Ordner) nennt das Fenster dem Server, als JSON-Liste.
test('Umgebung: Suchorte des Umzugs aus dem Fenster, sonst keine Angabe', () => {
  const base = { port: 17517, network: false, packaged: true, windowsStore: false, repoRoot: '', platform: /** @type {NodeJS.Platform} */ ('win32') }
  const dirs = ['C:\\Users\\Anna\\OneDrive - Firma\\Schreibtisch', 'C:\\Users\\Anna\\Downloads']
  assert.deepEqual(JSON.parse(String(serverEnv({}, { ...base, searchDirs: dirs }).NKA_SEARCH_DIRS)), dirs)
  assert.equal(serverEnv({ NKA_SEARCH_DIRS: '["/geerbt"]' }, base).NKA_SEARCH_DIRS, undefined)
})

// Ergänzung zum Umzug (#517): Gewählt werden darf auch eine Datei (Programmdatei, mietfuchs.sqlite, db.json, Backup).
// Unter Windows zeigt ein Dialog nur Ordner oder nur Dateien; dort deshalb Dateien, alle Dateien erlaubt. Auf dem Mac
// beides.
test('Ordner wählen: auf dem Mac Ordner und Dateien, unter Windows Dateien', () => {
  assert.deepEqual(folderDialogProperties('darwin'), ['openDirectory', 'openFile'])
  assert.deepEqual(folderDialogProperties('win32'), ['openFile'])
})

// Anmeldung (#528): Das Fenster gilt über einen Schlüssel je Start als angemeldet. Er kommt immer vom Fenster selbst,
// eine geerbte Angabe gilt nie, und NKA_AUTH aus einer Shell schaltet ausgeliefert den Schutz nicht still ab.
test('Umgebung: Fensterschlüssel immer vom Fenster, NKA_AUTH nur mit den Schranken der Testgriffe', () => {
  const base = { NKA_WINDOW_KEY: 'geerbt', NKA_AUTH: 'off' }
  const opts = { port: 4000, network: true, packaged: true, windowsStore: false, repoRoot: '/repo', platform: /** @type {NodeJS.Platform} */ ('linux') }
  assert.equal(serverEnv(base, { ...opts, windowKey: 'frisch' }).NKA_WINDOW_KEY, 'frisch')
  assert.equal(serverEnv(base, opts).NKA_WINDOW_KEY, undefined)
  assert.equal(serverEnv(base, opts).NKA_AUTH, undefined)
  assert.equal(serverEnv({ ...base, CI: '1', MIETFUCHS_TESTGRIFFE: '1' }, opts).NKA_AUTH, 'off')
  assert.equal(serverEnv(base, { ...opts, packaged: false }).NKA_AUTH, 'off')
  // Ein Passwort aus der Umgebung legte im Fenster eines fest, das niemand dort gewählt hat
  const secret = { NKA_PASSWORD: 'ein Satz aus der Shell', NKA_PASSWORD_FILE: '/run/secrets/pw' }
  const packaged = serverEnv(secret, opts)
  assert.equal(packaged.NKA_PASSWORD, undefined)
  assert.equal(packaged.NKA_PASSWORD_FILE, undefined)
  assert.equal(serverEnv(secret, { ...opts, packaged: false }).NKA_PASSWORD, 'ein Satz aus der Shell')
  assert.equal(serverEnv({ ...secret, CI: '1', MIETFUCHS_TESTGRIFFE: '1' }, opts).NKA_PASSWORD_FILE, '/run/secrets/pw')
})

// Der Hauptprozess fragt den Server nur über serverFetch, das den Schlüssel mitschickt; ein anderes fetch an den eigenen
// Server bekäme mit Passwort 401 (readConsent, stopServer)
test('Fenster: Abrufe des Hauptprozesses am eigenen Server nur über serverFetch', () => {
  const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
  // jede Zeile mit fetch( und origin, in welcher Schreibweise auch immer, außer in serverFetch selbst
  const calls = main.split('\n').filter((line) => /\bfetch\(/.test(line) && /origin/.test(line))
  assert.deepEqual(calls.map((line) => line.trim()), ['return fetch(`${origin}${urlPath}`, { ...init, headers })'], 'nur serverFetch selbst ruft fetch mit origin')
  assert.match(main, /function serverFetch\(/)
  assert.match(main, /'X-Mietfuchs-Window'/)
  assert.match(main, /onBeforeSendHeaders\(\{ urls: \[`\$\{origin\}\/\*`\] \}/)
})

// fenster.json (#528, Schritt 2): Die Kopplung steht als `remote` darin, die Datei nur für den Benutzer lesbar. Eine
// kaputte oder unvollständige Kopplung ergibt keine (dann zeigt das Fenster wieder den eigenen Server).
test('Einstellungen: fenster.json lesen und schreiben, eine kaputte Kopplung gilt nicht', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-fenster-einstellungen-'))
  try {
    const file = path.join(dir, 'unter', 'fenster.json')
    assert.deepEqual(readSettingsFile(file), {})
    const remote = { origin: 'https://nas:3001', trust: /** @type {const} */ ('pinned'), certSha256: 'a'.repeat(64), deviceId: '0123456789abcdef', deviceKey: 'K'.repeat(43), version: '0.17.0' }
    writeSettingsFile(file, { port: 17517, network: true, remote })
    assert.deepEqual(readSettingsFile(file), { port: 17517, network: true, remote })
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600)
    // Auch eine schon vorhandene Datei mit weiteren Rechten wird beim Schreiben eng
    fs.chmodSync(file, 0o644)
    writeSettingsFile(file, { port: 17517 })
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600)
    assert.deepEqual(readSettingsFile(file), { port: 17517 })
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['fenster.json'])

    const broken = [
      'kein Objekt',
      null,
      { ...remote, origin: 'http://nas:3001' },
      { ...remote, origin: 'https://nas:3001/pfad' },
      { ...remote, origin: 'kaputt' },
      { ...remote, certSha256: 'A'.repeat(64) },
      { ...remote, certSha256: 'a'.repeat(63) },
      { ...remote, deviceId: '' },
      { ...remote, deviceId: 'ab.cd' },
      { ...remote, deviceKey: 'mit\r\nZeilenumbruch' },
      { ...remote, deviceKey: undefined },
      { ...remote, version: 17 },
    ]
    for (const value of broken) {
      fs.writeFileSync(file, JSON.stringify({ port: 4000, remote: value }))
      assert.deepEqual(readSettingsFile(file), { port: 4000 }, JSON.stringify(value))
    }
    fs.writeFileSync(file, '{ kaputt')
    assert.deepEqual(readSettingsFile(file), {})
    fs.writeFileSync(file, '[1, 2]')
    assert.deepEqual(readSettingsFile(file), {})
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Einstellungen: unter Windows ein kurz gesperrtes Umbenennen erneut versuchen, sonst nicht', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-fenster-umbenennen-'))
  try {
    const file = path.join(dir, 'fenster.json')
    const busy = (/** @type {string} */ code) => Object.assign(new Error(code), { code })
    /** @param {number} failures @param {string} code */
    const flaky = (failures, code) => {
      let calls = 0
      return { rename: (/** @type {string} */ from, /** @type {string} */ to) => { calls++; if (calls <= failures) throw busy(code); fs.renameSync(from, to) }, calls: () => calls }
    }
    /** @type {number[]} */
    const pauses = []
    const pause = (/** @type {number} */ ms) => { pauses.push(ms) }

    const twice = flaky(2, 'EPERM')
    writeSettingsFile(file, { port: 1 }, { platform: 'win32', rename: twice.rename, pause })
    assert.equal(twice.calls(), 3)
    assert.equal(pauses.length, 2)
    assert.deepEqual(readSettingsFile(file), { port: 1 })

    // Dreimal gesperrt: Fehler, die Zwischendatei bleibt nicht liegen, die alte Datei gilt weiter
    const always = flaky(9, 'EBUSY')
    assert.throws(() => writeSettingsFile(file, { port: 2 }, { platform: 'win32', rename: always.rename, pause }), /EBUSY/)
    assert.equal(always.calls(), 3)
    assert.deepEqual(fs.readdirSync(dir), ['fenster.json'])
    assert.deepEqual(readSettingsFile(file), { port: 1 })

    // Andere Fehler und andere Systeme: kein zweiter Versuch
    const other = flaky(1, 'ENOSPC')
    assert.throws(() => writeSettingsFile(file, { port: 3 }, { platform: 'win32', rename: other.rename, pause }), /ENOSPC/)
    assert.equal(other.calls(), 1)
    const linux = flaky(1, 'EPERM')
    assert.throws(() => writeSettingsFile(file, { port: 3 }, { platform: 'linux', rename: linux.rename, pause }), /EPERM/)
    assert.equal(linux.calls(), 1)
    assert.equal(pauses.length, 4)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// Durchsicht: Vor der Rückfrage zum Mietfuchs im Heimnetz zeigte das Fenster sich nur, wenn es verborgen war; ein ins
// Dock oder in die Taskleiste gelegtes Fenster blieb dort, und die Rückfrage (auf dem Mac ein Blatt am Fenster) sah
// niemand.
test('Fenster vor einer Rückfrage zeigen: zurückholen, wenn abgelegt, und sichtbar machen, wenn verborgen', () => {
  /** @param {{ minimized: boolean, visible: boolean }} state */
  const fake = (state) => {
    /** @type {string[]} */
    const calls = []
    return {
      calls,
      isMinimized: () => state.minimized,
      isVisible: () => state.visible,
      restore: () => { calls.push('restore'); state.minimized = false; state.visible = true },
      show: () => { calls.push('show'); state.visible = true },
    }
  }
  const minimized = fake({ minimized: true, visible: true })
  surfaceWindow(minimized)
  assert.deepEqual(minimized.calls, ['restore'])
  const hidden = fake({ minimized: false, visible: false })
  surfaceWindow(hidden)
  assert.deepEqual(hidden.calls, ['show'])
  // Unter Windows gilt ein abgelegtes Fenster nicht als sichtbar
  const both = fake({ minimized: true, visible: false })
  surfaceWindow(both)
  assert.deepEqual(both.calls, ['restore'])
  const shown = fake({ minimized: false, visible: true })
  surfaceWindow(shown)
  assert.deepEqual(shown.calls, [])
})

// Kopplung über einen Proxy (#528, Erweiterung): `trust` in fenster.json. Eine Kopplung von vorher (ohne `trust`) gilt
// als gepinnt und bleibt; `system` nie mit Fingerabdruck, `pinned` nie ohne.
test('Einstellungen: Vertrauensart der Kopplung, alte Form gilt als gepinnt', () => {
  const old = { origin: 'https://nas:3001', certSha256: 'a'.repeat(64), deviceId: '0123456789abcdef', deviceKey: 'K'.repeat(43), version: '0.17.0' }
  assert.deepEqual(remoteOf(old), { ...old, trust: 'pinned' })
  const system = { origin: 'https://nas.fritz.box', trust: 'system', certSha256: null, deviceId: '0123456789abcdef', deviceKey: 'K'.repeat(43), version: '0.17.0' }
  assert.deepEqual(remoteOf(system), system)
  assert.deepEqual(remoteOf({ ...old, trust: 'pinned' }), { ...old, trust: 'pinned' })
  assert.equal(remoteOf({ ...system, certSha256: 'a'.repeat(64) }), null)
  assert.equal(remoteOf({ ...old, trust: 'pinned', certSha256: null }), null)
  assert.equal(remoteOf({ ...old, certSha256: null }), null)
  assert.equal(remoteOf({ ...old, trust: 'egal' }), null)
  assert.equal(remoteOf({ ...system, origin: 'http://nas.fritz.box' }), null)

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-fenster-einstellungen-'))
  try {
    const file = path.join(dir, 'fenster.json')
    fs.writeFileSync(file, JSON.stringify({ port: 17517, network: true, remote: old }))
    assert.deepEqual(readSettingsFile(file), { port: 17517, network: true, remote: { ...old, trust: 'pinned' } })
    writeSettingsFile(file, { remote: /** @type {any} */ (system) })
    assert.deepEqual(readSettingsFile(file), { remote: system })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})


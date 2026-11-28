// Womit sich Mietfuchs beim Start öffnet (#735): Standardbrowser, ein gefundener Browser aus den Einstellungen oder
// die Umgebungsvariable BROWSER. Alles mit hineingereichter Plattform und nachgestelltem Dateisystem; kein Test
// startet einen Browser.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { acceptOpenWith, browserPlan, findBrowsers, launchBrowser, usableBrowserEnv, type BrowserProbe } from '../src/browser.ts'
import { asBrowserId } from '../../shared/browsers.ts'

const URL_ = 'http://127.0.0.1:3001/'

function probe(platform: NodeJS.Platform, { files = [], dirs = [], env = {}, home = '/home/erika' }: { files?: string[], dirs?: string[], env?: NodeJS.ProcessEnv, home?: string | null } = {}): BrowserProbe {
  return { platform, env, home: () => home, isFile: (p) => files.includes(p), isDir: (p) => dirs.includes(p) }
}

test('Linux: Browser im PATH in fester Reihenfolge, ein relativer Eintrag im PATH zählt nicht', () => {
  const p = probe('linux', { env: { PATH: '/usr/local/bin:/usr/bin::bin' }, files: ['/usr/bin/chromium-browser', '/usr/bin/firefox', 'bin/brave-browser'] })
  assert.deepEqual(findBrowsers(p).map((b) => [b.id, b.label, b.path]), [
    ['firefox', 'Firefox', '/usr/bin/firefox'],
    ['chromium', 'Chromium', '/usr/bin/chromium-browser'],
  ])
})

test('Linux: auch Snap und Flatpak, wenn ihr Ordner nicht im PATH steht', () => {
  const p = probe('linux', { env: { PATH: '/usr/bin' }, files: ['/snap/bin/firefox', '/home/erika/.local/share/flatpak/exports/bin/com.google.Chrome', '/var/lib/flatpak/exports/bin/com.brave.Browser'] })
  assert.deepEqual(findBrowsers(p).map((b) => [b.id, b.path]), [
    ['firefox', '/snap/bin/firefox'],
    ['chrome', '/home/erika/.local/share/flatpak/exports/bin/com.google.Chrome'],
    ['brave', '/var/lib/flatpak/exports/bin/com.brave.Browser'],
  ])
  // Ohne Heimatordner (Container mit --user) fällt nur der eigene Flatpak-Ordner weg
  assert.deepEqual(findBrowsers(probe('linux', { env: {}, home: null, files: ['/snap/bin/firefox'] })).map((b) => b.id), ['firefox'])
})

test('macOS: Programme in /Applications und ~/Applications, geöffnet mit open -a', () => {
  const p = probe('darwin', { dirs: ['/Applications/Google Chrome.app', '/Users/erika/Applications/Firefox.app'], home: '/Users/erika' })
  assert.deepEqual(findBrowsers(p).map((b) => [b.id, b.path]), [['firefox', '/Users/erika/Applications/Firefox.app'], ['chrome', '/Applications/Google Chrome.app']])
  assert.deepEqual(browserPlan({ choice: 'chrome', url: URL_, probe: p }), { cmd: 'open', args: ['-a', '/Applications/Google Chrome.app', URL_], source: 'setting', notes: [] })
})

test('Windows: Programme unter Program Files und im lokalen Anwendungsordner', () => {
  const env = { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\Erika\\AppData\\Local' }
  const p = probe('win32', { env, files: ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Users\\Erika\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'] })
  assert.deepEqual(findBrowsers(p).map((b) => [b.id, b.path]), [
    ['chrome', 'C:\\Users\\Erika\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'],
    ['edge', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'],
  ])
  assert.deepEqual(browserPlan({ choice: 'edge', url: URL_, probe: p }), { cmd: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', args: [URL_], source: 'setting', notes: [] })
  // Ein Ordner aus der Umgebung, der nicht absolut ist, wird nicht durchsucht
  assert.deepEqual(findBrowsers(probe('win32', { env: { ProgramFiles: 'Tools' }, files: ['Tools\\Mozilla Firefox\\firefox.exe'] })), [])
})

test('ohne Wahl und ohne BROWSER: der Standardbrowser wie bisher', () => {
  assert.deepEqual(browserPlan({ choice: null, url: URL_, probe: probe('linux') }), { cmd: 'xdg-open', args: [URL_], source: 'default', notes: [] })
  assert.deepEqual(browserPlan({ choice: null, url: URL_, probe: probe('darwin') }), { cmd: 'open', args: [URL_], source: 'default', notes: [] })
  assert.deepEqual(browserPlan({ choice: null, url: URL_, probe: probe('win32') }), { cmd: 'cmd', args: ['/c', 'start', '""', URL_], source: 'default', notes: [] })
})

test('Vorrang: Einstellung vor BROWSER vor Standardbrowser', () => {
  const files = ['/usr/bin/firefox', '/usr/bin/chromium']
  const both = probe('linux', { env: { PATH: '/usr/bin', BROWSER: 'chromium' }, files })
  assert.deepEqual(browserPlan({ choice: 'firefox', url: URL_, probe: both }), { cmd: '/usr/bin/firefox', args: [URL_], source: 'setting', notes: [] })
  assert.deepEqual(browserPlan({ choice: null, url: URL_, probe: both }), { cmd: '/usr/bin/chromium', args: [URL_], source: 'env', notes: [] })
})

test('gewählter Browser nicht mehr da: weiter mit BROWSER oder dem Standardbrowser, mit Satz für die Konsole', () => {
  const plan = browserPlan({ choice: 'brave', url: URL_, probe: probe('linux', { env: { PATH: '/usr/bin' }, files: ['/usr/bin/firefox'] }) })
  assert.equal(plan.cmd, 'xdg-open')
  assert.equal(plan.source, 'default')
  assert.deepEqual(plan.notes, ['Den in den Einstellungen gewählten Browser (Brave) findet Mietfuchs auf diesem Rechner nicht mehr. Mietfuchs öffnet sich im Standardbrowser.'])
  const withEnv = browserPlan({ choice: 'brave', url: URL_, probe: probe('linux', { env: { PATH: '/usr/bin', BROWSER: 'firefox' }, files: ['/usr/bin/firefox'] }) })
  assert.deepEqual([withEnv.cmd, withEnv.source], ['/usr/bin/firefox', 'env'])
  assert.match(withEnv.notes.join(' '), /Brave.*BROWSER/)
})

test('BROWSER: mehrere Einträge mit „:“, der erste vorhandene gilt; keiner vorhanden: Standardbrowser mit Satz', () => {
  const p = probe('linux', { env: { PATH: '/usr/bin', BROWSER: 'gibtsnicht:/opt/fehlt/browser:firefox' }, files: ['/usr/bin/firefox'] })
  assert.deepEqual(browserPlan({ choice: null, url: URL_, probe: p }), { cmd: '/usr/bin/firefox', args: [URL_], source: 'env', notes: [] })
  const none = browserPlan({ choice: null, url: URL_, probe: probe('linux', { env: { PATH: '/usr/bin', BROWSER: 'gibtsnicht' } }) })
  assert.deepEqual([none.cmd, none.source], ['xdg-open', 'default'])
  assert.deepEqual(none.notes, ['Die Umgebungsvariable BROWSER nennt kein Programm, das Mietfuchs auf diesem Rechner findet (gibtsnicht). Mietfuchs öffnet sich im Standardbrowser.'])
  // Leer oder nur Trenner: wie nicht gesetzt, ohne Satz
  assert.deepEqual(browserPlan({ choice: null, url: URL_, probe: probe('linux', { env: { BROWSER: ' : ' } }) }).notes, [])
})

test('BROWSER mit %s: Platzhalter für die Adresse, %% für ein Prozentzeichen, Anführungszeichen halten Leerzeichen', () => {
  const p = probe('linux', { env: { PATH: '/usr/bin', BROWSER: 'firefox --new-window %s' }, files: ['/usr/bin/firefox', '/opt/Mein Browser/b'] })
  assert.deepEqual(browserPlan({ choice: null, url: URL_, probe: p }), { cmd: '/usr/bin/firefox', args: ['--new-window', URL_], source: 'env', notes: [] })
  const quoted = probe('linux', { env: { BROWSER: '"/opt/Mein Browser/b" --x=100%% \'%s\'' }, files: ['/opt/Mein Browser/b'] })
  assert.deepEqual(browserPlan({ choice: null, url: URL_, probe: quoted }), { cmd: '/opt/Mein Browser/b', args: ['--x=100%', URL_], source: 'env', notes: [] })
  // Ohne %s ist der ganze Eintrag das Programm (auch mit Leerzeichen im Pfad), die Adresse kommt dahinter
  const plain = probe('linux', { env: { BROWSER: '/opt/Mein Browser/b' }, files: ['/opt/Mein Browser/b'] })
  assert.deepEqual(browserPlan({ choice: null, url: URL_, probe: plain }), { cmd: '/opt/Mein Browser/b', args: [URL_], source: 'env', notes: [] })
})

test('BROWSER unter Windows: Einträge mit „;“ getrennt, ein Name auch mit .exe im PATH', () => {
  const env = { Path: 'C:\\Windows;C:\\Tools', BROWSER: 'C:\\fehlt\\x.exe;waterfox' }
  // process.env ist unter Windows unempfindlich gegen Groß- und Kleinschreibung; hier steht deshalb PATH daneben
  const p = probe('win32', { env: { ...env, PATH: env.Path }, files: ['C:\\Tools\\waterfox.exe'] })
  assert.deepEqual(browserPlan({ choice: null, url: URL_, probe: p }), { cmd: 'C:\\Tools\\waterfox.exe', args: [URL_], source: 'env', notes: [] })
})

test('BROWSER: ein relativer Pfad mit Ordner wird nicht gestartet (kein Programm aus dem Arbeitsordner)', () => {
  const p = probe('linux', { env: { PATH: '/usr/bin', BROWSER: './browser' }, files: ['./browser'] })
  assert.equal(browserPlan({ choice: null, url: URL_, probe: p }).source, 'default')
})

test('die Adresse bleibt ein einziges Argument, auch mit Zeichen, die eine Shell deuten würde', () => {
  const url = 'http://127.0.0.1:3001/?a=1&b=$(touch x);rm'
  const p = probe('linux', { env: { PATH: '/usr/bin' }, files: ['/usr/bin/firefox'] })
  assert.deepEqual(browserPlan({ choice: 'firefox', url, probe: p }).args, [url])
  const env = probe('linux', { env: { PATH: '/usr/bin', BROWSER: 'firefox %s' }, files: ['/usr/bin/firefox'] })
  assert.deepEqual(browserPlan({ choice: null, url, probe: env }).args, [url])
})

test('nur bekannte Kennungen gelten als Wahl, nie ein Pfad oder Befehl', () => {
  assert.equal(asBrowserId('firefox'), 'firefox')
  assert.equal(asBrowserId('edge'), 'edge')
  for (const value of ['/bin/sh', 'firefox; rm -rf ~', 'Firefox', '__proto__', 'toString', '', null, undefined, 3, {}]) assert.equal(asBrowserId(value), null, String(value))
})

// PUT /api/settings (#735): nur der Standardbrowser oder ein hier gefundener Browser, als Kennung
test('Wahl über die Schnittstelle: Standardbrowser, gefundene Kennung oder unverändert, sonst eine Meldung', () => {
  const found = ['firefox', 'chromium'] as const
  assert.deepEqual(acceptOpenWith(null, { stored: 'firefox', found }), { value: null })
  assert.deepEqual(acceptOpenWith('', { stored: 'firefox', found }), { value: null })
  assert.deepEqual(acceptOpenWith('chromium', { stored: null, found }), { value: 'chromium' })
  // Inzwischen deinstalliert, aber unverändert mitgeschickt: Das Speichern der übrigen Einstellungen scheitert nicht daran
  assert.deepEqual(acceptOpenWith('brave', { stored: 'brave', found }), { value: 'brave' })
  assert.match(errorText(acceptOpenWith('brave', { stored: null, found })), /Brave findet Mietfuchs auf diesem Rechner nicht/)
  for (const value of ['/usr/bin/firefox', 'firefox --remote-debugging-port=9222', 'xdg-open', 7, true, {}]) {
    assert.match(errorText(acceptOpenWith(value, { stored: null, found })), /Unbekannter Browser/, String(value))
  }
  // Wo Mietfuchs beim Start keinen Browser öffnet, gibt es nichts zu wählen
  assert.match(errorText(acceptOpenWith('firefox', { stored: null, found: null })), /keinen Browser/)
  assert.deepEqual(acceptOpenWith(null, { stored: null, found: null }), { value: null })
})

function errorText(result: ReturnType<typeof acceptOpenWith>): string {
  return 'error' in result ? result.error : assert.fail(`angenommen: ${JSON.stringify(result)}`)
}

// Durchsicht K1: Scheitert der Start eines gewählten Browsers sofort (spawn wirft, etwa EINVAL für .cmd/.bat unter
// Windows) oder später (Ereignis `error`), öffnet sich Mietfuchs im Standardbrowser, mit Satz. Der Standardbrowser
// selbst fällt nicht weiter zurück.
test('Start scheitert: sofort oder später, Rückfall auf den Standardbrowser mit Satz', () => {
  const started: string[] = []
  const said: string[] = []
  const failing = new Set(['/opt/b/browser'])
  const listeners: (() => void)[] = []
  const spawnSync = (cmd: string) => {
    started.push(cmd)
    if (failing.has(cmd)) throw new Error('EINVAL')
    return { on: (_: 'error', fn: () => void) => { listeners.push(fn) }, unref: () => {} }
  }
  launchBrowser({ cmd: '/opt/b/browser', args: [URL_] }, { url: URL_, platform: 'linux', fallBack: true, spawn: spawnSync, log: (l) => said.push(l) })
  assert.deepEqual(started, ['/opt/b/browser', 'xdg-open'])
  assert.deepEqual(said, ['/opt/b/browser ließ sich nicht starten. Mietfuchs öffnet sich im Standardbrowser.'])

  started.length = 0
  said.length = 0
  listeners.length = 0
  launchBrowser({ cmd: '/usr/bin/firefox', args: [URL_] }, { url: URL_, platform: 'linux', fallBack: true, spawn: spawnSync, log: (l) => said.push(l) })
  listeners[0]?.()
  assert.deepEqual(started, ['/usr/bin/firefox', 'xdg-open'])
  // Auch der Standardbrowser fehlt: ein Satz, kein weiterer Versuch
  listeners[1]?.()
  assert.deepEqual(started, ['/usr/bin/firefox', 'xdg-open'])
  assert.match(said.at(-1) ?? '', /Kein Browser gestartet \(xdg-open nicht verfügbar\)/)
})

test('BROWSER unter Windows: nur .exe-Programme, keine .cmd oder .bat', () => {
  const p = probe('win32', { env: { PATH: 'C:\\Tools', BROWSER: 'C:\\Tools\\start.cmd;C:\\Tools\\b.bat;starter' }, files: ['C:\\Tools\\start.cmd', 'C:\\Tools\\b.bat', 'C:\\Tools\\starter.cmd'] })
  assert.equal(browserPlan({ choice: null, url: URL_, probe: p }).source, 'default')
  const exe = probe('win32', { env: { PATH: 'C:\\Tools', BROWSER: 'C:\\Tools\\b.EXE' }, files: ['C:\\Tools\\b.EXE'] })
  assert.equal(browserPlan({ choice: null, url: URL_, probe: exe }).cmd, 'C:\\Tools\\b.EXE')
})

test('Linux: auch /var/lib/snapd/snap/bin (Fedora, Arch)', () => {
  assert.deepEqual(findBrowsers(probe('linux', { env: {}, files: ['/var/lib/snapd/snap/bin/chromium'] })).map((b) => b.path), ['/var/lib/snapd/snap/bin/chromium'])
})

// Durchsicht K4: Ob BROWSER etwas nennt, das Mietfuchs findet; nur dann heißt der Standard in der Karte danach
test('BROWSER nennt etwas Auffindbares oder nicht', () => {
  assert.equal(usableBrowserEnv(probe('linux', { env: { PATH: '/usr/bin', BROWSER: 'firefox' }, files: ['/usr/bin/firefox'] })), true)
  assert.equal(usableBrowserEnv(probe('linux', { env: { PATH: '/usr/bin', BROWSER: 'gibtsnicht' } })), false)
  assert.equal(usableBrowserEnv(probe('linux', { env: {} })), false)
})

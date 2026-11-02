// Automatische Updates im Programmfenster (#517), ohne Electron und ohne electron-updater geprüft: wann es sie gibt,
// woher sie kommen, wann geprüft wird, was die Oberfläche sieht und in welcher Reihenfolge installiert wird.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { CHECK_INTERVAL_MS, ERROR_PAUSE_MS, FORCE_PAUSE_MS, UPDATE_REPO, createUpdaterController, describeUpdaterError, initialUpdaterState, reduceUpdater, shouldCheck, shouldOfferMove, updaterSource } from '../src/updater.js'

const win = { platform: /** @type {NodeJS.Platform} */ ('win32'), packaged: true, windowsStore: false, env: {} }

test('Quelle: nur das installierte Fenster unter Windows, aus den Releases von speedone/mietfuchs', () => {
  assert.deepEqual(updaterSource(win), { kind: 'github' })
  assert.deepEqual(UPDATE_REPO, { provider: 'github', owner: 'speedone', repo: 'mietfuchs', releaseType: 'release' })
  // Der Store aktualisiert selbst, der Mac bräuchte eine bezahlte Signatur, beim Entwickeln gibt es nichts zu ersetzen
  assert.deepEqual(updaterSource({ ...win, windowsStore: true }), { kind: 'off', reason: 'store' })
  assert.deepEqual(updaterSource({ ...win, platform: 'darwin' }), { kind: 'off', reason: 'mac' })
  assert.deepEqual(updaterSource({ ...win, platform: 'linux' }), { kind: 'off', reason: 'platform' })
  assert.deepEqual(updaterSource({ ...win, packaged: false }), { kind: 'off', reason: 'dev' })
})

// Der Schalter für eine andere Quelle gilt nur in Prüfungen (CI) und nur für einen Server auf diesem Rechner. Im
// ausgelieferten Betrieb lenkte eine untergeschobene Variable sonst die Updates auf einen fremden Server, und die
// Prüfsumme käme von demselben Server.
test('Quelle: eine andere nur mit CI und nur auf 127.0.0.1', () => {
  const feed = 'http://127.0.0.1:8123/'
  assert.deepEqual(updaterSource({ ...win, env: { MIETFUCHS_UPDATE_FEED: feed } }), { kind: 'github' })
  assert.deepEqual(updaterSource({ ...win, env: { CI: '1', MIETFUCHS_UPDATE_FEED: feed } }), { kind: 'feed', url: feed })
  assert.deepEqual(updaterSource({ ...win, env: { CI: '1', MIETFUCHS_UPDATE_FEED: 'https://example.org/' } }), { kind: 'github' })
  assert.deepEqual(updaterSource({ ...win, env: { CI: '1', MIETFUCHS_UPDATE_FEED: 'kein Link' } }), { kind: 'github' })
  // Auch beim Entwickeln und unter Linux, für Bildschirmfotos des Hinweises; aus dem Store nie
  assert.deepEqual(updaterSource({ ...win, platform: 'linux', packaged: false, env: { CI: '1', MIETFUCHS_UPDATE_FEED: feed } }), { kind: 'feed', url: feed })
  assert.deepEqual(updaterSource({ ...win, windowsStore: true, env: { CI: '1', MIETFUCHS_UPDATE_FEED: feed } }), { kind: 'off', reason: 'store' })
})

test('Wann geprüft wird: nur mit Zustimmung, beim Start und danach höchstens einmal am Tag', () => {
  const idle = initialUpdaterState('github', '0.14.1')
  const now = 1_000_000_000_000
  assert.equal(shouldCheck({ consent: 'on', state: idle, lastCheckAt: null, now }), true)
  for (const consent of [undefined, 'off', 'ON', true, 'yes']) {
    assert.equal(shouldCheck({ consent, state: idle, lastCheckAt: null, now }), false, String(consent))
    assert.equal(shouldCheck({ consent, state: idle, lastCheckAt: null, now, force: true }), false, `${consent} mit Knopf`)
  }
  assert.equal(shouldCheck({ consent: 'on', state: idle, lastCheckAt: now - CHECK_INTERVAL_MS + 1, now }), false)
  assert.equal(shouldCheck({ consent: 'on', state: idle, lastCheckAt: now - CHECK_INTERVAL_MS, now }), true)
  // „Jetzt prüfen“ höchstens einmal pro Minute
  assert.equal(shouldCheck({ consent: 'on', state: idle, lastCheckAt: now - FORCE_PAUSE_MS + 1, now, force: true }), false)
  assert.equal(shouldCheck({ consent: 'on', state: idle, lastCheckAt: now - FORCE_PAUSE_MS, now, force: true }), true)
  // Nach einem Fehler eine Stunde Pause statt eines Tages
  const failed = reduceUpdater(idle, { type: 'error', message: 'GitHub ist nicht erreichbar.' })
  assert.equal(shouldCheck({ consent: 'on', state: failed, lastCheckAt: now - ERROR_PAUSE_MS + 1, now }), false)
  assert.equal(shouldCheck({ consent: 'on', state: failed, lastCheckAt: now - ERROR_PAUSE_MS, now }), true)
  // Läuft schon etwas oder liegt die neue Version bereit, fragt niemand nochmal
  for (const event of [{ type: 'checking' }, { type: 'progress', version: '0.15.0', percent: 3 }, { type: 'downloaded', version: '0.15.0' }]) {
    const busy = reduceUpdater(idle, /** @type {any} */ (event))
    assert.equal(shouldCheck({ consent: 'on', state: busy, lastCheckAt: null, now, force: true }), false, event.type)
  }
  // Ohne Updater nie
  assert.equal(shouldCheck({ consent: 'on', state: initialUpdaterState('off', '0.14.1'), lastCheckAt: null, now }), false)
})

test('Stand für die Oberfläche: prüfen, herunterladen, bereit, Fehler', () => {
  let s = initialUpdaterState('github', '0.14.1')
  assert.deepEqual(s, { phase: 'idle', current: '0.14.1', version: null, percent: null, choice: null, error: null, checkedAt: null })
  s = reduceUpdater(s, { type: 'checking', at: '2026-11-02T08:00:00.000Z' })
  assert.equal(s.phase, 'checking')
  assert.equal(s.checkedAt, '2026-11-02T08:00:00.000Z')
  assert.equal(reduceUpdater(s, { type: 'none' }).phase, 'latest')
  s = reduceUpdater(s, { type: 'available', version: '0.15.0' })
  assert.deepEqual([s.phase, s.version, s.percent], ['downloading', '0.15.0', 0])
  s = reduceUpdater(s, { type: 'progress', percent: 41.6 })
  assert.equal(s.percent, 42)
  s = reduceUpdater(s, { type: 'downloaded', version: '0.15.0' })
  assert.deepEqual([s.phase, s.version, s.percent, s.choice], ['ready', '0.15.0', 100, null])
  s = reduceUpdater(s, { type: 'later' })
  assert.equal(s.choice, 'later')
  // Ein Fehler beim Herunterladen vergisst die Version nicht, die bereitliegende bleibt bereit
  const failed = reduceUpdater(reduceUpdater(initialUpdaterState('github', '0.14.1'), { type: 'available', version: '0.15.0' }), { type: 'error', message: 'kaputt' })
  assert.deepEqual([failed.phase, failed.version, failed.error], ['error', '0.15.0', 'kaputt'])
  assert.equal(reduceUpdater(s, { type: 'error', message: 'später' }).phase, 'ready')
  // „Beim nächsten Start“ gibt es nur für eine bereitliegende Version
  assert.equal(reduceUpdater(initialUpdaterState('github', '0.14.1'), { type: 'later' }).choice, null)
  assert.equal(initialUpdaterState('off', '0.14.1').phase, 'off')
})

test('Fehler gesiezt und verständlich, ohne Stapel', () => {
  assert.match(describeUpdaterError(Object.assign(new Error('sha512 checksum mismatch, expected a, got b'), { code: 'ERR_CHECKSUM_MISMATCH' })), /Prüfsumme/)
  assert.equal(describeUpdaterError(new Error('net::ERR_INTERNET_DISCONNECTED')), 'GitHub ist nicht erreichbar.')
  assert.equal(describeUpdaterError(Object.assign(new Error('getaddrinfo ENOTFOUND github.com'), { code: 'ENOTFOUND' })), 'GitHub ist nicht erreichbar.')
  assert.match(describeUpdaterError(Object.assign(new Error('Cannot find latest.yml in the latest release artifacts'), { code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' })), /noch nicht vollständig/)
  assert.match(describeUpdaterError(new Error('irgendwas\n    at Foo (bar.js:1:1)')), /^Die Aktualisierung ist fehlgeschlagen: irgendwas$/)
  assert.equal(describeUpdaterError('kein Fehlerobjekt'), 'Die Aktualisierung ist fehlgeschlagen: kein Fehlerobjekt')
})

test('Mac: einmal anbieten, Mietfuchs nach „Programme“ zu verschieben, „Nein“ gilt für immer', () => {
  const mac = { platform: /** @type {NodeJS.Platform} */ ('darwin'), packaged: true, inApplications: false, declined: false, ci: false }
  assert.equal(shouldOfferMove(mac), true)
  assert.equal(shouldOfferMove({ ...mac, inApplications: true }), false)
  assert.equal(shouldOfferMove({ ...mac, declined: true }), false)
  assert.equal(shouldOfferMove({ ...mac, platform: 'win32' }), false)
  assert.equal(shouldOfferMove({ ...mac, packaged: false }), false)
  // Eine Prüfung startet das Programm aus einem eigenen Ordner, eine Rückfrage hielte sie an
  assert.equal(shouldOfferMove({ ...mac, ci: true }), false)
})

// Ein nachgestelltes electron-updater: Ereignisse wie das echte, `install` merkt sich den Aufruf.
function fakeUpdater() {
  const updater = Object.assign(new EventEmitter(), {
    checks: 0,
    /** @type {Array<[boolean, boolean]>} */
    installs: [],
    installResult: true,
    autoDownload: true,
    disableWebInstaller: false,
    autoInstallOnAppQuit: true,
    allowPrerelease: true,
    allowDowngrade: true,
    async checkForUpdates() {
      updater.checks++
      updater.emit('checking-for-update')
      return null
    },
    /** @param {boolean} [silent] @param {boolean} [runAfter] */
    install(silent = false, runAfter = false) {
      updater.installs.push([silent, runAfter])
      return updater.installResult
    },
  })
  return updater
}

/** @param {{ consent?: unknown, now?: () => number }} [options] */
function controller(options = {}) {
  // Ausdrücklich ohne Zustimmung (`consent: undefined`) ist etwas anderes als keine Angabe
  const consent = 'consent' in options ? options.consent : 'on'
  const now = options.now ?? (() => 1_000_000_000_000)
  const updater = fakeUpdater()
  /** @type {string[]} */
  const order = []
  /** @type {any[]} */
  const states = []
  const c = createUpdaterController({
    updater,
    source: 'github',
    current: '0.14.1',
    readConsent: async () => { order.push('zustimmung'); return consent },
    stopServer: async () => { order.push('server beendet') },
    resumeServer: async () => { order.push('server wieder gestartet') },
    quit: () => { order.push('beenden') },
    now,
    onState: (s) => states.push(s),
  })
  return { c, updater, order, states }
}

test('Steuerung: electron-updater fest eingestellt, nie Vorabversionen, nie von selbst installieren', () => {
  const { updater } = controller()
  assert.equal(updater.autoDownload, true)
  assert.equal(updater.disableWebInstaller, true)
  // „Beim nächsten Start“ installiert die Steuerung selbst, nach dem Beenden des Servers (installOnQuit)
  assert.equal(updater.autoInstallOnAppQuit, false)
  assert.equal(updater.allowPrerelease, false)
  assert.equal(updater.allowDowngrade, false)
})

test('Steuerung: ohne Zustimmung keine Anfrage, auch nicht auf Knopfdruck', async () => {
  for (const consent of [undefined, 'off']) {
    const { c, updater } = controller({ consent })
    await c.tick()
    await c.check({ force: true })
    assert.equal(updater.checks, 0, String(consent))
    assert.equal(c.state().phase, 'idle')
  }
})

test('Steuerung: mit Zustimmung beim Start, dann erst nach einem Tag wieder', async () => {
  let t = 1_000_000_000_000
  const { c, updater } = controller({ now: () => t })
  await c.tick()
  assert.equal(updater.checks, 1)
  updater.emit('update-not-available', { version: '0.14.1' })
  t += CHECK_INTERVAL_MS - 1
  await c.tick()
  assert.equal(updater.checks, 1)
  t += 1
  await c.tick()
  assert.equal(updater.checks, 2)
})

test('Steuerung: herunterladen, bereit, Stand an die Oberfläche', async () => {
  const { c, updater, states } = controller()
  await c.tick()
  updater.emit('update-available', { version: '0.15.0' })
  updater.emit('download-progress', { percent: 50 })
  updater.emit('update-downloaded', { version: '0.15.0' })
  assert.deepEqual(states.map((s) => s.phase), ['checking', 'downloading', 'downloading', 'ready'])
  assert.equal(c.state().version, '0.15.0')
  updater.emit('error', new Error('net::ERR_CONNECTION_RESET'))
  assert.equal(c.state().phase, 'ready')
})

test('„Jetzt neu starten“: erst den Server beenden, dann still installieren und danach starten', async () => {
  const { c, updater, order } = controller()
  await c.tick()
  updater.emit('update-downloaded', { version: '0.15.0' })
  order.length = 0
  await c.restartNow()
  assert.deepEqual(order, ['server beendet', 'beenden'])
  assert.deepEqual(updater.installs, [[true, true]])
})

test('„Jetzt neu starten“: geht das Installieren nicht los, läuft der Server weiter', async () => {
  const { c, updater, order } = controller()
  await c.tick()
  updater.emit('update-downloaded', { version: '0.15.0' })
  updater.installResult = false
  order.length = 0
  await assert.rejects(c.restartNow(), /ließ sich nicht starten/)
  assert.deepEqual(order, ['server beendet', 'server wieder gestartet'])
})

test('„Jetzt neu starten“ ohne bereitliegende Version tut nichts', async () => {
  const { c, updater, order } = controller()
  order.length = 0
  await assert.rejects(c.restartNow(), /keine neue Version bereit/)
  assert.deepEqual(order, [])
  assert.deepEqual(updater.installs, [])
})

test('„Beim nächsten Start“: installiert beim Beenden, still und ohne Start; ohne Wahl nicht', async () => {
  const { c, updater } = controller()
  await c.tick()
  updater.emit('update-downloaded', { version: '0.15.0' })
  // Ohne Wahl bleibt die Version liegen; der Hinweis kommt beim nächsten Start wieder
  assert.equal(c.installOnQuit(), false)
  assert.deepEqual(updater.installs, [])
  c.later()
  assert.equal(c.state().choice, 'later')
  assert.equal(c.installOnQuit(), true)
  assert.deepEqual(updater.installs, [[true, false]])
})

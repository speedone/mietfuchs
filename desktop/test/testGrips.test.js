// Testgriffe im ausgelieferten Fenster (#517, Durchsicht Daten und Sicherheit): Ein global gesetztes CI allein öffnet
// sie nicht mehr, und die Umgebung des Fensters gibt Testgriffe und Schalter ohne Schranke nicht an den Server weiter.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loopbackUrl, testGripsAllowed } from '../src/testGrips.js'
import { DEFAULT_PORT, quitDecision, serverEnv, startFailure, twinIn, rememberDataDir } from '../src/server.js'
import { shouldOfferMove, updaterSource } from '../src/updater.js'

test('Testgriffe: nur mit CI (1 oder true) und MIETFUCHS_TESTGRIFFE=1', () => {
  assert.equal(testGripsAllowed({ CI: '1', MIETFUCHS_TESTGRIFFE: '1' }), true)
  assert.equal(testGripsAllowed({ CI: 'true', MIETFUCHS_TESTGRIFFE: '1' }), true)
  assert.equal(testGripsAllowed({ CI: '1' }), false)
  assert.equal(testGripsAllowed({ CI: 'false', MIETFUCHS_TESTGRIFFE: '1' }), false)
  assert.equal(testGripsAllowed({ MIETFUCHS_TESTGRIFFE: '1' }), false)
})

test('Testgriffe: Adressen nur auf 127.0.0.1 oder ::1 über http', () => {
  assert.equal(loopbackUrl('http://127.0.0.1:4100/'), 'http://127.0.0.1:4100/')
  assert.equal(loopbackUrl('http://[::1]:4100'), 'http://[::1]:4100')
  assert.equal(loopbackUrl('http://localhost:4100'), null)
  assert.equal(loopbackUrl('https://127.0.0.1:4100'), null)
  assert.equal(loopbackUrl('http://127.0.0.1.example.org/'), null)
  assert.equal(loopbackUrl('http://192.168.1.2:3001'), null)
  assert.equal(loopbackUrl(undefined), null)
  assert.equal(loopbackUrl('kein Link'), null)
})

test('Updates: eine andere Quelle nur mit beiden Schranken, CI allein genügt nicht mehr', () => {
  const win = { platform: /** @type {NodeJS.Platform} */ ('win32'), packaged: true, windowsStore: false }
  const feed = 'http://127.0.0.1:4100/'
  assert.deepEqual(updaterSource({ ...win, env: { CI: '1', MIETFUCHS_UPDATE_FEED: feed } }), { kind: 'github' })
  assert.deepEqual(updaterSource({ ...win, env: { CI: '1', MIETFUCHS_TESTGRIFFE: '1', MIETFUCHS_UPDATE_FEED: feed } }), { kind: 'feed', url: feed })
  assert.deepEqual(updaterSource({ ...win, env: { CI: '1', MIETFUCHS_TESTGRIFFE: '1', MIETFUCHS_UPDATE_FEED: 'http://[::1]:4100/' } }), { kind: 'feed', url: 'http://[::1]:4100/' })
})

test('Mac: ein beliebig gesetztes CI schaltet das Angebot, nach „Programme“ zu verschieben, nicht ab', () => {
  const mac = { platform: /** @type {NodeJS.Platform} */ ('darwin'), packaged: true, inApplications: false, declined: false }
  assert.equal(shouldOfferMove({ ...mac, env: { CI: 'false' } }), true)
  assert.equal(shouldOfferMove({ ...mac, env: { CI: '1' } }), true)
  assert.equal(shouldOfferMove({ ...mac, env: { CI: '1', MIETFUCHS_TESTGRIFFE: '1' } }), false)
})

test('Umgebung des Servers: ausgeliefert ohne Schranke weder CI noch Testgriffe noch NKA_ALLOWED_HOSTS oder NKA_UPDATE_URL', () => {
  const base = { CI: 'true', NKA_UPDATE_URL: 'http://evil.example/', NKA_ALLOWED_HOSTS: '*', NKA_TEST_HOME: '/x', NKA_TEST_TODAY: '2020-01-01', NKA_DATA_DIR: '/eigene/daten' }
  const options = { port: DEFAULT_PORT, network: false, packaged: true, windowsStore: false, repoRoot: '/repo', platform: /** @type {NodeJS.Platform} */ ('linux') }
  const env = serverEnv(base, options)
  for (const name of ['CI', 'NKA_UPDATE_URL', 'NKA_ALLOWED_HOSTS', 'NKA_TEST_HOME', 'NKA_TEST_TODAY']) assert.equal(env[name], undefined, name)
  // Den Datenordner darf man verlegen, das ist kein Testgriff
  assert.equal(env.NKA_DATA_DIR, '/eigene/daten')
  // In Prüfungen mit beiden Schranken geht alles weiter
  const probe = serverEnv({ ...base, CI: '1', MIETFUCHS_TESTGRIFFE: '1' }, options)
  assert.equal(probe.CI, '1')
  assert.equal(probe.NKA_TEST_HOME, '/x')
  assert.equal(probe.NKA_ALLOWED_HOSTS, '*')
  // Beim Entwickeln bleibt die Umgebung, wie sie ist
  assert.equal(serverEnv(base, { ...options, packaged: false }).NKA_TEST_TODAY, '2020-01-01')
})

test('Zweites Mietfuchs auf denselben Daten: das Fenster zeigt die gesiezte Meldung des Servers statt der technischen', () => {
  const line = 'Mietfuchs läuft bereits mit denselben Daten (C:\\Users\\Anna\\Mietfuchs, http://127.0.0.1:3001, Port 3001). Bitte beenden Sie das andere Mietfuchs zuerst.'
  const output = `Fenster: Electron 45\n${line}\n`
  assert.equal(twinIn(output), line)
  assert.equal(twinIn('Mietfuchs-Server läuft auf http://127.0.0.1:17517'), null)
  const failure = startFailure({ found: null, technical: `Der Server hat sich beim Start beendet (Code 1).\n\n${output}`, logDir: 'C:\\log', platform: 'win32' })
  assert.equal(failure.message, line)
  assert.equal(failure.title, 'Mietfuchs läuft bereits')
})

test('Datenordner zeigen: einmal beim Start gemerkt, nicht aus dem rollenden Puffer', () => {
  let dir = rememberDataDir(null, 'Mietfuchs-Server läuft auf http://127.0.0.1:17517\n')
  assert.equal(dir, null)
  dir = rememberDataDir(dir, 'Mietfuchs-Server läuft auf http://127.0.0.1:17517\nDaten: /home/a/Mietfuchs\n')
  assert.equal(dir, '/home/a/Mietfuchs')
  // Später schreibt jemand „Daten: …“ in die Ausgabe (etwa eine Meldung) oder der Puffer hat die Zeile verloren
  assert.equal(rememberDataDir(dir, 'Daten: /woanders\n'), '/home/a/Mietfuchs')
  assert.equal(rememberDataDir(dir, ''), '/home/a/Mietfuchs')
})

// Gefunden mit dem Protokoll des Fensters in der CI an #549: Das Schließen des Fensters ruft app.quit zweimal (`closed`
// und `window-all-closed`). Der zweite before-quit ließ das Beenden durch, während der erste noch auf den Server
// wartete; Electron beendete dann den Hauptprozess und mit ihm den Server mitten im Leerlaufen seiner Schlange.
test('Beenden: ein zweites before-quit während des Beendens wartet, statt Electron beenden zu lassen', () => {
  assert.equal(quitDecision({ quitting: false, exiting: false }), 'begin')
  assert.equal(quitDecision({ quitting: true, exiting: false }), 'wait')
  assert.equal(quitDecision({ quitting: true, exiting: true }), 'allow')
})

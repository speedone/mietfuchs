// Update-Hinweis: Versionsvergleich, Wahl der Download-Datei und die Abfrage bei GitHub.
//
// GitHub wird durch einen echten lokalen HTTP-Server ersetzt, der die echte Antwort der
// Releases-API ausliefert (fixtures/github-release-latest.json, abgespeichert von
// /repos/speedone/mietfuchs/releases/latest). So prüfen die Tests die tatsächliche
// Datenstruktur, und kein Test geht ins Internet.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseVersion, isNewer, assetFor, createUpdateChecker } from '../src/update.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const echteAntwort = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'github-release-latest.json'), 'utf8'))

// Die echte Antwort, umgeschrieben auf eine angenommene neuere Version
function releaseMit(tag, extra = {}) {
  const text = JSON.stringify(echteAntwort).replaceAll(echteAntwort.tag_name, tag)
  return { ...JSON.parse(text), ...extra }
}

// ---------- Versionen ----------

test('parseVersion: liest v-Präfix und reine Zahlen, alles andere ist ungültig', () => {
  assert.deepEqual(parseVersion('v0.4.0'), [0, 4, 0])
  assert.deepEqual(parseVersion('1.12.3'), [1, 12, 3])
  assert.equal(parseVersion('0.5.0-rc.1'), null) // Vorabversionen zählen nicht
  assert.equal(parseVersion('unbekannt'), null)
  assert.equal(parseVersion(''), null)
  assert.equal(parseVersion(undefined), null)
})

test('isNewer: vergleicht numerisch, nicht als Text', () => {
  assert.equal(isNewer('0.10.0', '0.4.0'), true) // als Text wäre „0.10.0" < „0.4.0"
  assert.equal(isNewer('v0.4.1', '0.4.0'), true)
  assert.equal(isNewer('1.0.0', '0.99.99'), true)
  assert.equal(isNewer('0.4.0', '0.4.0'), false)
  assert.equal(isNewer('0.3.9', '0.4.0'), false)
})

test('isNewer: ohne bekannte eigene oder fremde Version gibt es keinen Hinweis', () => {
  assert.equal(isNewer('0.5.0', 'unbekannt'), false)
  assert.equal(isNewer('kaputt', '0.4.0'), false)
})

// ---------- Download-Datei je System ----------

test('assetFor: wählt die Datei für das eigene Betriebssystem und die Architektur', () => {
  const assets = echteAntwort.assets
  assert.equal(assetFor(assets, 'win32', 'x64').name, 'mietfuchs-win.exe')
  assert.equal(assetFor(assets, 'darwin', 'arm64').name, 'mietfuchs-macos-apple-silicon.zip')
  assert.equal(assetFor(assets, 'darwin', 'x64').name, 'mietfuchs-macos-intel.zip')
  assert.equal(assetFor(assets, 'linux', 'x64').name, 'mietfuchs-linux.tar.gz')
})

test('assetFor: ARM-Programmdateien für Linux und Windows (#22), die bisherigen Namen bleiben', () => {
  // Ältere Versionen suchen ihre Datei unter dem bisherigen Namen, der darf sich nie ändern.
  const namen = ['mietfuchs-win.exe', 'mietfuchs-win-arm64.exe', 'mietfuchs-linux.tar.gz', 'mietfuchs-linux-arm64.tar.gz']
  const assets = namen.map((name) => ({ name, browser_download_url: `https://github.com/speedone/mietfuchs/releases/download/v0.6.0/${name}` }))
  assert.equal(assetFor(assets, 'linux', 'arm64').name, 'mietfuchs-linux-arm64.tar.gz')
  assert.equal(assetFor(assets, 'win32', 'arm64').name, 'mietfuchs-win-arm64.exe')
  assert.equal(assetFor(assets, 'linux', 'x64').name, 'mietfuchs-linux.tar.gz')
  assert.equal(assetFor(assets, 'win32', 'x64').name, 'mietfuchs-win.exe')
})

test('assetFor: für Systeme ohne eigene Datei gibt es keine', () => {
  assert.equal(assetFor(echteAntwort.assets, 'linux', 'arm64'), null)
  assert.equal(assetFor(echteAntwort.assets, 'freebsd', 'x64'), null)
  assert.equal(assetFor([], 'win32', 'x64'), null)
})

// ---------- Abfrage bei GitHub ----------

// Nachgebauter GitHub-Server. `antwort` lässt sich je Test umstellen; `anfragen` zählt mit.
let github
let antwort
const anfragen = []

before(async () => {
  github = http.createServer((req, res) => {
    anfragen.push({ url: req.url, userAgent: req.headers['user-agent'] ?? '' })
    antwort(req, res)
  })
  await new Promise((r) => github.listen(0, '127.0.0.1', r))
})
after(() => {
  github.closeAllConnections() // der Test „Keine Antwort" lässt eine Anfrage offen
  github.close()
})

const url = () => `http://127.0.0.1:${github.address().port}/repos/speedone/mietfuchs/releases/latest`
const liefere = (body, status = 200, headers = {}) => (req, res) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(typeof body === 'string' ? body : JSON.stringify(body))
}

function pruefer(extra = {}) {
  return createUpdateChecker({
    url: url(), currentVersion: '0.4.0', mode: 'binary', platform: 'win32', arch: 'x64', ...extra,
  })
}

test('Datenschutz: ohne Zustimmung geht keine einzige Anfrage hinaus', async () => {
  antwort = liefere(releaseMit('v0.5.0'))
  anfragen.length = 0
  for (const consent of [undefined, 'off', 'ja', true, '']) {
    const s = await pruefer().check({ consent, force: true })
    assert.equal(s.enabled, false)
    assert.equal(s.available, false)
    assert.equal(s.latest, null)
  }
  assert.equal(anfragen.length, 0)
})

test('Mit Zustimmung: neuere Version mit passendem Download für Windows', async () => {
  antwort = liefere(releaseMit('v0.5.0'))
  anfragen.length = 0
  const s = await pruefer().check({ consent: 'on' })
  assert.equal(anfragen.length, 1)
  assert.equal(s.enabled, true)
  assert.equal(s.current, '0.4.0')
  assert.equal(s.latest, '0.5.0')
  assert.equal(s.available, true)
  assert.equal(s.downloadUrl, 'https://github.com/speedone/mietfuchs/releases/download/v0.5.0/mietfuchs-win.exe')
  assert.equal(s.releaseUrl, 'https://github.com/speedone/mietfuchs/releases/tag/v0.5.0')
  assert.equal(s.error, null)
})

test('GitHub verlangt eine Kennung: die Anfrage nennt Mietfuchs als User-Agent', async () => {
  antwort = liefere(releaseMit('v0.5.0'))
  anfragen.length = 0
  await pruefer().check({ consent: 'on' })
  assert.match(anfragen[0].userAgent, /^Mietfuchs\/0\.4\.0/)
})

test('Gleiche Version: kein Hinweis', async () => {
  antwort = liefere(echteAntwort) // v0.4.0
  const s = await pruefer().check({ consent: 'on' })
  assert.equal(s.latest, '0.4.0')
  assert.equal(s.available, false)
})

test('Außerhalb der Programmdatei gibt es keinen Download, nur die Release-Seite', async () => {
  antwort = liefere(releaseMit('v0.5.0'))
  for (const mode of ['docker', 'npm']) {
    const s = await pruefer({ mode }).check({ consent: 'on' })
    assert.equal(s.available, true)
    assert.equal(s.mode, mode)
    assert.equal(s.downloadUrl, null)
    assert.equal(s.releaseUrl, 'https://github.com/speedone/mietfuchs/releases/tag/v0.5.0')
  }
})

test('System ohne eigene Datei: Download führt zur Release-Seite', async () => {
  antwort = liefere(releaseMit('v0.5.0'))
  const s = await pruefer({ platform: 'linux', arch: 'arm64' }).check({ consent: 'on' })
  assert.equal(s.downloadUrl, 'https://github.com/speedone/mietfuchs/releases/tag/v0.5.0')
})

test('Vorabversion oder Entwurf gilt nicht als Update', async () => {
  for (const extra of [{ prerelease: true }, { draft: true }]) {
    antwort = liefere(releaseMit('v0.5.0', extra))
    const s = await pruefer().check({ consent: 'on' })
    assert.equal(s.available, false)
  }
})

test('Höchstens eine Anfrage am Tag, „Jetzt prüfen" fragt trotzdem', async () => {
  antwort = liefere(releaseMit('v0.5.0'))
  anfragen.length = 0
  let jetzt = Date.UTC(2026, 8, 19, 8, 0)
  const p = pruefer({ now: () => jetzt })
  await p.check({ consent: 'on' })
  jetzt += 23 * 3600 * 1000
  const s = await p.check({ consent: 'on' })
  assert.equal(anfragen.length, 1) // noch innerhalb von 24 Stunden
  assert.equal(s.available, true) // das gemerkte Ergebnis
  await p.check({ consent: 'on', force: true })
  assert.equal(anfragen.length, 2)
  jetzt += 25 * 3600 * 1000
  await p.check({ consent: 'on' })
  assert.equal(anfragen.length, 3) // nach Ablauf wieder
})

test('Zustimmung zurückgezogen: das gemerkte Ergebnis wird nicht mehr gezeigt', async () => {
  antwort = liefere(releaseMit('v0.5.0'))
  const p = pruefer()
  await p.check({ consent: 'on' })
  const s = await p.check({ consent: 'off' })
  assert.equal(s.enabled, false)
  assert.equal(s.available, false)
  assert.equal(s.latest, null)
})

test('Fehler bei GitHub bleiben still: kein Absturz, kein Hinweis', async () => {
  const faelle = [
    liefere({ message: 'API rate limit exceeded' }, 403),
    liefere({ message: 'Not Found' }, 404),
    liefere('<html>kein JSON</html>'),
    liefere(releaseMit('kaputt')),
  ]
  for (const fall of faelle) {
    antwort = fall
    const s = await pruefer().check({ consent: 'on', force: true })
    assert.equal(s.available, false)
    assert.equal(typeof s.error, 'string')
    assert.ok(s.error.length > 0)
  }
})

// GitHub-Vorgabe: nach Fehlern nicht sofort erneut fragen, bei einem Rate-Limit bis zur
// genannten Zeit warten. Wer weiterfragt, riskiert eine Sperre für den ganzen Anschluss.
const MINUTE = 60 * 1000
const STUNDE = 60 * MINUTE

test('Nach einem Fehler fragt Mietfuchs erst nach einer Stunde von selbst wieder', async () => {
  antwort = liefere({ message: 'Server Error' }, 500)
  anfragen.length = 0
  let jetzt = Date.UTC(2026, 8, 19, 8, 0)
  const p = pruefer({ now: () => jetzt })
  await p.check({ consent: 'on' })
  jetzt += 59 * MINUTE
  const s = await p.check({ consent: 'on' })
  assert.equal(anfragen.length, 1) // jeder Seitenaufruf würde sonst neu fragen
  assert.equal(typeof s.error, 'string')
  await p.check({ consent: 'on', force: true })
  assert.equal(anfragen.length, 2) // „Jetzt prüfen" darf es trotzdem versuchen
  jetzt += 61 * MINUTE
  await p.check({ consent: 'on' })
  assert.equal(anfragen.length, 3)
})

test('Rate-Limit: gewartet wird bis x-ratelimit-reset, auch bei „Jetzt prüfen"', async () => {
  let jetzt = Date.UTC(2026, 8, 19, 8, 0)
  const reset = jetzt + 2 * STUNDE
  antwort = liefere({ message: 'API rate limit exceeded' }, 403, {
    'x-ratelimit-remaining': '0',
    'x-ratelimit-reset': String(reset / 1000),
  })
  anfragen.length = 0
  const p = pruefer({ now: () => jetzt })
  const s = await p.check({ consent: 'on' })
  assert.match(s.error, /zu viele Anfragen/)
  await p.check({ consent: 'on', force: true })
  jetzt += 90 * MINUTE
  await p.check({ consent: 'on', force: true })
  assert.equal(anfragen.length, 1)
  jetzt = reset + 1000
  await p.check({ consent: 'on', force: true })
  assert.equal(anfragen.length, 2)
})

test('Rate-Limit: retry-after hat Vorrang und gilt auch bei 429', async () => {
  let jetzt = Date.UTC(2026, 8, 19, 8, 0)
  antwort = liefere({ message: 'Too Many Requests' }, 429, { 'retry-after': '120' })
  anfragen.length = 0
  const p = pruefer({ now: () => jetzt })
  await p.check({ consent: 'on' })
  jetzt += 60 * 1000
  await p.check({ consent: 'on', force: true })
  assert.equal(anfragen.length, 1)
  jetzt += 61 * 1000
  await p.check({ consent: 'on', force: true })
  assert.equal(anfragen.length, 2)
})

test('Nach erfolgreichem „Jetzt prüfen" ist der alte Fehler vergessen', async () => {
  let jetzt = Date.UTC(2026, 8, 19, 8, 0)
  const p = pruefer({ now: () => jetzt })
  antwort = liefere({ message: 'Server Error' }, 500)
  await p.check({ consent: 'on' })
  jetzt += 5 * MINUTE
  antwort = liefere(releaseMit('v0.5.0'))
  await p.check({ consent: 'on', force: true })
  jetzt += 5 * MINUTE
  const s = await p.check({ consent: 'on' }) // z. B. beim nächsten Seitenaufruf
  assert.equal(s.error, null)
  assert.equal(s.available, true)
})

test('Ein Fehler vergisst nicht, was schon bekannt war', async () => {
  let jetzt = Date.UTC(2026, 8, 19, 8, 0)
  const p = pruefer({ now: () => jetzt })
  antwort = liefere(releaseMit('v0.5.0'))
  await p.check({ consent: 'on' })
  jetzt += 25 * STUNDE
  antwort = liefere({ message: 'Server Error' }, 500)
  const s = await p.check({ consent: 'on' })
  assert.equal(s.latest, '0.5.0') // der Hinweis bleibt stehen
  assert.equal(s.available, true)
  assert.equal(typeof s.error, 'string')
})

test('Gleichzeitige Aufrufe teilen sich eine Anfrage', async () => {
  // z. B. mehrere offene Tabs oder ein Klick direkt nach dem Einschalten
  antwort = liefere(releaseMit('v0.5.0'))
  anfragen.length = 0
  const p = pruefer()
  const [a, b] = await Promise.all([p.check({ consent: 'on' }), p.check({ consent: 'on' })])
  assert.equal(anfragen.length, 1)
  assert.equal(a.latest, '0.5.0')
  assert.equal(b.latest, '0.5.0')
  await Promise.all([p.check({ consent: 'on', force: true }), p.check({ consent: 'on', force: true })])
  assert.equal(anfragen.length, 1) // noch innerhalb der Mindestpause, siehe nächster Test
})

test('„Jetzt prüfen" fragt höchstens einmal pro Minute', async () => {
  antwort = liefere(releaseMit('v0.5.0'))
  anfragen.length = 0
  let jetzt = Date.UTC(2026, 8, 19, 8, 0)
  const p = pruefer({ now: () => jetzt })
  await p.check({ consent: 'on' })
  jetzt += 30 * 1000
  const s = await p.check({ consent: 'on', force: true })
  assert.equal(anfragen.length, 1)
  assert.equal(s.latest, '0.5.0') // das letzte Ergebnis
  jetzt += 31 * 1000
  await p.check({ consent: 'on', force: true })
  assert.equal(anfragen.length, 2)
})

test('Rate-Limit: eine unsinnig lange Wartezeit gilt höchstens einen Tag', async () => {
  let jetzt = Date.UTC(2026, 8, 19, 8, 0)
  antwort = liefere({ message: 'Too Many Requests' }, 429, { 'retry-after': String(365 * 24 * 3600) })
  anfragen.length = 0
  const p = pruefer({ now: () => jetzt })
  await p.check({ consent: 'on' })
  jetzt += 24 * STUNDE + 1000
  await p.check({ consent: 'on', force: true })
  assert.equal(anfragen.length, 2)
})

test('Links werden nur übernommen, wenn sie ins Mietfuchs-Repo auf GitHub zeigen', async () => {
  // Die Adresse der Abfrage lässt sich per NKA_UPDATE_URL umstellen. Was von dort kommt,
  // landet als Link in der Oberfläche und darf nirgendwo anders hinführen.
  antwort = liefere(releaseMit('v0.5.0', { html_url: 'javascript:alert(1)' }))
  let s = await pruefer().check({ consent: 'on' })
  assert.equal(s.releaseUrl, null)
  assert.equal(s.downloadUrl, 'https://github.com/speedone/mietfuchs/releases/download/v0.5.0/mietfuchs-win.exe')

  const fremd = releaseMit('v0.5.0')
  fremd.assets = fremd.assets.map((a) => ({ ...a, browser_download_url: `https://example.com/${a.name}` }))
  antwort = liefere(fremd)
  s = await pruefer().check({ consent: 'on' })
  assert.equal(s.downloadUrl, 'https://github.com/speedone/mietfuchs/releases/tag/v0.5.0')

  antwort = liefere(releaseMit('v0.5.0', { html_url: undefined }))
  s = await pruefer({ mode: 'docker' }).check({ consent: 'on' })
  assert.equal(s.releaseUrl, null) // fehlt der Link, bleibt es bei null
})

test('Keine Antwort: die Abfrage gibt nach der Wartezeit auf', async () => {
  antwort = () => {} // antwortet nie
  const start = Date.now()
  const s = await pruefer({ timeoutMs: 200 }).check({ consent: 'on' })
  assert.ok(Date.now() - start < 2000, 'hängt nicht')
  assert.equal(s.available, false)
  assert.equal(typeof s.error, 'string')
})

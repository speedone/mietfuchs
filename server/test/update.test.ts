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
import { parseVersion, isNewer, assetFor, createUpdateChecker } from '../src/update.ts'
import type { UpdateStatus } from '../../shared/types.ts'

// Die Gestalt der abgespeicherten Antwort, so weit die Tests sie anfassen. update.ts beschreibt
// dieselbe Antwort für sich selbst mit lauter optionalen Feldern, weil sie aus dem Netz kommt;
// hier liegt sie als Datei im Repo, deshalb steht sie fest.
type ReleaseAsset = { name: string, browser_download_url: string }
type Release = { tag_name: string, html_url?: string, assets: ReleaseAsset[], draft?: boolean, prerelease?: boolean }

const here = path.dirname(fileURLToPath(import.meta.url))
const realResponse: Release = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'github-release-latest.json'), 'utf8'))

// Die echte Antwort, umgeschrieben auf eine angenommene neuere Version
function releaseWith(tag: string, extra: Partial<Release> = {}): Release {
  const text = JSON.stringify(realResponse).replaceAll(realResponse.tag_name, tag)
  return { ...JSON.parse(text), ...extra }
}

// assetFor liefert null, wenn es für das System keine Datei gibt. Der Name wird deshalb über
// den Umweg gelesen: Fehlt die Datei, steht hier undefined, und der Vergleich schlägt fehl,
// statt dass der Test am Zugriff auf null zerbricht.
const assetName = (assets: ReleaseAsset[], platform: string, arch: string): string | undefined =>
  assetFor(assets, platform, arch)?.name

// assert.match verlangt eine Zeichenkette, `error` im Status ist `string | null`. Geprüft wird
// deshalb auf eine Zeichenkette und nicht nur auf „nicht null": Steht dort etwas anderes, ist
// das genauso ein Befund, und der Test benennt ihn.
const errorOf = (status: UpdateStatus): string => {
  if (typeof status.error !== 'string') assert.fail(`es fehlt die Fehlermeldung: ${JSON.stringify(status.error)}`)
  return status.error
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
  const assets = realResponse.assets
  assert.equal(assetName(assets, 'win32', 'x64'), 'mietfuchs-win.exe')
  assert.equal(assetName(assets, 'darwin', 'arm64'), 'mietfuchs-macos-apple-silicon.zip')
  assert.equal(assetName(assets, 'darwin', 'x64'), 'mietfuchs-macos-intel.zip')
  assert.equal(assetName(assets, 'linux', 'x64'), 'mietfuchs-linux.tar.gz')
})

test('assetFor: ARM-Programmdateien für Linux und Windows (#22), die bisherigen Namen bleiben', () => {
  // Ältere Versionen suchen ihre Datei unter dem bisherigen Namen, der darf sich nie ändern.
  const names = ['mietfuchs-win.exe', 'mietfuchs-win-arm64.exe', 'mietfuchs-linux.tar.gz', 'mietfuchs-linux-arm64.tar.gz']
  const assets = names.map((name) => ({ name, browser_download_url: `https://github.com/speedone/mietfuchs/releases/download/v0.6.0/${name}` }))
  assert.equal(assetName(assets, 'linux', 'arm64'), 'mietfuchs-linux-arm64.tar.gz')
  assert.equal(assetName(assets, 'win32', 'arm64'), 'mietfuchs-win-arm64.exe')
  assert.equal(assetName(assets, 'linux', 'x64'), 'mietfuchs-linux.tar.gz')
  assert.equal(assetName(assets, 'win32', 'x64'), 'mietfuchs-win.exe')
})

test('assetFor: für Systeme ohne eigene Datei gibt es keine', () => {
  assert.equal(assetFor(realResponse.assets, 'linux', 'arm64'), null)
  assert.equal(assetFor(realResponse.assets, 'freebsd', 'x64'), null)
  assert.equal(assetFor([], 'win32', 'x64'), null)
})

// ---------- Abfrage bei GitHub ----------

// Nachgebauter GitHub-Server. `respond` lässt sich je Test umstellen; `requests` zählt mit.
let github: http.Server
let respond: http.RequestListener
const requests: { url: string | undefined, userAgent: string }[] = []

before(async () => {
  github = http.createServer((req, res) => {
    requests.push({ url: req.url, userAgent: req.headers['user-agent'] ?? '' })
    respond(req, res)
  })
  await new Promise<void>((r) => github.listen(0, '127.0.0.1', () => r()))
})
after(() => {
  github.closeAllConnections() // der Test „Keine Antwort" lässt eine Anfrage offen
  github.close()
})

const url = () => {
  // address() kennt auch den Unix-Socket (eine Zeichenkette) und den nicht lauschenden Server
  // (null). Hier ist weder das eine noch das andere möglich, und wäre es doch, hilft die Ansage.
  const address = github.address()
  if (address === null || typeof address === 'string') assert.fail('der nachgebaute GitHub-Server lauscht nicht auf einem Port')
  return `http://127.0.0.1:${address.port}/repos/speedone/mietfuchs/releases/latest`
}
const serve = (body: unknown, status = 200, headers: http.OutgoingHttpHeaders = {}): http.RequestListener => (req, res) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(typeof body === 'string' ? body : JSON.stringify(body))
}

type CheckerOptions = Parameters<typeof createUpdateChecker>[0]

function makeChecker(extra: Partial<CheckerOptions> = {}) {
  return createUpdateChecker({
    url: url(), currentVersion: '0.4.0', mode: 'binary', platform: 'win32', arch: 'x64', ...extra,
  })
}

test('Datenschutz: ohne Zustimmung geht keine einzige Anfrage hinaus', async () => {
  respond = serve(releaseWith('v0.5.0'))
  requests.length = 0
  for (const consent of [undefined, 'off', 'ja', true, '']) {
    const s = await makeChecker().check({ consent, force: true })
    assert.equal(s.enabled, false)
    assert.equal(s.available, false)
    assert.equal(s.latest, null)
  }
  assert.equal(requests.length, 0)
})

test('Mit Zustimmung: neuere Version mit passendem Download für Windows', async () => {
  respond = serve(releaseWith('v0.5.0'))
  requests.length = 0
  const s = await makeChecker().check({ consent: 'on' })
  assert.equal(requests.length, 1)
  assert.equal(s.enabled, true)
  assert.equal(s.current, '0.4.0')
  assert.equal(s.latest, '0.5.0')
  assert.equal(s.available, true)
  assert.equal(s.downloadUrl, 'https://github.com/speedone/mietfuchs/releases/download/v0.5.0/mietfuchs-win.exe')
  assert.equal(s.releaseUrl, 'https://github.com/speedone/mietfuchs/releases/tag/v0.5.0')
  assert.equal(s.error, null)
})

test('GitHub verlangt eine Kennung: die Anfrage nennt Mietfuchs als User-Agent', async () => {
  respond = serve(releaseWith('v0.5.0'))
  requests.length = 0
  await makeChecker().check({ consent: 'on' })
  assert.match(requests[0].userAgent, /^Mietfuchs\/0\.4\.0/)
})

test('Gleiche Version: kein Hinweis', async () => {
  respond = serve(realResponse) // v0.4.0
  const s = await makeChecker().check({ consent: 'on' })
  assert.equal(s.latest, '0.4.0')
  assert.equal(s.available, false)
})

test('Außerhalb der Programmdatei gibt es keinen Download, nur die Release-Seite', async () => {
  respond = serve(releaseWith('v0.5.0'))
  const modes: UpdateStatus['mode'][] = ['docker', 'npm']
  for (const mode of modes) {
    const s = await makeChecker({ mode }).check({ consent: 'on' })
    assert.equal(s.available, true)
    assert.equal(s.mode, mode)
    assert.equal(s.downloadUrl, null)
    assert.equal(s.releaseUrl, 'https://github.com/speedone/mietfuchs/releases/tag/v0.5.0')
  }
})

test('System ohne eigene Datei: Download führt zur Release-Seite', async () => {
  respond = serve(releaseWith('v0.5.0'))
  const s = await makeChecker({ platform: 'linux', arch: 'arm64' }).check({ consent: 'on' })
  assert.equal(s.downloadUrl, 'https://github.com/speedone/mietfuchs/releases/tag/v0.5.0')
})

test('Vorabversion oder Entwurf gilt nicht als Update', async () => {
  for (const extra of [{ prerelease: true }, { draft: true }]) {
    respond = serve(releaseWith('v0.5.0', extra))
    const s = await makeChecker().check({ consent: 'on' })
    assert.equal(s.available, false)
  }
})

test('Höchstens eine Anfrage am Tag, „Jetzt prüfen" fragt trotzdem', async () => {
  respond = serve(releaseWith('v0.5.0'))
  requests.length = 0
  let clock = Date.UTC(2026, 8, 19, 8, 0)
  const p = makeChecker({ now: () => clock })
  await p.check({ consent: 'on' })
  clock += 23 * 3600 * 1000
  const s = await p.check({ consent: 'on' })
  assert.equal(requests.length, 1) // noch innerhalb von 24 Stunden
  assert.equal(s.available, true) // das gemerkte Ergebnis
  await p.check({ consent: 'on', force: true })
  assert.equal(requests.length, 2)
  clock += 25 * 3600 * 1000
  await p.check({ consent: 'on' })
  assert.equal(requests.length, 3) // nach Ablauf wieder
})

test('Zustimmung zurückgezogen: das gemerkte Ergebnis wird nicht mehr gezeigt', async () => {
  respond = serve(releaseWith('v0.5.0'))
  const p = makeChecker()
  await p.check({ consent: 'on' })
  const s = await p.check({ consent: 'off' })
  assert.equal(s.enabled, false)
  assert.equal(s.available, false)
  assert.equal(s.latest, null)
})

test('Fehler bei GitHub bleiben still: kein Absturz, kein Hinweis', async () => {
  const failures = [
    serve({ message: 'API rate limit exceeded' }, 403),
    serve({ message: 'Not Found' }, 404),
    serve('<html>kein JSON</html>'),
    serve(releaseWith('kaputt')),
  ]
  for (const failure of failures) {
    respond = failure
    const s = await makeChecker().check({ consent: 'on', force: true })
    assert.equal(s.available, false)
    assert.ok(errorOf(s).length > 0)
  }
})

test('Antwort ohne Nutzdaten (kein Objekt): klare Meldung statt eines kryptischen Fehlers', async () => {
  respond = serve('null') // gültiges JSON, aber kein Objekt mit den erwarteten Feldern
  const s = await makeChecker().check({ consent: 'on', force: true })
  assert.equal(s.available, false)
  assert.match(errorOf(s), /kein Objekt/)
})

test('Antwort mit unbrauchbarer Dateiliste: der Hinweis bleibt, nur der Download fehlt', async () => {
  // Die Liste der Release-Dateien braucht allein der Download-Knopf. Steht dort etwas anderes
  // als eine Liste von Dateien, darf das weder abstürzen noch als „GitHub ist nicht erreichbar"
  // erscheinen: Die neue Version steht ja in derselben Antwort, und für Systeme ohne eigene
  // Datei führt der Hinweis ohnehin auf die Release-Seite.
  const broken: unknown[] = ['kaputt', 42, { name: 'mietfuchs-win.exe' }, [null, 'x'], [{ name: null }]]
  for (const assets of broken) {
    respond = serve({ ...releaseWith('v0.5.0'), assets })
    const s = await makeChecker().check({ consent: 'on', force: true })
    assert.equal(s.error, null, JSON.stringify(assets))
    assert.equal(s.latest, '0.5.0')
    assert.equal(s.available, true)
    assert.equal(s.downloadUrl, 'https://github.com/speedone/mietfuchs/releases/tag/v0.5.0')
  }
})

// GitHub-Vorgabe: nach Fehlern nicht sofort erneut fragen, bei einem Rate-Limit bis zur
// genannten Zeit warten. Wer weiterfragt, riskiert eine Sperre für den ganzen Anschluss.
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

test('Nach einem Fehler fragt Mietfuchs erst nach einer Stunde von selbst wieder', async () => {
  respond = serve({ message: 'Server Error' }, 500)
  requests.length = 0
  let clock = Date.UTC(2026, 8, 19, 8, 0)
  const p = makeChecker({ now: () => clock })
  await p.check({ consent: 'on' })
  clock += 59 * MINUTE
  const s = await p.check({ consent: 'on' })
  assert.equal(requests.length, 1) // jeder Seitenaufruf würde sonst neu fragen
  assert.equal(typeof s.error, 'string')
  await p.check({ consent: 'on', force: true })
  assert.equal(requests.length, 2) // „Jetzt prüfen" darf es trotzdem versuchen
  clock += 61 * MINUTE
  await p.check({ consent: 'on' })
  assert.equal(requests.length, 3)
})

test('Rate-Limit: gewartet wird bis x-ratelimit-reset, auch bei „Jetzt prüfen"', async () => {
  let clock = Date.UTC(2026, 8, 19, 8, 0)
  const reset = clock + 2 * HOUR
  respond = serve({ message: 'API rate limit exceeded' }, 403, {
    'x-ratelimit-remaining': '0',
    'x-ratelimit-reset': String(reset / 1000),
  })
  requests.length = 0
  const p = makeChecker({ now: () => clock })
  const s = await p.check({ consent: 'on' })
  assert.match(errorOf(s), /zu viele Anfragen/)
  await p.check({ consent: 'on', force: true })
  clock += 90 * MINUTE
  await p.check({ consent: 'on', force: true })
  assert.equal(requests.length, 1)
  clock = reset + 1000
  await p.check({ consent: 'on', force: true })
  assert.equal(requests.length, 2)
})

test('Rate-Limit: retry-after hat Vorrang und gilt auch bei 429', async () => {
  let clock = Date.UTC(2026, 8, 19, 8, 0)
  respond = serve({ message: 'Too Many Requests' }, 429, { 'retry-after': '120' })
  requests.length = 0
  const p = makeChecker({ now: () => clock })
  await p.check({ consent: 'on' })
  clock += 60 * 1000
  await p.check({ consent: 'on', force: true })
  assert.equal(requests.length, 1)
  clock += 61 * 1000
  await p.check({ consent: 'on', force: true })
  assert.equal(requests.length, 2)
})

test('Nach erfolgreichem „Jetzt prüfen" ist der alte Fehler vergessen', async () => {
  let clock = Date.UTC(2026, 8, 19, 8, 0)
  const p = makeChecker({ now: () => clock })
  respond = serve({ message: 'Server Error' }, 500)
  await p.check({ consent: 'on' })
  clock += 5 * MINUTE
  respond = serve(releaseWith('v0.5.0'))
  await p.check({ consent: 'on', force: true })
  clock += 5 * MINUTE
  const s = await p.check({ consent: 'on' }) // z. B. beim nächsten Seitenaufruf
  assert.equal(s.error, null)
  assert.equal(s.available, true)
})

test('Ein Fehler vergisst nicht, was schon bekannt war', async () => {
  let clock = Date.UTC(2026, 8, 19, 8, 0)
  const p = makeChecker({ now: () => clock })
  respond = serve(releaseWith('v0.5.0'))
  await p.check({ consent: 'on' })
  clock += 25 * HOUR
  respond = serve({ message: 'Server Error' }, 500)
  const s = await p.check({ consent: 'on' })
  assert.equal(s.latest, '0.5.0') // der Hinweis bleibt stehen
  assert.equal(s.available, true)
  assert.equal(typeof s.error, 'string')
})

test('Gleichzeitige Aufrufe teilen sich eine Anfrage', async () => {
  // z. B. mehrere offene Tabs oder ein Klick direkt nach dem Einschalten
  respond = serve(releaseWith('v0.5.0'))
  requests.length = 0
  const p = makeChecker()
  const [a, b] = await Promise.all([p.check({ consent: 'on' }), p.check({ consent: 'on' })])
  assert.equal(requests.length, 1)
  assert.equal(a.latest, '0.5.0')
  assert.equal(b.latest, '0.5.0')
  await Promise.all([p.check({ consent: 'on', force: true }), p.check({ consent: 'on', force: true })])
  assert.equal(requests.length, 1) // noch innerhalb der Mindestpause, siehe nächster Test
})

test('„Jetzt prüfen" fragt höchstens einmal pro Minute', async () => {
  respond = serve(releaseWith('v0.5.0'))
  requests.length = 0
  let clock = Date.UTC(2026, 8, 19, 8, 0)
  const p = makeChecker({ now: () => clock })
  await p.check({ consent: 'on' })
  clock += 30 * 1000
  const s = await p.check({ consent: 'on', force: true })
  assert.equal(requests.length, 1)
  assert.equal(s.latest, '0.5.0') // das letzte Ergebnis
  clock += 31 * 1000
  await p.check({ consent: 'on', force: true })
  assert.equal(requests.length, 2)
})

test('Rate-Limit: eine unsinnig lange Wartezeit gilt höchstens einen Tag', async () => {
  let clock = Date.UTC(2026, 8, 19, 8, 0)
  respond = serve({ message: 'Too Many Requests' }, 429, { 'retry-after': String(365 * 24 * 3600) })
  requests.length = 0
  const p = makeChecker({ now: () => clock })
  await p.check({ consent: 'on' })
  clock += 24 * HOUR + 1000
  await p.check({ consent: 'on', force: true })
  assert.equal(requests.length, 2)
})

test('Links werden nur übernommen, wenn sie ins Mietfuchs-Repo auf GitHub zeigen', async () => {
  // Die Adresse der Abfrage lässt sich per NKA_UPDATE_URL umstellen. Was von dort kommt,
  // landet als Link in der Oberfläche und darf nirgendwo anders hinführen.
  respond = serve(releaseWith('v0.5.0', { html_url: 'javascript:alert(1)' }))
  let s = await makeChecker().check({ consent: 'on' })
  assert.equal(s.releaseUrl, null)
  assert.equal(s.downloadUrl, 'https://github.com/speedone/mietfuchs/releases/download/v0.5.0/mietfuchs-win.exe')

  const foreign = releaseWith('v0.5.0')
  foreign.assets = foreign.assets.map((a) => ({ ...a, browser_download_url: `https://example.com/${a.name}` }))
  respond = serve(foreign)
  s = await makeChecker().check({ consent: 'on' })
  assert.equal(s.downloadUrl, 'https://github.com/speedone/mietfuchs/releases/tag/v0.5.0')

  respond = serve(releaseWith('v0.5.0', { html_url: undefined }))
  s = await makeChecker({ mode: 'docker' }).check({ consent: 'on' })
  assert.equal(s.releaseUrl, null) // fehlt der Link, bleibt es bei null
})

test('Keine Antwort: die Abfrage gibt nach der Wartezeit auf', async () => {
  respond = () => {} // antwortet nie
  const start = Date.now()
  const s = await makeChecker({ timeoutMs: 200 }).check({ consent: 'on' })
  assert.ok(Date.now() - start < 2000, 'hängt nicht')
  assert.equal(s.available, false)
  assert.equal(typeof s.error, 'string')
})

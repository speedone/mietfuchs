// Update-Hinweis: fragt das neueste Release bei GitHub ab und vergleicht es mit der eigenen
// Version. Das passiert nur mit ausdrücklicher Zustimmung (settings.updateCheck === 'on').
// Ohne sie geht keine Anfrage hinaus, und das Versprechen „kein externer Dienst" gilt
// unverändert. Aus Mietfuchs werden dabei keine Daten übertragen, verglichen wird lokal.
//
// Ein Selbst-Update gibt es nicht. Ob und welcher Updater später dazukommt, ist offen. Die
// Möglichkeiten mit Vor- und Nachteilen stehen in Issue #20.

export const UPDATE_URL = 'https://api.github.com/repos/speedone/mietfuchs/releases/latest'

const EINE_MINUTE = 60 * 1000
const EINE_STUNDE = 60 * EINE_MINUTE
const EIN_TAG = 24 * EINE_STUNDE
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/

// Links aus der Antwort landen in der Oberfläche. Übernommen wird nur, was ins Mietfuchs-Repo
// auf GitHub zeigt, auch wenn NKA_UPDATE_URL die Abfrage anderswohin lenkt.
const REPO_URL = 'https://github.com/speedone/mietfuchs/'
const vertraut = (link) => (typeof link === 'string' && link.startsWith(REPO_URL) ? link : null)

const ZU_VIELE_ANFRAGEN =
  'GitHub hat zu viele Anfragen von diesem Internetanschluss gezählt. Mietfuchs fragt später noch einmal.'

// 'v0.4.0' oder '0.4.0' → [0, 4, 0]. Vorabversionen und alles andere → null.
export function parseVersion(v) {
  const m = VERSION.exec(String(v ?? '').trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

// Ist `candidate` neuer als `current`? Ohne gültige Versionen auf beiden Seiten nie.
export function isNewer(candidate, current) {
  const a = parseVersion(candidate)
  const b = parseVersion(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}

// Release-Dateien je Betriebssystem und Architektur, wie scripts/package-binaries.mjs sie baut.
// Die bisherigen Namen dürfen sich nie ändern: Ältere Versionen suchen ihre Datei darunter.
const DATEIEN = {
  'win32-x64': 'mietfuchs-win.exe',
  'win32-arm64': 'mietfuchs-win-arm64.exe',
  'darwin-arm64': 'mietfuchs-macos-apple-silicon.zip',
  'darwin-x64': 'mietfuchs-macos-intel.zip',
  'linux-x64': 'mietfuchs-linux.tar.gz',
  'linux-arm64': 'mietfuchs-linux-arm64.tar.gz',
}

export function assetFor(assets, platform, arch) {
  const name = DATEIEN[`${platform}-${arch}`]
  return (name && (assets ?? []).find((a) => a.name === name)) || null
}

// Rate-Limit nach GitHub-Vorgabe: `retry-after` hat Vorrang, sonst gilt `x-ratelimit-reset`
// (Sekunden seit 1970), ohne Angabe mindestens eine Minute. Wer trotzdem weiterfragt, riskiert
// eine Sperre. Liefert den Zeitpunkt, ab dem wieder gefragt werden darf, oder null. Länger als
// einen Tag wird nie gewartet, sonst legte eine unsinnige Angabe den Hinweis dauerhaft still.
function rateLimitBis(res, jetzt) {
  if (res.status !== 403 && res.status !== 429) return null
  let bis = null
  const retryAfter = Number(res.headers.get('retry-after'))
  if (retryAfter > 0) bis = jetzt + retryAfter * 1000
  else if (res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000
    bis = Math.max(reset || 0, jetzt + EINE_MINUTE)
  } else if (res.status === 429) bis = jetzt + EINE_MINUTE
  // 403 ohne diese Angaben ist ein gewöhnlicher Fehler, 429 immer ein Rate-Limit
  return bis === null ? null : Math.min(bis, jetzt + EIN_TAG)
}

// Fehler in eine Meldung für die Einstellungen übersetzen. Im Hinweis selbst erscheinen sie nie.
function beschreibe(err) {
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return 'GitHub hat nicht rechtzeitig geantwortet.'
  if (err instanceof SyntaxError) return 'Die Antwort von GitHub ließ sich nicht lesen.'
  if (err instanceof TypeError) return 'GitHub ist nicht erreichbar.'
  return err?.message || 'Die Abfrage ist fehlgeschlagen.'
}

// `mode` ist 'binary' (Programmdatei), 'docker' oder 'npm' und bestimmt, ob es einen direkten
// Download gibt. `now` und `timeoutMs` lassen sich für Tests einstellen.
export function createUpdateChecker({
  url = UPDATE_URL,
  currentVersion,
  mode,
  platform = process.platform,
  arch = process.arch,
  now = Date.now,
  ttlMs = EIN_TAG,
  errorPauseMs = EINE_STUNDE,
  timeoutMs = 5000,
}) {
  let gemerkt = null // { at, result }: die letzte erfolgreiche Abfrage, gilt einen Tag
  // Nach einem Fehler: bis `bis` keine automatische Abfrage, bis `gesperrtBis` (Rate-Limit)
  // auch nicht auf Knopfdruck. Sonst fragte jeder Seitenaufruf sofort wieder.
  let pause = null // { bis, gesperrtBis, result }
  let laufend = null // die gerade offene Anfrage, gleichzeitige Aufrufe warten auf sie
  let zuletztGefragt = null // Zeitpunkt der letzten Anfrage, für den Mindestabstand

  const leer = (enabled) => ({
    enabled,
    current: currentVersion,
    mode,
    latest: null,
    available: false,
    releaseUrl: null,
    downloadUrl: null,
    checkedAt: null,
    error: null,
  })

  async function frageGitHub(result) {
    // Bewusst ohne X-GitHub-Api-Version: Installationen laufen oft jahrelang ohne Update. Eine
    // fest eingetragene Version, die GitHub irgendwann abschaltet, ließe den Hinweis genau dort
    // verstummen, wo er am nötigsten ist. Die wenigen genutzten Felder sichert der Test mit der
    // echten API-Antwort ab. Bedingte Anfragen (ETag) sparen ohne Anmeldung nichts, auch ein
    // 304 zählt dann gegen das Limit.
    const res = await fetch(url, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': `Mietfuchs/${currentVersion}` },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) {
      const bis = rateLimitBis(res, now())
      if (bis) throw Object.assign(new Error(ZU_VIELE_ANFRAGEN), { bis })
      throw new Error(`GitHub antwortet mit Status ${res.status}.`)
    }
    const release = await res.json()
    // /releases/latest liefert keine Vorabversionen. Falls doch, zählen sie nicht.
    if (release.draft || release.prerelease) return
    const version = parseVersion(release.tag_name)
    if (!version) throw new Error(`Unbekanntes Versionsformat „${release.tag_name}".`)
    result.latest = version.join('.')
    result.available = isNewer(result.latest, currentVersion)
    result.releaseUrl = vertraut(release.html_url)
    if (mode === 'binary') {
      result.downloadUrl = vertraut(assetFor(release.assets, platform, arch)?.browser_download_url) ?? result.releaseUrl
    }
  }

  async function frage() {
    zuletztGefragt = now()
    const result = { ...leer(true), checkedAt: new Date(now()).toISOString() }
    try {
      await frageGitHub(result)
      gemerkt = { at: now(), result }
      pause = null
      return result
    } catch (err) {
      // Was schon bekannt war, bleibt gültig: Ein kurzer Ausfall soll den Hinweis nicht löschen.
      const fehler = { ...(gemerkt?.result ?? result), checkedAt: result.checkedAt, error: beschreibe(err) }
      const gesperrtBis = err?.bis ?? 0
      pause = { bis: Math.max(now() + errorPauseMs, gesperrtBis), gesperrtBis, result: fehler }
      return fehler
    }
  }

  async function check({ consent, force = false } = {}) {
    if (consent !== 'on') return leer(false)
    if (laufend) return laufend
    if (pause && (now() < pause.gesperrtBis || (!force && now() < pause.bis))) return pause.result
    if (!force && gemerkt && now() - gemerkt.at < ttlMs) return gemerkt.result
    // Auch „Jetzt prüfen" fragt höchstens einmal pro Minute, wiederholtes Klicken bleibt lokal.
    const zuletzt = pause?.result ?? gemerkt?.result
    if (force && zuletzt && now() - zuletztGefragt < EINE_MINUTE) return zuletzt
    laufend = frage().finally(() => { laufend = null })
    return laufend
  }

  return { check }
}

// Update-Hinweis: fragt das neueste Release bei GitHub ab und vergleicht es mit der eigenen
// Version. Das passiert nur mit ausdrücklicher Zustimmung (settings.updateCheck === 'on').
// Ohne sie geht keine Anfrage hinaus, und das Versprechen „kein externer Dienst" gilt
// unverändert. Aus Mietfuchs werden dabei keine Daten übertragen, verglichen wird lokal.
//
// Ein Selbst-Update gibt es nicht. Ob und welcher Updater später dazukommt, ist offen. Die
// Möglichkeiten mit Vor- und Nachteilen stehen in Issue #20.
import type { UpdateStatus } from '../../shared/types.ts'

export const UPDATE_URL = 'https://api.github.com/repos/speedone/mietfuchs/releases/latest'

const ONE_MINUTE = 60 * 1000
const ONE_HOUR = 60 * ONE_MINUTE
const ONE_DAY = 24 * ONE_HOUR
// SemVer 2.0.0: drei Zahlen ohne führende Null, dahinter wahlweise eine Vorabversion aus
// Punkt-getrennten Teilen (`-rc.2`) und Bauangaben (`+build.5`), die für die Reihenfolge nicht
// zählen. Das `v` erlaubt der Tag-Name bei GitHub.
const NUMBER = '0|[1-9]\\d*'
const PRE_PART = '(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)'
const VERSION = new RegExp(
  `^v?(${NUMBER})\\.(${NUMBER})\\.(${NUMBER})(?:-(${PRE_PART}(?:\\.${PRE_PART})*))?(?:\\+[0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*)?$`,
)

// Links aus der Antwort landen in der Oberfläche. Übernommen wird nur, was ins Mietfuchs-Repo
// auf GitHub zeigt, auch wenn NKA_UPDATE_URL die Abfrage anderswohin lenkt.
const REPO_URL = 'https://github.com/speedone/mietfuchs/'
const trusted = (link: string | undefined): string | null => (typeof link === 'string' && link.startsWith(REPO_URL) ? link : null)

const TOO_MANY_REQUESTS =
  'GitHub hat zu viele Anfragen von diesem Internetanschluss gezählt. Mietfuchs fragt später noch einmal.'

// Eine Version zerlegt: `core` sind die drei Zahlen, `pre` die Teile der Vorabversion, Teile
// aus Ziffern als Zahl. Eine fertige Version hat keine Teile.
export type Version = { core: [number, number, number], pre: (number | string)[] }

// 'v0.4.0' → { core: [0, 4, 0], pre: [] }, '0.9.0-rc.2' → { core: [0, 9, 0], pre: ['rc', 2] }.
// Alles, was keine Version nach SemVer ist, → null.
export function parseVersion(v: unknown): Version | null {
  const m = VERSION.exec(String(v ?? '').trim())
  if (!m) return null
  const pre = m[4] ? m[4].split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part)) : []
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre }
}

// Reihenfolge nach SemVer 2.0.0 §11 (#166): erst die drei Zahlen; bei Gleichstand liegt jede
// Vorabversion vor der fertigen (0.9.0-rc.2 < 0.9.0); unter Vorabversionen entscheidet der
// erste verschiedene Teil, Zahlen numerisch (rc.2 < rc.10), Text nach Zeichencode, und eine
// Zahl vor Text; sind alle gemeinsamen Teile gleich, ist die mit mehr Teilen die spätere.
function compareVersions(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i] - b.core[i]
  if (a.pre.length === 0 || b.pre.length === 0) return b.pre.length - a.pre.length
  for (let i = 0; i < Math.min(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i]
    const y = b.pre[i]
    if (x === y) continue
    if (typeof x === 'number' && typeof y === 'number') return x - y
    if (typeof x === 'number') return -1
    if (typeof y === 'number') return 1
    return x < y ? -1 : 1 // Zeichencode, nicht die Sprache des Rechners
  }
  return a.pre.length - b.pre.length
}

// Ist `candidate` neuer als `current`? Ohne gültige Versionen auf beiden Seiten nie.
export function isNewer(candidate: unknown, current: unknown): boolean {
  const a = parseVersion(candidate)
  const b = parseVersion(current)
  return !!a && !!b && compareVersions(a, b) > 0
}

// Nur die Felder, die wir wirklich lesen. Alles andere aus der Antwort interessiert nicht.
type GithubReleaseAsset = { name?: string, browser_download_url?: string }
type GithubRelease = {
  draft?: boolean
  prerelease?: boolean
  tag_name?: string
  html_url?: string
  // Die Liste der Release-Dateien bleibt `unknown`, obwohl wir sie lesen: Ob überhaupt eine
  // Liste ankommt, prüft assetFor. Als Liste zugesichert ergäbe etwas anderes einen TypeError,
  // und describeError bildet jeden TypeError auf „GitHub ist nicht erreichbar" ab — eine
  // Meldung, die den Nutzer an die falsche Stelle schickt, obwohl GitHub geantwortet hat.
  assets?: unknown
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

// GitHub liefert hier fremde Daten von außen. Statt sie ungeprüft als GithubRelease zu
// behandeln, wird nur sichergestellt, dass es überhaupt ein Objekt ist — die einzelnen Felder
// bleiben optional und werden dort geprüft, wo sie gebraucht werden (parseVersion, trusted).
function asRelease(body: unknown): GithubRelease {
  if (!isObject(body)) throw new Error('Die Antwort von GitHub ist kein Objekt.')
  return body as GithubRelease
}

// Release-Dateien je Betriebssystem und Architektur, wie scripts/package-binaries.mjs sie baut.
// Die bisherigen Namen dürfen sich nie ändern: Ältere Versionen suchen ihre Datei darunter.
const ASSET_NAMES: Record<string, string> = {
  'win32-x64': 'mietfuchs-win.exe',
  'win32-arm64': 'mietfuchs-win-arm64.exe',
  'darwin-arm64': 'mietfuchs-macos-apple-silicon.zip',
  'darwin-x64': 'mietfuchs-macos-intel.zip',
  'linux-x64': 'mietfuchs-linux.tar.gz',
  'linux-arm64': 'mietfuchs-linux-arm64.tar.gz',
}

// `assets` kommt ungeprüft aus der Antwort. Was keine Liste von Objekten ist, zählt als „keine
// Datei dabei": Dann führt der Hinweis auf die Release-Seite, genau wie bei einem System, für
// das es keine eigene Datei gibt. Die Version steht ja in derselben Antwort und bleibt gültig.
export function assetFor(assets: unknown, platform: string, arch: string): GithubReleaseAsset | null {
  const name = ASSET_NAMES[`${platform}-${arch}`]
  if (!name || !Array.isArray(assets)) return null
  const found: unknown = assets.find((a: unknown) => isObject(a) && a.name === name)
  if (!isObject(found)) return null
  return { name, browser_download_url: typeof found.browser_download_url === 'string' ? found.browser_download_url : undefined }
}

// Rate-Limit nach GitHub-Vorgabe: `retry-after` hat Vorrang, sonst gilt `x-ratelimit-reset`
// (Sekunden seit 1970), ohne Angabe mindestens eine Minute. Wer trotzdem weiterfragt, riskiert
// eine Sperre. Liefert den Zeitpunkt, ab dem wieder gefragt werden darf, oder null. Länger als
// einen Tag wird nie gewartet, sonst legte eine unsinnige Angabe den Hinweis dauerhaft still.
function rateLimitUntil(res: Response, now: number): number | null {
  if (res.status !== 403 && res.status !== 429) return null
  let until: number | null = null
  const retryAfter = Number(res.headers.get('retry-after'))
  if (retryAfter > 0) until = now + retryAfter * 1000
  else if (res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000
    until = Math.max(reset || 0, now + ONE_MINUTE)
  } else if (res.status === 429) until = now + ONE_MINUTE
  // 403 ohne diese Angaben ist ein gewöhnlicher Fehler, 429 immer ein Rate-Limit
  return until === null ? null : Math.min(until, now + ONE_DAY)
}

// Die von rateLimitUntil per Object.assign angehängte Wartezeit auslesen, sonst 0 (siehe query).
function untilOf(err: unknown): number {
  const value = err instanceof Error ? (err as Error & { until?: unknown }).until : undefined
  return typeof value === 'number' ? value : 0
}

// Fehler in eine Meldung für die Einstellungen übersetzen. Im Hinweis selbst erscheinen sie nie.
function describeError(err: unknown): string {
  const name = err instanceof Error ? err.name : undefined
  if (name === 'TimeoutError' || name === 'AbortError') return 'GitHub hat nicht rechtzeitig geantwortet.'
  if (err instanceof SyntaxError) return 'Die Antwort von GitHub ließ sich nicht lesen.'
  if (err instanceof TypeError) return 'GitHub ist nicht erreichbar.'
  return (err instanceof Error && err.message) || 'Die Abfrage ist fehlgeschlagen.'
}

type CreateUpdateCheckerOptions = {
  url?: string
  currentVersion: string
  mode: UpdateStatus['mode']
  platform?: string
  arch?: string
  now?: () => number
  ttlMs?: number
  errorPauseMs?: number
  timeoutMs?: number
}

// `consent` kommt aus settings.updateCheck, also ungeprüft aus der db.json: Wer die Datei von
// Hand bearbeitet, kann dort alles hineinschreiben. Deshalb `unknown` statt eines Typs, der
// schon Zustimmung nahelegt — geprüft wird unten genau auf 'on', alles andere heißt nein.
type CheckOptions = { consent?: unknown, force?: boolean }

// `mode` ist 'binary' (Programmdatei), 'package' (aus einem Installationspaket), 'docker' oder
// 'npm' und bestimmt, ob es einen direkten Download gibt. Aus einem Paket gibt es keinen: Welche
// der drei Paketdateien passt, weiß nur die Distribution des Nutzers, deshalb führt der Hinweis
// dort auf die Release-Seite. `now` und `timeoutMs` lassen sich für Tests einstellen.
export function createUpdateChecker({
  url = UPDATE_URL,
  currentVersion,
  mode,
  platform = process.platform,
  arch = process.arch,
  now = Date.now,
  ttlMs = ONE_DAY,
  errorPauseMs = ONE_HOUR,
  timeoutMs = 5000,
}: CreateUpdateCheckerOptions) {
  let cached: { at: number, result: UpdateStatus } | null = null // die letzte erfolgreiche Abfrage, gilt einen Tag
  // Nach einem Fehler: bis `until` keine automatische Abfrage, bis `blockedUntil` (Rate-Limit)
  // auch nicht auf Knopfdruck. Sonst fragte jeder Seitenaufruf sofort wieder.
  let backoff: { until: number, blockedUntil: number, result: UpdateStatus } | null = null
  let pending: Promise<UpdateStatus> | null = null // die gerade offene Anfrage, gleichzeitige Aufrufe warten auf sie
  let lastQueriedAt: number | null = null // Zeitpunkt der letzten Anfrage, für den Mindestabstand

  const emptyResult = (enabled: boolean): UpdateStatus => ({
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

  async function fetchLatestRelease(result: UpdateStatus): Promise<void> {
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
      const until = rateLimitUntil(res, now())
      if (until) throw Object.assign(new Error(TOO_MANY_REQUESTS), { until })
      throw new Error(`GitHub antwortet mit Status ${res.status}.`)
    }
    const body: unknown = await res.json()
    const release = asRelease(body)
    // /releases/latest liefert keine Vorabversionen. Falls doch, zählen sie nicht.
    if (release.draft || release.prerelease) return
    const version = parseVersion(release.tag_name)
    if (!version) throw new Error(`Unbekanntes Versionsformat „${release.tag_name}".`)
    // Ein Tag mit Vorabversion ohne das Kennzeichen: release.yml setzt es aus dem Bindestrich,
    // fehlte es doch einmal, wird der Kandidat trotzdem niemandem angeboten (#166).
    if (version.pre.length > 0) return
    const latest = version.core.join('.')
    result.latest = latest
    result.available = isNewer(latest, currentVersion)
    result.releaseUrl = trusted(release.html_url)
    if (mode === 'binary') {
      result.downloadUrl = trusted(assetFor(release.assets, platform, arch)?.browser_download_url) ?? result.releaseUrl
    }
  }

  async function query(): Promise<UpdateStatus> {
    lastQueriedAt = now()
    const result: UpdateStatus = { ...emptyResult(true), checkedAt: new Date(now()).toISOString() }
    try {
      await fetchLatestRelease(result)
      cached = { at: now(), result }
      backoff = null
      return result
    } catch (err) {
      // Was schon bekannt war, bleibt gültig: Ein kurzer Ausfall soll den Hinweis nicht löschen.
      const failed: UpdateStatus = { ...(cached?.result ?? result), checkedAt: result.checkedAt, error: describeError(err) }
      const blockedUntil = untilOf(err)
      backoff = { until: Math.max(now() + errorPauseMs, blockedUntil), blockedUntil, result: failed }
      return failed
    }
  }

  async function check({ consent, force = false }: CheckOptions = {}): Promise<UpdateStatus> {
    if (consent !== 'on') return emptyResult(false)
    if (pending) return pending
    if (backoff && (now() < backoff.blockedUntil || (!force && now() < backoff.until))) return backoff.result
    if (!force && cached && now() - cached.at < ttlMs) return cached.result
    // Auch „Jetzt prüfen" fragt höchstens einmal pro Minute, wiederholtes Klicken bleibt lokal.
    const last = backoff?.result ?? cached?.result
    if (force && last && now() - (lastQueriedAt ?? 0) < ONE_MINUTE) return last
    pending = query().finally(() => { pending = null })
    return pending
  }

  return { check }
}

// Automatische Updates im Programmfenster (#517), nur unter Windows mit dem Installer (NSIS). Hier steht, was sich ohne
// Electron prüfen lässt (desktop/test/updater.test.js): woher Updates kommen, wann geprüft wird, was die Oberfläche
// sieht und in welcher Reihenfolge installiert wird. main.js setzt electron-updater ein.
//
// - Quelle sind die Releases von speedone/mietfuchs auf GitHub (`UPDATE_REPO`); latest.yml und die .blockmap legt
//   electron-builder beim Bau daneben, release.yml hängt sie mit dem Installer ans Release.
// - Gefragt wird nur mit der Zustimmung aus den Einstellungen des Servers (`updateCheck === 'on'`, dasselbe Häkchen wie
//   für den Update-Hinweis), die das Fenster vor jeder Prüfung über 127.0.0.1 liest. Ohne sie keine Anfrage.
// - Vorabversionen bekommt niemand, auch nicht, wer selbst eine Vorabversion installiert hat.
// - Nie ungefragt neu starten: „Jetzt neu starten“ beendet erst den Server, dann installiert der Installer still und
//   startet Mietfuchs wieder. „Beim nächsten Start“ installiert beim Beenden, nach dem Ende des Servers.

export const UPDATE_REPO = Object.freeze({ provider: 'github', owner: 'speedone', repo: 'mietfuchs', releaseType: 'release' })

const ONE_MINUTE = 60_000
const ONE_HOUR = 60 * ONE_MINUTE
// Beim Start und danach höchstens einmal am Tag, wie der Update-Hinweis des Servers
export const CHECK_INTERVAL_MS = 24 * ONE_HOUR
// Nach einem Fehler eine Stunde Pause
export const ERROR_PAUSE_MS = ONE_HOUR
// „Jetzt prüfen“ höchstens einmal pro Minute
export const FORCE_PAUSE_MS = ONE_MINUTE
// Wie oft das Fenster nachsieht, ob ein Tag um ist
export const TICK_MS = ONE_HOUR
// Wie lange „Jetzt neu starten“ nach dem Start des Installers auf einen Fehler wartet: electron-updater startet ihn
// asynchron und meldet ein Scheitern (Datei weg, Start verweigert) erst danach als Ereignis `error` (NsisUpdater.doInstall)
export const INSTALL_GRACE_MS = 1500
// Statt der Kennung, die electron-updater sonst je Installation anlegt (userData/.updaterId) und als
// `x-user-staging-id` mitschickt (AppUpdater.getUpdateInfoAndProvider): GitHub soll nur IP-Adresse und Version sehen,
// wie es das Häkchen zusagt (Durchsicht M2). Gestaffelte Freigaben nutzt Mietfuchs nicht.
export const NO_INSTALLATION_ID = '00000000-0000-0000-0000-000000000000'

/** @typedef {{ kind: 'github' } | { kind: 'feed', url: string } | { kind: 'off', reason: 'store' | 'mac' | 'platform' | 'dev' }} UpdaterSource */

/**
 * Ob und woher das Fenster Updates holt. Nur das installierte Fenster unter Windows: Aus dem Microsoft Store aktualisiert
 * der Store, auf dem Mac verlangt Squirrel.Mac eine bezahlte Developer-ID-Signatur, beim Entwickeln gibt es keinen
 * Installer zu ersetzen.
 *
 * `MIETFUCHS_UPDATE_FEED` lenkt die Updates auf einen anderen Server, für die echte Probe in release.yml (ein zweiter
 * Bau mit höherer Version über einen lokalen HTTP-Server). Nur mit `CI` und nur auf 127.0.0.1: Im ausgelieferten
 * Betrieb ließe eine untergeschobene Variable (Verknüpfung, Startskript, Benutzerumgebung) sonst die Updates von einem
 * fremden Server laden, und die SHA-512, die electron-updater prüft, käme von demselben Server. Eine Signatur, die das
 * abfinge, gibt es ohne bezahltes Zertifikat nicht (main.js, `verifyUpdateCodeSignature`). Wie MIETFUCHS_SERVER_URL in
 * main.js (Durchsicht K8).
 * @param {{ platform: NodeJS.Platform, packaged: boolean, windowsStore: boolean, env: NodeJS.ProcessEnv }} where
 * @returns {UpdaterSource}
 */
export function updaterSource({ platform, packaged, windowsStore, env }) {
  if (windowsStore) return { kind: 'off', reason: 'store' }
  const feed = env.CI ? localFeed(env.MIETFUCHS_UPDATE_FEED) : null
  if (feed) return { kind: 'feed', url: feed }
  if (platform === 'darwin') return { kind: 'off', reason: 'mac' }
  if (platform !== 'win32') return { kind: 'off', reason: 'platform' }
  if (!packaged) return { kind: 'off', reason: 'dev' }
  return { kind: 'github' }
}

/** @param {string | undefined} value @returns {string | null} */
function localFeed(value) {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' ? value : null
  } catch {
    return null
  }
}

/**
 * Der Stand, den die Oberfläche sieht (`window.mietfuchsDesktop.updater`). `phase`: `off` ohne Updater (Mac, Store,
 * beim Entwickeln), `idle` vor der ersten Prüfung oder ohne Zustimmung, `checking`, `latest` (aktuell), `downloading`,
 * `ready` (heruntergeladen, wartet auf die Wahl), `error`. `choice` ist `later` nach „Beim nächsten Start“.
 * @typedef {{ phase: 'off' | 'idle' | 'checking' | 'latest' | 'downloading' | 'ready' | 'error', current: string, version: string | null, percent: number | null, choice: 'later' | null, error: string | null, checkedAt: string | null }} UpdaterState
 */

/** @param {UpdaterSource['kind']} kind @param {string} current @returns {UpdaterState} */
export function initialUpdaterState(kind, current) {
  return { phase: kind === 'off' ? 'off' : 'idle', current, version: null, percent: null, choice: null, error: null, checkedAt: null }
}

/**
 * @typedef {{ type: 'checking', at?: string } | { type: 'none' } | { type: 'available', version: string } | { type: 'progress', percent: number, version?: string } | { type: 'downloaded', version: string } | { type: 'error', message: string } | { type: 'later' }} UpdaterEvent
 */

/** @param {UpdaterState} state @param {UpdaterEvent} event @returns {UpdaterState} */
export function reduceUpdater(state, event) {
  if (state.phase === 'off') return state
  switch (event.type) {
    case 'checking':
      return { ...state, phase: 'checking', error: null, checkedAt: event.at ?? state.checkedAt }
    case 'none':
      return { ...state, phase: 'latest', version: null, percent: null, error: null }
    case 'available':
      return { ...state, phase: 'downloading', version: event.version, percent: 0, error: null }
    case 'progress':
      return { ...state, phase: 'downloading', version: event.version ?? state.version, percent: Math.round(Math.max(0, Math.min(100, event.percent))), error: null }
    case 'downloaded':
      return { ...state, phase: 'ready', version: event.version, percent: 100, error: null }
    case 'error':
      // Eine bereitliegende Version bleibt bereit; ein späterer Fehler (etwa beim Prüfen) ändert daran nichts
      return state.phase === 'ready' ? state : { ...state, phase: 'error', percent: null, error: event.message }
    case 'later':
      return state.phase === 'ready' ? { ...state, choice: 'later' } : state
    default:
      return state
  }
}

/**
 * Ob jetzt geprüft wird. Nur mit Zustimmung, genau `'on'` (aus den Einstellungen des Servers, also ungeprüft); nicht,
 * solange geprüft oder geladen wird oder eine Version bereitliegt. Sonst beim Start, danach einmal am Tag, nach einem
 * Fehler nach einer Stunde, auf Knopfdruck (`force`) höchstens einmal pro Minute.
 * @param {{ consent: unknown, state: UpdaterState, lastCheckAt: number | null, now: number, force?: boolean }} input
 */
export function shouldCheck({ consent, state, lastCheckAt, now, force = false }) {
  if (consent !== 'on') return false
  if (state.phase === 'off' || state.phase === 'checking' || state.phase === 'downloading' || state.phase === 'ready') return false
  if (lastCheckAt === null) return true
  const pause = force ? FORCE_PAUSE_MS : state.phase === 'error' ? ERROR_PAUSE_MS : CHECK_INTERVAL_MS
  return now - lastCheckAt >= pause
}

// Netzwerkfehler von Node und Chromium (electron-updater lädt über Electrons net)
const OFFLINE = /\b(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH)\b|net::ERR_/

/**
 * Was „Über Mietfuchs“ zu einem Fehler sagt: gesiezt, ohne Stapel.
 * @param {unknown} err
 * @returns {string}
 */
export function describeUpdaterError(err) {
  const code = /** @type {{ code?: unknown }} */ (err ?? {}).code
  const message = err instanceof Error ? err.message : String(err)
  if (code === 'ERR_CHECKSUM_MISMATCH') return 'Die heruntergeladene Datei stimmt nicht mit ihrer Prüfsumme überein. Mietfuchs lädt sie beim nächsten Versuch neu.'
  if (code === 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' || code === 'ERR_UPDATER_NO_PUBLISHED_VERSIONS') return 'Die neue Version ist bei GitHub noch nicht vollständig. Mietfuchs versucht es später noch einmal.'
  if ((typeof code === 'string' && OFFLINE.test(code)) || OFFLINE.test(message)) return 'GitHub ist nicht erreichbar.'
  const first = message.split('\n')[0].trim()
  return `Die Aktualisierung ist fehlgeschlagen: ${first.length > 200 ? `${first.slice(0, 200)} …` : first}`
}

/**
 * Mac: Läuft Mietfuchs nicht aus „Programme“ (etwa aus dem Abbild oder aus Downloads), bietet das Fenster einmal an,
 * es dorthin zu verschieben (`app.moveToApplicationsFolder`). „Nein“ merkt es sich. Nicht in Prüfungen: Dort läuft das
 * Programm absichtlich aus einem eigenen Ordner, und eine Rückfrage hielte die Prüfung an.
 * @param {{ platform: NodeJS.Platform, packaged: boolean, inApplications: boolean, declined: boolean, ci: boolean }} input
 */
export function shouldOfferMove({ platform, packaged, inApplications, declined, ci }) {
  return platform === 'darwin' && packaged && !inApplications && !declined && !ci
}

/**
 * Die Teile von electron-updater, die die Steuerung braucht (NsisUpdater; in den Tests nachgestellt).
 * @typedef {import('node:events').EventEmitter & { autoDownload: boolean, disableWebInstaller: boolean, autoInstallOnAppQuit: boolean, allowPrerelease: boolean, allowDowngrade: boolean, requestHeaders?: Record<string, string> | null, checkForUpdates: () => Promise<unknown>, install: (isSilent?: boolean, isForceRunAfter?: boolean) => boolean }} Updater
 */

/**
 * Die Steuerung: verbindet electron-updater mit der Zustimmung, dem Server und der Oberfläche.
 *
 * `autoInstallOnAppQuit` bleibt aus. electron-updater installierte sonst bei jedem Beenden, auch ohne „Beim nächsten
 * Start“, und zwar aus dem `quit`-Ereignis von Electron (BaseUpdater.addQuitHandler), das nach `before-quit` kommt:
 * Ob der Server dann schon beendet ist, hinge an der Reihenfolge zweier Ereignisse. Den Schalter erst nach der Wahl
 * zu setzen geht nicht, denn electron-updater hängt seinen Haken nur an, wenn er beim Ende des Herunterladens schon an
 * ist. Deshalb installiert `installOnQuit` selbst, aufgerufen in `before-quit` nach dem Beenden des Servers.
 * `installerExists` sagt, ob die geladene Datei noch da ist (ein Virenschutz kann sie entfernt haben).
 * @param {{ updater: Updater, source: UpdaterSource['kind'], current: string, readConsent: () => Promise<unknown>, stopServer: () => Promise<void>, resumeServer: () => Promise<void>, quit: () => void, installerExists?: () => boolean, installGraceMs?: number, now?: () => number, onState?: (state: UpdaterState) => void, log?: (line: string) => void }} deps
 */
export function createUpdaterController({ updater, source, current, readConsent, stopServer, resumeServer, quit, installerExists = () => true, installGraceMs = INSTALL_GRACE_MS, now = Date.now, onState = () => {}, log = () => {} }) {
  let state = initialUpdaterState(source, current)
  /** @type {number | null} */
  let lastCheckAt = null
  let restarting = false

  updater.autoDownload = true
  // Es gibt nur den vollständigen Installer, keinen Web-Installer (scripts/CLAUDE.md, „Kein Web-Installer“)
  updater.disableWebInstaller = true
  updater.autoInstallOnAppQuit = false
  updater.allowPrerelease = false
  updater.allowDowngrade = false
  updater.requestHeaders = { ...(updater.requestHeaders ?? {}), 'x-user-staging-id': NO_INSTALLATION_ID }

  /** @param {UpdaterEvent} event */
  const apply = (event) => {
    const next = reduceUpdater(state, event)
    if (next === state) return
    state = next
    onState(state)
  }
  const versionOf = (/** @type {unknown} */ info) => String(/** @type {{ version?: unknown }} */ (info ?? {}).version ?? '')
  updater.on('checking-for-update', () => apply({ type: 'checking', at: new Date(now()).toISOString() }))
  updater.on('update-not-available', () => apply({ type: 'none' }))
  updater.on('update-available', (info) => apply({ type: 'available', version: versionOf(info) }))
  updater.on('download-progress', (p) => apply({ type: 'progress', percent: Number(/** @type {{ percent?: unknown }} */ (p ?? {}).percent) || 0 }))
  updater.on('update-downloaded', (info) => apply({ type: 'downloaded', version: versionOf(info) }))
  updater.on('error', (err) => {
    log(`Update: ${err instanceof Error ? err.stack ?? err.message : String(err)}`)
    apply({ type: 'error', message: describeUpdaterError(err) })
  })

  // Der Anfangsstand gleich an die Oberfläche (Durchsicht S1): Sie fragt womöglich, bevor es die Steuerung gibt
  onState(state)

  /** @param {{ force?: boolean }} [options] */
  async function check({ force = false } = {}) {
    if (state.phase === 'off') return state
    // Vor jeder Prüfung neu gelesen: Wer das Häkchen abnimmt, wird ab dann nicht mehr gefragt
    const consent = await readConsent().catch(() => undefined)
    if (!shouldCheck({ consent, state, lastCheckAt, now: now(), force })) return state
    lastCheckAt = now()
    // Fehler kommen auch als Ereignis `error` und landen dort im Stand
    await updater.checkForUpdates().catch(() => {})
    return state
  }

  return {
    state: () => state,
    check,
    // Beim Start und im Takt von TICK_MS
    tick: () => check(),
    later() {
      apply({ type: 'later' })
      return state
    },
    // Für before-quit, nach dem Beenden des Servers: installiert still und ohne anschließenden Start, wenn
    // „Beim nächsten Start“ gewählt ist
    installOnQuit() {
      if (state.phase !== 'ready' || state.choice !== 'later' || restarting) return false
      log(`Update: Version ${state.version} wird beim Beenden installiert`)
      return updater.install(true, false)
    },
    // „Jetzt neu starten“: erst den Server sauber beenden (/api/quit, die Schreibschlange läuft leer), dann den
    // Installer still mit anschließendem Start. Den Rest erledigt der Server beim ersten Start der neuen Version: Er
    // legt vor dem Migrieren eine Sicherung an (backupBeforeMigrating in server/src/db/open.ts).
    async restartNow() {
      if (state.phase !== 'ready') throw new Error('Es liegt keine neue Version bereit.')
      if (restarting) return
      if (!installerExists()) throw new Error('Die geladene neue Version ist nicht mehr da, vielleicht hat ein Virenschutz sie entfernt. Mietfuchs lädt sie beim nächsten Start neu.')
      restarting = true
      await stopServer()
      log(`Update: Version ${state.version} wird jetzt installiert`)
      // install() startet den Installer asynchron; ein Scheitern kommt danach als `error` (Durchsicht S4)
      /** @type {unknown} */
      let failure = null
      const onError = (/** @type {unknown} */ err) => { failure = err ?? new Error('unbekannt') }
      updater.on('error', onError)
      const started = updater.install(true, true)
      if (started) await new Promise((resolve) => setTimeout(resolve, installGraceMs))
      updater.off('error', onError)
      if (!started || failure) {
        restarting = false
        await resumeServer()
        throw new Error('Der Installer der neuen Version ließ sich nicht starten. Mietfuchs läuft weiter wie bisher.')
      }
      quit()
    },
  }
}

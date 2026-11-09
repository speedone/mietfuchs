// Der Server im Programmfenster (#517): der Server von Mietfuchs aus dem Quellcode, mit Electrons eigenem Node als
// utilityProcess. Hier steht, was sich ohne Electron prüfen lässt (desktop/test/server.test.js): welches Modul, mit
// welcher Umgebung, auf welchem Port, und woran man erkennt, dass er bereit ist. main.js setzt es zusammen.
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { testGripsAllowed } from './testGrips.js'

// Fester Port, damit die Adresse gleich bleibt: Im Browser gespeicherte Entwürfe und Einstellungen hängen an Adresse
// samt Port, und wer aus dem Heimnetz zugreift, setzt ein Lesezeichen. 17517 ist bei der IANA nicht vergeben, kein
// gängiger Entwicklungsport und liegt unter den Bereichen, aus denen Windows (ab 49152) und Linux (ab 32768) Ports
// für ausgehende Verbindungen vergeben. Die Programmdatei ohne Fenster bleibt bei 3001.
export const DEFAULT_PORT = 17517

// Der Ordner in der app.asar, in dem der Server ausgeliefert liegt, drei Dateien in der Anordnung des Repos: das Bündel
// server/server.mjs (Server, shared/, Abhängigkeiten und Migrationen), die Lizenzen der Abhängigkeiten daneben und das
// Frontend als eine Datei, client/dist.pack. scripts/package-desktop.mjs legt ihn an, desktop/package.json (`files`)
// nimmt ihn in die asar mit.
export const SERVER_FOLDER = 'mietfuchs'
// Das Archiv der App unter resources, das electron-builder anlegt (`asar: true`)
export const APP_ARCHIVE = 'app.asar'

// Der Name des utilityProcess in app.getAppMetrics() (Speicher in der Selbstprüfung) und in child-process-gone
export const SERVICE_NAME = 'Mietfuchs-Server'

/**
 * Welches Modul als Server läuft und in welchem Ordner: ausgeliefert das Bündel in der app.asar, beim Entwickeln die
 * Quellen im Repo (Node streift die Typen ab wie bei `npm start`, ein Bauschritt entfällt). Beides derselbe Weg,
 * `utilityProcess.fork` mit Electrons eigenem Node. Gebündelt startet der Server rund eine Sekunde schneller, weil Node
 * eine Datei lädt statt rund 470 und keine Typen abstreift.
 *
 * Warum in der asar: Offen im Installationsordner stufte die Malware-Prävention von HP Wolf Security das Bündel auf
 * einem echten Rechner als Schadcode ein und blockierte es. In der asar ist es keine Skriptdatei auf der Platte mehr,
 * und die Prüfung der Integrität (Fuse enableEmbeddedAsarIntegrityValidation) deckt es mit ab. Der utilityProcess liest
 * die asar wie der Hauptprozess, ESM eingeschlossen (geprüft mit Electron 45 unter Linux, Windows und macOS). Der
 * Arbeitsordner kann nicht in einem Archiv liegen, er ist resources; der Server rechnet ohnehin nicht vom Arbeitsordner.
 * @param {{ packaged: boolean, platform: NodeJS.Platform, resourcesPath: string, repoRoot: string }} where
 * @returns {{ modulePath: string, cwd: string }}
 */
export function serverModule({ packaged, platform, resourcesPath, repoRoot }) {
  // Nach der genannten Plattform rechnen, nicht nach der des laufenden Rechners (CLAUDE.md, Konventionen)
  const p = platform === 'win32' ? path.win32 : path.posix
  if (packaged) return { modulePath: p.join(resourcesPath, APP_ARCHIVE, SERVER_FOLDER, 'server', 'server.mjs'), cwd: resourcesPath }
  const cwd = p.join(repoRoot, 'server')
  return { modulePath: p.join(cwd, 'src', 'index.ts'), cwd }
}

/**
 * Die Umgebung des Servers: alles vom Fenster (so erreichen CI, NKA_DATA_DIR und NKA_UPDATE_URL einer Prüfung den
 * Server), dazu die Angabe des Fensters, Port und Adresse. Ohne Zugriff aus dem Heimnetz nur 127.0.0.1, dann fragt
 * unter Windows auch keine Firewall.
 *
 * Der Server erkennt das Fenster an NKA_DESKTOP im utilityProcess (inWindow in server/src/version.ts), den Store an
 * NKA_STORE aus `process.windowsStore`. Beim Entwickeln nimmt das Fenster wie `npm run dev` server/data, damit kein
 * Probelauf den echten Bestand im Benutzerordner öffnet.
 * @param {NodeJS.ProcessEnv} base
 * `searchDirs`: Downloads, Schreibtisch und Dokumente, wie das System sie nennt (`app.getPath`), für die Suche beim
 * Umzug der Daten (#517); unter Windows liegen sie oft im OneDrive-Ordner. Eine geerbte Angabe gilt nicht.
 * `windowKey` (#528): der Fensterschlüssel dieses Starts, mit dem das Fenster als angemeldet gilt. Eine geerbte Angabe
 * gilt nie.
 * @param {{ port: number, network: boolean, packaged: boolean, windowsStore: boolean, repoRoot: string, platform: NodeJS.Platform, searchDirs?: string[], windowKey?: string }} options
 * @returns {NodeJS.ProcessEnv}
 */
export function serverEnv(base, { port, network, packaged, windowsStore, repoRoot, platform, searchDirs = [], windowKey }) {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...base, NKA_DESKTOP: '1', NKA_PORT: String(port), NKA_HOST: network ? '0.0.0.0' : '127.0.0.1' }
  // Electron setzt das für sich selbst; erbte es der Server, liefe Node darin als nacktes Node
  delete env.ELECTRON_RUN_AS_NODE
  // Eine geerbte Betriebsart (etwa docker aus einer Shell) gilt im Fenster nicht
  delete env.NKA_RUNTIME
  delete env.NKA_STORE
  delete env.NKA_SEARCH_DIRS
  delete env.NKA_WINDOW_KEY
  // Ein Fenster steht nicht hinter einem Proxy (#528): Eine geerbte Angabe ließe Proxy-Kopfzeilen von einem Gerät im
  // Heimnetz gelten, auch mit den Testgriffen
  delete env.NKA_TRUST_PROXY
  if (windowKey) env.NKA_WINDOW_KEY = windowKey
  if (searchDirs.length > 0) env.NKA_SEARCH_DIRS = JSON.stringify(searchDirs)
  // Ausgeliefert ohne die beiden Schranken der Testgriffe (testGrips.js) nichts davon an den Server: CI schaltete dort
  // Ortsdatei und Suche beim Umzug ab, ein NKA_TEST_* stellte Uhr, Heimatordner oder Ports um, ein NKA_ALLOWED_HOSTS mit
  // `*` aus einer Docker-Einrichtung schaltete die Prüfung von Host und Origin still ab, und NKA_UPDATE_URL lenkte den
  // Update-Hinweis samt Download-Link auf einen fremden Server, NKA_AUTH=off schaltete die Anmeldung still ab, und NKA_PASSWORD(_FILE) legte ein Passwort fest, das niemand im Fenster gewählt hat (#528).
  // NKA_DATA_DIR bleibt: Den Datenordner zu verlegen ist
  // eine Einstellung, kein Testgriff.
  if (packaged && !testGripsAllowed(base)) {
    for (const name of Object.keys(env)) {
      if (name === 'CI' || name === 'NKA_ALLOWED_HOSTS' || name === 'NKA_UPDATE_URL' || name === 'NKA_AUTH' || name === 'NKA_PASSWORD' || name === 'NKA_PASSWORD_FILE' || name.startsWith('NKA_TEST_')) delete env[name]
    }
  }
  if (windowsStore) env.NKA_STORE = '1'
  const p = platform === 'win32' ? path.win32 : path.posix
  if (!packaged && !env.NKA_DATA_DIR) env.NKA_DATA_DIR = p.join(repoRoot, 'server', 'data')
  return env
}

// Die Startzeile des Servers, nach Datenbank und Umstieg: „Mietfuchs-Server läuft auf http://127.0.0.1:17517“
/** @param {string} output @returns {string | null} */
export function startUrlIn(output) {
  return output.match(/läuft auf (http:\/\/\S+)/)?.[1] ?? null
}

/**
 * Der Datenordner für „Datenordner zeigen“, einmal je Start des Servers gemerkt (Durchsicht Sicherheit K9): Die Ausgabe
 * im Fenster ist ein rollender Puffer, nach vielen Meldungen fehlte die Zeile, und eine spätere Zeile „Daten: …“ (etwa
 * aus einer Meldung) zeigte einen anderen Ordner.
 * @param {string | null} current @param {string} output @returns {string | null}
 */
export function rememberDataDir(current, output) {
  return current ?? dataDirIn(output)
}

// Die Meldung des Servers, wenn auf demselben Datenordner schon ein Mietfuchs läuft (server/src/instanceGuard.ts,
// `twinMessage`)
/** @param {string} output @returns {string | null} */
export function twinIn(output) {
  return output.match(/Mietfuchs läuft bereits mit denselben Daten \(.+?\)\. Bitte beenden Sie das andere Mietfuchs zuerst\./)?.[0] ?? null
}

// Wo die Daten liegen, aus der Zeile „Daten: …“, für „Datenordner zeigen“
/** @param {string} output @returns {string | null} */
export function dataDirIn(output) {
  return output.match(/^Daten: (.+)$/m)?.[1]?.trim() ?? null
}

/**
 * Was auf dem Port antwortet: nichts, Mietfuchs (dann ein übrig gebliebener Server, den das Fenster beendet) oder ein
 * anderes Programm (dann nimmt das Fenster einen anderen Port und merkt ihn sich).
 * @param {number} port
 * @param {(url: string) => Promise<Response>} [get]
 * @returns {Promise<'free' | 'mietfuchs' | 'other'>}
 */
export async function whoIsOn(port, get = (url) => fetch(url, { signal: AbortSignal.timeout(2000) })) {
  // Erst fragen, dann binden: Ob eine Bindung neben einer bestehenden gelingt, hängt unter Windows an der Adresse.
  try {
    const res = await get(`http://127.0.0.1:${port}/healthz`)
    const body = /** @type {any} */ (await res.json().catch(() => null))
    return body?.app === 'mietfuchs' ? 'mietfuchs' : 'other'
  } catch {
    return (await canListen(port)) ? 'free' : 'other'
  }
}

// Nur auf 127.0.0.1: Eine Bindung an alle Netzwerkkarten ließe die Windows-Firewall beim ersten Start fragen, ob
// Mietfuchs ins Netz darf, auf einem echten Rechner so beobachtet. Ein Programm, das den Port auf allen Adressen hält,
// fällt schon vorher auf: `whoIsOn` erreicht es über 127.0.0.1. Bindet der Server mit Zugriff aus dem Heimnetz doch
// auf einen belegten Port, scheitert sein Start mit einer Meldung.
/** @param {number} port @returns {Promise<boolean>} */
export function canListen(port) {
  return new Promise((resolve) => {
    const probe = net.createServer()
    probe.once('error', () => resolve(false))
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)))
  })
}

/** @returns {Promise<number>} */
export function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : 0
      probe.close(() => resolve(port))
    })
  })
}

/**
 * Darf die Seite dieses Ziel im Fenster öffnen? Eigene Seiten (Oberfläche, Belege) ja, alles andere geht in den
 * Standardbrowser, und zwar nur http und https; mailto: an das Mailprogramm. Alles andere (file:, javascript:,
 * eigene Schemata anderer Programme) gar nicht.
 * @param {string} target
 * @param {string} origin
 * @returns {'window' | 'external' | 'deny'}
 */
export function linkTarget(target, origin) {
  let url
  try {
    url = new URL(target, origin)
  } catch {
    return 'deny'
  }
  if (url.origin === origin) return 'window'
  if (url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'mailto:') return 'external'
  return 'deny'
}

/**
 * Liegt das Ziel unter /uploads, ist es also ein Beleg (#517)? Belege kommen vom selben Ursprung wie die Oberfläche, sind
 * aber nicht von ihr: Ihr Fenster bekommt keine Brücke (`childWebPreferences`), und Anfragen aus ihnen lehnt das Fenster
 * ab (`trustedSender`). Der Pfad wird wie beim Server verglichen: ohne Rücksicht auf Groß und Klein (Express) und
 * dekodiert. Lieber einmal zu viel ein Beleg als einmal zu wenig.
 * @param {string} target
 * @param {string} origin
 * @returns {boolean}
 */
export function isReceipt(target, origin) {
  let url
  try {
    url = new URL(target, origin)
  } catch {
    return false
  }
  if (url.origin !== origin) return false
  let pathname = url.pathname
  try {
    pathname = decodeURIComponent(pathname)
  } catch {
    // Ein kaputtes %-Zeichen: so vergleichen, wie es dasteht
  }
  pathname = pathname.toLowerCase()
  return pathname === '/uploads' || pathname.startsWith('/uploads/')
}

/**
 * Eine Seite der Oberfläche: eigene Adresse und kein Beleg. Nur sie spricht mit dem Fenster.
 * @param {string} target
 * @param {string} origin
 */
export function isAppPage(target, origin) {
  return linkTarget(target, origin) === 'window' && !isReceipt(target, origin)
}

/**
 * Darf dieser Rahmen die Brücke benutzen (Drucken, Heimnetz, Ordnerwahl, Updates)? Nur der Hauptrahmen einer Seite der
 * Oberfläche. Die Prüfung allein genügt nicht: Ein Skript in einem gleich-ursprünglichen Rahmen erreicht die Brücke der
 * Oberfläche über `window.parent`, und die Anfrage kommt dann vom Hauptrahmen (nachgemessen mit Electron 45). Davor
 * schützt, dass ein Beleg nie gleich-ursprünglich ist: Der Server liefert ihn mit `Content-Security-Policy: sandbox`.
 * @param {{ url: string, parent: unknown } | null | undefined} frame `event.senderFrame`
 * @param {string | null} origin
 * @returns {boolean}
 */
export function trustedSender(frame, origin) {
  if (!origin || !frame || frame.parent !== null) return false
  return isAppPage(frame.url, origin)
}

/**
 * Die Einstellungen eines Fensters, das die Seite öffnet (Belege, ein Link mit Strg-Klick): wie das Hauptfenster
 * abgeschottet, ein Beleg aber ohne Preload und damit ohne Brücke. Electron erbt das Preload nicht, wenn es hier fehlt
 * (nachgemessen mit Electron 45). Was ein Fenster ohne Brücke öffnet (etwa ein Link im PDF eines Belegfensters), bleibt
 * ebenso ohne (Durchsicht).
 * @param {string} url
 * @param {string} origin
 * @param {string} preload
 * @param {boolean} [openerBridge] hat das öffnende Fenster die Brücke?
 * @returns {Electron.WebPreferences}
 */
export function childWebPreferences(url, origin, preload, openerBridge = true) {
  const isolated = { contextIsolation: true, sandbox: true, nodeIntegration: false }
  return !openerBridge || isReceipt(url, origin) ? isolated : { preload, ...isolated }
}

/**
 * Wohin eine Navigation im Fenster führt (`will-navigate`, `will-redirect`): Es bleibt auf der eigenen Seite (`stay`),
 * der Link geht an das Standardprogramm (`external`) oder nirgends hin (`deny`). Ein Beleg kommt aus einem Fenster mit
 * Brücke nie in dieses Fenster, sondern in ein eigenes ohne Preload (`receipt`, #517); das Fenster selbst bleibt stehen.
 * @param {string} target
 * @param {string | null} origin
 * @param {boolean} bridge hat das Fenster die Brücke (Preload)?
 * @returns {'stay' | 'receipt' | 'external' | 'deny'}
 */
export function navigationTarget(target, origin, bridge) {
  if (!origin) return 'deny'
  const where = linkTarget(target, origin)
  if (where !== 'window') return where
  return bridge && isReceipt(target, origin) ? 'receipt' : 'stay'
}

// Der eingebaute PDF-Betrachter von Chromium und Electron, eine feste Erweiterung (extension_misc::kPdfExtensionId)
const PDF_VIEWER = 'mhjfbmdgcfjbbpaeojofohoefgiehjai'

/**
 * Wohin darf ein eingebetteter Rahmen gehen (`will-frame-navigate`)? Auf die eigene Adresse und in den PDF-Betrachter:
 * Den lädt Electron als Rahmen unter dem PDF-Dokument, und ohne ihn bliebe jedes PDF im Fenster grau, in der
 * Belegvorschau wie im eigenen Fenster (nachgemessen mit Electron 45, #517). Andere Erweiterungen gibt es im Fenster
 * nicht und dürfen auch nicht.
 * @param {string} target
 * @param {string | null} origin
 * @returns {boolean}
 */
export function frameTarget(target, origin) {
  if (!origin) return false
  if (linkTarget(target, origin) === 'window') return true
  try {
    const url = new URL(target)
    return url.protocol === 'chrome-extension:' && url.hostname === PDF_VIEWER
  } catch {
    return false
  }
}

/**
 * Die Adressen fürs Handy bei Zugriff aus dem Heimnetz: je IPv4 einer äußeren Netzwerkkarte `http://<IP>:<port>`.
 * Ohne Loopback, ohne IPv6 (Adressen wie fe80::… tippt niemand ab) und ohne link-local 169.254.x.x: Die vergibt sich
 * eine Karte selbst, wenn kein Router antwortet, und unter ihr erreicht das Handy nichts.
 * @param {NodeJS.Dict<import('node:os').NetworkInterfaceInfo[]>} interfaces aus `os.networkInterfaces()`
 * @param {number} port
 * @returns {string[]}
 */
export function lanUrls(interfaces, port) {
  /** @type {string[]} */
  const urls = []
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      // Node bis 18.0 nannte die Familie als Zahl
      const ipv4 = entry.family === 'IPv4' || /** @type {unknown} */ (entry.family) === 4
      if (!ipv4 || entry.internal || entry.address.startsWith('169.254.')) continue
      const url = `http://${entry.address}:${port}`
      if (!urls.includes(url)) urls.push(url)
    }
  }
  return urls
}

/**
 * Der Stand des Zugriffs aus dem Heimnetz für die Oberfläche (`window.mietfuchsDesktop.network`). Die Adressen stehen
 * auch bei ausgeschaltetem Zugriff darin; ob sie gezeigt werden, entscheidet die Oberfläche.
 * @param {{ network?: unknown }} settings aus fenster.json
 * @param {number} port
 * @param {NodeJS.Dict<import('node:os').NetworkInterfaceInfo[]>} interfaces
 * @returns {{ enabled: boolean, port: number, addresses: string[] }}
 */
export function networkState(settings, port, interfaces) {
  return { enabled: settings.network === true, port, addresses: lanUrls(interfaces, port) }
}

/**
 * Die Dateien, ohne die der Server nicht startet: ausgeliefert das Bündel und das Frontend in der app.asar, beim
 * Entwickeln das Modul im Repo. Nach einem gescheiterten Start prüft das Fenster, ob es sie öffnen kann
 * (`findBlockedFile`).
 * @param {{ packaged: boolean, platform: NodeJS.Platform, resourcesPath: string, repoRoot: string }} where
 * @returns {string[]}
 */
export function programFiles(where) {
  const { modulePath } = serverModule(where)
  if (!where.packaged) return [modulePath]
  const p = where.platform === 'win32' ? path.win32 : path.posix
  return [modulePath, p.join(where.resourcesPath, APP_ARCHIVE, SERVER_FOLDER, 'client', 'dist.pack')]
}

// Woran ein Virenschutz zu erkennen ist: Er sperrt die Datei (EPERM, unter macOS und Linux auch EACCES) oder hat sie
// in die Quarantäne verschoben (ENOENT)
const BLOCKED_CODES = new Set(['EPERM', 'EACCES', 'ENOENT'])

/** @typedef {{ code: string, path: string }} BlockedFile */

/**
 * Die erste der Dateien, die sich nicht öffnen lässt, weil sie gesperrt ist oder fehlt. Die Ausgabe des Servers allein
 * genügt dafür nicht: Bei einem Fehler im Lesen aus der asar druckt Node erst eine Zeile von Electrons eigenem Quelltext,
 * rund 8 KB, und unter Linux kam die Meldung danach gar nicht mehr an.
 * @param {string[]} files
 * @param {(file: string) => void} [open] wirft wie `fs.openSync`
 * @returns {BlockedFile | null}
 */
export function findBlockedFile(files, open = (file) => fs.closeSync(fs.openSync(file, 'r'))) {
  for (const file of files) {
    try {
      open(file)
    } catch (err) {
      const code = /** @type {NodeJS.ErrnoException} */ (err)?.code
      if (code && BLOCKED_CODES.has(code)) return { code, path: file }
    }
  }
  return null
}

// Die Meldungen, die Node und Electron dafür drucken: je ein Muster und was daraus Code und Pfad sind
/** @type {{ re: RegExp, pick: (m: RegExpMatchArray, p: path.PlatformPath) => [string | undefined, string | undefined], escaped?: boolean }[]} */
const BLOCKED_PATTERNS = [
  // Node: „Error: EPERM: operation not permitted, open 'C:\…\server.mjs'“; der Pfad bis zum letzten Apostroph der
  // Zeile, er darf selbst einen enthalten (O'Brien)
  { re: /\b(EPERM|EACCES|ENOENT): [^,\n]*, \w+ '(.+)'(?= ->|\s*$)/gm, pick: (m) => [m[1], m[2]] },
  // Electrons asar: „Error: ENOENT, mietfuchs\client\dist.pack not found in C:\…\app.asar“
  { re: /\b(ENOENT), (.+?) not found in (.+?)\s*$/gm, pick: (m, p) => [m[1], m[3] && m[2] ? p.join(m[3], m[2]) : undefined] },
  // Electron, wenn sich die asar selbst nicht öffnen lässt: „Invalid package C:\…\app.asar“, ohne Code. Der
  // Hauptprozess liest sie ja (main.js liegt darin), gesperrt ist sie also für den Server.
  { re: /Invalid package (.+?\.asar)\b/gi, pick: (m) => ['EPERM', m[1]] },
  // Der Lader von Node, wenn das Modul fehlt: „Cannot find module 'C:\…\server.mjs' imported from …“
  { re: /Cannot find (?:module|package) '(.+?)'(?= imported|\s*$)/gm, pick: (m) => ['ENOENT', m[1]] },
  // Das Fehlerobjekt darunter: „code: 'EPERM', syscall: 'open', path: 'C:\\…'“, die Pfade doppelt maskiert und mit
  // Apostroph darin in doppelten Anführungszeichen. Electrons NO_ACCESS nennt den vollen Pfad nur hier.
  { re: /code: '(EPERM|EACCES|ENOENT)',[\s\S]{0,200}?path: (['"])(.+?)\2\s*$/gm, pick: (m) => [m[1], m[3]], escaped: true },
]

/**
 * Eine gesperrte oder fehlende Datei des Programms aus der Ausgabe des Servers. Nur Dateien unter dem Programmordner
 * zählen (unter Windows der Installationsordner, auf dem Mac Mietfuchs.app/Contents): Gesperrte Daten oder ein
 * belegter Port haben andere Gründe und behalten ihre Meldung.
 * @param {string} output
 * @param {string} programDir
 * @param {NodeJS.Platform} platform
 * @returns {BlockedFile | null}
 */
export function blockedFileIn(output, programDir, platform) {
  const p = platform === 'win32' ? path.win32 : path.posix
  // Windows und macOS unterscheiden Groß- und Kleinschreibung in Pfaden nicht
  const fold = (/** @type {string} */ text) => (platform === 'linux' ? text : text.toLowerCase())
  const root = fold(p.normalize(programDir + p.sep))
  for (const { re, pick, escaped } of BLOCKED_PATTERNS) {
    for (const match of output.matchAll(re)) {
      let [code, file] = pick(match, p)
      if (!code || !file) continue
      if (escaped) file = file.replaceAll('\\\\', '\\')
      if (fold(p.normalize(file)).startsWith(root)) return { code, path: file }
    }
  }
  return null
}

// Wie viele Zeichen einer Zeile die Meldung zeigt; das Protokoll hat alles
const LINE_LIMIT = 300

/**
 * Was der Dialog sagt, wenn der Server nicht startet. Ist eine Datei des Programms gesperrt oder fehlt, oben knapp der
 * Grund und was zu tun ist, mit der Datei, wie sie der Virenschutz nennt (die app.asar, nicht der Eintrag darin); die
 * technische Meldung steht klein darunter. Sonst die technische Meldung wie bisher.
 * @param {{ found: BlockedFile | null, technical: string, logDir: string, platform: NodeJS.Platform }} failure
 * @returns {{ title?: string, message: string, detail: string }}
 */
export function startFailure({ found, technical, logDir, platform }) {
  const text = technical.split('\n').map((line) => (line.length > LINE_LIMIT ? `${line.slice(0, LINE_LIMIT)} …` : line)).join('\n').trim()
  const log = `Das Protokoll liegt unter ${logDir}.`
  // Ein zweites Mietfuchs auf denselben Daten ist kein Fehler des Programms: nur der Satz, was zu tun ist (Durchsicht M2)
  const twin = twinIn(technical)
  if (twin) return { title: 'Mietfuchs läuft bereits', message: twin, detail: log }
  if (!found) return { message: text, detail: log }
  const file = fileOnDisk(found.path, platform)
  const reason = found.code === 'ENOENT'
    ? 'Eine Datei von Mietfuchs fehlt, vermutlich hat ein Virenschutzprogramm sie entfernt:'
    : 'Ein Virenschutzprogramm hat eine Datei von Mietfuchs blockiert:'
  return { message: `${reason}\n${file}\n\nGeben Sie die Datei dort frei oder installieren Sie Mietfuchs neu.`, detail: `${text}\n\n${log}` }
}

// Ein Eintrag in einem Archiv (…\app.asar\mietfuchs\server\server.mjs) ist auf der Platte das Archiv selbst
/** @param {string} file @param {NodeJS.Platform} platform */
function fileOnDisk(file, platform) {
  const sep = platform === 'win32' ? /[\\/]/ : /\//
  const parts = file.split(sep)
  const archive = parts.findIndex((part) => /\.asar$/i.test(part))
  return archive < 0 ? file : parts.slice(0, archive + 1).join(platform === 'win32' ? '\\' : '/')
}

/**
 * Das Ergebnis des Ordner-Dialogs für „Ordner der alten Programmdatei wählen …“ (Umzug der Daten, #517): der gewählte
 * Ordner oder `null`. Die Seite bekommt nur den Pfad; ob dort Daten liegen, prüft der Server.
 * @param {{ canceled: boolean, filePaths: string[] }} result aus `dialog.showOpenDialog`
 * @returns {string | null}
 */
export function chosenFolder(result) {
  if (result.canceled) return null
  const [first] = result.filePaths
  return typeof first === 'string' && first ? first : null
}

/**
 * Was der Dialog bei „Ordner der alten Programmdatei wählen …“ zulässt (#517): gewählt werden darf der Ordner, die
 * Programmdatei, `mietfuchs.sqlite`, `db.json` oder ein Backup; der Server liest jede dieser Antworten. Unter Windows
 * kann ein Dialog nicht beides, dort Dateien.
 * @param {NodeJS.Platform} platform
 * @returns {Array<'openDirectory' | 'openFile'>}
 */
export function folderDialogProperties(platform) {
  return platform === 'darwin' ? ['openDirectory', 'openFile'] : ['openFile']
}

/**
 * Was ein `before-quit` tut (#549, gefunden mit dem Protokoll des Fensters): `begin` beginnt das Beenden (Server über
 * /api/quit, dann app.exit), `wait` hält ein weiteres app.quit auf, solange das läuft, `allow` lässt Electron beenden.
 * Das Schließen des Fensters ruft app.quit zweimal (`closed` und `window-all-closed`); ließ der zweite Aufruf das
 * Beenden durch, endete der Hauptprozess und mit ihm der Server mitten im Leerlaufen seiner Schlange, und die Lauf-Datei
 * blieb liegen.
 * @param {{ quitting: boolean, exiting: boolean }} state
 * @returns {'begin' | 'wait' | 'allow'}
 */
export function quitDecision({ quitting, exiting }) {
  if (exiting) return 'allow'
  return quitting ? 'wait' : 'begin'
}

/**
 * Das Fenster vor einer Rückfrage des Systems zeigen (Mietfuchs im Heimnetz nicht erreichbar, main.js): aus Dock oder
 * Taskleiste zurückholen, wenn es dort liegt, und sichtbar machen, wenn es verborgen ist. Sonst sähe niemand die
 * Rückfrage, auf dem Mac ein Blatt am Fenster.
 * @param {{ isMinimized: () => boolean, restore: () => void, isVisible: () => boolean, show: () => void }} win
 */
export function surfaceWindow(win) {
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
}

/**
 * Die Kopplung mit einem Mietfuchs im Heimnetz, wie fenster.json sie merkt (#528, Schritt 2, pairing.js). `trust`:
 * `pinned` mit dem Fingerabdruck des Zertifikats von Mietfuchs, `system` (hinter einem Proxy, Kette und Name gegen den
 * Speicher des Systems) ohne.
 * @typedef {{ origin: string, trust: 'pinned' | 'system', certSha256: string | null, deviceId: string, deviceKey: string, version: string }} RemoteSettings
 */
/**
 * Die Einstellungen des Fensters in fenster.json (userData): gemerkter Port, Zugriff aus dem Heimnetz, die Antwort auf
 * „Programme“ (Mac) und die Kopplung.
 * @typedef {{ port?: number, network?: boolean, moveDeclined?: boolean, remote?: RemoteSettings }} WindowSettings
 */

/**
 * Eine gemerkte Kopplung, nur wenn jedes Feld stimmt; sonst `null`, und das Fenster zeigt den eigenen Server. Die
 * Prüfung hält auch Unsinn aus der Kopfzeile fern (`<id>.<Schlüssel>`, kein Zeilenumbruch, kein Punkt in der Kennung).
 * Eine Kopplung von vorher ohne `trust` gilt als `pinned`; `system` mit Fingerabdruck, `pinned` ohne und ein unbekanntes
 * `trust` ergeben keine.
 * @param {unknown} value
 * @returns {RemoteSettings | null}
 */
export function remoteOf(value) {
  if (!value || typeof value !== 'object') return null
  const { origin, trust = 'pinned', certSha256, deviceId, deviceKey, version } = /** @type {Record<string, unknown>} */ (value)
  if (typeof origin !== 'string' || typeof deviceId !== 'string' || typeof deviceKey !== 'string' || typeof version !== 'string') return null
  if (trust === 'system' ? certSha256 !== null : trust !== 'pinned' || typeof certSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(certSha256)) return null
  try {
    const url = new URL(origin)
    if (url.protocol !== 'https:' || url.origin !== origin) return null
  } catch {
    return null
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(deviceId) || !/^[A-Za-z0-9_-]{16,256}$/.test(deviceKey)) return null
  return trust === 'system' ? { origin, trust, certSha256: null, deviceId, deviceKey, version } : { origin, trust: 'pinned', certSha256: /** @type {string} */ (certSha256), deviceId, deviceKey, version }
}

/**
 * fenster.json lesen. Fehlt sie oder ist sie kaputt, gilt nichts; eine kaputte Kopplung fällt allein weg.
 * @param {string} file
 * @returns {WindowSettings}
 */
export function readSettingsFile(file) {
  /** @type {unknown} */
  let value
  try {
    value = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const { remote, ...rest } = /** @type {WindowSettings & { remote?: unknown }} */ (value)
  const pairing = remote === undefined ? null : remoteOf(remote)
  return pairing ? { ...rest, remote: pairing } : rest
}

// Unter Windows hält ein Virenscanner oder die Indexsuche eine frisch geschriebene Datei oft kurz offen, dann scheitert
// das Umbenennen mit EPERM, EBUSY oder EACCES; zwei weitere Versuche nach kurzer Pause genügen dafür
const RENAME_RETRIES = 2
const RENAME_PAUSE_MS = 100
const RENAME_BUSY = new Set(['EPERM', 'EBUSY', 'EACCES'])

/**
 * fenster.json schreiben, nur für den Benutzer lesbar (0600; darin steht der Geräteschlüssel), über eine Zwischendatei
 * und Umbenennen, damit ein Absturz mittendrin keine halbe Datei hinterlässt. Unter Windows schützt der Benutzerordner.
 * @param {string} file
 * @param {WindowSettings} settings
 * @param {{ platform?: NodeJS.Platform, rename?: (from: string, to: string) => void, pause?: (ms: number) => void }} [options] für Tests
 */
export function writeSettingsFile(file, settings, { platform = process.platform, rename = fs.renameSync, pause = sleepSync } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.neu`
  try {
    fs.writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 })
    fs.chmodSync(temp, 0o600)
    for (let attempt = 0; ; attempt++) {
      try {
        rename(temp, file)
        break
      } catch (err) {
        const code = /** @type {NodeJS.ErrnoException} */ (err)?.code
        if (platform !== 'win32' || attempt >= RENAME_RETRIES || !code || !RENAME_BUSY.has(code)) throw err
        pause(RENAME_PAUSE_MS)
      }
    }
  } catch (err) {
    fs.rmSync(temp, { force: true })
    throw err
  }
}

// Kurz warten, ohne Ereignisschleife (nur beim Schreiben von fenster.json, höchstens zweimal 100 ms)
/** @param {number} ms */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

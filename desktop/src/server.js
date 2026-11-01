// Der Server im Programmfenster (#517): der Server von Mietfuchs aus dem Quellcode, mit Electrons eigenem Node als
// utilityProcess. Hier steht, was sich ohne Electron prüfen lässt (desktop/test/server.test.js): welches Modul, mit
// welcher Umgebung, auf welchem Port, und woran man erkennt, dass er bereit ist. main.js setzt es zusammen.
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'

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
 * @param {{ port: number, network: boolean, packaged: boolean, windowsStore: boolean, repoRoot: string, platform: NodeJS.Platform }} options
 * @returns {NodeJS.ProcessEnv}
 */
export function serverEnv(base, { port, network, packaged, windowsStore, repoRoot, platform }) {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...base, NKA_DESKTOP: '1', NKA_PORT: String(port), NKA_HOST: network ? '0.0.0.0' : '127.0.0.1' }
  // Electron setzt das für sich selbst; erbte es der Server, liefe Node darin als nacktes Node
  delete env.ELECTRON_RUN_AS_NODE
  // Eine geerbte Betriebsart (etwa docker aus einer Shell) gilt im Fenster nicht
  delete env.NKA_RUNTIME
  delete env.NKA_STORE
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
 * @returns {{ message: string, detail: string }}
 */
export function startFailure({ found, technical, logDir, platform }) {
  const text = technical.split('\n').map((line) => (line.length > LINE_LIMIT ? `${line.slice(0, LINE_LIMIT)} …` : line)).join('\n').trim()
  const log = `Das Protokoll liegt unter ${logDir}.`
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

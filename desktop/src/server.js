// Der Server im Programmfenster (#517): der Server von Mietfuchs aus dem Quellcode, mit Electrons eigenem Node als
// utilityProcess. Hier steht, was sich ohne Electron prüfen lässt (desktop/test/server.test.js): welches Modul, mit
// welcher Umgebung, auf welchem Port, und woran man erkennt, dass er bereit ist. main.js setzt es zusammen.
import net from 'node:net'
import path from 'node:path'

// Fester Port, damit die Adresse gleich bleibt: Im Browser gespeicherte Entwürfe und Einstellungen hängen an Adresse
// samt Port, und wer aus dem Heimnetz zugreift, setzt ein Lesezeichen. 17517 ist bei der IANA nicht vergeben, kein
// gängiger Entwicklungsport und liegt unter den Bereichen, aus denen Windows (ab 49152) und Linux (ab 32768) Ports
// für ausgehende Verbindungen vergeben. Die Programmdatei ohne Fenster bleibt bei 3001.
export const DEFAULT_PORT = 17517

// Der Ordner unter resources, in dem der Server ausgeliefert liegt, drei Dateien in der Anordnung des Repos: das Bündel
// server/server.mjs (Server, shared/, Abhängigkeiten und Migrationen), die Lizenzen der Abhängigkeiten daneben und das
// Frontend als eine Datei, client/dist.pack. scripts/package-desktop.mjs legt ihn an, desktop/package.json (`extraResources`) nimmt ihn mit.
export const SERVER_FOLDER = 'mietfuchs'

// Der Name des utilityProcess in app.getAppMetrics() (Speicher in der Selbstprüfung) und in child-process-gone
export const SERVICE_NAME = 'Mietfuchs-Server'

/**
 * Welches Modul als Server läuft und in welchem Ordner: ausgeliefert das Bündel unter resources/mietfuchs, beim
 * Entwickeln die Quellen im Repo (Node streift die Typen ab wie bei `npm start`, ein Bauschritt entfällt). Beides
 * derselbe Weg, `utilityProcess.fork` mit Electrons eigenem Node. Gebündelt startet der Server rund eine Sekunde
 * schneller, weil Node eine Datei lädt statt rund 470 und keine Typen abstreift.
 * @param {{ packaged: boolean, platform: NodeJS.Platform, resourcesPath: string, repoRoot: string }} where
 * @returns {{ modulePath: string, cwd: string }}
 */
export function serverModule({ packaged, platform, resourcesPath, repoRoot }) {
  // Nach der genannten Plattform rechnen, nicht nach der des laufenden Rechners (CLAUDE.md, Konventionen)
  const p = platform === 'win32' ? path.win32 : path.posix
  if (packaged) {
    const cwd = p.join(resourcesPath, SERVER_FOLDER, 'server')
    return { modulePath: p.join(cwd, 'server.mjs'), cwd }
  }
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

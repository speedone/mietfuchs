// Der Server im Programmfenster (#517): die Programmdatei von Mietfuchs als Kindprozess. Hier steht, was sich ohne
// Electron prüfen lässt (desktop/test/server.test.js): welche Datei, mit welcher Umgebung, auf welchem Port, und woran
// man erkennt, dass sie bereit ist. main.js setzt es zusammen.
import net from 'node:net'
import path from 'node:path'

// Fester Port, damit die Adresse gleich bleibt: Im Browser gespeicherte Entwürfe und Einstellungen hängen an Adresse
// samt Port, und wer aus dem Heimnetz zugreift, setzt ein Lesezeichen. 17517 ist bei der IANA nicht vergeben, kein
// gängiger Entwicklungsport und liegt unter den Bereichen, aus denen Windows (ab 49152) und Linux (ab 32768) Ports
// für ausgehende Verbindungen vergeben. Die Programmdatei ohne Fenster bleibt bei 3001.
export const DEFAULT_PORT = 17517

/**
 * Welche Datei als Server läuft. Ausgeliefert die Programmdatei im Paket: unter Windows in resources\server (dort
 * erkennt sie auch den Store), auf dem Mac neben dem Fenster in Contents/MacOS, weil macOS ausführbaren Code dort
 * erwartet und mitsigniert. Beim Entwickeln der Server aus dem Quellcode mit dem Node, das ihn auch sonst startet.
 * @param {{ packaged: boolean, platform: NodeJS.Platform, resourcesPath: string, execPath: string, repoRoot: string }} where
 * @returns {{ command: string, args: string[] }}
 */
export function serverCommand({ packaged, platform, resourcesPath, execPath, repoRoot }) {
  // Nach der genannten Plattform rechnen, nicht nach der des laufenden Rechners (CLAUDE.md, Konventionen)
  const p = platform === 'win32' ? path.win32 : path.posix
  if (!packaged) return { command: process.env.MIETFUCHS_NODE || 'node', args: [p.join(repoRoot, 'server', 'src', 'index.ts')] }
  if (platform === 'win32') return { command: p.join(resourcesPath, 'server', 'mietfuchs.exe'), args: [] }
  return { command: p.join(p.dirname(execPath), 'mietfuchs-server'), args: [] }
}

/**
 * Die Umgebung des Servers: alles vom Fenster (so erreichen CI, NKA_DATA_DIR und NKA_UPDATE_URL einer Prüfung den
 * Server), dazu Betriebsart, Port und Adresse. Ohne Zugriff aus dem Heimnetz nur 127.0.0.1, dann fragt unter Windows
 * auch keine Firewall.
 * @param {NodeJS.ProcessEnv} base
 * @param {{ port: number, network: boolean, packaged: boolean }} options
 * @returns {NodeJS.ProcessEnv}
 */
export function serverEnv(base, { port, network, packaged }) {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...base, NKA_DESKTOP: '1', NKA_PORT: String(port), NKA_HOST: network ? '0.0.0.0' : '127.0.0.1' }
  // Electron setzt das für sich selbst; erbte es der Server, liefe Node darin als nacktes Node
  delete env.ELECTRON_RUN_AS_NODE
  // Aus dem Quellcode erkennt der Server das Fenster nicht an Bun, sondern an der Angabe
  if (!packaged) env.NKA_RUNTIME = 'desktop'
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

// Auf allen Adressen, wie der Server mit Zugriff aus dem Heimnetz: Windows ließe sonst eine zweite Bindung an 0.0.0.0
// neben einer an 127.0.0.1 zu, und der Port gälte als frei, obwohl er es nicht ist.
/** @param {number} port @returns {Promise<boolean>} */
export function canListen(port) {
  return new Promise((resolve) => {
    const probe = net.createServer()
    probe.once('error', () => resolve(false))
    probe.listen(port, () => probe.close(() => resolve(true)))
  })
}

/** @returns {Promise<number>} */
export function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, () => {
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

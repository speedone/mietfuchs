// Das Programmfenster mit einem Mietfuchs im Heimnetz koppeln (#528, Schritt 2), ohne Electron und damit in
// desktop/test/pairing.test.js gegen einen echten Server geprüft. main.js setzt es zusammen.
//
// Vorbild Syncthing: Der Server hat ein eigenes Zertifikat, das Fenster merkt sich beim Koppeln dessen Fingerabdruck
// (SHA-256 des DER) und nimmt danach unter dieser Adresse nur noch genau dieses an. Dass es beim ersten Verbinden das
// richtige ist, beweist der Code aus den Einstellungen des Servers: Das Fenster rechnet mit ihm einen HMAC über den
// Fingerabdruck, den es sieht, und der Server prüft ihn gegen sein eigenes Zertifikat. Ein Mittelsmann mit eigenem
// Zertifikat bekommt einen Beweis für seins und kann ihn ohne Code nicht umrechnen; der Code geht nie über die Leitung.
import crypto from 'node:crypto'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import tls from 'node:tls'
import { remoteOf } from './server.js'

// Der Port der Programmdatei und des Docker-Images, wenn die Adresse keinen nennt
export const DEFAULT_REMOTE_PORT = 3001
// Die Kopfzeile mit dem Geräteschlüssel (DEVICE_HEADER in server/src/access.ts)
export const DEVICE_HEADER = 'x-mietfuchs-device'
// Wie lange eine Anfrage an den Server höchstens dauert
const TIMEOUT_MS = 10_000

/**
 * Ein Satz für die Karte „Mietfuchs im Heimnetz“, mit dem Feld, an dem es liegt; ohne `field`, wenn es kein einzelnes ist.
 * @typedef {{ problem: string, field?: 'address' | 'code' }} Problem
 */

const ADDRESS_PROBLEM = 'Diese Adresse lässt sich nicht lesen. Geben Sie sie so ein, wie Sie Mietfuchs im Browser öffnen, etwa nas:3001 oder 192.168.1.5:3001.'

/**
 * Die Adresse aus der Karte „Mietfuchs im Heimnetz“: `nas`, `nas:3001`, `http://192.168.1.5:3001/` oder
 * `https://[fd00::1]:3001`. Das Schema zählt nicht, das Fenster nimmt immer `https://` auf demselben Port (der Server
 * spricht dort beides); ohne Port 3001. `host` ohne Klammern (für Node), `origin` wie `new URL(…).origin`.
 * @param {string} input
 * @returns {{ host: string, port: number, origin: string } | Problem}
 */
export function normalizeAddress(input) {
  const text = typeof input === 'string' ? input.trim() : ''
  if (!text) return { problem: 'Geben Sie die Adresse ein, unter der Mietfuchs im Heimnetz läuft, etwa nas:3001.', field: 'address' }
  const scheme = text.match(/^([a-z][a-z0-9+.-]*):\/\//i)?.[1]?.toLowerCase()
  if (scheme !== undefined && scheme !== 'http' && scheme !== 'https') return { problem: ADDRESS_PROBLEM, field: 'address' }
  const rest = scheme === undefined ? text : text.slice(scheme.length + 3)
  // Der Teil bis zum ersten /, ? oder #; der Port wird hier gelesen, weil URL einen Port 80 oder 443 still wegließe
  const authority = rest.split(/[/?#]/)[0] ?? ''
  if (!authority || authority.includes('@') || /\s/.test(authority)) return { problem: ADDRESS_PROBLEM, field: 'address' }
  const portText = authority.match(/^(?:\[[^\]]*\]|[^:]*):(\d*)$/)?.[1]
  if (portText === undefined && /:/.test(authority.replace(/^\[[^\]]*\]/, ''))) return { problem: ADDRESS_PROBLEM, field: 'address' }
  const port = portText === undefined ? DEFAULT_REMOTE_PORT : Number(portText)
  if (!Number.isInteger(port) || port < 1 || port > 65535 || portText === '') return { problem: ADDRESS_PROBLEM, field: 'address' }
  let url
  try {
    url = new URL(`https://${authority}`)
  } catch {
    return { problem: ADDRESS_PROBLEM, field: 'address' }
  }
  if (!url.hostname) return { problem: ADDRESS_PROBLEM, field: 'address' }
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1')
  return { host, port, origin: new URL(`https://${url.hostname}:${port}`).origin }
}

// Wie der Server den Code liest (normalizeCode in server/src/access.ts): groß, nur Buchstaben und Ziffern. Der Server
// liegt im Fenster nur gebündelt vor, deshalb hier nachgebaut; pairing.test.js koppelt gegen den echten Server.
/** @param {string} code */
const normalizeCode = (code) => (typeof code === 'string' ? code.toUpperCase().replace(/[^A-Z0-9]/g, '') : '')

// Der Beweis (pairingProof in server/src/access.ts): HMAC-SHA256, Schlüssel der Code, über den Fingerabdruck
/** @param {string} code @param {string} certSha256 */
const proofOf = (code, certSha256) => crypto.createHmac('sha256', normalizeCode(code)).update(`mietfuchs-kopplung:${certSha256}`).digest('hex')

/** @param {Buffer} der */
const sha256 = (der) => crypto.createHash('sha256').update(der).digest('hex')

/**
 * Der Fingerabdruck eines Zertifikats im PEM-Format, wie Electron es in `setCertificateVerifyProc` liefert
 * (`request.certificate.data`): SHA-256 des DER in Kleinbuchstaben-Hex. Wirft bei allem, was kein Zertifikat ist.
 * @param {string} pem
 * @returns {string}
 */
export function certSha256FromPem(pem) {
  const body = typeof pem === 'string' ? pem.match(/-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/)?.[1] : undefined
  const base64 = body?.replace(/\s+/g, '') ?? ''
  if (!base64 || !/^[A-Za-z0-9+/]+=*$/.test(base64)) throw new Error('Kein Zertifikat im PEM-Format.')
  return sha256(Buffer.from(base64, 'base64'))
}

/** @typedef {{ status: number, body: string }} Answer */

/**
 * Eine TLS-Verbindung zum Server und der Fingerabdruck seines Zertifikats. Mit `expected` nur, wenn der Fingerabdruck
 * passt; sonst wird die Verbindung geschlossen, bevor ein Byte der Anfrage hinausgeht.
 *
 * **Warum ohne Prüfung der Kette (`rejectUnauthorized: false`)**: Das Zertifikat des Servers ist selbst ausgestellt und
 * nennt nur localhost; keine Kette und kein Name könnten es bestätigen. Beim ersten Kontakt (Koppeln) gilt Trust on
 * First Use: Das Fenster liest den Fingerabdruck, und der Beweis mit dem Code bindet ihn an den echten Server (siehe
 * oben); ein falsches Zertifikat ergibt einen Beweis, den der Server ablehnt. Danach zählt nur der gemerkte
 * Fingerabdruck (`expected`), strenger als jede Kette. Die Seite im Fenster prüft ihn ebenso über Electron
 * (`pinDecision`, setCertificateVerifyProc in main.js).
 * @param {{ host: string, port: number }} target
 * @param {string | null} expected
 * @param {number} timeoutMs
 * @returns {Promise<{ socket: tls.TLSSocket, certSha256: string }>}
 */
function connectTls({ host, port }, expected, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host,
      port,
      // SNI nur mit einem Namen, nie mit einer IP (Node warnt sonst)
      ...(net.isIP(host) ? {} : { servername: host }),
      // Trust on First Use mit Beweis, danach der Fingerabdruck (siehe oben)
      rejectUnauthorized: false,
      timeout: timeoutMs,
    })
    socket.once('timeout', () => socket.destroy(Object.assign(new Error('Zeitüberschreitung'), { code: 'ETIMEDOUT' })))
    socket.once('error', reject)
    socket.once('secureConnect', () => {
      const raw = socket.getPeerCertificate(true)?.raw
      if (!raw) {
        socket.destroy()
        return reject(new Error('Der Server zeigt kein Zertifikat.'))
      }
      const certSha256 = sha256(raw)
      if (expected !== null && certSha256 !== expected) {
        socket.destroy()
        return reject(Object.assign(new Error('Der Server zeigt ein anderes Zertifikat als beim Koppeln.'), { code: 'CERT_CHANGED' }))
      }
      socket.off('error', reject)
      socket.setTimeout(0)
      resolve({ socket, certSha256 })
    })
  })
}

/**
 * Eine HTTP-Anfrage über eine schon geprüfte TLS-Verbindung (eine Anfrage je Verbindung).
 * @param {tls.TLSSocket} socket
 * @param {{ host: string, port: number, method?: string, path: string, headers?: Record<string, string>, body?: string, timeoutMs: number }} request
 * @returns {Promise<Answer>}
 */
function requestOver(socket, { host, port, method = 'GET', path, headers = {}, body, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const all = { accept: 'application/json', ...headers, ...(body !== undefined ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) } : {}) }
    const req = http.request({ host: net.isIPv6(host) ? `[${host}]` : host, port, method, path, headers: { ...all, host: `${net.isIPv6(host) ? `[${host}]` : host}:${port}` }, createConnection: () => socket, timeout: timeoutMs }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { text += chunk })
      res.on('end', () => {
        socket.destroy()
        resolve({ status: res.statusCode ?? 0, body: text })
      })
      res.on('error', reject)
    })
    req.on('timeout', () => req.destroy(Object.assign(new Error('Zeitüberschreitung'), { code: 'ETIMEDOUT' })))
    req.on('error', (err) => {
      socket.destroy()
      reject(err)
    })
    req.end(body)
  })
}

/**
 * Eine Anfrage an den gekoppelten Server, nur mit dem gemerkten Zertifikat und mit dem Geräteschlüssel: für Version und
 * Anmeldestand beim Start und das Entfernen des eigenen Geräts beim Trennen. Wirft, wenn der Server nicht erreichbar
 * ist oder ein anderes Zertifikat zeigt (`code` `CERT_CHANGED`).
 * @param {{ origin: string, certSha256: string, deviceId?: string, deviceKey?: string }} remote
 * @param {string} urlPath
 * @param {{ method?: string, body?: string, timeoutMs?: number }} [options]
 * @returns {Promise<Answer>}
 */
export async function remoteFetch(remote, urlPath, { method = 'GET', body, timeoutMs = TIMEOUT_MS } = {}) {
  const url = new URL(urlPath, remote.origin)
  const target = { host: url.hostname.replace(/^\[(.*)\]$/, '$1'), port: Number(url.port || 443) }
  const { socket } = await connectTls(target, remote.certSha256, timeoutMs)
  /** @type {Record<string, string>} */
  const headers = remote.deviceId && remote.deviceKey ? { [DEVICE_HEADER]: `${remote.deviceId}.${remote.deviceKey}` } : {}
  return requestOver(socket, { ...target, method, path: `${url.pathname}${url.search}`, headers, body, timeoutMs })
}

// Eine Antwort als JSON oder null (auch für main.js)
/** @param {string} text */
export const jsonOr = (text) => {
  try {
    return /** @type {any} */ (JSON.parse(text))
  } catch {
    return null
  }
}

// Fehler beim Verbinden, die heißen: Dort lauscht nichts, oder der Rechner ist nicht da
const UNREACHABLE = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EHOSTDOWN', 'ENETDOWN', 'EADDRNOTAVAIL'])

/**
 * Antwortet dort ein Mietfuchs über HTTP (eine Fassung vor 0.17 oder einer ohne beschreibbaren Ordner für das
 * Zertifikat)? Nur `/healthz`, ohne Schlüssel und ohne Code.
 * @param {{ host: string, port: number }} target
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
function mietfuchsOverHttp({ host, port }, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get({ host, port, path: '/healthz', timeout: timeoutMs, headers: { accept: 'application/json' } }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { text += chunk })
      res.on('end', () => resolve(jsonOr(text)?.app === 'mietfuchs'))
      res.on('error', () => resolve(false))
    })
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(false))
  })
}

/**
 * @typedef {{ origin: string, certSha256: string, deviceId: string, deviceKey: string, version: string }} Remote
 */

/**
 * Koppeln: TLS verbinden und den Fingerabdruck lesen, an `/healthz` erkennen, dass dort Mietfuchs antwortet, den
 * Beweis rechnen und `POST /api/auth/pair` über eine Verbindung mit demselben Zertifikat schicken. Ergibt, was
 * fenster.json als `remote` merkt, oder einen Satz für die Karte.
 * @param {{ address: string, code: string, name?: string, timeoutMs?: number }} request
 * @returns {Promise<Remote | Problem>}
 */
export async function pair({ address, code, name = os.hostname(), timeoutMs = TIMEOUT_MS }) {
  const where = normalizeAddress(address)
  if ('problem' in where) return where
  if (!normalizeCode(code)) return { problem: 'Geben Sie den Code ein, den Mietfuchs auf dem Server unter Einstellungen, Anmeldung zeigt.', field: 'code' }
  const shown = where.port === 443 ? where.host : `${where.host.includes(':') ? `[${where.host}]` : where.host}:${where.port}`
  const unreachable = { problem: `Unter ${shown} ist Mietfuchs nicht erreichbar. Prüfen Sie die Adresse und ob Mietfuchs dort läuft.`, field: /** @type {const} */ ('address') }
  const notMietfuchs = { problem: `Unter ${shown} antwortet kein Mietfuchs. Prüfen Sie die Adresse und den Port.`, field: /** @type {const} */ ('address') }

  /** @type {string} */
  let certSha256
  /** @type {Answer} */
  let health
  try {
    const first = await connectTls(where, null, timeoutMs)
    certSha256 = first.certSha256
    health = await requestOver(first.socket, { ...where, path: '/healthz', timeoutMs })
  } catch (err) {
    const errCode = /** @type {NodeJS.ErrnoException} */ (err)?.code
    if (errCode && UNREACHABLE.has(errCode)) return unreachable
    // Verbunden, aber kein TLS: ein älterer Mietfuchs, der nur HTTP spricht, oder etwas ganz anderes
    if (await mietfuchsOverHttp(where, timeoutMs)) {
      return { problem: `Mietfuchs unter ${shown} antwortet nur über HTTP, ohne HTTPS lässt sich nicht koppeln. Aktualisieren Sie Mietfuchs dort auf Version 0.17 oder neuer.`, field: 'address' }
    }
    return errCode === 'ECONNRESET' ? unreachable : notMietfuchs
  }
  if (jsonOr(health.body)?.app !== 'mietfuchs') return notMietfuchs

  /** @type {Answer} */
  let answer
  try {
    const second = await connectTls(where, certSha256, timeoutMs)
    answer = await requestOver(second.socket, { ...where, method: 'POST', path: '/api/auth/pair', body: JSON.stringify({ name, proof: proofOf(code, certSha256) }), timeoutMs })
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err)?.code === 'CERT_CHANGED') return { problem: 'Der Server hat während des Koppelns ein anderes Zertifikat gezeigt. Versuchen Sie es noch einmal; geschieht das wieder, koppeln Sie nicht.' }
    return unreachable
  }
  const body = jsonOr(answer.body)
  if (answer.status === 200 && body && typeof body === 'object') {
    const paired = { origin: where.origin, certSha256, deviceId: body.id, deviceKey: body.deviceKey, version: typeof body.version === 'string' ? body.version : '' }
    // Nur, was fenster.json auch wieder liest (remoteOf); sonst wäre die Kopplung beim nächsten Start still weg. Das
    // eben angelegte Gerät dann beste Mühe wieder entfernen, wenn sich mit ihm eine Kopfzeile bauen lässt.
    const valid = remoteOf(paired)
    if (valid) return valid
    const headerSafe = (/** @type {unknown} */ v) => typeof v === 'string' && /^[A-Za-z0-9_-]+$/.test(v)
    if (headerSafe(body.id) && headerSafe(body.deviceKey)) {
      await remoteFetch({ origin: where.origin, certSha256, deviceId: body.id, deviceKey: body.deviceKey }, `/api/auth/devices/${encodeURIComponent(body.id)}`, { method: 'DELETE', timeoutMs })
        .catch(() => {})
    }
    return { problem: 'Das Koppeln ist gescheitert: Die Antwort des Servers ließ sich nicht verwenden. Ist Mietfuchs dort auf dem neuesten Stand?' }
  }
  if (typeof body?.error === 'string' && body.error) {
    // Ohne Passwort am Server sagt die Karte, wo es festgelegt wird
    if (answer.status === 409 && /Passwort/.test(body.error)) return { problem: `${body.error} Ein Programmfenster koppelt sich nur mit einem Mietfuchs, der durch ein Passwort geschützt ist (dort unter Einstellungen, Anmeldung).` }
    // 400 heißt an dieser Route: Der Code stimmt nicht oder ist abgelaufen (die andere 400, „nur über eine verschlüsselte
    // Verbindung“, kann hier nicht kommen, das Fenster koppelt nur über TLS). 409 (kein Passwort, zu viele Geräte) und
    // 429 (Bremse) betreffen kein Feld.
    return answer.status === 400 ? { problem: body.error, field: 'code' } : { problem: body.error }
  }
  return { problem: `Das Koppeln ist gescheitert (Antwort ${answer.status}).` }
}

/**
 * Wie Electron ein Zertifikat behandelt (`setCertificateVerifyProc`): Für den gekoppelten Host gilt nur das gemerkte
 * Zertifikat (`accept`, sonst `reject`), für jeden anderen Host und ohne Kopplung die normale Prüfung (`default`).
 * Electron nennt nur den Host, nicht den Port: Gepinnt wird deshalb je Host, auf jedem Port; der Geräteschlüssel geht
 * trotzdem nur an den Ursprung samt Port (main.js).
 * @param {string} hostname
 * @param {string} certSha256
 * @param {{ origin: string, certSha256: string } | null} remote
 * @returns {'accept' | 'reject' | 'default'}
 */
export function pinDecision(hostname, certSha256, remote) {
  if (!remote) return 'default'
  /** @param {string} host */
  const bare = (host) => host.replace(/^\[(.*)\]$/, '$1').toLowerCase()
  let pinned
  try {
    pinned = bare(new URL(remote.origin).hostname)
  } catch {
    return 'default'
  }
  if (bare(String(hostname)) !== pinned) return 'default'
  return certSha256 === remote.certSha256 ? 'accept' : 'reject'
}

/** @param {string} version */
const majorMinor = (version) => {
  const match = typeof version === 'string' ? version.trim().match(/^v?(\d+)\.(\d+)\.\d+/) : null
  return match ? `${Number(match[1])}.${Number(match[2])}` : null
}

/**
 * Der Hinweis, wenn Fenster und Server nicht zusammenpassen (anderes major.minor), einmal je Start; verbunden wird
 * trotzdem. Bei einer unlesbaren Version kein Hinweis.
 * @param {string} windowVersion
 * @param {string} serverVersion
 * @returns {string | null}
 */
export function versionHint(windowVersion, serverVersion) {
  const own = majorMinor(windowVersion)
  const theirs = majorMinor(serverVersion)
  if (!own || !theirs || own === theirs) return null
  return `Dieses Programmfenster hat Version ${windowVersion}, Mietfuchs auf dem Server Version ${serverVersion}. Aktualisieren Sie das ältere der beiden, damit Fenster und Server zusammenpassen.`
}

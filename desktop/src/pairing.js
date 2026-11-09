// Das Programmfenster mit einem Mietfuchs im Heimnetz koppeln (#528, Schritt 2), ohne Electron und damit in
// desktop/test/pairing.test.js gegen einen echten Server geprüft. main.js setzt es zusammen.
//
// Vorbild Syncthing: Der Server hat ein eigenes Zertifikat, das Fenster merkt sich beim Koppeln dessen Fingerabdruck
// (SHA-256 des DER) und nimmt danach unter dieser Adresse nur noch genau dieses an. Dass es beim ersten Verbinden das
// richtige ist, beweist der Code aus den Einstellungen des Servers: Das Fenster rechnet mit ihm einen HMAC über den
// Fingerabdruck, den es sieht, und der Server prüft ihn gegen sein eigenes Zertifikat. Ein Mittelsmann mit eigenem
// Zertifikat bekommt einen Beweis für seins und kann ihn ohne Code nicht umrechnen; der Code geht nie über die Leitung.
//
// Hinter einem Reverse Proxy wie Caddy (Erweiterung, docs/superpowers/specs/2026-11-09-kopplung-proxy-design.md) zeigt
// der Proxy sein eigenes Zertifikat. Das Fenster erkennt beim ersten Kontakt die Vertrauensart: `pinned`, wenn es das
// Zertifikat von Mietfuchs sieht (direkt oder vom Proxy ausgeliefert), sonst `system`, wenn Kette und Name gegen den
// Speicher des Systems stimmen (Let's Encrypt, ein installiertes Stammzertifikat); dann bindet der Beweis an den
// Ursprung, und danach prüft jede Verbindung Kette und Name statt eines Fingerabdrucks.
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
 * Wie sich das Fenster den Server merkt: `pinned` mit dem Fingerabdruck des Zertifikats von Mietfuchs, `system` mit
 * Kette und Name gegen den Speicher des Systems (Zertifikat des Proxys).
 * @typedef {'pinned' | 'system'} Trust
 */

/** @type {string[] | null} */
let trustCache = null
/**
 * Warum der Speicher des Systems fehlt (`getCACertificates('system')` warf), sonst `null`. Gilt erst nach dem ersten
 * Aufruf von `systemTrust`.
 * @type {string | null}
 */
export let systemTrustProblem = null

/**
 * Die Vertrauensanker für `system`: die Stammzertifikate, die Node mitbringt, und die des Systems (unter Windows und
 * macOS liest Node den Speicher des Systems, unter Linux die üblichen Dateien). Einmal gerechnet. Wirft das Lesen des
 * Systems, bleiben die von Node, und `systemTrustProblem` sagt warum.
 * @returns {string[]}
 */
export function systemTrust() {
  if (trustCache) return trustCache
  const defaults = tls.getCACertificates('default')
  try {
    trustCache = [...defaults, ...tls.getCACertificates('system')]
  } catch (err) {
    systemTrustProblem = /** @type {Error} */ (err)?.message || String(err)
    trustCache = [...defaults]
  }
  return trustCache
}

/**
 * Ein Satz für die Karte „Mietfuchs im Heimnetz“, mit dem Feld, an dem es liegt; ohne `field`, wenn es kein einzelnes ist.
 * @typedef {{ problem: string, field?: 'address' | 'code' }} Problem
 */

// Der Satz der Host-Prüfung (hostRefusal in server/src/requestGuard.ts), genau so; der Name nur aus Zeichen eines
// Rechnernamens mit Port (auch IPv6 in Klammern), höchstens so lang wie ein DNS-Name mit Port, also nie eine URL
const HOST_REFUSAL = /^Mietfuchs antwortet nicht unter dem Namen „[A-Za-z0-9.:\[\]%_-]{1,260}“\. Erreichbar ist es unter seiner IP-Adresse, unter localhost und unter Namen im Heimnetz\. Einen eigenen Namen tragen Sie in NKA_ALLOWED_HOSTS ein\.$/

const ADDRESS_PROBLEM = 'Diese Adresse lässt sich nicht lesen. Geben Sie sie so ein, wie Sie Mietfuchs im Browser öffnen, etwa nas:3001, 192.168.1.5:3001 oder https://nas.fritz.box.'

/**
 * Die Adresse aus der Karte „Mietfuchs im Heimnetz“: `nas`, `nas:3001`, `http://192.168.1.5:3001/`,
 * `https://[fd00::1]:3001` oder `https://nas.fritz.box`. Das Fenster nimmt immer `https://` auf dem genannten Port (der
 * Server spricht dort beides); ohne Port heißt `https://` wie im Browser 443 (ein Proxy wie Caddy), sonst gilt 3001.
 * `host` ohne Klammern (für Node), `origin` wie `new URL(…).origin` (so rechnet ihn auch der Server, internationale
 * Namen also in Punycode).
 * @param {string} input
 * @returns {{ host: string, port: number, origin: string } | Problem}
 */
export function normalizeAddress(input) {
  const read = readAddress(input)
  if ('problem' in read) return read
  const { host, port, origin } = read
  return { host, port, origin }
}

/**
 * Wie `normalizeAddress`, dazu ob die Eingabe Schema oder Port nannte (für den Hinweis auf https://).
 * @param {string} input
 * @returns {{ host: string, port: number, origin: string, bare: boolean } | Problem}
 */
function readAddress(input) {
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
  const port = portText === undefined ? (scheme === 'https' ? 443 : DEFAULT_REMOTE_PORT) : Number(portText)
  if (!Number.isInteger(port) || port < 1 || port > 65535 || portText === '') return { problem: ADDRESS_PROBLEM, field: 'address' }
  let url
  try {
    url = new URL(`https://${authority}`)
  } catch {
    return { problem: ADDRESS_PROBLEM, field: 'address' }
  }
  if (!url.hostname) return { problem: ADDRESS_PROBLEM, field: 'address' }
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1')
  return { host, port, origin: new URL(`https://${url.hostname}:${port}`).origin, bare: scheme === undefined && portText === undefined }
}

/**
 * Wie der Server den Code liest (normalizeCode in server/src/access.ts): groß, nur Buchstaben und Ziffern. Der Server
 * liegt im Fenster nur gebündelt vor, deshalb hier nachgebaut; pairing.test.js koppelt gegen den echten Server.
 * @param {string} code
 */
const normalizeCode = (code) => (typeof code === 'string' ? code.toUpperCase().replace(/[^A-Z0-9]/g, '') : '')

/**
 * Der Beweis (pairingProof in server/src/access.ts): HMAC-SHA256, Schlüssel der Code, über den Fingerabdruck
 * @param {string} code
 * @param {string} certSha256
 */
const proofOf = (code, certSha256) => crypto.createHmac('sha256', normalizeCode(code)).update(`mietfuchs-kopplung:${certSha256}`).digest('hex')

/**
 * Der Beweis hinter einem Proxy in `system` (originProof in server/src/access.ts): HMAC-SHA256, Schlüssel der Code, über
 * den Ursprung, den das Fenster selbst geprüft hat
 * @param {string} code
 * @param {string} origin
 */
const originProofOf = (code, origin) => crypto.createHmac('sha256', normalizeCode(code)).update(`mietfuchs-kopplung:origin:${origin}`).digest('hex')

/**
 * Die Bestätigung des Servers (pairingConfirmation in server/src/access.ts): HMAC-SHA256, Schlüssel der Code, über
 * Beweis und Geräte-ID. Nur wer den Code kennt, kann sie rechnen (Integrationsdurchsicht I4).
 * @param {string} code
 * @param {string} proof
 * @param {string} id
 */
const confirmationOf = (code, proof, id) => crypto.createHmac('sha256', normalizeCode(code)).update(`mietfuchs-kopplung:bestaetigt:${proof}:${id}`).digest('hex')

/**
 * Stimmt die Bestätigung? Zeitkonstant über SHA-256 beider Werte; alles, was keine Zeichenkette ist, stimmt nie
 * @param {unknown} given
 * @param {string} expected
 */
const confirms = (given, expected) =>
  typeof given === 'string' && crypto.timingSafeEqual(crypto.createHash('sha256').update(given).digest(), crypto.createHash('sha256').update(expected).digest())

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

/** @typedef {{ status: number, body: string, headers: http.IncomingHttpHeaders }} Answer */

/**
 * Ist ein Zertifikat (PEM, wie Electron es in `setCertificateVerifyProc` liefert) unmittelbar von dieser CA ausgestellt,
 * für diesen Namen und jetzt gültig? Für den Testgriff `MIETFUCHS_TEST_CA` in main.js: Chromium kennt die Test-CA
 * nicht, das Fenster behandelt sie wie eine des Systems. Bei allem, was sich nicht lesen lässt, `false`.
 * @param {string} certPem
 * @param {string} caPem
 * @param {string} hostname
 * @param {Date} [now]
 * @returns {boolean}
 */
export function issuedBy(certPem, caPem, hostname, now = new Date()) {
  try {
    const cert = new crypto.X509Certificate(certPem)
    const ca = new crypto.X509Certificate(caPem)
    if (!ca.ca || !cert.checkIssued(ca) || !cert.verify(ca.publicKey)) return false
    const name = String(hostname).replace(/^\[(.*)\]$/, '$1')
    const matches = net.isIP(name) ? cert.checkIP(name) : cert.checkHost(name, { wildcards: true, partialWildcards: false })
    if (matches === undefined) return false
    return cert.validFromDate.getTime() <= now.getTime() && now.getTime() <= cert.validToDate.getTime()
  } catch {
    return false
  }
}

/**
 * Wie eine Verbindung das Zertifikat prüft:
 * - `{ expected: null, ca }` beim ersten Kontakt: nichts abgelehnt, aber `authorized` gegen `ca` samt Name gerechnet;
 * - `{ expected: '<hex>' }` gepinnt: nur genau dieses Zertifikat (`CERT_CHANGED`);
 * - `{ system: true, ca }`: Kette und Name gegen `ca` (`CERT_UNTRUSTED`).
 * @typedef {{ expected: string | null, ca?: string[], system?: false } | { system: true, ca: string[] }} Check
 */

/**
 * Eine TLS-Verbindung zum Server und der Fingerabdruck seines Zertifikats. Mit `expected` nur, wenn der Fingerabdruck
 * passt, in `system` nur mit gültiger Kette und passendem Namen; sonst wird die Verbindung geschlossen, bevor ein Byte
 * der Anfrage hinausgeht.
 *
 * **Warum ohne Prüfung der Kette (`rejectUnauthorized: false`)**: Das Zertifikat des Servers ist selbst ausgestellt und
 * nennt nur localhost; keine Kette und kein Name könnten es bestätigen. Beim ersten Kontakt (Koppeln) gilt Trust on
 * First Use: Das Fenster liest den Fingerabdruck, und der Beweis mit dem Code bindet ihn an den echten Server (siehe
 * oben); ein falsches Zertifikat ergibt einen Beweis, den der Server ablehnt. Danach zählt nur der gemerkte
 * Fingerabdruck (`expected`), strenger als jede Kette. Die Seite im Fenster prüft ihn ebenso über Electron
 * (`pinDecision`, setCertificateVerifyProc in main.js).
 *
 * In `system` (Proxy mit Zertifikat aus dem Speicher des Systems) lehnt Node selbst ab, was Kette oder Name nicht
 * bestätigen, noch vor `secureConnect`; das wird `CERT_UNTRUSTED`. Beim ersten Kontakt rechnet Node mit `ca` dasselbe
 * Urteil (`authorized`), ohne abzubrechen: Daraus erkennt `pair` die Vertrauensart.
 * @param {{ host: string, port: number }} target
 * @param {Check} check
 * @param {number} timeoutMs
 * @returns {Promise<{ socket: tls.TLSSocket, certSha256: string, authorized: boolean }>}
 */
function connectTls({ host, port }, check, timeoutMs) {
  return new Promise((resolve, reject) => {
    const system = check.system === true
    const socket = tls.connect({
      host,
      port,
      // SNI nur mit einem Namen, nie mit einer IP (Node warnt sonst)
      ...(net.isIP(host) ? {} : { servername: host }),
      // Gepinnt: Trust on First Use mit Beweis, danach der Fingerabdruck (siehe oben). System: Kette und Name.
      rejectUnauthorized: system,
      ...(check.ca ? { ca: check.ca } : {}),
      timeout: timeoutMs,
    })
    socket.once('timeout', () => socket.destroy(Object.assign(new Error('Zeitüberschreitung'), { code: 'ETIMEDOUT' })))
    /** @param {Error} err */
    const onError = (err) => {
      // Abgelehnt von Node (Kette oder Name), nicht vom Netz
      if (system && socket.authorizationError) {
        return reject(Object.assign(new Error('Das Zertifikat des Servers ist auf diesem Rechner nicht gültig.'), { code: 'CERT_UNTRUSTED', cause: err }))
      }
      reject(err)
    }
    socket.once('error', onError)
    socket.once('secureConnect', () => {
      if (system && !socket.authorized) {
        socket.destroy()
        return reject(Object.assign(new Error('Das Zertifikat des Servers ist auf diesem Rechner nicht gültig.'), { code: 'CERT_UNTRUSTED' }))
      }
      const raw = socket.getPeerCertificate(true)?.raw
      if (!raw) {
        socket.destroy()
        return reject(new Error('Der Server zeigt kein Zertifikat.'))
      }
      const certSha256 = sha256(raw)
      const expected = 'expected' in check ? check.expected : null
      if (expected !== null && certSha256 !== expected) {
        socket.destroy()
        return reject(Object.assign(new Error('Der Server zeigt ein anderes Zertifikat als beim Koppeln.'), { code: 'CERT_CHANGED' }))
      }
      socket.off('error', onError)
      socket.setTimeout(0)
      resolve({ socket, certSha256, authorized: socket.authorized })
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
    const shownHost = net.isIPv6(host) ? `[${host}]` : host
    // Wie ein Browser: ohne :443 (ein Proxy wie Caddy wählt seinen Block nach dem Namen, der Server den Ursprung danach)
    const hostHeader = port === 443 ? shownHost : `${shownHost}:${port}`
    const req = http.request({ host: shownHost, port, method, path, headers: { ...all, host: hostHeader }, createConnection: () => socket, timeout: timeoutMs }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { text += chunk })
      res.on('end', () => {
        socket.destroy()
        resolve({ status: res.statusCode ?? 0, body: text, headers: res.headers })
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
 * Eine Anfrage an den gekoppelten Server mit dem Geräteschlüssel: für Version und Anmeldestand beim Start und das
 * Entfernen des eigenen Geräts beim Trennen. Gepinnt (`trust` fehlt oder `pinned`) nur mit dem gemerkten Zertifikat,
 * in `system` nur mit gültiger Kette und passendem Namen gegen `ca` (Vorgabe `systemTrust()`). Wirft, wenn der Server
 * nicht erreichbar ist, ein anderes Zertifikat zeigt (`code` `CERT_CHANGED`) oder eines, das hier nicht gilt
 * (`CERT_UNTRUSTED`); dann ist kein Byte der Anfrage hinausgegangen.
 * @param {{ origin: string, trust?: Trust, certSha256: string | null, deviceId?: string, deviceKey?: string }} remote
 * @param {string} urlPath
 * @param {{ method?: string, body?: string, timeoutMs?: number, ca?: string[] }} [options]
 * @returns {Promise<Answer>}
 */
export async function remoteFetch(remote, urlPath, { method = 'GET', body, timeoutMs = TIMEOUT_MS, ca } = {}) {
  const url = new URL(urlPath, remote.origin)
  const target = { host: url.hostname.replace(/^\[(.*)\]$/, '$1'), port: Number(url.port || 443) }
  /** @type {Check} */
  let check
  if (remote.trust === 'system') check = { system: true, ca: ca ?? systemTrust() }
  else if (typeof remote.certSha256 === 'string' && remote.certSha256) check = { expected: remote.certSha256 }
  // Gepinnt ohne Fingerabdruck gibt es nicht; nie ohne Prüfung
  else throw Object.assign(new Error('Ohne gemerktes Zertifikat keine Anfrage.'), { code: 'CERT_CHANGED' })
  const { socket } = await connectTls(target, check, timeoutMs)
  /** @type {Record<string, string>} */
  const headers = remote.deviceId && remote.deviceKey ? { [DEVICE_HEADER]: `${remote.deviceId}.${remote.deviceKey}` } : {}
  return requestOver(socket, { ...target, method, path: `${url.pathname}${url.search}`, headers, body, timeoutMs })
}

/**
 * Der gekoppelte Server lehnt den Geräteschlüssel ab (401): Hat er das Fenster vergessen (`key`, neu koppeln), oder
 * vertraut Mietfuchs dem Proxy gerade nicht (`proxy`)? Dann gilt über ihn kein Schlüssel: kurz nach dem Neuerstellen von
 * Caddy (bis zu 5 Sekunden, server/src/trustProxy.ts) oder wenn NKA_TRUST_PROXY fehlt. Nur in `system` gefragt, über
 * die Vorabfrage ohne Geräteschlüssel; `secure: false` oder kein Ursprung ohne `problem` heißt `proxy`. Gepinnt, bei
 * jedem Fehler und jeder anderen Antwort bleibt es bei `key` (Integrationsdurchsicht m4).
 * @param {{ origin: string, trust?: Trust, certSha256: string | null }} remote
 * @param {{ ca?: string[], timeoutMs?: number }} [options]
 * @returns {Promise<'key' | 'proxy'>}
 */
export async function rejectedKeyReason(remote, { ca, timeoutMs = TIMEOUT_MS } = {}) {
  if (remote.trust !== 'system') return 'key'
  try {
    const answer = await remoteFetch({ origin: remote.origin, trust: 'system', certSha256: null }, '/api/auth/pair', { ca, timeoutMs })
    /** @type {Preflight | null} */
    const preflight = answer.status === 200 ? jsonOr(answer.body) : null
    if (!preflight || typeof preflight !== 'object' || preflight.app !== 'mietfuchs') return 'key'
    if (preflight.secure === false) return 'proxy'
    if (preflight.secure === true && preflight.origin === null && !preflight.problem) return 'proxy'
    return 'key'
  } catch {
    return 'key'
  }
}

/**
 * Eine Antwort als JSON oder null (auch für main.js)
 * @param {string} text
 */
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
 * @typedef {{ origin: string, trust: Trust, certSha256: string | null, deviceId: string, deviceKey: string, version: string }} Remote
 */

/**
 * Die Vorabfrage `GET /api/auth/pair` (PairPreflight in server/src/accessServer.ts); `problem`, wenn der Server den
 * weitergereichten Namen ablehnt
 * @typedef {{ app: string, certSha256: string | null, secure: boolean, origin: string | null, problem?: string }} Preflight
 */

/**
 * Name des Fensters in der Geräteliste: der Rechnername ohne Domäne („Martins-MacBook-Pro.local“ wird
 * „Martins-MacBook-Pro“), gekürzt auf die 60 Zeichen, die der Server annimmt (DEVICE_NAME_MAX); sonst nähme er für
 * einen langen Namen nur „Programmfenster“
 * @param {string} hostname
 * @returns {string}
 */
export function deviceNameOf(hostname) {
  const short = hostname.trim().split('.')[0].slice(0, 60).trim()
  return short || 'Programmfenster'
}

/**
 * Koppeln (Entwurf der Erweiterung, Abschnitt 1): eine TLS-Verbindung, die nichts ablehnt, aber gegen `ca` urteilt
 * (Fingerabdruck `S`, `authorized`); darüber die Vorabfrage `GET /api/auth/pair` mit dem Fingerabdruck `M` des
 * Zertifikats von Mietfuchs. `S === M` heißt `pinned` (direkt oder ein Proxy, der das Zertifikat von Mietfuchs
 * ausliefert), sonst `authorized` heißt `system`, sonst ein fremdes Zertifikat und kein Beweis. Vor dem Beweis prüft das
 * Fenster, was der Server über die Verbindung meldet (`secure`, in `system` den Ursprung). Der Beweis geht über eine
 * zweite Verbindung mit derselben Prüfung wie danach jede Anfrage. Ergibt, was fenster.json als `remote` merkt, oder
 * einen Satz für die Karte.
 * @param {{ address: string, code: string, name?: string, timeoutMs?: number, ca?: string[] }} request
 * @returns {Promise<Remote | Problem>}
 */
export async function pair({ address, code, name = deviceNameOf(os.hostname()), timeoutMs = TIMEOUT_MS, ca = systemTrust() }) {
  const where = readAddress(address)
  if ('problem' in where) return where
  if (!normalizeCode(code)) return { problem: 'Geben Sie den Code ein, den Mietfuchs auf dem Server unter Einstellungen, Anmeldung zeigt.', field: 'code' }
  const target = { host: where.host, port: where.port }
  const shown = where.port === 443 ? where.host : `${where.host.includes(':') ? `[${where.host}]` : where.host}:${where.port}`
  const lost = { problem: `Unter ${shown} ist Mietfuchs nicht erreichbar. Prüfen Sie die Adresse und ob Mietfuchs dort läuft.`, field: /** @type {const} */ ('address') }
  // Ohne Schema und Port nahm das Fenster 3001; hinter einem Proxy fehlte dann nur das https://
  const unreachable = where.bare ? { ...lost, problem: `${lost.problem} Läuft Mietfuchs hinter einem Proxy wie Caddy, geben Sie die Adresse mit https:// davor ein, etwa https://nas.fritz.box.` } : lost
  const notMietfuchs = { problem: `Unter ${shown} antwortet kein Mietfuchs. Prüfen Sie die Adresse und den Port.`, field: /** @type {const} */ ('address') }
  const notTrusted = { problem: `Mietfuchs unter ${shown} sieht die Verbindung nicht als verschlüsselt an, weil es dem Proxy davor nicht vertraut. Tragen Sie den Proxy bei Mietfuchs in NKA_TRUST_PROXY ein; in compose.caddy.yml steht das schon.` }

  /** @type {{ certSha256: string, authorized: boolean }} */
  let seen
  /** @type {Answer} */
  let answer
  try {
    const first = await connectTls(target, { expected: null, ca }, timeoutMs)
    seen = first
    answer = await requestOver(first.socket, { ...target, path: '/api/auth/pair', timeoutMs })
  } catch (err) {
    const errCode = /** @type {NodeJS.ErrnoException} */ (err)?.code
    if (errCode && UNREACHABLE.has(errCode)) return unreachable
    // Verbunden, aber kein TLS: ein älterer Mietfuchs, der nur HTTP spricht, oder etwas ganz anderes
    if (await mietfuchsOverHttp(target, timeoutMs)) {
      return { problem: `Mietfuchs unter ${shown} antwortet nur über HTTP, ohne HTTPS lässt sich nicht koppeln. Aktualisieren Sie Mietfuchs dort auf Version 0.17 oder neuer.`, field: 'address' }
    }
    return errCode === 'ECONNRESET' ? unreachable : notMietfuchs
  }
  // Der Proxy fragt selbst nach einem Passwort (Caddy basic_auth); das kann das Fenster nicht beantworten
  if (answer.status === 401 && /\bbasic\b/i.test(String(answer.headers['www-authenticate'] ?? ''))) {
    return { problem: `Vor Mietfuchs unter ${shown} fragt der Proxy selbst nach einem Passwort. Ein Programmfenster koppelt sich nur, wenn Mietfuchs die Anmeldung übernimmt; nehmen Sie dafür basic_auth aus dem Caddyfile.`, field: 'address' }
  }
  /** @type {Preflight | null} */
  const preflight = answer.status === 200 ? jsonOr(answer.body) : null
  // Die Host-Prüfung von Mietfuchs (requestGuard.ts) lehnt den Namen ab: 403 mit ihrem Satz als Text. Nur genau dieser
  // Satz (hostRefusal) geht weiter, der Text eines fremden Servers nicht (Integrationsdurchsicht m5)
  const refusal = answer.body.trim()
  if (answer.status === 403 && /^text\/plain\b/i.test(String(answer.headers['content-type'] ?? '')) && HOST_REFUSAL.test(refusal)) {
    return { problem: refusal, field: 'address' }
  }
  if (!preflight || typeof preflight !== 'object' || preflight.app !== 'mietfuchs') return notMietfuchs

  // Die Vertrauensart: das Zertifikat von Mietfuchs vor jedem Urteil des Systems (eine direkte Verbindung ist nie `system`)
  /** @type {Trust} */
  let trust
  if (typeof preflight.certSha256 === 'string' && preflight.certSha256 === seen.certSha256) trust = 'pinned'
  else if (seen.authorized) trust = 'system'
  else {
    // `authorized` schließt den Namen ein (checkServerIdentity): Eine vertraute Kette für einen anderen Namen gilt nicht
    return { problem: `Unter ${shown} antwortet Mietfuchs hinter einem Proxy, dessen Zertifikat dieser Rechner nicht kennt oder das einen anderen Namen nennt. Installieren Sie das Stammzertifikat des Proxys auf diesem Rechner (bei Caddy die Datei root.crt), oder lassen Sie den Proxy das Zertifikat von Mietfuchs ausliefern. Die Anleitung zu Docker beschreibt beides.`, field: 'address' }
  }
  // Ohne HTTPS aus Sicht des Servers nähme er keinen Beweis an; in `system` ohne Ursprung ebenso (der Proxy ist nicht
  // vertraut, spricht aber selbst TLS zu Mietfuchs, eigener Satz unten)
  if (preflight.secure !== true) return notTrusted
  if (trust === 'system') {
    // Der Server lehnt den weitergereichten Namen ab (NKA_ALLOWED_HOSTS); ein Beweis mit Ursprung gälte nie. Gepinnt
    // zählt der Name nicht, der Beweis bindet an den Fingerabdruck.
    if (typeof preflight.problem === 'string' && preflight.problem) return { problem: preflight.problem, field: 'address' }
    if (typeof preflight.origin !== 'string') {
      return { problem: `Mietfuchs unter ${shown} vertraut dem Proxy davor nicht und erfährt deshalb nicht, unter welcher Adresse Sie es aufrufen. Tragen Sie den Proxy bei Mietfuchs in NKA_TRUST_PROXY ein; in compose.caddy.yml steht das schon.` }
    }
    if (preflight.origin !== where.origin) {
      return { problem: `Der Proxy meldet Mietfuchs die Adresse ${preflight.origin}, eingegeben ist ${shown}. Geben Sie die Adresse so ein, wie Sie Mietfuchs im Browser öffnen, mit https:// davor.`, field: 'address' }
    }
  }

  /** @type {Check} */
  const check = trust === 'pinned' ? { expected: seen.certSha256 } : { system: true, ca }
  const certSha256 = trust === 'pinned' ? seen.certSha256 : null
  const proof = trust === 'pinned' ? proofOf(code, seen.certSha256) : originProofOf(code, where.origin)
  try {
    const second = await connectTls(target, check, timeoutMs)
    answer = await requestOver(second.socket, { ...target, method: 'POST', path: '/api/auth/pair', body: JSON.stringify({ name, proof }), timeoutMs })
  } catch (err) {
    const errCode = /** @type {NodeJS.ErrnoException} */ (err)?.code
    if (errCode === 'CERT_CHANGED' || errCode === 'CERT_UNTRUSTED') return { problem: 'Der Server hat während des Koppelns ein anderes Zertifikat gezeigt. Versuchen Sie es noch einmal; geschieht das wieder, koppeln Sie nicht.' }
    return lost
  }
  const body = jsonOr(answer.body)
  if (answer.status === 200 && body && typeof body === 'object') {
    // Ohne Bestätigung kennt die Gegenseite den Code nicht: ein Mittelsmann, der beim ersten Kontakt seinen eigenen
    // Fingerabdruck genannt und einen Schlüssel erfunden hat. Nichts merken, nichts entfernen, keine Seite laden.
    if (!confirms(body.confirm, confirmationOf(code, proof, typeof body.id === 'string' ? body.id : ''))) {
      return { problem: `Der Server unter ${shown} hat das Koppeln nicht bestätigt; er kennt den Code nicht. Koppeln Sie nicht mit diesem Server.` }
    }
    const paired = { origin: where.origin, trust, certSha256, deviceId: body.id, deviceKey: body.deviceKey, version: typeof body.version === 'string' ? body.version : '' }
    // Nur, was fenster.json auch wieder liest (remoteOf); sonst wäre die Kopplung beim nächsten Start still weg. Das
    // eben angelegte Gerät dann beste Mühe wieder entfernen, wenn sich mit ihm eine Kopfzeile bauen lässt.
    const valid = remoteOf(paired)
    if (valid) return valid
    const headerSafe = (/** @type {unknown} */ v) => typeof v === 'string' && /^[A-Za-z0-9_-]+$/.test(v)
    if (headerSafe(body.id) && headerSafe(body.deviceKey)) {
      await remoteFetch({ origin: where.origin, trust, certSha256, deviceId: body.id, deviceKey: body.deviceKey }, `/api/auth/devices/${encodeURIComponent(body.id)}`, { method: 'DELETE', timeoutMs, ca })
        .catch(() => {})
    }
    return { problem: 'Das Koppeln ist gescheitert: Die Antwort des Servers ließ sich nicht verwenden. Ist Mietfuchs dort auf dem neuesten Stand?' }
  }
  if (typeof body?.error === 'string' && body.error) {
    // Ohne Passwort am Server sagt die Karte, wo es festgelegt wird
    if (answer.status === 409 && /Passwort/.test(body.error)) return { problem: `${body.error} Ein Programmfenster koppelt sich nur mit einem Mietfuchs, der durch ein Passwort geschützt ist (dort unter Einstellungen, Anmeldung).` }
    // 400 heißt an dieser Route: Der Code stimmt nicht oder ist abgelaufen. Mit `transport: true` liegt es an der
    // Verbindung (Proxy nicht vertraut, kein HTTPS), nicht am Code. 409 (kein Passwort, zu viele Geräte) und 429
    // (Bremse) betreffen kein Feld.
    if (answer.status === 400 && body.transport === true) return { problem: body.error, field: 'address' }
    return answer.status === 400 ? { problem: body.error, field: 'code' } : { problem: body.error }
  }
  return { problem: `Das Koppeln ist gescheitert (Antwort ${answer.status}).` }
}

/**
 * Wie Electron ein Zertifikat behandelt (`setCertificateVerifyProc`): Für den gekoppelten Host gilt nur das gemerkte
 * Zertifikat (`accept`, sonst `reject`), für jeden anderen Host und ohne Kopplung die normale Prüfung (`default`).
 * Electron nennt nur den Host, nicht den Port: Gepinnt wird deshalb je Host, auf jedem Port; der Geräteschlüssel geht
 * trotzdem nur an den Ursprung samt Port (main.js). In `system` gibt es nichts zu pinnen: Chromium prüft Kette und
 * Name mit dem Speicher des Systems (`default`).
 * @param {string} hostname
 * @param {string} certSha256
 * @param {{ origin: string, trust?: Trust, certSha256: string | null } | null} remote
 * @returns {'accept' | 'reject' | 'default'}
 */
export function pinDecision(hostname, certSha256, remote) {
  if (!remote || remote.trust === 'system') return 'default'
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

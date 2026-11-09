// Koppeln des Programmfensters mit einem Mietfuchs im Heimnetz (#528, Schritt 2), ohne Electron: Adresse lesen, gegen
// einen echten Server koppeln (server/testing/api.ts), Fehler als Sätze, Pinning und Versionshinweis.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import https from 'node:https'
import tls from 'node:tls'
import os from 'node:os'
import path from 'node:path'
import { certSha256FromPem, deviceNameOf, issuedBy, jsonOr, normalizeAddress, pair, pinDecision, rejectedKeyReason, remoteFetch, systemTrust, versionHint } from '../src/pairing.js'
import { freePort } from '../src/server.js'

// Die Helfer der Servertests. Über eine errechnete Adresse geladen: Der Server ist TypeScript mit eigener Typprüfung,
// die des Fensters soll ihn nicht ein zweites Mal mit ihren Einstellungen prüfen.
/** @type {any} */
const api = await import(new URL('../../server/testing/api.ts', import.meta.url).href)
// Proxy wie Caddy und eigene Test-CA (#528, Kopplung über einen Proxy), ebenso über eine errechnete Adresse
/** @type {any} */
const proxies = await import(new URL('../../server/testing/proxy.ts', import.meta.url).href)
// Die Bestätigung des Servers, gegen die das Fenster seinen Nachbau prüft (Integrationsdurchsicht I4)
/** @type {any} */
const access = await import(new URL('../../server/src/access.ts', import.meta.url).href)

const freshDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-fenster-kopplung-'))
const NETWORK = { NKA_HOST: '0.0.0.0' }

/** @param {string} base */
const addressOf = (base) => `http://127.0.0.1:${new URL(base).port}`

// Ein Server im Netz mit Passwort; `code()` holt einen Kopplungscode wie die Karte in den Einstellungen
async function serverWithPassword() {
  const s = await api.startServerIn(freshDir(), NETWORK)
  const { cookie } = await api.signIn(s)
  const code = async () => {
    const res = await fetch(`${s.base}/api/auth/pairing`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: '{}' })
    assert.equal(res.status, 200, await res.clone().text())
    return /** @type {{ code: string }} */ (await res.json()).code
  }
  return { s, cookie, code }
}

test('Adresse: Schema egal, immer https auf demselben Port, Vorgabe 3001, IPv6 in Klammern', () => {
  assert.deepEqual(normalizeAddress('nas'), { host: 'nas', port: 3001, origin: 'https://nas:3001' })
  assert.deepEqual(normalizeAddress('  nas:3001 '), { host: 'nas', port: 3001, origin: 'https://nas:3001' })
  assert.deepEqual(normalizeAddress('http://192.168.1.5:3001/'), { host: '192.168.1.5', port: 3001, origin: 'https://192.168.1.5:3001' })
  assert.deepEqual(normalizeAddress('https://[fd00::1]:3001'), { host: 'fd00::1', port: 3001, origin: 'https://[fd00::1]:3001' })
  assert.deepEqual(normalizeAddress('[fd00::1]'), { host: 'fd00::1', port: 3001, origin: 'https://[fd00::1]:3001' })
  assert.deepEqual(normalizeAddress('NAS.fritz.box:17517'), { host: 'nas.fritz.box', port: 17517, origin: 'https://nas.fritz.box:17517' })
  // Ein Port, den https sonst wegließe, bleibt ausdrücklich stehen und gilt
  assert.deepEqual(normalizeAddress('http://nas:80'), { host: 'nas', port: 80, origin: 'https://nas:80' })
  assert.deepEqual(normalizeAddress('nas:443'), { host: 'nas', port: 443, origin: 'https://nas' })
  // Was dahinter steht (Pfad einer Seite aus dem Browser), zählt nicht
  assert.deepEqual(normalizeAddress('http://nas:3001/einstellungen?x=1#oben'), { host: 'nas', port: 3001, origin: 'https://nas:3001' })
  for (const nonsense of ['', '   ', 'nas name', 'ftp://nas', 'nas:99999', 'nas:0', 'nas:abc', 'http://', 'user:pw@nas:3001', 'fd00::1', 'mailto:anna@example.org']) {
    const result = normalizeAddress(nonsense)
    assert.ok('problem' in result, `${nonsense}: ${JSON.stringify(result)}`)
    assert.match(result.problem, /Adresse/, nonsense)
    assert.equal(result.field, 'address', nonsense)
  }
})

test('Koppeln: gegen einen echten Server, danach gilt der Schlüssel nur mit dem gemerkten Zertifikat', async () => {
  const { s, code } = await serverWithPassword()
  try {
    const result = await pair({ address: addressOf(s.base), code: (await code()).toLowerCase(), name: 'Laptop im Büro' })
    assert.ok(!('problem' in result), JSON.stringify(result))
    assert.equal(result.origin, `https://127.0.0.1:${new URL(s.base).port}`)
    // Gemerkt wird genau das Zertifikat des Servers
    assert.equal(result.certSha256, certSha256FromPem(api.serverCa(s.dataDir)))
    // Direkt gekoppelt heißt: gepinnt
    assert.equal(result.trust, 'pinned')
    assert.match(result.deviceId, /^[0-9a-f]{16}$/)
    assert.match(result.deviceKey, /^[A-Za-z0-9_-]{43}$/)
    assert.match(result.version, /^\d+\.\d+\.\d+/)

    // Mit dem Schlüssel angemeldet: volles /healthz mit Version, die Liste nennt das Gerät mit seinem Namen
    const health = await remoteFetch(result, '/healthz')
    assert.equal(health.status, 200)
    assert.equal(JSON.parse(health.body).version, result.version)
    const devices = JSON.parse((await remoteFetch(result, '/api/auth/devices')).body).devices
    assert.equal(devices.length, 1)
    assert.equal(devices[0].name, 'Laptop im Büro')
    assert.equal(devices[0].current, true)

    // Ein anderes Zertifikat unter derselben Adresse: kein Schlüssel geht hinaus
    await assert.rejects(remoteFetch({ ...result, certSha256: 'a'.repeat(64) }, '/healthz'))

    // Trennen: das eigene Gerät entfernen, danach gilt der Schlüssel nicht mehr
    assert.equal((await remoteFetch(result, `/api/auth/devices/${result.deviceId}`, { method: 'DELETE' })).status, 200)
    assert.equal((await remoteFetch(result, '/api/units')).status, 401)
  } finally {
    s.stop()
  }
})

test('Koppeln: ohne Name nimmt das Fenster den Rechnernamen', async () => {
  const { s, cookie, code } = await serverWithPassword()
  try {
    const result = await pair({ address: addressOf(s.base), code: await code() })
    assert.ok(!('problem' in result), JSON.stringify(result))
    const devices = /** @type {{ devices: { name: string }[] }} */ (await (await fetch(`${s.base}/api/auth/devices`, { headers: { cookie } })).json()).devices
    assert.equal(devices[0].name, deviceNameOf(os.hostname()))
  } finally {
    s.stop()
  }
})

test('Koppeln: falscher Code, Server ohne Passwort, Unsinn als Adresse ergeben Sätze', async () => {
  const { s, code } = await serverWithPassword()
  try {
    await code()
    const wrong = await pair({ address: addressOf(s.base), code: 'AAAA-AAAA-AAAA', name: 'Laptop' })
    assert.deepEqual(wrong, { problem: 'Der Code stimmt nicht oder ist abgelaufen.', field: 'code' })
    const empty = await pair({ address: addressOf(s.base), code: ' - ', name: 'Laptop' })
    assert.ok('problem' in empty)
    assert.match(empty.problem, /Code/)
    assert.equal(empty.field, 'code')
    const nonsense = await pair({ address: 'nas name', code: 'AAAA-AAAA-AAAA', name: 'Laptop' })
    assert.ok('problem' in nonsense)
    assert.match(nonsense.problem, /Adresse/)
    assert.equal(nonsense.field, 'address')
  } finally {
    s.stop()
  }
  // Ein Mietfuchs im Netz, auf dem noch niemand ein Passwort festgelegt hat
  const open = await api.startServerIn(freshDir(), NETWORK)
  try {
    const result = await pair({ address: addressOf(open.base), code: 'AAAA-AAAA-AAAA', name: 'Laptop' })
    assert.ok('problem' in result)
    assert.match(result.problem, /Passwort/)
    assert.equal(result.field, undefined, 'ohne Passwort: kein Feld')
  } finally {
    open.stop()
  }
})

test('Koppeln: nichts lauscht, kein Mietfuchs, Mietfuchs nur über HTTP', async () => {
  const port = await freePort()
  const nobody = await pair({ address: `127.0.0.1:${port}`, code: 'AAAA-AAAA-AAAA', name: 'Laptop' })
  assert.ok('problem' in nobody)
  assert.match(nobody.problem, /nicht erreichbar/)
  assert.equal(nobody.field, 'address')

  // Ein fremder HTTPS-Server, mit dem Schlüsselpaar eines Mietfuchs nur, damit der Test keins erzeugen muss
  const s = await api.startServerIn(freshDir(), NETWORK)
  const key = fs.readFileSync(path.join(s.dataDir, 'tls', 'mietfuchs.key'), 'utf8')
  const cert = api.serverCa(s.dataDir)
  s.stop()
  const foreign = https.createServer({ key, cert }, (req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ app: 'etwas anderes', status: 'ok' }))
  })
  await api.listening(foreign, '127.0.0.1')
  try {
    const result = await pair({ address: `127.0.0.1:${api.portOf(foreign)}`, code: 'AAAA-AAAA-AAAA', name: 'Laptop' })
    assert.ok('problem' in result)
    assert.match(result.problem, /kein Mietfuchs/)
    assert.equal(result.field, 'address')
  } finally {
    foreign.close()
  }

  // Ein älterer Mietfuchs ohne HTTPS: antwortet über HTTP, nie über TLS
  const http = (await import('node:http')).default
  const old = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ app: 'mietfuchs', status: 'ok' }))
  })
  await api.listening(old, '127.0.0.1')
  try {
    const result = await pair({ address: `127.0.0.1:${api.portOf(old)}`, code: 'AAAA-AAAA-AAAA', name: 'Laptop' })
    assert.ok('problem' in result)
    assert.match(result.problem, /HTTPS/)
    assert.match(result.problem, /Aktualisieren/)
    assert.equal(result.field, 'address')
  } finally {
    old.close()
  }
})

// Ein Schlüsselpaar für nachgebaute Server, aus dem Datenordner eines Mietfuchs, damit der Test keins erzeugen muss
async function borrowedKeyPair() {
  const s = await api.startServerIn(freshDir(), NETWORK)
  const key = fs.readFileSync(path.join(s.dataDir, 'tls', 'mietfuchs.key'), 'utf8')
  const cert = api.serverCa(s.dataDir)
  s.stop()
  return { key, cert }
}

// Mit Frist: Ohne die Prüfung des Fingerabdrucks hinge die Anfrage am stummen Server, statt zu scheitern
test('Pinning: Bei anderem Zertifikat geht nach dem Handschlag kein Byte hinaus, also auch kein Geräteschlüssel', { timeout: 20_000 }, async () => {
  const { key, cert } = await borrowedKeyPair()
  let received = 0
  let text = ''
  const raw = tls.createServer({ key, cert }, (socket) => {
    socket.on('data', (chunk) => {
      received += chunk.length
      text += chunk.toString('latin1')
    })
    socket.on('error', () => {})
  })
  await api.listening(raw, '127.0.0.1')
  try {
    const origin = `https://127.0.0.1:${api.portOf(raw)}`
    const pinned = { origin, certSha256: 'a'.repeat(64), deviceId: '0123456789abcdef', deviceKey: 'K'.repeat(43), version: '0.17.0' }
    assert.notEqual(certSha256FromPem(cert), pinned.certSha256)
    await assert.rejects(remoteFetch(pinned, '/api/units', { timeoutMs: 2000 }), (err) => /** @type {any} */ (err).code === 'CERT_CHANGED')
    await assert.rejects(remoteFetch(pinned, `/api/auth/devices/${pinned.deviceId}`, { method: 'DELETE', body: '{}', timeoutMs: 2000 }))
    // Zeit für Bytes, die doch unterwegs wären
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.equal(received, 0)
    assert.equal(text.includes('K'.repeat(43)), false)
  } finally {
    raw.close()
  }
})

/**
 * Antwortet auf das POST wie ein Server, der den Code AAAA-AAAA-AAAA kennt: mit passender Bestätigung
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {{ id: string, deviceKey: string, version: string }} device
 */
function confirmed(req, res, device) {
  let raw = ''
  req.on('data', (chunk) => { raw += chunk })
  req.on('end', () => {
    const { proof } = JSON.parse(raw)
    res.end(JSON.stringify({ ...device, confirm: access.pairingConfirmation('AAAA-AAAA-AAAA', proof, device.id) }))
  })
}

// Integrationsdurchsicht I4: Ein Mittelsmann beim ersten Kontakt nennt in der Vorabfrage seinen eigenen Fingerabdruck
// (oder hat ein gültiges Zertifikat) und antwortet auf das POST mit einem erfundenen Schlüssel. Ohne Code kann er die
// Bestätigung nicht rechnen; das Fenster merkt sich nichts und lädt seine Seite nie.
test('Koppeln: ohne oder mit falscher Bestätigung des Servers wird nichts gekoppelt', async () => {
  const sentence = (/** @type {string} */ shown) => `Der Server unter ${shown} hat das Koppeln nicht bestätigt; er kennt den Code nicht. Koppeln Sie nicht mit diesem Server.`
  const { key, cert } = await borrowedKeyPair()
  const invented = { id: 'abcdef0123456789', deviceKey: 'K'.repeat(43), version: '0.17.0' }
  const answers = [
    invented,
    { ...invented, confirm: access.pairingConfirmation('BBBB-BBBB-BBBB', 'x', invented.id) },
    { ...invented, confirm: 'zu kurz' },
    { ...invented, confirm: 42 },
  ]
  for (const answer of answers) {
    // Gepinnt: der Mittelsmann nennt in der Vorabfrage den Fingerabdruck, den er selbst zeigt
    /** @type {string[]} */
    const seen = []
    const pinned = https.createServer({ key, cert }, (req, res) => {
      seen.push(`${req.method} ${req.url}`)
      res.setHeader('content-type', 'application/json')
      if (req.method === 'GET') return res.end(JSON.stringify({ app: 'mietfuchs', certSha256: certSha256FromPem(cert), secure: true, origin: null }))
      res.end(JSON.stringify(answer))
    })
    await api.listening(pinned, '127.0.0.1')
    try {
      const result = await pair({ address: `127.0.0.1:${api.portOf(pinned)}`, code: 'AAAA-AAAA-AAAA', name: 'Laptop' })
      assert.deepEqual(result, { problem: sentence(`127.0.0.1:${api.portOf(pinned)}`) }, JSON.stringify(answer))
      assert.deepEqual(seen, ['GET /api/auth/pair', 'POST /api/auth/pair'], 'kein Entfernen, keine weitere Anfrage')
    } finally {
      pinned.close()
    }
    // system: gültige Kette, der Ursprung stimmt
    /** @type {string} */
    let origin = ''
    const system = await fakeBehindProxy((req, res) => {
      res.setHeader('content-type', 'application/json')
      if (req.method === 'GET') return res.end(JSON.stringify({ app: 'mietfuchs', certSha256: null, secure: true, origin }))
      res.end(JSON.stringify(answer))
    })
    origin = system.origin
    try {
      const result = await pair({ address: system.origin, code: 'AAAA-AAAA-AAAA', name: 'Laptop', ca: system.ca })
      assert.deepEqual(result, { problem: sentence(new URL(system.origin).host) }, JSON.stringify(answer))
      assert.equal(system.posts().length, 1)
    } finally {
      system.close()
    }
  }
})

test('Koppeln: eine Antwort mit unbrauchbarem Gerät wird nicht gemerkt, das Gerät beste Mühe wieder entfernt', async () => {
  const { key, cert } = await borrowedKeyPair()
  // Die Vorabfrage eines Mietfuchs mit genau diesem Zertifikat, direkt über TLS
  const preflight = { app: 'mietfuchs', certSha256: certSha256FromPem(cert), secure: true, origin: null }
  /** @type {string[]} */
  const seen = []
  const fake = https.createServer({ key, cert }, (req, res) => {
    seen.push(`${req.method} ${req.url} ${req.headers['x-mietfuchs-device'] ?? '-'}`)
    res.setHeader('content-type', 'application/json')
    if (req.method === 'GET' && req.url === '/api/auth/pair') return res.end(JSON.stringify(preflight))
    if (req.url === '/api/auth/pair') return confirmed(req, res, { id: 'abc123', deviceKey: 'zu kurz\r\n', version: '0.17.0' })
    res.end('{"ok":true}')
  })
  await api.listening(fake, '127.0.0.1')
  try {
    const result = await pair({ address: `127.0.0.1:${api.portOf(fake)}`, code: 'AAAA-AAAA-AAAA', name: 'Laptop' })
    assert.ok('problem' in result, JSON.stringify(result))
    assert.match(result.problem, /Koppeln/)
    assert.equal(result.field, undefined, 'unbrauchbare Antwort: kein Feld')
    assert.deepEqual(seen.slice(0, 2), ['GET /api/auth/pair -', 'POST /api/auth/pair -'])
    // Mit einem unbrauchbaren Schlüssel lässt sich keine Kopfzeile bauen; entfernt wird nur, was gültig aussieht
    assert.equal(seen.length, 2)
  } finally {
    fake.close()
  }
  // Kopfzeile baubar, aber die Kennung zu lang für fenster.json: das Gerät wird entfernt, gemerkt wird nichts
  const longId = 'a'.repeat(65)
  const fake2 = https.createServer({ key, cert }, (req, res) => {
    seen.push(`${req.method} ${req.url} ${req.headers['x-mietfuchs-device'] ?? '-'}`)
    res.setHeader('content-type', 'application/json')
    if (req.method === 'GET' && req.url === '/api/auth/pair') return res.end(JSON.stringify(preflight))
    if (req.url === '/api/auth/pair') return confirmed(req, res, { id: longId, deviceKey: 'K'.repeat(43), version: '0.17.0' })
    res.end('{"ok":true}')
  })
  await api.listening(fake2, '127.0.0.1')
  try {
    seen.length = 0
    const result = await pair({ address: `127.0.0.1:${api.portOf(fake2)}`, code: 'AAAA-AAAA-AAAA', name: 'Laptop' })
    assert.ok('problem' in result, JSON.stringify(result))
    assert.equal(result.field, undefined)
    assert.deepEqual(seen, ['GET /api/auth/pair -', 'POST /api/auth/pair -', `DELETE /api/auth/devices/${longId} ${longId}.${'K'.repeat(43)}`])
  } finally {
    fake2.close()
  }
})

test('JSON: lesbar oder null', () => {
  assert.deepEqual(jsonOr('{"a":1}'), { a: 1 })
  assert.equal(jsonOr('{ kaputt'), null)
})

test('Pinning: für den gekoppelten Host nur das gemerkte Zertifikat, sonst die normale Prüfung', () => {
  const remote = { origin: 'https://nas:3001', certSha256: 'a'.repeat(64) }
  assert.equal(pinDecision('nas', 'a'.repeat(64), remote), 'accept')
  assert.equal(pinDecision('NAS', 'a'.repeat(64), remote), 'accept')
  assert.equal(pinDecision('nas', 'b'.repeat(64), remote), 'reject')
  assert.equal(pinDecision('mietfuchs-app.de', 'b'.repeat(64), remote), 'default')
  assert.equal(pinDecision('nas', 'a'.repeat(64), null), 'default')
  // IPv6: Chromium nennt den Host ohne Klammern, die gemerkte Adresse trägt sie
  const v6 = { origin: 'https://[fd00::1]:3001', certSha256: 'a'.repeat(64) }
  assert.equal(pinDecision('fd00::1', 'a'.repeat(64), v6), 'accept')
  assert.equal(pinDecision('[fd00::1]', 'b'.repeat(64), v6), 'reject')
  assert.equal(pinDecision('fd00::2', 'b'.repeat(64), v6), 'default')
})

test('Fingerabdruck: SHA-256 des DER aus dem PEM, wie Electron es liefert', () => {
  const der = crypto.randomBytes(300)
  const pem = `-----BEGIN CERTIFICATE-----\n${der.toString('base64').replace(/(.{64})/g, '$1\n')}\n-----END CERTIFICATE-----\n`
  assert.equal(certSha256FromPem(pem), crypto.createHash('sha256').update(der).digest('hex'))
  assert.throws(() => certSha256FromPem('kein Zertifikat'))
})

test('Version: Hinweis nur bei anderem major.minor', () => {
  assert.equal(versionHint('0.17.0', '0.17.3'), null)
  assert.equal(versionHint('0.17.0', '0.17.0-rc.1'), null)
  const hint = versionHint('0.17.0', '0.18.0')
  assert.equal(typeof hint, 'string')
  assert.match(String(hint), /0\.17\.0/)
  assert.match(String(hint), /0\.18\.0/)
  assert.equal(typeof versionHint('1.0.0', '0.17.0'), 'string')
  assert.equal(versionHint('0.17.0', 'unbekannt'), null)
})

test('Gerätename: Rechnername ohne Domäne, höchstens 60 Zeichen', () => {
  assert.equal(deviceNameOf('Martins-MacBook-Pro.local'), 'Martins-MacBook-Pro')
  assert.equal(deviceNameOf('nas.fritz.box'), 'nas')
  assert.equal(deviceNameOf('BUERO-PC'), 'BUERO-PC')
  const long = 'sjc22-bt151-5e394292-5b7a-4de3-981b-b88b33ef1e43-BECDB73ED975.local'
  assert.equal(deviceNameOf(long), long.slice(0, 60))
  assert.equal(deviceNameOf('  '), 'Programmfenster')
  assert.equal(deviceNameOf('.local'), 'Programmfenster')
})

// Kopplung über einen Reverse Proxy wie Caddy (#528, Erweiterung; docs/superpowers/specs/2026-11-09-kopplung-proxy-design.md)
const LOCAL_PROXY = { NKA_TRUST_PROXY: '127.0.0.1,::1' }

/**
 * Ein Server mit Passwort hinter einem Test-Proxy; `leaf` ist das Zertifikat des Proxys (Vorgabe: Blatt der Test-CA)
 * @param {{ env?: NodeJS.ProcessEnv, forwarded?: { proto?: string | null, host?: string | null }, ownCert?: boolean }} [options]
 */
async function behindProxy({ env = LOCAL_PROXY, forwarded, ownCert = false } = {}) {
  const s = await api.startServerIn(freshDir(), { ...NETWORK, ...env })
  const { cookie } = await api.signIn(s)
  const code = async () => {
    const res = await fetch(`${s.base}/api/auth/pairing`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: '{}' })
    assert.equal(res.status, 200, await res.clone().text())
    return /** @type {{ code: string }} */ (await res.json()).code
  }
  const { caCert, leaf } = await proxies.createTestCa()
  const tlsOf = ownCert ? { key: fs.readFileSync(path.join(s.dataDir, 'tls', 'mietfuchs.key'), 'utf8'), cert: api.serverCa(s.dataDir) } : leaf
  const proxy = await proxies.startTestProxy({ target: s.base, tls: tlsOf, forwarded })
  const posts = () => proxy.requests.filter((/** @type {{ method: string, path: string }} */ r) => r.method === 'POST' && r.path === '/api/auth/pair')
  return { s, proxy, caCert, code, posts, stop: async () => { await proxy.close(); s.stop() } }
}

test('Proxy: mit vertrautem Stammzertifikat koppelt das Fenster in system, danach mit Kette und Name', async () => {
  const p = await behindProxy()
  try {
    const ca = [...systemTrust(), p.caCert]
    const result = await pair({ address: p.proxy.origin, code: await p.code(), name: 'Laptop', ca })
    assert.ok(!('problem' in result), JSON.stringify(result))
    assert.equal(result.trust, 'system')
    assert.equal(result.certSha256, null)
    assert.equal(result.origin, p.proxy.origin)
    const auth = await remoteFetch(result, '/api/auth', { ca })
    assert.equal(auth.status, 200)
    assert.equal(JSON.parse(auth.body).signedIn, true)
  } finally {
    await p.stop()
  }
})

test('Proxy: fremdes Zertifikat ergibt den Satz mit dem Stammzertifikat, und kein Beweis geht hinaus', async () => {
  const p = await behindProxy()
  try {
    const result = await pair({ address: p.proxy.origin, code: await p.code(), name: 'Laptop', ca: systemTrust() })
    assert.ok('problem' in result, JSON.stringify(result))
    assert.match(result.problem, /Stammzertifikat/)
    assert.match(result.problem, /hinter einem Proxy/)
    assert.equal(result.field, 'address')
    assert.deepEqual(p.posts(), [])
  } finally {
    await p.stop()
  }
})

test('Proxy: liefert er das Zertifikat von Mietfuchs aus, koppelt das Fenster gepinnt', async () => {
  const p = await behindProxy({ ownCert: true })
  try {
    const result = await pair({ address: p.proxy.origin, code: await p.code(), name: 'Laptop', ca: systemTrust() })
    assert.ok(!('problem' in result), JSON.stringify(result))
    assert.equal(result.trust, 'pinned')
    assert.equal(result.certSha256, certSha256FromPem(api.serverCa(p.s.dataDir)))
    assert.equal((await remoteFetch(result, '/api/auth')).status, 200)
    assert.equal(JSON.parse((await remoteFetch(result, '/api/auth')).body).signedIn, true)
  } finally {
    await p.stop()
  }
})

test('Proxy: Mietfuchs ohne NKA_TRUST_PROXY nennt die Variable, kein Beweis geht hinaus', async () => {
  const p = await behindProxy({ env: {} })
  try {
    const result = await pair({ address: p.proxy.origin, code: await p.code(), name: 'Laptop', ca: [...systemTrust(), p.caCert] })
    assert.ok('problem' in result, JSON.stringify(result))
    assert.match(result.problem, /NKA_TRUST_PROXY/)
    assert.notEqual(result.field, 'code')
    assert.deepEqual(p.posts(), [])
  } finally {
    await p.stop()
  }
})

test('Proxy: meldet er eine andere Adresse, sagt das Fenster welche, kein Beweis geht hinaus', async () => {
  const p = await behindProxy({ forwarded: { host: 'andere.example' } })
  try {
    const result = await pair({ address: p.proxy.origin, code: await p.code(), name: 'Laptop', ca: [...systemTrust(), p.caCert] })
    assert.ok('problem' in result, JSON.stringify(result))
    assert.match(result.problem, /meldet Mietfuchs die Adresse https:\/\/andere\.example,/)
    assert.equal(result.field, 'address')
    assert.deepEqual(p.posts(), [])
  } finally {
    await p.stop()
  }
})

test('Proxy: verlangt er selbst ein Passwort, nennt das Fenster basic_auth', async () => {
  const { caCert, leaf } = await proxies.createTestCa()
  const guarded = https.createServer({ key: leaf.key, cert: leaf.cert }, (req, res) => {
    res.writeHead(401, { 'www-authenticate': 'Basic realm="restricted"' })
    res.end()
  })
  await api.listening(guarded, '127.0.0.1')
  try {
    const result = await pair({ address: `https://127.0.0.1:${api.portOf(guarded)}`, code: 'AAAA-AAAA-AAAA', name: 'Laptop', ca: [...systemTrust(), caCert] })
    assert.ok('problem' in result, JSON.stringify(result))
    assert.match(result.problem, /basic_auth/)
    assert.equal(result.field, 'address')
  } finally {
    guarded.close()
  }
})

test('Proxy: system lehnt ein Zertifikat außerhalb des Speichers vor dem ersten Byte ab', { timeout: 20_000 }, async () => {
  const first = await proxies.createTestCa()
  const second = await proxies.createTestCa()
  let received = 0
  const raw = tls.createServer({ key: second.leaf.key, cert: second.leaf.cert }, (socket) => {
    socket.on('data', (chunk) => { received += chunk.length })
    socket.on('error', () => {})
  })
  await api.listening(raw, '127.0.0.1')
  try {
    const remote = { origin: `https://127.0.0.1:${api.portOf(raw)}`, trust: /** @type {const} */ ('system'), certSha256: null, deviceId: '0123456789abcdef', deviceKey: 'K'.repeat(43), version: '0.17.0' }
    await assert.rejects(remoteFetch(remote, '/api/units', { ca: [...systemTrust(), first.caCert], timeoutMs: 2000 }), (err) => /** @type {any} */ (err).code === 'CERT_UNTRUSTED')
    // Name passt nicht: Blatt der vertrauten CA nur für einen anderen Namen
    const named = await proxies.createTestCa(['nas.example'])
    const wrongName = tls.createServer({ key: named.leaf.key, cert: named.leaf.cert }, (socket) => {
      socket.on('data', (chunk) => { received += chunk.length })
      socket.on('error', () => {})
    })
    await api.listening(wrongName, '127.0.0.1')
    try {
      await assert.rejects(remoteFetch({ ...remote, origin: `https://127.0.0.1:${api.portOf(wrongName)}` }, '/api/units', { ca: [...systemTrust(), named.caCert], timeoutMs: 2000 }), (err) => /** @type {any} */ (err).code === 'CERT_UNTRUSTED')
    } finally {
      wrongName.close()
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.equal(received, 0)
  } finally {
    raw.close()
  }
})

test('Proxy: remoteFetch in system gegen einen Proxy mit fremder CA, der Proxy sieht keine Anfrage', async () => {
  const p = await behindProxy()
  try {
    const ca = [...systemTrust(), p.caCert]
    const result = await pair({ address: p.proxy.origin, code: await p.code(), name: 'Laptop', ca })
    assert.ok(!('problem' in result), JSON.stringify(result))
    const other = await proxies.createTestCa()
    const before = p.proxy.requests.length
    await assert.rejects(remoteFetch(result, '/api/auth', { ca: [...systemTrust(), other.caCert] }), (err) => /** @type {any} */ (err).code === 'CERT_UNTRUSTED')
    assert.equal(p.proxy.requests.length, before)
  } finally {
    await p.stop()
  }
})

test('Proxy: pinDecision lässt in system die normale Prüfung', () => {
  assert.equal(pinDecision('nas.fritz.box', 'x', { origin: 'https://nas.fritz.box', trust: 'system', certSha256: null }), 'default')
  // Ohne trust gilt wie bisher gepinnt
  assert.equal(pinDecision('nas', 'b'.repeat(64), { origin: 'https://nas:3001', certSha256: 'a'.repeat(64) }), 'reject')
})

test('Adresse: https:// ohne Port heißt 443, sonst bleibt 3001 die Vorgabe', () => {
  assert.deepEqual(normalizeAddress('https://nas.fritz.box'), { host: 'nas.fritz.box', port: 443, origin: 'https://nas.fritz.box' })
  assert.deepEqual(normalizeAddress('https://NAS.fritz.box/einstellungen'), { host: 'nas.fritz.box', port: 443, origin: 'https://nas.fritz.box' })
  assert.deepEqual(normalizeAddress('https://nas.fritz.box:8443'), { host: 'nas.fritz.box', port: 8443, origin: 'https://nas.fritz.box:8443' })
  assert.deepEqual(normalizeAddress('nas'), { host: 'nas', port: 3001, origin: 'https://nas:3001' })
  assert.deepEqual(normalizeAddress('http://nas'), { host: 'nas', port: 3001, origin: 'https://nas:3001' })
  // Internationale Namen wie der Server (new URL): Punycode
  assert.deepEqual(normalizeAddress('https://bücher.example'), { host: 'xn--bcher-kva.example', port: 443, origin: 'https://xn--bcher-kva.example' })
})

test('Adresse: nicht erreichbar ohne Schema und Port, der Satz nennt https://', async () => {
  const bare = await pair({ address: 'nas.invalid', code: 'AAAA-AAAA-AAAA', name: 'Laptop' })
  assert.ok('problem' in bare)
  assert.match(bare.problem, /nicht erreichbar/)
  assert.match(bare.problem, /mit https:\/\/ davor ein, etwa https:\/\/nas\.fritz\.box\.$/)
  assert.equal(bare.field, 'address')
  // Mit Port oder Schema nicht
  const port = await freePort()
  const withPort = await pair({ address: `127.0.0.1:${port}`, code: 'AAAA-AAAA-AAAA', name: 'Laptop' })
  assert.ok('problem' in withPort)
  assert.doesNotMatch(withPort.problem, /https:\/\//)
})

test('Ausgestellt von: passende CA und Name, sonst nicht', async () => {
  const one = await proxies.createTestCa(['nas.example', '127.0.0.1'])
  const two = await proxies.createTestCa(['nas.example'])
  assert.equal(issuedBy(one.leaf.cert, one.caCert, 'nas.example'), true)
  assert.equal(issuedBy(one.leaf.cert, one.caCert, 'NAS.example'), true)
  assert.equal(issuedBy(one.leaf.cert, one.caCert, '127.0.0.1'), true)
  assert.equal(issuedBy(one.leaf.cert, one.caCert, 'andere.example'), false)
  assert.equal(issuedBy(one.leaf.cert, two.caCert, 'nas.example'), false)
  // Abgelaufen bzw. noch nicht gültig
  assert.equal(issuedBy(one.leaf.cert, one.caCert, 'nas.example', new Date(Date.now() + 30 * 24 * 60 * 60_000)), false)
  assert.equal(issuedBy('kein Zertifikat', one.caCert, 'nas.example'), false)
})

test('Speicher des Systems: einmal gerechnet, enthält die Vorgabe von Node', () => {
  const trust = systemTrust()
  assert.ok(trust.length >= tls.getCACertificates('default').length)
  assert.equal(systemTrust(), trust)
})

// Durchsicht PR 2, Runde 1: Fehler kommen am richtigen Feld an, ohne dass ein Beweis hinausgeht
/**
 * Ein nachgebauter Mietfuchs hinter einem Proxy mit Blatt einer Test-CA; `answer` beantwortet jede Anfrage
 * @param {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void} answer
 * @param {string[]} [names]
 */
async function fakeBehindProxy(answer, names) {
  const { caCert, leaf } = await proxies.createTestCa(names)
  /** @type {string[]} */
  const seen = []
  const server = https.createServer({ key: leaf.key, cert: leaf.cert }, (req, res) => {
    seen.push(`${req.method} ${req.url}`)
    answer(req, res)
  })
  await api.listening(server, '127.0.0.1')
  const origin = `https://127.0.0.1:${api.portOf(server)}`
  return { origin, ca: [...systemTrust(), caCert], posts: () => seen.filter((line) => line.startsWith('POST')), close: () => server.close() }
}

/** @param {object} body */
const preflightAnswer = (body) => (/** @type {import('node:http').IncomingMessage} */ req, /** @type {import('node:http').ServerResponse} */ res) => {
  res.setHeader('content-type', 'application/json')
  if (req.method === 'GET' && req.url === '/api/auth/pair') return res.end(JSON.stringify(body))
  res.end(JSON.stringify({ id: 'abcdef0123456789', deviceKey: 'K'.repeat(43), version: '0.17.0' }))
}

test('Proxy: lehnt Mietfuchs den weitergereichten Namen ab, steht der Grund am Feld Adresse, kein Beweis geht hinaus', async () => {
  const p = await behindProxy({ env: { ...LOCAL_PROXY, NKA_ALLOWED_HOSTS: 'nas.example' }, forwarded: { host: 'andere.example' } })
  try {
    const result = await pair({ address: p.proxy.origin, code: await p.code(), name: 'Laptop', ca: [...systemTrust(), p.caCert] })
    assert.deepEqual(result, { problem: 'Mietfuchs antwortet nicht unter dem Namen „andere.example“. Erreichbar ist es unter seiner IP-Adresse, unter localhost und unter Namen im Heimnetz. Einen eigenen Namen tragen Sie in NKA_ALLOWED_HOSTS ein.', field: 'address' })
    assert.deepEqual(p.posts(), [])
  } finally {
    await p.stop()
  }
})

test('Proxy: liefert er das Zertifikat von Mietfuchs aus, koppelt das Fenster auch mit abgelehntem Namen gepinnt', async () => {
  const p = await behindProxy({ env: { ...LOCAL_PROXY, NKA_ALLOWED_HOSTS: 'nas.example' }, forwarded: { host: 'andere.example' }, ownCert: true })
  try {
    const result = await pair({ address: p.proxy.origin, code: await p.code(), name: 'Laptop', ca: systemTrust() })
    assert.ok(!('problem' in result), JSON.stringify(result))
    assert.equal(result.trust, 'pinned')
  } finally {
    await p.stop()
  }
})

test('Host-Prüfung: 403 mit Text steht am Feld Adresse, sonst bleibt es bei „kein Mietfuchs“', async () => {
  const refusal = 'Mietfuchs antwortet nicht unter dem Namen „nas.example“. Erreichbar ist es unter seiner IP-Adresse, unter localhost und unter Namen im Heimnetz. Einen eigenen Namen tragen Sie in NKA_ALLOWED_HOSTS ein.'
  const guarded = await fakeBehindProxy((req, res) => {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(refusal)
  })
  try {
    assert.deepEqual(await pair({ address: guarded.origin, code: 'AAAA-AAAA-AAAA', name: 'Laptop', ca: guarded.ca }), { problem: refusal, field: 'address' })
    assert.deepEqual(guarded.posts(), [])
  } finally {
    guarded.close()
  }
  const html = await fakeBehindProxy((req, res) => {
    res.writeHead(403, { 'content-type': 'text/html' })
    res.end('<h1>Forbidden</h1>')
  })
  try {
    const result = await pair({ address: html.origin, code: 'AAAA-AAAA-AAAA', name: 'Laptop', ca: html.ca })
    assert.ok('problem' in result)
    assert.match(result.problem, /kein Mietfuchs/)
    assert.equal(result.field, 'address')
  } finally {
    html.close()
  }  // Ein fremder Server mit „Forbidden“ als Text: dessen Text gibt das Fenster nicht weiter
  const plain = await fakeBehindProxy((req, res) => {
    res.writeHead(403, { 'content-type': 'text/plain' })
    res.end('Forbidden')
  })
  try {
    const result = await pair({ address: plain.origin, code: 'AAAA-AAAA-AAAA', name: 'Laptop', ca: plain.ca })
    assert.ok('problem' in result)
    assert.match(result.problem, /kein Mietfuchs/)
    assert.equal(result.field, 'address')
  } finally {
    plain.close()
  }
})

test('Koppeln: 400 mit transport gehört nie zum Feld Code', async () => {
  const sentence = 'Mietfuchs steht hinter einem Proxy, dem es nicht vertraut, oder der Proxy meldet kein HTTPS. Tragen Sie den Proxy in NKA_TRUST_PROXY ein. Der Code bleibt gültig.'
  /** @type {string} */
  let origin = ''
  const fake = await fakeBehindProxy((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.method === 'GET') return res.end(JSON.stringify({ app: 'mietfuchs', certSha256: null, secure: true, origin }))
    res.writeHead(400)
    res.end(JSON.stringify({ error: sentence, transport: true }))
  })
  origin = fake.origin
  try {
    const result = await pair({ address: fake.origin, code: 'AAAA-AAAA-AAAA', name: 'Laptop', ca: fake.ca })
    assert.ok('problem' in result)
    assert.equal(result.problem, sentence)
    // An der Verbindung liegt es, also an der Adresse (auch problemField in der Karte ordnet dann nicht nach Stichwort)
    assert.equal(result.field, 'address')
    assert.equal(fake.posts().length, 1)
  } finally {
    fake.close()
  }
})

test('Proxy: verschlüsselt, aber ohne Ursprung, sagt das Fenster, dass Mietfuchs dem Proxy nicht vertraut', async () => {
  const fake = await fakeBehindProxy(preflightAnswer({ app: 'mietfuchs', certSha256: 'a'.repeat(64), secure: true, origin: null }))
  try {
    const result = await pair({ address: fake.origin, code: 'AAAA-AAAA-AAAA', name: 'Laptop', ca: fake.ca })
    assert.ok('problem' in result)
    assert.equal(result.problem, `Mietfuchs unter 127.0.0.1:${new URL(fake.origin).port} vertraut dem Proxy davor nicht und erfährt deshalb nicht, unter welcher Adresse Sie es aufrufen. Tragen Sie den Proxy bei Mietfuchs in NKA_TRUST_PROXY ein; in compose.caddy.yml steht das schon.`)
    assert.deepEqual(fake.posts(), [])
  } finally {
    fake.close()
  }
  // secure: false bleibt beim Satz der Spec
  const plain = await fakeBehindProxy(preflightAnswer({ app: 'mietfuchs', certSha256: 'a'.repeat(64), secure: false, origin: null }))
  try {
    const result = await pair({ address: plain.origin, code: 'AAAA-AAAA-AAAA', name: 'Laptop', ca: plain.ca })
    assert.ok('problem' in result)
    assert.match(result.problem, /sieht die Verbindung nicht als verschlüsselt an/)
    assert.deepEqual(plain.posts(), [])
  } finally {
    plain.close()
  }
})

test('Proxy: vertraute Kette, aber ein anderer Name im Zertifikat, ergibt keinen Beweis', async () => {
  /** @type {string} */
  let origin = ''
  const fake = await fakeBehindProxy((req, res) => preflightAnswer({ app: 'mietfuchs', certSha256: 'a'.repeat(64), secure: true, origin })(req, res), ['nas.example'])
  origin = fake.origin
  try {
    const result = await pair({ address: fake.origin, code: 'AAAA-AAAA-AAAA', name: 'Laptop', ca: fake.ca })
    assert.ok('problem' in result, JSON.stringify(result))
    assert.match(result.problem, /Stammzertifikat/)
    assert.match(result.problem, /anderen Namen/)
    assert.equal(result.field, 'address')
    assert.deepEqual(fake.posts(), [])
  } finally {
    fake.close()
  }
})

test('Adresse: der Satz zu einer unlesbaren Adresse nennt auch https://', () => {
  const result = normalizeAddress('ftp://nas')
  assert.ok('problem' in result)
  assert.match(result.problem, /etwa nas:3001, 192\.168\.1\.5:3001 oder https:\/\/nas\.fritz\.box\.$/)
})

// Integrationsdurchsicht m4: Ein 401 in `system` heißt nicht immer, dass der Server das Fenster vergessen hat. Vertraut
// Mietfuchs dem Proxy gerade nicht (Caddy eben neu erstellt, NKA_TRUST_PROXY fehlt), gilt kein Geräteschlüssel. Dann der
// Satz zu NKA_TRUST_PROXY, nicht „koppeln Sie neu“.
test('Abgelehnter Schlüssel: in system fragt das Fenster die Vorabfrage, bevor es neu koppeln lässt', async () => {
  /** @type {{ preflight: { secure: boolean, origin: string | null, problem?: string }, expected: string }[]} */
  const cases = [
    { preflight: { secure: false, origin: null }, expected: 'proxy' },
    { preflight: { secure: true, origin: null }, expected: 'proxy' },
    { preflight: { secure: true, origin: null, problem: 'Mietfuchs antwortet nicht unter dem Namen …' }, expected: 'key' },
    { preflight: { secure: true, origin: 'ORIGIN' }, expected: 'key' },
  ]
  for (const { preflight, expected } of cases) {
    /** @type {string} */
    let origin = ''
    const fake = await fakeBehindProxy((req, res) => {
      res.setHeader('content-type', 'application/json')
      if (req.method === 'GET' && req.url === '/api/auth/pair') return res.end(JSON.stringify({ app: 'mietfuchs', certSha256: null, ...preflight, ...(preflight.origin === 'ORIGIN' ? { origin } : {}) }))
      res.writeHead(401)
      res.end('{}')
    })
    origin = fake.origin
    try {
      const remote = { origin: fake.origin, trust: /** @type {const} */ ('system'), certSha256: null, deviceId: 'abcdef0123456789', deviceKey: 'K'.repeat(43), version: '0.17.0' }
      assert.equal(await rejectedKeyReason(remote, { ca: fake.ca }), expected, JSON.stringify(preflight))
    } finally {
      fake.close()
    }
  }
  // Nicht erreichbar: bleibt beim bisherigen Satz
  const gone = { origin: `https://127.0.0.1:${await freePort()}`, trust: /** @type {const} */ ('system'), certSha256: null, deviceId: 'abcdef0123456789', deviceKey: 'K'.repeat(43), version: '0.17.0' }
  assert.equal(await rejectedKeyReason(gone, { ca: systemTrust(), timeoutMs: 2000 }), 'key')
  // Gepinnt: direkt an Mietfuchs, ohne Proxy, der vergessen sein könnte; keine Anfrage
  const pinned = { ...gone, trust: /** @type {const} */ ('pinned'), certSha256: 'a'.repeat(64) }
  assert.equal(await rejectedKeyReason(pinned, { ca: systemTrust() }), 'key')
})

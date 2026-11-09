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
import { certSha256FromPem, deviceNameOf, jsonOr, normalizeAddress, pair, pinDecision, remoteFetch, versionHint } from '../src/pairing.js'
import { freePort } from '../src/server.js'

// Die Helfer der Servertests. Über eine errechnete Adresse geladen: Der Server ist TypeScript mit eigener Typprüfung,
// die des Fensters soll ihn nicht ein zweites Mal mit ihren Einstellungen prüfen.
/** @type {any} */
const api = await import(new URL('../../server/testing/api.ts', import.meta.url).href)

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

test('Koppeln: eine Antwort mit unbrauchbarem Gerät wird nicht gemerkt, das Gerät beste Mühe wieder entfernt', async () => {
  const { key, cert } = await borrowedKeyPair()
  /** @type {string[]} */
  const seen = []
  const fake = https.createServer({ key, cert }, (req, res) => {
    seen.push(`${req.method} ${req.url} ${req.headers['x-mietfuchs-device'] ?? '-'}`)
    res.setHeader('content-type', 'application/json')
    if (req.url === '/healthz') return res.end(JSON.stringify({ app: 'mietfuchs', status: 'ok' }))
    if (req.url === '/api/auth/pair') return res.end(JSON.stringify({ id: 'abc123', deviceKey: 'zu kurz\r\n', version: '0.17.0' }))
    res.end('{"ok":true}')
  })
  await api.listening(fake, '127.0.0.1')
  try {
    const result = await pair({ address: `127.0.0.1:${api.portOf(fake)}`, code: 'AAAA-AAAA-AAAA', name: 'Laptop' })
    assert.ok('problem' in result, JSON.stringify(result))
    assert.match(result.problem, /Koppeln/)
    assert.equal(result.field, undefined, 'unbrauchbare Antwort: kein Feld')
    assert.deepEqual(seen.slice(0, 2), ['GET /healthz -', 'POST /api/auth/pair -'])
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
    if (req.url === '/healthz') return res.end(JSON.stringify({ app: 'mietfuchs', status: 'ok' }))
    if (req.url === '/api/auth/pair') return res.end(JSON.stringify({ id: longId, deviceKey: 'K'.repeat(43), version: '0.17.0' }))
    res.end('{"ok":true}')
  })
  await api.listening(fake2, '127.0.0.1')
  try {
    seen.length = 0
    const result = await pair({ address: `127.0.0.1:${api.portOf(fake2)}`, code: 'AAAA-AAAA-AAAA', name: 'Laptop' })
    assert.ok('problem' in result, JSON.stringify(result))
    assert.equal(result.field, undefined)
    assert.deepEqual(seen, ['GET /healthz -', 'POST /api/auth/pair -', `DELETE /api/auth/devices/${longId} ${longId}.${'K'.repeat(43)}`])
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

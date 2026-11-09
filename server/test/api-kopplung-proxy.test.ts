// Programmfenster über einen Reverse Proxy koppeln (#528, Erweiterung) gegen den echten Server: NKA_TRUST_PROXY, Kanal,
// Vorabfrage `GET /api/auth/pair` und die zwei Bindungen des Beweises (Fingerabdruck, Ursprung). Der Proxy ist ein
// Node-HTTPS-Server wie Caddy (server/testing/proxy.ts) mit eigener Test-CA. Entwurf:
// docs/superpowers/specs/2026-11-09-kopplung-proxy-design.md. Die Bausteine ohne Server prüfen access.test.ts und
// trustProxy.test.ts, die direkte Kopplung api-kopplung.test.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { originProof, pairingProof } from '../src/access.ts'
import { httpsFetch, jsonOf, serverCa, signIn, startServerIn, type Server } from '../testing/api.ts'
import { createTestCa, startTestProxy } from '../testing/proxy.ts'

const freshDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-kopplung-proxy-'))
const NETWORK = { NKA_HOST: '0.0.0.0' }
const LOCAL_PROXY = '127.0.0.1,::1'
const WRONG_CODE = 'Der Code stimmt nicht oder ist abgelaufen.'
const UNTRUSTED = 'Mietfuchs steht hinter einem Proxy, dem es nicht vertraut, oder der Proxy meldet kein HTTPS. Tragen Sie den Proxy in NKA_TRUST_PROXY ein.'
const NOT_ENCRYPTED = 'Koppeln geht nur über eine verschlüsselte Verbindung.'
// Was ein Gerät im Heimnetz selbst schicken kann
const FORGED = { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'nas.fritz.box', 'x-forwarded-for': '192.168.1.9' }

type Preflight = { app: string, certSha256: string | null, secure: boolean, origin: string | null, problem?: string }
type Paired = { id: string, deviceKey: string, version: string }

async function serverWithPassword(env: NodeJS.ProcessEnv = {}, dataDir = freshDir()) {
  const s = await startServerIn(dataDir, { ...NETWORK, ...env })
  const { cookie } = await signIn(s)
  return { s, cookie }
}

async function newCode(s: Server, cookie: string): Promise<string> {
  const res = await fetch(`${s.base}/api/auth/pairing`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: '{}' })
  assert.equal(res.status, 200, await res.clone().text())
  return (await jsonOf<{ code: string }>(res)).code
}

// Über HTTP mit frei gesetzten Kopfzeilen, auch doppelten (fetch fasst sie zusammen)
function plain(base: string, urlPath: string, { method = 'GET', headers = {}, body }: { method?: string, headers?: http.OutgoingHttpHeaders, body?: string } = {}): Promise<{ status: number, body: string, headers: http.IncomingHttpHeaders }> {
  const url = new URL(base)
  return new Promise((resolve, reject) => {
    const req = http.request({ host: url.hostname, port: url.port, method, path: urlPath, agent: false, headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) }) } }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (c: string) => { text += c })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text, headers: res.headers }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

const direct = (s: Server, urlPath: string, init: Parameters<typeof httpsFetch>[2] = {}) => httpsFetch(s.base, urlPath, { ...init, ca: serverCa(s.dataDir) })
const pairBody = (proof: string) => JSON.stringify({ name: 'Laptop', proof })
const deviceHeader = (p: Paired) => ({ 'x-mietfuchs-device': `${p.id}.${p.deviceKey}` })
const preflightOf = (body: string): Preflight => JSON.parse(body) as Preflight

// Direkt über TLS gekoppelt, wie bisher
async function pairDirect(s: Server, cookie: string): Promise<Paired> {
  const code = await newCode(s, cookie)
  const cert = (await direct(s, '/healthz')).certSha256
  const res = await direct(s, '/api/auth/pair', { method: 'POST', body: pairBody(pairingProof(code, cert)) })
  assert.equal(res.status, 200, res.body)
  return JSON.parse(res.body) as Paired
}

// Review Focus 1 und 2: Kopfzeilen von einem Peer, dem Mietfuchs nicht vertraut, zählen nicht
async function forgeryRefused(s: Server, cookie: string) {
  const device = await pairDirect(s, cookie)
  const cert = (await direct(s, '/healthz')).certSha256
  assert.equal((await direct(s, '/api/units', { headers: deviceHeader(device) })).status, 200, 'direkt über TLS gilt der Schlüssel')
  assert.equal((await plain(s.base, '/api/units', { headers: { ...FORGED, ...deviceHeader(device) } })).status, 401)
  const code = await newCode(s, cookie)
  for (const proof of [originProof(code, 'https://nas.fritz.box'), pairingProof(code, cert)]) {
    const res = await plain(s.base, '/api/auth/pair', { method: 'POST', headers: FORGED, body: pairBody(proof) })
    assert.equal(res.status, 400, res.body)
    assert.deepEqual(JSON.parse(res.body), { error: UNTRUSTED, transport: true })
  }
  // ohne Proxy-Kopfzeilen der bisherige Satz, ebenfalls als Frage der Verbindung
  const bare = await plain(s.base, '/api/auth/pair', { method: 'POST', body: pairBody(pairingProof(code, cert)) })
  assert.equal(bare.status, 400)
  assert.deepEqual(JSON.parse(bare.body), { error: NOT_ENCRYPTED, transport: true })
  const preflight = await plain(s.base, '/api/auth/pair', { headers: FORGED })
  assert.equal(preflight.status, 200, preflight.body)
  assert.equal(preflight.headers['cache-control'], 'no-store')
  assert.deepEqual(preflightOf(preflight.body), { app: 'mietfuchs', certSha256: cert, secure: false, origin: null })
  // der Code ist nicht verbraucht: direkt über TLS koppelt er weiter
  assert.equal((await direct(s, '/api/auth/pair', { method: 'POST', body: pairBody(pairingProof(code, cert)) })).status, 200)
}

test('Proxy: ein Gerät im Heimnetz fälscht die Kopfzeilen eines Proxys, der nicht eingetragen ist', async () => {
  const { s, cookie } = await serverWithPassword({ NKA_TRUST_PROXY: '192.0.2.1' })
  try {
    await forgeryRefused(s, cookie)
    assert.doesNotMatch(s.errorOutput(), /NKA_TRUST_PROXY/)
  } finally {
    s.stop()
  }
})

test('Proxy: ohne NKA_TRUST_PROXY zählt keine Proxy-Kopfzeile, keine neue Startzeile', async () => {
  const { s, cookie } = await serverWithPassword()
  try {
    await forgeryRefused(s, cookie)
    assert.doesNotMatch(s.errorOutput(), /NKA_TRUST_PROXY/)
    assert.doesNotMatch(s.output(), /NKA_TRUST_PROXY/)
  } finally {
    s.stop()
  }
})

test('Proxy: ein vertrauter Peer, der kein HTTPS oder zwei Werte meldet, ist kein HTTPS', async () => {
  const { s, cookie } = await serverWithPassword({ NKA_TRUST_PROXY: LOCAL_PROXY })
  try {
    const device = await pairDirect(s, cookie)
    const code = await newCode(s, cookie)
    const reported: http.OutgoingHttpHeaders[] = [
      { 'x-forwarded-proto': 'http', 'x-forwarded-host': 'nas.fritz.box' },
      { 'x-forwarded-proto': 'https, https', 'x-forwarded-host': 'nas.fritz.box' },
      { 'x-forwarded-proto': ['https', 'https'], 'x-forwarded-host': 'nas.fritz.box' },
      { 'x-forwarded-proto': 'https', 'x-forwarded-host': ['nas.fritz.box', 'andere.example'] },
    ]
    for (const headers of reported) {
      const what = JSON.stringify(headers)
      const pair = await plain(s.base, '/api/auth/pair', { method: 'POST', headers, body: pairBody(originProof(code, 'https://nas.fritz.box')) })
      assert.equal(pair.status, 400, what)
      assert.equal(JSON.parse(pair.body).transport, true, what)
      assert.equal((await plain(s.base, '/api/units', { headers: { ...headers, ...deviceHeader(device) } })).status, 401, what)
      assert.equal(preflightOf((await plain(s.base, '/api/auth/pair', { headers })).body).secure, false, what)
      // auch über die eigene TLS-Verbindung: der vertraute Peer sagt, der Browser kam nicht über HTTPS
      if (typeof headers['x-forwarded-proto'] === 'string') {
        assert.equal((await direct(s, '/api/units', { headers: { ...(headers as Record<string, string>), ...deviceHeader(device) } })).status, 401, what)
      }
    }
  } finally {
    s.stop()
  }
})

test('Proxy: Bindung an den Ursprung über einen vertrauten Proxy mit Zertifikat aus einer CA', async () => {
  const { s, cookie } = await serverWithPassword({ NKA_TRUST_PROXY: LOCAL_PROXY })
  const { caCert, leaf } = await createTestCa()
  const proxy = await startTestProxy({ target: s.base, tls: leaf })
  try {
    const own = (await direct(s, '/healthz')).certSha256
    const viaProxy = (urlPath: string, init: Parameters<typeof httpsFetch>[2] = {}) => httpsFetch(proxy.origin, urlPath, { ...init, ca: caCert })
    const preflight = await viaProxy('/api/auth/pair')
    assert.equal(preflight.status, 200, preflight.body)
    assert.equal(preflight.headers['cache-control'], 'no-store')
    assert.deepEqual(preflightOf(preflight.body), { app: 'mietfuchs', certSha256: own, secure: true, origin: proxy.origin })
    assert.notEqual(preflight.certSha256, own, 'am Proxy das Zertifikat der CA')

    const code = await newCode(s, cookie)
    const proof = originProof(code, proxy.origin)
    const res = await viaProxy('/api/auth/pair', { method: 'POST', body: pairBody(proof) })
    assert.equal(res.status, 200, res.body)
    const device = JSON.parse(res.body) as Paired
    assert.equal((await viaProxy('/api/units', { headers: deviceHeader(device) })).status, 200)
    assert.equal((await plain(s.base, '/api/units', { headers: deviceHeader(device) })).status, 401)
    assert.ok(proxy.requests.some((r) => r.method === 'POST' && r.path === '/api/auth/pair'))

    // Kein Code, Schlüssel oder Beweis im Protokoll
    for (const secret of [code, code.replaceAll('-', ''), device.deviceKey, proof]) {
      assert.equal(s.output().includes(secret), false, 'stdout')
      assert.equal(s.errorOutput().includes(secret), false, 'stderr')
    }
  } finally {
    await proxy.close()
    s.stop()
  }
})

test('Proxy: ein Beweis für einen anderen Ursprung gilt nicht, auch nicht direkt über TLS', async () => {
  const { s, cookie } = await serverWithPassword({ NKA_TRUST_PROXY: LOCAL_PROXY })
  const { caCert, leaf } = await createTestCa()
  const elsewhere = await startTestProxy({ target: s.base, tls: leaf, forwarded: { host: 'andere.example' } })
  const proxy = await startTestProxy({ target: s.base, tls: leaf })
  try {
    assert.equal(preflightOf((await httpsFetch(elsewhere.origin, '/api/auth/pair', { ca: caCert })).body).origin, 'https://andere.example')
    const code = await newCode(s, cookie)
    const proof = originProof(code, proxy.origin)
    const wrong = await httpsFetch(elsewhere.origin, '/api/auth/pair', { method: 'POST', body: pairBody(proof), ca: caCert })
    assert.equal(wrong.status, 400, wrong.body)
    assert.deepEqual(JSON.parse(wrong.body), { error: WRONG_CODE })
    const viaTls = await direct(s, '/api/auth/pair', { method: 'POST', body: pairBody(proof) })
    assert.equal(viaTls.status, 400, viaTls.body)
    assert.deepEqual(JSON.parse(viaTls.body), { error: WRONG_CODE })
    // derselbe Beweis über den Proxy, dessen Ursprung er nennt
    assert.equal((await httpsFetch(proxy.origin, '/api/auth/pair', { method: 'POST', body: pairBody(proof), ca: caCert })).status, 200)
  } finally {
    await elsewhere.close()
    await proxy.close()
    s.stop()
  }
})

test('Proxy: Bindung an den Fingerabdruck, wenn der Proxy das Zertifikat von Mietfuchs ausliefert', async () => {
  for (const trusted of [true, false]) {
    const { s, cookie } = await serverWithPassword(trusted ? { NKA_TRUST_PROXY: LOCAL_PROXY } : {})
    const tlsDir = path.join(s.dataDir, 'tls')
    const proxy = await startTestProxy({ target: s.base, tls: { key: fs.readFileSync(path.join(tlsDir, 'mietfuchs.key'), 'utf8'), cert: fs.readFileSync(path.join(tlsDir, 'mietfuchs.crt'), 'utf8') } })
    try {
      const preflight = await httpsFetch(proxy.origin, '/api/auth/pair', { ca: serverCa(s.dataDir) })
      const seen = preflightOf(preflight.body)
      assert.equal(seen.certSha256, preflight.certSha256, 'die Vorabfrage nennt das Zertifikat, das am Proxy zu sehen ist')
      assert.equal(seen.secure, trusted)
      const code = await newCode(s, cookie)
      const res = await httpsFetch(proxy.origin, '/api/auth/pair', { method: 'POST', body: pairBody(pairingProof(code, preflight.certSha256)), ca: serverCa(s.dataDir) })
      if (trusted) {
        assert.equal(res.status, 200, res.body)
      } else {
        assert.equal(res.status, 400, res.body)
        assert.deepEqual(JSON.parse(res.body), { error: UNTRUSTED, transport: true })
      }
    } finally {
      await proxy.close()
      s.stop()
    }
  }
})

test('Proxy: direkt über TLS nennt die Vorabfrage den Fingerabdruck und keinen Ursprung', async () => {
  const { s } = await serverWithPassword({ NKA_TRUST_PROXY: LOCAL_PROXY })
  try {
    const res = await direct(s, '/api/auth/pair')
    assert.equal(res.status, 200, res.body)
    assert.deepEqual(preflightOf(res.body), { app: 'mietfuchs', certSha256: res.certSha256, secure: true, origin: null })
    // über HTTP ohne Proxy-Kopfzeilen: kein HTTPS
    assert.equal(preflightOf((await plain(s.base, '/api/auth/pair')).body).secure, false)
  } finally {
    s.stop()
  }
})

test('Proxy: Koppeln ist mit NKA_TRUST_PROXY auch ohne eigenes Zertifikat möglich, nur über den Ursprung', async () => {
  for (const trusted of [true, false]) {
    const dataDir = freshDir()
    // An der Stelle des Ordners eine Datei: kein eigenes Zertifikat (wie in api-https.test.ts)
    fs.writeFileSync(path.join(dataDir, 'tls'), 'keine Ablage')
    const { s, cookie } = await serverWithPassword(trusted ? { NKA_TRUST_PROXY: LOCAL_PROXY } : {}, dataDir)
    try {
      const auth = await jsonOf<{ pairing: { available: boolean } }>(await fetch(`${s.base}/api/auth`, { headers: { cookie } }))
      assert.equal(auth.pairing.available, trusted)
      const pairing = await fetch(`${s.base}/api/auth/pairing`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: '{}' })
      assert.equal(pairing.status, trusted ? 200 : 409)
      if (!trusted) continue
      const { code } = await jsonOf<{ code: string }>(pairing)
      const { caCert, leaf } = await createTestCa()
      const proxy = await startTestProxy({ target: s.base, tls: leaf })
      try {
        assert.deepEqual(preflightOf((await httpsFetch(proxy.origin, '/api/auth/pair', { ca: caCert })).body), { app: 'mietfuchs', certSha256: null, secure: true, origin: proxy.origin })
        const res = await httpsFetch(proxy.origin, '/api/auth/pair', { method: 'POST', body: pairBody(originProof(code, proxy.origin)), ca: caCert })
        assert.equal(res.status, 200, res.body)
      } finally {
        await proxy.close()
      }
    } finally {
      s.stop()
    }
  }
})

test('Proxy: NKA_TRUST_PROXY, das jedem vertraute, gilt nicht und sagt es beim Start', async () => {
  const { s, cookie } = await serverWithPassword({ NKA_TRUST_PROXY: '*' })
  try {
    const lines = s.errorOutput().split('\n').filter((line) => line.startsWith('NKA_TRUST_PROXY'))
    assert.deepEqual(lines, ['NKA_TRUST_PROXY: „*“ vertraut jedem und gilt nicht. Tragen Sie die Adresse oder den Namen des Proxys ein.'])
    await forgeryRefused(s, cookie)
  } finally {
    s.stop()
  }
})

test('Proxy: ein Name in NKA_TRUST_PROXY wird bei der ersten Anfrage über den Proxy aufgelöst', async () => {
  // `localhost` löst das System ohne Netz auf; wie `caddy` in Docker Compose erst bei Bedarf
  const { s, cookie } = await serverWithPassword({ NKA_TRUST_PROXY: 'localhost' })
  const { caCert, leaf } = await createTestCa()
  const proxy = await startTestProxy({ target: s.base, tls: leaf })
  try {
    assert.equal(preflightOf((await httpsFetch(proxy.origin, '/api/auth/pair', { ca: caCert })).body).secure, true)
    const code = await newCode(s, cookie)
    assert.equal((await httpsFetch(proxy.origin, '/api/auth/pair', { method: 'POST', body: pairBody(originProof(code, proxy.origin)), ca: caCert })).status, 200)
    assert.doesNotMatch(s.errorOutput(), /NKA_TRUST_PROXY/)
  } finally {
    await proxy.close()
    s.stop()
  }
})

// Durchsicht PR 1 (I2): Die Bindung an den Ursprung hängt sonst daran, dass der Proxy X-Forwarded-Host selbst setzt.
// Ein Proxy, der den Wert eines Clients durchreicht oder jede Adresse annimmt, gäbe einen fremden Namen weiter. Mit
// einer Liste von Namen (NKA_ALLOWED_HOSTS, dieselbe Regel wie die Host-Prüfung) gilt nur ein Ursprung, der dort besteht.
test('Proxy: mit NKA_ALLOWED_HOSTS gilt ein Beweis mit Ursprung nur für einen erlaubten Namen', async () => {
  const { s, cookie } = await serverWithPassword({ NKA_TRUST_PROXY: LOCAL_PROXY, NKA_ALLOWED_HOSTS: 'nas.example' })
  const { caCert, leaf } = await createTestCa()
  const foreign = await startTestProxy({ target: s.base, tls: leaf, forwarded: { host: 'andere.example' } })
  const listed = await startTestProxy({ target: s.base, tls: leaf, forwarded: { host: 'nas.example' } })
  try {
    // Durchsicht PR 2 (I2): Die Vorabfrage nennt einen Ursprung nur, wenn er binden kann, sonst den Grund. Sonst rechnete
    // das Fenster einen Beweis, der nie gilt, und der Nutzer probierte endlos neue Codes.
    const refusal = 'Mietfuchs antwortet nicht unter dem Namen „andere.example“. Erreichbar ist es unter seiner IP-Adresse, unter localhost und unter Namen im Heimnetz. Einen eigenen Namen tragen Sie in NKA_ALLOWED_HOSTS ein.'
    const own = (await direct(s, '/healthz')).certSha256
    assert.deepEqual(preflightOf((await httpsFetch(foreign.origin, '/api/auth/pair', { ca: caCert })).body), { app: 'mietfuchs', certSha256: own, secure: true, origin: null, problem: refusal })
    assert.deepEqual(preflightOf((await httpsFetch(listed.origin, '/api/auth/pair', { ca: caCert })).body), { app: 'mietfuchs', certSha256: own, secure: true, origin: 'https://nas.example' })
    const code = await newCode(s, cookie)
    const wrong = await httpsFetch(foreign.origin, '/api/auth/pair', { method: 'POST', body: pairBody(originProof(code, 'https://andere.example')), ca: caCert })
    assert.equal(wrong.status, 400, wrong.body)
    assert.deepEqual(JSON.parse(wrong.body), { error: refusal, transport: true })
    const right = await httpsFetch(listed.origin, '/api/auth/pair', { method: 'POST', body: pairBody(originProof(code, 'https://nas.example')), ca: caCert })
    assert.equal(right.status, 200, right.body)
  } finally {
    await foreign.close()
    await listed.close()
    s.stop()
  }
})

test('Proxy: ein nicht erlaubter weitergereichter Name hindert die Bindung an den Fingerabdruck nicht', async () => {
  const { s, cookie } = await serverWithPassword({ NKA_TRUST_PROXY: LOCAL_PROXY, NKA_ALLOWED_HOSTS: 'nas.example' })
  const tlsDir = path.join(s.dataDir, 'tls')
  const proxy = await startTestProxy({ target: s.base, tls: { key: fs.readFileSync(path.join(tlsDir, 'mietfuchs.key'), 'utf8'), cert: fs.readFileSync(path.join(tlsDir, 'mietfuchs.crt'), 'utf8') }, forwarded: { host: 'andere.example' } })
  try {
    const preflight = await httpsFetch(proxy.origin, '/api/auth/pair', { ca: serverCa(s.dataDir) })
    const seen = preflightOf(preflight.body)
    assert.equal(seen.origin, null)
    assert.equal(seen.certSha256, preflight.certSha256)
    const code = await newCode(s, cookie)
    const res = await httpsFetch(proxy.origin, '/api/auth/pair', { method: 'POST', body: pairBody(pairingProof(code, preflight.certSha256)), ca: serverCa(s.dataDir) })
    assert.equal(res.status, 200, res.body)
  } finally {
    await proxy.close()
    s.stop()
  }
})

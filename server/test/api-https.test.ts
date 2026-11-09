// HTTPS auf demselben Port am echten Server (#528, Schritt 2): Zertifikat aus dem Datenordner, `/healthz` nennt `tls`,
// über HTTPS gesetzte Sitzungen tragen `Secure`, und ohne beschreibbaren Ordner startet Mietfuchs nur mit HTTP.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { certSha256 } from '../src/tls.ts'
import {
  type HealthReport, TEST_PASSWORD, httpsFetch, rawRequest, setupCode, startServerIn, waitForExit,
} from '../testing/api.ts'

const freshDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-https-'))
const NETWORK = { NKA_HOST: '0.0.0.0' }

test('HTTPS: derselbe Port antwortet auf /healthz mit tls: true, das Zertifikat liegt im Datenordner', async () => {
  const s = await startServerIn(freshDir(), NETWORK)
  try {
    const res = await httpsFetch(s.base, '/healthz')
    assert.equal(res.status, 200, res.body)
    const report = JSON.parse(res.body) as HealthReport
    assert.equal(report.app, 'mietfuchs')
    assert.equal(report.tls, true)
    assert.equal(res.certSha256, certSha256(fs.readFileSync(path.join(s.dataDir, 'tls', 'mietfuchs.crt'), 'utf8')))
    // HTTP auf demselben Port wie bisher
    const plain = await rawRequest(s.base, { urlPath: '/healthz' })
    assert.equal(plain.status, 200)
    assert.equal((JSON.parse(plain.body) as HealthReport).tls, true)
    assert.equal(s.errorOutput().includes('HTTPS ist nicht verfügbar'), false, s.errorOutput())
  } finally {
    s.stop()
  }
})

test('HTTPS: eine über HTTPS angelegte Sitzung trägt Secure, über HTTP nicht', async () => {
  const s = await startServerIn(freshDir(), NETWORK)
  try {
    const body = JSON.stringify({ code: setupCode(s.dataDir), password: TEST_PASSWORD })
    const setup = await httpsFetch(s.base, '/api/auth/setup', { method: 'POST', body })
    assert.equal(setup.status, 200, setup.body)
    const cookie = String(setup.headers['set-cookie'] ?? '')
    assert.match(cookie, /^mietfuchs_[0-9a-f]{6}=/)
    assert.match(cookie, /; Secure/)
    // Mit dieser Sitzung über HTTPS weiter
    const session = cookie.split(';')[0]
    const auth = await httpsFetch(s.base, '/api/auth', { headers: { cookie: session } })
    assert.equal((JSON.parse(auth.body) as { signedIn: boolean }).signedIn, true)
    // Über HTTP derselbe Name, ohne Secure
    const login = await rawRequest(s.base, { method: 'POST', urlPath: '/api/auth/login', body: JSON.stringify({ password: TEST_PASSWORD }) })
    assert.equal(login.status, 200, login.body)
    const plainCookie = String(login.headers['set-cookie'] ?? '')
    assert.equal(plainCookie.split('=')[0], cookie.split('=')[0])
    assert.doesNotMatch(plainCookie, /Secure/)
  } finally {
    s.stop()
  }
})

test('HTTPS: das Zertifikat bleibt über einen Neustart dasselbe', async () => {
  const dataDir = freshDir()
  const first = await startServerIn(dataDir, NETWORK)
  let before: string
  try {
    before = (await httpsFetch(first.base, '/healthz')).certSha256
  } finally {
    first.child.kill()
    await waitForExit(first.child)
  }
  const second = await startServerIn(dataDir, NETWORK)
  try {
    assert.equal((await httpsFetch(second.base, '/healthz')).certSha256, before)
  } finally {
    second.stop()
  }
})

test('HTTPS: ohne beschreibbaren Ordner für tls/ startet Mietfuchs nur mit HTTP und sagt es', async () => {
  // An der Stelle des Ordners eine Datei: Das scheitert auf jedem System und auch als root
  const dataDir = freshDir()
  fs.writeFileSync(path.join(dataDir, 'tls'), 'keine Ablage')
  const s = await startServerIn(dataDir, NETWORK)
  try {
    const health = await rawRequest(s.base, { urlPath: '/healthz' })
    assert.equal(health.status, 200, health.body)
    assert.equal((JSON.parse(health.body) as HealthReport).tls, false)
    await assert.rejects(httpsFetch(s.base, '/healthz'))
    const lines = s.errorOutput().split('\n').filter((line) => line.startsWith('HTTPS ist nicht verfügbar'))
    assert.equal(lines.length, 1, s.errorOutput())
    assert.match(lines[0], /tls/)
  } finally {
    s.stop()
  }
})

test('HTTPS: lokal lauschend entsteht das Zertifikat ebenso', async () => {
  // Eine Regel statt zwei: auch ohne Netz, damit ein späteres Umschalten nichts Neues braucht
  const s = await startServerIn(freshDir())
  try {
    const res = await httpsFetch(s.base, '/healthz')
    assert.equal((JSON.parse(res.body) as HealthReport).tls, true)
  } finally {
    s.stop()
  }
})

// Programmfenster koppeln (#528, Schritt 2) gegen den echten Server: Code in der Oberfläche, Koppeln über HTTPS mit
// einem Beweis über das Zertifikat, Geräteschlüssel nur über HTTPS, Liste, Entfernen, Zurücksetzen und Ausschalten.
// Die Bausteine ohne Server (Beweis, Schlüssel, Datei) prüft access.test.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pairingProof } from '../src/access.ts'
import { TEST_PASSWORD, httpsFetch, jsonOf, rawRequest, signIn, startServerIn, waitForExit, type Server } from '../testing/api.ts'

const freshDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-kopplung-'))
const NETWORK = { NKA_HOST: '0.0.0.0' }
const post = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type Pairing = { code: string, expiresAt: string }
type Paired = { id: string, deviceKey: string, version: string }
type DeviceView = { id: string, name: string, pairedAt: string, lastSeen: string | null, current: boolean, keyHash?: string }

// Ein Server im Netz mit Passwort und Sitzung
async function serverWithPassword(env: NodeJS.ProcessEnv = {}, dataDir = freshDir()) {
  const s = await startServerIn(dataDir, { ...NETWORK, ...env })
  const { cookie } = await signIn(s)
  return { s, cookie }
}

async function newCode(s: Server, cookie: string): Promise<Pairing> {
  const res = await fetch(`${s.base}/api/auth/pairing`, post({}, { cookie }))
  assert.equal(res.status, 200, await res.clone().text())
  assert.equal(res.headers.get('cache-control'), 'no-store')
  return jsonOf<Pairing>(res)
}

const certOf = async (s: Server): Promise<string> => (await httpsFetch(s.base, '/healthz')).certSha256

// Wie das Fenster: Fingerabdruck lesen, Beweis rechnen, über HTTPS koppeln
async function pair(s: Server, code: string, { cert, name = 'Laptop im Büro' }: { cert?: string, name?: unknown } = {}) {
  const proof = pairingProof(code, cert ?? await certOf(s))
  return httpsFetch(s.base, '/api/auth/pair', { method: 'POST', body: JSON.stringify({ name, proof }) })
}

async function paired(s: Server, cookie: string, name?: string): Promise<Paired & { code: string }> {
  const { code } = await newCode(s, cookie)
  const res = await pair(s, code, { name })
  assert.equal(res.status, 200, res.body)
  assert.equal(res.headers['cache-control'], 'no-store')
  return { ...(JSON.parse(res.body) as Paired), code }
}

const deviceHeader = (p: Paired) => ({ 'x-mietfuchs-device': `${p.id}.${p.deviceKey}` })
const unitsViaHttps = async (s: Server, p: Paired) => (await httpsFetch(s.base, '/api/units', { headers: deviceHeader(p) })).status
const zugang = (s: Server) => JSON.parse(fs.readFileSync(path.join(s.dataDir, 'zugang.json'), 'utf8')) as { mode: string, devices?: DeviceView[] }

test('Kopplung: richtiger Beweis ergibt einen Schlüssel, der nur über HTTPS gilt', async () => {
  const { s, cookie } = await serverWithPassword()
  try {
    const before = await jsonOf<{ pairing: { available: boolean, devices: number } }>(await fetch(`${s.base}/api/auth`, { headers: { cookie } }))
    assert.deepEqual(before.pairing, { available: true, devices: 0 })
    const { code, expiresAt } = await newCode(s, cookie)
    assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    const minutes = (Date.parse(expiresAt) - Date.now()) / 60_000
    assert.ok(minutes > 9 && minutes <= 10, expiresAt)
    const cert = await certOf(s)
    const proof = pairingProof(code, cert)
    const res = await httpsFetch(s.base, '/api/auth/pair', { method: 'POST', body: JSON.stringify({ name: 'Laptop im Büro', proof }) })
    assert.equal(res.status, 200, res.body)
    const device = JSON.parse(res.body) as Paired
    assert.match(device.id, /^[0-9a-f]{16}$/)
    assert.match(device.deviceKey, /^[A-Za-z0-9_-]{43}$/)
    assert.match(device.version, /^\d+\.\d+\.\d+/)

    // Mit dem Schlüssel über HTTPS angemeldet, über HTTP nie, ohne Kopfzeile auch über HTTPS nicht
    assert.equal(await unitsViaHttps(s, device), 200)
    assert.equal((await rawRequest(s.base, { urlPath: '/api/units', headers: deviceHeader(device) })).status, 401)
    assert.equal((await httpsFetch(s.base, '/api/units')).status, 401)
    assert.equal((await httpsFetch(s.base, '/api/units', { headers: { 'x-mietfuchs-device': `${device.id}.${'A'.repeat(43)}` } })).status, 401)
    const auth = JSON.parse((await httpsFetch(s.base, '/api/auth', { headers: deviceHeader(device) })).body) as { signedIn: boolean }
    assert.equal(auth.signedIn, true)

    // Liste ohne keyHash, `current` für das anfragende Gerät, `lastSeen` gesetzt
    const own = JSON.parse((await httpsFetch(s.base, '/api/auth/devices', { headers: deviceHeader(device) })).body) as { devices: DeviceView[] }
    assert.equal(own.devices.length, 1)
    assert.equal(own.devices[0].id, device.id)
    assert.equal(own.devices[0].name, 'Laptop im Büro')
    assert.equal(own.devices[0].current, true)
    assert.equal('keyHash' in own.devices[0], false)
    assert.notEqual(own.devices[0].lastSeen, null)
    const fromBrowser = await jsonOf<{ devices: DeviceView[] }>(await fetch(`${s.base}/api/auth/devices`, { headers: { cookie } }))
    assert.equal(fromBrowser.devices[0].current, false)
    const after = await jsonOf<{ pairing: { available: boolean, devices: number } }>(await fetch(`${s.base}/api/auth`, { headers: { cookie } }))
    assert.deepEqual(after.pairing, { available: true, devices: 1 })

    // In zugang.json nur der Hash, nie der Schlüssel
    const stored = zugang(s)
    assert.equal(stored.devices?.length, 1)
    const text = fs.readFileSync(path.join(s.dataDir, 'zugang.json'), 'utf8')
    assert.equal(text.includes(device.deviceKey), false)
    assert.notEqual(stored.devices?.[0].lastSeen, null)

    // Kein Code, Schlüssel oder Beweis im Protokoll
    const plain = code.replaceAll('-', '')
    for (const secret of [code, plain, device.deviceKey, proof]) {
      assert.equal(s.output().includes(secret), false, 'stdout')
      assert.equal(s.errorOutput().includes(secret), false, 'stderr')
    }
  } finally {
    s.stop()
  }
})

test('Kopplung: Beweis für ein anderes Zertifikat, ein zweites Mal und nach dem Verwerfen 400', async () => {
  const { s, cookie } = await serverWithPassword()
  try {
    const { code } = await newCode(s, cookie)
    const wrong = await pair(s, code, { cert: 'c'.repeat(64) })
    assert.equal(wrong.status, 400)
    assert.equal(JSON.parse(wrong.body).error, 'Der Code stimmt nicht oder ist abgelaufen.')
    const unknown = await httpsFetch(s.base, '/api/auth/pair', { method: 'POST', body: JSON.stringify({ name: 'x', proof: 'kein Beweis' }) })
    assert.equal(unknown.status, 400)
    // Ein Fehlversuch verbraucht den Code nicht, der richtige gilt einmal
    assert.equal((await pair(s, code)).status, 200)
    const again = await pair(s, code)
    assert.equal(again.status, 400)
    assert.equal(JSON.parse(again.body).error, 'Der Code stimmt nicht oder ist abgelaufen.')
    // Verworfen gilt er nicht mehr; ein neuer ersetzt den alten
    const first = await newCode(s, cookie)
    const second = await newCode(s, cookie)
    assert.equal((await pair(s, first.code)).status, 400)
    assert.equal((await fetch(`${s.base}/api/auth/pairing`, { method: 'DELETE', headers: { cookie } })).status, 200)
    assert.equal((await pair(s, second.code)).status, 400)
    // Der fehlgeschlagene Versuch steht im Protokoll, der Beweis nicht
    assert.match(s.output(), /Kopplungscode/)
    assert.equal(s.output().includes(pairingProof(code, 'c'.repeat(64))), false)
  } finally {
    s.stop()
  }
})

test('Kopplung: nur über eine verschlüsselte Verbindung', async () => {
  const { s, cookie } = await serverWithPassword()
  try {
    const { code } = await newCode(s, cookie)
    const proof = pairingProof(code, await certOf(s))
    const res = await rawRequest(s.base, { method: 'POST', urlPath: '/api/auth/pair', body: JSON.stringify({ name: 'x', proof }) })
    assert.equal(res.status, 400)
    assert.equal(JSON.parse(res.body).error, 'Koppeln geht nur über eine verschlüsselte Verbindung.')
    // Der Code gilt danach weiter
    assert.equal((await pair(s, code)).status, 200)
  } finally {
    s.stop()
  }
})

test('Kopplung: zwei gleichzeitige Versuche mit demselben Code ergeben genau ein Gerät', async () => {
  const { s, cookie } = await serverWithPassword()
  try {
    const { code } = await newCode(s, cookie)
    const cert = await certOf(s)
    const results = await Promise.all([pair(s, code, { cert }), pair(s, code, { cert })])
    assert.equal(results.filter((r) => r.status === 200).length, 1, results.map((r) => `${r.status} ${r.body}`).join(' | '))
    assert.equal(zugang(s).devices?.length, 1)
  } finally {
    s.stop()
  }
})

test('Kopplung: ein abgelaufener Code gilt nicht (Testgriff NKA_TEST_PAIRING_SECONDS)', async () => {
  const { s, cookie } = await serverWithPassword({ NKA_TEST_PAIRING_SECONDS: '1' })
  try {
    const { code, expiresAt } = await newCode(s, cookie)
    assert.ok(Date.parse(expiresAt) - Date.now() <= 1000)
    await sleep(1300)
    const res = await pair(s, code)
    assert.equal(res.status, 400)
    assert.equal(JSON.parse(res.body).error, 'Der Code stimmt nicht oder ist abgelaufen.')
  } finally {
    s.stop()
  }
})

test('Kopplung: ohne Passwort gibt es keinen Code', async () => {
  // Lokal ohne Datei: nichts entschieden, kein Passwort
  const s = await startServerIn(freshDir())
  try {
    const res = await fetch(`${s.base}/api/auth/pairing`, post({}))
    assert.equal(res.status, 409)
    assert.equal((await jsonOf<{ error: string }>(res)).error, 'Legen Sie zuerst ein Passwort fest.')
    const auth = await jsonOf<{ pairing: { available: boolean } }>(await fetch(`${s.base}/api/auth`))
    assert.equal(auth.pairing.available, false)
    const tried = await httpsFetch(s.base, '/api/auth/pair', { method: 'POST', body: JSON.stringify({ name: 'x', proof: '0'.repeat(64) }) })
    assert.equal(tried.status, 409)
  } finally {
    s.stop()
  }
})

test('Kopplung: ein entferntes Gerät ist abgemeldet, die übrigen bleiben', async () => {
  const { s, cookie } = await serverWithPassword()
  try {
    const a = await paired(s, cookie, 'Erstes')
    const b = await paired(s, cookie, 'Zweites')
    assert.equal(await unitsViaHttps(s, a), 200)
    assert.equal((await fetch(`${s.base}/api/auth/devices/${a.id}`, { method: 'DELETE', headers: { cookie } })).status, 200)
    assert.equal(await unitsViaHttps(s, a), 401)
    assert.equal(await unitsViaHttps(s, b), 200)
    assert.equal((await fetch(`${s.base}/api/auth/devices/${a.id}`, { method: 'DELETE', headers: { cookie } })).status, 404)
    assert.deepEqual(zugang(s).devices?.map((d) => d.name), ['Zweites'])
    // Ohne Anmeldung weder Liste noch Entfernen
    assert.equal((await httpsFetch(s.base, '/api/auth/devices')).status, 401)
    assert.equal((await httpsFetch(s.base, `/api/auth/devices/${b.id}`, { method: 'DELETE' })).status, 401)
  } finally {
    s.stop()
  }
})

test('Kopplung: Name 1 bis 60 Zeichen, sonst „Programmfenster“; höchstens 20 Geräte', async () => {
  const { s, cookie } = await serverWithPassword()
  try {
    await paired(s, cookie, '')
    const { code } = await newCode(s, cookie)
    assert.equal((await pair(s, code, { name: 'x'.repeat(61) })).status, 200)
    const { code: third } = await newCode(s, cookie)
    assert.equal((await pair(s, third, { name: 42 })).status, 200)
    assert.deepEqual(zugang(s).devices?.map((d) => d.name), ['Programmfenster', 'Programmfenster', 'Programmfenster'])
    for (let i = 3; i < 20; i++) await paired(s, cookie, `Gerät ${i}`)
    const { code: last } = await newCode(s, cookie)
    const full = await pair(s, last)
    assert.equal(full.status, 409, full.body)
    assert.equal(zugang(s).devices?.length, 20)
  } finally {
    s.stop()
  }
})

test('Kopplung: Zurücksetzen über die Datei entfernt alle Geräte', async () => {
  const { s, cookie } = await serverWithPassword()
  try {
    const device = await paired(s, cookie)
    fs.writeFileSync(path.join(s.dataDir, 'passwort-zuruecksetzen'), '')
    // GET /api/auth prüft ohne Drossel
    assert.equal((await jsonOf<{ mode: string }>(await fetch(`${s.base}/api/auth`))).mode, 'setup')
    assert.equal(await unitsViaHttps(s, device), 401)
    assert.equal(zugang(s).devices, undefined)
  } finally {
    s.stop()
  }
})

test('Kopplung: Ausschalten der Anmeldung entfernt alle Geräte', async () => {
  const { s, cookie } = await serverWithPassword()
  try {
    const device = await paired(s, cookie)
    const off = await fetch(`${s.base}/api/auth/off`, post({ current: TEST_PASSWORD }, { cookie }))
    assert.equal(off.status, 200, await off.text())
    assert.equal(zugang(s).mode, 'off')
    assert.equal(zugang(s).devices, undefined)
    const auth = await jsonOf<{ pairing: { available: boolean, devices: number } }>(await fetch(`${s.base}/api/auth`))
    assert.deepEqual(auth.pairing, { available: false, devices: 0 })
    // Der Schlüssel öffnet nichts mehr, auch nicht nach erneutem Einschalten mit Passwort
    const code = fs.readFileSync(path.join(s.dataDir, 'einrichtungscode.txt'), 'utf8').trim()
    const setup = await fetch(`${s.base}/api/auth/setup`, post({ code, password: TEST_PASSWORD }))
    assert.equal(setup.status, 200)
    assert.equal(await unitsViaHttps(s, device), 401)
  } finally {
    s.stop()
  }
})

test('Kopplung: Passwort ändern und überall abmelden lassen die Geräte stehen, auch über einen Neustart', async () => {
  const dataDir = freshDir()
  const { s, cookie } = await serverWithPassword({}, dataDir)
  let device: Paired
  try {
    device = await paired(s, cookie)
    const changed = await fetch(`${s.base}/api/auth/password`, { ...post({ current: TEST_PASSWORD, password: 'ein anderes langes Passwort' }, { cookie }), method: 'PUT' })
    assert.equal(changed.status, 200, await changed.clone().text())
    const renewed = String(changed.headers.get('set-cookie')).split(';')[0]
    assert.equal(zugang(s).devices?.length, 1)
    assert.equal(await unitsViaHttps(s, device), 200)
    const all = await fetch(`${s.base}/api/auth/logout-all`, post({ current: 'ein anderes langes Passwort' }, { cookie: renewed }))
    assert.equal(all.status, 200)
    assert.equal(await unitsViaHttps(s, device), 200)
  } finally {
    s.child.kill()
    await waitForExit(s.child)
  }
  const again = await startServerIn(dataDir, NETWORK)
  try {
    assert.equal(await unitsViaHttps(again, device), 200)
  } finally {
    again.stop()
  }
})

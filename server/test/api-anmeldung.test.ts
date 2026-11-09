// Anmeldung (#528, Schritt 1) gegen den echten Server: Vorschaltung, Routen unter /api/auth, Bremse, Origin und der
// Übergang der Stufe A. Die Entscheidungen ohne Server prüft access.test.ts. Server im Netz lauschen hier auf 0.0.0.0
// und werden über 127.0.0.1 gefragt; wo die Adresse einer Netzwerkkarte gebraucht wird, ist der Test ohne Karte
// übersprungen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { openFreshDatabase } from '../testing/freshDatabase.ts'
import { createProperty } from '../src/db/repository.ts'
import {
  TEST_PASSWORD, jsonOf, rawRequest, sessionOf, setupCode, signIn, startServerIn, startServerRaw, waitForExit,
} from '../testing/api.ts'

const freshDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-anmeldung-'))
const NETWORK = { NKA_HOST: '0.0.0.0' }
const lanAddress = (): string | null =>
  Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address ?? null
const viaLan = (base: string): string | null => {
  const lan = lanAddress()
  return lan ? `http://${lan}:${new URL(base).port}` : null
}
const post = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
type AuthInfo = { mode: string, required: boolean, signedIn: boolean, reachable: string, envFixed: boolean, codeFile?: string, codeFileName?: string, minLength: number }
const authOf = async (base: string, headers: Record<string, string> = {}): Promise<AuthInfo> => jsonOf<AuthInfo>(await fetch(`${base}/api/auth`, { headers }))

// Ein Ordner mit Bestand, wie ihn eine frühere Fassung hinterlässt
async function stockDir(): Promise<string> {
  const dir = freshDir()
  const opened = await openFreshDatabase(dir)
  await createProperty(opened.db, 'haus-am-see', { name: 'Haus am See' })
  opened.close()
  return dir
}

test('Anmeldung: neuer Datenordner im Netz startet in der Einrichtung, mit Code in Datei und Protokoll', async () => {
  const s = await startServerIn(freshDir(), NETWORK)
  try {
    const auth = await authOf(s.base)
    assert.equal(auth.mode, 'setup')
    assert.equal(auth.required, true)
    assert.equal(auth.signedIn, false)
    assert.equal(auth.reachable, 'network')
    assert.equal(auth.minLength, 15)
    assert.equal(auth.codeFile, path.join(s.dataDir, 'einrichtungscode.txt'))
    const code = setupCode(s.dataDir)
    assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(path.join(s.dataDir, 'einrichtungscode.txt')).mode & 0o777, 0o600)
      assert.equal(fs.statSync(path.join(s.dataDir, 'zugang.json')).mode & 0o777, 0o600)
    }
    await waitFor(() => s.output().includes('Einrichtungscode:'))
    await waitFor(() => /Mietfuchs ist im Netz erreichbar und noch ohne Passwort\./.test(s.output()))
    assert.ok(s.output().includes(`Einrichtungscode: ${code}  (auch in ${path.join(s.dataDir, 'einrichtungscode.txt')})`), s.output())
    const zugang = JSON.parse(fs.readFileSync(path.join(s.dataDir, 'zugang.json'), 'utf8'))
    assert.equal(zugang.mode, 'setup')
    assert.equal(zugang.hash, undefined)
  } finally {
    s.stop()
  }
})

test('Anmeldung: ohne Sitzung 401 in jeder Schreibweise, Oberfläche frei', async () => {
  const s = await startServerIn(freshDir(), NETWORK)
  try {
    for (const urlPath of ['/api/units', '/API/units', '/api/Units', '/API/backup', '/api/backup/', '/uploads/x.pdf', '/UPLOADS/x.pdf', '/Uploads/x.pdf',
      '/api/update', '/api/auth/../units', '/api/%61uth/x', '//api/units', '/api/settings', '/api/relocation']) {
      const res = await rawRequest(s.base, { urlPath })
      assert.equal(res.status, 401, urlPath)
      assert.deepEqual(JSON.parse(res.body), { error: 'Bitte legen Sie zuerst ein Passwort für Mietfuchs fest.', setup: true }, urlPath)
      assert.equal(res.headers['cache-control'], 'no-store', urlPath)
    }
    assert.equal((await rawRequest(s.base, { method: 'HEAD', urlPath: '/api/backup' })).status, 401)
    for (const [method, urlPath] of [['POST', '/api/units'], ['DELETE', '/api/units/x'], ['PUT', '/api/settings'], ['POST', '/api/restore']]) {
      assert.equal((await rawRequest(s.base, { method, urlPath, body: '{}' })).status, 401, `${method} ${urlPath}`)
    }
    // Die Oberfläche selbst enthält keine Daten: ohne gebautes Frontend 404 wie bisher, nie 401
    const ui = await rawRequest(s.base, { urlPath: '/' })
    assert.notEqual(ui.status, 401)
    assert.equal((await rawRequest(s.base, { urlPath: '/einstellungen' })).status === 401, false)
  } finally {
    s.stop()
  }
})

test('Anmeldung: /healthz vom Rechner selbst voll, über die Netzwerkkarte gekürzt', async (t) => {
  const s = await startServerIn(freshDir(), NETWORK)
  try {
    const here = await jsonOf<{ app: string, status: string, version?: string, dataDir?: string }>(await fetch(`${s.base}/healthz`))
    assert.equal(here.status, 'ok')
    assert.equal(here.dataDir, s.dataDir)
    // ein Proxy auf demselben Rechner bekommt den vollen Bericht (hingenommen)
    const proxied = JSON.parse((await rawRequest(s.base, { urlPath: '/healthz', headers: { 'x-forwarded-for': '192.168.1.9' } })).body)
    assert.equal(proxied.dataDir, s.dataDir)
    const lan = viaLan(s.base)
    if (!lan) return t.skip('keine Netzwerkkarte')
    for (const urlPath of ['/healthz', '/HEALTHZ', '/healthz/', '/Healthz?x=1']) {
      const res = await rawRequest(lan, { urlPath })
      assert.equal(res.status, 200, urlPath)
      assert.deepEqual(JSON.parse(res.body), { app: 'mietfuchs', status: 'ok' }, urlPath)
    }
  } finally {
    s.stop()
  }
})

test('Anmeldung: Beenden vom Rechner selbst ohne Sitzung, über Proxy oder Netzwerkkarte nicht', async (t) => {
  const first = await startServerIn(freshDir(), { ...NETWORK, NKA_RUNTIME: 'binary' })
  try {
    assert.equal((await rawRequest(first.base, { method: 'POST', urlPath: '/api/quit', headers: { 'x-forwarded-for': '1.2.3.4' }, body: '{}' })).status, 401)
    const lan = viaLan(first.base)
    if (lan) assert.equal((await rawRequest(lan, { method: 'POST', urlPath: '/api/quit', body: '{}' })).status, 401)
    else t.diagnostic('keine Netzwerkkarte, Beenden von außen nicht geprüft')
    const res = await fetch(`${first.base}/api/quit`, { method: 'POST' })
    assert.equal(res.status, 200)
    assert.equal(await waitForExit(first.child), 0)
  } finally {
    first.stop()
  }
})

test('Anmeldung: Einrichtung mit Code, Cookie, danach Daten; derselbe Code ein zweites Mal geht nicht', async () => {
  const s = await startServerIn(freshDir(), NETWORK)
  try {
    const wrong = await fetch(`${s.base}/api/auth/setup`, post({ code: 'AAAA-AAAA-AAAA', password: TEST_PASSWORD }))
    assert.equal(wrong.status, 400)
    assert.deepEqual(await wrong.json(), { error: 'Der Code stimmt nicht.' })
    const none = await fetch(`${s.base}/api/auth/setup`, post({ password: TEST_PASSWORD }))
    assert.equal(none.status, 403)
    const code = setupCode(s.dataDir)
    const short = await fetch(`${s.base}/api/auth/setup`, post({ code, password: 'zu kurz' }))
    assert.equal(short.status, 400)
    assert.match((await jsonOf<{ error: string }>(short)).error, /mindestens 15 Zeichen/)
    // klein geschrieben und ohne Bindestriche zählt derselbe Code
    const ok = await fetch(`${s.base}/api/auth/setup`, post({ code: code.toLowerCase().replaceAll('-', ' '), password: TEST_PASSWORD }))
    assert.equal(ok.status, 200)
    assert.deepEqual(await ok.json(), { ok: true, mode: 'password' })
    const setCookie = ok.headers.get('set-cookie') ?? ''
    assert.match(setCookie, /^mietfuchs_[0-9a-f]{6}=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict$/)
    const cookie = sessionOf(ok)
    assert.equal((await fetch(`${s.base}/api/units`, { headers: { cookie } })).status, 200)
    assert.equal((await fetch(`${s.base}/api/units`)).status, 401)
    assert.equal(fs.existsSync(path.join(s.dataDir, 'einrichtungscode.txt')), false)
    const zugang = JSON.parse(fs.readFileSync(path.join(s.dataDir, 'zugang.json'), 'utf8'))
    assert.equal(zugang.mode, 'password')
    assert.match(zugang.hash, /^scrypt\$17\$8\$1\$/)
    const again = await fetch(`${s.base}/api/auth/setup`, post({ code, password: 'ein anderes langes Passwort' }))
    assert.equal(again.status, 409)
    const auth = await authOf(s.base, { cookie })
    assert.equal(auth.mode, 'password')
    assert.equal(auth.signedIn, true)
    assert.equal(auth.codeFile, undefined)
  } finally {
    s.stop()
  }
})

test('Anmeldung: Secure nur hinter HTTPS', async () => {
  const s = await startServerIn(freshDir(), NETWORK)
  try {
    const res = await fetch(`${s.base}/api/auth/setup`, post({ code: setupCode(s.dataDir), password: TEST_PASSWORD }, { 'x-forwarded-proto': 'https' }))
    assert.equal(res.status, 200)
    assert.match(res.headers.get('set-cookie') ?? '', /; Secure$/)
  } finally {
    s.stop()
  }
})

test('Anmeldung: anmelden, abmelden, jede Anmeldung mit neuer Kennung', async () => {
  const s = await startServerIn(freshDir(), NETWORK)
  try {
    const { cookie: first } = await signIn(s)
    const wrong = await fetch(`${s.base}/api/auth/login`, post({ password: 'ein falsches langes Passwort' }))
    assert.equal(wrong.status, 401)
    assert.deepEqual(await wrong.json(), { error: 'Das Passwort stimmt nicht.' })
    const ok = await fetch(`${s.base}/api/auth/login`, post({ password: TEST_PASSWORD }))
    assert.equal(ok.status, 200)
    assert.deepEqual(await ok.json(), { ok: true, failedAttempts: 1 })
    const second = sessionOf(ok)
    assert.notEqual(second, first)
    assert.equal((await fetch(`${s.base}/api/units`, { headers: { cookie: first } })).status, 200)
    const out = await fetch(`${s.base}/api/auth/logout`, { method: 'POST', headers: { cookie: second } })
    assert.equal(out.status, 200)
    assert.match(out.headers.get('set-cookie') ?? '', /Max-Age=0/)
    assert.equal((await fetch(`${s.base}/api/units`, { headers: { cookie: second } })).status, 401)
    assert.equal((await fetch(`${s.base}/api/units`, { headers: { cookie: first } })).status, 200)
    // ein gefälschtes Cookie gleichen Namens neben dem echten stört nicht, allein öffnet es nichts
    const name = first.split('=')[0]
    assert.equal((await fetch(`${s.base}/api/units`, { headers: { cookie: `${name}=gefaelscht; ${first}` } })).status, 200)
    assert.equal((await fetch(`${s.base}/api/units`, { headers: { cookie: `${name}=gefaelscht` } })).status, 401)
    await waitFor(() => /falsches Passwort von 127\.0\.0\.1/.test(s.output()))
  } finally {
    s.stop()
  }
})

test('Anmeldung: die Bremse über die Route, auch für das Ändern des Passworts', async () => {
  const s = await startServerIn(freshDir(), NETWORK)
  try {
    const { cookie } = await signIn(s)
    for (let i = 0; i < 4; i++) assert.equal((await fetch(`${s.base}/api/auth/login`, post({ password: `falsch falsch falsch ${i}` }))).status, 401)
    const braked = await fetch(`${s.base}/api/auth/login`, post({ password: 'falsch falsch falsch 5' }))
    assert.equal(braked.status, 429)
    assert.equal(braked.headers.get('retry-after'), '1')
    assert.match((await jsonOf<{ error: string }>(braked)).error, /Zu viele Fehlversuche\. Bitte versuchen Sie es in einer Sekunde erneut\./)
    // auch das richtige Passwort wartet
    assert.equal((await fetch(`${s.base}/api/auth/login`, post({ password: TEST_PASSWORD }))).status, 429)
    // falsches bisheriges Passwort beim Ändern zählt mit
    const change = await fetch(`${s.base}/api/auth/password`, { ...post({ current: 'falsch falsch falsch', password: 'ein neues langes Passwort' }, { cookie }), method: 'PUT' })
    assert.equal(change.status, 429)
    await new Promise((resolve) => setTimeout(resolve, 1100))
    assert.equal((await fetch(`${s.base}/api/auth/login`, post({ password: TEST_PASSWORD }))).status, 200)
  } finally {
    s.stop()
  }
})

test('Anmeldung: 50 gleichzeitige Versuche ergeben höchstens zwei Berechnungen', async () => {
  const s = await startServerIn(freshDir(), NETWORK)
  try {
    await signIn(s)
    const started = Date.now()
    const results = await Promise.all(Array.from({ length: 50 }, (_, i) => fetch(`${s.base}/api/auth/login`, post({ password: `gleichzeitig falsch ${i}` })).then((r) => r.status)))
    const computed = results.filter((status) => status !== 429)
    assert.ok(computed.length >= 1 && computed.length <= 2, JSON.stringify(results))
    assert.ok(Date.now() - started < 5000, 'die abgewiesenen bekommen sofort 429')
  } finally {
    s.stop()
  }
})

test('Anmeldung: ein Angreifer von einer Adresse verzögert die Anmeldung einer anderen nur', async (t) => {
  const s = await startServerIn(freshDir(), NETWORK)
  try {
    await signIn(s)
    const lan = viaLan(s.base)
    if (!lan) return t.skip('keine Netzwerkkarte')
    for (let i = 0; i < 6; i++) await fetch(`${s.base}/api/auth/login`, post({ password: `angriff angriff ${i}` }))
    const started = Date.now()
    let status = 0
    while (Date.now() - started < 5000) {
      status = (await rawRequest(lan, { method: 'POST', urlPath: '/api/auth/login', body: JSON.stringify({ password: TEST_PASSWORD }) })).status
      if (status === 200) break
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    assert.equal(status, 200)
  } finally {
    s.stop()
  }
})

test('Anmeldung: Origin bei Schreibzugriffen, auch in Docker ohne Host-Prüfung', async () => {
  for (const runtime of ['', 'docker']) {
    const s = await startServerIn(freshDir(), { ...NETWORK, NKA_RUNTIME: runtime })
    try {
      const { cookie } = await signIn(s)
      const port = new URL(s.base).port
      const write = (headers: Record<string, string>, urlPath = '/api/units') =>
        rawRequest(s.base, { method: 'POST', urlPath, headers: { cookie, host: `127.0.0.1:${port}`, ...headers }, body: JSON.stringify({ name: 'Wohnung 1' }) }).then((r) => r.status)
      assert.equal(await write({ origin: 'http://evil.example' }), 403, runtime)
      assert.equal(await write({ 'sec-fetch-site': 'same-site' }), 403, runtime)
      assert.equal(await write({ 'sec-fetch-site': 'cross-site', origin: `http://127.0.0.1:${port}` }), 403, runtime)
      assert.equal(await write({ origin: 'null' }), 403, runtime)
      assert.equal(await write({ origin: `http://127.0.0.1:${port}` }), 201, runtime)
      assert.equal(await write({}), 201, runtime)
      if (runtime === 'docker') {
        // Proxy mit umgeschriebenem Host, ohne X-Forwarded-Host: Sec-Fetch-Site entscheidet
        assert.equal(await write({ host: 'mietfuchs:3001', origin: 'https://mietfuchs.example.org', 'sec-fetch-site': 'same-origin' }), 201)
        assert.equal(await write({ host: 'mietfuchs:3001', origin: 'https://mietfuchs.example.org', 'x-forwarded-host': 'mietfuchs.example.org' }), 201)
        assert.equal(await write({ host: 'mietfuchs:3001', origin: 'https://mietfuchs.example.org' }), 403)
      }
      // die Anmeldung selbst
      assert.equal((await rawRequest(s.base, { method: 'POST', urlPath: '/api/auth/login', headers: { origin: 'http://evil.example' }, body: JSON.stringify({ password: TEST_PASSWORD }) })).status, 403, runtime)
      assert.equal((await rawRequest(s.base, { method: 'POST', urlPath: '/api/auth/login', headers: { 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ password: TEST_PASSWORD }) })).status, 200, runtime)
    } finally {
      s.stop()
    }
  }
})

test('Anmeldung: Passwort ändern meldet alle anderen Geräte ab, die eigene Sitzung wird erneuert', async () => {
  const s = await startServerIn(freshDir(), NETWORK)
  try {
    const { cookie: other } = await signIn(s)
    const own = sessionOf(await fetch(`${s.base}/api/auth/login`, post({ password: TEST_PASSWORD })))
    const put = (body: unknown) => fetch(`${s.base}/api/auth/password`, { ...post(body, { cookie: own }), method: 'PUT' })
    assert.equal((await put({ password: 'ein neues langes Passwort' })).status, 400)
    assert.equal((await put({ current: 'falsch falsch falsch', password: 'ein neues langes Passwort' })).status, 403)
    assert.equal((await put({ current: TEST_PASSWORD, password: 'kurz' })).status, 400)
    const ok = await put({ current: TEST_PASSWORD, password: 'ein neues langes Passwort' })
    assert.equal(ok.status, 200)
    const renewed = sessionOf(ok)
    assert.notEqual(renewed, own)
    assert.equal((await fetch(`${s.base}/api/units`, { headers: { cookie: other } })).status, 401)
    assert.equal((await fetch(`${s.base}/api/units`, { headers: { cookie: own } })).status, 401)
    assert.equal((await fetch(`${s.base}/api/units`, { headers: { cookie: renewed } })).status, 200)
    assert.equal((await fetch(`${s.base}/api/auth/login`, post({ password: 'ein neues langes Passwort' }))).status, 200)
    // ohne Sitzung gar nicht
    assert.equal((await fetch(`${s.base}/api/auth/password`, { ...post({ current: 'ein neues langes Passwort', password: 'noch ein neues Passwort' }), method: 'PUT' })).status, 401)
  } finally {
    s.stop()
  }
})

test('Anmeldung: auf allen Geräten abmelden außer diesem', async () => {
  const s = await startServerIn(freshDir(), NETWORK)
  try {
    const { cookie: other } = await signIn(s)
    const own = sessionOf(await fetch(`${s.base}/api/auth/login`, post({ password: TEST_PASSWORD })))
    assert.equal((await fetch(`${s.base}/api/auth/logout-all`, post({ current: 'falsch falsch falsch' }, { cookie: own }))).status, 403)
    assert.equal((await fetch(`${s.base}/api/auth/logout-all`, post({ current: TEST_PASSWORD }, { cookie: own }))).status, 200)
    assert.equal((await fetch(`${s.base}/api/units`, { headers: { cookie: other } })).status, 401)
    assert.equal((await fetch(`${s.base}/api/units`, { headers: { cookie: own } })).status, 200)
  } finally {
    s.stop()
  }
})

test('Anmeldung: ausschalten, dann offen; zurück nur mit dem neuen Code', async () => {
  const s = await startServerIn(freshDir(), NETWORK)
  try {
    const { cookie } = await signIn(s)
    assert.equal((await fetch(`${s.base}/api/auth/off`, post({}, { cookie }))).status, 400)
    const off = await fetch(`${s.base}/api/auth/off`, post({ current: TEST_PASSWORD }, { cookie }))
    assert.equal(off.status, 200)
    assert.deepEqual(await off.json(), { ok: true, mode: 'off' })
    assert.equal((await fetch(`${s.base}/api/units`)).status, 200)
    const auth = await authOf(s.base)
    assert.equal(auth.mode, 'off')
    assert.equal(auth.required, false)
    // niemand im Netz setzt ohne Code ein Passwort und sperrt den Vermieter aus
    assert.equal((await fetch(`${s.base}/api/auth/setup`, post({ password: 'ein fremdes langes Passwort' }))).status, 403)
    assert.equal((await fetch(`${s.base}/api/auth/setup`, post({ code: 'AAAA-AAAA-AAAA', password: 'ein fremdes langes Passwort' }))).status, 400)
    const back = await fetch(`${s.base}/api/auth/setup`, post({ code: setupCode(s.dataDir), password: TEST_PASSWORD }))
    assert.equal(back.status, 200)
    assert.equal((await fetch(`${s.base}/api/units`)).status, 401)
  } finally {
    s.stop()
  }
})

test('Anmeldung: Einrichtung ohne Passwort mit Code, danach offen mit neuem Code', async () => {
  const s = await startServerIn(freshDir(), NETWORK)
  try {
    const code = setupCode(s.dataDir)
    const res = await fetch(`${s.base}/api/auth/setup`, post({ code, withoutPassword: true }))
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { ok: true, mode: 'off' })
    assert.equal((await fetch(`${s.base}/api/units`)).status, 200)
    assert.notEqual(setupCode(s.dataDir), code)
    assert.equal(JSON.parse(fs.readFileSync(path.join(s.dataDir, 'zugang.json'), 'utf8')).mode, 'off')
  } finally {
    s.stop()
  }
})

test('Anmeldung: bestehender Bestand im Netz ist im Übergang, offen, nichts geschrieben außer dem Code', async () => {
  const dir = await stockDir()
  const s = await startServerIn(dir, NETWORK)
  try {
    const auth = await authOf(s.base)
    assert.equal(auth.mode, 'transition')
    assert.equal(auth.required, false)
    const units = await fetch(`${s.base}/api/properties`)
    assert.equal(units.status, 200)
    assert.equal(fs.existsSync(path.join(dir, 'zugang.json')), false)
    assert.ok(fs.existsSync(path.join(dir, 'einrichtungscode.txt')))
    await waitFor(() => /Ab Version 1\.0 verlangt Mietfuchs hier ein Passwort\./.test(s.output()))
    assert.equal((await fetch(`${s.base}/api/auth/setup`, post({ password: TEST_PASSWORD }))).status, 403)
    // eine fremde Seite, die der Browser als solche ausweist, schreibt auch im Übergang nicht
    assert.equal((await rawRequest(s.base, { method: 'POST', urlPath: '/api/units', headers: { 'sec-fetch-site': 'cross-site' }, body: '{}' })).status, 403)
    // mit Code eingerichtet gilt die Anmeldung ab sofort
    await signIn(s)
    assert.equal((await fetch(`${s.base}/api/properties`)).status, 401)
  } finally {
    s.stop()
  }
})

test('Anmeldung: lokal nichts nötig und keine Datei; mit Passwort und Proxy-Kopfzeilen doch', async () => {
  const dir = freshDir()
  const s = await startServerIn(dir)
  try {
    const auth = await authOf(s.base)
    assert.equal(auth.mode, 'none')
    assert.equal(auth.required, false)
    assert.equal(auth.reachable, 'local')
    assert.equal(fs.existsSync(path.join(dir, 'zugang.json')), false)
    assert.equal(fs.existsSync(path.join(dir, 'einrichtungscode.txt')), false)
  } finally {
    s.child.kill()
    await waitForExit(s.child).catch(() => null)
  }
  // Eine Einrichtung von früher (Netz), jetzt lokal hinter einem Proxy: nicht ausgesperrt
  fs.writeFileSync(path.join(dir, 'zugang.json'), JSON.stringify({ version: 1, mode: 'setup', instance: 'abcdef', changedAt: '' }))
  const setup = await startServerIn(dir)
  try {
    assert.equal((await rawRequest(setup.base, { urlPath: '/api/units', headers: { 'x-forwarded-for': '192.168.1.9' } })).status, 200)
  } finally {
    setup.child.kill()
    await waitForExit(setup.child).catch(() => null)
  }
  // Ein Passwort von früher (Netz), jetzt lokal hinter einem Proxy
  fs.writeFileSync(path.join(dir, 'zugang.json'), JSON.stringify({ version: 1, mode: 'password', instance: 'abcdef', hash: 'scrypt$10$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', changedAt: '' }))
  const again = await startServerIn(dir)
  try {
    assert.equal((await fetch(`${again.base}/api/units`)).status, 200)
    assert.equal((await rawRequest(again.base, { urlPath: '/api/units', headers: { 'x-forwarded-for': '192.168.1.9' } })).status, 401)
    assert.equal((await authOf(again.base, { 'x-forwarded-for': '192.168.1.9' })).required, true)
  } finally {
    again.stop()
  }
})

test('Anmeldung: NKA_AUTH off, on und ein ungültiger Wert', async () => {
  const off = await startServerIn(freshDir(), { ...NETWORK, NKA_AUTH: 'off' })
  try {
    const auth = await authOf(off.base)
    assert.equal(auth.required, false)
    assert.equal(auth.envFixed, true)
    assert.equal((await fetch(`${off.base}/api/units`)).status, 200)
    assert.equal(fs.existsSync(path.join(off.dataDir, 'zugang.json')), false)
    await waitFor(() => /NKA_AUTH=off abgeschaltet/.test(off.output()))
  } finally {
    off.stop()
  }
  const on = await startServerIn(freshDir(), { NKA_AUTH: 'on' })
  try {
    const auth = await authOf(on.base)
    assert.equal(auth.mode, 'setup')
    assert.equal(auth.required, true)
    assert.equal(auth.reachable, 'local')
    assert.equal((await fetch(`${on.base}/api/units`)).status, 401)
  } finally {
    on.stop()
  }
  const dir = freshDir()
  const bad = startServerRaw(dir, { NKA_PORT: '0', NKA_AUTH: 'ja' })
  try {
    assert.equal(await waitForExit(bad.child), 1)
    assert.match(bad.out(), /NKA_AUTH „ja“ ist kein gültiger Wert/)
  } finally {
    bad.child.kill()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Anmeldung: NKA_AUTH=on schützt auch einen bestehenden Bestand sofort', async () => {
  const dir = await stockDir()
  const s = await startServerIn(dir, { NKA_AUTH: 'on' })
  try {
    assert.equal((await authOf(s.base)).mode, 'setup')
    assert.equal((await fetch(`${s.base}/api/properties`)).status, 401)
  } finally {
    s.stop()
  }
})

test('Anmeldung: ein Hash mit älteren Parametern wird bei der Anmeldung neu gerechnet', async () => {
  const dir = freshDir()
  const { hashPassword } = await import('../src/access.ts')
  fs.writeFileSync(path.join(dir, 'zugang.json'), JSON.stringify({ version: 1, mode: 'password', instance: 'abcdef', hash: await hashPassword(TEST_PASSWORD, { logN: 12 }), changedAt: '' }))
  const s = await startServerIn(dir, NETWORK)
  try {
    assert.equal((await fetch(`${s.base}/api/auth/login`, post({ password: TEST_PASSWORD }))).status, 200)
    const zugang = JSON.parse(fs.readFileSync(path.join(dir, 'zugang.json'), 'utf8'))
    assert.match(zugang.hash, /^scrypt\$17\$8\$1\$/)
    assert.equal(zugang.instance, 'abcdef')
    assert.equal((await fetch(`${s.base}/api/auth/login`, post({ password: TEST_PASSWORD }))).status, 200)
  } finally {
    s.stop()
  }
})

test('Anmeldung: Backup und Wiederherstellen lassen den Zugang unberührt', async () => {
  const s = await startServerIn(freshDir(), NETWORK)
  try {
    const { fetch: signed } = await signIn(s)
    const before = fs.readFileSync(path.join(s.dataDir, 'zugang.json'), 'utf8')
    const backup = await signed('/api/backup')
    assert.equal(backup.status, 200)
    const zip = Buffer.from(await backup.arrayBuffer())
    const names = new AdmZip(zip).getEntries().map((e) => e.entryName)
    assert.equal(names.some((n) => /zugang\.json|einrichtungscode|secrets/.test(n)), false, names.join(', '))
    const fd = new FormData()
    fd.append('file', new Blob([zip], { type: 'application/zip' }), 'backup.zip')
    const restored = await signed('/api/restore', { method: 'POST', body: fd })
    assert.equal(restored.status, 200, await restored.clone().text())
    assert.equal(fs.readFileSync(path.join(s.dataDir, 'zugang.json'), 'utf8'), before)
    assert.equal((await fetch(`${s.base}/api/units`)).status, 401)
    assert.equal((await signed('/api/units')).status, 200)
  } finally {
    s.stop()
  }
})

test('Anmeldung: eine Sitzung vom Handy öffnet die Sperren des Fensters nicht', async (t) => {
  const s = await startServerIn(freshDir(), { ...NETWORK, NKA_RUNTIME: 'desktop' })
  try {
    const { cookie } = await signIn(s)
    const lan = viaLan(s.base)
    if (!lan) return t.skip('keine Netzwerkkarte')
    for (const [method, urlPath] of [['POST', '/api/quit'], ['POST', '/api/ai/consent'], ['PUT', '/api/ai/key/text']]) {
      const res = await rawRequest(lan, { method, urlPath, headers: { cookie }, body: '{}' })
      assert.equal(res.status, 403, `${method} ${urlPath}`)
    }
    assert.equal((await rawRequest(lan, { urlPath: '/api/units', headers: { cookie } })).status, 200)
  } finally {
    s.stop()
  }
})

test('Anmeldung: im umgezogenen Ordner geht die Anmeldung trotz 423', async () => {
  const dir = await stockDir()
  fs.writeFileSync(path.join(dir, 'umgezogen.json'), JSON.stringify({ version: 1, movedTo: '/anderswo', at: '2026-11-01T10:00:00.000Z', appVersion: '0.16.0' }))
  fs.writeFileSync(path.join(dir, 'zugang.json'), JSON.stringify({ version: 1, mode: 'setup', instance: 'abcdef', changedAt: '' }))
  const s = await startServerIn(dir, NETWORK)
  try {
    const { fetch: signed } = await signIn(s)
    assert.equal((await signed('/api/properties')).status, 200)
    assert.equal((await signed('/api/units', post({ name: 'x' }))).status, 423)
  } finally {
    s.stop()
  }
})

// ---------- Betrieb: Zurücksetzen, Protokoll, Browser (Aufgabe 3) ----------

const waitFor = async (check: () => boolean | Promise<boolean>, ms = 5000): Promise<void> => {
  const deadline = Date.now() + ms
  while (!(await check())) {
    if (Date.now() > deadline) assert.fail('Bedingung nicht erreicht')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

test('Zurücksetzen: Datei bei laufendem Server, nächste Anmeldung verlangt die Einrichtung mit neuem Code', async () => {
  const s = await startServerIn(freshDir(), NETWORK)
  try {
    const { cookie } = await signIn(s)
    // Fehlversuche mit dem Code: Die Bremse leert sich mit dem Zurücksetzen
    for (let i = 0; i < 5; i++) await fetch(`${s.base}/api/auth/setup`, post({ code: 'AAAA-AAAA-AAAA', password: TEST_PASSWORD }))
    fs.writeFileSync(path.join(s.dataDir, 'passwort-zuruecksetzen'), '')
    const login = await fetch(`${s.base}/api/auth/login`, post({ password: TEST_PASSWORD }))
    assert.equal(login.status, 401)
    assert.equal((await jsonOf<{ setup?: boolean }>(login)).setup, true)
    assert.equal(fs.existsSync(path.join(s.dataDir, 'passwort-zuruecksetzen')), false)
    assert.equal((await fetch(`${s.base}/api/units`, { headers: { cookie } })).status, 401)
    const code = setupCode(s.dataDir)
    assert.ok(s.output().includes(`Einrichtungscode: ${code}`), s.output())
    await waitFor(() => /Das Passwort ist zurückgesetzt, alle Geräte sind abgemeldet\./.test(s.output()))
    assert.equal(JSON.parse(fs.readFileSync(path.join(s.dataDir, 'zugang.json'), 'utf8')).mode, 'setup')
    const again = await fetch(`${s.base}/api/auth/setup`, post({ code, password: 'ein ganz neues langes Passwort' }))
    assert.equal(again.status, 200)
  } finally {
    s.stop()
  }
})

test('Zurücksetzen: auch ohne Anmeldung, bei der nächsten Anfrage', async () => {
  const s = await startServerIn(freshDir(), NETWORK)
  try {
    const { cookie } = await signIn(s)
    fs.writeFileSync(path.join(s.dataDir, 'passwort-zuruecksetzen'), 'egal')
    await new Promise((resolve) => setTimeout(resolve, 1100))
    const res = await fetch(`${s.base}/api/units`, { headers: { cookie } })
    assert.equal(res.status, 401)
    assert.equal((await jsonOf<{ setup?: boolean }>(res)).setup, true)
  } finally {
    s.stop()
  }
})

test('Zurücksetzen: Datei beim Start', async () => {
  const dir = freshDir()
  const first = await startServerIn(dir, NETWORK)
  const instance = JSON.parse(fs.readFileSync(path.join(dir, 'zugang.json'), 'utf8')).instance
  await signIn(first)
  first.child.kill()
  await waitForExit(first.child).catch(() => null)
  fs.writeFileSync(path.join(dir, 'passwort-zuruecksetzen'), '')
  const s = await startServerIn(dir, NETWORK)
  try {
    assert.equal((await authOf(s.base)).mode, 'setup')
    assert.equal(fs.existsSync(path.join(dir, 'passwort-zuruecksetzen')), false)
    const zugang = JSON.parse(fs.readFileSync(path.join(dir, 'zugang.json'), 'utf8'))
    assert.equal(zugang.mode, 'setup')
    assert.equal(zugang.instance, instance)
    await waitFor(() => /Das Passwort ist zurückgesetzt \(Datei passwort-zuruecksetzen\)/.test(s.output()))
    await waitFor(() => s.output().includes(`Einrichtungscode: ${setupCode(dir)}`))
  } finally {
    s.stop()
  }
})

test('Zurücksetzen: bei NKA_AUTH=off ohne Wirkung', async () => {
  const s = await startServerIn(freshDir(), { ...NETWORK, NKA_AUTH: 'off' })
  try {
    fs.writeFileSync(path.join(s.dataDir, 'passwort-zuruecksetzen'), '')
    assert.equal((await authOf(s.base)).required, false)
    assert.equal(fs.existsSync(path.join(s.dataDir, 'zugang.json')), false)
  } finally {
    s.stop()
  }
})

test('Proxy vor einem lokalen Mietfuchs ohne Passwort: eine Zeile im Protokoll, Hinweis mit Code', async () => {
  const s = await startServerIn(freshDir())
  try {
    assert.equal((await authOf(s.base)).mode, 'none')
    for (let i = 0; i < 2; i++) assert.equal((await rawRequest(s.base, { urlPath: '/api/units', headers: { 'x-forwarded-for': '192.168.1.9' } })).status, 200)
    await waitFor(() => /Anfragen über einen Proxy erreichen Mietfuchs ohne Passwort/.test(s.output()))
    assert.equal(s.output().match(/Anfragen über einen Proxy/g)?.length, 1)
    const auth = await authOf(s.base)
    assert.equal(auth.mode, 'transition')
    assert.equal(auth.required, false)
    // mit dem Code eingerichtet brauchen Anfragen über den Proxy danach eine Sitzung, direkte nicht
    await signIn(s)
    assert.equal((await rawRequest(s.base, { urlPath: '/api/units', headers: { 'x-forwarded-for': '192.168.1.9' } })).status, 401)
    assert.equal((await fetch(`${s.base}/api/units`)).status, 200)
  } finally {
    s.stop()
  }
})

test('Programmdatei: der Browser öffnet die Einrichtung mit dem Code im Fragment', async () => {
  const { browserUrlFor } = await import('../src/accessServer.ts')
  assert.equal(browserUrlFor('http://127.0.0.1:3001', 'setup', 'K7QM4XPA9TRW'), 'http://127.0.0.1:3001/#einrichtung=K7QM-4XPA-9TRW')
  assert.equal(browserUrlFor('http://127.0.0.1:3001', 'password', null), 'http://127.0.0.1:3001')
  assert.equal(browserUrlFor('http://127.0.0.1:3001', 'transition', 'K7QM4XPA9TRW'), 'http://127.0.0.1:3001')
  // mit CI kein Browser, der Code steht trotzdem im Protokoll
  const s = await startServerIn(freshDir(), { ...NETWORK, NKA_RUNTIME: 'binary' })
  try {
    await waitFor(() => s.output().includes(`Einrichtungscode: ${setupCode(s.dataDir)}`))
    assert.doesNotMatch(s.output(), /#einrichtung=/)
  } finally {
    s.stop()
  }
})

// Durchsicht PR 3: Zurücksetzen während einer laufenden Berechnung (scrypt braucht eine halbe Sekunde)
const resetDuring = async (s: { base: string, dataDir: string }, running: Promise<Response>): Promise<Response> => {
  await new Promise((resolve) => setTimeout(resolve, 50))
  fs.writeFileSync(path.join(s.dataDir, 'passwort-zuruecksetzen'), '')
  await fetch(`${s.base}/api/auth`)
  return running
}

test('Zurücksetzen während einer Anmeldung: keine Sitzung, die das Zurücksetzen überlebt', async () => {
  const s = await startServerIn(freshDir(), NETWORK)
  try {
    await signIn(s)
    const login = await resetDuring(s, fetch(`${s.base}/api/auth/login`, post({ password: TEST_PASSWORD })))
    assert.equal(login.status, 401)
    assert.equal(login.headers.get('set-cookie'), null)
    assert.equal((await authOf(s.base)).mode, 'setup')
  } finally {
    s.stop()
  }
})

test('Zurücksetzen während Ausschalten oder Passwortwechsel: das Zurücksetzen gilt', async () => {
  const s = await startServerIn(freshDir(), NETWORK)
  try {
    const { cookie } = await signIn(s)
    const off = await resetDuring(s, fetch(`${s.base}/api/auth/off`, post({ current: TEST_PASSWORD }, { cookie })))
    assert.equal(off.status, 409)
    assert.equal(JSON.parse(fs.readFileSync(path.join(s.dataDir, 'zugang.json'), 'utf8')).mode, 'setup')
    const { cookie: again } = await signIn(s)
    const put = await resetDuring(s, fetch(`${s.base}/api/auth/password`, { ...post({ current: TEST_PASSWORD, password: 'ein Passwort des Angreifers' }, { cookie: again }), method: 'PUT' }))
    assert.equal(put.status, 409)
    assert.equal(JSON.parse(fs.readFileSync(path.join(s.dataDir, 'zugang.json'), 'utf8')).mode, 'setup')
  } finally {
    s.stop()
  }
})

test('Zurücksetzen lokal hinter einem Proxy: über den Proxy bleibt es streng, direkt nicht', async () => {
  const dir = freshDir()
  const { hashPassword } = await import('../src/access.ts')
  fs.writeFileSync(path.join(dir, 'zugang.json'), JSON.stringify({ version: 1, mode: 'password', instance: 'abcdef', hash: await hashPassword(TEST_PASSWORD, { logN: 12 }), changedAt: '' }))
  const s = await startServerIn(dir)
  try {
    const proxied = () => rawRequest(s.base, { urlPath: '/api/units', headers: { 'x-forwarded-for': '192.168.1.9' } })
    assert.equal((await proxied()).status, 401)
    fs.writeFileSync(path.join(dir, 'passwort-zuruecksetzen'), '')
    await fetch(`${s.base}/api/auth`)
    const after = await proxied()
    assert.equal(after.status, 401)
    assert.equal(JSON.parse(after.body).setup, true)
    assert.equal((await fetch(`${s.base}/api/units`)).status, 200)
  } finally {
    s.stop()
  }
})

test('Zurücksetzen: ein Ordner dieses Namens zählt nicht', async () => {
  const s = await startServerIn(freshDir(), NETWORK)
  try {
    await signIn(s)
    fs.mkdirSync(path.join(s.dataDir, 'passwort-zuruecksetzen'))
    assert.equal((await authOf(s.base)).mode, 'password')
  } finally {
    s.stop()
  }
})

// Passwort aus der Umgebung (#528): legt es beim Start fest, solange keins festgelegt ist; danach nur ein Hinweis. Der
// Wert verschwindet aus der Umgebung des Servers.
const ENV_PASSWORD = 'ein Satz aus der Umgebung'

test('Passwort aus NKA_PASSWORD_FILE: neuer Datenordner startet mit Passwort, ohne Code; später nur ein Hinweis', async () => {
  const dir = freshDir()
  const secret = path.join(freshDir(), 'mietfuchs_passwort')
  fs.writeFileSync(secret, `${ENV_PASSWORD}\n`)
  const first = await startServerIn(dir, { ...NETWORK, NKA_PASSWORD_FILE: secret, NKA_PASSWORD: 'wird nicht beachtet, weil die Datei vorgeht' })
  try {
    const auth = await authOf(first.base)
    assert.equal(auth.mode, 'password')
    assert.equal(auth.required, true)
    assert.equal(auth.codeFile, undefined)
    assert.equal(fs.existsSync(path.join(dir, 'einrichtungscode.txt')), false)
    assert.equal((await fetch(`${first.base}/api/units`)).status, 401)
    const ok = await fetch(`${first.base}/api/auth/login`, post({ password: ENV_PASSWORD }))
    assert.equal(ok.status, 200)
    await waitFor(() => first.output().includes('Das Passwort für Mietfuchs ist aus NKA_PASSWORD_FILE festgelegt.'))
    assert.ok(first.output().includes('NKA_PASSWORD wird neben NKA_PASSWORD_FILE nicht beachtet.'), first.output())
    assert.doesNotMatch(first.output(), /Einrichtungscode:/)
    assert.ok(!first.output().includes(ENV_PASSWORD), 'das Passwort steht nie im Protokoll')
  } finally {
    // nicht `stop()`: das räumte den Datenordner weg
    first.child.kill()
  }
  await waitForExit(first.child).catch(() => null)
  // Zweiter Start mit einer anderen Angabe: Das festgelegte Passwort bleibt.
  const second = await startServerIn(dir, { ...NETWORK, NKA_PASSWORD: 'ein ganz anderes langes Passwort' })
  try {
    assert.equal((await fetch(`${second.base}/api/auth/login`, post({ password: ENV_PASSWORD }))).status, 200)
    assert.equal((await fetch(`${second.base}/api/auth/login`, post({ password: 'ein ganz anderes langes Passwort' }))).status, 401)
    await waitFor(() => second.output().includes('NKA_PASSWORD wird nicht übernommen: Für Mietfuchs ist schon ein Passwort festgelegt.'))
  } finally {
    second.stop()
  }
})

test('Passwort aus NKA_PASSWORD: beendet den Übergang eines bestehenden Bestands; zu kurz oder NKA_AUTH=off ändert nichts', async () => {
  const dir = await stockDir()
  const short = await startServerIn(dir, { ...NETWORK, NKA_PASSWORD: 'zu kurz' })
  try {
    assert.equal((await authOf(short.base)).mode, 'transition')
    await waitFor(() => /NKA_PASSWORD: Das Passwort braucht mindestens 15 Zeichen\..* Das Passwort wird nicht übernommen\./.test(short.errorOutput()))
  } finally {
    short.child.kill()
  }
  await waitForExit(short.child).catch(() => null)
  const off = await startServerIn(dir, { ...NETWORK, NKA_AUTH: 'off', NKA_PASSWORD: ENV_PASSWORD })
  try {
    await waitFor(() => off.output().includes('NKA_PASSWORD wird nicht übernommen: Die Anmeldung ist über NKA_AUTH=off abgeschaltet.'))
    assert.equal(fs.existsSync(path.join(dir, 'zugang.json')), false, 'nichts festgelegt')
  } finally {
    off.child.kill()
  }
  await waitForExit(off.child).catch(() => null)
  const s = await startServerIn(dir, { ...NETWORK, NKA_PASSWORD: ENV_PASSWORD })
  try {
    assert.equal((await authOf(s.base)).mode, 'password')
    assert.equal((await fetch(`${s.base}/api/units`)).status, 401)
    const ok = await fetch(`${s.base}/api/auth/login`, post({ password: ENV_PASSWORD }))
    assert.equal(ok.status, 200)
    const units = await fetch(`${s.base}/api/properties`, { headers: { cookie: sessionOf(ok) } })
    assert.equal(units.status, 200)
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'zugang.json'), 'utf8')).mode, 'password')
  } finally {
    s.stop()
  }
})

test('Passwort aus der Umgebung: nach dem Zurücksetzen gilt es wieder, solange die Angabe steht', async () => {
  const dir = freshDir()
  const first = await startServerIn(dir, NETWORK)
  await signIn(first)
  first.child.kill()
  await waitForExit(first.child).catch(() => null)
  fs.writeFileSync(path.join(dir, 'passwort-zuruecksetzen'), '')
  const s = await startServerIn(dir, { ...NETWORK, NKA_PASSWORD: ENV_PASSWORD })
  try {
    assert.equal((await authOf(s.base)).mode, 'password')
    assert.equal((await fetch(`${s.base}/api/auth/login`, post({ password: ENV_PASSWORD }))).status, 200)
    assert.equal((await fetch(`${s.base}/api/auth/login`, post({ password: TEST_PASSWORD }))).status, 401)
  } finally {
    s.stop()
  }
})

// Betrieb im eigenen Programmfenster (#517) und die Prüfung von Host und Origin gegen den echten Server. Das Fenster
// startet den Server als utilityProcess von Electron mit NKA_DESKTOP=1 und NKA_HOST=127.0.0.1; hier unter Node
// nachgestellt mit NKA_RUNTIME=desktop. Dass der Server mit dem Fenster endet, auch nach einem Absturz, besorgt
// Electron selbst; das prüft scripts/desktop-check.mjs (Schritt 5) auf Windows und macOS. Die Regeln für Host und
// Origin prüft requestGuard.test.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { UpdateStatus } from '../../shared/types.ts'
import { startServerIn, startServerRaw, waitForExit } from '../testing/api.ts'

const freshDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))

// Anfrage mit frei gesetztem Host und Origin; fetch lässt Host nicht setzen.
function send(base: string, { method = 'GET', urlPath = '/api/settings', headers = {} }: { method?: string, urlPath?: string, headers?: Record<string, string> } = {}): Promise<{ status: number, body: string }> {
  const url = new URL(urlPath, base)
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers: { ...headers, ...(method === 'GET' ? {} : { 'content-type': 'application/json', 'content-length': '2' }) } }, (res) => {
      let body = ''
      res.on('data', (c: Buffer) => { body += c })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
    })
    req.on('error', reject)
    req.end(method === 'GET' ? undefined : '{}')
  })
}

const someLanAddress = (): string | null =>
  Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address ?? null

test('Fenster: Betriebsart desktop, lauscht nur auf 127.0.0.1', async () => {
  const s = await startServerIn(freshDir(), { NKA_RUNTIME: 'desktop', NKA_HOST: '127.0.0.1' })
  try {
    const status = await s.api<UpdateStatus>('/api/update')
    assert.equal(status.mode, 'desktop')
    const lan = someLanAddress()
    if (lan) {
      const port = new URL(s.base).port
      await assert.rejects(send(`http://${lan}:${port}`), /ECONNREFUSED|EHOSTUNREACH|ETIMEDOUT/)
    }
  } finally {
    s.stop()
  }
})

test('Fenster: Beenden aus der Oberfläche gibt es auch dort', async () => {
  const s = await startServerIn(freshDir(), { NKA_RUNTIME: 'desktop', NKA_HOST: '127.0.0.1' })
  try {
    assert.deepEqual(await s.api('/api/quit', { method: 'POST' }), { ok: true })
    assert.equal(await waitForExit(s.child), 0)
  } finally {
    s.stop()
  }
})

test('NKA_HOST: kein gültiger Wert, kein Start', async () => {
  const dataDir = freshDir()
  const start = startServerRaw(dataDir, { NKA_PORT: '0', NKA_HOST: 'irgendwo' })
  try {
    assert.equal(await waitForExit(start.child), 1)
    assert.match(start.out(), /NKA_HOST „irgendwo“ ist keine IP-Adresse/)
  } finally {
    start.child.kill()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})

test('Prüfung: als Programmdatei kein fremder Name und keine Änderung von fremder Seite', async () => {
  const s = await startServerIn(freshDir(), { NKA_RUNTIME: 'binary' })
  try {
    const own = new URL(s.base).host
    assert.equal((await send(s.base)).status, 200)
    const rebound = await send(s.base, { headers: { host: `angreifer.example.com:${new URL(s.base).port}` } })
    assert.equal(rebound.status, 403)
    assert.match(rebound.body, /NKA_ALLOWED_HOSTS/)
    assert.equal((await send(s.base, { headers: { host: `pi.fritz.box:${new URL(s.base).port}` } })).status, 200)
    // Ändern: fremde Seite abgelehnt, die eigene durchgelassen (an der Route liegt es dann, was sie antwortet)
    const csrf = await send(s.base, { method: 'POST', urlPath: '/api/quit', headers: { origin: 'https://angreifer.example' } })
    assert.equal(csrf.status, 403)
    assert.equal(s.child.exitCode, null, 'läuft noch')
    const own2 = await send(s.base, { method: 'PUT', urlPath: '/api/settings', headers: { origin: `http://${own}` } })
    assert.notEqual(own2.status, 403)
  } finally {
    s.stop()
  }
})

test('Prüfung: im npm-Betrieb aus (Docker ebenso), mit NKA_ALLOWED_HOSTS an', async () => {
  const open = await startServerIn(freshDir())
  try {
    assert.equal((await send(open.base, { headers: { host: 'mietfuchs.example.org' } })).status, 200)
  } finally {
    open.stop()
  }
  const listed = await startServerIn(freshDir(), { NKA_ALLOWED_HOSTS: 'mietfuchs.example.org' })
  try {
    assert.equal((await send(listed.base, { headers: { host: 'mietfuchs.example.org' } })).status, 200)
    assert.equal((await send(listed.base, { headers: { host: 'andere.example.org' } })).status, 403)
  } finally {
    listed.stop()
  }
})

// Geänderte Erwartung: Bisher beendete sich der Server im Fenster, sobald seine Standardeingabe endete, und ein Ende
// mitten im Start wartete den Start ab (Durchsicht M2). Ein utilityProcess von Electron hat keine Standardeingabe, sie
// endet sofort; mit der alten Regel endete der Server im Fenster gleich nach dem Start. Das Ende mit dem Fenster
// übernimmt Electron, das Beenden ohne Adresse die Nachricht „quit“ über `process.parentPort` (shutDown wartet dabei
// weiter den Start ab). startServerRaw gibt keine Standardeingabe, sie endet also sofort.
test('Fenster: Ende der Standardeingabe beendet den Server nicht', async () => {
  const dataDir = freshDir()
  const start = startServerRaw(dataDir, { NKA_PORT: '0', NKA_RUNTIME: 'desktop', NKA_HOST: '127.0.0.1' })
  try {
    const deadline = Date.now() + 30_000
    while (!/läuft auf/.test(start.out()) && start.child.exitCode === null && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100))
    assert.match(start.out(), /läuft auf/, 'der Start lief zu Ende')
    await new Promise((resolve) => setTimeout(resolve, 1500))
    assert.equal(start.child.exitCode, null, 'läuft nach dem Ende der Standardeingabe weiter')
  } finally {
    if (start.child.exitCode === null) {
      start.child.kill()
      await waitForExit(start.child)
    }
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})

// Das echte Fenster unter Node nachgestellt (server/testing/fakeUtilityProcess.ts): utilityProcess mit NKA_DESKTOP.
const fakeUtility = `--import=${pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'testing', 'fakeUtilityProcess.ts')).href}`

test('Fenster im utilityProcess: Betriebsart desktop aus NKA_DESKTOP, ohne Testgriff', async () => {
  const s = await startServerIn(freshDir(), { NODE_OPTIONS: fakeUtility, NKA_DESKTOP: '1', NKA_HOST: '127.0.0.1' })
  try {
    assert.equal((await s.api<UpdateStatus>('/api/update')).mode, 'desktop')
  } finally {
    s.stop()
  }
})

// Durchsicht M2, mit der Nachricht statt der Standardeingabe: Schließt jemand das Fenster mitten im Start, schickt es
// „quit“; der Server startet zu Ende (Migration, Sicherung, Umstieg) und beendet sich erst dann, mit 0.
test('Fenster im utilityProcess: „quit“ mitten im Start beendet erst nach dem Start', async () => {
  const dataDir = freshDir()
  const start = startServerRaw(dataDir, { NODE_OPTIONS: fakeUtility, NKA_PORT: '0', NKA_DESKTOP: '1', NKA_HOST: '127.0.0.1', NKA_TEST_START_DELAY_MS: '1500' }, { stdin: 'pipe' })
  try {
    start.child.stdin?.write('quit\n')
    assert.equal(await waitForExit(start.child), 0)
    assert.match(start.out(), /läuft auf/, 'der Start lief zu Ende')
  } finally {
    if (start.child.exitCode === null) start.child.kill()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})

// Durchsicht vor 0.15.0 (K6): Mit „Zugriff aus dem Heimnetz“ (NKA_HOST=0.0.0.0) erreicht das Handy den Server des
// Fensters. Beenden, KI-Schlüssel und -Zustimmung und die Zustimmung zur Update-Prüfung gehören an den Rechner: Ein
// `/api/quit` aus dem Heimnetz beendete das Fenster mit, und eine Zustimmung gibt, wer vor dem Rechner sitzt. Das übrige
// Speichern der Einstellungen bleibt aus dem Heimnetz möglich.
test('Fenster: Beenden, KI-Schlüssel, Zustimmungen und Update-Prüfung nur vom eigenen Rechner', async (t) => {
  const lan = someLanAddress()
  if (!lan) return t.skip('Dieser Rechner hat keine Adresse außer Loopback; ohne sie lässt sich keine Anfrage aus dem Heimnetz nachstellen.')
  const s = await startServerIn(freshDir(), { NKA_RUNTIME: 'desktop', NKA_HOST: '0.0.0.0', NKA_AUTH: 'off' })
  try {
    const fromLan = `http://${lan}:${new URL(s.base).port}`
    const call = async (base: string, method: string, urlPath: string, body?: unknown) => {
      const res = await fetch(`${base}${urlPath}`, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) })
      return { status: res.status, body: await res.json() as Record<string, unknown> }
    }
    const refused: [string, string, unknown, RegExp][] = [
      ['POST', '/api/quit', {}, /^Beenden geht nur am Rechner, auf dem Mietfuchs läuft\.$/],
      ['PUT', '/api/ai/key', { slot: 'text', key: 'sk-test' }, /^KI-Schlüssel und Zustimmungen ändern Sie nur am Rechner, auf dem Mietfuchs läuft\.$/],
      ['DELETE', '/api/ai/key/text', undefined, /nur am Rechner/],
      ['POST', '/api/ai/consent', { slot: 'text' }, /nur am Rechner/],
      ['DELETE', '/api/ai/consent/text', undefined, /nur am Rechner/],
      ['PUT', '/api/settings', { updateCheck: 'on' }, /^Die Update-Prüfung schalten Sie nur am Rechner ein oder aus, auf dem Mietfuchs läuft\.$/],
      // Express nimmt Routen ohne Rücksicht auf Groß und Klein und mit einem Schrägstrich am Ende an; die Sperre auch (#585)
      ['POST', '/API/QUIT', {}, /^Beenden geht nur am Rechner/],
      ['POST', '/api/quit/', {}, /^Beenden geht nur am Rechner/],
      ['POST', '/Api/Quit/', {}, /^Beenden geht nur am Rechner/],
      ['PUT', '/API/ai/key', { slot: 'text', key: 'sk-test' }, /^KI-Schlüssel und Zustimmungen/],
      ['PUT', '/api/ai/key/', { slot: 'text', key: 'sk-test' }, /^KI-Schlüssel und Zustimmungen/],
      ['DELETE', '/API/AI/KEY/text/', undefined, /nur am Rechner/],
      ['POST', '/api/AI/Consent/', { slot: 'text' }, /nur am Rechner/],
      ['DELETE', '/API/ai/consent/text', undefined, /nur am Rechner/],
    ]
    for (const [method, urlPath, body, message] of refused) {
      const res = await call(fromLan, method, urlPath, body)
      assert.equal(res.status, 403, `${method} ${urlPath}`)
      assert.match(String(res.body.error), message, `${method} ${urlPath}`)
    }
    assert.equal(s.child.exitCode, null, 'läuft noch')
    // Das übrige Speichern geht aus dem Heimnetz, auch mit unverändert mitgeschicktem updateCheck (das Formular schickt
    // ihn nicht, ein älterer Tab vielleicht)
    const before = await s.api<{ updateCheck: string | null }>('/api/settings')
    const landlord = await call(fromLan, 'PUT', '/api/settings', { landlordName: 'V. Vermieter', updateCheck: before.updateCheck })
    assert.equal(landlord.status, 200, JSON.stringify(landlord.body))
    assert.equal(landlord.body.landlordName, 'V. Vermieter')
    assert.equal(landlord.body.updateCheck, before.updateCheck)
    // Vom eigenen Rechner wie bisher
    assert.equal((await call(s.base, 'PUT', '/api/settings', { updateCheck: 'on' })).body.updateCheck, 'on')
    assert.equal((await call(s.base, 'DELETE', '/api/ai/consent/text')).status, 200)
    assert.equal((await call(s.base, 'POST', '/api/quit', {})).status, 200)
    assert.equal(await waitForExit(s.child), 0)
  } finally {
    s.stop()
  }
})

// Ein Proxy auf demselben Rechner (Peer 127.0.0.1) reicht Anfragen aus dem Netz weiter. Mit einer Kopfzeile eines Proxys
// kommt eine Anfrage deshalb nie „vom Rechner selbst“, auch ohne Netzwerkkarte nachzustellen.
test('Fenster: über einen Proxy auf demselben Rechner gelten Beenden, Zustimmungen, Update und Umzug als von außen', async () => {
  const s = await startServerIn(freshDir(), { NKA_RUNTIME: 'desktop', NKA_HOST: '127.0.0.1', NKA_AUTH: 'off' })
  try {
    for (const [name, value] of [['x-forwarded-for', '192.168.1.9'], ['x-forwarded-proto', 'https'], ['via', '1.1 caddy']]) {
      const proxied = { [name]: value }
      const call = async (method: string, urlPath: string, body?: unknown) => {
        const res = await fetch(`${s.base}${urlPath}`, { method, headers: { ...proxied, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
        return { status: res.status, body: await res.json() as Record<string, unknown> }
      }
      const quit = await call('POST', '/api/quit', {})
      assert.equal(quit.status, 403, name)
      assert.match(String(quit.body.error), /^Beenden geht nur am Rechner/, name)
      assert.equal((await call('POST', '/api/ai/consent', { slot: 'text' })).status, 403, name)
      assert.equal((await call('PUT', '/api/settings', { updateCheck: 'on' })).status, 403, name)
      assert.equal((await call('GET', '/api/update')).body.otherDevice, true, name)
      assert.equal((await call('GET', '/api/relocation')).body.offered, false, name)
      assert.equal((await call('GET', '/api/relocation/candidates')).status, 403, name)
    }
    assert.equal(s.child.exitCode, null, 'läuft noch')
  } finally {
    s.stop()
  }
})

test('Heimnetz im Browserbetrieb (Docker, npm): Beenden und Zustimmungen bleiben, wie sie waren', async (t) => {
  const lan = someLanAddress()
  if (!lan) return t.skip('Dieser Rechner hat keine Adresse außer Loopback.')
  const s = await startServerIn(freshDir(), { NKA_HOST: '0.0.0.0', NKA_AUTH: 'off' })
  try {
    const res = await fetch(`http://${lan}:${new URL(s.base).port}/api/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ updateCheck: 'on' }) })
    assert.equal(res.status, 200)
  } finally {
    s.stop()
  }
})

// Der Update-Hinweis richtet sich nach dem Rechner, auf dem Mietfuchs läuft. Auf einem anderen Gerät im Heimnetz lüde
// sein Knopf die Datei dieses Rechners aufs falsche Gerät; dort also ohne Download und ohne Umstiegshinweis.
test('Update-Stand: auf einem anderen Gerät ohne Download, vom eigenen Rechner wie bisher', async (t) => {
  const lan = someLanAddress()
  if (!lan) return t.skip('Dieser Rechner hat keine Adresse außer Loopback; ohne sie lässt sich keine Anfrage aus dem Heimnetz nachstellen.')
  const s = await startServerIn(freshDir(), { NKA_RUNTIME: 'desktop', NKA_HOST: '0.0.0.0', NKA_AUTH: 'off' })
  try {
    const fromLan = `http://${lan}:${new URL(s.base).port}`
    for (const [method, urlPath] of [['GET', '/api/update'], ['POST', '/api/update/check']]) {
      const res = await fetch(`${fromLan}${urlPath}`, { method })
      assert.equal(res.status, 200, `${method} ${urlPath}`)
      const body = await res.json() as Record<string, unknown>
      assert.equal(body.otherDevice, true, `${method} ${urlPath}`)
      assert.equal(body.downloadUrl, null)
      assert.equal(body.desktopOffer, null)
    }
    const own = await s.api<Record<string, unknown>>('/api/update')
    assert.equal('otherDevice' in own, false)
  } finally {
    s.stop()
  }
})

// ---------- Fensterschlüssel (#528) ----------
// Das Fenster gilt über einen Schlüssel je Start als angemeldet: nur im Fenster, nur über 127.0.0.1, zeitkonstant
// verglichen. Er macht die Anfrage auch „am Rechner“ für die Einrichtung ohne Code.
const WINDOW_KEY = 'fensterschluessel-fuer-den-test-0123456789abcdef'
const windowHeaders = (key = WINDOW_KEY) => ({ 'X-Mietfuchs-Window': key })

test('Fensterschlüssel: angemeldet ohne Cookie, Einrichtung ohne Code, nur über 127.0.0.1', async (t) => {
  const s = await startServerIn(freshDir(), { NKA_RUNTIME: 'desktop', NKA_HOST: '0.0.0.0', NKA_WINDOW_KEY: WINDOW_KEY })
  try {
    const auth = await (await fetch(`${s.base}/api/auth`, { headers: windowHeaders() })).json() as { mode: string, window: boolean, signedIn: boolean }
    assert.equal(auth.mode, 'setup')
    assert.equal(auth.window, true)
    assert.equal(auth.signedIn, true)
    assert.equal((await fetch(`${s.base}/api/units`, { headers: windowHeaders() })).status, 200)
    assert.equal((await fetch(`${s.base}/api/units`, { headers: windowHeaders('falsch') })).status, 401)
    assert.equal((await fetch(`${s.base}/api/units`)).status, 401)
    // Einrichtung im Fenster ohne Code
    const setup = await fetch(`${s.base}/api/auth/setup`, { method: 'POST', headers: { ...windowHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ password: 'ein langes Fensterpasswort' }) })
    assert.equal(setup.status, 200)
    // mit Passwort liest der Hauptprozess die Einstellungen weiter (readConsent), ohne Anmeldung
    assert.equal((await fetch(`${s.base}/api/settings`, { headers: windowHeaders() })).status, 200)
    // neues Passwort im Fenster ohne das bisherige
    const change = await fetch(`${s.base}/api/auth/password`, { method: 'PUT', headers: { ...windowHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ password: 'ein neues Fensterpasswort' }) })
    assert.equal(change.status, 200)
    // der Schlüssel steht nicht mehr in der Umgebung des Servers und geht in keine Antwort
    assert.doesNotMatch(await (await fetch(`${s.base}/api/settings`, { headers: windowHeaders() })).text(), new RegExp(WINDOW_KEY))
    // über einen Proxy auf demselben Rechner wirkungslos, mit jeder Kopfzeile eines Proxys
    for (const name of ['x-forwarded-for', 'x-forwarded-proto']) {
      assert.equal((await fetch(`${s.base}/api/units`, { headers: { ...windowHeaders(), [name]: name === 'x-forwarded-proto' ? 'https' : '192.168.1.9' } })).status, 401, name)
    }
    const lan = someLanAddress()
    if (!lan) return t.skip('keine Netzwerkkarte')
    const fromLan = await send(`http://${lan}:${new URL(s.base).port}`, { urlPath: '/api/units', headers: windowHeaders() })
    assert.equal(fromLan.status, 401)
  } finally {
    s.stop()
  }
})

test('Fensterschlüssel: ohne Fenster wirkungslos, Beenden vom Rechner auch ohne Schlüssel', async () => {
  const s = await startServerIn(freshDir(), { NKA_RUNTIME: '', NKA_HOST: '0.0.0.0', NKA_WINDOW_KEY: WINDOW_KEY })
  try {
    assert.equal((await fetch(`${s.base}/api/units`, { headers: windowHeaders() })).status, 401)
  } finally {
    s.stop()
  }
  const w = await startServerIn(freshDir(), { NKA_RUNTIME: 'desktop', NKA_HOST: '0.0.0.0', NKA_WINDOW_KEY: WINDOW_KEY })
  try {
    // ein Fenster ohne den Schlüssel dieses Starts beendet seinen Server trotzdem (stopServer, Umzug)
    const res = await fetch(`${w.base}/api/quit`, { method: 'POST' })
    assert.equal(res.status, 200)
    assert.equal(await waitForExit(w.child), 0)
  } finally {
    w.stop()
  }
})

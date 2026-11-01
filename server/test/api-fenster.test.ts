// Betrieb im eigenen Programmfenster (#517) und die Prüfung von Host und Origin gegen den echten Server. Das Fenster
// startet die Programmdatei mit NKA_DESKTOP=1 und NKA_HOST=127.0.0.1 und hält ihre Standardeingabe offen; hier
// nachgestellt mit NKA_RUNTIME=desktop. Die Regeln selbst prüft requestGuard.test.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
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

test('Fenster: Betriebsart desktop, lauscht nur auf 127.0.0.1 und endet, wenn die Standardeingabe endet', async () => {
  const s = await startServerIn(freshDir(), { NKA_RUNTIME: 'desktop', NKA_HOST: '127.0.0.1' })
  try {
    const status = await s.api<UpdateStatus>('/api/update')
    assert.equal(status.mode, 'desktop')
    const lan = someLanAddress()
    if (lan) {
      const port = new URL(s.base).port
      await assert.rejects(send(`http://${lan}:${port}`), /ECONNREFUSED|EHOSTUNREACH|ETIMEDOUT/)
    }
    // Das Fenster ist weg (Absturz, Abmelden): Der Server darf nicht als Waise weiterlaufen
    s.child.stdin.end()
    assert.equal(await waitForExit(s.child), 0)
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

// Durchsicht M2: Endet die Standardeingabe mitten im Start (Fenster während der Migration geschlossen), läuft der
// Start erst zu Ende, dann endet der Server. Sonst bräche er Migration oder Sicherung ab. startServerRaw gibt keine
// Standardeingabe, sie endet also sofort.
test('Fenster: Ende der Standardeingabe mitten im Start beendet erst nach dem Start', async () => {
  const dataDir = freshDir()
  const start = startServerRaw(dataDir, { NKA_PORT: '0', NKA_RUNTIME: 'desktop', NKA_HOST: '127.0.0.1', NKA_TEST_START_DELAY_MS: '1500' })
  try {
    assert.equal(await waitForExit(start.child), 0)
    assert.match(start.out(), /läuft auf/, 'der Start lief zu Ende')
  } finally {
    start.child.kill()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})

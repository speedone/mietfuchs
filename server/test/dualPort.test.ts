// Ein Port für HTTP und HTTPS (#528, Schritt 2): Das erste Byte jeder Verbindung entscheidet (0x16 = TLS-Handshake).
// Hier der äußere Server allein mit einem kleinen Handler; den echten Server prüft api-https.test.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import tls from 'node:tls'
import { createDualServer } from '../src/dualPort.ts'
import { ensureCertificate, type Certificate } from '../src/tls.ts'
import { portOf } from '../testing/api.ts'

let pair: Certificate | null = null
async function certificate(): Promise<Certificate> {
  if (pair) return pair
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-dualport-'))
  try {
    const result = await ensureCertificate(dir)
    if ('problem' in result) return assert.fail(result.problem)
    pair = result
    return result
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

// Antwortet mit dem Protokoll, wie es der Handler sieht
const handler: http.RequestListener = (req, res) => {
  res.setHeader('content-type', 'text/plain')
  res.end(`${(req.socket as tls.TLSSocket).encrypted === true ? 'verschlüsselt' : 'offen'} ${req.url}`)
}

async function withDual(tlsPair: { key: string, cert: string } | null, fn: (port: number) => Promise<void>, options?: { firstByteMs?: number }) {
  const dual = createDualServer(handler, tlsPair, options)
  await new Promise<void>((resolve) => dual.server.listen(0, '127.0.0.1', resolve))
  try {
    await fn(portOf(dual.server))
  } finally {
    dual.http.closeAllConnections()
    await new Promise<void>((resolve) => dual.server.close(() => resolve()))
  }
}

function get(mod: typeof http | typeof https, port: number, urlPath: string): Promise<{ status: number, body: string }> {
  return new Promise((resolve, reject) => {
    const req = mod.get({ host: '127.0.0.1', port, path: urlPath, rejectUnauthorized: false, agent: false }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (c: string) => { body += c })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
    })
    req.on('error', reject)
  })
}

// Wartet, bis die Gegenseite die Verbindung schließt; liefert die Zeit bis dahin
function closedAfter(socket: net.Socket): Promise<number> {
  const started = Date.now()
  return new Promise((resolve) => {
    socket.on('error', () => undefined)
    socket.on('close', () => resolve(Date.now() - started))
    socket.resume()
  })
}

test('Ein Port: HTTP und HTTPS antworten mit demselben Handler', async () => {
  await withDual(await certificate(), async (port) => {
    assert.deepEqual(await get(http, port, '/a'), { status: 200, body: 'offen /a' })
    assert.deepEqual(await get(https, port, '/b'), { status: 200, body: 'verschlüsselt /b' })
    // Mehrmals abwechselnd: keine Verbindung beeinflusst die nächste
    assert.equal((await get(http, port, '/c')).body, 'offen /c')
    assert.equal((await get(https, port, '/d')).body, 'verschlüsselt /d')
  })
})

test('Ein Port: das Zertifikat ist das übergebene', async () => {
  const pairNow = await certificate()
  await withDual(pairNow, async (port) => {
    const socket = tls.connect({ host: '127.0.0.1', port, rejectUnauthorized: false })
    await new Promise<void>((resolve, reject) => { socket.once('secureConnect', resolve); socket.once('error', reject) })
    const peer = socket.getPeerCertificate(true)
    socket.destroy()
    assert.ok(peer.raw.equals(new crypto.X509Certificate(pairNow.cert).raw))
  })
})

test('Ein Port: eine Verbindung, die nichts schickt, wird geschlossen', async () => {
  await withDual(await certificate(), async (port) => {
    const socket = net.connect(port, '127.0.0.1')
    const ms = await closedAfter(socket)
    assert.ok(ms >= 150, `zu früh geschlossen (${ms} ms)`)
    assert.ok(ms < 5000, `zu spät geschlossen (${ms} ms)`)
  }, { firstByteMs: 200 })
})

test('Ein Port: ein Byte und Ende sind kein Fehler des Servers', async () => {
  await withDual(await certificate(), async (port) => {
    for (const byte of [0x16, 0x47, 0x00]) {
      const socket = net.connect(port, '127.0.0.1')
      socket.end(Buffer.from([byte]))
      await closedAfter(socket)
    }
    // Abgebrochen mitten im Handshake
    const socket = net.connect(port, '127.0.0.1')
    socket.end(Buffer.from([0x16, 0x03, 0x01, 0x00, 0x05, 0x01]))
    await closedAfter(socket)
    // Der Server lebt und antwortet weiter auf beiden Wegen
    assert.equal((await get(http, port, '/x')).body, 'offen /x')
    assert.equal((await get(https, port, '/y')).body, 'verschlüsselt /y')
  })
})

test('Ein Port: ohne Zertifikat wird eine TLS-Verbindung geschlossen, HTTP bleibt', async () => {
  await withDual(null, async (port) => {
    await assert.rejects(get(https, port, '/z'))
    assert.equal((await get(http, port, '/z')).body, 'offen /z')
  })
})

test('Ein Port: ein später gesetztes Zertifikat gilt für neue Verbindungen', async () => {
  // Der Server bindet den Port, bevor er im Datenordner etwas schreibt (#244); erzeugt wird das Zertifikat danach
  const dual = createDualServer(handler, null)
  await new Promise<void>((resolve) => dual.server.listen(0, '127.0.0.1', resolve))
  try {
    const port = portOf(dual.server)
    await assert.rejects(get(https, port, '/vorher'))
    dual.useCertificate(await certificate())
    assert.equal((await get(https, port, '/nachher')).body, 'verschlüsselt /nachher')
  } finally {
    dual.http.closeAllConnections()
    await new Promise<void>((resolve) => dual.server.close(() => resolve()))
  }
})

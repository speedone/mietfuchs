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

// Wartet, bis die Gegenseite die Verbindung schließt; liefert die Zeit bis dahin. Nach zehn Sekunden gibt der Test auf
// (Infinity) und schließt selbst, sonst hinge der Lauf an einer Verbindung, die der Server offen lässt.
function closedAfter(socket: net.Socket, giveUpMs = 10_000): Promise<number> {
  const started = Date.now()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(Infinity)
      socket.destroy()
    }, giveUpMs)
    socket.on('error', () => undefined)
    socket.on('close', () => {
      clearTimeout(timer)
      resolve(Date.now() - started)
    })
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

// Die Fristen des http.Server (headersTimeout, requestTimeout) prüft Node nur für einen Server, der 'listening' gemeldet
// hat; der innere lauscht nie selbst. Kurz eingestellt, damit der Test schnell ist.
async function withShortTimeouts(fn: (port: number) => Promise<void>, firstByteMs?: number, listener: http.RequestListener = handler, { keepAliveTimeout }: { keepAliveTimeout?: number } = {}) {
  const dual = createDualServer(listener, await certificate(), firstByteMs === undefined ? {} : { firstByteMs })
  // Lang, wo ein Test die eigene Frist sehen will und nicht das Ende einer ruhenden Verbindung
  if (keepAliveTimeout !== undefined) dual.http.keepAliveTimeout = keepAliveTimeout
  dual.http.headersTimeout = 400
  dual.http.requestTimeout = 800
  ;(dual.http as http.Server & { connectionsCheckingInterval: number }).connectionsCheckingInterval = 100
  await new Promise<void>((resolve) => dual.server.listen(0, '127.0.0.1', resolve))
  try {
    await fn(portOf(dual.server))
  } finally {
    dual.http.closeAllConnections()
    await new Promise<void>((resolve) => dual.server.close(() => resolve()))
  }
}

test('Ein Port: unvollständige Kopfzeilen über HTTP werden nach headersTimeout geschlossen', async () => {
  await withShortTimeouts(async (port) => {
    const socket = net.connect(port, '127.0.0.1')
    socket.write('GET / HTTP/1.1\r\nHost: x\r\n')
    const ms = await closedAfter(socket)
    assert.ok(ms < 4000, `nach ${ms} ms noch offen`)
  })
})

test('Ein Port: unvollständige Kopfzeilen über HTTPS werden nach headersTimeout geschlossen', async () => {
  await withShortTimeouts(async (port) => {
    const socket = tls.connect({ host: '127.0.0.1', port, rejectUnauthorized: false })
    await new Promise<void>((resolve, reject) => { socket.once('secureConnect', resolve); socket.once('error', reject) })
    socket.write('GET / HTTP/1.1\r\nHost: x\r\n')
    const ms = await closedAfter(socket)
    assert.ok(ms < 4000, `nach ${ms} ms noch offen`)
  })
})

test('Ein Port: ein stockender TLS-Handshake wird nach der eigenen Frist geschlossen', async () => {
  // Unabhängig von den Fristen des http.Server und der Laufzeit (Bun)
  const dual = createDualServer(handler, await certificate(), { firstByteMs: 300 })
  await new Promise<void>((resolve) => dual.server.listen(0, '127.0.0.1', resolve))
  try {
    const socket = net.connect(portOf(dual.server), '127.0.0.1')
    socket.write(Buffer.from([0x16, 0x03, 0x01]))
    const ms = await closedAfter(socket)
    assert.ok(ms >= 250, `zu früh geschlossen (${ms} ms)`)
    assert.ok(ms < 4000, `nach ${ms} ms noch offen`)
  } finally {
    dual.http.closeAllConnections()
    await new Promise<void>((resolve) => dual.server.close(() => resolve()))
  }
})

test('Ein Port: eine Verbindung mit Keep-alive überlebt die Frist für das erste Byte', async () => {
  // Die Frist gilt nur bis zum ersten Byte und bis zum Ende des Handshakes, nicht für eine ruhende Verbindung danach
  await withDual(await certificate(), async (port) => {
    const agent = new https.Agent({ keepAlive: true, rejectUnauthorized: false })
    try {
      const once = () => new Promise<string>((resolve, reject) => {
        https.get({ host: '127.0.0.1', port, path: '/k', agent }, (res) => {
          let body = ''
          res.on('data', (c: Buffer) => { body += c })
          res.on('end', () => resolve(body))
        }).on('error', reject)
      })
      assert.equal(await once(), 'verschlüsselt /k')
      await new Promise((resolve) => setTimeout(resolve, 400))
      assert.equal(await once(), 'verschlüsselt /k')
    } finally {
      agent.destroy()
    }
  }, { firstByteMs: 200 })
})

// Ein POST, der 100 Byte ankündigt und nur 3 schickt: Die ganze Anfrage muss nach requestTimeout (800 ms) enden. Unter
// Bun prüft der http.Server übergebene Verbindungen nicht; vor dem eigenen Port galt die Frist auch dort.
// Der Handler wartet auf den ganzen Rumpf wie express.json(); antwortete er sofort, endete die Verbindung aus anderem Grund
const readsBody: http.RequestListener = (req, res) => {
  req.resume()
  req.on('end', () => res.end('gelesen'))
}
const SLOW_BODY = 'POST /rumpf HTTP/1.1\r\nHost: x\r\nContent-Type: text/plain\r\nContent-Length: 100\r\n\r\nabc'

test('Ein Port: ein langsamer Rumpf über HTTP wird nach requestTimeout geschlossen', async () => {
  await withShortTimeouts(async (port) => {
    const socket = net.connect(port, '127.0.0.1')
    socket.write(SLOW_BODY)
    const ms = await closedAfter(socket)
    assert.ok(ms >= 700, `vor requestTimeout geschlossen (${ms} ms)`)
    assert.ok(ms < 4000, `nach ${ms} ms noch offen`)
  }, undefined, readsBody)
})

test('Ein Port: ein langsamer Rumpf über HTTPS wird nach requestTimeout geschlossen', async () => {
  await withShortTimeouts(async (port) => {
    const socket = tls.connect({ host: '127.0.0.1', port, rejectUnauthorized: false })
    await new Promise<void>((resolve, reject) => { socket.once('secureConnect', resolve); socket.once('error', reject) })
    socket.write(SLOW_BODY)
    const ms = await closedAfter(socket)
    assert.ok(ms >= 700, `vor requestTimeout geschlossen (${ms} ms)`)
    assert.ok(ms < 4000, `nach ${ms} ms noch offen`)
  }, undefined, readsBody)
})

test('Ein Port: eine lange Antwort nach vollständiger Anfrage überschreitet requestTimeout ohne Abbruch', async () => {
  // Die Frist gilt für das Ankommen der Anfrage, nicht für die Antwort: KI-Auswertung und Backup antworten länger
  const late: http.RequestListener = (req, res) => {
    req.resume()
    res.write('a')
    setTimeout(() => res.end('b'), 1500)
  }
  await withShortTimeouts(async (port) => {
    for (const mod of [http, https] as const) {
      const body = await new Promise<string>((resolve, reject) => {
        const req = mod.request({ host: '127.0.0.1', port, method: 'POST', path: '/', rejectUnauthorized: false, agent: false, headers: { 'content-type': 'text/plain' } }, (res) => {
          let text = ''
          res.on('data', (c: Buffer) => { text += c })
          res.on('end', () => resolve(text))
          res.on('error', reject)
        })
        req.on('error', reject)
        req.end('kurz')
      })
      assert.equal(body, 'ab')
    }
  }, undefined, late)
})

test('Ein Port: nach einer frühen Antwort und spätem Rumpf gilt die Frist für die nächsten Kopfzeilen', async () => {
  // Die Vorschaltung der Anmeldung antwortet 401, bevor der Rumpf da ist (req.resume()). Kommt der Rumpf danach, darf
  // sein Ende nicht die Uhr der nächsten Anfrage löschen, sonst bliebe die ruhende Verbindung unter Bun ohne Frist.
  const early: http.RequestListener = (req, res) => {
    req.resume()
    res.statusCode = 401
    res.end('anmelden')
  }
  await withShortTimeouts(async (port) => {
    for (const secure of [false, true]) {
      const socket = secure ? tls.connect({ host: '127.0.0.1', port, rejectUnauthorized: false }) : net.connect(port, '127.0.0.1')
      await new Promise<void>((resolve, reject) => { socket.once(secure ? 'secureConnect' : 'connect', resolve); socket.once('error', reject) })
      socket.write('POST /api/x HTTP/1.1\r\nHost: x\r\nContent-Type: text/plain\r\nContent-Length: 10\r\n\r\n')
      const closed = closedAfter(socket)
      await new Promise((resolve) => setTimeout(resolve, 200))
      socket.write('0123456789')
      // Danach keine neue Anfrage: Die Verbindung ruht und muss nach headersTimeout (400 ms) enden
      const ms = await closed
      assert.ok(ms < 3000, `${secure ? 'HTTPS' : 'HTTP'}: nach ${ms} ms noch offen`)
    }
  }, undefined, early, { keepAliveTimeout: 60_000 })
})

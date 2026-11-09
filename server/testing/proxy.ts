// Ein Reverse Proxy und eine eigene CA für Prüfungen der Kopplung über einen Proxy (#528). Der Proxy verhält sich wie
// Caddy: Er nimmt HTTPS an, leitet über HTTP weiter, verwirft eingehende `X-Forwarded-*` und setzt `X-Forwarded-Proto:
// https`, `X-Forwarded-Host` (der eingehende Host) und `X-Forwarded-For` (der Peer); `Host` reicht er unverändert
// weiter. `forwarded` überschreibt die beiden ersten für Tests, `null` lässt eine weg. Die CA ersetzt Let's Encrypt
// bzw. Caddy `tls internal`: Wer ihr Zertifikat als `ca` reicht, vertraut dem Blattzertifikat des Proxys.
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { generate } from 'selfsigned'
import { listening, portOf } from './api.ts'

const DEFAULT_NAMES = ['localhost', '127.0.0.1', '::1']

// ECDSA P-256 wie das Zertifikat von Mietfuchs; Laufzeit genügt für einen Testlauf
export async function createTestCa(names: string[] = DEFAULT_NAMES): Promise<{ caCert: string, leaf: { key: string, cert: string } }> {
  const notAfterDate = new Date(Date.now() + 7 * 24 * 60 * 60_000)
  const ca = await generate([{ name: 'commonName', value: 'Mietfuchs Test-CA' }], {
    keyType: 'ec', curve: 'P-256', algorithm: 'sha256', notAfterDate,
    extensions: [
      { name: 'basicConstraints', cA: true, critical: true },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    ],
  })
  const leaf = await generate([{ name: 'commonName', value: names[0] ?? 'localhost' }], {
    keyType: 'ec', curve: 'P-256', algorithm: 'sha256', notAfterDate,
    ca: { key: ca.private, cert: ca.cert },
    extensions: [
      { name: 'basicConstraints', cA: false, critical: true },
      { name: 'keyUsage', digitalSignature: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: names.map((n) => (net.isIP(n) ? { type: 7 as const, ip: n } : { type: 2 as const, value: n })) },
    ],
  })
  return { caCert: ca.cert, leaf: { key: leaf.private, cert: leaf.cert } }
}

export type TestProxy = { origin: string, port: number, requests: Array<{ method: string, path: string }>, close(): Promise<void> }

export async function startTestProxy({ target, tls, host = '127.0.0.1', forwarded = {} }: {
  target: string
  tls: { key: string, cert: string }
  host?: string
  forwarded?: { proto?: string | null, host?: string | null }
}): Promise<TestProxy> {
  const to = new URL(target)
  const requests: Array<{ method: string, path: string }> = []
  const server = https.createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
    requests.push({ method: req.method ?? 'GET', path: req.url ?? '/' })
    const headers: http.OutgoingHttpHeaders = {}
    for (const [name, value] of Object.entries(req.headers)) {
      if (name.startsWith('x-forwarded-') || name === 'connection' || name === 'keep-alive') continue
      headers[name] = value
    }
    const proto = forwarded.proto === undefined ? 'https' : forwarded.proto
    const forwardedHost = forwarded.host === undefined ? req.headers.host : forwarded.host
    if (proto !== null) headers['x-forwarded-proto'] = proto
    if (forwardedHost !== null && forwardedHost !== undefined) headers['x-forwarded-host'] = forwardedHost
    headers['x-forwarded-for'] = req.socket.remoteAddress ?? ''
    const upstream = http.request({ host: to.hostname, port: to.port, method: req.method, path: req.url, headers, agent: false }, (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers)
      answer.pipe(res)
    })
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502)
      res.end()
    })
    req.pipe(upstream)
  })
  await listening(server, host)
  const port = portOf(server)
  const shown = net.isIPv6(host) ? `[${host}]` : host
  return {
    origin: `https://${shown}:${port}`,
    port,
    requests,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections()
      server.close(() => resolve())
    }),
  }
}

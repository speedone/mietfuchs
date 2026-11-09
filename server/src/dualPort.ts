// Ein Port für HTTP und HTTPS (#528, Schritt 2). Das Programmfenster spricht einen Mietfuchs im Heimnetz über HTTPS an,
// der Browser auf demselben Rechner wie bisher über HTTP; beide auf demselben Port, damit sich an Adressen, Docker-Ports
// und Paketen nichts ändert.
//
// Der äußere Server (`net`) liest das erste Byte jeder Verbindung: `0x16` ist der Beginn eines TLS-Handshakes. Dann
// umhüllt ein `tls.TLSSocket` die Verbindung, sonst bleibt sie roh; beide gehen an **denselben** `http.Server`, also an
// denselben Handler. Das Byte kommt mit `unshift` zurück. **Nicht** `https.Server.emit('connection')`: Das scheitert
// unter Bun 1.4.4 (der Client sieht `WRONG_VERSION_NUMBER`), und Programmdatei und Linux-Pakete laufen unter Bun.
//
// Alles, was der Start mit dem Server tut (listen, close, address, Fehler), geschieht am äußeren Server.
import http from 'node:http'
import net from 'node:net'
import tls from 'node:tls'

// Wie lange eine Verbindung ohne ein einziges Byte offen bleibt. Danach greifen die Fristen des http.Server.
const FIRST_BYTE_MS = 10_000
const TLS_HANDSHAKE = 0x16

export function createDualServer(
  listener: http.RequestListener,
  pair: { key: string, cert: string } | null,
  { firstByteMs = FIRST_BYTE_MS }: { firstByteMs?: number } = {},
): { server: net.Server, http: http.Server, useCertificate: (pair: { key: string, cert: string }) => void } {
  const httpServer = http.createServer(listener)
  const contextOf = (p: { key: string, cert: string }) => tls.createSecureContext({ key: p.key, cert: p.cert })
  // Änderbar: Vor dem Binden liest der Start nur ein vorhandenes Zertifikat, ein neues entsteht erst danach (#244)
  let secureContext = pair ? contextOf(pair) : null
  const server = net.createServer({ pauseOnConnect: false }, (socket) => {
    // Abgerissene Verbindungen sind kein Fehler des Servers; danach übernimmt der http.Server die Fehler
    socket.on('error', () => socket.destroy())
    socket.setTimeout(firstByteMs, () => socket.destroy())
    socket.once('data', (chunk: Buffer) => {
      socket.setTimeout(0)
      socket.pause()
      socket.unshift(chunk)
      if (chunk[0] !== TLS_HANDSHAKE) {
        httpServer.emit('connection', socket)
        process.nextTick(() => socket.resume())
        return
      }
      // Ohne Zertifikat (Ordner nicht beschreibbar) gibt es kein HTTPS
      if (!secureContext) return void socket.destroy()
      const secure = new tls.TLSSocket(socket, { isServer: true, secureContext })
      secure.on('error', () => secure.destroy())
      httpServer.emit('connection', secure)
      process.nextTick(() => socket.resume())
    })
  })
  return { server, http: httpServer, useCertificate: (p) => { secureContext = contextOf(p) } }
}

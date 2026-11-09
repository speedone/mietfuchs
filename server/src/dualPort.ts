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

  // Eigene Frist für die Kopfzeilen, unabhängig von der Laufzeit: Bun prüft headersTimeout für übergebene Verbindungen
  // nicht (Node erst nach 'listening', siehe unten). Gestellt beim Übergeben und nach jeder Antwort (die nächste Anfrage
  // auf derselben Verbindung), gelöscht, sobald eine Anfrage mit vollständigen Kopfzeilen da ist. Unter Node greift
  // zusätzlich dessen eigene Prüfung; wer zuerst kommt, schließt.
  const headerTimers = new WeakMap<net.Socket, NodeJS.Timeout>()
  const awaitHeaders = (socket: net.Socket): void => {
    clearTimeout(headerTimers.get(socket))
    if (socket.destroyed || httpServer.headersTimeout <= 0) return
    headerTimers.set(socket, setTimeout(() => socket.destroy(), httpServer.headersTimeout))
  }
  const hand = (socket: net.Socket): void => {
    socket.once('close', () => clearTimeout(headerTimers.get(socket)))
    awaitHeaders(socket)
    httpServer.emit('connection', socket)
  }
  httpServer.on('request', (req: http.IncomingMessage, res: http.ServerResponse) => {
    clearTimeout(headerTimers.get(req.socket))
    res.once('finish', () => awaitHeaders(req.socket))
  })
  const server = net.createServer({ pauseOnConnect: false }, (socket) => {
    // Bewusst früh und dauerhaft: Ein Fehler vor dem ersten Byte (abgerissene Verbindung) wäre sonst ein unbehandelter
    // Fehler des Prozesses. Danach behandelt der http.Server die Fehler zusätzlich.
    socket.on('error', () => socket.destroy())
    // Eigene Uhr statt socket.setTimeout: Die Fristen am Socket stellt danach der http.Server (Keep-alive)
    const silent = setTimeout(() => socket.destroy(), firstByteMs)
    socket.once('close', () => clearTimeout(silent))
    socket.once('data', (chunk: Buffer) => {
      clearTimeout(silent)
      socket.pause()
      socket.unshift(chunk)
      if (chunk[0] !== TLS_HANDSHAKE) {
        hand(socket)
        process.nextTick(() => socket.resume())
        return
      }
      // Ohne Zertifikat (Ordner nicht beschreibbar) gibt es kein HTTPS
      if (!secureContext) return void socket.destroy()
      const secure = new tls.TLSSocket(socket, { isServer: true, secureContext })
      secure.on('error', () => secure.destroy())
      // Ein stockender Handshake endet nach derselben Frist, unabhängig von den Fristen des http.Server und der Laufzeit
      const handshake = setTimeout(() => secure.destroy(), firstByteMs)
      secure.once('secure', () => clearTimeout(handshake))
      secure.once('close', () => clearTimeout(handshake))
      hand(secure)
      process.nextTick(() => socket.resume())
    })
  })
  // Die Fristen des http.Server (headersTimeout, requestTimeout) prüft Node nur, nachdem der Server 'listening' gemeldet
  // hat. Der innere lauscht nie selbst; ohne das bliebe eine Verbindung mit halben Kopfzeilen für immer offen. Beim
  // Schließen des äußeren endet auch die Prüfung des inneren.
  server.on('listening', () => httpServer.emit('listening'))
  server.on('close', () => httpServer.close())
  return { server, http: httpServer, useCertificate: (p) => { secureContext = contextOf(p) } }
}

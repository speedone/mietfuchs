// HTTP-Anfragen an KI-Anbieter, ohne die feste Grenze von fetch.
//
// fetch bricht unter Node (undici) wie unter Bun ab, wenn 300 Sekunden lang keine
// Antwort-Header ankommen. Ollama schickt die Header erst mit dem ersten Token, auch beim
// Streaming. Liest ein Modell auf dem Prozessor einen mehrseitigen Scan ein, dauert das
// länger. Deshalb gilt hier nur das Zeitlimit des Aufrufers (über `signal`):
// - unter Node über node:http und node:https, die keine solche Grenze kennen,
// - unter Bun (Programmdatei) über fetch mit `timeout: false`, wie von Bun dokumentiert.
// Verbreitetes Problem, siehe ollama/ollama-js#72 und cline/cline#6549.

import http from 'node:http'
import https from 'node:https'

export type HttpOptions = {
  method?: string
  headers?: Record<string, string>
  body?: string
  signal?: AbortSignal
  timeoutMs?: number
}

// Antwort-Header sind je nach Transportweg unterschiedlich geformt (fetch liefert nur einzelne
// Werte, node:http bei manchen Feldern eine Liste), deshalb die weiteste Form für beide.
export type HttpHeaders = Record<string, string | string[] | undefined>

export type HttpResponse = {
  status: number
  ok: boolean
  headers: HttpHeaders
  body: AsyncIterable<Uint8Array>
}

// Liefert Status, Header (Namen klein geschrieben) und den Rumpf als asynchron iterierbare
// Folge von Bytes. Wirft, wenn keine Verbindung zustande kommt oder `signal` abbricht; bricht
// `signal` später ab, wirft das Lesen des Rumpfs.
export function openRequest(url: string, { method = 'GET', headers = {}, body, signal }: HttpOptions = {}): Promise<HttpResponse> {
  return globalThis.Bun ? viaFetch(url, { method, headers, body, signal }) : viaNodeHttp(url, { method, headers, body, signal })
}

async function viaFetch(url: string, { method, headers, body, signal }: HttpOptions): Promise<HttpResponse> {
  // `timeout: false` ist eine Bun-Erweiterung von fetch, die TypeScript (mit den Node-Typen)
  // nicht kennt; ansonsten unverändert die Standard-fetch-Optionen.
  const init: RequestInit & { timeout?: false } = { method, headers, body, signal, timeout: false }
  const res = await fetch(url, init)
  const empty: AsyncIterable<Uint8Array> = (async function* () {})()
  return { status: res.status, ok: res.ok, headers: Object.fromEntries(res.headers), body: res.body ?? empty }
}

function viaNodeHttp(url: string, { method, headers, body, signal }: HttpOptions): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const client = target.protocol === 'https:' ? https : http
    const req = client.request(target, { method, headers, signal }, (res) => {
      resolve({ status: res.statusCode ?? 0, ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300, headers: res.headers, body: res })
    })
    req.on('error', reject)
    req.end(body)
  })
}

// Ein API-Schlüssel darf nie in einer Meldung landen, auch nicht, wenn der Dienst oder ein
// Proxy ihn in seiner Fehlermeldung wiederholt.
export const maskSecret = (secret: string | null | undefined, text: unknown): string =>
  secret ? String(text).split(secret).join('…') : String(text)

export async function readText(body: AsyncIterable<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder()
  let text = ''
  for await (const chunk of body) text += decoder.decode(chunk, { stream: true })
  return text + decoder.decode()
}

// Zeilenweise lesen, etwa für NDJSON-Ströme. Leere Zeilen fallen weg.
export async function* readLines(body: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  let rest = ''
  for await (const chunk of body) {
    rest += decoder.decode(chunk, { stream: true })
    let end
    while ((end = rest.indexOf('\n')) >= 0) {
      const line = rest.slice(0, end).trim()
      rest = rest.slice(end + 1)
      if (line) yield line
    }
  }
  rest = (rest + decoder.decode()).trim()
  if (rest) yield rest
}

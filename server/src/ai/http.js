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

// Liefert Status, Header (Namen klein geschrieben) und den Rumpf als asynchron iterierbare
// Folge von Bytes. Wirft, wenn keine Verbindung zustande kommt oder `signal` abbricht; bricht
// `signal` später ab, wirft das Lesen des Rumpfs.
export function openRequest(url, { method = 'GET', headers = {}, body, signal } = {}) {
  return globalThis.Bun ? viaFetch(url, { method, headers, body, signal }) : viaNodeHttp(url, { method, headers, body, signal })
}

async function viaFetch(url, { method, headers, body, signal }) {
  const res = await fetch(url, { method, headers, body, signal, timeout: false })
  return { status: res.status, ok: res.ok, headers: Object.fromEntries(res.headers), body: res.body ?? (async function* () {})() }
}

function viaNodeHttp(url, { method, headers, body, signal }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const client = target.protocol === 'https:' ? https : http
    const req = client.request(target, { method, headers, signal }, (res) => {
      resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, headers: res.headers, body: res })
    })
    req.on('error', reject)
    req.end(body)
  })
}

export async function readText(body) {
  const decoder = new TextDecoder()
  let text = ''
  for await (const chunk of body) text += decoder.decode(chunk, { stream: true })
  return text + decoder.decode()
}

// Zeilenweise lesen, etwa für NDJSON-Ströme. Leere Zeilen fallen weg.
export async function* readLines(body) {
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

// Gemeinsame Helfer: Server starten (immer mit Wegwerf-Ordner, CI=1, geschlossener Update-Adresse), API-Client.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export const S = path.dirname(new URL(import.meta.url).pathname)
export const TREES = { v0131: path.join(S, 'v0131'), main: path.join(S, 'main') }

export async function startServer(tree, dataDir, port, extraEnv = {}) {
  fs.mkdirSync(dataDir, { recursive: true })
  const child = spawn(process.execPath, ['src/index.ts'], {
    cwd: path.join(TREES[tree], 'server'),
    env: {
      ...process.env,
      ...extraEnv,
      NKA_DATA_DIR: dataDir,
      NKA_PORT: String(port),
      NKA_OLLAMA_URL: 'http://127.0.0.1:9/',
      CI: '1',
      NKA_UPDATE_URL: 'http://127.0.0.1:9/',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  child.stdout.on('data', (d) => { log += d })
  child.stderr.on('data', (d) => { log += d })
  const base = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 60000
  for (;;) {
    if (child.exitCode !== null) throw new Error(`Server beendet:\n${log}`)
    try { if ((await fetch(`${base}/healthz`)).ok) break } catch { /* startet */ }
    if (Date.now() > deadline) { child.kill(); throw new Error(`Server antwortet nicht:\n${log}`) }
    await new Promise((r) => setTimeout(r, 200))
  }
  const stop = () => new Promise((resolve) => {
    if (child.exitCode !== null) return resolve(undefined)
    child.once('exit', () => resolve(undefined))
    child.kill()
  })
  return { base, stop, log: () => log, pid: child.pid }
}

export function client(base) {
  async function raw(method, urlPath, body) {
    const init = body instanceof FormData
      ? { method, body }
      : { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }
    const res = await fetch(`${base}${urlPath}`, init)
    const buf = Buffer.from(await res.arrayBuffer())
    const type = res.headers.get('content-type') ?? ''
    let json = null
    if (type.includes('json')) { try { json = JSON.parse(buf.toString('utf8')) } catch { /* */ } }
    return { status: res.status, ok: res.ok, json, buf, type }
  }
  async function call(method, urlPath, body) {
    const r = await raw(method, urlPath, body)
    if (!r.ok) {
      const err = new Error(`${method} ${urlPath}: HTTP ${r.status} ${r.buf.toString('utf8').slice(0, 600)}`)
      err.status = r.status; err.json = r.json
      throw err
    }
    return r.json ?? (r.buf.length ? r.buf.toString('utf8') : null)
  }
  return {
    raw,
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b),
    put: (p, b) => call('PUT', p, b),
    del: (p) => call('DELETE', p),
  }
}

export function textPdf(text) {
  const content = `BT /F1 11 Tf 56 790 Td (${text.replace(/[()\\]/g, '').replace(/[^\x20-\x7e]/g, '?')}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = objects.map((obj, i) => { const at = pdf.length; pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`; return at })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

// Stabil sortiertes JSON
export function stable(v) {
  if (Array.isArray(v)) return v.map(stable)
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])]))
  return v
}
export const writeJson = (file, v) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(stable(v), null, 1)) }

// Prüft Release-Dateien bei VirusTotal, bevor das Release erscheint (release.yml, Job „Ans Release anhängen“).
//
// Anlass v0.15.1: Bitdefender und sieben Scanner mit dessen Engine meldeten server.mjs und den Installer als
// GT:JS.PolinRider, HP Wolf Security legte server.mjs aus der app.asar in Quarantäne. Gefunden hat das ein Nutzer, nicht
// die CI. Seither lädt dieser Schritt die Dateien hoch (oder liest das Ergebnis, wenn VirusTotal sie schon kennt) und
// bricht ab, sobald ein Scanner „malicious“ meldet; das Release bleibt dann ein Entwurf. „suspicious“ ergibt nur eine
// Warnung.
//
//   VT_API_KEY=… node scripts/virustotal-check.mjs <Datei> [<Datei> …]
//   VT_API_KEY=… node scripts/virustotal-check.mjs --hash <sha256>:<Name> [… ]    (Nachscan ohne Download, virustotal.yml)
//
// VT_PRUEFUNG=warnen (Repo-Variable): Ein Treffer ergibt nur eine Warnung statt eines Abbruchs, für einen Fehlalarm,
// den man gemeldet und geprüft hat; danach „Re-run failed jobs“. Hinterher die Variable wieder entfernen.
//
// Ohne VT_API_KEY oder wenn VirusTotal nicht antwortet: Warnung, Exit 0. Ein Ausfall des Dienstes soll kein Release
// aufhalten, ein Treffer schon. Das kostenlose Konto erlaubt vier Anfragen je Minute; das Skript wartet entsprechend.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const API = 'https://www.virustotal.com/api/v3'
// Bis hierhin nimmt /files direkt an, größere Dateien gehen über eine eigene Upload-Adresse (bis 650 MB)
const DIRECT_LIMIT = 32 * 1024 * 1024
const PAUSE_MS = 16_000
const ANALYSIS_TIMEOUT_MS = 30 * 60_000

/**
 * Die Befunde einer Analyse: je Scanner mit „malicious“ oder „suspicious“ ein Eintrag.
 * @param {Record<string, { category?: string, result?: string | null }>} results
 * @returns {{ engine: string, category: 'malicious' | 'suspicious', result: string }[]}
 */
export function findings(results) {
  return Object.entries(results ?? {})
    .filter(([, r]) => r?.category === 'malicious' || r?.category === 'suspicious')
    .map(([engine, r]) => ({ engine, category: /** @type {'malicious' | 'suspicious'} */ (r.category), result: r.result ?? '' }))
    .sort((a, b) => a.engine.localeCompare(b.engine, 'en'))
}

/**
 * Bericht als Markdown für die Zusammenfassung des Jobs.
 * @param {{ file: string, sha256: string, stats: Record<string, number> | null, found: ReturnType<typeof findings>, error?: string }[]} checked
 */
export function report(checked) {
  const lines = ['## VirusTotal', '', '| Datei | Ergebnis | Link |', '| --- | --- | --- |']
  for (const c of checked) {
    const result = c.error ? `nicht geprüft: ${c.error}` : c.found.length ? c.found.map((f) => `${f.engine}: ${f.category} ${f.result}`).join('<br>') : `sauber (${c.stats?.undetected ?? 0} ohne Befund)`
    lines.push(`| ${path.basename(c.file)} | ${result} | [Analyse](https://www.virustotal.com/gui/file/${c.sha256}) |`)
  }
  return `${lines.join('\n')}\n`
}

const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Ein falscher oder abgelaufener Schlüssel ist ein Einrichtungsfehler, kein Ausfall des Dienstes: der Lauf wird rot
class KeyError extends Error {}

/** @param {string} key @param {string} url @param {RequestInit} [init] */
async function vt(key, url, init = {}) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { ...init, headers: { 'x-apikey': key, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(15 * 60_000) })
    // Zu viele Anfragen: kurz warten und erneut
    if (res.status === 429 && attempt < 5) {
      await sleep(60_000)
      continue
    }
    return res
  }
}

/** @param {string} key @param {string} file */
async function check(key, file) {
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  const known = await vt(key, `${API}/files/${sha256}`)
  await sleep(PAUSE_MS)
  if (known.ok) {
    const attrs = /** @type {any} */ (await known.json()).data?.attributes ?? {}
    if (attrs.last_analysis_date) {
      const found = findings(attrs.last_analysis_results)
      // Ein alter Treffer kann inzwischen behoben sein (gemeldeter Fehlalarm): dann neu analysieren statt das alte Ergebnis
      // zu übernehmen, sonst hülfe „Re-run failed jobs“ nie
      if (found.some((f) => f.category === 'malicious')) return recheck(key, sha256, file)
      return { file, sha256, stats: attrs.last_analysis_stats ?? null, found }
    }
  } else if (known.status === 401 || known.status === 403) throw new KeyError(`VirusTotal lehnt den Schlüssel ab (HTTP ${known.status})`)
  else if (known.status !== 404) throw new Error(`Abfrage HTTP ${known.status}`)

  const size = fs.statSync(file).size
  let target = `${API}/files`
  if (size > DIRECT_LIMIT) {
    const res = await vt(key, `${API}/files/upload_url`)
    if (!res.ok) throw new Error(`Upload-Adresse HTTP ${res.status}`)
    target = /** @type {any} */ (await res.json()).data
    await sleep(PAUSE_MS)
  }
  const form = new FormData()
  form.append('file', new Blob([fs.readFileSync(file)]), path.basename(file))
  const up = await vt(key, target, { method: 'POST', body: form })
  if (!up.ok) throw new Error(`Hochladen HTTP ${up.status}`)
  const id = /** @type {any} */ (await up.json()).data?.id
  if (!id) throw new Error('keine Analyse-ID')
  const until = Date.now() + ANALYSIS_TIMEOUT_MS
  for (;;) {
    await sleep(PAUSE_MS)
    const res = await vt(key, `${API}/analyses/${id}`)
    // Direkt nach dem Hochladen kennt VirusTotal die Analyse manchmal noch nicht (v0.15.2: server.mjs, HTTP 404)
    if (res.status === 404 && Date.now() < until) continue
    if (!res.ok) throw new Error(`Analyse HTTP ${res.status}`)
    const attrs = /** @type {any} */ (await res.json()).data?.attributes ?? {}
    if (attrs.status === 'completed') return { file, sha256, stats: attrs.stats ?? null, found: findings(attrs.results) }
    if (Date.now() > until) throw new Error('Analyse nicht rechtzeitig fertig')
  }
}

/**
 * Nachscan einer bekannten Datei über ihre Prüfsumme: VirusTotal analysiert sie mit dem heutigen Stand der Scanner neu,
 * ohne dass jemand sie herunterlädt (ein Download zählte auf der Website mit).
 * @param {string} key @param {string} sha256 @param {string} name
 */
async function recheck(key, sha256, name) {
  const res = await vt(key, `${API}/files/${sha256}/analyse`, { method: 'POST' })
  if (res.status === 404) throw new Error('VirusTotal kennt die Datei nicht')
  if (!res.ok) throw new Error(`Neuanalyse HTTP ${res.status}`)
  const id = /** @type {any} */ (await res.json()).data?.id
  const until = Date.now() + ANALYSIS_TIMEOUT_MS
  for (;;) {
    await sleep(PAUSE_MS)
    const a = await vt(key, `${API}/analyses/${id}`)
    if (a.status === 404 && Date.now() < until) continue
    if (!a.ok) throw new Error(`Analyse HTTP ${a.status}`)
    const attrs = /** @type {any} */ (await a.json()).data?.attributes ?? {}
    if (attrs.status === 'completed') return { file: name, sha256, stats: attrs.stats ?? null, found: findings(attrs.results) }
    if (Date.now() > until) throw new Error('Analyse nicht rechtzeitig fertig')
  }
}

async function main() {
  const args = process.argv.slice(2)
  const hashes = args[0] === '--hash' ? args.slice(1).map((a) => { const i = a.indexOf(':'); return { sha256: a.slice(0, i), name: a.slice(i + 1) } }) : null
  const files = hashes ? hashes.map((h) => h.name) : args
  if (!files.length) {
    console.error('Aufruf: node scripts/virustotal-check.mjs <Datei> [<Datei> …]')
    process.exit(2)
  }
  const key = process.env.VT_API_KEY
  if (!key) {
    console.log('::warning::VT_API_KEY fehlt; die Dateien wurden nicht bei VirusTotal geprüft.')
    return
  }
  /** @type {Parameters<typeof report>[0]} */
  const checked = []
  if (hashes?.some((h) => !/^[0-9a-f]{64}$/.test(h.sha256) || !h.name)) {
    console.error('Aufruf: --hash <sha256>:<Name> …')
    process.exit(2)
  }
  const missing = hashes ? [] : files.filter((f) => !fs.existsSync(f))
  if (missing.length) {
    console.log(`::error::Für die Prüfung bei VirusTotal fehlt ${missing.join(', ')}`)
    process.exit(1)
  }
  for (const [i, file] of files.entries()) {
    const sha256 = hashes ? hashes[i].sha256 : crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
    try {
      const c = hashes ? await recheck(key, sha256, file) : await check(key, file)
      checked.push(c)
      console.log(`${path.basename(file)}: ${c.found.length ? c.found.map((f) => `${f.engine} ${f.category} ${f.result}`).join('; ') : 'sauber'}`)
    } catch (err) {
      if (err instanceof KeyError) {
        console.log(`::error::${err.message}; Secret VT_API_KEY prüfen`)
        process.exit(1)
      }
      const error = err instanceof Error ? err.message : String(err)
      checked.push({ file, sha256, stats: null, found: [], error })
      console.log(`::warning::${path.basename(file)} nicht bei VirusTotal geprüft: ${error}`)
    }
  }
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report(checked))
  const malicious = checked.flatMap((c) => c.found.filter((f) => f.category === 'malicious').map((f) => `${path.basename(c.file)}: ${f.engine} ${f.result}`))
  for (const c of checked) for (const f of c.found.filter((x) => x.category === 'suspicious')) console.log(`::warning::${path.basename(c.file)}: ${f.engine} hält die Datei für verdächtig (${f.result})`)
  if (malicious.length && process.env.VT_PRUEFUNG === 'warnen') {
    console.log(`::warning::VirusTotal meldet Schadsoftware; VT_PRUEFUNG=warnen, deshalb nur eine Warnung:\n${malicious.join('\n')}`)
  } else if (malicious.length) {
    console.log(`::error::VirusTotal meldet Schadsoftware${hashes ? '' : ', das Release bleibt ein Entwurf'}:\n${malicious.join('\n')}`)
    process.exit(1)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()

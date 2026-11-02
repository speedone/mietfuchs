// Rechnet das Bündel des Programmfensters wie die Quellen? (#517)
//
// Im Fenster läuft der Server als eine Datei, `server/server.mjs`, gebündelt mit rolldown (package-desktop.mjs). Die
// Tests laufen dagegen alle auf den Quellen. Was das Bündeln ändern kann, sehen sie nicht: eine Abhängigkeit, die
// gebündelt anders aufgelöst wird (Bedingungen in `exports`, eine zweite Fassung eines Pakets), ein umgeschriebenes
// `import.meta.url`, die eingebetteten Migrationen statt der auf der Platte, ein Fehler des Bündlers selbst. Fiele so
// etwas in der Rechnung auf, dann beim Mieter.
//
// Deshalb: ein erfundener Bestand (perf-stock.mjs, Stufe s: ein Objekt, sechs Wohnungen, zehn Jahre, Heizanlage,
// abgeschlossene Vorjahre), zweimal kopiert, je ein Server aus den Quellen (`node server/src/index.ts`) und aus dem
// Bündel (`node <Server-Ordner>/server/server.mjs`), beide mit demselben Tag (NKA_TEST_TODAY). Dann für jedes Objekt
// und jedes Jahr Abrechnung, CSV- und JSON-Export, Anschreiben, Verbrauch, Mietkonto, Steuer, die Steuer über alle
// Objekte und die Heizkostenabrechnungen samt Anschreiben: Status, Inhaltstyp und Antwort **byteweise** gleich. Danach
// spielen beide dasselbe alte Backup mit db.json ein (Format von 0.2/0.3, wie im Praxislauf des Umzugs), das die
// Altformate und die ganze Migrationskette durchläuft, und dieselben Vergleiche laufen noch einmal.
//
// Aufruf:
//   node scripts/bundle-vergleich.mjs --bundle dist-desktop-server   (Server-Ordner aus package-desktop.mjs server)
//   node scripts/bundle-vergleich.mjs                                (bündelt selbst in einen Wegwerf-Ordner, ohne
//                                                                    client/dist; das Frontend ist eine Attrappe)
//   --stock <Ordner>  ein vorhandener Bestand aus perf-stock.mjs statt eines neuen (wird nur kopiert)
//   --out <Ordner>    Bericht als bundle-vergleich.md
//
// Jeder Server bekommt einen eigenen Wegwerf-Datenordner (unter os.tmpdir(), also TMPDIR), CI=1, NKA_UPDATE_URL auf
// einen geschlossenen Port und NKA_PORT=0. NKA_*-Angaben der eigenen Shell gelangen nicht hinein. Rückgabewert 0, wenn
// alles gleich ist, 1 bei einer Abweichung (mit Route und erster abweichender Stelle), 2 bei falschem Aufruf.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildStock } from './perf-stock.mjs'
import { stockZip } from './fenster-umzug-praxislauf.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_ENTRY = path.join(ROOT, 'server', 'src', 'index.ts')
const UPDATE_URL = 'http://127.0.0.1:9/kein-internet-im-bundle-vergleich'
// Unter so vielen Vergleichen je Runde ist etwas faul (Bestand leer, Liste der Objekte falsch gelesen): lieber rot als
// ein grüner Lauf, der nichts verglichen hat. Stufe s ergibt 97 (zwölf Jahre je sieben Routen und mehr), das alte
// Backup 33 (vier Jahre), mit getrennter Heizkostenabrechnung 37.
const MIN_ROUTES = { stock: 90, legacy: 30, heating: 34 }

const args = process.argv.slice(2)
/** @param {string} name */
const option = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

// ---------- Server ----------

/** @param {Record<string, string>} extra */
function serverEnv(extra) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('NKA_')))
  // Nach dem Rest, damit nichts davon überschrieben wird (CLAUDE.md)
  return { ...env, ...extra, NKA_PORT: '0', NKA_HOST: '127.0.0.1', CI: '1', NKA_UPDATE_URL: UPDATE_URL }
}

/**
 * Einen Server starten und auf „läuft auf …“ warten.
 * @param {string} label
 * @param {string} entry
 * @param {string} cwd
 * @param {Record<string, string>} env
 */
async function startServer(label, entry, cwd, env) {
  const child = spawn(process.execPath, [entry], { cwd, env: serverEnv(env), stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', (d) => { output += d })
  child.stderr.on('data', (d) => { output += d })
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`${label} startet nicht:\n${output.slice(-3000)}`))
    }, 120_000)
    child.stdout.on('data', () => {
      const match = output.match(/läuft auf (http:\/\/\S+)/)
      if (match) {
        clearTimeout(timer)
        resolve(match[1])
      }
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`${label} beendet beim Start (Code ${code}):\n${output.slice(-3000)}`))
    })
  })
  const stop = () => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve(undefined)
    const hard = setTimeout(() => child.kill('SIGKILL'), 10_000)
    child.once('exit', () => { clearTimeout(hard); resolve(undefined) })
    child.kill('SIGTERM')
  })
  return { label, base: /** @type {string} */ (base), stop, log: () => output }
}

/** @typedef {Awaited<ReturnType<typeof startServer>>} Server */

// ---------- Vergleich ----------

/** @param {string} base @param {string} url @returns {Promise<{ status: number, type: string, body: Buffer }>} */
async function fetchRaw(base, url) {
  const res = await fetch(`${base}${url}`, { signal: AbortSignal.timeout(60_000) })
  return { status: res.status, type: res.headers.get('content-type') ?? '', body: Buffer.from(await res.arrayBuffer()) }
}

/**
 * Wo zwei JSON-Werte zuerst auseinandergehen, als Pfad (`statements[2].rows[0].shareCents`); null, wenn gleich.
 * @param {any} a @param {any} b @param {string} [at]
 * @returns {string | null}
 */
export function firstJsonDifference(a, b, at = '') {
  if (Object.is(a, b)) return null
  const kindOf = (/** @type {any} */ v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v)
  const here = at || '(Wurzel)'
  if (kindOf(a) !== kindOf(b) || typeof a !== 'object' || a === null) {
    return `${here}: ${JSON.stringify(a)?.slice(0, 200)} ≠ ${JSON.stringify(b)?.slice(0, 200)}`
  }
  if (Array.isArray(a)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (i >= a.length || i >= b.length) return `${here}: Länge ${a.length} ≠ ${b.length}`
      const inner = firstJsonDifference(a[i], b[i], `${at}[${i}]`)
      if (inner) return inner
    }
    return null
  }
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  for (let i = 0; i < Math.max(keysA.length, keysB.length); i++) {
    if (keysA[i] !== keysB[i]) return `${here}: Schlüssel an Stelle ${i}: ${keysA[i]} ≠ ${keysB[i]}`
    const key = /** @type {string} */ (keysA[i])
    const inner = firstJsonDifference(a[key], b[key], at ? `${at}.${key}` : key)
    if (inner) return inner
  }
  return null
}

/**
 * Die erste abweichende Stelle zweier Antworten, lesbar; null, wenn byteweise gleich.
 * @param {{ status: number, type: string, body: Buffer }} a Quellen
 * @param {{ status: number, type: string, body: Buffer }} b Bündel
 * @returns {string | null}
 */
export function describeDifference(a, b) {
  if (a.status !== b.status) return `Status ${a.status} (Quellen) ≠ ${b.status} (Bündel)`
  if (a.type !== b.type) return `Inhaltstyp „${a.type}“ (Quellen) ≠ „${b.type}“ (Bündel)`
  if (a.body.equals(b.body)) return null
  let offset = 0
  while (offset < a.body.length && offset < b.body.length && a.body[offset] === b.body[offset]) offset++
  const around = (/** @type {Buffer} */ buf) => JSON.stringify(buf.subarray(Math.max(0, offset - 40), offset + 80).toString('utf8'))
  let where = ''
  if (a.type.includes('json')) {
    try {
      // Gleiche Werte in anderer Schreibweise (etwa 1.0 und 1) sind als JSON gleich, byteweise nicht
      const path = firstJsonDifference(JSON.parse(a.body.toString('utf8')), JSON.parse(b.body.toString('utf8')))
      where = `\n      erster Unterschied im JSON: ${path ?? 'keiner, nur anders geschrieben'}`
    } catch {
      // kein gültiges JSON auf einer Seite; die Bytes genügen
    }
  }
  return `ab Byte ${offset} (Länge ${a.body.length} gegen ${b.body.length})${where}\n      Quellen: ${around(a.body)}\n      Bündel:  ${around(b.body)}`
}

/**
 * Was zu vergleichen ist, aus dem Bestand gelesen (über den Server aus den Quellen): je Objekt und Jahr die Rechen-
 * und Exportrouten, je Jahr die Steuer über alle Objekte, je Heizkostenabrechnung ihre Seite und ihre Anschreiben.
 * @param {string} base
 * @param {string} today JJJJ-MM-TT
 * @returns {Promise<string[]>}
 */
async function routesOf(base, today) {
  /** @param {string} url */
  const json = async (url) => {
    const res = await fetch(`${base}${url}`)
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
    return /** @type {any} */ (await res.json())
  }
  const properties = /** @type {{ id: string }[]} */ (await json('/api/properties'))
  const currentYear = Number(today.slice(0, 4))
  /** @type {Set<number>} */
  const allYears = new Set()
  /** @type {string[]} */
  const routes = []
  for (const { id } of properties) {
    const p = encodeURIComponent(id)
    const items = /** @type {{ year: number }[]} */ (await json(`/api/costItems?property=${p}`))
    const first = Math.min(currentYear - 1, ...items.map((c) => c.year).filter(Number.isInteger))
    // Vom Jahr vor der ersten Position bis zum laufenden: auch die Ränder, an denen kaum etwas liegt
    for (let y = first - 1; y <= currentYear; y++) {
      allYears.add(y)
      routes.push(
        `/api/settlement/${y}?property=${p}`,
        `/api/settlement/${y}/export?format=csv&property=${p}`,
        `/api/settlement/${y}/export?format=json&property=${p}`,
        `/api/settlement/${y}/letters?property=${p}`,
        `/api/consumption/${y}?property=${p}`,
        `/api/rentledger/${y}?property=${p}`,
        `/api/taxreport/${y}?property=${p}`,
      )
    }
    routes.push(`/api/heating-settlements?property=${p}`)
    const heating = /** @type {{ plantId: string, period: { key: string } }[]} */ (await json(`/api/heating-settlements?property=${p}`))
    for (const h of heating) {
      const at = `${encodeURIComponent(h.plantId)}/${encodeURIComponent(h.period.key)}`
      routes.push(`/api/heating-settlement/${at}`, `/api/heating-settlement/${at}/letters`)
    }
  }
  for (const y of [...allYears].sort()) routes.push(`/api/tax/overview?year=${y}`)
  return routes
}

/**
 * Jede Route an beiden Servern, Abweichungen gesammelt.
 * @param {Server} source @param {Server} bundle @param {string[]} routes
 * @returns {Promise<{ route: string, difference: string }[]>}
 */
async function compareRoutes(source, bundle, routes) {
  /** @type {{ route: string, difference: string }[]} */
  const differences = []
  for (const route of routes) {
    const [a, b] = await Promise.all([fetchRaw(source.base, route), fetchRaw(bundle.base, route)])
    const difference = describeDifference(a, b)
    if (difference) differences.push({ route, difference })
  }
  return differences
}

// Kommen die Antworten, die zählen, überhaupt an? Ein Vergleich zweier Fehlerseiten wäre auch „gleich“.
/** @param {Server} source @param {string[]} routes */
async function failingRoutes(source, routes) {
  /** @type {string[]} */
  const failing = []
  for (const route of routes) {
    const res = await fetchRaw(source.base, route)
    if (res.status !== 200) failing.push(`${route}: HTTP ${res.status} ${res.body.toString('utf8').slice(0, 200)}`)
  }
  return failing
}

// ---------- Heizkostenabrechnung nach Weg d ----------

/**
 * Eine Gasheizung mit eigener Heizperiode (Mai bis April) und getrennter Heizkostenabrechnung ab Mai 2025, dazu eine
 * Heizkostenposition dafür: Der Bestand aus perf-stock.mjs rechnet seine Heizung in der Betriebskostenabrechnung, und
 * das alte Backup kennt keine. Auf beiden Servern dieselben Schritte; mit NKA_TEST_IDS=seq bekommt die Anlage dort
 * dieselbe Kennung. Gibt die Kennung zurück.
 * @param {Server} server
 * @returns {Promise<string>}
 */
async function setupSeparateHeating(server) {
  /** @param {string} url @param {string} method @param {unknown} body @returns {Promise<any>} */
  const send = async (url, method, body) => {
    const res = await fetch(`${server.base}${url}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const answer = await res.json().catch(() => null)
    if (!res.ok) throw new Error(`${server.label}: ${method} ${url}: HTTP ${res.status} ${JSON.stringify(answer).slice(0, 400)}`)
    return answer
  }
  const { plant } = await send('/api/heating-plants', 'POST', { energy: 'gas', method: 'service' })
  const rules = { startMonth: 5, changes: [] }
  const period = await send(`/api/heating-plants/${plant.id}/period/preview`, 'POST', { rules })
  await send(`/api/heating-plants/${plant.id}/period`, 'PUT', { rules, answers: { understood: true, token: period.token } })
  const separate = { separate: true, month: '2025-05' }
  const preview = await send(`/api/heating-plants/${plant.id}/separate/preview`, 'POST', separate)
  // Die Heizanteile der Vorauszahlungen, wie die Vorschau sie vorbelegt
  const steps = Object.fromEntries((preview.steps ?? []).map((/** @type {any} */ st) => [st.tenancyId, Object.fromEntries(st.rows.map((/** @type {any} */ r) => [r.from, r.heatingCents]))]))
  await send(`/api/heating-plants/${plant.id}/separate`, 'PUT', { ...separate, answers: { understood: true, steps, token: preview.token } })
  await send('/api/costItems', 'POST', { period: '2025-05', category: 'Heizung und Warmwasser', description: 'Gas 2025/2026', amountCents: 180001, key: 'area', heatingPlantId: plant.id, taxYear: 2026 })
  return plant.id
}

// ---------- Bündel ----------

/**
 * Den Server-Ordner nehmen oder selbst bauen. Ohne `--bundle` bündelt das Skript mit bundleServer aus
 * package-desktop.mjs (rolldown aus client/node_modules) und legt als Frontend eine Attrappe daneben: Verglichen wird
 * die API, und client/dist muss dafür nicht gebaut sein.
 * @param {string | undefined} given
 * @param {string} work
 */
async function serverFolder(given, work) {
  if (given) {
    const dir = path.resolve(given)
    if (!fs.existsSync(path.join(dir, 'server', 'server.mjs'))) {
      console.error(`${path.join(dir, 'server', 'server.mjs')} fehlt. Zuerst: npm run build && node scripts/package-desktop.mjs server`)
      process.exit(2)
    }
    return dir
  }
  const { bundleServer, packClient } = await import('./package-desktop.mjs')
  const stage = path.join(work, 'server-ordner')
  const fakeClient = path.join(work, 'client-attrappe')
  fs.mkdirSync(fakeClient, { recursive: true })
  fs.writeFileSync(path.join(fakeClient, 'index.html'), '<!doctype html><title>Mietfuchs</title>\n')
  const started = Date.now()
  const { modules } = await bundleServer(stage)
  packClient(fakeClient, stage)
  console.log(`→ selbst gebündelt: ${modules} Module in ${Date.now() - started} ms`)
  return stage
}

// ---------- Ablauf ----------

async function main() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-bundle-vergleich-'))
  /** @type {Server[]} */
  const running = []
  /** @type {string[]} */
  const report = []
  let problems = 0
  const stopAll = async () => { for (const s of running.splice(0)) await s.stop() }
  for (const sig of /** @type {const} */ (['SIGINT', 'SIGTERM'])) {
    process.once(sig, () => { stopAll().finally(() => { fs.rmSync(work, { recursive: true, force: true }); process.exit(130) }) })
  }
  try {
    const stage = await serverFolder(option('--bundle'), work)
    const bundleEntry = path.join(stage, 'server', 'server.mjs')

    let stockDir = option('--stock')
    if (!stockDir) {
      stockDir = path.join(work, 'bestand')
      console.log('→ Bestand anlegen (perf-stock.mjs, Stufe s)')
      await buildStock({ size: 's', dataDir: stockDir, log: () => {} })
    }
    const sourceData = path.join(work, 'quellen')
    const bundleData = path.join(work, 'buendel')
    fs.cpSync(stockDir, sourceData, { recursive: true })
    fs.cpSync(stockDir, bundleData, { recursive: true })

    // Ein Tag für beide, damit keine Frist um Mitternacht kippt
    const today = new Date().toISOString().slice(0, 10)
    // Fortlaufende Kennungen: Was beide nach dem Kopieren anlegen (Heizanlage unten), heißt dann gleich
    const env = { NKA_TEST_TODAY: today, NKA_TEST_IDS: 'seq' }
    const started = Date.now()
    // Nacheinander, damit ein schon laufender Server auch dann beendet wird, wenn der zweite nicht startet
    const source = await startServer('Server aus den Quellen', SOURCE_ENTRY, path.join(ROOT, 'server'), { ...env, NKA_DATA_DIR: sourceData })
    running.push(source)
    // Arbeitsordner der Server-Ordner, nicht server/ im Repo: Nichts soll zufällig aus den Quellen gelesen werden
    const bundle = await startServer('Server aus dem Bündel', bundleEntry, stage, { ...env, NKA_DATA_DIR: bundleData })
    running.push(bundle)

    /** @param {string} title @param {number} minRoutes */
    const round = async (title, minRoutes) => {
      const routes = await routesOf(source.base, today)
      const failing = await failingRoutes(source, routes)
      const differences = await compareRoutes(source, bundle, routes)
      console.log(`\n▶ ${title}: ${routes.length} Antworten verglichen`)
      if (routes.length < minRoutes) {
        problems++
        console.log(`  ✗ nur ${routes.length} Antworten, erwartet mindestens ${minRoutes}; der Bestand ist wohl nicht der erwartete`)
      }
      for (const f of failing) {
        problems++
        console.log(`  ✗ ohne Antwort aus den Quellen: ${f}`)
      }
      for (const d of differences) {
        problems++
        console.log(`  ✗ ${d.route}\n      ${d.difference}`)
      }
      if (!failing.length && !differences.length) console.log('  ✓ byteweise gleich')
      report.push(`| ${title} | ${routes.length} | ${differences.length ? `rot: ${differences.length} abweichend, zuerst ${differences[0]?.route}` : failing.length ? `rot: ${failing.length} ohne Antwort` : 'gleich'} |`)
    }

    await round('Bestand aus perf-stock.mjs (Stufe s)', MIN_ROUTES.stock)

    // Ein altes Backup mit db.json, in beide eingespielt: Altformate (legacy/migrate.ts) und die ganze
    // Migrationskette, im Bündel aus den eingebetteten Migrationen
    const zip = stockZip()
    for (const server of [source, bundle]) {
      const form = new FormData()
      form.append('file', new Blob([zip], { type: 'application/zip' }), 'mietfuchs-backup.zip')
      const res = await fetch(`${server.base}/api/restore`, { method: 'POST', body: form })
      if (res.status !== 200) {
        problems++
        console.log(`  ✗ ${server.label}: altes Backup mit db.json nicht eingespielt (HTTP ${res.status}) ${(await res.text()).slice(0, 300)}`)
      }
    }
    const settlement = /** @type {any} */ (await (await fetch(`${source.base}/api/settlement/2024`)).json())
    if (settlement?.statements?.length !== 2) {
      problems++
      console.log(`  ✗ nach dem alten Backup rechnen die Quellen keine Abrechnung 2024 mit zwei Mietern: ${JSON.stringify(settlement).slice(0, 300)}`)
    }
    await round('Altes Backup mit db.json (Format 0.2/0.3) eingespielt', MIN_ROUTES.legacy)

    const [sourcePlant, bundlePlant] = [await setupSeparateHeating(source), await setupSeparateHeating(bundle)]
    if (sourcePlant !== bundlePlant) {
      problems++
      console.log(`  ✗ die Heizanlage heißt in den Quellen ${sourcePlant}, im Bündel ${bundlePlant}; die Vergleiche unten wären wertlos`)
    }
    const heating = /** @type {any} */ (await (await fetch(`${source.base}/api/heating-settlement/${sourcePlant}/2025-05`)).json())
    if (!(heating?.statements?.length >= 1)) {
      problems++
      console.log(`  ✗ die Heizkostenabrechnung 2025/2026 hat in den Quellen keinen Mieter: ${JSON.stringify(heating).slice(0, 300)}`)
    }
    await round('Dazu eine getrennte Heizkostenabrechnung (Weg d)', MIN_ROUTES.heating)
    console.log(`\n${Date.now() - started} ms für Start, Vergleiche und Wiederherstellen`)
  } catch (err) {
    problems++
    console.log(`  ✗ abgebrochen: ${err instanceof Error ? err.stack ?? err.message : err}`)
    for (const s of running) console.log(`--- Letzte Ausgabe: ${s.label}\n${s.log().slice(-2000)}`)
  } finally {
    await stopAll()
    fs.rmSync(work, { recursive: true, force: true })
  }

  const out = option('--out')
  if (out) {
    fs.mkdirSync(out, { recursive: true })
    fs.writeFileSync(path.join(out, 'bundle-vergleich.md'), ['| Runde | Antworten | Ergebnis |', '|---|---|---|', ...report, ''].join('\n'))
  }
  console.log(problems === 0 ? '\nBündel und Quellen antworten gleich.' : `\n${problems} Befund(e).`)
  process.exit(problems === 0 ? 0 : 1)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()

// Praxislauf der Kopplung über einen Reverse Proxy (#528) mit echtem Caddy in Docker, nicht in der CI. Entwurf
// docs/superpowers/specs/2026-11-09-kopplung-proxy-design.md, Plan Task 9.
//
//   node scripts/kopplung-proxy-praxislauf.mjs [--skip-build]
//
// Baut das Image aus diesem Stand (mietfuchs:praxis), startet deploy/compose.caddy.yml unverändert samt Caddyfile mit
// einer Überlagerung in einem Wegwerf-Ordner (Image mietfuchs:praxis, NKA_PASSWORD, CI, Update-Adresse ins Leere, Caddy
// nur auf 127.0.0.1:18443) und koppelt mit `pair` aus desktop/src/pairing.js, wie das Fenster:
//   1. tls internal mit root.crt von Caddy als `ca`: `system`, danach `remoteFetch('/api/auth')` angemeldet;
//   2. ohne root.crt: der Satz mit „Stammzertifikat“;
//   3. Caddy neu erstellt mit neuer Adresse (ein Platzhalter hält die alte): nach höchstens 5 s wieder angemeldet;
//   4. gefälschte Kopfzeilen direkt an den Container mietfuchs (Port 3001, aus einem Container auf der alten Adresse
//      von Caddy): Vorabfrage `secure: false`, Geräteschlüssel 401, Beweis 400 mit `transport`;
//   5. Caddy liefert das Zertifikat von Mietfuchs aus (Volume ro): `pinned`, angemeldet;
//   6. Protokoll von Caddy auf Fehler zum Zertifikat durchsehen.
// Alles unter dem Projektnamen mfpraxis-<Zeit>; aufgeräumt wird nur dieses Projekt (`down -v`) und der Platzhalter,
// auch bei einem Fehler. Das Image bleibt für einen weiteren Lauf. Exit 0 nur, wenn alles bestanden ist.
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import https from 'node:https'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Über eine errechnete Adresse: pairing.js zieht die Typen von Electron nach, die die Prüfung der Skripte nicht kennt
/** @type {any} */
const pairing = await import(new URL('../desktop/src/pairing.js', import.meta.url).href)
const { certSha256FromPem, pair, remoteFetch, systemTrust } = pairing
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const IMAGE = 'mietfuchs:praxis'
const PORT = 18443
const ADDRESS = `https://localhost:${PORT}`
const PASSWORD = 'ein langes Praxispasswort für Caddy'
const project = `mfpraxis-${Date.now().toString(36)}`
const placeholder = `${project}-platzhalter`
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-praxis-caddy-'))

/** @type {string[]} */
const failures = []
/** @type {Record<string, unknown>} */
const report = { project }
const check = (/** @type {boolean} */ ok, /** @type {string} */ what) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${what}`)
  if (!ok) failures.push(what)
}
const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Ein Aufruf von docker, mit Frist (Vorgabe 5 Minuten, `compose up` kann ein Image laden) @param {string[]} args @param {number} [timeout] */
const docker = (args, timeout = 300_000) => execFileSync('docker', args, { cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout })
/** @param {string[]} args */
const compose = (args) => docker(['compose', '-p', project, '-f', 'compose.caddy.yml', '-f', 'praxis.yml', ...args])

/** @param {() => Promise<boolean>} condition @param {number} timeoutMs */
async function until(condition, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await condition().catch(() => false)) return true
    await sleep(250)
  }
  return false
}

/**
 * Eine Anfrage über HTTPS gegen Caddy, geprüft mit `ca`, oder über HTTP direkt an den Container
 * @param {string} url
 * @param {{ method?: string, headers?: Record<string, string>, body?: unknown, ca?: string }} [options]
 * @returns {Promise<{ status: number, headers: http.IncomingHttpHeaders, json: any }>}
 */
function request(url, { method = 'GET', headers = {}, body, ca } = {}) {
  const target = new URL(url)
  const text = body === undefined ? undefined : JSON.stringify(body)
  const options = { method, headers: { ...headers, ...(text ? { 'content-type': 'application/json' } : {}) }, timeout: 5000, ...(ca ? { ca } : {}) }
  return new Promise((resolve, reject) => {
    const req = (target.protocol === 'https:' ? https : http).request(target, options, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { data += c })
      res.on('end', () => {
        /** @type {any} */
        let json = null
        try {
          json = JSON.parse(data)
        } catch { /* keine JSON-Antwort */ }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, json })
      })
    })
    req.on('timeout', () => req.destroy(new Error('Zeitüberschreitung')))
    req.on('error', reject)
    req.end(text)
  })
}

/** Das Stammzertifikat von Caddy (tls internal), sobald Caddy es angelegt hat */
async function rootCertificate() {
  const file = path.join(work, 'root.crt')
  await until(async () => {
    const copied = spawnSync('docker', ['compose', '-p', project, '-f', 'compose.caddy.yml', '-f', 'praxis.yml', 'cp', 'caddy:/data/caddy/pki/authorities/local/root.crt', file], { cwd: work })
    return copied.status === 0 && fs.existsSync(file)
  }, 60_000)
  return fs.readFileSync(file, 'utf8')
}

/** Ein Kopplungscode über eine Sitzung, angemeldet über Caddy mit dem Passwort @param {string | undefined} ca */
async function pairingCode(ca) {
  const login = await request(`${ADDRESS}/api/auth/login`, { method: 'POST', body: { password: PASSWORD }, ca })
  const cookie = String(login.headers['set-cookie']?.[0] ?? '').split(';')[0] ?? ''
  const answer = await request(`${ADDRESS}/api/auth/pairing`, { method: 'POST', headers: { cookie, origin: ADDRESS }, body: {}, ca })
  if (answer.status !== 200 || typeof answer.json?.code !== 'string') throw new Error(`kein Code (Anmeldung ${login.status}, Code ${answer.status} ${JSON.stringify(answer.json)})`)
  return /** @type {string} */ (answer.json.code)
}

/** Die Adresse eines Containers im Netz des Projekts @param {string} service */
const containerIp = (service) => docker(['inspect', '-f', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', compose(['ps', '-q', service]).trim()]).trim()

/** Die Überlagerung: eigenes Image, Prüfangaben, Caddy nur auf diesem Rechner @param {boolean} ownCertificate */
function writeOverlay(ownCertificate) {
  fs.writeFileSync(path.join(work, 'praxis.yml'), [
    'services:',
    '  mietfuchs:',
    `    image: ${IMAGE}`,
    '    environment:',
    `      NKA_PASSWORD: "${PASSWORD}"`,
    '      NKA_UPDATE_URL: http://127.0.0.1:9/kein-internet-im-test',
    '      CI: "1"',
    '  caddy:',
    '    ports: !override',
    `      - "127.0.0.1:${PORT}:443"`,
    ...(ownCertificate ? ['    volumes: !override', '      - ./Caddyfile:/etc/caddy/Caddyfile:ro', '      - caddy-data:/data', '      - caddy-config:/config', '      - mietfuchs-data:/mietfuchs:ro'] : []),
    '',
  ].join('\n'))
}

// Aufräumen nur dieses Projekts, einmal: am Ende, bei einem Fehler und bei Strg+C oder SIGTERM
let cleaned = false
function cleanup() {
  if (cleaned) return
  cleaned = true
  spawnSync('docker', ['rm', '-f', placeholder, `${project}-faelscher`], { stdio: 'ignore', timeout: 60_000 })
  if (fs.existsSync(path.join(work, 'praxis.yml'))) {
    const logs = spawnSync('docker', ['compose', '-p', project, '-f', 'compose.caddy.yml', '-f', 'praxis.yml', 'logs', '--no-color'], { cwd: work, encoding: 'utf8', timeout: 60_000 })
    fs.writeFileSync(path.join(os.tmpdir(), `${project}.log`), logs.stdout ?? '')
    spawnSync('docker', ['compose', '-p', project, '-f', 'compose.caddy.yml', '-f', 'praxis.yml', 'down', '-v', '--remove-orphans'], { cwd: work, stdio: 'ignore', timeout: 120_000 })
  }
  fs.rmSync(work, { recursive: true, force: true })
}
for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM'])) {
  process.on(signal, () => {
    console.log(`\n${signal}: räume ${project} auf …`)
    cleanup()
    process.exit(130)
  })
}

try {
  if (!process.argv.includes('--skip-build')) {
    console.log(`Baue ${IMAGE} …`)
    execFileSync('docker', ['build', '-t', IMAGE, '.'], { cwd: root, stdio: 'inherit' })
  }
  fs.copyFileSync(path.join(root, 'deploy', 'compose.caddy.yml'), path.join(work, 'compose.caddy.yml'))
  fs.copyFileSync(path.join(root, 'deploy', 'Caddyfile'), path.join(work, 'Caddyfile'))
  // Dieselbe Angabe für Caddy und NKA_ALLOWED_HOSTS, wie in der Anleitung über .env
  fs.writeFileSync(path.join(work, '.env'), 'MIETFUCHS_HOSTS=localhost, 127.0.0.1\n')
  writeOverlay(false)
  const config = compose(['config'])
  check(/NKA_TRUST_PROXY: caddy/.test(config) && /NKA_ALLOWED_HOSTS: localhost, 127\.0\.0\.1/.test(config), 'compose.caddy.yml setzt NKA_TRUST_PROXY: caddy und NKA_ALLOWED_HOSTS aus MIETFUCHS_HOSTS')
  compose(['up', '-d'])

  // ---------- 1. tls internal mit root.crt: system ----------
  const rootPem = await rootCertificate()
  const ca = [...systemTrust(), rootPem]
  check(await until(async () => (await request(`${ADDRESS}/healthz`, { ca: rootPem })).json?.app === 'mietfuchs', 90_000), 'Mietfuchs antwortet über Caddy')
  const first = /** @type {any} */ (await pair({ address: ADDRESS, code: await pairingCode(rootPem), name: 'praxislauf', ca }))
  report.system = { trust: first.trust, certSha256: first.certSha256, origin: first.origin, problem: first.problem }
  check(first.trust === 'system' && first.certSha256 === null && first.origin === ADDRESS, `tls internal mit root.crt: system (${JSON.stringify(report.system)})`)
  const signedIn = async () => (/** @type {any} */ (JSON.parse((await remoteFetch(first, '/api/auth', { ca, timeoutMs: 2000 })).body)))?.signedIn === true
  check(first.trust === 'system' && await signedIn(), 'tls internal: remoteFetch(/api/auth) angemeldet')

  // ---------- 2. ohne root.crt: Satz mit Stammzertifikat ----------
  const foreign = /** @type {any} */ (await pair({ address: ADDRESS, code: await pairingCode(rootPem), name: 'praxislauf-fremd', ca: systemTrust() }))
  report.foreign = foreign
  check(typeof foreign.problem === 'string' && foreign.problem.includes('Stammzertifikat') && foreign.field === 'address', `ohne root.crt: ${foreign.problem}`)

  // ---------- 3. Caddy neu erstellt mit neuer Adresse ----------
  const oldIp = containerIp('caddy')
  const network = docker(['inspect', '-f', '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}', compose(['ps', '-q', 'caddy']).trim()]).trim()
  compose(['stop', 'caddy'])
  // Der Platzhalter hält die alte Adresse, damit der neue Caddy sicher eine andere bekommt
  docker(['run', '-d', '--rm', '--name', placeholder, '--network', network, '--ip', oldIp, '--entrypoint', 'sleep', 'caddy:2', '600'])
  compose(['up', '-d', '--force-recreate', 'caddy'])
  const newIp = containerIp('caddy')
  check(await until(async () => (await request(`${ADDRESS}/healthz`, { ca: rootPem })).status > 0, 60_000), 'Caddy neu erstellt und erreichbar')
  const reachable = Date.now()
  const again = await until(signedIn, 5_000)
  const seconds = (Date.now() - reachable) / 1000
  report.recreate = { oldIp, newIp, seconds }
  check(oldIp !== newIp && again, `neuer Caddy (${oldIp} → ${newIp}): nach ${seconds} s wieder angemeldet (höchstens 5 s)`)

  // ---------- 4. Fälschung direkt am Container ----------
  // Aus einem eigenen Container im Netz des Projekts, auf der alten Adresse von Caddy (ein Gerät, das nicht Caddy
  // ist und einmal Caddy war): Rootless Docker erreicht die Adressen der Container vom Rechner aus nicht, und so sieht
  // Mietfuchs einen fremden Peer statt des Gateways. Erst den Platzhalter entfernen, dann diese Adresse übernehmen.
  docker(['rm', '-f', placeholder])
  const forgery = `
    const base = 'http://mietfuchs:3001'
    const forged = { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'localhost:${PORT}', 'content-type': 'application/json' }
    const read = async (r) => ({ status: r.status, json: await r.json().catch(() => null) })
    const limit = () => AbortSignal.timeout(10000)
    const preflight = await read(await fetch(base + '/api/auth/pair', { headers: forged, signal: limit() }))
    const keyed = await read(await fetch(base + '/api/settings', { headers: { ...forged, 'x-mietfuchs-device': process.env.DEVICE }, signal: limit() }))
    const proof = await read(await fetch(base + '/api/auth/pair', { method: 'POST', headers: forged, body: JSON.stringify({ name: 'faelschung', proof: '0'.repeat(64) }), signal: limit() }))
    console.log(JSON.stringify({ preflight, keyed, proof }))
  `
  /** @type {any} */
  const forged = JSON.parse(docker(['run', '--rm', '--name', `${project}-faelscher`, '--network', network, '--ip', oldIp, '-e', `DEVICE=${first.deviceId}.${first.deviceKey}`, '--entrypoint', 'node', IMAGE, '--input-type=module', '-e', forgery], 90_000).trim().split('\n').at(-1) ?? 'null')
  report.forged = { preflight: forged?.preflight, keyed: forged?.keyed?.status, proof: forged?.proof }
  check(forged?.preflight?.json?.secure === false && forged?.preflight?.json?.origin === null, `gefälscht direkt (von ${oldIp}): Vorabfrage secure ${forged?.preflight?.json?.secure}, origin ${forged?.preflight?.json?.origin}`)
  check(forged?.keyed?.status === 401, `gefälscht direkt: Geräteschlüssel über HTTP ergibt ${forged?.keyed?.status}`)
  check(forged?.proof?.status === 400 && forged?.proof?.json?.transport === true, `gefälscht direkt: Beweis ${forged?.proof?.status}, transport ${forged?.proof?.json?.transport}`)

  // ---------- 5. Caddy liefert das Zertifikat von Mietfuchs aus: pinned ----------
  const caddyfile = fs.readFileSync(path.join(work, 'Caddyfile'), 'utf8')
  fs.writeFileSync(path.join(work, 'Caddyfile'), caddyfile.replace(/^\ttls internal$/m, '\ttls /mietfuchs/tls/mietfuchs.crt /mietfuchs/tls/mietfuchs.key'))
  writeOverlay(true)
  compose(['up', '-d', '--force-recreate', 'caddy'])
  // Das Zertifikat von Mietfuchs, wie Caddy es liest; die Sitzung für den Code vertraut genau ihm
  /** @type {string} */
  let ownCert = ''
  await until(async () => {
    ownCert = spawnSync('docker', ['compose', '-p', project, '-f', 'compose.caddy.yml', '-f', 'praxis.yml', 'exec', '-T', 'caddy', 'cat', '/mietfuchs/tls/mietfuchs.crt'], { cwd: work, encoding: 'utf8' }).stdout ?? ''
    return ownCert.includes('BEGIN CERTIFICATE') && (await request(`${ADDRESS}/healthz`, { ca: ownCert })).json?.app === 'mietfuchs'
  }, 60_000)
  // Der neu erstellte Caddy hat wieder eine neue Adresse; Mietfuchs löst `caddy` höchstens alle 5 s neu auf (eben erst
  // für die Fälschung), so lange gilt er noch nicht (Review Focus 7)
  const recreated = Date.now()
  const secure = await until(async () => (await request(`${ADDRESS}/api/auth/pair`, { ca: ownCert })).json?.secure === true, 10_000)
  report.recreateOwn = { ip: containerIp('caddy'), seconds: (Date.now() - recreated) / 1000 }
  check(secure, `Caddy mit dem Zertifikat von Mietfuchs (${containerIp('caddy')}) gilt nach ${(Date.now() - recreated) / 1000} s`)
  const pinned = /** @type {any} */ (await pair({ address: ADDRESS, code: await pairingCode(ownCert), name: 'praxislauf-pinned', ca: systemTrust() }))
  report.pinned = { trust: pinned.trust, certSha256: pinned.certSha256, problem: pinned.problem }
  check(pinned?.trust === 'pinned' && pinned?.certSha256 === certSha256FromPem(ownCert), `Zertifikat von Mietfuchs über Caddy: pinned (${JSON.stringify(report.pinned)})`)
  check(pinned?.trust === 'pinned' && (/** @type {any} */ (JSON.parse((await remoteFetch(pinned, '/api/auth', { timeoutMs: 2000 })).body)))?.signedIn === true, 'pinned über Caddy: remoteFetch(/api/auth) angemeldet')

  // ---------- 6. Protokoll von Caddy ----------
  const logs = compose(['logs', '--no-color', 'caddy'])
  const certErrors = logs.split('\n').filter((line) => /"level":"error"/.test(line) && /cert|tls|x509|key/i.test(line))
  report.caddyCertErrors = certErrors
  check(certErrors.length === 0, `Caddy: ${certErrors.length} Fehler zum Zertifikat im Protokoll${certErrors.length ? `:\n${certErrors.join('\n')}` : ''}`)
} catch (err) {
  check(false, `Abbruch: ${err instanceof Error ? err.stack : String(err)}`)
} finally {
  cleanup()
}

report.failures = failures
console.log(JSON.stringify(report, null, 2))
console.log(failures.length ? `\n${failures.length} Prüfung(en) fehlgeschlagen.` : '\nAlle Prüfungen bestanden.')
process.exit(failures.length ? 1 : 0)

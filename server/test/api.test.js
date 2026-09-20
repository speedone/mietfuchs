// Integrationstests gegen den echten Server: startet ihn als eigenen Prozess mit
// NKA_DATA_DIR auf einem Wegwerf-Ordner, damit weder eine vorhandene db.json noch die
// Belege im Arbeitsverzeichnis berührt werden. Geprüft wird, was die Engine-Tests nicht
// sehen: dass die generischen CRUD-Routen die neuen Felder durchlassen, dass die
// Löschkaskade aufräumt und dass die Abrechnungs-Routen liefern, was das Frontend erwartet.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Startet eine Server-Instanz auf einem eigenen Datenordner und wartet auf Bereitschaft.
async function startServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
  return startServerIn(dataDir)
}

// Liest die Adresse aus der Startmeldung „Mietfuchs-Server läuft auf …“. Wirft, wenn der Prozess
// vorher endet oder die Meldung ausbleibt. Die Ausgabe wird danach weiter gelesen, sonst liefe
// der Puffer der Pipe voll und der Server bliebe beim nächsten console.log hängen.
function readStartUrl(child, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    let output = ''
    let found = false
    const timer = setTimeout(() => reject(new Error(`Server ist nicht gestartet: ${output}`)), timeoutMs)
    child.stdout.on('data', (chunk) => {
      if (found) return
      output += chunk
      const match = output.match(/läuft auf (http:\/\/\S+)/)
      if (!match) return
      found = true
      clearTimeout(timer)
      resolve(match[1])
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`Server hat sich beendet (Code ${code}): ${output}`))
    })
  })
}

// `env` ergänzt oder überschreibt Umgebungsvariablen. NKA_UPDATE_URL zeigt standardmäßig ins
// Leere (Port 9 nimmt keine Verbindung an): Kein Test darf versehentlich das echte GitHub fragen.
// Die KI-Variablen aus der Shell des Entwicklers gelten nicht: Leere Werte zählen als nicht
// gesetzt, und eine leere Kandidatenliste schaltet die Suche nach Ollama ab.
//
// Den Port vergibt das System (NKA_PORT=0). Ein selbst gewählter Zufallsport lag im Bereich,
// aus dem Linux auch den nachgebauten Diensten der Tests Ports gibt, und traf gelegentlich einen
// belegten.
async function startServerIn(dataDir, env = {}) {
  const child = spawn(process.execPath, ['src/index.ts'], {
    cwd: serverRoot,
    env: {
      ...process.env,
      NKA_UPDATE_URL: 'http://127.0.0.1:9/kein-internet-im-test',
      NKA_OLLAMA_URL: '',
      NKA_OLLAMA_MODEL: '',
      NKA_OLLAMA_NUM_CTX: '',
      NKA_OLLAMA_CANDIDATES: '',
      NKA_AI_TIMEOUT: '',
      NKA_AI_PROVIDER: '',
      NKA_AI_URL: '',
      NKA_AI_MODEL: '',
      NKA_AI_API_KEY: '',
      NKA_AI_API_KEY_FILE: '',
      NKA_AI_MAX_TOKENS: '',
      NKA_RUNTIME: '',
      ...env,
      NKA_PORT: '0',
      NKA_DATA_DIR: dataDir,
    },
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const stop = () => {
    child.kill()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
  let base
  try {
    base = await readStartUrl(child)
  } catch (err) {
    stop() // sonst hielte der verwaiste Prozess den Testlauf für immer offen
    throw err
  }
  const api = async (urlPath, init) => {
    const res = await fetch(`${base}${urlPath}`, {
      ...init,
      headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    })
    if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${urlPath} → ${res.status}`)
    return res.json()
  }
  // Sicherung: der Server muss wirklich im Wegwerf-Ordner arbeiten, sonst nichts weiter tun.
  if (!fs.existsSync(path.join(dataDir, 'uploads'))) {
    stop()
    assert.fail('NKA_DATA_DIR wird nicht beachtet')
  }
  return { api, base, dataDir, stop, child }
}

let srv

before(async () => {
  srv = await startServer()
})

after(() => srv?.stop())

test('Healthcheck: /healthz antwortet als JSON mit Status ok', async () => {
  // Antwortete hier die index.html, stünde die Route hinter dem Frontend-Catch-All — dann
  // meldete ein kaputter Container HTTP 200.
  const report = await srv.api('/healthz')
  assert.equal(report.status, 'ok')
  assert.equal(report.checks.data.ok, true)
  assert.equal(report.checks.uploads.ok, true)
})

// ---------- Start aus dem Startmenü (#45) ----------

// Wartet, bis der Prozess endet, und liefert den Code. Wirft nach der Wartezeit.
const waitForExit = (child, timeoutMs = 15000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Der Prozess hat sich nicht beendet')), timeoutMs)
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
  })

// Startet den Server, ohne auf die Startmeldung zu warten, und sammelt seine Ausgabe. Für die
// Fälle, in denen der Start gerade nicht gelingen soll.
function startServerRaw(dataDir, env = {}) {
  const child = spawn(process.execPath, ['src/index.ts'], {
    cwd: serverRoot,
    env: { ...process.env, NKA_UPDATE_URL: 'http://127.0.0.1:9/kein-internet-im-test', NKA_DATA_DIR: dataDir, CI: 'true', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (c) => { output += c })
  child.stderr.on('data', (c) => { output += c })
  return { child, out: () => output }
}

test('Healthcheck: /healthz nennt Mietfuchs beim Namen', async () => {
  // Daran erkennt ein zweiter Start, dass auf dem Port schon Mietfuchs läuft
  assert.equal((await srv.api('/healthz')).app, 'mietfuchs')
})

test('Beenden: im npm-Betrieb gibt es die Route nicht', async () => {
  // Dort beendet die Umgebung den Dienst, und ein Neustart käme von selbst
  const res = await fetch(`${srv.base}/api/quit`, { method: 'POST' })
  assert.equal(res.status, 404)
  assert.match((await res.json()).error, /Programmdatei/)
})

test('Beenden: als Programmdatei antwortet Mietfuchs erst und endet dann', async () => {
  const s = await startServerIn(fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-')), { NKA_RUNTIME: 'binary' })
  try {
    // Erst die Bestätigung, dann das Ende: Sonst sähe der Browser einen Verbindungsabbruch
    assert.deepEqual(await s.api('/api/quit', { method: 'POST' }), { ok: true })
    assert.equal(await waitForExit(s.child), 0)
  } finally {
    s.stop()
  }
})

test('Belegter Port: läuft dort schon Mietfuchs, endet der zweite Start ohne Fehler', async () => {
  // Ein zweiter Klick im Startmenü ist kein Fehler. Der zweite Start öffnet nur die Oberfläche
  // (hier mit CI=true unterdrückt) und beendet sich.
  const port = new URL(srv.base).port
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
  const zweiter = startServerRaw(dataDir, { NKA_PORT: port, NKA_RUNTIME: 'binary' })
  try {
    assert.equal(await waitForExit(zweiter.child), 0)
    assert.match(zweiter.out(), /läuft bereits/)
  } finally {
    zweiter.child.kill()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})

test('Belegter Port: sitzt dort etwas anderes, bleibt es bei der Fehlermeldung', async () => {
  const fremder = http.createServer((req, res) => res.end('nicht Mietfuchs'))
  // Auf allen Adressen lauschen, nicht nur auf 127.0.0.1: Windows lässt sonst eine zweite
  // Bindung an 0.0.0.0 auf demselben Port zu, und der Port wäre gar nicht belegt.
  await new Promise((r) => fremder.listen(0, r))
  const port = String(fremder.address().port)
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
  const start = startServerRaw(dataDir, { NKA_PORT: port, NKA_RUNTIME: 'binary' })
  try {
    // Die Programmdatei lässt die Meldung zehn Sekunden stehen, bevor sie endet. Geprüft wird
    // deshalb die Meldung, nicht das Ende.
    const deadline = Date.now() + 15000
    while (!/bereits belegt/.test(start.out()) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100))
    assert.match(start.out(), /bereits belegt/)
  } finally {
    start.child.kill()
    fremder.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})

// Dieselbe Falle wie bei PUT /api/settings, hier in den generischen CRUD-Routen: express.json()
// lässt auch eine Liste als Rumpf durch. Deren Indizes landeten als Schlüssel „0“, „1“ … im
// Datensatz und blieben in der db.json stehen. Geprüft an /api/units, die Routen entstehen für
// alle sechs Collections in derselben Schleife.
test('Anlegen: ein Rumpf, der kein Objekt ist, legt keine Indizes als Felder an', async () => {
  const res = await fetch(`${srv.base}/api/units`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(['unsinn', 'noch mehr']),
  })
  assert.equal(res.status, 201)
  const created = await res.json()
  try {
    // Zuerst die Platte: Der Schaden bestand im dauerhaften Speichern
    const stored = JSON.parse(fs.readFileSync(path.join(srv.dataDir, 'db.json'), 'utf8'))
    assert.equal(stored.units.find((u) => u.id === created.id)['0'], undefined)
    assert.equal(created['0'], undefined)
    assert.equal((await srv.api('/api/units')).find((u) => u.id === created.id)['0'], undefined)
  } finally {
    await srv.api(`/api/units/${created.id}`, { method: 'DELETE' })
  }
})

test('Ändern: ein Rumpf, der kein Objekt ist, lässt den Datensatz unangetastet', async () => {
  const unit = await srv.api('/api/units', {
    method: 'POST',
    body: JSON.stringify({ name: 'Rumpfprobe', areaM2: 50, participates: true }),
  })
  try {
    const res = await fetch(`${srv.base}/api/units/${unit.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(['unsinn', 'noch mehr']),
    })
    assert.equal(res.status, 200)
    const updated = await res.json()
    // Zuerst die Platte: Der Schaden bestand im dauerhaften Speichern
    const stored = JSON.parse(fs.readFileSync(path.join(srv.dataDir, 'db.json'), 'utf8')).units.find((u) => u.id === unit.id)
    assert.equal(stored['0'], undefined)
    assert.equal(stored.name, 'Rumpfprobe')
    assert.equal(updated['0'], undefined)
    assert.equal(updated.name, 'Rumpfprobe')
  } finally {
    await srv.api(`/api/units/${unit.id}`, { method: 'DELETE' })
  }
})

test('Wohnungen: Eigennutzungs-Felder überleben Anlegen und Ändern', async () => {
  const unit = await srv.api('/api/units', {
    method: 'POST',
    body: JSON.stringify({ name: 'EG', areaM2: 80, participates: false, selfUsed: true, selfPersons: 2 }),
  })
  assert.equal(unit.selfUsed, true)
  assert.equal(unit.selfPersons, 2)
  const updated = await srv.api(`/api/units/${unit.id}`, {
    method: 'PUT',
    body: JSON.stringify({ name: 'EG', areaM2: 80, participates: true, selfUsed: false, selfPersons: null }),
  })
  assert.equal(updated.selfUsed, false)
  assert.equal(updated.selfPersons, null)
  await srv.api(`/api/units/${unit.id}`, { method: 'DELETE' })
})

test('Abrechnung: Eigenanteil kommt über die Route beim Frontend an', async () => {
  const selfUsedUnit = await srv.api('/api/units', {
    method: 'POST',
    body: JSON.stringify({ name: 'EG', areaM2: 80, participates: false, selfUsed: true, selfPersons: 2 }),
  })
  const rentedUnit = await srv.api('/api/units', {
    method: 'POST',
    body: JSON.stringify({ name: 'OG', areaM2: 150, participates: true }),
  })
  const tenancy = await srv.api('/api/tenancies', {
    method: 'POST',
    body: JSON.stringify({
      unitId: rentedUnit.id, tenantName: 'Familie A', start: '2020-01-01', end: null,
      personHistory: [{ from: '2020-01-01', persons: 2 }], prepayments: [], baseRents: [], prepaymentOverrides: {},
    }),
  })
  const costItem = await srv.api('/api/costItems', {
    method: 'POST',
    body: JSON.stringify({ year: 2031, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 230000, key: 'area' }),
  })

  const s = await srv.api('/api/settlement/2031')
  assert.equal(s.statements[0].totalShareCents, 150000) // 150 von 230 m²
  assert.equal(s.landlord.totalCents, 80000)
  assert.equal(s.selfUsedShareCents, 80000)

  const tax = await srv.api('/api/taxreport/2031')
  assert.equal(tax.selfUsedShareCents, 80000)
  assert.equal(tax.selfOccupiedExists, true)

  await srv.api(`/api/costItems/${costItem.id}`, { method: 'DELETE' })
  await srv.api(`/api/tenancies/${tenancy.id}`, { method: 'DELETE' })
  await srv.api(`/api/units/${selfUsedUnit.id}`, { method: 'DELETE' })
  await srv.api(`/api/units/${rentedUnit.id}`, { method: 'DELETE' })
})

test('Löschen einer Wohnung entfernt ihren vereinbarten Prozentanteil', async () => {
  const a = await srv.api('/api/units', { method: 'POST', body: JSON.stringify({ name: 'A', areaM2: 50, participates: true }) })
  const b = await srv.api('/api/units', { method: 'POST', body: JSON.stringify({ name: 'B', areaM2: 50, participates: true }) })
  const item = await srv.api('/api/costItems', {
    method: 'POST',
    body: JSON.stringify({
      year: 2032, category: 'Sonstige Betriebskosten', description: 'Vereinbart',
      amountCents: 100000, key: 'custom', customShares: { [a.id]: 40, [b.id]: 60 },
    }),
  })
  await srv.api(`/api/units/${b.id}`, { method: 'DELETE' })
  const items = await srv.api('/api/costItems')
  const itemAfter = items.find((x) => x.id === item.id)
  assert.deepEqual(Object.keys(itemAfter.customShares), [a.id], 'Anteil der gelöschten Wohnung bleibt zurück')

  await srv.api(`/api/costItems/${item.id}`, { method: 'DELETE' })
  await srv.api(`/api/units/${a.id}`, { method: 'DELETE' })
})

test('Standardmodell: eine neue Installation nutzt qwen3.5:4b', async () => {
  assert.equal((await srv.api('/api/settings')).ollamaModel, 'qwen3.5:4b')
})

test('Standardmodell: das frühere, nie vorhandene qwen3.6-35b wird umgestellt, andere Modelle bleiben', async () => {
  // „qwen3.6-35b“ gab es in der Ollama-Bibliothek nie (gemeint war qwen3.6:35b), wer es nicht
  // geändert hat, konnte also gar nicht auswerten. Eine eigene Wahl bleibt unangetastet.
  for (const [stored, expected] of [['qwen3.6-35b', 'qwen3.5:4b'], ['gemma4:12b', 'gemma4:12b']]) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-alt-'))
    fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ settings: { ollamaModel: stored } }))
    const s = await startServerIn(dataDir)
    try {
      assert.equal((await s.api('/api/settings')).ollamaModel, expected, stored)
    } finally {
      s.stop()
    }
  }
})

test('Vor dieser Version eingefrorene Abrechnung liefert einen Eigenanteil von 0', async () => {
  // Altbestand nachbauen: ein Snapshot, der das Feld noch nicht kennt. Die Route muss die
  // in types.ts zugesagte Form trotzdem einhalten, sonst rechnet das Frontend mit undefined.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-alt-'))
  fs.writeFileSync(
    path.join(dataDir, 'db.json'),
    JSON.stringify({
      settings: {}, units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [],
      closedSettlements: [
        {
          id: 'alt', year: 2030, closedAt: '2031-01-05', sentAt: null,
          settlement: { year: 2030, daysInYear: 365, statements: [], landlord: { rows: [], totalCents: 0 }, totalCostsCents: 0, warnings: [] },
        },
      ],
    }),
  )
  const legacyServer = await startServerIn(dataDir)
  try {
    const s = await legacyServer.api('/api/settlement/2030')
    assert.equal(s.selfUsedShareCents, 0)
    assert.equal(s.closed.closedAt, '2031-01-05')
  } finally {
    legacyServer.stop()
  }
})

// ---------- Update-Hinweis ----------
// Ein nachgebauter GitHub-Server liefert die echte Antwort der Releases-API, umgeschrieben auf
// eine neuere Version. Er zählt mit, damit sich belegen lässt, dass ohne Zustimmung nichts
// hinausgeht.

const serverVersion = JSON.parse(fs.readFileSync(path.join(serverRoot, 'package.json'), 'utf8')).version
const releaseJson = fs
  .readFileSync(path.join(serverRoot, 'test', 'fixtures', 'github-release-latest.json'), 'utf8')
  .replaceAll(JSON.parse(fs.readFileSync(path.join(serverRoot, 'test', 'fixtures', 'github-release-latest.json'), 'utf8')).tag_name, 'v9.9.9')

async function fakeGitHub() {
  const http = await import('node:http')
  const requests = []
  const server = http.createServer((req, res) => {
    requests.push(req.url)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(releaseJson)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${server.address().port}/repos/speedone/mietfuchs/releases/latest`
  return { url, requests, stop: () => server.close() }
}

async function withUpdateServer(env, fn) {
  const github = await fakeGitHub()
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-update-'))
  const s = await startServerIn(dataDir, { NKA_UPDATE_URL: github.url, ...env })
  try {
    await fn(s, github)
  } finally {
    s.stop()
    github.stop()
  }
}

test('Update-Hinweis: ohne Zustimmung fragt der Server GitHub nicht', async () => {
  await withUpdateServer({}, async (s, github) => {
    const status = await s.api('/api/update')
    assert.equal(status.enabled, false)
    assert.equal(status.available, false)
    // auch „Jetzt prüfen" darf ohne Zustimmung nichts anfragen
    await s.api('/api/update/check', { method: 'POST', body: '{}' })
    await s.api('/api/settings', { method: 'PUT', body: JSON.stringify({ updateCheck: 'off' }) })
    await s.api('/api/update')
    assert.equal(github.requests.length, 0)
  })
})

test('Update-Hinweis: mit Zustimmung meldet der Server die neue Version', async () => {
  await withUpdateServer({}, async (s, github) => {
    await s.api('/api/settings', { method: 'PUT', body: JSON.stringify({ updateCheck: 'on' }) })
    const status = await s.api('/api/update')
    assert.equal(github.requests.length, 1)
    assert.equal(status.enabled, true)
    assert.equal(status.current, serverVersion)
    assert.equal(status.latest, '9.9.9')
    assert.equal(status.available, true)
    assert.equal(status.mode, 'npm') // der Test startet den Server mit node, ohne Programmdatei
    assert.equal(status.releaseUrl, 'https://github.com/speedone/mietfuchs/releases/tag/v9.9.9')
    // Bis zum nächsten Tag kommt das gemerkte Ergebnis. „Jetzt prüfen" fragt neu, aber höchstens
    // einmal pro Minute; wann genau, prüft update.test.js mit gestellter Uhr.
    await s.api('/api/update')
    assert.equal(github.requests.length, 1)
    const rechecked = await s.api('/api/update/check', { method: 'POST', body: '{}' })
    assert.equal(github.requests.length, 1)
    assert.equal(rechecked.latest, '9.9.9')
  })
})

test('Update-Hinweis: im Docker-Container lautet die Betriebsart docker', async () => {
  await withUpdateServer({ NKA_RUNTIME: 'docker' }, async (s) => {
    await s.api('/api/settings', { method: 'PUT', body: JSON.stringify({ updateCheck: 'on' }) })
    const status = await s.api('/api/update')
    assert.equal(status.mode, 'docker')
    assert.equal(status.downloadUrl, null)
  })
})

test('Version: /healthz und der Update-Hinweis nennen die Version aus package.json', async () => {
  const report = await srv.api('/healthz')
  const status = await srv.api('/api/update')
  assert.equal(report.version, serverVersion)
  assert.equal(status.current, serverVersion)
})

// ---------- KI-Auswertung: Text und Seitenbilder kommen aus dem Browser (#21) ----------
// Der Server öffnet keine PDFs mehr selbst. Ollama ersetzt ein lokaler Server, der jede
// Anfrage mitschreibt und eine feste Antwort liefert.

const LONG_TEXT =
  'Stadtwerke Musterstadt, Rechnung Nr. 4711 vom 15.03.2026. Frischwasser 12,50 EUR, Schmutzwasser 8,20 EUR. Gesamt 20,70 EUR.'

// Antwortet wie Ollama 0.34: /api/tags listet die Modelle, /api/show nennt ihre Fähigkeiten,
// und ein unbekanntes Modell ergibt 404. Ohne `capabilities` verhält es sich wie eine ältere
// Ollama-Version, die das Feld noch nicht kennt. /api/chat streamt standardmäßig zeilenweise
// JSON (NDJSON), die letzte Zeile trägt `done: true`, den Grund und die Kennzahlen.
//
// `chat` schaltet Störungen der Auswertung: 'hang' schickt nie etwas, 'hangAfterFirstChunk'
// verstummt nach dem ersten Stück, 'length' endet am Kontextende mit halbem JSON, 'error'
// schickt mitten im Strom eine Fehlerzeile, 'rejectThinkOff' lehnt `think: false` ab wie
// manche Modelle bei Ollama Cloud. Mit `key` verlangt der Dienst diesen Bearer-Schlüssel und
// antwortet sonst mit 401. `closedEarly` zählt Chat-Anfragen, deren Verbindung Mietfuchs vor
// dem Ende getrennt hat. `garbledShow` lässt /api/show mit einer nicht lesbaren Antwort
// antworten, die den Schlüssel enthält (Befund aus der Codeprüfung: readJson gab ihn ungeprüft
// weiter).
async function fakeOllama({ models = [{ name: 'test:latest', capabilities: ['completion', 'vision'] }], chat = 'normal', key = null, echoKey = false, garbledShow = false } = {}) {
  const http = await import('node:http')
  const requests = []
  const open = new Set()
  const state = { closedEarly: 0 }
  // Steuert den nachgebauten Dienst während eines Tests, etwa für den Abbruch beim Laden
  const control = { pullHangs: false }
  const findModel = (name = '') => models.find((m) => m.name === (name.includes(':') ? name : `${name}:latest`))
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (d) => { body += d })
    req.on('end', () => {
      const json = body ? JSON.parse(body) : {}
      requests.push({ url: req.url, body: json, headers: req.headers })
      const send = (status, data) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(data))
      }
      const notFound = () => send(404, { error: `model '${json.model}' not found` })
      if (req.url === '/api/version') return send(200, { version: '0.34.2' })
      if (key && req.headers.authorization !== `Bearer ${key}`) return send(401, { error: 'unauthorized' })
      if (echoKey) return send(400, { error: `Proxy lehnt ab: ${req.headers.authorization}` })
      if (req.url === '/api/tags') {
        return send(200, { models: models.map(({ capabilities, ...m }) => ({ size: 1000, ...m })) })
      }
      // Wie Ollama beim Laden eines Modells: zeilenweise JSON mit Schritt und Fortschritt.
      // `pullHangs` bleibt nach der ersten Zeile still, für den Abbruch.
      if (req.url === '/api/pull') {
        res.writeHead(200, { 'content-type': 'application/x-ndjson' })
        open.add(res)
        res.on('close', () => { open.delete(res); if (!res.writableFinished) state.closedEarly++ })
        const line = (obj) => res.write(`${JSON.stringify(obj)}\n`)
        line({ status: 'pulling manifest' })
        if (control.pullHangs) return
        line({ status: 'pulling 4b2c1f', digest: '4b2c1f', total: 3_600_000_000, completed: 1_800_000_000 })
        line({ status: 'success' })
        return res.end()
      }
      if (req.url === '/api/show') {
        if (garbledShow) {
          res.writeHead(200, { 'content-type': 'text/plain' })
          return res.end(`kaputt: ${req.headers.authorization}`)
        }
        const m = findModel(json.model)
        return m ? send(200, { capabilities: m.capabilities, remote_host: m.remote_host }) : notFound()
      }
      if (!findModel(json.model)) return notFound()
      // Eine Rechnung mit Nettopositionen und dem Lohnanteil als Gesamtbetrag (#34)
      if (chat === 'netto' && !json.format?.properties?.categories) {
        const netto = {
          vendor: 'Schornsteinfegerei Muster',
          totalGrossEur: 101.86,
          positionsAreNet: true,
          vatRatePercent: 19,
          labor35aTotalEur: 90.56,
          positions: [
            { description: 'Feuerstättenschau', category: 'Schornsteinfeger', amountEur: 28.7 },
            { description: 'Kehren der Abgasleitung', category: 'Schornsteinfeger', amountEur: 24.8 },
            { description: 'Abgaswegeüberprüfung', category: 'Schornsteinfeger', amountEur: 22.6 },
            { description: 'Fahrtkostenpauschale', category: 'Schornsteinfeger', amountEur: 9.5 },
          ],
        }
        res.writeHead(200, { 'content-type': 'application/x-ndjson' })
        res.write(`${JSON.stringify({ message: { role: 'assistant', content: JSON.stringify(netto) }, done: false })}\n`)
        return res.end(`${JSON.stringify({ message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 10, eval_count: 5 })}\n`)
      }
      if (chat === 'rejectThinkOff' && json.think === false) {
        return send(400, { error: `think value "false" is not supported for "${json.model}"` })
      }
      // Den zweiten Durchgang (nur Kategorien) erkennt man am Schema
      const content = JSON.stringify(
        json.format?.properties?.categories
          ? { categories: ['Wasser/Abwasser'] }
          : {
              vendor: 'Stadtwerke Musterstadt',
              positions: [{ description: 'Frischwasser', category: 'Wasser/Abwasser', amountEur: 12.5 }],
              totalGrossEur: 12.5,
            },
      )
      const final = {
        message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop',
        total_duration: 3_000_000_000, load_duration: 500_000_000,
        prompt_eval_count: 812, prompt_eval_duration: 1_500_000_000, eval_count: 64, eval_duration: 1_000_000_000,
      }
      if (json.stream === false) return send(200, { ...final, message: { role: 'assistant', content } })

      open.add(res)
      res.on('close', () => {
        open.delete(res)
        if (!res.writableFinished) state.closedEarly++
      })
      if (chat === 'hang') return
      res.writeHead(200, { 'content-type': 'application/x-ndjson' })
      const line = (obj) => res.write(`${JSON.stringify(obj)}\n`)
      const piece = (text) => ({ message: { role: 'assistant', content: text }, done: false })
      const third = Math.ceil(content.length / 3)
      line(piece(content.slice(0, third)))
      if (chat === 'hangAfterFirstChunk') return
      if (chat === 'error') {
        line({ error: 'model runner has unexpectedly stopped' })
        return res.end()
      }
      if (chat === 'length') {
        line({ ...final, done_reason: 'length' })
        return res.end()
      }
      line(piece(content.slice(third, 2 * third)))
      line(piece(content.slice(2 * third)))
      line(final)
      res.end()
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    control,
    get closedEarly() { return state.closedEarly },
    stop: () => {
      for (const res of open) res.destroy()
      server.close()
    },
  }
}

async function withOllama(fn, { models, model = 'test', chat, env = {} } = {}) {
  const ollama = await fakeOllama({ models, chat })
  const s = await startServerIn(fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-')), env)
  try {
    await s.api('/api/settings', { method: 'PUT', body: JSON.stringify({ ollamaUrl: ollama.url, ollamaModel: model }) })
    await fn(s, ollama)
  } finally {
    s.stop()
    ollama.stop()
  }
}

// Der Inhalt des PDFs spielt keine Rolle mehr: Der Server liest es nicht, er legt es nur ab.
const PDF = Buffer.from('%PDF-1.4\n%Mietfuchs-Test\n')
const page = (n) => new Blob([Buffer.from(`JPEG-Seite-${n}`)], { type: 'image/jpeg' })
const base64 = (n) => Buffer.from(`JPEG-Seite-${n}`).toString('base64')

async function uploadPdf(s, route, { text, pages = [] } = {}) {
  const fd = new FormData()
  fd.append('file', new Blob([PDF], { type: 'application/pdf' }), 'rechnung.pdf')
  if (text !== undefined) fd.append('pdfText', text)
  pages.forEach((b, i) => fd.append('pages', b, `seite-${i + 1}.jpg`))
  const res = await fetch(`${s.base}${route}`, { method: 'POST', body: fd })
  return { status: res.status, body: await res.json() }
}

const chatRequests = (ollama) => ollama.requests.filter((a) => a.url === '/api/chat')
const firstMessage = (ollama) => chatRequests(ollama)[0].body.messages[0]

test('KI-Auswertung: PDF mit Textebene geht als Text an Ollama, ohne Bilder', async () => {
  await withOllama(async (s, ollama) => {
    const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT, pages: [page(1)] })
    assert.equal(r.status, 200)
    assert.equal(r.body.extraction.vendor, 'Stadtwerke Musterstadt')
    const m = firstMessage(ollama)
    assert.match(m.content, /RECHNUNGSTEXT/)
    assert.ok(m.content.includes(LONG_TEXT))
    assert.equal(m.images, undefined) // brauchbarer Text hat Vorrang vor Bildern
  })
})

test('KI-Auswertung: Scan ohne Textebene geht mit den Seitenbildern aus dem Browser an Ollama', async () => {
  await withOllama(async (s, ollama) => {
    const r = await uploadPdf(s, '/api/extract', { text: 'kurz', pages: [page(1), page(2)] })
    assert.equal(r.status, 200)
    const m = firstMessage(ollama)
    assert.deepEqual(m.images, [base64(1), base64(2)])
    assert.doesNotMatch(m.content, /RECHNUNGSTEXT/)
  })
})

test('KI-Auswertung: ohne Text und ohne Seitenbilder eine klare Meldung, Ollama wird nicht gefragt', async () => {
  await withOllama(async (s, ollama) => {
    const r = await uploadPdf(s, '/api/extract')
    assert.equal(r.status, 502)
    assert.match(r.body.error, /Oberfläche/)
    assert.equal(chatRequests(ollama).length, 0)
  })
})

test('KI-Auswertung: Seitenbilder landen nicht im Belegarchiv', async () => {
  await withOllama(async (s) => {
    const uploadsBefore = (await s.api('/api/uploads')).length
    await uploadPdf(s, '/api/extract', { pages: [page(1), page(2), page(3)] })
    const uploadsAfter = await s.api('/api/uploads')
    assert.equal(uploadsAfter.length, uploadsBefore + 1)
    assert.match(uploadsAfter.map((u) => u.file).join(' '), /rechnung\.pdf/)
  })
})

test('KI-Auswertung: mehr als vier Seitenbilder lehnt der Server ab, ohne Reste im Archiv', async () => {
  await withOllama(async (s, ollama) => {
    const uploadsBefore = (await s.api('/api/uploads')).length
    const r = await uploadPdf(s, '/api/extract', { pages: [1, 2, 3, 4, 5].map(page) })
    assert.equal(r.status, 400)
    assert.match(r.body.error, /Höchstens 4 Seitenbilder/)
    assert.equal(chatRequests(ollama).length, 0)
    assert.equal((await s.api('/api/uploads')).length, uploadsBefore)
  })
})

test('KI-Auswertung: der Schuhkarton nimmt auch die Textebene', async () => {
  await withOllama(async (s, ollama) => {
    const r = await uploadPdf(s, '/api/intake', { text: LONG_TEXT })
    assert.equal(r.status, 200)
    assert.ok(firstMessage(ollama).content.includes(LONG_TEXT))
  })
})

test('KI-Auswertung: nur Bilder zählen als Seitenbilder', async () => {
  await withOllama(async (s, ollama) => {
    const notAnImage = new Blob([Buffer.from('<script>')], { type: 'text/html' })
    const r = await uploadPdf(s, '/api/extract', { pages: [page(1), notAnImage] })
    assert.equal(r.status, 200)
    assert.deepEqual(firstMessage(ollama).images, [base64(1)])
  })
})

test('KI-Auswertung: ein Seitenbild über 5 MB wird abgelehnt, ohne Reste im Archiv', async () => {
  await withOllama(async (s, ollama) => {
    const huge = new Blob([Buffer.alloc(5 * 1024 * 1024 + 1)], { type: 'image/jpeg' })
    const r = await uploadPdf(s, '/api/extract', { pages: [huge] })
    assert.equal(r.status, 400)
    assert.match(r.body.error, /Seitenbild ist größer als 5 MB/)
    assert.equal(chatRequests(ollama).length, 0)
    assert.equal((await s.api('/api/uploads')).length, 0)
  })
})

test('KI-Auswertung: ein überlanger Text ergibt eine lesbare Meldung', async () => {
  await withOllama(async (s) => {
    const r = await uploadPdf(s, '/api/extract', { text: 'x'.repeat(1024 * 1024 + 1) })
    assert.equal(r.status, 400)
    assert.match(r.body.error, /Textfeld ist zu lang/)
    assert.equal((await s.api('/api/uploads')).length, 0)
  })
})

test('KI-Auswertung: ein Foto geht wie bisher als Bild an Ollama', async () => {
  await withOllama(async (s, ollama) => {
    const photo = Buffer.from('JPEG-Foto')
    const fd = new FormData()
    fd.append('file', new Blob([photo], { type: 'image/jpeg' }), 'rechnung.jpg')
    const res = await fetch(`${s.base}/api/extract`, { method: 'POST', body: fd })
    assert.equal(res.status, 200)
    assert.deepEqual(firstMessage(ollama).images, [photo.toString('base64')])
  })
})

test('Beleg anhängen: /api/upload legt die Datei ins Belegarchiv, sie ist abrufbar', async () => {
  const s = await startServer()
  try {
    const fd = new FormData()
    fd.append('file', new Blob([PDF], { type: 'application/pdf' }), 'Beleg Müll 2025.pdf')
    const res = await fetch(`${s.base}/api/upload`, { method: 'POST', body: fd })
    assert.equal(res.status, 200)
    const { file } = await res.json()
    assert.match(file, /^\d+_Beleg_Müll_2025\.pdf$/)
    assert.deepEqual((await s.api('/api/uploads')).map((u) => u.file), [file])
    const download = await fetch(`${s.base}/uploads/${encodeURIComponent(file)}`)
    assert.equal(download.status, 200)
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), PDF)
  } finally {
    s.stop()
  }
})

test('Beleg anhängen: Umlaute in zerlegter Unicode-Form (macOS) werden zusammengesetzt', async () => {
  const s = await startServer()
  try {
    const fd = new FormData()
    fd.append('file', new Blob([PDF], { type: 'application/pdf' }), 'Müll.pdf') // „ü“ als u + Trema
    const { file } = await (await fetch(`${s.base}/api/upload`, { method: 'POST', body: fd })).json()
    assert.match(file, /^\d+_Müll\.pdf$/)
  } finally {
    s.stop()
  }
})

test('Hochladen: ein abgebrochener Upload ergibt JSON statt einer HTML-Fehlerseite', async () => {
  const s = await startServer()
  try {
    const res = await fetch(`${s.base}/api/upload`, {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=grenze' },
      body: '--grenze\r\nContent-Disposition: form-data; name="file"; filename="a.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-abgebrochen',
    })
    assert.ok(res.status >= 400)
    assert.match(res.headers.get('content-type') ?? '', /json/)
    assert.equal(typeof (await res.json()).error, 'string')
  } finally {
    s.stop()
  }
})

test('Hochladen: eine zu große Datei ergibt eine lesbare Meldung statt einer HTML-Seite', async () => {
  const s = await startServer()
  try {
    const fd = new FormData()
    fd.append('file', new Blob([Buffer.alloc(25 * 1024 * 1024 + 1)], { type: 'application/pdf' }), 'riesig.pdf')
    const res = await fetch(`${s.base}/api/upload`, { method: 'POST', body: fd })
    assert.equal(res.status, 400)
    assert.match((await res.json()).error, /größer als 25 MB/)
    assert.equal((await s.api('/api/uploads')).length, 0)
  } finally {
    s.stop()
  }
})

test('KI-Auswertung: der Schuhkarton (/api/intake) nimmt die Seitenbilder ebenso', async () => {
  await withOllama(async (s, ollama) => {
    const r = await uploadPdf(s, '/api/intake', { pages: [page(1)] })
    assert.equal(r.status, 200)
    assert.equal(r.body.kind, 'rechnung')
    assert.deepEqual(firstMessage(ollama).images, [base64(1)])
  })
})

// ---------- Ollama per Umgebungsvariable (#17) ----------
// Im Container oder bei zentraler Einrichtung legt der Betreiber Adresse und Modell fest.
// Die Einstellungen zeigen sie dann an, überschreiben sie aber nicht.

async function withEnv(env, fn) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
  const s = await startServerIn(dataDir, env)
  try {
    await fn(s)
  } finally {
    s.stop()
  }
}

const storedSettings = (s) =>
  JSON.parse(fs.readFileSync(path.join(s.dataDir, 'db.json'), 'utf8')).settings

test('Ollama: NKA_OLLAMA_URL und NKA_OLLAMA_MODEL gelten und sind als fest markiert', async () => {
  await withEnv({ NKA_OLLAMA_URL: 'http://ki.intern:11434', NKA_OLLAMA_MODEL: 'env-modell:4b' }, async (s) => {
    const settings = await s.api('/api/settings')
    assert.equal(settings.ollamaUrl, 'http://ki.intern:11434')
    assert.equal(settings.ollamaModel, 'env-modell:4b')
    // Die alten Namen für Tabs von vor dem Update, dazu die Pfade der KI-Einstellungen
    assert.deepEqual(settings.fixedByEnv, ['ollamaUrl', 'ollamaModel', 'ai.text.url', 'ai.text.model'])
    assert.equal(settings.ai.text.url, 'http://ki.intern:11434')
    assert.equal(settings.ai.text.model, 'env-modell:4b')
  })
})

test('Ollama: Speichern lässt fest vorgegebene Werte unberührt, alles andere wird gespeichert', async () => {
  await withEnv({ NKA_OLLAMA_URL: 'http://ki.intern:11434' }, async (s) => {
    const response = await s.api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ ollamaUrl: 'http://anders:11434', ollamaModel: 'eigenes:2b', landlordName: 'Vermieterin', fixedByEnv: [] }),
    })
    assert.equal(response.ollamaUrl, 'http://ki.intern:11434')
    assert.deepEqual(response.fixedByEnv, ['ollamaUrl', 'ai.text.url'])
    const stored = storedSettings(s)
    assert.equal(stored.ollamaUrl, 'http://localhost:11434') // Standard bleibt, Env landet nicht in der db.json
    assert.equal(stored.ai.text.url, 'http://localhost:11434')
    assert.equal(stored.ollamaModel, 'eigenes:2b')
    assert.equal(stored.ai.text.model, 'eigenes:2b')
    assert.equal(stored.landlordName, 'Vermieterin')
    assert.equal(stored.fixedByEnv, undefined)
  })
})

test('Ollama: Variablen aus der Shell des Entwicklers erreichen die Test-Server nicht', async () => {
  // Wer NKA_OLLAMA_URL für sein eigenes Ollama gesetzt hat, soll keine Testbelege dorthin schicken
  const saved = { url: process.env.NKA_OLLAMA_URL, candidates: process.env.NKA_OLLAMA_CANDIDATES }
  process.env.NKA_OLLAMA_URL = 'http://aus-der-shell.invalid:11434'
  process.env.NKA_OLLAMA_CANDIDATES = 'http://aus-der-shell.invalid:11434'
  try {
    const s = await startServer()
    try {
      const settings = await s.api('/api/settings')
      assert.deepEqual(settings.fixedByEnv, [])
      assert.equal(settings.ollamaUrl, 'http://localhost:11434')
    } finally {
      s.stop()
    }
  } finally {
    for (const [key, name] of [['url', 'NKA_OLLAMA_URL'], ['candidates', 'NKA_OLLAMA_CANDIDATES']]) {
      if (saved[key] === undefined) delete process.env[name]
      else process.env[name] = saved[key]
    }
  }
})

test('Ollama: leere Umgebungsvariablen zählen als nicht gesetzt', async () => {
  await withEnv({ NKA_OLLAMA_URL: '', NKA_OLLAMA_MODEL: '  ' }, async (s) => {
    const settings = await s.api('/api/settings')
    assert.deepEqual(settings.fixedByEnv, [])
    assert.equal(settings.ollamaUrl, 'http://localhost:11434')
  })
})

test('Ollama: die Auswertung nutzt Adresse und Modell aus der Umgebung', async () => {
  const ollama = await fakeOllama({ models: [{ name: 'env-modell:4b', capabilities: ['completion'] }] })
  try {
    await withEnv({ NKA_OLLAMA_URL: ollama.url, NKA_OLLAMA_MODEL: 'env-modell:4b' }, async (s) => {
      await s.api('/api/settings', { method: 'PUT', body: JSON.stringify({ ollamaModel: 'db-modell' }) })
      const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
      assert.equal(r.status, 200)
      assert.equal(chatRequests(ollama)[0].body.model, 'env-modell:4b')
    })
  } finally {
    ollama.stop()
  }
})

// ---------- Ollama: Kontext und Nachdenken (#17) ----------
// Ohne Angabe nimmt Ollama auf den meisten Rechnern 4096 Token Kontext und kürzt längere
// Anfragen stillschweigend. Neuere Modelle denken außerdem standardmäßig erst lange nach,
// was auf dem Prozessor Minuten kostet. Beides legt Mietfuchs deshalb selbst fest.

const chatOptions = (ollama) => chatRequests(ollama).map((a) => ({ think: a.body.think, ...a.body.options }))

test('Ollama: jede Anfrage setzt festen Kontext, Temperatur 0 und schaltet das Nachdenken ab', async () => {
  await withOllama(async (s, ollama) => {
    await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    await uploadPdf(s, '/api/extract', { pages: [page(1)] })
    const options = chatOptions(ollama)
    assert.ok(options.length >= 3) // Auswertung und Kategorien-Durchgang
    // Gleiche Werte in allen Anfragen, sonst lädt Ollama das Modell jedes Mal neu
    for (const o of options) assert.deepEqual(o, { think: false, temperature: 0, num_ctx: 16384 })
  })
})

// Ungültige Werte verhindern den Start (siehe „fehlerhafte Schlüssel-Variablen“ weiter unten)
test('Ollama: NKA_OLLAMA_NUM_CTX ändert die Kontextgröße', async () => {
  const ollama = await fakeOllama()
  try {
    await withEnv({ NKA_OLLAMA_URL: ollama.url, NKA_OLLAMA_MODEL: 'test', NKA_OLLAMA_NUM_CTX: '8192' }, async (s) => {
      await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
      assert.equal(chatOptions(ollama)[0].num_ctx, 8192)
      assert.ok((await s.api('/api/settings')).fixedByEnv.includes('ai.numCtx'))
    })
  } finally {
    ollama.stop()
  }
})

// ---------- Ollama: Streaming, Zeitlimit und Abbruch (#17) ----------
// Ohne Streaming schickt Ollama die Antwort-Header erst mit der fertigen Antwort, und fetch
// bricht unter Node wie unter Bun nach 300 Sekunden ohne Header ab. Mietfuchs streamt deshalb
// und spricht Ollama ohne diese Grenze an. Es gilt nur das eigene Zeitlimit, und das soll als
// solches gemeldet werden, nicht als „nicht erreichbar“.

const until = async (condition, ms = 5000) => {
  const end = Date.now() + ms
  while (!condition()) {
    if (Date.now() > end) return false
    await new Promise((r) => setTimeout(r, 50))
  }
  return true
}

test('Ollama: die Antwort kommt als Strom und wird zusammengesetzt', async () => {
  await withOllama(async (s, ollama) => {
    const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.equal(r.status, 200)
    assert.equal(r.body.extraction.vendor, 'Stadtwerke Musterstadt')
    assert.equal(r.body.extraction.positions[0].category, 'Wasser/Abwasser')
    assert.ok(chatRequests(ollama).every((a) => a.body.stream === true))
  })
})

test('Ollama: die Antwort nennt Kennzahlen je Schritt', async () => {
  await withOllama(async (s) => {
    const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    const expected = { promptTokens: 812, outputTokens: 64, seconds: 3, loadSeconds: 0.5 }
    assert.deepEqual(r.body.stats, [
      { step: 'extraction', ...expected },
      { step: 'classification', ...expected },
    ])
  })
})

test('Ollama: das Zeitlimit greift vor der ersten Antwort und heißt auch so (NKA_AI_TIMEOUT)', async () => {
  await withOllama(async (s) => {
    const start = Date.now()
    const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.equal(r.status, 502)
    assert.match(r.body.error, /nicht innerhalb von 2 Sekunden geantwortet/)
    assert.ok(Date.now() - start < 15000, 'das Zeitlimit wurde nicht eingehalten')
  }, { chat: 'hang', env: { NKA_AI_TIMEOUT: '2' } })
})

test('Ollama: verstummt Ollama mitten im Strom, greift ebenfalls das Zeitlimit', async () => {
  await withOllama(async (s) => {
    const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.equal(r.status, 502)
    assert.match(r.body.error, /nicht innerhalb von 2 Sekunden geantwortet/)
  }, { chat: 'hangAfterFirstChunk', env: { NKA_AI_TIMEOUT: '2' } })
})

test('Ollama: eine am Kontextende abgeschnittene Antwort ergibt eine klare Meldung', async () => {
  await withOllama(async (s) => {
    const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.equal(r.status, 502)
    assert.match(r.body.error, /abgeschnitten/)
    assert.match(r.body.error, /Kontext von 16384 Token.*unter „Erweitert“/)
  }, { chat: 'length' })
})

test('Ollama: ein Fehler mitten im Strom kommt lesbar an', async () => {
  await withOllama(async (s) => {
    const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.equal(r.status, 502)
    assert.match(r.body.error, /Ollama meldet einen Fehler: model runner has unexpectedly stopped/)
  }, { chat: 'error' })
})

test('Ollama: bricht der Browser ab, bricht Mietfuchs die Anfrage an Ollama ab', async () => {
  await withOllama(async (s, ollama) => {
    const controller = new AbortController()
    const fd = new FormData()
    fd.append('file', new Blob([PDF], { type: 'application/pdf' }), 'rechnung.pdf')
    fd.append('pdfText', LONG_TEXT)
    const upload = fetch(`${s.base}/api/extract`, { method: 'POST', body: fd, signal: controller.signal }).catch((e) => e)
    assert.ok(await until(() => chatRequests(ollama).length > 0), 'Ollama wurde nicht gefragt')
    controller.abort()
    assert.equal((await upload).name, 'AbortError')
    assert.ok(await until(() => ollama.closedEarly > 0), 'die Anfrage an Ollama lief weiter')
    // Auf den abgebrochenen Beleg verweist nichts, er soll nicht im Archiv liegen bleiben
    assert.deepEqual(await s.api('/api/uploads'), [])
  }, { chat: 'hang' })
})

// Dass der Browser die Verbindung schließt, kommt nicht überall bei Express an (Bun 1.3, Proxys).
// Deshalb gibt der Browser jeder Auswertung eine Kennung mit und bricht über sie ab.
test('Abbrechen per Kennung: stoppt Ollama und entfernt den Beleg, auch bei offener Verbindung', async () => {
  await withOllama(async (s, ollama) => {
    const requestId = '0123456789abcdef0123456789abcdef'
    const fd = new FormData()
    fd.append('file', new Blob([PDF], { type: 'application/pdf' }), 'rechnung.pdf')
    fd.append('pdfText', LONG_TEXT)
    fd.append('requestId', requestId)
    const pending = fetch(`${s.base}/api/extract`, { method: 'POST', body: fd, headers: { accept: 'application/x-ndjson' } }).then((r) => r.text())
    assert.ok(await until(() => chatRequests(ollama).length > 0), 'Ollama wurde nicht gefragt')
    const cancel = await fetch(`${s.base}/api/ai/cancel/${requestId}`, { method: 'POST' })
    assert.equal(cancel.status, 200)
    assert.ok(await until(() => ollama.closedEarly > 0), 'die Anfrage an Ollama lief weiter')
    assert.deepEqual(await s.api('/api/uploads'), [])
    await pending // der Strom endet, statt offen zu hängen
    // Danach ist die Kennung verbraucht
    assert.equal((await fetch(`${s.base}/api/ai/cancel/${requestId}`, { method: 'POST' })).status, 404)
  }, { chat: 'hang' })
})

test('Abbrechen per Kennung: unbekannte oder ungültige Kennungen ergeben 404', async () => {
  for (const id of ['ffffffffffffffffffffffffffffffff', 'kurz', '../../etc']) {
    const res = await fetch(`${srv.base}/api/ai/cancel/${encodeURIComponent(id)}`, { method: 'POST' })
    assert.equal(res.status, 404, id)
    assert.match((await res.json()).error, /Keine laufende Auswertung/)
  }
})

// ---------- KI-Auswertung als Strom zum Browser (#17) ----------
// Firefox wartet höchstens 300 Sekunden auf die Antwort-Header (network.http.response.timeout).
// Fordert der Browser mit Accept: application/x-ndjson an, schickt Mietfuchs die Header sofort,
// danach Fortschritt, Lebenszeichen und zuletzt Ergebnis oder Fehler, je eine JSON-Zeile.

async function uploadStreaming(s, route, { text, signal } = {}) {
  const fd = new FormData()
  fd.append('file', new Blob([PDF], { type: 'application/pdf' }), 'rechnung.pdf')
  if (text !== undefined) fd.append('pdfText', text)
  const res = await fetch(`${s.base}${route}`, { method: 'POST', body: fd, headers: { accept: 'application/x-ndjson' }, signal })
  return res
}
const linesOf = async (res) => (await res.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l))

test('Strom: Fortschritt je Schritt und am Ende das Ergebnis wie bisher', async () => {
  await withOllama(async (s) => {
    const res = await uploadStreaming(s, '/api/extract', { text: LONG_TEXT })
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type'), /application\/x-ndjson/)
    const lines = await linesOf(res)
    const result = lines.at(-1)
    assert.equal(result.type, 'result')
    assert.equal(result.data.extraction.vendor, 'Stadtwerke Musterstadt')
    assert.match(result.data.file, /rechnung\.pdf$/)
    const progress = lines.filter((l) => l.type === 'progress').map((l) => `${l.step}:${l.phase}`)
    assert.ok(progress.includes('extraction:waiting'), progress.join(' '))
    assert.ok(progress.includes('extraction:writing'), progress.join(' '))
    assert.ok(progress.includes('classification:waiting'), progress.join(' '))
    const writing = lines.find((l) => l.phase === 'writing')
    assert.ok(writing.chars > 0)
  })
})

test('Strom: ein Fehler kommt als letzte Zeile, samt Beleg', async () => {
  await withOllama(async (s) => {
    const res = await uploadStreaming(s, '/api/extract', { text: LONG_TEXT })
    assert.equal(res.status, 200)
    const last = (await linesOf(res)).at(-1)
    assert.equal(last.type, 'error')
    assert.match(last.error, /nicht installiert/)
    assert.match(last.file, /rechnung\.pdf$/)
  }, { model: 'fehlt:4b' })
})

test('Strom: die Header kommen sofort, auch wenn das Modell noch schweigt, danach Lebenszeichen', async () => {
  await withOllama(async (s) => {
    const start = Date.now()
    const res = await uploadStreaming(s, '/api/extract', { text: LONG_TEXT })
    assert.ok(Date.now() - start < 3000, 'die Header kamen erst mit der Antwort')
    const lines = await linesOf(res)
    assert.ok(lines.some((l) => l.type === 'heartbeat'), 'kein Lebenszeichen während des Wartens')
    assert.match(lines.at(-1).error, /nicht innerhalb von 12 Sekunden/)
  }, { chat: 'hang', env: { NKA_AI_TIMEOUT: '12' } })
})

test('Strom: der Schuhkarton (/api/intake) streamt ebenso', async () => {
  await withOllama(async (s) => {
    const lines = await linesOf(await uploadStreaming(s, '/api/intake', { text: LONG_TEXT }))
    assert.equal(lines.at(-1).type, 'result')
    assert.equal(lines.at(-1).data.kind, 'rechnung')
  })
})

// ---------- Ollama: Modellauswahl und verständliche Fehler (#17) ----------

const UNREACHABLE = 'http://127.0.0.1:9' // Port 9 nimmt keine Verbindung an

test('Ollama: die Modellliste nennt Größe, Bildverständnis und Cloud-Modelle, Embedding-Modelle fehlen', async () => {
  const models = [
    { name: 'bild:4b', size: 3400000000, capabilities: ['completion', 'vision', 'thinking'] },
    { name: 'text:8b', size: 5000000000, capabilities: ['completion', 'tools'] },
    { name: 'gross:120b-cloud', size: 384, remote_host: 'https://ollama.com:443', capabilities: ['completion'] },
    { name: 'alt:7b', size: 4100000000 }, // ältere Ollama-Version ohne capabilities
    { name: 'einbettung:latest', size: 270000000, capabilities: ['embedding'] },
  ]
  await withOllama(async (s) => {
    const status = await s.api('/api/ollama/status')
    assert.equal(status.ok, true)
    assert.deepEqual(status.modelDetails, [
      { name: 'bild:4b', sizeBytes: 3400000000, vision: true, remote: false },
      { name: 'text:8b', sizeBytes: 5000000000, vision: false, remote: false },
      { name: 'gross:120b-cloud', sizeBytes: 384, vision: false, remote: true },
      { name: 'alt:7b', sizeBytes: 4100000000, vision: null, remote: false },
    ])
    // Tabs von vor dem Update lesen `models` als Liste von Namen
    assert.deepEqual(status.models, ['bild:4b', 'text:8b', 'gross:120b-cloud', 'alt:7b'])
  }, { models, model: 'bild:4b' })
})

test('Ollama: ist der Server nicht erreichbar, nennen Status und Auswertung die Adresse', async () => {
  const s = await startServer()
  try {
    await s.api('/api/settings', { method: 'PUT', body: JSON.stringify({ ollamaUrl: `${UNREACHABLE}/` }) })
    const status = await s.api('/api/ollama/status')
    assert.equal(status.ok, false)
    assert.match(status.error, /Ollama ist unter http:\/\/127\.0\.0\.1:9 nicht erreichbar/)
    const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.equal(r.status, 502)
    assert.match(r.body.error, /Ollama ist unter http:\/\/127\.0\.0\.1:9 nicht erreichbar/)
  } finally {
    s.stop()
  }
})

test('Ollama: ein nicht installiertes Modell nennt den Befehl zum Laden', async () => {
  await withOllama(async (s) => {
    const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.equal(r.status, 502)
    assert.match(r.body.error, /„fehlt:4b“ ist in Ollama nicht installiert/)
    assert.match(r.body.error, /ollama pull fehlt:4b/)
  }, { model: 'fehlt:4b' })
})

test('Ollama: ein Modell ohne Bildverständnis bekommt keine Bilder, sondern eine klare Meldung', async () => {
  await withOllama(async (s, ollama) => {
    const scan = await uploadPdf(s, '/api/extract', { pages: [page(1)] })
    assert.equal(scan.status, 502)
    assert.match(scan.body.error, /„text:8b“ versteht keine Bilder/)
    const photo = new FormData()
    photo.append('file', new Blob([Buffer.from('JPEG-Foto')], { type: 'image/jpeg' }), 'zaehler.jpg')
    const intake = await fetch(`${s.base}/api/intake`, { method: 'POST', body: photo })
    assert.equal(intake.status, 502)
    assert.match((await intake.json()).error, /versteht keine Bilder/)
    assert.equal(chatRequests(ollama).length, 0)
    // Text braucht kein Bildverständnis
    assert.equal((await uploadPdf(s, '/api/extract', { text: LONG_TEXT })).status, 200)
  }, { models: [{ name: 'text:8b', capabilities: ['completion'] }], model: 'text:8b' })
})

test('Ollama: kennt die Ollama-Version keine Fähigkeiten, gehen Bilder trotzdem hin', async () => {
  await withOllama(async (s, ollama) => {
    const r = await uploadPdf(s, '/api/extract', { pages: [page(1)] })
    assert.equal(r.status, 200)
    assert.deepEqual(firstMessage(ollama).images, [base64(1)])
  }, { models: [{ name: 'alt:7b' }], model: 'alt:7b' })
})

test('Ollama: antwortet Ollama mit einem Fehler, sucht der Status keine andere Adresse', async () => {
  // Derselbe Server unter anderem Namen wäre kein hilfreicher Vorschlag
  const http = await import('node:http')
  const broken = http.createServer((req, res) => { res.writeHead(500); res.end('kaputt') })
  await new Promise((r) => broken.listen(0, '127.0.0.1', r))
  const ollama = await fakeOllama()
  try {
    await withEnv({ NKA_OLLAMA_CANDIDATES: ollama.url }, async (s) => {
      await s.api('/api/settings', { method: 'PUT', body: JSON.stringify({ ollamaUrl: `http://127.0.0.1:${broken.address().port}` }) })
      const status = await s.api('/api/ollama/status')
      assert.equal(status.ok, false)
      assert.match(status.error, /Ollama antwortet mit 500/)
      assert.equal(status.found, undefined)
      assert.equal(ollama.requests.length, 0, 'die Suche hat trotzdem gefragt')
    })
  } finally {
    ollama.stop()
    broken.close()
  }
})

test('Ollama: ist die Adresse nicht erreichbar, schlägt der Status eine gefundene vor', async () => {
  const ollama = await fakeOllama()
  const candidates = `${UNREACHABLE},${ollama.url}`
  try {
    await withEnv({ NKA_OLLAMA_CANDIDATES: candidates }, async (s) => {
      await s.api('/api/settings', { method: 'PUT', body: JSON.stringify({ ollamaUrl: 'http://127.0.0.1:10' }) })
      const status = await s.api('/api/ollama/status')
      assert.equal(status.ok, false)
      assert.equal(status.found, ollama.url)
    })
    // Hat der Betreiber die Adresse festgelegt, bleibt es bei der Meldung
    await withEnv({ NKA_OLLAMA_CANDIDATES: candidates, NKA_OLLAMA_URL: 'http://127.0.0.1:10' }, async (s) => {
      const status = await s.api('/api/ollama/status')
      assert.equal(status.ok, false)
      assert.equal(status.found, undefined)
    })
  } finally {
    ollama.stop()
  }
})

// ---------- Backup und Wiederherstellung (#23) ----------
// Ein Backup ist ein ZIP mit db.json und uploads/. Beim Zurückspielen darf ein fremdes oder
// kaputtes Archiv nie einen halb ersetzten Datenstand hinterlassen.

async function restore(s, zipBuffer) {
  const fd = new FormData()
  fd.append('file', new Blob([zipBuffer], { type: 'application/zip' }), 'backup.zip')
  const res = await fetch(`${s.base}/api/restore`, { method: 'POST', body: fd })
  const contentType = res.headers.get('content-type') ?? ''
  return { status: res.status, contentType, body: contentType.includes('json') ? await res.json() : await res.text() }
}

async function withData(fn) {
  const s = await startServer()
  try {
    const unit = await s.api('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 80, participates: true }) })
    const fd = new FormData()
    fd.append('file', new Blob([Buffer.from('%PDF-Beleg')], { type: 'application/pdf' }), 'Gebührenbescheid Müll.pdf')
    const { file } = await (await fetch(`${s.base}/api/upload`, { method: 'POST', body: fd })).json()
    await fn(s, { unit, file })
  } finally {
    s.stop()
  }
}

// Ein Archiv mit gültiger db.json und frei wählbaren weiteren Einträgen
function archive(entries = {}, db = { units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], settings: {} }) {
  const zip = new AdmZip()
  if (db !== null) zip.addFile('db.json', Buffer.from(typeof db === 'string' ? db : JSON.stringify(db)))
  for (const [name, content] of Object.entries(entries)) zip.addFile(name, Buffer.from(content))
  return zip.toBuffer()
}

test('Backup: herunterladen und zurückspielen bringt Daten und Belege zurück', async () => {
  await withData(async (s, { unit, file }) => {
    const backup = Buffer.from(await (await fetch(`${s.base}/api/backup`)).arrayBuffer())
    assert.equal(backup.subarray(0, 2).toString(), 'PK')
    await fetch(`${s.base}/api/units/${unit.id}`, { method: 'DELETE' })
    fs.rmSync(path.join(s.dataDir, 'uploads', file))
    const r = await restore(s, backup)
    assert.equal(r.status, 200)
    assert.deepEqual((await s.api('/api/units')).map((u) => u.id), [unit.id])
    assert.deepEqual((await s.api('/api/uploads')).map((u) => u.file), [file]) // Umlaute überleben das ZIP
  })
})

test('Backup: ein Archiv ohne db.json oder mit kaputter db.json ändert nichts', async () => {
  await withData(async (s, { unit }) => {
    for (const zip of [archive({ 'uploads/a.pdf': 'x' }, null), archive({}, '{ kaputt')]) {
      const r = await restore(s, zip)
      assert.equal(r.status, 400)
      assert.match(r.contentType, /json/)
    }
    const r = await restore(s, Buffer.from('kein ZIP'))
    assert.equal(r.status, 400)
    assert.match(r.body.error, /kein gültiges ZIP/)
    assert.deepEqual((await s.api('/api/units')).map((u) => u.id), [unit.id])
  })
})

// Setzt einen Eintragsnamen roh ins Archiv, wie ein präpariertes ZIP ihn enthielte. adm-zip
// bereinigt Namen schon beim Erzeugen, deshalb erst mit gleich langem Platzhalter bauen und die
// Bytes danach ersetzen (der Name steckt in lokalem Kopf und zentralem Verzeichnis).
function archiveWithRawName(name) {
  const placeholder = `uploads/${'X'.repeat(name.length - 'uploads/'.length)}`
  const raw = archive({ [placeholder]: 'boese' }).toString('latin1')
  assert.equal(raw.split(placeholder).length - 1, 2, 'Platzhalter steht zweimal im Archiv')
  return Buffer.from(raw.replaceAll(placeholder, name), 'latin1')
}

test('Backup: ein Eintrag, der aus dem Belegordner ausbrechen will, wird abgelehnt, ohne halb zu ersetzen', async () => {
  await withData(async (s, { unit }) => {
    for (const name of ['uploads/..', 'uploads/../../boese.txt', 'uploads/.', 'uploads/unter/ordner.pdf']) {
      const r = await restore(s, archiveWithRawName(name))
      assert.equal(r.status, 400, `${name}: ${JSON.stringify(r.body)}`)
      assert.match(r.contentType, /json/)
      // Nichts ersetzt: die Wohnung ist noch da, obwohl die db.json im Archiv leer ist
      assert.deepEqual((await s.api('/api/units')).map((u) => u.id), [unit.id])
    }
    assert.equal(fs.existsSync(path.join(s.dataDir, 'boese.txt')), false)
    assert.equal(fs.existsSync(path.join(s.dataDir, '..', 'boese.txt')), false)
  })
})

test('Backup: ein Archiv, das ausgepackt zu groß wird, wird abgelehnt, bevor etwas ersetzt wird', async () => {
  // Gegen „ZIP-Bomben“: wenige Kilobyte, die ausgepackt riesig werden. Die Grenze ist hier für
  // den Test auf 100 kB gesetzt, im Betrieb liegt sie bei 1 GB.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-restore-'))
  const s = await startServerIn(dataDir, { NKA_RESTORE_MAX_BYTES: String(100 * 1024) })
  try {
    const unit = await s.api('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 80, participates: true }) })
    const bomb = archive({ 'uploads/gross.pdf': Buffer.alloc(200 * 1024) })
    assert.ok(bomb.length < 10 * 1024, 'das Archiv selbst ist klein')
    const r = await restore(s, bomb)
    assert.equal(r.status, 400)
    assert.match(r.body.error, /zu groß/)
    assert.deepEqual((await s.api('/api/units')).map((u) => u.id), [unit.id])
    assert.equal((await s.api('/api/uploads')).length, 0)
  } finally {
    s.stop()
  }
})

// Mit NKA_PORT=0 vergibt das System einen freien Port. Die Tests starten den Server so und
// lesen den Port aus der Startmeldung (siehe startServerIn).
test('Start: mit NKA_PORT=0 nennt die Startmeldung den tatsächlich vergebenen Port', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-port-'))
  const child = spawn(process.execPath, ['src/index.ts'], {
    cwd: serverRoot,
    env: { ...process.env, NKA_PORT: '0', NKA_DATA_DIR: dataDir, NKA_UPDATE_URL: 'http://127.0.0.1:9/', CI: '1' },
  })
  try {
    const url = await readStartUrl(child)
    assert.notEqual(new URL(url).port, '0', url)
    assert.equal((await fetch(`${url}/healthz`)).status, 200)
  } finally {
    child.kill()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})

test('Start: ein NKA_PORT, der keine Portnummer ist, bricht den Start mit klarer Meldung ab', async () => {
  // node:net nimmt eine Zeichenkette, die keine Zahl ist, als Pfad eines Unix-Sockets (unter
  // Windows einer Named Pipe). Mietfuchs lief damit scheinbar, war aber über HTTP unter keiner
  // Adresse erreichbar: `address()` liefert dann den Pfad statt eines Objekts mit Port, und die
  // Startmeldung nannte „http://127.0.0.1:undefined“.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-port-'))
  const { child, out } = startServerRaw(dataDir, { NKA_PORT: 'kein-port' })
  try {
    assert.equal(await waitForExit(child), 1, out())
    assert.match(out(), /NKA_PORT/)
    assert.doesNotMatch(out(), /läuft auf/)
  } finally {
    child.kill()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})

test('Start: ist der Port belegt, meldet der Server das und behauptet nicht, zu laufen', async () => {
  // Express 5 ruft den listen-Callback auch bei einem Fehler auf. Ohne Prüfung meldete Mietfuchs
  // dann „läuft auf …“ und öffnete in der Programmdatei sogar den Browser.
  const net = await import('node:net')
  const blocker = net.createServer()
  // Ohne Host wie Mietfuchs selbst, sonst lauschten beide auf verschiedenen Adressfamilien
  await new Promise((r) => blocker.listen(0, r))
  const port = blocker.address().port
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-port-'))
  try {
    const child = spawn(process.execPath, ['src/index.ts'], {
      cwd: serverRoot,
      env: { ...process.env, NKA_PORT: String(port), NKA_DATA_DIR: dataDir, NKA_UPDATE_URL: 'http://127.0.0.1:9/' },
    })
    let output = ''
    child.stdout.on('data', (d) => { output += d })
    child.stderr.on('data', (d) => { output += d })
    const code = await Promise.race([
      new Promise((r) => child.on('exit', r)),
      new Promise((r) => setTimeout(() => { child.kill(); r('läuft nach 15 s noch') }, 15000)),
    ])
    assert.notEqual(code, 'läuft nach 15 s noch', output)
    assert.notEqual(code, 0)
    assert.match(output, /bereits belegt/)
    assert.doesNotMatch(output, /läuft auf/)
  } finally {
    blocker.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})

// ---------- API-Schlüssel externer KI-Dienste (#18) ----------
// Schlüssel liegen in einer eigenen Datei neben der db.json. Sie gehen nie an den Browser und
// nicht ins Backup-ZIP, das schnell in einer Cloud oder auf einem USB-Stick landet.

const SECRET = 'sk-test-geheim-1234567890abcd'
const putKey = (s, body) => fetch(`${s.base}/api/ai/key`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

test('Schlüssel: wird gespeichert, erscheint aber nirgends im Klartext', async () => {
  await withEnv({}, async (s) => {
    const res = await putKey(s, { slot: 'text', key: `  ${SECRET}  ` })
    assert.equal(res.status, 200)
    assert.deepEqual((await res.json()).text, { set: true, hint: '…abcd', fromEnv: null })
    const settings = await s.api('/api/settings')
    assert.deepEqual(settings.aiKeys.text, { set: true, hint: '…abcd', fromEnv: null })
    assert.deepEqual(settings.aiKeys.images, { set: false, hint: '', fromEnv: null })
    assert.ok(!JSON.stringify(settings).includes(SECRET), 'Schlüssel in /api/settings')
    // Speichert die Oberfläche die Einstellungen samt `aiKeys` zurück, landet nichts davon in der db.json
    await s.api('/api/settings', { method: 'PUT', body: JSON.stringify(settings) })
    const db = fs.readFileSync(path.join(s.dataDir, 'db.json'), 'utf8')
    assert.ok(!db.includes(SECRET), 'Schlüssel in der db.json')
    assert.ok(!db.includes('aiKeys'), 'aiKeys in der db.json')
    assert.equal(JSON.parse(fs.readFileSync(path.join(s.dataDir, 'secrets.json'), 'utf8')).text, SECRET)
  })
})

test('Schlüssel: nicht im Backup, und eine Wiederherstellung lässt ihn stehen', async () => {
  await withEnv({}, async (s) => {
    await putKey(s, { slot: 'text', key: SECRET })
    const zip = Buffer.from(await (await fetch(`${s.base}/api/backup`)).arrayBuffer())
    const entries = new AdmZip(zip).getEntries()
    assert.ok(!entries.some((e) => e.entryName.includes('secrets')), 'secrets.json im Backup')
    assert.ok(!entries.some((e) => e.getData().includes(SECRET)), 'Schlüssel in einem Eintrag des Backups')
    assert.equal((await restore(s, zip)).status, 200)
    assert.equal((await s.api('/api/settings')).aiKeys.text.set, true)
  })
})

// Wer den Datenordner von Hand zippt, hat die secrets.json mit im Archiv. Sie wird nicht
// übernommen, die Schlüssel dieses Rechners bleiben.
test('Schlüssel: eine secrets.json im Backup wird nicht übernommen', async () => {
  await withEnv({}, async (s) => {
    await putKey(s, { slot: 'text', key: SECRET })
    const zip = new AdmZip(Buffer.from(await (await fetch(`${s.base}/api/backup`)).arrayBuffer()))
    zip.addFile('secrets.json', Buffer.from(JSON.stringify({ text: 'fremder-schluessel-0000', images: 'fremd-1111' })))
    assert.equal((await restore(s, zip.toBuffer())).status, 200)
    const { aiKeys } = await s.api('/api/settings')
    assert.equal(aiKeys.text.hint, '…abcd')
    assert.equal(aiKeys.images.set, false)
    assert.equal(JSON.parse(fs.readFileSync(path.join(s.dataDir, 'secrets.json'), 'utf8')).text, SECRET)
  })
})

test('Schlüssel: löschen', async () => {
  await withEnv({}, async (s) => {
    await putKey(s, { slot: 'images', key: SECRET })
    const res = await fetch(`${s.base}/api/ai/key/images`, { method: 'DELETE' })
    assert.equal(res.status, 200)
    assert.equal((await s.api('/api/settings')).aiKeys.images.set, false)
  })
})

test('Schlüssel: NKA_AI_API_KEY hat Vorrang und lässt sich nicht überschreiben', async () => {
  await withEnv({ NKA_AI_API_KEY: SECRET }, async (s) => {
    assert.deepEqual((await s.api('/api/settings')).aiKeys.text, { set: true, hint: '…abcd', fromEnv: 'NKA_AI_API_KEY' })
    const res = await putKey(s, { slot: 'text', key: 'anderer-schluessel-9999' })
    assert.equal(res.status, 409)
    assert.match((await res.json()).error, /NKA_AI_API_KEY/)
    assert.ok(!fs.existsSync(path.join(s.dataDir, 'secrets.json')))
  })
})

// Docker- und Compose-Secrets liegen als Datei unter /run/secrets/. Die Endung _FILE folgt der
// Konvention offizieller Images wie postgres und mysql.
test('Schlüssel: NKA_AI_API_KEY_FILE liest ihn aus einer Datei, etwa einem Docker-Secret', async () => {
  const secretDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-secret-'))
  const secretFile = path.join(secretDir, 'ki_schluessel')
  fs.writeFileSync(secretFile, `${SECRET}\n`) // Zeilenumbruch am Ende wie bei `echo … > datei`
  try {
    await withEnv({ NKA_AI_API_KEY_FILE: secretFile }, async (s) => {
      assert.deepEqual((await s.api('/api/settings')).aiKeys.text, { set: true, hint: '…abcd', fromEnv: 'NKA_AI_API_KEY_FILE' })
      const res = await putKey(s, { slot: 'text', key: 'anderer-schluessel-9999' })
      assert.equal(res.status, 409)
      assert.match((await res.json()).error, /NKA_AI_API_KEY_FILE/)
      assert.ok(!fs.existsSync(path.join(s.dataDir, 'secrets.json')))
    })
  } finally {
    fs.rmSync(secretDir, { recursive: true, force: true })
  }
})

// Mit einer falschen Angabe liefe Mietfuchs sonst still ohne Schlüssel, und der Fehler zeigte
// sich erst bei der ersten Auswertung als „Schlüssel ungültig“
test('Start: fehlerhafte Schlüssel-Variablen verhindern den Start mit klarer Meldung', async () => {
  const secretDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-secret-'))
  const file = (name, content) => {
    const p = path.join(secretDir, name)
    fs.writeFileSync(p, content)
    return p
  }
  const cases = [
    [{ NKA_AI_API_KEY: SECRET, NKA_AI_API_KEY_FILE: file('beide', SECRET) }, /beide gesetzt/],
    [{ NKA_AI_API_KEY_FILE: path.join(secretDir, 'fehlt') }, /fehlt, die Datei lässt sich aber nicht lesen \(ENOENT\)/],
    [{ NKA_AI_API_KEY_FILE: file('leer', '\n') }, /ist leer/],
    [{ NKA_AI_API_KEY_FILE: file('zwei-zeilen', 'erste-zeile-123456\nzweite-zeile-123456\n') }, /ungültiges Format/],
    [{ NKA_AI_API_KEY: 'mit leerzeichen 123456' }, /ungültiges Format/],
    [{ NKA_AI_PROVIDER: 'chatgpt' }, /NKA_AI_PROVIDER „chatgpt“ ist unbekannt/],
    [{ NKA_AI_URL: 'api.openai.com/v1' }, /NKA_AI_URL muss eine Adresse/],
    [{ NKA_OLLAMA_NUM_CTX: 'viel' }, /NKA_OLLAMA_NUM_CTX muss eine ganze Zahl/],
    [{ NKA_OLLAMA_NUM_CTX: '0' }, /NKA_OLLAMA_NUM_CTX muss eine ganze Zahl/],
    [{ NKA_AI_TIMEOUT: '10min' }, /NKA_AI_TIMEOUT muss eine ganze Zahl/],
  ]
  try {
    for (const [env, message] of cases) {
      const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-start-'))
      const child = spawn(process.execPath, ['src/index.ts'], {
        cwd: serverRoot,
        env: { ...process.env, NKA_AI_API_KEY: '', NKA_AI_API_KEY_FILE: '', ...env, NKA_PORT: '0', NKA_DATA_DIR: dataDir, NKA_UPDATE_URL: 'http://127.0.0.1:9/', CI: '1' },
      })
      let output = ''
      child.stdout.on('data', (d) => { output += d })
      child.stderr.on('data', (d) => { output += d })
      const code = await Promise.race([
        new Promise((r) => child.on('exit', r)),
        new Promise((r) => setTimeout(() => { child.kill(); r('läuft nach 15 s noch') }, 15000)),
      ])
      fs.rmSync(dataDir, { recursive: true, force: true })
      assert.notEqual(code, 'läuft nach 15 s noch', `${JSON.stringify(Object.keys(env))}: ${output}`)
      assert.notEqual(code, 0)
      assert.match(output, message)
      assert.doesNotMatch(output, /läuft auf/)
      assert.ok(!output.includes(SECRET), 'Schlüssel in der Ausgabe')
    }
  } finally {
    fs.rmSync(secretDir, { recursive: true, force: true })
  }
})

test('Schlüssel: ungültige Eingaben werden abgelehnt', async () => {
  await withEnv({}, async (s) => {
    for (const body of [{ slot: 'fremd', key: SECRET }, { slot: 'text', key: '' }, { slot: 'text', key: 'mit\nzeilenumbruch' }, { slot: 'text', key: 'x'.repeat(5000) }, { slot: 'text' }]) {
      const res = await putKey(s, body)
      assert.equal(res.status, 400, JSON.stringify(body).slice(0, 60))
    }
  })
})

test('Schlüssel: löschen geht nicht bei Umgebungsvariable oder unbekanntem Platz', async () => {
  await withEnv({ NKA_AI_API_KEY: SECRET }, async (s) => {
    assert.equal((await fetch(`${s.base}/api/ai/key/text`, { method: 'DELETE' })).status, 409)
    assert.equal((await fetch(`${s.base}/api/ai/key/fremd`, { method: 'DELETE' })).status, 400)
    assert.equal((await s.api('/api/settings')).aiKeys.text.set, true)
  })
})

// Bei einem kurzen Schlüssel verrieten die letzten vier Zeichen fast alles
test('Schlüssel: kurze Schlüssel werden nicht angedeutet', async () => {
  await withEnv({}, async (s) => {
    await putKey(s, { slot: 'text', key: 'kurz-1234' })
    assert.deepEqual((await s.api('/api/settings')).aiKeys.text, { set: true, hint: '', fromEnv: null })
  })
})

test('Schlüssel: eine von Hand verdorbene secrets.json stört den Start nicht', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
  fs.writeFileSync(path.join(dataDir, 'secrets.json'), JSON.stringify({ text: 12345, images: { a: 1 } }))
  const s = await startServerIn(dataDir)
  try {
    const { aiKeys } = await s.api('/api/settings')
    assert.equal(aiKeys.text.set, false)
    assert.equal(aiKeys.images.set, false)
  } finally {
    s.stop()
  }
})

// Gültiges JSON, aber kein Objekt: Der vorige Test schreibt ein Objekt mit falschen Werttypen,
// dieser prüft den anderen Rand, das JSON-Literal null.
test('Schlüssel: eine secrets.json mit dem Literal null stört den Start nicht', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
  fs.writeFileSync(path.join(dataDir, 'secrets.json'), 'null')
  const s = await startServerIn(dataDir)
  try {
    const { aiKeys } = await s.api('/api/settings')
    assert.equal(aiKeys.text.set, false)
    assert.equal(aiKeys.images.set, false)
  } finally {
    s.stop()
  }
})

test('Schlüssel: die Datei ist nur für den eigenen Benutzer lesbar', async (t) => {
  if (process.platform === 'win32') return t.skip('Unix-Rechte gibt es unter Windows nicht')
  await withEnv({}, async (s) => {
    await putKey(s, { slot: 'text', key: SECRET })
    assert.equal(fs.statSync(path.join(s.dataDir, 'secrets.json')).mode & 0o777, 0o600)
  })
})

// ---------- KI-Einstellungen (#18) ----------
// Das Datenmodell selbst prüft aiSettings.test.js ohne Server. Hier geht es um das
// Zusammenspiel mit db.json, Umgebung und der Route.

const OPENAI_SLOT = { provider: 'openai', preset: 'openai', url: 'https://api.openai.com/v1', model: 'gpt-5.4-nano', vision: true }

test('KI-Einstellungen: eine db.json von vor #18 bekommt beim Start den Standard-Anbieter', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ settings: { ollamaUrl: 'http://nas:11434', ollamaModel: 'gemma4:12b' } }))
  const s = await startServerIn(dataDir)
  try {
    const { ai } = await s.api('/api/settings')
    // nas ist nicht dieser Rechner, deshalb die Vorlage für ein entferntes Ollama
    assert.deepEqual(ai.text, { provider: 'ollama', preset: 'ollama-remote', url: 'http://nas:11434', model: 'gemma4:12b', vision: null })
    assert.equal(ai.images, null)
  } finally {
    s.stop()
  }
})

test('KI-Einstellungen: Wechsel zu OpenAI wird gespeichert, die Ollama-Felder bleiben für ein Downgrade', async () => {
  await withEnv({}, async (s) => {
    const before = await s.api('/api/settings')
    const saved = await s.api('/api/settings', { method: 'PUT', body: JSON.stringify({ ...before, ai: { ...before.ai, text: OPENAI_SLOT } }) })
    assert.deepEqual(saved.ai.text, OPENAI_SLOT)
    const stored = storedSettings(s)
    assert.deepEqual(stored.ai.text, OPENAI_SLOT)
    assert.equal(stored.ollamaUrl, 'http://localhost:11434')
    assert.equal(stored.aiKeys, undefined)
  })
})

test('KI-Einstellungen: eine ungültige Angabe ergibt 400, und nichts wird gespeichert', async () => {
  await withEnv({}, async (s) => {
    const before = await s.api('/api/settings')
    const res = await fetch(`${s.base}/api/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...before, landlordName: 'Neu', ai: { ...before.ai, text: { ...OPENAI_SLOT, url: 'api.openai.com' } } }),
    })
    assert.equal(res.status, 400)
    assert.match((await res.json()).error, /Adresse muss mit http/)
    assert.equal((await s.api('/api/settings')).landlordName, '')
  })
})

test('KI-Einstellungen: NKA_AI_PROVIDER, NKA_AI_URL und NKA_AI_MODEL gelten und sind als fest markiert', async () => {
  await withEnv({ NKA_AI_PROVIDER: 'openai', NKA_AI_URL: 'https://api.mistral.ai/v1', NKA_AI_MODEL: 'mistral-small-latest', NKA_OLLAMA_URL: 'http://ollama:11434' }, async (s) => {
    const settings = await s.api('/api/settings')
    assert.equal(settings.ai.text.provider, 'openai')
    assert.equal(settings.ai.text.url, 'https://api.mistral.ai/v1')
    assert.equal(settings.ai.text.model, 'mistral-small-latest')
    // NKA_OLLAMA_URL gilt nicht, solange ein anderer Anbieter festgelegt ist
    assert.deepEqual(settings.fixedByEnv, ['ai.text.provider', 'ai.text.url', 'ai.text.model'])
    await s.api('/api/settings', { method: 'PUT', body: JSON.stringify({ ...settings, landlordName: 'X' }) })
    const stored = storedSettings(s)
    assert.equal(stored.ai.text.provider, 'ollama') // Werte aus der Umgebung landen nicht in der db.json
    assert.equal(stored.ai.text.url, 'http://localhost:11434')
  })
})

// ---------- Anbieterwahl je Beleg (#18) ----------

// Speichert KI-Einstellungen über die Route, wie es die Oberfläche tut
async function putAi(s, change) {
  const settings = await s.api('/api/settings')
  return s.api('/api/settings', { method: 'PUT', body: JSON.stringify({ ...settings, ai: { ...settings.ai, ...change } }) })
}

const ollamaSlot = (url, model = 'test') => ({ provider: 'ollama', preset: 'ollama-remote', url, model, vision: null })
const photoForm = () => {
  const fd = new FormData()
  fd.append('file', new Blob([Buffer.from('JPEG-Foto')], { type: 'image/jpeg' }), 'rechnung.jpg')
  return fd
}

test('Anbieterwahl: Fotos gehen an den eigenen Bilder-Anbieter, Text an den Standard', async () => {
  const images = await fakeOllama({ models: [{ name: 'bild:latest', capabilities: ['completion', 'vision'] }] })
  try {
    await withOllama(async (s, text) => {
      await putAi(s, { images: ollamaSlot(images.url, 'bild') })
      const withImage = (ollama) => chatRequests(ollama).filter((c) => c.body.messages[0].images)
      assert.equal((await fetch(`${s.base}/api/extract`, { method: 'POST', body: photoForm() })).status, 200)
      assert.equal(withImage(images).length, 1)
      assert.equal(chatRequests(images)[0].body.model, 'bild')
      // Der zweite Durchgang ordnet nur Positionstexte Kostenarten zu, ohne Bild: Das darf der
      // Standard-Anbieter
      assert.equal(withImage(text).length, 0)
      // Ein PDF mit Textebene geht ganz an den Standard
      const imageRequests = chatRequests(images).length
      assert.equal((await uploadPdf(s, '/api/extract', { text: LONG_TEXT })).status, 200)
      assert.ok(chatRequests(text).length > 0)
      assert.equal(chatRequests(images).length, imageRequests)
    })
  } finally {
    images.stop()
  }
})

test('Anbieterwahl: Ollama mit Schlüssel schickt ihn als Bearer, ohne ihn anzuzeigen', async () => {
  const KEY = 'ollama-schluessel-1234567890'
  const ollama = await fakeOllama({ key: KEY })
  const s = await startServerIn(fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-')))
  try {
    await putAi(s, { text: ollamaSlot(ollama.url) })
    // Ohne Schlüssel: verständliche Meldung statt 401
    const without = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.equal(without.status, 502)
    assert.match(without.body.error, /Schlüssel/)
    await putKey(s, { slot: 'text', key: KEY })
    const before = chatRequests(ollama).length
    const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.equal(r.status, 200)
    assert.ok(chatRequests(ollama).slice(before).every((c) => c.headers.authorization === `Bearer ${KEY}`))
    assert.ok(!JSON.stringify(r.body).includes(KEY))
    // Auch die Modellliste der Einstellungen fragt mit Schlüssel
    const status = await s.api('/api/ollama/status')
    assert.equal(status.ok, true)
  } finally {
    s.stop()
    ollama.stop()
  }
})

test('Anbieterwahl: zusätzliche Hinweise an das Modell stehen im Prompt', async () => {
  await withOllama(async (s, ollama) => {
    await putAi(s, { extraInstructions: 'Beträge immer brutto übernehmen.' })
    assert.equal((await uploadPdf(s, '/api/extract', { text: LONG_TEXT })).status, 200)
    assert.ok(chatRequests(ollama).length > 0, 'keine Anfrage an Ollama')
    assert.ok(chatRequests(ollama).every((c) => c.body.messages[0].content.includes('Beträge immer brutto übernehmen.')))
  })
})

test('Anbieterwahl: Kontext aus den Einstellungen geht an Ollama', async () => {
  await withOllama(async (s, ollama) => {
    await putAi(s, { numCtx: 8192 })
    assert.equal((await uploadPdf(s, '/api/extract', { text: LONG_TEXT })).status, 200)
    assert.ok(chatOptions(ollama).length > 0, 'keine Anfrage an Ollama')
    assert.ok(chatOptions(ollama).every((o) => o.num_ctx === 8192))
  })
})

// Manche Modelle bei Ollama Cloud erlauben nicht, das Nachdenken abzuschalten
test('Anbieterwahl: lehnt das Modell think: false ab, geht es ohne weiter', async () => {
  await withOllama(async (s, ollama) => {
    const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.equal(r.status, 200)
    const thinks = chatRequests(ollama).map((c) => c.body.think)
    assert.equal(thinks[0], false)
    assert.equal(thinks[1], undefined) // Wiederholung ohne das Feld
    // Beim nächsten Beleg fragt Mietfuchs gleich ohne
    const before = chatRequests(ollama).length
    await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.ok(chatRequests(ollama).slice(before).every((c) => c.body.think === undefined))
  }, { chat: 'rejectThinkOff' })
})

// ---------- Bestätigung externer Dienste (#18) ----------
// 192.0.2.1 liegt im Dokumentationsnetz (RFC 5737): nicht privat, also extern, und nie
// erreichbar. So braucht der Test kein Internet.

const EXTERNAL = 'http://192.0.2.1:11434'

test('Bestätigung: ohne sie gehen keine Belege an einen externen Dienst', async () => {
  await withEnv({ NKA_AI_TIMEOUT: '2' }, async (s) => {
    await putAi(s, { text: ollamaSlot(EXTERNAL) })
    const started = Date.now()
    const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.equal(r.status, 502)
    assert.match(r.body.error, /192\.0\.2\.1:11434.*bestätigt/s)
    assert.ok(Date.now() - started < 1500, 'ohne Bestätigung darf keine Verbindung versucht werden')
    // Nach der Bestätigung versucht Mietfuchs es, der Dienst ist nur eben nicht erreichbar
    const confirmed = await s.api('/api/ai/consent', { method: 'POST', body: JSON.stringify({ slot: 'text' }) })
    assert.equal(confirmed.ai.consent.text.url, EXTERNAL)
    assert.match(confirmed.ai.consent.text.date, /^\d{4}-\d{2}-\d{2}$/)
    const again = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.doesNotMatch(again.body.error, /bestätigt/)
    // Eine neue Adresse braucht eine neue Bestätigung
    await putAi(s, { text: ollamaSlot('http://192.0.2.2:11434') })
    assert.match((await uploadPdf(s, '/api/extract', { text: LONG_TEXT })).body.error, /192\.0\.2\.2:11434.*bestätigt/s)
  })
})

test('Bestätigung: lässt sich widerrufen und gilt je Platz', async () => {
  await withEnv({}, async (s) => {
    await putAi(s, { text: ollamaSlot(EXTERNAL) })
    await s.api('/api/ai/consent', { method: 'POST', body: JSON.stringify({ slot: 'text' }) })
    const revoked = await s.api('/api/ai/consent/text', { method: 'DELETE' })
    assert.equal(revoked.ai.consent.text, undefined)
    // Ohne eigenen Bilder-Anbieter gibt es für Bilder nichts zu bestätigen
    const res = await fetch(`${s.base}/api/ai/consent`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slot: 'images' }) })
    assert.equal(res.status, 400)
    assert.equal((await fetch(`${s.base}/api/ai/consent/fremd`, { method: 'DELETE' })).status, 400)
  })
})

test('Bestätigung: ein Cloud-Modell über das lokale Ollama braucht sie auch', async () => {
  await withOllama(async (s, ollama) => {
    const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.equal(r.status, 502)
    assert.match(r.body.error, /gpt-oss:120b-cloud.*Cloud/s)
    assert.equal(chatRequests(ollama).length, 0)
    await s.api('/api/ai/consent', { method: 'POST', body: JSON.stringify({ slot: 'text' }) })
    assert.equal((await uploadPdf(s, '/api/extract', { text: LONG_TEXT })).status, 200)
  }, { models: [{ name: 'gpt-oss:120b-cloud', capabilities: ['completion'], remote_host: 'https://ollama.com:443' }], model: 'gpt-oss:120b-cloud' })
})

// ---------- OpenAI-kompatible Dienste (#18) ----------
// Der nachgebaute Dienst antwortet wie die Chat-Completions-Schnittstelle: GET /v1/models und
// POST /v1/chat/completions als SSE-Strom. `rules` schaltet Eigenheiten echter Dienste ein, wie
// sie deren Dokumentation beschreibt:
//   rejectTemperature  lehnt temperature ab (neuere OpenAI-Modelle)
//   onlyMaxTokens      lehnt max_completion_tokens ab (Mistral, LM Studio)
//   rejectJsonSchema   kennt response_format json_schema nicht
//   rejectJsonObject   kennt response_format json_object nicht (LM Studio)
//   key                verlangt diesen Bearer-Schlüssel
//   errorFormat        'ionos' meldet Fehler als { messages: [{ errorCode, message }] }
//   busyOnce           antwortet einmal mit 429 und Retry-After
//   quota              meldet aufgebrauchtes Guthaben (429 insufficient_quota)
//   finish             Grund des Endes, etwa 'length'
//   whole              antwortet trotz stream: true am Stück als JSON
//   reasoning          schickt vor der Antwort Denktext
//   fenced             packt das JSON in einen Codeblock
//   hang               antwortet nie
//   echoKey            wiederholt den geschickten Schlüssel in einer Fehlermeldung
//   echoKeyInStream    wiederholt ihn in einem Fehler mitten im Strom (Status 200)
//   garbledStream      schickt ein nicht als JSON lesbares Ereignis, das den Schlüssel enthält
async function fakeOpenAi(rules = {}) {
  const http = await import('node:http')
  const requests = []
  const open = new Set()
  let busy = rules.busyOnce ? 1 : 0
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (d) => { raw += d })
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {}
      requests.push({ url: req.url, method: req.method, body, raw, headers: req.headers })
      const send = (status, data, headers = {}) => {
        res.writeHead(status, { 'content-type': 'application/json', ...headers })
        res.end(JSON.stringify(data))
      }
      const reject = (status, message, param, code = 'unsupported_parameter') =>
        rules.errorFormat === 'ionos'
          ? send(status, { httpStatus: status, messages: [{ errorCode: code, message }] })
          : send(status, { error: { message, type: 'invalid_request_error', param, code } })
      if (rules.key && req.headers.authorization !== `Bearer ${rules.key}`) return reject(401, 'Incorrect API key provided', null, 'invalid_api_key')
      if (rules.echoKey) return reject(400, `Invalid request for credentials ${req.headers.authorization}`, null, 'invalid_request')
      if (req.method === 'GET' && req.url === '/v1/models') {
        return send(200, { object: 'list', data: [{ id: 'modell-b', object: 'model' }, { id: 'modell-a', object: 'model', capabilities: { vision: true } }] })
      }
      if (req.url !== '/v1/chat/completions') return send(404, { error: { message: 'Not found' } })
      if (busy > 0) {
        busy -= 1
        return send(429, { error: { message: 'Rate limit reached for requests', code: 'rate_limit_exceeded' } }, { 'retry-after': '1' })
      }
      if (rules.quota) return send(429, { error: { message: 'You exceeded your current quota', code: 'insufficient_quota' } })
      if (rules.rejectTemperature && body.temperature !== undefined) {
        return reject(400, "Unsupported value: 'temperature' does not support 0 with this model. Only the default (1) value is supported.", 'temperature', 'unsupported_value')
      }
      if (rules.onlyMaxTokens && body.max_completion_tokens !== undefined) return reject(400, 'Unrecognized request argument supplied: max_completion_tokens', 'max_completion_tokens')
      if (rules.rejectJsonSchema && body.response_format?.type === 'json_schema') {
        return reject(400, "Invalid parameter: 'response_format' of type 'json_schema' is not supported with this model.", 'response_format')
      }
      if (rules.rejectJsonObject && body.response_format?.type === 'json_object') return send(400, { error: "'response_format.type' must be 'json_schema'" })
      if (body.model !== 'modell-a') return reject(404, `The model '${body.model}' does not exist or you do not have access to it.`, 'model', 'model_not_found')
      open.add(res)
      res.on('close', () => open.delete(res))
      if (rules.hang) return
      if (rules.echoKeyInStream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write(`data: ${JSON.stringify({ error: { message: `Ungültige Anmeldung mit ${req.headers.authorization}` } })}

`)
        return res.end()
      }
      // Ein Ereignis, das sich nicht als JSON lesen lässt und den Schlüssel enthält (Befund aus
      // der Codeprüfung: handleEvent gab ihn ungeprüft weiter)
      if (rules.garbledStream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write(`data: kaputt: ${req.headers.authorization}\n\n`)
        return res.end()
      }
      // Den zweiten Durchgang (nur Kategorien) erkennt man an Schema oder Prompt
      const answer = JSON.stringify(
        raw.includes('categories')
          ? { categories: ['Wasser/Abwasser'] }
          : { vendor: 'Stadtwerke Musterstadt', positions: [{ description: 'Frischwasser', category: 'Wasser/Abwasser', amountEur: 12.5 }], totalGrossEur: 12.5 },
      )
      const fence = '```'
      const content = rules.fenced ? `${fence}json\n${answer}\n${fence}` : answer
      const usage = { prompt_tokens: 900, completion_tokens: 40, total_tokens: 940 }
      if (rules.whole) return send(200, { choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage })
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const event = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`)
      if (rules.reasoning) event({ choices: [{ index: 0, delta: { reasoning_content: 'Ich rechne die Summe nach.' } }] })
      const half = Math.ceil(content.length / 2)
      event({ choices: [{ index: 0, delta: { role: 'assistant', content: content.slice(0, half) }, finish_reason: null }] })
      event({ choices: [{ index: 0, delta: { content: content.slice(half) }, finish_reason: null }] })
      event({ choices: [{ index: 0, delta: {}, finish_reason: rules.finish ?? 'stop' }] })
      if (body.stream_options?.include_usage) event({ choices: [], usage })
      res.end('data: [DONE]\n\n')
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return {
    url: `http://127.0.0.1:${server.address().port}/v1`,
    requests,
    completions: () => requests.filter((r) => r.url === '/v1/chat/completions'),
    stop: () => {
      for (const res of open) res.destroy()
      server.close()
    },
  }
}

async function withOpenAi(fn, { rules = {}, preset = 'openai-compatible', model = 'modell-a', vision = null, key = null, ai = {}, env = {} } = {}) {
  const service = await fakeOpenAi(rules)
  const s = await startServerIn(fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-')), env)
  try {
    if (key) await putKey(s, { slot: 'text', key })
    await putAi(s, { text: { provider: 'openai', preset, url: service.url, model, vision }, ...ai })
    await fn(s, service)
  } finally {
    s.stop()
    service.stop()
  }
}

test('OpenAI-kompatibel: Auswertung als Strom mit striktem Schema, Antwortlänge und Kennzahlen', async () => {
  await withOpenAi(async (s, service) => {
    const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.extraction.vendor, 'Stadtwerke Musterstadt')
    assert.equal(r.body.extraction.positions[0].category, 'Wasser/Abwasser')
    const [first] = service.completions()
    assert.equal(first.body.stream, true)
    assert.deepEqual(first.body.stream_options, { include_usage: true })
    assert.equal(first.body.max_tokens, 16384) // Eigener Dienst: das verbreitete Feld
    assert.equal(first.body.temperature, 0)
    assert.equal(first.body.response_format.type, 'json_schema')
    assert.equal(first.body.response_format.json_schema.strict, true)
    assert.equal(first.body.response_format.json_schema.schema.additionalProperties, false)
    assert.equal(first.headers.accept, 'text/event-stream')
    assert.equal(first.headers['content-length'], String(Buffer.byteLength(first.raw)))
    assert.equal(first.headers['transfer-encoding'], undefined)
    const extraction = r.body.stats.find((x) => x.step === 'extraction')
    assert.equal(extraction.promptTokens, 900)
    assert.equal(extraction.outputTokens, 40)
  })
})

test('OpenAI-kompatibel: Vorlage OpenAI schickt max_completion_tokens und keine Temperatur', async () => {
  await withOpenAi(async (s, service) => {
    assert.equal((await uploadPdf(s, '/api/extract', { text: LONG_TEXT })).status, 200)
    const [first] = service.completions()
    assert.equal(first.body.max_completion_tokens, 16384)
    assert.equal(first.body.max_tokens, undefined)
    assert.equal(first.body.temperature, undefined)
  }, { preset: 'openai' })
})

test('OpenAI-kompatibel: die Antwortlänge aus den Einstellungen gilt', async () => {
  await withOpenAi(async (s, service) => {
    assert.equal((await uploadPdf(s, '/api/extract', { text: LONG_TEXT })).status, 200)
    assert.ok(service.completions().length > 0, 'keine Anfrage an den Dienst')
    assert.ok(service.completions().every((c) => c.body.max_tokens === 4096))
  }, { ai: { maxOutputTokens: 4096 } })
})

test('OpenAI-kompatibel: Fotos gehen als data-URL, außer das Modell versteht laut Einstellung keine Bilder', async () => {
  await withOpenAi(async (s, service) => {
    assert.equal((await fetch(`${s.base}/api/extract`, { method: 'POST', body: photoForm() })).status, 200)
    const [first] = service.completions()
    assert.equal(first.body.messages[0].content[0].type, 'text')
    assert.deepEqual(first.body.messages[0].content[1], { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${Buffer.from('JPEG-Foto').toString('base64')}` } })
  })
  await withOpenAi(async (s, service) => {
    const res = await fetch(`${s.base}/api/extract`, { method: 'POST', body: photoForm() })
    assert.equal(res.status, 502)
    assert.match((await res.json()).error, /versteht das Modell „modell-a“ keine Bilder/)
    assert.equal(service.completions().length, 0)
  }, { vision: false })
})

test('OpenAI-kompatibel: eine abgelehnte Temperatur fällt weg, auch bei den nächsten Anfragen', async () => {
  await withOpenAi(async (s, service) => {
    assert.equal((await uploadPdf(s, '/api/extract', { text: LONG_TEXT })).status, 200)
    const temps = service.completions().map((c) => c.body.temperature)
    assert.deepEqual(temps.slice(0, 2), [0, undefined])
    assert.ok(temps.slice(2).every((t) => t === undefined), JSON.stringify(temps))
  }, { rules: { rejectTemperature: true } })
})

test('OpenAI-kompatibel: lehnt der Dienst max_completion_tokens ab, geht es mit max_tokens', async () => {
  await withOpenAi(async (s, service) => {
    assert.equal((await uploadPdf(s, '/api/extract', { text: LONG_TEXT })).status, 200)
    const [first, second] = service.completions()
    assert.equal(first.body.max_completion_tokens, 16384)
    assert.equal(second.body.max_tokens, 16384)
    assert.equal(second.body.max_completion_tokens, undefined)
  }, { preset: 'ionos', rules: { onlyMaxTokens: true } })
})

test('OpenAI-kompatibel: ohne json_schema geht es mit json_object und dem Schema im Prompt', async () => {
  await withOpenAi(async (s, service) => {
    assert.equal((await uploadPdf(s, '/api/extract', { text: LONG_TEXT })).status, 200)
    const formats = service.completions().map((c) => c.body.response_format?.type ?? 'keins')
    assert.deepEqual(formats.slice(0, 3), ['json_schema', 'json_schema', 'json_object'])
    assert.match(service.completions()[2].body.messages[0].content, /JSON-Schema/)
  }, { rules: { rejectJsonSchema: true } })
})

test('OpenAI-kompatibel: LM Studio überspringt json_object, zuletzt zählt der Prompt allein', async () => {
  await withOpenAi(async (s, service) => {
    const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.extraction.vendor, 'Stadtwerke Musterstadt') // aus dem Codeblock gelöst
    const formats = service.completions().map((c) => c.body.response_format?.type ?? 'keins')
    assert.deepEqual(formats.slice(0, 3), ['json_schema', 'json_schema', 'keins'])
    assert.ok(!formats.includes('json_object'))
  }, { preset: 'lmstudio', rules: { rejectJsonSchema: true, rejectJsonObject: true, fenced: true } })
})

test('OpenAI-kompatibel: Schlüssel als Bearer, verständliche Meldungen ohne den Schlüssel', async () => {
  const KEY = 'sk-test-richtig-1234567890'
  await withOpenAi(async (s, service) => {
    const without = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.match(without.body.error, /verlangt einen Schlüssel/)
    await putKey(s, { slot: 'text', key: 'sk-test-falsch-0987654321' })
    const wrong = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.match(wrong.body.error, /lehnt den Schlüssel ab/)
    assert.ok(!wrong.body.error.includes('sk-test-falsch'))
    await putKey(s, { slot: 'text', key: KEY })
    assert.equal((await uploadPdf(s, '/api/extract', { text: LONG_TEXT })).status, 200)
    assert.equal(service.completions().at(-1).headers.authorization, `Bearer ${KEY}`)
  }, { rules: { key: KEY } })
})

test('OpenAI-kompatibel: IONOS-Fehlerformat und Hinweis auf abgelaufene Token', async () => {
  await withOpenAi(async (s) => {
    await putKey(s, { slot: 'text', key: 'eyJ-abgelaufen-1234567890' })
    const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.match(r.body.error, /IONOS AI Model Hub lehnt den Schlüssel ab\. IONOS-Token laufen/)
  }, { preset: 'ionos', rules: { key: 'eyJ-gueltig-1234567890', errorFormat: 'ionos' } })
})

test('OpenAI-kompatibel: bei 429 mit Retry-After wird gewartet und wiederholt', async () => {
  await withOpenAi(async (s, service) => {
    const started = Date.now()
    assert.equal((await uploadPdf(s, '/api/extract', { text: LONG_TEXT })).status, 200)
    assert.ok(Date.now() - started >= 900, 'Retry-After: 1 abgewartet')
    assert.ok(service.completions().length >= 2)
  }, { rules: { busyOnce: true } })
})

test('OpenAI-kompatibel: aufgebrauchtes Guthaben wird nicht wiederholt', async () => {
  await withOpenAi(async (s, service) => {
    const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.equal(r.status, 502)
    assert.match(r.body.error, /Guthaben oder Budget/)
    assert.equal(service.completions().length, 1)
  }, { rules: { quota: true } })
})

test('OpenAI-kompatibel: abgeschnittene Antwort, unbekanntes Modell, Zeitlimit', async () => {
  await withOpenAi(async (s) => {
    assert.match((await uploadPdf(s, '/api/extract', { text: LONG_TEXT })).body.error, /Höchstlänge von 16384 Token.*„Erweitert“/)
  }, { rules: { finish: 'length' } })
  await withOpenAi(async (s) => {
    assert.match((await uploadPdf(s, '/api/extract', { text: LONG_TEXT })).body.error, /kennt das Modell „gibt-es-nicht“ nicht/)
  }, { model: 'gibt-es-nicht' })
  await withOpenAi(async (s) => {
    assert.match((await uploadPdf(s, '/api/extract', { text: LONG_TEXT })).body.error, /nicht innerhalb von 2 Sekunden geantwortet/)
  }, { rules: { hang: true }, env: { NKA_AI_TIMEOUT: '2' } })
})

test('OpenAI-kompatibel: auch am Stück und mit Denktext davor kommt das Ergebnis an', async () => {
  await withOpenAi(async (s) => {
    assert.equal((await uploadPdf(s, '/api/extract', { text: LONG_TEXT })).status, 200)
  }, { rules: { whole: true } })
  await withOpenAi(async (s) => {
    assert.equal((await uploadPdf(s, '/api/extract', { text: LONG_TEXT })).status, 200)
  }, { rules: { reasoning: true } })
})

test('OpenAI-kompatibel: wiederholt der Dienst den Schlüssel in einer Meldung, wird er ausgeblendet', async () => {
  const KEY = 'sk-test-geheim-1234567890'
  await withOpenAi(async (s) => {
    const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.equal(r.status, 502)
    assert.match(r.body.error, /lehnt die Anfrage ab: Invalid request for credentials Bearer …/)
    assert.ok(!r.body.error.includes(KEY))
  }, { key: KEY, rules: { echoKey: true } })
})

// ---------- Vorlagen und Status für die Einstellungen (#18) ----------

test('Vorlagen: /api/ai/presets liefert alle Vorlagen mit Links und Eigenheiten', async () => {
  const presets = await srv.api('/api/ai/presets')
  const ids = presets.map((p) => p.id)
  assert.deepEqual(ids, ['ollama-local', 'ollama-remote', 'ollama-cloud', 'openai', 'ionos', 'mistral', 'lmstudio', 'openai-compatible'])
  const openai = presets.find((p) => p.id === 'openai')
  assert.equal(openai.keyUrl, 'https://platform.openai.com/api-keys')
  assert.equal(openai.key, 'required')
  assert.match(presets.find((p) => p.id === 'mistral').notice, /Training/)
})

test('Status: Modellliste eines OpenAI-kompatiblen Dienstes, sortiert, Bildverständnis wo gemeldet', async () => {
  await withOpenAi(async (s) => {
    const status = await s.api('/api/ai/status?slot=text')
    assert.equal(status.ok, true)
    assert.deepEqual(status.models, [
      { name: 'modell-a', sizeBytes: null, vision: true, remote: false },
      { name: 'modell-b', sizeBytes: null, vision: null, remote: false },
    ])
  })
})

test('Status: ein abgelehnter Schlüssel ergibt eine verständliche Meldung', async () => {
  await withOpenAi(async (s) => {
    const status = await s.api('/api/ai/status?slot=text')
    assert.equal(status.ok, false)
    assert.match(status.error, /verlangt einen Schlüssel/)
  }, { rules: { key: 'sk-test-1234567890abcdef' } })
})

test('Status: für Ollama wie bisher, für Bilder nur mit eigenem Anbieter', async () => {
  await withOllama(async (s) => {
    const status = await s.api('/api/ai/status?slot=text')
    assert.equal(status.ok, true)
    assert.equal(status.models[0].name, 'test:latest')
    const images = await s.api('/api/ai/status?slot=images')
    assert.equal(images.ok, false)
    assert.match(images.error, /Kein eigener Anbieter für Fotos und Scans/)
  })
})

test('Einstellungen: aiExternal sagt je Platz, ob die Adresse aus dem Haus zeigt', async () => {
  await withEnv({}, async (s) => {
    assert.deepEqual((await s.api('/api/settings')).aiExternal, { text: false, images: false })
    const saved = await putAi(s, { images: { provider: 'openai', preset: 'openai', url: 'https://api.openai.com/v1', model: 'gpt-5.4-nano', vision: true } })
    assert.deepEqual(saved.aiExternal, { text: false, images: true })
    // aiExternal gehört nicht in die db.json
    assert.equal(storedSettings(s).aiExternal, undefined)
  })
})

test('Einstellungen: ein Rumpf, der kein Objekt ist, ändert nichts', async () => {
  // express.json() lässt auch eine Liste durch. Deren Indizes landeten als Schlüssel „0“, „1“ …
  // in den Einstellungen, und die db.json trug sie von da an mit.
  const res = await fetch(`${srv.base}/api/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(['unsinn', 'noch mehr Unsinn']),
  })
  assert.equal(res.status, 200)
  assert.equal((await res.json())['0'], undefined)
  assert.equal((await srv.api('/api/settings'))['0'], undefined)
  assert.equal(JSON.parse(fs.readFileSync(path.join(srv.dataDir, 'db.json'), 'utf8')).settings['0'], undefined)
})

// ---------- Befunde aus der Codeprüfung ----------

test('Schlüssel: auch ein Fehler mitten im Strom zeigt ihn nicht', async () => {
  const KEY = 'sk-test-geheim-1234567890'
  await withOpenAi(async (s) => {
    const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.equal(r.status, 502)
    assert.match(r.body.error, /meldet einen Fehler: Ungültige Anmeldung mit Bearer …/)
    assert.ok(!r.body.error.includes(KEY))
  }, { key: KEY, rules: { echoKeyInStream: true } })
})

test('Schlüssel: auch Ollama hinter einem Proxy zeigt ihn nicht', async () => {
  const KEY = 'ollama-proxy-schluessel-1234'
  const ollama = await fakeOllama({ echoKey: true })
  const s = await startServerIn(fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-')))
  try {
    await putAi(s, { text: ollamaSlot(ollama.url) })
    await putKey(s, { slot: 'text', key: KEY })
    const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.equal(r.status, 502)
    assert.match(r.body.error, /Proxy lehnt ab: Bearer …/)
    assert.ok(!r.body.error.includes(KEY))
  } finally {
    s.stop()
    ollama.stop()
  }
})

// Zweite Runde der Durchsicht: dieselbe Lücke fand sich noch einmal, an je einer Stelle, die
// eine Antwort nicht als JSON lesen konnte (statt einen Fehlerstatus zu melden).
test('Schlüssel: eine unlesbare Antwort von Ollama zeigt ihn nicht', async () => {
  const KEY = 'ollama-status-schluessel-1234'
  const ollama = await fakeOllama({ garbledShow: true })
  const s = await startServerIn(fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-')))
  try {
    await putAi(s, { text: ollamaSlot(ollama.url) })
    await putKey(s, { slot: 'text', key: KEY })
    const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.equal(r.status, 502)
    assert.match(r.body.error, /unlesbare Antwort: kaputt: Bearer …/)
    assert.ok(!r.body.error.includes(KEY))
  } finally {
    s.stop()
    ollama.stop()
  }
})

test('Schlüssel: eine unlesbare Antwort mitten im Strom zeigt ihn nicht', async () => {
  const KEY = 'sk-test-geheim-strom-1234567890'
  await withOpenAi(async (s) => {
    const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.equal(r.status, 502)
    assert.match(r.body.error, /unlesbare Antwort: kaputt: Bearer …/)
    assert.ok(!r.body.error.includes(KEY))
  }, { key: KEY, rules: { garbledStream: true } })
})

// Der eigene Anbieter für Fotos und Scans ist gerade der Fall, für den die Trennung gedacht ist
test('Bestätigung: der Bilder-Anbieter braucht eine eigene, die des Standards zählt nicht', async () => {
  await withOllama(async (s) => {
    await putAi(s, { images: ollamaSlot(EXTERNAL, 'bild') })
    await s.api('/api/ai/consent', { method: 'POST', body: JSON.stringify({ slot: 'text' }) })
    const photo = new FormData()
    photo.append('file', new Blob([Buffer.from('JPEG-Foto')], { type: 'image/jpeg' }), 'rechnung.jpg')
    const res = await fetch(`${s.base}/api/extract`, { method: 'POST', body: photo })
    assert.equal(res.status, 502)
    const error = (await res.json()).error
    assert.match(error, /192\.0\.2\.1:11434/)
    assert.match(error, /Anbieter für Fotos und Scans/)
    // Text geht weiter an den Standard, der lokal läuft
    assert.equal((await uploadPdf(s, '/api/extract', { text: LONG_TEXT })).status, 200)
    const confirmed = await s.api('/api/ai/consent', { method: 'POST', body: JSON.stringify({ slot: 'images' }) })
    assert.equal(confirmed.ai.consent.images.url, EXTERNAL)
    assert.equal(confirmed.aiExternal.images, true)
  })
})

test('KI-Einstellungen: eine ältere Version darf Adresse und Modell noch über die alten Felder ändern', async () => {
  // Nach einem Downgrade schreibt die ältere Version nur ollamaUrl und ollamaModel. Weichen sie
  // beim nächsten Start von ai.text ab, gilt die jüngere Änderung.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    settings: {
      ollamaUrl: 'http://neu:11434',
      ollamaModel: 'neues:4b',
      ai: { text: { provider: 'ollama', preset: 'ollama-local', url: 'http://alt:11434', model: 'altes:4b', vision: null }, images: null, consent: {} },
    },
  }))
  const s = await startServerIn(dataDir)
  try {
    const { ai } = await s.api('/api/settings')
    assert.equal(ai.text.url, 'http://neu:11434')
    assert.equal(ai.text.model, 'neues:4b')
  } finally {
    s.stop()
  }
})

// ---------- Modell aus Mietfuchs laden (#33) ----------

// Wie der Browser: Fortschritt als Strom (Accept: application/x-ndjson)
async function pullAsStream(s, { model = 'neu:4b', requestId, slot } = {}) {
  const res = await fetch(`${s.base}/api/ai/pull`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
    body: JSON.stringify({ model, requestId, slot }),
  })
  const text = await res.text()
  return { status: res.status, type: res.headers.get('content-type') ?? '', lines: text.split('\n').filter(Boolean).map((l) => JSON.parse(l)) }
}

test('Modell laden: der Fortschritt kommt als Strom, am Ende meldet Mietfuchs Erfolg', async () => {
  await withOllama(async (s, ollama) => {
    const r = await pullAsStream(s)
    assert.equal(r.status, 200)
    assert.ok(r.type.includes('application/x-ndjson'), r.type)
    const progress = r.lines.filter((l) => l.type === 'progress')
    assert.ok(progress.length >= 2, JSON.stringify(r.lines).slice(0, 300))
    assert.ok(progress.some((p) => p.total > 0 && p.completed >= 0), JSON.stringify(progress))
    assert.equal(r.lines.at(-1).type, 'result')
    assert.deepEqual(ollama.requests.filter((a) => a.url === '/api/pull').map((a) => a.body.model), ['neu:4b'])
  })
})

test('Modell laden: Abbrechen per Kennung stoppt den Download', async () => {
  await withOllama(async (s, ollama) => {
    ollama.control.pullHangs = true
    const requestId = crypto.randomUUID().replaceAll('-', '')
    const pending = pullAsStream(s, { requestId }).catch(() => null)
    assert.ok(await until(() => ollama.requests.some((a) => a.url === '/api/pull'), 5000), 'Download läuft')
    const cancel = await fetch(`${s.base}/api/ai/cancel/${requestId}`, { method: 'POST' })
    assert.equal(cancel.status, 200)
    assert.ok(await until(() => ollama.closedEarly > 0, 5000), 'Ollama bekommt den Abbruch mit')
    await pending
  })
})

test('Modell laden: nur mit einem Ollama auf diesem Rechner oder im Heimnetz', async () => {
  await withOllama(async (s) => {
    // Ollama Cloud und andere Dienste bringen ihre Modelle mit
    await putAi(s, { text: { provider: 'ollama', preset: 'ollama-cloud', url: 'https://ollama.com', model: 'x:cloud', vision: null } })
    let r = await pullAsStream(s)
    assert.equal(r.status, 400)
    assert.match(r.lines[0]?.error ?? '', /Dienst im Internet/)
    await putAi(s, { text: { provider: 'openai', preset: 'openai', url: 'https://api.openai.com/v1', model: 'gpt-5.4-nano', vision: true } })
    r = await pullAsStream(s)
    assert.equal(r.status, 400)
  })
})

test('Modell laden: ein unsinniger Modellname wird abgelehnt', async () => {
  await withOllama(async (s, ollama) => {
    const r = await pullAsStream(s, { model: 'kein modell!' })
    assert.equal(r.status, 400)
    assert.match(r.lines[0]?.error ?? '', /Modellname/)
    assert.equal(ollama.requests.filter((a) => a.url === '/api/pull').length, 0)
  })
})

// ---------- Empfehlungen ----------

test('Empfehlungen: ohne Zustimmung die mitgelieferte Liste, mit Zustimmung die aus dem Netz', async () => {
  const http = await import('node:http')
  const liste = { format: 1, updated: '2026-10-05', models: [{ name: 'frisch:4b', provider: 'ollama', sizeGb: 2.1, vision: true, note: 'aus dem Netz' }] }
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(liste))
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  try {
    await withEnv({ NKA_MODELS_URL: `http://127.0.0.1:${server.address().port}/ki-modelle.json` }, async (s) => {
      const ohne = await s.api('/api/ai/recommendations')
      assert.equal(ohne.source, 'mitgeliefert')
      assert.ok(ohne.models.some((m) => m.name === 'qwen3.5:4b'), JSON.stringify(ohne.models.map((m) => m.name)))

      // Dieselbe Zustimmung wie beim Update-Hinweis
      const settings = await s.api('/api/settings')
      await s.api('/api/settings', { method: 'PUT', body: JSON.stringify({ ...settings, updateCheck: 'on' }) })
      const mit = await s.api('/api/ai/recommendations')
      assert.equal(mit.source, 'netz')
      assert.deepEqual(mit.models.map((m) => m.name), ['frisch:4b'])
      assert.equal(mit.updated, '2026-10-05')
    })
  } finally {
    server.close()
  }
})

test('Modell laden: geht auch für den eigenen Anbieter für Fotos und Scans', async () => {
  await withOllama(async (s, ollama) => {
    await putAi(s, { images: ollamaSlot(ollama.url, 'bild') })
    const r = await pullAsStream(s, { model: 'bild:4b', slot: 'images' })
    assert.equal(r.status, 200)
    assert.deepEqual(ollama.requests.filter((a) => a.url === '/api/pull').map((a) => a.body.model), ['bild:4b'])
    // Ohne eingerichteten Platz gibt es nichts zu laden
    await putAi(s, { images: null })
    assert.equal((await pullAsStream(s, { slot: 'images' })).status, 400)
  })
})

// ---------- Nettopositionen und §35a-Gesamtbetrag (#34) ----------

test('Auswertung: Nettopositionen werden brutto, der Lohnanteil aus dem Gesamtbetrag verteilt', async () => {
  await withOllama(async (s) => {
    const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const { extraction } = r.body
    const cents = (eur) => Math.round(eur * 100)
    assert.equal(extraction.positions.reduce((a, p) => a + cents(p.amountEur), 0), cents(101.86))
    assert.equal(extraction.positions.reduce((a, p) => a + cents(p.labor35aEur), 0), cents(90.56))
    assert.equal(extraction.amountsAdjusted, 'netto')
    assert.equal(extraction.laborFromTotal, true)
    // Die Hilfsfelder des Modells gehen nicht an den Browser
    assert.equal('positionsAreNet' in extraction, false)
    assert.equal('labor35aTotalEur' in extraction, false)
  }, { chat: 'netto' })
})

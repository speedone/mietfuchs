// Integrationstests gegen den echten Server: startet ihn als eigenen Prozess mit
// NKA_DATA_DIR auf einem Wegwerf-Ordner, damit weder eine vorhandene db.json noch die
// Belege im Arbeitsverzeichnis berührt werden. Geprüft wird, was die Engine-Tests nicht
// sehen: dass die generischen CRUD-Routen die neuen Felder durchlassen, dass die
// Löschkaskade aufräumt und dass die Abrechnungs-Routen liefern, was das Frontend erwartet.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Startet eine Server-Instanz auf einem eigenen Datenordner und wartet auf Bereitschaft.
async function startServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
  return startServerIn(dataDir)
}

// `env` ergänzt oder überschreibt Umgebungsvariablen. NKA_UPDATE_URL zeigt standardmäßig ins
// Leere (Port 9 nimmt keine Verbindung an): Kein Test darf versehentlich das echte GitHub fragen.
async function startServerIn(dataDir, env = {}) {
  const port = 34000 + Math.floor(Math.random() * 8000)
  const base = `http://127.0.0.1:${port}`
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: serverRoot,
    env: {
      ...process.env,
      NKA_UPDATE_URL: 'http://127.0.0.1:9/kein-internet-im-test',
      ...env,
      NKA_PORT: String(port),
      NKA_DATA_DIR: dataDir,
    },
    stdio: 'ignore',
  })
  const api = async (pfad, init) => {
    const res = await fetch(`${base}${pfad}`, {
      ...init,
      headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    })
    if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${pfad} → ${res.status}`)
    return res.json()
  }
  const deadline = Date.now() + 20000
  for (;;) {
    try {
      await api('/api/settings')
      break
    } catch {
      if (Date.now() > deadline) throw new Error('Server ist nicht gestartet')
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  // Sicherung: der Server muss wirklich im Wegwerf-Ordner arbeiten, sonst nichts weiter tun.
  assert.ok(fs.existsSync(path.join(dataDir, 'uploads')), 'NKA_DATA_DIR wird nicht beachtet')
  const stop = () => {
    child.kill()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
  return { api, dataDir, stop }
}

let srv

before(async () => {
  srv = await startServer()
})

after(() => srv?.stop())

test('Healthcheck: /healthz antwortet als JSON mit Status ok', async () => {
  // Antwortete hier die index.html, stünde die Route hinter dem Frontend-Catch-All — dann
  // meldete ein kaputter Container HTTP 200.
  const bericht = await srv.api('/healthz')
  assert.equal(bericht.status, 'ok')
  assert.equal(bericht.checks.data.ok, true)
  assert.equal(bericht.checks.uploads.ok, true)
})

test('Wohnungen: Eigennutzungs-Felder überleben Anlegen und Ändern', async () => {
  const unit = await srv.api('/api/units', {
    method: 'POST',
    body: JSON.stringify({ name: 'EG', areaM2: 80, participates: false, selfUsed: true, selfPersons: 2 }),
  })
  assert.equal(unit.selfUsed, true)
  assert.equal(unit.selfPersons, 2)
  const geaendert = await srv.api(`/api/units/${unit.id}`, {
    method: 'PUT',
    body: JSON.stringify({ name: 'EG', areaM2: 80, participates: true, selfUsed: false, selfPersons: null }),
  })
  assert.equal(geaendert.selfUsed, false)
  assert.equal(geaendert.selfPersons, null)
  await srv.api(`/api/units/${unit.id}`, { method: 'DELETE' })
})

test('Abrechnung: Eigenanteil kommt über die Route beim Frontend an', async () => {
  const eigen = await srv.api('/api/units', {
    method: 'POST',
    body: JSON.stringify({ name: 'EG', areaM2: 80, participates: false, selfUsed: true, selfPersons: 2 }),
  })
  const vermietet = await srv.api('/api/units', {
    method: 'POST',
    body: JSON.stringify({ name: 'OG', areaM2: 150, participates: true }),
  })
  const miete = await srv.api('/api/tenancies', {
    method: 'POST',
    body: JSON.stringify({
      unitId: vermietet.id, tenantName: 'Familie A', start: '2020-01-01', end: null,
      personHistory: [{ from: '2020-01-01', persons: 2 }], prepayments: [], baseRents: [], prepaymentOverrides: {},
    }),
  })
  const kosten = await srv.api('/api/costItems', {
    method: 'POST',
    body: JSON.stringify({ year: 2031, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 230000, key: 'area' }),
  })

  const s = await srv.api('/api/settlement/2031')
  assert.equal(s.statements[0].totalShareCents, 150000) // 150 von 230 m²
  assert.equal(s.landlord.totalCents, 80000)
  assert.equal(s.selfUsedShareCents, 80000)

  const steuer = await srv.api('/api/taxreport/2031')
  assert.equal(steuer.selfUsedShareCents, 80000)
  assert.equal(steuer.selfOccupiedExists, true)

  await srv.api(`/api/costItems/${kosten.id}`, { method: 'DELETE' })
  await srv.api(`/api/tenancies/${miete.id}`, { method: 'DELETE' })
  await srv.api(`/api/units/${eigen.id}`, { method: 'DELETE' })
  await srv.api(`/api/units/${vermietet.id}`, { method: 'DELETE' })
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
  const nachher = items.find((x) => x.id === item.id)
  assert.deepEqual(Object.keys(nachher.customShares), [a.id], 'Anteil der gelöschten Wohnung bleibt zurück')

  await srv.api(`/api/costItems/${item.id}`, { method: 'DELETE' })
  await srv.api(`/api/units/${a.id}`, { method: 'DELETE' })
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
  const alt = await startServerIn(dataDir)
  try {
    const s = await alt.api('/api/settlement/2030')
    assert.equal(s.selfUsedShareCents, 0)
    assert.equal(s.closed.closedAt, '2031-01-05')
  } finally {
    alt.stop()
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
  const anfragen = []
  const server = http.createServer((req, res) => {
    anfragen.push(req.url)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(releaseJson)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${server.address().port}/repos/speedone/mietfuchs/releases/latest`
  return { url, anfragen, stop: () => server.close() }
}

async function mitUpdateServer(env, fn) {
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
  await mitUpdateServer({}, async (s, github) => {
    const status = await s.api('/api/update')
    assert.equal(status.enabled, false)
    assert.equal(status.available, false)
    // auch „Jetzt prüfen" darf ohne Zustimmung nichts anfragen
    await s.api('/api/update/check', { method: 'POST', body: '{}' })
    await s.api('/api/settings', { method: 'PUT', body: JSON.stringify({ updateCheck: 'off' }) })
    await s.api('/api/update')
    assert.equal(github.anfragen.length, 0)
  })
})

test('Update-Hinweis: mit Zustimmung meldet der Server die neue Version', async () => {
  await mitUpdateServer({}, async (s, github) => {
    await s.api('/api/settings', { method: 'PUT', body: JSON.stringify({ updateCheck: 'on' }) })
    const status = await s.api('/api/update')
    assert.equal(github.anfragen.length, 1)
    assert.equal(status.enabled, true)
    assert.equal(status.current, serverVersion)
    assert.equal(status.latest, '9.9.9')
    assert.equal(status.available, true)
    assert.equal(status.mode, 'npm') // der Test startet den Server mit node, ohne Programmdatei
    assert.equal(status.releaseUrl, 'https://github.com/speedone/mietfuchs/releases/tag/v9.9.9')
    // Bis zum nächsten Tag kommt das gemerkte Ergebnis. „Jetzt prüfen" fragt neu, aber höchstens
    // einmal pro Minute; wann genau, prüft update.test.js mit gestellter Uhr.
    await s.api('/api/update')
    assert.equal(github.anfragen.length, 1)
    const neu = await s.api('/api/update/check', { method: 'POST', body: '{}' })
    assert.equal(github.anfragen.length, 1)
    assert.equal(neu.latest, '9.9.9')
  })
})

test('Update-Hinweis: im Docker-Container lautet die Betriebsart docker', async () => {
  await mitUpdateServer({ NKA_RUNTIME: 'docker' }, async (s) => {
    await s.api('/api/settings', { method: 'PUT', body: JSON.stringify({ updateCheck: 'on' }) })
    const status = await s.api('/api/update')
    assert.equal(status.mode, 'docker')
    assert.equal(status.downloadUrl, null)
  })
})

test('Version: /healthz und der Update-Hinweis nennen die Version aus package.json', async () => {
  const bericht = await srv.api('/healthz')
  const status = await srv.api('/api/update')
  assert.equal(bericht.version, serverVersion)
  assert.equal(status.current, serverVersion)
})

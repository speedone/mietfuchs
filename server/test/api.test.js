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
import AdmZip from 'adm-zip'

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Startet eine Server-Instanz auf einem eigenen Datenordner und wartet auf Bereitschaft.
async function startServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
  return startServerIn(dataDir)
}

// `env` ergänzt oder überschreibt Umgebungsvariablen. NKA_UPDATE_URL zeigt standardmäßig ins
// Leere (Port 9 nimmt keine Verbindung an): Kein Test darf versehentlich das echte GitHub fragen.
// Die KI-Variablen aus der Shell des Entwicklers gelten nicht: Leere Werte zählen als nicht
// gesetzt, und eine leere Kandidatenliste schaltet die Suche nach Ollama ab.
async function startServerIn(dataDir, env = {}) {
  const port = 34000 + Math.floor(Math.random() * 8000)
  const base = `http://127.0.0.1:${port}`
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: serverRoot,
    env: {
      ...process.env,
      NKA_UPDATE_URL: 'http://127.0.0.1:9/kein-internet-im-test',
      NKA_OLLAMA_URL: '',
      NKA_OLLAMA_MODEL: '',
      NKA_OLLAMA_NUM_CTX: '',
      NKA_OLLAMA_CANDIDATES: '',
      NKA_AI_TIMEOUT: '',
      NKA_RUNTIME: '',
      ...env,
      NKA_PORT: String(port),
      NKA_DATA_DIR: dataDir,
    },
    stdio: 'ignore',
  })
  const api = async (urlPath, init) => {
    const res = await fetch(`${base}${urlPath}`, {
      ...init,
      headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    })
    if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${urlPath} → ${res.status}`)
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
  return { api, base, dataDir, stop }
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
// schickt mitten im Strom eine Fehlerzeile. `closedEarly` zählt Chat-Anfragen, deren
// Verbindung Mietfuchs vor dem Ende getrennt hat.
async function fakeOllama({ models = [{ name: 'test:latest', capabilities: ['completion', 'vision'] }], chat = 'normal' } = {}) {
  const http = await import('node:http')
  const requests = []
  const open = new Set()
  const state = { closedEarly: 0 }
  const findModel = (name = '') => models.find((m) => m.name === (name.includes(':') ? name : `${name}:latest`))
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (d) => { body += d })
    req.on('end', () => {
      const json = body ? JSON.parse(body) : {}
      requests.push({ url: req.url, body: json })
      const send = (status, data) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(data))
      }
      const notFound = () => send(404, { error: `model '${json.model}' not found` })
      if (req.url === '/api/version') return send(200, { version: '0.34.2' })
      if (req.url === '/api/tags') {
        return send(200, { models: models.map(({ capabilities, ...m }) => ({ size: 1000, ...m })) })
      }
      if (req.url === '/api/show') {
        const m = findModel(json.model)
        return m ? send(200, { capabilities: m.capabilities, remote_host: m.remote_host }) : notFound()
      }
      if (!findModel(json.model)) return notFound()
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
    assert.deepEqual(settings.fixedByEnv, ['ollamaUrl', 'ollamaModel'])
  })
})

test('Ollama: Speichern lässt fest vorgegebene Werte unberührt, alles andere wird gespeichert', async () => {
  await withEnv({ NKA_OLLAMA_URL: 'http://ki.intern:11434' }, async (s) => {
    const response = await s.api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ ollamaUrl: 'http://anders:11434', ollamaModel: 'eigenes:2b', landlordName: 'Vermieterin', fixedByEnv: [] }),
    })
    assert.equal(response.ollamaUrl, 'http://ki.intern:11434')
    assert.deepEqual(response.fixedByEnv, ['ollamaUrl'])
    const stored = storedSettings(s)
    assert.equal(stored.ollamaUrl, 'http://localhost:11434') // Standard bleibt, Env landet nicht in der db.json
    assert.equal(stored.ollamaModel, 'eigenes:2b')
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

test('Ollama: NKA_OLLAMA_NUM_CTX ändert die Kontextgröße, ungültige Werte zählen nicht', async () => {
  for (const [value, expected] of [['8192', 8192], ['viel', 16384], ['0', 16384]]) {
    const ollama = await fakeOllama()
    try {
      await withEnv({ NKA_OLLAMA_URL: ollama.url, NKA_OLLAMA_MODEL: 'test', NKA_OLLAMA_NUM_CTX: value }, async (s) => {
        await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
        assert.equal(chatOptions(ollama)[0].num_ctx, expected, `NKA_OLLAMA_NUM_CTX=${value}`)
      })
    } finally {
      ollama.stop()
    }
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
    assert.match(r.body.error, /NKA_OLLAMA_NUM_CTX/)
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
    const child = spawn(process.execPath, ['src/index.js'], {
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

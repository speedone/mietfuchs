// Integrationstests gegen den echten Server: Ollama: Strom, Zeitlimit, Abbruch, Modellauswahl und Fehler.
//
// Jeder Test startet den Server als eigenen Prozess mit NKA_DATA_DIR auf einem Wegwerf-Ordner;
// die gemeinsamen Helfer stehen in testing/api.ts. Bis #263 stand dieser Teil mit allen anderen
// in api.test.ts und lief mit ihnen nacheinander.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { OllamaStatus, UploadInfo } from '../../shared/types.ts'
import {
  type ClientSettings, LONG_TEXT, type Ollama, PDF, type Server, type StreamLine, base64, chatRequests, errorFrom, errorOf, fakeOllama, fileOf, firstMessage, lastLine, listening, page, parseLine, portOf, startServer, startServerIn, until, uploadPdf, withEnv, withOllama,
} from '../testing/api.ts'

let srv: Awaited<ReturnType<typeof startServerIn>>

before(async () => {
  srv = await startServer()
})

after(() => srv?.stop())

// ---------- Ollama: Streaming, Zeitlimit und Abbruch (#17) ----------

test('Ollama: die Antwort kommt als Strom und wird zusammengesetzt', async () => {
  await withOllama(async (s, ollama) => {
    const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.equal(r.status, 200)
    assert.equal(r.body.extraction?.vendor, 'Stadtwerke Musterstadt')
    assert.equal(r.body.extraction?.positions?.[0].category, 'Wasser/Abwasser')
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
    assert.match(errorOf(r.body), /nicht innerhalb von 2 Sekunden geantwortet/)
    assert.deepEqual([r.body.reason, r.body.kept], ['timeout', true])
    assert.ok(Date.now() - start < 15000, 'das Zeitlimit wurde nicht eingehalten')
  }, { chat: 'hang', env: { NKA_AI_TIMEOUT: '2' } })
})

test('Ollama: verstummt Ollama mitten im Strom, greift ebenfalls das Zeitlimit', async () => {
  await withOllama(async (s) => {
    const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.equal(r.status, 502)
    assert.match(errorOf(r.body), /nicht innerhalb von 2 Sekunden geantwortet/)
  }, { chat: 'hangAfterFirstChunk', env: { NKA_AI_TIMEOUT: '2' } })
})

test('Ollama: eine am Kontextende abgeschnittene Antwort ergibt eine klare Meldung', async () => {
  await withOllama(async (s) => {
    const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.equal(r.status, 502)
    assert.match(errorOf(r.body), /abgeschnitten/)
    assert.match(errorOf(r.body), /Kontext von 16384 Token.*unter „Erweitert“/)
  }, { chat: 'length' })
})

test('Ollama: ein Fehler mitten im Strom kommt lesbar an', async () => {
  await withOllama(async (s) => {
    const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.equal(r.status, 502)
    assert.match(errorOf(r.body), /Ollama meldet einen Fehler: model runner has unexpectedly stopped/)
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
    assert.deepEqual(await s.api<UploadInfo[]>('/api/uploads'), [])
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
    assert.deepEqual(await s.api<UploadInfo[]>('/api/uploads'), [])
    await pending // der Strom endet, statt offen zu hängen
    // Danach ist die Kennung verbraucht
    assert.equal((await fetch(`${s.base}/api/ai/cancel/${requestId}`, { method: 'POST' })).status, 404)
  }, { chat: 'hang' })
})

test('Abbrechen per Kennung: unbekannte oder ungültige Kennungen ergeben 404', async () => {
  for (const id of ['ffffffffffffffffffffffffffffffff', 'kurz', '../../etc']) {
    const res = await fetch(`${srv.base}/api/ai/cancel/${encodeURIComponent(id)}`, { method: 'POST' })
    assert.equal(res.status, 404, id)
    assert.match(await errorFrom(res), /Keine laufende Auswertung/)
  }
})

// ---------- KI-Auswertung als Strom zum Browser (#17) ----------
// Firefox wartet höchstens 300 Sekunden auf die Antwort-Header (network.http.response.timeout).
// Fordert der Browser mit Accept: application/x-ndjson an, schickt Mietfuchs die Header sofort,
// danach Fortschritt, Lebenszeichen und zuletzt Ergebnis oder Fehler, je eine JSON-Zeile.

async function uploadStreaming(s: Server, route: string, { text, signal }: { text?: string, signal?: AbortSignal } = {}) {
  const fd = new FormData()
  fd.append('file', new Blob([PDF], { type: 'application/pdf' }), 'rechnung.pdf')
  if (text !== undefined) fd.append('pdfText', text)
  const res = await fetch(`${s.base}${route}`, { method: 'POST', body: fd, headers: { accept: 'application/x-ndjson' }, signal })
  return res
}
const linesOf = async (res: Response): Promise<StreamLine[]> =>
  (await res.text()).split('\n').filter(Boolean).map(parseLine)

test('Strom: Fortschritt je Schritt und am Ende das Ergebnis wie bisher', async () => {
  await withOllama(async (s) => {
    const res = await uploadStreaming(s, '/api/extract', { text: LONG_TEXT })
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') ?? '', /application\/x-ndjson/)
    const lines = await linesOf(res)
    const result = lastLine(lines)
    assert.equal(result.type, 'result')
    assert.equal(result.data?.extraction?.vendor, 'Stadtwerke Musterstadt')
    assert.match(fileOf(result.data ?? {}), /rechnung\.pdf$/)
    const progress = lines.filter((l) => l.type === 'progress').map((l) => `${l.step}:${l.phase}`)
    assert.ok(progress.includes('extraction:waiting'), progress.join(' '))
    assert.ok(progress.includes('extraction:writing'), progress.join(' '))
    assert.ok(progress.includes('classification:waiting'), progress.join(' '))
    const writing = lines.find((l) => l.phase === 'writing')
    assert.ok((writing?.chars ?? 0) > 0)
  })
})

test('Strom: ein Fehler kommt als letzte Zeile, samt Beleg', async () => {
  await withOllama(async (s) => {
    const res = await uploadStreaming(s, '/api/extract', { text: LONG_TEXT })
    assert.equal(res.status, 200)
    const last = lastLine(await linesOf(res))
    assert.equal(last.type, 'error')
    assert.match(errorOf(last), /nicht installiert/)
    assert.match(fileOf(last), /rechnung\.pdf$/)
    assert.deepEqual([last.reason, last.kept], ['model', true])
  }, { model: 'fehlt:4b' })
})

test('Strom: die Header kommen sofort, auch wenn das Modell noch schweigt, danach Lebenszeichen', async () => {
  await withOllama(async (s) => {
    const start = Date.now()
    const res = await uploadStreaming(s, '/api/extract', { text: LONG_TEXT })
    assert.ok(Date.now() - start < 3000, 'die Header kamen erst mit der Antwort')
    const lines = await linesOf(res)
    assert.ok(lines.some((l) => l.type === 'heartbeat'), 'kein Lebenszeichen während des Wartens')
    assert.match(errorOf(lastLine(lines)), /nicht innerhalb von 12 Sekunden/)
  }, { chat: 'hang', env: { NKA_AI_TIMEOUT: '12' } })
})

test('Strom: der Schuhkarton (/api/intake) streamt ebenso', async () => {
  await withOllama(async (s) => {
    const lines = await linesOf(await uploadStreaming(s, '/api/intake', { text: LONG_TEXT }))
    assert.equal(lastLine(lines).type, 'result')
    assert.equal(lastLine(lines).data?.kind, 'rechnung')
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
    const status = await s.api<OllamaStatus>('/api/ollama/status')
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
    await s.api<ClientSettings>('/api/settings', { method: 'PUT', body: JSON.stringify({ ollamaUrl: `${UNREACHABLE}/` }) })
    const status = await s.api<OllamaStatus>('/api/ollama/status')
    assert.equal(status.ok, false)
    assert.match(errorOf(status), /Ollama ist unter http:\/\/127\.0\.0\.1:9 nicht erreichbar/)
    const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.equal(r.status, 502)
    assert.match(errorOf(r.body), /Ollama ist unter http:\/\/127\.0\.0\.1:9 nicht erreichbar/)
  } finally {
    s.stop()
  }
})

// Fehler mit Ausweg: Der Beleg ist vor der Auswertung gespeichert. Scheitert die KI, sagt die Antwort warum
// (`reason`) und dass er im Posteingang liegt (`kept`); ein neuer Versuch nennt ihn nur und lädt nicht neu hoch.
test('Fehler mit Ausweg: ist Ollama nicht erreichbar, bleibt der Beleg im Posteingang, und ein neuer Versuch legt keine Kopie an', async () => {
  const s = await startServer()
  try {
    await s.api<ClientSettings>('/api/settings', { method: 'PUT', body: JSON.stringify({ ollamaUrl: UNREACHABLE }) })
    const r = await uploadPdf(s, '/api/intake', { text: LONG_TEXT })
    assert.equal(r.status, 502)
    assert.deepEqual([r.body.reason, r.body.kept], ['unreachable', true])
    const file = fileOf(r.body)
    const stored = await s.api<UploadInfo[]>('/api/uploads')
    assert.deepEqual(stored.map((u) => [u.file, u.kind]), [[file, 'receipt']], 'der Beleg liegt im Belegordner')
    // Der neue Versuch als Strom, wie der Browser ihn schickt
    const again = new FormData()
    again.append('existingFile', file)
    again.append('pdfText', LONG_TEXT)
    const res = await fetch(`${s.base}/api/extract`, { method: 'POST', body: again, headers: { accept: 'application/x-ndjson' } })
    const last = lastLine(await linesOf(res))
    assert.equal(last.type, 'error')
    assert.deepEqual([last.reason, last.kept, last.file], ['unreachable', true, file])
    assert.deepEqual((await s.api<UploadInfo[]>('/api/uploads')).map((u) => u.file), [file], 'keine Kopie im Ordner')
  } finally {
    s.stop()
  }
})

test('Ollama: ein nicht installiertes Modell nennt den Befehl zum Laden', async () => {
  await withOllama(async (s) => {
    const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.equal(r.status, 502)
    assert.match(errorOf(r.body), /„fehlt:4b“ ist in Ollama nicht installiert/)
    assert.match(errorOf(r.body), /ollama pull fehlt:4b/)
    assert.equal(r.body.reason, 'model')
  }, { model: 'fehlt:4b' })
})

test('Ollama: ein Modell ohne Bildverständnis bekommt keine Bilder, sondern eine klare Meldung', async () => {
  await withOllama(async (s, ollama) => {
    const scan = await uploadPdf(s, '/api/extract', { pages: [page(1)] })
    assert.equal(scan.status, 502)
    assert.match(errorOf(scan.body), /„text:8b“ versteht keine Bilder/)
    assert.equal(scan.body.reason, 'model')
    const photo = new FormData()
    photo.append('file', new Blob([Buffer.from('JPEG-Foto')], { type: 'image/jpeg' }), 'zaehler.jpg')
    const intake = await fetch(`${s.base}/api/intake`, { method: 'POST', body: photo })
    assert.equal(intake.status, 502)
    assert.match(await errorFrom(intake), /versteht keine Bilder/)
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
  await listening(broken, '127.0.0.1')
  const ollama = await fakeOllama()
  try {
    await withEnv({ NKA_OLLAMA_CANDIDATES: ollama.url }, async (s) => {
      await s.api<ClientSettings>('/api/settings', { method: 'PUT', body: JSON.stringify({ ollamaUrl: `http://127.0.0.1:${portOf(broken)}` }) })
      const status = await s.api<OllamaStatus>('/api/ollama/status')
      assert.equal(status.ok, false)
      assert.match(errorOf(status), /Ollama antwortet mit 500/)
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
      await s.api<ClientSettings>('/api/settings', { method: 'PUT', body: JSON.stringify({ ollamaUrl: 'http://127.0.0.1:10' }) })
      const status = await s.api<OllamaStatus>('/api/ollama/status')
      assert.equal(status.ok, false)
      assert.equal(status.found, ollama.url)
    })
    // Hat der Betreiber die Adresse festgelegt, bleibt es bei der Meldung
    await withEnv({ NKA_OLLAMA_CANDIDATES: candidates, NKA_OLLAMA_URL: 'http://127.0.0.1:10' }, async (s) => {
      const status = await s.api<OllamaStatus>('/api/ollama/status')
      assert.equal(status.ok, false)
      assert.equal(status.found, undefined)
    })
  } finally {
    ollama.stop()
  }
})

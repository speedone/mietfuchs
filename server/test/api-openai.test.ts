// Integrationstests gegen den echten Server: OpenAI-kompatible Dienste, Vorlagen, Modelle laden, Empfehlungen und die Antwort des Modells.
//
// Jeder Test startet den Server als eigenen Prozess mit NKA_DATA_DIR auf einem Wegwerf-Ordner;
// die gemeinsamen Helfer stehen in testing/api.ts. Bis #263 stand dieser Teil mit allen anderen
// in api.test.ts und lief mit ihnen nacheinander.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AiPreset, AiRecommendations, AiSlotName, AiStatus } from '../../shared/types.ts'
import {
  type ClientSettings, EXTERNAL, LONG_TEXT, type OpenAiContentPart, type OpenAiMessage, type OpenAiRequest, type OpenAiService, type Server, type WithOpenAiOptions, errorFrom, errorOf, fakeOllama, fakeOpenAi, jsonOf, lastLine, listening, messageOf, ollamaSlot, parseLine, photoForm, portOf, putAi, putKey, startServer, startServerBeside, startServerIn, storedSettings, until, uploadPdf, withEnv, withOllama,
} from '../testing/api.ts'

let srv: Awaited<ReturnType<typeof startServerIn>>

before(async () => {
  srv = await startServer()
})

after(() => srv?.stop())

// Der Text einer Nachricht, gleich ob sie als Zeichenkette oder als Liste von Teilen kam.
const textOf = (m: OpenAiMessage): string =>
  typeof m.content === 'string' ? m.content : m.content.map((p) => p.text ?? '').join('')

// Die Teile einer Nachricht. Nur ein Beleg mit Bild wird so geschickt.
const partsOf = (m: OpenAiMessage): OpenAiContentPart[] => {
  if (typeof m.content === 'string') assert.fail('die Nachricht besteht nur aus Text, nicht aus Teilen')
  return m.content
}

// ---------- OpenAI-kompatible Dienste (#18) ----------

// Die n-te Chat-Anfrage an den Dienst. Fehlt sie, hat Mietfuchs weniger gefragt als erwartet.
const completionOf = (service: OpenAiService, n: number): OpenAiRequest => {
  const request = service.completions()[n]
  if (!request) assert.fail(`es gibt keine ${n + 1}. Anfrage an den Dienst`)
  return request
}

async function withOpenAi(fn: (s: Server, service: OpenAiService) => Promise<void>, { rules = {}, preset = 'openai-compatible', model = 'modell-a', vision = null, key = null, ai = {}, env = {} }: WithOpenAiOptions = {}) {
  const service = await fakeOpenAi(rules)
  const s = await startServerBeside(service, fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-')), env)
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
    assert.equal(r.body.extraction?.vendor, 'Stadtwerke Musterstadt')
    assert.equal(r.body.extraction?.positions?.[0].category, 'Wasser/Abwasser')
    const first = completionOf(service, 0)
    assert.equal(first.body.stream, true)
    assert.deepEqual(first.body.stream_options, { include_usage: true })
    assert.equal(first.body.max_tokens, 16384) // Eigener Dienst: das verbreitete Feld
    assert.equal(first.body.temperature, 0)
    assert.equal(first.body.response_format?.type, 'json_schema')
    assert.equal(first.body.response_format?.json_schema?.strict, true)
    assert.equal(first.body.response_format?.json_schema?.schema?.additionalProperties, false)
    assert.equal(first.headers.accept, 'text/event-stream')
    assert.equal(first.headers['content-length'], String(Buffer.byteLength(first.raw)))
    assert.equal(first.headers['transfer-encoding'], undefined)
    const extraction = (r.body.stats ?? []).find((x) => x.step === 'extraction')
    assert.equal(extraction?.promptTokens, 900)
    assert.equal(extraction?.outputTokens, 40)
  })
})

test('OpenAI-kompatibel: Vorlage OpenAI schickt max_completion_tokens und keine Temperatur', async () => {
  await withOpenAi(async (s, service) => {
    assert.equal((await uploadPdf(s, '/api/extract', { text: LONG_TEXT })).status, 200)
    const first = completionOf(service, 0)
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
    const first = completionOf(service, 0)
    const parts = partsOf(messageOf(first.body.messages))
    assert.equal(parts[0].type, 'text')
    assert.deepEqual(parts[1], { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${Buffer.from('JPEG-Foto').toString('base64')}` } })
  })
  await withOpenAi(async (s, service) => {
    const res = await fetch(`${s.base}/api/extract`, { method: 'POST', body: photoForm() })
    assert.equal(res.status, 502)
    const body = await jsonOf<{ error?: string, reason?: string }>(res)
    assert.match(body.error ?? '', /versteht das Modell „modell-a“ keine Bilder/)
    assert.equal(body.reason, 'model')
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
    const first = completionOf(service, 0)
    const second = completionOf(service, 1)
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
    assert.match(textOf(messageOf(service.completions()[2].body.messages)), /JSON-Schema/)
  }, { rules: { rejectJsonSchema: true } })
})

test('OpenAI-kompatibel: LM Studio überspringt json_object, zuletzt zählt der Prompt allein', async () => {
  await withOpenAi(async (s, service) => {
    const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.extraction?.vendor, 'Stadtwerke Musterstadt') // aus dem Codeblock gelöst
    const formats = service.completions().map((c) => c.body.response_format?.type ?? 'keins')
    assert.deepEqual(formats.slice(0, 3), ['json_schema', 'json_schema', 'keins'])
    assert.ok(!formats.includes('json_object'))
  }, { preset: 'lmstudio', rules: { rejectJsonSchema: true, rejectJsonObject: true, fenced: true } })
})

test('OpenAI-kompatibel: Schlüssel als Bearer, verständliche Meldungen ohne den Schlüssel', async () => {
  const KEY = 'sk-test-richtig-1234567890'
  await withOpenAi(async (s, service) => {
    const without = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.match(errorOf(without.body), /verlangt einen Schlüssel/)
    assert.deepEqual([without.body.reason, without.body.kept], ['key', true])
    await putKey(s, { slot: 'text', key: 'sk-test-falsch-0987654321' })
    const wrong = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.match(errorOf(wrong.body), /lehnt den Schlüssel ab/)
    assert.equal(wrong.body.reason, 'key')
    assert.ok(!errorOf(wrong.body).includes('sk-test-falsch'))
    await putKey(s, { slot: 'text', key: KEY })
    assert.equal((await uploadPdf(s, '/api/extract', { text: LONG_TEXT })).status, 200)
    assert.equal(service.completions().at(-1)?.headers.authorization, `Bearer ${KEY}`)
  }, { rules: { key: KEY } })
})

test('OpenAI-kompatibel: IONOS-Fehlerformat und Hinweis auf abgelaufene Token', async () => {
  await withOpenAi(async (s) => {
    await putKey(s, { slot: 'text', key: 'eyJ-abgelaufen-1234567890' })
    const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.match(errorOf(r.body), /IONOS AI Model Hub lehnt den Schlüssel ab\. IONOS-Token laufen/)
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
    assert.match(errorOf(r.body), /Guthaben oder Budget/)
    assert.equal(r.body.reason, 'quota')
    assert.equal(service.completions().length, 1)
  }, { rules: { quota: true } })
})

test('OpenAI-kompatibel: abgeschnittene Antwort, unbekanntes Modell, Zeitlimit', async () => {
  await withOpenAi(async (s) => {
    const cut = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.match(errorOf(cut.body), /Höchstlänge von 16384 Token.*„Erweitert“/)
    assert.equal(cut.body.reason, 'model')
  }, { rules: { finish: 'length' } })
  await withOpenAi(async (s) => {
    const unknown = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.match(errorOf(unknown.body), /kennt das Modell „gibt-es-nicht“ nicht/)
    assert.equal(unknown.body.reason, 'model')
  }, { model: 'gibt-es-nicht' })
  await withOpenAi(async (s) => {
    const slow = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.match(errorOf(slow.body), /nicht innerhalb von 2 Sekunden geantwortet/)
    assert.equal(slow.body.reason, 'timeout')
  }, { rules: { hang: true }, env: { NKA_AI_TIMEOUT: '2' } })
})

// Fehler mit Ausweg (#487): Schickt die Meldung in die Einstellungen (falsche Adresse), bietet die Oberfläche sie an.
test('Fehler mit Ausweg: ohne Chat-Schnittstelle unter der Adresse ist der Grund „address“', async () => {
  await withOpenAi(async (s, service) => {
    await putAi(s, { text: { provider: 'openai', preset: 'openai-compatible', url: `${service.url}/falsch`, model: 'modell-a', vision: null } })
    const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.match(errorOf(r.body), /keine Chat-Schnittstelle/)
    assert.deepEqual([r.body.reason, r.body.kept], ['address', true])
  })
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
    assert.match(errorOf(r.body), /lehnt die Anfrage ab: Invalid request for credentials Bearer …/)
    assert.ok(!errorOf(r.body).includes(KEY))
  }, { key: KEY, rules: { echoKey: true } })
})

// ---------- Vorlagen und Status für die Einstellungen (#18) ----------

test('Vorlagen: /api/ai/presets liefert alle Vorlagen mit Links und Eigenheiten', async () => {
  const presets = await srv.api<AiPreset[]>('/api/ai/presets')
  const ids = presets.map((p) => p.id)
  assert.deepEqual(ids, ['ollama-local', 'ollama-remote', 'ollama-cloud', 'openai', 'ionos', 'mistral', 'lmstudio', 'openai-compatible'])
  const openai = presets.find((p) => p.id === 'openai')
  assert.equal(openai?.keyUrl, 'https://platform.openai.com/api-keys')
  assert.equal(openai?.key, 'required')
  assert.match(presets.find((p) => p.id === 'mistral')?.notice ?? '', /Training/)
})

test('Status: Modellliste eines OpenAI-kompatiblen Dienstes, sortiert, Bildverständnis wo gemeldet', async () => {
  await withOpenAi(async (s) => {
    const status = await s.api<AiStatus>('/api/ai/status?slot=text')
    assert.equal(status.ok, true)
    assert.deepEqual(status.models, [
      { name: 'modell-a', sizeBytes: null, vision: true, remote: false },
      { name: 'modell-b', sizeBytes: null, vision: null, remote: false },
    ])
  })
})

test('Status: ein abgelehnter Schlüssel ergibt eine verständliche Meldung', async () => {
  await withOpenAi(async (s) => {
    const status = await s.api<AiStatus>('/api/ai/status?slot=text')
    assert.equal(status.ok, false)
    assert.match(errorOf(status), /verlangt einen Schlüssel/)
  }, { rules: { key: 'sk-test-1234567890abcdef' } })
})

test('Status: für Ollama wie bisher, für Bilder nur mit eigenem Anbieter', async () => {
  await withOllama(async (s) => {
    const status = await s.api<AiStatus>('/api/ai/status?slot=text')
    assert.equal(status.ok, true)
    assert.equal(status.models?.[0].name, 'test:latest')
    const images = await s.api<AiStatus>('/api/ai/status?slot=images')
    assert.equal(images.ok, false)
    assert.match(errorOf(images), /Kein eigener Anbieter für Fotos und Scans/)
  })
})

test('Einstellungen: aiExternal sagt je Platz, ob die Adresse aus dem Haus zeigt', async () => {
  await withEnv({}, async (s) => {
    assert.deepEqual((await s.api<ClientSettings>('/api/settings')).aiExternal, { text: false, images: false })
    const saved = await putAi(s, { images: { provider: 'openai', preset: 'openai', url: 'https://api.openai.com/v1', model: 'gpt-5.4-nano', vision: true } })
    assert.deepEqual(saved.aiExternal, { text: false, images: true })
    // aiExternal gehört nicht in die db.json
    assert.equal((await storedSettings(s)).aiExternal, undefined)
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
  assert.ok(!('0' in await jsonOf<ClientSettings>(res)))
  assert.ok(!('0' in await srv.api<ClientSettings>('/api/settings')))
  assert.ok(!('0' in await storedSettings(srv)))
})

// ---------- Befunde aus der Codeprüfung ----------

test('Schlüssel: auch ein Fehler mitten im Strom zeigt ihn nicht', async () => {
  const KEY = 'sk-test-geheim-1234567890'
  await withOpenAi(async (s) => {
    const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.equal(r.status, 502)
    assert.match(errorOf(r.body), /meldet einen Fehler: Ungültige Anmeldung mit Bearer …/)
    assert.ok(!errorOf(r.body).includes(KEY))
  }, { key: KEY, rules: { echoKeyInStream: true } })
})

test('Schlüssel: auch Ollama hinter einem Proxy zeigt ihn nicht', async () => {
  const KEY = 'ollama-proxy-schluessel-1234'
  const ollama = await fakeOllama({ echoKey: true })
  const s = await startServerBeside(ollama, fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-')))
  try {
    await putAi(s, { text: ollamaSlot(ollama.url) })
    await putKey(s, { slot: 'text', key: KEY })
    const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.equal(r.status, 502)
    assert.match(errorOf(r.body), /Proxy lehnt ab: Bearer …/)
    assert.ok(!errorOf(r.body).includes(KEY))
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
  const s = await startServerBeside(ollama, fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-')))
  try {
    await putAi(s, { text: ollamaSlot(ollama.url) })
    await putKey(s, { slot: 'text', key: KEY })
    const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.equal(r.status, 502)
    assert.match(errorOf(r.body), /unlesbare Antwort: kaputt: Bearer …/)
    assert.ok(!errorOf(r.body).includes(KEY))
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
    assert.match(errorOf(r.body), /unlesbare Antwort: kaputt: Bearer …/)
    assert.ok(!errorOf(r.body).includes(KEY))
  }, { key: KEY, rules: { garbledStream: true } })
})

// Der eigene Anbieter für Fotos und Scans ist gerade der Fall, für den die Trennung gedacht ist
test('Bestätigung: der Bilder-Anbieter braucht eine eigene, die des Standards zählt nicht', async () => {
  await withOllama(async (s) => {
    await putAi(s, { images: ollamaSlot(EXTERNAL, 'bild') })
    await s.api<ClientSettings>('/api/ai/consent', { method: 'POST', body: JSON.stringify({ slot: 'text' }) })
    const photo = new FormData()
    photo.append('file', new Blob([Buffer.from('JPEG-Foto')], { type: 'image/jpeg' }), 'rechnung.jpg')
    const res = await fetch(`${s.base}/api/extract`, { method: 'POST', body: photo })
    assert.equal(res.status, 502)
    const error = await errorFrom(res)
    assert.match(error, /192\.0\.2\.1:11434/)
    assert.match(error, /Anbieter für Fotos und Scans/)
    // Text geht weiter an den Standard, der lokal läuft
    assert.equal((await uploadPdf(s, '/api/extract', { text: LONG_TEXT })).status, 200)
    const confirmed = await s.api<ClientSettings>('/api/ai/consent', { method: 'POST', body: JSON.stringify({ slot: 'images' }) })
    assert.equal(confirmed.ai.consent.images?.url, EXTERNAL)
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
    const { ai } = await s.api<ClientSettings>('/api/settings')
    assert.equal(ai.text.url, 'http://neu:11434')
    assert.equal(ai.text.model, 'neues:4b')
  } finally {
    s.stop()
  }
})

// ---------- Modell aus Mietfuchs laden (#33) ----------

// Wie der Browser: Fortschritt als Strom (Accept: application/x-ndjson)
async function pullAsStream(s: Server, { model = 'neu:4b', requestId, slot }: { model?: string, requestId?: string, slot?: AiSlotName } = {}) {
  const res = await fetch(`${s.base}/api/ai/pull`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
    body: JSON.stringify({ model, requestId, slot }),
  })
  const text = await res.text()
  return { status: res.status, type: res.headers.get('content-type') ?? '', lines: text.split('\n').filter(Boolean).map(parseLine) }
}

test('Modell laden: der Fortschritt kommt als Strom, am Ende meldet Mietfuchs Erfolg', async () => {
  await withOllama(async (s, ollama) => {
    const r = await pullAsStream(s)
    assert.equal(r.status, 200)
    assert.ok(r.type.includes('application/x-ndjson'), r.type)
    const progress = r.lines.filter((l) => l.type === 'progress')
    assert.ok(progress.length >= 2, JSON.stringify(r.lines).slice(0, 300))
    assert.ok(progress.some((p) => (p.total ?? 0) > 0 && (p.completed ?? -1) >= 0), JSON.stringify(progress))
    assert.equal(lastLine(r.lines).type, 'result')
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
  await listening(server, '127.0.0.1')
  try {
    await withEnv({ NKA_MODELS_URL: `http://127.0.0.1:${portOf(server)}/ki-modelle.json` }, async (s) => {
      const ohne = await s.api<AiRecommendations>('/api/ai/recommendations')
      assert.equal(ohne.source, 'mitgeliefert')
      assert.ok(ohne.models.some((m) => m.name === 'qwen3.5:4b'), JSON.stringify(ohne.models.map((m) => m.name)))

      // Dieselbe Zustimmung wie beim Update-Hinweis
      const settings = await s.api<ClientSettings>('/api/settings')
      await s.api<ClientSettings>('/api/settings', { method: 'PUT', body: JSON.stringify({ ...settings, updateCheck: 'on' }) })
      const mit = await s.api<AiRecommendations>('/api/ai/recommendations')
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
    const extraction = r.body.extraction ?? {}
    const positions = extraction.positions ?? []
    const cents = (eur: number) => Math.round(eur * 100)
    assert.equal(positions.reduce((a, p) => a + cents(p.amountEur ?? 0), 0), cents(101.86))
    assert.equal(positions.reduce((a, p) => a + cents(p.labor35aEur ?? 0), 0), cents(90.56))
    assert.equal(extraction.amountsAdjusted, 'netto')
    assert.equal(extraction.laborFromTotal, true)
    // Die Hilfsfelder des Modells gehen nicht an den Browser
    assert.equal('positionsAreNet' in extraction, false)
    assert.equal('labor35aTotalEur' in extraction, false)
  }, { chat: 'netto' })
})

// ---------- Die Antwort des Modells und die Zusage an die Oberfläche (#63) ----------

test('Auswertung: eine Antwort am Schema vorbei bricht die Zusage an die Oberfläche nicht', async () => {
  await withOllama(async (s) => {
    const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const extraction = r.body.extraction ?? {}
    const positions = extraction.positions ?? []

    // Keine Position geht verloren: Der Mensch prüft ohnehin alles, bevor er es übernimmt.
    assert.deepEqual(positions.map((p) => p.description), ['Frischwasser', 'Grundgebühr', 'Schmutzwasser'])
    // Was die Oberfläche als Zahl behandelt, ist auch eine, sonst bricht dort die Anzeige ab.
    for (const p of positions) {
      assert.ok(p.amountEur === undefined || typeof p.amountEur === 'number', `${p.description}: ${JSON.stringify(p.amountEur)}`)
    }
    // Ein deutsch geschriebener Betrag wird gelesen (dieselbe Lesart wie beim Zählerstand),
    assert.equal(positions[0].amountEur, 12.5)
    assert.equal(positions[0].labor35aEur, 4.2)
    assert.equal(extraction.totalGrossEur, 1234.56)
    // ein fehlender bleibt leer, und was keine Zahl ist, wird nicht erraten.
    assert.equal(positions[1].amountEur, undefined)
    assert.equal(positions[2].amountEur, undefined)
    // Was Mietfuchs selbst gerechnet hat, kann das Modell nicht behaupten, und erfundene
    // Felder erreichen den Browser nicht.
    assert.equal(extraction.amountsAdjusted, undefined)
    assert.equal('invoiceNumber' in extraction, false)
  }, { chat: 'offSchema' })
})

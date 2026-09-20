// Datenmodell der KI-Einstellungen (#18): Migration, Umgebungsvariablen, Prüfung von Änderungen
// und Wahl des Anbieters je Beleg. Reine Funktionen, deshalb ohne Serverstart.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { migrateAi, aiFromEnv, effectiveAi, applyAiChanges, fixedFields, slotFor, isExternalUrl, consentProblem } from '../src/ai/settings.js'
import { PRESETS, presetById } from '../src/ai/presets.ts'

const legacy = (extra = {}) => ({ houseName: 'Haus', ollamaUrl: 'http://ki.intern:11434', ollamaModel: 'gemma4:12b', ...extra })

// ---------- Migration ----------

test('Migration: bestehende Ollama-Einstellungen werden zum Standard-Anbieter', () => {
  const settings = migrateAi(legacy())
  // ki.intern ist nicht dieser Rechner, deshalb die Vorlage für ein entferntes Ollama
  assert.deepEqual(settings.ai.text, { provider: 'ollama', preset: 'ollama-remote', url: 'http://ki.intern:11434', model: 'gemma4:12b', vision: null })
  assert.equal(settings.ai.images, null)
  assert.deepEqual(settings.ai.consent, {})
  // Die alten Felder bleiben, eine ältere Version liest sie nach einem Downgrade weiter
  assert.equal(settings.ollamaUrl, 'http://ki.intern:11434')
  assert.equal(settings.ollamaModel, 'gemma4:12b')
})

test('Migration: ein Ollama im Heimnetz bekommt die Vorlage für ein entferntes', () => {
  // Nur diese Vorlage kennt ein Feld für den Schlüssel, etwa hinter einem Proxy
  assert.equal(migrateAi(legacy({ ollamaUrl: 'http://nas:11434' })).ai.text.preset, 'ollama-remote')
  assert.equal(migrateAi({ ollamaUrl: 'http://localhost:11434', ollamaModel: 'x' }).ai.text.preset, 'ollama-local')
})

test('Migration: fehlende Felder einer vorhandenen KI-Einstellung werden ergänzt, gesetzte bleiben', () => {
  const settings = migrateAi(legacy({ ai: { text: { provider: 'openai', preset: 'openai', url: 'https://api.openai.com/v1', model: 'gpt-5.4-nano', vision: true }, timeoutSeconds: 900 } }))
  assert.equal(settings.ai.text.model, 'gpt-5.4-nano')
  assert.equal(settings.ai.timeoutSeconds, 900)
  assert.equal(settings.ai.jsonMode, 'auto')
  assert.equal(settings.ai.extraInstructions, '')
  assert.deepEqual(settings.ai.consent, {})
})

test('Migration: kaputte Werte fallen auf den Standard zurück, statt den Start zu verhindern', () => {
  const settings = migrateAi(legacy({ ai: { text: 'unsinn', images: 5, jsonMode: 'egal', consent: [] } }))
  assert.equal(settings.ai.text.provider, 'ollama')
  assert.equal(settings.ai.text.url, 'http://ki.intern:11434')
  assert.equal(settings.ai.images, null)
  assert.equal(settings.ai.jsonMode, 'auto')
  assert.deepEqual(settings.ai.consent, {})
})

// ---------- Vorlagen ----------

test('Vorlagen: jede hat Anbieter, Namen und eine gültige Adresse oder bewusst keine', () => {
  const ids = new Set()
  for (const p of PRESETS) {
    assert.ok(!ids.has(p.id), `doppelte Vorlage ${p.id}`)
    ids.add(p.id)
    assert.ok(['ollama', 'openai'].includes(p.provider), p.id)
    assert.ok(p.label, p.id)
    if (p.url) assert.doesNotThrow(() => new URL(p.url), p.id)
    assert.ok(['none', 'optional', 'required'].includes(p.key), p.id)
  }
  assert.equal(presetById('openai').tokenField, 'max_completion_tokens')
  assert.equal(presetById('ionos').tokenField, 'max_completion_tokens') // IONOS nimmt sonst 16 Token
  assert.equal(presetById('mistral').tokenField, 'max_tokens')
  assert.equal(presetById('lmstudio').jsonObject, false) // LM Studio lehnt json_object ab
  assert.equal(presetById('gibt-es-nicht'), null)
})

// ---------- Umgebungsvariablen ----------

test('Umgebung: NKA_AI_* legen Anbieter, Adresse und Modell fest', () => {
  const env = aiFromEnv({ NKA_AI_PROVIDER: 'openai', NKA_AI_URL: 'https://api.mistral.ai/v1', NKA_AI_MODEL: 'mistral-small-latest' })
  assert.deepEqual(env.text, { provider: 'openai', url: 'https://api.mistral.ai/v1', model: 'mistral-small-latest' })
  assert.deepEqual(env.fixed.sort(), ['ai.text.model', 'ai.text.provider', 'ai.text.url'])
  assert.equal(env.error, null)
})

test('Umgebung: NKA_OLLAMA_* gelten weiter, aber nur solange Ollama der Anbieter ist', () => {
  const env = aiFromEnv({ NKA_OLLAMA_URL: 'http://ollama:11434', NKA_OLLAMA_MODEL: 'qwen3.5:4b' })
  const ollama = effectiveAi(migrateAi(legacy()).ai, env)
  assert.equal(ollama.text.url, 'http://ollama:11434')
  assert.equal(ollama.text.model, 'qwen3.5:4b')
  // Wer im Container mit dem Compose-Profil „ki“ trotzdem OpenAI wählt, wird nicht blockiert
  const stored = migrateAi(legacy({ ai: { text: { provider: 'openai', preset: 'openai', url: 'https://api.openai.com/v1', model: 'gpt-5.4-nano', vision: null } } })).ai
  const openai = effectiveAi(stored, env)
  assert.equal(openai.text.url, 'https://api.openai.com/v1')
  assert.equal(openai.text.model, 'gpt-5.4-nano')
})

test('Umgebung: legt sie einen anderen Anbieter fest, gilt dessen allgemeine Vorlage', () => {
  const settings = migrateAi(legacy())
  const env = aiFromEnv({ NKA_AI_PROVIDER: 'openai', NKA_AI_URL: 'https://llm.example.com/v1' })
  const effective = effectiveAi(settings.ai, env)
  assert.equal(effective.text.preset, 'openai-compatible')
  // Schickt die Oberfläche das so zurück, bleiben gespeicherter Anbieter und Vorlage zusammen
  applyAiChanges(settings, { ai: effective }, env)
  assert.equal(settings.ai.text.provider, 'ollama')
  assert.equal(settings.ai.text.preset, 'ollama-remote')
  assert.equal(migrateAi(structuredClone(settings)).ai.text.url, 'http://ki.intern:11434')
})

test('Umgebung: NKA_AI_URL hat Vorrang vor NKA_OLLAMA_URL', () => {
  const env = aiFromEnv({ NKA_AI_URL: 'http://a:11434', NKA_OLLAMA_URL: 'http://b:11434' })
  assert.equal(effectiveAi(migrateAi(legacy()).ai, env).text.url, 'http://a:11434')
})

test('Umgebung: ein unbekannter Anbieter oder eine ungültige Adresse ist ein Fehler', () => {
  assert.match(aiFromEnv({ NKA_AI_PROVIDER: 'chatgpt' }).error, /NKA_AI_PROVIDER.*ollama.*openai/)
  assert.match(aiFromEnv({ NKA_AI_URL: 'api.openai.com/v1' }).error, /NKA_AI_URL/)
  assert.match(aiFromEnv({ NKA_OLLAMA_URL: 'ftp://x' }).error, /NKA_OLLAMA_URL/)
})

test('Umgebung: NKA_AI_TIMEOUT und NKA_OLLAMA_NUM_CTX überlagern Zeitlimit und Kontext', () => {
  const settings = migrateAi(legacy({ ai: { timeoutSeconds: 900, numCtx: 8192 } }))
  // Die Umgebung darf kürzere Zeitlimits als die Oberfläche, etwa für Tests
  const env = aiFromEnv({ NKA_AI_TIMEOUT: '2', NKA_OLLAMA_NUM_CTX: '32768' })
  assert.equal(env.error, null)
  const effective = effectiveAi(settings.ai, env)
  assert.equal(effective.timeoutSeconds, 2)
  assert.equal(effective.numCtx, 32768)
  assert.deepEqual(fixedFields(settings.ai, env).sort(), ['ai.numCtx', 'ai.timeoutSeconds'])
  // Beim Speichern bleiben die gespeicherten Werte, die Umgebung landet nicht in der db.json
  applyAiChanges(settings, { ai: effective }, env)
  assert.equal(settings.ai.timeoutSeconds, 900)
  assert.equal(settings.ai.numCtx, 8192)
})

test('Umgebung: unbrauchbare Zahlen für Zeitlimit, Kontext und Antwortlänge sind ein Fehler', () => {
  assert.match(aiFromEnv({ NKA_AI_TIMEOUT: '10min' }).error, /NKA_AI_TIMEOUT/)
  assert.match(aiFromEnv({ NKA_AI_TIMEOUT: '0' }).error, /NKA_AI_TIMEOUT/)
  assert.match(aiFromEnv({ NKA_OLLAMA_NUM_CTX: '-5' }).error, /NKA_OLLAMA_NUM_CTX/)
  assert.match(aiFromEnv({ NKA_AI_MAX_TOKENS: '16k' }).error, /NKA_AI_MAX_TOKENS/)
})

// Höchstlänge der Antwort für OpenAI-kompatible Dienste. IONOS nimmt ohne Angabe nur 16 Token,
// deshalb schickt Mietfuchs immer einen Wert, Standard 16384.
test('Antwortlänge: einstellbar, per NKA_AI_MAX_TOKENS festlegbar, ohne Angabe null', () => {
  const settings = migrateAi(legacy())
  assert.equal(settings.ai.maxOutputTokens, null)
  applyAiChanges(settings, { ai: { ...settings.ai, maxOutputTokens: 4096 } }, aiFromEnv({}))
  assert.equal(settings.ai.maxOutputTokens, 4096)
  assert.equal(migrateAi(structuredClone(settings)).ai.maxOutputTokens, 4096)
  const env = aiFromEnv({ NKA_AI_MAX_TOKENS: '32768' })
  assert.equal(effectiveAi(settings.ai, env).maxOutputTokens, 32768)
  assert.ok(fixedFields(settings.ai, env).includes('ai.maxOutputTokens'))
  for (const invalid of [100, 5000000, 1.5, '4096']) {
    assert.throws(() => applyAiChanges(settings, { ai: { ...settings.ai, maxOutputTokens: invalid } }, aiFromEnv({})), /Antwortlänge/, String(invalid))
  }
})

// Größe der Seitenbilder eines Scans (#35). Gemessen wurde 1200 Bildpunkte an der langen
// Kante; wer ein Modell mit anderem Bedarf nutzt, stellt es um.
test('Seitenbilder: einstellbar, per NKA_AI_IMAGE_EDGE festlegbar, ohne Angabe null', () => {
  const settings = migrateAi(legacy())
  assert.equal(settings.ai.pageImageEdge, null)
  applyAiChanges(settings, { ai: { ...settings.ai, pageImageEdge: 1600 } }, aiFromEnv({}))
  assert.equal(settings.ai.pageImageEdge, 1600)
  assert.equal(migrateAi(structuredClone(settings)).ai.pageImageEdge, 1600)
  const env = aiFromEnv({ NKA_AI_IMAGE_EDGE: '900' })
  assert.equal(effectiveAi(settings.ai, env).pageImageEdge, 900)
  assert.ok(fixedFields(settings.ai, env).includes('ai.pageImageEdge'))
  assert.match(aiFromEnv({ NKA_AI_IMAGE_EDGE: '1200px' }).error, /NKA_AI_IMAGE_EDGE/)
  for (const invalid of [500, 4000, 1200.5, '1200']) {
    assert.throws(() => applyAiChanges(settings, { ai: { ...settings.ai, pageImageEdge: invalid } }, aiFromEnv({})), /Seitenbilder/, String(invalid))
  }
  // Ein unbrauchbarer Wert in der db.json verhindert den Start nicht, sondern fällt zurück
  assert.equal(migrateAi(legacy({ ai: { pageImageEdge: 99 } })).ai.pageImageEdge, null)
})

test('Umgebung: ohne Variablen ändert sich nichts', () => {
  const ai = migrateAi(legacy()).ai
  const env = aiFromEnv({})
  assert.deepEqual(env.fixed, [])
  assert.deepEqual(effectiveAi(ai, env), ai)
})

// ---------- Änderungen aus der Oberfläche ----------

const openaiSlot = { provider: 'openai', preset: 'openai', url: 'https://api.openai.com/v1', model: 'gpt-5.4-nano', vision: true }

test('Änderungen: ein neuer Anbieter wird übernommen', () => {
  const settings = migrateAi(legacy())
  applyAiChanges(settings, { ai: { ...settings.ai, text: openaiSlot, timeoutSeconds: 600, extraInstructions: 'Beträge immer brutto.' } }, aiFromEnv({}))
  assert.deepEqual(settings.ai.text, openaiSlot)
  assert.equal(settings.ai.timeoutSeconds, 600)
  assert.equal(settings.ai.extraInstructions, 'Beträge immer brutto.')
  // Die alten Felder zeigen weiter auf das zuletzt genutzte Ollama
  assert.equal(settings.ollamaUrl, 'http://ki.intern:11434')
})

test('Änderungen: bei Ollama spiegeln die alten Felder Adresse und Modell', () => {
  const settings = migrateAi(legacy())
  applyAiChanges(settings, { ai: { ...settings.ai, text: { ...settings.ai.text, model: 'qwen3.5:9b' } } }, aiFromEnv({}))
  assert.equal(settings.ollamaModel, 'qwen3.5:9b')
})

test('Änderungen: ein Tab von vor dem Update schickt nur ollamaUrl und ollamaModel', () => {
  const settings = migrateAi(legacy())
  applyAiChanges(settings, { ollamaUrl: 'http://neu:11434', ollamaModel: 'gemma4:12b' }, aiFromEnv({}))
  assert.equal(settings.ai.text.url, 'http://neu:11434')
  assert.equal(settings.ollamaUrl, 'http://neu:11434')
})

test('Änderungen: ein alter Tab überschreibt keinen anderen Anbieter', () => {
  const settings = migrateAi(legacy({ ai: { text: openaiSlot } }))
  applyAiChanges(settings, { ollamaUrl: 'http://neu:11434', ollamaModel: 'x' }, aiFromEnv({}))
  assert.deepEqual(settings.ai.text, openaiSlot)
})

test('Änderungen: per Umgebung festgelegte Felder bleiben', () => {
  const settings = migrateAi(legacy())
  const env = aiFromEnv({ NKA_AI_MODEL: 'env-modell' })
  applyAiChanges(settings, { ai: { ...settings.ai, text: { ...settings.ai.text, model: 'anderes', url: 'http://anders:11434' } } }, env)
  assert.equal(settings.ai.text.model, 'gemma4:12b') // gespeichert bleibt der alte Wert, es gilt die Umgebung
  assert.equal(settings.ai.text.url, 'http://anders:11434')
})

test('Änderungen: die Bestätigung externer Dienste lässt sich nicht über die Einstellungen setzen', () => {
  const settings = migrateAi(legacy())
  applyAiChanges(settings, { ai: { ...settings.ai, consent: { text: { url: 'https://api.openai.com/v1', date: '2026-09-19' } } } }, aiFromEnv({}))
  assert.deepEqual(settings.ai.consent, {})
})

test('Änderungen: ungültige Werte werden mit Meldung abgelehnt und nichts wird übernommen', () => {
  const cases = [
    [{ text: { ...openaiSlot, provider: 'chatgpt' } }, /Anbieterart/],
    [{ text: { ...openaiSlot, preset: 'gibt-es-nicht' } }, /Vorlage/],
    [{ text: { ...openaiSlot, preset: 'ollama-local' } }, /Vorlage/], // Vorlage passt nicht zum Anbieter
    [{ text: { ...openaiSlot, url: 'api.openai.com' } }, /Adresse/],
    [{ text: { ...openaiSlot, url: 'file:///etc/passwd' } }, /Adresse/],
    [{ text: { ...openaiSlot, model: 'x'.repeat(300) } }, /Modell/],
    [{ text: { ...openaiSlot, vision: 'ja' } }, /Bild/],
    [{ images: { ...openaiSlot, url: '' } }, /Adresse/],
    [{ timeoutSeconds: 0 }, /Zeitlimit/],
    [{ timeoutSeconds: 100000 }, /Zeitlimit/],
    [{ numCtx: 100 }, /Kontext/],
    [{ jsonMode: 'egal' }, /JSON/],
    [{ reasoningEffort: 'sehr viel!' }, /Denkaufwand/],
    [{ extraInstructions: 'x'.repeat(5000) }, /Hinweise/],
  ]
  for (const [change, message] of cases) {
    const settings = migrateAi(legacy())
    const before = structuredClone(settings)
    assert.throws(() => applyAiChanges(settings, { ai: { ...settings.ai, ...change } }, aiFromEnv({})), (err) => err.status === 400 && message.test(err.message), JSON.stringify(change).slice(0, 80))
    assert.deepEqual(settings, before)
  }
})

test('Änderungen: ein Modell darf leer sein, solange noch keines gewählt ist', () => {
  const settings = migrateAi(legacy())
  applyAiChanges(settings, { ai: { ...settings.ai, text: { ...openaiSlot, model: '' } } }, aiFromEnv({}))
  assert.equal(settings.ai.text.model, '')
})

// ---------- Wahl des Anbieters je Beleg ----------

test('Anbieterwahl: ohne eigenen Bilder-Anbieter gilt immer der Standard', () => {
  const ai = migrateAi(legacy()).ai
  assert.equal(slotFor(ai, { images: true }).slot, 'text')
  assert.equal(slotFor(ai, { images: false }).slot, 'text')
})

test('Anbieterwahl: Fotos und Scans gehen an den eigenen Bilder-Anbieter, Text an den Standard', () => {
  const ai = migrateAi(legacy({ ai: { images: openaiSlot } })).ai
  const images = slotFor(ai, { images: true })
  assert.equal(images.slot, 'images')
  assert.equal(images.model, 'gpt-5.4-nano')
  assert.equal(slotFor(ai, { images: false }).slot, 'text')
})

// ---------- Externe Dienste ----------

test('Extern: dieser Rechner, Heimnetz und Container gelten nicht als extern', () => {
  for (const url of [
    'http://localhost:11434', 'http://127.0.0.1:11434', 'http://127.1.2.3:1', 'http://[::1]:11434',
    'http://192.168.178.20:11434', 'http://10.0.0.5:1234/v1', 'http://172.16.0.2', 'http://172.31.255.255',
    'http://[fd12:3456::1]:11434', 'http://[fe80::1]:11434', 'http://host.docker.internal:11434', 'http://ollama:11434',
    'http://nas:11434', 'http://ki.local:11434', 'http://server.lan', 'http://fritz.box', 'http://ki.fritz.box:11434',
    'http://pc.home.arpa', 'http://ki.internal', 'http://[::ffff:192.168.1.10]:11434',
  ]) {
    assert.equal(isExternalUrl(url), false, url)
  }
})

test('Extern: öffentliche Adressen und Namen gelten als extern', () => {
  for (const url of [
    'https://api.openai.com/v1', 'https://ollama.com', 'https://openai.inference.de-txl.ionos.com/v1',
    'http://172.32.0.1', 'http://8.8.8.8', 'http://[2001:db8::1]', 'https://ki.example.com',
    'http://localhost.example.com', 'http://192.168.1.1.nip.io', 'http://[::ffff:8.8.8.8]',
  ]) {
    assert.equal(isExternalUrl(url), true, url)
  }
})

// ---------- Bestätigung externer Dienste ----------

const external = { slot: 'text', provider: 'openai', url: 'https://api.openai.com/v1', model: 'gpt-5.4-nano', consent: null }

test('Bestätigung: eine externe Adresse braucht sie, und zwar für genau diese Adresse', () => {
  assert.match(consentProblem(external, { remoteModel: false }), /api\.openai\.com.*bestätig/s)
  const confirmed = { ...external, consent: { url: 'https://api.openai.com/v1', model: 'gpt-5.4-nano', date: '2026-09-19' } }
  assert.equal(consentProblem(confirmed, { remoteModel: false }), null)
  // Ein anderes Modell beim selben Dienst braucht keine neue Bestätigung
  assert.equal(consentProblem({ ...confirmed, model: 'gpt-4.1-mini' }, { remoteModel: false }), null)
  // Eine andere Adresse schon
  assert.match(consentProblem({ ...confirmed, url: 'https://api.mistral.ai/v1' }, { remoteModel: false }), /api\.mistral\.ai/)
})

test('Bestätigung: lokal braucht es keine, außer Ollama reicht das Modell an die Cloud weiter', () => {
  const local = { slot: 'text', provider: 'ollama', url: 'http://localhost:11434', model: 'gpt-oss:120b-cloud', consent: null }
  assert.equal(consentProblem(local, { remoteModel: false }), null)
  assert.match(consentProblem(local, { remoteModel: true }), /gpt-oss:120b-cloud.*Cloud/s)
  const confirmed = { ...local, consent: { url: 'http://localhost:11434', model: 'gpt-oss:120b-cloud', date: '2026-09-19' } }
  assert.equal(consentProblem(confirmed, { remoteModel: true }), null)
  // Bei Cloud-Modellen gilt sie nur für das bestätigte Modell
  assert.match(consentProblem({ ...confirmed, model: 'deepseek-v4.1:cloud' }, { remoteModel: true }), /deepseek/)
})

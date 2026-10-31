// Integrationstests gegen den echten Server: API-Schlüssel, KI-Einstellungen, Anbieterwahl und Bestätigung externer Dienste.
//
// Jeder Test startet den Server als eigenen Prozess mit NKA_DATA_DIR auf einem Wegwerf-Ordner;
// die gemeinsamen Helfer stehen in testing/api.ts. Bis #263 stand dieser Teil mit allen anderen
// in api.test.ts und lief mit ihnen nacheinander.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import type { AiKeyInfo, AiSlotName, OllamaStatus } from '../../shared/types.ts'
import {
  type ClientSettings, EXTERNAL, LONG_TEXT, type Ollama, chatOptions, chatRequests, errorFrom, errorOf, fakeOllama, jsonOf, messageOf, ollamaSlot, photoForm, putAi, putKey, removeDataDir, restore, serverRoot, startServerBeside, startServerIn, storedSettings, uploadPdf, withEnv, withOllama,
} from '../testing/api.ts'

// ---------- API-Schlüssel externer KI-Dienste (#18) ----------
// Schlüssel liegen in einer eigenen Datei neben der db.json. Sie gehen nie an den Browser und
// nicht ins Backup-ZIP, das schnell in einer Cloud oder auf einem USB-Stick landet.

const SECRET = 'sk-test-geheim-1234567890abcd'

test('Schlüssel: wird gespeichert, erscheint aber nirgends im Klartext', async () => {
  await withEnv({}, async (s) => {
    const res = await putKey(s, { slot: 'text', key: `  ${SECRET}  ` })
    assert.equal(res.status, 200)
    assert.deepEqual((await jsonOf<Record<AiSlotName, AiKeyInfo>>(res)).text, { set: true, hint: '…abcd', fromEnv: null })
    const settings = await s.api<ClientSettings>('/api/settings')
    assert.deepEqual(settings.aiKeys.text, { set: true, hint: '…abcd', fromEnv: null })
    assert.deepEqual(settings.aiKeys.images, { set: false, hint: '', fromEnv: null })
    assert.ok(!JSON.stringify(settings).includes(SECRET), 'Schlüssel in /api/settings')
    // Speichert die Oberfläche die Einstellungen samt `aiKeys` zurück, landet nichts davon in der
    // Datenbank. Gelesen wird sie dafür **als Bytes**: Ein Schlüssel, der irgendwo in einer
    // Spalte gelandet wäre, die hier niemand vermutet, steht trotzdem in der Datei.
    await s.api<ClientSettings>('/api/settings', { method: 'PUT', body: JSON.stringify(settings) })
    const db = fs.readFileSync(path.join(s.dataDir, 'mietfuchs.sqlite'), 'latin1')
    assert.ok(!db.includes(SECRET), 'Schlüssel in der Datenbank')
    assert.ok(!db.includes('aiKeys'), 'aiKeys in der Datenbank')
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
    assert.equal((await s.api<ClientSettings>('/api/settings')).aiKeys.text.set, true)
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
    const { aiKeys } = await s.api<ClientSettings>('/api/settings')
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
    assert.equal((await s.api<ClientSettings>('/api/settings')).aiKeys.images.set, false)
  })
})

test('Schlüssel: NKA_AI_API_KEY hat Vorrang und lässt sich nicht überschreiben', async () => {
  await withEnv({ NKA_AI_API_KEY: SECRET }, async (s) => {
    assert.deepEqual((await s.api<ClientSettings>('/api/settings')).aiKeys.text, { set: true, hint: '…abcd', fromEnv: 'NKA_AI_API_KEY' })
    const res = await putKey(s, { slot: 'text', key: 'anderer-schluessel-9999' })
    assert.equal(res.status, 409)
    assert.match(await errorFrom(res), /NKA_AI_API_KEY/)
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
      assert.deepEqual((await s.api<ClientSettings>('/api/settings')).aiKeys.text, { set: true, hint: '…abcd', fromEnv: 'NKA_AI_API_KEY_FILE' })
      const res = await putKey(s, { slot: 'text', key: 'anderer-schluessel-9999' })
      assert.equal(res.status, 409)
      assert.match(await errorFrom(res), /NKA_AI_API_KEY_FILE/)
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
  const file = (name: string, content: string) => {
    const p = path.join(secretDir, name)
    fs.writeFileSync(p, content)
    return p
  }
  const cases: [NodeJS.ProcessEnv, RegExp][] = [
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
      const code = await Promise.race<number | null | string>([
        new Promise((r) => child.on('exit', r)),
        new Promise((r) => setTimeout(() => { child.kill(); r('läuft nach 15 s noch') }, 15000)),
      ])
      removeDataDir(dataDir)
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
    assert.equal((await s.api<ClientSettings>('/api/settings')).aiKeys.text.set, true)
  })
})

// Bei einem kurzen Schlüssel verrieten die letzten vier Zeichen fast alles
test('Schlüssel: kurze Schlüssel werden nicht angedeutet', async () => {
  await withEnv({}, async (s) => {
    await putKey(s, { slot: 'text', key: 'kurz-1234' })
    assert.deepEqual((await s.api<ClientSettings>('/api/settings')).aiKeys.text, { set: true, hint: '', fromEnv: null })
  })
})

test('Schlüssel: eine von Hand verdorbene secrets.json stört den Start nicht', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
  fs.writeFileSync(path.join(dataDir, 'secrets.json'), JSON.stringify({ text: 12345, images: { a: 1 } }))
  const s = await startServerIn(dataDir)
  try {
    const { aiKeys } = await s.api<ClientSettings>('/api/settings')
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
    const { aiKeys } = await s.api<ClientSettings>('/api/settings')
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
// Das Datenmodell selbst prüft aiSettings.test.ts ohne Server. Hier geht es um das
// Zusammenspiel mit db.json, Umgebung und der Route.

const OPENAI_SLOT = { provider: 'openai', preset: 'openai', url: 'https://api.openai.com/v1', model: 'gpt-5.4-nano', vision: true }

test('KI-Einstellungen: eine db.json von vor #18 bekommt beim Start den Standard-Anbieter', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ settings: { ollamaUrl: 'http://nas:11434', ollamaModel: 'gemma4:12b' } }))
  const s = await startServerIn(dataDir)
  try {
    const { ai } = await s.api<ClientSettings>('/api/settings')
    // nas ist nicht dieser Rechner, deshalb die Vorlage für ein entferntes Ollama
    assert.deepEqual(ai.text, { provider: 'ollama', preset: 'ollama-remote', url: 'http://nas:11434', model: 'gemma4:12b', vision: null })
    assert.equal(ai.images, null)
  } finally {
    s.stop()
  }
})

test('KI-Einstellungen: Wechsel zu OpenAI wird gespeichert, die Ollama-Felder bleiben für ein Downgrade', async () => {
  await withEnv({}, async (s) => {
    const before = await s.api<ClientSettings>('/api/settings')
    const saved = await s.api<ClientSettings>('/api/settings', { method: 'PUT', body: JSON.stringify({ ...before, ai: { ...before.ai, text: OPENAI_SLOT } }) })
    assert.deepEqual(saved.ai.text, OPENAI_SLOT)
    const stored = await storedSettings(s)
    assert.deepEqual(stored.ai.text, OPENAI_SLOT)
    assert.equal(stored.ollamaUrl, 'http://localhost:11434')
    assert.equal(stored.aiKeys, undefined)
  })
})

test('KI-Einstellungen: eine ungültige Angabe ergibt 400, und nichts wird gespeichert', async () => {
  await withEnv({}, async (s) => {
    const before = await s.api<ClientSettings>('/api/settings')
    const res = await fetch(`${s.base}/api/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...before, landlordName: 'Neu', ai: { ...before.ai, text: { ...OPENAI_SLOT, url: 'api.openai.com' } } }),
    })
    assert.equal(res.status, 400)
    assert.match(await errorFrom(res), /Adresse muss mit http/)
    assert.equal((await s.api<ClientSettings>('/api/settings')).landlordName, '')
  })
})

test('KI-Einstellungen: NKA_AI_PROVIDER, NKA_AI_URL und NKA_AI_MODEL gelten und sind als fest markiert', async () => {
  await withEnv({ NKA_AI_PROVIDER: 'openai', NKA_AI_URL: 'https://api.mistral.ai/v1', NKA_AI_MODEL: 'mistral-small-latest', NKA_OLLAMA_URL: 'http://ollama:11434' }, async (s) => {
    const settings = await s.api<ClientSettings>('/api/settings')
    assert.equal(settings.ai.text.provider, 'openai')
    assert.equal(settings.ai.text.url, 'https://api.mistral.ai/v1')
    assert.equal(settings.ai.text.model, 'mistral-small-latest')
    // NKA_OLLAMA_URL gilt nicht, solange ein anderer Anbieter festgelegt ist
    assert.deepEqual(settings.fixedByEnv, ['ai.text.provider', 'ai.text.url', 'ai.text.model'])
    await s.api<ClientSettings>('/api/settings', { method: 'PUT', body: JSON.stringify({ ...settings, landlordName: 'X' }) })
    const stored = await storedSettings(s)
    assert.equal(stored.ai.text.provider, 'ollama') // Werte aus der Umgebung landen nicht in der db.json
    assert.equal(stored.ai.text.url, 'http://localhost:11434')
  })
})

// ---------- Anbieterwahl je Beleg (#18) ----------

test('Anbieterwahl: Fotos gehen an den eigenen Bilder-Anbieter, Text an den Standard', async () => {
  const images = await fakeOllama({ models: [{ name: 'bild:latest', capabilities: ['completion', 'vision'] }] })
  try {
    await withOllama(async (s, text) => {
      await putAi(s, { images: ollamaSlot(images.url, 'bild') })
      const withImage = (o: Ollama) => chatRequests(o).filter((c) => messageOf(c.body.messages).images)
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
  const s = await startServerBeside(ollama, fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-')))
  try {
    await putAi(s, { text: ollamaSlot(ollama.url) })
    // Ohne Schlüssel: verständliche Meldung statt 401
    const without = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.equal(without.status, 502)
    assert.match(errorOf(without.body), /Schlüssel/)
    await putKey(s, { slot: 'text', key: KEY })
    const before = chatRequests(ollama).length
    const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.equal(r.status, 200)
    assert.ok(chatRequests(ollama).slice(before).every((c) => c.headers.authorization === `Bearer ${KEY}`))
    assert.ok(!JSON.stringify(r.body).includes(KEY))
    // Auch die Modellliste der Einstellungen fragt mit Schlüssel
    const status = await s.api<OllamaStatus>('/api/ollama/status')
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
    assert.ok(chatRequests(ollama).every((c) => messageOf(c.body.messages).content.includes('Beträge immer brutto übernehmen.')))
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

test('Bestätigung: ohne sie gehen keine Belege an einen externen Dienst', async () => {
  await withEnv({ NKA_AI_TIMEOUT: '2' }, async (s) => {
    await putAi(s, { text: ollamaSlot(EXTERNAL) })
    const started = Date.now()
    const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.equal(r.status, 502)
    assert.match(errorOf(r.body), /192\.0\.2\.1:11434.*bestätigt/s)
    assert.deepEqual([r.body.reason, r.body.kept, r.body.service], ['consent', true, '192.0.2.1:11434'])
    assert.ok(Date.now() - started < 1500, 'ohne Bestätigung darf keine Verbindung versucht werden')
    // Nach der Bestätigung versucht Mietfuchs es, der Dienst ist nur eben nicht erreichbar
    const confirmed = await s.api<ClientSettings>('/api/ai/consent', { method: 'POST', body: JSON.stringify({ slot: 'text' }) })
    assert.equal(confirmed.ai.consent.text?.url, EXTERNAL)
    assert.match(confirmed.ai.consent.text?.date ?? '', /^\d{4}-\d{2}-\d{2}$/)
    const again = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.doesNotMatch(errorOf(again.body), /bestätigt/)
    // Eine neue Adresse braucht eine neue Bestätigung
    await putAi(s, { text: ollamaSlot('http://192.0.2.2:11434') })
    assert.match(errorOf((await uploadPdf(s, '/api/extract', { text: LONG_TEXT })).body), /192\.0\.2\.2:11434.*bestätigt/s)
  })
})

test('Bestätigung: lässt sich widerrufen und gilt je Platz', async () => {
  await withEnv({}, async (s) => {
    await putAi(s, { text: ollamaSlot(EXTERNAL) })
    await s.api<ClientSettings>('/api/ai/consent', { method: 'POST', body: JSON.stringify({ slot: 'text' }) })
    const revoked = await s.api<ClientSettings>('/api/ai/consent/text', { method: 'DELETE' })
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
    assert.match(errorOf(r.body), /gpt-oss:120b-cloud.*Cloud/s)
    assert.equal(r.body.reason, 'consent')
    assert.equal(chatRequests(ollama).length, 0)
    await s.api<ClientSettings>('/api/ai/consent', { method: 'POST', body: JSON.stringify({ slot: 'text' }) })
    assert.equal((await uploadPdf(s, '/api/extract', { text: LONG_TEXT })).status, 200)
  }, { models: [{ name: 'gpt-oss:120b-cloud', capabilities: ['completion'], remote_host: 'https://ollama.com:443' }], model: 'gpt-oss:120b-cloud' })
})

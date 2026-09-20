import express from 'express'
import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'
import { getDb, save, newId, reloadDb, UPLOAD_DIR, DATA_DIR } from './store.js'
import { computeSettlement, consumptionOverview, rentLedger, taxReport } from './calc.js'
import { extractFromFile, classifyDocType, extractMeterReading } from './extract.js'
import { listOllamaModels, findOllama, defaultCandidates, pullOllamaModel } from './ai/ollama.js'
import { createRecommendations } from './ai/recommendations.js'
import { listOpenAiModels } from './ai/openai.js'
import { checkKeyEnvironment, setKey, deleteKey, keyInfo } from './secrets.ts'
import { aiFromEnv, applyAiChanges, effectiveAi, fixedFields, isExternalUrl } from './ai/settings.js'
import { PRESETS, presetById } from './ai/presets.js'
import { providerConfig } from './ai/index.js'
import { healthReport } from './health.ts'
import { createUpdateChecker, UPDATE_URL } from './update.ts'
import { APP_VERSION, RUNTIME, STANDALONE } from './version.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(express.json())

// Belege landen im Belegarchiv auf der Platte. Seitenbilder, die der Browser aus einem
// gescannten PDF rendert (Feld `pages`), braucht nur die KI-Auswertung: Sie bleiben im
// Arbeitsspeicher und tauchen nie im Belegarchiv auf.
const diskStore = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    // NFC: macOS liefert „ü“ gern zerlegt als „u“ plus Trema, das der Filter sonst zerschnitte
    const safe = file.originalname.normalize('NFC').replace(/[^\w.\-äöüÄÖÜß]/g, '_')
    cb(null, `${Date.now()}_${safe}`)
  },
})
const memoryStore = multer.memoryStorage()
const storageFor = (file) => (file.fieldname === 'pages' ? memoryStore : diskStore)
const UPLOAD_MAX_BYTES = 25 * 1024 * 1024
const upload = multer({
  storage: {
    _handleFile: (req, file, cb) => storageFor(file)._handleFile(req, file, cb),
    _removeFile: (req, file, cb) => storageFor(file)._removeFile(req, file, cb),
  },
  limits: { fileSize: UPLOAD_MAX_BYTES },
  // Browser schicken Dateinamen als UTF-8. Mit dem Standard latin1 zerfiel „Müll.pdf“ zu
  // „M__ll.pdf“, weil jedes Byte des Umlauts einzeln ersetzt wurde.
  defParamCharset: 'utf8',
})

// Beleg plus Material für die KI-Auswertung: höchstens vier Seitenbilder (so viele rendert
// der Browser) und die Textebene im Feld `pdfText`.
const MAX_PAGES = 4
// Echte Seitenbilder sind deutlich unter 1 MB. Die Grenze hält den Arbeitsspeicher klein, denn
// Seitenbilder werden dort gehalten und für Ollama noch einmal als Base64 kopiert.
const PAGE_MAX_BYTES = 5 * 1024 * 1024
const checkPageSizes = (req, res, next) => {
  if (!(req.files?.pages ?? []).some((p) => p.size > PAGE_MAX_BYTES)) return next()
  // Der Beleg liegt da schon auf der Platte: wieder entfernen, sonst bliebe ein Rest im Archiv
  const file = req.files?.file?.[0]
  if (file) fs.rmSync(file.path, { force: true })
  res.status(400).json({ error: 'Ein Seitenbild ist größer als 5 MB.' })
}
const fileWithPages = [upload.fields([{ name: 'file', maxCount: 1 }, { name: 'pages', maxCount: MAX_PAGES }]), checkPageSizes]
const uploadedFile = (req) => req.files?.file?.[0] ?? null
const aiInput = (req) => ({
  pdfText: typeof req.body?.pdfText === 'string' ? req.body.pdfText : '',
  pages: (req.files?.pages ?? [])
    .filter((p) => p.mimetype.startsWith('image/'))
    .map((p) => ({ mimeType: p.mimetype, data: p.buffer.toString('base64') })),
})

// ---------- Einstellungen ----------
// Den KI-Anbieter kann der Betreiber per Umgebungsvariable festlegen, etwa im Container (siehe
// aiFromEnv in ai/settings.js). Dann gelten die Werte vor den gespeicherten, und `fixedByEnv`
// sagt der Oberfläche, welche Felder sie nur anzeigen soll. In die db.json gelangen sie nicht.
const AI_ENV = aiFromEnv()

// Was tatsächlich gilt: gespeicherte Einstellungen, überlagert von der Umgebung. ollamaUrl und
// ollamaModel zeigen dabei, was für Ollama gilt, für Tabs von vor dem Update.
function effectiveSettings() {
  const settings = getDb().settings
  const ai = effectiveAi(settings.ai, AI_ENV)
  const legacy = ai.text.provider === 'ollama' ? { ollamaUrl: ai.text.url, ollamaModel: ai.text.model } : {}
  return { ...settings, ...legacy, ai }
}

// Pfade wie 'ai.text.url', dazu die alten Namen, die ein Tab von vor dem Update kennt
function fixedByEnv() {
  const settings = getDb().settings
  const paths = fixedFields(settings.ai, AI_ENV)
  const legacy = effectiveAi(settings.ai, AI_ENV).text.provider === 'ollama'
    ? [['ai.text.url', 'ollamaUrl'], ['ai.text.model', 'ollamaModel']].filter(([p]) => paths.includes(p)).map(([, name]) => name)
    : []
  return [...legacy, ...paths]
}

// `aiKeys` sagt nur, ob ein API-Schlüssel gesetzt ist (siehe secrets.ts), nie welcher.
// `aiExternal` sagt je Platz, ob die Adresse aus dem Haus zeigt und die Belege deshalb erst nach
// einer Bestätigung dorthin gehen. So entscheidet allein der Server, was als extern gilt.
function settingsForClient() {
  const settings = effectiveSettings()
  const aiExternal = { text: isExternalUrl(settings.ai.text.url), images: settings.ai.images ? isExternalUrl(settings.ai.images.url) : false }
  return { ...settings, fixedByEnv: fixedByEnv(), aiKeys: keyInfo(), aiExternal }
}

app.get('/api/settings', (req, res) => res.json(settingsForClient()))
app.put('/api/settings', (req, res) => {
  const body = req.body ?? {}
  const { fixedByEnv, aiKeys, aiExternal, ai, ollamaUrl, ollamaModel, ...changes } = body
  const settings = getDb().settings
  // Erst die KI-Einstellungen prüfen: Ist dort etwas ungültig, bleibt alles beim Alten
  try {
    applyAiChanges(settings, body, AI_ENV)
  } catch (err) {
    return res.status(err.status ?? 500).json({ error: err.message })
  }
  Object.assign(settings, changes)
  save()
  res.json(settingsForClient())
})

// API-Schlüssel haben eigene Routen statt PUT /api/settings: Ein Schlüssel geht nur zum Server,
// nie zurück, und nur, wenn jemand ihn neu eingibt. Ein unverändertes Formular überschreibt so
// nichts.
const keyRoute = (change) => (req, res) => {
  try {
    change(req)
  } catch (err) {
    return res.status(err.status ?? 500).json({ error: err.message })
  }
  res.json(keyInfo())
}
app.put('/api/ai/key', keyRoute((req) => setKey(req.body?.slot, req.body?.key)))
app.delete('/api/ai/key/:slot', keyRoute((req) => deleteKey(req.params.slot)))

// Bestätigung, dass Belege an einen externen Dienst gehen dürfen (siehe consentProblem in
// ai/settings.js). Sie gilt für die Adresse und das Modell, die gerade für diesen Platz gelten,
// auch wenn sie aus der Umgebung kommen.
app.post('/api/ai/consent', (req, res) => {
  const slot = req.body?.slot
  const effective = effectiveSettings().ai
  if (!['text', 'images'].includes(slot) || !effective[slot]) {
    return res.status(400).json({ error: 'Für diesen Platz ist kein KI-Anbieter eingerichtet.' })
  }
  const { url, model } = effective[slot]
  const settings = getDb().settings
  settings.ai.consent = { ...settings.ai.consent, [slot]: { url, model, date: new Date().toISOString().slice(0, 10) } }
  save()
  res.json(settingsForClient())
})

app.delete('/api/ai/consent/:slot', (req, res) => {
  const { slot } = req.params
  if (!['text', 'images'].includes(slot)) return res.status(400).json({ error: 'Unbekannter Platz.' })
  const settings = getDb().settings
  const { [slot]: _revoked, ...rest } = settings.ai.consent
  settings.ai.consent = rest
  save()
  res.json(settingsForClient())
})

// ---------- Generische CRUD-Routen für Stammdaten & Kosten ----------
for (const coll of ['units', 'tenancies', 'costItems', 'meters', 'readings', 'payments']) {
  app.get(`/api/${coll}`, (req, res) => res.json(getDb()[coll]))
  app.post(`/api/${coll}`, (req, res) => {
    const item = { ...req.body, id: newId() }
    getDb()[coll].push(item)
    save()
    res.status(201).json(item)
  })
  app.put(`/api/${coll}/:id`, (req, res) => {
    const item = getDb()[coll].find((x) => x.id === req.params.id)
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' })
    Object.assign(item, req.body, { id: item.id })
    save()
    res.json(item)
  })
  app.delete(`/api/${coll}/:id`, (req, res) => {
    const db = getDb()
    const before = db[coll].length
    db[coll] = db[coll].filter((x) => x.id !== req.params.id)
    if (coll === 'units') {
      // Abhängige Daten einer gelöschten Wohnung mit entfernen
      const tenancyIds = db.tenancies.filter((t) => t.unitId === req.params.id).map((t) => t.id)
      db.tenancies = db.tenancies.filter((t) => t.unitId !== req.params.id)
      db.payments = (db.payments ?? []).filter((p) => !tenancyIds.includes(p.tenancyId))
      const meterIds = db.meters.filter((m) => m.unitId === req.params.id).map((m) => m.id)
      db.meters = db.meters.filter((m) => m.unitId !== req.params.id)
      db.readings = db.readings.filter((r) => !meterIds.includes(r.meterId))
      // Vereinbarte Prozentanteile auf die gelöschte Wohnung entfernen, damit keine
      // verwaisten Verweise in den Kostenpositionen zurückbleiben.
      for (const c of db.costItems) {
        if (c.customShares && req.params.id in c.customShares) delete c.customShares[req.params.id]
      }
    }
    if (coll === 'tenancies') {
      db.payments = (db.payments ?? []).filter((p) => p.tenancyId !== req.params.id)
    }
    if (coll === 'meters') {
      db.readings = db.readings.filter((r) => r.meterId !== req.params.id)
    }
    if (db[coll].length === before) return res.status(404).json({ error: 'Nicht gefunden' })
    save()
    res.json({ ok: true })
  })
}

// ---------- Abrechnung ----------
// Liefert die abgeschlossene (eingefrorene) Abrechnung, falls vorhanden — sonst live berechnet.
app.get('/api/settlement/:year', (req, res) => {
  const year = Number(req.params.year)
  if (!Number.isInteger(year)) return res.status(400).json({ error: 'Ungültiges Jahr' })
  const closed = (getDb().closedSettlements ?? []).find((c) => c.year === year)
  // Vor dieser Version eingefrorene Snapshots kennen selfUsedShareCents noch nicht — mit 0
  // vorbelegen, damit die Antwort immer der Form in types.ts entspricht.
  if (closed) return res.json({ selfUsedShareCents: 0, ...closed.settlement, closed: { closedAt: closed.closedAt, sentAt: closed.sentAt ?? null } })
  res.json({ ...computeSettlement(getDb(), year), closed: null })
})

// Abrechnung abschließen: aktuellen Berechnungsstand einfrieren. Spätere Änderungen an
// Kosten/Stammdaten verändern eine bereits verschickte Abrechnung dann nicht mehr still.
app.post('/api/settlement/:year/close', (req, res) => {
  const year = Number(req.params.year)
  if (!Number.isInteger(year)) return res.status(400).json({ error: 'Ungültiges Jahr' })
  const db = getDb()
  if ((db.closedSettlements ?? []).some((c) => c.year === year)) {
    return res.status(409).json({ error: `Abrechnung ${year} ist bereits abgeschlossen.` })
  }
  db.closedSettlements.push({
    id: newId(),
    year,
    closedAt: new Date().toISOString(),
    sentAt: req.body?.sentAt ?? null,
    settlement: computeSettlement(db, year),
  })
  save()
  res.status(201).json({ ok: true })
})

// Versanddatum nachtragen (für die §556-Frist)
app.put('/api/settlement/:year/close', (req, res) => {
  const year = Number(req.params.year)
  const closed = (getDb().closedSettlements ?? []).find((c) => c.year === year)
  if (!closed) return res.status(404).json({ error: 'Abrechnung ist nicht abgeschlossen.' })
  closed.sentAt = req.body?.sentAt ?? null
  save()
  res.json({ ok: true })
})

// Wieder öffnen (Snapshot verwerfen, es gilt wieder die Live-Berechnung)
app.delete('/api/settlement/:year/close', (req, res) => {
  const year = Number(req.params.year)
  const db = getDb()
  const before = (db.closedSettlements ?? []).length
  db.closedSettlements = (db.closedSettlements ?? []).filter((c) => c.year !== year)
  if (db.closedSettlements.length === before) return res.status(404).json({ error: 'Abrechnung ist nicht abgeschlossen.' })
  save()
  res.json({ ok: true })
})

app.get('/api/consumption/:year', (req, res) => {
  const year = Number(req.params.year)
  if (!Number.isInteger(year)) return res.status(400).json({ error: 'Ungültiges Jahr' })
  res.json(consumptionOverview(getDb(), year))
})

// Mietkonto: Soll/Ist je Monat und Mietverhältnis für das Jahr
app.get('/api/rentledger/:year', (req, res) => {
  const year = Number(req.params.year)
  if (!Number.isInteger(year)) return res.status(400).json({ error: 'Ungültiges Jahr' })
  res.json(rentLedger(getDb(), year))
})

// Steuer-Übersicht (Hilfe für die Anlage V): Einnahmen, Werbungskosten, Überschuss
app.get('/api/taxreport/:year', (req, res) => {
  const year = Number(req.params.year)
  if (!Number.isInteger(year)) return res.status(400).json({ error: 'Ungültiges Jahr' })
  res.json(taxReport(getDb(), year))
})

// ---------- Belege & KI-Auswertung ----------
app.use('/uploads', express.static(UPLOAD_DIR))

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei' })
  res.json({ file: req.file.filename })
})

// Antwort der KI-Routen. Eine Auswertung kann auf dem Prozessor minutenlang laufen, und Firefox
// wartet höchstens 300 Sekunden auf Antwort-Header (network.http.response.timeout). Fordert der
// Browser mit Accept: application/x-ndjson an, gehen die Header deshalb sofort hinaus. Danach
// folgt je Zeile ein JSON-Objekt: { type: 'progress', step, phase, chars? } beim Fortschritt,
// { type: 'heartbeat' } alle zehn Sekunden, zuletzt { type: 'result', data } oder
// { type: 'error', error, file }. Ohne diesen Accept-Wert bleibt es bei einer JSON-Antwort,
// etwa für Tabs von vor einem Update.
//
// Bricht der Browser ab (Knopf „Abbrechen“, Seite verlassen), soll das Modell nicht umsonst
// weiterrechnen: Das Signal bricht dann die Anfrage an den Anbieter ab, und der gerade
// hochgeladene Beleg, auf den noch nichts verweist, verschwindet wieder aus dem Archiv. Den
// Abbruch erfährt der Server auf zwei Wegen: Express meldet das Schließen der Verbindung, und
// der Browser schickt jeder Auswertung eine Kennung (`requestId`) mit, mit der er beim Abbrechen
// POST /api/ai/cancel/<id> aufruft. Die Kennung wirkt unabhängig von der Laufzeit (unter Bun 1.3
// kam das Schließen nicht an) und von Proxys, die die Verbindung zum Server offen halten.
const HEARTBEAT_MS = 10000
const PROGRESS_EVERY_MS = 500
const REQUEST_ID = /^[a-f0-9-]{16,64}$/i
const runningAiRequests = new Map() // requestId → cancel()

function aiResponse(req, res) {
  const controller = new AbortController()
  const streaming = (req.get('accept') ?? '').includes('application/x-ndjson')
  const writeLine = (obj) => res.write(`${JSON.stringify(obj)}\n`)
  const requestId = typeof req.body?.requestId === 'string' && REQUEST_ID.test(req.body.requestId) ? req.body.requestId : null
  let heartbeat
  let settled = false
  const settle = () => {
    settled = true
    clearInterval(heartbeat)
    if (requestId) runningAiRequests.delete(requestId)
  }
  const cancel = () => {
    if (settled) return
    settle()
    controller.abort()
    const upload = uploadedFile(req)
    if (upload) fs.rmSync(upload.path, { force: true })
    // Die Verbindung beenden; hat der Browser sie schon geschlossen, schadet das nicht
    if (!res.writableEnded) res.end()
  }
  if (requestId) runningAiRequests.set(requestId, cancel)
  if (streaming) {
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no', // Reverse-Proxys sollen den Strom nicht puffern
    })
    heartbeat = setInterval(() => writeLine({ type: 'heartbeat' }), HEARTBEAT_MS)
  }
  res.on('close', () => {
    if (!res.writableFinished) cancel()
    else settle()
  })
  let lastKey = ''
  let lastAt = 0
  return {
    signal: controller.signal,
    stats: [],
    // Neue Phasen sofort melden, das Mitzählen beim Schreiben höchstens zweimal pro Sekunde
    onProgress(event) {
      if (!streaming) return
      const key = `${event.step}:${event.phase}`
      const now = Date.now()
      if (key === lastKey && now - lastAt < PROGRESS_EVERY_MS) return
      lastKey = key
      lastAt = now
      writeLine({ type: 'progress', ...event })
    },
    done(data) {
      if (settled) return // abgebrochen, der Browser wartet nicht mehr
      settle()
      if (!streaming) return res.json(data)
      writeLine({ type: 'result', data })
      res.end()
    },
    fail(data) {
      if (settled) return
      settle()
      if (!streaming) return res.status(502).json(data)
      writeLine({ type: 'error', ...data })
      res.end()
    },
  }
}

app.post('/api/ai/cancel/:id', (req, res) => {
  const cancel = runningAiRequests.get(req.params.id)
  if (!cancel) return res.status(404).json({ error: 'Keine laufende Auswertung mit dieser Kennung.' })
  cancel()
  res.json({ ok: true })
})

// PDFs liest der Browser vor dem Hochladen (client/src/pdfIntake.ts): Er schickt die Textebene
// mit und bei Scans die gerenderten Seiten. Der Server öffnet selbst keine PDFs. `stats`
// enthält die Kennzahlen des Modells je Schritt (Token, Sekunden), die Oberfläche braucht sie
// nicht, der KI-Prüflauf wertet sie aus.
app.post('/api/extract', fileWithPages, async (req, res) => {
  const file = uploadedFile(req)
  if (!file) return res.status(400).json({ error: 'Keine Datei' })
  const answer = aiResponse(req, res)
  const { signal, stats, onProgress } = answer
  try {
    const result = await extractFromFile(file.path, file.mimetype, effectiveSettings(), { ...aiInput(req), signal, stats, onProgress })
    answer.done({ file: file.filename, extraction: result, stats })
  } catch (err) {
    answer.fail({ file: file.filename, error: String(err.message || err), stats })
  }
})

// Universeller Eingang (Schuhkarton): erkennt automatisch, ob die Datei eine Rechnung oder
// ein Zählerfoto ist, und liefert die passende KI-Auswertung. Antwort ist eine diskriminierte
// Union über `kind`. `/api/extract` bleibt für die (rein rechnungsbezogene) Kosten-Seite.
app.post('/api/intake', fileWithPages, async (req, res) => {
  const file = uploadedFile(req)
  if (!file) return res.status(400).json({ error: 'Keine Datei' })
  const answer = aiResponse(req, res)
  const { signal, stats, onProgress } = answer
  try {
    const settings = effectiveSettings()
    const material = { ...aiInput(req), signal, stats, onProgress }
    const docType = await classifyDocType(file.path, file.mimetype, settings, { signal, stats, onProgress })
    if (docType === 'zaehlerstand') {
      const reading = await extractMeterReading(file.path, file.mimetype, settings, material)
      answer.done({ file: file.filename, kind: 'zaehler', reading, stats })
    } else {
      const extraction = await extractFromFile(file.path, file.mimetype, settings, material)
      answer.done({ file: file.filename, kind: 'rechnung', extraction, stats })
    }
  } catch (err) {
    answer.fail({ file: file.filename, error: String(err.message || err), stats })
  }
})

// Belegarchiv: alle hochgeladenen Dateien mit Größe und Datum
app.get('/api/uploads', (req, res) => {
  const files = fs.readdirSync(UPLOAD_DIR).map((name) => {
    const st = fs.statSync(path.join(UPLOAD_DIR, name))
    return { file: name, size: st.size, mtime: st.mtime.toISOString() }
  })
  res.json(files)
})

// Beleg löschen — nur wenn keine Kostenposition mehr darauf verweist
app.delete('/api/uploads/:file', (req, res) => {
  const name = path.basename(req.params.file) // verhindert Pfad-Ausbrüche
  const full = path.join(UPLOAD_DIR, name)
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'Datei nicht gefunden' })
  if (getDb().costItems.some((c) => c.invoiceFile === name)) {
    return res.status(409).json({ error: 'Beleg ist noch mit Kostenpositionen verknüpft.' })
  }
  fs.unlinkSync(full)
  res.json({ ok: true })
})

// ---------- Backup & Wiederherstellen ----------
app.get('/api/backup', (req, res) => {
  save() // sicherstellen, dass der letzte Stand auf der Platte liegt
  const zip = new AdmZip()
  zip.addLocalFile(path.join(DATA_DIR, 'db.json'))
  for (const name of fs.readdirSync(UPLOAD_DIR)) {
    zip.addLocalFile(path.join(UPLOAD_DIR, name), 'uploads')
  }
  const stamp = new Date().toISOString().slice(0, 10)
  res.set('Content-Type', 'application/zip')
  res.set('Content-Disposition', `attachment; filename="nebenkosten-backup-${stamp}.zip"`)
  res.send(zip.toBuffer())
})

const RESTORE_MAX_BYTES = 500 * 1024 * 1024
// Ausgepackt darf ein Backup höchstens so groß werden. Gegen „ZIP-Bomben“, die wenige Kilobyte
// groß sind und ausgepackt den Arbeitsspeicher füllen. NKA_RESTORE_MAX_BYTES setzt die Grenze
// für Tests herab.
const RESTORE_UNPACKED_MAX_BYTES = Number(process.env.NKA_RESTORE_MAX_BYTES) || 1024 * 1024 * 1024
const restoreUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: RESTORE_MAX_BYTES } })

// Liest ein Backup vollständig und prüft es, bevor irgendetwas ersetzt wird. Wirft einen Fehler
// mit einer Meldung für die Oberfläche; dann bleibt der bisherige Datenstand unangetastet.
function readBackup(buffer) {
  let zip
  try {
    zip = new AdmZip(buffer)
    zip.getEntries() // adm-zip 0.6 liest das Verzeichnis erst hier
  } catch {
    throw new Error('Datei ist kein gültiges ZIP-Archiv.')
  }
  const entries = zip.getEntries()
  const dbEntry = entries.find((e) => e.entryName === 'db.json')
  if (!dbEntry) throw new Error('Im Archiv fehlt die db.json. Ist das wirklich ein Mietfuchs-Backup?')

  const files = []
  let totalSize = dbEntry.header.size
  for (const e of entries) {
    const name = e.entryName
    if (name === 'db.json' || !name.startsWith('uploads/')) continue // anderes bleibt unbeachtet
    if (e.isDirectory && name === 'uploads/') continue
    // Ein Backup enthält Belege nur direkt in uploads/. Alles andere ist verdächtig.
    const fileName = name.slice('uploads/'.length)
    if (e.isDirectory || !fileName || fileName === '.' || fileName === '..' || /[\\/]/.test(fileName)) {
      throw new Error(`Das Archiv enthält einen ungültigen Eintrag („${name}“) und wird nicht übernommen.`)
    }
    totalSize += e.header.size
    files.push({ fileName, e })
  }
  if (totalSize > RESTORE_UNPACKED_MAX_BYTES) {
    throw new Error(`Das Archiv wäre ausgepackt zu groß (über ${Math.round(RESTORE_UNPACKED_MAX_BYTES / 1024 / 1024)} MB).`)
  }

  let dbText
  try {
    dbText = zip.readAsText(dbEntry)
    JSON.parse(dbText)
  } catch {
    throw new Error('Die db.json im Archiv ist beschädigt (kein gültiges JSON).')
  }
  // Alles in den Speicher lesen, bevor geschrieben wird: Scheitert ein Eintrag, ist noch nichts ersetzt
  return { dbText, files: files.map(({ fileName, e }) => ({ fileName, content: e.getData() })) }
}

app.post('/api/restore', restoreUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei' })
  let backup
  try {
    backup = readBackup(req.file.buffer)
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
  // Sicherheitskopie des aktuellen Stands, dann ersetzen
  fs.copyFileSync(path.join(DATA_DIR, 'db.json'), path.join(DATA_DIR, 'db.json.vor-restore'))
  fs.writeFileSync(path.join(DATA_DIR, 'db.json'), backup.dbText, 'utf8')
  for (const { fileName, content } of backup.files) fs.writeFileSync(path.join(UPLOAD_DIR, fileName), content)
  reloadDb()
  res.json({ ok: true })
})

// Adressen für die Suche, falls die eingestellte nicht erreichbar ist (siehe defaultCandidates).
// Die Tests setzen NKA_OLLAMA_CANDIDATES, um die Suche gegen einen eigenen Server zu prüfen.
const OLLAMA_CANDIDATES =
  process.env.NKA_OLLAMA_CANDIDATES?.split(',').map((u) => u.trim()).filter(Boolean) ?? defaultCandidates(RUNTIME)

// Modelle des Anbieters eines Platzes für die Auswahl in den Einstellungen. Ist ein lokales
// Ollama gar nicht erreichbar, sucht der Server es unter den üblichen Adressen, außer der
// Betreiber hat die Adresse festgelegt. Die Liste abzufragen schickt keine Belege, deshalb
// braucht sie auch bei externen Diensten keine Bestätigung.
async function aiStatus(slot) {
  const ai = effectiveSettings().ai
  if (slot === 'images' && !ai.images) return { ok: false, error: 'Kein eigener Anbieter für Fotos und Scans eingerichtet.' }
  const config = providerConfig(ai, { images: slot === 'images' })
  try {
    const models = config.provider === 'openai' ? await listOpenAiModels(config) : await listOllamaModels(config)
    return { ok: true, models }
  } catch (err) {
    const status = { ok: false, error: String(err.message || err) }
    const addressFixed = slot === 'text' && fixedByEnv().includes('ai.text.url')
    if (config.provider === 'ollama' && err.unreachable && !addressFixed && !isExternalUrl(config.url)) {
      const configured = config.url.replace(/\/+$/, '')
      const found = await findOllama(OLLAMA_CANDIDATES.filter((u) => u !== configured))
      if (found) status.found = found
    }
    return status
  }
}

app.get('/api/ai/presets', (req, res) => res.json(PRESETS.map((p) => presetById(p.id))))
app.get('/api/ai/status', async (req, res) => res.json(await aiStatus(req.query.slot === 'images' ? 'images' : 'text')))

// Empfehlungen, welches Modell taugt (#33). Nachgeladen wird nur mit derselben Zustimmung wie
// beim Update-Hinweis, sonst gilt die mitgelieferte Liste (siehe ai/recommendations.js).
const recommendations = createRecommendations()
app.get('/api/ai/recommendations', async (req, res) => {
  res.json(await recommendations.get({ consented: getDb().settings.updateCheck === 'on' }))
})

// Ein Modell über Ollama laden. Nur für ein Ollama auf diesem Rechner oder im Heimnetz: Dienste
// im Internet bringen ihre Modelle mit. Die Antwort ist derselbe Strom wie bei der Auswertung,
// mit Fortschritt, Lebenszeichen und Abbruch über POST /api/ai/cancel/<requestId>.
const MODEL_NAME = /^[\w.:/-]{1,100}$/

app.post('/api/ai/pull', async (req, res) => {
  const slot = req.body?.slot === 'images' ? 'images' : 'text'
  const ai = effectiveSettings().ai
  if (slot === 'images' && !ai.images) return res.status(400).json({ error: 'Für diesen Platz ist kein KI-Anbieter eingerichtet.' })
  const config = providerConfig(ai, { images: slot === 'images' })
  if (config.provider !== 'ollama' || config.preset === 'ollama-cloud' || isExternalUrl(config.url)) {
    return res.status(400).json({ error: 'Modelle lädt nur ein Ollama auf diesem Rechner oder im Heimnetz. Ein Dienst im Internet bringt seine Modelle mit.' })
  }
  const model = typeof req.body?.model === 'string' ? req.body.model.trim() : ''
  if (!MODEL_NAME.test(model)) return res.status(400).json({ error: 'Der Modellname enthält unerlaubte Zeichen.' })
  const answer = aiResponse(req, res)
  try {
    await pullOllamaModel(config, model, {
      signal: answer.signal,
      onProgress: (event) => answer.onProgress({ step: 'pull', phase: event.status, completed: event.completed, total: event.total }),
    })
    answer.done({ model })
  } catch (err) {
    answer.fail({ model, error: String(err.message || err) })
  }
})

// Für Tabs von vor dem Update: `models` als Liste von Namen, sonst bliebe die Seite weiß. Die
// Einzelheiten stehen in `modelDetails`.
app.get('/api/ollama/status', async (req, res) => {
  if (effectiveSettings().ai.text.provider !== 'ollama') return res.json({ ok: false, error: 'Als KI-Anbieter ist nicht Ollama eingestellt.' })
  const { models, ...status } = await aiStatus('text')
  res.json(models ? { ...status, models: models.map((m) => m.name), modelDetails: models } : status)
})

// ---------- Update-Hinweis ----------
// Fragt GitHub nur, wenn der Nutzer zugestimmt hat (settings.updateCheck === 'on'), und
// höchstens einmal am Tag; „Jetzt prüfen" fragt sofort, außer GitHub hat um eine Pause
// gebeten (Rate-Limit). NKA_UPDATE_URL ersetzt die Adresse, damit Tests gegen einen
// nachgebauten Server laufen statt gegen das echte GitHub.
const updateChecker = createUpdateChecker({
  url: process.env.NKA_UPDATE_URL || UPDATE_URL,
  currentVersion: APP_VERSION,
  mode: RUNTIME,
})

app.get('/api/update', async (req, res) => {
  res.json(await updateChecker.check({ consent: getDb().settings.updateCheck }))
})

app.post('/api/update/check', async (req, res) => {
  res.json(await updateChecker.check({ consent: getDb().settings.updateCheck, force: true }))
})

// ---------- Betriebszustand ----------
// Für Healthchecks von Docker & Co.: 200 nur, wenn der Datenbestand lesbar und der
// Belegordner beschreibbar ist, sonst 503. Muss VOR dem Frontend-Catch-All stehen, der jeden
// Pfad außer /api und /uploads mit der index.html beantwortet — sonst meldete auch ein
// kaputter Container HTTP 200. Bewusst nicht unter /api: Das ist eine Schnittstelle für den
// Betrieb, nicht für die Oberfläche.
app.get('/healthz', (req, res) => {
  const report = healthReport({ dataDir: DATA_DIR, version: APP_VERSION })
  res.status(report.status === 'ok' ? 200 : 503).json(report)
})

// Beenden aus der Oberfläche (#45). Nur in der Programmdatei: Aus einem Linux-Paket startet
// Mietfuchs ohne Konsolenfenster, es fehlt also der gewohnte Weg zum Schließen. Im Container
// und im npm-Betrieb beendet die Umgebung den Dienst, und ein Neustart käme dort von selbst.
app.post('/api/quit', (req, res) => {
  if (!STANDALONE) return res.status(404).json({ error: 'Beenden geht nur bei der Programmdatei. Hier beendet die Umgebung den Dienst.' })
  res.json({ ok: true })
  // Erst antworten, dann beenden: Sonst sähe der Browser einen Verbindungsabbruch statt der
  // Bestätigung. Offene Schreibvorgänge gibt es nicht, store.js schreibt jede Änderung sofort.
  res.on('finish', () => setTimeout(() => process.exit(0), 100))
})

// Fehler an der API immer als lesbare JSON-Meldung, nie als HTML-Fehlerseite von Express
app.use('/api', (err, req, res, next) => {
  if (res.headersSent) return next(err)
  if (err instanceof multer.MulterError) {
    const limit = req.path === '/restore' ? RESTORE_MAX_BYTES : UPLOAD_MAX_BYTES
    const message =
      err.code === 'LIMIT_FILE_SIZE' ? `Die Datei ist größer als ${limit / 1024 / 1024} MB.`
        : err.code === 'LIMIT_UNEXPECTED_FILE' && err.field === 'pages' ? `Höchstens ${MAX_PAGES} Seitenbilder je Beleg.`
          : err.code === 'LIMIT_FIELD_VALUE' ? 'Ein Textfeld ist zu lang.'
            : `Hochladen fehlgeschlagen: ${err.message}`
    return res.status(400).json({ error: message })
  }
  // Zum Beispiel ein abgebrochener Upload („Unexpected end of form“), den busboy selbst meldet
  const status = Number(err.status ?? err.statusCode) || 500
  res.status(status >= 400 && status < 600 ? status : 500).json({ error: `Die Anfrage ist fehlgeschlagen: ${err.message}` })
})

// ---------- Frontend (Produktions-Build) ----------
// Gepackte Binary (Bun --compile): das Frontend ist ins Binary eingebettet und wird
// aus dem generierten Modul embedded-client.js ausgeliefert (siehe scripts/embed-client.mjs).
// Im npm-/Dev-Betrieb kommt es wie gehabt von der Platte aus client/dist.
const PACKAGED = !!globalThis.Bun
if (PACKAGED) {
  const { embeddedFiles, mimeFor } = await import('./embedded-client.js')
  const sendEmbedded = (res, urlPath) => {
    const embedded = embeddedFiles[urlPath]
    if (!embedded) return false
    res.type(mimeFor(urlPath)).send(fs.readFileSync(embedded))
    return true
  }
  app.get(/^(?!\/api|\/uploads).*/, (req, res) => {
    // exakter Treffer, sonst SPA-Fallback auf index.html
    if (sendEmbedded(res, req.path === '/' ? '/index.html' : req.path)) return
    sendEmbedded(res, '/index.html') || res.status(404).send('Nicht gefunden')
  })
} else {
  const clientDist = path.join(__dirname, '..', '..', 'client', 'dist')
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist))
    // Mit `root` statt absolutem Pfad: Express 5 lehnt sonst Pfade ab, in denen irgendein Ordner
    // mit einem Punkt beginnt (etwa eine Installation unter ~/.apps/mietfuchs).
    app.get(/^(?!\/api|\/uploads).*/, (req, res) => res.sendFile('index.html', { root: clientDist }))
  }
}

// Standard-Browser mit der App öffnen (nur in der gepackten Binary — im Dev stört das).
function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '""', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]]
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' })
    // Fehlt das Programm, wirft spawn nicht, sondern meldet 'error' asynchron auf dem
    // Kindprozess — der try/catch greift dann nicht mehr. Ohne Zuhörer wird daraus ein
    // unbehandelter Fehler, der den Server beendet, obwohl er schon lauscht. Auf einem
    // Linux-Server ohne xdg-open (headless, Container, SSH) war die Binary damit nicht
    // startbar.
    child.on('error', () => {
      console.log(`Kein Browser gestartet (${cmd} nicht verfügbar) — bitte ${url} von Hand öffnen.`)
    })
    child.unref()
  } catch {
    /* egal — die URL steht in der Meldung darüber */
  }
}

// Bewusst NKA_PORT statt PORT: generische PORT-Variablen (z. B. von Preview-Tools)
// sind für das Frontend gedacht und würden hier mit Vite kollidieren.
const PORT = process.env.NKA_PORT || 3001

// Eine falsch gesetzte Variable für den KI-Anbieter oder den Schlüssel (siehe ai/settings.js und
// secrets.ts) fiele sonst erst bei der ersten Auswertung auf
const startProblem = AI_ENV.error ?? checkKeyEnvironment()
if (startProblem) {
  console.error(startProblem)
  process.exit(1)
}

// Antwortet auf dem Port bereits Mietfuchs? /healthz nennt sich mit Namen (health.ts). Dann ist
// ein zweiter Start kein Fehler, sondern ein zweiter Klick im Startmenü (#45).
async function mietfuchsAlreadyOn(url) {
  try {
    const res = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(2000) })
    return (await res.json())?.app === 'mietfuchs'
  } catch {
    return false
  }
}

// Ohne Konsolenfenster (Startmenü unter Linux) läuft eine Fehlermeldung ins Leere. Dann
// wenigstens eine Meldung des Systems, sofern es notify-send gibt.
function notifyDesktop(message) {
  if (!STANDALONE || process.platform !== 'linux' || process.env.CI) return
  try {
    const child = spawn('notify-send', ['--app-name=Mietfuchs', 'Mietfuchs', message], { detached: true, stdio: 'ignore' })
    child.on('error', () => {}) // ohne notify-send bleibt es bei der Ausgabe auf der Konsole
    child.unref()
  } catch {
    /* egal, die Meldung steht auf der Konsole */
  }
}

const server = app.listen(PORT, (err) => {
  // Express 5 ruft diesen Callback auch bei einem Fehler auf (etwa belegter Port). Den meldet
  // der error-Handler unten; hier darf dann weder „läuft“ stehen noch der Browser aufgehen.
  if (err) return
  // Bewusst 127.0.0.1 statt localhost: Unter Windows löst "localhost" zuerst auf IPv6
  // (::1) auf. Der Server lauscht auf IPv4 (0.0.0.0), und auf ::1 kann ein anderer
  // Dienst sitzen (z. B. WSLs wslrelay), der dann 404 liefert. 127.0.0.1 erzwingt IPv4.
  // Der Port kommt vom Server selbst: Mit NKA_PORT=0 vergibt das System einen freien, und die
  // Tests lesen ihn aus dieser Meldung.
  const url = `http://127.0.0.1:${server.address().port}`
  console.log(`Mietfuchs-Server läuft auf ${url}`)
  // Wo die Daten liegen, hängt an der Betriebsart (siehe chooseDataDir in store.js): neben der
  // Programmdatei oder, aus einem Paket installiert, im Benutzerordner. Wer den Ordner sichern
  // oder umziehen will, soll ihn nicht suchen müssen.
  console.log(`Daten: ${DATA_DIR}`)
  if (STANDALONE) {
    // Aus einem Linux-Paket startet Mietfuchs ohne Konsolenfenster (Terminal=false), beendet
    // wird dann über die Oberfläche. Beim Doppelklick auf die Programmdatei gibt es das Fenster
    // weiterhin, und dort ist sein Schließen der gewohnte Weg.
    console.log(RUNTIME === 'package'
      ? 'Zum Beenden in der Seitenleiste auf „Mietfuchs beenden“ klicken.'
      : 'Fenster offen lassen, solange Mietfuchs läuft. Zum Beenden dieses Fenster schließen.')
    // In der CI (GitHub setzt CI=true) prüft ein Skript die Programmdatei; ein Browserfenster
    // auf dem Runner nützt dort niemandem.
    if (!process.env.CI) openBrowser(url)
  }
})
server.on('error', async (err) => {
  if (err.code === 'EADDRINUSE') {
    const running = `http://127.0.0.1:${PORT}`
    // Ein zweiter Klick im Startmenü ist kein Fehler: Läuft dort schon Mietfuchs, gehört die
    // Oberfläche nach vorn (#45).
    if (STANDALONE && await mietfuchsAlreadyOn(running)) {
      console.log(`Mietfuchs läuft bereits auf ${running}. Die Oberfläche wird geöffnet.`)
      if (!process.env.CI) openBrowser(running)
      process.exit(0)
    }
    const message = `Port ${PORT} ist bereits belegt. Dort antwortet ein anderes Programm. Mit NKA_PORT lässt sich ein anderer Port setzen.`
    console.error(message)
    notifyDesktop(message)
  } else {
    console.error(err)
    notifyDesktop(`Start fehlgeschlagen: ${err.message}`)
  }
  if (STANDALONE) setTimeout(() => process.exit(1), 10000) // Fenster kurz offen lassen, damit man die Meldung liest
  else process.exit(1)
})

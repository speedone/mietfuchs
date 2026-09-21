import express, { type NextFunction, type Request, type Response } from 'express'
import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'
import type { AiSettings, AiSlotName, AiStatus, Settings } from '../../shared/types.ts'
import { getDb, save, newId, reloadDb, UPLOAD_DIR, DATA_DIR } from './store.ts'
import { computeSettlement, consumptionOverview, rentLedger, taxReport } from './calc.ts'
import { snapshotFromDb } from './snapshot.ts'
import { extractFromFile, classifyDocType, extractMeterReading, type AskProgressEvent, type AskStats } from './extract.ts'
import { listOllamaModels, findOllama, defaultCandidates, pullOllamaModel } from './ai/ollama.ts'
import { createRecommendations } from './ai/recommendations.ts'
import { listOpenAiModels } from './ai/openai.ts'
import { checkKeyEnvironment, setKey, deleteKey, keyInfo } from './secrets.ts'
import { SLOTS, aiFromEnv, applyAiChanges, effectiveAi, fixedFields, isExternalUrl } from './ai/settings.ts'
import { PRESETS, presetById } from './ai/presets.ts'
import { providerConfig } from './ai/index.ts'
import { isProviderError } from './ai/errors.ts'
import { healthReport, type DatabaseState } from './health.ts'
import { databaseFile, openDatabase, type OpenedDatabase } from './db/open.ts'
import { findingsText, validateDb } from './db/validate.ts'
import { createUpdateChecker, UPDATE_URL } from './update.ts'
import { APP_VERSION, RUNTIME, STANDALONE } from './version.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(express.json())

// ---------- Kleine Helfer ----------
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

// Die Meldung eines geworfenen Fehlers, wie zuvor `String(err.message || err)`. In einem catch
// ist der Fehler `unknown`: Wer wirft, bestimmt, was ankommt.
const messageOf = (err: unknown): string => {
  const message = isObject(err) && typeof err.message === 'string' ? err.message : ''
  return message || String(err)
}

// Fehler aus ai/settings.ts und secrets.ts tragen ein `status` für die Antwort der Route (dort
// mit Object.assign an den Error gehängt). Fehlt es, bleibt es wie bisher bei 500.
const statusOf = (err: unknown): number => (isObject(err) && typeof err.status === 'number' ? err.status : 500)

// Der Rumpf einer Anfrage als Objekt. express.json() lässt auch eine Liste durch, und deren
// Indizes landeten über Spread bzw. Object.assign als Schlüssel „0“, „1“ … in den Einstellungen
// und in den Datensätzen; von dort trug die db.json sie mit. Ein Rumpf, der kein Objekt ist,
// zählt deshalb als leer, und die Route antwortet wie bei einem leeren Rumpf.
const bodyObject = (req: Request): Record<string, unknown> => (isObject(req.body) ? req.body : {})

// Mit upload.fields() ist `req.files` ein Objekt je Feldname; die Listenform entsteht nur bei
// upload.array(), das hier niemand benutzt. Diese Sicht hält den Zugriff typisiert.
const filesOf = (req: Request): Record<string, Express.Multer.File[]> =>
  req.files && !Array.isArray(req.files) ? req.files : {}

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
const storageFor = (file: Express.Multer.File): multer.StorageEngine => (file.fieldname === 'pages' ? memoryStore : diskStore)
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
const checkPageSizes = (req: Request, res: Response, next: NextFunction): void => {
  if (!(filesOf(req).pages ?? []).some((p) => p.size > PAGE_MAX_BYTES)) return next()
  // Der Beleg liegt da schon auf der Platte: wieder entfernen, sonst bliebe ein Rest im Archiv
  const file = filesOf(req).file?.[0]
  if (file) fs.rmSync(file.path, { force: true })
  res.status(400).json({ error: 'Ein Seitenbild ist größer als 5 MB.' })
}
const fileWithPages = [upload.fields([{ name: 'file', maxCount: 1 }, { name: 'pages', maxCount: MAX_PAGES }]), checkPageSizes]
const uploadedFile = (req: Request): Express.Multer.File | null => filesOf(req).file?.[0] ?? null
const aiInput = (req: Request): { pdfText: string, pages: { mimeType: string, data: string }[] } => {
  const pdfText: unknown = req.body?.pdfText
  return {
    pdfText: typeof pdfText === 'string' ? pdfText : '',
    pages: (filesOf(req).pages ?? [])
      .filter((p) => p.mimetype.startsWith('image/'))
      .map((p) => ({ mimeType: p.mimetype, data: p.buffer.toString('base64') })),
  }
}

// ---------- Einstellungen ----------
// Den KI-Anbieter kann der Betreiber per Umgebungsvariable festlegen, etwa im Container (siehe
// aiFromEnv in ai/settings.ts). Dann gelten die Werte vor den gespeicherten, und `fixedByEnv`
// sagt der Oberfläche, welche Felder sie nur anzeigen soll. In die db.json gelangen sie nicht.
const AI_ENV = aiFromEnv()

// `settings.ai` ist im Datenmodell optional, weil eine db.json von vor #18 es noch nicht kennt.
// Beim Laden ergänzt store.ts es immer (migrateAi in load()), hier ist es also gesetzt. Die
// Prüfung benennt den Fall mit einer lesbaren Meldung, statt ihn zu verdecken.
function aiOf(settings: Settings): AiSettings {
  if (!settings.ai) throw new Error('Die KI-Einstellungen fehlen im Datenbestand.')
  return settings.ai
}

// Was tatsächlich gilt: gespeicherte Einstellungen, überlagert von der Umgebung. ollamaUrl und
// ollamaModel zeigen dabei, was für Ollama gilt, für Tabs von vor dem Update.
function effectiveSettings(): Settings & { ai: AiSettings } {
  const settings = getDb().settings
  const ai = effectiveAi(aiOf(settings), AI_ENV)
  const legacy = ai.text.provider === 'ollama' ? { ollamaUrl: ai.text.url, ollamaModel: ai.text.model } : {}
  return { ...settings, ...legacy, ai }
}

// Pfade wie 'ai.text.url', dazu die alten Namen, die ein Tab von vor dem Update kennt
function fixedByEnv(): string[] {
  const ai = aiOf(getDb().settings)
  const paths = fixedFields(ai, AI_ENV)
  const legacy = effectiveAi(ai, AI_ENV).text.provider === 'ollama'
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
  const body = bodyObject(req)
  const { fixedByEnv, aiKeys, aiExternal, ai, ollamaUrl, ollamaModel, ...changes } = body
  const settings = getDb().settings
  // Erst die KI-Einstellungen prüfen: Ist dort etwas ungültig, bleibt alles beim Alten
  try {
    applyAiChanges(settings, body, AI_ENV)
  } catch (err) {
    return res.status(statusOf(err)).json({ error: messageOf(err) })
  }
  Object.assign(settings, changes)
  save()
  res.json(settingsForClient())
})

// API-Schlüssel haben eigene Routen statt PUT /api/settings: Ein Schlüssel geht nur zum Server,
// nie zurück, und nur, wenn jemand ihn neu eingibt. Ein unverändertes Formular überschreibt so
// nichts.
const keyRoute = (change: (req: Request) => void) => (req: Request, res: Response) => {
  try {
    change(req)
  } catch (err) {
    return res.status(statusOf(err)).json({ error: messageOf(err) })
  }
  res.json(keyInfo())
}
// Beide Routen geben den Platz weiter, wie er hereinkommt: secrets.ts nimmt ihn als `unknown`
// und prüft ihn gegen die bekannten Plätze. Das deckt auch den Fall ab, dass Express für einen
// wiederholbaren Parameter eine Liste liefert (`keyRoute` reicht ein allgemeines `Request`
// durch, in dem jeder Parameter `string | string[]` ist): Eine Liste ist kein bekannter Platz.
app.put('/api/ai/key', keyRoute((req) => setKey(req.body?.slot, req.body?.key)))
app.delete('/api/ai/key/:slot', keyRoute((req) => deleteKey(req.params.slot)))

// Die Plätze der KI-Einstellungen. Eine Angabe aus der Oberfläche wird in der Liste gesucht,
// und was dort steht, ist ein `AiSlotName`. Deshalb braucht es dafür weder eine Zusicherung
// noch ein Prädikat, dessen Rumpf der Übersetzer nicht prüft.
const slotNameOf = (value: unknown): AiSlotName | null => SLOTS.find((known) => known === value) ?? null

// Bestätigung, dass Belege an einen externen Dienst gehen dürfen (siehe consentProblem in
// ai/settings.ts). Sie gilt für die Adresse und das Modell, die gerade für diesen Platz gelten,
// auch wenn sie aus der Umgebung kommen.
const NO_SLOT = 'Für diesen Platz ist kein KI-Anbieter eingerichtet.'
app.post('/api/ai/consent', (req, res) => {
  const slot = slotNameOf(req.body?.slot)
  const effective = effectiveSettings().ai
  if (!slot) return res.status(400).json({ error: NO_SLOT })
  const target = effective[slot]
  if (!target) return res.status(400).json({ error: NO_SLOT })
  const { url, model } = target
  const settings = getDb().settings
  const ai = aiOf(settings)
  ai.consent = { ...ai.consent, [slot]: { url, model, date: new Date().toISOString().slice(0, 10) } }
  save()
  res.json(settingsForClient())
})

app.delete('/api/ai/consent/:slot', (req, res) => {
  const slot = slotNameOf(req.params.slot)
  if (!slot) return res.status(400).json({ error: 'Unbekannter Platz.' })
  const ai = aiOf(getDb().settings)
  const { [slot]: _revoked, ...rest } = ai.consent
  ai.consent = rest
  save()
  res.json(settingsForClient())
})

// ---------- Generische CRUD-Routen für Stammdaten & Kosten ----------
// Die generischen Routen behandeln alle Collections gleich und brauchen von einem Datensatz nur
// die Kennung. `collections()` liefert genau diese Sicht auf die db.json: **dasselbe Objekt wie
// `getDb()`**, nur betrachtet als „Datensätze mit id“. Wer über die Sicht schreibt, ändert also
// den Datenbestand selbst. Geschrieben wird darüber nur das Ergebnis eines filter() auf
// derselben Liste, die Datensätze selbst bleiben also, was sie sind.
type CollectionName = 'units' | 'tenancies' | 'costItems' | 'meters' | 'readings' | 'payments'
type Entity = { id: string }
const COLLECTIONS: CollectionName[] = ['units', 'tenancies', 'costItems', 'meters', 'readings', 'payments']
const collections = (): Record<CollectionName, Entity[]> => getDb()

for (const coll of COLLECTIONS) {
  app.get(`/api/${coll}`, (req, res) => res.json(collections()[coll]))
  app.post(`/api/${coll}`, (req, res) => {
    const item = { ...bodyObject(req), id: newId() }
    collections()[coll].push(item)
    save()
    res.status(201).json(item)
  })
  app.put(`/api/${coll}/:id`, (req, res) => {
    const item = collections()[coll].find((x) => x.id === req.params.id)
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' })
    Object.assign(item, bodyObject(req), { id: item.id })
    save()
    res.json(item)
  })
  app.delete(`/api/${coll}/:id`, (req, res) => {
    // `db` und `lists` sind dasselbe Objekt, einmal mit den Fachtypen und einmal als Sicht für
    // den Zugriff über den laufenden Namen. Eine Änderung an `lists` ist also keine an einer
    // Kopie, sie trifft den Datenbestand, den `save()` gleich schreibt.
    const db = getDb()
    const lists = collections()
    const before = lists[coll].length
    lists[coll] = lists[coll].filter((x) => x.id !== req.params.id)
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
    if (lists[coll].length === before) return res.status(404).json({ error: 'Nicht gefunden' })
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
  // vorbelegen, damit die Antwort immer der Form in types.ts entspricht. Genau deshalb ist das
  // Feld in StoredSettlement (store.ts) optional.
  if (closed) return res.json({ selfUsedShareCents: 0, ...closed.settlement, closed: { closedAt: closed.closedAt, sentAt: closed.sentAt ?? null } })
  res.json({ ...computeSettlement(snapshotFromDb(getDb(), year)), closed: null })
})

// Ein Datum als JJJJ-MM-TT, wie es <input type="date"> liefert. Der Vergleich mit dem
// Rückweg über Date schließt Tage aus, die es im Kalender nicht gibt: JavaScript rechnet den
// 31. Februar stillschweigend in den 3. März um, statt ihn abzulehnen.
const isDateOnly = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const ms = Date.parse(`${value}T00:00:00Z`)
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value
}

// Das Versanddatum aus dem Rumpf, geprüft: `null` heißt „noch nicht versendet" (so schickt es
// die Oberfläche für ein leeres Feld), `false` heißt „keine gültige Angabe" und führt zu 400.
// An diesem Datum hängt die Frist aus §556 BGB, und die Oberfläche vergleicht es als
// Zeichenkette mit dem 31.12. des Folgejahrs — ein beliebiger Wert aus `req.body` (`any`, siehe
// bodyObject) dürfte hier also nie durchgereicht werden.
const SENT_AT_INVALID = 'Das Versanddatum muss ein Datum als JJJJ-MM-TT sein oder fehlen.'
const sentAtOf = (req: Request): string | null | false => {
  const value: unknown = bodyObject(req).sentAt
  if (value === undefined || value === null || value === '') return null
  return isDateOnly(value) ? value : false
}

// Abrechnung abschließen: aktuellen Berechnungsstand einfrieren. Spätere Änderungen an
// Kosten/Stammdaten verändern eine bereits verschickte Abrechnung dann nicht mehr still.
app.post('/api/settlement/:year/close', (req, res) => {
  const year = Number(req.params.year)
  if (!Number.isInteger(year)) return res.status(400).json({ error: 'Ungültiges Jahr' })
  const sentAt = sentAtOf(req)
  if (sentAt === false) return res.status(400).json({ error: SENT_AT_INVALID })
  const db = getDb()
  if ((db.closedSettlements ?? []).some((c) => c.year === year)) {
    return res.status(409).json({ error: `Abrechnung ${year} ist bereits abgeschlossen.` })
  }
  db.closedSettlements.push({
    id: newId(),
    year,
    closedAt: new Date().toISOString(),
    sentAt,
    settlement: computeSettlement(snapshotFromDb(db, year)),
  })
  save()
  res.status(201).json({ ok: true })
})

// Versanddatum nachtragen (für die §556-Frist)
app.put('/api/settlement/:year/close', (req, res) => {
  const year = Number(req.params.year)
  const sentAt = sentAtOf(req)
  if (sentAt === false) return res.status(400).json({ error: SENT_AT_INVALID })
  const closed = (getDb().closedSettlements ?? []).find((c) => c.year === year)
  if (!closed) return res.status(404).json({ error: 'Abrechnung ist nicht abgeschlossen.' })
  closed.sentAt = sentAt
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
  res.json(consumptionOverview(snapshotFromDb(getDb(), year)))
})

// Mietkonto: Soll/Ist je Monat und Mietverhältnis für das Jahr
app.get('/api/rentledger/:year', (req, res) => {
  const year = Number(req.params.year)
  if (!Number.isInteger(year)) return res.status(400).json({ error: 'Ungültiges Jahr' })
  res.json(rentLedger(snapshotFromDb(getDb(), year)))
})

// Steuer-Übersicht (Hilfe für die Anlage V): Einnahmen, Werbungskosten, Überschuss
app.get('/api/taxreport/:year', (req, res) => {
  const year = Number(req.params.year)
  if (!Number.isInteger(year)) return res.status(400).json({ error: 'Ungültiges Jahr' })
  res.json(taxReport(snapshotFromDb(getDb(), year)))
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
const runningAiRequests = new Map<string, () => void>() // requestId → cancel()

// Fortschritt, wie ihn die Routen als Zeile { type: 'progress', … } hinausschicken: entweder aus
// der Belegauswertung (extract.ts) oder aus dem Laden eines Modells (POST /api/ai/pull).
type PullProgressLine = { step: 'pull', phase: string, completed: number | null, total: number | null }
type ProgressLine = AskProgressEvent | PullProgressLine

// Was eine KI-Route zum Antworten braucht: Abbruchsignal, Sammelstelle für die Kennzahlen der
// Schritte und die drei Wege hinaus (Fortschritt, Ergebnis, Fehler).
type AiAnswer = {
  signal: AbortSignal
  stats: AskStats[]
  onProgress: (event: ProgressLine) => void
  done: (data: Record<string, unknown>) => void
  fail: (data: Record<string, unknown>) => void
}

function aiResponse(req: Request, res: Response): AiAnswer {
  const controller = new AbortController()
  const streaming = (req.get('accept') ?? '').includes('application/x-ndjson')
  const writeLine = (obj: Record<string, unknown>): void => {
    res.write(`${JSON.stringify(obj)}\n`)
  }
  const sentId: unknown = req.body?.requestId
  const requestId = typeof sentId === 'string' && REQUEST_ID.test(sentId) ? sentId : null
  let heartbeat: NodeJS.Timeout | undefined
  let settled = false
  const settle = (): void => {
    settled = true
    clearInterval(heartbeat)
    if (requestId) runningAiRequests.delete(requestId)
  }
  const cancel = (): void => {
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
app.post('/api/extract', fileWithPages, async (req: Request, res: Response) => {
  const file = uploadedFile(req)
  if (!file) return res.status(400).json({ error: 'Keine Datei' })
  const answer = aiResponse(req, res)
  const { signal, stats, onProgress } = answer
  try {
    const result = await extractFromFile(file.path, file.mimetype, effectiveSettings(), { ...aiInput(req), signal, stats, onProgress })
    answer.done({ file: file.filename, extraction: result, stats })
  } catch (err) {
    answer.fail({ file: file.filename, error: messageOf(err), stats })
  }
})

// Universeller Eingang (Schuhkarton): erkennt automatisch, ob die Datei eine Rechnung oder
// ein Zählerfoto ist, und liefert die passende KI-Auswertung. Antwort ist eine diskriminierte
// Union über `kind`. `/api/extract` bleibt für die (rein rechnungsbezogene) Kosten-Seite.
app.post('/api/intake', fileWithPages, async (req: Request, res: Response) => {
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
    answer.fail({ file: file.filename, error: messageOf(err), stats })
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
function readBackup(buffer: Buffer): { dbText: string, files: { fileName: string, content: Buffer }[] } {
  let zip: AdmZip
  try {
    zip = new AdmZip(buffer)
    zip.getEntries() // adm-zip 0.6 liest das Verzeichnis erst hier
  } catch {
    throw new Error('Datei ist kein gültiges ZIP-Archiv.')
  }
  const entries = zip.getEntries()
  const dbEntry = entries.find((e) => e.entryName === 'db.json')
  if (!dbEntry) throw new Error('Im Archiv fehlt die db.json. Ist das wirklich ein Mietfuchs-Backup?')

  // Ausdrücklich typisiert: Was hier hineinläuft, kommt aus einem hochgeladenen Archiv und wird
  // gerade erst geprüft. Der Typ soll nicht davon abhängen, was weiter unten hineingeschoben wird.
  const files: { fileName: string, e: AdmZip.IZipEntry }[] = []
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

  let dbText: string
  let parsed: unknown
  try {
    dbText = zip.readAsText(dbEntry)
    parsed = JSON.parse(dbText)
  } catch {
    throw new Error('Die db.json im Archiv ist beschädigt (kein gültiges JSON).')
  }
  // Gültiges JSON heißt noch nicht, dass es ein Mietfuchs-Datenbestand ist (#59). Käme hier
  // etwas durch, das dem Datenmodell nicht entspricht, ginge der laufende Server danach nicht
  // mehr: Das Einlesen wirft, und **jede** weitere Anfrage scheitert erneut, bis jemand die
  // Datei von Hand zurückkopiert. Deshalb wird geprüft, bevor irgendetwas überschrieben wird.
  // Was krumm, aber gültig ist, kommt weiterhin durch; die Begründung steht in db/validate.ts.
  const { problems } = validateDb(parsed)
  if (problems.length > 0) {
    throw new Error(
      'Die Daten in diesem Archiv passen nicht zu Mietfuchs, deshalb wurde nichts davon übernommen. ' +
        `Ihre bisherigen Daten sind unverändert. Beanstandet wurde:\n${findingsText(problems)}`,
    )
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
    return res.status(400).json({ error: messageOf(err) })
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
async function aiStatus(slot: AiSlotName): Promise<AiStatus> {
  const ai = effectiveSettings().ai
  if (slot === 'images' && !ai.images) return { ok: false, error: 'Kein eigener Anbieter für Fotos und Scans eingerichtet.' }
  const config = providerConfig(ai, { images: slot === 'images' })
  try {
    const models = config.provider === 'openai' ? await listOpenAiModels(config) : await listOllamaModels(config)
    return { ok: true, models }
  } catch (err) {
    const status: AiStatus = { ok: false, error: messageOf(err) }
    const addressFixed = slot === 'text' && fixedByEnv().includes('ai.text.url')
    if (config.provider === 'ollama' && isProviderError(err) && err.unreachable && !addressFixed && !isExternalUrl(config.url)) {
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
// beim Update-Hinweis, sonst gilt die mitgelieferte Liste (siehe ai/recommendations.ts).
const recommendations = createRecommendations()
app.get('/api/ai/recommendations', async (req, res) => {
  res.json(await recommendations.get({ consented: getDb().settings.updateCheck === 'on' }))
})

// Ein Modell über Ollama laden. Nur für ein Ollama auf diesem Rechner oder im Heimnetz: Dienste
// im Internet bringen ihre Modelle mit. Die Antwort ist derselbe Strom wie bei der Auswertung,
// mit Fortschritt, Lebenszeichen und Abbruch über POST /api/ai/cancel/<requestId>.
const MODEL_NAME = /^[\w.:/-]{1,100}$/

app.post('/api/ai/pull', async (req, res) => {
  const slot: AiSlotName = req.body?.slot === 'images' ? 'images' : 'text'
  const ai = effectiveSettings().ai
  if (slot === 'images' && !ai.images) return res.status(400).json({ error: NO_SLOT })
  const config = providerConfig(ai, { images: slot === 'images' })
  if (config.provider !== 'ollama' || config.preset === 'ollama-cloud' || isExternalUrl(config.url)) {
    return res.status(400).json({ error: 'Modelle lädt nur ein Ollama auf diesem Rechner oder im Heimnetz. Ein Dienst im Internet bringt seine Modelle mit.' })
  }
  const sentModel: unknown = req.body?.model
  const model = typeof sentModel === 'string' ? sentModel.trim() : ''
  if (!MODEL_NAME.test(model)) return res.status(400).json({ error: 'Der Modellname enthält unerlaubte Zeichen.' })
  const answer = aiResponse(req, res)
  try {
    await pullOllamaModel(config, model, {
      signal: answer.signal,
      onProgress: (event) => answer.onProgress({ step: 'pull', phase: event.status, completed: event.completed, total: event.total }),
    })
    answer.done({ model })
  } catch (err) {
    answer.fail({ model, error: messageOf(err) })
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
  const report = healthReport({ dataDir: DATA_DIR, version: APP_VERSION, database: databaseState() })
  res.status(report.status === 'ok' ? 200 : 503).json(report)
})

// Beenden aus der Oberfläche (#45). Nur in der Programmdatei: Aus einem Linux-Paket startet
// Mietfuchs ohne Konsolenfenster, es fehlt also der gewohnte Weg zum Schließen. Im Container
// und im npm-Betrieb beendet die Umgebung den Dienst, und ein Neustart käme dort von selbst.
app.post('/api/quit', (req, res) => {
  if (!STANDALONE) return res.status(404).json({ error: 'Beenden geht nur bei der Programmdatei. Hier beendet die Umgebung den Dienst.' })
  res.json({ ok: true })
  // Erst antworten, dann beenden: Sonst sähe der Browser einen Verbindungsabbruch statt der
  // Bestätigung. Offene Schreibvorgänge gibt es nicht, store.ts schreibt jede Änderung sofort.
  res.on('finish', () => setTimeout(() => process.exit(0), 100))
})

// Fehler an der API immer als lesbare JSON-Meldung, nie als HTML-Fehlerseite von Express
app.use('/api', (err: unknown, req: Request, res: Response, next: NextFunction) => {
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
  const status = (isObject(err) ? Number(err.status ?? err.statusCode) : NaN) || 500
  res.status(status >= 400 && status < 600 ? status : 500).json({ error: `Die Anfrage ist fehlgeschlagen: ${messageOf(err)}` })
})

// ---------- Frontend (Produktions-Build) ----------
// Gepackte Binary (Bun --compile): das Frontend ist ins Binary eingebettet und wird
// aus dem generierten Modul embedded-client.js ausgeliefert (siehe scripts/embed-client.mjs).
// Im npm-/Dev-Betrieb kommt es wie gehabt von der Platte aus client/dist.
const PACKAGED = !!globalThis.Bun
if (PACKAGED) {
  const { embeddedFiles, mimeFor } = await import('./embedded-client.js')
  const sendEmbedded = (res: Response, urlPath: string): boolean => {
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
function openBrowser(url: string): void {
  const [cmd, args]: [string, string[]] =
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
const PORT = Number(process.env.NKA_PORT || 3001)

// Ein Wert, der keine Portnummer ist, war für node:net der Pfad eines Unix-Sockets (unter
// Windows einer Named Pipe): Der Server lief dann scheinbar, war aber über HTTP unter keiner
// Adresse erreichbar, und `address()` lieferte den Pfad statt eines Objekts mit Port. Die
// Startmeldung nannte „http://127.0.0.1:undefined“.
const portProblem = Number.isInteger(PORT) && PORT >= 0 && PORT <= 65535
  ? null
  : `NKA_PORT „${process.env.NKA_PORT}“ ist keine Portnummer. Erlaubt sind 0 bis 65535; mit 0 vergibt das System einen freien Port.`

// Eine falsch gesetzte Variable für den KI-Anbieter oder den Schlüssel (siehe ai/settings.ts und
// secrets.ts) fiele sonst erst bei der ersten Auswertung auf
const startProblem = AI_ENV.error ?? checkKeyEnvironment() ?? portProblem
if (startProblem) {
  console.error(startProblem)
  process.exit(1)
}

// ---------- Die Datenbank (#55) ----------
//
// Geöffnet wird sie beim Start, obwohl noch keine fachlichen Daten darin liegen, und das ist
// der eigentliche Gewinn dieses Schrittes: Solange kein Einstiegspunkt db/open.ts erreicht,
// bündelt Bun weder Drizzle noch das eingebaute SQLite in die Programmdatei, und die Prüfläufe
// beweisen über diesen Weg gar nichts. So scheitert der Bau, wenn sich etwas nicht bündeln
// lässt, und die Artefakt-Tests starten jede Programmdatei auf einem Rechner ihres Systems.
//
// **Scheitert das Öffnen, läuft der Server trotzdem** und arbeitet wie bisher mit der db.json.
// An diesem Stand braucht niemand die Datenbank, und ihn deswegen auszusperren wäre die falsche
// Reihenfolge. Mit dem Umstieg der Bestände kehrt sich das um: Dann sind die Daten dort, und ein
// Start ohne sie wäre ein Start ohne Daten.
let database: OpenedDatabase | null = null
let databaseProblem: string | null = null
try {
  database = await openDatabase({ dataDir: DATA_DIR })
} catch (err) {
  databaseProblem = messageOf(err)
}

// Für /healthz: Der Bericht nennt den Stand, damit der Smoke-Test ihn von außen sieht. Er läuft
// auf jeder Programmdatei und in den Containern von 22 Distributionen; ob das eingebaute SQLite
// überall trägt, zeigt sich erst dort.
function databaseState(): DatabaseState {
  if (database) return { open: true, file: database.file, migrations: database.migrations, detail: 'geöffnet' }
  return { open: false, file: databaseFile(DATA_DIR), migrations: 0, detail: databaseProblem ?? 'nicht geöffnet' }
}

// Antwortet auf dem Port bereits Mietfuchs? /healthz nennt sich mit Namen (health.ts). Dann ist
// ein zweiter Start kein Fehler, sondern ein zweiter Klick im Startmenü (#45).
async function mietfuchsAlreadyOn(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(2000) })
    const report: unknown = await res.json()
    return isObject(report) && report.app === 'mietfuchs'
  } catch {
    return false
  }
}

// Ohne Konsolenfenster (Startmenü unter Linux) läuft eine Fehlermeldung ins Leere. Dann
// wenigstens eine Meldung des Systems, sofern es notify-send gibt.
function notifyDesktop(message: string): void {
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
  // Tests lesen ihn aus dieser Meldung. `address()` liefert einen String nur bei einem
  // Unix-Socket und null vor dem Lauschen; beides kann hier nicht sein.
  const address = server.address()
  const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : PORT}`
  console.log(`Mietfuchs-Server läuft auf ${url}`)
  // Wo die Daten liegen, hängt an der Betriebsart (siehe chooseDataDir in store.ts): neben der
  // Programmdatei oder, aus einem Paket installiert, im Benutzerordner. Wer den Ordner sichern
  // oder umziehen will, soll ihn nicht suchen müssen.
  console.log(`Daten: ${DATA_DIR}`)
  // Die Datenbank in derselben Aufzählung: Wer seinen Bestand sichern oder umziehen will, soll
  // auch diese Datei nicht suchen müssen.
  if (database) console.log(`Datenbank: ${database.file}`)
  // Auf die Fehlerausgabe, nicht in die gewöhnliche: Der Start gelingt, aber etwas ist nicht in
  // Ordnung, und wer Ausgaben einsammelt, soll genau das auseinanderhalten können.
  else console.error(`Datenbank: nicht geöffnet. ${databaseProblem ?? ''}\nMietfuchs arbeitet weiter mit ${path.join(DATA_DIR, 'db.json')}; es geht nichts verloren.`)
  for (const warning of database?.warnings ?? []) console.error(`Hinweis: ${warning}`)
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
// Fehler von node:net tragen `code`, das Error selbst nicht.
server.on('error', async (err: NodeJS.ErrnoException) => {
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

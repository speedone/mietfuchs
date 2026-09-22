import express, { type NextFunction, type Request, type Response } from 'express'
import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'
import type { AiSettings, AiSlotName, AiStatus, Settings } from '../../shared/types.ts'
import { newId, UPLOAD_DIR, DATA_DIR } from './store.ts'
import { DEFAULT_SETTINGS } from './defaults.ts'
import { computeSettlement, consumptionOverview, rentLedger, taxReport } from './calc.ts'
import { snapshotOf } from './snapshot.ts'
import { extractFromFile, classifyDocType, extractMeterReading, type AskProgressEvent, type AskStats } from './extract.ts'
import { listOllamaModels, findOllama, defaultCandidates, pullOllamaModel } from './ai/ollama.ts'
import { createRecommendations } from './ai/recommendations.ts'
import { listOpenAiModels } from './ai/openai.ts'
import { checkKeyEnvironment, setKey, deleteKey, keyInfo } from './secrets.ts'
import {
  SLOTS, aiFromEnv, applyAiChanges, effectiveAi, fixedFields, isExternalUrl, migrateAi,
  type MigratedSettings,
} from './ai/settings.ts'

import { PRESETS, presetById } from './ai/presets.ts'
import { providerConfig } from './ai/index.ts'
import { isProviderError } from './ai/errors.ts'
import { databaseUnavailable, healthReport, NO_DATABASE, type DatabaseState } from './health.ts'
import { databaseFile, openDatabase, type OpenedDatabase } from './db/open.ts'
import { changeoverWithoutDatabase, replaceFile, runChangeover, type ChangeoverResult } from './db/changeover.ts'
import type { Database } from './db/client.ts'
import { databaseProblem } from './db/errors.ts'
import { readSettings, readStock } from './db/read.ts'
import {
  closeSettlement, createEntity, findClosedSettlement, invoiceFilesInUse, listCollection,
  removeEntity, reopenSettlement, setSentAt, updateEntity, writeSettings, type CollectionName,
} from './db/repository.ts'
import {
  ARCHIVE_DB_NAME, ARCHIVE_INFO_NAME, DB_BEFORE_RESTORE,
  archiveDatabaseProblem, archiveInfoText, originText, writeDatabaseSnapshot,
} from './db/backup.ts'
import { findingsText, validateDb } from './legacy/validate.ts'
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
// ---------- Die Einstellungen im Arbeitsspeicher ----------
//
// Sie liegen als Kopie hier, beim Start geladen und nach jeder Änderung neu gelesen.
//
// **Warum nicht bei jeder Anfrage aus der Datenbank?** Es ist eine einzige Zeile, und sie wird
// auf fast jedem Weg gelesen: bei jeder KI-Anfrage, bei jedem Update-Hinweis, auf jeder Seite
// der Oberfläche. Ein Lesen je Zugriff machte ein Dutzend synchroner Helfer asynchron und zöge
// die Änderung durch die halbe Datei, ohne dass jemand etwas davon hätte.
//
// **Warum das hier trägt:** Mietfuchs ist ein Prozess, und dieser Prozess ist der einzige, der
// schreibt. Was den Zwischenspeicher ungültig machen kann, ist deshalb aufzählbar, und jede
// dieser Stellen frischt ihn auf: der Start, `PUT /api/settings`, die beiden Bestätigungsrouten,
// das Wiederherstellen eines Backups und der Umstieg. Käme je ein zweiter Schreiber dazu, wäre
// dieser Zwischenspeicher das Erste, was fällt — und dann gehört er auch weg.
//
// Aufgefrischt wird **aus der Datenbank** und nicht aus dem, was hineingeschrieben wurde: Was
// die Spalten nicht aufnehmen, fehlt danach, und die Oberfläche soll denselben Stand sehen wie
// der nächste Start.
let storedSettings: MigratedSettings = migrateAi({ ...DEFAULT_SETTINGS })

async function refreshSettings(): Promise<void> {
  storedSettings = await readData(readSettings)
}

// Speichert den übergebenen Stand und übernimmt danach, was wirklich dasteht.
async function saveSettings(next: MigratedSettings): Promise<void> {
  await writeData((db) => writeSettings(db, next))
  await refreshSettings()
}

function aiOf(settings: Settings): AiSettings {
  if (!settings.ai) throw new Error('Die KI-Einstellungen fehlen im Datenbestand.')
  return settings.ai
}

// Was tatsächlich gilt: gespeicherte Einstellungen, überlagert von der Umgebung. ollamaUrl und
// ollamaModel zeigen dabei, was für Ollama gilt, für Tabs von vor dem Update.
function effectiveSettings(): Settings & { ai: AiSettings } {
  const settings = storedSettings
  const ai = effectiveAi(aiOf(settings), AI_ENV)
  const legacy = ai.text.provider === 'ollama' ? { ollamaUrl: ai.text.url, ollamaModel: ai.text.model } : {}
  return { ...settings, ...legacy, ai }
}

// Pfade wie 'ai.text.url', dazu die alten Namen, die ein Tab von vor dem Update kennt
function fixedByEnv(): string[] {
  const ai = aiOf(storedSettings)
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
app.put('/api/settings', async (req, res) => {
  const body = bodyObject(req)
  const { fixedByEnv, aiKeys, aiExternal, ai, ollamaUrl, ollamaModel, ...changes } = body
  // Gearbeitet wird auf einer Kopie und nicht auf dem Zwischenspeicher: Scheitert das
  // Schreiben, soll der Stand im Arbeitsspeicher nicht schon verändert sein und etwas anzeigen,
  // das nirgends steht.
  const next = structuredClone(storedSettings)
  // Erst die KI-Einstellungen prüfen: Ist dort etwas ungültig, bleibt alles beim Alten
  try {
    applyAiChanges(next, body, AI_ENV)
  } catch (err) {
    return res.status(statusOf(err)).json({ error: messageOf(err) })
  }
  // `changes` trägt alles, was nicht KI ist. Unbekannte Schlüssel kommen hier zwar noch mit,
  // finden in den Spalten aber keinen Ort mehr und sind nach dem Zurücklesen verschwunden (#60).
  Object.assign(next, changes)
  await saveSettings(next)
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
app.post('/api/ai/consent', async (req, res) => {
  const slot = slotNameOf(req.body?.slot)
  const effective = effectiveSettings().ai
  if (!slot) return res.status(400).json({ error: NO_SLOT })
  const target = effective[slot]
  if (!target) return res.status(400).json({ error: NO_SLOT })
  const { url, model } = target
  const next = structuredClone(storedSettings)
  const ai = aiOf(next)
  ai.consent = { ...ai.consent, [slot]: { url, model, date: new Date().toISOString().slice(0, 10) } }
  await saveSettings(next)
  res.json(settingsForClient())
})

app.delete('/api/ai/consent/:slot', async (req, res) => {
  const slot = slotNameOf(req.params.slot)
  if (!slot) return res.status(400).json({ error: 'Unbekannter Platz.' })
  const next = structuredClone(storedSettings)
  const ai = aiOf(next)
  const { [slot]: _revoked, ...rest } = ai.consent
  ai.consent = rest
  await saveSettings(next)
  res.json(settingsForClient())
})

// ---------- Der Zugang zu den Daten ----------
//
// **Jeder Zugriff geht durch die Spur** (siehe db/open.ts): Lesen wie Schreiben reihen sich ein,
// weil alle Anfragen sich eine Verbindung teilen und ein Lesevorgang daneben den noch nicht
// festgeschriebenen Stand einer fremden Transaktion sähe. Diese beiden Helfer sind der einzige
// Weg dorthin; eine Route, die `database.db` unmittelbar benutzte, ginge daran vorbei.
//
// **Ohne Datenbank gibt es keine Daten mehr.** Das ist die Umkehrung des bisherigen Zustands:
// Bis zum Umstellen der Routen war eine nicht geöffnete Datenbank harmlos, weil Mietfuchs mit
// der db.json weiterarbeitete. Jetzt liegen die Daten dort, und ein Start ohne sie ist ein
// Start ohne Daten.
// Eine leere Liste wäre die schlimmste Antwort: Sie sähe aus wie „Sie haben noch nichts
// erfasst". Deshalb 503 und nicht 500: Der Dienst ist vorübergehend nicht verfügbar, an den
// Daten ist nichts kaputt.
// Die Frage „trägt die Datenbank den Bestand?" und ihre beiden Gründe stehen in health.ts, damit
// der Zustandsbericht und die Routen hier nicht Verschiedenes sagen können.
const refuseData = <T>(reason: string): Promise<T> =>
  Promise.reject(Object.assign(new Error(reason), { status: 503 }))

const onDatabase = <T>(work: (opened: OpenedDatabase) => Promise<T>): Promise<T> => {
  const reason = databaseUnavailable(databaseState())
  // `databaseState()` meldet `open: true` genau dann, wenn `database` steht; ohne Grund gibt es
  // sie also. Der Übersetzer sieht diesen Zusammenhang nicht, daher die zweite Frage.
  if (!database) return refuseData(reason ?? NO_DATABASE)
  return reason ? refuseData(reason) : work(database)
}

const readData = <T>(work: (db: Database) => Promise<T>): Promise<T> => onDatabase((opened) => opened.read(work))
const writeData = <T>(work: (db: Database) => Promise<T>): Promise<T> => onDatabase((opened) => opened.write(work))

// ---------- Generische CRUD-Routen für Stammdaten & Kosten ----------
// Die generischen Routen behandeln alle Collections gleich und brauchen von einem Datensatz nur
// die Kennung.
//
// Was mit einem Datensatz geschieht, steht jetzt in db/repository.ts, und zwar aus zwei Gründen:
// `Object.assign` übernahm jeden Schlüssel des Rumpfes, auch einen erfundenen (#60), und die
// Kaskade beim Löschen lief als Schleife hier, die mittendrin abbrechen konnte. Beides erledigt
// jetzt die Datenbank, das eine über ihre Spalten, das andere über ihre Fremdschlüssel.
//
// Ein Fehler wird hier nicht abgefangen: Express 5 reicht eine abgelehnte Zusage an die
// Fehlerbehandlung weiter, und dort steht die Übersetzung an einer Stelle.
const COLLECTIONS: CollectionName[] = ['units', 'tenancies', 'costItems', 'meters', 'readings', 'payments']

for (const coll of COLLECTIONS) {
  app.get(`/api/${coll}`, async (req, res) => {
    res.json(await readData((db) => listCollection(db, coll)))
  })
  app.post(`/api/${coll}`, async (req, res) => {
    res.status(201).json(await writeData((db) => createEntity(db, coll, newId(), bodyObject(req))))
  })
  app.put(`/api/${coll}/:id`, async (req, res) => {
    const item = await writeData((db) => updateEntity(db, coll, req.params.id, bodyObject(req)))
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' })
    res.json(item)
  })
  app.delete(`/api/${coll}/:id`, async (req, res) => {
    const geloescht = await writeData((db) => removeEntity(db, coll, req.params.id))
    if (!geloescht) return res.status(404).json({ error: 'Nicht gefunden' })
    res.json({ ok: true })
  })
}

// ---------- Abrechnung ----------
// Liefert die abgeschlossene (eingefrorene) Abrechnung, falls vorhanden — sonst live berechnet.
app.get('/api/settlement/:year', async (req, res) => {
  const year = Number(req.params.year)
  if (!Number.isInteger(year)) return res.status(400).json({ error: 'Ungültiges Jahr' })
  const closed = await readData((db) => findClosedSettlement(db, year))
  // Vor dieser Version eingefrorene Snapshots kennen selfUsedShareCents noch nicht — mit 0
  // vorbelegen, damit die Antwort immer der Form in types.ts entspricht. Genau deshalb ist das
  // Feld in StoredSettlement (store.ts) optional.
  // Der eingefrorene Stand ist `unknown`: Er stammt womöglich aus einer früheren Version, und
  // ein Typ darüber wäre eine Behauptung über etwas, das jemand anders geschrieben hat. Zum
  // Ausbreiten genügt, dass es ein Objekt ist.
  if (closed) {
    const stand = closed.settlement !== null && typeof closed.settlement === 'object' ? closed.settlement : {}
    return res.json({ selfUsedShareCents: 0, ...stand, closed: { closedAt: closed.closedAt, sentAt: closed.sentAt } })
  }
  res.json({ ...computeSettlement(snapshotOf(await readData(readStock), year)), closed: null })
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
app.post('/api/settlement/:year/close', async (req, res) => {
  const year = Number(req.params.year)
  if (!Number.isInteger(year)) return res.status(400).json({ error: 'Ungültiges Jahr' })
  const sentAt = sentAtOf(req)
  if (sentAt === false) return res.status(400).json({ error: SENT_AT_INVALID })
  // Rechnen und Einfrieren im selben Vorgang: Käme dazwischen eine Änderung an einer
  // Kostenposition durch, fröre Mietfuchs einen Stand ein, den es so nie gegeben hat.
  const schonDa = await writeData(async (db) => {
    if (await findClosedSettlement(db, year)) return true
    await closeSettlement(db, {
      id: newId(),
      year,
      closedAt: new Date().toISOString(),
      sentAt,
      settlement: computeSettlement(snapshotOf(await readStock(db), year)),
    })
    return false
  })
  if (schonDa) return res.status(409).json({ error: `Abrechnung ${year} ist bereits abgeschlossen.` })
  res.status(201).json({ ok: true })
})

// Versanddatum nachtragen (für die §556-Frist)
app.put('/api/settlement/:year/close', async (req, res) => {
  const year = Number(req.params.year)
  const sentAt = sentAtOf(req)
  if (sentAt === false) return res.status(400).json({ error: SENT_AT_INVALID })
  const gefunden = await writeData((db) => setSentAt(db, year, sentAt))
  if (!gefunden) return res.status(404).json({ error: 'Abrechnung ist nicht abgeschlossen.' })
  res.json({ ok: true })
})

// Wieder öffnen (Snapshot verwerfen, es gilt wieder die Live-Berechnung)
app.delete('/api/settlement/:year/close', async (req, res) => {
  const year = Number(req.params.year)
  const gefunden = await writeData((db) => reopenSettlement(db, year))
  if (!gefunden) return res.status(404).json({ error: 'Abrechnung ist nicht abgeschlossen.' })
  res.json({ ok: true })
})

app.get('/api/consumption/:year', async (req, res) => {
  const year = Number(req.params.year)
  if (!Number.isInteger(year)) return res.status(400).json({ error: 'Ungültiges Jahr' })
  res.json(consumptionOverview(snapshotOf(await readData(readStock), year)))
})

// Mietkonto: Soll/Ist je Monat und Mietverhältnis für das Jahr
app.get('/api/rentledger/:year', async (req, res) => {
  const year = Number(req.params.year)
  if (!Number.isInteger(year)) return res.status(400).json({ error: 'Ungültiges Jahr' })
  res.json(rentLedger(snapshotOf(await readData(readStock), year)))
})

// Steuer-Übersicht (Hilfe für die Anlage V): Einnahmen, Werbungskosten, Überschuss
app.get('/api/taxreport/:year', async (req, res) => {
  const year = Number(req.params.year)
  if (!Number.isInteger(year)) return res.status(400).json({ error: 'Ungültiges Jahr' })
  res.json(taxReport(snapshotOf(await readData(readStock), year)))
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

// Beleg löschen — nur wenn keine Kostenposition mehr darauf verweist.
//
// **Gefragt wird die Datenbank und nicht die db.json.** Die Frage nach der Verknüpfung ist die
// einzige Sicherung, die zwischen einem Klick im Belegarchiv und einer gelöschten Rechnung
// steht. Fragte sie weiter die Datei, sähe sie nach dem Umstieg einen leeren Bestand, jeder
// Beleg gälte als unbenutzt, und der Klick löschte die Rechnung unter einer Kostenposition weg.
app.delete('/api/uploads/:file', async (req, res) => {
  const name = path.basename(req.params.file) // verhindert Pfad-Ausbrüche
  const full = path.join(UPLOAD_DIR, name)
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'Datei nicht gefunden' })
  const inUse = await readData((db) => invoiceFilesInUse(db, [name]))
  if (inUse.has(name)) {
    return res.status(409).json({ error: 'Beleg ist noch mit Kostenpositionen verknüpft.' })
  }
  fs.unlinkSync(full)
  res.json({ ok: true })
})

// ---------- Backup & Wiederherstellen ----------
app.get('/api/backup', async (req, res) => {
  // Wie beim Wiederherstellen: Der Belegordner muss dastehen, bevor jemand ihn liest. Dass er
  // es heute tut, liegt nur daran, dass multer ihn beim Laden des Moduls anlegt und `load()`
  // ihn ebenfalls anlegt. Beides sind Nebenwirkungen an anderer Stelle, und ein Backup ist der
  // schlechteste Zeitpunkt für einen Fehler.
  fs.mkdirSync(UPLOAD_DIR, { recursive: true })
  const zip = new AdmZip()
  // **Genau eine der beiden Ablagen kommt ins Archiv, nämlich die, die den Bestand trägt.**
  //
  // Solange die Datenbank ihn trägt, ist sie es, und eine danebenliegende db.json bleibt
  // draußen: Sie ist der Stand vom Tag des Umstiegs, und beim Wiederherstellen gilt eine db.json
  // im Archiv vor der Datenbank (siehe die Restore-Route). Legte man sie mit hinein, holte ein
  // Wiederherstellen also den alten Stand zurück und verwürfe alles seither Erfasste.
  //
  // Trägt die Datenbank ihn **nicht** (nicht geöffnet oder Umstieg gescheitert), ist die db.json
  // der ganze Bestand, und die Datenbank gehört umgekehrt nicht ins Archiv: Sie ist dann leer
  // oder unvollständig, und ein Wiederherstellen würde sie zum maßgeblichen Bestand machen.
  // Genau daran führte das Backup bisher an der Sperre aus health.ts vorbei.
  const traegtDenBestand = database !== null && databaseUnavailable(databaseState()) === null
  const jsonFile = path.join(DATA_DIR, 'db.json')

  // **Trägt gerade keine von beiden, entsteht kein Archiv.** Das ist der Fall, in dem der
  // Umstieg gelaufen ist (die db.json heißt dann `db.json.abgeloest`) und danach die Datenbank
  // kaputtgeht. Übrig bliebe ein Archiv aus Belegen, und genau so eines lehnt das
  // Wiederherstellen ab, weil ihm der Bestand fehlt. Ein Backup, das sich nicht einspielen
  // lässt, ist schlimmer als keines: Der Vermieter hält sich danach für gesichert. Deshalb sagt
  // Mietfuchs, was los ist, und nennt den Weg, der immer funktioniert.
  if (!traegtDenBestand && !fs.existsSync(jsonFile)) {
    return res.status(503).json({
      error:
        'Mietfuchs kann gerade kein Backup erstellen, weil es an seine Daten nicht herankommt: ' +
        'Die Datenbank lässt sich nicht lesen, und eine Datei db.json gibt es nicht mehr. Ein ' +
        'Archiv ohne Bestand ließe sich später nicht einspielen, und deshalb entsteht keines. ' +
        `Sichern Sie bitte stattdessen den ganzen Datenordner (${DATA_DIR}), indem Sie ihn ` +
        'kopieren; darin ist alles enthalten. Woran es liegt, steht im Cockpit.',
    })
  }

  if (!traegtDenBestand) zip.addLocalFile(jsonFile)
  for (const name of fs.readdirSync(UPLOAD_DIR)) {
    zip.addLocalFile(path.join(UPLOAD_DIR, name), 'uploads')
  }

  // Die Datenbank kommt als **Schnappschuss** mit und nicht als Kopie der laufenden Datei
  // (db/backup.ts).
  if (traegtDenBestand && database) {
    // **Ein eigener Name je Anfrage.** Zwei gleichzeitige Backups teilten sich sonst die
    // Zwischendatei, und die zweite löschte, was die erste gerade packen will; heraus käme ein
    // Archiv ohne Datenbank oder ein Serverfehler, und zwei Klicks auf denselben Knopf sind
    // nichts Ausgefallenes. Dass es heute auch mit festem Namen gutginge, hängt allein daran,
    // in welcher Reihenfolge Node die Fortsetzungen abarbeitet — das sagt weder unsere Schlange
    // zu noch der Treiber darunter.
    //
    // Aufgeräumt wird im `finally`. Stirbt der Prozess mitten im Schnappschuss, bleibt eine
    // Datei liegen; weggeräumt wird sie dann bewusst **nicht** von der nächsten Anfrage, denn
    // eine Suche nach fremden Resten träfe genau die Zwischendatei eines gleichzeitig laufenden
    // Backups und brächte die Verdrängung zurück, die dieser Name gerade verhindert.
    const temp = path.join(DATA_DIR, `${ARCHIVE_DB_NAME}.${newId()}.backup`)
    try {
      await writeDatabaseSnapshot(database, temp)
      zip.addFile(ARCHIVE_DB_NAME, fs.readFileSync(temp))
    } catch (err) {
      // Hier wird abgebrochen und nicht stillschweigend ohne Datenbank gepackt: Ein Archiv, das
      // sich vollständig anfühlt und es nicht ist, fällt erst im Ernstfall auf.
      return res.status(500).json({ error: `Die Datenbank ließ sich nicht sichern: ${messageOf(err)}` })
    } finally {
      fs.rmSync(temp, { force: true })
    }
  }
  zip.addFile(ARCHIVE_INFO_NAME, Buffer.from(archiveInfoText(new Date()), 'utf8'))

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
type ReadBackup = {
  // `null`, wenn das Archiv keine db.json führt: Auf einem Rechner, der nie eine hatte,
  // entsteht sie seit dem Umstieg der Routen gar nicht mehr.
  dbText: string | null
  files: { fileName: string, content: Buffer }[]
  // Die Datenbank aus dem Archiv, oder `null` bei einem Archiv aus einer Version vor ihr. Das
  // ist kein Randfall: Genau solche Archive liegen bei den heutigen Nutzern.
  database: Buffer | null
  // Woher das Archiv stammt, in Worten für eine Meldung.
  origin: string
}

function readBackup(buffer: Buffer): ReadBackup {
  let zip: AdmZip
  try {
    zip = new AdmZip(buffer)
    zip.getEntries() // adm-zip 0.6 liest das Verzeichnis erst hier
  } catch {
    throw new Error('Datei ist kein gültiges ZIP-Archiv.')
  }
  const entries = zip.getEntries()
  const dbEntry = entries.find((e) => e.entryName === 'db.json')

  // Ausdrücklich typisiert: Was hier hineinläuft, kommt aus einem hochgeladenen Archiv und wird
  // gerade erst geprüft. Der Typ soll nicht davon abhängen, was weiter unten hineingeschoben wird.
  // Die Datenbank und die Herkunftsangabe. Beide fehlen in jedem Archiv, das vor Aufgabe 7a
  // entstanden ist, und beides ist in Ordnung: Die db.json ist dann der ganze Bestand.
  const databaseEntry = entries.find((e) => e.entryName === ARCHIVE_DB_NAME)
  const infoEntry = entries.find((e) => e.entryName === ARCHIVE_INFO_NAME)
  // **Eines von beiden muss da sein.** Ein Archiv von vor dem Umstieg führt nur die db.json,
  // eines von einem frischen Rechner nur die Datenbank, und eines dazwischen beide. Fehlt
  // jedoch beides, ist es kein Mietfuchs-Backup.
  if (!dbEntry && !databaseEntry) {
    throw new Error('Im Archiv fehlen sowohl die Datenbank als auch die db.json. Ist das wirklich ein Mietfuchs-Backup?')
  }

  const files: { fileName: string, e: AdmZip.IZipEntry }[] = []
  let totalSize = (dbEntry?.header.size ?? 0) + (databaseEntry?.header.size ?? 0) + (infoEntry?.header.size ?? 0)
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

  // Die db.json nur, wenn das Archiv eine führt. Ist sie da, wird sie geprüft wie bisher: Was
  // ihr fehlt, fiele sonst erst beim Einlesen auf, und dann ist schon etwas ersetzt.
  let dbText: string | null = null
  let parsed: unknown = null
  if (dbEntry) {
    try {
      dbText = zip.readAsText(dbEntry)
      parsed = JSON.parse(dbText)
    } catch {
      throw new Error('Die db.json im Archiv ist beschädigt (kein gültiges JSON).')
    }
  }
  // Gültiges JSON heißt noch nicht, dass es ein Mietfuchs-Datenbestand ist (#59). Käme hier
  // etwas durch, das dem Datenmodell nicht entspricht, ginge der laufende Server danach nicht
  // mehr: Das Einlesen wirft, und **jede** weitere Anfrage scheitert erneut, bis jemand die
  // Datei von Hand zurückkopiert. Deshalb wird geprüft, bevor irgendetwas überschrieben wird.
  // Was krumm, aber gültig ist, kommt weiterhin durch; die Begründung steht in legacy/validate.ts.
  const { problems } = dbEntry ? validateDb(parsed) : { problems: [] }
  if (problems.length > 0) {
    throw new Error(
      'Die Daten in diesem Archiv passen nicht zu Mietfuchs, deshalb wurde nichts davon übernommen. ' +
        `Ihre bisherigen Daten sind unverändert. Beanstandet wurde:\n${findingsText(problems)}`,
    )
  }
  // Die Herkunftsangabe ist eine Auskunft und keine Prüfung: Ein unlesbares Feld darf das
  // Wiederherstellen nicht verhindern, sondern führt nur zu „unbekannter Herkunft".
  let info: unknown = null
  if (infoEntry) {
    try {
      info = JSON.parse(zip.readAsText(infoEntry))
    } catch {
      info = null
    }
  }

  // Alles in den Speicher lesen, bevor geschrieben wird: Scheitert ein Eintrag, ist noch nichts ersetzt
  return {
    dbText,
    files: files.map(({ fileName, e }) => ({ fileName, content: e.getData() })),
    database: databaseEntry ? databaseEntry.getData() : null,
    origin: originText(info),
  }
}

// Die Datenbank nach dem Wiederherstellen (#55, Aufgabe 7a). Gibt zurück, was der Nutzer
// darüber hinaus wissen muss; die Liste ist im Regelfall leer.
//
// **Der Server hält die Datei die ganze Laufzeit offen**, und unter Windows lässt sie sich dann
// nicht ersetzen. Der Weg ist deshalb schließen, ersetzen, neu öffnen, migrieren — dieselbe
// Reihenfolge wie beim Umstieg und aus demselben Grund.
//
// Zwei Fälle, und der zweite ist der, dessentwegen diese Aufgabe vorgezogen wurde:
//
//   1. **Das Archiv bringt eine Datenbank mit.** Sie wird die neue. Geprüft ist sie zu diesem
//      Zeitpunkt schon.
//   2. **Es bringt keine mit**, weil es aus einer Version vor dieser stammt. Dann wird die
//      Datenbank aus der wiederhergestellten db.json **neu aufgebaut**, mit demselben Weg und
//      derselben centgenauen Regression wie beim Umstieg. Die db.json zu ersetzen und die alte
//      Datenbank stehen zu lassen wäre der schlimmste Ausgang: Der Nutzer sähe eine
//      Bestätigung und arbeitete danach mit den Daten von vorher weiter.
async function restoreDatabase(staged: string | null): Promise<string[]> {
  const target = databaseFile(DATA_DIR)

  // **Erst aus der Nahtstelle nehmen, dann leerlaufen lassen, dann schließen.** Die Reihenfolge
  // ist die ganze Zusage. Ab dem `null` bekommt jede neue Anfrage ihre 503 statt einer
  // geschlossenen Verbindung, und das Leerlaufen wartet ab, was schon läuft. Ein `close()` ohne
  // beides schnitte eine gerade offene Transaktion mitten im Schreiben ab; SQLite rollt sie beim
  // nächsten Öffnen zwar zurück, aber die Anfrage, die sie angestoßen hat, stirbt ohne Antwort.
  const offen = database
  database = null
  if (offen) {
    await offen.write(async () => undefined)
    offen.close()
  }

  // Die bisherige Datenbank beiseite, wie `db.json.vor-restore` daneben — und nur, wenn es
  // eine gab. Sie wandert und bleibt nicht liegen: Der Umstieg unten muss sie leer vorfinden,
  // sonst greift seine Regel „steht schon etwas darin, passiert nichts", und genau die soll
  // hier nicht weich werden.
  //
  // **Bewegt wird mit Wiederholungen** (`replaceFile`, dieselbe Funktion wie beim Umstieg). Unter
  // Windows kann ein Virenscanner die eben geschlossene Datei kurz offen halten; ein nacktes
  // `renameSync` scheiterte dann an etwas, das von selbst vergeht, und zwar ausgerechnet in dem
  // Augenblick, in dem die einzige Kopie der wiederhergestellten Daten noch unter ihrem
  // Zwischennamen liegt.
  if (fs.existsSync(target)) await replaceFile(target, path.join(DATA_DIR, DB_BEFORE_RESTORE))
  if (staged) await replaceFile(staged, target)

  try {
    database = await openDatabase({ dataDir: DATA_DIR })
    openProblem = null
  } catch (err) {
    openProblem = messageOf(err)
    return [`Die Datenbank ließ sich nach dem Wiederherstellen nicht öffnen: ${openProblem}`]
  }

  if (staged) {
    // Fall 1: Das Archiv hat seine Datenbank mitgebracht, und sie ist jetzt der Bestand. Ein
    // Umstieg, der beim Start gescheitert war, ist damit gegenstandslos: Die db.json von damals
    // ist mit ersetzt worden. Bliebe sein Stand stehen, sperrte er die Datenrouten weiter, und
    // zwar ausgerechnet nach der Wiederherstellung, die das Problem behoben hat.
    changeover = {
      state: 'none',
      message: 'Die wiederhergestellte Sicherung hat ihre Datenbank mitgebracht; es war nichts zu übernehmen.',
      notes: [], protocol: null, database,
    }
    return []
  }

  // Fall 2: neu aufbauen. Scheitert er, ist nichts verloren — die wiederhergestellte db.json
  // liegt da, und beim nächsten Start wird es erneut versucht. Die Datenrouten bleiben bis
  // dahin gesperrt, weil eine leere Datenbank auszugeben schlimmer wäre (siehe health.ts).
  const rebuilt = await runChangeover({
    dataDir: DATA_DIR,
    opened: database,
    reopen: () => openDatabase({ dataDir: DATA_DIR }),
  })
  changeover = rebuilt
  database = rebuilt.database
  if (!database) openProblem = 'nach dem Wiederherstellen nicht wieder geöffnet'
  return rebuilt.state === 'failed' ? [rebuilt.message] : rebuilt.notes
}

// **Nur eine Wiederherstellung auf einmal.** Der eigene Name je Zwischendatei schützt die
// geprüfte Datei, nicht aber den Austausch selbst: `restoreDatabase` nimmt die Datenbank aus der
// Nahtstelle, schließt sie, schiebt die bisherige beiseite und die neue an ihren Platz. Liefe
// ein zweiter Aufruf dazwischen, schöbe er die eben aktivierte Datei beiseite und ließe die
// Verbindung des ersten offen; was am Ende an seinem Platz liegt, hinge an der Reihenfolge der
// Fortsetzungen. Die Oberfläche sperrt das Dateifeld während des Vorgangs nicht, zwei Klicks
// sind also nichts Ausgefallenes.
//
// Eine Schlange wäre hier falsch: Wer zweimal klickt, will nicht zwei Wiederherstellungen
// nacheinander, sondern eine. Die zweite Anfrage bekommt deshalb eine Absage und keine Warteschlange.
let restoreRunning = false

app.post('/api/restore', restoreUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei' })
  if (restoreRunning) {
    return res.status(409).json({
      error: 'Es läuft gerade eine Wiederherstellung. Bitte warten Sie, bis sie fertig ist.',
    })
  }
  let backup: ReadBackup
  try {
    backup = readBackup(req.file.buffer)
  } catch (err) {
    return res.status(400).json({ error: messageOf(err) })
  }
  restoreRunning = true
  try {
    await runRestore(backup, res)
  } finally {
    restoreRunning = false
  }
})

// Der eigentliche Vorgang, ab dem Augenblick, in dem das Archiv gelesen und für brauchbar
// befunden ist. Eigene Funktion, damit die Marke oben in einem `finally` zurückgesetzt wird und
// nicht an jedem einzelnen Rückweg von Hand.
async function runRestore(backup: ReadBackup, res: Response): Promise<void> {
  // Der Datenordner und der Belegordner müssen dastehen, bevor hier etwas hineingeschrieben
  // wird. Heute tun sie das auch auf einem frischen Rechner, aber nur beiläufig: multer legt
  // den Belegordner beim Laden des Moduls an, weil `destination` ein fester Pfad ist. Diese
  // Route soll sich auf die Eigenheit einer Bibliothek nicht verlassen, zumal `recursive`
  // einen vorhandenen Ordner ohnehin in Ruhe lässt.
  fs.mkdirSync(UPLOAD_DIR, { recursive: true })

  // **Führt das Archiv eine db.json, gilt sie, und die mitgebrachte Datenbank wird verworfen.**
  // Ohne diese Regel verliert der Aktualisierungsweg Daten: Wer eine Version vor dem Umstellen
  // der Routen fährt, hat eine lebende db.json und eine Datenbank, die auf dem Stand des
  // Umstiegstags stehengeblieben ist, und sein Archiv führt beides. Ebenso, wer ein Backup zieht,
  // während der Umstieg gescheitert ist: Dann ist die Datenbank im Archiv leer. Würde sie
  // aktiviert, sähe der Vermieter nach der Bestätigung „ok" ein veraltetes oder leeres Haus,
  // schriebe hinein, und ab dem Augenblick fände der Umstieg eine gefüllte Datenbank vor und
  // liefe nie wieder; die db.json wäre dauerhaft abgehängt. Genau der Ausgang, den die Sperre in
  // health.ts verhindern soll, und das Backup führte daran vorbei.
  //
  // Geraten wird dabei nicht. Jede bisher veröffentlichte Version hat die db.json als lebenden
  // Bestand geschrieben; ein Archiv, das eine führt, stammt also von dort, und sie ist das
  // Neuere. Umgekehrt legt diese Version keine db.json mehr ins Archiv, sobald die Datenbank den
  // Bestand trägt (siehe die Backup-Route), ein mehrdeutiges Archiv kann ab jetzt also gar nicht
  // mehr entstehen.
  //
  // **Die Entscheidung fällt hier und nicht erst weiter unten**, und das ist nicht nur
  // Aufräumen: Die Prüfung der mitgebrachten Datenbank lehnt ein Archiv mit 400 ab, wenn sie
  // beschädigt ist oder aus einer neueren Version stammt. Stünde sie vor dieser Entscheidung,
  // scheiterte ausgerechnet das Archiv des Aktualisierungswegs an einer Datei, die ohnehin
  // gelöscht worden wäre, obwohl sein lebender Bestand einwandfrei ist.
  const ausDerDatei = backup.dbText !== null

  // Die Datenbank aus dem Archiv wird geprüft, **bevor** irgendetwas ersetzt ist — dieselbe
  // Bauart wie bei der db.json darüber (#59) und aus demselben Grund. Über den Umweg Backup
  // käme ein neueres Schema sonst herein, und die Prüfung beim Start käme zu spät, weil die
  // Datei dann schon an ihrem Platz läge.
  // **Ein eigener Name je Anfrage**, aus demselben Grund wie beim Backup: Zwei gleichzeitige
  // Wiederherstellungen teilten sich sonst die Zwischendatei, und die zweite überschriebe, was
  // die erste gerade geprüft hat. Zwei Klicks sind nichts Ausgefallenes, die Oberfläche sperrt
  // das Dateifeld während des Vorgangs nicht.
  const archiveDatabase = ausDerDatei ? null : backup.database
  const staged = archiveDatabase ? `${databaseFile(DATA_DIR)}.restore-${newId()}` : null
  if (staged && archiveDatabase) {
    try {
      fs.rmSync(staged, { force: true })
      fs.writeFileSync(staged, archiveDatabase)
    } catch (err) {
      res.status(500).json({ error: `Die Datenbank aus dem Archiv ließ sich nicht ablegen: ${messageOf(err)}` })
      return
    }
    const problem = await archiveDatabaseProblem(staged)
    if (problem) {
      fs.rmSync(staged, { force: true })
      res.status(400).json({ error: `${problem}\n\nDas Archiv stammt aus: ${backup.origin}.` })
      return
    }
  }

  // Sicherheitskopie des aktuellen Stands, dann ersetzen. **Nur wenn es einen gibt**: Auf einem
  // frischen Rechner entsteht die db.json erst beim ersten Speichern, und genau dann wird am
  // häufigsten wiederhergestellt, nämlich beim Umzug auf einen neuen Rechner oder nach einem
  // Schaden. Ohne diese Frage brach das Kopieren mit ENOENT ab, und der Nutzer bekam einen
  // Serverfehler zu sehen, wo ihm gerade geholfen werden sollte. Eine leere Sicherheitskopie
  // anzulegen wäre die falsche Abhilfe: Die Oberfläche verspricht dort den vorherigen Stand,
  // und den gab es nicht.
  const current = path.join(DATA_DIR, 'db.json')
  if (fs.existsSync(current)) fs.copyFileSync(current, path.join(DATA_DIR, 'db.json.vor-restore'))
  // Führt das Archiv keine db.json, wird auch keine angelegt. Eine leere wäre schlimmer als
  // keine: Der Umstieg beim nächsten Start hielte sie für einen zu übernehmenden Bestand.
  if (backup.dbText !== null) fs.writeFileSync(current, backup.dbText, 'utf8')
  else fs.rmSync(current, { force: true })
  for (const { fileName, content } of backup.files) fs.writeFileSync(path.join(UPLOAD_DIR, fileName), content)

  let notes: string[]
  try {
    notes = await restoreDatabase(staged)
  } catch (err) {
    // **Hier wird nicht versprochen, dass beim nächsten Start alles gut wird.** Das stand einmal
    // so da und hielt nicht: Scheitert das Bewegen der Datei, kann die wiederhergestellte
    // Datenbank unter ihrem Zwischennamen liegengeblieben sein, und der nächste Start legt dann
    // eine frische leere an; oder die bisherige liegt noch an ihrem Platz, und der Vermieter
    // arbeitet nach einer bestätigten Wiederherstellung mit dem alten Stand weiter. Beides sieht
    // von hier aus gleich aus.
    //
    // Gesagt wird deshalb, was sicher stimmt: Nichts ist gelöscht, der Datenordner hat den
    // Stand, und dort liegt alles beieinander. Weggeräumt wird nichts, auch die Zwischendatei
    // nicht: Sie kann die einzige Kopie der wiederhergestellten Daten sein.
    notes = [
      `Ihre Daten sind aus dem Archiv geschrieben worden, die Datenbank ließ sich dabei aber ` +
        `nicht erneuern: ${messageOf(err)}. Gelöscht ist nichts; im Datenordner ` +
        `(${DATA_DIR}) liegen der vorherige Stand als „mietfuchs.sqlite.vor-restore" und, falls ` +
        'das Archiv eine mitgebracht hat, die neue Datenbank noch unter einem Namen, der mit ' +
        '„mietfuchs.sqlite.restore-" beginnt. Bitte melden Sie diesen Fehler, bevor Sie etwas ' +
        'von Hand verschieben.',
    ]
  }

  // **Die Einstellungen neu einlesen.** Sie liegen als Kopie im Arbeitsspeicher (siehe die
  // Begründung am Zwischenspeicher), und das Wiederherstellen ist eine der Stellen, die ihn
  // ungültig machen. Ohne diese Zeile zeigte die Oberfläche bis zum nächsten Start den Stand von
  // vorher, und die gedruckte Abrechnung nähme Vermietername und IBAN von dort. Schlimmer noch:
  // `PUT /api/settings` geht vom Zwischenspeicher aus, die nächste beliebige Änderung schriebe
  // also den veralteten Stand vollständig über den wiederhergestellten zurück.
  //
  // Scheitert es, bleibt es bei den Vorgabewerten und die Datenrouten melden sich ohnehin; ein
  // Fehler hier darf das gelungene Wiederherstellen nicht in einen Fehlschlag verwandeln.
  try {
    await refreshSettings()
  } catch (err) {
    notes = [...notes, `Die Einstellungen ließen sich nach dem Wiederherstellen nicht lesen: ${messageOf(err)}`]
  }
  res.json({ ok: true, notes })
}

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
  res.json(await recommendations.get({ consented: storedSettings.updateCheck === 'on' }))
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
  res.json(await updateChecker.check({ consent: storedSettings.updateCheck }))
})

app.post('/api/update/check', async (req, res) => {
  res.json(await updateChecker.check({ consent: storedSettings.updateCheck, force: true }))
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
// Wie lange das Beenden auf einen laufenden Schreibvorgang wartet. Fünf Sekunden sind großzügig
// für eine gewöhnliche Anfrage und kurz genug, dass niemand denkt, der Knopf habe nicht gewirkt.
const QUIT_DRAIN_MS = 5000

app.post('/api/quit', (req, res) => {
  if (!STANDALONE) return res.status(404).json({ error: 'Beenden geht nur bei der Programmdatei. Hier beendet die Umgebung den Dienst.' })
  res.json({ ok: true })
  // Erst antworten, dann beenden: Sonst sähe der Browser einen Verbindungsabbruch statt der
  // Bestätigung.
  //
  // **Vorher läuft die Schlange leer.** Die frühere Begründung („offene Schreibvorgänge gibt es
  // nicht, store.ts schreibt jede Änderung sofort") trägt nicht mehr, seit über die Datenbank
  // geschrieben wird: Ein Schreibvorgang kann eingereiht sein oder gerade laufen, und
  // `process.exit` schnitte ihn mitten in seiner Transaktion ab. Bestätigte Daten gingen dabei
  // nicht verloren, denn die Antwort kommt erst nach dem Festschreiben, aber die betroffene
  // Anfrage stürbe ohne Antwort. Das Leerlaufen kostet im Regelfall nichts, weil beim Klick auf
  // „Beenden" nichts in der Schlange steht.
  res.on('finish', () => {
    let schonBeendet = false
    const beenden = () => {
      if (schonBeendet) return
      schonBeendet = true
      setTimeout(() => process.exit(0), 100)
    }
    if (!database) return beenden()
    // **Mit Frist, und die ist der Kern.** Die Schlange lehnt nie ab, das Risiko ist also nicht
    // ein gescheitertes, sondern ein **hängendes** Leerlaufen. Genau davor warnt open.ts beim
    // langsamen Schreibvorgang („Liegen die Daten auf einem Netzlaufwerk, ist das die häufigste
    // Ursache") und bricht dort bewusst nichts ab. Hier ist die Abwägung umgekehrt: Der Vermieter
    // hat auf einen Knopf gedrückt, der das Programm schließt, und aus dem Startmenü gestartet
    // gibt es kein Konsolenfenster, dieser Knopf ist also der einzige Weg. Ein Programm, das sich
    // nicht mehr schließen lässt, ist schlimmer als eine abgeschnittene Transaktion: Bestätigte
    // Daten gehen dabei nicht verloren, denn die Antwort auf eine Speicheranfrage kommt erst nach
    // dem Festschreiben, und SQLite rollt eine halbe Transaktion beim nächsten Öffnen zurück.
    const frist = setTimeout(() => {
      console.error(`Beim Beenden lief ein Schreibvorgang noch nach ${QUIT_DRAIN_MS / 1000} Sekunden. Mietfuchs schließt trotzdem.`)
      beenden()
    }, QUIT_DRAIN_MS)
    frist.unref()
    database.write(async () => undefined).then(beenden, beenden)
  })
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
  // **Fehler der Datenbank bekommen ihre eigene Meldung** (db/errors.ts). Ohne diese Zeile käme
  // Drizzles oberste Meldung heraus, und die trägt das SQL **samt der eingesetzten Werte des
  // Nutzers**. Der Status kommt von dort mit, denn er gehört zur Einordnung: Eine verletzte
  // Zusicherung kommt aus der Anfrage, ein Schreibschutz vom Rechner.
  const ausDerDatenbank = databaseProblem(err)
  if (ausDerDatenbank) {
    return res.status(ausDerDatenbank.status).json({ error: ausDerDatenbank.message })
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
// **Scheitert das Öffnen, läuft der Server trotzdem**, aber ohne Daten: Die Datenrouten melden
// sich mit 503 und sagen, woran es liegt. Der Server selbst muss dennoch hochkommen, denn sonst
// gäbe es auch keine Oberfläche, in der die Meldung stünde, und keine Route zum Wiederherstellen
// eines Backups. Aus dem Startmenü gestartet sähe der Vermieter dann gar nichts.
let database: OpenedDatabase | null = null
let openProblem: string | null = null
try {
  database = await openDatabase({ dataDir: DATA_DIR })
} catch (err) {
  openProblem = messageOf(err)
}

// Der Umstieg der vorhandenen Daten, beim ersten Start der neuen Version (siehe
// db/changeover.ts). Er läuft hier und nicht auf Zuruf, weil niemand einen Befehl eingeben soll,
// um an seine eigenen Daten zu kommen, und er läuft **vor** `app.listen`: Solange der Server
// noch nicht antwortet, kann ihm auch niemand dazwischenschreiben.
//
// Scheitert er, geht der Start trotzdem weiter, die Datenrouten bleiben aber gesperrt: Die Daten
// stehen dann noch in der db.json, und eine leere Datenbank auszugeben wäre schlimmer als eine
// Meldung (siehe health.ts). Beim nächsten Start wird es erneut versucht.
//
// **Veränderlich, weil das Wiederherstellen eines Backups den Stand ändert** (siehe
// `restoreDatabase`). Bliebe hier der Stand vom Start stehen, sperrte ein einmal gescheiterter
// Umstieg die Datenrouten auch dann noch, wenn der Nutzer das Problem gerade mit genau dem
// Mittel behoben hat, das ihm dafür angeboten wird.
let changeover: ChangeoverResult = database
  ? await runChangeover({ dataDir: DATA_DIR, opened: database, reopen: () => openDatabase({ dataDir: DATA_DIR }) })
  : changeoverWithoutDatabase(DATA_DIR, openProblem ?? 'unbekannter Grund')
database = changeover.database
if (!database) openProblem = openProblem ?? 'nach dem Umstieg nicht wieder geöffnet'

// Die Einstellungen in den Arbeitsspeicher holen, siehe die Begründung am Zwischenspeicher.
// **Nach** dem Umstieg: Vorher stünde dort die leere Zeile einer frischen Datenbank, und der
// Nutzer sähe seinen Hausnamen erst nach einem Neustart wieder. Scheitert es, arbeitet
// Mietfuchs mit den Vorgabewerten weiter; die Datenrouten melden sich ohnehin mit 503, und die
// Meldung darüber steht im Zustandsbericht.
try {
  await refreshSettings()
} catch (err) {
  console.error(`Die Einstellungen ließen sich nicht lesen: ${messageOf(err)}`)
}

// Für /healthz: Der Bericht nennt den Stand, damit der Smoke-Test ihn von außen sieht (er läuft
// auf jeder Programmdatei und in den Containern von 22 Distributionen; ob das eingebaute SQLite
// überall trägt, zeigt sich erst dort) und damit die Oberfläche dem Nutzer einmal sagen kann,
// was mit seinen Daten geschehen ist. Beim Start aus einem Linux-Paket gibt es keine Konsole,
// auf der die Meldung sonst stünde.
function databaseState(): DatabaseState {
  const wie = { state: changeover.state, message: changeover.message, notes: changeover.notes }
  if (database) return { open: true, file: database.file, migrations: database.migrations, detail: 'geöffnet', changeover: wie }
  return { open: false, file: databaseFile(DATA_DIR), migrations: 0, detail: openProblem ?? 'nicht geöffnet', changeover: wie }
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
  else console.error(`Datenbank: nicht geöffnet. ${openProblem ?? ''}\nMietfuchs arbeitet weiter mit ${path.join(DATA_DIR, 'db.json')}; es geht nichts verloren.`)
  for (const warning of database?.warnings ?? []) console.error(`Hinweis: ${warning}`)
  // Der Umstieg der Daten (#55). Gelungen ist er einen Satz wert, gescheitert eine Erklärung auf
  // der Fehlerausgabe. Ohne Konsolenfenster (Linux-Paket) steht beides in der Oberfläche, die es
  // aus /healthz liest.
  if (changeover.state === 'done') {
    console.log(changeover.message)
    for (const note of changeover.notes) console.log(note)
    if (changeover.protocol) console.log(`Protokoll des Umstiegs: ${changeover.protocol}`)
  } else if (changeover.state === 'failed') {
    console.error(changeover.message)
  }
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

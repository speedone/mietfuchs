import express, { type NextFunction, type Request, type Response } from 'express'
import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'
import type { AiSettings, AiSlotName, AiStatus, AssessmentView, Extraction, Settings, UploadEntry, UploadLinks } from '../../shared/types.ts'
import { detectedYear, linesFromExtraction } from './assessment.ts'
import { bookingResponse, parseDecisions } from './bookingPlan.ts'
import { forgetAssessment, placeAssessment, readAssessment, readAssessmentOfFile, saveAssessment, uploadLinks } from './db/assessments.ts'
import { BookingRefusal, bookAssessment, previewBooking, viewAssessment, viewAssessments, viewRecord } from './db/booking.ts'
import { newId, UPLOAD_DIR, DATA_DIR } from './store.ts'
import { DEFAULT_SETTINGS } from './defaults.ts'
import { compareWithFrozen } from './settlementDiff.ts'
import { computeSettlement, consumptionOverview, rentLedger, taxPartsFor, taxReportFor, type ComputedSettlement } from './calc.ts'
import { heatingSnapshotFor, narrowToProperty, snapshotFor } from './snapshot.ts'
import { calendarPeriod, calendarYearPeriod, isCalendarRules, parsePeriodKey, periodContaining, periodLabel, periodOfKey, resolvePeriodParam, rulesOf, settlementDeadline, settlementPeriod, startYearOf } from '../../shared/period.ts'
import type { BillingPeriod, FuelGapQuestion, HeatingPlant, Unit } from '../../shared/types.ts'
import { plantRules, settledSeparately } from '../../shared/heatingPeriod.ts'
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
import { acknowledgeNotice, clearNotice, NOTICE_NAME, noticeKey, readNotice, recordNotice, type MigrationNotice } from './db/migrationNotice.ts'
import type { Database, Executor } from './db/client.ts'
import { databaseProblem } from './db/errors.ts'
import { readHeatingPlants, readProperties, readSettings, readStock, type Stock } from './db/read.ts'
import {
  closeHeatingSettlement, findClosedHeatingSettlement, heatingSettlementHistory, reopenHeatingSettlement, separateHeatingSettlements, setHeatingSentAt,
} from './db/heatingSettlements.ts'
import {
  changeTenant, closeSettlement, createEntity, createProperty, CrossPropertyError, findClosedSettlement, HeatingError, PeriodConflict, PeriodError, StaleTenancyError, invoiceFilesInUse, previewCostItemSplit, saveCostItemSplit,
  listProperties, removeEntity, removeProperty, reopenSettlement, setSentAt, settlementHistory, updateEntity, updateProperty,
  TenantChangeError, unitDependents, writeSettings, type CollectionName,
} from './db/repository.ts'
import { removeInterimGap, saveDistribution, saveInterimGap, SelfItemsError, setUpSelf } from './db/heatingSelf.ts'
import { saveHeatingInfo, saveHeatingRules } from './db/heatingInfo.ts'
import { heatingPeriodViews, removeCo2Statement, saveCo2Statement, saveHotWater } from './db/co2.ts'
import { saveServiceValues } from './db/serviceValues.ts'
import { removeEstimate, saveEstimate } from './db/heatingEstimates.ts'
import { co2SheetOf } from './co2Sheet.ts'
import { heatingPeriodOf, plantContext } from './db/heatingPeriodContext.ts'
import { LawOverrideError, lawOverrideSlots, readLawOverrides, removeLawOverride, saveLawOverride } from './db/lawOverrides.ts'
import { removeStock, saveStock } from './db/fuelStock.ts'
import { createDelivery, createEstimates, freezeFuelCarries, fuelGapQuestions, listDegreeDays, listDeliveries, removeDelivery, saveDegreeDays, unfreezeFuelCarries, updateDelivery } from './db/fuel.ts'
import { assignableHeatingItems, createHeatingPlant, listHeatingPlants, removeHeatingPlant, replaceHeatingPlant, updateHeatingPlant } from './db/heating.ts'
import { applyHeatingPeriodChange, previewHeatingPeriodChange } from './db/heatingPeriodChange.ts'
import { testTodayOf } from './testToday.ts'
import { applySeparate, previewSeparate } from './db/separateSettlement.ts'
import { applyPeriodChange, previewPeriodChange } from './db/periodChange.ts'
import {
  ARCHIVE_DB_NAME, ARCHIVE_INFO_NAME, DB_BEFORE_RESTORE,
  archiveDatabaseProblem, archiveInfoText, originText, writeDatabaseSnapshot,
} from './db/backup.ts'
import { findingsText, validateDb } from './legacy/validate.ts'
import { createUpdateChecker, UPDATE_URL } from './update.ts'
import { APP_VERSION, RUNTIME, STANDALONE } from './version.ts'
import { describeFile, describeFolder, hashFile, mimeTypeOf, uploadedAtOf } from './uploads.ts'
import { planTaxArchive } from './taxReceipts.ts'
import { forgetUpload, placeUpload, recordIfMissing, recordUpload, rowOf, uploadRows, type Placement, type UploadRow } from './db/uploads.ts'

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

// Belege landen im Belegordner auf der Platte. Seitenbilder, die der Browser aus einem
// gescannten PDF rendert (Feld `pages`), braucht nur die KI-Auswertung: Sie bleiben im
// Arbeitsspeicher und tauchen nie im Belegordner auf.
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

// Ein Beleg, der schon im Belegordner liegt (#170, Posteingang), statt eines neu hochgeladenen:
// Das Feld `existingFile` nennt ihn. Er wird nur gelesen und bei einem Abbruch nicht gelöscht,
// denn er gehörte schon vorher dem Vermieter. `undefined`: nicht angefragt; `null`: angefragt,
// aber kein Beleg dieses Namens im Ordner.
type DocumentSource = { path: string, filename: string, mimetype: string }
const existingDocument = (req: Request): DocumentSource | null | undefined => {
  const name: unknown = req.body?.existingFile
  if (name === undefined) return undefined
  if (typeof name !== 'string' || name === '' || path.basename(name) !== name) return null
  const full = path.join(UPLOAD_DIR, name)
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null
  return { path: full, filename: name, mimetype: mimeTypeOf(name) }
}
const NO_EXISTING = 'Diesen Beleg gibt es im Belegordner nicht (mehr). Bitte laden Sie die Seite neu.'
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
  // Name und Adresse gehören seit #92 zum Objekt. Die Spalten stehen noch da, weil der
  // eingefrorene Eingang sie schreibt und Migration 0001 sie abliest; ausgeliefert werden sie
  // nicht mehr, sonst zeigte die Oberfläche zwei Wahrheiten.
  const { houseName: _houseName, address: _address, ...settings } = effectiveSettings()
  const aiExternal = { text: isExternalUrl(settings.ai.text.url), images: settings.ai.images ? isExternalUrl(settings.ai.images.url) : false }
  return { ...settings, fixedByEnv: fixedByEnv(), aiKeys: keyInfo(), aiExternal }
}

app.get('/api/settings', (req, res) => res.json(settingsForClient()))
app.put('/api/settings', async (req, res) => {
  const body = bodyObject(req)
  // `houseName` und `address` schickt nur ein Tab von vor #92; sie gehören jetzt zum Objekt und
  // werden hier verworfen, statt eine Spalte zu beschreiben, die niemand mehr liest.
  const { fixedByEnv, aiKeys, aiExternal, ai, ollamaUrl, ollamaModel, houseName, address, ...changes } = body
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
// Die Frage „trägt die Datenbank den Bestand?“ und ihre beiden Gründe stehen in health.ts, damit
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
// Die Sammlungen, die ein Objekt tragen; die übrigen erben es über ihre Wurzel (#92).
const ROOTS: CollectionName[] = ['units', 'costItems', 'meters']

// ---------- Welches Objekt? (#92) ----------

// Eine Ablehnung, deren Meldung für den Nutzer geschrieben ist; die Fehlerbehandlung unten gibt
// sie unverändert weiter.
class RouteProblem extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// Das Objekt einer Anfrage: aus `?property=`, beim Anlegen einer Wurzel auch aus `propertyId`
// im Rumpf.
//
// **Fehlt die Angabe und gibt es genau ein Objekt, gilt dieses.** Ein Tab von vor dem Update,
// der Smoke-Test und jedes Skript arbeiten so unverändert weiter, und wer ein Haus hat, merkt
// nichts. **Bei mehreren Objekten wird abgelehnt**, statt still alle zu liefern: Eine Liste über
// zwei Häuser sähe auf der Seite Kosten plausibel aus und wäre falsch.
async function propertyOf(db: Database, req: Request, fromBody = false): Promise<string> {
  const query: unknown = req.query.property
  const body: unknown = fromBody ? bodyObject(req).propertyId : undefined
  const wanted = typeof query === 'string' && query !== '' ? query : typeof body === 'string' && body !== '' ? body : null
  const alle = await listProperties(db)
  if (wanted !== null) {
    if (!alle.some((p) => p.id === wanted)) throw new RouteProblem(404, 'Dieses Objekt gibt es nicht (mehr). Bitte laden Sie die Seite neu.')
    return wanted
  }
  const [einziges, ...weitere] = alle
  if (einziges && weitere.length === 0) return einziges.id
  throw new RouteProblem(400, 'Welches Objekt ist gemeint? Seit es mehrere Objekte gibt, braucht diese Anfrage die Angabe property.')
}

// Der Zeitraum einer Anfrage (#208): der Monat des Beginns als `JJJJ-MM`, bei einem reinen
// Kalenderobjekt auch die nackte Jahreszahl (G-C6). Gibt es ihn für das Objekt nicht, nennt die
// Antwort, was gemeint sein könnte; ein Tab von vor einem Wechsel bekommt so nie still den Rumpf.
async function periodOf(db: Database, req: Request, propertyId: string): Promise<BillingPeriod> {
  const property = (await listProperties(db)).find((p) => p.id === propertyId)
  const resolved = resolvePeriodParam(rulesOf(property), String(req.params.period ?? ''))
  if ('error' in resolved) throw new RouteProblem(resolved.status, resolved.error)
  return resolved.period
}

// Eine kalte Rechnung über zwei Abrechnungszeiträume (#208, Entwurf 3.4): erst die Vorschau mit
// den Beträgen je Zeitraum, dann das Speichern aller Teile in einer Transaktion. Begründung in
// serviceSplit.ts und db/repository.ts.
app.post('/api/costItems/split/preview', async (req, res) => {
  res.json(await readData(async (db) => ({ parts: await previewCostItemSplit(db, await propertyOf(db, req, true), bodyObject(req), null) })))
})
app.post('/api/costItems/split', async (req, res) => {
  res.status(201).json(await writeData(async (db) => saveCostItemSplit(db, await propertyOf(db, req, true), bodyObject(req), null, newId)))
})
app.post('/api/costItems/:id/split/preview', async (req, res) => {
  res.json(await readData(async (db) => ({ parts: await previewCostItemSplit(db, null, bodyObject(req), req.params.id) })))
})
app.put('/api/costItems/:id/split', async (req, res) => {
  res.json(await writeData((db) => saveCostItemSplit(db, null, bodyObject(req), req.params.id, newId)))
})

for (const coll of COLLECTIONS) {
  // Aufgelistet wird über `narrowToProperty`, dieselbe Regel wie beim Rechnen; eine zweite
  // Fassung für die Listen liefe irgendwann anders als die der Abrechnung.
  app.get(`/api/${coll}`, async (req, res) => {
    res.json(await readData(async (db) => {
      const propertyId = await propertyOf(db, req)
      const stock = await readStock(db)
      const scoped = narrowToProperty(stock, propertyId)
      if (coll !== 'costItems' && coll !== 'tenancies') return scoped[coll]
      // Ein Tab von vor dem Update filtert die Kostenpositionen nach `year` (#208). Bei einem reinen
      // Kalenderobjekt bekommt er es weiter; sonst sähe er eine leere Liste und erfasste alles noch
      // einmal. Bei einem anderen Rhythmus gibt es kein Jahr, das stimmte; dort lehnt das Schreiben ab.
      const calendar = isCalendarRules(rulesOf(stock.properties.find((p) => p.id === propertyId)))
      if (coll === 'costItems') return calendar ? scoped.costItems.map((c) => ({ ...c, year: startYearOf(c.period) })) : scoped.costItems
      // Ebenso die Jahreskorrektur (Durchsicht von #222, M1): Ein alter Tab setzt sie zurück, indem er
      // den Schlüssel des Jahres löscht und den Rest schickt. Nennt er Jahreszahlen, gilt sein Stand
      // vollständig (repository.ts, `readOverrides`). Die Oberfläche dieser Version liest beides und
      // schickt Zeiträume (Abrechnung.tsx, `savePpOverride`); die Jahreszahlen bleiben für alte Tabs.
      return calendar
        ? scoped.tenancies.map((t) => ({ ...t, prepaymentOverrides: Object.fromEntries(Object.entries(t.prepaymentOverrides).map(([key, cents]) => [key.slice(0, 4), cents])) }))
        : scoped.tenancies
    }))
  })
  app.post(`/api/${coll}`, async (req, res) => {
    const body = bodyObject(req)
    res.status(201).json(await writeData(async (db) => {
      const withProperty = ROOTS.includes(coll) ? { ...body, propertyId: await propertyOf(db, req, true) } : body
      return createEntity(db, coll, newId(), withProperty)
    }))
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

// Was das Löschen einer Wohnung mitnähme (#142), für die Löschfrage der Oberfläche.
app.get('/api/units/:id/dependents', async (req, res) => {
  const deps = await readData((db) => unitDependents(db, req.params.id))
  if (!deps) return res.status(404).json({ error: 'Diese Wohnung gibt es nicht (mehr). Bitte laden Sie die Seite neu.' })
  res.json(deps)
})

// Der Mieterwechsel in einem Schritt (#150): altes Mietverhältnis beenden, Zwischenablesungen,
// Nachmieter, alles in einer Transaktion. Begründung und Prüfungen in db/repository.ts.
app.post('/api/tenancies/:id/change', async (req, res) => {
  const result = await writeData(async (db) => changeTenant(db, await propertyOf(db, req), req.params.id, bodyObject(req), newId))
  if (!result) return res.status(404).json({ error: 'Dieses Mietverhältnis gibt es nicht (mehr). Bitte laden Sie die Seite neu.' })
  res.json(result)
})

// ---------- Objekte (#92) ----------

app.get('/api/properties', async (req, res) => {
  res.json(await readData(listProperties))
})
app.post('/api/properties', async (req, res) => {
  res.status(201).json(await writeData((db) => createProperty(db, newId(), bodyObject(req))))
})
app.put('/api/properties/:id', async (req, res) => {
  const property = await writeData((db) => updateProperty(db, req.params.id, bodyObject(req)))
  if (!property) return res.status(404).json({ error: 'Dieses Objekt gibt es nicht (mehr).' })
  res.json(property)
})
// Der Stichtag der Abrechnung (#133): heute, als JJJJ-MM-TT in UTC wie überall in calc.ts. Er
// begrenzt nur den Hinweis auf einen Rückstand auf die schon fälligen Monate. Der Wechsel des
// Zeitraums (#208) braucht ihn für die Liste der Zeiträume in der Vorschau.
// Testgriff `NKA_TEST_TODAY` (testToday.ts): ein fester Tag nur für Tests. Ohne ihn der wirkliche Tag.
const TEST_TODAY = testTodayOf(process.env.NKA_TEST_TODAY)
const today = (): string => TEST_TODAY.value ?? new Date().toISOString().slice(0, 10)

// Rechtswerte, die eine Behörde später veröffentlicht (Heizung PR 17, Entwurf 4.5): je Parameter und
// Jahr ein Eintrag des Vermieters mit Quelle. Installationsweit, deshalb ohne `?property=`.
app.get('/api/law-overrides', async (_req, res) => {
  res.json(lawOverrideSlots(await readData(readLawOverrides), today()))
})
app.put('/api/law-overrides/:paramId/:year', async (req, res) => {
  res.json(await writeData((db) => saveLawOverride(db, req.params.paramId, Number(req.params.year), bodyObject(req), today())))
})
app.delete('/api/law-overrides/:paramId/:year', async (req, res) => {
  const removed = await writeData((db) => removeLawOverride(db, req.params.paramId, Number(req.params.year)))
  res.json({ ok: true, removed })
})

app.delete('/api/properties/:id', async (req, res) => {
  const result = await writeData((db) => removeProperty(db, req.params.id))
  if (result.removed) return res.json({ ok: true })
  if (result.reason !== 'inUse') {
    return result.reason === 'missing'
      ? res.status(404).json({ error: 'Dieses Objekt gibt es nicht (mehr).' })
      : res.status(409).json({ error: 'Das letzte Objekt lässt sich nicht löschen: Jede Wohnung gehört zu einem Objekt.' })
  }
  res.status(409).json({
    error: `Dieses Objekt enthält noch ${result.inUse}. Gelöscht wird nur ein leeres Objekt, damit keine ` +
      `Abrechnung und keine bezahlte Rechnung verloren geht.`,
  })
})

// ---------- Heizanlage (Heizung PR 4) ----------
// Was eine Anlage ist und was sie in dieser Version tut, steht in db/heating.ts. Das Objekt kommt
// wie bei den übrigen Datenrouten aus `?property=` (beim Anlegen auch aus dem Rumpf); bei genau
// einem Objekt gilt dieses.

app.get('/api/heating-plants', async (req, res) => {
  res.json(await readData(async (db) => listHeatingPlants(db, await propertyOf(db, req))))
})
// Die Vorschau der Einrichtung: welche Heizpositionen beim Anlegen zur Anlage kommen.
app.get('/api/heating-plants/assignable', async (req, res) => {
  res.json(await readData(async (db) => assignableHeatingItems(db, await propertyOf(db, req))))
})
app.post('/api/heating-plants', async (req, res) => {
  res.status(201).json(await writeData(async (db) => createHeatingPlant(db, newId(), await propertyOf(db, req, true), bodyObject(req))))
})
// Kesseltausch (Heizung PR 9): Die Anlage endet am Tag vor `date`, eine neue beginnt mit denselben
// Wohnungen (db/heating.ts, `replaceHeatingPlant`).
app.post('/api/heating-plants/:id/replace', async (req, res) => {
  const result = await writeData((db) => replaceHeatingPlant(db, req.params.id, newId(), bodyObject(req)))
  if (!result) return res.status(404).json({ error: 'Diese Heizanlage gibt es nicht (mehr). Bitte laden Sie die Seite neu.' })
  res.status(201).json(result)
})
app.put('/api/heating-plants/:id', async (req, res) => {
  const plant = await writeData((db) => updateHeatingPlant(db, req.params.id, bodyObject(req)))
  if (!plant) return res.status(404).json({ error: 'Diese Heizanlage gibt es nicht (mehr). Bitte laden Sie die Seite neu.' })
  res.json(plant)
})
app.delete('/api/heating-plants/:id', async (req, res) => {
  const result = await writeData((db) => removeHeatingPlant(db, req.params.id))
  if (result.removed) return res.json({ ok: true, released: result.released, notice: result.notice })
  if (result.reason === 'missing') return res.status(404).json({ error: 'Diese Heizanlage gibt es nicht (mehr). Bitte laden Sie die Seite neu.' })
  if (result.reason === 'co2') {
    return res.status(409).json({
      error: `Zu dieser Heizanlage sind CO₂-Angaben erfasst (Heizperiode ${result.periods.join(', ')}). Entfernen Sie sie auf der Seite Heizkosten, ` +
        'wenn die Anlage wirklich entfallen soll; sonst gingen sie mit ihr verloren.',
    })
  }
  if (result.reason === 'deliveries') {
    return res.status(409).json({
      error: `An dieser Heizanlage stehen ${result.count === 1 ? 'eine Lieferung' : `${result.count} Lieferungen`}. Entfernen Sie sie auf der Seite Heizkosten, wenn die Anlage wirklich entfallen soll.`,
    })
  }
  if (result.reason === 'separate') {
    return res.status(409).json({
      error: 'Die Heizkosten dieser Anlage werden getrennt abgerechnet, oder es gibt abgeschlossene Heizkostenabrechnungen oder Korrekturen der ' +
        'Heizvorauszahlung. Schalten Sie zuerst die getrennte Heizkostenabrechnung aus. Abgeschlossene Heizkostenabrechnungen bleiben als Archiv; ' +
        'solange es sie gibt, bleibt die Anlage bestehen.',
    })
  }
  res.status(409).json({
    error: `An der Heizanlage hängen noch Zähler (${result.meters.map((n) => `„${n}“`).join(', ')}). Ordnen Sie sie auf der Seite ` +
      'Zähler neu zu oder löschen Sie sie; dann lässt sich die Anlage entfernen.',
  })
})

// ---------- Heizperioden: CO₂ und Warmwasser (Heizung PR 6) ----------
// Was gespeichert wird und was nicht, steht in db/co2.ts. `:period` ist der Schlüssel der
// Heizperiode (JJJJ-MM), `?period=` beim Lesen der Zeitraum des Objekts wie bei den übrigen Routen.
const NO_PLANT = 'Diese Heizanlage gibt es nicht (mehr). Bitte laden Sie die Seite neu.'
app.get('/api/heating-plants/:id/periods', async (req, res) => {
  const period = typeof req.query.period === 'string' ? req.query.period : ''
  const views = await readData((db) => heatingPeriodViews(db, req.params.id, period, today()))
  if (!views) return res.status(404).json({ error: NO_PLANT })
  res.json(views)
})
app.put('/api/heating-plants/:id/periods/:period/co2', async (req, res) => {
  const saved = await writeData((db) => saveCo2Statement(db, req.params.id, req.params.period, bodyObject(req)))
  if (!saved) return res.status(404).json({ error: NO_PLANT })
  res.json(saved)
})
app.delete('/api/heating-plants/:id/periods/:period/co2', async (req, res) => {
  const removed = await writeData((db) => removeCo2Statement(db, req.params.id, req.params.period))
  if (removed === null) return res.status(404).json({ error: NO_PLANT })
  res.json({ ok: true, removed })
})
app.put('/api/heating-plants/:id/periods/:period/hot-water', async (req, res) => {
  const saved = await writeData((db) => saveHotWater(db, req.params.id, req.params.period, bodyObject(req)))
  if (!saved) return res.status(404).json({ error: NO_PLANT })
  res.json(saved)
})
// Werte eines Ablesedienstes je Wohnung und Nutzungszeitraum (Heizung PR 12): die ganze Liste der
// Heizperiode, in einer Transaktion ersetzt (db/serviceValues.ts).
app.put('/api/heating-plants/:id/periods/:period/service-values', async (req, res) => {
  const saved = await writeData((db) => saveServiceValues(db, req.params.id, req.params.period, bodyObject(req)))
  if (saved === null) return res.status(404).json({ error: NO_PLANT })
  res.json(saved)
})
// Schätzung nach § 9a (Heizung PR 13): je Heizperiode, Wohnung und Topf (`heat`, `water`), db/heatingEstimates.ts.
app.put('/api/heating-plants/:id/periods/:period/estimates/:unitId/:part', async (req, res) => {
  const saved = await writeData((db) => saveEstimate(db, req.params.id, req.params.period, req.params.unitId, req.params.part, bodyObject(req)))
  if (saved === null) return res.status(404).json({ error: NO_PLANT })
  res.json(saved)
})
app.delete('/api/heating-plants/:id/periods/:period/estimates/:unitId/:part', async (req, res) => {
  const removed = await writeData((db) => removeEstimate(db, req.params.id, req.params.period, req.params.unitId, req.params.part))
  if (removed === null) return res.status(404).json({ error: NO_PLANT })
  res.json({ ok: true, removed })
})

// Vorrat je Heizperiode (Heizung PR 8): Was gespeichert wird, steht in db/fuelStock.ts.
app.put('/api/heating-plants/:id/periods/:period/stock', async (req, res) => {
  const saved = await writeData((db) => saveStock(db, req.params.id, req.params.period, bodyObject(req)))
  if (!saved) return res.status(404).json({ error: NO_PLANT })
  res.json(saved)
})
app.delete('/api/heating-plants/:id/periods/:period/stock', async (req, res) => {
  const removed = await writeData((db) => removeStock(db, req.params.id, req.params.period))
  if (removed === null) return res.status(404).json({ error: NO_PLANT })
  res.json({ ok: true, removed })
})

// ---------- Eigene Heizkostenabrechnung (Heizung PR 10) ----------

// Einrichtung Schritt 7 (Entwurf 11.2): Umstellung auf die eigene Abrechnung in einer Transaktion,
// samt Anteil, Zählern und Positionen (db/heatingSelf.ts). 409 mit der Liste offener Positionen, die
// Teil und Ziel brauchen.
app.put('/api/heating-plants/:id/self', async (req, res) => {
  const result = await writeData((db) => setUpSelf(db, req.params.id, bodyObject(req), today(), newId))
  if (!result) return res.status(404).json({ error: NO_PLANT })
  res.json(result)
})

// Anteil nach Verbrauch einer Heizperiode (§ 6 Abs. 4, § 7 Abs. 1 Satz 2).
app.put('/api/heating-plants/:id/periods/:period/distribution', async (req, res) => {
  const result = await writeData((db) => saveDistribution(db, req.params.id, req.params.period, bodyObject(req), today()))
  if (!result) return res.status(404).json({ error: NO_PLANT })
  res.json(result)
})

// Angaben nach § 6a HeizkostenV je Heizperiode, und Ausnahme nach § 11, Vereinbarung nach § 2, monatliche
// Information und Verbrauchervertrag ab einer Heizperiode (Heizung PR 14).
app.put('/api/heating-plants/:id/periods/:period/info', async (req, res) => {
  const result = await writeData((db) => saveHeatingInfo(db, req.params.id, req.params.period, bodyObject(req)))
  if (!result) return res.status(404).json({ error: NO_PLANT })
  res.json(result)
})
app.put('/api/heating-plants/:id/periods/:period/rules', async (req, res) => {
  const result = await writeData((db) => saveHeatingRules(db, req.params.id, req.params.period, bodyObject(req)))
  if (!result) return res.status(404).json({ error: NO_PLANT })
  res.json(result)
})

// Keine Zwischenablesung an einer Grenze: nicht möglich oder nicht durchgeführt (Entwurf 3.5).
app.put('/api/units/:id/interim-gaps/:date', async (req, res) => {
  const result = await writeData((db) => saveInterimGap(db, req.params.id, req.params.date, bodyObject(req)))
  if (!result) return res.status(404).json({ error: 'Diese Wohnung gibt es nicht (mehr). Bitte laden Sie die Seite neu.' })
  res.json(result)
})
app.delete('/api/units/:id/interim-gaps/:date', async (req, res) => {
  res.json({ ok: true, removed: await writeData((db) => removeInterimGap(db, req.params.id, req.params.date)) })
})

// ---------- Brennstofflieferungen (Heizung PR 7) ----------
// Was gespeichert wird und was nicht, steht in db/fuel.ts; gerechnet wird in fuel.ts und calc.ts.
const NO_DELIVERY = 'Diese Lieferung gibt es nicht (mehr). Bitte laden Sie die Seite neu.'
// Das Blatt „CO₂-Angaben für den Messdienst“ einer Heizperiode (Heizung PR 17, #210): die Rechnungen, die
// sie berühren, mit den Angaben nach § 3 Abs. 1 CO2KostAufG und den Hinweisen der Prüfung.
app.get('/api/heating-plants/:id/periods/:period/co2-sheet', async (req, res) => {
  const sheet = await readData(async (db) => {
    const ctx = await plantContext(db, req.params.id)
    if (!ctx) return null
    const h = heatingPeriodOf(ctx, req.params.period)
    const stock = await readStock(db)
    const plant = ctx.plant
    const property = stock.properties.find((p) => p.id === plant.propertyId)
    const statement = stock.co2Statements.find((x) => x.plantId === plant.id && x.period === h.key && (x.method === 'self' || x.method === 'selfAfterService'))
    const row = stock.heatingPeriodRows.find((r) => r.plantId === plant.id && r.period === h.key)
    const units: Unit[] = stock.units
    return co2SheetOf({
      propertyName: property?.name ?? '', address: property?.address ?? '',
      landlordName: property?.landlordName ?? stock.settings.landlordName,
      plant, h: { key: String(h.key), from: h.from, to: h.to },
      units: units.filter((u) => u.propertyId === plant.propertyId),
      enteredAreaM2: statement?.areaM2 ?? null,
      stock: row && row.stockUnit !== null ? {
        stockUnit: row.stockUnit, openingQuantity: row.openingQuantity, openingEmissionsKg: row.openingEmissionsKg, openingCo2Cents: row.openingCo2Cents,
        openingInvoicedBefore2023: row.openingInvoicedBefore2023, closingQuantity: row.closingQuantity, closingMeasuredOn: row.closingMeasuredOn,
      } : null,
      deliveries: stock.fuelDeliveries, overrides: stock.lawOverrides,
      linkedCents: stock.costItems.reduce<Record<string, number>>((a, c) => (c.fuelDeliveryId ? { ...a, [c.fuelDeliveryId]: (a[c.fuelDeliveryId] ?? 0) + c.amountCents } : a), {}),
    })
  })
  if (!sheet) return res.status(404).json({ error: NO_PLANT })
  res.json(sheet)
})
app.get('/api/heating-plants/:id/deliveries', async (req, res) => {
  const list = await readData((db) => listDeliveries(db, req.params.id))
  if (!list) return res.status(404).json({ error: NO_PLANT })
  res.json(list)
})
app.post('/api/heating-plants/:id/deliveries', async (req, res) => {
  const created = await writeData((db) => createDelivery(db, newId(), req.params.id, bodyObject(req)))
  if (!created) return res.status(404).json({ error: NO_PLANT })
  res.status(201).json(created)
})
app.put('/api/fuel-deliveries/:id', async (req, res) => {
  const saved = await writeData((db) => updateDelivery(db, req.params.id, bodyObject(req)))
  if (!saved) return res.status(404).json({ error: NO_DELIVERY })
  res.json(saved)
})
app.delete('/api/fuel-deliveries/:id', async (req, res) => {
  const removed = await writeData((db) => removeDelivery(db, req.params.id))
  if (!removed) return res.status(404).json({ error: NO_DELIVERY })
  res.json({ ok: true })
})
// Die Gradtagzahlen des Orts (Stufe 4 in 3.2), je Objekt.
const NO_PROPERTY = 'Dieses Objekt gibt es nicht (mehr). Bitte laden Sie die Seite neu.'
app.get('/api/properties/:id/degree-days', async (req, res) => {
  const values = await readData((db) => listDegreeDays(db, req.params.id))
  if (!values) return res.status(404).json({ error: NO_PROPERTY })
  res.json(values)
})
app.put('/api/properties/:id/degree-days', async (req, res) => {
  const values = await writeData((db) => saveDegreeDays(db, req.params.id, bodyObject(req)))
  if (!values) return res.status(404).json({ error: NO_PROPERTY })
  res.json(values)
})

// Zeitraum der Heizung (Heizung PR 5, Entwurf 3.0, 3.6): erst die Vorschau, dann der Wechsel mit den
// Antworten, in einer Transaktion. `rules: null` heißt „wie das Objekt“. Fehlt eine Antwort oder
// träfe der Wechsel Abgeschlossenes, antwortet der Server mit 409 und der neuen Vorschau.
const PLANT_GONE_TEXT = 'Diese Heizanlage gibt es nicht (mehr). Bitte laden Sie die Seite neu.'
app.post('/api/heating-plants/:id/period/preview', async (req, res) => {
  const preview = await writeData((db) => previewHeatingPeriodChange(db, req.params.id, bodyObject(req).rules, today()))
  if (!preview) return res.status(404).json({ error: PLANT_GONE_TEXT })
  res.json(preview)
})
app.put('/api/heating-plants/:id/period', async (req, res) => {
  const body = bodyObject(req)
  const result = await writeData((db) => applyHeatingPeriodChange(db, req.params.id, body.rules, body.answers, today()))
  if (!result) return res.status(404).json({ error: PLANT_GONE_TEXT })
  if ('error' in result) return res.status(409).json(result)
  res.json(result.plant)
})
// Getrennte Heizkostenabrechnung ein- und ausschalten (Heizung PR 5, Entwurf 3.1): Vorschau, dann
// Speichern mit den Antworten in einer Transaktion. Begründung in db/separateSettlement.ts.
app.post('/api/heating-plants/:id/separate/preview', async (req, res) => {
  const preview = await writeData((db) => previewSeparate(db, req.params.id, bodyObject(req), today()))
  if (!preview) return res.status(404).json({ error: PLANT_GONE_TEXT })
  res.json(preview)
})
app.put('/api/heating-plants/:id/separate', async (req, res) => {
  const result = await writeData((db) => applySeparate(db, req.params.id, bodyObject(req), today()))
  if (!result) return res.status(404).json({ error: PLANT_GONE_TEXT })
  if ('error' in result) return res.status(409).json(result)
  res.json(result.plant)
})

// ---------- Heizkostenabrechnung nach Weg d (Heizung PR 5, Entwurf 3.1, 6.1 Nr. 7, B3) ----------
// Je Anlage und getrennt abgerechneter Heizperiode eine eigene Abrechnung mit eigener Frist und
// eigenem Abschluss. Eine Heizperiode, die in der Betriebskostenabrechnung steht, hat keine; die
// Antwort sagt dann, wo ihre Heizkosten stehen.
async function heatingTargetOf(db: Database, req: Request): Promise<{ plant: HeatingPlant, period: BillingPeriod }> {
  const plant = (await readHeatingPlants(db)).find((p) => p.id === req.params.plant)
  if (!plant) throw new RouteProblem(404, PLANT_GONE_TEXT)
  const objectRules = rulesOf((await listProperties(db)).find((p) => p.id === plant.propertyId))
  const key = parsePeriodKey(String(req.params.period ?? ''))
  const period = key === null ? null : periodOfKey(plantRules(plant, objectRules), key)
  if (period === null) throw new RouteProblem(404, 'Diese Heizperiode gibt es für die Heizanlage nicht.')
  if (!settledSeparately(plant, objectRules, period)) {
    throw new RouteProblem(404,
      `Die Heizkosten ${periodLabel(period)} stehen in der Betriebskostenabrechnung ${periodLabel(periodContaining(objectRules, period.to))}; eine eigene Heizkostenabrechnung gibt es dafür nicht.`)
  }
  return { plant, period }
}

function computeHeating(stock: Stock, plant: HeatingPlant, period: BillingPeriod): ComputedSettlement {
  const snapshot = heatingSnapshotFor(stock, plant.propertyId, plant.id, period)
  if (!snapshot) throw new RouteProblem(404, PLANT_GONE_TEXT)
  return computeSettlement(snapshot, { asOf: today() })
}

app.get('/api/heating-settlements', async (req, res) => {
  res.json(await readData(async (db) => separateHeatingSettlements(db, await propertyOf(db, req), today())))
})

app.get('/api/heating-settlement/:plant/:period', async (req, res) => {
  const { target, closed, stock } = await readData(async (db) => {
    const target = await heatingTargetOf(db, req)
    return { target, closed: await findClosedHeatingSettlement(db, target.plant.id, target.period.key), stock: await readStock(db) }
  })
  const frame = {
    period: settlementPeriod(target.period),
    deadline: settlementDeadline(target.period),
    scope: { kind: 'heating' as const, plantId: target.plant.id, plantName: target.plant.name },
  }
  if (closed) {
    const stand = closed.settlement !== null && typeof closed.settlement === 'object' ? closed.settlement : {}
    const deviation = compareWithFrozen(closed.settlement, () => computeHeating(stock, target.plant, target.period), frame.deadline, today())
    return res.json({ selfUsedShareCents: 0, ...stand, ...frame, closed: { closedAt: closed.closedAt, sentAt: closed.sentAt }, deviation })
  }
  res.json({ ...computeHeating(stock, target.plant, target.period), closed: null })
})

app.post('/api/heating-settlement/:plant/:period/close', async (req, res) => {
  const sentAt = sentAtOf(req)
  if (sentAt === false) return res.status(400).json({ error: SENT_AT_INVALID })
  const answer = fuelAnswerOf(req)
  if (answer === false) return res.status(400).json({ error: FUEL_ANSWER_INVALID })
  // Rechnen und Einfrieren im selben Vorgang, wie bei der Abrechnung des Objekts.
  const ergebnis = await writeData(async (db) => {
    const target = await heatingTargetOf(db, req)
    const label = periodLabel(target.period)
    if (await findClosedHeatingSettlement(db, target.plant.id, target.period.key)) return { schonDa: true, label, gaps: null }
    const gaps = await closeWithFuel(
      db,
      answer,
      async (tx) => computeHeating(await readStock(tx), target.plant, target.period),
      (tx, settlement) => closeHeatingSettlement(tx, {
        id: newId(), plantId: target.plant.id, period: target.period.key, closedAt: new Date().toISOString(), sentAt, settlement,
      }),
    )
    return { schonDa: false, label, gaps }
  })
  if (ergebnis.schonDa) return res.status(409).json({ error: `Die Heizkostenabrechnung ${ergebnis.label} ist bereits abgeschlossen.` })
  if (ergebnis.gaps) return res.status(409).json({ error: FUEL_GAPS_TEXT, fuelGaps: ergebnis.gaps })
  res.status(201).json({ ok: true })
})

app.put('/api/heating-settlement/:plant/:period/close', async (req, res) => {
  const sentAt = sentAtOf(req)
  if (sentAt === false) return res.status(400).json({ error: SENT_AT_INVALID })
  const gefunden = await writeData(async (db) => {
    const target = await heatingTargetOf(db, req)
    return setHeatingSentAt(db, target.plant.id, target.period.key, sentAt)
  })
  if (!gefunden) return res.status(404).json({ error: 'Die Heizkostenabrechnung ist nicht abgeschlossen.' })
  res.json({ ok: true })
})

app.get('/api/heating-settlement/:plant/:period/history', async (req, res) => {
  res.json(await readData(async (db) => {
    const target = await heatingTargetOf(db, req)
    return heatingSettlementHistory(db, target.plant.id, target.period.key)
  }))
})

app.delete('/api/heating-settlement/:plant/:period/close', async (req, res) => {
  const gefunden = await writeData(async (db) => {
    const target = await heatingTargetOf(db, req)
    return reopenHeatingSettlement(db, target.plant.id, target.period.key, newId(), unfreezeFuelCarries)
  })
  if (!gefunden) return res.status(404).json({ error: 'Die Heizkostenabrechnung ist nicht abgeschlossen.' })
  res.json({ ok: true })
})

// Wechsel des Abrechnungszeitraums (#208, Entwurf 3.6): erst die Vorschau, dann der Wechsel mit
// den Antworten, in einer Transaktion. Fehlt eine Antwort oder träfe der Wechsel eine
// abgeschlossene Abrechnung, antwortet der Server mit 409 und der neuen Vorschau, gespeichert ist
// nichts. Begründung in db/periodChange.ts.
// Die Vorschau läuft durch die Schreibschlange: Sie rechnet Fristen und Ergebnisse in einem
// Probelauf, der in einer Transaktion schreibt und zurückrollt (db/dryRun.ts, Laienprobe B3).
app.post('/api/properties/:id/period/preview', async (req, res) => {
  const preview = await writeData((db) => previewPeriodChange(db, req.params.id, bodyObject(req).rules, today()))
  if (!preview) return res.status(404).json({ error: 'Dieses Objekt gibt es nicht (mehr).' })
  res.json(preview)
})
app.put('/api/properties/:id/period', async (req, res) => {
  const body = bodyObject(req)
  const result = await writeData((db) => applyPeriodChange(db, req.params.id, body.rules, body.answers, newId, today()))
  if (!result) return res.status(404).json({ error: 'Dieses Objekt gibt es nicht (mehr).' })
  if ('error' in result) return res.status(409).json(result)
  res.json(result.property)
})

// ---------- Abrechnung ----------

// Liefert die abgeschlossene (eingefrorene) Abrechnung, falls vorhanden — sonst live berechnet.
app.get('/api/settlement/:period', async (req, res) => {
  const { closed, stock, property, period } = await readData(async (db) => {
    const property = await propertyOf(db, req)
    const period = await periodOf(db, req, property)
    return { property, period, closed: await findClosedSettlement(db, property, period.key), stock: await readStock(db) }
  })
  // Zeitraum und Frist (#208) stehen in jeder Antwort, auch bei einer vorher abgeschlossenen
  // Abrechnung, die sie noch nicht kennt: Die Oberfläche rechnet die Frist nicht mehr selbst.
  const frame = { period: settlementPeriod(period), deadline: settlementDeadline(period) }
  // Vor dieser Version eingefrorene Snapshots kennen selfUsedShareCents noch nicht — mit 0
  // vorbelegen, damit die Antwort immer der Form in types.ts entspricht. Genau deshalb ist das
  // Feld in StoredSettlement (store.ts) optional.
  // Der eingefrorene Stand ist `unknown`: Er stammt womöglich aus einer früheren Version, und
  // ein Typ darüber wäre eine Behauptung über etwas, das jemand anders geschrieben hat. Zum
  // Ausbreiten genügt, dass es ein Objekt ist.
  if (closed) {
    const stand = closed.settlement !== null && typeof closed.settlement === 'object' ? closed.settlement : {}
    // Daneben die heutige Berechnung, nur zum Vergleich (#56): Der eingefrorene Stand bleibt das
    // Dokument, das der Mieter hat; weicht die heutige Rechnung ab, erfährt es der Vermieter.
    const deviation = compareWithFrozen(closed.settlement, () => computeSettlement(snapshotFor(stock, property, period), { asOf: today() }), frame.deadline, today())
    return res.json({ selfUsedShareCents: 0, ...stand, ...frame, closed: { closedAt: closed.closedAt, sentAt: closed.sentAt }, deviation })
  }
  res.json({ ...computeSettlement(snapshotFor(stock, property, period), { asOf: today() }), closed: null })
})

// Ein Datum als JJJJ-MM-TT, wie es <input type="date"> liefert. Der Vergleich mit dem
// Rückweg über Date schließt Tage aus, die es im Kalender nicht gibt: JavaScript rechnet den
// 31. Februar stillschweigend in den 3. März um, statt ihn abzulehnen.
const isDateOnly = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const ms = Date.parse(`${value}T00:00:00Z`)
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value
}

// Das Versanddatum aus dem Rumpf, geprüft: `null` heißt „noch nicht versendet“ (so schickt es
// die Oberfläche für ein leeres Feld), `false` heißt „keine gültige Angabe“ und führt zu 400.
// An diesem Datum hängt die Frist aus §556 BGB, und die Oberfläche vergleicht es als
// Zeichenkette mit dem 31.12. des Folgejahrs — ein beliebiger Wert aus `req.body` (`any`, siehe
// bodyObject) dürfte hier also nie durchgereicht werden.
const SENT_AT_INVALID = 'Das Versanddatum muss ein Datum als JJJJ-MM-TT sein oder fehlen.'
const sentAtOf = (req: Request): string | null | false => {
  const value: unknown = bodyObject(req).sentAt
  if (value === undefined || value === null || value === '') return null
  return isDateOnly(value) ? value : false
}

// Die Antwort auf die Rückfrage zur Schätzung (Heizung PR 7, Entwurf 8.2, N1, A5): `estimate` legt je
// Lücke eine geschätzte Lieferung mit Vorbehalt an, `none` schließt ohne ab. `null`: keine Antwort,
// `false`: ein anderer Wert (400).
type FuelAnswer = 'estimate' | 'none'
const FUEL_ANSWER_INVALID = 'Die Antwort auf die Rückfrage zur Schätzung ist „estimate“ oder „none“.'
const FUEL_GAPS_TEXT =
  'Für einen Teil der Heizperiode fehlt eine Rechnung. Sie können abwarten, bis sie da ist, die Kosten mit Vorbehalt schätzen lassen oder ohne Schätzung abschließen; ohne Schätzung steht dieser Teil zunächst bei Ihnen.'
const fuelAnswerOf = (req: Request): FuelAnswer | null | false => {
  const value: unknown = bodyObject(req).fuelEstimates
  if (value === undefined || value === null) return null
  return value === 'estimate' || value === 'none' ? value : false
}

// Abschließen samt Lieferungen (Heizung PR 7): rechnen, bei Lücken ohne Antwort nachfragen, auf Wunsch
// Schätzungen anlegen und neu rechnen, dann abschließen und einfrieren, alles in **einer**
// Transaktion (Entwurf 8.2, N1): Die Berechnung liest den Bestand auf der Transaktion (`readStock`
// nimmt ein `Executor`), die neu angelegten Schätzungen sind darin also schon sichtbar; scheitert ein
// Schritt, fällt alles zurück, und keine Schätzung bleibt ohne Abschluss stehen. Ohne Antwort und mit
// Lücken wird nichts geschrieben.
async function closeWithFuel(
  db: Database,
  answer: FuelAnswer | null,
  compute: (tx: Executor) => Promise<ComputedSettlement>,
  close: (tx: Executor, settlement: ComputedSettlement) => Promise<void>,
): Promise<FuelGapQuestion[] | null> {
  return db.transaction(async (tx) => {
    let settlement = await compute(tx)
    const gaps = fuelGapQuestions(settlement)
    if (gaps.length > 0 && answer === null) return gaps
    if (gaps.length > 0 && answer === 'estimate') {
      await createEstimates(tx, settlement, newId)
      settlement = await compute(tx)
    }
    await close(tx, settlement)
    await freezeFuelCarries(tx, settlement)
    return null
  })
}

// Abrechnung abschließen: aktuellen Berechnungsstand einfrieren. Spätere Änderungen an
// Kosten/Stammdaten verändern eine bereits verschickte Abrechnung dann nicht mehr still.
// Mit Lieferungen fragt Mietfuchs bei einer Lücke nach (Heizung PR 7) und friert die Überträge mit ein.
app.post('/api/settlement/:period/close', async (req, res) => {
  const sentAt = sentAtOf(req)
  if (sentAt === false) return res.status(400).json({ error: SENT_AT_INVALID })
  const answer = fuelAnswerOf(req)
  if (answer === false) return res.status(400).json({ error: FUEL_ANSWER_INVALID })
  // Rechnen und Einfrieren im selben Vorgang: Käme dazwischen eine Änderung an einer
  // Kostenposition durch, fröre Mietfuchs einen Stand ein, den es so nie gegeben hat.
  const ergebnis = await writeData(async (db) => {
    const property = await propertyOf(db, req)
    const period = await periodOf(db, req, property)
    const label = periodLabel(period)
    if (await findClosedSettlement(db, property, period.key)) return { schonDa: true, label, gaps: null }
    const gaps = await closeWithFuel(
      db,
      answer,
      async (tx) => computeSettlement(snapshotFor(await readStock(tx), property, period), { asOf: today() }),
      (tx, settlement) => closeSettlement(tx, { id: newId(), propertyId: property, period: period.key, closedAt: new Date().toISOString(), sentAt, settlement }),
    )
    return { schonDa: false, label, gaps }
  })
  if (ergebnis.schonDa) return res.status(409).json({ error: `Abrechnung ${ergebnis.label} ist bereits abgeschlossen.` })
  if (ergebnis.gaps) return res.status(409).json({ error: FUEL_GAPS_TEXT, fuelGaps: ergebnis.gaps })
  res.status(201).json({ ok: true })
})

// Versanddatum nachtragen (für die §556-Frist)
app.put('/api/settlement/:period/close', async (req, res) => {
  const sentAt = sentAtOf(req)
  if (sentAt === false) return res.status(400).json({ error: SENT_AT_INVALID })
  const gefunden = await writeData(async (db) => {
    const property = await propertyOf(db, req)
    return setSentAt(db, property, (await periodOf(db, req, property)).key, sentAt)
  })
  if (!gefunden) return res.status(404).json({ error: 'Abrechnung ist nicht abgeschlossen.' })
  res.json({ ok: true })
})

// Frühere Abschlüsse eines Zeitraums (#56, Teil 2): was beim Wiederöffnen beiseitegelegt wurde,
// der zuletzt wiedergeöffnete zuerst. Der gültige Stand steht nicht darin, den liefert
// GET /api/settlement/:period.
app.get('/api/settlement/:period/history', async (req, res) => {
  res.json(await readData(async (db) => {
    const property = await propertyOf(db, req)
    return settlementHistory(db, property, (await periodOf(db, req, property)).key)
  }))
})

// Wieder öffnen: Der Stand wandert in den Verlauf, es gilt wieder die laufende Berechnung (#56).
app.delete('/api/settlement/:period/close', async (req, res) => {
  const gefunden = await writeData(async (db) => {
    const property = await propertyOf(db, req)
    return reopenSettlement(db, property, (await periodOf(db, req, property)).key, newId(), unfreezeFuelCarries)
  })
  if (!gefunden) return res.status(404).json({ error: 'Abrechnung ist nicht abgeschlossen.' })
  res.json({ ok: true })
})

// Verbrauch über den Zeitraum der Abrechnung (#208): Die Zähler-Seite zeigt denselben Zeitraum.
app.get('/api/consumption/:period', async (req, res) => {
  res.json(await readData(async (db) => {
    const property = await propertyOf(db, req)
    return consumptionOverview(snapshotFor(await readStock(db), property, await periodOf(db, req, property)))
  }))
})

// Mietkonto: Soll/Ist je Monat und Mietverhältnis im **Kalenderjahr** (#208, Entwurf 3.11), auch bei
// einem Objekt mit anderem Rhythmus. Es liest keine Kostenposition, der Zeitraum dient nur dem Jahr.
app.get('/api/rentledger/:year', async (req, res) => {
  const year = Number(req.params.year)
  if (!Number.isInteger(year)) return res.status(400).json({ error: 'Ungültiges Jahr' })
  res.json(await readData(async (db) => rentLedger(snapshotFor(await readStock(db), await propertyOf(db, req), calendarYearPeriod(year)), { asOf: today() })))
})

// Steuer-Übersicht (Hilfe für die Anlage V) im Kalenderjahr: Einnahmen, Werbungskosten, Überschuss.
// Bei einem Objekt mit eigenem Rhythmus aus den Abrechnungen, die das Jahr berühren (#208);
// Begründung in calc.ts (`taxPartsFor`).
app.get('/api/taxreport/:year', async (req, res) => {
  const year = Number(req.params.year)
  if (!Number.isInteger(year)) return res.status(400).json({ error: 'Ungültiges Jahr' })
  res.json(await readData(async (db) => taxReportFor(await readStock(db), await propertyOf(db, req), year)))
})

// ---------- Belege & KI-Auswertung ----------
app.use('/uploads', express.static(UPLOAD_DIR))

// ---------- Angaben zu Belegen (#170) ----------
//
// Jeder neu hochgeladene Beleg bekommt eine Zeile in `uploads` (db/uploads.ts): Originalname,
// Art, Prüfsumme, genaue Hochladezeit und, solange er an keiner Position hängt, Objekt und Jahr
// für den Posteingang. Woher Objekt und Jahr kommen, sagen die Felder `propertyId` und `year` des
// Formulars; ohne sie liegt der Beleg im Posteingang ohne Zuordnung.

// Ein Jahr aus einem Formular oder Rumpf: eine ganze Zahl über null. Leer heißt „kein Jahr“
// (`null`), `false` heißt „keine gültige Angabe“.
const yearOf = (value: unknown): number | null | false => {
  if (value === undefined || value === null || value === '') return null
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d{1,4}$/.test(value.trim()) ? Number(value) : Number.NaN
  return Number.isInteger(n) && n > 0 && n < 10000 ? n : false
}
const YEAR_INVALID = 'Das Jahr muss eine ganze Zahl sein, etwa 2025, oder fehlen.'

// Das Objekt einer Angabe, geprüft: `null` heißt „ohne Objekt“.
async function placementProperty(db: Database, value: unknown): Promise<string | null> {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !(await listProperties(db)).some((p) => p.id === value)) {
    throw new RouteProblem(404, 'Dieses Objekt gibt es nicht (mehr). Bitte laden Sie die Seite neu.')
  }
  return value
}

// Die Zeile zu einem eben hochgeladenen Beleg. **Ein Fehler der Datenbank verhindert das
// Hochladen nicht**: Eine fehlende Zeile ist erlaubt (der Beleg wird dann aus der Datei
// beschrieben), ein verlorener Beleg nicht. Abgelehnt wird nur eine ungültige Angabe; dann
// verschwindet auch die Datei wieder, damit kein Rest im Ordner liegt.
async function recordNewUpload(req: Request, file: Express.Multer.File): Promise<void> {
  const body = bodyObject(req)
  const year = yearOf(body.year)
  if (year === false) throw new RouteProblem(400, YEAR_INVALID)
  const row: UploadRow = {
    file: file.filename,
    originalName: file.originalname.normalize('NFC'),
    mimeType: file.mimetype || mimeTypeOf(file.filename),
    size: file.size,
    sha256: await hashFile(file.path),
    uploadedAt: uploadedAtOf(file.filename, new Date()),
    propertyId: null,
    year,
    invoiceDate: null,
    kind: 'receipt',
  }
  try {
    await writeData(async (db) => recordUpload(db, { ...row, propertyId: await placementProperty(db, body.propertyId) }))
  } catch (err) {
    if (err instanceof RouteProblem) throw err
    console.warn(`Die Angaben zum Beleg ${file.filename} ließen sich nicht speichern: ${messageOf(err)}`)
  }
}

// Dasselbe für die KI-Routen, die ihre Antwort selbst schreiben: Statt zu werfen, antwortet die
// Route und gibt `false` zurück.
async function recordOrRefuse(req: Request, res: Response, file: Express.Multer.File): Promise<boolean> {
  try {
    await recordNewUpload(req, file)
    return true
  } catch (err) {
    fs.rmSync(file.path, { force: true })
    res.status(statusOf(err)).json({ error: messageOf(err) })
    return false
  }
}

app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei' })
  if (!(await recordOrRefuse(req, res, req.file))) return
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
    if (upload) {
      fs.rmSync(upload.path, { force: true })
      // Seine Angaben gehen mit (#170), ebenso eine Auswertung, die beim Abbruch gerade
      // gespeichert wurde; ein Beleg aus dem Posteingang ist nie `upload`.
      void writeData(async (db) => {
        await forgetAssessment(db, upload.filename)
        await forgetUpload(db, upload.filename)
      }).catch(() => undefined)
    }
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
// Der Beleg einer KI-Route: neu hochgeladen (dann mit Zeile in `uploads`) oder aus dem
// Posteingang. Antwortet selbst und gibt `null` zurück, wenn es keinen gibt.
async function documentOf(req: Request, res: Response): Promise<DocumentSource | null> {
  const fresh = uploadedFile(req)
  if (fresh) {
    if (!(await recordOrRefuse(req, res, fresh))) return null
    // Hat der Browser während des Speicherns schon aufgegeben, hört niemand mehr zu, und der
    // Abbruch in aiResponse käme nie an (Durchsicht): dann gleich aufräumen statt auszuwerten.
    if (res.destroyed || req.socket.destroyed) {
      fs.rmSync(fresh.path, { force: true })
      await writeData((db) => forgetUpload(db, fresh.filename)).catch(() => undefined)
      return null
    }
    return fresh
  }
  const existing = existingDocument(req)
  if (existing === undefined) res.status(400).json({ error: 'Keine Datei' })
  else if (existing === null) res.status(400).json({ error: NO_EXISTING })
  return existing ?? null
}

// Das Rechnungsdatum, das die KI gelesen hat, kommt zum Beleg (#170): Der Belegordner nennt es
// auf der Karte. Nur ein echtes Datum; misslingt das Speichern, fehlt es eben.
async function rememberInvoiceDate(file: string, value: unknown): Promise<void> {
  if (!isDateOnly(value)) return
  try {
    const sha256 = await hashFile(path.join(UPLOAD_DIR, file))
    await writeData((db) => placeUpload(db, file, { invoiceDate: value }, () => describeFile(UPLOAD_DIR, file, undefined, sha256)))
  } catch (err) {
    console.warn(`Das Rechnungsdatum zu ${file} ließ sich nicht speichern: ${messageOf(err)}`)
  }
}

async function markMeterPhoto(file: string): Promise<void> {
  try {
    const sha256 = await hashFile(path.join(UPLOAD_DIR, file))
    await writeData((db) => placeUpload(db, file, { kind: 'meterPhoto', propertyId: null, year: null }, () => describeFile(UPLOAD_DIR, file, undefined, sha256)))
  } catch (err) {
    console.warn(`Das Zählerfoto ${file} ließ sich nicht kennzeichnen: ${messageOf(err)}`)
  }
}

// Testgriff (#170): eine Pause vor dem Speichern der Auswertung, damit ein Test einen Abbruch genau
// in das Fenster zwischen der Antwort der KI und dem Speichern legen kann. Von außen lässt sich
// dieser Zeitpunkt sonst nicht treffen. Ohne die Variable gibt es keine Pause.
const ASSESSMENT_DELAY_MS = Math.max(0, Number(process.env.NKA_TEST_ASSESSMENT_DELAY_MS) || 0)

// Die Auswertung speichern (Belegbuchung, #170), erst nach Erfolg der KI; ein Abbruch speichert
// nichts. Objekt: das des Belegs im Posteingang, sonst das mitgeschickte, sonst bei einem einzigen
// Objekt dieses. Jahr: aus dem Beleg, sonst das gewählte (siehe `chosen` unten: das der früheren
// Auswertung, sonst das am Beleg im Posteingang, sonst das mitgeschickte), sonst das laufende.
// Misslingt das Speichern, kommt das Ergebnis trotzdem an, nur ohne Auswertung; die
// Oberfläche sagt dann, dass sich nichts buchen lässt.
//
// **Ein Abbruch speichert nichts**, auch wenn er erst nach der Antwort der KI ankommt. Geprüft
// wird im Schreibvorgang selbst, unmittelbar vor dem Speichern: Der Abbruch setzt `signal`
// synchron, und die Schlange lässt zwischen Prüfung und Speichern keine andere Anfrage herein.
// Bei einem Beleg aus dem Posteingang blieben sonst seine offenen Zeilen still ersetzt.
//
// **Jahr und Objekt der Auswertung werden zu denen des Belegs**, solange keine Zeile gebucht ist
// (das Objekt nur, wenn der Beleg noch keines hat; sonst kam es ohnehin von dort): Der Posteingang
// zeigt den Beleg sonst im Jahr des Formulars, obwohl die Auswertung ihn einem anderen zuordnet
// (eine Rechnung von 2026, hochgeladen auf der Seite des Jahres 2024). Ist etwas gebucht, ergibt
// sich beides aus der Position und die Angabe am Beleg sagt nichts mehr.
async function rememberAssessment(req: Request, file: DocumentSource, extraction: Extraction, signal: AbortSignal): Promise<AssessmentView | null> {
  const body = bodyObject(req)
  const sent = yearOf(body.year)
  try {
    if (ASSESSMENT_DELAY_MS > 0) await new Promise((resolve) => setTimeout(resolve, ASSESSMENT_DELAY_MS))
    // Die Prüfsumme braucht nur der Rückfall einer fehlenden Zeile; lässt sie sich nicht rechnen,
    // entsteht die Zeile ohne, und der Belegordner trägt sie später nach.
    const sha256 = await hashFile(file.path).catch(() => '')
    return await writeData(async (db) => {
      if (signal.aborted) return null
      const row = (await uploadRows(db)).get(file.filename)
      const properties = await listProperties(db)
      const asked = typeof body.propertyId === 'string' && properties.some((p) => p.id === body.propertyId) ? body.propertyId : null
      const [only, ...more] = properties
      const detected = detectedYear(extraction)
      // Das gewählte Jahr, in dieser Reihenfolge:
      // 1. Hat der Beleg schon eine Auswertung, deren gewähltes Jahr (L1 der Durchsicht von #201).
      //    Nach der ersten Auswertung liegt der Beleg im Jahr **aus dem Beleg**; nähme eine zweite
      //    Auswertung dieses als gewähltes, würde eine gelbe Zeile grün und „Alle grünen übernehmen“
      //    buchte ungesehen in ein anderes Jahr. Stellt der Nutzer das Jahr am Beleg um, zieht die
      //    Auswertung mit (`placeAssessment` setzt `requestedYear`), sein Wille gilt also auch hier.
      // 2. Sonst das Jahr am Beleg im Posteingang: Ohne Auswertung hat es der Nutzer oder der Ordner
      //    gesetzt, nie eine Platzierung nach einer Auswertung (Abnahme B3). Das Jahr der
      //    Seitenleiste, das der Browser mitschickt, überschreibt es nicht.
      // 3. Sonst das mitgeschickte.
      const previous = await readAssessmentOfFile(db, file.filename)
      const chosen = previous
        ? previous.assessment.requestedYear ?? (sent || null)
        : row?.year ?? (sent || null)
      const propertyId = row?.propertyId ?? asked ?? (only && more.length === 0 ? only.id : null)
      if (signal.aborted) return null
      const record = await saveAssessment(db, {
        file: file.filename,
        propertyId,
        year: detected ?? chosen ?? new Date().getUTCFullYear(),
        detectedYear: detected,
        // Das gewählte Jahr bleibt gespeichert, auch ohne Objekt (#208): Weicht das Jahr aus dem
        // Beleg davon ab, ist die Ampel gelb, und „Alle grünen übernehmen“ bucht die Zeile nicht
        // ungesehen in ein anderes Jahr. Den Zeitraum bildet saveAssessment.
        requestedYear: chosen,
        // Der gewählte Zeitraum (#208): der einer früheren Auswertung, sonst der mitgeschickte (die
        // Seite, von der aus ausgewertet wurde), solange der Beleg kein eigenes Jahr trägt. Er gilt
        // nur, wenn es ihn für das Objekt gibt; sonst bildet saveAssessment ihn aus dem Jahr.
        requestedPeriod: previous ? previous.assessment.requestedPeriod : row?.year == null ? parsePeriodKey(body.period) : null,
        vendor: extraction.vendor ?? null,
        invoiceDate: isDateOnly(extraction.invoiceDate) ? extraction.invoiceDate : null,
        totalGrossCents: typeof extraction.totalGrossEur === 'number' ? Math.round(extraction.totalGrossEur * 100) : null,
        amountsAdjusted: extraction.amountsAdjusted ?? null,
        laborFromTotal: extraction.laborFromTotal === true,
        lines: linesFromExtraction(extraction),
      }, { id: newId(), now: new Date().toISOString() })
      if (!record.lines.some((l) => l.costItemId !== null)) {
        const placement: Placement = row?.propertyId ? { year: record.assessment.year } : { year: record.assessment.year, propertyId: record.assessment.propertyId }
        await placeUpload(db, file.filename, placement, () => describeFile(UPLOAD_DIR, file.filename, undefined, sha256))
      }
      return viewRecord(db, record, UPLOAD_DIR)
    })
  } catch (err) {
    console.warn(`Die Auswertung zu ${file.filename} ließ sich nicht speichern: ${messageOf(err)}`)
    return null
  }
}

app.post('/api/extract', fileWithPages, async (req: Request, res: Response) => {
  const file = await documentOf(req, res)
  if (!file) return
  const answer = aiResponse(req, res)
  const { signal, stats, onProgress } = answer
  try {
    const result = await extractFromFile(file.path, file.mimetype, effectiveSettings(), { ...aiInput(req), signal, stats, onProgress })
    await rememberInvoiceDate(file.filename, result.invoiceDate)
    const assessment = await rememberAssessment(req, file, result, signal)
    answer.done({ file: file.filename, extraction: result, assessment, stats })
  } catch (err) {
    answer.fail({ file: file.filename, error: messageOf(err), stats })
  }
})

// Universeller Eingang (Schuhkarton): erkennt automatisch, ob die Datei eine Rechnung oder
// ein Zählerfoto ist, und liefert die passende KI-Auswertung. Antwort ist eine diskriminierte
// Union über `kind`. `/api/extract` bleibt für die (rein rechnungsbezogene) Kosten-Seite.
app.post('/api/intake', fileWithPages, async (req: Request, res: Response) => {
  const file = await documentOf(req, res)
  if (!file) return
  const answer = aiResponse(req, res)
  const { signal, stats, onProgress } = answer
  try {
    const settings = effectiveSettings()
    const material = { ...aiInput(req), signal, stats, onProgress }
    const docType = await classifyDocType(file.path, file.mimetype, settings, { signal, stats, onProgress })
    if (docType === 'zaehlerstand') {
      // Ein Zählerfoto belegt keine Kosten: als solches kennzeichnen und ohne Objekt, damit es in
      // keinem Posteingang als Beleg wartet und beim Nachreichen nicht angeboten wird (Durchsicht).
      await markMeterPhoto(file.filename)
      const reading = await extractMeterReading(file.path, file.mimetype, settings, material)
      answer.done({ file: file.filename, kind: 'zaehler', reading, stats })
    } else {
      const extraction = await extractFromFile(file.path, file.mimetype, settings, material)
      await rememberInvoiceDate(file.filename, extraction.invoiceDate)
      const assessment = await rememberAssessment(req, file, extraction, signal)
      answer.done({ file: file.filename, kind: 'rechnung', extraction, assessment, stats })
    }
  } catch (err) {
    answer.fail({ file: file.filename, error: messageOf(err), stats })
  }
})

// ---------- Belegbuchung (#170) ----------
//
// Vorschau und Buchung einer gespeicherten Auswertung. Gebucht wird **immer im Objekt der
// Auswertung**, nie im Objekt, das die Oberfläche gerade zeigt: Ein Tab, der noch auf einem
// anderen Objekt steht, bucht sonst ins falsche Haus. `?property=` gilt deshalb nur für die Liste.
const decisionsFrom = (req: Request) => {
  const parsed = parseDecisions(bodyObject(req).decisions)
  if ('error' in parsed) throw new RouteProblem(400, parsed.error)
  return parsed.decisions
}

app.get('/api/assessments', async (req, res) => {
  res.json(await readData(async (db) => viewAssessments(db, await propertyOf(db, req), req.query.open === '1', UPLOAD_DIR)))
})

app.get('/api/assessments/:id', async (req, res) => {
  res.json(await readData((db) => viewAssessment(db, req.params.id, UPLOAD_DIR)))
})

app.put('/api/assessments/:id', async (req, res) => {
  const body = bodyObject(req)
  res.json(await writeData(async (db) => {
    // Erst fragen, dann schreiben: Fehlt die Auswertung oder ihr Beleg, antwortet die Route mit 404,
    // und zwar bevor Jahr oder Objekt geändert sind. Sonst stünde die Änderung, obwohl der Aufrufer
    // einen Fehler sieht (Schlussdurchsicht, M4).
    await viewAssessment(db, req.params.id, UPLOAD_DIR)
    const change: { year?: number, propertyId?: string | null } = {}
    if (Object.hasOwn(body, 'year')) {
      const year = yearOf(body.year)
      if (year === false || year === null) throw new RouteProblem(400, 'Das Jahr muss eine ganze Zahl sein, etwa 2025.')
      change.year = year
    }
    if (Object.hasOwn(body, 'propertyId')) change.propertyId = await placementProperty(db, body.propertyId)
    const placed = await placeAssessment(db, req.params.id, change)
    if (placed === 'missing') throw new RouteProblem(404, 'Diese Auswertung gibt es nicht (mehr). Bitte laden Sie die Seite neu.')
    if (placed === 'booked') throw new RouteProblem(409, 'Zeilen dieses Belegs sind schon gebucht. Objekt und Jahr lassen sich deshalb nicht mehr ändern. Lösen Sie zuerst die Buchung dieser Zeilen oder löschen Sie die Position, an der sie hängen.')
    // Der Beleg zieht mit, solange nichts gebucht ist, sonst stünde er im Posteingang woanders als
    // seine Auswertung. Ohne Zeile (Datenbankfehler beim Hochladen) entsteht sie hier; die
    // Prüfsumme trägt der Belegordner nach.
    const record = await readAssessment(db, req.params.id)
    if (record && !record.lines.some((l) => l.costItemId !== null)) {
      const { file, year, propertyId } = record.assessment
      await placeUpload(db, file, { year, propertyId }, () => describeFile(UPLOAD_DIR, file))
    }
    return viewAssessment(db, req.params.id, UPLOAD_DIR)
  }))
})

app.post('/api/assessments/:id/plan', async (req, res) => {
  const decisions = decisionsFrom(req)
  res.json(await readData((db) => previewBooking(db, req.params.id, decisions, UPLOAD_DIR)))
})

app.post('/api/assessments/:id/book', async (req, res) => {
  const decisions = decisionsFrom(req)
  const token: unknown = bodyObject(req).token
  if (typeof token !== 'string' || token === '') {
    throw new RouteProblem(400, 'Gebucht wird nur, was die Vorschau gezeigt hat. Bitte zeigen Sie zuerst die Vorschau an.')
  }
  // Jede 409 bringt den Stand mit, mit dem die Oberfläche weitermacht. Die eine Ausnahme ist ein
  // `BookingRefusal(409)` aus der Transaktion von bookAssessment (eine Position ist verschwunden):
  // Er geht über die Fehlerbehandlung ohne Stand hinaus. Erreichbar ist er nicht, solange Planen
  // und Schreiben im selben Vorgang der Schreibschlange geschehen; wer das trennt, ergänzt hier
  // den Stand.
  const { outcome, assessment } = await writeData(async (db) => {
    const result = await bookAssessment(db, req.params.id, decisions, token, { uploadDir: UPLOAD_DIR, newId })
    return { outcome: result, assessment: await viewAssessment(db, req.params.id, UPLOAD_DIR) }
  })
  const reply = bookingResponse(outcome, assessment)
  res.status(reply.status).json(reply.body)
})

// Belegordner (#170): alle hochgeladenen Dateien mit Originalname, Hochladezeit und Prüfsumme.
//
// Die Angaben aus der Datenbank gelten, wo es sie gibt; sonst wird der Beleg aus der Datei
// beschrieben. **Ohne Datenbank bleibt die Liste trotzdem vollständig**, nur ohne Posteingang:
// Belege sind Dateien, und sie zu sehen soll nicht davon abhängen, ob gerade die Datenbank trägt.
//
// **Prüfsummen fehlender Zeilen werden nachgetragen, einmal und im Hintergrund** (`backfillUploads`):
// Bis dahin ist `sha256` leer, und die Liste antwortet sofort. Vorher rechnete jeder Start sie
// synchron und im Speicher neu, und eine große Altablage hielt dabei den ganzen Server an.
const NO_LINKS: UploadLinks = { bookedItemIds: [], bookedCents: {}, assessment: null }

app.get('/api/uploads', async (req, res) => {
  const rows = await readData(uploadRows).catch(() => null)
  // Ohne Datenbank bleibt die Liste vollständig, nur ohne Posteingang und ohne Buchungen.
  const links = await readData(uploadLinks).catch(() => new Map<string, UploadLinks>())
  const list: UploadEntry[] = describeFolder(UPLOAD_DIR, rows ?? new Map<string, UploadRow>())
    .map((u) => ({ ...u, ...(links.get(u.file) ?? NO_LINKS) }))
  if (rows && list.some((u) => !u.sha256)) void backfillUploads()
  res.json(list)
})

// Trägt zu jedem Beleg ohne Zeile (oder ohne Prüfsumme) die Zeile nach. Je Beleg ein eigener
// Lese- und Schreibvorgang, dazwischen kommt jede andere Anfrage dran. Läuft höchstens einmal
// zugleich; ein zweiter Aufruf während des Laufs wartet auf denselben.
let backfillRunning: Promise<void> | null = null
function backfillUploads(): Promise<void> {
  backfillRunning ??= (async () => {
    try {
      const rows = await readData(uploadRows)
      for (const info of describeFolder(UPLOAD_DIR, rows)) {
        if (info.sha256) continue
        try {
          const sha256 = await hashFile(path.join(UPLOAD_DIR, info.file))
          const row = { ...rowOf(info), sha256 }
          await writeData(async (db) => {
            const current = (await uploadRows(db)).get(info.file)
            if (current) await recordUpload(db, { ...current, sha256 })
            else await recordIfMissing(db, row)
          })
        } catch (err) {
          // Verschwunden oder unlesbar: beim nächsten Mal wieder, die Liste übergeht ihn ohnehin.
          console.warn(`Prüfsumme zu ${info.file} nicht nachgetragen: ${messageOf(err)}`)
        }
      }
    } catch (err) {
      console.warn(`Prüfsummen nicht nachgetragen: ${messageOf(err)}`)
    } finally {
      backfillRunning = null
    }
  })()
  return backfillRunning
}

// Objekt, Jahr und Rechnungsdatum eines Belegs ändern (#170, Posteingang). Zugeordnet wird einer
// Position weiterhin über die Position (`PUT /api/costItems/:id` mit `invoiceFile`).
app.put('/api/uploads/:file', async (req, res) => {
  const name = path.basename(req.params.file)
  const full = path.join(UPLOAD_DIR, name)
  if (name !== req.params.file || !fs.existsSync(full) || !fs.statSync(full).isFile()) return res.status(404).json({ error: 'Datei nicht gefunden' })
  const body = bodyObject(req)
  const changes: Placement = {}
  if (Object.hasOwn(body, 'year')) {
    const year = yearOf(body.year)
    if (year === false) return res.status(400).json({ error: YEAR_INVALID })
    changes.year = year
  }
  if (Object.hasOwn(body, 'invoiceDate')) {
    const value: unknown = body.invoiceDate
    if (value !== null && value !== '' && !isDateOnly(value)) return res.status(400).json({ error: 'Das Rechnungsdatum muss ein Datum als JJJJ-MM-TT sein oder fehlen.' })
    changes.invoiceDate = isDateOnly(value) ? value : null
  }
  // Hat der Beleg noch keine Zeile, entsteht sie hier, und zwar gleich mit Prüfsumme
  const sha256 = await hashFile(full)
  const row = await writeData(async (db) => {
    if (Object.hasOwn(body, 'propertyId')) changes.propertyId = await placementProperty(db, body.propertyId)
    const placed = await placeUpload(db, name, changes, () => describeFile(UPLOAD_DIR, name, undefined, sha256))
    // Die Auswertung desselben Belegs zieht mit (Belegbuchung), solange keine Zeile gebucht ist;
    // ist etwas gebucht, lehnt placeAssessment ab und sie bleibt, wie sie ist. Ein geleertes Jahr
    // lässt ihr Jahr stehen, denn eine Auswertung hat immer eines.
    const assessment = await readAssessmentOfFile(db, name)
    if (assessment) {
      const follow: { year?: number, propertyId?: string | null } = {}
      if (typeof changes.year === 'number') follow.year = changes.year
      if (changes.propertyId !== undefined) follow.propertyId = changes.propertyId
      await placeAssessment(db, assessment.assessment.id, follow)
    }
    return placed
  })
  const info = row ? describeFile(UPLOAD_DIR, name, row) : null
  if (!info) return res.status(404).json({ error: 'Datei nicht gefunden' })
  res.json(info)
})

// Beleg löschen — nur wenn keine Kostenposition mehr darauf verweist.
//
// **Gefragt wird die Datenbank und nicht die db.json.** Die Frage nach der Verknüpfung ist die
// einzige Sicherung, die zwischen einem Klick im Belegordner und einer gelöschten Rechnung
// steht. Fragte sie weiter die Datei, sähe sie nach dem Umstieg einen leeren Bestand, jeder
// Beleg gälte als unbenutzt, und der Klick löschte die Rechnung unter einer Kostenposition weg.
app.delete('/api/uploads/:file', async (req, res) => {
  const name = path.basename(req.params.file) // verhindert Pfad-Ausbrüche
  const full = path.join(UPLOAD_DIR, name)
  // Nur eine Datei im Belegordner, wie bei PUT: „..“ besteht `basename` und `existsSync`, und
  // `unlinkSync` auf einen Ordner endete mit 500 (#180).
  if (name !== req.params.file || !fs.existsSync(full) || !fs.statSync(full).isFile()) return res.status(404).json({ error: 'Datei nicht gefunden' })
  // Prüfung und Vergessen in einem Schreibvorgang: Eine Buchung, die dazwischen ankäme, würde
  // sonst mit der Auswertung gelöscht (Kaskade). Die Datei geht erst danach.
  const inUse = await writeData(async (db) => {
    if ((await invoiceFilesInUse(db, [name])).has(name)) return true
    await forgetUpload(db, name)
    await forgetAssessment(db, name)
    return false
  })
  if (inUse) {
    return res.status(409).json({ error: 'Beleg ist noch mit Kostenpositionen verknüpft.' })
  }
  fs.unlinkSync(full)
  res.json({ ok: true })
})

// ---------- Belege für die Steuer (#170) ----------
// Ein ZIP aller Belege eines Objekts und Jahres nach den Gruppen der Anlage V, samt Übersicht.
// Aufbau und Begründung in taxReceipts.ts.
app.get('/api/receipts/tax/:year', async (req, res) => {
  const year = Number(req.params.year)
  if (!Number.isInteger(year)) return res.status(400).json({ error: 'Ungültiges Jahr' })
  const { items, property, rows, links, split } = await readData(async (db) => {
    const propertyId = await propertyOf(db, req)
    const whole = await readStock(db)
    const stock = narrowToProperty(whole, propertyId)
    const property = (await listProperties(db)).find((p) => p.id === propertyId)
    // Privat und abziehbar je Position aus derselben Rechnung wie die Steuerübersicht (#163), und
    // dieselbe Auswahl der Positionen: das Jahr der Zahlung (#208).
    const report = taxReportFor(whole, propertyId, year)
    const split = new Map(report.expenses.items.map((i) => [i.costItemId, i]))
    const parts = taxPartsFor(whole, propertyId, year)
    const ids = new Set(parts === null
      ? stock.costItems.filter((c) => c.period === calendarPeriod(year)).map((c) => c.id)
      : parts.flatMap((p) => p.items.map((c) => c.id)))
    return { items: stock.costItems.filter((c) => ids.has(c.id)), property, rows: await uploadRows(db), links: await uploadLinks(db), split }
  })
  const booked = new Map<string, string[]>()
  for (const [file, l] of links) for (const id of l.bookedItemIds) booked.set(id, [...(booked.get(id) ?? []), file])
  const names = new Map<string, string>()
  for (const u of describeFolder(UPLOAD_DIR, rows)) names.set(u.file, u.originalName)
  const plan = planTaxArchive(items, names, booked, split)
  const zip = new AdmZip()
  for (const { zipPath, file } of plan.files) zip.addFile(zipPath, fs.readFileSync(path.join(UPLOAD_DIR, file)))
  zip.addFile('Übersicht.csv', Buffer.from(plan.overviewCsv, 'utf8'))
  const label = (property?.name || 'objekt').normalize('NFC').replace(/[^\w\-äöüÄÖÜß]+/g, '-').replace(/^-+|-+$/g, '') || 'objekt'
  res.set('Content-Type', 'application/zip')
  res.set('Content-Disposition', `attachment; filename="belege-steuer-${year}-${label.replace(/[^\x20-\x7e]/g, '_')}.zip"; filename*=UTF-8''${encodeURIComponent(`belege-steuer-${year}-${label}.zip`)}`)
  res.send(zip.toBuffer())
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
  res.set('Content-Disposition', `attachment; filename="mietfuchs-backup-${stamp}.zip"`)
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
  files: { fileName: string, content: Buffer, time: Date }[]
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
  // Wiederherstellen nicht verhindern, sondern führt nur zu „unbekannter Herkunft“.
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
    // Die Zeit des Eintrags kommt mit (#142): Ohne sie trüge jeder Beleg danach das Datum der
    // Wiederherstellung, und im Belegordner sähe eine alte Rechnung aus wie eben hochgeladen.
    files: files.map(({ fileName, e }) => ({ fileName, content: e.getData(), time: e.header.time })),
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
  // sonst greift seine Regel „steht schon etwas darin, passiert nichts“, und genau die soll
  // hier nicht weich werden.
  //
  // **Bewegt wird mit Wiederholungen** (`replaceFile`, dieselbe Funktion wie beim Umstieg). Unter
  // Windows kann ein Virenscanner die eben geschlossene Datei kurz offen halten; ein nacktes
  // `renameSync` scheiterte dann an etwas, das von selbst vergeht, und zwar ausgerechnet in dem
  // Augenblick, in dem die einzige Kopie der wiederhergestellten Daten noch unter ihrem
  // Zwischennamen liegt.
  if (fs.existsSync(target)) await replaceFile(target, path.join(DATA_DIR, DB_BEFORE_RESTORE))
  if (staged) await replaceFile(staged, target)

  // Die Sicherung vor einem früheren Update gehört nicht zum wiederhergestellten Stand; der
  // Rückweg ist jetzt mietfuchs.sqlite.vor-restore (#154, #180).
  try {
    clearNotice(DATA_DIR)
  } catch {
    // Kein Grund, das Wiederherstellen abzubrechen: Schlimmstenfalls nennt der nächste Start
    // noch einmal eine Sicherung, die es wirklich gibt.
  }
  migrationNotice = null

  try {
    database = await openDatabase({ dataDir: DATA_DIR })
    const freshAfterRestore = freshBackupOf(database)
    if (freshAfterRestore) noteBackup(freshAfterRestore)
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
  // aktiviert, sähe der Vermieter nach der Bestätigung „ok“ ein veraltetes oder leeres Haus,
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
  for (const { fileName, content, time } of backup.files) {
    const target = path.join(UPLOAD_DIR, fileName)
    fs.writeFileSync(target, content)
    // Das Datum ist eine Auskunft: Scheitert es (etwa auf einem Netzlaufwerk), bleibt der Beleg.
    try {
      if (!Number.isNaN(time.getTime())) fs.utimesSync(target, time, time)
    } catch { /* Datum bleibt das von heute */ }
  }

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
        `(${DATA_DIR}) liegen der vorherige Stand als „mietfuchs.sqlite.vor-restore“ und, falls ` +
        'das Archiv eine mitgebracht hat, die neue Datenbank noch unter einem Namen, der mit ' +
        '„mietfuchs.sqlite.restore-“ beginnt. Bitte melden Sie diesen Fehler, bevor Sie etwas ' +
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
// höchstens einmal am Tag; „Jetzt prüfen“ fragt sofort, außer GitHub hat um eine Pause
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

// Die Oberfläche hat den Hinweis auf die Sicherung vor dem Update weggeklickt (#180). Danach
// nennt ihn /healthz nicht mehr, auch nicht nach einem Neustart und in keinem anderen Browser.
// Der Schlüssel muss zu dem passen, was dasteht (siehe acknowledgeNotice); ein unpassender ist
// kein Fehler, sondern ein Tab von vorher, und ändert nichts.
app.post('/api/database/migrated/seen', (req, res) => {
  const key = typeof req.body?.key === 'string' ? req.body.key : ''
  if (!key) return res.status(400).json({ error: 'Es fehlt, welcher Hinweis gelesen wurde.' })
  const outcome = acknowledgeNotice(DATA_DIR, key)
  const matches = outcome !== 'unchanged' || (migrationNotice !== null && noticeKey(migrationNotice) === key)
  if (matches) migrationNotice = null
  if (outcome === 'failed') {
    // In diesem Lauf ist er weg; beim nächsten Start kommt er wieder. Das ist hinnehmbar.
    console.error(`Der Hinweis auf die Sicherung ließ sich nicht entfernen (${NOTICE_NAME} im Datenordner).`)
    return res.status(204).end()
  }
  res.json({ ok: true, cleared: matches })
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
  // „Beenden“ nichts in der Schlange steht.
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
  // Eigene Heizkostenabrechnung (Heizung PR 10): die Liste der Positionen, die umzustellen sind.
  if (err instanceof SelfItemsError) return res.status(409).json({ error: err.message, items: err.items })
  // Ablehnungen, deren Meldung schon für den Nutzer geschrieben ist (#92).
  if (err instanceof RouteProblem || err instanceof CrossPropertyError || err instanceof PeriodError || err instanceof PeriodConflict || err instanceof TenantChangeError || err instanceof BookingRefusal || err instanceof HeatingError || err instanceof StaleTenancyError || err instanceof LawOverrideError) {
    return res.status(err.status).json({ error: err.message })
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
const startProblem = AI_ENV.error ?? checkKeyEnvironment() ?? portProblem ?? TEST_TODAY.error
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

// Der Hinweis auf die Sicherung vor einem Update (#154), für /healthz. Er übersteht einen
// Neustart (#180, siehe db/migrationNotice.ts): Ohne frische Sicherung gilt, was die Merkdatei
// sagt, bis die Oberfläche ihn wegklickt oder ein Backup eingespielt wird.
let migrationNotice: MigrationNotice | null = null

type FreshBackup = { file: string, steps: number }
const freshBackupOf = (opened: OpenedDatabase | null): FreshBackup | null =>
  opened?.backup ? { file: opened.backup, steps: opened.migrations } : null

// Ohne frische Sicherung gilt die Merkdatei, mit einer frischen wird sie neu geschrieben.
function noteBackup(fresh: FreshBackup | null): void {
  if (!fresh) {
    migrationNotice = readNotice(DATA_DIR)
    return
  }
  // Nur der Name: Die Sicherung liegt immer im Datenordner, und die Oberfläche sagt es so.
  migrationNotice = { steps: fresh.steps, backup: path.basename(fresh.file), at: backupTime(fresh.file) }
  try {
    recordNotice(DATA_DIR, migrationNotice)
  } catch (err) {
    // Dann gilt der Hinweis nur bis zum nächsten Start, wie vorher; ein Grund zum Abbruch ist es nicht.
    console.error(`Der Hinweis auf die Sicherung ließ sich nicht festhalten: ${messageOf(err)}`)
  }
}

// Kein Hinweis, auch nicht nach dem nächsten Start.
function forgetNotice(): void {
  migrationNotice = null
  try {
    clearNotice(DATA_DIR)
  } catch (err) {
    console.error(`Der Hinweis auf die Sicherung ließ sich nicht entfernen: ${messageOf(err)}`)
  }
}

// Welcher Hinweis nach dem Umstieg gilt (Durchsicht zu #180). Ist der Umstieg aus der db.json
// gelungen, war die Datenbank davor leer (ein früher gescheiterter Umstieg hatte sie angelegt), und
// ihre Sicherung vor dem Update ist ein leerer Stand. Sie als Rückweg zu nennen hieße: Wer der
// Anleitung folgt, setzt eine leere Datenbank ein, während die db.json schon „abgelöst“ heißt. Der
// Rückweg ist dort db.json.abgeloest. Ist er gescheitert, trägt die Datenbank den Bestand nicht,
// und ihre Sicherung ebenso wenig; dann gibt es in diesem Lauf keinen Hinweis.
function noteAfterChangeover(state: ChangeoverResult['state'], fresh: FreshBackup | null): FreshBackup | null {
  if (state === 'done') {
    forgetNotice()
    return null
  }
  if (state === 'failed') {
    migrationNotice = null
    return null
  }
  noteBackup(fresh)
  return fresh
}

// ---------- Erst der Port, dann die Daten (#244) ----------
//
// Der Port wird gebunden, **bevor** die Datenbank geöffnet, migriert oder umgestiegen wird.
// Vorher war es umgekehrt, und ein zweiter Start (Klick im Startmenü, während Mietfuchs schon
// unsichtbar läuft) migrierte die Datei unter der laufenden Version, legte eine Sicherung samt
// Merkdatei an, hinter der die alte weiterschrieb, und bemerkte erst danach den belegten Port.
// Beim Update auf eine Version mit neuen Schritten ist genau das der wahrscheinlichste Weg.
//
// Gebunden statt nur nachgefragt: Eine Frage nach /healthz vor dem Öffnen ließe ein Fenster
// zwischen Frage und `listen`, in dem zwei gleichzeitige Starts beide „frei“ hören und beide
// migrieren. Das Binden entscheidet das Betriebssystem für genau einen. Eine Sperrdatei im
// Datenordner leistete dasselbe, bliebe aber nach einem Absturz liegen und bräuchte eine Regel,
// wann sie verwaist ist; der Port gibt sich mit dem Prozess von selbst frei.
//
// Bis Datenbank und Umstieg fertig sind, wartet jede Anfrage und wird danach ganz gewöhnlich
// beantwortet, so sieht niemand einen halben Stand. Nur /healthz antwortet sofort, mit 503 und
// `status: 'starting'`: Ein zweiter Start erkennt daran Mietfuchs (`app: 'mietfuchs'`), auch wenn
// der erste gerade einen langen Umstieg rechnet, und ein Container gilt so lange als nicht bereit.
let startupDone = false
let finishStartup: () => void = () => {}
const startup = new Promise<void>((resolve) => { finishStartup = resolve })

const server = http.createServer((req, res) => {
  if (startupDone) return app(req, res)
  if ((req.url ?? '').split('?')[0] === '/healthz') {
    res.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'retry-after': '1' })
    res.end(JSON.stringify({ app: 'mietfuchs', status: 'starting', version: APP_VERSION }))
    return
  }
  void startup.then(() => app(req, res))
})

// Antwortet auf dem Port bereits Mietfuchs? /healthz nennt sich mit Namen (health.ts), auch
// während des Startens (oben). Dann ist ein zweiter Start kein Fehler, sondern ein zweiter Klick
// im Startmenü (#45).
//
// **Schweigt der Port, wird nachgefragt** (Durchsicht zu #244). Rechnet der erste Start gerade
// einen Abschnitt, der die Ereignisschleife blockiert (die Regression des Umstiegs über viele
// Jahre, ein großer Migrationsschritt), antwortet auch sein /healthz erst danach. Nach dem ersten
// Zeitlimit „anderes Programm“ zu melden wäre dann falsch. Nur eine **ausbleibende** Antwort führt
// zur nächsten Frage; eine Antwort, die nicht Mietfuchs ist, entscheidet sofort.
const PROBE_ATTEMPT_MS = 2000
const PROBE_TOTAL_MS = 30000

async function mietfuchsAlreadyOn(url: string): Promise<boolean> {
  const deadline = Date.now() + PROBE_TOTAL_MS
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(PROBE_ATTEMPT_MS) })
      const report: unknown = await res.json()
      return isObject(report) && report.app === 'mietfuchs'
    } catch (err) {
      const silent = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
      if (!silent || Date.now() + PROBE_ATTEMPT_MS > deadline) return false
      if (attempt === 1) console.log(`Auf ${url} antwortet noch nichts. Mietfuchs fragt bis zu ${PROBE_TOTAL_MS / 1000} Sekunden lang erneut nach.`)
    }
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

// Der Start endet hier, ohne dass die Datenbank berührt wurde. Fehler von node:net tragen
// `code`, das Error selbst nicht.
async function refuseStart(err: NodeJS.ErrnoException): Promise<never> {
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
  // Fenster kurz offen lassen, damit man die Meldung liest
  if (STANDALONE) await new Promise((resolve) => setTimeout(resolve, 10000))
  process.exit(1)
}

const listenProblem = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
  server.once('error', resolve)
  server.listen(PORT, () => {
    server.off('error', resolve)
    resolve(null)
  })
})
if (listenProblem) await refuseStart(listenProblem)
// Ein späterer Fehler des Servers endet wie bisher.
server.on('error', (err: NodeJS.ErrnoException) => void refuseStart(err))

// Testgriff: hält den Start nach dem Binden und vor dem Öffnen der Datenbank fest, damit ein
// Test das Rennen zweier gleichzeitiger Starts nachstellen kann. Ein Nutzer setzt ihn nie.
const startDelayMs = Number(process.env.NKA_TEST_START_DELAY_MS || 0)
if (startDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, startDelayMs))

try {
  database = await openDatabase({ dataDir: DATA_DIR })
} catch (err) {
  openProblem = messageOf(err)
}
// Die Sicherung, die dieser Start vor dem Nachholen angelegt hat, festgehalten **vor** dem
// Umstieg: Öffnet der die Datenbank neu, ist sie an der neuen Verbindung nicht mehr vermerkt.
const backupBeforeChangeover = freshBackupOf(database)

// Der Umstieg der vorhandenen Daten, beim ersten Start der neuen Version (siehe
// db/changeover.ts). Er läuft hier und nicht auf Zuruf, weil niemand einen Befehl eingeben soll,
// um an seine eigenen Daten zu kommen, und er läuft, **bevor** der Server Anfragen beantwortet:
// Der Port ist zwar schon gebunden (#244), aber jede Anfrage außer /healthz wartet, bis der
// Start fertig ist. So kann ihm auch niemand dazwischenschreiben.
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
// Erst jetzt, denn ob die Sicherung ein Rückweg ist, hängt am Ausgang des Umstiegs.
const backupOfThisStart = noteAfterChangeover(changeover.state, backupBeforeChangeover)?.file ?? null

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
// Wann die Sicherung entstand. Fehlt die Datei inzwischen, ist der Zeitpunkt unbekannt; der
// Hinweis bleibt trotzdem richtig, er lässt sich dann nur nicht von einem früheren unterscheiden.
function backupTime(file: string): string {
  try {
    return fs.statSync(file).mtime.toISOString()
  } catch {
    return ''
  }
}

function databaseState(): DatabaseState {
  const wie = { state: changeover.state, message: changeover.message, notes: changeover.notes, ...(changeover.pending ? { pending: true } : {}) }
  if (database) {
    return { open: true, file: database.file, migrations: database.migrations, detail: 'geöffnet', changeover: wie, migrated: migrationNotice }
  }
  return { open: false, file: databaseFile(DATA_DIR), migrations: 0, detail: openProblem ?? 'nicht geöffnet', changeover: wie, migrated: null }
}

// Jetzt erst gilt der Start als gelungen: Meldung, Browser und die Anfragen, die gewartet haben.
{
  // Bewusst 127.0.0.1 statt localhost: Unter Windows löst "localhost" zuerst auf IPv6
  // (::1) auf. Der Server lauscht auf IPv4 (0.0.0.0), und auf ::1 kann ein anderer
  // Dienst sitzen (z. B. WSLs wslrelay), der dann 404 liefert. 127.0.0.1 erzwingt IPv4.
  // Der Port kommt vom Server selbst: Mit NKA_PORT=0 vergibt das System einen freien, und die
  // Tests lesen ihn aus dieser Meldung. `address()` liefert einen String nur bei einem
  // Unix-Socket und null vor dem Lauschen; beides kann hier nicht sein.
  const address = server.address()
  const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : PORT}`
  console.log(`Mietfuchs-Server läuft auf ${url}`)
  if (TEST_TODAY.value !== null) console.log(`Testgriff NKA_TEST_TODAY aktiv: Der Server rechnet mit dem ${TEST_TODAY.value} als heute.`)
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
  // Die Sicherung vor dem Update (#154) auch hier, mit vollem Pfad (#180): Im Container oder im
  // npm-Betrieb liest das Protokoll, wer die Oberfläche vielleicht nie öffnet. Nur beim Start,
  // der sie angelegt hat; danach steht sie nur noch in /healthz.
  if (backupOfThisStart) console.log(`Vor dem Update wurde eine Sicherung Ihrer Daten angelegt: ${backupOfThisStart}`)
  // Der Umstieg der Daten (#55). Gelungen ist er einen Satz wert, gescheitert eine Erklärung auf
  // der Fehlerausgabe. Ohne Konsolenfenster (Linux-Paket) steht beides in der Oberfläche, die es
  // aus /healthz liest.
  if (changeover.state === 'done') {
    console.log(changeover.message)
    for (const note of changeover.notes) console.log(note)
    if (changeover.protocol) console.log(`Protokoll des Umstiegs: ${changeover.protocol}`)
  } else if (changeover.state === 'failed') {
    console.error(changeover.message)
  } else if (changeover.state === 'stale') {
    console.log(`Hinweis: ${changeover.message}`)
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
}
startupDone = true
finishStartup()

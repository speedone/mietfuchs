import express, { type NextFunction, type Request, type Response } from 'express'
import { AsyncLocalStorage } from 'node:async_hooks'
import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import yazl from 'yazl'
import { openZip, ZipRefusal, type ZipItem, type ZipLimits, type ZipReader } from './zipRead.ts'
import { cleanRestoreLeftovers, diskFullMessage, freeBytes, moveIntoPlace, restoreSpaceNeeded, restoreUploadPath } from './restoreFiles.ts'
import type { AiFailure, AiSettings, AiSlotName, AiStatus, AssessmentView, Extraction, Settings, UploadEntry, UploadLinks } from '../../shared/types.ts'
import { detectedYear, linesFromExtraction } from './assessment.ts'
import { bookingResponse, parseDecisions } from './bookingPlan.ts'
import { forgetAssessment, placeAssessment, readAssessment, readAssessmentOfFile, saveAssessment, uploadLinks } from './db/assessments.ts'
import { BookingRefusal, bookAssessment, previewBooking, viewAssessment, viewAssessments, viewRecord } from './db/booking.ts'
import { newId, UPLOAD_DIR, DATA_DIR } from './store.ts'
import { DEFAULT_SETTINGS } from './defaults.ts'
import { compareWithFrozen } from './settlementDiff.ts'
import { computeSettlement, consumptionOverview, rentLedger, taxPartsFor, taxReportFor, type ComputedSettlement } from './calc.ts'
import { ledgerStatementsFor } from './ledgerStatements.ts'
import { heatingSnapshotFor, narrowToProperty, snapshotFor } from './snapshot.ts'
import { calendarYearPeriod, isCalendarRules, parsePeriodKey, periodContaining, periodLabel, periodOfKey, resolvePeriodParam, rulesOf, settlementDeadline, settlementPeriod, startYearOf } from '../../shared/period.ts'
import type { BillingPeriod, FuelGapQuestion, HeatingPlant, LetterDesigns, LetterTemplates, Notice, PrepaymentStepPlan, StatementLetter, Unit } from '../../shared/types.ts'
import { closeWithQuestions, type CloseQuestion, type FuelAnswer } from './closeQuestion.ts'
import { planPrepaymentSteps, stepMonthProblem, stepToken, stepWrites, type StepInput, type StepLetter } from './prepaymentSteps.ts'
import { blockingErrors } from '../../shared/notices.ts'
import { plantRules, separateOwner, settledSeparately } from '../../shared/heatingPeriod.ts'
import { extractFromFile, classifyDocType, extractMeterReading, type AskProgressEvent, type AskStats } from './extract.ts'
import { extractFuelInvoice, extractServiceStatement } from './extractHeating.ts'
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
import { isProviderError, reasonOf } from './ai/errors.ts'
import { databaseUnavailable, healthReport, NO_DATABASE, type DatabaseState } from './health.ts'
import { databaseFile, openDatabase, setAsideName, type OpenedDatabase } from './db/open.ts'
import { changeoverWithoutDatabase, replaceFile, runChangeover, type ChangeoverResult } from './db/changeover.ts'
import { acknowledgeNotice, clearNotice, NOTICE_NAME, noticeKey, readNotice, recordNotice, type MigrationNotice } from './db/migrationNotice.ts'
import { loadMigrations, type Database, type Executor } from './db/client.ts'
import { databaseProblem } from './db/errors.ts'
import { readCostItems, readHeatingPlants, readProperties, readSettings, readStock, readTenancies, readUnits, type Stock, type StoredClosedHeatingSettlement, type StoredClosedSettlement } from './db/read.ts'
import { lettersFor, letterDoc } from './letter.ts'
import { savePropertyPrintLetter, readInstallationLetterTexts, readPropertyLetterTexts, readTenancyLetters, saveInstallationLetterTexts, savePropertyLetterTexts, saveTenancyLetter } from './db/letters.ts'
import { DEFAULT_LETTER_TEXTS, isMonthKey, lettersOf, parseLetterAdjustment, parseLetterTexts } from '../../shared/letter.ts'
import { readInstallationDesign, readPropertyDesign, referencedDesignFiles, saveInstallationDesign, savePropertyDesign } from './db/letterDesign.ts'
import { LETTER_DESIGN_LIMITS, LIMIT_TEXT, MIME_TYPES, designFileType, isDesignFileName, letterDesignFiles } from '../../shared/letterDesign.ts'
import { LetterDesignError, archivedDesignProblem, designDir, designFilePath, designFilesOnDisk, nextDesign, parseDesignRequest, prepareDesignFiles, presentDesign, removeUnreferenced, writeDesignFiles } from './letterDesign.ts'
import {
  closeHeatingSettlement, findClosedHeatingSettlement, heatingSettlementHistory, reopenHeatingSettlement, separateHeatingSettlements, setHeatingSentAt,
} from './db/heatingSettlements.ts'
import {
  changeTenant, closeSettlement, createEntity, createProperty, createReading, ContractError, CrossPropertyError, LocalRentError, LetterInputError, findClosedSettlement, HeatingError, PaidOnQuestion, PaymentError, SpreadQuestion, TaxYearQuestion, PeriodConflict, PeriodError, StaleTenancyError, invoiceFilesInUse, previewCostItemSplit, saveCostItemSplit,
  findEntity, listProperties, patchTenancyIn, removeEntity, removeProperty, reopenSettlement, setSentAt, settlementHistory, updateEntity, updateProperty,
  TenantChangeError, unitDependents, writeSettings, writeSettingsIn, nullableBoolean, nullableLine, type CollectionName,
} from './db/repository.ts'
import { removeInterimGap, saveDistribution, saveInterimGap, SelfItemsError, setUpSelf } from './db/heatingSelf.ts'
import { saveHeatingInfo, saveHeatingRules } from './db/heatingInfo.ts'
import { monthlyInfoView, saveMonthlyInfoRow } from './db/monthlyInfo.ts'
import { createRefund, listRefunds, removeRefund, updateRefund } from './db/co2Refunds.ts'
import { heatingPeriodViews, removeCo2Statement, saveCo2Statement, saveDhwTemperature, saveHotWater } from './db/co2.ts'
import { saveServiceValues } from './db/serviceValues.ts'
import { removeEstimate, saveEstimate } from './db/heatingEstimates.ts'
import { co2SheetFor } from './co2Sheet.ts'
import { heatingPeriodOf, plantContext } from './db/heatingPeriodContext.ts'
import { LawOverrideError, lawOverrideSlots, readLawOverrides, removeLawOverride, saveLawOverride } from './db/lawOverrides.ts'
import { removeStock, saveStock } from './db/fuelStock.ts'
import { createDelivery, createEstimates, freezeFuelCarries, fuelGapQuestions, listDegreeDays, listDeliveries, reassignCredit, removeDelivery, saveDegreeDays, unfreezeFuelCarries, updateDelivery } from './db/fuel.ts'
import { assignableHeatingItems, createHeatingPlant, listHeatingPlants, removeHeatingPlant, replaceHeatingPlant, updateHeatingPlant } from './db/heating.ts'
import { bookOperatingPower, OperatingPowerQuestion } from './db/operatingPower.ts'
import { applyHeatingPeriodChange, previewHeatingPeriodChange } from './db/heatingPeriodChange.ts'
import { testTodayOf } from './testToday.ts'
import { applySeparate, previewSeparate } from './db/separateSettlement.ts'
import { applyPeriodChange, previewPeriodChange } from './db/periodChange.ts'
import {
  ARCHIVE_DB_NAME, ARCHIVE_INFO_NAME, DB_BEFORE_RESTORE,
  archiveDatabaseProblem, archiveInfoText, originText, stripJournal, writeDatabaseSnapshot,
} from './db/backup.ts'
import { findingsText, validateDb } from './legacy/validate.ts'
import { createUpdateChecker, UPDATE_URL } from './update.ts'
import { APP_VERSION, RUNTIME, STANDALONE } from './version.ts'
import { describeFile, describeFolder, hashFile, mimeTypeOf, uploadedAtOf } from './uploads.ts'
import { acceptIban, IbanRefusal } from './iban.ts'
import { IBAN_LABELS } from '../../shared/iban.ts'
import { exportFilename, frozenExportable, settlementExportCsv, settlementExportJson, type ExportableSettlement } from './settlementExport.ts'
import { derivedTaxLines, partsBySource, planTaxArchive, taxArchiveItems } from './taxReceipts.ts'
import { createPriorVersion, mayCreatePriorVersion, PRIOR_CHECK_INTERVAL_MS, PRIOR_DIR, priorVersionsBlocked } from './db/priorVersions.ts'
import { changeGroups, costItems as costItemsTable } from './db/schema.ts'
import { addBarrier, isJournalKind, journalGroup, listJournal, pruneJournal, unjournaled, type JournalBarrier, type JournalMeta } from './db/journal.ts'
import { applyRevert, consentSnapshot, isRevertMode, previewRevert, restoreConsent, RevertRefused, type ConsentSnapshot, type RevertPreview } from './db/revert.ts'
import { cleanSnapshots, interleaveSnapshots, listSnapshots, parseSnapshotName, snapshotFile, snapshotLastGroup, type SnapshotNotice, type SnapshotPoint } from './db/snapshots.ts'
import { previewSnapshot, snapshotToken, type SnapshotPreview } from './db/snapshotPreview.ts'
import { releaseStepsOf } from './db/releaseSteps.ts'
import { sql } from 'drizzle-orm'
import { reconcileFiles, trashKeep } from './db/fileRefs.ts'
import { cleanTrash, moveToTrash } from './trash.ts'
import { DRY_RUN_ROUTES, routeSentence } from './journalRoutes.ts'
import { forgetUpload, placeUpload, recordIfMissing, recordUpload, rowOf, uploadRows, type Placement, type UploadRow } from './db/uploads.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(express.json())

// Die laufende Anfrage, für das Änderungsjournal (#318): `writeData` nimmt daraus Route und Satz
// der Gruppe. Gesetzt nach `express.json()`. Nach multer noch einmal, als **Sicherung**: Unter Node
// behält multer den Kontext nachgemessen (Durchsicht von PR #430, K2, der Test mit einem Beleg bleibt
// ohne die zweite Stelle grün), aber es ruft `next` aus dem Strom der Anfrage, und ob das in jeder
// Fassung und unter Bun so bleibt, sagt niemand zu.
const requestScope = new AsyncLocalStorage<Request>()
const inRequest = (req: Request, _res: Response, next: NextFunction): void => requestScope.run(req, next)
// Die Kennung je Anfrage an ihren Gruppen (#318, Schritt 4): Schreibt eine Anfrage mehrmals (Beleg hochladen, KI
// auswerten, Auswertung speichern) und eine andere dazwischen, zeigt der Verlauf trotzdem einen Eintrag.
const requestIds = new WeakMap<Request, string>()
const requestIdOf = (req: Request): string => {
  let id = requestIds.get(req)
  if (!id) {
    id = newId()
    requestIds.set(req, id)
  }
  return id
}
app.use(inRequest)

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
// Ein hochgeladener Beleg, wie die Routen ihn weiterreichen. Name und Pfad nimmt `storedUpload` nicht
// ungeprüft von multer, sondern bildet den Pfad aus dem Namen im Belegordner neu (siehe dort).
type StoredUpload = { path: string, filename: string, originalname: string, mimetype: string, size: number }

// Den Namen vergibt diskStore selbst (Zeitstempel, Filter ohne Schrägstriche), und `destination` ist fest
// der Belegordner; ein Ausbruch ist also heute nicht möglich. Trotzdem wird der Pfad hier aus dem Namen neu
// gebildet und nur ein reiner Dateiname angenommen: So hängt jeder Zugriff auf die Platte an dieser einen
// Prüfung und nicht daran, dass multer und der Filter oben so bleiben (CodeQL js/path-injection). Ein Name,
// der keiner ist, ergibt `null`, als wäre nichts hochgeladen.
function storedUpload(file: Express.Multer.File | undefined): StoredUpload | null {
  if (!file) return null
  const name = path.basename(file.filename)
  if (name !== file.filename || name === '' || name === '.' || name === '..') return null
  return { path: path.join(UPLOAD_DIR, name), filename: name, originalname: file.originalname, mimetype: file.mimetype, size: file.size }
}

const checkPageSizes = (req: Request, res: Response, next: NextFunction): void => {
  if (!(filesOf(req).pages ?? []).some((p) => p.size > PAGE_MAX_BYTES)) return next()
  // Der Beleg liegt da schon auf der Platte: wieder entfernen, sonst bliebe ein Rest im Archiv
  const file = storedUpload(filesOf(req).file?.[0])
  if (file) fs.rmSync(file.path, { force: true })
  res.status(400).json({ error: 'Ein Seitenbild ist größer als 5 MB.' })
}
const fileWithPages = [upload.fields([{ name: 'file', maxCount: 1 }, { name: 'pages', maxCount: MAX_PAGES }]), checkPageSizes, inRequest]
const uploadedFile = (req: Request): StoredUpload | null => storedUpload(filesOf(req).file?.[0])

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
    // Die IBAN des Vermieters nur, wenn sie neu gesetzt oder geändert wird (#279, siehe iban.ts).
    if (Object.hasOwn(changes, 'iban')) changes.iban = acceptIban(changes.iban, storedSettings.iban, IBAN_LABELS.settings) ?? ''
    // Teil 2 von #415: Anschrift und Kontakt als Zeile, die Schalter des Drucks als ja/nein. Eine Angabe anderer Art
    // ist eine 400, statt still in eine Spalte zu geraten.
    for (const [key, label] of [['landlordAddress', 'Die Anschrift des Vermieters'], ['landlordContact', 'Der Kontakt des Vermieters']] as const) {
      if (Object.hasOwn(changes, key)) changes[key] = nullableLine(changes[key], label) ?? ''
    }
    for (const [key, label] of [['printLetter', '„Anschreiben mitdrucken“'], ['printFooter', '„Fußzeile mit Kontakt und Bank“']] as const) {
      if (Object.hasOwn(changes, key) && changes[key] !== null && typeof changes[key] !== 'boolean') throw new LetterInputError(`${label} ist ja oder nein.`)
    }
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
// Ein Schreibvorgang aus einer Anfrage bildet eine Gruppe im Änderungsjournal, mit dem Satz ihrer
// Route (journalRoutes.ts); Schreibvorgänge ohne Anfrage (Systemarbeit) werden nicht erfasst.
// **Erfasst wird nur, was eine Route mit Satz schreibt** (Durchsicht von PR #430, S1). Eine Lese-Route,
// die im Hintergrund etwas nachträgt (GET /api/uploads startet `backfillUploads`), erbt den Kontext
// ihrer Anfrage; ohne diese Regel entstünde dort eine Gruppe „Änderung (GET …)“. Fehlt einer
// schreibenden Route der Satz, steht das auf der Konsole, und api-journal.test.ts liest die Ausgabe.
const journalMeta = (): JournalMeta | undefined => {
  const req = requestScope.getStore()
  if (!req || req.method === 'GET') return undefined
  const routePath: unknown = req.route?.path
  const route = typeof routePath === 'string' ? routePath : req.path
  if (DRY_RUN_ROUTES.has(`${req.method} ${route}`)) return undefined
  const sentence = routeSentence(req.method, route)
  if (!sentence) {
    console.error(`Änderungsjournal: Die Route ${req.method} ${route} hat keinen Satz und wird nicht erfasst (journalRoutes.ts).`)
    return undefined
  }
  return { method: req.method, route, description: sentence.text, subjectTable: sentence.table, scope: req, requestId: requestIdOf(req) }
}
const writeData = <T>(work: (db: Database) => Promise<T>): Promise<T> => onDatabase((opened) => opened.write(work, journalMeta()))

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
// Ein neu gesetzter oder geänderter Beleg an einer Kostenposition muss im Belegordner liegen (Durchsicht von PR #439, K2;
// Muster wie bei der IBAN): Sonst verwiese die Position auf eine Datei, die ein Rücksprung oder ein Abbruch gerade
// weggelegt hat. Ein unveränderter alter Verweis hindert das Speichern nicht.
function requireInvoiceFile(body: Record<string, unknown>, current: string | null | undefined): void {
  const sent = body.invoiceFile
  if (typeof sent !== 'string' || sent === '' || sent === current) return
  const name = path.basename(sent)
  if (name !== sent || !fs.existsSync(path.join(UPLOAD_DIR, name)) || !fs.statSync(path.join(UPLOAD_DIR, name)).isFile()) {
    throw new RouteProblem(400, `Den Beleg „${sent}“ gibt es im Belegordner nicht (mehr). Bitte wählen Sie ihn neu oder laden Sie ihn hoch.`)
  }
}
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
    if (coll === 'costItems') requireInvoiceFile(body, undefined)
    res.status(201).json(await writeData(async (db) => {
      const withProperty = ROOTS.includes(coll) ? { ...body, propertyId: await propertyOf(db, req, true) } : body
      return coll === 'readings' ? createReading(db, newId(), withProperty) : createEntity(db, coll, newId(), withProperty)
    }))
  })
  app.put(`/api/${coll}/:id`, async (req, res) => {
    const item = await writeData(async (db) => {
      if (coll === 'costItems') {
        const current = await findEntity(db, 'costItems', req.params.id)
        requireInvoiceFile(bodyObject(req), current && 'invoiceFile' in current ? current.invoiceFile : undefined)
      }
      return updateEntity(db, coll, req.params.id, bodyObject(req))
    })
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
  // Logo und Briefpapier einer eigenen Gestaltung gehen mit dem Objekt (#415, Teil 2b), soweit niemand sonst sie nennt.
  const result = await writeData(async (db) => {
    const own = await readPropertyDesign(db, req.params.id)
    const removed = await removeProperty(db, req.params.id)
    if (removed.removed && own) await removeUnreferenced(DATA_DIR, letterDesignFiles(own), await referencedDesignFiles(db))
    return removed
  })
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
// Betriebsstrom und Abzug beim Allgemeinstrom gemeinsam anlegen (Heizung PR 15, #212).
app.post('/api/heating-plants/:id/operating-power', async (req, res) => {
  let booked: Awaited<ReturnType<typeof bookOperatingPower>>
  try {
    booked = await writeData((db) => bookOperatingPower(db, req.params.id, bodyObject(req), newId))
  } catch (err) {
    // Nachprüfung von #252, G2-H1: die Rückfrage mit eigenem Kennzeichen.
    if (err instanceof OperatingPowerQuestion) return res.status(409).json({ error: err.message, question: 'despiteExisting' })
    throw err
  }
  if (!booked) return res.status(404).json({ error: 'Diese Heizanlage gibt es nicht (mehr). Bitte laden Sie die Seite neu.' })
  res.status(201).json(booked)
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

// Monatliche Verbrauchsinformation (Heizung PR 22, § 6a Abs. 1 Nr. 2, Abs. 2 HeizkostenV): die Monate einer
// Heizperiode je Mieter, und je Anlage und Monat Vergleichswert und Tag der Mitteilung (db/monthlyInfo.ts).
app.get('/api/heating-plants/:id/periods/:period/monthly-info', async (req, res) => {
  const view = await readData((db) => monthlyInfoView(db, req.params.id, req.params.period, today()))
  if (!view) return res.status(404).json({ error: NO_PLANT })
  res.json(view)
})
// Die mittlere Warmwassertemperatur bei getrenntem Warmwasser, für die Umrechnung in der Verbrauchsinformation.
app.put('/api/heating-plants/:id/periods/:period/dhw-temperature', async (req, res) => {
  const saved = await writeData((db) => saveDhwTemperature(db, req.params.id, req.params.period, bodyObject(req)))
  if (!saved) return res.status(404).json({ error: NO_PLANT })
  res.json(saved)
})
app.put('/api/heating-plants/:id/monthly-info/:month', async (req, res) => {
  const saved = await writeData((db) => saveMonthlyInfoRow(db, req.params.id, req.params.month, bodyObject(req), today()))
  if (!saved) return res.status(404).json({ error: NO_PLANT })
  res.json(saved)
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

// ---------- CO₂-Erstattung an Mieter, die selbst heizen (Heizung PR 19, #97) ----------
// Das Objekt ergibt sich beim Schreiben aus dem Mietverhältnis; gelistet wird je Objekt. Die Prüfungen stehen in
// db/co2Refunds.ts; HeatingError und PeriodError gibt die Fehlerbehandlung mit ihrem Status weiter.
const NO_REFUND = 'Diese Erstattung gibt es nicht (mehr). Bitte laden Sie die Seite neu.'
app.get('/api/co2-refunds', async (req, res) => {
  res.json(await readData(async (db) => listRefunds(db, await propertyOf(db, req))))
})
app.post('/api/co2-refunds', async (req, res) => {
  res.status(201).json(await writeData((db) => createRefund(db, newId(), bodyObject(req))))
})
app.put('/api/co2-refunds/:id', async (req, res) => {
  const r = await writeData((db) => updateRefund(db, req.params.id, bodyObject(req)))
  if (!r) return res.status(404).json({ error: NO_REFUND })
  res.json(r)
})
app.delete('/api/co2-refunds/:id', async (req, res) => {
  const removed = await writeData((db) => removeRefund(db, req.params.id))
  if (!removed) return res.status(404).json({ error: NO_REFUND })
  res.json({ ok: true })
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
    const property = stock.properties.find((p) => p.id === ctx.plant.propertyId)
    // Dieselben Daten und dieselbe Bestandsrechnung wie die Abrechnung (Nachprüfung von #246, O2a/O2b).
    return co2SheetFor(stock, ctx.plant.propertyId, ctx.plant.id, h, today(), {
      propertyName: property?.name ?? '', address: property?.address ?? '', landlordName: property?.landlordName ?? stock.settings.landlordName,
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
// #251: Eine Gutschrift ohne Rechnung der Lieferung zuordnen, die sie berichtigt (Antwort „Sie berichtigt eine andere
// Lieferung“); 409, solange eine der beiden Heizperioden abgeschlossen ist.
app.post('/api/fuel-deliveries/:id/reassign-credit', async (req, res) => {
  const result = await writeData((db) => reassignCredit(db, req.params.id, bodyObject(req)))
  if (!result) return res.status(404).json({ error: NO_DELIVERY })
  res.json(result)
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
    const letters = frozenLetters(stand)
    return res.json({ selfUsedShareCents: 0, ...stand, ...frame, closed: { closedAt: closed.closedAt, sentAt: closed.sentAt }, deviation, letters })
  }
  const computed = computeHeating(stock, target.plant, target.period)
  res.json({ ...computed, closed: null, letters: await readData((db) => openLetters(db, computed, { propertyId: target.plant.propertyId, plantId: target.plant.id, period: target.period.key })) })
})

app.post('/api/heating-settlement/:plant/:period/close', async (req, res) => {
  const sentAt = sentAtOf(req)
  if (sentAt === false) return res.status(400).json({ error: SENT_AT_INVALID })
  const answer = fuelAnswerOf(req)
  if (answer === false) return res.status(400).json({ error: FUEL_ANSWER_INVALID })
  const despiteErrors = despiteErrorsOf(req)
  if (despiteErrors === false) return res.status(400).json({ error: DESPITE_ERRORS_INVALID })
  // Rechnen und Einfrieren im selben Vorgang, wie bei der Abrechnung des Objekts.
  const ergebnis = await writeData(async (db) => {
    const target = await heatingTargetOf(db, req)
    const label = periodLabel(target.period)
    if (await findClosedHeatingSettlement(db, target.plant.id, target.period.key)) return { schonDa: true, label, question: null }
    const question = await closeWithFuel(
      db,
      answer,
      despiteErrors,
      async (tx) => computeHeating(await readStock(tx), target.plant, target.period),
      async (tx, settlement) => closeHeatingSettlement(tx, {
        id: newId(), plantId: target.plant.id, period: target.period.key, closedAt: new Date().toISOString(), sentAt,
        settlement: { ...settlement, letters: await openLetters(tx, settlement, { propertyId: target.plant.propertyId, plantId: target.plant.id, period: target.period.key }) },
      }),
    )
    return { schonDa: false, label, question }
  })
  if (ergebnis.schonDa) return res.status(409).json({ error: `Die Heizkostenabrechnung ${ergebnis.label} ist bereits abgeschlossen.` })
  if (ergebnis.question) return res.status(409).json(closeQuestionBody(ergebnis.question))
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
    const letters = frozenLetters(stand)
    return res.json({ selfUsedShareCents: 0, ...stand, ...frame, closed: { closedAt: closed.closedAt, sentAt: closed.sentAt }, deviation, letters })
  }
  const computed = computeSettlement(snapshotFor(stock, property, period), { asOf: today() })
  res.json({ ...computed, closed: null, letters: await readData((db) => openLetters(db, computed, { propertyId: property, period: period.key })) })
})

// Export der Abrechnung als Daten (#415, Teil 3): JSON (Cent) oder CSV der Zeilen je Mieter, mit den Zahlen, die
// auch gedruckt werden; bei abgeschlossener Abrechnung der eingefrorene Stand. Aufbau in settlementExport.ts.
app.get('/api/settlement/:period/export', async (req, res) => {
  const format: unknown = req.query.format
  if (format !== 'json' && format !== 'csv') return res.status(400).json({ error: 'Das Format ist „json“ oder „csv“ (Angabe format).' })
  const { closed, stock, property, period, propertyName } = await readData(async (db) => {
    const property = await propertyOf(db, req)
    const period = await periodOf(db, req, property)
    const propertyName = (await listProperties(db)).find((p) => p.id === property)?.name ?? ''
    return { property, period, propertyName, closed: await findClosedSettlement(db, property, period.key), stock: await readStock(db) }
  })
  const frame = { period: settlementPeriod(period), deadline: settlementDeadline(period) }
  let data: ExportableSettlement
  if (closed) {
    // Nur der eingefrorene Stand und der Rahmen, wie GET /api/settlement/:period; nichts wird neu gerechnet.
    const stand = frozenExportable(closed.settlement)
    if (!stand) return res.status(409).json({ error: 'Der eingefrorene Stand dieser Abrechnung lässt sich nicht als Daten ausgeben. Öffnen Sie die Abrechnung wieder und schließen Sie sie neu ab.' })
    data = { ...stand, ...frame, closed: { closedAt: closed.closedAt, sentAt: closed.sentAt } }
  } else {
    const computed = computeSettlement(snapshotFor(stock, property, period), { asOf: today() })
    data = { ...computed, closed: null, letters: await readData((db) => openLetters(db, computed, { propertyId: property, period: period.key })) }
  }
  res.attachment(exportFilename(propertyName, frame.period.label, format))
  if (format === 'csv') return res.type('text/csv; charset=utf-8').send(settlementExportCsv(data))
  res.json(settlementExportJson(data, { id: property, name: propertyName }))
})

// ---------- Anschreiben (#415) ----------

// Das Anschreiben einer offenen Abrechnung: mit den Texten aller Ebenen und den Anpassungen je Mieter.
// Dasselbe friert der Abschluss ein (im selben Vorgang wie die Zahlen).
// Der Schlüssel der Anpassungen je Mieter entsteht hier und nur hier (`letterDoc`): Der Export las sie einmal unter dem
// nackten Zeitraum und lieferte die Vorgabe statt der Wahl des Mieters (Durchsicht zu #317).
async function openLetters(db: Executor, s: Parameters<typeof lettersOf>[0], target: { propertyId: string, period: string, plantId?: string }): Promise<Record<string, StatementLetter>> {
  const { propertyId } = target
  const doc = target.plantId === undefined ? letterDoc(target.period, { propertyId }) : letterDoc(target.period, { plantId: target.plantId })
  const property = (await listProperties(db)).find((p) => p.id === propertyId) ?? null
  // #317: Der Monat der Anpassung ist ohne eigene Angabe der übernächste nach heute; der Abschluss friert ihn ein.
  // Druck (#415): Wohnfläche und Lohnanteile nach § 35a EStG für den Kopf und die Tabelle der Aufstellung, eingefroren mit dem Anschreiben.
  return lettersFor(db, s, { settings: storedSettings, property, tenancies: await readTenancies(db), units: await readUnits(db), costItems: await readCostItems(db), doc, asOf: today() })
}

// Das Anschreiben einer abgeschlossenen Abrechnung ist das eingefrorene. Wurde sie vor #415
// abgeschlossen, hat sie keines, und es entsteht auch keines (Durchsicht S1): Was zugestellt wurde,
// ändert eine Programmänderung nicht rückwirkend. Die Seite druckt sie dann im bisherigen Aufbau.
function frozenLetters(stand: object): unknown {
  const own: unknown = Reflect.get(stand, 'letters')
  return own !== null && typeof own === 'object' ? own : undefined
}

const lettersBody = (req: Request) => {
  const body = bodyObject(req)
  const texts = parseLetterTexts(body.texts ?? {})
  if ('error' in texts) throw new RouteProblem(400, texts.error)
  return { body, texts: texts.texts }
}

app.get('/api/letter-texts', async (req, res) => {
  const result: LetterTemplates = await readData(async (db) => {
    const wanted: unknown = req.query.property
    const property = typeof wanted === 'string' && wanted !== '' ? await propertyOf(db, req) : null
    return {
      defaults: DEFAULT_LETTER_TEXTS,
      installation: await readInstallationLetterTexts(db),
      property: property === null ? null : await readPropertyLetterTexts(db, property),
      adjustDefault: storedSettings.printAdjustSuggestion === false ? 'none' : 'suggestion',
      // Teil 2: „Anschreiben mitdrucken“ der Installation (ohne Angabe ja) und am Objekt (`null`: wie die Vorgabe).
      printLetter: storedSettings.printLetter ?? true,
      propertyPrintLetter: property === null ? null : (await listProperties(db)).find((p) => p.id === property)?.printLetter ?? null,
    }
  })
  res.json(result)
})

// Die Vorlage der Installation, dazu die Vorgabe für die Anpassung der Vorauszahlung (früher der
// Schalter „Neue Vorauszahlung vorschlagen“, `printAdjustSuggestion`). Erst wird alles geprüft.
app.put('/api/letter-texts', async (req, res) => {
  const { body, texts } = lettersBody(req)
  const adjust: unknown = body.adjustDefault
  if (adjust !== undefined && adjust !== 'none' && adjust !== 'suggestion') return res.status(400).json({ error: 'Die Vorgabe für die Anpassung der Vorauszahlung ist „keine“ oder „Vorschlag“.' })
  // Teil 2: „Anschreiben mitdrucken“ als Vorgabe der Installation; hier gibt es kein „wie die Vorgabe“.
  const printLetter: unknown = body.printLetter
  if (printLetter !== undefined && typeof printLetter !== 'boolean') return res.status(400).json({ error: '„Anschreiben mitdrucken“ ist ja oder nein.' })
  // Texte und Vorgabe in einer Transaktion: Scheitert eines, bleibt beides beim Alten (Durchsicht K7).
  const next = adjust === undefined && printLetter === undefined ? null : {
    ...structuredClone(storedSettings),
    ...(adjust === undefined ? {} : { printAdjustSuggestion: adjust === 'suggestion' }),
    ...(printLetter === undefined ? {} : { printLetter }),
  }
  await writeData((db) => db.transaction(async (tx) => {
    await saveInstallationLetterTexts(tx, texts)
    if (next) await writeSettingsIn(tx, next)
  }))
  if (next) await refreshSettings()
  res.json({ ok: true })
})

app.put('/api/properties/:id/letter-texts', async (req, res) => {
  const { body, texts } = lettersBody(req)
  // Teil 2: „Anschreiben mitdrucken“ am Objekt, `null` heißt „wie die Vorgabe“; mit den Texten in einer Transaktion.
  const printLetter = Object.hasOwn(body, 'printLetter') ? nullableBoolean(body.printLetter, '„Anschreiben mitdrucken“') : undefined
  await writeData((db) => db.transaction(async (tx) => {
    if (!(await listProperties(tx)).some((p) => p.id === req.params.id)) throw new RouteProblem(404, 'Dieses Objekt gibt es nicht (mehr). Bitte laden Sie die Seite neu.')
    await savePropertyLetterTexts(tx, req.params.id, texts)
    if (printLetter !== undefined) await savePropertyPrintLetter(tx, req.params.id, printLetter)
  }))
  res.json({ ok: true })
})

// ---------- Logo und Briefpapier (#415, Teil 2b) ----------
// Die Gestaltung des Drucks: Vorgabe der Installation, je Objekt eine eigene. Die Dateien liegen in `briefpapier/` im
// Datenordner unter Namen, die der Server vergibt (letterDesign.ts); ausgeliefert wird nur, was eine Gestaltung nennt.
app.get('/api/letter-design', async (req, res) => {
  const result: LetterDesigns = await readData(async (db) => {
    const wanted: unknown = req.query.property
    const property = typeof wanted === 'string' && wanted !== '' ? await propertyOf(db, req) : null
    const missing = new Set<string>()
    const own = property === null ? null : await readPropertyDesign(db, property)
    return {
      installation: presentDesign(DATA_DIR, await readInstallationDesign(db), missing),
      property: own === null ? null : presentDesign(DATA_DIR, own, missing),
      ...(missing.size > 0 ? { missing: [...missing] } : {}),
    }
  })
  res.json(result)
})

app.get('/api/letter-design/files/:name', async (req, res) => {
  const full = designFilePath(DATA_DIR, req.params.name, await readData((db) => referencedDesignFiles(db)))
  const type = full ? designFileType(path.basename(full)) : null
  // Gelesen wird vor dem Antworten; verschwindet die Datei dazwischen, ist das ein 404 und kein Serverfehler (Durchsicht K4).
  let data: Buffer | null = null
  try {
    data = full && type ? fs.readFileSync(full) : null
  } catch {
    data = null
  }
  if (!data || !type) return res.status(404).json({ error: 'Diese Datei gibt es nicht (mehr).' })
  res.set({
    'Content-Type': MIME_TYPES[type],
    'X-Content-Type-Options': 'nosniff',
    // Gespeichert sind nur PNG, JPG und PDF (kein SVG); die Sperre für Skripte gilt trotzdem, falls jemand die Datei öffnet.
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
    // Der Name ändert sich mit jeder neuen Datei.
    'Cache-Control': 'private, max-age=31536000, immutable',
  })
  res.send(data)
})

const designUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: LETTER_DESIGN_LIMITS.paper, files: 3 } })
const designFields = designUpload.fields([{ name: 'logo', maxCount: 1 }, { name: 'paper', maxCount: 1 }, { name: 'paperNextFile', maxCount: 1 }])

// Schreibt die neuen Dateien, dann die Zeile in einer Transaktion; danach geht weg, was niemand mehr nennt. Scheitert
// die Transaktion, gehen die eben geschriebenen Dateien wieder weg.
async function saveLetterDesign(req: Request, propertyId: string | null): Promise<void> {
  const body = bodyObject(req)
  const request = parseDesignRequest(body.design, propertyId !== null)
  const files = filesOf(req)
  const prepared = prepareDesignFiles(request, { logo: files.logo?.[0], paper: files.paper?.[0], paperNextFile: files.paperNextFile?.[0] }, newId)
  await writeData(async (db) => {
    const written = prepared.map((p) => p.file.file)
    const candidates: string[] = [...written]
    writeDesignFiles(DATA_DIR, prepared)
    try {
      await db.transaction(async (tx) => {
        if (propertyId !== null && !(await listProperties(tx)).some((p) => p.id === propertyId)) throw new RouteProblem(404, 'Dieses Objekt gibt es nicht (mehr). Bitte laden Sie die Seite neu.')
        const installation = await readInstallationDesign(tx)
        const current = propertyId === null ? installation : await readPropertyDesign(tx, propertyId)
        if (current) candidates.push(...letterDesignFiles(current))
        if (propertyId !== null && request.own === false) return savePropertyDesign(tx, propertyId, null)
        const next = nextDesign(current ?? installation, request, prepared)
        if (propertyId === null) await saveInstallationDesign(tx, next)
        else await savePropertyDesign(tx, propertyId, next)
      })
    } catch (err) {
      await removeUnreferenced(DATA_DIR, written, new Set(), false)
      throw err
    }
    await removeUnreferenced(DATA_DIR, candidates, await referencedDesignFiles(db))
  })
}

app.put('/api/letter-design', designFields, inRequest, async (req, res) => {
  await saveLetterDesign(req, null)
  res.json({ ok: true })
})
app.put('/api/properties/:id/letter-design', designFields, inRequest, async (req, res) => {
  await saveLetterDesign(req, String(req.params.id))
  res.json({ ok: true })
})

// Die einmalige Anpassung je Mieter beim Drucken (#415). Sie gilt für diese Abrechnung und wird
// gespeichert, solange sie offen ist: Druckt der Vermieter, ändert dann den Text und schließt ab,
// fröre sonst ein anderer Text ein als der, der beim Mieter liegt. Mit dem Abschluss friert der
// gedruckte Text ein; danach ist hier nichts mehr zu ändern (409).
async function letterTarget(db: Database, req: Request): Promise<{ doc: string, closed: boolean, tenancyIds: string[], periodTo: string }> {
  const plantId: unknown = req.params.plant
  const unitProperty = new Map((await readUnits(db)).map((u) => [u.id, u.propertyId]))
  const tenancies = await readTenancies(db)
  const tenanciesOf = (propertyId: string) => tenancies.filter((t) => unitProperty.get(t.unitId) === propertyId).map((t) => t.id)
  if (typeof plantId === 'string') {
    const target = await heatingTargetOf(db, req)
    const closed = !!(await findClosedHeatingSettlement(db, target.plant.id, target.period.key))
    return { doc: letterDoc(target.period.key, { plantId: target.plant.id }), closed, tenancyIds: tenanciesOf(target.plant.propertyId), periodTo: target.period.to }
  }
  const propertyId = await propertyOf(db, req)
  const period = await periodOf(db, req, propertyId)
  const closed = !!(await findClosedSettlement(db, propertyId, period.key))
  return { doc: letterDoc(period.key, { propertyId }), closed, tenancyIds: tenanciesOf(propertyId), periodTo: period.to }
}

const tenancyLettersRoute = async (req: Request, res: Response) => {
  res.json(await readData(async (db) => {
    const t = await letterTarget(db, req)
    return readTenancyLetters(db, t.doc, t.tenancyIds)
  }))
}
const saveTenancyLetterRoute = async (req: Request, res: Response) => {
  const { body, texts } = lettersBody(req)
  const adjustment = parseLetterAdjustment(body.adjustment)
  if (adjustment !== null && 'error' in adjustment) return res.status(400).json({ error: adjustment.error })
  await writeData(async (db) => {
    const t = await letterTarget(db, req)
    const tenancyId = String(req.params.tenancyId ?? '')
    if (!t.tenancyIds.includes(tenancyId)) throw new RouteProblem(404, 'Dieses Mietverhältnis gehört nicht zu diesem Objekt oder gibt es nicht (mehr). Bitte laden Sie die Seite neu.')
    if (t.closed) throw new RouteProblem(409, 'Die Abrechnung ist abgeschlossen; ihr Anschreiben ist eingefroren. Öffnen Sie sie wieder, um es zu ändern.')
    // Durchsicht zu PR #435, M1: Der Monat der Anpassung liegt nach dem abgerechneten Zeitraum (#317).
    const from = adjustment !== null && 'mode' in adjustment ? adjustment.from ?? null : null
    const problem = from === null ? null : stepMonthProblem(from, t.periodTo)
    if (problem) throw new RouteProblem(400, problem)
    await saveTenancyLetter(db, tenancyId, t.doc, texts, Object.hasOwn(body, 'adjustment') ? adjustment : undefined)
  })
  res.json({ ok: true })
}
app.get('/api/settlement/:period/letters', tenancyLettersRoute)
app.put('/api/settlement/:period/letters/:tenancyId', saveTenancyLetterRoute)
app.get('/api/heating-settlement/:plant/:period/letters', tenancyLettersRoute)
app.put('/api/heating-settlement/:plant/:period/letters/:tenancyId', saveTenancyLetterRoute)

// ---------- Anpassung in die Staffel übernehmen (#317) ----------

// Was das eingefrorene Anschreiben ankündigt, je Mieter: Betrag und Monat (vor #317 ohne Monat). Eine vor #415
// abgeschlossene Abrechnung hat kein Anschreiben und damit nichts zu übernehmen.
function frozenStepLetters(stand: object): StepLetter[] {
  const letters: unknown = Reflect.get(stand, 'letters')
  const statements: unknown = Reflect.get(stand, 'statements')
  if (letters === null || typeof letters !== 'object' || !Array.isArray(statements)) return []
  return statements.flatMap((st: unknown): StepLetter[] => {
    if (st === null || typeof st !== 'object') return []
    const tenancyId: unknown = Reflect.get(st, 'tenancyId')
    const letter: unknown = typeof tenancyId === 'string' ? Reflect.get(letters, tenancyId) : undefined
    const adjustment: unknown = letter !== null && typeof letter === 'object' ? Reflect.get(letter, 'adjustment') : undefined
    const cents: unknown = adjustment !== null && typeof adjustment === 'object' ? Reflect.get(adjustment, 'newCents') : undefined
    if (typeof tenancyId !== 'string' || typeof cents !== 'number' || adjustment === null || typeof adjustment !== 'object') return []
    const from: unknown = Reflect.get(adjustment, 'from')
    const text = (key: string): string => { const v: unknown = Reflect.get(st, key); return typeof v === 'string' ? v : '' }
    return [{ tenancyId, tenantName: text('tenantName'), unitName: text('unitName'), cents, from: isMonthKey(from) ? from : null }]
  })
}

function frozenErrors(stand: object): string[] {
  const notices: unknown = Reflect.get(stand, 'notices')
  return Array.isArray(notices) ? blockingErrors(notices.filter((n): n is Notice => n !== null && typeof n === 'object' && typeof Reflect.get(n, 'level') === 'string')).map((n) => n.title) : []
}

// Die geänderten Monate aus dem Rumpf, geprüft: JJJJ-MM und nach dem abgerechneten Zeitraum.
function stepMonthsOf(req: Request, periodTo: string): Record<string, string> {
  const raw: unknown = bodyObject(req).months ?? {}
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new RouteProblem(400, 'Die Monate der Übernahme sind keine gültige Angabe.')
  const out: Record<string, string> = {}
  for (const [id, month] of Object.entries(raw)) {
    const problem = stepMonthProblem(month, periodTo)
    if (problem) throw new RouteProblem(400, problem)
    if (typeof month === 'string') out[id] = month
  }
  return out
}

async function stepInputOf(db: Database, req: Request): Promise<StepInput> {
  const plantId: unknown = req.params.plant
  let closed: { closedAt: string, sentAt: string | null, settlement: unknown } | null
  let periodTo: string
  let scope: StepInput['scope']
  let heatingSeparateAt: StepInput['heatingSeparateAt']
  if (typeof plantId === 'string') {
    const target = await heatingTargetOf(db, req)
    closed = (await findClosedHeatingSettlement(db, target.plant.id, target.period.key)) ?? null
    periodTo = target.period.to
    scope = 'heating'
  } else {
    const property = await propertyOf(db, req)
    const period = await periodOf(db, req, property)
    closed = (await findClosedSettlement(db, property, period.key)) ?? null
    periodTo = period.to
    scope = 'all'
    // Integrationsdurchsicht 0.13.0 (#435): ob die Heizung im Monat der neuen Stufe noch getrennt abgerechnet wird.
    const rules = rulesOf((await listProperties(db)).find((p) => p.id === property))
    const plants = (await readHeatingPlants(db)).filter((p) => p.propertyId === property)
    heatingSeparateAt = (month) => plants.some((p) => separateOwner(p, rules, month) !== null)
  }
  if (!closed) throw new RouteProblem(409, 'Die Abrechnung ist nicht abgeschlossen. Übernommen wird die Anpassung, die das abgeschlossene Anschreiben ankündigt.')
  const stand = closed.settlement !== null && typeof closed.settlement === 'object' ? closed.settlement : {}
  const separateHeating: unknown = Reflect.get(stand, 'separateHeating')
  const without: unknown = Reflect.get(stand, 'suggestionWithoutHeating')
  return {
    scope,
    // Integrationsdurchsicht 0.13.0 (#435): Endet in P eine getrennt abgerechnete Heizperiode, ist der Vorschlag ohne ihre
    // Heizung, auch wenn ein vorher eingefrorener Stand `suggestionWithoutHeating: false` trägt (Weg d endete nach P).
    separate: scope === 'all' && (without === true || (Array.isArray(separateHeating) && separateHeating.length > 0)),
    heatingSeparateAt,
    periodTo,
    closedAt: closed.closedAt,
    sentAt: closed.sentAt,
    today: today(),
    errors: frozenErrors(stand),
    letters: frozenStepLetters(stand),
    tenancies: await readTenancies(db),
    months: stepMonthsOf(req, periodTo),
  }
}

// Der Plan: je Mieter Staffel, Monat, Stand und was vorher zu fragen ist, mit Marke.
const stepPlanRoute = async (req: Request, res: Response) => {
  const plan = planPrepaymentSteps(await readData((db) => stepInputOf(db, req)))
  res.json({ ...plan, token: stepToken(plan) } satisfies PrepaymentStepPlan)
}
// Übernehmen: nur mit der Marke des Plans, den der Vermieter gesehen hat (Rückfragen zu Fehlern, vorhandenen Stufen und
// zum Monat stehen darin); sonst 409 mit dem neuen Plan. Alle gewählten Mieter in einer Transaktion.
const stepSaveRoute = async (req: Request, res: Response) => {
  const body = bodyObject(req)
  const chosen: unknown = body.tenancyIds
  if (!Array.isArray(chosen) || !chosen.every((x) => typeof x === 'string')) return res.status(400).json({ error: 'Bitte wählen Sie die Mieter, deren Anpassung übernommen wird.' })
  // Gelesen wird in derselben Schreibschlange wie geschrieben; dazwischen ändert niemand den Bestand.
  const result = await writeData(async (db) => {
    const input = await stepInputOf(db, req)
    const plan = planPrepaymentSteps(input)
    const token = stepToken(plan)
    if (body.token !== token) return { stale: { ...plan, token } }
    const writes = stepWrites(plan, input.tenancies, chosen)
    const all = await readTenancies(db)
    await db.transaction(async (tx) => {
      for (const w of writes) {
        const current = all.find((t) => t.id === w.tenancyId)
        if (current) await patchTenancyIn(tx, current, { [w.schedule]: w.entries })
      }
    })
    return { written: writes.map((w) => w.tenancyId) }
  })
  if ('stale' in result) return res.status(409).json({ error: 'Der Stand hat sich geändert. Bitte prüfen Sie die Übernahme noch einmal.', plan: result.stale })
  res.json({ ok: true, written: result.written })
}
app.post('/api/settlement/:period/prepayment-steps/plan', stepPlanRoute)
app.post('/api/settlement/:period/prepayment-steps', stepSaveRoute)
app.post('/api/heating-settlement/:plant/:period/prepayment-steps/plan', stepPlanRoute)
app.post('/api/heating-settlement/:plant/:period/prepayment-steps', stepSaveRoute)

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
const FUEL_ANSWER_INVALID = 'Die Antwort auf die Rückfrage zur Schätzung ist „estimate“ oder „none“.'
const FUEL_GAPS_TEXT =
  'Für einen Teil der Heizperiode fehlt eine Rechnung. Sie können abwarten, bis sie da ist, die Kosten mit Vorbehalt schätzen lassen oder ohne Schätzung abschließen; ohne Schätzung steht dieser Teil zunächst bei Ihnen.'
// Die Bestätigung, trotz Fehlern abzuschließen (#319): die Prüfmarke aus der Rückfrage (closeQuestion.ts).
// Fehlt sie, wie bei einem Tab von vor dem Update, fragt der Server nach; eine Marke, die nicht zum Stand
// passt, ebenso. Etwas anderes als eine Zeichenkette ist 400, auch `true`: Eine Bestätigung ohne Stand gibt es nicht.
const DESPITE_ERRORS_INVALID = 'Die Bestätigung „Trotzdem abschließen“ ist die Prüfmarke aus der Rückfrage oder fehlt.'
const despiteErrorsOf = (req: Request): string | null | false => {
  const value: unknown = bodyObject(req).despiteErrors
  if (value === undefined || value === null) return null
  return typeof value === 'string' ? value : false
}
const fuelAnswerOf = (req: Request): FuelAnswer | null | false => {
  const value: unknown = bodyObject(req).fuelEstimates
  if (value === undefined || value === null) return null
  return value === 'estimate' || value === 'none' ? value : false
}

// Abschließen samt Lieferungen (Heizung PR 7) und mit Rückfrage bei Fehlern (#319); der Ablauf und
// die Prüfmarke stehen in closeQuestion.ts. Die Berechnung liest den Bestand auf der Transaktion
// (`readStock` nimmt ein `Executor`), neu angelegte Schätzungen sind darin also schon sichtbar.
function closeWithFuel(
  db: Database,
  answer: FuelAnswer | null,
  despiteErrors: string | null,
  compute: (tx: Executor) => Promise<ComputedSettlement>,
  close: (tx: Executor, settlement: ComputedSettlement) => Promise<void>,
): Promise<CloseQuestion | null> {
  return closeWithQuestions((fn) => db.transaction(fn), answer, despiteErrors, {
    compute,
    gapsOf: fuelGapQuestions,
    noticesOf: (s) => s.notices,
    estimate: async (tx, s) => { await createEstimates(tx, s, newId) },
    close: async (tx, s) => {
      await close(tx, s)
      await freezeFuelCarries(tx, s)
    },
  })
}

// Die Rückfrage beim Abschließen als Antwort (409): `fuelGaps` nur bei einer Lücke ohne Antwort, sonst
// fragte ein Tab von vor #319 nach einer Schätzung, die es nicht gibt; `errorNotices` nur bei Fehlern.
// Ein solcher Tab kennt `errorNotices` nicht und zeigt den Text; der muss für sich verständlich sein.
function closeQuestionBody(q: CloseQuestion): { error: string } & CloseQuestion {
  const errors = q.errorNotices ?? []
  const titles = [...new Set(errors.map((n) => n.title || n.text))].join('; ')
  const errorText = errors.length === 0 ? '' :
    `Die Abrechnung enthält ${errors.length === 1 ? 'einen Fehler' : `${errors.length} Fehler`}: ${titles}. ` +
    'Beheben Sie die Angaben über „Hier beheben →“ auf der Seite Abrechnung, oder schließen Sie mit „Trotzdem abschließen“ ab. ' +
    'Erscheint diese Wahl nicht, laden Sie die Seite neu.'
  const text = [q.fuelGaps ? FUEL_GAPS_TEXT : '', errorText].filter((t) => t !== '').join(' ')
  return { error: text, ...q }
}

// Abrechnung abschließen: aktuellen Berechnungsstand einfrieren. Spätere Änderungen an
// Kosten/Stammdaten verändern eine bereits verschickte Abrechnung dann nicht mehr still.
// Mit Lieferungen fragt Mietfuchs bei einer Lücke nach (Heizung PR 7) und friert die Überträge mit ein.
app.post('/api/settlement/:period/close', async (req, res) => {
  const sentAt = sentAtOf(req)
  if (sentAt === false) return res.status(400).json({ error: SENT_AT_INVALID })
  const answer = fuelAnswerOf(req)
  if (answer === false) return res.status(400).json({ error: FUEL_ANSWER_INVALID })
  const despiteErrors = despiteErrorsOf(req)
  if (despiteErrors === false) return res.status(400).json({ error: DESPITE_ERRORS_INVALID })
  // Rechnen und Einfrieren im selben Vorgang: Käme dazwischen eine Änderung an einer
  // Kostenposition durch, fröre Mietfuchs einen Stand ein, den es so nie gegeben hat.
  const ergebnis = await writeData(async (db) => {
    const property = await propertyOf(db, req)
    const period = await periodOf(db, req, property)
    const label = periodLabel(period)
    if (await findClosedSettlement(db, property, period.key)) return { schonDa: true, label, question: null }
    const question = await closeWithFuel(
      db,
      answer,
      despiteErrors,
      async (tx) => computeSettlement(snapshotFor(await readStock(tx), property, period), { asOf: today() }),
      // Mit den Zahlen friert das Anschreiben ein (#415), wie die Seite es gerade zeigt.
      async (tx, settlement) => closeSettlement(tx, {
        id: newId(), propertyId: property, period: period.key, closedAt: new Date().toISOString(), sentAt,
        settlement: { ...settlement, letters: await openLetters(tx, settlement, { propertyId: property, period: period.key }) },
      }),
    )
    return { schonDa: false, label, question }
  })
  if (ergebnis.schonDa) return res.status(409).json({ error: `Abrechnung ${ergebnis.label} ist bereits abgeschlossen.` })
  if (ergebnis.question) return res.status(409).json(closeQuestionBody(ergebnis.question))
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
// einem Objekt mit anderem Rhythmus. Es liest keine Kostenposition, der Zeitraum dient nur dem Jahr. Die
// Abrechnungen des Objekts (Grenzen, Frist, Versand, eingefrorene Anrechnung) kommen für die Abrechnungsreife mit
// (#281 E5, ledgerStatements.ts); calc.ts liest den Speicher nicht selbst.
app.get('/api/rentledger/:year', async (req, res) => {
  const year = Number(req.params.year)
  if (!Number.isInteger(year)) return res.status(400).json({ error: 'Ungültiges Jahr' })
  res.json(await readData(async (db) => {
    const stock = await readStock(db)
    const property = await propertyOf(db, req)
    const span = calendarYearPeriod(year)
    const snapshot = snapshotFor(stock, property, span)
    const plantIds = new Set((snapshot.heatingPlants ?? []).map((p) => p.id))
    // Ausdrücklich als Abschlüsse der Datenbank gelesen (der Bestand führt sie zugleich als Quelle des Schnappschusses).
    const closedOfStock: readonly StoredClosedSettlement[] = stock.closedSettlements
    const closedHeatingOfStock: readonly StoredClosedHeatingSettlement[] = stock.closedHeatingSettlements
    const statements = ledgerStatementsFor(
      snapshot,
      closedOfStock.filter((c) => c.propertyId === property),
      closedHeatingOfStock.filter((c) => plantIds.has(c.plantId)),
      span.to,
    )
    return rentLedger(snapshot, { asOf: today(), statements })
  }))
})

// Steuer-Übersicht (Hilfe für die Anlage V) im Kalenderjahr: Einnahmen, Werbungskosten, Überschuss.
// Aus den Abrechnungen, die das Jahr berühren, nach dem Jahr der Zahlung (#208, #255);
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
async function recordNewUpload(req: Request, file: StoredUpload): Promise<void> {
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
async function recordOrRefuse(req: Request, res: Response, file: StoredUpload): Promise<boolean> {
  try {
    await recordNewUpload(req, file)
    return true
  } catch (err) {
    fs.rmSync(file.path, { force: true })
    res.status(statusOf(err)).json({ error: messageOf(err) })
    return false
  }
}

app.post('/api/upload', upload.single('file'), inRequest, async (req, res) => {
  const file = storedUpload(req.file)
  if (!file) return res.status(400).json({ error: 'Keine Datei' })
  if (!(await recordOrRefuse(req, res, file))) return
  res.json({ file: file.filename })
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
      // In den Papierkorb (#318): Die Zeile stand schon im Verlauf, ein Rücksprung soll die Datei finden.
      void moveToTrash(DATA_DIR, 'uploads', upload.filename).catch((err: unknown) => console.error(`Der abgebrochene Beleg ließ sich nicht in den Papierkorb legen: ${messageOf(err)}`))
      // Seine Angaben gehen mit (#170), ebenso eine Auswertung, die beim Abbruch gerade
      // gespeichert wurde; ein Beleg aus dem Posteingang ist nie `upload`. Im Kontext der ausgewerteten Anfrage, ob der
      // Abbruch über POST /api/ai/cancel/:id oder das Schließen der Verbindung kommt: Im Verlauf ist es ein Eintrag.
      void requestScope.run(req, () => writeData(async (db) => {
        await forgetAssessment(db, upload.filename)
        await forgetUpload(db, upload.filename)
      })).catch(() => undefined)
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

// Fehler mit Ausweg: Scheitert die KI, liegt der Beleg schon im Belegordner (neu hochgeladen mit Zeile in
// `uploads`, oder aus dem Posteingang); nur ein Abbruch nimmt ihn wieder weg, und der kommt hier nie an. Die
// Antwort sagt deshalb neben dem Satz den Grund (`reason`, aus ai/errors.ts) und dass er gespeichert ist; mit
// seinem Namen fragt ein neuer Versuch als `existingFile`, ohne eine Kopie anzulegen.
// `meterPhoto`: Der Schuhkarton hatte ein Zählerfoto erkannt und ist am Ablesen gescheitert; „Von Hand erfassen“
// führt dann zur Ablesung statt in den Belegordner.
function failureOf(file: DocumentSource, err: unknown, stats: AskStats[], { meterPhoto = false } = {}): AiFailure & { stats: AskStats[] } {
  const service = isProviderError(err) ? err.service : undefined
  const provider = isProviderError(err) ? err.provider : undefined
  return { file: file.filename, error: messageOf(err), reason: reasonOf(err), kept: true, ...(service ? { service } : {}), ...(provider ? { provider } : {}), ...(meterPhoto ? { meterPhoto: true as const } : {}), stats }
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
      await moveToTrash(DATA_DIR, 'uploads', fresh.filename).catch(() => undefined)
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

// Erkennt ein neuer Versuch (Fehler mit Ausweg, #487) eine Rechnung, wo der erste ein Zählerfoto sah und dann am
// Ablesen scheiterte, gehört der Beleg wieder in den Posteingang: Art „receipt“, Objekt und Jahr des Formulars.
// Nur bei einem als Zählerfoto gekennzeichneten Beleg; sonst bleibt seine Platzierung, wie sie ist.
async function unmarkMeterPhoto(req: Request, file: string): Promise<void> {
  const body = bodyObject(req)
  const year = yearOf(body.year)
  try {
    await writeData(async (db) => {
      const row = (await uploadRows(db)).get(file)
      if (row?.kind !== 'meterPhoto') return
      const propertyId = await placementProperty(db, body.propertyId).catch(() => null)
      await placeUpload(db, file, { kind: 'receipt', propertyId, year: year === false ? null : year }, () => null)
    })
  } catch (err) {
    console.warn(`Der Beleg ${file} ließ sich nicht wieder als Beleg kennzeichnen: ${messageOf(err)}`)
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

// Nur Rechnungen. Die Oberfläche nutzt die Route seit #490 nicht mehr (Schnellerfassung und Kosten werten über
// /api/intake aus); sie bleibt für Tabs aus älteren Fassungen und wird später entfernt.
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
    answer.fail(failureOf(file, err, stats))
  }
})

// Universeller Eingang (Schuhkarton): erkennt automatisch, ob die Datei eine Rechnung oder
// ein Zählerfoto ist, und liefert die passende KI-Auswertung. Antwort ist eine diskriminierte
// Union über `kind`. Schnellerfassung und Kosten werten beide hierüber aus (#490); für eine Rechnung antwortet die
// Route wie `/api/extract` (api-ki-beleg.test.ts). Ein Bild fragt vorher nach der Belegart, außer der Browser schickt
// `docType=rechnung` (Seite Kosten, „Als Rechnung auswerten“ an einem erkannten Zählerfoto).
app.post('/api/intake', fileWithPages, async (req: Request, res: Response) => {
  const file = await documentOf(req, res)
  if (!file) return
  const answer = aiResponse(req, res)
  const { signal, stats, onProgress } = answer
  let meterPhoto = false
  try {
    const settings = effectiveSettings()
    const material = { ...aiInput(req), signal, stats, onProgress }
    // Sagt der Browser, dass es eine Rechnung ist (Seite Kosten, „Als Rechnung auswerten“; #490), fragt der Server das
    // Modell nicht nach der Belegart: kein zusätzlicher Aufruf und keine Verwechslung mit einem Zählerfoto.
    const docType = bodyObject(req).docType === 'rechnung' ? 'rechnung' : await classifyDocType(file.path, file.mimetype, settings, { signal, stats, onProgress })
    if (docType === 'zaehlerstand') {
      // Ein Zählerfoto belegt keine Kosten: als solches kennzeichnen und ohne Objekt, damit es in
      // keinem Posteingang als Beleg wartet und beim Nachreichen nicht angeboten wird (Durchsicht).
      meterPhoto = true
      await markMeterPhoto(file.filename)
      const reading = await extractMeterReading(file.path, file.mimetype, settings, material)
      answer.done({ file: file.filename, kind: 'zaehler', reading, stats })
    } else {
      await unmarkMeterPhoto(req, file.filename)
      const extraction = await extractFromFile(file.path, file.mimetype, settings, material)
      await rememberInvoiceDate(file.filename, extraction.invoiceDate)
      const assessment = await rememberAssessment(req, file, extraction, signal)
      answer.done({ file: file.filename, kind: 'rechnung', extraction, assessment, stats })
    }
  } catch (err) {
    answer.fail(failureOf(file, err, stats, { meterPhoto }))
  }
})

// ---------- KI: Messdienstabrechnung und Lieferantenrechnung (Heizung PR 20, #103) ----------
//
// Beide Routen antworten wie /api/extract (Strom mit Fortschritt, Abbruch über die Kennung) und speichern
// nichts außer dem Beleg im Belegarchiv: Was die KI liest, ist ein Vorschlag, den die Seite Heizkosten zeigt;
// übernommen wird über die bestehenden Routen, wenn der Vermieter es will. Der Beleg liegt mit Objekt und
// Jahr aus dem Formular im Posteingang, bis er an eine Position kommt (die Messdienstabrechnung mit
// „Positionen anlegen“); eine Lieferung hat keinen Beleg. Eine Auswertung für die Belegbuchung (#170)
// entsteht hier nicht: Ihre Zeilen sind Rechnungspositionen, keine Nutzerzeilen oder Lieferungen.
//
// Lehnt die Route ab, bevor ausgewertet wird, verschwindet der Beleg wieder, den multer schon abgelegt hat.
const discardUpload = (req: Request): void => {
  const f = uploadedFile(req)
  if (f) fs.rmSync(f.path, { force: true })
}
async function plantForAi(req: Request, res: Response): Promise<HeatingPlant | null> {
  const id = req.params.id
  const plant = await readData(async (db) => (await readHeatingPlants(db)).find((p) => p.id === id) ?? null)
  if (!plant) {
    discardUpload(req)
    res.status(404).json({ error: NO_PLANT })
  }
  return plant
}
const SERVICE_ONLY = 'Eine Messdienstabrechnung lässt sich nur bei einer Heizanlage, die ein Messdienst oder die Gemeinschaft abrechnet, übernehmen. Stellen Sie das unter Stammdaten bei der Heizung ein.'

app.post('/api/heating-plants/:id/service-statement', fileWithPages, async (req: Request, res: Response) => {
  const plant = await plantForAi(req, res)
  if (!plant) return
  if (plant.method !== 'service') {
    discardUpload(req)
    return res.status(400).json({ error: SERVICE_ONLY })
  }
  const file = await documentOf(req, res)
  if (!file) return
  const answer = aiResponse(req, res)
  const { signal, stats, onProgress } = answer
  try {
    const extraction = await extractServiceStatement(file.path, file.mimetype, effectiveSettings(), { ...aiInput(req), signal, stats, onProgress })
    answer.done({ file: file.filename, extraction, stats })
  } catch (err) {
    answer.fail(failureOf(file, err, stats))
  }
})

app.post('/api/heating-plants/:id/fuel-invoice', fileWithPages, async (req: Request, res: Response) => {
  const plant = await plantForAi(req, res)
  if (!plant) return
  const file = await documentOf(req, res)
  if (!file) return
  const answer = aiResponse(req, res)
  const { signal, stats, onProgress } = answer
  try {
    const extraction = await extractFuelInvoice(file.path, file.mimetype, effectiveSettings(), { ...aiInput(req), signal, stats, onProgress })
    await rememberInvoiceDate(file.filename, extraction.invoiceDate)
    answer.done({ file: file.filename, extraction, stats })
  } catch (err) {
    answer.fail(failureOf(file, err, stats))
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
  // Ohne den Kontext der Anfrage: Das Nachtragen ist Systemarbeit und kein Schritt im Verlauf.
  if (rows && list.some((u) => !u.sha256)) requestScope.exit(() => void backfillUploads())
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
  // Ein älterer Beleg hat womöglich keine Zeile („eine fehlende Zeile ist kein Fehler“); sie entsteht hier als
  // Systemarbeit, damit das Löschen im Verlauf steht und ein Rücksprung den Beleg zurückholen kann (#318).
  const described = describeFile(UPLOAD_DIR, name)
  const inUse = await writeData(async (db) => {
    if ((await invoiceFilesInUse(db, [name])).has(name)) return true
    if (described) await unjournaled(db, () => recordIfMissing(db, rowOf(described)))
    await forgetUpload(db, name)
    await forgetAssessment(db, name)
    return false
  })
  if (inUse) {
    return res.status(409).json({ error: 'Beleg ist noch mit Kostenpositionen verknüpft.' })
  }
  // In den Papierkorb statt gelöscht (#318, Schritt 5, trash.ts). Scheitert das Verschieben, gleicht der nächste Start ab
  // (`reconcileFiles`): Die Zeile ist schon weg, die Datei kommt dann in den Papierkorb.
  try {
    await moveToTrash(DATA_DIR, 'uploads', name)
  } catch (err) {
    console.error(`Der Beleg ${name} ließ sich nicht in den Papierkorb legen: ${messageOf(err)}`)
  }
  res.json({ ok: true })
})

// ---------- Belege für die Steuer (#170) ----------
// Ein ZIP aller Belege eines Objekts und Jahres nach den Gruppen der Anlage V, samt Übersicht.
// Aufbau und Begründung in taxReceipts.ts.
app.get('/api/receipts/tax/:year', async (req, res) => {
  const year = Number(req.params.year)
  if (!Number.isInteger(year)) return res.status(400).json({ error: 'Ungültiges Jahr' })
  const { items, property, rows, links, split, derived, sourceParts } = await readData(async (db) => {
    const propertyId = await propertyOf(db, req)
    const whole = await readStock(db)
    const stock = narrowToProperty(whole, propertyId)
    const property = (await listProperties(db)).find((p) => p.id === propertyId)
    // Privat und abziehbar je Position aus derselben Rechnung wie die Steuerübersicht (#163), und
    // dieselbe Auswahl der Positionen: das Jahr der Zahlung (#208, seit #255 für jedes Objekt über die Teile).
    // Die Teile einmal, für Übersicht und Auswahl (Durchsicht von #255 PR 1, K5).
    const parts = taxPartsFor(whole, propertyId, year)
    const report = taxReportFor(whole, propertyId, year, parts)
    const split = new Map(report.expenses.items.map((i) => [i.costItemId, i]))
    const items = taxArchiveItems(stock.costItems, parts)
    // #268 und Heizung PR 19 (N-4): Zeilen der Übersicht ohne Position (Ausgleich beim Betriebsstrom, ausgezahlte
    // CO₂-Erstattung).
    const derived = derivedTaxLines(report)
    // #469: die Teile je Quelle über alle Zeiträume des Objekts, für den Beleg eines Teils, der selbst keinen trägt.
    const sourceParts = partsBySource(stock.costItems)
    return { items, property, rows: await uploadRows(db), links: await uploadLinks(db), split, derived, sourceParts }
  })
  const booked = new Map<string, string[]>()
  for (const [file, l] of links) for (const id of l.bookedItemIds) booked.set(id, [...(booked.get(id) ?? []), file])
  const names = new Map<string, string>()
  for (const u of describeFolder(UPLOAD_DIR, rows)) names.set(u.file, u.originalName)
  const plan = planTaxArchive(items, names, booked, split, derived, sourceParts)
  const out = createZip()
  for (const { zipPath, file } of plan.files) out.addBufferFile(path.join(UPLOAD_DIR, file), zipPath)
  out.zip.addBuffer(Buffer.from(plan.overviewCsv, 'utf8'), 'Übersicht.csv')
  const label = (property?.name || 'objekt').normalize('NFC').replace(/[^\w\-äöüÄÖÜß]+/g, '-').replace(/^-+|-+$/g, '') || 'objekt'
  res.set('Content-Disposition', `attachment; filename="belege-steuer-${year}-${label.replace(/[^\x20-\x7e]/g, '_')}.zip"; filename*=UTF-8''${encodeURIComponent(`belege-steuer-${year}-${label}.zip`)}`)
  await sendZip(res, out)
})

// Ein ZIP, das als Strom an den Browser geht (`createZip`, `sendZip`), ohne es vorher im Speicher
// zusammenzusetzen: Ein Backup mit Jahren an Belegen ist schnell Gigabytes groß, und vorher hielt
// der Server es zweimal im Speicher (gemessen: 400 MB Belege, 1,45 GB Arbeitsspeicher). yazl
// schreibt jeden Namen als UTF-8 mit dem Kennzeichen dafür, wie adm-zip vorher, sodass auch
// ältere Versionen das Archiv lesen.
//
// **Der Fehler-Horcher hängt vom ersten Augenblick an.** yazl fragt jede Datei schon in
// `addFile` ab und meldet einen Fehler als Ereignis, auch während das Backup noch auf den
// Schnappschuss der Datenbank wartet; ohne Horcher beendete das den ganzen Server. Kommt der
// Fehler vor dem Senden, gibt es eine Meldung; kommt er mittendrin, sind die Kopfzeilen schon
// gesendet, die Verbindung bricht ab, und der Browser meldet den Download als gescheitert, statt
// eine halbe Datei als fertig abzulegen.
//
// **Datendeskriptor (Bit 3) und Packen.** yazl schreibt eine Datei von der Platte (`addFile`)
// immer mit Datendeskriptor: Größe und Prüfsumme stehen erst hinter den Daten. Leser, die das
// Archiv als Strom lesen, finden das Ende eines **gespeicherten** Eintrags dann nicht (funzip, Java
// ZipInputStream; nachgemessen mit funzip), das eines gepackten schon, denn der Strom endet von
// selbst. Einige (busybox unzip aus einer Pipe) kennen gar keinen Datendeskriptor. Ohne ihn
// schreibt yazl nur aus dem Speicher (`addBuffer`). Daraus:
// - **Backup**: gepackt von der Platte (`addFile`), der Speicher bleibt flach, gleich wie groß der
//   Belegordner ist. Gelesen wird es von Mietfuchs und von Programmen, die das Verzeichnis am Ende
//   lesen (unzip, Python, Explorer, Archivprogramm). Schon Gepacktes (PDF, Fotos, ZIP) mit Stufe 1:
//   Es schrumpft ohnehin kaum. Nur speichern wäre achtmal schneller (gemessen 0,5 s gegen 4 s je
//   100 MB Zufallsdaten), ginge aber nur mit Datendeskriptor.
// - **Steuer-ZIP** (`addBufferFile`): aus dem Speicher und damit ohne Datendeskriptor, schon
//   Gepacktes nur gespeichert. Ein Steuerberater öffnet es mit beliebigen Werkzeugen, und es
//   umfasst nur die Belege eines Objekts und Jahres, also selten mehr als einige zehn MB; so war es
//   mit adm-zip auch.
const ALREADY_PACKED = /\.(pdf|jpe?g|png|webp|heic|heif|zip)$/i
type OutgoingZip = { zip: yazl.ZipFile, addFile: (realPath: string, name: string) => void, addBufferFile: (realPath: string, name: string) => void, failure: () => Error | null, startSending: () => void }

function createZip(): OutgoingZip {
  const zip = new yazl.ZipFile()
  let failure: Error | null = null
  let sending = false
  zip.on('error', (err: Error) => {
    failure ??= err
    if (sending) zip.outputStream.emit('error', err)
  })
  return {
    zip,
    // Erst selbst abfragen: Was sich schon jetzt nicht lesen lässt, ergibt so verlässlich eine
    // Meldung vor dem Senden statt eines abgebrochenen Downloads.
    addFile: (realPath, name) => {
      try {
        fs.statSync(realPath)
      } catch (err) {
        failure ??= err instanceof Error ? err : new Error(String(err))
        return
      }
      zip.addFile(realPath, name, ALREADY_PACKED.test(name) ? { compressionLevel: 1 } : {})
    },
    addBufferFile: (realPath, name) => {
      let data: Buffer
      let mtime: Date
      try {
        data = fs.readFileSync(realPath)
        mtime = fs.statSync(realPath).mtime
      } catch (err) {
        failure ??= err instanceof Error ? err : new Error(String(err))
        return
      }
      zip.addBuffer(data, name, { mtime, compress: !ALREADY_PACKED.test(name) })
    },
    failure: () => failure,
    startSending: () => { sending = true },
  }
}

async function sendZip(res: Response, out: OutgoingZip): Promise<void> {
  const early = out.failure()
  if (early) {
    res.status(500).json({ error: `Das Archiv ließ sich nicht erstellen, weil ein Beleg nicht lesbar ist: ${messageOf(early)}` })
    return
  }
  res.set('Content-Type', 'application/zip')
  out.startSending()
  out.zip.end()
  await pipeline(out.zip.outputStream, res).catch((err: unknown) => {
    console.error(`Ein ZIP ließ sich nicht vollständig senden: ${messageOf(err)}`)
    res.destroy()
  })
}

// ---------- Backup & Wiederherstellen ----------
app.get('/api/backup', async (req, res) => {
  // Wie beim Wiederherstellen: Der Belegordner muss dastehen, bevor jemand ihn liest. Dass er
  // es heute tut, liegt nur daran, dass multer ihn beim Laden des Moduls anlegt und `load()`
  // ihn ebenfalls anlegt. Beides sind Nebenwirkungen an anderer Stelle, und ein Backup ist der
  // schlechteste Zeitpunkt für einen Fehler.
  fs.mkdirSync(UPLOAD_DIR, { recursive: true })
  const out = createZip()
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

  if (!traegtDenBestand) out.addFile(jsonFile, 'db.json')
  // Nur Dateien: Einen Unterordner liest der Belegordner nicht (uploads.ts) und das
  // Wiederherstellen lehnt ihn ab; adm-zip brach hier an ihm mit einem Serverfehler ab.
  for (const entry of fs.readdirSync(UPLOAD_DIR, { withFileTypes: true })) {
    if (entry.isFile()) out.addFile(path.join(UPLOAD_DIR, entry.name), `uploads/${entry.name}`)
  }
  // Logo und Briefpapier (#415, Teil 2b): nur Namen der eigenen Gestalt, und nur, worauf eine Gestaltung des Bestands
  // verweist (Integrationsdurchsicht 0.13.0). Eine liegengebliebene Datei, etwa nach einem abgebrochenen Ersetzen, gehört
  // zu keinem Stand; eine db.json kennt gar keine Gestaltung.
  const designNames = traegtDenBestand && database ? await database.read((db) => referencedDesignFiles(db)) : new Set<string>()
  for (const name of designFilesOnDisk(DATA_DIR).filter((n) => designNames.has(n))) out.addFile(path.join(designDir(DATA_DIR), name), `briefpapier/${name}`)

  // Die Datenbank kommt als **Schnappschuss** mit und nicht als Kopie der laufenden Datei
  // (db/backup.ts).
  let snapshotFile: string | null = null
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
    // Backups und brächte die Verdrängung zurück, die dieser Name gerade verhindert. Das tut der
    // nächste Start (`cleanRestoreLeftovers`), denn dann läuft kein Backup.
    //
    // Der Schnappschuss entsteht, **bevor** die erste Zeile des Archivs gesendet wird: Scheitert
    // er, gibt es noch eine Fehlermeldung statt eines abgebrochenen Downloads. Weggeräumt wird
    // die Zwischendatei erst, wenn das Archiv gesendet ist, denn yazl liest sie erst dann.
    const temp = path.join(DATA_DIR, `${ARCHIVE_DB_NAME}.${newId()}.backup`)
    try {
      await writeDatabaseSnapshot(database, temp)
      // Der Verlauf nur auf ausdrücklichen Wunsch (db/backup.ts, `stripJournal`).
      if (req.query.journal !== '1') await stripJournal(temp)
    } catch (err) {
      fs.rmSync(temp, { force: true })
      // Hier wird abgebrochen und nicht stillschweigend ohne Datenbank gepackt: Ein Archiv, das
      // sich vollständig anfühlt und es nicht ist, fällt erst im Ernstfall auf.
      return res.status(500).json({ error: `Die Datenbank ließ sich nicht sichern: ${messageOf(err)}` })
    }
    out.addFile(temp, ARCHIVE_DB_NAME)
    snapshotFile = temp
  }
  out.zip.addBuffer(Buffer.from(archiveInfoText(new Date()), 'utf8'), ARCHIVE_INFO_NAME)

  const stamp = new Date().toISOString().slice(0, 10)
  res.set('Content-Disposition', `attachment; filename="mietfuchs-backup-${stamp}.zip"`)
  try {
    await sendZip(res, out)
  } finally {
    if (snapshotFile) fs.rmSync(snapshotFile, { force: true })
  }
})

// **Grenzen beim Wiederherstellen** (geprüft in zipRead.ts, bevor ein Eintrag ausgepackt wird).
// Bemessen am größten Bestand, der bei einem privaten Vermieter vorkommt, mit reichlich Luft:
// fünf Objekte, zwanzig Jahre, je Objekt und Jahr 200 Belege sind 20.000 Dateien; ein Beleg ist
// höchstens 25 MB groß (UPLOAD_MAX_BYTES), im Mittel eher 0,5 bis 2 MB.
// - 50.000 Einträge: das Zweieinhalbfache davon. Ein Archiv mit 65.535 leeren Einträgen kostete
//   adm-zip 4,9 s und 880 MB, bevor überhaupt geprüft war; gezählt wird jetzt am Ende des
//   Archivs, bevor ein Eintrag gelesen ist.
// - 2 GB je Eintrag: Das ist die Datenbank, ein Beleg kommt nie in die Nähe.
// - 20 GB ausgepackt und hochgeladen: 20.000 Belege zu 1 MB passen gerade hinein (rund 19,5 GB),
//   beim Mittel von 2 MB nicht mehr; ein so großer Bestand ist aber selten, und darüber hinaus
//   bleibt das Kopieren des Datenordners. Zusätzlich muss so viel auf dem Datenträger frei sein,
//   samt Reserve für die Sicherungen danach (restoreFiles.ts); das hochgeladene Archiv liegt
//   dort schon.
// - Packdichte höchstens hundertfach, sobald ein Eintrag oder alle zusammen über 64 MB hätten:
//   Belege (PDF, JPEG) sind schon gepackt und schrumpfen kaum, die Datenbank und eine db.json etwa
//   auf ein Fünftel bis ein Zehntel. Nullbytes schrumpfen auf ein Tausendstel; 896 kB davon,
//   ehrlich als 900 MB angegeben, kamen vorher unter der Grenze von 1 GB durch und brauchten 2 GB
//   Arbeitsspeicher.
// - Die db.json wird im Speicher gelesen und geprüft, deshalb höchstens 512 MB; eine echte hat
//   wenige MB.
// NKA_RESTORE_MAX_BYTES setzt die Grenze für das Ausgepackte für Tests herab.
const RESTORE_MAX_BYTES = 20 * 1024 ** 3
const RESTORE_UNPACKED_MAX_BYTES = Number(process.env.NKA_RESTORE_MAX_BYTES) || 20 * 1024 ** 3
const RESTORE_LIMITS: ZipLimits = {
  maxEntries: 50_000,
  maxEntryBytes: 2 * 1024 ** 3,
  maxTotalBytes: RESTORE_UNPACKED_MAX_BYTES,
  maxRatio: 100,
  ratioAbove: 64 * 1024 ** 2,
  maxNameBytes: 1024,
}
const RESTORE_JSON_MAX_BYTES = 512 * 1024 ** 2
const RESTORE_INFO_MAX_BYTES = 1024 * 1024
// **Das Archiv kommt auf die Platte und nicht in den Speicher**, in den Datenordner, damit es auf
// demselben Datenträger liegt wie das, was daraus wird. Der Name beginnt wie die Zwischenablage
// mit `restore-`; die Route räumt beides in jedem Fall weg. Den vergebenen Namen merkt sich der
// Speicher je Anfrage, und die Route nimmt ihn von dort statt aus `req.file`.
const restoreUploadNames = new WeakMap<Request, string>()
const restoreUpload = multer({
  storage: multer.diskStorage({
    destination: DATA_DIR,
    filename: (req, _file, cb) => {
      const name = `restore-upload-${newId()}.zip`
      restoreUploadNames.set(req, name)
      cb(null, name)
    },
  }),
  limits: { fileSize: RESTORE_MAX_BYTES },
})

const NOTHING_CHANGED = 'Es wurde nichts davon übernommen; Ihre bisherigen Daten sind unverändert.'

// Liest ein Backup vollständig und prüft es, bevor irgendetwas ersetzt wird. Wirft einen Fehler
// mit einer Meldung für die Oberfläche; dann bleibt der bisherige Datenstand unangetastet.
type ReadBackup = {
  // `null`, wenn das Archiv keine db.json führt: Auf einem Rechner, der nie eine hatte,
  // entsteht sie seit dem Umstieg der Routen gar nicht mehr.
  dbText: string | null
  // Die Belege, schon ausgepackt in der Zwischenablage und mit ihrer Zeit aus dem Archiv (#142):
  // Ohne sie trüge jeder Beleg danach das Datum der Wiederherstellung, und im Belegordner sähe
  // eine alte Rechnung aus wie eben hochgeladen.
  files: { fileName: string, staged: string }[]
  // Logo und Briefpapier (#415, Teil 2b), ebenso ausgepackt; Archive von vor 0.13 haben keine.
  designFiles: { fileName: string, staged: string }[]
  // Die Datenbank aus dem Archiv, ausgepackt in der Zwischenablage, oder `null` bei einem Archiv
  // aus einer Version vor ihr. Das ist kein Randfall: Genau solche Archive liegen bei den
  // heutigen Nutzern.
  database: string | null
  // Woher das Archiv stammt, in Worten für eine Meldung.
  origin: string
}

// `archive` ist das hochgeladene Archiv auf der Platte, `staging` ein leerer Ordner im
// Datenordner, in den ausgepackt wird. Weggeräumt wird beides vom Aufrufer.
async function readBackup(archive: string, staging: string): Promise<ReadBackup> {
  let zip: ZipReader
  try {
    zip = await openZip(archive, RESTORE_LIMITS)
  } catch (err) {
    if (err instanceof ZipRefusal) throw new Error(err.kind === 'not-zip' ? 'Datei ist kein gültiges ZIP-Archiv.' : `${err.message} ${NOTHING_CHANGED}`)
    throw err
  }
  try {
    return await readBackupEntries(zip, staging)
  } catch (err) {
    if (err instanceof ZipRefusal) throw new Error(`${err.message} ${NOTHING_CHANGED}`)
    const full = diskFullMessage(err)
    if (full) throw new Error(full)
    throw err
  } finally {
    zip.close()
  }
}

async function readBackupEntries(zip: ZipReader, staging: string): Promise<ReadBackup> {
  const entries = zip.items
  const dbEntry = entries.find((e) => e.name === 'db.json')

  // Die Datenbank und die Herkunftsangabe. Beide fehlen in jedem Archiv, das vor Aufgabe 7a
  // entstanden ist, und beides ist in Ordnung: Die db.json ist dann der ganze Bestand.
  const databaseEntry = entries.find((e) => e.name === ARCHIVE_DB_NAME)
  const infoEntry = entries.find((e) => e.name === ARCHIVE_INFO_NAME)
  // **Eines von beiden muss da sein.** Ein Archiv von vor dem Umstieg führt nur die db.json,
  // eines von einem frischen Rechner nur die Datenbank, und eines dazwischen beide. Fehlt
  // jedoch beides, ist es kein Mietfuchs-Backup.
  if (!dbEntry && !databaseEntry) {
    throw new Error('Im Archiv fehlen sowohl die Datenbank als auch die db.json. Ist das wirklich ein Mietfuchs-Backup?')
  }

  const files: { fileName: string, e: ZipItem }[] = []
  const designs: { fileName: string, e: ZipItem }[] = []
  for (const e of entries) {
    const name = e.name
    // Logo und Briefpapier (#415, Teil 2b): nur Namen der eigenen Gestalt, direkt im Ordner, höchstens so groß wie ein
    // Briefpapier sein darf.
    if (name.startsWith('briefpapier/')) {
      if (e.isDirectory && name === 'briefpapier/') continue
      const fileName = name.slice('briefpapier/'.length)
      if (e.isDirectory || !isDesignFileName(fileName)) throw new Error(`Das Archiv enthält einen ungültigen Eintrag („${name}“) und wird nicht übernommen.`)
      if (e.size > LETTER_DESIGN_LIMITS.paper) throw new Error(`Das Briefpapier „${fileName}“ im Archiv ist größer als ${LIMIT_TEXT.paper} und wird nicht übernommen. ${NOTHING_CHANGED}`)
      designs.push({ fileName, e })
      continue
    }
    if (name === 'db.json' || !name.startsWith('uploads/')) continue // anderes bleibt unbeachtet
    if (e.isDirectory && name === 'uploads/') continue
    // Ein Backup enthält Belege nur direkt in uploads/. Alles andere ist verdächtig.
    const fileName = name.slice('uploads/'.length)
    if (e.isDirectory || !fileName || fileName === '.' || fileName === '..' || /[\\/]/.test(fileName)) {
      throw new Error(`Das Archiv enthält einen ungültigen Eintrag („${name}“) und wird nicht übernommen.`)
    }
    files.push({ fileName, e })
  }
  // **Führt das Archiv eine db.json, wird die mitgebrachte Datenbank gar nicht erst ausgepackt**:
  // Sie würde ohnehin verworfen (die Regel und ihre Begründung stehen in runRestore).
  const unpackDatabase = databaseEntry && !dbEntry ? databaseEntry : null
  // Die Gesamtgröße hat zipRead.ts schon begrenzt; hier zählt, ob sie auf diesen Datenträger
  // passt, samt dem, was nach den Belegen noch entsteht (restoreFiles.ts).
  let currentDatabase = 0
  try {
    currentDatabase = fs.statSync(databaseFile(DATA_DIR)).size
  } catch { /* keine Datenbank, etwa auf einem frischen Rechner */ }
  const needed = restoreSpaceNeeded({
    files: [...files, ...designs].reduce((sum, f) => sum + f.e.size, 0),
    database: unpackDatabase?.size ?? 0,
    currentDatabase,
    dbJson: dbEntry?.size ?? 0,
  })
  const free = freeBytes(staging)
  if (free !== null && needed > free) {
    throw new Error(
      `Auf dem Datenträger ist nicht genug Platz: Das Backup braucht ausgepackt samt Sicherungen ${Math.ceil(needed / 1024 ** 2)} MB, ` +
        `frei sind ${Math.floor(free / 1024 ** 2)} MB. ${NOTHING_CHANGED}`,
    )
  }

  // Die db.json nur, wenn das Archiv eine führt. Ist sie da, wird sie geprüft wie bisher: Was
  // ihr fehlt, fiele sonst erst beim Einlesen auf, und dann ist schon etwas ersetzt.
  let dbText: string | null = null
  let parsed: unknown = null
  if (dbEntry) {
    const data = await zip.read(dbEntry, RESTORE_JSON_MAX_BYTES)
    try {
      dbText = data.toString('utf8')
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
      info = JSON.parse((await zip.read(infoEntry, RESTORE_INFO_MAX_BYTES)).toString('utf8'))
    } catch {
      info = null
    }
  }

  // Alles auspacken, bevor geschrieben wird: Scheitert ein Eintrag, ist noch nichts ersetzt.
  // Ausgepackt wird als Strom in die Zwischenablage, nicht in den Speicher; die Zeit des
  // Eintrags setzt zipRead.ts dabei gleich mit.
  const staged: { fileName: string, staged: string }[] = []
  for (const [i, { fileName, e }] of files.entries()) {
    // Durchnummeriert statt unter dem Namen: Zwei Einträge gleichen Namens überschrieben sich
    // sonst schon hier, und der Name ist erst beim Verschieben in den Belegordner wieder gefragt.
    const target = path.join(staging, `beleg-${i}`)
    await zip.extract(e, target)
    staged.push({ fileName, staged: target })
  }
  const designStaged: { fileName: string, staged: string }[] = []
  for (const [i, { fileName, e }] of designs.entries()) {
    const target = path.join(staging, `briefpapier-${i}`)
    await zip.extract(e, target)
    // Geprüft wie beim Hochladen (Durchsicht K1): ein PNG muss ein PNG sein, eine PDF eine PDF.
    const fd = fs.openSync(target, 'r')
    const head = Buffer.alloc(16)
    try {
      fs.readSync(fd, head, 0, 16, 0)
    } finally {
      fs.closeSync(fd)
    }
    const problem = archivedDesignProblem(fileName, head)
    if (problem) throw new Error(`${problem} ${NOTHING_CHANGED}`)
    designStaged.push({ fileName, staged: target })
  }
  let database: string | null = null
  if (unpackDatabase) {
    database = path.join(staging, ARCHIVE_DB_NAME)
    await zip.extract(unpackDatabase, database)
  }
  return { dbText, files: staged, designFiles: designStaged, database, origin: originText(info) }
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
async function restoreDatabase(staged: string | null, barrier: 'restore' | 'priorVersion'): Promise<string[]> {
  const target = databaseFile(DATA_DIR)

  // **Erst aus der Nahtstelle nehmen, dann leerlaufen lassen, dann schließen.** Die Reihenfolge
  // ist die ganze Zusage. Ab dem `null` bekommt jede neue Anfrage ihre 503 statt einer
  // geschlossenen Verbindung, und das Leerlaufen wartet ab, was schon läuft. Ein `close()` ohne
  // beides schnitte eine gerade offene Transaktion mitten im Schreiben ab; SQLite rollt sie beim
  // nächsten Öffnen zwar zurück, aber die Anfrage, die sie angestoßen hat, stirbt ohne Antwort.
  // Die Zustimmungen von jetzt (Durchsicht von PR #442, M3): Ein eingespielter Stand bringt keine mit, weder ein
  // Backup noch eine Sicherung. Gelesen, solange die Datenbank noch offen ist; danach angeglichen (`keepConsent`).
  const consent = await consentNow()
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
  // **Eine vorhandene Sicherung wird beiseitegelegt, nicht überschrieben** (Durchsicht zu #318, M1):
  // Wer zweimal einspielt, verlöre sonst den Stand vor dem ersten Mal, und genau der kann der sein,
  // den er sucht. Dasselbe Muster wie bei der Sicherung vor einem Update (`….vom-JJJJ-MM-TT-HHMM`).
  const before = path.join(DATA_DIR, DB_BEFORE_RESTORE)
  if (fs.existsSync(target) && fs.existsSync(before)) await replaceFile(before, setAsideName(before))
  // **Der Zeitpunkt der Sicherung ist der des Einspielens** (Durchsicht von PR #442, M1): `rename` behält die Dateizeit
  // der Arbeitsdatei, also die letzte Änderung des Stands. Daraus lesen Zeitachse, Aufräumen und `setAsideName` den
  // Zeitpunkt der Sicherung; mit der alten Zeit hielte das Aufräumen eine eben angelegte Sicherung für über zwölf Monate
  // alt. Dieselbe Zeit trägt die Schranke im Verlauf.
  const at = new Date()
  if (fs.existsSync(target)) {
    await replaceFile(target, before)
    try {
      fs.utimesSync(before, at, at)
    } catch (err) {
      console.error(`Die Zeit der Sicherung ${DB_BEFORE_RESTORE} ließ sich nicht setzen: ${messageOf(err)}`)
    }
  }
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
    await markBarrier(barrier, at)
    return [...await keepConsent(consent), ...await reconcileAfterRestore()]
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
  else await markBarrier(barrier, at)
  return rebuilt.state === 'failed' ? [rebuilt.message] : [...rebuilt.notes, ...await keepConsent(consent), ...await reconcileAfterRestore()]
}

// Zustimmungen beim Einspielen (Regel aus #439, `restoreConsent` in db/revert.ts): Jede Zeile trägt danach die
// Zustimmung von vorher, eine neu entstandene keine. Lässt sich die bisherige Datenbank nicht lesen (der Rettungsfall,
// ein neuer Rechner), gilt danach keine; erteilt wird sie in den Einstellungen neu. Das ist gewollt: Ein Widerruf kommt
// nie still zurück. Beides wirft nie.
async function consentNow(): Promise<ConsentSnapshot> {
  try {
    const current = stockDatabase()
    return current ? await current.read((db) => consentSnapshot(db)) : new Map()
  } catch (err) {
    console.error(`Die Zustimmungen ließen sich vor dem Einspielen nicht lesen; danach gilt keine: ${messageOf(err)}`)
    return new Map()
  }
}
// Systemarbeit ohne Gruppe: Die Zustimmungen gehören nicht zum Stand, den der Verlauf zeigt.
async function keepConsent(consent: ConsentSnapshot): Promise<string[]> {
  try {
    const restored = database
    if (restored) await restored.write((db) => restoreConsent(db, consent))
    return []
  } catch (err) {
    return [`Die Zustimmungen ließen sich nach dem Einspielen nicht angleichen: ${messageOf(err)}`]
  }
}

// Nach dem Einspielen (Durchsicht von PR #439, M1): Dateien, die der eingespielte Stand nennt und die nur im
// Papierkorb liegen, kommen zurück. Wirft nie; die Sätze gehen in die Antwort.
async function reconcileAfterRestore(): Promise<string[]> {
  try {
    const opened = database
    return opened ? await opened.read((db) => reconcileFiles(db, DATA_DIR)) : []
  } catch (err) {
    console.error(`Belegordner und Papierkorb ließen sich nicht abgleichen: ${messageOf(err)}`)
    return []
  }
}

// Die Schranke im Verlauf (#318, Schritt 4): Über ein Einspielen und den Umstieg hinweg führt kein Rücksprung.
// Systemarbeit ohne Gruppe; ein Fehler steht nur auf der Konsole und hält das Einspielen nicht auf.
async function markBarrier(barrier: JournalBarrier, at = new Date()): Promise<void> {
  try {
    const opened = database
    if (opened) await opened.write((db) => addBarrier(db, barrier, opened.schemaSteps, at))
  } catch (err) {
    console.error(`Die Schranke im Verlauf ließ sich nicht setzen: ${messageOf(err)}`)
  }
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

// **Vor dem Hochladen**: Läuft schon eine Wiederherstellung, oder ist die Anfrage größer als der
// freie Platz, wird abgelehnt, bevor multer bis zu 20 GB auf die Platte schreibt. Der Rumpf wird
// dabei verworfen, nicht gelesen.
function restoreGate(req: Request, res: Response, next: NextFunction): void {
  const refuse = (status: number, error: string) => {
    req.resume()
    res.set('Connection', 'close')
    res.status(status).json({ error })
  }
  if (restoreRunning) return refuse(409, 'Es läuft gerade eine Wiederherstellung. Bitte warten Sie, bis sie fertig ist.')
  const length = Number(req.headers['content-length'])
  const free = freeBytes(DATA_DIR)
  if (free !== null && Number.isFinite(length) && length > free) {
    return refuse(400, `Auf dem Datenträger ist nicht genug Platz für dieses Backup: Es ist ${Math.ceil(length / 1024 ** 2)} MB groß, ` +
      `frei sind ${Math.floor(free / 1024 ** 2)} MB. ${NOTHING_CHANGED}`)
  }
  next()
}

app.post('/api/restore', restoreGate, restoreUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei' })
  // Der Pfad entsteht aus dem Datenordner und dem Namen, den restoreUpload vergeben hat, nicht
  // aus `req.file.path`; die Datei wird unten in jedem Fall gelöscht.
  const archive = restoreUploadPath(DATA_DIR, restoreUploadNames.get(req))
  if (!archive) return res.status(500).json({ error: 'Das hochgeladene Backup hat einen unerwarteten Namen. Bitte versuchen Sie es erneut.' })
  // Das hochgeladene Archiv und die Zwischenablage gehen in jedem Fall wieder weg, auch nach
  // einer Ablehnung: Liegen bliebe sonst ein Archiv, das niemand mehr braucht, oder ein halb
  // ausgepacktes Backup.
  const staging = path.join(DATA_DIR, `restore-${newId()}`)
  try {
    if (restoreRunning) {
      return res.status(409).json({
        error: 'Es läuft gerade eine Wiederherstellung. Bitte warten Sie, bis sie fertig ist.',
      })
    }
    // Die Marke steht schon vor dem Lesen, denn das Lesen ist jetzt ein Vorgang mit Pausen
    // (ausgepackt wird als Strom), und eine zweite Anfrage dazwischen packte sonst in dieselbe
    // Zeit ein zweites Archiv aus.
    restoreRunning = true
    try {
      let backup: ReadBackup
      try {
        fs.mkdirSync(staging)
        backup = await readBackup(archive, staging)
      } catch (err) {
        return res.status(400).json({ error: messageOf(err) })
      }
      await runRestore(backup, res)
    } finally {
      restoreRunning = false
    }
  } finally {
    fs.rmSync(archive, { force: true })
    fs.rmSync(staging, { recursive: true, force: true })
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
      fs.renameSync(archiveDatabase, staged)
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
  //
  // **Die Belege zuerst.** Ausgepackt und mit Datum versehen sind sie schon (readBackup), hier
  // wandern sie nur an ihren Platz. Stünden sie hinter der db.json, hinterließe ein Fehler beim
  // Verschieben eine schon ersetzte db.json neben halb verschobenen Belegen.
  for (const { fileName, staged } of backup.files) await moveIntoPlace(staged, path.join(UPLOAD_DIR, fileName))
  // Logo und Briefpapier ebenso; ihre Namen sind eindeutig, ein vorhandenes gleichen Namens ist dieselbe Datei.
  if (backup.designFiles.length > 0) fs.mkdirSync(designDir(DATA_DIR), { recursive: true })
  for (const { fileName, staged } of backup.designFiles) await moveIntoPlace(staged, path.join(designDir(DATA_DIR), fileName))
  const current = path.join(DATA_DIR, 'db.json')
  // Eine Sicherheitskopie eines früheren Einspielens wird nicht überschrieben, sondern mit Datum beiseitegelegt wie die
  // der Datenbank (`setAsideName`, Integrationsdurchsicht 0.13.0): Sonst wäre nach zweimaligem Einspielen der Stand von
  // vor dem ersten verloren.
  const before = path.join(DATA_DIR, 'db.json.vor-restore')
  if (fs.existsSync(current)) {
    if (fs.existsSync(before)) fs.renameSync(before, setAsideName(before))
    fs.copyFileSync(current, before)
  }
  // Führt das Archiv keine db.json, wird auch keine angelegt. Eine leere wäre schlimmer als
  // keine: Der Umstieg beim nächsten Start hielte sie für einen zu übernehmenden Bestand.
  if (backup.dbText !== null) fs.writeFileSync(current, backup.dbText, 'utf8')
  else fs.rmSync(current, { force: true })

  let notes: string[]
  try {
    notes = await restoreDatabase(staged, 'restore')
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
    notes = [restoreFailedNote(err, 'Ihre Daten sind aus dem Archiv geschrieben worden', ', falls das Archiv eine mitgebracht hat,')]
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
  // Logo und Briefpapier, auf die der eingespielte Stand nicht verweist, bleiben liegen (Durchsicht zu PR #436, S3): Die
  // Sicherung `mietfuchs.sqlite.vor-restore` verweist noch auf sie. Ins nächste Backup kommen sie nicht.
  res.json({ ok: true, notes })
}

// Die Meldung, wenn der Austausch der Datenbank mittendrin scheitert. Dieselbe für ein Backup und
// eine Vorversion: Gesagt wird, was sicher stimmt (siehe die Begründung in runRestore).
function restoreFailedNote(err: unknown, what: string, ifStaged: string): string {
  return (
    `${what}, die Datenbank ließ sich dabei aber ` +
    `nicht erneuern: ${messageOf(err)}. Gelöscht ist nichts; im Datenordner ` +
    `(${DATA_DIR}) liegen der vorherige Stand als „mietfuchs.sqlite.vor-restore“ und${ifStaged} ` +
    'die neue Datenbank noch unter einem Namen, der mit ' +
    '„mietfuchs.sqlite.restore-“ beginnt. Bitte melden Sie diesen Fehler, bevor Sie etwas ' +
    'von Hand verschieben.'
  )
}

// ---------- Automatische Vorversionen (#318) ----------
//
// Angelegt werden sie in db/priorVersions.ts; hier stehen der Zeitpunkt und das Einspielen.

// Beim Start und danach einmal am Tag. **Wirft nie**: Eine fehlende Vorversion darf den Betrieb
// nicht stören, deshalb steht ein Fehler auf der Konsole und nirgends sonst. Während eines
// Wiederherstellens und ohne Datenbank, die den Bestand trägt, wird nichts angelegt: Eine
// Vorversion einer leeren Datenbank eines gescheiterten Umstiegs wäre keine.
async function checkPriorVersion(pruneToo = false): Promise<void> {
  // Das Journal räumt im selben Takt auf (12 Monate, #318); beim Start nicht, das hat open.ts eben getan.
  // Systemarbeit, also ohne Gruppe, und ein Fehler steht nur auf der Konsole.
  try {
    if (pruneToo && database && databaseUnavailable(databaseState()) === null) await database.write((db) => pruneJournal(db, new Date()))
  } catch (err) {
    console.error(`Das Änderungsjournal ließ sich nicht aufräumen: ${messageOf(err)}`)
  }
  await emptyTrash()
  // Sicherungen vor einem Update und vor dem Einspielen (#318, snapshots.ts): die drei jüngsten je Art und alles aus
  // zwölf Monaten bleiben, die des offenen Hinweises nach dem Update immer. Nicht während eines Wiederherstellens.
  try {
    if (!restoreRunning) {
      const removed = cleanSnapshots(DATA_DIR, await tagsOfMigrations(), new Date(), snapshotNotice())
      if (removed.length > 0) console.log(`Alte Sicherungen entfernt: ${removed.join(', ')}`)
    }
  } catch (err) {
    console.error(`Die alten Sicherungen ließen sich nicht aufräumen: ${messageOf(err)}`)
  }
  try {
    if (!database || !mayCreatePriorVersion(databaseState(), restoreRunning)) return
    const name = await createPriorVersion(database, DATA_DIR, new Date(), { skip: () => restoreRunning })
    if (name) console.log(`Vorversion der Datenbank angelegt: ${path.join(DATA_DIR, PRIOR_DIR, name)}`)
  } catch (err) {
    console.error(`Die Vorversion der Datenbank ließ sich nicht anlegen: ${messageOf(err)}`)
  }
}

// Der Papierkorb (#318, Schritt 5, trash.ts) mit der Aufbewahrung des Journals: Was keine Zeile im Journal mehr nennt,
// braucht kein Rücksprung. Nur mit einer Datenbank, die den Bestand trägt (sonst wüsste niemand, was noch genannt
// ist). Wirft nie.
async function emptyTrash(): Promise<void> {
  try {
    if (!database || databaseUnavailable(databaseState()) !== null) return
    const keep = await database.read((db) => trashKeep(db))
    const removed = cleanTrash(DATA_DIR, keep)
    if (removed > 0) console.log(`Papierkorb: ${removed === 1 ? 'eine Datei' : `${removed} Dateien`} entfernt, die der Verlauf nicht mehr nennt.`)
  } catch (err) {
    console.error(`Der Papierkorb ließ sich nicht aufräumen: ${messageOf(err)}`)
  }
}

// Gesperrt nur, wo die Daten noch in der db.json stehen (`priorVersionsBlocked`); ohne offene
// Datenbank gehen Liste und Einspielen, denn das ist der Fall, für den es sie gibt.
const priorVersionsRefusal = (res: Response): boolean => {
  const reason = priorVersionsBlocked(databaseState())
  if (reason) res.status(503).json({ error: reason })
  return reason !== null
}

// ---------- Verlauf (#318, Schritt 3) ----------

// Die Einträge des Änderungsjournals, neueste zuerst: mit `property` die des Objekts und die
// installationsweiten, ohne alle. `before` ist die Kennung, ab der weitergeblättert wird. Filter (#318, Schritt 4):
// `from`/`to` als ISO-Zeitpunkte (die Oberfläche rechnet Tage in ihrer Zeitzone um, `to` ausschließlich), `kind`
// (Bereich, abgeleitet aus den Tabellen), `q` (Text in Satz und Inhalt).
const JOURNAL_PAGE = 50
const isoQuery = (value: unknown): string | null =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?$/.test(value) && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null
app.get('/api/journal', async (req, res) => {
  const property = typeof req.query.property === 'string' && req.query.property ? req.query.property : null
  const before = typeof req.query.before === 'string' && /^\d+$/.test(req.query.before) ? Number(req.query.before) : null
  const asked = typeof req.query.limit === 'string' && /^\d+$/.test(req.query.limit) ? Number(req.query.limit) : JOURNAL_PAGE
  const limit = Math.min(Math.max(asked, 1), 200)
  const from = isoQuery(req.query.from)
  const to = isoQuery(req.query.to)
  if ((req.query.from !== undefined && req.query.from !== '' && from === null) || (req.query.to !== undefined && req.query.to !== '' && to === null)) {
    return res.status(400).json({ error: 'Der Zeitraum des Filters ist kein gültiges Datum.' })
  }
  const kind = req.query.kind === undefined || req.query.kind === '' ? null : req.query.kind
  if (kind !== null && !isJournalKind(kind)) return res.status(400).json({ error: 'Diesen Bereich kennt der Verlauf nicht.' })
  const q = typeof req.query.q === 'string' && req.query.q.trim() !== '' ? req.query.q.trim().slice(0, 200) : null
  // Sicherungspunkte (#318) mit `snapshots=1`: zeitlich einsortiert, mit dem Zeitraumfilter. Bereich und Suche blenden
  // sie aus (eine Sicherung gehört zu keinem Bereich und hat keinen Text); das Objekt nicht, denn sie betrifft alle
  // Objekte wie die Einstellungen. Lässt sich die Datenbank nicht lesen, kommen nur sie: Das ist der Rettungsfall.
  const withSnapshots = req.query.snapshots === '1' && kind === null && q === null
  if (withSnapshots && !stockDatabase()) {
    if (priorVersionsRefusal(res)) return
    return res.json(before === null ? interleaveSnapshots([], await currentSnapshots(), { beforeAt: null, last: true, from, to }) : [])
  }
  const groups = await onDatabase((opened) => opened.read((db) =>
    listJournal(db, opened.journalSchema, { propertyId: property, before, limit, from, to, kind, q, schemaSteps: opened.schemaSteps })))
  if (!withSnapshots) return res.json(groups)
  // Geblättert wird ab einer Gruppe: Sicherungspunkte gehören auf diese Seite, wenn sie älter sind als sie.
  const beforeAt = before === null ? null : await onDatabase((opened) => opened.read(async (db) =>
    (await db.select({ at: changeGroups.at }).from(changeGroups).where(sql`${changeGroups.id} = ${before}`).get())?.at ?? new Date(0).toISOString()))
  res.json(interleaveSnapshots(groups, await currentSnapshots(), { beforeAt, last: groups.length < limit, from, to }))
})

const journalId = (req: Request): number | null => (/^\d+$/.test(String(req.params.id)) ? Number(req.params.id) : null)
const JOURNAL_GONE = 'Diesen Eintrag gibt es im Verlauf nicht (mehr).'

app.get('/api/journal/:id', async (req, res) => {
  const id = journalId(req)
  const group = id === null ? null : await onDatabase((opened) => opened.read((db) => journalGroup(db, opened.journalSchema, id, opened.schemaSteps)))
  if (!group) return res.status(404).json({ error: JOURNAL_GONE })
  res.json(group)
})

// Rücksprung (#318, Schritt 4, db/revert.ts): `mode` `including` = Stand vor dem Eintrag (er und alles danach wird
// zurückgenommen), `after` = Stand nach dem Eintrag (nur alles danach). Erst die Vorschau (ein Probelauf, der
// zurückrollt), dann der Rücksprung mit ihrer Marke; stimmt sie nicht mehr oder steht eine Grenze im Weg, 409 mit
// neuer Vorschau. Ohne Zustimmung wird nichts geschrieben.
// Solange eine KI-Auswertung läuft, kein Rücksprung (Durchsicht von PR #439, K2): Sie schriebe danach Auswertung und
// Rechnungsdatum zu einem Beleg, den der Rücksprung womöglich entfernt hat.
const revertBlocked = (): string[] => (runningAiRequests.size > 0
  ? ['Gerade wertet die KI einen Beleg aus. Warten Sie, bis sie fertig ist, oder brechen Sie die Auswertung ab; danach geht der Rücksprung.']
  : [])
const revertModeOf = (req: Request) => {
  const mode = bodyObject(req).mode ?? 'including'
  return isRevertMode(mode) ? mode : null
}
app.post('/api/journal/:id/revert/preview', async (req, res) => {
  const id = journalId(req)
  const mode = revertModeOf(req)
  if (mode === null) return res.status(400).json({ error: 'Unbekannte Art des Rücksprungs.' })
  const preview = id === null ? null : await writeData((db) => onDatabase((opened) => previewRevert(db, opened.journalSchema, id, mode, opened.schemaSteps, DATA_DIR, revertBlocked())))
  if (!preview) return res.status(404).json({ error: JOURNAL_GONE })
  res.json(await snapshotFallback(preview) ?? preview)
})

// Geht der Rücksprung Schritt für Schritt nicht (Schranke, anderes Update), aber trägt eine Sicherung genau den
// gewünschten Stand, nimmt die Vorschau sie (#318): `kind: 'snapshot'`. Genau heißt: Ihre jüngste Gruppe im Verlauf ist
// dieselbe (Kennung und Zeitpunkt) wie die letzte Gruppe des gewünschten Stands. Eine Sicherung aus einem anderen Zweig
// der Geschichte (vor dem Einspielen eines Backups) hat dort eine andere. Nicht bei einer laufenden KI-Auswertung, nicht,
// wenn es nichts zurückzunehmen gibt, und **nicht über einen Abschluss, ein Wiederöffnen oder ein Versanddatum**
// (Durchsicht von PR #442, M2): Sonst umginge der Weg über die Sicherung die Sperre, die einen zugestellten Stand
// schützt. Dafür bleibt „Wieder öffnen“; die Zeile der Sicherung ist der ausdrückliche Weg und nennt die Abrechnungen.
async function snapshotFallback(preview: RevertPreview): Promise<SnapshotPreview | null> {
  if (preview.refusals.length === 0 || preview.entries.length === 0 || preview.frozen.length > 0 || revertBlocked().length > 0) return null
  const opened = stockDatabase()
  if (!opened) return null
  const target = await opened.read((db) => {
    const where = preview.mode === 'after' ? sql`${changeGroups.id} = ${preview.entry.id}` : sql`${changeGroups.id} < ${preview.entry.firstId}`
    return db.select({ id: changeGroups.id, at: changeGroups.at }).from(changeGroups).where(where).orderBy(sql`${changeGroups.id} DESC`).limit(1).get()
  })
  if (!target) return null
  for (const point of await currentSnapshots()) {
    const last = await snapshotLastGroup(snapshotFile(DATA_DIR, point))
    if (last && last.id === target.id && last.at === target.at) {
      return previewSnapshot(DATA_DIR, point, opened, [], { entry: preview.entry, mode: preview.mode, reasons: preview.refusals })
    }
  }
  return null
}
app.post('/api/journal/:id/revert', async (req, res) => {
  const id = journalId(req)
  const mode = revertModeOf(req)
  if (mode === null) return res.status(400).json({ error: 'Unbekannte Art des Rücksprungs.' })
  try {
    const done = id === null ? null : await writeData((db) => onDatabase((opened) => applyRevert(db, opened.journalSchema, id, mode, bodyObject(req).token, opened.schemaSteps, DATA_DIR, revertBlocked())))
    if (!done) return res.status(404).json({ error: JOURNAL_GONE })
    // Die Einstellungen liegen als Kopie im Arbeitsspeicher; ohne Neulesen schriebe das nächste PUT /api/settings den
    // Stand von vor dem Rücksprung zurück (wie nach dem Wiederherstellen).
    await refreshSettings()
    res.json({ ok: true, ...done })
  } catch (err) {
    if (err instanceof RevertRefused) return res.status(409).json({ error: err.message, preview: err.preview })
    throw err
  }
})

// **Sicherungspunkte** (#318): die wöchentlichen Vorversionen, die Sicherungen vor einem Update und vor dem Einspielen.
// Ein Name gilt nur nach dem Muster seiner Art (`parseSnapshotName`, prüft auch `path.basename`), sonst 400; der Pfad
// entsteht aus der eigenen Liste des Ordners, nie aus der Eingabe.
// Die Schritte dieser Version, einmal gelesen (sie ändern sich zur Laufzeit nicht).
let migrationTags: string[] | null = null
async function tagsOfMigrations(): Promise<string[]> {
  migrationTags ??= (await loadMigrations()).map((m) => m.tag)
  return migrationTags
}
function snapshotNotice(): SnapshotNotice {
  return migrationNotice ?? readNotice(DATA_DIR)
}
async function currentSnapshots(): Promise<SnapshotPoint[]> {
  return listSnapshots(DATA_DIR, await tagsOfMigrations(), snapshotNotice())
}
// Die offene Datenbank, wenn sie den Bestand trägt; sonst null (der Rettungsfall).
function stockDatabase(): OpenedDatabase | null {
  return database && databaseUnavailable(databaseState()) === null ? database : null
}
const SNAPSHOT_GONE = 'Diese Sicherung gibt es nicht (mehr). Bitte laden Sie die Seite neu.'

// Sucht den Sicherungspunkt zum Namen der Anfrage; antwortet selbst mit 400, 404 oder 503 und liefert dann null.
async function snapshotOf(req: Request, res: Response): Promise<SnapshotPoint | null> {
  const name = String(req.params.name)
  if (parseSnapshotName(name, new Set(await tagsOfMigrations())) === null) {
    res.status(400).json({ error: 'Diese Sicherung gibt es nicht.' })
    return null
  }
  if (priorVersionsRefusal(res)) return null
  const found = (await currentSnapshots()).find((entry) => entry.name === name)
  if (!found) {
    res.status(404).json({ error: SNAPSHOT_GONE })
    return null
  }
  return found
}

// Die Vorschau (db/snapshotPreview.ts): geprüft an einer Kopie, mit allem, was der Vermieter vorher wissen muss, und
// einer Marke. Sie schreibt nicht (DRY_RUN_ROUTES).
app.post('/api/prior-versions/:name/restore/preview', async (req, res) => {
  const point = await snapshotOf(req, res)
  if (!point) return
  res.json(await previewSnapshot(DATA_DIR, point, stockDatabase(), revertBlocked()))
})

// **Eingespielt wird über denselben Weg wie die Datenbank aus einem Backup**: prüfen
// (`archiveDatabaseProblem`: Integrität, neuerer Aufbau, Migrationskette nachholen, Verweise über
// Objekte, Zeiträume und Heizanlagen), dann `restoreDatabase` (bisherige als
// mietfuchs.sqlite.vor-restore, Hinweis nach einem Update weg, eine Schranke im Verlauf), dann die Einstellungen neu
// einlesen. Geprüft und eingespielt wird eine Kopie; die Sicherung selbst bleibt, wie sie ist, und lässt sich ein
// zweites Mal einspielen (ist sie selbst `mietfuchs.sqlite.vor-restore`, wird sie dabei mit Datum beiseitegelegt). Die
// Belege bleiben, wie sie sind: Was seither dazukam, bleibt im Belegordner, was seither gelöscht wurde, fehlt, und die
// Antwort nennt es. **Nur mit der Marke der Vorschau** (#318); stimmt sie nicht, 409 mit neuer Vorschau.
// **Zustimmungen** bringt die Sicherung nicht mit (Regel aus #439, `restoreConsent`): Jede Zeile trägt danach die
// Zustimmung von vorher, eine neu entstandene keine; ohne lesbare Datenbank gilt keine.
app.post('/api/prior-versions/:name/restore', async (req, res) => {
  const found = await snapshotOf(req, res)
  if (!found) return
  const source = snapshotFile(DATA_DIR, found)
  if (restoreRunning) return res.status(409).json({ error: 'Es läuft gerade eine Wiederherstellung. Bitte warten Sie, bis sie fertig ist.' })
  const blocked = revertBlocked()
  if (bodyObject(req).token !== await snapshotToken(DATA_DIR, found, stockDatabase()) || blocked.length > 0) {
    return res.status(409).json({
      error: blocked.length > 0 ? blocked.join(' ') : 'Die Sicherung oder der Verlauf hat sich inzwischen geändert. Bitte prüfen Sie das Einspielen noch einmal.',
      preview: await previewSnapshot(DATA_DIR, found, stockDatabase(), blocked),
    })
  }
  restoreRunning = true
  const staged = `${databaseFile(DATA_DIR)}.restore-${newId()}`
  try {
    try {
      fs.copyFileSync(source, staged)
    } catch (err) {
      fs.rmSync(staged, { force: true })
      return res.status(500).json({ error: `Die Sicherung ließ sich nicht kopieren: ${messageOf(err)} ${NOTHING_CHANGED}` })
    }
    const problem = await archiveDatabaseProblem(staged, 'priorVersion')
    if (problem) {
      fs.rmSync(staged, { force: true })
      return res.status(400).json({ error: problem })
    }
    let notes: string[]
    try {
      notes = await restoreDatabase(staged, 'priorVersion')
    } catch (err) {
      notes = [restoreFailedNote(err, 'Die Sicherung wurde geprüft', '')]
    }
    try {
      await refreshSettings()
    } catch (err) {
      notes = [...notes, `Die Einstellungen ließen sich nach dem Einspielen nicht lesen: ${messageOf(err)}`]
    }
    // Belege, auf die der eingespielte Stand verweist und die es nicht mehr gibt.
    try {
      const files = database
        ? await database.read((db) => db.selectDistinct({ file: costItemsTable.invoiceFile }).from(costItemsTable))
        : []
      const missing = files.map((f) => f.file).filter((f): f is string => !!f && !fs.existsSync(path.join(UPLOAD_DIR, path.basename(f))))
      if (missing.length > 0) {
        notes = [...notes, `${missing.length === 1 ? 'Ein Beleg, auf den dieser Stand verweist, fehlt' : `${missing.length} Belege, auf die dieser Stand verweist, fehlen`} im Belegordner, weil ${missing.length === 1 ? 'er' : 'sie'} seither gelöscht ${missing.length === 1 ? 'wurde' : 'wurden'}: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ' …' : ''}.`]
      }
    } catch {
      // Nur eine Auskunft; das Einspielen ist gelungen.
    }
    // Ebenso Logo und Briefpapier (#415, Teil 2b): Eine Vorversion enthält nur die Datenbank, und ein seither ersetztes
    // Logo oder Briefpapier ist weggeräumt. Gedruckt wird dann ohne; die Gestaltung lässt sich neu wählen.
    try {
      const names = database ? [...await database.read((db) => referencedDesignFiles(db))] : []
      const missing = names.filter((n) => !fs.existsSync(path.join(designDir(DATA_DIR), n)))
      if (missing.length > 0) {
        notes = [...notes, 'Logo oder Briefpapier dieses Stands sind seither ersetzt oder entfernt worden und fehlen; gedruckt wird ohne sie. Wählen Sie sie bei Bedarf in den Einstellungen unter „Logo und Briefpapier“ neu.']
      }
    } catch {
      // Nur eine Auskunft.
    }
    res.json({ ok: true, notes })
  } finally {
    restoreRunning = false
  }
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
  // Volle Platte beim Hochladen oder Schreiben: ein Satz statt der Meldung von Node.
  const full = diskFullMessage(err)
  if (full) return res.status(507).json({ error: full })
  if (err instanceof multer.MulterError) {
    const limit = req.path === '/restore' ? RESTORE_MAX_BYTES : req.path.includes('letter-design') ? LETTER_DESIGN_LIMITS.paper : UPLOAD_MAX_BYTES
    const message =
      err.code === 'LIMIT_FILE_SIZE' ? `Die Datei ist größer als ${limit >= 1024 ** 3 ? `${limit / 1024 ** 3} GB` : `${limit / 1024 / 1024} MB`}.`
        : err.code === 'LIMIT_UNEXPECTED_FILE' && err.field === 'pages' ? `Höchstens ${MAX_PAGES} Seitenbilder je Beleg.`
          : err.code === 'LIMIT_FIELD_VALUE' ? 'Ein Textfeld ist zu lang.'
            : `Hochladen fehlgeschlagen: ${err.message}`
    return res.status(400).json({ error: message })
  }
  // Eigene Heizkostenabrechnung (Heizung PR 10): die Liste der Positionen, die umzustellen sind.
  if (err instanceof SelfItemsError) return res.status(409).json({ error: err.message, items: err.items })
  // Das Zahlungsdatum (#255 PR 3): die Rückfrage mit eigenem Kennzeichen, wie beim Betriebsstrom.
  if (err instanceof PaidOnQuestion) return res.status(409).json({ error: err.message, question: 'paidOn' })
  // Das Jahr der Zahlung außerhalb der üblichen Spanne (#478, E2): dieselbe Gestalt, eigenes Kennzeichen.
  if (err instanceof TaxYearQuestion) return res.status(409).json({ error: err.message, question: 'taxYear' })
  // Die Verteilung nach § 82b EStDV (#262, E-9): dieselbe Gestalt, bestätigt mit `confirmSpread`.
  if (err instanceof SpreadQuestion) return res.status(409).json({ error: err.message, question: 'spread' })
  // Ablehnungen, deren Meldung schon für den Nutzer geschrieben ist (#92).
  if (err instanceof RouteProblem || err instanceof CrossPropertyError || err instanceof PeriodError || err instanceof PeriodConflict || err instanceof TenantChangeError || err instanceof BookingRefusal || err instanceof HeatingError || err instanceof LetterInputError || err instanceof LetterDesignError || err instanceof StaleTenancyError || err instanceof LawOverrideError || err instanceof IbanRefusal || err instanceof PaymentError || err instanceof ContractError || err instanceof LocalRentError) {
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
  // Die Version, auf die das Update ging (#318, für den Titel der Sicherung im Verlauf), nur wenn dieser Server eine
  // veröffentlichte Version ist: genau dann enthält sie so viele Schritte, wie er kennt.
  if (database && releaseStepsOf(APP_VERSION) === database.schemaSteps) migrationNotice.version = APP_VERSION
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

// Reste eines Wiederherstellens, das ein Absturz unterbrochen hat. Erst hier, nach dem Binden:
// Läuft schon ein Mietfuchs auf diesem Port, ist dieser Start oben ausgestiegen und räumt nichts
// weg, was jener gerade auspackt.
cleanRestoreLeftovers(DATA_DIR)

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
if (changeover.state === 'done') await markBarrier('changeover')
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

// Vorversion beim Start, bevor wartende Anfragen bedient werden (eine Kopie der Datenbank dauert
// bei einem privaten Bestand Bruchteile einer Sekunde), danach einmal am Tag. **Vor der Startzeile
// und nicht danach**: Wer auf „läuft auf …“ wartet (Tests, Skripte), hält den Server danach für
// fertig. Kam die Vorversion erst nach der Zeile, las der Server noch die Datei, während ein Test
// schon von außen hineinschrieb, und der scheiterte unter Last mit „database is locked“.
// Belegordner, Briefpapier und Papierkorb gegen den Bestand abgleichen (M1, K1), vor dem Aufräumen des Papierkorbs.
if (database && databaseUnavailable(databaseState()) === null) {
  for (const note of await reconcileAfterRestore()) console.log(note)
}
await checkPriorVersion()
setInterval(() => void checkPriorVersion(true), PRIOR_CHECK_INTERVAL_MS).unref()

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
  if (process.env.NKA_TEST_IDS === 'seq') console.log('Testgriff NKA_TEST_IDS aktiv: Kennungen werden fortlaufend ab 1 vergeben, nur für einen leeren Datenordner.')
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

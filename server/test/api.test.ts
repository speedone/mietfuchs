// Integrationstests gegen den echten Server: startet ihn als eigenen Prozess mit
// NKA_DATA_DIR auf einem Wegwerf-Ordner, damit weder eine vorhandene db.json noch die
// Belege im Arbeitsverzeichnis berührt werden. Geprüft wird, was die Engine-Tests nicht
// sehen: dass die generischen CRUD-Routen die neuen Felder durchlassen, dass die
// Löschkaskade aufräumt und dass die Abrechnungs-Routen liefern, was das Frontend erwartet.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import type { Readable } from 'node:stream'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'
import { createHash } from 'node:crypto'
import { LEGACY_JSON_NAME } from '../src/db/changeover.ts'
import { applyMigrations, connect, loadMigrations, type Database } from '../src/db/client.ts'
import { migrateLegacy, straightenForDatabase } from '../src/legacy/migrate.ts'
import { writeStock } from '../src/legacy/write.ts'
import { readClosedSettlements, readStock } from '../src/db/read.ts'
import { assessments as assessmentsTable, uploads as uploadsTable } from '../src/db/schema.ts'
import { LAW_AS_OF } from '../../shared/law/register.ts'
import { tenancyOverlaps } from '../../shared/tenancyOverlap.ts'
import { calendarPeriod } from '../../shared/period.ts'
import type { JsonSchema } from '../src/ai/ollama.ts'
import type {
  AiKeyInfo, AiPreset, AiRecommendations, AiSettings, AiSlot, AiSlotName, AiStatus, AssessmentLine, AssessmentView, BookingPreview, CostItem, Extraction, LineDecision, LineFields,
  Meter, MeterReadingExtraction, OllamaStatus, Payment, Property, Reading, Settings, Settlement, TaxReport, Tenancy, Unit, UnitDependents,
  UpdateStatus, UploadEntry, UploadInfo,
} from '../../shared/types.ts'
import type { Db } from '../src/store.ts'
import type { MigratedSettings } from '../src/ai/settings.ts'

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ---------- Was über die Routen zurückkommt ----------
//
// Eine Antwort ist JSON aus einem anderen Prozess: `res.json()` liefert deshalb `unknown`, und
// kein Typ kann prüfen, was wirklich ankommt — das tun die Zusicherungen. Der Aufruf nennt
// aber, was die Route zusagt, und wo das ein Typ aus shared/types.ts ist, prüft der Übersetzer
// mit, dass Route und Datenmodell zusammenpassen. Die eine Behauptung dieser Datei steckt
// deshalb hier, an einer Stelle und benannt, statt verstreut in jedem Test.
const jsonOf = <T>(res: Response): Promise<T> => res.json() as Promise<T>

// Der Betriebszustand aus /healthz (server/src/health.ts). Kein Typ des Datenmodells: Der
// Bericht ist für Container-Orchestratoren, nicht für die Oberfläche.
type HealthCheck = { ok: boolean, detail: string }
type HealthReport = {
  status: string
  version: string
  app: string
  checks: { data: HealthCheck, uploads: HealthCheck }
  // Die Datenbank (#55) steht bewusst neben `checks` und nicht darin: An diesem Stand arbeitet
  // Mietfuchs ohne sie weiter, und ein Fehler hier dürfte keinen Container neu starten lassen.
  database?: {
    open: boolean
    file: string
    migrations: number
    detail: string
    // Was beim Start mit den vorhandenen Daten geschehen ist. Aus diesem Eintrag erfährt es
    // auch die Oberfläche; beim Start aus einem Linux-Paket gibt es keine Konsole.
    changeover: { state: string, message: string, notes: string[] }
    // Hat dieser Start Schritte nachgeholt, die Sicherung davor (#154), sonst null.
    migrated: { steps: number, backup: string, at: string } | null
  }
}

// Die Antwort von /api/upload, /api/extract und /api/intake. Welche Felder gesetzt sind, hängt
// vom Status und der Belegart ab; die Tests prüfen erst den Status und lesen dann das Passende.
// Jede Kennzahl ist null, wenn der Anbieter sie nicht meldet (ProviderStats in ai/ollama.ts).
type AiStat = { step: string, promptTokens: number | null, outputTokens: number | null, seconds: number | null, loadSeconds: number | null }
type UploadBody = {
  file?: string
  kind?: string
  extraction?: Extraction
  reading?: MeterReadingExtraction
  stats?: AiStat[]
  error?: string
}

// Eine Zeile des Stroms (Accept: application/x-ndjson): `type` sagt, was sie bedeutet, die
// übrigen Felder gehören je nach Art dazu.
type StreamLine = {
  type?: 'progress' | 'heartbeat' | 'result' | 'error'
  step?: string
  phase?: string
  chars?: number
  status?: string
  total?: number
  completed?: number
  error?: string
  file?: string
  data?: UploadBody
}

// Was /api/settings liefert: die gespeicherten Einstellungen, ergänzt um die wirksamen
// KI-Einstellungen und um das, was die Oberfläche nur anzeigt. `ai` ist im Datenmodell optional,
// weil eine db.json von vor #18 es nicht kennt; über die Route kommt es immer, der Server
// ergänzt es beim Laden.
// Name und Adresse gehören seit #92 zum Objekt und kommen hier nicht mehr mit.
type ClientSettings = Omit<Settings, 'houseName' | 'address'> & {
  ai: AiSettings
  fixedByEnv: string[]
  aiKeys: Record<AiSlotName, AiKeyInfo>
  aiExternal: Record<AiSlotName, boolean>
}

// Die Meldung einer abgelehnten Anfrage. Fehlt sie, hat die Route etwas anderes geantwortet,
// und der Test soll genau das benennen statt an undefined zu scheitern.
const errorOf = (body: { error?: string }): string => {
  if (typeof body.error !== 'string') assert.fail(`keine Meldung in der Antwort: ${JSON.stringify(body).slice(0, 200)}`)
  return body.error
}

// Dieselbe Meldung, direkt aus einer Antwort gelesen.
const errorFrom = async (res: Response): Promise<string> => errorOf(await jsonOf<{ error?: string }>(res))

// Dasselbe für den Belegnamen, den /api/upload zurückgibt.
const fileOf = (body: { file?: string }): string => {
  if (typeof body.file !== 'string') assert.fail(`kein Beleg in der Antwort: ${JSON.stringify(body).slice(0, 200)}`)
  return body.file
}

// Der gespeicherte Bestand, an den Routen vorbei aus der Datenbank gelesen. Die Tests sehen
// hinein, weil der Schaden mancher Fehler gerade im dauerhaften Speichern besteht: Eine Route
// kann das Richtige antworten und das Falsche ablegen.
//
// Bis Aufgabe 6 stand hier die db.json. Sie wird seit dem Umstellen der Routen nicht mehr
// fortgeschrieben, ein Blick hinein sähe also den Stand von damals und nicht den von jetzt.
async function inDatabase<T>(s: { dataDir: string }, read: (db: Database) => Promise<T>): Promise<T> {
  const connection = await connect(path.join(s.dataDir, 'mietfuchs.sqlite'))
  try {
    return await read(connection.db)
  } finally {
    connection.close()
  }
}

const storedDb = (s: { dataDir: string }) => inDatabase(s, readStock)

// Die letzte Zeile eines Stroms. Ein leerer Strom ist immer ein Fehler.
const lastLine = (lines: StreamLine[]): StreamLine => {
  const line = lines.at(-1)
  if (!line) assert.fail('der Strom ist leer geblieben')
  return line
}

// Der Port eines nachgebauten Dienstes. address() kennt auch den Unix-Socket und den nicht
// lauschenden Server; beides kommt hier nicht vor, und wäre es doch so, hilft die Ansage.
const portOf = (server: http.Server | import('node:net').Server): number => {
  const address = server.address()
  if (address === null || typeof address === 'string') assert.fail('der nachgebaute Dienst lauscht nicht auf einem Port')
  return address.port
}

// Auf das Lauschen warten. listen() ruft ohne Argument zurück, deshalb der eigene Aufruf.
const listening = (server: http.Server | import('node:net').Server, host?: string): Promise<void> =>
  new Promise((r) => (host ? server.listen(0, host, () => r()) : server.listen(0, () => r())))

// ---------- Anfragen an die nachgebauten Dienste ----------
// Beide Seiten stehen in dieser Datei, deshalb steht hier genau, was geschickt und gelesen wird.

type OllamaMessage = { role: string, content: string, images?: string[] }
type OllamaBody = {
  model?: string
  messages?: OllamaMessage[]
  think?: boolean
  stream?: boolean
  options?: { temperature?: number, num_ctx?: number }
  format?: JsonSchema
}
type OllamaRequest = { url: string | undefined, body: OllamaBody, headers: http.IncomingHttpHeaders }

// Der Inhalt einer Nachricht an einen OpenAI-kompatiblen Dienst ist entweder Text oder eine
// Liste von Teilen (Text und Bilder).
type OpenAiContentPart = { type: string, text?: string, image_url?: { url: string } }
type OpenAiMessage = { role: string, content: string | OpenAiContentPart[] }
type OpenAiBody = {
  model?: string
  messages?: OpenAiMessage[]
  stream?: boolean
  stream_options?: { include_usage?: boolean }
  temperature?: number
  max_tokens?: number
  max_completion_tokens?: number
  response_format?: { type?: string, json_schema?: { strict?: boolean, schema?: JsonSchema } }
}
type OpenAiRequest = { url: string | undefined, method: string | undefined, body: OpenAiBody, raw: string, headers: http.IncomingHttpHeaders }

// Der Text einer Nachricht, gleich ob sie als Zeichenkette oder als Liste von Teilen kam.
const textOf = (m: OpenAiMessage): string =>
  typeof m.content === 'string' ? m.content : m.content.map((p) => p.text ?? '').join('')

// Die Teile einer Nachricht. Nur ein Beleg mit Bild wird so geschickt.
const partsOf = (m: OpenAiMessage): OpenAiContentPart[] => {
  if (typeof m.content === 'string') assert.fail('die Nachricht besteht nur aus Text, nicht aus Teilen')
  return m.content
}

// Die erste Nachricht einer Anfrage — ohne sie hätte der Dienst nichts zu tun gehabt.
const messageOf = <T>(messages: T[] | undefined): T => {
  const first = messages?.[0]
  if (!first) assert.fail('die Anfrage hat keine Nachricht mitgebracht')
  return first
}

// Einen Wegwerf-Ordner wieder loswerden, und zwar mit Wiederholungen.
//
// Seit die Datenbank beim Start geöffnet wird (#55), hält der Server eine Datei in diesem Ordner
// offen, solange sein Prozess lebt. Unter Windows lässt sich ein Ordner nicht löschen, solange
// darin etwas geöffnet ist, und `child.kill()` kehrt zurück, bevor der Prozess wirklich beendet
// ist. Ohne Wiederholung scheiterte das Aufräumen mit EPERM und riss den Test mit, obwohl an ihm
// nichts falsch war. Unter Linux und macOS ändert sich nichts: Dort darf ein geöffneter Pfad
// gelöscht werden.
//
// `maxRetries` von fs.rmSync genügt dafür nicht, nachgemessen: Diesen EPERM wiederholt es nicht.
// Gewartet wird deshalb selbst, und zwar blockierend, weil `stop()` an vielen Stellen im finally
// ohne await steht. Bleibt der Ordner am Ende doch liegen, ist das hinzunehmen: Ein Wegwerf-
// Ordner im Temp-Verzeichnis ist harmlos, ein wegen des Aufräumens rot gefärbter Test nicht.
const sleepSync = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

const removeDataDir = (dir: string): void => {
  for (let versuch = 0; versuch < 30; versuch++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
      return
    } catch {
      sleepSync(100)
    }
  }
}

// Startet eine Server-Instanz auf einem eigenen Datenordner und wartet auf Bereitschaft.
async function startServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
  return startServerIn(dataDir)
}

// Liest die Adresse aus der Startmeldung „Mietfuchs-Server läuft auf …“. Wirft, wenn der Prozess
// vorher endet oder die Meldung ausbleibt. Die Ausgabe wird danach weiter gelesen, sonst liefe
// der Puffer der Pipe voll und der Server bliebe beim nächsten console.log hängen.
function readStartUrl(child: ChildProcess & { stdout: Readable }, timeoutMs = 20000): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = ''
    let found = false
    const timer = setTimeout(() => reject(new Error(`Server ist nicht gestartet: ${output}`)), timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => {
      if (found) return
      output += chunk
      const match = output.match(/läuft auf (http:\/\/\S+)/)
      if (!match) return
      found = true
      clearTimeout(timer)
      resolve(match[1])
    })
    child.on('exit', (code: number | null) => {
      clearTimeout(timer)
      reject(new Error(`Server hat sich beendet (Code ${code}): ${output}`))
    })
  })
}

// `env` ergänzt oder überschreibt Umgebungsvariablen. NKA_UPDATE_URL zeigt standardmäßig ins
// Leere (Port 9 nimmt keine Verbindung an): Kein Test darf versehentlich das echte GitHub fragen.
// Die KI-Variablen aus der Shell des Entwicklers gelten nicht: Leere Werte zählen als nicht
// gesetzt, und eine leere Kandidatenliste schaltet die Suche nach Ollama ab.
//
// Den Port vergibt das System (NKA_PORT=0). Ein selbst gewählter Zufallsport lag im Bereich,
// aus dem Linux auch den nachgebauten Diensten der Tests Ports gibt, und traf gelegentlich einen
// belegten.
async function startServerIn(dataDir: string, env: NodeJS.ProcessEnv = {}) {
  const child = spawn(process.execPath, ['src/index.ts'], {
    cwd: serverRoot,
    env: {
      ...process.env,
      NKA_UPDATE_URL: 'http://127.0.0.1:9/kein-internet-im-test',
      NKA_OLLAMA_URL: '',
      NKA_OLLAMA_MODEL: '',
      NKA_OLLAMA_NUM_CTX: '',
      NKA_OLLAMA_CANDIDATES: '',
      NKA_AI_TIMEOUT: '',
      NKA_AI_PROVIDER: '',
      NKA_AI_URL: '',
      NKA_AI_MODEL: '',
      NKA_AI_API_KEY: '',
      NKA_AI_API_KEY_FILE: '',
      NKA_AI_MAX_TOKENS: '',
      NKA_RUNTIME: '',
      ...env,
      NKA_PORT: '0',
      NKA_DATA_DIR: dataDir,
      // **Hinter `...env`, damit es kein Aufrufer versehentlich abschaltet.** Ohne `CI` oeffnet
      // der Server den Standard-Browser, sobald er sich fuer die Programmdatei haelt, und genau
      // das tut ein Aufrufer weiter unten mit `NKA_RUNTIME: 'binary'`. Jeder volle Testlauf riss
      // damit einen Tab auf einem Zufallsport auf. Siehe die Regel in CLAUDE.md.
      CI: 'true',
    },
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const stop = () => {
    child.kill()
    removeDataDir(dataDir)
  }
  // Die ganze Konsolenausgabe, für Tests, die eine Meldung nach der Startzeile lesen (#180).
  let printed = ''
  child.stdout.on('data', (chunk: Buffer) => { printed += chunk })
  const output = () => printed
  let base
  try {
    base = await readStartUrl(child)
  } catch (err) {
    stop() // sonst hielte der verwaiste Prozess den Testlauf für immer offen
    throw err
  }
  const api = async <T = void>(urlPath: string, init?: RequestInit): Promise<T> => {
    const res = await fetch(`${base}${urlPath}`, {
      ...init,
      headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    })
    if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${urlPath} → ${res.status}`)
    return jsonOf<T>(res)
  }
  // Sicherung: der Server muss wirklich im Wegwerf-Ordner arbeiten, sonst nichts weiter tun.
  if (!fs.existsSync(path.join(dataDir, 'uploads'))) {
    stop()
    assert.fail('NKA_DATA_DIR wird nicht beachtet')
  }
  return { api, base, dataDir, stop, child, output }
}

let srv: Awaited<ReturnType<typeof startServerIn>>

before(async () => {
  srv = await startServer()
})

after(() => srv?.stop())

test('Healthcheck: /healthz antwortet als JSON mit Status ok', async () => {
  // Antwortete hier die index.html, stünde die Route hinter dem Frontend-Catch-All — dann
  // meldete ein kaputter Container HTTP 200.
  const report = await srv.api<HealthReport>('/healthz')
  assert.equal(report.status, 'ok')
  assert.equal(report.checks.data.ok, true)
  assert.equal(report.checks.uploads.ok, true)
})

// ---------- Die Datenbank beim Start (#55) ----------

test('Start: die Datenbank entsteht neben den Daten und steht im Zustandsbericht', async () => {
  // Geöffnet wird sie schon jetzt, obwohl noch keine fachlichen Daten darin liegen. Nur so
  // bündelt Bun das eingebaute SQLite in die Programmdatei, und nur so sagen die Prüfläufe auf
  // 22 Distributionen etwas über den Weg, den ein Vermieter wirklich geht.
  const report = await srv.api<HealthReport>('/healthz')
  if (!report.database) assert.fail(`der Zustandsbericht nennt die Datenbank nicht: ${JSON.stringify(report)}`)
  assert.equal(report.database.open, true, report.database.detail)
  assert.equal(report.database.file, path.join(srv.dataDir, 'mietfuchs.sqlite'))
  assert.ok(report.database.migrations >= 1, 'beim ersten Start laufen die Migrationen')
  assert.ok(fs.existsSync(report.database.file), 'die Datei liegt wirklich da')
})

test('Start: ohne db.json gibt es nichts zu übernehmen', async () => {
  // Der Wegwerf-Ordner ist leer, die db.json entsteht erst beim ersten Speichern. Der Umstieg
  // läuft trotzdem und sagt, dass er nichts zu tun hatte.
  const report = await srv.api<HealthReport>('/healthz')
  assert.equal(report.database?.changeover.state, 'none', JSON.stringify(report.database))
})

// ---------- Der Umstieg beim Start (#55) ----------

test('Start: eine vorhandene db.json wandert beim ersten Start in die Datenbank', async () => {
  // Der Weg, den ein Vermieter beim Update wirklich geht: Er startet die neue Version, und
  // seine Daten sind da. Kein Befehl, keine Rückfrage.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    settings: { houseName: 'Haus am Weg', address: 'Weg 1', landlordName: 'V', iban: '', paymentDeadlineDays: 30 },
    units: [{ id: 'u1', name: 'EG', areaM2: 80, participates: true }],
    tenancies: [{
      id: 't1', unitId: 'u1', tenantName: 'Müller', persons: 2,
      personHistory: [{ from: '2024-01-01', persons: 2 }], start: '2024-01-01', end: null,
      prepayments: [{ from: '2024-01', monthlyCents: 15000 }], prepaymentOverrides: {}, baseRents: [],
    }],
    costItems: [{ id: 'c1', year: 2024, category: 'Müllabfuhr', description: 'Abfall', amountCents: 12000, key: 'area' }],
    meters: [], readings: [], payments: [], closedSettlements: [],
  }))
  const s = await startServerIn(dataDir)
  try {
    const report = await s.api<HealthReport>('/healthz')
    assert.equal(report.database?.changeover.state, 'done', JSON.stringify(report.database))
    assert.match(String(report.database?.changeover.message), /Datenbank/)
    // Der Umstieg wendet zwar die ganze Kette an, aber auf eine neue Datei; eine Sicherung
    // davor gibt es nicht, der Rückweg ist die abgelöste db.json (#154). Also auch keine
    // zweite Meldung neben der des Umstiegs.
    assert.equal(report.database?.migrated, null)
    assert.deepEqual(fs.readdirSync(dataDir).filter((name) => name.includes('.vor-')), [])
    // Die db.json heißt danach anders, und das Protokoll liegt daneben. Ihr Inhalt bleibt der
    // Rückweg, aber unter einem Namen, den niemand für den laufenden Stand hält: Seit die Routen
    // die Datenbank schreiben, läge sie sonst tot im Ordner und sähe doch aus wie vorher.
    assert.equal(fs.existsSync(path.join(dataDir, 'db.json')), false, 'die db.json heißt noch wie vorher')
    assert.ok(fs.existsSync(path.join(dataDir, LEGACY_JSON_NAME)), 'die abgelöste db.json fehlt')
    assert.ok(fs.existsSync(path.join(dataDir, 'umstieg-protokoll.txt')), 'das Protokoll fehlt')
    assert.equal((await storedDb(s)).units.length, 1)
    // Und die Oberfläche bekommt die übernommenen Daten, also die aus der Datenbank.
    assert.deepEqual((await s.api<Unit[]>('/api/units')).map((u) => u.id), ['u1'])
    // Und die Datei für den Umstieg ist weg.
    assert.equal(fs.existsSync(path.join(dataDir, 'mietfuchs.sqlite.umstieg')), false)
  } finally {
    s.stop()
  }
})

test('Start: ein Bestand, der nicht übernommen werden kann, sperrt die Datenrouten', async () => {
  // **Hier kehrt sich die Regel um, und zwar seit die Routen die Datenbank lesen.** Vorher lief
  // Mietfuchs nach einem gescheiterten Umstieg mit der db.json weiter, und Blockieren wäre
  // schlimmer gewesen als Weitermachen. Jetzt stünde bei einem „Weiter" eine leere Datenbank als
  // Antwort da: Der Vermieter sähe ein leeres Haus, und speicherte er etwas hinein, gäbe es
  // danach zwei Bestände. Seine db.json wäre für immer abgehängt, denn der nächste Umstieg
  // unterbleibt, sobald in der Datenbank etwas steht. Deshalb gilt die zweite Zusage aus
  // changeover.ts vor der ersten: nie Daten verlieren, notfalls auf Kosten des Weiterarbeitens.
  //
  // Ein negativer Zählerstand ist über die Oberfläche erzeugbar, also genau der Fall, der einem
  // echten Vermieter passieren kann.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    settings: { houseName: 'Haus', address: '', landlordName: '', iban: '', paymentDeadlineDays: 30 },
    units: [{ id: 'u1', name: 'EG', areaM2: 80, participates: true }],
    tenancies: [], costItems: [],
    meters: [{ id: 'm1', name: 'Küche', unitId: 'u1', type: 'kaltwasser', unit: 'm³' }],
    readings: [{ id: 'r1', meterId: 'm1', date: '2024-12-31', value: -5 }],
    payments: [], closedSettlements: [],
  }))
  const s = await startServerIn(dataDir)
  try {
    const report = await jsonOf<HealthReport>(await fetch(`${s.base}/healthz`))
    assert.equal(report.status, 'error', 'ein Container soll das sehen')
    assert.equal(report.database?.changeover.state, 'failed', JSON.stringify(report.database))
    assert.match(String(report.database?.changeover.message), /Küche/, 'die Meldung nennt die Ablesung')

    // Die Datenrouten antworten, statt eine leere Datenbank für den Bestand auszugeben.
    const units = await fetch(`${s.base}/api/units`)
    assert.equal(units.status, 503)
    assert.match(await errorFrom(units), /nicht.*übernommen|db\.json/i, 'die Meldung erklärt nichts')

    // Und der Bestand liegt unberührt da, unter seinem eigenen Namen: Gescheitert heißt, dass
    // nichts angefasst wurde.
    assert.ok(fs.existsSync(path.join(dataDir, 'db.json')), 'die db.json ist weg')
    assert.equal(fs.existsSync(path.join(dataDir, LEGACY_JSON_NAME)), false, 'ein gescheiterter Umstieg benennt nichts um')
  } finally {
    s.stop()
  }
})

test('Start: eine unbrauchbare Datenbank sperrt die Datenrouten', async () => {
  // Dieselbe Umkehr wie beim gescheiterten Umstieg, nur eine Stufe früher: Ohne Datenbank gibt
  // es die Daten nicht, und etwas anderes vorzugeben wäre schlimmer als die Sperre.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
  fs.writeFileSync(path.join(dataDir, 'mietfuchs.sqlite'), 'das ist keine Datenbank, sondern Text')
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    settings: { houseName: 'Haus', address: '', landlordName: '', iban: '', paymentDeadlineDays: 30 },
    units: [{ id: 'u1', name: 'EG', areaM2: 80, participates: true }],
    tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [],
  }))
  const s = await startServerIn(dataDir)
  try {
    const report = await jsonOf<HealthReport>(await fetch(`${s.base}/healthz`))
    assert.equal(report.status, 'error', 'ein Container soll das sehen')
    if (!report.database) assert.fail('der Zustandsbericht nennt die Datenbank nicht')
    assert.equal(report.database.open, false)
    assert.match(report.database.detail, /beschädigt/)
    // Die Wohnungen gibt es nicht, und die Route sagt das, statt eine leere Liste zu liefern.
    const units = await fetch(`${s.base}/api/units`)
    assert.equal(units.status, 503)
    // Ohne geöffnete Datenbank gibt es keinen Umstieg. Wer eine db.json hat, soll erfahren,
    // warum seine Daten nicht umgezogen sind, und zwar an derselben Stelle wie sonst auch.
    assert.equal(report.database.changeover.state, 'failed')
    assert.match(report.database.changeover.message, /nicht öffnen/)
  } finally {
    s.stop()
  }
})

// ---------- Start aus dem Startmenü (#45) ----------

// Wartet, bis der Prozess endet, und liefert den Code. Wirft nach der Wartezeit.
const waitForExit = (child: ChildProcess, timeoutMs = 15000): Promise<number | null> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Der Prozess hat sich nicht beendet')), timeoutMs)
    child.on('exit', (code: number | null) => {
      clearTimeout(timer)
      resolve(code)
    })
  })

// Startet den Server, ohne auf die Startmeldung zu warten, und sammelt seine Ausgabe. Für die
// Fälle, in denen der Start gerade nicht gelingen soll.
function startServerRaw(dataDir: string, env: NodeJS.ProcessEnv = {}) {
  const child = spawn(process.execPath, ['src/index.ts'], {
    cwd: serverRoot,
    env: { ...process.env, NKA_UPDATE_URL: 'http://127.0.0.1:9/kein-internet-im-test', NKA_DATA_DIR: dataDir, CI: 'true', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (c: Buffer) => { output += c })
  child.stderr.on('data', (c: Buffer) => { output += c })
  return { child, out: () => output }
}

test('Healthcheck: /healthz nennt Mietfuchs beim Namen', async () => {
  // Daran erkennt ein zweiter Start, dass auf dem Port schon Mietfuchs läuft
  assert.equal((await srv.api<HealthReport>('/healthz')).app, 'mietfuchs')
})

test('Beenden: im npm-Betrieb gibt es die Route nicht', async () => {
  // Dort beendet die Umgebung den Dienst, und ein Neustart käme von selbst
  const res = await fetch(`${srv.base}/api/quit`, { method: 'POST' })
  assert.equal(res.status, 404)
  assert.match(await errorFrom(res), /Programmdatei/)
})

test('Beenden: als Programmdatei antwortet Mietfuchs erst und endet dann', async () => {
  const s = await startServerIn(fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-')), { NKA_RUNTIME: 'binary' })
  try {
    // Erst die Bestätigung, dann das Ende: Sonst sähe der Browser einen Verbindungsabbruch
    assert.deepEqual(await s.api('/api/quit', { method: 'POST' }), { ok: true })
    assert.equal(await waitForExit(s.child), 0)
  } finally {
    s.stop()
  }
})

test('Belegter Port: läuft dort schon Mietfuchs, endet der zweite Start ohne Fehler', async () => {
  // Ein zweiter Klick im Startmenü ist kein Fehler. Der zweite Start öffnet nur die Oberfläche
  // (hier mit CI=true unterdrückt) und beendet sich.
  const port = new URL(srv.base).port
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
  const zweiter = startServerRaw(dataDir, { NKA_PORT: port, NKA_RUNTIME: 'binary' })
  try {
    assert.equal(await waitForExit(zweiter.child), 0)
    assert.match(zweiter.out(), /läuft bereits/)
  } finally {
    zweiter.child.kill()
    removeDataDir(dataDir)
  }
})

test('Belegter Port: sitzt dort etwas anderes, bleibt es bei der Fehlermeldung', async () => {
  const fremder = http.createServer((req, res) => res.end('nicht Mietfuchs'))
  // Auf allen Adressen lauschen, nicht nur auf 127.0.0.1: Windows lässt sonst eine zweite
  // Bindung an 0.0.0.0 auf demselben Port zu, und der Port wäre gar nicht belegt.
  await listening(fremder)
  const port = String(portOf(fremder))
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
  const start = startServerRaw(dataDir, { NKA_PORT: port, NKA_RUNTIME: 'binary' })
  try {
    // Die Programmdatei lässt die Meldung zehn Sekunden stehen, bevor sie endet. Geprüft wird
    // deshalb die Meldung, nicht das Ende.
    const deadline = Date.now() + 15000
    while (!/bereits belegt/.test(start.out()) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100))
    assert.match(start.out(), /bereits belegt/)
  } finally {
    start.child.kill()
    fremder.close()
    removeDataDir(dataDir)
  }
})

// Dieselbe Falle wie bei PUT /api/settings, hier in den generischen CRUD-Routen: express.json()
// lässt auch eine Liste als Rumpf durch. Deren Indizes landeten als Schlüssel „0“, „1“ … im
// Datensatz und blieben in der db.json stehen. Geprüft an /api/units, die Routen entstehen für
// alle sechs Collections in derselben Schleife.

// Die Spalten der Wohnungstabelle, wie SQLite sie wirklich führt. Das ist der einzige Ort, an
// dem sich ein zusätzliches Feld zeigen könnte: Ein eingelesener Datensatz hat immer genau die
// Schlüssel, die read.ts hinschreibt.
const UNIT_COLUMNS = ['id', 'property_id', 'name', 'area_m2', 'participates', 'self_used', 'self_persons', 'mea', 'rooms', 'floor', 'notes']

async function unitColumns(dataDir: string): Promise<string[]> {
  const connection = await connect(path.join(dataDir, 'mietfuchs.sqlite'))
  try {
    return connection.rows(`SELECT name FROM pragma_table_info('units')`).map((zeile) => String(zeile[0]))
  } finally {
    connection.close()
  }
}

test('Anlegen: ein Rumpf, der kein Objekt ist, legt keine Indizes als Felder an', async () => {
  const res = await fetch(`${srv.base}/api/units`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(['unsinn', 'noch mehr']),
  })
  assert.equal(res.status, 201)
  const created = await jsonOf<Unit>(res)
  try {
    // **Gefragt werden die Spalten und nicht der eingelesene Bestand.** read.ts baut jede Zeile
    // als Objektliteral mit festen Schlüsseln; ein `'0' in stored` darüber könnte gar nicht mehr
    // wahr werden und prüfte deshalb nichts. Die Spalten der Tabelle sind die einzige Stelle, an
    // der sich ein zusätzliches Feld überhaupt zeigen könnte, und sie sagen zugleich, warum es
    // seit #60 keines mehr geben kann: Für ein unbekanntes Feld gibt es keinen Ort.
    assert.deepEqual(await unitColumns(srv.dataDir), UNIT_COLUMNS, 'die Tabelle hat eine Spalte zu viel')
    assert.ok(!('0' in created))
    const listed = (await srv.api<Unit[]>('/api/units')).find((u) => u.id === created.id)
    assert.ok(listed && !('0' in listed))
    // Und aus einem Rumpf, der kein Objekt ist, wird ein leerer Datensatz und kein Unsinn.
    assert.equal(created.name, '')
  } finally {
    await srv.api(`/api/units/${created.id}`, { method: 'DELETE' })
  }
})

test('Ändern: ein Rumpf, der kein Objekt ist, lässt den Datensatz unangetastet', async () => {
  const unit = await srv.api<Unit>('/api/units', {
    method: 'POST',
    body: JSON.stringify({ name: 'Rumpfprobe', areaM2: 50, participates: true }),
  })
  try {
    const res = await fetch(`${srv.base}/api/units/${unit.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(['unsinn', 'noch mehr']),
    })
    assert.equal(res.status, 200)
    const updated = await jsonOf<Unit>(res)
    // Zuerst die Platte: Der Schaden bestand im dauerhaften Speichern. Gefragt werden die
    // Spalten, siehe die Begründung beim Anlegen darüber.
    assert.deepEqual(await unitColumns(srv.dataDir), UNIT_COLUMNS, 'die Tabelle hat eine Spalte zu viel')
    const stored = (await storedDb(srv)).units.find((u) => u.id === unit.id)
    assert.equal(stored?.name, 'Rumpfprobe', 'der Datensatz ist angetastet worden')
    assert.equal(stored?.areaM2, 50)
    assert.ok(!('0' in updated))
    assert.equal(updated.name, 'Rumpfprobe')
  } finally {
    await srv.api(`/api/units/${unit.id}`, { method: 'DELETE' })
  }
})

test('Wohnungen: Eigennutzungs-Felder überleben Anlegen und Ändern', async () => {
  const unit = await srv.api<Unit>('/api/units', {
    method: 'POST',
    body: JSON.stringify({ name: 'EG', areaM2: 80, participates: false, selfUsed: true, selfPersons: 2 }),
  })
  assert.equal(unit.selfUsed, true)
  assert.equal(unit.selfPersons, 2)
  const updated = await srv.api<Unit>(`/api/units/${unit.id}`, {
    method: 'PUT',
    body: JSON.stringify({ name: 'EG', areaM2: 80, participates: true, selfUsed: false, selfPersons: null }),
  })
  assert.equal(updated.selfUsed, false)
  // **Geleert heißt seit dem Umstieg „nicht da" und nicht mehr `null`.** Die Oberfläche schickt
  // zum Leeren weiterhin `null` (unitForm.ts), aber `Unit.selfPersons` ist als `number | undefined`
  // beschrieben und kennt gar kein `null`. Die db.json legte jeden Wert unbesehen ab und gab
  // deshalb `null` zurück, was dem eigenen Typ widersprach; die Spalte kennt nur NULL, und
  // read.ts macht daraus das fehlende Feld, das der Typ vorsieht. Für die Berechnung ist beides
  // dasselbe, nämlich keine Zahl.
  assert.equal(updated.selfPersons, undefined)
  await srv.api(`/api/units/${unit.id}`, { method: 'DELETE' })
})

test('Staffel: zwei Einträge zum selben Stichtag werden angenommen, der letzte gilt', async () => {
  // **Das ist über die Oberfläche erzeugbar und deshalb keine Spitzfindigkeit.** Stammdaten.tsx
  // setzt für eine Staffelzeile ohne Monat den Einzugsmonat ein und prüft nie auf Doppelung;
  // zwei so ausgefüllte Zeilen ergeben zwei Einträge zum selben Stichtag. Über die db.json war
  // das hingenommen, in der Datenbank ist der Stichtag Teil des Primärschlüssels.
  //
  // Angenommen wird es trotzdem, und zwar nach derselben Regel, die legacy/migrate.ts beim Umstieg
  // anwendet und calc.ts beim Rechnen: **Es gilt der letzte.** Alles andere wäre ein Rückschritt
  // gegenüber der db.json, und zwar bei einer ganz gewöhnlichen Eingabe.
  const unit = await srv.api<Unit>('/api/units', {
    method: 'POST',
    body: JSON.stringify({ name: 'Staffelprobe', areaM2: 60, participates: true }),
  })
  try {
    const tenancy = await srv.api<Tenancy>('/api/tenancies', {
      method: 'POST',
      body: JSON.stringify({
        unitId: unit.id, tenantName: 'Doppelt', start: '2024-01-01', end: null, persons: 1,
        personHistory: [{ from: '2024-01-01', persons: 1 }, { from: '2024-01-01', persons: 3 }],
        prepayments: [{ from: '2024-01', monthlyCents: 10000 }, { from: '2024-01', monthlyCents: 25000 }],
        baseRents: [{ from: '2024-01', monthlyCents: 50000 }, { from: '2024-01', monthlyCents: 60000 }],
        prepaymentOverrides: {},
      }),
    })
    assert.deepEqual(tenancy.prepayments, [{ from: '2024-01', monthlyCents: 25000 }])
    assert.deepEqual(tenancy.baseRents, [{ from: '2024-01', monthlyCents: 60000 }])
    assert.deepEqual(tenancy.personHistory, [{ from: '2024-01-01', persons: 3 }])

    // Und beim Ändern genauso: Derselbe Weg, dieselbe Regel.
    const geaendert = await srv.api<Tenancy>(`/api/tenancies/${tenancy.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        prepayments: [{ from: '2025-01', monthlyCents: 11100 }, { from: '2025-01', monthlyCents: 22200 }],
      }),
    })
    assert.deepEqual(geaendert.prepayments, [{ from: '2025-01', monthlyCents: 22200 }])
  } finally {
    await srv.api(`/api/units/${unit.id}`, { method: 'DELETE' })
  }
})

test('Fehler der Datenbank kommen als Satz an, nicht als SQL mit den Daten des Nutzers', async () => {
  // **Der teuerste Teil einer durchgereichten Drizzle-Meldung sind nicht das SQL, sondern die
  // Werte.** Sie lautet „Failed query: insert into … params: t1,2024-01,200", enthält also die
  // eigenen Daten des Nutzers in einer Fehlermeldung. db/errors.ts ist dafür geschrieben; dieser
  // Test hält fest, dass es an den Routen auch wirklich angewendet wird. Ohne ihn war es
  // importiert und niemals aufgerufen.
  //
  // Ausgelöst über einen Verweis ins Leere, weil das der Fall ist, den ein fremdes Skript an der
  // Schnittstelle am ehesten erzeugt.
  const res = await fetch(`${srv.base}/api/readings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ meterId: 'gibt-es-nicht', date: '2024-12-31', value: 100 }),
  })
  assert.equal(res.status, 400, 'ein Verweis ins Leere kommt aus der Anfrage und nicht vom Server')
  const fehler = await errorFrom(res)
  assert.doesNotMatch(fehler, /Failed query|insert into|params:/, 'SQL oder Werte in der Meldung')
  assert.doesNotMatch(fehler, /gibt-es-nicht/, 'die Eingabe des Nutzers steht in der Meldung')
  assert.match(fehler, /verweist auf etwas|gibt es nicht|nicht mehr/i, 'die Meldung erklärt nichts')
})

test('Abrechnung: Eigenanteil kommt über die Route beim Frontend an', async () => {
  const selfUsedUnit = await srv.api<Unit>('/api/units', {
    method: 'POST',
    body: JSON.stringify({ name: 'EG', areaM2: 80, participates: false, selfUsed: true, selfPersons: 2 }),
  })
  const rentedUnit = await srv.api<Unit>('/api/units', {
    method: 'POST',
    body: JSON.stringify({ name: 'OG', areaM2: 150, participates: true }),
  })
  const tenancy = await srv.api<Tenancy>('/api/tenancies', {
    method: 'POST',
    body: JSON.stringify({
      unitId: rentedUnit.id, tenantName: 'Familie A', start: '2020-01-01', end: null,
      personHistory: [{ from: '2020-01-01', persons: 2 }], prepayments: [], baseRents: [], prepaymentOverrides: {},
    }),
  })
  const costItem = await srv.api<CostItem>('/api/costItems', {
    method: 'POST',
    body: JSON.stringify({ year: 2031, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 230000, key: 'area' }),
  })

  const s = await srv.api<Settlement>('/api/settlement/2031')
  assert.equal(s.statements[0].totalShareCents, 150000) // 150 von 230 m²
  assert.equal(s.landlord.totalCents, 80000)
  assert.equal(s.selfUsedShareCents, 80000)

  const tax = await srv.api<TaxReport>('/api/taxreport/2031')
  assert.equal(tax.selfUsedShareCents, 80000)
  assert.equal(tax.selfOccupiedExists, true)

  await srv.api(`/api/costItems/${costItem.id}`, { method: 'DELETE' })
  await srv.api(`/api/tenancies/${tenancy.id}`, { method: 'DELETE' })
  await srv.api(`/api/units/${selfUsedUnit.id}`, { method: 'DELETE' })
  await srv.api(`/api/units/${rentedUnit.id}`, { method: 'DELETE' })
})

test('Löschen einer Wohnung entfernt ihren vereinbarten Prozentanteil', async () => {
  const a = await srv.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'A', areaM2: 50, participates: true }) })
  const b = await srv.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'B', areaM2: 50, participates: true }) })
  const item = await srv.api<CostItem>('/api/costItems', {
    method: 'POST',
    body: JSON.stringify({
      year: 2032, category: 'Sonstige Betriebskosten', description: 'Vereinbart',
      amountCents: 100000, key: 'custom', customShares: { [a.id]: 40, [b.id]: 60 },
    }),
  })
  await srv.api(`/api/units/${b.id}`, { method: 'DELETE' })
  const items = await srv.api<CostItem[]>('/api/costItems')
  const itemAfter = items.find((x) => x.id === item.id)
  // Verschwundene Position und fehlender Schlüssel wären andere Befunde als ein
  // zurückgebliebener Anteil, deshalb hier prüfen statt einen leeren Schlüssel einzusetzen.
  if (!itemAfter) assert.fail('die Kostenposition ist verschwunden')
  if (!itemAfter.customShares) assert.fail('der vereinbarte Schlüssel der Position fehlt ganz')
  assert.deepEqual(Object.keys(itemAfter.customShares), [a.id], 'Anteil der gelöschten Wohnung bleibt zurück')

  await srv.api(`/api/costItems/${item.id}`, { method: 'DELETE' })
  await srv.api(`/api/units/${a.id}`, { method: 'DELETE' })
})

test('Standardmodell: eine neue Installation nutzt qwen3.5:4b', async () => {
  assert.equal((await srv.api<ClientSettings>('/api/settings')).ollamaModel, 'qwen3.5:4b')
})

test('Standardmodell: das frühere, nie vorhandene qwen3.6-35b wird umgestellt, andere Modelle bleiben', async () => {
  // „qwen3.6-35b“ gab es in der Ollama-Bibliothek nie (gemeint war qwen3.6:35b), wer es nicht
  // geändert hat, konnte also gar nicht auswerten. Eine eigene Wahl bleibt unangetastet.
  const cases: [string, string][] = [['qwen3.6-35b', 'qwen3.5:4b'], ['gemma4:12b', 'gemma4:12b']]
  for (const [stored, expected] of cases) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-alt-'))
    fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ settings: { ollamaModel: stored } }))
    const s = await startServerIn(dataDir)
    try {
      assert.equal((await s.api<ClientSettings>('/api/settings')).ollamaModel, expected, stored)
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
    const s = await legacyServer.api<Settlement>('/api/settlement/2030')
    assert.equal(s.selfUsedShareCents, 0)
    assert.equal(s.closed?.closedAt, '2031-01-05')
  } finally {
    legacyServer.stop()
  }
})

// ---------- Versanddatum der abgeschlossenen Abrechnung (§556 BGB) ----------
//
// An diesem Datum hängt die Frist aus §556 BGB, und die Oberfläche vergleicht es als
// Zeichenkette mit dem 31.12. des Folgejahrs. Ein beliebiger Wert aus dem Rumpf der Anfrage
// darf dort deshalb nie ankommen — er bliebe dauerhaft in der db.json stehen.

// Der eingefrorene Stand eines Jahres, so wie er auf der Platte steht. Gelesen wird die
// gespeicherte Fassung und nicht die Sicht des Schnappschusses: Geprüft wird hier `sentAt`,
// und das liest die Berechnung gar nicht.
const closedOf = async (s: { dataDir: string }, year: number) =>
  (await inDatabase(s, readClosedSettlements)).find((c) => c.period === calendarPeriod(year))

// Alles, was kein Datum als JJJJ-MM-TT ist: falscher Typ, deutsche Schreibweise, Zeitstempel
// und Tage, die es im Kalender nicht gibt.
const NO_DATES: unknown[] = [
  42, true, { tag: 1 }, ['2041-03-14'], 'morgen', '14.03.2041', '2041-03-14T10:00:00Z', '2041-02-30', '2041-13-01',
]

// Eine Anfrage, die scheitern soll — s.api wirft sonst schon am Status.
const closeRequest = (method: string, year: number, body: unknown): Promise<Response> =>
  fetch(`${srv.base}/api/settlement/${year}/close`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

test('Versanddatum: ohne Angabe abgeschlossen, mit Datum nachgetragen, leer wieder gelöscht', async () => {
  await srv.api('/api/settlement/2040/close', { method: 'POST', body: JSON.stringify({}) })
  assert.equal((await closedOf(srv, 2040))?.sentAt, null)

  // So schickt es die Oberfläche aus <input type="date">
  await srv.api('/api/settlement/2040/close', { method: 'PUT', body: JSON.stringify({ sentAt: '2041-03-14' }) })
  assert.equal((await closedOf(srv, 2040))?.sentAt, '2041-03-14')

  // Ein geleertes Feld heißt „doch noch nicht versendet"
  await srv.api('/api/settlement/2040/close', { method: 'PUT', body: JSON.stringify({ sentAt: null }) })
  assert.equal((await closedOf(srv, 2040))?.sentAt, null)

  await srv.api('/api/settlement/2040/close', { method: 'DELETE' })
})

test('Abschließen friert Hinweise und Rechtsstand mit ein (#112)', async () => {
  // Gespeichert und nicht beim Lesen neu gerechnet: Eine spätere Änderung am Regelverzeichnis
  // darf eine versandte Abrechnung nicht rückwirkend anders erklären.
  await srv.api('/api/settlement/2044/close', { method: 'POST', body: JSON.stringify({}) })
  try {
    const gespeichert = (await closedOf(srv, 2044))?.settlement
    if (!gespeichert || typeof gespeichert !== 'object') return assert.fail('keine eingefrorene Abrechnung')
    const stand = Reflect.get(gespeichert, 'legalBasis')
    assert.equal(Reflect.get(stand, 'asOf'), LAW_AS_OF)
    assert.ok(Array.isArray(Reflect.get(stand, 'rules')))
    assert.ok(Array.isArray(Reflect.get(stand, 'values')), 'seit Heizung PR 1 frieren die Rechtswerte mit ein')
    assert.ok(Array.isArray(Reflect.get(gespeichert, 'notices')))
    const geliefert = await srv.api<{ legalBasis?: { asOf: string }, notices?: unknown[] }>('/api/settlement/2044')
    assert.equal(geliefert.legalBasis?.asOf, LAW_AS_OF)
    assert.ok(Array.isArray(geliefert.notices))
  } finally {
    await srv.api('/api/settlement/2044/close', { method: 'DELETE' })
  }
})

test('Abschließen friert die Rechtswerte ein, und direkt danach weicht keiner ab (Heizung PR 1)', async () => {
  const u = await srv.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'Recht', areaM2: 50, participates: true }) })
  await srv.api<Tenancy>('/api/tenancies', { method: 'POST', body: JSON.stringify({
    unitId: u.id, tenantName: 'Rechtswert', persons: 1, personHistory: [], start: '2049-01-01', end: '2049-12-31',
    prepayments: [], prepaymentOverrides: {}, baseRents: [],
  }) })
  await srv.api('/api/costItems', { method: 'POST', body: JSON.stringify({ year: 2049, category: 'Heizung und Warmwasser', description: 'Heizöl', amountCents: 50000, key: 'area' }) })
  await srv.api('/api/settlement/2049/close', { method: 'POST', body: JSON.stringify({}) })
  try {
    const gespeichert = (await closedOf(srv, 2049))?.settlement
    if (!gespeichert || typeof gespeichert !== 'object') return assert.fail('keine eingefrorene Abrechnung')
    const values = Reflect.get(Reflect.get(gespeichert, 'legalBasis'), 'values')
    if (!Array.isArray(values)) return assert.fail('keine Rechtswerte eingefroren')
    const cut = values.find((v) => Reflect.get(v, 'id') === 'hkv.cut.not-by-consumption')
    assert.equal(Reflect.get(cut, 'text'), '15 %')
    const geliefert = await srv.api<Settlement>('/api/settlement/2049')
    assert.ok(geliefert.legalBasis?.values?.some((v) => v.id === 'hkv.cut.not-by-consumption'))
    assert.deepEqual(geliefert.deviation?.valueChanges, [])
  } finally {
    await srv.api('/api/settlement/2049/close', { method: 'DELETE' })
  }
})

test('Abgeschlossenes Jahr: weicht die heutige Berechnung ab, sagt die Antwort es je Mieter (#56)', async () => {
  const u = await srv.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'Abw', areaM2: 50, participates: true }) })
  const t = await srv.api<Tenancy>('/api/tenancies', { method: 'POST', body: JSON.stringify({
    unitId: u.id, tenantName: 'Abweichung', persons: 1, personHistory: [], start: '2047-01-01', end: '2047-12-31',
    prepayments: [{ from: '2047-01', monthlyCents: 10000 }], prepaymentOverrides: {}, baseRents: [],
  }) })
  const k = await srv.api<{ id: string }>('/api/costItems', { method: 'POST', body: JSON.stringify({ year: 2047, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 50000, key: 'direct', directUnitId: u.id }) })
  await srv.api('/api/settlement/2047/close', { method: 'POST', body: JSON.stringify({}) })
  try {
    const vorher = await srv.api<Settlement>('/api/settlement/2047')
    assert.deepEqual(vorher.deviation?.deviations, [], 'direkt nach dem Abschluss weicht nichts ab')
    assert.equal(vorher.deviation?.comparable, true)
    await srv.api(`/api/costItems/${k.id}`, { method: 'PUT', body: JSON.stringify({ amountCents: 40000 }) })
    const nachher = await srv.api<Settlement>('/api/settlement/2047')
    const d = nachher.deviation?.deviations.find((x) => x.tenancyId === t.id)
    assert.deepEqual([d?.differenceCents, d?.direction], [10000, 'tenant'])
    assert.equal(nachher.deviation?.deadline, '2048-12-31')
    const eingefroren = nachher.statements.find((st) => st.tenancyId === t.id)
    assert.equal(eingefroren?.totalShareCents, 50000, 'der eingefrorene Stand bleibt, wie er war')
  } finally {
    await srv.api('/api/settlement/2047/close', { method: 'DELETE' })
  }
})

test('Wiederöffnen behält den verschickten Stand im Verlauf, erneutes Abschließen legt einen weiteren daneben (#56)', async () => {
  const u = await srv.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'Verlauf', areaM2: 50, participates: true }) })
  await srv.api<Tenancy>('/api/tenancies', { method: 'POST', body: JSON.stringify({
    unitId: u.id, tenantName: 'Verlauf', persons: 1, personHistory: [], start: '2048-01-01', end: '2048-12-31',
    prepayments: [], prepaymentOverrides: {}, baseRents: [],
  }) })
  const k = await srv.api<{ id: string }>('/api/costItems', { method: 'POST', body: JSON.stringify({ year: 2048, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 30000, key: 'direct', directUnitId: u.id }) })
  await srv.api('/api/settlement/2048/close', { method: 'POST', body: JSON.stringify({ sentAt: '2049-02-01' }) })
  await srv.api('/api/settlement/2048/close', { method: 'DELETE' })
  let history = await srv.api<{ closedAt: string, sentAt: string | null, reopenedAt: string, settlement: { totalCostsCents: number } }[]>('/api/settlement/2048/history')
  assert.equal(history.length, 1, 'der verschickte Stand ist nicht verloren')
  assert.equal(history[0]?.sentAt, '2049-02-01')
  assert.equal(history[0]?.settlement.totalCostsCents, 30000)
  assert.match(history[0]?.reopenedAt ?? '', /^\d{4}-\d{2}-\d{2}T/)
  await srv.api(`/api/costItems/${k.id}`, { method: 'PUT', body: JSON.stringify({ amountCents: 25000 }) })
  await srv.api('/api/settlement/2048/close', { method: 'POST', body: JSON.stringify({}) })
  try {
    const gueltig = await srv.api<Settlement>('/api/settlement/2048')
    assert.equal(gueltig.totalCostsCents, 25000, 'gültig ist der neue Abschluss')
    history = await srv.api('/api/settlement/2048/history')
    assert.equal(history.length, 1, 'der gültige Stand steht nicht im Verlauf')
  } finally {
    await srv.api('/api/settlement/2048/close', { method: 'DELETE' })
  }
  history = await srv.api('/api/settlement/2048/history')
  assert.deepEqual(history.map((h) => h.settlement.totalCostsCents), [25000, 30000], 'neueste zuerst')
})

test('Abschließen: ein zweites Mal für dasselbe Jahr wird abgelehnt, und zwar mit einem Satz', async () => {
  // Die Route fragt vor dem Einfrieren, ob es für das Jahr schon eine abgeschlossene Abrechnung
  // gibt. Fiele diese Frage weg, käme statt einer Erklärung der Verstoß gegen den eindeutigen
  // Index heraus. Beides hat keinen Test gehabt: weder der 409 noch die Meldung.
  await srv.api('/api/settlement/2043/close', { method: 'POST', body: JSON.stringify({}) })
  try {
    const zweites = await fetch(`${srv.base}/api/settlement/2043/close`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    assert.equal(zweites.status, 409)
    const fehler = await errorFrom(zweites)
    assert.match(fehler, /2043/, 'die Meldung nennt das Jahr nicht')
    assert.doesNotMatch(fehler, /UNIQUE|Failed query|insert into/, 'die Meldung kommt aus der Datenbank')
    // Und der erste Stand steht unverändert da.
    assert.equal((await closedOf(srv, 2043))?.sentAt, null)
  } finally {
    await srv.api('/api/settlement/2043/close', { method: 'DELETE' })
  }
})

test('Versanddatum: was kein Datum ist, kommt nicht in die db.json', async () => {
  await srv.api('/api/settlement/2041/close', { method: 'POST', body: JSON.stringify({ sentAt: '2042-05-02' }) })
  for (const sentAt of NO_DATES) {
    const res = await closeRequest('PUT', 2041, { sentAt })
    assert.equal(res.status, 400, `angenommen: ${JSON.stringify(sentAt)}`)
    assert.match(await errorFrom(res), /Versanddatum/)
  }
  assert.equal((await closedOf(srv, 2041))?.sentAt, '2042-05-02', 'das gespeicherte Datum wurde überschrieben')

  await srv.api('/api/settlement/2041/close', { method: 'DELETE' })
})

test('Versanddatum: ein ungültiges Datum friert die Abrechnung gar nicht erst ein', async () => {
  for (const sentAt of NO_DATES) {
    const res = await closeRequest('POST', 2042, { sentAt })
    assert.equal(res.status, 400, `angenommen: ${JSON.stringify(sentAt)}`)
  }
  assert.equal(await closedOf(srv, 2042), undefined)
})

// ---------- Update-Hinweis ----------
// Ein nachgebauter GitHub-Server liefert die echte Antwort der Releases-API, umgeschrieben auf
// eine neuere Version. Er zählt mit, damit sich belegen lässt, dass ohne Zustimmung nichts
// hinausgeht.

const serverVersion: string = JSON.parse(fs.readFileSync(path.join(serverRoot, 'package.json'), 'utf8')).version
// Die abgespeicherte echte Antwort der Releases-API, umgeschrieben auf eine höhere Version,
// damit der Hinweis anspringt.
const releaseFixture = fs.readFileSync(path.join(serverRoot, 'test', 'fixtures', 'github-release-latest.json'), 'utf8')
const releaseJson = releaseFixture.replaceAll(JSON.parse(releaseFixture).tag_name as string, 'v9.9.9')

async function fakeGitHub() {
  const http = await import('node:http')
  const requests: (string | undefined)[] = []
  const server = http.createServer((req, res) => {
    requests.push(req.url)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(releaseJson)
  })
  await listening(server, '127.0.0.1')
  const url = `http://127.0.0.1:${portOf(server)}/repos/speedone/mietfuchs/releases/latest`
  return { url, requests, stop: () => server.close() }
}

type Server = Awaited<ReturnType<typeof startServerIn>>
type GitHub = Awaited<ReturnType<typeof fakeGitHub>>

async function withUpdateServer(env: NodeJS.ProcessEnv, fn: (s: Server, github: GitHub) => Promise<void>) {
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
    const status = await s.api<UpdateStatus>('/api/update')
    assert.equal(status.enabled, false)
    assert.equal(status.available, false)
    // auch „Jetzt prüfen" darf ohne Zustimmung nichts anfragen
    await s.api('/api/update/check', { method: 'POST', body: '{}' })
    await s.api<ClientSettings>('/api/settings', { method: 'PUT', body: JSON.stringify({ updateCheck: 'off' }) })
    await s.api('/api/update')
    assert.equal(github.requests.length, 0)
  })
})

test('Update-Hinweis: mit Zustimmung meldet der Server die neue Version', async () => {
  await withUpdateServer({}, async (s, github) => {
    await s.api<ClientSettings>('/api/settings', { method: 'PUT', body: JSON.stringify({ updateCheck: 'on' }) })
    const status = await s.api<UpdateStatus>('/api/update')
    assert.equal(github.requests.length, 1)
    assert.equal(status.enabled, true)
    assert.equal(status.current, serverVersion)
    assert.equal(status.latest, '9.9.9')
    assert.equal(status.available, true)
    assert.equal(status.mode, 'npm') // der Test startet den Server mit node, ohne Programmdatei
    assert.equal(status.releaseUrl, 'https://github.com/speedone/mietfuchs/releases/tag/v9.9.9')
    // Bis zum nächsten Tag kommt das gemerkte Ergebnis. „Jetzt prüfen" fragt neu, aber höchstens
    // einmal pro Minute; wann genau, prüft update.test.ts mit gestellter Uhr.
    await s.api('/api/update')
    assert.equal(github.requests.length, 1)
    const rechecked = await s.api<UpdateStatus>('/api/update/check', { method: 'POST', body: '{}' })
    assert.equal(github.requests.length, 1)
    assert.equal(rechecked.latest, '9.9.9')
  })
})

test('Update-Hinweis: im Docker-Container lautet die Betriebsart docker', async () => {
  await withUpdateServer({ NKA_RUNTIME: 'docker' }, async (s) => {
    await s.api<ClientSettings>('/api/settings', { method: 'PUT', body: JSON.stringify({ updateCheck: 'on' }) })
    const status = await s.api<UpdateStatus>('/api/update')
    assert.equal(status.mode, 'docker')
    assert.equal(status.downloadUrl, null)
  })
})

test('Version: /healthz und der Update-Hinweis nennen die Version aus package.json', async () => {
  const report = await srv.api<HealthReport>('/healthz')
  const status = await srv.api<UpdateStatus>('/api/update')
  assert.equal(report.version, serverVersion)
  assert.equal(status.current, serverVersion)
})

// ---------- KI-Auswertung: Text und Seitenbilder kommen aus dem Browser (#21) ----------
// Der Server öffnet keine PDFs mehr selbst. Ollama ersetzt ein lokaler Server, der jede
// Anfrage mitschreibt und eine feste Antwort liefert.

const LONG_TEXT =
  'Stadtwerke Musterstadt, Rechnung Nr. 4711 vom 15.03.2026. Frischwasser 12,50 EUR, Schmutzwasser 8,20 EUR. Gesamt 20,70 EUR.'

// Eine Antwort, die sich nicht an ihr Schema hält: Beträge deutsch als Text, einer fehlt ganz,
// einer ist gar keine Zahl, dazu ein erfundenes Feld und eines, das nur Mietfuchs selbst setzen
// darf. So antwortet ein kleines Modell auf dem eigenen Rechner, wenn der Dienst das Schema
// nicht durchsetzt, und das ist die Voreinstellung.
const OFF_SCHEMA = {
  vendor: 'Stadtwerke Musterstadt',
  totalGrossEur: '1.234,56',
  invoiceNumber: 'R-4711',
  amountsAdjusted: 'netto',
  positions: [
    { description: 'Frischwasser', category: 'Wasser/Abwasser', amountEur: '12,50', labor35aEur: '4,20' },
    { description: 'Grundgebühr', category: 'Wasser/Abwasser' },
    { description: 'Schmutzwasser', category: 'Wasser/Abwasser', amountEur: 'siehe Anlage' },
  ],
}

// Antwortet wie Ollama 0.34: /api/tags listet die Modelle, /api/show nennt ihre Fähigkeiten,
// und ein unbekanntes Modell ergibt 404. Ohne `capabilities` verhält es sich wie eine ältere
// Ollama-Version, die das Feld noch nicht kennt. /api/chat streamt standardmäßig zeilenweise
// JSON (NDJSON), die letzte Zeile trägt `done: true`, den Grund und die Kennzahlen.
//
// `chat` schaltet Störungen der Auswertung: 'hang' schickt nie etwas, 'hangAfterFirstChunk'
// verstummt nach dem ersten Stück, 'length' endet am Kontextende mit halbem JSON, 'error'
// schickt mitten im Strom eine Fehlerzeile, 'rejectThinkOff' lehnt `think: false` ab wie
// manche Modelle bei Ollama Cloud, 'offSchema' antwortet an seinem Schema vorbei wie ein
// kleines Modell ohne erzwungenes JSON. Mit `key` verlangt der Dienst diesen Bearer-Schlüssel und
// antwortet sonst mit 401. `closedEarly` zählt Chat-Anfragen, deren Verbindung Mietfuchs vor
// dem Ende getrennt hat. `garbledShow` lässt /api/show mit einer nicht lesbaren Antwort
// antworten, die den Schlüssel enthält (Befund aus der Codeprüfung: readJson gab ihn ungeprüft
// weiter).
// Ein Modell, wie der nachgebaute Dienst es kennt (Ollamas /api/tags und /api/show).
type FakeModel = { name: string, size?: number, capabilities?: string[], remote_host?: string }
// Eine erfundene Rechnung für die Belegbuchung (#170). Das nachgebaute Ollama wählt sie, wenn ihr
// Kennwort im Text der Anfrage steht, und beantwortet den Durchgang der Kostenarten mit ihren.
type FakeInvoice = {
  vendor: string
  invoiceDate?: string
  totalGrossEur?: number
  positions: { description: string, category: string, amountEur: number | null, labor35aEur?: number | null }[]
}
type FakeOllamaOptions = {
  invoices?: Record<string, FakeInvoice>
  models?: FakeModel[]
  chat?: 'normal' | 'netto' | 'offSchema' | 'hang' | 'hangAfterFirstChunk' | 'length' | 'error' | 'rejectThinkOff' | 'meter'
  key?: string | null
  echoKey?: boolean
  garbledShow?: boolean
}

async function fakeOllama({ models = [{ name: 'test:latest', capabilities: ['completion', 'vision'] }], chat = 'normal', key = null, echoKey = false, garbledShow = false, invoices }: FakeOllamaOptions = {}) {
  const http = await import('node:http')
  const requests: OllamaRequest[] = []
  const open = new Set<http.ServerResponse>()
  const state: { closedEarly: number, lastInvoice: FakeInvoice | null } = { closedEarly: 0, lastInvoice: null }
  // Steuert den nachgebauten Dienst während eines Tests, etwa für den Abbruch beim Laden
  const control = { pullHangs: false }
  const findModel = (name = '') => models.find((m) => m.name === (name.includes(':') ? name : `${name}:latest`))
  const modelOf = (body: OllamaBody): string => body.model ?? ''
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (d) => { body += d })
    req.on('end', () => {
      const json: OllamaBody = body ? JSON.parse(body) : {}
      requests.push({ url: req.url, body: json, headers: req.headers })
      const send = (status: number, data: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(data))
      }
      const notFound = () => send(404, { error: `model '${modelOf(json)}' not found` })
      if (req.url === '/api/version') return send(200, { version: '0.34.2' })
      if (key && req.headers.authorization !== `Bearer ${key}`) return send(401, { error: 'unauthorized' })
      if (echoKey) return send(400, { error: `Proxy lehnt ab: ${req.headers.authorization}` })
      if (req.url === '/api/tags') {
        return send(200, { models: models.map(({ capabilities, ...m }) => ({ size: 1000, ...m })) })
      }
      // Wie Ollama beim Laden eines Modells: zeilenweise JSON mit Schritt und Fortschritt.
      // `pullHangs` bleibt nach der ersten Zeile still, für den Abbruch.
      if (req.url === '/api/pull') {
        res.writeHead(200, { 'content-type': 'application/x-ndjson' })
        open.add(res)
        res.on('close', () => { open.delete(res); if (!res.writableFinished) state.closedEarly++ })
        const line = (obj: unknown) => res.write(`${JSON.stringify(obj)}\n`)
        line({ status: 'pulling manifest' })
        if (control.pullHangs) return
        line({ status: 'pulling 4b2c1f', digest: '4b2c1f', total: 3_600_000_000, completed: 1_800_000_000 })
        line({ status: 'success' })
        return res.end()
      }
      if (req.url === '/api/show') {
        if (garbledShow) {
          res.writeHead(200, { 'content-type': 'text/plain' })
          return res.end(`kaputt: ${req.headers.authorization}`)
        }
        const m = findModel(modelOf(json))
        return m ? send(200, { capabilities: m.capabilities, remote_host: m.remote_host }) : notFound()
      }
      if (!findModel(modelOf(json))) return notFound()
      // Eine Rechnung mit Nettopositionen und dem Lohnanteil als Gesamtbetrag (#34)
      if (chat === 'netto' && !json.format?.properties?.categories) {
        const netto = {
          vendor: 'Schornsteinfegerei Muster',
          totalGrossEur: 101.86,
          positionsAreNet: true,
          vatRatePercent: 19,
          labor35aTotalEur: 90.56,
          positions: [
            { description: 'Feuerstättenschau', category: 'Schornsteinfeger', amountEur: 28.7 },
            { description: 'Kehren der Abgasleitung', category: 'Schornsteinfeger', amountEur: 24.8 },
            { description: 'Abgaswegeüberprüfung', category: 'Schornsteinfeger', amountEur: 22.6 },
            { description: 'Fahrtkostenpauschale', category: 'Schornsteinfeger', amountEur: 9.5 },
          ],
        }
        res.writeHead(200, { 'content-type': 'application/x-ndjson' })
        res.write(`${JSON.stringify({ message: { role: 'assistant', content: JSON.stringify(netto) }, done: false })}\n`)
        return res.end(`${JSON.stringify({ message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 10, eval_count: 5 })}\n`)
      }
      if (chat === 'rejectThinkOff' && json.think === false) {
        return send(400, { error: `think value "false" is not supported for "${modelOf(json)}"` })
      }
      // Den zweiten Durchgang (nur Kategorien) erkennt man am Schema
      // 'meter': Das Foto ist ein Zählerstand (Schuhkarton der Schnellerfassung)
      // Belegbuchung (#170): die Rechnung, deren Kennwort in der Anfrage steht. Der Durchgang
      // der Kostenarten nennt die Positionen nicht beim Kennwort, er bekommt die zuletzt gewählte.
      const chosen = invoices ? Object.entries(invoices).find(([marker]) => JSON.stringify(json.messages ?? []).includes(marker))?.[1] : undefined
      if (chosen) state.lastInvoice = chosen
      const content = JSON.stringify(
        json.format?.properties?.docType
          ? { docType: chat === 'meter' ? 'zaehlerstand' : 'rechnung' }
          : json.format?.properties?.meterNumber
            ? { meterNumber: '4711', value: 123.4, dateOnImage: null }
        : json.format?.properties?.categories
          ? { categories: invoices && state.lastInvoice ? state.lastInvoice.positions.map((p) => p.category) : ['Wasser/Abwasser'] }
          : chosen
            ? chosen
            : chat === 'offSchema'
            ? OFF_SCHEMA
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
      const line = (obj: unknown) => res.write(`${JSON.stringify(obj)}\n`)
      const piece = (text: string) => ({ message: { role: 'assistant', content: text }, done: false })
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
  await listening(server, '127.0.0.1')
  return {
    url: `http://127.0.0.1:${portOf(server)}`,
    requests,
    control,
    get closedEarly() { return state.closedEarly },
    stop: () => {
      for (const res of open) res.destroy()
      server.close()
    },
  }
}

type Ollama = Awaited<ReturnType<typeof fakeOllama>>
type WithOllamaOptions = { models?: FakeModel[], model?: string, chat?: FakeOllamaOptions['chat'], env?: NodeJS.ProcessEnv, invoices?: Record<string, FakeInvoice> }

async function withOllama(fn: (s: Server, ollama: Ollama) => Promise<void>, { models, model = 'test', chat, env = {}, invoices }: WithOllamaOptions = {}) {
  const ollama = await fakeOllama({ models, chat, invoices })
  const s = await startServerIn(fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-')), env)
  try {
    await s.api<ClientSettings>('/api/settings', { method: 'PUT', body: JSON.stringify({ ollamaUrl: ollama.url, ollamaModel: model }) })
    await fn(s, ollama)
  } finally {
    s.stop()
    ollama.stop()
  }
}

// Der Inhalt des PDFs spielt keine Rolle mehr: Der Server liest es nicht, er legt es nur ab.
const PDF = Buffer.from('%PDF-1.4\n%Mietfuchs-Test\n')
const page = (n: number) => new Blob([Buffer.from(`JPEG-Seite-${n}`)], { type: 'image/jpeg' })
const base64 = (n: number) => Buffer.from(`JPEG-Seite-${n}`).toString('base64')

async function uploadPdf(s: Server, route: string, { text, pages = [] }: { text?: string, pages?: Blob[] } = {}) {
  const fd = new FormData()
  fd.append('file', new Blob([PDF], { type: 'application/pdf' }), 'rechnung.pdf')
  if (text !== undefined) fd.append('pdfText', text)
  pages.forEach((b, i) => fd.append('pages', b, `seite-${i + 1}.jpg`))
  const res = await fetch(`${s.base}${route}`, { method: 'POST', body: fd })
  return { status: res.status, body: await jsonOf<UploadBody>(res) }
}

const chatRequests = (ollama: Ollama) => ollama.requests.filter((a) => a.url === '/api/chat')
const firstMessage = (ollama: Ollama): OllamaMessage => {
  const first = chatRequests(ollama)[0]
  if (!first) assert.fail('Ollama wurde gar nicht gefragt')
  return messageOf(first.body.messages)
}

test('KI-Auswertung: PDF mit Textebene geht als Text an Ollama, ohne Bilder', async () => {
  await withOllama(async (s, ollama) => {
    const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT, pages: [page(1)] })
    assert.equal(r.status, 200)
    assert.equal(r.body.extraction?.vendor, 'Stadtwerke Musterstadt')
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
    assert.match(errorOf(r.body), /Oberfläche/)
    assert.equal(chatRequests(ollama).length, 0)
  })
})

test('KI-Auswertung: Seitenbilder landen nicht im Belegarchiv', async () => {
  await withOllama(async (s) => {
    const uploadsBefore = (await s.api<UploadInfo[]>('/api/uploads')).length
    await uploadPdf(s, '/api/extract', { pages: [page(1), page(2), page(3)] })
    const uploadsAfter = await s.api<UploadInfo[]>('/api/uploads')
    assert.equal(uploadsAfter.length, uploadsBefore + 1)
    assert.match(uploadsAfter.map((u) => u.file).join(' '), /rechnung\.pdf/)
  })
})

test('KI-Auswertung: mehr als vier Seitenbilder lehnt der Server ab, ohne Reste im Archiv', async () => {
  await withOllama(async (s, ollama) => {
    const uploadsBefore = (await s.api<UploadInfo[]>('/api/uploads')).length
    const r = await uploadPdf(s, '/api/extract', { pages: [1, 2, 3, 4, 5].map(page) })
    assert.equal(r.status, 400)
    assert.match(errorOf(r.body), /Höchstens 4 Seitenbilder/)
    assert.equal(chatRequests(ollama).length, 0)
    assert.equal((await s.api<UploadInfo[]>('/api/uploads')).length, uploadsBefore)
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
    assert.match(errorOf(r.body), /Seitenbild ist größer als 5 MB/)
    assert.equal(chatRequests(ollama).length, 0)
    assert.equal((await s.api<UploadInfo[]>('/api/uploads')).length, 0)
  })
})

test('KI-Auswertung: ein überlanger Text ergibt eine lesbare Meldung', async () => {
  await withOllama(async (s) => {
    const r = await uploadPdf(s, '/api/extract', { text: 'x'.repeat(1024 * 1024 + 1) })
    assert.equal(r.status, 400)
    assert.match(errorOf(r.body), /Textfeld ist zu lang/)
    assert.equal((await s.api<UploadInfo[]>('/api/uploads')).length, 0)
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
    const file = fileOf(await jsonOf<UploadBody>(res))
    assert.match(file, /^\d+_Beleg_Müll_2025\.pdf$/)
    assert.deepEqual((await s.api<UploadInfo[]>('/api/uploads')).map((u) => u.file), [file])
    const download = await fetch(`${s.base}/uploads/${encodeURIComponent(file)}`)
    assert.equal(download.status, 200)
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), PDF)
  } finally {
    s.stop()
  }
})

test('Belegarchiv: ein verknüpfter Beleg lässt sich nicht löschen', async () => {
  // **Der Schutz muss die Datenbank fragen und nicht die db.json.** Fragte er die Datei, sähe
  // er nach dem Umstieg einen leeren Bestand, jeder Beleg gälte als unbenutzt, und ein Klick im
  // Belegarchiv löschte die Rechnung unter einer Kostenposition weg. Die Oberfläche zeigte
  // danach eine Position ohne Beleg, und die Datei wäre fort.
  const s = await startServer()
  try {
    const fd = new FormData()
    fd.append('file', new Blob([PDF], { type: 'application/pdf' }), 'Rechnung.pdf')
    const file = fileOf(await jsonOf<UploadBody>(await fetch(`${s.base}/api/upload`, { method: 'POST', body: fd })))

    const item = await s.api<CostItem>('/api/costItems', {
      method: 'POST',
      body: JSON.stringify({
        year: 2025, category: 'Müllabfuhr', description: 'Abfall', amountCents: 12000,
        key: 'area', invoiceFile: file,
      }),
    })

    const verweigert = await fetch(`${s.base}/api/uploads/${encodeURIComponent(file)}`, { method: 'DELETE' })
    assert.equal(verweigert.status, 409)
    assert.match(await errorFrom(verweigert), /verknüpft/)
    assert.deepEqual((await s.api<UploadInfo[]>('/api/uploads')).map((u) => u.file), [file], 'die Datei ist weg')

    // Ohne Kostenposition darf sie weg, sonst bliebe im Archiv für immer liegen, was niemand
    // mehr braucht.
    await s.api(`/api/costItems/${item.id}`, { method: 'DELETE' })
    const gelöscht = await fetch(`${s.base}/api/uploads/${encodeURIComponent(file)}`, { method: 'DELETE' })
    assert.equal(gelöscht.status, 200)
    assert.deepEqual(await s.api<UploadInfo[]>('/api/uploads'), [])
  } finally {
    s.stop()
  }
})

test('Beleg anhängen: Umlaute in zerlegter Unicode-Form (macOS) werden zusammengesetzt', async () => {
  const s = await startServer()
  try {
    const fd = new FormData()
    fd.append('file', new Blob([PDF], { type: 'application/pdf' }), 'Müll.pdf') // „ü“ als u + Trema
    const file = fileOf(await jsonOf<UploadBody>(await fetch(`${s.base}/api/upload`, { method: 'POST', body: fd })))
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
    assert.equal(typeof (await jsonOf<{ error?: string }>(res)).error, 'string')
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
    assert.match(await errorFrom(res), /größer als 25 MB/)
    assert.equal((await s.api<UploadInfo[]>('/api/uploads')).length, 0)
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

async function withEnv(env: NodeJS.ProcessEnv, fn: (s: Server) => Promise<void>) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
  const s = await startServerIn(dataDir, env)
  try {
    await fn(s)
  } finally {
    s.stop()
  }
}

// Die Einstellungen, wie sie wirklich in der Datenbank stehen. Was die Oberfläche nur anzeigt
// (fixedByEnv, aiKeys, aiExternal), darf dort gerade nicht stehen, und deshalb ist hier bewusst
// nicht ClientSettings der Typ: Diese Felder bleiben optional, mehrere Tests prüfen ihr Fehlen.
const storedSettings = async (s: { dataDir: string }): Promise<MigratedSettings> => {
  const settings = (await storedDb(s)).settings
  const { ai } = settings
  if (!ai) assert.fail('in der Datenbank fehlen die KI-Einstellungen')
  return { ...settings, ai }
}

test('Ollama: NKA_OLLAMA_URL und NKA_OLLAMA_MODEL gelten und sind als fest markiert', async () => {
  await withEnv({ NKA_OLLAMA_URL: 'http://ki.intern:11434', NKA_OLLAMA_MODEL: 'env-modell:4b' }, async (s) => {
    const settings = await s.api<ClientSettings>('/api/settings')
    assert.equal(settings.ollamaUrl, 'http://ki.intern:11434')
    assert.equal(settings.ollamaModel, 'env-modell:4b')
    // Die alten Namen für Tabs von vor dem Update, dazu die Pfade der KI-Einstellungen
    assert.deepEqual(settings.fixedByEnv, ['ollamaUrl', 'ollamaModel', 'ai.text.url', 'ai.text.model'])
    assert.equal(settings.ai.text.url, 'http://ki.intern:11434')
    assert.equal(settings.ai.text.model, 'env-modell:4b')
  })
})

test('Ollama: Speichern lässt fest vorgegebene Werte unberührt, alles andere wird gespeichert', async () => {
  await withEnv({ NKA_OLLAMA_URL: 'http://ki.intern:11434' }, async (s) => {
    const response = await s.api<ClientSettings>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ ollamaUrl: 'http://anders:11434', ollamaModel: 'eigenes:2b', landlordName: 'Vermieterin', fixedByEnv: [] }),
    })
    assert.equal(response.ollamaUrl, 'http://ki.intern:11434')
    assert.deepEqual(response.fixedByEnv, ['ollamaUrl', 'ai.text.url'])
    const stored = await storedSettings(s)
    assert.equal(stored.ollamaUrl, 'http://localhost:11434') // Standard bleibt, Env landet nicht in der db.json
    assert.equal(stored.ai.text.url, 'http://localhost:11434')
    assert.equal(stored.ollamaModel, 'eigenes:2b')
    assert.equal(stored.ai.text.model, 'eigenes:2b')
    assert.equal(stored.landlordName, 'Vermieterin')
    assert.equal(stored.fixedByEnv, undefined)
  })
})

test('Ollama: Variablen aus der Shell des Entwicklers erreichen die Test-Server nicht', async () => {
  // Wer NKA_OLLAMA_URL für sein eigenes Ollama gesetzt hat, soll keine Testbelege dorthin schicken
  const saved: Record<string, string | undefined> = { NKA_OLLAMA_URL: process.env.NKA_OLLAMA_URL, NKA_OLLAMA_CANDIDATES: process.env.NKA_OLLAMA_CANDIDATES }
  process.env.NKA_OLLAMA_URL = 'http://aus-der-shell.invalid:11434'
  process.env.NKA_OLLAMA_CANDIDATES = 'http://aus-der-shell.invalid:11434'
  try {
    const s = await startServer()
    try {
      const settings = await s.api<ClientSettings>('/api/settings')
      assert.deepEqual(settings.fixedByEnv, [])
      assert.equal(settings.ollamaUrl, 'http://localhost:11434')
    } finally {
      s.stop()
    }
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})

test('Ollama: leere Umgebungsvariablen zählen als nicht gesetzt', async () => {
  await withEnv({ NKA_OLLAMA_URL: '', NKA_OLLAMA_MODEL: '  ' }, async (s) => {
    const settings = await s.api<ClientSettings>('/api/settings')
    assert.deepEqual(settings.fixedByEnv, [])
    assert.equal(settings.ollamaUrl, 'http://localhost:11434')
  })
})

test('Ollama: die Auswertung nutzt Adresse und Modell aus der Umgebung', async () => {
  const ollama = await fakeOllama({ models: [{ name: 'env-modell:4b', capabilities: ['completion'] }] })
  try {
    await withEnv({ NKA_OLLAMA_URL: ollama.url, NKA_OLLAMA_MODEL: 'env-modell:4b' }, async (s) => {
      await s.api<ClientSettings>('/api/settings', { method: 'PUT', body: JSON.stringify({ ollamaModel: 'db-modell' }) })
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

const chatOptions = (ollama: Ollama) => chatRequests(ollama).map((a) => ({ think: a.body.think, ...a.body.options }))

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

// Ungültige Werte verhindern den Start (siehe „fehlerhafte Schlüssel-Variablen“ weiter unten)
test('Ollama: NKA_OLLAMA_NUM_CTX ändert die Kontextgröße', async () => {
  const ollama = await fakeOllama()
  try {
    await withEnv({ NKA_OLLAMA_URL: ollama.url, NKA_OLLAMA_MODEL: 'test', NKA_OLLAMA_NUM_CTX: '8192' }, async (s) => {
      await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
      assert.equal(chatOptions(ollama)[0].num_ctx, 8192)
      assert.ok((await s.api<ClientSettings>('/api/settings')).fixedByEnv.includes('ai.numCtx'))
    })
  } finally {
    ollama.stop()
  }
})

// ---------- Ollama: Streaming, Zeitlimit und Abbruch (#17) ----------
// Ohne Streaming schickt Ollama die Antwort-Header erst mit der fertigen Antwort, und fetch
// bricht unter Node wie unter Bun nach 300 Sekunden ohne Header ab. Mietfuchs streamt deshalb
// und spricht Ollama ohne diese Grenze an. Es gilt nur das eigene Zeitlimit, und das soll als
// solches gemeldet werden, nicht als „nicht erreichbar“.

const until = async (condition: () => boolean, ms = 5000) => {
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
const parseLine = (line: string): StreamLine => JSON.parse(line)
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

test('Ollama: ein nicht installiertes Modell nennt den Befehl zum Laden', async () => {
  await withOllama(async (s) => {
    const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.equal(r.status, 502)
    assert.match(errorOf(r.body), /„fehlt:4b“ ist in Ollama nicht installiert/)
    assert.match(errorOf(r.body), /ollama pull fehlt:4b/)
  }, { model: 'fehlt:4b' })
})

test('Ollama: ein Modell ohne Bildverständnis bekommt keine Bilder, sondern eine klare Meldung', async () => {
  await withOllama(async (s, ollama) => {
    const scan = await uploadPdf(s, '/api/extract', { pages: [page(1)] })
    assert.equal(scan.status, 502)
    assert.match(errorOf(scan.body), /„text:8b“ versteht keine Bilder/)
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

// ---------- Backup und Wiederherstellung (#23) ----------
// Ein Backup ist ein ZIP mit db.json und uploads/. Beim Zurückspielen darf ein fremdes oder
// kaputtes Archiv nie einen halb ersetzten Datenstand hinterlassen.

async function restore(s: Server, zipBuffer: Buffer) {
  const fd = new FormData()
  fd.append('file', new Blob([zipBuffer], { type: 'application/zip' }), 'backup.zip')
  const res = await fetch(`${s.base}/api/restore`, { method: 'POST', body: fd })
  const contentType = res.headers.get('content-type') ?? ''
  return { status: res.status, contentType, body: contentType.includes('json') ? await jsonOf<{ error?: string }>(res) : { error: await res.text() } }
}

async function withData(fn: (s: Server, data: { unit: Unit, file: string }) => Promise<void>) {
  const s = await startServer()
  try {
    const unit = await s.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 80, participates: true }) })
    const fd = new FormData()
    fd.append('file', new Blob([Buffer.from('%PDF-Beleg')], { type: 'application/pdf' }), 'Gebührenbescheid Müll.pdf')
    const file = fileOf(await jsonOf<UploadBody>(await fetch(`${s.base}/api/upload`, { method: 'POST', body: fd })))
    await fn(s, { unit, file })
  } finally {
    s.stop()
  }
}

// Ein Archiv mit gültiger db.json und frei wählbaren weiteren Einträgen
// `db` ist der Inhalt der db.json im Archiv: ein Bestand, eine rohe Zeichenkette (fuer eine
// kaputte Datei) oder null (gar keine db.json).
function archive(entries: Record<string, string | Buffer> = {}, db: unknown = { units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], settings: {} }): Buffer {
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
    assert.deepEqual((await s.api<Unit[]>('/api/units')).map((u) => u.id), [unit.id])
    assert.deepEqual((await s.api<UploadInfo[]>('/api/uploads')).map((u) => u.file), [file]) // Umlaute überleben das ZIP
  })
})

test('Backup: die Datei heißt nach dem Programm, nicht nach seinem alten Namen (#142)', async () => {
  await withData(async (s) => {
    const res = await fetch(`${s.base}/api/backup`)
    await res.arrayBuffer()
    assert.match(res.headers.get('content-disposition') ?? '', /filename="mietfuchs-backup-\d{4}-\d{2}-\d{2}\.zip"/)
  })
})

test('Backup: Belege behalten beim Wiederherstellen ihr Datum (#142)', async () => {
  // Vorher trug jeder Beleg danach das Datum der Wiederherstellung, und im Belegarchiv sah eine
  // Rechnung von 2023 aus wie gestern hochgeladen.
  await withData(async (s, { file }) => {
    const before = new Date('2023-03-14T10:20:30Z')
    fs.utimesSync(path.join(s.dataDir, 'uploads', file), before, before)
    const backup = Buffer.from(await (await fetch(`${s.base}/api/backup`)).arrayBuffer())
    fs.rmSync(path.join(s.dataDir, 'uploads', file))
    assert.equal((await restore(s, backup)).status, 200)
    const listed = (await s.api<UploadInfo[]>('/api/uploads')).find((u) => u.file === file)
    if (!listed) return assert.fail('Beleg fehlt nach dem Wiederherstellen')
    // Ein ZIP speichert die Zeit auf zwei Sekunden genau.
    assert.ok(Math.abs(new Date(listed.mtime).getTime() - before.getTime()) <= 2000, `Datum ${listed.mtime}`)
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
    assert.match(errorOf(r.body), /kein gültiges ZIP/)
    assert.deepEqual((await s.api<Unit[]>('/api/units')).map((u) => u.id), [unit.id])
  })
})

test('Backup: ein Archiv mit beschädigten Daten wird abgelehnt, ohne etwas zu ersetzen (#59)', async () => {
  // Bisher genügte es, dass die db.json gültiges JSON ist. `{"units": null}` kam damit durch,
  // und danach beantwortete der Server keine einzige Anfrage mehr: Beim Einlesen verdrängt das
  // `null` den Vorgabewert, die Liste ist keine mehr, und jeder weitere Aufruf scheitert erneut.
  await withData(async (s, { unit, file }) => {
    const kaputt = { settings: {}, units: null, tenancies: [], costItems: [], meters: [], readings: [], payments: [] }
    const r = await restore(s, archive({ 'uploads/fremd.pdf': 'x' }, kaputt))
    assert.equal(r.status, 400)
    // Die Meldung nennt, was nicht stimmt, und sagt, dass nichts verändert wurde.
    assert.match(errorOf(r.body), /Wohnungen/)
    assert.match(errorOf(r.body), /unverändert/)
    // Und wirklich nichts ersetzt: weder die Daten noch die Belege. Die fehlenden
    // Sicherheitskopien sind dabei die schärfste Zusicherung: Hier **gäbe** es einen Stand zu
    // sichern, die Datenbank steht ja da. Dass sie trotzdem nicht entstanden sind, heißt, dass
    // die Route gar nicht erst bis zum Ersetzen gekommen ist.
    assert.equal(fs.existsSync(path.join(s.dataDir, 'db.json.vor-restore')), false)
    assert.equal(fs.existsSync(path.join(s.dataDir, 'mietfuchs.sqlite.vor-restore')), false)
    assert.deepEqual((await s.api<Unit[]>('/api/units')).map((u) => u.id), [unit.id])
    assert.deepEqual(await unitRowsInDatabase(s.dataDir), [unit.id], 'die Datenbank ist angefasst worden')
    assert.deepEqual((await s.api<UploadInfo[]>('/api/uploads')).map((u) => u.file), [file])
  })
})

test('Backup: ein krummer, aber gültiger Bestand wird übernommen', async () => {
  // Der Unterschied zwischen kaputt und krumm entscheidet, wer sein Backup zurückspielen kann.
  // Beides hier entsteht durch gewöhnliche Bedienung: Das Löschen einer Wohnung lässt die
  // Direktzuordnung stehen, und die Vorauszahlungs-Staffel prüft nicht auf doppelte Monate.
  await withData(async (s) => {
    const krumm = {
      settings: {},
      units: [{ id: 'u1', name: 'EG', areaM2: 80, participates: true }],
      tenancies: [{
        id: 't1', unitId: 'u1', tenantName: 'Müller', persons: 2, start: '2024-01-01', end: null,
        personHistory: [{ from: '2024-01-01', persons: 2 }],
        prepayments: [{ from: '2024-01', monthlyCents: 15000 }, { from: '2024-01', monthlyCents: 18000 }],
        prepaymentOverrides: {}, baseRents: [],
      }],
      costItems: [{ id: 'c1', year: 2024, category: 'Sonstiges', description: 'Rohrbruch', amountCents: 30000, key: 'direct', directUnitId: 'gibt-es-nicht' }],
      meters: [], readings: [], payments: [],
    }
    const r = await restore(s, archive({}, krumm))
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.deepEqual((await s.api<CostItem[]>('/api/costItems')).map((c) => c.id), ['c1'])
  })
})

test('Backup: Wiederherstellen gelingt auch ohne vorhandene db.json (frischer Rechner)', async () => {
  // Das ist der häufigste Fall überhaupt: Ein Backup macht man, um auf einen neuen Rechner zu
  // ziehen oder nach einem Schaden neu anzufangen. Dann liegt keine db.json da, die sich
  // beiseitelegen ließe, denn sie entsteht erst beim ersten Speichern. Vorher brach das
  // Wiederherstellen genau dort mit einem Serverfehler ab (ENOENT beim Kopieren der
  // Sicherheitskopie), also ausgerechnet da, wo es helfen sollte.
  const s = await startServer()
  try {
    assert.equal(fs.existsSync(path.join(s.dataDir, 'db.json')), false, 'ein frischer Datenordner hat noch keine db.json')
    const daten = {
      settings: {}, units: [{ id: 'u1', name: 'EG', areaM2: 80, participates: true }],
      tenancies: [], costItems: [], meters: [], readings: [], payments: [],
    }
    const r = await restore(s, archive({ 'uploads/beleg.pdf': '%PDF-Beleg' }, daten))
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.deepEqual((await s.api<Unit[]>('/api/units')).map((u) => u.name), ['EG'])
    assert.deepEqual((await s.api<UploadInfo[]>('/api/uploads')).map((u) => u.file), ['beleg.pdf'])
    // Gab es vorher nichts, gibt es auch nichts zu sichern: keine leere oder erfundene
    // Sicherheitskopie, die später jemanden glauben ließe, dort stünde ein früherer Stand.
    assert.equal(fs.existsSync(path.join(s.dataDir, 'db.json.vor-restore')), false)
  } finally {
    s.stop()
  }
})

// Setzt einen Eintragsnamen roh ins Archiv, wie ein präpariertes ZIP ihn enthielte. adm-zip
// bereinigt Namen schon beim Erzeugen, deshalb erst mit gleich langem Platzhalter bauen und die
// Bytes danach ersetzen (der Name steckt in lokalem Kopf und zentralem Verzeichnis).
function archiveWithRawName(name: string): Buffer {
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
      assert.deepEqual((await s.api<Unit[]>('/api/units')).map((u) => u.id), [unit.id])
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
    const unit = await s.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 80, participates: true }) })
    const bomb = archive({ 'uploads/gross.pdf': Buffer.alloc(200 * 1024) })
    assert.ok(bomb.length < 10 * 1024, 'das Archiv selbst ist klein')
    const r = await restore(s, bomb)
    assert.equal(r.status, 400)
    assert.match(errorOf(r.body), /zu groß/)
    assert.deepEqual((await s.api<Unit[]>('/api/units')).map((u) => u.id), [unit.id])
    assert.equal((await s.api<UploadInfo[]>('/api/uploads')).length, 0)
  } finally {
    s.stop()
  }
})

// Mit NKA_PORT=0 vergibt das System einen freien Port. Die Tests starten den Server so und
// lesen den Port aus der Startmeldung (siehe startServerIn).
test('Start: mit NKA_PORT=0 nennt die Startmeldung den tatsächlich vergebenen Port', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-port-'))
  const child = spawn(process.execPath, ['src/index.ts'], {
    cwd: serverRoot,
    env: { ...process.env, NKA_PORT: '0', NKA_DATA_DIR: dataDir, NKA_UPDATE_URL: 'http://127.0.0.1:9/', CI: '1' },
  })
  try {
    const url = await readStartUrl(child)
    assert.notEqual(new URL(url).port, '0', url)
    assert.equal((await fetch(`${url}/healthz`)).status, 200)
  } finally {
    child.kill()
    removeDataDir(dataDir)
  }
})

test('Start: ein NKA_PORT, der keine Portnummer ist, bricht den Start mit klarer Meldung ab', async () => {
  // node:net nimmt eine Zeichenkette, die keine Zahl ist, als Pfad eines Unix-Sockets (unter
  // Windows einer Named Pipe). Mietfuchs lief damit scheinbar, war aber über HTTP unter keiner
  // Adresse erreichbar: `address()` liefert dann den Pfad statt eines Objekts mit Port, und die
  // Startmeldung nannte „http://127.0.0.1:undefined“.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-port-'))
  const { child, out } = startServerRaw(dataDir, { NKA_PORT: 'kein-port' })
  try {
    assert.equal(await waitForExit(child), 1, out())
    assert.match(out(), /NKA_PORT/)
    assert.doesNotMatch(out(), /läuft auf/)
  } finally {
    child.kill()
    removeDataDir(dataDir)
  }
})

test('Start: ist der Port belegt, meldet der Server das und behauptet nicht, zu laufen', async () => {
  // Express 5 ruft den listen-Callback auch bei einem Fehler auf. Ohne Prüfung meldete Mietfuchs
  // dann „läuft auf …“ und öffnete in der Programmdatei sogar den Browser.
  const net = await import('node:net')
  const blocker = net.createServer()
  // Ohne Host wie Mietfuchs selbst, sonst lauschten beide auf verschiedenen Adressfamilien
  await listening(blocker)
  const port = portOf(blocker)
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-port-'))
  try {
    const child = spawn(process.execPath, ['src/index.ts'], {
      cwd: serverRoot,
      env: { ...process.env, NKA_PORT: String(port), NKA_DATA_DIR: dataDir, NKA_UPDATE_URL: 'http://127.0.0.1:9/', CI: 'true' },
    })
    let output = ''
    child.stdout.on('data', (d) => { output += d })
    child.stderr.on('data', (d) => { output += d })
    const code = await Promise.race<number | null | string>([
      new Promise((r) => child.on('exit', r)),
      new Promise((r) => setTimeout(() => { child.kill(); r('läuft nach 15 s noch') }, 15000)),
    ])
    assert.notEqual(code, 'läuft nach 15 s noch', output)
    assert.notEqual(code, 0)
    assert.match(output, /bereits belegt/)
    assert.doesNotMatch(output, /läuft auf/)
  } finally {
    blocker.close()
    removeDataDir(dataDir)
  }
})

// ---------- Backup, Wiederherstellung und die Datenbank (#55, Aufgabe 7a) ----------
//
// Der Grund für diese Gruppe ist ein Ausgang, den es zu vermeiden gilt: Sobald die Routen aus
// der Datenbank lesen, spielt jemand ein Backup ein, sieht eine Bestätigung und arbeitet danach
// mit den alten Daten weiter. Deshalb enthält das Archiv die Datenbank, und deshalb wird sie
// geprüft, bevor irgendetwas ersetzt ist.

// Den Serverprozess beenden, ohne den Datenordner mitzunehmen, und warten, bis er wirklich weg
// ist: Unter Windows hält er sonst noch die Sperre auf der Datenbankdatei.
async function stopKeepingData(s: Awaited<ReturnType<typeof startServerIn>>): Promise<void> {
  const ende = new Promise((r) => s.child.on('exit', r))
  s.child.kill()
  await ende
}

// Ein Server mit gefüllter Datenbank. Seit die Routen die Datenbank schreiben, genügt dafür ein
// Aufruf: Was angelegt wird, steht sofort dort. (Vorher musste der Server dafür zweimal starten,
// damit der Umstieg die db.json übernimmt.)
async function withFilledDatabase(fn: (s: Awaited<ReturnType<typeof startServerIn>>, unit: Unit) => Promise<void>) {
  const s = await startServer()
  try {
    const unit = await s.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 80, participates: true }) })
    assert.deepEqual(await unitRowsInDatabase(s.dataDir), [unit.id], 'die Wohnung steht nicht in der Datenbank')
    await fn(s, unit)
  } finally {
    s.stop()
  }
}

// Ein Eintrag aus dem Archiv. Geprüft statt behauptet: Fehlt er, ist genau das der Befund, den
// der Test zutage fördern soll, und ein `!` verdeckte ihn.
function entryData(zip: AdmZip, name: string): Buffer {
  const entry = zip.getEntry(name)
  if (!entry) return assert.fail(`im Archiv fehlt der Eintrag ${name}`)
  return entry.getData()
}

// Die Wohnungen, wie sie in der Datenbank stehen — unabhängig von den Routen gelesen, die
// heute noch aus der db.json antworten.
async function unitsInDatabase(dataDir: string): Promise<string[]> {
  const connection = await connect(path.join(dataDir, 'mietfuchs.sqlite'))
  try {
    return connection.rows('SELECT id FROM units ORDER BY rowid').map((row) => String(row[0]))
  } finally {
    connection.close()
  }
}

// Ein Bestand im Dateiformat, wie ihn eine Version vor dem Umstellen der Routen geschrieben hat.
const jsonStand = (namen: string[]): string => JSON.stringify({
  settings: { houseName: 'Aus der Datei', address: '', landlordName: '', iban: '', paymentDeadlineDays: 30 },
  units: namen.map((name, i) => ({ id: `u${i + 1}`, name, areaM2: 50 + i, participates: true })),
  tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [],
})

test('Backup: gibt es gerade gar keinen Bestand, entsteht kein Archiv, das sich nicht einspielen lässt', async () => {
  // **Ein Backup, das sich nicht wiederherstellen lässt, ist schlimmer als keines**, denn der
  // Vermieter hält sich danach für gesichert. Genau das konnte entstehen: Ist der Umstieg
  // gelaufen (die db.json heißt dann db.json.abgeloest) und geht danach die Datenbank kaputt,
  // enthielte das Archiv nur noch die Belege. `readBackup` lehnt so eines beim Einspielen ab,
  // und zwar zu Recht. Also entsteht es gar nicht erst.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
  fs.writeFileSync(path.join(dataDir, 'mietfuchs.sqlite'), 'Das ist ein Brief und keine Datenbank.', 'utf8')
  const s = await startServerIn(dataDir)
  try {
    const res = await fetch(`${s.base}/api/backup`)
    assert.equal(res.status, 503, `erwartet 503, bekommen ${res.status}`)
    const fehler = await errorFrom(res)
    assert.match(fehler, /Datenordner/, 'die Meldung nennt den Weg nicht')
    assert.match(fehler, /Datenbank/, fehler)
  } finally {
    s.stop()
  }
})

test('Backup: ist der Umstieg gescheitert, kommt die db.json ins Archiv und nicht die leere Datenbank', async () => {
  // **Die andere Hälfte derselben Behebung.** Packte das Backup die Datenbank ein, obwohl sie
  // den Bestand gar nicht trägt, entstünde genau das mehrdeutige Archiv, das beim
  // Wiederherstellen Daten kostet: eine leere Datenbank neben einer vollen db.json. Damit führte
  // das Backup an der Sperre vorbei, die für diesen Zustand gerade erfunden wurde.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
  // Ein negativer Zählerstand: Der Validator lehnt ihn ab, der Umstieg scheitert, und die
  // Datenbank bleibt offen und leer. Über die Oberfläche erzeugbar, also ein echter Fall.
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    settings: { houseName: 'Haus', address: '', landlordName: '', iban: '', paymentDeadlineDays: 30 },
    units: [{ id: 'u1', name: 'EG', areaM2: 80, participates: true }],
    tenancies: [], costItems: [],
    meters: [{ id: 'm1', name: 'Küche', unitId: 'u1', type: 'kaltwasser', unit: 'm³' }],
    readings: [{ id: 'r1', meterId: 'm1', date: '2024-12-31', value: -5 }],
    payments: [], closedSettlements: [],
  }))
  const s = await startServerIn(dataDir)
  try {
    const bericht = await jsonOf<HealthReport>(await fetch(`${s.base}/healthz`))
    assert.equal(bericht.database?.changeover.state, 'failed', 'der Umstieg ist wider Erwarten gelungen')

    const namen = new AdmZip(Buffer.from(await (await fetch(`${s.base}/api/backup`)).arrayBuffer()))
      .getEntries().map((e) => e.entryName)
    assert.ok(namen.includes('db.json'), `die db.json fehlt im Archiv: ${namen.join(', ')}`)
    assert.equal(namen.includes('mietfuchs.sqlite'), false, `die leere Datenbank ist im Archiv: ${namen.join(', ')}`)
  } finally {
    s.stop()
  }
})

test('Wiederherstellen: führt das Archiv eine db.json, gilt sie und nicht die mitgebrachte Datenbank', async () => {
  // **Das ist der Aktualisierungsweg, und ohne diese Regel verliert er Daten.** Wer den Stand
  // von `main` fährt, hat eine lebende db.json und eine Datenbank, die auf dem Stand des
  // Umstiegstags stehengeblieben ist; sein Archiv führt beides. Ebenso, wer ein Backup zieht,
  // während der Umstieg gescheitert ist: Dann ist die Datenbank im Archiv leer und die db.json
  // trägt alles. Würde die mitgebrachte Datenbank einfach aktiviert, sähe der Vermieter nach der
  // Bestätigung „ok" ein leeres oder veraltetes Haus, schriebe hinein, und ab dem Augenblick
  // findet der Umstieg eine gefüllte Datenbank vor und läuft nie wieder. Die db.json wäre
  // dauerhaft abgehängt.
  //
  // Jede bisher veröffentlichte Version hat die db.json als lebenden Bestand geschrieben. Ein
  // Archiv, das eine führt, stammt also von dort, und sie ist das Neuere. Umgekehrt legt diese
  // Version keine db.json mehr ins Archiv, sobald die Datenbank den Bestand trägt; ein
  // mehrdeutiges Archiv kann ab jetzt gar nicht mehr entstehen.
  await withFilledDatabase(async (s, unit) => {
    const archiv = new AdmZip(Buffer.from(await (await fetch(`${s.base}/api/backup`)).arrayBuffer()))
    assert.ok(archiv.getEntry('mietfuchs.sqlite'), 'das Archiv führt keine Datenbank')
    // Ein Archiv aus der Zeit davor: dieselbe Datenbank, dazu eine db.json mit dem neueren Stand.
    archiv.addFile('db.json', Buffer.from(jsonStand(['Aus der Datei EG', 'Aus der Datei OG']), 'utf8'))

    assert.equal((await restore(s, archiv.toBuffer())).status, 200)
    const namen = (await s.api<Unit[]>('/api/units')).map((u) => u.name)
    assert.deepEqual(namen, ['Aus der Datei EG', 'Aus der Datei OG'], 'die veraltete Datenbank hat gewonnen')
    assert.equal(namen.includes(unit.name), false)
    // Und der Bestand ist wirklich übernommen, nicht nur angezeigt.
    assert.equal((await unitRowsInDatabase(s.dataDir)).length, 2, 'die Datenbank trägt den Stand nicht')
  })
})

test('Wiederherstellen: die Einstellungen aus dem Archiv gelten sofort und überleben das nächste Speichern', async () => {
  // **Zwei Schäden hängen daran, und der zweite ist der teure.** Die Einstellungen liegen als
  // Kopie im Arbeitsspeicher (siehe die Begründung am Zwischenspeicher in index.ts). Frischt das
  // Wiederherstellen sie nicht auf, zeigt die Oberfläche bis zum nächsten Neustart den Stand von
  // vorher, und die gedruckte Abrechnung liest von dort **Vermietername und IBAN**. Schlimmer:
  // `PUT /api/settings` geht vom Zwischenspeicher aus, also schreibt die nächste ganz gewöhnliche
  // Änderung den veralteten Stand vollständig über den wiederhergestellten zurück.
  await withFilledDatabase(async (s) => {
    await s.api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ landlordName: 'Vermieter im Backup', iban: 'DE11' }),
    })
    const zip = Buffer.from(await (await fetch(`${s.base}/api/backup`)).arrayBuffer())
    await s.api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ landlordName: 'Vermieter danach', iban: 'DE99' }),
    })

    assert.equal((await restore(s, zip)).status, 200)
    const sofort = await s.api<ClientSettings>('/api/settings')
    assert.equal(sofort.landlordName, 'Vermieter im Backup', 'ohne Neustart gilt noch der alte Stand')
    assert.equal(sofort.iban, 'DE11', 'die IBAN steht im Kopf der gedruckten Abrechnung')

    // Eine beliebige andere Einstellung ändern, wie es ein Nutzer täte.
    await s.api('/api/settings', { method: 'PUT', body: JSON.stringify({ paymentDeadlineDays: 45 }) })
    const danach = await s.api<ClientSettings>('/api/settings')
    assert.equal(danach.paymentDeadlineDays, 45)
    assert.equal(danach.landlordName, 'Vermieter im Backup', 'der Stand von vor dem Wiederherstellen ist zurückgekehrt')
    assert.equal(danach.iban, 'DE11', 'die alte IBAN ist zurückgekehrt')
  })
})

test('Backup: das Archiv enthält die Datenbank und sagt, woher es stammt', async () => {
  await withFilledDatabase(async (s) => {
    const zip = new AdmZip(Buffer.from(await (await fetch(`${s.base}/api/backup`)).arrayBuffer()))
    const namen = zip.getEntries().map((e) => e.entryName)
    assert.ok(namen.includes('mietfuchs.sqlite'), namen.join(', '))
    assert.ok(namen.includes('mietfuchs-backup.json'), namen.join(', '))
    // Die db.json steht nur im Archiv, wenn es sie gibt. Auf einem Rechner, der nie eine hatte,
    // entsteht sie seit dem Umstieg der Routen gar nicht mehr.
    assert.equal(namen.includes('db.json'), fs.existsSync(path.join(s.dataDir, 'db.json')), namen.join(', '))

    const info: unknown = JSON.parse(zip.readAsText('mietfuchs-backup.json'))
    assert.ok(info !== null && typeof info === 'object')
    assert.equal(Reflect.get(info, 'app'), 'mietfuchs')
    assert.equal(typeof Reflect.get(info, 'version'), 'string')

    // Der Schnappschuss steht für sich: keine Beidatei, die im Archiv fehlen würde.
    for (const suffix of ['-wal', '-shm', '-journal']) {
      assert.ok(!namen.includes(`mietfuchs.sqlite${suffix}`), `${suffix} liegt im Archiv`)
    }
  })
})

test('Backup: zwei gleichzeitige Anfragen liefern beide ein vollständiges Archiv', async () => {
  // Der Schnappschuss entsteht in einer Zwischendatei im Datenordner. Trügen zwei Anfragen
  // denselben Namen dafür, löschte die zweite, was die erste gerade packen will, und der Nutzer
  // bekäme ein Archiv ohne Datenbank oder einen Serverfehler. Zwei Klicks auf denselben Knopf
  // sind nichts Ausgefallenes.
  //
  // **Ehrlich dazu:** Dieser Test war auch mit dem früheren festen Namen grün, gemessen in drei
  // Läufen. Er stellt den Fehler also nicht nach, sondern hält die Eigenschaft fest. Verhindert
  // wurde er bis dahin allein davon, in welcher Reihenfolge Node die Fortsetzungen abarbeitet,
  // und das sagt weder die Schreibschlange zu noch der Treiber darunter. Der eigene Name je
  // Anfrage nimmt der Frage die Grundlage, statt sich auf diese Reihenfolge zu verlassen.
  await withFilledDatabase(async (s) => {
    const hole = async () => {
      const res = await fetch(`${s.base}/api/backup`)
      return { status: res.status, body: Buffer.from(await res.arrayBuffer()) }
    }
    const antworten = await Promise.all([hole(), hole(), hole()])
    antworten.forEach((antwort, i) => {
      assert.equal(antwort.status, 200, `Anfrage ${i + 1} scheiterte`)
      const namen = new AdmZip(antwort.body).getEntries().map((e) => e.entryName)
      assert.ok(namen.includes('mietfuchs.sqlite'), `Anfrage ${i + 1} ohne Datenbank: ${namen.join(', ')}`)
    })
  })
})

test('Backup: die Rundreise bringt auch die Datenbank zurück', async () => {
  await withFilledDatabase(async (s, unit) => {
    const zip = Buffer.from(await (await fetch(`${s.base}/api/backup`)).arrayBuffer())
    assert.deepEqual(await unitsInDatabase(s.dataDir), [unit.id])

    // Die Datenbank verfälschen, wie es ein Schaden täte. Die Routen lesen heute noch aus der
    // db.json, es fällt also nur auf, wenn wirklich in die Datenbank gesehen wird.
    const fremd = await connect(path.join(s.dataDir, 'mietfuchs.sqlite'))
    fremd.exec("DELETE FROM units")
    fremd.close()
    assert.deepEqual(await unitsInDatabase(s.dataDir), [])

    assert.equal((await restore(s, zip)).status, 200)
    assert.deepEqual(await unitsInDatabase(s.dataDir), [unit.id], 'die Datenbank ist wieder da')
    assert.deepEqual((await s.api<Unit[]>('/api/units')).map((u) => u.id), [unit.id])
    // Die bisherige Datenbank liegt daneben, wie die db.json auch.
    assert.ok(fs.existsSync(path.join(s.dataDir, 'mietfuchs.sqlite.vor-restore')), 'die Sicherheitskopie fehlt')
  })
})

test('Backup: ein Archiv aus einer neueren Version wird abgelehnt, bevor etwas ersetzt ist', async () => {
  await withFilledDatabase(async (s, unit) => {
    const zip = new AdmZip(Buffer.from(await (await fetch(`${s.base}/api/backup`)).arrayBuffer()))

    // Die Datenbank im Archiv bekommt eine Änderung am Aufbau, die diese Version nicht kennt.
    const abgelegt = path.join(s.dataDir, 'fremde.sqlite')
    fs.writeFileSync(abgelegt, entryData(zip, 'mietfuchs.sqlite'))
    const fremd = await connect(abgelegt)
    fremd.exec("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('aus-der-zukunft', 1893456000000)")
    fremd.close()
    zip.updateFile('mietfuchs.sqlite', fs.readFileSync(abgelegt))
    fs.rmSync(abgelegt)

    // Dazu eine veränderte db.json, damit sich beweisen lässt, dass nichts davon übernommen wurde.
    zip.updateFile('db.json', Buffer.from(JSON.stringify({ units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], settings: {} })))

    const r = await restore(s, zip.toBuffer())
    assert.equal(r.status, 400)
    assert.match(errorOf(r.body), /neueren Mietfuchs-Version/)
    assert.match(errorOf(r.body), /Das Archiv stammt aus: Mietfuchs/, errorOf(r.body))
    // Nichts ist ersetzt: weder die Wohnungen noch die Datenbank, und keine Sicherheitskopie.
    assert.deepEqual((await s.api<Unit[]>('/api/units')).map((u) => u.id), [unit.id])
    assert.deepEqual(await unitsInDatabase(s.dataDir), [unit.id])
    assert.equal(fs.existsSync(path.join(s.dataDir, 'db.json.vor-restore')), false)
    assert.equal(fs.existsSync(path.join(s.dataDir, 'mietfuchs.sqlite.vor-restore')), false)
  })
})

test('Backup: ein Archiv mit beschädigter Datenbank wird abgelehnt', async () => {
  await withFilledDatabase(async (s, unit) => {
    const zip = new AdmZip(Buffer.from(await (await fetch(`${s.base}/api/backup`)).arrayBuffer()))
    const kaputt = entryData(zip, 'mietfuchs.sqlite')
    kaputt.fill(0x5a, 4096, 8192)
    zip.updateFile('mietfuchs.sqlite', kaputt)

    const r = await restore(s, zip.toBuffer())
    assert.equal(r.status, 400)
    assert.match(errorOf(r.body), /beschädigt/)
    assert.deepEqual((await s.api<Unit[]>('/api/units')).map((u) => u.id), [unit.id])
    assert.deepEqual(await unitsInDatabase(s.dataDir), [unit.id])
  })
})

test('Backup: ein Archiv ohne Datenbank baut sie aus der db.json neu auf', async () => {
  // Jedes Archiv, das vor dieser Version entstanden ist, sieht so aus. Die db.json zu ersetzen
  // und die alte Datenbank stehen zu lassen wäre der schlimmste Ausgang: Nach Aufgabe 6 sähe
  // der Nutzer eine Bestätigung und arbeitete mit den Daten von vorher weiter.
  await withFilledDatabase(async (s, unit) => {
    // Ein Archiv, wie es eine ältere Version gepackt hat: nur die db.json, keine Datenbank und
    // keine Herkunftsangabe. Es wird hier von Hand gebaut, denn ein heutiges Backup führt genau
    // das nicht mehr — und dieser Test steht gerade für die Archive, die bei den Nutzern schon
    // liegen.
    const alt = archive({}, {
      settings: {},
      units: [{ id: 'aus-dem-archiv', name: 'Aus dem Archiv', areaM2: 55, participates: true }],
      tenancies: [], costItems: [], meters: [], readings: [], payments: [],
    })

    // Der Stand vorher ist ein anderer, sonst bewiese der Test nichts.
    assert.deepEqual(await unitRowsInDatabase(s.dataDir), [unit.id], 'der Ausgangsstand stimmt nicht')

    assert.equal((await restore(s, alt)).status, 200)
    assert.deepEqual((await s.api<Unit[]>('/api/units')).map((u) => u.id), ['aus-dem-archiv'])
    // Und die Datenbank ist aus der db.json neu entstanden, mit demselben Stand.
    assert.deepEqual(await unitRowsInDatabase(s.dataDir), ['aus-dem-archiv'], 'die Datenbank trägt den alten Stand')
  })
})

// ---------- Die Routen lesen und schreiben die Datenbank (#55, Aufgabe 6) ----------
//
// Ab hier ist die Datenbank maßgeblich. Drei Zusagen hängen daran, und jede hat ihren Test: Was
// gespeichert wird, steht in der Datenbank; ein unbekanntes Feld kommt nicht an (#60); und ohne
// Datenbank gibt es keine Daten, also auch keine Antwort, die so tut, als gäbe es welche.

// Die Wohnungen, wie sie in der Datenbank stehen — an den Routen vorbei gelesen. Nur so lässt
// sich unterscheiden, ob eine Route wirklich dort geschrieben hat oder nur in der db.json.
async function unitRowsInDatabase(dataDir: string): Promise<string[]> {
  const connection = await connect(path.join(dataDir, 'mietfuchs.sqlite'))
  try {
    return connection.rows('SELECT id FROM units ORDER BY rowid').map((zeile) => String(zeile[0]))
  } finally {
    connection.close()
  }
}

test('Speichern landet in der Datenbank und nicht in der db.json', async () => {
  const s = await startServer()
  try {
    const unit = await s.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 80, participates: true }) })
    assert.deepEqual(await unitRowsInDatabase(s.dataDir), [unit.id], 'die Wohnung steht nicht in der Datenbank')
    assert.deepEqual((await s.api<Unit[]>('/api/units')).map((u) => u.id), [unit.id])

    // Und die db.json wird nicht mehr fortgeschrieben. Sie bleibt, was sie nach dem Umstieg ist:
    // der Stand von damals, kein mitlaufendes Abbild.
    const jsonFile = path.join(s.dataDir, 'db.json')
    if (fs.existsSync(jsonFile)) {
      assert.ok(!fs.readFileSync(jsonFile, 'utf8').includes(unit.id), 'die Wohnung steht in der db.json')
    }
  } finally {
    s.stop()
  }
})

test('Ein unbekanntes Feld wird nicht mitgespeichert', async () => {
  // #60: `PUT /api/settings` und die CRUD-Routen übernahmen jeden Schlüssel des Rumpfes, auch
  // einen erfundenen, und er blieb dauerhaft im Datenbestand stehen. Mit Spalten gibt es für ihn
  // keinen Ort mehr.
  const s = await startServer()
  try {
    const angelegt = await s.api<Unit>('/api/units', {
      method: 'POST',
      body: JSON.stringify({ name: 'EG', areaM2: 80, participates: true, fremdesFeld: 'bleibt haengen' }),
    })
    assert.ok(!JSON.stringify(angelegt).includes('bleibt haengen'), JSON.stringify(angelegt))
    const gelesen = await s.api<Unit[]>('/api/units')
    assert.ok(!JSON.stringify(gelesen).includes('bleibt haengen'), JSON.stringify(gelesen))

    // **Und bei den Einstellungen ebenso**, obwohl der Kommentar darüber sie seit jeher nennt:
    // Geprüft wurde bisher nur eine Wohnung. `PUT /api/settings` reicht unbekannte Schlüssel
    // durch bis zum Schreiben, und erst `settingsRow` lässt sie fallen. Dass sie dort und nicht
    // erst in der Antwort verschwinden, hält diese Zusicherung fest: Gelesen wird nach dem
    // Speichern aus der Datenbank.
    await s.api('/api/settings', { method: 'PUT', body: JSON.stringify({ landlordName: 'Erika', lieblingsfarbe: 'blau' }) })
    const einstellungen = await s.api<ClientSettings>('/api/settings')
    assert.equal(einstellungen.landlordName, 'Erika', 'das gültige Feld ist nicht angekommen')
    assert.ok(!JSON.stringify(einstellungen).includes('lieblingsfarbe'), JSON.stringify(einstellungen))
    const inDerDatenbank = await storedSettings(s)
    assert.ok(!JSON.stringify(inDerDatenbank).includes('lieblingsfarbe'), JSON.stringify(inDerDatenbank))
  } finally {
    s.stop()
  }
})

test('Aufzählungen: ein Wert, den Mietfuchs nicht kennt, ersetzt den gespeicherten nicht', async () => {
  // Eine neue Entscheidung aus dem Umstieg, die bisher keine Zeile festhielt. Über die db.json
  // wurde ein erfundener Umlageschlüssel übernommen und stand danach im Bestand; die Spalte
  // ließe ihn nicht zu. Statt die Eingabe mit einem technischen Befund abzulehnen, bleibt der
  // bisherige Wert stehen. Das ist die mildere Antwort, aber sie geschieht stillschweigend, und
  // genau deshalb gehört sie festgehalten: Wer sie später anders entscheidet, sieht es hier.
  const s = await startServer()
  try {
    const item = await s.api<CostItem>('/api/costItems', {
      method: 'POST',
      body: JSON.stringify({ year: 2024, category: 'Müllabfuhr', description: 'Abfall', amountCents: 12000, key: 'area' }),
    })
    const geaendert = await s.api<CostItem>(`/api/costItems/${item.id}`, {
      method: 'PUT',
      body: JSON.stringify({ key: 'nach-mondphase', meterType: 'plutonium' }),
    })
    assert.equal(geaendert.key, 'area', 'der erfundene Umlageschlüssel ist angekommen')
    assert.equal(geaendert.meterType, null, 'der erfundene Zählertyp ist angekommen')

    const meter = await s.api<Meter>('/api/meters', {
      method: 'POST',
      body: JSON.stringify({ name: 'Küche', unitId: null, type: 'kaltwasser', unit: 'm³' }),
    })
    const meterGeaendert = await s.api<Meter>(`/api/meters/${meter.id}`, {
      method: 'PUT',
      body: JSON.stringify({ type: 'plutonium' }),
    })
    assert.equal(meterGeaendert.type, 'kaltwasser', 'der erfundene Zählertyp ist angekommen')
  } finally {
    s.stop()
  }
})

test('Einstellungen landen in der Datenbank und überleben einen Neustart', async () => {
  // Sie werden im Arbeitsspeicher gehalten, weil sie auf fast jedem Weg gelesen und selten
  // geschrieben werden. Genau deshalb braucht es diesen Test: Ein Zwischenspeicher, der beim
  // Schreiben nicht bis zur Platte durchschlägt, sieht im laufenden Betrieb völlig richtig aus
  // und ist beim nächsten Start weg.
  const erster = await startServer()
  let dataDir: string
  try {
    dataDir = erster.dataDir
    await erster.api('/api/settings', { method: 'PUT', body: JSON.stringify({ landlordName: 'Erika am Park', paymentDeadlineDays: 45 }) })
    assert.equal((await erster.api<ClientSettings>('/api/settings')).landlordName, 'Erika am Park')

    const connection = await connect(path.join(dataDir, 'mietfuchs.sqlite'))
    try {
      const zeilen = connection.rows('SELECT landlord_name, payment_deadline_days FROM settings')
      assert.deepEqual(zeilen, [['Erika am Park', 45]], 'die Einstellungen stehen nicht in der Datenbank')
    } finally {
      connection.close()
    }
    await stopKeepingData(erster)
  } catch (err) {
    erster.stop()
    throw err
  }
  const zweiter = await startServerIn(dataDir)
  try {
    const nachNeustart = await zweiter.api<ClientSettings>('/api/settings')
    assert.equal(nachNeustart.landlordName, 'Erika am Park', 'nach dem Neustart ist der Vermietername weg')
    assert.equal(nachNeustart.paymentDeadlineDays, 45)
  } finally {
    zweiter.stop()
  }
})

test('Ohne Datenbank antwortet die Route, statt Daten vorzutäuschen', async () => {
  // Die Umkehrung des bisherigen Zustands: Bis zum Umstieg war eine nicht geöffnete Datenbank
  // harmlos, weil Mietfuchs mit der db.json weiterarbeitete. Jetzt liegen die Daten dort, und
  // ein Start ohne sie ist ein Start ohne Daten. Eine leere Liste wäre die schlimmste Antwort:
  // Sie sähe aus wie „Sie haben noch nichts erfasst".
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-ohne-db-'))
  // Eine Datei, die keine Datenbank ist. Der Server startet trotzdem, damit die Oberfläche die
  // Meldung zeigen kann; die Datenrouten antworten aber nicht mit Daten.
  fs.writeFileSync(path.join(dataDir, 'mietfuchs.sqlite'), 'Das ist ein Brief und keine Datenbank.', 'utf8')
  const s = await startServerIn(dataDir)
  try {
    const res = await fetch(`${s.base}/api/units`)
    assert.equal(res.status, 503, `erwartet 503, bekommen ${res.status}`)
    assert.match(errorOf(await jsonOf<{ error?: string }>(res)), /Datenbank/)

    // **Und auf jeder anderen Datenroute ebenso, nicht nur beim Lesen.** Geprüft war bisher nur
    // dieses eine GET, dabei ist das Schreiben der Ausgang, dessentwegen es die Sperre gibt:
    // Was der Vermieter in eine leere Datenbank hineinschriebe, stünde danach als zweiter
    // Bestand da. Eine neue Route, die `database.db` unmittelbar benutzte, ginge an der
    // Nahtstelle vorbei, ohne dass irgendetwas rot würde.
    const gesperrt: [string, string, string | undefined][] = [
      ['POST', '/api/units', JSON.stringify({ name: 'EG', areaM2: 80, participates: true })],
      ['PUT', '/api/units/egal', JSON.stringify({ name: 'EG' })],
      ['DELETE', '/api/units/egal', undefined],
      ['GET', '/api/units/egal/dependents', undefined],
      ['GET', '/api/settlement/2024', undefined],
      ['GET', '/api/consumption/2024', undefined],
      ['GET', '/api/rentledger/2024', undefined],
      ['GET', '/api/taxreport/2024', undefined],
      ['POST', '/api/settlement/2024/close', JSON.stringify({})],
      ['DELETE', '/api/settlement/2024/close', undefined],
    ]
    for (const [method, pfad, body] of gesperrt) {
      const antwort = await fetch(`${s.base}${pfad}`, {
        method,
        ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body }),
      })
      assert.equal(antwort.status, 503, `${method} ${pfad} antwortet ${antwort.status} statt 503`)
    }
    // Die Wohnung ist auch wirklich nirgends gelandet.
    assert.equal(fs.existsSync(path.join(dataDir, 'db.json')), false, 'es ist doch eine db.json entstanden')

    // Nicht über `s.api`: Der Helfer wirft bei allem außer 200, und genau das tut /healthz hier
    // zu Recht. Ein Container, der den Zustand abfragt, soll einen Fehler sehen und keine 200
    // mit „error" im Rumpf.
    const health = await fetch(`${s.base}/healthz`)
    assert.equal(health.status, 503, 'der Zustandsbericht meldet sich als gesund')
    const bericht = await jsonOf<HealthReport>(health)
    if (!bericht.database) assert.fail('der Zustandsbericht nennt die Datenbank nicht')
    assert.equal(bericht.database.open, false)
    // Ab jetzt ist das ein Fehler und kein Hinweis: Ein Container soll ihn sehen.
    assert.equal(bericht.status, 'error', `der Bericht meldet „${bericht.status}"`)
  } finally {
    s.stop()
  }
})

// ---------- API-Schlüssel externer KI-Dienste (#18) ----------
// Schlüssel liegen in einer eigenen Datei neben der db.json. Sie gehen nie an den Browser und
// nicht ins Backup-ZIP, das schnell in einer Cloud oder auf einem USB-Stick landet.

const SECRET = 'sk-test-geheim-1234567890abcd'
const putKey = (s: Server, body: { slot?: string, key?: string }) => fetch(`${s.base}/api/ai/key`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

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

// Speichert KI-Einstellungen über die Route, wie es die Oberfläche tut
async function putAi(s: Server, change: Partial<AiSettings>) {
  const settings = await s.api<ClientSettings>('/api/settings')
  return s.api<ClientSettings>('/api/settings', { method: 'PUT', body: JSON.stringify({ ...settings, ai: { ...settings.ai, ...change } }) })
}

const ollamaSlot = (url: string, model = 'test'): AiSlot => ({ provider: 'ollama', preset: 'ollama-remote', url, model, vision: null })
const photoForm = () => {
  const fd = new FormData()
  fd.append('file', new Blob([Buffer.from('JPEG-Foto')], { type: 'image/jpeg' }), 'rechnung.jpg')
  return fd
}

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
  const s = await startServerIn(fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-')))
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
// 192.0.2.1 liegt im Dokumentationsnetz (RFC 5737): nicht privat, also extern, und nie
// erreichbar. So braucht der Test kein Internet.

const EXTERNAL = 'http://192.0.2.1:11434'

test('Bestätigung: ohne sie gehen keine Belege an einen externen Dienst', async () => {
  await withEnv({ NKA_AI_TIMEOUT: '2' }, async (s) => {
    await putAi(s, { text: ollamaSlot(EXTERNAL) })
    const started = Date.now()
    const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.equal(r.status, 502)
    assert.match(errorOf(r.body), /192\.0\.2\.1:11434.*bestätigt/s)
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
    assert.equal(chatRequests(ollama).length, 0)
    await s.api<ClientSettings>('/api/ai/consent', { method: 'POST', body: JSON.stringify({ slot: 'text' }) })
    assert.equal((await uploadPdf(s, '/api/extract', { text: LONG_TEXT })).status, 200)
  }, { models: [{ name: 'gpt-oss:120b-cloud', capabilities: ['completion'], remote_host: 'https://ollama.com:443' }], model: 'gpt-oss:120b-cloud' })
})

// ---------- OpenAI-kompatible Dienste (#18) ----------
// Der nachgebaute Dienst antwortet wie die Chat-Completions-Schnittstelle: GET /v1/models und
// POST /v1/chat/completions als SSE-Strom. `rules` schaltet Eigenheiten echter Dienste ein, wie
// sie deren Dokumentation beschreibt:
//   rejectTemperature  lehnt temperature ab (neuere OpenAI-Modelle)
//   onlyMaxTokens      lehnt max_completion_tokens ab (Mistral, LM Studio)
//   rejectJsonSchema   kennt response_format json_schema nicht
//   rejectJsonObject   kennt response_format json_object nicht (LM Studio)
//   key                verlangt diesen Bearer-Schlüssel
//   errorFormat        'ionos' meldet Fehler als { messages: [{ errorCode, message }] }
//   busyOnce           antwortet einmal mit 429 und Retry-After
//   quota              meldet aufgebrauchtes Guthaben (429 insufficient_quota)
//   finish             Grund des Endes, etwa 'length'
//   whole              antwortet trotz stream: true am Stück als JSON
//   reasoning          schickt vor der Antwort Denktext
//   fenced             packt das JSON in einen Codeblock
//   hang               antwortet nie
//   echoKey            wiederholt den geschickten Schlüssel in einer Fehlermeldung
//   echoKeyInStream    wiederholt ihn in einem Fehler mitten im Strom (Status 200)
//   garbledStream      schickt ein nicht als JSON lesbares Ereignis, das den Schlüssel enthält
// Die Eigenheiten echter Dienste, die der nachgebaute auf Wunsch nachstellt (siehe oben).
type OpenAiRules = {
  key?: string
  errorFormat?: 'ionos'
  busyOnce?: boolean
  quota?: boolean
  rejectTemperature?: boolean
  onlyMaxTokens?: boolean
  rejectJsonSchema?: boolean
  rejectJsonObject?: boolean
  finish?: string
  whole?: boolean
  reasoning?: boolean
  fenced?: boolean
  hang?: boolean
  echoKey?: boolean
  echoKeyInStream?: boolean
  garbledStream?: boolean
}

async function fakeOpenAi(rules: OpenAiRules = {}) {
  const http = await import('node:http')
  const requests: OpenAiRequest[] = []
  const open = new Set<http.ServerResponse>()
  let busy = rules.busyOnce ? 1 : 0
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (d) => { raw += d })
    req.on('end', () => {
      const body: OpenAiBody & { response_format?: { type?: string } } = raw ? JSON.parse(raw) : {}
      requests.push({ url: req.url, method: req.method, body, raw, headers: req.headers })
      const send = (status: number, data: unknown, headers: http.OutgoingHttpHeaders = {}) => {
        res.writeHead(status, { 'content-type': 'application/json', ...headers })
        res.end(JSON.stringify(data))
      }
      const reject = (status: number, message: string, param: string | null, code = 'unsupported_parameter') =>
        rules.errorFormat === 'ionos'
          ? send(status, { httpStatus: status, messages: [{ errorCode: code, message }] })
          : send(status, { error: { message, type: 'invalid_request_error', param, code } })
      if (rules.key && req.headers.authorization !== `Bearer ${rules.key}`) return reject(401, 'Incorrect API key provided', null, 'invalid_api_key')
      if (rules.echoKey) return reject(400, `Invalid request for credentials ${req.headers.authorization}`, null, 'invalid_request')
      if (req.method === 'GET' && req.url === '/v1/models') {
        return send(200, { object: 'list', data: [{ id: 'modell-b', object: 'model' }, { id: 'modell-a', object: 'model', capabilities: { vision: true } }] })
      }
      if (req.url !== '/v1/chat/completions') return send(404, { error: { message: 'Not found' } })
      if (busy > 0) {
        busy -= 1
        return send(429, { error: { message: 'Rate limit reached for requests', code: 'rate_limit_exceeded' } }, { 'retry-after': '1' })
      }
      if (rules.quota) return send(429, { error: { message: 'You exceeded your current quota', code: 'insufficient_quota' } })
      if (rules.rejectTemperature && body.temperature !== undefined) {
        return reject(400, "Unsupported value: 'temperature' does not support 0 with this model. Only the default (1) value is supported.", 'temperature', 'unsupported_value')
      }
      if (rules.onlyMaxTokens && body.max_completion_tokens !== undefined) return reject(400, 'Unrecognized request argument supplied: max_completion_tokens', 'max_completion_tokens')
      if (rules.rejectJsonSchema && body.response_format?.type === 'json_schema') {
        return reject(400, "Invalid parameter: 'response_format' of type 'json_schema' is not supported with this model.", 'response_format')
      }
      if (rules.rejectJsonObject && body.response_format?.type === 'json_object') return send(400, { error: "'response_format.type' must be 'json_schema'" })
      if (body.model !== 'modell-a') return reject(404, `The model '${body.model}' does not exist or you do not have access to it.`, 'model', 'model_not_found')
      open.add(res)
      res.on('close', () => open.delete(res))
      if (rules.hang) return
      if (rules.echoKeyInStream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write(`data: ${JSON.stringify({ error: { message: `Ungültige Anmeldung mit ${req.headers.authorization}` } })}

`)
        return res.end()
      }
      // Ein Ereignis, das sich nicht als JSON lesen lässt und den Schlüssel enthält (Befund aus
      // der Codeprüfung: handleEvent gab ihn ungeprüft weiter)
      if (rules.garbledStream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write(`data: kaputt: ${req.headers.authorization}\n\n`)
        return res.end()
      }
      // Den zweiten Durchgang (nur Kategorien) erkennt man an Schema oder Prompt
      const answer = JSON.stringify(
        raw.includes('categories')
          ? { categories: ['Wasser/Abwasser'] }
          : { vendor: 'Stadtwerke Musterstadt', positions: [{ description: 'Frischwasser', category: 'Wasser/Abwasser', amountEur: 12.5 }], totalGrossEur: 12.5 },
      )
      const fence = '```'
      const content = rules.fenced ? `${fence}json\n${answer}\n${fence}` : answer
      const usage = { prompt_tokens: 900, completion_tokens: 40, total_tokens: 940 }
      if (rules.whole) return send(200, { choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage })
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const event = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`)
      if (rules.reasoning) event({ choices: [{ index: 0, delta: { reasoning_content: 'Ich rechne die Summe nach.' } }] })
      const half = Math.ceil(content.length / 2)
      event({ choices: [{ index: 0, delta: { role: 'assistant', content: content.slice(0, half) }, finish_reason: null }] })
      event({ choices: [{ index: 0, delta: { content: content.slice(half) }, finish_reason: null }] })
      event({ choices: [{ index: 0, delta: {}, finish_reason: rules.finish ?? 'stop' }] })
      if (body.stream_options?.include_usage) event({ choices: [], usage })
      res.end('data: [DONE]\n\n')
    })
  })
  await listening(server, '127.0.0.1')
  return {
    url: `http://127.0.0.1:${portOf(server)}/v1`,
    requests,
    completions: () => requests.filter((r) => r.url === '/v1/chat/completions'),
    stop: () => {
      for (const res of open) res.destroy()
      server.close()
    },
  }
}

type OpenAiService = Awaited<ReturnType<typeof fakeOpenAi>>
type WithOpenAiOptions = {
  rules?: OpenAiRules
  preset?: string
  model?: string
  vision?: boolean | null
  key?: string | null
  ai?: Partial<AiSettings>
  env?: NodeJS.ProcessEnv
}

// Die n-te Chat-Anfrage an den Dienst. Fehlt sie, hat Mietfuchs weniger gefragt als erwartet.
const completionOf = (service: OpenAiService, n: number): OpenAiRequest => {
  const request = service.completions()[n]
  if (!request) assert.fail(`es gibt keine ${n + 1}. Anfrage an den Dienst`)
  return request
}

async function withOpenAi(fn: (s: Server, service: OpenAiService) => Promise<void>, { rules = {}, preset = 'openai-compatible', model = 'modell-a', vision = null, key = null, ai = {}, env = {} }: WithOpenAiOptions = {}) {
  const service = await fakeOpenAi(rules)
  const s = await startServerIn(fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-')), env)
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
    assert.match(await errorFrom(res), /versteht das Modell „modell-a“ keine Bilder/)
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
    await putKey(s, { slot: 'text', key: 'sk-test-falsch-0987654321' })
    const wrong = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    assert.match(errorOf(wrong.body), /lehnt den Schlüssel ab/)
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
    assert.equal(service.completions().length, 1)
  }, { rules: { quota: true } })
})

test('OpenAI-kompatibel: abgeschnittene Antwort, unbekanntes Modell, Zeitlimit', async () => {
  await withOpenAi(async (s) => {
    assert.match(errorOf((await uploadPdf(s, '/api/extract', { text: LONG_TEXT })).body), /Höchstlänge von 16384 Token.*„Erweitert“/)
  }, { rules: { finish: 'length' } })
  await withOpenAi(async (s) => {
    assert.match(errorOf((await uploadPdf(s, '/api/extract', { text: LONG_TEXT })).body), /kennt das Modell „gibt-es-nicht“ nicht/)
  }, { model: 'gibt-es-nicht' })
  await withOpenAi(async (s) => {
    assert.match(errorOf((await uploadPdf(s, '/api/extract', { text: LONG_TEXT })).body), /nicht innerhalb von 2 Sekunden geantwortet/)
  }, { rules: { hang: true }, env: { NKA_AI_TIMEOUT: '2' } })
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
  const s = await startServerIn(fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-')))
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
  const s = await startServerIn(fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-')))
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

// ---------- Kein Serverstart ohne CI ----------

test('Jeder Serverstart einer Prüfung setzt CI', () => {
  // **Ohne `CI` reißt ein Testlauf Browserfenster auf dem Rechner des Entwicklers auf.**
  // Der Server öffnet beim Start den Standard-Browser, sobald `STANDALONE` gilt, also in der
  // Betriebsart `binary` oder `package` (siehe version.ts). Genau die stellt ein Test weiter
  // oben mit `NKA_RUNTIME: 'binary'` nach, und weil `startServerIn` kein `CI` setzte, ging bei
  // jedem vollen Lauf ein Tab auf — auf einem Zufallsport, denn `NKA_PORT` ist dort `'0'`.
  //
  // **Geprüft wird der Quelltext, und das ist hier das richtige Mittel.** Am Verhalten ließe es
  // sich nur messen, indem der Test einen Browser öffnet, und das ist genau das, was er
  // verhindern soll. Die Regel steht in CLAUDE.md bei den drei Variablen, die zu jedem
  // Prüf-Serverstart gehören: NKA_DATA_DIR gegen echte Daten, CI gegen das Fenster,
  // NKA_UPDATE_URL gegen Anfragen zu GitHub.
  //
  // Gelesen wird der Block `env: { … }` jedes Serverstarts, und zwar mit Klammerzählung statt
  // mit einem festen Fenster: Ein Suchbereich „die nächsten N Zeichen" ginge irgendwann daneben,
  // und ein Wächter, der zu früh aufhört, meldet nichts und schützt nichts.
  const quelle = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8')
  // Das Muster steht bewusst zweigeteilt da: Stünde es an einem Stück, fände der Wächter sich
  // selbst und meldete seine eigene Zeile. Nachgemessen, das war der erste Lauf.
  const marke = `spawn(process.execPath, ['src/` + `index.ts']`
  const ohneCI: number[] = []
  for (let von = quelle.indexOf(marke); von !== -1; von = quelle.indexOf(marke, von + 1)) {
    const envStart = quelle.indexOf('env: {', von)
    if (envStart === -1) return assert.fail(`Serverstart ohne env-Block bei Zeichen ${von}`)
    let tiefe = 0
    let envEnde = -1
    for (let i = quelle.indexOf('{', envStart); i < quelle.length; i++) {
      if (quelle[i] === '{') tiefe++
      else if (quelle[i] === '}' && --tiefe === 0) { envEnde = i; break }
    }
    if (envEnde === -1) return assert.fail(`env-Block bei Zeichen ${envStart} ist nicht geschlossen`)
    if (!/\bCI:\s*['"]/.test(quelle.slice(envStart, envEnde))) {
      ohneCI.push(quelle.slice(0, von).split('\n').length)
    }
  }
  assert.deepEqual(
    ohneCI,
    [],
    'Serverstart ohne CI in diesen Zeilen. Ohne CI öffnet der Server ein Browserfenster, sobald ' +
      'er sich für die Programmdatei hält. Siehe CLAUDE.md, Abschnitt zu den Tests.',
  )
  // Und der Wächter muss überhaupt etwas gefunden haben, sonst prüft er nichts.
  assert.ok(quelle.includes(marke), 'kein einziger Serverstart gefunden; der Wächter wäre wirkungslos')
})

// ---------- Was mit einer Wohnung gelöscht wird (#142) ----------
// Die Löschfrage nannte nur die Mietverhältnisse. Die Fremdschlüssel nehmen aber mehr mit, und
// ein Vermieter, der das nicht weiß, löscht mit der Garage seine Ablesungen und Zahlungen.

test('Wohnung löschen: die Antwort zählt, was mitgelöscht wird, und die Zahlen stimmen danach', async () => {
  const s = await startServer()
  try {
    const post = <T>(route: string, body: unknown) => s.api<T>(route, { method: 'POST', body: JSON.stringify(body) })
    const eg = await post<Unit>('/api/units', { name: 'EG', areaM2: 80, participates: true })
    const og = await post<Unit>('/api/units', { name: 'OG', areaM2: 60, participates: true })
    const neu = (unitId: string, tenantName: string) => post<Tenancy>('/api/tenancies', {
      unitId, tenantName, persons: 1, personHistory: [], start: '2025-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [],
    })
    const a = await neu(eg.id, 'A')
    await neu(eg.id, 'B')
    const c = await neu(og.id, 'C')
    const zaehler = await post<Meter>('/api/meters', { name: 'KW EG', unitId: eg.id, type: 'kaltwasser', unit: 'm³' })
    await post<Meter>('/api/meters', { name: 'Haupt', unitId: null, type: 'kaltwasser', unit: 'm³' })
    for (const [date, value] of [['2024-12-31', 1], ['2025-12-31', 50]] as const) await post('/api/readings', { meterId: zaehler.id, date, value })
    for (const date of ['2025-01-03', '2025-02-03', '2025-03-03']) await post('/api/payments', { tenancyId: a.id, date, amountCents: 50000 })
    await post('/api/payments', { tenancyId: c.id, date: '2025-01-03', amountCents: 40000 })
    await post('/api/costItems', { year: 2025, category: 'Grundsteuer', description: 'Anteile', amountCents: 10000, key: 'custom', customShares: { [eg.id]: 50, [og.id]: 50 } })
    await post('/api/costItems', { year: 2025, category: 'Aufzug', description: 'Aufzug', amountCents: 10000, key: 'area', participantUnitIds: [eg.id] })
    await post('/api/costItems', { year: 2025, category: 'Heizung und Warmwasser', description: 'Messdienst', amountCents: 10000, key: 'amounts', tenancyAmounts: { [a.id]: 3000, [c.id]: 4000 } })
    await post('/api/costItems', { year: 2025, category: 'Hauswart', description: 'Direkt', amountCents: 10000, key: 'direct', directUnitId: eg.id })

    const deps = await s.api<UnitDependents>(`/api/units/${eg.id}/dependents`)
    assert.deepEqual(deps, { tenancies: 2, meters: 1, readings: 2, payments: 3, costItemLinks: 3, directCostItems: 1 })
    // Die andere Wohnung hat nur ihr Eigenes.
    assert.deepEqual(await s.api<UnitDependents>(`/api/units/${og.id}/dependents`), { tenancies: 1, meters: 0, readings: 0, payments: 1, costItemLinks: 2, directCostItems: 0 })
    assert.equal((await fetch(`${s.base}/api/units/gibt-es-nicht/dependents`)).status, 404)

    // Die Zählung ist kein Versprechen ins Blaue: Nach dem Löschen fehlt genau das Gezählte.
    await s.api(`/api/units/${eg.id}`, { method: 'DELETE' })
    assert.equal((await s.api<Tenancy[]>('/api/tenancies')).length, 1)
    assert.deepEqual((await s.api<Meter[]>('/api/meters')).map((m) => m.name), ['Haupt'])
    assert.equal((await s.api<Reading[]>('/api/readings')).length, 0)
    assert.equal((await s.api<Payment[]>('/api/payments')).length, 1)
    const direkt = (await s.api<CostItem[]>('/api/costItems')).find((i) => i.description === 'Direkt')
    assert.equal(direkt?.directUnitId ?? null, null, 'die direkt zugeordnete Rechnung bleibt, ohne Wohnung')
  } finally {
    s.stop()
  }
})

// ---------- Objekte (#92) ----------
// Jeder Test mit zwei Objekten bekommt seinen eigenen Server: Ein zweites Objekt im geteilten
// Server machte jede Anfrage ohne `property` der übrigen Tests zu einer 400.

async function withProperties(fn: (s: Server, b: Property) => Promise<void>) {
  const s = await startServer()
  try {
    const b = await s.api<Property>('/api/properties', { method: 'POST', body: JSON.stringify({ name: 'Gartenweg 3', kind: 'etw' }) })
    await fn(s, b)
  } finally {
    s.stop()
  }
}

test('Objekt: ein frischer Server hat genau ein Objekt, und ohne Angabe gilt es', async () => {
  const s = await startServer()
  try {
    const objekte = await s.api<Property[]>('/api/properties')
    assert.deepEqual(objekte.map((p) => p.id), ['objekt-1'])
    const unit = await s.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 50, participates: true }) })
    assert.equal(unit.propertyId, 'objekt-1')
    assert.deepEqual((await s.api<Unit[]>('/api/units')).map((u) => u.id), [unit.id])
  } finally {
    s.stop()
  }
})

test('Objekt: mit zwei Objekten verlangen die Datenrouten die Angabe, und sie grenzt ein', async () => {
  await withProperties(async (s, b) => {
    const ohne = await fetch(`${s.base}/api/units`)
    assert.equal(ohne.status, 400)
    assert.match((await jsonOf<{ error: string }>(ohne)).error, /Objekt/)
    const ohneRumpf = await fetch(`${s.base}/api/units`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'X' }) })
    assert.equal(ohneRumpf.status, 400)
    assert.equal((await fetch(`${s.base}/api/settlement/2025`)).status, 400)
    assert.equal((await fetch(`${s.base}/api/units?property=gibt-es-nicht`)).status, 404)

    const a = await s.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ propertyId: 'objekt-1', name: 'A-EG', areaM2: 50, participates: true }) })
    const bw = await s.api<Unit>(`/api/units?property=${b.id}`, { method: 'POST', body: JSON.stringify({ name: 'B-EG', areaM2: 70, participates: true }) })
    assert.equal(bw.propertyId, b.id, 'die Angabe in der Adresse gilt auch beim Anlegen')
    assert.deepEqual((await s.api<Unit[]>(`/api/units?property=${b.id}`)).map((u) => u.id), [bw.id])
    assert.deepEqual((await s.api<Unit[]>('/api/units?property=objekt-1')).map((u) => u.id), [a.id])
  })
})

test('Objekt: zwei Objekte rechnen und schließen getrennt ab, auch im selben Jahr', async () => {
  await withProperties(async (s, b) => {
    await s.api('/api/units?property=objekt-1', { method: 'POST', body: JSON.stringify({ name: 'A-EG', areaM2: 50, participates: true }) })
    await s.api(`/api/units?property=${b.id}`, { method: 'POST', body: JSON.stringify({ name: 'B-EG', areaM2: 50, participates: true }) })
    await s.api('/api/costItems?property=objekt-1', {
      method: 'POST',
      body: JSON.stringify({ year: 2025, category: 'Grundsteuer', description: 'Nur A', amountCents: 50000, key: 'area' }),
    })
    const inB = await s.api<{ totalCostsCents: number }>(`/api/settlement/2025?property=${b.id}`)
    assert.equal(inB.totalCostsCents, 0, 'die Rechnung von A taucht in B nicht auf')
    const inA = await s.api<{ totalCostsCents: number }>('/api/settlement/2025?property=objekt-1')
    assert.equal(inA.totalCostsCents, 50000)

    await s.api('/api/settlement/2025/close?property=objekt-1', { method: 'POST', body: JSON.stringify({}) })
    assert.equal((await fetch(`${s.base}/api/settlement/2025/close?property=${b.id}`, { method: 'DELETE' })).status, 404)
    const nochZu = await s.api<{ closed: unknown }>('/api/settlement/2025?property=objekt-1')
    assert.notEqual(nochZu.closed, null, 'die Abrechnung von A ist noch abgeschlossen')
    await s.api(`/api/settlement/2025/close?property=${b.id}`, { method: 'POST', body: JSON.stringify({}) })
    for (const route of ['consumption', 'rentledger', 'taxreport']) {
      assert.equal((await fetch(`${s.base}/api/${route}/2025?property=${b.id}`)).status, 200, route)
    }
  })
})

test('Objekt: gelöscht wird nur ein leeres, und nie das letzte', async () => {
  await withProperties(async (s, b) => {
    await s.api(`/api/units?property=${b.id}`, { method: 'POST', body: JSON.stringify({ name: 'B-EG', areaM2: 50, participates: true }) })
    const belegt = await fetch(`${s.base}/api/properties/${b.id}`, { method: 'DELETE' })
    assert.equal(belegt.status, 409)
    assert.match((await jsonOf<{ error: string }>(belegt)).error, /1 Wohnung/)
    const [w] = await s.api<Unit[]>(`/api/units?property=${b.id}`)
    await s.api(`/api/units/${w?.id}`, { method: 'DELETE' })
    await s.api(`/api/properties/${b.id}`, { method: 'DELETE' })
    const letztes = await fetch(`${s.base}/api/properties/objekt-1`, { method: 'DELETE' })
    assert.equal(letztes.status, 409)
    assert.equal((await fetch(`${s.base}/api/properties/gibt-es-nicht`, { method: 'DELETE' })).status, 404)
  })
})

test('Objekt: ändern, und ein Verweis über die Objektgrenze wird mit 400 abgelehnt', async () => {
  await withProperties(async (s, b) => {
    const geaendert = await s.api<Property>(`/api/properties/${b.id}`, { method: 'PUT', body: JSON.stringify({ iban: 'DE99', address: 'Weg 3' }) })
    assert.equal(geaendert.iban, 'DE99')
    assert.equal(geaendert.name, 'Gartenweg 3')
    const a = await s.api<Unit>('/api/units?property=objekt-1', { method: 'POST', body: JSON.stringify({ name: 'A-EG', areaM2: 50, participates: true }) })
    const res = await fetch(`${s.base}/api/meters?property=${b.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'X', unitId: a.id, type: 'kaltwasser', unit: 'm³' }),
    })
    assert.equal(res.status, 400)
    assert.match((await jsonOf<{ error: string }>(res)).error, /Gartenweg 3/)
  })
})

test('Objekt: Teilnehmer und Einzelbeträge halten die Objektgrenze auch beim Umziehen (#94)', async () => {
  // Beides wurde mit #94 ergänzt, der Wächter kannte es nicht: Eine Wohnung mit Teilnahme oder
  // ein Mietverhältnis mit Einzelbetrag konnte über die API in ein anderes Objekt wechseln. Die
  // Position verlor still ihren Teilnehmer, und das nächste Backup ließ sich nicht einspielen.
  await withProperties(async (s, b) => {
    const a1 = await s.api<Unit>('/api/units?property=objekt-1', { method: 'POST', body: JSON.stringify({ name: 'A-EG', areaM2: 50, participates: true }) })
    const a2 = await s.api<Unit>('/api/units?property=objekt-1', { method: 'POST', body: JSON.stringify({ name: 'A-OG', areaM2: 50, participates: true }) })
    const b1 = await s.api<Unit>(`/api/units?property=${b.id}`, { method: 'POST', body: JSON.stringify({ name: 'B-EG', areaM2: 50, participates: true }) })
    const t = await s.api<Tenancy>('/api/tenancies?property=objekt-1', { method: 'POST', body: JSON.stringify({
      unitId: a2.id, tenantName: 'Meier', persons: 1, personHistory: [], start: '2025-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [],
    }) })
    await s.api('/api/costItems?property=objekt-1', { method: 'POST', body: JSON.stringify({
      year: 2025, category: 'Aufzug', description: 'Aufzug', amountCents: 10000, key: 'area', participantUnitIds: [a1.id],
    }) })
    await s.api('/api/costItems?property=objekt-1', { method: 'POST', body: JSON.stringify({
      year: 2025, category: 'Heizung', description: 'Heizung', amountCents: 10000, key: 'amounts', tenancyAmounts: { [t.id]: 5000 },
    }) })
    const umzug = await fetch(`${s.base}/api/units/${a1.id}?property=objekt-1`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ propertyId: b.id }),
    })
    assert.equal(umzug.status, 400, 'die Wohnung ist Teilnehmerin einer Position im alten Objekt')
    assert.match((await jsonOf<{ error: string }>(umzug)).error, /Teilnahme/)
    const wechsel = await fetch(`${s.base}/api/tenancies/${t.id}?property=objekt-1`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ unitId: b1.id }),
    })
    assert.equal(wechsel.status, 400, 'das Mietverhältnis hat einen Einzelbetrag im alten Objekt')
    assert.match((await jsonOf<{ error: string }>(wechsel)).error, /Einzelbetr/)
  })
})

test('Eigenbeträge (#104): gespeichert, gelesen, gerechnet, und nur im eigenen Objekt', async () => {
  await withProperties(async (s, b) => {
    const eigen = await s.api<Unit>('/api/units?property=objekt-1', { method: 'POST', body: JSON.stringify({ name: 'Haupt', areaM2: 100, participates: false, selfUsed: true }) })
    const el = await s.api<Unit>('/api/units?property=objekt-1', { method: 'POST', body: JSON.stringify({ name: 'Einlieger', areaM2: 50, participates: true }) })
    const fremd = await s.api<Unit>(`/api/units?property=${b.id}`, { method: 'POST', body: JSON.stringify({ name: 'B', areaM2: 50, participates: false, selfUsed: true }) })
    const t = await s.api<Tenancy>('/api/tenancies?property=objekt-1', { method: 'POST', body: JSON.stringify({
      unitId: el.id, tenantName: 'Meier', persons: 1, personHistory: [], start: '2025-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [],
    }) })
    const k = await s.api<{ id: string, selfAmounts?: Record<string, number> }>('/api/costItems?property=objekt-1', { method: 'POST', body: JSON.stringify({
      year: 2025, category: 'Heizung und Warmwasser', description: 'Messdienst', amountCents: 300000, key: 'amounts',
      tenancyAmounts: { [t.id]: 124000 }, selfAmounts: { [eigen.id]: 160000 },
    }) })
    assert.deepEqual(k.selfAmounts, { [eigen.id]: 160000 })
    const abrechnung = await s.api<{ selfUsedShareCents: number }>('/api/settlement/2025?property=objekt-1')
    assert.equal(abrechnung.selfUsedShareCents, 160000)
    const quer = await fetch(`${s.base}/api/costItems/${k.id}?property=objekt-1`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ selfAmounts: { [fremd.id]: 100 } }),
    })
    assert.equal(quer.status, 400, 'ein Eigenbetrag für eine Wohnung eines anderen Objekts')
  })
})

test('Einheit ohne Anschluss (#117): gespeichert, gelesen, unbekannte Typen fallen weg, Löschen räumt ab', async () => {
  const s = await startServer()
  try {
    const g = await s.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'Garage', areaM2: 15, participates: true, noConnection: ['kaltwasser', 'kaltwasser', 'erfunden'] }) })
    assert.deepEqual(g.noConnection, ['kaltwasser'])
    const g2 = await s.api<Unit>(`/api/units/${g.id}`, { method: 'PUT', body: JSON.stringify({ noConnection: ['kaltwasser', 'strom'] }) })
    assert.deepEqual(g2.noConnection, ['kaltwasser', 'strom'])
    const g3 = await s.api<Unit>(`/api/units/${g.id}`, { method: 'PUT', body: JSON.stringify({ name: 'Garage 1' }) })
    assert.deepEqual(g3.noConnection, ['kaltwasser', 'strom'], 'ein Teilrumpf lässt die Angabe stehen')
    await s.api(`/api/units/${g.id}`, { method: 'DELETE' })
  } finally {
    s.stop()
  }
})

test('Kabelanlage ab dem 01.12.2021 (#121): am Objekt gespeichert, und die Abrechnung 2023 warnt', async () => {
  const s = await startServer()
  try {
    const [objekt] = await s.api<Property[]>('/api/properties')
    const p = await s.api<Property>(`/api/properties/${objekt?.id}`, { method: 'PUT', body: JSON.stringify({ cableBuiltBeforeDec2021: false }) })
    assert.equal(p.cableBuiltBeforeDec2021, false)
    const u = await s.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 50, participates: true }) })
    await s.api('/api/tenancies', { method: 'POST', body: JSON.stringify({ unitId: u.id, tenantName: 'M', persons: 1, personHistory: [], start: '2023-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] }) })
    await s.api('/api/costItems', { method: 'POST', body: JSON.stringify({ year: 2023, category: 'Kabel/Antenne', description: 'Kabel', amountCents: 12000, key: 'units' }) })
    const abrechnung = await s.api<Settlement>('/api/settlement/2023')
    assert.deepEqual(abrechnung.notices?.map((n) => n.code), ['tv-signal.new-system'])
    const zurueck = await s.api<Property>(`/api/properties/${objekt?.id}`, { method: 'PUT', body: JSON.stringify({ cableBuiltBeforeDec2021: null }) })
    assert.equal(zurueck.cableBuiltBeforeDec2021, null, 'unbekannt ist ein ausdrücklicher Wert')
  } finally {
    s.stop()
  }
})

test('Objekt: die Einstellungen führen Hausname und Adresse nicht mehr, auch wenn ein alter Tab sie schickt', async () => {
  const s = await startServer()
  try {
    const nachher = await s.api<Record<string, unknown>>('/api/settings', { method: 'PUT', body: JSON.stringify({ houseName: 'Alter Tab', address: 'Weg 1', landlordName: 'Erika' }) })
    assert.equal('houseName' in nachher, false)
    assert.equal('address' in nachher, false)
    assert.equal(nachher.landlordName, 'Erika')
    const [objekt] = await s.api<Property[]>('/api/properties')
    assert.equal(objekt?.name, '', 'der Name des Objekts kommt aus dem Objekt, nicht aus einem alten Tab')
  } finally {
    s.stop()
  }
})

// Eine Datenbank, wie sie ein Nutzer von v0.8.0 im Backup hat: Stand 0000 mit Bestand.
async function databaseOfV080(settlementYear: number): Promise<Buffer> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-v080-'))
  try {
    const file = path.join(dir, 'mietfuchs.sqlite')
    const connection = await connect(file)
    const migrations = await loadMigrations()
    applyMigrations(connection, migrations.slice(0, 1))
    await writeStock(connection.db, straightenForDatabase(migrateLegacy({
      settings: { houseName: 'Lindenstraße 7', address: '12345 Stadt', landlordName: 'Erika', iban: 'DE01', paymentDeadlineDays: 30, ollamaUrl: '', ollamaModel: '' },
      units: [{ id: 'u1', name: 'EG', areaM2: 60, participates: true }, { id: 'u2', name: 'OG', areaM2: 40, participates: true }],
      tenancies: [],
      costItems: [{ id: 'c1', year: settlementYear, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 100000, key: 'area' }],
      meters: [], readings: [], payments: [], closedSettlements: [],
    })))
    connection.close()
    return fs.readFileSync(file)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test('Objekt: ein Backup von v0.8.0 kommt als Objekt 1 zurück, mit denselben Zahlen', async () => {
  const s = await startServer()
  try {
    const zip = new AdmZip()
    zip.addFile('mietfuchs.sqlite', await databaseOfV080(2025))
    const r = await restore(s, zip.toBuffer())
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const objekte = await s.api<Property[]>('/api/properties')
    assert.deepEqual(objekte.map((p) => [p.id, p.name, p.address]), [['objekt-1', 'Lindenstraße 7', '12345 Stadt']])
    const abrechnung = await s.api<{ totalCostsCents: number, landlord: { totalCents: number } }>('/api/settlement/2025')
    assert.equal(abrechnung.totalCostsCents, 100000)
  } finally {
    s.stop()
  }
})

test('Objekt: ein Backup mit einem Verweis über die Objektgrenze wird abgelehnt, bevor etwas ersetzt ist', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-kreuz-'))
  const s = await startServer()
  try {
    const file = path.join(dir, 'mietfuchs.sqlite')
    const connection = await connect(file)
    applyMigrations(connection, await loadMigrations())
    connection.exec(`INSERT INTO properties (id, name, kind, address) VALUES ('objekt-2', 'Zwei', 'mfh', '')`)
    connection.exec(`INSERT INTO units (id, property_id, name, area_m2, participates) VALUES ('u1', 'objekt-1', 'EG', 50, 1)`)
    connection.exec(`INSERT INTO meters (id, property_id, name, unit_id, type, unit) VALUES ('m1', 'objekt-2', 'X', 'u1', 'kaltwasser', 'm³')`)
    connection.close()
    const vorher = await s.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'bleibt', areaM2: 1, participates: true }) })
    const zip = new AdmZip()
    zip.addFile('mietfuchs.sqlite', fs.readFileSync(file))
    const r = await restore(s, zip.toBuffer())
    assert.equal(r.status, 400)
    assert.match(String(r.body.error), /Zähler/)
    assert.deepEqual((await s.api<Unit[]>('/api/units')).map((u) => u.id), [vorher.id], 'die bisherigen Daten sind unverändert')
  } finally {
    s.stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ---------- Sicherung vor dem Update anzeigen (#154) ----------

// Eine Datenbank auf dem Stand von v0.8.0 (nur Schritt 0000) in einem Wegwerf-Ordner.
async function dataDirAtBaseline(): Promise<string> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
  const connection = await connect(path.join(dataDir, 'mietfuchs.sqlite'))
  try {
    applyMigrations(connection, (await loadMigrations()).slice(0, 1))
  } finally {
    connection.close()
  }
  return dataDir
}

test('Update: nach nachgeholten Schritten nennt /healthz die Sicherung, auch nach einem Neustart, bis die Oberfläche sie wegklickt', async () => {
  const dataDir = await dataDirAtBaseline()
  const schritte = (await loadMigrations()).length - 1
  const erster = await startServerIn(dataDir)
  let genannt: { steps: number, backup: string, at: string }
  try {
    const report = await erster.api<HealthReport>('/healthz')
    // Nur der Name: Die Oberfläche sagt „im Datenordner“, einen Pfad braucht sie nicht.
    genannt = report.database?.migrated ?? assert.fail('keine Sicherung genannt')
    const { at, ...rest } = genannt
    assert.deepEqual(rest, { steps: schritte, backup: 'mietfuchs.sqlite.vor-0001_objekte' })
    // Der Zeitpunkt der Sicherung unterscheidet sie von einer früheren gleichen Namens.
    assert.equal(at, fs.statSync(path.join(dataDir, 'mietfuchs.sqlite.vor-0001_objekte')).mtime.toISOString())
    assert.ok(fs.existsSync(path.join(dataDir, 'mietfuchs.sqlite.vor-0001_objekte')), 'die genannte Sicherung fehlt')
    // #180: Auch auf der Konsole, mit vollem Pfad, denn dort liest es jemand, der die Datei sucht.
    assert.ok(erster.output().includes(path.join(dataDir, 'mietfuchs.sqlite.vor-0001_objekte')), erster.output())
  } finally {
    erster.child.kill()
    await waitForExit(erster.child)
  }
  // #180: Ein Neustart, bevor jemand die Oberfläche geöffnet hat (Docker, npm), nimmt den Hinweis
  // nicht mit. Er nennt dieselbe Sicherung mit demselben Zeitpunkt, die Konsole aber nicht noch
  // einmal: Nachgeholt hat dieser Start nichts.
  const zweiter = await startServerIn(dataDir)
  try {
    const report = await zweiter.api<HealthReport>('/healthz')
    assert.deepEqual(report.database?.migrated, genannt, JSON.stringify(report.database))
    assert.ok(!zweiter.output().includes('vor-0001_objekte'), zweiter.output())
    // Ein fremder Schlüssel (ein Tab von vor einem weiteren Update) räumt nichts weg.
    const fremd = await fetch(`${zweiter.base}/api/database/migrated/seen`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'mietfuchs.sqlite.vor-0001_objekte@1970-01-01T00:00:00.000Z' }),
    })
    assert.equal(fremd.status, 200)
    assert.deepEqual((await zweiter.api<HealthReport>('/healthz')).database?.migrated, genannt)
    // Weggeklickt: danach nicht mehr, auch nicht nach dem nächsten Start.
    const gesehen = await fetch(`${zweiter.base}/api/database/migrated/seen`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: `${genannt.backup}@${genannt.at}` }),
    })
    assert.equal(gesehen.status, 200)
    assert.equal((await zweiter.api<HealthReport>('/healthz')).database?.migrated, null)
  } finally {
    zweiter.child.kill()
    await waitForExit(zweiter.child)
  }
  const dritter = await startServerIn(dataDir)
  try {
    assert.equal((await dritter.api<HealthReport>('/healthz')).database?.migrated, null)
  } finally {
    dritter.stop()
  }
})

test('Update: nach einem gelungenen Umstieg aus der db.json nennt niemand die Sicherung der leeren Datenbank (Durchsicht zu #180)', async () => {
  // Ein früher gescheiterter Umstieg hat eine leere Datenbank auf 0000 hinterlassen, daneben liegt
  // die db.json. Die neue Version holt die Schritte nach (Sicherung der leeren Datei) und steigt
  // dann um. Die Sicherung ist kein Rückweg: Sie enthielte nichts, die db.json heißt schon „abgelöst“.
  const dataDir = await dataDirAtBaseline()
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    settings: { houseName: 'Haus am Weg', address: 'Weg 1', landlordName: 'V', iban: '', paymentDeadlineDays: 30 },
    units: [{ id: 'u1', name: 'EG', areaM2: 80, participates: true }],
    tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [],
  }))
  // Eine Merkdatei aus einem früheren Update darf den Umstieg ebenso wenig überleben.
  fs.writeFileSync(path.join(dataDir, 'sicherung-vor-update.json'), JSON.stringify({ steps: 1, backup: 'mietfuchs.sqlite.vor-0001_objekte', at: 'früher' }))
  const erster = await startServerIn(dataDir)
  try {
    const report = await erster.api<HealthReport>('/healthz')
    assert.equal(report.database?.changeover.state, 'done', JSON.stringify(report.database))
    assert.equal(report.database?.migrated, null, JSON.stringify(report.database))
    assert.ok(!erster.output().includes('Sicherung Ihrer Daten'), erster.output())
    assert.equal(fs.existsSync(path.join(dataDir, 'sicherung-vor-update.json')), false, 'die Merkdatei liegt noch da')
  } finally {
    erster.child.kill()
    await waitForExit(erster.child)
  }
  const zweiter = await startServerIn(dataDir)
  try {
    assert.equal((await zweiter.api<HealthReport>('/healthz')).database?.migrated, null)
  } finally {
    zweiter.stop()
  }
})

test('Update: der gelesene Hinweis wird mit fehlendem Schlüssel abgelehnt', async () => {
  const s = await startServer()
  try {
    const res = await fetch(`${s.base}/api/database/migrated/seen`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    assert.equal(res.status, 400)
  } finally {
    s.stop()
  }
})

test('Update: nach dem Wiederherstellen nennt /healthz keine Sicherung, die zu diesem Stand nicht gehört', async () => {
  // Das Archiv von v0.8.0 wird auf einer Zwischenkopie migriert, ohne Sicherung davor; der
  // bisherige Stand liegt als mietfuchs.sqlite.vor-restore daneben.
  const dataDir = await dataDirAtBaseline()
  const s = await startServerIn(dataDir)
  try {
    assert.notEqual((await s.api<HealthReport>('/healthz')).database?.migrated, null)
    const zip = new AdmZip()
    zip.addFile('mietfuchs.sqlite', await databaseOfV080(2025))
    const r = await restore(s, zip.toBuffer())
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal((await s.api<HealthReport>('/healthz')).database?.migrated, null)
  } finally {
    s.child.kill()
    await waitForExit(s.child)
  }
  // Und ein Neustart holt den Hinweis auf die Sicherung vor dem Update nicht zurück (#180).
  const danach = await startServerIn(dataDir)
  try {
    assert.equal((await danach.api<HealthReport>('/healthz')).database?.migrated, null)
  } finally {
    danach.stop()
  }
})

// ---------- Mieterwechsel in einem Schritt (#150) ----------
//
// Der Assistent schickte drei Anfragen nacheinander: altes Mietverhältnis beenden,
// Zwischenablesungen anlegen, neues Mietverhältnis anlegen. Lehnte der Server den dritten Schritt
// ab, waren die ersten beiden schon gespeichert, und ein zweiter Versuch legte die Ablesungen
// doppelt an. Jetzt gibt es eine Route, die alles in einer Transaktion schreibt.

type TenantChangeAnswer = { ended: Tenancy, newTenancy: Tenancy | null, readings: Reading[] }

// Ein Objekt mit einer Wohnung, einem offenen Mietverhältnis, einem Wohnungs- und einem
// Hauptzähler.
async function changeStock(s: Server, propertyId = 'objekt-1') {
  const unit = await s.api<Unit>(`/api/units?property=${propertyId}`, { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 60, participates: true }) })
  const tenancy = await s.api<Tenancy>(`/api/tenancies?property=${propertyId}`, { method: 'POST', body: JSON.stringify({
    unitId: unit.id, tenantName: 'Alt', persons: 2, personHistory: [{ from: '2024-01-01', persons: 2 }], start: '2024-01-01', end: null,
    prepayments: [{ from: '2024-01', monthlyCents: 12000 }], prepaymentOverrides: {}, baseRents: [],
  }) })
  const wasser = await s.api<Meter>(`/api/meters?property=${propertyId}`, { method: 'POST', body: JSON.stringify({ name: 'KW EG', unitId: unit.id, type: 'kaltwasser', unit: 'm³' }) })
  const haupt = await s.api<Meter>(`/api/meters?property=${propertyId}`, { method: 'POST', body: JSON.stringify({ name: 'Haupt', unitId: null, type: 'kaltwasser', unit: 'm³' }) })
  return { unit, tenancy, wasser, haupt }
}

const newTenancyBody = (prepaymentCents: number) => ({
  tenantName: 'Neu', persons: 3, personHistory: [{ from: '2025-07-01', persons: 3 }], start: '2025-07-01',
  baseRents: [{ from: '2025-07', monthlyCents: 80000 }], prepayments: [{ from: '2025-07', monthlyCents: prepaymentCents }],
  prepaymentOverrides: {}, costModel: 'flatRate',
})

const postChange = (s: Server, tenancyId: string, body: unknown, propertyId = 'objekt-1') =>
  fetch(`${s.base}/api/tenancies/${tenancyId}/change?property=${propertyId}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })

test('Mieterwechsel (#150): beendet, liest ab und legt den Nachmieter an, alles in einem Schritt', async () => {
  const s = await startServer()
  try {
    const { unit, tenancy, wasser, haupt } = await changeStock(s)
    const res = await postChange(s, tenancy.id, {
      end: '2025-06-30', readings: [{ meterId: wasser.id, value: 123.5 }, { meterId: haupt.id, value: 980 }], newTenancy: newTenancyBody(15000),
    })
    assert.equal(res.status, 200, await res.clone().text())
    const answer = await jsonOf<TenantChangeAnswer>(res)
    assert.equal(answer.ended.end, '2025-06-30')
    assert.equal(answer.newTenancy?.unitId, unit.id)
    assert.equal(answer.newTenancy?.end, null)
    assert.equal(answer.newTenancy?.costModel, 'flatRate')
    assert.deepEqual(answer.newTenancy?.prepayments, [{ from: '2025-07', monthlyCents: 15000 }])
    assert.equal(answer.readings.length, 2)

    const tenancies = await s.api<Tenancy[]>('/api/tenancies?property=objekt-1')
    assert.equal(tenancies.find((t) => t.id === tenancy.id)?.end, '2025-06-30')
    assert.deepEqual(tenancies.map((t) => t.tenantName), ['Alt', 'Neu'])
    const readings = await s.api<Reading[]>('/api/readings?property=objekt-1')
    assert.deepEqual(readings.map((r) => [r.meterId, r.date, r.value]).sort(), [[haupt.id, '2025-06-30', 980], [wasser.id, '2025-06-30', 123.5]].sort())
    assert.ok(readings.every((r) => /Mieterwechsel Alt/.test(r.note ?? '')), 'die Ablesung trägt keinen Vermerk')

    // Leerstand: ohne neues Mietverhältnis
    const leer = await postChange(s, answer.newTenancy?.id ?? assert.fail('kein Nachmieter'), { end: '2026-03-31', readings: [], newTenancy: null })
    assert.equal(leer.status, 200)
    assert.equal((await jsonOf<TenantChangeAnswer>(leer)).newTenancy, null)
  } finally {
    s.stop()
  }
})

test('Mieterwechsel (#150): scheitert der dritte Schritt, ist nichts gespeichert, und ein zweiter Versuch legt nichts doppelt an', async () => {
  const s = await startServer()
  try {
    const { tenancy, wasser, haupt } = await changeStock(s)
    const readings = [{ meterId: wasser.id, value: 123.5 }, { meterId: haupt.id, value: 980 }]
    const res = await postChange(s, tenancy.id, { end: '2025-06-30', readings, newTenancy: newTenancyBody(-100) })
    assert.equal(res.status, 400)
    const fehler = await errorFrom(res)
    assert.doesNotMatch(fehler, /Failed query|insert into|params:/, 'SQL in der Meldung')
    assert.equal((await s.api<Tenancy[]>('/api/tenancies?property=objekt-1')).find((t) => t.id === tenancy.id)?.end, null, 'das alte Mietverhältnis wurde trotzdem beendet')
    assert.deepEqual(await s.api<Reading[]>('/api/readings?property=objekt-1'), [], 'Zwischenablesungen blieben stehen')
    assert.equal((await s.api<Tenancy[]>('/api/tenancies?property=objekt-1')).length, 1)

    // Der zweite Versuch mit richtiger Vorauszahlung: jede Ablesung genau einmal.
    const zweiter = await postChange(s, tenancy.id, { end: '2025-06-30', readings, newTenancy: newTenancyBody(15000) })
    assert.equal(zweiter.status, 200, await zweiter.clone().text())
    assert.equal((await s.api<Reading[]>('/api/readings?property=objekt-1')).length, 2)
    assert.equal((await s.api<Tenancy[]>('/api/tenancies?property=objekt-1')).length, 2)

    // Ein doppelt abgeschickter Wechsel trifft ein schon beendetes Mietverhältnis und legt nichts an.
    const dritter = await postChange(s, tenancy.id, { end: '2025-06-30', readings, newTenancy: newTenancyBody(15000) })
    assert.equal(dritter.status, 409)
    assert.match(await errorFrom(dritter), /bereits zum 30\.06\.2025 beendet/, "das Datum steht deutsch da")
    assert.equal((await s.api<Reading[]>('/api/readings?property=objekt-1')).length, 2)
    assert.equal((await s.api<Tenancy[]>('/api/tenancies?property=objekt-1')).length, 2)
  } finally {
    s.stop()
  }
})

// #204: Der Mieterwechsel setzt die Daten lückenlos und erzeugt nie eine Überschneidung. Ein von
// Hand angelegtes Mietverhältnis, das sich überschneidet, nimmt der Server an (die Oberfläche fragt
// nach), und die Abrechnung meldet es als Fehler.
test('Überschneidung (#204): Mieterwechsel lückenlos; ein überschneidendes Mietverhältnis wird angenommen und in der Abrechnung gemeldet', async () => {
  const s = await startServer()
  try {
    const { unit, tenancy, wasser, haupt } = await changeStock(s)
    await s.api('/api/costItems?property=objekt-1', { method: 'POST', body: JSON.stringify({ year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 120000, key: 'area' }) })
    const res = await postChange(s, tenancy.id, { end: '2025-06-30', readings: [{ meterId: wasser.id, value: 1 }, { meterId: haupt.id, value: 2 }], newTenancy: { ...newTenancyBody(15000), costModel: null } })
    assert.equal(res.status, 200, await res.clone().text())
    assert.deepEqual(tenancyOverlaps(await s.api<Tenancy[]>('/api/tenancies?property=objekt-1')), [])
    const vorher = await s.api<Settlement>('/api/settlement/2025?property=objekt-1')
    assert.equal(vorher.notices?.some((n) => n.code === 'tenancy.overlap'), false)

    const anlegen = await fetch(`${s.base}/api/tenancies?property=objekt-1`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      unitId: unit.id, tenantName: 'Doppelt', persons: 1, personHistory: [{ from: '2025-06-01', persons: 1 }], start: '2025-06-01', end: '2025-08-31',
      prepayments: [], prepaymentOverrides: {}, baseRents: [],
    }) })
    assert.ok(anlegen.ok, `abgelehnt: ${anlegen.status} ${await anlegen.clone().text()}`)
    const s2025 = await s.api<Settlement>('/api/settlement/2025?property=objekt-1')
    const found = (s2025.notices ?? []).filter((n) => n.code === 'tenancy.overlap')
    // Alt (bis 30.06.) mit Doppelt (01.06. bis 31.08.), Doppelt mit Neu (ab 01.07.)
    assert.equal(found.length, 2)
    assert.ok(found.every((n) => n.level === 'error' && n.subject?.kind === 'tenancy'))
    assert.match(found[0]?.text ?? '', /Alt.*Doppelt.*vom 01\.06\.2025 bis 30\.06\.2025 \(30 Tage\)/)
  } finally {
    s.stop()
  }
})

test('Mieterwechsel (#150): unsinnige Angaben werden mit einem Satz abgelehnt, ohne etwas zu speichern', async () => {
  const s = await startServer()
  try {
    const { tenancy, wasser } = await changeStock(s)
    const faelle: Array<[string, unknown]> = [
      ['Auszug vor Einzug', { end: '2023-12-31', readings: [], newTenancy: null }],
      ['kein Datum', { end: 'gestern', readings: [], newTenancy: null }],
      ['Nachmieter vor dem Auszug', { end: '2025-06-30', readings: [], newTenancy: { ...newTenancyBody(15000), start: '2025-06-30' } }],
      ['Stand keine Zahl', { end: '2025-06-30', readings: [{ meterId: wasser.id, value: 'viel' }], newTenancy: null }],
      ['unbekannter Zähler', { end: '2025-06-30', readings: [{ meterId: 'gibt-es-nicht', value: 1 }], newTenancy: null }],
      ['derselbe Zähler zweimal', { end: '2025-06-30', readings: [{ meterId: wasser.id, value: 1 }, { meterId: wasser.id, value: 2 }], newTenancy: null }],
    ]
    for (const [fall, body] of faelle) {
      const res = await postChange(s, tenancy.id, body)
      assert.equal(res.status, 400, fall)
      assert.ok((await errorFrom(res)).length > 10, fall)
    }
    assert.equal((await s.api<Tenancy[]>('/api/tenancies?property=objekt-1')).find((t) => t.id === tenancy.id)?.end, null)
    assert.deepEqual(await s.api<Reading[]>('/api/readings?property=objekt-1'), [])
    assert.equal((await postChange(s, 'gibt-es-nicht', { end: '2025-06-30', readings: [], newTenancy: null })).status, 404)
  } finally {
    s.stop()
  }
})

test('Mieterwechsel (#150): über die Grenze eines Objekts wird mit 400 abgelehnt und nichts gespeichert', async () => {
  await withProperties(async (s, b) => {
    const a = await changeStock(s, 'objekt-1')
    const fremd = await changeStock(s, b.id)
    // Das Mietverhältnis gehört zu Objekt A, die Anfrage nennt B.
    const falschesObjekt = await postChange(s, a.tenancy.id, { end: '2025-06-30', readings: [], newTenancy: null }, b.id)
    assert.equal(falschesObjekt.status, 400)
    // Ein Zähler aus Objekt B.
    const fremderZaehler = await postChange(s, a.tenancy.id, { end: '2025-06-30', readings: [{ meterId: fremd.wasser.id, value: 1 }], newTenancy: null })
    assert.equal(fremderZaehler.status, 400)
    assert.match(await errorFrom(fremderZaehler), /Zähler/)
    // Der Nachmieter soll in eine Wohnung aus Objekt B.
    const fremdeWohnung = await postChange(s, a.tenancy.id, { end: '2025-06-30', readings: [], newTenancy: { ...newTenancyBody(15000), unitId: fremd.unit.id } })
    assert.equal(fremdeWohnung.status, 400)

    assert.equal((await s.api<Tenancy[]>('/api/tenancies?property=objekt-1')).find((t) => t.id === a.tenancy.id)?.end, null)
    assert.equal((await s.api<Tenancy[]>(`/api/tenancies?property=${b.id}`)).length, 1)
    assert.deepEqual(await s.api<Reading[]>('/api/readings?property=objekt-1'), [])
    assert.deepEqual(await s.api<Reading[]>(`/api/readings?property=${b.id}`), [])
  })
})

// ---------- Belegordner (#170) ----------

async function uploadBelegFile(s: Server, content: string | Buffer, name: string, fields: Record<string, string> = {}): Promise<string> {
  const fd = new FormData()
  fd.append('file', new Blob([Buffer.from(content)], { type: name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg' }), name)
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  const res = await fetch(`${s.base}/api/upload`, { method: 'POST', body: fd })
  assert.equal(res.status, 200, await res.clone().text())
  return fileOf(await jsonOf<UploadBody>(res))
}

test('Belegordner (#170): die Liste nennt Prüfsumme, Originalname und Hochladezeit; gleicher Inhalt ist erkennbar', async () => {
  const s = await startServer()
  try {
    const vorher = Date.now()
    const a = await uploadBelegFile(s, '%PDF-Grundsteuer', 'Grundsteuer 2025.pdf')
    const b = await uploadBelegFile(s, '%PDF-Grundsteuer', 'Kopie.pdf')
    const c = await uploadBelegFile(s, '%PDF-anders', 'Wasser.pdf')
    const list = await s.api<UploadInfo[]>('/api/uploads')
    const of = (file: string) => list.find((u) => u.file === file) ?? assert.fail(`${file} fehlt`)
    assert.equal(of(a).sha256, of(b).sha256, 'gleicher Inhalt, gleiche Prüfsumme')
    assert.notEqual(of(a).sha256, of(c).sha256)
    assert.match(of(a).sha256, /^[0-9a-f]{64}$/)
    assert.match(of(a).originalName, /^Grundsteuer.2025\.pdf$/)
    assert.equal(of(a).mimeType, 'application/pdf')
    const zeit = new Date(of(a).uploadedAt).getTime()
    assert.ok(zeit >= vorher - 1000 && zeit <= Date.now() + 1000, `Hochladezeit ${of(a).uploadedAt}`)
  } finally {
    s.stop()
  }
})

// Die Angaben zu einem Beleg, an den Routen vorbei: so, wie die Liste ihn beschreibt.
async function listedUpload(s: Server, file: string): Promise<UploadInfo> {
  return (await s.api<UploadInfo[]>('/api/uploads')).find((u) => u.file === file) ?? assert.fail(`${file} fehlt in der Liste`)
}

const putUpload = (s: Server, file: string, body: unknown) =>
  fetch(`${s.base}/api/uploads/${encodeURIComponent(file)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

test('Posteingang (#170): ein Beleg kommt mit Objekt, Jahr und seinem echten Namen in die Tabelle', async () => {
  await withProperties(async (s, b) => {
    const file = await uploadBelegFile(s, '%PDF-Posteingang', 'Grundsteuer (Bescheid) 2025.pdf', { propertyId: b.id, year: '2025' })
    const u = await listedUpload(s, file)
    assert.equal(u.propertyId, b.id)
    assert.equal(u.year, 2025)
    // Der Name auf der Platte ist gefiltert, der Originalname nicht.
    assert.equal(u.originalName, 'Grundsteuer (Bescheid) 2025.pdf')
    assert.equal(u.invoiceDate, null)
    // Ohne Angaben landet er im Posteingang ohne Objekt und Jahr.
    const lose = await uploadBelegFile(s, '%PDF-lose', 'lose.pdf')
    assert.equal((await listedUpload(s, lose)).propertyId, null)
  })
})

test('Posteingang (#170): ein unbekanntes Objekt oder Jahr wird abgelehnt, ohne Rest im Ordner', async () => {
  const s = await startServer()
  try {
    for (const fields of [{ propertyId: 'gibt-es-nicht' }, { year: 'zwanzig' }, { year: '0' }]) {
      const fd = new FormData()
      fd.append('file', new Blob([Buffer.from('%PDF')], { type: 'application/pdf' }), 'x.pdf')
      for (const [k, v] of Object.entries(fields)) fd.append(k, v)
      const res = await fetch(`${s.base}/api/upload`, { method: 'POST', body: fd })
      assert.ok(res.status === 400 || res.status === 404, `${JSON.stringify(fields)} → ${res.status}`)
    }
    assert.deepEqual(await s.api<UploadInfo[]>('/api/uploads'), [])
  } finally {
    s.stop()
  }
})

test('Posteingang (#170): Objekt, Jahr und Rechnungsdatum lassen sich ändern, auch bei einem Beleg ohne Zeile', async () => {
  await withProperties(async (s, b) => {
    const file = await uploadBelegFile(s, '%PDF-a', 'a.pdf')
    const ok = await putUpload(s, file, { propertyId: b.id, year: 2024, invoiceDate: '2025-02-15' })
    assert.equal(ok.status, 200)
    const u = await listedUpload(s, file)
    assert.deepEqual([u.propertyId, u.year, u.invoiceDate], [b.id, 2024, '2025-02-15'])
    // Teilweise: nur das Jahr leeren
    assert.equal((await putUpload(s, file, { year: null })).status, 200)
    assert.deepEqual([(await listedUpload(s, file)).propertyId, (await listedUpload(s, file)).year], [b.id, null])

    // Ein Beleg, zu dem die Datenbank nichts weiß (vor der Tabelle hochgeladen, aus einem alten Backup)
    const alt = '1700000000000_alt.pdf'
    fs.writeFileSync(path.join(s.dataDir, 'uploads', alt), '%PDF-alt')
    assert.equal((await listedUpload(s, alt)).propertyId, null)
    assert.equal((await putUpload(s, alt, { propertyId: 'objekt-1' })).status, 200)
    const altInfo = await listedUpload(s, alt)
    assert.equal(altInfo.propertyId, 'objekt-1')
    assert.equal(altInfo.uploadedAt, new Date(1700000000000).toISOString())

    // Abgelehnt: unbekanntes Objekt, ein Jahr, das keines ist, ein Datum, das es nicht gibt, eine fehlende Datei
    assert.equal((await putUpload(s, file, { propertyId: 'gibt-es-nicht' })).status, 404)
    assert.equal((await putUpload(s, file, { year: 2024.5 })).status, 400)
    assert.equal((await putUpload(s, file, { invoiceDate: '2025-02-31' })).status, 400)
    assert.equal((await putUpload(s, 'fehlt.pdf', { year: 2024 })).status, 404)
    assert.deepEqual([(await listedUpload(s, file)).propertyId, (await listedUpload(s, file)).invoiceDate], [b.id, '2025-02-15'])
  })
})

test('Posteingang (#170): Löschen nimmt die Angaben mit; gelöscht wird nur, was an keiner Position irgendeines Objekts hängt', async () => {
  await withProperties(async (s, b) => {
    const file = await uploadBelegFile(s, '%PDF-b', 'b.pdf', { propertyId: 'objekt-1', year: '2025' })
    // Verknüpft im **anderen** Objekt
    const item = await s.api<CostItem>(`/api/costItems?property=${b.id}`, {
      method: 'POST',
      body: JSON.stringify({ year: 2025, category: 'Grundsteuer', description: 'GS', amountCents: 100, key: 'area', invoiceFile: file }),
    })
    const verweigert = await fetch(`${s.base}/api/uploads/${encodeURIComponent(file)}`, { method: 'DELETE' })
    assert.equal(verweigert.status, 409)
    await s.api(`/api/costItems/${item.id}`, { method: 'DELETE' })
    assert.equal((await fetch(`${s.base}/api/uploads/${encodeURIComponent(file)}`, { method: 'DELETE' })).status, 200)
    // Entsteht später eine Datei gleichen Namens, erbt sie nichts.
    fs.writeFileSync(path.join(s.dataDir, 'uploads', file), '%PDF-neu')
    assert.equal((await listedUpload(s, file)).propertyId, null)
  })
})

test('Backup (#170): die Angaben zu Belegen kommen mit, auf die Millisekunde', async () => {
  await withProperties(async (s, b) => {
    const file = await uploadBelegFile(s, '%PDF-c', 'Wasser Stadtwerke.pdf', { propertyId: b.id, year: '2025' })
    assert.equal((await putUpload(s, file, { invoiceDate: '2026-02-15' })).status, 200)
    const vorher = await listedUpload(s, file)
    const backup = Buffer.from(await (await fetch(`${s.base}/api/backup`)).arrayBuffer())
    // Danach ändern und löschen, damit das Wiederherstellen wirklich etwas zurückbringt
    assert.equal((await putUpload(s, file, { year: 2020 })).status, 200)
    assert.equal((await restore(s, backup)).status, 200)
    const nachher = await listedUpload(s, file)
    assert.deepEqual(
      [nachher.propertyId, nachher.year, nachher.invoiceDate, nachher.originalName, nachher.uploadedAt, nachher.sha256],
      [b.id, 2025, '2026-02-15', 'Wasser Stadtwerke.pdf', vorher.uploadedAt, vorher.sha256],
    )
  })
})

test('Backup (#170): ein Archiv ohne die Tabelle (nur db.json) bringt seine Belege ohne Angaben in den Posteingang', async () => {
  const s = await startServer()
  try {
    const r = await restore(s, archive({ 'uploads/1700000000000_alt.pdf': '%PDF-alt' }))
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const u = await listedUpload(s, '1700000000000_alt.pdf')
    assert.deepEqual([u.propertyId, u.year, u.originalName, u.uploadedAt], [null, null, 'alt.pdf', new Date(1700000000000).toISOString()])
    // Und die Tabelle ist da: Zuordnen geht.
    assert.equal((await putUpload(s, u.file, { year: 2023 })).status, 200)
  } finally {
    s.stop()
  }
})

test('KI-Auswertung (#170): ein Beleg aus dem Posteingang wird ausgewertet, ohne ein zweites Mal hochgeladen zu werden', async () => {
  await withOllama(async (s, ollama) => {
    const file = await uploadBelegFile(s, PDF, 'posteingang.pdf')
    const fd = new FormData()
    fd.append('existingFile', file)
    fd.append('pdfText', LONG_TEXT)
    const res = await fetch(`${s.base}/api/intake`, { method: 'POST', body: fd })
    assert.equal(res.status, 200)
    const body = await jsonOf<UploadBody>(res)
    assert.equal(body.file, file)
    assert.ok(firstMessage(ollama).content.includes(LONG_TEXT))
    assert.deepEqual((await s.api<UploadInfo[]>('/api/uploads')).map((u) => u.file), [file], 'keine Kopie im Ordner')

    // Ein Name außerhalb des Ordners oder eine fehlende Datei wird abgelehnt.
    for (const name of ['../db.json', 'fehlt.pdf']) {
      const bad = new FormData()
      bad.append('existingFile', name)
      assert.equal((await fetch(`${s.base}/api/extract`, { method: 'POST', body: bad })).status, 400, name)
    }
  })
})

test('Belege für die Steuer (#170): ein ZIP je Objekt und Jahr nach Gruppen der Anlage V, nur dieses Objekt', async () => {
  await withProperties(async (s, b) => {
    const gs = await uploadBelegFile(s, '%PDF-gs', 'Grundsteuer.pdf')
    const verw = await uploadBelegFile(s, '%PDF-verw', 'Verwaltung.pdf')
    const fremd = await uploadBelegFile(s, '%PDF-fremd', 'Fremd.pdf')
    const post = (property: string, body: Record<string, unknown>) =>
      s.api<CostItem>(`/api/costItems?property=${property}`, { method: 'POST', body: JSON.stringify({ year: 2025, key: 'area', amountCents: 10000, ...body }) })
    await post('objekt-1', { category: 'Grundsteuer', description: 'GS', invoiceFile: gs })
    await post('objekt-1', { category: 'Nicht umlagefähig', description: 'Verwaltung', invoiceFile: verw })
    await post('objekt-1', { category: 'Grundsteuer', description: 'Vorjahr', year: 2024, invoiceFile: verw })
    await post(b.id, { category: 'Grundsteuer', description: 'GS B', invoiceFile: fremd })

    const res = await fetch(`${s.base}/api/receipts/tax/2025?property=objekt-1`)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'application/zip')
    assert.match(res.headers.get('content-disposition') ?? '', /attachment; filename="belege-steuer-2025-.*\.zip"/)
    const zip = new AdmZip(Buffer.from(await res.arrayBuffer()))
    const namen = zip.getEntries().map((e) => e.entryName).sort()
    assert.deepEqual(namen, [
      '1 Grundsteuer & öffentliche Abgaben/Grundsteuer - Grundsteuer.pdf',
      '4 Verwaltung & Instandhaltung/Nicht umlagefähig - Verwaltung.pdf',
      'Übersicht.csv',
    ])
    assert.equal(zip.readAsText('1 Grundsteuer & öffentliche Abgaben/Grundsteuer - Grundsteuer.pdf'), '%PDF-gs')
    assert.equal((await fetch(`${s.base}/api/receipts/tax/kein-jahr?property=objekt-1`)).status, 400)
    // Ohne Objekt bei mehreren Objekten: abgelehnt statt still beide
    assert.equal((await fetch(`${s.base}/api/receipts/tax/2025`)).status, 400)
  })
})

test('Belege für die Steuer: die Übersicht teilt jede Position in privat und abziehbar wie die Steuerübersicht (#163)', async () => {
  // Integrationsdurchsicht: Die CSV im ZIP nannte nur den Bruttobetrag. Bei teilweiser
  // Eigennutzung weist die Steuerübersicht privat und abziehbar getrennt aus, und gerade diese
  // Aufteilung braucht der Steuerberater neben den Belegen.
  await withProperties(async (s) => {
    const unit = (body: Record<string, unknown>) => s.api<Unit>('/api/units?property=objekt-1', { method: 'POST', body: JSON.stringify(body) })
    const eigen = await unit({ name: 'Eigen', areaM2: 60, participates: false, selfUsed: true })
    await unit({ name: 'Vermietet', areaM2: 40, participates: true })
    const post = (body: Record<string, unknown>) =>
      s.api<CostItem>('/api/costItems?property=objekt-1', { method: 'POST', body: JSON.stringify({ year: 2025, key: 'area', amountCents: 10000, ...body }) })
    await post({ category: 'Grundsteuer', description: 'GS', amountCents: 50000 })
    await post({ category: 'Nicht umlagefähig', description: 'Dach', amountCents: 200000 })
    await post({ category: 'Nicht umlagefähig', description: 'Bad Eigen', amountCents: 80000, key: 'direct', directUnitId: eigen.id })

    const tax = await s.api<TaxReport>('/api/taxreport/2025?property=objekt-1')
    assert.ok(tax.expenses.privateCents > 0, 'Vorbedingung: es gibt einen privaten Teil')
    const res = await fetch(`${s.base}/api/receipts/tax/2025?property=objekt-1`)
    assert.equal(res.status, 200)
    const zip = new AdmZip(Buffer.from(await res.arrayBuffer()))
    const [head, ...rows] = zip.readAsText('Übersicht.csv').replace(/^\uFEFF/, '').trim().split('\r\n').map((z) => z.split(';'))
    if (!head) return assert.fail('Übersicht ohne Kopfzeile')
    const col = (name: string) => {
      const i = head.indexOf(name)
      if (i < 0) assert.fail(`Spalte „${name}“ fehlt: ${head.join(';')}`)
      return i
    }
    const cents = (v: string | undefined) => Math.round(Number((v ?? '').replace(',', '.')) * 100)
    const [desc, priv, abz] = [col('Beschreibung'), col('privat (EUR)'), col('abziehbar (EUR)')]
    for (const item of tax.expenses.items) {
      const row = rows.find((r) => r[desc] === item.description)
      if (!row) return assert.fail(`Position ${item.description} fehlt in der Übersicht`)
      assert.deepEqual([cents(row[priv]), cents(row[abz])], [item.privateCents, item.deductibleCents], item.description)
    }
    const sum = (i: number) => rows.reduce((a, r) => a + cents(r[i]), 0)
    assert.deepEqual([sum(priv), sum(abz)], [tax.expenses.privateCents, tax.expenses.deductibleCents])
  })
})

test('Posteingang (#170): PUT nimmt nur einen Beleg im Ordner, keinen Verzeichnisnamen', async () => {
  // Durchsicht: „..“ besteht `basename` und `existsSync` und legte eine Zeile an.
  const s = await startServer()
  try {
    // Kodiert, sonst kürzt schon fetch den Pfad weg
    for (const name of ['%2E%2E', '%2E']) {
      const res = await fetch(`${s.base}/api/uploads/${name}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ year: 2024 }) })
      assert.equal(res.status, 404, name)
    }
  } finally {
    s.stop()
  }
})

test('Belegarchiv (#180): DELETE auf einen Verzeichnisnamen antwortet 404 statt 500 und löscht nichts', async () => {
  // „..“ besteht `basename` und `existsSync`; danach zielte `unlinkSync` auf den Datenordner und
  // scheiterte mit 500. Ebenso ein Unterordner im Belegordner. Gelöscht wurde dabei nichts.
  const s = await startServer()
  try {
    const file = await uploadBelegFile(s, '%PDF-x', 'x.pdf')
    fs.mkdirSync(path.join(s.dataDir, 'uploads', 'unterordner'))
    for (const name of ['%2E%2E', '%2E', 'unterordner']) {
      const res = await fetch(`${s.base}/api/uploads/${name}`, { method: 'DELETE' })
      assert.equal(res.status, 404, name)
    }
    assert.ok(fs.statSync(path.join(s.dataDir, 'uploads', 'unterordner')).isDirectory())
    assert.deepEqual((await s.api<UploadInfo[]>('/api/uploads')).map((u) => u.file), [file])
  } finally {
    s.stop()
  }
})

test('Belegordner (Durchsicht): ein Unterordner oder Fremdes im Belegordner bricht die Liste nicht ab', async () => {
  const s = await startServer()
  try {
    const file = await uploadBelegFile(s, '%PDF-x', 'x.pdf')
    fs.mkdirSync(path.join(s.dataDir, 'uploads', 'unterordner'))
    const res = await fetch(`${s.base}/api/uploads`)
    assert.equal(res.status, 200)
    assert.deepEqual((await jsonOf<UploadInfo[]>(res)).map((u) => u.file), [file])
  } finally {
    s.stop()
  }
})

test('Belegordner (Durchsicht): die Prüfsumme eines Belegs ohne Zeile wird einmal gerechnet und festgeschrieben', async () => {
  // Vorher rechnete jeder Start sie neu, synchron und im Speicher, und eine große Altablage hielt
  // dabei den ganzen Server an.
  const s = await startServer()
  try {
    const alt = '1700000000000_alt.pdf'
    const voll = path.join(s.dataDir, 'uploads', alt)
    fs.writeFileSync(voll, '%PDF-alt')
    const erwartet = createHash('sha256').update('%PDF-alt').digest('hex')
    let info: UploadInfo | undefined
    for (let i = 0; i < 50; i++) {
      info = (await s.api<UploadInfo[]>('/api/uploads')).find((u) => u.file === alt)
      if (info?.sha256) break
      await new Promise((r) => setTimeout(r, 100))
    }
    assert.equal(info?.sha256, erwartet, 'im Hintergrund nachgetragen')
    // Festgeschrieben: Auch wenn sich die Datei danach ändert, gilt die Zeile, ohne neu zu lesen.
    fs.writeFileSync(voll, '%PDF-anders')
    assert.equal((await listedUpload(s, alt)).sha256, erwartet)
  } finally {
    s.stop()
  }
})

test('Abbrechen per Kennung (#170): ein Beleg aus dem Posteingang bleibt samt Angaben liegen', async () => {
  await withOllama(async (s, ollama) => {
    const file = await uploadBelegFile(s, PDF, 'posteingang.pdf', { year: '2025' })
    const requestId = 'fedcba9876543210fedcba9876543210'
    const fd = new FormData()
    fd.append('existingFile', file)
    fd.append('pdfText', LONG_TEXT)
    fd.append('requestId', requestId)
    const pending = fetch(`${s.base}/api/extract`, { method: 'POST', body: fd, headers: { accept: 'application/x-ndjson' } }).then((r) => r.text())
    assert.ok(await until(() => chatRequests(ollama).length > 0), 'Ollama wurde nicht gefragt')
    assert.equal((await fetch(`${s.base}/api/ai/cancel/${requestId}`, { method: 'POST' })).status, 200)
    assert.ok(await until(() => ollama.closedEarly > 0), 'die Anfrage an Ollama lief weiter')
    await pending
    const u = await listedUpload(s, file)
    assert.equal(u.year, 2025, 'die Zeile ist noch da')
    assert.ok(fs.existsSync(path.join(s.dataDir, 'uploads', file)), 'die Datei ist noch da')
  }, { chat: 'hang' })
})

test('Schuhkarton (#170): ein Zählerfoto ist kein Beleg und steht nicht im Posteingang des Objekts', async () => {
  await withOllama(async (s) => {
    const fd = new FormData()
    fd.append('file', new Blob([Buffer.from('JPEG-Zaehler')], { type: 'image/jpeg' }), 'zaehler.jpg')
    fd.append('propertyId', 'objekt-1')
    const res = await fetch(`${s.base}/api/intake`, { method: 'POST', body: fd })
    assert.equal(res.status, 200)
    const body = await jsonOf<UploadBody & { kind?: string }>(res)
    assert.equal(body.kind, 'zaehler')
    const u = await listedUpload(s, fileOf(body))
    assert.equal(u.kind, 'meterPhoto')
    assert.equal(u.propertyId, null, 'ohne Objekt, damit es in keinem Posteingang als Beleg steht')
    // Ein gewöhnlicher Beleg bleibt ein Beleg
    const beleg = await uploadBelegFile(s, '%PDF-b', 'b.pdf')
    assert.equal((await listedUpload(s, beleg)).kind, 'receipt')
  }, { chat: 'meter' })
})

// ---------- Belegbuchung (#170): die Routen ----------

const RECHNUNGEN: Record<string, FakeInvoice> = {
  GRUNDSTEUER: { vendor: 'Stadt Musterstadt', invoiceDate: '2025-02-15', totalGrossEur: 612.4, positions: [{ description: 'Grundsteuer B 2025', category: 'Grundsteuer', amountEur: 612.4 }] },
  WASSER: {
    vendor: 'Stadtwerke Musterstadt', invoiceDate: '2026-02-01', totalGrossEur: 1500,
    positions: [{ description: 'Frischwasser', category: 'Wasser/Abwasser', amountEur: 700 }, { description: 'Abwasser', category: 'Wasser/Abwasser', amountEur: 800 }],
  },
  // Weder Rechnungsdatum noch Leistungszeitraum: Das Jahr der Auswertung kommt aus dem Formular.
  HAUSMEISTER: { vendor: 'Hausmeisterdienst Muster', totalGrossEur: 300, positions: [{ description: 'Hausmeisterdienst', category: 'Hauswart', amountEur: 300 }] },
  NACHTRAG: { vendor: 'Stadtwerke Musterstadt', invoiceDate: '2026-03-01', totalGrossEur: 120, positions: [{ description: 'Nachberechnung Abwasser', category: 'Wasser/Abwasser', amountEur: 120 }] },
  MUELL: {
    vendor: 'Abfallwirtschaft Musterkreis', invoiceDate: '2026-12-15', totalGrossEur: 650,
    positions: [{ description: 'Restmüll', category: 'Müllabfuhr', amountEur: 700 }, { description: 'Gutschrift Tonnentausch', category: 'Müllabfuhr', amountEur: -50 }],
  },
  GARTEN: { vendor: 'Gärtnerei Grün', invoiceDate: '2026-11-30', totalGrossEur: 1450, positions: [{ description: 'Gartenpflege Saison', category: 'Gartenpflege', amountEur: 1450, labor35aEur: null }] },
  // Rechnungsdatum im Februar, kein Leistungszeitraum: Das Jahr aus dem Beleg ist das Folgejahr der Leistung.
  VORJAHR: { vendor: 'Hausmeisterdienst Muster', invoiceDate: '2025-02-10', totalGrossEur: 300, positions: [{ description: 'Hausmeisterdienst', category: 'Hauswart', amountEur: 300 }] },
}

type Evaluated = { file: string, assessment: AssessmentView | null }
// Lang genug für eine Textebene (unter 80 Zeichen gälte das PDF als Scan ohne Text).
const invoiceText = (marker: string): string => `Rechnung ${marker}: Positionen wie aufgeführt, Betrag in Euro, zahlbar binnen 14 Tagen.`

// Wie der Browser: ein PDF mit Textebene an /api/extract, ohne Strom. `marker` wählt die Rechnung.
async function evaluate(s: Server, marker: string, extra: Record<string, string> = {}): Promise<Evaluated> {
  const fd = new FormData()
  // Mit `existingFile` wertet der Server einen Beleg aus dem Posteingang aus, statt einen neuen anzunehmen.
  // Der Inhalt hängt an der Rechnung: gleiche Bytes ergäben gleiche Prüfsummen, und ein zweiter Beleg gälte als doppelt.
  if (!extra.existingFile) fd.append('file', new Blob([PDF, `%${marker}\n`], { type: 'application/pdf' }), `${marker.toLowerCase()}.pdf`)
  fd.append('pdfText', invoiceText(marker))
  for (const [k, v] of Object.entries(extra)) fd.append(k, v)
  const res = await fetch(`${s.base}/api/extract`, { method: 'POST', body: fd })
  assert.equal(res.status, 200, await res.clone().text())
  return jsonOf<Evaluated>(res)
}
const postJson = (s: Server, urlPath: string, body: unknown): Promise<Response> =>
  fetch(`${s.base}${urlPath}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const assessmentOf = (e: Evaluated): AssessmentView => e.assessment ?? assert.fail('keine Auswertung gespeichert')
const grundsteuer = (a: AssessmentView): LineDecision[] =>
  [{ idx: 0, action: 'create', fields: a.lines[0]?.suggestion?.fields ?? assert.fail('kein Vorschlag') }]

test('Belegbuchung: Auswerten speichert die Auswertung mit Vorschlag; nach dem Neuladen ist sie offen abrufbar', async () => {
  await withOllama(async (s) => {
    const a = assessmentOf(await evaluate(s, 'WASSER', { year: '2024' }))
    assert.equal(a.year, 2026, 'das Jahr aus dem Beleg geht vor dem gewählten')
    assert.equal(a.propertyId, 'objekt-1', 'mit einem Objekt gilt dieses')
    // Aus einem anderen Jahr als dem gewählten: gelb und nicht vorab angehakt (Schlussdurchsicht, I1).
    assert.deepEqual(a.lines.map((l) => [l.description, l.amountCents, l.state, l.suggestion?.level, l.suggestion?.preselected]), [
      ['Frischwasser', 70000, 'open', 'gelb', false], ['Abwasser', 80000, 'open', 'gelb', false],
    ])
    const offen = await s.api<AssessmentView[]>('/api/assessments?open=1')
    assert.deepEqual(offen.map((x) => x.id), [a.id])
    assert.equal((await s.api<AssessmentView>(`/api/assessments/${a.id}`)).file, a.file)
  }, { invoices: RECHNUNGEN })
})

test('Belegbuchung: eine gescheiterte Auswertung speichert nichts', async () => {
  await withOllama(async (s) => {
    const fd = new FormData()
    fd.append('file', new Blob([PDF], { type: 'application/pdf' }), 'fehler.pdf')
    fd.append('pdfText', 'Rechnung WASSER')
    const res = await fetch(`${s.base}/api/extract`, { method: 'POST', body: fd })
    assert.equal(res.status, 502)
    assert.deepEqual(await s.api<AssessmentView[]>('/api/assessments'), [])
  }, { invoices: RECHNUNGEN, chat: 'error' })
})

test('Belegbuchung: Doppelklick und zwei Tabs zugleich ergeben eine Position', async () => {
  await withOllama(async (s) => {
    const a = assessmentOf(await evaluate(s, 'GRUNDSTEUER'))
    const decisions = grundsteuer(a)
    const preview = await jsonOf<BookingPreview>(await postJson(s, `/api/assessments/${a.id}/plan`, { decisions }))
    assert.deepEqual(preview.errors, [])
    const [x, y] = await Promise.all([
      postJson(s, `/api/assessments/${a.id}/book`, { decisions, token: preview.token }),
      postJson(s, `/api/assessments/${a.id}/book`, { decisions, token: preview.token }),
    ])
    assert.deepEqual([x.status, y.status], [200, 200])
    const changed = [(await jsonOf<{ changed: boolean }>(x)).changed, (await jsonOf<{ changed: boolean }>(y)).changed].sort()
    assert.deepEqual(changed, [false, true])
    const again = await postJson(s, `/api/assessments/${a.id}/book`, { decisions, token: preview.token })
    assert.equal((await jsonOf<{ changed: boolean }>(again)).changed, false, 'eine Wiederholung nach einem Netzfehler bucht nicht noch einmal')
    const items = await s.api<CostItem[]>('/api/costItems')
    assert.deepEqual(items.map((i) => [i.amountCents, i.invoiceFile]), [[61240, a.file]])
    assert.deepEqual(await s.api<AssessmentView[]>('/api/assessments?open=1'), [], 'gebucht ist nicht mehr offen')
  }, { invoices: RECHNUNGEN })
})

test('Belegbuchung: ohne Vorschau keine Buchung; anders gebucht ergibt 409 mit dem Stand; Unlesbares 400', async () => {
  await withOllama(async (s) => {
    const a = assessmentOf(await evaluate(s, 'GRUNDSTEUER'))
    const decisions = grundsteuer(a)
    assert.equal((await postJson(s, `/api/assessments/${a.id}/book`, { decisions })).status, 400)
    assert.equal((await postJson(s, `/api/assessments/${a.id}/plan`, { decisions: [{ idx: 0, action: 'zaubern' }] })).status, 400)
    const preview = await jsonOf<BookingPreview>(await postJson(s, `/api/assessments/${a.id}/plan`, { decisions }))
    assert.equal((await postJson(s, `/api/assessments/${a.id}/book`, { decisions, token: preview.token })).status, 200)
    const anders = await postJson(s, `/api/assessments/${a.id}/book`, { decisions: [{ idx: 0, action: 'dismiss' }], token: 'egal' })
    assert.equal(anders.status, 409)
    const body = await jsonOf<{ error: string, assessment: AssessmentView }>(anders)
    assert.match(body.error, /schon gebucht/)
    assert.equal(body.assessment.lines[0]?.state, 'created')
  }, { invoices: RECHNUNGEN })
})

test('Belegbuchung: gebucht wird im Objekt der Auswertung, nicht im gewählten; ihr Objekt ist danach fest', async () => {
  await withOllama(async (s) => {
    const zweites = await jsonOf<Property>(await postJson(s, '/api/properties', { name: 'Zweites Haus' }))
    const a = assessmentOf(await evaluate(s, 'GRUNDSTEUER', { propertyId: 'objekt-1' }))
    assert.equal(a.propertyId, 'objekt-1')
    const decisions = grundsteuer(a)
    const preview = await jsonOf<BookingPreview>(await postJson(s, `/api/assessments/${a.id}/plan?property=${zweites.id}`, { decisions }))
    assert.equal((await postJson(s, `/api/assessments/${a.id}/book?property=${zweites.id}`, { decisions, token: preview.token })).status, 200)
    assert.equal((await s.api<CostItem[]>('/api/costItems?property=objekt-1')).length, 1)
    assert.equal((await s.api<CostItem[]>(`/api/costItems?property=${zweites.id}`)).length, 0)
    const put = await fetch(`${s.base}/api/assessments/${a.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ propertyId: zweites.id }) })
    assert.equal(put.status, 409)
  }, { invoices: RECHNUNGEN })
})

test('Belegbuchung: ist die Datei weg, fehlt die Auswertung in der Liste, und Vorschau wie Buchung antworten 404', async () => {
  await withOllama(async (s) => {
    const a = assessmentOf(await evaluate(s, 'GRUNDSTEUER'))
    fs.rmSync(path.join(s.dataDir, 'uploads', a.file))
    assert.deepEqual(await s.api<AssessmentView[]>('/api/assessments?open=1'), [])
    const plan = await postJson(s, `/api/assessments/${a.id}/plan`, { decisions: grundsteuer(a) })
    assert.equal(plan.status, 404)
    assert.match((await jsonOf<{ error: string }>(plan)).error, /gibt es im Belegordner nicht mehr/)
    const book = await postJson(s, `/api/assessments/${a.id}/book`, { decisions: grundsteuer(a), token: 'egal' })
    assert.equal(book.status, 404)
    assert.match((await jsonOf<{ error: string }>(book)).error, /gibt es im Belegordner nicht mehr/)
    assert.equal((await fetch(`${s.base}/api/assessments/${a.id}`)).status, 404)
    assert.deepEqual(await s.api<CostItem[]>('/api/costItems'), [], 'gebucht wurde nichts')
  }, { invoices: RECHNUNGEN })
})

// Entscheidungen des Steuerers zu Task 4

test('Belegbuchung: eine veraltete Vorschau ergibt 409 mit der neuen Vorschau, gebucht wird nichts', async () => {
  await withOllama(async (s) => {
    const a = assessmentOf(await evaluate(s, 'GRUNDSTEUER'))
    const decisions = grundsteuer(a)
    const fresh = await jsonOf<BookingPreview>(await postJson(s, `/api/assessments/${a.id}/plan`, { decisions }))
    const res = await postJson(s, `/api/assessments/${a.id}/book`, { decisions, token: 'eine-alte-marke' })
    assert.equal(res.status, 409)
    const body = await jsonOf<{ error: string, preview?: BookingPreview }>(res)
    assert.match(body.error, /neue Vorschau/)
    const preview = body.preview ?? assert.fail('die neue Vorschau fehlt in der Antwort')
    assert.equal(preview.token, fresh.token, 'mit der mitgeschickten Marke lässt sich ohne zweite Anfrage buchen')
    assert.deepEqual(await s.api<CostItem[]>('/api/costItems'), [])
    assert.equal((await postJson(s, `/api/assessments/${a.id}/book`, { decisions, token: preview.token })).status, 200)
  }, { invoices: RECHNUNGEN })
})

test('Belegbuchung: nach einer Buchung lassen sich weder Objekt noch Jahr der Auswertung ändern, und die Meldung sagt beides', async () => {
  await withOllama(async (s) => {
    const a = assessmentOf(await evaluate(s, 'GRUNDSTEUER'))
    const decisions = grundsteuer(a)
    const preview = await jsonOf<BookingPreview>(await postJson(s, `/api/assessments/${a.id}/plan`, { decisions }))
    assert.equal((await postJson(s, `/api/assessments/${a.id}/book`, { decisions, token: preview.token })).status, 200)
    const put = await fetch(`${s.base}/api/assessments/${a.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ year: a.year + 1 }) })
    assert.equal(put.status, 409)
    const { error } = await jsonOf<{ error: string }>(put)
    assert.match(error, /Objekt/)
    assert.match(error, /Jahr/)
    assert.match(error, /Lösen Sie/, 'sagt, was zu tun ist')
    assert.equal((await s.api<AssessmentView>(`/api/assessments/${a.id}`)).year, a.year)
  }, { invoices: RECHNUNGEN })
})

test('Belegbuchung: ohne Buchung ändert PUT Jahr und Objekt der Auswertung', async () => {
  await withOllama(async (s) => {
    const a = assessmentOf(await evaluate(s, 'GRUNDSTEUER'))
    const put = await fetch(`${s.base}/api/assessments/${a.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ year: 2024 }) })
    assert.equal(put.status, 200)
    assert.equal((await jsonOf<AssessmentView>(put)).year, 2024)
    const falsch = await fetch(`${s.base}/api/assessments/${a.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ year: 'zwanzig' }) })
    assert.equal(falsch.status, 400)
    const fehlt = await fetch(`${s.base}/api/assessments/gibt-es-nicht`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ year: 2024 }) })
    assert.equal(fehlt.status, 404)
  }, { invoices: RECHNUNGEN })
})

test('Belegbuchung: das Jahr der Auswertung wird zum Jahr des Belegs im Posteingang, solange nichts gebucht ist', async () => {
  await withOllama(async (s) => {
    const a = assessmentOf(await evaluate(s, 'WASSER', { year: '2024' }))
    assert.equal(a.year, 2026)
    const beleg = (await s.api<UploadInfo[]>('/api/uploads')).find((u) => u.file === a.file) ?? assert.fail('der Beleg fehlt im Ordner')
    assert.equal(beleg.year, 2026, 'der Posteingang zeigt den Beleg im Jahr, das er selbst nennt')
  }, { invoices: RECHNUNGEN })
})

test('Belegbuchung: eine Rechnung vom Februar ohne Leistungszeitraum, ausgewertet aus dem Vorjahr, ist gelb und nicht vorab angehakt', async () => {
  await withOllama(async (s) => {
    const a = assessmentOf(await evaluate(s, 'VORJAHR', { year: '2024' }))
    assert.deepEqual([a.detectedYear, a.year, a.requestedPeriod], [2025, 2025, '2024-01'], 'gebucht wird im Jahr des Belegs, das gewählte ist gespeichert')
    const s0 = a.lines[0]?.suggestion ?? assert.fail('kein Vorschlag')
    assert.deepEqual([s0.level, s0.preselected], ['gelb', false])
    assert.ok(s0.reasons.some((r) => /2025/.test(r) && /2024/.test(r)), s0.reasons.join('\n'))
    // Nach dem Neuladen derselbe Befund: Er hängt am gespeicherten Jahr, nicht am Tab.
    const again = await s.api<AssessmentView>(`/api/assessments/${a.id}`)
    assert.deepEqual([again.lines[0]?.suggestion?.level, again.lines[0]?.suggestion?.preselected], ['gelb', false])
    // Wer das Jahr ausdrücklich wählt, hat entschieden: Danach weicht nichts mehr ab.
    const put = await putJson(s, `/api/assessments/${a.id}`, { year: 2025 })
    assert.equal(put.status, 200)
    const chosen = await jsonOf<AssessmentView>(put)
    assert.deepEqual([chosen.requestedPeriod, chosen.lines[0]?.suggestion?.level, chosen.lines[0]?.suggestion?.preselected], ['2025-01', 'gruen', true])
  }, { invoices: RECHNUNGEN })
})

test('Belegbuchung: PUT auf die Auswertung eines gelöschten Belegs antwortet 404 und schreibt nichts', async () => {
  await withOllama(async (s) => {
    const a = assessmentOf(await evaluate(s, 'GRUNDSTEUER', { year: '2025' }))
    fs.rmSync(path.join(s.dataDir, 'uploads', a.file))
    const res = await putJson(s, `/api/assessments/${a.id}`, { year: 2023 })
    assert.equal(res.status, 404)
    assert.match((await jsonOf<{ error: string }>(res)).error, /gibt es im Belegordner nicht mehr/)
    const stored = await inDatabase(s, async (db) => db.select({ id: assessmentsTable.id, year: assessmentsTable.year }).from(assessmentsTable))
    assert.deepEqual(stored.filter((r) => r.id === a.id).map((r) => r.year), [2025], 'das Jahr der Auswertung ist unverändert')
    const row = await inDatabase(s, async (db) => db.select({ file: uploadsTable.file, year: uploadsTable.year }).from(uploadsTable))
    assert.deepEqual(row.filter((r) => r.file === a.file).map((r) => r.year), [2025], 'die Zeile des Belegs ist nicht verschoben')
  }, { invoices: RECHNUNGEN })
})

// ---------- Belegbuchung (#170): Befunde der Durchsicht zu Task 4 ----------

const putJson = (s: Server, urlPath: string, body: unknown): Promise<Response> =>
  fetch(`${s.base}${urlPath}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const uploadOf = async (s: Server, file: string): Promise<UploadInfo> =>
  (await s.api<UploadInfo[]>('/api/uploads')).find((u) => u.file === file) ?? assert.fail(`der Beleg ${file} fehlt im Ordner`)
const storedAssessmentFiles = (s: Server): Promise<string[]> =>
  inDatabase(s, async (db) => (await db.select({ file: assessmentsTable.file }).from(assessmentsTable)).map((r) => r.file))
async function plainUpload(s: Server, name: string): Promise<string> {
  const fd = new FormData()
  fd.append('file', new Blob([PDF], { type: 'application/pdf' }), name)
  const res = await fetch(`${s.base}/api/upload`, { method: 'POST', body: fd })
  assert.equal(res.status, 200, await res.clone().text())
  return (await jsonOf<{ file: string }>(res)).file
}
async function bookGrundsteuer(s: Server, a: AssessmentView): Promise<void> {
  const decisions = grundsteuer(a)
  const preview = await jsonOf<BookingPreview>(await postJson(s, `/api/assessments/${a.id}/plan`, { decisions }))
  assert.equal((await postJson(s, `/api/assessments/${a.id}/book`, { decisions, token: preview.token })).status, 200)
}

// Ein Abbruch, der nach der Antwort der KI und vor dem Speichern ankommt. Herbeigeführt mit dem
// Testgriff NKA_TEST_ASSESSMENT_DELAY_MS: Der Server wartet vor dem Speichern, und in diese Pause
// fällt der Abbruch über die Kennung. Gewartet wird, bis der Durchgang der Kostenarten (die letzte
// Anfrage an die KI) beantwortet ist.
const PAUSE_MS = 2500
async function evaluateAndCancel(s: Server, ollama: Ollama, marker: string, extra: Record<string, string>): Promise<void> {
  const requestId = 'abcdef0123456789abcdef0123456789'
  const fd = new FormData()
  if (!extra.existingFile) fd.append('file', new Blob([PDF], { type: 'application/pdf' }), `${marker.toLowerCase()}.pdf`)
  fd.append('pdfText', invoiceText(marker))
  fd.append('requestId', requestId)
  for (const [k, v] of Object.entries(extra)) fd.append(k, v)
  const before = ollama.requests.length
  const pending = fetch(`${s.base}/api/extract`, { method: 'POST', body: fd }).then((r) => r.text()).catch(() => '')
  const deadline = Date.now() + 10_000
  while (!ollama.requests.slice(before).some((r) => r.body.format?.properties?.categories)) {
    if (Date.now() > deadline) assert.fail('der Durchgang der Kostenarten kam nicht an')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  await new Promise((resolve) => setTimeout(resolve, 300))
  assert.equal((await fetch(`${s.base}/api/ai/cancel/${requestId}`, { method: 'POST' })).status, 200, 'der Abbruch kam nicht mehr an')
  await pending
  // Die Pause des Servers abwarten: Erst danach würde er speichern.
  await new Promise((resolve) => setTimeout(resolve, PAUSE_MS + 500))
}

test('Belegbuchung: ein Abbruch nach der Antwort der KI speichert keine Auswertung', async () => {
  await withOllama(async (s, ollama) => {
    await evaluateAndCancel(s, ollama, 'GRUNDSTEUER', {})
    assert.deepEqual(await storedAssessmentFiles(s), [], 'nach dem Abbruch steht eine Auswertung in der Datenbank')
  }, { invoices: RECHNUNGEN, env: { NKA_TEST_ASSESSMENT_DELAY_MS: String(PAUSE_MS) } })
})

test('Belegbuchung: ein Abbruch beim erneuten Auswerten eines Belegs aus dem Posteingang lässt die offenen Zeilen stehen', async () => {
  await withOllama(async (s, ollama) => {
    const a = assessmentOf(await evaluate(s, 'GRUNDSTEUER'))
    await evaluateAndCancel(s, ollama, 'WASSER', { existingFile: a.file })
    const after = await s.api<AssessmentView>(`/api/assessments/${a.id}`)
    assert.deepEqual(after.lines.map((l) => [l.idx, l.description, l.amountCents]), [[0, 'Grundsteuer B 2025', 61240]])
    assert.ok(fs.existsSync(path.join(s.dataDir, 'uploads', a.file)), 'der Beleg aus dem Posteingang ist weg')
  }, { invoices: RECHNUNGEN, env: { NKA_TEST_ASSESSMENT_DELAY_MS: String(PAUSE_MS) } })
})

test('Belegbuchung: PUT auf die Auswertung zieht Jahr und Objekt des Belegs mit, solange nichts gebucht ist', async () => {
  await withOllama(async (s) => {
    const zweites = await jsonOf<Property>(await postJson(s, '/api/properties', { name: 'Zweites Haus' }))
    const a = assessmentOf(await evaluate(s, 'GRUNDSTEUER', { propertyId: 'objekt-1' }))
    assert.equal((await putJson(s, `/api/assessments/${a.id}`, { year: 2024, propertyId: zweites.id })).status, 200)
    const beleg = await uploadOf(s, a.file)
    assert.deepEqual([beleg.year, beleg.propertyId], [2024, zweites.id])
  }, { invoices: RECHNUNGEN })
})

test('Belegbuchung: Verschieben im Posteingang zieht die Auswertung mit, solange nichts gebucht ist; gebucht bleibt sie', async () => {
  await withOllama(async (s) => {
    const zweites = await jsonOf<Property>(await postJson(s, '/api/properties', { name: 'Zweites Haus' }))
    const a = assessmentOf(await evaluate(s, 'GRUNDSTEUER', { propertyId: 'objekt-1' }))
    assert.equal((await putJson(s, `/api/uploads/${a.file}`, { year: 2023, propertyId: zweites.id })).status, 200)
    const moved = await s.api<AssessmentView>(`/api/assessments/${a.id}`)
    assert.deepEqual([moved.year, moved.propertyId], [2023, zweites.id])

    const b = assessmentOf(await evaluate(s, 'WASSER', { propertyId: 'objekt-1' }))
    const decisions: LineDecision[] = b.lines.map((l) => ({ idx: l.idx, action: 'create', fields: l.suggestion?.fields ?? assert.fail('kein Vorschlag') }))
    const preview = await jsonOf<BookingPreview>(await postJson(s, `/api/assessments/${b.id}/plan`, { decisions }))
    assert.equal((await postJson(s, `/api/assessments/${b.id}/book`, { decisions, token: preview.token })).status, 200)
    assert.equal((await putJson(s, `/api/uploads/${b.file}`, { year: 2023, propertyId: zweites.id })).status, 200)
    const kept = await s.api<AssessmentView>(`/api/assessments/${b.id}`)
    assert.deepEqual([kept.year, kept.propertyId], [b.year, 'objekt-1'])
  }, { invoices: RECHNUNGEN })
})

test('Belegbuchung: beim Speichern bekommt ein Beleg ohne Objekt das Objekt der Auswertung', async () => {
  await withOllama(async (s) => {
    const file = await plainUpload(s, 'ohne-objekt.pdf')
    assert.equal((await uploadOf(s, file)).propertyId, null)
    const a = assessmentOf(await evaluate(s, 'GRUNDSTEUER', { existingFile: file }))
    assert.equal(a.propertyId, 'objekt-1')
    const beleg = await uploadOf(s, file)
    assert.deepEqual([beleg.year, beleg.propertyId], [2025, 'objekt-1'])
  }, { invoices: RECHNUNGEN })
})

// Abnahme B3: „Per KI auswerten“ aus dem Posteingang schickte das Jahr der Seitenleiste mit, und das
// überschrieb das Jahr, das am Beleg eingestellt war. Das Jahr des Belegs ist das gewählte.
test('Belegbuchung: aus dem Posteingang gilt das Jahr am Beleg als gewähltes, nicht das der Seitenleiste', async () => {
  await withOllama(async (s) => {
    const file = await plainUpload(s, 'hausmeister.pdf')
    assert.equal((await putJson(s, `/api/uploads/${file}`, { year: 2023, propertyId: 'objekt-1' })).status, 200)
    const a = assessmentOf(await evaluate(s, 'HAUSMEISTER', { existingFile: file, year: '2026' }))
    assert.deepEqual([a.detectedYear, a.year, a.requestedPeriod], [null, 2023, '2023-01'])
    // Nennt der Beleg selbst ein Jahr, geht es weiter vor; verglichen wird mit dem Jahr am Beleg.
    const other = await plainUpload(s, 'vorjahr.pdf')
    assert.equal((await putJson(s, `/api/uploads/${other}`, { year: 2025, propertyId: 'objekt-1' })).status, 200)
    const b = assessmentOf(await evaluate(s, 'VORJAHR', { existingFile: other, year: '2026' }))
    assert.deepEqual([b.detectedYear, b.year, b.requestedPeriod], [2025, 2025, '2025-01'])
    assert.ok(!b.lines.some((l) => l.suggestion?.reasons.some((r) => /gewählt war/.test(r))), 'kein Hinweis auf ein anderes Jahr')
  }, { invoices: RECHNUNGEN })
})

// L1 der Durchsicht von #201: Nach der ersten Auswertung legt der Server den Beleg auf das Jahr aus
// dem Beleg. Ein zweites „Per KI auswerten“ nahm dieses Jahr als gewähltes, die gelbe Zeile wurde
// grün, und „Alle grünen übernehmen“ buchte ungesehen in das andere Jahr. Hat der Beleg schon eine
// Auswertung, gilt deren gewähltes Jahr; ändert der Nutzer das Jahr am Beleg, zieht es mit.
test('Belegbuchung: erneut ausgewertet bleibt das gewählte Jahr der früheren Auswertung', async () => {
  await withOllama(async (s) => {
    const a = assessmentOf(await evaluate(s, 'WASSER', { year: '2024' }))
    assert.deepEqual([a.year, a.requestedPeriod], [2026, '2024-01'])
    assert.equal((await uploadOf(s, a.file)).year, 2026, 'der Beleg liegt im Jahr aus dem Beleg')
    const again = assessmentOf(await evaluate(s, 'WASSER', { existingFile: a.file, year: '2025' }))
    assert.deepEqual([again.year, again.requestedPeriod], [2026, '2024-01'])
    assert.ok(again.lines.every((l) => l.suggestion?.level !== 'gruen' && l.suggestion?.preselected !== true), 'nicht grün, nicht angehakt')
    assert.ok(again.lines.some((l) => l.suggestion?.reasons.some((r) => /gewählt war 2024/.test(r))))
    // Stellt der Nutzer das Jahr am Beleg um (Belegordner, Posteingang), gilt danach dieses.
    assert.equal((await putJson(s, `/api/uploads/${a.file}`, { year: 2026 })).status, 200)
    const moved = assessmentOf(await evaluate(s, 'WASSER', { existingFile: a.file, year: '2025' }))
    assert.deepEqual([moved.year, moved.requestedPeriod], [2026, '2026-01'])
    assert.ok(!moved.lines.some((l) => l.suggestion?.reasons.some((r) => /gewählt war/.test(r))))
  }, { invoices: RECHNUNGEN })
})

test('Belegbuchung: nennt der Beleg kein Jahr, gilt das mitgeschickte', async () => {
  await withOllama(async (s) => {
    const a = assessmentOf(await evaluate(s, 'HAUSMEISTER', { year: '2023' }))
    assert.deepEqual([a.detectedYear, a.year], [null, 2023])
  }, { invoices: RECHNUNGEN })
})

test('Belegbuchung: die Antwort als Strom trägt die Auswertung', async () => {
  await withOllama(async (s) => {
    const fd = new FormData()
    fd.append('file', new Blob([PDF], { type: 'application/pdf' }), 'grundsteuer.pdf')
    fd.append('pdfText', invoiceText('GRUNDSTEUER'))
    const res = await fetch(`${s.base}/api/extract`, { method: 'POST', body: fd, headers: { accept: 'application/x-ndjson' } })
    assert.equal(res.status, 200)
    const lines: { type: string, data?: Evaluated }[] = (await res.text()).split('\n').filter((l) => l !== '').map((l) => JSON.parse(l))
    const result = lines.find((l) => l.type === 'result')?.data ?? assert.fail('keine Zeile result im Strom')
    const a = assessmentOf(result)
    assert.deepEqual(a.lines.map((l) => l.description), ['Grundsteuer B 2025'])
  }, { invoices: RECHNUNGEN })
})

test('Belegbuchung: lässt sich die Prüfsumme nicht rechnen, wird die Auswertung trotzdem gespeichert', async (t) => {
  await withOllama(async (s) => {
    const file = await plainUpload(s, 'unlesbar.pdf')
    const full = path.join(s.dataDir, 'uploads', file)
    fs.chmodSync(full, 0o000)
    try {
      let readable = true
      try { fs.accessSync(full, fs.constants.R_OK) } catch { readable = false }
      // Als root (oder unter Windows) lässt sich die Datei trotz fehlender Rechte lesen; dann gibt
      // es den Fehlerfall nicht, den dieser Test herbeiführen will.
      if (readable) return t.skip('die Datei bleibt lesbar, ein Lesefehler lässt sich hier nicht herbeiführen')
      const a = assessmentOf(await evaluate(s, 'GRUNDSTEUER', { existingFile: file }))
      assert.equal(a.file, file)
    } finally {
      fs.chmodSync(full, 0o644)
    }
  }, { invoices: RECHNUNGEN })
})

test('Belegbuchung: der Belegordner kennt gebuchte Zeilen; Löschen der Position öffnet beide Belege wieder', async () => {
  await withOllama(async (s) => {
    const st = await jsonOf<CostItem>(await postJson(s, '/api/costItems', { year: 2026, category: 'Wasser/Abwasser', description: 'Wasser 2026', amountCents: 150000, key: 'area' }))
    const a = assessmentOf(await evaluate(s, 'WASSER'))
    const b = assessmentOf(await evaluate(s, 'NACHTRAG'))
    const book = async (x: AssessmentView, decisions: LineDecision[]) => {
      const preview = await jsonOf<BookingPreview>(await postJson(s, `/api/assessments/${x.id}/plan`, { decisions }))
      const res = await postJson(s, `/api/assessments/${x.id}/book`, { decisions, token: preview.token })
      assert.equal(res.status, 200, await res.clone().text())
    }
    await book(a, [{ idx: 0, action: 'link', costItemId: st.id }, { idx: 1, action: 'link', costItemId: st.id }])
    await book(b, [{ idx: 0, action: 'link', costItemId: st.id }])
    const entry = async (file: string): Promise<UploadEntry> =>
      (await s.api<UploadEntry[]>('/api/uploads')).find((u) => u.file === file) ?? assert.fail(`kein Beleg ${file}`)
    assert.deepEqual([(await entry(b.file)).bookedItemIds, (await entry(b.file)).assessment?.open], [[st.id], false])
    assert.deepEqual([(await entry(a.file)).bookedCents, (await entry(b.file)).bookedCents], [{ [st.id]: 150000 }, { [st.id]: 12000 }], 'je Beleg die Summe seiner gebuchten Zeilen')
    const [position] = await s.api<CostItem[]>('/api/costItems')
    assert.deepEqual([position?.amountCents, position?.invoiceFile], [162000, a.file], 'Summe beider Belege, die Position trägt den ersten')
    const del = (file: string) => fetch(`${s.base}/api/uploads/${encodeURIComponent(file)}`, { method: 'DELETE' })
    assert.equal((await del(b.file)).status, 409, 'ein Beleg mit gebuchter Zeile lässt sich nicht löschen')
    assert.equal((await fetch(`${s.base}/api/costItems/${st.id}`, { method: 'DELETE' })).status, 200)
    for (const f of [a.file, b.file]) {
      const e = await entry(f)
      assert.deepEqual([e.bookedItemIds, e.assessment?.open], [[], true], `${f} ist wieder offen`)
    }
    assert.equal((await del(b.file)).status, 200)
    assert.equal((await fetch(`${s.base}/api/assessments/${b.id}`)).status, 404, 'die Auswertung geht mit dem Beleg')
  }, { invoices: RECHNUNGEN })
})

test('Belegbuchung: Backup und Wiederherstellen nehmen Auswertungen und gebuchte Zeilen mit', async () => {
  await withOllama(async (s) => {
    const g = assessmentOf(await evaluate(s, 'GRUNDSTEUER'))
    const w = assessmentOf(await evaluate(s, 'WASSER'))
    const decisions = grundsteuer(g)
    const preview = await jsonOf<BookingPreview>(await postJson(s, `/api/assessments/${g.id}/plan`, { decisions }))
    assert.equal((await postJson(s, `/api/assessments/${g.id}/book`, { decisions, token: preview.token })).status, 200)
    // Der Stand im Archiv: die offene Auswertung samt Zeilen, Beträgen und Vorschlägen, die gebuchte Zeile und ihre Position.
    const openBefore = await s.api<AssessmentView[]>('/api/assessments?open=1')
    const bookedBefore = await s.api<AssessmentView>(`/api/assessments/${g.id}`)
    const [position] = await s.api<CostItem[]>('/api/costItems')
    if (!position) return assert.fail('die gebuchte Position fehlt')
    assert.equal(bookedBefore.lines[0]?.costItemId, position.id)
    const backup = Buffer.from(await (await fetch(`${s.base}/api/backup`)).arrayBuffer())
    // Danach ändern, damit das Zurückspielen sichtbar wird: Die Position fällt weg, die Zeile wird offen.
    assert.equal((await fetch(`${s.base}/api/costItems/${position.id}`, { method: 'DELETE' })).status, 200)
    assert.equal((await s.api<AssessmentView[]>('/api/assessments?open=1')).length, 2)
    assert.equal((await restore(s, backup)).status, 200)
    const openAfter = await s.api<AssessmentView[]>('/api/assessments?open=1')
    assert.deepEqual(openAfter.map((a) => a.id), [w.id])
    assert.deepEqual(openAfter, openBefore, 'die offene Auswertung steht mit Zeilen, Beträgen und Vorschlägen da wie im Archiv')
    const bookedAfter = await s.api<AssessmentView>(`/api/assessments/${g.id}`)
    assert.deepEqual(bookedAfter, bookedBefore, 'die gebuchte Auswertung steht da wie im Archiv')
    const restored = await s.api<CostItem[]>('/api/costItems')
    assert.deepEqual(restored, [position], 'die Position ist wieder da, genau einmal und unverändert')
    assert.deepEqual([bookedAfter.lines[0]?.state, bookedAfter.lines[0]?.costItemId, bookedAfter.lines[0]?.itemDescription], ['created', position.id, position.description],
      'die gebuchte Zeile zeigt auf die wiederhergestellte Position')
  }, { invoices: RECHNUNGEN })
})

// Ein Beleg aus dem Posteingang noch einmal auswerten, wie „Per KI auswerten“ es tut.
async function evaluateAgain(s: Server, file: string, marker: string): Promise<Evaluated> {
  const fd = new FormData()
  fd.append('existingFile', file)
  // Wie beim ersten Auswerten: Unter 80 Zeichen gälte die Textebene als fehlend.
  fd.append('pdfText', invoiceText(marker))
  const res = await fetch(`${s.base}/api/extract`, { method: 'POST', body: fd })
  assert.equal(res.status, 200, await res.clone().text())
  return jsonOf<Evaluated>(res)
}

test('Belegbuchung: die vier Abnahmefälle der Spezifikation über die Routen', async () => {
  await withOllama(async (s) => {
    const book = async (a: AssessmentView, decisions: LineDecision[]): Promise<{ changed: boolean }> => {
      const preview = await jsonOf<BookingPreview>(await postJson(s, `/api/assessments/${a.id}/plan`, { decisions }))
      assert.deepEqual(preview.errors, [])
      const res = await postJson(s, `/api/assessments/${a.id}/book`, { decisions, token: preview.token })
      assert.equal(res.status, 200, await res.clone().text())
      return jsonOf<{ changed: boolean }>(res)
    }
    const fieldsAt = (a: AssessmentView, idx: number) => a.lines.find((l) => l.idx === idx)?.suggestion?.fields ?? assert.fail(`kein Vorschlag zu Zeile ${idx}`)
    const newItem = async (body: Record<string, unknown>) => jsonOf<CostItem>(await postJson(s, '/api/costItems', body))

    // A: Wasser 700 € + 800 € gegen eine Schätzung von 1.500 €
    const wa = await newItem({ year: 2026, category: 'Wasser/Abwasser', description: 'Wasser 2026', amountCents: 150000, key: 'area' })
    const wasser = assessmentOf(await evaluate(s, 'WASSER'))
    const wasserDecisions: LineDecision[] = [{ idx: 0, action: 'link', costItemId: wa.id }, { idx: 1, action: 'link', costItemId: wa.id }]
    await book(wasser, wasserDecisions)

    // B: Restmüll 700 € mit Gutschrift −50 €
    const muell = assessmentOf(await evaluate(s, 'MUELL'))
    await book(muell, [{ idx: 0, action: 'create', fields: fieldsAt(muell, 0) }, { idx: 1, action: 'create', fields: fieldsAt(muell, 1) }])

    // C: Schätzung mit §35a 1.000 €, Rechnung ohne Lohnanteil
    const gp = await newItem({ year: 2026, category: 'Gartenpflege', description: 'Gartenpflege 2026', amountCents: 150000, labor35aCents: 100000, key: 'area' })
    const garten = assessmentOf(await evaluate(s, 'GARTEN'))
    const gartenDecisions: LineDecision[] = [{ idx: 0, action: 'link', costItemId: gp.id }]
    const c = await jsonOf<BookingPreview>(await postJson(s, `/api/assessments/${garten.id}/plan`, { decisions: gartenDecisions }))
    assert.ok(c.notices.some((n) => /Lohnanteil von 1\.000,00\s€ wird entfernt/.test(n)), c.notices.join('\n'))
    await book(garten, gartenDecisions)

    // D: derselbe Beleg zweimal: wiederholte Buchung ohne Änderung, erneutes Auswerten ohne neue offene Zeile
    assert.equal((await book(wasser, wasserDecisions)).changed, false)
    const again = assessmentOf(await evaluateAgain(s, wasser.file, 'WASSER'))
    assert.deepEqual([again.id, again.open, again.lines.map((l) => l.state)], [wasser.id, false, ['linked', 'linked']])

    const items = await s.api<CostItem[]>('/api/costItems')
    const byDescription = (d: string) => items.filter((i) => i.description === d).map((i) => [i.amountCents, i.labor35aCents ?? null])
    assert.deepEqual(byDescription('Wasser 2026'), [[150000, null]], 'A: eine Position über 1.500 €')
    assert.deepEqual([...byDescription('Restmüll'), ...byDescription('Gutschrift Tonnentausch')], [[70000, null], [-5000, null]], 'B: zwei Positionen')
    assert.deepEqual(byDescription('Gartenpflege 2026'), [[145000, null]], 'C: Lohnanteil entfernt')
    assert.equal(items.length, 4, 'D: nichts doppelt')
  }, { invoices: RECHNUNGEN })
})

// ---------- Integrationsdurchsicht des Stapels #174 → #175 → #184 ----------

const NOCHMAL: Record<string, FakeInvoice> = {
  ZWEIZEILEN: RECHNUNGEN.WASSER ?? assert.fail('Rechnung WASSER fehlt'),
  EINEZEILE: { vendor: 'Stadtwerke Musterstadt', invoiceDate: '2026-02-01', totalGrossEur: 1500, positions: [{ description: 'Wasser und Abwasser', category: 'Wasser/Abwasser', amountEur: 1500 }] },
  GARTENARBEITEN: { vendor: 'Hausmeisterdienst Muster', invoiceDate: '2026-06-30', totalGrossEur: 400, positions: [{ description: 'Gartenarbeiten', category: 'Gartenpflege', amountEur: 400 }] },
}

// Plan und Buchung wie die Oberfläche: erst die Vorschau, dann mit ihrer Marke buchen.
async function planAndBook(s: Server, a: AssessmentView, decisions: LineDecision[]): Promise<{ preview: BookingPreview, status: number }> {
  const preview = await jsonOf<BookingPreview>(await postJson(s, `/api/assessments/${a.id}/plan`, { decisions }))
  const res = await postJson(s, `/api/assessments/${a.id}/book`, { decisions, token: preview.token })
  return { preview, status: res.status }
}
const fieldsOfLine = (l: AssessmentLine | undefined): LineFields => l?.suggestion?.fields ?? assert.fail('kein Vorschlag')
// „Alle grünen übernehmen“ der Oberfläche (client/src/assessment.ts, isGreen).
const greenLines = (a: AssessmentView): AssessmentLine[] =>
  a.lines.filter((l) => l.state === 'open' && !!l.suggestion?.preselected && l.suggestion.level === 'gruen')
const totalOf = async (s: Server): Promise<number> => (await s.api<CostItem[]>('/api/costItems')).reduce((x, i) => x + i.amountCents, 0)

test('H1: ein gebuchter Beleg, erneut ausgewertet, bucht eine berichtigte Zeile nicht still ein zweites Mal', async () => {
  await withOllama(async (s) => {
    const a = assessmentOf(await evaluate(s, 'ZWEIZEILEN'))
    const [frisch, ab] = a.lines
    // Frischwasser von Hand auf 750 € berichtigt, Abwasser wie gelesen.
    const decisions: LineDecision[] = [
      { idx: 0, action: 'create', fields: { ...fieldsOfLine(frisch), amountCents: 75000 } },
      { idx: 1, action: 'create', fields: fieldsOfLine(ab) },
    ]
    assert.equal((await planAndBook(s, a, decisions)).status, 200)
    assert.equal(await totalOf(s), 155000)

    const again = assessmentOf(await evaluateAgain(s, a.file, 'ZWEIZEILEN'))
    const fresh = again.lines.filter((l) => l.state === 'open')
    assert.equal(fresh.length, 1, 'die berichtigte Zeile kommt mit dem gelesenen Betrag wieder')
    const line = fresh[0] ?? assert.fail('keine offene Zeile')
    assert.equal(line.amountCents, 70000)
    assert.equal(line.suggestion?.level, 'rot')
    assert.equal(line.suggestion?.preselected, false)
    assert.ok(line.suggestion?.reasons.some((r) => /Dieser Beleg ist schon gebucht/.test(r) && /Frischwasser/.test(r) && /verwerfen Sie sie/.test(r)), line.suggestion?.reasons.join(' | '))
    assert.deepEqual(greenLines(again), [], '„Alle grünen übernehmen“ bucht sie nicht')

    // Direkt angelegt, ohne Bestätigung: Rückfrage, gebucht wird nichts.
    const direct: LineDecision[] = [{ idx: line.idx, action: 'create', fields: fieldsOfLine(line) }]
    const { preview, status } = await planAndBook(s, again, direct)
    assert.equal(status, 400)
    assert.ok(preview.confirm.some((c) => c.idx === line.idx && /schon gebucht/.test(c.message)), JSON.stringify(preview.confirm))
    assert.equal(await totalOf(s), 155000, 'keine stille zweite Buchung')
    // Mit ausdrücklicher Bestätigung legt sie an: Es kann eine weitere Zeile derselben Rechnung sein.
    assert.equal((await planAndBook(s, again, [{ ...direct[0] as LineDecision & { action: 'create' }, despiteCandidates: true }])).status, 200)
    assert.equal(await totalOf(s), 225000)
  }, { invoices: NOCHMAL })
})

test('H1: erst eine Zeile über 1.500 € gebucht, erneut ausgewertet zwei Zeilen: beide rot, keine vorab angehakt', async () => {
  await withOllama(async (s) => {
    const a = assessmentOf(await evaluate(s, 'EINEZEILE'))
    assert.equal((await planAndBook(s, a, [{ idx: 0, action: 'create', fields: fieldsOfLine(a.lines[0]) }])).status, 200)
    const again = assessmentOf(await evaluateAgain(s, a.file, 'ZWEIZEILEN'))
    const fresh = again.lines.filter((l) => l.state === 'open')
    assert.deepEqual(fresh.map((l) => [l.amountCents, l.suggestion?.level, l.suggestion?.preselected]), [[70000, 'rot', false], [80000, 'rot', false]])
    for (const l of fresh) assert.ok(l.suggestion?.candidates.some((c) => c.description === 'Wasser und Abwasser'), 'die gebuchte Position steht als Kandidat da')
    assert.deepEqual(greenLines(again), [])
    const decisions: LineDecision[] = fresh.map((l) => ({ idx: l.idx, action: 'create', fields: fieldsOfLine(l) }))
    const { preview, status } = await planAndBook(s, again, decisions)
    assert.equal(status, 400)
    assert.equal(preview.confirm.length, 2)
    assert.equal(await totalOf(s), 150000)
  }, { invoices: NOCHMAL })
})

test('H1: im gewöhnlichen Ablauf (eine Zeile gebucht, die zweite derselben Auswertung offen) bleibt die zweite grün', async () => {
  await withOllama(async (s) => {
    const a = assessmentOf(await evaluate(s, 'ZWEIZEILEN'))
    assert.equal((await planAndBook(s, a, [{ idx: 0, action: 'create', fields: fieldsOfLine(a.lines[0]) }])).status, 200)
    const after = await s.api<AssessmentView>(`/api/assessments/${a.id}`)
    const open = after.lines.find((l) => l.idx === 1) ?? assert.fail('Zeile 1 fehlt')
    assert.equal(open.suggestion?.reasons.some((r) => /schon gebucht/.test(r)), false)
    assert.notEqual(open.suggestion?.level, 'rot')
  }, { invoices: NOCHMAL })
})

test('H2: ein Beleg gleichen Inhalts wie ein von Hand angehängter wird nicht still gebucht, auch mit anderer Kostenart', async () => {
  await withOllama(async (s) => {
    // Dieselben Bytes, wie evaluate sie hochlädt: gleiche Prüfsumme.
    const alt = await uploadBelegFile(s, Buffer.concat([PDF, Buffer.from('%GARTENARBEITEN\n')]), 'alt.pdf')
    const hm = await jsonOf<CostItem>(await postJson(s, '/api/costItems', { year: 2026, category: 'Hauswart', description: 'Hausmeisterdienst', amountCents: 40000, key: 'area', invoiceFile: alt }))
    assert.equal(hm.invoiceFile, alt)
    const a = assessmentOf(await evaluate(s, 'GARTENARBEITEN'))
    assert.notEqual(a.file, alt)
    const line = a.lines[0] ?? assert.fail('keine Zeile')
    assert.equal(line.category, 'Gartenpflege')
    assert.equal(line.suggestion?.level, 'rot')
    assert.equal(line.suggestion?.preselected, false)
    assert.ok(line.suggestion?.reasons.some((r) => /gleichem Inhalt/.test(r) && /Hausmeisterdienst/.test(r)), line.suggestion?.reasons.join(' | '))
    assert.ok(line.suggestion?.candidates.some((c) => c.id === hm.id), 'die Position steht als Kandidat da')
    assert.deepEqual(greenLines(a), [])
    const { preview, status } = await planAndBook(s, a, [{ idx: 0, action: 'create', fields: fieldsOfLine(line) }])
    assert.equal(status, 400)
    assert.ok(preview.confirm.some((c) => /gleichem Inhalt/.test(c.message) && /Hausmeisterdienst/.test(c.message)), JSON.stringify(preview.confirm))
    assert.equal(await totalOf(s), 40000, 'keine stille zweite Buchung')
  }, { invoices: NOCHMAL })
})

test('H1: eine erneut ausgewertete Zeile mit einer schon aus diesem Beleg gebuchten Position zu verknüpfen braucht die Bestätigung', async () => {
  await withOllama(async (s) => {
    const a = assessmentOf(await evaluate(s, 'ZWEIZEILEN'))
    const [frisch, ab] = a.lines
    assert.equal((await planAndBook(s, a, [
      { idx: 0, action: 'create', fields: { ...fieldsOfLine(frisch), amountCents: 75000 } },
      { idx: 1, action: 'create', fields: fieldsOfLine(ab) },
    ])).status, 200)
    const target = (await s.api<CostItem[]>('/api/costItems')).find((i) => i.description === 'Frischwasser') ?? assert.fail('Frischwasser fehlt')
    const again = assessmentOf(await evaluateAgain(s, a.file, 'ZWEIZEILEN'))
    const line = again.lines.find((l) => l.state === 'open') ?? assert.fail('keine offene Zeile')
    const link: LineDecision = { idx: line.idx, action: 'link', costItemId: target.id }
    const { preview, status } = await planAndBook(s, again, [link])
    assert.equal(status, 400)
    const asked = preview.confirm.find((c) => c.idx === line.idx) ?? assert.fail(`keine Rückfrage: ${JSON.stringify(preview)}`)
    assert.match(asked.message, /„Frischwasser“ ist schon aus diesem Beleg gebucht \(750,00\s€\)/)
    assert.match(asked.message, /addiert 700,00\s€ auf 1\.450,00\s€/)
    assert.equal(await totalOf(s), 155000, 'ohne Bestätigung keine Addition')
    assert.equal((await planAndBook(s, again, [{ ...link, despiteCandidates: true }])).status, 200)
    assert.equal(await totalOf(s), 225000)
  }, { invoices: NOCHMAL })
})
